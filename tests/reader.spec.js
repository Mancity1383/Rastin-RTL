/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passage = 'A persistent PDF passage for highlighting.';

// Valid PDFs with separate text positions and actual artwork. The image-only
// variant exercises annotations when there is no selectable text at all.
function pdfFixture(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [' + pages.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach((page, i) => {
    const settings = typeof page === 'string' ? { text: page } : page;
    const escaped = (settings.text || '').replace(/([\\()])/g, '\\$1');
    let largeImage;
    if (settings.largeImage) {
      // 16.81 megapixels: the old maxImageSize option silently dropped this
      // otherwise small, valid scan instead of displaying the original page.
      const pixels = Buffer.alloc(4100 * 4100, 238);
      for (let row = 400; row < 3700; row += 160) for (let offset = 0; offset < 20; offset++) {
        pixels.fill(45, (row + offset) * 4100 + 350, (row + offset) * 4100 + 3550);
      }
      largeImage = 'q 450 0 0 640 70 80 cm BI /W 4100 /H 4100 /BPC 8 /CS /G /F [/ASCIIHexDecode /FlateDecode] ID ' + deflateSync(pixels).toString('hex') + '> EI Q';
    }
    const stream = largeImage || (settings.imageOnly
      ? 'q 450 0 0 640 70 80 cm BI /W 2 /H 2 /BPC 8 /CS /RGB /F /ASCIIHexDecode ID 2a407fd3dbebf1f5fa3e649b> EI Q'
      : '0.85 0.15 0.1 rg 40 560 200 60 re f\n0.1 0.3 0.7 rg 350 500 160 120 re f\n0 0 0 rg BT /F1 18 Tf 40 700 Td (' + escaped + ') Tj ET\nBT /F1 14 Tf 350 660 Td (Right column) Tj ET');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] ' + (settings.rotation ? '/Rotate ' + settings.rotation + ' ' : '') + '/Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>');
    objects.push('<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream');
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(pdf + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
}

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1440, height: 1100 },
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    try { await use(context); } finally { await context.close(); }
  }
});

async function setup(context) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  // PDF tools work independently of webpage typography settings.
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false, adBlockEnabled: false }));
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/reader/viewer.html');
  await page.evaluate(() => window.RtlFixer.readerReady);
  return { page, worker, extensionId };
}

async function openFile(page, pages, name = 'sample.pdf') {
  const buffer = pdfFixture(pages);
  await page.locator('#reader-file').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  const hash = createHash('sha256').update(buffer).digest('hex');
  await expect.poll(() => new URL(page.url()).searchParams.get('document')).toBe(hash);
  await expect(page.locator('#reader-page-stage')).toBeVisible();
  await expect(page.locator('#reader-status')).toBeHidden();
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await expect.poll(() => canvasInk(page)).toBeGreaterThan(20);
}

const annotations = page => page.locator('#reader-annotation-layer [data-annotation-id]');
const stage = page => page.locator('#reader-page-stage');
function canvasInk(page) {
  return page.locator('#reader-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && pixels[i] < 180) ink++;
    return ink;
  });
}
async function draw(page, tool, start = [0.14, 0.25], end = [0.44, 0.34]) {
  await page.locator('[data-tool="' + tool + '"]').click();
  const box = await stage(page).boundingBox();
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 12 });
  await page.mouse.up();
}
async function addNote(page, text) {
  await page.locator('[data-tool="note"]').click();
  const box = await stage(page).boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.35);
  await expect(page.locator('#reader-note-dialog')).toBeVisible();
  await page.locator('#reader-note-text').fill(text);
  await page.locator('#reader-note-save').click();
  await expect(page.locator('#reader-note-dialog')).toBeHidden();
}
async function savedAnnotations(worker, page) {
  const hash = new URL(page.url()).searchParams.get('document');
  return worker.evaluate(async key => (await chrome.storage.local.get(key))[key], 'rastin_pdf_annotations_' + hash);
}

