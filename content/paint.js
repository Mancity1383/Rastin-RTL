// Page annotation editor: document coordinates, isolated UI, vector rendering.
window.RtlFixer = window.RtlFixer || {};
(function (RtlFixer) {
  'use strict';
  const M = globalThis.RastinPaintModel;
  const NS = 'http://www.w3.org/2000/svg';
  const TOOLS = [['select', 'انتخاب و جابه‌جایی (V)'], ['pen', 'قلم (P)'],
    ['marker', 'هایلایتر (H)'], ['text', 'نوشتن متن (T)'], ['line', 'خط (L)'],
    ['arrow', 'فلش (A)'], ['rect', 'مستطیل (R)'], ['ellipse', 'بیضی (O)'],
    ['eraser', 'پاک‌کن اشیاء (E)'], ['browse', 'تعامل با صفحه (B)']];
  const ICONS = {
    select: 'M5 3l14 10-7 1-3 7z',
    pen: 'M15 4l5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
    marker: 'M14 3l7 7-9 9-7-7zM5 12l-2 7 5 2 4-2M3 22h17',
    text: 'M5 6V4h14v2M12 4v16M8 20h8',
    line: 'M5 19L19 5', arrow: 'M4 20L20 4M10 4h10v10',
    rect: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    ellipse: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    eraser: 'M14 3l7 7-10 10H6l-4-4zM8 10l7 7M11 20h10',
    browse: 'M8 13V6a2 2 0 0 1 4 0v5M12 9a2 2 0 0 1 4 0v3M16 10a2 2 0 0 1 4 0v6c0 4-3 6-7 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l2 2',
    undo: 'M8 4L3 9l5 5M3 9h10a7 7 0 0 1 0 14',
    redo: 'M16 4l5 5-5 5M21 9H11a7 7 0 0 0 0 14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    close: 'M6 6l12 12M18 6L6 18', collapse: 'M8 14l4-4 4 4', expand: 'M8 10l4 4 4-4',
    chevron: 'M8 10l4 4 4-4',
    duplicate: 'M9 9h11v11H9zM15 9V4H4v11h5',
    delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    visibility: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
    import: 'M12 15V3M7 8l5-5 5 5M4 17v4h16v-4',
    grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"${['grip', 'more'].includes(name) ? ' stroke-width="3.5"' : ''}/></svg>`;
  let host, root, svg, layer, toolbar, status, editor, editorItem, editorBefore;
  let shapes = [], undo = [], redo = [], selected = null, gesture = null, selectionBox = null;
  let page = '', key = '', tool = 'pen', hidden = false, controller, routeTimer, frame = null;
  let generation = 0, pending = 0, saveFailed = false, enabled = true, opening = null, clearTimer;
  const rendered = new Map();
  let prefs = { color: '#ef4444', width: 4, opacity: 1, fontSize: 24, fill: false };
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => crypto.randomUUID();
  const find = () => shapes.find(s => s.id === selected);
  function savedItems(data, expectedPage) {
    if (data === undefined) return [];
    if (!data || data.version !== 1 || data.page !== expectedPage || !Array.isArray(data.items)) throw new Error('Invalid saved drawing');
    return M.items(data.items);
  }
  const element = (tag, attrs = {}, text) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function say(text, error = false) {
    if (!status) return;
    status.textContent = text; status.classList.toggle('error', error);
    status.title = text; status.setAttribute('aria-label', text);
    const notice = root.querySelector('.notice');
    notice.hidden = !error; notice.textContent = error ? text : '';
  }
  function listen(target, type, fn, options = {}) {
    target.addEventListener(type, fn, { ...options, signal: controller.signal });
  }
  function pathData(s) {
    const points = s.points;
    if (points.length === 1) return `M${points[0]} l0.01,0`;
    return points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  }
  function draw(s) {
    const group = element('g', { 'data-id': s.id, opacity: s.opacity });
    const common = { stroke: s.color, 'stroke-width': s.width, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', fill: 'none', 'pointer-events': 'visiblePainted' };
    let node;
    if (s.points) node = element('path', { ...common, d: pathData(s) });
    else if (s.type === 'text') {
      const rtl = /[\u0590-\u08ff]/.test(s.text);
      node = element('text', { x: s.x, y: s.y, fill: s.color, 'font-size': s.fontSize,
        'pointer-events': 'bounding-box',
        'font-family': 'Tahoma, Arial, sans-serif', direction: rtl ? 'rtl' : 'ltr',
        'text-anchor': 'start', style: 'unicode-bidi:plaintext;white-space:pre' });
      s.text.split('\n').forEach((line, i) => node.appendChild(element('tspan', {
        x: s.x, dy: i ? s.fontSize * 1.4 : 0
      }, line || '\u00a0')));
    } else if (s.type === 'rect' || s.type === 'ellipse') {
      const x = Math.min(s.x, s.x2), y = Math.min(s.y, s.y2);
      const w = Math.abs(s.x2 - s.x), h = Math.abs(s.y2 - s.y);
      node = s.type === 'rect' ? element('rect', { ...common, x, y, width: w, height: h,
        fill: s.fill ? s.color : 'none' }) : element('ellipse', { ...common,
        cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: s.fill ? s.color : 'none' });
    } else {
      node = element('path', { ...common, d: `M${s.x},${s.y} L${s.x2},${s.y2}` });
      if (s.type === 'arrow') {
        const angle = Math.atan2(s.y2 - s.y, s.x2 - s.x), length = Math.max(12, s.width * 4);
        const a = angle - Math.PI / 6, b = angle + Math.PI / 6;
        group.appendChild(element('path', { ...common,
          d: `M${s.x2 - length * Math.cos(a)},${s.y2 - length * Math.sin(a)} L${s.x2},${s.y2} L${s.x2 - length * Math.cos(b)},${s.y2 - length * Math.sin(b)}` }));
      }
    }
    group.appendChild(node);
    return group;
  }
  function render() {
    if (!host) return;
    svg.setAttribute('viewBox', `${window.scrollX} ${window.scrollY} ${window.innerWidth} ${window.innerHeight}`);
    layer.querySelectorAll('[data-decoration]').forEach(el => el.remove());
    const liveIds = new Set(shapes.map(s => s.id));
    for (const [id, cached] of rendered) if (!liveIds.has(id)) { cached.node.remove(); rendered.delete(id); }
    shapes.forEach((s, i) => {
      let cached = rendered.get(s.id);
      if (!cached || cached.item !== s || gesture?.item === s) {
        const signature = JSON.stringify(s);
        if (!cached || cached.signature !== signature) {
          const node = draw(s);
          if (cached) cached.node.replaceWith(node);
          cached = { node, signature }; rendered.set(s.id, cached);
        }
        cached.item = s;
      }
      cached.node.removeAttribute('visibility');
      if (layer.children[i] !== cached.node) layer.insertBefore(cached.node, layer.children[i] || null);
    });
    selectionBox = null;
    if (selected && !hidden) {
      const group = [...layer.children].find(g => g.getAttribute('data-id') === selected);
      if (group) {
        const b = group.getBBox(), pad = Math.max(6, find().width / 2);
        selectionBox = { x: b.x, y: b.y, width: Math.max(b.width, 1), height: Math.max(b.height, 1) };
        layer.appendChild(element('rect', { x: b.x - pad, y: b.y - pad,
          'data-decoration': 'selection',
          width: b.width + pad * 2, height: b.height + pad * 2, fill: 'none', stroke: '#6366f1',
          'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }));
        [['nw', b.x, b.y], ['ne', b.x + b.width, b.y], ['sw', b.x, b.y + b.height], ['se', b.x + b.width, b.y + b.height]]
          .forEach(([corner, x, y]) => layer.appendChild(element('rect', {
            'data-resize': corner, x: x - 5, y: y - 5, width: 10, height: 10,
            'data-decoration': 'handle',
            rx: 2, fill: '#fff', stroke: '#6366f1', 'stroke-width': 2,
            style: `cursor:${corner === 'nw' || corner === 'se' ? 'nwse' : 'nesw'}-resize`
          })));
      }
    }
    svg.style.visibility = hidden ? 'hidden' : 'visible';
    svg.style.pointerEvents = tool === 'browse' || hidden ? 'none' : 'auto';
    svg.style.touchAction = tool === 'browse' || hidden ? 'auto' : 'none';
    svg.style.cursor = tool === 'select' ? 'move' : tool === 'eraser' ? 'not-allowed' : 'crosshair';
    root.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool));
    root.querySelector('[data-action="undo"]').disabled = !undo.length;
    root.querySelector('[data-action="redo"]').disabled = !redo.length;
    root.querySelector('[data-action="delete"]').disabled = !selected;
    root.querySelector('[data-action="duplicate"]').disabled = !selected;
    root.querySelector('[data-action="visibility"] .menu-label').textContent = hidden ? 'نمایش طرح' : 'پنهان‌کردن طرح';
    root.querySelector('[data-panel="style"]').style.setProperty('--paint-color', prefs.color);
    root.querySelector('[data-panel="style"]').title = `رنگ و ظاهر • ${prefs.width}px`;
    root.querySelector('[data-field="fontSize"]').hidden = tool !== 'text' && find()?.type !== 'text';
    root.querySelector('[data-field="fill"]').hidden = !['rect', 'ellipse'].includes(find()?.type || tool);
    root.querySelector('[data-value="opacity"]').textContent = `${Math.round(prefs.opacity * 100)}٪`;
    root.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === prefs.color));
    root.querySelectorAll('[data-width]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.width) === prefs.width));
    if (editor) {
      rendered.get(editorItem.id)?.node.setAttribute('visibility', 'hidden');
      positionEditor();
    }
  }
  function scheduleRender() {
    if (frame === null) frame = requestAnimationFrame(() => { frame = null; render(); });
  }
  function diff(before, after) {
    const a = new Map(before.map(s => [s.id, s])), b = new Map(after.map(s => [s.id, s]));
    return [...before.filter(s => !b.has(s.id)).map(s => ({ type: 'remove', id: s.id })),
      ...after.filter(s => JSON.stringify(a.get(s.id)) !== JSON.stringify(s)).map(s => ({
        type: a.has(s.id) ? 'update' : 'add', item: s
      }))];
  }
  function persist(before, after) {
    const changes = diff(before, after);
    if (!changes.length) return;
    const currentGeneration = generation, currentPage = page;
    pending++; say('در حال ذخیره…');
    // Dispatch now: background owns serialization, including during tab reload/close.
    chrome.runtime.sendMessage({ action: 'mutatePaint', page: currentPage, changes }).then(result => {
      if (!result?.ok) throw new Error(result?.error || 'Storage unavailable');
    }).catch(() => {
      if (currentGeneration === generation) saveFailed = true;
    }).finally(() => {
      if (currentGeneration !== generation) return;
      pending--;
      say(saveFailed ? 'ذخیره ناموفق؛ روی این پیام بزنید تا دوباره تلاش شود یا JSON بگیرید.' :
        pending ? 'در حال ذخیره…' : 'ذخیره شد • فقط در این مرورگر', saveFailed);
      if (!pending && !saveFailed) syncStorage();
    });
  }
  function commit(before) {
    try { shapes = M.items(shapes); }
    catch { shapes = before; say('حد مجاز طرح: ۱۰۰۰ شیء، ۳ مگابایت؛ طرح قبلی حفظ شد.', true); render(); return; }
    if (!diff(before, shapes).length) { render(); return; }
    undo.push(before);
    while (undo.length > 60 || (undo.length > 1 && JSON.stringify(undo).length > 15000000)) undo.shift();
    redo = []; persist(before, shapes); render();
  }
  async function syncStorage() {
    const g = generation, storageName = key;
    try {
      const data = (await chrome.storage.local.get(storageName))[storageName];
      if (g !== generation || pending || saveFailed || gesture || editor || !host) return;
      const next = savedItems(data, page);
      if (JSON.stringify(next) !== JSON.stringify(shapes)) {
        shapes = next; undo = []; redo = []; selected = null; render();
      }
    } catch { say('خواندن طرح ناموفق بود؛ فایل ذخیره‌شده تغییر نکرد.', true); }
  }
  function changeTool(next) {
    finishEditor(); cancelGesture(); closePanels(); tool = next; selected = null; hidden = false; render();
  }
  function point(e) { return [e.clientX + window.scrollX, e.clientY + window.scrollY]; }
  function hit(e) { return e.target.closest?.('[data-id]')?.getAttribute('data-id'); }
  function down(e) {
    if (e.button !== 0 || gesture || tool === 'browse') return;
    finishEditor(); e.preventDefault(); e.stopPropagation();
    const [x, y] = point(e), id = hit(e), before = clone(shapes);
    if (tool === 'text') { startEditor(x, y, id); return; }
    if (tool === 'select' && e.target.dataset.resize && selected && selectionBox) {
      const corner = e.target.dataset.resize, b = selectionBox;
      const anchor = [corner.endsWith('w') ? b.x + b.width : b.x, corner.startsWith('n') ? b.y + b.height : b.y];
      gesture = { type: 'resize', before, original: clone(find()), pointer: e.pointerId, start: [x, y], anchor };
    } else if (tool === 'select') {
      selected = id || null;
      if (!selected) { render(); return; }
      gesture = { type: 'move', before, start: [x, y], original: clone(find()), pointer: e.pointerId };
      loadPrefs(find());
    } else if (tool === 'eraser') {
      gesture = { type: 'erase', before, pointer: e.pointerId };
      if (id) shapes = shapes.filter(s => s.id !== id);
      selected = null;
    } else {
      selected = null;
      const s = { id: uid(), type: tool, ...prefs, x, y,
        opacity: tool === 'marker' ? Math.min(prefs.opacity, 0.35) : prefs.opacity,
        width: tool === 'marker' ? Math.max(12, prefs.width) : prefs.width };
      if (tool === 'pen' || tool === 'marker') s.points = [[x, y]];
      else { s.x2 = x; s.y2 = y; }
      shapes.push(s); gesture = { type: 'draw', before, item: s, pointer: e.pointerId };
    }
    svg.setPointerCapture(e.pointerId); render();
  }
  function move(e) {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    e.preventDefault();
    const [x, y] = point(e);
    if (gesture.type === 'move') {
      shapes = shapes.map(s => s.id === selected ? M.translate(gesture.original,
        x - gesture.start[0], y - gesture.start[1]) : s);
    } else if (gesture.type === 'resize') {
      const a = gesture.anchor, start = gesture.start;
      let sx = Math.max(0.05, (x - a[0]) / (start[0] - a[0] || 1));
      let sy = Math.max(0.05, (y - a[1]) / (start[1] - a[1] || 1));
      if (e.shiftKey) sx = sy = Math.max(sx, sy);
      shapes = shapes.map(s => s.id === selected ? M.scale(gesture.original, a, sx, sy) : s);
    } else if (gesture.type === 'erase') {
      // Pointer capture retargets events to SVG; hit-test the shadow tree explicitly.
      const target = root.elementFromPoint(e.clientX, e.clientY);
      const id = target?.closest?.('[data-id]')?.getAttribute('data-id');
      if (id) shapes = shapes.filter(s => s.id !== id);
    } else {
      const s = gesture.item;
      if (s.points) {
        for (const event of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
          const p = point(event), last = s.points[s.points.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1 && s.points.length < 5000) s.points.push(p);
        }
      } else {
        let dx = x - s.x, dy = y - s.y;
        if (e.shiftKey) {
          if (s.type === 'rect' || s.type === 'ellipse') {
            const size = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * size; dy = Math.sign(dy || 1) * size;
          } else {
            const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
            const length = Math.hypot(dx, dy); dx = Math.cos(angle) * length; dy = Math.sin(angle) * length;
          }
        }
        s.x2 = s.x + dx; s.y2 = s.y + dy;
      }
    }
    scheduleRender();
  }
  function up(e) {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    move(e);
    const current = gesture; gesture = null;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (current.type === 'draw' && !current.item.points &&
        Math.hypot(current.item.x2 - current.item.x, current.item.y2 - current.item.y) < 3) shapes = current.before;
    commit(current.before);
    if (current.type === 'resize' && find()) loadPrefs(find());
  }
  function cancelGesture() {
    if (!gesture) return;
    const g = gesture; gesture = null; shapes = g.before;
    if (svg?.hasPointerCapture(g.pointer)) svg.releasePointerCapture(g.pointer);
    render();
  }
  function positionEditor() {
    if (!editorItem) return;
    const rtl = /[\u0590-\u08ff]/.test(editor.value);
    editor.style.left = `${Math.max(8, Math.min(innerWidth - Math.min(320, innerWidth - 16), editorItem.x - scrollX - (rtl ? Math.min(320, innerWidth - 16) : 0)))}px`;
    editor.style.top = `${Math.max(8, Math.min(innerHeight - 140, editorItem.y - scrollY - editorItem.fontSize))}px`;
  }
  function startEditor(x, y, id) {
    const existing = shapes.find(s => s.id === id && s.type === 'text');
    editorBefore = clone(shapes);
    editorItem = existing ? clone(existing) : { id: uid(), type: 'text', ...prefs, x, y, text: '' };
    editor = document.createElement('textarea'); editor.className = 'text-editor'; editor.dir = 'auto';
    editor.maxLength = 4000; editor.setAttribute('aria-label', 'متن روی صفحه');
    editor.placeholder = 'متن را بنویسید…\nثبت: Ctrl+Enter • لغو: Esc'; editor.value = editorItem.text;
    editor.style.color = editorItem.color; editor.style.fontSize = `${editorItem.fontSize}px`;
    root.appendChild(editor); positionEditor(); editor.focus();
    listen(editor, 'input', positionEditor);
    listen(editor, 'keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finishEditor(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishEditor(); }
    });
    listen(editor, 'blur', () => finishEditor());
    // Hide the original only while editing; cancellation restores it.
    if (existing) { selected = null; render(); layer.querySelector(`[data-id="${existing.id}"]`)?.setAttribute('visibility', 'hidden'); }
  }
  function finishEditor(save = true) {
    if (!editor) return;
    const text = editor.value, s = editorItem, before = editorBefore, el = editor;
    editor = editorItem = editorBefore = null; el.remove();
    if (save && text.trim()) {
      s.text = text; const i = shapes.findIndex(v => v.id === s.id);
      if (i >= 0) shapes[i] = s; else shapes.push(s);
      selected = null; commit(before);
    } else render();
  }
  function loadPrefs(s) {
    prefs = { color: s.color, width: s.width, opacity: s.opacity, fontSize: s.fontSize || prefs.fontSize, fill: s.fill };
    ['color', 'width', 'opacity', 'fontSize', 'fill'].forEach(name => {
      const input = root.querySelector(`[name="${name}"]`);
      if (name === 'fill') input.checked = prefs[name]; else input.value = prefs[name];
    });
    if (toolbar) render();
  }
  function changePref(name, value) {
    finishEditor(); prefs[name] = value;
    if (tool === 'select' && find()) {
      const before = clone(shapes); find()[name] = value; commit(before);
    }
    chrome.storage.local.set({ rastin_paint_preferences: prefs }).catch(() => {});
    render();
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function exportImage(format) {
    finishEditor();
    const imageSvg = element('svg', { xmlns: NS, width: innerWidth, height: innerHeight,
      viewBox: `${scrollX} ${scrollY} ${innerWidth} ${innerHeight}` });
    shapes.forEach(s => imageSvg.appendChild(draw(s)));
    const text = new XMLSerializer().serializeToString(imageSvg);
    if (format === 'svg') { download(new Blob([text], { type: 'image/svg+xml' }), 'rastin-paint.svg'); return; }
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'), scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale);
      const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      if (!blob) throw new Error('Export failed');
      download(blob, 'rastin-paint.png');
    } catch { say('خروجی تصویر ناموفق بود؛ خروجی SVG یا JSON را امتحان کنید.', true); }
    finally { URL.revokeObjectURL(url); }
  }
  async function importFile(file) {
    if (!file) return;
    const g = generation;
    try {
      if (file.size > M.MAX_BYTES) throw new Error('Too large');
      const data = JSON.parse(await file.text());
      if (data.format !== 'rastin-paint' || data.version !== 1) throw new Error('Unknown format');
      const imported = M.items(data.items).map(s => ({ ...s, id: uid() }));
      if (g !== generation || !host) return;
      const before = clone(shapes); shapes = M.items([...shapes, ...imported]); selected = null; commit(before);
    } catch { if (g === generation) say('فایل نامعتبر یا بزرگ‌تر از حد مجاز است؛ طرح قبلی حفظ شد.', true); }
  }
  function action(name) {
    finishEditor(); cancelGesture();
    const before = clone(shapes);
    if (name === 'undo' && undo.length) { redo.push(before); shapes = undo.pop(); selected = null; persist(before, shapes); }
    if (name === 'redo' && redo.length) { undo.push(before); shapes = redo.pop(); selected = null; persist(before, shapes); }
    if (name === 'delete' && selected) { shapes = shapes.filter(s => s.id !== selected); selected = null; commit(before); }
    if (name === 'duplicate' && find()) { const s = M.translate(find(), 20, 20); s.id = uid(); shapes.push(s); selected = s.id; commit(before); }
    if (name === 'clear' && shapes.length) {
      // An inline confirmation keeps destructive actions deliberate without blocking the browser.
      const button = root.querySelector('[data-action="clear"]');
      const label = button.querySelector('.menu-label');
      if (button.dataset.confirm === 'yes') { shapes = []; selected = null; commit(before); button.dataset.confirm = ''; label.textContent = 'پاک‌کردن همه'; }
      else {
        button.dataset.confirm = 'yes'; label.textContent = 'تأیید پاک‌کردن؟';
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => { button.dataset.confirm = ''; label.textContent = 'پاک‌کردن همه'; }, 4000);
      }
    }
    if (name === 'visibility') { hidden = !hidden; selected = null; }
    if (name === 'json') download(new Blob([JSON.stringify({ format: 'rastin-paint', version: 1, page, items: shapes }, null, 2)],
      { type: 'application/json' }), 'rastin-paint.json');
    if (name === 'png' || name === 'svg') exportImage(name);
    if (name === 'import') root.querySelector('input[type="file"]').click();
    if (name === 'close') { close(); return; }
    render();
  }
  function keydown(e) {
    const path = e.composedPath();
    if (e.isComposing || path.includes(editor)) return;
    const typing = path.some(el => el?.matches?.('input, textarea, select') || el?.isContentEditable);
    if (typing && !path.includes(toolbar)) return;
    const modified = e.ctrlKey || e.metaKey;
    // Physical key codes also work with the Persian keyboard layout.
    const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    let handled = false;
    if (e.key === 'Escape') {
      if (root.querySelector('.panel:not([hidden])')) closePanels();
      else if (gesture) cancelGesture(); else if (selected) { selected = null; render(); } else changeTool('browse');
      handled = true;
    } else {
      if (modified && !e.altKey && letter === 'z') { action(e.shiftKey ? 'redo' : 'undo'); handled = true; }
      else if (modified && !e.altKey && letter === 'y') { action('redo'); handled = true; }
      else if (modified && !e.altKey && letter === 'd' && selected && !typing) { action('duplicate'); handled = true; }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !typing) { action('delete'); handled = true; }
      else if (!modified && !e.altKey && !typing) {
        const shortcut = { v: 'select', p: 'pen', h: 'marker', t: 'text', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', e: 'eraser', b: 'browse' }[letter];
        if (shortcut) { changeTool(shortcut); handled = true; }
      }
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  function closePanels() {
    root?.querySelectorAll('.panel').forEach(p => { p.hidden = true; });
    root?.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function positionPanel() {
    if (!toolbar) return;
    const panel = root.querySelector('.panel:not([hidden])');
    if (!panel) return;
    const b = toolbar.getBoundingClientRect();
    panel.classList.toggle('above', b.bottom + panel.offsetHeight + 12 > innerHeight && b.top > panel.offsetHeight + 12);
  }
  function togglePanel(name) {
    const panel = root.querySelector(`[data-menu="${name}"]`), wasOpen = !panel.hidden;
    closePanels();
    if (!wasOpen) { panel.hidden = false; root.querySelector(`[data-panel="${name}"]`).setAttribute('aria-expanded', 'true'); positionPanel(); }
  }
  function mount() {
    host = document.createElement('div'); host.id = 'rtl-fixer-paint-host';
    host.style.setProperty('all', 'initial', 'important');
    [['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'], ['pointer-events', 'none']]
      .forEach(([name, value]) => host.style.setProperty(name, value, 'important'));
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}
      svg.surface{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}
      .toolbar{position:absolute;top:18px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);pointer-events:auto;color:#343840;font:12px/1.7 Tahoma,Arial,sans-serif}
      .bar{display:flex;align-items:center;gap:4px;padding:7px;background:#fffffff5;border:1px solid #e6e7eb;border-radius:16px;box-shadow:0 4px 8px #20233306,0 16px 44px #20233314;backdrop-filter:blur(20px);width:max-content;max-width:100%}
      button,input{font:inherit}button{display:inline-flex;align-items:center;justify-content:center;gap:9px;flex-shrink:0;border:0;color:inherit;background:transparent;cursor:pointer;border-radius:9px;padding:0;transition:background .14s,color .14s,box-shadow .14s}
      button:hover{background:#f0f1f4}button:active{background:#e8eaf0}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #8175ee;outline-offset:3px}
      button:disabled{opacity:.28;cursor:default}button:disabled:hover{background:transparent}
      .icon{width:18px;height:18px;pointer-events:none;flex-shrink:0}.icon-btn{width:34px;height:36px}
      .tools,.history{display:flex;align-items:center;gap:2px}.tools button{width:34px;height:36px;color:#6b707b}
      .tools button[aria-pressed=true]{background:#efedff;color:#6d5ce7;box-shadow:inset 0 0 0 1px #dcd6ff}
      .divider{height:22px;width:1px;background:#e9e9ed;margin:0 3px;flex-shrink:0}
      .drag-handle{display:flex;align-items:center;gap:5px;cursor:grab;touch-action:none;user-select:none;color:#b7bac4;padding:0 3px;height:36px}.drag-handle:active{cursor:grabbing}.drag-handle .icon{width:14px}.brand-name{display:none;color:#6d5ce7;font:600 12px Arial;letter-spacing:.2px}
      .color-trigger{width:46px;height:36px;gap:5px}.color-trigger .icon{width:12px;height:12px;color:#9196a1}.color-dot{display:block;width:17px;height:17px;border-radius:50%;background:var(--paint-color,#ef4444);box-shadow:0 0 0 3px #fff,0 0 0 4px #e5e7eb}
      button[data-panel][aria-expanded=true]{background:#f0eefb;color:#6d5ce7}.status{height:36px;width:16px;font-size:0;gap:0}.status:before{content:'';width:5px;height:5px;border-radius:50%;background:#45a786}.status.error:before{background:#e24b61;box-shadow:0 0 0 3px #e24b6118}
      .panel{position:absolute;right:0;top:calc(100% + 10px);width:264px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 100px);overflow:auto;padding:16px;background:#fff;border:1px solid #e6e7eb;border-radius:16px;box-shadow:0 12px 40px #2023331c;direction:rtl;scrollbar-width:thin;animation:appear .14s ease-out}
      .panel.above{top:auto;bottom:calc(100% + 10px)}@keyframes appear{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
      .panel-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.panel-heading strong{font-size:12px;font-weight:600}.panel-heading small{color:#989da7;font-size:10px}.swatches{display:flex;justify-content:space-between;gap:8px;margin-bottom:14px}.swatch{width:22px;height:22px;border-radius:50%;background:var(--swatch);border:2px solid #fff;box-shadow:0 0 0 1px #e7e8ec}.swatch:hover{background:var(--swatch);transform:scale(1.08)}.swatch[aria-pressed=true]{box-shadow:0 0 0 2px #8175ee}
      .field{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;color:#747a85}.field>span{font-size:11px}.field input[type=number]{width:54px;height:28px;direction:ltr;text-align:center;border:1px solid #e5e7ec;border-radius:7px;background:#fafafb;color:#454b56;outline-offset:2px}.field input[type=color]{width:35px;height:27px;padding:3px;border:1px solid #e5e7ec;border-radius:7px;background:#fafafb;cursor:pointer}.field input[type=color]::-webkit-color-swatch-wrapper{padding:0}.field input[type=color]::-webkit-color-swatch{border:0;border-radius:3px}.field input[type=range]{width:104px;accent-color:#8175ee;cursor:pointer}.field input[type=checkbox]{accent-color:#8175ee;width:15px;height:15px}.range-control{display:flex;align-items:center;gap:8px}.range-control output{width:30px;font-size:10px;direction:rtl;color:#989da7}
      .widths{display:flex;gap:5px;padding:5px 0 10px}.widths button{flex:1;height:30px;background:#f7f8fa;border:1px solid transparent}.widths button[aria-pressed=true]{border-color:#ddd7ff;background:#f2f0ff}.width-line{display:block;width:24px;background:#737985;border-radius:5px}.widths button[aria-pressed=true] .width-line{background:#8175ee}
      .menu-row{display:flex;justify-content:flex-start;width:100%;height:37px;padding:0 8px;text-align:right;font-size:11px}.menu-row .icon{width:16px;height:16px;color:#9196a1}.menu-row kbd{margin-right:auto;color:#a0a4ad;font:10px Arial;direction:ltr}.menu-row.danger{color:#d85363}.menu-row.danger .icon{color:#d85363}.menu-separator{height:1px;background:#eef0f3;margin:9px 0}.section-label{font-size:10px;color:#999ea9;margin:8px 8px}.exports{display:flex;gap:6px;margin:8px 0}.exports button{height:33px;flex:1;background:#f7f8fa;color:#717784;border:1px solid #ebeef3;font:11px Arial}.exports button:hover{background:#f0eefb;border-color:#ddd7ff;color:#6d5ce7}
      .shortcuts{margin:8px 8px 0;font-size:10px;color:#9298a3}.shortcuts summary{cursor:pointer;list-style:none}.shortcuts summary:after{content:'＋';float:left;color:#b6bbc3}.shortcuts[open] summary:after{content:'−'}.shortcut-row{display:flex;justify-content:space-between;gap:12px;margin:7px 0}.shortcut-row kbd{font:10px/1.8 Arial;direction:ltr;background:#f6f7f9;border:1px solid #eceef2;border-radius:4px;padding:0 4px;color:#6c7380}.hint{font-size:10px;line-height:1.9;color:#a0a5b0;margin:9px 0 0}
      .notice{position:absolute;right:0;top:calc(100% + 10px);width:280px;max-width:calc(100vw - 24px);direction:rtl;text-align:right;padding:12px 14px;line-height:1.9;color:#c74f5f;background:#fff7f8;border:1px solid #f4d9de;border-radius:12px;box-shadow:0 8px 24px #20233312;font-size:11px}.toolbar:has(.panel:not([hidden])) .notice{display:none}
      .text-editor{position:absolute;pointer-events:auto;width:320px;max-width:calc(100vw - 16px);height:140px;padding:14px;background:#fffffff5;border:1px solid #bbb2f5;border-radius:12px;box-shadow:0 8px 32px #20233312;resize:vertical;outline:none;font-family:Tahoma,Arial,sans-serif;line-height:1.4;z-index:2}.text-editor::placeholder{color:#a3a2b3;font-size:13px;line-height:1.8}
      .toolbar.compact .tools,.toolbar.compact .history,.toolbar.compact .divider,.toolbar.compact [data-panel],.toolbar.compact .status{display:none}.toolbar.compact .brand-name{display:inline}.toolbar.compact .bar{gap:5px}.toolbar.compact .drag-handle{padding:0 7px}input[type=file]{display:none}
      @media(max-width:760px){.toolbar{width:min(400px,calc(100vw - 24px))}.bar{width:100%;flex-wrap:wrap;gap:3px}.tools{order:2;flex-basis:100%;justify-content:space-between;padding-top:4px;border-top:1px solid #eff0f3}.tools button{width:30px;height:33px}.divider{display:none}.drag-handle{margin-right:auto}.toolbar.compact{width:auto}.toolbar.compact .drag-handle{margin:0}.panel{max-height:calc(100dvh - 140px)}}
      @media(prefers-reduced-motion:reduce){button{transition:none}.panel{animation:none}}
    </style><svg class="surface" aria-label="لایه نقاشی روی صفحه"></svg>
    <section class="toolbar" aria-label="ابزار نوشتن و نقاشی" dir="ltr">
      <div class="bar" role="toolbar" aria-label="نوشتن و نقاشی">
        <div class="drag-handle" title="جابه‌جایی نوار ابزار">${icon('grip')}<span class="brand-name">Rastin</span></div>
        <div class="tools" role="group" aria-label="ابزارها"></div>
        <span class="divider"></span>
        <div class="history"><button class="icon-btn" data-action="undo" title="بازگشت • Ctrl+Z" aria-label="بازگشت">${icon('undo')}</button><button class="icon-btn" data-action="redo" title="تکرار • Ctrl+Shift+Z / Ctrl+Y" aria-label="تکرار">${icon('redo')}</button></div>
        <span class="divider"></span>
        <button class="color-trigger" data-panel="style" aria-label="رنگ و ظاهر" aria-expanded="false" aria-controls="paint-style"><span class="color-dot"></span>${icon('chevron')}</button>
        <button class="icon-btn" data-panel="more" title="گزینه‌ها و خروجی" aria-label="گزینه‌ها و خروجی" aria-expanded="false" aria-controls="paint-more">${icon('more')}</button>
        <button class="icon-btn" data-action="collapse" title="جمع‌کردن ابزارها" aria-label="جمع‌کردن ابزارها" aria-expanded="true">${icon('collapse')}</button>
        <button class="icon-btn" data-action="close" title="بستن نقاشی" aria-label="بستن نقاشی">${icon('close')}</button>
        <button class="status" aria-live="polite"></button>
      </div>
      <aside class="panel" id="paint-style" data-menu="style" aria-label="رنگ و ظاهر" hidden>
        <div class="panel-heading"><strong>رنگ و ظاهر</strong><small>به سلیقهٔ شما</small></div>
        <div class="swatches" role="group" aria-label="رنگ‌های آماده">${[['#343840', 'زغالی'], ['#ef4444', 'قرمز'], ['#f59e0b', 'نارنجی'], ['#facc15', 'زرد'], ['#22c55e', 'سبز'], ['#3b82f6', 'آبی'], ['#8b5cf6', 'بنفش'], ['#ffffff', 'سفید']].map(([color, label]) => `<button class="swatch" style="--swatch:${color}" data-color="${color}" title="${label}" aria-label="${label}"></button>`).join('')}</div>
        <label class="field"><span>رنگ دلخواه</span><input name="color" type="color" aria-label="رنگ"></label>
        <div class="menu-separator"></div>
        <label class="field"><span>ضخامت قلم</span><input name="width" type="number" min="1" max="60" required aria-label="ضخامت قلم"></label>
        <div class="widths" role="group" aria-label="ضخامت‌های آماده">${[2, 4, 8, 16].map(w => `<button data-width="${w}" title="${w} پیکسل" aria-label="ضخامت ${w} پیکسل"><span class="width-line" style="height:${Math.min(w, 8)}px"></span></button>`).join('')}</div>
        <label class="field"><span>شفافیت</span><span class="range-control"><output data-value="opacity">۱۰۰٪</output><input name="opacity" type="range" min="0.05" max="1" step="0.05" aria-label="شفافیت"></span></label>
        <label class="field" data-field="fontSize"><span>اندازه متن</span><input name="fontSize" type="number" min="12" max="96" step="any" required aria-label="اندازه متن"></label>
        <label class="field" data-field="fill"><span>شکل توپر</span><input name="fill" type="checkbox"></label>
      </aside>
      <aside class="panel" id="paint-more" data-menu="more" aria-label="گزینه‌ها و خروجی" hidden>
        <div class="panel-heading"><strong>گزینه‌ها</strong><small>Rastin Paint</small></div>
        <button class="menu-row" data-action="duplicate">${icon('duplicate')}<span class="menu-label">کپی شیء</span><kbd>Ctrl+D</kbd></button>
        <button class="menu-row" data-action="delete">${icon('delete')}<span class="menu-label">حذف شیء</span><kbd>Delete</kbd></button>
        <button class="menu-row" data-action="visibility">${icon('visibility')}<span class="menu-label">پنهان‌کردن طرح</span></button>
        <div class="menu-separator"></div>
        <div class="section-label">دریافت طرح</div>
        <div class="exports"><button data-action="png" title="تصویر شفاف از بخش قابل‌دید">PNG</button><button data-action="svg" title="طرح برداری از بخش قابل‌دید">SVG</button><button data-action="json" title="کل طرح برای بازیابی">JSON</button></div>
        <button class="menu-row" data-action="import">${icon('import')}<span class="menu-label">ورود فایل JSON</span></button>
        <button class="menu-row danger" data-action="clear">${icon('delete')}<span class="menu-label">پاک‌کردن همه</span></button>
        <div class="menu-separator"></div>
        <details class="shortcuts"><summary>میانبرها و راهنما</summary>
          <div class="shortcut-row"><span>بازگشت</span><kbd>Ctrl / ⌘ + Z</kbd></div>
          <div class="shortcut-row"><span>تکرار</span><kbd>Ctrl + Shift + Z / Ctrl + Y</kbd></div>
          <div class="shortcut-row"><span>ثبت متن</span><kbd>Ctrl / ⌘ + Enter</kbd></div>
          <div class="shortcut-row"><span>قلم / انتخاب / تعامل</span><kbd>P / V / B</kbd></div>
          <div class="shortcut-row"><span>بستن منو / لغو / تعامل</span><kbd>Esc</kbd></div>
          <p class="hint">ویرایش متن: دوبار کلیک در حالت انتخاب. تغییر اندازه: گوشه‌های شیء. Shift: شکل برابر یا زاویه ثابت. پاک‌کن: حذف کل شیء.</p>
          <p class="hint">PNG و SVG: طرحِ بخش قابل‌دید با زمینه شفاف. JSON: کل طرح. ذخیره خودکار در این مرورگر.</p>
        </details>
      </aside>
      <input type="file" accept="application/json,.json">
      <button class="notice" hidden></button>
    </section>`;
    document.documentElement.appendChild(host);
    controller = new AbortController(); svg = root.querySelector('svg'); layer = element('g'); svg.appendChild(layer);
    toolbar = root.querySelector('.toolbar'); status = root.querySelector('.status');
    const tools = root.querySelector('.tools');
    TOOLS.forEach(([name, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.tool = name;
      b.title = label; b.setAttribute('aria-label', label); b.innerHTML = icon(name);
      tools.appendChild(b); listen(b, 'click', () => changeTool(name));
    });
    root.querySelectorAll('[data-action]').forEach(b => listen(b, 'click', () => {
      if (b.dataset.action === 'collapse') {
        closePanels(); toolbar.classList.toggle('compact');
        const compact = toolbar.classList.contains('compact');
        b.innerHTML = icon(compact ? 'expand' : 'collapse'); b.setAttribute('aria-expanded', !compact);
        b.title = compact ? 'بازکردن ابزارها' : 'جمع‌کردن ابزارها'; b.setAttribute('aria-label', b.title); clampToolbar();
      }
      else { if (['undo', 'redo'].includes(b.dataset.action)) closePanels(); action(b.dataset.action); }
    }));
    root.querySelectorAll('[data-panel]').forEach(b => listen(b, 'click', () => togglePanel(b.dataset.panel)));
    root.querySelectorAll('[data-color]').forEach(b => listen(b, 'click', () => { changePref('color', b.dataset.color); loadPrefs(prefs); }));
    root.querySelectorAll('[data-width]').forEach(b => listen(b, 'click', () => { changePref('width', Number(b.dataset.width)); loadPrefs(prefs); }));
    loadPrefs(prefs);
    root.querySelectorAll('[name]').forEach(input => listen(input, 'change', () => {
      const name = input.name, value = name === 'fill' ? input.checked : name === 'color' ? input.value : Number(input.value);
      if (input.checkValidity()) changePref(name, value); else loadPrefs(prefs);
    }));
    listen(root.querySelector('input[type=file]'), 'change', e => { importFile(e.target.files[0]); e.target.value = ''; });
    listen(svg, 'pointerdown', down); listen(svg, 'pointermove', move); listen(svg, 'pointerup', up);
    listen(svg, 'pointercancel', cancelGesture); listen(svg, 'lostpointercapture', cancelGesture);
    listen(svg, 'dblclick', e => {
      if (tool === 'select') {
        // Pointer capture can retarget the native dblclick to the surface.
        const target = root.elementFromPoint(e.clientX, e.clientY);
        const id = hit(e) || target?.closest?.('[data-id]')?.getAttribute('data-id');
        const s = shapes.find(s => s.id === id && s.type === 'text');
        if (s) startEditor(s.x, s.y, s.id);
      }
    });
    listen(window, 'scroll', scheduleRender, { passive: true, capture: true });
    listen(window, 'resize', () => { clampToolbar(); positionPanel(); scheduleRender(); }, { passive: true });
    listen(document, 'keydown', keydown, { capture: true });
    listen(document, 'pointerdown', e => {
      if (!e.composedPath().includes(toolbar)) closePanels();
    }, { capture: true });
    listen(window, 'pagehide', () => { finishEditor(); cancelGesture(); });
    // Keep page mouse/selection handlers away from drawing and toolbar interactions.
    ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(type => listen(host, type, e => e.stopPropagation()));
    const header = root.querySelector('.drag-handle'); let drag = null;
    listen(header, 'pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const b = toolbar.getBoundingClientRect(); drag = { x: e.clientX - b.left, y: e.clientY - b.top };
      header.setPointerCapture(e.pointerId); e.preventDefault();
    });
    listen(header, 'pointermove', e => {
      if (!drag) return;
      toolbar.style.transform = 'none'; toolbar.style.left = `${e.clientX - drag.x}px`; toolbar.style.top = `${e.clientY - drag.y}px`; clampToolbar(); positionPanel();
    });
    listen(header, 'pointerup', () => { drag = null; }); listen(header, 'pointercancel', () => { drag = null; });
    const retrySave = async () => {
      if (!saveFailed || pending) return;
      try {
        const saved = savedItems((await chrome.storage.local.get(key))[key], page);
        saveFailed = false; persist(saved, shapes);
        if (!pending) say('ذخیره شد • فقط در این مرورگر');
      } catch { say('ذخیره هنوز ناموفق است؛ برای نگهداری طرح خروجی JSON بگیرید.', true); }
    };
    listen(status, 'click', retrySave); listen(root.querySelector('.notice'), 'click', retrySave);
    routeTimer = setInterval(checkRoute, 750);
    say('آماده • طرح‌ها خودکار ذخیره می‌شوند'); render();
  }
  function clampToolbar() {
    if (!toolbar) return;
    const b = toolbar.getBoundingClientRect();
    toolbar.style.transform = 'none'; toolbar.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, b.left))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(innerHeight - b.height - 8, b.top))}px`;
  }
  async function checkRoute() {
    if (!host || M.pageKey(location.href) === page) return;
    if (saveFailed) { say('ابتدا از طرح ذخیره‌نشده خروجی JSON بگیرید؛ سپس ابزار را ببندید و باز کنید.', true); changeTool('browse'); return; }
    finishEditor(); cancelGesture();
    const next = M.pageKey(location.href); close();
    if (enabled) open(next);
  }
  async function open(nextPage = M.pageKey(location.href)) {
    if (!enabled) return { ok: false, error: 'افزونه غیرفعال است.' };
    if (host) {
      changeTool('pen'); toolbar.classList.remove('compact');
      const collapse = root.querySelector('[data-action="collapse"]');
      collapse.innerHTML = icon('collapse'); collapse.setAttribute('aria-expanded', 'true');
      collapse.title = 'جمع‌کردن ابزارها'; collapse.setAttribute('aria-label', collapse.title);
      clampToolbar(); return { ok: true };
    }
    if (opening) return opening;
    const g = ++generation;
    opening = (async () => {
      try {
        const nextKey = await M.storageKey(nextPage);
        const data = await chrome.storage.local.get([nextKey, 'rastin_paint_preferences']);
        if (g !== generation || !enabled) return { ok: false };
        shapes = savedItems(data[nextKey], nextPage);
        page = nextPage; key = nextKey; undo = []; redo = []; selected = null; pending = 0; saveFailed = false;
        prefs = { ...prefs, ...data.rastin_paint_preferences };
        // Validate preferences through the same schema used for drawing items.
        try { M.item({ id: 'prefs', type: 'text', ...prefs, x: 0, y: 0, text: 'x' }); }
        catch { prefs = { color: '#ef4444', width: 4, opacity: 1, fontSize: 24, fill: false }; }
        tool = 'pen'; hidden = false; mount(); return { ok: true };
      } catch { return { ok: false, error: 'خواندن طرح ناموفق بود؛ اطلاعات ذخیره‌شده حفظ شد.' }; }
      finally { opening = null; }
    })();
    return opening;
  }
  function close() {
    finishEditor(); cancelGesture(); generation++;
    controller?.abort(); clearInterval(routeTimer); clearTimeout(clearTimer); if (frame !== null) cancelAnimationFrame(frame);
    frame = null; host?.remove(); host = root = svg = layer = toolbar = status = null;
    rendered.clear();
    undo = []; redo = []; selected = null;
  }
  RtlFixer.initPaint = function () {
    enabled = RtlFixer.config?.globalEnabled !== false;
    if (!enabled) close();
  };
  RtlFixer.openPaint = open;
  RtlFixer.closePaint = close;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && host && changes[key]) syncStorage();
  });
})(window.RtlFixer);
