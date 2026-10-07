// RTL Beautifier & Fixer - Constants
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  RtlFixer.DEBUG = false; // Set to true to enable verbose console logging in development
  RtlFixer.RTL_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/;
  RtlFixer.ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  RtlFixer.STRONG_RTL_CHAR = RtlFixer.RTL_CHAR_REGEX;
  RtlFixer.STRONG_LTR_CHAR = /[A-Za-z\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/;
  RtlFixer.RTL_CHAR_GLOBAL_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/g;
  RtlFixer.LTR_CHAR_GLOBAL_REGEX = /[A-Za-z\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/g;
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
    'mjx-container', '.mjx-container', '.mjx-chtml', '.mjx-math',
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
    '#rtl-fixer-picker-overlay',
    '#rtl-fixer-picker-hud',
    '#rtl-fixer-translator-host',
    '#rtl-fixer-paint-host'
  ].join(',');

  // True when `node` is (or lives inside) extension-owned UI.
  RtlFixer.isExtensionNode = function (node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE
      ? node
      : (node.parentElement || null);
    if (!el || typeof el.closest !== 'function') return false;
    try {
      return Boolean(el.closest(RtlFixer.EXTENSION_UI_SELECTOR));
    } catch (_) {
      return false;
    }
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
