import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.bartarinha.ir/ ...');
  try {
    await page.goto('https://www.bartarinha.ir/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(4000);
    
    const pageAnalysis = await page.evaluate(() => {
      // Find all banners, widgets, popups, native ads, iframe ads, and image ads
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
      
      const elementsWithAdClasses = Array.from(document.querySelectorAll('[class*="ad"], [class*="banner"], [class*="adv"], [id*="ad"], [id*="banner"], [id*="adv"]'))
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          childrenCount: el.children.length,
          snippet: el.outerHTML.substring(0, 200)
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
      }).filter(item => item.imgSrc && (
        item.imgSrc.includes('banner') || 
        item.imgSrc.includes('gif') || 
        item.imgSrc.includes('upload') || 
        item.imgSrc.includes('adv') || 
        item.href.includes('click') || 
        item.href.includes('go') || 
        item.href.includes('ad') || 
        item.href.includes('redirect') ||
        item.parentClass?.includes('banner') ||
        item.parentClass?.includes('ad') ||
        item.parentClass?.includes('adv')
      ));

      return { iframes, elementsWithAdClassesSample: elementsWithAdClasses.slice(0, 30), adImagesAndLinks };
    });

    console.log('Iframes:', JSON.stringify(pageAnalysis.iframes, null, 2));
    console.log('Ad Elements Sample:', JSON.stringify(pageAnalysis.elementsWithAdClassesSample, null, 2));
    console.log('Ad Links & Images Count:', pageAnalysis.adImagesAndLinks.length);
    console.log('Ad Links & Images Sample:', JSON.stringify(pageAnalysis.adImagesAndLinks.slice(0, 25), null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  await browser.close();
})();
