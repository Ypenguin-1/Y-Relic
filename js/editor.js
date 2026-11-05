// 編集画面：ページ・ボックス（テキスト/数式/画像）の配置、移動、リサイズ、履歴
import {
  MM_PX, pageSize, applyBoxStyle, renderMath, genId, DEFAULT_TEXT_HTML, sanitizeHtml, newDoc, normalizeDoc,
} from './docmodel.js';
import { showContextMenu, toast, confirmDialog, openDialog, openColorPopover, esc } from './ui.js';
import * as fmt from './textfmt.js';

const state = {
  doc: newDoc(),
  zoom: 1,
  active: null,
  readonly: false,
  guides: true,
  grid: false,
  undo: [],
  redo: [],
  mathEdit: null,
  dragging: false,
};
let scrollEl, pagesEl, plusEl, hooks = {};

export const getState = () => state;
export const findBox = (id) => state.doc.boxes.find((b) => b.id === id);
const boxEl = (id) => pagesEl.querySelector(`.box[data-id="${CSS.escape(id)}"]`);
const pageEl = (i) => pagesEl.querySelector(`.page[data-page="${i}"]`);
const scale = () => MM_PX * state.zoom;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const maxZ = () => state.doc.boxes.reduce((m, b) => Math.max(m, b.z || 0), 0);
const isEditableTarget = (t) => !!t?.closest?.('[contenteditable="true"], input, textarea, select, math-field');

/* =========================================================
   初期化・ロード
   ========================================================= */
export function initEditor(scroller, pages, h) {
  scrollEl = scroller;
  pagesEl = pages;
  hooks = h || {};
  pagesEl.addEventListener('pointerdown', onPointerDown);
  pagesEl.addEventListener('mousemove', onHover);
  pagesEl.addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('.ctx-menu')) hidePlus(); });
  pagesEl.addEventListener('input', onInput);
  pagesEl.addEventListener('contextmenu', onContext);
  pagesEl.addEventListener('dblclick', onDbl);
  pagesEl.addEventListener('paste', onPaste);
  pagesEl.addEventListener('keydown', onEditableKey);
  pagesEl.addEventListener('focusin', (e) => {
    const b = e.target.closest('.box');
    if (b && state.active !== b.dataset.id) setActive(b.dataset.id);
  });
  scrollEl.addEventListener('pointerdown', (e) => {
    if (e.target === scrollEl || e.target === pagesEl || e.target.classList.contains('page-wrap')) { setActive(null); blurEditing(); }
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onDocPaste);
  document.getElementById('imageInput').addEventListener('change', onImagePicked);
}

export function loadDoc(doc) {
  state.doc = normalizeDoc(doc);
  state.undo = [];
  state.redo = [];
  state.active = null;
  state.mathEdit = null;
  render();
  scrollEl.scrollTop = 0;
}

export function getDoc() {
  syncAll();
  return JSON.parse(JSON.stringify(state.doc));
}

export function isEmpty() {
  syncAll();
  return !state.doc.boxes.some((b) => (b.type === 'text' ? b.html.replace(/<[^>]*>|&nbsp;|​/g, '').trim() : b.type === 'math' ? b.latex : b.src));
}

function markDirty() { hooks.onDirty?.(); }

function syncAll() {
  if (!pagesEl) return;
  pagesEl.querySelectorAll('.box').forEach((el) => {
    const b = findBox(el.dataset.id);
    if (!b) return;
    if (b.type === 'text') { const c = el.querySelector('.tb-content'); if (c) b.html = c.innerHTML; }
    if (b.type === 'math') { const mf = el.querySelector('math-field'); if (mf) b.latex = mf.value; }
  });
}

/* =========================================================
   描画
   ========================================================= */
