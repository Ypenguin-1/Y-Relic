// 「ファイル」タブ：ストレージ / 名前を付けて保存 / 出力 / 設定
import { $, $$, esc, toast, openDialog, promptDialog, confirmDialog, showContextMenu, formatDate } from './ui.js';
import * as st from './storage.js';
import * as ex from './export.js';
import { normalizeDoc } from './docmodel.js';

let ctx;            // app.js から渡される操作群
let folder = st.ROOT;
let filter = '';
let panel = 'open';

export function initFileTab(c) {
  ctx = c;
  $$('.file-sidebar [data-fs]').forEach((b) => b.addEventListener('click', () => onSidebar(b.dataset.fs)));
  $('#htmlInput').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await ctx.importHTML(f);
  });
}

async function onSidebar(key) {
  switch (key) {
    case 'back': ctx.showEditor(); break;
    case 'new': await ctx.newDocument(); break;
    case 'save': await ctx.save(); render(); break;
    case 'copy': await ctx.makeCopy(); render(); break;
    default: show(key);
  }
}

export function show(name = panel) {
  panel = name;
  $$('.file-sidebar [data-fs]').forEach((b) => b.classList.toggle('active', b.dataset.fs === name));
  render();
}

export function render() {
  const main = $('#fileMain');
  if (!main) return;
  if (panel === 'open') renderBrowser(main);
  else if (panel === 'saveas') renderSaveAs(main);
  else if (panel === 'export') renderExport(main);
  else if (panel === 'settings') renderSettings(main);
}

export function setFolder(id) { folder = id || st.ROOT; }

/* =========================================================
   ストレージ（開く）
   ========================================================= */
function crumbsHTML(current) {
  const path = current === st.ROOT ? [] : st.pathOf(current);
  const parts = [`<button data-folder="${st.ROOT}" class="${current === st.ROOT ? 'cur' : ''}"><i class="fa-solid fa-hard-drive"></i> ストレージ</button>`];
  path.forEach((n, i) => parts.push(`<i class="fa-solid fa-chevron-right sep"></i><button data-folder="${n.id}" class="${i === path.length - 1 ? 'cur' : ''}">${esc(n.name)}</button>`));
  return parts.join('');
}

