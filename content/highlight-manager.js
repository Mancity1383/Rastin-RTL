// Highlight & Notes Pro - Content Script Manager
window.RtlFixer = window.RtlFixer || {};
if (window.RtlFixer && window.RtlFixer.DEBUG) console.log('[Rastin RTL Highlight] highlight-manager.js file loaded and evaluating');

(function (RtlFixer) {
  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS & UI SELECTORS
  // ═══════════════════════════════════════════════════════════════════════════
  const COLOR_MAP = {
    '#fef08a': 'color-yellow',
    '#bbf7d0': 'color-green',
    '#fecdd3': 'color-red',
    '#fecaca': 'color-red',
    '#bfdbfe': 'color-blue',
    '#e9d5ff': 'color-purple'
  };

  const BG_COLORS = {
    'color-yellow': 'rgba(254, 240, 138, 0.4)',
    'color-green':  'rgba(187, 247, 208, 0.4)',
    'color-red':    'rgba(254, 205, 211, 0.4)',
    'color-blue':   'rgba(191, 219, 254, 0.4)',
    'color-purple': 'rgba(233, 213, 255, 0.4)'
  };

  const COLOR_NAME_MAP = {
    '#fef08a': 'yellow',
    '#bbf7d0': 'green',
    '#fecaca': 'red',
    '#fecdd3': 'red',
    '#bfdbfe': 'blue',
    '#e9d5ff': 'purple'
  };

  // config.highlightColor / legacy records store colour *names*, everything else
  // stores hex. Normalize both into the canonical hex used by COLOR_MAP.
  const NAME_TO_HEX = {
    yellow: '#fef08a',
    green:  '#bbf7d0',
    red:    '#fecaca',
    pink:   '#fecdd3',
    blue:   '#bfdbfe',
    purple: '#e9d5ff'
  };

  const RASTIN_UI_SELECTOR = [
    '#rastin-highlight-bar',
    '.rastin-note',
    '#rastin-hub-drawer',
    '#rastin-radar-container',
    '#rastin-toast-container'
  ].join(',');

  // ═══════════════════════════════════════════════════════════════════════════
  // RASTIN UI EVENT GUARD HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  function getEventElement(event) {
    if (!event) return null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const pathElement = path.find(node => node && node.nodeType === Node.ELEMENT_NODE);
    if (pathElement) return pathElement;
    return event.target?.nodeType === Node.TEXT_NODE ? event.target.parentElement : event.target;
  }

  function isRastinUiEvent(event) {
    if (!event) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.some(node => node instanceof Element && node.matches?.(RASTIN_UI_SELECTOR))) {
      return true;
    }
    return Boolean(getEventElement(event)?.closest?.(RASTIN_UI_SELECTOR));
  }

  function hasCSSHighlights() {
    return typeof CSS !== 'undefined' && !!CSS.highlights;
  }

  function getColorClass(hex) {
    return COLOR_MAP[(hex || '').toLowerCase()] || 'color-yellow';
  }

  // Accepts a hex ('#fef08a') or a colour name ('yellow') and returns canonical hex.
  function normalizeColorHex(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (COLOR_MAP[v]) return v;
    if (NAME_TO_HEX[v]) return NAME_TO_HEX[v];
    return null;
  }

  function getColorName(value) {
    const hex = normalizeColorHex(value);
    if (hex && COLOR_NAME_MAP[hex]) return COLOR_NAME_MAP[hex];
    return getColorClass(hex).replace('color-', '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  let highlightBar = null;
  let activeRange = null;
  let activeHighlightId = null;
  let currentSelectionText = "";
  let activeSelectionCoords = null;
  let mouseMoveRafId = null;
  let isRestoring = false;
  let resizeTimeout = null;
  let isDraggingBar = false;
  let justFinishedDrag = false;

  let activeHighlights = [];               // Array of { hlData, marks: [] }
  const activeHighlightsById = new Map();  // id → entry
  const notesMap = new Map();              // Sticky note elements by highlight ID
  let storageQueue = [];                   // Queue for storage operations
  let isProcessingQueue = false;

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME STORAGE WRAPPER
  // ═══════════════════════════════════════════════════════════════════════════
  const storage = {
    // Unqueued read. Safe for callers that only observe state, and used by the
    // queue itself (a queued read would deadlock inside processQueue).
    get: function (keys, callback) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime.lastError) {
              console.error('[Rastin RTL] storage.get error:', chrome.runtime.lastError.message);
              callback({});
            } else {
              callback(res || {});
            }
          });
        } else {
          this.fallbackGet(keys, callback);
        }
      } catch (e) {
        if (RtlFixer.DEBUG) console.warn('[Rastin RTL] chrome context error on get, using fallback:', e);
        this.fallbackGet(keys, callback);
      }
    },
    fallbackGet: function (keys, callback) {
      const result = {};
      const keysArray = Array.isArray(keys) ? keys : (typeof keys === 'object' ? Object.keys(keys) : [keys]);
      keysArray.forEach(k => {
        try {
          const val = localStorage.getItem(k);
          result[k] = val ? JSON.parse(val) : (typeof keys === 'object' && !Array.isArray(keys) ? keys[k] : null);
        } catch (_) {
          result[k] = (typeof keys === 'object' && !Array.isArray(keys) ? keys[k] : null);
        }
      });
      // Always resolve asynchronously so callers see the same ordering as the
      // chrome.storage path and deep queues can't grow the stack.
      Promise.resolve().then(() => callback(result));
    },
    set: function (items, callback) {
      storageQueue.push({ type: 'set', items, callback });
      this.processQueue();
    },
    update: function (key, updater, callback) {
      storageQueue.push({ type: 'update', key, updater, callback });
      this.processQueue();
    },
    // Runs an arbitrary read-modify-write inside the queue, so it can't
    // interleave with a pending set/update. `run` receives a `done` callback.
    task: function (run, callback) {
      storageQueue.push({ type: 'task', run, callback });
      this.processQueue();
    },
    processQueue: function () {
      if (isProcessingQueue || storageQueue.length === 0) return;
      isProcessingQueue = true;

      const operation = storageQueue.shift();
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        if (operation.callback) {
          try {
            operation.callback(result);
          } catch(e) {
            console.error('[Rastin RTL] Storage callback error:', e);
          }
        }
        isProcessingQueue = false;
        this.processQueue();
      };

      if (operation.type === 'task') {
        try {
          operation.run(finish);
        } catch (e) {
          console.warn('[Rastin RTL] storage.task error:', e);
          finish();
        }
        return;
      }

      if (operation.type === 'update') {
        this.get([operation.key], (res) => {
          let nextValue;
          try {
            nextValue = operation.updater(res[operation.key] || []);
          } catch (e) {
            console.warn('[Rastin RTL] storage.update error:', e);
            finish();
            return;
          }
          this.writeNow({ [operation.key]: nextValue }, () => finish(nextValue));
        });
        return;
      }

      this.writeNow(operation.items, finish);
    },
    writeNow: function (items, callback) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
              console.error('[Rastin RTL] storage.set error:', chrome.runtime.lastError.message);
            }
            callback();
          });
        } else {
          this.fallbackSet(items, callback);
        }
      } catch (e) {
        if (RtlFixer.DEBUG) console.warn('[Rastin RTL] chrome context error on set, using fallback:', e);
        this.fallbackSet(items, callback);
      }
    },
    fallbackSet: function (items, callback) {
      Object.keys(items).forEach(k => {
        try {
          localStorage.setItem(k, JSON.stringify(items[k]));
        } catch (_) {}
      });
      if (callback) Promise.resolve().then(() => callback());
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // URL & ROUTING HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  function getNormalizedHost(host) {
    const h = (host || window.location.hostname || '').toLowerCase();
    return h.replace(/^www\./, '');
  }

  function getPageKey(urlStr) {
    try {
      const u = urlStr ? new URL(urlStr) : window.location;
      const host = getNormalizedHost(u.hostname);
      const pathname = (u.pathname || '').replace(/\/+$/, '') || '/';
      const search = u.search || '';
      let hashRoute = '';
      if (u.hash && (u.hash.startsWith('#/') || u.hash.startsWith('#!/'))) {
        hashRoute = u.hash.replace(/\/+$/, '');
      }
      return `${host}${pathname}${search}${hashRoute}`;
    } catch(e) {
      const host = getNormalizedHost(window.location.hostname);
      const pathname = (window.location.pathname || '').replace(/\/+$/, '') || '/';
      return `${host}${pathname}`;
    }
  }

  function getStorageKey(host) {
    return 'rtl_fixer_hl_' + getNormalizedHost(host);
  }

  function getStoredHighlightPageKey(highlight) {
    if (highlight?.pageKey) {
      return highlight.pageKey;
    }
    if (highlight?.url) {
      return getPageKey(highlight.url);
    }
    return null;
  }

  function belongsToCurrentPage(highlight) {
    const storedPageKey = getStoredHighlightPageKey(highlight);
    if (!storedPageKey) return true;
    return storedPageKey === getPageKey(window.location.href);
  }

  function normalizeHighlightText(s) {
    if (!s) return '';
    let stripped = s.replace(/[\s\u200b\u200c\u200d\u00a0\ufeff]+/g, '');
    stripped = stripped.replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));
    stripped = stripped.replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));
    return stripped.toLowerCase();
  }

  function migrateWwwStorageIfNeeded(cleanHost, callback) {
    const targetHost = cleanHost || getNormalizedHost();
    const oldKey = 'rtl_fixer_hl_www.' + targetHost;
    const newKey = 'rtl_fixer_hl_' + targetHost;
    // Queued: this is a read-modify-write, so it must not interleave with a
    // pending set/update or one of the two writes would be lost.
    storage.task((done) => {
      storage.get([oldKey, newKey], (res) => {
        const oldItems = res[oldKey];
        if (!Array.isArray(oldItems) || oldItems.length === 0) {
          done(res[newKey] || []);
          return;
        }
        const combined = [...(res[newKey] || [])];
        for (const item of oldItems) {
          if (!combined.some(c => c.id === item.id)) {
            combined.push(item);
          }
        }
        storage.writeNow({ [newKey]: combined }, () => {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove([oldKey], () => done(combined));
          } else {
            try { localStorage.removeItem(oldKey); } catch(_) {}
            done(combined);
          }
        });
      });
    }, (items) => {
      if (callback) callback(items || []);
    });
  }

  function getHighlightIdentity(highlight) {
    if (highlight.id) return `id:${highlight.id}`;
    return `legacy:${highlight.timestamp || ''}:${highlight.text || ''}:${highlight.startPath || ''}`;
  }

  function invalidateSearchCache() {
    RtlFixer._searchCache = null;
  }

  // --- activeHighlights helpers ---
  function addActiveEntry(entry) {
    activeHighlights.push(entry);
    activeHighlightsById.set(entry.hlData.id, entry);
  }

  function removeActiveEntry(id) {
    activeHighlights = activeHighlights.filter(h => h.hlData.id !== id);
    activeHighlightsById.delete(id);
  }

  function getActiveEntry(id) {
    return activeHighlightsById.get(id) || null;
  }

  function clearAllActiveEntries() {
    activeHighlights = [];
    activeHighlightsById.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETACH & DELETE HIGHLIGHT FUNCTIONS (Declared early for lifecycle calls)
  // ═══════════════════════════════════════════════════════════════════════════
  function detachRenderedHighlights() {
    for (const entry of [...activeHighlights]) {
      if (entry?.hlData?.id) {
        unwrapHighlight(entry.hlData.id);
      }
    }

    notesMap.forEach((noteElement) => {
      if (noteElement && noteElement.parentNode) {
        noteElement.parentNode.removeChild(noteElement);
      }
    });
    notesMap.clear();

    document.querySelectorAll('mark.rastin-highlight').forEach(mark => {
      if (mark.parentNode) {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        try { parent.normalize(); } catch(_) {}
      }
    });

    if (hasCSSHighlights()) {
      for (const colorClass of Object.keys(highlightRegistryData)) {
        if (highlightRegistryData[colorClass]) {
          highlightRegistryData[colorClass].clear();
          rebuildCSSHighlights(colorClass);
        }
      }
      try {
        CSS.highlights.delete('rastin-hover');
        CSS.highlights.delete('rastin-active');
      } catch(_) {}
    }

    clearAllActiveEntries();

    setHoverHighlight(null);
    clearActiveHighlight();
    hideHighlightBar();

    invalidateSearchCache();
    updateHighlighterRadar();
  }

  function deleteCurrentPageHighlights() {
    const storageKey = getStorageKey();
    const currentPageKey = getPageKey(window.location.href);

    storage.update(
      storageKey,
      highlights => highlights.filter(highlight => {
        const key = getStoredHighlightPageKey(highlight);
        return key && key !== currentPageKey;
      }),
      () => {
        detachRenderedHighlights();
        refreshHighlightManagementUi();
      }
    );
  }

  function clearAllHighlightsAllSites() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(null, (allData) => {
        if (!allData) return;
        const keysToRemove = Object.keys(allData).filter(k => k.startsWith('rtl_fixer_hl_'));
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            detachRenderedHighlights();
            refreshHighlightManagementUi();
          });
        } else {
          detachRenderedHighlights();
          refreshHighlightManagementUi();
        }
      });
    } else {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('rtl_fixer_hl_')) {
          localStorage.removeItem(k);
        }
      });
      detachRenderedHighlights();
      refreshHighlightManagementUi();
    }
  }

  RtlFixer.clearCurrentPageHighlights = deleteCurrentPageHighlights;
  RtlFixer.detachRenderedHighlights = detachRenderedHighlights;
  RtlFixer.clearAllHighlightsAllSites = clearAllHighlightsAllSites;

  // ═══════════════════════════════════════════════════════════════════════════
  // SPA ROUTE WATCHER
  // ═══════════════════════════════════════════════════════════════════════════
  let currentRoutePageKey = getPageKey(window.location.href);
  let lastCheckedUrl = window.location.href;
  let spaWatchInterval = null;
  let spaWatchAttached = false;

  function checkSpaUrlChange() {
    const nowUrl = window.location.href;
    if (nowUrl !== lastCheckedUrl) {
      lastCheckedUrl = nowUrl;
      const newPageKey = getPageKey(nowUrl);
      if (newPageKey !== currentRoutePageKey) {
        if (RtlFixer.DEBUG) console.log(`[Rastin RTL] SPA Navigation: ${currentRoutePageKey} -> ${newPageKey}`);
        currentRoutePageKey = newPageKey;
        detachRenderedHighlights();
        RtlFixer.requestRestore(false);
      }
    }
  }

  function startSpaWatch() {
    if (spaWatchAttached) return;
    window.addEventListener('popstate', checkSpaUrlChange);
    window.addEventListener('hashchange', checkSpaUrlChange);
    window.addEventListener('pageshow', checkSpaUrlChange);
    spaWatchInterval = window.setInterval(checkSpaUrlChange, 500);
    spaWatchAttached = true;
  }

  function stopSpaWatch() {
    if (!spaWatchAttached) return;
    window.removeEventListener('popstate', checkSpaUrlChange);
    window.removeEventListener('hashchange', checkSpaUrlChange);
    window.removeEventListener('pageshow', checkSpaUrlChange);
    if (spaWatchInterval) {
      clearInterval(spaWatchInterval);
      spaWatchInterval = null;
    }
    spaWatchAttached = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT-NODE → HIGHLIGHT-ID INDEX
  // ═══════════════════════════════════════════════════════════════════════════
  function getTextNodesInRange(range) {
    if (!range || range.collapsed) {
      return [];
    }

    if (Array.isArray(range._involvedNodes) && range._involvedNodes.length > 0) {
      return range._involvedNodes.filter(node =>
        node &&
        node.nodeType === Node.TEXT_NODE &&
        node.isConnected &&
        node.nodeValue?.trim()
      );
    }

    const nodes = [];
    try {
      const root = range.commonAncestorContainer;
      if (root.nodeType === Node.TEXT_NODE) {
        if (root.nodeValue && root.nodeValue.trim().length > 0) {
          try {
            if (range.intersectsNode(root)) {
              nodes.push(root);
              return nodes;
            }
          } catch (_) {
            nodes.push(root);
            return nodes;
          }
        }
      }

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: n => {
            try {
              return range.intersectsNode(n) && n.nodeValue && n.nodeValue.trim()
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            } catch (_) {
              return NodeFilter.FILTER_REJECT;
            }
          }
        }
      );
      let n;
      while (n = walker.nextNode()) nodes.push(n);
    } catch (_) {}
    return nodes;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CSS CUSTOM HIGHLIGHTS API WRAPPER
  // ═══════════════════════════════════════════════════════════════════════════
  const highlightRegistryData = {
    'color-yellow': new Map(),
    'color-green':  new Map(),
    'color-red':    new Map(),
    'color-blue':   new Map(),
    'color-purple': new Map()
  };

  let isBatchingRebuilds = false;
  const batchPendingColors = new Set();

  function startBatchRebuild() {
    isBatchingRebuilds = true;
    batchPendingColors.clear();
  }

  function flushBatchRebuild() {
    isBatchingRebuilds = false;
    if (batchPendingColors.size > 0) {
      batchPendingColors.forEach(colorClass => rebuildCSSHighlights(colorClass));
      batchPendingColors.clear();
    }
  }

  function rebuildCSSHighlights(colorClass = null) {
    if (!hasCSSHighlights()) return;

    if (isBatchingRebuilds && colorClass) {
      batchPendingColors.add(colorClass);
      return;
    }

    const classesToUpdate = colorClass ? [colorClass] : Object.keys(highlightRegistryData);

    for (const cls of classesToUpdate) {
      const map = highlightRegistryData[cls];
      if (!map) continue;

      const validRanges = [];
      for (const [id, range] of map.entries()) {
        if (range && !range.collapsed && range.startContainer && range.startContainer.isConnected) {
          validRanges.push(range);
        } else {
          map.delete(id);
        }
      }

      const hlName = `rastin-${cls}`;
      try {
        if (validRanges.length > 0) {
          CSS.highlights.set(hlName, new Highlight(...validRanges));
        } else {
          CSS.highlights.delete(hlName);
        }
      } catch (e) {
        if (RtlFixer.DEBUG) console.warn(`[Rastin RTL] CSS.highlights.set failed for ${hlName}:`, e);
      }
    }
  }

  function setHoverHighlight(range) {
    if (!hasCSSHighlights()) return;
    try {
      if (range && !range.collapsed && range.startContainer && range.startContainer.isConnected) {
        CSS.highlights.set('rastin-hover', new Highlight(range));
      } else {
        CSS.highlights.delete('rastin-hover');
      }
    } catch (_) {}
  }

  function setActiveHighlight(id) {
    if (!hasCSSHighlights()) return;
    try {
      const range = getHighlightRange(id);
      if (range && !range.collapsed && range.startContainer && range.startContainer.isConnected) {
        CSS.highlights.set('rastin-active', new Highlight(range));
      } else {
        CSS.highlights.delete('rastin-active');
      }
    } catch (_) {}
  }

  function clearActiveHighlight() {
    if (!hasCSSHighlights()) return;
    try {
      CSS.highlights.delete('rastin-active');
    } catch (_) {}
  }

  function getHighlightRange(id) {
    const entry = getActiveEntry(id);
    if (!entry) return null;

    const colorClass = getColorClass(entry.hlData.color);
    if (hasCSSHighlights() && highlightRegistryData[colorClass]?.has(id)) {
      return highlightRegistryData[colorClass].get(id);
    }

    if (entry.marks && entry.marks.length > 0) {
      const validMarks = entry.marks.filter(m => m && m.isConnected);
      if (validMarks.length > 0) {
        const range = document.createRange();
        range.setStartBefore(validMarks[0]);
        range.setEndAfter(validMarks[validMarks.length - 1]);
        return range;
      }
    }

    if (entry.savedRange && !entry.savedRange.collapsed && entry.savedRange.startContainer && entry.savedRange.startContainer.isConnected) {
      return entry.savedRange;
    }

    return null;
  }

  function wrapRangeWithMark(range, colorHex, id) {
    const colorClass = getColorClass(colorHex);
    const bgColor    = BG_COLORS[colorClass];
    const marks      = [];

    if (!range || range.collapsed) return marks;

    let rootNode = range.commonAncestorContainer;
    while (rootNode && rootNode.parentNode) {
      if (rootNode instanceof ShadowRoot) break;
      rootNode = rootNode.parentNode;
    }

    if (hasCSSHighlights() && !(rootNode instanceof ShadowRoot)) {
      highlightRegistryData[colorClass].set(id, range);
      rebuildCSSHighlights(colorClass);

      const fakeMark = {
        _isCSSHighlight: true,
        _colorClass: colorClass,
        isConnected: true
      };
      return [fakeMark];
    }

    // DOM Mark Fallback
    try {
      const textNodes = getTextNodesInRange(range);
      for (const node of textNodes) {
        const nodeRange = document.createRange();
        const startOffset = (node === range.startContainer) ? range.startOffset : 0;
        const endOffset   = (node === range.endContainer)   ? range.endOffset   : node.nodeValue.length;

        if (startOffset >= endOffset) continue;

        nodeRange.setStart(node, startOffset);
        nodeRange.setEnd(node, endOffset);

        const mark = document.createElement('mark');
        mark.className = `rastin-highlight ${colorClass}`;
        mark.setAttribute('data-hl-id', id);
        mark.style.backgroundColor = bgColor;

        try {
          nodeRange.surroundContents(mark);
          marks.push(mark);
        } catch (e) {
          const extracted = nodeRange.extractContents();
          mark.appendChild(extracted);
          nodeRange.insertNode(mark);
          marks.push(mark);
        }
      }
    } catch (e) {
      console.warn('[Rastin RTL] DOM mark wrapping fallback error:', e);
    }

    return marks;
  }

  function unwrapHighlight(id) {
    if (!id) return;
    if (hasCSSHighlights()) {
      for (const colorClass of Object.keys(highlightRegistryData)) {
        if (highlightRegistryData[colorClass] && highlightRegistryData[colorClass].has(id)) {
          highlightRegistryData[colorClass].delete(id);
          try { rebuildCSSHighlights(colorClass); } catch(_) {}
        }
      }
    }

    const entry = getActiveEntry(id);
    if (!entry) return;

    if (entry.marks && Array.isArray(entry.marks)) {
      entry.marks.forEach(mark => {
        if (!mark || mark._isCSSHighlight) return;
        if (mark.parentNode) {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          try { parent.normalize(); } catch(_) {}
        }
      });
    }

    removeActiveEntry(id);
  }

  function changeHighlightColor(id, oldColorHex, newColorHex) {
    const oldClass = getColorClass(oldColorHex);
    const newClass = getColorClass(newColorHex);

    if (hasCSSHighlights()) {
      const range = highlightRegistryData[oldClass]?.get(id);
      if (range) {
        highlightRegistryData[oldClass].delete(id);
        highlightRegistryData[newClass].set(id, range);
        rebuildCSSHighlights(oldClass);
        rebuildCSSHighlights(newClass);
      }
    }

    const bgColor = BG_COLORS[newClass] || BG_COLORS['color-yellow'];
    const entry = getActiveEntry(id);
    if (entry && entry.marks) {
      entry.marks.forEach(m => {
        if (!m) return;
        // CSS Custom Highlight entries are plain sentinel objects, not elements —
        // they have no classList/style to touch.
        if (m._isCSSHighlight) {
          m._colorClass = newClass;
          return;
        }
        if (m.classList) {
          m.classList.remove(oldClass);
          m.classList.add(newClass);
        }
        if (m.style) m.style.backgroundColor = bgColor;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RADAR & HIGHLIGHT HUB MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  let radarContainer = null;
  let hubDrawer = null;
  let hubRenderVersion = 0;
  let hubSearchTimeout = null;
  let radarRenderVersion = 0;
  let refreshUiTimeout = null;

  // Coalesces the storage-write callbacks that all end up repainting the same
  // two panels (note typing fires one per keystroke batch).
  function refreshHighlightManagementUi() {
    if (refreshUiTimeout) return;
    refreshUiTimeout = setTimeout(() => {
      refreshUiTimeout = null;
      updateHighlighterRadar();
      if (hubDrawer?.isConnected && hubDrawer.classList.contains('open')) {
        const search = hubDrawer.querySelector('#rastin-hub-search-input');
        renderHighlightHubCards(search?.value || '');
      }
    }, 120);
  }

  function updateHighlighterRadar() {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled) {
      if (radarContainer) radarContainer.style.display = 'none';
      return;
    }

    if (radarContainer && !radarContainer.isConnected) {
      radarContainer = null;
    }

    if (!radarContainer) {
      radarContainer = document.createElement('div');
      radarContainer.id = 'rastin-radar-container';
      (document.documentElement || document.body).appendChild(radarContainer);
    }

    const currentVersion = ++radarRenderVersion;
    const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) || 1;

    const storageKey = getStorageKey();
    storage.get(storageKey, (res) => {
      // A newer paint started while this read was in flight — dropping the
      // stale one prevents duplicated dots.
      if (currentVersion !== radarRenderVersion || !radarContainer?.isConnected) return;

      radarContainer.innerHTML = '';

      const storedHighlights = Array.isArray(res?.[storageKey]) ? res[storageKey] : [];
      const highlights = storedHighlights.filter(belongsToCurrentPage);

      if (highlights.length === 0) {
        radarContainer.style.display = 'none';
        return;
      }
      radarContainer.style.display = 'flex';
      const radarHeight = radarContainer.clientHeight || window.innerHeight;

      highlights.forEach(hl => {
        // Cheap lookup only: the text-search fallback walks the whole document
        // and the radar repaints on every storage write.
        const el = findHighlightElement(hl, true);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const topPos = (rect.top + window.scrollY) / totalHeight * radarHeight;

        const dot = document.createElement('div');
        dot.className = `rastin-radar-dot ${getColorClass(hl.color)}`;
        dot.style.top = `${Math.min(Math.max(topPos, 4), Math.max(4, radarHeight - 8))}px`;

        let titleText = hl.text ? (hl.text.length > 50 ? hl.text.substring(0, 50) + '...' : hl.text) : 'هایلایت';
        if (hl.note?.text) {
          titleText += `\n📝 ${hl.note.text}`;
        }
        dot.title = titleText;

        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        radarContainer.appendChild(dot);
      });
    });
  }

  function toggleHighlightHub() {
    if (hubDrawer && !hubDrawer.isConnected) {
      hubDrawer = null;
    }

    if (!hubDrawer) {
      hubDrawer = document.createElement('div');
      hubDrawer.id = 'rastin-hub-drawer';
      hubDrawer.innerHTML = `
        <div class="rastin-hub-header">
          <div class="rastin-hub-title">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            <span>بورد هایلایت‌ها</span>
          </div>
          <div class="rastin-hub-header-actions">
            <button type="button" class="rastin-hub-clear-all" id="rastin-hub-clear-all" title="حذف تمام هایلایت‌ها در همه سایت‌ها">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>حذف همه</span>
            </button>
            <button type="button" class="rastin-hub-close" id="rastin-hub-close" title="بستن بورد">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        <div class="rastin-hub-search">
          <div class="rastin-hub-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" class="rastin-hub-search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="rastin-hub-input" id="rastin-hub-search-input" placeholder="جستجو در هایلایت‌ها..." />
          </div>
        </div>
        <div class="rastin-hub-list" id="rastin-hub-list"></div>
      `;
      (document.documentElement || document.body).appendChild(hubDrawer);

      const closeBtn = hubDrawer.querySelector('#rastin-hub-close');
      closeBtn.addEventListener('click', () => hubDrawer.classList.remove('open'));

      const clearAllBtn = hubDrawer.querySelector('#rastin-hub-clear-all');
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
          if (confirm('آیا مطمئن هستید که می‌خواهید تمام هایلایت‌ها و یادداشت‌ها در تمامی سایت‌ها را به صورت کامل پاکسازی کنید؟')) {
            clearAllHighlightsAllSites();
          }
        });
      }

      const searchInput = hubDrawer.querySelector('#rastin-hub-search-input');
      searchInput.addEventListener('input', (e) => {
        clearTimeout(hubSearchTimeout);
        hubSearchTimeout = setTimeout(() => {
          renderHighlightHubCards(e.target.value);
        }, 120);
      });
    }

    hubDrawer.classList.toggle('open');
    if (hubDrawer.classList.contains('open')) {
      renderHighlightHubCards();
    }
  }

  function renderHighlightHubCards(filterText = '') {
    const currentVersion = ++hubRenderVersion;
    if (!hubDrawer || !hubDrawer.isConnected) return;

    const listEl = hubDrawer.querySelector('#rastin-hub-list');
    if (!listEl) return;

    const categoryNames = {
      '#fef08a': '📌 مهم',
      '#bbf7d0': '💡 نکته کلیدی',
      '#fecaca': '⚡ اقدام لازم',
      '#fecdd3': '⚡ اقدام لازم',
      '#bfdbfe': '🔗 منبع',
      '#e9d5ff': '📝 شخصی'
    };

    const storageKey = getStorageKey();
    storage.get(storageKey, (res) => {
      if (currentVersion !== hubRenderVersion || !hubDrawer?.isConnected) return;

      const storedHighlights = Array.isArray(res?.[storageKey]) ? res[storageKey] : [];

      const byId = new Map(storedHighlights.map(highlight => [highlight.id, highlight]));
      for (const entry of activeHighlights) {
        if (entry?.hlData?.id) {
          byId.set(entry.hlData.id, entry.hlData);
        }
      }

      const highlights = Array.from(byId.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      listEl.innerHTML = '';
      if (highlights.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px 0;">هیچ هایلایتی ثبت نشده است</div>';
        return;
      }

      const filtered = highlights.filter(h => {
        if (!filterText) return true;
        const query = filterText.toLowerCase();
        return (h.text && h.text.toLowerCase().includes(query)) ||
               (h.note && h.note.text && h.note.text.toLowerCase().includes(query)) ||
               (h.title && h.title.toLowerCase().includes(query)) ||
               (h.path && h.path.toLowerCase().includes(query));
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px 0;">موردی یافت نشد</div>';
        return;
      }

      filtered.forEach(hl => {
        const isCurrentPage = belongsToCurrentPage(hl);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `rastin-hub-card ${isCurrentPage ? '' : 'cross-page'}`;

        const tag = document.createElement('div');
        tag.className = `rastin-hub-card-tag ${getColorClass(hl.color)}`;
        tag.textContent = categoryNames[hl.color] || '📌 عمومی';

        const text = document.createElement('div');
        text.className = 'rastin-hub-card-text';
        text.textContent = `"${hl.text || ''}"`;

        card.append(tag, text);

        if (hl.note?.text) {
          const note = document.createElement('div');
          note.className = 'rastin-hub-card-note';
          note.textContent = `📝 ${hl.note.text}`;
          card.appendChild(note);
        }

        if (!isCurrentPage && (hl.path || hl.title)) {
          const pageInfo = document.createElement('div');
          pageInfo.className = 'rastin-hub-card-page';
          pageInfo.style.fontSize = '11px';
          pageInfo.style.color = '#94a3b8';
          pageInfo.style.marginTop = '4px';
          pageInfo.textContent = `🌐 ${hl.path || hl.title}`;
          card.appendChild(pageInfo);
        }

        card.addEventListener('click', () => {
          if (!isCurrentPage && hl.url) {
            try {
              sessionStorage.setItem(PENDING_HIGHLIGHT_KEY, hl.id);
            } catch(_) {}
            window.location.assign(hl.url);
            return;
          }

          scrollToHighlightElement(hl);
        });

        listEl.appendChild(card);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING TOOLBAR
  // ═══════════════════════════════════════════════════════════════════════════
  function createHighlightBar() {
    if (highlightBar && !highlightBar.isConnected) {
      highlightBar = null;
    }

    if (highlightBar) return;

    highlightBar = document.createElement('div');
    highlightBar.id = 'rastin-highlight-bar';
    highlightBar.className = 'rastin-highlight-bar hidden';
    highlightBar.style.position = 'absolute';
    highlightBar.style.zIndex = '2147483645';

    // Draggable Grip Handle (allows user to easily reposition the bar anywhere)
    const dragHandle = document.createElement('div');
    dragHandle.className = 'rastin-bar-drag-handle';
    dragHandle.title = 'جابه‌جایی نوار ابزار (کلیک و درگ کنید)';
    dragHandle.innerHTML = '<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3.5" cy="3" r="1.5"/><circle cx="8.5" cy="3" r="1.5"/><circle cx="3.5" cy="8" r="1.5"/><circle cx="8.5" cy="8" r="1.5"/><circle cx="3.5" cy="13" r="1.5"/><circle cx="8.5" cy="13" r="1.5"/></svg>';

    const startDrag = (e) => {
      // Only primary mouse button or touch
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // Never initiate drag when clicking an action button or color circle
      if (e.target.closest('button, .rastin-color-btn, .rastin-bar-action-btn')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const rect = highlightBar.getBoundingClientRect();
      const startPointerX = e.clientX;
      const startPointerY = e.clientY;
      const startBarLeft = rect.left + window.scrollX;
      const startBarTop = rect.top + window.scrollY;

      isDraggingBar = true;
      let hasMoved = false;

      // Add .dragged (neutralizes relative translate so positioning is 1:1) and .is-dragging
      highlightBar.classList.add('dragged', 'is-dragging');
      highlightBar.style.left = `${startBarLeft}px`;
      highlightBar.style.top = `${startBarTop}px`;

      const onPointerMove = (moveEvt) => {
        if (!isDraggingBar) return;
        moveEvt.preventDefault();
        moveEvt.stopPropagation();

        const dx = moveEvt.clientX - startPointerX;
        const dy = moveEvt.clientY - startPointerY;

        if (Math.hypot(dx, dy) > 2) {
          hasMoved = true;
        }

        highlightBar.style.left = `${startBarLeft + dx}px`;
        highlightBar.style.top = `${startBarTop + dy}px`;
      };

      const onPointerUp = (upEvt) => {
        isDraggingBar = false;
        highlightBar.classList.remove('is-dragging');

        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        if (hasMoved) {
          justFinishedDrag = true;
          setTimeout(() => {
            justFinishedDrag = false;
          }, 150);
        }
      };

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    };

    highlightBar.addEventListener('pointerdown', startDrag);
    highlightBar.appendChild(dragHandle);

    const colors = [
      { hex: '#fef08a', class: 'yellow', name: 'مهم' },
      { hex: '#bbf7d0', class: 'green',  name: 'نکته کلیدی' },
      { hex: '#fecaca', class: 'red',    name: 'اقدام لازم' },
      { hex: '#bfdbfe', class: 'blue',   name: 'منبع' },
      { hex: '#e9d5ff', class: 'purple', name: 'شخصی' }
    ];

    colors.forEach(col => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rastin-color-btn ${col.class}`;
      btn.title = col.name;
      btn.setAttribute('data-color', col.hex);
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        highlightBar.querySelectorAll('.rastin-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyHighlight(col.hex);
      });
      highlightBar.appendChild(btn);
    });

    const divider1 = document.createElement('div');
    divider1.className = 'rastin-bar-divider';
    highlightBar.appendChild(divider1);

    const addNoteBtn = document.createElement('button');
    addNoteBtn.type = 'button';
    addNoteBtn.className = 'rastin-bar-action-btn';
    addNoteBtn.id = 'rastin-bar-add-note';
    addNoteBtn.title = 'افزودن یادداشت';
    addNoteBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    addNoteBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!activeHighlightId) {
        applyHighlight(null, true);
      } else {
        const entry = getActiveEntry(activeHighlightId);
        if (entry) spawnStickyNote(entry.hlData);
      }
      hideHighlightBar();
    });
    highlightBar.appendChild(addNoteBtn);

    const translateBtn = document.createElement('button');
    translateBtn.type = 'button';
    translateBtn.className = 'rastin-bar-action-btn';
    translateBtn.id = 'rastin-bar-translate';
    translateBtn.title = 'ترجمه متن انتخاب شده';
    translateBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 6M4 14l6-6M2 5h12M9 2v3M15 11l4 9M21 20l-4-9M16.5 17.5h4.5"></path></svg>';
    translateBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (typeof RtlFixer.translateText === 'function') {
        const text = currentSelectionText || (activeHighlightId ? getActiveEntry(activeHighlightId)?.hlData?.text : '');
        if (text) {
          const rect = highlightBar.getBoundingClientRect();
          RtlFixer.translateText(text, rect.left, rect.bottom + 10);
        }
      }
      hideHighlightBar();
    });
    highlightBar.appendChild(translateBtn);

    const hubBtn = document.createElement('button');
    hubBtn.type = 'button';
    hubBtn.className = 'rastin-bar-action-btn';
    hubBtn.id = 'rastin-bar-hub';
    hubBtn.title = '📌 بورد هایلایت‌ها و یادداشت‌ها';
    hubBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
    
    // Change listener to 'click' (replaces pointerdown to prevent instant close race)
    hubBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHighlightHub();
      hideHighlightBar();
    });
    highlightBar.appendChild(hubBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'rastin-bar-action-btn delete-btn';
    deleteBtn.id = 'rastin-bar-delete';
    deleteBtn.title = 'حذف هایلایت';
    deleteBtn.style.display = 'none';
    deleteBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    deleteBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (activeHighlightId) {
        deleteHighlight(activeHighlightId);
        hideHighlightBar();
      }
    });
    highlightBar.appendChild(deleteBtn);

    (document.documentElement || document.body).appendChild(highlightBar);
  }

  function hasNativeSelectionBarAbove(rect, centerX) {
    const hostname = window.location.hostname || '';
    // Known web applications with native top-floating selection toolbars (ChatGPT, Claude, DeepSeek, etc.)
    if (/chatgpt\.com|openai\.com|claude\.ai|deepseek\.com|perplexity\.ai|medium\.com|notion\.so|quora\.com|substack\.com|poe\.com|copilot\.microsoft\.com|v0\.dev/i.test(hostname)) {
      return true;
    }

    try {
      const probePoints = [
        { x: centerX, y: Math.max(5, rect.top - 20) },
        { x: Math.max(5, centerX - 60), y: Math.max(5, rect.top - 20) },
        { x: Math.min(window.innerWidth - 5, centerX + 60), y: Math.max(5, rect.top - 20) }
      ];

      for (const pt of probePoints) {
        const elements = document.elementsFromPoint(pt.x, pt.y);
        for (const el of elements) {
          if (!el || el === highlightBar || highlightBar?.contains(el)) continue;
          if (el === document.body || el === document.documentElement) continue;
          const tag = el.tagName?.toLowerCase();
          if (tag === 'html' || tag === 'body' || tag === 'main' || tag === 'article' || tag === 'section') continue;

          const role = el.getAttribute?.('role') || el.closest?.('[role="tooltip"], [role="toolbar"], [role="dialog"]');
          if (role || el.closest?.('[data-radix-popper-content-wrapper], [data-floating-ui-portal]')) {
            return true;
          }

          const style = window.getComputedStyle(el);
          if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex, 10) >= 10) {
            return true;
          }
        }
      }
    } catch (_) {}

    return false;
  }

  function positionHighlightBar(targetElOrRect) {
    createHighlightBar();
    let rect;
    if (targetElOrRect && typeof targetElOrRect.getBoundingClientRect === 'function') {
      rect = targetElOrRect.getBoundingClientRect();
    } else if (targetElOrRect && typeof targetElOrRect.left === 'number') {
      rect = targetElOrRect;
    } else {
      return;
    }

    // Reset any manual drag overrides
    highlightBar.classList.remove('dragged', 'is-dragging');
    highlightBar.classList.remove('hidden');

    const deleteBtn = highlightBar.querySelector('#rastin-bar-delete');
    if (deleteBtn) deleteBtn.style.display = activeHighlightId ? 'flex' : 'none';

    const translateBtn = highlightBar.querySelector('#rastin-bar-translate');
    if (translateBtn) {
      const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
      translateBtn.style.display = config.translatorEnabled ? 'flex' : 'none';
    }

    const barWidth  = highlightBar.offsetWidth  || 320;
    const barHeight = highlightBar.offsetHeight || 44;
    const margin = 10;

    let centerX = rect.left + (rect.width / 2);
    if (barWidth + (margin * 2) >= window.innerWidth) {
      centerX = window.innerWidth / 2;
    } else {
      centerX = Math.max(margin + barWidth / 2,
                Math.min(window.innerWidth - margin - barWidth / 2, centerX));
    }

    // Check if site (like ChatGPT, Claude, etc.) or DOM has a native selection toolbar above
    const nativeBarDetected = hasNativeSelectionBarAbove(rect, centerX);
    const roomAbove = (rect.top - barHeight - 24) >= 0;
    const roomBelow = (window.innerHeight - rect.bottom - barHeight - 24) >= 0;

    let placeBelow = false;
    let isStackedAbove = false;

    if (nativeBarDetected) {
      // Avoid colliding with native tooltip by placing below selection
      if (roomBelow) {
        placeBelow = true;
      } else if (roomAbove) {
        placeBelow = false;
        isStackedAbove = true;
      } else {
        placeBelow = true;
      }
    } else {
      placeBelow = !roomAbove && roomBelow;
    }

    highlightBar.classList.toggle('below', placeBelow);
    highlightBar.classList.toggle('stacked-above', isStackedAbove);

    const anchorY = placeBelow ? rect.bottom : rect.top;

    highlightBar.style.left = `${centerX + window.scrollX}px`;
    highlightBar.style.top  = `${anchorY + window.scrollY}px`;

    // Re-check after 80ms in case the page dynamically rendered a tooltip (e.g. ChatGPT, Claude, custom toolbars)
    if (!nativeBarDetected && !placeBelow) {
      setTimeout(() => {
        if (highlightBar && !highlightBar.classList.contains('hidden') && !highlightBar.classList.contains('dragged')) {
          if (hasNativeSelectionBarAbove(rect, centerX)) {
            positionHighlightBar(targetElOrRect);
          }
        }
      }, 80);
    }
  }

  function hideHighlightBar() {
    if (highlightBar) {
      highlightBar.classList.add('hidden');
      highlightBar.classList.remove('dragged', 'is-dragging', 'stacked-above');
      const deleteBtn = highlightBar.querySelector('#rastin-bar-delete');
      if (deleteBtn) deleteBtn.style.display = 'none';
      highlightBar.querySelectorAll('.rastin-color-btn').forEach(b => b.classList.remove('active'));
    }
    document.querySelectorAll('mark.rastin-highlight.active').forEach(m => m.classList.remove('active'));
    activeHighlightId = null;
    activeRange = null;
    currentSelectionText = '';
    clearActiveHighlight();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLY / DELETE HIGHLIGHT
  // ═══════════════════════════════════════════════════════════════════════════
  function applyHighlight(colorHex, openNoteImmediately = false) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    // config.highlightColor is stored as a name ('yellow'), not hex — normalize
    // so it never lands in storage as an unmappable value.
    const finalColor = normalizeColorHex(colorHex) || normalizeColorHex(config.highlightColor) || '#fef08a';

    if (activeHighlightId) {
      const id = activeHighlightId;
      const storageKey = getStorageKey();
      storage.update(storageKey, (highlights) => {
        const index = highlights.findIndex(h => h.id === id);
        if (index > -1) {
          highlights[index].color = finalColor;
          if (highlights[index].note) {
            highlights[index].note.color = finalColor;
          }
        }
        return highlights;
      }, () => {
        const entry = getActiveEntry(id);
        if (entry) {
          const oldColor = entry.hlData.color;
          entry.hlData.color = finalColor;
          changeHighlightColor(id, oldColor, finalColor);
        }
        hideHighlightBar();
        activeHighlightId = null;

        if (notesMap.has(id)) {
          const noteEl = notesMap.get(id);
          noteEl.className = `rastin-note ${getColorClass(finalColor)}`;
        }
        refreshHighlightManagementUi();
      });
      return;
    }

    if (!activeRange) return;
    const range = activeRange;

    const startParent = range.startContainer.parentElement || range.startContainer;
    const endParent = range.endContainer.parentElement || range.endContainer;

    const startPath = getXPath(startParent);
    const endPath = getXPath(endParent);
    if (!startPath || !endPath) {
      console.warn('[Rastin RTL] Failed to get XPath for selection');
      return;
    }

    const id = 'hl_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
    const rangeRect = range.getBoundingClientRect();

    const noteData = {
      text: "",
      color: finalColor,
      position: {
        x: rangeRect.right + 20 + window.scrollX,
        y: rangeRect.top - 10 + window.scrollY
      },
      minimized: false
    };

    const highlightObject = {
      id,
      url: window.location.href,
      path: window.location.pathname,
      pageKey: getPageKey(window.location.href),
      title: document.title || window.location.hostname,
      text: currentSelectionText,
      color: finalColor,
      timestamp: Date.now(),
      startPath,
      startNodeIndex: getNodeIndex(range.startContainer),
      startOffset: range.startOffset,
      endPath,
      endNodeIndex: getNodeIndex(range.endContainer),
      endOffset: range.endOffset,
      note: noteData
    };

    const savedRange = range.cloneRange();
    const marks = wrapRangeWithMark(savedRange, finalColor, id);
    addActiveEntry({ hlData: highlightObject, marks, savedRange });

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    hideHighlightBar();
    activeRange = null;

    invalidateSearchCache();

    if (openNoteImmediately) {
      spawnStickyNote(highlightObject, null);
    }

    const storageKey = getStorageKey();
    storage.update(storageKey, (highlights) => {
      highlights.push(highlightObject);
      return highlights;
    }, refreshHighlightManagementUi);
  }

  function deleteHighlight(id) {
    unwrapHighlight(id);

    if (notesMap.has(id)) {
      const noteEl = notesMap.get(id);
      if (noteEl && noteEl.parentNode) {
        noteEl.parentNode.removeChild(noteEl);
      }
      notesMap.delete(id);
    }

    const storageKey = getStorageKey();
    storage.update(storageKey, highlights => highlights.filter(h => h.id !== id), refreshHighlightManagementUi);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STICKY NOTES
  // ═══════════════════════════════════════════════════════════════════════════
  // Places a note at its stored document position, clamped to the *document*
  // (not the viewport — a note saved far down the page must stay there).
  function positionNote(noteEl, note, clickPoint = null) {
    const noteWidth  = noteEl.offsetWidth  || 260;
    const noteHeight = noteEl.offsetHeight || 180;
    const docWidth  = Math.max(document.documentElement.scrollWidth,  window.innerWidth);
    const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

    const stored = note && note.position;
    const hasStored = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y);

    let x, y;
    if (hasStored) {
      x = stored.x;
      y = stored.y;
    } else if (clickPoint) {
      x = clickPoint.x + 15;
      y = clickPoint.y + 15;
    } else {
      x = window.scrollX + 100;
      y = window.scrollY + 100;
    }

    x = Math.max(10, Math.min(Math.max(10, docWidth  - noteWidth  - 10), x));
    y = Math.max(10, Math.min(Math.max(10, docHeight - noteHeight - 10), y));

    noteEl.style.left = `${x}px`;
    noteEl.style.top  = `${y}px`;

    if (note) {
      if (!note.position) note.position = {};
      note.position.x = x;
      note.position.y = y;
    }
  }

  function spawnStickyNote(hl, targetElement = null, clickPoint = null) {
    const stale = notesMap.get(hl.id);
    if (stale && !stale.isConnected) {
      notesMap.delete(hl.id);
    }

    if (notesMap.has(hl.id)) {
      const existing = notesMap.get(hl.id);
      existing.style.zIndex = '2147483644';
      positionNote(existing, hl.note, clickPoint);
      const body = existing.querySelector('.rastin-note-body');
      if (body) body.focus();
      return existing;
    }

    if (!hl.note) {
      hl.note = {
        text: "",
        color: hl.color,
        position: { x: (clickPoint ? clickPoint.x : window.scrollX + 100), y: (clickPoint ? clickPoint.y : window.scrollY + 100) }
      };
    }
    const note = hl.note;

    if (targetElement && (!hl.note.position || (hl.note.position.x === 0 && hl.note.position.y === 0))) {
      const rect = targetElement.getBoundingClientRect();
      note.position.x = rect.right + 20 + window.scrollX;
      note.position.y = rect.top - 10 + window.scrollY;
    }

    const noteEl = document.createElement('div');
    noteEl.className = `rastin-note ${getColorClass(note.color)}`;
    noteEl.setAttribute('data-id', hl.id);
    noteEl.style.position = 'absolute';
    noteEl.style.zIndex = '2147483643';

    const header = document.createElement('div');
    header.className = 'rastin-note-header';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'rastin-note-drag';
    header.appendChild(dragHandle);

    const actions = document.createElement('div');
    actions.className = 'rastin-note-actions';

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'rastin-note-btn rastin-note-min-btn';
    minBtn.title = note.minimized ? 'باز کردن یادداشت' : 'کوچک کردن یادداشت';
    minBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"></path></svg>';
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      noteEl.classList.toggle('minimized');
      note.minimized = noteEl.classList.contains('minimized');
      minBtn.title = note.minimized ? 'باز کردن یادداشت' : 'کوچک کردن یادداشت';

      const storageKey = getStorageKey();
      storage.update(storageKey, (highlights) => {
        const index = highlights.findIndex(h => h.id === hl.id);
        if (index > -1 && highlights[index].note) {
          highlights[index].note.minimized = note.minimized;
        }
        return highlights;
      }, refreshHighlightManagementUi);
    });
    actions.appendChild(minBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rastin-note-btn rastin-note-close-btn';
    closeBtn.title = 'بستن یادداشت';
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (noteEl.parentNode) noteEl.parentNode.removeChild(noteEl);
      notesMap.delete(hl.id);
    });
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    noteEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rastin-note-body';
    body.contentEditable = 'true';
    body.setAttribute('placeholder', 'یادداشت خود را بنویسید...');

    if (note.text) {
      body.textContent = note.text;
    }

    const updateNoteDir = () => {
      if (typeof RtlFixer.processInputDirection === 'function') {
        RtlFixer.processInputDirection(body);
      }
    };
    updateNoteDir();

    let saveTimeout = null;
    let saveInFlight = false;
    let pendingNoteText = null;

    function flushNoteSave() {
      if (saveInFlight || pendingNoteText === null) {
        return;
      }

      const textToSave = pendingNoteText;
      pendingNoteText = null;
      saveInFlight = true;

      hl.note.text = textToSave;

      const activeEntry = getActiveEntry(hl.id);
      if (activeEntry && activeEntry.hlData && activeEntry.hlData.note) {
        activeEntry.hlData.note.text = textToSave;
      }

      storage.update(
        getStorageKey(),
        highlights => {
          const target = highlights.find(h => h.id === hl.id);
          if (target) {
            target.note = target.note || {};
            target.note.text = textToSave;
          }
          return highlights;
        },
        () => {
          saveInFlight = false;

          if (pendingNoteText !== null) {
            flushNoteSave();
          }

          refreshHighlightManagementUi();
        }
      );
    }

    body.addEventListener('input', () => {
      updateNoteDir();
      pendingNoteText = body.textContent || '';

      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(flushNoteSave, 300);
    });

    noteEl.appendChild(body);

    if (note.minimized) {
      noteEl.classList.add('minimized');
    }

    (document.documentElement || document.body).appendChild(noteEl);
    notesMap.set(hl.id, noteEl);
    positionNote(noteEl, note, clickPoint);

    // Draggable Implementation — document listeners are attached only for the
    // duration of a drag, otherwise every note ever opened leaks a permanent
    // mousemove/mouseup handler.
    let startX = 0, startY = 0, initialX = 0, initialY = 0;

    const onDragMove = (e) => {
      const newX = initialX + (e.clientX - startX);
      const newY = initialY + (e.clientY - startY);
      noteEl.style.left = `${newX}px`;
      noteEl.style.top = `${newY}px`;
      note.position = { x: newX, y: newY };
    };

    const onDragEnd = () => {
      document.removeEventListener('mousemove', onDragMove, true);
      document.removeEventListener('mouseup', onDragEnd, true);

      const storageKey = getStorageKey();
      storage.update(storageKey, (highlights) => {
        const index = highlights.findIndex(h => h.id === hl.id);
        if (index > -1 && highlights[index].note) {
          highlights[index].note.position = note.position;
        }
        return highlights;
      }, refreshHighlightManagementUi);
    };

    dragHandle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      initialX = parseFloat(noteEl.style.left) || noteEl.offsetLeft;
      initialY = parseFloat(noteEl.style.top) || noteEl.offsetTop;
      noteEl.style.zIndex = '2147483644';
      e.preventDefault();
      document.addEventListener('mousemove', onDragMove, true);
      document.addEventListener('mouseup', onDragEnd, true);
    });

    return noteEl;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // XPath RESTORE STRATEGY
  // ═══════════════════════════════════════════════════════════════════════════
  function getXPath(node) {
    if (!node) return null;
    if (node.id && !node.id.includes('"') && !node.id.includes("'")) return `//*[@id="${node.id}"]`;
    const parts = [];
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      if (node.id && !node.id.includes('"') && !node.id.includes("'")) {
        parts.unshift(`*[@id="${node.id}"]`);
        break;
      }
      let count = 0;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === node.nodeName) {
          count++;
        }
        sibling = sibling.previousSibling;
      }
      parts.unshift(`${node.nodeName.toLowerCase()}[${count + 1}]`);
      node = node.parentNode;
    }
    return parts.length ? '/' + parts.join('/') : null;
  }

  function getNodeIndex(node) {
    let index = 0;
    while ((node = node.previousSibling)) index++;
    return index;
  }

  function getElementByXPath(path) {
    if (!path) return null;
    try {
      return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (_) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FALLBACK TEXT SEARCH STRATEGY
  // ═══════════════════════════════════════════════════════════════════════════
  function findTextRange(textToFind, expectedStartPath) {
    if (!textToFind || textToFind.trim().length === 0) return null;

    const target = normalizeHighlightText(textToFind);
    if (!target) return null;

    try {
      if (!RtlFixer._searchCache) {
        const nodes = [];
        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.nodeValue && node.nodeValue.trim().length > 0) {
              nodes.push(node);
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches([
              'script', 'style', 'noscript', 'iframe', 'head', 'template', 'math',
              '.rastin-note', '#rastin-highlight-bar', '#rastin-hub-drawer',
              '#rastin-radar-container', '#rastin-toast-container'
            ].join(','))) return;

            if (node.shadowRoot) walk(node.shadowRoot);
            let child = node.firstChild;
            while (child) { walk(child); child = child.nextSibling; }
          } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            let child = node.firstChild;
            while (child) { walk(child); child = child.nextSibling; }
          }
        }
        walk(document.body);

        let fullText = '';
        const charMap = [];
        for (const n of nodes) {
          const txt = n.nodeValue;
          for (let i = 0; i < txt.length; i++) {
            if (/[\s\u200b\u200c\u200d\u00a0\ufeff]/.test(txt[i])) continue;

            let char = txt[i];
            if (char >= '۰' && char <= '۹') char = String.fromCharCode(char.charCodeAt(0) - 1776 + 48);
            else if (char >= '٠' && char <= '٩') char = String.fromCharCode(char.charCodeAt(0) - 1632 + 48);

            charMap.push({ node: n, offset: i });
            fullText += char.toLowerCase();
          }
        }

        RtlFixer._searchCache = { fullText, charMap, nodes };
      }

      const { fullText, charMap } = RtlFixer._searchCache;
      if (!fullText || charMap.length === 0) return null;

      let bestMatchIdx = -1;

      if (expectedStartPath) {
        const expectedEl = getElementByXPath(expectedStartPath);
        if (expectedEl) {
          for (let i = 0; i < charMap.length; i++) {
            if (charMap[i].node.parentElement === expectedEl || expectedEl.contains(charMap[i].node)) {
              const windowSub = fullText.slice(i, i + target.length);
              if (windowSub === target) {
                bestMatchIdx = i;
                break;
              }
            }
          }
        }
      }

      if (bestMatchIdx === -1) {
        bestMatchIdx = fullText.indexOf(target);
      }

      if (bestMatchIdx === -1) return null;

      const startCharInfo = charMap[bestMatchIdx];
      const endCharInfo   = charMap[bestMatchIdx + target.length - 1];

      if (!startCharInfo || !endCharInfo) return null;

      const range = document.createRange();
      range.setStart(startCharInfo.node, startCharInfo.offset);
      range.setEnd(endCharInfo.node, endCharInfo.offset + 1);

      const involved = new Set();
      for (let i = bestMatchIdx; i < bestMatchIdx + target.length; i++) {
        if (charMap[i] && charMap[i].node) involved.add(charMap[i].node);
      }
      range._involvedNodes = Array.from(involved);

      return range;
    } catch (e) {
      if (RtlFixer.DEBUG) console.warn('[Rastin RTL] findTextRange error:', e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESTORATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  let restoreTimeout = null;
  let _restoreRetryCount = 0;
  const MAX_RESTORE_RETRIES = 6;

  RtlFixer.requestRestore = function (isRetry = false) {
    if (!isRetry) _restoreRetryCount = 0;

    if (!isRetry && restoreTimeout) {
      return;
    }

    if (restoreTimeout) clearTimeout(restoreTimeout);

    const delay = isRetry
      ? Math.min(500 * Math.pow(1.8, _restoreRetryCount), 8000)
      : 300;

    restoreTimeout = setTimeout(() => {
      restoreTimeout = null;
      RtlFixer.loadAndRestoreHighlights(false);

      setTimeout(() => {
        if (_restoreRetryCount >= MAX_RESTORE_RETRIES) return;

        const cleanHost = getNormalizedHost();
        migrateWwwStorageIfNeeded(cleanHost, (storedHighlights) => {
          const currentKey = getPageKey(window.location.href);
          const storedForCurrentPage = storedHighlights.filter(hl => {
            if (hl.pageKey) return hl.pageKey === currentKey;
            if (!hl.url) return true;
            return getPageKey(hl.url) === currentKey;
          });

          const activeCountForPage = activeHighlights.filter(entry => {
            if (!entry || !entry.hlData) return false;
            const hlKey = entry.hlData.pageKey || getPageKey(entry.hlData.url);
            if (hlKey !== currentKey) return false;

            const colorClass = getColorClass(entry.hlData.color);
            if (hasCSSHighlights() && highlightRegistryData[colorClass]?.has(entry.hlData.id)) {
              const range = highlightRegistryData[colorClass].get(entry.hlData.id);
              return range && !range.collapsed && range.startContainer && range.startContainer.isConnected;
            }
            if (entry.marks && entry.marks.length > 0) {
              return entry.marks.every(m => m && m.isConnected);
            }
            return false;
          }).length;

          if (storedForCurrentPage.length > activeCountForPage) {
            _restoreRetryCount++;
            if (RtlFixer.DEBUG) console.log(`[Rastin RTL] Retry ${_restoreRetryCount}: ${activeCountForPage}/${storedForCurrentPage.length} restored for pageKey`);
            RtlFixer.requestRestore(true);
          }
        });
      }, 300);
    }, delay);
  };

  RtlFixer.loadAndRestoreHighlights = function (forceClear = true) {
    if (isRestoring) {
      if (RtlFixer.DEBUG) console.log('[Rastin RTL] Restoration already in progress, skipping');
      return;
    }

    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled) {
      RtlFixer.removeHighlight();
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => RtlFixer.loadAndRestoreHighlights(forceClear));
      return;
    }

    isRestoring = true;
    const cleanHost = getNormalizedHost();

    migrateWwwStorageIfNeeded(cleanHost, (highlights) => {
      let batchStarted = false;
      try {
        if (forceClear) {
          detachRenderedHighlights();
        }

        const repairedHighlights = new Map();
        const currentKey = getPageKey(window.location.href);

        const pageHighlights = highlights.filter(hl => {
          if (hl.pageKey) return hl.pageKey === currentKey;
          if (!hl.url) return true;
          try {
            return getPageKey(hl.url) === currentKey;
          } catch(e) {
            return true;
          }
        });

        if (RtlFixer.DEBUG) console.log(`[Rastin RTL] Restoring ${pageHighlights.length} highlights for pageKey: "${currentKey}"`);

        invalidateSearchCache();

        startBatchRebuild();
        batchStarted = true;

        for (const hl of pageHighlights) {
          const originalIdentity = getHighlightIdentity(hl);
          let isAttached = false;
          const existingEntry = getActiveEntry(hl.id);

          if (existingEntry) {
            const colorClass = getColorClass(hl.color);

            if (hasCSSHighlights() && highlightRegistryData[colorClass]?.has(hl.id)) {
              const range = highlightRegistryData[colorClass].get(hl.id);
              if (range && !range.collapsed && range.startContainer && range.startContainer.isConnected) {
                isAttached = true;
              }
            } else if (existingEntry.marks && existingEntry.marks.length > 0) {
              isAttached = existingEntry.marks.every(m => m && m.isConnected);
            }

            if (!isAttached) {
              removeActiveEntry(hl.id);
              if (colorClass && hasCSSHighlights()) {
                highlightRegistryData[colorClass].delete(hl.id);
              }
            }
          }

          if (isAttached) continue;

          if (!hl.id) {
            hl.id = 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            repairedHighlights.set(originalIdentity, {
              id: hl.id,
              pageKey: currentKey,
              startPath: hl.startPath,
              startNodeIndex: hl.startNodeIndex,
              startOffset: hl.startOffset,
              endPath: hl.endPath,
              endNodeIndex: hl.endNodeIndex,
              endOffset: hl.endOffset
            });
          }

          let restored = false;

          // ── Strategy 1: XPath + node index ──
          try {
            const startParent = getElementByXPath(hl.startPath);
            const endParent   = getElementByXPath(hl.endPath);

            if (startParent && endParent) {
              const startNode = startParent.childNodes[hl.startNodeIndex];
              const endNode   = endParent.childNodes[hl.endNodeIndex];

              if (startNode && endNode &&
                  startNode.nodeType === Node.TEXT_NODE &&
                  endNode.nodeType   === Node.TEXT_NODE) {
                const safeStart = Math.min(hl.startOffset, startNode.textContent.length);
                const safeEnd   = Math.min(hl.endOffset,   endNode.textContent.length);
                if (safeEnd > 0 || safeStart === 0) {
                  const range = document.createRange();
                  range.setStart(startNode, safeStart);
                  range.setEnd(endNode, safeEnd);
                  if (!range.collapsed) {
                    const rangeText = normalizeHighlightText(range.toString());
                    const targetText = normalizeHighlightText(hl.text);
                    if (rangeText && targetText && rangeText === targetText) {
                      const marks = wrapRangeWithMark(range, hl.color, hl.id);
                      if (marks && marks.length > 0) {
                        addActiveEntry({ hlData: hl, marks, savedRange: range });
                        restored = true;
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            if (RtlFixer.DEBUG) console.warn('[Rastin RTL] XPath restore failed:', e.message);
          }

          // ── Strategy 2: Full-text search fallback ──
          if (!restored) {
            try {
              const repairedRange = findTextRange(hl.text, hl.startPath);
              if (repairedRange && !repairedRange.collapsed) {
                const marks = wrapRangeWithMark(repairedRange, hl.color, hl.id);
                if (marks && marks.length > 0) {
                  addActiveEntry({ hlData: hl, marks, savedRange: repairedRange });
                  restored = true;

                  const sParent = repairedRange.startContainer.parentElement || repairedRange.startContainer;
                  const eParent = repairedRange.endContainer.parentElement   || repairedRange.endContainer;
                  hl.startPath      = getXPath(sParent);
                  hl.startNodeIndex = getNodeIndex(repairedRange.startContainer);
                  hl.startOffset    = repairedRange.startOffset;
                  hl.endPath        = getXPath(eParent);
                  hl.endNodeIndex   = getNodeIndex(repairedRange.endContainer);
                  hl.endOffset      = repairedRange.endOffset;
                  hl.pageKey        = currentKey;
                  repairedHighlights.set(originalIdentity, {
                    id: hl.id,
                    pageKey: currentKey,
                    startPath: hl.startPath,
                    startNodeIndex: hl.startNodeIndex,
                    startOffset: hl.startOffset,
                    endPath: hl.endPath,
                    endNodeIndex: hl.endNodeIndex,
                    endOffset: hl.endOffset
                  });
                }
              }
            } catch(e) {
              if (RtlFixer.DEBUG) console.warn('[Rastin RTL] Text-search restore failed:', e.message);
            }
          }

          if (!restored && RtlFixer.DEBUG) {
            console.warn(`[Rastin RTL] ✗ Could not restore: "${hl.text?.slice(0,40)}"`);
          }
        }

        flushBatchRebuild();
        batchStarted = false;

        if (repairedHighlights.size > 0) {
          const storageKey = getStorageKey(cleanHost);
          storage.update(storageKey, currentHighlights => currentHighlights.map(stored => {
            const repair = repairedHighlights.get(getHighlightIdentity(stored));
            return repair ? { ...stored, ...repair } : stored;
          }));
        }
      } catch (e) {
        console.warn('[Rastin RTL] Restore cycle error (recovered):', e);
      } finally {
        if (batchStarted) {
          flushBatchRebuild();
        }
        isRestoring = false;
        refreshHighlightManagementUi();
        consumePendingHighlight();
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HIT TESTING & ELEMENT LOCATORS
  // ═══════════════════════════════════════════════════════════════════════════
  const PENDING_HIGHLIGHT_KEY = 'rastin_pending_highlight_id';

  // Scrolls to a highlight and flashes it. Shared by the hub cards and by the
  // post-navigation handoff.
  function scrollToHighlightElement(hl) {
    const targetEl = findHighlightElement(hl);
    if (!targetEl || typeof targetEl.scrollIntoView !== 'function') return false;

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const origOutline = targetEl.style.outline;
    const origTransition = targetEl.style.transition;
    targetEl.style.transition = 'outline 0.3s ease, box-shadow 0.3s ease';
    targetEl.style.outline = '3px solid #fbbf24';
    setTimeout(() => {
      targetEl.style.outline = origOutline || '';
      targetEl.style.transition = origTransition || '';
    }, 1800);
    return true;
  }

  // Consumes the id stashed before a cross-page jump from the hub. Highlights
  // are restored asynchronously, so retry briefly before giving up.
  function consumePendingHighlight() {
    let pendingId = null;
    try {
      pendingId = sessionStorage.getItem(PENDING_HIGHLIGHT_KEY);
      if (pendingId) sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY);
    } catch (_) { return; }
    if (!pendingId) return;

    let attempts = 0;
    const tryScroll = () => {
      attempts++;
      const storageKey = getStorageKey();
      storage.get(storageKey, (res) => {
        const list = Array.isArray(res?.[storageKey]) ? res[storageKey] : [];
        const hl = list.find(h => h.id === pendingId);
        if (hl && scrollToHighlightElement(hl)) return;
        if (attempts < 10) setTimeout(tryScroll, 300);
      });
    };
    setTimeout(tryScroll, 300);
  }

  function findHighlightElement(hl, cheapOnly = false) {
    if (!belongsToCurrentPage(hl)) {
      return null;
    }

    if (hl.color && hl.id) {
      const colorClass = getColorClass(hl.color);
      if (hasCSSHighlights() && highlightRegistryData[colorClass]?.has(hl.id)) {
        const range = highlightRegistryData[colorClass].get(hl.id);
        if (range && range.startContainer) {
          return range.startContainer.parentElement || range.startContainer;
        }
      }
    }

    const activeEntry = getActiveEntry(hl.id);
    if (activeEntry) {
      if (activeEntry.marks && activeEntry.marks.length > 0) {
        const firstMark = activeEntry.marks.find(m => m && m.isConnected && !m._isCSSHighlight);
        if (firstMark) return firstMark;
      }
      if (activeEntry.savedRange && activeEntry.savedRange.startContainer) {
        return activeEntry.savedRange.startContainer.parentElement || activeEntry.savedRange.startContainer;
      }
    }

    const mark = document.querySelector(`mark.rastin-highlight[data-hl-id="${hl.id}"]`);
    if (mark) return mark;

    if (hl.startPath) {
      const el = getElementByXPath(hl.startPath);
      if (el) return el;
    }

    if (hl.text?.trim() && !cheapOnly) {
      try {
        const searchText = normalizeHighlightText(hl.text);
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent = node.parentElement;
              if (!parent || parent.closest(RASTIN_UI_SELECTOR)) {
                return NodeFilter.FILTER_REJECT;
              }
              if (!node.nodeValue?.trim()) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );
        let node;
        while ((node = walker.nextNode())) {
          const normalizedNodeText = normalizeHighlightText(node.nodeValue);
          if (normalizedNodeText.includes(searchText)) {
            return node.parentElement;
          }
        }
      } catch (error) {
        console.warn('[Rastin RTL] Highlight element search failed:', error);
      }
    }

    return null;
  }

  function isPointInsideRangeRects(clientX, clientY, range) {
    if (!range) return false;
    try {
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (clientX >= rect.left - 1 && clientX <= rect.right + 1 && clientY >= rect.top - 1 && clientY <= rect.bottom + 1) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function findHighlightAtPoint(clientX, clientY) {
    for (const entry of activeHighlights) {
      if (!entry) continue;
      const range = entry.savedRange || getHighlightRange(entry.hlData.id);
      if (range && isPointInsideRangeRects(clientX, clientY, range)) {
        return entry;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════
  function handleDocumentClick(event) {
    if (isDraggingBar || justFinishedDrag) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }

    const targetElement = getEventElement(event);

    if (isRastinUiEvent(event)) {
      return;
    }

    if (hubDrawer?.isConnected && hubDrawer.classList.contains('open')) {
      hubDrawer.classList.remove('open');
    }

    let clickedHlEntry = null;

    if (hasCSSHighlights() && activeHighlights.length > 0) {
      clickedHlEntry = findHighlightAtPoint(event.clientX, event.clientY);
    }

    if (!clickedHlEntry) {
      const mark = targetElement?.closest?.('mark.rastin-highlight');
      if (mark) {
        const hlId = mark.getAttribute('data-hl-id');
        clickedHlEntry = getActiveEntry(hlId);
      }
    }

    if (clickedHlEntry) {
      // Never hijack a click on page controls (a highlighted link must still
      // navigate); just let it through.
      const interactive = targetElement?.closest?.(
        'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"]'
      );
      if (interactive) return;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      const hlId = clickedHlEntry.hlData.id;
      activeHighlightId = hlId;
      currentSelectionText = clickedHlEntry.hlData.text;

      setActiveHighlight(hlId);

      const targetEl = findHighlightElement(clickedHlEntry.hlData) || targetElement;
      positionHighlightBar(targetEl);

      const colorName = getColorName(clickedHlEntry.hlData.color);
      const btn = highlightBar?.querySelector(`.rastin-color-btn.${colorName}`);
      if (btn) btn.classList.add('active');

      const deleteBtn = highlightBar?.querySelector('#rastin-bar-delete');
      if (deleteBtn) deleteBtn.style.display = 'flex';

      // Only surface the note when there is something to read — otherwise a
      // blank note panel pops up on every single highlight click.
      if (clickedHlEntry.hlData.note?.text?.trim() || notesMap.has(hlId)) {
        spawnStickyNote(clickedHlEntry.hlData, targetEl, { x: event.pageX, y: event.pageY });
      }
    } else {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() === '') {
        hideHighlightBar();
      }
    }
  }

  function handleMouseUp(event) {
    try {
      if (isRestoring || isRastinUiEvent(event) || isDraggingBar || justFinishedDrag) return;

      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';

      if (selectedText.length > 0) {
        activeRange = selection.getRangeAt(0).cloneRange();
        currentSelectionText = selectedText;
        activeHighlightId = null;

        activeSelectionCoords = {
          x: event.clientX,
          y: event.clientY
        };

        positionHighlightBar(activeRange);
      }
    } catch (e) {
      if (RtlFixer.DEBUG) console.warn('[Rastin RTL] handleMouseUp error:', e);
    }
  }

  function handleMouseMove(event) {
    if (mouseMoveRafId) return;
    const clientX = event.clientX;
    const clientY = event.clientY;

    mouseMoveRafId = requestAnimationFrame(() => {
      mouseMoveRafId = null;

      if (isRastinUiEvent(event)) {
        setHoverHighlight(null);
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = '';
        }
        return;
      }

      if (activeRange) {
        setHoverHighlight(null);
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = '';
        }
        return;
      }

      if (activeHighlights.length === 0) {
        setHoverHighlight(null);
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = '';
        }
        return;
      }

      const hoveredEntry = findHighlightAtPoint(clientX, clientY);
      if (hoveredEntry) {
        const range = getHighlightRange(hoveredEntry.hlData.id);
        setHoverHighlight(range);
        document.body.style.cursor = 'pointer';
      } else {
        setHoverHighlight(null);
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = '';
        }
      }
    });
  }

  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (activeRange) positionHighlightBar(activeRange);
      updateHighlighterRadar();
    }, 150);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      if (highlightBar && !highlightBar.classList.contains('hidden')) {
        hideHighlightBar();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC MODULE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════
  let _forcedReloadTimer = null;

  RtlFixer.scrollToHighlightById = function (id) {
    if (!id) return false;
    const entry = getActiveEntry(id);
    if (entry) {
      const range = getHighlightRange(id);
      if (range) {
        const rect = range.getBoundingClientRect();
        window.scrollTo({
          top: Math.max(0, rect.top + window.scrollY - window.innerHeight / 2),
          behavior: 'smooth'
        });
        setHoverHighlight(range);
        setTimeout(() => setHoverHighlight(null), 1800);
        return true;
      }
    }
    const storageKey = getStorageKey();
    storage.get(storageKey, (res) => {
      const storedHighlights = Array.isArray(res?.[storageKey]) ? res[storageKey] : [];
      const hl = storedHighlights.find(h => h.id === id);
      if (hl) {
        const el = findHighlightElement(hl);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
    return true;
  };

  RtlFixer.initHighlight = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled) {
      RtlFixer.removeHighlight();
      return;
    }

    startSpaWatch();

    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleResize);

    RtlFixer.loadAndRestoreHighlights();

    if (_forcedReloadTimer) clearTimeout(_forcedReloadTimer);
    _forcedReloadTimer = setTimeout(() => {
      _forcedReloadTimer = null;
      const cfg = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
      if (cfg.enabled && cfg.highlightEnabled) {
        RtlFixer.loadAndRestoreHighlights(false);
      }
    }, 1500);
  };

  RtlFixer.removeHighlight = function () {
    stopSpaWatch();

    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('resize', handleResize);

    if (_forcedReloadTimer) {
      clearTimeout(_forcedReloadTimer);
      _forcedReloadTimer = null;
    }

    detachRenderedHighlights();

    if (radarContainer && radarContainer.parentNode) {
      radarContainer.parentNode.removeChild(radarContainer);
      radarContainer = null;
    }

    if (hubDrawer && hubDrawer.parentNode) {
      hubDrawer.parentNode.removeChild(hubDrawer);
      hubDrawer = null;
    }
  };

  if (window.RtlFixer && window.RtlFixer.DEBUG) console.log('[Rastin RTL Highlight] highlight-manager.js initialized successfully.');
})(window.RtlFixer);
