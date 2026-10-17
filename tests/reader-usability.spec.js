/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { persianPdf, scannedPdf } from './fixtures/reader-pdf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1440, height: 900 },
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    try { await use(context); } finally { await context.close(); }
  }
});

async function openPdf(context, buffer) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false, adBlockEnabled: false }));
  const page = await context.newPage();
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/reader/viewer.html');
  await page.evaluate(() => window.RtlFixer.readerReady);
  await page.locator('#reader-file').setInputFiles({ name: 'persian-selection.pdf', mimeType: 'application/pdf', buffer });
  await expect.poll(() => new URL(page.url()).searchParams.get('document')).toBe(createHash('sha256').update(buffer).digest('hex'));
  await expect(page.locator('#reader-page-stage')).toBeVisible();
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#reader-status')).toBeHidden();
  return { page, worker };
}

const marks = page => page.locator('#reader-annotation-layer [data-annotation-id]:not([data-annotation-draft])');
const selectedText = page => page.evaluate(() => window.RtlFixer.pdfSelection.getText().normalize('NFKC'));
const savedItems = async (worker, page) => {
  const key = 'rastin_pdf_annotations_' + new URL(page.url()).searchParams.get('document');
  return worker.evaluate(async storageKey => (await chrome.storage.local.get(storageKey))[storageKey]?.items || [], key);
};

// Ranges only measure where the original PDF glyphs are. The selection itself
// is produced entirely by actual pointer events, which catches the difficult
// case where PDF.js emits each shaped Persian glyph as a separate DOM span.
async function phraseGeometry(page, phrase) {
  return page.locator('#reader-text-layer').evaluate((layer, requested) => {
    const lines = [];
    for (const span of layer.querySelectorAll('span')) {
      if (!span.firstChild || span.firstChild.nodeType !== Node.TEXT_NODE || !span.textContent) continue;
      const box = span.getBoundingClientRect();
      let line = lines.find(candidate => Math.abs(candidate.y - box.top) < 3);
      if (!line) { line = { y: box.top, spans: [] }; lines.push(line); }
      line.spans.push({ span, box });
    }
    for (const line of lines) {
      const glyphs = [];
      for (const { span } of line.spans.sort((a, b) => b.box.right - a.box.right)) {
        for (let index = 0; index < span.textContent.length; index++) {
          const range = document.createRange();
          range.setStart(span.firstChild, index); range.setEnd(span.firstChild, index + 1);
          const rect = range.getBoundingClientRect();
          glyphs.push({ text: span.textContent[index].normalize('NFKC'), rtl: span.dir === 'rtl', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        }
      }
      const text = glyphs.map(glyph => glyph.text).join('');
      line.readingText = text;
      const start = text.indexOf(requested);
      if (start === -1) continue;
      const selected = glyphs.slice(start, start + requested.length);
      const first = selected[0], last = selected.at(-1);
      return {
        text, spanCount: line.spans.length,
        start: { x: first.rtl ? first.right - 0.6 : first.left + 0.6, y: (first.top + first.bottom) / 2 },
        end: { x: last.rtl ? last.left + 0.6 : last.right - 0.6, y: (last.top + last.bottom) / 2 },
        center: { x: (selected[Math.floor(selected.length / 2)].left + selected[Math.floor(selected.length / 2)].right) / 2, y: (first.top + first.bottom) / 2 },
        bounds: { x: Math.min(...selected.map(glyph => glyph.left)), y: Math.min(...selected.map(glyph => glyph.top)), right: Math.max(...selected.map(glyph => glyph.right)), bottom: Math.max(...selected.map(glyph => glyph.bottom)) }
      };
    }
    throw new Error('The original PDF text does not contain ' + requested + ': ' + lines.map(line => line.readingText).join('\n'));
  }, phrase);
}

async function dragText(page, geometry, reversed = false) {
  const start = reversed ? geometry.end : geometry.start, end = reversed ? geometry.start : geometry.end;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  await page.mouse.up();
}

async function drawArea(page, start = [0.15, 0.4], end = [0.38, 0.47]) {
  const box = await page.locator('#reader-page-stage').boundingBox();
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 12 });
  await page.mouse.up();
}

function canvasFingerprint(page) {
  return page.locator('#reader-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 29) hash = Math.imul(hash ^ pixels[index], 16777619);
    return [canvas.width, canvas.height, hash >>> 0];
  });
}

