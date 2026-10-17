// RTL Beautifier & Fixer - Premium Neobrutalist Popup Script

document.addEventListener('DOMContentLoaded', () => {
  let currentHost = '';
  let activeTabId = null;
  let activeTabUrl = '';
  let siteConfigKey = '';
  let pageSupported = false;
  let readerSourceUrl = '';
  let settingsLoaded = false;

  const quickPaint = document.getElementById('quick-paint-btn');
  const quickTranslate = document.getElementById('quick-translate-btn');
  const quickNotes = document.getElementById('quick-notes-btn');
  const quickStatus = document.getElementById('quick-status');
  const settingsSearch = document.getElementById('settings-search');
  const normalizeSearch = text => text.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
  settingsSearch.addEventListener('input', () => {
    const query = normalizeSearch(settingsSearch.value.trim());
    document.querySelectorAll('.accordion-panel').forEach(panel => {
      if (query && panel.dataset.searchOpen === undefined) panel.dataset.searchOpen = String(panel.open);
      const matches = !query || normalizeSearch(panel.textContent + ' ' + panel.dataset.section).includes(query);
      panel.hidden = !matches;
      if (query && matches) panel.open = true;
      if (!query && panel.dataset.searchOpen !== undefined) { panel.open = panel.dataset.searchOpen === 'true'; delete panel.dataset.searchOpen; }
    });
  });
  settingsSearch.addEventListener('keydown', e => { if (e.key === 'Escape') { settingsSearch.value = ''; settingsSearch.dispatchEvent(new Event('input')); } });
  quickPaint.addEventListener('click', () => openPaintBtn.click());
  quickNotes.addEventListener('click', () => {
    settingsSearch.value = ''; settingsSearch.dispatchEvent(new Event('input'));
    const panel = document.querySelector('[data-section="highlights"]'); panel.open = true;
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  quickTranslate.addEventListener('click', async () => {
    quickStatus.textContent = '';
    try { const result = await sendToPage(activeTabId, { action: 'openTranslator' });
      if (!result?.ok) throw new Error(result?.error || 'بازکردن مترجم ناموفق بود.'); window.close();
    } catch { quickStatus.textContent = 'صفحه را تازه‌سازی کنید؛ این ابزار روی صفحات داخلی مرورگر اجرا نمی‌شود.'; }
  });
  // UI Elements
  const globalToggle = document.getElementById('global-toggle');
  const domainToggle = document.getElementById('domain-toggle');
  const domainNameLabel = document.getElementById('domain-name');
  const domainScopeLabel = document.getElementById('domain-scope-label');
  const domainLogoImg = document.getElementById('domain-logo');
  const pageAccessNotice = document.getElementById('page-access-notice');
  const pageAccessMessage = document.getElementById('page-access-message');
  const fileAccessSettingsBtn = document.getElementById('file-access-settings-btn');
  document.getElementById('open-reader-btn').addEventListener('click', () => {
    const readerUrl = new URL(chrome.runtime.getURL('reader/viewer.html'));
    if (readerSourceUrl) readerUrl.searchParams.set('file', readerSourceUrl);
    chrome.tabs.create({ url: readerUrl.href });
  });
  fileAccessSettingsBtn.addEventListener('click', () => {
    const scheme = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
    chrome.tabs.create({ url: `${scheme}://extensions/?id=${chrome.runtime.id}` });
  });
  
  const inputsAutoToggle = document.getElementById('inputs-auto-toggle');
  const rightAlignToggle = document.getElementById('right-align-toggle');
  const justifyToggle = document.getElementById('justify-toggle');
  const tablesToggle = document.getElementById('tables-toggle');
  
  const customFontWrapper = document.getElementById('custom-font-wrapper');
  const customFontNameInput = document.getElementById('custom-font-name');
  const customFontUrlInput = document.getElementById('custom-font-url');
  
  const fontSizeAdjustInput = document.getElementById('font-size-adjust');
  const fontSizeValLabel = document.getElementById('font-size-val');
  
  const lineHeightAdjustInput = document.getElementById('line-height-adjust');
  const lineHeightValLabel = document.getElementById('line-height-val');

  const persianDigitsToggle = document.getElementById('persian-digits-toggle');
  const listsBlockquoteToggle = document.getElementById('lists-blockquote-toggle');
  const adBlockToggle = document.getElementById('adblock-toggle');
  const adBlockCosmeticToggle = document.getElementById('adblock-cosmetic-toggle');
  const adBlockGapRemoverToggle = document.getElementById('adblock-gapremover-toggle');
  const elementPickerBtn = document.getElementById('element-picker-btn');
  const openPaintBtn = document.getElementById('open-paint-btn');
  const paintLaunchStatus = document.getElementById('paint-launch-status');
  const elementRestoreBtn = document.getElementById('element-restore-btn');
  const techCodeToggle = document.getElementById('tech-code-toggle');
  const readingRulerToggle = document.getElementById('reading-ruler-toggle');
  
  const focusCoachToggle = document.getElementById('focus-coach-toggle');
  const readingProgressToggle = document.getElementById('reading-progress-toggle');
  const bionicTextToggle = document.getElementById('bionic-text-toggle');
  const allowCopyToggle = document.getElementById('allow-copy-toggle');
  const translatorToggle = document.getElementById('translator-toggle');
  const translatorApiSelect = document.getElementById('translator-api-select');
  const translatorSubSettings = document.querySelector('.translator-sub-settings');
  const keyPollinations = document.getElementById('key-pollinations');

  // Highlights Elements
  const highlightToggle = document.getElementById('highlight-toggle');
  const highlightSearch = document.getElementById('highlight-search');
  const highlightFilterGroup = document.getElementById('highlight-filter-group');
  const highlightsList = document.getElementById('highlights-list');
  const highlightsCount = document.getElementById('highlights-count');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  
  // Default configurations
  let globalConfig = {
    enabled: true,
    adBlockEnabled: true,
    adBlockCosmetic: true,
    adBlockGapRemover: true,
    disabledAdBlockDomains: [],
    apiKeys: {
      pollinations: ''
    },
    translatorApi: 'openai'
  };

  let defaultSiteConfig = {
    enabled: false, // OFF by default for all sites
    alignmentMode: 'auto',
    inputsAutoDir: true,
    forceRightAlign: false,
    justifyText: false,
    fontFamily: 'Vazirmatn',
    customFontName: '',
    customFontUrl: '',
    fontWeight: '400',
    fontSizeAdjust: 0,
    lineHeightAdjust: 1.6,
    persianDigits: false,
    fixTables: true,
    fixListsBlockquotes: true,
    techCodeProtection: true,
    readingRulerEnabled: false,
    readingRulerFocus: false,
    focusCoachEnabled: false,
    readingProgressEnabled: false,
    bionicTextEnabled: false,
    batteryPositionX: '20px',
    batteryPositionY: '15px',
    allowCopyEnabled: false,
    translatorEnabled: false,
    highlightEnabled: false, // OFF by default
    highlightColor: 'yellow',
    adBlockEnabled: true // ON by default
  };

  let config = { ...defaultSiteConfig, ...globalConfig };

  // Helper to convert numbers to Persian digits
  function toPersianDigits(num) {
    const pDigits = '۰۱۲۳۴۵۶۷۸۹';
    return num.toString().replace(/\d/g, d => pDigits[d]).replace('-', 'منفی ');
  }

  function obfuscate(str) {
    if (!str) return '';
    try {
      const key = 42;
      let result = '';
      for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) ^ key);
      }
      return btoa(result);
    } catch (_) {
      return str;
    }
  }

  function deobfuscate(str) {
    if (!str) return '';
    try {
      const key = 42;
      const decoded = atob(str);
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ key);
      }
      return result;
    } catch (_) {
      return str;
    }
  }

  // Segment Buttons Management
  function setActiveSegment(groupId, value) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const buttons = group.querySelectorAll('.segment-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-value') === value) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function setupSegmentListener(groupId, configKey, onChangeCallback) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.addEventListener('click', (e) => {
      // Ignore if element is disabled
      const btn = e.target.closest('.segment-btn');
      if (!btn || btn.disabled) return;
      const value = btn.getAttribute('data-value');
      config[configKey] = value;
      setActiveSegment(groupId, value);
      if (onChangeCallback) onChangeCallback(value);
      saveConfig();
    });
  }

  const GLOBAL_CONFIG_KEYS = [
    'enabled',
    'adBlockEnabled',
    'adBlockCosmetic',
    'adBlockGapRemover',
    'disabledAdBlockDomains',
    'apiKeys',
    'translatorApi'
  ];

  function getSiteConfigKey(url) {
    if (isOwnReader(url)) return 'site_config_reader';
    if (url.protocol === 'file:') return 'site_config_file://';
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return 'site_config_' + url.hostname.toLowerCase().replace(/^www\./, '');
  }

  function isOwnReader(url) {
    return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && url.pathname === '/reader/viewer.html';
  }

  function sendToPage(tabId, command, url = activeTabUrl) {
    if (isOwnReader(new URL(url))) {
      return chrome.runtime.sendMessage({ action: 'readerCommand', tabId, command });
    }
    return chrome.tabs.sendMessage(tabId, command);
  }

  async function getActiveTab() {
    // A reader's settings button opens this page in a normal tab. Its target
    // remains the owned reader even though the settings tab is now active.
    const requestedId = new URL(window.location.href).searchParams.get('tabId');
    if (/^[1-9]\d*$/.test(requestedId || '') && Number.isSafeInteger(Number(requestedId))) {
      try {
        const tab = await chrome.tabs.get(Number(requestedId));
        if (tab.url && isOwnReader(new URL(tab.url))) return tab;
      } catch (_) {}
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function showPageNotice(message, filePermission = false) {
    pageAccessMessage.textContent = message;
    if (filePermission) {
      const label = 'Allow access to file URLs';
      const [before, after] = message.split(label);
      const englishLabel = document.createElement('bdi');
      englishLabel.dir = 'ltr';
      englishLabel.textContent = label;
      pageAccessMessage.replaceChildren(document.createTextNode(before), englishLabel, document.createTextNode(after || ''));
    }
    pageAccessNotice.hidden = !message;
    fileAccessSettingsBtn.hidden = !filePermission;
  }

  async function checkPageAccess(url) {
    if (isOwnReader(url)) {
      let metadata;
      try { metadata = await sendToPage(activeTabId, { action: 'getPageCapabilities' }); } catch (_) {}
      showPageNotice(metadata?.ok ? 'ابزارهای راستین روی متنِ فایل بازشده در این نمایشگر اجرا می‌شود.' :
        'نمایشگر راستین هنوز آماده نشده است. پس از بازشدن فایل، پنجرهٔ افزونه را دوباره باز کنید.');
      return metadata?.ok === true;
    }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
      showPageNotice('مرورگر اجازهٔ اجرای راستین در صفحات افزونه‌های دیگر را نمی‌دهد. فایل را دانلود کنید و با دکمهٔ «باز کردن فایل در راستین» آن را از رایانه انتخاب کنید.');
      return false;
    }
    if (!getSiteConfigKey(url) ||
        (url.hostname === 'chromewebstore.google.com') ||
        (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) {
      showPageNotice('مرورگر اجازهٔ اجرای ابزارها در این صفحهٔ داخلی یا فروشگاه افزونه‌ها را نمی‌دهد.');
      return false;
    }
    if (url.protocol === 'file:') {
      const allowed = await new Promise(resolve => chrome.extension.isAllowedFileSchemeAccess(resolve));
      if (!allowed) {
        if (/\.pdf$/i.test(url.pathname)) {
          readerSourceUrl = url.href;
          showPageNotice('این فایل محلی را با دکمهٔ «باز کردن فایل در راستین» باز کنید و در صورت نیاز از رایانه انتخاب کنید. برای دسترسی مستقیم، گزینهٔ «Allow access to file URLs» را در جزئیات افزونه روشن کنید.', true);
        } else {
          showPageNotice('برای فایل‌های HTML محلی، در جزئیات افزونه گزینهٔ «Allow access to file URLs» (اجازهٔ دسترسی به نشانی فایل‌ها) را روشن کنید و سپس فایل را تازه‌سازی کنید.', true);
        }
        return false;
      }
    }

    let metadata;
    try {
      metadata = await sendToPage(activeTabId, { action: 'getPageCapabilities' });
    } catch (_) {}
    if (!metadata?.ok) {
      // Native PDF viewers have no content-script receiver. Inspect only the
      // top document's MIME and PDF embed, without fetching or changing it.
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: () => ({ contentType: document.contentType, pdfEmbed: Boolean(document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]')) })
        });
        metadata = results[0]?.result;
      } catch (_) {}
    }
    const isPdf = metadata?.contentType?.split(';')[0].trim().toLowerCase() === 'application/pdf' || metadata?.pdfEmbed ||
      (!metadata?.contentType && /\.pdf$/i.test(url.pathname));
    if (isPdf) {
      readerSourceUrl = url.href;
      showPageNotice('ابزارهای راستین در نمایشگر PDF داخلی مرورگر اجرا نمی‌شود. با دکمهٔ «باز کردن فایل در راستین» همین PDF را در نمایشگر راستین باز کنید؛ اگر دسترسی مستقیم ممکن نبود، فایل دانلودشده را انتخاب کنید.');
      return false;
    }
    showPageNotice(metadata?.ok ? (url.protocol === 'file:' ? 'تنظیمات این بخش روی فایل‌های HTML محلی اعمال می‌شود.' : '') :
      'برای اجرای ابزارها، این صفحه را یک‌بار تازه‌سازی کنید.');
    return true;
  }

  // Load active tab info and extension configuration with high performance.
  globalToggle.disabled = true;
  toggleSubSettingsState(false);
  for (const button of [elementPickerBtn, openPaintBtn, elementRestoreBtn, quickPaint, quickTranslate]) button.disabled = true;
  getActiveTab().then(async activeTab => {
    const tabs = activeTab ? [activeTab] : [];
    if (tabs && tabs[0]) {
      activeTabId = tabs[0].id;
      activeTabUrl = tabs[0].url || '';
      try {
        const url = new URL(tabs[0].url);
        currentHost = url.hostname;
        siteConfigKey = getSiteConfigKey(url);
        domainScopeLabel.textContent = isOwnReader(url) ? 'فعال‌سازی ابزارهای نمایشگر' :
          url.protocol === 'file:' ? 'فعال‌سازی روی فایل‌های محلی' : 'فعال‌سازی روی این سایت';
        domainNameLabel.textContent = isOwnReader(url) ? 'نمایشگر فایل راستین' : url.protocol === 'file:' ? 'فایل‌های HTML محلی' : currentHost;
        pageSupported = await checkPageAccess(url);
        if (!siteConfigKey) domainNameLabel.textContent = url.protocol === 'chrome-extension:' ? 'صفحهٔ یک افزونه' : 'صفحهٔ داخلی مرورگر';
        if (!pageSupported) {
          domainLogoImg.style.display = 'none';
        } else {
          // Instant local favicon from tab memory; fallback to Google Favicon without blocking
          if (tabs[0].favIconUrl && !tabs[0].favIconUrl.startsWith('chrome://')) {
            domainLogoImg.src = tabs[0].favIconUrl;
            domainLogoImg.style.display = 'block';
          } else {
            domainLogoImg.src = '../icons/icon.svg';
            domainLogoImg.style.display = 'block';
          }
        }
      } catch (e) {
        domainNameLabel.textContent = 'صفحه نامعتبر';
        domainLogoImg.style.display = 'none';
        showPageNotice('نشانی این صفحه قابل دسترسی نیست.');
      }
    } else {
      domainNameLabel.textContent = 'صفحه‌ای انتخاب نشده است';
      showPageNotice('یک صفحهٔ وب یا فایل HTML را باز کنید.');
    }
    
    // Targeted storage query: only fetch specific config keys instead of multi-megabyte cache!
    const hostKey = siteConfigKey;
    const keysToFetch = [...GLOBAL_CONFIG_KEYS];
    if (hostKey) keysToFetch.push(hostKey);
    if (hostKey === 'site_config_file://') keysToFetch.push('site_config_');

    chrome.storage.local.get(keysToFetch, (items) => {
      if (!items) items = {};
      // 1. Load globalConfig
      GLOBAL_CONFIG_KEYS.forEach(k => {
        if (items[k] !== undefined) {
          globalConfig[k] = items[k];
        }
      });

      // 2. Load siteConfig
      let siteConfig = { ...defaultSiteConfig };
      const savedSite = items[hostKey] ?? (hostKey === 'site_config_file://' ? items.site_config_ : undefined);
      if (hostKey && savedSite) {
        siteConfig = { ...siteConfig, ...savedSite };
      }

      // 3. Merge them into the main config object
      config = {
        ...siteConfig,
        enabled: globalConfig.enabled,
        adBlockCosmetic: globalConfig.adBlockCosmetic,
        adBlockGapRemover: globalConfig.adBlockGapRemover,
        apiKeys: globalConfig.apiKeys,
        translatorApi: globalConfig.translatorApi,
        siteEnabled: siteConfig.enabled,
        disabledAdBlockDomains: globalConfig.disabledAdBlockDomains || []
      };

      settingsLoaded = true;
      updateUI();
    });
  });

  // Update UI inputs with current config values
  function updateUI() {
    globalToggle.disabled = !settingsLoaded;
    globalToggle.checked = config.enabled;
    
    // Domain active check
    domainToggle.checked = pageSupported && config.siteEnabled;
    
    setActiveSegment('alignment-mode-group', config.alignmentMode);
    inputsAutoToggle.checked = config.inputsAutoDir;
    rightAlignToggle.checked = config.forceRightAlign;
    justifyToggle.checked = config.justifyText;
    tablesToggle.checked = config.fixTables;
    
    setActiveSegment('font-family-group', config.fontFamily);
    if (config.fontFamily === 'Custom') {
      customFontWrapper.classList.remove('hidden');
    } else {
      customFontWrapper.classList.add('hidden');
    }
    customFontNameInput.value = config.customFontName || '';
    customFontUrlInput.value = config.customFontUrl || '';
    setActiveSegment('font-weight-group', config.fontWeight);
    
    fontSizeAdjustInput.value = config.fontSizeAdjust;
    const sizeVal = config.fontSizeAdjust;
    fontSizeValLabel.textContent = sizeVal === 0 ? 'پیش‌فرض' : `${toPersianDigits(sizeVal)} پیکسل`;
    
    lineHeightAdjustInput.value = config.lineHeightAdjust;
    lineHeightValLabel.textContent = toPersianDigits(config.lineHeightAdjust.toFixed(1));

    persianDigitsToggle.checked = config.persianDigits;
    listsBlockquoteToggle.checked = config.fixListsBlockquotes;
    adBlockToggle.checked = config.adBlockEnabled;
    adBlockCosmeticToggle.checked = config.adBlockCosmetic;
    if (adBlockGapRemoverToggle) {
      adBlockGapRemoverToggle.checked = config.adBlockGapRemover;
    }
    techCodeToggle.checked = config.techCodeProtection;
    readingRulerToggle.checked = config.readingRulerEnabled && config.readingRulerFocus;
      
    focusCoachToggle.checked = config.focusCoachEnabled || false;
    readingProgressToggle.checked = config.readingProgressEnabled || false;
    bionicTextToggle.checked = config.bionicTextEnabled || false;
    allowCopyToggle.checked = config.allowCopyEnabled || false;
    translatorToggle.checked = config.translatorEnabled || false;
    translatorApiSelect.value = config.translatorApi || 'auto';
    translatorSubSettings.style.display = config.translatorEnabled ? 'flex' : 'none';
    highlightToggle.checked = config.highlightEnabled || false;
    
    if (config.apiKeys) {
      keyPollinations.value = deobfuscate(config.apiKeys.pollinations || '');
    }

    // Lazy render highlights only when the accordion is opened to avoid blocking initial popup render
    const highlightsDetails = highlightToggle ? highlightToggle.closest('details') : null;
    if (highlightsDetails) {
      if (highlightsDetails.open) {
        renderHighlights();
      } else if (!highlightsDetails._lazyInit) {
        highlightsDetails._lazyInit = true;
        highlightsDetails.addEventListener('toggle', () => {
          if (highlightsDetails.open) {
            renderHighlights();
          }
        });
      }
    }

    // Enable/disable sub-settings based on global toggle
    toggleSubSettingsState(config.enabled);

    elementPickerBtn.disabled = !config.enabled || !pageSupported;
    openPaintBtn.disabled = !config.enabled || !pageSupported || !activeTabId;
    elementRestoreBtn.disabled = !config.enabled || !pageSupported;
    quickPaint.disabled = openPaintBtn.disabled;
    quickTranslate.disabled = openPaintBtn.disabled;
    quickNotes.disabled = false;
  }

  // Toggle settings state if globally disabled
  function toggleSubSettingsState(isEnabled) {
    const controls = [
      domainToggle, inputsAutoToggle, rightAlignToggle, justifyToggle, tablesToggle,
      customFontNameInput, customFontUrlInput,
      fontSizeAdjustInput, lineHeightAdjustInput, persianDigitsToggle, listsBlockquoteToggle,
      adBlockToggle, techCodeToggle, bionicTextToggle, allowCopyToggle, translatorToggle,
      readingRulerToggle, focusCoachToggle, readingProgressToggle, highlightToggle
    ];
    
    controls.forEach(ctrl => {
      if (ctrl) ctrl.disabled = !isEnabled || !pageSupported;
    });
    for (const ctrl of [adBlockCosmeticToggle, adBlockGapRemoverToggle, translatorApiSelect, keyPollinations]) {
      if (ctrl) ctrl.disabled = !isEnabled;
    }

    // Disable segment buttons
    const segmentButtons = document.querySelectorAll('.segment-btn');
    segmentButtons.forEach(btn => {
      const isSavedHighlightFilter = Boolean(btn.closest('#highlight-filter-group'));
      btn.disabled = !isSavedHighlightFilter && (!isEnabled || !pageSupported);
      if (!btn.disabled) {
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
      } else {
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      }
    });

    const panels = document.querySelectorAll('.accordion-panel');
    panels.forEach(panel => {
      panel.style.opacity = panel.dataset.section === 'highlights' || (isEnabled && pageSupported) ? '1' : '0.6';
      // Keep summaries and the saved highlights dashboard reachable. Only
      // controls that operate on the unavailable page are disabled.
      panel.style.pointerEvents = 'auto';
    });

    const domainCard = document.querySelector('.domain-card');
    if (domainCard) {
      if (isEnabled) {
        domainCard.style.opacity = '1';
        domainCard.style.pointerEvents = 'auto';
      } else {
        domainCard.style.opacity = '0.4';
        domainCard.style.pointerEvents = 'none';
      }
    }
  }

  // Debounced save helper
  let saveConfigTimeout = null;
  function saveConfigDebounced() {
    if (saveConfigTimeout) clearTimeout(saveConfigTimeout);
    saveConfigTimeout = setTimeout(() => {
      saveConfig();
    }, 150); // 150ms debounce
  }

  // Save config to storage and notify tabs
  function saveConfig() {
    if (!settingsLoaded) return;
    const isGlobalEnabled = globalToggle.checked;
    const isAdBlockCosmetic = adBlockCosmeticToggle.checked;
    const isAdBlockGapRemover = adBlockGapRemoverToggle ? adBlockGapRemoverToggle.checked : true;
    const transApi = translatorApiSelect.value;
    const pollinationsKey = obfuscate(keyPollinations.value.trim());

    let disabledAdBlockDomains = globalConfig.disabledAdBlockDomains || [];

    const dataToSave = {
      enabled: isGlobalEnabled,
      adBlockEnabled: globalConfig.adBlockEnabled,
      adBlockCosmetic: isAdBlockCosmetic,
      adBlockGapRemover: isAdBlockGapRemover,
      translatorApi: transApi,
      apiKeys: {
        pollinations: pollinationsKey
      }
    };

    if (siteConfigKey && pageSupported) {
      const cleanHost = siteConfigKey === 'site_config_reader' ? '' : currentHost.toLowerCase().replace(/^www\./, '');
      const hostKey = siteConfigKey;

      const isSiteEnabled = domainToggle.checked;
      const isSiteAdBlockEnabled = adBlockToggle.checked;

      const siteConfig = {
        enabled: isSiteEnabled,
        alignmentMode: config.alignmentMode,
        inputsAutoDir: inputsAutoToggle.checked,
        forceRightAlign: rightAlignToggle.checked,
        justifyText: justifyToggle.checked,
        fontFamily: config.fontFamily,
        customFontName: customFontNameInput.value,
        customFontUrl: customFontUrlInput.value,
        fontWeight: config.fontWeight,
        fontSizeAdjust: parseInt(fontSizeAdjustInput.value) || 0,
        lineHeightAdjust: parseFloat(lineHeightAdjustInput.value) || 1.6,
        persianDigits: persianDigitsToggle.checked,
        fixListsBlockquotes: listsBlockquoteToggle.checked,
        fixTables: tablesToggle.checked,
        techCodeProtection: techCodeToggle.checked,
        readingRulerEnabled: readingRulerToggle.checked,
        readingRulerFocus: readingRulerToggle.checked,
        focusCoachEnabled: focusCoachToggle.checked,
        readingProgressEnabled: readingProgressToggle.checked,
        bionicTextEnabled: bionicTextToggle.checked,
        allowCopyEnabled: allowCopyToggle.checked,
        translatorEnabled: translatorToggle.checked,
        highlightEnabled: highlightToggle.checked,
        adBlockEnabled: isSiteAdBlockEnabled,
        batteryPositionX: config.batteryPositionX || '20px',
        batteryPositionY: config.batteryPositionY || '15px',
        highlightColor: config.highlightColor || 'yellow'
      };

      dataToSave[hostKey] = siteConfig;

      const idx = disabledAdBlockDomains.indexOf(cleanHost);
      if (cleanHost && !isSiteAdBlockEnabled) {
        if (idx === -1) {
          disabledAdBlockDomains.push(cleanHost);
        }
      } else if (cleanHost) {
        if (idx > -1) {
          disabledAdBlockDomains.splice(idx, 1);
        }
      }
      
      globalConfig.disabledAdBlockDomains = disabledAdBlockDomains;
      config.siteEnabled = isSiteEnabled;
    }

    dataToSave.disabledAdBlockDomains = disabledAdBlockDomains;

    chrome.storage.local.set(dataToSave, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url) {
            try {
              const tabUrl = new URL(tab.url);
              const tabHostKey = getSiteConfigKey(tabUrl);
              if (!tabHostKey) return;
              const tabKeys = tabUrl.protocol === 'file:' ? [tabHostKey, 'site_config_'] : [tabHostKey];
              
              chrome.storage.local.get(tabKeys, (res) => {
                const tabSiteConfig = res[tabHostKey] ?? (tabUrl.protocol === 'file:' ? res.site_config_ : undefined) ?? defaultSiteConfig;
                const mergedSettings = {
                  ...tabSiteConfig,
                  globalEnabled: isGlobalEnabled,
                  globalAdBlockEnabled: globalConfig.adBlockEnabled,
                  adBlockCosmetic: isAdBlockCosmetic,
                  adBlockGapRemover: isAdBlockGapRemover,
                  apiKeys: { pollinations: pollinationsKey },
                  translatorApi: transApi,
                  disabledAdBlockDomains: disabledAdBlockDomains
                };

                sendToPage(tab.id, {
                  action: 'updateSettings',
                  settings: mergedSettings
                }, tab.url).catch(() => {});
              });
            } catch (_) {}
          }
        });
      });
    });
  }

  // Event Listeners
  globalToggle.addEventListener('change', (e) => {
    config.enabled = e.target.checked;
    updateUI();
    saveConfig();
  });

  domainToggle.addEventListener('change', (e) => {
    saveConfig();
  });

  // Segment listener setups
  setupSegmentListener('alignment-mode-group', 'alignmentMode');
  setupSegmentListener('font-family-group', 'fontFamily', (val) => {
    if (val === 'Custom') {
      customFontWrapper.classList.remove('hidden');
    } else {
      customFontWrapper.classList.add('hidden');
    }
  });
  setupSegmentListener('font-weight-group', 'fontWeight');

  inputsAutoToggle.addEventListener('change', (e) => {
    config.inputsAutoDir = e.target.checked;
    saveConfig();
  });

  rightAlignToggle.addEventListener('change', (e) => {
    config.forceRightAlign = e.target.checked;
    saveConfig();
  });

  justifyToggle.addEventListener('change', (e) => {
    config.justifyText = e.target.checked;
    saveConfig();
  });

  tablesToggle.addEventListener('change', (e) => {
    config.fixTables = e.target.checked;
    saveConfig();
  });

  customFontNameInput.addEventListener('input', (e) => {
    config.customFontName = e.target.value.trim();
    saveConfigDebounced();
  });

  customFontUrlInput.addEventListener('input', (e) => {
    config.customFontUrl = e.target.value.trim();
    saveConfigDebounced();
  });

  fontSizeAdjustInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    config.fontSizeAdjust = val;
    fontSizeValLabel.textContent = val === 0 ? 'پیش‌فرض' : `${toPersianDigits(val)} پیکسل`;
    saveConfigDebounced();
  });

  lineHeightAdjustInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    config.lineHeightAdjust = val;
    lineHeightValLabel.textContent = toPersianDigits(val.toFixed(1));
    saveConfigDebounced();
  });

  persianDigitsToggle.addEventListener('change', (e) => {
    config.persianDigits = e.target.checked;
    saveConfig();
  });

  listsBlockquoteToggle.addEventListener('change', (e) => {
    config.fixListsBlockquotes = e.target.checked;
    saveConfig();
  });

  adBlockToggle.addEventListener('change', (e) => {
    config.adBlockEnabled = e.target.checked;
    saveConfig();
  });

  adBlockCosmeticToggle.addEventListener('change', (e) => {
    config.adBlockCosmetic = e.target.checked;
    saveConfig();
  });

  if (adBlockGapRemoverToggle) {
    adBlockGapRemoverToggle.addEventListener('change', (e) => {
      config.adBlockGapRemover = e.target.checked;
      saveConfig();
    });
  }

  techCodeToggle.addEventListener('change', (e) => {
    config.techCodeProtection = e.target.checked;
    saveConfig();
  });

  elementPickerBtn.addEventListener('click', () => {
    if (!activeTabId) return;
    
    // Close the popup window
    window.close();
    
    // Send a message to the active tab to start element picker
    sendToPage(activeTabId, { action: 'startElementPicker' }).catch((err) => {
      console.warn('[Rastin RTL] Error starting element picker in tab:', err);
    });
  });

  openPaintBtn.addEventListener('click', async () => {
    if (!activeTabId) return;
    openPaintBtn.disabled = true;
    paintLaunchStatus.textContent = 'در حال بازکردن ابزار…';
    try {
      const result = await sendToPage(activeTabId, { action: 'openPaint' });
      if (!result?.ok) throw new Error(result?.error || 'بازکردن ابزار ناموفق بود.');
      window.close();
    } catch (error) {
      paintLaunchStatus.textContent = error.message.includes('Receiving end') || error.message.includes('Could not establish')
        ? 'ابتدا صفحه را تازه‌سازی کنید. ابزار روی صفحات داخلی مرورگر و فروشگاه افزونه‌ها قابل اجرا نیست.'
        : error.message;
      openPaintBtn.disabled = false;
    }
  });

  elementRestoreBtn.addEventListener('click', () => {
    if (!pageSupported) return;
    
    if (confirm('آیا مطمئن هستید که می‌خواهید تمام المان‌های مسدود شده در این سایت را برگردانید؟')) {
      chrome.storage.local.get({ customRules: {} }, (items) => {
        const customRules = items.customRules;
        if (customRules[currentHost]) {
          delete customRules[currentHost];
          chrome.storage.local.set({ customRules }, () => {
            config.customRules = customRules;
            
            // Reload the active tab to apply the changes (remove the CSS)
            if (activeTabId) {
              chrome.tabs.reload(activeTabId);
              window.close();
            }
          });
        }
      });
    }
  });

  readingRulerToggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    config.readingRulerEnabled = isEnabled;
    config.readingRulerFocus = isEnabled;
    saveConfig();
  });

  focusCoachToggle.addEventListener('change', (e) => {
    config.focusCoachEnabled = e.target.checked;
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  readingProgressToggle.addEventListener('change', (e) => {
    config.readingProgressEnabled = e.target.checked;
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  bionicTextToggle.addEventListener('change', (e) => {
    config.bionicTextEnabled = e.target.checked;
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  allowCopyToggle.addEventListener('change', (e) => {
    config.allowCopyEnabled = e.target.checked;
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  translatorToggle.addEventListener('change', (e) => {
    config.translatorEnabled = e.target.checked;
    translatorSubSettings.style.display = e.target.checked ? 'flex' : 'none';
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  translatorApiSelect.addEventListener('change', (e) => {
    config.translatorApi = e.target.value;
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  });

  const saveApiKey = (keyName, value) => {
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[keyName] = obfuscate(value);
    saveConfig();
    if (activeTabId) chrome.tabs.reload(activeTabId);
  };

  keyPollinations.addEventListener('change', (e) => saveApiKey('pollinations', e.target.value));

  // ─── Highlights & Notes Dashboard Logic ────────────────────────────────────
  let currentFilter = 'tab'; // 'tab' or 'all'
  let searchQuery = '';

  const storage = {
    get: function (keys, callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime.lastError) {
            storage.fallbackGet(keys, callback);
          } else {
            callback(res);
          }
        });
      } else {
        storage.fallbackGet(keys, callback);
      }
    },
    fallbackGet: function (keys, callback) {
      const result = {};
      if (Array.isArray(keys)) {
        keys.forEach(k => {
          try {
            const val = localStorage.getItem(k);
            result[k] = val ? JSON.parse(val) : null;
          } catch (_) {
            result[k] = null;
          }
        });
      } else if (typeof keys === 'object' && keys !== null) {
        Object.keys(keys).forEach(k => {
          try {
            const val = localStorage.getItem(k);
            result[k] = val ? JSON.parse(val) : keys[k];
          } catch (_) {
            result[k] = keys[k];
          }
        });
      } else {
        const k = keys;
        try {
          const val = localStorage.getItem(k);
          result[k] = val ? JSON.parse(val) : null;
        } catch (_) {
          result[k] = null;
        }
      }
      callback(result);
    },
    set: function (items, callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) {
            storage.fallbackSet(items, callback);
          } else if (callback) {
            callback();
          }
        });
      } else {
        storage.fallbackSet(items, callback);
      }
    },
    fallbackSet: function (items, callback) {
      Object.keys(items).forEach(k => {
        try {
          localStorage.setItem(k, JSON.stringify(items[k]));
        } catch (_) {}
      });
      if (callback) callback();
    },
    getAll: function (callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(null, (res) => {
          if (chrome.runtime.lastError) {
            storage.fallbackGetAll(callback);
          } else {
            callback(res);
          }
        });
      } else {
        storage.fallbackGetAll(callback);
      }
    },
    fallbackGetAll: function (callback) {
      const result = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try {
          result[k] = JSON.parse(localStorage.getItem(k));
        } catch (_) {
          result[k] = localStorage.getItem(k);
        }
      }
      callback(result);
    }
  };

  const highlightIconPaths = {
    show: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z',
    copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
    delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    check: 'M5 12l4 4L19 6',
    bookmark: 'M6 3h12v18l-6-4-6 4z'
  };
  function highlightIcon(name) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + highlightIconPaths[name] + '"/></svg>';
  }
  function setHighlightAction(button, label, icon) {
    button.innerHTML = highlightIcon(icon);
    const caption = document.createElement('span'); caption.textContent = label;
    button.appendChild(caption);
  }

  let highlightSnapshot = null;
  let highlightBuckets = null;
  let highlightSnapshotLoad = null;
  let highlightStorageVersion = 0;
  let highlightRenderVersion = 0;
  let highlightSearchTimer = null;
  let highlightRefreshTimer = null;

  function readHighlightStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, items => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || 'Highlight storage unavailable'));
        else resolve(items || {});
      });
    });
  }

  async function loadHighlightSnapshot() {
    // Share one read across searches, filters and exports. Storage changes
    // invalidate it; a late read must never replace a newer saved snapshot.
    while (true) {
      const version = highlightStorageVersion;
      const items = await readHighlightStorage();
      const keys = Object.keys(items).filter(key => key.startsWith('rtl_fixer_hl_'));
      for (const key of keys) {
        if (!Array.isArray(items[key]) || items[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
          throw new Error('Invalid highlight data; original preserved');
        }
      }
      // Canonical buckets with IDs are read-only. Migrating every host on
      // every keystroke otherwise monopolizes the worker's shared write queue.
      const migrationKeys = [...new Set(keys.filter(key =>
        key.startsWith('rtl_fixer_hl_www.') || items[key].some(item => !item.id)
      ).map(key => key.replace(/^rtl_fixer_hl_www\./, 'rtl_fixer_hl_')))];
      if (migrationKeys.length) {
        const results = await Promise.all(migrationKeys.map(key => chrome.runtime.sendMessage({
          action: 'mutateHighlights', key, operation: { type: 'migrate' }
        })));
        const failure = results.find(result => !result?.ok);
        if (failure || results.some(result => !Array.isArray(result?.items))) {
          throw new Error(failure?.error || 'Highlight migration failed');
        }
        // Re-read after the worker persisted stable IDs and merged www data.
        // Another tab may have edited a note while migration was queued.
        continue;
      }
      if (version !== highlightStorageVersion) continue;
      highlightBuckets = new Map(keys.map(key => [key, items[key]]));
      highlightSnapshot = [...highlightBuckets.values()].flat();
      return highlightSnapshot;
    }
  }

  function applyHighlightStorageChanges(changes) {
    highlightStorageVersion++;
    if (!highlightBuckets) { highlightSnapshot = null; return; }
    const buckets = new Map(highlightBuckets);
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('rtl_fixer_hl_')) continue;
      const records = change.newValue;
      if (records === undefined) { buckets.delete(key); continue; }
      if (key.startsWith('rtl_fixer_hl_www.') || !Array.isArray(records) ||
          records.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !item.id)) {
        // Newly imported legacy or malformed data needs the guarded read path.
        highlightBuckets = null;
        highlightSnapshot = null;
        return;
      }
      buckets.set(key, records);
    }
    highlightBuckets = buckets;
    highlightSnapshot = [...buckets.values()].flat();
  }

  function getAllHighlights(callback) {
    if (highlightSnapshot) {
      callback([...highlightSnapshot]);
      return;
    }
    if (!highlightSnapshotLoad) {
      highlightSnapshotLoad = loadHighlightSnapshot().finally(() => { highlightSnapshotLoad = null; });
    }
    highlightSnapshotLoad.then(list => callback([...list])).catch(error => {
      console.error('[Rastin RTL] Failed to read highlights:', error);
      if (highlightsList) highlightsList.textContent = 'خواندن هایلایت‌ها ناموفق بود؛ اطلاعات قبلی حذف نشده است.';
    });
  }

  function renderHighlights() {
    if (!highlightsList) return;
    const currentVersion = ++highlightRenderVersion;
    
    const filterGroup = document.getElementById('highlight-filter-group');
    const segmentBtns = filterGroup ? filterGroup.querySelectorAll('.segment-btn') : [];

    // Saved notes remain readable even when selection highlighting is switched off.
    if (btnExportJson) btnExportJson.disabled = false;
    if (btnExportPdf) btnExportPdf.disabled = false;

    if (highlightSearch) highlightSearch.disabled = false;
    segmentBtns.forEach(btn => btn.disabled = false);

    getAllHighlights((list) => {
      if (currentVersion !== highlightRenderVersion) return;
      // Filter by site (domain)
      if (currentFilter === 'tab' && activeTabUrl.startsWith('file:')) {
        list = list.filter(h => {
          try { return new URL(h.url).protocol === 'file:'; } catch (_) { return false; }
        });
      } else if (currentFilter === 'tab' && currentHost) {
        let aHost = currentHost.toLowerCase().replace(/^www\./, '');
        list = list.filter(h => {
          if (!h.url) return false;
          try {
            let hHost = new URL(h.url).hostname.toLowerCase().replace(/^www\./, '');
            return hHost === aHost || hHost.endsWith('.' + aHost) || aHost.endsWith('.' + hHost);
          } catch(e) {
            return h.url.toLowerCase().includes(aHost);
          }
        });
      }
      
      // Filter by search query
      if (searchQuery) {
        const q = normalizeSearch(searchQuery);
        list = list.filter(h => 
          normalizeSearch(String(h.text || '')).includes(q) ||
          normalizeSearch(String(h.note?.text || '')).includes(q)
        );
      }
      
      // Sort by timestamp descending
      list.sort((a, b) => b.timestamp - a.timestamp);
      
      highlightsList.innerHTML = '';
      if (highlightsCount) highlightsCount.textContent = list.length.toLocaleString('fa-IR') + ' مورد';
      
      if (list.length === 0) {
        highlightsList.innerHTML = '<div class="no-highlights">' + highlightIcon('bookmark') + '<span>هایلایتی پیدا نشد.</span><small>متن صفحه را ذخیره کنید یا فیلتر را تغییر دهید.</small></div>';
        return;
      }
      
      list.forEach(hl => {
        try {
          let colorClass = 'yellow';
          const c = (hl.color || '#fef08a').toLowerCase();
          if (c === '#fef08a' || c === 'yellow') colorClass = 'yellow';
          else if (c === '#bbf7d0' || c === 'green') colorClass = 'green';
          else if (c === '#fecaca' || c === '#fecdd3' || c === 'red' || c === 'pink') colorClass = 'red';
          else if (c === '#bfdbfe' || c === 'blue') colorClass = 'blue';
          else if (c === '#e9d5ff' || c === 'purple') colorClass = 'purple';

          const card = document.createElement('div');
          card.className = 'highlight-card ' + colorClass;
          card.setAttribute('data-id', hl.id || '');
          
          const header = document.createElement('div');
          header.className = 'highlight-card-header';
          
          const source = document.createElement('div');
          source.className = 'highlight-card-source';
          
          const dot = document.createElement('span');
          dot.className = `highlight-card-dot ${colorClass}`;
          source.appendChild(dot);
          
          const domainSpan = document.createElement('span');
          domainSpan.className = 'highlight-card-domain';
          domainSpan.setAttribute('dir', 'auto');
          try {
            if (hl.url) {
              const u = new URL(hl.url);
              domainSpan.textContent = u.protocol === 'file:' ? 'فایل محلی' : u.hostname;
            } else {
              domainSpan.textContent = hl.title || 'صفحه وب';
            }
          } catch(_) {
            domainSpan.textContent = hl.title || 'صفحه وب';
          }
          domainSpan.title = domainSpan.textContent;
          source.appendChild(domainSpan);
          header.appendChild(source);
          
          const timeSpan = document.createElement('span');
          timeSpan.className = 'highlight-card-time';
          
          let dateStr = 'تاریخ نامشخص';
          if (hl.timestamp) {
            try {
              dateStr = new Date(hl.timestamp).toLocaleDateString('fa-IR', {
                hour: '2-digit',
                minute: '2-digit'
              });
            } catch (de) {
              console.warn('[Rastin RTL] Date format error:', de);
            }
          }
          timeSpan.textContent = dateStr;
          header.appendChild(timeSpan);
          card.appendChild(header);
          
          const text = document.createElement('div');
          text.className = `highlight-card-text ${colorClass}`;
          text.setAttribute('dir', 'auto');
          text.title = hl.text || '';
          text.textContent = hl.text || '';
          card.appendChild(text);
          
          if (hl.note && hl.note.text && hl.note.text.trim()) {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'highlight-card-note';
            noteDiv.setAttribute('dir', 'auto');
            noteDiv.title = hl.note.text;
            noteDiv.textContent = hl.note.text;
            card.appendChild(noteDiv);
          }
          
          const footer = document.createElement('div');
          footer.className = 'highlight-card-footer';
          
          const actions = document.createElement('div');
          actions.className = 'highlight-card-actions';
          
          // Show button
          const showBtn = document.createElement('button');
          showBtn.type = 'button';
          showBtn.className = 'highlight-card-btn is-show';
          setHighlightAction(showBtn, 'نمایش', 'show');
          showBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            scrollToHighlight(hl);
          });
          actions.appendChild(showBtn);
          
          // Copy button
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'highlight-card-btn is-copy';
          setHighlightAction(copyBtn, 'کپی', 'copy');
          copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (hl.text) {
              try {
                await navigator.clipboard.writeText(hl.text);
                setHighlightAction(copyBtn, 'کپی شد', 'check');
              } catch {
                setHighlightAction(copyBtn, 'کپی نشد', 'copy');
              }
              setTimeout(() => { setHighlightAction(copyBtn, 'کپی', 'copy'); }, 1500);
            }
          });
          actions.appendChild(copyBtn);
          
          // Delete button
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'highlight-card-btn is-delete';
          setHighlightAction(delBtn, 'حذف', 'delete');
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('آیا مطمئن هستید که می‌خواهید این هایلایت را حذف کنید؟')) {
              deleteHighlight(hl.id);
            }
          });
          actions.appendChild(delBtn);
          
          footer.appendChild(actions);
          card.appendChild(footer);
          
          card.addEventListener('click', () => {
            scrollToHighlight(hl);
          });
          
          highlightsList.appendChild(card);
        } catch (cardErr) {
          console.error('[Rastin RTL] Error rendering individual card:', cardErr, hl);
        }
      });
    });
  }

  function scrollToHighlight(hl) {
    if (!hl.id || !hl.url) {
      quickStatus.textContent = 'نشانی این هایلایت ذخیره نشده است.';
      return;
    }
    chrome.runtime.sendMessage({ action: 'openSavedHighlight', id: hl.id, url: hl.url, pageKey: hl.pageKey })
      .then(result => { if (!result?.ok) throw new Error(result?.error || 'Navigation failed'); })
      .catch(() => { quickStatus.textContent = 'بازکردن صفحهٔ هایلایت ناموفق بود. دوباره تلاش کنید.'; });
  }

  function deleteHighlight(id) {
    storage.getAll((items) => {
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('rtl_fixer_hl_') && Array.isArray(value)) {
          const filtered = value.filter(h => h.id !== id);
          if (filtered.length !== value.length) {
            chrome.runtime.sendMessage({ action: 'mutateHighlights', key: key.replace(/^rtl_fixer_hl_www\./, 'rtl_fixer_hl_'), operation: { type: 'remove', id } })
              .then(result => {
                if (!result?.ok) throw new Error(result?.error || 'Storage failed');
                renderHighlights();
              }).catch(() => alert('حذف هایلایت ذخیره نشد. دوباره تلاش کنید.'));
            break;
          }
        }
      }
    });
  }

  function exportJSON() {
    getAllHighlights((list) => {
      const dataStr = JSON.stringify(list, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', 'rastin-highlights.json');
      linkElement.click();
    });
  }

  function exportPDF() {
    getAllHighlights((list) => {
      if (list.length === 0) {
        alert('هیچ هایلایتی برای چاپ وجود ندارد.');
        return;
      }
      
      const groups = {};
      list.forEach(hl => {
        const key = hl.url;
        if (!groups[key]) {
          groups[key] = {
            title: hl.title || hl.url,
            url: hl.url,
            items: []
          };
        }
        groups[key].items.push(hl);
      });
      
      let html = '<!DOCTYPE html>';
      html += '<html lang="fa" dir="rtl">';
      html += '<head>';
      html += '<meta charset="UTF-8">';
      html += '<title>گزارش هایلایت‌ها و یادداشت‌های افزونه راستین</title>';
      html += '<style>';
      html += '@import url(\'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&family=Caveat:wght@400;700&display=swap\');';
      html += 'body { font-family: \'Vazirmatn\', sans-serif; color: #1e293b; padding: 40px; max-width: 800px; margin: 0 auto; background-color: #ffffff; }';
      html += 'h1 { text-align: center; border-bottom: 3px double #e2e8f0; padding-bottom: 12px; margin-bottom: 30px; font-size: 24px; }';
      html += '.group { margin-bottom: 30px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; page-break-inside: avoid; }';
      html += '.group-title { font-size: 16px; font-weight: bold; margin: 0 0 8px 0; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }';
      html += '.group-url { font-size: 12px; color: #64748b; word-break: break-all; display: block; margin-bottom: 16px; direction: ltr; text-align: left; }';
      html += '.item { margin-bottom: 16px; border-bottom: 1px dashed #f1f5f9; padding-bottom: 12px; }';
      html += '.item:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }';
      html += '.item-text { font-size: 14px; line-height: 1.6; padding: 8px 12px; border-right: 4px solid #cbd5e1; background-color: #f8fafc; margin-bottom: 8px; border-radius: 0 4px 4px 0; }';
      html += '.item-text.yellow { border-color: #eab308; background-color: #fefdf0; }';
      html += '.item-text.green { border-color: #22c55e; background-color: #f6fff9; }';
      html += '.item-text.red { border-color: #ef4444; background-color: #fff7f7; }';
      html += '.item-text.blue { border-color: #3b82f6; background-color: #f7faff; }';
      html += '.item-text.purple { border-color: #a855f7; background-color: #fdfbff; }';
      html += '.item-note { font-family: \'Caveat\', cursive, sans-serif; font-size: 18px; background-color: #fffef0; border: 1px dashed #eab308; padding: 10px 14px; border-radius: 4px; margin-top: 8px; margin-bottom: 4px; }';
      html += '.item-meta { font-size: 11px; color: #94a3b8; text-align: left; margin-top: 4px; }';
      html += '@media print { body { padding: 0; } .group { border: none; padding: 0; } }';
      html += '</style>';
      html += '</head>';
      html += '<body>';
      html += '<h1>📋 گزارش هایلایت‌ها و یادداشت‌های افزونه راستین</h1>';
      
      for (const g of Object.values(groups)) {
        html += '<div class="group">';
        html += '<h2 class="group-title">' + g.title + '</h2>';
        html += '<a href="' + g.url + '" target="_blank" class="group-url">' + g.url + '</a>';
        html += '<div class="group-items">';
        for (const item of g.items) {
          let itemColorClass = 'yellow';
          const c = (item.color || '#fef08a').toLowerCase();
          if (c === '#fef08a' || c === 'yellow') itemColorClass = 'yellow';
          else if (c === '#bbf7d0' || c === 'green') itemColorClass = 'green';
          else if (c === '#fecdd3' || c === 'red' || c === 'pink') itemColorClass = 'red';
          else if (c === '#bfdbfe' || c === 'blue') itemColorClass = 'blue';
          else if (c === '#e9d5ff' || c === 'purple') itemColorClass = 'purple';

          html += '<div class="item">';
          html += '<div class="item-text ' + itemColorClass + '">' + item.text + '</div>';
          if (item.note && item.note.text) {
            html += '<div class="item-note">📌 یادداشت: ' + item.note.text + '</div>';
          }
          html += '<div class="item-meta">' + new Date(item.timestamp).toLocaleString('fa-IR') + '</div>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      
      html += '<script>window.onload = function() { window.print(); }</script></body></html>';
      
      const newWin = window.open();
      newWin.document.write(html);
      newWin.document.close();
    });
  }

  // Bind Highlights Listeners
  if (highlightToggle) {
    highlightToggle.addEventListener('change', (e) => {
      config.highlightEnabled = e.target.checked;
      saveConfig();
    });
  }

  if (highlightSearch) {
    highlightSearch.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearTimeout(highlightSearchTimer);
      highlightSearchTimer = setTimeout(renderHighlights, 100);
    });
  }

  if (highlightFilterGroup) {
    highlightFilterGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn) return;
      currentFilter = btn.getAttribute('data-value');
      
      // Update segment UI
      highlightFilterGroup.querySelectorAll('.segment-btn').forEach(b => {
        if (b === btn) b.classList.add('active');
        else b.classList.remove('active');
      });
      
      renderHighlights();
    });
  }

  if (btnExportJson) {
    btnExportJson.addEventListener('click', exportJSON);
  }

  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', exportPDF);
  }

  const clearAllHighlightsBtn = document.getElementById('clear-all-highlights-btn');
  if (clearAllHighlightsBtn) {
    clearAllHighlightsBtn.addEventListener('click', () => {
      if (confirm('آیا مطمئن هستید که می‌خواهید تمام هایلایت‌ها و یادداشت‌ها در تمامی سایت‌ها را به صورت کامل پاکسازی کنید؟')) {
        chrome.runtime.sendMessage({ action: 'mutateHighlights', key: 'rtl_fixer_hl_all', operation: { type: 'clearAll' } })
          .then(result => {
            if (!result?.ok) throw new Error(result?.error || 'Storage failed');
            renderHighlights();
          }).catch(() => alert('پاک‌سازی هایلایت‌ها ذخیره نشد. دوباره تلاش کنید.'));
      }
    });
  }

  // Storage listener for auto-refresh in popup
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const keys = Object.keys(changes);
      const highlightsChanged = keys.some(key => key.startsWith('rtl_fixer_hl_'));
      if (highlightsChanged) applyHighlightStorageChanges(changes);
      if (highlightsChanged || keys.includes('highlightEnabled')) {
        clearTimeout(highlightRefreshTimer);
        const panel = highlightToggle?.closest('details');
        if (panel?.open) highlightRefreshTimer = setTimeout(renderHighlights, 100);
      }
    }
  });

  // Force Chrome popup height recalculation on panel toggle to fix the resizing lag bug
  document.querySelectorAll('.accordion-panel').forEach(panel => {
    panel.addEventListener('toggle', () => {
      // Force repaint and layout recalculation
      setTimeout(() => {
        const body = document.body;
        const currentHeight = body.offsetHeight;
        body.style.height = `${currentHeight}px`;
        body.offsetHeight; // Force reflow
        body.style.height = '';
      }, 50);
    });
  });
});
