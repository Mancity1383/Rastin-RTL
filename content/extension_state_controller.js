/**
 * ExtensionStateController - Central isolated world state manager.
 * Single source of truth for reading chrome.storage, calculating unified state,
 * managing isolated modules, and broadcasting state to MAIN world via handshake.
 */
(function (global) {
  'use strict';

  if (global.ExtensionStateController) return;

  const SENSITIVE_DOMAINS = [
    'youtube.com', 'youtube-nocookie.com', 'youtu.be', 'music.youtube.com',
    'aparat.com', 'telewebion.ir', 'telewebion.com',
    'netflix.com', 'spotify.com', 'twitch.tv', 'primevideo.com', 'disneyplus.com'
  ];

  class ExtensionStateController {
    constructor() {
      this.generation = 0;
      this.initialized = false;
      this.state = {
        globalEnabled: true,
        adBlockEnabled: true,
        adBlockCosmetic: true,
        adBlockGapRemover: true,
        rtlEnabled: true,
        translatorEnabled: true,
        highlightEnabled: true,
        copyUnlockerEnabled: true,
        readingRulerEnabled: false,
        focusCoachEnabled: false,
        isSensitiveSite: false,
        disabledAdBlockDomains: [],
        generation: 0
      };
      this.scope = new global.DisposableScope('StateController');
      this.modules = new Map(); // moduleName -> { start: fn, stop: fn, isRunning: bool }
    }

    isSensitiveSite(hostname = window.location.hostname) {
      const cleanHost = (hostname || '').toLowerCase().replace(/^www\./, '');
      return SENSITIVE_DOMAINS.some(d => cleanHost === d || cleanHost.endsWith('.' + d));
    }

    registerModule(name, { start, stop }) {
      this.modules.set(name, { start, stop, isRunning: false });
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;

      this.scope.addEventListener(window, 'rastin-main-ready', () => {
        this.broadcastStateToMainWorld();
      });

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(null, (items) => {
          this.updateStateFromStorage(items || {});
        });

        if (chrome.storage.onChanged) {
          this.scope.addEventListener(chrome.storage.onChanged, (changes, areaName) => {
            if (areaName === 'local') {
              chrome.storage.local.get(null, (items) => {
                this.updateStateFromStorage(items || {});
              });
            }
          });
        }
      } else {
        this.updateStateFromStorage({});
      }
    }

    updateStateFromStorage(items) {
      this.generation++;

      const cleanHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
      const disabledDomains = Array.isArray(items.disabledAdBlockDomains) ? items.disabledAdBlockDomains : [];
      const isSiteAdBlockDisabled = disabledDomains.some(d => {
        const dom = (d || '').toLowerCase().replace(/^www\./, '');
        return cleanHost === dom || cleanHost.endsWith('.' + dom);
      });

      const isSensitive = this.isSensitiveSite(cleanHost);
      const siteConfig = items['site_config_' + cleanHost] ||
        (cleanHost.endsWith('.youtube.com') ? items['site_config_youtube.com'] : null) || {};
      const globalEnabled = items.globalEnabled !== false &&
        items.enabled !== false &&
        siteConfig.enabled !== false;
      const adBlockActive = globalEnabled &&
        items.globalAdBlockEnabled !== false &&
        items.adBlockEnabled !== false &&
        siteConfig.adBlockEnabled !== false &&
        !isSiteAdBlockDisabled;

      this.state = {
        globalEnabled,
        adBlockEnabled: adBlockActive,
        adBlockCosmetic: adBlockActive && items.adBlockCosmetic !== false,
        adBlockGapRemover: adBlockActive && items.adBlockGapRemover !== false,
        rtlEnabled: globalEnabled && items.enabled !== false,
        translatorEnabled: globalEnabled && items.translatorEnabled !== false,
        highlightEnabled: globalEnabled && items.highlightEnabled !== false,
        copyUnlockerEnabled: globalEnabled && items.allowCopyEnabled !== false,
        readingRulerEnabled: globalEnabled && items.readingRulerEnabled === true,
        focusCoachEnabled: globalEnabled && items.focusCoachEnabled === true,
        isSensitiveSite: isSensitive,
        disabledAdBlockDomains: disabledDomains,
        generation: this.generation
      };

      try {
        localStorage.setItem('rastin_rtl_active', this.state.rtlEnabled ? 'true' : 'false');
        localStorage.setItem('rastin_adblock_active', this.state.adBlockEnabled ? 'true' : 'false');
      } catch (_) {}

      this.applyStateToModules();
      this.broadcastStateToMainWorld();
    }

    applyStateToModules() {
      for (const [name, module] of this.modules.entries()) {
        try {
          if (this.state.globalEnabled) {
            if (!module.isRunning && typeof module.start === 'function') {
              module.start(this.state);
              module.isRunning = true;
            } else if (module.isRunning && typeof module.start === 'function') {
              module.start(this.state); // Update config
            }
          } else {
            if (module.isRunning && typeof module.stop === 'function') {
              module.stop();
              module.isRunning = false;
            }
          }
        } catch (err) {
          console.warn(`[ExtensionStateController] Error managing module ${name}:`, err);
        }
      }
    }

    broadcastStateToMainWorld() {
      try {
        const detail = JSON.parse(JSON.stringify(this.state));
        window.dispatchEvent(new CustomEvent('rastin-extension-state', { detail }));
      } catch (_) {}
    }

    destroy() {
      this.initialized = false;
      for (const [name, module] of this.modules.entries()) {
        try {
          if (module.isRunning && typeof module.stop === 'function') {
            module.stop();
            module.isRunning = false;
          }
        } catch (_) {}
      }
      this.scope.dispose();
    }
  }

  global.ExtensionStateController = new ExtensionStateController();
})(typeof window !== 'undefined' ? window : globalThis);
