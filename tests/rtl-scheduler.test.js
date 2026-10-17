import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const constants = fs.readFileSync(new URL('../content/constants.js', import.meta.url), 'utf8');
const orchestrator = fs.readFileSync(new URL('../content/main.js', import.meta.url), 'utf8');

// Exercise the actual orchestration with deterministic scan costs. Browser
// coverage verifies text/layout; these checks verify scheduling and cancellation
// without relying on machine speed or Chromium's idle callback timing.
function session({ unitCost = 2, incremental = true, highlightEnabled = false, messageScheduling = false, frameScheduling = false, inputPending = false } = {}) {
  let now = 0, sequence = 0, nodeSequence = 0;
  const timers = new Map(), idles = new Map(), messages = new Map(), frames = new Map(), listeners = new Map(), scans = [], notifications = [], finalized = [];
  let prunes = 0, restores = 0;
  const Node = {
    ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11,
    DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4
  };
  function element(id, { tagName = 'P', parent = null, units = 1 } = {}) {
    const attributes = new Map(), classes = new Set(), order = nodeSequence++;
    return {
      id, tagName, nodeType: Node.ELEMENT_NODE, parentElement: parent,
      isConnected: true, units, textContent: 'متن فارسی',
      classList: { contains(name) { return classes.has(name); }, add(name) { classes.add(name); } },
      hasAttribute(name) { return attributes.has(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, value); },
      matches(selector) {
        return selector.split(',').some(part => {
          const token = part.trim();
          if (token.startsWith('#')) return token.slice(1) === this.id;
          if (token.startsWith('.')) return classes.has(token.slice(1));
          const prefix = /^\[id\^="([^"]+)"\]$/.exec(token);
          if (prefix) return this.id.startsWith(prefix[1]);
          const attribute = /^\[([^\]]+)\]$/.exec(token);
          return attribute ? attributes.has(attribute[1]) : token.toUpperCase() === this.tagName;
        });
      },
      getRootNode() { return document; },
      closest(selector) {
        for (let current = this; current; current = current.parentElement) {
          if (current.matches(selector)) return current;
        }
        return null;
      },
      contains(other) {
        for (let current = other; current; current = current.parentElement) if (current === this) return true;
        return false;
      },
      compareDocumentPosition(other) {
        return order < other.order ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING;
      },
      order
    };
  }
  const body = element('body', { tagName: 'BODY' });
  const document = {
    body, documentElement: element('html', { tagName: 'HTML' }),
    readyState: 'complete', contentType: 'text/html',
    hidden: false,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const scope = {
    Node, URL, console: { warn() {}, log() {} },
    performance: { now: () => now },
    navigator: { scheduling: { isInputPending: () => inputPending } },
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback(callback) { const id = ++sequence; idles.set(id, callback); return id; },
    cancelIdleCallback(id) { idles.delete(id); },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    document, localStorage: { setItem() {} },
    window: { RtlFixer: {}, location: new URL('https://example.com/'), addEventListener() {} },
    chrome: {
      runtime: { id: 'scheduler-test', onMessage: { addListener() {} } },
      storage: { local: { get() {}, set() {} }, onChanged: { addListener() {} } }
    }
  };
  if (messageScheduling) scope.MessageChannel = class {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = { postMessage: data => messages.set(++sequence, () => this.port1.onmessage({ data })) };
    }
  };
  if (frameScheduling) {
    scope.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
    scope.cancelAnimationFrame = id => frames.delete(id);
  }
  vm.runInNewContext(constants, scope, { filename: 'content/constants.js' });
  const runtime = scope.window.RtlFixer;
  Object.assign(runtime, {
    getInlineProseOwner: () => null,
    isProseBlockElement: node => node.tagName === 'P',
    pruneDisconnectedState() { prunes++; },
    notifyHighlightMutations(records) { notifications.push(...records); },
    requestRestore() { restores++; },
    scanAndProcess(node) { scans.push(node.id); now += unitCost; }
  });
  if (incremental) runtime.scanAndProcessSteps = function* (node) {
    try {
      for (let unit = 0; unit < node.units; unit++) {
        scans.push(node.id); now += unitCost; yield;
      }
    } finally { finalized.push(node.id); }
  };
  vm.runInNewContext(orchestrator, scope, { filename: 'content/main.js' });
  runtime._isActive = true;
  runtime.config.enabled = true;
  runtime.config.highlightEnabled = highlightEnabled;
  runtime.startObserver();
  function runNext(queue) {
    const item = queue.entries().next().value;
    if (!item) return false;
    queue.delete(item[0]);
    item[1]({ didTimeout: true, timeRemaining: () => 50 });
    return true;
  }
  return {
    runtime, scans, notifications, finalized, body, element,
    text(parent, value = 'متن فارسی') { return { nodeType: Node.TEXT_NODE, parentElement: parent, isConnected: true, textContent: value }; },
    mutate(records) { runtime.handlePageMutations(records); },
    runTimer() { return runNext(timers); },
    runMessage() { return runNext(messages); },
    runFrame() { return runNext(frames); },
    visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.(); },
    emit(name, event = {}) { listeners.get(name)?.(event); },
    focus(input) { document.activeElement = input; },
    advance(ms) { now += ms; },
    runIdle() { return runNext(idles); },
    flushTimers() { for (let guard = 0; timers.size; guard++) { assert.ok(guard < 1000, 'scheduler must drain'); runNext(timers); } },
    flushMessages() { for (let guard = 0; messages.size; guard++) { assert.ok(guard < 1000, 'message scheduler must drain'); runNext(messages); } },
    get pendingTimers() { return timers.size; },
    get pendingFrames() { return frames.size; },
    get pendingIdles() { return idles.size; },
    get prunes() { return prunes; },
    get restores() { return restores; }
  };
}

