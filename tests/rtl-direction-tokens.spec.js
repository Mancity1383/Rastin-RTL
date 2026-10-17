/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';
import { instrumentRtl } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

test('Automatic, empty and invalid direction tokens accept RTL and restore their exact author values', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'automatic-direction-tokens');
  const tokens = ['auto', 'AUTO', 'Auto', '', 'inherit', 'undefined', ' ltr '];
  await page.evaluate(tokens => {
    const root = document.getElementById('chat');
    for (const [index, token] of tokens.entries()) {
      const p = document.createElement('p');
      p.id = `direction-${index}`;
      p.setAttribute('dir', token);
      p.textContent = 'UART نشان می‌دهد که این متن فارسی باید راست به چپ خوانده شود';
      root.append(p);
    }
  }, tokens);
  await sendRtlSettings(worker, tabId, rtlSettings);
  for (let index = 0; index < tokens.length; index++) {
    await expect(page.locator(`#direction-${index}`)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator(`#direction-${index}`)).toHaveCSS('direction', 'rtl');
  }
  await page.locator('#direction-0').evaluate(p => p.setAttribute('dir', 'AUTO'));
  await expect(page.locator('#direction-0')).toHaveAttribute('dir', 'rtl');
  await sendRtlSettings(worker, tabId, { enabled: false });
  for (let index = 0; index < tokens.length; index++) {
    await expect(page.locator(`#direction-${index}`)).toHaveAttribute('dir', index === 0 ? 'AUTO' : tokens[index]);
  }
});

test('Valid explicit direction tokens preserve author intent regardless of case', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'explicit-direction-tokens');
  const tokens = ['ltr', 'LTR', 'Ltr', 'rtl', 'RTL', 'Rtl'];
  await page.evaluate(tokens => {
    const root = document.getElementById('chat');
    for (const [index, token] of tokens.entries()) {
      const p = document.createElement('p');
      p.id = `explicit-${index}`;
      p.setAttribute('dir', token);
      p.textContent = 'این متن فارسی با جهت مشخص شده توسط نویسنده است';
      root.append(p);
    }
  }, tokens);
  await sendRtlSettings(worker, tabId, rtlSettings);
  for (let index = 0; index < tokens.length; index++) {
    const p = page.locator(`#explicit-${index}`);
    await expect(p).toHaveAttribute('dir', tokens[index]);
    await expect(p).toHaveCSS('direction', tokens[index].toLowerCase());
    await expect(p).not.toHaveClass(/rtl-fixer-rtl-detected/);
  }
  await sendRtlSettings(worker, tabId, { enabled: false });
  for (let index = 0; index < tokens.length; index++) {
    await expect(page.locator(`#explicit-${index}`)).toHaveAttribute('dir', tokens[index]);
  }
});

test('Managed simple prose updates once while new same-text math attributes force the full protected path', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'simple-prose-consumer');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'simple-prose';
    p.dir = 'auto';
    p.append('UART توضیح فارسی درباره انتقال داده همراه ');
    const strong = document.createElement('strong');
    strong.id = 'formatting-or-math';
    strong.textContent = 'شرح فارسی طولانی';
    p.append(strong);
    document.getElementById('chat').append(p);
    window.__simpleProseNodes = [p.firstChild, strong.firstChild];
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#simple-prose')).toHaveAttribute('dir', 'rtl');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
  const scan = () => worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      window.__rtlBenchmark.reset();
      const p = document.getElementById('simple-prose');
      window.RtlFixer.scanAndProcess(p);
      return { simple: window.RtlFixer._simpleProseShapes.get(p)?.simple,
        applications: window.__rtlBenchmark.metrics.applications,
        elementVisits: window.__rtlBenchmark.metrics.elementTraversalVisits };
    }
  }).then(results => results[0].result), tabId);
  // Attribute-only changes do not increment the structural epoch. The fresh
  // text walk must notice that a previously plain strong element became math.
  expect(await scan()).toEqual({ simple: true, applications: 1, elementVisits: 0 });
  await page.locator('#formatting-or-math').evaluate(strong => strong.setAttribute('role', 'math'));
  const result = await scan();
  expect(result.simple).toBe(false);
  await expect(page.locator('#simple-prose')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#formatting-or-math')).not.toHaveClass(/rtl-fixer-target/);
  await expect(page.locator('#formatting-or-math')).toHaveCSS('direction', 'ltr');
  expect(await page.evaluate(() => window.__simpleProseNodes.every(node => node.isConnected))).toBe(true);
  expect((await instrumentRtl(worker, tabId, 'metrics')).outsideScanApplications).toBe(0);
});
