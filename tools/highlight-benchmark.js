// Isolated restore benchmark: node tools/highlight-benchmark.js
// Options: --runs=3 --nodes=18000 --highlights=300 --baseline-ref=HEAD
//          --output=logs/highlight-benchmark.json --channel=chromium
//
// Compare only content/highlight-manager.js from Git with the working file, on
// fresh headless pages. Other extension modules, worker, RTL and adblock are not
// loaded. Both engines receive identical canonical IDs/pageKey and stale XPaths.
// Native CSS highlights paint normally; range texts and color are verified.
//
// Timing starts at the first stored XPath lookup (document.evaluate or its strict
// ID fast path) after storage delivery, ending after repair and finalization.
// Fixture construction, initial layout, source injection and storage latency are
// excluded. RAF callbacks count ONLY inside that actual restore interval.
// maxRafGapMs includes clipped initial/final gaps; with no RAF it equals blocked
// restore duration, rather than reporting fabricated input latency. Long-task
// durations include the full overlapping browser task, while overlapMs records
// only its part inside the interval. Tasks shorter than 50ms are not reported.
//
// These synthetic results vary by hardware, Chromium, scheduling and JIT. RAF
// measures opportunities to respond, not input latency or guaranteed real-site
// FPS. This cannot rank competing extensions or guarantee every page stays fast.
// Short stale-XPath records exercise shared indexing and quote restoration; other
// functional scenarios are covered by tests/highlight.spec.js. Mock onChanged
// deliberately triggers no second reconciliation pass: measure one restore only.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  if (!argument.startsWith('--') || !argument.includes('=')) throw new Error('Use --option=value');
  const separator = argument.indexOf('=');
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
const positiveInteger = (key, fallback) => {
  const value = Number(options[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('--' + key + ' must be a positive integer');
  return value;
};
const nodeCount = positiveInteger('nodes', 18000);
const highlightCount = positiveInteger('highlights', 300);
const runCount = positiveInteger('runs', 3);
if (highlightCount > nodeCount) throw new Error('highlights must not exceed nodes');
const baselineRef = options['baseline-ref'] || 'HEAD';
const baselineCommit = execFileSync('git', ['rev-parse', baselineRef], { cwd: root, encoding: 'utf8' }).trim();
const baselineSource = execFileSync('git', ['show', baselineRef + ':content/highlight-manager.js'], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
});
const workingSource = await readFile(path.join(root, 'content', 'highlight-manager.js'), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const records = Array.from({ length: highlightCount }, (_, index) => ({
  id: 'benchmark-' + String(index).padStart(4, '0'), pageKey: 'example.com/highlight-benchmark',
  url: 'https://example.com/highlight-benchmark', path: '/highlight-benchmark',
  text: 'Unique benchmark passage ' + String(index).padStart(4, '0') + ' ends here.',
  color: '#fef08a', timestamp: 1700000000000 + index,
  startPath: '//*[@id="missing-benchmark-' + index + '"]',
  endPath: '//*[@id="missing-benchmark-' + index + '"]',
  startNodeIndex: 0, endNodeIndex: 0, startOffset: 0, endOffset: 49, note: { text: '' }
}));
const browser = await chromium.launch({ headless: true, channel: options.channel || 'chromium' });
const runs = [];

async function measure(label, source, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('https://example.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8">' +
        '<style>body{margin:24px;font:16px Arial}p{margin:8px 0}' +
        '::highlight(rastin-color-yellow){background-color:rgba(254,240,138,.4);color:inherit}</style>' +
        '</head><body><main id="benchmark-document"></main></body></html>'
    }));
    await page.goto('https://example.com/highlight-benchmark');
    await page.evaluate(({ nodeCount, records }) => {
      const fragment = document.createDocumentFragment();
      const targets = new Map(records.map((record, index) => [Math.floor(index * nodeCount / records.length), record]));
      for (let index = 0; index < nodeCount; index++) {
        const paragraph = document.createElement('p');
        paragraph.id = 'paragraph-' + index;
        const target = targets.get(index);
        paragraph.textContent = target
          ? 'Context before ' + target.text + ' Useful context after this target.'
          : 'Ordinary document fragment ' + index + ' with context for text indexing and realistic length.';
        fragment.appendChild(paragraph);
      }
      document.getElementById('benchmark-document').appendChild(fragment);
      const key = 'rtl_fixer_hl_example.com';
      const data = { [key]: structuredClone(records) };
      const changeListeners = new Set();
      const state = window.__benchmark = {
        start: null, end: null, rafTimes: [], longTasks: [], operationTypes: [],
        repairedCount: 0, done: false, failure: null, originalNodes: [], pendingRaf: null
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) state.originalNodes.push(node);
      window.RtlFixer = {
        DEBUG: false, _domMutationVersion: 0,
        config: { enabled: true, globalEnabled: true, highlightEnabled: true, highlightColor: 'yellow', translatorEnabled: false },
        UI: { icon: () => '', toast: () => {}, copy: () => Promise.resolve() }
      };
      window.RtlFixer.DEFAULT_CONFIG = window.RtlFixer.config;
      const finish = () => {
        if (state.done) return;
        state.end = performance.now(); state.done = true;
        cancelAnimationFrame(state.pendingRaf);
      };
      window.chrome = {
        runtime: {
          lastError: null, getURL: relative => 'https://example.com/' + relative,
          sendMessage: (message, callback) => {
            if (message.action !== 'mutateHighlights') throw new Error('Unexpected mock runtime action: ' + message.action);
            const { key: storageKey, operation } = message;
            state.operationTypes.push(operation.type);
            if (operation.type === 'repair') {
              state.repairedCount = operation.repairs.length;
              // All ranges are registered before this; include finalization.
              queueMicrotask(finish);
            }
            setTimeout(() => {
              let items = data[storageKey] || [];
              if (operation.type === 'repair') {
                const repairs = new Map(operation.repairs);
                items = items.map(item => ({ ...item, ...(repairs.get('id:' + item.id) || {}) }));
              } else if (operation.type !== 'migrate') {
                state.failure = 'Unexpected benchmark mutation: ' + operation.type;
              }
              data[storageKey] = items;
              callback?.({ ok: !state.failure, items: structuredClone(items), error: state.failure });
            }, 0);
          }
        },
        storage: {
          onChanged: { addListener: listener => changeListeners.add(listener), removeListener: listener => changeListeners.delete(listener) },
          local: {
            get: (keys, callback) => {
              setTimeout(() => {
                const requested = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
                const result = Object.fromEntries(requested.filter(name => data[name] !== undefined).map(name => [name, structuredClone(data[name])]));
                callback(result);
              }, 0);
            },
            set: (values, callback) => { Object.assign(data, structuredClone(values)); setTimeout(() => callback?.(), 0); },
            remove: (keys, callback) => { for (const name of Array.isArray(keys) ? keys : [keys]) delete data[name]; setTimeout(() => callback?.(), 0); }
          }
        }
      };
      const evaluate = document.evaluate;
      document.evaluate = function (...args) {
        if (state.start === null) state.start = performance.now();
        return evaluate.apply(this, args);
      };
      // A strict-ID XPath optimization may bypass document.evaluate entirely.
      // Only this fixture's deliberately missing anchor IDs start measurement.
      const getElementById = document.getElementById;
      document.getElementById = function (id) {
        if (state.start === null && String(id).startsWith('missing-benchmark-')) state.start = performance.now();
        return getElementById.call(this, id);
      };
      if (!CSS.highlights || typeof Highlight !== 'function') throw new Error('Benchmark requires native CSS Highlights');
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('Benchmark requires the Long Tasks API');
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      });
      observer.observe({ type: 'longtask', buffered: false });
      state.observer = observer;
    }, { nodeCount, records });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => {
      const state = window.__benchmark;
      const frame = () => {
        if (state.done) return;
        if (state.start !== null) state.rafTimes.push(performance.now());
        state.pendingRaf = requestAnimationFrame(frame);
      };
      state.pendingRaf = requestAnimationFrame(frame);
      // Avoid init timers/toolbars: invoke the public restore engine alone.
      const result = window.RtlFixer.loadAndRestoreHighlights(false);
      if (result?.catch) result.catch(error => { state.failure = error.message; });
    });
    await page.waitForFunction(() => window.__benchmark.done || window.__benchmark.failure, null, { timeout: 60000 });
    // Deliver observer notifications after the synchronous baseline unblocks.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(({ expectedTexts }) => {
      const state = window.__benchmark;
      state.observer.disconnect();
      const rafTimes = state.rafTimes.filter(time => time >= state.start && time < state.end);
      const boundaries = [state.start, ...rafTimes, state.end];
      const gaps = boundaries.slice(1).map((time, index) => time - boundaries[index]);
      const longTasks = state.longTasks.filter(entry => entry.startTime < state.end && entry.startTime + entry.duration > state.start)
        .map(entry => ({ ...entry, overlapMs: Math.min(state.end, entry.startTime + entry.duration) - Math.max(state.start, entry.startTime) }));
      const ranges = [...(CSS.highlights.get('rastin-color-yellow') || [])];
      const actualTexts = ranges.map(range => range.toString()).sort();
      const expected = [...expectedTexts].sort();
      const painted = ranges.length ? getComputedStyle(ranges[0].startContainer.parentElement, '::highlight(rastin-color-yellow)').backgroundColor : null;
      return {
        durationMs: state.end - state.start, rafCountDuringRestore: rafTimes.length,
        maxRafGapMs: Math.max(0, ...gaps), longTaskCount: longTasks.length,
        maxLongTaskMs: Math.max(0, ...longTasks.map(entry => entry.duration)),
        longTaskOverlapMs: longTasks.reduce((total, entry) => total + entry.overlapMs, 0),
        longTasks, restoredCount: ranges.length, repairedCount: state.repairedCount,
        textMatches: JSON.stringify(actualTexts) === JSON.stringify(expected),
        bodyTextNodeCount: state.originalNodes.length,
        originalTextNodesConnected: state.originalNodes.every(node => node.isConnected),
        domMarkCount: document.querySelectorAll('mark.rastin-highlight').length,
        nativeBackgroundColor: painted, operationTypes: state.operationTypes, failure: state.failure
      };
    }, { expectedTexts: records.map(record => record.text) });
    if (errors.length || result.failure || result.restoredCount !== highlightCount || !result.textMatches || result.domMarkCount !== 0 ||
        result.bodyTextNodeCount !== nodeCount || !result.originalTextNodesConnected || result.repairedCount !== highlightCount ||
        !result.nativeBackgroundColor || result.nativeBackgroundColor === 'rgba(0, 0, 0, 0)') {
      throw new Error(label + ' benchmark invalid: ' + JSON.stringify({ ...result, errors }));
    }
    return { label, run, ...result };
  } finally { await context.close(); }
}

