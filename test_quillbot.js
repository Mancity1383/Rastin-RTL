import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to QuillBot...');
  await page.goto('https://quillbot.com/translate?sl=fa&tl=en&tone=auto&text=%D8%B3%D9%84%D8%A7%D9%85', { waitUntil: 'networkidle' });
  
  await page.waitForTimeout(4000);
  
  const info = await page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"]'));
    const allBtns = Array.from(document.querySelectorAll('button')).map(b => b.innerText);
    const divs = Array.from(document.querySelectorAll('div')).map(d => d.innerText).filter(t => t && t.length > 2 && t.length < 200);
    return {
      textareasCount: textareas.length,
      textareasContent: textareas.map(t => t.innerText),
      allBtnsSample: allBtns.slice(0, 15),
      divsSample: divs.slice(0, 15)
    };
  });
  
  console.log('Page Info:', JSON.stringify(info, null, 2));
  
  // Try to click any translate button if it exists
  const translateBtn = await page.$('button:has-text("Translate"), #tltr-translate-button');
  if (translateBtn) {
    console.log('Found Translate Button! Clicking...');
    await translateBtn.click();
    await page.waitForTimeout(4000);
    
    const afterClick = await page.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"]'));
      return textareas.map(t => t.innerText);
    });
    console.log('After Click Textareas:', afterClick);
  }
  
  await browser.close();
})();
