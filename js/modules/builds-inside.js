/**
 * Builds "Inside": how hollow a solid build is (pure, no DOM). One shared post-process for every generator, the
 * classic shapes and the resize.
 *
 *   edt(solid, size)            exact Euclidean distance (in blocks) from every solid cell to the nearest empty cell
 *                               (outside the box counts as empty); a surface block is 1 from the air
 *   carve(solid, size, o)       -> { keep, cavity, support, depth } masks (Uint8Array per cell)
 *       o.mode    'solid'   everything stays
 *                 'hollow'  a closed shell: the blocks within `wall` blocks of the outside air stay
 *                 'open'    hollow, and the floor under the hollow is taken out so you can walk in from below
 *                 'cavity'  hollow, but a core stays in the middle: a smaller copy of the shape `wall` (at least 2)
 *                           blocks in from the shell, like the inside of a geode
 *       o.wall    wall thickness in blocks, measured as true distance from the surface, so a slanted facet keeps
 *                 an even wall (a cell stays when its distance to the air is at most wall + 0.5; with wall 1 the
 *                 shell holds every block that touches the air at a face or an edge, so it is watertight)
 *       o.support 'none' | 'pillars' (columns every 6 blocks through the hollow) | 'lattice' (a 3D grid of beams)
 *   apply(s, o, blocks)         the same on a schematic: { fill: id | null (the hollow), support: id } -> new schematic
 *   hollowness(depth, wall)     how hollow the build is in percent (0 = solid, 100 = the thinnest possible wall)
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const INF = 1e20;
  const MODES = [['solid', 'Solid', 'Filled all the way through'], ['hollow', 'Hollow', 'A closed shell with walls this thick'], ['open', 'Open', 'Hollow, with the floor under the hollow left out so you can walk in'], ['cavity', 'Cavity', 'Hollow with a smaller copy of the shape left in the middle, like a geode']];
  const FILLS = [['air', 'Air', 'The hollow stays empty'], ['glow', 'Glow', 'Filled with the palette’s glow block: a lit core (seen through glass and openings)'], ['dark', 'Dark', 'Filled with the palette’s darkest block: as heavy as solid, but the shell keeps its wall'], ['water', 'Water', 'Filled with water'], ['lava', 'Lava', 'Filled with lava']];
  const SUPPORTS = [['none', 'None', 'Nothing inside'], ['pillars', 'Pillars', 'Columns every 6 blocks, floor to ceiling'], ['lattice', 'Lattice', 'A grid of beams every 6 blocks in all three directions']];

  /** 1D squared distance transform (Felzenszwalb) of f (length n), with empty sites just outside both ends. */
  function dt1(f, n, d, v, z) {
    // empty cells outside the line at -1 and n (f = 0 there)
    let k = 0;
    v[0] = -1; z[0] = -INF; z[1] = INF;
    const F = (q) => (q < 0 || q >= n ? 0 : f[q]);
    for (let q = 0; q <= n; q++) {
      const fq = F(q);
      if (fq >= INF) continue;
      let s;
      for (;;) {
        const r = v[k];
        s = ((fq + q * q) - (F(r) + r * r)) / (2 * q - 2 * r);
        if (s <= z[k] && k > 0) k--; else break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      d[q] = (q - r) * (q - r) + F(r);
    }
  }
  /** Exact Euclidean distance to the nearest empty cell, for every cell (0 on empty cells). */
  function edt(solid, size) {
    const [sx, sy, sz] = size, N = sx * sy * sz, D = new Float32Array(N);
    for (let i = 0; i < N; i++) D[i] = solid[i] ? INF : 0;
    const m = Math.max(sx, sy, sz) + 2, f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m + 1), z = new Float64Array(m + 2);
    // along x
    for (let y = 0; y < sy; y++) for (let zz = 0; zz < sz; zz++) {
      const o = (y * sz + zz) * sx;
      for (let x = 0; x < sx; x++) f[x] = D[o + x];
      dt1(f, sx, d, v, z);
      for (let x = 0; x < sx; x++) D[o + x] = d[x];
    }
    // along z
    for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const o = y * sz * sx + x;
      for (let zz = 0; zz < sz; zz++) f[zz] = D[o + zz * sx];
      dt1(f, sz, d, v, z);
      for (let zz = 0; zz < sz; zz++) D[o + zz * sx] = d[zz];
    }
    // along y
    for (let zz = 0; zz < sz; zz++) for (let x = 0; x < sx; x++) {
      const o = zz * sx + x, st = sx * sz;
      for (let y = 0; y < sy; y++) f[y] = D[o + y * st];
      dt1(f, sy, d, v, z);
      for (let y = 0; y < sy; y++) D[o + y * st] = d[y];
    }
    for (let i = 0; i < N; i++) D[i] = Math.sqrt(D[i]);
    return D;
  }

  function carve(solid, size, o) {
    o = o || {};
    const [sx, sy, sz] = size, N = sx * sy * sz, mode = o.mode || 'solid';
    const keep = new Uint8Array(N), cavity = new Uint8Array(N), support = new Uint8Array(N);
    if (mode === 'solid') { for (let i = 0; i < N; i++) keep[i] = solid[i] ? 1 : 0; return { keep, cavity, support, depth: null }; }
    const depth = edt(solid, size), wall = Math.max(1, +o.wall || 1), lim = wall + 0.5;
    const gap = Math.max(2, wall), core = wall + gap + 0.5;
    for (let i = 0; i < N; i++) {
      if (!solid[i]) continue;
      const d = depth[i];
      if (d <= lim || (mode === 'cavity' && d > core)) keep[i] = 1; else cavity[i] = 1;
    }
    if (mode === 'open') {
      // take the floor out under the hollow: every kept block below the lowest hollow cell of its column
      for (let zz = 0; zz < sz; zz++) for (let x = 0; x < sx; x++) {
        let low = -1;
        for (let y = 0; y < sy; y++) if (cavity[(y * sz + zz) * sx + x]) { low = y; break; }
        if (low < 0) continue;
        for (let y = 0; y < low; y++) { const i = (y * sz + zz) * sx + x; if (keep[i]) { keep[i] = 0; cavity[i] = 1; } }
      }
    }
    const sup = o.support || 'none';
    if (sup !== 'none') {
      const step = 6, ox = Math.floor((sx % step) / 2 + step / 2), oz = Math.floor((sz % step) / 2 + step / 2), oy = Math.floor((sy % step) / 2 + step / 2);
      for (let y = 0, i = 0; y < sy; y++) for (let zz = 0; zz < sz; zz++) for (let x = 0; x < sx; x++, i++) {
        if (!cavity[i]) continue;
        const ax = (x - ox) % step === 0, az = (zz - oz) % step === 0, ay = (y - oy) % step === 0;
        if (sup === 'pillars' ? ax && az : (ax && az) || (ax && ay) || (ay && az)) { support[i] = 1; cavity[i] = 0; }
      }
    }
    return { keep, cavity, support, depth };
  }

  /** How hollow it is: 0 % = solid, 100 % = the thinnest possible wall, from the deepest point of the build. */
  function hollowness(depth, wall, mode) {
    if (!depth || mode === 'solid') return 0;
    let mx = 0;
    for (let i = 0; i < depth.length; i++) if (depth[i] > mx) mx = depth[i];
    if (mx <= 1.5) return 0;
    return Math.round(Math.max(0, Math.min(1, (mx - (wall + 0.5)) / (mx - 1.5))) * 100);
  }

  /** On a schematic: blocks = { fill: id | null, support: id | null }. Block entities on removed cells go too. */
  function apply(s, o, blocks) {
    if (!s || !o || !o.mode || o.mode === 'solid') return s;
    const core = TH.builds.core, D = TH.builds.detail, [sx, sy, sz] = s.size, N = sx * sy * sz;
    const solidPal = s.palette.map((id, i) => i > 0 && D && !D.isThin(id) && D.count(D.shapeMask(id)) >= 32);
    const solid = new Uint8Array(N);
    for (let i = 0; i < N; i++) solid[i] = solidPal[s.blocks[i]] ? 1 : 0;
    const r = carve(solid, s.size, o);
    const out = core.clone(s), B = out.blocks;
    const fill = blocks && blocks.fill ? core.pal(out, blocks.fill) : 0, sup = blocks && blocks.support ? core.pal(out, blocks.support) : 0;
    for (let i = 0; i < N; i++) {
      if (r.cavity[i]) B[i] = fill;
      else if (r.support[i]) B[i] = sup || B[i];
    }
    if (out.be) out.be = out.be.filter((b) => B[(b.y * sz + b.z) * sx + b.x] && !r.cavity[(b.y * sz + b.z) * sx + b.x]);
    return core.compact(out);
  }

  TH.builds.inside = { edt, carve, apply, hollowness, MODES, FILLS, SUPPORTS };
})();
