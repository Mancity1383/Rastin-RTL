// RTL Beautifier & Fixer - Orchestrator (Main Entry Point)
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  RtlFixer.observer = null;
  RtlFixer.styleElement = null;
  RtlFixer.fontImportElement = null;
  RtlFixer.config = { ...RtlFixer.DEFAULT_CONFIG };

  // Master flag: when false, ALL DOM processing is blocked.
  RtlFixer._isActive = false;

  let batchedNodes = new Set();
  let processingQueue = [];
  let processingIndex = 0;
  let pendingScanRoots = new Set();
  const batchedBulkNodes = new Set();
  let pendingBulkScans = 0;
  let activeScan = null;
  let activeScanRoot = null;
  const priorityNodes = new Set();
  let priorityScan = null;
  let priorityRoot = null;
  let viewportSampleNeeded = false;
  let lastViewportSample = -Infinity;
  let nextPromptStart = -Infinity;
  let backgroundDue = false;
  let scheduledWork = null;
  let scheduledPrune = null;
  let needsHighlightRestore = false;
  let configGeneration = 0;
  let initialSettingsReady = false;
  let initialSettingsFailed = false;
  const pendingSettingsUpdates = [];
  function completeInitialSettings(generation) {
    if (initialSettingsReady || generation !== configGeneration) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => completeInitialSettings(generation), { once: true });
      return;
    }
    initialSettingsReady = true;
    for (const update of pendingSettingsUpdates.splice(0)) {
      handleRuntimeMessage(update.message, update.sender, update.sendResponse);
    }
  }
  const WORK_BUDGET_MS = 6;
  const MAX_STEPS_PER_SLICE = 500;
  const MAX_QUEUED_ROOTS = 1000;
  const MAX_PRIORITY_ROOTS = 128;
  const PRIORITY_BUDGET_MS = 3;
  let composingInputs = new WeakSet();
  const deferredInputs = new Set();
  let inputFlushTimer = null;
  // These are scheduling hints only. Unknown/changed site markup still uses
  // the complete incremental scan, including content outside the chat body.
  const chatHost = window.location.hostname.toLowerCase();
  const chatMessageSelector = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(chatHost)
    ? '[data-message-author-role]'
    : /(^|\.)claude\.ai$/.test(chatHost)
      ? '[data-testid="assistant-message"],[data-testid="user-message"],.standard-markdown'
      : /(^|\.)gemini\.google\.com$/.test(chatHost) ? 'message-content,model-response,user-query' : null;
  let chatMain = null;
  let ownTextWrites = new WeakMap();
  let ownChildListWrites = new WeakMap();
  let ownTextWriteCount = 0;
  let nodeMutationVersions = new WeakMap();
  let contentMutationVersion = 0;
  RtlFixer.getNodeMutationVersion = node => nodeMutationVersions.get(node) || 0;
  const processingChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  let workSequence = 0;
  if (processingChannel) processingChannel.port1.onmessage = event => {
    if (scheduledWork?.type === 'message' && scheduledWork.id === event.data) processMutationQueue();
  };

  RtlFixer.recordOwnTextWrite = function (node, value) {
    if (!RtlFixer.observer) return;
    const writes = ownTextWrites.get(node) || [];
    writes.push({ oldValue: node.textContent, value });
    ownTextWrites.set(node, writes);
    ownTextWriteCount++;
  };
  RtlFixer.recordOwnChildListWrite = function (parent, addedNodes, removedNodes) {
    if (!RtlFixer.observer) return;
    const writes = ownChildListWrites.get(parent) || [];
    writes.push({ addedNodes: [...addedNodes], removedNodes: [...removedNodes] });
    ownChildListWrites.set(parent, writes);
  };
  function consumeOwnWrite(mutation, textValue) {
    const tracking = mutation.type === 'characterData' ? ownTextWrites : ownChildListWrites;
    const writes = tracking.get(mutation.target);
    if (!writes?.length) return false;
    const sameNodes = (expected, actual) => expected.length === actual.length &&
      expected.every((node, index) => node === actual[index]);
    const index = mutation.type === 'characterData'
      ? writes.findIndex(write => write.oldValue === mutation.oldValue && write.value === textValue)
      : writes.findIndex(write => sameNodes(write.addedNodes, mutation.addedNodes) && sameNodes(write.removedNodes, mutation.removedNodes));
    if (index < 0) return false;
    writes.splice(index, 1);
    if (mutation.type === 'characterData') ownTextWriteCount--;
    if (!writes.length) tracking.delete(mutation.target);
    return true;
  }

  function mutationTextValues(mutations) {
    const values = new Map();
    const nextValues = new WeakMap();
    for (let index = mutations.length - 1; index >= 0; index--) {
      const mutation = mutations[index];
      if (mutation.type !== 'characterData') continue;
      values.set(mutation, nextValues.has(mutation.target) ? nextValues.get(mutation.target) : mutation.target.textContent);
      nextValues.set(mutation.target, mutation.oldValue);
    }
    return values;
  }

  function cleanBatch(nodes) {
    const connected = nodes.filter(n => n && n.isConnected && !RtlFixer.isExtensionNode(n));
    if (connected.length <= 1) return connected;

    // Sort nodes in document order
    connected.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const result = [connected[0]];
    let lastKept = connected[0];
    for (let i = 1; i < connected.length; i++) {
      const node = connected[i];
      if (lastKept.contains(node)) {
        continue;
      }
      result.push(node);
      lastKept = node;
    }
    return result;
  }

  function scheduleIdleWork(callback, timeout = 250) {
    if (typeof requestIdleCallback === 'function') {
      return { type: 'idle', id: requestIdleCallback(callback, { timeout }) };
    }
    return {
      type: 'timeout',
      id: setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 16)
    };
  }

  function cancelScheduledWork(handle) {
    if (!handle) return;
    if (handle.type === 'message') return; // Its sequence is checked on delivery.
    if (handle.type === 'frame') {
      cancelAnimationFrame(handle.id);
    } else if (handle.type === 'idle' && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(handle.id);
    } else {
      clearTimeout(handle.id);
    }
  }

  function scheduleDisconnectedStatePrune() {
    if (document.hidden || scheduledPrune || typeof RtlFixer.pruneDisconnectedState !== 'function') return;
    scheduledPrune = scheduleIdleWork(() => {
      scheduledPrune = null;
      if (RtlFixer._isActive) RtlFixer.pruneDisconnectedState();
    }, 2000);
  }

  function scheduleMutationProcessing(afterSlice = false, prompt = false) {
    if (document.hidden) return;
    // A live edit can interrupt a queued history continuation. Rate-limit
    // posted starts so continuous mutations cannot turn into a task spin.
    if (prompt && processingChannel && scheduledWork?.type === 'frame' && performance.now() >= nextPromptStart) {
      cancelScheduledWork(scheduledWork);
      scheduledWork = null;
    }
    if (scheduledWork) return;
    // Small edits start in the next task without waiting for an idle period
    // or another frame. Large scans continue once per frame, leaving input and
    // rendering a chance to run instead of continuously posting CPU work.
    if ((afterSlice || !processingChannel) && typeof requestAnimationFrame === 'function') {
      scheduledWork = { type: 'frame', id: requestAnimationFrame(processMutationQueue) };
    } else if (processingChannel) {
      scheduledWork = { type: 'message', id: ++workSequence };
      processingChannel.port2.postMessage(scheduledWork.id);
    } else scheduledWork = { type: 'timeout', id: setTimeout(processMutationQueue, 0) };
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      cancelScheduledWork(scheduledWork);
      scheduledWork = null;
      cancelScheduledWork(scheduledPrune);
      scheduledPrune = null;
    } else if (RtlFixer._isActive) {
      if (hasScanWork() || needsHighlightRestore) scheduleMutationProcessing();
      scheduleInputDirectionFlush();
      scheduleDisconnectedStatePrune();
    }
  }

  function closeActiveScan() {
    activeScan?.return?.();
    activeScan = null;
    activeScanRoot = null;
  }

  function closePriorityScan() {
    priorityScan?.return?.();
    priorityScan = null;
    priorityRoot = null;
  }

  function hasScanWork() {
    return activeScan || priorityScan || priorityNodes.size || processingIndex < processingQueue.length || batchedNodes.size;
  }

  function promoteRoot(root) {
    if (priorityNodes.has(root)) return true;
    if (priorityNodes.size >= MAX_PRIORITY_ROOTS) return false;
    priorityNodes.add(root);
    batchedNodes.delete(root);
    // Leave a cheap tombstone in the document-order queue. The promoted root
    // reads the latest DOM once instead of replaying an unstarted old scan.
    pendingScanRoots.delete(root);
    return true;
  }

  function sampleVisibleChat() {
    if (!viewportSampleNeeded || !chatMessageSelector || !document.elementsFromPoint) return;
    const now = performance.now();
    if (now - lastViewportSample < 50) return;
    viewportSampleNeeded = false;
    lastViewportSample = now;
    if (!chatMain?.isConnected) chatMain = document.querySelector('main');
    const width = window.innerWidth, height = window.innerHeight;
    if (!chatMain || !width || !height) return;
    // Eight native hit tests, not a geometry read for every history message.
    // The ordinary scan still visits paragraphs between these sample points.
    for (const y of [0.12, 0.36, 0.62, 0.86]) {
      for (const x of [0.3, 0.65]) {
        for (let hit of document.elementsFromPoint(width * x, height * y).slice(0, 4)) {
          for (let depth = 0; hit.shadowRoot?.elementFromPoint && depth < 4; depth++) {
            const inner = hit.shadowRoot.elementFromPoint(width * x, height * y);
            if (!inner || inner === hit) break;
            hit = inner;
          }
          const prose = hit.closest?.('p,li,h1,h2,h3,h4,h5,h6,dt,dd,blockquote,td,th');
          if (!prose || prose.isContentEditable || RtlFixer.isExtensionNode(prose)) continue;
          const message = prose.closest(chatMessageSelector);
          if (message && chatMain.contains(message)) promoteRoot(prose);
        }
      }
    }
  }

  function handleViewportChange() {
    if (!RtlFixer._isActive || !chatMessageSelector || !hasScanWork()) return;
    viewportSampleNeeded = true;
    scheduleMutationProcessing();
  }

  function processMutationQueue() {
    scheduledWork = null;
    if (!RtlFixer._isActive) {
      batchedNodes.clear();
      processingQueue = [];
      processingIndex = 0;
      pendingScanRoots.clear();
      batchedBulkNodes.clear();
      pendingBulkScans = 0;
      closeActiveScan();
      priorityNodes.clear();
      closePriorityScan();
      needsHighlightRestore = false;
      return;
    }
    if (document.hidden) return;

    sampleVisibleChat();

    if (!activeScan && processingIndex >= processingQueue.length && batchedNodes.size > 0) {
      processingQueue = cleanBatch(Array.from(batchedNodes));
      processingIndex = 0;
      pendingScanRoots = new Set(processingQueue);
      pendingBulkScans = processingQueue.filter(node => !RtlFixer.isProseBlockElement?.(node)).length;
      batchedNodes.clear();
      batchedBulkNodes.clear();
    }

    const startedAt = performance.now();
    const workBudget = typeof navigator !== 'undefined' &&
      navigator.scheduling?.isInputPending?.({ includeContinuous: true }) ? 2 : WORK_BUDGET_MS;
    let processed = 0;
    let priorityTime = 0;
    let prioritySteps = 0;
    let backgroundSteps = 0;
    while (activeScan || processingIndex < processingQueue.length || priorityScan || priorityNodes.size) {
      // Always make progress, then yield before monopolizing another frame.
      if (processed > 0 && (performance.now() - startedAt >= workBudget || processed >= MAX_STEPS_PER_SLICE)) {
        break;
      }
      // Urgent edits get the first half of a slice; retained history always
      // gets a turn as well. Even a long continuously-streaming paragraph
      // cannot starve the background iterator.
      const backgroundPending = activeScan || processingIndex < processingQueue.length;
      if ((priorityScan || priorityNodes.size) &&
          (!backgroundPending || ((!backgroundDue || backgroundSteps > 0) &&
            priorityTime < Math.min(PRIORITY_BUDGET_MS, workBudget / 2) && prioritySteps < MAX_STEPS_PER_SLICE / 2))) {
        const priorityStart = performance.now();
        if (priorityScan && !priorityRoot.isConnected) closePriorityScan();
        if (!priorityScan && priorityNodes.size) {
          const node = priorityNodes.values().next().value;
          priorityNodes.delete(node);
          if (node.isConnected && !RtlFixer.isExtensionNode(node)) {
            nextPromptStart = startedAt + 8;
            if (typeof RtlFixer.scanAndProcessSteps === 'function') {
              priorityRoot = node;
              priorityScan = RtlFixer.scanAndProcessSteps(node);
            } else RtlFixer.scanAndProcess(node);
          }
        }
        if (priorityScan?.next().done) { priorityScan = null; priorityRoot = null; }
        priorityTime += performance.now() - priorityStart;
        prioritySteps++;
        processed++;
        continue;
      }
      backgroundSteps++;
      if (activeScan && !activeScanRoot.isConnected) {
        closeActiveScan();
        processed++;
        continue;
      }
      if (!activeScan) {
        const node = processingQueue[processingIndex++];
        if (!pendingScanRoots.has(node)) { processed++; continue; }
        pendingScanRoots.delete(node);
        if (!RtlFixer.isProseBlockElement?.(node)) pendingBulkScans--;
        if (!node.isConnected || RtlFixer.isExtensionNode(node)) { processed++; continue; }
        if (typeof RtlFixer.scanAndProcessSteps === 'function') {
          activeScan = RtlFixer.scanAndProcessSteps(node);
          activeScanRoot = node;
        }
        else { RtlFixer.scanAndProcess(node); processed++; continue; }
      }
      if (activeScan.next().done) { activeScan = null; activeScanRoot = null; }
      processed++;
    }
    // A single native operation may exceed our cooperative time budget. If
    // urgent work consumed that entire slice, start the next one with history.
    backgroundDue = Boolean((activeScan || processingIndex < processingQueue.length) &&
      prioritySteps > 0 && backgroundSteps === 0);

    if (!activeScan && processingIndex >= processingQueue.length) {
      processingQueue = [];
      processingIndex = 0;
      pendingScanRoots.clear();
      pendingBulkScans = 0;
    }

    if (hasScanWork()) {
      scheduleMutationProcessing(true);
      return;
    }

    if (needsHighlightRestore) {
      needsHighlightRestore = false;
      if (RtlFixer.config?.highlightEnabled && typeof RtlFixer.requestRestore === 'function') {
        RtlFixer.requestRestore();
      }
    }
  }

  function enqueueMutationNode(node, extensionChecked = false, prompt = false, forcePriority = false) {
    if (!node || !node.isConnected || (!extensionChecked && RtlFixer.isExtensionNode(node))) return;
    // Streaming renderers insert/update inline wrappers after the empty block
    // was scanned. Re-evaluate that block, not just the newest text fragment.
    const root = RtlFixer.getInlineProseOwner(node) || node;
    // Ordinary multi-message streaming already coalesces unstarted roots.
    // Promote only when history would delay this edit; promoting every token
    // needlessly opens overlapping scans of messages already in that queue.
    if (prompt && RtlFixer.isProseBlockElement?.(root) &&
        (forcePriority || pendingBulkScans || batchedBulkNodes.size || priorityRoot === root || priorityNodes.has(root) ||
          (activeScanRoot && !RtlFixer.isProseBlockElement?.(activeScanRoot))) && promoteRoot(root)) return;
    if (batchedNodes.has(root) || priorityNodes.has(root) || batchedNodes.has(document.documentElement)) return;
    // A queued root that has not started yet will read the latest DOM when
    // reached. Retain updates to the active/already-scanned roots, but avoid
    // scanning every future message again after a streaming burst.
    if (!pendingScanRoots.has(root)) {
      batchedNodes.add(root);
      if (!RtlFixer.isProseBlockElement?.(root)) batchedBulkNodes.add(root);
    }
    if (chatMessageSelector && !RtlFixer.isProseBlockElement?.(root)) viewportSampleNeeded = true;
    // Background tabs can accumulate an arbitrarily long virtualized chat.
    // One fresh document scan also discovers its connected open shadow roots.
    if (batchedNodes.size > MAX_QUEUED_ROOTS) {
      batchedNodes.clear();
      batchedNodes.add(document.documentElement);
      batchedBulkNodes.clear();
      batchedBulkNodes.add(document.documentElement);
    }
  }
  RtlFixer.enqueueScan = function (node, { priority = false } = {}) {
    if (!RtlFixer._isActive) return;
    enqueueMutationNode(node, false, priority, priority);
    if (batchedNodes.size || priorityNodes.size) {
      needsHighlightRestore ||= Boolean(RtlFixer.config?.highlightEnabled);
      scheduleMutationProcessing(false, priorityNodes.size > 0);
    }
  };

  function inputTarget(event) {
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (!target || RtlFixer.isExtensionNode(target)) return null;
    const input = target.closest?.('input,textarea,[contenteditable]') || target;
    return input.tagName === 'INPUT' || input.tagName === 'TEXTAREA' ||
      input.hasAttribute?.('contenteditable') ? input : null;
  }

  function inputHasSelection(input) {
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      const root = input.getRootNode?.();
      if ((root?.activeElement || document.activeElement) !== input) return false;
      return typeof input.selectionStart === 'number' && input.selectionStart !== input.selectionEnd;
    }
    const root = input.getRootNode?.();
    const selection = (root?.getSelection?.() || document.getSelection?.());
    return Boolean(selection && !selection.isCollapsed &&
      (input.contains(selection.anchorNode) || input.contains(selection.focusNode)));
  }

  RtlFixer.deferInputDirection = function (input) {
    const defer = composingInputs.has(input) || inputHasSelection(input);
    if (defer) deferredInputs.add(input);
    else deferredInputs.delete(input);
    return defer;
  };

  function flushInputDirections() {
    inputFlushTimer = null;
    if (!RtlFixer._isActive || document.hidden) return;
    for (const input of deferredInputs) {
      if (!input.isConnected) { deferredInputs.delete(input); continue; }
      if (!RtlFixer.deferInputDirection(input)) RtlFixer.processInputDirection(input);
    }
  }

  function scheduleInputDirectionFlush() {
    if (!deferredInputs.size || inputFlushTimer !== null || document.hidden) return;
    inputFlushTimer = setTimeout(flushInputDirections, 0);
  }

  function handleCompositionStart(event) {
    const input = inputTarget(event);
    if (input) composingInputs.add(input);
  }

  function handleCompositionEnd(event) {
    const input = inputTarget(event);
    if (!input) return;
    composingInputs.delete(input);
    deferredInputs.add(input);
    scheduleInputDirectionFlush();
  }

  // Direction-only writes leave text, selection ranges and the editor's undo
  // history intact. Never change the bidi context during an IME composition.
  RtlFixer.handleInputEvent = function (event) {
    if (!RtlFixer._isActive) return;
    const input = inputTarget(event);
    if (!input) return;
    if (event.isComposing) { deferredInputs.add(input); return; }
    if (!RtlFixer.deferInputDirection(input)) RtlFixer.processInputDirection(input);
  };

  // MutationObserver to capture dynamically loaded content
  RtlFixer.startObserver = function () {
    if (RtlFixer.observer) return;

    if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Starting observer');
    document.addEventListener('input', RtlFixer.handleInputEvent, true);
    document.addEventListener('focusin', RtlFixer.handleInputEvent, true);
    document.addEventListener('compositionstart', handleCompositionStart, true);
    document.addEventListener('compositionend', handleCompositionEnd, true);
    document.addEventListener('selectionchange', scheduleInputDirectionFlush, true);
    document.addEventListener('focusout', scheduleInputDirectionFlush, true);
    document.addEventListener('scroll', handleViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    RtlFixer.handlePageMutations = (mutations) => {
      if (!RtlFixer._isActive) return;

      if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Mutation detected! Count:', mutations.length);
      // Mutations caused solely by our own UI must not schedule a restore —
      // the restore repaints that UI, which would re-enter this callback.
      let sawPageMutation = false;
      let highlightRelevantMutation = false;
      let sawRemoval = false;
      let sawOwnedTextMutation = false;
      let sawContentMutation = false;
      const pageMutations = [];
      const trackHighlightMutations = Boolean(RtlFixer.config?.highlightEnabled);
      // Ordinary text streaming has no outstanding extension text writes.
      // Reconstruct mutation values only when a digit conversion needs them.
      const textValues = ownTextWriteCount ? mutationTextValues(mutations) : null;
      // One stamp per observer delivery. Shared ancestors are visited once,
      // so a stream of edits invalidates its message without invalidating all
      // the unrelated messages whose analysis is awaiting a later work slice.
      const textTargets = new WeakMap();
      const changedTextNodes = new WeakSet();
      const extensionNodes = new WeakMap();
      let contentVersion = 0;
      let sawStructureChange = false;
      const isExtensionMutationNode = node => {
        const cached = extensionNodes.get(node);
        if (cached !== undefined) return cached;
        const extension = RtlFixer.isExtensionNode(node);
        extensionNodes.set(node, extension);
        return extension;
      };
      const hasOnlyExtensionNodes = mutation => {
        for (const node of mutation.addedNodes) if (!isExtensionMutationNode(node)) return false;
        // Removed nodes already expose their new parent at delivery time. A
        // page paragraph moved into a widget still changed its old page root.
        // Only a removed widget root's own marker can prove it was our UI.
        for (const node of mutation.removedNodes) {
          if (!RtlFixer.isExtensionElement(node)) return false;
        }
        return true;
      };
      const stampContentChange = node => {
        contentVersion ||= ++contentMutationVersion;
        const start = node.nodeType === Node.TEXT_NODE ? node.parentNode || node.parentElement : node;
        for (let current = start; current && nodeMutationVersions.get(current) !== contentVersion;
          current = current.parentNode || current.parentElement || current.host) {
          nodeMutationVersions.set(current, contentVersion);
        }
      };
      const textMutationTarget = parent => {
        const cached = textTargets.get(parent);
        if (cached) return cached;
        // Native closest traverses formatting wrappers without allocating a
        // JavaScript path or probing classList on every ancestor. It also
        // naturally stops at a shadow boundary.
        const managed = parent.closest('.rtl-fixer-target');
        const target = managed && managed !== document.body ? managed : parent;
        textTargets.set(parent, target);
        return target;
      };
      for (const mutation of mutations) {
        if (isExtensionMutationNode(mutation.target)) continue;
        if (mutation.type === 'childList' && hasOnlyExtensionNodes(mutation)) continue;
        if (trackHighlightMutations) pageMutations.push(mutation);

        if ((mutation.type === 'characterData' || mutation.type === 'childList') &&
            consumeOwnWrite(mutation, textValues?.get(mutation))) {
          // Text transformations still invalidate highlight anchors, but do
          // not need another RTL scan of the content we just processed.
          sawOwnedTextMutation = true;
          continue;
        }

        // Multiple token writes to one text node have one final DOM value.
        // Own writes and highlight notifications above still see every record.
        if (mutation.type === 'characterData') {
          if (changedTextNodes.has(mutation.target)) continue;
          changedTextNodes.add(mutation.target);
        }

        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          sawContentMutation = true;
          stampContentChange(mutation.target);
          if (mutation.type === 'childList') {
            const changesElements = [...mutation.addedNodes, ...mutation.removedNodes]
              .some(node => node.nodeType === Node.ELEMENT_NODE);
            // Row/cell insertions change the column grid. Ordinary streamed
            // spans inside a cell reuse its cached column alignment.
            if (changesElements && /^(TABLE|THEAD|TBODY|TFOOT|TR|COLGROUP)$/.test(mutation.target.tagName)) {
              const table = RtlFixer.invalidateTableLayout?.(mutation.target);
              if (table) { sawPageMutation = true; enqueueMutationNode(table, true); }
            }
            if (changesElements && !sawStructureChange) {
              RtlFixer._domStructureMutationVersion = (RtlFixer._domStructureMutationVersion || 0) + 1;
              sawStructureChange = true;
            }
            // A moved root needs a new traversal stamp even when its text is
            // unchanged. Prepared descendants separately check the structural
            // epoch without walking every node in the inserted subtree here.
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE && !isExtensionMutationNode(node)) stampContentChange(node);
            }
          }
        }

        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (isExtensionMutationNode(node)) continue;
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (RtlFixer.DEBUG) console.log('[Rastin RTL Debug] Node added:', node.tagName, 'id:', node.id);
              sawPageMutation = true;
              highlightRelevantMutation = true;
              enqueueMutationNode(node, true, RtlFixer.isProseBlockElement?.(mutation.target));
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              const parent = node.parentElement;
              if (parent && parent !== document.body) {
                sawPageMutation = true;
                highlightRelevantMutation = true;
                enqueueMutationNode(parent, true, true);
              }
            }
          }
          if (mutation.removedNodes.length > 0) {
            // Streaming renderers frequently replace a plain Text node. No
            // managed element was detached, so sweeping every saved element
            // on the page is unnecessary. Digit conversions retain Text nodes
            // and still need pruning when one of those exact nodes is removed.
            sawRemoval ||= [...mutation.removedNodes].some(node =>
              node.nodeType === Node.ELEMENT_NODE || RtlFixer._managedDigitNodes?.has(node));
            const target = mutation.target?.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target?.parentElement;
            if (target && (target.classList?.contains('rtl-fixer-target') ||
                RtlFixer.isProseBlockElement?.(target) || RtlFixer.getInlineProseOwner(target))) {
              sawPageMutation = true;
              highlightRelevantMutation = true;
              enqueueMutationNode(target, true, true);
            }
          }
        } else if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent && parent.nodeType === Node.ELEMENT_NODE) {
            sawPageMutation = true;
            highlightRelevantMutation = true;
            enqueueMutationNode(textMutationTarget(parent), true, true);
          }
        } else if (mutation.type === 'attributes' && /^(colspan|rowspan|align)$/.test(mutation.attributeName)) {
          const table = RtlFixer.invalidateTableLayout?.(mutation.target);
          if (table) { sawPageMutation = true; enqueueMutationNode(table, true); }
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'dir') {
          const target = mutation.target;
          const state = RtlFixer._originalElementState?.get(target);
          const written = state?.writtenDir;
          // Ignore our own direction write. React can later restore dir="auto"
          // on the same paragraph without changing any text nodes.
          if (!written || (target.hasAttribute('dir') === written.hadDir &&
              target.getAttribute('dir') === written.value)) continue;
          sawPageMutation = true;
          enqueueMutationNode(target, true, true);
        }
      }
      if (sawPageMutation || sawOwnedTextMutation || sawContentMutation) RtlFixer._domMutationVersion = (RtlFixer._domMutationVersion || 0) + 1;
      if (RtlFixer.config?.highlightEnabled && pageMutations.length) RtlFixer.notifyHighlightMutations?.(pageMutations);
      if (sawRemoval) scheduleDisconnectedStatePrune();
      needsHighlightRestore ||= Boolean(RtlFixer.config?.highlightEnabled) &&
        (highlightRelevantMutation || sawOwnedTextMutation);
      if ((sawPageMutation && (batchedNodes.size > 0 || priorityNodes.size > 0)) || needsHighlightRestore) {
        scheduleMutationProcessing(false, priorityNodes.size > 0);
      }
    };
    RtlFixer.observer = new MutationObserver(RtlFixer.handlePageMutations);
    RtlFixer.observer.observe(document.documentElement, { 
      childList: true, 
      subtree: true, 
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: ['dir', 'colspan', 'rowspan', 'align']
    });
  };

  RtlFixer.stopObserver = function () {
    document.removeEventListener('input', RtlFixer.handleInputEvent, true);
    document.removeEventListener('focusin', RtlFixer.handleInputEvent, true);
    document.removeEventListener('compositionstart', handleCompositionStart, true);
    document.removeEventListener('compositionend', handleCompositionEnd, true);
    document.removeEventListener('selectionchange', scheduleInputDirectionFlush, true);
    document.removeEventListener('focusout', scheduleInputDirectionFlush, true);
    document.removeEventListener('scroll', handleViewportChange, true);
    window.removeEventListener?.('resize', handleViewportChange);
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    if (RtlFixer.observer) {
      RtlFixer.observer.disconnect();
      RtlFixer.observer = null;
    }
    if (RtlFixer._observedShadowRoots) {
      RtlFixer._observedShadowRoots = new WeakSet();
    }
    batchedNodes.clear();
    processingQueue = [];
    processingIndex = 0;
    pendingScanRoots.clear();
    batchedBulkNodes.clear();
    pendingBulkScans = 0;
    closeActiveScan();
    priorityNodes.clear();
    closePriorityScan();
    viewportSampleNeeded = false;
    chatMain = null;
    nextPromptStart = lastViewportSample = -Infinity;
    backgroundDue = false;
    composingInputs = new WeakSet();
    deferredInputs.clear();
    clearTimeout(inputFlushTimer);
    inputFlushTimer = null;
    ownTextWrites = new WeakMap();
    ownChildListWrites = new WeakMap();
    ownTextWriteCount = 0;
    nodeMutationVersions = new WeakMap();
    needsHighlightRestore = false;
    cancelScheduledWork(scheduledWork);
    cancelScheduledWork(scheduledPrune);
    scheduledWork = null;
    scheduledPrune = null;
  };

  RtlFixer.init = function () {
    const generation = ++configGeneration;
    initialSettingsFailed = false;
    const cleanHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const hostKey = RtlFixer.getSiteConfigKey();

    chrome.storage.local.get([
      'enabled', 'adBlockEnabled', 'adBlockCosmetic', 'adBlockGapRemover',
      'translatorApi', 'translatorTargetLang', 'apiKeys', 'disabledAdBlockDomains', ...RtlFixer.getSiteConfigKeys()
    ], (allStorage) => {
      if (generation !== configGeneration) return;
      if (chrome.runtime.lastError) {
        console.warn('[Rastin RTL] Storage error:', chrome.runtime.lastError);
        if (!initialSettingsReady) initialSettingsFailed = true;
        for (const update of pendingSettingsUpdates.splice(0)) {
          update.sendResponse({ status: 'error', error: 'settings_unavailable' });
        }
        return;
      }

      // 1. Get global config
      const globalEnabled = allStorage.enabled !== false;
      const globalAdBlockEnabled = allStorage.adBlockEnabled !== false;
      const adBlockCosmetic = allStorage.adBlockCosmetic !== false;
      const adBlockGapRemover = allStorage.adBlockGapRemover !== false;
      const translatorApi = allStorage.translatorApi || 'openai';
      const apiKeys = allStorage.apiKeys || {};
      const disabledAdBlockDomains = allStorage.disabledAdBlockDomains || [];

      // 2. Get site-specific config
      const defaultSiteConfig = {
        enabled: false,
        alignmentMode: 'auto',
        inputsAutoDir: true,
        forceRightAlign: false,
        justifyText: false,
        fontFamily: 'Vazirmatn',
        customFontName: '',
        customFontUrl: '',
        fontWeight: '400',
        fontSizeAdjust: 0,
        lineHeightAdjust: 1.6,
        persianDigits: false,
        fixTables: true,
        fixListsBlockquotes: true,
        techCodeProtection: true,
        readingRulerEnabled: false,
        readingRulerFocus: false,
        focusCoachEnabled: false,
        readingProgressEnabled: false,
        batteryPositionX: '20px',
        batteryPositionY: '20px',
        bionicTextEnabled: false,
        allowCopyEnabled: false,
        translatorEnabled: false,
        highlightEnabled: false,
        adBlockEnabled: true
      };

      const siteConfig = { ...defaultSiteConfig, ...RtlFixer.getStoredSiteConfig(allStorage) };

      // 3. Merge them
      RtlFixer.config = {
        ...siteConfig,
        globalEnabled,
        globalAdBlockEnabled,
        adBlockCosmetic,
        adBlockGapRemover,
        translatorApi,
        translatorTargetLang: allStorage.translatorTargetLang || 'auto',
        apiKeys,
        disabledAdBlockDomains
      };

      const isCurrentlyActive = RtlFixer.config.globalEnabled && RtlFixer.config.enabled;
      if (typeof RtlFixer.initPaint === 'function') RtlFixer.initPaint();
      const isAdBlockDisabledForSite = disabledAdBlockDomains.some(d => {
        const dom = d.toLowerCase().replace(/^www\./, '');
        return cleanHost === dom || cleanHost.endsWith('.' + dom);
      });
      const isAdBlockActive = RtlFixer.config.globalEnabled && 
                              RtlFixer.config.globalAdBlockEnabled && 
                              RtlFixer.config.adBlockEnabled && 
                              !isAdBlockDisabledForSite;

      try {
        localStorage.setItem('rastin_rtl_active', isCurrentlyActive ? 'true' : 'false');
        localStorage.setItem('rastin_adblock_active', isAdBlockActive ? 'true' : 'false');
      } catch (_) {}

      if (!isCurrentlyActive) {
        RtlFixer._isActive = false;
        RtlFixer.removeRtlFixes();
        completeInitialSettings(generation);
        return;
      }
      
      RtlFixer._isActive = true;
      RtlFixer.applyStyles();
      if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
      if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
      if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
      if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
      
      // Observe first so pre-existing and newly-created shadow roots are both
      // registered while the initial document scan is in progress.
      const runInitializationSequence = () => {
        if (generation !== configGeneration) return;
        RtlFixer.startObserver();
        RtlFixer.processPage();
        if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
        completeInitialSettings(generation);
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runInitializationSequence);
      } else {
        runInitializationSequence();
      }
    });
  };

  // Listen for message updates from the popup controls
  const handleRuntimeMessage = (message, sender, sendResponse) => {
    if (sender && sender.id !== chrome.runtime.id) {
      if (sendResponse) sendResponse({ error: 'invalid_sender' });
      return;
    }
    if (message.action === 'getPageCapabilities') {
      sendResponse({ ok: true, contentType: document.contentType });
      return;
    }
    if (message.action === 'openTranslator') {
      if (RtlFixer.config.globalEnabled === false) { sendResponse({ ok: false, error: 'افزونه غیرفعال است.' }); return; }
      RtlFixer.openTranslator(); sendResponse({ ok: true }); return;
    }
    if (message.action === 'openPaint') {
      if (typeof RtlFixer.openPaint !== 'function') {
        sendResponse({ ok: false, error: 'برای استفاده، صفحه را تازه‌سازی کنید.' });
        return;
      }
      RtlFixer.openPaint().then(sendResponse, () => sendResponse({ ok: false, error: 'بازکردن ابزار ناموفق بود.' }));
      return true;
    }
    if (message.action === 'clear_all_highlights') {
      if (typeof RtlFixer.clearCurrentPageHighlights === 'function') {
        RtlFixer.clearCurrentPageHighlights();
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    }
    if (message.action === 'scrollToHighlight' && (message.highlightId || message.id)) {
      const targetId = message.highlightId || message.id;
      const found = typeof RtlFixer.scrollToHighlightById === 'function' &&
        RtlFixer.scrollToHighlightById(targetId);
      if (sendResponse) sendResponse({ success: true, found: Boolean(found) });
      return true;
    }
    if (message.action === 'updateSettings' && message.settings) {
      // Preserve the stored global/site baseline when a popup message arrives
      // before the first asynchronous storage read and DOM setup have finished.
      if (!initialSettingsReady) {
        pendingSettingsUpdates.push({ message, sender, sendResponse });
        // Retry a failed initial read only when another user update arrives.
        if (initialSettingsFailed) RtlFixer.init();
        return true;
      }
      configGeneration++;
      const oldConfig = { ...RtlFixer.config };
      RtlFixer.config = { ...RtlFixer.config, ...message.settings };
      if (typeof RtlFixer.initPaint === 'function') RtlFixer.initPaint();
      
      const cleanHost = window.location.hostname.toLowerCase().replace(/^www\./, '');
      const hostKey = RtlFixer.getSiteConfigKey();

      // PERSIST site settings to chrome.storage.local so enabled & highlightEnabled persist on refresh!
      const updatedSiteConfig = {
        enabled: RtlFixer.config.enabled,
        alignmentMode: RtlFixer.config.alignmentMode,
        inputsAutoDir: RtlFixer.config.inputsAutoDir,
        forceRightAlign: RtlFixer.config.forceRightAlign,
        justifyText: RtlFixer.config.justifyText,
        fontFamily: RtlFixer.config.fontFamily,
        customFontName: RtlFixer.config.customFontName,
        customFontUrl: RtlFixer.config.customFontUrl,
        fontWeight: RtlFixer.config.fontWeight,
        fontSizeAdjust: RtlFixer.config.fontSizeAdjust,
        lineHeightAdjust: RtlFixer.config.lineHeightAdjust,
        persianDigits: RtlFixer.config.persianDigits,
        fixTables: RtlFixer.config.fixTables,
        fixListsBlockquotes: RtlFixer.config.fixListsBlockquotes,
        techCodeProtection: RtlFixer.config.techCodeProtection,
        readingRulerEnabled: RtlFixer.config.readingRulerEnabled,
        readingRulerFocus: RtlFixer.config.readingRulerFocus,
        focusCoachEnabled: RtlFixer.config.focusCoachEnabled,
        readingProgressEnabled: RtlFixer.config.readingProgressEnabled,
        bionicTextEnabled: RtlFixer.config.bionicTextEnabled,
        allowCopyEnabled: RtlFixer.config.allowCopyEnabled,
        translatorEnabled: RtlFixer.config.translatorEnabled,
        highlightEnabled: RtlFixer.config.highlightEnabled,
        batteryPositionX: RtlFixer.config.batteryPositionX || '20px',
        batteryPositionY: RtlFixer.config.batteryPositionY || '20px',
        adBlockEnabled: RtlFixer.config.adBlockEnabled
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const persist = { [hostKey]: updatedSiteConfig };
        if (Object.prototype.hasOwnProperty.call(message.settings,'globalEnabled')) persist.enabled = Boolean(RtlFixer.config.globalEnabled);
        if (Object.prototype.hasOwnProperty.call(message.settings,'globalAdBlockEnabled')) persist.adBlockEnabled = Boolean(RtlFixer.config.globalAdBlockEnabled);
        chrome.storage.local.set(persist);
      }

      const isCurrentlyActive = RtlFixer.config.globalEnabled && RtlFixer.config.enabled;
      
      const disabledDomains = RtlFixer.config.disabledAdBlockDomains || [];
      const isAdBlockDisabledForSite = disabledDomains.some(d => {
        const dom = d.toLowerCase().replace(/^www\./, '');
        return cleanHost === dom || cleanHost.endsWith('.' + dom);
      });
      const isAdBlockActive = RtlFixer.config.globalEnabled && 
                              RtlFixer.config.globalAdBlockEnabled && 
                              RtlFixer.config.adBlockEnabled && 
                              !isAdBlockDisabledForSite;

      try {
        localStorage.setItem('rastin_rtl_active', isCurrentlyActive ? 'true' : 'false');
        localStorage.setItem('rastin_adblock_active', isAdBlockActive ? 'true' : 'false');
      } catch (_) {}

      const oldActive = oldConfig.globalEnabled && oldConfig.enabled;
      const needsFullRebuild = 
        oldActive !== isCurrentlyActive ||
        oldConfig.alignmentMode !== RtlFixer.config.alignmentMode ||
        oldConfig.inputsAutoDir !== RtlFixer.config.inputsAutoDir ||
        oldConfig.forceRightAlign !== RtlFixer.config.forceRightAlign ||
        oldConfig.justifyText !== RtlFixer.config.justifyText ||
        oldConfig.persianDigits !== RtlFixer.config.persianDigits ||
        oldConfig.fixTables !== RtlFixer.config.fixTables ||
        oldConfig.fixListsBlockquotes !== RtlFixer.config.fixListsBlockquotes ||
        oldConfig.techCodeProtection !== RtlFixer.config.techCodeProtection ||
        oldConfig.readingRulerEnabled !== RtlFixer.config.readingRulerEnabled ||
        oldConfig.readingRulerFocus !== RtlFixer.config.readingRulerFocus ||
        oldConfig.bionicTextEnabled !== RtlFixer.config.bionicTextEnabled ||
        oldConfig.focusCoachEnabled !== RtlFixer.config.focusCoachEnabled ||
        oldConfig.readingProgressEnabled !== RtlFixer.config.readingProgressEnabled ||
        oldConfig.allowCopyEnabled !== RtlFixer.config.allowCopyEnabled ||
        oldConfig.translatorEnabled !== RtlFixer.config.translatorEnabled ||
        oldConfig.translatorApi !== RtlFixer.config.translatorApi ||
        oldConfig.highlightEnabled !== RtlFixer.config.highlightEnabled ||
        JSON.stringify(oldConfig.apiKeys) !== JSON.stringify(RtlFixer.config.apiKeys);

      if (!isCurrentlyActive) {
        RtlFixer._isActive = false;
        RtlFixer.removeRtlFixes();
      } else {
        RtlFixer._isActive = true;
        if (needsFullRebuild) {
          RtlFixer.removeRtlFixes();
          RtlFixer.applyStyles();
          if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
          if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
          if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
          if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
          
          // Keep the observer active while rescanning existing shadow trees.
          RtlFixer.startObserver();
          RtlFixer.processPage();
          if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
        } else {
          RtlFixer.applyStyles();
          if (typeof RtlFixer.initRuler === 'function') RtlFixer.initRuler();
          if (typeof RtlFixer.initCoach === 'function') RtlFixer.initCoach();
          if (typeof RtlFixer.initCopyUnlocker === 'function') RtlFixer.initCopyUnlocker();
          if (typeof RtlFixer.initTranslator === 'function') RtlFixer.initTranslator();
          if (typeof RtlFixer.initHighlight === 'function') RtlFixer.initHighlight();
        }
      }
      sendResponse({ status: 'success' });
    }
  };
  RtlFixer.handleRuntimeMessage = handleRuntimeMessage;
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const currentHostKey = RtlFixer.getSiteConfigKey();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (window.location.protocol === 'file:' && changes['site_config_']) {
      RtlFixer.init();
      return;
    }
    const relevantKeys = [
      'enabled',
      'adBlockEnabled',
      'adBlockCosmetic',
      'translatorApi',
      'translatorTargetLang',
      'apiKeys',
      'disabledAdBlockDomains',
      currentHostKey
    ];
    const changedKeys = relevantKeys.filter(key => Object.prototype.hasOwnProperty.call(changes, key));
    const translatorKeys = ['translatorApi','translatorTargetLang','apiKeys'];
    if (changedKeys.length && changedKeys.every(key => translatorKeys.includes(key))) {
      for (const key of changedKeys) RtlFixer.config[key] = changes[key].newValue || (key === 'apiKeys' ? {} : key === 'translatorTargetLang' ? 'auto' : 'openai');
      return;
    }
    if (changedKeys.length === 1 && changedKeys[0] === currentHostKey) {
      const nextSiteConfig = changes[currentHostKey].newValue || {};
      // updateSettings already applied these exact values in this tab.
      if (Object.entries(nextSiteConfig).every(([key, value]) =>
          JSON.stringify(RtlFixer.config[key]) === JSON.stringify(value))) return;
    }
    if (changedKeys.length > 0) {
      RtlFixer.init();
    }
  });

  if (RtlFixer.isReaderPage()) {
    window.addEventListener('rastin-reader-document-changed', () => {
      RtlFixer.closePaint?.();
      RtlFixer.initPaint?.();
    });
  }

  // Run initialization
  RtlFixer.init();
})(window.RtlFixer);
