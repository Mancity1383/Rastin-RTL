/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

async function isolated(worker, tabId, func) {
  return worker.evaluate(({ tabId, source }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: new Function('return (' + source + ')()')
  }).then(results => results[0].result), { tabId, source: func.toString() });
}

test('a live message is corrected during a retained history scan without replacing its selected text', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'priority-live');
  await page.evaluate(() => {
    const live = document.createElement('p'); live.id = 'live'; live.textContent = 'Original English reply';
    document.getElementById('chat').append(live);
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await isolated(worker, tabId, () => {
    const fixer = window.RtlFixer;
    const scan = fixer.scanAndProcessSteps;
    fixer.scanAndProcessSteps = function* (root) {
      if (root.id === 'history') document.documentElement.setAttribute('data-history-started', 'yes');
      yield* scan.call(this, root);
    };
    const apply = fixer.applyRtlToElement;
    fixer.applyRtlToElement = function (node, ...args) {
      const result = apply.call(this, node, ...args);
      if (node.id === 'live' && node.dir === 'rtl') {
        document.documentElement.setAttribute('data-history-at-live', String(document.querySelectorAll('#history p[dir="rtl"]').length));
      }
      return result;
    };
  });
  await page.evaluate(() => {
    const live = document.getElementById('live');
    const observer = new MutationObserver(() => {
      if (!document.documentElement.hasAttribute('data-history-started')) return;
      observer.disconnect();
      live.firstChild.data = 'UART توضیح فارسی درباره ارتباط سریال و دستگاه‌ها';
      window.__liveNode = live.firstChild;
      const range = document.createRange(); range.setStart(live.firstChild, 5); range.setEnd(live.firstChild, 10);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-history-started'] });
    const history = document.createElement('section'); history.id = 'history';
    history.innerHTML = '<article><div><p>متن فارسی تاریخچه همراه <strong>UART</strong> و توضیح کامل</p></div></article>'.repeat(1500);
    document.getElementById('chat').prepend(history);
  });
  await expect(page.locator('#live')).toHaveAttribute('dir', 'rtl');
  expect(Number(await page.locator('html').getAttribute('data-history-at-live'))).toBeLessThan(1500);
  await expect(page.locator('#history p[dir="rtl"]')).toHaveCount(1500);
  expect(await page.evaluate(() => ({
    same: window.__liveNode === document.getElementById('live').firstChild,
    selected: getSelection().toString()
  }))).toEqual({ same: true, selected: 'توضیح' });
});

for (const host of ['chatgpt.com', 'claude.ai', 'gemini.google.com']) {
  test(`visible message gets priority on ${host} and replacing the chat root retains complete processing`, async ({ context }) => {
    const { page, worker, tabId } = await openRtlFixture(context, 'priority-viewport', host);
    await page.evaluate(host => {
      const main = document.getElementById('chat');
      const marker = host === 'chatgpt.com' ? 'data-message-author-role="assistant"'
        : host === 'claude.ai' ? 'data-testid="assistant-message"' : '';
      main.innerHTML = `<model-response ${marker}>` +
        Array.from({ length: 1000 }, (_, i) => `<p id="history-${i}" style="height:70px">توضیح فارسی پیام شماره ${i} همراه UART</p>`).join('') + '</model-response>';
      window.scrollTo(0, document.body.scrollHeight);
    }, host);
    await isolated(worker, tabId, () => {
      const fixer = window.RtlFixer;
      const apply = fixer.applyRtlToElement;
      fixer.applyRtlToElement = function (node, ...args) {
        const result = apply.call(this, node, ...args);
        if (node.id?.startsWith('history-') && node.dir === 'rtl' && !document.documentElement.hasAttribute('data-first-corrected')) {
          document.documentElement.setAttribute('data-first-corrected', node.id);
        }
        return result;
      };
    });
    await sendRtlSettings(worker, tabId, rtlSettings);
    await expect(page.locator('#history-999')).toHaveAttribute('dir', 'rtl');
    expect(Number((await page.locator('html').getAttribute('data-first-corrected')).split('-')[1])).toBeGreaterThan(900);
    await expect(page.locator('main p[dir="rtl"]')).toHaveCount(1000);
    await page.evaluate(() => {
      const old = document.querySelector('main');
      const next = old.cloneNode(false);
      next.innerHTML = '<div data-message-author-role="assistant" data-testid="assistant-message"><model-response><p id="replacement">UART پاسخ فارسی چت تازه</p></model-response></div>';
      old.replaceWith(next); window.scrollTo(0, 0);
    });
    await expect(page.locator('#replacement')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#history-999')).toHaveCount(0);
  });
}

test('IME composition protects native, rich and shadow editors until the final text is committed', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'priority-ime');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<textarea id="native">English</textarea><div id="rich" contenteditable="true">English</div><div id="shadow"></div>';
    document.getElementById('shadow').attachShadow({ mode: 'open' }).innerHTML = '<div id="shadow-rich" contenteditable="plaintext-only">English</div>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#rich')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#shadow-rich')).toHaveAttribute('dir', 'ltr');
  await page.evaluate(() => {
    const inputs = [document.getElementById('native'), document.getElementById('rich'), document.getElementById('shadow').shadowRoot.firstChild];
    for (const input of inputs) {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
      if (input.tagName === 'TEXTAREA') input.value = 'سلام دنیا'; else input.firstChild.data = 'سلام دنیا';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, isComposing: true, data: 'سلام' }));
    }
  });
  await isolated(worker, tabId, () => { window.RtlFixer.processInputsInSubtree(document.body); });
  for (const id of ['native', 'rich', 'shadow-rich']) await expect(page.locator('#' + id)).toHaveAttribute('dir', 'ltr');
  await page.evaluate(() => {
    for (const input of [document.getElementById('native'), document.getElementById('rich'), document.getElementById('shadow').shadowRoot.firstChild]) {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'سلام دنیا' }));
    }
  });
  for (const id of ['native', 'rich', 'shadow-rich']) await expect(page.locator('#' + id)).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#native')).toHaveValue('سلام دنیا');
  await expect(page.locator('#rich')).toHaveText('سلام دنیا');
  await expect(page.locator('#shadow-rich')).toHaveText('سلام دنیا');
});

