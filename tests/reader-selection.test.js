import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadingWords } from '../reader/selection.js';

function fragment(text, x, { y = 10, width = 12, height = 20, dir = 'rtl', node = {},
  leadingSpace = false, trailingSpace = false, rect } = {}) {
  const frame = { x, y, width, height };
  return { node, start: 0, end: text.length, text, dir, frame,
    rect: rect || { ...frame }, leadingSpace, trailingSpace };
}

test('separate Persian glyph spans join by reading position regardless of their DOM order', () => {
  const glyphs = ['س', 'ل', 'ا', 'م'].map((text, index) => fragment(text, 100 - index * 12));
  for (const order of [glyphs, [...glyphs].reverse(), [glyphs[2], glyphs[0], glyphs[3], glyphs[1]]]) {
    const words = buildReadingWords(order);
    assert.equal(words.length, 1);
    assert.equal(words[0].text, 'سلام');
    assert.deepEqual(words[0].parts.map(part => part.text), ['س', 'ل', 'ا', 'م']);
    assert.deepEqual(words[0].frame, { x: 64, y: 10, width: 48, height: 20 });
  }
});

test('Persian presentation glyphs normalize after spatial joining', () => {
  const words = buildReadingWords([fragment('ﻡ', 64), fragment('ﺍ', 76), fragment('ﻟ', 88), fragment('ﺳ', 100)]);
  assert.equal(words[0].text, 'سلام');
});

test('glyph joins tolerate tiny font-relative gaps but preserve real word gaps', () => {
  const words = buildReadingWords([fragment('ا', 60), fragment('ل', 85), fragment('س', 100)]);
  assert.deepEqual(words.map(word => word.text), ['سل', 'ا']);
  assert.equal(words[0].parts.length, 2, 'a 3px gap joins 20px-high glyphs');
  const scaled = buildReadingWords([
    fragment('س', 50, { height: 10, width: 6 }), fragment('ل', 42.5, { height: 10, width: 6 })
  ]);
  assert.equal(scaled.length, 1, 'the tolerance scales with glyph height');
});

test('explicit whitespace and word boundaries in one node prevent accidentally joining adjacent words', () => {
  for (const spaces of [{ trailingSpace: true }, { leadingSpace: true }]) {
    const first = fragment('دنیا', 200, { width: 40, trailingSpace: spaces.trailingSpace });
    const second = fragment('سلام', 160, { width: 40, leadingSpace: spaces.leadingSpace });
    assert.deepEqual(buildReadingWords([second, first]).map(word => word.text), ['دنیا', 'سلام']);
  }
  const node = {};
  const first = fragment('machine', 0, { width: 70, dir: 'ltr', node });
  const second = fragment('learning', 70, { width: 75, dir: 'ltr', node });
  second.start = 8; second.end = 16;
  assert.deepEqual(buildReadingWords([second, first]).map(word => word.text), ['machine', 'learning']);
});

test('English runs embedded in a Persian line retain their own left-to-right reading order', () => {
  const parts = [
    fragment('فارسی', 510, { width: 55 }), fragment('این', 470, { width: 25 }),
    fragment('PDF', 365, { width: 30, dir: 'ltr' }), fragment('reader', 405, { width: 50, dir: 'ltr' }),
    fragment('برای', 300, { width: 50 }), fragment('خواندن', 230, { width: 60 })
  ];
  assert.deepEqual(buildReadingWords([...parts].reverse()).map(word => word.text),
    ['فارسی', 'این', 'PDF', 'reader', 'برای', 'خواندن']);
  assert.deepEqual(buildReadingWords([
    fragment('world', 100, { width: 50, dir: 'ltr' }), fragment('علی', 60, { width: 30 }),
    fragment('Hello', 0, { width: 50, dir: 'ltr' })
  ]).map(word => word.text), ['Hello', 'علی', 'world']);
});

test('columns get distinct block geometry so selecting one column can exclude its neighbor', () => {
  const parts = [
    fragment('سلام', 520, { width: 40 }), fragment('دوستان', 435, { width: 70 }),
    fragment('Hello', 0, { width: 50, dir: 'ltr' }), fragment('world', 60, { width: 50, dir: 'ltr' }),
    fragment('ادامه', 510, { y: 40, width: 50 }), fragment('فارسی', 430, { y: 40, width: 55 }),
    fragment('Next', 0, { y: 40, width: 40, dir: 'ltr' }), fragment('line', 50, { y: 40, width: 40, dir: 'ltr' })
  ];
  const words = buildReadingWords(parts);
  assert.deepEqual(words.map(word => word.text), ['سلام', 'دوستان', 'Hello', 'world', 'ادامه', 'فارسی', 'Next', 'line']);
  assert.deepEqual(words.map(word => [word.line, word.block]), [[0, 0], [0, 0], [0, 1], [0, 1], [1, 0], [1, 0], [1, 1], [1, 1]]);
  assert.deepEqual(words[0].blockBounds, { x: 435, y: 10, width: 125, height: 20 });
  assert.deepEqual(words[2].blockBounds, { x: 0, y: 10, width: 110, height: 20 });
  assert.ok(words[2].blockBounds.x + words[2].blockBounds.width < words[0].blockBounds.x);
});

test('canonical page positions determine reading order while display rectangles retain rotation geometry', () => {
  const first = fragment('س', 100, { rect: { x: 300, y: 100, width: 20, height: 12 } });
  const second = fragment('ل', 88, { rect: { x: 300, y: 88, width: 20, height: 12 } });
  const words = buildReadingWords([second, first]);
  assert.equal(words[0].text, 'سل');
  assert.deepEqual(words[0].rect, { x: 300, y: 88, width: 20, height: 24 });
  assert.deepEqual(words[0].frame, { x: 88, y: 10, width: 24, height: 20 });
});

test('line grouping tolerates baseline differences and does not mutate the input fragment order', () => {
  const low = fragment('خط', 150, { width: 35, y: 40 });
  const upper = fragment('اول', 100, { width: 30, y: 10 });
  const raised = fragment('دوم', 150, { width: 30, y: 9 });
  const parts = [low, upper, raised];
  const original = [...parts];
  const words = buildReadingWords(parts);
  assert.deepEqual(words.map(word => [word.text, word.line]), [['دوم', 0], ['اول', 0], ['خط', 1]]);
  assert.deepEqual(parts, original);
  assert.deepEqual(words.map(word => word.index), [0, 1, 2]);
  assert.deepEqual(buildReadingWords([]), []);
});