// Canvas pixels are the original document, while the transparent text layer
// merely supplies PDF.js positions for selection. Neither gets reflowed.
test('original artwork and positioned transparent text preserve the native page, including page rotation', async ({ context }, info) => {
  const { page, worker } = await setup(context);
  await openFile(page, [passage, { text: 'A second PDF page.', rotation: 90 }]);
  expect(new URL(page.url()).searchParams.get('document')).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('.reader-paragraph, #reader-text-mode, #reader-enabled')).toHaveCount(0);
  const text = page.locator('#reader-text-layer span').filter({ hasText: passage }).first();
  await expect(text).toHaveText(passage);
  await expect(text).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#reader-text-layer .rtl-fixer-target')).toHaveCount(0);
  await page.locator('#reader-zoom').selectOption('1');
  await expect.poll(() => page.locator('#reader-canvas').evaluate(canvas => [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)])).toEqual([600, 800]);
  const artwork = await page.locator('#reader-canvas').evaluate(canvas => {
    const scale = canvas.width / 600;
    return [...canvas.getContext('2d').getImageData(Math.round(100 * scale), Math.round(210 * scale), 1, 1).data];
  });
  expect(artwork[0]).toBeGreaterThan(200);
  expect(artwork[1]).toBeLessThan(60);
  await page.screenshot({ path: info.outputPath('reader-native-pdf.png'), animations: 'disabled', fullPage: true });
  await page.locator('#reader-next-page').click();
  await expect(page.locator('#reader-page-number')).toHaveValue('2');
  await expect.poll(() => page.locator('#reader-canvas').evaluate(canvas => [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)])).toEqual([800, 600]);
  await expect(page.locator('#reader-text-layer')).toContainText('A second PDF page.');
  const hash = new URL(page.url()).searchParams.get('document');
  await expect.poll(() => worker.evaluate(async key => (await chrome.storage.local.get(key))[key]?.page, 'rastin_pdf_view_' + hash)).toBe(2);
  await page.reload();
  await expect(page.locator('#reader-page-number')).toHaveValue('2');
  await expect(page.locator('#reader-text-layer')).toContainText('A second PDF page.');
  await page.locator('#reader-previous-page').click();
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
});

test('image-only pages support highlights and notes that survive reload and document switching', async ({ context }, info) => {
  const { page, worker } = await setup(context);
  await openFile(page, [{ imageOnly: true }]);
  await expect(page.locator('#reader-text-layer span')).toHaveCount(0);
  const firstUrl = page.url();
  await draw(page, 'highlight');
  await expect(annotations(page)).toHaveCount(1);
  const note = 'یادداشت روی خود PDF، بدون استخراج متن';
  await addNote(page, note);
  await expect(annotations(page)).toHaveCount(2);
  await expect(page.locator('#reader-annotations')).toContainText(note);
  await expect.poll(async () => JSON.stringify(await savedAnnotations(worker, page))).toContain(note);
  await page.screenshot({ path: info.outputPath('reader-image-annotations.png'), animations: 'disabled', fullPage: true });
  await page.reload();
  await expect(annotations(page)).toHaveCount(2);
  await expect(page.locator('#reader-annotations')).toContainText(note);
  expect(page.url()).toBe(firstUrl);
  await openFile(page, ['A different PDF with the same file name.']);
  expect(page.url()).not.toBe(firstUrl);
  await expect(annotations(page)).toHaveCount(0);
  await expect(page.locator('#reader-annotations')).not.toContainText(note);
  await page.goto(firstUrl);
  await expect(annotations(page)).toHaveCount(2);
  await expect(page.locator('#reader-annotations')).toContainText(note);
});

test('annotations stay anchored through zoom, rotation, undo, redo and erasing', async ({ context }) => {
  const { page } = await setup(context);
  await openFile(page, [passage]);
  await page.locator('#reader-zoom').selectOption('1');
  await expect.poll(() => stage(page).evaluate(element => element.clientWidth)).toBe(600);
  await draw(page, 'rect');
  await expect(annotations(page)).toHaveCount(1);
  const original = await annotations(page).first().boundingBox();
  const originalStage = await stage(page).boundingBox();
  await page.locator('#reader-zoom').selectOption('1.5');
  await expect.poll(() => stage(page).evaluate(element => element.clientWidth)).toBe(900);
  const scaled = await annotations(page).first().boundingBox();
  const scaledStage = await stage(page).boundingBox();
  expect(scaled.width / original.width).toBeCloseTo(1.5, 1);
  expect((scaled.x - scaledStage.x) / scaledStage.width).toBeCloseTo((original.x - originalStage.x) / originalStage.width, 2);
  expect((scaled.y - scaledStage.y) / scaledStage.height).toBeCloseTo((original.y - originalStage.y) / originalStage.height, 2);
  await page.locator('#reader-rotate').click();
  await expect.poll(() => stage(page).evaluate(element => [element.clientWidth, element.clientHeight])).toEqual([1200, 900]);
  const rotated = await annotations(page).first().boundingBox();
  expect(rotated.width).toBeCloseTo(scaled.height, 0);
  expect(rotated.height).toBeCloseTo(scaled.width, 0);
  await page.locator('#reader-undo').click();
  await expect(annotations(page)).toHaveCount(0);
  await page.locator('#reader-redo').click();
  await expect(annotations(page)).toHaveCount(1);
  await page.locator('#reader-zoom').selectOption('page-fit');
  await expect(stage(page)).toHaveAttribute('aria-busy', 'false');
  const target = await annotations(page).first().boundingBox();
  await page.locator('[data-tool="erase"]').click();
  await page.mouse.click(target.x + target.width / 2, target.y);
  await expect(annotations(page)).toHaveCount(0);
  await page.locator('#reader-undo').click();
  await expect(annotations(page)).toHaveCount(1);
});

