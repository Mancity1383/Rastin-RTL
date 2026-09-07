// RTL Beautifier & Fixer - Smart Selection Translator & AI Reading Assistant
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  // All translator templates pass through this sanitizer. Selection text and
  // remote dictionary/API data must never become executable page markup.
  function setSafeHtml(element, html) {
    if (!element) return;
    const template = document.createElement('template');
    template.innerHTML = String(html);
    template.content.querySelectorAll('script, iframe, object, embed, meta, link').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' ||
            ((name === 'href' || name === 'src' || name === 'xlink:href') &&
             (value.startsWith('javascript:') || value.startsWith('vbscript:') || value.startsWith('data:text/html')))) {
          node.removeAttribute(attribute.name);
        }
      });
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    element.replaceChildren(template.content.cloneNode(true));
  }
  let shadowHost = null;
  let shadowRoot = null;
  let activeSelectionText = '';
  let selectionCoords = { x: 0, y: 0 };
  let isTranslatorActive = false;
  let currentWordLanguage = 'en'; // 'en' or 'fa'
  let currentAbortController = null;
  let currentGenerationToken = 0;

  // Card drag state variables
  let isCardDragging = false;
  let cardDragStartX = 0;
  let cardDragStartY = 0;
  let dropdownDismissHandler = null;
  let cardDragMoveHandler = null;
  let cardDragEndHandler = null;



  const INACTIVITY_THRESHOLD = 30000; 

  const CSS_STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Outfit:wght@300;400;500;600;700&family=Vazirmatn:wght@400;500;700;800&display=swap');

    :host {
      all: initial;
      font-family: 'Outfit', 'Vazirmatn', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    
    .selection-toolbar {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 24px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
      direction: rtl;
    }
    
    .selection-toolbar.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    
    .tool-btn {
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 700;
      color: #334155;
      padding: 4px 8px;
      border-radius: 12px;
      transition: background-color 0.2s;
      outline: none;
    }
    
    .tool-btn:hover {
      background: #f1f5f9;
      color: #0f172a;
    }

    .tool-btn svg {
      color: #3b82f6; 
    }

    .toolbar-divider {
      width: 1.5px;
      height: 14px;
      background: #e2e8f0;
    }

    .color-picker {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .color-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1px solid rgba(0, 0, 0, 0.12);
      cursor: pointer;
      padding: 0;
      transition: transform 0.15s ease;
      outline: none;
    }

    .color-dot:hover {
      transform: scale(1.2);
    }

    .color-dot.yellow { background: #fef08a; }
    .color-dot.green { background: #bbf7d0; }
    .color-dot.pink { background: #fecdd3; }
    .color-dot.blue { background: #bfdbfe; }
    
    .color-dot.eraser {
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
    }
    
    .color-dot.eraser:hover {
      color: #ef4444;
      background: #fee2e2;
    }

    .translator-card {
      position: fixed;
      z-index: 2147483647;
      width: 360px;
      max-height: 560px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: scale(0.96);
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      pointer-events: none;
    }

    .translator-card.visible {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1.5px solid #f1f5f9;
      background: #f8fafc;
      direction: rtl;
      cursor: grab;
      user-select: none;
    }

    .card-header:active {
      cursor: grabbing;
    }

    .header-title-container {
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: none;
    }

    .header-title {
      font-size: 12.5px;
      font-weight: 700;
      color: #475569;
    }

    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: #94a3b8;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: #e2e8f0;
      color: #334155;
    }

    .api-dropdown-container {
      position: relative;
      display: inline-block;
      direction: rtl;
    }

    .api-selector-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 700;
      color: #1e293b;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
      transition: all 0.2s ease;
      outline: none;
    }

    .api-selector-btn:hover {
      background: #f8fafc;
      border-color: #94a3b8;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      transform: translateY(-1px);
    }

    .api-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #f1f5f9;
      flex-shrink: 0;
    }

    .api-selector-btn .chevron-icon {
      margin-right: 1px;
      color: #64748b;
      transition: transform 0.2s ease;
    }

    .api-dropdown-container.open .chevron-icon {
      transform: rotate(180deg);
    }

    .api-dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      background: #ffffff;
      border: 1.5px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);
      z-index: 10000;
      display: none;
      flex-direction: column;
      padding: 6px;
      min-width: 200px;
    }

    .api-dropdown-container.open .api-dropdown-menu {
      display: flex;
      animation: fadeInDropdown 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes fadeInDropdown {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .api-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      font-size: 11.5px;
      font-weight: 500;
      color: #334155;
      background: transparent;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      text-align: right;
      width: 100%;
      transition: all 0.18s ease;
    }

    .api-menu-item:hover {
      background: #f8fafc;
      color: #0f172a;
    }

    .api-menu-item.active {
      background: #faf5ff;
      border: 1px solid #f3e8ff;
    }

    .api-item-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      flex-shrink: 0;
    }

    .card-body {
      padding: 16px;
      overflow-y: auto;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Scrollbar styling */
    .card-body::-webkit-scrollbar,
    .abadis-synonyms::-webkit-scrollbar,
    .abadis-defs::-webkit-scrollbar,
    .abadis-sentences::-webkit-scrollbar,
    .abadis-enen::-webkit-scrollbar {
      width: 5px;
    }
    .card-body::-webkit-scrollbar-track,
    .abadis-synonyms::-webkit-scrollbar-track,
    .abadis-defs::-webkit-scrollbar-track,
    .abadis-sentences::-webkit-scrollbar-track,
    .abadis-enen::-webkit-scrollbar-track {
      background: transparent;
    }
    .card-body::-webkit-scrollbar-thumb,
    .abadis-synonyms::-webkit-scrollbar-thumb,
    .abadis-defs::-webkit-scrollbar-thumb,
    .abadis-sentences::-webkit-scrollbar-thumb,
    .abadis-enen::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    .card-body::-webkit-scrollbar-thumb:hover,
    .abadis-synonyms::-webkit-scrollbar-thumb:hover,
    .abadis-defs::-webkit-scrollbar-thumb:hover,
    .abadis-sentences::-webkit-scrollbar-thumb:hover,
    .abadis-enen::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    .original-container {
      margin-bottom: 8px;
    }

    .word-title {
      font-size: 13.5px;
      font-weight: 400;
      color: #64748b;
      margin: 0;
      line-height: 1.5;
      word-break: break-word;
    }

    .actions-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      margin-bottom: 4px;
    }

    .action-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s, transform 0.2s;
    }

    .action-btn:hover {
      color: #64748b;
      transform: scale(1.08);
    }

    .phonetic {
      font-size: 11.5px;
      color: #94a3b8;
      margin: 2px 0 0 0;
      font-family: monospace;
    }

    .translation-result {
      font-size: 14.5px;
      font-weight: 500;
      color: #1e293b; 
      margin: 6px 0 0 0;
      line-height: 1.6;
      word-break: break-word;
    }

    .divider {
      height: 1px;
      background: #f1f5f9;
      margin: 2px 0;
    }

    .section-title {
      font-size: 11px;
      font-weight: 800;
      color: #94a3b8;
      margin: 0;
      direction: rtl;
      text-align: right;
      letter-spacing: 0.05em;
    }

    .dict-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .dict-item {
      font-size: 13px;
      line-height: 1.4;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pos-badge {
      font-size: 9px;
      font-weight: 800;
      padding: 2px 6px;
      background: rgba(59, 130, 246, 0.08);
      color: #2563eb;
      border-radius: 6px;
      flex-shrink: 0;
      text-transform: lowercase;
    }

    .ai-explanation-box {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 1px solid #e2e8f0;
      border-right: 4px solid #8b5cf6; /* Sleek purple accent for AI */
      border-radius: 10px;
      padding: 12px;
      font-size: 12.5px;
      line-height: 1.6;
      color: #334155;
      direction: rtl;
      text-align: right;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.01);
    }

    .ai-footer {
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      font-weight: 600;
    }

    /* Follow-up input at bottom */
    .card-footer {
      border-top: 1.5px solid #f1f5f9;
      padding: 12px 14px;
      background: #f8fafc;
      display: flex;
      gap: 10px;
      direction: rtl;
      align-items: center;
    }

    .follow-up-input {
      flex-grow: 1;
      border: 1.5px solid #cbd5e1;
      border-radius: 20px;
      padding: 7px 14px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      background: #ffffff;
      transition: all 0.2s;
    }

    .follow-up-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    .send-btn {
      background: #3b82f6;
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.2);
    }

    .send-btn:hover {
      background: #2563eb;
      transform: scale(1.06);
    }

    .loader {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 0;
      color: #64748b;
      font-size: 12px;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid rgba(59, 130, 246, 0.15);
      border-top: 3px solid #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Collapsible Terminal Styles */
    .terminal-section {
      border-top: 1px dashed #e2e8f0;
      margin-top: 8px;
      padding-top: 8px;
      font-family: 'Fira Code', 'Consolas', 'Courier New', monospace;
    }
    .terminal-toggle-btn {
      background: none;
      border: none;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #64748b;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .terminal-toggle-btn:hover {
      background: #f1f5f9;
      color: #334155;
    }
    .terminal-body {
      margin-top: 4px;
      background: #0f172a;
      border-radius: 6px;
      padding: 8px;
      max-height: 120px;
      overflow-y: auto;
      direction: ltr;
      text-align: left;
    }
    .terminal-console {
      font-size: 9.5px;
      line-height: 1.4;
      color: #cbd5e1;
    }
    .log-item {
      margin-bottom: 3px;
      word-break: break-all;
    }
    .log-time {
      color: #64748b;
      margin-right: 6px;
    }
    .log-req {
      color: #38bdf8;
    }
    .log-success {
      color: #4ade80;
    }
    .log-warn {
      color: #fbbf24;
    }
    .log-error {
      color: #f87171;
    }
  `;



  const ENGINES = {
    'openai': {
      name: 'GPT-4o (OpenAI)',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>`
    },
    'quillbot': {
      name: 'هوش مصنوعی QuillBot',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`
    },
    'machinetranslation': {
      name: 'MachineTranslation (22 AI)',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>`
    },
    'pollinations': {
      name: 'Pollinations AI',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>`
    },
    'google': {
      name: 'مترجم سنتی گوگل',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.25h12M9 3v2.25m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 11.37 7.31 16.5 3 19" /></svg>`
    },
    'abadis': {
      name: 'دیکشنری آبادیس',
      svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7e1975" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18c-2.305 0-4.408.867-6 2.292m0-14.25v14.25" /></svg>`
    }
  };

  function updateDropdownUI(card, api) {
    const info = ENGINES[api] || ENGINES['openai'];
    const selectorBtn = card.querySelector('.api-selector-btn');
    if (selectorBtn) {
      const iconWrapper = selectorBtn.querySelector('.api-icon-wrapper');
      if (iconWrapper) setSafeHtml(iconWrapper, info.svg);
      const nameEl = selectorBtn.querySelector('.api-name');
      if (nameEl) nameEl.textContent = info.name;
    }
    
    card.querySelectorAll('.api-menu-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-api') === api);
    });
  }

  function logToTerminal(message, type = 'info') {
    if (!shadowRoot) return;
    const card = shadowRoot.querySelector('.translator-card');
    if (!card) return;
    const consoleEl = card.querySelector('.terminal-console');
    if (!consoleEl) return;
    
    const placeholder = consoleEl.querySelector('.terminal-placeholder');
    if (placeholder) placeholder.remove();
    
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    const item = document.createElement('div');
    item.className = 'log-item';
    
    let typeClass = 'log-info';
    if (type === 'req') typeClass = 'log-req';
    if (type === 'success') typeClass = 'log-success';
    if (type === 'warn') typeClass = 'log-warn';
    if (type === 'error') typeClass = 'log-error';
    
    // Escaping message to prevent XSS
    const escapedMessage = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    setSafeHtml(item, `<span class="log-time">[${timeStr}]</span><span class="${typeClass}">${escapedMessage}</span>`);
    consoleEl.appendChild(item);
    
    // Keep at most 100 entries to prevent memory leak
    while (consoleEl.children.length > 100) {
      consoleEl.removeChild(consoleEl.firstChild);
    }
    
    const bodyEl = card.querySelector('.terminal-body');
    if (bodyEl) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  }

  function initShadowDOM() {
    if (!shadowHost) {
      shadowHost = document.createElement('div');
      shadowHost.id = 'rtl-fixer-translator-host';
      document.documentElement.appendChild(shadowHost);
      shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

      // Inject styles
      const styleTag = document.createElement('style');
      styleTag.textContent = CSS_STYLES;
      shadowRoot.appendChild(styleTag);

      // Create Floating Selection Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'selection-toolbar';
      setSafeHtml(toolbar, `
        <button class="tool-btn translate-btn">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 11.37 7.31 16.5 3 19" />
          </svg>
          <span>ترجمه</span>
        </button>
      `);
      
      // Stop selection-dismiss events when interacting with the toolbar
      toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
      toolbar.addEventListener('mouseup', (e) => e.stopPropagation());
      
      // Wire up translate button
      toolbar.querySelector('.translate-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        hideButton();
        showCard();
        performTranslation(activeSelectionText);
      });

      // Highlight logic removed since it is now managed by highlight-manager.js

      shadowRoot.appendChild(toolbar);

      // Create Rich Card
      const card = document.createElement('div');
      card.className = 'translator-card';
      setSafeHtml(card, `
        <div class="card-header">
          <div class="header-title-container">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="color: #64748b;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 11.37 7.31 16.5 3 19" />
            </svg>
            <span class="header-title">مترجم هوشمند</span>
          </div>

          <div class="api-dropdown-container">
            <button class="api-selector-btn">
              <span class="api-icon-wrapper">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
              </span>
              <span class="api-name">GPT-4o (OpenAI)</span>
              <svg class="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div class="api-dropdown-menu">
              <button class="api-menu-item" data-api="openai">
                <span class="api-item-icon-wrapper" style="background: #eff6ff;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #1e293b; font-size: 11.5px;">GPT-4o (OpenAI)</span>
                  <span style="font-size: 9.5px; color: #64748b;">هوش مصنوعی قدرتمند</span>
                </div>
              </button>
              <button class="api-menu-item" data-api="pollinations">
                <span class="api-item-icon-wrapper" style="background: #fdf2f8;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #1e293b; font-size: 11.5px;">Pollinations AI</span>
                  <span style="font-size: 9.5px; color: #64748b;">مدل رایگان</span>
                </div>
              </button>
              <button class="api-menu-item" data-api="google">
                <span class="api-item-icon-wrapper" style="background: #f0f9ff;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.25h12M9 3v2.25m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 11.37 7.31 16.5 3 19" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #1e293b; font-size: 11.5px;">مترجم سنتی گوگل</span>
                  <span style="font-size: 9.5px; color: #64748b;">ترجمه سریع متون</span>
                </div>
              </button>
              <button class="api-menu-item" data-api="quillbot">
                <span class="api-item-icon-wrapper" style="background: #ecfdf5;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #1e293b; font-size: 11.5px;">هوش مصنوعی QuillBot</span>
                  <span style="font-size: 9.5px; color: #64748b;">ترجمه دقیق و طبیعی</span>
                </div>
              </button>
              <button class="api-menu-item" data-api="machinetranslation">
                <span class="api-item-icon-wrapper" style="background: #f3e8ff;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #7c3aed; font-size: 11.5px;">MachineTranslation (22 AI)</span>
                  <span style="font-size: 9.5px; color: #64748b;">اجماع ۲۲ مدل هوش مصنوعی</span>
                </div>
              </button>
              <button class="api-menu-item" data-api="abadis">
                <span class="api-item-icon-wrapper" style="background: #faf5ff;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7e1975" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18c-2.305 0-4.408.867-6 2.292m0-14.25v14.25" /></svg>
                </span>
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1px;">
                  <span style="font-weight: 700; color: #7e1975; font-size: 11.5px;">دیکشنری آبادیس</span>
                  <span style="font-size: 9.5px; color: #64748b;">واژه‌نامه و تلفظ تخصصی</span>
                </div>
              </button>
            </div>
          </div>

          <button class="close-btn" title="بستن">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="card-body"></div>
        
        <!-- Collapsible Terminal for Technical Logs -->
        <div class="terminal-section">
          <button class="terminal-toggle-btn">
            <span>🖥️ گزارش ارتباطات فنی (لاگ)</span>
            <svg class="chevron-icon" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="transition: transform 0.2s;">
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div class="terminal-body" style="display: none;">
            <div class="terminal-console">
              <div class="terminal-placeholder">منتظر درخواست بعدی...</div>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <input type="text" class="follow-up-input" placeholder="سوال خود را بپرسید...">
          <button class="send-btn" title="ارسال">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      `);
      
      // Wire up terminal toggle
      const terminalToggleBtn = card.querySelector('.terminal-toggle-btn');
      const terminalBody = card.querySelector('.terminal-body');
      if (terminalToggleBtn && terminalBody) {
        terminalToggleBtn.addEventListener('mousedown', e => e.stopPropagation());
        terminalToggleBtn.addEventListener('mouseup', e => e.stopPropagation());
        terminalToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = terminalBody.style.display === 'none';
          terminalBody.style.display = isHidden ? 'block' : 'none';
          terminalToggleBtn.querySelector('.chevron-icon').style.transform = isHidden ? 'rotate(180deg)' : '';
        });
      }

      card.querySelector('.close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        hideCard();
      });

      // Wire up API switcher in card header
      const dropdownContainer = card.querySelector('.api-dropdown-container');
      const selectorBtn = card.querySelector('.api-selector-btn');
      
      selectorBtn.addEventListener('mousedown', e => e.stopPropagation());
      selectorBtn.addEventListener('mouseup', e => e.stopPropagation());
      selectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownContainer.classList.toggle('open');
      });

      card.querySelectorAll('.api-menu-item').forEach(btn => {
        btn.addEventListener('mousedown', e => e.stopPropagation());
        btn.addEventListener('mouseup', e => e.stopPropagation());
        
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const api = btn.getAttribute('data-api');
          dropdownContainer.classList.remove('open');
          
          chrome.storage.local.set({ translatorApi: api }, () => {
            RtlFixer.config.translatorApi = api;
            updateDropdownUI(card, api);
            if (activeSelectionText) {
              performTranslation(activeSelectionText);
            }
          });
        });
      });

      // Global click to dismiss dropdown
      dropdownDismissHandler = () => {
        if (dropdownContainer) dropdownContainer.classList.remove('open');
      };
      document.addEventListener('click', dropdownDismissHandler);

      // Wire up follow-up chat
      const input = card.querySelector('.follow-up-input');
      const sendBtn = card.querySelector('.send-btn');
      
      const submitFollowUp = () => {
        const query = input.value.trim();
        if (!query) return;
        input.value = '';
        askFollowUp(query);
      };

      sendBtn.addEventListener('click', submitFollowUp);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitFollowUp();
      });

      // Prevent drag/mouseup from closing card when clicking inside it
      card.addEventListener('mousedown', e => e.stopPropagation());
      
      const cardHeader = card.querySelector('.card-header');
      
      const handleDragEnd = () => {
        if (isCardDragging && card) {
          isCardDragging = false;
          card.style.transition = 'opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
          cardHeader.style.cursor = 'grab';
        }
      };

      card.addEventListener('mouseup', (e) => {
        handleDragEnd();
        e.stopPropagation();
      });
      
      // Card Draggable logic via Header
      cardHeader.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('.close-btn')) return;
        isCardDragging = true;
        card.style.transition = 'none'; // disable transitions while dragging
        cardDragStartX = e.clientX - card.getBoundingClientRect().left;
        cardDragStartY = e.clientY - card.getBoundingClientRect().top;
        e.preventDefault();
      });

      cardDragMoveHandler = (e) => {
        if (!isCardDragging || !card) return;
        const newLeft = e.clientX - cardDragStartX;
        const newTop = e.clientY - cardDragStartY;
        card.style.left = `${newLeft}px`;
        card.style.top = `${newTop}px`;
      };
      document.addEventListener('mousemove', cardDragMoveHandler);

      cardDragEndHandler = handleDragEnd;
      document.addEventListener('mouseup', cardDragEndHandler);

      shadowRoot.appendChild(card);
    }
  }

  function showButton(x, y) {
    initShadowDOM();
    const button = shadowRoot.querySelector('.selection-toolbar');
    button.style.top = `${y}px`;
    button.style.left = `${x}px`;
    button.classList.add('visible');
  }

  function hideButton() {
    if (!shadowRoot) return;
    const button = shadowRoot.querySelector('.selection-toolbar');
    if (button) button.classList.remove('visible');
  }

  function showCard() {
    initShadowDOM();
    const card = shadowRoot.querySelector('.translator-card');
    
    const activeApi = RtlFixer.config.translatorApi || 'openai';
    updateDropdownUI(card, activeApi);

    let cardLeft = selectionCoords.x - 170; 
    let cardTop = selectionCoords.y + 15; 
    
    cardLeft = Math.max(10, Math.min(window.innerWidth - 360, cardLeft));
    cardTop = Math.max(10, Math.min(window.innerHeight - 500, cardTop));

    card.style.top = `${cardTop}px`;
    card.style.left = `${cardLeft}px`;
    card.classList.add('visible');
  }

  function hideCard() {
    if (!shadowRoot) return;
    const card = shadowRoot.querySelector('.translator-card');
    if (card) card.classList.remove('visible');
  }

  function renderLoading() {
    const body = shadowRoot.querySelector('.card-body');
    setSafeHtml(body, `
      <div class="loader">
        <div class="spinner"></div>
        <span>در حال ترجمه هوشمند...</span>
      </div>
    `);
  }



  function getSurroundingContext() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return '';
    
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return '';

    let parent = anchorNode.parentElement;
    while (parent && !['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'SPAN'].includes(parent.tagName)) {
      parent = parent.parentElement;
    }
    
    if (parent) {
      return parent.textContent.trim().substring(0, 500);
    }
    return '';
  }

  function playSpeech(text, lang) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'fa' ? 'fa-IR' : 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  function parseAIResponse(aiText) {
    const tags = ['[TRANSLATION]', '[PHONETIC]', '[DICTIONARY]', '[EXPLANATION]'];
    let positions = [];
    
    tags.forEach(tag => {
      const index = aiText.toUpperCase().indexOf(tag);
      if (index !== -1) {
        positions.push({ tag, index });
      }
    });
    
    positions.sort((a, b) => a.index - b.index);
    
    const result = {
      translation: '',
      phonetic: '',
      dictionary: '',
      explanation: ''
    };
    
    for (let i = 0; i < positions.length; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      const start = current.index + current.tag.length;
      const end = next ? next.index : aiText.length;
      
      const content = aiText.substring(start, end).trim();
      const key = current.tag.replace('[', '').replace(']', '').toLowerCase();
      result[key] = content;
    }
    
    result.translation = result.translation.replace(/^\*\*|\*\*$/g, '').replace(/^"|"$/g, '').trim();
    result.phonetic = result.phonetic.replace(/^\*\*|\*\*$/g, '').replace(/^\/|\/$/g, '').trim();
    
    return result;
  }

  function parseAbadisHTML(htmlString, searchWord) {
    if (!htmlString) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const boxWrd = doc.querySelector('#boxWrd');
    const mainBox = doc.querySelector('.boxMain');
    if (!boxWrd && !mainBox && !doc.querySelector('.lun')) {
      return null;
    }

    let word = searchWord;
    const h1 = doc.querySelector('#boxWrd h1, .boxMain h1');
    if (h1 && h1.textContent.trim()) {
      word = h1.textContent.trim();
    }

    let phonetics = [];
    const phoEl = doc.querySelector('#pho');
    if (phoEl) {
      const phoText = phoEl.textContent.trim();
      if (phoText) {
        phonetics = phoText.split('/').map(s => s.trim()).filter(s => s.length > 0);
      }
    }

    let mainMeaning = '';
    let otherMeanings = '';

    if (mainBox) {
      const fullText = mainBox.innerHTML;
      const meaningMatch = fullText.match(/<b>معنی<\/b>\s*:\s*([^<]+)/i);
      if (meaningMatch) {
        mainMeaning = meaningMatch[1].trim();
      }
      const otherMatch = fullText.match(/<b>معانی دیگر<\/b>\s*:\s*([^<]+)/i);
      if (otherMatch) {
        otherMeanings = otherMatch[1].trim();
      }
    }

    // Word Analysis (بررسی کلمه)
    const analysisLun = Array.from(doc.querySelectorAll('.lun')).find(el => {
      const t = el.getAttribute('t') || '';
      return t.includes('بررسی کلمه') || el.textContent.includes('بررسی کلمه');
    });

    let wordAnalysis = {
      partsOfSpeech: [],
      definitions: []
    };

    if (analysisLun) {
      const anaParts = analysisLun.querySelectorAll('.anaPart');
      anaParts.forEach(ap => {
        const text = ap.textContent.trim().replace(/\s+/g, ' ');
        if (text) wordAnalysis.partsOfSpeech.push(text);
      });

      const anaRels = analysisLun.querySelectorAll('.anaRel');
      anaRels.forEach(rel => {
        const text = rel.textContent.trim().replace(/\s+/g, ' ');
        let defObj = {
          num: '',
          definition: '',
          synonyms: '',
          antonyms: '',
          similar: ''
        };

        const numMatch = text.match(/\((\d+)\)/);
        if (numMatch) defObj.num = numMatch[1];
        
        const defMatch = text.match(/تعریف\s*:\s*([^•]+)/i);
        if (defMatch) defObj.definition = defMatch[1].trim();
        
        const synMatch = text.match(/مترادف\s*:\s*([^•]+)/i);
        if (synMatch) defObj.synonyms = synMatch[1].trim();
        
        const antMatch = text.match(/متضاد\s*:\s*([^•]+)/i);
        if (antMatch) defObj.antonyms = antMatch[1].trim();

        const simMatch = text.match(/مشابه\s*:\s*([^•]+)/i);
        if (simMatch) defObj.similar = simMatch[1].trim();

        if (defObj.definition || defObj.synonyms || defObj.antonyms || defObj.similar) {
          wordAnalysis.definitions.push(defObj);
        }
      });
    }

    // Sample Sentences (جمله های نمونه)
    const sentencesLun = Array.from(doc.querySelectorAll('.lun')).find(el => {
      const t = el.getAttribute('t') || '';
      return t.includes('جمله های نمونه') || el.textContent.includes('جمله های نمونه');
    });

    let sampleSentences = [];
    if (sentencesLun) {
      const exps = sentencesLun.querySelectorAll('.anaTermExp');
      exps.forEach(expEl => {
        let expText = expEl.textContent.trim();
        // Clean leading digits and dots e.g. "1. 1. read a book" -> "read a book"
        expText = expText.replace(/^\d+[\.\s]*/, '').trim();

        const meanEl = expEl.nextElementSibling;
        if (meanEl && meanEl.classList.contains('anaTermMean')) {
          let cleanMean = meanEl.textContent
            .replace(/\[ترجمه[^\]]*\]/g, '')
            .replace(/ترجمه صحیح تر را بنویسید/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (expText && cleanMean) {
            sampleSentences.push({
              sentence: expText,
              translation: cleanMean
            });
          }
        }
      });
    }

    // Synonyms / Thesaurus (مترادف ها)
    const synonymsLun = Array.from(doc.querySelectorAll('.lun')).find(el => {
      const t = el.getAttribute('t') || '';
      return t.includes('مترادف ها') || el.textContent.includes('مترادف ها');
    });

    let synonymGroups = [];
    if (synonymsLun) {
      const article = synonymsLun.querySelector('article');
      if (article) {
        const children = Array.from(article.children);
        for (let i = 0; i < children.length; i++) {
          const el = children[i];
          if (el.tagName === 'DIV' && !el.classList.contains('boxLtr')) {
            const faTerm = el.textContent.trim();
            const nextEl = children[i + 1];
            if (nextEl && nextEl.classList.contains('boxLtr')) {
              synonymGroups.push({
                faTerm: faTerm,
                enSynonyms: nextEl.textContent.trim()
              });
              i++;
            }
          }
        }
      }
    }

    // English to English (انگلیسی به انگلیسی)
    const enEnLun = Array.from(doc.querySelectorAll('.lun')).find(el => {
      const t = el.getAttribute('t') || '';
      return t.includes('انگلیسی به انگلیسی');
    });
    let enToEnItems = [];
    if (enEnLun) {
      const art = enEnLun.querySelector('article');
      if (art) {
        let rawHtml = art.innerHTML
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<\/div>/gi, '\n');
        const tmpDoc = parser.parseFromString(rawHtml, 'text/html');
        let textContent = tmpDoc.body.textContent || '';
        
        enToEnItems = textContent
          .split(/\n|•/)
          .map(line => line.replace(/^[\s•\-\*]+/, '').trim())
          .filter(line => line.length > 3);
      }
    }

    return {
      word,
      phonetics,
      mainMeaning,
      otherMeanings,
      wordAnalysis,
      sampleSentences,
      synonymGroups,
      enToEnItems
    };
  }

  function fetchAbadisTranslate(text, targetLang, signal) {
    logToTerminal(`ارسال درخواست به دیکشنری آبادیس برای واژه: "${text}"...`, 'req');

    const handleResponse = (response) => {
      if (signal.aborted) return;
      if (response && response.success && response.html) {
        const parsed = parseAbadisHTML(response.html, text);
        if (parsed && (parsed.mainMeaning || parsed.otherMeanings || parsed.wordAnalysis.definitions.length > 0 || parsed.sampleSentences.length > 0)) {
          logToTerminal('معنی واژه با موفقیت از دیکشنری آبادیس استخراج شد.', 'success');
          const card = shadowRoot.querySelector('.translator-card');
          if (card) {
            updateDropdownUI(card, 'abadis');
          }
          renderAbadisResult(text, parsed, response.url || `https://abadis.ir/entofa/${encodeURIComponent(text.trim().toLowerCase().replace(/[\s_]+/g, '-'))}/`);
          return;
        }
      }
      
      logToTerminal('نتیجه دقیقی در آبادیس پیدا نشد. سوئیچ به مترجم گوگل...', 'warn');
      fallbackGoogleTranslate(text, targetLang, signal);
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'fetchAbadis', word: text }, (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            logToTerminal(`خطای پیام‌رسانی: ${chrome.runtime.lastError?.message || 'Context Invalidated'}. تلاش با fetch مستقیم...`, 'warn');
            directFetchAbadis(text, targetLang, signal);
          } else {
            handleResponse(res);
          }
        });
      } else {
        directFetchAbadis(text, targetLang, signal);
      }
    } catch (err) {
      logToTerminal('محیط افزونه ری‌بارگذاری شده است. استفاده از fetch مستقیم آبادیس...', 'warn');
      directFetchAbadis(text, targetLang, signal);
    }
  }

  function directFetchAbadis(text, targetLang, signal) {
    const slug = encodeURIComponent(text.trim().toLowerCase().replace(/[\s_]+/g, '-'));
    const url = `https://abadis.ir/entofa/${slug}/`;

    fetch(url, { signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.text();
      })
      .then(html => {
        if (signal.aborted) return;
        const parsed = parseAbadisHTML(html, text);
        if (parsed && (parsed.mainMeaning || parsed.otherMeanings || parsed.wordAnalysis.definitions.length > 0 || parsed.sampleSentences.length > 0)) {
          logToTerminal('معنی واژه با موفقیت از آبادیس استخراج شد.', 'success');
          const card = shadowRoot.querySelector('.translator-card');
          if (card) updateDropdownUI(card, 'abadis');
          renderAbadisResult(text, parsed, url);
        } else {
          throw new Error('محتوای معنی یافت نشد');
        }
      })
      .catch(err => {
        if (signal.aborted) return;
        logToTerminal(`خطا در fetch مستقیم آبادیس: ${err.message}. سوئیچ به مترجم گوگل...`, 'warn');
        fallbackGoogleTranslate(text, targetLang, signal);
      });
  }

  function cleanPhoneticsDisplay(phonetics) {
    if (!phonetics || phonetics.length === 0) return '';
    const cleaned = phonetics
      .map(p => p.replace(/^\/+|\/+$/g, '').trim())
      .filter(p => p.length > 0);
    
    const unique = [...new Set(cleaned)];
    if (unique.length === 0) return '';
    return `/${unique.join(' • ')}/`;
  }

  function renderAbadisResult(original, parsed, abadisUrl) {
    if (activeSelectionText !== original) return;
    const body = shadowRoot.querySelector('.card-body');

    const cleanPhoneticStr = cleanPhoneticsDisplay(parsed.phonetics);

    let defsHtml = '';
    if (parsed.wordAnalysis && parsed.wordAnalysis.definitions.length > 0) {
      defsHtml = `
        <div class="divider"></div>
        <p class="section-title">بررسی تخصصی و تعاریف (${parsed.wordAnalysis.definitions.length})</p>
        <div class="abadis-defs" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px; max-height: 220px; overflow-y: auto; padding-left: 2px;">
          ${parsed.wordAnalysis.definitions.map((def, idx) => `
            <div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.03); text-align: right; direction: rtl;">
              ${def.definition ? `
                <div style="font-size: 13px; color: #0f172a; direction: ltr; text-align: left; margin-bottom: 8px; font-weight: 600; line-height: 1.5;">
                  <span style="display: inline-block; background: #f3e8ff; color: #7e1975; font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 6px; margin-right: 6px;">(${def.num || (idx + 1)})</span>
                  <span>${def.definition}</span>
                </div>
              ` : ''}
              ${def.synonyms ? `
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #0369a1; margin-top: 4px; direction: rtl;">
                  <span style="font-weight: 800; color: #0284c7; flex-shrink: 0;">• مترادف:</span>
                  <span style="direction: ltr; font-weight: 500; color: #334155; display: inline-block;">${def.synonyms}</span>
                </div>
              ` : ''}
              ${def.antonyms ? `
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #be123c; margin-top: 4px; direction: rtl;">
                  <span style="font-weight: 800; color: #e11d48; flex-shrink: 0;">• متضاد:</span>
                  <span style="direction: ltr; font-weight: 500; color: #334155; display: inline-block;">${def.antonyms}</span>
                </div>
              ` : ''}
              ${def.similar ? `
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #475569; margin-top: 4px; direction: rtl;">
                  <span style="font-weight: 800; color: #64748b; flex-shrink: 0;">• مشابه:</span>
                  <span style="direction: ltr; font-weight: 500; color: #334155; display: inline-block;">${def.similar}</span>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    let sentencesHtml = '';
    if (parsed.sampleSentences && parsed.sampleSentences.length > 0) {
      sentencesHtml = `
        <div class="divider"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <p class="section-title">جمله‌های نمونه (${parsed.sampleSentences.length})</p>
        </div>
        <div class="abadis-sentences" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px; max-height: 200px; overflow-y: auto; padding-left: 2px;">
          ${parsed.sampleSentences.map((item, i) => `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 12px; direction: rtl; text-align: right;">
              <div style="direction: ltr; text-align: left; font-weight: 600; color: #1e293b; margin-bottom: 4px; display: flex; align-items: flex-start; gap: 6px;">
                <span style="color: #7e1975; font-weight: 800; font-size: 11px; background: #faf5ff; border: 1px solid #f3e8ff; padding: 1px 6px; border-radius: 5px; flex-shrink: 0;">${i + 1}</span>
                <span>${item.sentence}</span>
              </div>
              <div style="color: #475569; font-size: 11.5px; line-height: 1.6; padding-right: 2px;">${item.translation}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let synGroupsHtml = '';
    if (parsed.synonymGroups && parsed.synonymGroups.length > 0) {
      synGroupsHtml = `
        <div class="divider"></div>
        <p class="section-title">مترادف‌ها و هم‌خانواده‌ها (${parsed.synonymGroups.length})</p>
        <div class="abadis-synonyms" style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px; max-height: 180px; overflow-y: auto; padding-left: 2px;">
          ${parsed.synonymGroups.map(grp => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 11.5px; direction: rtl;">
              <span style="font-weight: 700; color: #7e1975;">${grp.faTerm}</span>
              <span style="direction: ltr; text-align: left; color: #334155; font-family: monospace; font-size: 11px; font-weight: 500;">${grp.enSynonyms}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    let enEnHtml = '';
    if (parsed.enToEnItems && parsed.enToEnItems.length > 0) {
      enEnHtml = `
        <div class="divider"></div>
        <p class="section-title">تعریف انگلیسی به انگلیسی (${parsed.enToEnItems.length})</p>
        <div class="abadis-enen" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px; max-height: 200px; overflow-y: auto; padding-left: 2px;">
          ${parsed.enToEnItems.map((item, idx) => `
            <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 1px solid #cbd5e1; border-left: 4px solid #3b82f6; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; direction: ltr; text-align: left; color: #1e293b; line-height: 1.6; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
              <div style="display: flex; gap: 8px; align-items: flex-start;">
                <span style="font-weight: 800; color: #2563eb; font-size: 10.5px; background: #dbeafe; padding: 2px 7px; border-radius: 6px; flex-shrink: 0; margin-top: 2px;">#${idx + 1}</span>
                <span style="font-weight: 500;">${item}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    setSafeHtml(body, `
      <div class="abadis-container" style="direction: rtl; text-align: right;">
        <!-- Header Card -->
        <div class="abadis-header-card" style="background: linear-gradient(135deg, #7e1975 0%, #4a0e45 100%); color: #ffffff; padding: 14px 16px; border-radius: 14px; margin-bottom: 12px; box-shadow: 0 4px 14px rgba(126, 25, 117, 0.25);">
          <div style="display: flex; justify-content: space-between; align-items: center; direction: ltr; gap: 10px;">
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
              <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.01em;">${parsed.word}</h2>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                ${cleanPhoneticStr ? `
                  <span style="font-size: 12px; opacity: 0.95; font-family: monospace; background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 6px;">${cleanPhoneticStr}</span>
                ` : ''}
                <button class="action-btn speak-abadis-btn" title="شنیدن تلفظ صوتی" style="color: #ffffff; background: rgba(255,255,255,0.22); border: none; border-radius: 20px; padding: 3px 9px; font-size: 11.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background 0.2s; backdrop-filter: blur(4px);">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  <span>تلفظ صوتی</span>
                </button>
              </div>
            </div>
            <a href="${abadisUrl}" target="_blank" title="مشاهده کامل در وب‌سایت آبادیس" style="color: rgba(255,255,255,0.95); text-decoration: none; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.2); padding: 6px 10px; border-radius: 8px; backdrop-filter: blur(4px); flex-shrink: 0; border: 1px solid rgba(255,255,255,0.25);">
              <span>آبادیس</span>
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>

        <!-- Primary Meaning -->
        ${parsed.mainMeaning ? `
          <div class="abadis-section" style="margin-bottom: 12px; background: #faf5ff; border: 1px solid #f3e8ff; border-right: 4px solid #7e1975; padding: 10px 12px; border-radius: 10px;">
            <div style="font-size: 11px; font-weight: 800; color: #7e1975; margin-bottom: 4px;">معنی اصلی</div>
            <div style="font-size: 14px; font-weight: 700; color: #2e1065; line-height: 1.6;">${parsed.mainMeaning}</div>
          </div>
        ` : ''}

        <!-- Secondary Meanings -->
        ${parsed.otherMeanings ? `
          <div class="abadis-section" style="margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 10px;">
            <div style="font-size: 11px; font-weight: 800; color: #64748b; margin-bottom: 4px;">معانی دیگر</div>
            <div style="font-size: 12.5px; color: #334155; line-height: 1.6;">${parsed.otherMeanings}</div>
          </div>
        ` : ''}

        <!-- Parts of Speech Badges -->
        ${parsed.wordAnalysis && parsed.wordAnalysis.partsOfSpeech.length > 0 ? `
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
            ${parsed.wordAnalysis.partsOfSpeech.map(pos => `
              <span style="font-size: 10.5px; font-weight: 700; background: #f1f5f9; color: #475569; padding: 3px 8px; border-radius: 6px; border: 1px solid #cbd5e1;">${pos}</span>
            `).join('')}
          </div>
        ` : ''}

        ${defsHtml}
        ${sentencesHtml}
        ${synGroupsHtml}
        ${enEnHtml}
      </div>
    `);

    const speakBtn = body.querySelector('.speak-abadis-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => playSpeech(parsed.word, 'en'));
    }
  }

  function fetchQuillbotTranslate(text, targetLang, signal) {
    logToTerminal(`ارسال درخواست ترجمه به هوش مصنوعی QuillBot...`, 'req');
    const handleResult = (res) => {
      if (signal.aborted) return;
      if (res && res.success && res.translation) {
        logToTerminal('ترجمه با موفقیت از هوش مصنوعی QuillBot دریافت شد.', 'success');
        const card = shadowRoot.querySelector('.translator-card');
        if (card) updateDropdownUI(card, 'quillbot');
        const parsed = { translation: res.translation, explanation: '' };
        renderAIResult(text, parsed, targetLang, 'quillbot');
      } else {
        logToTerminal('پاسخ از QuillBot دریافت نشد. سوئیچ به مترجم گوگل...', 'warn');
        fallbackGoogleTranslate(text, targetLang, signal);
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'fetchQuillbot', text, sl: currentWordLanguage, tl: targetLang }, (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            fallbackGoogleTranslate(text, targetLang, signal);
          } else {
            handleResult(res);
          }
        });
      } else {
        fallbackGoogleTranslate(text, targetLang, signal);
      }
    } catch (e) {
      fallbackGoogleTranslate(text, targetLang, signal);
    }
  }

  function fetchMachineTranslationTranslate(text, targetLang, signal) {
    logToTerminal(`ارسال درخواست به MachineTranslation (ترکیب ۲۲ مدل هوش مصنوعی)...`, 'req');
    const handleResult = (res) => {
      if (signal.aborted) return;
      if (res && res.success && res.translation) {
        logToTerminal('ترجمه با موفقیت از MachineTranslation (اجماع AI) دریافت شد.', 'success');
        const card = shadowRoot.querySelector('.translator-card');
        if (card) updateDropdownUI(card, 'machinetranslation');
        const parsed = { translation: res.translation, explanation: '' };
        renderAIResult(text, parsed, targetLang, 'machinetranslation');
      } else {
        logToTerminal('پاسخ از MachineTranslation دریافت نشد. سوئیچ به مترجم گوگل...', 'warn');
        fallbackGoogleTranslate(text, targetLang, signal);
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'fetchMachineTranslation', text, sl: currentWordLanguage, tl: targetLang }, (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            fallbackGoogleTranslate(text, targetLang, signal);
          } else {
            handleResult(res);
          }
        });
      } else {
        fallbackGoogleTranslate(text, targetLang, signal);
      }
    } catch (e) {
      fallbackGoogleTranslate(text, targetLang, signal);
    }
  }

  function performTranslation(text) {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    renderLoading();
    
    if (!RtlFixer.DEFAULT_CONFIG) {
      RtlFixer.DEFAULT_CONFIG = {
        enabled: true,
        translatorEnabled: true,
        translatorApi: 'openai',
        enabledDomains: [],
        apiKeys: {
          pollinations: '',
          libretranslateUrl: 'https://translate.argosopentech.com'
        }
      };
    }
    if (!RtlFixer.config) {
      RtlFixer.config = RtlFixer.DEFAULT_CONFIG;
    }
    
    const config = RtlFixer.config;
    let apiSetting = config.translatorApi || 'openai';
    
    const card = shadowRoot ? shadowRoot.querySelector('.translator-card') : null;
    if (card) {
      updateDropdownUI(card, apiSetting);
    }

    logToTerminal(`شروع فرآیند ترجمه هوشمند برای متن: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`, 'info');
    logToTerminal(`موتور انتخابی کاربر: ${apiSetting}`, 'info');

    const hasRtlChars = /[\u0600-\u06FF]/.test(text);
    currentWordLanguage = hasRtlChars ? 'fa' : 'en';
    const targetLang = currentWordLanguage === 'fa' ? 'en' : 'fa';

    if (apiSetting === 'google') {
      logToTerminal('هدایت مستقیم به مترجم سنتی گوگل...', 'warn');
      fallbackGoogleTranslate(text, targetLang, signal);
      return;
    }

    if (apiSetting === 'abadis') {
      logToTerminal('جستجو در دیکشنری آبادیس...', 'info');
      fetchAbadisTranslate(text, targetLang, signal);
      return;
    }

    if (apiSetting === 'quillbot') {
      logToTerminal('ارسال درخواست به هوش مصنوعی QuillBot...', 'info');
      fetchQuillbotTranslate(text, targetLang, signal);
      return;
    }

    if (apiSetting === 'machinetranslation') {
      logToTerminal('ارسال درخواست به MachineTranslation (اجماع ۲۲ مدل AI)...', 'info');
      fetchMachineTranslationTranslate(text, targetLang, signal);
      return;
    }

    const defaultChain = ['openai', 'pollinations'];
    const validModels = ['openai', 'pollinations'];
    
    let chain = [];
    if (!validModels.includes(apiSetting)) {
      chain = defaultChain;
      logToTerminal('مدل انتخابی معتبر نیست. زنجیره جستجو: ' + chain.join(' ➔ '), 'info');
    } else {
      chain = [apiSetting, ...defaultChain.filter(m => m !== apiSetting)];
      logToTerminal(`موتور ترجیحی: ${apiSetting}. زنجیره جستجوی جایگزین: ` + chain.join(' ➔ '), 'info');
    }
    
    fetchWithFallback(text, chain, targetLang, signal);
  }

  function fetchWithFallback(text, modelsToTry, targetLang, signal) {
    if (modelsToTry.length === 0) {
      logToTerminal('تمامی متدهای هوش مصنوعی با خطا مواجه شدند! سوئیچ به مترجم سنتی گوگل به عنوان پناهگاه نهایی...', 'error');
      fallbackGoogleTranslate(text, targetLang, signal);
      return;
    }
    
    let currentModel = modelsToTry[0];
    const remainingModels = modelsToTry.slice(1);
    
    if (!currentModel || currentModel.trim() === '') {
      logToTerminal('مدل نامعتبر یا خالی تشخیص داده شد. استفاده از openai به عنوان پیش‌فرض', 'warn');
      currentModel = 'openai';
    }
    
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG || {};
    const apiKeys = config.apiKeys || {};
    
    const srcLangName = currentWordLanguage === 'fa' ? 'Persian' : 'English';
    const targetLangName = targetLang === 'fa' ? 'Persian' : 'English';
    const context = getSurroundingContext();
    
    const aiPrompt = `You are a bilingual dictionary and translation assistant.
Translate this text: "${text}"
Surrounding context: "${context}"
Source Language: ${srcLangName}
Target Language: ${targetLangName}

Provide a structured response using the following format:
[TRANSLATION]
(the primary translation, natural and context-aware. If the text is a sentence, translate it as a fluent sentence. Do not translate literally. Do NOT use markdown bold asterisks around it)

[PHONETIC]
(phonetic spelling of the source word, or leave empty if a phrase. Do NOT use markdown bold asterisks)

[DICTIONARY]
(If a single word, list parts of speech and alternative meanings like:
- noun: alternative1, alternative2
- verb: alternative3
If it is a phrase/sentence, leave this section empty)

[EXPLANATION]
(A brief 2-3 sentence explanation in Persian of the word/phrase meaning and how it fits the surrounding context)`;



    // Default keyless Pollinations AI models
    logToTerminal(`ارسال درخواست به هوش مصنوعی رایگان Pollinations (مدل: ${currentModel})...`, 'req');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKeys.pollinations) {
      headers['Authorization'] = `Bearer ${deobfuscate(apiKeys.pollinations)}`;
    }
    
    const requestBody = {
      messages: [{ role: 'user', content: aiPrompt }]
    };
    if (apiKeys.openai && currentModel === 'openai') {
      requestBody.model = 'openai';
    }
    
    const localController = new AbortController();
    const onParentAbort = () => localController.abort();
    signal.addEventListener('abort', onParentAbort);
    
    const timeoutId = setTimeout(() => localController.abort(), 2500);
    
    fetch(`https://text.pollinations.ai/`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
      signal: localController.signal
    })
      .then(res => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onParentAbort);
        if (!res.ok) {
          throw new Error(`خطای HTTP سرور با کد ${res.status}`);
        }
        return res.text();
      })
      .then(aiText => {
        if (signal.aborted) return;
        const isErrorMsg = aiText.includes('"error":') || aiText.includes('402 Payment') || aiText.includes('Queue full') || aiText.includes('deprecat');
        if (isErrorMsg) {
          throw new Error('پاسخ خطا یا محدودیت سرور از مدل هوش مصنوعی دریافت شد');
        }
        const parsed = parseAIResponse(aiText);
        if (parsed.translation) {
          logToTerminal(`پاسخ از مدل هوش مصنوعی با موفقیت دریافت شد. (200 OK)`, 'success');
          const card = shadowRoot.querySelector('.translator-card');
          if (card) {
            updateDropdownUI(card, currentModel);
          }
          renderAIResult(text, parsed, targetLang, currentModel);
        } else {
          throw new Error(`شکست در تحلیل ساختار پاسخ مدل ${currentModel}`);
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onParentAbort);
        if (signal.aborted) return;
        
        const reason = err.name === 'AbortError'
          ? 'پاسخ مدل بیش از حد طول کشید'
          : `مدل با خطا مواجه شد (${err.message})`;
        if (remainingModels.length > 0) {
          logToTerminal(`${reason}. تلاش با مدل بعدی: ${remainingModels[0]}...`, 'warn');
          fetchWithFallback(text, remainingModels, targetLang, signal);
        } else {
          logToTerminal(`${reason}. زنجیره مدل‌ها تمام شد؛ سوئیچ به مترجم گوگل...`, 'warn');
          fallbackGoogleTranslate(text, targetLang, signal);
        }
      });
  }

  function fallbackGoogleTranslate(text, targetLang, signal) {
    logToTerminal('ارسال درخواست به API رسمی و سنتی گوگل (بدون کلید)...', 'req');
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(text)}`;
    
    const localController = new AbortController();
    const onParentAbort = () => localController.abort();
    signal.addEventListener('abort', onParentAbort);
    
    const timeoutId = setTimeout(() => localController.abort(), 10000);
    
    fetch(url, { signal: localController.signal })
      .then(res => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onParentAbort);
        return res.json();
      })
      .then(data => {
        if (signal.aborted) return;
        const translatedText = getGoogleTranslationText(data);
        if (!translatedText) {
          throw new Error('ساختار پاسخ مترجم گوگل نامعتبر است');
        }
        logToTerminal('پاسخ از مترجم سنتی گوگل با موفقیت دریافت شد.', 'success');
        renderResult(text, data, targetLang);
        performAIExplanation(text, translatedText, signal);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onParentAbort);
        if (signal.aborted) return;
        
        if (err.name === 'AbortError') {
          logToTerminal('مترجم سنتی گوگل: درخواست به دلیل طولانی شدن لغو شد.', 'error');
        } else {
          logToTerminal('مترجم سنتی گوگل نیز با شکست مواجه شد! عدم دسترسی به اینترنت یا خطا در سرور.', 'error');
        }
        renderError(text);
      });
  }

  function getGoogleTranslationText(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
    return data[0]
      .filter(segment => Array.isArray(segment))
      .map(segment => typeof segment[0] === 'string' ? segment[0] : '')
      .join('');
  }

  function renderAIResult(original, parsed, targetLang, activeModel) {
    if (activeSelectionText !== original) return;
    const body = shadowRoot.querySelector('.card-body');
    const engineInfo = ENGINES[activeModel] || ENGINES['openai'];
    
    const isSingleWord = !/\s/.test(original.trim()) && original.trim().length <= 15;
    
    let dictHtml = '';
    if (isSingleWord && parsed.dictionary && parsed.dictionary.trim().length > 5) {
      let hasValidItems = false;
      let tempHtml = `
        <div class="divider"></div>
        <p class="section-title">تعاریف دیکشنری</p>
        <ul class="dict-list">
      `;
      
      const lines = parsed.dictionary.split('\n');
      lines.forEach(line => {
        const lower = line.toLowerCase();
        if (lower.includes('empty') || lower.includes('none') || lower.includes('n/a')) return;
        
        const cleanLine = line.replace(/^\*\*|\*\*$/g, '').replace(/^[-*+]\s*/, '').trim();
        if (cleanLine.length < 2 || cleanLine === '*') return;

        const match = cleanLine.match(/^([a-zA-Z\s]+):\s*(.*?)$/);
        if (match) {
          hasValidItems = true;
          const pos = match[1].trim();
          const terms = match[2].split(',').map(t => t.trim());
          terms.forEach(term => {
            const isTermRtl = /[\u0600-\u06FF]/.test(term);
            const alignStyle = isTermRtl ? 'direction: rtl; text-align: right;' : 'direction: ltr; text-align: left;';
            tempHtml += `
              <li class="dict-item" style="${alignStyle}">
                <span class="pos-badge">${pos}</span>
                <span style="font-weight: 600;">${term}</span>
              </li>
            `;
          });
        } else {
          hasValidItems = true;
          const isLineRtl = /[\u0600-\u06FF]/.test(cleanLine);
          const alignStyle = isLineRtl ? 'direction: rtl; text-align: right;' : 'direction: ltr; text-align: left;';
          tempHtml += `
            <li class="dict-item" style="${alignStyle}">
              <span class="pos-badge">mean</span>
              <span style="font-weight: 600;">${cleanLine}</span>
            </li>
          `;
        }
      });
      tempHtml += '</ul>';
      if (hasValidItems) {
        dictHtml = tempHtml;
      }
    }

    const wordDir = currentWordLanguage === 'fa' ? 'rtl' : 'ltr';
    const wordAlign = currentWordLanguage === 'fa' ? 'right' : 'left';
    
    const transDir = targetLang === 'fa' ? 'rtl' : 'ltr';
    const transAlign = targetLang === 'fa' ? 'right' : 'left';

    const isLong = original.length > 60;
    let originalHtml = '';
    if (isLong) {
      originalHtml = `
        <div class="original-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
          <div class="word-title-truncated" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90%; font-weight: 500; font-size: 13.5px; color: #64748b;">
            ${original}
          </div>
          <svg class="original-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="transition: transform 0.25s; flex-shrink: 0; color: #64748b; margin-left: 6px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div class="original-content" style="display: none; margin-top: 8px;">
          <div class="word-title" style="font-size: 13.5px; line-height: 1.5; color: #64748b; word-break: break-word;">${original}</div>
          ${parsed.phonetic ? `<p class="phonetic" style="text-align: ${wordAlign};">/${parsed.phonetic}/</p>` : ''}
        </div>
      `;
    } else {
      originalHtml = `
        <div class="word-title" style="font-size: 13.5px; line-height: 1.5; color: #64748b; word-break: break-word;">${original}</div>
        ${parsed.phonetic ? `<p class="phonetic" style="text-align: ${wordAlign};">/${parsed.phonetic}/</p>` : ''}
      `;
    }

    setSafeHtml(body, `
      <div class="original-container" style="direction: ${wordDir}; text-align: ${wordAlign};">
        ${originalHtml}
        <div class="actions-row">
          <button class="action-btn copy-original-btn" title="کپی متن اصلی">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          </button>
          <button class="action-btn speak-original-btn" title="شنیدن تلفظ">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
          <button class="action-btn abadis-quick-btn" title="جستجو در آبادیس" style="font-size: 11px; font-weight: 700; color: #7e1975; background: #faf5ff; border: 1px solid #f3e8ff; padding: 2px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; margin-right: auto;">
            <span>🏛️ آبادیس</span>
          </button>
        </div>
      </div>
      <div class="translation-result" style="direction: ${transDir}; text-align: ${transAlign}; font-size: 14.5px; line-height: 1.6; color: #1e293b; margin-top: 6px; word-break: break-word;">
        ${parseMarkdown(parsed.translation)}
      </div>
      ${dictHtml}
      <div class="divider"></div>
      <p class="section-title">توضیحات هوش مصنوعی</p>
      <div class="ai-explanation-box">
        <div>${parseMarkdown(parsed.explanation)}</div>
        <div class="ai-footer">
          <span>✨ هوش مصنوعی ${engineInfo.name}</span>
        </div>
      </div>
    `);

    if (isLong) {
      const origHeader = body.querySelector('.original-header');
      const origContent = body.querySelector('.original-content');
      const origChevron = body.querySelector('.original-chevron');
      const origTruncated = body.querySelector('.word-title-truncated');
      
      origHeader.addEventListener('click', () => {
        const isCollapsed = origContent.style.display === 'none';
        origContent.style.display = isCollapsed ? 'block' : 'none';
        origChevron.style.transform = isCollapsed ? 'rotate(180deg)' : '';
        origTruncated.style.opacity = isCollapsed ? '0.3' : '1';
      });
    }

    body.querySelector('.speak-original-btn').addEventListener('click', () => {
      playSpeech(original, currentWordLanguage);
    });
    body.querySelector('.copy-original-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(original);
    });
    const abadisBtn = body.querySelector('.abadis-quick-btn');
    if (abadisBtn) {
      abadisBtn.addEventListener('click', () => {
        RtlFixer.config.translatorApi = 'abadis';
        performTranslation(original);
      });
    }
  }

  function renderResult(original, data, targetLang) {
    if (activeSelectionText !== original) return;
    const body = shadowRoot.querySelector('.card-body');
    
    const mainTranslation = getGoogleTranslationText(data);

    let pronunciation = '';
    if (data[0] && data[0][0] && data[0][0][3]) {
      pronunciation = `/${data[0][0][3]}/`;
    }

    let dictHtml = '';
    if (Array.isArray(data) && Array.isArray(data[1])) {
      dictHtml += `
        <div class="divider"></div>
        <p class="section-title">تعاریف دیکشنری</p>
        <ul class="dict-list">
      `;
      data[1].forEach(posGroup => {
        const pos = posGroup[0]; 
        const terms = posGroup[1].slice(0, 3); 
        terms.forEach(term => {
          const isTermRtl = /[\u0600-\u06FF]/.test(term);
          const alignStyle = isTermRtl ? 'direction: rtl; text-align: right;' : 'direction: ltr; text-align: left;';
          
          dictHtml += `
            <li class="dict-item" style="${alignStyle}">
              <span class="pos-badge">${pos}</span>
              <span style="font-weight: 600;">${term}</span>
            </li>
          `;
        });
      });
      dictHtml += '</ul>';
    }

    const wordDir = currentWordLanguage === 'fa' ? 'rtl' : 'ltr';
    const wordAlign = currentWordLanguage === 'fa' ? 'right' : 'left';
    
    const transDir = targetLang === 'fa' ? 'rtl' : 'ltr';
    const transAlign = targetLang === 'fa' ? 'right' : 'left';

    const isLong = original.length > 60;
    let originalHtml = '';
    if (isLong) {
      originalHtml = `
        <div class="original-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
          <div class="word-title-truncated" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90%; font-weight: 500; font-size: 13.5px; color: #64748b;">
            ${original}
          </div>
          <svg class="original-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="transition: transform 0.25s; flex-shrink: 0; color: #64748b; margin-left: 6px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div class="original-content" style="display: none; margin-top: 8px;">
          <div class="word-title" style="font-size: 13.5px; line-height: 1.5; color: #64748b; word-break: break-word;">${original}</div>
          ${pronunciation ? `<p class="phonetic" style="text-align: ${wordAlign};">${pronunciation}</p>` : ''}
        </div>
      `;
    } else {
      originalHtml = `
        <div class="word-title" style="font-size: 13.5px; line-height: 1.5; color: #64748b; word-break: break-word;">${original}</div>
        ${pronunciation ? `<p class="phonetic" style="text-align: ${wordAlign};">${pronunciation}</p>` : ''}
      `;
    }

    setSafeHtml(body, `
      <div class="original-container" style="direction: ${wordDir}; text-align: ${wordAlign};">
        ${originalHtml}
        <div class="actions-row">
          <button class="action-btn copy-original-btn" title="کپی متن اصلی">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          </button>
          <button class="action-btn speak-original-btn" title="شنیدن تلفظ">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
          <button class="action-btn abadis-quick-btn" title="جستجو در آبادیس" style="font-size: 11px; font-weight: 700; color: #7e1975; background: #faf5ff; border: 1px solid #f3e8ff; padding: 2px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; margin-right: auto;">
            <span>🏛️ آبادیس</span>
          </button>
        </div>
      </div>
      <div class="translation-result" style="direction: ${transDir}; text-align: ${transAlign}; font-size: 14.5px; line-height: 1.6; color: #1e293b; margin-top: 6px; word-break: break-word;">
        ${parseMarkdown(mainTranslation)}
      </div>
      ${dictHtml}
      <div class="divider"></div>
      <p class="section-title">توضیحات هوش مصنوعی</p>
      <div class="ai-explanation-box">
        <div class="loader" style="padding: 10px 0;">
          <div class="spinner" style="width:16px; height:16px; border-width:2px;"></div>
          <span style="font-size:11px;">در حال تحلیل متنی...</span>
        </div>
      </div>
    `);

    if (isLong) {
      const origHeader = body.querySelector('.original-header');
      const origContent = body.querySelector('.original-content');
      const origChevron = body.querySelector('.original-chevron');
      const origTruncated = body.querySelector('.word-title-truncated');
      
      origHeader.addEventListener('click', () => {
        const isCollapsed = origContent.style.display === 'none';
        origContent.style.display = isCollapsed ? 'block' : 'none';
        origChevron.style.transform = isCollapsed ? 'rotate(180deg)' : '';
        origTruncated.style.opacity = isCollapsed ? '0.3' : '1';
      });
    }

    body.querySelector('.speak-original-btn').addEventListener('click', () => {
      playSpeech(original, currentWordLanguage);
    });
    body.querySelector('.copy-original-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(original);
    });
    const abadisBtn = body.querySelector('.abadis-quick-btn');
    if (abadisBtn) {
      abadisBtn.addEventListener('click', () => {
        RtlFixer.config.translatorApi = 'abadis';
        performTranslation(original);
      });
    }
  }

  function renderError(original) {
    if (activeSelectionText !== original) return;
    const body = shadowRoot.querySelector('.card-body');
    setSafeHtml(body, `<span style="color:#ef4444; font-size:12px;">⚠️ خطا در برقراری ارتباط با سرورهای ترجمه.</span>`);
  }

  function renderHTMLTable(rows) {
    if (!rows || rows.length === 0) return '';

    let parsedRows = rows.map(row => {
      let cleanRow = row.trim();
      if (cleanRow.startsWith('|')) cleanRow = cleanRow.substring(1);
      if (cleanRow.endsWith('|')) cleanRow = cleanRow.substring(0, cleanRow.length - 1);
      return cleanRow.split('|').map(cell => cell.trim());
    });

    let hasHeader = false;
    if (parsedRows.length > 1) {
      const secondRowJoined = parsedRows[1].join('');
      if (/^[:\-\s]+$/.test(secondRowJoined)) {
        hasHeader = true;
      }
    }

    let tableHtml = '<table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11.5px; border-radius: 8px; overflow: hidden; border: 1.5px solid #e2e8f0; direction: rtl; text-align: right; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">';
    
    parsedRows.forEach((row, index) => {
      if (hasHeader && index === 1) return;

      const isHeaderRow = hasHeader && index === 0;
      const cellTag = isHeaderRow ? 'th' : 'td';
      
      let rowHtml = `<tr style="${isHeaderRow ? 'background: #f8fafc; font-weight: 700; border-bottom: 2px solid #cbd5e1;' : 'border-bottom: 1px solid #f1f5f9;'}">`;
      
      row.forEach(cell => {
        const isCellRtl = /[\u0600-\u06FF]/.test(cell);
        const cellDir = isCellRtl ? 'rtl' : 'ltr';
        const cellAlign = isCellRtl ? 'right' : 'left';
        
        // Escape cell values to prevent HTML injection (XSS)
        const escapedCell = cell
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
        
        rowHtml += `<${cellTag} style="padding: 8px 10px; direction: ${cellDir}; text-align: ${cellAlign};">${escapedCell}</${cellTag}>`;
      });
      
      rowHtml += '</tr>';
      tableHtml += rowHtml;
    });

    tableHtml += '</table>';
    return tableHtml;
  }

  function parseMarkdown(text) {
    if (!text) return '';
    
    let lines = text.split('\n');
    let htmlOutput = [];
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      const isTableLine = line.startsWith('|') || (line.includes('|') && (i < lines.length - 1 && lines[i+1].trim().includes('|') && (lines[i+1].includes('---') || lines[i+1].includes('-|-'))));
      const isDividerLine = line.includes('---') && line.includes('|');

      if (isTableLine || isDividerLine) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        tableRows.push(line);
      } else {
        if (inTable) {
          htmlOutput.push(renderHTMLTable(tableRows));
          inTable = false;
          tableRows = [];
        }
        
        let processedLine = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
        
        processedLine = processedLine
          .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 4px; font-family: \'Fira Code\', \'Consolas\', monospace; font-size: 11px;">$1</code>');
        
        if (processedLine.startsWith('### ')) {
          processedLine = `<h4 style="margin: 8px 0 4px 0; font-size: 13px; font-weight: 700; color: #1e293b;">${processedLine.substring(4)}</h4>`;
        } else if (processedLine.startsWith('## ')) {
          processedLine = `<h3 style="margin: 10px 0 6px 0; font-size: 14px; font-weight: 700; color: #1e293b;">${processedLine.substring(3)}</h3>`;
        } else if (processedLine.startsWith('# ')) {
          processedLine = `<h2 style="margin: 12px 0 8px 0; font-size: 15px; font-weight: 700; color: #1e293b;">${processedLine.substring(2)}</h2>`;
        }
        else if (/^\s*[-*+]\s+(.*?)$/.test(processedLine)) {
          processedLine = processedLine.replace(/^\s*[-*+]\s+(.*?)$/, '<div style="margin-right: 8px; margin-top: 4px; display: flex; gap: 6px; align-items: baseline;"><span style="color:#8b5cf6;">•</span><span>$1</span></div>');
        } else if (processedLine !== '') {
          processedLine = `<div>${processedLine}</div>`;
        } else {
          processedLine = '<br>';
        }
        
        htmlOutput.push(processedLine);
      }
    }
    
    if (inTable) {
      htmlOutput.push(renderHTMLTable(tableRows));
    }
    
    return htmlOutput.join('');
  }

  function fallbackDictionaryExplanation(text, signal) {
    const singleWord = text.trim().toLowerCase().replace(/[^a-z]/gi, '');
    if (!singleWord) {
      const aiBox = shadowRoot.querySelector('.ai-explanation-box');
      if (aiBox) setSafeHtml(aiBox, `<span style="color:#94a3b8; font-size:11.5px;">⚠️ توضیحات جانبی در دسترس نیست.</span>`);
      return;
    }

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(singleWord)}`, { signal })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        if (signal.aborted) return;
        const aiBox = shadowRoot.querySelector('.ai-explanation-box');
        if (!aiBox || activeSelectionText !== text) return;

        if (Array.isArray(data) && data[0] && data[0].meanings) {
          let items = [];
          data[0].meanings.forEach(m => {
            if (m.definitions && m.definitions.length > 0) {
              m.definitions.slice(0, 2).forEach(defObj => {
                items.push({
                  pos: m.partOfSpeech || '',
                  definition: defObj.definition,
                  example: defObj.example || ''
                });
              });
            }
          });

          if (items.length > 0) {
            setSafeHtml(aiBox, `
              <div style="direction: ltr; text-align: left; font-size: 12px; line-height: 1.5; color: #1e293b;">
                <div style="direction: rtl; text-align: right; font-weight: 700; color: #2563eb; font-size: 11px; margin-bottom: 6px;">💡 تعاریف و کاربردهای واژه (Free Dictionary API)</div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  ${items.slice(0, 3).map(item => `
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #3b82f6; border-radius: 8px; padding: 8px 10px;">
                      <div style="font-weight: 600; color: #0f172a;">
                        ${item.pos ? `<span style="color: #2563eb; font-size: 10px; font-weight: 800; background: #dbeafe; padding: 1px 5px; border-radius: 4px; margin-right: 4px;">${item.pos}</span>` : ''}
                        ${item.definition}
                      </div>
                      ${item.example ? `<div style="font-size: 11px; color: #64748b; font-style: italic; margin-top: 3px;">"${item.example}"</div>` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
              <div class="ai-footer" style="margin-top: 8px;">
                <span>📚 فرهنگ واژگان تخصصی</span>
              </div>
            `);
            return;
          }
        }

        setSafeHtml(aiBox, `<span style="color:#94a3b8; font-size:11.5px;">⚠️ توضیحات جانبی در دسترس نیست.</span>`);
      })
      .catch(err => {
        if (signal.aborted) return;
        const aiBox = shadowRoot.querySelector('.ai-explanation-box');
        if (aiBox && activeSelectionText === text) {
          setSafeHtml(aiBox, `<span style="color:#94a3b8; font-size:11.5px;">⚠️ توضیحات جانبی در دسترس نیست.</span>`);
        }
      });
  }

  function performAIExplanation(text, translation, signal) {
    const context = getSurroundingContext();
    const prompt = `You are a professional reading assistant. Explain the word/phrase "${text}" in the context of this sentence: "${context}". The translation is "${translation}". Provide a brief 2-3 sentence explanation in Persian of how it fits in this specific context. Be extremely concise and clear.`;

    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const apiKeys = config.apiKeys || {};
    const headers = { 'Content-Type': 'application/json' };
    if (apiKeys.pollinations) {
      headers['Authorization'] = `Bearer ${deobfuscate(apiKeys.pollinations)}`;
    }

    // Stage 1: Try POST to Pollinations
    fetch(`https://text.pollinations.ai/`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }]
      }),
      signal
    })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(explanationText => {
        if (signal.aborted) return;
        const isErrorMsg = explanationText.includes('"error":') || explanationText.includes('402 Payment') || explanationText.includes('Queue full') || explanationText.includes('deprecat');
        if (isErrorMsg) throw new Error('AI POST Error Response');

        const aiBox = shadowRoot.querySelector('.ai-explanation-box');
        if (aiBox && activeSelectionText === text) {
          setSafeHtml(aiBox, `
            <div>${parseMarkdown(explanationText.trim())}</div>
            <div class="ai-footer">
              <span>✨ هوش مصنوعی Pollinations</span>
            </div>
          `);
        }
      })
      .catch((err) => {
        if (signal.aborted) return;
        // Stage 2: Try GET to Pollinations (often bypasses POST rate limits)
        fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=qwen`, { signal })
          .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
          })
          .then(getAiText => {
            if (signal.aborted) return;
            const isError = getAiText.includes('"error":') || getAiText.includes('402 Payment') || getAiText.includes('Queue full');
            if (isError) throw new Error('AI GET error');

            const aiBox = shadowRoot.querySelector('.ai-explanation-box');
            if (aiBox && activeSelectionText === text) {
              setSafeHtml(aiBox, `
                <div>${parseMarkdown(getAiText.trim())}</div>
                <div class="ai-footer">
                  <span>✨ هوش مصنوعی Pollinations</span>
                </div>
              `);
            }
          })
          .catch(() => {
            if (signal.aborted) return;
            // Stage 3: Fallback to Free Dictionary API for instant definitions!
            fallbackDictionaryExplanation(text, signal);
          });
      });
  }

  function askFollowUp(query) {
    const body = shadowRoot.querySelector('.card-body');
    
    const userBubble = document.createElement('div');
    userBubble.style.background = '#eff6ff';
    userBubble.style.border = '1px solid #bfdbfe';
    userBubble.style.borderRadius = '12px';
    userBubble.style.padding = '8px 12px';
    userBubble.style.fontSize = '12px';
    userBubble.style.alignSelf = 'flex-start';
    userBubble.style.direction = 'rtl';
    userBubble.style.textAlign = 'right';
    userBubble.style.margin = '4px 0';
    userBubble.style.maxWidth = '85%';
    userBubble.textContent = query;
    body.appendChild(userBubble);
    
    body.scrollTop = body.scrollHeight;

    const aiBubble = document.createElement('div');
    aiBubble.style.background = '#f8fafc';
    aiBubble.style.border = '1px solid #e2e8f0';
    aiBubble.style.borderRadius = '12px';
    aiBubble.style.padding = '8px 12px';
    aiBubble.style.fontSize = '12px';
    aiBubble.style.alignSelf = 'flex-end';
    aiBubble.style.direction = 'rtl';
    aiBubble.style.textAlign = 'right';
    aiBubble.style.margin = '4px 0';
    aiBubble.style.maxWidth = '85%';
    
    setSafeHtml(aiBubble, `
      <div class="loader" style="padding: 0; flex-direction: row; gap: 6px;">
        <div class="spinner" style="width:12px; height:12px; border-width:1.5px;"></div>
        <span style="font-size:11px;">در حال تایپ...</span>
      </div>
    `);
    body.appendChild(aiBubble);
    body.scrollTop = body.scrollHeight;

    const prompt = `The user is reading a page. The selected word was "${activeSelectionText}". The surrounding context is: "${getSurroundingContext()}". Answer this user question in Persian: "${query}".`;
    
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const apiSetting = config.translatorApi || 'gpt-4o';
    const modelName = apiSetting === 'llama' ? 'llama' : 'openai';

    const signal = currentAbortController ? currentAbortController.signal : null;

    fetch(`https://text.pollinations.ai/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: modelName
      }),
      signal
    })
      .then(res => res.text())
      .then(text => {
        if (signal && signal.aborted) return;
        setSafeHtml(aiBubble, parseMarkdown(text.trim()));
        body.scrollTop = body.scrollHeight;
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        aiBubble.textContent = '⚠️ خطا در پاسخ‌گویی. لطفاً مجدداً تلاش کنید.';
      });
  }

  function handleMouseUp(e) {
    if (!isTranslatorActive) return;
    
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      // Don't trigger if click originates from within the shadow DOM (like drag release or close click)
      if (e.target && e.target.closest && e.target.closest('#rtl-fixer-translator-host')) return;

      if (text && text.length > 1 && /[a-zA-Z\u0600-\u06FF]/.test(text)) {
        activeSelectionText = text;
        
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          const btnX = rect.left + (rect.width / 2) - 35;
          const btnY = rect.top - 36; 
          
          selectionCoords = { x: rect.left + (rect.width / 2), y: rect.bottom };

          if (RtlFixer.config && RtlFixer.config.highlightEnabled) {
            hideButton();
            return;
          }

          showButton(btnX, btnY);
        } catch (err) {
          hideButton();
        }
      } else {
        hideButton();
      }
    }, 10);
  }

  function handleMouseDown(e) {
    if (e.target && e.target.closest && e.target.closest('#rtl-fixer-translator-host')) return;
    hideButton();
  }



  RtlFixer.translateText = function (text, x, y) {
    activeSelectionText = text;
    if (x !== undefined && y !== undefined) {
      selectionCoords = { x, y };
    } else {
      selectionCoords = { x: window.innerWidth / 2, y: window.scrollY + 150 };
    }
    showCard();
    performTranslation(text);
  };

  RtlFixer.initTranslator = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const isDomainEnabled = config.globalEnabled && config.enabled;

    if (isDomainEnabled && config.translatorEnabled) {
      isTranslatorActive = true;
      
      document.addEventListener('mouseup', handleMouseUp, { capture: true, passive: true });
      document.addEventListener('mousedown', handleMouseDown, { capture: true, passive: true });
      window.addEventListener('scroll', hideButton, { passive: true });

    } else {
      RtlFixer.removeTranslator();
    }
  };

  RtlFixer.removeTranslator = function () {
    isTranslatorActive = false;
    
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    document.removeEventListener('mouseup', handleMouseUp, { capture: true });
    document.removeEventListener('mousedown', handleMouseDown, { capture: true });
    window.removeEventListener('scroll', hideButton);

    if (dropdownDismissHandler) {
      document.removeEventListener('click', dropdownDismissHandler);
      dropdownDismissHandler = null;
    }
    if (cardDragMoveHandler) {
      document.removeEventListener('mousemove', cardDragMoveHandler);
      cardDragMoveHandler = null;
    }
    if (cardDragEndHandler) {
      document.removeEventListener('mouseup', cardDragEndHandler);
      cardDragEndHandler = null;
    }
    isCardDragging = false;

    
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
      shadowRoot = null;
    }
  };

  // Self init
  RtlFixer.initTranslator();

})(window.RtlFixer);
