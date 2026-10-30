/**
 * Builds generators (pure, no DOM): crystals, monoliths, nature and more shapes, built from distance fields.
 *
 *   FAMILIES          [{ id, group, name, tip, params, variants, make }]; GROUPS (Crystals, Monoliths, Nature, Shapes)
 *   PALETTES          block palettes: a ramp per part (body, base, trim, accent), glow, glass edge, worn / moss / crack
 *   defaults(id)      every parameter's default; gen(id, p) -> Schematic (cropped); params(id) the full parameter list
 *
 * How a generator works: make(p, rnd) returns primitives { f(x, y, z) (negative inside, about a distance in blocks),
 * box [x0, y0, z0, x1, y1, z1] (model space: y up from the ground, x / z around 0), part, grad(x, y, z) (0 dark .. 1
 * light along the part), edge(x, y, z), rough } and optional tips (points of spires) and fluids. The common pipeline then
 *   1. turns the model by the angle (X / Y / Z, any degree, order Y X Z) by looking back from every world cell,
 *   2. rasterises each primitive over its own box (min distance wins), noise added for roughness,
 *   3. samples 64 sub-points on surface cells and lets the detail toolkit pick slabs, stairs, trapdoors and walls
 *      (Detail level; Low = full blocks only),
 *   4. hollows to the wall thickness, paints parts from the palette ramps with ordered dithering, adds weathering,
 *      moss and vines, cracks, glow (edges, veins, core, rings, runes, speckles) and its decorations,
 *   5. puts sharp tips on spires (tip style), shades from the light direction (optional, colour too), caps open tops
 *      with slabs (spawn-proof), derives pane / wall connections and crops.
 * Everything random comes from the seed: the same parameters always give the same build.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const DT = () => TH.builds.detail;
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ======================================================================
   * Random numbers and noise
   * ====================================================================== */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash(x, y, z, seed) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 144269)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    const s = (t) => t * t * (3 - 2 * t), tx = s(fx), ty = s(fy), tz = s(fz);
    const c = (a, b, d) => hash(ix + a, iy + b, iz + d, seed);
    return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 1, 0), c(1, 1, 0), tx), ty), lerp(lerp(c(0, 0, 1), c(1, 0, 1), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), ty), tz);
  }
  const fbm = (x, y, z, seed) => (vnoise(x, y, z, seed) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1, seed + 7) * 0.28 + vnoise(x * 4.3, y * 4.3, z * 4.3, seed + 13) * 0.12);
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
  const bayer = (x, y, z) => BAYER4[((y + z) & 3) * 4 + ((x + z * 2) & 3)];

  /* ======================================================================
   * Vectors, orientation of a primitive
   * ====================================================================== */
  const mat = (o) => TH.builds.rotate.matrix(o);
  const app = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
  const appT = (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];
  /** A local primitive placed at o (model coords), turned by R (local -> model). box = local box. */
  function place(prim, o, R) {
    const f = prim.f, g = prim.grad, e = prim.edge, pa = prim.partAt;
    const loc = (x, y, z) => appT(R, [x - o[0], y - o[1], z - o[2]]);
    const b = prim.box;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
      const q = app(R, [x, y, z]);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a] + o[a]); hi[a] = Math.max(hi[a], q[a] + o[a]); }
    }
    return Object.assign({}, prim, {
      box: [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]],
      f: (x, y, z) => { const q = loc(x, y, z); return f(q[0], q[1], q[2]); },
      grad: g ? (x, y, z) => { const q = loc(x, y, z); return g(q[0], q[1], q[2]); } : null,
      edge: e ? (x, y, z) => { const q = loc(x, y, z); return e(q[0], q[1], q[2]); } : null,
      partAt: pa ? (x, y, z) => { const q = loc(x, y, z); return pa(q[0], q[1], q[2]); } : null,
      axis: prim.axis ? app(R, prim.axis) : null,
    });
  }
  /**
   * Tilt by `lean` degrees toward compass azimuth `az` (0 north, 90 east), without turning the object about its own
   * axis: X tilts +y toward +z (south), so it is wrapped in a yaw of 180 + az and back.
   */
  function leanMat(lean, az) {
    if (!lean) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const d = 180 + (az || 0), a = mat({ y: d }), b = mat({ x: lean }), c = mat({ y: -d });
    const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    return mm(c, mm(b, a));
  }
  const tipAt = (o, R, p, dir) => ({ p: [o[0] + app(R, p)[0], o[1] + app(R, p)[1], o[2] + app(R, p)[2]], dir: app(R, dir || [0, 1, 0]) });

  /* ======================================================================
   * Distance fields
   * ====================================================================== */
  /** Regular n-gon (circumradius 1, a corner on +x when rot = 0) distance in units of the apothem: <= 0 inside. */
  function ngon(n, x, z, rot) {
    const a = Math.atan2(z, x) - (rot || 0), seg = (2 * Math.PI) / n;
    const fa = (Math.floor(a / seg) + 0.5) * seg;   // the facet this direction falls on (its normal)
    const r = Math.hypot(x, z), ap = Math.cos(Math.PI / n);
    return r * Math.cos(a - fa) - ap;   // (distance along the facet normal) - apothem, at circumradius 1
  }
  /** Angle from the nearest corner of an n-gon (0 at a corner, pi / n mid-facet). */
  function cornerAngle(n, x, z, rot) {
    const seg = (2 * Math.PI) / n, a = ((Math.atan2(z, x) - (rot || 0)) % seg + seg) % seg;
    return Math.min(a, seg - a);
  }
  const box2 = (x, z, hx, hz) => Math.max(Math.abs(x) - hx, Math.abs(z) - hz);
  /** Super-ellipse (power k) distance-ish in blocks for half sizes hx, hz. */
  function superE(x, z, hx, hz, k) {
    const u = Math.abs(x) / Math.max(0.5, hx), v = Math.abs(z) / Math.max(0.5, hz);
    return (Math.pow(Math.pow(u, k) + Math.pow(v, k), 1 / k) - 1) * Math.min(hx, hz);
  }

  /**
   * A faceted crystal along +y from 0 to h: n facets, radii rx / rz, taper, bulge, twist (degrees over the height),
   * tip (share of the height), sharp (tip curve), flare (wider base), chamfer (cut corners), bottom tip (double).
   */
  function crystal(o) {
    const n = o.n || 6, h = Math.max(2, o.h), rx = Math.max(0.5, o.rx), rz = Math.max(0.5, o.rz || o.rx), sq = rx / rz;
    const tip = clamp(o.tip == null ? 0.25 : o.tip, 0.04, 0.9), sharp = o.sharp || 1, twist = (o.twist || 0) * RAD;
    const bt = o.double ? clamp(o.btip == null ? tip * 0.7 : o.btip, 0.04, 0.6) : 0;
    const y0 = bt * h, y1 = h * (1 - tip);
    const R = (y) => {
      let r = 1;
      if (y < y0) r = Math.pow(Math.max(0, y / y0), 1 / sharp);
      else if (y > y1) r = Math.pow(Math.max(0, (h - y) / (h - y1)), 1 / sharp);
      const yb = (y - y0) / Math.max(1, y1 - y0);
      const body = 1 - (o.taper || 0) * clamp(yb, 0, 1) + (o.bulge || 0) * Math.sin(Math.PI * clamp(yb, 0, 1)) + (o.flare || 0) * Math.max(0, 1 - y / Math.max(2, h * 0.12)) * 0.8;
      return r * Math.max(0.05, body);
    };
    const ch = o.chamfer || 0;
    const f = (x, y, z) => {
      if (y < 0 || y > h) return Math.max(-y, y - h) + 0.01;
      const r = R(y) * rx;
      if (r < 1e-3) return 1;
      const a = twist * (y / h), c = Math.cos(a), s = Math.sin(a);
      const X = (x * c + z * s * sq), Z = (-x * s + z * c * sq);
      let d = ngon(n, X / r, Z / r, o.rot || 0);
      if (ch) d = Math.max(d, ngon(n, X / r, Z / r, (o.rot || 0) + Math.PI / n) - ch * 0.12);
      return d * r;
    };
    const edge = (x, y, z) => {
      const r = R(y) * rx; if (r < 1.2) return true;
      const a = twist * (y / h), c = Math.cos(a), s = Math.sin(a);
      return cornerAngle(n, x * c + z * s * sq, -x * s + z * c * sq, o.rot || 0) * r < 0.9;
    };
    const mr = Math.max(rx, rz) * (1 + Math.max(0, o.bulge || 0) + (o.flare || 0)) + 1;
    return { f, edge, grad: (x, y) => clamp(y / h, 0, 1), box: [-mr, 0, -mr, mr, h, mr], axis: [0, 1, 0] };
  }
  /** A rectangular block 0..h: half sizes hx, hz, taper, waist / bulge, twist, chamfer, pyramidion (tip share). */
  function slab(o) {
    const h = Math.max(1, o.h), hx = Math.max(0.5, o.hx), hz = Math.max(0.5, o.hz), tip = o.tip || 0, twist = (o.twist || 0) * RAD, ch = o.chamfer || 0;
    const yb = h * (1 - tip), k = o.round || 0;
    const sc = (y) => {
      let s = 1 - (o.taper || 0) * clamp(y / yb, 0, 1) + (o.bulge || 0) * Math.sin(Math.PI * clamp(y / yb, 0, 1));
      if (y > yb) s *= Math.max(0, (h - y) / Math.max(0.5, h - yb));
      return Math.max(0.02, s);
    };
    const f = (x, y, z) => {
      if (y < 0 || y > h) return Math.max(-y, y - h) + 0.01;
      const s = sc(y), a = twist * (y / h), c = Math.cos(a), sn = Math.sin(a);
      const X = x * c + z * sn, Z = -x * sn + z * c, ax = hx * s, az = hz * s;
      let d = k ? superE(X, Z, ax, az, 2 + 6 * (1 - k)) : box2(X, Z, ax, az);
      if (ch) d = Math.max(d, (Math.abs(X) + Math.abs(Z) - (ax + az) + ch * Math.min(ax, az) * 1.2) * 0.7071);
      return d;
    };
    const edge = (x, y, z) => { const s = sc(y); return Math.abs(Math.abs(x) - hx * s) < 0.9 && Math.abs(Math.abs(z) - hz * s) < 0.9; };
    const m = Math.max(hx, hz) * (1 + Math.max(0, o.bulge || 0)) * 1.42 + 1;
    return { f, edge, grad: (x, y) => clamp(y / h, 0, 1), box: [-m, 0, -m, m, h, m], axis: [0, 1, 0] };
  }
  function ellipsoid(o) {
    const rx = Math.max(0.5, o.rx), ry = Math.max(0.5, o.ry), rz = Math.max(0.5, o.rz), m = Math.min(rx, ry, rz);
    const f = (x, y, z) => (Math.hypot(x / rx, y / ry, z / rz) - 1) * m;
    return { f, grad: (x, y) => clamp(0.5 + y / (2 * ry), 0, 1), box: [-rx - 1, -ry - 1, -rz - 1, rx + 1, ry + 1, rz + 1] };
  }
  /** Convex jagged polytope: k planes around an ellipsoid (radii a, b, c), each cut in by up to `jag`. */
  function jagged(o, rnd) {
    const planes = [];
    const k = o.k || 14, jag = o.jag == null ? 0.25 : o.jag, [a, b, c] = o.r;
    for (let i = 0; i < k; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const nrm = [s * Math.cos(th), u, s * Math.sin(th)];
      const sup = Math.hypot(nrm[0] * a, nrm[1] * b, nrm[2] * c);
      planes.push([nrm, sup * (1 - jag * rnd())]);
    }
    // the two ends: steep planes that make points along y
    for (const sg of [1, -1]) for (let i = 0; i < 4; i++) {
      const th = (i / 4) * Math.PI * 2 + rnd() * 0.8, tilt = 0.25 + rnd() * 0.25, nrm = [Math.cos(th) * (1 - tilt), sg * tilt * 2.2, Math.sin(th) * (1 - tilt)], l = Math.hypot(...nrm);
      const nn = nrm.map((v) => v / l), sup = Math.hypot(nn[0] * a, nn[1] * b, nn[2] * c);
      planes.push([nn, sup * (0.82 + 0.12 * rnd())]);
    }
    const f = (x, y, z) => { let d = -Infinity; for (const [n, dd] of planes) { const v = n[0] * x + n[1] * y + n[2] * z - dd; if (v > d) d = v; } return d; };
    const edge = (x, y, z) => { let a1 = -Infinity, a2 = -Infinity; for (const [n, dd] of planes) { const v = n[0] * x + n[1] * y + n[2] * z - dd; if (v > a1) { a2 = a1; a1 = v; } else if (v > a2) a2 = v; } return a1 - a2 < 0.55; };
    return { f, edge, grad: (x, y) => clamp(0.5 + y / (2 * b), 0, 1), box: [-a - 1, -b - 1, -c - 1, a + 1, b + 1, c + 1] };
  }
  const union = (...fs) => (x, y, z) => { let d = Infinity; for (const f of fs) { const v = f(x, y, z); if (v < d) d = v; } return d; };

  /* ======================================================================
   * Palettes
   * ====================================================================== */
  const m = (n) => 'minecraft:' + n;
  const PALETTES = {
    // crystals
    amethyst: { name: 'Amethyst', body: ['purple_concrete', 'amethyst_block', 'budding_amethyst', 'purpur_block'], base: ['smooth_basalt', 'calcite'], trim: ['calcite'], accent: ['purple_stained_glass'], edge: 'purple_stained_glass', glow: 'amethyst', worn: ['tuff'], partial: { stairs: 'purpur_stairs', slab: 'purpur_slab', wall: 'end_stone_brick_wall', pane: 'purple_stained_glass_pane' }, tip: 'crystal' },
    diamond: { name: 'Diamond', body: ['prismarine', 'diamond_block', 'packed_ice', 'ice'], base: ['dark_prismarine', 'prismarine_bricks'], trim: ['sea_lantern'], accent: ['light_blue_stained_glass'], edge: 'light_blue_stained_glass', glow: 'sea_lantern', worn: ['prismarine'], partial: { stairs: 'prismarine_stairs', slab: 'prismarine_slab', wall: 'prismarine_wall', pane: 'light_blue_stained_glass_pane' }, tip: 'needle' },
    emerald: { name: 'Emerald', body: ['green_concrete', 'emerald_block', 'lime_concrete', 'lime_stained_glass'], base: ['moss_block', 'mossy_cobblestone'], trim: ['lime_terracotta'], accent: ['lime_stained_glass'], edge: 'lime_stained_glass', glow: 'verdant', worn: ['green_terracotta'], partial: { stairs: 'mossy_cobblestone_stairs', slab: 'mossy_cobblestone_slab', wall: 'mossy_cobblestone_wall', pane: 'lime_stained_glass_pane' }, tip: 'crystal' },
    ruby: { name: 'Ruby', body: ['crying_obsidian', 'red_nether_bricks', 'redstone_block', 'red_stained_glass'], base: ['blackstone', 'magma_block'], trim: ['nether_bricks'], accent: ['red_stained_glass'], edge: 'red_stained_glass', glow: 'magma', worn: ['netherrack'], partial: { stairs: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', wall: 'red_nether_brick_wall', pane: 'red_stained_glass_pane' }, tip: 'needle' },
    quartz: { name: 'Quartz', body: ['diorite', 'quartz_bricks', 'quartz_block', 'white_stained_glass'], base: ['polished_diorite', 'calcite'], trim: ['chiseled_quartz_block'], accent: ['white_stained_glass'], edge: 'white_stained_glass', glow: 'froglight', worn: ['diorite'], partial: { stairs: 'quartz_stairs', slab: 'quartz_slab', wall: 'diorite_wall', pane: 'white_stained_glass_pane' }, tip: 'needle' },
    end: { name: 'End crystal', body: ['purpur_pillar', 'purpur_block', 'magenta_stained_glass', 'end_stone_bricks'], base: ['end_stone', 'end_stone_bricks'], trim: ['purpur_pillar'], accent: ['magenta_stained_glass'], edge: 'magenta_stained_glass', glow: 'end_rod', worn: ['end_stone'], partial: { stairs: 'purpur_stairs', slab: 'purpur_slab', wall: 'end_stone_brick_wall', pane: 'magenta_stained_glass_pane' }, tip: 'needle' },
    // stone styles (monoliths, nature)
    deepslate: { name: 'Deepslate', body: ['deepslate_tiles', 'polished_deepslate', 'deepslate_bricks', 'cobbled_deepslate'], base: ['cobbled_deepslate', 'deepslate'], trim: ['chiseled_deepslate'], accent: ['deepslate_tiles'], edge: 'tinted_glass', glow: 'sea_lantern', worn: ['cracked_deepslate_bricks', 'cobbled_deepslate'], crack: 'cracked_deepslate_tiles', moss: 'moss_block' },
    blackstone: { name: 'Blackstone', body: ['blackstone', 'polished_blackstone', 'polished_blackstone_bricks', 'gilded_blackstone'], base: ['blackstone'], trim: ['chiseled_polished_blackstone'], accent: ['gilded_blackstone'], edge: 'tinted_glass', glow: 'shroomlight', worn: ['cracked_polished_blackstone_bricks'], crack: 'cracked_polished_blackstone_bricks', moss: 'moss_block' },
    basalt: { name: 'Basalt', body: ['basalt', 'polished_basalt', 'smooth_basalt'], base: ['smooth_basalt', 'blackstone'], trim: ['polished_basalt'], accent: ['magma_block'], edge: 'tinted_glass', glow: 'magma', worn: ['blackstone'], crack: 'magma_block', moss: 'moss_block' },
    tuff: { name: 'Tuff', body: ['tuff', 'polished_tuff', 'tuff_bricks', 'chiseled_tuff_bricks'], base: ['tuff'], trim: ['chiseled_tuff'], accent: ['chiseled_tuff_bricks'], edge: 'glass', glow: 'copper_bulb', worn: ['tuff', 'cobblestone'], crack: 'cobblestone', moss: 'moss_block' },
    stone: { name: 'Stone', body: ['andesite', 'stone', 'stone_bricks', 'polished_andesite'], base: ['cobblestone', 'stone'], trim: ['chiseled_stone_bricks'], accent: ['mossy_stone_bricks'], edge: 'glass', glow: 'glowstone', worn: ['cobblestone', 'mossy_cobblestone'], crack: 'cracked_stone_bricks', moss: 'moss_block' },
    obsidian: { name: 'Obsidian', body: ['obsidian', 'crying_obsidian', 'obsidian'], base: ['blackstone', 'obsidian'], trim: ['crying_obsidian'], accent: ['crying_obsidian'], edge: 'tinted_glass', glow: 'crying', worn: ['blackstone'], crack: 'crying_obsidian', moss: 'moss_block' },
    copper: { name: 'Oxidised copper', body: ['oxidized_copper', 'weathered_copper', 'oxidized_cut_copper', 'exposed_copper'], base: ['copper_block', 'cut_copper'], trim: ['oxidized_chiseled_copper'], accent: ['copper_grate'], edge: 'glass', glow: 'copper_bulb', worn: ['weathered_cut_copper'], crack: 'oxidized_copper_grate', moss: 'moss_block' },
    endstone: { name: 'End stone', body: ['end_stone', 'end_stone_bricks', 'purpur_block', 'purpur_pillar'], base: ['end_stone'], trim: ['purpur_pillar'], accent: ['purpur_block'], edge: 'magenta_stained_glass', glow: 'end_rod', worn: ['end_stone'], crack: 'end_stone', moss: 'moss_block' },
    prismarine: { name: 'Prismarine', body: ['dark_prismarine', 'prismarine', 'prismarine_bricks'], base: ['dark_prismarine'], trim: ['prismarine_bricks'], accent: ['sea_lantern'], edge: 'cyan_stained_glass', glow: 'sea_lantern', worn: ['prismarine'], crack: 'prismarine', moss: 'moss_block' },
    sandstone: { name: 'Sandstone', body: ['cut_sandstone', 'sandstone', 'smooth_sandstone', 'chiseled_sandstone'], base: ['sandstone', 'cut_sandstone'], trim: ['chiseled_sandstone'], accent: ['gold_block'], edge: 'yellow_stained_glass', glow: 'shroomlight', worn: ['sand', 'sandstone'], crack: 'smooth_sandstone', moss: 'moss_block' },
    terracotta: { name: 'Terracotta', body: ['brown_terracotta', 'red_terracotta', 'orange_terracotta', 'terracotta', 'yellow_terracotta', 'white_terracotta'], base: ['brown_terracotta'], trim: ['white_terracotta'], accent: ['light_blue_terracotta'], edge: 'orange_stained_glass', glow: 'ochre', worn: ['terracotta'], crack: 'red_sand', moss: 'moss_block' },
    quartzstone: { name: 'Quartz', body: ['quartz_block', 'smooth_quartz', 'quartz_bricks', 'chiseled_quartz_block'], base: ['quartz_block'], trim: ['chiseled_quartz_block'], accent: ['gold_block'], edge: 'white_stained_glass', glow: 'froglight', worn: ['diorite'], crack: 'calcite', moss: 'moss_block' },
    // nature
    rockstone: { name: 'Fieldstone', body: ['tuff', 'andesite', 'cobblestone', 'stone'], base: ['cobblestone', 'gravel'], trim: ['mossy_cobblestone'], accent: ['andesite'], edge: 'glass', glow: 'glowstone', worn: ['mossy_cobblestone', 'cobblestone'], crack: 'gravel', moss: 'moss_block' },
    mountain: { name: 'Mountain', body: ['tuff', 'andesite', 'stone', 'cobblestone'], base: ['dirt', 'coarse_dirt'], skin: { base: 'grass_block[snowy=false]' }, trim: ['snow_block', 'powder_snow'], accent: ['gravel'], edge: 'packed_ice', glow: 'glowstone', worn: ['gravel'], crack: 'cobblestone', moss: 'moss_block' },
    volcano: { name: 'Volcano', body: ['blackstone', 'basalt', 'smooth_basalt', 'tuff'], base: ['blackstone', 'coarse_dirt'], trim: ['magma_block'], accent: ['magma_block'], edge: 'orange_stained_glass', glow: 'magma', worn: ['gravel'], crack: 'magma_block', moss: 'moss_block' },
    redcap: { name: 'Red cap', body: ['red_mushroom_block'], base: ['mushroom_stem'], trim: ['mushroom_stem'], accent: ['white_concrete'], edge: 'glass', glow: 'shroomlight', worn: ['red_terracotta'], moss: 'moss_block' },
    browncap: { name: 'Brown cap', body: ['brown_mushroom_block'], base: ['mushroom_stem'], trim: ['mushroom_stem'], accent: ['shroomlight'], edge: 'glass', glow: 'shroomlight', worn: ['brown_terracotta'], moss: 'moss_block' },
    glowcap: { name: 'Glow cap', body: ['warped_wart_block', 'cyan_terracotta'], base: ['warped_stem'], trim: ['warped_hyphae'], accent: ['shroomlight'], edge: 'cyan_stained_glass', glow: 'shroomlight', worn: ['warped_nylium'], moss: 'moss_block' },
    sandrock: { name: 'Sand rock', body: ['red_sandstone', 'orange_terracotta', 'smooth_red_sandstone', 'terracotta'], base: ['red_sand', 'coarse_dirt'], trim: ['white_terracotta'], accent: ['yellow_terracotta'], edge: 'orange_stained_glass', glow: 'ochre', worn: ['red_sand'], crack: 'red_sand', moss: 'moss_block' },
  };
  // the moss and the fluids are the same everywhere
  const FIXED = { moss: 'moss_block', water: 'water[level=0]', lava: 'lava[level=0]', snow: 'snow_block', grass: 'grass_block[snowy=false]' };
  const AXIS_BLOCK = /(_log|_wood|_stem|_hyphae|basalt|_pillar|^deepslate$|bamboo_block|hay_block|bone_block|froglight|muddy_mangrove_roots)$/;
  const full = (n) => { const id = n.startsWith('minecraft:') ? n : m(n); return AXIS_BLOCK.test(C().parse(id).name) && !C().parse(id).props.axis ? id + '[axis=y]' : id; };

  /* ======================================================================
   * Parameters
   * ====================================================================== */
  const num = (id, label, g, min, max, def, o) => Object.assign({ id, label, g, t: 'num', min, max, def, step: 1 }, o);
  const seg = (id, label, g, ch, def, o) => Object.assign({ id, label, g, t: 'seg', ch, def }, o);
  const bool = (id, label, g, def, o) => Object.assign({ id, label, g, t: 'bool', def: !!def }, o);
  const SURF = { rough: num('rough', 'Roughness', 'surface', 0, 100, 0, { unit: '%', tip: 'Noise on the surface: 0 = clean facets' }), weather: num('weather', 'Weathering', 'surface', 0, 100, 0, { unit: '%', tip: 'Worn blocks in patches' }), moss: num('moss', 'Moss', 'surface', 0, 100, 0, { unit: '%', tip: 'Moss on top, vines down the sides from 60%' }), cracks: num('cracks', 'Cracks', 'surface', 0, 100, 0, { unit: '%', tip: 'Cracked lines; deep cracks from 60%' }) };
  const GLOW_PATTERNS = [['none', 'None'], ['edges', 'Edges'], ['veins', 'Veins'], ['core', 'Core'], ['rings', 'Rings'], ['runes', 'Runes'], ['speckles', 'Speckles']];
  /** The parameters every generator shares (appended after its own). */
  function common(f) {
    const out = [];
    const sz = f.size || {};
    out.push(num('w', 'Width', 'size', sz.w ? sz.w[0] : 2, sz.w ? sz.w[1] : 128, sz.w ? sz.w[2] : 16, { dim: true }));
    if (!sz.noD) out.push(num('d', 'Depth', 'size', sz.d ? sz.d[0] : 2, sz.d ? sz.d[1] : 128, sz.d ? sz.d[2] : 16, { dim: true }));
    out.push(num('h', 'Height', 'size', sz.h ? sz.h[0] : 4, sz.h ? sz.h[1] : 256, sz.h ? sz.h[2] : 32, { dim: true }));
    out.push(num('scale', 'Scale', 'size', 25, 400, 100, { unit: '%', step: 5, tip: 'Scales every size at once' }));
    (f.surface || ['rough', 'weather', 'moss', 'cracks']).forEach((k) => out.push(SURF[k]));
    if (f.glow !== false) {
      out.push(seg('glow', 'Glow', 'glow', GLOW_PATTERNS, f.glowDef || 'none'));
      out.push(num('glowAmt', 'Intensity', 'glow', 0, 100, 50, { unit: '%' }));
      out.push(seg('glowBlock', 'Glow block', 'glow', Object.keys(DT().GLOW).map((k) => [k, DT().GLOW[k].name]), 'palette', { blocks: true }));
    }
    out.push(seg('detail', 'Detail', 'detail', [['low', 'Low', 'Full blocks only'], ['medium', 'Medium', 'Stairs and slabs'], ['high', 'High', 'Adds walls, trapdoors, panes, bars'], ['max', 'Max', 'Everything: snow layers, carpets, dripstone, end rods, amethyst']], 'medium'));
    out.push({ id: 'off', label: 'Parts to leave out', g: 'detail', t: 'kinds', def: [] });
    if (f.tip) {
      out.push(seg('tipStyle', 'Tip', 'detail', DT().TIP_STYLES.map(([k, l, t]) => [k, l, t]), 'palette'));
      out.push(num('tipLen', 'Tip parts', 'detail', 1, 4, 3));
    }
    if (f.hollow !== false) { out.push(bool('hollow', 'Hollow', 'detail', false)); out.push(num('thick', 'Wall', 'detail', 1, 8, 1, { when: (p) => p.hollow })); }
    out.push(bool('spawn', 'Spawn-proof tops', 'detail', false, { tip: 'A slab on every open top block outside, so mobs cannot spawn on it' }));
    out.push(num('ax', 'X', 'angle', -180, 180, 0, { step: 0.5, unit: '°', angle: true }));
    out.push(num('ay', 'Y', 'angle', -180, 180, 0, { step: 0.5, unit: '°', angle: true }));
    out.push(num('az', 'Z', 'angle', -180, 180, 0, { step: 0.5, unit: '°', angle: true }));
    out.push(seg('order', 'Order', 'angle', TH.builds.rotate.ORDERS.map((o) => [o, o.split('').join(' ')]), 'YXZ'));
    out.push(bool('light', 'Light', 'light', false, { tip: 'Shade the build from a light direction' }));
    out.push(num('lAz', 'Azimuth', 'light', 0, 360, 225, { unit: '°', step: 1 }));
    out.push(num('lEl', 'Elevation', 'light', -90, 90, 50, { unit: '°', step: 1 }));
    out.push(num('lCon', 'Contrast', 'light', 30, 250, 100, { unit: '%', step: 5 }));
    out.push(num('lSteps', 'Steps', 'light', 3, 9, 6));
    out.push(num('lDither', 'Dither', 'light', 0, 100, 60, { unit: '%' }));
    out.push(num('lAo', 'Occlusion', 'light', 0, 100, 40, { unit: '%' }));
    out.push(num('lRim', 'Rim light', 'light', 0, 100, 0, { unit: '%' }));
    out.push(bool('lShadow', 'Cast shadows', 'light', false));
    out.push(bool('lFollow', 'Light turns with the build', 'light', false));
    out.push(seg('lRamp', 'Ramp', 'light', [['palette', 'Palette']].concat(Object.keys(TH.builds.shade.RAMPS).map((k) => [k, TH.builds.shade.RAMP_LABEL[k]])), 'palette'));
    out.push({ id: 'lColour', label: 'Light colour', g: 'light', t: 'colour', def: [1, 1, 1] });
    out.push({ id: 'lShadowC', label: 'Shadow colour', g: 'light', t: 'colour', def: null, optional: true });
    out.push(num('lTint', 'Tint strength', 'light', 0, 100, 0, { unit: '%' }));
    out.push(num('lHue', 'Hue shift', 'light', 0, 100, 0, { unit: '%', tip: 'Shadows drift cooler, highlights warmer' }));
    out.push(seg('lPool', 'Blocks to pick from', 'light', TH.builds.shade.POOLS.filter((x) => x[0] !== 'custom'), 'all'));
    out.push(seg('pal', 'Palette', 'blocks', f.pals.map((k) => [k, PALETTES[k].name]), f.pals[0], { palette: true }));
    (f.parts || ['body']).forEach((pt) => out.push({ id: 'mat_' + pt, label: PART_LABEL[pt] || pt, g: 'blocks', t: 'block', def: null, part: pt }));
    if (f.seed) out.push({ id: 'seed', label: 'Seed', g: 'shape', t: 'seed', def: 1 });
    return out;
  }
  const PART_LABEL = { body: 'Body', base: 'Base', trim: 'Trim', accent: 'Accent', edge: 'Edges', glow: 'Glow' };
  const GROUP_LABEL = { shape: 'Shape', size: 'Size', surface: 'Surface', glow: 'Glow', detail: 'Detail', angle: 'Angle', light: 'Light', blocks: 'Blocks' };

  /* ======================================================================
   * Families
   * ====================================================================== */
  const FAMILIES = [];
  const fam = (o) => { FAMILIES.push(o); return o; };
  const FACETS = [[3, '3'], [4, '4'], [5, '5'], [6, '6'], [8, '8']];
  const CRYS = ['amethyst', 'diamond', 'emerald', 'ruby', 'quartz', 'end'];
  const STONES = ['deepslate', 'blackstone', 'basalt', 'tuff', 'stone', 'obsidian', 'copper', 'endstone', 'prismarine', 'sandstone', 'terracotta', 'quartzstone'];
  const OLD = ['rockstone'].concat(STONES, ['sandrock']);   // the prehistoric stones start as plain fieldstone
  const rx = (p) => p.w / 2, rz = (p) => (p.d || p.w) / 2;
  const sh = (id, label, min, max, def, o) => num(id, label, 'shape', min, max, def, o);
  const base = (p, prims) => { if (p.base === 'rock') prims.push(Object.assign(ellipsoid({ rx: rx(p) * 1.5 + 1, ry: Math.max(2, p.h * 0.06), rz: rz(p) * 1.5 + 1 }), { part: 'base', rough: 1 })); };

  // ---------------- crystals ----------------
  fam({
    id: 'crystal', group: 'crystals', name: 'Crystal', tip: true, pals: CRYS, parts: ['body', 'base', 'edge'], size: { w: [2, 96, 12], d: [2, 96, 12], h: [6, 256, 48] },
    params: [sh('facets', 'Facets', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('taper', 'Taper', 0, 90, 15, { unit: '%' }), sh('bulge', 'Bulge', -50, 50, 0, { unit: '%', tip: 'Below 0: a waist' }), sh('tip', 'Tip length', 5, 70, 25, { unit: '%' }), sh('sharp', 'Tip sharpness', 50, 250, 100, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), sh('lean', 'Lean', 0, 60, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 45, { unit: '°' }), sh('flare', 'Base flare', 0, 100, 0, { unit: '%' }), sh('chamfer', 'Chamfer', 0, 100, 0, { unit: '%' }), seg('base', 'Base', 'shape', [['none', 'None'], ['rock', 'Rock']], 'none'), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Amethyst point', { pal: 'amethyst', facets: 6, taper: 15, tip: 25 }], ['Ice needle', { pal: 'diamond', facets: 4, taper: 40, tip: 45, sharp: 180, w: 8, d: 8, h: 64 }], ['Twisted ruby', { pal: 'ruby', facets: 5, twist: 180, tip: 30 }], ['Leaning emerald', { pal: 'emerald', lean: 25, base: 'rock' }], ['Quartz obelisk', { pal: 'quartz', facets: 8, chamfer: 40, taper: 25, tip: 15 }]],
    make(p) {
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, bulge: p.bulge / 100, tip: p.tip / 100, sharp: p.sharp / 100, twist: p.twist, flare: p.flare / 100, chamfer: p.chamfer / 100 }), { part: 'body' });
      const R = leanMat(p.lean, p.leanDir), prims = [place(c, [0, 0, 0], R)];
      base(p, prims);
      return { prims, tips: [tipAt([0, 0, 0], R, [0, p.h, 0])] };
    },
  });
  fam({
    id: 'quartz2', group: 'crystals', name: 'Double point', tip: true, pals: CRYS, parts: ['body', 'edge'], size: { w: [2, 80, 10], d: [2, 80, 10], h: [6, 256, 40] },
    params: [sh('facets', 'Facets', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('tip', 'Top tip', 5, 50, 22, { unit: '%' }), sh('btip', 'Bottom tip', 5, 50, 18, { unit: '%' }), sh('sharp', 'Tip sharpness', 50, 250, 100, { unit: '%' }), sh('bulge', 'Bulge', -40, 50, 0, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), sh('lean', 'Lean', 0, 60, 12, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 30, { unit: '°' }), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Clear quartz', { pal: 'quartz' }], ['Herkimer diamond', { pal: 'diamond', h: 28, w: 14, d: 14, tip: 30, btip: 30 }], ['Amethyst wand', { pal: 'amethyst', h: 60, w: 8, d: 8 }]],
    make(p) {
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), tip: p.tip / 100, btip: p.btip / 100, double: true, sharp: p.sharp / 100, bulge: p.bulge / 100, twist: p.twist }), { part: 'body' });
      const R = leanMat(p.lean, p.leanDir);
      return { prims: [place(c, [0, 0, 0], R)], tips: [tipAt([0, 0, 0], R, [0, p.h, 0])] };
    },
  });
  fam({
    id: 'cluster', group: 'crystals', name: 'Crystal cluster', tip: true, seed: true, pals: CRYS, parts: ['body', 'base', 'edge'], size: { w: [8, 160, 36], d: [8, 160, 36], h: [8, 200, 40] },
    params: [sh('count', 'Crystals', 3, 40, 12), sh('facets', 'Facets', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('girth', 'Thickness', 20, 200, 100, { unit: '%' }), sh('spread', 'Lean out', 0, 70, 35, { unit: '°' }), sh('vary', 'Height range', 0, 90, 60, { unit: '%' }), sh('tip', 'Tip length', 5, 60, 25, { unit: '%' }), sh('taper', 'Taper', 0, 80, 10, { unit: '%' }), seg('base', 'Base', 'shape', [['none', 'None'], ['rock', 'Rock']], 'rock'), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Geode cluster', { pal: 'amethyst', count: 14 }], ['Ice spikes', { pal: 'diamond', count: 9, spread: 15, girth: 70, tip: 40 }], ['Emerald bloom', { pal: 'emerald', count: 22, spread: 55 }], ['Ruby crown', { pal: 'ruby', count: 8, spread: 50, vary: 20 }]],
    make(p, rnd) {
      const prims = [], tips = [], n = p.count, W = rx(p), Dz = rz(p);
      for (let i = 0; i < n; i++) {
        const first = i === 0, a = rnd() * Math.PI * 2, r = first ? 0 : Math.sqrt(0.15 + 0.85 * rnd()) * 0.62;
        const px = Math.cos(a) * r * W, pz = Math.sin(a) * r * Dz;
        const h = first ? p.h : p.h * (1 - (p.vary / 100) * (0.35 + 0.65 * rnd())) * (1 - r * 0.35);
        const rad = Math.max(1, (Math.min(W, Dz) * 0.18 + h * 0.06) * (p.girth / 100) * (first ? 1.15 : 0.7 + rnd() * 0.5));
        const c = Object.assign(crystal({ n: p.facets, h, rx: rad, rz: rad, tip: p.tip / 100, taper: p.taper / 100, rot: rnd() * 6 }), { part: 'body' });
        const lean = first ? rnd() * 6 : (p.spread * (0.4 + 0.6 * r / 0.62)) * (0.75 + rnd() * 0.5), dir = Math.atan2(px, -pz) / RAD;   // outward from the middle
        const R = leanMat(lean, dir), o = [px, -Math.max(1, rad * 0.4), pz];
        prims.push(place(c, o, R)); tips.push(tipAt(o, R, [0, h, 0]));
      }
      if (p.base === 'rock') prims.push(Object.assign(ellipsoid({ rx: W * 0.8, ry: Math.max(2, p.h * 0.08), rz: Dz * 0.8 }), { part: 'base', rough: 1 }));
      return { prims, tips };
    },
  });
  fam({
    id: 'shard', group: 'crystals', name: 'Floating shard', seed: true, floating: true, pals: CRYS.concat(['obsidian', 'deepslate']), parts: ['body', 'edge'], size: { w: [4, 80, 14], d: [4, 80, 10], h: [8, 200, 40] }, hollow: false,
    params: [sh('jag', 'Jaggedness', 0, 60, 25, { unit: '%' }), sh('facets', 'Facets', 6, 30, 14), sh('hover', 'Hover', 0, 40, 6), sh('chips', 'Orbiting chips', 0, 16, 5), sh('orbit', 'Orbit', 50, 300, 140, { unit: '%' }), sh('tiltS', 'Tilt', 0, 60, 15, { unit: '°' }), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Void shard', { pal: 'obsidian', jag: 35, chips: 7 }], ['Sky prism', { pal: 'diamond', jag: 15, chips: 3, hover: 12 }], ['Amethyst splinter', { pal: 'amethyst', jag: 45, facets: 22 }]],
    make(p, rnd) {
      const a = rx(p), c = rz(p), b = p.h / 2;
      const core = Object.assign(jagged({ r: [a, b, c], jag: p.jag / 100, k: p.facets }, rnd), { part: 'body' });
      const R = leanMat(p.tiltS, rnd() * 360), o = [0, p.hover + b, 0];
      const prims = [place(core, o, R)];
      for (let i = 0; i < p.chips; i++) {
        const s = Math.max(1, Math.min(a, c) * (0.18 + rnd() * 0.25)), ang = (i / Math.max(1, p.chips)) * Math.PI * 2 + rnd() * 0.6, rr = Math.max(a, c) * (p.orbit / 100) + s + 2;
        const ch = Object.assign(jagged({ r: [s, s * (1.3 + rnd()), s], jag: 0.3, k: 9 }, rnd), { part: 'body' });
        prims.push(place(ch, [Math.cos(ang) * rr, p.hover + b * (0.4 + rnd() * 1.2), Math.sin(ang) * rr], leanMat(rnd() * 60, rnd() * 360)));
      }
      return { prims };
    },
  });
  fam({
    id: 'geode', group: 'crystals', name: 'Geode', seed: true, pals: ['amethyst', 'diamond', 'emerald', 'ruby'], parts: ['body', 'base', 'trim'], size: { w: [8, 120, 30], d: [8, 120, 30], h: [8, 120, 26] }, hollow: false, glowDef: 'none',
    params: [seg('open', 'Opening', 'shape', [['half', 'Cut in half'], ['crack', 'Crack'], ['closed', 'Closed']], 'half'), sh('shell', 'Shell', 3, 8, 4), sh('crystals', 'Crystals inside', 0, 100, 60, { unit: '%' }), sh('crackW', 'Crack width', 1, 12, 3)],
    variants: [['Amethyst geode', { pal: 'amethyst', open: 'half' }], ['Cracked egg', { pal: 'amethyst', open: 'crack', w: 22, d: 22, h: 30 }], ['Diamond geode', { pal: 'diamond' }]],
    make(p, rnd) {
      const Rx = rx(p), Ry = p.h / 2, Rz = rz(p), mn = Math.min(Rx, Ry, Rz), sh2 = Math.min(p.shell, mn - 1);
      const crackDir = rnd() * Math.PI * 2, seed = (p.seed | 0) + 17;
      const f = (x, y, z) => {
        const yy = y - Ry, e = Math.hypot(x / Rx, yy / Ry, z / Rz), d = (e - 1) * mn;
        let v = Math.max(d, -(d + sh2));
        if (p.open === 'half') v = Math.max(v, z - 0.5);
        if (p.open === 'crack') {
          const ang = Math.atan2(z, x) - crackDir, along = Math.cos(ang) > 0 ? Math.abs(Math.sin(ang)) * Math.hypot(x, z) : 99;
          const wig = (vnoise(y * 0.18, 0, 0, seed) - 0.5) * p.crackW * 1.6;
          v = Math.max(v, p.crackW / 2 - Math.abs(along + wig));   // carved where the crack runs
        }
        return v;
      };
      const partAt = (x, y, z) => { const e = (1 - Math.hypot(x / Rx, (y - Ry) / Ry, z / Rz)) * mn; return e < 1 ? 'base' : e < 2 ? 'trim' : 'body'; };
      return { prims: [{ f, partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-Rx - 1, -1, -Rz - 1, Rx + 1, p.h + 1, Rz + 1] }], geode: { amount: p.crystals / 100 } };
    },
  });
  fam({
    id: 'spire', group: 'crystals', name: 'Crystal spire', tip: true, seed: true, pals: CRYS, parts: ['body', 'base', 'edge'], size: { w: [3, 60, 8], d: [3, 60, 8], h: [16, 256, 96] },
    params: [sh('facets', 'Facets', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('taper', 'Taper', 0, 90, 55, { unit: '%' }), sh('tip', 'Tip length', 5, 50, 18, { unit: '%' }), sh('sats', 'Side crystals', 0, 12, 5), sh('satH', 'Side height', 10, 70, 30, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Amethyst spire', { pal: 'amethyst' }], ['End tower', { pal: 'end', facets: 8, sats: 8 }], ['Frozen needle', { pal: 'diamond', facets: 4, taper: 75, sats: 3 }]],
    make(p, rnd) {
      const prims = [Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, tip: p.tip / 100, twist: p.twist, flare: 0.3 }), { part: 'body' })], tips = [{ p: [0, p.h, 0], dir: [0, 1, 0] }];
      for (let i = 0; i < p.sats; i++) {
        const a = (i / p.sats) * Math.PI * 2 + rnd() * 0.5, r = Math.max(rx(p), rz(p)) * 0.8, h = p.h * (p.satH / 100) * (0.6 + rnd() * 0.6), rad = Math.max(1, rx(p) * 0.4);
        const o = [Math.cos(a) * r, -1, Math.sin(a) * r], R = leanMat(18 + rnd() * 18, Math.atan2(Math.cos(a), -Math.sin(a)) / RAD);
        prims.push(place(Object.assign(crystal({ n: p.facets, h, rx: rad, rz: rad, tip: 0.3 }), { part: 'body' }), o, R));
        tips.push(tipAt(o, R, [0, h, 0]));
      }
      return { prims, tips };
    },
  });
  fam({
    id: 'prism', group: 'crystals', name: 'Prism', pals: CRYS.concat(STONES), parts: ['body', 'trim', 'edge'], size: { w: [3, 128, 16], d: [3, 128, 16], h: [3, 256, 40] },
    params: [sh('facets', 'Facets', 3, 8, 3, { t: 'seg', ch: FACETS }), sh('taper', 'Taper', 0, 90, 0, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), sh('chamfer', 'Chamfer', 0, 100, 0, { unit: '%' }), bool('lying', 'Lying down', 'shape', false), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Triangle prism', { facets: 3, pal: 'quartz' }], ['Hex column', { facets: 6, pal: 'basalt' }], ['Lying prism', { facets: 3, lying: true, pal: 'diamond', h: 48 }], ['Twisted column', { facets: 4, twist: 90, pal: 'tuff' }]],
    make(p) {
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, tip: 0.0001, sharp: 0.05, twist: p.twist, chamfer: p.chamfer / 100 }), { part: 'body' });
      if (!p.lying) return { prims: [c] };
      const R = mat({ z: -90 });   // the axis lies along +x; a facet rests on the ground
      return { prims: [place(c, [-p.h / 2, rx(p) * Math.cos(Math.PI / p.facets), 0], R)] };
    },
  });
  fam({
    id: 'bipyramid', group: 'crystals', name: 'Bipyramid', tip: true, pals: CRYS.concat(STONES), parts: ['body', 'edge'], size: { w: [3, 128, 20], d: [3, 128, 20], h: [4, 256, 36] },
    params: [sh('facets', 'Facets', 3, 8, 4, { t: 'seg', ch: FACETS }), sh('mid', 'Equator', 15, 85, 45, { unit: '%' }), sh('sharp', 'Curve', 40, 250, 100, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), sh('lift', 'Hover', 0, 40, 0), bool('edges', 'Glass edges', 'shape', true)],
    variants: [['Octahedron', { facets: 4, mid: 50, pal: 'diamond' }], ['Hex diamond', { facets: 6, mid: 35, pal: 'emerald' }], ['Floating gem', { facets: 4, lift: 6, pal: 'ruby' }]],
    make(p) {
      const t = p.mid / 100;
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), tip: 1 - t, btip: t, double: true, sharp: p.sharp / 100, twist: p.twist }), { part: 'body' });
      const o = [0, p.lift, 0], R = mat({});
      return { prims: [place(c, o, R)], tips: [tipAt(o, R, [0, p.h, 0])] };
    },
  });

  // ---------------- monoliths ----------------
  const MONO = (o) => fam(Object.assign({ group: 'monoliths', pals: STONES, parts: ['body', 'base', 'trim', 'accent'], size: { w: [1, 64, 6], d: [1, 64, 2], h: [3, 256, 18] } }, o));
  const plinth = (p, prims) => { if (p.plinth) for (let k = 0; k < p.plinth; k++) { const s = (p.plinth - k) * 1.2; prims.push(Object.assign(slab({ h: k + 1, hx: rx(p) + s, hz: rz(p) + s }), { part: 'base' })); } };
  const lift = (p) => (p.plinth || 0);
  const monoShape = (p, extra) => Object.assign(slab(Object.assign({ h: p.h, hx: rx(p), hz: rz(p), taper: (p.taper || 0) / 100, bulge: (p.bulge || 0) / 100, twist: p.twist || 0, chamfer: (p.chamfer || 0) / 100, tip: (p.tip || 0) / 100, round: (p.round || 0) / 100 }, extra || {})), { part: 'body' });
  const MP = { taper: sh('taper', 'Taper', 0, 90, 0, { unit: '%' }), bulge: sh('bulge', 'Bulge', -50, 50, 0, { unit: '%' }), chamfer: sh('chamfer', 'Chamfer', 0, 100, 0, { unit: '%' }), twist: sh('twist', 'Twist', 0, 720, 0, { unit: '°' }), lean: sh('lean', 'Lean', 0, 45, 0, { unit: '°' }), leanDir: sh('leanDir', 'Lean toward', 0, 359, 90, { unit: '°' }), round: sh('round', 'Roundness', 0, 100, 0, { unit: '%' }), plinth: sh('plinth', 'Plinth steps', 0, 4, 0), tip: sh('tip', 'Pyramidion', 0, 40, 0, { unit: '%' }) };
  const standOn = (p, c, prims, tips) => { const R = leanMat(p.lean || 0, p.leanDir || 0), o = [0, lift(p), 0]; prims.push(place(c, o, R)); if (tips) tips.push(tipAt(o, R, [0, p.h, 0])); };

  MONO({ id: 'slab', name: 'Slab monolith', params: [MP.chamfer, MP.taper, MP.lean, MP.leanDir, MP.plinth], hollow: true,
    variants: [['The black slab', { pal: 'obsidian', w: 4, d: 1, h: 9, chamfer: 0 }], ['Giant slab', { pal: 'obsidian', w: 16, d: 4, h: 36 }], ['Copper tablet', { pal: 'copper', w: 8, d: 2, h: 14, weather: 30 }], ['Quartz tablet', { pal: 'quartzstone', w: 6, d: 2, h: 12, plinth: 2 }]],
    make(p) { const prims = []; plinth(p, prims); standOn(p, monoShape(p), prims); return { prims }; } });
  MONO({ id: 'obelisk', name: 'Obelisk', tip: true, size: { w: [2, 48, 6], d: [2, 48, 6], h: [8, 256, 40] }, params: [Object.assign({}, MP.taper, { def: 35 }), Object.assign({}, MP.tip, { def: 10 }), MP.chamfer, MP.plinth, sh('bands', 'Carved bands', 0, 8, 2)],
    variants: [['Sandstone obelisk', { pal: 'sandstone', plinth: 2 }], ['Gilded quartz', { pal: 'quartzstone', plinth: 3, bands: 3 }], ['Obsidian needle', { pal: 'obsidian', w: 4, d: 4, h: 64, taper: 50, tip: 14, glow: 'edges' }], ['Deepslate spike', { pal: 'deepslate', bands: 4, glow: 'rings' }]],
    make(p) {
      const prims = []; plinth(p, prims);
      const c = monoShape(p, { tip: Math.max(1, p.tip) / 100 });
      if (p.bands) { const yb = lift(p); c.partAt = (x, y) => { const k = Math.floor(((y - yb) / p.h) * (p.bands + 1) * 2); return k % 2 === 1 && (y - yb) < p.h * 0.85 && Math.abs(((y - yb) / p.h) * (p.bands + 1) * 2 - k - 0.5) < 0.18 ? 'trim' : 'body'; }; }
      const tips = []; standOn(p, c, prims, tips); return { prims, tips };
    } });
  MONO({ id: 'broken', name: 'Broken monolith', seed: true, params: [Object.assign({}, MP.lean, { def: 12 }), MP.leanDir, sh('break', 'Break height', 30, 85, 62, { unit: '%' }), sh('fallen', 'Fallen part', 0, 100, 100, { unit: '%' }), MP.chamfer],
    variants: [['Toppled giant', { pal: 'deepslate', w: 8, d: 4, h: 30, weather: 40, cracks: 40 }], ['Ancient ruin', { pal: 'sandstone', weather: 50, moss: 20 }], ['Overgrown', { pal: 'stone', moss: 70, weather: 30 }]],
    make(p, rnd) {
      const prims = [], hb = p.h * p.break / 100, seed = p.seed | 0;
      const cut = (x, y, z) => y - (hb + (vnoise(x * 0.5, 0, z * 0.5, seed) - 0.5) * Math.max(2, p.w * 0.4));
      const low = monoShape(p), lowF = low.f;
      low.f = (x, y, z) => Math.max(lowF(x, y, z), cut(x, y, z));
      standOn(p, low, prims);
      if (p.fallen > 0) {
        const top = monoShape(p), tf = top.f;
        top.f = (x, y, z) => Math.max(tf(x, y, z), -cut(x, y, z), y - hb - (p.h - hb) * p.fallen / 100);
        top.box = [top.box[0], hb - p.w, top.box[2], top.box[3], p.h, top.box[5]];
        const dir = rnd() * 360, R = mat({ order: 'YXZ', y: -dir, x: 84 });
        prims.push(place(top, [Math.sin(dir * RAD) * (rz(p) + 2), rz(p) - hb * Math.cos(84 * RAD) + 0.5, Math.cos(dir * RAD) * (rz(p) + 2)], R));
      }
      return { prims };
    } });
  MONO({ id: 'menhir', name: 'Standing stone', seed: true, size: { w: [2, 40, 5], d: [2, 40, 3], h: [3, 120, 12] }, params: [Object.assign({}, MP.taper, { def: 30 }), Object.assign({}, MP.round, { def: 60 }), Object.assign({}, MP.lean, { def: 6 }), MP.leanDir, MP.bulge],
    variants: [['Mossy menhir', { pal: 'stone', moss: 45, rough: 40 }], ['Tuff stone', { pal: 'tuff', rough: 30 }], ['Sun stone', { pal: 'sandrock', rough: 20 }]],
    make(p) { const prims = []; const c = monoShape(p, { tip: 0.12 }); c.rough = 1; standOn(p, c, prims); return { prims }; }, pals: OLD });
  MONO({ id: 'henge', name: 'Stone circle', seed: true, pals: OLD, size: { w: [12, 160, 40], d: [12, 160, 40], h: [3, 64, 10] }, params: [sh('stones', 'Stones', 4, 30, 12), sh('stoneW', 'Stone width', 1, 12, 3), sh('stoneD', 'Stone depth', 1, 8, 2), seg('lintels', 'Lintels', 'shape', [['all', 'All'], ['pairs', 'Pairs'], ['none', 'None']], 'all'), bool('altar', 'Altar', 'shape', true), sh('ruin', 'Ruin', 0, 80, 0, { unit: '%' }), Object.assign({}, MP.round, { def: 30 })],
    variants: [['Stonehenge', { pal: 'sandstone', stones: 16, lintels: 'all', ruin: 25, weather: 35 }], ['Druid circle', { pal: 'stone', stones: 9, lintels: 'none', moss: 60 }], ['Glowing ring', { pal: 'deepslate', glow: 'runes', lintels: 'pairs' }]],
    make(p, rnd) {
      const prims = [], n = p.stones, R0 = rx(p) - p.stoneW, Rz0 = rz(p) - p.stoneW, top = [];
      for (let i = 0; i < n; i++) {
        if (p.ruin && rnd() < p.ruin / 200) continue;
        const a = (i / n) * Math.PI * 2, o = [Math.cos(a) * R0, 0, Math.sin(a) * Rz0], hh = p.h * (p.ruin ? 1 - rnd() * p.ruin / 150 : 1);
        const c = Object.assign(slab({ h: hh, hx: p.stoneD / 2, hz: p.stoneW / 2, round: p.round / 100, taper: 0.1 }), { part: 'body', rough: 1 });
        prims.push(place(c, o, mat({ y: -a / RAD })));
        top.push([o, hh, a]);
      }
      if (p.lintels !== 'none') for (let i = 0; i < top.length; i++) {
        if (p.lintels === 'pairs' && i % 2) continue;
        const [a, ha] = top[i], [b, hb2] = top[(i + 1) % top.length];
        if (top.length < 3 || Math.abs(ha - hb2) > 2 || Math.abs(ha - p.h) > 1) continue;
        const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2, len = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2 + p.stoneW * 0.6, ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
        prims.push(place(Object.assign(slab({ h: 2, hx: len, hz: p.stoneD / 2 + 0.2 }), { part: 'trim' }), [mx, ha, mz], mat({ y: -ang / RAD })));
      }
      if (p.altar) prims.push(Object.assign(slab({ h: 2, hx: p.stoneW, hz: p.stoneD + 1 }), { part: 'accent' }));
      return { prims };
    } });
  MONO({ id: 'dolmen', name: 'Dolmen', seed: true, size: { w: [5, 60, 12], d: [4, 60, 9], h: [3, 40, 7] }, params: [sh('legs', 'Uprights', 3, 6, 4), sh('capT', 'Capstone', 1, 6, 2), sh('tilt', 'Cap tilt', 0, 20, 6, { unit: '°' }), Object.assign({}, MP.round, { def: 50 })],
    variants: [['Portal tomb', { pal: 'stone', moss: 35, rough: 30 }], ['Basalt table', { pal: 'basalt', legs: 3 }], ['Desert dolmen', { pal: 'sandrock', weather: 40 }]],
    make(p, rnd) {
      const prims = [];
      for (let i = 0; i < p.legs; i++) {
        const a = (i / p.legs) * Math.PI * 2 + 0.4, o = [Math.cos(a) * rx(p) * 0.6, 0, Math.sin(a) * rz(p) * 0.6];
        prims.push(place(Object.assign(slab({ h: p.h + 1, hx: 0.9, hz: Math.max(1, p.w / 8), round: p.round / 100 }), { part: 'body', rough: 1 }), o, mat({ y: -a / RAD + rnd() * 20 })));
      }
      prims.push(place(Object.assign(slab({ h: p.capT, hx: rx(p), hz: rz(p), round: p.round / 100 }), { part: 'trim', rough: 1 }), [0, p.h, 0], mat({ x: p.tilt, y: rnd() * 40 })));
      return { prims };
    }, pals: OLD });
  MONO({ id: 'alignment', name: 'Menhir rows', seed: true, pals: OLD, size: { w: [8, 200, 48], d: [2, 60, 8], h: [3, 64, 10] }, params: [sh('count', 'Stones per row', 3, 30, 9), sh('rows', 'Rows', 1, 4, 2), sh('fall', 'Height falls to', 20, 100, 45, { unit: '%' }), Object.assign({}, MP.round, { def: 55 })],
    variants: [['Carnac rows', { pal: 'stone', rows: 3, moss: 40 }], ['Avenue of tuff', { pal: 'tuff', rows: 2, fall: 100 }], ['Rune path', { pal: 'deepslate', rows: 2, glow: 'runes' }]],
    make(p, rnd) {
      const prims = [];
      for (let r = 0; r < p.rows; r++) for (let i = 0; i < p.count; i++) {
        const t = i / Math.max(1, p.count - 1), x = -rx(p) + t * p.w, z = p.rows > 1 ? -rz(p) + (r / (p.rows - 1)) * p.d : 0;
        const hh = Math.max(2, p.h * lerp(1, p.fall / 100, t) * (0.8 + rnd() * 0.3));
        prims.push(place(Object.assign(slab({ h: hh, hx: 0.8 + rnd() * 0.8, hz: 1 + rnd(), round: p.round / 100, taper: 0.25, tip: 0.1 }), { part: 'body', rough: 1 }), [x + (rnd() - 0.5) * 2, 0, z + (rnd() - 0.5) * 2], leanMat(rnd() * 8, rnd() * 360)));
      }
      return { prims };
    } });
  MONO({ id: 'totem', name: 'Totem pillar', size: { w: [3, 40, 7], d: [3, 40, 7], h: [6, 200, 30] }, params: [sh('segs', 'Segments', 2, 12, 5), sh('vary', 'Width change', 0, 60, 30, { unit: '%' }), bool('faces', 'Carved faces', 'shape', true), sh('capH', 'Cap', 0, 6, 2)],
    variants: [['Wood-like totem', { pal: 'terracotta', segs: 5 }], ['Prismarine pillar', { pal: 'prismarine', segs: 7, glow: 'rings' }], ['Copper stack', { pal: 'copper', segs: 4 }]],
    make(p) {
      const prims = [], k = p.segs, sh2 = (p.h - p.capH) / k;
      for (let i = 0; i < k; i++) {
        const s = 1 - (i % 2 ? p.vary / 100 : 0) * 0.6, c = Object.assign(slab({ h: sh2, hx: rx(p) * s, hz: rz(p) * s, chamfer: 0.4 }), { part: i % 2 ? 'trim' : 'body' });
        if (p.faces && i % 2 === 0) c.partAt = (x, y, z) => { const fy = y / sh2; return (fy > 0.55 && fy < 0.75 && Math.abs(Math.abs(x) - rx(p) * 0.4) < 0.9) || (fy > 0.2 && fy < 0.35 && Math.abs(x) < rx(p) * 0.5) ? 'accent' : 'body'; };
        prims.push(place(c, [0, i * sh2, 0], mat({ y: i * 0 })));
      }
      if (p.capH) prims.push(place(Object.assign(slab({ h: p.capH, hx: rx(p) * 1.3, hz: rz(p) * 1.3, chamfer: 0.5 }), { part: 'base' }), [0, p.h - p.capH, 0], mat({})));
      return { prims };
    } });
  MONO({ id: 'runestone', name: 'Rune stone', seed: true, glowDef: 'runes', size: { w: [3, 48, 8], d: [1, 24, 3], h: [4, 120, 14] }, params: [Object.assign({}, MP.round, { def: 45 }), Object.assign({}, MP.taper, { def: 15 }), MP.lean, MP.leanDir, MP.plinth],
    variants: [['Sculk runes', { pal: 'deepslate', glowBlock: 'sculk' }], ['Redstone runes', { pal: 'stone', glowBlock: 'redstone_lamp' }], ['Sea runes', { pal: 'prismarine', glowBlock: 'sea_lantern' }], ['Amethyst runes', { pal: 'blackstone', glowBlock: 'amethyst' }], ['Glowstone runes', { pal: 'sandstone', glowBlock: 'glowstone' }]],
    make(p) { const prims = []; plinth(p, prims); const c = monoShape(p, { tip: 0.08 }); standOn(p, c, prims); return { prims }; } });
  MONO({ id: 'floating', name: 'Floating monolith', seed: true, floating: true, size: { w: [2, 48, 6], d: [1, 24, 2], h: [4, 160, 18] }, params: [sh('hover', 'Hover', 1, 40, 5), sh('chips', 'Orbiting shards', 0, 24, 8), sh('orbit', 'Orbit', 50, 400, 180, { unit: '%' }), bool('pedestal', 'Pedestal', 'shape', true), MP.chamfer],
    variants: [['Void slab', { pal: 'obsidian', glow: 'edges', glowBlock: 'crying' }], ['End relic', { pal: 'endstone', glowBlock: 'end_rod', glow: 'veins' }], ['Prismarine tablet', { pal: 'prismarine', glow: 'core' }]],
    make(p, rnd) {
      const prims = [];
      if (p.pedestal) prims.push(Object.assign(slab({ h: 2, hx: rx(p) + 2, hz: rz(p) + 2, chamfer: 0.6 }), { part: 'base' }));
      const y0 = (p.pedestal ? 2 : 0) + p.hover;
      prims.push(place(monoShape(p), [0, y0, 0], mat({})));
      for (let i = 0; i < p.chips; i++) {
        const a = (i / Math.max(1, p.chips)) * Math.PI * 2 + rnd() * 0.4, rr = Math.max(rx(p), rz(p)) * p.orbit / 100 + 2, s = Math.max(0.8, Math.min(rx(p), 3) * (0.3 + rnd() * 0.4));
        prims.push(place(Object.assign(jagged({ r: [s, s * 1.6, s], jag: 0.3, k: 8 }, rnd), { part: 'accent' }), [Math.cos(a) * rr, y0 + p.h * (0.2 + 0.6 * rnd()), Math.sin(a) * rr], leanMat(rnd() * 70, rnd() * 360)));
      }
      return { prims };
    } });
  MONO({ id: 'split', name: 'Split monolith', seed: true, size: { w: [3, 64, 10], d: [1, 32, 3], h: [4, 200, 22] }, params: [sh('gap', 'Gap', 1, 12, 2), sh('jag', 'Jagged split', 0, 100, 50, { unit: '%' }), bool('core', 'Glowing seam', 'shape', true), MP.chamfer, MP.plinth],
    variants: [['Molten seam', { pal: 'basalt', glowBlock: 'magma' }], ['Sculk rift', { pal: 'deepslate', glowBlock: 'sculk' }], ['Crying split', { pal: 'obsidian', glowBlock: 'crying' }]],
    make(p) {
      const prims = [], seed = p.seed | 0, g = p.gap / 2;
      plinth(p, prims);
      const seam = (x, y) => x - (vnoise(y * 0.2, 0, 0, seed) - 0.5) * p.w * 0.5 * (p.jag / 100);
      for (const sg of [1, -1]) { const c = monoShape(p), f0 = c.f; c.f = (x, y, z) => Math.max(f0(x, y, z), g - sg * seam(x, y)); prims.push(place(c, [0, lift(p), 0], mat({}))); }
      if (p.core) prims.push(place(Object.assign(slab({ h: p.h * 0.9, hx: g + 0.4, hz: rz(p) * 0.45 }), { part: 'glow', f2: true }), [0, lift(p), 0], mat({})));
      if (p.core) { const last = prims[prims.length - 1], f0 = last.f; last.f = (x, y, z) => Math.max(f0(x, y, z), Math.abs(seam(x, y - lift(p))) - g - 0.4); }
      return { prims };
    } });
  MONO({ id: 'stepped', name: 'Stepped monolith', size: { w: [3, 80, 10], d: [3, 80, 10], h: [4, 200, 24] }, params: [sh('tiers', 'Tiers', 2, 10, 4), sh('shrink', 'Step in', 5, 40, 18, { unit: '%' }), bool('glowEdge', 'Lit steps', 'shape', false)],
    variants: [['Basalt steps', { pal: 'basalt', tiers: 5 }], ['Quartz ziggurat', { pal: 'quartzstone', tiers: 4, glowEdge: true }], ['Tuff tower', { pal: 'tuff', tiers: 6, shrink: 10 }]],
    make(p) {
      const prims = [], k = p.tiers, th = p.h / k;
      for (let i = 0; i < k; i++) { const s = Math.max(0.15, 1 - i * p.shrink / 100); prims.push(place(Object.assign(slab({ h: th, hx: rx(p) * s, hz: rz(p) * s }), { part: i % 2 ? 'trim' : 'body', partAt: p.glowEdge ? (x, y) => (y > th - 1 ? 'glow' : i % 2 ? 'trim' : 'body') : null }), [0, i * th, 0], mat({}))); }
      return { prims };
    } });
  MONO({ id: 'twisted', name: 'Twisted monolith', tip: true, size: { w: [2, 48, 6], d: [2, 48, 4], h: [6, 256, 36] }, params: [Object.assign({}, MP.twist, { def: 180 }), Object.assign({}, MP.taper, { def: 30 }), Object.assign({}, MP.tip, { def: 8 }), MP.chamfer, MP.bulge],
    variants: [['Spiral obsidian', { pal: 'obsidian', twist: 270 }], ['Copper corkscrew', { pal: 'copper', twist: 540, w: 8, d: 3 }], ['End helix', { pal: 'endstone', twist: 360, glow: 'edges', glowBlock: 'end_rod' }]],
    make(p) { const prims = [], tips = []; standOn(p, monoShape(p), prims, tips); return { prims, tips }; } });

  // ---------------- nature ----------------
  fam({ id: 'rock', group: 'nature', name: 'Rock', seed: true, pals: ['rockstone', 'stone','deepslate', 'tuff', 'sandrock', 'basalt', 'blackstone', 'endstone', 'sandstone'], parts: ['body', 'base', 'trim'], size: { w: [3, 128, 14], d: [3, 128, 11], h: [2, 160, 9] }, surface: ['rough', 'weather', 'moss', 'cracks'],
    params: [seg('kind', 'Kind', 'shape', [['boulder', 'Boulder'], ['stack', 'Sea stack'], ['pinnacles', 'Pinnacles'], ['arch', 'Rock arch']], 'boulder'), sh('lumps', 'Lumps', 1, 8, 3), sh('strata', 'Strata', 0, 100, 0, { unit: '%', tip: 'Horizontal layers in the trim block' }), sh('sink', 'Sunk in', 0, 60, 20, { unit: '%' })],
    variants: [['Mossy boulder', { kind: 'boulder', pal: 'stone', moss: 55, rough: 45 }], ['Sea stack', { kind: 'stack', pal: 'sandrock', h: 40, w: 14, d: 12, strata: 60, rough: 40 }], ['Basalt pinnacles', { kind: 'pinnacles', pal: 'basalt', h: 30 }], ['Desert arch', { kind: 'arch', pal: 'sandrock', w: 40, h: 22, strata: 50 }]],
    make(p, rnd) {
      const prims = [], W = rx(p), Dz = rz(p);
      if (p.kind === 'boulder') {
        for (let i = 0; i < p.lumps; i++) { const s = i ? 0.45 + rnd() * 0.35 : 1, o = i ? [(rnd() - 0.5) * W, 0, (rnd() - 0.5) * Dz] : [0, 0, 0]; const ry = p.h * s; prims.push(place(Object.assign(ellipsoid({ rx: W * s, ry, rz: Dz * s }), { part: 'body', rough: 1 }), [o[0], ry * (1 - 2 * p.sink / 100), o[2]], leanMat(rnd() * 20, rnd() * 360))); }
      } else if (p.kind === 'stack') {
        prims.push(Object.assign(slab({ h: p.h, hx: W, hz: Dz, taper: 0.35, round: 0.7, bulge: -0.1, tip: 0.08 }), { part: 'body', rough: 1 }));
        prims.push(Object.assign(ellipsoid({ rx: W * 1.5, ry: 2, rz: Dz * 1.5 }), { part: 'base', rough: 1 }));
      } else if (p.kind === 'pinnacles') {
        for (let i = 0; i < p.lumps + 2; i++) { const a = rnd() * Math.PI * 2, r = i ? rnd() * 0.7 : 0, hh = p.h * (i ? 0.35 + rnd() * 0.55 : 1), s = 0.25 + rnd() * 0.2; prims.push(place(Object.assign(slab({ h: hh, hx: W * s, hz: Dz * s, taper: 0.6, round: 0.6, tip: 0.15 }), { part: 'body', rough: 1 }), [Math.cos(a) * r * W, -1, Math.sin(a) * r * Dz], leanMat(rnd() * 8, rnd() * 360))); }
      } else {
        const R = W - Math.max(2, W * 0.25), t = Math.max(2, W * 0.3);
        // half a torus standing on the ground, squashed or stretched to the height
        const ky = (R + t) / Math.max(2, p.h);
        prims.push({ f: (x, y, z) => { const q = Math.hypot(x, y * ky) - (R + t / 2); return Math.max(Math.hypot(q, z * (t / 2) / Math.max(1, Dz)) - t / 2, -y); }, part: 'body', rough: 1, grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W - 1, 0, -Dz - 1, W + 1, p.h + 1, Dz + 1] });
      }
      if (p.strata) prims.forEach((pr) => { const pa = pr.partAt; pr.partAt = (x, y, z) => ((Math.floor(y / 3 + vnoise(x * 0.1, 0, z * 0.1, 3) * 2) % 3 === 0 && (y % 3) < 3 * p.strata / 100) ? 'trim' : pa ? pa(x, y, z) : pr.part); });
      return { prims };
    } });
  fam({ id: 'mountain', group: 'nature', name: 'Mountain', seed: true, pals: ['mountain', 'sandrock', 'deepslate', 'tuff'], parts: ['body', 'base', 'trim'], size: { w: [16, 256, 96], d: [16, 256, 96], h: [8, 192, 48] }, glow: false, surface: ['rough', 'moss'],
    params: [sh('peaks', 'Peaks', 1, 6, 2), sh('ridges', 'Ridges', 0, 100, 55, { unit: '%' }), sh('snow', 'Snow line', 0, 100, 70, { unit: '%' }), sh('grass', 'Grass line', 0, 60, 18, { unit: '%' }), sh('steep', 'Steepness', 50, 250, 120, { unit: '%' })],
    variants: [['Alpine peak', { pal: 'mountain', peaks: 1, snow: 62 }], ['Twin peaks', { pal: 'mountain', peaks: 2 }], ['Red mesa', { pal: 'sandrock', steep: 220, snow: 100, grass: 0, ridges: 30 }]],
    make(p, rnd) {
      const W = rx(p), Dz = rz(p), seed = p.seed | 0, pk = [];
      for (let i = 0; i < p.peaks; i++) pk.push([i ? (rnd() - 0.5) * W : 0, i ? (rnd() - 0.5) * Dz : 0, i ? 0.55 + rnd() * 0.35 : 1]);
      const height = (x, z) => {
        let hh = 0;
        for (const [px, pz, s] of pk) { const r = Math.hypot((x - px) / W, (z - pz) / Dz); hh = Math.max(hh, s * Math.pow(Math.max(0, 1 - r), p.steep / 100)); }
        const n = fbm(x * 0.045, 0, z * 0.045, seed), rid = 1 - Math.abs(vnoise(x * 0.06, 3, z * 0.06, seed + 5) * 2 - 1);
        return p.h * clamp(hh * (1 + (n - 0.5) * 0.5) + rid * hh * 0.25 * (p.ridges / 100), 0, 1.15);
      };
      const f = (x, y, z) => y - height(x, z);
      const partAt = (x, y) => (y > p.h * p.snow / 100 ? 'trim' : y < p.h * p.grass / 100 ? 'base' : 'body');
      return { prims: [{ f, partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, p.h * 1.15 + 1, Dz], heightfield: true, height }] };
    } });
  fam({ id: 'volcano', group: 'nature', name: 'Volcano', seed: true, pals: ['volcano', 'deepslate', 'blackstone'], parts: ['body', 'base', 'trim'], size: { w: [16, 256, 72], d: [16, 256, 72], h: [8, 160, 36] }, glow: false, surface: ['rough', 'cracks'],
    params: [sh('crater', 'Crater width', 10, 60, 28, { unit: '%' }), sh('depth', 'Crater depth', 5, 80, 30, { unit: '%' }), sh('flows', 'Lava flows', 0, 10, 4), bool('lava', 'Lava lake', 'shape', true), sh('steep', 'Steepness', 60, 200, 110, { unit: '%' })],
    variants: [['Active volcano', { flows: 5 }], ['Sleeping cone', { flows: 0, lava: false, pal: 'deepslate' }], ['Caldera', { crater: 55, depth: 20, steep: 70 }]],
    make(p, rnd) {
      const W = rx(p), Dz = rz(p), seed = p.seed | 0, cw = p.crater / 100, dep = p.h * p.depth / 100;
      const flows = []; for (let i = 0; i < p.flows; i++) flows.push(rnd() * Math.PI * 2);
      const height = (x, z) => {
        const r = Math.hypot(x / W, z / Dz), n = fbm(x * 0.06, 0, z * 0.06, seed);
        let hh = p.h * Math.pow(Math.max(0, 1 - r), p.steep / 100) * (0.9 + n * 0.2);
        if (r < cw) hh = Math.min(hh, p.h - dep * (1 - Math.pow(r / cw, 2)));
        return hh;
      };
      const flowAt = (x, z) => { const a = Math.atan2(z / Dz, x / W); return flows.some((fa) => { let d = Math.abs(((a - fa + Math.PI * 3) % (Math.PI * 2)) - Math.PI); d += (vnoise(Math.hypot(x, z) * 0.15, 0, fa * 10, seed) - 0.5) * 0.25; return d < 0.06; }); };
      const f = (x, y, z) => y - height(x, z);
      const partAt = (x, y, z) => (Math.hypot(x / W, z / Dz) < cw * 1.1 && y > p.h - dep - 2 ? 'trim' : flowAt(x, z) ? 'trim' : y < 3 ? 'base' : 'body');
      const fluid = p.lava ? { id: 'lava', at: (x, y, z) => Math.hypot(x / W, z / Dz) < cw && y <= p.h - dep * 0.6 && y > height(x, z) - 0.5 } : null;
      return { prims: [{ f, partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, p.h + 2, Dz], heightfield: true, height }], fluid };
    } });
  fam({ id: 'crater', group: 'nature', name: 'Meteor crater', seed: true, pals: ['stone', 'sandrock', 'deepslate', 'endstone'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [12, 200, 48], d: [12, 200, 48], h: [4, 60, 12] }, hollow: false, surface: ['rough', 'moss', 'cracks'], glowDef: 'none',
    params: [sh('rim', 'Rim height', 0, 100, 35, { unit: '%' }), sh('meteor', 'Meteor size', 0, 40, 14, { unit: '%' }), bool('molten', 'Still glowing', 'shape', true), sh('rays', 'Ejecta rays', 0, 12, 6)],
    variants: [['Fresh impact', { molten: true }], ['Old crater', { molten: false, moss: 40, meteor: 8 }], ['End impact', { pal: 'endstone' }]],
    make(p, rnd) {
      // flat ground `top` high, a bowl dug `depth` into it inside 62% of the width, a raised rim around the bowl
      const W = rx(p), Dz = rz(p), seed = p.seed | 0, rays = []; for (let i = 0; i < p.rays; i++) rays.push(rnd() * Math.PI * 2);
      const depth = Math.max(2, p.h * 0.65), top = Math.max(2, Math.round(p.h * 0.45)) + depth * 0.5, floorY = top - depth;
      const height = (x, z) => {
        const r = Math.hypot(x / W, z / Dz) / 0.62;
        if (r < 1) return top - depth * (1 - r * r) + (fbm(x * 0.15, 1, z * 0.15, seed) - 0.5);
        return top + p.h * (p.rim / 100) * Math.exp(-Math.pow((r - 1) * 3.5, 2)) * (0.8 + fbm(x * 0.1, 0, z * 0.1, seed) * 0.4);
      };
      const f = (x, y, z) => y - height(x, z);
      const ms = Math.min(W, Dz) * p.meteor / 100, met = ms > 0.8 ? Object.assign(jagged({ r: [ms, ms * 0.85, ms], jag: 0.3, k: 14 }, rnd), { part: 'accent', rough: 1 }) : null;
      const prims = [{ f, part: 'body', grad: (x, y) => clamp(y / (top + 2), 0, 1), box: [-W, 0, -Dz, W, top + p.h * p.rim / 100 + 2, Dz], heightfield: true, height,
        partAt: (x, y, z) => { const r = Math.hypot(x / W, z / Dz) / 0.62, a = Math.atan2(z, x); return r > 1 && rays.some((ra) => Math.abs(Math.sin(a - ra)) < 0.05 && Math.cos(a - ra) > 0) && y > top - 2 ? 'trim' : y < 2 ? 'base' : 'body'; } }];
      if (met) prims.push(place(met, [0, floorY + ms * 0.55, 0], mat({ x: 20, y: 30 })));
      return { prims, molten: p.molten && met ? { r: ms + 1.5, y: floorY } : null };
    } });
  fam({ id: 'waterfall', group: 'nature', name: 'Waterfall cliff', seed: true, pals: ['stone', 'mountain', 'sandrock', 'deepslate', 'tuff'], parts: ['body', 'base', 'trim'], size: { w: [10, 160, 40], d: [6, 80, 16], h: [8, 160, 36] }, hollow: false, glow: false, surface: ['rough', 'moss', 'weather'],
    params: [sh('fallW', 'Fall width', 1, 16, 4), sh('pool', 'Pool', 0, 100, 60, { unit: '%' }), sh('ledges', 'Ledges', 0, 6, 2), sh('curve', 'Curve', 0, 100, 40, { unit: '%' })],
    variants: [['Mossy falls', { pal: 'stone', moss: 50 }], ['Canyon fall', { pal: 'sandrock', ledges: 4, curve: 70 }], ['Tall fall', { pal: 'mountain', h: 64, fallW: 3 }]],
    make(p) {
      const W = rx(p), Dz = rz(p), seed = p.seed | 0, fw = p.fallW;
      const front = (x, y) => -Dz * 0.3 + (x * x) / (W * W) * Dz * 1.4 * (p.curve / 100) + (fbm(x * 0.12, y * 0.12, 0, seed) - 0.5) * 3 + (p.ledges ? Math.sin((y / p.h) * Math.PI * p.ledges) * 1.2 : 0);
      const f = (x, y, z) => Math.max(front(x, y) - z, z - Dz, Math.abs(x) - W, y - p.h, -y);
      const poolR = Math.max(2, (W * 0.5) * p.pool / 100);
      const floor = (x, y, z) => Math.max(y - 1, Math.abs(x) - W, Math.abs(z + Dz * 0.3) - Dz * 1.6);
      const fluid = { id: 'water', at: (x, y, z) => {
        const fz = front(0, y);
        if (Math.abs(x) <= fw / 2 && z >= fz - 1.5 && z < fz && y >= 1 && y <= p.h) return true;   // the fall, hugging the face
        if (y >= p.h - 1 && y <= p.h && Math.abs(x) <= fw / 2 && z >= fz - 0.5 && z < Dz - 1) return true;  // the river on top
        if (y === 1 && Math.hypot(x / poolR, (z - fz + poolR * 0.8) / (poolR * 0.8)) < 1 && z < fz) return true;   // the pool
        return false;
      } };
      return { prims: [
        { f: (x, y, z) => Math.min(f(x, y, z), floor(x, y, z)), part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz * 2, W, p.h, Dz], partAt: (x, y, z) => (y < 1 ? 'base' : y > p.h - 2 ? 'trim' : 'body'),
          carve: (x, y, z) => { const fz = front(0, y); return (Math.abs(x) <= fw / 2 && y >= p.h - 1 && z >= fz - 0.5 && z < Dz - 1) || (y === 1 && Math.hypot(x / poolR, (z - fz + poolR * 0.8) / (poolR * 0.8)) < 1 && z < fz); } },
      ], fluid };
    } });
  fam({ id: 'mushroom', group: 'nature', name: 'Giant mushroom', seed: true, pals: ['redcap', 'browncap', 'glowcap'], parts: ['body', 'base', 'accent'], size: { w: [6, 96, 24], d: [6, 96, 24], h: [6, 160, 28] }, hollow: false, surface: ['moss'],
    params: [sh('capH', 'Cap height', 10, 60, 30, { unit: '%' }), sh('stem', 'Stem width', 10, 50, 22, { unit: '%' }), sh('bend', 'Bend', 0, 60, 15, { unit: '°' }), sh('spots', 'Spots', 0, 100, 45, { unit: '%' }), seg('capShape', 'Cap', 'shape', [['dome', 'Dome'], ['flat', 'Flat'], ['cone', 'Cone']], 'dome'), bool('gills', 'Gills', 'shape', true)],
    variants: [['Fly agaric', { pal: 'redcap', spots: 55 }], ['Flat brown', { pal: 'browncap', capShape: 'flat', spots: 15 }], ['Glowing warped', { pal: 'glowcap', capShape: 'cone', spots: 30 }]],
    make(p, rnd) {
      const W = rx(p), Dz = rz(p), ch = p.h * p.capH / 100, st = Math.max(1, Math.min(W, Dz) * p.stem / 100), seed = p.seed | 0;
      const bend = p.bend * RAD, bd = rnd() * Math.PI * 2;
      const stemX = (y) => Math.sin(bend) * (y * y) / (2 * p.h) * Math.cos(bd), stemZ = (y) => Math.sin(bend) * (y * y) / (2 * p.h) * Math.sin(bd);
      const top = p.h - ch, cx = stemX(top), cz = stemZ(top);
      const stem = { f: (x, y, z) => Math.max(Math.hypot(x - stemX(y), z - stemZ(y)) - st * (1 + 0.4 * Math.max(0, 1 - y / 4)), -y, y - top - 1), part: 'base', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, top + 1, Dz] };
      const capF = (x, y, z) => {
        const X = (x - cx) / W, Z = (z - cz) / Dz, Y = (y - top) / ch, r = Math.hypot(X, Z);
        let outer = p.capShape === 'cone' ? Math.max(r + Y - 1, -Y) : p.capShape === 'flat' ? Math.max(Math.hypot(r, Y * 1.6) - 1, -Y) : Math.max(Math.hypot(r, Y) - 1, -Y);
        outer *= Math.min(W, ch);
        return p.gills ? outer : outer;
      };
      const cap = { f: capF, part: 'body', grad: (x, y) => clamp((y - top) / ch, 0, 1), box: [cx - W - 1, top - 1, cz - Dz - 1, cx + W + 1, p.h + 1, cz + Dz + 1],
        partAt: (x, y, z) => { const sp = hash(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3), seed) < p.spots / 220; if (y < top + 1 && p.gills) return 'base'; return sp && vnoise(x * 0.5, y * 0.5, z * 0.5, seed) > 0.45 ? 'accent' : 'body'; } };
      return { prims: [stem, cap], hollowCap: true };
    } });

  // ---------------- shapes ----------------
  fam({ id: 'ziggurat', group: 'shapes', name: 'Ziggurat', pals: ['sandstone', 'stone', 'terracotta', 'deepslate', 'quartzstone', 'prismarine', 'blackstone'], parts: ['body', 'trim', 'accent'], size: { w: [7, 200, 41], d: [7, 200, 41], h: [3, 128, 16] }, glowDef: 'none',
    params: [sh('tiers', 'Tiers', 2, 20, 6), sh('stepIn', 'Step in', 1, 8, 3), bool('stairs', 'Stairways', 'shape', true), bool('temple', 'Temple on top', 'shape', true)],
    variants: [['Desert ziggurat', { pal: 'sandstone' }], ['Jungle temple', { pal: 'stone', moss: 45, weather: 30 }], ['Dark pyramid', { pal: 'blackstone', glow: 'edges', glowBlock: 'shroomlight' }]],
    make(p) {
      const k = p.tiers, th = Math.max(1, Math.floor(p.h / k)), prims = [];
      for (let i = 0; i < k; i++) {
        const hx = Math.max(1, rx(p) - i * p.stepIn), hz = Math.max(1, rz(p) - i * p.stepIn);
        prims.push(Object.assign(slab({ h: (i + 1) * th, hx, hz }), { part: i % 2 ? 'trim' : 'body', box: [-hx - 1, i * th, -hz - 1, hx + 1, (i + 1) * th, hz + 1] }));
      }
      // a stairway up the south face: its slope is the tiers' slope, so the detail pass turns it into stairs
      if (p.stairs) prims.push({ f: (x, y, z) => Math.max(Math.abs(x) - 2, -y, y - k * th, z - rz(p), y - (rz(p) - z) * (th / p.stepIn), -z), part: 'accent', grad: () => 0.5, box: [-3, 0, 0, 3, k * th, rz(p) + 1] });
      if (p.temple) prims.push(Object.assign(slab({ h: th * 2, hx: Math.max(1, rx(p) - k * p.stepIn) * 0.8 + 1, hz: Math.max(1, rz(p) - k * p.stepIn) * 0.8 + 1, tip: 0.3 }), { part: 'trim', box: null }));
      if (p.temple) { const t = prims[prims.length - 1], f0 = t.f, y0 = k * th; t.f = (x, y, z) => f0(x, y - y0, z); const hx = Math.max(1, rx(p) - k * p.stepIn) + 2, hz = Math.max(1, rz(p) - k * p.stepIn) + 2; t.box = [-hx, y0, -hz, hx, y0 + th * 2, hz]; }
      return { prims };
    } });
  fam({ id: 'arch', group: 'shapes', name: 'Arch and bridge', pals: ['stone', 'sandstone', 'deepslate', 'quartzstone', 'blackstone', 'tuff', 'prismarine'], parts: ['body', 'trim'], size: { w: [5, 200, 30], d: [1, 40, 5], h: [3, 120, 16] }, glowDef: 'none',
    params: [seg('archShape', 'Shape', 'shape', [['round', 'Round'], ['pointed', 'Pointed'], ['flat', 'Flat']], 'round'), sh('thickA', 'Thickness', 1, 20, 3), bool('deck', 'Bridge deck', 'shape', false), sh('piers', 'Pier width', 0, 20, 3)],
    variants: [['Roman arch', { archShape: 'round', piers: 4 }], ['Gothic arch', { archShape: 'pointed', pal: 'deepslate' }], ['Stone bridge', { deck: true, w: 48, h: 14, d: 7, pal: 'stone' }]],
    make(p) {
      const W = rx(p), t = p.thickA, H = p.h, sp = Math.max(1, W - p.piers);
      const Rp = sp * 1.6, cc = Rp - sp, apex = Math.sqrt(Rp * Rp - cc * cc), ky = apex / Math.max(1, H - t);
      const inner = (x, y) => {
        if (p.archShape === 'pointed') return Math.hypot(Math.abs(x) + cc, y * ky) < Rp;   // two arcs meeting at the top
        if (p.archShape === 'flat') return Math.abs(x) < sp && y < H - t;
        return Math.hypot(x / sp, y / Math.max(1, H - t)) < 1;
      };
      const f = (x, y, z) => { const out = Math.max(Math.abs(x) - W, y - H, -y, Math.abs(z) - rz(p)); return inner(x, y) ? Math.max(out, 0.5) : out; };
      const prims = [{ f, part: 'body', grad: (x, y) => clamp(y / H, 0, 1), box: [-W - 1, 0, -rz(p) - 1, W + 1, H + 1, rz(p) + 1], partAt: (x, y) => (y > H - 1.5 ? 'trim' : 'body') }];
      if (p.deck) prims.push({ f: (x, y, z) => Math.max(Math.abs(x) - W * 1.6, Math.abs(y - H - 0.5) - 0.5, Math.abs(z) - rz(p)), part: 'trim', grad: () => 1, box: [-W * 1.6 - 1, H - 1, -rz(p) - 1, W * 1.6 + 1, H + 1, rz(p) + 1] });
      return { prims };
    } });
  fam({ id: 'helix', group: 'shapes', name: 'Helix and stairs', pals: ['quartzstone', 'stone', 'deepslate', 'copper', 'prismarine', 'blackstone', 'amethyst'], parts: ['body', 'trim'], size: { w: [5, 120, 18], d: [5, 120, 18], h: [4, 256, 40] }, hollow: false, glowDef: 'none',
    params: [seg('kind', 'Kind', 'shape', [['stair', 'Spiral stair'], ['helix', 'Helix'], ['double', 'Double helix']], 'stair'), sh('turns', 'Turns', 1, 12, 3), sh('band', 'Band width', 1, 16, 4), sh('bandT', 'Band thickness', 1, 6, 1), bool('column', 'Centre column', 'shape', true)],
    variants: [['Spiral staircase', { kind: 'stair' }], ['DNA tower', { kind: 'double', pal: 'amethyst', glow: 'rings' }], ['Copper coil', { kind: 'helix', pal: 'copper', turns: 6 }]],
    make(p) {
      const W = rx(p), Dz = rz(p), turns = p.turns, strands = p.kind === 'double' ? 2 : 1, band = p.band, bt = p.bandT;
      const f = (x, y, z) => {
        const r = Math.hypot(x / W, z / Dz) * Math.min(W, Dz), a = Math.atan2(z / Dz, x / W);
        if (y < 0 || y > p.h) return Math.max(-y, y - p.h);
        let best = Infinity;
        for (let s = 0; s < strands; s++) {
          const ph = ((a / (Math.PI * 2) + s / strands) % 1 + 1) % 1, yy = y / p.h * turns;
          let dy = ((yy - ph) % 1 + 1) % 1; dy = Math.min(dy, 1 - dy) * (p.h / turns);
          const inR = p.kind === 'stair' ? Math.min(W, Dz) - band : Math.min(W, Dz) - band;
          best = Math.min(best, Math.max(dy - bt / 2, inR - r, r - Math.min(W, Dz)));
        }
        if (p.column) best = Math.min(best, Math.hypot(x, z) - Math.max(1, Math.min(W, Dz) * 0.15));
        return best;
      };
      return { prims: [{ f, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W - 1, 0, -Dz - 1, W + 1, p.h, Dz + 1], partAt: (x, y, z) => (Math.hypot(x, z) < Math.max(1, Math.min(W, Dz) * 0.15) + 0.5 ? 'trim' : 'body') }] };
    } });

  /* ======================================================================
   * Parameters: lists and defaults
   * ====================================================================== */
  const byId = new Map();
  FAMILIES.forEach((f) => { f.all = (f.params || []).concat(common(f)); byId.set(f.id, f); });
  const GROUPS = [['crystals', 'Crystals'], ['monoliths', 'Monoliths'], ['nature', 'Nature'], ['shapes', 'Shapes']];
  function params(id) { const f = byId.get(id); return f ? f.all : []; }
  function defaults(id) {
    const f = byId.get(id), o = {};
    if (!f) return o;
    f.all.forEach((q) => { o[q.id] = Array.isArray(q.def) ? q.def.slice() : q.def; });
    return o;
  }
  /** Values cleaned to their ranges, unknown keys dropped, missing ones from the defaults. */
  function clean(id, p) {
    const f = byId.get(id), d = defaults(id), o = {};
    if (!f) return o;
    f.all.forEach((q) => {
      let v = p && p[q.id] !== undefined ? p[q.id] : d[q.id];
      if (q.t === 'num') { v = Number(v); if (!Number.isFinite(v)) v = q.def; v = clamp(v, q.min, q.max); }
      else if (q.t === 'seg') { if (!(q.ch.some((c) => c[0] === v) || (v === 'palette' && q.def === 'palette'))) v = q.def; }
      else if (q.t === 'bool') v = !!v;
      else if (q.t === 'seed') { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 1) v = 1; }
      else if (q.t === 'kinds') v = Array.isArray(v) ? v.filter((k) => DT().KINDS.includes(k)) : [];
      else if (q.t === 'colour') v = Array.isArray(v) && v.length === 3 && v.every((c) => Number.isFinite(+c)) ? v.map((c) => clamp(+c, 0, 1)) : (q.def ? q.def.slice() : null);
      else if (q.t === 'block') v = typeof v === 'string' && C().known(v) ? v : null;
      o[q.id] = v;
    });
    return o;
  }

  /* ======================================================================
   * The pipeline
   * ====================================================================== */
  const MAX_CELLS = 16e6;
  function rampOfPart(pal, part, p) {
    const over = p['mat_' + part];
    if (over) return [over];
    const list = pal[part] || pal.body;
    return list.map(full).filter((id) => C().known(id));
  }
  function gen(id, raw) {
    const f = byId.get(id) || FAMILIES[0];
    const p = clean(f.id, raw);
    // scale every size; a giant is capped so the grid stays within memory
    const k = p.scale / 100;
    ['w', 'd', 'h'].forEach((q) => { if (p[q] != null) p[q] = Math.max(1, p[q] * k); });
    if (p.d == null) p.d = p.w;
    const rnd = rng(p.seed * 7919 + 13);
    const model = f.make(p, rnd);
    const pal = PALETTES[p.pal] || PALETTES[f.pals[0]];
    const D = DT(), core = C();
    // world <- model: the angle, about the base centre
    const G = mat({ x: p.ax, y: p.ay, z: p.az, order: p.order });
    const prims = model.prims.filter(Boolean);
    const rough = p.rough / 100, seedN = (p.seed | 0) * 31 + 5;
    // an odd width has its middle on a block, an even one between two blocks
    const SX = Math.round(p.w) % 2 ? 0.5 : 0, SZ = Math.round(p.d) % 2 ? 0.5 : 0;
    const wBox = (b) => {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) { const q = app(G, [x, y, z]); q[0] += SX; q[2] += SZ; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); } }
      return [lo, hi];
    };
    let LO = [Infinity, Infinity, Infinity], HI = [-Infinity, -Infinity, -Infinity];
    const pr = prims.map((q) => { const [lo, hi] = wBox(q.box); for (let a = 0; a < 3; a++) { LO[a] = Math.min(LO[a], lo[a]); HI[a] = Math.max(HI[a], hi[a]); } return { q, lo, hi }; });
    // roughness: the Roughness slider for everything; rocky primitives (rough: 1) are always a little rough
    const ramp = rough > 0 ? 1 + rough * 3 : 0, rockAmp = Math.max(ramp, 1.1), pad = Math.max(ramp, prims.some((q) => q.rough) ? rockAmp : 0);
    LO = LO.map((v) => Math.floor(v - 1 - pad)); HI = HI.map((v, a) => Math.ceil(v + 2 + pad + (a === 1 && f.tip ? 5 : 0)));   // room for a tip stack
    let [sx, sy, sz] = [HI[0] - LO[0], HI[1] - LO[1], HI[2] - LO[2]];
    if (sx * sy * sz > MAX_CELLS) throw Object.assign(new Error('This build is too big to generate (' + sx + ' × ' + sy + ' × ' + sz + '). Make it smaller or lower the scale.'), { user: true });
    const N = sx * sy * sz, I = (x, y, z) => (y * sz + z) * sx + x;
    const best = new Float32Array(N).fill(9), own = new Int16Array(N).fill(-1);
    const rN = (x, y, z) => (fbm(x * 0.16, y * 0.16, z * 0.16, seedN) - 0.5) * 2;
    const evalP = (q, mx, my, mz) => {
      let d = q.f(mx, my, mz);
      if (q.rough) d += rN(mx, my, mz) * rockAmp; else if (ramp) d += rN(mx, my, mz) * ramp * 0.6;
      if (q.carve && q.carve(mx, my, mz)) d = Math.max(d, 0.5);
      return d;
    };
    // 1. rasterise each primitive over its own box
    pr.forEach(({ q, lo, hi }, qi) => {
      const x0 = Math.max(0, Math.floor(lo[0] - LO[0] - 1 - pad)), x1 = Math.min(sx - 1, Math.ceil(hi[0] - LO[0] + 1 + pad));
      const y0 = Math.max(0, Math.floor(lo[1] - LO[1] - 1 - pad)), y1 = Math.min(sy - 1, Math.ceil(hi[1] - LO[1] + 1 + pad));
      const z0 = Math.max(0, Math.floor(lo[2] - LO[2] - 1 - pad)), z1 = Math.min(sz - 1, Math.ceil(hi[2] - LO[2] + 1 + pad));
      q.cell = [x0, y0, z0, x1, y1, z1];
      // a height field standing straight up: one height per column (mountains are big; the height is noise)
      if (q.height && G[0][0] === 1 && G[1][1] === 1 && G[2][2] === 1) {
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const mx = LO[0] + x + 0.5 - SX, mz = LO[2] + z + 0.5 - SZ, H = q.height(mx, mz);
          for (let y = y0; y <= y1; y++) {
            const my = LO[1] + y + 0.5, i = I(x, y, z);
            let d = my - H;
            if (d > 2.5 + rockAmp) { if (d < best[i]) { best[i] = d; own[i] = qi; } break; }
            if (ramp && Math.abs(d) < 2 + ramp) d += rN(mx, my, mz) * ramp * 0.6;
            if (q.carve && q.carve(mx, my, mz)) d = Math.max(d, 0.5);
            if (d < best[i]) { best[i] = d; own[i] = qi; }
          }
        }
        return;
      }
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const wx = LO[0] + x + 0.5 - SX, wy = LO[1] + y + 0.5, wz = LO[2] + z + 0.5 - SZ;
        const mx = G[0][0] * wx + G[1][0] * wy + G[2][0] * wz, my = G[0][1] * wx + G[1][1] * wy + G[2][1] * wz, mz = G[0][2] * wx + G[1][2] * wy + G[2][2] * wz;
        const d = evalP(q, mx, my, mz), i = I(x, y, z);
        if (d < best[i]) { best[i] = d; own[i] = qi; }
      }
    });
    // 2. which cells are filled; surface cells get their coverage for the detail pass
    const level = p.detail, allow = D.allowed(level, p.off), detail = level !== 'low';
    const cov = new Map(), state = new Uint8Array(N);   // 1 = full, 2 = partial (from coverage)
    const here = [];   // the primitives whose box holds the cell being sampled
    const inside = (wx, wy, wz) => {
      wx -= SX; wz -= SZ;
      const mx = G[0][0] * wx + G[1][0] * wy + G[2][0] * wz, my = G[0][1] * wx + G[1][1] * wy + G[2][1] * wz, mz = G[0][2] * wx + G[1][2] * wy + G[2][2] * wz;
      for (let k2 = 0; k2 < here.length; k2++) if (evalP(here[k2], mx, my, mz) <= 0) return true;
      return false;
    };
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      const d = best[i];
      if (d > 1.2) continue;
      if (!detail || d < -1.2 || (pr[own[i]].q.heightfield && d < -0.9)) { if (d <= 0) state[i] = 1; continue; }
      const cx = LO[0] + x, cy = LO[1] + y, cz = LO[2] + z;
      here.length = 0;
      for (const { q } of pr) { const c = q.cell; if (x >= c[0] && y >= c[1] && z >= c[2] && x <= c[3] && y <= c[4] && z <= c[5]) here.push(q); }
      // quick look at the 8 corners first: a cell that is all in or all out needs no 64 samples
      let ins = 0;
      for (const fy of [0.125, 0.875]) for (const fz of [0.125, 0.875]) for (const fx of [0.125, 0.875]) if (inside(cx + fx, cy + fy, cz + fz)) ins++;
      if (ins === 8 && d < -0.35) { state[i] = 1; continue; }
      if (ins === 0 && d > 0.35) continue;
      const mk = D.cover(inside, cx, cy, cz), n = D.count(mk);
      if (n === 64) state[i] = 1;
      else if (n > 0) { state[i] = 2; cov.set(i, mk); }
    }
    // 3. hollow: keep the outer `thick` layers
    if (p.hollow && f.hollow !== false) {
      const dist = new Uint8Array(N).fill(255), queue = [];
      // the outer layer = cells with an empty cell among all 26 around them, so a stepped wall stays face-connected
      // (with only the 6 face neighbours a staircase wall touches itself at the edges only)
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!state[i]) continue;
        let edge = x === 0 || y === 0 || z === 0 || x === sx - 1 || z === sz - 1 || y === sy - 1;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) if (!state[i + dx + dz * sx + dy * sx * sz]) { edge = true; break; }
        if (edge) { dist[i] = 1; queue.push(i); }
      }
      for (let qi = 0; qi < queue.length; qi++) {
        const i = queue[qi], dd = dist[i];
        if (dd >= p.thick) continue;
        for (const o of [1, -1, sx, -sx, sx * sz, -sx * sz]) { const j = i + o; if (j >= 0 && j < N && state[j] && dist[j] === 255) { dist[j] = dd + 1; queue.push(j); } }
      }
      // cells never reached are deeper than the wall: the hollow inside
      const hollowed = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (state[i] && dist[i] === 255) { state[i] = 0; hollowed[i] = 1; cov.delete(i); }
      // a part next to the hollow inside would open it: those stay full blocks
      cov.forEach((mk, i) => { for (const o of [1, -1, sx, -sx, sx * sz, -sx * sz]) { const j = i + o; if (j >= 0 && j < N && hollowed[j]) { state[i] = 1; cov.delete(i); break; } } });
    }
    const filled = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && state[I(x, y, z)] > 0;
    // 4. parts and materials, written straight into the schematic
    const s = core.create(sx, sy, sz, f.name), SB = s.blocks;
    const putId = (i, id) => { SB[i] = id ? core.pal(s, id) : 0; };
    const idAt = (i) => (SB[i] ? s.palette[SB[i]] : null);
    const ramps = {}, rampFor = (part) => ramps[part] || (ramps[part] = rampOfPart(pal, part, p));
    const glowKey = p.glowBlock === 'palette' ? pal.glow : p.glowBlock, GL = D.GLOW[glowKey] || D.GLOW.sea_lantern;
    const glowId = p.mat_glow || GL.id, edgeId = p.mat_edge || full(pal.edge || 'glass');
    const worn = (pal.worn || []).map(full), crack = pal.crack ? full(pal.crack) : null, moss = full(pal.moss || FIXED.moss);
    const gAmt = p.glowAmt / 100, wAmt = p.weather / 100, mAmt = p.moss / 100, cAmt = p.cracks / 100;
    const glowCells = [], partOf = new Uint8Array(N);
    const PARTS = ['body', 'base', 'trim', 'accent', 'edge', 'glow'];
    const modelOf = (x, y, z) => { const wx = LO[0] + x + 0.5 - SX, wy = LO[1] + y + 0.5, wz = LO[2] + z + 0.5 - SZ; return [G[0][0] * wx + G[1][0] * wy + G[2][0] * wz, G[0][1] * wx + G[1][1] * wy + G[2][1] * wz, G[0][2] * wx + G[1][2] * wy + G[2][2] * wz]; };
    const runeAt = (mx, my, mz) => {
      const gx = Math.floor((mx + mz) / 3), gy = Math.floor(my / 3), h0 = hash(gx, gy, 0, seedN);
      if (h0 > 0.25 + 0.55 * gAmt) return false;
      const lx = ((mx + mz) % 3 + 3) % 3, ly = ((my % 3) + 3) % 3, shape = Math.floor(h0 * 997) % 5;
      return [lx < 1, ly < 1, lx > 2 || ly > 2, Math.abs(lx - ly) < 0.8, lx > 1 && lx < 2][shape];
    };
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      if (!state[i]) continue;
      const q = pr[own[i]] ? pr[own[i]].q : pr[0].q, [mx, my, mz] = modelOf(x, y, z);
      let part = q.partAt ? q.partAt(mx, my, mz) : q.part || 'body';
      const exposed = !filled(x + 1, y, z) || !filled(x - 1, y, z) || !filled(x, y + 1, z) || !filled(x, y - 1, z) || !filled(x, y, z + 1) || !filled(x, y, z - 1);
      if (exposed && p.edges && q.edge && part === 'body' && q.edge(mx, my, mz)) part = 'edge';
      // glow patterns on the surface
      if (exposed && p.glow && p.glow !== 'none' && part !== 'glow') {
        let g = false;
        if (p.glow === 'edges') g = !!(q.edge && q.edge(mx, my, mz)) && hash(x, y, z, seedN) < 0.35 + 0.65 * gAmt;
        else if (p.glow === 'veins') g = Math.abs(fbm(mx * 0.09, my * 0.09, mz * 0.09, seedN + 2) - 0.5) < 0.012 + 0.04 * gAmt;
        else if (p.glow === 'rings') { const per = Math.max(3, Math.round(16 - 12 * gAmt)); g = ((Math.floor(my) % per) + per) % per === 0; }
        else if (p.glow === 'runes') g = runeAt(mx, my, mz);
        else if (p.glow === 'speckles') g = hash(x, y, z, seedN + 9) < 0.02 + 0.18 * gAmt;
        if (g) part = 'glow';
      }
      partOf[i] = PARTS.indexOf(part) + 1;
      const t = clamp(q.grad ? q.grad(mx, my, mz) : my / Math.max(1, p.h), 0, 1);
      let id;
      if (part === 'glow') { id = GL.behind && exposed ? GL.behind : glowId; glowCells.push(i); }
      else if (part === 'edge') id = edgeId;
      else if (pal.skin && pal.skin[part] && !filled(x, y + 1, z)) id = m(pal.skin[part]);   // grass on top of the dirt
      else { const r = rampFor(part); id = r[clamp(Math.round(t * (r.length - 1) + bayer(x, y, z) * 0.95), 0, r.length - 1)]; }
      // weathering, moss, cracks (surface only, never on glow or glass)
      if (exposed && part !== 'glow' && part !== 'edge') {
        if (wAmt && worn.length && fbm(mx * 0.18, my * 0.18, mz * 0.18, seedN + 4) > 1 - wAmt * 0.55) id = worn[hash(x, y, z, seedN) < 0.5 ? 0 : worn.length - 1];
        if (cAmt && Math.abs(vnoise(mx * 0.11, my * 0.07, mz * 0.11, seedN + 6) - 0.5) < 0.012 + 0.035 * cAmt) { if (cAmt > 0.6 && hash(x, y, z, seedN + 1) < (cAmt - 0.6) * 2) { state[i] = 0; continue; } if (crack) id = crack; }
        if (mAmt && (y + 1 >= sy || state[I(x, y + 1, z)] !== 1) && fbm(mx * 0.12, my * 0.05, mz * 0.12, seedN + 8) > 1 - mAmt * 0.75) id = moss;
      }
      putId(i, id);
    }
    // core glow: the glass skin over a glowing inside
    if (p.glow === 'core') {
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!state[i]) continue;
        const exposed = !filled(x + 1, y, z) || !filled(x - 1, y, z) || !filled(x, y + 1, z) || !filled(x, y - 1, z) || !filled(x, y, z + 1) || !filled(x, y, z - 1);
        if (exposed) { if (hash(x, y, z, seedN + 3) < 0.4 + 0.6 * gAmt) { putId(i, edgeId); state[i] = 1; cov.delete(i); } }
        else { putId(i, glowId); partOf[i] = 6; }
      }
    }
    // magma / lava behind glass: the glowing block goes one cell inward
    if (GL.behind) glowCells.forEach((i) => {
      const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]]) if (!filled(x + dx, y + dy, z + dz)) {
        const j = I(x - dx, y - dy, z - dz);
        if (filled(x - dx, y - dy, z - dz)) putId(j, glowId);
      }
      state[i] = 1; cov.delete(i);
    });
    // 5. the detail pass: partial blocks from the coverage
    const fallback = {};
    if (pal.partial) Object.entries(pal.partial).forEach(([kk, v]) => { if (C().known(m(v))) fallback[kk] = m(v); });
    cov.forEach((mk, i) => {
      const cur = idAt(i);
      if (!state[i] || !cur) return;
      const pt = partOf[i];
      // glow, glass edges and non-cubes keep their block when at least half the cell is inside
      if (pt === 6 || pt === 5 || core.def(cur).shape !== 'cube' || core.def(cur).cut) { if (D.count(mk) < 32) { state[i] = 0; putId(i, null); } return; }
      const c = D.choose(mk, { block: cur, allow, fallback });
      if (!c) { state[i] = 0; putId(i, null); } else putId(i, c);
    });
    for (let i = 0; i < N; i++) if (!state[i]) SB[i] = 0;
    // 6. what goes around it
    const set = (x, y, z, id) => { if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) s.blocks[I(x, y, z)] = core.pal(s, id); };
    const at = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz ? s.blocks[I(x, y, z)] : -1);
    // fluids (lava lakes, waterfalls)
    if (model.fluid) {
      const fid = m(FIXED[model.fluid.id]);
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (s.blocks[i]) continue;
        const [mx, my, mz] = modelOf(x, y, z);
        if (model.fluid.at(mx, Math.floor(my), mz)) s.blocks[i] = core.pal(s, fid);
      }
    }
    if (model.molten) {
      const r = model.molten.r;
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!s.blocks[i]) continue;
        const [mx, my, mz] = modelOf(x, y, z);
        if (Math.hypot(mx, (my - model.molten.y) * 1.4, mz) < r + 1.2 && Math.hypot(mx, (my - model.molten.y) * 1.4, mz) > r - 1 && hash(x, y, z, seedN) < 0.5) s.blocks[i] = core.pal(s, m('magma_block'));
      }
    }
    // geode: amethyst buds and clusters on the inside of the lining
    if (model.geode && model.geode.amount > 0) {
      const sizes = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'];
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (s.blocks[i] || hash(x, y, z, seedN + 21) > model.geode.amount * 0.45) continue;
        const [mx, my, mz] = modelOf(x, y, z);
        if (Math.hypot(mx / (p.w / 2), (my - p.h / 2) / (p.h / 2), mz / (p.d / 2)) > 0.97) continue;
        for (const [dx, dy, dz, dir] of [[0, -1, 0, 'up'], [0, 1, 0, 'down'], [1, 0, 0, 'west'], [-1, 0, 0, 'east'], [0, 0, 1, 'north'], [0, 0, -1, 'south']]) {
          const v = at(x + dx, y + dy, z + dz);
          if (v > 0 && /amethyst|calcite|purple|budding|prismarine|diamond|emerald|green|lime|red|crying|redstone/.test(s.palette[v])) { s.blocks[i] = core.pal(s, D.complete(m(sizes[Math.floor(hash(x, y, z, seedN + 5) * 4)]) + '[facing=' + dir + ']')); break; }
        }
      }
    }
    // moss: vines down the sides from 60%
    if (mAmt > 0.6) {
      for (let y = sy - 1; y >= 0; y--) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const v = at(x, y, z);
        if (!v || core.parse(s.palette[v]).name !== 'moss_block') continue;
        for (const [dx, dz, side] of [[1, 0, 'west'], [-1, 0, 'east'], [0, 1, 'north'], [0, -1, 'south']]) {
          if (hash(x + dx, y, z + dz, seedN + 31) > (mAmt - 0.6) * 1.6) continue;
          const len = 1 + Math.floor(hash(x, y, z + dz, seedN) * 4);
          for (let k = 0; k < len; k++) { if (at(x + dx, y - k, z + dz) !== 0 || at(x, y - k, z) <= 0) break; set(x + dx, y - k, z + dz, D.complete(m('vine') + '[' + side + '=true]')); }
        }
      }
    }
    // glow decorations (amethyst clusters, end rods, candles) on glowing surfaces, from High detail
    if ((level === 'high' || level === 'max') && GL.decor && glowCells.length && !(p.off || []).includes(/amethyst/.test(GL.decor) ? 'amethyst' : /candle/.test(GL.decor) ? 'candle' : 'rod')) {
      glowCells.forEach((i) => {
        if (hash(i, 7, 3, seedN) > 0.15 + gAmt * 0.45) return;
        const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        for (const [dx, dy, dz, dir] of [[0, 1, 0, 'up'], [1, 0, 0, 'east'], [-1, 0, 0, 'west'], [0, 0, 1, 'south'], [0, 0, -1, 'north']]) {
          if (at(x + dx, y + dy, z + dz) !== 0) continue;
          if (/candle/.test(GL.decor) && dir !== 'up') continue;
          set(x + dx, y + dy, z + dz, D.decorState(m(GL.decor.replace('minecraft:', '')), dir, 1 + (i % 4)));
          break;
        }
      });
    }
    // 7. sharp tips
    const tipStyle = p.tipStyle === 'palette' ? (pal.tip || 'needle') : p.tipStyle;
    if (f.tip && model.tips && tipStyle && tipStyle !== 'none' && level !== 'low') {
      for (const tp of model.tips) {
        const w = app(G, tp.p), dir = app(G, tp.dir);
        w[0] += SX; w[2] += SZ;
        const cx = Math.floor(w[0] - LO[0]), cz = Math.floor(w[2] - LO[2]), cy = Math.floor(w[1] - LO[1]);
        // the highest block near the apex
        let top = null;
        for (let y = Math.min(sy - 1, cy + 1); y >= Math.max(0, cy - 14) && !top; y--) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { if (at(cx + dx, y, cz + dz) > 0) { top = [cx + dx, y, cz + dz]; break; } }
        if (!top) continue;
        if (dir[1] > 0.85) {
          const blk = s.palette[at(top[0], top[1], top[2])], mat0 = core.def(blk).shape === 'cube' ? blk : rampFor('body')[rampFor('body').length - 1];
          const seq = D.tipStack(tipStyle, p.tipLen, mat0, edgeId);
          const need = seq.length - (sy - 1 - top[1]);
          if (need > 0) continue;
          seq.forEach((id2, k2) => { if (at(top[0], top[1] + 1 + k2, top[2]) === 0) set(top[0], top[1] + 1 + k2, top[2], id2); });
        } else {
          const dn = Object.entries(D.DIRS).sort((a, b) => (b[1][0] * dir[0] + b[1][1] * dir[1] + b[1][2] * dir[2]) - (a[1][0] * dir[0] + a[1][1] * dir[1] + a[1][2] * dir[2]))[0];
          const q2 = [top[0] + dn[1][0], top[1] + dn[1][1], top[2] + dn[1][2]];
          if (at(...q2) === 0) set(...q2, D.complete(tipStyle === 'crystal' ? m('amethyst_cluster') + '[facing=' + dn[0] + ']' : m('end_rod') + '[facing=' + dn[0] + ']'));
        }
      }
    }
    // 8. spawn-proof tops
    if (p.spawn) {
      for (let y = 0; y < sy - 1; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const v = at(x, y, z);
        if (v <= 0 || at(x, y + 1, z) !== 0) continue;
        const id0 = s.palette[v];
        if (core.def(id0).shape !== 'cube' || core.def(id0).cut || /water|lava|glow|lantern|froglight|magma|shroom/.test(id0)) continue;
        const sl = D.variant(id0, 'slab') || fallback.slab;
        if (sl) set(x, y + 1, z, D.complete(sl + '[type=bottom]'));
      }
    }
    // 9. light
    let out = s;
    if (p.light) {
      const SH = TH.builds.shade, L0 = SH.lightVec(p.lAz, p.lEl), L = p.lFollow ? app(G, L0) : L0;
      const rampL = p.lRamp === 'palette' ? rampFor('body').map((id2) => core.parse(id2).base) : SH.rampOf(p.lRamp);
      const only = new Set(['body', 'base', 'trim'].flatMap((pt) => rampFor(pt)).map((id2) => core.parse(id2).base).concat(worn.map((id2) => core.parse(id2).base)));
      if (p.lRamp !== 'palette') rampL.forEach((id2) => only.add(id2));
      out = SH.shade(s, { vec: L, ramp: rampL, steps: p.lSteps, contrast: p.lCon / 100, dither: p.lDither / 100, ao: p.lAo / 100, rim: p.lRim / 100, shadows: p.lShadow, only,
        colour: (p.lTint || p.lHue) ? { light: p.lColour || [1, 1, 1], shadow: p.lShadowC, tint: p.lTint / 100, hue: p.lHue / 100, pool: p.lPool } : null });
    }
    if (!f.floating) dropCrumbs(out);
    D.connect(out);
    out.name = nameFor(f, p, raw);
    const r = core.trim(out);
    r.name = out.name;
    return r;
  }
  /**
   * No floating crumbs: a piece that neither stands on the ground (y 0) nor is the biggest piece goes (lonely tip
   * cells of a leaning crystal, a cut-off corner). Generators that float by design (shards, floating monoliths) skip it.
   */
  function dropCrumbs(s) {
    const [sx, sy, sz] = s.size, B = s.blocks, N = B.length, comp = new Int32Array(N).fill(-1), info = [];
    for (let i0 = 0; i0 < N; i0++) {
      if (!B[i0] || comp[i0] >= 0) continue;
      const id = info.length, st = [i0];
      let n = 0, ground = false;
      comp[i0] = id;
      while (st.length) {
        const i = st.pop(), x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        n++; if (y === 0) ground = true;
        if (x > 0 && B[i - 1] && comp[i - 1] < 0) { comp[i - 1] = id; st.push(i - 1); }
        if (x < sx - 1 && B[i + 1] && comp[i + 1] < 0) { comp[i + 1] = id; st.push(i + 1); }
        if (z > 0 && B[i - sx] && comp[i - sx] < 0) { comp[i - sx] = id; st.push(i - sx); }
        if (z < sz - 1 && B[i + sx] && comp[i + sx] < 0) { comp[i + sx] = id; st.push(i + sx); }
        if (y > 0 && B[i - sx * sz] && comp[i - sx * sz] < 0) { comp[i - sx * sz] = id; st.push(i - sx * sz); }
        if (y < sy - 1 && B[i + sx * sz] && comp[i + sx * sz] < 0) { comp[i + sx * sz] = id; st.push(i + sx * sz); }
      }
      info.push({ n, ground });
    }
    if (info.length < 2) return s;
    let big = 0;
    info.forEach((c, k) => { if (c.n > info[big].n) big = k; });
    for (let i = 0; i < N; i++) if (B[i] && comp[i] !== big && !info[comp[i]].ground) B[i] = 0;
    return s;
  }
  function nameFor(f, p, raw) {
    const scale = (raw && raw.scale) || 100;
    return f.name + ' ' + Math.round(p.h) + (p.pal && f.pals.length > 1 ? ', ' + PALETTES[p.pal].name.toLowerCase() : '') + (scale !== 100 ? '' : '');
  }

  TH.builds.gen = { FAMILIES, GROUPS, GROUP_LABEL, PALETTES, PART_LABEL, GLOW_PATTERNS, params, defaults, clean, gen, byId: (id) => byId.get(id), rng, hash, vnoise, fbm };
})();
