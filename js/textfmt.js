// テキストボックス内の書式操作
import { FONTS, FONT_SIZES, fontIndexFromFamily } from './docmodel.js';
import { toast, promptDialog, openDialog, esc } from './ui.js';

let lastRange = null;
let lastEditable = null;
const listeners = new Set();

export const onSelectionFormat = (fn) => listeners.add(fn);

const editableOf = (node) => {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return el?.closest?.('.tb-content[contenteditable="true"]') || null;
};

document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const ed = editableOf(r.commonAncestorContainer);
  if (!ed) return;
  lastRange = r.cloneRange();
  lastEditable = ed;
  listeners.forEach((fn) => fn());
});

export function getEditable() {
  return lastEditable && lastEditable.isConnected ? lastEditable : null;
}
export function forget() { lastEditable = null; lastRange = null; }

/** リボン操作の前に、最後のテキスト選択範囲へフォーカスを戻す */
export function restore() {
  const ed = getEditable();
  if (!ed) return null;
  const sel = getSelection();
  const inside = sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer);
  if (document.activeElement !== ed) ed.focus({ preventScroll: true });
  if (!inside && lastRange && ed.contains(lastRange.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(lastRange);
  }
  return ed;
}

function need() {
  const ed = restore();
  if (!ed) toast('テキストボックス内にカーソルを置いてから操作してください', 'info');
  return ed;
}

export function fire(ed) {
  normalize(ed);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- 選択範囲の保存/復元（DOM 変更をまたいで） ---------- */
function saveSel() {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset };
}
const nodeLen = (n) => (n.nodeType === 3 ? n.length : n.childNodes.length);
function restoreSel(v, map) {
  if (!v) return;
  const sc = map?.get(v.sc) || v.sc;
  const ec = map?.get(v.ec) || v.ec;
  if (!sc.isConnected || !ec.isConnected) return;
  try {
    const r = document.createRange();
    r.setStart(sc, Math.min(v.so, nodeLen(sc)));
    r.setEnd(ec, Math.min(v.eo, nodeLen(ec)));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    lastRange = r.cloneRange();
  } catch { /* ignore */ }
}

/* ---------- execCommand ラッパ ---------- */
export function exec(cmd, value = null) {
  const ed = need();
  if (!ed) return false;
  // 指数・添え字は <sup>/<sub> タグで（行の 1/2 サイズで上半分/下半分に表示）
  const useTags = cmd === 'superscript' || cmd === 'subscript';
  document.execCommand('styleWithCSS', false, !useTags);
  document.execCommand(cmd, false, value);
  document.execCommand('styleWithCSS', false, true);
  fire(ed);
  return true;
}

/*
 * フォント名・サイズ・横方向の拡大縮小は execCommand('fontName') に目印の値を渡して <font> を作らせ、
 * 直後に <span style> へ変換する（カーソル位置だけの場合も、次に入力した文字に適用される）。
 */
function sentinel(key, value) {
  const ed = need();
  if (!ed) return false;
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontName', false, `rlx-${key}-${String(value).replace('.', '_')}`);
  document.execCommand('styleWithCSS', false, true);
  fire(ed);
  return true;
}

const unwrap = (el) => { el.replaceWith(...el.childNodes); };

