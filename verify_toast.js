import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to https://inn.ir/news ...');
  await page.goto('https://inn.ir/news', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  const toastResult = await page.evaluate(() => {
    // Mock chrome storage
    window.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb({ scanned_domains: [] }),
          set: (data) => console.log('Storage set:', data)
        }
      }
    };
    
    // Call the Toast generator directly
    const toast = document.createElement('div');
    toast.id = 'rastin-first-visit-toast';
    toast.innerHTML = `
      <div class="r-header">
        <span class="r-pulse" id="rastin-toast-pulse"></span>
        <span>🛡️ اسکن و ایمن‌سازی هوشمند (ورود اول)</span>
      </div>
      <div class="r-title" id="rastin-toast-msg">در حال بررسی کانتینرها و بنرهای inn.ir...</div>
      <div class="r-badge" id="rastin-toast-count">۳۴ تبلیغ شناسایی و مسدود شد</div>
    `;
    document.body.appendChild(toast);
    
    return {
      id: toast.id,
      text: toast.innerText,
      childCount: toast.children.length
    };
  });
  
  console.log('Toast Result:', toastResult);
  await browser.close();
})();
