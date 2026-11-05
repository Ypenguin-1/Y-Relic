// 出力（PDF / 画像 / HTML）と HTML の読み込み
import { buildStaticPage, pageSize, PAPER, normalizeDoc, sanitizeHtml, newDoc, genId, DEFAULT_TEXT_HTML } from './docmodel.js';
import { esc } from './ui.js';

/** "1-3,5" → [0,1,2,4]（0 始まり） */
export function parseRange(str, max) {
  const s = String(str || '').trim();
  if (!s) return [...Array(max).keys()];
  const set = new Set();
  for (const part of s.split(/[,、\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)(?:\s*[-~〜]\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`ページ指定「${part}」が正しくありません`);
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) if (i >= 1 && i <= max) set.add(i - 1);
  }
  if (!set.size) throw new Error('指定されたページがありません');
  return [...set].sort((x, y) => x - y);
}

const safeName = (s) => (String(s || 'document').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document');

/* ---------- 保存先の選択 ---------- */
const TYPES = {
  pdf: { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
  png: { description: 'PNG 画像', accept: { 'image/png': ['.png'] } },
  jpg: { description: 'JPEG 画像', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  zip: { description: 'ZIP', accept: { 'application/zip': ['.zip'] } },
  html: { description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } },
};

/**
 * 保存先を選ぶ（File System Access API 対応ブラウザ）。非対応ならダウンロード。
 * ユーザー操作の直後に呼ぶ必要があるため、重い処理より先に実行する。
 * @returns {Promise<{handle?:FileSystemFileHandle, name:string}|null>} キャンセル時 null
 */
export async function pickSaveTarget(filename, ext, { choose = true } = {}) {
  if (choose && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [TYPES[ext]] });
      return { handle, name: handle.name };
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      // セキュリティ制限などの場合はダウンロードにフォールバック
    }
  }
  return { name: filename };
}

