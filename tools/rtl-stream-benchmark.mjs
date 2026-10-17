// Full-extension Chromium burst/stream benchmark, with real observer CPU time.
// Use the SAME harness for both builds:
// node tools/rtl-stream-benchmark.mjs --extension=logs/rtl-60/before --output=logs/rtl-60/burst-before.json --runs=5
// node tools/rtl-stream-benchmark.mjs --output=logs/rtl-60/burst-after.json --runs=5
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  root, launchRtlContext, openRtlFixture, sendRtlSettings, instrumentRtl, rtlSettings
} from './rtl-benchmark.mjs';

export const burstModes = ['single-message-burst', 'multi-message-burst', 'multi-message-stream'];

async function installObserverProbe(worker, tabId) {
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const state = window.__rtlStreamObserver = { active: false, metrics: null };
      state.reset = () => {
        state.metrics = { observerCpuMs: 0, maxObserverCallbackMs: 0, observerCallbacks: 0,
          observerRecords: 0, characterDataRecords: 0, childListRecords: 0, directionRecords: 0 };
        state.active = true;
      };
      const applyRtl = window.RtlFixer.applyRtlToElement;
      window.RtlFixer.applyRtlToElement = function (...args) {
        const result = applyRtl.apply(this, args);
        const element = args[0];
        if (element?.classList.contains('burst-message')) {
          // A repeated final RTL direction can otherwise match an older frame.
          // This page-visible marker proves the newest text reached the actual
          // processor. The production observer filters attributes to dir only.
          element.setAttribute('data-rtl-burst-processed-text', element.textContent);
        }
        return result;
      };
      const NativeObserver = window.MutationObserver;
      // Installed before startObserver: measure its actual native deliveries,
      // never manually call the handler or add simulated per-record work.
      window.MutationObserver = class extends NativeObserver {
        constructor(callback) {
          const isRtl = callback === window.RtlFixer.handlePageMutations;
          super(!isRtl ? callback : (records, observer) => {
            if (!state.active) return callback.call(observer, records, observer);
            const start = performance.now();
            try { return callback.call(observer, records, observer); }
            finally {
              const duration = performance.now() - start;
              const metrics = state.metrics;
              metrics.observerCpuMs += duration;
              metrics.maxObserverCallbackMs = Math.max(metrics.maxObserverCallbackMs, duration);
              metrics.observerCallbacks++;
              metrics.observerRecords += records.length;
              for (const record of records) {
                if (record.type === 'characterData') metrics.characterDataRecords++;
                else if (record.type === 'childList') metrics.childListRecords++;
                else if (record.attributeName === 'dir') metrics.directionRecords++;
              }
            }
          });
        }
      };
    }
  }), tabId);
}

async function createFormattedChat(page, count, depth) {
  await page.evaluate(({ count, depth }) => {
    const thread = document.createElement('section'); thread.id = 'burst-thread';
    const wrappers = ['span', 'strong', 'em', 'span', 'mark', 'span', 'small', 'span'];
    const paragraphs = [], originalNodes = [], parentNodes = [];
    for (let message = 0; message < count; message++) {
      const article = document.createElement('article');
      const shell = document.createElement('div');
      const p = document.createElement('p'); p.className = 'burst-message'; p.id = 'burst-message-' + message;
      const texts = [];
      for (let branch = 0; branch < 3; branch++) {
        let parent = p;
        for (let level = 0; level < depth; level++) {
          const wrapper = document.createElement(wrappers[level % wrappers.length]);
          parent.append(wrapper); parent = wrapper;
        }
        const text = document.createTextNode(`بخش فارسی ${branch} پیام ${message} برای بررسی متن پویا و قالب‌بندی شده. `);
        parent.append(text); texts.push(text); originalNodes.push(text); parentNodes.push(parent);
      }
      shell.append(p); article.append(shell); thread.append(article); paragraphs.push({ p, texts });
    }
    document.getElementById('chat').append(thread);
    window.__burstChat = { paragraphs, originalNodes, parentNodes };
  }, { count, depth });
}

