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

  test('Highlight storage serializes concurrent clients, merges fields and never resurrects deletions', async ({ context }) => {
    const worker = context.serviceWorkers()[0];
    const client = await context.newPage();
    await client.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
    const result = await client.evaluate(async () => {
      const key = 'rtl_fixer_hl_example.com';
      const send = operation => chrome.runtime.sendMessage({ action: 'mutateHighlights', key, operation });
      await chrome.storage.local.set({ [key]: [] });
      const added = await Promise.all(Array.from({ length: 40 }, (_, i) => send({ type: 'add', item: {
        id: `concurrent-${i}`, text: 'repeat', pageKey: 'example.com/', color: '#fef08a', note: { text: '', minimized: false }
      } })));
      await Promise.all([
        send({ type: 'patch', id: 'concurrent-0', note: { text: 'آخرین یادداشت' } }),
        send({ type: 'patch', id: 'concurrent-0', fields: { color: '#bbf7d0' } }),
        send({ type: 'patch', id: 'concurrent-0', note: { minimized: true } })
      ]);
      const snapshot = (await chrome.storage.local.get(key))[key];
      await send({ type: 'remove', id: 'concurrent-0' });
      await send({ type: 'patch', id: 'concurrent-0', note: { text: 'stale edit' } });
      await send({ type: 'repair', repairs: [['id:concurrent-0', { startOffset: 5 }]] });
      const afterDelete = (await chrome.storage.local.get(key))[key];
      return { successful: added.every(r => r.ok), snapshot, afterDelete };
    });
    expect(result.successful).toBe(true);
    expect(result.snapshot).toHaveLength(40);
    expect(result.snapshot[0]).toMatchObject({ color: '#bbf7d0', note: { text: 'آخرین یادداشت', minimized: true } });
    expect(result.afterDelete).toHaveLength(39);
    expect(result.afterDelete.some(h => h.id === 'concurrent-0')).toBe(false);
  });

  test('Highlight migration preserves distinct legacy records and refuses corrupt storage', async ({ context }) => {
    const worker = context.serviceWorkers()[0];
    const client = await context.newPage();
    await client.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
    const result = await client.evaluate(async () => {
      const key = 'rtl_fixer_hl_example.com';
      const oldKey = 'rtl_fixer_hl_www.example.com';
      await chrome.storage.local.set({ [key]: [], [oldKey]: [
        { text: 'one', timestamp: 1 }, { text: 'two', timestamp: 2 }
      ] });
      const send = operation => chrome.runtime.sendMessage({ action: 'mutateHighlights', key, operation });
      const migrated = await send({ type: 'migrate' });
      const legacyRemoved = !(oldKey in await chrome.storage.local.get(oldKey));
      await chrome.storage.local.set({ [oldKey]: [{ text: 'one', timestamp: 1 }, { text: 'two', timestamp: 2 }] });
      const repeatedMigration = await send({ type: 'migrate' });
      await chrome.storage.local.set({ [key]: { unexpected: 'preserve me' } });
      const failed = await send({ type: 'add', item: { id: 'no' } });
      const preserved = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({ [key]: [] });
      const recovered = await send({ type: 'add', item: { id: 'yes' } });
      return { migrated, repeatedMigration, legacyRemoved, failed, preserved, recovered };
    });
    expect(result.migrated.items).toHaveLength(2);
    expect(result.repeatedMigration.items).toEqual(result.migrated.items);
    expect(result.legacyRemoved).toBe(true);
    expect(result.failed.ok).toBe(false);
    expect(result.preserved).toEqual({ unexpected: 'preserve me' });
    expect(result.recovered.ok).toBe(true);
  });

  test('Highlights from two tabs and the last note input survive immediate reload', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_example.com': { enabled: true, highlightEnabled: true },
      'rtl_fixer_hl_example.com': []
    }));
    await page.unroute('https://example.com/**');
    await context.route('https://example.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<html><body><p id="selected">unique selected passage</p></body></html>'
    }));
    const second = await context.newPage();
    await Promise.all([page.goto('https://example.com/one'), second.goto('https://example.com/two')]);
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
    for (const tab of tabs) {
      await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { action: 'updateSettings', settings: { enabled: true, highlightEnabled: true } }), tab.id);
    }
    const select = async tab => {
      await tab.evaluate(() => {
        const p = document.getElementById('selected');
        const range = document.createRange();
        range.selectNodeContents(p);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        document.getElementById('rastin-bar-add-note').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
    };
    await Promise.all([select(page), select(second)]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_example.com'))['rtl_fixer_hl_example.com'].length)).toBe(2);
    await page.locator('.rastin-note-body').evaluate(el => {
      for (const text of ['first', 'second', 'آخرین متن قبل از refresh']) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => worker.evaluate(async () => {
      const items = (await chrome.storage.local.get('rtl_fixer_hl_example.com'))['rtl_fixer_hl_example.com'];
      return items.find(h => h.pageKey === 'example.com/one')?.note?.text;
    })).toBe('آخرین متن قبل از refresh');
    await expect.poll(() => page.evaluate(() => [...CSS.highlights.values()].reduce((sum, h) => sum + h.size, 0))).toBeGreaterThan(0);
    await second.goto('https://example.com/one');
    await expect.poll(() => second.evaluate(() => [...CSS.highlights.values()].reduce((sum, h) => sum + h.size, 0))).toBeGreaterThan(0);
    const client = await context.newPage();
    await client.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
    await client.evaluate(() => chrome.runtime.sendMessage({ action: 'mutateHighlights', key: 'rtl_fixer_hl_example.com', operation: { type: 'deletePage', pageKey: 'example.com/one' } }));
    for (const tab of [page, second]) {
      await expect.poll(() => tab.evaluate(() => [...CSS.highlights.values()].reduce((sum, h) => sum + h.size, 0))).toBe(0);
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_example.com'))['rtl_fixer_hl_example.com'].length)).toBe(1);
  });

  test('Popup persists legacy IDs and deletes the actual stored highlight', async ({ context }) => {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(host => chrome.storage.local.set({ [`site_config_${host}`]: { enabled: true, highlightEnabled: true },
      'rtl_fixer_hl_www.example.com': [{ text: 'legacy popup record', url: 'https://example.com/', timestamp: 1, color: '#fef08a' }]
    }), new URL(worker.url()).host);
    const popup = await context.newPage();
    popup.on('dialog', dialog => dialog.accept());
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
    await expect(popup.locator('#highlight-toggle')).toBeChecked();
    await popup.locator('#highlight-filter-group [data-value="all"]').evaluate(button => button.click());
    await expect(popup.locator('.highlight-card-text')).toHaveText('legacy popup record');
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_example.com'))['rtl_fixer_hl_example.com']);
    expect(stored[0].id).toMatch(/^hl_legacy_/);
    await popup.locator('.highlight-card-btn').filter({ hasText: 'حذف' }).evaluate(button => button.click());
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_example.com'))['rtl_fixer_hl_example.com'])).toEqual([]);
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

  test('7a. AI Markdown table keeps column order and cell geometry inside an RTL answer', async ({ page, context }) => {
    await sendSettingsToExampleTab(context, { enabled: false });
    await page.evaluate(() => {
      const answer = document.createElement('article');
      answer.id = 'ai-answer';
      answer.append(document.createTextNode('جمع‌بندی نهایی گزینه‌ها'));
      answer.insertAdjacentHTML('beforeend', `
        <div class="table-wrapper" style="overflow:auto">
          <table id="ai-ranking" style="width:900px;table-layout:fixed;border-collapse:collapse">
            <thead><tr>
              <th>رتبه</th><th>مدل</th><th>رایحه</th><th>نظر من</th>
            </tr></thead>
            <tbody><tr>
              <td>🥇</td>
              <td>NIVEA MEN Deep Darkwood</td>
              <td id="styled-ai-cell" style="padding-left:18px;padding-right:7px;border-left:2px solid red">مردانه، چوبی، اسپرت</td>
              <td>بهترین انتخاب کلی</td>
            </tr></tbody>
          </table>
        </div>`);
      answer.querySelectorAll('#ai-ranking th, #ai-ranking td').forEach(cell => {
        cell.style.textAlign = 'start';
      });
      document.body.append(answer);
    });

    const before = await page.locator('#ai-ranking').evaluate(table => {
      const tableLeft = table.getBoundingClientRect().left;
      return {
        direction: getComputedStyle(table).direction,
        headerOffsets: Array.from(table.querySelectorAll('th'))
          .map(cell => Math.round(cell.getBoundingClientRect().left - tableLeft)),
        paddingLeft: getComputedStyle(table.querySelector('#styled-ai-cell')).paddingLeft,
        paddingRight: getComputedStyle(table.querySelector('#styled-ai-cell')).paddingRight,
        borderLeft: getComputedStyle(table.querySelector('#styled-ai-cell')).borderLeftWidth
      };
    });
    expect(before.direction).toBe('ltr');

    await sendSettingsToExampleTab(context, {
      enabled: true,
      fixTables: true,
      alignmentMode: 'auto',
      forceRightAlign: true
    });
    await expect(page.locator('#ai-answer')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#styled-ai-cell')).toHaveAttribute('dir', 'rtl');

    const after = await page.locator('#ai-ranking').evaluate(table => {
      const tableLeft = table.getBoundingClientRect().left;
      return {
        direction: getComputedStyle(table).direction,
        headerOffsets: Array.from(table.querySelectorAll('th'))
          .map(cell => Math.round(cell.getBoundingClientRect().left - tableLeft)),
        paddingLeft: getComputedStyle(table.querySelector('#styled-ai-cell')).paddingLeft,
        paddingRight: getComputedStyle(table.querySelector('#styled-ai-cell')).paddingRight,
        borderLeft: getComputedStyle(table.querySelector('#styled-ai-cell')).borderLeftWidth,
        headerAlignments: Array.from(table.querySelectorAll('th')).map(cell => getComputedStyle(cell).textAlign),
        rowAlignments: Array.from(table.querySelectorAll('tbody td')).map(cell => getComputedStyle(cell).textAlign),
        rowDir: table.querySelector('tr').getAttribute('dir'),
        englishModelDirection: getComputedStyle(table.querySelector('tbody td:nth-child(2)')).direction
      };
    });

    expect(after).toEqual({
      ...before,
      headerAlignments: ['left', 'left', 'left', 'left'],
      // Numeric/English cells remain `start` in their original LTR direction,
      // which resolves to the same physical left edge as the guarded headers.
      rowAlignments: ['start', 'start', 'left', 'left'],
      rowDir: null,
      englishModelDirection: 'ltr'
    });
    const alignmentDeltas = await page.locator('#ai-ranking').evaluate(table => {
      const textOffset = cell => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getBoundingClientRect().left - cell.getBoundingClientRect().left;
      };
      const headers = Array.from(table.querySelectorAll('th'));
      const row = Array.from(table.querySelectorAll('tbody tr:first-child td'));
      return [0, 1, 3].map(index => Math.abs(textOffset(headers[index]) - textOffset(row[index])));
    });
    expect(Math.max(...alignmentDeltas)).toBeLessThan(3);
    await expect(page.locator('#ai-ranking')).toHaveClass(/rtl-fixer-table-layout-guard/);

    await page.locator('#ai-answer').evaluate(answer => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<table id="lazy-ai-table"><tbody><tr><td>ستون اول</td><td>ستون دوم</td></tr></tbody></table>';
      answer.append(wrapper);
    });
    await expect(page.locator('#lazy-ai-table')).toHaveClass(/rtl-fixer-table-layout-guard/);
    await expect(page.locator('#lazy-ai-table')).toHaveCSS('direction', 'ltr');
    await expect(page.locator('#lazy-ai-table td').first()).toHaveCSS('direction', 'rtl');

    await sendSettingsToExampleTab(context, { enabled: false });
    await expect(page.locator('#ai-ranking')).not.toHaveClass(/rtl-fixer-table-layout-guard/);
    await expect(page.locator('#ai-ranking')).not.toHaveAttribute('style', /direction/);
    await expect(page.locator('#styled-ai-cell')).toHaveCSS('padding-left', before.paddingLeft);
  });

  test('Table nested prose retains alignment with forced RTL and justification', async ({ page, context }) => {
    await sendSettingsToExampleTab(context, { enabled: false });
    await page.evaluate(() => {
      document.body.innerHTML = `<style>th,td{text-align:start;padding:12px}table{width:900px;table-layout:fixed}p{margin:0}</style>
        <table><thead><tr><th><p>رتبه</p></th><th><p>مدل</p></th></tr></thead>
        <tbody><tr><td>1</td><td>English model</td></tr>
        <tr><td>2</td><td><p>توضیح فارسی طولانی برای بررسی تراز متن</p></td></tr></tbody></table>`;
    });
    await sendSettingsToExampleTab(context, { enabled: true, fixTables: true, alignmentMode: 'force-rtl', forceRightAlign: true, justifyText: true });
    await expect(page.locator('th p').first()).toHaveAttribute('dir', 'rtl');
    const offsets = await page.locator('table').evaluate(table => {
      const offset = cell => {
        const range = document.createRange();
        range.selectNodeContents(cell.querySelector('p') || cell);
        return range.getBoundingClientRect().left - cell.getBoundingClientRect().left;
      };
      return [0, 1].map(i => Math.abs(offset(table.rows[0].cells[i]) - offset(table.rows[1].cells[i])));
    });
    expect(Math.max(...offsets)).toBeLessThan(3);
    await expect(page.locator('tbody p')).toHaveCSS('text-align', 'left');
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

  test('27. Shadow content created before RTL startup is processed and observed', async ({ page }) => {
    await page.unroute('https://example.com/**');
    await page.route('https://example.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<html><head><meta charset="utf-8"></head><body><reddit-thread></reddit-thread><script>
        const host = document.querySelector('reddit-thread');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<p id="initial-reddit-comment">کامنت فارسی اولیه</p>';
      <\/script></body></html>`
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.locator('reddit-thread').evaluate(host =>
      host.shadowRoot.querySelector('#initial-reddit-comment').dir
    )).toBe('rtl');

    await page.locator('reddit-thread').evaluate(host => {
      const reply = document.createElement('p');
      reply.id = 'late-reddit-reply';
      reply.textContent = 'پاسخ فارسی که بعداً بارگذاری شد';
      host.shadowRoot.append(reply);
    });
    await expect.poll(() => page.locator('reddit-thread').evaluate(host =>
      host.shadowRoot.querySelector('#late-reddit-reply').dir
    )).toBe('rtl');
  });

  test('28. Patched error listeners can still be removed and deduplicated', async ({ page }) => {
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

  test('29. YouTube helpers find and click controls inside nested shadow roots', async ({ page }) => {
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

  test('F5 restores a repeated passage below an ID-bearing ancestor after delayed chat hydration', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => chrome.storage.local.set({
      'site_config_gemini.google.com': { enabled: true, highlightEnabled: true }
    }));
    const markup = '<chat-app-orchestrator id="app-root"><div id="chat-history"><message-content><div><p>repeat identical passage with plenty of surrounding text</p><p>repeat identical passage with plenty of surrounding text</p></div></message-content></div></chat-app-orchestrator>';
    await page.route('https://gemini.google.com/**', route => route.fulfill({
      contentType: 'text/html', body: `<html><body>${markup}</body></html>`
    }));
    await page.goto('https://gemini.google.com/app/test-conversation');
    await expect.poll(() => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
      return chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSettings', settings: { enabled: true, highlightEnabled: true } }).then(() => true, () => false);
    })).toBe(true);
    await page.evaluate(() => {
      const p = document.querySelectorAll('message-content p')[1];
      const range = document.createRange();
      range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 6);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.querySelector('.rastin-color-btn.yellow').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    const readSaved = () => worker.evaluate(async () => (await chrome.storage.local.get('rtl_fixer_hl_gemini.google.com'))['rtl_fixer_hl_gemini.google.com']);
    await expect.poll(async () => (await readSaved())?.length).toBe(1);
    const saved = (await readSaved())[0];
    expect(saved.startPath).toMatch(/^\/\/\*\[@id="chat-history"\]/);
    expect(saved.textAnchor.rootPath).toMatch(/^\/\/\*\[@id="chat-history"\]/);
    // A full navigation starts with an empty app shell, then hydrates the chat.
    await page.unroute('https://gemini.google.com/**');
    await page.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><user-query><p>repeat identical passage with plenty of surrounding text</p></user-query><main></main></body></html>' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1700);
    expect(await page.evaluate(() => [...(CSS.highlights.get('rastin-color-yellow') || [])].length)).toBe(0);
    expect((await readSaved())[0].startPath).toBe(saved.startPath);
    await page.evaluate(html => { document.querySelector('main').innerHTML = html; }, markup);
    await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get('rastin-color-yellow') || [])].map(r => ({
      text: r.toString(), correctParagraph: r.startContainer.parentElement === document.querySelectorAll('message-content p')[1]
    })))).toEqual([{ text: 'repeat', correctParagraph: true }]);
    expect(await readSaved()).toHaveLength(1);
    // Records created by the previous version used /*[@id=...] descendants.
    // They must recover without asking the user to delete/recreate highlights.
    await worker.evaluate(async () => {
      const key = 'rtl_fixer_hl_gemini.google.com';
      const items = (await chrome.storage.local.get(key))[key];
      for (const h of items) {
        h.startPath = h.startPath.replace(/^\/\//, '/');
        h.endPath = h.endPath.replace(/^\/\//, '/');
        h.textAnchor.rootPath = h.textAnchor.rootPath.replace(/^\/\//, '/');
        delete h.textAnchor.contentScope;
      }
      await chrome.storage.local.set({ [key]: items });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1700);
    expect(await page.evaluate(() => [...(CSS.highlights.get('rastin-color-yellow') || [])].length)).toBe(0);
    await page.evaluate(html => { document.querySelector('main').innerHTML = html; }, markup);
    await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get('rastin-color-yellow') || [])].map(r => ({
      text: r.toString(), correctParagraph: r.startContainer.parentElement === document.querySelectorAll('message-content p')[1]
    })))).toEqual([{ text: 'repeat', correctParagraph: true }]);
  });

  test('32. Repeated text restores the selected occurrence instead of the first match', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'rtl_fixer_hl_example.com': [] }));
    await sendSettingsToExampleTab(context, { enabled: true, highlightEnabled: true });

    await page.unroute('https://example.com/**');
    await page.route('https://example.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p id="repeated">repeat alpha repeat omega</p></body></html>'
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      const textNode = document.getElementById('repeated').firstChild;
      const secondOccurrence = textNode.nodeValue.lastIndexOf('repeat');
      const range = document.createRange();
      range.setStart(textNode, secondOccurrence);
      range.setEnd(textNode, secondOccurrence + 'repeat'.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById('repeated').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.querySelector('.rastin-color-btn.yellow').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
      );
    });

    await expect.poll(async () => worker.evaluate(async () => {
      const result = await chrome.storage.local.get('rtl_fixer_hl_example.com');
      return result['rtl_fixer_hl_example.com']?.[0]?.textAnchor?.version;
    })).toBe(2);

    // Simulate a DOM/XPath change so restoration must use the quote/position anchor.
    await worker.evaluate(async () => {
      const key = 'rtl_fixer_hl_example.com';
      const result = await chrome.storage.local.get(key);
      const highlights = result[key] || [];
      highlights[0].startPath = '//*[@id="missing-after-refresh"]';
      highlights[0].endPath = '//*[@id="missing-after-refresh"]';
      await chrome.storage.local.set({ [key]: highlights });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() => {
      const registry = CSS.highlights?.get('rastin-color-yellow');
      const ranges = registry ? Array.from(registry) : [];
      return ranges.map(range => ({
        text: range.toString(),
        startOffset: range.startOffset,
        parentId: range.startContainer.parentElement?.id || ''
      }));
    })).toEqual([{ text: 'repeat', startOffset: 13, parentId: 'repeated' }]);

    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
    const tabId = tabs[tabs.length - 1].id;
    await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const nativeGetClientRects = Range.prototype.getClientRects;
        window.__rastinRangeRectReads = 0;
        Range.prototype.getClientRects = function (...args) {
          window.__rastinRangeRectReads++;
          return nativeGetClientRects.apply(this, args);
        };
      }
    }), tabId);

    // Moving over ordinary page content must not measure every saved range.
    await page.mouse.move(1, 1);
    await page.waitForTimeout(100);
    const rangeRectReads = await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => window.__rastinRangeRectReads
    }).then(results => results[0]?.result), tabId);
    // caretRangeFromPoint may snap to the nearest text node, so at most that
    // node's one indexed highlight is measured (never the global list).
    expect(rangeRectReads).toBeLessThanOrEqual(1);

    const highlightPoint = await page.evaluate(() => {
      const textNode = document.getElementById('repeated').firstChild;
      const start = textNode.nodeValue.lastIndexOf('repeat');
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 'repeat'.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(highlightPoint.x, highlightPoint.y);
    await expect(page.locator('#rastin-bar-delete')).toBeVisible();
    await page.locator('#rastin-bar-delete').dispatchEvent('pointerdown');
    await expect.poll(async () => worker.evaluate(async () => {
      const result = await chrome.storage.local.get('rtl_fixer_hl_example.com');
      return result['rtl_fixer_hl_example.com'] || [];
    })).toHaveLength(0);
  });

  test('Highlight rejects a shifted XPath pointing at another copy of the word', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'rtl_fixer_hl_example.com': [{
      id: 'shifted', pageKey: 'example.com/', url: 'https://example.com/', text: 'repeat', color: '#fef08a',
      startPath: '//*[@id="wrong"]', endPath: '//*[@id="wrong"]', startNodeIndex: 0, endNodeIndex: 0,
      startOffset: 6, endOffset: 12,
      textAnchor: { version: 2, rootPath: '//*[@id="wrong"]', start: 5, end: 11, occurrence: 0,
        prefix: 'bravo', suffix: 'correctcontext' }
    }] }));
    await sendSettingsToExampleTab(context, { enabled: true, highlightEnabled: true });
    await page.unroute('https://example.com/**');
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<p id="wrong">alpha repeat other context</p><p id="correct">bravo repeat correct context</p>' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Array.from(CSS.highlights.get('rastin-color-yellow') || [])
      .map(range => range.startContainer.parentElement.id))).toEqual(['correct']);
    // A lazy page may initially contain only other copies. Keep the record
    // pending instead of rewriting its anchor to an unrelated occurrence.
    await page.unroute('https://example.com/**');
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<p id="wrong">alpha repeat other context</p><p>delta repeat unrelated words</p>' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => Array.from(CSS.highlights.get('rastin-color-yellow') || []).length)).toBe(0);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="correct">bravo repeat correct context</p>'));
    await expect.poll(() => page.evaluate(() => Array.from(CSS.highlights.get('rastin-color-yellow') || [])
      .map(range => range.startContainer.parentElement.id))).toEqual(['correct']);
  });

  test('33. Legacy repeated text uses its saved local offset and is upgraded', async ({ page, context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      'rtl_fixer_hl_example.com': [{
        id: 'legacy-repeat',
        url: 'https://example.com/',
        pageKey: 'example.com/',
        path: '/',
        title: 'Legacy repeated text',
        text: 'repeat',
        color: '#fef08a',
        timestamp: Date.now(),
        startPath: '//*[@id="legacy-repeated"]',
        startNodeIndex: 0,
        startOffset: 13,
        endPath: '//*[@id="legacy-repeated"]',
        endNodeIndex: 0,
        endOffset: 19
      }]
    }));
    await sendSettingsToExampleTab(context, { enabled: true, highlightEnabled: true });

    await page.unroute('https://example.com/**');
    await page.route('https://example.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p id="legacy-repeated"><span>repeat</span> alpha <span>repeat</span> omega</p></body></html>'
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() => {
      const registry = CSS.highlights?.get('rastin-color-yellow');
      const range = registry ? Array.from(registry)[0] : null;
      const span = range?.startContainer?.parentElement;
      return range ? {
        text: range.toString(),
        spanIndex: span ? Array.from(document.querySelectorAll('#legacy-repeated span')).indexOf(span) : -1
      } : null;
    })).toEqual({ text: 'repeat', spanIndex: 1 });

    await expect.poll(async () => worker.evaluate(async () => {
      const result = await chrome.storage.local.get('rtl_fixer_hl_example.com');
      return result['rtl_fixer_hl_example.com']?.[0]?.textAnchor?.version;
    })).toBe(2);
  });

  test('34. Lazy chat batches yield between RTL scans and skip unrelated cleanup', async ({ page, context }) => {
    await sendSettingsToExampleTab(context, {
      enabled: true,
      highlightEnabled: false,
      alignmentMode: 'auto'
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://example.com/*' }));
    const tabId = tabs[tabs.length - 1].id;

    await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const originalScan = window.RtlFixer.scanAndProcess;
        const originalPrune = window.RtlFixer.pruneDisconnectedState;
        const originalRestore = window.RtlFixer.requestRestore;
        window.__rtlPerfMetrics = { scans: 0, prunes: 0, restores: 0 };
        window.RtlFixer.scanAndProcess = function (...args) {
          const deadline = performance.now() + 2;
          while (performance.now() < deadline) { /* deterministic synthetic scan cost */ }
          window.__rtlPerfMetrics.scans++;
          return originalScan.apply(this, args);
        };
        window.RtlFixer.pruneDisconnectedState = function (...args) {
          window.__rtlPerfMetrics.prunes++;
          return originalPrune.apply(this, args);
        };
        window.RtlFixer.requestRestore = function (...args) {
          window.__rtlPerfMetrics.restores++;
          return originalRestore.apply(this, args);
        };
      }
    }), tabId);

    const result = await page.evaluate(async () => {
      let lastTick = performance.now();
      let maxTimerDelay = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        maxTimerDelay = Math.max(maxTimerDelay, now - lastTick);
        lastTick = now;
      }, 5);

      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 80; i++) {
        const message = document.createElement('p');
        message.className = 'lazy-chat-message';
        message.textContent = `پیام فارسی شماره ${i} که هنگام اسکرول بارگذاری شده است`;
        fragment.appendChild(message);
      }
      document.body.appendChild(fragment);

      const timeoutAt = performance.now() + 5000;
      while (performance.now() < timeoutAt) {
        const ready = document.querySelectorAll('.lazy-chat-message.rtl-fixer-rtl-detected').length;
        if (ready === 80) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      clearInterval(timer);
      return {
        processed: document.querySelectorAll('.lazy-chat-message.rtl-fixer-rtl-detected').length,
        maxTimerDelay
      };
    });

    const metrics = await worker.evaluate(tabId => chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => window.__rtlPerfMetrics
    }).then(results => results[0]?.result), tabId);

    expect(result.processed).toBe(80);
    expect(result.maxTimerDelay).toBeLessThan(80);
    expect(metrics.scans).toBeGreaterThanOrEqual(80);
    expect(metrics.prunes).toBe(0);
    expect(metrics.restores).toBe(0);
  });

  test('35. Anti-adblock text shield is scoped away from ordinary framework nodes', async ({ page }) => {
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
