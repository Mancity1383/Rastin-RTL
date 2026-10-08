/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetUrl = 'https://example.com/delayed';
const pageKey = 'example.com/delayed';
const selectedText = 'target selected passage';
const highlightId = 'navigation-delayed';
const storageKey = 'rtl_fixer_hl_example.com';
const targetMarkup = '<!doctype html><html><head><meta charset="UTF-8"></head>' +
  '<body><div style="height:2200px"></div></body></html>';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
      args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath]
    });
    try { await use(context); } finally { await context.close(); }
  }
});

const workerFor = async context => context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
async function setup(context) {
  const worker = await workerFor(context);
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(({ extensionId, targetUrl, pageKey, selectedText, highlightId, storageKey }) =>
    chrome.storage.local.set({
      enabled: true, adBlockEnabled: false,
      ['site_config_' + extensionId]: { enabled: true, highlightEnabled: true },
      'site_config_example.com': { enabled: true, highlightEnabled: true },
      [storageKey]: [{
        id: highlightId, text: selectedText, url: targetUrl, pageKey, color: '#bbf7d0', timestamp: 1,
        startPath: '//*[@id="delayed"]', endPath: '//*[@id="delayed"]',
        startNodeIndex: 0, endNodeIndex: 0, startOffset: 0, endOffset: selectedText.length
      }]
    }), { extensionId, targetUrl, pageKey, selectedText, highlightId, storageKey });
  await context.route('https://example.com/**', route => route.fulfill({
    contentType: 'text/html', body: targetMarkup
  }));
  return { worker, extensionId };
}
async function openDashboard(context, extensionId) {
  const popup = await context.newPage();
  await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  await popup.locator('#highlight-filter-group [data-value="all"]').evaluate(button => button.click());
  await expect(popup.locator('.highlight-card-text')).toHaveText(selectedText);
  return popup;
}
async function targetTabId(worker) {
  return worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, targetUrl);
}
const sessionKeyFor = tabId => 'rastin_pending_highlight_tab_' + tabId;
const readPending = (worker, tabId) => worker.evaluate(async key =>
  (await chrome.storage.session.get(key))[key], sessionKeyFor(tabId));
async function messageFromTab(worker, tabId, message) {
  return worker.evaluate(async ({ tabId, message }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: payload => chrome.runtime.sendMessage(payload), args: [message]
    });
    return results[0].result;
  }, { tabId, message });
}
async function addDelayedTarget(page) {
  await page.evaluate(text => {
    const paragraph = document.createElement('p');
    paragraph.id = 'delayed';
    paragraph.textContent = text + ' with useful context afterwards to identify its position.';
    document.body.append(paragraph);
  }, selectedText);
}
const restoredTexts = page => page.evaluate(() => [...CSS.highlights.entries()]
  .filter(([name]) => name.startsWith('rastin-color-'))
  .flatMap(([, highlight]) => [...highlight].map(range => range.toString())));

test('navigation survives popup closure, waits for delayed text, acknowledges scroll and reuses the target tab', async ({ context }) => {
  const { worker, extensionId } = await setup(context);
  const popup = await openDashboard(context, extensionId);
  const created = context.waitForEvent('page');
  await popup.locator('.highlight-card-btn').filter({ hasText: 'نمایش' }).evaluate(button => button.click());
  const target = await created;
  await popup.close();
  await target.waitForURL(targetUrl);
  const tabId = await targetTabId(worker);
  await expect.poll(() => readPending(worker, tabId)).toMatchObject({ id: highlightId, pageKey, tabId });
  await expect.poll(() => restoredTexts(target)).toEqual([]);
  // The first restore has no source text. Its handoff must remain pending.
  await target.waitForTimeout(650);
  expect(await readPending(worker, tabId)).toMatchObject({ id: highlightId, pageKey });
  await addDelayedTarget(target);
  await expect.poll(() => restoredTexts(target)).toEqual([selectedText]);
  await expect.poll(() => target.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await expect.poll(() => readPending(worker, tabId)).toBeUndefined();

  const secondPopup = await openDashboard(context, extensionId);
  const result = await secondPopup.evaluate(({ id, url }) =>
    chrome.runtime.sendMessage({ action: 'openSavedHighlight', id, url }), { id: highlightId, url: targetUrl });
  expect(result).toMatchObject({ ok: true, tabId });
  await expect.poll(() => readPending(worker, tabId)).toBeUndefined();
  expect(await worker.evaluate(async url => (await chrome.tabs.query({ url })).length, targetUrl)).toBe(1);
});

test('pending navigation is scoped to its tab and route, rejects stale acknowledgements and cleans up closed tabs', async ({ context }) => {
  const { worker, extensionId } = await setup(context);
  const popup = await openDashboard(context, extensionId);
  const created = context.waitForEvent('page');
  await popup.locator('.highlight-card-btn').filter({ hasText: 'نمایش' }).evaluate(button => button.click());
  const target = await created;
  await target.waitForURL(targetUrl);
  const tabId = await targetTabId(worker);
  await expect.poll(() => readPending(worker, tabId)).toMatchObject({ id: highlightId, pageKey });
  const firstPending = await readPending(worker, tabId);
  const action = 'consumePendingHighlightNavigation';
  expect(await messageFromTab(worker, tabId, { action, pageKey })).toMatchObject({
    ok: true, pending: { id: highlightId, requestId: firstPending.requestId }
  });
  for (const acknowledgement of [
    { acknowledgeId: 'wrong-highlight', requestId: firstPending.requestId },
    { acknowledgeId: highlightId, requestId: 'stale-request' }
  ]) {
    expect(await messageFromTab(worker, tabId, { action, pageKey, ...acknowledgement }))
      .toMatchObject({ ok: true, acknowledged: false });
  }
  expect(await messageFromTab(worker, tabId, { action, pageKey: 'example.com/other' }))
    .toMatchObject({ ok: true, pending: null });
  const other = await context.newPage();
  await other.goto('https://example.com/other');
  const otherTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://example.com/other' }))[0].id);
  expect(await messageFromTab(worker, otherTabId, { action, pageKey }))
    .toMatchObject({ ok: true, pending: null });
  expect(await readPending(worker, tabId)).toMatchObject({ requestId: firstPending.requestId });

  await popup.evaluate(({ id, url }) => chrome.runtime.sendMessage({ action: 'openSavedHighlight', id, url }),
    { id: highlightId, url: targetUrl });
  const newest = await readPending(worker, tabId);
  expect(newest.requestId).not.toBe(firstPending.requestId);
  expect(await messageFromTab(worker, tabId, {
    action, pageKey, acknowledgeId: highlightId, requestId: firstPending.requestId
  })).toMatchObject({ ok: true, acknowledged: false });
  expect(await readPending(worker, tabId)).toMatchObject({ requestId: newest.requestId });
  await target.close();
  await expect.poll(() => readPending(worker, tabId)).toBeUndefined();
});
