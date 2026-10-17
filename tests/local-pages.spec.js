/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    try { await use(context); } finally { await context.close(); }
  }
});
const workerFor = async context => context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
const dispatchToggle = (popup, selector, value) => popup.locator(selector).evaluate((element, value) => {
  element.checked = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

function simplePdf() {
  const stream = 'BT /F1 18 Tf 50 750 Td (PDF fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function openPopup(context, worker, targetUrl, overrides) {
  const popup = await context.newPage();
  if (overrides) {
    await popup.addInitScript(({ targetUrl, overrides }) => {
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (query, callback) => {
        if (query.active) {
          const tabs = [{ id: 999, url: targetUrl }];
          if (callback) { callback(tabs); return; }
          return Promise.resolve(tabs);
        }
        return originalQuery(query, callback);
      };
      if (overrides.fileAllowed !== undefined) chrome.extension.isAllowedFileSchemeAccess = callback => callback(overrides.fileAllowed);
      if (overrides.mime !== undefined) {
        chrome.tabs.sendMessage = () => Promise.reject(new Error('Could not establish connection'));
        chrome.scripting.executeScript = () => Promise.resolve([{ result: { contentType: overrides.mime, pdfEmbed: overrides.mime === 'application/pdf' } }]);
      }
      if (overrides.receiverMime) {
        chrome.tabs.sendMessage = () => Promise.resolve({ ok: true, contentType: overrides.receiverMime });
        const originalRuntimeMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = message => message.action === 'readerCommand' ?
          Promise.resolve({ ok: true, contentType: overrides.receiverMime, reader: true }) : originalRuntimeMessage(message);
      }
    }, { targetUrl, overrides });
  } else {
    await worker.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.tabs.update(tab.id, { active: true });
    }, targetUrl);
  }
  await popup.goto('chrome-extension://' + new URL(worker.url()).host + '/popup/popup.html');
  return popup;
}

test('local HTML activates from the popup, preserves legacy settings and restores highlights after reload', async ({ context }, info) => {
  const worker = await workerFor(context);
  expect(await worker.evaluate(() => new Promise(resolve => chrome.extension.isAllowedFileSchemeAccess(resolve)))).toBe(true);
  await worker.evaluate(() => chrome.storage.local.set({
    enabled: true, adBlockEnabled: false,
    site_config_: { enabled: false, fontFamily: 'System', fontWeight: '400', forceRightAlign: true, highlightEnabled: false }
  }));
  const filePath = info.outputPath('local-article.html');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '<!doctype html><html><head><meta charset="UTF-8"><title>Local article</title>' +
    '<style>body{font:18px Arial;margin:40px}p{max-width:700px}</style></head><body>' +
    '<p id="persian">این یک متن فارسی برای بررسی دسترسی به فایل‌های محلی است.</p>' +
    '<p id="passage">A saved local passage survives a page reload.</p></body></html>', 'utf8');
  const fileUrl = pathToFileURL(filePath).href;
  const page = await context.newPage();
  await page.goto(fileUrl);
  const popup = await openPopup(context, worker, fileUrl);
  await expect(popup.locator('#domain-name')).toHaveText('فایل‌های HTML محلی');
  await expect(popup.locator('#domain-toggle')).toBeEnabled();
  await expect(popup.locator('#right-align-toggle')).toBeChecked();
  await dispatchToggle(popup, '#domain-toggle', true);
  await expect(page.locator('#persian')).toHaveCSS('direction', 'rtl');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('site_config_file://'))['site_config_file://']?.enabled)).toBe(true);
  await popup.locator('[data-section="highlights"]').evaluate(panel => panel.open = true);
  await dispatchToggle(popup, '#highlight-toggle', true);
  await page.evaluate(() => {
    const element = document.getElementById('passage');
    const range = document.createRange(); range.selectNodeContents(element);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('.rastin-color-btn.yellow').dispatchEvent('pointerdown');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_')).rtl_fixer_hl_?.length)).toBe(1);
  await worker.evaluate(() => chrome.storage.local.set({ 'rtl_fixer_hl_example.com': [{
    id: 'web-highlight', text: 'A web passage should not appear in the local filter.',
    url: 'https://example.com/', pageKey: 'example.com/', timestamp: 1, color: '#fef08a'
  }] }));
  await expect(popup.locator('.highlight-card-text')).toHaveText('A saved local passage survives a page reload.');
  await expect(popup.locator('.highlight-card-domain')).toHaveText('فایل محلی');
  await page.reload();
  await expect(page.locator('#persian')).toHaveCSS('direction', 'rtl');
  await expect.poll(() => page.evaluate(() => [...CSS.highlights.entries()]
    .filter(([name]) => name.startsWith('rastin-color-'))
    .flatMap(([, highlight]) => [...highlight].map(range => range.toString())))).toEqual(['A saved local passage survives a page reload.']);
  await popup.locator('#quick-paint-btn').evaluate(button => button.click());
  await expect(page.locator('#rtl-fixer-paint-host')).toBeVisible();
});

