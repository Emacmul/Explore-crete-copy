/**
 * Offline Storage Service — abstracts persistent storage for offline
 * walks and map tiles.
 *
 * Currently uses:
 *   - IndexedDB for walk data and tile cache (binary blobs)
 *   - localStorage for the offline walk index (lightweight metadata)
 *
 * In a native build, swap this module for filesystem-based storage
 * (e.g. Capacitor Filesystem plugin) — all consumers import from here.
 */

// --- IndexedDB configuration ---
const DB_NAME = 'creteWalksOffline';
const DB_VERSION = 2;
const STORE_WALKS = 'walks';
const STORE_TILES = 'tiles';
const STORE_AUDIO = 'audio';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_WALKS)) {
        db.createObjectStore(STORE_WALKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TILES)) {
        db.createObjectStore(STORE_TILES, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Walk data (IndexedDB) ---

// `ownerEmail` (the account that downloaded this walk — see AuthContext.jsx) is stamped
// onto the record as `_owner_email` and used everywhere offline walks are listed or opened
// to make sure one account's paid offline content never shows up for a different account
// signed in on the same browser (audit finding U-04, 2026-09-09 review — see
// useOfflineWalks.jsx's reload() for where the filtering actually happens). Only one copy
// of a given walk is ever kept locally (indexed by walk id), so re-downloading it under a
// different account replaces the previous owner's copy rather than keeping both.
export async function saveWalkData(walk, ownerEmail) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALKS, 'readwrite');
    tx.objectStore(STORE_WALKS).put({ ...walk, _savedAt: Date.now(), _owner_email: (ownerEmail || '').toLowerCase().trim() || null });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getWalkData(walkId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALKS, 'readonly');
    const req = tx.objectStore(STORE_WALKS).get(walkId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllWalkData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALKS, 'readonly');
    const req = tx.objectStore(STORE_WALKS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeWalkData(walkId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALKS, 'readwrite');
    tx.objectStore(STORE_WALKS).delete(walkId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isWalkDataSaved(walkId) {
  const walk = await getWalkData(walkId);
  return !!walk;
}

export async function isWalkDataOutdated(serverWalk) {
  const stored = await getWalkData(serverWalk.id);
  if (!stored) return false;
  if (!serverWalk.updated_date) return false;
  const serverTime = new Date(serverWalk.updated_date).getTime();
  const storedTime = stored._savedAt || 0;
  return serverTime > storedTime;
}

// --- Tile cache (IndexedDB) ---

export async function cacheTile(url, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TILES, 'readwrite');
    tx.objectStore(STORE_TILES).put({ url, blob, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    // Was `() => resolve()` — a failed write (e.g. storage full, a real risk with large
    // tile/audio blobs) was silently counted as a success (audit re-check, 2026-09-09 —
    // finding U-02). preCacheWalkTiles's per-tile try/catch already correctly excludes a
    // failed tile from its `cached` count — it just needed this to actually throw.
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedTile(url) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TILES, 'readonly');
    const req = tx.objectStore(STORE_TILES).get(url);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

// --- Audio cache (IndexedDB) ---
// Stores downloaded narration audio blobs so the spoken narration — the core of the
// app — plays without an internet connection. Keyed by the audio URL, same model as
// the tile cache.

export async function cacheAudio(url, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).put({ url, blob, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    // Was `() => resolve()` — a failed write (e.g. storage full) was silently counted as a
    // success, so a walk could be marked "fully saved offline" with narration that was never
    // actually stored (audit re-check, 2026-09-09 — finding U-02). preCacheWalkAudio's
    // per-clip try/catch already correctly excludes a failed clip from its `cached` count —
    // it just needed this to actually throw so that catch runs.
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedAudio(url) {
  if (!url) return null;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(url);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

export async function removeAudioUrl(url) {
  if (!url) return;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function removeAudioUrls(urls) {
  await Promise.all((urls || []).map(removeAudioUrl));
}

// --- Offline walk index (localStorage) ---
// Lightweight metadata for quick sync checks; the full walk data is in IndexedDB.

const INDEX_KEY = 'crete_walks_offline';

export function getIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setIndex(data) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(data));
}

export function addToIndex(walk) {
  const stored = getIndex();
  stored[walk.id] = { ...walk, downloaded_at: new Date().toISOString() };
  setIndex(stored);
  return stored;
}

export function removeFromIndex(walkId) {
  const stored = getIndex();
  delete stored[walkId];
  setIndex(stored);
  return stored;
}

export function isInIndex(walkId) {
  return !!getIndex()[walkId];
}

export function getIndexedWalk(walkId) {
  return getIndex()[walkId] || null;
}

export function getAllIndexedWalks() {
  return Object.values(getIndex());
}