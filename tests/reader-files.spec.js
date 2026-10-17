/* oxlint-disable react-hooks/rules-of-hooks -- Playwright extension fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { persianPdf, scannedPdf } from './fixtures/reader-pdf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1440, height: 1000 },
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    try { await use(context); } finally { await context.close(); }
  }
});

async function setup(context) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false, adBlockEnabled: false }));
  const page = await context.newPage();
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/reader/viewer.html');
  await page.evaluate(() => window.RtlFixer.readerReady);
  return { page, worker };
}

const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const marks = page => page.locator('#reader-annotation-layer [data-annotation-id]:not([data-annotation-draft])');
const upload = (buffer, name = 'document.pdf', mimeType = 'application/pdf') => ({ name, mimeType, buffer });

// A genuine standard-security R2 PDF exercises password retries and cancellation,
// including real stream decryption rather than an empty Encrypt placeholder.
function encryptedPdf(password = 'reader-pass') {
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const pad = text => Buffer.concat([Buffer.from(text, 'latin1'), padding]).subarray(0, 32);
  const md5 = bytes => createHash('md5').update(bytes).digest();
  const rc4 = (key, bytes) => {
    const state = Uint8Array.from({ length: 256 }, (_, index) => index);
    let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
    const output = Buffer.alloc(bytes.length); let i = 0; j = 0;
    for (let n = 0; n < bytes.length; n++) {
      i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]];
      output[n] = bytes[n] ^ state[(state[i] + state[j]) & 255];
    }
    return output;
  };
  const owner = rc4(md5(pad('fixture-owner-password')).subarray(0, 5), pad(password));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const id = md5(Buffer.from('reader-password-fixture'));
  const key = md5(Buffer.concat([pad(password), owner, permissions, id])).subarray(0, 5);
  const user = rc4(key, padding);
  const objectNumber = Buffer.from([5, 0, 0, 0, 0]);
  const stream = rc4(md5(Buffer.concat([key, objectNumber])).subarray(0, 10), Buffer.from('BT /F1 18 Tf 40 700 Td (Password protected source) Tj ET'));
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [4 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`)
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length += chunk.length;
  }
  const xref = offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString('hex')}><${id.toString('hex')}>] >>\nstartxref\n${length}\n%%EOF`));
  return Buffer.concat(chunks);
}

async function loaded(page, buffer, name) {
  await expect.poll(() => new URL(page.url()).searchParams.get('document')).toBe(hash(buffer));
  await expect(page.locator('#reader-page-stage')).toBeVisible();
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#reader-export-pdf')).toBeEnabled();
  await expect(page.locator('#reader-upload-status')).toBeHidden();
  if (name) await expect(page.locator('#reader-filename')).toHaveText(name);
}

async function chooser(page, selector, key) {
  const opened = page.waitForEvent('filechooser');
  if (key) { await page.locator(selector).focus(); await page.keyboard.press(key); }
  else await page.locator(selector).click();
  const fileChooser = await opened;
  expect(fileChooser.isMultiple()).toBe(false);
  return fileChooser;
}

async function draw(page) {
  await page.locator('[data-tool="rect"]').click();
  const box = await page.locator('#reader-page-stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 12 });
  await page.mouse.up();
  await expect(marks(page)).toHaveCount(1);
}

async function drop(page, files) {
  const transfer = await page.evaluateHandle(records => {
    const data = new DataTransfer();
    for (const record of records) data.items.add(new File([Uint8Array.from(record.bytes)], record.name, { type: record.type }));
    return data;
  }, files.map(file => ({ name: file.name, type: file.mimeType, bytes: [...file.buffer] })));
  try {
    await page.locator('body').dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(page.locator('body')).toHaveClass(/dragging/);
    await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.locator('body')).not.toHaveClass(/dragging/);
  } finally { await transfer.dispose(); }
}

test('welcome and header buttons open the actual chooser, including SVG clicks, Enter and Space', async ({ context }) => {
  const { page } = await setup(context);
  const first = scannedPdf();
  await (await chooser(page, '#reader-open-file', 'Control+KeyO')).setFiles([]);
  await expect(page.locator('#reader-welcome')).toBeVisible();
  await (await chooser(page, '#reader-open-file-welcome svg')).setFiles(upload(first, 'فایل فارسی.pdf'));
  await loaded(page, first, 'فایل فارسی.pdf');
  await expect(page.locator('#reader-file')).toHaveValue('');
  await (await chooser(page, '#reader-open-file svg')).setFiles(upload(first, 'فایل فارسی.pdf'));
  await loaded(page, first, 'فایل فارسی.pdf');
  for (const key of ['Enter', 'Space']) {
    const next = await persianPdf(context, key === 'Enter' ? 2 : 3);
    await (await chooser(page, '#reader-open-file', key)).setFiles(upload(next, key + '.pdf'));
    await loaded(page, next, key + '.pdf');
  }
  await page.goto(page.url().split('?')[0]);
  await page.evaluate(() => window.RtlFixer.readerReady);
  for (const key of ['Enter', 'Space']) {
    await (await chooser(page, '#reader-open-file-welcome', key)).setFiles([]);
    await expect(page.locator('#reader-welcome')).toBeVisible();
    await expect(page.locator('#reader-upload-status')).toBeHidden();
  }
});

test('cancelling a chooser and choosing the same file again preserve saved annotations', async ({ context }) => {
  const { page } = await setup(context);
  const bytes = scannedPdf();
  await (await chooser(page, '#reader-open-file-welcome')).setFiles(upload(bytes));
  await loaded(page, bytes);
  await draw(page);
  const url = page.url();
  await (await chooser(page, '#reader-open-file')).setFiles([]);
  await page.locator('#reader-file').dispatchEvent('cancel');
  expect(page.url()).toBe(url);
  await expect(marks(page)).toHaveCount(1);
  await expect(page.locator('#reader-upload-status')).toBeHidden();
  await (await chooser(page, '#reader-open-file')).setFiles(upload(bytes));
  await loaded(page, bytes);
  await expect(marks(page)).toHaveCount(1);
  await expect(page.locator('#reader-file')).toHaveValue('');
});

test('drag and drop recognizes PDF content when browser MIME metadata is missing or wrong', async ({ context }) => {
  const { page } = await setup(context);
  const bytes = scannedPdf();
  for (const [name, mime] of [['empty-mime.pdf', ''], ['wrong-mime.PDF', 'application/octet-stream']]) {
    await drop(page, [upload(bytes, name, mime)]);
    await loaded(page, bytes, name);
    await expect(page.locator('#reader-status')).toBeHidden();
  }
});

test('invalid content, malformed PDFs and multiple dropped files leave the current PDF and marks intact', async ({ context }) => {
  const { page } = await setup(context);
  const bytes = scannedPdf();
  await page.locator('#reader-file').setInputFiles(upload(bytes, 'original.pdf'));
  await loaded(page, bytes, 'original.pdf');
  await draw(page);
  const url = page.url();
  const failures = [
    [upload(Buffer.from('<html>This is not a PDF.</html>'), 'misleading.pdf')],
    [upload(Buffer.from('%PDF-1.7\nBroken PDF with no trailer or pages.'), 'broken.pdf')],
    [upload(bytes, 'first.pdf'), upload(bytes, 'second.pdf')],
    [upload(Buffer.alloc(0), 'empty.pdf')]
  ];
  for (const files of failures) {
    await drop(page, files);
    await expect(page.locator('#reader-status')).toBeVisible();
    await expect(page.locator('#reader-status')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('#reader-upload-status')).toBeHidden();
    expect(page.url()).toBe(url);
    await expect(page.locator('#reader-filename')).toHaveText('original.pdf');
    await expect(marks(page)).toHaveCount(1);
    await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#reader-export-pdf')).toBeEnabled();
  }
  await expect(page.locator('#reader-status')).toContainText(/حجم|خالی/);
});

test('password cancellation preserves the old PDF and retrying a real password opens the encrypted document', async ({ context }) => {
  const { page } = await setup(context);
  const original = scannedPdf(), protectedPdf = encryptedPdf();
  await page.locator('#reader-file').setInputFiles(upload(original, 'original.pdf'));
  await loaded(page, original, 'original.pdf');
  await draw(page);
  const url = page.url();
  await (await chooser(page, '#reader-open-file')).setFiles(upload(protectedPdf, 'protected.pdf'));
  await expect(page.locator('#reader-password-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader-password-dialog')).toBeHidden();
  await expect(page.locator('#reader-upload-status')).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(marks(page)).toHaveCount(1);
  await (await chooser(page, '#reader-open-file')).setFiles(upload(protectedPdf, 'protected.pdf'));
  await expect(page.locator('#reader-password-dialog')).toBeVisible();
  await page.locator('#reader-password').fill('wrong-password');
  await page.locator('#reader-password').press('Enter');
  await expect(page.locator('#reader-password-message')).toContainText('درست نیست');
  await page.locator('#reader-password').fill('reader-pass');
  await page.locator('#reader-password').press('Enter');
  await loaded(page, protectedPdf, 'protected.pdf');
  await expect(page.locator('#reader-text-layer')).toContainText('Password protected source');
  await expect(marks(page)).toHaveCount(0);
});

test('cancelling a pending source download aborts it and a newly selected local PDF remains active', async ({ context }) => {
  let release, arrived;
  const held = new Promise(resolve => { release = resolve; });
  const requestArrived = new Promise(resolve => { arrived = resolve; });
  const remote = scannedPdf();
  await context.route('https://example.com/slow-reader-source.pdf', async route => {
    arrived();
    await held;
    await route.fulfill({ contentType: 'application/pdf', body: remote }).catch(() => {});
  });
  const { page } = await setup(context);
  try {
    await page.goto(page.url() + '?file=' + encodeURIComponent('https://example.com/slow-reader-source.pdf'));
    await requestArrived;
    await expect(page.locator('#reader-upload-status')).toBeVisible();
    await expect(page.locator('#reader-cancel-load')).toBeVisible();
    const aborted = page.waitForEvent('requestfailed', { predicate: request => request.url() === 'https://example.com/slow-reader-source.pdf' });
    await page.locator('#reader-cancel-load').click();
    await expect(page.locator('#reader-upload-status')).toBeHidden();
    await expect(page.locator('#reader-welcome')).toBeVisible();
    release();
    await aborted;
    const local = await persianPdf(context, 2);
    await (await chooser(page, '#reader-open-file-welcome')).setFiles(upload(local, 'new-local.pdf'));
    await loaded(page, local, 'new-local.pdf');
    await expect(page.locator('#reader-page-count')).toContainText('۲');
    await expect(page.locator('#reader-status')).toBeHidden();
  } finally { release(); }
});

test('reader keyboard shortcuts undo and redo real marks, zoom with Shift +/- and navigate within page bounds', async ({ context }) => {
  const { page } = await setup(context);
  const bytes = await persianPdf(context, 3);
  await page.locator('#reader-file').setInputFiles(upload(bytes));
  await loaded(page, bytes);
  await draw(page);
  await page.keyboard.press('Control+KeyZ');
  await expect(marks(page)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(marks(page)).toHaveCount(1);
  await page.keyboard.press('Control+KeyZ');
  await expect(marks(page)).toHaveCount(0);
  await page.keyboard.press('Control+KeyY');
  await expect(marks(page)).toHaveCount(1);
  await page.locator('#reader-zoom').selectOption('1');
  await page.locator('[data-tool="select"]').click();
  await page.keyboard.press('Shift+Equal');
  await expect(page.locator('#reader-zoom')).toHaveValue('1.25');
  await page.keyboard.press('Shift+Minus');
  await expect(page.locator('#reader-zoom')).toHaveValue('1');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#reader-page-number')).toHaveValue('2');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#reader-page-number')).toHaveValue('3');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#reader-page-number')).toHaveValue('3');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#reader-page-number')).toHaveValue('2');
  await page.keyboard.press('PageUp');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(marks(page)).toHaveCount(1);
});

test('shortcuts respect note editing and native form control keys', async ({ context }) => {
  const { page } = await setup(context);
  const bytes = await persianPdf(context, 3);
  await page.locator('#reader-file').setInputFiles(upload(bytes));
  await loaded(page, bytes);
  await draw(page);
  await page.locator('[data-tool="note"]').click();
  const box = await page.locator('#reader-page-stage').boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await expect(page.locator('#reader-note-dialog')).toBeVisible();
  await page.locator('#reader-note-text').fill('یادداشت فارسی\nخط دوم');
  const zoom = await page.locator('#reader-zoom').inputValue();
  for (const key of ['Control+KeyZ', 'Control+KeyY', 'Shift+Equal', 'Shift+Minus', 'ArrowDown', 'ArrowUp', 'PageDown']) await page.keyboard.press(key);
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await expect(page.locator('#reader-zoom')).toHaveValue(zoom);
  await expect(marks(page)).toHaveCount(1);
  await expect(page.locator('#reader-note-dialog')).toBeVisible();
  await page.locator('#reader-note-cancel').click();
  await page.locator('#reader-width').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#reader-width')).toHaveValue('4');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
});

test('rapid zoom shortcuts keep the latest requested scale and preserve the reading position', async ({ context }, info) => {
  const { page } = await setup(context);
  await page.locator('#reader-file').setInputFiles(upload(await persianPdf(context, 3)));
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#reader-export-pdf')).toBeEnabled();
  await page.locator('#reader-zoom').selectOption('1');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  const baseWidth = await page.locator('#reader-page-stage').evaluate(stage => stage.clientWidth);
  await draw(page);
  await page.locator('[data-tool="select"]').click();
  const burst = async (key, code, count) => page.evaluate(({ key, code, count }) => {
    for (let index = 0; index < count; index++) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key, code, shiftKey: true, bubbles: true, cancelable: true
    }));
  }, { key, code, count });
  await burst('+', 'Equal', 4);
  await expect(page.locator('#reader-zoom')).toHaveValue('3');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  expect(await page.locator('#reader-page-stage').evaluate(stage => stage.clientWidth)).toBeCloseTo(baseWidth * 3, 0);
  await expect(marks(page)).toHaveCount(1);
  await burst('_', 'Minus', 4);
  await expect(page.locator('#reader-zoom')).toHaveValue('1');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#reader-zoom').selectOption('2');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-tool="select"]').click();
  await page.locator('#reader-paper-scroll').evaluate(pane => { pane.scrollTop = 300; pane.scrollLeft = 100; });
  const center = () => page.evaluate(() => {
    const pane = document.getElementById('reader-paper-scroll'), box = pane.getBoundingClientRect();
    const paper = document.getElementById('reader-page-stage').getBoundingClientRect();
    return { x: (box.left + pane.clientWidth / 2 - paper.left) / paper.width,
      y: (box.top + pane.clientHeight / 2 - paper.top) / paper.height };
  });
  const before = await center();
  await page.keyboard.press('Shift+Equal');
  await expect(page.locator('#reader-zoom')).toHaveValue('3');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  const after = await center();
  expect(after.x).toBeCloseTo(before.x, 2); expect(after.y).toBeCloseTo(before.y, 2);
  const paneBox = await page.locator('#reader-paper-scroll').boundingBox();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.locator('#reader-zoom')).toHaveValue('4');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  const wheel = await center();
  expect(wheel.x).toBeCloseTo(after.x, 2); expect(wheel.y).toBeCloseTo(after.y, 2);
  await page.keyboard.press('Control+Digit0');
  await expect(page.locator('#reader-zoom')).toHaveValue('page-fit');
  await page.keyboard.press('Control+Digit1');
  await expect(page.locator('#reader-zoom')).toHaveValue('1');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await expect(marks(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('reader-shortcuts.png'), animations: 'disabled' });
});

test('Persian page numbers, cross-page history and Ctrl+S operate on the real original PDF', async ({ context }, info) => {
  const { page } = await setup(context);
  await page.locator('#reader-file').setInputFiles(upload(await persianPdf(context, 3), 'مطالعه.pdf'));
  await expect(page.locator('#reader-export-pdf')).toBeEnabled();
  await page.keyboard.press('Control+KeyG');
  await expect(page.locator('#reader-page-number')).toBeFocused();
  await page.locator('#reader-page-number').fill('۳'); await page.keyboard.press('Enter');
  await expect(page.locator('#reader-page-number')).toHaveValue('3');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await draw(page);
  await page.keyboard.press('Home');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await page.keyboard.press('Control+KeyZ');
  await expect(page.locator('#reader-annotation-count')).toHaveText('۰');
  await page.keyboard.press('End');
  await expect(page.locator('#reader-page-number')).toHaveValue('3');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'غ', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true
  })));
  await expect(marks(page)).toHaveCount(1);
  const downloaded = page.waitForEvent('download');
  await page.keyboard.press('Control+KeyS');
  const download = await downloaded, output = info.outputPath('keyboard-annotated.pdf');
  expect(download.suggestedFilename()).toBe('مطالعه-annotated.pdf');
  await download.saveAs(output);
  const bytes = await fs.readFile(output);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const exported = await page.evaluate(async bytes => {
    const { getDocument } = await import(chrome.runtime.getURL('vendor/pdfjs/pdf.mjs'));
    const task = getDocument({ data: Uint8Array.from(bytes) }), doc = await task.promise;
    try { return { pages: doc.numPages, annotations: (await (await doc.getPage(3)).getAnnotations()).length }; }
    finally { await task.destroy(); }
  }, [...bytes]);
  expect(exported.pages).toBe(3); expect(exported.annotations).toBeGreaterThan(0);
  await page.keyboard.press('Control+KeyG');
  await page.locator('#reader-page-number').fill('٩٩'); await page.keyboard.press('Enter');
  await expect(page.locator('#reader-page-number')).toHaveValue('3');
  await page.keyboard.press('Control+KeyG');
  await page.locator('#reader-page-number').fill('0'); await page.keyboard.press('Enter');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
  await page.keyboard.press('Control+KeyG');
  await page.locator('#reader-page-number').fill('2'); await page.keyboard.press('Escape');
  await expect(page.locator('#reader-page-number')).toHaveValue('1');
});

test('reader view shortcuts, fullscreen and the visible keyboard guide work after toolbar clicks', async ({ context }) => {
  const { page } = await setup(context);
  await page.locator('#reader-file').setInputFiles(upload(await persianPdf(context, 3)));
  await expect(page.locator('#reader-export-pdf')).toBeEnabled();
  await page.locator('[data-tool="select"]').click();
  await page.keyboard.press('KeyW');
  await expect(page.locator('#reader-zoom')).toHaveValue('page-width');
  await page.keyboard.press('Control+Digit1');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  const size = await page.locator('#reader-page-stage').evaluate(stage => [stage.clientWidth, stage.clientHeight]);
  await page.keyboard.press('Shift+KeyR');
  await expect(page.locator('#reader-page-stage')).toHaveAttribute('aria-busy', 'false');
  const rotated = await page.locator('#reader-page-stage').evaluate(stage => [stage.clientWidth, stage.clientHeight]);
  expect(rotated[0]).toBeCloseTo(size[1], 0); expect(rotated[1]).toBeCloseTo(size[0], 0);
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('reader-canvas-view');
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await page.keyboard.press('F1');
  await expect(page.locator('#reader-help-menu')).toBeVisible();
  await expect(page.locator('#reader-help-menu')).toContainText('Ctrl+G');
  await expect(page.locator('#reader-help-menu')).toContainText('Ctrl+S');
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader-help-menu')).toBeHidden();
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
});