function convertSentinels(ed) {
  const fonts = ed.querySelectorAll('font[face*="rlx-"]');
  const spans = ed.querySelectorAll('span[style*="rlx-"]');
  if (!fonts.length && !spans.length) return false;
  const saved = saveSel();
  const map = new Map();
  const convert = (el, raw) => {
    const mm = /rlx-(fs|ff|hs)-([0-9_]+)/.exec(String(raw));
    if (!mm) return;
    const key = mm[1], val = mm[2].replace('_', '.');
    const span = document.createElement('span');
    if (el.tagName === 'SPAN') span.setAttribute('style', el.getAttribute('style') || '');
    span.style.removeProperty('font-family');
    if (el.tagName === 'FONT' && el.getAttribute('color')) span.style.color = el.getAttribute('color');
    span.append(...el.childNodes);
    if (key === 'fs') {
      span.style.fontSize = val + 'pt';
      span.querySelectorAll('[style*="font-size"]').forEach((n) => n.style.removeProperty('font-size'));
      span.querySelectorAll('font[size]').forEach((n) => n.removeAttribute('size'));
    } else if (key === 'ff') {
      const f = FONTS[+val] || FONTS[0];
      span.style.fontFamily = f.stack;
      span.querySelectorAll('[style*="font-family"]').forEach((n) => n.style.removeProperty('font-family'));
      span.querySelectorAll('font[face]').forEach((n) => n.removeAttribute('face'));
    } else if (key === 'hs') {
      span.querySelectorAll('.hscale').forEach(unwrap);
      const s = +val;
      if (s && s !== 1) {
        span.className = 'hscale';
        span.dataset.scale = String(s);
      }
    }
    el.replaceWith(span);
    map.set(el, span);
    if (!span.getAttribute('style') && !span.className) { map.set(el, span.parentNode); }
  };
  fonts.forEach((f) => convert(f, f.getAttribute('face')));
  spans.forEach((s) => convert(s, s.style.fontFamily));
  // 空の span を整理
  ed.querySelectorAll('span:not([class]):not([style])').forEach((s) => { if (!s.attributes.length) unwrap(s); });
  restoreSel(saved, map);
  return true;
}

export function updateHScales(root) {
  root.querySelectorAll('.hscale').forEach((el) => {
    const s = parseFloat(el.dataset.scale) || 1;
    el.style.display = 'inline-block';
    el.style.transform = `scaleX(${s})`;
    el.style.transformOrigin = 'left center';
    el.style.marginRight = '0px';
    const w = el.offsetWidth;
    if (w) el.style.marginRight = ((s - 1) * w).toFixed(2) + 'px';
  });
}

/** 入力ごとに呼ばれる整形 */
export function normalize(ed) {
  convertSentinels(ed);
  updateHScales(ed);
}

/** 描画直後のレイアウト再計算 */
export function refreshLayout(ed) {
  updateHScales(ed);
  ed.querySelectorAll('.enc').forEach(layoutEnclosure);
}

/* ---------- フォント ---------- */
export const setFontSize = (pt) => {
  const v = Math.round(parseFloat(pt) * 2) / 2;
  if (!(v >= 1 && v <= 400)) { toast('フォントサイズは 1〜400pt で指定してください', 'error'); return; }
  sentinel('fs', v);
  refreshEnclosuresSoon();
};
export const setFontFamily = (idx) => sentinel('ff', idx);
export const setHScale = (s) => sentinel('hs', s);

export function stepFontSize(dir) {
  const st = queryState();
  const cur = st?.size || 10.5;
  let next;
  if (dir > 0) next = FONT_SIZES.find((s) => s > cur) || cur + 2;
  else next = [...FONT_SIZES].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
  setFontSize(next);
}

function refreshEnclosuresSoon() {
  const ed = getEditable();
  if (ed) requestAnimationFrame(() => { ed.querySelectorAll('.enc').forEach(layoutEnclosure); fire(ed); });
}

export const setForeColor = (c) => exec('foreColor', c);
export const setHilite = (c) => exec('hiliteColor', c || 'transparent');

export function clearFormat() {
  const ed = need();
  if (!ed) return;
  document.execCommand('removeFormat');
  // removeFormat で消えないスタイルも除去
  const r = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
  if (r && !r.collapsed) {
    ed.querySelectorAll('span[style], font, .hscale').forEach((s) => {
      if (r.intersectsNode(s) && !s.closest('.enc')) unwrap(s);
    });
  }
  fire(ed);
}

/* ---------- 段落 ---------- */
const BLOCK_RE = /^(DIV|P|UL|OL|HR|H[1-6]|BLOCKQUOTE|TABLE|PRE)$/;

function wrapLooseInline(ed) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const d = document.createElement('div');
    run[0].before(d);
    d.append(...run);
    run = [];
  };
  for (const n of [...ed.childNodes]) {
    const isBlock = n.nodeType === 1 && BLOCK_RE.test(n.tagName);
    if (isBlock) flush();
    else if (n.nodeType === 3 && !n.textContent.trim() && !run.length) n.remove();
    else run.push(n);
  }
  flush();
}

