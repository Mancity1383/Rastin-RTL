// RTL Beautifier & Fixer - Styles Management
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  function isValidHttpUrl(string) {
    let url;
    try {
      url = new URL(string);
    } catch (_) {
      return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
  }

  function mergeTextNodeWithSiblings(textNode) {
    if (!textNode || !textNode.parentNode) return;
    const parent = textNode.parentNode;
    let prev = textNode.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      prev.textContent += textNode.textContent;
      parent.removeChild(textNode);
      textNode = prev;
    }
    let next = textNode.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE) {
      textNode.textContent += next.textContent;
      parent.removeChild(next);
    }
  }

  RtlFixer.isCosmeticAdBlockActive = function (config = RtlFixer.config || {}) {
    const host = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const disabledDomains = Array.isArray(config.disabledAdBlockDomains)
      ? config.disabledAdBlockDomains
      : [];
    const isDisabledForSite = disabledDomains.some(domain => {
      const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '');
      return cleanDomain && (host === cleanDomain || host.endsWith('.' + cleanDomain));
    });

    return config.globalEnabled !== false &&
      config.globalAdBlockEnabled !== false &&
      config.enabled !== false &&
      config.adBlockEnabled !== false &&
      config.adBlockCosmetic !== false &&
      !isDisabledForSite;
  };

  // Inject dynamic styles based on settings
  RtlFixer.applyStyles = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;

    let desiredImportUrl = null;
    if (config.fontFamily === 'Custom' && config.customFontUrl && isValidHttpUrl(config.customFontUrl)) {
      desiredImportUrl = config.customFontUrl;
    }

    if (desiredImportUrl) {
      if (!RtlFixer.fontImportElement || RtlFixer.fontImportElement.href !== desiredImportUrl) {
        if (RtlFixer.fontImportElement) RtlFixer.fontImportElement.remove();
        RtlFixer.fontImportElement = document.createElement('link');
        RtlFixer.fontImportElement.id = 'rtl-fixer-font-import';
        RtlFixer.fontImportElement.rel = 'stylesheet';
        RtlFixer.fontImportElement.href = desiredImportUrl;
        document.documentElement.appendChild(RtlFixer.fontImportElement);
      }
    } else if (RtlFixer.fontImportElement) {
      RtlFixer.fontImportElement.remove();
      RtlFixer.fontImportElement = null;
    }

    let fontFamilyValue = 'inherit';
    if (config.fontFamily === 'Vazirmatn') {
      fontFamilyValue = "'Vazirmatn', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif";
    } else if (config.fontFamily === 'Custom' && config.customFontName) {
      const sanitizedFontName = config.customFontName.replace(/[^a-zA-Z0-9\s\-]/g, '');
      fontFamilyValue = `'${sanitizedFontName}', system-ui, sans-serif`;
    } else if (config.fontFamily === 'System') {
      fontFamilyValue = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Tahoma, sans-serif";
    }

    let cssVariables = config.fontFamily === 'Vazirmatn' ? (RtlFixer.UI?.localFontCss || '') : '';
    cssVariables += `
      :root {
        --rtl-font-family: ${fontFamilyValue};
      }
      .rtl-fixer-typography-root {
        font-family: var(--rtl-font-family) !important;
      }
      .rtl-fixer-justify {
        text-align: justify !important;
        text-justify: inter-word !important;
      }
      .rtl-fixer-justify.rtl-fixer-right-align {
        text-align-last: right !important;
      }
      td .rtl-fixer-justify.rtl-fixer-right-align,
      th .rtl-fixer-justify.rtl-fixer-right-align {
        text-align-last: auto !important;
      }
      ${config.techCodeProtection ? `
        /* Technical Code LTR Layout & Styling Protection */
        .rtl-fixer-target code, 
        .rtl-fixer-target pre, 
        .rtl-fixer-target kbd, 
        .rtl-fixer-target samp,
        .rtl-fixer-target code *, 
        .rtl-fixer-target pre * {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Fira Code", monospace !important;
          direction: ltr !important;
          text-align: left !important;
          unicode-bidi: isolate !important;
        }
      ` : `
        /* Program Code Font Protection Only */
        .rtl-fixer-target code, 
        .rtl-fixer-target pre, 
        .rtl-fixer-target kbd, 
        .rtl-fixer-target samp,
        .rtl-fixer-target code *, 
        .rtl-fixer-target pre * {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Fira Code", monospace !important;
        }
      `}
      .rtl-fixer-isolate {
        unicode-bidi: isolate !important;
        direction: ltr !important;
      }
    `;

    // Only apply font-weight if it's customized (not 400 default)
    if (config.fontWeight && config.fontWeight !== '400') {
      cssVariables += `
        :root {
          --rtl-font-weight: ${config.fontWeight};
        }
        .rtl-fixer-typography-root {
          font-weight: var(--rtl-font-weight);
        }
      `;
    }

    // Only apply font-size-adjust if it's customized (not 0 default)
    if (config.fontSizeAdjust && config.fontSizeAdjust !== 0) {
      cssVariables += `
        :root {
          --rtl-font-size-adjust: calc(100% + ${config.fontSizeAdjust}px);
        }
        .rtl-fixer-typography-root {
          font-size: var(--rtl-font-size-adjust);
        }
      `;
    }

    // Always provide a line-height adjust but apply it WITHOUT !important so elements with specific line-heights override it.
    if (config.lineHeightAdjust) {
      cssVariables += `
        :root {
          --rtl-line-height-adjust: ${config.lineHeightAdjust};
        }
        .rtl-fixer-typography-root {
          line-height: var(--rtl-line-height-adjust);
        }
      `;
    }

    let cosmeticData = window.RtlFixer.cosmeticData || null;

    if (RtlFixer.isCosmeticAdBlockActive(config)) {
      const host = window.location.hostname.toLowerCase().replace(/^www\./, '');
      const isGhide = host === 'canyoublockit.com' || host.endsWith('.canyoublockit.com');

      let selectors = [];
      if (!isGhide) {
        selectors = [
          'iframe[src*="googleads"]',
          'iframe[id^="google_ads"]',
          'div[id^="google_ads"]',
          'ins.adsbygoogle',
          'iframe[src*="doubleclick.net"]',
          '.ad-banner',
          '.ad-wrapper',
          '.ad-box',
          '.ad_slot',
          '.tbd_ibd',
          '.tbdc',
          '#fbd_ibd',
          '#tbd_ibd',
          '.fbd_ibd',
          'div[id^="yn-"]',
          'div[class^="yn-"]',
          'iframe[src*="yektanet.com"]',
          'iframe[src*="sabavision.com"]',
          '.sabavision-co',
          '[id^="sabavision"]',
          'iframe[src*="mediaad.org"]',
          '.mediaad-container',
          '[id^="mediaad"]',
          'iframe[src*="tavoos.net"]',
          '.tavoos-native',
          'iframe[src*="tapsell.ir"]',
          '[id^="tapsell"]',
          'iframe[src*="onetag.ir"]',
          'iframe[src*="deyakco.ir"]',
          '.pos-article-display',
          'div[id^="pos-"]',
          '.yektanet-brand',
          'img[src*="yektanet"]',
          'img[src*="mediaad"]',
          'img[src*="sabavision"]',
          '.top-large-ads',
          '.sidebar-box-shop',
          '.fixedadv',
          '.ad-banner a[href*="/ad/"]',
          '.ad-wrapper a[href*="/ad/"]',
          '.ad-banner a[href*="/ads/"]',
          '.ad-wrapper a[href*="/ads/"]',
          'a[href*="/advert/"]',
          'a[href*="/click/"]',
          'a[href*="click.par30games.net"]',
          'a[href*="yektabanner.com"]',
          'a:has(> img[src*="/wp-content/uploads/"][src$=".gif"])',
          'a:has(> img[src*="/uploads/"][src$=".gif"])',
          'a:has(> img[src*="/wp-content/uploads/"][src$=".webp"][class*="banner"])',
          'a:has(> img[src*="/uploads/"][src$=".webp"][class*="banner"])',
          'a:has(> img[alt*="gamesstore"])',
          'a:has(> img[alt*="ادز"])',
          'a:has(> img[alt*="تبلیغات"])',
          'a:has(> img[alt*="Lingano"])',
          'a:has(> img[alt*="Bale"])',
          '.banner-desktop',
          '.banner-mobile'
        ];
      }

      // Add dynamic rules loaded from cosmetic_rules.json
      if (cosmeticData) {
        if (Array.isArray(cosmeticData.generic) && !isGhide) {
          selectors.push(...cosmeticData.generic);
        }
        if (cosmeticData.specific) {
          if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Hostname:', host, 'Parts:', host.split('.'));
          const parts = host.split('.');
          for (let i = 0; i < parts.length - 1; i++) {
            const subDomain = parts.slice(i).join('.');
            if (Array.isArray(cosmeticData.specific[subDomain])) {
              if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Found specific selectors for subdomain:', subDomain, cosmeticData.specific[subDomain]);
              selectors.push(...cosmeticData.specific[subDomain]);
            }
          }
        }
      }

      if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] FinalSelectors count:', selectors.length, 'Contains ytd-ad-slot-renderer:', selectors.includes('ytd-ad-slot-renderer'));

      if (selectors.length > 0) {
        cssVariables += `
          /* Dynamic Cosmetic Ad Blocking */
          ${selectors.join(',\n')} {
            display: none !important;
          }
        `;
      }
    }

    if (!RtlFixer.styleElement) {
      RtlFixer.styleElement = document.createElement('style');
      RtlFixer.styleElement.id = 'rtl-fixer-dynamic-variables';
      document.documentElement.appendChild(RtlFixer.styleElement);
    }
    if (RtlFixer.styleElement.textContent !== cssVariables) {
      RtlFixer.styleElement.textContent = cssVariables;
      if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Stylesheet updated!');
    }
  };

  // Clean up styles, classes, and unwrap isolate elements
  RtlFixer.removeRtlFixes = function () {
    if (typeof RtlFixer.stopObserver === 'function') {
      RtlFixer.stopObserver();
    }
    if (typeof RtlFixer.removeRuler === 'function') {
      RtlFixer.removeRuler();
    }
    if (typeof RtlFixer.removeCoach === 'function') {
      RtlFixer.removeCoach();
    }
    if (typeof RtlFixer.removeTranslator === 'function') {
      RtlFixer.removeTranslator();
    }
    if (typeof RtlFixer.removeHighlight === 'function') {
      RtlFixer.removeHighlight();
    }

    if (RtlFixer.styleElement) {
      RtlFixer.styleElement.remove();
      RtlFixer.styleElement = null;
    }
    if (RtlFixer.fontImportElement) {
      RtlFixer.fontImportElement.remove();
      RtlFixer.fontImportElement = null;
    }

    // Restore only text that still equals the value written by the extension.
    // The explicit set also covers text nodes inside open Shadow DOMs.
    RtlFixer._managedDigitNodes?.forEach(node => {
      const state = RtlFixer._digitState?.get(node);
      if (state && node.isConnected && node.textContent === state.written) {
        node.textContent = state.original;
      }
      RtlFixer._digitState?.delete(node);
    });
    RtlFixer._managedDigitNodes?.clear();

    // Unwrap <bdi class="rtl-fixer-isolate"> elements (restore to normal text nodes)
    try {
      const isolates = RtlFixer._isolateElements || [];
      isolates.forEach(el => {
        try {
          const parent = el.parentNode;
          if (parent) {
            const textNode = document.createTextNode(el.textContent);
            parent.replaceChild(textNode, el);
            mergeTextNodeWithSiblings(textNode);
          }
        } catch (_) {}
      });
      RtlFixer._isolateElements?.clear();
    } catch (_) {}

    // Unwrap <span class="rtl-fixer-bionic"> elements
    try {
      const bionics = RtlFixer._bionicElements || [];
      bionics.forEach(el => {
        try {
          const parent = el.parentNode;
          if (parent) {
            const textNode = document.createTextNode(el.textContent);
            parent.replaceChild(textNode, el);
            mergeTextNodeWithSiblings(textNode);
          }
        } catch (_) {}
      });
      RtlFixer._bionicElements?.clear();
    } catch (_) {}

    // Managed elements are explicitly tracked, so cleanup is independent of
    // classes and works for light DOM, disconnected nodes and Shadow DOM.
    const managedElements = Array.from(RtlFixer._managedElements || []);
    managedElements.forEach(el => {
      try {
        el.classList.remove('rtl-fixer-input-processed', 'rtl-fixer-input-host');
        if (typeof RtlFixer.clearManagedElement === 'function') RtlFixer.clearManagedElement(el);
      } catch (_) {}
    });
    RtlFixer._managedElements?.clear();
    RtlFixer._managedMathElements?.forEach(el => {
      el.classList.remove('rtl-fixer-katex-ltr', 'rtl-fixer-katex-rtl-text', 'rtl-fixer-katex-rtl-box');
    });
    RtlFixer._managedMathElements?.clear();
    RtlFixer._terminalLatinLabels?.forEach(el => {
      el.classList.remove('rtl-fixer-terminal-latin-colon');
    });
    RtlFixer._terminalLatinLabels?.clear();
    if (typeof RtlFixer.resetTableDirectionCache === 'function') {
      RtlFixer.resetTableDirectionCache();
    }
  };
})(window.RtlFixer);