test('one large scan yields between units and eventually processes every unit', () => {
  const audit = session();
  audit.runtime.enqueueScan(audit.element('large-chat', { units: 12 }));
  assert.equal(audit.scans.length, 0, 'queueing must leave the current event responsive');
  assert.equal(audit.runTimer(), true);
  assert.ok(audit.scans.length > 0 && audit.scans.length < 12, 'a large subtree must span multiple tasks');
  assert.ok(audit.pendingTimers > 0, 'unfinished work must retain a scheduled continuation');
  audit.flushTimers();
  assert.equal(audit.scans.length, 12);
});

test('cheap units also yield after a bounded count instead of monopolizing a task', () => {
  const audit = session({ unitCost: 0 });
  audit.runtime.enqueueScan(audit.element('cheap-chat', { units: 1200 }));
  audit.runTimer();
  assert.ok(audit.scans.length > 0 && audit.scans.length <= 500);
  audit.flushTimers();
  assert.equal(audit.scans.length, 1200);
});

test('streamed edits start promptly in one task and large scans yield to a frame', () => {
  const audit = session({ frameScheduling: true, messageScheduling: true });
  const message = audit.element('streaming-frame', { units: 12 });
  for (let i = 0; i < 100; i++) audit.runtime.enqueueScan(message);
  assert.equal(audit.pendingFrames, 0);
  assert.equal(audit.scans.length, 0);
  assert.equal(audit.runMessage(), true, 'small edits need not wait for another frame');
  assert.equal(audit.scans.length, 3, 'six milliseconds leave time for paint and input');
  assert.equal(audit.pendingFrames, 1);
  assert.equal(audit.runMessage(), false, 'continuations must not spin posted tasks');
  while (audit.runFrame()) { /* drain successive real work slices */ }
  assert.equal(audit.scans.length, 12);
});

test('a hidden tab pauses a retained scan and processes the latest content on return', () => {
  const audit = session({ frameScheduling: true });
  audit.runtime.enqueueScan(audit.element('retained-scan', { units: 10 }));
  audit.runFrame();
  const beforeHide = audit.scans.length;
  audit.visibility(true);
  assert.equal(audit.pendingFrames, 0);
  audit.runtime.enqueueScan(audit.element('new-background-message'));
  assert.equal(audit.pendingFrames, 0);
  assert.equal(audit.scans.length, beforeHide);
  audit.visibility(false);
  while (audit.runFrame()) { /* resume without dropping the active iterator */ }
  assert.equal(audit.scans.filter(id => id === 'retained-scan').length, 10);
  assert.equal(audit.scans.at(-1), 'new-background-message');
});

