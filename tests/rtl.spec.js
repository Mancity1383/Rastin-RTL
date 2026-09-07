/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callback, not React */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extensionPath = path.join(__dirname, '..');

async function sendSettingsToExampleTab(context, settings) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
  const tab = tabs[tabs.length - 1];
  await worker.evaluate(({ tabId, nextSettings }) => new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action: 'updateSettings', settings: nextSettings }, resolve);
  }), { tabId: tab.id, nextSettings: settings });
}

const test = base.extend({
  context: async ({ browserName: _browserName }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await use(page);
  }
});

test.describe('RTL Fixer Scenarios', () => {
  
  test.beforeEach(async ({ page, context }) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_example.com': { enabled: true }
    }));

    // Intercept requests to avoid actual network calls, preventing net::ERR_ABORTED timeouts
    await page.route('https://example.com/**', async route => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
    });
    // Navigate to the mocked page
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { document.body.innerHTML = ''; });
  });

  test('1. Basic RTL Application', async ({ page }) => {
    await test.step('Inject Persian text', async () => {
      await page.evaluate(() => {
        const h3 = document.createElement('h3');
        h3.id = 'test-h3';
        h3.textContent = 'این یک متن فارسی است';
        document.body.appendChild(h3);
      });
    });

    await test.step('Verify direction applied', async () => {
      const h3 = page.locator('#test-h3');
      await expect(h3).toHaveAttribute('dir', 'rtl', { timeout: 5000 });
    });
  });

  test('2. Persian Digits Conversion', async ({ page, context }) => {
    // We need to enable Persian digits first. We'll do it by updating local storage.
    await test.step('Enable Persian digits in config', async () => {
      let worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker');
      }
      await worker.evaluate(async () => {
        const stored = await chrome.storage.local.get('site_config_example.com');
        await chrome.storage.local.set({
          'site_config_example.com': { ...stored['site_config_example.com'], enabled: true, persianDigits: true }
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject mixed text with English numbers', async () => {
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.id = 'test-nums';
        p.textContent = 'تست اعداد: 12345';
        document.body.appendChild(p);
      });
    });

    await test.step('Verify digits are converted', async () => {
      await page.waitForTimeout(1000); 
      const text = await page.locator('#test-nums').textContent();
      expect(text).toContain('۱۲۳۴۵');
      expect(text).not.toContain('12345');
    });
  });

  test('3. Dynamic Inputs', async ({ page }) => {
    await test.step('Inject an input field', async () => {
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'test-input';
        input.value = 'سلام';
        document.body.appendChild(input);
      });
    });

    await test.step('Type and verify RTL alignment', async () => {
      await page.waitForTimeout(500); 
      // Type dynamically to trigger the input event listeners in the extension
      await page.locator('#test-input').type(' دنیا');
      await expect(page.locator('#test-input')).toHaveAttribute('dir', 'rtl', { timeout: 5000 });
    });
  });

  test('4. List padding-inline-start Fixes', async ({ page }) => {
    await test.step('Inject list with hardcoded padding-left', async () => {
      await page.evaluate(() => {
        const ul = document.createElement('ul');
        ul.id = 'test-ul';
        ul.style.paddingLeft = '40px';
        const li = document.createElement('li');
        li.textContent = 'مورد اول';
        ul.appendChild(li);
        document.body.appendChild(ul);
      });
    });

    await test.step('Verify padding is swapped to inline-start', async () => {
      await page.waitForTimeout(1000); 
      const paddingLeft = await page.locator('#test-ul').evaluate(el => el.style.paddingLeft);
      const paddingInlineStart = await page.locator('#test-ul').evaluate(el => el.style.paddingInlineStart);
      
      expect(paddingLeft).toBe('0px');
      expect(paddingInlineStart).toBe('40px');
    });
  });

  test('5. Mixed text does not rewrite framework-owned text nodes', async ({ page }) => {
    await test.step('Inject RTL text with an English word in the middle', async () => {
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.id = 'test-punctuation';
        p.textContent = 'متن فارسی با کلمه English وسط آن.';
        document.body.appendChild(p);
      });
    });

    await test.step('Verify the original text node is preserved', async () => {
      await page.waitForTimeout(1000);
      const hasIsolate = await page.locator('#test-punctuation bdi.rtl-fixer-isolate').count();
      expect(hasIsolate).toBe(0);
      expect(await page.locator('#test-punctuation').textContent()).toBe('متن فارسی با کلمه English وسط آن.');
    });
  });

  test('6. Dynamic RTL content is recalculated when it becomes LTR', async ({ page }) => {
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'dynamic-direction';
      p.textContent = 'این متن فارسی است';
      const replacement = document.createElement('p');
      replacement.id = 'replacement-direction';
      replacement.textContent = 'این متن فارسی است';
      document.body.append(p, replacement);
    });
    await expect(page.locator('#dynamic-direction')).toHaveAttribute('dir', 'rtl', { timeout: 5000 });
    await page.locator('#dynamic-direction').evaluate(el => { el.firstChild.data = 'This content is now English'; });
    await page.locator('#replacement-direction').evaluate(el => { el.textContent = 'Replacement is now English'; });
    await expect(page.locator('#dynamic-direction')).not.toHaveAttribute('dir', /.+/, { timeout: 5000 });
    await expect(page.locator('#dynamic-direction')).not.toHaveClass(/rtl-fixer-target/);
    await expect(page.locator('#replacement-direction')).not.toHaveAttribute('dir', /.+/, { timeout: 5000 });
    await expect(page.locator('#replacement-direction')).not.toHaveClass(/rtl-fixer-target/);
  });

  test('7. A Persian table cell never changes table or row direction', async ({ page }) => {
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<table id="safe-table"><tbody><tr id="safe-row"><td>متن فارسی</td><td>100</td></tr></tbody></table>');
    });
    await page.waitForTimeout(1000);
    await expect(page.locator('#safe-table')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#safe-row')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('body')).not.toHaveAttribute('dir', /.+/);
  });

  test('8. Setting Toggle - Enable Domains', async ({ page, context }) => {
    await test.step('Disable extension on example.com by clearing enabledDomains', async () => {
      let worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker');
      }
      await worker.evaluate(() => chrome.storage.local.set({
        'site_config_example.com': { enabled: false }
      }));
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject Persian text and verify no direction is applied', async () => {
      await page.evaluate(() => {
        const h3 = document.createElement('h3');
        h3.id = 'disabled-h3';
        h3.textContent = 'متن فارسی در دامنه غیرفعال';
        document.body.appendChild(h3);
      });
      await page.waitForTimeout(1000);
      const dirValue = await page.locator('#disabled-h3').getAttribute('dir');
      expect(dirValue).toBeNull();
    });

    await test.step('Enable extension on example.com by adding to enabledDomains', async () => {
      let worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker');
      }
      await worker.evaluate(() => chrome.storage.local.set({
        'site_config_example.com': { enabled: true }
      }));
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject Persian text and verify direction is applied', async () => {
      await page.evaluate(() => {
        const h3 = document.createElement('h3');
        h3.id = 'enabled-h3';
        h3.textContent = 'متن فارسی در دامنه فعال شده';
        document.body.appendChild(h3);
      });
      await page.waitForTimeout(1000);
      const dirValue = await page.locator('#enabled-h3').getAttribute('dir');
      expect(dirValue).toBe('rtl');
    });
  });

  test('9. Structural containers are never auto-RTL targets', async ({ page }) => {
    await page.evaluate(() => {
      const header = document.createElement('header');
      header.id = 'structural-header';
      header.append('عنوان فارسی');
      for (let index = 0; index < 30; index++) {
        const button = document.createElement('button');
        button.textContent = `Button ${index}`;
        header.append(button);
      }
      const table = document.createElement('table');
      table.id = 'direct-table';
      table.append(document.createTextNode('متن مستقیم فارسی'));
      document.body.append(header, table);
    });
    await page.waitForTimeout(700);
    await expect(page.locator('#structural-header')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#direct-table')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#structural-header')).not.toHaveClass(/rtl-fixer-target/);
    await expect(page.locator('#direct-table')).not.toHaveClass(/rtl-fixer-target/);
  });

  test('10. Shadow DOM targets are fully restored on disable', async ({ page, context }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'shadow-host';
      const root = host.attachShadow({ mode: 'open' });
      const paragraph = document.createElement('p');
      paragraph.id = 'shadow-paragraph';
      paragraph.textContent = 'متن فارسی';
      root.append(paragraph);
      document.body.append(host);
    });
    await page.waitForFunction(() => document.getElementById('shadow-host').shadowRoot.getElementById('shadow-paragraph').dir === 'rtl');
    await sendSettingsToExampleTab(context, { enabled: false });
    const state = await page.evaluate(() => {
      const paragraph = document.getElementById('shadow-host').shadowRoot.getElementById('shadow-paragraph');
      return { dir: paragraph.getAttribute('dir'), className: paragraph.className };
    });
    expect(state.dir).toBeNull();
    expect(state.className).not.toContain('rtl-fixer-');
  });

  test('11. Persian digit cleanup restores the latest site text', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_example.com': { enabled: true, persianDigits: true }
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'live-digits';
      paragraph.textContent = 'قدیمی 123';
      document.body.append(paragraph);
    });
    await expect(page.locator('#live-digits')).toContainText('۱۲۳');
    await page.locator('#live-digits').evaluate(el => { el.firstChild.data = 'جدید 456'; });
    await expect(page.locator('#live-digits')).toContainText('۴۵۶');
    await sendSettingsToExampleTab(context, { enabled: false });
    await expect(page.locator('#live-digits')).toHaveText('جدید 456');
  });

  test('12. Cleanup preserves style changes made later by the site', async ({ page, context }) => {
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'site-owned-style';
      paragraph.textContent = 'متن فارسی';
      document.body.append(paragraph);
    });
    await expect(page.locator('#site-owned-style')).toHaveAttribute('dir', 'rtl');
    await page.locator('#site-owned-style').evaluate(el => {
      el.style.direction = 'ltr';
      el.style.textAlign = 'center';
    });
    await sendSettingsToExampleTab(context, { enabled: false });
    const style = await page.locator('#site-owned-style').evaluate(el => ({
      direction: el.style.direction,
      textAlign: el.style.textAlign
    }));
    expect(style).toEqual({ direction: 'ltr', textAlign: 'center' });
  });

  test('13. Empty Shadow DOM input restores its host direction', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'input-shadow-host';
      const root = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input');
      input.value = 'سلام';
      root.append(input);
      document.body.append(host);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    });
    await page.waitForFunction(() => document.getElementById('input-shadow-host').style.direction === 'rtl');
    await page.evaluate(() => {
      const input = document.getElementById('input-shadow-host').shadowRoot.querySelector('input');
      input.value = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    });
    await expect.poll(() => page.locator('#input-shadow-host').evaluate(el => el.style.direction)).toBe('');
  });

  test('14. Auto direction preserves site text alignment', async ({ page }) => {
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'centered-rtl';
      paragraph.style.textAlign = 'center';
      paragraph.textContent = 'این متن فارسی وسط‌چین است';
      document.body.append(paragraph);
    });
    await expect(page.locator('#centered-rtl')).toHaveAttribute('dir', 'rtl');
    expect(await page.locator('#centered-rtl').evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
  });

  test('15. Persian digit mode does not alter Hebrew numbers', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_example.com': { enabled: true, persianDigits: true }
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'hebrew-numbers';
      paragraph.textContent = 'שלום 123';
      document.body.append(paragraph);
    });
    await expect(page.locator('#hebrew-numbers')).toHaveText('שלום 123');
  });

  test('16. A small RTL child does not flip an otherwise LTR table cell', async ({ page }) => {
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<table><tbody><tr><td id="mixed-cell">Status: <span>فارسی</span></td></tr></tbody></table>');
    });
    await page.waitForTimeout(700);
    await expect(page.locator('#mixed-cell')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#mixed-cell')).not.toHaveClass(/rtl-fixer-target/);
    await expect(page.locator('#mixed-cell span')).toHaveAttribute('dir', 'rtl');
  });

  test('17. Nested LTR identifiers and digits are not rewritten', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_example.com': { enabled: true, persianDigits: true }
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'nested-identifier';
      paragraph.append(document.createTextNode('متن فارسی '));
      const identifier = document.createElement('span');
      identifier.id = 'technical-id';
      identifier.textContent = 'build-123';
      paragraph.append(identifier);
      document.body.append(paragraph);
    });
    await expect(page.locator('#technical-id')).toHaveText('build-123');
  });

  test('18. Dynamically inserted prefilled inputs receive direction immediately', async ({ page }) => {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'prefilled-input';
      input.value = 'متن از پیش پرشده';
      document.body.append(input);
    });
    await expect(page.locator('#prefilled-input')).toHaveAttribute('dir', 'rtl');
  });

  test('19. Nested RTL targets apply typography only once', async ({ page }) => {
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'outer-rtl';
      paragraph.append(document.createTextNode('متن والد '));
      const span = document.createElement('span');
      span.id = 'inner-rtl';
      span.textContent = 'متن فرزند';
      paragraph.append(span);
      document.body.append(paragraph);
    });
    await expect(page.locator('#outer-rtl')).toHaveClass(/rtl-fixer-typography-root/);
    await expect(page.locator('#inner-rtl')).toHaveClass(/rtl-fixer-target/);
    await expect(page.locator('#inner-rtl')).not.toHaveClass(/rtl-fixer-typography-root/);
  });

  test('20. Detached SPA nodes do not retain extension state when reattached', async ({ page }) => {
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'detached-node';
      paragraph.textContent = 'متن فارسی';
      document.body.append(paragraph);
    });
    await expect(page.locator('#detached-node')).toHaveAttribute('dir', 'rtl');
    await page.evaluate(async () => {
      const paragraph = document.getElementById('detached-node');
      paragraph.remove();
      await new Promise(resolve => setTimeout(resolve, 100));
      paragraph.textContent = 'English after reattach';
      document.body.append(paragraph);
    });
    await expect(page.locator('#detached-node')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#detached-node')).not.toHaveClass(/rtl-fixer-target/);
  });

  test('21. Markdown lists with nested paragraphs keep bullets beside RTL text', async ({ page }) => {
    await page.evaluate(() => {
      const list = document.createElement('ul');
      list.id = 'markdown-list';
      list.innerHTML = `
        <li id="markdown-item-one"><p>این <strong>request</strong> را می‌گیرد <code>backend</code></p></li>
        <li id="markdown-item-two"><p>عملیات <strong>allowlist</strong> و کنترل ورودی</p></li>
        <li id="markdown-item-three"><p>محاسبات از <strong>LLM</strong> جدا انجام می‌شوند</p></li>
      `;
      document.body.append(list);
    });
    await expect(page.locator('#markdown-list')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#markdown-item-one')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#markdown-item-one p')).toHaveAttribute('dir', 'rtl');
    const layout = await page.locator('#markdown-list').evaluate(list => {
      const item = list.querySelector('li');
      return {
        listDirection: getComputedStyle(list).direction,
        itemDirection: getComputedStyle(item).direction,
        paddingRight: parseFloat(getComputedStyle(list).paddingRight)
      };
    });
    expect(layout.listDirection).toBe('rtl');
    expect(layout.itemDirection).toBe('rtl');
    expect(layout.paddingRight).toBeGreaterThan(0);
  });

  test('22. Nested Markdown lists are recalculated when their paragraph becomes LTR', async ({ page }) => {
    await page.evaluate(() => {
      const list = document.createElement('ul');
      list.id = 'dynamic-markdown-list';
      list.innerHTML = '<li id="dynamic-markdown-item"><p id="dynamic-markdown-text">متن فارسی</p></li>';
      document.body.append(list);
    });
    await expect(page.locator('#dynamic-markdown-list')).toHaveAttribute('dir', 'rtl');
    await page.locator('#dynamic-markdown-text').evaluate(el => { el.firstChild.data = 'English only'; });
    await expect(page.locator('#dynamic-markdown-list')).not.toHaveAttribute('dir', /.+/);
    await expect(page.locator('#dynamic-markdown-item')).not.toHaveAttribute('dir', /.+/);
  });

  test('23. Persian prose that starts with plain English uses an RTL base direction', async ({ page }) => {
    await page.evaluate(() => {
      const list = document.createElement('ul');
      list.id = 'english-first-list';
      list.innerHTML = '<li><p id="english-first-plain">backend این request را می‌گیرد</p></li>';
      document.body.append(list);
    });
    await expect(page.locator('#english-first-plain')).toHaveAttribute('dir', 'rtl');
    const style = await page.locator('#english-first-plain').evaluate(el => ({
      direction: getComputedStyle(el).direction,
      unicodeBidi: getComputedStyle(el).unicodeBidi
    }));
    expect(style).toEqual({ direction: 'rtl', unicodeBidi: 'isolate' });
    await expect(page.locator('#english-first-list')).toHaveAttribute('dir', 'rtl');
  });

  test('24. A linked English title followed by a short Persian suffix stays RTL', async ({ page }) => {
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'english-link-first';
      p.innerHTML = '<a href="#">OpenAI (Function Calling / Tools)</a> در';
      document.body.append(p);
    });
    await expect(page.locator('#english-link-first')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#english-link-first')).toHaveCSS('unicode-bidi', 'isolate');
  });

  test('25. Leading inline code cannot force its Persian prose container to LTR', async ({ page }) => {
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'code-first-prose';
      p.innerHTML = '<code>TextToSQLPlan + CalculationPlan</code> <strong>(ترکیبی واقعی)</strong> 🔧';
      document.body.append(p);
    });
    await expect(page.locator('#code-first-prose')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#code-first-prose')).toHaveCSS('direction', 'rtl');
    await expect(page.locator('#code-first-prose code')).toHaveCSS('direction', 'ltr');
  });

  test('26. Shadow DOM is observed again after disable and re-enable', async ({ page, context }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'toggle-shadow-host';
      host.attachShadow({ mode: 'open' }).innerHTML = '<p id="initial-shadow-text">متن فارسی اولیه</p>';
      document.body.append(host);
    });
    await expect.poll(() => page.locator('#toggle-shadow-host').evaluate(el => el.shadowRoot.querySelector('p').dir)).toBe('rtl');

    await sendSettingsToExampleTab(context, { enabled: false });
    await expect.poll(() => page.locator('#toggle-shadow-host').evaluate(el => el.shadowRoot.querySelector('p').dir)).toBe('');
    await sendSettingsToExampleTab(context, { enabled: true });

    await page.locator('#toggle-shadow-host').evaluate(el => {
      const p = document.createElement('p');
      p.id = 'dynamic-shadow-after-toggle';
      p.textContent = 'متن فارسی بعد از فعال‌سازی';
      el.shadowRoot.append(p);
    });
    await expect.poll(() => page.locator('#toggle-shadow-host').evaluate(el => el.shadowRoot.querySelector('#dynamic-shadow-after-toggle').dir)).toBe('rtl');
  });

  test('27. Patched error listeners can still be removed and deduplicated', async ({ page }) => {
    const calls = await page.evaluate(() => {
      let count = 0;
      const listener = () => { count++; };
      window.addEventListener('error', listener);
      window.addEventListener('error', listener);
      window.dispatchEvent(new Event('error'));
      window.removeEventListener('error', listener);
      window.dispatchEvent(new Event('error'));
      return count;
    });
    expect(calls).toBe(1);
  });

  test('28. YouTube helpers find and click controls inside nested shadow roots', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rastin_adblock_active', 'true'));
    await page.route('http://localhost/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body></body></html>'
    }));
    await page.goto('http://localhost/shadow-ad-dialog', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__shadowConfirmClicks = 0;
      const gate = document.createElement('ytd-popup-container');
      const dialogHost = document.createElement('div');
      gate.append(dialogHost);
      document.body.append(gate);

      const dialogRoot = dialogHost.attachShadow({ mode: 'open' });
      const dialog = document.createElement('yt-confirm-dialog-renderer');
      const buttonHost = document.createElement('div');
      dialog.append(buttonHost);
      dialogRoot.append(dialog);

      const buttonRoot = buttonHost.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      button.textContent = 'Continue';
      button.addEventListener('click', () => { window.__shadowConfirmClicks++; });
      buttonRoot.append(button);
    });
    await expect.poll(() => page.evaluate(() => window.__shadowConfirmClicks)).toBeGreaterThan(0);
  });

  test('29. Picker selector text cannot inject markup into its HUD', async ({ page, context }) => {
    await page.evaluate(() => {
      const target = document.createElement('div');
      target.id = 'target"><img id=picker-injected src=x>';
      target.dataset.pickerTarget = 'true';
      target.textContent = 'Pick me';
      target.style.cssText = 'width:120px;height:40px;background:#ddd';
      document.body.append(target);
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
    await worker.evaluate(tabId => new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, { action: 'startElementPicker' }, resolve);
    }), tabs[tabs.length - 1].id);

    await page.locator('[data-picker-target]').hover();
    await page.locator('[data-picker-target]').click({ force: true });
    await expect(page.locator('#rtl-fixer-selector-input')).toHaveValue(/picker-injected/);
    await expect(page.locator('#picker-injected')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('30. Translator tries the next AI model before Google fallback', async ({ page, context }) => {
    let aiRequestCount = 0;
    await page.route('https://text.pollinations.ai/**', async route => {
      aiRequestCount++;
      if (aiRequestCount === 1) {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: '[TRANSLATION]\nسلام\n[PHONETIC]\n\n[DICTIONARY]\n\n[EXPLANATION]\nتوضیح'
        });
      }
    });

    await sendSettingsToExampleTab(context, {
      enabled: true,
      translatorEnabled: true,
      translatorApi: 'openai'
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
    await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => window.RtlFixer.translateText('hello', 100, 100)
    }), tabs[tabs.length - 1].id);

    await expect.poll(() => aiRequestCount).toBe(2);
  });

  test('31. Two rapid highlights are stored without losing either update', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'rtl_fixer_hl_example.com': [] }));
    await sendSettingsToExampleTab(context, { enabled: true, highlightEnabled: true });

    await page.evaluate(() => {
      const first = document.createElement('p');
      first.id = 'rapid-one';
      first.textContent = 'first highlight text';
      const second = document.createElement('p');
      second.id = 'rapid-two';
      second.textContent = 'second highlight text';
      document.body.append(first, second);
      const applySelection = (id, color) => {
        const element = document.getElementById(id);
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        document.querySelector(`.rastin-color-btn.${color}`).dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
        );
      };
      applySelection('rapid-one', 'yellow');
      applySelection('rapid-two', 'green');
    });

    await expect.poll(async () => worker.evaluate(async () => {
      const result = await chrome.storage.local.get('rtl_fixer_hl_example.com');
      return result['rtl_fixer_hl_example.com'] || [];
    })).toHaveLength(2);
  });

  test('32. Anti-adblock text shield is scoped away from ordinary framework nodes', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rastin_adblock_active', 'true'));
    await page.route('http://localhost/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body></body></html>'
    }));
    await page.goto('http://localhost/scoped-content-shield', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(() => {
      const ordinary = document.createElement('div');
      ordinary.id = 'framework-content';
      ordinary.textContent = 'Please disable your ad blocker';
      const warning = document.createElement('div');
      warning.id = 'adblock-warning-dialog';
      warning.textContent = 'Please disable your ad blocker';
      document.body.append(ordinary, warning);
      return { ordinary: ordinary.textContent, warning: warning.textContent };
    });

    expect(result.ordinary).toBe('Please disable your ad blocker');
    expect(result.warning).toBe('');
  });
});
