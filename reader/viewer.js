import { getDocument, GlobalWorkerOptions, PasswordResponses, TextLayer, AnnotationMode, AnnotationType } from '../vendor/pdfjs/pdf.mjs';
import { createAnnotations } from './annotations.js';
import { exportAnnotatedPdf } from './export.js';
import { createPdfSelection } from './selection.js';
import { createAnnotationNavigator } from './navigation.js';
import { createReaderKeyboard } from './keyboard.js';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
const assetUrl = name => chrome.runtime.getURL('vendor/pdfjs/' + name + '/');
const element = id => document.getElementById('reader-' + id);
const welcome = element('welcome'), workspace = element('canvas-view'), status = element('status');
const stage = element('page-stage'), scroller = element('paper-scroll'), passwordDialog = element('password-dialog');
const MAX_FILE_BYTES = 100 * 1024 * 1024, MAX_CACHE_BYTES = 200 * 1024 * 1024;
const formatNumber = value => value.toLocaleString('fa-IR');
let sequence = 0, loadingTask = null, documentTask = null, pdf = null, renderTask = null, textTask = null, renderSequence = 0;
let documentId = null, currentPage = 1, currentViewport = null, rotation = 0, tool = 'select';
let originalBytes = null, filename = 'document.pdf', passwordUpdate = null, cachePromise, noteDraft = null;
let thumbnailObserver = null, thumbnailQueue = [], thumbnailRunning = false, thumbnailTask = null;
let activeDocumentSequence = 0;
let renderedPaneSize = null;
let exporting = false;
let activeAnnotationId = null;
let lastRenderedScale = 1, pendingViewAnchor = null, sourceRequest = null;
const names = { highlight: 'هایلایت', underline: 'زیرخط', pen: 'قلم', rect: 'کادر', note: 'یادداشت' };
const hints = {
  select: 'روی متن بکش تا کلمه‌ها انتخاب شوند؛ دوبار کلیک یک واژه و سه‌بار کلیک یک خط را انتخاب می‌کند.',
  highlight: 'روی نوشته بکش تا همان کلمه‌ها هایلایت شوند؛ در فضای خالی یا حالت ناحیه، آزادانه علامت بکش.',
  underline: 'روی نوشته بکش تا زیر کلمه‌های انتخاب‌شده خط بخورد؛ در حالت ناحیه، آزادانه خط بکش.', pen: 'با ماوس یا قلم روی صفحه بنویس و علامت بزن.',
  rect: 'روی صفحه بکش تا کادر ساخته شود.', note: 'روی محل دلخواه صفحه بزن و یادداشت بنویس.',
  erase: 'روی علامت یا لبهٔ کادر بزن تا حذف شود.'
};
const annotations = createAnnotations({ stage, layer: element('annotation-layer'),
  onChange: updateAnnotations, onNote: openNote,
  onError: () => notice('ذخیرهٔ علامت‌ها ممکن نشد. صفحه را باز نگه دارید و یک نسخهٔ PDF دانلود کنید.', 'error')
});
const pdfSelection = createPdfSelection({ stage, textLayer: element('text-layer'), scroller,
  onChange: showSelection, onCommit: ({ selection, tool: selectedTool, text }) => markSelection(selection, selectedTool, text)
});
const annotationNavigator = createAnnotationNavigator({ scroller, stage, layer: element('annotation-layer'),
  getDocumentKey: () => documentId, getPage: () => currentPage, renderPage: number => renderPage(number, { navigating: true })
});
window.RtlFixer.pdfSelection = pdfSelection;

function markSelection(selection, type, text = '') {
  annotations.setTool(type); annotations.selectText(selection, { text }); annotations.setTool(tool);
}
function showSelection({ selection, bounds, text = '', dragging = false }) {
  const bar = element('selection-bar');
  if (!selection || !bounds || dragging || document.querySelector('dialog[open]')) { bar.hidden = true; return; }
  element('copy-selection').disabled = !text;
  bar.hidden = false;
  const pane = scroller.getBoundingClientRect(), width = bar.offsetWidth, height = bar.offsetHeight;
  const left = Math.max(pane.left + 8, Math.min(bounds.x + bounds.width / 2 - width / 2, pane.right - width - 8));
  let top = bounds.y + bounds.height + 10;
  if (top + height > pane.bottom - 8) top = bounds.y - height - 10;
  top = Math.max(pane.top + 8, Math.min(top, pane.bottom - height - 8));
  bar.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px'; bar.style.top = top + 'px';
}
function showNativeSelection() {
  if (pdfSelection.getSelection()) return;
  const selection = getSelection();
  if (!pdf || tool !== 'select' || !selection?.rangeCount || selection.isCollapsed ||
      !element('text-layer').contains(selection.anchorNode) || !element('text-layer').contains(selection.focusNode)) {
    element('selection-bar').hidden = true; return;
  }
  const bounds = selection.getRangeAt(0).getBoundingClientRect();
  showSelection({ selection, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, text: selection.toString() });
}
function readerIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('reader-icon');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#reader-icon-' + name); svg.append(use); return svg;
}

