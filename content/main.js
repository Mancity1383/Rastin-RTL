// RTL Beautifier & Fixer - Orchestrator (Main Entry Point)
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  RtlFixer.observer = null;
  RtlFixer.styleElement = null;
  RtlFixer.fontImportElement = null;
  RtlFixer.config = { ...RtlFixer.DEFAULT_CONFIG };

  // Master flag: when false, ALL DOM processing is blocked.
  RtlFixer._isActive = false;

  let batchedNodes = [];
  let rafId = null;

  function cleanBatch(nodes) {
    const connected = nodes.filter(n => n && n.isConnected && !RtlFixer.isExtensionNode(n));
    if (connected.length <= 1) return connected;

    // Sort nodes in document order
    connected.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const result = [connected[0]];
    let lastKept = connected[0];
    for (let i = 1; i < connected.length; i++) {
      const node = connected[i];
      if (lastKept.contains(node)) {
        continue;
      }
      result.push(node);
      lastKept = node;
    }
    return result;
  }

  // Handle dynamic typing in inputs, textareas, and contenteditable elements
  RtlFixer.handleInputEvent = function (event) {
    if (!RtlFixer._isActive) return;
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (!target) return;

    let inputEl = target;
    if (target.closest) {
      const closestInput = target.closest('input, textarea, [contenteditable]');
      if (closestInput) {
        inputEl = closestInput;
      }
    }

    if (
      inputEl.tagName === 'INPUT' ||
      inputEl.tagName === 'TEXTAREA' ||
      inputEl.hasAttribute('contenteditable') ||
      inputEl.contentEditable === 'true' ||
      (inputEl.getAttribute && inputEl.getAttribute('contenteditable') === 'plaintext-only')
    ) {
      RtlFixer.processInputDirection(inputEl);
    }
  };

  // MutationObserver to capture dynamically loaded content
  RtlFixer.startObserver = function () {
    if (RtlFixer.observer) return;

    if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Starting observer');
    document.addEventListener('input', RtlFixer.handleInputEvent, true);
    document.addEventListener('focusin', RtlFixer.handleInputEvent, true);

    RtlFixer.observer = new MutationObserver((mutations) => {
      if (!RtlFixer._isActive) return;

      if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Mutation detected! Count:', mutations.length);
      // Mutations caused solely by our own UI must not schedule a restore —
      // the restore repaints that UI, which would re-enter this callback.
      let sawPageMutation = false;
      for (const mutation of mutations) {
        if (RtlFixer.isExtensionNode(mutation.target)) continue;

        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (RtlFixer.isExtensionNode(node)) continue;
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Node added:', node.tagName, 'id:', node.id);
              sawPageMutation = true;
              batchedNodes.push(node);
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              const parent = node.parentElement;
              if (parent && parent !== document.body) {
                sawPageMutation = true;
                batchedNodes.push(parent);
              }
            }
          }
        } else if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent && parent.nodeType === Node.ELEMENT_NODE) {
            let targetEl = parent;
            while (targetEl && targetEl !== document.body) {
              if (targetEl.classList.contains('rtl-fixer-target')) {
                break;
              }
              targetEl = targetEl.parentElement;
            }
            sawPageMutation = true;
            batchedNodes.push(targetEl && targetEl !== document.body ? targetEl : parent);
          }
        }
      }
      if (typeof RtlFixer.pruneDisconnectedState === 'function') {
        RtlFixer.pruneDisconnectedState();
      }
      if (sawPageMutation && batchedNodes.length && !rafId) {
        rafId = requestAnimationFrame(() => {
          if (!RtlFixer._isActive) {
            batchedNodes = [];
            rafId = null;
            return;
          }
          const nodesToScan = cleanBatch(batchedNodes);
          if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Scanning batched nodes:', nodesToScan.map(n => n.tagName));
          batchedNodes = [];
          rafId = null;

          nodesToScan.forEach(RtlFixer.scanAndProcess);
          if (typeof RtlFixer.requestRestore === 'function') {
            RtlFixer.requestRestore();
          }
        });
      }
    });
    RtlFixer.observer.observe(document.documentElement, { 
      childList: true, 
      subtree: true, 
      characterData: true 
    });
  };

  RtlFixer.stopObserver = function () {
    document.removeEventListener('input', RtlFixer.handleInputEvent, true);
    document.removeEventListener('focusin', RtlFixer.handleInputEvent, true);

    if (RtlFixer.observer) {
      RtlFixer.observer.disconnect();
      RtlFixer.observer = null;
    }
    if (RtlFixer._observedShadowRoots) {
      RtlFixer._observedShadowRoots = new WeakSet();
    }
    batchedNodes = [];
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  RtlFixer.init = function () {
    const cleanHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const hostKey = 'site_config_' + cleanHost;

    chrome.storage.local.get(null, (allStorage) => {
      if (chrome.runtime.lastError) {
        console.warn('[Rastin RTL] Storage error:', chrome.runtime.lastError);
        return;
      }

      // 1. Get global config
      const globalEnabled = allStorage.enabled !== false;
      const globalAdBlockEnabled = allStorage.adBlockEnabled !== false;
      const adBlockCosmetic = allStorage.adBlockCosmetic !== false;
      const adBlockGapRemover = allStorage.adBlockGapRemover !== false;
      const translatorApi = allStorage.translatorApi || 'openai';
      const apiKeys = allStorage.apiKeys || {};
      const disabledAdBlockDomains = allStorage.disabledAdBlockDomains || [];

      // 2. Get site-specific config
      const defaultSiteConfig = {
        enabled: false,
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
        allowCopyEnabled: false,
        translatorEnabled: false,
        highlightEnabled: false,
        adBlockEnabled: true
      };

      const siteConfig = { ...defaultSiteConfig, ...(allStorage[hostKey] || {}) };

      // 3. Merge them
      RtlFixer.config = {
        ...siteConfig,
        globalEnabled,
        globalAdBlockEnabled,
        adBlockCosmetic,
        adBlockGapRemover,
        translatorApi,
        apiKeys,
        disabledAdBlockDomains
      };

      const isCurrentlyActive = RtlFixer.config.globalEnabled && RtlFixer.config.enabled;
      const isAdBlockDisabledForSite = disabledAdBlockDomains.some(d => {
        const dom = d.toLowerCase().replace(/^www\./, '');
        return cleanHost === dom || cleanHost.endsWith('.' + dom);
      });
      const isAdBlockActive = RtlFixer.config.globalEnabled && 
                              RtlFixer.config.globalAdBlockEnabled && 
                              RtlFixer.config.adBlockEnabled && 
                              !isAdBlockDisabledForSite;

      try {
        localStorage.setItem('rastin_rtl_active', isCurrentlyActive ? 'true' : 'false');
        localStorage.setItem('rastin_adblock_active', isAdBlockActive ? 'true' : 'false');
      } catch (_) {}

      if (!isCurrentlyActive) {
        RtlFixer._isActive = false;
        RtlFixer.removeRtlFixes();
        return;
      }
      
      RtlFixer._isActive = true;
      RtlFixer.applyStyles();
      if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
      if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
      if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
      if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
      
      // CORRECT ORDER: processPage() FIRST -> startObserver() SECOND -> initHighlight() THIRD
      const runInitializationSequence = () => {
        RtlFixer.processPage();
        RtlFixer.startObserver();
        if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runInitializationSequence);
      } else {
        runInitializationSequence();
      }
    });
  };

  // Listen for message updates from the popup controls
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender && sender.id !== chrome.runtime.id) {
      if (sendResponse) sendResponse({ error: 'invalid_sender' });
      return;
    }
    if (message.action === 'clear_all_highlights') {
      if (typeof RtlFixer.clearCurrentPageHighlights === 'function') {
        RtlFixer.clearCurrentPageHighlights();
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    }
    if (message.action === 'scrollToHighlight' && (message.highlightId || message.id)) {
      const targetId = message.highlightId || message.id;
      if (typeof RtlFixer.scrollToHighlightById === 'function') {
        RtlFixer.scrollToHighlightById(targetId);
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    }
    if (message.action === 'updateSettings' && message.settings) {
      const oldConfig = { ...RtlFixer.config };
      RtlFixer.config = { ...RtlFixer.config, ...message.settings };
      
      const cleanHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
      const hostKey = 'site_config_' + cleanHost;

      // PERSIST site settings to chrome.storage.local so enabled & highlightEnabled persist on refresh!
      const updatedSiteConfig = {
        enabled: RtlFixer.config.enabled,
        alignmentMode: RtlFixer.config.alignmentMode,
        inputsAutoDir: RtlFixer.config.inputsAutoDir,
        forceRightAlign: RtlFixer.config.forceRightAlign,
        justifyText: RtlFixer.config.justifyText,
        fontFamily: RtlFixer.config.fontFamily,
        customFontName: RtlFixer.config.customFontName,
        customFontUrl: RtlFixer.config.customFontUrl,
        fontWeight: RtlFixer.config.fontWeight,
        fontSizeAdjust: RtlFixer.config.fontSizeAdjust,
        lineHeightAdjust: RtlFixer.config.lineHeightAdjust,
        persianDigits: RtlFixer.config.persianDigits,
        fixTables: RtlFixer.config.fixTables,
        fixListsBlockquotes: RtlFixer.config.fixListsBlockquotes,
        techCodeProtection: RtlFixer.config.techCodeProtection,
        readingRulerEnabled: RtlFixer.config.readingRulerEnabled,
        readingRulerFocus: RtlFixer.config.readingRulerFocus,
        focusCoachEnabled: RtlFixer.config.focusCoachEnabled,
        readingProgressEnabled: RtlFixer.config.readingProgressEnabled,
        bionicTextEnabled: RtlFixer.config.bionicTextEnabled,
        allowCopyEnabled: RtlFixer.config.allowCopyEnabled,
        translatorEnabled: RtlFixer.config.translatorEnabled,
        highlightEnabled: RtlFixer.config.highlightEnabled,
        adBlockEnabled: RtlFixer.config.adBlockEnabled
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [hostKey]: updatedSiteConfig });
      }

      const isCurrentlyActive = RtlFixer.config.globalEnabled && RtlFixer.config.enabled;
      
      const disabledDomains = RtlFixer.config.disabledAdBlockDomains || [];
      const isAdBlockDisabledForSite = disabledDomains.some(d => {
        const dom = d.toLowerCase().replace(/^www\./, '');
        return cleanHost === dom || cleanHost.endsWith('.' + dom);
      });
      const isAdBlockActive = RtlFixer.config.globalEnabled && 
                              RtlFixer.config.globalAdBlockEnabled && 
                              RtlFixer.config.adBlockEnabled && 
                              !isAdBlockDisabledForSite;

      try {
        localStorage.setItem('rastin_rtl_active', isCurrentlyActive ? 'true' : 'false');
        localStorage.setItem('rastin_adblock_active', isAdBlockActive ? 'true' : 'false');
      } catch (_) {}

      const oldActive = oldConfig.globalEnabled && oldConfig.enabled;
      const needsFullRebuild = 
        oldActive !== isCurrentlyActive ||
        oldConfig.alignmentMode !== RtlFixer.config.alignmentMode ||
        oldConfig.inputsAutoDir !== RtlFixer.config.inputsAutoDir ||
        oldConfig.forceRightAlign !== RtlFixer.config.forceRightAlign ||
        oldConfig.justifyText !== RtlFixer.config.justifyText ||
        oldConfig.persianDigits !== RtlFixer.config.persianDigits ||
        oldConfig.fixTables !== RtlFixer.config.fixTables ||
        oldConfig.fixListsBlockquotes !== RtlFixer.config.fixListsBlockquotes ||
        oldConfig.techCodeProtection !== RtlFixer.config.techCodeProtection ||
        oldConfig.readingRulerEnabled !== RtlFixer.config.readingRulerEnabled ||
        oldConfig.readingRulerFocus !== RtlFixer.config.readingRulerFocus ||
        oldConfig.bionicTextEnabled !== RtlFixer.config.bionicTextEnabled ||
        oldConfig.focusCoachEnabled !== RtlFixer.config.focusCoachEnabled ||
        oldConfig.readingProgressEnabled !== RtlFixer.config.readingProgressEnabled ||
        oldConfig.allowCopyEnabled !== RtlFixer.config.allowCopyEnabled ||
        oldConfig.translatorEnabled !== RtlFixer.config.translatorEnabled ||
        oldConfig.translatorApi !== RtlFixer.config.translatorApi ||
        oldConfig.highlightEnabled !== RtlFixer.config.highlightEnabled ||
        JSON.stringify(oldConfig.apiKeys) !== JSON.stringify(RtlFixer.config.apiKeys);

      if (!isCurrentlyActive) {
        RtlFixer._isActive = false;
        RtlFixer.removeRtlFixes();
      } else {
        RtlFixer._isActive = true;
        if (needsFullRebuild) {
          RtlFixer.removeRtlFixes();
          RtlFixer.applyStyles();
          if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
          if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
          if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
          if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
          
          // CORRECT ORDER ON REBUILD: processPage() -> startObserver() -> initHighlight()
          RtlFixer.processPage();
          RtlFixer.startObserver();
          if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
        } else {
          RtlFixer.applyStyles();
          if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
          if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
          if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
          if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
          if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
        }
      }
      sendResponse({ status: 'success' });
    }
  });

  const currentHostKey = 'site_config_' + window.location.hostname.toLowerCase().replace(/^www\./, '');
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const relevantKeys = [
      'enabled',
      'adBlockEnabled',
      'adBlockCosmetic',
      'disabledAdBlockDomains',
      currentHostKey
    ];
    if (relevantKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
      RtlFixer.init();
    }
  });

  // Run initialization
  RtlFixer.init();
})(window.RtlFixer);
