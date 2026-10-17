/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext(process.env.RTL_TEST_EXTENSION);
    try { await use(context); } finally { await context.close(); }
  }
});

const traversalCases = [false, true].flatMap(shadow => ['remove', 'move'].map(mutation => ({ shadow, mutation })));
traversalCases.push({ shadow: false, mutation: 'ancestor-move' });

for (const { shadow, mutation } of traversalCases) {
  const action = mutation === 'remove' ? 'Removing the current scan node' :
    mutation === 'ancestor-move' ? 'Moving the current scan node ancestor' : 'Moving the current scan node';
  test(`${action} preserves following ${shadow ? 'shadow' : 'light'} DOM prose`, async ({ context }) => {
    const { page, worker, tabId } = await openRtlFixture(context, `${mutation}-${shadow ? 'shadow-host' : 'prose-node'}`);
    await page.evaluate(shadow => {
      const root = document.getElementById('chat');
      const discard = document.createElement('div');
      discard.id = 'discard';
      discard.innerHTML = '<p id="nested-child">Loading response</p>';
      root.append(discard);
      const tail = document.createElement('p');
      tail.id = 'tail';
      tail.setAttribute('dir', 'auto');
      tail.style.cssText = 'text-align: center; padding-left: 13px;';
      tail.append('این متن فارسی بعد از بخش حذف شده باید درست پردازش شود');
      if (shadow) {
        const host = document.createElement('div');
        host.id = 'shadow-host';
        root.append(host);
        host.attachShadow({ mode: 'open' }).append(tail);
      } else root.append(tail);
      window.__traversalOriginal = {
        tail, textNode: tail.firstChild, dir: tail.getAttribute('dir'), style: tail.getAttribute('style')
      };
    }, shadow);

    const paused = await worker.evaluate(({ tabId, mutation }) => chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', args: [mutation], func: mutation => {
        const fixer = window.RtlFixer;
        // Control a real iterator at an actual yield boundary. An observer's
        // later rescan must not hide a lost traversal of this connected root.
        fixer.stopObserver();
        fixer.config.enabled = true;
        fixer._isActive = true;
        fixer.applyStyles();
        const root = document.getElementById('chat');
        const cursor = document.getElementById(mutation === 'ancestor-move' ? 'nested-child' : 'discard');
        const createWalker = document.createTreeWalker;
        const state = window.__traversalScan = { walkers: [], createWalker, iterator: null, mutationCallbacks: 0, blockedMessages: [] };
        if (mutation === 'ancestor-move') {
          // The fixture starts with RTL disabled. Initialize the production
          // handler before substituting our observer of this controlled root.
          fixer.startObserver();
          fixer.observer.disconnect();
          // Deliver genuine page records to the production handler, but hold
          // its posted tasks so a second scan cannot repair the first one.
          state.postMessage = MessagePort.prototype.postMessage;
          state.requestAnimationFrame = window.requestAnimationFrame;
          window.requestAnimationFrame = callback => { state.blockedMessages.push(callback); return 100000 + state.blockedMessages.length; };
          MessagePort.prototype.postMessage = function (...args) {
            if (typeof args[0] === 'number') { state.blockedMessages.push(args[0]); return; }
            return state.postMessage.apply(this, args);
          };
          state.observer = new MutationObserver(records => {
            state.mutationCallbacks++;
            fixer.handlePageMutations(records);
          });
          state.observer.observe(root, { childList: true, subtree: true });
        }
        document.createTreeWalker = function (...args) {
          const walker = createWalker.apply(this, args);
          if (args[0] === root && args[1] === NodeFilter.SHOW_ELEMENT) state.walkers.push(walker);
          return walker;
        };
        state.iterator = fixer.scanAndProcessSteps(root);
        for (let steps = 0; steps < 1000; steps++) {
          const step = state.iterator.next();
          if (state.walkers.some(walker => walker.currentNode === cursor)) {
            return { pausedAtDiscard: true, rootConnected: root.isConnected, scanComplete: step.done };
          }
          if (step.done) break;
        }
        document.createTreeWalker = createWalker;
        return { pausedAtDiscard: false };
      }
    }).then(results => results[0].result), { tabId, mutation });
    expect(paused).toEqual({ pausedAtDiscard: true, rootConnected: true, scanComplete: false });

    // The host page removes or reorders the node between extension tasks, as
    // happens when a streaming chat replaces or moves a loading placeholder.
    await page.locator('#discard').evaluate((node, mutation) => {
      if (mutation === 'remove') node.remove();
      else node.parentNode.append(node);
    }, mutation);
    if (mutation === 'ancestor-move') {
      await expect.poll(() => worker.evaluate(tabId => chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED', func: () => {
          const state = window.__traversalScan;
          return state.mutationCallbacks > 0 && state.blockedMessages.length > 0;
        }
      }).then(results => results[0].result), tabId)).toBe(true);
    }
    const completed = await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', func: () => {
        const state = window.__traversalScan;
        try {
          for (let steps = 0; steps < 1000; steps++) {
            if (state.iterator.next().done) return true;
          }
          return false;
        } finally {
          document.createTreeWalker = state.createWalker;
          state.observer?.disconnect();
          if (state.postMessage) {
            window.RtlFixer.stopObserver();
            MessagePort.prototype.postMessage = state.postMessage;
            window.requestAnimationFrame = state.requestAnimationFrame;
          }
        }
      }
    }).then(results => results[0].result), tabId);
    expect(completed).toBe(true);
    await expect(page.locator('#tail')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#tail')).toHaveClass(/rtl-fixer-target/);
    expect(await page.evaluate(() => {
      const original = window.__traversalOriginal;
      return original.tail.isConnected && original.tail.firstChild === original.textNode;
    })).toBe(true);

    await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', func: () => {
        window.RtlFixer._isActive = false;
        window.RtlFixer.removeRtlFixes();
      }
    }), tabId);
    expect(await page.evaluate(() => {
      const original = window.__traversalOriginal;
      return {
        originalDir: original.dir, restoredDir: original.tail.getAttribute('dir'),
        originalStyle: original.style, restoredStyle: original.tail.getAttribute('style'),
        sameTextNode: original.tail.firstChild === original.textNode
      };
    })).toEqual({
      originalDir: 'auto', restoredDir: 'auto',
      originalStyle: 'text-align: center; padding-left: 13px;',
      restoredStyle: 'text-align: center; padding-left: 13px;', sameTextNode: true
    });
    await expect(page.locator('#tail')).not.toHaveClass(/rtl-fixer-target/);
    await page.close();
  });
}
