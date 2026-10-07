/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageKey = page => 'rastin_paint_' + createHash('sha256').update(page).digest('hex');
const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    await use(context); await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage(); await use(page);
  }
});
async function workerFor(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}
async function send(context, settings) {
  const worker = await workerFor(context);
  return worker.evaluate(async message => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    return chrome.tabs.sendMessage(tabs[tabs.length - 1].id, message);
  }, settings);
}
const host = page => page.locator('#rtl-fixer-paint-host');
const objects = page => host(page).locator('svg.surface > g > g[data-id]');
async function choose(page, tool) { await host(page).locator(`[data-tool="${tool}"]`).click(); }
async function menuAction(page, name) {
  const menu = host(page).locator('[data-menu="more"]');
  if (!await menu.isVisible()) await host(page).locator('[data-panel="more"]').click();
  await menu.locator(`[data-action="${name}"]`).click();
}
async function draw(page, tool = 'pen', start = [100, 180], end = [280, 280]) {
  await choose(page, tool); await page.mouse.move(...start); await page.mouse.down();
  await page.mouse.move(...end, { steps: 12 }); await page.mouse.up();
}
async function read(context, url = 'https://example.com/article') {
  const worker = await workerFor(context);
  return worker.evaluate(async key => (await chrome.storage.local.get(key))[key]?.items || [], storageKey(url));
}
test.beforeEach(async ({ context, page }) => {
  const worker = await workerFor(context);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, adBlockEnabled: false,
    'site_config_example.com': { enabled: false } }));
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><meta charset="UTF-8"><style>body{margin:0;font:18px Arial;height:4000px}h1{margin:50px}button{position:absolute;top:500px;left:100px}</style></head><body><h1>صفحه آزمایشی نوشتن و نقاشی</h1><button id="page-button" onclick="this.textContent=\'clicked\'">Page button</button></body></html>' }));
  await page.goto('https://example.com/article');
  await expect.poll(() => send(context, { action: 'openPaint' }).catch(() => ({ ok: false }))).toMatchObject({ ok: true });
  await expect(host(page)).toBeVisible();
});

test('drawing, marker and shapes survive undo, redo, scroll and reload', async ({ page, context }, testInfo) => {
  await draw(page);
  await draw(page, 'marker', [120, 340], [320, 340]);
  await draw(page, 'arrow', [350, 180], [480, 260]);
  await draw(page, 'rect', [370, 340], [520, 430]);
  await draw(page, 'ellipse', [550, 220], [650, 310]);
  await expect(objects(page)).toHaveCount(5);
  await expect.poll(() => read(context)).toHaveLength(5);
  const stored = await read(context);
  await page.screenshot({ path: testInfo.outputPath('paint-preview.png'), animations: 'disabled' });
  expect(stored[1]).toMatchObject({ type: 'marker', opacity: 0.35 });
  await host(page).locator('[data-action="undo"]').click();
  await expect(objects(page)).toHaveCount(4);
  await page.keyboard.press('Control+Shift+Z');
  await expect(objects(page)).toHaveCount(5);
  await page.evaluate(() => scrollTo(0, 650));
  await expect(host(page).locator('svg.surface')).toHaveAttribute('viewBox', '0 650 1280 900');
  await expect.poll(() => read(context)).toHaveLength(5);
  await page.reload(); await send(context, { action: 'openPaint' });
  await expect(objects(page)).toHaveCount(5);
  expect(await read(context)).toEqual(stored);
});

test('failed storage reports errors, keeps local strokes and allows a recovery export', async ({ page, context }) => {
  await draw(page); await expect.poll(() => read(context)).toHaveLength(1);
  const worker = await workerFor(context), key = storageKey('https://example.com/article');
  await worker.evaluate(key => chrome.storage.local.set({ [key]: { invalid: 'preserve' } }), key);
  await draw(page, 'arrow', [350, 350], [550, 400]);
  await expect(host(page).locator('.status')).toContainText('ذخیره ناموفق');
  await expect(objects(page)).toHaveCount(2);
  await host(page).locator('.status').click();
  await expect(host(page).locator('.status')).toContainText('ذخیره هنوز ناموفق');
  expect(await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key)).toEqual({ invalid: 'preserve' });
  const exporting = page.waitForEvent('download');
  await menuAction(page, 'json');
  const stream = await (await exporting).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).items).toHaveLength(2);
});

