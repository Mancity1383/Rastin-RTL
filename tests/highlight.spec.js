/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageKey = 'rtl_fixer_hl_example.com';
const fixtureMarkup = '<!doctype html><html><head><meta charset="UTF-8"><style>' +
  'body{margin:40px;font:18px Arial}article{max-width:760px}p{margin:16px 0}' +
  'input,textarea{display:block;margin-top:20px}</style></head><body><article id="article">' +
  '<p id="multi">A <strong>clear idea</strong> becomes <em>much more useful</em> when it is recorded.</p>' +
  '<p id="source">A clear introduction precedes the persistent passage and the paragraph continues with useful context.</p>' +
  '<p id="overlap">Overlap alpha beta gamma delta and more context after the selection.</p>' +
  '<p id="keyboard">Keyboard selections are useful for accessible reading tools.</p>' +
  '</article><div id="editor" contenteditable="true">An editable passage must remain editable.</div>' +
  '<input id="input" value="An input selection"><textarea id="textarea">A textarea selection</textarea></body></html>';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => { await use(await context.newPage()); }
});
const workerFor = async context => context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
async function isolated(context, func, args = []) {
  const worker = await workerFor(context);
  const expression = 'async args => {const tabs = await chrome.tabs.query({url:"https://example.com/*"});' +
    'const result = await chrome.scripting.executeScript({target:{tabId:tabs[tabs.length-1].id},' +
    'world:"ISOLATED",func:(' + func.toString() + '),args});' +
    'if(result[0].error)throw new Error(result[0].error);return result[0].result;}';
  return worker.evaluate('(' + expression + ')(' + JSON.stringify(args) + ')');
}
async function send(context, settings) {
  const worker = await workerFor(context);
  return worker.evaluate(async settings => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    return chrome.tabs.sendMessage(tabs[tabs.length - 1].id, { action: 'updateSettings', settings });
  }, settings);
}
async function readSaved(context) {
  const worker = await workerFor(context);
  return worker.evaluate(async key => (await chrome.storage.local.get(key))[key] || [], storageKey);
}
async function writeSaved(context, items) {
  const worker = await workerFor(context);
  await worker.evaluate(({ key, items }) => chrome.storage.local.set({ [key]: items }), { key: storageKey, items });
}
async function rangeState(page) {
  return page.evaluate(() => [...CSS.highlights.entries()]
    .filter(([name]) => name.startsWith('rastin-color-'))
    .flatMap(([name, highlight]) => [...highlight].map(range => ({
      name, text: range.toString(), parent: range.startContainer.parentElement?.id || '',
      connected: range.startContainer.isConnected && range.endContainer.isConnected
    }))));
}
async function highlightText(page, selector, text, color = 'yellow') {
  await page.evaluate(({ selector, text }) => {
    const element = document.querySelector(selector);
    const node = element.firstChild;
    const start = node.nodeValue.indexOf(text);
    if (start < 0) throw new Error('Test selection does not occur in the target text node');
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + text.length);
    const selection = getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, text });
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('.rastin-color-btn.' + color).dispatchEvent('pointerdown');
}
function legacyRecords(count, route = '/article', prefix = 'legacy') {
  return Array.from({ length: count }, (_, index) => ({
    id: prefix + '-' + index, pageKey: 'example.com' + route, url: 'https://example.com' + route, path: route,
    text: 'Unique ' + prefix + ' passage ' + String(index).padStart(4, '0') + ' ends here.',
    color: '#fef08a', timestamp: Date.now() + index,
    startPath: '//*[@id="missing-' + prefix + '-' + index + '"]',
    endPath: '//*[@id="missing-' + prefix + '-' + index + '"]',
    startNodeIndex: 0, endNodeIndex: 0, startOffset: 0, endOffset: 50, note: { text: '' }
  }));
}
async function addLargeDocument(page, records, fillerCount = 18000) {
  await page.evaluate(({ records, fillerCount }) => {
    const container = document.createElement('main');
    container.id = 'large-document';
    const filler = document.createDocumentFragment();
    for (let index = 0; index < fillerCount; index++) {
      const span = document.createElement('span');
      span.textContent = 'Ordinary document fragment ' + index + ' with context for realistic text indexing. ';
      filler.append(span);
    }
    container.append(filler);
    for (const item of records) {
      const paragraph = document.createElement('p');
      paragraph.id = 'target-' + item.id;
      paragraph.textContent = 'Context before ' + item.text + ' Useful context after the target.';
      container.append(paragraph);
    }
    document.body.append(container);
  }, { records, fillerCount });
}
test.beforeEach(async ({ context, page }) => {
  const worker = await workerFor(context);
  await worker.evaluate(key => chrome.storage.local.set({
    enabled: true, adBlockEnabled: false, readingProgressEnabled: false, focusCoachEnabled: false, [key]: [],
    'site_config_example.com': { enabled: true, highlightEnabled: true, translatorEnabled: false }
  }), storageKey);
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: fixtureMarkup }));
  await page.goto('https://example.com/article');
  await expect.poll(() => send(context, { enabled: true, highlightEnabled: true, translatorEnabled: false }).catch(() => null))
    .toMatchObject({ status: 'success' });
});