test('background queue growth collapses to one document scan without replaying detached roots', () => {
  const audit = session({ frameScheduling: true, unitCost: 0 });
  audit.visibility(true);
  for (let i = 0; i < 2500; i++) audit.runtime.enqueueScan(audit.element('lazy-' + i));
  assert.equal(audit.pendingFrames, 0);
  audit.visibility(false);
  while (audit.runFrame()) { /* the fresh document scan discovers live roots */ }
  assert.deepEqual(audit.scans, ['html']);
});

test('stopping while hidden cannot revive a discarded scan on visibility changes', () => {
  const audit = session({ frameScheduling: true });
  audit.runtime.enqueueScan(audit.element('cancelled-frame', { units: 12 }));
  audit.runFrame();
  audit.visibility(true);
  audit.runtime.stopObserver();
  const count = audit.scans.length;
  audit.visibility(false);
  assert.equal(audit.pendingFrames, 0);
  assert.equal(audit.scans.length, count);
  assert.deepEqual(audit.finalized, ['cancelled-frame']);
});

test('a new mutation arriving during a paused scan is retained', () => {
  const audit = session();
  audit.runtime.enqueueScan(audit.element('first-chat', { units: 8 }));
  audit.runTimer();
  audit.runtime.enqueueScan(audit.element('new-message', { units: 3 }));
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'first-chat').length, 8);
  assert.equal(audit.scans.filter(id => id === 'new-message').length, 3);
});

test('updates to a future queued message do not schedule a second stale scan', () => {
  const audit = session();
  const first = audit.element('active-message', { units: 12 });
  const future = audit.element('future-message', { units: 3 });
  audit.runtime.enqueueScan(first);
  audit.runtime.enqueueScan(future);
  audit.runTimer();
  for (let update = 0; update < 100; update++) audit.runtime.enqueueScan(future);
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'active-message').length, 12);
  assert.equal(audit.scans.filter(id => id === 'future-message').length, 3,
    'unstarted scans must read the current DOM once instead of replaying the same message');
});

test('updates to the active message still retain a follow-up scan', () => {
  const audit = session();
  const active = audit.element('changing-active-message', { units: 12 });
  audit.runtime.enqueueScan(active);
  audit.runTimer();
  audit.runtime.enqueueScan(active);
  audit.flushTimers();
  assert.equal(audit.scans.length, 24,
    'a mutation behind a paused traversal cursor must receive a fresh scan');
});

test('a subtree detached between slices is abandoned while its replacement is processed', () => {
  const audit = session();
  const removed = audit.element('removed-chat', { units: 12 });
  audit.runtime.enqueueScan(removed);
  audit.runTimer();
  const completed = audit.scans.length;
  removed.isConnected = false;
  audit.runtime.enqueueScan(audit.element('replacement-chat', { units: 3 }));
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'removed-chat').length, completed);
  assert.equal(audit.scans.filter(id => id === 'replacement-chat').length, 3);
  assert.ok(audit.finalized.includes('removed-chat'), 'detached scans must release their retained traversal state');
});

test('stopping cancels a paused scan and does not replay it on re-enable', () => {
  const audit = session();
  audit.runtime.enqueueScan(audit.element('cancelled-chat', { units: 12 }));
  audit.runTimer();
  const completed = audit.scans.length;
  audit.runtime.stopObserver();
  assert.deepEqual(audit.finalized, ['cancelled-chat'], 'cancellation must close the iterator and release its per-scan state');
  assert.equal(audit.pendingTimers, 0);
  assert.equal(audit.pendingIdles, 0);
  audit.flushTimers();
  assert.equal(audit.scans.length, completed);
  audit.runtime.startObserver();
  audit.runtime.enqueueScan(audit.element('new-chat', { units: 2 }));
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'cancelled-chat').length, completed);
  assert.equal(audit.scans.filter(id => id === 'new-chat').length, 2);
});