export function render() {
  const { w, h } = pageSize(state.doc.layout);
  const m = state.doc.layout.margins;
  pagesEl.innerHTML = '';
  pagesEl.classList.toggle('editable', !state.readonly);
  pagesEl.classList.toggle('no-guides', !state.guides || state.readonly);
  pagesEl.classList.toggle('show-grid', state.grid && !state.readonly);
  for (let i = 0; i < state.doc.pages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = i;
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.page = i;
    page.style.width = w + 'mm';
    page.style.height = h + 'mm';
    const guide = document.createElement('div');
    guide.className = 'page-guide';
    Object.assign(guide.style, { top: m.top + 'mm', left: m.left + 'mm', right: m.right + 'mm', bottom: m.bottom + 'mm' });
    page.append(guide);
    state.doc.boxes.filter((b) => b.page === i).sort((a, b) => a.z - b.z).forEach((b) => page.append(createBoxEl(b)));
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = `${i + 1} / ${state.doc.pages}`;
    wrap.append(page, label);
    pagesEl.append(wrap);
  }
  plusEl = createPlus();
  applyZoom();
  updateEmptyHint();
  if (state.active && !findBox(state.active)) state.active = null;
  if (state.active) boxEl(state.active)?.classList.add('active');
  hooks.onActive?.(state.active ? findBox(state.active) : null);
  requestAnimationFrame(() => pagesEl.querySelectorAll('.tb-content').forEach((ed) => fmt.refreshLayout(ed)));
  if (document.fonts?.ready) document.fonts.ready.then(() => pagesEl.querySelectorAll('.tb-content').forEach((ed) => fmt.refreshLayout(ed)));
}

