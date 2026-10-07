// RTL Beautifier & Fixer - DOM Mutation Logic
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  const MUTATED_STYLE_PROPERTIES = [
    'direction', 'text-align', 'unicode-bidi',
    'padding-left', 'padding-right', 'padding-inline-start', 'padding-inline-end',
    'border-left', 'border-right', 'border-inline-start', 'border-inline-end',
    'margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end'
  ];

  RtlFixer._originalElementState = RtlFixer._originalElementState || new WeakMap();
  RtlFixer._managedElements = RtlFixer._managedElements || new Set();
  RtlFixer._managedMathElements = RtlFixer._managedMathElements || new Set();
  RtlFixer._terminalLatinLabels = RtlFixer._terminalLatinLabels || new Set();
  RtlFixer._digitState = RtlFixer._digitState || new WeakMap();
  RtlFixer._managedDigitNodes = RtlFixer._managedDigitNodes || new Set();
  RtlFixer._isolateElements = RtlFixer._isolateElements || new Set();
  RtlFixer._bionicElements = RtlFixer._bionicElements || new Set();
  RtlFixer._observedShadowRoots = RtlFixer._observedShadowRoots || new WeakSet();
  const listDirectionCache = new WeakMap();
  let tableDirectionCache = new WeakMap();

  RtlFixer.resetTableDirectionCache = function () {
    tableDirectionCache = new WeakMap();
  };

  function observeShadowRoot(root) {
    if (!root || !RtlFixer.observer || RtlFixer._observedShadowRoots.has(root)) return;
    RtlFixer.observer.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['dir']
    });
    RtlFixer._observedShadowRoots.add(root);
  }

  RtlFixer.captureOriginalState = function (el) {
    if (!el || RtlFixer._originalElementState.has(el)) return;
    const styles = {};
    MUTATED_STYLE_PROPERTIES.forEach(property => {
      styles[property] = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property)
      };
    });
    RtlFixer._originalElementState.set(el, {
      hadDir: el.hasAttribute('dir'),
      dir: el.getAttribute('dir'),
      computedDirection: getComputedStyle(el).direction,
      computedTextAlign: getComputedStyle(el).textAlign,
      styles,
      writtenDir: null,
      writtenStyles: {}
    });
    RtlFixer._managedElements.add(el);
  };

  RtlFixer.setManagedDir = function (el, value) {
    RtlFixer.captureOriginalState(el);
    const state = RtlFixer._originalElementState.get(el);
    if (state.writtenDir) {
      const currentHadDir = el.hasAttribute('dir');
      const currentDir = el.getAttribute('dir');
      if (currentHadDir !== state.writtenDir.hadDir || currentDir !== state.writtenDir.value) {
        state.hadDir = currentHadDir;
        state.dir = currentDir;
      }
    }
    if (value === null) {
      if (el.hasAttribute('dir')) el.removeAttribute('dir');
    } else if (el.getAttribute('dir') !== value) {
      el.setAttribute('dir', value);
    }
    state.writtenDir = { hadDir: value !== null, value };
  };

  RtlFixer.setManagedStyle = function (el, property, value, priority = '') {
    RtlFixer.captureOriginalState(el);
    const state = RtlFixer._originalElementState.get(el);
    const previousWrite = state.writtenStyles[property];
    if (previousWrite &&
        (el.style.getPropertyValue(property) !== previousWrite.value ||
         el.style.getPropertyPriority(property) !== previousWrite.priority)) {
      state.styles[property] = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property)
      };
    }
    if (value === null || value === '') el.style.removeProperty(property);
    else el.style.setProperty(property, value, priority);
    state.writtenStyles[property] = {
      value: el.style.getPropertyValue(property),
      priority: el.style.getPropertyPriority(property)
    };
  };

  RtlFixer.restoreOriginalState = function (el) {
    const state = RtlFixer._originalElementState.get(el);
    if (!state) return;
    if (state.writtenDir &&
        el.hasAttribute('dir') === state.writtenDir.hadDir &&
        el.getAttribute('dir') === state.writtenDir.value) {
      if (state.hadDir) el.setAttribute('dir', state.dir);
      else el.removeAttribute('dir');
    }
    Object.entries(state.writtenStyles).forEach(([property, written]) => {
      if (el.style.getPropertyValue(property) !== written.value ||
          el.style.getPropertyPriority(property) !== written.priority) return;
      const original = state.styles[property];
      if (original && original.value) el.style.setProperty(property, original.value, original.priority);
      else el.style.removeProperty(property);
    });
    if (el.style.length === 0) el.removeAttribute('style');
    RtlFixer._originalElementState.delete(el);
    RtlFixer._managedElements.delete(el);
  };

  RtlFixer.clearManagedElement = function (el) {
    if (!el) return;
    el.classList.remove(
      'rtl-fixer-target', 'rtl-fixer-right-align', 'rtl-fixer-force-rtl',
      'rtl-fixer-unicode-fix', 'rtl-fixer-rtl-detected', 'rtl-fixer-custom-bullet', 'rtl-fixer-typography-root',
      'rtl-fixer-justify', 'rtl-fixer-li-processed', 'rtl-fixer-cell-processed',
      'rtl-fixer-list-processed', 'rtl-fixer-blockquote-processed', 'rtl-fixer-table-processed',
      'rtl-fixer-table-layout-guard'
    );
    RtlFixer.restoreOriginalState(el);
  };

  function areAllListItemsRtl(list) {
    if (!list) return false;
    const mutationVersion = RtlFixer._domMutationVersion || 0;
    const cached = listDirectionCache.get(list);
    if (cached && cached.version === mutationVersion) return cached.result;
    const items = Array.from(list.children)
      .filter(child => child.tagName === 'LI')
      .map(child => RtlFixer.getContainedDirectionalText(child))
      .filter(Boolean);
    const result = items.length > 0 && items.every(text => RtlFixer.isRtlProse(text));
    listDirectionCache.set(list, { version: mutationVersion, result });
    return result;
  }

  function getTablesInSubtree(root) {
    if (!root) return [];
    const tables = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.tagName === 'TABLE') tables.push(root);
    if (root.querySelectorAll) tables.push(...root.querySelectorAll('table'));
    return tables;
  }

  function guardTableLayout(table, baseline) {
    if (!baseline || baseline.explicitDir || baseline.direction !== 'ltr') return;
    table.classList.add('rtl-fixer-table-layout-guard');
    RtlFixer.setManagedStyle(table, 'direction', 'ltr', 'important');
  }

  function rememberTableDirections(root) {
    if (!(RtlFixer.config || RtlFixer.DEFAULT_CONFIG).fixTables) return;
    getTablesInSubtree(root).forEach(table => {
      // Capture cell alignment before any response wrapper or cell is changed.
      table.querySelectorAll('td,th').forEach(RtlFixer.captureOriginalState);
      if (tableDirectionCache.has(table)) return;

      const explicitDir = table.hasAttribute('dir') && table.getAttribute('dir') !== 'auto';
      const inlineDirection = table.style.getPropertyValue('direction');
      let direction = getComputedStyle(table).direction;

      // A table inserted later into an element already managed by us inherits
      // that element's written RTL direction. Recover the ancestor's original
      // direction so the new table keeps its pre-extension column order.
      const managedAncestor = table.parentElement?.closest('.rtl-fixer-target');
      if (!explicitDir && !inlineDirection && direction === 'rtl') {
        const ancestorState = managedAncestor
          ? RtlFixer._originalElementState.get(managedAncestor)
          : null;
        if (ancestorState?.computedDirection) direction = ancestorState.computedDirection;
      }

      const baseline = { direction, explicitDir: explicitDir || Boolean(inlineDirection) };
      tableDirectionCache.set(table, baseline);
      // Lazy AI replies may add a complete table after their answer wrapper is
      // already managed. Guard it immediately using the wrapper's baseline.
      if (managedAncestor) guardTableLayout(table, baseline);
    });
  }

  function preserveDescendantTableDirections(element) {
    if (!(RtlFixer.config || RtlFixer.DEFAULT_CONFIG).fixTables) return;
    getTablesInSubtree(element).forEach(table => {
      const baseline = tableDirectionCache.get(table);
      guardTableLayout(table, baseline);
    });
  }

  function getPhysicalTextAlign(state) {
    if (!state) return null;
    const alignment = state.computedTextAlign;
    const direction = state.computedDirection === 'rtl' ? 'rtl' : 'ltr';
    if (alignment === 'start' || alignment === '-webkit-match-parent' || alignment === 'match-parent') {
      return direction === 'rtl' ? 'right' : 'left';
    }
    if (alignment === 'end') return direction === 'rtl' ? 'left' : 'right';
    if (alignment === 'left' || alignment === 'right' || alignment === 'center' || alignment === 'justify') {
      return alignment;
    }
    return null;
  }

  function reconcileSpecialAncestors(element) {
    const li = element.closest?.('li');
    if (li && li.classList.contains('rtl-fixer-li-processed') &&
        !RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(li))) {
      RtlFixer.clearManagedElement(li);
    }
    const list = li?.parentElement;
    if (list && list.classList.contains('rtl-fixer-list-processed') && !areAllListItemsRtl(list)) {
      RtlFixer.clearManagedElement(list);
    }
    const blockquote = element.closest?.('blockquote');
    if (blockquote && blockquote.classList.contains('rtl-fixer-blockquote-processed') &&
        !RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(blockquote))) {
      RtlFixer.clearManagedElement(blockquote);
    }
    const cell = element.closest?.('td, th');
    if (cell && cell.classList.contains('rtl-fixer-cell-processed') &&
        !RtlFixer.isRtlTableText(RtlFixer.getContainedDirectionalText(cell))) {
      RtlFixer.clearManagedElement(cell);
    }
  }

  RtlFixer.pruneDisconnectedState = function () {
    Array.from(RtlFixer._managedElements).forEach(el => {
      if (!el.isConnected) RtlFixer.clearManagedElement(el);
    });
    RtlFixer._managedDigitNodes.forEach(node => {
      if (node.isConnected) return;
      const state = RtlFixer._digitState.get(node);
      if (state && node.textContent === state.written) node.textContent = state.original;
      RtlFixer._digitState.delete(node);
      RtlFixer._managedDigitNodes.delete(node);
    });
    RtlFixer._managedMathElements.forEach(el => {
      if (!el.isConnected) RtlFixer._managedMathElements.delete(el);
    });
    RtlFixer._terminalLatinLabels.forEach(el => {
      if (!el.isConnected) RtlFixer._terminalLatinLabels.delete(el);
    });
    Array.from(RtlFixer._isolateElements).forEach(el => {
      if (el.isConnected) return;
      if (el.parentNode) el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
      RtlFixer._isolateElements.delete(el);
    });
    Array.from(RtlFixer._bionicElements).forEach(el => {
      if (el.isConnected) return;
      if (el.parentNode) el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
      RtlFixer._bionicElements.delete(el);
    });
  };

  function isSensitiveTextNode(node, root) {
    let parent = node.parentElement;
    while (parent) {
      if (RtlFixer.IGNORED_TAGS.has(parent.tagName) ||
          parent.classList.contains('rtl-fixer-bionic') ||
          parent.isContentEditable ||
          (parent.matches && parent.matches(RtlFixer.MATH_CONTAINER_SELECTOR))) return true;
      if (parent === root) break;
      parent = parent.parentElement;
    }
    return false;
  }

  function createSafeTextWalker(element) {
    return document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => isSensitiveTextNode(node, element)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    });
  }

  // Wrap embedded Latin/technical runs in <bdi dir="ltr" class="rtl-fixer-isolate">
  RtlFixer.isolateLtrRunsInTextNode = function (textNode) {
    const text = textNode.textContent;
    
    // Quick exit if there are no LTR characters to isolate
    if (!RtlFixer.STRONG_LTR_CHAR.test(text)) return;

    RtlFixer.LTR_RUN_REGEX.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = RtlFixer.LTR_RUN_REGEX.exec(text)) !== null) {
      let matchedText = match[0];
      let startIndex = match.index;

      // Require that the matched LTR run contains at least one Latin letter
      // to avoid wrapping isolated punctuation, numbers, or quotes on their own.
      if (/[A-Za-z]/.test(matchedText)) {
        // Trim leading punctuation/operators/spaces
        const leadTrimMatch = matchedText.match(/^[\s=+\*|&:,;!?.]+/);
        if (leadTrimMatch) {
          const trimLen = leadTrimMatch[0].length;
          matchedText = matchedText.slice(trimLen);
          startIndex += trimLen;
        }

        // Trim leading hyphens only if they are not followed by an alphanumeric
        const leadHyphenMatch = matchedText.match(/^-+/);
        if (leadHyphenMatch && !/^[0-9A-Za-z]/.test(matchedText.slice(leadHyphenMatch[0].length))) {
          const trimLen = leadHyphenMatch[0].length;
          matchedText = matchedText.slice(trimLen);
          startIndex += trimLen;
        }

        // Trim trailing punctuation/operators/spaces/hyphens
        const trailTrimMatch = matchedText.match(/[\s=+\*|&:,;!?.-]+$/);
        if (trailTrimMatch) {
          matchedText = matchedText.slice(0, matchedText.length - trailTrimMatch[0].length);
        }

        // Only add if the trimmed text still contains at least one Latin letter
        if (/[A-Za-z]/.test(matchedText)) {
          matches.push({
            text: matchedText,
            index: startIndex
          });
        }
      }
    }
    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      const start = m.index;
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      const bdi = document.createElement('bdi');
      bdi.setAttribute('dir', 'ltr');
      bdi.className = 'rtl-fixer-isolate';
      bdi.textContent = m.text;
      RtlFixer._isolateElements.add(bdi);
      frag.appendChild(bdi);
      last = start + m.text.length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  };

  // Translate English digits to Persian digits
  RtlFixer.translateDigitsToPersian = function (textNode) {
    const text = textNode.textContent;
    const replaced = text.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    if (replaced !== text) {
      const oldState = RtlFixer._digitState.get(textNode);
      const original = oldState && text === oldState.written ? oldState.original : text;
      textNode.textContent = replaced;
      RtlFixer._digitState.set(textNode, { original, written: replaced });
      RtlFixer._managedDigitNodes.add(textNode);
    }
  };

  // Helper to set direction and related class names
  RtlFixer.setDirection = function (el, isRtl) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    RtlFixer.captureOriginalState(el);
    const original = RtlFixer._originalElementState.get(el);
    if (original && original.writtenDir) {
      const changedBySite = el.hasAttribute('dir') !== original.writtenDir.hadDir ||
        el.getAttribute('dir') !== original.writtenDir.value;
      if (changedBySite) {
        original.hadDir = el.hasAttribute('dir');
        original.dir = el.getAttribute('dir');
        original.writtenDir = null;
      }
    }
    const siteHasExplicitDirection = original && original.hadDir && original.dir !== 'auto';
    if (config.alignmentMode === 'auto' && siteHasExplicitDirection) {
      el.classList.remove('rtl-fixer-rtl-detected', 'rtl-fixer-force-rtl');
      return;
    }
    if (config.alignmentMode === 'force-rtl') {
      if (!siteHasExplicitDirection) RtlFixer.setManagedDir(el, 'rtl');
      el.classList.add('rtl-fixer-force-rtl', 'rtl-fixer-rtl-detected');
    } else if (config.alignmentMode === 'auto') {
      if (isRtl) {
        if (!siteHasExplicitDirection) RtlFixer.setManagedDir(el, 'rtl');
        el.classList.add('rtl-fixer-rtl-detected');
      } else {
        el.classList.remove('rtl-fixer-rtl-detected', 'rtl-fixer-force-rtl');
        if (!siteHasExplicitDirection) RtlFixer.setManagedDir(el, 'auto');
      }
    }
  };

  // Apply RTL fixes to a specific element and its nearest block parent
  RtlFixer.applyRtlToElement = function (element) {
    if (!RtlFixer._isActive) return; // Guard: don't modify DOM when deactivated
    // Bionic spans split one word into styled fragments. Giving either fragment
    // its own bidi isolate changes the order of mixed Persian/Latin sentences.
    if (element.closest?.('.rtl-fixer-bionic')) return;
    if (!RtlFixer.isSafeAutoTarget(element)) {
      if (element.classList.contains('rtl-fixer-target')) RtlFixer.clearManagedElement(element);
      return;
    }

    // Never apply RTL fixes to elements inside math containers
    if (RtlFixer.isInsideMathContainer(element)) return;

    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const directText = RtlFixer.getDirectText(element);
    const directionalText = RtlFixer.getDirectionalText(element);
    const isProseBlock = RtlFixer.isProseBlockElement(element);
    const isRtl = /^(TD|TH)$/.test(element.tagName)
      ? RtlFixer.isRtlTableText(directionalText)
      : isProseBlock
      ? RtlFixer.isRtlProse(directionalText)
      : RtlFixer.isRtlDominant(directionalText);
    if (config.alignmentMode !== 'force-rtl' && !isRtl) {
      RtlFixer.clearManagedElement(element);
      reconcileSpecialAncestors(element);
      return;
    }

    const proseOwner = RtlFixer.getInlineProseOwner(element);
    const original = RtlFixer._originalElementState.get(element);
    const siteDir = original ? original.dir : element.getAttribute('dir');
    const inheritProseDirection = proseOwner?.classList.contains('rtl-fixer-rtl-detected') &&
      (!siteDir || siteDir === 'auto');
    if (inheritProseDirection) {
      // Isolating every span disconnects whitespace and English runs across
      // formatting boundaries. Keep the site's nodes in one paragraph flow.
      RtlFixer.clearManagedElement(element);
    } else {
      RtlFixer.captureOriginalState(element);
      element.classList.add('rtl-fixer-target', 'rtl-fixer-unicode-fix');
      element.classList.toggle('rtl-fixer-typography-root', !element.parentElement?.closest('.rtl-fixer-target'));
    }
    const containingCell = config.fixTables ? element.closest('td,th') : null;
    if (containingCell) RtlFixer.captureOriginalState(containingCell);

    // Isolate English words/codes BEFORE measuring dominance so isolation markers don't skew counts
    if (config.isolateLtrRuns === true) {
      const textNodes = [];
      const walker = createSafeTextWalker(element);
      let n;
      while ((n = walker.nextNode())) {
        if (n.parentElement === element) textNodes.push(n);
      }
      textNodes.forEach(RtlFixer.isolateLtrRunsInTextNode);
    }

    // NOTE: Arrow flipping (flipArrowsInElement) is intentionally DISABLED.
    // It caused a double-flip cycle on dynamic pages: when text changes,
    // the observer re-processes elements, flipping already-flipped arrows back,
    // creating an infinite flip-flop. CSS direction handles visual arrow
    // rendering sufficiently without modifying text content.

    // Translate English digits to Persian digits in RTL text nodes if enabled
    if (config.persianDigits && RtlFixer.ARABIC_SCRIPT_REGEX.test(directText)) {
      const rtlTextNodes = [];
      const walker2 = createSafeTextWalker(element);
      let n2;
      while ((n2 = walker2.nextNode())) {
        if (n2.parentElement === element &&
            RtlFixer.ARABIC_SCRIPT_REGEX.test(n2.textContent) &&
            !n2.parentNode.classList.contains('rtl-fixer-isolate')) {
          rtlTextNodes.push(n2);
        }
      }
      rtlTextNodes.forEach(RtlFixer.translateDigitsToPersian);
    }

    if (config.bionicTextEnabled) {
      const bionicNodes = [];
      const walker3 = createSafeTextWalker(element);
      let n3;
      while ((n3 = walker3.nextNode())) {
        if (n3.parentElement === element && RtlFixer.containsRtl(n3.textContent) &&
            !n3.parentNode.classList.contains('rtl-fixer-isolate') && !n3.parentNode.classList.contains('rtl-fixer-bionic')) {
          bionicNodes.push(n3);
        }
      }
      bionicNodes.forEach(RtlFixer.applyBionicReading);
    }

    if (inheritProseDirection) return;

    // Changing a response/card wrapper to RTL must not reverse the visual
    // order of Markdown-table columns nested inside it.
    preserveDescendantTableDirections(element);
    RtlFixer.setDirection(element, isRtl);

    element.classList.toggle('rtl-fixer-right-align', Boolean(config.forceRightAlign && isRtl));
    element.classList.toggle('rtl-fixer-justify', Boolean(config.justifyText && isRtl));

    if (containingCell) {
      const alignment = getPhysicalTextAlign(RtlFixer._originalElementState.get(containingCell));
      if (alignment) RtlFixer.setManagedStyle(element, 'text-align', alignment, 'important');
    }

    // Find all special ancestors in a single upward traversal (Optimized)
    const ancestors = RtlFixer.findSpecialAncestors(element);

    // Do not propagate direction to parents. Each block is evaluated from its
    // own direct text so a small RTL child cannot flip a large container.

    // LI bullet point and list padding/margin fixing logic
    if (config.fixListsBlockquotes && ancestors.liAncestor &&
        RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(ancestors.liAncestor))) {
        const li = ancestors.liAncestor;
      if (!li.classList.contains('rtl-fixer-li-processed')) {
        RtlFixer.captureOriginalState(li);
        li.classList.add('rtl-fixer-li-processed');
        // Read style BEFORE setting direction to RTL!
        const computedLiStyle = window.getComputedStyle(li);
        const liPadLeft = computedLiStyle.paddingLeft;
        const liMarginLeft = computedLiStyle.marginLeft;

        li.classList.add('rtl-fixer-target', 'rtl-fixer-unicode-fix');
        RtlFixer.setDirection(li, true);

        // Check if this list item has a custom CSS bullet (e.g. Tailwind Prose ::before)
        const beforeStyle = window.getComputedStyle(li, '::before');
        const beforeContent = beforeStyle ? beforeStyle.content : null;
        const hasCustomBullet = beforeContent && 
                               beforeContent !== 'none' && 
                               beforeContent !== 'normal' && 
                               beforeContent !== '""' && 
                               beforeContent !== "''" && 
                               beforeContent.trim() !== '';

        if (hasCustomBullet) {
          li.classList.add('rtl-fixer-custom-bullet');
        }

        // Logical properties inline-start / inline-end
        if (liPadLeft && liPadLeft !== '0px') {
          RtlFixer.setManagedStyle(li, 'padding-left', '0', 'important');
          RtlFixer.setManagedStyle(li, 'padding-right', '0', 'important');
          RtlFixer.setManagedStyle(li, 'padding-inline-start', liPadLeft, 'important');
          RtlFixer.setManagedStyle(li, 'padding-inline-end', '0', 'important');
        }

        if (liMarginLeft && liMarginLeft !== '0px' && liMarginLeft !== 'auto') {
          RtlFixer.setManagedStyle(li, 'margin-left', '0', 'important');
          RtlFixer.setManagedStyle(li, 'margin-right', '0', 'important');
          RtlFixer.setManagedStyle(li, 'margin-inline-start', liMarginLeft, 'important');
          RtlFixer.setManagedStyle(li, 'margin-inline-end', '0', 'important');
        }

        const parentList = li.parentElement;
        if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] liAncestor found:', li.tagName, 'parentList:', parentList ? parentList.tagName : 'null');
        const allItemsRtl = areAllListItemsRtl(parentList);
        if (allItemsRtl && parentList && (parentList.tagName === 'UL' || parentList.tagName === 'OL') && !parentList.classList.contains('rtl-fixer-list-processed')) {
          if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Processing parentList:', parentList.tagName, 'classes:', parentList.className);
          
          // Read style BEFORE setting direction to RTL!
          const computedListStyle = window.getComputedStyle(parentList);
          const listPadLeft = computedListStyle.paddingLeft;
          const listMarginLeft = computedListStyle.marginLeft;
 
          RtlFixer.captureOriginalState(parentList);
          parentList.classList.add('rtl-fixer-target', 'rtl-fixer-unicode-fix', 'rtl-fixer-list-processed');
          RtlFixer.setDirection(parentList, true);
 
          if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] listPadLeft:', listPadLeft, 'listMarginLeft:', listMarginLeft);
 
          if (listPadLeft && listPadLeft !== '0px') {
            if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Removing padding-left');
            RtlFixer.setManagedStyle(parentList, 'padding-left', '0', 'important');
            RtlFixer.setManagedStyle(parentList, 'padding-right', '0', 'important');
            RtlFixer.setManagedStyle(parentList, 'padding-inline-start', listPadLeft, 'important');
            RtlFixer.setManagedStyle(parentList, 'padding-inline-end', '0', 'important');
          }

          if (listMarginLeft && listMarginLeft !== '0px' && listMarginLeft !== 'auto') {
            RtlFixer.setManagedStyle(parentList, 'margin-left', '0', 'important');
            RtlFixer.setManagedStyle(parentList, 'margin-right', '0', 'important');
            RtlFixer.setManagedStyle(parentList, 'margin-inline-start', listMarginLeft, 'important');
            RtlFixer.setManagedStyle(parentList, 'margin-inline-end', '0', 'important');
          }
        }
      }
    }

    // Blockquote border, margin, padding adjustments
    if (config.fixListsBlockquotes && ancestors.blockquoteAncestor &&
        RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(ancestors.blockquoteAncestor))) {
      const blockquote = ancestors.blockquoteAncestor;
      if (!blockquote.classList.contains('rtl-fixer-blockquote-processed')) {
        RtlFixer.captureOriginalState(blockquote);
        // Read style BEFORE setting direction to RTL!
        const computedStyle = window.getComputedStyle(blockquote);
        const borderLeftWidth = computedStyle.borderLeftWidth;
        const borderLeftStyle = computedStyle.borderLeftStyle;
        const borderLeftColor = computedStyle.borderLeftColor;
        const padLeft = computedStyle.paddingLeft;
        const marginLeft = computedStyle.marginLeft;

        blockquote.classList.add('rtl-fixer-target', 'rtl-fixer-unicode-fix', 'rtl-fixer-blockquote-processed');
        RtlFixer.setDirection(blockquote, true);

        if (borderLeftWidth && borderLeftWidth !== '0px' && borderLeftStyle !== 'none') {
          RtlFixer.setManagedStyle(blockquote, 'border-left', 'none', 'important');
          RtlFixer.setManagedStyle(blockquote, 'border-inline-start', `${borderLeftWidth} ${borderLeftStyle} ${borderLeftColor}`, 'important');
          RtlFixer.setManagedStyle(blockquote, 'border-inline-end', 'none', 'important');
        }

        if (padLeft && padLeft !== '0px') {
          RtlFixer.setManagedStyle(blockquote, 'padding-left', '0', 'important');
          RtlFixer.setManagedStyle(blockquote, 'padding-right', '0', 'important');
          RtlFixer.setManagedStyle(blockquote, 'padding-inline-start', padLeft, 'important');
          RtlFixer.setManagedStyle(blockquote, 'padding-inline-end', '0', 'important');
        }

        if (marginLeft && marginLeft !== '0px' && marginLeft !== 'auto') {
          RtlFixer.setManagedStyle(blockquote, 'margin-left', '0', 'important');
          RtlFixer.setManagedStyle(blockquote, 'margin-right', '0', 'important');
          RtlFixer.setManagedStyle(blockquote, 'margin-inline-start', marginLeft, 'important');
          RtlFixer.setManagedStyle(blockquote, 'margin-inline-end', '0', 'important');
        }
      }
    }

    // Table direction and cell alignment adjustments
    if (config.fixTables) {
      if (ancestors.tableCell && RtlFixer.isRtlTableText(RtlFixer.getContainedDirectionalText(ancestors.tableCell))) {
        const cell = ancestors.tableCell;
        if (!cell.classList.contains('rtl-fixer-cell-processed')) {
          RtlFixer.captureOriginalState(cell);
          const originalCellState = RtlFixer._originalElementState.get(cell);
          cell.classList.add('rtl-fixer-cell-processed');
          cell.classList.add('rtl-fixer-target', 'rtl-fixer-unicode-fix');
          RtlFixer.setDirection(cell, true);

          // `text-align: start` changes physical edge when direction changes.
          // Preserve the site's original physical alignment so Persian headers
          // stay directly above numeric/English values in the same column.
          const physicalAlignment = getPhysicalTextAlign(originalCellState);
          if (physicalAlignment) {
            RtlFixer.setManagedStyle(cell, 'text-align', physicalAlignment, 'important');
          }
        }
      }

      // Never change TABLE/TR direction: doing so can reverse visual column order.
    }
  };

  RtlFixer.processMathTextInSubtree = function (root) {
    if (!root) return;
    const nearestMath = root.nodeType === Node.ELEMENT_NODE ? root.closest?.('.katex') : null;
    const mathRoots = new Set(nearestMath ? [nearestMath] : []);
    if (!nearestMath && root.querySelectorAll) {
      // Most formulas contain no prose. Visit only KaTeX text spans that have
      // Persian, plus formulas we marked earlier and may need to undo.
      root.querySelectorAll('.katex-html .mord.text, .katex.rtl-fixer-katex-ltr').forEach(candidate => {
        if (candidate.matches('.katex') || RtlFixer.containsRtl(candidate.textContent || '')) {
          const math = candidate.closest('.katex');
          if (math) mathRoots.add(math);
        }
      });
    }

    const mark = (el, className, enabled) => {
      if (el.classList.contains(className) !== enabled) el.classList.toggle(className, enabled);
      if (enabled) RtlFixer._managedMathElements.add(el);
      else if (!el.classList.contains('rtl-fixer-katex-ltr') &&
          !el.classList.contains('rtl-fixer-katex-rtl-text') &&
          !el.classList.contains('rtl-fixer-katex-rtl-box')) RtlFixer._managedMathElements.delete(el);
    };
    for (const math of mathRoots) {
      const rtlText = math.querySelectorAll('.katex-html .mord.text');
      let foundRtlText = false;
      for (const text of rtlText) {
        const isRtl = RtlFixer.containsRtl(text.textContent || '');
        mark(text, 'rtl-fixer-katex-rtl-text', isRtl);
        foundRtlText = foundRtlText || isRtl;
      }
      mark(math, 'rtl-fixer-katex-ltr', foundRtlText);
      const display = math.closest('.katex-display');
      if (display) mark(display, 'rtl-fixer-katex-ltr', foundRtlText);
      // A boxed prose statement may contain short math tokens. Reverse its
      // inline token order, but leave boxes with operators/equations alone.
      for (const box of math.querySelectorAll('.katex-html .boxpad')) {
        const binaryOperators = box.querySelectorAll('.mbin');
        let safeBinary = binaryOperators.length === 0;
        if (!safeBinary) {
          const textPart = box.querySelector('.mord.text');
          let identifierPrefix = '';
          if (textPart) {
            for (const sibling of textPart.parentElement.children) {
              if (sibling === textPart) break;
              identifierPrefix += sibling.textContent || '';
            }
          }
          // KaTeX renders AND-NOR as a binary minus even though it is a name.
          safeBinary = /^[A-Z]+(?:[−-][A-Z]+)+$/.test(identifierPrefix.trim()) &&
            Array.from(binaryOperators).every(op => /^[−-]$/.test(op.textContent.trim()));
        }
        const proseBox = foundRtlText && RtlFixer.containsRtl(box.textContent || '') &&
          !box.querySelector('.mrel, .mfrac, .msupsub, .mop, .mop-limits') &&
          safeBinary;
        mark(box, 'rtl-fixer-katex-rtl-box', proseBox);
      }
    }
  };

  // A host page may wrap a short Latin label and its final colon in an LTR
  // inline element. In RTL prose that puts the colon on the right of "Hold".
  // Restore an RTL bidi context for this narrow label shape only.
  RtlFixer.processTerminalLatinLabelsInSubtree = function (root, cleanupOnly = false) {
    if (!root) return;
    const selector = cleanupOnly ? '.rtl-fixer-terminal-latin-colon' : 'span, strong, b, em, i, bdi, a';
    const candidates = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) candidates.push(root);
    if (root.querySelectorAll) candidates.push(...root.querySelectorAll(selector));
    for (const label of candidates) {
      const wasManaged = RtlFixer._terminalLatinLabels.has(label);
      const text = label.textContent || '';
      const isShortLabel = text.length <= 80 && /[A-Za-z][A-Za-z0-9_-]*\s*:\s*$/.test(text);
      const owner = isShortLabel ? RtlFixer.getInlineProseOwner(label) : null;
      const shouldManage = !cleanupOnly && isShortLabel && owner?.classList.contains('rtl-fixer-rtl-detected') &&
        !label.closest(RtlFixer.MATH_CONTAINER_SELECTOR) &&
        (wasManaged || getComputedStyle(label).direction === 'ltr');
      if (shouldManage && !wasManaged) {
        label.classList.add('rtl-fixer-terminal-latin-colon');
        RtlFixer._terminalLatinLabels.add(label);
      } else if (!shouldManage && wasManaged) {
        label.classList.remove('rtl-fixer-terminal-latin-colon');
        RtlFixer._terminalLatinLabels.delete(label);
      }
    }
  };

  // Scan DOM using native TreeWalker (Highly Optimized: visits only elements and rejects ignored/math subtrees)
  RtlFixer.scanAndProcess = function (element) {
    if (!RtlFixer._isActive) return; // Guard: don't process when deactivated
    if (!element || (element.nodeType !== Node.ELEMENT_NODE && element.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)) return;
    if (RtlFixer.isExtensionNode(element)) return;
    if (element.nodeType === Node.ELEMENT_NODE && element.closest?.('.rtl-fixer-bionic')) return;

    // KaTeX is skipped by the prose walker, but \text{Persian} still needs its
    // own bidi context. This also handles math roots added by a streaming UI.
    const subtreeContainsRtl = RtlFixer.containsRtl(element.textContent || '');
    const existingMath = element.nodeType === Node.ELEMENT_NODE && element.closest?.('.rtl-fixer-katex-ltr');
    if (subtreeContainsRtl || existingMath) RtlFixer.processMathTextInSubtree(element);

    // Capture table geometry before any ancestor receives an RTL direction.
    rememberTableDirections(element);

    if (typeof RtlFixer.processInputsInSubtree === 'function') {
      RtlFixer.processInputsInSubtree(element);
    }
    
    if (element.nodeType === Node.ELEMENT_NODE) {
      if (RtlFixer.IGNORED_TAGS.has(element.tagName) || element.hasAttribute('contenteditable')) return;
      if (element.matches && element.matches(RtlFixer.MATH_CONTAINER_SELECTOR)) return;
      if (element.matches && element.matches(RtlFixer.EXTENSION_UI_SELECTOR)) return;
    }

    // Always process an already-created shadow root. During initial startup the
    // observer may not exist yet, but its content must not be skipped.
    if (element.shadowRoot) {
      if (RtlFixer.observer) observeShadowRoot(element.shadowRoot);
      RtlFixer.scanAndProcess(element.shadowRoot);
    }

    if (!subtreeContainsRtl) {
      // Re-evaluate previously managed nodes that became LTR, but avoid all of
      // the per-element text/prose work for ordinary lazy-loaded UI subtrees.
      if (element.nodeType === Node.ELEMENT_NODE && element.classList.contains('rtl-fixer-target')) {
        RtlFixer.applyRtlToElement(element);
      }
      if (element.querySelectorAll) {
        element.querySelectorAll('.rtl-fixer-target').forEach(RtlFixer.applyRtlToElement);
      }
      RtlFixer.processTerminalLatinLabelsInSubtree(element, true);

      // textContent does not include shadow trees. Discover nested hosts without
      // running the heavier RTL target analysis over every light-DOM element.
      const shadowWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
      let shadowHost;
      while ((shadowHost = shadowWalker.nextNode())) {
        if (shadowHost.shadowRoot) {
          if (RtlFixer.observer) observeShadowRoot(shadowHost.shadowRoot);
          RtlFixer.scanAndProcess(shadowHost.shadowRoot);
        }
      }
      return;
    }

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (el) => {
          if (RtlFixer.IGNORED_TAGS.has(el.tagName) || el.hasAttribute('contenteditable')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.classList.contains('rtl-fixer-bionic')) return NodeFilter.FILTER_REJECT;
          // Our own injected UI is already styled by content.css.
          if (el.matches && el.matches(RtlFixer.EXTENSION_UI_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.matches && el.matches(RtlFixer.MATH_CONTAINER_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const targetElements = new Set();
    // Previously processed elements must also be re-evaluated when their text
    // becomes entirely LTR; otherwise no RTL character remains to trigger them.
    if (element.nodeType === Node.ELEMENT_NODE && element.classList.contains('rtl-fixer-target')) {
      targetElements.add(element);
    }
    
    // Check root element first
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
        if (RtlFixer.containsRtl(child.textContent)) {
          if (element.nodeType === Node.ELEMENT_NODE) {
            targetElements.add(element);
          }
          break;
        }
      }
    }
    if (element.nodeType === Node.ELEMENT_NODE &&
        RtlFixer.isProseBlockElement(element) &&
        RtlFixer.containsRtl(RtlFixer.getDirectionalText(element))) {
      targetElements.add(element);
    }

    // Traverse all un-ignored sub-elements
    let el;
    while ((el = walker.nextNode())) {
      // Attach observer and recurse into nested shadow roots
      if (el.shadowRoot) {
        if (RtlFixer.observer) observeShadowRoot(el.shadowRoot);
        RtlFixer.scanAndProcess(el.shadowRoot);
      }

      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
          if (RtlFixer.containsRtl(child.textContent)) {
            targetElements.add(el);
            break;
          }
        }
      }
      if (RtlFixer.isProseBlockElement(el) &&
          RtlFixer.containsRtl(RtlFixer.getDirectionalText(el))) {
        targetElements.add(el);
      }
    }

    targetElements.forEach(RtlFixer.applyRtlToElement);
    RtlFixer.processTerminalLatinLabelsInSubtree(element);
  };

  // Flip arrow directions in non-isolated text nodes (outside <bdi> and ignored tags)
  RtlFixer.flipArrowsInElement = function (element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          let parent = node.parentElement;
          while (parent && parent !== element) {
            if (RtlFixer.IGNORED_TAGS.has(parent.tagName) || parent.classList.contains('rtl-fixer-target')) {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) {
      textNodes.push(n);
    }

    textNodes.forEach(node => {
      let text = node.textContent;
      let original = text;

      // Swap unicode arrows
      text = text.replace(/[→←⇒⇐↳↲]/g, (match) => {
        if (match === '→') return '←';
        if (match === '←') return '→';
        if (match === '⇒') return '⇐';
        if (match === '⇐') return '⇒';
        if (match === '↳') return '↲';
        if (match === '↲') return '↳';
        return match;
      });

      // Swap ASCII arrows
      text = text.replace(/->/g, '__TEMP_R_ARROW__')
                 .replace(/<-/g, '->')
                 .replace(/__TEMP_R_ARROW__/g, '<-');

      text = text.replace(/=>/g, '__TEMP_RD_ARROW__')
                 .replace(/<=/g, '=>')
                 .replace(/__TEMP_RD_ARROW__/g, '<=');

      if (text !== original) {
        node.textContent = text;
      }
    });
  };

  // Process the direction of a specific input/textarea/contenteditable dynamically
  RtlFixer.processInputDirection = function (input) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (!config.inputsAutoDir || !input || input.getAttribute('contenteditable') === 'false') return;
    if (input.tagName === 'INPUT' && !['text','search','tel'].includes((input.type || 'text').toLowerCase())) return;

    let text = '';
    const isContentEditable = (
      input.hasAttribute('contenteditable') || 
      input.contentEditable === 'true' || 
      (input.getAttribute && input.getAttribute('contenteditable') === 'plaintext-only')
    );

    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      text = input.value;
    } else if (isContentEditable) {
      text = input.textContent;
    }

    const direction = text.trim() ? RtlFixer.detectParagraphDirection(text) : null;
    RtlFixer.captureOriginalState(input);

    if (!direction) {
      const original = RtlFixer._originalElementState.get(input);
      if (isContentEditable) {
        RtlFixer.setManagedStyle(input, 'direction', original.styles.direction.value, original.styles.direction.priority);
        RtlFixer.setManagedStyle(input, 'text-align', original.styles['text-align'].value, original.styles['text-align'].priority);
      }
      if (original.hadDir) RtlFixer.setManagedDir(input, original.dir);
      else RtlFixer.setManagedDir(input, null);
      const emptyRoot = input.getRootNode ? input.getRootNode() : null;
      if (emptyRoot && emptyRoot instanceof ShadowRoot && emptyRoot.host) {
        const host = emptyRoot.host;
        const hostState = RtlFixer._originalElementState.get(host);
        if (hostState) {
          RtlFixer.setManagedStyle(host, 'direction', hostState.styles.direction.value, hostState.styles.direction.priority);
        }
      }
      return;
    }

    if (isContentEditable) {
      if (input.style.direction !== direction) {
        RtlFixer.setManagedStyle(input, 'direction', direction);
        RtlFixer.setManagedStyle(input, 'text-align', direction === 'rtl' ? 'right' : 'left');
      }
      if (input.getAttribute('dir') !== direction) {
        RtlFixer.setManagedDir(input, direction);
      }
    } else {
      // For native input/textarea: setAttribute is safe and preferred.
      if (input.getAttribute('dir') !== direction) {
        RtlFixer.setManagedDir(input, direction);
      }
    }

    // Also apply direction to Shadow Host if input is inside a Shadow DOM (e.g. Google Gemini prompt editor)
    const rootNode = input.getRootNode ? input.getRootNode() : null;
    if (rootNode && rootNode instanceof ShadowRoot && rootNode.host) {
      const host = rootNode.host;
      RtlFixer.captureOriginalState(host);
      host.classList.add('rtl-fixer-input-host');
      if (host.style.direction !== direction) {
        RtlFixer.setManagedStyle(host, 'direction', direction);
      }
    }
  };

  // Process inputs and textareas
  RtlFixer.processInput = function (input) {
    if (input.classList.contains('rtl-fixer-input-processed')) return;
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (config.inputsAutoDir) {
      RtlFixer.processInputDirection(input);
      input.classList.add('rtl-fixer-input-processed');
    }
  };

  RtlFixer.processInputsInSubtree = function (root) {
    const selector = 'input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable]';
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) RtlFixer.processInput(root);
    if (root.querySelectorAll) root.querySelectorAll(selector).forEach(RtlFixer.processInput);
  };

  // Process entire page
  RtlFixer.processPage = function () {
    if (!RtlFixer._isActive) return; // Guard: don't process when deactivated
    if (!document.body) return;
    RtlFixer.scanAndProcess(document.body);
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (config.inputsAutoDir) {
      RtlFixer.processInputsInSubtree(document.body);
    }
  };

  RtlFixer.applyBionicReading = function(textNode) {
    const text = textNode.nodeValue;
    if (!text.trim()) return;

    // Split text into words, preserving spaces
    const words = text.split(/([\s\n\t\r،؛.؟!]+)/);
    const fragment = document.createDocumentFragment();
    let hasChanges = false;

    words.forEach(word => {
      // Don't modify short words, whitespace, or punctuation
      if (word.length <= 1 || /^[\s\n\t\r،؛.؟!]+$/.test(word)) {
        fragment.appendChild(document.createTextNode(word));
        return;
      }
      
      hasChanges = true;
      const mid = Math.ceil(word.length / 2);
      const boldPart = word.substring(0, mid);
      const normalPart = word.substring(mid);
      
      const span = document.createElement('span');
      span.className = 'rtl-fixer-bionic rtl-fixer-unicode-fix';
      // Inline style to ensure it works even if stylesheets are blocked
      span.style.fontFamily = 'inherit';
      RtlFixer._bionicElements.add(span);
      
      const b = document.createElement('b');
      b.style.fontWeight = '800'; // Extra bold for bionic reading
      b.style.color = 'inherit';
      b.textContent = boldPart;
      
      span.appendChild(b);
      span.appendChild(document.createTextNode(normalPart));
      
      fragment.appendChild(span);
    });

    if (hasChanges && textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  };

})(window.RtlFixer);
