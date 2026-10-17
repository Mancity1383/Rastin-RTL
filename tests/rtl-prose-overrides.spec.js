/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

test('Automatic RTL prose reasserts direction after a renderer LTR reset and restores that latest value', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'owned-auto-ltr-reset');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<p id="automatic-prose" dir="AUTO">UART یک روش ارتباط سریال بین دو دستگاه است.</p>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#automatic-prose')).toHaveAttribute('dir', 'rtl');
  await page.locator('#automatic-prose').evaluate(p => p.setAttribute('dir', 'LTR'));
  await expect(page.locator('#automatic-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#automatic-prose')).toHaveCSS('direction', 'rtl');
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#automatic-prose')).toHaveAttribute('dir', 'LTR');
});

test('Forced right alignment resolves explicit LTR prose while preserving inline, table and editor intent', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'explicit-prose-right-align');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `
      <h2 id="generated-heading" dir="ltr">UART در ارتباط سریال</h2>
      <p id="generated-prose" dir="ltr">این توضیح فارسی درباره <strong id="explicit-inline" dir="ltr">UART</strong> است.</p>
      <table><tr><td id="explicit-cell" dir="ltr">توضیح فارسی با جهت مشخص جدول</td></tr></table>
      <div id="explicit-editor" contenteditable="true" dir="ltr">متن فارسی قابل ویرایش</div>
      <p id="english-prose" dir="ltr">UART uses asynchronous serial communication.</p>`;
  });
  await sendRtlSettings(worker, tabId, { ...rtlSettings, forceRightAlign: true, inputsAutoDir: false });
  for (const id of ['generated-heading', 'generated-prose']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator(`#${id}`)).toHaveCSS('direction', 'rtl');
    await expect(page.locator(`#${id}`)).toHaveCSS('text-align', 'right');
  }
  for (const id of ['explicit-inline', 'explicit-cell', 'explicit-editor', 'english-prose']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('dir', 'ltr');
    await expect(page.locator(`#${id}`)).toHaveCSS('direction', 'ltr');
  }
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#generated-prose')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#generated-heading')).toHaveAttribute('dir', 'ltr');
});

test('Resolved RTL prose overrides inline important direction and plaintext bidi and restores exact styles', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'important-prose-bidi');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'important-prose'; p.dir = 'auto';
    p.style.cssText = 'direction: ltr !important; unicode-bidi: plaintext !important; text-align: left; padding-left: 13px;';
    p.innerHTML = '<strong>UART</strong> یک روش ارتباط سریال ناهمگام بین دو دستگاه است.';
    document.getElementById('chat').append(p);
    window.__importantOriginalStyle = p.getAttribute('style');
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#important-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#important-prose')).toHaveCSS('direction', 'rtl');
  await expect(page.locator('#important-prose')).toHaveCSS('unicode-bidi', 'isolate');
  await sendRtlSettings(worker, tabId, { enabled: false });
  expect(await page.locator('#important-prose').getAttribute('style')).toBe(await page.evaluate(() => window.__importantOriginalStyle));
  await expect(page.locator('#important-prose')).toHaveAttribute('dir', 'auto');
});

test('An existing RTL paragraph becoming a math root releases its managed prose direction', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'managed-math-root');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<p id="becoming-math" dir="auto">UART یک توضیح فارسی درباره فرمول است.</p>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#becoming-math')).toHaveAttribute('dir', 'rtl');
  await page.locator('#becoming-math').evaluate(p => p.setAttribute('role', 'math'));
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.scanAndProcess(document.getElementById('becoming-math'))
  }), tabId);
  await expect(page.locator('#becoming-math')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('#becoming-math')).not.toHaveClass(/rtl-fixer-(?:target|rtl-detected)/);
  expect(await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer._originalElementState.has(document.getElementById('becoming-math'))
  }).then(results => results[0].result), tabId)).toBe(false);
});
