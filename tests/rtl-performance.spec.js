/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import {
  launchRtlContext, openRtlFixture, measureRtlScenario, instrumentRtl,
  sendRtlSettings, rtlSettings, appendChat
} from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

for (const mode of ['activation', 'subtree']) {
  test(`RTL ${mode} yields inside one large nested chat subtree`, async ({ context }) => {
    const result = await measureRtlScenario(context, mode, 1000);
    const workChunks = result.scanTasks.filter(chunk => chunk.iteratorSteps > 0);
    expect(result.finalRtlCount).toBe(1000);
    expect(result.originalTextNodesConnected).toBe(true);
    expect(result.inputDirectionMismatches).toBe(0);
    expect(result.inputEvents).toBeGreaterThan(1);
    // Real scans, no per-node busy wait. A whole-subtree synchronous scan fails
    // these structural assertions even on unusually fast/slow CI hardware.
    expect(result.iteratorSteps).toBeGreaterThan(1000);
    expect(workChunks.length).toBeGreaterThan(1);
    expect(Math.max(...workChunks.map(chunk => chunk.iteratorSteps))).toBeLessThanOrEqual(500);
    expect(result.outsideScanApplications).toBe(0);
    expect(Math.max(...workChunks.map(chunk => chunk.applications))).toBeLessThan(1000);
  });
}

test('Streaming changes only revisit changed messages while input direction remains responsive', async ({ context }) => {
  const result = await measureRtlScenario(context, 'stream', 1000);
  expect(result.completedUpdates).toBe(90);
  expect(result.finalRtlCount).toBe(970);
  expect(result.inputEvents).toBeGreaterThanOrEqual(90);
  expect(result.inputDirectionMismatches).toBe(0);
  expect(result.originalTextNodesConnected).toBe(true);
  // Bounds on actual work catch accidental whole-chat rescans independently
  // of elapsed time, refresh rate, scheduler coalescing or machine speed.
  expect(result.getComputedStyleCalls).toBeLessThan(500);
  expect(result.textTraversalVisits).toBeLessThan(3000);
  expect(result.applications).toBeLessThan(500);
});

test('English to Persian to English restores the original direction and inline styles', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'language-transition');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'changing-prose';
    p.setAttribute('dir', 'auto');
    p.style.cssText = 'text-align: center; padding-left: 13px;';
    p.append('Original English text');
    document.getElementById('chat').append(p);
  });
  const original = await page.locator('#changing-prose').evaluate(p => ({ dir: p.getAttribute('dir'), style: p.getAttribute('style') }));
  await sendRtlSettings(worker, tabId, rtlSettings);
  await page.locator('#changing-prose').evaluate(p => { p.firstChild.data = 'این متن فارسی کامل برای بررسی تغییر جهت است'; });
  await expect(page.locator('#changing-prose')).toHaveAttribute('dir', 'rtl');
  await page.locator('#changing-prose').evaluate(p => { p.firstChild.data = 'English content replaces the Persian response'; });
  await expect(page.locator('#changing-prose')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('#changing-prose')).not.toHaveClass(/rtl-fixer-target/);
  expect(await page.locator('#changing-prose').evaluate(p => ({ dir: p.getAttribute('dir'), style: p.getAttribute('style') }))).toEqual(original);
  await page.close();
});

test('An unchanged RTL rescan makes no repeated direction, class or style writes', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'unchanged');
  await appendChat(page, 30);
  await sendRtlSettings(worker, tabId, rtlSettings);
  await page.waitForFunction(() => document.querySelectorAll('.benchmark-message[dir="rtl"]').length === 30 &&
    document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
  await page.evaluate(() => {
    window.__repeatScanWrites = [];
    window.__repeatScanObserver = new MutationObserver(records => window.__repeatScanWrites.push(...records));
    window.__repeatScanObserver.observe(document.getElementById('thread'), {
      subtree: true, attributes: true, attributeFilter: ['dir', 'class', 'style']
    });
  });
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.scanAndProcess(document.getElementById('thread'))
  }), tabId);
  expect(await page.evaluate(() => {
    const records = [...window.__repeatScanWrites, ...window.__repeatScanObserver.takeRecords()];
    window.__repeatScanObserver.disconnect();
    return records.map(record => ({ id: record.target.id, attribute: record.attributeName }));
  })).toEqual([]);
  await page.close();
});

test('Digits and bionic reading restore original text together when RTL is disabled', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'digits-bionic');
  const original = 'این پیام شماره 123 با متن فارسی و مقدار 45 است';
  await page.evaluate(original => {
    const p = document.createElement('p');
    p.id = 'transformed-prose'; p.textContent = original; document.getElementById('chat').append(p);
  }, original);
  await sendRtlSettings(worker, tabId, { ...rtlSettings, persianDigits: true, bionicTextEnabled: true });
  await expect(page.locator('#transformed-prose')).toHaveText('این پیام شماره ۱۲۳ با متن فارسی و مقدار ۴۵ است');
  await expect.poll(() => page.locator('#transformed-prose .rtl-fixer-bionic').count()).toBeGreaterThan(0);
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#transformed-prose')).toHaveText(original);
  await expect(page.locator('#transformed-prose .rtl-fixer-bionic')).toHaveCount(0);
  expect(await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer._managedDigitNodes.size
  }).then(results => results[0].result), tabId)).toBe(0);
  await page.close();
});

