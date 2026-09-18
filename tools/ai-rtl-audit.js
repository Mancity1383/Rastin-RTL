import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..');
const liveTargets = process.argv[2] ? [{ name: 'User shared table', url: process.argv[2] }] : [
  { name: 'ChatGPT', url: 'https://chatgpt.com/fa-IR/pricing/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app?hl=fa' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/' }
];

const fixtureTargets = [
  { name: 'ChatGPT Markdown', url: 'https://chatgpt.com/__rastin_table_test__', wrapper: 'markdown prose' },
  { name: 'Claude response', url: 'https://claude.ai/__rastin_table_test__', wrapper: 'font-claude-response-body' },
  { name: 'Gemini response', url: 'https://gemini.google.com/__rastin_table_test__', wrapper: 'model-response-text' },
  { name: 'Perplexity answer', url: 'https://www.perplexity.ai/__rastin_table_test__', wrapper: 'prose answer-content' },
  { name: 'DeepSeek answer', url: 'https://chat.deepseek.com/__rastin_table_test__', wrapper: 'ds-markdown' }
];

const baseConfig = {
  enabled: false,
  alignmentMode: 'auto',
  inputsAutoDir: true,
  forceRightAlign: false,
  justifyText: false,
  fontFamily: 'System',
  fontWeight: '400',
  fontSizeAdjust: 0,
  lineHeightAdjust: 1.6,
  persianDigits: false,
  fixTables: true,
  fixListsBlockquotes: true,
  techCodeProtection: true,
  readingRulerEnabled: false,
  readingRulerFocus: false,
  focusCoachEnabled: false,
  readingProgressEnabled: false,
  bionicTextEnabled: false,
  allowCopyEnabled: false,
  translatorEnabled: false,
  highlightEnabled: false,
  adBlockEnabled: false
};

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const hostKey = url => `site_config_${new URL(url).hostname.toLowerCase().replace(/^www\./, '')}`;

async function setEnabled(url, enabled) {
  await worker.evaluate(({ key, config }) => chrome.storage.local.set({ [key]: config }), {
    key: hostKey(url),
    config: { ...baseConfig, enabled }
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const rtl = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    const tables = Array.from(document.querySelectorAll('table')).slice(0, 12).map(table => {
      const tableRect = table.getBoundingClientRect();
      const firstRow = table.querySelector('tr');
      const cells = firstRow ? Array.from(firstRow.children).filter(cell => /^(TH|TD)$/.test(cell.tagName)) : [];
      const headerCells = Array.from(table.querySelectorAll('thead tr:first-child > th, thead tr:first-child > td'));
      const bodyCells = Array.from(table.querySelectorAll('tbody tr:first-child > th, tbody tr:first-child > td'));
      const textOffset = cell => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getBoundingClientRect().left - cell.getBoundingClientRect().left;
      };
      const comparableCells = Math.min(headerCells.length, bodyCells.length);
      let alignmentMismatchCount = 0;
      for (let index = 0; index < comparableCells; index++) {
        if (Math.abs(textOffset(headerCells[index]) - textOffset(bodyCells[index])) > 3) {
          alignmentMismatchCount++;
        }
      }
      return {
        signature: Array.from(table.querySelectorAll('th,td')).slice(0, 12)
          .map(cell => (cell.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)),
        offsets: cells.map(cell => Math.round(cell.getBoundingClientRect().left - tableRect.left)),
        widths: cells.map(cell => Math.round(cell.getBoundingClientRect().width)),
        direction: getComputedStyle(table).direction,
        guarded: table.classList.contains('rtl-fixer-table-layout-guard'),
        alignmentMismatchCount
      };
    });
    const candidates = Array.from(document.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th'))
      .filter(element => rtl.test(element.textContent || ''));
    const wrong = candidates.filter(element => getComputedStyle(element).direction !== 'rtl');
    return {
      tables,
      rtlCandidateCount: candidates.length,
      wrongRtlLeafCount: wrong.length,
      wrongRtlLeafSamples: wrong.slice(0, 4).map(element => (element.textContent || '').trim().slice(0, 100)),
      englishFalsePositiveCount: Array.from(document.querySelectorAll('.rtl-fixer-rtl-detected'))
        .filter(element => !rtl.test(element.textContent || '')).length
    };
  });
}

function compareTables(before, after) {
  const comparable = Math.min(before.tables.length, after.tables.length);
  let stable = true;
  for (let index = 0; index < comparable; index++) {
    const a = before.tables[index];
    const b = after.tables[index];
    if (JSON.stringify(a.signature) !== JSON.stringify(b.signature) ||
        JSON.stringify(a.offsets) !== JSON.stringify(b.offsets) ||
        JSON.stringify(a.widths) !== JSON.stringify(b.widths)) {
      stable = false;
      break;
    }
  }
  return { comparableTableCount: comparable, stable };
}

function fixtureHtml(wrapper) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{background:#101010;color:#eee;font:16px Arial;margin:24px}.answer{max-width:960px;margin:auto}
    table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{padding:12px 18px;border-bottom:1px solid #333;text-align:start}
  </style></head><body><article class="answer ${wrapper}">جمع‌بندی نهایی گزینه‌ها
    <div style="overflow:auto"><table><thead><tr><th>رتبه</th><th>مدل</th><th>رایحه</th><th>نظر من</th></tr></thead>
    <tbody><tr><td>🥇</td><td>NIVEA MEN Deep Darkwood</td><td>مردانه، چوبی، اسپرت</td><td>بهترین انتخاب کلی</td></tr>
    <tr><td>🥈</td><td>Dove Men+Care Clean Comfort</td><td>تمیز، صابونی، شیک</td><td>خیلی شیک و همه‌پسند</td></tr></tbody></table></div>
  </article></body></html>`;
}

const results = [];
try {
  for (const target of liveTargets) {
    await setEnabled(target.url, false);
    const page = await context.newPage();
    try {
      const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1800);
      if (process.argv[2]) {
        await page.locator('table').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
        for (let step = 0; step < 8; step++) {
          await page.mouse.wheel(0, 1200);
          await page.waitForTimeout(200);
        }
      }
      const before = await snapshot(page);
      await setEnabled(target.url, true);
      await page.waitForTimeout(1800);
      const after = await snapshot(page);
      results.push({
        kind: 'live-public-page',
        name: target.name,
        status: response?.status(),
        finalUrl: page.url(),
        title: await page.title(),
        accessSummary: process.argv[2] ? (await page.locator('body').innerText()).slice(0, 500) : undefined,
        tableDetails: after.tables,
        ...compareTables(before, after),
        beforeTableCount: before.tables.length,
        afterTableCount: after.tables.length,
        rtlCandidateCount: after.rtlCandidateCount,
        wrongRtlLeafCount: after.wrongRtlLeafCount,
        englishFalsePositiveCount: after.englishFalsePositiveCount,
        alignmentMismatchCount: after.tables.reduce((sum, table) => sum + table.alignmentMismatchCount, 0)
      });
    } catch (error) {
      results.push({ kind: 'live-public-page', name: target.name, error: error.message });
    } finally {
      await page.close();
    }
  }

  for (const target of fixtureTargets) {
    await setEnabled(target.url, false);
    const page = await context.newPage();
    await page.route(target.url, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureHtml(target.wrapper)
    }));
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);
      const before = await snapshot(page);
      await setEnabled(target.url, true);
      await page.evaluate(() => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<table id="lazy-ai-table"><tbody><tr><td>نتیجه تازه</td><td>مدل تازه</td></tr></tbody></table>';
        document.querySelector('article').append(wrapper);
      });
      await page.waitForTimeout(800);
      const after = await snapshot(page);
      results.push({
        kind: 'host-specific-markdown-fixture',
        name: target.name,
        ...compareTables(before, after),
        guardedTableCount: after.tables.filter(table => table.guarded).length,
        lazyTableDirection: await page.locator('#lazy-ai-table').evaluate(table => getComputedStyle(table).direction),
        alignmentMismatchCount: after.tables.reduce((sum, table) => sum + table.alignmentMismatchCount, 0),
        rtlCandidateCount: after.rtlCandidateCount,
        wrongRtlLeafCount: after.wrongRtlLeafCount,
        wrongRtlLeafSamples: after.wrongRtlLeafSamples,
        englishFalsePositiveCount: after.englishFalsePositiveCount
      });
    } finally {
      await page.close();
    }
  }
} finally {
  console.log(JSON.stringify(results, null, 2));
  await context.close();
}