test('selected Persian text retains its direction and range until selection collapses', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'priority-selection');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<div id="rich" contenteditable="true">English</div>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#rich')).toHaveAttribute('dir', 'ltr');
  await page.evaluate(() => {
    const rich = document.getElementById('rich'); rich.firstChild.data = 'توضیح فارسی همراه UART';
    window.__selectedNode = rich.firstChild;
    const range = document.createRange(); range.setStart(rich.firstChild, 0); range.setEnd(rich.firstChild, 5);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    rich.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await isolated(worker, tabId, () => { window.RtlFixer.processInputDirection(document.getElementById('rich')); });
  await expect(page.locator('#rich')).toHaveAttribute('dir', 'ltr');
  expect(await page.evaluate(() => getSelection().toString())).toBe('توضیح');
  await page.evaluate(() => getSelection().collapseToEnd());
  await expect(page.locator('#rich')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => window.__selectedNode === document.getElementById('rich').firstChild)).toBe(true);
});

test('direction writes preserve native undo and redo for typed Persian', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'priority-undo');
  await sendRtlSettings(worker, tabId, rtlSettings);
  const composer = page.locator('#compose');
  await composer.click();
  await page.keyboard.insertText('سلام دنیا');
  await expect(composer).toHaveAttribute('dir', 'rtl');
  await page.keyboard.press('Control+z');
  await expect(composer).toHaveValue('');
  await expect(composer).toHaveAttribute('dir', 'auto');
  await page.keyboard.press('Control+Shift+z');
  await expect(composer).toHaveValue('سلام دنیا');
  await expect(composer).toHaveAttribute('dir', 'rtl');
});

test('selected native text stays stable while focused and applies the pending direction on blur', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'priority-native-selection');
  await sendRtlSettings(worker, tabId, rtlSettings);
  const composer = page.locator('#compose');
  await composer.fill('English response');
  await expect(composer).toHaveAttribute('dir', 'ltr');
  await composer.evaluate(input => {
    input.value = 'توضیح فارسی درباره UART'; input.setSelectionRange(0, 5);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect(composer).toHaveAttribute('dir', 'ltr');
  expect(await composer.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
  await composer.blur();
  await expect(composer).toHaveAttribute('dir', 'rtl');
  expect(await composer.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
  await expect(composer).toHaveValue('توضیح فارسی درباره UART');
});

test('the input cache uses exact text and reasserts a clobbered direction without reclassification', async ({ context }) => {
  const { worker, tabId } = await openRtlFixture(context, 'priority-input-cache');
  await sendRtlSettings(worker, tabId, rtlSettings);
  const result = await isolated(worker, tabId, () => {
    const fixer = window.RtlFixer;
    const input = document.createElement('textarea'); document.getElementById('chat').append(input);
    let classifications = 0;
    const detect = fixer.detectParagraphDirection;
    fixer.detectParagraphDirection = text => { classifications++; return detect(text); };
    input.value = '.'.repeat(40) + 'a'.repeat(24);
    for (let i = 0; i < 20; i++) fixer.processInputDirection(input);
    const english = input.dir;
    input.value = '.'.repeat(40) + 'م'.repeat(24);
    fixer.processInputDirection(input);
    const persian = input.dir;
    input.dir = 'ltr'; fixer.processInputDirection(input);
    fixer.detectParagraphDirection = detect;
    return { classifications, english, persian, reasserted: input.dir };
  });
  expect(result).toEqual({ classifications: 2, english: 'ltr', persian: 'rtl', reasserted: 'rtl' });
});
