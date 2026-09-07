import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.shahrekhabar.com/news/17854722003497 ...');
  try {
    await page.goto('https://www.shahrekhabar.com/news/17854722003497', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(4000);
    
    const pageAnalysis = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
      
      const elementsWithAdClasses = Array.from(document.querySelectorAll('[class*="ad"], [class*="banner"], [class*="adv"], [id*="ad"], [id*="banner"], [id*="adv"], [class*="pos-"], [id*="pos-"]'))
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          snippet: el.outerHTML.substring(0, 250)
        }));

      const adImagesAndLinks = Array.from(document.querySelectorAll('a')).map(a => {
        const img = a.querySelector('img');
        return {
          href: a.href,
          aClass: a.className,
          parentClass: a.parentElement?.className,
          parentTag: a.parentElement?.tagName,
          imgSrc: img?.src,
          imgAlt: img?.alt
        };
      }).filter(item => item.imgSrc || item.href.includes('click') || item.href.includes('go') || item.href.includes('redirect') || item.parentClass?.includes('banner') || item.parentClass?.includes('ad') || item.parentClass?.includes('adv'));

      return { iframes, elementsWithAdClassesSample: elementsWithAdClasses.slice(0, 35), adImagesAndLinks };
    });

    console.log('Iframes:', JSON.stringify(pageAnalysis.iframes, null, 2));
    console.log('Ad Elements Sample:', JSON.stringify(pageAnalysis.elementsWithAdClassesSample, null, 2));
    console.log('Ad Links & Images Count:', pageAnalysis.adImagesAndLinks.length);
    console.log('Ad Links & Images Sample:', JSON.stringify(pageAnalysis.adImagesAndLinks.slice(0, 30), null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  await browser.close();
})();
