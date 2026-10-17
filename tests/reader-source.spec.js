/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phrase = 'سلام دنیا';
// PDF character codes map to Persian through ToUnicode. PDF.js supplies its own
// bidi handling and selection geometry; the reader must never reflow or fix it.
function unicodePdf() {
  const text = 'BT /F1 18 Tf 40 700 Td (HGFE DCBA) Tj ET';
  const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PersianTest def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n9 beginbfchar\n<41> <0633>\n<42> <0644>\n<43> <0627>\n<44> <0645>\n<20> <0020>\n<45> <062F>\n<46> <0646>\n<47> <06CC>\n<48> <0627>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium',
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    try { await use(context); } finally { await context.close(); }
  }
});
async function reader(context, source) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, adBlockEnabled: false, site_config_reader: { enabled: true } }));
  const page = await context.newPage();
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/reader/viewer.html?file=' + encodeURIComponent(source));
  return { page, worker };
}

test('web PDFs keep Persian Unicode selection geometry independent of webpage RTL changes', async ({ context }) => {
  await context.route('https://example.com/persian.pdf', route => route.fulfill({ contentType: 'application/pdf', body: unicodePdf() }));
  const { page, worker } = await reader(context, 'https://example.com/persian.pdf');
  const span = page.locator('#reader-text-layer span').filter({ hasText: phrase }).first();
  await expect(span).toHaveText(phrase);
  await expect(span).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(span).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#reader-canvas')).toBeVisible();
  await expect(page.locator('.reader-paragraph, #reader-enabled')).toHaveCount(0);
  await expect(page.locator('#reader-text-layer .rtl-fixer-target')).toHaveCount(0);
  const geometry = await span.evaluate(element => ({ left: element.style.left, top: element.style.top, transform: element.style.transform }));
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false, site_config_reader: { enabled: false } }));
  await expect(span).toHaveText(phrase);
  expect(await span.evaluate(element => ({ left: element.style.left, top: element.style.top, transform: element.style.transform }))).toEqual(geometry);
  await expect(page.locator('[data-tool="highlight"]')).toBeEnabled();
});

test('local PDF sources remain cached as native pages after reload', async ({ context }, info) => {
  const file = info.outputPath('persian.pdf');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, unicodePdf());
  const { page } = await reader(context, pathToFileURL(file).href);
  await expect(page.locator('#reader-text-layer')).toContainText(phrase);
  await expect(page.locator('#reader-canvas')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('file')).toBe(false);
  const saved = page.url();
  await page.reload();
  await expect(page.locator('#reader-text-layer')).toContainText(phrase);
  expect(page.url()).toBe(saved);
  await expect(page.locator('.reader-paragraph')).toHaveCount(0);
});