test('Persian multiline text, editing, cancel, move, resize and styles', async ({ page, context }) => {
  await choose(page, 'text'); await page.mouse.click(400, 220);
  const editor = host(page).getByRole('textbox', { name: 'متن روی صفحه' });
  await editor.fill('یادداشت فارسی\nخط دوم <script>'); await editor.press('Control+Enter');
  await expect(objects(page).locator('text')).toHaveAttribute('direction', 'rtl');
  await expect(objects(page).locator('tspan')).toHaveCount(2);
  await choose(page, 'select'); await page.mouse.move(345, 212); await page.mouse.down();
  await page.mouse.move(405, 272); await page.mouse.up();
  await expect.poll(async () => (await read(context))[0]?.x).toBe(460);
  await host(page).locator('[data-panel="style"]').click();
  await host(page).locator('input[name="color"]').fill('#2563eb');
  await host(page).locator('input[name="fontSize"]').fill('32');
  await host(page).locator('input[name="fontSize"]').press('Tab');
  await expect.poll(async () => (await read(context))[0]?.fontSize).toBe(32);
  const handle = host(page).locator('[data-resize="se"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 65); await page.mouse.up();
  await expect.poll(async () => (await read(context))[0]?.fontSize).toBeGreaterThan(32);
  const textBox = await objects(page).locator('text').boundingBox();
  await page.mouse.dblclick(textBox.x + textBox.width / 2, textBox.y + 10);
  await editor.fill('تغییر لغوشده'); await editor.press('Escape');
  await expect(objects(page).locator('text')).toContainText('یادداشت فارسی');
  await objects(page).locator('text').dblclick();
  await editor.fill('متن نهایی'); await editor.press('Control+Enter');
  await expect.poll(async () => (await read(context))[0]?.text).toBe('متن نهایی');
});

test('eraser, duplication and clear are reversible; browse and hide pass clicks through', async ({ page }) => {
  await draw(page, 'rect'); await choose(page, 'select'); await page.mouse.click(100, 220);
  await menuAction(page, 'duplicate');
  await expect(objects(page)).toHaveCount(2);
  await choose(page, 'eraser'); await page.mouse.click(120, 240);
  await expect(objects(page)).toHaveCount(1);
  await host(page).locator('[data-action="undo"]').click();
  await expect(objects(page)).toHaveCount(2);
  await menuAction(page, 'clear');
  await expect(objects(page)).toHaveCount(2);
  await menuAction(page, 'clear');
  await expect(objects(page)).toHaveCount(0);
  await host(page).locator('[data-action="undo"]').click();
  await expect(objects(page)).toHaveCount(2);
  await page.keyboard.press('Escape'); await page.locator('#page-button').click();
  await expect(page.locator('#page-button')).toHaveText('clicked');
  await choose(page, 'pen'); await menuAction(page, 'visibility');
  await expect(host(page).locator('svg.surface')).toHaveCSS('pointer-events', 'none');
});

test('exports usable transparent images and full JSON; imports validated data without HTML', async ({ page }) => {
  await draw(page, 'arrow');
  for (const format of ['json', 'svg', 'png']) {
    const downloading = page.waitForEvent('download');
    await menuAction(page, format);
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`rastin-paint.${format}`);
    expect(await download.failure()).toBeNull();
    if (format === 'png') {
      const stream = await download.createReadStream(); const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).subarray(1, 4).toString()).toBe('PNG');
    }
  }
  const file = host(page).locator('input[type="file"]');
  await file.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"rastin-paint","version":1,"items":[{"type":"script"}]}') });
  await expect(host(page).locator('.status')).toContainText('فایل نامعتبر');
  await expect(objects(page)).toHaveCount(1);
  await file.setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'rastin-paint', version: 1, items: [{ id: 'imported', type: 'text', x: 400, y: 400,
      color: '#000000', width: 4, opacity: 1, fill: false, fontSize: 24, text: '<img src=x onerror=alert(1)>' }]
  })) });
  await expect(objects(page)).toHaveCount(2);
  await expect(objects(page).locator('text')).toContainText('<img');
  await expect(host(page).locator('img')).toHaveCount(0);
});

