import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://inn.ir/news...');
  await page.goto('https://inn.ir/news', { waitUntil: 'networkidle' });
  
  const banners = await page.evaluate(() => {
    const results = [];
    const elements = Array.from(document.querySelectorAll('a, div, section, aside, figure'));
    
    elements.forEach(el => {
      const img = el.querySelector('img');
      const href = el.href || el.querySelector('a')?.href || '';
      const text = el.innerText || '';
      const className = el.className || '';
      const id = el.id || '';
      
      if (img && (img.src.includes('banner') || img.src.includes('upload') || img.src.includes('gif') || href.includes('go') || href.includes('ad') || className.includes('banner') || className.includes('adv') || className.includes('sidebar'))) {
        results.push({
          tag: el.tagName,
          id,
          className,
          href,
          imgSrc: img.src,
          imgAlt: img.alt,
          parentClassName: el.parentElement?.className,
          parentTag: el.parentElement?.tagName
        });
      }
    });
    
    return results;
  });
  
  console.log('Detected ad candidates:', JSON.stringify(banners.slice(0, 30), null, 2));
  await browser.close();
})();