test('a denied local permission has an actionable settings link while saved notes remain available', async ({ context }) => {
  const worker = await workerFor(context);
  const popup = await openPopup(context, worker, 'file:///C:/Users/Ali/Documents/article.html', { fileAllowed: false });
  await expect(popup.locator('#page-access-message')).toContainText('Allow access to file URLs');
  await expect(popup.locator('#page-access-message bdi')).toHaveAttribute('dir', 'ltr');
  await expect(popup.locator('#domain-toggle')).toBeDisabled();
  await expect(popup.locator('#global-toggle')).toBeEnabled();
  await expect(popup.locator('#quick-translate-btn')).toBeDisabled();
  await popup.locator('#file-access-settings-btn').evaluate(button => button.click());
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({})).then(tabs => tabs.some(tab => tab.url === 'chrome://extensions/?id=' + new URL(worker.url()).host))).toBe(true);
  await popup.locator('#quick-notes-btn').evaluate(button => button.click());
  await expect(popup.locator('#highlight-search')).toBeEnabled();
  await expect(popup.locator('#btn-export-json')).toBeEnabled();
});

test('another extension shows its restriction and opens the Rastin file picker without leaking its URL', async ({ context }, info) => {
  const worker = await workerFor(context);
  const foreignUrl = 'chrome-extension://gaapkhfnacelbaknjgidbeoekoicagoe/viewer.html?id=local-id';
  const popup = await openPopup(context, worker, foreignUrl, {});
  await expect(popup.locator('#page-access-message')).toContainText('فایل را دانلود کنید');
  await expect(popup.locator('#domain-toggle')).toBeDisabled();
  await popup.locator('#open-reader-btn').evaluate(button => button.click());
  const readerUrl = 'chrome-extension://' + new URL(worker.url()).host + '/reader/viewer.html';
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({})).then(tabs => tabs.some(tab => tab.url === readerUrl))).toBe(true);
  await popup.screenshot({ path: info.outputPath('foreign-extension-notice.png'), animations: 'disabled' });
});

test('native PDF metadata catches extensionless downloads and passes the source to the Rastin reader', async ({ context }) => {
  const worker = await workerFor(context);
  const source = 'https://example.com/download?document=123';
  const popup = await openPopup(context, worker, source, { mime: 'application/pdf' });
  await expect(popup.locator('#page-access-message')).toContainText('نمایشگر PDF');
  await expect(popup.locator('#domain-toggle')).toBeDisabled();
  await expect(popup.locator('#quick-paint-btn')).toBeDisabled();
  await popup.locator('#open-reader-btn').evaluate(button => button.click());
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({})).then(tabs => tabs.some(tab => {
    try { const url = new URL(tab.url); return url.pathname === '/reader/viewer.html' && url.searchParams.get('file') === source; } catch (_) { return false; }
  }))).toBe(true);
});

test('a real native PDF viewer at an extensionless web URL shows the PDF restriction', async ({ context }, info) => {
  const worker = await workerFor(context);
  const source = 'https://example.com/download';
  await context.route(source, route => route.fulfill({ contentType: 'application/pdf', body: simplePdf() }));
  const page = await context.newPage();
  await page.goto(source, { waitUntil: 'domcontentloaded' });
  const popup = await openPopup(context, worker, source);
  await expect(popup.locator('#page-access-message')).toContainText('نمایشگر PDF');
  await expect(popup.locator('#domain-toggle')).toBeDisabled();
  await expect(popup.locator('#open-reader-btn')).toBeEnabled();
  await popup.screenshot({ path: info.outputPath('native-pdf-notice.png'), animations: 'disabled' });
});

test('an HTML page whose name ends in PDF remains usable when the receiver confirms HTML', async ({ context }) => {
  const worker = await workerFor(context);
  const popup = await openPopup(context, worker, 'https://example.com/article.pdf', { receiverMime: 'text/html' });
  await expect(popup.locator('#domain-toggle')).toBeEnabled();
  await expect(popup.locator('#quick-paint-btn')).toBeEnabled();
  await expect(popup.locator('#page-access-notice')).toBeHidden();
});