test('reader uses the viewport, separates thin internal scrollbars and places file management in its menu', async ({ context }, info) => {
  const { page } = await openPdf(context, await persianPdf(context));
  for (const width of [1440, 768, 420]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.querySelector('#reader-page-stage').clientWidth - document.querySelector('#reader-paper-scroll').clientWidth)).toBeLessThanOrEqual(-32);
    await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#reader-paper-scroll')).toHaveCSS('direction', 'ltr');
    await expect(page.locator('#reader-thumbnails')).toHaveCSS('direction', 'ltr');
    for (const scroller of ['#reader-paper-scroll', '#reader-thumbnails']) {
      const scrollbar = await page.locator(scroller).evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').width);
      expect(scrollbar).toBe('6px');
    }
    const bounds = await page.locator('#reader-paper-scroll').boundingBox();
    expect(bounds.y + bounds.height).toBeGreaterThan(855);
    await expect(page.locator('footer.reader-footer')).toBeHidden();
    const missingIcons = await page.locator('.tool-button, .icon-button').evaluateAll(buttons => buttons.filter(button => !button.querySelector('svg')).map(button => button.id || button.dataset.tool));
    expect(missingIcons).toEqual([]);
    await page.screenshot({ path: info.outputPath(`reader-compact-${width}.png`), animations: 'disabled' });
  }
  await page.locator('#reader-more').click();
  await expect(page.locator('#reader-document-menu')).toBeVisible();
  await expect(page.locator('#reader-document-menu #reader-forget-file')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader-document-menu')).toBeHidden();
});

test('pointer dragging selects an authentic Persian phrase across positioned glyphs in either direction', async ({ context }, info) => {
  const { page, worker } = await openPdf(context, await persianPdf(context, 1));
  await expect(page.locator('#reader-selection-mode')).toHaveValue('auto');
  const phrase = 'متن فارسی';
  const geometry = await phraseGeometry(page, phrase);
  expect(geometry.spanCount).toBeGreaterThan(15);
  const originalCanvas = await canvasFingerprint(page);
  await dragText(page, geometry);
  await expect.poll(() => selectedText(page)).toBe(phrase);
  await expect(page.locator('#reader-selection-layer')).toHaveCSS('position', 'absolute');
  await expect(page.locator('#reader-selection-layer')).toHaveCSS('pointer-events', 'none');
  const paintedSelection = await page.locator('#reader-selection-layer rect').first().boundingBox();
  expect(Math.abs(paintedSelection.x - geometry.bounds.x)).toBeLessThan(2);
  expect(Math.abs(paintedSelection.y - geometry.bounds.y)).toBeLessThan(2);
  await expect(page.locator('#reader-selection-bar')).toBeVisible();
  const bar = await page.locator('#reader-selection-bar').boundingBox();
  expect(Math.min(Math.abs(bar.y + bar.height - geometry.bounds.y), Math.abs(bar.y - geometry.bounds.bottom))).toBeLessThan(28);
  await page.screenshot({ path: info.outputPath('reader-persian-native-pointer-selection.png'), animations: 'disabled' });
  await page.locator('#reader-highlight-selection').click();
  await expect(marks(page)).toHaveCount(1);
  await expect.poll(async () => (await savedItems(worker, page))[0]?.text?.normalize('NFKC')).toBe(phrase);
  const highlight = await marks(page).first().boundingBox();
  expect(Math.abs(highlight.x - geometry.bounds.x)).toBeLessThan(2);
  expect(Math.abs(highlight.width - (geometry.bounds.right - geometry.bounds.x))).toBeLessThan(3);
  expect(highlight.height).toBeLessThan(geometry.bounds.bottom - geometry.bounds.y + 5);
  expect(await canvasFingerprint(page)).toEqual(originalCanvas);
  await dragText(page, geometry, true);
  await expect.poll(() => selectedText(page)).toBe(phrase);
});

test('mixed RTL and Latin text preserves reading order and supports word and line gestures', async ({ context }, info) => {
  const { page } = await openPdf(context, await persianPdf(context, 1));
  const mixedPhrase = 'PDF Reader متن فارسی و English';
  const mixedGeometry = await phraseGeometry(page, mixedPhrase);
  await dragText(page, mixedGeometry);
  await page.screenshot({ path: info.outputPath('reader-mixed-pointer-selection.png'), animations: 'disabled' });
  await expect.poll(() => selectedText(page)).toBe(mixedPhrase);
  const geometry = await phraseGeometry(page, 'فارسی');
  await page.mouse.dblclick(geometry.center.x, geometry.center.y);
  await expect.poll(() => selectedText(page)).toBe('فارسی');
  await page.mouse.click(geometry.center.x, geometry.center.y, { clickCount: 3 });
  await expect.poll(() => selectedText(page)).toBe('انتخاب متن فارسی روی همان سند آسان است.');
});

