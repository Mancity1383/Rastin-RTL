// Shared, deliberately strict drawing format. No HTML or executable SVG is stored.
(function (global) {
  'use strict';
  const TYPES = new Set(['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text']);
  const MAX_ITEMS = 1000;
  const MAX_BYTES = 3 * 1024 * 1024;
  const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const coord = v => number(v, -1000000, 1000000);
  function item(raw) {
    if (!raw || !TYPES.has(raw.type) || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id) ||
        !/^#[0-9a-f]{6}$/i.test(raw.color || '') || !number(raw.width, 1, 60) ||
        !number(raw.opacity, 0.05, 1) || !coord(raw.x) || !coord(raw.y)) throw new Error('Invalid drawing item');
    const out = { id: raw.id, type: raw.type, color: raw.color, width: raw.width,
      opacity: raw.opacity, x: raw.x, y: raw.y, fill: raw.fill === true };
    if (raw.type === 'pen' || raw.type === 'marker') {
      if (!Array.isArray(raw.points) || !raw.points.length || raw.points.length > 5000 ||
          raw.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(coord))) throw new Error('Invalid stroke');
      out.points = raw.points.map(p => [...p]);
    } else if (raw.type === 'text') {
      if (typeof raw.text !== 'string' || raw.text.length > 4000 || !raw.text.trim() ||
          !number(raw.fontSize, 12, 96)) throw new Error('Invalid text');
      out.text = raw.text; out.fontSize = raw.fontSize;
    } else {
      if (!coord(raw.x2) || !coord(raw.y2)) throw new Error('Invalid shape');
      out.x2 = raw.x2; out.y2 = raw.y2;
    }
    return out;
  }
  function items(raw) {
    if (!Array.isArray(raw) || raw.length > MAX_ITEMS || new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BYTES)
      throw new Error('Drawing limit exceeded');
    const result = raw.map(item);
    if (new Set(result.map(s => s.id)).size !== result.length) throw new Error('Duplicate drawing IDs');
    return result;
  }
  function pageKey(url) {
    const u = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) throw new Error('Unsupported page');
    // Ordinary in-page anchors share a drawing; hash-based application routes do not.
    return `${u.protocol === 'file:' ? 'file://' : u.origin}${u.pathname}${u.search}${/^#!?\//.test(u.hash) ? u.hash : ''}`;
  }
  async function storageKey(page) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(page));
    return 'rastin_paint_' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }
  function translate(s, dx, dy) {
    const out = { ...s, x: s.x + dx, y: s.y + dy };
    if (s.points) out.points = s.points.map(([x, y]) => [x + dx, y + dy]);
    if ('x2' in s) { out.x2 = s.x2 + dx; out.y2 = s.y2 + dy; }
    return out;
  }
  function scale(s, anchor, sx, sy) {
    if (s.type === 'text') sx = sy = Math.max(12 / s.fontSize, Math.min(96 / s.fontSize, Math.max(sx, sy)));
    const x = v => anchor[0] + (v - anchor[0]) * sx;
    const y = v => anchor[1] + (v - anchor[1]) * sy;
    const out = { ...s, x: x(s.x), y: y(s.y) };
    if (s.points) out.points = s.points.map(p => [x(p[0]), y(p[1])]);
    if ('x2' in s) { out.x2 = x(s.x2); out.y2 = y(s.y2); }
    if (s.type === 'text') out.fontSize = s.fontSize * sx;
    return out;
  }
  global.RastinPaintModel = { item, items, pageKey, storageKey, translate, scale, MAX_ITEMS, MAX_BYTES };
})(globalThis);