test('only the exact owned reader page receives the reader settings scope', async ({ context }) => {
  const worker = await workerFor(context);
  const ownBase = 'chrome-extension://' + new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ site_config_reader: { enabled: true, highlightEnabled: true } }));
  const readerPopup = await openPopup(context, worker, ownBase + '/reader/viewer.html', { receiverMime: 'text/html' });
  await expect(readerPopup.locator('#domain-name')).toHaveText('نمایشگر فایل راستین');
  await expect(readerPopup.locator('#domain-toggle')).toBeEnabled();
  await expect(readerPopup.locator('#domain-toggle')).toBeChecked();
  const unrelatedPopup = await openPopup(context, worker, ownBase + '/popup/popup.html', {});
  await expect(unrelatedPopup.locator('#domain-toggle')).toBeDisabled();
});

test('the real owned reader accepts popup changes through its bridge and an explicit settings target', async ({ context }) => {
  const worker = await workerFor(context);
  await worker.evaluate(() => chrome.storage.local.set({
    enabled: true, adBlockEnabled: false,
    site_config_reader: { enabled: false, fontFamily: 'System', fontWeight: '400' }
  }));
  const reader = await context.newPage();
  const readerUrl = 'chrome-extension://' + new URL(worker.url()).host + '/reader/viewer.html';
  await reader.goto(readerUrl);
  const tabId = await reader.evaluate(() => window.RtlFixer.readerReady);
  await reader.evaluate(() => {
    const content = document.getElementById('reader-text-layer');
    const paragraph = document.createElement('span');
    paragraph.id = 'reader-popup-prose';
    paragraph.style.direction = 'ltr';
    paragraph.style.fontWeight = '400';
    paragraph.textContent = 'هندسهٔ متن PDF باید با تغییر تنظیمات وب‌سایت‌ها حفظ شود.';
    content.append(paragraph);
  });
  const paragraph = reader.locator('#reader-popup-prose');
  await expect(paragraph).toHaveCSS('direction', 'ltr');
  const actionPopup = await openPopup(context, worker, readerUrl);
  await expect(actionPopup.locator('#domain-name')).toHaveText('نمایشگر فایل راستین');
  await expect(actionPopup.locator('#domain-toggle')).toBeEnabled();
  await expect(actionPopup.locator('#domain-toggle')).not.toBeChecked();
  await dispatchToggle(actionPopup, '#domain-toggle', true);
  await expect.poll(() => reader.evaluate(() => window.RtlFixer.config.enabled)).toBe(true);
  await expect(paragraph).toHaveCSS('direction', 'ltr');
  await actionPopup.locator('#font-weight-group [data-value="700"]').evaluate(button => button.click());
  await expect.poll(() => reader.evaluate(() => window.RtlFixer.config.fontWeight)).toBe('700');
  await expect(paragraph).toHaveCSS('font-weight', '400');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('site_config_reader')).site_config_reader?.fontWeight)).toBe('700');
  const settingsOpened = context.waitForEvent('page');
  await reader.locator('#reader-settings').click();
  const settings = await settingsOpened;
  await expect(settings).toHaveURL('chrome-extension://' + new URL(worker.url()).host + '/popup/popup.html?tabId=' + tabId);
  await expect(settings.locator('#domain-name')).toHaveText('نمایشگر فایل راستین');
  await expect(settings.locator('#domain-toggle')).toBeChecked();
  await dispatchToggle(settings, '#domain-toggle', false);
  await expect(paragraph).not.toHaveAttribute('dir', 'rtl');
  await expect(paragraph).toHaveCSS('font-weight', '400');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('site_config_reader')).site_config_reader?.enabled)).toBe(false);
});

test('explicit settings targets reject malformed IDs and pages other than the owned reader', async ({ context }) => {
  const worker = await workerFor(context);
  const baseUrl = 'chrome-extension://' + new URL(worker.url()).host + '/popup/popup.html';
  for (const tabId of ['0', '-1', '123abc', '9007199254740992']) {
    const popup = await context.newPage();
    await popup.goto(baseUrl + '?tabId=' + encodeURIComponent(tabId));
    await expect(popup.locator('#domain-toggle')).toBeDisabled();
    await popup.close();
  }
  const otherPage = await context.newPage();
  await otherPage.goto(baseUrl);
  const otherTabId = await otherPage.evaluate(() => chrome.tabs.getCurrent().then(tab => tab.id));
  const popup = await context.newPage();
  await popup.goto(baseUrl + '?tabId=' + otherTabId);
  await expect(popup.locator('#domain-toggle')).toBeDisabled();
});
