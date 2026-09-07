import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://inn.ir/news ...');
  await page.goto('https://inn.ir/news', { waitUntil: 'domcontentloaded' });
  
  // Inject mock chrome storage API to test first-visit logic
  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.storage = window.chrome.storage || {};
    window.chrome.storage.local = {
      get: (keys, cb) => cb({ scanned_domains: [] }),
      set: (data) => console.log('Storage set:', data)
    };
  });

  await page.waitForTimeout(2000);
  
  const toastInfo = await page.evaluate(() => {
    const toast = document.getElementById('rastin-first-visit-toast');
    if (!toast) return { found: false };
    
    return {
      found: true,
      text: toast.innerText,
      visible: toast.offsetWidth > 0 && toast.offsetHeight > 0
    };
  });
  
  console.log('First-visit Scanner Toast Info:', JSON.stringify(toastInfo, null, 2));
  await browser.close();
})();