test('an obsolete posted message cannot resume or steal a new scan after cancellation', () => {
  const audit = session({ messageScheduling: true });
  audit.runtime.enqueueScan(audit.element('old-chat', { units: 12 }));
  audit.runMessage();
  const completed = audit.scans.length;
  audit.runtime.stopObserver();
  audit.runtime.startObserver();
  audit.runtime.enqueueScan(audit.element('replacement-chat', { units: 2 }));
  // MessageChannel cannot retract an already posted continuation. Its sequence
  // must be checked when delivered, after the replacement was scheduled.
  audit.runMessage();
  assert.equal(audit.scans.length, completed);
  audit.flushMessages();
  assert.equal(audit.scans.filter(id => id === 'old-chat').length, completed);
  assert.equal(audit.scans.filter(id => id === 'replacement-chat').length, 2);
  assert.equal(audit.pendingTimers, 0, 'the channel path should not incur nested timer delays');
});

test('without an incremental scanner the scheduler still processes a root', () => {
  const audit = session({ incremental: false });
  audit.runtime.enqueueScan(audit.element('fallback'));
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['fallback']);
});

test('own text conversion avoids an RTL rescan but still invalidates highlight indexes', () => {
  const audit = session({ highlightEnabled: true });
  const parent = audit.element('converted');
  const text = audit.text(parent, 'شماره 123');
  audit.runtime.recordOwnTextWrite(text, 'شماره ۱۲۳');
  text.textContent = 'شماره ۱۲۳';
  const record = { type: 'characterData', target: text, oldValue: 'شماره 123' };
  audit.mutate([record]);
  audit.flushTimers();
  assert.equal(audit.scans.length, 0);
  assert.equal(audit.runtime._domMutationVersion, 1);
  assert.deepEqual(audit.notifications, [record]);
  assert.equal(audit.restores, 1, 'changed highlight anchors must still receive a restore after owned text writes');
});

test('an external text mutation interleaved with a tracked conversion is processed', () => {
  const audit = session();
  const own = audit.text(audit.element('converted'), 'شماره 123');
  const externalParent = audit.element('external-message');
  const external = audit.text(externalParent, 'پاسخ فارسی تازه');
  audit.runtime.recordOwnTextWrite(own, 'شماره ۱۲۳');
  own.textContent = 'شماره ۱۲۳';
  audit.mutate([{ type: 'characterData', target: own, oldValue: 'شماره 123' }, { type: 'characterData', target: external, oldValue: 'انتظار پاسخ' }]);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['external-message']);
});

test('a same-node own, site, own mutation chain preserves the site update', () => {
  const audit = session({ highlightEnabled: true });
  const parent = audit.element('streaming-paragraph');
  const text = audit.text(parent, 'شماره 123');
  audit.runtime.recordOwnTextWrite(text, 'شماره ۱۲۳');
  text.textContent = 'شماره ۱۲۳';
  const firstOwn = { type: 'characterData', target: text, oldValue: 'شماره 123' };
  text.textContent = 'پیام تازه 456';
  const siteWrite = { type: 'characterData', target: text, oldValue: 'شماره ۱۲۳' };
  audit.runtime.recordOwnTextWrite(text, 'پیام تازه ۴۵۶');
  text.textContent = 'پیام تازه ۴۵۶';
  const finalOwn = { type: 'characterData', target: text, oldValue: 'پیام تازه 456' };
  audit.mutate([firstOwn, siteWrite, finalOwn]);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['streaming-paragraph']);
  assert.deepEqual(audit.notifications, [firstOwn, siteWrite, finalOwn]);
});

test('a site rewrite to the same final text cannot consume a stale tracked write', () => {
  const audit = session();
  const parent = audit.element('site-rewrite');
  const text = audit.text(parent, '123');
  audit.runtime.recordOwnTextWrite(text, '۱۲۳');
  text.textContent = '۱۲۳';
  audit.mutate([{ type: 'characterData', target: text, oldValue: '123' }]);
  audit.flushTimers();
  assert.equal(audit.scans.length, 0);
  // A later site write happens to end with the same value but starts elsewhere.
  // It is a new mutation, not the earlier conversion.
  text.textContent = '۱۲۳';
  audit.mutate([{ type: 'characterData', target: text, oldValue: 'متن جدید' }]);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['site-rewrite']);
});

