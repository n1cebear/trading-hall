/**
 * Builds smart resize (pure, no DOM): make a build bigger or smaller WITHOUT doubling its walls.
 *
 *   resize(s, o) -> { s, mode, notes, before, after }
 *     o.size = [W, H, D] (target blocks) or o.factor = [fx, fy, fz]; o.mode = 'auto' | 'stretch' | 'thin' | 'plain'
 *   wallStats(s) -> per axis the typical thickness of thin parts (the most common short run of blocks along it)
 *   orthogonal(s) -> share of the surface that lies on flat, axis-aligned faces (0..1)
 *
 * Modes, in plain words:
 *   stretch  (orthogonal builds: houses, halls, farms) one axis at a time the build is cut into slices across that axis.
 *            Slices that are the same as their neighbour (the middle of a long wall, the span of a hall) form runs:
 *            growing repeats slices inside the runs, shrinking takes slices out of them (each run keeps one), spread
 *            over the runs by their length. A slice that differs from both neighbours (a wall across the axis, a
 *            floor, a window row) is never repeated, so walls, floors and panes stay one block thick and every block
 *            keeps its state. With no runs on an axis it repeats a whole repeating unit (window bays) when it finds one,
 *            else the slices most like their neighbour, and says so.
 *   thin     (curved builds: domes, crystals, towers) scale every block (nearest; shrinking keeps a block when any
 *            source block falls in it), then thin out again: along each axis, a run of blocks that came from one or
 *            two source blocks keeps only one output block per source block, so a 1-thick shell stays 1 thick; a seal
 *            pass closes edge-only joins so the shell stays watertight.
 *   plain    every block becomes k x k x k blocks (what other tools do: walls double).
 *   auto     stretch when most of the surface is flat and axis-aligned, else thin.
 * Block entities (chest contents, sign text) stay with ONE copy of their block: repeated copies are plain, empty
 * containers (noted). Entities move with the scale and are never duplicated. Pane / wall / fence connections are
 * derived again afterwards.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const AX = ['X', 'Y', 'Z'];

  /* ---- slices across an axis ---- */
  const dims = (s) => s.size;
  function sliceKey(s, a, i) {
    const [sx, sy, sz] = s.size, B = s.blocks;
    let h = 2166136261, n = 0;
    if (a === 0) { for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) { h = Math.imul(h ^ B[(y * sz + z) * sx + i], 16777619); n++; } }
    else if (a === 1) { const o = i * sx * sz; for (let k = 0; k < sx * sz; k++) { h = Math.imul(h ^ B[o + k], 16777619); n++; } }
    else { for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) { h = Math.imul(h ^ B[(y * sz + i) * sx + x], 16777619); n++; } }
    return h >>> 0;
  }
  /** Cells that differ between slices i and j (0 = identical). */
  function sliceDiff(s, a, i, j) {
    const [sx, sy, sz] = s.size, B = s.blocks;
    let d = 0;
    if (a === 0) { for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) if (B[(y * sz + z) * sx + i] !== B[(y * sz + z) * sx + j]) d++; }
    else if (a === 1) { const oi = i * sx * sz, oj = j * sx * sz; for (let k = 0; k < sx * sz; k++) if (B[oi + k] !== B[oj + k]) d++; }
    else { for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (B[(y * sz + i) * sx + x] !== B[(y * sz + j) * sx + x]) d++; }
    return d;
  }
  /** Spread `e` among weights (largest remainder); returns counts. */
  function spread(e, w) {
    const tot = w.reduce((a, b) => a + b, 0) || 1, raw = w.map((v) => (e * v) / tot), out = raw.map(Math.floor);
    let left = e - out.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return out;
  }
  /** A repeating unit along the axis: period P where slice i equals slice i + P for most i. */
  function period(keys) {
    const n = keys.length;
    for (let P = 2; P <= Math.min(12, Math.floor(n / 2)); P++) {
      let ok = 0;
      for (let i = 0; i + P < n; i++) if (keys[i] === keys[i + P]) ok++;
      if (ok / (n - P) >= 0.85) return P;
    }
    return 0;
  }
  /**
   * The source slice for every output slice along axis a, growing or shrinking from n to m.
   * -> { map: Int32Array(m), primary: Uint8Array(m) (the first copy of its source), note }
   */
  function planAxis(s, a, m) {
    const n = s.size[a];
    const map = new Int32Array(m), primary = new Uint8Array(m);
    if (m === n) { for (let i = 0; i < n; i++) { map[i] = i; primary[i] = 1; } return { map, primary, note: null }; }
    const keys = []; for (let i = 0; i < n; i++) keys.push(sliceKey(s, a, i));
    const same = (i, j) => keys[i] === keys[j] && sliceDiff(s, a, i, j) === 0;
    // runs of identical neighbours [start, length]
    const runs = [];
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && same(j, j + 1)) j++; if (j > i) runs.push([i, j - i + 1]); i = j + 1; }
    const count = new Int32Array(n).fill(1);   // how many output slices each source slice becomes
    const unitRep = new Int32Array(n);         // a repeating unit starting at this slice is repeated this often after itself
    let note = null, P = 0;
    if (m > n) {
      let e = m - n;
      if (runs.length) {
        const add = spread(e, runs.map((r) => r[1]));
        runs.forEach(([st, len], k) => { const per = spread(add[k], new Array(len).fill(1)); for (let q = 0; q < len; q++) count[st + q] += per[q]; });
      } else {
        P = period(keys);
        if (P && e >= P) {
          // repeat whole units (window bays): floor(e / P) copies of a unit, spread over the units, each copy right after its unit
          const units = Math.floor(e / P), nUnits = Math.max(1, Math.floor(n / P)), per = spread(units, new Array(nUnits).fill(1));
          for (let u = 0; u < nUnits; u++) unitRep[u * P] = per[u];
          e -= units * P;
          note = AX[a] + ': no long flat stretch, so whole repeating units of ' + P + ' blocks were repeated';
        }
        if (e > 0) {
          // the slices most like their neighbour, spread out
          const score = keys.map((k, i) => ({ i, d: Math.min(i > 0 ? sliceDiff(s, a, i, i - 1) : Infinity, i < n - 1 ? sliceDiff(s, a, i, i + 1) : Infinity) })).sort((x, y) => x.d - y.d || x.i - y.i);
          const pick = score.slice(0, Math.max(1, Math.min(n, e))).map((x) => x.i);
          const per = spread(e, pick.map(() => 1));
          pick.forEach((i, k) => { count[i] += per[k]; });
          note = (note ? note + '; ' : '') + AX[a] + ': no identical neighbouring slices, the most similar ones were repeated (details there stretch)';
        }
      }
    } else {
      let e = n - m;
      const cap = runs.reduce((t, r) => t + r[1] - 1, 0);
      if (cap) {
        const take = spread(Math.min(e, cap), runs.map((r) => r[1] - 1));
        runs.forEach(([st, len], k) => { const per = spread(take[k], new Array(len - 1).fill(1)); for (let q = 0; q < len - 1; q++) count[st + 1 + q] -= per[q]; });
        e -= Math.min(e, cap);
      }
      if (e > 0) {
        const alive = []; for (let i = 0; i < n; i++) if (count[i] > 0) alive.push(i);
        const score = alive.map((i) => ({ i, d: Math.min(i > 0 ? sliceDiff(s, a, i, i - 1) : Infinity, i < n - 1 ? sliceDiff(s, a, i, i + 1) : Infinity) })).sort((x, y) => x.d - y.d || x.i - y.i);
        for (let k = 0; k < e && k < score.length; k++) count[score[k].i] = 0;
        note = AX[a] + ': not enough identical slices, ' + e + ' of the most similar slices were taken out';
      }
    }
    let o = 0;
    for (let i = 0; i < n && o < m; i++) {
      for (let c = 0; c < count[i] && o < m; c++) { map[o] = i; primary[o] = c === 0 ? 1 : 0; o++; }
      // the end of a repeating unit: its copies follow it whole (bay, bay, bay ... not slice, slice)
      const us = P ? i - (P - 1) : -1;
      if (us >= 0 && us % P === 0 && unitRep[us]) for (let r = 0; r < unitRep[us]; r++) for (let q = 0; q < P && o < m; q++) { map[o] = us + q; primary[o] = 0; o++; }
    }
    while (o < m) { map[o] = n - 1; primary[o] = 0; o++; }
    return { map, primary, note };
  }
  /** Apply a slice plan on one axis. */
  function applyAxis(s, a, plan) {
    const core = C(), [sx, sy, sz] = s.size, m = plan.map.length, size = s.size.slice(); size[a] = m;
    const o = core.create(size[0], size[1], size[2], s.name); o.palette = s.palette.slice();
    const [ox, oy, oz] = size;
    for (let y = 0; y < oy; y++) for (let z = 0; z < oz; z++) for (let x = 0; x < ox; x++) {
      const X = a === 0 ? plan.map[x] : x, Y = a === 1 ? plan.map[y] : y, Z = a === 2 ? plan.map[z] : z;
      o.blocks[(y * oz + z) * ox + x] = s.blocks[(Y * sz + Z) * sx + X];
    }
    // first output index of each source slice (block entities, ticks); entities follow their position
    const first = new Int32Array(s.size[a]).fill(-1);
    for (let i = 0; i < m; i++) if (plan.primary[i] && first[plan.map[i]] < 0) first[plan.map[i]] = i;
    const key = ['x', 'y', 'z'][a];
    let dropped = 0;
    if (s.be) o.be = s.be.map((b) => { const t = first[b[key]]; if (t < 0) { dropped++; return null; } return Object.assign({}, b, { [key]: t }); }).filter(Boolean);
    if (s.ticks) { const mv = (t) => { const v = first[t[key]]; return v < 0 ? null : Object.assign({}, t, { [key]: v }); }; o.ticks = { block: (s.ticks.block || []).map(mv).filter(Boolean), fluid: (s.ticks.fluid || []).map(mv).filter(Boolean) }; }
    if (s.ents) o.ents = s.ents.map((e) => {
      const p = e.pos.slice(), c = Math.floor(p[a]), fr = p[a] - c;
      let t = c >= 0 && c < first.length ? first[c] : -1;
      if (t < 0) { let best = 0, bd = Infinity; for (let i = 0; i < first.length; i++) if (first[i] >= 0 && Math.abs(i - c) < bd) { bd = Math.abs(i - c); best = first[i]; } t = best; }
      p[a] = t + fr;
      return { pos: p, id: e.id, nbt: e.nbt };
    });
    ['dv', 'src', 'declared', 'origin'].forEach((k) => { if (s[k] != null) o[k] = s[k]; });
    o._dropped = dropped;
    return o;
  }
  function stretch(s, tgt, notes) {
    let cur = s, dup = 0, lost = 0;
    for (const a of [0, 2, 1]) {
      if (tgt[a] === cur.size[a]) continue;
      const plan = planAxis(cur, a, tgt[a]);
      if (plan.note) notes.push(plan.note);
      // containers in repeated slices are copied as blocks only
      const be = new Set((cur.be || []).map((b) => b[['x', 'y', 'z'][a]]));
      for (let i = 0; i < plan.map.length; i++) if (!plan.primary[i] && be.has(plan.map[i])) dup += (cur.be || []).filter((b) => b[['x', 'y', 'z'][a]] === plan.map[i]).length;
      cur = applyAxis(cur, a, plan);
      lost += cur._dropped || 0;
    }
    if (dup) notes.push(dup + (dup === 1 ? ' container or sign was' : ' containers or signs were') + ' repeated as an empty block: the contents stay with the original');
    if (lost) notes.push(lost + (lost === 1 ? ' block lost its contents' : ' blocks lost their contents') + ' where slices were taken out');
    return cur;
  }

  /* ---- scaling ---- */
  /** Nearest scale (growing) / any-block scale (shrinking) with the source index of every output cell per axis. */
  function scaleGrid(s, tgt) {
    const core = C(), [sx, sy, sz] = s.size, [ox, oy, oz] = tgt, B = s.blocks;
    const o = core.create(ox, oy, oz, s.name); o.palette = s.palette.slice();
    const srcOf = (oN, sN) => { const m = new Int32Array(oN); for (let i = 0; i < oN; i++) m[i] = Math.min(sN - 1, Math.floor((i + 0.5) * sN / oN)); return m; };
    const mx = srcOf(ox, sx), my = srcOf(oy, sy), mz = srcOf(oz, sz);
    const span = (oN, sN, i) => [Math.floor(i * sN / oN), Math.max(Math.floor(i * sN / oN), Math.ceil((i + 1) * sN / oN) - 1)];
    for (let y = 0; y < oy; y++) for (let z = 0; z < oz; z++) for (let x = 0; x < ox; x++) {
      let v = B[(my[y] * sz + mz[z]) * sx + mx[x]];
      if (!v && (ox < sx || oy < sy || oz < sz)) {
        // shrinking: a block when any source block falls in this cell (thin walls survive)
        const [x0, x1] = span(ox, sx, x), [y0, y1] = span(oy, sy, y), [z0, z1] = span(oz, sz, z);
        for (let Y = y0; Y <= y1 && !v; Y++) for (let Z = z0; Z <= z1 && !v; Z++) for (let X = x0; X <= x1; X++) { const w = B[(Y * sz + Z) * sx + X]; if (w) { v = w; break; } }
      }
      o.blocks[(y * oz + z) * ox + x] = v;
    }
    return { o, maps: [mx, my, mz] };
  }
  /** Move block entities / ticks to ONE output cell (the first that maps to it); entities scale. */
  function carryScaled(s, o, maps) {
    const first = maps.map((m, a) => { const f = new Int32Array(s.size[a]).fill(-1); for (let i = 0; i < m.length; i++) if (f[m[i]] < 0) f[m[i]] = i; return f; });
    const last = maps.map((m, a) => { const f = new Int32Array(s.size[a]).fill(-1); for (let i = 0; i < m.length; i++) f[m[i]] = i; return f; });
    const at = (b) => { const t = [first[0][b.x], first[1][b.y], first[2][b.z]]; return t.some((v) => v < 0) ? null : t; };
    const [ox, , oz] = o.size, solid = (x, y, z) => o.blocks[(y * oz + z) * ox + x];
    /** The one output copy of a source cell that still has its block (thinning may have kept a later copy). */
    const kept = (b) => {
      const t = at(b); if (!t) return null;
      if (solid(t[0], t[1], t[2])) return t;
      for (let y = t[1]; y <= last[1][b.y]; y++) for (let z = t[2]; z <= last[2][b.z]; z++) for (let x = t[0]; x <= last[0][b.x]; x++) if (solid(x, y, z)) return [x, y, z];
      return null;
    };
    let lost = 0;
    if (s.be) o.be = s.be.map((b) => { const t = kept(b); if (!t) { lost++; return null; } return Object.assign({}, b, { x: t[0], y: t[1], z: t[2] }); }).filter(Boolean);
    if (s.ticks) { const mv = (t) => { const q = at(t); return q ? Object.assign({}, t, { x: q[0], y: q[1], z: q[2] }) : null; }; o.ticks = { block: (s.ticks.block || []).map(mv).filter(Boolean), fluid: (s.ticks.fluid || []).map(mv).filter(Boolean) }; }
    if (s.ents) o.ents = s.ents.map((e) => ({ pos: e.pos.map((v, a) => v * o.size[a] / s.size[a]), id: e.id, nbt: e.nbt }));
    ['dv', 'src', 'declared', 'origin'].forEach((k) => { if (s[k] != null) o[k] = s[k]; });
    return lost;
  }
  function plain(s, tgt, notes) {
    const { o, maps } = scaleGrid(s, tgt);
    const lost = carryScaled(s, o, maps);
    if (lost) notes.push(lost + ' block entities fell on an empty cell and were left out');
    return o;
  }
  /** Length of the solid run through every source block along each axis. */
  function runLengths(s) {
    const [sx, sy, sz] = s.size, B = s.blocks, R = [0, 1, 2].map(() => new Uint16Array(B.length));
    const idx = (a, p, q, t) => (a === 0 ? (p * sz + q) * sx + t : a === 1 ? (t * sz + p) * sx + q : (p * sz + t) * sx + q);
    for (const a of [0, 1, 2]) {
      const len = s.size[a], lines = a === 0 ? [sy, sz] : a === 1 ? [sz, sx] : [sy, sx];
      for (let p = 0; p < lines[0]; p++) for (let q = 0; q < lines[1]; q++) {
        let t = 0;
        while (t < len) {
          if (!B[idx(a, p, q, t)]) { t++; continue; }
          let u = t; while (u + 1 < len && B[idx(a, p, q, u + 1)]) u++;
          for (let k = t; k <= u; k++) R[a][idx(a, p, q, k)] = Math.min(65535, u - t + 1);
          t = u + 1;
        }
      }
    }
    return R;
  }
  /**
   * Scale, then thin: along each grown axis a run that came from at most two source blocks keeps one block per source
   * block, but only where that axis crosses the part (its run is the shortest of the three there and shorter than the
   * longest): a wall or floor is thinned through its thickness, a 2-high pane, rod or pillar keeps its height.
   */
  function thin(s, tgt, notes) {
    const { o, maps } = scaleGrid(s, tgt);
    const [ox, oy, oz] = tgt, B = o.blocks, keep = new Uint8Array(B.length).fill(1);
    const I = (x, y, z) => (y * oz + z) * ox + x;
    const R = runLengths(s), [sx, , sz] = s.size;
    const across = (i, a) => { const x = i % ox, z = Math.floor(i / ox) % oz, y = Math.floor(i / (ox * oz)), si = (maps[1][y] * sz + maps[2][z]) * sx + maps[0][x], r = [R[0][si], R[1][si], R[2][si]]; const mx = Math.max(r[0], r[1], r[2]); return r[a] <= Math.min(r[0], r[1], r[2]) && (r[a] < mx || mx <= 2); };
    for (const a of [0, 1, 2]) {
      if (tgt[a] <= s.size[a]) continue;
      const m = maps[a], lines = a === 0 ? [oy, oz] : a === 1 ? [oz, ox] : [oy, ox], len = tgt[a];
      for (let p = 0; p < lines[0]; p++) for (let q = 0; q < lines[1]; q++) {
        const cell = (t) => (a === 0 ? I(t, p, q) : a === 1 ? I(q, t, p) : I(q, p, t));
        let t = 0;
        while (t < len) {
          if (!B[cell(t)]) { t++; continue; }
          let u = t; while (u + 1 < len && B[cell(u + 1)]) u++;
          const srcN = new Set(); for (let k = t; k <= u; k++) srcN.add(m[k]);
          // one copy per source block: the one nearer the outside of the build (first copy in the lower half, last in the upper)
          if (srcN.size <= 2 && u > t && across(cell(t), a)) for (let k = t; k <= u; k++) {
            const hi = m[k] * 2 + 1 > s.size[a];
            if (hi ? k < u && m[k + 1] === m[k] : k > t && m[k] === m[k - 1]) keep[cell(k)] = 0;
          }
          t = u + 1;
        }
      }
    }
    // inner corners where two thinned layers meet (a wall corner, a wall on a floor): a copy whose next cells along two
    // of its copied axes were thinned is the leftover of both layers, so it goes too (the corner stays one block thick)
    for (let pass = 0; pass < 2; pass++) {   // the second pass takes the three-way corners (two walls on a floor)
    const corner = [];
    for (let y = 0; y < oy; y++) for (let z = 0; z < oz; z++) for (let x = 0; x < ox; x++) {
      const i = I(x, y, z); if (!B[i] || !keep[i]) continue;
      const k = [x, y, z]; let n = 0;
      for (const a of [0, 1, 2]) {
        const t = k[a], inner = maps[a][t] * 2 + 1 > s.size[a] ? -1 : 1;   // toward the middle of the build
        if (t - inner < 0 || t - inner >= tgt[a] || t + inner < 0 || t + inner >= tgt[a] || maps[a][t] !== maps[a][t - inner]) continue;
        const q = k.slice(); q[a] = t + inner;
        if (!keep[I(q[0], q[1], q[2])]) n++;
      }
      if (n >= 2) corner.push(i);
    }
    corner.forEach((i) => { keep[i] = 0; });
    }
    for (let i = 0; i < B.length; i++) if (!keep[i]) B[i] = 0;
    if (TH.builds.rotate && TH.builds.rotate.seal) TH.builds.rotate.seal(o, new Uint8Array(B.length));
    const lost = carryScaled(s, o, maps);
    if (lost) notes.push(lost + ' block entities fell on a thinned-out cell and were left out');
    return o;
  }

  /* ---- measures ---- */
  /** Share of the exposed block faces that sit in a flat, axis-aligned face of at least 3 x 3 blocks. */
  function orthogonal(s) {
    const [sx, sy, sz] = s.size, B = s.blocks, at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && B[(y * sz + z) * sx + x];
    let faces = 0, flat = 0;
    const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!at(x, y, z)) continue;
      for (const n of D6) {
        if (at(x + n[0], y + n[1], z + n[2])) continue;
        faces++;
        const t = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].filter((v) => !(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]));
        let ok = true;
        for (const [u, v] of [[t[0], t[1]]]) for (const su of [-1, 1]) for (const sv of [-1, 0, 1]) {
          const X = x + u[0] * su + v[0] * sv, Y = y + u[1] * su + v[1] * sv, Z = z + u[2] * su + v[2] * sv;
          if (!at(X, Y, Z) || at(X + n[0], Y + n[1], Z + n[2])) ok = false;
        }
        if (ok) flat++;
      }
    }
    return faces ? flat / faces : 1;
  }
  /** Per axis: the most common length of the short runs of blocks along it (the thickness of walls across that axis). */
  function wallStats(s) {
    const [sx, sy, sz] = s.size, B = s.blocks, out = [];
    for (const a of [0, 1, 2]) {
      const hist = new Map(), len = s.size[a], lines = a === 0 ? [sy, sz] : a === 1 ? [sz, sx] : [sy, sx];
      for (let p = 0; p < lines[0]; p++) for (let q = 0; q < lines[1]; q++) {
        let run = 0;
        for (let t = 0; t <= len; t++) {
          const v = t < len && (a === 0 ? B[(p * sz + q) * sx + t] : a === 1 ? B[(t * sz + p) * sx + q] : B[(p * sz + t) * sx + q]);
          if (v) run++; else { if (run && run <= 6) hist.set(run, (hist.get(run) || 0) + 1); run = 0; }
        }
      }
      let best = 0, bn = -1;
      hist.forEach((n, k) => { if (n > bn || (n === bn && k < best)) { bn = n; best = k; } });
      out.push(best);
    }
    return out;
  }

  function resize(s, o) {
    o = o || {};
    const n = s.size;
    const tgt = o.size ? o.size.map((v, a) => Math.max(1, Math.round(+v || n[a]))) : (o.factor || [1, 1, 1]).map((f, a) => Math.max(1, Math.round(n[a] * (+f || 1))));
    const notes = [];
    if (tgt.every((v, a) => v === n[a])) return { s, mode: 'none', notes, before: n.slice(), after: n.slice() };
    let mode = o.mode || 'auto';
    if (mode === 'auto') mode = orthogonal(s) >= 0.55 ? 'stretch' : 'thin';
    const out = mode === 'stretch' ? stretch(s, tgt, notes) : mode === 'thin' ? thin(s, tgt, notes) : plain(s, tgt, notes);
    delete out._dropped;
    out.name = s.name;
    if (TH.builds.detail) TH.builds.detail.connect(out);
    return { s: out, mode, notes, before: n.slice(), after: out.size.slice() };
  }

  TH.builds.resize = { resize, wallStats, orthogonal, planAxis, MODES: [['auto', 'Keep walls thin', 'Recommended: picks the best way for this build'], ['stretch', 'Stretch', 'Repeats or removes identical slices: details, walls and windows stay as they are'], ['thin', 'Resample', 'For round builds: scales, then thins the walls back'], ['plain', 'Plain scale', 'Every block becomes more blocks: walls get thicker']] };
})();
