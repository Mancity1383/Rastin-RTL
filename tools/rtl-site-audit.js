import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..');
const targets = [
  { name: 'GitHub Persian README', url: 'https://github.com/mmnaderi/codex-rtl' },
  { name: 'Telegram Persian channel', url: 'https://t.me/s/virgool_io?before=40' },
  { name: 'Persian Wikipedia', url: 'https://fa.wikipedia.org/wiki/%D8%B2%D8%A8%D8%A7%D9%86_%D9%81%D8%A7%D8%B1%D8%B3%DB%8C' },
  { name: 'Virgool feed', url: 'https://virgool.io/?page=43' }
];

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

await context.addInitScript(() => {
  window.__rtlAuditLongTasks = [];
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__rtlAuditLongTasks.push(entry.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) {}
});

const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const results = [];

for (const target of targets) {
  const host = new URL(target.url).hostname.replace(/^www\./, '');
  await worker.evaluate(({ host }) => chrome.storage.local.set({
    [`site_config_${host}`]: {
      enabled: true,
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
    }
  }), { host });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__rtlAuditLongTasks = []; });

    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(750);

    const audit = await page.evaluate(() => {
      const rtlRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/;
      const ltrRegex = /[A-Za-z]/g;
      const rtlGlobal = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/g;
      const proseTags = /^(P|LI|H[1-6]|BLOCKQUOTE|TD|TH|DT|DD)$/;
      const candidates = Array.from(document.querySelectorAll('body *')).filter(element => {
        if (element.closest('pre,code,[contenteditable="true"],[role="math"],math')) return false;
        const text = proseTags.test(element.tagName)
          ? (element.textContent?.trim() || '')
          : Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent)
            .join(' ')
            .trim();
        const rtl = (text.match(rtlGlobal) || []).length;
        const ltr = (text.match(ltrRegex) || []).length;
        return text.length >= 4 && rtlRegex.test(text) && (rtl >= 2 || rtl > ltr);
      });
      const wrongDirection = candidates.filter(element => getComputedStyle(element).direction !== 'rtl');
      const falsePositiveEnglish = Array.from(document.querySelectorAll('.rtl-fixer-rtl-detected')).filter(element => {
        const text = element.textContent?.trim() || '';
        return text && !rtlRegex.test(text);
      });
      const alteredStructures = Array.from(document.querySelectorAll('table,thead,tbody,tfoot,tr')).filter(element =>
        element.classList.contains('rtl-fixer-target')
      );
      const codeDirectionFailures = Array.from(document.querySelectorAll('.rtl-fixer-target code, .rtl-fixer-target pre'))
        .filter(element => getComputedStyle(element).direction !== 'ltr');
      const longTasks = window.__rtlAuditLongTasks || [];
      return {
        title: document.title,
        candidateCount: candidates.length,
        extensionAppliedCount: candidates.filter(element => element.classList.contains('rtl-fixer-rtl-detected')).length,
        wrongDirectionCount: wrongDirection.length,
        wrongDirectionSamples: wrongDirection.slice(0, 3).map(element => element.textContent.trim().slice(0, 100)),
        falsePositiveEnglishCount: falsePositiveEnglish.length,
        falsePositiveEnglishSamples: falsePositiveEnglish.slice(0, 5).map(element => element.textContent.trim().slice(0, 100)),
        alteredStructureCount: alteredStructures.length,
        codeDirectionFailureCount: codeDirectionFailures.length,
        longTaskCount: longTasks.length,
        maxLongTaskMs: longTasks.length ? Math.round(Math.max(...longTasks) * 10) / 10 : 0,
        totalLongTaskMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0) * 10) / 10
      };
    });
    results.push({ name: target.name, url: page.url(), ...audit, pageErrors: consoleErrors.slice(0, 3) });
  } catch (error) {
    results.push({ name: target.name, url: target.url, error: error.message, pageErrors: consoleErrors.slice(0, 3) });
  } finally {
    await page.close();
  }
}

console.log(JSON.stringify(results, null, 2));
await context.close();