test('own wrapper replacement avoids rescans and global pruning while notifying highlights', () => {
  const audit = session({ highlightEnabled: true });
  const parent = audit.element('bionic-message');
  const added = audit.element('bionic-wrapper', { tagName: 'SPAN', parent });
  const removed = audit.text(parent);
  removed.parentElement = null; removed.isConnected = false;
  audit.runtime.recordOwnChildListWrite(parent, [added], [removed]);
  const record = { type: 'childList', target: parent, addedNodes: [added], removedNodes: [removed] };
  audit.mutate([record]);
  audit.flushTimers();
  assert.equal(audit.scans.length, 0);
  assert.equal(audit.pendingIdles, 0);
  assert.equal(audit.prunes, 0);
  assert.equal(audit.runtime._domMutationVersion, 1);
  assert.equal(audit.runtime._domStructureMutationVersion || 0, 0);
  assert.deepEqual(audit.notifications, [record]);
});

test('a superficially similar external insertion is not mistaken for an own replacement', () => {
  const audit = session();
  const parent = audit.element('paragraph');
  const ownAdded = audit.element('same-id', { tagName: 'SPAN', parent });
  const externalAdded = audit.element('same-id', { tagName: 'SPAN', parent });
  audit.runtime.recordOwnChildListWrite(parent, [ownAdded], []);
  audit.mutate([{ type: 'childList', target: parent, addedNodes: [externalAdded], removedNodes: [] }]);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['same-id']);
});

test('a site direction reset is rescanned while the own direction write is ignored', () => {
  const audit = session();
  const parent = audit.element('react-paragraph');
  parent.setAttribute('dir', 'rtl');
  audit.runtime._originalElementState = new WeakMap([[parent, { writtenDir: { hadDir: true, value: 'rtl' } }]]);
  const record = { type: 'attributes', target: parent, attributeName: 'dir' };
  audit.mutate([record]); audit.flushTimers();
  assert.equal(audit.scans.length, 0);
  parent.setAttribute('dir', 'auto');
  audit.mutate([record]); audit.flushTimers();
  assert.deepEqual(audit.scans, ['react-paragraph']);
});

test('real removals coalesce one idle prune and stopping cancels that prune', () => {
  const audit = session();
  const parent = audit.element('chat');
  const removed = audit.element('removed', { parent }); removed.isConnected = false;
  const record = { type: 'childList', target: parent, addedNodes: [], removedNodes: [removed] };
  audit.mutate([record]); audit.mutate([record]);
  assert.equal(audit.pendingIdles, 1);
  assert.equal(audit.prunes, 0);
  audit.runIdle();
  assert.equal(audit.prunes, 1);
  audit.mutate([record]);
  audit.runtime.stopObserver();
  assert.equal(audit.pendingIdles, 0);
  assert.equal(audit.prunes, 1);
});

test('replacing ordinary streamed text rescans its paragraph without sweeping every saved element', () => {
  const audit = session({ highlightEnabled: true });
  const parent = audit.element('streaming-replacement');
  const removed = audit.text(parent, 'پاسخ قبلی'); removed.isConnected = false;
  const added = audit.text(parent, 'پاسخ جدید');
  const record = { type: 'childList', target: parent, addedNodes: [added], removedNodes: [removed] };
  for (let i = 0; i < 100; i++) audit.mutate([record]);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['streaming-replacement']);
  assert.equal(audit.pendingIdles, 0);
  assert.equal(audit.prunes, 0);
  assert.equal(audit.notifications.length, 100);
  assert.equal(audit.restores, 1);
});

test('removing a converted digit text node retains cleanup for that managed node', () => {
  const audit = session();
  const parent = audit.element('converted-message');
  const removed = audit.text(parent, 'شماره ۱۲۳'); removed.isConnected = false;
  audit.runtime._managedDigitNodes = new Set([removed]);
  audit.mutate([{ type: 'childList', target: parent, addedNodes: [], removedNodes: [removed] }]);
  assert.equal(audit.pendingIdles, 1);
  audit.runIdle();
  assert.equal(audit.prunes, 1);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['converted-message']);
});

test('extension stylesheet and font updates never count as page content changes', () => {
  const audit = session({ highlightEnabled: true });
  for (const id of ['rtl-fixer-dynamic-variables', 'rtl-fixer-font-import']) {
    const target = audit.element(id, { tagName: id.endsWith('import') ? 'LINK' : 'STYLE' });
    assert.equal(audit.runtime.isExtensionNode(target), true);
    const added = audit.text(target, 'p { color: red; }');
    audit.mutate([{ type: 'childList', target, addedNodes: [added], removedNodes: [] }]);
  }
  audit.flushTimers();
  assert.equal(audit.scans.length, 0);
  assert.equal(audit.notifications.length, 0);
  assert.equal(audit.runtime._domMutationVersion || 0, 0);
});

