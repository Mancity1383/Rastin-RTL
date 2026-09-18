import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..');
const redditPosts = [
  {
    name: 'r/farsi Persian title',
    url: 'https://embed.reddit.com/r/farsi/comments/fj9ddb/?ref_source=embed&ref=share&embed=true'
  },
  {
    name: 'r/NewIran Persian post body',
    url: 'https://embed.reddit.com/r/NewIran/comments/1fol902/?ref_source=embed&ref=share&embed=true'
  },
  {
    name: 'r/farsi mixed Persian list',
    url: 'https://embed.reddit.com/r/farsi/comments/1p2lni0/?ref_source=embed&ref=share&embed=true'
  }
];

const extensionConfig = {
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
};

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

await context.addInitScript(() => {
  window.__redditAuditLongTasks = [];
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__redditAuditLongTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) {}
});

const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
await worker.evaluate(config => chrome.storage.local.set({
  'site_config_reddit.com': config,
  'site_config_embed.reddit.com': config
}), extensionConfig);

function summarizePage(page) {
  return page.evaluate(() => {
    const rtl = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    const visible = element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const roots = [document];
    const hosts = [];
    for (let i = 0; i < roots.length; i++) {
      for (const element of roots[i].querySelectorAll('*')) {
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
          hosts.push(element);
        }
      }
    }
    const candidates = roots.flatMap(root => Array.from(root.querySelectorAll(
      'p,li,h1,h2,h3,h4,h5,h6,blockquote,[slot="comment"],#embed-title,[data-testid*="comment"]'
    ))).filter(element => {
      if (!visible(element) || element.closest('pre,code,[contenteditable="true"],[role="math"],math')) return false;
      return rtl.test(element.textContent || '');
    });
    const uniqueCandidates = [...new Set(candidates)];
    const wrong = uniqueCandidates.filter(element => getComputedStyle(element).direction !== 'rtl');
    const EnglishOnlyTargets = roots.flatMap(root => Array.from(root.querySelectorAll('.rtl-fixer-rtl-detected')))
      .filter(element => !rtl.test(element.textContent || ''));
    const longTasks = window.__redditAuditLongTasks || [];
    return {
      title: document.title,
      candidateCount: uniqueCandidates.length,
      appliedCount: uniqueCandidates.filter(element => element.classList.contains('rtl-fixer-rtl-detected')).length,
      wrongDirectionCount: wrong.length,
      wrongDirectionSamples: wrong.slice(0, 5).map(element => (element.textContent || '').trim().slice(0, 140)),
      wrongDirectionDetails: wrong.slice(0, 5).map(element => ({
        tag: element.tagName,
        id: element.id,
        dir: element.getAttribute('dir'),
        className: String(element.className || '').slice(0, 180)
      })),
      englishFalsePositiveCount: EnglishOnlyTargets.length,
      shadowRootCount: hosts.length,
      codeDirectionFailures: roots.flatMap(root => Array.from(root.querySelectorAll('pre,code')))
        .filter(element => visible(element) && getComputedStyle(element).direction !== 'ltr').length,
      longTaskCount: longTasks.length,
      maxLongTaskMs: longTasks.length ? Math.round(Math.max(...longTasks) * 10) / 10 : 0
    };
  });
}

const results = [];
try {
  for (const target of redditPosts) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { window.__redditAuditLongTasks = []; });
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(500);
      results.push({
        kind: 'real-reddit-embed',
        name: target.name,
        status: response?.status(),
        url: page.url(),
        ...await summarizePage(page),
        pageErrors: errors.slice(0, 3)
      });
    } catch (error) {
      results.push({ kind: 'real-reddit-embed', name: target.name, error: error.message });
    } finally {
      await page.close();
    }
  }

  const fixturePage = await context.newPage();
  await fixturePage.route('https://www.reddit.com/r/rastinrtl/comments/perf-test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Reddit RTL virtual thread</title>
      <style>body{font:16px Arial;margin:0}.feed{max-width:740px;margin:auto}.spacer{height:100vh}shreddit-comment{display:block;border-left:2px solid #ddd;padding:8px;margin:5px}</style>
      </head><body><main class="feed"><h1>بحث فارسی در ردیت</h1><div id="comments"></div><div id="sentinel">Loading…</div></main>
      <script>
        customElements.define('shreddit-comment', class extends HTMLElement {
          constructor() {
            super();
            const root = this.attachShadow({mode:'open'});
            root.innerHTML = '<article><p class="comment"></p><code>const direction = "ltr";</code><ul><li>پاسخ فارسی تو در تو</li></ul></article>';
          }
          connectedCallback() { this.shadowRoot.querySelector('.comment').textContent = this.getAttribute('text'); }
        });
        let batch = 0;
        const addBatch = () => {
          const fragment = document.createDocumentFragment();
          for (let i = 0; i < 35; i++) {
            const comment = document.createElement('shreddit-comment');
            comment.setAttribute('text', 'کامنت فارسی شماره ' + (batch * 35 + i) + ' که هنگام اسکرول در ردیت بارگذاری شده است.');
            fragment.appendChild(comment);
          }
          comments.appendChild(fragment);
          batch++;
        };
        addBatch();
        new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && batch < 8) addBatch(); }, {rootMargin:'700px'}).observe(sentinel);
      <\/script></body></html>`
  }));
  await fixturePage.goto('https://www.reddit.com/r/rastinrtl/comments/perf-test/', { waitUntil: 'domcontentloaded' });
  await fixturePage.waitForTimeout(500);
  await fixturePage.evaluate(() => { window.__redditAuditLongTasks = []; });

  let maxScrollDelay = 0;
  for (let i = 0; i < 18; i++) {
    const started = Date.now();
    await fixturePage.mouse.wheel(0, 1000);
    await fixturePage.waitForTimeout(40);
    maxScrollDelay = Math.max(maxScrollDelay, Date.now() - started - 40);
  }
  await fixturePage.waitForTimeout(1200);
  const fixtureSummary = await summarizePage(fixturePage);
  const loadedComments = await fixturePage.locator('shreddit-comment').count();
  results.push({
    kind: 'reddit-virtual-scroll-stress',
    name: 'Reddit shreddit-comment lazy load',
    loadedComments,
    maxScrollSchedulingDelayMs: maxScrollDelay,
    ...fixtureSummary
  });
  await fixturePage.close();
} finally {
  console.log(JSON.stringify(results, null, 2));
  await context.close();
}
