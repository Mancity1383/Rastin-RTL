// Geometry is saved in PDF user space so zoom, crop-box offsets and rotation
// never change the document locations of the annotations.
const finite = value => Number.isFinite(value);
const copyPoint = point => Array.isArray(point) && point.length === 2 && point.every(finite) ? [...point] : null;
export const copyItems = items => structuredClone(items);

export function screenRectToPdf(viewport, rect) {
  const corners = [
    viewport.convertToPdfPoint(rect.x, rect.y),
    viewport.convertToPdfPoint(rect.x + rect.width, rect.y),
    viewport.convertToPdfPoint(rect.x, rect.y + rect.height),
    viewport.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height)
  ];
  return boundingRect(corners);
}

export function pdfRectToScreen(viewport, rect) {
  const corners = [
    viewport.convertToViewportPoint(rect.x, rect.y),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y),
    viewport.convertToViewportPoint(rect.x, rect.y + rect.height),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
  ];
  return boundingRect(corners);
}

function boundingRect(points) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function viewportScale(viewport) {
  const origin = viewport.convertToViewportPoint(0, 0);
  const unit = viewport.convertToViewportPoint(1, 0);
  return Math.hypot(unit[0] - origin[0], unit[1] - origin[1]);
}

export function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const square = dx * dx + dy * dy;
  const ratio = square ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / square)) : 0;
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
}

export function sanitizeItems(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const ids = new Set();
  for (const source of value.slice(0, 20000)) {
    if (!source || typeof source.id !== 'string' || !source.id || source.id.length > 100 || ids.has(source.id) ||
        !Number.isInteger(source.page) || source.page < 1 || !['highlight', 'underline', 'pen', 'rect', 'note'].includes(source.type)) continue;
    const item = {
      id: source.id, page: source.page, type: source.type,
      color: /^#[a-f\d]{6}$/i.test(source.color) ? source.color : '#facc15',
      width: finite(source.width) ? Math.max(0.25, Math.min(24, source.width)) : 2
    };
    if (['highlight', 'underline'].includes(source.type) && typeof source.text === 'string') item.text = source.text.slice(0, 2000);
    if (source.type === 'note') {
      item.point = copyPoint(source.point);
      if (!item.point || typeof source.text !== 'string') continue;
      item.text = source.text.slice(0, 20000);
    } else if (source.type === 'pen' || source.type === 'underline') {
      item.points = Array.isArray(source.points) ? source.points.slice(0, 20000).map(copyPoint).filter(Boolean) : [];
      if (item.points.length < 2) continue;
    } else {
      item.rects = Array.isArray(source.rects) ? source.rects.slice(0, 5000).filter(rect => rect &&
        [rect.x, rect.y, rect.width, rect.height].every(finite) && rect.width > 0 && rect.height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height })) : [];
      if (!item.rects.length) continue;
    }
    ids.add(item.id);
    result.push(item);
  }
  return result;
}
