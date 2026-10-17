const SVG_NS = 'http://www.w3.org/2000/svg';
const arabic = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const latin = /[\p{Letter}\p{Number}]/u;
const segmenter = new Intl.Segmenter('fa', { granularity: 'word' });
const rectUnion = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
};
const distance = (p, r) => Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.width), Math.max(r.y - p[1], 0, p[1] - r.y - r.height));
const direction = text => arabic.test(text) ? 'rtl' : latin.test(text) ? 'ltr' : null;

// Positioned word fragments are sorted spatially, then joined across PDF glyph
// spans. Their DOM order is frequently the reverse of Persian reading order.
export function buildReadingWords(fragments) {
  const lines = [];
  for (const fragment of [...fragments].sort((a, b) => a.frame.y - b.frame.y)) {
    const center = fragment.frame.y + fragment.frame.height / 2;
    let line = lines.find(candidate => Math.abs(candidate.center - center) <= Math.max(2, Math.min(candidate.height, fragment.frame.height) * 0.45));
    if (!line) { line = { center, height: fragment.frame.height, fragments: [] }; lines.push(line); }
    line.fragments.push(fragment);
  }
  const words = [];
  lines.sort((a, b) => a.center - b.center).forEach((line, lineIndex) => {
    const parts = line.fragments.sort((a, b) => a.frame.x - b.frame.x);
    const rtlCount = parts.reduce((sum, part) => sum + (part.dir === 'rtl' ? part.text.normalize('NFKC').length : 0), 0);
    const ltrCount = parts.reduce((sum, part) => sum + (part.dir === 'ltr' ? part.text.length : 0), 0);
    const lineDir = rtlCount >= ltrCount ? 'rtl' : 'ltr';
    const blocks = [];
    for (const part of parts) {
      let block = blocks.at(-1), previous = block?.at(-1);
      if (!block || part.frame.x - previous.frame.x - previous.frame.width > Math.max(35, line.height * 3)) { block = []; blocks.push(block); }
      block.push(part);
    }
    if (lineDir === 'rtl') blocks.reverse();
    blocks.forEach((block, blockIndex) => {
      const runs = [];
      for (const part of block) {
        const dir = part.dir || runs.at(-1)?.dir || lineDir;
        let run = runs.at(-1);
        if (!run || run.dir !== dir) { run = { dir, parts: [] }; runs.push(run); }
        run.parts.push(part);
      }
      if (lineDir === 'rtl') runs.reverse();
      const ordered = runs.flatMap(run => run.dir === 'rtl' ? [...run.parts].reverse() : run.parts);
      const blockBounds = rectUnion(block.map(part => part.frame));
      let word = null;
      for (const part of ordered) {
        if (!part.text.trim()) { word = null; continue; }
        const previous = word?.parts.at(-1);
        const gap = previous ? Math.max(part.frame.x, previous.frame.x) - Math.min(part.frame.x + part.frame.width, previous.frame.x + previous.frame.width) : Infinity;
        const sameNode = previous?.node === part.node;
        const touches = previous && gap <= Math.max(1.2, Math.min(part.frame.height, previous.frame.height) * 0.16);
        const join = touches && !sameNode && previous.dir === part.dir && !previous.trailingSpace && !part.leadingSpace;
        if (!word || !join) {
          word = { parts: [], text: '', line: lineIndex, block: blockIndex, blockBounds, dir: part.dir || lineDir };
          words.push(word);
        }
        word.parts.push(part); word.text += part.text;
        word.frame = rectUnion(word.parts.map(fragment => fragment.frame));
        word.rect = rectUnion(word.parts.map(fragment => fragment.rect));
      }
    });
  });
  return words.map((word, index) => ({ ...word, index, text: word.text.normalize('NFKC') }));
}

