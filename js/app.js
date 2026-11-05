// Relic — アプリ本体
import { $, $$, toast, openDialog, promptDialog, showContextMenu, bindBrandFallback, esc } from './ui.js';
import * as st from './storage.js';
import * as ed from './editor.js';
import * as ribbon from './ribbon.js';
import * as find from './find.js';
import * as filetab from './filetab.js';
import * as ex from './export.js';
import * as fmt from './textfmt.js';
import { newDoc } from './docmodel.js';

/* =========================================================
   状態
   ========================================================= */
const cur = { fileId: null, name: '無題のドキュメント', parentId: st.ROOT, dirty: false, saving: false };
let tab = 'file';
let readonly = false;
const phoneMQ = window.matchMedia('(max-width: 599px)');

/* =========================================================
   テーマ（ライト / ダーク）
   ========================================================= */
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const getThemePref = () => { try { return localStorage.getItem('relic-theme') || 'system'; } catch { return 'system'; } };
function applyTheme() {
  const pref = getThemePref();
  const dark = pref === 'dark' || (pref === 'system' && darkMQ.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const icon = $('#themeToggle i');
  if (icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  $$('#ribbon [data-cmd="theme"]').forEach((b) => b.classList.toggle('on', b.dataset.arg === pref));
}
function setTheme(pref) {
  try { localStorage.setItem('relic-theme', pref); } catch { /* ignore */ }
  applyTheme();
  st.saveSettings({ theme: pref });
  if (tab === 'file') filetab.render();
}
darkMQ.addEventListener?.('change', applyTheme);

/* =========================================================
   画面切り替え
   ========================================================= */
function switchTab(name) {
  if (readonly && !['file', 'view'].includes(name)) name = 'view';
  tab = name;
  $$('.tabbar .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  const isFile = name === 'file';
  $('#fileView').hidden = !isFile;
  $('#editorView').hidden = isFile;
  $('#ribbon').hidden = isFile;
  $$('.ribbon-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (isFile) { st.refresh().then(() => filetab.render()).catch(() => filetab.render()); }
  if (name === 'layout') ribbon.updateLayoutInfo();
  if (name === 'view') ribbon.reflectView();
}
function showEditor() { switchTab(readonly ? 'view' : 'home'); }

function updateTitle() {
  $('#docTitle').textContent = cur.name;
  document.title = `${cur.dirty ? '● ' : ''}${cur.name} - Relic`;
  const s = $('#saveState');
  if (cur.saving) s.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中…';
  else if (cur.dirty) s.innerHTML = '<i class="fa-solid fa-circle" style="font-size:7px;vertical-align:middle"></i> 未保存';
  else if (cur.fileId) s.innerHTML = '<i class="fa-solid fa-cloud"></i> 保存済み';
  else s.textContent = '';
}
function setDirty(v = true) { cur.dirty = v; updateTitle(); }

/* =========================================================
   ドキュメント操作
   ========================================================= */
async function confirmDiscard() {
  if (!cur.dirty || ed.isEmpty() && !cur.fileId) return true;
  const r = await openDialog({
    title: '変更の保存',
    content: `<p class="msg">「${esc(cur.name)}」への変更を保存しますか？</p>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '保存しない', value: 'discard' }, { label: '保存', value: 'save', primary: true }],
  });
  if (r.value === 'save') return save();
  return r.value === 'discard';
}

async function newDocument(parentId = null) {
  if (!(await confirmDiscard())) return;
  Object.assign(cur, { fileId: null, name: '無題のドキュメント', parentId: parentId || cur.parentId || st.ROOT });
  ed.loadDoc(newDoc());
  setDirty(false);
  showEditor();
  if (window.innerWidth >= 600) ed.setZoom(window.innerWidth < 1024 ? Math.min(1, (window.innerWidth - 48) / 794) : 1);
}

async function openFile(id) {
  const node = st.getNode(id);
  if (!node) { toast('ファイルが見つかりません', 'error'); return; }
  if (id !== cur.fileId && !(await confirmDiscard())) return;
  try {
    const doc = await st.loadFile(id);
    Object.assign(cur, { fileId: id, name: node.name, parentId: node.parentId || st.ROOT });
    ed.loadDoc(doc);
    setDirty(false);
    showEditor();
    if (readonly) requestAnimationFrame(() => ed.zoomFit());
    filetab.setFolder(cur.parentId);
  } catch (e) {
    console.error(e);
    toast('ファイルを開けませんでした', 'error');
  }
}

async function save() {
  if (readonly) return false;
  if (!cur.fileId) { switchTab('file'); filetab.show('saveas'); return false; }
  if (!st.getNode(cur.fileId)) { await st.refresh().catch(() => {}); }
  if (!st.getNode(cur.fileId)) { cur.fileId = null; switchTab('file'); filetab.show('saveas'); return false; }
  cur.saving = true; updateTitle();
  try {
    await st.saveFile(cur.fileId, ed.getDoc());
    cur.saving = false;
    setDirty(false);
    toast('上書き保存しました', 'success', 1800);
    return true;
  } catch (e) {
    cur.saving = false; updateTitle();
    console.error(e);
    toast(saveError(e), 'error', 4500);
    return false;
  }
}

async function saveAs(name, parentId) {
  cur.saving = true; updateTitle();
  try {
    await st.refresh();
    const id = await st.createFile(name, parentId, ed.getDoc());
    const node = st.getNode(id);
    Object.assign(cur, { fileId: id, name: node.name, parentId });
    cur.saving = false;
    setDirty(false);
    toast(`「${node.name}」として保存しました`, 'success');
    filetab.setFolder(parentId);
    showEditor();
    return true;
  } catch (e) {
    cur.saving = false; updateTitle();
    console.error(e);
    toast(saveError(e), 'error', 4500);
    return false;
  }
}

async function makeCopy() {
  if (!cur.fileId) {
    toast('まだ保存されていないため、名前を付けて保存します', 'info');
    switchTab('file');
    filetab.show('saveas');
    return;
  }
  try {
    await st.refresh();
    const id = await st.createFile(`${cur.name} のコピー`, cur.parentId, ed.getDoc());
    toast(`「${st.getNode(id).name}」を作成しました`, 'success');
  } catch (e) { toast(saveError(e), 'error'); }
}

async function importHTML(file) {
  if (!(await confirmDiscard())) return;
  try {
    const { doc, title, relic } = await ex.importHTMLFile(file);
    Object.assign(cur, { fileId: null, name: title, parentId: cur.parentId || st.ROOT });
    ed.loadDoc(doc);
    setDirty(true);
    showEditor();
    toast(relic ? 'HTML ファイルを開きました（保存するにはストレージへ保存してください）' : 'HTML を取り込みました', 'success', 3600);
  } catch (e) {
    console.error(e);
    toast('HTML ファイルを読み込めませんでした', 'error');
  }
}

async function renameCurrent() {
  if (readonly) return;
  const name = await promptDialog('名前の変更', 'ドキュメント名', cur.name);
  if (!name || !name.trim()) return;
  if (cur.fileId && st.getNode(cur.fileId)) {
    try { cur.name = await st.renameNode(cur.fileId, name.trim()); } catch (e) { toast(saveError(e), 'error'); }
  } else cur.name = name.trim();
  updateTitle();
}

function saveError(e) {
  const m = String(e?.message || e);
  if (m.includes('PERMISSION_DENIED')) return '保存できません：データベースのアクセス権を確認してください';
  if (/size|too large|exceeds/i.test(m)) return '保存できません：データが大きすぎます（画像を減らしてください）';
  return '保存できませんでした：' + m;
}

/* =========================================================
   閲覧専用（スマホ）
   ========================================================= */
function applyReadonly() {
  readonly = phoneMQ.matches;
  document.body.classList.toggle('readonly', readonly);
  ed.setReadonly(readonly);
  if (readonly) {
    if (!['file', 'view'].includes(tab)) switchTab('view');
    requestAnimationFrame(() => ed.zoomFit());
  }
}

/* =========================================================
   起動処理（ログインなし：起動時はストレージを開く）
   ========================================================= */
async function start() {
  try { await st.refresh(); } catch (e) { console.error(e); toast('ストレージを読み込めませんでした：' + (e?.message || ''), 'error', 5000); }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  const settings = await st.loadSettings();
  if (settings.theme && settings.theme !== getThemePref()) { try { localStorage.setItem('relic-theme', settings.theme); } catch { /* ignore */ } applyTheme(); }
  ed.loadDoc(newDoc());
  updateTitle();
  applyReadonly();
  switchTab('file');
  filetab.show('open');
}

/* =========================================================
   起動
   ========================================================= */
function init() {
  bindBrandFallback();
  applyTheme();

  ed.initEditor($('#scroller'), $('#pages'), {
    onDirty: () => setDirty(true),
    onZoom: (z) => { $('#zoomLabel').textContent = Math.round(z * 100) + '%'; },
    isVisible: () => tab !== 'file' && !$('#app').hidden,
    onActive: () => {},
  });
  ribbon.initRibbon({ setTheme });
  find.initFind($('#pages'));
  filetab.initFileTab({
    current: () => ({ ...cur }),
    isReadonly: () => readonly,
    pageCount: () => ed.pageCount(),
    getDoc: () => ed.getDoc(),
    showEditor, newDocument, openFile, save, saveAs, makeCopy, importHTML, setTheme, getThemePref,
    setName: (n) => { cur.name = n; updateTitle(); },
    detach: () => { cur.fileId = null; setDirty(true); },
  });

  $$('.tabbar .tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.tab === 'file' && tab !== 'file') filetab.show('open');
    switchTab(t.dataset.tab);
  }));
  $('#themeToggle').addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  $('#docTitle').addEventListener('click', renameCurrent);
  $$('.quick [data-action]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (b.dataset.action === 'save') save();
      if (b.dataset.action === 'undo') ed.undo();
      if (b.dataset.action === 'redo') ed.redo();
    });
  });

  // ショートカット
  document.addEventListener('keydown', (e) => {
    if ($('#app').hidden || document.querySelector('.modal-backdrop')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (e.shiftKey) { switchTab('file'); filetab.show('saveas'); } else save(); }
    else if (k === 'f' && tab !== 'file') { e.preventDefault(); find.open(false); }
    else if (k === 'h' && tab !== 'file' && !readonly) { e.preventDefault(); find.open(true); }
    else if (k === 'p' && tab !== 'file') { e.preventDefault(); switchTab('file'); filetab.show('export'); }
  });

  window.addEventListener('beforeunload', (e) => { if (cur.dirty) { e.preventDefault(); e.returnValue = ''; } });
  phoneMQ.addEventListener?.('change', applyReadonly);
  window.addEventListener('resize', () => { if (readonly) ed.zoomFit(); });

  start();
}

init();

// デバッグ用（コンソールから参照可能）
window.relic = { ed, st, fmt, cur };
