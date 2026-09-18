// Live integration audit in a disposable profile; never touches the user's storage.
import { chromium, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'https://share.gemini.google/rnPTIFSJ1Yb0';
const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({
    enabled: true, adBlockEnabled: false,
    'site_config_gemini.google.com': { enabled: true, highlightEnabled: true, adBlockEnabled: false, fontFamily: 'System' }
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on('console', msg => { if (msg.type() === 'error' && msg.text().includes('Rastin')) console.error(msg.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const paragraph = page.locator('message-content p').filter({ hasText: 'High above the valley lived a hermit' });
  await expect(paragraph).toHaveCount(1, { timeout: 45000 });
  const selectWord = async () => {
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.evaluate(p => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf('hermit');
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + 6);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        const button = document.querySelector('.rastin-color-btn.yellow');
        if (!button) throw new Error('Highlight toolbar unavailable');
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return;
      }
      throw new Error('Expected word not found');
    });
  };
  const saved = () => worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_gemini.google.com'))['rtl_fixer_hl_gemini.google.com'] || []);
  const ranges = () => page.evaluate(() => [...(CSS.highlights.get('rastin-color-yellow') || [])].map(r => ({
    text: r.toString(), inResponse: !!r.startContainer.parentElement.closest('message-content'),
    paragraphStart: r.startContainer.parentElement.closest('p')?.textContent.slice(0, 50),
    painted: getComputedStyle(r.startContainer.parentElement, '::highlight(rastin-color-yellow)').backgroundColor
  })));
  await selectWord();
  await expect.poll(async () => (await saved()).length).toBe(1);
  const before = await ranges();
  const storageBefore = await saved();
  console.log(JSON.stringify({ phase: 'created', url: page.url(), ranges: before, path: storageBefore[0].startPath }));
  for (let reload = 1; reload <= 2; reload++) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(paragraph).toHaveCount(1, { timeout: 45000 });
    await expect.poll(ranges, { timeout: 20000 }).toEqual(before);
    expect((await saved()).map(h => h.id)).toEqual(storageBefore.map(h => h.id));
    console.log(JSON.stringify({ phase: `reload-${reload}`, url: page.url(), ranges: await ranges(), storedCount: (await saved()).length }));
  }
  // Verify the compatibility reader with an actual pre-fix descendant XPath.
  await worker.evaluate(async () => {
    const key = 'rtl_fixer_hl_gemini.google.com';
    const data = (await chrome.storage.local.get(key))[key];
    for (const h of data) {
      h.startPath = h.startPath.replace(/^\/\//, '/');
      h.endPath = h.endPath.replace(/^\/\//, '/');
      h.textAnchor.rootPath = h.textAnchor.rootPath.replace(/^\/\//, '/');
      delete h.textAnchor.contentScope;
    }
    await chrome.storage.local.set({ [key]: data });
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect.poll(ranges, { timeout: 45000 }).toEqual(before);
  console.log(JSON.stringify({ phase: 'legacy-reload', ranges: await ranges(), result: 'PASS' }));
} finally {
  await context.close();
}
