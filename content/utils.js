// RTL Beautifier & Fixer - Utilities
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  const arabicScriptPair = new RegExp(`${RtlFixer.ARABIC_SCRIPT_REGEX.source}[\\s\\S]*?${RtlFixer.ARABIC_SCRIPT_REGEX.source}`, 'u');
  // The ordinary Persian/Arabic alphabet is the hot prose path. This exact
  // letter subset avoids Unicode-property work for common text; uncommon
  // supplement/presentation letters still use the complete script regex.
  const commonArabicPair = /[\u0620-\u064a\u0671-\u06d3][\s\S]*?[\u0620-\u064a\u0671-\u06d3]/;
  const letterRegex = /\p{Letter}/u;
  const markRegex = /\p{Mark}/u;
  // Character classifications are independent of page mutations. Cache them
  // once, rather than executing several Unicode regexes for every character
  // on every scan. ASCII takes a cheaper path and needs no cache entry.
  const characterKinds = new Uint8Array(0x10000);
  const astralKinds = new Map();
  const NEUTRAL = 1, LTR = 2, RTL = 3, ARABIC = 4, MARK = 5;
  const profiles = new Map();
  const nonAscii = /[^\x00-\x7f]/;
  let cachedCharacters = 0;
  const MAX_PROFILE_ENTRIES = 256, MAX_PROFILE_CHARACTERS = 65536, MAX_PROFILE_LENGTH = 2048;
  const simpleProseInlineTags = new Set(['SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'SMALL', 'MARK', 'A', 'SUB', 'SUP', 'BR', 'WBR']);
  RtlFixer._simpleProseShapes = RtlFixer._simpleProseShapes || new WeakMap();
  const inlineProseTagRegex = /^(SPAN|STRONG|EM|B|I|U|S|SMALL|MARK|A|SUB|SUP|BDI)$/;
  const inlineProseTags = 'span,strong,em,b,i,u,s,small,mark,a,sub,sup,bdi';
  let proseOwnerMathSelector = RtlFixer.MATH_CONTAINER_SELECTOR;
  let proseOwnerBoundarySelector = `:not(${inlineProseTags}),${proseOwnerMathSelector},:read-write`;

  function characterKind(code) {
    if (code < 128) return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ? LTR : NEUTRAL;
    const cached = code < 0x10000 ? characterKinds[code] : astralKinds.get(code);
    if (cached) return cached;
    const character = String.fromCodePoint(code);
    const kind = RtlFixer.ARABIC_SCRIPT_REGEX.test(character) ? ARABIC :
      RtlFixer.RTL_CHAR_REGEX.test(character) ? RTL :
      letterRegex.test(character) ? LTR : markRegex.test(character) ? MARK : NEUTRAL;
    if (code < 0x10000) characterKinds[code] = kind;
    else {
      if (astralKinds.size >= 256) astralKinds.delete(astralKinds.keys().next().value);
      astralKinds.set(code, kind);
    }
    return kind;
  }

  function directionProfile(text) {
    const cached = profiles.get(text);
    if (cached) return cached;
    let rtl = 0, ltr = 0, arabicWords = 0, firstStrong = null, wordHasArabic = false;
    // One pass counts letters and Arabic words without allocating match arrays.
    // The text itself is the key, so a streamed edit always gets a fresh result.
    for (let index = 0; index < text.length; index++) {
      const code = text.codePointAt(index);
      if (code > 0xffff) index++;
      const kind = characterKind(code);
      if (kind === LTR) {
        ltr++;
        firstStrong ||= 'ltr';
      } else if (kind === RTL || kind === ARABIC) {
        rtl++;
        firstStrong ||= 'rtl';
        if (kind === ARABIC && !wordHasArabic) {
          arabicWords++;
          wordHasArabic = true;
        }
      } else if (kind !== MARK && code !== 0x200c) {
        wordHasArabic = false;
      }
    }
    const profile = { rtl, ltr, firstStrong, arabicWords };
    if (text.length <= MAX_PROFILE_LENGTH) {
      while (profiles.size >= MAX_PROFILE_ENTRIES || cachedCharacters + text.length > MAX_PROFILE_CHARACTERS) {
        const oldest = profiles.keys().next().value;
        cachedCharacters -= oldest.length;
        profiles.delete(oldest);
      }
      profiles.set(text, profile);
      cachedCharacters += text.length;
    }
    return profile;
  }

  function profileIsRtlDominant({ rtl, ltr, firstStrong }) {
    if (rtl === 0) return false;
    if (ltr === 0) return true;
    const ratio = rtl / (rtl + ltr);
    return firstStrong === 'rtl' ? ratio >= 0.4 : rtl >= 4 && ratio >= 0.7;
  }
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

  // Determine dominance from strong letters, reusing bounded text profiles.
  RtlFixer.isRtlDominant = function (text) {
    if (!RtlFixer.RTL_CHAR_REGEX.test(text)) return false;
    return profileIsRtlDominant(directionProfile(text));
  };

  // Prose often starts with an English product name, identifier, or inline
  // code and then continues in Persian. In that context the first strong
  // character is not a reliable paragraph-direction signal. Two Arabic-script
  // letters are enough to identify a Persian prose fragment, while tables and
  // generic layout containers continue to use the stricter dominance check.
  RtlFixer.isRtlProse = function (text) {
    if (!text) return false;
    if (commonArabicPair.test(text)) return true;
    if (!RtlFixer.RTL_CHAR_REGEX.test(text)) return false;
    if (arabicScriptPair.test(text)) return true;
    return RtlFixer.isRtlDominant(text);
  };

  RtlFixer.isRtlTableText = function (text) {
    if (!RtlFixer.RTL_CHAR_REGEX.test(text)) return false;
    const profile = directionProfile(text);
    if (profileIsRtlDominant(profile)) return true;
    // Model names can outweigh a Persian sentence in a cell. A single foreign
    // label ("Status: فارسی") must still leave the surrounding LTR cell alone.
    return profile.arabicWords >= 2;
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
    if (!element || RtlFixer.isExtensionNode(element)) return '';
    const recordSimpleShape = /^(P|H[1-6])$/.test(element.tagName);
    let simpleShape = recordSimpleShape && !element.hasAttribute('contenteditable') && !element.shadowRoot;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // ChatGPT puts the Persian part of mixed headings inside <bdi>.
          // It is isolated for layout, but still determines the block's direction.
          if ((RtlFixer.IGNORED_TAGS.has(node.tagName) && node.tagName !== 'BDI') ||
              node.isContentEditable ||
              node.matches(RtlFixer.MATH_CONTAINER_SELECTOR) ||
              node.matches(RtlFixer.EXTENSION_UI_SELECTOR)) {
            simpleShape = false;
            return NodeFilter.FILTER_REJECT;
          }
          if (simpleShape) {
            const childDirection = node.getAttribute('dir');
            if (!simpleProseInlineTags.has(node.tagName) || node.shadowRoot || node.hasAttribute('contenteditable') ||
                (childDirection && childDirection.toLowerCase() !== 'auto')) simpleShape = false;
          }
          if ((element.tagName === 'LI' && node.tagName === 'LI') ||
              ((element.tagName === 'TD' || element.tagName === 'TH') &&
               (node.tagName === 'TD' || node.tagName === 'TH'))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
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
    if (recordSimpleShape) {
      // Reuse this already-required text walk to describe a paragraph's shape.
      // Consumers must inspect the paragraph freshly and match this epoch;
      // nested code/math/editors or structural moves keep the full scan path.
      RtlFixer._simpleProseShapes.set(element, {
        simple: simpleShape,
        structuralVersion: RtlFixer._domStructureMutationVersion || 0
      });
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

  let simpleProseGuardKey = '', simpleProseGuard = '';
  RtlFixer.getSimpleProseText = function (element) {
    if (!RtlFixer._simpleProseShapes.get(element)?.simple ||
        element.hasAttribute('contenteditable') || element.shadowRoot) return null;
    const key = RtlFixer.MATH_CONTAINER_SELECTOR + RtlFixer.EXTENSION_UI_SELECTOR;
    if (key !== simpleProseGuardKey) {
      simpleProseGuardKey = key;
      simpleProseGuard = `:not(${[...simpleProseInlineTags].join(',').toLowerCase()}),` +
        '[contenteditable],[dir]:not([dir="auto" i]),' +
        RtlFixer.MATH_CONTAINER_SELECTOR + ',' + RtlFixer.EXTENSION_UI_SELECTOR;
    }
    // Native selectors revalidate class/role/editor changes even when no
    // childList mutation occurred. textContent is safe only for ordinary prose;
    // math, code, isolated directions and widgets keep their full text walk.
    if (element.matches(RtlFixer.MATH_CONTAINER_SELECTOR + ',' + RtlFixer.EXTENSION_UI_SELECTOR) ||
        element.querySelector(simpleProseGuard)) return null;
    // attachShadow emits no light-DOM mutation, including on an existing span.
    for (const child of element.querySelectorAll('*')) if (child.shadowRoot) return null;
    return element.textContent || '';
  };

  RtlFixer.isProseBlockElement = function (element) {
    return Boolean(element && /^(P|LI|H[1-6]|DT|DD|BLOCKQUOTE|TD|TH)$/.test(element.tagName));
  };

  // Markdown's formatting wrappers share their paragraph's bidi context.
  // Stop at layout containers, code, and math instead of promoting app chrome.
  RtlFixer.getInlineProseOwner = function (element) {
    if (!element || !inlineProseTagRegex.test(element.tagName)) return null;
    if (proseOwnerMathSelector !== RtlFixer.MATH_CONTAINER_SELECTOR) {
      proseOwnerMathSelector = RtlFixer.MATH_CONTAINER_SELECTOR;
      proseOwnerBoundarySelector = `:not(${inlineProseTags}),${proseOwnerMathSelector},:read-write`;
    }
    // Native closest stops at the first non-formatting wrapper, mathematical
    // marker or editable node. One ancestry query replaces a full math-selector
    // match and editing-state read at every level of nested Markdown formatting.
    // :read-write respects plaintext-only and contenteditable=false boundaries.
    const owner = element.closest(proseOwnerBoundarySelector);
    return RtlFixer.isProseBlockElement(owner) && owner !== element && !owner.isContentEditable &&
      !owner.matches(proseOwnerMathSelector) ? owner : null;
  };

  RtlFixer.isSafeAutoTarget = function (element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (RtlFixer.STRUCTURAL_TAGS.has(element.tagName)) return false;
    // Paragraphs/headings remain prose even with many formatting or citation
    // spans. The layout-container limit used to reject long ChatGPT answers.
    if (/^(P|H[1-6])$/.test(element.tagName)) return true;
    // Avoid turning app roots/cards with a small direct label into RTL containers.
    if (element.childElementCount > 12) return false;
    // querySelectorAll('*') materialized every descendant for every candidate.
    // Stop as soon as the safety threshold is crossed instead.
    const proseBlock = RtlFixer.isProseBlockElement(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => proseBlock && node.matches?.(RtlFixer.MATH_CONTAINER_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    });
    let descendants = 0;
    while (walker.nextNode()) {
      descendants++;
      if (descendants > 40) return false;
    }
    return true;
  };

  // Check if string contains any RTL characters
  RtlFixer.containsRtl = function (text) {
    return nonAscii.test(text) && RtlFixer.RTL_CHAR_REGEX.test(text);
  };

  // Inputs ignore leading emoji, digits and punctuation, including non-ASCII
  // punctuation. A leading RTL letter is conclusive without counting the rest.
  RtlFixer.detectParagraphDirection = function (text) {
    if (!RtlFixer.RTL_CHAR_REGEX.test(text)) return 'ltr';
    for (let index = 0; index < text.length; index++) {
      const code = text.codePointAt(index);
      if (code > 0xffff) index++;
      const kind = characterKind(code);
      if (kind === RTL || kind === ARABIC) return 'rtl';
      if (kind === LTR) break;
    }
    const { rtl, ltr } = directionProfile(text);
    return rtl > ltr ? 'rtl' : 'ltr';
  };
})(window.RtlFixer);
