import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const constants = fs.readFileSync(fileURLToPath(new URL('../content/constants.js', import.meta.url)), 'utf8');
const orchestrator = fs.readFileSync(fileURLToPath(new URL('../content/main.js', import.meta.url)), 'utf8');

function startup({ readyState = 'complete' } = {}) {
  const storageReads = [];
  const persistence = [];
  const events = [];
  const responses = [];
  const domReady = [];
  let messageListener;
  const scope = {
    console: { warn() {}, log() {} },
    window: { RtlFixer: {}, location: { hostname: 'example.com' } },
    document: { readyState, addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady.push(callback); } },
    localStorage: { setItem() {} },
    chrome: {
      runtime: { id: 'test-extension', onMessage: { addListener(callback) { messageListener = callback; } } },
      storage: {
        local: {
          get(keys, callback) { storageReads.push(callback); },
          set(settings) { persistence.push(settings); events.push('persist'); }
        },
        onChanged: { addListener() {} }
      }
    }
  };
  vm.runInNewContext(constants, scope, { filename: 'content/constants.js' });
  const runtime = scope.window.RtlFixer;
  Object.assign(runtime, {
    initPaint() {},
    removeRtlFixes() { events.push('remove'); },
    applyStyles() { events.push('styles'); },
    initHighlight() { events.push('highlight'); }
  });
  vm.runInNewContext(orchestrator, scope, { filename: 'content/main.js' });
  // Isolate orchestration from unrelated DOM and rendering implementation.
  runtime.startObserver = () => events.push('observe');
  runtime.processPage = () => events.push('process');
  return {
    runtime, scope, events, responses, persistence, storageReads, domReady,
    send(settings) {
      return messageListener({ action: 'updateSettings', settings }, { id: 'test-extension' }, (response) => responses.push(response));
    },
    complete(storage) { storageReads.shift()(storage); }
  };
}

test('an early settings message waits for the saved baseline then applies and responds once', () => {
  const session = startup();
  assert.equal(session.send({ enabled: true, highlightEnabled: true }), true);
  assert.equal(session.runtime._isActive, false);
  assert.equal(session.responses.length, 0);
  assert.equal(session.persistence.length, 0);
  session.complete({
    enabled: true, adBlockEnabled: false, translatorApi: 'gemini', apiKeys: { gemini: 'saved-key' },
    'site_config_example.com': { enabled: false, highlightEnabled: false }
  });
  assert.equal(session.runtime.config.globalEnabled, true);
  assert.equal(session.runtime.config.globalAdBlockEnabled, false);
  assert.equal(session.runtime.config.translatorApi, 'gemini');
  assert.equal(session.runtime.config.apiKeys.gemini, 'saved-key');
  assert.equal(session.runtime._isActive, true);
  assert.equal(session.runtime.config.highlightEnabled, true);
  assert.equal(session.persistence.length, 1);
  assert.equal(session.responses.length, 1);
  assert.equal(session.responses[0].status, 'success');
  assert.ok(session.events.indexOf('remove') < session.events.indexOf('persist'));
  assert.equal(session.events.filter((event) => event === 'highlight').length, 1);
});

test('an early site-enable message respects the saved globally disabled setting', () => {
  const session = startup();
  assert.equal(session.send({ enabled: true, highlightEnabled: true }), true);
  session.complete({ enabled: false, 'site_config_example.com': { enabled: false, highlightEnabled: false } });
  assert.equal(session.runtime.config.globalEnabled, false);
  assert.equal(session.runtime.config.enabled, true);
  assert.equal(session.runtime._isActive, false);
  assert.equal(session.events.includes('highlight'), false);
  assert.equal(session.events.includes('styles'), false);
  assert.equal(session.persistence.length, 1);
  assert.equal(Object.hasOwn(session.persistence[0], 'enabled'), false);
  assert.equal(session.responses.length, 1);
  assert.equal(session.responses[0].status, 'success');
});