function renderBrowser(main) {
  if (folder !== st.ROOT && !st.getNode(folder)) folder = st.ROOT;
  const ro = ctx.isReadonly();
  const list = filter
    ? st.allNodes().filter((n) => n.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ja') : a.type === 'folder' ? -1 : 1))
    : st.children(folder);
  const curId = ctx.current().fileId;
  main.innerHTML = `
    <h1 class="fm-title"><i class="fa-regular fa-folder-open"></i>開く</h1>
    <div class="fm-toolbar">
      <button class="btn primary edit-only" data-act="newdoc"><i class="fa-solid fa-file-circle-plus"></i>新しいドキュメント</button>
      <button class="btn edit-only" data-act="newfolder"><i class="fa-solid fa-folder-plus"></i>新しいフォルダー</button>
      <button class="btn edit-only" data-act="import"><i class="fa-brands fa-html5"></i>HTML ファイルを開く</button>
      <span class="grow"></span>
      <label class="fm-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="すべてのファイルを検索" value="${esc(filter)}"></label>
      <button class="icon-btn" data-act="refresh" title="更新"><i class="fa-solid fa-rotate"></i></button>
    </div>
    <div class="crumbs">${filter ? `<span class="cur"><i class="fa-solid fa-magnifying-glass"></i> 「${esc(filter)}」の検索結果</span>` : crumbsHTML(folder)}</div>
    <div class="file-list">
      <div class="fl-head"><span>名前</span><span>更新日時</span><span></span></div>
      ${list.length ? list.map((n) => `
        <div class="fl-row ${n.id === curId ? 'current' : ''}" data-id="${n.id}" data-type="${n.type}" draggable="${ro ? 'false' : 'true'}">
          <div class="fl-name"><i class="${n.type === 'folder' ? 'fa-solid fa-folder' : 'fa-solid fa-file-lines'}"></i><span title="${esc(n.name)}">${esc(n.name)}</span></div>
          <div class="fl-date">${formatDate(n.updatedAt)}</div>
          <button class="icon-btn" data-menu title="その他の操作"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        </div>`).join('') : `<div class="fl-empty"><i class="fa-regular fa-folder-open"></i>${filter ? '一致するファイルはありません' : 'このフォルダーは空です'}</div>`}
    </div>`;

  main.querySelector('[data-act=newdoc]')?.addEventListener('click', () => ctx.newDocument(folder));
  main.querySelector('[data-act=newfolder]')?.addEventListener('click', async () => {
    const name = await promptDialog('新しいフォルダー', 'フォルダー名', '新しいフォルダー');
    if (name === null) return;
    try { await st.createFolder(name, folder); render(); } catch (e) { fail(e); }
  });
  main.querySelector('[data-act=import]')?.addEventListener('click', () => $('#htmlInput').click());
  main.querySelector('[data-act=refresh]').addEventListener('click', async () => { await st.refresh(); render(); });
  const search = main.querySelector('.fm-search input');
  search.addEventListener('input', () => {
    filter = search.value.trim();
    const pos = search.selectionStart;
    render();
    const s2 = $('#fileMain .fm-search input');
    s2.focus(); s2.setSelectionRange(pos, pos);
  });
  main.querySelectorAll('.crumbs [data-folder]').forEach((b) => {
    b.addEventListener('click', () => { folder = b.dataset.folder; render(); });
    bindDrop(b, b.dataset.folder);
  });
  main.querySelectorAll('.fl-row').forEach((row) => {
    const n = st.getNode(row.dataset.id);
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-menu]')) { const r = e.target.closest('[data-menu]').getBoundingClientRect(); rowMenu(n, r.left - 150, r.bottom); return; }
      openNode(n);
    });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(n, e.clientX, e.clientY); });
    if (!ro) {
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/relic-node', n.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      if (n.type === 'folder') bindDrop(row, n.id);
    }
  });
}

function bindDrop(el, targetId) {
  if (ctx.isReadonly()) return;
  el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/relic-node')) { e.preventDefault(); el.classList.add('drop-target'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/relic-node');
    if (!id || id === targetId) return;
    try { if (await st.moveNode(id, targetId)) { toast('移動しました', 'success'); render(); } } catch (err) { fail(err); }
  });
}

function openNode(n) {
  if (n.type === 'folder') { folder = n.id; filter = ''; render(); return; }
  ctx.openFile(n.id);
}

function rowMenu(n, x, y) {
  const ro = ctx.isReadonly();
  const items = [{ icon: n.type === 'folder' ? 'fa-regular fa-folder-open' : 'fa-regular fa-file', label: '開く', action: () => openNode(n) }];
  if (n.type === 'file') {
    items.push({ icon: 'fa-solid fa-file-pdf', label: 'PDF 化', action: () => quickPdf(n) });
  }
  if (!ro) {
    items.push('-',
      { icon: 'fa-solid fa-pen', label: '名前の変更', action: () => renameNode(n) },
      { icon: 'fa-solid fa-folder-tree', label: 'ファイルの場所を指定（移動）', action: () => moveNodeDialog(n) });
    if (n.type === 'file') items.push({ icon: 'fa-regular fa-copy', label: 'コピーを作成', action: async () => { try { await st.copyFile(n.id); toast('コピーを作成しました', 'success'); render(); } catch (e) { fail(e); } } });
    items.push('-', { icon: 'fa-solid fa-trash', label: '削除', danger: true, action: () => deleteNodeDialog(n) });
  }
  showContextMenu(x, y, items);
}

async function renameNode(n) {
  const name = await promptDialog('名前の変更', n.type === 'folder' ? 'フォルダー名' : 'ファイル名', n.name);
  if (name === null || !name.trim()) return;
  try {
    const nm = await st.renameNode(n.id, name);
    if (ctx.current().fileId === n.id) ctx.setName(nm);
    render();
  } catch (e) { fail(e); }
}