function notice(message, kind = 'info') { status.textContent = message; status.dataset.kind = kind; status.hidden = !message; }
function setTool(next) {
  tool = next; annotations.setTool(next); pdfSelection.setTool(next);
  for (const button of document.querySelectorAll('.tool-button')) {
    const selected = button.dataset.tool === next;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  element('tool-hint').textContent = hints[next];
  element('selection-bar').hidden = true;
  getSelection()?.removeAllRanges();
}
function updateAnnotations({ items, canUndo, canRedo, saveState }) {
  element('undo').disabled = !canUndo; element('redo').disabled = !canRedo;
  element('clear-page').disabled = !items.some(item => item.page === currentPage);
  element('annotation-count').textContent = formatNumber(items.length);
  element('save-state').dataset.state = saveState;
  element('save-state').textContent = { saved: 'ذخیره شده', saving: 'در حال ذخیره…', error: 'ذخیره نشد' }[saveState];
  const panel = element('annotations'); panel.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'annotation-empty';
    empty.textContent = 'علامت‌ها و یادداشت‌های شما اینجا دیده می‌شوند.'; panel.append(empty);
  }
  for (const item of [...items].sort((a, b) => a.page - b.page)) {
    const card = document.createElement('div'); card.className = 'annotation-card'; card.style.setProperty('--mark-color', item.color);
    card.dataset.annotationId = item.id; card.classList.toggle('is-active', activeAnnotationId === item.id);
    const jump = document.createElement('button'); jump.className = 'annotation-jump';
    jump.textContent = item.text || names[item.type];
    jump.addEventListener('click', async () => {
      activeAnnotationId = item.id;
      for (const row of panel.children) row.classList.toggle('is-active', row.dataset.annotationId === item.id);
      pdfSelection.clear(); getSelection()?.removeAllRanges();
      const reached = await annotationNavigator.jump(item);
      if (reached && item.type === 'note') openNote({ point: item.point, text: item.text, id: item.id });
    });
    const meta = document.createElement('span'); meta.className = 'annotation-meta'; meta.textContent = 'صفحهٔ ' + formatNumber(item.page) + ' · ' + names[item.type];
    const remove = document.createElement('button'); remove.className = 'annotation-remove'; remove.append(readerIcon('trash'));
    remove.setAttribute('aria-label', 'حذف ' + names[item.type]); remove.addEventListener('click', () => annotations.remove(item.id));
    card.append(jump, meta, remove); panel.append(card);
  }
}
function openNote(draft) {
  pdfSelection.clear();
  noteDraft = { ...draft, documentId, page: currentPage };
  element('note-text').value = draft.text || ''; element('note-text').readOnly = false;
  element('note-save').hidden = false; element('note-delete').hidden = !draft.id;
  element('note-dialog').querySelector('h2').textContent = 'یادداشت روی صفحه';
  element('note-dialog').showModal(); element('note-text').focus();
}
function openSourceNote(annotation) {
  pdfSelection.clear();
  noteDraft = null;
  element('note-text').value = annotation.contentsObj?.str || annotation.contents || '';
  element('note-text').readOnly = true; element('note-save').hidden = true; element('note-delete').hidden = true;
  element('note-dialog').querySelector('h2').textContent = 'یادداشت داخل PDF';
  element('note-dialog').showModal(); element('note-text').focus();
}
function closeNote() { noteDraft = null; if (element('note-dialog').open) element('note-dialog').close(); }

function captureViewAnchor(point) {
  if (!currentViewport) return pendingViewAnchor;
  const pane = scroller.getBoundingClientRect(), paper = stage.getBoundingClientRect();
  const x = point?.clientX ?? pane.left + scroller.clientWidth / 2;
  const y = point?.clientY ?? pane.top + scroller.clientHeight / 2;
  return { documentId, page: currentPage,
    point: currentViewport.convertToPdfPoint((x - paper.left) * currentViewport.width / paper.width,
      (y - paper.top) * currentViewport.height / paper.height),
    x: x - pane.left, y: y - pane.top };
}

function restoreViewAnchor(anchor, viewport) {
  if (anchor?.documentId !== documentId || anchor.page !== currentPage) {
    scroller.scrollTop = 0; scroller.scrollLeft = 0; return;
  }
  const [x, y] = viewport.convertToViewportPoint(...anchor.point);
  const pane = scroller.getBoundingClientRect(), paper = stage.getBoundingClientRect();
  scroller.scrollBy(paper.left + x - pane.left - anchor.x, paper.top + y - pane.top - anchor.y);
}

