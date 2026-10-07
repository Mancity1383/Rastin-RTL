// Shared presentation and clipboard helpers for Rastin's page tools.
window.RtlFixer = window.RtlFixer || {};
(function (RtlFixer) {
  'use strict';
  const paths = {
    note: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
    copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
    close: 'M6 6l12 12M18 6L6 18',
    translate: 'M3 5h12M9 3v2M5 8l7 7M12 5c-1 6-4 10-9 13M14 21l4-10 4 10M16 17h4',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
    refresh: 'M20 7V3l-3 3a8 8 0 1 0 3 10M20 3h-5',
    chevron: 'M8 10l4 4 4-4',
    grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
    check: 'M5 12l4 4L19 6'
  };
  let toastTimer;
  function icon(name) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (paths[name] || paths.note) + '"/></svg>';
  }
  function toast(message) {
    let el = document.getElementById('rastin-ui-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'rastin-ui-toast';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.documentElement.appendChild(el);
    }
    el.textContent = message; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(String(text)); toast('کپی شد'); return true; }
    catch {
      const selection = window.getSelection(), ranges = [];
      if (selection) for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
      const focused = document.activeElement, field = document.createElement('textarea');
      field.id = 'rtl-fixer-clipboard'; field.value = String(text);
      field.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
      document.documentElement.appendChild(field); field.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      field.remove(); focused?.focus?.({ preventScroll: true });
      if (selection) { selection.removeAllRanges(); ranges.forEach(r => selection.addRange(r)); }
      toast(ok ? 'کپی شد' : 'کپی ممکن نشد؛ متن را انتخاب و کپی کنید.'); return ok;
    }
  }
  const font = chrome.runtime.getURL('fonts/Vazirmatn-Regular.woff2');
  const shadowCss = '@font-face{font-family:RastinUi;src:url("' + font + '") format("woff2");font-display:swap}:host{--ui-accent:#7c6aeb;--ui-text:#343840;--ui-muted:#9197a3;--ui-border:#e8eaf0;font-family:RastinUi,Tahoma,Arial,sans-serif;color-scheme:light}*{box-sizing:border-box}button,input,textarea,select{font-family:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #9a8df0;outline-offset:3px}[hidden]{display:none!important}svg{flex-shrink:0}';
  const localFontCss = [[400,'Regular'],[500,'Medium'],[700,'Bold'],[900,'Black']].map(([weight,name]) => '@font-face{font-family:Vazirmatn;src:url("' + chrome.runtime.getURL('fonts/Vazirmatn-' + name + '.woff2') + '") format("woff2");font-weight:' + weight + ';font-display:swap}').join('');
  const style = document.createElement('style'); style.id = 'rtl-fixer-ui-font';
  style.textContent = '@font-face{font-family:RastinUi;src:url("' + font + '") format("woff2");font-display:swap}';
  document.documentElement.appendChild(style);
  RtlFixer.UI = { icon, toast, copy, shadowCss, localFontCss };
})(window.RtlFixer);