export async function writeTarget(target, blob) {
  if (target.handle) {
    const w = await target.handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = target.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- ページの画像化 ---------- */
async function renderPages(doc, indices, pxScale, onProgress) {
  if (!window.html2canvas) throw new Error('出力ライブラリ（html2canvas）を読み込めませんでした');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  document.body.append(host);
  const canvases = [];
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    for (let k = 0; k < indices.length; k++) {
      const page = buildStaticPage(doc, indices[k]);
      host.append(page);
      await new Promise((r) => requestAnimationFrame(() => r()));
      await Promise.all([...page.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      const canvas = await window.html2canvas(page, { scale: pxScale, backgroundColor: '#ffffff', useCORS: true, logging: false });
      canvases.push(canvas);
      page.remove();
      onProgress?.((k + 1) / indices.length);
    }
  } finally {
    host.remove();
  }
  return canvases;
}

/** 用紙サイズ（mm）。向きはドキュメントに合わせる */
function paperFor(doc, paper) {
  const [a, b] = PAPER[paper] || PAPER.A4;
  return doc.layout.orientation === 'landscape' ? { w: b, h: a } : { w: a, h: b };
}

/** ページ内容を用紙サイズに収まるよう配置（縦横比維持・中央寄せ） */
function fit(src, dst) {
  const k = Math.min(dst.w / src.w, dst.h / src.h);
  const w = src.w * k, h = src.h * k;
  return { x: (dst.w - w) / 2, y: (dst.h - h) / 2, w, h };
}

export async function exportPDF(doc, { paper = 'A4', pages, target, onProgress }) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('出力ライブラリ（jsPDF）を読み込めませんでした');
  const ps = pageSize(doc.layout);
  const pp = paperFor(doc, paper);
  const canvases = await renderPages(doc, pages, 2.5, onProgress);
  const pdf = new jsPDF({ orientation: pp.w > pp.h ? 'landscape' : 'portrait', unit: 'mm', format: [pp.w, pp.h], compress: true });
  canvases.forEach((c, i) => {
    if (i) pdf.addPage([pp.w, pp.h], pp.w > pp.h ? 'landscape' : 'portrait');
    const r = fit(ps, pp);
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', r.x, r.y, r.w, r.h, undefined, 'FAST');
  });
  await writeTarget(target, pdf.output('blob'));
}

export async function exportImages(doc, { paper = 'A4', pages, format = 'png', dpi = 200, target, baseName, onProgress }) {
  const ps = pageSize(doc.layout);
  const pp = paperFor(doc, paper);
  const canvases = await renderPages(doc, pages, 2.5, onProgress);
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const W = Math.round((pp.w / 25.4) * dpi), H = Math.round((pp.h / 25.4) * dpi);
  const blobs = await Promise.all(canvases.map((c) => new Promise((resolve) => {
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const r = fit(ps, { w: W, h: H });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, r.x, r.y, r.w, r.h);
    out.toBlob(resolve, mime, 0.92);
  })));
  if (blobs.length === 1) { await writeTarget(target, blobs[0]); return; }
  if (!window.JSZip) throw new Error('ZIP ライブラリを読み込めませんでした');
  const zip = new window.JSZip();
  blobs.forEach((b, i) => zip.file(`${safeName(baseName)}_p${pages[i] + 1}.${format}`, b));
  await writeTarget(target, await zip.generateAsync({ type: 'blob' }));
}

/* ---------- HTML ---------- */
let docCssCache = null;
async function docCss() {
  if (docCssCache) return docCssCache;
  try { docCssCache = await (await fetch(new URL('../css/doc.css', import.meta.url))).text(); } catch { docCssCache = ''; }
  return docCssCache;
}

export async function buildHTML(doc, title) {
  const css = await docCss();
  const { w, h } = pageSize(doc.layout);
  const host = document.createElement('div');
  for (let i = 0; i < doc.pages; i++) host.append(buildStaticPage(doc, i));
  const json = JSON.stringify(doc).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Relic">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Noto+Serif+JP:wght@400;700&display=swap">
<style>
${css}
html,body{margin:0;background:#e4e9ee}
body{padding:24px 0}
.page{margin:0 auto 24px;box-shadow:0 1px 3px rgba(0,0,0,.15),0 6px 18px rgba(0,0,0,.08)}
@page{size:${w}mm ${h}mm;margin:0}
@media print{html,body{background:none;padding:0}.page{margin:0;box-shadow:none;break-after:page}}
</style>
</head>
<body>
${host.innerHTML}
<script type="application/json" id="relic-data">${json}</script>
</body>
</html>`;
}

export async function exportHTML(doc, { title, target }) {
  const html = await buildHTML(doc, title);
  await writeTarget(target, new Blob([html], { type: 'text/html;charset=utf-8' }));
}

/** HTML ファイルを読み込んでドキュメントに変換 */
export async function importHTMLFile(file) {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  const data = parsed.getElementById('relic-data');
  const title = (parsed.title || file.name.replace(/\.html?$/i, '')).trim() || '読み込んだドキュメント';
  if (data) {
    try {
      const doc = normalizeDoc(JSON.parse(data.textContent));
      doc.boxes.forEach((b) => { if (b.type === 'text') b.html = sanitizeHtml(b.html); });
      return { doc, title, relic: true };
    } catch { /* 通常の HTML として読み込む */ }
  }
  // Relic 以外の HTML：本文をテキストボックスとして取り込み、画像は画像ボックスに
  const doc = newDoc();
  const m = doc.layout.margins;
  const { w } = pageSize(doc.layout);
  const body = parsed.body;
  body.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  const html = sanitizeHtml(body.innerHTML).trim() || DEFAULT_TEXT_HTML;
  doc.boxes.push({ id: genId(), type: 'text', page: 0, x: m.left, y: m.top, w: w - m.left - m.right, h: 20, z: 1, bg: '', border: '', align: 'left', html });
  return { doc, title, relic: false };
}
