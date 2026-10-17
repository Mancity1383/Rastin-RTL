import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderKeyboard } from '../reader/keyboard.js';

function node({ editable = false, host, widget = false } = {}) {
  return { isContentEditable: editable, closest(selector) {
    if (selector === '[contenteditable]') return host ? { getAttribute: () => host } : null;
    if (selector.includes('input')) return editable ? this : null;
    return widget ? this : null;
  } };
}

function setup({ ready = true, page = 3, count = 8 } = {}) {
  const listeners = new Map(), calls = [];
  let dialogOpen = false;
  const doc = { activeElement: node(), querySelector: () => dialogOpen ? {} : null,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
  const keyboard = createReaderKeyboard({ document: doc, isReady: () => ready,
    getPage: () => page, getPageCount: () => count,
    goToPage(next) { calls.push(['page', next]); page = next; },
    zoomBy: value => calls.push(['zoom', value]), setZoom: value => calls.push(['zoomMode', value]),
    undo: () => calls.push(['undo']), redo: () => calls.push(['redo']),
    setTool: value => calls.push(['tool', value]), cancelSelection: () => calls.push(['cancel']),
    toggleFullscreen: () => calls.push(['fullscreen']), openFile: () => calls.push(['open']), savePdf: () => calls.push(['save']) });
  return { calls, keyboard, doc, listeners, dialog(value) { dialogOpen = value; },
    emit(key, properties = {}) {
      const event = { key, target: node(), ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        repeat: false, defaultPrevented: false, ...properties,
        preventDefault() { this.defaultPrevented = true; } };
      listeners.get('keydown')?.(event);
      return event;
    } };
}

test('undo and both redo combinations support Control, Command and Persian layout', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const session = setup();
    for (const event of [
      ['z', {}], ['Z', { shiftKey: true }], ['y', {}],
      ['ظ', { code: 'KeyZ' }], ['ظ', { code: 'KeyZ', shiftKey: true }], ['غ', { code: 'KeyY' }]
    ]) assert.equal(session.emit(event[0], { [modifier]: true, ...event[1] }).defaultPrevented, true);
    assert.deepEqual(session.calls, [['undo'], ['redo'], ['redo'], ['undo'], ['redo'], ['redo']]);
  }
});

test('shift plus/minus, underscore, physical Persian keys and numpad keys zoom the PDF', () => {
  const session = setup();
  for (const [key, properties, direction] of [
    ['+', { shiftKey: true, code: 'Equal' }, 1], ['_', { shiftKey: true, code: 'Minus' }, -1],
    ['=', {}, 1], ['-', {}, -1], ['_', { shiftKey: true }, -1],
    ['+', { code: 'NumpadAdd' }, 1], ['-', { code: 'NumpadSubtract' }, -1],
    ['+', { ctrlKey: true, code: 'Equal' }, 1], ['_', { metaKey: true, shiftKey: true, code: 'Minus' }, -1],
    ['=', { code: 'Equal', repeat: true }, 1]
  ]) {
    assert.equal(session.emit(key, properties).defaultPrevented, true);
    assert.deepEqual(session.calls.at(-1), ['zoom', direction]);
  }
  const before = session.calls.length;
  assert.equal(session.emit('_').defaultPrevented, false);
  assert.equal(session.calls.length, before);
});

test('up/down and RTL left/right page navigation preserve document bounds', () => {
  const session = setup({ page: 1, count: 3 });
  for (const key of ['ArrowUp', 'ArrowRight', 'PageUp', 'Home']) assert.equal(session.emit(key).defaultPrevented, true);
  assert.deepEqual(session.calls, []);
  session.emit('ArrowDown'); session.emit('ArrowLeft'); session.emit('PageDown');
  assert.deepEqual(session.calls, [['page', 2], ['page', 3]]);
  session.emit('ArrowUp'); session.emit('ArrowRight'); session.emit('End'); session.emit('Home');
  assert.deepEqual(session.calls, [['page', 2], ['page', 3], ['page', 2], ['page', 1], ['page', 3], ['page', 1]]);
});

test('page navigation ignores auto-repeat without handing repeated keys to browser scroll', () => {
  const session = setup();
  assert.equal(session.emit('ArrowDown', { repeat: true }).defaultPrevented, true);
  assert.equal(session.emit('End', { repeat: true }).defaultPrevented, true);
  assert.deepEqual(session.calls, []);
  session.emit('ArrowDown');
  assert.deepEqual(session.calls, [['page', 4]]);
});

test('shift and command navigation keep browser selection and shortcut behavior', () => {
  const session = setup();
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End']) {
      assert.equal(session.emit(key, { [modifier]: true }).defaultPrevented, false);
    }
  }
  assert.deepEqual(session.calls, []);
});

test('NumLock-off Ctrl+Insert and Ctrl+End retain native copy and navigation behavior', () => {
  const session = setup();
  assert.equal(session.emit('Insert', { code: 'Numpad0', ctrlKey: true }).defaultPrevented, false);
  assert.equal(session.emit('End', { code: 'Numpad1', ctrlKey: true }).defaultPrevented, false);
  assert.deepEqual(session.calls, []);
  session.emit('۰', { code: 'Numpad0', ctrlKey: true });
  session.emit('١', { code: 'Numpad1', ctrlKey: true });
  assert.deepEqual(session.calls, [['zoomMode', 'page-fit'], ['zoomMode', '1']]);
});