test('native multi-node highlights preserve page text nodes and persist after reload', async ({ page, context }) => {
  const original = await page.locator('#article').innerHTML();
  await page.evaluate(() => {
    const article = document.getElementById('article');
    window.__highlightOriginalNodes = [...article.querySelectorAll('p, strong, em')].map(element => element.firstChild);
    window.__highlightTextMutations = [];
    const observer = new MutationObserver(records => window.__highlightTextMutations.push(...records.map(record => record.type)));
    observer.observe(article, { subtree: true, childList: true, characterData: true });
    const range = document.createRange();
    range.setStart(document.querySelector('#multi strong').firstChild, 0);
    const end = document.querySelector('#multi em').firstChild;
    range.setEnd(end, end.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.getElementById('multi').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('.rastin-color-btn.yellow').dispatchEvent('pointerdown');
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(1);
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(range => range.text)))
    .toEqual(['clear idea becomes much more useful']);
  expect(await page.locator('#article').innerHTML()).toBe(original);
  expect(await page.evaluate(() => ({
    mutations: window.__highlightTextMutations,
    originalNodesConnected: window.__highlightOriginalNodes.every(node => node.isConnected)
  }))).toEqual({ mutations: [], originalNodesConnected: true });
  await expect(page.locator('#article mark')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(range => range.text)))
    .toEqual(['clear idea becomes much more useful']);
  await expect(page.locator('#article mark')).toHaveCount(0);
});

test('changing a live text node invalidates its range and returning text reanchors elsewhere', async ({ page, context }) => {
  const selected = 'the persistent passage';
  await highlightText(page, '#source', selected);
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(1);
  await page.evaluate(() => {
    const source = document.getElementById('source');
    window.__highlightSourceNode = source.firstChild;
    window.__highlightSourceText = source.textContent;
    source.firstChild.data = 'This same live text node now contains unrelated content.';
  });
  await expect.poll(() => rangeState(page).then(ranges => ranges.length)).toBe(0);
  expect(await page.evaluate(() => window.__highlightSourceNode === document.getElementById('source').firstChild)).toBe(true);
  expect(await readSaved(context)).toHaveLength(1);
  await page.evaluate(() => {
    const replacement = document.createElement('p');
    replacement.id = 'relocated'; replacement.textContent = window.__highlightSourceText;
    document.getElementById('article').append(replacement);
  });
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(({ text, parent, connected }) => ({ text, parent, connected }))))
    .toEqual([{ text: selected, parent: 'relocated', connected: true }]);
});

test('editable selections are excluded and Shift+Arrow keyup opens the page toolbar', async ({ page, context }) => {
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    const range = document.createRange(); range.selectNodeContents(editor);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  });
  await expect(page.locator('#rastin-highlight-bar:not(.hidden)')).toHaveCount(0);
  for (const selector of ['#input', '#textarea']) {
    await page.locator(selector).evaluate(element => {
      getSelection().removeAllRanges(); element.focus(); element.select();
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    });
    await expect(page.locator('#rastin-highlight-bar:not(.hidden)')).toHaveCount(0);
  }
  await page.evaluate(() => {
    document.activeElement.blur();
    const paragraph = document.getElementById('keyboard');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 'Keyboard selections'.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    paragraph.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  });
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('.rastin-color-btn.blue').dispatchEvent('pointerdown');
  await expect.poll(() => readSaved(context).then(items => items.map(item => item.text))).toEqual(['Keyboard selections']);
});