async function resetProbes(worker, tabId) {
  await instrumentRtl(worker, tabId, 'reset');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.__rtlStreamObserver.reset()
  }), tabId);
}

async function startBurstProbe(page, mode, count, frames) {
  await page.evaluate(({ mode, count, frames }) => {
    const state = window.__burstProbe = { start: performance.now(), end: null, done: false,
      frames: [], longTasks: [], inputDispatchMs: [], inputDirectionMismatches: 0,
      completedUpdates: 0, textWrites: 0, lastUpdateAt: null };
    const editor = document.getElementById('compose');
    state.observer = new PerformanceObserver(list => {
      for (const task of list.getEntries()) state.longTasks.push({ startTime: task.startTime, duration: task.duration });
    });
    state.observer.observe({ type: 'longtask', buffered: false });
    const input = i => {
      editor.value = i % 2 ? 'سلام دنیا ' + i : 'English input ' + i;
      const started = performance.now();
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editor.value }));
      state.inputDispatchMs.push(performance.now() - started);
      if (editor.dir !== (i % 2 ? 'rtl' : 'ltr')) state.inputDirectionMismatches++;
    };
    const updateAllMessages = frame => {
      const rtl = mode === 'multi-message-stream' && frame % 2 === 1;
      for (let message = 0; message < count; message++) {
        for (let branch = 0; branch < 3; branch++) {
          window.__burstChat.paragraphs[message].texts[branch].data = rtl
            ? `بخش فارسی ${branch} پیام ${message}، تغییر واقعی ${frame} برای بررسی پاسخ پویا. `
            : `English segment ${branch} of message ${message}, actual update ${frame} of the streamed response. `;
          state.textWrites++;
        }
      }
      state.completedUpdates++;
      state.lastUpdateAt = performance.now();
    };
    const tick = () => {
      state.frames.push(performance.now());
      if (mode === 'multi-message-stream' && state.completedUpdates < frames) updateAllMessages(state.completedUpdates);
      input(state.frames.length);
      const complete = mode !== 'multi-message-stream' || state.completedUpdates === frames;
      const finalRtl = mode === 'multi-message-stream' && (frames - 1) % 2 === 1;
      const paragraphs = mode === 'single-message-burst'
        ? [window.__burstChat.paragraphs[0]] : window.__burstChat.paragraphs;
      const directionsCorrect = paragraphs.every(({ p }) =>
        p.getAttribute('data-rtl-burst-processed-text') === p.textContent &&
        (finalRtl ? p.dir === 'rtl' : !p.hasAttribute('dir')));
      if (complete && directionsCorrect && document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0') {
        state.end = performance.now(); state.done = true; return;
      }
      requestAnimationFrame(tick);
    };
    if (mode === 'single-message-burst') {
      // Buffered tokens arriving together: 200 genuine progressively growing
      // characterData writes across three formatting runs in one paragraph.
      for (let write = 0; write < 200; write++) {
        const branch = write % 3;
        window.__burstChat.paragraphs[0].texts[branch].data =
          `English segment ${branch}: ${'token '.repeat(Math.floor(write / 3) + 1)}${write}`;
        state.textWrites++;
      }
      state.completedUpdates = 1; state.lastUpdateAt = performance.now(); input(0);
    } else if (mode === 'multi-message-burst') {
      updateAllMessages(0); input(0);
    }
    requestAnimationFrame(tick);
  }, { mode, count, frames });
}