test('SPA routes and query parameters have separate drawings; global disable cleans up', async ({ page, context }) => {
  await draw(page); await expect.poll(() => read(context)).toHaveLength(1);
  await page.evaluate(() => history.pushState({}, '', '/second?view=1'));
  await expect(objects(page)).toHaveCount(0);
  await draw(page, 'rect');
  await expect.poll(() => read(context, 'https://example.com/second?view=1')).toHaveLength(1);
  await page.evaluate(() => history.back());
  await expect(objects(page)).toHaveCount(1);
  await expect(objects(page).locator('path')).toHaveCount(1);
  await send(context, { action: 'updateSettings', settings: { globalEnabled: false } });
  await expect(host(page)).toHaveCount(0);
  expect(await send(context, { action: 'openPaint' })).toMatchObject({ ok: false });
});

test('two tabs merge concurrent strokes and never resurrect deleted shapes', async ({ context, page }) => {
  const second = await context.newPage(); await second.goto('https://example.com/article');
  await send(context, { action: 'openPaint' });
  await Promise.all([draw(page), draw(second, 'rect', [300, 350], [450, 450])]);
  await expect.poll(() => read(context)).toHaveLength(2);
  await expect(objects(page)).toHaveCount(2); await expect(objects(second)).toHaveCount(2);
  const records = await read(context), item = records.find(s => s.type === 'pen'), id = item.id;
  const worker = await workerFor(context);
  await choose(page, 'select'); await objects(page).filter({ has: page.locator('path') }).first().locator('path').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => read(context)).toHaveLength(1);
  await expect(objects(second)).toHaveCount(1);
  const stale = await worker.evaluate(async item => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    const result = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id },
      func: item => chrome.runtime.sendMessage({ action: 'mutatePaint', page: 'https://example.com/article',
        changes: [{ type: 'update', item: { ...item, x: 999 } }] }), args: [item] });
    return result[0].result;
  }, item);
  expect(stale.ok).toBe(true);
  expect((await read(context)).some(s => s.id === id)).toBe(false);
});

test('cancelled gestures and Shift constraints do not create accidental edits', async ({ page, context }) => {
  await choose(page, 'rect'); await page.mouse.move(100, 200); await page.mouse.down();
  await page.mouse.move(250, 300); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(objects(page)).toHaveCount(0);
  await choose(page, 'rect'); await page.keyboard.down('Shift');
  await page.mouse.move(100, 200); await page.mouse.down(); await page.mouse.move(250, 280); await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => read(context)).toHaveLength(1);
  const s = (await read(context))[0]; expect(s.x2 - s.x).toBe(s.y2 - s.y);
});