test('disabling extension highlights preserves highlights owned by the page', async ({ page, context }) => {
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.getElementById('keyboard'));
    CSS.highlights.set('publisher-search', new Highlight(range));
  });
  await highlightText(page, '#source', 'the persistent passage');
  await expect.poll(() => rangeState(page).then(ranges => ranges.length)).toBe(1);
  await send(context, { enabled: true, highlightEnabled: false });
  await expect.poll(() => rangeState(page).then(ranges => ranges.length)).toBe(0);
  expect(await page.evaluate(() => [...CSS.highlights.get('publisher-search')].map(range => range.toString())))
    .toEqual(['Keyboard selections are useful for accessible reading tools.']);
  await expect(page.locator('#rastin-highlight-bar, #rastin-radar-container, #rastin-hub-drawer, .rastin-note')).toHaveCount(0);
});

test('overlapping highlights delete independently without changing page text', async ({ page, context }) => {
  const original = await page.locator('#overlap').textContent();
  await highlightText(page, '#overlap', 'Overlap alpha beta', 'yellow');
  await highlightText(page, '#overlap', 'alpha beta gamma delta', 'green');
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(2);
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(range => range.text).sort()))
    .toEqual(['Overlap alpha beta', 'alpha beta gamma delta'].sort());
  await isolated(context, () => window.RtlFixer.openHighlightHub());
  const card = page.locator('#rastin-hub-drawer .rastin-hub-card').filter({ hasText: 'Overlap alpha beta' });
  await card.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => readSaved(context).then(items => items.map(item => item.text))).toEqual(['alpha beta gamma delta']);
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(range => ({ name: range.name, text: range.text }))))
    .toEqual([{ name: 'rastin-color-green', text: 'alpha beta gamma delta' }]);
  expect(await page.locator('#overlap').textContent()).toBe(original);
  await expect(page.locator('#overlap mark')).toHaveCount(0);
});

test('300 stale XPath highlights restore with animation frames progressing during the work', async ({ page, context }, info) => {
  test.setTimeout(60000);
  const records = legacyRecords(300);
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false; window.RtlFixer.removeHighlight();
  });
  await addLargeDocument(page, records); await writeSaved(context, records);
  await page.evaluate(() => {
    document.documentElement.dataset.highlightRestoreStarted = '';
    window.__highlightRestoreFrames = 0;
    window.__highlightRestoreDurationMs = 0;
    const heartbeat = () => {
      const count = [...CSS.highlights.entries()].filter(([name]) => name.startsWith('rastin-color-'))
        .reduce((sum, [, highlight]) => sum + highlight.size, 0);
      if (document.documentElement.dataset.highlightRestoreStarted === 'yes' && count < 300) window.__highlightRestoreFrames++;
      if (count < 300) requestAnimationFrame(heartbeat);
      else if (document.documentElement.dataset.highlightRestoreStartedAt) {
        window.__highlightRestoreDurationMs = performance.now() - Number(document.documentElement.dataset.highlightRestoreStartedAt);
      }
    };
    requestAnimationFrame(heartbeat);
  });
  await isolated(context, () => {
    const originalEvaluate = document.evaluate.bind(document);
    const originalGetElementById = document.getElementById.bind(document);
    const recordStoredLookup = expression => {
      if (String(expression).includes('missing-legacy-') && document.documentElement.dataset.highlightRestoreStarted !== 'yes') {
        document.documentElement.dataset.highlightRestoreStarted = 'yes';
        document.documentElement.dataset.highlightRestoreStartedAt = String(performance.now());
      }
    };
    document.evaluate = function (expression, ...args) {
      recordStoredLookup(expression);
      return originalEvaluate(expression, ...args);
    };
    document.getElementById = function (id) {
      recordStoredLookup(id);
      return originalGetElementById(id);
    };
    window.RtlFixer.config.highlightEnabled = true; window.RtlFixer.initHighlight();
  });
  await expect.poll(() => rangeState(page).then(ranges => ranges.length), { timeout: 30000 }).toBe(300);
  expect(await page.evaluate(() => window.__highlightRestoreFrames)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__highlightRestoreDurationMs)).toBeGreaterThan(0);
  const metrics = await page.evaluate(() => ({
    highlights: 300, fillerTextNodes: 18000, framesDuringRestore: window.__highlightRestoreFrames,
    restoreDurationMs: Math.round(window.__highlightRestoreDurationMs)
  }));
  await info.attach('highlight-performance.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  const restored = await rangeState(page);
  expect(restored.every(range => range.connected)).toBe(true);
  expect(restored.map(range => range.text).sort()).toEqual(records.map(item => item.text).sort());
  await expect(page.locator('#large-document mark')).toHaveCount(0);
});

