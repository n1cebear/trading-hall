/**
 * Builds worker: the heavy work for big builds, off the page (loaded with new Worker('js/modules/builds-worker.js')).
 *
 *   { type: 'load', file | bytes, name }   -> progress messages, then { type: 'loaded', s } (s.blocks transferred)
 *   { type: 'pal', id, palette, glass }    -> sets up the palette tables of one build for meshing (no answer)
 *   { type: 'chunk', job }                 -> { type: 'chunk', id, out } (TH.builds.chunks.mesh; buffers transferred)
 *
 * It runs the same files as the page (block table, model, reader, pure mesher), so results are identical to the
 * main-thread fallback. Errors go back as { type: 'error', message, user }.
 */
self.window = self;
self.TH = self.TH || { data: {}, langData: {} };
try {
  importScripts('../data/block-db.js', 'builds-core.js', 'builds-io.js', 'builds-view.js');
  self.TH.icon = self.TH.icon || function () { return null; };
  postMessage({ type: 'ready' });
} catch (e) {
  postMessage({ type: 'error', boot: true, message: String(e && e.message || e) });
}

const pals = new Map();   // build id -> palette tables for the mesher

self.onmessage = async (ev) => {
  const m = ev.data || {};
  try {
    if (m.type === 'load') {
      let last = 0;
      const onProgress = (stage, f) => {
        const now = Date.now();
        if (now - last < 80 && f > 0 && f < 1) return;
        last = now;
        postMessage({ type: 'progress', stage, f });
      };
      const s = await TH.builds.io.load(m.file || { name: m.name, bytes: m.bytes }, { onProgress });
      postMessage({ type: 'loaded', s }, [s.blocks.buffer]);
    } else if (m.type === 'pal') {
      pals.set(m.id, TH.builds.chunks.tables(m.palette, { glass: m.glass }));
      if (pals.size > 4) pals.delete(pals.keys().next().value);
    } else if (m.type === 'chunk') {
      const T = pals.get(m.job.pal);
      if (!T) { postMessage({ type: 'chunk', id: m.job.id, out: null }); return; }
      const out = TH.builds.chunks.mesh(m.job, T);
      postMessage({ type: 'chunk', id: m.job.id, out }, TH.builds.chunks.transfers(out));
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.job && m.job.id, message: String(e && e.message || e), user: !!(e && e.user) });
  }
};