function cacheDatabase() {
  if (!cachePromise) cachePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('rastin-reader-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return cachePromise;
}
async function cacheRequest(mode, operation) {
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('documents', mode), request = operation(transaction.objectStore('documents'));
    let value; request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => resolve(value); transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || new Error('Document cache interrupted'));
  });
}
async function remember(record) {
  await cacheRequest('readwrite', store => store.put(record));
  const documents = await cacheRequest('readonly', store => store.getAll());
  let size = documents.reduce((total, item) => total + item.blob.size, 0), count = documents.length;
  for (const removed of documents.filter(item => item.id !== record.id).sort((a, b) => a.savedAt - b.savedAt)) {
    if (size <= MAX_CACHE_BYTES && count <= 10) break;
    await cacheRequest('readwrite', store => store.delete(removed.id)); size -= removed.blob.size; count--;
  }
}
async function fileIdentity(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function renderPage(number, { navigating = false, preservePosition = false, anchor } = {}) {
  if (!pdf || workspace.hidden) return;
  if (status.textContent === 'در حال بازکردن PDF…') notice('');
  if (!navigating) annotationNavigator.cancel();
  const activePdf = pdf;
  const pageNumber = Math.max(1, Math.min(activePdf.numPages, Math.trunc(Number(number)) || 1));
  const viewAnchor = pageNumber === currentPage && preservePosition ? anchor || captureViewAnchor() : null;
  pendingViewAnchor = viewAnchor;
  pdfSelection.setPage(null);
  const token = ++renderSequence;
  currentPage = pageNumber;
  annotations.setPage(pageNumber, null); currentViewport = null;
  stage.setAttribute('aria-busy', 'true');
  renderTask?.cancel(); textTask?.cancel();
  element('link-layer').replaceChildren();
  getSelection()?.removeAllRanges(); element('selection-bar').hidden = true;
  element('page-number').value = pageNumber;
  element('previous-page').disabled = pageNumber === 1; element('next-page').disabled = pageNumber === activePdf.numPages;
  element('page-indicator').textContent = formatNumber(pageNumber) + ' / ' + formatNumber(activePdf.numPages);
  element('clear-page').disabled = !annotations.getPageItems().length;
  for (const button of element('thumbnails').children) button.setAttribute('aria-current', Number(button.dataset.page) === pageNumber ? 'page' : 'false');
  let buffer = null;
  try {
    const page = await activePdf.getPage(pageNumber);
    if (token !== renderSequence || activePdf !== pdf) return;
    const pageRotation = (page.rotate + rotation) % 360, base = page.getViewport({ scale: 1, rotation: pageRotation });
    const paneSize = [scroller.clientWidth, scroller.clientHeight];
    const availableWidth = Math.max(160, scroller.clientWidth - 52), availableHeight = Math.max(180, scroller.clientHeight - 52);
    const zoom = element('zoom').value;
    let scale = Number(zoom) || availableWidth / base.width;
    if (zoom === 'page-fit') scale = Math.min(availableWidth / base.width, availableHeight / base.height);
    if (zoom === 'auto') scale = Math.min(1.35, availableWidth / base.width);
    scale = Math.max(0.1, Math.min(scale, 5));
    const viewport = page.getViewport({ scale, rotation: pageRotation });
    const density = Math.max(0.25, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height))));
    buffer = document.createElement('canvas'); buffer.width = Math.ceil(viewport.width * density); buffer.height = Math.ceil(viewport.height * density);
    const task = page.render({ canvasContext: buffer.getContext('2d'), viewport, transform: density === 1 ? null : [density, 0, 0, density, 0, 0], annotationMode: AnnotationMode.ENABLE, background: '#ffffff' });
    renderTask = task; await task.promise;
    if (token !== renderSequence || activePdf !== pdf) { buffer.width = buffer.height = 0; return; }
    const canvas = element('canvas'); canvas.width = buffer.width; canvas.height = buffer.height;
    canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
    canvas.getContext('2d').drawImage(buffer, 0, 0); buffer.width = buffer.height = 0;
    stage.style.width = viewport.width + 'px'; stage.style.height = viewport.height + 'px';
    stage.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
    stage.style.setProperty('--scale-round-x', '0.01px'); stage.style.setProperty('--scale-round-y', '0.01px');
    const layer = element('text-layer'); layer.replaceChildren();
    const text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
    textTask = text;
    try { await text.render(); } catch (error) { if (token === renderSequence && activePdf === pdf && error.name !== 'AbortException') layer.replaceChildren(); }
    if (token !== renderSequence || activePdf !== pdf) return;
    currentViewport = viewport; lastRenderedScale = viewport.scale;
    annotations.setPage(pageNumber, viewport); pdfSelection.setPage(viewport);
    renderedPaneSize = paneSize;
    stage.setAttribute('aria-busy', 'false');
    if (status.textContent === 'در حال بازکردن PDF…') notice('');
    restoreViewAnchor(viewAnchor, viewport); pendingViewAnchor = null;
    await renderLinks(page, viewport, token);
    if (token !== renderSequence || activePdf !== pdf) return;
    window.dispatchEvent(new Event('rastin-reader-content-ready'));
    void saveView();
  } catch (error) {
    if (token === renderSequence && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') {
      stage.setAttribute('aria-busy', 'false'); notice('این صفحه نمایش داده نشد. صفحهٔ دیگری را باز کنید یا فایل را دوباره انتخاب کنید.', 'error');
    }
  } finally { if (buffer) buffer.width = buffer.height = 0; }
}
async function renderLinks(page, viewport, token) {
  const layer = element('link-layer'); layer.replaceChildren();
  try {
    const links = await page.getAnnotations({ intent: 'display' });
    if (token !== renderSequence) return;
    for (const link of links) {
      const sourceNote = [AnnotationType.TEXT, AnnotationType.FREETEXT].includes(link.annotationType) && (link.contentsObj?.str || link.contents);
      if (link.annotationType !== AnnotationType.LINK && !sourceNote) continue;
      const a = viewport.convertToViewportPoint(link.rect[0], link.rect[1]), b = viewport.convertToViewportPoint(link.rect[2], link.rect[3]);
      let node;
      if (sourceNote) {
        node = document.createElement('button'); node.setAttribute('aria-label', 'خواندن یادداشت داخل PDF');
        node.title = link.contentsObj?.str || link.contents;
        node.addEventListener('click', () => openSourceNote(link));
      } else if (link.url) {
        const url = new URL(link.url); if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) continue;
        node = document.createElement('a'); node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer';
        node.setAttribute('aria-label', link.url); node.title = link.url;
      } else if (link.dest) {
        node = document.createElement('button'); node.setAttribute('aria-label', 'رفتن به صفحهٔ مقصد');
        node.addEventListener('click', async () => {
          const doc = pdf;
          try {
            const dest = typeof link.dest === 'string' ? await doc.getDestination(link.dest) : link.dest;
            const index = Number.isInteger(dest?.[0]) ? dest[0] : await doc.getPageIndex(dest[0]);
            if (doc === pdf) await renderPage(index + 1);
          } catch { notice('مقصد این پیوند در سند پیدا نشد.', 'warning'); }
        });
      } else continue;
      node.className = 'pdf-link'; Object.assign(node.style, { left: Math.min(a[0], b[0]) + 'px', top: Math.min(a[1], b[1]) + 'px', width: Math.abs(b[0] - a[0]) + 'px', height: Math.abs(b[1] - a[1]) + 'px' });
      layer.append(node);
    }
  } catch { /* A broken link annotation cannot prevent the page from being read. */ }
}
function buildThumbnails(doc, token) {
  thumbnailObserver?.disconnect(); thumbnailQueue = []; element('thumbnails').replaceChildren();
  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && !entry.target.dataset.queued) {
      entry.target.dataset.queued = 'true'; thumbnailQueue.push({ button: entry.target, doc, token }); thumbnailObserver.unobserve(entry.target);
    }
    void drainThumbnails();
  }, { root: element('thumbnails'), rootMargin: '100px' });
  for (let number = 1; number <= doc.numPages; number++) {
    const button = document.createElement('button'); button.className = 'thumbnail-button'; button.dataset.page = number;
    button.setAttribute('aria-label', 'صفحهٔ ' + formatNumber(number)); button.setAttribute('aria-current', number === currentPage ? 'page' : 'false');
    const placeholder = document.createElement('div'); placeholder.className = 'thumbnail-placeholder';
    const caption = document.createElement('span'); caption.textContent = formatNumber(number);
    button.append(placeholder, caption); button.addEventListener('click', () => renderPage(number));
    element('thumbnails').append(button); thumbnailObserver.observe(button);
  }
}
async function drainThumbnails() {
  if (thumbnailRunning) return;
  thumbnailRunning = true;
  try {
    while (thumbnailQueue.length) {
      const { button, doc, token } = thumbnailQueue.shift();
      if (doc !== pdf || token !== activeDocumentSequence) continue;
      try {
        const page = await doc.getPage(Number(button.dataset.page));
        if (doc !== pdf || token !== activeDocumentSequence) continue;
        const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 112 / base.width });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.style.height = viewport.height + 'px';
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport }); thumbnailTask = task; await task.promise;
        if (doc === pdf && token === activeDocumentSequence) button.firstChild.replaceWith(canvas);
      } catch { /* Thumbnails are optional; the main page still works. */ }
    }
  } finally { thumbnailRunning = false; }
}
async function saveView() {
  if (!documentId || !pdf) return;
  try { await chrome.storage.local.set({ ['rastin_pdf_view_' + documentId]: { page: currentPage, zoom: element('zoom').value, rotation } }); } catch {}
}
function closePassword() { passwordUpdate = null; element('password').value = ''; if (passwordDialog.open) passwordDialog.close(); }
function uploadProgress(message = '') {
  element('upload-status').hidden = !message;
  element('upload-message').textContent = message;
}
function cancelPendingOpen() {
  sourceRequest?.abort(); sourceRequest = null;
  const task = loadingTask; loadingTask = null;
  if (task) void task.destroy().catch(() => {});
  closePassword();
}
function cancelOpen() {
  ++sequence; cancelPendingOpen(); uploadProgress('');
  welcome.hidden = Boolean(pdf); workspace.hidden = !pdf;
  notice('بازکردن سند لغو شد. می‌توانید فایل دیگری انتخاب کنید.');
}
async function openDocument(bytes, name, { cached = false, token = ++sequence } = {}) {
  if (token !== sequence) return;
  annotationNavigator.cancel(); pdfSelection.clear();
  uploadProgress('در حال بازکردن PDF…');
  // Keep the current document intact until its annotations are safely written.
  // A failed write must never pair the next PDF with the previous document's marks.
  try { await annotations.flush(); }
  catch {
    if (token === sequence) notice('علامت‌های سند فعلی ذخیره نشدند؛ سند قبلی باز ماند تا گم نشوند. یک نسخهٔ PDF دانلود کنید و دوباره تلاش کنید.', 'error');
    if (token === sequence) uploadProgress('');
    return;
  }
  if (token !== sequence) return;
  element('file-access').hidden = true; closePassword(); closeNote();
  const pendingTask = loadingTask; loadingTask = null;
  if (pendingTask) await pendingTask.destroy().catch(() => {});
  if (token !== sequence) return;
  let cacheSaved = cached, candidateTask = null, annotationLoad = false, committed = false;
  try {
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error('file_size');
    const id = await fileIdentity(bytes); if (token !== sequence) return;
    const task = getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false, enableXfa: false,
      cMapUrl: assetUrl('cmaps'), cMapPacked: true, standardFontDataUrl: assetUrl('standard_fonts'), wasmUrl: assetUrl('wasm'), useWasm: true, canvasMaxAreaInBytes: 64000000 });
    candidateTask = task;
    loadingTask = task;
    task.onPassword = (update, reason) => {
      if (token !== sequence) return;
      passwordUpdate = update; element('password-message').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? 'رمز واردشده درست نیست. دوباره تلاش کنید.' : 'برای بازکردن این سند، رمز آن را وارد کنید.';
      element('password').value = ''; if (!passwordDialog.open) passwordDialog.showModal(); element('password').focus();
    };
    const doc = await task.promise;
    if (token !== sequence) { await task.destroy(); return; }
    closePassword();
    if (!cached) {
      try { await remember({ id, name, blob: new Blob([bytes], { type: 'application/pdf' }), savedAt: Date.now() }); cacheSaved = true; } catch {}
    }
    if (token !== sequence) { await task.destroy(); return; }
    let view;
    try { view = (await chrome.storage.local.get('rastin_pdf_view_' + id))['rastin_pdf_view_' + id]; } catch {}
    if (token !== sequence) { await task.destroy(); return; }
    annotationLoad = true;
    const loaded = await annotations.load(id, { isCurrent: () => token === sequence });
    if (!loaded || token !== sequence) { await task.destroy(); return; }
    annotationLoad = false;
    const previousTask = documentTask;
    ++renderSequence; renderTask?.cancel(); textTask?.cancel(); thumbnailTask?.cancel(); thumbnailObserver?.disconnect(); thumbnailQueue = [];
    pdf = doc; documentTask = task; if (loadingTask === task) loadingTask = null;
    documentId = id; originalBytes = new Uint8Array(bytes); filename = name; activeDocumentSequence = token; activeAnnotationId = null;
    committed = true; closeNote();
    const url = new URL(location.href); url.search = new URLSearchParams({ document: id }).toString(); url.hash = ''; history.replaceState(null, '', url);
    window.dispatchEvent(new Event('rastin-reader-document-changed'));
    element('filename').textContent = name; document.title = name + ' — راستین';
    element('page-count').textContent = formatNumber(doc.numPages) + ' صفحه · نمایش اصلی PDF';
    element('total-pages').textContent = 'از ' + formatNumber(doc.numPages); element('page-number').max = doc.numPages;
    rotation = [0, 90, 180, 270].includes(view?.rotation) ? view.rotation : 0;
    const validZoom = [...element('zoom').options].some(option => option.value === view?.zoom); element('zoom').value = validZoom ? view.zoom : 'auto';
    currentPage = Math.max(1, Math.min(doc.numPages, Math.trunc(Number(view?.page)) || 1)); welcome.hidden = true; workspace.hidden = false;
    lastRenderedScale = 1; pendingViewAnchor = null;
    document.body.classList.add('has-document'); setTool('select');
    currentViewport = null; annotations.setPage(currentPage, null); element('export-pdf').disabled = true; element('forget-file').hidden = true;
    if (previousTask && previousTask !== task) void previousTask.destroy().catch(() => {});
    buildThumbnails(doc, token); await renderPage(currentPage);
    if (token !== sequence) return;
    element('export-pdf').disabled = false; element('forget-file').hidden = !cacheSaved;
    if (stage.getAttribute('aria-busy') === 'false' && currentViewport) notice(cacheSaved ? '' : 'فایل باز شد، اما ذخیرهٔ محلی فایل ممکن نشد. برای بازکردن دوباره، همین PDF را انتخاب کنید.', 'warning');
    if (document.activeElement === element('file') || document.activeElement === document.body ||
        document.activeElement?.closest('#reader-open-file, #reader-open-file-welcome')) stage.focus({ preventScroll: true });
  } catch (error) {
    if (!committed && candidateTask) {
      if (loadingTask === candidateTask) loadingTask = null;
      await candidateTask.destroy().catch(() => {});
    }
    if (token !== sequence) return;
    closePassword(); welcome.hidden = Boolean(pdf); workspace.hidden = !pdf; document.body.classList.toggle('has-document', Boolean(pdf));
    if (annotationLoad) {
      notice(pdf ? 'بازیابی علامت‌ها از حافظهٔ مرورگر ممکن نشد؛ سند قبلی و علامت‌هایش باز ماندند. دوباره تلاش کنید.' : 'بازیابی علامت‌های این سند از حافظهٔ مرورگر ممکن نشد. فایل را دوباره انتخاب کنید.', 'error');
      return;
    }
    notice(error.message === 'file_size' ? 'یک فایل PDF با حجم کمتر از ۱۰۰ مگابایت انتخاب کنید.' : error.name === 'PasswordException' ? 'سند به رمز معتبر نیاز دارد. فایل را دوباره انتخاب کنید.' : 'این فایل PDF باز نشد. ممکن است فایل ناقص باشد یا PDF معتبری نباشد؛ فایل دیگری انتخاب کنید.', 'error');
  } finally { if (token === sequence) uploadProgress(''); }
}
async function chooseFile(file) {
  if (!file) return;
  const token = ++sequence;
  cancelPendingOpen(); notice(''); uploadProgress('در حال خواندن فایل…');
  try {
    if (!file.size || file.size > MAX_FILE_BYTES) {
      notice('فایل خالی است یا حجم آن بیشتر از ۱۰۰ مگابایت است. یک PDF معتبر انتخاب کنید.', 'error'); return;
    }
    // Validate the content as well as the extension. Local files often carry
    // an empty/generic MIME type, while an HTML download may be named .pdf.
    const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (token !== sequence) return;
    if (!/%PDF-\d\.\d/.test(String.fromCharCode(...header))) {
      notice('این فایل محتوای PDF ندارد. یک فایل PDF معتبر انتخاب کنید.', 'error'); return;
    }
    await window.RtlFixer?.readerReady;
    if (token !== sequence) return;
    const bytes = await file.arrayBuffer();
    if (token === sequence) await openDocument(bytes, file.name, { token });
  } catch { if (token === sequence) notice('خواندن این فایل ممکن نشد. آن را دوباره انتخاب کنید.', 'error'); }
  finally { if (token === sequence) uploadProgress(''); }
}
async function sourceDocument(source) {
  const token = ++sequence;
  cancelPendingOpen(); notice('');
  const request = new AbortController(); sourceRequest = request;
  try {
    const sourceUrl = new URL(source);
    if (!['http:', 'https:', 'file:'].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) throw new Error('unsupported_source');
    if (sourceUrl.protocol === 'file:' && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      notice('برای بازکردن مستقیم این مسیر، «Allow access to file URLs» را در تنظیمات افزونه فعال کنید؛ یا فایل را با دکمهٔ انتخاب فایل باز کنید.', 'warning'); element('file-access').hidden = false; return;
    }
    uploadProgress('در حال دریافت فایل PDF…');
    const response = await fetch(sourceUrl.href, { credentials: 'omit', signal: request.signal }); if (!response.ok) throw new Error('source_unavailable');
    if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('file_size');
    const bytes = await response.arrayBuffer(); let name;
    try { name = decodeURIComponent(sourceUrl.pathname.split('/').pop()) || 'document.pdf'; } catch { name = 'document.pdf'; }
    await openDocument(bytes, name, { token });
  } catch (error) {
    if (token !== sequence) return;
    notice(error.message === 'unsupported_source' ? 'این نشانی قابل بازکردن نیست. فایل PDF را از رایانه انتخاب کنید.' : error.message === 'file_size' ? 'برای این نمایشگر فایل PDF باید کمتر از ۱۰۰ مگابایت باشد.' : 'دریافت این فایل ممکن نشد. اگر سند به ورود به حساب نیاز دارد، آن را دانلود و با دکمهٔ انتخاب فایل باز کنید.', 'error');
  } finally {
    if (sourceRequest === request) sourceRequest = null;
    if (token === sequence) uploadProgress('');
  }
}

