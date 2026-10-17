import { PDFDocument, PDFArray, PDFHexString, PDFName, PDFString, EncryptedPDFError } from '../vendor/pdf-lib/pdf-lib.esm.min.js';

const SUBTYPES = { highlight: 'Highlight', underline: 'Underline', pen: 'Ink', rect: 'Square', note: 'Text' };
const ENCRYPTED_MESSAGE = 'خروجی PDF رمزگذاری‌شده پشتیبانی نمی‌شود. یک نسخهٔ بدون رمز را باز کنید؛ فایل اصلی شما تغییر نکرده است.';
// The pinned ES5 library's Error subclasses do not retain instanceof reliably.
const ENCRYPTED_SIGNATURE = new EncryptedPDFError().message;

export class PdfExportError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'PdfExportError';
    this.code = code;
  }
}

function invalid(message) {
  throw new PdfExportError(`یادداشت PDF معتبر نیست: ${message}`, 'INVALID_ANNOTATION');
}

function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e7) invalid('مختصات نامعتبر');
  return value;
}

// PDF content streams do not allow exponential number notation.
const numeric = value => String(Number(value.toFixed(5)));
const operands = values => values.map(numeric).join(' ');

function color(value = '#facc15') {
  if (!/^#[\da-f]{6}$/i.test(value)) invalid('رنگ نامعتبر');
  return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function point(value) {
  if (!Array.isArray(value) || value.length !== 2) invalid('نقطهٔ نامعتبر');
  return value.map(number);
}

function rectangle(value) {
  if (!value || typeof value !== 'object') invalid('محدودهٔ نامعتبر');
  const x = number(value.x), y = number(value.y);
  const width = number(value.width), height = number(value.height);
  if (width === 0 || height === 0) invalid('محدودهٔ خالی');
  return { x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height) };
}

function normalize(record, pageCount, index) {
  if (!record || !Object.hasOwn(SUBTYPES, record.type)) invalid('نوع ابزار نامعتبر');
  if (!Number.isInteger(record.page) || record.page < 1 || record.page > pageCount) invalid('شمارهٔ صفحه نامعتبر');
  const width = number(record.width ?? 2);
  if (width <= 0 || width > 100) invalid('ضخامت نامعتبر');
  const normalized = { ...record, width, color: color(record.color), id: String(record.id ?? `rastin-${index}`), text: String(record.text ?? '') };
  if (record.type === 'note') {
    normalized.point = point(record.point);
  } else if (record.type === 'pen' || (record.type === 'underline' && Array.isArray(record.points))) {
    if (!Array.isArray(record.points) || record.points.length === 0) invalid('خط خالی');
    normalized.points = record.points.map(point);
    if (record.type === 'underline' && normalized.points.length !== 2) invalid('زیرخط باید دو نقطه داشته باشد');
  } else {
    if (!Array.isArray(record.rects) || record.rects.length === 0) invalid('محدودهٔ خالی');
    normalized.rects = record.rects.map(rectangle);
  }
  return normalized;
}

function boundsFor(record) {
  let coordinates;
  if (record.type === 'note') {
    const [x, y] = record.point;
    // The UI stores the icon's top-left anchor. PDF's y axis points upward.
    return [x, y - 27, x + 24, y];
  }
  if (record.points) {
    coordinates = record.points;
  } else {
    coordinates = record.rects.flatMap(rect => [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]]);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  // A horizontal/vertical stroke needs enough annotation extent for readers
  // which validate BS.W against half of the rectangle's smallest dimension.
  const padding = record.type === 'highlight' ? 0 : record.points ? record.width : record.width / 2;
  return [minX - padding, minY - padding, maxX + padding, maxY + padding];
}

function appearance(context, record, bounds) {
  const [x0, y0, x1, y1] = bounds;
  const local = ([x, y]) => operands([x - x0, y - y0]);
  const rgb = operands(record.color);
  const commands = ['q', `${rgb} rg`, `${rgb} RG`, `${numeric(record.width)} w`, '1 J', '1 j'];
  const resources = {};
  if (record.type === 'highlight') {
    // Multiply plus alpha keeps the source glyphs legible in other PDF readers.
    resources.ExtGState = { GS0: { Type: 'ExtGState', BM: 'Multiply', ca: 0.3, CA: 0.3 } };
    commands.push('/GS0 gs');
    for (const rect of record.rects) commands.push(`${operands([rect.x - x0, rect.y - y0, rect.width, rect.height])} re f`);
  } else if (record.type === 'underline') {
    if (record.points) commands.push(`${local(record.points[0])} m`, `${local(record.points[1])} l S`);
    else for (const rect of record.rects) commands.push(`${local([rect.x, rect.y])} m`, `${local([rect.x + rect.width, rect.y])} l S`);
  } else if (record.type === 'rect') {
    for (const rect of record.rects) commands.push(`${operands([rect.x - x0, rect.y - y0, rect.width, rect.height])} re S`);
  } else if (record.type === 'pen') {
    if (record.points.length === 1) {
      // A single pointer tap is a dot, rather than an invisible zero-length path.
      const [x, y] = record.points[0], radius = record.width / 2, k = radius * 0.5522847498;
      commands.push(`${local([x + radius, y])} m`);
      for (const curve of [
        [[x + radius, y + k], [x + k, y + radius], [x, y + radius]],
        [[x - k, y + radius], [x - radius, y + k], [x - radius, y]],
        [[x - radius, y - k], [x - k, y - radius], [x, y - radius]],
        [[x + k, y - radius], [x + radius, y - k], [x + radius, y]]
      ]) commands.push(`${curve.map(local).join(' ')} c`);
      commands.push('f');
    } else {
      commands.push(`${local(record.points[0])} m`);
      for (const next of record.points.slice(1)) commands.push(`${local(next)} l`);
      commands.push('S');
    }
  } else if (record.type === 'note') {
    commands.push('0.52157 0.30196 0.0549 RG', '1 w',
      '2 27 m 20 27 l 24 27 24 25 24 23 c 24 9 l 24 5 22 5 20 5 c 8 5 l 2 0 l 2 5 l 0 5 0 7 0 9 c 0 23 l 0 27 0 27 2 27 c h B',
      '0.44314 0.24706 0.07059 RG', '1.7 w', '6 20 m 18 20 l S', '6 16 m 18 16 l S', '6 12 m 13 12 l S');
  }
  commands.push('Q');
  return context.register(context.flateStream(commands.join('\n'), {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: [0, 0, x1 - x0, y1 - y0], Matrix: [1, 0, 0, 1, 0, 0], Resources: resources
  }));
}

function appendAnnotation(document, record, timestamp) {
  const page = document.getPage(record.page - 1), context = document.context;
  const bounds = boundsFor(record);
  const dictionary = {
    Type: 'Annot', Subtype: SUBTYPES[record.type], Rect: bounds, P: page.ref,
    C: record.color, F: 4, Border: [0, 0, 0],
    NM: PDFHexString.fromText(record.id), T: PDFHexString.fromText('راستین'),
    Contents: PDFHexString.fromText(record.text), M: PDFString.of(timestamp), CreationDate: PDFString.of(timestamp),
    AP: { N: appearance(context, record, bounds) }
  };
  if (record.type === 'highlight' || record.type === 'underline') {
    // PDF.js and Acrobat both use top-left, top-right, bottom-left, bottom-right.
    if (record.points) {
      const [[x0, y0], [x1, y1]] = record.points;
      const length = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / length * record.width / 2, ny = (x1 - x0) / length * record.width / 2;
      dictionary.QuadPoints = [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny];
    } else dictionary.QuadPoints = record.rects.flatMap(({ x, y, width, height }) => [x, y + height, x + width, y + height, x, y, x + width, y]);
    dictionary.CA = record.type === 'highlight' ? 0.3 : 1;
  }
  if (record.type === 'pen') {
    const points = record.points.length === 1 ? [...record.points, record.points[0]] : record.points;
    dictionary.InkList = [points.flat()];
    dictionary.BS = { Type: 'Border', S: 'S', W: record.width };
  }
  if (record.type === 'rect' || record.type === 'underline') dictionary.BS = { Type: 'Border', S: 'S', W: record.width };
  if (record.type === 'rect') dictionary.RD = [record.width / 2, record.width / 2, record.width / 2, record.width / 2];
  if (record.type === 'note') {
    dictionary.Name = 'Comment'; dictionary.Open = false;
    dictionary.F = 4 | 8 | 16; // Print, NoZoom, NoRotate: a sticky-note icon.
  }
  const annotation = context.register(context.obj(dictionary));
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) existing.push(annotation);
  else page.node.set(PDFName.of('Annots'), context.obj([annotation]));
}