export function createPdfSelection({ stage, textLayer, scroller, onChange = () => {}, onCommit = () => {} }) {
  const doc = stage.ownerDocument, view = doc.defaultView;
  const overlay = doc.createElementNS(SVG_NS, 'svg'); overlay.id = 'reader-selection-layer'; overlay.setAttribute('aria-hidden', 'true'); stage.append(overlay);
  let viewport = null, words = null, selected = [], area = null, tool = 'select', mode = 'auto', drag = null, frameId = null;
  let lastClick = null, clicks = 0;
  stage.tabIndex = 0;
  function point(event) { const rect = stage.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; }
  function toFrame(rect) {
    const base = viewport.clone({ scale: 1, rotation: 0 });
    const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(p => base.convertToViewportPoint(...viewport.convertToPdfPoint(...p)));
    return rectUnion(points.map(p => ({ x: p[0], y: p[1], width: 0, height: 0 })));
  }
  function measure() {
    if (words) return words;
    const stageBox = stage.getBoundingClientRect(), fragments = [];
    for (const span of textLayer.querySelectorAll('span:not([role="img"])')) {
      if (!span.firstChild || span.firstChild.nodeType !== 3 || !span.textContent) continue;
      const node = span.firstChild, value = node.textContent;
      for (const part of segmenter.segment(value)) {
        const start = part.index, end = start + part.segment.length;
        const range = doc.createRange(); range.setStart(node, start); range.setEnd(node, end);
        const box = range.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const rect = { x: box.left - stageBox.left, y: box.top - stageBox.top, width: box.width, height: box.height };
        fragments.push({ node, start, end, text: part.segment, dir: direction(part.segment), rect, frame: toFrame(rect),
          leadingSpace: /\s$/.test(value.slice(0, start)), trailingSpace: /^\s/.test(value.slice(end)) });
      }
    }
    words = buildReadingWords(fragments); return words;
  }
  function nearest(position, strict = false) {
    let closest = null, best = Infinity;
    for (const word of measure()) { const delta = distance(position, word.rect); if (delta < best) { best = delta; closest = word; } }
    return strict && best > 7 ? null : closest;
  }
  function selectionText() {
    let text = '', previous = null;
    for (const word of selected) {
      if (previous) text += previous.line !== word.line ? '\n' : /^[,.;:!?،؛)\]}]/u.test(word.text) || /[([{]$/u.test(previous.text) ? '' : ' ';
      text += word.text; previous = word;
    }
    return text.trim();
  }
  function mergedRects() {
    if (area) return [area];
    const rects = [];
    const groups = new Map();
    for (const word of selected) {
      const key = word.line + ':' + word.block;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(...word.parts);
    }
    for (const parts of groups.values()) {
      const sorted = [...parts].sort((a, b) => a.frame.x - b.frame.x);
      let current = [];
      for (const part of sorted) {
        const previous = current.at(-1);
        if (previous && part.frame.x - previous.frame.x - previous.frame.width > Math.max(12, part.frame.height * 1.4)) {
          rects.push(rectUnion(current.map(p => p.rect))); current = [];
        }
        current.push(part);
      }
      if (current.length) rects.push(rectUnion(current.map(p => p.rect)));
    }
    return rects;
  }
  function getSelection() {
    if (!selected.length && !area) return null;
    const rects = mergedRects().map(rect => ({ ...rect })), text = selectionText();
    // A geometry adapter has the same minimal Range interface annotations use.
    // It avoids a single DOM Range accidentally swallowing another PDF column.
    const range = { collapsed: false, startContainer: textLayer, endContainer: textLayer,
      getClientRects() { const paper = stage.getBoundingClientRect(); return rects.map(rect => new DOMRect(paper.left + rect.x, paper.top + rect.y, rect.width, rect.height)); } };
    return { rangeCount: 1, isCollapsed: false, text, getRangeAt: () => range, toString: () => text };
  }
  function emit() {
    const rects = mergedRects(); overlay.replaceChildren();
    for (const rect of rects) {
      const shape = doc.createElementNS(SVG_NS, 'rect');
      for (const [key, value] of Object.entries(rect)) shape.setAttribute(key, value);
      shape.setAttribute('rx', '2'); overlay.append(shape);
    }
    const paper = stage.getBoundingClientRect(), bounds = rects.length ? rectUnion(rects) : null;
    onChange({ selection: getSelection(), text: selectionText(), dragging: Boolean(drag),
      bounds: bounds ? { ...bounds, x: bounds.x + paper.left, y: bounds.y + paper.top } : null });
  }
  function cancelDrag() {
    const captured = drag?.id; drag = null;
    if (frameId !== null) { view.cancelAnimationFrame(frameId); frameId = null; }
    if (captured !== undefined) { try { if (stage.hasPointerCapture(captured)) stage.releasePointerCapture(captured); } catch {} }
  }
  function clear() { cancelDrag(); selected = []; area = null; overlay.replaceChildren(); onChange({ selection: null, text: '', bounds: null, dragging: false }); }
  function selectBetween(anchor, focus, granularity = 'word') {
    if (!anchor || !focus) return;
    const all = measure();
    if (granularity === 'line') {
      selected = all.filter(word => word.line >= Math.min(anchor.line, focus.line) && word.line <= Math.max(anchor.line, focus.line) &&
        Math.max(word.blockBounds.x, anchor.blockBounds.x) < Math.min(word.blockBounds.x + word.blockBounds.width, anchor.blockBounds.x + anchor.blockBounds.width));
      return;
    }
    const left = Math.min(anchor.index, focus.index), right = Math.max(anchor.index, focus.index);
    const sameColumn = Math.max(anchor.blockBounds.x, focus.blockBounds.x) < Math.min(anchor.blockBounds.x + anchor.blockBounds.width, focus.blockBounds.x + focus.blockBounds.width);
    selected = all.slice(left, right + 1).filter(word => !sameColumn || Math.max(word.blockBounds.x, anchor.blockBounds.x) <= Math.min(word.blockBounds.x + word.blockBounds.width, anchor.blockBounds.x + anchor.blockBounds.width));
  }
  function updateDrag() {
    if (!drag) return;
    const position = point(drag.last);
    if (drag.area) {
      const a = drag.start, b = [Math.max(0, Math.min(stage.clientWidth, position[0])), Math.max(0, Math.min(stage.clientHeight, position[1]))];
      area = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
    } else selectBetween(drag.anchor, nearest(position), drag.granularity);
    emit();
  }
  function autoscroll() {
    frameId = null; if (!drag) return;
    const box = scroller.getBoundingClientRect(), edge = 38, cursor = drag.last;
    const velocity = value => Math.max(-18, Math.min(18, value / 2.5));
    const dy = cursor.clientY < box.top + edge ? velocity(cursor.clientY - box.top - edge) : cursor.clientY > box.bottom - edge ? velocity(cursor.clientY - box.bottom + edge) : 0;
    const dx = cursor.clientX < box.left + edge ? velocity(cursor.clientX - box.left - edge) : cursor.clientX > box.right - edge ? velocity(cursor.clientX - box.right + edge) : 0;
    if (dy || dx) { scroller.scrollBy(dx, dy); updateDrag(); }
    frameId = view.requestAnimationFrame(autoscroll);
  }
  function pointerDown(event) {
    if (!viewport || stage.getAttribute('aria-busy') === 'true' || event.button !== 0 || !['select', 'highlight', 'underline'].includes(tool)) return;
    if (event.target.closest?.('[data-annotation-type="note"],.pdf-link')) return;
    const isArea = mode === 'area' && tool === 'select';
    if (mode === 'area' && !isArea) return;
    const anchor = isArea ? null : nearest(point(event), mode === 'auto');
    if (!isArea && !anchor) return;
    event.preventDefault(); event.stopImmediatePropagation();
    clear(); doc.getSelection()?.removeAllRanges(); stage.focus({ preventScroll: true });
    const now = performance.now();
    clicks = lastClick && now - lastClick.time < 420 && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 7 ? Math.min(clicks + 1, 3) : 1;
    lastClick = { time: now, x: event.clientX, y: event.clientY };
    drag = { id: event.pointerId, anchor, area: isArea, start: point(event), last: event, tool, granularity: clicks >= 3 ? 'line' : 'word' };
    if (anchor) selectBetween(anchor, anchor, drag.granularity);
    try { stage.setPointerCapture(event.pointerId); } catch {}
    emit(); frameId = view.requestAnimationFrame(autoscroll);
  }
  function pointerMove(event) {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); drag.last = event; updateDrag();
  }
  function pointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const finished = drag; drag.last = event; updateDrag(); cancelDrag();
    if (area && (area.width < 3 || area.height < 3)) area = null;
    const moved = Math.hypot(point(event)[0] - finished.start[0], point(event)[1] - finished.start[1]);
    if (finished.tool !== 'select' && (moved >= 3 || clicks >= 2)) {
      const snapshot = getSelection(); if (snapshot) onCommit({ selection: snapshot, tool: finished.tool, text: snapshot.text }); clear();
    } else emit();
  }
  function pointerCancel(event) { if (drag?.id === event.pointerId) clear(); }
  function copy(event) {
    if (!selected.length || event.target.closest?.('input,textarea,[contenteditable=true]')) return;
    event.clipboardData?.setData('text/plain', selectionText()); event.preventDefault();
  }
  function outsidePointer(event) {
    if (stage.contains(event.target) || event.target.closest?.('#reader-selection-bar,.tool-options')) return;
    if (selected.length || area) clear();
  }
  function keyDown(event) {
    if (!viewport || event.target.closest?.('input,textarea,select,[contenteditable=true]') || doc.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && stage.contains(doc.activeElement)) {
      event.preventDefault(); selected = [...measure()]; area = null; emit();
    }
    if (event.key === 'Escape') clear();
  }
  const events = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerCancel, lostpointercapture: pointerCancel };
  for (const [name, handler] of Object.entries(events)) stage.addEventListener(name, handler, true);
  doc.addEventListener('copy', copy); doc.addEventListener('keydown', keyDown); doc.addEventListener('pointerdown', outsidePointer);
  scroller.addEventListener('scroll', emit, { passive: true });
  return {
    clear, getSelection, getText: selectionText,
    getRects: () => mergedRects().map(rect => ({ ...rect })),
    setPage(nextViewport) { clear(); viewport = nextViewport; words = null; overlay.setAttribute('width', stage.clientWidth); overlay.setAttribute('height', stage.clientHeight); },
    setTool(nextTool) { clear(); tool = nextTool; },
    setMode(nextMode) { clear(); mode = ['auto', 'text', 'area'].includes(nextMode) ? nextMode : 'auto'; stage.dataset.selectionMode = mode; },
    destroy() {
      clear(); overlay.remove(); for (const [name, handler] of Object.entries(events)) stage.removeEventListener(name, handler, true);
      doc.removeEventListener('copy', copy); doc.removeEventListener('keydown', keyDown); doc.removeEventListener('pointerdown', outsidePointer); scroller.removeEventListener('scroll', emit);
    }
  };
}