test('a burst of nested streaming edits resolves one message and preserves every highlight notification', () => {
  const audit = session({ highlightEnabled: true });
  const message = audit.element('streaming-message', { parent: audit.body });
  message.classList.add('rtl-fixer-target');
  const untouched = audit.element('untouched-message', { parent: audit.body });
  let parent = message, directionLookups = 0, proseLookups = 0, extensionLookups = 0;
  const chain = [message];
  for (let index = 0; index < 40; index++) {
    parent = audit.element(`inline-${index}`, { tagName: 'SPAN', parent });
    chain.push(parent);
  }
  for (const node of chain) {
    const contains = node.classList.contains;
    node.classList.contains = name => { directionLookups++; return contains(name); };
  }
  const isExtensionNode = audit.runtime.isExtensionNode;
  audit.runtime.isExtensionNode = node => { extensionLookups++; return isExtensionNode(node); };
  audit.runtime.getInlineProseOwner = () => { proseLookups++; return null; };
  const text = audit.text(parent);
  const records = Array.from({ length: 1000 }, (_, index) => ({
    type: 'characterData', target: text, oldValue: `بخش ${index}`
  }));
  audit.mutate(records);
  audit.flushTimers();
  assert.deepEqual(audit.scans, ['streaming-message']);
  assert.equal(audit.notifications.length, 1000);
  assert.ok(directionLookups <= chain.length * 2 + 2, 'UI and direction resolution must be shared within a burst');
  assert.equal(proseLookups, 1, 'the same queued message must not be classified repeatedly');
  assert.ok(extensionLookups < 10, 'duplicate text records must not repeat deep extension ancestry checks');
  assert.ok(audit.runtime.getNodeMutationVersion(message) > 0);
  assert.equal(audit.runtime.getNodeMutationVersion(untouched), 0);
});

test('content stamps follow a moved text node without invalidating unrelated or owned content', () => {
  const audit = session();
  const first = audit.element('first', { parent: audit.body });
  const second = audit.element('second', { parent: audit.body });
  const inline = audit.element('inline', { tagName: 'SPAN', parent: first });
  first.classList.add('rtl-fixer-target'); second.classList.add('rtl-fixer-target');
  const text = audit.text(inline);
  const record = { type: 'characterData', target: text, oldValue: 'قبلی' };
  audit.mutate([record]); audit.flushTimers();
  const firstVersion = audit.runtime.getNodeMutationVersion(first);
  inline.parentElement = second;
  audit.mutate([record]); audit.flushTimers();
  assert.deepEqual(audit.scans, ['first', 'second']);
  assert.equal(audit.runtime.getNodeMutationVersion(first), firstVersion);
  const secondVersion = audit.runtime.getNodeMutationVersion(second);
  assert.ok(secondVersion > firstVersion);
  audit.runtime.recordOwnTextWrite(text, 'شماره ۱۲۳');
  const oldValue = text.textContent;
  text.textContent = 'شماره ۱۲۳';
  audit.mutate([{ ...record, oldValue }]); audit.flushTimers();
  assert.equal(audit.runtime.getNodeMutationVersion(second), secondVersion);
  audit.runtime.stopObserver();
  assert.equal(audit.runtime.getNodeMutationVersion(second), 0);
});

test('structural changes stamp inserted roots once per delivery without invalidating sibling text', () => {
  const audit = session();
  const parent = audit.element('messages', { parent: audit.body });
  const inserted = audit.element('inserted', { parent });
  const moved = audit.element('moved', { parent });
  const untouched = audit.element('untouched', { parent });
  audit.mutate([inserted, moved].map(node => ({
    type: 'childList', target: parent, addedNodes: [node], removedNodes: []
  })));
  assert.equal(audit.runtime._domStructureMutationVersion, 1);
  assert.ok(audit.runtime.getNodeMutationVersion(inserted) > 0);
  assert.equal(audit.runtime.getNodeMutationVersion(inserted), audit.runtime.getNodeMutationVersion(moved));
  assert.equal(audit.runtime.getNodeMutationVersion(untouched), 0);
  const text = audit.text(inserted);
  audit.mutate([{ type: 'characterData', target: text, oldValue: 'متن قبلی' }]);
  assert.equal(audit.runtime._domStructureMutationVersion, 1, 'text-only edits retain prepared structural context');
  audit.flushTimers();
});

