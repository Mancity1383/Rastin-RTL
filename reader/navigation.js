const CANCELLED = Symbol('cancelled');
const SCROLL_DURATION = 360;

// Geometry stays in browser coordinates so rotation and zoom are already
// accounted for by the rendered PDF annotation. Only the PDF pane is moved.
export function createAnnotationNavigator({ scroller, stage, layer, getDocumentKey, getPage, renderPage }) {
  const view = scroller.ownerDocument.defaultView;
  let sequence = 0;
  let destroyed = false;
  let active = null;
  let focusAnimation = null;

  function cancel() {
    sequence++;
    active?.cancel(CANCELLED);
    active?.stop?.(false);
    active = null;
    focusAnimation?.cancel();
    focusAnimation = null;
  }

  const isCurrent = run => !destroyed && run.sequence === sequence &&
    getDocumentKey() === run.documentKey && getPage() === run.page;

  function targetFor(item) {
    return Array.from(layer.querySelectorAll('[data-annotation-id]'))
      .find(node => node.getAttribute('data-annotation-id') === item.id);
  }

  function scrollDestination(target) {
    const bounds = target.getBoundingClientRect();
    const pane = scroller.getBoundingClientRect();
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return null;
    const position = (start, end, origin, current, size, extent) => {
      const padding = Math.min(24, size / 6);
      const targetSize = Math.max(0, end - start);
      // A tall selection is read from its first line instead of landing halfway
      // through it. Short marks are centered with room around their edges.
      const desired = current + start - origin -
        (targetSize > size - padding * 2 ? padding : (size - targetSize) / 2);
      return Math.max(0, Math.min(desired, Math.max(0, extent - size)));
    };
    return {
      left: position(bounds.left, bounds.right, pane.left + scroller.clientLeft,
        scroller.scrollLeft, scroller.clientWidth, scroller.scrollWidth),
      top: position(bounds.top, bounds.bottom, pane.top + scroller.clientTop,
        scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight)
    };
  }

  function move(run, destination, immediate, target) {
    const start = { left: scroller.scrollLeft, top: scroller.scrollTop };
    const setPosition = (left, top) => scroller.scrollTo({ left, top, behavior: 'instant' });
    if (immediate || Math.hypot(destination.left - start.left, destination.top - start.top) < 1) {
      setPosition(destination.left, destination.top);
      return Promise.resolve(isCurrent(run));
    }
    return new Promise(resolve => {
      let frame = null;
      let finished = false;
      const startTime = view.performance.now();
      run.stop = success => {
        if (finished) return;
        finished = true;
        if (frame !== null) view.cancelAnimationFrame(frame);
        run.stop = null;
        resolve(success);
      };
      function step(time) {
        if (!isCurrent(run) || !layer.contains(target) || !stage.contains(target)) {
          run.stop(false);
          return;
        }
        const progress = Math.min(1, Math.max(0, (time - startTime) / SCROLL_DURATION));
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        setPosition(start.left + (destination.left - start.left) * eased,
          start.top + (destination.top - start.top) * eased);
        if (progress === 1) run.stop(true);
        else frame = view.requestAnimationFrame(step);
      }
      frame = view.requestAnimationFrame(step);
    });
  }

  function waitForPage(run) {
    if (stage.getAttribute('aria-busy') !== 'true') return Promise.resolve(isCurrent(run));
    return new Promise(resolve => {
      let frame = null;
      let finished = false;
      run.stop = success => {
        if (finished) return;
        finished = true;
        if (frame !== null) view.cancelAnimationFrame(frame);
        run.stop = null;
        resolve(success);
      };
      function step() {
        if (!isCurrent(run)) run.stop(false);
        else if (stage.getAttribute('aria-busy') !== 'true') run.stop(true);
        else frame = view.requestAnimationFrame(step);
      }
      frame = view.requestAnimationFrame(step);
    });
  }

  function cue(target) {
    if (typeof target.animate !== 'function') return;
    const animation = target.animate([
      { filter: 'drop-shadow(0 0 0 rgba(245, 158, 11, 0))', offset: 0 },
      { filter: 'drop-shadow(0 0 5px rgba(245, 158, 11, 0.65))', offset: 0.28 },
      { filter: 'drop-shadow(0 0 0 rgba(245, 158, 11, 0))', offset: 1 }
    ], { duration: 580, easing: 'ease-out', iterations: 1 });
    focusAnimation = animation;
    // The animation never changes inline styles or the annotation's opacity.
    // Cancelling on completion also removes any animation effect immediately.
    void animation.finished.then(() => {
      if (focusAnimation === animation) { animation.cancel(); focusAnimation = null; }
    }, () => {});
  }

  async function jump(item) {
    cancel();
    const documentKey = getDocumentKey();
    if (destroyed || !documentKey || typeof item?.id !== 'string' ||
      !Number.isInteger(item.page) || item.page < 1) return false;
    let cancelRun;
    const interrupted = new Promise(resolve => { cancelRun = resolve; });
    const run = { sequence, documentKey, page: item.page, cancel: cancelRun, stop: null };
    active = run;
    try {
      if (getPage() !== item.page) {
        const rendered = await Promise.race([Promise.resolve(renderPage(item.page)), interrupted]);
        if (rendered === CANCELLED) return false;
      }
      if (!isCurrent(run) || !await waitForPage(run)) return false;
      const target = targetFor(item);
      if (!target || !stage.contains(target)) return false;
      const destination = scrollDestination(target);
      if (!destination) return false;
      const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      if (!await move(run, destination, reducedMotion, target) || !isCurrent(run)) return false;
      if (!reducedMotion) cue(target);
      return true;
    } catch {
      // Page rendering and disconnected targets may fail during a document
      // switch. A failed jump must never move another document or open a note.
      return false;
    } finally {
      if (active === run) active = null;
    }
  }

  function keyDown(event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
  }
  const listeners = { wheel: cancel, touchstart: cancel, pointerdown: cancel, input: cancel, keydown: keyDown };
  for (const [name, listener] of Object.entries(listeners)) {
    scroller.addEventListener(name, listener, { passive: true });
  }

  return {
    jump, cancel,
    destroy() {
      cancel();
      destroyed = true;
      for (const [name, listener] of Object.entries(listeners)) scroller.removeEventListener(name, listener);
    }
  };
}
