/**
 * Keeps the YouTube adapter synchronized with global and per-site settings.
 */
(function (global) {
  'use strict';

  if (global.YouTubeAdBootstrap || !global.YouTubeAdAdapter) return;

  const adapter = global.YouTubeAdAdapter;
  const MAIN_WORLD_STATE_ATTRIBUTE = 'data-rastin-youtube-adblock';
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const hostKey = 'site_config_' + host;
  let refreshGeneration = 0;

  function domainMatches(candidate) {
    const domain = String(candidate || '').toLowerCase().replace(/^www\./, '');
    return Boolean(domain) && (host === domain || host.endsWith('.' + domain));
  }

  function resolveSiteConfig(items) {
    if (items[hostKey]) return items[hostKey];
    if (host.endsWith('.youtube.com') && items['site_config_youtube.com']) {
      return items['site_config_youtube.com'];
    }
    return {};
  }

  function applyStorageState(items) {
    const siteConfig = resolveSiteConfig(items);
    const disabledDomains = Array.isArray(items.disabledAdBlockDomains)
      ? items.disabledAdBlockDomains
      : [];
    const shouldRun = items.enabled !== false &&
      items.globalEnabled !== false &&
      items.adBlockEnabled !== false &&
      items.globalAdBlockEnabled !== false &&
      siteConfig.enabled !== false &&
      siteConfig.adBlockEnabled !== false &&
      !disabledDomains.some(domainMatches);

    // DOM attributes are shared across MAIN and isolated worlds, making this
    // a reliable state bridge for the early MAIN-world response interceptor.
    try {
      document.documentElement?.setAttribute(
        MAIN_WORLD_STATE_ATTRIBUTE,
        shouldRun ? 'on' : 'off'
      );
    } catch {}

    if (shouldRun) adapter.start();
    else adapter.stop();
  }

  function refresh() {
    if (!global.chrome?.storage?.local) {
      adapter.start();
      return;
    }

    const generation = ++refreshGeneration;
    chrome.storage.local.get(null, (items) => {
      if (generation !== refreshGeneration || chrome.runtime?.lastError) return;
      applyStorageState(items || {});
    });
  }

  const storageListener = (_changes, areaName) => {
    if (areaName === 'local') refresh();
  };
  const messageListener = (message) => {
    if (message?.action === 'updateSettings') refresh();
  };

  if (global.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }
  if (global.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(messageListener);
  }

  global.addEventListener('pagehide', () => {
    adapter.stop();
    try { document.documentElement?.removeAttribute(MAIN_WORLD_STATE_ATTRIBUTE); } catch {}
    try { chrome.storage.onChanged.removeListener(storageListener); } catch {}
    try { chrome.runtime.onMessage.removeListener(messageListener); } catch {}
  }, { once: true });

  global.YouTubeAdBootstrap = { refresh, applyStorageState };
  refresh();
})(typeof window !== 'undefined' ? window : globalThis);
