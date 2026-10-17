import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  PDFDocument, PDFArray, PDFDict, PDFHexString, PDFName, PDFString,
  degrees, decodePDFRawStream
} from '../vendor/pdf-lib/pdf-lib.esm.min.js';
import { getDocument, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportAnnotatedPdf } from '../reader/export.js';

const PERSIAN_NOTE = 'یادداشت فارسی: نیم‌فاصله، مطالعهٔ مقاله و سؤال بعدی 📝';
const N = PDFName.of;
const rawNumbers = array => array.asArray().map(item => item.asNumber());
const annotationsFor = page => (page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []).map(ref => page.doc.context.lookup(ref, PDFDict));
const findAnnotation = (page, id) => annotationsFor(page).find(annotation => annotation.lookup(N('NM')).decodeText() === id);
const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/');
const loadingTasks = new WeakMap();

async function fixture() {
  const document = await PDFDocument.create();
  document.setTitle('Original source title');
  document.setAuthor('Original source author');
  const first = document.addPage([600, 800]);
  first.drawText('Original selectable PDF content.', { x: 60, y: 710, size: 18 });
  first.drawRectangle({ x: 80, y: 220, width: 140, height: 100 });
  const second = document.addPage([600, 800]);
  second.setCropBox(30, 40, 480, 610);
  second.setRotation(degrees(90));
  second.node.set(N('UserUnit'), document.context.obj(1.5));
  second.drawText('Rotated and cropped source content.', { x: 60, y: 600, size: 16 });
  const existing = document.context.register(document.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [45, 650, 67, 672],
    Contents: PDFHexString.fromText('یادداشت موجود در فایل'),
    NM: PDFString.of('existing-source-note'), Name: 'Note', F: 4
  }));
  first.node.set(N('Annots'), document.context.obj([existing]));
  return document.save({ useObjectStreams: false });
}

function contentsSnapshot(page) {
  const contents = page.node.lookup(N('Contents'));
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  return entries.map(entry => Buffer.from(page.doc.context.lookup(entry).getContents()).toString('hex'));
}

async function parsedPdf(bytes) {
  const task = getDocument({ data: Uint8Array.from(bytes), standardFontDataUrl });
  const document = await task.promise;
  loadingTasks.set(document, task);
  return document;
}

const destroyPdf = document => loadingTasks.get(document).destroy();

