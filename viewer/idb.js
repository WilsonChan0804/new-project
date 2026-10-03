/* A small promise wrapper round IndexedDB, for what must outlive the page:
 * the device's copy of a project's issues and markups, the changes made
 * without a connection that are still waiting to upload, and the record of
 * which projects are kept for offline use (store.js, offline.js).
 *
 * localStorage could not hold this: it caps out around 5 MB, and one issue
 * raised on site carries a picture of 150-300 kB until it has been uploaded.
 *
 *   items   k = scope + "\n" + id   { k, scope, item }           the server's copy
 *   queue   k = scope + "\n" + id   { k, scope, id, op, body, base, seq, at, ver, state, error }
 *   kv      any key -> any value                                   small records
 *
 * scope is "<who>|<project>": two people on one tablet never see or upload
 * each other's work.
 *
 * Every call resolves; when the browser has no usable IndexedDB (some
 * private windows) reads resolve empty and writes resolve false, and the
 * callers carry on in memory.
 */

const DB_NAME = "lwk-viewer";
const DB_VERSION = 1;

let _db = null;          // Promise<IDBDatabase | null>

function open() {
  if (_db) return _db;
  _db = new Promise((resolve) => {
    let req;
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) return resolve(null);
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        db.createObjectStore("items", { keyPath: "k" }).createIndex("scope", "scope");
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "k" }).createIndex("scope", "scope");
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading must not be held up by this one
      db.onversionchange = () => { try { db.close(); } catch (e) {} _db = null; };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return _db;
}

export async function available() {
  return !!(await open());
}

/* One transaction; fn gets the object store(s) and may return a request
   whose result is wanted. Resolves once the transaction has committed -
   "queued" must mean "on the disk". */
async function tx(stores, mode, fn) {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    let t, out;
    try { t = db.transaction(stores, mode); }
    catch (e) { _db = null; return resolve(undefined); }
    t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
    t.onerror = () => resolve(undefined);
    t.onabort = () => resolve(undefined);
    try {
      out = fn(Array.isArray(stores) ? stores.map((s) => t.objectStore(s)) : t.objectStore(stores));
    } catch (e) {
      try { t.abort(); } catch (e2) {}
      resolve(undefined);
    }
  });
}

export const key = (scope, id) => scope + "\n" + id;

export async function allIn(store, scope) {
  const r = await tx(store, "readonly", (s) => s.index("scope").getAll(IDBKeyRange.only(scope)));
  return Array.isArray(r) ? r : [];
}

export async function allOf(store) {
  const r = await tx(store, "readonly", (s) => s.getAll());
  return Array.isArray(r) ? r : [];
}

export async function getOne(store, k) {
  const r = await tx(store, "readonly", (s) => s.get(k));
  return r === undefined ? null : r;
}

/* puts: records (with their k); dels: keys. True when it is on the disk. */
export async function write(store, puts, dels) {
  if (!(puts && puts.length) && !(dels && dels.length)) return true;
  const r = await tx(store, "readwrite", (s) => {
    for (const v of puts || []) s.put(v);
    for (const k of dels || []) s.delete(k);
    return { result: true };
  });
  return r === true;
}

export async function clearScope(store, scope) {
  const rows = await allIn(store, scope);
  return write(store, [], rows.map((r) => r.k));
}

export async function kvGet(k) {
  const r = await tx("kv", "readonly", (s) => s.get(k));
  return r === undefined ? null : r;
}

export async function kvSet(k, v) {
  const r = await tx("kv", "readwrite", (s) => { s.put(v, k); return { result: true }; });
  return r === true;
}

export async function kvDel(k) {
  const r = await tx("kv", "readwrite", (s) => { s.delete(k); return { result: true }; });
  return r === true;
}

/* Keys (and values) of kv that start with a prefix. */
export async function kvList(prefix) {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    const out = [];
    let t;
    try { t = db.transaction("kv", "readonly"); } catch (e) { return resolve(out); }
    const range = IDBKeyRange.bound(prefix, prefix + "￿");
    const c = t.objectStore("kv").openCursor(range);
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      out.push({ key: cur.key, value: cur.value });
      cur.continue();
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => resolve(out);
    t.onabort = () => resolve(out);
  });
}
