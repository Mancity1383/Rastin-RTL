import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.bartarinha.ir/ ...');
  await page.goto('https://www.bartarinha.ir/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  
  const result = await page.evaluate(() => {
    const rules = [
      "[class*=\"type-resource\"]",
      "a[href*=\"24d.ir\"]",
      "a[href*=\"l.24d.ir\"]",
      "img[src*=\"servev2\"]",
      ".advertise",
      ".advertise-item"
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
  
  console.log('Bartarinha AdBlock Result:', result);
  await browser.close();
})();