test('native text selection and its highlight follow exact page geometry after a 90 degree rotation', async ({ context }, info) => {
  const { page } = await setup(context);
  await openFile(page, [passage]);
  await page.locator('#reader-zoom').selectOption('1');
  await expect(stage(page)).toHaveAttribute('aria-busy', 'false');
  const span = page.locator('#reader-text-layer span').filter({ hasText: passage }).first();
  const relativeTextRect = () => span.evaluate(element => {
    const text = element.getBoundingClientRect();
    const paper = document.querySelector('#reader-page-stage').getBoundingClientRect();
    return { x: text.left - paper.left, y: text.top - paper.top, width: text.width, height: text.height };
  });
  const original = await relativeTextRect();
  // Browser selection boxes include font ascent/descent differently from the
  // span's CSS box. Both must rotate with the page, each using its own bounds.
  const originalSelection = await span.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const paper = document.querySelector('#reader-page-stage').getBoundingClientRect();
    return { x: text.left - paper.left, y: text.top - paper.top, width: text.width, height: text.height };
  });
  const originalPageHeight = await stage(page).evaluate(element => element.clientHeight);
  await page.locator('#reader-rotate').click();
  await expect.poll(() => stage(page).evaluate(element => [element.clientWidth, element.clientHeight])).toEqual([800, 600]);
  await expect(stage(page)).toHaveAttribute('aria-busy', 'false');
  const expected = {
    x: originalPageHeight - original.y - original.height,
    y: original.x,
    width: original.height,
    height: original.width
  };
  const rotated = await relativeTextRect();
  for (const coordinate of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(rotated[coordinate] - expected[coordinate]), 'Rotated text ' + coordinate).toBeLessThan(1.1);
  }
  await span.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await expect(page.locator('#reader-highlight-selection')).toBeVisible();
  await page.locator('#reader-highlight-selection').click();
  await expect(annotations(page)).toHaveCount(1);
  const highlighted = await annotations(page).first().evaluate(element => {
    const mark = element.getBoundingClientRect();
    const paper = document.querySelector('#reader-page-stage').getBoundingClientRect();
    return { x: mark.left - paper.left, y: mark.top - paper.top, width: mark.width, height: mark.height };
  });
  const expectedSelection = {
    x: originalPageHeight - originalSelection.y - originalSelection.height,
    y: originalSelection.x,
    width: originalSelection.height,
    height: originalSelection.width
  };
  for (const coordinate of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(highlighted[coordinate] - expectedSelection[coordinate]), 'Rotated selection highlight ' + coordinate).toBeLessThan(1.1);
  }
  await page.screenshot({ path: info.outputPath('reader-rotated-native-selection.png'), animations: 'disabled', fullPage: true });
});