function createBoxEl(box) {
  const el = document.createElement('div');
  el.className = `box box-${box.type}`;
  el.dataset.id = box.id;
  const body = document.createElement('div');
  body.className = 'box-body';
  if (box.type === 'text') {
    const c = document.createElement('div');
    c.className = 'tb-content';
    c.contentEditable = state.readonly ? 'false' : 'true';
    c.spellcheck = false;
    c.innerHTML = box.html || DEFAULT_TEXT_HTML;
    body.append(c);
  } else if (box.type === 'math') {
    const v = document.createElement('div');
    v.className = 'math-view';
    renderMath(v, box.latex, box.align);
    body.append(v);
  } else if (box.type === 'image') {
    const img = document.createElement('img');
    img.src = box.src || '';
    img.alt = '';
    img.draggable = false;
    body.append(img);
  }
  el.append(body);
  if (!state.readonly) {
    el.insertAdjacentHTML('beforeend',
      '<div class="box-grip" title="ドラッグで移動 / 右クリックでメニュー"><i class="fa-solid fa-grip-vertical"></i></div>'
      + ['n', 'e', 's', 'w'].map((d) => `<div class="box-edge ${d}"></div>`).join('')
      + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<div class="handle h-${d}" data-dir="${d}"></div>`).join(''));
  }
  applyBoxStyle(el, box);
  return el;
}

function applyZoom() {
  const { w, h } = pageSize(state.doc.layout);
  pagesEl.querySelectorAll('.page-wrap').forEach((wrap) => {
    wrap.style.width = (w * scale()).toFixed(2) + 'px';
    wrap.style.height = (h * scale()).toFixed(2) + 'px';
    wrap.querySelector('.page').style.transform = `scale(${state.zoom})`;
  });
  hooks.onZoom?.(state.zoom);
}

function updateEmptyHint() {
  pagesEl.querySelectorAll('.empty-hint').forEach((n) => n.remove());
  if (state.readonly || state.doc.boxes.length) return;
  const m = state.doc.layout.margins;
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.style.left = m.left + 'mm';
  hint.style.top = m.top + 'mm';
  hint.innerHTML = '<i class="fa-solid fa-arrow-pointer"></i> ページ上にカーソルを動かし「＋」からテキスト・数式・画像を追加';
  pageEl(0)?.append(hint);
}

/* =========================================================
   ズーム / 表示
   ========================================================= */
export function setZoom(z) {
  state.zoom = clamp(Math.round(z * 100) / 100, 0.25, 4);
  applyZoom();
}
export const getZoom = () => state.zoom;
export function zoomFit() {
  const { w } = pageSize(state.doc.layout);
  const avail = scrollEl.clientWidth - (window.innerWidth < 600 ? 16 : 48);
  setZoom(Math.max(0.25, avail / (w * MM_PX)));
}
export function setGuides(v) { state.guides = v; pagesEl.classList.toggle('no-guides', !v || state.readonly); }
export function setGrid(v) { state.grid = v; pagesEl.classList.toggle('show-grid', v && !state.readonly); }
export function setReadonly(v) {
  if (state.readonly === v) return;
  syncAll();
  state.readonly = v;
  state.active = null;
  render();
}

export function currentPage() {
  if (state.active) { const b = findBox(state.active); if (b) return b.page; }
  const vr = scrollEl.getBoundingClientRect();
  let best = 0, bestArea = -1;
  pagesEl.querySelectorAll('.page-wrap').forEach((w, i) => {
    const r = w.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top));
    if (a > bestArea) { bestArea = a; best = i; }
  });
  return best;
}

function scrollToPage(i) {
  const w = pagesEl.querySelector(`.page-wrap[data-page="${i}"]`);
  w?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =========================================================
   履歴（ボックス操作の元に戻す / やり直し）
   ========================================================= */
export function pushHistory() {
  syncAll();
  state.undo.push(JSON.stringify(state.doc));
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
}
const inText = () => document.activeElement?.closest?.('.tb-content[contenteditable="true"]');
export function undo() {
  if (inText()) { document.execCommand('undo'); return; }
  if (!state.undo.length) return;
  syncAll();
  state.redo.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(state.undo.pop());
  render();
  markDirty();
}
export function redo() {
  if (inText()) { document.execCommand('redo'); return; }
  if (!state.redo.length) return;
  syncAll();
  state.undo.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(state.redo.pop());
  render();
  markDirty();
}

/* =========================================================
   選択
   ========================================================= */
export function setActive(id) {
  if (state.mathEdit && state.mathEdit.box.id !== id) exitMathEdit(state.mathEdit.el, state.mathEdit.box);
  pagesEl.querySelectorAll('.box.active').forEach((b) => b.classList.remove('active'));
  state.active = id || null;
  if (id) boxEl(id)?.classList.add('active');
  hooks.onActive?.(id ? findBox(id) : null);
}
export const activeBox = () => (state.active ? findBox(state.active) : null);

function blurEditing() {
  const a = document.activeElement;
  if (a && pagesEl.contains(a)) a.blur();
}

/* =========================================================
   ＋ボタン（Note 風の追加）
   ========================================================= */
function createPlus() {
  const p = document.createElement('button');
  p.type = 'button';
  p.className = 'plus-btn';
  p.title = 'テキスト・数式・画像を追加';
  p.innerHTML = '<i class="fa-solid fa-plus"></i>';
  p.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  p.addEventListener('click', (e) => {
    e.stopPropagation();
    const page = +p.dataset.page, y = +p.dataset.y;
    const r = p.getBoundingClientRect();
    showContextMenu(r.right + 6, r.top, [
      { icon: 'fa-solid fa-font', label: 'テキスト', action: () => addBoxAt('text', page, y) },
      { icon: 'fa-solid fa-square-root-variable', label: '数式', action: () => addBoxAt('math', page, y) },
      { icon: 'fa-solid fa-image', label: '画像', action: () => pickImage(page, y) },
    ]);
  });
  pageEl(0)?.append(p);
  return p;
}
function hidePlus() { plusEl?.classList.remove('show'); }

function onHover(e) {
  if (state.readonly || state.dragging || !plusEl) return;
  if (e.target.closest('.plus-btn')) return;
  const page = e.target.closest('.page');
  if (!page || e.target.closest('.box')) { hidePlus(); return; }
  const { h } = pageSize(state.doc.layout);
  const m = state.doc.layout.margins;
  const rect = page.getBoundingClientRect();
  const y = (e.clientY - rect.top) / scale();
  if (y < m.top - 1 || y > h - m.bottom - 4) { hidePlus(); return; }
  if (plusEl.parentElement !== page) page.append(plusEl);
  const yy = Math.max(m.top, y - 3.5);
  plusEl.style.top = yy + 'mm';
  plusEl.style.left = Math.max(1, m.left - 9) + 'mm';
  plusEl.dataset.page = page.dataset.page;
  plusEl.dataset.y = yy.toFixed(2);
  plusEl.classList.add('show');
}

/* =========================================================
   ボックスの追加・削除
   ========================================================= */
export function addBoxAt(type, page, y, extra = {}) {
  if (state.readonly) return null;
  const L = state.doc.layout;
  const { w: pw, h: ph } = pageSize(L);
  const m = L.margins;
  const cw = Math.max(20, pw - m.left - m.right);
  pushHistory();
  const box = {
    id: genId(), type, page,
    x: extra.x ?? m.left, y: clamp(y, 0, ph - 8),
    w: type === 'image' ? Math.min(extra.w || 80, cw) : cw,
    h: type === 'text' ? 8 : type === 'math' ? 12 : (extra.h || 60),
    z: maxZ() + 1, bg: '', border: '', align: 'left',
  };
  if (type === 'text') box.html = extra.html || DEFAULT_TEXT_HTML;
  if (type === 'math') box.latex = extra.latex || '';
  if (type === 'image') box.src = extra.src || '';
  clampBox(box);
  state.doc.boxes.push(box);
  const el = createBoxEl(box);
  pageEl(page).append(el);
  hidePlus();
  updateEmptyHint();
  setActive(box.id);
  markDirty();
  if (type === 'text') {
    const c = el.querySelector('.tb-content');
    c.focus();
    const r = document.createRange(); r.selectNodeContents(c.firstChild || c); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  } else if (type === 'math' && !extra.noEdit) {
    enterMathEdit(el, box);
  }
  return box;
}

/** リボンからの挿入：表示中のページの、既存ボックスの下に配置 */
export function insertBoxAuto(type, extra = {}) {
  const pos = nextFreePosition();
  if (type === 'image') { pickImage(pos.page, pos.y); return null; }
  return addBoxAt(type, pos.page, pos.y, extra);
}

function nextFreePosition() {
  const { h } = pageSize(state.doc.layout);
  const m = state.doc.layout.margins;
  let page = currentPage();
  for (;;) {
    let y = m.top;
    pagesEl.querySelectorAll(`.page[data-page="${page}"] > .box`).forEach((el) => {
      const b = findBox(el.dataset.id);
      if (b) y = Math.max(y, b.y + el.offsetHeight / MM_PX + 2);
    });
    if (y <= h - m.bottom - 10) return { page, y };
    if (page >= state.doc.pages - 1) {
      addPage(page, { silent: true });
      return { page: page + 1, y: m.top };
    }
    page++;
  }
}

export function deleteBox(id) {
  const b = findBox(id);
  if (!b) return;
  pushHistory();
  state.doc.boxes = state.doc.boxes.filter((x) => x.id !== id);
  if (state.mathEdit?.box.id === id) state.mathEdit = null;
  boxEl(id)?.remove();
  if (state.active === id) setActive(null);
  updateEmptyHint();
  markDirty();
}

export function duplicateBox(id) {
  syncAll();
  const b = findBox(id);
  if (!b) return;
  pushHistory();
  const c = { ...JSON.parse(JSON.stringify(b)), id: genId(), x: b.x + 5, y: b.y + 5, z: maxZ() + 1 };
  clampBox(c);
  state.doc.boxes.push(c);
  pageEl(c.page).append(createBoxEl(c));
  requestAnimationFrame(() => { const ed = boxEl(c.id)?.querySelector('.tb-content'); if (ed) fmt.refreshLayout(ed); });
  setActive(c.id);
  markDirty();
}

function reorder(id, mode) {
  const b = findBox(id);
  if (!b) return;
  pushHistory();
  const list = state.doc.boxes.filter((x) => x.page === b.page).sort((a, c) => a.z - c.z);
  const i = list.indexOf(b);
  list.splice(i, 1);
  const j = { front: list.length, back: 0, forward: Math.min(list.length, i + 1), backward: Math.max(0, i - 1) }[mode];
  list.splice(j, 0, b);
  list.forEach((x, k) => { x.z = k + 1; const el = boxEl(x.id); if (el) el.style.zIndex = String(x.z); });
  markDirty();
}

function clampBox(box) {
  const { w, h } = pageSize(state.doc.layout);
  box.w = Math.min(box.w, w);
  box.h = Math.min(box.h, h);
  box.x = clamp(box.x, 0, w - box.w);
  box.y = clamp(box.y, 0, h - Math.min(box.h, h));
}

/* ---------- ボックスの見た目 ---------- */
function targetBoxes() {
  const b = activeBox();
  if (!b) { toast('対象のボックスを選択してください', 'info'); return null; }
  return b;
}
export function setBoxBg(color) {
  const b = targetBoxes();
  if (!b) return;
  pushHistory();
  b.bg = color || '';
  applyBoxStyle(boxEl(b.id), b);
  markDirty();
}
export function setBoxBorder(style) {
  const b = targetBoxes();
  if (!b) return;
  pushHistory();
  b.border = style === 'none' ? '' : `0.3mm ${style} #000000`;
  applyBoxStyle(boxEl(b.id), b);
  markDirty();
}
export function setMathAlign(align) {
  const b = activeBox();
  if (!b || b.type !== 'math') return false;
  pushHistory();
  b.align = align;
  const el = boxEl(b.id);
  const v = el.querySelector('.math-view');
  if (v) v.style.textAlign = align;
  markDirty();
  return true;
}

/* =========================================================
   ページ・レイアウト
   ========================================================= */
export function getLayout() { return JSON.parse(JSON.stringify(state.doc.layout)); }
export function setLayout(patch) {
  pushHistory();
  state.doc.layout = { ...state.doc.layout, ...patch, margins: { ...state.doc.layout.margins, ...(patch.margins || {}) } };
  state.doc.boxes.forEach(clampBox);
  render();
  markDirty();
}
export function addPage(after = currentPage(), { silent = false } = {}) {
  if (!silent) pushHistory();
  syncAll();
  state.doc.boxes.forEach((b) => { if (b.page > after) b.page++; });
  state.doc.pages++;
  render();
  markDirty();
  if (!silent) setTimeout(() => scrollToPage(after + 1), 30);
}
export async function deletePage(i = currentPage()) {
  if (state.doc.pages <= 1) { toast('最後のページは削除できません', 'info'); return; }
  const has = state.doc.boxes.some((b) => b.page === i);
  if (has && !(await confirmDialog('ページの削除', `${i + 1} ページ目を削除します。ページ上のボックスも削除されます。`, { okLabel: '削除', danger: true }))) return;
  pushHistory();
  state.doc.boxes = state.doc.boxes.filter((b) => b.page !== i);
  state.doc.boxes.forEach((b) => { if (b.page > i) b.page--; });
  state.doc.pages--;
  state.active = null;
  render();
  markDirty();
}
export const pageCount = () => state.doc.pages;

/* =========================================================
   ポインタ操作（移動・リサイズ）
   ========================================================= */
function onPointerDown(e) {
  if (state.readonly || e.button !== 0) return;
  if (e.target.closest('.plus-btn')) return;
  const el = e.target.closest('.box');
  if (!el) {
    if (e.target.closest('.page')) { setActive(null); blurEditing(); }
    return;
  }
  const box = findBox(el.dataset.id);
  if (!box) return;
  const handle = e.target.closest('.handle');
  if (handle) { e.preventDefault(); setActive(box.id); startResize(e, el, box, handle.dataset.dir); return; }
  if (e.target.closest('.box-grip, .box-edge')) { e.preventDefault(); blurEditing(); setActive(box.id); startMove(e, el, box); return; }
  if (box.type === 'image' || (box.type === 'math' && !el.classList.contains('editing'))) {
    e.preventDefault();
    const wasActive = state.active === box.id;
    blurEditing();
    setActive(box.id);
    startMove(e, el, box, () => { if (box.type === 'math' && wasActive) enterMathEdit(el, box); });
    return;
  }
  if (state.active !== box.id) setActive(box.id);
}

function startMove(e, el, box, onClick) {
  const s = scale();
  const sx = e.clientX, sy = e.clientY, bx = box.x, by = box.y;
  let moved = false;
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 3) return;
      moved = true;
      pushHistory();
      state.dragging = true;
      el.classList.add('dragging');
      hidePlus();
    }
    box.x = bx + dx / s;
    box.y = by + dy / s;
    el.style.left = box.x + 'mm';
    el.style.top = box.y + 'mm';
  };
  const up = (ev) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    state.dragging = false;
    el.classList.remove('dragging');
    if (moved) {
      relocatePage(el, box, ev);
      clampBox(box);
      applyBoxStyle(el, box);
      markDirty();
    } else onClick?.();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** ページをまたいでドラッグした場合、ボックスを移動先のページへ */