async function extractPageText(document, page) {
  return (await (await document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
}

async function renderedPage(document, pageNumber) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
  return { canvas, context, viewport };
}

test('native export preserves original content, metadata, existing annotations, geometry, and Persian note text', async () => {
  const source = await fixture();
  const sourceCopy = Uint8Array.from(source);
  const records = [
    { id: 'hl', page: 1, type: 'highlight', color: '#facc15', rects: [{ x: 60, y: 705, width: 240, height: 22 }, { x: 65, y: 675, width: 100, height: 17 }] },
    { id: 'under', page: 1, type: 'underline', color: '#3399cc', width: 2, points: [[60, 700], [300, 700]] },
    { id: 'ink', page: 1, type: 'pen', color: '#2455ff', width: 4, points: [[100, 550], [130, 570], [180, 550]] },
    { id: 'square', page: 1, type: 'rect', color: '#ef4444', width: 3, rects: [{ x: 350, y: 500, width: 140, height: 100 }] },
    { id: 'note', page: 1, type: 'note', color: '#facc15', point: [330, 710], text: PERSIAN_NOTE },
    { id: 'rotated-hl', page: 2, type: 'highlight', color: '#3399cc', rects: [{ x: 60, y: 596, width: 270, height: 24 }] },
    { id: 'rotated-ink', page: 2, type: 'pen', color: '#ef4444', width: 5, points: [[70, 140], [120, 180], [180, 150]] }
  ];
  const output = await exportAnnotatedPdf({ bytes: source, annotations: records, filename: 'article.pdf' });
  assert.deepEqual(source, sourceCopy, 'export must not alter or detach caller source bytes');
  const original = await PDFDocument.load(source, { updateMetadata: false });
  const saved = await PDFDocument.load(output, { updateMetadata: false });
  assert.equal(saved.getPageCount(), 2);
  assert.equal(saved.getTitle(), original.getTitle());
  assert.equal(saved.getAuthor(), original.getAuthor());
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(contentsSnapshot(saved.getPage(index)), contentsSnapshot(original.getPage(index)), 'original compressed page streams must survive exactly');
    assert.deepEqual(saved.getPage(index).getCropBox(), original.getPage(index).getCropBox());
    assert.deepEqual(saved.getPage(index).getMediaBox(), original.getPage(index).getMediaBox());
    assert.equal(saved.getPage(index).getRotation().angle, original.getPage(index).getRotation().angle);
    assert.equal(saved.getPage(index).node.lookup(N('Resources')).toString(), original.getPage(index).node.lookup(N('Resources')).toString());
  }
  const first = saved.getPage(0);
  assert.equal(annotationsFor(first).length, 6);
  assert.equal(findAnnotation(first, 'existing-source-note').lookup(N('Contents')).decodeText(), 'یادداشت موجود در فایل');
  assert.equal(findAnnotation(first, 'note').lookup(N('Contents')).decodeText(), PERSIAN_NOTE);
  assert.deepEqual(rawNumbers(findAnnotation(first, 'note').lookup(N('Rect'), PDFArray)), [330, 683, 354, 710], 'note marker starts below its top-left click anchor');
  assert.equal(findAnnotation(first, 'note').lookup(N('F')).asNumber(), 28, 'sticky-note icons request no zoom/rotation in native PDF viewers');
  assert.deepEqual(rawNumbers(findAnnotation(first, 'hl').lookup(N('QuadPoints'), PDFArray)), [60, 727, 300, 727, 60, 705, 300, 705, 65, 692, 165, 692, 65, 675, 165, 675]);
  const inkList = findAnnotation(first, 'ink').lookup(N('InkList'), PDFArray);
  assert.deepEqual(rawNumbers(inkList.lookup(0, PDFArray)), records[2].points.flat());
  assert.deepEqual(rawNumbers(findAnnotation(first, 'square').lookup(N('Rect'), PDFArray)), [348.5, 498.5, 491.5, 601.5]);
  for (const [index, page] of saved.getPages().entries()) {
    for (const annotation of annotationsFor(page)) {
      if (annotation.lookup(N('NM')).decodeText() === 'existing-source-note') continue;
      const appearance = annotation.lookup(N('AP'), PDFDict).lookup(N('N'));
      assert.equal(appearance.dict.lookup(N('Subtype')).toString(), '/Form');
      assert.ok(decodePDFRawStream(appearance).decode().length > 0);
      assert.equal(annotation.get(N('P')).toString(), page.ref.toString(), `annotation must refer to page ${index + 1}`);
      assert.equal(annotation.lookup(N('F')).asNumber() & 4, 4, 'annotation is printable');
    }
  }
  const before = await parsedPdf(source);
  const after = await parsedPdf(output);
  try {
    assert.equal(after.numPages, before.numPages);
    for (const page of [1, 2]) assert.equal(await extractPageText(after, page), await extractPageText(before, page));
    const parsed = await (await after.getPage(1)).getAnnotations();
    assert.deepEqual(parsed.map(annotation => annotation.subtype), ['Text', 'Highlight', 'Underline', 'Ink', 'Square', 'Text']);
    assert.equal(parsed.find(annotation => annotation.contentsObj.str === PERSIAN_NOTE)?.subtype, 'Text');
    assert.ok(parsed.slice(1).every(annotation => annotation.hasAppearance));
    const rotatedBefore = await before.getPage(2), rotatedAfter = await after.getPage(2);
    assert.deepEqual(rotatedAfter.view, [30, 40, 510, 650]);
    assert.equal(rotatedAfter.rotate, 90);
    assert.equal(rotatedAfter.userUnit, 1.5);
    assert.deepEqual(rotatedAfter.getViewport({ scale: 1.25 }).convertToViewportPoint(60, 596), rotatedBefore.getViewport({ scale: 1.25 }).convertToViewportPoint(60, 596));
    const rotatedAnnotations = await rotatedAfter.getAnnotations();
    assert.deepEqual(rotatedAnnotations[0].rect, [60, 596, 330, 620]);
    assert.deepEqual([...rotatedAnnotations[1].inkLists[0]], [70, 140, 120, 180, 180, 150]);
    // Parse and render AP streams independently with PDF.js, including rotated,
    // offset CropBox/UserUnit pages. A blue stroke must appear at the same PDF
    // point after the source viewport transformation.
    for (const pageNumber of [1, 2]) {
      const rendering = await renderedPage(after, pageNumber);
      const userPoint = pageNumber === 1 ? [130, 570] : [120, 180];
      const [screenX, screenY] = rendering.viewport.convertToViewportPoint(...userPoint);
      const pixel = rendering.context.getImageData(Math.floor(screenX), Math.floor(screenY), 1, 1).data;
      if (pageNumber === 1) assert.ok(pixel[2] > 180 && pixel[0] < 100, `blue ink renders at its native PDF coordinates: ${pixel}`);
      else assert.ok(pixel[0] > 180 && pixel[1] < 100, `red ink renders on the rotated/cropped page: ${pixel}`);
      if (pageNumber === 1) {
        const [noteX, noteY] = rendering.viewport.convertToViewportPoint(330, 710);
        const below = rendering.context.getImageData(noteX + 4, noteY + 4, 1, 1).data;
        const above = rendering.context.getImageData(noteX + 4, noteY - 4, 1, 1).data;
        assert.ok(below[0] > 200 && below[2] < 100, `note icon fills below the click anchor: ${below}`);
        assert.deepEqual([...above], [255, 255, 255, 255], 'note export must not shift the icon above the click');
      }
    }
  } finally {
    await destroyPdf(before);
    await destroyPdf(after);
  }
});

