// RTL Beautifier & Fixer - Utilities
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  // Check if a node is inside a math container
  RtlFixer.isInsideMathContainer = function (node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;
    return el.closest(RtlFixer.MATH_CONTAINER_SELECTOR) !== null;
  };

  // Find the nearest block-level container
  RtlFixer.getBlockContainer = function (element) {
    let parent = element;
    let depth = 0;
    while (parent && parent !== document.body && depth < 50) {
      if (RtlFixer.BLOCK_TAGS.has(parent.tagName)) return parent;
      parent = parent.parentElement;
      depth++;
    }
    return null;
  };

  // Highly optimized single-pass ancestor search for lists, blockquotes, tables, and blocks
  RtlFixer.findSpecialAncestors = function (element) {
    let parent = element;
    let blockContainer = null;
    let liAncestor = null;
    let blockquoteAncestor = null;
    let tableCell = null;
    let tableAncestor = null;
    let depth = 0;

    while (parent && parent !== document.body && depth < 50) {
      const tagName = parent.tagName;
      
      if (!blockContainer && RtlFixer.BLOCK_TAGS.has(tagName)) {
        blockContainer = parent;
      }
      if (!liAncestor && tagName === 'LI') {
        liAncestor = parent;
      }
      if (!blockquoteAncestor && tagName === 'BLOCKQUOTE') {
        blockquoteAncestor = parent;
      }
      if (!tableCell && (tagName === 'TD' || tagName === 'TH')) {
        tableCell = parent;
      }
      if (!tableAncestor && tagName === 'TABLE') {
        tableAncestor = parent;
      }

      parent = parent.parentElement;
      depth++;
    }

    return {
      blockContainer,
      liAncestor,
      blockquoteAncestor,
      tableCell,
      tableAncestor
    };
  };

  // Determine direction dominance based on character ratios (bulk optimized via native RegExp)
  RtlFixer.isRtlDominant = function (text) {
    if (!RtlFixer.RTL_CHAR_REGEX.test(text)) return false;

    const rtlMatches = text.match(RtlFixer.RTL_CHAR_GLOBAL_REGEX);
    const ltrMatches = text.match(RtlFixer.LTR_CHAR_GLOBAL_REGEX);

    const rtl = rtlMatches ? rtlMatches.length : 0;
    const ltr = ltrMatches ? ltrMatches.length : 0;

    if (rtl === 0) return false;
    if (ltr === 0) return true;

    let firstStrong = null;
    for (const char of text) {
      if (RtlFixer.RTL_CHAR_REGEX.test(char)) {
        firstStrong = 'rtl';
        break;
      }
      if (RtlFixer.STRONG_LTR_CHAR.test(char)) {
        firstStrong = 'ltr';
        break;
      }
    }

    const ratio = rtl / (rtl + ltr);
    if (firstStrong === 'rtl') return ratio >= 0.4;
    return rtl >= 4 && ratio >= 0.7;
  };

  // Prose often starts with an English product name, identifier, or inline
  // code and then continues in Persian. In that context the first strong
  // character is not a reliable paragraph-direction signal. Two Arabic-script
  // letters are enough to identify a Persian prose fragment, while tables and
  // generic layout containers continue to use the stricter dominance check.
  RtlFixer.isRtlProse = function (text) {
    if (!text || !RtlFixer.RTL_CHAR_REGEX.test(text)) return false;
    const arabicMatches = text.match(new RegExp(RtlFixer.ARABIC_SCRIPT_REGEX.source, 'g'));
    if (arabicMatches && arabicMatches.length >= 2) return true;
    return RtlFixer.isRtlDominant(text);
  };

  RtlFixer.getDirectText = function (element) {
    if (!element || !element.childNodes) return '';
    let text = '';
    element.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    });
    return text.trim();
  };

  // Text used for list items, blockquotes and table cells may be wrapped in
  // <p>/<span> by Markdown renderers. Read that text without leaking into
  // code, editors, math, or nested list items.
  RtlFixer.getContainedDirectionalText = function (element) {
    if (!element) return '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        let parent = node.parentElement;
        while (parent && parent !== element) {
          if (RtlFixer.IGNORED_TAGS.has(parent.tagName) || parent.isContentEditable ||
              (parent.matches && parent.matches(RtlFixer.MATH_CONTAINER_SELECTOR))) {
            return NodeFilter.FILTER_REJECT;
          }
          if ((element.tagName === 'LI' && parent.tagName === 'LI') ||
              ((element.tagName === 'TD' || element.tagName === 'TH') &&
               (parent.tagName === 'TD' || parent.tagName === 'TH'))) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text) parts.push(text);
    }
    return parts.join(' ');
  };

  RtlFixer.getDirectionalText = function (element) {
    if (!element) return '';
    // Markdown renderers commonly put the leading English phrase in <a>,
    // <strong>, or <code>. Read descendants for actual prose blocks so the
    // block direction does not depend only on its unwrapped text nodes.
    if (RtlFixer.isProseBlockElement(element)) {
      return RtlFixer.getContainedDirectionalText(element);
    }
    return RtlFixer.getDirectText(element);
  };

  RtlFixer.isProseBlockElement = function (element) {
    return Boolean(element && /^(P|LI|H[1-6]|DT|DD|BLOCKQUOTE)$/.test(element.tagName));
  };

  RtlFixer.isSafeAutoTarget = function (element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (RtlFixer.STRUCTURAL_TAGS.has(element.tagName)) return false;
    // Avoid turning app roots/cards with a small direct label into RTL containers.
    if (element.childElementCount > 12 || element.querySelectorAll('*').length > 40) return false;
    return true;
  };

  // Check if string contains any RTL characters
  RtlFixer.containsRtl = function (text) {
    return RtlFixer.RTL_CHAR_REGEX.test(text);
  };

  // Detect direction of text (used dynamically for inputs, bulk optimized)
  RtlFixer.detectParagraphDirection = function (text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 'ltr';

    let firstMeaningfulIsRtl = null;

    // Find the first meaningful character (looping is fine as it stops early)
    for (const char of trimmed) {
      if (RtlFixer.EMOJI_REGEX.test(char) || RtlFixer.IGNORABLE_CHAR_REGEX.test(char)) {
        continue;
      }
      firstMeaningfulIsRtl = RtlFixer.RTL_CHAR_REGEX.test(char);
      break;
    }

    if (firstMeaningfulIsRtl === null) {
      return 'ltr';
    }

    // If first meaningful is RTL, it is RTL instantly
    if (firstMeaningfulIsRtl === true) {
      return 'rtl';
    }

    // Otherwise, check percentage of RTL characters
    const rtlMatches = trimmed.match(RtlFixer.RTL_CHAR_GLOBAL_REGEX);
    const ltrMatches = trimmed.match(RtlFixer.LTR_CHAR_GLOBAL_REGEX);

    const rtlCount = rtlMatches ? rtlMatches.length : 0;
    const ltrCount = ltrMatches ? ltrMatches.length : 0;

    const totalRelevant = rtlCount + ltrCount;
    if (totalRelevant > 0) {
      const rtlPercentage = (rtlCount / totalRelevant) * 100;
      if (rtlPercentage > 50) {
        return 'rtl';
      }
    }

    return 'ltr';
  };
})(window.RtlFixer);