async function finishBurstProbe(page, worker, tabId) {
  await page.waitForFunction(() => window.__burstProbe.done, null, { timeout: 60000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const renderer = await page.evaluate(() => {
    const state = window.__burstProbe; state.observer.disconnect();
    const percentile = (values, quantile) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * quantile)];
    };
    const boundaries = [state.start, ...state.frames.filter(t => t < state.end), state.end];
    const longTasks = state.longTasks.filter(t => t.startTime < state.end && t.startTime + t.duration > state.start);
    return { elapsedMs: state.end - state.start, finalUpdateLatencyMs: state.end - state.lastUpdateAt,
      maxRafGapMs: Math.max(0, ...boundaries.slice(1).map((t, i) => t - boundaries[i])),
      inputEvents: state.inputDispatchMs.length, inputDispatchP95Ms: percentile(state.inputDispatchMs, .95),
      inputDirectionMismatches: state.inputDirectionMismatches, textWrites: state.textWrites,
      completedUpdates: state.completedUpdates, longTaskCount: longTasks.length,
      maxLongTaskMs: Math.max(0, ...longTasks.map(task => task.duration)), longTasks,
      originalTextNodesPreserved: window.__burstChat.originalNodes.every((node, i) =>
        node.isConnected && node.parentNode === window.__burstChat.parentNodes[i] && node.parentNode.firstChild === node),
      finalRtlCount: window.__burstChat.paragraphs.filter(({ p }) => p.dir === 'rtl').length };
  });
  const observer = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      window.__rtlStreamObserver.active = false;
      return window.__rtlStreamObserver.metrics;
    }
  }).then(results => results[0].result), tabId);
  return { ...renderer, ...observer };
}

export async function measureBurstScenario(context, mode, { count = 100, depth = 8, frames = 20, suffix = mode } = {}) {
  if (!burstModes.includes(mode)) throw new Error('Unknown burst mode: ' + mode);
  const { page, worker, tabId } = await openRtlFixture(context, 'burst-' + suffix);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await installObserverProbe(worker, tabId);
    await createFormattedChat(page, count, depth);
    await sendRtlSettings(worker, tabId, rtlSettings);
    await page.waitForFunction(count => document.querySelectorAll('.burst-message[dir="rtl"]').length === count &&
      [...document.querySelectorAll('.burst-message')].every(p => p.getAttribute('data-rtl-burst-processed-text') === p.textContent) &&
      document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0', count);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await resetProbes(worker, tabId);
    await startBurstProbe(page, mode, count, frames);
    const measured = await finishBurstProbe(page, worker, tabId);
    const scans = await instrumentRtl(worker, tabId, 'metrics');
    const finalRtl = mode === 'single-message-burst' ? count - 1 :
      mode === 'multi-message-stream' && (frames - 1) % 2 === 1 ? count : 0;
    const expectedWrites = mode === 'single-message-burst' ? 200 : count * 3 * (mode === 'multi-message-stream' ? frames : 1);
    const result = { mode, paragraphCount: count, inlineDepth: depth, streamFrames: frames, ...measured, ...scans,
      scanCpuMs: scans.scanTasks.reduce((sum, task) => sum + task.durationMs, 0),
      maxScanTaskMs: Math.max(0, ...scans.scanTasks.map(task => task.durationMs)), errors };
    if (errors.length || !result.originalTextNodesPreserved || result.inputDirectionMismatches ||
        result.characterDataRecords !== expectedWrites || result.finalRtlCount !== finalRtl ||
        !result.observerCallbacks || !result.inputEvents) {
      throw new Error('Invalid burst benchmark: ' + JSON.stringify(result));
    }
    return result;
  } finally { await page.close(); }
}

