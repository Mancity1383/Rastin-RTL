import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://inn.ir/news', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  const banners = await page.evaluate(() => {
    // Find all links containing image banners or advertisement containers
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.href,
      className: a.className,
      id: a.id,
      parentClass: a.parentElement?.className,
      parentTag: a.parentElement?.tagName,
      imgSrc: a.querySelector('img')?.src,
      imgAlt: a.querySelector('img')?.alt
    })).filter(item => item.imgSrc || item.href.includes('/go/') || item.href.includes('banner') || item.href.includes('adv') || item.className.includes('banner') || item.parentClass?.includes('banner') || item.parentClass?.includes('adv'));
    
    return links;
  });
  
  console.log('Banners Found:', JSON.stringify(banners, null, 2));
  await browser.close();
})();
