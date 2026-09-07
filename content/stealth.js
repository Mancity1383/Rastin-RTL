/**
 * Rastin RTL - Stealth / Anti-Anti-Adblocker Module (MAIN WORLD)
 * Injected into MAIN WORLD at document_start.
 * Synchronously intercepts tracking network requests (Clarity, Adobe DTM, Plausible,
 * Matomo, Facebook connect, Quora, Reddit, Datadog, Raygun, Rollbar, NewRelic)
 * and shields DOM against anti-adblock attacks.
 */
(function () {
  'use strict';

  // YouTube's first-party player/measurement requests must not be terminated:
  // doing so can make the player retry the same ad. A dedicated MAIN-world
  // interceptor prunes player metadata without breaking the request lifecycle.
  const rastinHost = location.hostname.toLowerCase();
  if (rastinHost === 'youtube.com' || rastinHost.endsWith('.youtube.com') ||
      rastinHost === 'youtube-nocookie.com' || rastinHost.endsWith('.youtube-nocookie.com') ||
      rastinHost === 'youtu.be') {
    return;
  }

  function isExtensionActive() {
    try {
      return localStorage.getItem('rastin_adblock_active') !== 'false';
    } catch (_) {
      return true;
    }
  }

  if (!isExtensionActive()) return;

  let _bodySnapshot = null;
  let _rastinAttackDetected = false;

  // ─── 0. Universal Tracking & Ad Domain Blocker ─────────────────────────
  const AD_AND_TRACKING_REGEX = /(?:googlesyndication\.com|googleadservices\.com|adservice\.google|doubleclick\.net|yandex\.ru|yastatic\.net|clarity\.ms|adobedtm\.com|plausible\.io|matomo\.cloud|connect\.facebook\.net|www\.facebook\.com|alb\.reddit\.com|q\.quora\.com|datadoghq\.eu|datadoghq\.com|raygun\.io|rollbar\.com|nr-data\.net|newrelic\.com|sc-static\.net|logrocket\.com|baidustatic\.com|baidu\.com|vk-ads\.com|mail\.ru|privacy-center\.org|\/ads?\.js|\/ad_|\/banner_|\/popunder)/i;

  const fireScriptError = (script) => {
    try {
      script.type = 'javascript/blocked';
      script.removeAttribute('src');
      setTimeout(() => {
        try {
          const errEvent = new Event('error', { bubbles: false, cancelable: false });
          script.dispatchEvent(errEvent);
          if (typeof script.onerror === 'function') {
            script.onerror(errEvent);
          }
        } catch (_) {}
      }, 0);
    } catch (_) {}
  };

  // Block sendBeacon requests to tracking domains
  const _origSendBeacon = navigator.sendBeacon;
  if (_origSendBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (typeof url === 'string' && AD_AND_TRACKING_REGEX.test(url)) {
        console.log('[Rastin RTL] Blocked tracking sendBeacon:', url);
        return true;
      }
      return _origSendBeacon.apply(this, arguments);
    };
  }

  // Block fetch requests to tracking domains
  const _origFetch = window.fetch;
  if (_origFetch) {
    window.fetch = function (resource, config) {
      const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
      if (url && AD_AND_TRACKING_REGEX.test(url)) {
        console.log('[Rastin RTL] Blocked tracking fetch:', url);
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return _origFetch.apply(this, arguments);
    };
  }

  // Block XHR requests to tracking domains
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  if (_origXhrOpen) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this._rastinBlocked = typeof url === 'string' && AD_AND_TRACKING_REGEX.test(url);
      if (this._rastinBlocked) {
        console.log('[Rastin RTL] Blocked tracking XHR:', url);
      }
      return _origXhrOpen.apply(this, arguments);
    };

    const _origXhrSend = XMLHttpRequest.prototype.send;
    if (_origXhrSend) {
      XMLHttpRequest.prototype.send = function (body) {
        if (this._rastinBlocked) {
          try { this.abort(); } catch (_) {}
          return;
        }
        return _origXhrSend.apply(this, arguments);
      };
    }
  }

  // Block script/iframe/img src assignments to tracking domains
  const _origScriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (_origScriptSrcDesc && _origScriptSrcDesc.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      get: _origScriptSrcDesc.get,
      set: function (url) {
        if (typeof url === 'string' && AD_AND_TRACKING_REGEX.test(url)) {
          console.log('[Rastin RTL] Blocked ad/tracking script src:', url);
          fireScriptError(this);
          return;
        }
        _origScriptSrcDesc.set.call(this, url);
      },
      configurable: true
    });
  }

  const checkTrackingNode = (node) => {
    if (!node || node.nodeType !== 1) return;
    try {
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (tag === 'SCRIPT') {
        const src = node.src || node.getAttribute?.('src') || '';
        if (src && AD_AND_TRACKING_REGEX.test(src)) {
          console.log('[Rastin RTL] Blocked ad/tracking script node insertion:', src);
          fireScriptError(node);
        }
      } else if (tag === 'IFRAME' || tag === 'IMG') {
        const src = node.src || node.getAttribute?.('src') || '';
        if (src && AD_AND_TRACKING_REGEX.test(src)) {
          console.log('[Rastin RTL] Blocked tracking node insertion:', src);
          node.removeAttribute('src');
          node.src = 'about:blank';
        }
      }
    } catch (_) {}
  };

  const _origAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (child) {
    checkTrackingNode(child);
    return _origAppendChild.call(this, child);
  };

  const _origInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, refNode) {
    checkTrackingNode(newNode);
    return _origInsertBefore.call(this, newNode, refNode);
  };

  // ─── 1. Spoof Google AdSense Array ──────────────────────────────
  if (!window.adsbygoogle) {
    const _arr = [];
    try {
      Object.defineProperty(window, 'adsbygoogle', {
        get: () => _arr,
        set: (v) => { if (Array.isArray(v)) _arr.push(...v); },
        configurable: true,
        enumerable: true
      });
      _arr.push = function (cfg) { Array.prototype.push.call(_arr, cfg); };
      _arr.loaded = true;
    } catch (_) {}
  }

  // ─── 2. Spoof Google Publisher Tag (GPT) ─────────────────────────
  if (!window.googletag) {
    const _slots = {};
    const _pubads = {
      enableSingleRequest: () => {},
      collapseEmptyDivs: () => {},
      enableLazyLoad: () => {},
      setTargeting: () => _pubads,
      clearTargeting: () => _pubads,
      addEventListener: () => {},
      removeEventListener: () => {},
      refresh: () => {},
      disableInitialLoad: () => {},
      enableServices: () => {},
      getSlots: () => []
    };
    window.googletag = {
      cmd: [],
      _slots: _slots,
      defineSlot: (path, sizes, div) => {
        const slot = {
          addService: () => slot,
          setTargeting: () => slot,
          clearTargeting: () => slot,
          getAdUnitPath: () => path,
          getSlotElementId: () => div
        };
        _slots[div] = slot;
        return slot;
      },
      defineOutOfPageSlot: (path, div) => window.googletag.defineSlot(path, [], div || path),
      pubads: () => _pubads,
      enableServices: () => {},
      display: () => {},
      destroySlots: () => true,
      sizeMapping: () => ({ addSize: function () { return this; }, build: () => [] }),
      companionAds: () => ({ enableSyncLoading: () => {} })
    };
    window.googletag.cmd.push = (fn) => { try { fn(); } catch (_) {} };
  }

  // ─── 3. Spoof Google Analytics / gtag ────────────────────────────
  if (!window.ga) {
    window.ga = function () {};
    window.ga.q = [];
    window.ga.l = Date.now();
    window.GoogleAnalyticsObject = 'ga';
  }
  if (!window.gtag) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
  }

  // ─── 4. Document.write / document.open Blocker ───────────────────
  let _documentClosed = false;
  const _origDocWrite = document.write;
  const _origDocWriteln = document.writeln;
  const _origDocOpen = document.open;

  document.addEventListener('DOMContentLoaded', () => { _documentClosed = true; }, { once: true });

  function filterAdHtml(html) {
    if (typeof html !== 'string' || !html) return html;
    if (/(?:fluidplayer|popads|popcash|adcash|exoclick|adsterra|propellerads|doubleclick|googlesyndication|yektanet|tapsell)/i.test(html)) {
      const clean = html.replace(/<script[^>]*src=["'][^"']*(?:fluidplayer|popads|popcash|adcash|exoclick|adsterra|propellerads|doubleclick|googlesyndication|yektanet|tapsell)[^"']*["'][^>]*><\/script>/gi, '');
      return clean;
    }
    return html;
  }

  document.write = function (html) {
    if (_documentClosed) return;
    const cleanHtml = filterAdHtml(html);
    if (cleanHtml === '' || cleanHtml === undefined) return;
    try {
      return _origDocWrite.call(this, cleanHtml);
    } catch (_) {}
  };
  document.writeln = function (html) {
    if (_documentClosed) return;
    const cleanHtml = filterAdHtml(html);
    if (cleanHtml === '' || cleanHtml === undefined) return;
    try {
      return _origDocWriteln.call(this, cleanHtml);
    } catch (_) {}
  };
  document.open = function () {
    if (_documentClosed) return document;
    return _origDocOpen.apply(this, arguments);
  };

  // ─── 5. Absolute Content Shield (innerHTML / innerText / textContent) ──
  const AD_WARNINGS = [
    'افزونه حذف تبلیغات',
    'disable your ad blocker',
    'disable your adblocker',
    'turn off adblock',
    'adblock detected',
    'ad blocker detected'
  ];

  function isDestructiveAdblockWarning(text) {
    if (typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    if (AD_WARNINGS.some(w => lower.includes(w))) return true;
    const hasAdBlockTerm = lower.includes('adblock') || lower.includes('ad blocker') || lower.includes('حذف تبلیغات') || lower.includes('فیلترشکن');
    const hasDisableTerm = lower.includes('disable') || lower.includes('turn off') || lower.includes('غیرفعال') || lower.includes('خاموش');
    if (hasAdBlockTerm && hasDisableTerm) return true;
    return false;
  }

  function isProtectedContainer(el) {
    try {
      if (el === document.body || el === document.documentElement) return true;
      if (el.id === 'fbd') return true;
      if (el.classList && el.classList.contains('cbd')) return true;
    } catch (_) {}
    return false;
  }

  function isLikelyAdblockWarningTarget(el) {
    try {
      if (isProtectedContainer(el)) return true;
      if (!el || el.nodeType !== 1) return false;
      const identity = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute?.('role') || ''}`;
      return /ad.?block|anti.?ad|disable.?ad|whitelist|advert|modal|dialog|overlay/i.test(identity);
    } catch (_) {
      return false;
    }
  }

  const _origInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const _origInnerHTMLSet = _origInnerHTMLDesc && _origInnerHTMLDesc.set;
  const _origInnerHTMLGet = _origInnerHTMLDesc && _origInnerHTMLDesc.get;

  if (_origInnerHTMLDesc && _origInnerHTMLSet) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      get: _origInnerHTMLDesc.get,
      set: function (val) {
        if (!isLikelyAdblockWarningTarget(this)) {
          _origInnerHTMLSet.call(this, val);
          return;
        }
        let valStr;
        if (typeof val === 'string') {
          valStr = val;
        } else if (window.TrustedHTML && val instanceof TrustedHTML) {
          valStr = val.toString();
        } else {
          valStr = String(val || '');
        }

        if (isDestructiveAdblockWarning(valStr)) {
          _rastinAttackDetected = true;
          window._rastinAttack = true;
          if (document.body) document.body.style.removeProperty('overflow');
          document.documentElement.style.removeProperty('overflow');
          return;
        }

        if (isProtectedContainer(this)) {
          const currentLen = (_origInnerHTMLGet ? _origInnerHTMLGet.call(this) : '').length;
          if (currentLen > 1000 && valStr.length < 150) {
            _rastinAttackDetected = true;
            window._rastinAttack = true;
            return; // Block destructive shrink
          }
        }

        _origInnerHTMLSet.call(this, val);
      },
      configurable: true
    });
  }

  // ─── 6. DOM Watchdog & Body Snapshot Backup Protection ───────────
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (document.body && _origInnerHTMLGet) {
        try {
          const snap = _origInnerHTMLGet.call(document.body);
          if (snap && snap.length > 3000) {
            _bodySnapshot = snap;
          }
        } catch (_) {}
      }
    }, 1500);
  });

  setInterval(() => {
    if (_rastinAttackDetected || window._rastinAttack) {
      if (document.body) {
        if (document.body.style.pointerEvents === 'none') document.body.style.removeProperty('pointer-events');
        document.body.style.removeProperty('overflow');
      }
      if (document.documentElement) {
        if (document.documentElement.style.pointerEvents === 'none') document.documentElement.style.removeProperty('pointer-events');
        document.documentElement.style.removeProperty('overflow');
      }
    } else {
      if (!document.body || !_bodySnapshot || !_origInnerHTMLGet) return;
      try {
        const current = _origInnerHTMLGet.call(document.body);
        if (_bodySnapshot.length > 3000 && current.length < 500) {
          console.log('[Rastin RTL] Anti-adblock attack detected! Restoring DOM snapshot.');
          _rastinAttackDetected = true;
          window._rastinAttack = true;
          if (_origInnerHTMLSet) {
            _origInnerHTMLSet.call(document.body, _bodySnapshot);
          }
          if (document.body) document.body.style.removeProperty('overflow');
          if (document.documentElement) document.documentElement.style.removeProperty('overflow');
        }
      } catch (_) {}
    }
  }, 800);

  // ─── 7. Stylesheet & Node Removal Protection ────────────────────
  try {
    const _origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && (child.id === 'rastin-rtl-theme-core' || child.id === 'rtl-fixer-dynamic-variables' || child.id === 'rtl-fixer-font-import' || child.id === 'rastin-rtl-v3')) {
        console.log('[Rastin RTL] Blocked removal of critical stylesheet:', child.id);
        return child;
      }
      return _origRemoveChild.apply(this, arguments);
    };

    const _origRemove = Element.prototype.remove;
    if (_origRemove) {
      Element.prototype.remove = function () {
        if (this && (this.id === 'rastin-rtl-theme-core' || this.id === 'rtl-fixer-dynamic-variables' || this.id === 'rtl-fixer-font-import' || this.id === 'rastin-rtl-v3')) {
          console.log('[Rastin RTL] Blocked removal of critical stylesheet:', this.id);
          return;
        }
        return _origRemove.apply(this, arguments);
      };
    }
  } catch (_) {}

  // ─── 8. Download Link Protection & Click Hijack Defuser ──────────
  function isDownloadLink(a) {
    if (!a || !a.href) return false;
    try {
      const url = new URL(a.href, window.location.href);
      const pathname = url.pathname.toLowerCase();
      if (/\.(zip|rar|exe|msi|dmg|tar|gz|7z|pdf|epub|mp4|mp3|apk)$/i.test(pathname)) {
        return true;
      }
      if (pathname.includes('/redirect/') || pathname.includes('/download') || url.searchParams.has('download') || a.hasAttribute('download')) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    if (isDownloadLink(a) || _rastinAttackDetected || window._rastinAttack) {
      try {
        const url = new URL(a.href, window.location.href);
        if (url.pathname === window.location.pathname && url.hash) return;
      } catch (_) {}
      e.stopImmediatePropagation();
    }
  }, true);

  try {
    const _origPreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (this.type === 'click') {
        const a = this.target && this.target.closest ? this.target.closest('a') : null;
        if (a && a.href && (isDownloadLink(a) || _rastinAttackDetected || window._rastinAttack)) {
          if (!a.href.startsWith('javascript:') && !a.getAttribute('href').startsWith('#')) {
            return;
          }
        }
      }
      return _origPreventDefault.apply(this, arguments);
    };
  } catch (_) {}
})();
