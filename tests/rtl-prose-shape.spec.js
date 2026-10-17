/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext(process.env.RTL_TEST_EXTENSION);
    try { await use(context); } finally { await context.close(); }
  }
});

test('Ordinary formatted paragraphs and headings share one prose shape without changing text nodes', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-shape-safe');
  const results = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer;
      return ['p', 'h1', 'h4', 'h6'].map(tag => {
        const root = document.createElement(tag);
        root.innerHTML = '<span>پاسخ <strong>فارسی</strong></span><br><a href="#">پیوند</a><em> دیگر</em><wbr>';
        document.getElementById('chat').append(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push({ node, parent: node.parentNode, text: node.data });
        const text = fixer.getContainedDirectionalText(root), shape = fixer._simpleProseShapes.get(root);
        const result = { tag, text, simple: shape?.simple,
          nodesPreserved: nodes.every(({ node, parent, text }) => node.parentNode === parent && node.data === text),
          epochMatches: shape?.structuralVersion === (fixer._domStructureMutationVersion || 0) };
        root.remove();
        return result;
      });
    }
  }).then(results => results[0].result), tabId);
  expect(results).toEqual(['p', 'h1', 'h4', 'h6'].map(tag => ({ tag, text: 'پاسخ فارسی پیوند دیگر', simple: true, nodesPreserved: true, epochMatches: true })));
  await page.close();
});

test('Code, math, editors, nested blocks, bidi boundaries, widgets and shadow hosts retain full processing', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-shape-protected');
  const cases = [
    { name: 'nested block', html: '<div>فارسی</div>' },
    { name: 'inline code', html: '<code>فارسی</code>' },
    { name: 'preformatted code', html: '<pre>فارسی</pre>' },
    { name: 'keyboard token', html: '<kbd>فارسی</kbd>' },
    { name: 'isolated bidi', html: '<bdi>فارسی</bdi>' },
    { name: 'native MathML', html: '<math><mtext>فارسی</mtext></math>' },
    { name: 'math role', html: '<span role="math">فارسی</span>' },
    { name: 'KaTeX class', html: '<span class="katex">فارسی</span>' },
    { name: 'SVG', html: '<svg><text>فارسی</text></svg>' },
    { name: 'input', html: '<input value="فارسی">' },
    { name: 'textarea', html: '<textarea>فارسی</textarea>' },
    { name: 'editable span', html: '<span contenteditable="true">فارسی</span>' },
    { name: 'editing boundary', html: '<span contenteditable="false">فارسی</span>' },
    { name: 'owned widget', html: '<span data-rastin-reader-ui>فارسی</span>' },
    { name: 'explicit LTR child', html: '<span dir="ltr">فارسی</span>' },
    { name: 'explicit RTL child', html: '<strong dir="rtl">فارسی</strong>' },
    { name: 'other semantic inline tag', html: '<abbr>فارسی</abbr>' },
    { name: 'open shadow host', html: '<span data-shadow-host>فارسی</span>', shadow: true }
  ];
  const results = await worker.evaluate(({ tabId, cases }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [cases], func: cases => {
      const fixer = window.RtlFixer;
      return cases.map(({ name, html, shadow }) => {
        const root = document.createElement('p');
        root.innerHTML = html;
        if (shadow) root.querySelector('[data-shadow-host]').attachShadow({ mode: 'open' }).innerHTML = '<p>محتوای سایه</p>';
        document.getElementById('chat').append(root);
        const original = root.textContent;
        fixer.getContainedDirectionalText(root);
        const result = { name, simple: fixer._simpleProseShapes.get(root)?.simple, textPreserved: root.textContent === original };
        root.remove();
        return result;
      });
    }
  }).then(results => results[0].result), { tabId, cases });
  expect(results).toEqual(cases.map(({ name }) => ({ name, simple: false, textPreserved: true })));
  await page.close();
});

test('Fresh directional reads detect same-text math changes and limit the cache to paragraphs and headings', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-shape-refresh');
  const result = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer;
      const root = document.createElement('p'), child = document.createElement('span');
      child.append('پاسخ فارسی'); root.append(child); document.getElementById('chat').append(root);
      const original = root.textContent, textNode = child.firstChild;
      const before = fixer.getContainedDirectionalText(root), simpleBefore = fixer._simpleProseShapes.get(root).simple;
      child.classList.add('katex');
      const math = fixer.getContainedDirectionalText(root), simpleMath = fixer._simpleProseShapes.get(root).simple;
      child.classList.remove('katex');
      const after = fixer.getContainedDirectionalText(root), simpleAfter = fixer._simpleProseShapes.get(root).simple;
      const other = ['div', 'li', 'td', 'blockquote'].map(tag => {
        const element = document.createElement(tag); element.append('فارسی');
        fixer.getContainedDirectionalText(element);
        return fixer._simpleProseShapes.has(element);
      });
      const result = { before, simpleBefore, math, simpleMath, after, simpleAfter, other,
        textPreserved: root.textContent === original && child.firstChild === textNode };
      root.remove(); return result;
    }
  }).then(results => results[0].result), tabId);
  expect(result).toEqual({ before: 'پاسخ فارسی', simpleBefore: true, math: '', simpleMath: false,
    after: 'پاسخ فارسی', simpleAfter: true, other: [false, false, false, false], textPreserved: true });
  await page.close();
});