test('rect underlines, reverse drags, and single-point pen taps have portable appearances', async () => {
  const output = await exportAnnotatedPdf({ bytes: await fixture(), annotations: [
    { id: 'under-rect', type: 'underline', page: 1, color: '#2455ff', width: 3, rects: [{ x: 50, y: 450, width: 100, height: 20 }] },
    { id: 'reverse', type: 'rect', page: 1, color: '#ef4444', rects: [{ x: 240, y: 400, width: -80, height: -50 }] },
    { id: 'dot', type: 'pen', page: 1, color: '#2455ff', width: 10, points: [[280, 420]] }
  ] });
  const saved = await PDFDocument.load(output);
  assert.deepEqual(rawNumbers(findAnnotation(saved.getPage(0), 'reverse').lookup(N('Rect'), PDFArray)), [159, 349, 241, 401]);
  const after = await parsedPdf(output);
  try {
    const render = await renderedPage(after, 1);
    const [x, y] = render.viewport.convertToViewportPoint(280, 420);
    const pixel = render.context.getImageData(x, y, 1, 1).data;
    assert.ok(pixel[2] > 180 && pixel[0] < 100, 'a pen tap remains visible in exported PDF');
    const parsed = await (await after.getPage(1)).getAnnotations();
    assert.equal(parsed.length, 4);
    assert.deepEqual([...parsed.find(annotation => annotation.subtype === 'Ink').inkLists[0]], [280, 420, 280, 420]);
  } finally { await destroyPdf(after); }
});

test('export without new annotations returns a byte-identical independent copy', async () => {
  const bytes = await fixture();
  const output = await exportAnnotatedPdf({ bytes, annotations: [] });
  assert.notEqual(output, bytes);
  assert.deepEqual(output, bytes);
});

test('unsupported encryption and invalid geometry fail clearly without mutating the source', async () => {
  const encrypted = await PDFDocument.create();
  encrypted.addPage([300, 400]);
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({
    Filter: 'Standard', V: 1, R: 2, P: -4,
    O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('00'.repeat(32))
  }));
  const encryptedBytes = await encrypted.save({ useObjectStreams: false });
  const encryptedCopy = Uint8Array.from(encryptedBytes);
  await assert.rejects(exportAnnotatedPdf({ bytes: encryptedBytes, annotations: [] }), error => error.code === 'ENCRYPTED_PDF' && error.message.includes('رمزگذاری'));
  assert.deepEqual(encryptedBytes, encryptedCopy);
  const bytes = await fixture();
  for (const record of [
    { page: 3, type: 'note', point: [20, 20] },
    { page: 1, type: 'note', point: [Infinity, 20] },
    { page: 1, type: 'highlight', rects: [] },
    { page: 1, type: 'pen', points: [] },
    { page: 1, type: 'note', point: [20, 20], color: 'blue' },
    { page: 1, type: 'unsupported', point: [20, 20] }
  ]) await assert.rejects(exportAnnotatedPdf({ bytes, annotations: [record] }), { code: 'INVALID_ANNOTATION' });
  await assert.rejects(exportAnnotatedPdf({ bytes: new TextEncoder().encode('invalid file') }), { code: 'INVALID_PDF' });
  await assert.rejects(exportAnnotatedPdf({}), { code: 'MISSING_SOURCE' });
});
