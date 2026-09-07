/**
 * NativePatchRegistry - Singleton registry for native prototype and API overrides.
 * Preserves full PropertyDescriptor and executes conditional teardown.
 */
(function (global) {
  'use strict';

  if (global.NativePatchRegistry) return;

  class NativePatchRegistry {
    constructor() {
      this._patches = new Map(); // key -> { obj, prop, originalDesc, wrappedValue, owner }
    }

    patch(obj, prop, wrapperFactory, owner = 'extension') {
      if (!obj || !prop || typeof wrapperFactory !== 'function') return null;
      const key = `${obj.constructor ? obj.constructor.name : 'obj'}.${prop}`;

      if (this._patches.has(key)) {
        return this._patches.get(key).wrappedValue;
      }

      const desc = Object.getOwnPropertyDescriptor(obj, prop) || {
        value: obj[prop],
        writable: true,
        configurable: true,
        enumerable: true
      };

      const originalValue = typeof desc.get === 'function' ? desc.get.call(obj) : desc.value;
      const wrappedValue = wrapperFactory(originalValue, desc);

      if (typeof wrappedValue !== 'function' && typeof wrappedValue !== 'object') {
        return originalValue;
      }

      try {
        if (desc.get || desc.set) {
          Object.defineProperty(obj, prop, {
            get: () => wrappedValue,
            configurable: desc.configurable !== false,
            enumerable: desc.enumerable !== false
          });
        } else {
          Object.defineProperty(obj, prop, {
            value: wrappedValue,
            writable: desc.writable !== false,
            configurable: desc.configurable !== false,
            enumerable: desc.enumerable !== false
          });
        }

        const entry = {
          obj,
          prop,
          originalDesc: desc,
          originalValue,
          wrappedValue,
          owner
        };

        this._patches.set(key, entry);
        return wrappedValue;
      } catch (err) {
        console.warn(`[NativePatchRegistry] Failed to patch ${key}:`, err);
        return originalValue;
      }
    }

    restore(owner = null) {
      for (const [key, patch] of this._patches.entries()) {
        if (owner && patch.owner !== owner) continue;

        try {
          const { obj, prop, originalDesc, wrappedValue } = patch;
          const currentDesc = Object.getOwnPropertyDescriptor(obj, prop);
          const currentValue = currentDesc
            ? (typeof currentDesc.get === 'function' ? currentDesc.get.call(obj) : currentDesc.value)
            : obj[prop];

          // Conditional Teardown: Restore ONLY if current value is still our wrapped function/value.
          // If a third-party script patched it after us, do NOT overwrite the third party's modification!
          if (currentValue === wrappedValue) {
            if (originalDesc) {
              Object.defineProperty(obj, prop, originalDesc);
            } else {
              delete obj[prop];
            }
          }
        } catch (err) {
          console.warn(`[NativePatchRegistry] Failed to restore ${key}:`, err);
        }

        if (!owner || patch.owner === owner) {
          this._patches.delete(key);
        }
      }
    }

    isPatched(obj, prop) {
      const key = `${obj.constructor ? obj.constructor.name : 'obj'}.${prop}`;
      return this._patches.has(key);
    }
  }

  global.NativePatchRegistry = new NativePatchRegistry();
})(typeof window !== 'undefined' ? window : globalThis);
