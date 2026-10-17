/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks */
import { test as base, expect } from '@playwright/test';
import { launchRtlContext, openRtlFixture, sendRtlSettings, rtlSettings } from '../tools/rtl-benchmark.mjs';

const test = base.extend({
  context: async ({ browserName: _ }, use) => {
    const context = await launchRtlContext();
    try { await use(context); } finally { await context.close(); }
  }
});

async function columnEdges(table) {
  return table.evaluate(table => {
    const measure = cell => {
      const range = document.createRange(); range.selectNodeContents(cell.querySelector('p') || cell);
      const rect = range.getBoundingClientRect(), box = cell.getBoundingClientRect();
      const align = getComputedStyle(cell).textAlign;
      return align === 'right' ? box.right - rect.right : align === 'center'
        ? (rect.left + rect.right - box.left - box.right) / 2 : rect.left - box.left;
    };
    const head = [...table.tHead.rows[0].cells];
    const data = [...table.tBodies[0].rows[0].cells];
    return head.map((cell, index) => Math.abs(measure(cell) - measure(data[index])));
  });
}

test('Persian headings align with English names, counts, statuses and result values in their actual columns', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-column-edges');
  await page.evaluate(() => {
    document.head.insertAdjacentHTML('beforeend', `<style>
      html,body{background:#090909;color:#eee;font-family:Arial}main{width:900px}
      table{table-layout:fixed;width:100%;border-collapse:collapse;margin:12px 0 28px}
      th,td{padding:12px 10px;border-bottom:1px solid #292929}th{text-align:right}td{text-align:start;vertical-align:middle}
      a{color:inherit;text-decoration:underline}h2{text-align:right}
    </style>`);
    document.getElementById('chat').innerHTML = `<section id="tables-fixture">
      <h2>داده‌ها</h2><table id="datasets"><colgroup><col style="width:24%"><col style="width:23%"><col style="width:18%"><col style="width:16%"><col style="width:19%"></colgroup>
      <thead><tr><th dir="rtl">دیتاست</th><th dir="rtl">تصاویر</th><th dir="rtl">نوع ماسک</th><th dir="rtl">وضعیت</th><th dir="rtl">لینک</th></tr></thead>
      <tbody>
      <tr><td dir="auto">Wseg / WSNet</td><td dir="auto">۲٬۶۸۶</td><td dir="auto">Binary</td><td dir="auto">✅ عمومی</td><td dir="auto"><a href="#">Hugging Face ↗</a></td></tr>
      <tr><td dir="auto">FUSeg 2021</td><td dir="auto">۱٬۰۱۰ برچسب‌دار</td><td dir="auto">Binary</td><td dir="auto">✅ عمومی</td><td dir="auto"><a href="#">GitHub ↗</a></td></tr>
      <tr><td dir="auto">LUTSeg</td><td dir="auto">۱۴۱</td><td dir="auto">Binary + Tissue</td><td dir="auto">✅ عمومی</td><td dir="auto"><a href="#">Hugging Face ↗</a></td></tr>
      <tr><td dir="auto">Lower Limb and Feet Wound</td><td dir="auto">۲٬۶۸۶ جفت تصویر و ماسک</td><td dir="auto">Binary</td><td dir="auto">✅ ZIP موجود</td><td dir="auto"><a href="#">Mendeley ↗</a></td></tr>
      <tr><td dir="auto">BG-SegNet Wound Data</td><td dir="auto">تعداد مستقل نامشخص</td><td dir="auto">YOLO Segmentation</td><td dir="auto">✅ ZIP موجود</td><td dir="auto"><a href="#">Zenodo ↗</a></td></tr>
      <tr><td dir="auto">CO2Wounds-V2</td><td dir="auto">۶۰۷ برچسب‌دار + ۱۵۷ بدون برچسب</td><td dir="auto">Binary / COCO</td><td dir="auto">⚠ مسیر دانلود رسمی</td><td dir="auto"><a href="#">GitHub / IEEE DataPort ↗</a></td></tr>
      </tbody></table>
      <h2>نتایج مهم</h2><table id="metrics"><colgroup><col style="width:72%"><col style="width:28%"></colgroup>
      <thead><tr><th dir="rtl">معیار</th><th dir="rtl">نتیجه</th></tr></thead><tbody>
      <tr><td dir="auto">بهترین mIoU روی LUTSeg</td><td dir="auto">31.70%</td></tr>
      <tr><td dir="auto">Dice همان تنظیم</td><td dir="auto">39.25%</td></tr>
      <tr><td dir="auto">بهبود نسبت به UniMatch-V2</td><td dir="auto">+4.10 mIoU</td></tr></tbody></table></section>`;
    window.__tableTextNodes = [];
    const walk = document.createTreeWalker(document.getElementById('tables-fixture'), NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) window.__tableTextNodes.push([walk.currentNode, walk.currentNode.data]);
  });
  const beforeOrder = await page.locator('#datasets').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left));
  expect(Math.max(...await columnEdges(page.locator('#datasets')))).toBeGreaterThan(10);
  await page.locator('#tables-fixture').screenshot({ path: 'logs/rtl-table-layout/before.png' });
  await sendRtlSettings(worker, tabId, { ...rtlSettings, forceRightAlign: true, justifyText: true });
  await expect(page.locator('#datasets .rtl-fixer-table-cell-aligned')).toHaveCount(35);
  await expect(page.locator('#metrics .rtl-fixer-table-cell-aligned')).toHaveCount(8);
  expect(Math.max(...await columnEdges(page.locator('#datasets')))).toBeLessThan(2);
  expect(Math.max(...await columnEdges(page.locator('#metrics')))).toBeLessThan(2);
  expect(await page.locator('#datasets').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left))).toEqual(beforeOrder);
  await expect(page.locator('#metrics tbody td').nth(1)).toHaveCSS('direction', 'ltr');
  await expect(page.locator('#metrics tbody td').nth(1)).toHaveCSS('white-space', 'nowrap');
  await expect(page.locator('#datasets tbody td').first()).toHaveCSS('direction', 'ltr');
  expect(await page.evaluate(() => window.__tableTextNodes.every(([node, text]) => node.isConnected && node.data === text))).toBe(true);
  await page.locator('#tables-fixture').screenshot({ path: 'logs/rtl-table-layout/after.png' });
});

