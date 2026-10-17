import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotations } from '../reader/annotations.js';
import { pdfRectToScreen, sanitizeItems, screenRectToPdf } from '../reader/annotation-model.js';

const documentA = 'a'.repeat(64);
const documentB = 'b'.repeat(64);
const key = id => 'rastin_pdf_annotations_' + id;

// Exercise the same PDF coordinate transforms at each allowed page rotation,
// including a non-zero crop box and zoom. No browser is needed for this model.
function viewport(rotation = 0, scale = 1) {
  const left = 30;
  const bottom = 50;
  const width = 600;
  const height = 800;
  const transform = rotation === 0 ? [scale, 0, 0, -scale, -left * scale, (bottom + height) * scale] :
    rotation === 90 ? [0, scale, scale, 0, -bottom * scale, -left * scale] :
    rotation === 180 ? [-scale, 0, 0, scale, (left + width) * scale, -bottom * scale] :
      [0, -scale, -scale, 0, (bottom + height) * scale, (left + width) * scale];
  const [a, b, c, d, e, f] = transform;
  return {
    width: (rotation % 180 ? height : width) * scale,
    height: (rotation % 180 ? width : height) * scale,
    convertToViewportPoint(x, y) { return [a * x + c * y + e, b * x + d * y + f]; },
    convertToPdfPoint(x, y) {
      const determinant = a * d - b * c;
      return [(d * (x - e) - c * (y - f)) / determinant, (-b * (x - e) + a * (y - f)) / determinant];
    }
  };
}

