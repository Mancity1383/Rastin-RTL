/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, rtlSettings } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

async function pauseAfterBaselineReads(worker, tabId) {
  return worker.evaluate(({ tabId, settings }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [settings], func: settings => {
      const fixer = window.RtlFixer;
      fixer.stopObserver();
      Object.assign(fixer.config, settings);
      fixer._isActive = true;
      fixer.applyStyles();
      const state = window.__batchingScan = { postMessage: MessagePort.prototype.postMessage, requestAnimationFrame: window.requestAnimationFrame, blocked: [] };
      window.requestAnimationFrame = callback => { state.blocked.push(callback); return 100000 + state.blocked.length; };
      MessagePort.prototype.postMessage = function (...args) {
        if (typeof args[0] === 'number') { state.blocked.push(args[0]); return; }
        return state.postMessage.apply(this, args);
      };
      fixer.startObserver();
      const root = document.getElementById('chat');
      state.iterator = fixer.scanAndProcessSteps(root);
      const last = document.getElementById('last-prose');
      for (let index = 0; index < 2000; index++) {
        const result = state.iterator.next();
        if (fixer._originalElementState.has(last)) {
          state.readVersion = fixer.getNodeMutationVersion(document.getElementById('semantic-prose'));
          state.readStructureVersion = fixer._domStructureMutationVersion || 0;
          return { paused: true, baselineReadsFinished: true, firstProseUntouched: !root.querySelector('[dir="rtl"]') };
        }
        if (result.done) break;
      }
      return { paused: false };
    }
  }).then(results => results[0].result), { tabId, settings: rtlSettings });
}

async function finishScan(worker, tabId, restore = false) {
  return worker.evaluate(({ tabId, restore }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [restore], func: restore => {
      const state = window.__batchingScan;
      let completed = false;
      for (let index = 0; index < 2000; index++) {
        if (state.iterator.next().done) { completed = true; break; }
      }
      window.RtlFixer.stopObserver();
      MessagePort.prototype.postMessage = state.postMessage;
      window.requestAnimationFrame = state.requestAnimationFrame;
      if (restore) window.RtlFixer.removeRtlFixes();
      return completed;
    }
  }).then(results => results[0].result), { tabId, restore });
}

async function createFixture(page) {
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `
      <p id="first-prose">این متن فارسی برای بررسی آماده است</p>
      <p id="semantic-prose">English code: <strong id="semantic-inline">شرح متن فارسی</strong></p>
      <ul id="changing-list" style="padding-left: 40px"><li>مورد اول فارسی</li><li>مورد دوم فارسی</li></ul>
      <p id="changing-direction" dir="auto" style="text-align: center">جهت این بخش توسط سایت تغییر می‌کند</p>
      ${Array.from({ length: 48 }, (_, index) => `<p>پیام فارسی شماره ${index}</p>`).join('')}
      <p id="last-prose">آخرین متن فارسی برای بررسی آماده است</p>`;
  });
}

test('Yielded baseline capture retains later site direction and list spacing edits', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'yielded-site-baselines');
  await createFixture(page);
  expect(await pauseAfterBaselineReads(worker, tabId)).toEqual({ paused: true, baselineReadsFinished: true, firstProseUntouched: true });
  await page.evaluate(() => {
    const list = document.getElementById('changing-list');
    list.style.paddingLeft = '65px';
    const paragraph = document.getElementById('changing-direction');
    paragraph.setAttribute('dir', 'ltr');
    paragraph.style.textAlign = 'right';
  });
  expect(await finishScan(worker, tabId)).toBe(true);
  await expect(page.locator('#first-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#changing-direction')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#changing-direction')).not.toHaveClass(/rtl-fixer-rtl-detected/);
  await expect(page.locator('#changing-list')).toHaveCSS('padding-inline-start', '65px');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.removeRtlFixes()
  }), tabId);
  await expect(page.locator('#changing-list')).toHaveCSS('padding-left', '65px');
  await expect(page.locator('#changing-direction')).toHaveAttribute('dir', 'ltr');
  expect(await page.locator('#changing-direction').getAttribute('style')).toBe('text-align: right;');
});

test('Same-text structural changes invalidate a prepared prose classification before writes', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'yielded-semantic-mutation');
  await createFixture(page);
  expect((await pauseAfterBaselineReads(worker, tabId)).paused).toBe(true);
  const originalText = await page.locator('#semantic-prose').textContent();
  await page.locator('#semantic-inline').evaluate(strong => {
    const code = document.createElement('code');
    code.id = 'semantic-code';
    code.textContent = strong.textContent;
    strong.replaceWith(code);
  });
  expect(await page.locator('#semantic-prose').textContent()).toBe(originalText);
  await expect.poll(() => worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () =>
      window.RtlFixer.getNodeMutationVersion(document.getElementById('semantic-prose')) > window.__batchingScan.readVersion
  }).then(results => results[0].result), tabId)).toBe(true);
  expect(await finishScan(worker, tabId)).toBe(true);
  await expect(page.locator('#first-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#semantic-prose')).not.toHaveAttribute('dir', /.+/);
  await expect(page.locator('#semantic-prose')).not.toHaveClass(/rtl-fixer-target/);
  await expect(page.locator('#semantic-code')).not.toHaveClass(/rtl-fixer-target/);
});

test('Class-based list spacing changed during yielded reads is refreshed and restored', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'yielded-class-baseline');
  await createFixture(page);
  await page.addStyleTag({ content: '#changing-list.site-list-spacing { padding-left: 72px !important; }' });
  expect((await pauseAfterBaselineReads(worker, tabId)).paused).toBe(true);
  await page.locator('#changing-list').evaluate(list => list.classList.add('site-list-spacing'));
  expect(await finishScan(worker, tabId)).toBe(true);
  await expect(page.locator('#changing-list')).toHaveCSS('padding-inline-start', '72px');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.removeRtlFixes()
  }), tabId);
  await expect(page.locator('#changing-list')).toHaveClass('site-list-spacing');
  await expect(page.locator('#changing-list')).toHaveCSS('padding-left', '72px');
});