function relocatePage(el, box, ev) {
  const wraps = [...pagesEl.querySelectorAll('.page-wrap')];
  let idx = -1, best = Infinity;
  wraps.forEach((w, i) => {
    const r = w.getBoundingClientRect();
    const d = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
    if (d < best) { best = d; idx = i; }
  });
  if (idx < 0 || idx === box.page) return;
  const np = wraps[idx].querySelector('.page');
  const r = el.getBoundingClientRect();
  const pr = np.getBoundingClientRect();
  box.x = (r.left - pr.left) / scale();
  box.y = (r.top - pr.top) / scale();
  box.page = idx;
  np.append(el);
}

function startResize(e, el, box, dir) {
  const s = scale();
  const sx = e.clientX, sy = e.clientY;
  const o = { x: box.x, y: box.y, w: box.w, h: el.offsetHeight / MM_PX };
  const ratio = o.h / o.w;
  pushHistory();
  state.dragging = true;
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const target = e.target;
  const move = (ev) => {
    const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
    let { x, y, w, h } = o;
    if (dir.includes('e')) w = o.w + dx;
    if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
    if (dir.includes('s')) h = o.h + dy;
    if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }
    if (w < 5) { if (dir.includes('w')) x -= 5 - w; w = 5; }
    if (h < 4) { if (dir.includes('n')) y -= 4 - h; h = 4; }
    // 画像は四隅のドラッグで縦横比を維持（Shift で自由変形）
    if (box.type === 'image' && dir.length === 2 && !ev.shiftKey) {
      h = w * ratio;
      if (dir.includes('n')) y = o.y + (o.h - h);
    }
    Object.assign(box, { x, y, w, h });
    applyBoxStyle(el, box);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    state.dragging = false;
    clampBox(box);
    applyBoxStyle(el, box);
    const ed = el.querySelector('.tb-content');
    if (ed) fmt.refreshLayout(ed);
    markDirty();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/* =========================================================
   数式ボックス
   ========================================================= */
function enterMathEdit(el, box) {
  if (state.readonly || el.classList.contains('editing')) return;
  if (!customElements.get('math-field')) { latexDialog(box); return; }
  if (state.mathEdit && state.mathEdit.el !== el) exitMathEdit(state.mathEdit.el, state.mathEdit.box);
  el.classList.add('editing');
  const body = el.querySelector('.box-body');
  const view = body.querySelector('.math-view');
  const mf = document.createElement('math-field');
  mf.setAttribute('math-virtual-keyboard-policy', 'manual');
  view.hidden = true;
  body.append(mf);
  mf.value = box.latex || '';
  mf.addEventListener('input', () => { box.latex = mf.value; markDirty(); });
  mf.addEventListener('focusout', () => setTimeout(() => {
    if (!mf.isConnected || document.activeElement === mf || mf.contains(document.activeElement)) return;
    exitMathEdit(el, box);
  }, 180));
  mf.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); exitMathEdit(el, box); } });
  state.mathEdit = { el, box, mf };
  setTimeout(() => mf.focus(), 0);
}