test('native text can be highlighted and the exported PDF keeps original pages and selectable text', async ({ context }, info) => {
  const { page } = await setup(context);
  await openFile(page, [passage, 'Export preserves this second page.']);
  const originalInk = await canvasInk(page);
  await page.locator('#reader-color').fill('#2563eb');
  await page.locator('[data-tool="select"]').click();
  await page.evaluate(text => {
    const span = [...document.querySelectorAll('#reader-text-layer span')].find(element => element.textContent === text);
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, passage);
  await expect(page.locator('#reader-highlight-selection')).toBeVisible();
  await page.locator('#reader-highlight-selection').click();
  await expect(annotations(page)).toHaveCount(1);
  await page.locator('#reader-width').selectOption('4');
  await draw(page, 'pen', [0.18, 0.4], [0.52, 0.47]);
  await expect(annotations(page)).toHaveCount(2);
  const note = 'یادداشت فارسی در PDF خروجی';
  await addNote(page, note);
  await expect(annotations(page)).toHaveCount(3);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#reader-export-pdf').click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(await download.failure()).toBeNull();
  const file = info.outputPath('annotated.pdf');
  await download.saveAs(file);
  const bytes = await fs.readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(pdfFixture([passage, 'Export preserves this second page.']).byteLength);
  await page.locator('#reader-file').setInputFiles(file);
  await expect(page.locator('#reader-status')).toBeHidden();
  await expect(page.locator('#reader-text-layer')).toContainText(passage);
  await expect.poll(() => canvasInk(page)).toBeGreaterThan(originalInk + 500);
  await page.getByRole('button', { name: 'خواندن یادداشت داخل PDF' }).click();
  await expect(page.locator('#reader-note-text')).toHaveValue(note);
  await expect(page.locator('#reader-note-text')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#reader-note-save')).toBeHidden();
  await page.locator('#reader-note-cancel').click();
  await page.locator('#reader-next-page').click();
  await expect(page.locator('#reader-page-number')).toHaveValue('2');
  await expect(page.locator('#reader-text-layer')).toContainText('Export preserves this second page.');
});

test('high resolution image-only scans render and accept marks without OCR or text extraction', async ({ context }, info) => {
  const { page } = await setup(context);
  await openFile(page, [{ largeImage: true }], 'high-resolution-scan.pdf');
  await expect(page.locator('#reader-text-layer span')).toHaveCount(0);
  await expect.poll(() => canvasInk(page)).toBeGreaterThan(1000);
  await draw(page, 'highlight');
  await expect(annotations(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('reader-high-resolution-scan.png'), animations: 'disabled', fullPage: true });
});

test('a failed annotation save preserves the open PDF and its marks until storage recovers', async ({ context }) => {
  const { page } = await setup(context);
  await openFile(page, [passage], 'first.pdf');
  const firstUrl = page.url();
  await page.evaluate(() => {
    window.restorePdfStorageSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = values => Object.keys(values).some(key => key.startsWith('rastin_pdf_annotations_'))
      ? Promise.reject(new Error('Simulated annotation storage failure'))
      : window.restorePdfStorageSet(values);
  });
  await draw(page, 'rect');
  await expect(annotations(page)).toHaveCount(1);
  await expect(page.locator('#reader-save-state')).toHaveAttribute('data-state', 'error');
  await page.locator('#reader-file').setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: pdfFixture(['The replacement document.']) });
  await expect(page.locator('#reader-status')).toContainText('سند قبلی باز ماند');
  await expect(page.locator('#reader-filename')).toHaveText('first.pdf');
  await expect(page.locator('#reader-text-layer')).toContainText(passage);
  await expect(annotations(page)).toHaveCount(1);
  expect(page.url()).toBe(firstUrl);
  await page.evaluate(() => { chrome.storage.local.set = window.restorePdfStorageSet; });
  await openFile(page, ['The replacement document.'], 'second.pdf');
  await expect(page.locator('#reader-filename')).toHaveText('second.pdf');
  await expect(annotations(page)).toHaveCount(0);
  await page.goto(firstUrl);
  await expect(annotations(page)).toHaveCount(1);
});

test('reader commands activate the native pen and persist drawings in the document storage', async ({ context }) => {
  const { page, worker } = await setup(context);
  await openFile(page, [passage]);
  const tabId = await page.evaluate(() => window.RtlFixer.readerTabId);
  const result = await page.evaluate(tabId => chrome.runtime.sendMessage({ action: 'readerCommand', tabId, command: { action: 'openPaint' } }), tabId);
  expect(result).toMatchObject({ ok: true });
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rtl-fixer-paint-host')).toHaveCount(0);
  await draw(page, 'pen');
  await expect(annotations(page)).toHaveCount(1);
  await expect.poll(async () => Boolean(await savedAnnotations(worker, page))).toBe(true);
});

test('missing cached documents and unsupported sources leave file selection available', async ({ context }) => {
  const { page, extensionId } = await setup(context);
  await page.goto('chrome-extension://' + extensionId + '/reader/viewer.html?document=' + 'a'.repeat(64));
  await expect(page.locator('#reader-status')).toContainText('همان فایل PDF را انتخاب کنید');
  await expect(page.locator('#reader-welcome')).toBeVisible();
  await page.goto('chrome-extension://' + extensionId + '/reader/viewer.html?file=' + encodeURIComponent('javascript:alert(1)'));
  await expect(page.locator('#reader-status')).toContainText('این نشانی قابل بازکردن نیست');
  await expect(page.locator('#reader-welcome')).toBeVisible();
});

test('literal PDF text stays inert in the native selection layer', async ({ context }) => {
  const { page } = await setup(context);
  const literal = '<script>window.pdfTextExecuted=true</script>';
  await openFile(page, [literal]);
  await expect(page.locator('#reader-text-layer')).toContainText(literal);
  expect(await page.evaluate(() => window.pdfTextExecuted)).toBeUndefined();
  await expect(page.locator('#reader-text-layer script')).toHaveCount(0);
});