test('an explicit global-enable message can activate a saved disabled configuration', () => {
  const session = startup();
  session.send({ globalEnabled: true, enabled: true, highlightEnabled: true });
  session.complete({ enabled: false, 'site_config_example.com': { enabled: false } });
  assert.equal(session.runtime._isActive, true);
  assert.equal(session.runtime.config.globalEnabled, true);
  assert.equal(session.persistence.length, 1);
  assert.equal(session.persistence[0].enabled, true);
  assert.equal(session.responses.length, 1);
});

test('multiple early settings messages apply once in arrival order after initialization', () => {
  const session = startup();
  session.send({ enabled: true, highlightEnabled: true });
  session.send({ enabled: false, highlightEnabled: false });
  session.complete({ enabled: true, 'site_config_example.com': { enabled: false } });
  assert.equal(session.runtime._isActive, false);
  assert.equal(session.runtime.config.highlightEnabled, false);
  assert.equal(session.persistence.length, 2);
  assert.equal(session.persistence[0]['site_config_example.com'].enabled, true);
  assert.equal(session.persistence[1]['site_config_example.com'].enabled, false);
  assert.equal(session.responses.length, 2);
  assert.ok(session.responses.every((response) => response.status === 'success'));
});

test('early updates wait for DOM startup as well as the asynchronous storage read', () => {
  const session = startup({ readyState: 'loading' });
  session.send({ enabled: true, highlightEnabled: true });
  session.complete({ enabled: true, 'site_config_example.com': { enabled: true, highlightEnabled: false } });
  assert.equal(session.domReady.length, 1);
  assert.equal(session.responses.length, 0);
  assert.equal(session.persistence.length, 0);
  session.scope.document.readyState = 'complete';
  session.domReady[0]();
  assert.equal(session.responses.length, 1);
  assert.equal(session.persistence.length, 1);
  assert.equal(session.runtime.config.highlightEnabled, true);
  assert.ok(session.events.indexOf('process') < session.events.indexOf('persist'));
});

test('failed initial storage reads respond with an error without persisting partial defaults', () => {
  const session = startup();
  session.send({ enabled: true, highlightEnabled: true });
  session.scope.chrome.runtime.lastError = { message: 'Storage unavailable' };
  session.complete({});
  assert.equal(session.runtime._isActive, false);
  assert.equal(session.persistence.length, 0);
  assert.equal(session.responses.length, 1);
  assert.equal(session.responses[0].status, 'error');
  assert.equal(session.responses[0].error, 'settings_unavailable');
});

test('enabling an initially inactive page waits for DOM readiness before starting features', () => {
  const session = startup({ readyState: 'loading' });
  session.send({ globalEnabled: true, enabled: true, highlightEnabled: true });
  session.complete({ enabled: false, 'site_config_example.com': { enabled: false } });
  assert.equal(session.domReady.length, 1);
  assert.equal(session.responses.length, 0);
  assert.equal(session.events.includes('highlight'), false);
  session.scope.document.readyState = 'complete';
  session.domReady[0]();
  assert.equal(session.runtime._isActive, true);
  assert.equal(session.responses.length, 1);
  assert.equal(session.persistence.length, 1);
  assert.equal(session.events.filter((event) => event === 'highlight').length, 1);
});

test('a later settings update retries a transient initial storage failure and recovers', () => {
  const session = startup();
  session.send({ enabled: true, highlightEnabled: true });
  session.scope.chrome.runtime.lastError = { message: 'Temporary storage failure' };
  session.complete({});
  assert.equal(session.responses.length, 1);
  assert.equal(session.responses[0].status, 'error');
  assert.equal(session.storageReads.length, 0);
  assert.equal(session.persistence.length, 0);
  delete session.scope.chrome.runtime.lastError;
  assert.equal(session.send({ enabled: true, highlightEnabled: true }), true);
  assert.equal(session.storageReads.length, 1);
  assert.equal(session.responses.length, 1);
  session.complete({ enabled: true, 'site_config_example.com': { enabled: false } });
  assert.equal(session.storageReads.length, 0);
  assert.equal(session.runtime._isActive, true);
  assert.equal(session.runtime.config.highlightEnabled, true);
  assert.equal(session.persistence.length, 1);
  assert.equal(session.responses.length, 2);
  assert.equal(session.responses[1].status, 'success');
});