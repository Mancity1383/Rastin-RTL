import { copyItems, distanceToSegment, pdfRectToScreen, sanitizeItems, screenRectToPdf, viewportScale } from './annotation-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOOLS = new Set(['select', 'highlight', 'underline', 'pen', 'rect', 'note', 'erase']);
const STORAGE_PREFIX = 'rastin_pdf_annotations_';
const MAX_HISTORY = 100;

export function createAnnotations({ stage, layer, onChange = () => {}, onNote = () => {}, onError = () => {} }) {
  let items = [];
  let past = [];
  let future = [];
  let documentId = null;
  let page = 1;
  let viewport = null;
  let tool = 'select';
  let color = '#facc15';
  let width = 2;
  let draft = null;
  let destroyed = false;
  let loading = false;
  let loadSequence = 0;
  let documentSequence = 0;
  let pendingWrites = 0;
  let lastWriteError = null;
  let saveQueue = Promise.resolve();

  layer.setAttribute('aria-label', 'یادداشت‌ها و نشانه‌گذاری‌های PDF');
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.overflow = 'visible';

  const id = () => 'pdf_' + crypto.randomUUID();
  const pageItems = () => items.filter(item => item.page === page);
  const saveState = () => pendingWrites ? 'saving' : lastWriteError ? 'error' : 'saved';
  const emit = () => {
    if (!destroyed) onChange({ items: copyItems(items), canUndo: past.length > 0, canRedo: future.length > 0, saveState: saveState() });
  };
  const report = error => {
    if (!destroyed) onError(error instanceof Error ? error : new Error(String(error)));
  };

  function queueSave() {
    const key = STORAGE_PREFIX + documentId;
    const snapshot = { version: 1, items: copyItems(items), updatedAt: Date.now() };
    const sequence = documentSequence;
    pendingWrites++;
    emit();
    saveQueue = saveQueue.then(async () => {
      try {
        await chrome.storage.local.set({ [key]: snapshot });
        if (sequence === documentSequence) lastWriteError = null;
      } catch (error) {
        if (sequence === documentSequence) {
          lastWriteError = error;
          report(error);
        }
      } finally {
        pendingWrites--;
        emit();
      }
    });
  }

  function change(next) {
    if (!documentId || loading || destroyed) return false;
    past.push(copyItems(items));
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
    items = next;
    render();
    queueSave();
    return true;
  }

  async function flush() {
    // A failed write is retried with the complete current document. The caller
    // can await this before changing documents or preparing an export.
    await saveQueue;
    if (lastWriteError && documentId) {
      queueSave();
      await saveQueue;
    }
    if (lastWriteError) throw lastWriteError;
  }

  async function load(nextDocumentId, { isCurrent = () => true } = {}) {
    if (destroyed) return false;
    if (typeof nextDocumentId !== 'string' || !/^[a-f\d]{64}$/i.test(nextDocumentId)) throw new Error('Invalid PDF document identity');
    const sequence = ++loadSequence;
    loading = true;
    cancelDraft();
    updateTool();
    try {
      await flush();
      if (sequence !== loadSequence || destroyed || !isCurrent()) return false;
      const key = STORAGE_PREFIX + nextDocumentId.toLowerCase();
      const stored = await chrome.storage.local.get(key);
      if (sequence !== loadSequence || destroyed || !isCurrent()) return false;
      documentId = nextDocumentId.toLowerCase();
      documentSequence++;
      items = sanitizeItems(Array.isArray(stored[key]) ? stored[key] : stored[key]?.items);
      past = [];
      future = [];
      lastWriteError = null;
      render();
      return true;
    } catch (error) {
      if (sequence === loadSequence && !destroyed && isCurrent()) report(error);
      throw error;
    } finally {
      if (sequence === loadSequence && !destroyed) {
        loading = false;
        updateTool();
        emit();
      }
    }
  }

  function element(name, attributes = {}, text) {
    const node = layer.ownerDocument.createElementNS(SVG_NS, name);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function drawItem(item, temporary = false) {
    const group = element('g', { 'data-annotation-id': item.id, 'data-annotation-type': item.type });
    const scale = viewportScale(viewport);
    const strokeWidth = Math.max(0.6, item.width * scale);
    if (item.type === 'highlight' || item.type === 'rect') {
      for (const rect of item.rects) {
        const screen = pdfRectToScreen(viewport, rect);
        const shape = element('rect', {
          ...screen, rx: item.type === 'highlight' ? 1 : 0,
          fill: item.type === 'highlight' ? item.color : 'none',
          'fill-opacity': item.type === 'highlight' ? 0.34 : 0,
          stroke: item.type === 'rect' ? item.color : 'none', 'stroke-width': strokeWidth
        });
        if (item.type === 'highlight') shape.style.mixBlendMode = 'multiply';
        group.append(shape);
      }
    } else if (item.type === 'pen' || item.type === 'underline') {
      const points = item.points.map(point => viewport.convertToViewportPoint(...point));
      group.append(element('path', {
        d: points.map((point, index) => (index ? 'L' : 'M') + point.join(' ')).join(' '),
        fill: 'none', stroke: item.color, 'stroke-width': strokeWidth,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));
    } else if (item.type === 'note') {
      const point = viewport.convertToViewportPoint(...item.point);
      group.setAttribute('transform', 'translate(' + point.join(' ') + ')');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', item.text || 'یادداشت');
      group.style.pointerEvents = 'all';
      group.style.cursor = 'pointer';
      group.append(element('title', {}, item.text));
      group.append(element('path', { d: 'M2 0H20Q24 0 24 4V18Q24 22 20 22H8L2 27V22Q0 22 0 18V4Q0 0 2 0Z', fill: item.color, stroke: '#854d0e', 'stroke-width': 1 }));
      group.append(element('path', { d: 'M6 7H18M6 11H18M6 15H13', fill: 'none', stroke: '#713f12', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
    }
    if (temporary) group.setAttribute('data-annotation-draft', 'true');
    layer.append(group);
  }

  function draftItem() {
    if (!draft || !viewport || !draft.current) return null;
    const base = { id: 'draft', page, type: draft.tool, color: draft.color, width: draft.width };
    if (draft.tool === 'pen') return { ...base, points: draft.points.map(point => viewport.convertToPdfPoint(...point)) };
    if (draft.tool === 'underline') {
      const y = Math.max(draft.start[1], draft.current[1]);
      return { ...base, points: [viewport.convertToPdfPoint(draft.start[0], y), viewport.convertToPdfPoint(draft.current[0], y)] };
    }
    if (draft.tool === 'highlight' || draft.tool === 'rect') return {
      ...base, rects: [screenRectToPdf(viewport, {
        x: Math.min(draft.start[0], draft.current[0]), y: Math.min(draft.start[1], draft.current[1]),
        width: Math.abs(draft.start[0] - draft.current[0]), height: Math.abs(draft.start[1] - draft.current[1])
      })]
    };
    return null;
  }

  function render() {
    layer.replaceChildren();
    if (!viewport || destroyed) return;
    layer.setAttribute('width', viewport.width);
    layer.setAttribute('height', viewport.height);
    layer.setAttribute('viewBox', '0 0 ' + viewport.width + ' ' + viewport.height);
    for (const item of pageItems()) if (!draft?.erased?.has(item.id)) drawItem(item);
    const preview = draftItem();
    if (preview) drawItem(preview, true);
  }

  function updateTool() {
    const active = viewport && documentId && !loading && !destroyed;
    layer.style.pointerEvents = active && tool !== 'select' ? 'all' : 'none';
    layer.style.touchAction = active && tool !== 'select' ? 'none' : 'auto';
    layer.style.cursor = tool === 'erase' ? 'cell' : tool === 'select' ? 'auto' : 'crosshair';
    stage.dataset.annotationTool = tool;
  }

  function clientPoint(event) {
    const bounds = stage.getBoundingClientRect();
    return [
      Math.max(0, Math.min(viewport.width, (event.clientX - bounds.left) * viewport.width / bounds.width)),
      Math.max(0, Math.min(viewport.height, (event.clientY - bounds.top) * viewport.height / bounds.height))
    ];
  }

  function annotationAt(point, target) {
    const group = target?.closest?.('[data-annotation-id]');
    const targeted = group && pageItems().find(item => item.id === group.getAttribute('data-annotation-id'));
    if (targeted) return targeted;
    const scale = viewportScale(viewport);
    return [...pageItems()].reverse().find(item => {
      if (draft?.erased?.has(item.id)) return false;
      if (item.type === 'note') {
        const position = viewport.convertToViewportPoint(...item.point);
        return point[0] >= position[0] - 4 && point[0] <= position[0] + 28 && point[1] >= position[1] - 4 && point[1] <= position[1] + 31;
      }
      if (item.points) {
        const points = item.points.map(position => viewport.convertToViewportPoint(...position));
        return points.slice(1).some((end, index) => distanceToSegment(point, points[index], end) <= Math.max(7, item.width * scale / 2 + 4));
      }
      return item.rects.some(rect => {
        const screen = pdfRectToScreen(viewport, rect);
        const inside = point[0] >= screen.x - 5 && point[0] <= screen.x + screen.width + 5 && point[1] >= screen.y - 5 && point[1] <= screen.y + screen.height + 5;
        return inside && (item.type === 'highlight' || Math.min(Math.abs(point[0] - screen.x), Math.abs(point[0] - screen.x - screen.width), Math.abs(point[1] - screen.y), Math.abs(point[1] - screen.y - screen.height)) <= Math.max(7, item.width * scale / 2 + 4));
      });
    });
  }

  function openNote(item) {
    onNote({ point: [...item.point], id: item.id, text: item.text });
  }

  function pointerDown(event) {
    if (!viewport || !documentId || loading || destroyed || event.button !== 0 || draft) return;
    const point = clientPoint(event);
    const existing = annotationAt(point, event.target);
    if (tool === 'select') {
      if (existing?.type === 'note') { event.preventDefault(); openNote(existing); }
      return;
    }
    event.preventDefault();
    draft = { tool, color, width, start: point, current: point, points: [point], pointerId: event.pointerId, page, erased: new Set() };
    if (tool === 'erase' && existing) draft.erased.add(existing.id);
    try { stage.setPointerCapture(event.pointerId); } catch { /* Pointer may already have ended. */ }
    render();
  }

  function pointerMove(event) {
    if (!draft || draft.pointerId !== event.pointerId || !viewport) return;
    event.preventDefault();
    draft.current = clientPoint(event);
    if (draft.tool === 'pen' && Math.hypot(draft.current[0] - draft.points.at(-1)[0], draft.current[1] - draft.points.at(-1)[1]) >= 0.8) {
      if (draft.points.length < 20000) draft.points.push(draft.current);
    }
    if (draft.tool === 'erase') {
      const hit = annotationAt(draft.current, event.target);
      if (hit) draft.erased.add(hit.id);
    }
    render();
  }

  function releasePointer(pointerId) {
    try { if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId); } catch { /* Capture is optional. */ }
  }

  function cancelDraft() {
    if (draft) {
      const pointerId = draft.pointerId;
      draft = null;
      releasePointer(pointerId);
      render();
    }
  }

  function pointerUp(event) {
    if (!draft || draft.pointerId !== event.pointerId) return;
    pointerMove(event);
    const finished = draft;
    let item = draftItem();
    draft = null;
    releasePointer(finished.pointerId);
    const distance = Math.hypot(finished.start[0] - finished.current[0], finished.start[1] - finished.current[1]);
    if (finished.tool === 'note' && distance < 8) {
      const existing = annotationAt(finished.current, event.target);
      if (existing?.type === 'note') openNote(existing);
      else onNote({ point: viewport.convertToPdfPoint(...finished.current) });
    } else if (finished.tool === 'erase' && finished.erased.size) {
      change(items.filter(item => !finished.erased.has(item.id)));
    } else if (item) {
      // Closed pen strokes may end beside their starting point. Validate their
      // travelled length rather than rejecting circles and other closed marks.
      const travelled = item.points?.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - item.points[index][0], point[1] - item.points[index][1]), 0) || 0;
      const valid = item.points ? item.points.length >= 2 && travelled * viewportScale(viewport) >= 1.5 : item.rects[0].width > 0 && item.rects[0].height > 0 && distance >= 3;
      if (valid) {
        item = { ...item, id: id() };
        change([...items, item]);
      }
    }
    render();
  }

  function pointerCancel(event) {
    if (draft?.pointerId === event.pointerId) cancelDraft();
  }

  function keyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const group = event.target.closest?.('[data-annotation-id]');
    const item = group && pageItems().find(item => item.id === group.getAttribute('data-annotation-id'));
    if (item?.type === 'note') { event.preventDefault(); openNote(item); }
  }

  function selectText(selection, { text = '' } = {}) {
    if (!viewport || !documentId || loading || destroyed || !selection) return false;
    const ranges = typeof selection.getClientRects === 'function' ? [selection] :
      Array.from({ length: selection.rangeCount || 0 }, (_, index) => selection.getRangeAt(index));
    const bounds = stage.getBoundingClientRect();
    const rects = [];
    for (const range of ranges) {
      if (range.collapsed || !stage.contains(range.startContainer) || !stage.contains(range.endContainer)) continue;
      for (const clientRect of range.getClientRects()) {
        const left = Math.max(clientRect.left, bounds.left);
        const top = Math.max(clientRect.top, bounds.top);
        const right = Math.min(clientRect.right, bounds.right);
        const bottom = Math.min(clientRect.bottom, bounds.bottom);
        if (right - left < 0.5 || bottom - top < 0.5) continue;
        const rect = { x: (left - bounds.left) * viewport.width / bounds.width,
          y: (top - bounds.top) * viewport.height / bounds.height,
          width: (right - left) * viewport.width / bounds.width, height: (bottom - top) * viewport.height / bounds.height };
        if (!rects.some(previous => Object.keys(rect).every(key => Math.abs(rect[key] - previous[key]) < 0.5))) rects.push(rect);
      }
    }
    if (!rects.length) return false;
    const base = { page, color, width, ...(typeof text === 'string' && text.trim() ? { text: text.normalize('NFKC').trim().slice(0, 2000) } : {}) };
    const additions = tool === 'underline' ? rects.map(rect => ({ ...base, id: id(), type: 'underline',
      points: [viewport.convertToPdfPoint(rect.x, rect.y + rect.height - 1), viewport.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height - 1)] })) :
      [{ ...base, id: id(), type: 'highlight', rects: rects.map(rect => screenRectToPdf(viewport, rect)) }];
    return change([...items, ...additions]);
  }

  function addNote({ point, text, id: noteId } = {}) {
    if (typeof text !== 'string' || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return false;
    text = text.trim().slice(0, 20000);
    if (!text) return noteId ? remove(noteId) : false;
    const existing = noteId ? items.find(item => item.id === noteId && item.type === 'note') : null;
    if (noteId && !existing) return false;
    const note = existing ? { ...existing, text } : { id: id(), page, type: 'note', color, width, point: [...point], text };
    if (existing?.text === text) return true;
    return change(existing ? items.map(item => item.id === existing.id ? note : item) : [...items, note]);
  }

  function remove(itemId) {
    if (!items.some(item => item.id === itemId)) return false;
    return change(items.filter(item => item.id !== itemId));
  }

  function undo() {
    if (!past.length || loading || destroyed) return false;
    cancelDraft();
    future.push(copyItems(items));
    items = past.pop();
    render();
    queueSave();
    return true;
  }

  function redo() {
    if (!future.length || loading || destroyed) return false;
    cancelDraft();
    past.push(copyItems(items));
    items = future.pop();
    render();
    queueSave();
    return true;
  }

  const listeners = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp,
    pointercancel: pointerCancel, lostpointercapture: pointerCancel, keydown: keyDown };
  for (const [name, listener] of Object.entries(listeners)) stage.addEventListener(name, listener);
  updateTool();

  return {
    load, flush, selectText, addNote, remove, undo, redo,
    setPage(pageNumber, nextViewport) {
      cancelDraft();
      if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('Invalid PDF page');
      page = pageNumber;
      viewport = nextViewport || null;
      render();
      updateTool();
    },
    setTool(nextTool) {
      if (!TOOLS.has(nextTool)) throw new Error('Unknown annotation tool');
      cancelDraft();
      tool = nextTool;
      updateTool();
    },
    setColor(nextColor) { if (/^#[a-f\d]{6}$/i.test(nextColor)) color = nextColor; },
    setWidth(nextWidth) { if (Number.isFinite(nextWidth)) width = Math.max(0.25, Math.min(24, nextWidth)); },
    clearPage() { cancelDraft(); return pageItems().length ? change(items.filter(item => item.page !== page)) : false; },
    getAll() { return copyItems(items); },
    getPageItems() { return copyItems(pageItems()); },
    destroy() {
      cancelDraft();
      destroyed = true;
      loadSequence++;
      for (const [name, listener] of Object.entries(listeners)) stage.removeEventListener(name, listener);
      layer.replaceChildren();
      layer.style.pointerEvents = 'none';
      // Queued storage writes retain their captured key and snapshot.
    }
  };
}