window.RtlFixer.UI.translatorCss = "\n:host{font-family:RastinUi,Tahoma,Arial,sans-serif!important}\n.translator-card{width:380px!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - 32px)!important;min-height:180px;border-radius:20px!important;border:1px solid #e7e9ef!important;box-shadow:0 16px 64px #20233322!important;transform:translateY(6px)!important;transition:opacity .16s ease,transform .16s ease!important}\n.translator-card.visible{transform:translateY(0)!important}\n.card-header{padding:13px 16px!important;background:white!important;border-bottom:1px solid #edf0f4!important;gap:8px!important}\n.header-title{font-size:12px!important;font-weight:500!important;color:#555b67!important}.header-title-container svg{color:#9b8cef!important}\n.close-btn{width:28px!important;height:28px!important;border-radius:8px!important;color:#a0a5b0!important}.close-btn:hover{background:#f3f1fa!important;color:#7c6aeb!important}\n.api-selector-btn{padding:4px 7px!important;gap:4px!important;border:0!important;background:#f7f6fc!important;border-radius:8px!important;box-shadow:none!important;font-size:10px!important;font-weight:400!important;color:#8d80ba!important;transform:none!important}\n.api-icon-wrapper{width:17px!important;height:17px!important;background:transparent!important}.api-dropdown-menu{width:235px!important;max-width:calc(100vw - 40px)!important;border-color:#e7e9ef!important;border-radius:12px!important;box-shadow:0 10px 34px #20233316!important;right:0!important}\n.api-menu-item{border-radius:8px!important;padding:9px!important;gap:9px!important}.api-item-icon-wrapper{border-radius:7px!important}.api-menu-item:hover{background:#f8f7fc!important}\n.card-body{padding:18px!important;flex:1;min-height:0!important;overflow:auto!important;font-size:13px!important;line-height:1.9!important;scrollbar-width:thin;scrollbar-color:#ded9ed transparent}\n.original-container{background:#fafafc!important;border:1px solid #f0f1f5!important;padding:12px!important;border-radius:12px!important;margin-bottom:14px!important}\n.word-title,.word-title-truncated{font-size:12px!important;font-weight:400!important;color:#8e95a2!important;line-height:1.9!important}\n.translation-result{font-size:16px!important;line-height:2!important;font-weight:400!important;color:#343840!important;margin:0 0 12px!important;overflow-wrap:anywhere}\n.actions-row{gap:6px!important;margin-top:7px!important}.action-btn{width:27px!important;height:27px!important;border-radius:7px!important;border:0!important;color:#989daa!important;background:transparent!important;padding:3px!important}.action-btn:hover{background:#f0edf9!important;color:#7c6aeb!important}\n.abadis-quick-btn{width:auto!important;font-size:10px!important;padding:3px 8px!important;background:#f2eff9!important;color:#9a82ba!important;border:0!important;border-radius:7px!important}\n.section-title{font-size:10px!important;font-weight:500!important;color:#a0a5b0!important;margin:12px 0 8px!important}.divider{height:1px!important;background:#edf0f4!important;margin:14px 0!important}\n.ai-explanation-box{background:#faf9fd!important;border:1px solid #f0edf8!important;border-radius:11px!important;padding:12px!important;font-size:12px!important;line-height:1.9!important;color:#757b89!important}\n.dict-item{padding:7px 0!important;color:#6d7380!important;border-color:#eff1f4!important}.pos-badge{font-size:9px!important;background:#f3f1f9!important;color:#a18bc1!important;border-radius:4px!important}\n.phonetic{font:11px/1.7 Arial!important;color:#b0a7c7!important}.loader{padding:30px 12px!important;gap:12px!important;color:#a0a5b0!important;font-size:12px!important}.spinner{border-color:#eeeaf8!important;border-top-color:#9b8cef!important;width:22px!important;height:22px!important;border-width:2px!important}\n.card-footer{padding:11px 14px!important;gap:8px!important;border-top:1px solid #edf0f4!important;background:#fff!important}.follow-up-input{background:#fafafc!important;border:1px solid #edf0f4!important;border-radius:10px!important;font-size:11px!important;padding:9px 11px!important;min-width:0}.send-btn{background:#f0edf9!important;color:#9685cf!important;border:0!important;width:33px!important;height:33px!important;border-radius:9px!important;box-shadow:none!important}\n.terminal-section{display:none!important}\n.selection-toolbar{padding:7px 10px!important;gap:5px!important;border-radius:12px!important;border:1px solid #e7e9ef!important;box-shadow:0 8px 28px #20233315!important;font-family:RastinUi,Tahoma,sans-serif!important}.tool-btn{font-weight:400!important;color:#7c6aeb!important;font-size:11px!important}.tool-btn svg{color:#9b8cef!important}\n.translation-controls{display:flex;align-items:center;gap:7px;padding:10px 16px;background:#fcfcfd;border-bottom:1px solid #f0f1f5;direction:rtl;font-size:10px;color:#999fab}\n.translation-controls select{min-width:110px;background:#fff;border:1px solid #e8eaf0;border-radius:7px;padding:4px 7px;font-size:10px;color:#717784}\n.translation-controls button{display:flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:7px;color:#9c91bd;cursor:pointer;width:26px;height:26px}.translation-controls button:hover{background:#f0edf9}.translation-controls .translation-status{margin-right:auto;font-size:9px;white-space:nowrap;color:#a4a9b2}.translator-card[aria-busy=true] .translation-status{color:#9b8cef}\n.source-editor{background:#fcfcfd;padding:0 16px 10px;direction:rtl;border-bottom:1px solid #f0f1f5;font-size:10px;color:#a0a5b0}.source-editor summary{cursor:pointer;list-style:none}.source-editor summary:after{content:'＋';float:left}.source-editor[open] summary:after{content:'−'}\n.source-text{width:100%;height:90px;max-height:180px;margin-top:8px;resize:vertical;border:1px solid #e7e9ef;border-radius:9px;padding:10px;font-size:12px;line-height:1.8;color:#616876;background:#fff}\n.translation-output-actions{display:flex;align-items:center;gap:6px;margin:0 0 14px}.translation-output-actions button,.explain-btn,.retry-btn{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:7px;padding:5px 8px;font-size:10px;color:#9b87bf;background:#f2eff9;cursor:pointer}\n.translation-output-actions button svg{width:13px;height:13px}.translation-error,.translation-empty{direction:rtl;text-align:center;font-size:12px;color:#a0a5b0;line-height:2;padding:20px 4px}.translation-error .retry-btn{margin-top:12px}.translator-card button:disabled{opacity:.4;cursor:default}\n@media(prefers-reduced-motion:reduce){.translator-card,.selection-toolbar{transition:none!important;transform:none!important}.spinner{animation:none!important}}\n";

window.RtlFixer.UI.translatorCss += ".source-editor[open]~.card-body .original-container{background:transparent!important;border:0!important;padding:0!important;margin:0 0 12px!important}.source-editor[open]~.card-body .word-title,.source-editor[open]~.card-body .original-header,.source-editor[open]~.card-body .original-content,.source-editor[open]~.card-body .phonetic{display:none!important}.translation-details{border-top:1px solid #edf0f4;padding-top:12px;direction:rtl;color:#a0a5b0;font-size:10px}.translation-details summary{list-style:none;cursor:pointer}.translation-details summary:after{content:'＋';float:left}.translation-details[open] summary:after{content:'−'}.translation-details .ai-explanation-box{margin-top:10px}.translator-card .card-body{padding:16px!important}";
