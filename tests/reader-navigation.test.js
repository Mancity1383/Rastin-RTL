import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationNavigator } from '../reader/navigation.js';

function setup({ reducedMotion = false, bounds = { x: 1000, y: 1600, width: 60, height: 24 }, render } = {}) {
  let time = 0, nextFrame = 1, documentKey = 'document-a', page = 1, busy = false;
  const frames = new Map(), listeners = new Map(), renders = [], animations = [], positions = [];
  const view = {
    performance: { now: () => time },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const target = {
    getAttribute: name => name === 'data-annotation-id' ? 'mark-1' : null,
    getBoundingClientRect: () => ({
      left: 102 + 26 + bounds.x - scroller.scrollLeft,
      right: 102 + 26 + bounds.x + bounds.width - scroller.scrollLeft,
      top: 52 + 26 + bounds.y - scroller.scrollTop,
      bottom: 52 + 26 + bounds.y + bounds.height - scroller.scrollTop
    }),
    animate(keyframes, options) {
      let resolve;
      const animation = { keyframes, options, cancelled: false,
        finished: new Promise(done => { resolve = done; }),
        finish: () => resolve(), cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    }
  };
  const stage = { contains: node => node === target, getAttribute: () => String(busy) };
  let attached = true;
  const layer = { querySelectorAll: () => attached ? [target] : [], contains: node => attached && node === target };
  const scroller = {
    ownerDocument: { defaultView: view }, scrollTop: 0, scrollLeft: 0,
    clientWidth: 600, clientHeight: 400, scrollWidth: 1800, scrollHeight: 2700, clientLeft: 2, clientTop: 2,
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    scrollTo({ left, top, behavior }) { this.scrollLeft = left; this.scrollTop = top; positions.push({ left, top, behavior }); },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const navigator = createAnnotationNavigator({ scroller, stage, layer,
    getDocumentKey: () => documentKey, getPage: () => page,
    async renderPage(nextPage) { renders.push(nextPage); if (render) await render(nextPage); page = nextPage; }
  });
  return { navigator, scroller, animations, frames, renders, positions, listeners,
    item: { id: 'mark-1', page: 1 },
    setDocument(value) { documentKey = value; }, setPage(value) { page = value; },
    setBusy(value) { busy = value; }, detach() { attached = false; },
    emit(name, event = {}) { listeners.get(name)?.(event); },
    async tick(elapsed = 360) {
      time += elapsed;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(time);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

test('same-page jumps center both axes inside the PDF pane without rendering or motion when reduced', async () => {
  const session = setup({ reducedMotion: true });
  assert.equal(await session.navigator.jump(session.item), true);
  assert.deepEqual(session.renders, []);
  assert.equal(session.scroller.scrollLeft, 756);
  assert.equal(session.scroller.scrollTop, 1438);
  assert.equal(session.animations.length, 0);
  assert.equal(session.frames.size, 0);
  assert.equal(session.positions[0].behavior, 'instant');
});

test('oversized annotations start at a padded edge and scrolling remains within the pane bounds', async () => {
  const session = setup({ reducedMotion: true, bounds: { x: 400, y: 1200, width: 1000, height: 800 } });
  await session.navigator.jump(session.item);
  assert.equal(session.scroller.scrollLeft, 402);
  assert.equal(session.scroller.scrollTop, 1202);
  const edge = setup({ reducedMotion: true, bounds: { x: 2000, y: 4000, width: 20, height: 20 } });
  await edge.navigator.jump(edge.item);
  assert.equal(edge.scroller.scrollLeft, 1200);
  assert.equal(edge.scroller.scrollTop, 2300);
});

test('smooth jumps ease to the mark and give one temporary glow without fading its content', async () => {
  const session = setup();
  const result = session.navigator.jump(session.item);
  await Promise.resolve();
  await session.tick(90);
  assert.ok(session.scroller.scrollTop > 0 && session.scroller.scrollTop < 1438 / 2);
  await session.tick(270);
  assert.equal(await result, true);
  assert.equal(session.scroller.scrollTop, 1438);
  assert.equal(session.animations.length, 1);
  const animation = session.animations[0];
  assert.equal(animation.options.iterations, 1);
  assert.ok(animation.options.duration <= 600);
  assert.ok(animation.keyframes.every(frame => !Object.hasOwn(frame, 'opacity')));
  animation.finish();
  await Promise.resolve();
  assert.equal(animation.cancelled, true);
});

test('user input cancels in-progress scrolling immediately and destroy removes its listeners', async () => {
  for (const name of ['wheel', 'touchstart', 'pointerdown', 'input', 'keydown']) {
    const session = setup();
    const result = session.navigator.jump(session.item);
    await Promise.resolve();
    await session.tick(90);
    session.emit(name, { key: 'PageDown' });
    const stopped = session.scroller.scrollTop;
    await session.tick(500);
    assert.equal(await result, false, name);
    assert.equal(session.scroller.scrollTop, stopped, name);
    assert.equal(session.frames.size, 0);
    session.navigator.destroy();
    assert.equal(session.listeners.size, 0);
    assert.equal(await session.navigator.jump(session.item), false);
  }
});

test('document changes during another-page rendering never scroll or focus the replacement document', async () => {
  let completeRender;
  const session = setup({ render: () => new Promise(resolve => { completeRender = resolve; }) });
  const result = session.navigator.jump({ ...session.item, page: 2 });
  session.setDocument('document-b');
  completeRender();
  assert.equal(await result, false);
  assert.deepEqual(session.renders, [2]);
  assert.equal(session.positions.length, 0);
  assert.equal(session.animations.length, 0);
});

test('cancelling a pending render resolves its jump without waiting for page rendering', async () => {
  let completeRender;
  const session = setup({ render: () => new Promise(resolve => { completeRender = resolve; }) });
  const result = session.navigator.jump({ ...session.item, page: 2 });
  session.navigator.cancel();
  assert.equal(await result, false);
  completeRender();
  await Promise.resolve();
  assert.equal(session.positions.length, 0);
});

test('a page change or replaced annotation interrupts animation without a stale arrival cue', async () => {
  for (const change of [session => session.setPage(3), session => session.detach()]) {
    const session = setup();
    const result = session.navigator.jump(session.item);
    await Promise.resolve();
    await session.tick(90);
    change(session);
    await session.tick(360);
    assert.equal(await result, false);
    assert.equal(session.animations.length, 0);
  }
});

test('clicking an annotation while its current page is rendering waits without rerendering', async () => {
  const session = setup({ reducedMotion: true });
  session.setBusy(true);
  const result = session.navigator.jump(session.item);
  await session.tick(100);
  assert.equal(session.positions.length, 0);
  session.setBusy(false);
  await session.tick(100);
  assert.equal(await result, true);
  assert.deepEqual(session.renders, []);
});

test('a subsequent jump cancels the previous glow and ignores a removed target', async () => {
  const session = setup();
  const first = session.navigator.jump(session.item);
  await Promise.resolve();
  await session.tick();
  assert.equal(await first, true);
  session.detach();
  assert.equal(await session.navigator.jump(session.item), false);
  assert.equal(session.animations[0].cancelled, true);
});