test('a mouse selection spanning Persian and mixed lines highlights glyph rows rather than their whitespace', async ({ context }) => {
  const { page } = await openPdf(context, await persianPdf(context, 1));
  const first = await phraseGeometry(page, 'متن فارسی');
  const last = await phraseGeometry(page, 'دوم');
  await dragText(page, { start: first.start, end: last.end });
  await expect.poll(async () => (await selectedText(page)).replace(/\s+/g, ' ').trim()).toBe('متن فارسی روی همان سند آسان است. در PDF Reader متن فارسی و English با هم هستند. این خط دوم');
  await page.locator('#reader-highlight-selection').click();
  await expect(marks(page)).toHaveCount(1);
  const rectangles = await marks(page).first().locator('rect').evaluateAll(rects => rects.map(rect => {
    const box = rect.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  expect(rectangles.length).toBeGreaterThanOrEqual(3);
  for (const rect of rectangles) {
    expect(rect.height).toBeGreaterThan(5);
    expect(rect.height).toBeLessThan(45);
    expect(rect.width).toBeGreaterThan(0);
  }
  const rows = [...new Set(rectangles.map(rect => Math.round(rect.y / 5)))];
  expect(rows).toHaveLength(3);
});

test('text highlighting is immediate while explicit area mode and scanned pages still allow free marks', async ({ context }) => {
  const { page, worker } = await openPdf(context, await persianPdf(context, 1));
  await page.locator('[data-tool="highlight"]').click();
  await dragText(page, await phraseGeometry(page, 'متن فارسی'));
  await expect(marks(page)).toHaveCount(1);
  await expect.poll(async () => (await savedItems(worker, page))[0]?.text?.normalize('NFKC')).toBe('متن فارسی');
  await expect(page.locator('#reader-selection-bar')).toBeHidden();
  await page.locator('#reader-selection-mode').selectOption('area');
  await drawArea(page, [0.3, 0.08], [0.8, 0.2]);
  await expect(marks(page)).toHaveCount(2);
  await expect.poll(async () => (await savedItems(worker, page)).length).toBe(2);
  const areas = await savedItems(worker, page);
  expect(areas[1].text || '').toBe('');
  expect(areas[1].rects).toHaveLength(1);
  const scan = scannedPdf();
  await page.locator('#reader-file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scan });
  await expect.poll(() => new URL(page.url()).searchParams.get('document')).toBe(createHash('sha256').update(scan).digest('hex'));
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#reader-text-layer span')).toHaveCount(0);
  await page.locator('#reader-selection-mode').selectOption('auto');
  await page.locator('[data-tool="highlight"]').click();
  await drawArea(page);
  await expect(marks(page)).toHaveCount(1);
});

test('annotation jumps scroll only the document and keep the same page rendered, including reduced motion', async ({ context }, info) => {
  const { page } = await openPdf(context, await persianPdf(context, 2));
  await page.locator('#reader-zoom').selectOption('2');
  await expect.poll(() => page.locator('#reader-page-stage').evaluate(stage => Math.abs(stage.clientHeight - 1275))).toBeLessThanOrEqual(1);
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#reader-paper-scroll').evaluate(scroll => { scroll.scrollTop = 510; });
  await page.locator('#reader-selection-mode').selectOption('area');
  await page.locator('[data-tool="highlight"]').click();
  await drawArea(page, [0.15, 0.62], [0.38, 0.66]);
  await expect(marks(page)).toHaveCount(1);
  const originalCanvas = await canvasFingerprint(page);
  await page.locator('#reader-paper-scroll').evaluate(scroll => { scroll.scrollTop = 0; });
  await page.locator('#reader-notes-tab').click();
  await page.evaluate(() => {
    window.readerJumpRenderedAgain = false;
    new MutationObserver(records => {
      if (records.some(record => record.oldValue === 'false')) window.readerJumpRenderedAgain = true;
    }).observe(document.querySelector('#reader-page-stage'), { attributes: true, attributeOldValue: true, attributeFilter: ['aria-busy'] });
  });
  await page.locator('.annotation-jump').first().click();
  await expect.poll(() => page.locator('#reader-paper-scroll').evaluate(scroll => scroll.scrollTop)).toBeGreaterThan(350);
  await expect.poll(async () => {
    const mark = await marks(page).first().boundingBox(), scroll = await page.locator('#reader-paper-scroll').boundingBox();
    return Math.abs(mark.y + mark.height / 2 - scroll.y - scroll.height / 2);
  }).toBeLessThan(5);
  expect(await page.evaluate(() => window.readerJumpRenderedAgain)).toBe(false);
  expect(await canvasFingerprint(page)).toEqual(originalCanvas);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath('reader-highlight-jump.png'), animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#reader-paper-scroll').evaluate(scroll => { scroll.scrollTop = 0; });
  await page.locator('.annotation-jump').first().click();
  await expect.poll(() => page.locator('#reader-paper-scroll').evaluate(scroll => scroll.scrollTop)).toBeGreaterThan(350);
  expect(await page.locator('#reader-paper-scroll').evaluate(scroll => scroll.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  expect(await page.evaluate(() => window.readerJumpRenderedAgain)).toBe(false);
});
