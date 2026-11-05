// リボン（ホーム / 数式 / レイアウト / 表示）
import { $, $$, toast, bindDropdowns, openColorPopover, openDialog, closeMenus } from './ui.js';
import { FONTS, FONT_SIZES, PAPER } from './docmodel.js';
import * as ed from './editor.js';
import * as fmt from './textfmt.js';
import * as find from './find.js';

const colors = { foreColor: '#000000', hiliteColor: '#ffff00', boxColor: '#e3f8fa' };
let hooks = {};

const MATH_STRUCTS = [
  ['\\frac{#0}{#?}', '\\frac{a}{b}', '分数'],
  ['\\sqrt{#0}', '\\sqrt{x}', '平方根'],
  ['\\sqrt[#?]{#0}', '\\sqrt[n]{x}', 'n乗根'],
  ['#0^{#?}', 'x^{n}', '指数'],
  ['#0_{#?}', 'x_{i}', '添え字'],
  ['\\int_{#?}^{#?}#0\\,dx', '\\int_a^b', '定積分'],
  ['\\int #0\\,dx', '\\int', '不定積分'],
  ['\\sum_{#?}^{#?}#0', '\\sum', '総和'],
  ['\\prod_{#?}^{#?}#0', '\\prod', '総乗'],
  ['\\lim_{#?\\to #?}#0', '\\lim', '極限'],
  ['\\frac{d#0}{d#?}', '\\frac{d}{dx}', '微分'],
  ['\\frac{\\partial #0}{\\partial #?}', '\\frac{\\partial}{\\partial x}', '偏微分'],
  ['\\left(#0\\right)', '(\\,)', '括弧'],
  ['\\left|#0\\right|', '|\\,|', '絶対値'],
  ['\\begin{pmatrix}#? & #?\\\\ #? & #?\\end{pmatrix}', '\\begin{pmatrix}\\cdot&\\cdot\\\\\\cdot&\\cdot\\end{pmatrix}', '行列'],
  ['\\vec{#0}', '\\vec{a}', 'ベクトル'],
  ['\\overline{#0}', '\\overline{x}', '上線'],
  ['\\log_{#?}#0', '\\log_a', '対数'],
  ['\\sin #0', '\\sin', 'sin'],
  ['\\cos #0', '\\cos', 'cos'],
  ['\\begin{cases}#? & #?\\\\ #? & #?\\end{cases}', '\\begin{cases}\\cdot\\\\\\cdot\\end{cases}', '場合分け'],
  ['\\binom{#?}{#?}', '\\binom{n}{k}', '二項係数'],
];
const MATH_SYMBOLS = [
  ['\\pm', '±'], ['\\times', '×'], ['\\div', '÷'], ['\\cdot', '·'], ['\\neq', '≠'], ['\\approx', '≈'], ['\\equiv', '≡'],
  ['\\leq', '≤'], ['\\geq', '≥'], ['\\ll', '≪'], ['\\gg', '≫'], ['\\infty', '∞'], ['\\propto', '∝'], ['\\to', '→'],
  ['\\Rightarrow', '⇒'], ['\\Leftrightarrow', '⇔'], ['\\in', '∈'], ['\\notin', '∉'], ['\\subset', '⊂'], ['\\cup', '∪'], ['\\cap', '∩'],
  ['\\forall', '∀'], ['\\exists', '∃'], ['\\partial', '∂'], ['\\nabla', '∇'], ['\\therefore', '∴'], ['\\because', '∵'], ['\\angle', '∠'],
  ['\\perp', '⊥'], ['\\parallel', '∥'], ['\\triangle', '△'], ['\\circ', '°'], ['\\emptyset', '∅'], ['\\mathbb{R}', 'ℝ'], ['\\hbar', 'ℏ'],
];
const GREEK = [
  ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\epsilon', 'ε'], ['\\zeta', 'ζ'], ['\\eta', 'η'],
  ['\\theta', 'θ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\nu', 'ν'], ['\\xi', 'ξ'], ['\\pi', 'π'], ['\\rho', 'ρ'],
  ['\\sigma', 'σ'], ['\\tau', 'τ'], ['\\phi', 'φ'], ['\\chi', 'χ'], ['\\psi', 'ψ'], ['\\omega', 'ω'], ['\\Gamma', 'Γ'],
  ['\\Delta', 'Δ'], ['\\Theta', 'Θ'], ['\\Lambda', 'Λ'], ['\\Sigma', 'Σ'], ['\\Phi', 'Φ'], ['\\Psi', 'Ψ'], ['\\Omega', 'Ω'],
];

