/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext(process.env.RTL_TEST_EXTENSION);
    try { await use(context); } finally { await context.close(); }
  }
});

const uartHtml = `
  <h2 data-block="heading"><strong>UART</strong> در ارتباط سریال</h2>
  <p data-block="intro"><strong>UART (Universal Asynchronous Receiver/Transmitter)</strong> یک روش ارتباط سریال ناهمگام (<strong>Asynchronous</strong>) بین دو دستگاهه.</p>
  <p data-block="clock"><strong>نکته کوییزی:</strong> برخلاف <strong>SPI</strong> و <strong>I2C</strong> به خط <strong>Clock</strong> مشترک نیاز نداره و داده‌ها رو به‌صورت سریال (بیت به بیت) منتقل می‌کنه.</p>
  <ul data-block="list">
    <li data-block="tx"><strong>TX:</strong> ارسال داده</li>
    <li data-block="rx"><strong>RX:</strong> دریافت داده</li>
    <li data-block="gnd"><strong>GND:</strong> زمین مشترک</li>
    <li data-block="baud"><strong>Baud Rate:</strong> سرعت انتقال داده (مثلاً 9600)</li>
    <li data-block="no-clock"><strong>بدون Clock مشترک</strong> کار می‌کنه.</li>
  </ul>
  <p data-block="summary">مثلاً ارتباط بین <strong>Arduino</strong> و ماژول <strong>GPS</strong>.</p>
  <p data-block="english">UART uses asynchronous serial communication with a start bit and stop bit.</p>`;

const variants = ['dir-auto-plaintext', 'explicit-ltr', 'inline-important-ltr'];
const persianBlocks = ['heading', 'intro', 'clock', 'tx', 'rx', 'gnd', 'baud', 'no-clock', 'summary'];

async function installUartFixture(page, variant) {
  await page.evaluate(({ html, variant }) => {
    const style = document.createElement('style');
    style.textContent = `body{background:#f6f7fa;color:#202123;font-family:system-ui;margin:24px}
      .uart-columns{display:grid;grid-template-columns:720px 720px;gap:28px;align-items:start}
      .uart-answer{width:720px;box-sizing:border-box;padding:24px;background:white;border:1px solid #ddd;border-radius:12px;font:16px/1.6 system-ui}
      .uart-answer p,.uart-answer h2{margin:0 0 18px}.uart-answer ul{margin:0 0 18px;padding-left:28px}
      .uart-answer li{margin:0 0 10px}.uart-answer code{font:14px ui-monospace;unicode-bidi:isolate;direction:ltr}
      .uart-actual :is(p,h2,li){text-align:left;unicode-bidi:plaintext}
      .uart-reference :is(p,h2,li){direction:rtl;unicode-bidi:isolate;text-align:right}
      .uart-reference ul{direction:rtl;padding-left:0;padding-right:28px}
      .uart-reference [data-block="english"]{direction:ltr;text-align:left}`;
    document.head.append(style);
    const columns = document.createElement('div'); columns.className = 'uart-columns';
    const actual = document.createElement('article'); actual.id = 'uart-actual'; actual.className = 'uart-answer uart-actual markdown prose'; actual.setAttribute('dir', 'auto'); actual.innerHTML = html;
    const reference = document.createElement('article'); reference.id = 'uart-reference'; reference.className = 'uart-answer uart-reference'; reference.setAttribute('data-rastin-reader-ui', ''); reference.innerHTML = html;
    actual.querySelectorAll('p,h2,li').forEach(block => {
      block.setAttribute('dir', variant === 'explicit-ltr' ? 'ltr' : 'auto');
      if (variant === 'inline-important-ltr') block.style.cssText = 'direction:ltr!important;unicode-bidi:plaintext!important;text-align:left';
    });
    reference.querySelectorAll('p,h2,li').forEach(block => block.setAttribute('dir', block.dataset.block === 'english' ? 'ltr' : 'rtl'));
    columns.append(actual, reference); document.getElementById('chat').append(columns);
    const ready = document.createElement('p'); ready.id = 'uart-ready'; ready.textContent = 'متن فارسی آماده است'; document.getElementById('chat').append(ready);
    const walker = document.createTreeWalker(actual, NodeFilter.SHOW_TEXT), original = []; let node;
    while ((node = walker.nextNode())) original.push({ node, parent: node.parentNode, value: node.data });
    window.__uartOriginal = original;
    window.__uartOriginalBlocks = [...actual.querySelectorAll('p,h2,li,ul')].map(element => ({
      element, dir: element.getAttribute('dir'), style: element.getAttribute('style')
    }));
  }, { html: uartHtml, variant });
}