function exitMathEdit(el, box) {
  const mf = el.querySelector('math-field');
  if (mf) { box.latex = mf.value; mf.remove(); }
  const view = el.querySelector('.math-view');
  if (view) { view.hidden = false; renderMath(view, box.latex, box.align); }
  el.classList.remove('editing');
  if (state.mathEdit?.el === el) state.mathEdit = null;
  try { window.mathVirtualKeyboard?.hide(); } catch { /* ignore */ }
}

/** 数式タブのボタン：編集中の数式に挿入。無ければ新しい数式ボックスを作る */
export function insertMath(latex) {
  const me = state.mathEdit;
  const doInsert = (mf) => { try { mf.insert(latex, { selectionMode: 'placeholder', format: 'latex' }); } catch { mf.value += latex; } mf.focus(); };
  if (me && me.mf.isConnected) { doInsert(me.mf); return; }
  const b = activeBox();
  if (b?.type === 'math') {
    if (!customElements.get('math-field')) { b.latex += latex; renderMath(boxEl(b.id).querySelector('.math-view'), b.latex, b.align); markDirty(); return; }
    enterMathEdit(boxEl(b.id), b);
    setTimeout(() => state.mathEdit && doInsert(state.mathEdit.mf), 40);
    return;
  }
  const nb = insertBoxAuto('math', { noEdit: !customElements.get('math-field'), latex: customElements.get('math-field') ? '' : latex });
  if (nb && customElements.get('math-field')) setTimeout(() => state.mathEdit && doInsert(state.mathEdit.mf), 40);
}