test('disable during a large restore cannot resurrect extension registry or UI', async ({ page, context }) => {
  test.setTimeout(60000);
  const records = legacyRecords(300, '/article', 'cancel');
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false; window.RtlFixer.removeHighlight();
  });
  await addLargeDocument(page, records); await writeSaved(context, records);
  await isolated(context, () => {
    const originalEvaluate = document.evaluate.bind(document);
    const originalGetElementById = document.getElementById.bind(document);
    let scheduled = false;
    const scheduleAfterStoredLookup = expression => {
      if (!scheduled && String(expression).includes('missing-cancel-')) {
        scheduled = true;
        setTimeout(() => {
          window.RtlFixer.config.highlightEnabled = false; window.RtlFixer.removeHighlight();
          document.documentElement.dataset.highlightRestoreCancelled = 'yes';
        }, 0);
      }
    };
    document.evaluate = function (expression, ...args) {
      scheduleAfterStoredLookup(expression);
      return originalEvaluate(expression, ...args);
    };
    document.getElementById = function (id) {
      scheduleAfterStoredLookup(id);
      return originalGetElementById(id);
    };
    window.RtlFixer.config.highlightEnabled = true; window.RtlFixer.initHighlight();
  });
  await expect(page.locator('html')).toHaveAttribute('data-highlight-restore-cancelled', 'yes');
  // Include delayed restoration and initial forced-reload timers in the assertion.
  await page.waitForTimeout(1800);
  expect(await rangeState(page)).toEqual([]);
  await expect(page.locator('#rastin-highlight-bar, #rastin-radar-container, #rastin-hub-drawer, .rastin-note')).toHaveCount(0);
  expect(await readSaved(context)).toHaveLength(300);
});

test('changing route during restore leaves only the new route ranges', async ({ page, context }) => {
  test.setTimeout(60000);
  const oldRecords = legacyRecords(300, '/article', 'route');
  const newRecord = legacyRecords(1, '/next', 'new-route')[0];
  newRecord.color = '#bfdbfe';
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false; window.RtlFixer.removeHighlight();
  });
  await addLargeDocument(page, [...oldRecords, newRecord]); await writeSaved(context, [...oldRecords, newRecord]);
  await isolated(context, () => {
    const originalEvaluate = document.evaluate.bind(document);
    const originalGetElementById = document.getElementById.bind(document);
    let scheduled = false;
    const scheduleAfterStoredLookup = expression => {
      if (!scheduled && String(expression).includes('missing-route-')) {
        scheduled = true;
        setTimeout(() => {
          history.pushState({}, '', '/next');
          window.RtlFixer.loadAndRestoreHighlights(true);
          document.documentElement.dataset.highlightRestoreRouteChanged = 'yes';
        }, 0);
      }
    };
    document.evaluate = function (expression, ...args) {
      scheduleAfterStoredLookup(expression);
      return originalEvaluate(expression, ...args);
    };
    document.getElementById = function (id) {
      scheduleAfterStoredLookup(id);
      return originalGetElementById(id);
    };
    window.RtlFixer.config.highlightEnabled = true; window.RtlFixer.initHighlight();
  });
  await expect(page.locator('html')).toHaveAttribute('data-highlight-restore-route-changed', 'yes');
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(range => ({ name: range.name, text: range.text }))), { timeout: 15000 })
    .toEqual([{ name: 'rastin-color-blue', text: newRecord.text }]);
  await page.waitForTimeout(1800);
  expect((await rangeState(page)).map(range => ({ name: range.name, text: range.text })))
    .toEqual([{ name: 'rastin-color-blue', text: newRecord.text }]);
});

