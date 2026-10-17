/**
 * Rastin RTL - Element Picker & Zapper Script
 * Allows users to select and permanently block/hide any visual element on the page.
 */

(function () {
  'use strict';

  function escapeSelector(val) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(val);
    }
    return val.replace(/([!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
  }

  let pickerActive = false;
  let hoveredElement = null;
  let selectedElement = null;
  let selectedSelector = '';

  let overlayEl = null;
  let hudEl = null;
  let stylesEl = null;

  // CSS Styles for Picker Overlay and HUD
  const PICKER_CSS = `
    #rtl-fixer-picker-overlay {
      position: fixed !important;
      pointer-events: none !important;
      border: 2px dashed #339af0 !important;
      background-color: rgba(51, 154, 240, 0.12) !important;
      z-index: 2147483646 !important;
      box-sizing: border-box !important;
      transition: all 0.08s ease !important;
      border-radius: 4px !important;
    }
    #rtl-fixer-picker-hud {
      position: fixed !important;
      z-index: 2147483647 !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 320px !important;
      background: #ffffff !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 16px !important;
      padding: 16px !important;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08) !important;
      font-family: 'Vazirmatn', system-ui, -apple-system, sans-serif !important;
      direction: rtl !important;
      color: #1e293b !important;
      box-sizing: border-box !important;
      text-align: right !important;
    }
    #rtl-fixer-picker-hud h3 {
      font-size: 14px !important;
      font-weight: 700 !important;
      margin: 0 0 6px 0 !important;
      color: #1e293b !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    #rtl-fixer-picker-hud p {
      font-size: 11px !important;
      color: #64748b !important;
      margin: 0 0 12px 0 !important;
      line-height: 1.5 !important;
    }
    #rtl-fixer-picker-hud input {
      width: 100% !important;
      padding: 8px 12px !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 10px !important;
      font-size: 11px !important;
      font-family: monospace !important;
      direction: ltr !important;
      margin-bottom: 14px !important;
      background: #f8fafc !important;
      color: #334155 !important;
      box-sizing: border-box !important;
      outline: none !important;
      transition: all 0.2s ease !important;
    }
    #rtl-fixer-picker-hud input:focus {
      background: #ffffff !important;
      border-color: #339af0 !important;
      box-shadow: 0 0 0 3px rgba(51, 154, 240, 0.1) !important;
    }
    #rtl-fixer-picker-hud .hud-buttons {
      display: flex !important;
      gap: 8px !important;
    }
    #rtl-fixer-picker-hud button {
      flex: 1 !important;
      border: none !important;
      border-radius: 10px !important;
      padding: 8px 12px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 4px !important;
    }
    #rtl-fixer-picker-hud .btn-confirm {
      background: #339af0 !important;
      color: white !important;
      box-shadow: 0 4px 10px rgba(51, 154, 240, 0.2) !important;
    }
    #rtl-fixer-picker-hud .btn-confirm:hover {
      background: #228be6 !important;
      box-shadow: 0 6px 14px rgba(34, 139, 230, 0.3) !important;
      transform: translateY(-1px) !important;
    }
    #rtl-fixer-picker-hud .btn-confirm:active {
      transform: translateY(0) !important;
    }
    #rtl-fixer-picker-hud .btn-cancel {
      background: #f1f3f5 !important;
      color: #495057 !important;
      border: 1px solid #dee2e6 !important;
    }
    #rtl-fixer-picker-hud .btn-cancel:hover {
      background: #e9ecef !important;
      color: #212529 !important;
      transform: translateY(-1px) !important;
    }
    #rtl-fixer-picker-hud .btn-cancel:active {
      transform: translateY(0) !important;
    }
  `;

  // Generate unique CSS selector for the given element
  function getUniqueSelector(el) {
    if (!(el instanceof Element)) return '';

    // If it has a unique ID, use it
    if (el.id && document.querySelectorAll(`#${escapeSelector(el.id)}`).length === 1) {
      return `#${escapeSelector(el.id)}`;
    }

    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();

      if (el.id && document.querySelectorAll(`#${escapeSelector(el.id)}`).length === 1) {
        selector = `#${escapeSelector(el.id)}`;
        path.unshift(selector);
        break;
      } else {
        let className = '';
        if (el.className && typeof el.className === 'string') {
          // Clean classes and remove helper or temporary classes
          const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('rtl-fixer-') && !c.includes('hover') && !c.includes('active'));
          if (classes.length > 0) {
            className = classes.map(c => `.${escapeSelector(c)}`).join('');
          }
        }
        if (className) {
          selector += className;
        }

        // Check if selector is unique globally
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1) {
            path.unshift(selector);
            break;
          }
        } catch (_) {}

        // Otherwise find index among siblings
        let sibling = el;
        let siblingCount = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.nodeName === el.nodeName) {
            siblingCount++;
          }
        }
        selector += `:nth-of-type(${siblingCount})`;
        path.unshift(selector);
      }
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  // Draw overlay rectangle on target element
  function drawOverlay(el) {
    if (!el || !overlayEl) return;
    const rect = el.getBoundingClientRect();
    overlayEl.style.top = `${rect.top}px`;
    overlayEl.style.left = `${rect.left}px`;
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;
    overlayEl.style.display = 'block';
  }

  // Event Handlers
  function handleMouseMove(e) {
    if (!pickerActive || selectedElement) return;

    const el = e.target;
    // Do not highlight picker's own DOM
    if (!el || el === document.body || el === document.documentElement || el.closest('#rtl-fixer-picker-hud') || el === overlayEl) {
      if (overlayEl) overlayEl.style.display = 'none';
      hoveredElement = null;
      return;
    }

    hoveredElement = el;
    drawOverlay(el);
  }

  function handleClick(e) {
    if (!pickerActive) return;

    // If we click inside the HUD, ignore and allow normal click processing
    if (e.target.closest('#rtl-fixer-picker-hud')) return;

    // Prevent navigation or clicking links
    e.preventDefault();
    e.stopPropagation();

    if (hoveredElement) {
      selectedElement = hoveredElement;
      selectedSelector = getUniqueSelector(selectedElement);
      drawOverlay(selectedElement);

      // Update HUD
      showHudSelection();
    }
  }

  function handleKeyDown(e) {
    if (!pickerActive) return;
    
    if (e.key === 'Escape') {
      cancelPicker();
    }
  }

  // Setup HUD selection controls
  function showHudSelection() {
    if (!hudEl) return;

    hudEl.innerHTML = `
      <h3>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        مسدودسازی المان انتخابی
      </h3>
      <p>آیا می‌خواهید این بخش را برای همیشه مخفی کنید؟</p>
      <input type="text" id="rtl-fixer-selector-input">
      <div class="hud-buttons">
        <button type="button" class="btn-confirm" id="rtl-fixer-hud-confirm">مسدود کردن</button>
        <button type="button" class="btn-cancel" id="rtl-fixer-hud-cancel">انصراف</button>
      </div>
    `;

    document.getElementById('rtl-fixer-hud-confirm').addEventListener('click', confirmBlock);
    document.getElementById('rtl-fixer-hud-cancel').addEventListener('click', cancelSelection);
    
    // Auto focus and select input for editing
    const input = document.getElementById('rtl-fixer-selector-input');
    if (input) {
      input.value = selectedSelector;
      input.focus();
      input.select();
      input.addEventListener('input', (e) => {
        selectedSelector = e.target.value;
        try {
          const el = document.querySelector(selectedSelector);
          if (el) {
            selectedElement = el;
            drawOverlay(selectedElement);
          }
        } catch (_) {}
      });
    }
  }

  function showHudInitial() {
    if (!hudEl) return;

    hudEl.innerHTML = `
      <h3>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" style="transform: scaleX(-1);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
        انتخابگر المان (Rastin RTL)
      </h3>
      <p>مکان‌نما را روی المان مورد نظر برده و کلیک کنید. کلید Esc برای خروج.</p>
      <div class="hud-buttons">
        <button type="button" class="btn-cancel" style="width: 100%;" id="rtl-fixer-hud-cancel-initial">انصراف</button>
      </div>
    `;
    document.getElementById('rtl-fixer-hud-cancel-initial').addEventListener('click', cancelPicker);
  }

  function startPicker() {
    if (pickerActive) return;

    // Check if extension is enabled for this site
    chrome.storage.local.get(null, (allStorage) => {
      const globalEnabled = allStorage.enabled !== false;
      const siteConfig = RtlFixer.getStoredSiteConfig(allStorage);
      const isDomainEnabled = siteConfig.enabled === true;
      
      if (!globalEnabled || !isDomainEnabled) {
        console.log('[Rastin RTL] Picker cannot start because extension is disabled on this site.');
        alert('برای استفاده از انتخاب‌گر المان، ابتدا افزونه را برای این سایت فعال کنید.');
        return;
      }

      pickerActive = true;
      selectedElement = null;
      hoveredElement = null;

      // Inject styles
      stylesEl = document.createElement('style');
      stylesEl.textContent = PICKER_CSS;
      document.documentElement.appendChild(stylesEl);

      // Create overlay
      overlayEl = document.createElement('div');
      overlayEl.id = 'rtl-fixer-picker-overlay';
      document.body.appendChild(overlayEl);

      // Create HUD
      hudEl = document.createElement('div');
      hudEl.id = 'rtl-fixer-picker-hud';
      document.body.appendChild(hudEl);
      showHudInitial();

      // Bind listeners
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);

      console.log('[Rastin RTL] Element picker mode activated.');
    });
  }

  function validateCustomSelector(selector) {
    if (!selector || typeof selector !== 'string') return { valid: false, reason: 'گزینشگر خالی است' };
    const trimmed = selector.trim();

    // 1. Syntax & Injection Guard: Reject {, }, @import, @layer, control characters
    if (/[\{\}\@\0-\x1F\x7F]/.test(trimmed)) {
      return { valid: false, reason: 'گزینشگر شامل کاراکترهای غیرمجاز مانند { یا } است' };
    }

    // 2. Forbidden Targets Guard
    const forbidden = ['*', 'html', 'body', 'head', ':root', 'ytd-app', '#content'];
    const lower = trimmed.toLowerCase();
    if (forbidden.includes(lower) || lower.startsWith('#rtl-fixer-') || lower.startsWith('.rtl-fixer-')) {
      return { valid: false, reason: 'نمی‌توانید کل صفحه، عناصر اصلی یا رابط افزونه را مسدود کنید' };
    }

    // 3. QuerySelector Validation & Match Threshold Check
    try {
      const matches = document.querySelectorAll(trimmed);
      if (matches.length === 0) {
        return { valid: false, reason: 'هیچ عنصری با این گزینشگر یافت نشد' };
      }
      if (matches.length > 20) {
        return { valid: false, reason: `این گزینشگر بیش از حد عمومی است و ${matches.length} عنصر را مسدود خواهد کرد (حداکثر مجاز: ۲۰)` };
      }
    } catch (e) {
      return { valid: false, reason: 'ساختار گزینشگر CSS معتبر نیست' };
    }

    return { valid: true };
  }

  function confirmBlock() {
    if (!selectedSelector.trim()) return;

    const validation = validateCustomSelector(selectedSelector);
    if (!validation.valid) {
      alert(`خطا در ثبت قانون: ${validation.reason}`);
      return;
    }

    const host = location.hostname;
    try {
      chrome.storage.local.get({ customRules: {} }, (items) => {
        const customRules = items.customRules;
        if (!customRules[host]) {
          customRules[host] = [];
        }
        if (!customRules[host].includes(selectedSelector)) {
          customRules[host].push(selectedSelector);
        }
        chrome.storage.local.set({ customRules }, () => {
          console.log(`[Rastin RTL] Blocked element: ${selectedSelector}`);
          
          if (selectedElement) {
            selectedElement.style.setProperty('display', 'none', 'important');
          }

          document.dispatchEvent(new CustomEvent('rastin-rtl-rules-updated'));

          try {
            chrome.runtime.sendMessage({ action: 'refreshCustomRules' }).catch(() => {});
          } catch (_) {}

          cancelPicker();
        });
      });
    } catch (e) {
      console.warn('[Rastin RTL] Error saving custom rule:', e);
      if (selectedElement) {
        selectedElement.style.setProperty('display', 'none', 'important');
      }
      cancelPicker();
    }
  }

  function cancelSelection() {
    selectedElement = null;
    selectedSelector = '';
    showHudInitial();
    if (overlayEl) overlayEl.style.display = 'none';
  }

  function cancelPicker() {
    pickerActive = false;
    selectedElement = null;
    hoveredElement = null;

    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    // Clean DOM
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    if (hudEl) {
      hudEl.remove();
      hudEl = null;
    }
    if (stylesEl) {
      stylesEl.remove();
      stylesEl = null;
    }

    console.log('[Rastin RTL] Element picker mode deactivated.');
  }

  // Listen for messages from the popup controls
  window.RtlFixer.startElementPicker = startPicker;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startElementPicker') {
      startPicker();
      sendResponse({ status: 'started' });
    }
  });
})();