test('a live text mutation interrupts retained history and both scans finish', () => {
  const audit = session({ frameScheduling: true, messageScheduling: true, unitCost: 1 });
  const history = audit.element('long-history', { tagName: 'DIV', units: 100 });
  const live = audit.element('live-reply');
  audit.runtime.enqueueScan(history);
  audit.runMessage();
  assert.equal(audit.pendingFrames, 1);
  const before = audit.scans.length;
  audit.mutate([{ type: 'characterData', target: audit.text(live), oldValue: 'old reply' }]);
  assert.equal(audit.pendingFrames, 0, 'urgent work can replace a queued history frame');
  audit.runMessage();
  assert.equal(audit.scans[before], 'live-reply');
  assert.ok(audit.scans.slice(before).includes('long-history'), 'history receives the rest of the slice');
  while (audit.runFrame()) { /* finish both lanes */ }
  assert.equal(audit.scans.filter(id => id === 'long-history').length, 100);
  assert.equal(audit.scans.filter(id => id === 'live-reply').length, 1);
});

test('promoting an unstarted message removes its stale document-order scan', () => {
  const audit = session({ unitCost: 1 });
  const history = audit.element('history', { tagName: 'DIV', units: 100 });
  const future = audit.element('future-reply', { units: 10 });
  audit.runtime.enqueueScan(history);
  audit.runtime.enqueueScan(future);
  audit.runTimer();
  audit.mutate([{ type: 'characterData', target: audit.text(future), oldValue: 'previous' }]);
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'future-reply').length, 10);
  assert.equal(audit.scans.filter(id => id === 'history').length, 100);
});

test('ordinary multi-message edits retain coalescing instead of opening overlapping priority scans', () => {
  const audit = session();
  const first = audit.element('first', { units: 12 });
  const future = audit.element('future', { units: 12 });
  audit.runtime.enqueueScan(first); audit.runtime.enqueueScan(future);
  audit.runTimer();
  const mutation = { type: 'characterData', target: audit.text(future), oldValue: 'earlier' };
  audit.mutate([mutation]); audit.runTimer();
  audit.mutate([mutation]);
  audit.flushTimers();
  assert.equal(audit.scans.filter(id => id === 'first').length, 12);
  assert.equal(audit.scans.filter(id => id === 'future').length, 12);
});

test('a large urgent scan cannot starve history, including zero-cost scan steps', () => {
  for (const unitCost of [0, 1]) {
    const audit = session({ unitCost });
    audit.runtime.enqueueScan(audit.element('history', { tagName: 'DIV', units: 1000 }));
    audit.runtime.enqueueScan(audit.element('urgent', { units: 1000 }), { priority: true });
    audit.runTimer();
    assert.equal(audit.scans[0], 'urgent');
    assert.ok(audit.scans.includes('history'));
    assert.ok(audit.scans.length <= 500);
    audit.flushTimers();
    assert.equal(audit.scans.filter(id => id === 'history').length, 1000);
    assert.equal(audit.scans.filter(id => id === 'urgent').length, 1000);
  }
});

test('input pressure shortens slices while retaining progress and frame continuations', () => {
  const audit = session({ frameScheduling: true, unitCost: 1, inputPending: true });
  audit.runtime.enqueueScan(audit.element('history', { units: 20 }));
  audit.runFrame();
  assert.equal(audit.scans.length, 2);
  assert.equal(audit.pendingFrames, 1);
  while (audit.runFrame()) { /* input pressure must not abandon the backlog */ }
  assert.equal(audit.scans.length, 20);
});