test('Fast scanner markers retain every protected math and extension UI shape', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'scanner-marker-protection');
  await page.evaluate(() => {
    const root = document.getElementById('chat');
    const mathClasses = ['math-inline', 'math-display', 'katex', 'katex-display', 'katex-html', 'katex-mathml',
      'MathJax', 'MathJax_Display', 'MathJax_Preview', 'mjx-container', 'mjx-chtml', 'mjx-math',
      'mathjax-latex', 'prefix-katex-suffix', 'prefix-MathJax-suffix', 'prefix-mjx-suffix'];
    for (const className of mathClasses) {
      const math = document.createElement('div');
      math.className = className;
      math.innerHTML = '<p class="protected-prose">این متن در فرمول باید محافظت شود</p>';
      root.append(math);
    }
    for (const marker of [{ role: 'math' }, { tag: 'mjx-container' }, { tag: 'mjx-chtml' }, { tag: 'mjx-math' }]) {
      const math = document.createElement(marker.tag || 'div');
      if (marker.role) math.setAttribute('role', marker.role);
      math.innerHTML = '<p class="protected-prose">متن محافظت شده در فرمول</p>';
      root.append(math);
    }
    const nativeMath = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math');
    const nativeMathText = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mtext');
    nativeMathText.classList.add('protected-prose');
    nativeMathText.textContent = 'متن فارسی فرمول بومی';
    nativeMath.append(nativeMathText);
    root.append(nativeMath);
    for (const marker of [{ id: 'rastin-highlight-bar' }, { id: 'rtl-fixer-translator-host' },
      { className: 'rastin-note' }, { attribute: 'data-rastin-reader-ui' }]) {
      const widget = document.createElement('div');
      if (marker.id) widget.id = marker.id;
      if (marker.className) widget.className = marker.className;
      if (marker.attribute) widget.setAttribute(marker.attribute, '');
      widget.innerHTML = '<p class="protected-prose">متن ابزار افزونه باید محافظت شود</p>';
      root.append(widget);
    }
    const ordinary = document.createElement('div');
    ordinary.className = 'not-math-inline-looking';
    ordinary.id = 'rastin-ordinary-content';
    ordinary.innerHTML = '<p id="ordinary-prose" style="padding-left: 31px">این متن معمولی باید راست به چپ شود</p>';
    root.append(ordinary);
  });
  await worker.evaluate(({ tabId, settings }) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', args: [settings], func: settings => {
      const fixer = window.RtlFixer;
      Object.assign(fixer.config, settings);
      fixer._isActive = true;
      fixer.applyStyles();
      fixer.scanAndProcess(document.getElementById('chat'));
      fixer.setManagedStyle(document.getElementById('ordinary-prose'), 'padding-left', '0px', 'important');
    }
  }), { tabId, settings: rtlSettings });
  expect(await page.locator('.protected-prose[dir], .protected-prose.rtl-fixer-target').count()).toBe(0);
  await expect(page.locator('#ordinary-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#ordinary-prose')).toHaveCSS('padding-left', '0px');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.removeRtlFixes()
  }), tabId);
  await expect(page.locator('#ordinary-prose')).toHaveCSS('padding-left', '31px');
});

for (const protection of ['math', 'code', 'editable', 'extension-ui']) {
  test(`Moving a prepared ancestor into ${protection} preserves the new protected context`, async ({ context }) => {
    const { page, worker, tabId } = await openRtlFixture(context, `prepared-ancestor-${protection}`);
    await createFixture(page);
    await page.evaluate(protection => {
      const p = document.getElementById('semantic-prose');
      const wrapper = document.createElement('div');
      wrapper.id = 'moving-wrapper';
      p.replaceWith(wrapper);
      wrapper.append(p);
      const protectedHost = document.createElement(protection === 'code' ? 'code' : 'div');
      protectedHost.id = 'protected-destination';
      if (protection === 'math') protectedHost.setAttribute('role', 'math');
      if (protection === 'editable') protectedHost.setAttribute('contenteditable', 'true');
      if (protection === 'extension-ui') protectedHost.setAttribute('data-rastin-reader-ui', '');
      document.body.append(protectedHost);
      window.__semanticOriginal = { p, textNode: p.firstChild, text: p.textContent, parent: p.parentElement };
    }, protection);
    expect((await pauseAfterBaselineReads(worker, tabId)).paused).toBe(true);
    await page.evaluate(() => document.getElementById('protected-destination').append(document.getElementById('moving-wrapper')));
    expect(await page.evaluate(() => {
      const original = window.__semanticOriginal;
      return original.p.parentElement === original.parent && original.p.textContent === original.text;
    })).toBe(true);
    await expect.poll(() => worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', func: () =>
        window.RtlFixer._domStructureMutationVersion > window.__batchingScan.readStructureVersion
    }).then(results => results[0].result), tabId)).toBe(true);
    expect(await finishScan(worker, tabId)).toBe(true);
    await expect(page.locator('#first-prose')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#semantic-prose')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#semantic-prose')).not.toHaveClass(/rtl-fixer-target/);
    await expect(page.locator('#semantic-inline')).not.toHaveClass(/rtl-fixer-target/);
    expect(await page.evaluate(() => window.__semanticOriginal.p.firstChild === window.__semanticOriginal.textNode)).toBe(true);
  });
}
