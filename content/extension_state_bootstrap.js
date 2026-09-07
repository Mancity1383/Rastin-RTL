(function (global) {
  'use strict';

  if (global.ExtensionStateController?.init) {
    global.ExtensionStateController.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
