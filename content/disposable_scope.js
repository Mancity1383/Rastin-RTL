/**
 * DisposableScope - Resource tracking scope with instrumentation counters.
 * Ensures zero leftover listeners, observers, timers, RAFs, and idle callbacks upon teardown.
 */
(function (global) {
  'use strict';

  if (global.DisposableScope) return;

  class DisposableScope {
    constructor(scopeName = 'default') {
      this.name = scopeName;
      this._listeners = new Set();
      this._observers = new Set();
      this._timers = new Set();
      this._rafs = new Set();
      this._idles = new Set();
      this._cleanups = new Set();

      this.stats = {
        listeners: 0,
        observers: 0,
        timers: 0,
        rafs: 0,
        idleCallbacks: 0,
        cleanups: 0
      };
    }

    addEventListener(target, type, listener, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, listener, options);
      const entry = { target, type, listener, options };
      this._listeners.add(entry);
      this.stats.listeners = this._listeners.size;
      return () => this.removeEventListener(target, type, listener, options);
    }

    removeEventListener(target, type, listener, options) {
      if (!target || typeof target.removeEventListener !== 'function') return;
      target.removeEventListener(type, listener, options);
      for (const entry of this._listeners) {
        if (entry.target === target && entry.type === type && entry.listener === listener) {
          this._listeners.delete(entry);
          break;
        }
      }
      this.stats.listeners = this._listeners.size;
    }

    observe(observer, target, options) {
      if (!observer || typeof observer.observe !== 'function' || !target) return;
      observer.observe(target, options);
      this._observers.add(observer);
      this.stats.observers = this._observers.size;
      return observer;
    }

    setTimeout(fn, delay, ...args) {
      const id = global.setTimeout(() => {
        this._timers.delete(id);
        this.stats.timers = this._timers.size;
        fn(...args);
      }, delay);
      this._timers.add(id);
      this.stats.timers = this._timers.size;
      return id;
    }

    clearTimeout(id) {
      if (!id) return;
      global.clearTimeout(id);
      this._timers.delete(id);
      this.stats.timers = this._timers.size;
    }

    setInterval(fn, delay, ...args) {
      const id = global.setInterval(fn, delay, ...args);
      this._timers.add(id);
      this.stats.timers = this._timers.size;
      return id;
    }

    clearInterval(id) {
      if (!id) return;
      global.clearInterval(id);
      this._timers.delete(id);
      this.stats.timers = this._timers.size;
    }

    requestAnimationFrame(fn) {
      const id = global.requestAnimationFrame((time) => {
        this._rafs.delete(id);
        this.stats.rafs = this._rafs.size;
        fn(time);
      });
      this._rafs.add(id);
      this.stats.rafs = this._rafs.size;
      return id;
    }

    cancelAnimationFrame(id) {
      if (!id) return;
      global.cancelAnimationFrame(id);
      this._rafs.delete(id);
      this.stats.rafs = this._rafs.size;
    }

    requestIdleCallback(fn, options) {
      if (typeof global.requestIdleCallback !== 'function') {
        return this.setTimeout(fn, 1);
      }
      const id = global.requestIdleCallback((deadline) => {
        this._idles.delete(id);
        this.stats.idleCallbacks = this._idles.size;
        fn(deadline);
      }, options);
      this._idles.add(id);
      this.stats.idleCallbacks = this._idles.size;
      return id;
    }

    cancelIdleCallback(id) {
      if (!id) return;
      if (typeof global.cancelIdleCallback === 'function') {
        global.cancelIdleCallback(id);
      } else {
        global.clearTimeout(id);
      }
      this._idles.delete(id);
      this.stats.idleCallbacks = this._idles.size;
    }

    addCleanup(fn) {
      if (typeof fn === 'function') {
        this._cleanups.add(fn);
        this.stats.cleanups = this._cleanups.size;
      }
    }

    dispose() {
      // 1. Remove listeners
      for (const entry of this._listeners) {
        try {
          entry.target.removeEventListener(entry.type, entry.listener, entry.options);
        } catch {}
      }
      this._listeners.clear();

      // 2. Disconnect observers
      for (const obs of this._observers) {
        try {
          obs.disconnect();
        } catch {}
      }
      this._observers.clear();

      // 3. Clear timers
      for (const id of this._timers) {
        try {
          global.clearTimeout(id);
          global.clearInterval(id);
        } catch {}
      }
      this._timers.clear();

      // 4. Cancel RAFs
      for (const id of this._rafs) {
        try {
          global.cancelAnimationFrame(id);
        } catch {}
      }
      this._rafs.clear();

      // 5. Cancel idle callbacks
      for (const id of this._idles) {
        try {
          if (typeof global.cancelIdleCallback === 'function') {
            global.cancelIdleCallback(id);
          } else {
            global.clearTimeout(id);
          }
        } catch {}
      }
      this._idles.clear();

      // 6. Execute custom cleanups
      for (const cleanup of this._cleanups) {
        try {
          cleanup();
        } catch {}
      }
      this._cleanups.clear();

      // Update counters
      this.stats.listeners = 0;
      this.stats.observers = 0;
      this.stats.timers = 0;
      this.stats.rafs = 0;
      this.stats.idleCallbacks = 0;
      this.stats.cleanups = 0;
    }
  }

  global.DisposableScope = DisposableScope;
})(typeof window !== 'undefined' ? window : globalThis);