async function cli() {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) throw new Error('Use --option=value or --option value');
    const equal = arg.indexOf('=');
    options[arg.slice(2, equal < 0 ? undefined : equal)] = equal < 0 ? process.argv[++i] : arg.slice(equal + 1);
  }
  const count = Number(options.nodes || 100), depth = Number(options.depth || 8),
    frames = Number(options.frames || 20), runCount = Number(options.runs || 5);
  if (![count, depth, frames, runCount].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('nodes/depth/frames/runs must be positive integers');
  const extension = path.resolve(root, options.extension || '.');
  const sources = {};
  for (const name of ['content/constants.js', 'content/main.js', 'content/dom.js', 'content/utils.js']) {
    sources[name] = createHash('sha256').update(await readFile(path.join(extension, name))).digest('hex');
  }
  const harnessSources = {};
  for (const name of ['tools/rtl-stream-benchmark.mjs', 'tools/rtl-benchmark.mjs']) {
    harnessSources[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  }
  const harnessHash = harnessSources['tools/rtl-stream-benchmark.mjs'];
  const context = await launchRtlContext(extension), runs = [];
  try {
    for (let run = 1; run <= runCount; run++) {
      for (const mode of burstModes) {
        const result = await measureBurstScenario(context, mode, { count, depth, frames, suffix: `${run}-${mode}` });
        runs.push({ run, ...result });
        console.log(JSON.stringify({ run, mode, elapsedMs: result.elapsedMs, observerCpuMs: result.observerCpuMs,
          observerRecords: result.observerRecords, characterDataRecords: result.characterDataRecords,
          scanCpuMs: result.scanCpuMs, inputDispatchP95Ms: result.inputDispatchP95Ms }));
      }
    }
    for (const name of Object.keys(sources)) {
      const finalHash = createHash('sha256').update(await readFile(path.join(extension, name))).digest('hex');
      if (sources[name] !== finalHash) throw new Error('Extension source changed during benchmark: ' + name);
    }
    for (const name of Object.keys(harnessSources)) {
      const finalHash = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
      if (harnessSources[name] !== finalHash) throw new Error('Benchmark harness changed during benchmark: ' + name);
    }
    const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
    const metricNames = ['elapsedMs', 'finalUpdateLatencyMs', 'observerCpuMs', 'maxObserverCallbackMs', 'observerCallbacks',
      'observerRecords', 'characterDataRecords', 'scanCpuMs', 'maxScanTaskMs', 'maxRafGapMs', 'inputDispatchP95Ms',
      'longTaskCount', 'maxLongTaskMs', 'getComputedStyleCalls', 'textTraversalVisits', 'elementTraversalVisits',
      'applications', 'iteratorSteps', 'textWrites'];
    const summaries = Object.fromEntries(burstModes.map(mode => [mode, Object.fromEntries(metricNames.map(name =>
      [name, median(runs.filter(run => run.mode === mode).map(run => run[name]))]))]));
    const report = { createdAt: new Date().toISOString(), extension, nodeVersion: process.version,
      browserVersion: context.browser()?.version(), sources, harnessHash, harnessSources,
      fixture: { paragraphCount: count, inlineDepth: depth, textRunsPerParagraph: 3, streamFrames: frames,
        singleMessageWrites: 200, nesting: 'section > article > div > p > inline formatting wrappers > text' },
      methodology: 'Full extension on a routed HTTPS page with other tools disabled. Native MutationObserver delivery times the actual RTL callback in its isolated world; no manual observer calls, synthetic processing costs or text-node replacements. All measured writes change text. One buffered token burst makes 200 writes across 3 runs in a paragraph; one multi-paragraph burst changes all 3 runs in each paragraph; multi-paragraph stream changes those runs across animation frames and alternates English/Persian. Actual input handlers run on synthetic InputEvents between work slices. A wrapper around the real applyRtlToElement records the paragraph text after processing in an attribute ignored by the production direction observer. Completion requires that processed-text marker to match the latest text, correct final directions and zero active scan iterators. Renderer frame/Long Tasks timing, marker writes and existing scan counters use the same instrumentation in both builds.',
      caveats: ['Synthetic workloads describe buffered streaming and a formatted answer changing in multiple paragraphs; results are not a universal site speed percentage.',
        'Observer timer excludes record-count instrumentation itself, but that collection still adds equal work before/after.',
        'The processed-text marker adds a text read and attribute write per paragraph application in both builds; it prevents an older RTL frame from falsely satisfying final completion.',
        'Elapsed multi-message stream includes the fixed number of animation frames. Observer/scan CPU and final-update latency separate that pacing from extension work.',
        'Synthetic InputEvent dispatch measures the real direction handler, not physical keyboard-to-paint latency.',
        'Hardware, JIT, browser and scheduling affect timings; compare repeated-run medians using an unchanged harness.'],
      summaries, runs };
    const output = path.resolve(root, options.output || 'logs/rtl-60/burst.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, summaries }));
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await cli();