test('DOM mark fallback preserves multi-node text and cleans up when disabled', async ({ page, context }) => {
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false;
    window.RtlFixer.removeHighlight();
    Object.defineProperty(window, 'Highlight', { value: undefined, configurable: true });
    window.RtlFixer.config.highlightEnabled = true;
    window.RtlFixer.initHighlight();
  });
  const originalText = await page.locator('#multi').textContent();
  await page.evaluate(() => {
    const range = document.createRange();
    range.setStart(document.querySelector('#multi strong').firstChild, 0);
    const end = document.querySelector('#multi em').firstChild;
    range.setEnd(end, end.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.getElementById('multi').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('.rastin-color-btn.yellow').dispatchEvent('pointerdown');
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(1);
  await expect(page.locator('#multi mark.rastin-highlight')).toHaveCount(3);
  expect(await page.locator('#multi').textContent()).toBe(originalText);
  expect((await page.locator('#multi mark.rastin-highlight').allTextContents()).join(''))
    .toBe('clear idea becomes much more useful');
  expect(await rangeState(page)).toEqual([]);
  await send(context, { enabled: true, highlightEnabled: false });
  await expect(page.locator('mark.rastin-highlight')).toHaveCount(0);
  expect(await page.locator('#multi').textContent()).toBe(originalText);
  await expect(page.locator('#multi strong')).toHaveText('clear idea');
  await expect(page.locator('#multi em')).toHaveText('much more useful');
  await expect(page.locator('#rastin-highlight-bar, #rastin-radar-container, .rastin-note')).toHaveCount(0);
});

test('focusing a toolbar color and pressing Enter saves the selected passage', async ({ page, context }) => {
  await page.evaluate(() => {
    const paragraph = document.getElementById('source');
    const range = document.createRange();
    const start = paragraph.firstChild.data.indexOf('the persistent passage');
    range.setStart(paragraph.firstChild, start);
    range.setEnd(paragraph.firstChild, start + 'the persistent passage'.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('.rastin-color-btn.purple').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => readSaved(context).then(items => items.map(item => ({ text: item.text, color: item.color }))))
    .toEqual([{ text: 'the persistent passage', color: '#e9d5ff' }]);
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(({ name, text }) => ({ name, text }))))
    .toEqual([{ name: 'rastin-color-purple', text: 'the persistent passage' }]);
});

test('restored DOM fallback highlights remain stable through their own DOM mutations', async ({ page, context }) => {
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false;
    window.RtlFixer.removeHighlight();
    Object.defineProperty(window, 'Highlight', { value: undefined, configurable: true });
  });
  const records = [
    { id: 'fallback-source', parent: 'source', text: 'the persistent passage', offset: 'A clear introduction precedes '.length },
    { id: 'fallback-keyboard', parent: 'keyboard', text: 'Keyboard selections', offset: 0 }
  ].map(({ id, parent, text, offset }) => ({
    id, pageKey: 'example.com/article', url: 'https://example.com/article', path: '/article',
    text, color: '#fef08a', timestamp: Date.now(), note: { text: '' },
    startPath: '//*[@id="' + parent + '"]', endPath: '//*[@id="' + parent + '"]',
    startNodeIndex: 0, endNodeIndex: 0, startOffset: offset, endOffset: offset + text.length
  }));
  await writeSaved(context, records);
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = true;
    window.RtlFixer.initHighlight();
  });
  await expect(page.locator('#article mark.rastin-highlight')).toHaveCount(2);
  expect((await page.locator('#article mark.rastin-highlight').allTextContents()).sort())
    .toEqual(records.map(item => item.text).sort());
  await page.evaluate(() => {
    window.__highlightFallbackMutations = 0;
    const observer = new MutationObserver(records => { window.__highlightFallbackMutations += records.length; });
    observer.observe(document.getElementById('article'), { subtree: true, childList: true, characterData: true });
  });
  await page.waitForTimeout(1900);
  await expect(page.locator('#article mark.rastin-highlight')).toHaveCount(2);
  expect(await page.evaluate(() => window.__highlightFallbackMutations)).toBe(0);
  expect((await page.locator('#article mark.rastin-highlight').allTextContents()).sort())
    .toEqual(records.map(item => item.text).sort());
  expect(await readSaved(context)).toHaveLength(2);
});