async function moveNodeDialog(n) {
  const target = await pickFolder('ファイルの場所を指定', n.parentId || st.ROOT, n.type === 'folder' ? n.id : null);
  if (target === null) return;
  try { if (await st.moveNode(n.id, target)) { toast('移動しました', 'success'); render(); } } catch (e) { fail(e); }
}

async function deleteNodeDialog(n) {
  const msg = n.type === 'folder' ? `フォルダー「${n.name}」と中のファイルをすべて削除します。元に戻せません。` : `「${n.name}」を削除します。元に戻せません。`;
  if (!(await confirmDialog('削除', msg, { okLabel: '削除', danger: true }))) return;
  try {
    const ids = await st.deleteNode(n.id);
    if (ids.includes(ctx.current().fileId)) ctx.detach();
    toast('削除しました', 'success');
    render();
  } catch (e) { fail(e); }
}

async function quickPdf(n) {
  const target = await ex.pickSaveTarget(`${n.name}.pdf`, 'pdf');
  if (!target) return;
  try {
    toast('PDF を作成しています…');
    const doc = normalizeDoc(await st.loadFile(n.id));
    await ex.exportPDF(doc, { paper: doc.layout.size, pages: [...Array(doc.pages).keys()], target });
    toast('PDF を出力しました', 'success');
  } catch (e) { fail(e); }
}

/* ---------- フォルダー選択 ---------- */
function treeHTML(selected, excludeId) {
  const rows = [];
  const walk = (parentId, depth) => {
    st.children(parentId).filter((n) => n.type === 'folder').forEach((f) => {
      const disabled = excludeId && (f.id === excludeId || st.isDescendant(f.id, excludeId));
      rows.push(`<button type="button" class="ft-item ${selected === f.id ? 'selected' : ''}" data-id="${f.id}" style="padding-left:${12 + depth * 18}px" ${disabled ? 'disabled' : ''}><i class="fa-solid fa-folder"></i>${esc(f.name)}</button>`);
      walk(f.id, depth + 1);
    });
  };
  rows.push(`<button type="button" class="ft-item ${selected === st.ROOT ? 'selected' : ''}" data-id="${st.ROOT}"><i class="fa-solid fa-hard-drive" style="color:var(--main-strong)"></i>ストレージ（最上位）</button>`);
  walk(st.ROOT, 1);
  return rows.join('');
}

function bindTree(container, onSelect) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('.ft-item');
    if (!b || b.disabled) return;
    container.querySelectorAll('.ft-item').forEach((x) => x.classList.toggle('selected', x === b));
    onSelect(b.dataset.id);
  });
}

