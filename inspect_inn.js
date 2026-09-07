import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://inn.ir/news ...');
  try {
    await page.goto('https://inn.ir/news', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const adElements = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt,
        parentTag: img.parentElement?.tagName,
        parentClass: img.parentElement?.className,
        grandParentClass: img.parentElement?.parentElement?.className,
        linkHref: img.closest('a')?.href
      }));
      
      const bannerContainers = Array.from(document.querySelectorAll('[class*="banner"], [class*="ad"], [id*="banner"], [id*="ad"], .sidebar, .ads')).map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        htmlSnippet: el.outerHTML.substring(0, 300)
      }));
      
      return { imgs, bannerContainers };
    });
    
    console.log('Images count:', adElements.imgs.length);
    console.log('Images sample:', JSON.stringify(adElements.imgs.slice(0, 20), null, 2));
    console.log('Banner containers count:', adElements.bannerContainers.length);
    console.log('Banner containers sample:', JSON.stringify(adElements.bannerContainers.slice(0, 10), null, 2));
  } catch(e) {
    console.error('Error:', e);
  }
  await browser.close();
})();
