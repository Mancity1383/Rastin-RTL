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

// A labeled corpus: punctuation, decimal digits and combining marks cannot
// supply a strong paragraph direction. Prose deliberately retains Rastin's
// Persian-sentence rule, which differs from an editor's first-strong heuristic.
const neutralTexts = [
  ['persian-digits', '۱۲۳۴۵۶۷۸۹۰'],
  ['arabic-digits', '١٢٣٤٥٦٧٨٩٠'],
  ['arabic-percent', '٪'],
  ['arabic-decimal', '٫'],
  ['arabic-thousands', '٬'],
  ['arabic-comma', '،'],
  ['arabic-semicolon', '؛'],
  ['arabic-question', '؟'],
  ['arabic-vowels', '\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652'],
  ['hebrew-niqqud', '\u05b0\u05b1\u05b2\u05b3\u05b4\u05b5\u05b6'],
  ['persian-price', '۱۲٬۳۴۵٫۶۷'],
  ['arabic-price', '١٢٬٣٤٥٫٦٧'],
  ['percent-number', '۶۰٪'],
  ['question-digits', '؟ ۱۲۳'],
  ['latin-status-persian-digits', 'Status: ۱۲'],
  ['latin-status-arabic-digits', 'Status: ١٢'],
  ['latin-status-comma', 'Status، active'],
  ['latin-status-question', 'Status؟ active'],
  ['latin-diacritics', 'Value \u064e\u0650: 20'],
  ['latin-niqqud', 'Value \u05b0\u05b1: 20'],
  ['leading-persian-digits', '۱۲۳ English text'],
  ['leading-arabic-digits', '١٢٣ English text'],
  ['leading-question', '؟ English text'],
  ['leading-comma', '، English text'],
  ['leading-percent', '٪ English text'],
  ['leading-vowels', '\u064e\u0650 English text'],
  ['leading-niqqud', '\u05b0\u05b1 English text'],
  ['english-arabic-percent', 'Progress ۶۰٪ complete']
].map(([id, text]) => ({ id, text, containsRtl: false, prose: false, direction: 'ltr' }));

const proseTexts = [
  ['persian', 'این متن فارسی است', 'rtl'],
  ['arabic', 'هذا نص عربي جميل', 'rtl'],
  ['hebrew', 'שלום עולם', 'rtl'],
  ['persian-with-diacritics', 'سَلام دنیا', 'rtl'],
  ['hebrew-with-niqqud', 'שָׁלוֹם עוֹלָם', 'rtl'],
  ['persian-leading-digits', '۱۲۳ این متن فارسی است', 'rtl'],
  ['persian-leading-symbols', '🙂 • ۶۰٪، این متن فارسی است', 'rtl'],
  ['english-product-persian', 'GPT-5.2 این متن فارسی است', 'rtl'],
  ['long-english-name', 'Wound Tissue Segmentation توضیح', 'ltr'],
  ['very-short-persian-suffix', 'Very long English product title عالی', 'ltr'],
  ['persian-zwnj', 'می‌توانیم این متن را بخوانیم', 'rtl'],
  ['persian-mixed', 'سلام API و 123 دنیا', 'rtl'],
  ['single-persian-letter', 'ب', 'rtl'],
  ['arabic-presentation-form', '\ufefb', 'rtl'],
  ['hebrew-presentation-form', '\ufb2a', 'rtl'],
  ['mixed-persian-latin', 'سلام Hello world', 'rtl']
].map(([id, text, direction]) => ({ id, text, containsRtl: true, prose: true, direction }));

const otherScripts = [
  { id: 'greek-isolated-rtl-letter', text: 'Ελληνικά س', containsRtl: true, prose: false, direction: 'ltr' },
  { id: 'cyrillic-isolated-rtl-letter', text: 'Русский ب', containsRtl: true, prose: false, direction: 'ltr' },
  { id: 'cjk-isolated-rtl-letter', text: '中文测试 ب', containsRtl: true, prose: false, direction: 'ltr' },
  { id: 'plain-english', text: 'English prose with a colon:', containsRtl: false, prose: false, direction: 'ltr' },
  { id: 'plain-greek', text: 'Ελληνικά', containsRtl: false, prose: false, direction: 'ltr' },
  { id: 'plain-cyrillic', text: 'Русский язык', containsRtl: false, prose: false, direction: 'ltr' },
  { id: 'plain-cjk', text: '中文测试', containsRtl: false, prose: false, direction: 'ltr' },
  { id: 'neutral-symbols', text: '🙂 + × ÷ = 20', containsRtl: false, prose: false, direction: 'ltr' }
];

const corpus = [...neutralTexts, ...proseTexts, ...otherScripts];

test('Labeled RTL corpus distinguishes strong letters from numbers, punctuation and marks', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'quality-corpus');
  const results = await worker.evaluate(({ tabId, cases }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [cases], func: cases => cases.map(entry => ({
      id: entry.id, text: entry.text,
      expected: { containsRtl: entry.containsRtl, prose: entry.prose, direction: entry.direction },
      actual: {
        containsRtl: window.RtlFixer.containsRtl(entry.text),
        prose: window.RtlFixer.isRtlProse(entry.text),
        direction: window.RtlFixer.detectParagraphDirection(entry.text)
      }
    }))
  }).then(results => results[0].result), { tabId, cases: corpus });
  const mismatches = results.filter(entry => JSON.stringify(entry.actual) !== JSON.stringify(entry.expected));
  const report = { total: results.length, correct: results.length - mismatches.length, incorrect: mismatches.length, cases: results };
  if (process.env.RTL_QUALITY_REPORT) {
    const output = path.resolve(process.env.RTL_QUALITY_REPORT);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`RTL quality corpus: ${report.correct}/${report.total} correct, ${report.incorrect} mismatches`);
  if (!process.env.RTL_QUALITY_ALLOW_FAILURES) expect(mismatches).toEqual([]);
  await page.close();
});