for (const button of document.querySelectorAll('.tool-button')) button.addEventListener('click', () => setTool(button.dataset.tool));
element('color').addEventListener('input', event => annotations.setColor(event.target.value));
element('width').addEventListener('change', event => annotations.setWidth(Number(event.target.value)));
element('undo').addEventListener('click', () => annotations.undo()); element('redo').addEventListener('click', () => annotations.redo());
element('clear-page').addEventListener('click', () => annotations.clearPage());
element('file').addEventListener('change', event => { void chooseFile(event.target.files[0]); event.target.value = ''; });
for (const id of ['open-file', 'open-file-welcome']) element(id).addEventListener('click', () => element('file').click());
element('cancel-load').addEventListener('click', cancelOpen);
element('previous-page').addEventListener('click', () => renderPage(currentPage - 1)); element('next-page').addEventListener('click', () => renderPage(currentPage + 1));
function commitPageNumber() {
  const input = element('page-number');
  const value = input.value.trim().replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
  const next = /^\d+$/.test(value) ? Math.max(1, Math.min(pdf?.numPages || 1, Number(value))) : currentPage;
  input.value = String(next);
  if (next !== currentPage) void renderPage(next);
}
element('page-number').addEventListener('change', commitPageNumber);
element('page-number').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    if (event.key === 'Enter') commitPageNumber();
    else element('page-number').value = String(currentPage);
    stage.focus({ preventScroll: true });
  }
});
function setZoom(value, anchor) {
  if (!pdf || ![...element('zoom').options].some(option => option.value === String(value))) return;
  element('zoom').value = String(value);
  void renderPage(currentPage, { preservePosition: true, anchor });
}
element('zoom').addEventListener('change', () => setZoom(element('zoom').value));
function changeZoom(direction, anchor) {
  if (!pdf) return;
  const levels = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
  // Further keystrokes must not be lost while PDF.js is still drawing.
  const scale = Number(element('zoom').value) || currentViewport?.scale || lastRenderedScale;
  const target = direction > 0 ? levels.find(value => value > scale + 0.01) || 5 : [...levels].reverse().find(value => value < scale - 0.01) || 0.1;
  if (Number(element('zoom').value) !== target) setZoom(String(target), anchor);
}
element('zoom-in').addEventListener('click', () => changeZoom(1)); element('zoom-out').addEventListener('click', () => changeZoom(-1));
function rotatePage() { if (!pdf) return; rotation = (rotation + 90) % 360; void renderPage(currentPage, { preservePosition: true }); }
element('rotate').addEventListener('click', rotatePage);
async function toggleFullscreen() {
  if (!pdf) return;
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await workspace.requestFullscreen(); } catch { notice('تمام‌صفحه در این مرورگر در دسترس نیست.', 'warning'); }
}
element('fullscreen').addEventListener('click', toggleFullscreen);
element('toggle-sidebar').addEventListener('click', () => { const hidden = workspace.classList.toggle('sidebar-hidden'); element('toggle-sidebar').setAttribute('aria-expanded', String(!hidden)); void renderPage(currentPage); });
function showSidebar(tab) {
  element('pages-tab').setAttribute('aria-selected', String(tab === 'pages')); element('notes-tab').setAttribute('aria-selected', String(tab === 'notes'));
  element('thumbnails').hidden = tab !== 'pages'; element('annotations').hidden = tab !== 'notes';
}
element('pages-tab').addEventListener('click', () => showSidebar('pages')); element('notes-tab').addEventListener('click', () => showSidebar('notes'));
document.addEventListener('selectionchange', showNativeSelection);
scroller.addEventListener('scroll', showNativeSelection, { passive: true });
for (const type of ['highlight', 'underline']) {
  const button = element(type + '-selection'); button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    const selected = pdfSelection.getSelection() || getSelection();
    markSelection(selected, type, selected?.toString().normalize('NFKC') || '');
    pdfSelection.clear(); getSelection()?.removeAllRanges(); element('selection-bar').hidden = true;
  });
}
element('selection-mode').addEventListener('change', event => pdfSelection.setMode(event.target.value));
element('copy-selection').addEventListener('pointerdown', event => event.preventDefault());
element('copy-selection').addEventListener('click', async () => {
  const text = pdfSelection.getText() || getSelection()?.toString().normalize('NFKC');
  if (!text) return;
  try { await navigator.clipboard.writeText(text); element('copy-selection').setAttribute('title', 'متن کپی شد'); }
  catch { notice('برای کپی متن انتخاب‌شده از Ctrl+C استفاده کنید.', 'warning'); }
});
for (const [buttonName, menuName] of [['more', 'document-menu'], ['help', 'help-menu']]) {
  const button = element(buttonName), menu = element(menuName);
  button.addEventListener('click', () => {
    const open = menu.hidden;
    for (const id of ['document-menu', 'help-menu']) element(id).hidden = true;
    for (const id of ['more', 'help']) element(id).setAttribute('aria-expanded', 'false');
    menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
  });
}
function closeMenus() { for (const [button, menu] of [['more', 'document-menu'], ['help', 'help-menu']]) { element(menu).hidden = true; element(button).setAttribute('aria-expanded', 'false'); } }
document.addEventListener('pointerdown', event => { if (!event.target.closest('.reader-menu-anchor')) closeMenus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(); });
element('note-form').addEventListener('submit', event => {
  event.preventDefault(); if (noteDraft?.documentId === documentId && noteDraft.page === currentPage) annotations.addNote({ ...noteDraft, text: element('note-text').value }); closeNote();
});
element('note-cancel').addEventListener('click', closeNote); element('note-dialog').addEventListener('cancel', () => { noteDraft = null; });
element('note-delete').addEventListener('click', () => { if (noteDraft?.documentId === documentId) annotations.remove(noteDraft.id); closeNote(); });
async function savePdf() {
  if (!pdf || !originalBytes || exporting) return;
  exporting = true; element('export-pdf').disabled = true;
  const activeId = documentId, bytes = originalBytes.slice(), items = annotations.getAll(), name = filename;
  notice('در حال ساخت PDF با علامت‌ها…');
  try {
    await annotations.flush().catch(() => {});
    const output = await exportAnnotatedPdf({ bytes, annotations: items, filename: name });
    const blobUrl = URL.createObjectURL(new Blob([output], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = blobUrl; a.download = name.replace(/\.pdf$/i, '') + '-annotated.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    if (activeId === documentId) notice('');
  } catch (error) { if (activeId === documentId) notice(error.message || 'خروجی PDF ساخته نشد. دوباره تلاش کنید.', 'error'); }
  finally { exporting = false; element('export-pdf').disabled = !pdf; }
}
element('export-pdf').addEventListener('click', savePdf);
element('settings').addEventListener('click', async () => { await window.RtlFixer?.readerReady; chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') + '?tabId=' + window.RtlFixer.readerTabId }); });
element('file-access').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }));
element('forget-file').addEventListener('click', async () => {
  const activeId = documentId; if (!activeId) return;
  try { await cacheRequest('readwrite', store => store.delete(activeId)); if (activeId === documentId) { element('forget-file').hidden = true; notice('نسخهٔ ذخیره‌شدهٔ فایل حذف شد. علامت‌ها باقی می‌مانند؛ برای بازکردن دوباره، همین فایل را انتخاب کنید.'); } }
  catch { notice('حذف نسخهٔ ذخیره‌شده ممکن نشد. دوباره تلاش کنید.', 'error'); }
});
element('password-form').addEventListener('submit', event => { event.preventDefault(); const update = passwordUpdate, value = element('password').value; closePassword(); update?.(value); });
function cancelPassword() { cancelOpen(); }
element('password-cancel').addEventListener('click', cancelPassword); passwordDialog.addEventListener('cancel', event => { event.preventDefault(); cancelPassword(); });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); document.body.classList.remove('dragging');
  if (event.dataTransfer.files.length !== 1) { notice('هر بار یک فایل PDF را رها کنید.', 'error'); return; }
  void chooseFile(event.dataTransfer.files[0]);
});
createReaderKeyboard({ document, isReady: () => Boolean(pdf) && !workspace.hidden,
  getPage: () => currentPage, getPageCount: () => pdf?.numPages || 0,
  goToPage: number => { void renderPage(number); }, zoomBy: changeZoom, setZoom,
  undo: () => annotations.undo(), redo: () => annotations.redo(), setTool,
  cancelSelection: () => { pdfSelection.clear(); getSelection()?.removeAllRanges(); },
  toggleFullscreen, rotate: rotatePage, openFile: () => element('file').click(), savePdf,
  focusPageNumber: () => { element('page-number').focus(); element('page-number').select(); },
  toggleHelp: () => element('help').click()
});
let wheelZoomAt = 0, wheelDelta = 0;
scroller.addEventListener('wheel', event => {
  if (!(event.ctrlKey || event.metaKey) || !pdf || document.querySelector('dialog[open]') || !event.deltaY) return;
  event.preventDefault();
  const now = performance.now();
  if (now - wheelZoomAt > 200 || Math.sign(wheelDelta) !== Math.sign(event.deltaY)) wheelDelta = 0;
  wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1);
  wheelZoomAt = now;
  if (Math.abs(wheelDelta) >= 40) { changeZoom(wheelDelta < 0 ? 1 : -1, captureViewAnchor(event)); wheelDelta = 0; }
}, { passive: false });
let resizeTimer;
const paneNeedsResize = () => renderedPaneSize?.[0] !== scroller.clientWidth ||
  element('zoom').value === 'page-fit' && renderedPaneSize?.[1] !== scroller.clientHeight;