async function uartState(page, worker, tabId) {
  const blocks = await page.locator('#uart-actual').evaluate(actual => [...actual.querySelectorAll('[data-block]')].map(element => {
    const computed = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { block: element.dataset.block, tag: element.tagName, dir: element.getAttribute('dir'), className: element.className,
      direction: computed.direction, unicodeBidi: computed.unicodeBidi, textAlign: computed.textAlign,
      width: rect.width, text: element.textContent };
  }));
  const runtime = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => ({
      active: window.RtlFixer._isActive, config: { enabled: window.RtlFixer.config.enabled,
        globalEnabled: window.RtlFixer.config.globalEnabled, alignmentMode: window.RtlFixer.config.alignmentMode,
        forceRightAlign: window.RtlFixer.config.forceRightAlign },
      directions: [...document.querySelectorAll('#uart-actual :is(p,h2,li)')].map(element => ({
        block: element.dataset.block, isRtlProse: window.RtlFixer.isRtlProse(window.RtlFixer.getDirectionalText(element)),
        original: window.RtlFixer._originalElementState.get(element)?.dir,
        writtenDir: window.RtlFixer._originalElementState.get(element)?.writtenDir
      }))
    })
  }).then(results => results[0].result), tabId);
  const geometry = await page.evaluate(() => {
    const positions = root => [...root.querySelectorAll('p,h2,li')].filter(element => element.dataset.block !== 'english').map(element => {
      const parentRect = element.getBoundingClientRect(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const result = []; let node;
      while ((node = walker.nextNode())) {
        for (let index = 0; index < node.data.length; index++) {
          if (/\s/.test(node.data[index])) continue;
          const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          result.push({ left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width });
        }
      }
      return { block: element.dataset.block, rects: result };
    });
    const actual = positions(document.getElementById('uart-actual')), reference = positions(document.getElementById('uart-reference'));
    return actual.map((entry, blockIndex) => ({ block: entry.block, glyphCount: entry.rects.length,
      maxGlyphDelta: Math.max(0, ...entry.rects.map((rect, i) => {
        const expected = reference[blockIndex]?.rects[i];
        return expected ? Math.max(Math.abs(rect.left - expected.left), Math.abs(rect.top - expected.top), Math.abs(rect.width - expected.width)) : Infinity;
      })) }));
  });
  return { blocks, runtime, geometry };
}

test('UART Persian answer remains one RTL flow despite ChatGPT direction and plaintext defaults', async ({ context }, testInfo) => {
  await testInfo.setTimeout(60000);
  const reports = [], output = path.resolve(process.env.RTL_CHATGPT_REPORT || 'logs/rtl-60/chatgpt-layout.json');
  await mkdir(path.dirname(output), { recursive: true });
  for (const variant of variants) {
    const { page, worker, tabId } = await openRtlFixture(context, 'uart-' + variant);
    await page.setViewportSize({ width: 1600, height: 1400 });
    try {
      await installUartFixture(page, variant);
      await sendRtlSettings(worker, tabId, { ...rtlSettings, forceRightAlign: true });
      await expect(page.locator('#uart-ready')).toHaveAttribute('dir', 'rtl');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
      const state = await uartState(page, worker, tabId);
      const screenshot = output.replace(/\.json$/i, '-' + variant + '.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      reports.push({ variant, screenshot, ...state });
      expect(await page.evaluate(() => window.__uartOriginal.every(({ node, parent, value }) => node.isConnected && node.parentNode === parent && node.data === value))).toBe(true);
      await sendRtlSettings(worker, tabId, { enabled: false });
      expect(await page.evaluate(() => window.__uartOriginalBlocks.every(({ element, dir, style }) => element.getAttribute('dir') === dir && element.getAttribute('style') === style))).toBe(true);
    } finally { await page.close(); }
  }
  await writeFile(output, JSON.stringify({ reports }, null, 2) + '\n');
  const wrong = reports.flatMap(report => report.blocks.filter(block => persianBlocks.includes(block.block) &&
    (block.direction !== 'rtl' || block.unicodeBidi !== 'isolate' || block.textAlign !== 'right')).map(block => ({ variant: report.variant, ...block })));
  console.log('UART layout blocks with incorrect direction/bidi/alignment:', JSON.stringify(wrong.map(({ variant, block, dir, direction, unicodeBidi, textAlign }) => ({ variant, block, dir, direction, unicodeBidi, textAlign }))));
  if (!process.env.RTL_CHATGPT_ALLOW_FAILURES) {
    expect(wrong).toEqual([]);
    for (const report of reports) {
      expect(report.blocks.find(block => block.block === 'list').direction).toBe('rtl');
      expect(report.blocks.find(block => block.block === 'english').direction).toBe('ltr');
      for (const block of report.geometry) expect(block.maxGlyphDelta, `${report.variant}: ${block.block}`).toBeLessThan(.05);
    }
  }
});

test('Re-enabling RTL and React resetting a Persian UART block to ltr cannot leave it LTR', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'uart-react-reset');
  try {
    await installUartFixture(page, 'dir-auto-plaintext');
    await sendRtlSettings(worker, tabId, { ...rtlSettings, forceRightAlign: true });
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveCSS('direction', 'rtl');
    await sendRtlSettings(worker, tabId, { enabled: false });
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveAttribute('dir', 'auto');
    await sendRtlSettings(worker, tabId, { ...rtlSettings, forceRightAlign: true });
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveCSS('direction', 'rtl');
    await page.locator('#uart-actual [data-block="intro"]').evaluate(element => { element.dir = 'ltr'; });
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveCSS('direction', 'rtl');
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveAttribute('dir', 'rtl');
    await sendRtlSettings(worker, tabId, { enabled: false });
    // Preserve the latest direction supplied by React after the extension stops.
    await expect(page.locator('#uart-actual [data-block="intro"]')).toHaveAttribute('dir', 'ltr');
  } finally { await page.close(); }
});
