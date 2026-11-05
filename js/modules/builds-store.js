/**
 * Library storage for big builds. The saved app state (localStorage, ~5 MB for everything) keeps small builds as
 * run-length text as before; a build too big for it goes to IndexedDB instead, and the state keeps only its index
 * record ({ id, name, size, added, declared, idb: true, n: blocks, kb }), so the Library lists it at once and the
 * blocks load when it is opened.
 *
 *   TH.builds.store.put(id, schem) -> Promise<{ bytes }>    blocks gzipped (CompressionStream; raw without it), palette, extras
 *   TH.builds.store.get(id)        -> Promise<schem | null>
 *   TH.builds.store.del(id)        -> Promise
 *   TH.builds.store.make(backend)  -> a store on another backend ({ get, put, del } returning promises: tests use a Map)
 *   TH.builds.store.ok()           -> Promise<boolean>        IndexedDB can be used here
 *
 * IndexedDB keeps typed arrays as they are (structured clone), so nothing is turned into text.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const DB = 'toolbox-builds', STORE = 'builds', VER = 1;
  const C = () => TH.builds.core;

  /** The IndexedDB backend (one database, one object store, key = build id). */
  function idbBackend() {
    let dbP = null;
    const open = () => dbP || (dbP = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('no IndexedDB')); return; }
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbP = null; rej(r.error || new Error('IndexedDB')); };
      r.onblocked = () => { dbP = null; rej(new Error('IndexedDB is blocked')); };
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error || new Error('IndexedDB'));
      t.onabort = () => rej(t.error || new Error('IndexedDB: the write was stopped (storage full?)'));
    }));
    return {
      get: (k) => tx('readonly', (st) => st.get(k)),
      put: (k, v) => tx('readwrite', (st) => st.put(v, k)),
      del: (k) => tx('readwrite', (st) => st.delete(k)),
    };
  }

  const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && !!(TH.builds.io && TH.builds.io.gzip);
  /** A schematic as one storable record. */
  async function encode(s) {
    const raw = new Uint8Array(s.blocks.buffer, s.blocks.byteOffset, s.blocks.byteLength);
    const rec = { v: 1, name: s.name, size: s.size.slice(), palette: s.palette.slice(), declared: s.declared || 0, extras: C().extrasOf(s) };
    if (canZip()) rec.z = await TH.builds.io.gzip(raw); else rec.raw = new Uint16Array(s.blocks);
    return rec;
  }
  async function decode(rec) {
    if (!rec || !rec.size || !rec.palette) return null;
    const n = rec.size[0] * rec.size[1] * rec.size[2];
    let blocks;
    if (rec.z) {
      const u = await TH.builds.io.gunzip(rec.z);
      if (u.byteLength !== n * 2) throw new Error('stored build has the wrong length');
      blocks = new Uint16Array(u.buffer, u.byteOffset, n);
      if (u.byteOffset & 1) blocks = new Uint16Array(blocks);
    } else blocks = rec.raw instanceof Uint16Array ? rec.raw : new Uint16Array(rec.raw);
    if (blocks.length !== n) throw new Error('stored build has the wrong length');
    const s = C().create(1, 1, 1, rec.name);
    s.size = rec.size.slice(); s.palette = rec.palette.slice(); s.blocks = blocks;
    if (rec.declared) s.declared = rec.declared;
    if (rec.extras) C().setExtras(s, rec.extras);
    return s;
  }
  function make(backend) {
    return {
      async put(id, s) { const rec = await encode(s); await backend.put(id, rec); return { bytes: rec.z ? rec.z.byteLength : rec.raw.byteLength }; },
      async get(id) { return decode(await backend.get(id)); },
      del: (id) => backend.del(id),
      encode, decode,
    };
  }
  const main = make(idbBackend());
  let okP = null;
  main.ok = () => okP || (okP = main.put('__probe', C().create(1, 1, 1, 'probe')).then(() => main.del('__probe')).then(() => true, () => false));
  main.make = make;
  /** A Map-backed backend (tests, and a stand-in where IndexedDB is not there). */
  main.memBackend = () => { const m = new Map(); return { map: m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); } }; };
  TH.builds.store = main;
})();