const resizeObserver = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  if (!pdf || !currentViewport || Number(element('zoom').value) || !paneNeedsResize()) return;
  resizeTimer = setTimeout(() => {
    if (paneNeedsResize()) void renderPage(currentPage, { preservePosition: true });
  }, 180);
});
resizeObserver.observe(scroller);
window.RtlFixer.handleReaderCommand = async command => {
  if (command.action === 'openPaint') { if (!pdf) return { ok: false, error: 'ابتدا یک PDF باز کنید.' }; setTool('pen'); return { ok: true }; }
  if (command.action === 'clear_all_highlights') { annotations.clearPage(); return { success: true }; }
  if (command.action === 'scrollToHighlight') {
    const item = annotations.getAll().find(item => item.id === (command.id || command.highlightId));
    if (item) { pdfSelection.clear(); showSidebar('notes'); const found = await annotationNavigator.jump(item); return { success: true, found }; }
  }
  return null;
};
async function startup() {
  const token = ++sequence; await window.RtlFixer?.readerReady; if (token !== sequence) return;
  const params = new URLSearchParams(location.search), id = params.get('document');
  if (id) {
    if (!/^[a-f0-9]{64}$/.test(id)) { notice('شناسهٔ سند معتبر نیست. فایل PDF را دوباره انتخاب کنید.', 'error'); return; }
    try { const record = await cacheRequest('readonly', store => store.get(id)); if (record && token === sequence) { await openDocument(await record.blob.arrayBuffer(), record.name, { cached: true, token }); return; } } catch {}
    if (token === sequence) notice('نسخهٔ این سند در مرورگر پیدا نشد. برای بازیابی علامت‌ها و یادداشت‌ها، همان فایل PDF را انتخاب کنید.', 'warning'); return;
  }
  const source = params.get('file'); if (source) await sourceDocument(source);
}
pdfSelection.setMode(element('selection-mode').value); setTool('select'); startup();