test('Chunked RTL preserves code, math, table columns, list fixes and editable inputs', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'layout');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `
      <div class="response">
        <p id="mixed">توضیح فارسی همراه فرمول <span role="math"><span id="math" class="katex"><span class="katex-html">F = a + b</span></span></span> و کد <code id="inline-code">const value = 123;</code></p>
        <pre id="code-block"><code>// فارسی in code\nconst count = 123;</code></pre>
        <ul id="list" style="padding-left: 40px"><li>مورد اول فارسی</li><li>مورد دوم فارسی</li></ul>
        <table id="table" style="width: 600px; table-layout: fixed; direction: ltr"><thead><tr><th>First</th><th>Second</th></tr></thead><tbody><tr><td id="persian-cell">توضیح فارسی</td><td id="english-cell">English model</td></tr></tbody></table>
        <input id="persian-input" dir="auto" value="سلام دنیا"><input id="english-input" dir="auto" value="English text">
      </div>`;
    window.__layoutNodes = [...document.getElementById('chat').querySelectorAll('*')];
  });
  const before = await page.locator('#table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left));
  const codeText = await page.locator('#code-block').textContent();
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#mixed')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#list')).toHaveCSS('padding-left', '0px');
  await expect(page.locator('#list')).toHaveCSS('padding-inline-start', '40px');
  await expect(page.locator('#persian-cell')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#english-cell')).toHaveCSS('direction', 'ltr');
  await expect(page.locator('#math')).toHaveCSS('direction', 'ltr');
  await expect(page.locator('#math')).toHaveCSS('unicode-bidi', 'isolate');
  await expect(page.locator('#persian-input')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#english-input')).toHaveAttribute('dir', 'ltr');
  expect(await page.locator('#code-block').textContent()).toBe(codeText);
  await expect(page.locator('#code-block')).not.toHaveClass(/rtl-fixer-target/);
  await expect(page.locator('#inline-code')).not.toHaveClass(/rtl-fixer-target/);
  const after = await page.locator('#table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => window.__layoutNodes.every(node => node.isConnected))).toBe(true);
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#list')).toHaveCSS('padding-left', '40px');
  await expect(page.locator('#persian-input')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('#english-input')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('#mixed')).not.toHaveAttribute('dir', /.+/);
  await page.close();
});

test('Disabling RTL cancels work queued for an entire added subtree', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'cancel');
  await sendRtlSettings(worker, tabId, rtlSettings);
  // Wait for initial activation through a real processed element before taking
  // control of the next posted tasks. No scheduler timeout/sleep assumptions.
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'ready-marker'; p.textContent = 'متن فارسی آماده'; document.body.append(p);
  });
  await expect(page.locator('#ready-marker')).toHaveAttribute('dir', 'rtl');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const gate = window.__rtlIdleGate = { nextId: 100000, callbacks: [], cancelled: [], messages: [], frames: [] };
      window.requestAnimationFrame = callback => { gate.frames.push(callback); return ++gate.nextId; };
      const cancelFrame = window.cancelAnimationFrame;
      window.cancelAnimationFrame = id => { gate.cancelled.push(id); cancelFrame.call(window, id); };
      window.requestIdleCallback = callback => {
        const id = ++gate.nextId;
        gate.callbacks.push({ id, callback });
        return id;
      };
      const cancel = window.cancelIdleCallback;
      window.cancelIdleCallback = id => { gate.cancelled.push(id); cancel.call(window, id); };
      const postMessage = MessagePort.prototype.postMessage;
      gate.deliverMessages = () => { for (const { port, args } of gate.messages) postMessage.apply(port, args); };
      MessagePort.prototype.postMessage = function (...args) {
        if (typeof args[0] === 'number') { gate.messages.push({ port: this, args }); return; }
        return postMessage.apply(this, args);
      };
    }
  }), tabId);
  await instrumentRtl(worker, tabId, 'reset');
  await appendChat(page, 1000);
  await expect.poll(() => worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.__rtlIdleGate.callbacks.length + window.__rtlIdleGate.messages.length + window.__rtlIdleGate.frames.length
  }).then(results => results[0].result), tabId)).toBeGreaterThan(0);
  await sendRtlSettings(worker, tabId, { enabled: false });
  const cancelled = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const gate = window.__rtlIdleGate;
      // Even a stale callback delivered after cancellation must remain inert.
      for (const { callback } of gate.callbacks) callback({ didTimeout: true, timeRemaining: () => 50 });
      for (const callback of gate.frames) callback(performance.now());
      gate.deliverMessages();
      return { cancelled: gate.cancelled.length, messages: gate.messages.length, active: window.RtlFixer._isActive };
    }
  }).then(results => results[0].result), tabId);
  expect(cancelled.active).toBe(false);
  expect(cancelled.cancelled + cancelled.messages).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await instrumentRtl(worker, tabId, 'metrics')).applications).toBe(0);
  await expect(page.locator('.benchmark-message[dir="rtl"]')).toHaveCount(0);
  await page.close();
});
