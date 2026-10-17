// RTL Beautifier & Fixer - DOM Mutation Logic
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  const inputDirectionCache = new WeakMap();
  const MUTATED_STYLE_PROPERTIES = [
    'direction', 'text-align', 'unicode-bidi',
    'padding-left', 'padding-right', 'padding-inline-start', 'padding-inline-end',
    'border-left', 'border-right', 'border-inline-start', 'border-inline-end',
    'margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end'
  ];
  const DIRECTION_STYLE_PROPERTIES = ['direction', 'text-align'];
  const LAYOUT_BASELINE_TAGS = new Set(['LI', 'UL', 'OL', 'BLOCKQUOTE']);
  const PROTECTED_ANCESTOR_SELECTOR = Array.from(RtlFixer.IGNORED_TAGS)
    .filter(tag => tag !== 'HTML')
    .map(tag => tag.toLowerCase()).join(',');

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

  function hasExplicitDirection(value) {
    return typeof value === 'string' && /^(?:ltr|rtl)$/i.test(value);
  }

  function authorDirection(element) {
    const state = RtlFixer._originalElementState.get(element);
    const current = element.getAttribute('dir');
    return state?.writtenDir && current === state.writtenDir.value ? state.dir : current;
  }

  function isLeafProseOverrideTarget(element) {
    if (!/^(?:P|H[1-6]|LI|DD|DT|BLOCKQUOTE)$/.test(element.tagName) || element.isContentEditable ||
        element.closest('table') || RtlFixer.isInsideMathContainer(element) || RtlFixer.isExtensionNode(element)) return false;
    return !element.querySelector('p,h1,h2,h3,h4,h5,h6,li,dd,dt,blockquote');
  }

  function resolveInlineProseBidi(element) {
    const direction = element.style.getPropertyValue('direction');
    const bidi = element.style.getPropertyValue('unicode-bidi');
    const directionConflict = direction && direction !== 'rtl' && element.style.getPropertyPriority('direction') === 'important';
    const bidiConflict = /^(?:plaintext|bidi-override|isolate-override)$/.test(bidi) &&
      element.style.getPropertyPriority('unicode-bidi') === 'important';
    if (!(directionConflict || bidiConflict) || !isLeafProseOverrideTarget(element)) return;
    // Inline !important renderer defaults outrank our stylesheet. Once this
    // block has been resolved as RTL, keep its direction and bidi base intact.
    if (directionConflict) RtlFixer.setManagedStyle(element, 'direction', 'rtl', 'important');
    if (bidiConflict) RtlFixer.setManagedStyle(element, 'unicode-bidi', 'isolate', 'important');
  }

  function matchesMathElement(element) {
    // Most prose elements have no mathematical marker. Avoid evaluating the
    // complete KaTeX/MathJax selector list on every ordinary layout wrapper.
    const tag = element.localName;
    if (!/^(?:math|mjx-container|mjx-chtml|mjx-math)$/.test(tag) && element.getAttribute('role') !== 'math' &&
        !/(?:katex|MathJax|mjx-|math-inline|math-display|mathjax-latex)/.test(element.getAttribute('class') || '')) return false;
    return element.matches(RtlFixer.MATH_CONTAINER_SELECTOR);
  }

  function matchesExtensionElement(element) {
    if (!/^(?:rastin-|rtl-fixer-)/.test(element.id) && !element.hasAttribute('data-rastin-reader-ui') &&
        !element.classList.contains('rastin-note')) return false;
    return element.matches(RtlFixer.EXTENSION_UI_SELECTOR);
  }

  function analysisVersion(element) {
    return RtlFixer.getNodeMutationVersion
      ? RtlFixer.getNodeMutationVersion(element)
      : (RtlFixer._domMutationVersion || 0);
  }

  function readInlineBaseline(el, state) {
    state.hadDir = el.hasAttribute('dir');
    state.dir = el.getAttribute('dir');
    // Only list/blockquote fixes write padding, border or margin. Ordinary
    // prose, cells and inputs need just direction/alignment snapshots.
    for (const property of LAYOUT_BASELINE_TAGS.has(el.tagName) ? MUTATED_STYLE_PROPERTIES : DIRECTION_STYLE_PROPERTIES) {
      state.styles[property] = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property)
      };
    }
    state.inlineStyleAttribute = el.getAttribute('style');
    state.classAttribute = el.getAttribute('class');
  }

  function readComputedBaseline(el, state) {
    const computed = getComputedStyle(el);
    state.computedDirection = computed.direction;
    state.computedTextAlign = /^(TD|TH)$/.test(el.tagName) ? computed.textAlign : null;
    state.layout = LAYOUT_BASELINE_TAGS.has(el.tagName) ? {
      paddingLeft: computed.paddingLeft,
      marginLeft: computed.marginLeft,
      borderLeftWidth: computed.borderLeftWidth,
      borderLeftStyle: computed.borderLeftStyle,
      borderLeftColor: computed.borderLeftColor
    } : null;
    state.capturedParent = el.parentElement;
  }

  function beginManagedWrites(el) {
    RtlFixer.captureOriginalState(el);
    const state = RtlFixer._originalElementState.get(el);
    if (!state.writesStarted) {
      const inlineChanged = el.getAttribute('style') !== state.inlineStyleAttribute;
      const classChanged = el.getAttribute('class') !== state.classAttribute;
      const directionChanged = el.hasAttribute('dir') !== state.hadDir || el.getAttribute('dir') !== state.dir;
      if (inlineChanged || classChanged || directionChanged || el.parentElement !== state.capturedParent) {
        // Re-read only baselines that the website changed during a yielded
        // read phase. The usual path only compares attributes and parent.
        readInlineBaseline(el, state);
        readComputedBaseline(el, state);
      }
      state.writesStarted = true;
    }
    return state;
  }

  function addClasses(element, ...classes) {
    const missing = classes.filter(name => !element.classList.contains(name));
    if (missing.length) element.classList.add(...missing);
  }

  function removeClasses(element, ...classes) {
    const present = classes.filter(name => element.classList.contains(name));
    if (present.length) element.classList.remove(...present);
  }

  function drainSteps(steps) {
    for (const _step of steps) { /* Synchronous API for manual callers. */ }
  }

  function elementPosition(element) {
    return { parent: element.parentNode, previousSibling: element.previousSibling, nextSibling: element.nextSibling };
  }

  function positionChanged(element, position) {
    return !element.isConnected || element.parentNode !== position.parent ||
      element.previousSibling !== position.previousSibling || element.nextSibling !== position.nextSibling;
  }

  function* iterateConnectedElements(root, filter) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
    const visited = new WeakMap();
    let element;
    while (root.isConnected && (element = walker.nextNode())) {
      const position = elementPosition(element);
      const wasVisited = visited.has(element);
      visited.set(element, position);
      const version = RtlFixer._domMutationVersion || 0;
      const rootVersion = analysisVersion(root);
      const observer = RtlFixer.observer;
      yield wasVisited ? null : element;
      // A registered observer delivers page mutations before the next task.
      // With no new records, the retained node and its ancestors have not
      // moved. Manual/unobserved scans retain the full position validation.
      if (observer && observer === RtlFixer.observer && rootVersion === analysisVersion(root)) continue;
      if (!root.isConnected) return;
      // Removing the retained currentNode can otherwise end a TreeWalker even
      // though the root and its later siblings are still connected. Resume at
      // its former parent, skipping nodes already visited on the restarted path.
      let resume = positionChanged(element, position) || !root.contains(element) ? position : null;
      if (version !== (RtlFixer._domMutationVersion || 0)) {
        // Virtualized chats can move a whole response while our retained node
        // remains inside it. Inspect saved ancestors only after a real mutation.
        const checked = new Set();
        let ancestor = position.parent;
        while (ancestor && ancestor !== root && !checked.has(ancestor)) {
          checked.add(ancestor);
          const saved = visited.get(ancestor);
          const parent = saved ? saved.parent : ancestor.parentNode;
          if (saved && positionChanged(ancestor, saved)) {
            resume = saved;
            visited.set(ancestor, elementPosition(ancestor));
          }
          ancestor = parent;
        }
        if (ancestor && ancestor !== root) resume = { parent: root };
      }
      if (resume) {
        visited.set(element, elementPosition(element));
        walker.currentNode = resume.parent?.isConnected && root.contains(resume.parent) ? resume.parent : root;
      }
    }
  }

  RtlFixer.resetTableDirectionCache = function () {
    tableDirectionCache = new WeakMap();
  };

  function observeShadowRoot(root) {
    if (!root || RtlFixer.isExtensionNode(root) || !RtlFixer.observer || RtlFixer._observedShadowRoots.has(root)) return;
    RtlFixer.observer.observe(root, {
      childList: true, subtree: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeFilter: ['dir']
    });
    RtlFixer._observedShadowRoots.add(root);
  }

  RtlFixer.captureOriginalState = function (el) {
    if (!el || RtlFixer._originalElementState.has(el)) return;
    const state = {
      styles: {},
      writesStarted: false,
      writtenDir: null,
      writtenStyles: {}
    };
    readInlineBaseline(el, state);
    readComputedBaseline(el, state);
    RtlFixer._originalElementState.set(el, state);
    RtlFixer._managedElements.add(el);
  };

  RtlFixer.setManagedDir = function (el, value) {
    const state = beginManagedWrites(el);
    if (value === 'rtl' && !hasExplicitDirection(state.dir)) state.autoRtlDirectionOwned = true;
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
    const state = beginManagedWrites(el);
    if (!state.styles[property]) {
      // Keep the public style helper reversible for a property outside the
      // usual direction-only path without eagerly reading it on every target.
      state.styles[property] = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property)
      };
    }
    const previousWrite = state.writtenStyles[property];
    if (previousWrite &&
        (el.style.getPropertyValue(property) !== previousWrite.value ||
         el.style.getPropertyPriority(property) !== previousWrite.priority)) {
      state.styles[property] = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property)
      };
    }
    if (value === null || value === '') {
      if (el.style.getPropertyValue(property)) el.style.removeProperty(property);
    } else if (el.style.getPropertyValue(property) !== value ||
        el.style.getPropertyPriority(property) !== priority) {
      el.style.setProperty(property, value, priority);
    }
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
    if (!RtlFixer._managedElements.has(el) &&
        !(typeof el.className === 'string' && el.className.includes('rtl-fixer-'))) return;
    removeClasses(el,
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
    return tables.filter(table => !RtlFixer.isExtensionNode(table));
  }

  function guardTableLayout(table, baseline) {
    if (!baseline || baseline.explicitDir || baseline.direction !== 'ltr') return;
    addClasses(table, 'rtl-fixer-table-layout-guard');
    RtlFixer.setManagedStyle(table, 'direction', 'ltr', 'important');
  }

  function* rememberTableDirectionsSteps(root) {
    if (!(RtlFixer.config || RtlFixer.DEFAULT_CONFIG).fixTables) return;
    for (const table of getTablesInSubtree(root)) {
      if (!table.isConnected) continue;
      // Capture cell alignment before any response wrapper or cell is changed.
      for (const cell of table.querySelectorAll('td,th')) {
        if (!cell.isConnected) continue;
        RtlFixer.captureOriginalState(cell);
        yield;
      }
      if (tableDirectionCache.has(table)) continue;

      const explicitDir = hasExplicitDirection(table.getAttribute('dir'));
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
      yield;
    }
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
    if (RtlFixer.isExtensionNode(node)) return true;
    let parent = node.parentElement;
    while (parent) {
      if (RtlFixer.IGNORED_TAGS.has(parent.tagName) ||
          parent.classList.contains('rtl-fixer-bionic') ||
          parent.isContentEditable ||
          matchesMathElement(parent)) return true;
      if (parent === root) break;
      parent = parent.parentElement;
    }
    return false;
  }

  function getSafeDirectTextNodes(element, predicate = () => true) {
    return Array.from(element.childNodes).filter(node =>
      node.nodeType === Node.TEXT_NODE && !isSensitiveTextNode(node, element) && predicate(node));
  }

  function replaceManagedTextNode(textNode, fragment) {
    const parent = textNode.parentNode;
    if (!parent) return;
    const digitState = RtlFixer._digitState.get(textNode);
    if (digitState && textNode.textContent === digitState.written) {
      // Isolation and bionic formatting preserve text length. Carry the digit
      // baseline into their replacement nodes so disabling restores ASCII too.
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
      let replacement, offset = 0;
      while ((replacement = walker.nextNode())) {
        const written = replacement.textContent;
        const original = digitState.original.slice(offset, offset + written.length);
        if (original !== written) {
          RtlFixer._digitState.set(replacement, { original, written });
          RtlFixer._managedDigitNodes.add(replacement);
        }
        offset += written.length;
      }
    }
    RtlFixer.recordOwnChildListWrite?.(parent, Array.from(fragment.childNodes), [textNode]);
    parent.replaceChild(fragment, textNode);
    RtlFixer._digitState.delete(textNode);
    RtlFixer._managedDigitNodes.delete(textNode);
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
    replaceManagedTextNode(textNode, frag);
  };

  // Translate English digits to Persian digits
  RtlFixer.translateDigitsToPersian = function (textNode) {
    const text = textNode.textContent;
    const replaced = text.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    if (replaced !== text) {
      const oldState = RtlFixer._digitState.get(textNode);
      const original = oldState && text === oldState.written ? oldState.original : text;
      RtlFixer.recordOwnTextWrite?.(textNode, replaced);
      textNode.textContent = replaced;
      RtlFixer._digitState.set(textNode, { original, written: replaced });
      RtlFixer._managedDigitNodes.add(textNode);
    }
  };

  // Helper to set direction and related class names
  RtlFixer.setDirection = function (el, isRtl) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const original = beginManagedWrites(el);
    if (original && original.writtenDir) {
      const changedBySite = el.hasAttribute('dir') !== original.writtenDir.hadDir ||
        el.getAttribute('dir') !== original.writtenDir.value;
      if (changedBySite) {
        original.hadDir = el.hasAttribute('dir');
        original.dir = el.getAttribute('dir');
        original.writtenDir = null;
      }
    }
    const siteHasExplicitDirection = original && original.hadDir && hasExplicitDirection(original.dir);
    const overrideExplicitProse = isRtl && siteHasExplicitDirection && original.dir.toLowerCase() === 'ltr' &&
      (config.forceRightAlign || original.autoRtlDirectionOwned) && isLeafProseOverrideTarget(el);
    if (config.alignmentMode === 'auto' && siteHasExplicitDirection && !overrideExplicitProse) {
      removeClasses(el, 'rtl-fixer-rtl-detected', 'rtl-fixer-force-rtl');
      return;
    }
    if (config.alignmentMode === 'force-rtl') {
      if (!siteHasExplicitDirection) RtlFixer.setManagedDir(el, 'rtl');
      addClasses(el, 'rtl-fixer-force-rtl', 'rtl-fixer-rtl-detected');
      if (isRtl) resolveInlineProseBidi(el);
    } else if (config.alignmentMode === 'auto') {
      if (isRtl) {
        if (!siteHasExplicitDirection || overrideExplicitProse) RtlFixer.setManagedDir(el, 'rtl');
        addClasses(el, 'rtl-fixer-rtl-detected');
        resolveInlineProseBidi(el);
      } else {
        removeClasses(el, 'rtl-fixer-rtl-detected', 'rtl-fixer-force-rtl');
        if (!siteHasExplicitDirection) RtlFixer.setManagedDir(el, 'auto');
      }
    }
  };

  function inspectTarget(element, discoveredTexts, validateAncestry = false, simpleText) {
    const rawText = element.textContent || '';
    const version = analysisVersion(element);
    const structuralVersion = RtlFixer._domStructureMutationVersion || 0;
    const protectedContext = validateAncestry && (element.isContentEditable ||
      RtlFixer.isExtensionNode(element) || element.closest(PROTECTED_ANCESTOR_SELECTOR));
    const isSafe = !protectedContext && RtlFixer.isSafeAutoTarget(element);
    const isMath = isSafe && RtlFixer.isInsideMathContainer(element);
    if (!isSafe || isMath) return { element, rawText, version, structuralVersion, parent: element.parentElement, isSafe, isMath };
    const directText = RtlFixer.getDirectText(element);
    const isProseBlock = RtlFixer.isProseBlockElement(element);
    const discovered = discoveredTexts?.get(element);
    const directionalText = simpleText !== undefined ? simpleText : !isProseBlock ? directText :
      discovered?.rawText === rawText && discovered.version === version
        ? discovered.directionalText : RtlFixer.getDirectionalText(element);
    const isRtl = /^(TD|TH)$/.test(element.tagName)
      ? RtlFixer.isRtlTableText(directionalText)
      : isProseBlock ? RtlFixer.isRtlProse(directionalText) : RtlFixer.isRtlDominant(directionalText);
    return { element, rawText, version, structuralVersion, parent: element.parentElement, isSafe, isMath, directText, isProseBlock, isRtl };
  }

  function isRtlProseAncestor(target, ancestor) {
    const cached = target.proseDirections?.get(ancestor);
    if (cached && cached.rawText === ancestor.textContent &&
        cached.version === analysisVersion(ancestor)) return cached.isRtl;
    return RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(ancestor));
  }

  // Apply RTL fixes to a specific element and its nearest block parent.
  // A prepared classification is used only while its text and parent still match.
  RtlFixer.applyRtlToElement = function (element, prepared) {
    if (!RtlFixer._isActive) return; // Guard: don't modify DOM when deactivated
    if (!element?.isConnected) return;
    // Bionic spans split one word into styled fragments. Giving either fragment
    // its own bidi isolate changes the order of mixed Persian/Latin sentences.
    if (element.closest?.('.rtl-fixer-bionic')) return;
    const ancestryInvalidated = prepared && prepared.structuralVersion !== (RtlFixer._domStructureMutationVersion || 0);
    const target = prepared && typeof prepared === 'object' && prepared.element === element && !ancestryInvalidated &&
      prepared.parent === element.parentElement && prepared.rawText === element.textContent &&
      prepared.version === analysisVersion(element)
      ? prepared : inspectTarget(element, undefined, Boolean(ancestryInvalidated));
    if (!target.isSafe) {
      if (element.classList.contains('rtl-fixer-target')) RtlFixer.clearManagedElement(element);
      return;
    }

    // Never apply RTL fixes to elements inside math containers
    if (target.isMath) {
      if (element.classList.contains('rtl-fixer-target')) RtlFixer.clearManagedElement(element);
      return;
    }

    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const { directText, isRtl } = target;
    if (config.alignmentMode !== 'force-rtl' && !isRtl) {
      RtlFixer.clearManagedElement(element);
      reconcileSpecialAncestors(element);
      return;
    }

    const proseOwner = RtlFixer.getInlineProseOwner(element);
    const original = RtlFixer._originalElementState.get(element);
    const siteDir = original?.writesStarted ? original.dir : element.getAttribute('dir');
    const inheritProseDirection = proseOwner?.classList.contains('rtl-fixer-rtl-detected') &&
      !hasExplicitDirection(siteDir);
    if (inheritProseDirection) {
      // Isolating every span disconnects whitespace and English runs across
      // formatting boundaries. Keep the site's nodes in one paragraph flow.
      RtlFixer.clearManagedElement(element);
    } else {
      beginManagedWrites(element);
      addClasses(element, 'rtl-fixer-target', 'rtl-fixer-unicode-fix');
      element.classList.toggle('rtl-fixer-typography-root', !element.parentElement?.closest('.rtl-fixer-target'));
    }
    const containingCell = config.fixTables ? element.closest('td,th') : null;
    if (containingCell) RtlFixer.captureOriginalState(containingCell);

    // Isolate English words/codes BEFORE measuring dominance so isolation markers don't skew counts
    if (config.isolateLtrRuns === true) {
      getSafeDirectTextNodes(element).forEach(RtlFixer.isolateLtrRunsInTextNode);
    }

    // NOTE: Arrow flipping (flipArrowsInElement) is intentionally DISABLED.
    // It caused a double-flip cycle on dynamic pages: when text changes,
    // the observer re-processes elements, flipping already-flipped arrows back,
    // creating an infinite flip-flop. CSS direction handles visual arrow
    // rendering sufficiently without modifying text content.

    // Translate English digits to Persian digits in RTL text nodes if enabled
    if (config.persianDigits && RtlFixer.ARABIC_SCRIPT_REGEX.test(directText)) {
      getSafeDirectTextNodes(element, node =>
        RtlFixer.ARABIC_SCRIPT_REGEX.test(node.textContent) &&
        !element.classList.contains('rtl-fixer-isolate')).forEach(RtlFixer.translateDigitsToPersian);
    }

    if (config.bionicTextEnabled) {
      getSafeDirectTextNodes(element, node => RtlFixer.containsRtl(node.textContent) &&
        !element.classList.contains('rtl-fixer-isolate') &&
        !element.classList.contains('rtl-fixer-bionic')).forEach(RtlFixer.applyBionicReading);
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
    const ancestors = target.ancestors || RtlFixer.findSpecialAncestors(element);

    // Do not propagate direction to parents. Each block is evaluated from its
    // own direct text so a small RTL child cannot flip a large container.

    // LI bullet point and list padding/margin fixing logic
    if (config.fixListsBlockquotes && ancestors.liAncestor &&
        !ancestors.liAncestor.classList.contains('rtl-fixer-li-processed') &&
        isRtlProseAncestor(target, ancestors.liAncestor)) {
      const li = ancestors.liAncestor;
        beginManagedWrites(li);
        addClasses(li, 'rtl-fixer-li-processed');
        // Read style BEFORE setting direction to RTL!
        const computedLiStyle = RtlFixer._originalElementState.get(li).layout;
        const liPadLeft = computedLiStyle.paddingLeft;
        const liMarginLeft = computedLiStyle.marginLeft;

        addClasses(li, 'rtl-fixer-target', 'rtl-fixer-unicode-fix');
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
          addClasses(li, 'rtl-fixer-custom-bullet');
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
          beginManagedWrites(parentList);
          const computedListStyle = RtlFixer._originalElementState.get(parentList).layout;
          const listPadLeft = computedListStyle.paddingLeft;
          const listMarginLeft = computedListStyle.marginLeft;
 
          addClasses(parentList, 'rtl-fixer-target', 'rtl-fixer-unicode-fix', 'rtl-fixer-list-processed');
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

    // Blockquote border, margin, padding adjustments
    if (config.fixListsBlockquotes && ancestors.blockquoteAncestor &&
        !ancestors.blockquoteAncestor.classList.contains('rtl-fixer-blockquote-processed') &&
        isRtlProseAncestor(target, ancestors.blockquoteAncestor)) {
      const blockquote = ancestors.blockquoteAncestor;
        beginManagedWrites(blockquote);
        // Read style BEFORE setting direction to RTL!
        const computedStyle = RtlFixer._originalElementState.get(blockquote).layout;
        const borderLeftWidth = computedStyle.borderLeftWidth;
        const borderLeftStyle = computedStyle.borderLeftStyle;
        const borderLeftColor = computedStyle.borderLeftColor;
        const padLeft = computedStyle.paddingLeft;
        const marginLeft = computedStyle.marginLeft;

        addClasses(blockquote, 'rtl-fixer-target', 'rtl-fixer-unicode-fix', 'rtl-fixer-blockquote-processed');
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

    // Table direction and cell alignment adjustments
    if (config.fixTables) {
      if (ancestors.tableCell && !ancestors.tableCell.classList.contains('rtl-fixer-cell-processed') &&
          RtlFixer.isRtlTableText(RtlFixer.getContainedDirectionalText(ancestors.tableCell))) {
        const cell = ancestors.tableCell;
          beginManagedWrites(cell);
          const originalCellState = RtlFixer._originalElementState.get(cell);
          addClasses(cell, 'rtl-fixer-cell-processed', 'rtl-fixer-target', 'rtl-fixer-unicode-fix');
          RtlFixer.setDirection(cell, true);

          // `text-align: start` changes physical edge when direction changes.
          // Preserve the site's original physical alignment so Persian headers
          // stay directly above numeric/English values in the same column.
          const physicalAlignment = getPhysicalTextAlign(originalCellState);
          if (physicalAlignment) {
            RtlFixer.setManagedStyle(cell, 'text-align', physicalAlignment, 'important');
          }
      }

      // Never change TABLE/TR direction: doing so can reverse visual column order.
    }
  };

  RtlFixer.processMathTextInSubtreeSteps = function* (root) {
    if (!root || RtlFixer.isExtensionNode(root)) return;
    const nearestMath = root.nodeType === Node.ELEMENT_NODE ? root.closest?.('.katex') : null;
    const mathRoots = new Set(nearestMath ? [nearestMath] : []);
    if (!nearestMath && root.querySelectorAll) {
      // Most formulas contain no prose. Visit only KaTeX text spans that have
      // Persian, plus formulas we marked earlier and may need to undo.
      for (const candidate of root.querySelectorAll('.katex-html .mord.text, .katex.rtl-fixer-katex-ltr')) {
        if (!candidate.isConnected || RtlFixer.isExtensionNode(candidate)) continue;
        if (candidate.matches('.katex') || RtlFixer.containsRtl(candidate.textContent || '')) {
          const math = candidate.closest('.katex');
          if (math) mathRoots.add(math);
        }
        yield;
      }
    }

    const mark = (el, className, enabled) => {
      if (!el.isConnected) return;
      if (el.classList.contains(className) !== enabled) el.classList.toggle(className, enabled);
      if (enabled) RtlFixer._managedMathElements.add(el);
      else if (!el.classList.contains('rtl-fixer-katex-ltr') &&
          !el.classList.contains('rtl-fixer-katex-rtl-text') &&
          !el.classList.contains('rtl-fixer-katex-rtl-box')) RtlFixer._managedMathElements.delete(el);
    };
    for (const math of mathRoots) {
      if (!math.isConnected) continue;
      const rtlText = math.querySelectorAll('.katex-html .mord.text');
      let foundRtlText = false;
      for (const text of rtlText) {
        if (!text.isConnected) continue;
        const isRtl = RtlFixer.containsRtl(text.textContent || '');
        mark(text, 'rtl-fixer-katex-rtl-text', isRtl);
        foundRtlText = foundRtlText || isRtl;
        yield;
      }
      mark(math, 'rtl-fixer-katex-ltr', foundRtlText);
      const display = math.closest('.katex-display');
      if (display) mark(display, 'rtl-fixer-katex-ltr', foundRtlText);
      // A boxed prose statement may contain short math tokens. Reverse its
      // inline token order, but leave boxes with operators/equations alone.
      for (const box of math.querySelectorAll('.katex-html .boxpad')) {
        if (!box.isConnected) continue;
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
        yield;
      }
      yield;
    }
  };

  RtlFixer.processMathTextInSubtree = function (root) {
    drainSteps(RtlFixer.processMathTextInSubtreeSteps(root));
  };

  // A host page may wrap a short Latin label and its final colon in an LTR
  // inline element. In RTL prose that puts the colon on the right of "Hold".
  // Restore an RTL bidi context for this narrow label shape only.
  RtlFixer.processTerminalLatinLabelsInSubtreeSteps = function* (root, cleanupOnly = false) {
    if (!root || RtlFixer.isExtensionNode(root)) return;
    const selector = cleanupOnly ? '.rtl-fixer-terminal-latin-colon' : 'span, strong, b, em, i, bdi, a';
    const candidates = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) candidates.push(root);
    if (root.querySelectorAll) candidates.push(...root.querySelectorAll(selector));
    for (const label of candidates) {
      if (!label.isConnected) continue;
      const wasManaged = RtlFixer._terminalLatinLabels.has(label);
      const text = label.textContent || '';
      const isShortLabel = text.length <= 80 && /[A-Za-z][A-Za-z0-9_-]*\s*:\s*$/.test(text);
      if (!wasManaged && !isShortLabel) { yield; continue; }
      if (RtlFixer.isExtensionNode(label)) continue;
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
      yield;
    }
  };

  RtlFixer.processTerminalLatinLabelsInSubtree = function (root, cleanupOnly = false) {
    drainSteps(RtlFixer.processTerminalLatinLabelsInSubtreeSteps(root, cleanupOnly));
  };

  function prepareTargetGroup(targets, discoveredTexts, proseDirections = new Map()) {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const needsTextTransforms = config.persianDigits || config.isolateLtrRuns || config.bionicTextEnabled;
    const prepared = new Map();
    const proseDirection = element => {
      if (!proseDirections.has(element)) {
        proseDirections.set(element, {
          rawText: element.textContent,
          version: analysisVersion(element),
          isRtl: RtlFixer.isRtlProse(RtlFixer.getContainedDirectionalText(element))
        });
      }
      return proseDirections.get(element).isRtl;
    };
    for (const element of targets) {
      if (!element.isConnected) continue;
      const proseOwner = RtlFixer.getInlineProseOwner(element);
      if (!needsTextTransforms && proseOwner) {
        const original = RtlFixer._originalElementState.get(element);
        const siteDir = original?.writtenDir && element.getAttribute('dir') === original.writtenDir.value
          ? original.dir : element.getAttribute('dir');
        // Most formatting wrappers inherit their owner's result. Check that
        // result during the write phase; if it was not established, the normal
        // apply entry point performs a fresh full inspection at that point.
        if (!hasExplicitDirection(siteDir)) {
          prepared.set(element, { element, structuralVersion: RtlFixer._domStructureMutationVersion || 0 });
          continue;
        }
      }
      const target = inspectTarget(element, discoveredTexts);
      prepared.set(element, target);
      if (!target.isSafe || target.isMath ||
          (config.alignmentMode !== 'force-rtl' && !target.isRtl) ||
          RtlFixer._originalElementState.has(element)) continue;
      const original = RtlFixer._originalElementState.get(element);
      const siteDir = original ? original.dir : element.getAttribute('dir');
      // Inline wrappers normally share their paragraph's bidi context. Let
      // applyRtlToElement capture them only if the owner does not become RTL.
      if (!hasExplicitDirection(siteDir) && proseOwner) continue;
      RtlFixer.captureOriginalState(element);
      const ancestors = RtlFixer.findSpecialAncestors(element);
      target.ancestors = ancestors;
      target.proseDirections = proseDirections;
      if (config.fixListsBlockquotes) {
        if (ancestors.liAncestor && !ancestors.liAncestor.classList.contains('rtl-fixer-li-processed') &&
            proseDirection(ancestors.liAncestor)) {
          RtlFixer.captureOriginalState(ancestors.liAncestor);
          const list = ancestors.liAncestor.parentElement;
          if (list && /^(UL|OL)$/.test(list.tagName) &&
              !config.persianDigits && !config.isolateLtrRuns && !config.bionicTextEnabled &&
              areAllListItemsRtl(list)) RtlFixer.captureOriginalState(list);
        }
        if (ancestors.blockquoteAncestor &&
            !ancestors.blockquoteAncestor.classList.contains('rtl-fixer-blockquote-processed') &&
            proseDirection(ancestors.blockquoteAncestor)) RtlFixer.captureOriginalState(ancestors.blockquoteAncestor);
      }
      if (config.fixTables && ancestors.tableCell) RtlFixer.captureOriginalState(ancestors.tableCell);
    }
    return prepared;
  }

  // Scan DOM using native TreeWalker (Highly Optimized: visits only elements and rejects ignored/math subtrees)
  RtlFixer.scanAndProcessSteps = function* (element) {
    if (!RtlFixer._isActive) return; // Guard: don't process when deactivated
    if (!element || (element.nodeType !== Node.ELEMENT_NODE && element.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)) return;
    if (RtlFixer.isExtensionNode(element)) return;
    if (element.nodeType === Node.ELEMENT_NODE && element.closest?.('.rtl-fixer-bionic')) return;

    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (element.nodeType === Node.ELEMENT_NODE && !hasExplicitDirection(authorDirection(element)) &&
        !config.persianDigits && !config.isolateLtrRuns && !config.bionicTextEnabled) {
      const simpleText = RtlFixer.getSimpleProseText(element);
      if (simpleText !== null) {
        const prepared = inspectTarget(element, undefined, true, simpleText);
        if (!prepared.isSafe) {
          RtlFixer.clearManagedElement(element);
          yield;
          return;
        }
        if (!prepared.isMath) {
          // The same path handles Persian -> English -> Persian transitions.
          // An English frame must not force every formatting span to be scanned.
          RtlFixer.applyRtlToElement(element, prepared);
          yield;
          yield* RtlFixer.processTerminalLatinLabelsInSubtreeSteps(element,
            config.alignmentMode !== 'force-rtl' && !prepared.isRtl);
          return;
        }
      }
    }

    // KaTeX is skipped by the prose walker, but \text{Persian} still needs its
    // own bidi context. This also handles math roots added by a streaming UI.
    const subtreeContainsRtl = RtlFixer.containsRtl(element.textContent || '');
    yield;
    const existingMath = element.nodeType === Node.ELEMENT_NODE && element.closest?.('.rtl-fixer-katex-ltr');
    if (subtreeContainsRtl || existingMath) yield* RtlFixer.processMathTextInSubtreeSteps(element);

    // Capture table geometry before any ancestor receives an RTL direction.
    yield* rememberTableDirectionsSteps(element);

    if (typeof RtlFixer.processInputsInSubtreeSteps === 'function') {
      yield* RtlFixer.processInputsInSubtreeSteps(element);
    }
    
    if (element.nodeType === Node.ELEMENT_NODE) {
      if ((RtlFixer.IGNORED_TAGS.has(element.tagName) && element !== document.documentElement) ||
          element.hasAttribute('contenteditable')) return;
      if (element.matches && element.matches(RtlFixer.MATH_CONTAINER_SELECTOR)) {
        if (element.classList.contains('rtl-fixer-target')) RtlFixer.clearManagedElement(element);
        return;
      }
      if (element.matches && element.matches(RtlFixer.EXTENSION_UI_SELECTOR)) return;
    }

    // Always process an already-created shadow root. During initial startup the
    // observer may not exist yet, but its content must not be skipped.
    if (element.shadowRoot) {
      if (RtlFixer.observer) observeShadowRoot(element.shadowRoot);
      yield* RtlFixer.scanAndProcessSteps(element.shadowRoot);
    }

    if (!subtreeContainsRtl) {
      // Re-evaluate previously managed nodes that became LTR, but avoid all of
      // the per-element text/prose work for ordinary lazy-loaded UI subtrees.
      if (element.nodeType === Node.ELEMENT_NODE && element.classList.contains('rtl-fixer-target')) {
        RtlFixer.applyRtlToElement(element);
      }
      if (element.querySelectorAll) {
        for (const target of element.querySelectorAll('.rtl-fixer-target')) {
          RtlFixer.applyRtlToElement(target);
          yield;
        }
      }
      yield* RtlFixer.processTerminalLatinLabelsInSubtreeSteps(element, true);

      // textContent does not include shadow trees. Discover nested hosts without
      // running the heavier RTL target analysis over every light-DOM element.
      const shadowWalker = iterateConnectedElements(element, {
        acceptNode: node => RtlFixer.isExtensionNode(node) || RtlFixer.IGNORED_TAGS.has(node.tagName)
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      let shadowVisits = 15;
      for (const shadowHost of shadowWalker) {
        if (!shadowHost) { yield; continue; }
        if (shadowHost.shadowRoot) {
          if (RtlFixer.observer) observeShadowRoot(shadowHost.shadowRoot);
          yield* RtlFixer.scanAndProcessSteps(shadowHost.shadowRoot);
          shadowVisits = 15;
        }
        if (++shadowVisits >= 16) { shadowVisits = 0; yield; }
      }
      return;
    }

    const walker = iterateConnectedElements(
      element,
      {
        acceptNode: (el) => {
          if (RtlFixer.IGNORED_TAGS.has(el.tagName) || el.hasAttribute('contenteditable')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.classList.contains('rtl-fixer-bionic')) return NodeFilter.FILTER_REJECT;
          // Our own injected UI is already styled by content.css.
          if (matchesExtensionElement(el)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (matchesMathElement(el)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const targetElements = new Set();
    const discoveredTexts = new WeakMap();
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
    if (element.nodeType === Node.ELEMENT_NODE && RtlFixer.isProseBlockElement(element)) {
      const directionalText = RtlFixer.getDirectionalText(element);
      discoveredTexts.set(element, { rawText: element.textContent, directionalText, version: analysisVersion(element) });
      if (RtlFixer.containsRtl(directionalText)) targetElements.add(element);
    }

    // Traverse all un-ignored sub-elements
    let emptyWrapperVisits = 15;
    for (const el of walker) {
      if (!el) { yield; continue; }
      // Attach observer and recurse into nested shadow roots
      if (el.shadowRoot) {
        if (RtlFixer.observer) observeShadowRoot(el.shadowRoot);
        yield* RtlFixer.scanAndProcessSteps(el.shadowRoot);
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
      if (RtlFixer.isProseBlockElement(el)) {
        const directionalText = RtlFixer.getDirectionalText(el);
        discoveredTexts.set(el, { rawText: el.textContent, directionalText, version: analysisVersion(el) });
        if (RtlFixer.containsRtl(directionalText)) targetElements.add(el);
      }
      if (el.classList.contains('rtl-fixer-target')) targetElements.add(el);
      // Chat renderers wrap each paragraph in several empty layout divs.
      // Visit them all, but do not pay for a scheduler boundary on every empty
      // wrapper. Text targets still yield individually; empty chains yield at
      // most every 16 nodes and the outer time budget remains in effect.
      if (targetElements.has(el) || RtlFixer.isProseBlockElement(el) || ++emptyWrapperVisits >= 16) {
        emptyWrapperVisits = 0;
        yield;
      }
    }

    // Read all baselines before writing prose classes/direction. Interleaving
    // these phases for each small group repeatedly forced browser style work.
    // Both phases still yield in small groups; per-node versions invalidate
    // classifications only when the website actually changes their subtree.
    const targets = Array.from(targetElements);
    const TARGET_GROUP_SIZE = 16;
    const preparedTargets = new Map();
    const proseDirections = new Map();
    for (let index = 0; index < targets.length; index += TARGET_GROUP_SIZE) {
      const group = targets.slice(index, index + TARGET_GROUP_SIZE).filter(target => target.isConnected);
      for (const [target, prepared] of prepareTargetGroup(group, discoveredTexts, proseDirections)) {
        preparedTargets.set(target, prepared);
      }
      if (targets.length > TARGET_GROUP_SIZE) yield;
    }
    const needsTextTransforms = config.persianDigits || config.isolateLtrRuns || config.bionicTextEnabled;
    for (let index = 0; index < targets.length; index += TARGET_GROUP_SIZE) {
      for (const target of targets.slice(index, index + TARGET_GROUP_SIZE)) {
        if (!target.isConnected) continue;
        if (!needsTextTransforms) {
          const owner = RtlFixer.getInlineProseOwner(target);
          const original = RtlFixer._originalElementState.get(target);
          const siteDir = original?.writtenDir &&
            target.getAttribute('dir') === original.writtenDir.value
            ? original.dir : target.getAttribute('dir');
          if (owner?.classList.contains('rtl-fixer-rtl-detected') && !hasExplicitDirection(siteDir)) {
            // Formatting spans already share the paragraph's bidi context.
            // With no text transforms enabled, another full apply is redundant.
            RtlFixer.clearManagedElement(target);
            continue;
          }
        }
        RtlFixer.applyRtlToElement(target, preparedTargets.get(target));
      }
      yield;
    }
    yield* RtlFixer.processTerminalLatinLabelsInSubtreeSteps(element);
  };

  RtlFixer.scanAndProcess = function (element) {
    drainSteps(RtlFixer.scanAndProcessSteps(element));
  };

  // Flip arrow directions in non-isolated text nodes (outside <bdi> and ignored tags)
  RtlFixer.flipArrowsInElement = function (element) {
    if (RtlFixer.isExtensionNode(element)) return;
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (RtlFixer.isExtensionNode(node)) return NodeFilter.FILTER_REJECT;
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
    if (!config.inputsAutoDir || !input || RtlFixer.isExtensionNode(input) || input.getAttribute('contenteditable') === 'false') return;
    if (input.tagName === 'INPUT' && !['text','search','tel'].includes((input.type || 'text').toLowerCase())) return;
    if (RtlFixer.deferInputDirection?.(input)) return;

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

    const cachedDirection = inputDirectionCache.get(input);
    const direction = cachedDirection?.text === text ? cachedDirection.direction
      : text.trim() ? RtlFixer.detectParagraphDirection(text) : null;
    if (cachedDirection?.text !== text) inputDirectionCache.set(input, { text, direction });
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
      addClasses(host, 'rtl-fixer-input-host');
      if (host.style.direction !== direction) {
        RtlFixer.setManagedStyle(host, 'direction', direction);
      }
    }
  };

  // Process inputs and textareas
  RtlFixer.processInput = function (input) {
    if (RtlFixer.isExtensionNode(input)) return;
    if (input.classList.contains('rtl-fixer-input-processed')) return;
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    if (config.inputsAutoDir && input.isConnected) {
      RtlFixer.processInputDirection(input);
      input.classList.add('rtl-fixer-input-processed');
    }
  };

  RtlFixer.processInputsInSubtreeSteps = function* (root) {
    if (!(RtlFixer.config || RtlFixer.DEFAULT_CONFIG).inputsAutoDir) return;
    const selector = 'input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable]';
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      RtlFixer.processInput(root);
      yield;
    }
    if (root.querySelectorAll) {
      for (const input of root.querySelectorAll(selector)) {
        RtlFixer.processInput(input);
        yield;
      }
    }
  };

  RtlFixer.processInputsInSubtree = function (root) {
    drainSteps(RtlFixer.processInputsInSubtreeSteps(root));
  };

  // Process entire page
  RtlFixer.processPage = function () {
    if (!RtlFixer._isActive) return; // Guard: don't process when deactivated
    if (!document.body) return;
    if (typeof RtlFixer.enqueueScan === 'function') RtlFixer.enqueueScan(document.body);
    else RtlFixer.scanAndProcess(document.body);
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

    if (hasChanges) replaceManagedTextNode(textNode, fragment);
  };

})(window.RtlFixer);
