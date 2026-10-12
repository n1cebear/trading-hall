/**
 * Builds shape generators (pure functions, no UI). Every generator takes a params object and returns a Schematic
 * (see builds-core.js), cropped to its blocks.
 *
 * Discretisation (the usual Minecraft way): a shape of diameter D has its centre on a block when D is odd
 * (centre: 'block', D = 2r + 1) and between blocks when D is even (centre: 'edge', D = 2r). A cell belongs to the shape
 * when its centre is inside the true shape of radius D / 2. Hollow shapes keep the cells that are within `thick` face
 * steps of the outside (erosion with the 6 face neighbours), so the shell is watertight from every side. Cells with no
 * face neighbour at all (lonely tips) are removed.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;

  /** Repeatable random numbers (mulberry32). */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Cell offsets from the centre along one axis for a radius and centre mode: D cells, centred. */
  const diam = (r, centre) => (centre === 'edge' ? Math.max(1, 2 * r) : 2 * r + 1);
  const off = (i, D) => i - (D - 1) / 2;    // offset of cell i's centre from the shape centre

  /** A 3D boolean mask with helpers. */
  function mask(sx, sy, sz) {
    const m = new Uint8Array(sx * sy * sz);
    return {
      sx, sy, sz, m,
      i: (x, y, z) => (y * sz + z) * sx + x,
      at(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz ? m[(y * sz + z) * sx + x] : 0; },
    };
  }
  function fill(M, fn) {
    for (let y = 0; y < M.sy; y++) for (let z = 0; z < M.sz; z++) for (let x = 0; x < M.sx; x++) if (fn(x, y, z)) M.m[M.i(x, y, z)] = 1;
    return M;
  }
  /**
   * Keep only the outer `thick` layers. axes: 'xyz' (3D shell), 'xz' (walls only: cylinders, rings).
   * openY: { bottom, top } treats the outside below / above as solid (no floor / roof is added there).
   */
  function shell(M, thick, axes, openY) {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    if (axes !== 'xz') dirs.push([0, 1, 0], [0, -1, 0]);
    let cur = M.m;
    for (let k = 0; k < thick; k++) {
      const next = new Uint8Array(cur.length);
      for (let y = 0; y < M.sy; y++) for (let z = 0; z < M.sz; z++) for (let x = 0; x < M.sx; x++) {
        const i = M.i(x, y, z);
        if (!cur[i]) continue;
        let keep = 1;
        for (const [dx, dy, dz] of dirs) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (Y < 0 && openY && openY.bottom) continue;
          if (Y >= M.sy && openY && openY.top) continue;
          if (X < 0 || Y < 0 || Z < 0 || X >= M.sx || Y >= M.sy || Z >= M.sz || !cur[M.i(X, Y, Z)]) { keep = 0; break; }
        }
        next[i] = keep;
      }
      cur = next;
    }
    const out = new Uint8Array(M.m.length);
    for (let i = 0; i < out.length; i++) out[i] = M.m[i] && !cur[i] ? 1 : 0;
    M.m = out;
    return M;
  }
  /** Remove cells without any face neighbour (lonely tips of the discretisation). */
  function tidy(M) {
    const d = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let total = 0;
    for (let i = 0; i < M.m.length; i++) total += M.m[i];
    if (total <= 1) return M;
    for (let y = 0; y < M.sy; y++) for (let z = 0; z < M.sz; z++) for (let x = 0; x < M.sx; x++) {
      const i = M.i(x, y, z);
      if (M.m[i] && !d.some(([a, b, c]) => M.at(x + a, y + b, z + c))) M.m[i] = 0;
    }
    return M;
  }
  /** Mask -> schematic, block chosen per cell (default the primary). */
  function toSchem(M, name, pick) {
    const s = C().fromFunction([M.sx, M.sy, M.sz], (x, y, z) => (M.m[M.i(x, y, z)] ? pick(x, y, z) : null), name);
    return C().trim(s);
  }
  const clampI = (v, lo, hi, dft) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dft; };
  const B = (p) => p.block || 'minecraft:stone_bricks';
  const B2 = (p) => p.block2 || p.block || 'minecraft:stone_bricks';

  /* ======================================================================
   * Shapes
   * ====================================================================== */
  function ellipsoidMask(rx, ry, rz, centre) {
    const Dx = diam(rx, centre), Dy = diam(ry, centre), Dz = diam(rz, centre);
    const Rx = Dx / 2, Ry = Dy / 2, Rz = Dz / 2;
    return fill(mask(Dx, Dy, Dz), (x, y, z) => {
      const a = off(x, Dx) / Rx, b = off(y, Dy) / Ry, c = off(z, Dz) / Rz;
      return a * a + b * b + c * c <= 1 + 1e-9;
    });
  }

  const SHAPES = {
    sphere: {
      name: 'Sphere',
      params: [['r', 'Radius', 1, 30, 6], ['centre', 'Centre'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 6, 1]],
      make(p) {
        const r = clampI(p.r, 1, 30, 6), M = ellipsoidMask(r, r, r, p.centre);
        if (p.hollow) shell(M, clampI(p.thick, 1, 6, 1));
        return toSchem(tidy(M), 'Sphere r' + r, () => B(p));
      },
    },
    ellipsoid: {
      name: 'Ellipsoid',
      params: [['rx', 'Radius X', 1, 30, 8], ['ry', 'Radius Y', 1, 30, 5], ['rz', 'Radius Z', 1, 30, 6], ['centre', 'Centre'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 6, 1]],
      make(p) {
        const rx = clampI(p.rx, 1, 30, 8), ry = clampI(p.ry, 1, 30, 5), rz = clampI(p.rz, 1, 30, 6);
        const M = ellipsoidMask(rx, ry, rz, p.centre);
        if (p.hollow) shell(M, clampI(p.thick, 1, 6, 1));
        return toSchem(tidy(M), 'Ellipsoid ' + rx + 'x' + ry + 'x' + rz, () => B(p));
      },
    },
    circle: {
      name: 'Circle',
      params: [['r', 'Radius', 1, 48, 8], ['centre', 'Centre'], ['ring', 'Ring'], ['thick', 'Ring width', 1, 12, 1], ['h', 'Height', 1, 16, 1]],
      make(p) {
        const r = clampI(p.r, 1, 48, 8), D = diam(r, p.centre), R = D / 2, hh = clampI(p.h, 1, 16, 1);
        const M = fill(mask(D, hh, D), (x, y, z) => { const a = off(x, D), c = off(z, D); return a * a + c * c <= R * R + 1e-9; });
        if (p.ring) shell(M, clampI(p.thick, 1, 12, 1), 'xz');
        return toSchem(tidy(M), (p.ring ? 'Ring r' : 'Disc r') + r, () => B(p));
      },
    },
    dome: {
      name: 'Dome',
      params: [['r', 'Radius', 2, 30, 8], ['centre', 'Centre'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 6, 1], ['floor', 'Floor']],
      make(p) {
        const r = clampI(p.r, 2, 30, 8), D = diam(r, p.centre), R = D / 2, H = Math.ceil(D / 2);
        // the upper half of the sphere: layer y = 0 is the sphere's middle layer (or the lower of the two middle layers)
        const y0 = D - H;
        const M = fill(mask(D, H, D), (x, y, z) => { const a = off(x, D), b = off(y + y0, D), c = off(z, D); return a * a + b * b + c * c <= R * R + 1e-9; });
        if (p.hollow) shell(M, clampI(p.thick, 1, 6, 1), 'xyz', { bottom: true });
        if (p.floor) for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) {
          const a = off(x, D), c = off(z, D);
          if (a * a + c * c <= R * R + 1e-9) M.m[M.i(x, 0, z)] = 2;
        }
        return toSchem(tidy(M), 'Dome r' + r, (x, y, z) => (M.m[M.i(x, y, z)] === 2 ? B2(p) : B(p)));
      },
    },
    cylinder: {
      name: 'Cylinder',
      params: [['r', 'Radius', 1, 40, 5], ['h', 'Height', 1, 64, 10], ['centre', 'Centre'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 8, 1], ['caps', 'Caps']],
      make(p) {
        const r = clampI(p.r, 1, 40, 5), hh = clampI(p.h, 1, 64, 10), D = diam(r, p.centre), R = D / 2;
        const M = fill(mask(D, hh, D), (x, y, z) => { const a = off(x, D), c = off(z, D); return a * a + c * c <= R * R + 1e-9; });
        if (p.hollow) {
          const disc = M.m.slice();
          shell(M, clampI(p.thick, 1, 8, 1), 'xz');
          if (p.caps) for (const y of [0, hh - 1]) for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) { const i = M.i(x, y, z); if (disc[i] && !M.m[i]) M.m[i] = 2; }
        }
        return toSchem(tidy(M), 'Cylinder r' + r + ' h' + hh, (x, y, z) => (M.m[M.i(x, y, z)] === 2 ? B2(p) : B(p)));
      },
    },
    cone: {
      name: 'Cone',
      params: [['r', 'Base radius', 1, 32, 6], ['h', 'Height', 2, 64, 12], ['centre', 'Centre'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 6, 1], ['caps', 'Base']],
      make(p) {
        const r = clampI(p.r, 1, 32, 6), hh = clampI(p.h, 2, 64, 12), D = diam(r, p.centre), R = D / 2;
        const M = fill(mask(D, hh, D), (x, y, z) => {
          const rr = R * (1 - y / hh);       // radius at the bottom of this layer, so the top layer still has a tip
          const a = off(x, D), c = off(z, D);
          return a * a + c * c <= rr * rr + 1e-9 || (y === hh - 1 && Math.abs(a) < 1 && Math.abs(c) < 1);
        });
        if (p.hollow) shell(M, clampI(p.thick, 1, 6, 1), 'xyz', { bottom: !p.caps });
        return toSchem(tidy(M), 'Cone r' + r + ' h' + hh, () => B(p));
      },
    },
    pyramid: {
      name: 'Pyramid',
      params: [['n', 'Base width', 2, 63, 11], ['step', 'Step in', 1, 3, 1], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 6, 1]],
      make(p) {
        const n = clampI(p.n, 2, 63, 11), st = clampI(p.step, 1, 3, 1), hh = Math.ceil(n / (2 * st));
        const M = fill(mask(n, hh, n), (x, y, z) => { const lo = y * st, hi = n - 1 - y * st; return x >= lo && x <= hi && z >= lo && z <= hi; });
        if (p.hollow) shell(M, clampI(p.thick, 1, 6, 1));
        return toSchem(M, 'Pyramid ' + n, () => B(p));
      },
    },
    torus: {
      name: 'Torus',
      params: [['R', 'Ring radius', 2, 40, 8], ['r', 'Tube radius', 1, 12, 3], ['axis', 'Axis'], ['hollow', 'Hollow'], ['thick', 'Wall', 1, 4, 1]],
      make(p) {
        const Rr = clampI(p.R, 2, 40, 8), tr = Math.min(clampI(p.r, 1, 12, 3), Rr), D = 2 * (Rr + tr) + 1, T = 2 * tr + 1;
        const tube = tr + 0.5;
        // build lying flat (ring in x/z), then turn it when the axis is x or z
        const M = fill(mask(D, T, D), (x, y, z) => {
          const a = off(x, D), b = off(y, T), c = off(z, D);
          const q = Math.hypot(a, c) - Rr;
          return q * q + b * b <= tube * tube + 1e-9;
        });
        if (p.hollow) shell(M, clampI(p.thick, 1, 4, 1));
        tidy(M);
        const flat = toSchem(M, 'Torus ' + Rr + '/' + tr, () => B(p));
        if (p.axis === 'x' || p.axis === 'z') return rotateUp(flat, p.axis);
        return flat;
      },
    },
    tree: {
      name: 'Tree',
      params: [['preset', 'Kind'], ['h', 'Trunk height', 3, 24, 8], ['tw', 'Trunk width', 1, 2, 1], ['branches', 'Branches', 0, 8, 3], ['leaf', 'Leaf radius', 1, 6, 3], ['seed', 'Seed']],
      make(p) { return makeTree(p); },
    },
  };

  /** Stand a flat schematic up: its y axis becomes x (axis 'x') or z (axis 'z'). */
  function rotateUp(s, axis) {
    const [sx, sy, sz] = s.size;
    const core = C();
    if (axis === 'z') {   // (x, y, z) -> (x, z, y): the ring stands in the x/y plane, its axis along z
      const o = core.create(sx, sz, sy, s.name); o.palette = s.palette.slice();
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) o.blocks[(z * sy + y) * sx + x] = s.blocks[(y * sz + z) * sx + x];
      return o;
    }
    const o = core.create(sy, sx, sz, s.name); o.palette = s.palette.slice();   // (x, y, z) -> (y, x, z): axis along x
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) o.blocks[(x * sz + z) * sy + y] = s.blocks[(y * sz + z) * sx + x];
    return o;
  }

  /* ---- trees: seeded, so the same seed always grows the same tree ---- */
  const TREE_PRESETS = {
    oak: { name: 'Oak', log: 'minecraft:oak_log', leaves: 'minecraft:oak_leaves' },
    spruce: { name: 'Spruce', log: 'minecraft:spruce_log', leaves: 'minecraft:spruce_leaves' },
    birch: { name: 'Birch', log: 'minecraft:birch_log', leaves: 'minecraft:birch_leaves' },
  };
  function makeTree(p) {
    const kind = TREE_PRESETS[p.preset] ? p.preset : 'oak';
    const H = clampI(p.h, 3, 24, kind === 'spruce' ? 12 : 7), tw = clampI(p.tw, 1, 2, 1), nb = clampI(p.branches, 0, 8, 3), L = clampI(p.leaf, 1, 6, 3);
    const rand = rng(clampI(p.seed, 0, 2147483647, 1) * 7919 + H * 31 + nb * 977 + L);
    const log = p.block || TREE_PRESETS[kind].log, leaves = p.block2 || TREE_PRESETS[kind].leaves;
    const pad = L + 6, W = tw + 2 * pad, top = H + L + 4, M = new Map();
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const setLog = (x, y, z, axis) => { if (x >= 0 && z >= 0 && x < W && z < W && y >= 0 && y < top) M.set(key(x, y, z), { log: true, axis: axis || 'y' }); };
    const setLeaf = (x, y, z) => { if (x >= 0 && z >= 0 && x < W && z < W && y >= 0 && y < top && !M.has(key(x, y, z))) M.set(key(x, y, z), { log: false }); };
    const c0 = pad;   // trunk min corner x / z
    for (let y = 0; y < H; y++) for (let dx = 0; dx < tw; dx++) for (let dz = 0; dz < tw; dz++) setLog(c0 + dx, y, c0 + dz);
    const cx = c0 + (tw - 1) / 2, cz = c0 + (tw - 1) / 2;
    const blob = (bx, by, bz, rx, ry, rz, ragged) => {
      for (let y = Math.floor(by - ry); y <= Math.ceil(by + ry); y++) for (let z = Math.floor(bz - rz); z <= Math.ceil(bz + rz); z++) for (let x = Math.floor(bx - rx); x <= Math.ceil(bx + rx); x++) {
        const a = (x - bx) / (rx + 0.5), b = (y - by) / (ry + 0.5), c = (z - bz) / (rz + 0.5), d = a * a + b * b + c * c;
        if (d > 1) continue;
        if (ragged && d > 0.55 && rand() < 0.35) continue;   // ragged edge, never inside
        setLeaf(x, y, z);
      }
    };
    const ends = [];
    if (kind === 'spruce') {
      // stacked rings that grow and shrink like a real spruce: widest low, a single tip on top
      const crownBase = Math.max(1, Math.round(H * 0.3));
      let ring = 0;
      for (let y = H; y >= crownBase; y--) {
        const frac = (H - y) / Math.max(1, H - crownBase), want = Math.max(0, Math.round(L * frac));
        ring = ring >= want ? Math.max(0, want - 1) : want;
        for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
          if (Math.abs(x) + Math.abs(z) > ring + (ring > 1 ? 1 : 0)) continue;
          for (let dx = 0; dx < tw; dx++) for (let dz = 0; dz < tw; dz++) setLeaf(c0 + dx + x, y, c0 + dz + z);
        }
      }
      for (let dx = 0; dx < tw; dx++) for (let dz = 0; dz < tw; dz++) { setLeaf(c0 + dx, H, c0 + dz); setLeaf(c0 + dx, H + 1, c0 + dz); }
      // a few short side branches poke out of the rings
      for (let i = 0; i < nb; i++) {
        const y = crownBase + Math.floor(rand() * Math.max(1, H - crownBase - 2)), dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rand() * 4)];
        const len = 1 + Math.floor(rand() * Math.max(1, L - 1));
        for (let k = 1; k <= len; k++) setLog(Math.round(cx + dir[0] * (k + (tw - 1) / 2)), y, Math.round(cz + dir[1] * (k + (tw - 1) / 2)), dir[0] ? 'x' : 'z');
      }
    } else {
      const birch = kind === 'birch';
      for (let i = 0; i < nb; i++) {
        const ang = (i / Math.max(1, nb)) * Math.PI * 2 + rand() * 1.2;
        let x = cx, z = cz, y = Math.floor(H * (birch ? 0.65 : 0.58) + rand() * H * (birch ? 0.25 : 0.3));
        const len = birch ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * Math.max(1, L));
        const dx = Math.cos(ang), dz = Math.sin(ang);
        x += dx * (tw / 2); z += dz * (tw / 2);
        for (let k = 0; k < len; k++) {
          x += dx; z += dz;
          if (k % 2 === 1 || rand() < 0.35) y += 1;
          setLog(Math.round(x), Math.min(y, H + 1), Math.round(z), Math.abs(dx) > Math.abs(dz) ? 'x' : 'z');
        }
        ends.push([Math.round(x), Math.min(y, H + 1), Math.round(z)]);
      }
      const r = birch ? Math.max(1, L - 1) : L;
      blob(cx, birch ? H - 0.5 : H + 0.5, cz, r + (tw - 1) / 2, birch ? r + 1 : Math.max(1.5, r - 0.5), r + (tw - 1) / 2, true);
      ends.forEach(([x, y, z]) => blob(x, y + 0.5, z, Math.max(1, r - 1), Math.max(1, r - 1.5), Math.max(1, r - 1), true));
      // the trunk top is always capped
      for (let dx = 0; dx < tw; dx++) for (let dz = 0; dz < tw; dz++) setLeaf(c0 + dx, H, c0 + dz);
    }
    const s = C().create(W, top, W, TREE_PRESETS[kind].name + ' tree');
    const leafId = leaves.includes('[') ? leaves : leaves + '[persistent=true]';
    M.forEach((v, k) => {
      const [x, y, z] = k.split(',').map(Number);
      C().set(s, x, y, z, v.log ? (v.axis !== 'y' ? log + '[axis=' + v.axis + ']' : log) : leafId);
    });
    // no lonely leaves: drop a leaf with no neighbour at all
    const [sx, sy, sz] = s.size;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const i = C().idx(s, x, y, z);
      if (!s.blocks[i] || !String(s.palette[s.blocks[i]]).includes('leaves')) continue;
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => C().inside(s, x + a, y + b, z + c) && s.blocks[C().idx(s, x + a, y + b, z + c)]);
      if (!n) s.blocks[i] = 0;
    }
    return C().trim(s);
  }

  /** Default parameters of every shape (UI state starts from these). */
  function defaults() {
    const o = {};
    Object.entries(SHAPES).forEach(([k, sh]) => {
      const p = {};
      sh.params.forEach(([id, , lo, hi, d]) => { if (d != null) p[id] = d; });
      p.centre = 'block'; p.hollow = k === 'sphere' || k === 'dome'; p.thick = 1;
      if (k === 'circle') p.ring = false;
      if (k === 'cylinder') { p.hollow = true; p.caps = false; }
      if (k === 'cone') p.caps = true;
      if (k === 'torus') p.axis = 'y';
      if (k === 'dome') p.floor = false;
      if (k === 'tree') { p.preset = 'oak'; p.seed = 1; }
      o[k] = p;
    });
    return o;
  }

  function make(kind, params) {
    const sh = SHAPES[kind] || SHAPES.sphere;
    return sh.make(params || {});
  }

  TH.builds.shapes = { SHAPES, TREE_PRESETS, make, defaults, rng, rotateUp };
})();
