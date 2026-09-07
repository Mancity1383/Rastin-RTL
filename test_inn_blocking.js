import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://inn.ir/news ...');
  await page.goto('https://inn.ir/news', { waitUntil: 'networkidle' });
  
  // Apply cosmetic rules
  const hiddenCount = await page.evaluate(() => {
    const rules = [
      ".advertise",
      ".advertise-item",
      "section.advertise",
      "[class*=\"advertise\"]",
      "[id*=\"advertise\"]",
      "img[src*=\"/assets/ads/\"]",
      "a[href*=\"/assets/ads/\"]",
      "a[href*=\"irannewspaper.ir/ads\"]"
    ];
    
    let count = 0;
    rules.forEach(selector => {
      const els = document.querySelectorAll(selector);
      els.forEach(el => {
        el.style.display = 'none !important';
        el.setAttribute('style', 'display: none !important; visibility: hidden !important;');
        count++;
      });
    });
    
    // Check remaining visible ad items
    const remainingAds = document.querySelectorAll('section.advertise, .advertise-item');
    return { hiddenCount: count, remainingCount: remainingAds.length };
  });
  
  console.log('Cosmetic AdBlock Result for inn.ir:', hiddenCount);
  await browser.close();
})();