test('history progresses even when a single urgent step exceeds the shortened input budget', () => {
  const audit = session({ frameScheduling: true, unitCost: 4, inputPending: true });
  audit.runtime.enqueueScan(audit.element('history', { tagName: 'DIV', units: 20 }));
  audit.runtime.enqueueScan(audit.element('urgent', { units: 20 }), { priority: true });
  audit.runFrame();
  assert.deepEqual(audit.scans, ['urgent']);
  audit.runFrame();
  assert.deepEqual(audit.scans, ['urgent', 'history']);
  while (audit.runFrame()) { /* each lane eventually finishes under sustained input */ }
  assert.equal(audit.scans.filter(id => id === 'history').length, 20);
  assert.equal(audit.scans.filter(id => id === 'urgent').length, 20);
});

test('priority starts are rate-limited and a further edit of the active urgent root is retained', () => {
  const audit = session({ frameScheduling: true, messageScheduling: true, unitCost: 1 });
  const live = audit.element('urgent', { units: 20 });
  audit.runtime.enqueueScan(live, { priority: true });
  audit.runMessage();
  audit.runtime.enqueueScan(live, { priority: true });
  assert.equal(audit.pendingFrames, 1, 'continuous edits wait for paint rather than posting endlessly');
  assert.equal(audit.runMessage(), false);
  while (audit.runFrame()) { /* a mutation behind the urgent cursor needs a fresh pass */ }
  assert.equal(audit.scans.length, 40);
});

test('hidden tabs retain priority work and disabling closes both lanes', () => {
  const audit = session({ frameScheduling: true, unitCost: 1 });
  audit.runtime.enqueueScan(audit.element('history', { tagName: 'DIV', units: 100 }));
  audit.runtime.enqueueScan(audit.element('urgent', { units: 100 }), { priority: true });
  audit.runFrame();
  audit.visibility(true);
  assert.equal(audit.pendingFrames, 0);
  audit.runtime.stopObserver();
  assert.deepEqual(new Set(audit.finalized), new Set(['history', 'urgent']));
  const count = audit.scans.length;
  audit.visibility(false);
  assert.equal(audit.pendingFrames, 0);
  assert.equal(audit.scans.length, count);
});

test('composition defers direction until the final input task and discards detached editors', () => {
  const audit = session();
  const editor = audit.element('editor', { tagName: 'TEXTAREA' });
  const applied = [];
  audit.runtime.processInputDirection = input => applied.push(input.id);
  audit.emit('compositionstart', { target: editor });
  audit.runtime.handleInputEvent({ target: editor, isComposing: true });
  assert.equal(audit.runtime.deferInputDirection(editor), true);
  assert.deepEqual(applied, []);
  audit.emit('compositionend', { target: editor });
  assert.deepEqual(applied, [], 'let the browser commit the final IME text first');
  audit.flushTimers();
  assert.deepEqual(applied, ['editor']);
  audit.emit('compositionstart', { target: editor });
  audit.runtime.handleInputEvent({ target: editor, isComposing: true });
  audit.emit('compositionend', { target: editor });
  editor.isConnected = false;
  audit.flushTimers();
  assert.deepEqual(applied, ['editor']);
});

test('a native input selection defers direction and collapse resumes without altering the range', () => {
  const audit = session();
  const editor = audit.element('selection', { tagName: 'TEXTAREA' });
  audit.focus(editor);
  editor.selectionStart = 1; editor.selectionEnd = 4;
  const applied = [];
  audit.runtime.processInputDirection = input => applied.push(input.id);
  audit.runtime.handleInputEvent({ target: editor });
  assert.deepEqual(applied, []);
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [1, 4]);
  editor.selectionStart = editor.selectionEnd;
  audit.emit('selectionchange');
  audit.flushTimers();
  assert.deepEqual(applied, ['selection']);
});

test('blurring a selected native input releases its deferred direction update', () => {
  const audit = session();
  const editor = audit.element('blurred-selection', { tagName: 'TEXTAREA' });
  editor.selectionStart = 1; editor.selectionEnd = 4;
  audit.focus(editor);
  const applied = [];
  audit.runtime.processInputDirection = input => applied.push(input.id);
  audit.runtime.handleInputEvent({ target: editor });
  assert.deepEqual(applied, []);
  audit.focus(null);
  audit.emit('focusout');
  audit.flushTimers();
  assert.deepEqual(applied, ['blurred-selection']);
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [1, 4]);
});
