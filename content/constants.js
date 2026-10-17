// RTL Beautifier & Fixer - Constants
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  RtlFixer.isReaderPage = function (page = window.location) {
    const runtimeId = globalThis.chrome?.runtime?.id;
    return !!runtimeId && page.protocol === 'chrome-extension:' &&
      page.hostname === runtimeId && page.pathname === '/reader/viewer.html';
  };
  RtlFixer.getReaderDocumentUrl = function (page = window.location) {
    if (!RtlFixer.isReaderPage(page)) return null;
    const documentId = new URL(page.href).searchParams.get('document');
    if (!/^[a-f0-9]{64}$/i.test(documentId || '')) return null;
    return `chrome-extension://${page.hostname}/reader/viewer.html?document=${documentId.toLowerCase()}`;
  };
  // Local documents have no hostname. Give their settings an explicit scope
  // while retaining the former empty-host key as a read fallback.
  RtlFixer.getSiteConfigKey = function (page = window.location) {
    const scope = RtlFixer.isReaderPage(page) ? 'reader' :
      page.protocol === 'file:' ? 'file://' : page.hostname.toLowerCase().replace(/^www\./, '');
    return 'site_config_' + scope;
  };
  RtlFixer.getSiteConfigKeys = function (page = window.location) {
    const key = RtlFixer.getSiteConfigKey(page);
    return page.protocol === 'file:' ? [key, 'site_config_'] : [key];
  };
  RtlFixer.getStoredSiteConfig = function (items, page = window.location) {
    for (const key of RtlFixer.getSiteConfigKeys(page)) {
      if (items[key] !== undefined) return items[key] || {};
    }
    return {};
  };

  RtlFixer.DEBUG = false; // Set to true to enable verbose console logging in development
  // Script blocks also contain digits, punctuation and vowel marks. Only
  // letters establish direction; a Persian percentage or Hebrew niqqud must
  // not make an otherwise English label RTL. Script extensions retain shared
  // Arabic letters such as tatweel along with supplements/presentation forms.
  RtlFixer.RTL_CHAR_REGEX = /(?=\p{Letter})[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}]/u;
  RtlFixer.ARABIC_SCRIPT_REGEX = /(?=\p{Letter})\p{Script_Extensions=Arabic}/u;
  RtlFixer.STRONG_RTL_CHAR = RtlFixer.RTL_CHAR_REGEX;
  RtlFixer.STRONG_LTR_CHAR = /(?![\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}])\p{Letter}/u;
  RtlFixer.RTL_CHAR_GLOBAL_REGEX = new RegExp(RtlFixer.RTL_CHAR_REGEX.source, 'gu');
  RtlFixer.LTR_CHAR_GLOBAL_REGEX = new RegExp(RtlFixer.STRONG_LTR_CHAR.source, 'gu');
  RtlFixer.LTR_RUN_REGEX = /[A-Za-z_#@$%\-\[\]{};:',\.\?\/`"{}](?:[-A-Za-z0-9_#@$%\-\[\]{};:',\.\?\/`"{}\s]*[A-Za-z0-9_#@$%\-\[\]{};:',\.\?\/`"{}])?/g;
  RtlFixer.EMOJI_REGEX = /[\p{Emoji}\p{Emoji_Presentation}]/u;
  RtlFixer.IGNORABLE_CHAR_REGEX = /[\d\s\u200E\u200F\u200B#@$%^&*()\-+=_{}[\]\\|:;"'<>,.?/~`!\u00AB\u00BB]/;

  RtlFixer.IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE', 'KBD', 'SAMP', 'HEAD', 'HTML',
    'TEMPLATE', 'BDI', 'SVG', 'CANVAS', 'MATH'
  ]);

  RtlFixer.STRUCTURAL_TAGS = new Set([
    'HTML', 'BODY', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP', 'COL',
    'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE', 'FORM'
  ]);

  // Selectors for math container elements (KaTeX, MathJax, native MathML)
  RtlFixer.MATH_CONTAINER_SELECTOR = [
    'math', '[role="math"]',
    '.math-inline', '.math-display',
    '.katex', '.katex-display', '.katex-html', '.katex-mathml',
    '.MathJax', '.MathJax_Display', '.MathJax_Preview',
    'mjx-container', 'mjx-chtml', 'mjx-math', '.mjx-container', '.mjx-chtml', '.mjx-math',
    '.mathjax-latex',
    '[class*="katex"]', '[class*="MathJax"]', '[class*="mjx-"]'
  ].join(',');

  RtlFixer.BLOCK_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE'
  ]);

  // Every element this extension injects into the host page. Used to keep our
  // own UI out of the MutationObserver (its repaints would otherwise re-trigger
  // scanAndProcess + requestRestore, which repaint it again — a feedback loop)
  // and out of the RTL processing pass.
  RtlFixer.EXTENSION_UI_SELECTOR = [
    '[data-rastin-reader-ui]',
    '#rastin-highlight-bar',
    '#rastin-hub-drawer',
    '#rastin-radar-container',
    '#rastin-toast-container',
    '#rastin-first-visit-toast',
    '.rastin-note',
    '#rtl-fixer-reading-ruler',
    '#rtl-fixer-focus-overlay',
    '#rtl-fixer-focus-pulse',
    '#rtl-fixer-progress-container',
    '#rtl-fixer-pomodoro',
    '#rtl-fixer-picker-overlay',
    '#rtl-fixer-picker-hud',
    '#rtl-fixer-ui-font',
    '#rtl-fixer-dynamic-variables',
    '#rtl-fixer-font-import',
    '#rastin-ui-toast',
    '#rastin-highlight-save-error',
    '#rastin-highlight-read-error',
    '#rastin-highlight-context-error',
    '#rtl-fixer-clipboard',
    '#rtl-fixer-translator-host',
    '#rtl-fixer-paint-host'
  ].join(',');

  const extensionUiSelector = RtlFixer.EXTENSION_UI_SELECTOR;
  const extensionUiCandidates = '[id^="rastin-"],[id^="rtl-fixer-"],[data-rastin-reader-ui],.rastin-note';
  // Check an element's own marker, without repeatedly searching its ancestors.
  // Mutation batches share ancestor results; a changed selector still takes
  // the canonical matching path so this optimization cannot omit new widgets.
  RtlFixer.isExtensionElement = function (element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (RtlFixer.EXTENSION_UI_SELECTOR === extensionUiSelector &&
        !/^(?:rastin-|rtl-fixer-)/.test(element.id || '') &&
        !element.hasAttribute('data-rastin-reader-ui') &&
        !element.classList.contains('rastin-note')) return false;
    return element.matches(RtlFixer.EXTENSION_UI_SELECTOR);
  };

  // True when `node` is (or lives inside) extension-owned UI.
  RtlFixer.isExtensionNode = function (node) {
    if (!node) return false;
    let element = node.nodeType === Node.ELEMENT_NODE ? node :
      (node.parentElement || node.host || node.getRootNode?.().host || null);
    try {
      while (element) {
        if (RtlFixer.EXTENSION_UI_SELECTOR !== extensionUiSelector) {
          if (element.closest?.(RtlFixer.EXTENSION_UI_SELECTOR)) return true;
        } else {
          // Most page ancestors have no extension marker at all. Locate the
          // small candidate set natively before matching the full widget list.
          let candidate = element.closest?.(extensionUiCandidates);
          while (candidate) {
            if (candidate.matches(extensionUiSelector)) return true;
            candidate = candidate.parentElement?.closest(extensionUiCandidates);
          }
        }
        // closest() stops at a shadow boundary; follow the host to classify
        // controls and explicit ShadowRoot scans by their owning widget.
        const host = element.getRootNode?.().host;
        if (!host || host === element) break;
        element = host;
      }
    } catch {}
    return false;
  };
  // Default configuration
  RtlFixer.DEFAULT_CONFIG = {
    enabled: true,
    enabledDomains: [],
    alignmentMode: 'auto', // 'auto', 'force-rtl', 'none'
    inputsAutoDir: true,
    fontFamily: 'Vazirmatn', // 'Vazirmatn', 'System', 'Custom'
    customFontName: '',
    customFontUrl: '',
    fontWeight: '400',
    fontSizeAdjust: 0, // value in px
    lineHeightAdjust: 1.6, // multiplier
    forceRightAlign: false,
    justifyText: false,
    applyToAllElements: false,
    persianDigits: false,
    isolateLtrRuns: false,
    fixTables: true,
    fixListsBlockquotes: true,
    adBlockEnabled: true,
    adBlockCosmetic: true,
    customRules: {},
    techCodeProtection: true,
    readingRulerEnabled: false,
    readingRulerFocus: false,
    bionicTextEnabled: false,
    focusCoachEnabled: false,
    readingProgressEnabled: false,
    allowCopyEnabled: false,
    translatorEnabled: false,
    translatorApi: 'openai',
    apiKeys: {
      pollinations: ''
    },
    highlightEnabled: true,
    highlightColor: 'yellow'
  };
})(window.RtlFixer);
