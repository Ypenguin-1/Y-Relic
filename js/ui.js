// 汎用 UI 部品：トースト / ダイアログ / コンテキストメニュー / ドロップダウン / カラーピッカー

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- トースト ---------- */
export function toast(message, type = 'info', ms = 2800) {
  const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, ms);
}

/* ---------- ダイアログ ---------- */
/**
 * @param {{title:string, content?:string|Node, buttons?:{label:string,value:any,primary?:boolean,danger?:boolean}[], width?:number, onOpen?:(root:HTMLElement)=>void, collect?:(root:HTMLElement)=>any}} opts
 * @returns {Promise<{value:any, data:any}>}
 */
export function openDialog({ title, content = '', buttons = [{ label: 'OK', value: true, primary: true }], width, onOpen, collect }) {
  return new Promise((resolve) => {
    closeMenus();
    const prevFocus = document.activeElement;
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" novalidate>
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close title="閉じる"><i class="fa-solid fa-xmark"></i></button></header>
        <div class="modal-body"></div>
        <footer></footer>
      </form>`;
    const form = bd.querySelector('form');
    if (width) form.style.maxWidth = width + 'px';
    const body = bd.querySelector('.modal-body');
    if (typeof content === 'string') body.innerHTML = content; else if (content) body.append(content);
    const footer = bd.querySelector('footer');
    let primaryValue = null;
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = b.primary ? 'submit' : 'button';
      btn.className = `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`;
      btn.textContent = b.label;
      if (b.primary) primaryValue = b.value;
      btn.addEventListener('click', (e) => { if (!b.primary) { e.preventDefault(); finish(b.value); } });
      footer.append(btn);
    });
    const finish = (value) => {
      if (value !== null && value !== undefined && value !== false && collect) {
        const data = collect(form);
        if (data === undefined) return; // バリデーション失敗時は閉じない
        cleanup();
        resolve({ value, data });
        return;
      }
      cleanup();
      resolve({ value, data: null });
    };
    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      bd.remove();
      if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(primaryValue ?? true); });
    bd.querySelector('[data-close]').addEventListener('click', () => finish(null));
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) finish(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(bd);
    onOpen?.(form);
    const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea') || form.querySelector('footer .primary');
    setTimeout(() => { first?.focus(); if (first?.select && first.type === 'text') first.select(); }, 20);
  });
}

export async function promptDialog(title, label, value = '', { placeholder = '', okLabel = 'OK', type = 'text', attrs = '' } = {}) {
  const r = await openDialog({
    title,
    content: `<label class="field"><span>${esc(label)}</span><input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}></label>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: okLabel, value: true, primary: true }],
    collect: (f) => f.v.value,
  });
  return r.value ? r.data : null;
}

export async function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  const r = await openDialog({
    title,
    content: `<p class="msg">${esc(message)}</p>`,
    buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: true, danger }],
  });
  return !!r.value;
}

/* ---------- メニュー ---------- */
let openMenu = null;
export function closeMenus() {
  if (openMenu) { openMenu.remove?.(); openMenu = null; }
  $$('.dd-menu.open').forEach((m) => m.classList.remove('open'));
  $$('.color-pop').forEach((p) => p.remove());
}
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ctx-menu, .dd-menu, .color-pop, [data-dd], [data-color]')) return;
  closeMenus();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
window.addEventListener('resize', () => closeMenus());

function placeFixed(el, x, y, anchorH = 0) {
  el.style.left = '0px'; el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(x, vw - r.width - 8);
  let top = y;
  if (top + r.height > vh - 8) top = Math.max(8, y - r.height - anchorH);
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = top + 'px';
}

/**
 * @param {number} x @param {number} y
 * @param {({icon?:string,label:string,action:()=>void,danger?:boolean,disabled?:boolean}|'-')[]} items
 */