try {
  for (let run = 1; run <= runCount; run++) {
    const sources = run % 2 ? [['baseline', baselineSource], ['working', workingSource]] : [['working', workingSource], ['baseline', baselineSource]];
    for (const [label, source] of sources) {
      const result = await measure(label, source, run);
      runs.push(result);
      console.log(JSON.stringify({ label, run, durationMs: result.durationMs, rafCountDuringRestore: result.rafCountDuringRestore,
        maxRafGapMs: result.maxRafGapMs, longTaskCount: result.longTaskCount, maxLongTaskMs: result.maxLongTaskMs, restoredCount: result.restoredCount }));
    }
  }
  const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const metrics = ['durationMs', 'rafCountDuringRestore', 'maxRafGapMs', 'longTaskCount', 'maxLongTaskMs', 'longTaskOverlapMs'];
  const summaries = Object.fromEntries(['baseline', 'working'].map(label => [label, Object.fromEntries(metrics.map(metric =>
    [metric + 'Median', median(runs.filter(run => run.label === label).map(run => run[metric]))]))]));
  const report = {
    createdAt: new Date().toISOString(), nodeVersion: process.version, platform: process.platform, browserVersion: browser.version(),
    fixture: { url: 'https://example.com/highlight-benchmark', nodeCount, highlightCount, recordSha256: sha256(JSON.stringify(records)), nativeCSSHighlights: true },
    sources: { baseline: { ref: baselineRef, commit: baselineCommit, sha256: sha256(baselineSource) }, working: { sha256: sha256(workingSource) } },
    methodology: 'Fresh headless pages; highlight-manager alone; same records and DOM; alternating order; first stored XPath lookup (evaluate or strict-ID fast path) to microtask after repair request; RAF counted only within restore; storage latency and initial layout excluded.',
    caveats: [
      'Synthetic measurements depend on hardware, browser, JIT, paint and scheduling; no real-site or competing-extension speed claim.',
      'maxRafGapMs includes clipped interval boundaries; zero RAF means it equals the synchronous blocked duration. This is not input latency.',
      'Long Tasks API reports tasks at least 50ms; full task duration and clipped interval overlap are both recorded.',
      'Mock storage emits no onChanged reconciliation pass; no extension background worker, RTL, ad blocker, sidebar or toolbar initialization.',
      'Both sources are copied once at startup, with hashes; edits after startup require rerunning.'
    ], summaries, runs
  };
  const output = path.resolve(root, options.output || 'logs/highlight-benchmark.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summaries, output }));
} finally { await browser.close(); }

