/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixtures */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const test=base.extend({
  context:async({browserName:_},use)=>{const context=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',viewport:{width:1280,height:900},args:['--disable-extensions-except='+root,'--load-extension='+root]});await use(context);await context.close();},
  page:async({context},use)=>{await use(await context.newPage());}
});
const workerFor=async context=>context.serviceWorkers()[0]||context.waitForEvent('serviceworker');
async function send(context,message){const worker=await workerFor(context);return worker.evaluate(async message=>{const tabs=await chrome.tabs.query({url:'https://example.com/*'});return chrome.tabs.sendMessage(tabs[tabs.length-1].id,message);},message);}
async function isolated(context,func,args=[]){const worker=await workerFor(context);const expression='async args => {const tabs=await chrome.tabs.query({url:"https://example.com/*"});const result=await chrome.scripting.executeScript({target:{tabId:tabs[tabs.length-1].id},world:"ISOLATED",func:('+func.toString()+'),args});if(result[0].error)throw new Error(result[0].error);return result[0].result;}';return worker.evaluate('('+expression+')('+JSON.stringify(args)+')');}
const translator=page=>page.locator('#rtl-fixer-translator-host');
test.beforeEach(async({context,page})=>{
  const worker=await workerFor(context);
  await worker.evaluate(()=>chrome.storage.local.set({enabled:true,adBlockEnabled:false,'site_config_example.com':{enabled:true,highlightEnabled:true,translatorEnabled:true},translatorApi:'google'}));
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="UTF-8"><style>body{margin:40px;font:18px Arial;background:#f7f8fb;min-height:2000px}p{max-width:680px}</style></head><body><h1>مطالعه با راستین</h1><p id="selected">A clear idea becomes more useful when you write it down.</p><p>یک یادداشت کوچک، برای یک ایدهٔ مهم.</p><div id="editor" contenteditable="true" dir="auto" style="direction:ltr;text-align:center"></div><input id="email" type="email" dir="ltr"><input id="password" type="password" dir="ltr"></body></html>'}));
  await page.goto('https://example.com/article');
  await expect.poll(()=>send(context,{action:'updateSettings',settings:{enabled:true,highlightEnabled:true,translatorEnabled:true,translatorApi:'google'}}).catch(()=>null)).toMatchObject({status:'success'});
});
test('translator source editing, target languages, cache and safe copy actions',async({page,context},info)=>{
  let requests=0;
  await page.route('https://translate.googleapis.com/**',route=>{requests++;const lang=new URL(route.request().url()).searchParams.get('tl');return route.fulfill({contentType:'application/json',body:JSON.stringify([[[lang==='ar'?'فكرة واضحة':'یک ایدهٔ روشن','hello',null,null]],null,'en'])});});
  await send(context,{action:'openTranslator'});
  const source=translator(page).getByRole('textbox',{name:'متن برای ترجمه'});
  await source.fill('hello <img id="injected" src=x>');
  await source.press('Control+Enter');
  await expect(translator(page).locator('.translation-result')).toContainText('یک ایده');
  await expect(translator(page).locator('#injected')).toHaveCount(0);
  await expect(translator(page).locator('.word-title')).toContainText('<img');
  await expect(translator(page).getByRole('button',{name:'کپی ترجمه'})).toBeVisible();
  await source.press('Control+Enter');
  await expect(translator(page).locator('.translation-status')).toHaveText('از حافظه');
  expect(requests).toBe(1);
  await translator(page).getByRole('combobox',{name:'زبان ترجمه'}).selectOption('ar');
  await expect(translator(page).locator('.translation-result')).toContainText('فكرة');
  await expect(translator(page).locator('.translation-result')).toHaveCSS('direction','rtl');
  expect(requests).toBe(2);
  await page.screenshot({path:info.outputPath('translator-remaster.png'),animations:'disabled'});
});
test('cancel, close and retry never let a stale result replace the active translation',async({page,context})=>{
  let attempt=0;
  await page.route('https://translate.googleapis.com/**',async route=>{
    attempt++;
    if(attempt===1){await new Promise(resolve=>setTimeout(resolve,220));await route.fulfill({contentType:'application/json',body:JSON.stringify([[['late','first']]])}).catch(()=>{});}
    else if(attempt===2)await route.fulfill({status:503,body:'unavailable'});
    else await route.fulfill({contentType:'application/json',body:JSON.stringify([[['دوباره آماده','first']]])});
  });
  await send(context,{action:'openTranslator'});
  const source=translator(page).getByRole('textbox',{name:'متن برای ترجمه'});await source.fill('first');await source.press('Control+Enter');
  await translator(page).getByRole('button',{name:'لغو ترجمه'}).click();
  await expect(translator(page).locator('.translation-status')).toHaveText('لغو شد');
  await page.waitForTimeout(260);await expect(translator(page).locator('.translation-result')).toHaveCount(0);
  await source.press('Control+Enter');
  await expect(translator(page).getByRole('button',{name:'تلاش دوباره'})).toBeVisible();
  await translator(page).getByRole('button',{name:'تلاش دوباره'}).click();
  await expect(translator(page).locator('.translation-result')).toContainText('دوباره آماده');
  await page.keyboard.press('Escape');await expect(translator(page).locator('.translator-card')).not.toHaveClass(/visible/);
});
test('highlight board filters, deletion recovery and notes retain their saved content',async({page,context},info)=>{
  await page.evaluate(()=>{const p=document.getElementById('selected'),range=document.createRange();range.selectNodeContents(p);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await expect(page.locator('#rastin-highlight-bar')).not.toHaveClass(/hidden/);
  await page.locator('#rastin-bar-add-note').dispatchEvent('pointerdown');
  const note=page.getByRole('textbox',{name:'یادداشت',exact:true});
  await note.fill('ایده‌ای برای ادامهٔ مطالعه');
  await expect(page.locator('.rastin-note-footer')).toContainText('ذخیره شد');
  await isolated(context,()=>window.RtlFixer.openHighlightHub());
  const hub=page.locator('#rastin-hub-drawer');
  await expect(hub.locator('.rastin-hub-card')).toHaveCount(1);
  await isolated(context,()=>chrome.runtime.sendMessage({action:'mutateHighlights',key:'rtl_fixer_hl_example.com',operation:{type:'add',item:{id:'other-page',pageKey:'example.com/other',url:'https://example.com/other',path:'/other',text:'Another passage',color:'#bfdbfe',timestamp:Date.now(),note:{text:''}}}}));
  await hub.locator('[data-filter="site"]').click();await expect(hub.locator('.rastin-hub-card')).toHaveCount(2);
  await hub.locator('[data-filter="notes"]').click();await expect(hub.locator('.rastin-hub-card')).toHaveCount(1);
  await hub.getByRole('button',{name:'حذف',exact:true}).click();await expect(hub.locator('.rastin-hub-card')).toHaveCount(0);
  await hub.getByRole('button',{name:'بازگرداندن حذف'}).click();await expect(hub.locator('.rastin-hub-card')).toHaveCount(1);
  await expect(hub.locator('.rastin-hub-card-note')).toContainText('ایده‌ای');
  await page.screenshot({path:info.outputPath('highlights-remaster.png'),animations:'disabled'});
});
test('empty rich editors restore their own alignment and technical inputs keep their direction',async({page})=>{
  const editor=page.locator('#editor');await editor.fill('متن فارسی');
  await expect(editor).toHaveAttribute('dir','rtl');
  await editor.fill('');
  await expect(editor).toHaveAttribute('dir','auto');await expect(editor).toHaveCSS('direction','ltr');await expect(editor).toHaveCSS('text-align','center');
  await page.locator('#password').fill('متن محرمانه');await expect(page.locator('#password')).toHaveAttribute('dir','ltr');
  await expect(page.locator('#email')).toHaveAttribute('dir','ltr');
});
test('ad-block disable restores ad wrappers and preserves newer site style changes',async({page,context})=>{
  const worker=await workerFor(context);
  await worker.evaluate(()=>chrome.storage.local.set({adBlockEnabled:true}));
  await expect(page.locator('#rastin-rtl-v3')).toHaveCount(1);
  await page.evaluate(()=>{const wrapper=document.createElement('div');wrapper.id='wrapper';wrapper.style.cssText='padding:7px;margin:5px;min-height:100px';wrapper.innerHTML='<div id="dynamic-ad" style="height:90px;visibility:visible">Banner</div>';document.body.appendChild(wrapper);});
  await page.locator('#dynamic-ad').evaluate(el=>{el.className='ad-banner';});
  await expect(page.locator('#dynamic-ad')).toHaveCSS('display','none');
  await expect.poll(()=>page.locator('#dynamic-ad').getAttribute('data-rastin-engine-hidden')).toBe('1');
  await page.locator('#wrapper').evaluate(el=>el.style.setProperty('margin','13px','important'));
  await worker.evaluate(()=>chrome.storage.local.set({adBlockEnabled:false}));
  await expect(page.locator('#dynamic-ad')).toHaveCSS('display','block');await expect(page.locator('#dynamic-ad')).toHaveCSS('height','90px');
  await expect(page.locator('#wrapper')).toHaveCSS('padding','7px');await expect(page.locator('#wrapper')).toHaveCSS('margin','13px');
  await expect(page.locator('#wrapper')).toHaveCSS('min-height','100px');
});
test('reading progress survives rapid restarts with one indicator and bounded position',async({page,context})=>{
  for(const enabled of [true,false,true,false,true])await send(context,{action:'updateSettings',settings:{enabled:true,readingProgressEnabled:enabled,focusCoachEnabled:enabled}});
  await expect(page.locator('#rtl-fixer-progress-container')).toHaveCount(1);
  await expect(page.locator('#rtl-fixer-focus-pulse')).toHaveCount(1);
  await page.evaluate(()=>scrollTo(0,1200));
  await expect.poll(()=>page.locator('#rtl-fixer-progress-container').getAttribute('aria-valuenow').then(Number)).toBeGreaterThan(50);
  await send(context,{action:'updateSettings',settings:{enabled:false}});
  await expect(page.locator('#rtl-fixer-progress-container')).toHaveCount(0);await expect(page.locator('#rtl-fixer-focus-pulse')).toHaveCount(0);
});
test('popup search finds settings and saved highlights stay readable with the tool off',async({context},info)=>{
  const worker=await workerFor(context);
  await worker.evaluate(()=>chrome.storage.local.set({'rtl_fixer_hl_example.com':[{id:'saved-note',pageKey:'example.com/article',text:'Saved text',url:'https://example.com/article',color:'#fef08a',timestamp:Date.now(),note:{text:'Keep reading'}}],'site_config_example.com':{enabled:true,highlightEnabled:false}}));
  const popup=await context.newPage();await popup.goto('chrome-extension://'+new URL(worker.url()).host+'/popup/popup.html');
  await popup.getByRole('searchbox',{name:'جستجوی ابزار و تنظیمات'}).fill('هایلایت');
  await expect(popup.locator('[data-section="highlights"]')).toBeVisible();
  await expect(popup.locator('[data-section="adblock"]')).toBeHidden();
  await expect(popup.locator('#highlight-search')).toBeEnabled();
  await popup.locator('[data-value="all"]').last().click();
  await expect(popup.locator('#highlights-list')).toContainText('Saved text');
  await popup.getByRole('searchbox',{name:'جستجوی ابزار و تنظیمات'}).press('Escape');
  await expect(popup.locator('.accordion-panel:not([hidden])')).toHaveCount(9);
  await popup.screenshot({path:info.outputPath('popup-remaster.png'),animations:'disabled'});
});

test('long translator results remain inside the viewport and tool selections are not page annotations',async({page,context})=>{
  await page.setViewportSize({width:430,height:460});
  await page.route('https://translate.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([[['یک توضیح روشن برای ادامهٔ مطالعه. '.repeat(50),'long passage']]])}));
  await isolated(context,()=>window.RtlFixer.translateText('long passage',390,420));
  const card=translator(page).locator('.translator-card');
  await expect(translator(page).locator('.translation-result')).toContainText('یک توضیح');
  await expect.poll(async()=>{const b=await card.boundingBox();return b.y+b.height;}).toBeLessThanOrEqual(448);
  await page.evaluate(()=>{
    const result=document.getElementById('rtl-fixer-translator-host').shadowRoot.querySelector('.translation-result');
    const range=document.createRange();range.selectNodeContents(result);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    result.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));
  });
  await expect(page.locator('#rastin-highlight-bar:not(.hidden)')).toHaveCount(0);
});

test('one-off translator stays open when changing preferences on a site with RTL disabled',async({page,context})=>{
  await send(context,{action:'updateSettings',settings:{enabled:false}});
  await page.route('https://translate.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([[['Ein klarer Gedanke','hello']],null,'en'])}));
  await send(context,{action:'openTranslator'});
  await translator(page).getByRole('combobox',{name:'زبان ترجمه'}).selectOption('de');
  const source=translator(page).getByRole('textbox',{name:'متن برای ترجمه'});await source.fill('hello');await source.press('Control+Enter');
  await expect(translator(page).locator('.translation-result')).toHaveText('Ein klarer Gedanke');
  await expect(translator(page).locator('.translator-card')).toHaveClass(/visible/);
});
test('popup keeps its intrinsic width during Chromium action-popup sizing',async({context},info)=>{
  const worker=await workerFor(context);
  const popup=await context.newPage();
  // Chromium starts sizing an action popup with a narrow viewport. A vw cap
  // on the body creates a circular dependency and collapses the native panel.
  await popup.setViewportSize({width:25,height:600});
  await popup.goto('chrome-extension://'+new URL(worker.url()).host+'/popup/popup.html');
  for(const selector of ['html','body','.popup-container']){
    await expect(popup.locator(selector)).toHaveCSS('width','380px');
  }
  await popup.setViewportSize({width:380,height:600});
  await expect(popup.locator('.header')).toBeVisible();
  await expect(popup.getByRole('searchbox',{name:'جستجوی ابزار و تنظیمات'})).toBeVisible();
  expect(await popup.evaluate(()=>document.documentElement.scrollWidth)).toBe(380);
  await popup.locator('[data-section="web-tools"]').evaluate(el=>el.open=true);
  expect(await popup.evaluate(()=>document.documentElement.scrollWidth)).toBe(380);
  await popup.screenshot({path:info.outputPath('popup-width-fixed.png'),animations:'disabled'});
});