export function initRibbon(h) {
  hooks = h;
  const ribbon = $('#ribbon');

  // フォント一覧・サイズ候補
  $('#fontFamily').innerHTML = FONTS.map((f, i) => `<option value="${i}" style="font-family:${f.stack.replace(/"/g, '&quot;')}">${f.label}</option>`).join('');
  $('#fontSizes').innerHTML = FONT_SIZES.map((s) => `<option value="${s}">`).join('');

  // 数式ボタン
  $('#mathStructures').innerHTML = MATH_STRUCTS.map(([tex, preview, label]) =>
    `<button class="rbtn" data-cmd="math" data-arg="${tex.replace(/"/g, '&quot;')}" title="${label}" data-tex="${preview.replace(/"/g, '&quot;')}">${label}</button>`).join('');
  $('#mathSymbols').innerHTML = MATH_SYMBOLS.map(([tex, ch]) => `<button class="rbtn" data-cmd="math" data-arg="${tex}" title="${tex}">${ch}</button>`).join('');
  $('#mathGreek').innerHTML = GREEK.map(([tex, ch]) => `<button class="rbtn" data-cmd="math" data-arg="${tex}" title="${tex}">${ch}</button>`).join('');
  renderMathLabels();

  // ボタンをクリックしてもテキストの選択が外れないように
  ribbon.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  bindDropdowns(ribbon);
  ribbon.addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { openColor(c); return; }
    const b = e.target.closest('button[data-cmd]');
    if (b) run(b.dataset.cmd, b.dataset.arg, b);
  });

  const fam = $('#fontFamily');
  fam.addEventListener('change', () => { fmt.setFontFamily(+fam.value); });
  const size = $('#fontSize');
  const applySize = () => { if (size.value) fmt.setFontSize(size.value); };
  size.addEventListener('change', applySize);
  size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } });

  fmt.onSelectionFormat(updateState);
}

function renderMathLabels() {
  const go = () => {
    if (!window.katex) return false;
    $$('#mathStructures [data-tex]').forEach((b) => {
      try { window.katex.render(b.dataset.tex, b, { throwOnError: false, displayMode: false }); } catch { /* keep label */ }
    });
    return true;
  };
  if (!go()) window.addEventListener('load', go, { once: true });
}

function openColor(btn) {
  const key = btn.dataset.color;
  openColorPopover(btn, {
    current: colors[key],
    allowNone: key !== 'foreColor',
    noneLabel: key === 'hiliteColor' ? '蛍光ペンなし' : '塗りつぶしなし',
    onPick: (c) => {
      if (c) {
        colors[key] = c;
        const bar = { foreColor: '#barForeColor', hiliteColor: '#barHiliteColor', boxColor: '#barBoxColor' }[key];
        $(bar).style.background = c;
      }
      run(key, c ?? 'none');
    },
  });
}

/** 選択中の書式をリボンに反映 */
export function updateState() {
  const st = fmt.queryState();
  if (!st) return;
  $$('#ribbon [data-state]').forEach((b) => b.classList.toggle('on', !!st[b.dataset.state]));
  const size = $('#fontSize');
  if (document.activeElement !== size) size.value = String(st.size);
  const fam = $('#fontFamily');
  if (document.activeElement !== fam && st.font >= 0) fam.value = String(st.font);
}

export function updateLayoutInfo() {
  const L = ed.getLayout();
  const m = L.margins;
  $('#layoutInfo').innerHTML = `
    <div>用紙：<b>${L.size}</b>（${L.orientation === 'landscape' ? '横' : '縦'}）　ページ数：<b>${ed.pageCount()}</b></div>
    <div>余白：上 <b>${m.top}</b> / 下 <b>${m.bottom}</b> / 左 <b>${m.left}</b> / 右 <b>${m.right}</b> mm</div>`;
}

