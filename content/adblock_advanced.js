/**
 * Rastin RTL - Advanced Ad Blocker Module (MAIN WORLD)
 * Event-driven lifecycle with NativePatchRegistry and DisposableScope.
 * YouTube ad handling delegated to YouTubeAdAdapter.
 */
(function () {
  'use strict';

  let currentGeneration = -1;
  let isActive = false;
  let scope = null;
  let fallbackOriginals = null;

  function handleStateChange(event) {
    if (!event || !event.detail || typeof event.detail !== 'object') return;
    const { adBlockEnabled, globalEnabled, isSensitiveSite, generation } = event.detail;

    if (typeof generation === 'number' && generation <= currentGeneration) {
      return;
    }
    currentGeneration = generation || (currentGeneration + 1);

    const nextState = globalEnabled !== false && adBlockEnabled !== false && !isSensitiveSite;

    if (nextState && !isActive) {
      startAdvanced();
    } else if (!nextState && isActive) {
      stopAdvanced();
    }
  }

  function startAdvanced() {
    if (isActive) return;
    isActive = true;
    scope = window.DisposableScope ? new window.DisposableScope('AdblockAdvanced') : null;

    // 1. Popup & Popunder Interception via NativePatchRegistry with direct fallback
    const origOpen = window.open;
    const patchedOpen = function (url, name, specs) {
      if (typeof url === 'string') {
        const lowerUrl = url.toLowerCase();
        const isAdDomain = /(?:yektanet|sabavision|mediaad|tavoos|tapsell|doubleclick|googlesyndication|par30games\.net\/click)/i.test(lowerUrl);
        const isAdKeyword = /(?:^|[\/\?&#\.\-=])(?:ad|ads|banner|popunder|click|tracking|telemetry|analytics)(?:[\/\?&#\.\-=]|$)/i.test(lowerUrl);
        if (isAdDomain || isAdKeyword) {
          console.log('[Rastin RTL] Blocked popunder:', url);
          return null;
        }
      }
      return origOpen.apply(this, arguments);
    };

    if (window.NativePatchRegistry) {
      window.NativePatchRegistry.patch(window, 'open', () => patchedOpen, 'adblock_advanced');
    } else {
      fallbackOriginals = { open: origOpen };
      try {
        Object.defineProperty(window, 'open', {
          value: patchedOpen,
          writable: true,
          configurable: true,
          enumerable: true
        });
      } catch (_) {
        window.open = patchedOpen;
      }
    }

    // 2. Synchronous Anti-Adblock Text Shield for Warning Dialogs
    const checkAddedNode = (node) => {
      if (!node || node.nodeType !== 1) return;
      try {
        if (node.matches && node.matches('[class*="anti-adblock" i], [id*="anti-adblock" i], [class*="adblock-modal" i], [id*="adblock-modal" i], [class*="adblock-warning" i], [id*="adblock-warning" i], [class*="blocker-dialog" i], [id*="blocker-dialog" i]')) {
          const text = node.textContent || '';
          if (/please\s+disable\s+(?:your\s+)?ad\s*blocker|ad\s*blocker\s+detected|turn\ off\ ad\s*blocker/i.test(text)) {
            node.textContent = '';
            node.style.display = 'none';
          }
        }
      } catch (_) {}
    };

    const origAppend = Element.prototype.append;
    const patchedAppend = function (...nodes) {
      const res = origAppend.apply(this, nodes);
      nodes.forEach(checkAddedNode);
      return res;
    };

    const origAppendChild = Node.prototype.appendChild;
    const patchedAppendChild = function (child) {
      const res = origAppendChild.call(this, child);
      checkAddedNode(child);
      return res;
    };

    if (window.NativePatchRegistry) {
      window.NativePatchRegistry.patch(Element.prototype, 'append', () => patchedAppend, 'adblock_advanced');
      window.NativePatchRegistry.patch(Node.prototype, 'appendChild', () => patchedAppendChild, 'adblock_advanced');
    } else {
      fallbackOriginals = {
        ...(fallbackOriginals || {}),
        append: origAppend,
        appendChild: origAppendChild,
        patchedAppend,
        patchedAppendChild,
        patchedOpen
      };
      Element.prototype.append = patchedAppend;
      Node.prototype.appendChild = patchedAppendChild;
    }

    // 3. Tracking Parameter Stripping from URL
    try {
      if (location.search && /(?:utm_source|utm_medium|utm_campaign|fbclid|gclid)=/i.test(location.search)) {
        const cleanSearch = location.search
          .replace(/[\?&](?:utm_[^&]+|fbclid|gclid)=[^&]*/gi, '')
          .replace(/^&/, '?');
        const cleanUrl = location.pathname + cleanSearch + location.hash;
        history.replaceState(history.state, '', cleanUrl);
      }
    } catch (_) {}

    // 3. Cookie & YouTube Dialog Auto-Confirm Handler
    const hostname = location.hostname.toLowerCase();
    const isYouTube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    const isSoft98 = hostname === 'soft98.ir' || hostname.endsWith('.soft98.ir');
    const checkConfirmDialogs = () => {
      if (document.visibilityState === 'hidden') return;
      function findInShadows(selector, root = document, depth = 0, seen = new WeakSet()) {
        if (depth > 5 || !root) return null;
        let found = null;
        try {
          found = root.querySelector(selector);
          if (found) return found;
          const walk = (node, currentDepth) => {
            if (currentDepth > 5 || found) return;
            let child = node.firstElementChild;
            while (child) {
              if (child.shadowRoot && !seen.has(child.shadowRoot)) {
                seen.add(child.shadowRoot);
                found = findInShadows(selector, child.shadowRoot, currentDepth + 1, seen);
                if (found) return;
              }
              walk(child, currentDepth + 1);
              if (found) return;
              child = child.nextElementSibling;
            }
          };
          walk(root, depth);
        } catch (_) {}
        return found || null;
      }

      if (isYouTube || document.querySelector('ytd-popup-container, ytd-app')) {
        try {
          const confirmDialog = findInShadows('yt-confirm-dialog-renderer');
          if (confirmDialog) {
            const confirmBtn = findInShadows('button, [class*="confirm" i]', confirmDialog);
            if (confirmBtn && typeof confirmBtn.click === 'function') {
              confirmBtn.click();
            }
          }
        } catch (_) {}
      }

      const rejectBtn = document.querySelector(
        '[id*="cookie" i] button[id*="reject" i], [id*="cookie" i] button[class*="reject" i], ' +
        '[class*="cookie" i] button[id*="reject" i], [class*="cookie" i] button[class*="reject" i], ' +
        '[id*="consent" i] button[id*="deny" i], [class*="consent" i] button[class*="deny" i]'
      );
      if (rejectBtn && typeof rejectBtn.click === 'function') {
        try { rejectBtn.click(); } catch (_) {}
      }

      // This expensive text sweep is only relevant on Soft98.
      if (isSoft98) {
        try {
          const antiAdblockNodes = document.querySelectorAll('div, p, td, section');
          for (const el of antiAdblockNodes) {
            if (!el || el.children.length > 20) continue;
            const txt = el.textContent || '';
            if (txt.length < 500 && (txt.includes('افزونه حذف تبلیغات') || txt.includes('استفاده رایگان از محتوای سایت') || txt.includes('adblocker را غیرفعال'))) {
              const box = (el.tagName === 'P' || el.tagName === 'SPAN') ? (el.closest('div, td, section') || el) : el;
              box.textContent = '';
              box.style.setProperty('display', 'none', 'important');
              box.style.setProperty('height', '0', 'important');
              box.style.setProperty('margin', '0', 'important');
              box.style.setProperty('padding', '0', 'important');
            }
          }
        } catch (_) {}
      }
    };

    if (scope) scope.setInterval(checkConfirmDialogs, 2000);
    else setInterval(checkConfirmDialogs, 2000);
  }

  function stopAdvanced() {
    if (!isActive) return;
    isActive = false;
    scope?.dispose();
    scope = null;

    if (window.NativePatchRegistry) {
      window.NativePatchRegistry.restore('adblock_advanced');
    } else if (fallbackOriginals) {
      if (window.open === fallbackOriginals.patchedOpen) window.open = fallbackOriginals.open;
      if (Element.prototype.append === fallbackOriginals.patchedAppend) {
        Element.prototype.append = fallbackOriginals.append;
      }
      if (Node.prototype.appendChild === fallbackOriginals.patchedAppendChild) {
        Node.prototype.appendChild = fallbackOriginals.appendChild;
      }
      fallbackOriginals = null;
    }
  }

  window.addEventListener('rastin-extension-state', handleStateChange);

  try {
    window.dispatchEvent(new CustomEvent('rastin-main-ready'));
  } catch (_) {}

  try {
    if (localStorage.getItem('rastin_adblock_active') !== 'false' &&
        !['youtube.com', 'aparat.com', 'telewebion.com', 'netflix.com'].some(d => location.hostname.includes(d))) {
      startAdvanced();
    }
  } catch (_) {}
})();
