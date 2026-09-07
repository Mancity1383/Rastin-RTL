import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://quillbot.com/translate?sl=fa&tl=en&tone=auto&text=%D8%B3%D9%84%D8%A7%D9%85', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const btn = await page.$('button:has-text("Translate"), #tltr-translate-button');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(3000);
  }
  
  const html = await page.content();
  console.log('HTML Length:', html.length);
  
  const results = await page.evaluate(() => {
    // Find all visible text elements on right side or output area
    const els = Array.from(document.querySelectorAll('*'));
    const leafNodes = els.filter(e => e.children.length === 0 && e.innerText && e.innerText.trim().length > 0);
    return leafNodes.map(e => e.innerText.trim());
  });
  
  console.log('Leaf texts count:', results.length);
  console.log('Leaf texts sample:', results.slice(0, 50));
  
  await browser.close();
})();
