import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Deep inspecting ShahreKhabar DOM...');
  try {
    await page.goto('https://www.shahrekhabar.com/news/17854722003497', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    const details = await page.evaluate(() => {
      const allImgs = Array.from(document.querySelectorAll('img')).map(i => ({
        src: i.src,
        alt: i.alt,
        href: i.closest('a')?.href,
        parentClass: i.parentElement?.className,
        grandParentClass: i.parentElement?.parentElement?.className
      }));
      
      const allDivsWithClasses = Array.from(document.querySelectorAll('div[class], section[class], aside[class]'))
        .map(d => d.className)
        .filter(c => typeof c === 'string' && (c.includes('box') || c.includes('banner') || c.includes('adv') || c.includes('side') || c.includes('link')));
        
      return { allImgs, divClassesSample: Array.from(new Set(allDivsWithClasses)) };
    });
    
    console.log('All Images count:', details.allImgs.length);
    console.log('All Images:', JSON.stringify(details.allImgs, null, 2));
    console.log('Div classes sample:', JSON.stringify(details.divClassesSample, null, 2));
    
  } catch(e) {
    console.error('Error:', e);
  }
  await browser.close();
})();
