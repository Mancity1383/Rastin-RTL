/**
 * Dedicated YouTube ad handler for the extension's isolated world.
 * Actions are gated by YouTube's own player ad classes to avoid touching
 * normal playback or navigation UI.
 */
(function (global) {
  'use strict';

  if (global.YouTubeAdAdapter) return;

  const STYLE_ID = 'rastin-youtube-ad-styles';
  const AD_CLASSES = ['ad-showing', 'ad-interrupting'];
  const SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-slot [role="button"]',
    '.ytp-ad-skip-button-container button',
    '[id^="skip-button"] button',
    '.videoAdUiSkipButton',
    'button[aria-label*="Skip ad" i]',
    '[role="button"][aria-label*="Skip ad" i]',
    'button[data-title-no-tooltip*="Skip ad" i]'
  ].join(', ');
  const AD_REWIND_THRESHOLD = 0.75;
  const UNSKIPPABLE_AD_RATE = 16;
  const INTERRUPTION_TOAST_SELECTOR = [
    'yt-notification-action-renderer',
    'ytd-notification-action-renderer',
    'tp-yt-paper-toast'
  ].join(', ');
  const INTERRUPTION_TEXT_PATTERN = /\bexperiencing\s+interruptions\s*\?/i;
  const COSMETIC_CSS = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-banner-promo-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-video-masthead-ad-v3-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytm-promoted-sparkles-web-renderer',
    'ytm-companion-ad-renderer',
    '#player-ads',
    '[data-is-promoted="true"]'
  ].join(',\n') + ' { display: none !important; }';

  class YouTubeAdAdapter {
    constructor() {
      this.scope = null;
      this.isRunning = false;
      this.currentPlayer = null;
      this.playerObserver = null;
      this.originalVideoStates = new WeakMap();
      this.trackedVideos = new Set();
      this.adActions = new WeakMap();
    }

    isYouTubeHost() {
      const host = window.location.hostname.toLowerCase();
      return host === 'youtube.com' || host.endsWith('.youtube.com') ||
        host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com') ||
        host === 'youtu.be';
    }


    start() {
      if (!this.isYouTubeHost() || this.isRunning) return;
      if (typeof global.DisposableScope !== 'function') {
        console.warn('[Rastin RTL] YouTube adapter dependency is unavailable.');
        return;
      }

      this.isRunning = true;
      this.scope = new global.DisposableScope('YouTubeAdAdapter');
      this.injectCosmeticStyles();
      this.bindEvents();
      this.dismissInterruptionToasts();
      this.syncPlayer();
      this.checkVideoAd();
    }

    injectCosmeticStyles() {
      const attachStyle = () => {
        if (!this.isRunning || document.getElementById(STYLE_ID)) return true;
        const parent = document.head || document.documentElement;
        if (!parent) return false;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = COSMETIC_CSS;
        parent.appendChild(style);
        this.scope?.addCleanup(() => style.remove());
        return true;
      };

      if (!attachStyle()) {
        this.scope.addEventListener(document, 'readystatechange', attachStyle);
      }
    }

    bindEvents() {
      const root = document.documentElement || document;
      this.scope.observe(
        new MutationObserver(() => {
          this.dismissInterruptionToasts();
          this.syncPlayer();
          this.checkVideoAd();
        }),
        root,
        { childList: true, subtree: true }
      );

      this.playerObserver = new MutationObserver(() => this.checkVideoAd());
      this.scope.addCleanup(() => {
        this.playerObserver?.disconnect();
        this.playerObserver = null;
        this.currentPlayer = null;
      });

      for (const eventName of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'spfdone']) {
        this.scope.addEventListener(document, eventName, () => {
          this.syncPlayer();
          this.checkVideoAd();
        });
      }

      this.scope.addEventListener(document, 'timeupdate', (event) => {
        if (event.target?.tagName === 'VIDEO') this.checkVideoAd();
      }, true);

      this.scope.addEventListener(document, 'emptied', (event) => {
        if (event.target?.tagName === 'VIDEO') this.restoreVideo(event.target);
      }, true);

      this.scope.setInterval(() => {
        this.dismissInterruptionToasts();
        this.syncPlayer();
        this.checkVideoAd();
      }, 250);
    }

    syncPlayer() {
      if (!this.isRunning) return;
      const nextPlayer = document.getElementById('movie_player');
      if (nextPlayer === this.currentPlayer) return;

      this.restoreAllVideos();
      this.playerObserver?.disconnect();
      this.currentPlayer = nextPlayer;

      if (nextPlayer && this.playerObserver) {
        this.playerObserver.observe(nextPlayer, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true
        });
      }
    }

    isPlayerShowingAd(player) {
      return AD_CLASSES.some(className => player.classList.contains(className));
    }

    dismissInterruptionToasts(root = document) {
      const candidates = [];
      if (root?.matches?.(INTERRUPTION_TOAST_SELECTOR)) candidates.push(root);
      try { candidates.push(...root.querySelectorAll(INTERRUPTION_TOAST_SELECTOR)); } catch {}

      for (const candidate of candidates) {
        const text = String(candidate.textContent || '').replace(/\s+/g, ' ').trim();
        if (!INTERRUPTION_TEXT_PATTERN.test(text)) continue;
        try {
          candidate.hidden = true;
          candidate.setAttribute('aria-hidden', 'true');
          candidate.style.setProperty('display', 'none', 'important');
        } catch {}
      }
    }

    captureVideo(video) {
      if (this.originalVideoStates.has(video)) return;
      this.originalVideoStates.set(video, {
        muted: video.muted,
        playbackRate: video.playbackRate
      });
      this.trackedVideos.add(video);
    }

    restoreVideo(video) {
      const original = this.originalVideoStates.get(video);
      if (!original) return;

      try { video.muted = original.muted; } catch {}
      try { video.playbackRate = original.playbackRate; } catch {}
      this.originalVideoStates.delete(video);
      this.adActions.delete(video);
      this.trackedVideos.delete(video);
    }

    restoreAllVideos(except = null) {
      for (const video of [...this.trackedVideos]) {
        if (video !== except) this.restoreVideo(video);
      }
    }

    syncAdEpisode(player, video) {
      let action = this.adActions.get(video);
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const adMarker = player.querySelector([
        '.ytp-ad-player-overlay-layout',
        '.ytp-ad-player-overlay',
        '.ytp-ad-preview-container',
        '.ytp-ad-text-overlay'
      ].join(', '));
      const currentSkipButton = player.querySelector(SKIP_BUTTON_SELECTOR);
      const buttonSignature = currentSkipButton
        ? `${currentSkipButton.getAttribute('aria-label') || ''}|${currentSkipButton.textContent || ''}`
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160)
        : '';

      if (!action || action.player !== player) {
        action = {
          player,
          adMarker,
          buttonSignature,
          lastCurrentTime: currentTime,
          apiAttempted: false,
          clickedButtons: new WeakSet()
        };
        this.adActions.set(video, action);
        return action;
      }

      const rewound = action.lastCurrentTime > 1 &&
        currentTime + AD_REWIND_THRESHOLD < action.lastCurrentTime;
      const markerChanged = Boolean(adMarker && action.adMarker && adMarker !== action.adMarker);
      const buttonChanged = Boolean(buttonSignature && action.buttonSignature &&
        buttonSignature !== action.buttonSignature);

      if (rewound || markerChanged || buttonChanged) {
        action.apiAttempted = false;
        action.clickedButtons = new WeakSet();
      }

      action.adMarker = adMarker;
      action.buttonSignature = buttonSignature;
      action.lastCurrentTime = currentTime;
      return action;
    }

    trySkipAd(player, action) {
      const skipButton = player.querySelector(SKIP_BUTTON_SELECTOR);
      const isDisabled = skipButton?.disabled || skipButton?.getAttribute('aria-disabled') === 'true';

      // YouTube may expose this on the player in some variants. In Chrome's
      // isolated world it is not always visible, so the DOM button remains the
      // reliable fallback.
      if (!action.apiAttempted && typeof player.skipAd === 'function') {
        try { player.skipAd(); } catch {}
        action.apiAttempted = true;
      }

      if (!skipButton || isDisabled || typeof skipButton.click !== 'function') {
        // A disabled Skip control is a countdown, not an unskippable ad. Wait
        // for it instead of accelerating the player during the countdown.
        return Boolean(skipButton);
      }

      if (!action.clickedButtons.has(skipButton)) {
        action.clickedButtons.add(skipButton);
        try {
          skipButton.click();
        } catch {}
      }
      return true;
    }

    checkVideoAd() {
      if (!this.isRunning) return;
      this.syncPlayer();

      const player = this.currentPlayer;
      if (!player) {
        this.restoreAllVideos();
        return;
      }

      const video = player.querySelector('video.html5-main-video') || player.querySelector('video');
      this.restoreAllVideos(video || null);
      if (!video) return;

      if (!this.isPlayerShowingAd(player)) {
        this.restoreVideo(video);
        return;
      }

      this.captureVideo(video);
      try { video.muted = true; } catch {}
      const action = this.syncAdEpisode(player, video);
      const hasSkipControl = this.trySkipAd(player, action);

      // For genuinely unskippable classic ads, speed up only the ad media.
      // The original rate is captured once and restored as soon as YouTube
      // removes its ad state, so normal videos and Skip countdowns are intact.
      if (!hasSkipControl) {
        try { video.playbackRate = UNSKIPPABLE_AD_RATE; } catch {}
      }
    }

    stop() {
      if (!this.isRunning) return;
      this.isRunning = false;
      this.scope?.dispose();
      this.scope = null;
      this.restoreAllVideos();
      this.originalVideoStates = new WeakMap();
      this.adActions = new WeakMap();
    }
  }

  global.YouTubeAdAdapter = new YouTubeAdAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
