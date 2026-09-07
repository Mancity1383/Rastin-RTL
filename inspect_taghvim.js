import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://www.taghvim.com/ ...');
  try {
    await page.goto('https://www.taghvim.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const adData = await page.evaluate(() => {
      // Find all elements containing "close ads" or "بستن تبلیغ" or "ویزا" or ad containers
      const allElements = Array.from(document.querySelectorAll('*'));
      const adOverlayCandidates = [];
      
      allElements.forEach(el => {
        const text = el.innerText || '';
        if (text.includes('close ads') || text.includes('بستن تبلیغ') || text.includes('ویزای استرالیا') || text.includes('اقامت استرالیا')) {
          adOverlayCandidates.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            text: text.substring(0, 150),
            parentTag: el.parentElement?.tagName,
            parentClass: el.parentElement?.className,
            parentId: el.parentElement?.id
          });
        }
      });
      
      const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
        src: i.src,
        alt: i.alt,
        parentClass: i.parentElement?.className,
        parentId: i.parentElement?.id
      }));
      
      return { adOverlayCandidates, imgsSample: imgs.slice(0, 20) };
    });
    
    console.log('Ad Overlay Candidates:', JSON.stringify(adData.adOverlayCandidates, null, 2));
    console.log('Images Sample:', JSON.stringify(adData.imgsSample, null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  await browser.close();
})();
