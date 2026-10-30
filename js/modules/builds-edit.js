/**
 * Builds quick editor model (pure, no DOM): a fixed canvas schematic you build in by hand, with undo / redo.
 *
 *   const W = TH.builds.edit.create([64, 64, 64])  or  create(schem, { pad })
 *   W.s                       the canvas (a normal schematic: palette, blocks, block entities)
 *   W.mirror = { x, y, z }    mirror planes through the middle of the canvas (W.planes(): m per axis); every edit is
 *                             mirrored with the block state mirrored too (stairs, doors ... turn the other way)
 *   cells: shapes as arrays of cell indices, for the ghost preview and for apply():
 *     W.brush(x, y, z, r, round) W.line(a, b, r) W.box(a, b, mode) W.ellipsoid(a, b, hollow) W.cylinder(a, b, hollow)
 *     W.cone(a, b) W.pyramid(a, b)  (a, b = opposite corners [x, y, z], inclusive)
 *   edits (one undo step each, return the dirty box [x0, y0, z0, x1, y1, z1] or null):
 *     W.apply(cells, id, mode)  mode 'place' (only into air), 'set' (overwrite), 'erase', 'paint' (only over blocks)
 *     W.flood(x, y, z, id)      the face-connected run of the same block becomes id (limit 200 000)
 *     W.fillLayer(x, y, z, id)  the closed air area of that layer around (x, z) is filled
 *     W.replace(box, from, to)  every `from` (base id) in the box (null = everywhere) becomes `to`, states kept
 *     W.extrude(x, y, z, n, out) push the flat face under the pointer one block out (or in)
 *     W.copy(box) -> clip; W.del(box); W.paste(clip, at, air); W.stack(box, n, step); W.move(box, d);
 *     W.flip(box, axis); W.turn(box, o) (any angle about X / Y / Z, see builds-rotate.js); W.scale(box, f)
 *     W.shade(box, o)           light shading baked into the blocks (builds-shade.js)
 *   W.undo() / W.redo() -> dirty box; W.canUndo(), W.canRedo(), W.history (labels)
 *   W.out()                   the blocks as a cropped schematic (export, Material List)
 *   W.grow(size, offset)      a bigger canvas, everything moved by offset (clears the history)
 * Block entities move with their block (move, stack, paste, turn, flip) and are dropped where their block is replaced
 * by a block of another kind.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const HIST_CELLS = 6e6;   // changed cells kept in the history before the oldest steps go
  const FLOOD_MAX = 200000;

  function create(src, o) {
    o = o || {};
    const core = C();
    let s;
    if (Array.isArray(src)) s = core.create(src[0], src[1], src[2], o.name || 'My build');
    else {
      const pad = o.pad == null ? 8 : o.pad, [a, b, c] = src.size;
      const size = [Math.max(o.min || 32, a + 2 * pad), Math.max(o.min || 32, b + pad), Math.max(o.min || 32, c + 2 * pad)];
      s = core.create(size[0], size[1], size[2], src.name || 'My build');
      const dx = Math.floor((size[0] - a) / 2), dz = Math.floor((size[2] - c) / 2);
      const map = src.palette.map((id) => core.pal(s, id));
      for (let y = 0; y < b; y++) for (let z = 0; z < c; z++) for (let x = 0; x < a; x++) { const v = src.blocks[(y * c + z) * a + x]; if (v) s.blocks[((y) * size[2] + z + dz) * size[0] + x + dx] = map[v]; }
      core.carry(src, s, dx, 0, dz);
      s.origin = null;
    }
    const W = { s, mirror: { x: false, y: false, z: false }, undoS: [], redoS: [], cur: null };
    const sz = () => W.s.size;
    const I = (x, y, z) => (y * sz()[2] + z) * sz()[0] + x;
    const inB = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sz()[0] && y < sz()[1] && z < sz()[2];
    const XYZ = (i) => { const [sx, , sz2] = sz(); return [i % sx, Math.floor(i / (sx * sz2)), Math.floor(i / sx) % sz2]; };
    W.I = I; W.inB = inB; W.XYZ = XYZ;
    W.planes = () => sz().slice();   // m = size: the plane through the middle (see TH.builds.sym)

    /* ---- the history ---- */
    function begin(label) { W.cur = { label, map: new Map(), beB: W.s.be ? W.s.be.slice() : null }; }
    /** Set one cell (with the mirrored cells); records the old value once. */
    function setI(i, v) {
      const B = W.s.blocks;
      if (B[i] === v) return;
      if (!W.cur.map.has(i)) W.cur.map.set(i, B[i]);
      B[i] = v;
    }
    const mirrorPal = new Map();
    function mirrorOf(v, axis) {
      if (!v) return 0;
      const k = v + '|' + axis;
      let m = mirrorPal.get(k);
      if (m == null) { const id = W.s.palette[v], sym = TH.builds.sym; m = sym ? C().pal(W.s, sym.mirrorState(id, axis)) : v; mirrorPal.set(k, m); }
      return m;
    }
    /** The cell and its mirrors (as [index, palette value]). */
    function withMirrors(x, y, z, v) {
      let out = [[x, y, z, v]];
      const [sx, sy, sz2] = sz(), ax = [['x', 0, sx], ['y', 1, sy], ['z', 2, sz2]];
      for (const [name, a, n] of ax) {
        if (!W.mirror[name]) continue;
        const more = [];
        for (const c of out) { const q = c.slice(); q[a] = n - 1 - q[a]; q[3] = mirrorOf(c[3], a); if (q[a] !== c[a]) more.push(q); }
        out = out.concat(more);
      }
      return out;
    }
    function commit() {
      const cur = W.cur;
      W.cur = null;
      if (!cur || !cur.map.size) return null;
      const n = cur.map.size, idx = new Int32Array(n), before = new Uint16Array(n), after = new Uint16Array(n);
      let k = 0, box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      cur.map.forEach((b, i) => {
        idx[k] = i; before[k] = b; after[k] = W.s.blocks[i]; k++;
        const [x, y, z] = XYZ(i);
        if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (z < box[2]) box[2] = z; if (x > box[3]) box[3] = x; if (y > box[4]) box[4] = y; if (z > box[5]) box[5] = z;
      });
      // block entities: those on a cell whose block changed kind are dropped (kept for undo)
      const beB = cur.beB;
      if (W.s.be && W.s.be.length) {
        const core = C();
        W.s.be = W.s.be.filter((b) => {
          const i = I(b.x, b.y, b.z);
          if (!cur.map.has(i)) return true;
          const v = W.s.blocks[i];
          return v && core.beKind(W.s.palette[v]) === core.beKind(W.s.palette[cur.map.get(i)]);
        });
      }
      if (cur.be) W.s.be = cur.be(W.s.be || []);
      const step = { label: cur.label, idx, before, after, box, beB, beA: W.s.be ? W.s.be.slice() : null };
      W.undoS.push(step); W.redoS = [];
      let total = W.undoS.reduce((t, st) => t + st.idx.length, 0);
      while (total > HIST_CELLS && W.undoS.length > 1) total -= W.undoS.shift().idx.length;
      if (W.undoS.length > 200) W.undoS.shift();
      if (TH.builds.detail && cur.connect !== false) TH.builds.detail.connect(W.s, [box[0] - 1, box[1] - 1, box[2] - 1, box[3] + 1, box[4] + 1, box[5] + 1]);
      return box;
    }
    function run(label, fn) { begin(label); try { fn(); } catch (e) { const c = W.cur; W.cur = null; if (c) c.map.forEach((b, i) => { W.s.blocks[i] = b; }); throw e; } return commit(); }
    const swapStep = (st, back) => {
      const B = W.s.blocks, src = back ? st.before : st.after;
      for (let k = 0; k < st.idx.length; k++) B[st.idx[k]] = src[k];
      W.s.be = back ? (st.beB ? st.beB.slice() : W.s.be) : (st.beA ? st.beA.slice() : W.s.be);
      return st.box;
    };
    W.undo = () => { const st = W.undoS.pop(); if (!st) return null; W.redoS.push(st); return swapStep(st, true); };
    W.redo = () => { const st = W.redoS.pop(); if (!st) return null; W.undoS.push(st); return swapStep(st, false); };
    W.canUndo = () => W.undoS.length > 0;
    W.canRedo = () => W.redoS.length > 0;
    W.history = () => W.undoS.map((st) => st.label);

    /* ---- shapes (cell lists) ---- */
    const norm = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    const clipBox = (bx) => [Math.max(0, bx[0]), Math.max(0, bx[1]), Math.max(0, bx[2]), Math.min(sz()[0] - 1, bx[3]), Math.min(sz()[1] - 1, bx[4]), Math.min(sz()[2] - 1, bx[5])];
    function inBox(bx, fn) {
      const out = [];
      const b = clipBox(bx);
      for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) for (let x = b[0]; x <= b[3]; x++) if (fn(x, y, z)) out.push(I(x, y, z));
      return out;
    }
    W.brush = (x, y, z, r, round) => { r = Math.max(0, (r | 0) - 1); if (!r) return inB(x, y, z) ? [I(x, y, z)] : []; return inBox([x - r, y - r, z - r, x + r, y + r, z + r], (a, b, c) => !round || (a - x) ** 2 + (b - y) ** 2 + (c - z) ** 2 <= (r + 0.45) ** 2); };
    W.line = (a, b, r) => {
      const set = new Set(), n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
      for (let k = 0; k <= n; k++) {
        const p = [0, 1, 2].map((q) => Math.round(a[q] + (b[q] - a[q]) * k / n));
        W.brush(p[0], p[1], p[2], r || 1, true).forEach((i) => set.add(i));
      }
      return [...set];
    };
    W.box = (a, b, mode) => {
      const B = norm(a, b);
      return inBox(B, (x, y, z) => {
        if (mode === 'solid' || !mode) return true;
        const ex = x === B[0] || x === B[3], ey = y === B[1] || y === B[4], ez = z === B[2] || z === B[5];
        if (mode === 'walls') return ex || ez;
        if (mode === 'frame') return (ex && ey) || (ex && ez) || (ey && ez);
        return ex || ey || ez;   // hollow
      });
    };
    const ellMask = (B, fn) => {
      const cx = (B[0] + B[3]) / 2, cy = (B[1] + B[4]) / 2, cz = (B[2] + B[5]) / 2, rx = (B[3] - B[0] + 1) / 2, ry = (B[4] - B[1] + 1) / 2, rz = (B[5] - B[2] + 1) / 2;
      return (x, y, z) => fn((x - cx) / rx, (y - cy) / ry, (z - cz) / rz, rx, ry, rz);
    };
    W.ellipsoid = (a, b, hollow) => {
      const B = norm(a, b), inside = ellMask(B, (u, v, w) => u * u + v * v + w * w <= 1.0001);
      return inBox(B, (x, y, z) => inside(x, y, z) && (!hollow || !inside(x + 1, y, z) || !inside(x - 1, y, z) || !inside(x, y + 1, z) || !inside(x, y - 1, z) || !inside(x, y, z + 1) || !inside(x, y, z - 1) || x === B[0] || x === B[3] || y === B[1] || y === B[4] || z === B[2] || z === B[5]));
    };
    W.cylinder = (a, b, hollow) => {
      const B = norm(a, b), inside = ellMask(B, (u, v, w) => u * u + w * w <= 1.0001);
      return inBox(B, (x, y, z) => inside(x, y, z) && (!hollow || !inside(x + 1, y, z) || !inside(x - 1, y, z) || !inside(x, y, z + 1) || !inside(x, y, z - 1)));
    };
    W.cone = (a, b) => {
      const B = norm(a, b), H = B[4] - B[1] + 1;
      return inBox(B, ellMask(B, (u, v, w) => { const t = (v + 1) / 2; return u * u + w * w <= Math.pow(1 - t + 0.5 / H, 2) + 1e-4; }));
    };
    W.pyramid = (a, b) => {
      const B = norm(a, b);
      return inBox(B, (x, y, z) => { const k = y - B[1]; return x >= B[0] + k && x <= B[3] - k && z >= B[2] + k && z <= B[5] - k; });
    };

    /* ---- edits ---- */
    W.apply = (cells, id, mode, label) => {
      const core = C(), v = id ? core.pal(W.s, id) : 0, B = W.s.blocks;
      return run(label || ({ erase: 'Erase', paint: 'Paint' }[mode] || 'Place'), () => {
        for (const i of cells) {
          const [x, y, z] = XYZ(i);
          for (const [X, Y, Z, V] of withMirrors(x, y, z, mode === 'erase' ? 0 : v)) {
            if (!inB(X, Y, Z)) continue;
            const j = I(X, Y, Z);
            if (mode === 'place' && B[j]) continue;
            if (mode === 'paint' && !B[j]) continue;
            setI(j, V);
          }
        }
      });
    };
    /**
     * A painting stroke: many adds, ONE undo step. add() returns the box it changed (for re-meshing as you paint),
     * end() commits and returns the box of the whole stroke.
     */
    W.stroke = (label) => {
      begin(label || 'Paint');
      const cur = W.cur;
      return {
        add(cells, id, mode) {
          if (W.cur !== cur) return null;
          const core = C(), v = id ? core.pal(W.s, id) : 0, B = W.s.blocks;
          let box = null;
          for (const i of cells) {
            const [x, y, z] = XYZ(i);
            for (const [X, Y, Z, V] of withMirrors(x, y, z, mode === 'erase' ? 0 : v)) {
              if (!inB(X, Y, Z)) continue;
              const j = I(X, Y, Z);
              if ((mode === 'place' && B[j]) || (mode === 'paint' && !B[j]) || B[j] === V) continue;
              setI(j, V);
              if (!box) box = [X, Y, Z, X, Y, Z];
              else { box[0] = Math.min(box[0], X); box[1] = Math.min(box[1], Y); box[2] = Math.min(box[2], Z); box[3] = Math.max(box[3], X); box[4] = Math.max(box[4], Y); box[5] = Math.max(box[5], Z); }
            }
          }
          return box;
        },
        end() { return W.cur === cur ? commit() : null; },
      };
    };
    W.flood = (x, y, z, id) => {
      if (!inB(x, y, z)) return null;
      const B = W.s.blocks, from = B[I(x, y, z)], v = C().pal(W.s, id);
      if (!from || from === v) return null;
      return run('Fill', () => {
        const st = [I(x, y, z)], seen = new Set(st);
        let n = 0;
        while (st.length && n < FLOOD_MAX) {
          const i = st.pop(), [a, b, c] = XYZ(i);
          for (const [X, Y, Z, V] of withMirrors(a, b, c, v)) if (inB(X, Y, Z) && B[I(X, Y, Z)] === from) setI(I(X, Y, Z), V);
          n++;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const X = a + dx, Y = b + dy, Z = c + dz;
            if (!inB(X, Y, Z)) continue;
            const j = I(X, Y, Z);
            if (!seen.has(j) && B[j] === from) { seen.add(j); st.push(j); }
          }
        }
      });
    };
    W.fillLayer = (x, y, z, id) => {
      if (!inB(x, y, z) || W.s.blocks[I(x, y, z)]) return null;
      const B = W.s.blocks, v = C().pal(W.s, id), [sx, , sz2] = sz();
      // the air area must be closed: if it reaches the canvas edge nothing is filled
      const seen = new Set([I(x, y, z)]), st = [[x, z]], cells = [];
      while (st.length) {
        const [a, c] = st.pop();
        cells.push(I(a, y, c));
        if (cells.length > FLOOD_MAX) return null;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = a + dx, Z = c + dz;
          if (X < 0 || Z < 0 || X >= sx || Z >= sz2) return null;
          const j = I(X, y, Z);
          if (!seen.has(j) && !B[j]) { seen.add(j); st.push([X, Z]); }
        }
      }
      return run('Fill area', () => { for (const i of cells) { const [a, b, c] = XYZ(i); for (const [X, Y, Z, V] of withMirrors(a, b, c, v)) if (inB(X, Y, Z) && !B[I(X, Y, Z)]) setI(I(X, Y, Z), V); } });
    };
    W.replace = (box, from, to) => {
      const core = C(), D = TH.builds.detail, fb = core.parse(from).base, tb = core.parse(to).base;
      const map = W.s.palette.map((id, i) => {
        if (!i || core.parse(id).base !== fb) return -1;
        return core.pal(W.s, D ? D.complete(core.stateOf(tb, core.parse(id).props)) : core.stateOf(tb, core.parse(id).props));
      });
      const b = box ? clipBox(box) : [0, 0, 0, sz()[0] - 1, sz()[1] - 1, sz()[2] - 1];
      return run('Replace', () => {
        const B = W.s.blocks;
        for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) for (let x = b[0]; x <= b[3]; x++) { const i = I(x, y, z), m = map[B[i]]; if (m >= 0 && m != null) setI(i, m); }
      });
    };
    /** The flat face region under (x, y, z) facing n ([dx, dy, dz]): connected cells in that plane with air beyond. */
    W.faceRegion = (x, y, z, n) => {
      const B = W.s.blocks, out = [];
      if (!inB(x, y, z) || !B[I(x, y, z)]) return out;
      const open = (a, b, c) => !inB(a + n[0], b + n[1], c + n[2]) || !B[I(a + n[0], b + n[1], c + n[2])];
      if (!open(x, y, z)) return out;
      const t = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].filter((v) => !(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]));
      const seen = new Set([I(x, y, z)]), st = [[x, y, z]];
      while (st.length && out.length < FLOOD_MAX) {
        const c = st.pop(); out.push(I(...c));
        for (const v of t) for (const sg of [1, -1]) {
          const q = [c[0] + v[0] * sg, c[1] + v[1] * sg, c[2] + v[2] * sg];
          if (!inB(...q)) continue;
          const j = I(...q);
          if (!seen.has(j) && B[j] && open(...q)) { seen.add(j); st.push(q); }
        }
      }
      return out;
    };
    W.extrude = (x, y, z, n, out) => {
      const reg = W.faceRegion(x, y, z, n);
      if (!reg.length) return null;
      const B = W.s.blocks;
      return run(out === false ? 'Push in' : 'Extrude', () => {
        for (const i of reg) {
          const [a, b, c] = XYZ(i);
          if (out === false) { for (const [X, Y, Z] of withMirrors(a, b, c, 0)) if (inB(X, Y, Z)) setI(I(X, Y, Z), 0); continue; }
          const q = [a + n[0], b + n[1], c + n[2]];
          if (!inB(...q)) continue;
          for (const [X, Y, Z, V] of withMirrors(q[0], q[1], q[2], B[i])) if (inB(X, Y, Z) && !B[I(X, Y, Z)]) setI(I(X, Y, Z), V);
        }
      });
    };

    /* ---- selections ---- */
    W.copy = (box) => {
      const b = clipBox(box), w = b[3] - b[0] + 1, h = b[4] - b[1] + 1, d = b[5] - b[2] + 1, core = C();
      const c = core.create(w, h, d, 'Clip');
      const map = new Map();
      for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        const v = W.s.blocks[I(x + b[0], y + b[1], z + b[2])];
        if (!v) continue;
        let m = map.get(v); if (m == null) { m = core.pal(c, W.s.palette[v]); map.set(v, m); }
        c.blocks[(y * d + z) * w + x] = m;
      }
      if (W.s.be) c.be = W.s.be.filter((e) => e.x >= b[0] && e.y >= b[1] && e.z >= b[2] && e.x <= b[3] && e.y <= b[4] && e.z <= b[5]).map((e) => Object.assign({}, e, { x: e.x - b[0], y: e.y - b[1], z: e.z - b[2] }));
      return c;
    };
    const clearBox = (b) => { const B = W.s.blocks; for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) for (let x = b[0]; x <= b[3]; x++) { const i = I(x, y, z); if (B[i]) setI(i, 0); } };
    /** Put a clip's blocks with its min corner at `at` (air in the clip leaves what is there unless air = true). */
    function stamp(clip, at, air) {
      const core = C(), [w, h, d] = clip.size, map = clip.palette.map((id) => core.pal(W.s, id));
      for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        const v = clip.blocks[(y * d + z) * w + x], X = x + at[0], Y = y + at[1], Z = z + at[2];
        if (!inB(X, Y, Z) || (!v && !air)) continue;
        for (const [a, b, c, V] of withMirrors(X, Y, Z, v ? map[v] : 0)) if (inB(a, b, c)) setI(I(a, b, c), V);
      }
      if (clip.be && clip.be.length) {
        const add = clip.be.map((e) => Object.assign({}, e, { x: e.x + at[0], y: e.y + at[1], z: e.z + at[2] })).filter((e) => inB(e.x, e.y, e.z));
        const prev = W.cur.be;   // several stamps in one step (Repeat) each add theirs
        W.cur.be = (list) => { const l = prev ? prev(list) : list; return l.filter((e) => !add.some((a) => a.x === e.x && a.y === e.y && a.z === e.z)).concat(add); };
      }
    }
    W.del = (box) => run('Delete', () => clearBox(clipBox(box)));
    W.paste = (clip, at, air) => run('Paste', () => stamp(clip, at, air));
    W.stack = (box, n, step) => {
      const clip = W.copy(box), b = clipBox(box);
      return run('Repeat', () => { for (let k = 1; k <= n; k++) stamp(clip, [b[0] + step[0] * k, b[1] + step[1] * k, b[2] + step[2] * k], false); });
    };
    W.move = (box, dlt) => {
      const clip = W.copy(box), b = clipBox(box);
      return run('Move', () => {
        clearBox(b);
        if (W.s.be) { const inside = (e) => e.x >= b[0] && e.y >= b[1] && e.z >= b[2] && e.x <= b[3] && e.y <= b[4] && e.z <= b[5]; const keep = W.s.be.filter((e) => !inside(e)); W.s.be = keep; }
        stamp(clip, [b[0] + dlt[0], b[1] + dlt[1], b[2] + dlt[2]], false);
      });
    };
    W.flip = (box, axis) => {
      const clip = W.copy(box), b = clipBox(box), sym = TH.builds.sym;
      const [w, h, d] = clip.size, o = C().create(w, h, d, 'Clip');
      o.palette = clip.palette.map((id) => (sym ? sym.mirrorState(id, axis) : id)); o._pi = null;
      for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        const X = axis === 0 ? w - 1 - x : x, Y = axis === 1 ? h - 1 - y : y, Z = axis === 2 ? d - 1 - z : z;
        o.blocks[(Y * d + Z) * w + X] = clip.blocks[(y * d + z) * w + x];
      }
      if (clip.be) o.be = clip.be.map((e) => Object.assign({}, e, { x: axis === 0 ? w - 1 - e.x : e.x, y: axis === 1 ? h - 1 - e.y : e.y, z: axis === 2 ? d - 1 - e.z : e.z }));
      return run('Flip', () => { clearBox(b); stamp(o, [b[0], b[1], b[2]], false); });
    };
    /** Turn the selection about its centre (any angle, any axis); it stays centred where it was. */
    W.turn = (box, o) => {
      const clip = W.copy(box), b = clipBox(box), r = TH.builds.rotate.rotate(clip, Object.assign({ pivot: 'centre' }, o));
      if (r === clip) return null;
      const at = [0, 1, 2].map((a) => Math.round((b[a] + b[a + 3] + 1) / 2 - r.size[a] / 2));
      at[1] = Math.max(0, at[1]);
      return run('Turn', () => { clearBox(b); stamp(r, at, false); });
    };
    W.scale = (box, f) => {
      const clip = W.copy(box), b = clipBox(box), [w, h, d] = clip.size, core = C();
      const W2 = Math.max(1, Math.round(w * f)), H2 = Math.max(1, Math.round(h * f)), D2 = Math.max(1, Math.round(d * f));
      const o = core.create(W2, H2, D2, 'Clip'); o.palette = clip.palette.slice();
      for (let y = 0; y < H2; y++) for (let z = 0; z < D2; z++) for (let x = 0; x < W2; x++) o.blocks[(y * D2 + z) * W2 + x] = clip.blocks[(Math.min(h - 1, Math.floor(y / f)) * d + Math.min(d - 1, Math.floor(z / f))) * w + Math.min(w - 1, Math.floor(x / f))];
      return run('Scale', () => { clearBox(b); stamp(o, [b[0], b[1], b[2]], false); });
    };
    W.shade = (box, o) => {
      const b = box ? clipBox(box) : null, sh = TH.builds.shade.shade(W.s, Object.assign({}, o, { region: b }));
      if (sh === W.s) return null;
      const core = C(), [sx, sy, sz2] = sz(), map = sh.palette.map((id) => core.pal(W.s, id));
      return run('Shade', () => { for (let i = 0; i < sx * sy * sz2; i++) { const v = map[sh.blocks[i]] || 0; if (v !== W.s.blocks[i]) setI(i, v); } });
    };
    /** Put a whole schematic in (a generated shape, a library build), centred on the ground, as one undo step. */
    W.drop = (src) => {
      const [a, , c] = src.size, at = [Math.floor((sz()[0] - a) / 2), 0, Math.floor((sz()[2] - c) / 2)];
      return run('Add ' + (src.name || 'build'), () => stamp(src, at, false));
    };
    W.clearAll = () => run('Clear', () => clearBox([0, 0, 0, sz()[0] - 1, sz()[1] - 1, sz()[2] - 1]));
    W.out = (name) => { const o = C().trim(C().clone(W.s)); o.name = name || W.s.name; return o; };
    W.grow = (size, off) => {
      const core = C(), o = core.create(size[0], size[1], size[2], W.s.name), [sx, sy, sz2] = sz();
      o.palette = W.s.palette.slice();
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz2; z++) for (let x = 0; x < sx; x++) {
        const X = x + off[0], Y = y + off[1], Z = z + off[2];
        if (X < 0 || Y < 0 || Z < 0 || X >= size[0] || Y >= size[1] || Z >= size[2]) continue;
        o.blocks[(Y * size[2] + Z) * size[0] + X] = W.s.blocks[(y * sz2 + z) * sx + x];
      }
      core.carry(W.s, o, off[0], off[1], off[2]);
      o.origin = null;
      W.s = o; W.undoS = []; W.redoS = []; mirrorPal.clear();
    };
    W.count = () => C().volume(W.s);
    return W;
  }

  TH.builds.edit = { create };
})();
