// 検索・置換（テキストボックスが対象）
import { $, toast } from './ui.js';

let pagesEl;
let matches = [];
let cur = -1;
const hasHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

export function initFind(pages) {
  pagesEl = pages;
  const input = $('#findInput');
  input.addEventListener('input', () => search());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? step(-1) : step(1); }
    if (e.key === 'Escape') close();
  });
  $('#replaceInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    if (e.key === 'Escape') close();
  });
  $('#findCase').addEventListener('change', () => search());
  $('#findNext').addEventListener('click', () => step(1));
  $('#findPrev').addEventListener('click', () => step(-1));
  $('#findClose').addEventListener('click', close);
  $('#replaceOne').addEventListener('click', replaceOne);
  $('#replaceAll').addEventListener('click', replaceAll);
}

export function open(withReplace = false) {
  const panel = $('#findPanel');
  panel.hidden = false;
  $('#replaceRow').hidden = !withReplace;
  const sel = getSelection().toString();
  const input = $('#findInput');
  if (sel && sel.length < 80 && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  search();
}

export function close() {
  $('#findPanel').hidden = true;
  clear();
}

function clear() {
  matches = [];
  cur = -1;
  if (hasHighlight) { CSS.highlights.delete('relic-find'); CSS.highlights.delete('relic-find-current'); }
  updateCount();
}

function orderedEditables() {
  const eds = [...pagesEl.querySelectorAll('.tb-content')];
  return eds.sort((a, b) => {
    const pa = +a.closest('.page').dataset.page, pb = +b.closest('.page').dataset.page;
    if (pa !== pb) return pa - pb;
    const ba = a.closest('.box'), bb = b.closest('.box');
    return (parseFloat(ba.style.top) - parseFloat(bb.style.top)) || (parseFloat(ba.style.left) - parseFloat(bb.style.left));
  });
}

export function search() {
  const q = $('#findInput').value;
  const cs = $('#findCase').checked;
  clear();
  if (!q) return;
  const needle = cs ? q : q.toLowerCase();
  for (const ed of orderedEditables()) {
    ed.normalize();
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.enc, rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    while ((n = walker.nextNode())) {
      const text = cs ? n.data : n.data.toLowerCase();
      let i = 0;
      while ((i = text.indexOf(needle, i)) !== -1) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        matches.push(r);
        i += q.length || 1;
      }
    }
  }
  if (hasHighlight && matches.length) CSS.highlights.set('relic-find', new Highlight(...matches));
  if (matches.length) { cur = 0; showCurrent(false); }
  updateCount();
}

function updateCount() {
  $('#findCount').textContent = matches.length ? `${cur + 1}/${matches.length}` : '0/0';
}

function showCurrent(select = true) {
  const r = matches[cur];
  if (!r) return;
  if (hasHighlight) CSS.highlights.set('relic-find-current', new Highlight(r));
  const el = r.startContainer.parentElement;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (select || !hasHighlight) {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  updateCount();
}

function step(d) {
  if (!matches.length) { search(); if (!matches.length) return; }
  cur = (cur + d + matches.length) % matches.length;
  showCurrent(false);
}

function replaceRange(r, text) {
  const ed = r.startContainer.parentElement.closest('.tb-content');
  r.deleteContents();
  if (text) r.insertNode(document.createTextNode(text));
  return ed;
}

function replaceOne() {
  if (!matches.length) { search(); if (!matches.length) { toast('一致する文字列はありません'); return; } }
  const r = matches[cur];
  const ed = replaceRange(r, $('#replaceInput').value);
  ed?.dispatchEvent(new Event('input', { bubbles: true }));
  const keep = cur;
  search();
  if (matches.length) { cur = Math.min(keep, matches.length - 1); showCurrent(false); }
}

function replaceAll() {
  if (!matches.length) search();
  if (!matches.length) { toast('一致する文字列はありません'); return; }
  const rep = $('#replaceInput').value;
  const eds = new Set();
  const n = matches.length;
  for (let i = matches.length - 1; i >= 0; i--) eds.add(replaceRange(matches[i], rep));
  eds.forEach((ed) => ed?.dispatchEvent(new Event('input', { bubbles: true })));
  search();
  toast(`${n} 件を置換しました`, 'success');
}
