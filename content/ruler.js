// RTL Beautifier & Fixer - Smart Reading Ruler
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  const RULER_ID = 'rtl-fixer-reading-ruler';
  const OVERLAY_ID = 'rtl-fixer-focus-overlay';
  const POSITION_PROPERTY = '--rtl-ruler-y';
  const FADE_DURATION_MS = 300;

  let rulerElement = null;
  let focusOverlay = null;
  let positionRafId = null;
  let revealRafId = null;
  let latestY = null;
  let listenersAttached = false;
  let rulerRemovalTimer = null;
  let overlayRemovalTimer = null;

  function getConfig() {
    return RtlFixer.config || RtlFixer.DEFAULT_CONFIG || {};
  }

  function createElement(id) {
    const element = document.createElement('div');
    element.id = id;
    element.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(element);
    return element;
  }

  function cancelRulerRemoval() {
    if (rulerRemovalTimer !== null) {
      clearTimeout(rulerRemovalTimer);
      rulerRemovalTimer = null;
    }
  }

  function cancelOverlayRemoval() {
    if (overlayRemovalTimer !== null) {
      clearTimeout(overlayRemovalTimer);
      overlayRemovalTimer = null;
    }
  }

  function ensureElements() {
    cancelRulerRemoval();

    if (!rulerElement?.isConnected) {
      rulerElement = createElement(RULER_ID);
    }

    if (getConfig().readingRulerFocus) {
      cancelOverlayRemoval();
      if (!focusOverlay?.isConnected) {
        focusOverlay = createElement(OVERLAY_ID);
      }
    }
  }

  function clampToViewport(y) {
    return Math.max(0, Math.min(window.innerHeight, y));
  }

  function renderPosition() {
    positionRafId = null;
    if (!rulerElement || latestY === null) return;

    latestY = clampToViewport(latestY);
    const value = `${latestY}px`;
    rulerElement.style.setProperty(POSITION_PROPERTY, value);

    if (focusOverlay && getConfig().readingRulerFocus) {
      focusOverlay.style.setProperty(POSITION_PROPERTY, value);
    }
  }

  function schedulePosition(y) {
    if (!Number.isFinite(y)) return;
    latestY = y;

    // Keep only one render queued while always using the newest pointer position.
    if (positionRafId === null) {
      positionRafId = requestAnimationFrame(renderPosition);
    }
  }

  function updateRulerMode() {
    const focusEnabled = Boolean(getConfig().readingRulerFocus);
    rulerElement?.classList.toggle('rtl-fixer-ruler-focus', focusEnabled);

    if (focusOverlay) {
      focusOverlay.classList.toggle('rtl-fixer-ruler-visible', focusEnabled);
      if (focusEnabled && latestY !== null) {
        focusOverlay.style.setProperty(POSITION_PROPERTY, `${latestY}px`);
      }
    }
  }

  function revealElements() {
    if (revealRafId !== null) return;

    revealRafId = requestAnimationFrame(() => {
      revealRafId = null;
      rulerElement?.classList.add('rtl-fixer-ruler-visible');
      if (getConfig().readingRulerFocus) {
        focusOverlay?.classList.add('rtl-fixer-ruler-visible');
      }
    });
  }

  function handlePointerMove(event) {
    schedulePosition(event.clientY);
  }

  function handleResize() {
    schedulePosition(latestY === null ? window.innerHeight / 2 : latestY);
  }

  function persistDisabledState() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage) return;

    const hostKey = RtlFixer.getSiteConfigKey();

    storage.get(RtlFixer.getSiteConfigKeys(), (stored) => {
      if (globalThis.chrome?.runtime?.lastError) return;

      const siteConfig = RtlFixer.getStoredSiteConfig(stored || {});
      storage.set({
        [hostKey]: {
          ...(siteConfig && typeof siteConfig === 'object' ? siteConfig : {}),
          readingRulerEnabled: false,
          readingRulerFocus: false
        }
      });
    });
  }

  function handleKeyDown(event) {
    if (event.key !== 'Escape') return;

    const config = getConfig();
    if (!config.readingRulerEnabled && !config.readingRulerFocus) return;

    config.readingRulerEnabled = false;
    config.readingRulerFocus = false;
    latestY = null;
    persistDisabledState();
    RtlFixer.removeRuler();
  }

  function attachListeners() {
    if (listenersAttached) return;

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleResize, { passive: true });
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;

    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('resize', handleResize);
    listenersAttached = false;
  }

  function scheduleElementRemoval(element, type) {
    if (!element) return;

    element.classList.remove('rtl-fixer-ruler-visible');

    if (type === 'ruler' && rulerRemovalTimer === null) {
      rulerRemovalTimer = setTimeout(() => {
        element.remove();
        if (rulerElement === element) rulerElement = null;
        rulerRemovalTimer = null;
      }, FADE_DURATION_MS);
    }

    if (type === 'overlay' && overlayRemovalTimer === null) {
      overlayRemovalTimer = setTimeout(() => {
        element.remove();
        if (focusOverlay === element) focusOverlay = null;
        overlayRemovalTimer = null;
      }, FADE_DURATION_MS);
    }
  }

  RtlFixer.initRuler = function () {
    const config = getConfig();
    const enabled = config.globalEnabled && config.enabled && config.readingRulerEnabled;

    if (!enabled) {
      RtlFixer.removeRuler();
      return;
    }

    ensureElements();
    updateRulerMode();
    attachListeners();

    if (latestY === null) latestY = window.innerHeight / 2;
    renderPosition();
    revealElements();
  };

  RtlFixer.removeRuler = function () {
    detachListeners();

    if (positionRafId !== null) {
      cancelAnimationFrame(positionRafId);
      positionRafId = null;
    }
    if (revealRafId !== null) {
      cancelAnimationFrame(revealRafId);
      revealRafId = null;
    }

    scheduleElementRemoval(rulerElement, 'ruler');
    scheduleElementRemoval(focusOverlay, 'overlay');
  };
})(window.RtlFixer);
