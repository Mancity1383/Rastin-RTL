// Paired, alternating full-extension runs. No two browsers are measured in
// parallel; the same frozen harness and workloads exercise both snapshots.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchRtlContext, measureRtlScenario, root } from './rtl-benchmark.mjs';
import { burstModes, measureBurstScenario } from './rtl-stream-benchmark.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --name=value');
  return [match[1], match[2]];
}));
if (!args.before || !args.after) throw new Error('--before and --after snapshots are required');
const snapshots = { before: path.resolve(root, args.before), after: path.resolve(root, args.after) };
const runCount = Number(args.runs || 5), nodes = Number(args.nodes || 1000), burstNodes = Number(args['burst-nodes'] || 100);
if (![runCount, nodes, burstNodes].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid workload');
const files = ['manifest.json', 'background.js', 'content/constants.js', 'content/main.js', 'content/dom.js', 'content/utils.js'];
const hashes = async directory => Object.fromEntries(await Promise.all(files.map(async file =>
  [file, createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex')])));
const sources = { before: await hashes(snapshots.before), after: await hashes(snapshots.after) };
const harness = {};
for (const file of ['tools/rtl-benchmark.mjs', 'tools/rtl-stream-benchmark.mjs', 'tools/rtl-compare.mjs']) {
  harness[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const contexts = {};
const results = [];
try {
  for (const variant of ['before', 'after']) contexts[variant] = await launchRtlContext(snapshots[variant]);
  for (let run = 1; run <= runCount; run++) {
    const order = run % 2 ? ['before', 'after'] : ['after', 'before'];
    for (const mode of ['activation', 'subtree', 'stream', ...burstModes]) {
      for (const variant of order) {
        const context = contexts[variant];
        const suffix = `${variant}-${run}-${mode}`;
        const result = burstModes.includes(mode)
          ? await measureBurstScenario(context, mode, { count: burstNodes, suffix })
          : await measureRtlScenario(context, mode, nodes, suffix);
        results.push({ variant, run, ...result });
      }
    }
    console.log(JSON.stringify({ completedPair: run, totalPairs: runCount }));
  }
  for (const variant of ['before', 'after']) {
    if (JSON.stringify(sources[variant]) !== JSON.stringify(await hashes(snapshots[variant]))) throw new Error('Snapshot changed during measurement');
  }
  for (const file of Object.keys(harness)) {
    if (harness[file] !== createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')) throw new Error('Harness changed during measurement');
  }
  const median = values => { const sorted = values.toSorted((a,b) => a-b); const mid = Math.floor(sorted.length/2); return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; };
  const metrics = ['elapsedMs', 'timeToRtlMs', 'finalUpdateLatencyMs', 'observerCpuMs', 'maxObserverCallbackMs', 'scanCpuMs', 'maxScanTaskMs', 'maxRafGapMs', 'longTaskCount', 'getComputedStyleCalls', 'textTraversalVisits', 'elementTraversalVisits', 'applications', 'iteratorSteps', 'inputDispatchP95Ms'];
  const summaries = Object.fromEntries(['activation', 'subtree', 'stream', ...burstModes].map(mode => [mode,
    Object.fromEntries(['before', 'after'].map(variant => {
      const subset = results.filter(r => r.variant === variant && r.mode === mode);
      return [variant, Object.fromEntries(metrics.filter(metric => subset.every(r => Number.isFinite(r[metric]))).map(metric => [metric, median(subset.map(r => r[metric]))]))];
    }))]));
  const report = { createdAt: new Date().toISOString(), nodeVersion: process.version, chromium: contexts.after.browser()?.version(),
    snapshots, sources, harness, workload: { runs: runCount, paragraphs: nodes, burstParagraphs: burstNodes },
    methodology: 'Alternating paired runs in actual Chromium with the full extension. One workload is measured at a time. No simulated processing delay or CPU cost. Other optional extension tools are disabled. Both immutable snapshots use identical fixture, instrumentation and source hashes. Medians are reported separately for initial activation, lazy insertion, normal streaming and three formatted token-burst workloads.',
    limitations: ['Synthetic fixtures do not guarantee equivalent speedups on every live site.', 'Elapsed streaming includes fixed animation-frame pacing; CPU time is a separate metric.', 'Renderer frame gaps include native DOM layout, text shaping and rendering, not only extension work.', 'Synthetic input dispatch exercises the actual direction handler but is not a physical keyboard-to-paint latency measurement.'],
    summaries, results };
  const output = path.resolve(root, args.output || 'logs/rtl-stream-20261017/comparison.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, summaries }));
} finally { for (const context of Object.values(contexts)) await context.close(); }