test('keyboard undo and redo work with Persian keys, toolbar focus and native text editing', async ({ page }) => {
  await draw(page, 'rect');
  await page.keyboard.press('Control+z'); await expect(objects(page)).toHaveCount(0);
  await page.keyboard.press('Control+y'); await expect(objects(page)).toHaveCount(1);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ظ', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
  })));
  await expect(objects(page)).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ظ', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
  })));
  await expect(objects(page)).toHaveCount(1);
  await choose(page, 'select'); await page.mouse.click(100, 230);
  await host(page).locator('[data-panel="style"]').click();
  const width = host(page).locator('input[name="width"]');
  await width.focus(); await width.press('Backspace');
  await expect(objects(page)).toHaveCount(1);
  await width.fill(''); await width.press('Tab');
  await expect(width).toHaveValue('4');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+d'); await expect(objects(page)).toHaveCount(2);
  await page.keyboard.press('Delete'); await expect(objects(page)).toHaveCount(1);
  await choose(page, 'text'); await page.mouse.click(450, 300);
  const editor = host(page).getByRole('textbox', { name: 'متن روی صفحه' });
  await editor.pressSequentially('test'); await editor.press('Control+z');
  await expect(editor).toBeVisible(); await expect(objects(page)).toHaveCount(1);
  await editor.fill('یادداشت'); await editor.press('Control+Enter');
  await expect(objects(page)).toHaveCount(2);
  await host(page).locator('[data-panel="style"]').click();
  await host(page).locator('input[name="width"]').focus();
  await page.keyboard.press('Control+z'); await expect(objects(page)).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z'); await expect(objects(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(host(page).locator('[data-menu="style"]')).toBeHidden();
  await page.keyboard.press('b');
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'native-input';
    input.style.cssText = 'position:absolute;left:100px;top:600px'; document.body.appendChild(input);
  });
  await page.locator('#native-input').fill('Native typing');
  await page.locator('#native-input').press('Control+z');
  await expect(objects(page)).toHaveCount(2);
});

test('minimal toolbar, popovers and collapse stay usable on a narrow screen', async ({ page }, testInfo) => {
  const bar = host(page).locator('.bar');
  expect((await bar.boundingBox()).height).toBeLessThan(60);
  await expect(host(page).locator('.panel:not([hidden])')).toHaveCount(0);
  await host(page).locator('[data-panel="style"]').click();
  await host(page).locator('[data-color="#8b5cf6"]').click();
  await expect(host(page).locator('input[name="color"]')).toHaveValue('#8b5cf6');
  await host(page).locator('[data-width="8"]').click();
  await expect(host(page).locator('input[name="width"]')).toHaveValue('8');
  await page.locator('h1').evaluate(el => { el.style.visibility = 'hidden'; });
  const desktopBar = await bar.boundingBox(), desktopPanel = await host(page).locator('[data-menu="style"]').boundingBox();
  await page.screenshot({ path: testInfo.outputPath('paint-style-preview.png'), animations: 'disabled', clip: {
    x: desktopBar.x - 8, y: desktopBar.y - 8, width: desktopBar.width + 16,
    height: desktopPanel.y + desktopPanel.height - desktopBar.y + 16
  } });
  await page.keyboard.press('Escape');
  await expect(host(page).locator('[data-menu="style"]')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 760 });
  let bounds = await bar.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await host(page).locator('[data-panel="style"]').click();
  const panel = host(page).locator('[data-menu="style"]');
  const panelBounds = await panel.boundingBox();
  expect(panelBounds.x).toBeGreaterThanOrEqual(0); expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('paint-mobile-preview.png'), animations: 'disabled' });
  await host(page).locator('[data-action="collapse"]').click();
  await expect(panel).toBeHidden(); await expect(host(page).locator('.tools')).toBeHidden();
  bounds = await bar.boundingBox(); expect(bounds.width).toBeLessThan(180);
  await host(page).locator('[data-action="collapse"]').click();
  await expect(host(page).locator('.tools')).toBeVisible();
  bounds = await bar.boundingBox(); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('corrupt saved drawings are preserved, and closing/reopening keeps saved content', async ({ page, context }) => {
  await draw(page); await expect.poll(() => read(context)).toHaveLength(1);
  await host(page).locator('[data-action="close"]').click();
  await expect(host(page)).toHaveCount(0);
  await send(context, { action: 'openPaint' }); await expect(objects(page)).toHaveCount(1);
  await host(page).locator('[data-action="close"]').click();
  const worker = await workerFor(context), key = storageKey('https://example.com/article');
  await worker.evaluate(key => chrome.storage.local.set({ [key]: { unexpected: 'preserve' } }), key);
  expect(await send(context, { action: 'openPaint' })).toMatchObject({ ok: false });
  expect(await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key)).toEqual({ unexpected: 'preserve' });
});
