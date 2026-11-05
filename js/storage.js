// ストレージ：Firebase Realtime Database にフォルダー/ファイルを保存
// users/{uid}/nodes/{id} : { name, type: 'folder'|'file', parentId, createdAt, updatedAt }
// users/{uid}/docs/{id}  : ドキュメント本体
// users/{uid}/settings   : 設定
import { db, ref, get, update, push } from './firebase.js';

export const ROOT = 'root';
let uid = null;
let nodes = {};

export function setUser(u) { uid = u?.uid || null; nodes = {}; }
const base = () => { if (!uid) throw new Error('not signed in'); return `users/${uid}`; };

export async function refresh() {
  const snap = await get(ref(db, `${base()}/nodes`));
  nodes = snap.val() || {};
  return nodes;
}
export const getNode = (id) => (id && nodes[id] ? { id, ...nodes[id] } : null);
export const allNodes = () => Object.entries(nodes).map(([id, n]) => ({ id, ...n }));

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
export function children(parentId = ROOT) {
  return allNodes()
    .filter((n) => (n.parentId || ROOT) === parentId)
    .sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'folder' ? -1 : 1));
}
export function folders() { return allNodes().filter((n) => n.type === 'folder'); }

/** ルートからのパス（フォルダーの配列） */
export function pathOf(id) {
  const path = [];
  let n = getNode(id);
  const seen = new Set();
  while (n && !seen.has(n.id)) { seen.add(n.id); path.unshift(n); n = getNode(n.parentId); }
  return path;
}

export function isDescendant(id, ancestorId) {
  let n = getNode(id);
  const seen = new Set();
  while (n && !seen.has(n.id)) {
    if (n.parentId === ancestorId) return true;
    seen.add(n.id);
    n = getNode(n.parentId);
  }
  return false;
}

export function uniqueName(name, parentId, type, excludeId = null) {
  const names = new Set(children(parentId).filter((n) => n.type === type && n.id !== excludeId).map((n) => n.name));
  if (!names.has(name)) return name;
  for (let i = 2; ; i++) { const c = `${name} (${i})`; if (!names.has(c)) return c; }
}

const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120);

export async function createFolder(name, parentId = ROOT) {
  const id = push(ref(db, `${base()}/nodes`)).key;
  const now = Date.now();
  const node = { name: uniqueName(cleanName(name) || '新しいフォルダー', parentId, 'folder'), type: 'folder', parentId, createdAt: now, updatedAt: now };
  await update(ref(db), { [`${base()}/nodes/${id}`]: node });
  nodes[id] = node;
  return id;
}

export async function createFile(name, parentId, doc) {
  const id = push(ref(db, `${base()}/nodes`)).key;
  const now = Date.now();
  const node = { name: uniqueName(cleanName(name) || '無題のドキュメント', parentId, 'file'), type: 'file', parentId, createdAt: now, updatedAt: now };
  await update(ref(db), { [`${base()}/nodes/${id}`]: node, [`${base()}/docs/${id}`]: doc });
  nodes[id] = node;
  return id;
}

export async function saveFile(id, doc) {
  const now = Date.now();
  await update(ref(db), { [`${base()}/docs/${id}`]: doc, [`${base()}/nodes/${id}/updatedAt`]: now });
  if (nodes[id]) nodes[id].updatedAt = now;
}

export async function loadFile(id) {
  const snap = await get(ref(db, `${base()}/docs/${id}`));
  return snap.val();
}

export async function renameNode(id, name) {
  const n = getNode(id);
  if (!n) return null;
  const nm = uniqueName(cleanName(name) || n.name, n.parentId, n.type, id);
  const now = Date.now();
  await update(ref(db), { [`${base()}/nodes/${id}/name`]: nm, [`${base()}/nodes/${id}/updatedAt`]: now });
  nodes[id].name = nm;
  nodes[id].updatedAt = now;
  return nm;
}

export async function moveNode(id, parentId) {
  const n = getNode(id);
  if (!n || n.parentId === parentId || id === parentId) return false;
  if (n.type === 'folder' && isDescendant(parentId, id)) throw new Error('フォルダーをその中に移動することはできません');
  const nm = uniqueName(n.name, parentId, n.type, id);
  await update(ref(db), { [`${base()}/nodes/${id}/parentId`]: parentId, [`${base()}/nodes/${id}/name`]: nm });
  nodes[id].parentId = parentId;
  nodes[id].name = nm;
  return true;
}

export async function copyFile(id, parentId = null, name = null) {
  const n = getNode(id);
  if (!n || n.type !== 'file') return null;
  const doc = await loadFile(id);
  return createFile(name || `${n.name} のコピー`, parentId ?? n.parentId ?? ROOT, doc || {});
}

export async function deleteNode(id) {
  const ids = [];
  const collect = (nid) => { ids.push(nid); children(nid).forEach((c) => collect(c.id)); };
  collect(id);
  const patch = {};
  ids.forEach((nid) => {
    patch[`${base()}/nodes/${nid}`] = null;
    if (nodes[nid]?.type === 'file') patch[`${base()}/docs/${nid}`] = null;
  });
  await update(ref(db), patch);
  ids.forEach((nid) => delete nodes[nid]);
  return ids;
}

export async function loadSettings() {
  try { const s = await get(ref(db, `${base()}/settings`)); return s.val() || {}; } catch { return {}; }
}
export async function saveSettings(patch) {
  const p = {};
  Object.entries(patch).forEach(([k, v]) => { p[`${base()}/settings/${k}`] = v; });
  try { await update(ref(db), p); } catch { /* オフライン等は無視 */ }
}
