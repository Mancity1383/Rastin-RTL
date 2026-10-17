(function () {
  window.RtlFixer = window.RtlFixer || {};
  const fixer = window.RtlFixer;
  let port, currentTab, reconnect;
  let markReady;
  fixer.readerReady = new Promise(resolve => { markReady = resolve; });
  const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  // These scripts normally run as content scripts. Carry the owned tab ID
  // with reader storage/navigation requests so the worker can validate it.
  chrome.runtime.sendMessage = (message, ...args) => fixer.readerReady.then(() =>
    originalSend(message && typeof message === 'object' ? { ...message, readerTabId: currentTab.id } : message, ...args));

  async function connect() {
    try {
      currentTab = await chrome.tabs.getCurrent();
      fixer.readerTabId = currentTab.id;
      port = chrome.runtime.connect({ name: 'rastin-reader' });
      port.onMessage.addListener(message => {
        if (message.type === 'registered') { markReady(currentTab.id); return; }
        if (message.type !== 'command') return;
        let replied = false;
        const reply = response => {
          if (replied) return;
          replied = true;
          try { port.postMessage({ type: 'result', requestId: message.requestId, response }); } catch {}
        };
        void (async () => { try {
          const nativeResponse = await fixer.handleReaderCommand?.(message.command);
          if (nativeResponse) { reply(nativeResponse); return; }
          if (message.command.action === 'startElementPicker') {
            fixer.startElementPicker?.();
            reply({ status: 'started' });
            return;
          }
          if (!fixer.handleRuntimeMessage) { reply({ ok: false, error: 'نمایشگر در حال آماده‌سازی است.' }); return; }
          const asynchronous = fixer.handleRuntimeMessage(message.command,
            { id: chrome.runtime.id, tab: currentTab, frameId: 0 }, reply);
          if (!asynchronous && !replied) reply({ ok: false });
        } catch (error) { reply({ ok: false, error: error.message }); } })();
      });
      port.onDisconnect.addListener(() => { clearTimeout(reconnect); reconnect = setTimeout(connect, 500); });
      port.postMessage({ type: 'register', tabId: currentTab.id });
    } catch { clearTimeout(reconnect); reconnect = setTimeout(connect, 1000); }
  }
  void connect();
})();