export function showContextMenu(x, y, items) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  items.forEach((it) => {
    if (it === '-') { m.insertAdjacentHTML('beforeend', '<div class="dd-sep"></div>'); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dd-item' + (it.danger ? ' danger' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = `<i class="${it.icon || 'fa-solid fa-circle-dot'}"></i><span>${esc(it.label)}</span>`;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { closeMenus(); it.action(); });
    m.append(b);
  });
  document.body.append(m);
  placeFixed(m, x, y);
  openMenu = m;
}

/** リボン内の [data-dd] ボタンとドロップダウンを接続 */
export function bindDropdowns(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dd]');
    if (!btn) return;
    const menu = document.getElementById(btn.dataset.dd);
    if (!menu) return;
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (wasOpen) return;
    menu.classList.add('open');
    const r = btn.getBoundingClientRect();
    placeFixed(menu, r.left, r.bottom + 4, r.height + 8);
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('.dd-menu [data-cmd]')) closeMenus();
  });
}

/* ---------- カラーピッカー（RGB 任意色） ---------- */
const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#12c2d4', '#0e9fae', '#e3f8fa', '#fff8c5', '#ffe0e0', '#e0f0ff', '#e8ffe0', '#f3e8ff', '#fff0e0', '#f0f0f0',
];

const hex2 = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
export function rgbToHex(r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); }
export function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

/**
 * @param {HTMLElement} anchor
 * @param {{current?:string, allowNone?:boolean, noneLabel?:string, onPick:(color:string|null)=>void}} opts
 */
export function openColorPopover(anchor, { current = '#000000', allowNone = false, noneLabel = 'なし', onPick }) {
  closeMenus();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  const rgb = hexToRgb(current) || [0, 0, 0];
  pop.innerHTML = `
    <div class="swatches">${PALETTE.map((c) => `<button type="button" class="sw" style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')}</div>
    <div class="cp-row"><input type="color" value="${rgbToHex(...rgb)}" title="その他の色"><input type="text" class="hex" value="${rgbToHex(...rgb)}" maxlength="7" title="HEX"></div>
    <div class="cp-row">R<input type="number" min="0" max="255" class="r" value="${rgb[0]}">G<input type="number" min="0" max="255" class="g" value="${rgb[1]}">B<input type="number" min="0" max="255" class="b" value="${rgb[2]}"></div>
    <div class="cp-row"><button type="button" class="btn small primary apply" style="flex:1"><i class="fa-solid fa-check"></i>この色を適用</button></div>
    ${allowNone ? `<button type="button" class="btn small cp-none"><i class="fa-solid fa-ban"></i>${esc(noneLabel)}</button>` : ''}`;
  const color = pop.querySelector('input[type=color]');
  const hex = pop.querySelector('.hex');
  const [ri, gi, bi] = ['.r', '.g', '.b'].map((s) => pop.querySelector(s));
  const syncFromHex = (h) => { const v = hexToRgb(h); if (!v) return; color.value = rgbToHex(...v); hex.value = color.value; [ri.value, gi.value, bi.value] = v; };
  color.addEventListener('input', () => syncFromHex(color.value));
  hex.addEventListener('input', () => { const v = hex.value.startsWith('#') ? hex.value : '#' + hex.value; if (hexToRgb(v)) syncFromHex(v); });
  [ri, gi, bi].forEach((i) => i.addEventListener('input', () => syncFromHex(rgbToHex(+ri.value, +gi.value, +bi.value))));
  const pick = (c) => { closeMenus(); onPick(c); };
  pop.querySelectorAll('.sw').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => pick(b.dataset.c));
  });
  pop.querySelector('.apply').addEventListener('click', () => pick(color.value));
  pop.querySelector('.cp-none')?.addEventListener('click', () => pick(null));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  placeFixed(pop, r.left, r.bottom + 4, r.height + 8);
}

/** 画像（Relic_icon.svg）が無い場合のフォールバック表示 */
export function bindBrandFallback() {
  $$('img[data-fallback]').forEach((img) => {
    const mark = img.closest('.brand-mark');
    const fail = () => mark?.classList.add('no-img');
    if (img.complete && img.naturalWidth === 0) fail();
    img.addEventListener('error', fail);
  });
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