test('Neutral streaming content restores prose direction without replacing text nodes', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'quality-stream');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'neutral-stream'; p.setAttribute('dir', 'auto'); p.style.textAlign = 'center';
    const strong = document.createElement('strong'); strong.append('Loading status');
    p.append(strong, ' ۱۲'); document.getElementById('chat').append(p);
    const ready = document.createElement('p'); ready.id = 'quality-ready'; ready.textContent = 'متن فارسی آماده است';
    document.getElementById('chat').append(ready);
    window.__neutralStreamNodes = { p, strong, leading: strong.firstChild, tail: p.lastChild };
  });
  const initialStyle = await page.locator('#neutral-stream').getAttribute('style');
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#quality-ready')).toHaveAttribute('dir', 'rtl');
  await expect.poll(() => page.locator('#neutral-stream').getAttribute('dir')).toBe('auto');
  await expect(page.locator('#neutral-stream')).not.toHaveClass(/rtl-fixer-target/);
  await page.evaluate(() => { window.__neutralStreamNodes.leading.data = 'این متن فارسی است'; });
  await expect(page.locator('#neutral-stream')).toHaveAttribute('dir', 'rtl');
  await page.evaluate(() => { window.__neutralStreamNodes.leading.data = 'English status'; });
  await expect(page.locator('#neutral-stream')).toHaveAttribute('dir', 'auto');
  await expect(page.locator('#neutral-stream')).not.toHaveClass(/rtl-fixer-target/);
  await expect(page.locator('#neutral-stream')).toHaveAttribute('style', initialStyle);
  expect(await page.evaluate(() => {
    const { p, strong, leading, tail } = window.__neutralStreamNodes;
    return p.firstChild === strong && strong.firstChild === leading && p.lastChild === tail && leading.isConnected && tail.isConnected;
  })).toBe(true);
  await page.close();
});

test('Typing digit-prefixed English in light and shadow editors retains LTR input direction', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'quality-editor');
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'neutral-editor'; input.setAttribute('dir', 'auto');
    input.value = '۱۲۳ English message'; document.getElementById('chat').append(input);
    const host = document.createElement('div'); host.id = 'neutral-shadow-editor'; document.getElementById('chat').append(host);
    const editor = document.createElement('div'); editor.contentEditable = 'plaintext-only'; editor.setAttribute('dir', 'auto');
    editor.append('١٢٣ English message'); host.attachShadow({ mode: 'open' }).append(editor);
    window.__neutralEditors = { input, host, editor };
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#neutral-editor')).toHaveAttribute('dir', 'ltr');
  await expect.poll(() => page.evaluate(() => window.__neutralEditors.editor.getAttribute('dir'))).toBe('ltr');
  await page.evaluate(() => {
    for (const editor of [window.__neutralEditors.input, window.__neutralEditors.editor]) {
      if (editor.tagName === 'INPUT') editor.value = '۱۲۳ سلام دنیا';
      else editor.firstChild.data = '١٢٣ سلام دنیا';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
  });
  await expect(page.locator('#neutral-editor')).toHaveAttribute('dir', 'rtl');
  await expect.poll(() => page.evaluate(() => window.__neutralEditors.editor.getAttribute('dir'))).toBe('rtl');
  await page.evaluate(() => {
    for (const editor of [window.__neutralEditors.input, window.__neutralEditors.editor]) {
      if (editor.tagName === 'INPUT') editor.value = '؟ English message';
      else editor.firstChild.data = '٪ English message';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
  });
  await expect(page.locator('#neutral-editor')).toHaveAttribute('dir', 'ltr');
  await expect.poll(() => page.evaluate(() => window.__neutralEditors.editor.getAttribute('dir'))).toBe('ltr');
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#neutral-editor')).toHaveAttribute('dir', 'auto');
  await expect.poll(() => page.evaluate(() => window.__neutralEditors.editor.getAttribute('dir'))).toBe('auto');
  await expect(page.locator('#neutral-shadow-editor')).not.toHaveAttribute('style', /.+/);
  await page.close();
});

test('Numeric and punctuation-only table cells keep their LTR order around a streamed Persian cell', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'quality-table');
  await page.evaluate(() => {
    const table = document.createElement('table'); table.id = 'neutral-table';
    table.style.cssText = 'direction:ltr;table-layout:fixed;width:640px';
    table.innerHTML = '<tbody><tr><td id="table-stream">۱۲٬۳۴۵٫۶۷</td><td>١٢٣٤٥</td><td>٪</td><td>؟</td></tr></tbody>';
    document.getElementById('chat').append(table);
    const ready = document.createElement('p'); ready.id = 'quality-table-ready'; ready.textContent = 'متن فارسی آماده است';
    document.getElementById('chat').append(ready);
    window.__neutralTableNode = document.getElementById('table-stream').firstChild;
  });
  const before = await page.locator('#neutral-table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left));
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#quality-table-ready')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#neutral-table td.rtl-fixer-target')).toHaveCount(0);
  await page.evaluate(() => { window.__neutralTableNode.data = 'مدل Wound Segmentation برای متن فارسی'; });
  await expect(page.locator('#table-stream')).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('#neutral-table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left))).toEqual(before);
  await page.evaluate(() => { window.__neutralTableNode.data = '۱۲٬۳۴۵٫۶۷'; });
  await expect(page.locator('#table-stream')).not.toHaveAttribute('dir', /.+/);
  await expect(page.locator('#neutral-table td.rtl-fixer-target')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('table-stream').firstChild === window.__neutralTableNode)).toBe(true);
  await page.close();
});
