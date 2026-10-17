// Real Chromium extension benchmark. Examples:
// node tools/rtl-benchmark.mjs --extension=logs/rtl-performance/before --output=logs/rtl-performance/before.json
// node tools/rtl-benchmark.mjs --output=logs/rtl-performance/after.json --runs=3
// Counters instrument the extension's isolated world; timing/RAF/Long Tasks use
// the page's real renderer. There is no simulated per-node cost or CPU delay.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rtlSettings = {
  enabled: true, globalEnabled: true, alignmentMode: 'auto', inputsAutoDir: true,
  fontFamily: 'System', forceRightAlign: false, justifyText: false,
  fixTables: true, fixListsBlockquotes: true, techCodeProtection: true,
  persianDigits: false, bionicTextEnabled: false, highlightEnabled: false,
  translatorEnabled: false, adBlockEnabled: false, globalAdBlockEnabled: false,
  readingRulerEnabled: false, pomodoroEnabled: false, focusCoachEnabled: false,
  allowCopyEnabled: false
};

export async function launchRtlContext(extension = root) {
  return chromium.launchPersistentContext('', {
    headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${path.resolve(extension)}`, `--load-extension=${path.resolve(extension)}`]
  });
}

// Functions passed to executeScript are literal/serializable.
export async function instrumentRtl(worker, tabId, action = 'install') {
  return worker.evaluate(({ tabId, action }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [action],
    func: action => {
      if (action === 'ready') return !!window.RtlFixer?.handleRuntimeMessage;
      if (action === 'metrics') return window.__rtlBenchmark?.metrics;
      if (action === 'reset') { window.__rtlBenchmark.reset(); return true; }
      if (window.__rtlBenchmark) { window.__rtlBenchmark.reset(); return true; }
      const state = window.__rtlBenchmark = { metrics: null, callbackDepth: 0, currentTask: null, openIterators: 0 };
      state.reset = () => {
        state.metrics = {
          scanCalls: {}, iteratorSteps: 0, openIterators: state.openIterators, maxIteratorStepMs: 0, applications: 0, getComputedStyleCalls: 0,
          textTraversalVisits: 0, elementTraversalVisits: 0, walkersCreated: 0,
          directionalReads: 0, pruneCalls: 0, idleCallbacks: [], scanTasks: [], outsideIdleApplications: 0, outsideScanApplications: 0
        };
      };
      state.reset();
      document.documentElement.setAttribute('data-rtl-benchmark-open-scans', '0');
      const beginScanTask = () => {
        if (state.currentTask) return;
        const metrics = state.metrics;
        const task = state.currentTask = {
          start: performance.now(), applications: metrics.applications, iteratorSteps: metrics.iteratorSteps,
          textTraversalVisits: metrics.textTraversalVisits, getComputedStyleCalls: metrics.getComputedStyleCalls
        };
        queueMicrotask(() => {
          metrics.scanTasks.push({ durationMs: performance.now() - task.start,
            applications: metrics.applications - task.applications, iteratorSteps: metrics.iteratorSteps - task.iteratorSteps,
            textTraversalVisits: metrics.textTraversalVisits - task.textTraversalVisits,
            getComputedStyleCalls: metrics.getComputedStyleCalls - task.getComputedStyleCalls });
          state.currentTask = null;
        });
      };
      for (const [name, original] of Object.entries(window.RtlFixer)) {
        if (typeof original !== 'function' || !/scan/i.test(name)) continue;
        window.RtlFixer[name] = function (...args) {
          if (name === 'scanAndProcess') beginScanTask();
          state.metrics.scanCalls[name] = (state.metrics.scanCalls[name] || 0) + 1;
          const result = original.apply(this, args);
          if (result && typeof result.next === 'function') {
            state.metrics.openIterators = ++state.openIterators;
            document.documentElement.setAttribute('data-rtl-benchmark-open-scans', String(state.openIterators));
            let finished = false;
            const next = result.next;
            result.next = function (...nextArgs) {
              beginScanTask();
              state.metrics.iteratorSteps++;
              const started = performance.now();
              try {
                const value = next.apply(this, nextArgs);
                if (value.done && !finished) {
                  finished = true;
                  state.metrics.openIterators = --state.openIterators;
                  document.documentElement.setAttribute('data-rtl-benchmark-open-scans', String(state.openIterators));
                }
                return value;
              }
              finally { state.metrics.maxIteratorStepMs = Math.max(state.metrics.maxIteratorStepMs, performance.now() - started); }
            };
          }
          return result;
        };
      }
      for (const [name, metric] of [['applyRtlToElement', 'applications'], ['getContainedDirectionalText', 'directionalReads'], ['pruneDisconnectedState', 'pruneCalls']]) {
        const original = window.RtlFixer[name];
        if (typeof original !== 'function') continue;
        window.RtlFixer[name] = function (...args) {
          state.metrics[metric]++;
          if (metric === 'applications' && !state.callbackDepth) state.metrics.outsideIdleApplications++;
          if (metric === 'applications' && !state.currentTask) state.metrics.outsideScanApplications++;
          return original.apply(this, args);
        };
      }
      const computedStyle = window.getComputedStyle;
      window.getComputedStyle = function (...args) {
        state.metrics.getComputedStyleCalls++;
        return computedStyle.apply(this, args);
      };
      const createWalker = document.createTreeWalker;
      document.createTreeWalker = function (...args) {
        state.metrics.walkersCreated++;
        const walker = createWalker.apply(this, args);
        const next = walker.nextNode;
        walker.nextNode = function (...nextArgs) {
          const result = next.apply(this, nextArgs);
          if (result?.nodeType === Node.TEXT_NODE) state.metrics.textTraversalVisits++;
          else if (result?.nodeType === Node.ELEMENT_NODE) state.metrics.elementTraversalVisits++;
          return result;
        };
        return walker;
      };
      if (typeof requestIdleCallback === 'function') {
        const idle = window.requestIdleCallback;
        window.requestIdleCallback = function (callback, options) {
          return idle.call(this, deadline => {
            const before = state.metrics.applications;
            const stepsBefore = state.metrics.iteratorSteps;
            const textBefore = state.metrics.textTraversalVisits;
            const stylesBefore = state.metrics.getComputedStyleCalls;
            const started = performance.now();
            state.callbackDepth++;
            try { return callback(deadline); }
            finally {
              state.callbackDepth--;
              state.metrics.idleCallbacks.push({ durationMs: performance.now() - started,
                applications: state.metrics.applications - before, iteratorSteps: state.metrics.iteratorSteps - stepsBefore,
                textTraversalVisits: state.metrics.textTraversalVisits - textBefore,
                getComputedStyleCalls: state.metrics.getComputedStyleCalls - stylesBefore });
            }
          }, options);
        };
      }
      return true;
    }
  }).then(results => results[0]?.result), { tabId, action });
}

export async function sendRtlSettings(worker, tabId, settings) {
  return worker.evaluate(({ tabId, settings }) => chrome.tabs.sendMessage(tabId, { action: 'updateSettings', settings }), { tabId, settings });
}

export async function openRtlFixture(context, suffix = 'fixture', host = 'example.com') {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(({ settings, host }) => chrome.storage.local.set({
    enabled: true, adBlockEnabled: false, ['site_config_' + host]: { ...settings, enabled: false }
  }), { settings: rtlSettings, host });
  const page = await context.newPage();
  await page.route(`https://${host}/**`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'body{font:16px Arial;margin:12px}main{width:900px}p{margin:4px 0}textarea{position:fixed;right:8px;top:8px;width:180px;height:48px}' +
      '</style></head><body><textarea id="compose" dir="auto" placeholder="Compose"></textarea><main id="chat"></main></body></html>'
  }));
  const url = `https://${host}/rtl-performance-${suffix}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const tabs = await worker.evaluate(url => chrome.tabs.query({ url }), url);
  const tabId = tabs[0].id;
  // Sending a message waits for the asynchronous initial settings read too.
  await sendRtlSettings(worker, tabId, { ...rtlSettings, enabled: false });
  await instrumentRtl(worker, tabId);
  return { page, worker, tabId };
}

export async function appendChat(page, count, detached = false) {
  return page.evaluate(({ count, detached }) => {
    const thread = document.createElement('section');
    thread.id = 'thread';
    for (let i = 0; i < count; i++) {
      const card = document.createElement('article');
      const shell = document.createElement('div');
      const response = document.createElement('div');
      response.className = 'chat-response';
      const prose = document.createElement('div');
      const p = document.createElement('p');
      p.id = 'msg-' + i;
      p.className = 'benchmark-message';
      p.append('متن فارسی پیام شماره ' + i + ' برای بررسی سرعت راستین همراه ');
      const strong = document.createElement('strong');
      strong.textContent = 'با کلمات مهم';
      p.append(strong, ' و یک توضیح کامل درباره عملکرد برنامه.');
      prose.append(p); response.append(prose); shell.append(response); card.append(shell); thread.append(card);
    }
    window.__detachedThread = thread;
    window.__originalMessageNodes = [...thread.querySelectorAll('p')].map(p => p.firstChild);
    if (!detached) document.getElementById('chat').append(thread);
    return thread.querySelectorAll('p').length;
  }, { count, detached });
}

export async function startRendererProbe(page, mode, count, streamUpdates = 90) {
  await page.evaluate(({ mode, count, streamUpdates }) => {
    const probe = window.__rendererProbe = {
      start: performance.now(), end: null, rtlReadyAt: null, frames: [], longTasks: [], inputDispatchMs: [],
      inputDirectionMismatches: 0, completedUpdates: 0, mode, count, streamUpdates, done: false
    };
    const editor = document.getElementById('compose');
    const input = i => {
      editor.value = i % 2 ? 'سلام دنیا ' + i : 'English text ' + i;
      const start = performance.now();
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editor.value }));
      probe.inputDispatchMs.push(performance.now() - start);
      if (editor.dir !== (i % 2 ? 'rtl' : 'ltr')) probe.inputDirectionMismatches++;
    };
    probe.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    });
    probe.observer.observe({ type: 'longtask', buffered: false });
    const tick = () => {
      const now = performance.now();
      probe.frames.push(now);
      if (mode === 'stream' && probe.completedUpdates < streamUpdates) {
        const i = probe.completedUpdates++;
        const target = document.getElementById('msg-' + (i % 30));
        const rtl = Math.floor(i / 30) % 2 === 1;
        target.firstChild.data = rtl ? 'متن فارسی به روز شده شماره ' + i : 'English stream update ' + i;
        // Replace inline text too so the English phase has no leftover RTL.
        target.querySelector('strong').textContent = rtl ? 'ادامه فارسی' : 'English words';
        target.lastChild.data = rtl ? ' پایان متن' : ' final suffix';
        input(i);
      } else {
        // A real input handler runs between chunked scans, with no artificial cost.
        if (mode !== 'activation' || document.querySelector('.benchmark-message[dir="rtl"]')) input(probe.frames.length);
      }
      const ready = mode === 'stream'
        ? probe.completedUpdates === streamUpdates && [...document.querySelectorAll('.benchmark-message')].slice(0, 30).every(p => !p.hasAttribute('dir'))
        : document.querySelectorAll('.benchmark-message[dir="rtl"]').length === count;
      if (ready && probe.rtlReadyAt === null) { probe.rtlReadyAt = performance.now(); probe.ready = true; }
      if (ready && document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0') {
        probe.end = performance.now(); probe.done = true; return;
      }
      probe.raf = requestAnimationFrame(tick);
    };
    probe.raf = requestAnimationFrame(tick);
  }, { mode, count, streamUpdates });
}

export async function finishRendererProbe(page) {
  await page.waitForFunction(() => window.__rendererProbe.done, null, { timeout: 60000 });
  // Flush PerformanceObserver delivery after the final work task.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const p = window.__rendererProbe;
    p.observer.disconnect();
    const frames = p.frames.filter(t => t >= p.start && t < p.end);
    const boundaries = [p.start, ...frames, p.end];
    const longTasks = p.longTasks.filter(t => t.startTime < p.end && t.startTime + t.duration > p.start);
    const percentile = (values, quantile) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
    };
    return {
      elapsedMs: p.end - p.start, timeToRtlMs: p.rtlReadyAt - p.start, rafCount: frames.length,
      maxRafGapMs: Math.max(0, ...boundaries.slice(1).map((t, i) => t - boundaries[i])),
      longTaskCount: longTasks.length, maxLongTaskMs: Math.max(0, ...longTasks.map(t => t.duration)), longTasks,
      inputEvents: p.inputDispatchMs.length, inputDispatchP95Ms: percentile(p.inputDispatchMs, .95),
      inputDirectionMismatches: p.inputDirectionMismatches, completedUpdates: p.completedUpdates,
      originalTextNodesConnected: window.__originalMessageNodes.every(n => n.isConnected),
      finalRtlCount: document.querySelectorAll('.benchmark-message[dir="rtl"]').length
    };
  });
}

export async function measureRtlScenario(context, mode, count = 1000, suffix = mode) {
  const fixture = await openRtlFixture(context, suffix);
  const { page, worker, tabId } = fixture;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (mode === 'activation') {
      await appendChat(page, count);
      await instrumentRtl(worker, tabId, 'reset');
      await startRendererProbe(page, mode, count);
      await sendRtlSettings(worker, tabId, rtlSettings);
    } else {
      await sendRtlSettings(worker, tabId, rtlSettings);
      if (mode === 'stream') {
        await appendChat(page, count);
        await page.waitForFunction(count => document.querySelectorAll('.benchmark-message[dir="rtl"]').length === count, count);
      } else {
        await appendChat(page, count, true);
      }
      await instrumentRtl(worker, tabId, 'reset');
      await startRendererProbe(page, mode, count);
      if (mode !== 'stream') await page.evaluate(() => document.getElementById('chat').append(window.__detachedThread));
    }
    const renderer = await finishRendererProbe(page);
    const counters = await instrumentRtl(worker, tabId, 'metrics');
    const result = { mode, paragraphCount: count, ...renderer, ...counters,
      scanCpuMs: counters.scanTasks.reduce((sum, task) => sum + task.durationMs, 0),
      maxScanTaskMs: Math.max(0, ...counters.scanTasks.map(task => task.durationMs)), errors };
    if (errors.length || !result.originalTextNodesConnected || result.inputDirectionMismatches) throw new Error('Invalid benchmark: ' + JSON.stringify(result));
    return result;
  } finally { await page.close(); }
}

async function cli() {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) throw new Error('Use --option=value or --option value');
    const split = arg.indexOf('=');
    options[arg.slice(2, split < 0 ? undefined : split)] = split < 0 ? process.argv[++i] : arg.slice(split + 1);
  }
  const count = Number(options.nodes || 1000);
  const runCount = Number(options.runs || 3);
  if (!Number.isSafeInteger(count) || count < 30 || !Number.isSafeInteger(runCount) || runCount < 1) throw new Error('nodes >= 30 and runs >= 1 must be integers');
  const extension = path.resolve(root, options.extension || '.');
  const sources = {};
  for (const name of ['content/main.js', 'content/dom.js', 'content/utils.js']) sources[name] = createHash('sha256').update(await readFile(path.join(extension, name))).digest('hex');
  const context = await launchRtlContext(extension);
  const runs = [];
  try {
    for (let run = 1; run <= runCount; run++) {
      for (const mode of ['activation', 'subtree', 'stream']) {
        const result = await measureRtlScenario(context, mode, count, `${run}-${mode}`);
        runs.push({ run, ...result });
        console.log(JSON.stringify({ run, mode, elapsedMs: result.elapsedMs, maxRafGapMs: result.maxRafGapMs,
          getComputedStyleCalls: result.getComputedStyleCalls, textTraversalVisits: result.textTraversalVisits,
          applications: result.applications, scanTasks: result.scanTasks.length, longTaskCount: result.longTaskCount }));
      }
    }
    const median = values => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
    const metricNames = ['elapsedMs', 'timeToRtlMs', 'scanCpuMs', 'maxScanTaskMs', 'maxRafGapMs', 'longTaskCount', 'maxLongTaskMs', 'getComputedStyleCalls', 'textTraversalVisits', 'applications', 'iteratorSteps', 'rafCount', 'inputDispatchP95Ms'];
    const summaries = Object.fromEntries(['activation', 'subtree', 'stream'].map(mode => [mode,
      Object.fromEntries(metricNames.map(name => [name, median(runs.filter(r => r.mode === mode).map(r => r[name]))]))]));
    for (const name of Object.keys(sources)) {
      const finalHash = createHash('sha256').update(await readFile(path.join(extension, name))).digest('hex');
      if (sources[name] !== finalHash) throw new Error('Extension source changed during benchmark: ' + name);
    }
    const report = {
      createdAt: new Date().toISOString(), extension, browserVersion: context.browser()?.version(), nodeVersion: process.version,
      fixture: { paragraphCount: count, nesting: 'section > article > div > div > div > p > strong', streamUpdates: 90 }, sources,
      methodology: 'Full extension on a routed HTTPS page. Other optional tools and adblock disabled. Activation starts before enable message; added subtree starts before a single append; stream updates 30 messages across 90 animation frames, alternating English/Persian/English. Isolated-world counters observe real scans, text traversal and style reads; no simulated work. timeToRtlMs ends on final direction; elapsedMs additionally waits for every scan iterator to finish. scanTasks group synchronous iterator.next calls until the following microtask, independently of scheduler type. Native renderer frame/Long Tasks metrics cover the complete interval.',
      caveats: ['Synthetic DOM and timings depend on hardware, browser, JIT and scheduling.', 'RAF gaps measure rendering opportunities, not keyboard input latency. Input dispatch records the real input handler on synthetic events.', 'Long Tasks reports tasks >= 50 ms. Instrumentation adds a small cost identically in before/after runs.', 'Elapsed stream time includes the same 90 frame updates in both builds. Style/text counters provide deterministic work comparison.'],
      summaries, runs
    };
    const output = path.resolve(root, options.output || 'logs/rtl-performance/benchmark.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, summaries }));
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await cli();
