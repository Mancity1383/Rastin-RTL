/**
 * YouTubeAdInterceptor - primary YouTube ad-metadata filter (MAIN world).
 *
 * Network requests are allowed to complete normally. Only JSON returned by
 * YouTube player endpoints is pruned, preventing the player from constructing
 * an ad timeline while preserving the media/session request flow.
 */
(function (global) {
  'use strict';

  if (global.RastinYouTubeAdInterceptor) return;

  const host = global.location.hostname.toLowerCase();
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com') ||
    host === 'youtu.be';
  if (!isYouTube) return;

  const AD_KEYS = new Set([
    'adPlacements',
    'adSlots'
  ]);
  const SERIALIZED_PLAYER_KEYS = new Set([
    'player_response',
    'playerResponse',
    'raw_player_response',
    'rawPlayerResponse'
  ]);
  const MAX_VISITED_OBJECTS = 50000;
  const STATE_ATTRIBUTE = 'data-rastin-youtube-adblock';
  const stats = {
    fetchResponses: 0,
    xhrResponses: 0,
    jsonParses: 0,
    initialObjects: 0,
    initialConfigs: 0,
    removedProperties: 0,
    parseFailures: 0,
    stateChanges: 0,
    classicSkips: 0,
    serverSideSkips: 0
  };

  let currentGeneration = -1;
  let isActive = readInitialState();
  const nativeJsonParse = global.JSON?.parse;

  function readInitialState() {
    try {
      return global.localStorage.getItem('rastin_adblock_active') !== 'false';
    } catch {
      return true;
    }
  }

  function matchesPlayerUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl, global.location.href);
      const requestHost = url.hostname.toLowerCase();
      const isYouTubeRequest = requestHost === 'youtube.com' || requestHost.endsWith('.youtube.com') ||
        requestHost === 'youtube-nocookie.com' || requestHost.endsWith('.youtube-nocookie.com');
      if (!isYouTubeRequest) return false;
      return /\/youtubei\/v1\/(?:player|get_watch)$/.test(url.pathname) ||
        /\/(?:playlist|watch)$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function pruneAdMetadata(root) {
    if (!isActive || !root || typeof root !== 'object') return root;

    const stack = [root];
    const seen = new WeakSet();
    let visited = 0;

    while (stack.length && visited < MAX_VISITED_OBJECTS) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      visited++;

      for (const key of Object.keys(value)) {
        if (AD_KEYS.has(key)) {
          try {
            if (delete value[key]) stats.removedProperties++;
          } catch {}
          continue;
        }
        const child = value[key];
        if (SERIALIZED_PLAYER_KEYS.has(key) && typeof child === 'string') {
          const sanitized = sanitizeJsonText(child);
          if (sanitized !== child) {
            try {
              value[key] = sanitized;
              stats.initialConfigs++;
            } catch {}
          }
          continue;
        }
        if (child && typeof child === 'object') stack.push(child);
      }
    }

    return root;
  }

  function sanitizeJsonText(rawText) {
    if (!isActive || typeof rawText !== 'string' ||
        !/"(?:adPlacements|adSlots)"\s*:/.test(rawText)) {
      return rawText;
    }

    const prefixMatch = rawText.match(/^\s*\)\]\}'\s*\n?/);
    const prefix = prefixMatch ? prefixMatch[0] : '';
    const jsonText = prefix ? rawText.slice(prefix.length) : rawText;

    try {
      const parsed = Reflect.apply(nativeJsonParse, global.JSON, [jsonText]);
      pruneAdMetadata(parsed);
      return prefix + JSON.stringify(parsed);
    } catch {
      stats.parseFailures++;
      return rawText;
    }
  }

  // Player responses can be consumed from inline config through JSON.parse
  // without ever passing through fetch(). This is the same early-consumption
  // boundary targeted by trusted json-prune scriptlets in mature blockers.
  let patchedJsonParse = nativeJsonParse;
  if (typeof nativeJsonParse === 'function') {
    patchedJsonParse = function (text) {
      const parsed = Reflect.apply(nativeJsonParse, this, arguments);
      if (isActive && typeof text === 'string' &&
          /"(?:adPlacements|adSlots)"\s*:/.test(text)) {
        stats.jsonParses++;
        return pruneAdMetadata(parsed);
      }
      return parsed;
    };
    try { global.JSON.parse = patchedJsonParse; } catch {}
  }

  // Keep fetch() and every Response instance native. Wrapping a Response in a
  // Proxy breaks Web-IDL brand checks used by YouTube and is interpreted as an
  // offline/network failure. Filtering at the prototype consumption boundary
  // preserves response identity, headers, streams, cloning and instanceof.
  const responsePrototype = global.Response?.prototype;
  const nativeResponseJson = responsePrototype?.json;
  const nativeResponseText = responsePrototype?.text;
  let patchedResponseJson = nativeResponseJson;
  let patchedResponseText = nativeResponseText;

  if (typeof nativeResponseJson === 'function') {
    patchedResponseJson = function () {
      const result = Reflect.apply(nativeResponseJson, this, arguments);
      if (!isActive || !matchesPlayerUrl(this?.url)) return result;
      return Promise.resolve(result).then(data => {
        stats.fetchResponses++;
        return pruneAdMetadata(data);
      });
    };
    try { responsePrototype.json = patchedResponseJson; } catch {}
  }

  if (typeof nativeResponseText === 'function') {
    patchedResponseText = function () {
      const result = Reflect.apply(nativeResponseText, this, arguments);
      if (!isActive || !matchesPlayerUrl(this?.url)) return result;
      return Promise.resolve(result).then(text => {
        stats.fetchResponses++;
        return sanitizeJsonText(text);
      });
    };
    try { responsePrototype.text = patchedResponseText; } catch {}
  }

  const xhrPrototype = global.XMLHttpRequest?.prototype;
  const responseTextDescriptor = xhrPrototype
    ? Object.getOwnPropertyDescriptor(xhrPrototype, 'responseText')
    : null;
  const responseDescriptor = xhrPrototype
    ? Object.getOwnPropertyDescriptor(xhrPrototype, 'response')
    : null;

  if (responseTextDescriptor?.get) {
    try {
      Object.defineProperty(xhrPrototype, 'responseText', {
        ...responseTextDescriptor,
        get() {
          const text = responseTextDescriptor.get.call(this);
          if (!isActive || !matchesPlayerUrl(this.responseURL)) return text;
          stats.xhrResponses++;
          return sanitizeJsonText(text);
        }
      });
    } catch {}
  }

  if (responseDescriptor?.get) {
    try {
      Object.defineProperty(xhrPrototype, 'response', {
        ...responseDescriptor,
        get() {
          const value = responseDescriptor.get.call(this);
          if (!isActive || !matchesPlayerUrl(this.responseURL)) return value;
          stats.xhrResponses++;
          if (typeof value === 'string') return sanitizeJsonText(value);
          return pruneAdMetadata(value);
        }
      });
    } catch {}
  }

  function installInitialObjectTrap(propertyName) {
    const descriptor = Object.getOwnPropertyDescriptor(global, propertyName);
    if (descriptor && descriptor.configurable === false) {
      try {
        const current = global[propertyName];
        if (isActive && current && typeof current === 'object') {
          pruneAdMetadata(current);
          stats.initialObjects++;
        }
      } catch {}
      return;
    }

    let storedValue;
    try {
      storedValue = descriptor?.get ? descriptor.get.call(global) : descriptor?.value;
      if (isActive && storedValue && typeof storedValue === 'object') {
        pruneAdMetadata(storedValue);
        stats.initialObjects++;
      }
    } catch {}

    try {
      Object.defineProperty(global, propertyName, {
        configurable: true,
        enumerable: descriptor?.enumerable !== false,
        get() {
          if (descriptor?.get) return descriptor.get.call(global);
          return storedValue;
        },
        set(value) {
          const nextValue = isActive ? pruneAdMetadata(value) : value;
          if (descriptor?.set) descriptor.set.call(global, nextValue);
          else storedValue = nextValue;
          if (isActive && value && typeof value === 'object') stats.initialObjects++;
        }
      });
    } catch {}
  }

  installInitialObjectTrap('ytInitialPlayerResponse');
  installInitialObjectTrap('ytInitialData');

  function pruneKnownPlayerConfigs() {
    if (!isActive) return;
    const containers = [
      global.ytplayer?.config?.args,
      global.ytcfg?.data_?.PLAYER_VARS,
      global.ytcfg?.data_?.PLAYER_CONFIG?.args
    ];
    for (const container of containers) {
      if (!container || typeof container !== 'object') continue;
      pruneAdMetadata(container);
    }
  }

  const configPruneTimer = global.setInterval(pruneKnownPlayerConfigs, 500);
  pruneKnownPlayerConfigs();

  function handleStateChange(event) {
    const detail = event?.detail;
    if (!detail || typeof detail !== 'object') return;
    if (typeof detail.generation === 'number' && detail.generation <= currentGeneration) return;
    if (typeof detail.generation === 'number') currentGeneration = detail.generation;
    isActive = detail.globalEnabled !== false && detail.adBlockEnabled !== false;
    stats.stateChanges++;
  }

  global.addEventListener('rastin-extension-state', handleStateChange);

  function syncStateFromDom() {
    const value = global.document.documentElement?.getAttribute(STATE_ATTRIBUTE);
    if (value !== 'on' && value !== 'off') return;
    const nextState = value === 'on';
    if (nextState !== isActive) {
      isActive = nextState;
      stats.stateChanges++;
    }
  }

  const stateObserver = new MutationObserver(syncStateFromDom);
  if (global.document.documentElement) {
    stateObserver.observe(global.document.documentElement, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE]
    });
    syncStateFromDom();
  }

  // YouTube can deliver server-side ad placements without adPlacements/adSlots
  // or the classic ad-showing class. Its MAIN-world player API exposes these
  // episodes as "SSAP, AD" in Stats for Nerds. Seek each stable ad identity at
  // most once so a server retry cannot become an extension-generated loop.
  const serverAdAttempts = new Map();
  let currentPlayer = null;
  let playerObserver = null;
  let classicEpisodeActive = false;
  let classicMarker = null;
  let classicApiAttempted = false;

  function resetClassicEpisode() {
    classicEpisodeActive = false;
    classicMarker = null;
    classicApiAttempted = false;
  }

  function syncPlayer() {
    const nextPlayer = global.document.getElementById('movie_player');
    if (nextPlayer === currentPlayer) return;
    playerObserver?.disconnect();
    currentPlayer = nextPlayer;
    resetClassicEpisode();
    if (currentPlayer && playerObserver) {
      playerObserver.observe(currentPlayer, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      });
    }
  }

  function readServerAdState(player) {
    try {
      const nerdStats = player.getStatsForNerds?.() || {};
      let debugInfo = String(nerdStats.debug_info || nerdStats.debugInfo || '');
      if (!debugInfo) {
        try { debugInfo = JSON.stringify(nerdStats); } catch {}
      }

      const videoData = player.getVideoData?.() || {};
      const hasServerAdTokens = /\bSSAP\b/i.test(debugInfo) && /\bAD\b/i.test(debugInfo);
      const hasExplicitAdFlag = videoData.isAd === true || videoData.is_ad === true;
      if (!hasServerAdTokens && !hasExplicitAdFlag) return null;

      const progress = player.getProgressState?.() || {};
      const duration = Number(progress.duration);
      if (!Number.isFinite(duration) || duration <= 0) return null;

      const videoId = String(videoData.video_id || videoData.videoId || 'unknown');
      const badge = String(player.querySelector(
        '.ytp-ad-simple-ad-badge, .ytp-ad-text, .ytp-ad-preview-text'
      )?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

      return {
        duration,
        key: `${videoId}|${duration.toFixed(3)}|${badge}`
      };
    } catch {
      return null;
    }
  }

  function trySkipServerSideAd(player) {
    const adState = readServerAdState(player);
    if (!adState) return false;
    if (serverAdAttempts.has(adState.key)) return true;

    serverAdAttempts.set(adState.key, Date.now());
    if (serverAdAttempts.size > 50) {
      const oldestKey = serverAdAttempts.keys().next().value;
      serverAdAttempts.delete(oldestKey);
    }

    try {
      if (typeof player.seekTo === 'function') {
        player.seekTo(adState.duration);
        stats.serverSideSkips++;
      }
    } catch {}
    return true;
  }

  function trySkipClassicAd(player) {
    const isClassicAd = player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
    if (!isClassicAd) {
      resetClassicEpisode();
      return;
    }

    const marker = player.querySelector(
      '.ytp-ad-player-overlay-layout, .ytp-ad-player-overlay, .ytp-ad-preview-container'
    );
    if (!classicEpisodeActive || (marker && classicMarker && marker !== classicMarker)) {
      classicEpisodeActive = true;
      classicMarker = marker;
      classicApiAttempted = false;
    }

    if (!classicApiAttempted && typeof player.skipAd === 'function') {
      classicApiAttempted = true;
      try {
        player.skipAd();
        stats.classicSkips++;
      } catch {}
    }
  }

  function checkPlayerAds() {
    if (!isActive) {
      resetClassicEpisode();
      return;
    }
    syncPlayer();
    const player = currentPlayer;
    if (!player) return;
    if (trySkipServerSideAd(player)) return;
    trySkipClassicAd(player);
  }

  playerObserver = new MutationObserver(checkPlayerAds);
  const documentObserver = new MutationObserver(() => {
    syncPlayer();
    checkPlayerAds();
  });
  documentObserver.observe(global.document.documentElement || global.document, {
    childList: true,
    subtree: true
  });
  const playerPollTimer = global.setInterval(checkPlayerAds, 250);
  syncPlayer();
  checkPlayerAds();

  function teardown() {
    global.removeEventListener('rastin-extension-state', handleStateChange);
    stateObserver.disconnect();
    documentObserver.disconnect();
    playerObserver?.disconnect();
    global.clearInterval(playerPollTimer);
    global.clearInterval(configPruneTimer);
    try {
      if (global.JSON?.parse === patchedJsonParse) global.JSON.parse = nativeJsonParse;
    } catch {}
    try {
      if (responsePrototype?.json === patchedResponseJson) responsePrototype.json = nativeResponseJson;
      if (responsePrototype?.text === patchedResponseText) responsePrototype.text = nativeResponseText;
    } catch {}
    try {
      if (xhrPrototype && responseTextDescriptor) {
        Object.defineProperty(xhrPrototype, 'responseText', responseTextDescriptor);
      }
      if (xhrPrototype && responseDescriptor) {
        Object.defineProperty(xhrPrototype, 'response', responseDescriptor);
      }
    } catch {}
  }

  global.addEventListener('pagehide', teardown, { once: true });
  global.RastinYouTubeAdInterceptor = Object.freeze({
    get active() { return isActive; },
    getStats() { return { ...stats }; },
    matchesPlayerUrl,
    pruneAdMetadata
  });

  try { global.dispatchEvent(new CustomEvent('rastin-main-ready')); } catch {}
})(typeof window !== 'undefined' ? window : globalThis);
