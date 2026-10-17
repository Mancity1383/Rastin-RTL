import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const worker = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const start = worker.indexOf('let highlightWrites = Promise.resolve();');
const end = worker.indexOf('// Message handler', start);
assert.ok(start >= 0 && end > start, 'The highlight worker implementation must be available');
const source = worker.slice(start, end);
const key = 'rtl_fixer_hl_';
const pageA = '/C:/Documents/first.html';
const pageB = '/C:/Documents/second.html';

function setup(initial = {}, { failWrites = false } = {}) {
  const data = structuredClone(initial);
  const writes = [];
  const removals = [];
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, URL,
    chrome: { storage: { local: {
      async get(names) {
        if (names === null) return structuredClone(data);
        return Object.fromEntries((Array.isArray(names) ? names : [names])
          .filter(name => Object.hasOwn(data, name)).map(name => [name, structuredClone(data[name])]));
      },
      async set(values) {
        if (failWrites) throw new Error('Storage unavailable');
        writes.push(structuredClone(values));
        Object.assign(data, structuredClone(values));
      },
      async remove(names) {
        for (const name of Array.isArray(names) ? names : [names]) {
          removals.push(name);
          delete data[name];
        }
      }
    } } }
  });
  vm.runInContext(source, context, { filename: 'background.js:highlight-worker' });
  return {
    data, writes, removals,
    mutate(operation, bucket = key) { return context.mutateHighlights({ key: bucket, operation }); }
  };
}

function highlight(id, pageKey) {
  return { id, pageKey, url: 'file://' + pageKey, text: 'Saved local text', color: '#fef08a', timestamp: 1 };
}

test('local highlights can be added, patched and removed in the empty-host bucket', async () => {
  const second = highlight('second', pageB);
  const session = setup({ [key]: [second], unrelated: { keep: true } });
  await session.mutate({ type: 'add', item: highlight('first', pageA) });
  assert.deepEqual(session.data[key].map(item => item.id), ['second', 'first']);
  await session.mutate({ type: 'patch', id: 'first', fields: { color: '#bbf7d0' }, note: { text: 'Local note' } });
  assert.equal(session.data[key][1].color, '#bbf7d0');
  assert.equal(session.data[key][1].note.text, 'Local note');
  assert.deepEqual(session.data[key][0], second);
  await session.mutate({ type: 'remove', id: 'first' });
  assert.deepEqual(session.data[key], [second]);
  assert.deepEqual(session.data.unrelated, { keep: true });
});

test('deleting one local page preserves other files, query variants and hash routes', async () => {
  const first = highlight('first', pageA);
  const legacy = { ...highlight('legacy', pageA), url: 'file://' + pageA + '#section' };
  delete legacy.pageKey;
  const survivors = [highlight('second', pageB), highlight('query', pageA + '?version=2'), highlight('route', pageA + '#/chapter')];
  const session = setup({ [key]: [first, legacy, ...survivors] });
  await session.mutate({ type: 'deletePage', pageKey: pageA });
  assert.deepEqual(session.data[key], survivors);
});

test('legacy local highlights receive stable IDs without changing their file identity', async () => {
  const old = { url: 'file://' + pageA, text: 'Old local highlight', timestamp: 123, startPath: '/html/body/p' };
  const session = setup({ [key]: [old] });
  const migrated = await session.mutate({ type: 'migrate' });
  assert.match(migrated[0].id, /^hl_legacy_[0-9a-f]{64}$/);
  assert.equal(migrated[0].url, old.url);
  assert.equal(migrated[0].text, old.text);
  const stableId = migrated[0].id;
  const again = await session.mutate({ type: 'migrate' });
  assert.equal(again[0].id, stableId);
  assert.equal(session.writes.length, 1, 'A second migration must not rewrite unchanged data');
});

test('a local legacy bucket is removed only after a successful migration write', async () => {
  const oldKey = 'rtl_fixer_hl_www.';
  const original = { [key]: [highlight('first', pageA)], [oldKey]: [highlight('second', pageB)] };
  const failing = setup(original, { failWrites: true });
  await assert.rejects(failing.mutate({ type: 'migrate' }), /Storage unavailable/);
  assert.deepEqual(failing.data, original);
  assert.deepEqual(failing.removals, []);
  const session = setup(original);
  await session.mutate({ type: 'migrate' });
  assert.deepEqual(session.data[key].map(item => item.id), ['first', 'second']);
  assert.equal(Object.hasOwn(session.data, oldKey), false);
});

test('malformed storage keys are rejected without changing the valid local bucket', async () => {
  const original = { [key]: [highlight('first', pageA)], unrelated: 42 };
  const session = setup(original);
  for (const invalid of [null, '', 'rtl_fixer_hl', 'rtl_fixer_hl_/C:/first.html', 'rtl_fixer_hl_example.com/path', 'unrelated']) {
    await assert.rejects(session.mutate({ type: 'add', item: highlight('second', pageB) }, invalid), /Invalid highlight request/);
  }
  assert.deepEqual(session.data, original);
  assert.equal(session.writes.length, 0);
});

test('invalid local storage data and unknown operations leave original records intact', async () => {
  const malformed = setup({ [key]: { damaged: true } });
  await assert.rejects(malformed.mutate({ type: 'add', item: highlight('first', pageA) }), /Invalid highlight data/);
  assert.deepEqual(malformed.data[key], { damaged: true });
  assert.equal(malformed.writes.length, 0);
  const session = setup({ [key]: [highlight('first', pageA)] });
  await assert.rejects(session.mutate({ type: 'unknown' }), /Unknown highlight operation/);
  assert.deepEqual(session.data[key], [highlight('first', pageA)]);
  assert.equal(session.writes.length, 0);
});