/**
 * Adds native PDF annotations to the existing document without changing its page
 * content streams. Coordinates are in unrotated PDF user space, including the
 * original CropBox origin, and page numbers are 1-based. The caller downloads
 * the returned Uint8Array; no remote service or document upload is involved.
 */
export async function exportAnnotatedPdf({ bytes, annotations = [], filename: _filename } = {}) {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    throw new PdfExportError('فایل اصلی PDF در دسترس نیست.', 'MISSING_SOURCE');
  }
  if (!Array.isArray(annotations)) invalid('فهرست یادداشت‌ها نامعتبر');
  const source = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes.slice(0));
  let document;
  try {
    // Never use ignoreEncryption: pdf-lib cannot safely rewrite encrypted PDFs.
    document = await PDFDocument.load(source, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    if (error instanceof EncryptedPDFError || error?.name === 'EncryptedPDFError' || error?.message === ENCRYPTED_SIGNATURE) {
      throw new PdfExportError(ENCRYPTED_MESSAGE, 'ENCRYPTED_PDF', error);
    }
    throw new PdfExportError('این PDF قابل ذخیره‌سازی نیست. فایل اصلی شما تغییر نکرده است.', 'INVALID_PDF', error);
  }
  if (document.isEncrypted) throw new PdfExportError(ENCRYPTED_MESSAGE, 'ENCRYPTED_PDF');
  const normalized = annotations.map((record, index) => normalize(record, document.getPageCount(), index));
  if (normalized.length === 0) return source;
  const timestamp = `D:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '')}Z`;
  for (const record of normalized) {
    // Square annotations have one rectangle; retain every rectangle if a caller
    // supplied more than one, instead of dropping part of the drawing.
    if (record.type === 'rect' && record.rects.length > 1) {
      record.rects.forEach((rect, index) => appendAnnotation(document, { ...record, id: `${record.id}-${index}`, rects: [rect] }, timestamp));
    } else appendAnnotation(document, record, timestamp);
  }
  return document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}