function selectedBlocks(ed) {
  const saved = saveSel();
  wrapLooseInline(ed);
  restoreSel(saved);
  const sel = getSelection();
  if (!sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const blocks = [];
  const visit = (parent) => {
    for (const child of parent.children) {
      if (!range.intersectsNode(child)) continue;
      if (child.matches('ul,ol')) child.querySelectorAll(':scope > li').forEach((li) => { if (range.intersectsNode(li)) blocks.push(li); });
      else if (child.matches('div') && [...child.children].some((c) => BLOCK_RE.test(c.tagName) && c.tagName !== 'HR')) visit(child);
      else if (!child.matches('hr')) blocks.push(child);
    }
  };
  visit(ed);
  return blocks;
}

/** 行間：mode='rel'（相対値・倍数） / 'pt'（固定値） */
export function setLineHeight(value, mode = 'rel') {
  const ed = need();
  if (!ed) return;
  const blocks = selectedBlocks(ed);
  const v = mode === 'pt' ? `${value}pt` : String(value);
  if (!blocks.length) ed.style.lineHeight = v;
  blocks.forEach((b) => { b.style.lineHeight = v; });
  fire(ed);
}

export async function setLineHeightCustom(mode) {
  const ed = getEditable();
  if (!ed) { need(); return; }
  const range = lastRange?.cloneRange();
  const v = mode === 'pt'
    ? await promptDialog('行間（固定値）', '行間 (pt)：フォントサイズに関係なく一定になります', '18', { type: 'number', attrs: 'min="1" max="300" step="0.5"' })
    : await promptDialog('行間（相対値）', '行間（倍数）：フォントサイズに比例します', '1.5', { type: 'number', attrs: 'min="0.5" max="10" step="0.05"' });
  if (v === null) return;
  const n = parseFloat(v);
  if (!(n > 0)) { toast('正しい数値を入力してください', 'error'); return; }
  lastEditable = ed; lastRange = range;
  setLineHeight(n, mode);
}

export function setAlign(a) {
  const cmd = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a];
  return exec(cmd);
}

export function outline() {
  const ed = need();
  if (!ed) return;
  const startOl = () => {
    const s = getSelection();
    const n = s.rangeCount ? s.getRangeAt(0).startContainer : null;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    let ol = el?.closest('ol');
    while (ol && ol.parentElement?.closest('ol') && ed.contains(ol.parentElement.closest('ol'))) ol = ol.parentElement.closest('ol');
    return ol && ed.contains(ol) ? ol : null;
  };
  let ol = startOl();
  if (ol && ol.classList.contains('outline')) {
    ol.classList.remove('outline');
    document.execCommand('insertOrderedList');
  } else {
    if (!ol) document.execCommand('insertOrderedList');
    ol = startOl();
    ol?.classList.add('outline');
    if (ol) toast('Tab / インデントボタンで階層を下げられます', 'info', 2200);
  }
  fire(ed);
}

export function insertLine(style = 'solid') {
  const border = style === 'double' ? '3px double #000' : `1px ${style} #000`;
  return exec('insertHTML', `<hr class="rl-line" style="border:none;border-top:${border}"><div><br></div>`);
}

