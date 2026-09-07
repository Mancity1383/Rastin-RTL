import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.taghvim.com/ ...');
  await page.goto('https://www.taghvim.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  const result = await page.evaluate(() => {
    const rules = [
      ".close-extras",
      "[class*=\"close-extras\"]",
      "img[src*=\"/media/extra/\"]",
      "a[href*=\"/media/extra/\"]"
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
  
  console.log('Taghvim.com AdBlock Result:', result);
  await browser.close();
})();
