// Extension-owned reader pages use a port: tabs.sendMessage only addresses
// content scripts, which Chrome does not inject into extension pages.
(function (global) {
  const readers = new Map();
  const allowedCommands = new Set(['getPageCapabilities', 'updateSettings', 'openPaint', 'openTranslator', 'startElementPicker', 'scrollToHighlight', 'clear_all_highlights']);
  const ownPage = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && url.pathname === '/reader/viewer.html';
    } catch { return false; }
  };
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'rastin-reader' || port.sender?.id !== chrome.runtime.id || !ownPage(port.sender.url)) return;
    let reader;
    port.onMessage.addListener(async message => {
      if (message.type === 'register' && !reader) {
        try {
          if (port.sender.tab && port.sender.tab.id !== message.tabId) throw new Error('Invalid reader tab');
          const tab = await chrome.tabs.get(message.tabId);
          if (!ownPage(tab.url)) throw new Error('Invalid reader tab');
          reader = { tabId: tab.id, port, pending: new Map() };
          readers.set(tab.id, reader);
          port.postMessage({ type: 'registered' });
        } catch { port.disconnect(); }
      } else if (message.type === 'result' && reader) {
        const pending = reader.pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        reader.pending.delete(message.requestId);
        pending.resolve(message.response);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!reader) return;
      if (readers.get(reader.tabId) === reader) readers.delete(reader.tabId);
      for (const pending of reader.pending.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error: 'نمایشگر بسته شد؛ دوباره آن را باز کنید.' });
      }
      reader.pending.clear();
    });
  });
  global.RastinReaderService = {
    ownPage,
    async command(message, sender) {
      if (sender.id !== chrome.runtime.id || !allowedCommands.has(message.command?.action)) throw new Error('Invalid reader command');
      const tab = await chrome.tabs.get(message.tabId);
      const reader = readers.get(tab.id);
      if (!ownPage(tab.url) || !reader) return { ok: false, error: 'نمایشگر را تازه‌سازی کنید.' };
      return new Promise(resolve => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          reader.pending.delete(requestId);
          resolve({ ok: false, error: 'پاسخ نمایشگر دریافت نشد؛ آن را تازه‌سازی کنید.' });
        }, 10000);
        reader.pending.set(requestId, { resolve, timer });
        try { reader.port.postMessage({ type: 'command', requestId, command: message.command }); }
        catch { clearTimeout(timer); reader.pending.delete(requestId); resolve({ ok: false, error: 'نمایشگر در دسترس نیست.' }); }
      });
    },
    async sender(message, sender) {
      if (!ownPage(sender.url)) return sender;
      const tabId = sender.tab?.id ?? message.readerTabId;
      if (sender.id !== chrome.runtime.id || !Number.isInteger(tabId) ||
          (message.readerTabId !== undefined && message.readerTabId !== tabId)) throw new Error('Invalid reader sender');
      const tab = await chrome.tabs.get(tabId);
      if (!ownPage(tab.url) || !readers.has(tab.id)) throw new Error('Invalid reader document');
      // Chrome's sender.url is the initial document URL. It does not follow
      // history.replaceState when the picker loads another PDF in this tab.
      return { ...sender, url: tab.url, tab, frameId: 0 };
    }
  };
})(globalThis);