/* ---------- 囲み文字 ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';

function makeEnclosure(text, o) {
  const s = document.createElement('span');
  s.className = 'enc';
  s.contentEditable = 'false';
  s.dataset.shape = o.shape || 'circle';
  s.dataset.color = o.color || '#000000';
  s.dataset.width = String(o.width ?? 1);
  s.dataset.fill = o.fill || '';
  const t = document.createElement('span');
  t.className = 'enc-t';
  t.textContent = text;
  s.append(t);
  return s;
}

/** 文字に重ならないように枠のサイズを計算して SVG を描く */
export function layoutEnclosure(enc) {
  const t = enc.querySelector('.enc-t');
  if (!t) return;
  enc.querySelector('svg.enc-s')?.remove();
  enc.style.padding = '0';
  const tw = t.offsetWidth, th = t.offsetHeight;
  if (!tw || !th) return;
  const fs = parseFloat(getComputedStyle(enc).fontSize) || 14;
  const sw = Math.max(0.3, parseFloat(enc.dataset.width) || 1);
  const gap = fs * 0.1 + sw;
  const single = [...t.textContent].length <= 1;
  const shape = enc.dataset.shape || 'circle';
  let W, H;
  switch (shape) {
    case 'square': W = tw + 2 * gap; H = th + 2 * gap; break;
    case 'diamond': W = 2 * tw + 2 * gap; H = 2 * th + 2 * gap; break;
    case 'triangle': W = 2 * tw + 3.4 * gap; H = 2 * th + 2 * gap; if (single) W = Math.max(W, H * 1.15); break;
    default: W = tw * Math.SQRT2 + 2 * gap; H = th * Math.SQRT2 + 2 * gap;
  }
  if (single && shape !== 'triangle') W = H = Math.max(W, H);
  const pt = shape === 'triangle' ? H - th - gap : (H - th) / 2;
  const pb = shape === 'triangle' ? gap : (H - th) / 2;
  const pl = (W - tw) / 2;
  enc.style.padding = `${pt.toFixed(2)}px ${pl.toFixed(2)}px ${pb.toFixed(2)}px`;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'enc-s');
  svg.setAttribute('width', W.toFixed(2));
  svg.setAttribute('height', H.toFixed(2));
  svg.setAttribute('viewBox', `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`);
  svg.setAttribute('aria-hidden', 'true');
  const i = sw / 2;
  let sh;
  if (shape === 'square') {
    sh = document.createElementNS(SVGNS, 'rect');
    sh.setAttribute('x', i); sh.setAttribute('y', i); sh.setAttribute('width', W - sw); sh.setAttribute('height', H - sw);
  } else if (shape === 'triangle') {
    sh = document.createElementNS(SVGNS, 'polygon');
    sh.setAttribute('points', `${W / 2},${i} ${W - i},${H - i} ${i},${H - i}`);
    sh.setAttribute('stroke-linejoin', 'round');
  } else if (shape === 'diamond') {
    sh = document.createElementNS(SVGNS, 'polygon');
    sh.setAttribute('points', `${W / 2},${i} ${W - i},${H / 2} ${W / 2},${H - i} ${i},${H / 2}`);
    sh.setAttribute('stroke-linejoin', 'round');
  } else {
    sh = document.createElementNS(SVGNS, 'ellipse');
    sh.setAttribute('cx', W / 2); sh.setAttribute('cy', H / 2); sh.setAttribute('rx', W / 2 - i); sh.setAttribute('ry', H / 2 - i);
  }
  sh.setAttribute('fill', enc.dataset.fill || 'none');
  sh.setAttribute('stroke', enc.dataset.color || '#000000');
  sh.setAttribute('stroke-width', sw);
  svg.append(sh);
  enc.prepend(svg);
}

const countChars = (s) => [...s].length;

export async function insertEnclosure(shape) {
  const ed = need();
  if (!ed) return;
  let range = getSelection().getRangeAt(0).cloneRange();
  let text = range.toString().replace(/[\s​]+/g, '');
  if (!text) {
    const v = await promptDialog('囲み文字', '囲む文字（8文字以内）', '', { attrs: 'maxlength="8"' });
    if (!v) return;
    text = v.replace(/\s+/g, '');
    ed.focus({ preventScroll: true });
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
  }
  if (!text) return;
  if (countChars(text) > 8) { toast('囲み文字は8文字以内で指定してください', 'error'); return; }
  const enc = makeEnclosure(text, { shape });
  range.deleteContents();
  range.insertNode(enc);
  if (!enc.nextSibling) enc.after(document.createTextNode('​'));
  const r = document.createRange();
  r.setStartAfter(enc); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  layoutEnclosure(enc);
  fire(ed);
}