export function toggleMathKeyboard() {
  const kb = window.mathVirtualKeyboard;
  if (!kb) { toast('数式エディタを読み込めませんでした', 'error'); return; }
  if (!state.mathEdit) {
    const b = activeBox();
    if (b?.type === 'math') enterMathEdit(boxEl(b.id), b);
    else insertBoxAuto('math');
  }
  setTimeout(() => {
    state.mathEdit?.mf.focus();
    if (kb.visible) kb.hide(); else kb.show();
  }, 60);
}

export async function latexDialog(box = activeBox()) {
  if (!box || box.type !== 'math') {
    box = insertBoxAuto('math', { noEdit: true });
    if (!box) return;
  }
  const el = boxEl(box.id);
  if (state.mathEdit?.box.id === box.id) exitMathEdit(el, box);
  const r = await openDialog({
    title: 'LaTeX で編集',
    width: 560,
    content: `<label class="field"><span>LaTeX</span><textarea name="tex" rows="5" class="input" style="font-family:monospace">${esc(box.latex || '')}</textarea></label>
              <div class="math-preview" style="min-height:48px;border:1px dashed var(--border);border-radius:8px;padding:8px;background:#fff;color:#000"></div>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '適用', value: true, primary: true }],
    onOpen: (f) => {
      const pv = f.querySelector('.math-preview');
      const upd = () => renderMath(pv, f.tex.value, 'left');
      f.tex.addEventListener('input', upd);
      upd();
    },
    collect: (f) => f.tex.value,
  });
  if (!r.value) return;
  pushHistory();
  box.latex = r.data;
  renderMath(el.querySelector('.math-view'), box.latex, box.align);
  markDirty();
}

/* =========================================================
   画像
   ========================================================= */
let pendingImagePos = null;
export function pickImage(page, y) {
  pendingImagePos = { page, y };
  const input = document.getElementById('imageInput');
  input.value = '';
  input.click();
}

async function onImagePicked(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const pos = pendingImagePos || nextFreePosition();
  pendingImagePos = null;
  if (pos.replaceId) { await replaceImage(pos.replaceId, f); return; }
  await insertImageFile(f, pos.page, pos.y);
}

async function insertImageFile(file, page, y) {
  try {
    const { src, w, h } = await loadImage(file);
    const L = state.doc.layout;
    const { w: pw } = pageSize(L);
    const cw = pw - L.margins.left - L.margins.right;
    const bw = Math.min(cw, Math.max(20, (w / MM_PX) * 0.75), 120);
    addBoxAt('image', page, y, { src, w: bw, h: bw * (h / w) });
  } catch (err) {
    console.error(err);
    toast('画像を読み込めませんでした', 'error');
  }
}

async function replaceImage(id, file) {
  const b = findBox(id);
  if (!b) return;
  const { src, w, h } = await loadImage(file);
  pushHistory();
  b.src = src;
  b.h = b.w * (h / w);
  const el = boxEl(id);
  el.querySelector('img').src = src;
  applyBoxStyle(el, b);
  markDirty();
}

/** 画像を読み込み、保存容量を抑えるため長辺 1600px に縮小 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const w = img.naturalWidth || 300, h = img.naturalHeight || 200;
        const isVector = /svg|gif/.test(file.type);
        const MAX = 1600;
        if (isVector || (Math.max(w, h) <= MAX && dataUrl.length < 900_000)) { resolve({ src: dataUrl, w, h }); return; }
        const k = Math.min(1, MAX / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        let src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
        if (src.length > 1_500_000) {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          src = c.toDataURL('image/jpeg', 0.85);
        }
        resolve({ src, w: c.width, h: c.height });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   各種イベント
   ========================================================= */
function onInput(e) {
  const c = e.target.closest?.('.tb-content');
  if (!c) return;
  fmt.normalize(c);
  const b = findBox(c.closest('.box').dataset.id);
  if (b) b.html = c.innerHTML;
  markDirty();
}

function onEditableKey(e) {
  const c = e.target.closest?.('.tb-content');
  if (!c) return;
  // Tab でリストの階層を変更
  if (e.key === 'Tab') {
    const sel = getSelection();
    const n = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (el?.closest('li')) {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    } else {
      e.preventDefault();
      document.execCommand('insertText', false, '　');
    }
  }
  if (e.key === 'Escape') {
    const id = c.closest('.box').dataset.id;
    c.blur();
    setActive(id);
  }
}

function onDbl(e) {
  if (state.readonly) return;
  const el = e.target.closest('.box');
  if (!el) return;
  const b = findBox(el.dataset.id);
  if (b?.type === 'math') enterMathEdit(el, b);
  if (b?.type === 'image' && e.target.closest('.box-body')) { pendingImagePos = { replaceId: b.id }; const i = document.getElementById('imageInput'); i.value = ''; i.click(); }
}

function onContext(e) {
  if (state.readonly) return;
  const inContent = e.target.closest('.tb-content');
  const enc = e.target.closest('.enc');
  if (enc && inContent) { e.preventDefault(); fmt.editEnclosure(enc); return; }
  const ruby = e.target.closest('ruby');
  if (ruby && inContent) { e.preventDefault(); fmt.editRuby(ruby); return; }
  const el = e.target.closest('.box');
  if (!el) return;
  if (inContent && !e.target.closest('.box-edge, .box-grip')) return; // テキスト上はブラウザ標準メニュー
  e.preventDefault();
  const b = findBox(el.dataset.id);
  setActive(b.id);
  showBoxMenu(e.clientX, e.clientY, b);
}

export function showBoxMenu(x, y, b) {
  const items = [];
  if (b.type === 'math') {
    items.push({ icon: 'fa-solid fa-pen', label: '数式を編集', action: () => enterMathEdit(boxEl(b.id), b) });
    items.push({ icon: 'fa-solid fa-code', label: 'LaTeX で編集', action: () => latexDialog(b) });
    items.push('-');
  }
  if (b.type === 'image') {
    items.push({ icon: 'fa-solid fa-image', label: '画像を置き換え', action: () => { pendingImagePos = { replaceId: b.id }; const i = document.getElementById('imageInput'); i.value = ''; i.click(); } });
    items.push('-');
  }
  items.push(
    { icon: 'fa-solid fa-angles-up', label: '最前面へ移動', action: () => reorder(b.id, 'front') },
    { icon: 'fa-solid fa-angle-up', label: '前面へ移動', action: () => reorder(b.id, 'forward') },
    { icon: 'fa-solid fa-angle-down', label: '背面へ移動', action: () => reorder(b.id, 'backward') },
    { icon: 'fa-solid fa-angles-down', label: '最背面へ移動', action: () => reorder(b.id, 'back') },
    '-',
    { icon: 'fa-solid fa-fill-drip', label: 'ボックスの色…', action: () => {
      const anchor = boxEl(b.id);
      openColorPopover(anchor, { current: b.bg || '#ffffff', allowNone: true, noneLabel: '塗りつぶしなし', onPick: (c) => setBoxBg(c) });
    } },
    { icon: 'fa-regular fa-clone', label: '複製', action: () => duplicateBox(b.id) },
    '-',
    { icon: 'fa-solid fa-trash', label: '削除', danger: true, action: () => deleteBox(b.id) },
  );
  showContextMenu(x, y, items);
}

function onPaste(e) {
  const dt = e.clipboardData;
  if (!dt) return;
  const c = e.target.closest?.('.tb-content');
  const file = [...(dt.files || [])].find((f) => f.type.startsWith('image/'));
  if (file && !dt.getData('text/plain')) {
    e.preventDefault();
    const b = c ? findBox(c.closest('.box').dataset.id) : null;
    const pos = b ? { page: b.page, y: b.y + 10 } : nextFreePosition();
    insertImageFile(file, pos.page, pos.y);
    return;
  }
  if (c) {
    const html = dt.getData('text/html');
    if (html) {
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitizeHtml(html, { stripClasses: true }));
    }
  }
}

function onDocPaste(e) {
  if (state.readonly || !hooks.isVisible?.()) return;
  if (isEditableTarget(e.target) || pagesEl.contains(e.target)) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  const pos = nextFreePosition();
  insertImageFile(file, pos.page, pos.y);
}

function onKey(e) {
  if (!hooks.isVisible?.() || state.readonly) return;
  if (document.querySelector('.modal-backdrop')) return;
  const inEdit = isEditableTarget(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  if (!inEdit && state.active) {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteBox(state.active); return; }
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const b = activeBox();
      pushHistory();
      b.x += d[0]; b.y += d[1];
      clampBox(b);
      applyBoxStyle(boxEl(b.id), b);
      markDirty();
      return;
    }
    if (e.key === 'Enter') {
      const b = activeBox();
      if (b.type === 'text') { e.preventDefault(); boxEl(b.id).querySelector('.tb-content').focus(); }
      if (b.type === 'math') { e.preventDefault(); enterMathEdit(boxEl(b.id), b); }
      return;
    }
    if (e.key === 'Escape') { setActive(null); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateBox(state.active); return; }
  }
  if (ctrl && !inEdit && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (ctrl && !inEdit && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
}
