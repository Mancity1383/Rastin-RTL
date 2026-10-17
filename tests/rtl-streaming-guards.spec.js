/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';
import { measureBurstScenario } from '../tools/rtl-stream-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

test('formatted streaming reuses prose classification across English and Persian frames', async ({ context }) => {
  const result = await measureBurstScenario(context, 'multi-message-stream', { count: 60, frames: 12 });
  expect(result.completedUpdates).toBe(12);
  expect(result.characterDataRecords).toBe(2160);
  expect(result.originalTextNodesPreserved).toBe(true);
  expect(result.inputDirectionMismatches).toBe(0);
  expect(result.textTraversalVisits).toBe(0);
  expect(result.elementTraversalVisits).toBe(0);
  expect(result.getComputedStyleCalls).toBeLessThanOrEqual(60);
  expect(result.finalRtlCount).toBe(60);
});

test('simple prose revalidates attribute-only boundaries and unannounced shadow roots', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'native-prose-guards');
  const results = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer;
      return ['math-class', 'math-role', 'editable', 'bidi', 'widget', 'shadow', 'nested-block'].map(kind => {
        const p = document.createElement('p');
        const span = document.createElement('span'); span.textContent = 'شرح متن فارسی';
        p.append('UART ', span); document.getElementById('chat').append(p);
        fixer.getContainedDirectionalText(p);
        const before = fixer.getSimpleProseText(p);
        if (kind === 'math-class') span.className = 'prefix-katex-suffix';
        if (kind === 'math-role') span.setAttribute('role', 'math');
        if (kind === 'editable') span.contentEditable = 'true';
        if (kind === 'bidi') span.dir = 'ltr';
        if (kind === 'widget') span.className = 'rastin-note';
        if (kind === 'shadow') span.attachShadow({ mode: 'open' }).innerHTML = '<p>سایه</p>';
        if (kind === 'nested-block') span.append(document.createElement('div'));
        const after = fixer.getSimpleProseText(p);
        const preserved = p.textContent === 'UART شرح متن فارسی';
        p.remove();
        return { kind, before, after, preserved };
      });
    }
  }).then(results => results[0].result), tabId);
  for (const result of results) {
    expect(result.before, result.kind).toBe('UART شرح متن فارسی');
    expect(result.after, result.kind).toBe(null);
    expect(result.preserved, result.kind).toBe(true);
  }
});

test('UI ancestry acceleration preserves real markers, shadow boundaries and custom selectors', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'native-ui-guards');
  const results = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer;
      const original = fixer.EXTENSION_UI_SELECTOR;
      const cases = original.split(',').map(selector => {
        const widget = document.createElement('div');
        if (selector.startsWith('#')) widget.id = selector.slice(1);
        else if (selector.startsWith('.')) widget.className = selector.slice(1);
        else widget.setAttribute('data-rastin-reader-ui', '');
        const child = document.createElement('span'); child.textContent = 'متن ابزار';
        widget.append(child);
        const shadow = child.attachShadow({ mode: 'open' }); shadow.textContent = 'سایه';
        document.getElementById('chat').append(widget);
        const result = [child, child.firstChild, shadow, shadow.firstChild].every(node => fixer.isExtensionNode(node));
        widget.remove(); return result;
      });
      const ordinary = document.createElement('div'); ordinary.id = 'rastin-ordinary-content';
      ordinary.innerHTML = '<span>متن معمولی</span>';
      document.getElementById('chat').append(ordinary);
      const falsePrefix = fixer.isExtensionNode(ordinary.firstChild);
      ordinary.className = 'custom-widget';
      fixer.EXTENSION_UI_SELECTOR += ',.custom-widget';
      const custom = fixer.isExtensionNode(ordinary.firstChild);
      fixer.EXTENSION_UI_SELECTOR = original;
      ordinary.remove();
      return { cases, falsePrefix, custom };
    }
  }).then(results => results[0].result), tabId);
  expect(results.cases.every(Boolean)).toBe(true);
  expect(results.falsePrefix).toBe(false);
  expect(results.custom).toBe(true);
});

test('lazy chat insertion and live edits preserve both new and retained messages', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'lazy-and-stream');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<p id="live-reply">پاسخ فارسی همراه <strong>UART</strong> در حال تکمیل است</p>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#live-reply')).toHaveAttribute('dir', 'rtl');
  await page.evaluate(() => new Promise(resolve => {
    const live = document.getElementById('live-reply');
    window.__retainedReplyNode = live.firstChild;
    let frame = 0;
    const tick = () => {
      const fragment = document.createDocumentFragment();
      for (let item = 0; item < 30; item++) {
        const card = document.createElement('article');
        card.innerHTML = '<div><p class="lazy-reply">توضیح فارسی پیام تازه <strong>ADC</strong> همراه 123</p><pre><code>const count = 123;</code></pre></div>';
        fragment.append(card);
      }
      document.getElementById('chat').prepend(fragment);
      live.firstChild.data = frame % 2 ? 'UART پاسخ فارسی درباره ارتباط سریال ' : 'UART توضیح فارسی درباره تنظیمات ';
      if (++frame < 8) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  }));
  await expect(page.locator('.lazy-reply[dir="rtl"]')).toHaveCount(240);
  await expect(page.locator('#live-reply')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => window.__retainedReplyNode === document.getElementById('live-reply').firstChild)).toBe(true);
  await expect(page.locator('pre .rtl-fixer-target,code.rtl-fixer-target')).toHaveCount(0);
  expect(await page.locator('code').first().textContent()).toBe('const count = 123;');
});

test('a background queue overflow resumes a full document scan including open shadow roots', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'background-overflow');
  await sendRtlSettings(worker, tabId, rtlSettings);
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<p id="ready-for-background">متن فارسی آماده</p>';
  });
  await expect(page.locator('#ready-for-background')).toHaveAttribute('dir', 'rtl');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      window.__testHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testHidden });
      document.dispatchEvent(new Event('visibilitychange'));
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 1100; i++) {
        const p = document.createElement('p'); p.className = 'background-reply';
        p.textContent = 'پاسخ فارسی در تاریخچه چت ' + i;
        fragment.append(p);
      }
      const host = document.createElement('div'); host.id = 'background-shadow';
      host.attachShadow({ mode: 'open' }).innerHTML = '<p id="shadow-reply">متن فارسی در سایه</p>';
      fragment.append(host);
      document.getElementById('chat').append(fragment);
    }
  }), tabId);
  expect(await page.locator('.background-reply[dir="rtl"]').count()).toBe(0);
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      window.__testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }
  }), tabId);
  await expect(page.locator('.background-reply[dir="rtl"]')).toHaveCount(1100);
  await expect(page.locator('#shadow-reply')).toHaveAttribute('dir', 'rtl');
});