class FakeElement {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.ownerDocument = { createElementNS: () => new FakeElement() };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  getBoundingClientRect() { return { left: 20, top: 40, width: 600, height: 800, right: 620, bottom: 840 }; }
  contains(node) { return node?.inside === true; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
}

function setup({ initial = {}, failWrites = false, get } = {}) {
  const data = structuredClone(initial);
  const writes = [];
  const errors = [];
  const changes = [];
  const notes = [];
  let failure = failWrites;
  globalThis.chrome = { storage: { local: {
    async get(name) { return get ? await get(name, data) : { [name]: structuredClone(data[name]) }; },
    async set(values) {
      if (failure) throw new Error('storage full');
      await Promise.resolve();
      writes.push(structuredClone(values));
      Object.assign(data, structuredClone(values));
    }
  } } };
  const stage = new FakeElement();
  const layer = new FakeElement();
  const controller = createAnnotations({ stage, layer, onChange: change => changes.push(change), onError: error => errors.push(error), onNote: note => notes.push(note) });
  controller.setPage(1, viewport());
  function pointer(name, x, y, extra = {}) {
    stage.listeners[name]({ button: 0, pointerId: 1, clientX: x + 20, clientY: y + 40, target: stage,
      preventDefault() {}, ...extra });
  }
  return { controller, stage, layer, pointer, data, writes, errors, changes, notes, fail(value) { failure = value; } };
}

test('PDF rectangles remain at the same document location through all rotations and zoom levels', () => {
  const stored = { x: 104.5, y: 650.25, width: 159, height: 26.5 };
  for (const rotation of [0, 90, 180, 270]) for (const scale of [0.5, 1, 2.5]) {
    const view = viewport(rotation, scale);
    const roundtrip = screenRectToPdf(view, pdfRectToScreen(view, stored));
    for (const dimension of Object.keys(stored)) assert.ok(Math.abs(roundtrip[dimension] - stored[dimension]) < 1e-8);
  }
});

test('scanned PDF rectangle highlights persist in PDF coordinates and restore separately for each document', async () => {
  const session = setup();
  await session.controller.load(documentA);
  session.controller.setTool('highlight');
  session.pointer('pointerdown', 100, 140);
  session.pointer('pointermove', 280, 170);
  session.pointer('pointerup', 280, 170);
  await session.controller.flush();
  assert.deepEqual(session.data[key(documentA)].items[0].rects, [{ x: 130, y: 680, width: 180, height: 30 }]);
  await session.controller.load(documentB);
  assert.equal(session.controller.getAll().length, 0);
  session.controller.addNote({ point: [90, 200], text: 'second document' });
  await session.controller.flush();
  await session.controller.load(documentA);
  assert.equal(session.controller.getAll().length, 1);
  assert.equal(session.controller.getAll()[0].type, 'highlight');
  assert.equal(session.data[key(documentB)].items[0].text, 'second document');
  assert.equal(session.changes.at(-1).saveState, 'saved');
});

test('text selection uses the on-page range geometry without reading or reflowing its text', async () => {
  const session = setup();
  await session.controller.load(documentA);
  const inside = { inside: true };
  const range = { collapsed: false, startContainer: inside, endContainer: inside,
    getClientRects: () => [{ left: 70, top: 120, right: 190, bottom: 140 }, { left: 70, top: 120, right: 190, bottom: 140 }, { left: 70, top: 145, right: 210, bottom: 165 }],
    toString() { throw new Error('Text must not be extracted'); }
  };
  assert.equal(session.controller.selectText({ rangeCount: 1, getRangeAt: () => range }), true);
  assert.deepEqual(session.controller.getAll()[0].rects, [
    { x: 80, y: 750, width: 120, height: 20 }, { x: 80, y: 725, width: 140, height: 20 }
  ]);
  session.controller.setTool('underline');
  assert.equal(session.controller.selectText(range), true);
  assert.equal(session.controller.getAll().length, 3);
  assert.equal(session.controller.undo(), true);
  assert.equal(session.controller.getAll().length, 1, 'both underlines undo as one selection');
  await session.controller.flush();
});

test('undo and redo retain annotations on other pages and new mutations clear the redo history', async () => {
  const session = setup();
  await session.controller.load(documentA);
  session.controller.addNote({ point: [90, 200], text: 'first' });
  session.controller.setPage(2, viewport(90, 2));
  session.controller.addNote({ point: [150, 350], text: 'second' });
  session.controller.clearPage();
  assert.deepEqual(session.controller.getAll().map(item => item.text), ['first']);
  assert.equal(session.controller.undo(), true);
  assert.equal(session.controller.getPageItems()[0].text, 'second');
  assert.equal(session.controller.redo(), true);
  assert.equal(session.controller.getPageItems().length, 0);
  session.controller.undo();
  session.controller.addNote({ point: [250, 400], text: 'third' });
  assert.equal(session.controller.redo(), false);
  await session.controller.flush();
  assert.deepEqual(session.data[key(documentA)].items.map(item => item.text), ['first', 'second', 'third']);
});

test('a failed save preserves editable annotations and blocks losing them on document switch until a retry succeeds', async () => {
  const session = setup({ failWrites: true });
  await session.controller.load(documentA);
  session.controller.addNote({ point: [90, 200], text: 'keep this note' });
  await assert.rejects(session.controller.flush(), /storage full/);
  assert.equal(session.changes.at(-1).saveState, 'error');
  await assert.rejects(session.controller.load(documentB), /storage full/);
  assert.equal(session.controller.getAll()[0].text, 'keep this note');
  session.fail(false);
  await session.controller.load(documentB);
  assert.equal(session.data[key(documentA)].items[0].text, 'keep this note');
  assert.equal(session.controller.getAll().length, 0);
});

test('the newest document wins when storage reads finish out of order', async () => {
  let releaseA;
  const session = setup({ get: async (name, data) => {
    if (name === key(documentA)) await new Promise(resolve => { releaseA = resolve; });
    return { [name]: data[name] };
  } });
  const first = session.controller.load(documentA);
  await Promise.resolve();
  await Promise.resolve();
  const second = session.controller.load(documentB);
  await second;
  releaseA();
  assert.equal(await first, false);
  session.controller.addNote({ point: [90, 200], text: 'newest' });
  await session.controller.flush();
  assert.equal(session.data[key(documentB)].items[0].text, 'newest');
  assert.equal(session.data[key(documentA)], undefined);
});

test('a caller token prevents committing an obsolete load before the next document starts reading its annotations', async () => {
  let releaseA;
  let current = true;
  const original = { id: 'keep', page: 1, type: 'note', color: '#112233', width: 2, point: [90, 200], text: 'current document' };
  const session = setup({ initial: { [key(documentB)]: { items: [original] } }, get: async (name, data) => {
    if (name === key(documentA)) await new Promise(resolve => { releaseA = resolve; });
    return { [name]: data[name] };
  } });
  await session.controller.load(documentB);
  const pending = session.controller.load(documentA, { isCurrent: () => current });
  await Promise.resolve();
  await Promise.resolve();
  current = false;
  releaseA();
  assert.equal(await pending, false);
  assert.deepEqual(session.controller.getAll(), [original]);
  session.controller.addNote({ point: [100, 250], text: 'still current' });
  await session.controller.flush();
  assert.equal(session.data[key(documentB)].items.length, 2);
  assert.equal(session.data[key(documentA)], undefined);
});

test('note clicks pass PDF coordinates and persisted text cannot inject SVG markup', async () => {
  const session = setup();
  await session.controller.load(documentA);
  session.controller.setTool('note');
  session.pointer('pointerdown', 100, 140);
  session.pointer('pointerup', 100, 140);
  assert.deepEqual(session.notes[0], { point: [130, 710] });
  session.controller.addNote({ ...session.notes[0], text: '<script>bad()</script>' });
  const title = session.layer.children[0].children[0];
  assert.equal(title.textContent, '<script>bad()</script>');
  assert.equal(title.children.length, 0);
  await session.controller.flush();
});

test('closed pen strokes remain valid and cancelling a draft never adds an annotation', async () => {
  const session = setup();
  await session.controller.load(documentA);
  session.controller.setTool('pen');
  session.pointer('pointerdown', 100, 140);
  session.pointer('pointermove', 140, 140);
  session.pointer('pointermove', 140, 180);
  session.pointer('pointermove', 100, 180);
  session.pointer('pointerup', 100, 140);
  assert.equal(session.controller.getAll().length, 1);
  assert.equal(session.controller.getAll()[0].points.length, 5);
  session.pointer('pointerdown', 200, 140);
  session.pointer('pointermove', 250, 180);
  session.pointer('pointercancel', 250, 180);
  assert.equal(session.controller.getAll().length, 1);
  await session.controller.flush();
});

test('saved annotation validation ignores malformed and duplicate records', () => {
  const valid = { id: 'first', page: 1, type: 'pen', color: '#112233', width: 2, points: [[30, 50], [90, 100]] };
  const result = sanitizeItems([valid, valid, { ...valid, id: 'bad', points: [[NaN, 5]] }, { ...valid, id: 'other', page: -1 },
    { id: 'note', page: 1, type: 'note', point: [90, 200], text: 'hello', color: 'url(bad)', width: Infinity }]);
  assert.equal(result.length, 2);
  assert.equal(result[1].color, '#facc15');
  assert.equal(result[1].width, 2);
});
