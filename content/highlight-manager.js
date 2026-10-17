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
    '[data-rastin-reader-ui]',
    '#rtl-fixer-translator-host',
    '#rtl-fixer-paint-host',
    '#rastin-ui-toast',
    '#rastin-highlight-save-error',
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
    return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  }

  function getColorClass(hex) {
    return COLOR_MAP[String(hex || '').toLowerCase()] || 'color-yellow';
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
  let mouseMoveRafId = null;
  let isRestoring = false;
  let highlightInitialized = false;
  let knownPageHighlightCount = null;
  let resizeTimeout = null;
  let isDraggingBar = false;
  let justFinishedDrag = false;

  let activeHighlights = [];               // Array of { hlData, marks: [] }
  const activeHighlightsById = new Map();  // id → entry
  const highlightTextNodesById = new Map();// id → text nodes covered by its range
  let rangeHighlightIds = new WeakMap();
  let textNodeHighlightIds = new WeakMap();// text node → highlight ids (fast hit testing)
  const notesMap = new Map();              // Sticky note elements by highlight ID
  let pendingStorageWrites = 0;
  let storageSyncTimer = null;
  const pendingNoteFlushes = new Set();
  const dirtyHighlightIds = new Set();
  let highlightAncestorIds = new WeakMap();
  const highlightAncestorsById = new Map();
  const dragCleanups = new Set();
  const workWaits = new Set();
  let lifecycleEpoch = 0;
  let restoreJob = null;
  let restorePending = false;
  let storageRevision = 0;
  let lastRestoreStamp = null;
  let restoreBackoff = 0;
  let domReadyRestore = null;
  let hoveredRange = null;
  let hoverCursorState = null;
  const WORK_SLICE_MS = 6;

  function workIsCurrent(job) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    return job.epoch === lifecycleEpoch && job.pageKey === getPageKey(window.location.href) &&
      config.enabled && config.highlightEnabled && config.globalEnabled !== false;
  }

  function assertCurrentWork(job) {
    if (!workIsCurrent(job)) throw new Error('Highlight work cancelled');
    if (job.invalidated || (!job.trackRoots && job.mutationVersion !== (RtlFixer._domMutationVersion || 0))) {
      restorePending = true;
      throw new Error('Highlight document changed');
    }
  }

  function yieldHighlightWork(job) {
    assertCurrentWork(job);
    return new Promise(resolve => {
      const wait = { timer: null, finish: () => { workWaits.delete(wait); resolve(); } };
      wait.timer = setTimeout(wait.finish, 0);
      workWaits.add(wait);
    }).then(() => assertCurrentWork(job));
  }

  function cancelHighlightWork() {
    lifecycleEpoch++;
    restoreJob = null;
    isRestoring = false;
    restorePending = false;
    pendingNavigation = null; pendingNavigationRead = false;
    clearTimeout(restoreTimeout);
    restoreTimeout = null;
    if (domReadyRestore) document.removeEventListener('DOMContentLoaded', domReadyRestore);
    domReadyRestore = null;
    for (const wait of [...workWaits]) { clearTimeout(wait.timer); wait.finish(); }
  }

  function restoreStamp() {
    return getPageKey(window.location.href) + ':' + (RtlFixer._domMutationVersion || 0) + ':' + storageRevision;
  }
  window.addEventListener('pagehide', () => {
    for (const flush of [...pendingNoteFlushes]) flush();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME STORAGE WRAPPER
  // ═══════════════════════════════════════════════════════════════════════════
  const storage = {
    mutate: function (key, operation, callback, onError) {
      pendingStorageWrites++;
      try {
        chrome.runtime.sendMessage({ action: 'mutateHighlights', key, operation }, response => {
          pendingStorageWrites--;
          const error = chrome.runtime.lastError?.message || (!response?.ok && (response?.error || 'No storage response'));
          if (error) {
            reportStorageFailure(error);
            if (onError) onError(new Error(error));
            return;
          }
          if (callback) callback(response.items);
        });
      } catch (error) {
        pendingStorageWrites--;
        if (onError) onError(error);
        reportStorageFailure(error.message);
      }
    },
    // Read-only UI snapshots; writes always go through the service worker.
    get: function (keys, callback, onError) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime.lastError) {
              reportStorageFailure(chrome.runtime.lastError.message);
              if (onError) onError(new Error(chrome.runtime.lastError.message));
            } else {
              callback(res || {});
            }
          });
        } else {
          reportStorageFailure('Extension storage unavailable');
          if (onError) onError(new Error('Extension storage unavailable'));
        }
      } catch (e) {
        reportStorageFailure(e.message);
        if (onError) onError(e);
      }
    },
  };

  function reportStorageFailure(error) {
    console.error('[Rastin RTL] Highlight storage failed:', error);
    let notice = document.getElementById('rastin-highlight-save-error');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'rastin-highlight-save-error';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#702020;color:white;padding:16px;max-width:380px;direction:rtl';
      notice.textContent = 'ذخیرهٔ هایلایت یا یادداشت انجام نشد. افزونه را بررسی کنید؛ تغییر اخیر ممکن است با تازه‌سازی از دست برود.';
      (document.body || document.documentElement).appendChild(notice);
    }
  }

  // Reconcile other tabs without rebuilding every range after every keystroke.
  function scheduleStorageSync() {
    clearTimeout(storageSyncTimer);
    storageSyncTimer = setTimeout(() => {
      if (!RtlFixer.config?.enabled || !RtlFixer.config?.highlightEnabled) return;
      if (pendingStorageWrites || isRestoring) { scheduleStorageSync(); return; }
      if (!RtlFixer.config?.enabled || !RtlFixer.config?.highlightEnabled) return;
      const pageKey = getPageKey(window.location.href), epoch = lifecycleEpoch;
      storage.get(getStorageKey(), result => {
        if (epoch !== lifecycleEpoch || !RtlFixer.config?.enabled || !RtlFixer.config?.highlightEnabled) return;
        if (pendingStorageWrites || isRestoring || pageKey !== getPageKey(window.location.href)) { scheduleStorageSync(); return; }
        const records = result[getStorageKey()];
        if (records !== undefined && !Array.isArray(records)) return;
        const current = new Map((records || []).filter(belongsToCurrentPage).map(h => [h.id, h]));
        knownPageHighlightCount = current.size;
        for (const entry of [...activeHighlights]) {
          const saved = current.get(entry.hlData.id);
          if (!saved) {
            unwrapHighlight(entry.hlData.id);
            notesMap.get(entry.hlData.id)?.remove();
            notesMap.delete(entry.hlData.id);
          } else {
            if (saved.color !== entry.hlData.color) changeHighlightColor(saved.id, entry.hlData.color, saved.color);
            entry.hlData = saved;
            const noteEl = notesMap.get(saved.id);
            if (noteEl && !noteEl.contains(document.activeElement)) {
              noteEl.className = `rastin-note ${getColorClass(saved.color)}${saved.note?.minimized ? ' minimized' : ''}`;
              const body = noteEl.querySelector('.rastin-note-body');
              if (body && body.textContent !== (saved.note?.text || '')) body.textContent = saved.note?.text || '';
            }
          }
        }
        if ([...current.keys()].some(id => !entryIsAttached(getActiveEntry(id)))) RtlFixer.requestRestore(false);
        refreshHighlightManagementUi();
      });
    }, 150);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[getStorageKey()]) { storageRevision++; lastRestoreStamp = null; scheduleStorageSync(); }
  });

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
      const readerUrl = RtlFixer.getReaderDocumentUrl?.(u);
      const host = getNormalizedHost(u.hostname);
      const pathname = (u.pathname || '').replace(/\/+$/, '') || '/';
      const search = readerUrl ? new URL(readerUrl).search : u.search || '';
      let hashRoute = '';
      if (!readerUrl && u.hash && (u.hash.startsWith('#/') || u.hash.startsWith('#!/'))) {
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
    return stripped.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  }

  function getHighlightIdentity(highlight) {
    if (highlight.id) return `id:${highlight.id}`;
    return `legacy:${JSON.stringify([
      highlight.timestamp, highlight.text, highlight.url, highlight.startPath, highlight.startNodeIndex,
      highlight.startOffset, highlight.endPath, highlight.endNodeIndex, highlight.endOffset
    ])}`;
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
    highlightTextNodesById.clear();
    rangeHighlightIds = new WeakMap();
    textNodeHighlightIds = new WeakMap();
    highlightAncestorIds = new WeakMap();
    highlightAncestorsById.clear();
    dirtyHighlightIds.clear();
  }

  function unindexHighlightTextNodes(id) {
    dirtyHighlightIds.delete(id);
    for (const element of highlightAncestorsById.get(id) || []) {
      const ids = highlightAncestorIds.get(element);
      ids?.delete(id);
      if (ids?.size === 0) highlightAncestorIds.delete(element);
    }
    highlightAncestorsById.delete(id);
    const nodes = highlightTextNodesById.get(id);
    if (!nodes) return;
    for (const node of nodes) {
      const ids = textNodeHighlightIds.get(node);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size === 0) textNodeHighlightIds.delete(node);
    }
    highlightTextNodesById.delete(id);
  }

  function indexHighlightTextNodes(id, range, replacementNodes = null) {
    if (!id) return;
    unindexHighlightTextNodes(id);
    const nodes = replacementNodes || getTextNodesInRange(range);
    const connectedNodes = nodes.filter(node => node?.nodeType === Node.TEXT_NODE && node.isConnected);
    if (connectedNodes.length === 0) return;
    highlightTextNodesById.set(id, connectedNodes);
    const ancestors = new Set();
    const commonRoot = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    for (const node of connectedNodes) {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        ancestors.add(parent);
        if (parent === commonRoot) break;
      }
    }
    highlightAncestorsById.set(id, ancestors);
    for (const element of ancestors) {
      let ids = highlightAncestorIds.get(element);
      if (!ids) { ids = new Set(); highlightAncestorIds.set(element, ids); }
      ids.add(id);
    }
    for (const node of connectedNodes) {
      let ids = textNodeHighlightIds.get(node);
      if (!ids) {
        ids = new Set();
        textNodeHighlightIds.set(node, ids);
      }
      ids.add(id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETACH & DELETE HIGHLIGHT FUNCTIONS (Declared early for lifecycle calls)
  // ═══════════════════════════════════════════════════════════════════════════
  function detachRenderedHighlights() {
    cancelHighlightWork();
    for (const flush of [...pendingNoteFlushes]) flush();
    for (const cleanup of [...dragCleanups]) cleanup();
    notesMap.forEach(note => note.remove());
    notesMap.clear();
    const parents = new Set();
    mutateHighlightDOM(() => {
    document.querySelectorAll('mark.rastin-highlight').forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parents.add(parent);
    });
    for (const parent of parents) parent.normalize();
    });
    for (const [color, ranges] of Object.entries(highlightRegistryData)) {
      ranges.clear();
      if (hasCSSHighlights()) CSS.highlights.delete('rastin-' + color);
    }
    clearAllActiveEntries();
    setHoverHighlight(null);
    restoreHoverCursor();
    clearActiveHighlight();
    hideHighlightBar();
    invalidateSearchCache();
    lastRestoreStamp = null; restoreBackoff = 0;
    refreshHighlightManagementUi();
  }

  function deleteCurrentPageHighlights() {
    const storageKey = getStorageKey();
    const currentPageKey = getPageKey(window.location.href);

    storage.mutate(
      storageKey,
      { type: 'deletePage', pageKey: currentPageKey },
      () => {
        if (currentPageKey === getPageKey(window.location.href)) {
          detachRenderedHighlights(); knownPageHighlightCount = 0;
        }
        refreshHighlightManagementUi();
      }
    );
  }

  function clearAllHighlightsAllSites() {
    storage.mutate(getStorageKey(), { type: 'clearAll' }, () => {
      detachRenderedHighlights();
      refreshHighlightManagementUi();
    });
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
        knownPageHighlightCount = null;
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
    document.addEventListener('visibilitychange', checkSpaUrlChange);
    checkSpaUrlChange();
    // pushState does not emit popstate in an isolated content script. Keep a
    // cheap URL fallback, and skip it in background tabs.
    spaWatchInterval = window.setInterval(() => { if (!document.hidden) checkSpaUrlChange(); }, 1000);
    spaWatchAttached = true;
  }

  function stopSpaWatch() {
    if (!spaWatchAttached) return;
    window.removeEventListener('popstate', checkSpaUrlChange);
    window.removeEventListener('hashchange', checkSpaUrlChange);
    window.removeEventListener('pageshow', checkSpaUrlChange);
    document.removeEventListener('visibilitychange', checkSpaUrlChange);
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

  function rebuildCSSHighlights(colorClass = null) {
    if (!hasCSSHighlights()) return;

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

  function addCSSHighlightRange(colorClass, range) {
    if (!hasCSSHighlights()) return;
    const hlName = `rastin-${colorClass}`;
    try {
      const registered = CSS.highlights.get(hlName);
      if (registered && typeof registered.add === 'function') {
        registered.add(range);
      } else {
        rebuildCSSHighlights(colorClass);
      }
    } catch (_) {
      rebuildCSSHighlights(colorClass);
    }
  }

  function removeCSSHighlightRange(colorClass, range) {
    if (!hasCSSHighlights()) return;
    const hlName = `rastin-${colorClass}`;
    try {
      const registered = CSS.highlights.get(hlName);
      if (registered && typeof registered.delete === 'function' && range) {
        registered.delete(range);
        if (highlightRegistryData[colorClass].size === 0) {
          CSS.highlights.delete(hlName);
        }
      } else {
        rebuildCSSHighlights(colorClass);
      }
    } catch (_) {
      rebuildCSSHighlights(colorClass);
    }
  }

  function setHoverHighlight(range) {
    if (range === hoveredRange) return;
    hoveredRange = range || null;
    if (!hasCSSHighlights()) return;
    try {
      if (range && !range.collapsed && range.startContainer.isConnected && range.endContainer.isConnected) {
        CSS.highlights.set('rastin-hover', new Highlight(range));
      } else CSS.highlights.delete('rastin-hover');
    } catch (_) {}
  }

  function restoreHoverCursor() {
    if (!hoverCursorState) return;
    const { element, value, priority } = hoverCursorState;
    if (element.style.cursor === 'pointer') {
      if (value) element.style.setProperty('cursor', value, priority);
      else element.style.removeProperty('cursor');
    }
    hoverCursorState = null;
  }

  function updateHoverCursor(hovering) {
    if (!hovering) { restoreHoverCursor(); return; }
    if (hoverCursorState || !document.body) return;
    const element = document.body;
    hoverCursorState = { element, value: element.style.getPropertyValue('cursor'), priority: element.style.getPropertyPriority('cursor') };
    element.style.cursor = 'pointer';
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
    if (!entryIsAttached(entry)) return null;

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

  function mutateHighlightDOM(callback) {
    const observer = RtlFixer.observer;
    const pending = observer?.takeRecords();
    // Deliver pending page changes first. Then consume only the synchronous
    // records generated by our text wrapping/unwrapping transaction.
    if (pending?.length) RtlFixer.handlePageMutations?.(pending);
    try { return callback(); } finally { observer?.takeRecords(); }
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
      rangeHighlightIds.set(range, id);
      indexHighlightTextNodes(id, range);
      addCSSHighlightRange(colorClass, range);

      const fakeMark = {
        _isCSSHighlight: true,
        _colorClass: colorClass,
        isConnected: true
      };
      return [fakeMark];
    }

    // DOM Mark Fallback
    return mutateHighlightDOM(() => {
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
      const markedTextNodes = [];
      for (const mark of marks) {
        const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
        let markedNode;
        while ((markedNode = walker.nextNode())) markedTextNodes.push(markedNode);
      }
      indexHighlightTextNodes(id, range, markedTextNodes);
    } catch (e) {
      console.warn('[Rastin RTL] DOM mark wrapping fallback error:', e);
    }

    return marks;
    });
  }

  function unwrapHighlight(id) {
    if (!id) return;
    unindexHighlightTextNodes(id);
    if (hasCSSHighlights()) {
      for (const colorClass of Object.keys(highlightRegistryData)) {
        if (highlightRegistryData[colorClass] && highlightRegistryData[colorClass].has(id)) {
          const range = highlightRegistryData[colorClass].get(id);
          if (range === hoveredRange) { setHoverHighlight(null); restoreHoverCursor(); }
          rangeHighlightIds.delete(range);
          highlightRegistryData[colorClass].delete(id);
          try { removeCSSHighlightRange(colorClass, range); } catch(_) {}
        }
      }
    }

    const entry = getActiveEntry(id);
    if (!entry) return;

    if (entry.marks && Array.isArray(entry.marks)) {
      mutateHighlightDOM(() => entry.marks.forEach(mark => {
        if (!mark || mark._isCSSHighlight) return;
        if (mark.parentNode) {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          try { parent.normalize(); } catch(_) {}
        }
      }));
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
        removeCSSHighlightRange(oldClass, range);
        addCSSHighlightRange(newClass, range);
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
  let hubFilter = 'page';
  let hubItems = [];
  let lastDeletedHighlight = null;
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
    if (config.globalEnabled === false || !config.enabled || !config.highlightEnabled) {
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

      const dots = document.createDocumentFragment();
      highlights.forEach(hl => {
        // Cheap lookup only: the text-search fallback walks the whole document
        // and the radar repaints on every storage write.
        const el = findHighlightElement(hl);
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
        dots.appendChild(dot);
      });
      radarContainer.appendChild(dots);
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
            <input type="search" class="rastin-hub-input" id="rastin-hub-search-input" aria-label="جستجو در هایلایت‌ها" placeholder="جستجو در هایلایت‌ها…" />
          </div>
        </div>
        <div class="rastin-hub-filters" role="group" aria-label="فیلتر هایلایت‌ها"><button type="button" class="rastin-hub-filter active" data-filter="page">این صفحه</button><button type="button" class="rastin-hub-filter" data-filter="site">این سایت</button><button type="button" class="rastin-hub-filter" data-filter="notes">یادداشت‌دار</button><span class="rastin-hub-count"></span></div>
        <div class="rastin-hub-list" id="rastin-hub-list"></div>
        <div class="rastin-hub-footer"><button type="button" class="rastin-hub-filter" id="rastin-hub-export">خروجی JSON</button><button type="button" class="rastin-hub-filter" id="rastin-hub-undo" disabled>بازگرداندن حذف</button></div>
      `;
      (document.documentElement || document.body).appendChild(hubDrawer);

      hubDrawer.setAttribute('role', 'dialog'); hubDrawer.setAttribute('aria-label', 'هایلایت‌ها و یادداشت‌ها');
      hubDrawer.querySelector('.rastin-hub-title').innerHTML = RtlFixer.UI.icon('bookmark') + '<span>هایلایت‌ها و یادداشت‌ها</span>';
      hubDrawer.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
        hubFilter = button.dataset.filter;
        hubDrawer.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button));
        renderHighlightHubCards(hubDrawer.querySelector('#rastin-hub-search-input').value);
      }));
      hubDrawer.querySelector('#rastin-hub-undo').addEventListener('click', undoHighlightDelete);
      hubDrawer.querySelector('#rastin-hub-export').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ version: 1, url: location.href, highlights: hubItems }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'rastin-highlights.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
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
      '#fef08a': 'مهم',
      '#bbf7d0': 'نکته کلیدی',
      '#fecaca': 'اقدام لازم',
      '#fecdd3': '⚡ اقدام لازم',
      '#bfdbfe': 'منبع',
      '#e9d5ff': 'شخصی'
    };

    const storageKey = getStorageKey();
    storage.get(storageKey, async (res) => {
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
        hubItems = []; hubDrawer.querySelector('.rastin-hub-count').textContent = '۰ مورد';
        hubDrawer.querySelector('#rastin-hub-undo').disabled = !lastDeletedHighlight;
        listEl.innerHTML = '<div class="rastin-hub-empty">' + RtlFixer.UI.icon('bookmark') + '<span>هنوز هایلایتی ذخیره نکرده‌اید</span><span>متن صفحه را انتخاب و یک رنگ را انتخاب کنید.</span></div>';
        return;
      }

      const searchText = text => String(text || '').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
      const filtered = highlights.filter(h => {
        if (hubFilter === 'page' && !belongsToCurrentPage(h)) return false;
        if (hubFilter === 'notes' && !h.note?.text?.trim()) return false;
        if (!filterText) return true;
        const query = searchText(filterText);
        return (h.text && searchText(h.text).includes(query)) ||
               (h.note && h.note.text && searchText(h.note.text).includes(query)) ||
               (h.title && searchText(h.title).includes(query)) ||
               (h.path && searchText(h.path).includes(query));
      });

      hubItems = filtered;
      hubDrawer.querySelector('.rastin-hub-count').textContent = filtered.length.toLocaleString('fa-IR') + ' مورد';
      hubDrawer.querySelector('#rastin-hub-undo').disabled = !lastDeletedHighlight;
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="rastin-hub-empty">' + RtlFixer.UI.icon('search') + '<span>موردی با این فیلتر یافت نشد.</span></div>';
        return;
      }

      let cards = document.createDocumentFragment(), batchCount = 0;
      for (const hl of filtered) {
        const isCurrentPage = belongsToCurrentPage(hl);
        const card = document.createElement('article');
        card.className = `rastin-hub-card ${isCurrentPage ? '' : 'cross-page'}`;

        const tag = document.createElement('div');
        tag.className = `rastin-hub-card-tag ${getColorClass(hl.color)}`;
        tag.textContent = categoryNames[hl.color] || '📌 عمومی';

        const text = document.createElement('div');
        text.className = 'rastin-hub-card-text'; text.setAttribute('dir','auto');
        text.textContent = hl.text || '';

        card.append(tag, text);
        if (isCurrentPage && !entryIsAttached(getActiveEntry(hl.id))) {
          const status = document.createElement('div'); status.className = 'rastin-hub-card-page';
          status.textContent = isRestoring ? 'در حال یافتن متن…' : 'متن فعلاً در صفحه پیدا نشد'; card.appendChild(status);
        }

        if (hl.note?.text) {
          const note = document.createElement('div');
          note.className = 'rastin-hub-card-note'; note.setAttribute('dir', 'auto');
          note.textContent = hl.note.text;
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

        const actions = document.createElement('div'); actions.className = 'rastin-hub-card-actions';
        const addAction = (label, callback) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'rastin-hub-card-action'; button.textContent = label; button.addEventListener('click', event => { event.stopPropagation(); callback(); }); actions.appendChild(button); return button; };
        addAction('نمایش', () => card.click()).classList.add('is-primary'); addAction('کپی', () => RtlFixer.UI.copy(hl.text || ''));
        const edit = addAction('یادداشت', () => { if (isCurrentPage) spawnStickyNote(hl); }); edit.disabled = !isCurrentPage;
        addAction('حذف', () => { deleteHighlight(hl.id, hl); }).classList.add('is-destructive');
        card.appendChild(actions); cards.appendChild(card);
        if (++batchCount >= 30) {
          listEl.appendChild(cards); cards = document.createDocumentFragment(); batchCount = 0;
          await new Promise(resolve => setTimeout(resolve, 0));
          if (currentVersion !== hubRenderVersion || !hubDrawer?.isConnected) return;
        }
      }
      listEl.appendChild(cards);
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
    highlightBar.setAttribute('role', 'toolbar');
    highlightBar.setAttribute('aria-label', 'هایلایت متن');
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

      const onPointerUp = () => {
        isDraggingBar = false;
        highlightBar?.classList.remove('is-dragging');
        dragCleanups.delete(onPointerUp);

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

      dragCleanups.add(onPointerUp);
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
      btn.title = col.name; btn.setAttribute('aria-label', col.name);
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
    highlightBar.addEventListener('click', event => {
      // Keyboard activation emits click without a pointerdown.
      const button = event.target.closest('button');
      if (event.detail === 0 && button && button !== hubBtn) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      }
    });

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
      storage.mutate(storageKey, { type: 'patch', id, fields: { color: finalColor }, note: { color: finalColor } }, () => {
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

    if (!activeRange || !isPageSelection(activeRange)) return;
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
    const textAnchor = createTextAnchor(range, currentSelectionText);

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
      url: RtlFixer.getReaderDocumentUrl?.() || window.location.href,
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
      textAnchor,
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
    storage.mutate(storageKey, { type: 'add', item: highlightObject }, () => {
      refreshHighlightManagementUi();
      if (!textAnchor && savedRange.startContainer.isConnected) {
        const job = { epoch: lifecycleEpoch, pageKey: highlightObject.pageKey,
          mutationVersion: RtlFixer._domMutationVersion || 0, indexes: new WeakMap(), sliceStart: performance.now() };
        createTextAnchorAsync(savedRange, highlightObject.text, job).then(anchor => {
          if (!anchor || !workIsCurrent(job) || !getActiveEntry(id)) return;
          highlightObject.textAnchor = anchor;
          storage.mutate(storageKey, { type: 'patch', id, fields: { textAnchor: anchor } });
        }).catch(() => {});
      }
    });
  }

  function deleteHighlight(id, saved = null) {
    pendingNoteFlushes.forEach(flush => flush());
    const entry = getActiveEntry(id); const item = saved || entry?.hlData;
    if (item) lastDeletedHighlight = { key: getStorageKey(), item: JSON.parse(JSON.stringify(item)) };
    unwrapHighlight(id);

    if (notesMap.has(id)) {
      const noteEl = notesMap.get(id);
      if (noteEl && noteEl.parentNode) {
        noteEl.parentNode.removeChild(noteEl);
      }
      notesMap.delete(id);
    }

    const storageKey = getStorageKey();
    storage.mutate(storageKey, { type: 'remove', id }, refreshHighlightManagementUi);
  }

  function undoHighlightDelete() {
    if (!lastDeletedHighlight) return;
    const record = lastDeletedHighlight; lastDeletedHighlight = null;
    storage.mutate(record.key, { type: 'add', item: record.item }, () => {
      RtlFixer.requestRestore(); refreshHighlightManagementUi(); RtlFixer.UI.toast('هایلایت بازگردانده شد');
    });
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
    const noteStorageKey = getStorageKey();

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
    dragHandle.innerHTML = RtlFixer.UI.icon('grip') + '<span>یادداشت</span>';
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
      storage.mutate(storageKey, { type: 'patch', id: hl.id, note: { minimized: note.minimized } }, refreshHighlightManagementUi);
    });
    const copyNote = document.createElement('button'); copyNote.type = 'button'; copyNote.className = 'rastin-note-btn'; copyNote.title = 'کپی یادداشت'; copyNote.setAttribute('aria-label', copyNote.title); copyNote.innerHTML = RtlFixer.UI.icon('copy'); copyNote.addEventListener('click', () => RtlFixer.UI.copy(body.textContent || '')); actions.appendChild(copyNote);
    actions.appendChild(minBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rastin-note-btn rastin-note-close-btn';
    closeBtn.title = 'بستن یادداشت';
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      flushNoteSave();
      if (noteEl.parentNode) noteEl.parentNode.removeChild(noteEl);
      notesMap.delete(hl.id);
    });
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    noteEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rastin-note-body';
    body.contentEditable = 'plaintext-only';
    body.setAttribute('role', 'textbox'); body.setAttribute('aria-label', 'یادداشت'); body.setAttribute('aria-multiline', 'true'); body.setAttribute('dir', 'auto');
    body.setAttribute('placeholder', 'یادداشت خود را بنویسید...');

    if (note.text) {
      body.textContent = note.text;
    }

    const updateNoteDir = () => { body.setAttribute('dir', 'auto'); body.style.textAlign = 'start'; };
    updateNoteDir();

    const footer = document.createElement('div'); footer.className = 'rastin-note-footer';
    const saveState = document.createElement('span'); saveState.setAttribute('role', 'status'); saveState.textContent = 'ذخیره خودکار';
    const count = document.createElement('span'); count.textContent = (body.textContent || '').length.toLocaleString('fa-IR') + ' نویسه';
    footer.append(saveState, count);
    let pendingNoteText = null;
    let noteSaveTimer = null;

    function flushNoteSave() {
      if (noteSaveTimer) {
        clearTimeout(noteSaveTimer);
        noteSaveTimer = null;
      }
      pendingNoteFlushes.delete(flushNoteSave);
      if (pendingNoteText === null) {
        return;
      }

      const textToSave = pendingNoteText;
      pendingNoteText = null;

      hl.note.text = textToSave;

      const activeEntry = getActiveEntry(hl.id);
      if (activeEntry && activeEntry.hlData && activeEntry.hlData.note) {
        activeEntry.hlData.note.text = textToSave;
      }

      storage.mutate(
        noteStorageKey,
        { type: 'patch', id: hl.id, note: { text: textToSave } },
        () => {
          saveState.textContent = 'ذخیره شد'; refreshHighlightManagementUi();
        }
      );
    }

    body.addEventListener('input', () => {
      updateNoteDir();
      pendingNoteText = body.textContent || '';
      saveState.textContent = 'در حال ذخیره…'; count.textContent = pendingNoteText.length.toLocaleString('fa-IR') + ' نویسه';
      pendingNoteFlushes.add(flushNoteSave);
      if (noteSaveTimer) clearTimeout(noteSaveTimer);
      noteSaveTimer = setTimeout(flushNoteSave, 150);
    });
    body.addEventListener('blur', flushNoteSave);

    noteEl.append(body, footer);

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

    const stopNoteDrag = () => {
      dragCleanups.delete(stopNoteDrag);
      document.removeEventListener('mousemove', onDragMove, true);
      document.removeEventListener('mouseup', onDragEnd, true);
    };
    const onDragEnd = () => {
      stopNoteDrag();
      const storageKey = getStorageKey();
      storage.mutate(storageKey, { type: 'patch', id: hl.id, note: { position: { ...note.position } } }, refreshHighlightManagementUi);
    };

    dragHandle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      initialX = parseFloat(noteEl.style.left) || noteEl.offsetLeft;
      initialY = parseFloat(noteEl.style.top) || noteEl.offsetTop;
      noteEl.style.zIndex = '2147483644';
      e.preventDefault();
      dragCleanups.add(stopNoteDrag);
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
        // An ID-bearing ancestor can be anywhere in the document, not only
        // its root element. A single slash made every descendant path invalid.
        return '//' + parts.join('/');
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
    if (typeof path !== 'string' || !path) return null;
    try {
      // Our ID-based selectors can bypass document-wide XPath traversal, even
      // when the ID has disappeared. Descendants resolve relative to that ID.
      const idPath = /^\/{1,2}\*\[@id=(?:"([^"]*)"|'([^']*)')\](.*)$/.exec(path);
      if (idPath && (!idPath[3] || idPath[3].startsWith('/'))) {
        const root = document.getElementById(idPath[1] ?? idPath[2]);
        if (!root || !idPath[3]) return root;
        return document.evaluate('.' + idPath[3], root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      }
      // Compatibility with descendant paths saved before the ancestor-ID fix.
      const normalizedPath = /^\/\*\[@id=/.test(path) ? '/' + path : path;
      return document.evaluate(normalizedPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (_) {
      return null;
    }
  }

  const TEXT_ANCHOR_CONTEXT_LENGTH = 48;
  const ANCHOR_BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'BLOCKQUOTE',
    'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
  ]);

  function isSearchableTextElement(element) {
    return element && !element.isContentEditable && !element.matches?.(
      'script,style,noscript,iframe,head,template,math,input,textarea,select,[hidden],[aria-hidden="true"],' + RASTIN_UI_SELECTOR
    );
  }
  const IGNORED_TEXT_CHAR = /[\s\u200b\u200c\u200d\u00a0\ufeff]/;

  // Yield inside long text nodes as well as between nodes; never recurse in JS.
  function* normalizedTextIndexSteps(root) {
    const nodes = [], textParts = [], segments = [], nodeSegments = new WeakMap();
    if (!root || (root.nodeType === Node.ELEMENT_NODE && !isSearchableTextElement(root))) return { fullText: '', nodes, segments, nodeSegments };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeType === Node.ELEMENT_NODE
        ? (isSearchableTextElement(node) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT) : NodeFilter.FILTER_ACCEPT
    });
    let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode(), textLength = 0;
    while (node) {
      const text = node.nodeValue || '', localSegments = [];
      let chars = [], offsets = [];
      const flush = () => {
        if (!chars.length) return;
        textParts.push(chars.join(''));
        const segment = { node, start: textLength, end: textLength + chars.length, offsets: Uint32Array.from(offsets) };
        segments.push(segment); localSegments.push(segment); textLength += chars.length;
        chars = []; offsets = [];
      };
      for (let i = 0; i < text.length; i++) {
        if (!IGNORED_TEXT_CHAR.test(text[i])) {
          let char = text[i];
          if (char >= '۰' && char <= '۹') char = String.fromCharCode(char.charCodeAt(0) - 1776 + 48);
          else if (char >= '٠' && char <= '٩') char = String.fromCharCode(char.charCodeAt(0) - 1632 + 48);
          const folded = (char === 'ي' || char === 'ى' ? 'ی' : char === 'ك' ? 'ک' : char).toLowerCase();
          for (let j = 0; j < folded.length; j++) { offsets.push(i); chars.push(folded[j]); }
        }
        if ((i & 2047) === 2047) { flush(); yield; }
      }
      flush();
      if (localSegments.length) { nodes.push(node); nodeSegments.set(node, localSegments); }
      yield;
      node = root.nodeType === Node.TEXT_NODE ? null : walker.nextNode();
    }
    return { fullText: textParts.join(''), segments, nodes, nodeSegments };
  }

  // Small local anchors are synchronous; large selections are enriched later.
  function buildNormalizedTextIndex(root) {
    const steps = normalizedTextIndexSteps(root), started = performance.now();
    let step;
    do { step = steps.next(); if (!step.done && performance.now() - started >= WORK_SLICE_MS) return null; } while (!step.done);
    return step.value;
  }

  async function buildNormalizedTextIndexAsync(root, job) {
    assertCurrentWork(job);
    if (job.indexes.has(root)) return job.indexes.get(root);
    job.roots?.add(root);
    const steps = normalizedTextIndexSteps(root);
    let step;
    do {
      step = steps.next();
      if (!step.done && performance.now() - job.sliceStart >= WORK_SLICE_MS) {
        await yieldHighlightWork(job); job.sliceStart = performance.now();
      }
    } while (!step.done);
    assertCurrentWork(job);
    if (hasCSSHighlights()) job.indexes.set(root, step.value);
    return step.value;
  }

  function normalizedOffsetInIndex(index, root, container, offset) {
    const local = index.nodeSegments.get(container);
    if (!local) return getNormalizedOffsetWithin(root, container, offset);
    let low = 0, high = local.length;
    while (low < high) {
      const mid = (low + high) >>> 1, segment = local[mid];
      if (segment.offsets[segment.offsets.length - 1] < offset) low = mid + 1;
      else high = mid;
    }
    if (low === local.length) return local[local.length - 1].end;
    const segment = local[low];
    low = 0; high = segment.offsets.length;
    while (low < high) { const mid = (low + high) >>> 1; if (segment.offsets[mid] < offset) low = mid + 1; else high = mid; }
    return segment.start + low;
  }

  function createRangeFromTextIndex(index, start, length) {
    if (!index || start < 0 || length < 1) return null;
    const findSegment = position => {
      let low = 0;
      let high = index.segments.length - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const segment = index.segments[mid];
        if (position < segment.start) high = mid - 1;
        else if (position >= segment.end) low = mid + 1;
        else return mid;
      }
      return -1;
    };
    const startSegmentIndex = findSegment(start);
    const endSegmentIndex = findSegment(start + length - 1);
    if (startSegmentIndex < 0 || endSegmentIndex < 0) return null;
    const first = index.segments[startSegmentIndex];
    const last = index.segments[endSegmentIndex];
    const range = document.createRange();
    range.setStart(first.node, first.offsets[start - first.start]);
    range.setEnd(last.node, last.offsets[start + length - 1 - last.start] + 1);
    range._involvedNodes = [...new Set(index.segments.slice(startSegmentIndex, endSegmentIndex + 1).map(segment => segment.node))];
    return range;
  }

  function getNormalizedOffsetWithin(root, container, offset) {
    if (!root || !container || (root !== container && !root.contains?.(container))) return -1;
    try {
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(root);
      prefixRange.setEnd(container, offset);
      return normalizeHighlightText(prefixRange.toString()).length;
    } catch (_) {
      return -1;
    }
  }

  function chooseTextAnchorRoot(range) {
    let root = range.commonAncestorContainer;
    if (root.nodeType !== Node.ELEMENT_NODE) root = root.parentElement;
    while (root && root !== document.body && !ANCHOR_BLOCK_TAGS.has(root.tagName)) {
      root = root.parentElement;
    }
    // Single-word blocks need surrounding context from their containing block.
    const exact = normalizeHighlightText(range.toString());
    while (root?.parentElement && root !== document.body &&
        root.textContent.length <= exact.length + 256 &&
        normalizeHighlightText(root.textContent).length <= exact.length + 16) {
      root = root.parentElement;
    }
    return root || document.body || document.documentElement;
  }

  function countOccurrencesBefore(text, target, beforeIndex) {
    let count = 0;
    let from = 0;
    while (from < beforeIndex) {
      const found = text.indexOf(target, from);
      if (found < 0 || found >= beforeIndex) break;
      count++;
      from = found + Math.max(1, target.length);
    }
    return count;
  }

  function textAnchorFromIndex(range, selectedText, root, index) {
    if (!index) return null;
    const exact = normalizeHighlightText(selectedText || range.toString()), rootPath = getXPath(root);
    const start = normalizedOffsetInIndex(index, root, range.startContainer, range.startOffset);
    const end = normalizedOffsetInIndex(index, root, range.endContainer, range.endOffset);
    if (!exact || !rootPath || start < 0 || end <= start || index.fullText.slice(start, end) !== exact) return null;
    return { version: 2,
      contentScope: range.startContainer.parentElement?.closest('message-content, user-query')?.tagName.toLowerCase() || null,
      rootPath, start, end,
      prefix: index.fullText.slice(Math.max(0, start - TEXT_ANCHOR_CONTEXT_LENGTH), start),
      suffix: index.fullText.slice(end, end + TEXT_ANCHOR_CONTEXT_LENGTH),
      occurrence: countOccurrencesBefore(index.fullText, exact, start) };
  }
  function createTextAnchor(range, selectedText) {
    const root = chooseTextAnchorRoot(range);
    return textAnchorFromIndex(range, selectedText, root, buildNormalizedTextIndex(root));
  }
  async function createTextAnchorAsync(range, selectedText, job) {
    const root = chooseTextAnchorRoot(range), index = await buildNormalizedTextIndexAsync(root, job);
    assertCurrentWork(job);
    return textAnchorFromIndex(range, selectedText, root, index);
  }

  function commonPrefixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[i] === b[i]) i++;
    return i;
  }

  function commonSuffixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  function scoreTextAnchor(index, matchStart, targetLength, anchor) {
    if (!anchor) return 0;
    const before = index.fullText.slice(Math.max(0, matchStart - TEXT_ANCHOR_CONTEXT_LENGTH), matchStart);
    const after = index.fullText.slice(
      matchStart + targetLength,
      matchStart + targetLength + TEXT_ANCHOR_CONTEXT_LENGTH
    );
    return commonSuffixLength(normalizeHighlightText(anchor.prefix || ''), before) + commonPrefixLength(normalizeHighlightText(anchor.suffix || ''), after);
  }

  async function rangeMatchesStoredAnchor(range, highlight, job) {
    const scope = getHighlightContentScope(highlight);
    if (scope && !range.startContainer.parentElement?.closest(scope)) return false;
    const anchor = highlight?.textAnchor;
    if (!anchor?.rootPath) return true;
    const root = getElementByXPath(anchor.rootPath);
    if (!root || (root !== range.startContainer && !root.contains(range.startContainer))) return false;
    const index = await buildNormalizedTextIndexAsync(root, job);
    const start = normalizedOffsetInIndex(index, root, range.startContainer, range.startOffset);
    const end = normalizedOffsetInIndex(index, root, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return false;
    const availableContext = Math.min(TEXT_ANCHOR_CONTEXT_LENGTH, (anchor.prefix || '').length) +
      Math.min(TEXT_ANCHOR_CONTEXT_LENGTH, (anchor.suffix || '').length);
    const score = scoreTextAnchor(index, start, end - start, anchor);
    return availableContext > 0
      ? score >= Math.min(16, availableContext)
      : start === anchor.start && end === anchor.end;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FALLBACK TEXT SEARCH STRATEGY
  // ═══════════════════════════════════════════════════════════════════════════
  function getHighlightContentScope(highlight) {
    const scope = highlight?.textAnchor?.contentScope;
    if (scope === 'message-content' || scope === 'user-query') return scope;
    // Old Gemini records still identify the author through their saved path.
    // Never restore an answer highlight into the duplicated user prompt while
    // the answer is absent during hydration (and then persist that wrong path).
    const paths = `${highlight?.startPath || ''} ${highlight?.textAnchor?.rootPath || ''}`;
    if (/\/message-content\[/.test(paths)) return 'message-content';
    if (/\/user-query\[/.test(paths) || paths.includes('user-query-content-')) return 'user-query';
    return null;
  }

  async function findTextRange(highlight, job) {
    const target = normalizeHighlightText(highlight?.text);
    if (!target) return null;
    const anchor = highlight.textAnchor, contentScope = getHighlightContentScope(highlight);
    const tryIndex = async (index, preferredStart = null, refuseAmbiguous = false) => {
      if (!index?.fullText || !index.segments.length) return null;
      let best = null, bestContextCount = 0, count = 0, from = 0;
      while (from <= index.fullText.length - target.length) {
        const start = index.fullText.indexOf(target, from);
        if (start < 0) break;
        const contextScore = scoreTextAnchor(index, start, target.length, anchor);
        const positionDistance = Number.isFinite(preferredStart) ? Math.abs(start - preferredStart) : Number.MAX_SAFE_INTEGER;
        const ordinalDistance = Number.isFinite(anchor?.occurrence) ? Math.abs(count - anchor.occurrence) : Number.MAX_SAFE_INTEGER;
        if (!best || contextScore > best.contextScore) bestContextCount = 1;
        else if (contextScore === best.contextScore) bestContextCount++;
        if (!best || contextScore > best.contextScore ||
            (contextScore === best.contextScore && positionDistance < best.positionDistance) ||
            (contextScore === best.contextScore && positionDistance === best.positionDistance && ordinalDistance < best.ordinalDistance)) best = { start, contextScore, positionDistance, ordinalDistance };
        count++; from = start + Math.max(1, target.length);
        if (!anchor && refuseAmbiguous && count > 1) return null;
        if ((count & 127) === 0 && performance.now() - job.sliceStart >= WORK_SLICE_MS) {
          await yieldHighlightWork(job); job.sliceStart = performance.now();
        }
      }
      if (!best) return null;
      const context = (anchor?.prefix || '').length + (anchor?.suffix || '').length;
      if (context && best.contextScore < Math.min(16, context)) return null;
      if (refuseAmbiguous && count > 1 && (!context || bestContextCount > 1)) return null;
      const range = createRangeFromTextIndex(index, best.start, target.length);
      if (contentScope && (!range?.startContainer.parentElement?.closest(contentScope) ||
          range.startContainer.parentElement.closest(contentScope) !== range.endContainer.parentElement?.closest(contentScope))) return null;
      if (!range || normalizeHighlightText(range.toString()) !== target || !isPageSelection(range)) return null;
      return range;
    };
    const tried = new Set();
    const tryRoot = async (root, preferredStart, ambiguous = false) => {
      if (!root || tried.has(root)) return null;
      tried.add(root);
      return tryIndex(await buildNormalizedTextIndexAsync(root, job), preferredStart, ambiguous);
    };
    if (anchor?.rootPath) { const range = await tryRoot(getElementByXPath(anchor.rootPath), anchor.start); if (range) return range; }
    if (highlight.startPath) {
      const preferred = Number.isFinite(anchor?.start) ? anchor.start : highlight.startOffset;
      const range = await tryRoot(getElementByXPath(highlight.startPath), preferred); if (range) return range;
    }
    if (contentScope) {
      let candidate = null;
      for (const root of document.querySelectorAll(contentScope)) {
        const range = await tryRoot(root, null, true);
        if (!range) continue;
        if (candidate) return null;
        candidate = range;
      }
      return candidate;
    }
    return tryRoot(document.body, null, true);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // RESTORATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  let restoreTimeout = null;
  function entryIsAttached(entry) {
    if (!entry || dirtyHighlightIds.has(entry.hlData.id)) return false;
    const range = highlightRegistryData[getColorClass(entry.hlData.color)]?.get(entry.hlData.id);
    if (range) return !range.collapsed && range.startContainer.isConnected && range.endContainer.isConnected;
    return !!entry.marks?.length && entry.marks.every(mark => !mark._isCSSHighlight && mark.isConnected);
  }
  function countAttachedPageHighlights() {
    let count = 0;
    for (const entry of activeHighlights) if (belongsToCurrentPage(entry.hlData) && entryIsAttached(entry)) count++;
    return count;
  }
  // Reuse the existing page observer; mark only highlights covering changed text.
  RtlFixer.notifyHighlightMutations = function (mutations) {
    if (!highlightInitialized) return;
    checkSpaUrlChange();
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' || isRastinElement(mutation.target)) continue;
      if (restoreJob?.roots) {
        for (const root of restoreJob.roots) {
          if (root === mutation.target || root.contains?.(mutation.target) ||
              [...(mutation.removedNodes || [])].some(node => node === root || node.contains?.(root))) {
            restoreJob.invalidated = true; break;
          }
        }
      }
      const ids = mutation.type === 'characterData' ? textNodeHighlightIds.get(mutation.target) : highlightAncestorIds.get(mutation.target);
      for (const id of ids || []) dirtyHighlightIds.add(id);
    }
  };
  RtlFixer.requestRestore = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled || config.globalEnabled === false) return;
    if (knownPageHighlightCount !== null && countAttachedPageHighlights() >= knownPageHighlightCount) return;
    // An unchanged document cannot make missing text reappear.
    if (lastRestoreStamp === restoreStamp()) return;
    if (isRestoring) { restorePending = true; return; }
    if (restoreTimeout) return;
    restoreTimeout = setTimeout(() => { restoreTimeout = null; RtlFixer.loadAndRestoreHighlights(false); }, Math.max(180, restoreBackoff));
  };
  function readHighlightsForRestore() {
    const key = getStorageKey(), legacyKey = 'rtl_fixer_hl_www.' + getNormalizedHost();
    return new Promise((resolve, reject) => storage.get([key, legacyKey], result => {
      const records = result[key], legacy = result[legacyKey];
      if ((records !== undefined && !Array.isArray(records)) || (legacy !== undefined && !Array.isArray(legacy))) { reject(new Error('Invalid highlight data; original preserved')); return; }
      if (legacy !== undefined || (records || []).some(record => !record?.id)) storage.mutate(key, { type: 'migrate' }, resolve, reject);
      else resolve(records || []);
    }, reject));
  }
  RtlFixer.loadAndRestoreHighlights = async function (forceClear = true) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled || config.globalEnabled === false) { RtlFixer.removeHighlight(); return; }
    if (document.readyState === 'loading' || !document.body) {
      if (!domReadyRestore) {
        domReadyRestore = () => { domReadyRestore = null; RtlFixer.loadAndRestoreHighlights(forceClear); };
        document.addEventListener('DOMContentLoaded', domReadyRestore, { once: true });
      }
      return;
    }
    if (isRestoring) { restorePending = true; return; }
    if (forceClear) detachRenderedHighlights();
    const job = { epoch: lifecycleEpoch, pageKey: getPageKey(window.location.href), indexes: new WeakMap(), roots: new Set(), trackRoots: true,
      mutationVersion: RtlFixer._domMutationVersion || 0, sliceStart: performance.now() };
    restoreJob = job; isRestoring = true; restorePending = false;
    try {
      const highlights = await readHighlightsForRestore();
      if (!workIsCurrent(job)) return;
      job.mutationVersion = RtlFixer._domMutationVersion || 0; job.sliceStart = performance.now();
      const pageHighlights = highlights.filter(hl => hl && typeof hl.id === 'string' && typeof hl.text === 'string' && belongsToCurrentPage(hl));
      knownPageHighlightCount = pageHighlights.length;
      const repairs = new Map();
      for (const hl of pageHighlights) {
        try {
        assertCurrentWork(job);
        if (performance.now() - job.sliceStart >= WORK_SLICE_MS) { await yieldHighlightWork(job); job.sliceStart = performance.now(); }
        const existing = getActiveEntry(hl.id);
        if (entryIsAttached(existing)) continue;
        if (existing) unwrapHighlight(hl.id);
        const identity = getHighlightIdentity(hl);
        let range = null, repaired = false;
        const startParent = getElementByXPath(hl.startPath), endParent = getElementByXPath(hl.endPath);
        const startNode = startParent?.childNodes[hl.startNodeIndex], endNode = endParent?.childNodes[hl.endNodeIndex];
        if (startNode?.nodeType === Node.TEXT_NODE && endNode?.nodeType === Node.TEXT_NODE &&
            Number.isInteger(hl.startOffset) && Number.isInteger(hl.endOffset) && hl.startOffset >= 0 && hl.endOffset >= 0) {
          const direct = document.createRange();
          direct.setStart(startNode, Math.min(hl.startOffset, startNode.length)); direct.setEnd(endNode, Math.min(hl.endOffset, endNode.length));
          if (!direct.collapsed && isPageSelection(direct) && normalizeHighlightText(direct.toString()) === normalizeHighlightText(hl.text) &&
              await rangeMatchesStoredAnchor(direct, hl, job)) range = direct;
        }
        if (!range) { range = await findTextRange(hl, job); repaired = !!range; }
        assertCurrentWork(job);
        if (!range) continue;
        const anchor = repaired || !hl.textAnchor ? await createTextAnchorAsync(range, hl.text, job) : hl.textAnchor;
        assertCurrentWork(job);
        const marks = wrapRangeWithMark(range, hl.color, hl.id);
        if (!marks.length) continue;
        addActiveEntry({ hlData: hl, marks, savedRange: range }); dirtyHighlightIds.delete(hl.id);
        if (repaired || !hl.textAnchor) {
          const fields = { id: hl.id, pageKey: job.pageKey,
            startPath: getXPath(range.startContainer.parentElement), startNodeIndex: getNodeIndex(range.startContainer), startOffset: range.startOffset,
            endPath: getXPath(range.endContainer.parentElement), endNodeIndex: getNodeIndex(range.endContainer), endOffset: range.endOffset,
            ...(anchor ? { textAnchor: anchor } : {}) };
          if (!marks[0]._isCSSHighlight) for (const field of ['startPath','startNodeIndex','startOffset','endPath','endNodeIndex','endOffset']) delete fields[field];
          Object.assign(hl, fields); repairs.set(identity, fields);
        }
        } catch (error) {
          if (!workIsCurrent(job) || String(error.message).startsWith('Highlight ')) throw error;
          console.warn('[Rastin RTL] Skipped invalid highlight:', hl.id, error.message);
        }
      }
      assertCurrentWork(job);
      if (repairs.size) storage.mutate(getStorageKey(), { type: 'repair', repairs: [...repairs] });
      lastRestoreStamp = restoreStamp(); restoreBackoff = 0;
    } catch (error) {
      if (job.invalidated && workIsCurrent(job)) restoreBackoff = Math.min(1200, Math.max(180, restoreBackoff * 1.6));
      if (workIsCurrent(job) && !String(error.message).startsWith('Highlight ')) reportStorageFailure(error.message);
    } finally {
      if (restoreJob === job) {
        isRestoring = false; restoreJob = null; job.indexes = new WeakMap(); job.roots.clear();
        refreshHighlightManagementUi(); consumePendingHighlight();
        const pending = restorePending; restorePending = false;
        if (pending) RtlFixer.requestRestore();
      }
    }
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
  let pendingNavigation = null;
  let pendingNavigationRead = false;
  function consumePendingHighlight() {
    if (!highlightInitialized) return;
    const pageKey = getPageKey(window.location.href), epoch = lifecycleEpoch;
    let localPending = null;
    try { localPending = sessionStorage.getItem(PENDING_HIGHLIGHT_KEY); } catch (_) {}
    if (localPending && RtlFixer.scrollToHighlightById(localPending)) {
      try { sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY); } catch (_) {}
    }
    if (pendingNavigation && pendingNavigation.pageKey !== pageKey) pendingNavigation = null;
    const tryPending = () => {
      const pending = pendingNavigation;
      if (!pending || epoch !== lifecycleEpoch || pending.pageKey !== getPageKey(window.location.href)) return;
      if (!RtlFixer.scrollToHighlightById(pending.id)) return;
      pendingNavigation = null;
      chrome.runtime.sendMessage({ action: 'consumePendingHighlightNavigation', pageKey,
        acknowledgeId: pending.id, requestId: pending.requestId }, response => {
          if (!chrome.runtime.lastError && epoch === lifecycleEpoch && response?.acknowledged === false) consumePendingHighlight();
        });
    };
    if (pendingNavigation) { tryPending(); return; }
    if (pendingNavigationRead) return;
    pendingNavigationRead = true;
    try {
      chrome.runtime.sendMessage({ action: 'consumePendingHighlightNavigation', pageKey }, response => {
        pendingNavigationRead = false;
        if (chrome.runtime.lastError || epoch !== lifecycleEpoch || !highlightInitialized) return;
        pendingNavigation = response?.ok ? response.pending : null;
        tryPending();
      });
    } catch (_) { pendingNavigationRead = false; }
  }

  function findHighlightElement(hl) {
    if (!belongsToCurrentPage(hl)) {
      return null;
    }

    const activeEntry = getActiveEntry(hl.id);
    if (!entryIsAttached(activeEntry)) return null;
    if (hl.color && hl.id) {
      const colorClass = getColorClass(hl.color);
      if (hasCSSHighlights() && highlightRegistryData[colorClass]?.has(hl.id)) {
        const range = highlightRegistryData[colorClass].get(hl.id);
        if (range && range.startContainer) {
          return range.startContainer.parentElement || range.startContainer;
        }
      }
    }

    if (activeEntry) {
      if (activeEntry.marks && activeEntry.marks.length > 0) {
        const firstMark = activeEntry.marks.find(m => m && m.isConnected && !m._isCSSHighlight);
        if (firstMark) return firstMark;
      }
      if (activeEntry.savedRange && activeEntry.savedRange.startContainer) {
        return activeEntry.savedRange.startContainer.parentElement || activeEntry.savedRange.startContainer;
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
    if (hasCSSHighlights() && typeof CSS.highlights.highlightsFromPoint === 'function') {
      try {
        const hits = CSS.highlights.highlightsFromPoint(clientX, clientY);
        for (const hit of hits) {
          for (const range of hit.ranges) {
            const entry = getActiveEntry(rangeHighlightIds.get(range));
            if (entryIsAttached(entry)) return entry;
            // Browser hit-testing can return a fresh JS wrapper for the same
            // underlying range. Match indexed candidates by exact boundaries.
            const ids = textNodeHighlightIds.get(range.startContainer) || highlightAncestorIds.get(range.startContainer);
            for (const id of ids || []) {
              const candidate = getActiveEntry(id), saved = candidate?.savedRange;
              if (entryIsAttached(candidate) && saved?.startContainer === range.startContainer && saved.startOffset === range.startOffset &&
                  saved.endContainer === range.endContainer && saved.endOffset === range.endOffset) return candidate;
            }
          }
        }
        // Unknown browser wrappers still use the bounded caret fallback.
      } catch (_) { /* Older implementations use the indexed caret fallback. */ }
    }
    let pointNode = null, pointOffset = 0;
    try {
      if (typeof document.caretPositionFromPoint === 'function') {
        const point = document.caretPositionFromPoint(clientX, clientY);
        pointNode = point?.offsetNode || null; pointOffset = point?.offset || 0;
      } else if (typeof document.caretRangeFromPoint === 'function') {
        const point = document.caretRangeFromPoint(clientX, clientY);
        pointNode = point?.startContainer || null; pointOffset = point?.startOffset || 0;
      }
    } catch (_) {}

    if (pointNode?.nodeType === Node.ELEMENT_NODE) {
      pointNode = pointNode.childNodes?.[0] || null;
    }

    const candidateIds = pointNode?.nodeType === Node.TEXT_NODE
      ? textNodeHighlightIds.get(pointNode)
      : null;
    if (!candidateIds || candidateIds.size === 0) return null;

    // Usually this checks exactly one range. The previous implementation read
    // every highlight's client rects on every mousemove, forcing repeated layout.
    for (const id of candidateIds) {
      const entry = getActiveEntry(id);
      if (!entryIsAttached(entry)) continue;
      const range = entry.savedRange || getHighlightRange(id);
      if (range?.startContainer === pointNode && pointOffset < range.startOffset ||
          range?.endContainer === pointNode && pointOffset > range.endOffset) continue;
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

      const targetEl = getHighlightRange(hlId) || findHighlightElement(clickedHlEntry.hlData) || targetElement;
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

  function isRastinElement(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return !!element?.closest?.(RASTIN_UI_SELECTOR);
  }
  function isPageSelection(range) {
    if (RtlFixer.isReaderPage?.() && !RtlFixer.getReaderDocumentUrl()) return false;
    if (!range || range.collapsed || !range.startContainer.isConnected || !range.endContainer.isConnected) return false;
    const excluded = node => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return !element || element.isContentEditable || !!element.closest('input,textarea,select,script,style,' + RASTIN_UI_SELECTOR);
    };
    if (excluded(range.startContainer) || excluded(range.endContainer)) return false;
    const root = range.commonAncestorContainer;
    for (const element of root.querySelectorAll?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),' + RASTIN_UI_SELECTOR) || []) {
      if (range.intersectsNode(element)) return false;
    }
    return true;
  }
  function handleMouseUp(event) {
    try {
      if (isRastinUiEvent(event) || isDraggingBar || justFinishedDrag) return;
      const target = getEventElement(event);
      if (target?.isContentEditable || target?.closest?.('input,textarea,select')) { hideHighlightBar(); return; }

      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';

      if (selectedText.length > 0 && selection.rangeCount && isPageSelection(selection.getRangeAt(0))) {
        activeRange = selection.getRangeAt(0).cloneRange();
        currentSelectionText = selectedText;
        activeHighlightId = null;


        positionHighlightBar(activeRange);
      }
    } catch (e) {
      if (RtlFixer.DEBUG) console.warn('[Rastin RTL] handleMouseUp error:', e);
    }
  }

  let latestMouseEvent = null;
  function handleMouseMove(event) {
    latestMouseEvent = event;
    if (mouseMoveRafId || !activeHighlights.length) return;
    mouseMoveRafId = requestAnimationFrame(() => {
      mouseMoveRafId = null;
      const current = latestMouseEvent;
      if (!highlightInitialized || !current || isRastinUiEvent(current) || activeRange || !activeHighlights.length) {
        setHoverHighlight(null); updateHoverCursor(false); return;
      }
      const entry = findHighlightAtPoint(current.clientX, current.clientY);
      setHoverHighlight(entry ? getHighlightRange(entry.hlData.id) : null); updateHoverCursor(!!entry);
    });
  }
  function handleSelectionKeyUp(event) {
    if (event.shiftKey || event.key === 'Shift' || (event.ctrlKey || event.metaKey) && event.code === 'KeyA') handleMouseUp(event);
  }

  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (activeRange) positionHighlightBar(activeRange);
      updateHighlighterRadar();
    }, 150);
  }

  function handleKeyDown(event) {
    const target = getEventElement(event);
    if (!target?.isContentEditable && !target?.closest?.('input,textarea') && !document.getElementById('rtl-fixer-paint-host') &&
        (event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.key.toLowerCase() === 'z') && lastDeletedHighlight && hubDrawer?.classList.contains('open')) {
      event.preventDefault(); undoHighlightDelete(); return;
    }
    if (event.key === 'Escape') { hubDrawer?.classList.remove('open');
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
    const range = getHighlightRange(id);
    if (!range) { RtlFixer.requestRestore(); return false; }
    const rect = range.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - window.innerHeight / 2), behavior: 'smooth' });
    setHoverHighlight(range);
    const epoch = lifecycleEpoch;
    setTimeout(() => { if (epoch === lifecycleEpoch && hoveredRange === range) setHoverHighlight(null); }, 1800);
    return true;
  };

  RtlFixer.openHighlightHub = toggleHighlightHub;
  RtlFixer.initHighlight = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.enabled || !config.highlightEnabled) {
      RtlFixer.removeHighlight();
      return;
    }
    if (highlightInitialized) return;
    highlightInitialized = true;

    startSpaWatch();

    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleSelectionKeyUp, true);
    window.addEventListener('resize', handleResize);

    RtlFixer.loadAndRestoreHighlights();

    if (_forcedReloadTimer) clearTimeout(_forcedReloadTimer);
    _forcedReloadTimer = setTimeout(() => {
      _forcedReloadTimer = null;
      const cfg = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
      if (cfg.enabled && cfg.highlightEnabled) {
        RtlFixer.requestRestore();
      }
    }, 1500);
  };

  RtlFixer.removeHighlight = function () {
    highlightInitialized = false;
    stopSpaWatch();
    knownPageHighlightCount = null;
    clearTimeout(resizeTimeout); resizeTimeout = null;
    clearTimeout(refreshUiTimeout); refreshUiTimeout = null;
    clearTimeout(storageSyncTimer); storageSyncTimer = null;
    if (mouseMoveRafId) cancelAnimationFrame(mouseMoveRafId);
    mouseMoveRafId = null; latestMouseEvent = null; radarRenderVersion++;

    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleSelectionKeyUp, true);
    window.removeEventListener('resize', handleResize);

    if (_forcedReloadTimer) {
      clearTimeout(_forcedReloadTimer);
      _forcedReloadTimer = null;
    }

    detachRenderedHighlights();
    clearTimeout(refreshUiTimeout); refreshUiTimeout = null;
    highlightBar?.remove(); highlightBar = null;
    isDraggingBar = false; justFinishedDrag = false;

    if (radarContainer && radarContainer.parentNode) {
      radarContainer.parentNode.removeChild(radarContainer);
      radarContainer = null;
    }

    clearTimeout(hubSearchTimeout); hubRenderVersion++; hubItems = [];
    if (hubDrawer && hubDrawer.parentNode) {
      hubDrawer.parentNode.removeChild(hubDrawer);
      hubDrawer = null;
    }
  };

  if (window.RtlFixer && window.RtlFixer.DEBUG) console.log('[Rastin RTL Highlight] highlight-manager.js initialized successfully.');
})(window.RtlFixer);
