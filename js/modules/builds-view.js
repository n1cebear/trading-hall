/**
 * Builds 3D viewer. Loaded on demand (with three.js) the first time the Builds tab opens.
 *
 *   TH.builds.mesh(schem, opts)      pure mesher (no DOM): face-culled geometry for the whole schematic, one opaque and one
 *                                    translucent buffer, texture tiles listed by spec. Per vertex: position, normal, uv,
 *                                    colour (ambient occlusion), aC (block centre), aT (the block's start time in the
 *                                    assemble animation) and aN (start time + layer of the neighbour that hides this face).
 *   TH.builds.view.create(host)      the viewer: one WebGL canvas in `host`, orbit camera, blueprint grid, animation.
 *
 * Animation: one shader uniform uT (seconds) drives everything. A block is visible when uT >= aT, drops in from uH blocks
 * above with a little squash and hop, and is landed at aT + uD. Assemble plays uT forward, disassemble backwards, the
 * loop is assemble, hold 2 s, disassemble, short gap. Faces between two solid blocks are kept (collapsed in the shader
 * while the neighbour is landed and inside the layer range), so a half-built or sliced build is never see-through.
 * Between horizontal neighbours only the earlier block keeps its face (they share a layer, so slicing hides both).
 * The layer range (uMinY..uMaxY) gives the layer slider and the "only this layer" slice.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');
  const rel = (p) => new URL(p, SRC).href;

  /* ======================================================================
   * Mesher
   * ====================================================================== */
  // faces: normal, unit-cube corners BL BR TR TL seen from outside (u runs BL->BR, v BL->TL)
  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], name: 'east' },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], name: 'west' },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], name: 'up' },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], name: 'down' },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], name: 'south' },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], name: 'north' },
  ];
  const DIRV = { east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], south: [0, 0, 1], north: [0, 0, -1] };
  const FI = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
  const OPP = [1, 0, 3, 2, 5, 4];
  const AO = [1, 0.8, 0.66, 0.54];
  // per face and corner: the two tangent offsets toward that corner (ambient occlusion samples)
  const AO_T = [
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(() => null),
  ][0];
  for (let f = 0; f < 6; f++) {
    const F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f];
    const C4 = [[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]][f];
    AO_T[f] = C4.map((q) => {
      const o = [0, 1, 2].map((a) => (F[a] !== 0 ? 0 : q[a] ? 1 : -1));
      const t1 = o[0] ? [o[0], 0, 0] : o[1] ? [0, o[1], 0] : [0, 0, o[2]];
      const t2 = [o[0] && !t1[0] ? o[0] : 0, o[1] && !t1[1] ? o[1] : 0, o[2] && !t1[2] ? o[2] : 0];
      return [t1, t2];
    });
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /** uv of the 4 corners (auto-UV from the box position, like Minecraft) rotated k quarter turns. */
  function rotUV(uv, k) {
    if (!k) return uv;
    return uv.map(([u, v]) => { let a = u - 0.5, b = v - 0.5; for (let i = 0; i < k; i++) { const t = a; a = -b; b = t; } return [a + 0.5, b + 0.5]; });
  }
  /** Rotation (0..3) that makes the texture's up (v) point along world vector w on face f (abs: either sign). */
  const rotCache = new Map();
  function bestRot(f, w, abs) {
    const key = f + '|' + w.join() + '|' + (abs ? 1 : 0);
    if (rotCache.has(key)) return rotCache.get(key);
    const F = FACES[f], bl = F.c[0], rt = sub(F.c[1], bl), up = sub(F.c[3], bl);
    const base = F.c.map((q) => [dot(sub(q, bl), rt), dot(sub(q, bl), up)]);
    let best = 0, bv = -Infinity;
    for (let k = 0; k < 4; k++) {
      const uv = rotUV(base, k), vd = [0, 0, 0];
      uv.forEach(([, v], i) => { for (let a = 0; a < 3; a++) vd[a] += (v - 0.5) * F.c[i][a]; });
      let s = dot(vd, w);
      if (abs) s = Math.abs(s);
      if (s > bv + 1e-6) { bv = s; best = k; }
    }
    rotCache.set(key, best);
    return best;
  }

  /** Texture tile spec of a block role ('t' top, 's' side, 'b' bottom, 'f' front, 'k' back, 'fv' vertical front). */
  function tileSpec(d, role) {
    let base = d[role] || (role === 'fv' ? d.f : null) || (role === 'k' ? d.b : null) || d.s || d.t;
    if (!base) base = '#unknown';
    if (base[0] === '#') return base;
    const tr = role === 'f' || role === 'k' || role === 'fv' ? null : role;
    const tint = typeof d.tint === 'string' ? d.tint : d.tint && tr ? d.tint[tr] : null;
    const ov = d.ov && tr && d.ov[tr] && d.shape !== 'dust' ? d.ov[tr] : null;
    return base + (tint ? tint : '') + (ov ? '+' + ov + d.ov.tint : '') + (d.alpha ? '@' + d.alpha : '') + (d.leafy ? '~' : '');
  }

  /** Growable typed buffer. */
  function Buf(T, n) { this.a = new T(n || 1024); this.n = 0; this.T = T; }
  Buf.prototype.push = function () {
    if (this.n + arguments.length > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + arguments.length)); b.set(this.a); this.a = b; }
    for (let i = 0; i < arguments.length; i++) this.a[this.n++] = arguments[i];
  };
  Buf.prototype.done = function () { return this.a.slice(0, this.n); };
  function Geo() {
    this.pos = new Buf(Float32Array); this.nrm = new Buf(Float32Array); this.uv = new Buf(Float32Array); this.tile = new Buf(Float32Array);
    this.col = new Buf(Float32Array); this.c = new Buf(Float32Array); this.t = new Buf(Float32Array); this.nb = new Buf(Float32Array);
    this.idx = new Buf(Uint32Array); this.verts = 0;
  }

  /**
   * Mesh a schematic. opts: { order: 'build' } -> { opaque, trans, tiles: [spec], tileIndex: Map, times: Float32Array (per cell,
   * -1 = air), span, drop, blocks, faces }.
   */
  function mesh(s, opts) {
    opts = opts || {};
    const core = C(), [sx, sy, sz] = s.size, B = s.blocks, N = B.length;
    const ox = sx / 2, oz = sz / 2;
    // palette info
    const P = s.palette.map((id, i) => {
      if (i === 0 || core.isAir(id)) return null;
      const d = core.def(id), p = core.parse(id);
      const shape = d.shape === 'slab' && p.props.type === 'double' ? 'cube' : d.shape;
      const occl = shape === 'cube' && !d.cut;
      return { id, d, props: p.props, name: p.name, shape, occl, cut: d.cut || (shape === 'liquid' ? (d.alpha ? 'translucent' : null) : null), glow: !!d.glow };
    });
    // build order: bottom to top, then a diagonal sweep across the layer
    const cells = [];
    for (let i = 0; i < N; i++) if (B[i] && P[B[i]]) cells.push(i);
    const n = cells.length;
    const key = (i) => { const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz)); return y * 1e6 + (x + z) * 1e3 + x; };
    const keys = new Float64Array(N);
    cells.forEach((i) => { keys[i] = key(i); });
    cells.sort((a, b) => keys[a] - keys[b]);
    const span = Math.min(10, Math.max(2.2, 1.4 + Math.sqrt(n) * 0.09)), drop = 0.55;
    const times = new Float32Array(N).fill(-1);
    cells.forEach((i, r) => { times[i] = n > 1 ? (r / (n - 1)) * span : 0; });
    const tiles = opts.tiles || [], tileIndex = opts.tileIndex || new Map();   // phases of one machine share the registry (one atlas)
    const tileOf = (spec) => { let t = tileIndex.get(spec); if (t == null) { t = tiles.length; tiles.push(spec); tileIndex.set(spec, t); } return t; };
    const opaque = new Geo(), trans = new Geo();
    const big = n > 50000;   // very large builds: skip the hidden inner faces (memory); slicing then shows outer faces only
    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : B[(y * sz + z) * sx + x]);
    const occAt = (x, y, z) => { const v = at(x, y, z); return v ? !!(P[v] && P[v].occl) : false; };
    let faces = 0;

    /**
     * Emit one box face. e = box in px [x0,y0,z0,x1,y1,z1]; f = face index; spec = tile; rot = uv quarter turns;
     * nbT / nbY = hiding neighbour (or -1); cellXYZ for AO (full cube faces only).
     */
    function quad(g, X, Y, Z, e, f, spec, rot, nbT, nbY, ao, tSelf, glow, uvBox) {
      const F = FACES[f], bl = F.c[0], rt = sub(F.c[1], bl), up = sub(F.c[3], bl);
      const ex = [e[0] / 16, e[1] / 16, e[2] / 16, e[3] / 16, e[4] / 16, e[5] / 16];
      const pts = F.c.map((q) => [ex[0] + (ex[3] - ex[0]) * q[0], ex[1] + (ex[4] - ex[1]) * q[1], ex[2] + (ex[5] - ex[2]) * q[2]]);
      let uv = pts.map((q) => { const d = sub(q, bl); return [dot(d, rt), dot(d, up)]; });
      if (uvBox) uv = uv.map(([u, v]) => [uvBox[0] + (uvBox[2] - uvBox[0]) * u, uvBox[1] + (uvBox[3] - uvBox[1]) * v]);
      uv = rotUV(uv, rot || 0);
      const ti = tileOf(spec), v0 = g.verts;
      const cx = X - ox + 0.5, cy = Y + 0.5, cz = Z - oz + 0.5;
      const glowK = glow ? 1.45 : 1;
      for (let k = 0; k < 4; k++) {
        const q = pts[k];
        g.pos.push(X - ox + q[0], Y + q[1], Z - oz + q[2]);
        g.nrm.push(F.n[0], F.n[1], F.n[2]);
        g.uv.push(uv[k][0], uv[k][1]); g.tile.push(ti);
        const a = ao ? AO[ao[k]] * glowK : glowK;
        g.col.push(a, a, a);
        g.c.push(cx, cy, cz); g.t.push(tSelf); g.nb.push(nbT, nbY);
      }
      // flip the diagonal when AO is uneven, so the shading does not crease
      if (ao && ao[0] + ao[2] > ao[1] + ao[3]) g.idx.push(v0 + 1, v0 + 2, v0 + 3, v0 + 1, v0 + 3, v0);
      else g.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      g.verts += 4; faces++;
    }
    /** Ambient occlusion of the 4 corners of face f of cell (x, y, z). */
    function aoOf(x, y, z, f) {
      const F = FACES[f], nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2], T = AO_T[f], out = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const [t1, t2] = T[k];
        const s1 = occAt(nx + t1[0], ny + t1[1], nz + t1[2]) ? 1 : 0, s2 = occAt(nx + t2[0], ny + t2[1], nz + t2[2]) ? 1 : 0;
        out[k] = s1 && s2 ? 3 : s1 + s2 + (occAt(nx + t1[0] + t2[0], ny + t1[1] + t2[1], nz + t1[2] + t2[2]) ? 1 : 0);
      }
      return out;
    }
    const facingOf = (props, dft) => DIRV[props.facing] ? props.facing : dft;

    /** Texture role + rotation of face f for a block. */
    function roleOf(info, f) {
      const d = info.d, pr = info.props, F = FACES[f].name;
      if (d.dir === 'f6' || d.dir === 'f4') {
        const fac = facingOf(pr, d.dir === 'f4' ? 'south' : 'north'), fv = DIRV[fac], vert = fac === 'up' || fac === 'down';
        if (F === fac) return { role: vert && d.fv ? 'fv' : 'f', rot: 0 };
        if (FI[F] === OPP[FI[fac]]) return { role: d.k ? 'k' : vert ? 's' : (d.dir === 'f4' ? 's' : 's'), rot: 0 };
        if (d.side === 'rot') return { role: 's', rot: bestRot(f, fv) };
        if (d.side === 'observer') {
          if (!vert && (F === 'up' || F === 'down')) return { role: 't', rot: bestRot(f, fv) };
          return { role: 's', rot: vert ? bestRot(f, fv) : 0 };
        }
        if (F === 'up') return { role: 't', rot: 0 };
        if (F === 'down') return { role: 'b', rot: 0 };
        return { role: 's', rot: 0 };
      }
      if (d.dir === 'fixed-front') {
        if (F === 'up') return { role: 't', rot: 0 };
        if (F === 'down') return { role: 'b', rot: 0 };
        return { role: F === 'north' || F === 'east' ? 'f' : 's', rot: 0 };
      }
      if (d.axis) {
        const ax = pr.axis === 'x' || pr.axis === 'z' ? pr.axis : 'y';
        if (ax === 'y') return { role: F === 'up' ? 't' : F === 'down' ? 'b' : 's', rot: 0 };
        const w = ax === 'x' ? [1, 0, 0] : [0, 0, 1];
        if ((ax === 'x' && (F === 'east' || F === 'west')) || (ax === 'z' && (F === 'north' || F === 'south'))) return { role: 't', rot: 0 };
        return { role: 's', rot: bestRot(f, w, true) };
      }
      return { role: F === 'up' ? 't' : F === 'down' ? 'b' : 's', rot: 0 };
    }

    /** Neighbour hiding rule for a boundary face. Returns null = skip, else [nbT, nbY]. */
    function hide(info, x, y, z, i, f) {
      const F = FACES[f], X = x + F.n[0], Y = y + F.n[1], Z = z + F.n[2];
      const v = at(X, Y, Z);
      if (!v) return [-1, 0];
      const nb = P[v];
      if (!nb) return [-1, 0];
      const same = nb.name === info.name && (info.cut || info.shape === 'liquid' || info.d.leafy);
      if (!(nb.occl || same)) return [-1, 0];
      if (info.shape === 'liquid' && nb.shape !== 'liquid' && !nb.occl) return [-1, 0];
      if (big) return null;
      const j = (Y * sz + Z) * sx + X;
      if (F.n[1] === 0 && times[i] > times[j]) return null;   // horizontal: only the earlier block keeps the face
      return [times[j], Y];
    }

    /** Box spanning a..b px along the facing axis (0 = the back of the cell) and c0..c1 across it. */
    const alongBox = (fac, a, b, c0, c1) => {
      switch (fac) {
        case 'east': return [a, c0, c0, b, c1, c1];
        case 'west': return [16 - b, c0, c0, 16 - a, c1, c1];
        case 'up': return [c0, a, c0, c1, b, c1];
        case 'down': return [c0, 16 - b, c0, c1, 16 - a, c1];
        case 'south': return [c0, c0, a, c1, c1, b];
        default: return [c0, c0, 16 - b, c1, c1, 16 - a];
      }
    };
    const FULL = [0, 0, 0, 16, 16, 16];
    function cubeFaces(g, info, x, y, z, i, e, opt) {
      opt = opt || {};
      for (let f = 0; f < 6; f++) {
        if (opt.skip && opt.skip[f]) continue;
        const F = FACES[f];
        // does this face lie on the block boundary?
        const onB = (F.n[0] > 0 && e[3] === 16) || (F.n[0] < 0 && e[0] === 0) || (F.n[1] > 0 && e[4] === 16) || (F.n[1] < 0 && e[1] === 0) || (F.n[2] > 0 && e[5] === 16) || (F.n[2] < 0 && e[2] === 0);
        let nb = [-1, 0];
        if (onB && opt.cull !== false) { nb = hide(info, x, y, z, i, f); if (!nb) continue; }
        const r = opt.role ? opt.role(f) : roleOf(info, f);
        const spec = opt.spec ? opt.spec(f, r) : tileSpec(info.d, r.role);
        const full = e === FULL && info.occl;
        quad(g, x, y, z, e, f, spec, r.rot, nb[0], nb[1], full ? aoOf(x, y, z, f) : null, times[i], info.glow, opt.uv && opt.uv(f));
      }
    }

    for (const i of cells) {
      const info = P[B[i]], x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
      const g = info.cut === 'translucent' ? trans : opaque, d = info.d, pr = info.props;
      switch (info.shape) {
        case 'cube':
          if (/piston$/.test(info.name) && pr.extended === 'true') {
            // extended piston: a 12 px body with the recessed inside face, and the first 4 px of the arm sticking out of it
            const fac = facingOf(pr, 'north'), fi = FI[fac];
            cubeFaces(g, info, x, y, z, i, alongBox(fac, 0, 12, 0, 16), { cull: false, spec: (f, r) => (f === fi ? tileSpec(d, 'i') : tileSpec(d, r.role)) });
            cubeFaces(g, info, x, y, z, i, alongBox(fac, 12, 16, 6, 10), { cull: false, role: () => ({ role: 's', rot: 0 }) });
          } else cubeFaces(g, info, x, y, z, i, info.occl ? FULL : [0, 0, 0, 16, 16, 16]);
          break;
        case 'pistonhead': {
          const fac = facingOf(pr, 'north'), fi = FI[fac], sticky = pr.type === 'sticky';
          cubeFaces(g, info, x, y, z, i, alongBox(fac, 12, 16, 0, 16), { cull: false, spec: (f) => (f === fi ? (sticky ? 'block/piston_top_sticky' : 'block/piston_top') : tileSpec(d, 's')) });
          cubeFaces(g, info, x, y, z, i, alongBox(fac, 0, 12, 6, 10), { cull: false, role: () => ({ role: 's', rot: 0 }) });
          break;
        }
        case 'slab': cubeFaces(g, info, x, y, z, i, pr.type === 'top' ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]); break;
        case 'stairs': {
          const top = pr.half === 'top', fac = facingOf(pr, 'north');
          cubeFaces(g, info, x, y, z, i, top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]);
          const y0 = top ? 0 : 8, y1 = top ? 8 : 16;
          const box = { east: [8, y0, 0, 16, y1, 16], west: [0, y0, 0, 8, y1, 16], south: [0, y0, 8, 16, y1, 16], north: [0, y0, 0, 16, y1, 8] }[fac];
          cubeFaces(g, info, x, y, z, i, box);
          break;
        }
        case 'carpet': cubeFaces(g, info, x, y, z, i, [0, 0, 0, 16, 1, 16]); break;
        case 'plate': cubeFaces(g, info, x, y, z, i, [1, 0, 1, 15, 1, 15], { cull: false }); break;
        case 'sensor': cubeFaces(g, info, x, y, z, i, [0, 0, 0, 16, 6, 16]); break;
        case 'farmland': cubeFaces(g, info, x, y, z, i, [0, 0, 0, 16, 15, 16]); break;
        case 'button': cubeFaces(g, info, x, y, z, i, [5, 0, 6, 11, 2, 10], { cull: false }); break;
        case 'cactus': cubeFaces(g, info, x, y, z, i, [1, 0, 1, 15, 16, 15]); break;
        case 'lever':
          cubeFaces(g, info, x, y, z, i, [5, 0, 4, 11, 3, 12], { cull: false });
          cubeFaces(g, info, x, y, z, i, [7, 3, 7, 9, 11, 9], { cull: false, spec: () => 'block/lever', role: () => ({ role: 's', rot: 0 }) });
          break;
        case 'torch':
          cubeFaces(g, info, x, y, z, i, [7, 0, 7, 9, 10, 9], { cull: false, uv: (f) => (f === 2 ? [7 / 16, 8 / 16, 9 / 16, 10 / 16] : f === 3 ? [7 / 16, 0, 9 / 16, 2 / 16] : null) });
          break;
        case 'bamboo':
          cubeFaces(g, info, x, y, z, i, [6.5, 0, 6.5, 9.5, 16, 9.5], { cull: false, uv: (f) => (f === 2 || f === 3 ? [13 / 16, 13 / 16, 1, 1] : [0, 0, 3 / 16, 1]) });
          break;
        case 'diode': {
          const fac = facingOf(pr, 'north');
          cubeFaces(g, info, x, y, z, i, [0, 0, 0, 16, 2, 16], { role: (f) => (f === 2 ? { role: 't', rot: bestRot(2, DIRV[fac]) } : { role: f === 3 ? 'b' : 's', rot: 0 }) });
          break;
        }
        case 'hopper': {
          const fac = pr.facing && DIRV[pr.facing] ? pr.facing : 'down';
          const rimRole = (f) => ({ role: f === 2 ? 't' : 's', rot: 0 });
          cubeFaces(g, info, x, y, z, i, [0, 10, 0, 16, 16, 16], { role: rimRole });
          cubeFaces(g, info, x, y, z, i, [4, 4, 4, 12, 10, 12], { cull: false, role: () => ({ role: 's', rot: 0 }) });
          const sp = { down: [6, 0, 6, 10, 4, 10], north: [6, 4, 0, 10, 8, 4], south: [6, 4, 12, 10, 8, 16], west: [0, 4, 6, 4, 8, 10], east: [12, 4, 6, 16, 8, 10] }[fac];
          cubeFaces(g, info, x, y, z, i, sp, { cull: false, role: () => ({ role: 's', rot: 0 }) });
          break;
        }
        case 'chest': cubeFaces(g, info, x, y, z, i, [1, 0, 1, 15, 14, 15], { cull: false }); break;
        case 'fence': case 'wall': {
          const wall = info.shape === 'wall';
          cubeFaces(g, info, x, y, z, i, wall ? [4, 0, 4, 12, 16, 12] : [6, 0, 6, 10, 16, 10], { cull: false });
          [['east', 1, 0], ['west', -1, 0], ['south', 0, 1], ['north', 0, -1]].forEach(([nm, dx, dz]) => {
            const v = at(x + dx, y, z + dz), nb = v && P[v];
            const conn = pr[nm] === 'true' || pr[nm] === 'low' || pr[nm] === 'tall' || (nb && (nb.occl || nb.shape === info.shape || (nb.shape === 'fence' && info.shape === 'fence')));
            if (!conn) return;
            const arm = (lo, hi, w0, w1) => (dx > 0 ? [lo, 0, w0, 16, 0, w1] : dx < 0 ? [0, 0, w0, hi, 0, w1] : dz > 0 ? [w0, 0, lo, w1, 0, 16] : [w0, 0, 0, w1, 0, hi]);
            if (wall) { const a = arm(12, 4, 5, 11); a[1] = 0; a[4] = 14; cubeFaces(g, info, x, y, z, i, a, { cull: false }); }
            else for (const [b0, b1] of [[6, 9], [12, 15]]) { const a = arm(10, 6, 7, 9); a[1] = b0; a[4] = b1; cubeFaces(g, info, x, y, z, i, a, { cull: false }); }
          });
          break;
        }
        case 'liquid': {
          const above = at(x, y + 1, z), cover = above && P[above] && P[above].name === info.name;
          cubeFaces(g, info, x, y, z, i, [0, 0, 0, 16, cover ? 16 : 14, 16]);
          break;
        }
        case 'cross': case 'rail': case 'dust': {
          const flat = (spec, rot, yy) => {
            const e = [0, yy, 0, 16, yy, 16];
            quad(g, x, y, z, e, 2, spec, rot, -1, 0, null, times[i], info.glow);
            quad(g, x, y, z, e, 3, spec, rot, -1, 0, null, times[i], info.glow);
          };
          if (info.shape === 'rail') {
            const sh = pr.shape || 'north_south';
            flat(tileSpec(d, 't'), sh.startsWith('east') || sh.startsWith('ascending_e') || sh.startsWith('ascending_w') ? 1 : 0, 1);
          } else if (info.shape === 'dust') {
            const red = '#e02a1b';
            flat('block/redstone_dust_dot' + red, 0, 0.25);
            const con = (dx, dz) => [0, 1, -1].some((dy) => { const v = at(x + dx, y + dy, z + dz); return v && P[v] && (P[v].shape === 'dust' || (dy === 0 && /observer|repeater|comparator|redstone_torch|lever|redstone_block|piston/.test(P[v].name))); })
              || (pr[{ '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }[dx + ',' + dz]] || 'none') !== 'none';
            const ns = con(0, 1) || con(0, -1), ew = con(1, 0) || con(-1, 0);
            if (ns) flat('block/redstone_dust_line0' + red, 0, 0.3);
            if (ew) flat('block/redstone_dust_line0' + red, 1, 0.35);
          } else {
            // cross plant: two diagonal planes, both sides
            const spec = tileSpec(d, 's');
            const P0 = [[0.08, 0.08], [0.92, 0.92]], P1 = [[0.92, 0.08], [0.08, 0.92]];
            for (const [a, b] of [P0, P1]) for (const back of [false, true]) {
              const v0 = g.verts, cx = x - ox + 0.5, cy = y + 0.5, cz = z - oz + 0.5;
              const corners = back ? [[b, 0, 1], [a, 0, 0], [a, 1, 0], [b, 1, 1]] : [[a, 0, 0], [b, 0, 1], [b, 1, 1], [a, 1, 0]];
              const nn = back ? [-(b[1] - a[1]), 0, b[0] - a[0]] : [b[1] - a[1], 0, -(b[0] - a[0])];
              const ti = tileOf(spec);
              corners.forEach(([pt, vy, u]) => {
                g.pos.push(x - ox + pt[0], y + vy, z - oz + pt[1]); g.nrm.push(nn[0] * 0.7, 0.7, nn[2] * 0.7);
                g.uv.push(u, vy); g.tile.push(ti); g.col.push(1, 1, 1); g.c.push(cx, cy, cz); g.t.push(times[i]); g.nb.push(-1, 0);
              });
              g.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); g.verts += 4; faces++;
            }
          }
          break;
        }
        default: cubeFaces(g, info, x, y, z, i, FULL);
      }
    }
    const fin = (g) => ({ pos: g.pos.done(), nrm: g.nrm.done(), uv: g.uv.done(), tile: g.tile.done(), col: g.col.done(), c: g.c.done(), t: g.t.done(), nb: g.nb.done(), idx: g.idx.done(), verts: g.verts });
    return { opaque: fin(opaque), trans: fin(trans), tiles, tileIndex, times, span, drop, blocks: n, faces, big };
  }

  /** Map tile-local uvs to atlas uvs in place (cols x rows grid, v up, half-texel inset). */
  function atlasUV(g, cols, rows) {
    const out = new Float32Array(g.uv.length), e = 0.5 / 16;
    for (let k = 0, v = 0; v < g.verts; v++, k += 2) {
      const t = g.tile[v], col = t % cols, row = Math.floor(t / cols);
      const u = Math.min(1 - e, Math.max(e, g.uv[k])), w = Math.min(1 - e, Math.max(e, g.uv[k + 1]));
      out[k] = (col + u) / cols; out[k + 1] = 1 - (row + 1 - w) / rows;
    }
    return out;
  }

  /* ======================================================================
   * Symmetry (pure, no DOM): mirror planes, the mismatch check, the mirrored preview
   *
   * A plane is { axis: 0 (x) | 1 (y) | 2 (z), m } with m = twice its position in block edges, so block c mirrors to
   * m - 1 - c. m odd = the plane runs through the middle of block (m - 1) / 2, m even = between two blocks. Blocks are
   * compared after mirroring their state (stairs facing east on one side match stairs facing west on the other; a top
   * slab matches a bottom slab across Y); connection and on/off properties are ignored.
   * ====================================================================== */
  const SYM_IGNORE = new Set(['waterlogged', 'powered', 'lit', 'open', 'triggered', 'distance', 'persistent', 'power', 'north', 'south', 'east', 'west', 'up', 'down',
    'in_wall', 'occupied', 'snowy', 'instrument', 'note', 'enabled', 'locked', 'delay', 'has_book', 'has_record', 'signal_fire', 'drag', 'disarmed', 'attached', 'bottom', 'unstable', 'hanging']);
  const SWAP = (a, b) => (v) => (v === a ? b : v === b ? a : v);
  const swapLR = (v) => v.replace(/left|right/g, (w) => (w === 'left' ? 'right' : 'left'));
  /** The block state as it looks in a mirror across a plane on `axis`. */
  function mirrorState(id, axis) {
    const core = C(), p = core.parse(id), pr = p.props, ks = Object.keys(pr);
    if (!ks.length) return id;
    const o = {};
    const fac = axis === 0 ? SWAP('east', 'west') : axis === 2 ? SWAP('north', 'south') : SWAP('up', 'down');
    const tok = axis === 0 ? (v) => v.replace(/east|west/g, (w) => (w === 'east' ? 'west' : 'east')) : axis === 2 ? (v) => v.replace(/north|south/g, (w) => (w === 'north' ? 'south' : 'north')) : (v) => v;
    for (const k of ks) {
      let v = pr[k];
      if (k === 'facing') v = fac(v);
      else if (axis !== 1) {
        if (k === 'shape') v = /^(north|south|east|west|ascending)/.test(v) ? tok(v) : swapLR(v);   // rails : stairs
        else if (k === 'hinge' || (k === 'type' && (v === 'left' || v === 'right'))) v = swapLR(v);
        else if (k === 'rotation') { const r = +v; v = String(axis === 0 ? (16 - r) % 16 : (24 - r) % 16); }
      } else if (k === 'half' || k === 'type') v = SWAP('top', 'bottom')(v);
      else if (k === 'face' || k === 'attachment') v = SWAP('floor', 'ceiling')(v);
      o[k] = v;
    }
    return core.stateOf(p.base, o);
  }
  /** Comparison key of a state: the block plus the properties that matter for symmetry. */
  function symKey(id) {
    const p = C().parse(id), ks = Object.keys(p.props).filter((k) => !SYM_IGNORE.has(k)).sort();
    return ks.length ? p.base + '[' + ks.map((k) => k + '=' + p.props[k]).join(',') + ']' : p.base;
  }
  /** Per palette index: class of the state (K, 0 = air) and of its mirror on each axis (KM[axis]). */
  function symClasses(s) {
    const core = C(), n = s.palette.length, cls = new Map(), K = new Int32Array(n), KM = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    const of = (id) => { const k = symKey(id); let c = cls.get(k); if (c == null) { c = cls.size + 1; cls.set(k, c); } return c; };
    for (let i = 1; i < n; i++) {
      const id = s.palette[i];
      if (core.isAir(id)) continue;
      K[i] = of(id);
      for (let a = 0; a < 3; a++) KM[a][i] = of(mirrorState(id, a));
    }
    return { K, KM };
  }
  /** Bounding box of the solid blocks: [x0, y0, z0, x1, y1, z1] (inclusive) or null. */
  function symBox(s, K) {
    K = K || symClasses(s).K;
    const [sx, sy, sz] = s.size, B = s.blocks;
    let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      if (!K[B[i]]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return x1 < 0 ? null : [x0, y0, z0, x1, y1, z1];
  }
  /** m of the plane through the middle of the build on that axis. */
  function symCentre(s, axis, box) {
    box = box === undefined ? symBox(s) : box;
    return box ? box[axis] + box[axis + 3] + 1 : s.size[axis];
  }
  /**
   * Check planes [{ axis, m }] in one pass each. -> { solid, res: [{ axis, m, diff, pct }], flags: Uint8Array per cell
   * (bit 1 << axis set where the block has no matching mirror), diff: blocks that fail any plane }.
   */
  function symCheck(s, planes, cls) {
    const [sx, sy, sz] = s.size, B = s.blocks, N = B.length, { K, KM } = cls || symClasses(s);
    const flags = new Uint8Array(N);
    let solid = 0;
    for (let i = 0; i < N; i++) if (K[B[i]]) solid++;
    const res = planes.map((pl) => {
      const a = pl.axis, m = pl.m, KA = KM[a], bit = 1 << a, n = s.size[a], stride = a === 0 ? 1 : a === 1 ? sx * sz : sx;
      let diff = 0;
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        const k = K[B[i]];
        if (!k) continue;
        const c = a === 0 ? x : a === 1 ? y : z, j = m - 1 - c;
        if (j < 0 || j >= n || KA[B[i + (j - c) * stride]] !== k) { flags[i] |= bit; diff++; }
      }
      return { axis: a, m, diff, pct: solid ? (solid - diff) / solid : 1 };
    });
    let diff = 0;
    for (let i = 0; i < N; i++) if (flags[i]) diff++;
    return { solid, res, flags, diff };
  }
  /**
   * The build as if it were perfectly symmetric: for each plane in turn the kept half (lower coordinates, or the upper
   * ones when flip has that axis' bit) is mirrored onto the other half. Cells whose mirror falls outside the box are cleared.
   */
  function symMirror(s, planes, flip) {
    const core = C(), [sx, sy, sz] = s.size;
    const o = { name: s.name, size: s.size.slice(), palette: s.palette.slice(), blocks: new Uint16Array(s.blocks) };
    const B = o.blocks;
    for (const pl of planes) {
      const a = pl.axis, m = pl.m, n = s.size[a], stride = a === 0 ? 1 : a === 1 ? sx * sz : sx, upper = !!(flip & (1 << a));
      const len = o.palette.length, map = new Uint16Array(len);
      for (let p = 1; p < len; p++) map[p] = core.isAir(o.palette[p]) ? 0 : core.pal(o, mirrorState(o.palette[p], a));
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        const c = a === 0 ? x : a === 1 ? y : z, j = m - 1 - c;
        const write = upper ? c < j : c > j;   // this cell takes the mirror of the kept side
        if (!write) continue;
        B[i] = j < 0 || j >= n ? 0 : map[B[i + (j - c) * stride]];
      }
    }
    return o;
  }
  TH.builds.sym = { mirrorState, key: symKey, classes: symClasses, box: symBox, centre: symCentre, check: symCheck, mirror: symMirror };

  TH.builds.mesh = mesh;
  TH.builds.atlasUV = atlasUV;
  if (typeof document === 'undefined') return;   // node tests: mesher only

  /* ======================================================================
   * Textures: images, composites, procedural tiles, atlas
   * ====================================================================== */
  const imgCache = new Map();
  function loadImg(url) {
    let p = imgCache.get(url);
    if (!p) {
      p = new Promise((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => res(i);
        i.onerror = () => { imgCache.delete(url); rej(new Error('texture ' + url)); };
        i.src = url;
      });
      imgCache.set(url, p);
    }
    return p;
  }
  const mkCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  /** Procedural 16x16 tiles: the chest (an entity texture in the game) and the unknown block. */
  function procTile(name, x) {
    const px = (c, a, b, w, hh) => { x.fillStyle = c; x.fillRect(a, b, w, hh); };
    if (name === 'unknown') {
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) px((i + j) % 2 ? '#5d5d66' : '#76767f', i * 4, j * 4, 4, 4);
      px('#2c2c33', 0, 0, 16, 1); px('#2c2c33', 0, 15, 16, 1); px('#2c2c33', 0, 0, 1, 16); px('#2c2c33', 15, 0, 1, 16);
      x.fillStyle = '#f2f2f2'; [[6, 4, 4, 1], [5, 5, 1, 2], [10, 5, 1, 2], [9, 7, 1, 1], [8, 8, 1, 1], [7, 9, 2, 1], [7, 11, 2, 2]].forEach((r) => x.fillRect(...r));
      return;
    }
    // chest: oak-brown planks with dark rims; front has the latch, sides the lid seam
    px('#9c6b30', 0, 0, 16, 16);
    for (let j = 0; j < 16; j += 4) px('#8a5c27', 0, j + 3, 16, 1);
    px('#b3803d', 0, 0, 16, 1);
    px('#4a2f12', 0, 0, 1, 16); px('#4a2f12', 15, 0, 1, 16); px('#4a2f12', 0, 15, 16, 1);
    if (name === 'chest_top') { px('#4a2f12', 0, 0, 16, 1); return; }
    px('#3b250d', 0, 4, 16, 1);   // lid seam
    if (name === 'chest_front') { px('#d9d9d9', 7, 3, 2, 4); px('#7d7d7d', 7, 6, 2, 1); }
  }
  /** Draw a tile spec into a 16x16 context: layers 'path#rrggbb' joined by '+', '@0.7' alpha suffix, '#name' procedural. */
  async function drawTile(spec, x) {
    if (spec.endsWith('~')) {
      // solid leaves (the game's "fast" look): the holes are filled with a darker shade of the leaf colour
      await drawTile(spec.slice(0, -1), x);
      const im = x.getImageData(0, 0, 16, 16), d = im.data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      n = n || 1;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] <= 128) { d[i] = r / n * 0.45; d[i + 1] = g / n * 0.45; d[i + 2] = b / n * 0.45; d[i + 3] = 255; } else d[i + 3] = 255;
      x.putImageData(im, 0, 0);
      return;
    }
    let alpha = 1;
    const at = spec.lastIndexOf('@');
    if (at > 0) { alpha = parseFloat(spec.slice(at + 1)) || 1; spec = spec.slice(0, at); }
    if (spec[0] === '#') { procTile(spec.slice(1), x); return; }
    for (const layer of spec.split('+')) {
      const hi = layer.indexOf('#'), path = hi >= 0 ? layer.slice(0, hi) : layer, tint = hi >= 0 ? layer.slice(hi) : null;
      const img = await loadImg(TH.icon.tex(path));
      const l = mkCanvas(16, 16), lx = l.getContext('2d', { willReadFrequently: true });
      lx.imageSmoothingEnabled = false;
      lx.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);   // animated strips: frame 0
      if (tint || alpha < 1) {
        const im = lx.getImageData(0, 0, 16, 16), d = im.data;
        const r = tint ? parseInt(tint.slice(1, 3), 16) : 255, g = tint ? parseInt(tint.slice(3, 5), 16) : 255, b = tint ? parseInt(tint.slice(5, 7), 16) : 255;
        for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * r / 255; d[i + 1] = d[i + 1] * g / 255; d[i + 2] = d[i + 2] * b / 255; if (alpha < 1 && d[i + 3]) d[i + 3] = Math.round(255 * alpha); }
        lx.putImageData(im, 0, 0);
      }
      x.drawImage(l, 0, 0);
    }
  }
  const tileCache = new Map();   // spec -> Promise<canvas 16x16>
  function tileCanvas(spec) {
    let p = tileCache.get(spec);
    if (!p) {
      p = (async () => {
        const c = mkCanvas(16, 16), x = c.getContext('2d');
        try { await drawTile(spec, x); } catch (e) { x.clearRect(0, 0, 16, 16); procTile('unknown', x); c.failed = true; }
        return c;
      })();
      tileCache.set(spec, p);
    }
    return p;
  }

  /* ======================================================================
   * Viewer
   * ====================================================================== */
  let THREE = null, threeP = null;
  const loadThree = () => threeP || (threeP = import(rel('../vendor/three.lite.module.min.js')).then((m) => { THREE = m; return m; }));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const VERT_HEAD = 'attribute vec3 aC;\nattribute float aT;\nattribute vec2 aN;\nuniform float uT;\nuniform float uD;\nuniform float uH;\nuniform float uMinY;\nuniform float uMaxY;\n';
  const VERT_BODY = [
    '#include <begin_vertex>',
    '{',
    '  float ly = floor(aC.y);',
    '  float p = clamp((uT - aT) / uD, 0.0, 1.0);',
    '  bool on = uT >= aT && ly > uMinY - 0.5 && ly < uMaxY + 0.5;',
    '  bool nOn = aN.x >= 0.0 && uT >= aN.x + uD && aN.y > uMinY - 0.5 && aN.y < uMaxY + 0.5;',
    '  if (!on || nOn) { transformed = vec3(0.0); }',
    '  else if (p < 1.0) {',
    '    float q = p / 0.62;',
    '    float fall = p < 0.62 ? 1.0 - q * q : 0.0;',
    '    float r = clamp((p - 0.62) / 0.38, 0.0, 1.0);',
    '    float hop = p >= 0.62 ? sin(r * 3.14159) * 0.10 * (1.0 - r) : 0.0;',
    '    float squash = p >= 0.62 ? sin(clamp(r / 0.45, 0.0, 1.0) * 3.14159) * 0.16 : 0.0;',
    '    float grow = mix(0.55, 1.0, smoothstep(0.0, 0.25, p));',
    '    vec3 l = transformed - aC;',
    '    float bottom = aC.y - 0.5;',
    '    float sy = (1.0 - squash) * grow, sxz = (1.0 + squash * 0.45) * grow;',
    '    transformed = vec3(aC.x + l.x * sxz, bottom + (transformed.y - bottom) * sy + fall * uH + hop, aC.z + l.z * sxz);',
    '  }',
    '}',
  ].join('\n');

  function create(host) {
    const el = document.createElement('div');
    el.className = 'bd-canvas';
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', '3D view of the build. Drag to rotate, scroll or pinch to zoom, double-click to reset.');
    host.prepend(el);
    const S = {
      el, ready: false, error: null, renderer: null, scene: null, camera: null, root: null, meshes: [], mats: [], atlas: null, grid: null, outline: null, hl: null,
      schem: null, M: null, sig: '', yaw: 0.78, pitch: 0.52, zoom: 1, vel: 0, goal: null, auto: !reduced(), lastInput: 0, dist: 30, target: [0, 4, 0],
      t: 0, mode: 'loop', speed: 1, playing: true, phase: 'in', hold: 0, minY: 0, maxY: 999, slice: false, gridOn: true, outlineOn: false,
      dirty: true, raf: 0, last: 0, inView: true, w: 0, h: 0, accent: '#ff8a3d', onState: null, onHover: null, buildId: 0,
      run: false, runIdx: 0, runT: 0, phaseSets: null, phaseInfo: null, onRun: null, symCfg: null,
    };
    const HOME = { yaw: 0.78, pitch: 0.52, zoom: 1 };
    const ZMIN = 0.35, ZMAX = 4, PMIN = -0.2, PMAX = 1.52;
    const uni = { uT: { value: 0 }, uD: { value: 0.55 }, uH: { value: 6 }, uMinY: { value: 0 }, uMaxY: { value: 999 } };

    function material(kind) {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: kind === 'trans' ? 0.02 : 0.5, transparent: kind === 'trans', depthWrite: kind !== 'trans', side: THREE.FrontSide });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uni);
        sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
      };
      m.customProgramCacheKey = () => 'bd-anim-' + kind;
      return m;
    }
    const BA = () => Object.getPrototypeOf(THREE.Float32BufferAttribute);   // BufferAttribute base (not exported by the lite build)
    function geometry(g, cols, rows) {
      const geo = new THREE.BufferGeometry(), F = (a, n) => new THREE.Float32BufferAttribute(a, n);
      geo.setAttribute('position', F(g.pos, 3));
      geo.setAttribute('normal', F(g.nrm, 3));
      geo.setAttribute('uv', F(atlasUV(g, cols, rows), 2));
      geo.setAttribute('color', F(g.col, 3));
      geo.setAttribute('aC', F(g.c, 3));
      geo.setAttribute('aT', F(g.t, 1));
      geo.setAttribute('aN', F(g.nb, 2));
      const IA = BA();
      geo.setIndex(new IA(g.idx, 1));
      return geo;
    }

    function build() {
      const canvas = document.createElement('canvas');
      canvas.className = 'bd-gl';
      S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
      S.renderer.setClearColor(0x000000, 0);
      S.renderer.outputColorSpace = THREE.SRGBColorSpace;
      S.scene = new THREE.Scene();
      S.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
      S.scene.add(new THREE.HemisphereLight(0xffffff, 0xa9a6b8, 1.7));
      const sun = new THREE.DirectionalLight(0xffffff, 1.35);
      sun.position.set(0.45, 1, 0.3);
      S.scene.add(sun);
      S.root = new THREE.Group();
      S.scene.add(S.root);
      S.mats = [material('opaque'), material('trans')];
      el.prepend(canvas);
      S.canvas = canvas;
    }

    /* ---- camera ---- */
    function fitDist() {
      const s = S.schem;
      if (!s) return 30;
      const [sx, sy, sz] = s.size, r = 0.5 * Math.hypot(sx, sy, sz) + 0.6;
      const t = Math.tan((S.camera.fov * Math.PI) / 360), aspect = Math.max(0.3, S.w / Math.max(1, S.h));
      return r / Math.sin(Math.atan(t * Math.min(1, aspect))) * 0.94;
    }
    function place() {
      const d = S.dist / S.zoom, cp = Math.cos(S.pitch);
      const [tx, ty, tz] = S.target;
      S.camera.position.set(tx + d * Math.sin(S.yaw) * cp, ty + d * Math.sin(S.pitch), tz + d * Math.cos(S.yaw) * cp);
      S.camera.near = Math.max(0.05, d / 200); S.camera.far = d * 6 + 200;
      S.camera.updateProjectionMatrix();
      S.camera.lookAt(tx, ty, tz);
      S.camera.updateMatrixWorld();
    }
    function resize() {
      if (!S.renderer) return;
      const w = el.clientWidth, hh = el.clientHeight;
      if (!w || !hh || (w === S.w && hh === S.h)) return;
      S.w = w; S.h = hh;
      S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, document.documentElement.dataset.perf === 'lite' ? 1 : 2));
      S.renderer.setSize(w, hh, false);
      S.camera.aspect = w / hh;
      S.dist = fitDist();
      S.dirty = true;
    }
    const visible = () => el.isConnected && !document.hidden && S.inView && S.ready;

    /* ---- the animation clock ---- */
    const Tend = () => (S.M ? S.M.span + S.M.drop : 0);
    function stepClock(dt) {
      if (!S.M) return false;
      const end = Tend();
      if (S.mode === 'still' || reduced()) { if (S.t !== end) { S.t = end; S.phase = 'done'; return true; } return false; }
      if (!S.playing) return false;
      const k = dt * S.speed;
      if (S.phase === 'in') { S.t += k; if (S.t >= end) { S.t = end; S.phase = S.mode === 'loop' && !S.run ? 'hold' : 'done'; S.hold = 0; } }
      else if (S.phase === 'hold') {
        if (S.run) { S.phase = 'done'; return true; } S.hold += dt; if (S.hold >= 2) S.phase = 'out'; }
      else if (S.phase === 'out') { S.t -= k * 1.6; if (S.t <= 0) { S.t = 0; S.phase = 'gap'; S.hold = 0; } }
      else if (S.phase === 'gap') { S.hold += dt; if (S.hold >= 0.6) S.phase = 'in'; }
      else return false;
      return true;
    }
    /** Machine phases (pistons out, pistons back ...): once the build has landed, step through them on their own clock. */
    function setPhase(k) {
      if (!S.phaseSets) return;
      S.runIdx = k;
      S.phaseSets.forEach((set, j) => set.forEach((m) => { m.visible = j === k; }));
      S.dirty = true;
      if (S.onRun) S.onRun(k, S.phaseInfo[k], S.run);
    }
    function stepRun(dt) {
      if (!S.run || !S.phaseSets || S.phaseSets.length < 2 || reduced()) return false;
      if (S.phase !== 'done' && S.phase !== 'hold') return false;
      if (S.t < Tend() - 1e-3) return false;
      S.runT += dt * S.speed;
      if (S.runT >= S.phaseInfo[S.runIdx].dur) { S.runT = 0; setPhase((S.runIdx + 1) % S.phaseSets.length); return true; }
      return false;
    }
    function frame(now) {
      S.raf = 0;
      if (!visible()) return;
      const dt = Math.min(0.05, (now - (S.last || now)) / 1000);
      S.last = now;
      let moving = false;
      if (S.goal) {
        const k = 1 - Math.pow(0.0008, dt);
        S.yaw += (S.goal.yaw - S.yaw) * k; S.pitch += (S.goal.pitch - S.pitch) * k; S.zoom += (S.goal.zoom - S.zoom) * k;
        if (Math.abs(S.goal.yaw - S.yaw) + Math.abs(S.goal.pitch - S.pitch) + Math.abs(S.goal.zoom - S.zoom) < 0.002) { Object.assign(S, S.goal); S.goal = null; }
        moving = true;
      }
      if (!dragging && Math.abs(S.vel) > 0.01) { S.yaw += S.vel * dt; S.vel *= Math.exp(-3.2 * dt); moving = true; }
      if (!S.auto && !reduced() && !dragging && !S.slice && S.autoOk && now - S.lastInput > 7000) S.auto = true;   // idle again: resume the slow turn
      if (S.auto && !dragging && !S.goal && !S.slice) { S.yaw += 0.16 * dt; moving = true; }
      if (stepRun(dt)) moving = true;
      const ticking = stepClock(dt);
      if (ticking) { uni.uT.value = S.t; moving = true; if (S.onState) S.onState(state()); }
      const running = S.run && S.phaseSets && S.phaseSets.length > 1;
      const animating = (S.playing && S.mode !== 'still' && !reduced() && S.phase !== 'done') || running;
      if (moving || S.dirty) { resize(); place(); S.renderer.render(S.scene, S.camera); S.dirty = false; }
      if (moving || dragging || animating) S.raf = requestAnimationFrame(frame);
    }
    function wake() { if (!S.raf && visible()) { S.last = 0; S.raf = requestAnimationFrame(frame); } }
    S.wake = () => { S.dirty = true; wake(); };
    const state = () => ({ t: S.t, end: Tend(), phase: S.phase, playing: S.playing, mode: S.mode });

    /* ---- input: orbit, zoom, pinch, inertia, hover ---- */
    let dragging = false, moved = 0;
    const ptrs = new Map();
    let pinch0 = 0, zoom0 = 1, lastT = 0;
    const touched = () => { S.lastInput = performance.now(); if (S.auto) { S.auto = false; } };
    const pdist = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touched(); S.goal = null; S.vel = 0; dragging = true; moved = 0; lastT = e.timeStamp;
      if (ptrs.size === 2) { pinch0 = pdist(); zoom0 = S.zoom; }
      el.classList.add('grab'); hover(null);
    });
    el.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) { if (e.pointerType !== 'touch') hoverAt(e); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 2) S.zoom = clamp(zoom0 * pdist() / pinch0, ZMIN, ZMAX);
      else {
        S.yaw -= dx * 0.0095; S.pitch = clamp(S.pitch + dy * 0.0065, PMIN, PMAX);
        const dt = Math.max(0.004, (e.timeStamp - lastT) / 1000);
        S.vel = clamp(S.vel * 0.5 + (-dx * 0.0095 / dt) * 0.5, -8, 8);
      }
      lastT = e.timeStamp; touched();
      S.dirty = true; wake();
    });
    const up = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      if (!ptrs.size) { dragging = false; el.classList.remove('grab'); if (e.timeStamp - lastT > 90 || reduced()) S.vel = 0; wake(); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => hover(null));
    el.addEventListener('wheel', (e) => {
      e.preventDefault(); touched(); S.goal = null;
      S.zoom = clamp(S.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0013)), ZMIN, ZMAX);
      S.dirty = true; wake();
    }, { passive: false });
    el.addEventListener('dblclick', () => S.reset());
    el.addEventListener('keydown', (e) => {
      const k = e.key, map = { ArrowLeft: () => { S.yaw -= 0.16; }, ArrowRight: () => { S.yaw += 0.16; }, ArrowUp: () => { S.pitch = clamp(S.pitch + 0.08, PMIN, PMAX); }, ArrowDown: () => { S.pitch = clamp(S.pitch - 0.08, PMIN, PMAX); },
        '+': () => { S.zoom = clamp(S.zoom * 1.12, ZMIN, ZMAX); }, '=': () => { S.zoom = clamp(S.zoom * 1.12, ZMIN, ZMAX); }, '-': () => { S.zoom = clamp(S.zoom / 1.12, ZMIN, ZMAX); } };
      if (map[k]) { e.preventDefault(); touched(); S.goal = null; map[k](); S.dirty = true; wake(); }
      else if (k === '0' || k === 'Home') { e.preventDefault(); S.reset(); }
    });
    S.reset = () => {
      touched(); S.vel = 0;
      const home = S.slice ? { yaw: S.yaw, pitch: PMAX, zoom: 1 } : HOME;
      const g = Object.assign({}, home, { yaw: S.slice ? S.yaw : Math.round((S.yaw - home.yaw) / (Math.PI * 2)) * Math.PI * 2 + home.yaw });
      if (reduced()) { Object.assign(S, g); S.goal = null; } else S.goal = g;
      S.dirty = true; wake();
    };
    S.zoomBy = (f) => { touched(); S.goal = null; S.zoom = clamp(S.zoom * f, ZMIN, ZMAX); S.dirty = true; wake(); };
    S.setAuto = (on) => { S.auto = !!on && !reduced(); S.autoOk = S.auto; if (S.auto) { S.goal = null; S.vel = 0; } wake(); };

    /* hover pick: a voxel walk (DDA) along the mouse ray, only blocks that are shown and landed */
    let hovered = null;
    function hover(hit) {
      const k = hit ? hit.join() : '';
      if (k === (hovered ? hovered.join() : '')) return;
      hovered = hit;
      if (S.hl) {
        S.hl.visible = !!hit;
        if (hit) { const s = S.schem; S.hl.position.set(hit[0] - s.size[0] / 2 + 0.5, hit[1] + 0.5, hit[2] - s.size[2] / 2 + 0.5); }
        S.dirty = true; wake();
      }
      if (S.onHover) S.onHover(hit);
    }
    function hoverAt(e) {
      if (!S.ready || !S.schem || !S.M) return;
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const a = new THREE.Vector3(nx, ny, -1).unproject(S.camera), b = new THREE.Vector3(nx, ny, 1).unproject(S.camera);
      const s = S.schem, [sx, sy, sz] = s.size;
      // to grid space
      const o = [a.x + sx / 2, a.y, a.z + sz / 2], d0 = [b.x - a.x, b.y - a.y, b.z - a.z], L = Math.hypot(...d0), d = d0.map((v) => v / L);
      // clip to the box
      let t0 = 0, t1 = L;
      const lo = [0, 0, 0], hi = [sx, sy, sz];
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return hover(null); continue; }
        let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 > t1) return hover(null);
      const p = o.map((v, k) => v + d[k] * (t0 + 1e-4));
      let x = Math.min(sx - 1, Math.floor(p[0])), y = Math.min(sy - 1, Math.floor(p[1])), z = Math.min(sz - 1, Math.floor(p[2]));
      const st = d.map((v) => (v > 0 ? 1 : -1));
      const tMax = d.map((v, k) => { const c = [x, y, z][k] + (v > 0 ? 1 : 0); return Math.abs(v) < 1e-9 ? Infinity : t0 + (c - p[k]) / v; });
      const tD = d.map((v) => (Math.abs(v) < 1e-9 ? Infinity : Math.abs(1 / v)));
      const T = S.M.times, D = S.M.drop, lo2 = S.minY, hi2 = S.maxY;
      for (let n = 0; n < 2000; n++) {
        if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) break;
        const i = (y * sz + z) * sx + x;
        if (s.blocks[i] && y >= lo2 && y <= hi2 && T[i] >= 0 && S.t >= T[i] + D * 0.8) return hover([x, y, z]);
        const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
        if (k === 0) { x += st[0]; tMax[0] += tD[0]; } else if (k === 1) { y += st[1]; tMax[1] += tD[1]; } else { z += st[2]; tMax[2] += tD[2]; }
      }
      hover(null);
    }

    /* ---- scene content ---- */
    function clearContent() {
      S.meshes.forEach((m) => { S.root.remove(m); m.geometry.dispose(); });
      S.meshes = [];
      if (S.atlas) { S.atlas.dispose(); S.atlas = null; }
      [S.grid, S.outline, S.hl].forEach((m) => { if (m) { S.root.remove(m); m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
      S.grid = S.outline = S.hl = null;
      clearSym();
    }
    /** Quads helper for overlay meshes. */
    function quadsGeo(list) {
      const pos = [], idx = [], uv = [];
      list.forEach((q) => { const o = pos.length / 3; q.forEach((p) => pos.push(p[0], p[1], p[2])); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    }
    /** Blueprint ground: dots on every block corner, a soft contact shadow of the footprint, fading out at the rim. */
    function makeGrid() {
      const s = S.schem, [sx, , sz] = s.size, pad = Math.max(3, Math.round(Math.max(sx, sz) * 0.35));
      const W = sx + 2 * pad, H = sz + 2 * pad, ppc = Math.max(4, Math.min(24, Math.floor(2048 / Math.max(W, H))));
      const c = mkCanvas(W * ppc, H * ppc), x = c.getContext('2d');
      // contact shadow: the footprint (any block in the column), blurred
      const sh = mkCanvas(W * ppc, H * ppc), shx = sh.getContext('2d');
      shx.fillStyle = '#000';
      for (let z = 0; z < sz; z++) for (let xx = 0; xx < sx; xx++) {
        let any = false;
        for (let y = 0; y < Math.min(3, s.size[1]) && !any; y++) if (s.blocks[(y * sz + z) * sx + xx]) any = true;
        if (any) shx.fillRect((xx + pad) * ppc, (z + pad) * ppc, ppc, ppc);
      }
      x.save(); x.filter = 'blur(' + Math.round(ppc * 0.9) + 'px)'; x.globalAlpha = 0.34; x.drawImage(sh, 0, 0); x.restore();
      // dots
      const dot = Math.max(1, Math.round(ppc / 11));
      x.fillStyle = S.accent;
      for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
        const dx = (i - W / 2) / (W / 2), dz = (j - H / 2) / (H / 2), r = Math.hypot(dx, dz);
        const a = Math.max(0, 1 - Math.pow(r / 1.05, 3));
        if (a <= 0.02) continue;
        x.globalAlpha = 0.55 * a;
        x.fillRect(i * ppc - dot, j * ppc - dot, dot * 2, dot * 2);
      }
      x.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const y = -0.005, x0 = -sx / 2 - pad, z0 = -sz / 2 - pad;
      const g = quadsGeo([[[x0, y, z0 + H], [x0 + W, y, z0 + H], [x0 + W, y, z0], [x0, y, z0]]]);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.renderOrder = -1;
      m.visible = S.gridOn;
      return m;
    }
    /** Outline of one layer (edges between filled and empty cells), drawn on top of it; the layer below as a faint ghost. */
    function makeOutline() {
      const s = S.schem;
      if (!s) return null;
      const [sx, sy, sz] = s.size, L = clamp(S.maxY, 0, sy - 1), w = 0.07;
      const quads = [], ghost = [];
      const filled = (x, y, z) => x >= 0 && z >= 0 && x < sx && z < sz && y >= 0 && y < sy && s.blocks[(y * sz + z) * sx + x];
      const edges = (y, out, hY) => {
        for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
          if (!filled(x, y, z)) continue;
          const X = x - sx / 2, Z = z - sz / 2;
          if (!filled(x, y, z - 1)) out.push([[X, hY, Z + w], [X + 1, hY, Z + w], [X + 1, hY, Z - w], [X, hY, Z - w]]);
          if (!filled(x, y, z + 1)) out.push([[X, hY, Z + 1 + w], [X + 1, hY, Z + 1 + w], [X + 1, hY, Z + 1 - w], [X, hY, Z + 1 - w]]);
          if (!filled(x - 1, y, z)) out.push([[X - w, hY, Z + 1], [X + w, hY, Z + 1], [X + w, hY, Z], [X - w, hY, Z]]);
          if (!filled(x + 1, y, z)) out.push([[X + 1 - w, hY, Z + 1], [X + 1 + w, hY, Z + 1], [X + 1 + w, hY, Z], [X + 1 - w, hY, Z]]);
        }
      };
      edges(L, quads, L + 1.02);
      if (S.slice && L > 0) edges(L - 1, ghost, L + 1.01);
      const grp = new THREE.Group();
      if (quads.length) { const m = new THREE.Mesh(quadsGeo(quads), new THREE.MeshBasicMaterial({ color: new THREE.Color(S.accent), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })); m.renderOrder = 10; grp.add(m); }
      if (ghost.length) { const m = new THREE.Mesh(quadsGeo(ghost), new THREE.MeshBasicMaterial({ color: new THREE.Color(S.accent), transparent: true, opacity: 0.28, depthTest: false, depthWrite: false })); m.renderOrder = 9; grp.add(m); }
      grp.geometry = { dispose() { grp.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); } };
      grp.material = { dispose() {}, map: null };
      return grp;
    }
    function refreshOutline() {
      if (S.outline) { S.root.remove(S.outline); S.outline.geometry.dispose(); S.outline = null; }
      if ((S.outlineOn || S.slice) && S.schem) { S.outline = makeOutline(); if (S.outline) S.root.add(S.outline); }
      S.dirty = true; wake();
    }
    function makeHighlight() {
      const e = 0.51, q = [];
      FACES.forEach((F) => q.push(F.c.map((c) => [(c[0] - 0.5) * 2 * e, (c[1] - 0.5) * 2 * e, (c[2] - 0.5) * 2 * e])));
      const m = new THREE.Mesh(quadsGeo(q), new THREE.MeshBasicMaterial({ color: new THREE.Color(S.accent), transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.renderOrder = 8; m.visible = false;
      return m;
    }

    /* ---- symmetry overlay: translucent mirror planes + the blocks without a mirrored twin ---- */
    const SYM_BAD = '#ff4664';
    let symGrp = null;
    function clearSym() {
      if (!symGrp) return;
      if (S.root) S.root.remove(symGrp);
      symGrp.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
      symGrp = null;
    }
    /** One mirror plane across the solid box: a faint sheet with a brighter rim. */
    function symPlane(axis, m, box, grp) {
      const s = S.schem, [sx, , sz] = s.size, pad = 0.8, rim = 0.07;
      const lo = [box[0] - sx / 2 - pad, box[1] - pad, box[2] - sz / 2 - pad], hi = [box[3] + 1 - sx / 2 + pad, box[4] + 1 + pad, box[5] + 1 - sz / 2 + pad];
      const at = m / 2 - (axis === 0 ? sx / 2 : axis === 2 ? sz / 2 : 0);
      const u = axis === 0 ? 2 : 0, v = axis === 1 ? 2 : 1;   // the two in-plane axes
      const P = (a, b, d) => { const p = [0, 0, 0]; p[axis] = at + (d || 0); p[u] = a; p[v] = b; return p; };
      const rect = (a0, b0, a1, b1) => [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
      // the rim also stands out of the plane a little, so a plane seen edge-on still shows as a line
      const fin = (a0, b0, a1, b1) => [P(a0, b0, -rim), P(a1, b1, -rim), P(a1, b1, rim), P(a0, b0, rim)];
      const mat = (op) => new THREE.MeshBasicMaterial({ color: new THREE.Color(S.accent), transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
      const sheet = new THREE.Mesh(quadsGeo([rect(lo[u], lo[v], hi[u], hi[v])]), mat(0.13));
      const edge = new THREE.Mesh(quadsGeo([rect(lo[u], lo[v], hi[u], lo[v] + rim), rect(lo[u], hi[v] - rim, hi[u], hi[v]), rect(lo[u], lo[v] + rim, lo[u] + rim, hi[v] - rim), rect(hi[u] - rim, lo[v] + rim, hi[u], hi[v] - rim),
        fin(lo[u], lo[v], hi[u], lo[v]), fin(lo[u], hi[v], hi[u], hi[v]), fin(lo[u], lo[v], lo[u], hi[v]), fin(hi[u], lo[v], hi[u], hi[v])]), mat(0.75));
      sheet.renderOrder = 6; edge.renderOrder = 7;
      grp.add(sheet, edge);
    }
    /** Inflated cubes on every flagged block. They land with the build and follow the layer range (same shader). */
    function symMarks(flags, grp) {
      const s = S.schem, [sx, sy, sz] = s.size, T = S.M.times, ox = sx / 2, oz = sz / 2, e = 0.52;
      const on = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && flags[(y * sz + z) * sx + x] && T[(y * sz + z) * sx + x] >= 0;
      let n = 0;
      for (let i = 0; i < flags.length; i++) if (flags[i] && T[i] >= 0) n++;
      if (!n) return;
      const pos = new Float32Array(n * 72), c = new Float32Array(n * 72), t = new Float32Array(n * 24), nb = new Float32Array(n * 48), idx = new Uint32Array(n * 36);
      let v = 0, k = 0;
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!flags[i] || T[i] < 0) continue;
        const cx = x - ox + 0.5, cy = y + 0.5, cz = z - oz + 0.5;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f], X = x + F.n[0], Y = y + F.n[1], Z = z + F.n[2], next = on(X, Y, Z);
          if (next && F.n[1] === 0) continue;   // a flagged neighbour in the same layer: the face between them never shows
          const j = (Y * sz + Z) * sx + X;
          for (let q = 0; q < 4; q++) {
            const p = F.c[q], o = v * 3;
            pos[o] = cx + (p[0] - 0.5) * 2 * e; pos[o + 1] = cy + (p[1] - 0.5) * 2 * e; pos[o + 2] = cz + (p[2] - 0.5) * 2 * e;
            c[o] = cx; c[o + 1] = cy; c[o + 2] = cz;
            t[v] = T[i]; nb[v * 2] = next ? T[j] : -1; nb[v * 2 + 1] = next ? Y : 0;
            v++;
          }
          idx.set([v - 4, v - 3, v - 2, v - 4, v - 2, v - 1], k); k += 6;
        }
      }
      const geo = new THREE.BufferGeometry(), F32 = (a, w) => new THREE.Float32BufferAttribute(a, w);
      geo.setAttribute('position', F32(pos.subarray(0, v * 3), 3));
      geo.setAttribute('aC', F32(c.subarray(0, v * 3), 3));
      geo.setAttribute('aT', F32(t.subarray(0, v), 1));
      geo.setAttribute('aN', F32(nb.subarray(0, v * 2), 2));
      const IA = BA();
      geo.setIndex(new IA(idx.subarray(0, k), 1));
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SYM_BAD), transparent: true, opacity: 0.5, depthWrite: false });
      mat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uni); sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY); };
      mat.customProgramCacheKey = () => 'bd-sym-marks';
      const mesh2 = new THREE.Mesh(geo, mat);
      mesh2.renderOrder = 8; mesh2.frustumCulled = false;
      grp.add(mesh2);
    }
    function drawSym() {
      clearSym();
      const cfg = S.symCfg;
      // only once the meshes of this very schematic are in (setSchematic draws it again when they arrive)
      if (!cfg || !S.ready || !S.schem || !S.M || S.Mfor !== S.schem || cfg.schem !== S.schem || !cfg.planes.length) { S.dirty = true; wake(); return; }
      const box = TH.builds.sym.box(S.schem) || [0, 0, 0, S.schem.size[0] - 1, S.schem.size[1] - 1, S.schem.size[2] - 1];
      symGrp = new THREE.Group();
      cfg.planes.forEach((p) => symPlane(p.axis, p.m, box, symGrp));
      if (cfg.flags && cfg.flags.length === S.schem.blocks.length) symMarks(cfg.flags, symGrp);
      S.root.add(symGrp);
      S.dirty = true; wake();
    }
    /**
     * Symmetry overlay. cfg = null (off) or { schem, planes: [{ axis, m }], flags: Uint8Array | null } where schem is the
     * schematic the planes and flags belong to (ignored while another one is on the stage).
     */
    S.setSymmetry = (cfg) => { S.symCfg = cfg || null; if (S.ready) drawSym(); };

    /**
     * Show a schematic. opts.animate: replay the assemble from the start; otherwise show it complete.
     * opts.keepView: keep the camera (live shape editing). Returns a promise that resolves when textures are in.
     */
    S.setSchematic = async (schem, opts) => {
      opts = opts || {};
      const id = ++S.buildId;
      S.schem = schem;
      if (!S.ready) return;
      const reg = { tiles: [], tileIndex: new Map() }, ph = opts.phases && opts.phases.length > 1 ? opts.phases : null;
      const M = mesh(schem, reg);
      const Ms = ph ? ph.map((p) => (p.schem === schem ? M : mesh(p.schem, reg))) : [M];
      // texture atlas (tiles load in parallel; a failed one becomes the unknown tile)
      const canv = await Promise.all(M.tiles.map(tileCanvas));
      if (id !== S.buildId || !S.ready) return;
      const cols = Math.max(1, Math.ceil(Math.sqrt(M.tiles.length))), rows = Math.max(1, Math.ceil(M.tiles.length / cols));
      const ac = mkCanvas(cols * 16, rows * 16), ax = ac.getContext('2d');
      canv.forEach((c, i) => ax.drawImage(c, (i % cols) * 16, Math.floor(i / cols) * 16));
      clearContent();
      S.M = M; S.Mfor = schem;
      const tex = new THREE.CanvasTexture(ac);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
      S.atlas = tex;
      S.mats.forEach((m) => { m.map = tex; m.needsUpdate = true; });
      S.phaseSets = [];
      Ms.forEach((Mk, j) => {
        const set = [];
        [[Mk.opaque, S.mats[0]], [Mk.trans, S.mats[1]]].forEach(([g, m], k) => {
          if (!g.verts) return;
          const mm = new THREE.Mesh(geometry(g, cols, rows), m);
          mm.renderOrder = k;
          mm.frustumCulled = false;   // vertices move in the shader
          mm.visible = j === 0;
          S.root.add(mm); S.meshes.push(mm); set.push(mm);
        });
        S.phaseSets.push(set);
      });
      S.phaseInfo = ph ? ph.map((p) => ({ label: p.label, dur: p.dur || 1.5 })) : null;
      S.runIdx = 0; S.runT = 0; S.run = false;
      S.grid = makeGrid(); S.root.add(S.grid);
      S.hl = makeHighlight(); S.root.add(S.hl);
      uni.uD.value = M.drop; uni.uH.value = clamp(schem.size[1] * 0.5 + 3, 4, 14);
      S.maxY = Math.min(S.maxY, schem.size[1] - 1);
      if (opts.layer === 'top' || S.maxY < 0) S.maxY = schem.size[1] - 1;
      S.minY = S.slice ? S.maxY : 0;
      uni.uMaxY.value = S.maxY; uni.uMinY.value = S.minY;
      if (!opts.keepView) {
        S.target = [0, schem.size[1] * 0.47, 0];
        S.w = 0; resize(); S.dist = fitDist();
        if (!opts.keepZoom) { S.zoom = 1; S.goal = null; }
      } else { S.target = [0, schem.size[1] * 0.47, 0]; S.dist = fitDist(); }
      if (opts.animate && S.mode !== 'still' && !reduced()) { S.t = 0; S.phase = 'in'; S.playing = true; }
      else { S.t = Tend(); S.phase = S.mode === 'loop' && S.playing && !reduced() ? 'hold' : 'done'; S.hold = 0; }
      uni.uT.value = S.t;
      refreshOutline();
      drawSym();
      hover(null);
      if (S.onState) S.onState(state());
      S.dirty = true; wake();
      return M;
    };
    S.stats = () => (S.M ? { blocks: S.M.blocks, faces: S.M.faces, tiles: S.M.tiles.length, verts: S.M.opaque.verts + S.M.trans.verts, big: S.M.big } : null);

    /* ---- playback controls ---- */
    S.play = () => { if (S.phase === 'done' && S.mode !== 'still') { S.t = S.t >= Tend() ? 0 : S.t; S.phase = 'in'; } S.playing = true; S.last = 0; if (S.onState) S.onState(state()); S.wake(); };
    S.pause = () => { S.playing = false; if (S.onState) S.onState(state()); S.wake(); };
    S.replay = () => { S.t = 0; S.phase = 'in'; S.playing = true; uni.uT.value = 0; if (S.onState) S.onState(state()); S.wake(); };
    S.disassemble = () => { S.phase = 'out'; S.playing = true; if (S.onState) S.onState(state()); S.wake(); };
    S.setMode = (m) => {
      S.mode = m;
      if (m === 'still') { S.t = Tend(); S.phase = 'done'; uni.uT.value = S.t; }
      else if (m === 'loop' && S.phase === 'done') { S.phase = 'hold'; S.hold = 0; }
      if (S.onState) S.onState(state());
      S.wake();
    };
    /** Start / stop stepping through the machine phases (only when the build came with phases). */
    S.setRun = (on) => {
      S.run = !!on && !!S.phaseSets && S.phaseSets.length > 1;
      S.runT = 0;
      if (!S.run) setPhase(0); else { if (S.phase === 'hold') S.phase = 'done'; S.dirty = true; if (S.onRun) S.onRun(S.runIdx, S.phaseInfo[S.runIdx], true); }
      S.wake();
    };
    S.hasRun = () => !!(S.phaseSets && S.phaseSets.length > 1);
    S.setSpeed = (v) => { S.speed = clamp(+v || 1, 0.1, 8); };
    S.setLayer = (y) => {
      if (!S.schem) return;
      S.maxY = clamp(Math.round(y), 0, S.schem.size[1] - 1);
      S.minY = S.slice ? S.maxY : 0;
      uni.uMaxY.value = S.maxY; uni.uMinY.value = S.minY;
      refreshOutline(); hover(null);
    };
    S.setSlice = (on) => {
      S.slice = !!on;
      S.minY = S.slice ? S.maxY : 0; uni.uMinY.value = S.minY;
      if (S.slice) { S.auto = false; S.vel = 0; S.goal = { yaw: Math.round(S.yaw / (Math.PI / 2)) * (Math.PI / 2), pitch: PMAX, zoom: Math.max(1, S.zoom) }; }
      else S.goal = Object.assign({}, HOME, { yaw: S.yaw, zoom: S.zoom });
      if (reduced() && S.goal) { Object.assign(S, S.goal); S.goal = null; }
      refreshOutline();
    };
    S.setGrid = (on) => { S.gridOn = !!on; if (S.grid) S.grid.visible = S.gridOn; S.wake(); };
    S.setOutline = (on) => { S.outlineOn = !!on; refreshOutline(); };
    /** The accent colour changed (theme switch): repaint grid, outline, highlight. */
    S.setAccent = (c) => {
      if (!c || c === S.accent) return;
      S.accent = c;
      if (!S.ready || !S.schem || !S.M) return;
      if (S.grid) { S.root.remove(S.grid); S.grid.geometry.dispose(); S.grid.material.map.dispose(); S.grid.material.dispose(); }
      S.grid = makeGrid(); S.root.add(S.grid);
      if (S.hl) S.hl.material.color = new THREE.Color(c);
      refreshOutline();
      if (symGrp) drawSym();
    };
    /** Jump the clock to t seconds (null = the end) and draw one frame right away, even while hidden (tests, PNG). */
    S.seek = (t) => {
      if (!S.ready || !S.M) return;
      S.t = t == null ? Tend() : clamp(t, 0, Tend()); uni.uT.value = S.t;
      resize(); place(); S.renderer.render(S.scene, S.camera);
      if (S.onState) S.onState(state());
    };
    S.shot = () => new Promise((res) => {
      if (!S.ready) return res(null);
      resize(); place(); S.renderer.render(S.scene, S.camera);
      S.canvas.toBlob((b) => res(b), 'image/png');
    });

    /* ---- life cycle ---- */
    let initP = null, ro = null, io = null;
    const onVis = () => { if (!document.hidden) S.wake(); };
    S.init = () => initP || (initP = loadThree().then(() => {
      try { build(); } catch (e) { S.error = 'WebGL is not available in this browser, so the 3D view cannot start.'; throw e; }
      S.ready = true;
      if (!el.isConnected) { S.dispose(); throw new Error('left the tab while loading'); }   // the user left before three.js arrived
      ro = new ResizeObserver(() => { S.dirty = true; wake(); }); ro.observe(el);
      io = new IntersectionObserver((en) => { S.inView = en[en.length - 1].isIntersecting; if (S.inView) S.wake(); }); io.observe(el);
      document.addEventListener('visibilitychange', onVis);
      S.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.ready = false; });
      S.canvas.addEventListener('webglcontextrestored', () => { S.ready = true; if (S.schem) S.setSchematic(S.schem, { keepView: true }); });
      return S;
    }).catch((e) => { S.error = S.error || 'Could not start the 3D view: ' + (e && e.message ? e.message : e); initP = null; throw e; }));
    /** Free every GPU resource (leaving the tab). init() builds it all again. */
    S.dispose = () => {
      if (S.raf) cancelAnimationFrame(S.raf);
      S.raf = 0;
      if (!S.ready && !S.renderer) return;
      clearContent();
      S.mats.forEach((m) => m.dispose()); S.mats = [];
      if (S.renderer) { S.renderer.dispose(); try { S.renderer.forceContextLoss(); } catch (e) { /* ignore */ } }
      if (S.canvas) S.canvas.remove();
      if (ro) ro.disconnect(); if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      S.renderer = S.scene = S.camera = S.root = S.canvas = null; S.M = null;
      S.ready = false; S.w = S.h = 0; initP = null;
    };
    S.isRunning = () => !!S.raf;
    return S;
  }

  TH.builds.view = { create, loadThree, tileCanvas };
})();