export async function editEnclosure(enc) {
  const ed = enc.closest('.tb-content');
  const d = enc.dataset;
  const text = enc.querySelector('.enc-t')?.textContent || '';
  const r = await openDialog({
    title: '囲み文字の設定',
    content: `
      <label class="field"><span>文字（8文字以内）</span><input name="text" value="${esc(text)}" maxlength="8"></label>
      <label class="field"><span>形</span>
        <select name="shape">
          ${[['circle', '丸'], ['square', '四角'], ['triangle', '三角'], ['diamond', 'ひし形']].map(([v, l]) => `<option value="${v}" ${d.shape === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <div class="form-grid">
        <label>縁の色</label><input type="color" name="color" value="${esc(d.color || '#000000')}">
        <label>縁の太さ (px)</label><input class="input" type="number" name="width" min="0.3" max="8" step="0.1" value="${esc(d.width || '1')}">
        <label>塗りつぶし</label><span><input type="checkbox" name="useFill" ${d.fill ? 'checked' : ''}> <input type="color" name="fill" value="${esc(d.fill || '#fff2cc')}"></span>
        <label>文字の色</label><input type="color" name="textColor" value="${esc(rgbToHexSafe(getComputedStyle(enc).color))}">
      </div>`,
    buttons: [{ label: '囲みを解除', value: 'remove', danger: true }, { label: 'キャンセル', value: null }, { label: '適用', value: 'ok', primary: true }],
    collect: (f) => {
      const t = f.text.value.replace(/\s+/g, '');
      if (!t || countChars(t) > 8) { toast('文字は1〜8文字で入力してください', 'error'); return undefined; }
      return { text: t, shape: f.shape.value, color: f.color.value, width: f.width.value, fill: f.useFill.checked ? f.fill.value : '', textColor: f.textColor.value };
    },
  });
  if (!r.value) return;
  if (r.value === 'remove') {
    enc.replaceWith(document.createTextNode(text));
  } else {
    const v = r.data;
    enc.querySelector('.enc-t').textContent = v.text;
    Object.assign(enc.dataset, { shape: v.shape, color: v.color, width: v.width, fill: v.fill });
    enc.style.color = v.textColor;
    layoutEnclosure(enc);
  }
  if (ed) fire(ed);
}

function rgbToHexSafe(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
}

/* ---------- フリガナ ---------- */
function makeRuby(base, reading) {
  const ruby = document.createElement('ruby');
  ruby.contentEditable = 'false';
  ruby.append(document.createTextNode(base));
  const rp1 = document.createElement('rp'); rp1.textContent = '(';
  const rt = document.createElement('rt'); rt.textContent = reading;
  const rp2 = document.createElement('rp'); rp2.textContent = ')';
  ruby.append(rp1, rt, rp2);
  return ruby;
}

export async function insertRuby() {
  const ed = need();
  if (!ed) return;
  const range = getSelection().getRangeAt(0).cloneRange();
  const base = range.toString().replace(/​/g, '');
  if (!base.trim()) { toast('フリガナを付ける文字を選択してください', 'info'); return; }
  const reading = await promptDialog('フリガナ', `「${base}」の読み`, '', { placeholder: 'ふりがな' });
  if (reading === null) return;
  ed.focus({ preventScroll: true });
  if (!reading.trim()) return;
  const ruby = makeRuby(base, reading.trim());
  range.deleteContents();
  range.insertNode(ruby);
  if (!ruby.nextSibling) ruby.after(document.createTextNode('​'));
  const r = document.createRange(); r.setStartAfter(ruby); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  fire(ed);
}

export async function editRuby(ruby) {
  const ed = ruby.closest('.tb-content');
  const base = [...ruby.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
  const reading = ruby.querySelector('rt')?.textContent || '';
  const r = await openDialog({
    title: 'フリガナの編集',
    content: `<label class="field"><span>文字</span><input name="base" value="${esc(base)}"></label>
              <label class="field"><span>フリガナ</span><input name="reading" value="${esc(reading)}"></label>`,
    buttons: [{ label: 'フリガナを削除', value: 'remove', danger: true }, { label: 'キャンセル', value: null }, { label: '適用', value: 'ok', primary: true }],
    collect: (f) => ({ base: f.base.value, reading: f.reading.value }),
  });
  if (!r.value) return;
  if (r.value === 'remove' || !r.data.reading.trim()) ruby.replaceWith(document.createTextNode(r.value === 'remove' ? base : r.data.base));
  else ruby.replaceWith(makeRuby(r.data.base, r.data.reading.trim()));
  if (ed) fire(ed);
}

/* ---------- 状態取得（リボン表示用） ---------- */
export function queryState() {
  const ed = getEditable();
  if (!ed) return null;
  const sel = getSelection();
  let node = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.anchorNode : lastRange?.startContainer;
  if (!node) return null;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const cs = getComputedStyle(el);
  const st = { size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2, font: fontIndexFromFamily(cs.fontFamily) };
  const focused = document.activeElement === ed;
  for (const c of ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']) {
    try { st[c] = focused ? document.queryCommandState(c) : false; } catch { st[c] = false; }
  }
  if (el.closest('sup')) st.size = Math.round(st.size * 2 * 2) / 2;
  if (el.closest('sub')) st.size = Math.round(st.size * 2 * 2) / 2;
  return st;
}
