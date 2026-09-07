/**
 * Rastin RTL - Generalized Ad Blocker Engine v3.0
 * Works on ANY website, not just hardcoded domains
 * Optimized for speed: single CSS injection, compiled patterns,
 * idle-time processing, and smart heuristics
 */

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: CONFIGURATION & CONSTANTS
  // ============================================================

  const CFG = Object.freeze({
    MAX_BATCH_NODES:      80,    // Max nodes per mutation flush
    MAX_STRUCTURAL_NODES: 300,   // Max nodes in structural sweep
    RETRY_DELAYS:         [150, 400, 900, 2000], // Exponential backoff
    SCROLL_THROTTLE_MS:   1200,  // Minimum ms between scroll checks
    ANTI_ADBLOCK_ZINDEX:  100,   // Min z-index to suspect anti-adblock
    DYNAMIC_RULES_DELAY:  250,   // ms after init to fetch dynamic rules
    LOAD_RESCAN_DELAYS:   [600, 2500], // ms after load to rescan
    MAX_TREE_WALKER_NODES: 600,  // Safety limit for TreeWalker
    CSS_INJECTION_ATTR:   'data-rastin-v3',
    DEBUG:                false
  });

  const log = CFG.DEBUG
    ? (...a) => console.log('[Rastin v3]', ...a)
    : () => {};

  const SENSITIVE_HOSTNAMES = new Set([
    'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'music.youtube.com',
    'aparat.com', 'telewebion.ir', 'telewebion.com',
    'netflix.com', 'primevideo.com', 'disneyplus.com',
    'spotify.com', 'twitch.tv',
  ]);

  const IS_SENSITIVE_SITE = [...SENSITIVE_HOSTNAMES].some(d => location.hostname.toLowerCase() === d || location.hostname.toLowerCase().endsWith('.' + d));

  // ============================================================
  // SECTION 2: UNIVERSAL SELECTOR LIBRARY
  // Organized by confidence tier for clarity
  // These work on ANY website - no domain assumptions
  // ============================================================

  /**
   * TIER 1 — Definitive ad selectors
   * These match ad infrastructure directly.
   * False positive rate: ~0%
   */
  const TIER1_SELECTORS = [
    // Google / Programmatic
    'ins.adsbygoogle',
    '.adsbygoogle',
    '[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
    '[id*="gpt-ad"]',
    '[id^="dfp-ad-"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googleads.g.doubleclick.net"]',
    'iframe[src*="adservice.google.com"]',
    '[data-ad-client]',   // AdSense attribute
    '[data-ad-slot]',     // AdSense attribute
    '[data-ad-format]',   // AdSense attribute
    '[data-google-query-id]',

    // Programmatic ad infrastructure
    'iframe[src*="adnxs.com"]',
    'iframe[src*="rubiconproject.com"]',
    'iframe[src*="openx.net"]',
    'iframe[src*="pubmatic.com"]',
    'iframe[src*="criteo.com"]',
    'iframe[src*="criteo.net"]',
    'iframe[src*="taboola.com"]',
    'iframe[src*="outbrain.com"]',
    'iframe[src*="smartadserver.com"]',
    'iframe[src*="33across.com"]',
    'iframe[src*="sharethrough.com"]',
    'iframe[src*="lijit.com"]',
    'iframe[src*="sovrn.com"]',
    'iframe[src*="indexexchange.com"]',
    'iframe[src*="adform.net"]',
    'iframe[src*="flashtalking.com"]',
    'iframe[src*="advertising.com"]',
    'iframe[src*="casalemedia.com"]',
    'iframe[src*="contextweb.com"]',
    'iframe[src*="liveintent.com"]',
    'iframe[src*="adroll.com"]',
    'iframe[src*="revcontent.com"]',
    'iframe[src*="mgid.com"]',
    'iframe[src*="adcolony.com"]',
    'iframe[src*="media.net"]',
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[src*="moatads.com"]',
    'iframe[src*="adsrvr.org"]',  // The Trade Desk

    // Persian / Iranian ad networks (infrastructure-level)
    'iframe[src*="yektanet.com"]',
    'iframe[src*="sabavision.com"]',
    'iframe[src*="tapsell.ir"]',
    'iframe[src*="mediaad.org"]',
    'iframe[src*="najva.com"]',
    'iframe[src*="pushe.co"]',
    'iframe[src*="tavoos.net"]',
    'iframe[src*="onetag.ir"]',
    'iframe[src*="deyakco.ir"]',
    'iframe[src*="adverge.ir"]',
    'iframe[src*="chavosh.org"]',
    'iframe[src*="kaprila.com"]',
    'iframe[src*="sanjagh.com"]',
    'iframe[src*="sorenad.com"]',
    'iframe[src*="popupdl.ir"]',
    'iframe[src*="adtrace.io"]',
    'iframe[src*="clickyab.com"]',
    'iframe[src*="iran-ad.com"]',
    '[class*="yektanet"]',
    '[id*="yektanet"]',
    '[class*="tapsell"]',
    '[id*="tapsell"]',
    '[class*="sabavision"]',
    '[id*="sabavision"]',
    '[class*="mediaad"]',
    '[id*="mediaad"]',
    '[class*="najva"]',
    '[id*="najva"]',
    '[class*="pushe"]',
    '[id*="pushe"]',
    '[class*="adverge"]',
    '[id*="adverge"]',
    'img[src*="yektanet"]',
    'script[src*="adverge.ir"]',

    // Standard data attributes (programmatic)
    '[data-ad-unit]',
    '[data-dfp-ad]',
    '[data-native-ad]',
    '[data-sponsor]',
    '[data-promoted]',
    '[aria-label="Advertisement"]',
    '[aria-label="تبلیغ"]',
    '[aria-label="تبلیغات"]',

    // IAB standard iframe sizes (these dimensions = ONLY ads)
    'iframe[width="728"][height="90"]',
    'iframe[width="300"][height="250"]',
    'iframe[width="320"][height="50"]',
    'iframe[width="468"][height="60"]',
    'iframe[width="160"][height="600"]',
    'iframe[width="970"][height="250"]',
    'iframe[width="300"][height="600"]',
    'iframe[width="336"][height="280"]',

    // Flash (legacy but still seen)
    'object[type="application/x-shockwave-flash"]',
    'embed[type="application/x-shockwave-flash"]',
  ];

  /**
   * TIER 2 — Strong ad selectors
   * Very specific class/id patterns that almost never appear in content.
   * False positive rate: ~1-2%
   */
  const TIER2_SELECTORS = [
    // Highly specific structural IDs
    '[id^="ad-slot-"]',
    '[id^="ad_slot_"]',
    '[id^="ad-unit-"]',
    '[id^="ad_unit_"]',
    '[id^="ad-container-"]',
    '[id^="ad_container_"]',
    '[id^="ad-wrapper-"]',
    '[id^="ad_wrapper_"]',
    '[id^="advert-"]',
    '[id^="advertisement-"]',
    '[id="ad-container"]',
    '[id="ad-wrapper"]',
    '[id="ad-banner"]',
    '[id="advertisement"]',
    '[id="ads-container"]',
    '[id="ads-wrapper"]',
    '[id="banner-ad"]',

    // Highly specific structural classes
    '.ad-slot',
    '.ad-unit',
    '.ad-container',
    '.ad-wrapper',
    '.ad-placement',
    '.ad-placeholder',
    '.ad-frame',
    '.ad-zone',
    '.ad-section',
    '.ad-space',
    '.ad-box',
    '.ad-banner',
    '.advert',
    '.advert-block',
    '.advertisement',
    '.advertisements',
    '.advertisement-container',
    '.banner-ad',
    '.banner_ad',
    '.banner-ads',
    '.ads-container',
    '.ads-wrapper',
    '.ads-area',
    '.ads-section',
    '.adsbox',
    '.textads',
    '.text-ads',
    '.text-ad',
    '.textad',
    '.native-ad',
    '[class*="native-ad"]',
    '[class*="nativead"]',
    '[id*="native-ad"]',
    '.js-ad-unit',
    '.js_ad_unit',
    '.advertise',
    '.advertise-item',
    'section.advertise',
    '[class*="advertise"]',
    '[id*="advertise"]',
    'img[src*="/assets/ads/"]',
    'a[href*="/assets/ads/"]',
    'a[href*="irannewspaper.ir/ads"]',
    'a[href*="24d.ir"]',
    'a[href*="l.24d.ir"]',
    '[class*="type-resource"]',
    'img[src*="servev2"]',

    // Sponsored/promoted (very specific)
    '[class*="sponsored-content"]',
    '[class*="promoted-content"]',
    '[class*="partner-content"]',
    '[class*="brand-content"]',
    '[data-sponsored]',

    // Popup/overlay ads
    '.popup-ad',
    '.popup-ads',
    '.modal-ad',
    '#popup-ad',
    '.ad-popup',
    '.adpopup',
    '.overlay-ad',
    '[id*="popup-ad"]',
    '[class*="popup-ad"]',

    // Anti-adblock selectors (universal)
    '#anti-adblock',
    '#antiAdblock',
    '#adb-overlay',
    '#adblock-overlay',
    '#adblock-warning',
    '#adblock-notice',
    '#adblocker-notice',
    '#adBlockOverlay',
    '#adBlockNotice',
    '#adblock-message',
    '#adblock-detected',
    '.anti-adblock',
    '.antiAdblock',
    '.adb-overlay',
    '.adblock-overlay',
    '.adblock-warning',
    '.adblock-notice',
    '.adblocker-notice',
    '.adblock-detected',
    '.adblock_notice',
    '.ad-blocker-notice',
    '[class*="adblock-overlay"]',
    '[class*="adblocker-overlay"]',
    '[id*="adblock-overlay"]',
    '[id*="adblocker-overlay"]',
    '[class*="anti-adblock"]',

    // Image dimension signatures in src path (never in real content)
    'img[src*="728x90"]',
    'img[src*="300x250"]',
    'img[src*="468x60"]',
    'img[src*="160x600"]',
    'img[src*="970x90"]',
    'img[src*="320x50"]',
    'img[src*="336x280"]',
    'img[src*="300x600"]',

    // Google auto-placed
    '.google-auto-placed',
    '#google_esf',
    '[id^="google_ads"]',
    '[id^="google-ad"]',
    '[id^="yn-"]',       // Yektanet dynamic
    '[class^="yn-"]',

    // Push notification ads
    '[class*="in-page-push" i]',
    '[class*="push-ad" i]',
    '[class*="notification-ad" i]',
    '[class*="ad-notification" i]',
    '[class*="ad-push" i]',

    // Persian ad badges (structural)
    '[class*="تبلیغ"]',
    '[class*="آگهی"]',
    '[class*="رپورتاژ"]',
    '[id*="تبلیغ"]',
    '[id*="آگهی"]',

    // Soft98 / known first-party patterns
    '.abddi', '.abddp', '.abddpr',
    '[class^="abdd"]',
    '.tbd_ibd', '.tbdc',
    '#fbd_ibd', '#tbd_ibd', '.fbd_ibd',
    '.pos-article-display',
    '[id^="pos-"]',
    'img[src*="/fcxchief"]',
    'img[src*="/ircd"]',
    'img[src*="xchief"]',
    'img[src*="iranicard"]',

    // Zoomit / Zoomg
    'div[class^="AdvertisingParser__Root"]',
  ];

  /**
   * TIER 3 — Broad patterns (applied with structural validation)
   * Higher false positive risk - used only with querySelector,
   * NOT injected into global CSS.
   * These are checked programmatically with additional context.
   */
  const TIER3_HEURISTIC_PATTERNS = {
    // Class/ID word-boundary patterns for structural sweeper
    CLASS_ID_REGEX: /(?:^|[\s_-])(?:ad|ads|advert|adbox|adsbox|adx|ad-slot|ad_slot|ad-unit|ad_unit|ad-container|ad_container|advertisement|banner-ad|banner_ad|sponsor|sponsored|promo|promoted)(?:[\s_-]|$)/i,
    PERSIAN_REGEX:  /تبلیغ|آگهی|رپورتاژ/,

    // Safe tags for structural sweeper
    SAFE_TAGS: new Set(['DIV','SECTION','ASIDE','ARTICLE','LI','SPAN','P','FIGURE']),

    // Tags that should NEVER be hidden by broad patterns
    PROTECTED_TAGS: new Set(['BODY','HTML','HEAD','MAIN','NAV','HEADER','FOOTER',
                              'YTD-MASTHEAD','YTD-APP','YTD-TOPBAR-LOGO-RENDERER','YTD-SEARCHBOX','YTD-PAGE-MANAGER',
                              'FORM','INPUT','BUTTON','A','IMG','VIDEO','AUDIO',
                              'SCRIPT','STYLE','LINK','META']),

    // Content classes that protect an element from broad patterns
    CONTENT_SAFEGUARD: /\b(?:article|post.?content|main.?content|entry.?content|story|news|blog|comment|breadcrumb|pagination|menu|search|gallery|carousel|hero|logo|avatar|profile|author|related|header|masthead|topbar|nav|navbar|widget(?!.*ad))\b/i,
  };

  // ============================================================
  // SECTION 3: PATTERN CACHE
  // Pre-compiled once, reused everywhere
  // ============================================================

  const Cache = (() => {
    // Validate selectors at startup (not in mutation hot-path)
    function validateSelectors(selectors) {
      const fragment = document.createDocumentFragment();
      const valid = [];
      for (const sel of selectors) {
        try {
          fragment.querySelector(sel);
          valid.push(sel);
        } catch (_) {
          log('Invalid selector skipped:', sel);
        }
      }
      return valid;
    }

    // Split into chunks to avoid "selector list too long" issues
    function chunkSelectors(selectors, chunkSize = 120) {
      const chunks = [];
      for (let i = 0; i < selectors.length; i += chunkSize) {
        chunks.push(selectors.slice(i, i + chunkSize).join(',\n'));
      }
      return chunks;
    }

    const validTier1 = validateSelectors(TIER1_SELECTORS);
    const validTier2 = validateSelectors(TIER2_SELECTORS);
    const allValid   = [...new Set([...validTier1, ...validTier2])];

    return {
      tier1Selectors:    validTier1,
      tier2Selectors:    validTier2,
      allSelectors:      allValid,
      // Chunked for querySelectorAll
      queryChunks:       chunkSelectors(allValid),
      // Single string for CSS injection
      cssString:         allValid.join(',\n'),
    };
  })();

  // ============================================================
  // SECTION 4: CSS INJECTOR
  // Single <style> element, updated in-place (no DOM thrashing)
  // ============================================================

  const CSSInjector = (() => {
    let styleEl = null;
    // Remember dynamic/cosmetic selectors passed to inject() so later
    // argument-less inject() calls (e.g. from fullPageScan) don't wipe them.
    let persistedExtra = [];

    // The hide rule applied to all matched elements
    const HIDE_RULE = `{
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      max-height: 0 !important;
      width: 0 !important;
      max-width: 0 !important;
      min-height: 0 !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      pointer-events: none !important;
      overflow: hidden !important;
      position: absolute !important;
      left: -9999px !important;
      top: -9999px !important;
    }`;

    function getOrCreateStyleEl() {
      // Reuse existing element if still in DOM
      if (styleEl && styleEl.isConnected) return styleEl;

      // Check if another instance already injected
      styleEl = document.querySelector(`style[${CFG.CSS_INJECTION_ATTR}]`);
      if (styleEl) return styleEl;

      styleEl = document.createElement('style');
      styleEl.setAttribute(CFG.CSS_INJECTION_ATTR, 'true');
      // Inline id for debuggability
      styleEl.id = 'rastin-rtl-v3';
      return styleEl;
    }

    function buildCSSContent(extraSelectors = []) {
      let selectors = Cache.allSelectors;

      if (extraSelectors.length > 0) {
        // Validate and merge extra selectors
        const fragment = document.createDocumentFragment();
        const validExtra = extraSelectors.filter(sel => {
          try { fragment.querySelector(sel); return true; }
          catch (_) { return false; }
        });
        selectors = [...new Set([...selectors, ...validExtra])];
      }

      if (selectors.length === 0) return null;
      return selectors.join(',\n') + '\n' + HIDE_RULE;
    }

    return {
      /**
       * Inject or update the global ad-block stylesheet.
       * Safe to call multiple times - only updates textContent if changed.
       */
      inject(extraSelectors = []) {
        // Merge any newly-supplied selectors into the persistent set so they
        // survive subsequent argument-less re-injections.
        if (extraSelectors.length > 0) {
          persistedExtra = [...new Set([...persistedExtra, ...extraSelectors])];
        }
        const el = getOrCreateStyleEl();
        const css = buildCSSContent(persistedExtra);
        if (!css) return;

        // Only update DOM if content actually changed
        if (el.textContent !== css) {
          el.textContent = css;
        }

        // Insert at earliest possible position
        if (!el.isConnected) {
          const target = document.head || document.documentElement;
          if (target) target.insertBefore(el, target.firstChild);
        }
      },

      /**
       * Inject custom per-site rules from storage
       */
      injectCustom(rules) {
        let el = document.querySelector('style[data-rastin-custom]');
        if (!rules || rules.length === 0) {
          if (el) el.remove();
          return;
        }
        if (!el) {
          el = document.createElement('style');
          el.setAttribute('data-rastin-custom', 'true');
          const target = document.head || document.documentElement;
          if (target) target.appendChild(el);
        }
        const css = rules.map(s => `${s}{display:none!important}`).join('\n');
        if (el.textContent !== css) el.textContent = css;
      }
    };
  })();

  // ============================================================
  // SECTION 5: ELEMENT HIDER
  // Core utility - hides a single element imperatively
  // ============================================================

    const originalEngineStyles = new WeakMap();
    const managedEngineElements = new Set();

    function pruneDisconnectedNodes() {
      for (const el of managedEngineElements) {
        if (!el || !el.isConnected) {
          managedEngineElements.delete(el);
          if (el) originalEngineStyles.delete(el);
        }
      }
    }

    function hideElement(el) {
      if (!el || el.hasAttribute('data-rastin-engine-hidden')) return;
      if (IS_SENSITIVE_SITE) return; // Complete NO-OP on sensitive domains

      const tag = el.tagName ? el.tagName.toUpperCase() : '';
      const elId = (el.id || '').toLowerCase();
      const elCls = typeof el.className === 'string' ? el.className.toLowerCase() : '';

      // Critical UI Safeguard: Never hide main navigation headers, mastheads, or top containers!
      if (tag === 'HEADER' || tag === 'NAV' || tag.includes('MASTHEAD') ||
          elId === 'header' || elId === 'masthead' || elId === 'masthead-container' || (elId === 'container' && elCls.includes('ytd-masthead')) ||
          elCls.includes('ytd-masthead') ||
          (el.closest && el.closest('header, nav, ytd-masthead, #masthead, #masthead-container, #header') &&
           !elId.includes('ad') && !elCls.includes('ad') && !tag.includes('AD-SLOT'))) {
        return;
      }

      try {
        if (!originalEngineStyles.has(el)) {
          originalEngineStyles.set(el, {
            display: el.style.getPropertyValue('display'),
            displayPriority: el.style.getPropertyPriority('display'),
            visibility: el.style.getPropertyValue('visibility'),
            visibilityPriority: el.style.getPropertyPriority('visibility'),
            height: el.style.getPropertyValue('height'),
            heightPriority: el.style.getPropertyPriority('height'),
            overflow: el.style.getPropertyValue('overflow'),
            overflowPriority: el.style.getPropertyPriority('overflow')
          });
          managedEngineElements.add(el);
        }
        el.style.setProperty('display',     'none',   'important');
        el.style.setProperty('visibility',  'hidden', 'important');
        el.style.setProperty('height',      '0',      'important');
        el.style.setProperty('overflow',    'hidden', 'important');
        el.setAttribute('data-rastin-engine-hidden', '1');
        collapseEmptyWrappers(el);
      } catch (_) {}

      pruneDisconnectedNodes();
    }

    let _gapRemoverEnabled = true;

    function teardown() {
      if (!_initialized) return;
      _initialized = false;

      if (_observer) { try { _observer.disconnect(); } catch (_) {} _observer = null; }
      if (_scanTimeout) { clearTimeout(_scanTimeout); _scanTimeout = null; }
      window.removeEventListener('scroll', restoreScrollLock);

      document.querySelectorAll(`style[${CFG.CSS_INJECTION_ATTR}], style[data-rastin-custom]`)
        .forEach(el => { try { el.remove(); } catch (_) {} });

      for (const el of managedEngineElements) {
        try {
          const snapshot = originalEngineStyles.get(el);
          if (snapshot) {
            ['display', 'visibility', 'height', 'overflow'].forEach(prop => {
              const currentVal = el.style.getPropertyValue(prop);
              // Property-level selective restoration: Only restore if current value equals our hidden value ('none' / 'hidden' / '0')
              if (currentVal === 'none' || currentVal === 'hidden' || currentVal === '0') {
                if (snapshot[prop]) {
                  el.style.setProperty(prop, snapshot[prop], snapshot[prop + 'Priority'] || '');
                } else {
                  el.style.removeProperty(prop);
                }
              }
            });
            originalEngineStyles.delete(el);
          }
          el.removeAttribute('data-rastin-engine-hidden');
          el.removeAttribute('data-rastin-collapsed');
        } catch (_) {}
      }
      managedEngineElements.clear();

      log('Torn down on:', location.hostname);
    }


  function hasVisibleContent(node) {
    if (!node || !node.children) return false;

    const tag = node.tagName ? node.tagName.toUpperCase() : '';
    const id = (node.id || '').toLowerCase();
    const classStr = typeof node.className === 'string' ? node.className.toLowerCase() : '';
    if (['HEADER', 'NAV', 'YTD-MASTHEAD', 'YTD-APP', 'YTD-PAGE-MANAGER'].includes(tag) ||
        id.includes('masthead') || id.includes('header') || id.includes('navbar') ||
        classStr.includes('masthead') || classStr.includes('header') || classStr.includes('navbar') ||
        (node.closest && node.closest('header, nav, ytd-masthead, #masthead, #masthead-container, #header'))) {
      return true;
    }

    // Check direct text nodes
    for (const child of node.childNodes) {
      if (child.nodeType === 3 && child.nodeValue.trim().length > 0) return true;
    }

    // Check elements
    for (const child of node.children) {
      const childTag = child.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'YT-INTERACTION'].includes(childTag)) continue;
      if (child.hasAttribute('data-rastin-blocked') || child.hasAttribute('data-rastin-engine-hidden')) continue;
      if (child.hasAttribute('data-rastin-collapsed')) continue;

      // Fast inline style check to avoid getComputedStyle if possible
      if (child.style && (child.style.display === 'none' || child.style.visibility === 'hidden' || child.style.opacity === '0')) {
        continue;
      }

      try {
        const style = window.getComputedStyle(child);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && style.height !== '0px') {
          return true;
        }
      } catch (e) {
        return true; // Assume visible if we can't check
      }
    }
    return false;
  }

  function collapseEmptyWrappers(node) {
    if (!_gapRemoverEnabled) return;
    if (!node || !node.parentElement) return;
    let current = node.parentElement;

    for (let depth = 0; depth < 3; depth++) {
      if (!current) break;
      const tag = current.tagName ? current.tagName.toUpperCase() : '';
      const currentId = (current.id || '').toLowerCase();
      const classStr = typeof current.className === 'string' ? current.className.toLowerCase() : '';

      if (['BODY', 'HTML', 'MAIN', 'ARTICLE', 'HEADER', 'NAV', 'YTD-MASTHEAD', 'YTD-APP', 'YTD-PAGE-MANAGER'].includes(tag)) {
        break;
      }
      if ((currentId === 'header' || currentId === 'masthead' || currentId === 'navbar') && !currentId.includes('ad') && !currentId.includes('banner')) {
        break;
      }
      if ((classStr === 'header' || classStr === 'navbar' || classStr === 'masthead') && !classStr.includes('ad') && !classStr.includes('banner')) {
        break;
      }
      
      if (TIER3_HEURISTIC_PATTERNS.CONTENT_SAFEGUARD.test(classStr)) break;

      if (!hasVisibleContent(current)) {
        try {
          if (!originalEngineStyles.has(current)) {
            originalEngineStyles.set(current, {
              display: current.style.getPropertyValue('display'),
              displayPriority: current.style.getPropertyPriority('display'),
              height: current.style.getPropertyValue('height'),
              heightPriority: current.style.getPropertyPriority('height'),
              minHeight: current.style.getPropertyValue('min-height'),
              minHeightPriority: current.style.getPropertyPriority('min-height'),
              maxHeight: current.style.getPropertyValue('max-height'),
              maxHeightPriority: current.style.getPropertyPriority('max-height'),
              margin: current.style.getPropertyValue('margin'),
              marginPriority: current.style.getPropertyPriority('margin'),
              padding: current.style.getPropertyValue('padding'),
              paddingPriority: current.style.getPropertyPriority('padding')
            });
            managedEngineElements.add(current);
          }
          current.style.setProperty('display', 'none', 'important');
          current.style.setProperty('height', '0', 'important');
          current.style.setProperty('min-height', '0', 'important');
          current.style.setProperty('max-height', '0', 'important');
          current.style.setProperty('margin', '0', 'important');
          current.style.setProperty('padding', '0', 'important');
          current.setAttribute('data-rastin-collapsed', 'true');
        } catch (_) {}
        current = current.parentElement;
      } else {
        break;
      }
    }
  }



  // ============================================================
  // SECTION 6: ANTI-ADBLOCK NEUTRALIZER
  // ============================================================

  // Pre-normalized phrases for faster matching
  const ANTI_ADBLOCK_PHRASES = [
    // Persian
    'افزونه حذف تبلیغات',
    'استفاده رایگان از محتوای سایت',
    'adblocker را غیرفعال',
    'غیرفعال کنید، سپس f5',
    'حذف کننده تبلیغ',
    'مسدود کننده تبلیغ',
    'فیلترشکن را در مرورگر',
    'پشتیبانی قالب',
    // English
    'please disable your ad blocker',
    'please disable adblock',
    'disable your adblocker',
    'turn off your ad blocker',
    'ad blocker detected',
    'adblock detected',
    'we detected an ad blocker',
    'you are using an ad blocker',
    'whitelist our website',
    'support us by disabling',
    'please whitelist',
    'ublock detected',
    'adblock plus detected',
  ];

  // Build single regex from phrases for O(1) matching
  const ANTI_ADBLOCK_REGEX = new RegExp(
    ANTI_ADBLOCK_PHRASES.map(p =>
      p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|'),
    'i'
  );

  let _lastAntiAdblockCheck = 0;

  function killAntiAdblockMessages() {
    if (IS_SENSITIVE_SITE) return;

    const warningElements = document.querySelectorAll(
      '[class*="anti-adblock" i], [id*="anti-adblock" i], ' +
      '[class*="adblock-modal" i], [id*="adblock-modal" i], ' +
      '[class*="adblock-warning" i], [id*="adblock-warning" i], ' +
      '[class*="blocker-dialog" i], [id*="blocker-dialog" i], ' +
      '.ads-box, .ads-container'
    );

    warningElements.forEach(el => {
      try {
        const text = el.textContent || '';
        if (ANTI_ADBLOCK_REGEX.test(text)) {
          el.textContent = '';
          hideElement(el);
        }
      } catch (_) {}
    });

    const candidates = document.querySelectorAll('div, section, p, td, article, aside');
    for (const el of candidates) {
      if (!el || el.children.length > 25) continue;
      const text = el.textContent || '';
      if (text.length > 500) continue;

      if (ANTI_ADBLOCK_REGEX.test(text)) {
        const box = (el.tagName === 'P' || el.tagName === 'SPAN') ? (el.closest('div, td, section') || el) : el;
        try {
          box.textContent = '';
          hideElement(box);
        } catch (_) {}
      }
    }
  }

  // ============================================================
  // SECTION 7: SCROLL LOCK RESTORER
  // ============================================================

  let _lastScrollKill = 0;

  const OVERLAY_SELECTOR =
    '.overlay, .dimmer, .modal-backdrop, .ad-overlay, .popup-overlay, ' +
    '[class*="overlay"][style*="fixed"], [class*="popup"][style*="fixed"]';

  function restoreScrollLock() {
    const now = Date.now();
    if (now - _lastScrollKill < CFG.SCROLL_THROTTLE_MS) return;
    _lastScrollKill = now;

    const hasOverlay = document.querySelector(OVERLAY_SELECTOR);
    if (!hasOverlay) return;

    // Restore scroll ONLY if an ad overlay is present
    document.documentElement.style.removeProperty('overflow');
    if (document.body) document.body.style.removeProperty('overflow');

    document.querySelectorAll(OVERLAY_SELECTOR).forEach(el => {
      if (el.hasAttribute('data-rastin-blocked')) return;
      try {
        const cs = window.getComputedStyle(el);
        if (cs.position === 'fixed' && parseInt(cs.zIndex || '0') > 999) {
          // Avoid hiding legitimate modals (login forms, cookie prompts, checkout steps)
          if (el.querySelector('input, textarea, select, [role="dialog"], [role="alertdialog"]')) return;
          hideElement(el);
        }
      } catch (_) {}
    });

    killAntiAdblockMessages();
  }

  // ============================================================
  // SECTION 8: NATIVE BANNER DETECTOR
  // Generalized heuristic - works on ANY site
  // ============================================================

  // IAB standard ad dimensions with pixel tolerance
  const IAB_SIZES = [
    [120,240],[120,600],[160,600],[200,200],[250,250],
    [300,250],[300,600],[320,50],[320,100],[336,280],
    [468,60],[728,90],[970,90],[970,250],[580,400],
    [300,50],[320,480],[360,640],[250,360],[300,1050],
  ];
  const SIZE_TOLERANCE = 6; // pixels

  function isIABSize(w, h) {
    return IAB_SIZES.some(([aw, ah]) =>
      Math.abs(w - aw) <= SIZE_TOLERANCE &&
      Math.abs(h - ah) <= SIZE_TOLERANCE
    );
  }

  // Known ad network domains (for link href check)
  const AD_NETWORK_HOSTNAMES = new Set([
    'doubleclick.net','googlesyndication.com','googleadservices.com',
    'adnxs.com','rubiconproject.com','openx.net','pubmatic.com',
    'criteo.com','criteo.net','taboola.com','outbrain.com',
    'smartadserver.com','moatads.com','adsrvr.org','media.net',
    'amazon-adsystem.com','adroll.com','revcontent.com','mgid.com',
    'yektanet.com','sabavision.com','tapsell.ir','mediaad.org',
    'najva.com','pushe.co','tavoos.net','onetag.ir','deyakco.ir',
    'adverge.ir','chavosh.org','kaprila.com','sanjagh.com',
    'sorenad.com','popupdl.ir','adtrace.io','clickyab.com',
    'iran-ad.com','adtodate.ir',
  ]);

  function isAdNetworkUrl(url) {
    if (!url) return false;
    try {
      let hostname;
      if (url.startsWith('http') || url.startsWith('//')) {
        hostname = new URL(url.startsWith('//') ? 'https:' + url : url).hostname
          .toLowerCase()
          .replace(/^www\./, '');
      } else {
        return false;
      }
      if (AD_NETWORK_HOSTNAMES.has(hostname)) return true;
      // Check suffix match
      for (const network of AD_NETWORK_HOSTNAMES) {
        if (hostname.endsWith('.' + network)) return true;
      }
    } catch (_) {}
    return false;
  }

  const _imgChecked = new WeakSet();

  /**
   * Detects native banner ads using image dimension + link heuristics.
   * Generalized: works on any site without domain-specific rules.
   */
  function detectNativeBanners(root) {
    if (!root) return;

    const currentHost = window.location.hostname.replace(/^www\./, '').toLowerCase();
    const imgs = root.tagName === 'IMG'
      ? [root]
      : (root.querySelectorAll ? Array.from(root.querySelectorAll('img')) : []);

    for (const img of imgs) {
      if (_imgChecked.has(img)) continue;

      const w = img.naturalWidth  || parseInt(img.getAttribute('width')  || '0', 10);
      const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);

      // Defer check until image loads if dimensions unknown
      if (w === 0 && h === 0 && !img.complete) {
        img.addEventListener('load', () => detectNativeBanners(img), { once: true });
        continue;
      }

      _imgChecked.add(img);

      const link = img.closest('a[href]');
      if (!link) continue;

      const href = (link.getAttribute('href') || '').trim();
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;

      // Never block same-domain links
      try {
        const linkHost = new URL(href, location.origin).hostname
          .replace(/^www\./, '').toLowerCase();
        if (linkHost === currentHost) continue;
      } catch (_) { continue; }

      const rel      = link.getAttribute('rel') || '';
      const isNofollow = rel.includes('nofollow');
      const isBlank    = link.target === '_blank';
      const isAdNet    = isAdNetworkUrl(href);

      // Decision logic (any one condition = ad)
      const isAd = (
        isAdNet ||                                    // Links to known ad network
        (isNofollow && isBlank && isIABSize(w, h)) || // Classic native ad fingerprint
        (isIABSize(w, h) && /utm_|campaign|affiliate|click\.php|track\.php/i.test(href))
      );

      if (isAd) {
        const target = link.parentElement?.tagName === 'CENTER'
          ? link.parentElement
          : link;
        hideElement(target);
        log('Native banner blocked:', href);
      }
    }
  }

  // ============================================================
  // SECTION 9: TEXT-BASED AD BOX DETECTOR
  // Uses TreeWalker for zero-reflow text scanning
  // ============================================================

  // Normalize Persian/Arabic text for comparison
  function normalizeText(str) {
    if (typeof str !== 'string') return '';
    return str
      .normalize('NFKC')
      .replace(/[\u0640\u200B-\u200D\uFEFF\u200E\u200F]/g, '') // Kashida + invisible
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک')                  // Arabic → Persian
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Exact ad header labels (normalized)
  const AD_HEADER_LABELS = new Set([
    'تبلیغات', 'تبلیغ', 'آگهی', 'رپورتاژ آگهی',
    'تبلیغات متنی', 'تبلیغ متنی', 'حمایت از ما',
    'ads', 'ad', 'advertisement', 'advertisements',
    'sponsor', 'sponsors', 'sponsored', 'promoted',
    'partner content', 'brand content', 'paid content',
  ]);

  function isAdHeaderText(text) {
    return AD_HEADER_LABELS.has(normalizeText(text));
  }

  /**
   * Finds elements whose direct text content is an ad label,
   * then hides their containing wrapper.
   * Uses TreeWalker (native C++) for maximum speed.
   */
  function cleanupTextAdBoxes(root) {
    root = root || document.body;
    if (!root) return;

    let nodeCount = 0;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (++nodeCount > CFG.MAX_TREE_WALKER_NODES) return NodeFilter.FILTER_REJECT;
          const val = (node.nodeValue || '').trim();
          // Only short text nodes (ad labels are brief)
          if (val.length >= 2 && val.length < 50 && isAdHeaderText(val)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let textNode;
    while ((textNode = walker.nextNode())) {
      if (nodeCount > CFG.MAX_TREE_WALKER_NODES) break;

      const labelEl = textNode.parentElement;
      if (!labelEl) continue;

      // Climb ancestors to find the logical ad container
      // Stop when the container holds significant non-ad content
      const labelTextLen = normalizeText(labelEl.textContent).length;
      let wrapper = labelEl;
      let current = labelEl.parentElement;

      for (let depth = 0; depth < 6; depth++) {
        if (!current || current === document.body || current === document.documentElement) break;
        if (['MAIN','ARTICLE','NAV','HEADER','FOOTER','FORM'].includes(current.tagName)) break;

        const parentTextLen = normalizeText(current.textContent).length;
        // Stop climbing if parent has substantial additional content
        if (parentTextLen > labelTextLen + 40) break;

        // Don't climb past content-safeguarded elements
        const classStr = typeof current.className === 'string' ? current.className : '';
        const classId = `${classStr} ${current.id || ''}`;
        if (TIER3_HEURISTIC_PATTERNS.CONTENT_SAFEGUARD.test(classId)) break;

        wrapper = current;
        current = current.parentElement;
      }

      if (wrapper && wrapper !== document.body) {
        hideElement(wrapper);
        log('Text ad box hidden:', wrapper);
      }
    }
  }

  // ============================================================
  // SECTION 10: STRUCTURAL AD SWEEPER
  // Generalized class/ID pattern matching for dynamic ads
  // ============================================================

  /**
   * Scans elements with class/id attributes for ad patterns.
   * Strictly bounded to prevent false positives.
   */
  function structuralAdSweep(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;

    const elements = root.querySelectorAll('[class],[id]');
    const limit = Math.min(elements.length, CFG.MAX_STRUCTURAL_NODES);

    for (let i = 0; i < limit; i++) {
      const el = elements[i];
      const tag = el.tagName;

      // Only process safe structural tags
      if (!TIER3_HEURISTIC_PATTERNS.SAFE_TAGS.has(tag)) continue;
      if (el === document.body || el === document.documentElement) continue;
      if (el.hasAttribute('data-rastin-blocked')) continue;

      const classStr = typeof el.className === 'string' ? el.className : '';
      const idStr    = el.id || '';
      const combined = `${classStr} ${idStr}`;

      // Skip elements with content-class protection
      if (TIER3_HEURISTIC_PATTERNS.CONTENT_SAFEGUARD.test(combined)) continue;

      // Skip elements with substantial content (real articles, etc.)
      if ((el.textContent || '').length > 500) continue;

      if (
        TIER3_HEURISTIC_PATTERNS.CLASS_ID_REGEX.test(combined) ||
        TIER3_HEURISTIC_PATTERNS.PERSIAN_REGEX.test(combined)
      ) {
        hideElement(el);
        log('Structural sweep blocked:', tag, combined.trim());
      }
    }
  }

  // ============================================================
  // SECTION 11: MUTATION OBSERVER ENGINE
  // ============================================================

  let _observer     = null;
  let _scanTimeout  = null;

  function scheduleDebouncedFullScan() {
    if (_scanTimeout) clearTimeout(_scanTimeout);
    _scanTimeout = setTimeout(() => {
      fullPageScan();
    }, 500); // 500ms debounce
  }

  function startObserver() {
    if (_observer) return;
    _observer = new MutationObserver((mutations) => {
      let hasSignificantMutations = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          hasSignificantMutations = true;
          if (!IS_SENSITIVE_SITE) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) {
                const el = node;
                if (el.matches && el.matches('[class*="anti-adblock" i], [id*="anti-adblock" i], [class*="adblock-modal" i], [id*="adblock-modal" i], [class*="adblock-warning" i], [id*="adblock-warning" i], [class*="blocker-dialog" i], [id*="blocker-dialog" i]')) {
                  const text = el.textContent || '';
                  if (ANTI_ADBLOCK_REGEX.test(text)) {
                    el.textContent = '';
                    hideElement(el);
                  }
                }
              }
            }
          }
        }
      }
      if (hasSignificantMutations) {
        scheduleDebouncedFullScan();
      }
    });

    _observer.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });

    if (!IS_SENSITIVE_SITE && window.NativePatchRegistry) {
      const checkAddedNode = (node) => {
        if (!node || node.nodeType !== 1) return;
        try {
          if (node.matches && node.matches('[class*="anti-adblock" i], [id*="anti-adblock" i], [class*="adblock-modal" i], [id*="adblock-modal" i], [class*="adblock-warning" i], [id*="adblock-warning" i], [class*="blocker-dialog" i], [id*="blocker-dialog" i]')) {
            const text = node.textContent || '';
            if (ANTI_ADBLOCK_REGEX.test(text)) {
              node.textContent = '';
              hideElement(node);
            }
          }
        } catch (_) {}
      };

      window.NativePatchRegistry.patch(Node.prototype, 'appendChild', (orig) => {
        return function (child) {
          const res = orig.call(this, child);
          checkAddedNode(child);
          return res;
        };
      }, 'adblock_engine_append');

      window.NativePatchRegistry.patch(Element.prototype, 'append', (orig) => {
        return function (...nodes) {
          const res = orig.apply(this, nodes);
          nodes.forEach(checkAddedNode);
          return res;
        };
      }, 'adblock_engine_append');
    }
  }

  // ============================================================
  // SECTION 12: FULL-PAGE SCANNER
  // ============================================================

  let _scanScheduled = false;

  /**
   * Full DOM scan using requestIdleCallback for non-blocking execution.
   * Falls back to chunked setTimeout if rIC not available.
   */
  function fullPageScan() {
    if (_scanScheduled) return;
    _scanScheduled = true;

    const run = () => {
      _scanScheduled = false;

      // On media platforms (YouTube etc.) the generic cosmetic layer collapses
      // real UI (masthead, player chrome), so skip CSS injection and the
      // imperative sweep entirely. Video-ad handling there is done by
      // adblock_advanced.js. Only anti-adblock/scroll-lock recovery still runs.
      if (!IS_SENSITIVE_SITE) {
        // CSS injection (always up-to-date)
        CSSInjector.inject();

        // Imperative passes (catch anything CSS missed)
        for (const chunk of Cache.queryChunks) {
          try {
            document.querySelectorAll(chunk).forEach(hideElement);
          } catch (_) {}
        }

        detectNativeBanners(document.body);
        cleanupTextAdBoxes(document.body);
        structuralAdSweep(document.body);
      }

      killAntiAdblockMessages();
      restoreScrollLock();
    };

    if (window.requestIdleCallback) {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 100);
    }
  }

  // ============================================================
  // SECTION 13: DYNAMIC RULES LOADER
  // ============================================================

  function loadDynamicRules() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    try {
      chrome.runtime.sendMessage({ action: 'getCosmeticRules' }, (response) => {
        if (chrome.runtime.lastError || !response?.data) return;

        const data = response.data;
        const extra = [];

        if (Array.isArray(data.generic)) {
          extra.push(...data.generic);
        }

        if (data.specific && typeof data.specific === 'object') {
          const parts = location.hostname.toLowerCase().split('.');
          // Check all subdomain combinations
          for (let i = 0; i < parts.length - 1; i++) {
            const domain = parts.slice(i).join('.');
            if (Array.isArray(data.specific[domain])) {
              extra.push(...data.specific[domain]);
            }
          }
        }

        if (extra.length > 0) {
          CSSInjector.inject(extra);
          log('Dynamic rules loaded:', extra.length);
        }
      });
    } catch (e) {
      log('Dynamic rules load failed:', e);
    }
  }

  function loadCustomRules() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    chrome.storage.local.get({ customRules: {} }, (items) => {
      if (chrome.runtime?.lastError) return;
      const rules = items.customRules?.[location.hostname] || [];
      CSSInjector.injectCustom(rules);
      if (rules.length > 0) {
        log('Custom rules loaded:', rules.length);
      }
    });
  }

  // ============================================================
  // SECTION 14: MESSAGE HANDLER
  // ============================================================

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.action) {
        case 'refreshCosmeticFilters': loadDynamicRules();  break;
        case 'refreshCustomRules':     loadCustomRules();   break;
        case 'fullRescan':             fullPageScan();      break;
        case 'updateSettings':
          if (message.settings && message.settings.adBlockGapRemover !== undefined) {
            _gapRemoverEnabled = message.settings.adBlockGapRemover;
          }
          // Re-evaluate whether the engine should be running and start/stop it
          // so toggling adblock off in the popup actually tears the engine down.
          evaluateAndApply();
          break;
      }
    });
  }

  // ============================================================
  // SECTION 15: INITIALIZATION
  // ============================================================

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Step 1: Inject CSS immediately (blocks rendering of ads).
    // Skipped on media platforms where generic selectors collapse real UI.
    if (!IS_SENSITIVE_SITE) CSSInjector.inject();

    // Step 2: Start observing DOM mutations
    startObserver();

    // Step 3: Load dynamic rules (after tiny delay to not block parse)
    setTimeout(loadDynamicRules, CFG.DYNAMIC_RULES_DELAY);

    // Step 4: Full scan on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', fullPageScan, { once: true });

    // Step 5: Additional scans after load (late-injected ads)
    window.addEventListener('load', () => {
      CFG.LOAD_RESCAN_DELAYS.forEach(delay => setTimeout(fullPageScan, delay));
    }, { once: true });

    // Step 6: Scroll handler for popup/scroll-triggered ads
    window.addEventListener('scroll', restoreScrollLock, { passive: true });

    log('Initialized on:', location.hostname);
  }

  // Reverse init(): stop observing, remove injected stylesheets, and restore
  // elements this engine hid/collapsed. Best-effort — we only clear the inline
  // properties we set ourselves.
  function teardown() {
    if (!_initialized) return;
    _initialized = false;

    if (_observer) { try { _observer.disconnect(); } catch (_) {} _observer = null; }
    if (_scanTimeout) { clearTimeout(_scanTimeout); _scanTimeout = null; }
    window.removeEventListener('scroll', restoreScrollLock);

    document.querySelectorAll(`style[${CFG.CSS_INJECTION_ATTR}], style[data-rastin-custom]`)
      .forEach(el => { try { el.remove(); } catch (_) {} });

    const restoreEl = (el) => {
      try {
        if (el.hasAttribute('data-orig-style')) {
          const origStyle = el.getAttribute('data-orig-style');
          if (origStyle) {
            el.setAttribute('style', origStyle);
          } else {
            el.removeAttribute('style');
          }
          el.removeAttribute('data-orig-style');
        } else {
          ['display', 'visibility', 'height', 'overflow', 'margin', 'padding'].forEach(p => el.style.removeProperty(p));
        }
        el.removeAttribute('data-rastin-blocked');
        el.removeAttribute('data-rastin-collapsed');
      } catch (_) {}
    };

    document.querySelectorAll('[data-rastin-blocked]').forEach(restoreEl);
    document.querySelectorAll('[data-rastin-collapsed]').forEach(restoreEl);

    log('Torn down on:', location.hostname);
  }

  // ============================================================
  // SECTION 16: EXTENSION SETTINGS CHECK & ENTRY POINT
  // ============================================================


  // No extension API → run in standalone mode immediately
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    log('Standalone mode');
    init();
    return;
  }

  // Extension mode → check settings first
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const hostKey = 'site_config_' + host;

  function evaluateAndApply() {
    chrome.storage.local.get(null, (allStorage) => {
    if (chrome.runtime?.lastError) {
      // Can't read settings. Don't force the engine on against the user's
      // wishes — if it was already running keep it; otherwise stay off.
      log('Storage error, leaving engine state unchanged');
      return;
    }

    // Load global settings
    const globalEnabled = allStorage.enabled !== false;
    const globalAdBlockEnabled = allStorage.adBlockEnabled !== false;
    const adBlockCosmetic = allStorage.adBlockCosmetic !== false;
    const adBlockGapRemover = allStorage.adBlockGapRemover !== false;
    const disabledAdBlockDomains = allStorage.disabledAdBlockDomains || [];

    // Load site-specific settings
    const siteConfig = allStorage[hostKey] || {};
    const siteEnabled = siteConfig.enabled !== false;
    const siteAdBlockEnabled = siteConfig.adBlockEnabled !== false;

    _gapRemoverEnabled = adBlockGapRemover;

    // Check if adblock is disabled for this site
    const isAdBlockDisabledForSite = disabledAdBlockDomains.some(d => {
      const dom = d.toLowerCase().replace(/^www\./, '');
      return host === dom || host.endsWith('.' + dom);
    });

    const shouldRunAdBlock = globalEnabled &&
                             globalAdBlockEnabled &&
                             adBlockCosmetic &&
                             siteEnabled &&
                             siteAdBlockEnabled &&
                             !isAdBlockDisabledForSite;

    // Load custom zapper rules if either core features or adblock is enabled
    if (globalEnabled && (siteEnabled || shouldRunAdBlock)) {
      loadCustomRules();
      document.addEventListener('rastin-rtl-rules-updated', loadCustomRules);
    }

    if (shouldRunAdBlock) {
      init();
    } else {
      // User turned adblock off (globally or for this site) → reverse it.
      teardown();
    }
    });
  }

  chrome.storage.onChanged?.addListener((_changes, areaName) => {
    if (areaName === 'local') evaluateAndApply();
  });

  evaluateAndApply();

})();