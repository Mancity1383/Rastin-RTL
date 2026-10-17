// Alternating, sequential measurements of real extension code in Chromium.
// No synthetic scan cost, paused frames or mocked direction logic.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { launchRtlContext, openRtlFixture, sendRtlSettings, instrumentRtl, rtlSettings, root } from './rtl-benchmark.mjs';

async function measure(context, mode, count, suffix) {
  const { page, worker, tabId } = await openRtlFixture(context, suffix, mode === 'visible-history' ? 'chatgpt.com' : 'example.com');
  try {
    if (mode === 'live-history') {
      await page.evaluate(() => {
        document.getElementById('chat').innerHTML = '<p id="live" dir="auto">Original English response</p>';
      });
      await sendRtlSettings(worker, tabId, rtlSettings);
      await page.waitForFunction(() => document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
    } else {
      await page.evaluate(count => {
        document.getElementById('chat').innerHTML = '<section id="history" data-message-author-role="assistant">' +
          Array.from({ length: count }, (_, i) => `<article><div><p class="history-message" id="history-${i}" style="height:70px">متن فارسی تاریخچه همراه <strong>UART</strong> و توضیح کامل ${i}</p></div></article>`).join('') + '</section>';
        window.scrollTo(0, document.body.scrollHeight);
        const target = document.elementFromPoint(innerWidth * 0.3, innerHeight * 0.62)?.closest('p');
        if (!target) throw new Error('Visible target not found');
        target.dataset.visibleTarget = 'yes';
        window.__visibleTarget = target.id;
        window.__originalHistoryNodes = [...document.querySelectorAll('.history-message')].map(p => p.firstChild);
      }, count);
    }
    await instrumentRtl(worker, tabId, 'reset');
    await worker.evaluate(({ tabId, count }) => chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', args: [count], func: count => {
        const fixer = window.RtlFixer;
        const scan = fixer.scanAndProcessSteps;
        fixer.scanAndProcessSteps = function* (node) {
          if (node.id === 'history') document.documentElement.setAttribute('data-history-started', 'yes');
          try { yield* scan.call(this, node); }
          finally {
            if (node.id === 'history' || node === document.body) {
              document.documentElement.setAttribute('data-history-finished-at', String(performance.now()));
            }
          }
        };
        const seen = new WeakSet();
        let completed = 0;
        const apply = fixer.applyRtlToElement;
        fixer.applyRtlToElement = function (node, ...args) {
          const result = apply.call(this, node, ...args);
          if (node.dir !== 'rtl') return result;
          const html = document.documentElement;
          if ((node.id === 'live' || node.dataset.visibleTarget) && !html.hasAttribute('data-priority-corrected-at')) {
            html.setAttribute('data-priority-corrected-at', String(performance.now()));
            html.setAttribute('data-history-at-priority', String(completed));
          }
          if (node.classList.contains('history-message') && !seen.has(node)) {
            seen.add(node);
            if (++completed === count) html.setAttribute('data-all-history-corrected-at', String(performance.now()));
          }
          return result;
        };
      }
    }), { tabId, count });
    if (mode === 'live-history') {
      await page.evaluate(count => {
        const history = document.createElement('section'); history.id = 'history';
        history.innerHTML = Array.from({ length: count }, (_, i) =>
          `<article><div><p class="history-message">متن فارسی تاریخچه همراه <strong>UART</strong> و توضیح کامل ${i}</p></div></article>`).join('');
        window.__originalHistoryNodes = [...history.querySelectorAll('p')].map(p => p.firstChild);
        const observer = new MutationObserver(() => {
          if (!document.documentElement.hasAttribute('data-history-started')) return;
          observer.disconnect();
          window.__priorityStart = performance.now();
          const live = document.getElementById('live');
          window.__liveNode = live.firstChild;
          live.firstChild.data = 'UART پاسخ فارسی درباره ارتباط سریال بین دستگاه‌ها';
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-history-started'] });
        window.__workStart = performance.now();
        document.getElementById('chat').prepend(history);
      }, count);
    } else {
      await page.evaluate(() => { window.__priorityStart = window.__workStart = performance.now(); });
      await sendRtlSettings(worker, tabId, rtlSettings);
    }
    await page.waitForFunction(() => {
      const html = document.documentElement;
      return html.hasAttribute('data-priority-corrected-at') && html.hasAttribute('data-all-history-corrected-at') &&
        html.hasAttribute('data-history-finished-at') && html.getAttribute('data-rtl-benchmark-open-scans') === '0';
    }, null, { timeout: 15000 });
    const rendering = await page.evaluate(() => {
      const html = document.documentElement;
      const correctedAt = Number(html.getAttribute('data-priority-corrected-at'));
      const completedAt = Math.max(correctedAt, Number(html.getAttribute('data-history-finished-at')),
        Number(html.getAttribute('data-all-history-corrected-at')));
      return {
        priorityLatencyMs: correctedAt - window.__priorityStart,
        completeElapsedMs: completedAt - window.__workStart,
        historyCorrectedBeforePriority: Number(html.getAttribute('data-history-at-priority')),
        finalHistoryCount: document.querySelectorAll('.history-message[dir="rtl"]').length,
        textNodesPreserved: window.__originalHistoryNodes.every(node => node.isConnected) &&
          (!window.__liveNode || window.__liveNode === document.getElementById('live').firstChild),
        visibleTarget: window.__visibleTarget || null,
      };
    });
    const metrics = await instrumentRtl(worker, tabId, 'metrics');
    return { mode, count, ...rendering,
      scanCpuMs: metrics.scanTasks.reduce((sum, task) => sum + task.durationMs, 0),
      maxScanTaskMs: Math.max(0, ...metrics.scanTasks.map(task => task.durationMs)),
      iteratorSteps: metrics.iteratorSteps, applications: metrics.applications,
    };
  } finally { await page.close(); }
}

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --name=value');
  return [match[1], match[2]];
}));
if (!args.before || !args.after) throw new Error('--before and --after snapshots required');
const runs = Number(args.runs || 5), count = Number(args.nodes || 1000);
if (![runs, count].every(value => Number.isInteger(value) && value > 0)) throw new Error('Invalid workload');
const snapshots = { before: path.resolve(root, args.before), after: path.resolve(root, args.after) };
const files = ['manifest.json', 'content/constants.js', 'content/main.js', 'content/dom.js', 'content/utils.js', 'content/ui.js', 'content/styles.js'];
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const hashes = async directory => Object.fromEntries(await Promise.all(files.map(async file => [file, await digest(path.join(directory, file))])));
const sources = { before: await hashes(snapshots.before), after: await hashes(snapshots.after) };
const harnessFiles = ['tools/rtl-benchmark.mjs', 'tools/rtl-priority-benchmark.mjs'];
const harness = Object.fromEntries(await Promise.all(harnessFiles.map(async file => [file, await digest(path.join(root, file))])));
const contexts = {}, results = [];
try {
  for (const variant of ['before', 'after']) contexts[variant] = await launchRtlContext(snapshots[variant]);
  for (let run = 1; run <= runs; run++) {
    for (const mode of ['live-history', 'visible-history']) {
      for (const variant of run % 2 ? ['before', 'after'] : ['after', 'before']) {
        const result = await measure(contexts[variant], mode, count, `${variant}-${run}-${mode}`);
        if (result.finalHistoryCount !== count || !result.textNodesPreserved) throw new Error('Correctness failure');
        results.push({ variant, run, ...result });
      }
    }
    console.log(JSON.stringify({ completedPair: run, totalPairs: runs }));
  }
  for (const variant of ['before', 'after']) {
    if (JSON.stringify(sources[variant]) !== JSON.stringify(await hashes(snapshots[variant]))) throw new Error('Snapshot changed');
  }
  for (const file of harnessFiles) if (harness[file] !== await digest(path.join(root, file))) throw new Error('Harness changed');
  const median = values => {
    const sorted = values.toSorted((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const metrics = ['priorityLatencyMs', 'completeElapsedMs', 'historyCorrectedBeforePriority', 'scanCpuMs', 'maxScanTaskMs', 'iteratorSteps', 'applications'];
  const summaries = Object.fromEntries(['live-history', 'visible-history'].map(mode => [mode,
    Object.fromEntries(['before', 'after'].map(variant => [variant, Object.fromEntries(metrics.map(metric => [metric,
      median(results.filter(result => result.mode === mode && result.variant === variant).map(result => result[metric]))]))]))]));
  const report = { createdAt: new Date().toISOString(), chromium: contexts.after.browser()?.version(), node: process.version,
    snapshots, sources, harness, workload: { runs, paragraphs: count }, summaries, results,
    methodology: 'Alternating paired, sequential workloads in real Chromium with full frozen extensions. One live edit after history scanning starts; separately, activation on a long chat scrolled to its last viewport. Native DOM and text costs, no artificial per-node delay.',
    limitations: ['Synthetic site markup does not prove live-site compatibility.', 'Priority latency is a direction-write timestamp, not keyboard-to-paint latency.', 'Scan CPU covers instrumented iterator tasks; viewport hit testing and queue preparation preceding the first iterator are not included.', 'Complete elapsed time includes source activation and renderer scheduling and is reported separately from priority latency.'] };
  const output = path.resolve(root, args.output || 'logs/rtl-priority-20261017/comparison-priority.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, summaries }));
} finally { for (const context of Object.values(contexts)) await context.close(); }
