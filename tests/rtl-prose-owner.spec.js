/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext(process.env.RTL_TEST_EXTENSION);
    try { await use(context); } finally { await context.close(); }
  }
});

test('Deep formatting wrappers resolve to the nearest prose block without crossing layout or code', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-owner-formatting');
  const result = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const owner = window.RtlFixer.getInlineProseOwner;
      const wrappers = ['span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'a', 'sub', 'sup', 'bdi'];
      const roots = ['p', 'h1', 'h6', 'li', 'dt', 'dd', 'td', 'th', 'blockquote'];
      const formatted = roots.map(tag => {
        const root = document.createElement(tag); let probe = root;
        for (const wrapper of wrappers) { const child = document.createElement(wrapper); probe.append(child); probe = child; }
        probe.append('پاسخ فارسی'); document.getElementById('chat').append(root);
        const match = owner(probe) === root, self = owner(root);
        root.remove(); return { tag, match, self: self === null };
      });
      const boundaries = ['div', 'section', 'code', 'pre', 'kbd', 'samp', 'button'].map(tag => {
        const root = document.createElement('p'), boundary = document.createElement(tag), probe = document.createElement('span');
        probe.append('فارسی'); boundary.append(probe); root.append(boundary); document.getElementById('chat').append(root);
        const blocked = owner(probe) === null;
        root.remove(); return { tag, blocked };
      });
      return { formatted, boundaries };
    }
  }).then(results => results[0].result), tabId);
  expect(result.formatted).toEqual(['p', 'h1', 'h6', 'li', 'dt', 'dd', 'td', 'th', 'blockquote'].map(tag => ({ tag, match: true, self: true })));
  expect(result.boundaries).toEqual(['div', 'section', 'code', 'pre', 'kbd', 'samp', 'button'].map(tag => ({ tag, blocked: true })));
  await page.close();
});

test('Math markers and inherited editing states stop paragraph promotion', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-owner-protected');
  const cases = [
    { name: 'KaTeX wrapper', wrapper: { class: 'katex' } },
    { name: 'MathJax wrapper', wrapper: { class: 'MathJax_Display' } },
    { name: 'math role', wrapper: { role: 'math' } },
    { name: 'editable wrapper', wrapper: { contenteditable: 'true' } },
    { name: 'plaintext wrapper', wrapper: { contenteditable: 'plaintext-only' } },
    { name: 'editable paragraph', root: { contenteditable: 'true' } },
    { name: 'plaintext paragraph', root: { contenteditable: 'plaintext-only' } },
    { name: 'editable paragraph with false child boundary', root: { contenteditable: 'true' }, wrapper: { contenteditable: 'false' } },
    { name: 'math paragraph', root: { class: 'katex' } }
  ];
  const result = await worker.evaluate(({ tabId, cases }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [cases], func: cases => {
      const fixer = window.RtlFixer;
      const blocked = cases.map(item => {
        const root = document.createElement('p'), wrapper = document.createElement('span'), probe = document.createElement('strong');
        for (const [name, value] of Object.entries(item.root || {})) root.setAttribute(name, value);
        for (const [name, value] of Object.entries(item.wrapper || {})) wrapper.setAttribute(name, value);
        probe.append('فارسی'); wrapper.append(probe); root.append(wrapper); document.getElementById('chat').append(root);
        const result = { name: item.name, blocked: fixer.getInlineProseOwner(probe) === null };
        root.remove(); return result;
      });
      const root = document.createElement('p'), math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math'), probe = document.createElement('span');
      probe.append('فارسی'); math.append(probe); root.append(math); document.getElementById('chat').append(root);
      blocked.push({ name: 'native MathML', blocked: fixer.getInlineProseOwner(probe) === null });
      root.remove(); return blocked;
    }
  }).then(results => results[0].result), { tabId, cases });
  expect(result).toEqual([...cases.map(({ name }) => ({ name, blocked: true })), { name: 'native MathML', blocked: true }]);
  await page.close();
});

test('Non-editable boundaries remain valid prose and shadow ancestry stays local', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'prose-owner-editing-boundaries');
  const result = await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer;
      const accepted = ['false', 'invalid-value'].map(value => {
        const root = document.createElement('p'), wrapper = document.createElement('span'), probe = document.createElement('strong');
        wrapper.setAttribute('contenteditable', value); probe.append('فارسی'); wrapper.append(probe); root.append(wrapper);
        document.getElementById('chat').append(root);
        const result = fixer.getInlineProseOwner(probe) === root;
        root.remove(); return result;
      });
      const editor = document.createElement('div'), root = document.createElement('p'), probe = document.createElement('span');
      editor.contentEditable = 'true'; root.contentEditable = 'false'; probe.append('فارسی'); root.append(probe); editor.append(root);
      document.getElementById('chat').append(editor);
      const falseParagraph = fixer.getInlineProseOwner(probe) === root;
      editor.remove();
      const outer = document.createElement('p'), host = document.createElement('span');
      outer.append(host); document.getElementById('chat').append(outer);
      const shadow = host.attachShadow({ mode: 'open' }), unwrapped = document.createElement('span');
      shadow.append(unwrapped);
      const noShadowEscape = fixer.getInlineProseOwner(unwrapped) === null;
      const inner = document.createElement('p'), wrapped = document.createElement('strong');
      wrapped.append('فارسی'); inner.append(wrapped); shadow.append(inner);
      const localShadowOwner = fixer.getInlineProseOwner(wrapped) === inner;
      outer.remove(); return { accepted, falseParagraph, noShadowEscape, localShadowOwner };
    }
  }).then(results => results[0].result), tabId);
  expect(result).toEqual({ accepted: [true, true], falseParagraph: true, noShadowEscape: true, localShadowOwner: true });
  await page.close();
});
