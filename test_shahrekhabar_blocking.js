import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.shahrekhabar.com/news/17854722003497 ...');
  await page.goto('https://www.shahrekhabar.com/news/17854722003497', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  const result = await page.evaluate(() => {
    const rules = [
      "a[href*=\"/advertising\"]",
      "img[src*=\"static.shahrekhabar.com/banner/\"]",
      "img[src*=\"/banner/\"]",
      "[class*=\"type-resource\"]",
      "a[href*=\"24d.ir\"]"
    ];
    
    let hiddenCount = 0;
    rules.forEach(selector => {
      const els = document.querySelectorAll(selector);
      els.forEach(el => {
        el.style.display = 'none !important';
        hiddenCount++;
      });
    });
    
    return { hiddenCount };
  });
  
  console.log('ShahreKhabar AdBlock Result:', result);
  await browser.close();
})();
