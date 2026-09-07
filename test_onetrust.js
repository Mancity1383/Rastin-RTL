import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to QuillBot...');
  await page.goto('https://quillbot.com/translate?sl=fa&tl=en&tone=auto&text=%D8%B3%D9%84%D8%A7%D9%85', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Remove OneTrust cookie banner
  await page.evaluate(() => {
    const ot = document.getElementById('onetrust-consent-sdk');
    if (ot) ot.remove();
    const filter = document.querySelector('.onetrust-pc-dark-filter');
    if (filter) filter.remove();
  });
  console.log('Removed OneTrust overlay!');
  
  // Click translate button if present
  const btn = await page.$('#tltr-translate-button, button:has-text("Translate")');
  if (btn) {
    console.log('Clicking Translate button...');
    await btn.click({ force: true });
  }
  
  await page.waitForTimeout(4000);
  
  const result = await page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], textarea, [data-testid="translated-text"]'));
    return textareas.map(t => ({ tag: t.tagName, id: t.id, class: t.className, text: t.innerText || t.value }));
  });
  
  console.log('Textareas after OneTrust removal & Translate click:');
  console.log(JSON.stringify(result, null, 2));
  
  await browser.close();
})();
