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
const DB_VERSION = 1;
const STORE_WALKS = 'walks';
const STORE_TILES = 'tiles';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Walk data (IndexedDB) ---

export async function saveWalkData(walk) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALKS, 'readwrite');
    tx.objectStore(STORE_WALKS).put({ ...walk, _savedAt: Date.now() });
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
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TILES, 'readwrite');
    tx.objectStore(STORE_TILES).put({ url, blob, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
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