test('tools, fullscreen, fit modes and Escape use reader actions without browser F11 interception', () => {
  const session = setup();
  for (const key of ['v', 'h', 'u', 'p', 'r', 'n', 'e']) session.emit(key);
  session.emit('ر', { code: 'KeyV' });
  session.emit('f'); session.emit('w'); session.emit('0', { ctrlKey: true });
  session.emit('۱', { metaKey: true, code: 'Digit1' }); session.emit('Escape');
  assert.deepEqual(session.calls, [
    ...['select', 'highlight', 'underline', 'pen', 'rect', 'note', 'erase', 'select'].map(tool => ['tool', tool]),
    ['fullscreen'], ['zoomMode', 'page-width'], ['zoomMode', 'page-fit'], ['zoomMode', '1'], ['cancel'], ['tool', 'select']
  ]);
  assert.equal(session.emit('F11').defaultPrevented, false);
  assert.equal(session.emit('H', { shiftKey: true }).defaultPrevented, false);
});

test('open is available before a PDF is ready while other PDF commands remain inactive', () => {
  const session = setup({ ready: false });
  assert.equal(session.emit('o', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(session.emit('خ', { metaKey: true, code: 'KeyO' }).defaultPrevented, true);
  for (const [key, properties] of [['s', { ctrlKey: true }], ['z', { ctrlKey: true }], ['+', {}], ['ArrowDown', {}], ['h', {}]]) {
    assert.equal(session.emit(key, properties).defaultPrevented, false);
  }
  assert.deepEqual(session.calls, [['open'], ['open']]);
});

test('save and open invoke callbacks once on key repeat and preserve browser shifted variants', () => {
  const session = setup();
  for (const key of ['o', 's']) {
    assert.equal(session.emit(key, { ctrlKey: true }).defaultPrevented, true);
    assert.equal(session.emit(key, { ctrlKey: true, repeat: true }).defaultPrevented, true);
    assert.equal(session.emit(key, { ctrlKey: true, shiftKey: true }).defaultPrevented, false);
  }
  assert.deepEqual(session.calls, [['open'], ['save']]);
});

test('input, active editing hosts and composed shadow paths keep native editing shortcuts', () => {
  const session = setup();
  for (const properties of [
    { target: node({ editable: true }) },
    { target: node({ host: 'true' }) }, { target: node({ host: 'plaintext-only' }) },
    { composedPath: () => [node({ editable: true }), node()] }
  ]) {
    for (const [key, extra] of [['z', { ctrlKey: true }], ['o', { ctrlKey: true }], ['ArrowDown', {}], ['h', {}], ['Escape', {}]]) {
      assert.equal(session.emit(key, { ...properties, ...extra }).defaultPrevented, false);
    }
  }
  session.doc.activeElement = node({ editable: true });
  assert.equal(session.emit('s', { ctrlKey: true }).defaultPrevented, false);
  assert.deepEqual(session.calls, []);
});

test('contenteditable false and ordinary focused toolbar buttons allow PDF shortcuts', () => {
  const session = setup();
  session.doc.activeElement = node({ host: 'false' });
  session.emit('ArrowDown', { target: node({ host: 'false' }) });
  session.emit('h');
  assert.deepEqual(session.calls, [['page', 4], ['tool', 'highlight']]);
});

test('composite widgets retain navigation and tool letters while global document commands work', () => {
  const session = setup();
  const target = node({ widget: true });
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'h']) assert.equal(session.emit(key, { target }).defaultPrevented, false);
  session.doc.activeElement = target;
  assert.equal(session.emit('ArrowDown').defaultPrevented, false);
  session.emit('s', { ctrlKey: true });
  assert.deepEqual(session.calls, [['save']]);
});

test('open dialogs, IME composition, consumed events and Alt shortcuts are never intercepted', () => {
  const session = setup();
  session.dialog(true);
  for (const key of ['Escape', 'ArrowDown', 'h']) assert.equal(session.emit(key).defaultPrevented, false);
  assert.equal(session.emit('o', { ctrlKey: true }).defaultPrevented, false);
  session.dialog(false);
  for (const extra of [{ isComposing: true }, { defaultPrevented: true }, { altKey: true }, { altKey: true, ctrlKey: true }]) {
    const event = session.emit('z', { ctrlKey: true, ...extra });
    assert.equal(event.defaultPrevented, Boolean(extra.defaultPrevented));
  }
  assert.equal(session.emit('Process', { code: 'KeyH' }).defaultPrevented, false);
  assert.equal(session.emit('Dead', { code: 'KeyH' }).defaultPrevented, false);
  assert.deepEqual(session.calls, []);
});

test('optional fit/fullscreen/save callbacks leave unavailable actions unconsumed', () => {
  let listener;
  const doc = { addEventListener: (_, value) => { listener = value; }, removeEventListener() {}, querySelector: () => null };
  createReaderKeyboard({ document: doc, isReady: () => true });
  for (const key of ['f', 'w', 's', '0', '1']) {
    const event = { key, ctrlKey: ['s', '0', '1'].includes(key), preventDefault() { throw new Error('unavailable shortcut consumed'); } };
    listener(event);
  }
});

test('destroy unregisters the listener and subsequent events do not act', () => {
  const session = setup();
  assert.equal(session.listeners.size, 1);
  session.keyboard.destroy();
  session.keyboard.destroy();
  assert.equal(session.listeners.size, 0);
  session.emit('z', { ctrlKey: true });
  assert.deepEqual(session.calls, []);
});
