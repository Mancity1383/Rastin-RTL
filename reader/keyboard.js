const TOOLS = Object.freeze({ v: 'select', h: 'highlight', u: 'underline', p: 'pen', r: 'rect', n: 'note', e: 'erase' });
const EDITABLE = 'input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"]';
const NAVIGATION_WIDGET = '[role="slider"], [role="listbox"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="tablist"]';

function editable(node) {
  if (!node || typeof node.closest !== 'function') return false;
  if (node.isContentEditable || node.closest(EDITABLE)) return true;
  // Use the nearest explicit editing host so contenteditable="false" islands
  // keep their own keyboard behavior. This also handles plaintext-only hosts.
  const host = node.closest('[contenteditable]');
  return Boolean(host && host.getAttribute('contenteditable') !== 'false');
}

function letterFor(event) {
  const key = String(event.key || '').toLowerCase();
  // Latin layouts follow the printed key; Persian layouts use the physical
  // letter key, so undo and tools continue to work without changing layouts.
  if (/^[a-z]$/.test(key)) return key;
  return /^Key[A-Z]$/.test(event.code || '') ? event.code.slice(3).toLowerCase() : '';
}

function zoomDirection(event) {
  if (['+', '='].includes(event.key) || ['Equal', 'NumpadAdd'].includes(event.code)) return 1;
  if (event.key === '-' || event.key === '_' && event.shiftKey || ['Minus', 'NumpadSubtract'].includes(event.code)) return -1;
  return 0;
}

/** Reader shortcuts deliberately leave editing, IME, dialogs and browser Alt shortcuts alone. */
export function createReaderKeyboard({ document: doc, isReady, getPage, getPageCount,
  goToPage, zoomBy, undo, redo, setTool, cancelSelection, toggleFullscreen, openFile, savePdf, setZoom,
  focusPageNumber, rotate, toggleHelp }) {
  function keyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.altKey) return;
    const target = event.composedPath?.().find(node => typeof node?.closest === 'function') || event.target;
    if (editable(target) || editable(doc.activeElement) ||
      doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden]):not([aria-hidden="true"])')) return;

    const command = event.ctrlKey || event.metaKey;
    const letter = letterFor(event);
    function run(action, { repeat = true } = {}) {
      if (typeof action !== 'function') return;
      event.preventDefault();
      if (repeat || !event.repeat) action();
    }
    if (command && letter === 'o' && !event.shiftKey) {
      run(openFile, { repeat: false });
      return;
    }
    if (!isReady()) return;

    if (command) {
      if (letter === 'z') run(event.shiftKey ? redo : undo);
      else if (letter === 'y' && !event.shiftKey) run(redo);
      else if (letter === 's' && !event.shiftKey) run(savePdf, { repeat: false });
      else if (letter === 'g' && !event.shiftKey) run(focusPageNumber, { repeat: false });
      else if (zoomDirection(event)) run(() => zoomBy(zoomDirection(event)));
      else if (!event.shiftKey && (['0', '۰', '٠'].includes(event.key) || event.code === 'Digit0')) run(setZoom && (() => setZoom('page-fit')));
      else if (!event.shiftKey && (['1', '۱', '١'].includes(event.key) || event.code === 'Digit1')) run(setZoom && (() => setZoom('1')));
      return;
    }

    const direction = zoomDirection(event);
    if (direction) { run(() => zoomBy(direction)); return; }
    if (event.key === 'F1' || event.key === '?') { run(toggleHelp, { repeat: false }); return; }
    // Shift+arrows belongs to selecting text; shifted letters are not tools.
    if (event.shiftKey) {
      if (letter === 'r') run(rotate, { repeat: false });
      return;
    }
    if (event.key === 'Escape') {
      run(() => { cancelSelection?.(); setTool('select'); }, { repeat: false });
      return;
    }
    // Composite controls keep native arrow/Home/End navigation. Ordinary
    // toolbar buttons can retain focus after a click without blocking reading.
    if (target?.closest?.(NAVIGATION_WIDGET) || doc.activeElement?.closest?.(NAVIGATION_WIDGET)) return;
    let page;
    if (['ArrowDown', 'ArrowLeft', 'PageDown'].includes(event.key)) page = getPage() + 1;
    else if (['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key)) page = getPage() - 1;
    else if (event.key === 'Home') page = 1;
    else if (event.key === 'End') page = getPageCount();
    if (page !== undefined) {
      run(() => {
        const last = getPageCount();
        if (!Number.isInteger(last) || last < 1 || !Number.isFinite(page)) return;
        const next = Math.max(1, Math.min(last, page));
        if (next !== getPage()) goToPage(next);
      }, { repeat: false });
      return;
    }
    if (TOOLS[letter]) run(() => setTool(TOOLS[letter]), { repeat: false });
    else if (letter === 'f') run(toggleFullscreen, { repeat: false });
    else if (letter === 'w') run(setZoom && (() => setZoom('page-width')), { repeat: false });
  }

  doc.addEventListener('keydown', keyDown);
  return { destroy() { doc.removeEventListener('keydown', keyDown); } };
}