async function marginDialog() {
  const m = ed.getLayout().margins;
  const r = await openDialog({
    title: 'ユーザー設定の余白',
    content: `<div class="form-grid">
      ${[['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']].map(([k, l]) =>
        `<label>${l} (mm)</label><input class="input" type="number" name="${k}" min="0" max="150" step="0.1" value="${m[k]}">`).join('')}
    </div>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '適用', value: true, primary: true }],
    collect: (f) => {
      const v = {};
      for (const k of ['top', 'bottom', 'left', 'right']) {
        const n = parseFloat(f[k].value);
        if (!(n >= 0 && n <= 150)) { toast('余白は 0〜150mm で指定してください', 'error'); return undefined; }
        v[k] = n;
      }
      return v;
    },
  });
  if (r.value) { ed.setLayout({ margins: r.data }); updateLayoutInfo(); }
}

function run(cmd, arg, btn) {
  const active = ed.activeBox();
  switch (cmd) {
    /* ---- フォント ---- */
    case 'exec': fmt.exec(arg); break;
    case 'growFont': fmt.stepFontSize(1); break;
    case 'shrinkFont': fmt.stepFontSize(-1); break;
    case 'clearFormat': fmt.clearFormat(); break;
    case 'foreColor': fmt.setForeColor(arg && arg !== 'none' ? arg : colors.foreColor); break;
    case 'hiliteColor': fmt.setHilite(arg === 'none' ? null : (arg || colors.hiliteColor)); break;
    case 'enclose': fmt.insertEnclosure(arg); break;
    case 'ruby': fmt.insertRuby(); break;
    /* ---- 段落 ---- */
    case 'outline': fmt.outline(); break;
    case 'align':
      if (active?.type === 'math') ed.setMathAlign(arg);
      else fmt.setAlign(arg);
      break;
    case 'lineHeight': fmt.setLineHeight(parseFloat(arg), 'rel'); break;
    case 'lineHeightCustom': fmt.setLineHeightCustom(arg); break;
    case 'hscale': fmt.setHScale(parseFloat(arg)); break;
    case 'hr': fmt.insertLine(arg); break;
    case 'boxBorder': ed.setBoxBorder(arg); break;
    case 'boxColor': ed.setBoxBg(arg === 'none' ? '' : (arg || colors.boxColor)); break;
    /* ---- 挿入 / 編集 ---- */
    case 'insert': ed.insertBoxAuto(arg); break;
    case 'find': find.open(false); break;
    case 'replace': find.open(true); break;
    /* ---- 数式 ---- */
    case 'math': ed.insertMath(arg); break;
    case 'mathKeyboard': ed.toggleMathKeyboard(); break;
    case 'latexEdit': ed.latexDialog(); break;
    /* ---- レイアウト ---- */
    case 'margin': {
      const [top, bottom, left, right] = arg.split(',').map(Number);
      ed.setLayout({ margins: { top, bottom, left, right } });
      updateLayoutInfo();
      break;
    }
    case 'marginCustom': marginDialog(); break;
    case 'orientation': ed.setLayout({ orientation: arg }); updateLayoutInfo(); break;
    case 'paper': if (PAPER[arg]) { ed.setLayout({ size: arg }); updateLayoutInfo(); } break;
    case 'addPage': ed.addPage(); updateLayoutInfo(); break;
    case 'deletePage': ed.deletePage().then(updateLayoutInfo); break;
    /* ---- 表示 ---- */
    case 'zoomIn': ed.setZoom(ed.getZoom() + 0.1); break;
    case 'zoomOut': ed.setZoom(ed.getZoom() - 0.1); break;
    case 'zoomReset': ed.setZoom(1); break;
    case 'zoomFit': ed.zoomFit(); break;
    case 'toggleGuides': { const v = !ed.getState().guides; ed.setGuides(v); btn?.classList.toggle('on', v); break; }
    case 'toggleGrid': { const v = !ed.getState().grid; ed.setGrid(v); btn?.classList.toggle('on', v); break; }
    case 'theme': hooks.setTheme?.(arg); break;
    default: break;
  }
  if (cmd !== 'exec') closeMenus();
  setTimeout(updateState, 0);
}

export function reflectView() {
  $('#btnGuides')?.classList.toggle('on', ed.getState().guides);
  $('#btnGrid')?.classList.toggle('on', ed.getState().grid);
}
