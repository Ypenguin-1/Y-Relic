// ドキュメントのデータモデルと静的レンダリング（出力用）

export const MM_PX = 96 / 25.4; // 1mm あたりの CSS px

export const PAPER = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B4: [257, 364],
  B5: [182, 257],
};

export const FONTS = [
  { label: 'MS 明朝', stack: '"MS Mincho","ＭＳ 明朝","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif' },
  { label: 'MS ゴシック', stack: '"MS Gothic","ＭＳ ゴシック","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif' },
  { label: '游明朝', stack: '"Yu Mincho","YuMincho","游明朝","Noto Serif JP",serif' },
  { label: '游ゴシック', stack: '"Yu Gothic","YuGothic","游ゴシック","Noto Sans JP",sans-serif' },
  { label: 'メイリオ', stack: 'Meiryo,"メイリオ","Noto Sans JP",sans-serif' },
  { label: 'Noto Serif JP', stack: '"Noto Serif JP",serif' },
  { label: 'Noto Sans JP', stack: '"Noto Sans JP",sans-serif' },
  { label: 'Times New Roman', stack: '"Times New Roman",Times,serif' },
  { label: 'Century', stack: 'Century,"Century Schoolbook",serif' },
  { label: 'Arial', stack: 'Arial,Helvetica,sans-serif' },
  { label: 'Consolas', stack: 'Consolas,"Courier New",monospace' },
];

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const firstFamily = (ff) => (ff || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
export function fontIndexFromFamily(ff) {
  const f = firstFamily(ff);
  return FONTS.findIndex((x) => firstFamily(x.stack) === f);
}

export const DEFAULT_TEXT_HTML = '<div><br></div>';
export const DEFAULT_MARGINS = { top: 35, right: 30, bottom: 30, left: 30 };

export function newDoc() {
  return {
    version: 1,
    layout: { size: 'A4', orientation: 'portrait', margins: { ...DEFAULT_MARGINS } },
    pages: 1,
    boxes: [],
  };
}

export function genId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function pageSize(layout) {
  const [w, h] = PAPER[layout?.size] || PAPER.A4;
  return layout?.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

const num = (v, d) => (Number.isFinite(+v) ? +v : d);

/** Firebase / ファイルから読んだデータを安全な形に整える（undefined を含めない） */
export function normalizeDoc(d) {
  const n = newDoc();
  if (!d || typeof d !== 'object') return n;
  const L = d.layout || {};
  n.layout.size = PAPER[L.size] ? L.size : 'A4';
  n.layout.orientation = L.orientation === 'landscape' ? 'landscape' : 'portrait';
  const m = L.margins || {};
  for (const k of ['top', 'right', 'bottom', 'left']) n.layout.margins[k] = Math.max(0, num(m[k], DEFAULT_MARGINS[k]));
  n.pages = Math.max(1, parseInt(d.pages, 10) || 1);
  let boxes = d.boxes;
  if (boxes && !Array.isArray(boxes)) boxes = Object.values(boxes);
  n.boxes = (boxes || [])
    .filter((b) => b && ['text', 'math', 'image'].includes(b.type))
    .map((b) => {
      const box = {
        id: String(b.id || genId()),
        type: b.type,
        page: Math.min(n.pages - 1, Math.max(0, parseInt(b.page, 10) || 0)),
        x: num(b.x, 30), y: num(b.y, 35), w: Math.max(3, num(b.w, 50)), h: Math.max(3, num(b.h, 10)),
        z: num(b.z, 1),
        bg: typeof b.bg === 'string' ? b.bg : '',
        border: typeof b.border === 'string' ? b.border : '',
        align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'left',
      };
      if (b.type === 'text') box.html = typeof b.html === 'string' ? b.html : DEFAULT_TEXT_HTML;
      if (b.type === 'math') box.latex = typeof b.latex === 'string' ? b.latex : '';
      if (b.type === 'image') box.src = typeof b.src === 'string' ? b.src : '';
      return box;
    });
  return n;
}

export function applyBoxStyle(el, box) {
  el.style.left = box.x + 'mm';
  el.style.top = box.y + 'mm';
  el.style.width = box.w + 'mm';
  if (box.type === 'image') { el.style.height = box.h + 'mm'; el.style.minHeight = ''; }
  else { el.style.minHeight = box.h + 'mm'; el.style.height = ''; }
  el.style.zIndex = String(box.z || 1);
  el.style.background = box.bg || 'transparent';
  el.style.border = box.border || 'none';
}

export function renderMath(el, latex, align = 'left') {
  el.style.textAlign = align;
  if (!latex) { el.innerHTML = '<span class="math-empty">数式を入力（ダブルクリックで編集）</span>'; return; }
  if (window.katex) {
    try {
      window.katex.render(latex, el, { displayMode: true, throwOnError: false, output: 'html', strict: 'ignore' });
      return;
    } catch { /* fallthrough */ }
  }
  el.innerHTML = '';
  const s = document.createElement('span');
  s.className = 'math-fallback';
  s.textContent = latex;
  el.append(s);
}

/** 出力用の静的ボックス */
export function buildStaticBox(box) {
  const el = document.createElement('div');
  el.className = `box box-${box.type}`;
  const body = document.createElement('div');
  body.className = 'box-body';
  if (box.type === 'text') {
    const c = document.createElement('div');
    c.className = 'tb-content';
    c.innerHTML = box.html || '';
    c.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
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
    body.append(img);
  }
  el.append(body);
  applyBoxStyle(el, box);
  return el;
}

export function buildStaticPage(doc, index) {
  const { w, h } = pageSize(doc.layout);
  const page = document.createElement('div');
  page.className = 'page static';
  page.style.width = w + 'mm';
  page.style.height = h + 'mm';
  doc.boxes.filter((b) => b.page === index).sort((a, b) => a.z - b.z).forEach((b) => page.append(buildStaticBox(b)));
  return page;
}

/** 外部 HTML を取り込む時の簡易サニタイズ */
export function sanitizeHtml(html, { stripClasses = false } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,noscript,template').forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      else if (stripClasses && (name === 'class' || name === 'id') && !el.closest('.enc, ruby')) el.removeAttribute(a.name);
    });
  });
  return tpl.innerHTML;
}
