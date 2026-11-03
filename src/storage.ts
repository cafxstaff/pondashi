import { DEFAULT_SETTINGS } from "./types";
import type { AppSettings, Pad } from "./types";

const PADS_KEY = "pondashi.pads.v1";
const SETTINGS_KEY = "pondashi.settings.v1";
const DB_NAME = "pondashi";
const FILE_STORE = "files";

// ---- ボタン配置・設定 (localStorage) ----

export function loadPads(): Pad[] {
  try {
    const raw = localStorage.getItem(PADS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Pad[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePads(pads: Pad[]) {
  localStorage.setItem(PADS_KEY, JSON.stringify(pads));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<AppSettings>) : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---- 音声ファイル本体 (IndexedDB) ----

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(FILE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function runRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(FILE_STORE, mode);
        const request = fn(tx.objectStore(FILE_STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function putFile(id: string, blob: Blob) {
  return runRequest("readwrite", (store) => store.put(blob, id));
}

export function getFile(id: string) {
  return runRequest<Blob | undefined>("readonly", (store) => store.get(id));
}

/** どのボタンからも参照されていないファイルを削除する */
export async function deleteUnusedFiles(usedIds: Set<string>) {
  const keys = await runRequest<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  const unused = keys.filter((key) => typeof key === "string" && !usedIds.has(key));
  await Promise.all(unused.map((key) => runRequest("readwrite", (store) => store.delete(key))));
}