// Load dynamic cosmetic rules from Background Service Worker (uBlock-style)
window.RtlFixer.baseCosmeticData = window.RtlFixer.baseCosmeticData || null;
window.RtlFixer.dynamicCosmeticData = window.RtlFixer.dynamicCosmeticData || null;
window.RtlFixer.cosmeticData = window.RtlFixer.cosmeticData || null;

function updateCosmeticDataAndApply() {
  const base = window.RtlFixer.baseCosmeticData || { generic: [], specific: {} };
  const dyn = window.RtlFixer.dynamicCosmeticData || { generic: [], specific: {} };
  
  const mergedSpecific = { ...base.specific };
  for (const key in dyn.specific) {
    if (mergedSpecific[key]) {
      mergedSpecific[key] = [...mergedSpecific[key], ...dyn.specific[key]];
    } else {
      mergedSpecific[key] = dyn.specific[key];
    }
  }

  window.RtlFixer.cosmeticData = {
    generic: [...(base.generic || []), ...(dyn.generic || [])],
    specific: mergedSpecific
  };
  
  if (window.RtlFixer.config && window.RtlFixer.isCosmeticAdBlockActive(window.RtlFixer.config)) {
    window.RtlFixer.applyStyles();
  }
}

function loadCosmeticRulesFromBackground() {
  try {
    chrome.runtime.sendMessage({ action: 'getCosmeticRules' }, (response) => {
      if (response && response.data) {
        window.RtlFixer.dynamicCosmeticData = response.data;
        updateCosmeticDataAndApply();
      }
    });
  } catch (e) {}
}

function loadCosmeticRulesFromPackage() {
  // Base rules are now injected synchronously via content/cosmetic_rules.js
  updateCosmeticDataAndApply();
}

// Listen for background telling us to refresh (after new filters are compiled)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'refreshCosmeticFilters') {
    loadCosmeticRulesFromBackground();
  }
});

// Start loading both
loadCosmeticRulesFromPackage();
loadCosmeticRulesFromBackground();