test('a malformed text record does not block later restoration or rewrite stored data', async ({ page, context }) => {
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = false;
    window.RtlFixer.removeHighlight();
  });
  const malformed = { id: 'numeric-text', pageKey: 'example.com/article', url: 'https://example.com/article', text: 123, color: '#fef08a' };
  const valid = {
    id: 'valid-after-malformed', pageKey: 'example.com/article', url: 'https://example.com/article',
    text: 'Keyboard selections', color: '#bfdbfe', note: { text: '' }, timestamp: Date.now(),
    startPath: '//*[@id="keyboard"]', endPath: '//*[@id="keyboard"]',
    startNodeIndex: 0, endNodeIndex: 0, startOffset: 0, endOffset: 'Keyboard selections'.length
  };
  await writeSaved(context, [malformed, valid]);
  await isolated(context, () => {
    window.RtlFixer.config.highlightEnabled = true;
    window.RtlFixer.initHighlight();
  });
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(({ name, text }) => ({ name, text }))))
    .toEqual([{ name: 'rastin-color-blue', text: 'Keyboard selections' }]);
  await expect(page.locator('#rastin-highlight-save-error')).toHaveCount(0);
  const saved = await readSaved(context);
  expect(saved).toHaveLength(2);
  expect(saved.find(item => item.id === malformed.id)).toEqual(malformed);
  expect(saved.find(item => item.id === valid.id).text).toBe(valid.text);
});

test('long-node quote recovery maps chunk boundaries and Persian text variants to raw offsets', async ({ page, context }) => {
  const originalQuote = 'علي كاظمي ۱۲٣ می‌نویسد';
  const restoredQuote = 'علی کاظمی 123 می نویسد';
  await page.evaluate(originalQuote => {
    const paragraph = document.createElement('p');
    paragraph.id = 'long-node';
    paragraph.style.fontSize = '12px';
    // The quote begins eight raw characters before the 2048-character chunk boundary.
    paragraph.textContent = 'context '.repeat(255) + originalQuote + ' and a useful concluding context.';
    document.getElementById('article').append(paragraph);
  }, originalQuote);
  await highlightText(page, '#long-node', originalQuote);
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(1);
  expect((await readSaved(context))[0].startOffset).toBe(2040);
  await page.evaluate(restoredQuote => {
    const rebuilt = document.createElement('span');
    rebuilt.id = 'rebuilt-long-node';
    rebuilt.textContent = 'context '.repeat(255) + restoredQuote + ' and a useful concluding context.';
    // A wrapper invalidates the old text-node XPath without changing normalized quote context.
    document.getElementById('long-node').replaceChildren(rebuilt);
  }, restoredQuote);
  await expect.poll(() => rangeState(page).then(ranges => ranges.map(({ text, parent, connected }) => ({ text, parent, connected }))))
    .toEqual([{ text: restoredQuote, parent: 'rebuilt-long-node', connected: true }]);
  const bounds = await page.evaluate(() => {
    const range = [...CSS.highlights.get('rastin-color-yellow')][0];
    return { start: range.startOffset, end: range.endOffset };
  });
  expect(bounds).toEqual({ start: 2040, end: 2040 + restoredQuote.length });
  expect((await readSaved(context))[0].text).toBe(originalQuote);
  await expect(page.locator('#long-node mark')).toHaveCount(0);
});

test('empty native hit results fall back to caret hit testing and preserve the page cursor', async ({ page, context }) => {
  await page.evaluate(() => document.body.style.setProperty('cursor', 'crosshair', 'important'));
  await highlightText(page, '#source', 'the persistent passage');
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(1);
  await isolated(context, () => {
    window.__emptyHighlightHitCalls = 0;
    Object.defineProperty(CSS.highlights, 'highlightsFromPoint', {
      configurable: true,
      value: () => { window.__emptyHighlightHitCalls++; return []; }
    });
  });
  const point = await page.evaluate(() => {
    getSelection().removeAllRanges();
    const range = [...CSS.highlights.get('rastin-color-yellow')][0];
    const rect = range.getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('body')).toHaveCSS('cursor', 'pointer');
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => ({
    cursor: document.body.style.getPropertyValue('cursor'),
    priority: document.body.style.getPropertyPriority('cursor')
  }))).toEqual({ cursor: 'crosshair', priority: 'important' });
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#rastin-bar-delete')).toBeVisible();
  await expect(page.locator('.rastin-color-btn.yellow')).toHaveClass(/active/);
  expect(await isolated(context, () => window.__emptyHighlightHitCalls)).toBeGreaterThan(0);
  await page.locator('#rastin-bar-delete').dispatchEvent('pointerdown');
  await expect.poll(() => readSaved(context).then(items => items.length)).toBe(0);
  await expect.poll(() => rangeState(page).then(ranges => ranges.length)).toBe(0);
});