test('the real colspan/rowspan grid carries explicit header alignment to each body cell and updates live', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-spans');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `<table id="spans" style="width:700px;table-layout:fixed;direction:ltr">
      <thead><tr><th rowspan="2" align="left">گروه</th><th colspan="2" align="center">اندازه‌ها</th></tr>
      <tr><th id="count-header" align="right">تعداد</th><th align="center">امتیاز</th></tr></thead>
      <tbody><tr><td id="rowspan" rowspan="0">Wound Data</td><td id="count-1">141</td><td id="score-1">31.70%</td></tr>
      <tr><td id="count-2">2,686</td><td id="score-2">39.25%</td></tr></tbody>
      <tbody><tr><td>Second group</td><td id="count-3">10</td><td id="score-3">+4.10</td></tr></tbody></table>`;
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  for (const id of ['count-1', 'count-2', 'count-3']) await expect(page.locator('#' + id)).toHaveCSS('text-align', 'right');
  for (const id of ['score-1', 'score-2', 'score-3']) await expect(page.locator('#' + id)).toHaveCSS('text-align', 'center');
  await expect(page.locator('#rowspan')).toHaveAttribute('rowspan', '0');
  await page.locator('#count-header').evaluate(cell => cell.setAttribute('align', 'center'));
  for (const id of ['count-1', 'count-2', 'count-3']) await expect(page.locator('#' + id)).toHaveCSS('text-align', 'center');
  await page.locator('#rowspan').evaluate(cell => cell.setAttribute('rowspan', '1'));
  await expect(page.locator('#count-2')).toHaveCSS('text-align', 'left');
  await expect(page.locator('#score-2')).toHaveCSS('text-align', 'center');
  await expect(page.locator('#spans')).toHaveCSS('direction', 'ltr');
});

test('lazy rows use their column policy and plain cell streaming never rescans the whole table', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-stream');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = '<table id="stream-table"><thead><tr><th align="right">شرح</th><th align="center">درصد</th></tr></thead><tbody>' +
      Array.from({ length: 100 }, (_, i) => `<tr><td><p id="description-${i}">توضیح فارسی پیام ${i}</p></td><td>${i}.50%</td></tr>`).join('') + '</tbody></table>';
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#stream-table td.rtl-fixer-table-cell-aligned')).toHaveCount(200);
  // Cell layout is applied before the cooperative prose scan finishes. Wait
  // for that initial scan, so its final row is not counted as streaming work.
  await page.waitForFunction(() => document.getElementById('description-99').dir === 'rtl' &&
    document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      const fixer = window.RtlFixer, read = fixer.getContainedDirectionalText;
      const untouched = document.getElementById('description-99').parentElement;
      window.__unrelatedTableReads = 0;
      fixer.getContainedDirectionalText = function (node, ...args) {
        if (node === untouched) window.__unrelatedTableReads++;
        return read.call(this, node, ...args);
      };
    }
  }), tabId);
  await page.evaluate(() => new Promise(resolve => {
    const text = document.getElementById('description-0').firstChild;
    let frame = 0;
    const update = () => {
      text.data = frame % 2 ? 'English response is being updated' : 'UART توضیح فارسی در حال تکمیل';
      if (++frame < 12) requestAnimationFrame(update); else resolve();
    };
    requestAnimationFrame(update);
  }));
  expect(await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => window.__unrelatedTableReads })
    .then(results => results[0].result), tabId)).toBe(0);
  await page.locator('#stream-table tbody').evaluate(body => {
    body.insertAdjacentHTML('beforeend', '<tr id="new-row"><td>توضیح تازه</td><td>+12.70%</td></tr>');
  });
  await expect(page.locator('#new-row td').first()).toHaveCSS('text-align', 'right');
  await expect(page.locator('#new-row td').last()).toHaveCSS('text-align', 'center');
  await expect(page.locator('#new-row td').last()).toHaveCSS('direction', 'ltr');
  await page.locator('#new-row td').last().evaluate(cell => { cell.firstChild.data = '2026 results with multiple words'; });
  await expect(page.locator('#new-row td').last()).not.toHaveClass(/rtl-fixer-table-number/);
  await expect(page.locator('#new-row td').last()).toHaveCSS('white-space', 'normal');
  await page.locator('#new-row td').last().evaluate(cell => { cell.firstChild.data = 'یک توضیح فارسی تازه'; });
  await expect(page.locator('#new-row td').last()).not.toHaveClass(/rtl-fixer-table-number/);
  await expect(page.locator('#new-row td').last()).toHaveCSS('text-align', 'center');
});

test('disabling restores table formatting and preserves later site style changes and edited text', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-restore');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `<table id="restore-table"><thead><tr><th align="center">معیار</th><th align="right">مقدار</th></tr></thead>
      <tbody><tr><td id="label" style="padding-left:18px;border-left:2px solid red">شرح فارسی</td><td id="value" style="text-align:left !important">31.70%</td></tr></tbody></table>`;
    window.__tableBefore = [...document.querySelectorAll('#restore-table th,#restore-table td')].map(cell => ({
      css: cell.style.cssText, dir: cell.getAttribute('dir'), text: cell.textContent
    }));
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#value')).toHaveCSS('text-align', 'right');
  await page.locator('#label').evaluate(cell => { cell.style.backgroundColor = 'rgb(1, 2, 3)'; });
  await page.locator('#value').evaluate(cell => {
    cell.style.setProperty('text-align', 'center', 'important'); cell.firstChild.data = '32.50%';
  });
  // Let the text update reassert the active column policy, preserving the
  // site's newest style as the value to restore when the extension is off.
  await expect(page.locator('#value')).toHaveCSS('text-align', 'right');
  await sendRtlSettings(worker, tabId, { enabled: false });
  await expect(page.locator('#restore-table .rtl-fixer-table-cell-aligned')).toHaveCount(0);
  await expect(page.locator('#restore-table .rtl-fixer-table-number')).toHaveCount(0);
  await expect(page.locator('#value')).toHaveCSS('text-align', 'center');
  await expect(page.locator('#value')).toHaveText('32.50%');
  await expect(page.locator('#label')).toHaveCSS('padding-left', '18px');
  await expect(page.locator('#label')).toHaveCSS('border-left-width', '2px');
  await expect(page.locator('#label')).toHaveCSS('background-color', 'rgb(1, 2, 3)');
  expect(await page.locator('#restore-table th').evaluateAll(cells => cells.map(cell => cell.style.cssText))).toEqual(['', '']);
});

test('RTL tables preserve column order, and nested, English and editable tables remain independent', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-boundaries');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `<table id="rtl-table" dir="rtl" style="width:600px;table-layout:fixed"><thead><tr><th align="right">شرح</th><th align="center">عدد</th></tr></thead>
      <tbody><tr><td>متن فارسی</td><td>31.70%</td></tr><tr><td colspan="2"><table id="nested"><thead><tr><th align="left">نوع</th><th align="right">مقدار</th></tr></thead><tbody><tr><td>شرح داخلی</td><td>12</td></tr></tbody></table></td></tr></tbody></table>
      <table id="english"><tr><th>Name</th><th>Value</th></tr><tr><td>Model</td><td>31.70%</td></tr></table>
      <div contenteditable="true"><table id="editable"><tr><th>عنوان فارسی</th></tr><tr><td>شرح قابل ویرایش</td></tr></table></div>`;
  });
  const before = await page.locator('#rtl-table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left));
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#rtl-table > thead th').first()).toHaveCSS('text-align', 'right');
  await expect(page.locator('#rtl-table > tbody > tr').first().locator('td').last()).toHaveCSS('text-align', 'center');
  await expect(page.locator('#nested th').first()).toHaveCSS('text-align', 'left');
  await expect(page.locator('#nested td').last()).toHaveCSS('text-align', 'right');
  expect(await page.locator('#rtl-table').evaluate(table => [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().left))).toEqual(before);
  await expect(page.locator('#english .rtl-fixer-table-cell-aligned')).toHaveCount(0);
  await expect(page.locator('#editable .rtl-fixer-table-cell-aligned')).toHaveCount(0);
});

test('column policies survive moving rows and toggling table fixes without repeated DOM writes', async ({ context }) => {
  const { page, worker, tabId } = await openRtlFixture(context, 'table-lifecycle');
  await page.evaluate(() => {
    document.getElementById('chat').innerHTML = `<table id="source"><thead><tr><th align="right" style="text-align:left">شرح</th><th align="right">عدد</th></tr></thead>
      <tbody><tr id="moving"><td>شرح فارسی</td><td id="moving-number">31.70%</td></tr></tbody></table>
      <table id="destination"><thead><tr><th align="center">شرح</th><th align="left">عدد</th></tr></thead>
      <tbody><tr><td>شرح دیگر</td><td>12</td></tr></tbody></table>`;
  });
  await sendRtlSettings(worker, tabId, rtlSettings);
  await expect(page.locator('#moving td').first()).toHaveCSS('text-align', 'left');
  await expect(page.locator('#moving-number')).toHaveCSS('text-align', 'right');
  await page.locator('#destination tbody').evaluate(body => body.append(document.getElementById('moving')));
  await expect(page.locator('#moving td').first()).toHaveCSS('text-align', 'center');
  await expect(page.locator('#moving-number')).toHaveCSS('text-align', 'left');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-rtl-benchmark-open-scans') === '0');
  await page.evaluate(() => {
    window.__tableWrites = [];
    window.__tableWriteObserver = new MutationObserver(records => window.__tableWrites.push(...records));
    window.__tableWriteObserver.observe(document.getElementById('destination'), {
      subtree: true, attributes: true, attributeFilter: ['class', 'style', 'dir']
    });
  });
  await worker.evaluate(tabId => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => window.RtlFixer.scanAndProcess(document.getElementById('destination'))
  }), tabId);
  expect(await page.evaluate(() => {
    const records = [...window.__tableWrites, ...window.__tableWriteObserver.takeRecords()];
    window.__tableWriteObserver.disconnect();
    return records.map(record => record.attributeName);
  })).toEqual([]);
  await sendRtlSettings(worker, tabId, { fixTables: false });
  await expect(page.locator('.rtl-fixer-table-cell-aligned')).toHaveCount(0);
  await expect(page.locator('.rtl-fixer-table-number')).toHaveCount(0);
  await expect(page.locator('#moving-number')).not.toHaveAttribute('style', /.+/);
  await sendRtlSettings(worker, tabId, { fixTables: true });
  await expect(page.locator('#moving td').first()).toHaveCSS('text-align', 'center');
  await expect(page.locator('#moving-number')).toHaveCSS('text-align', 'left');
  await expect(page.locator('#moving-number')).toHaveCSS('direction', 'ltr');
  // A pure removal must flush the dirty grid even when no replacement row or
  // text mutation follows it. The removed header no longer dictates centering.
  await page.locator('#destination thead').evaluate(head => head.remove());
  await expect(page.locator('#moving td').first()).toHaveCSS('text-align', 'left');
});