async function pickFolder(title, current, excludeId) {
  let sel = current;
  const r = await openDialog({
    title,
    content: `<div class="folder-tree">${treeHTML(current, excludeId)}</div>
              <div style="display:flex;gap:6px"><input class="input" data-newname placeholder="新しいフォルダー名" style="flex:1">
              <button type="button" class="btn small" data-newf><i class="fa-solid fa-folder-plus"></i>作成</button></div>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: 'ここに移動', value: true, primary: true }],
    onOpen: (f) => {
      const tree = f.querySelector('.folder-tree');
      bindTree(tree, (id) => { sel = id; });
      const input = f.querySelector('[data-newname]');
      const create = async () => {
        const name = input.value.trim();
        if (!name) return;
        try { sel = await st.createFolder(name, sel); tree.innerHTML = treeHTML(sel, excludeId); input.value = ''; } catch (e) { fail(e); }
      };
      f.querySelector('[data-newf]').addEventListener('click', create);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    },
  });
  return r.value ? sel : null;
}

/* =========================================================
   名前を付けて保存
   ========================================================= */
function renderSaveAs(main) {
  const cur = ctx.current();
  let sel = cur.parentId && (cur.parentId === st.ROOT || st.getNode(cur.parentId)) ? cur.parentId : folder;
  main.innerHTML = `
    <h1 class="fm-title"><i class="fa-solid fa-file-pen"></i>名前を付けて保存</h1>
    <div class="card">
      <h3><i class="fa-solid fa-signature"></i>ファイル名</h3>
      <input class="input" id="saName" value="${esc(cur.name)}" maxlength="120">
    </div>
    <div class="card">
      <h3><i class="fa-solid fa-folder-tree"></i>保存先（ファイルの場所）</h3>
      <div class="folder-tree" id="saTree">${treeHTML(sel)}</div>
      <div class="actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn small" id="saNewFolder"><i class="fa-solid fa-folder-plus"></i>新しいフォルダー</button>
      </div>
      <div class="actions">
        <button class="btn primary" id="saSave"><i class="fa-solid fa-floppy-disk"></i>保存</button>
      </div>
    </div>`;
  const tree = $('#saTree');
  bindTree(tree, (id) => { sel = id; });
  $('#saNewFolder').addEventListener('click', async () => {
    const name = await promptDialog('新しいフォルダー', 'フォルダー名', '新しいフォルダー');
    if (name === null) return;
    try { sel = await st.createFolder(name, sel); tree.innerHTML = treeHTML(sel); } catch (e) { fail(e); }
  });
  const doSave = async () => {
    const name = $('#saName').value.trim();
    if (!name) { toast('ファイル名を入力してください', 'error'); return; }
    await ctx.saveAs(name, sel);
  };
  $('#saSave').addEventListener('click', doSave);
  $('#saName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
  setTimeout(() => { const i = $('#saName'); i?.focus(); i?.select(); }, 30);
}

/* =========================================================
   出力
   ========================================================= */
function renderExport(main) {
  const cur = ctx.current();
  const pages = ctx.pageCount();
  const size = ctx.getDoc().layout.size;
  const canPick = 'showSaveFilePicker' in window;
  main.innerHTML = `
    <h1 class="fm-title"><i class="fa-solid fa-file-export"></i>出力</h1>
    <div class="card">
      <h3><i class="fa-regular fa-file"></i>「${esc(cur.name)}」（${pages} ページ）</h3>
      <div class="form-grid">
        <label>形式</label>
        <div class="seg" id="exFormat">
          <label><input type="radio" name="fmt" value="pdf" checked><i class="fa-solid fa-file-pdf"></i>PDF</label>
          <label><input type="radio" name="fmt" value="image"><i class="fa-solid fa-file-image"></i>画像</label>
          <label><input type="radio" name="fmt" value="html"><i class="fa-solid fa-file-code"></i>HTML</label>
        </div>
        <label class="ex-paper">用紙サイズ</label>
        <div class="seg ex-paper">
          ${['A3', 'A4', 'A5', 'B4', 'B5'].map((p) => `<label><input type="radio" name="paper" value="${p}" ${p === size ? 'checked' : ''}>${p}</label>`).join('')}
        </div>
        <label class="ex-img">画像形式</label>
        <div class="seg ex-img">
          <label><input type="radio" name="imgfmt" value="png" checked>PNG</label>
          <label><input type="radio" name="imgfmt" value="jpg">JPEG</label>
        </div>
        <label class="ex-page">ページ</label>
        <div class="ex-page">
          <div class="seg">
            <label><input type="radio" name="range" value="all" checked>すべて</label>
            <label><input type="radio" name="range" value="custom">ページ指定</label>
          </div>
          <input class="input" id="exRange" placeholder="例: 1-3, 5" style="margin-top:8px" disabled>
          <p class="hint">複数ページの画像は ZIP にまとめて出力します。</p>
        </div>
        <label>ファイル名</label>
        <input class="input" id="exName" value="${esc(cur.name)}">
      </div>
      <p class="hint">${canPick ? '<i class="fa-solid fa-circle-info"></i> 「出力」を押すと保存先を選べます。' : '<i class="fa-solid fa-circle-info"></i> このブラウザでは保存先の選択に対応していないため、ダウンロードフォルダーに保存されます（ブラウザ設定で「保存先を毎回確認」を有効にすると選択できます）。'}</p>
      <div class="progress" id="exProgress" hidden><div></div></div>
      <div class="actions"><button class="btn primary" id="exRun"><i class="fa-solid fa-file-export"></i>出力</button></div>
    </div>`;
  const sync = () => {
    const f = main.querySelector('input[name=fmt]:checked').value;
    main.querySelectorAll('.ex-paper, .ex-page').forEach((el) => { el.hidden = f === 'html'; });
    main.querySelectorAll('.ex-img').forEach((el) => { el.hidden = f !== 'image'; });
    $('#exRange').disabled = main.querySelector('input[name=range]:checked').value !== 'custom';
  };
  main.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', sync));
  sync();
  $('#exRun').addEventListener('click', async () => {
    const f = main.querySelector('input[name=fmt]:checked').value;
    const paper = main.querySelector('input[name=paper]:checked').value;
    const imgfmt = main.querySelector('input[name=imgfmt]:checked').value;
    const name = $('#exName').value.trim() || cur.name;
    const doc = ctx.getDoc();
    let pageList;
    try {
      pageList = main.querySelector('input[name=range]:checked').value === 'custom' ? ex.parseRange($('#exRange').value, doc.pages) : [...Array(doc.pages).keys()];
    } catch (e) { toast(e.message, 'error'); return; }
    const ext = f === 'pdf' ? 'pdf' : f === 'html' ? 'html' : (pageList.length > 1 ? 'zip' : imgfmt);
    const target = await ex.pickSaveTarget(`${name}.${ext}`, ext);
    if (!target) return;
    const btn = $('#exRun');
    const prog = $('#exProgress');
    btn.disabled = true;
    prog.hidden = false;
    const bar = prog.firstElementChild;
    bar.style.width = '5%';
    const onProgress = (p) => { bar.style.width = Math.round(5 + p * 90) + '%'; };
    try {
      if (f === 'pdf') await ex.exportPDF(doc, { paper, pages: pageList, target, onProgress });
      else if (f === 'image') await ex.exportImages(doc, { paper, pages: pageList, format: imgfmt, target, baseName: name, onProgress });
      else await ex.exportHTML(doc, { title: name, target });
      bar.style.width = '100%';
      toast(`${target.name} を出力しました`, 'success');
    } catch (e) { fail(e); } finally {
      btn.disabled = false;
      setTimeout(() => { prog.hidden = true; bar.style.width = '0'; }, 800);
    }
  });
}

/* =========================================================
   設定
   ========================================================= */
function renderSettings(main) {
  const theme = ctx.getThemePref();
  main.innerHTML = `
    <h1 class="fm-title"><i class="fa-solid fa-gear"></i>設定</h1>
    <div class="card">
      <h3><i class="fa-solid fa-circle-half-stroke"></i>表示モード</h3>
      <div class="seg" id="setTheme">
        <label><input type="radio" name="theme" value="light" ${theme === 'light' ? 'checked' : ''}><i class="fa-solid fa-sun"></i>ライト</label>
        <label><input type="radio" name="theme" value="dark" ${theme === 'dark' ? 'checked' : ''}><i class="fa-solid fa-moon"></i>ダーク</label>
        <label><input type="radio" name="theme" value="system" ${theme === 'system' ? 'checked' : ''}><i class="fa-solid fa-desktop"></i>システムに合わせる</label>
      </div>
      <p class="hint">用紙は印刷結果と同じく常に白で表示されます。</p>
    </div>
    <div class="card">
      <h3><i class="fa-solid fa-circle-info"></i>Relic について</h3>
      <p class="hint" style="margin:0">Relic v1.0 — 過去問・レポートをひとつに。</p>
    </div>`;
  main.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => ctx.setTheme(r.value)));
}

function fail(e) {
  console.error(e);
  toast(e?.message?.includes('PERMISSION_DENIED') ? 'アクセス権がありません（データベースのルールを確認してください）' : (e?.message || 'エラーが発生しました'), 'error', 4200);
}
