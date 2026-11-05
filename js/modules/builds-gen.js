/**
 * Builds generators (pure, no DOM): crystals, monoliths, nature and more shapes, built from distance fields.
 *
 *   FAMILIES        [{ id, group, name, key (the 3-6 parameters that define it), params, variants, make }]
 *   GROUPS          Crystals, Monoliths, Nature, Shapes;  STEPS: Shape, Inside, Materials, Finish
 *   PALETTES        block palettes: per part (body, base, trim, accent) a ramp from shadow to highlight, ordered by the
 *                   real texture lightness (js/data/block-colours.js; tested), plus glass edge, glow, worn / crack / moss
 *   LOOKS           quick looks (Polished, Raw, Glowing, Frozen, Ancient) that set surface, light and glow together
 *   params(id) / defaults(id) / clean(id, p) / gen(id, p) -> Schematic (cropped)
 *
 * How a generator works: make(p, R) returns primitives { f(x, y, z) (negative inside, about a distance in blocks),
 * box [x0, y0, z0, x1, y1, z1] (model space: y up from the ground, x / z around 0), part, grad, edge (a ridge),
 * partAt, height (height fields) } and optional tips, fluids. R(key, i, j) is the Variation: a hash of the seed and
 * the FEATURE (key + index), never a running random stream, so moving a slider never re-rolls unrelated features.
 * The pipeline then
 *   1. fits the size: with no angle, the model is scaled per axis until the build is exactly Width x Height x Depth
 *      blocks (measured on the blocks whose centre is inside; up to three quick passes),
 *   2. turns it by the angle (X / Y / Z) by looking back from every world cell, rasterises each primitive over its own
 *      box (min distance wins), adds roughness noise,
 *   3. samples 64 sub-points on surface cells (the detail toolkit picks slabs, stairs, trapdoors, walls),
 *   4. Inside (builds-inside.js): solid, hollow, open or cavity, wall thickness as true distance, fill, supports,
 *   5. paints the parts, then weathering, cracks, moss, then glow: per pattern every surface block gets a score and
 *      the best `amount` share of the surface lights up (0 = none, more = always a superset, at most the cap); glow is
 *      always on the surface or right behind glass, never buried,
 *   6. tips (the top blocks of a spire become thinner parts, so the height stays), spawn-proof slabs, then the light:
 *      builds-shade.js shades every part along its own palette ramp with the shape's true surface normals, so each
 *      flat facet is one shade; ridges get a highlight. Connections are derived last.
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
  const strHash = (s) => { let h2 = 2166136261; for (let i = 0; i < s.length; i++) { h2 ^= s.charCodeAt(i); h2 = Math.imul(h2, 16777619); } return h2 | 0; };
  /** The Variation: a fixed number in 0..1 per (feature key, index) and seed. */
  const variation = (seed) => (key, i, j) => hash(i | 0, j | 0, strHash(key), seed * 7919 + 13);
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
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
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
      height: null,
    });
  }
  /**
   * Tilt by `lean` degrees toward compass azimuth `az` (0 north, 90 east), without turning the object about its own
   * axis: X tilts +y toward +z (south), so it is wrapped in a yaw of 180 + az and back.
   */
  function leanMat(lean, az) {
    if (!lean) return I3;
    const d = 180 + (az || 0), a = mat({ y: d }), b = mat({ x: lean }), c = mat({ y: -d });
    const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    return mm(c, mm(b, a));
  }
  const tipAt = (o, R, p, dir) => { const q = app(R, p); return { p: [o[0] + q[0], o[1] + q[1], o[2] + q[2]], dir: app(R, dir || [0, 1, 0]) }; };
  /** A primitive stretched by k = [kx, ky, kz] (the size fit). Distances keep about their scale. */
  function stretch(q, k) {
    if (k[0] === 1 && k[1] === 1 && k[2] === 1) return q;
    const km = Math.min(k[0], k[1], k[2]), w = (fn) => (fn ? (x, y, z) => fn(x / k[0], y / k[1], z / k[2]) : null);
    const out = Object.assign({}, q, { f: (x, y, z) => q.f(x / k[0], y / k[1], z / k[2]) * km, grad: w(q.grad), edge: w(q.edge), partAt: w(q.partAt), carve: w(q.carve),
      box: [q.box[0] * k[0], q.box[1] * k[1], q.box[2] * k[2], q.box[3] * k[0], q.box[4] * k[1], q.box[5] * k[2]] });
    if (q.height) out.height = (x, z) => q.height(x / k[0], z / k[2]) * k[1];
    return out;
  }

  /* ======================================================================
   * Distance fields
   * ====================================================================== */
  /** Regular n-gon (circumradius 1, a corner on +x when rot = 0): <= 0 inside, in units of the circumradius. */
  function ngon(n, x, z, rot) {
    const a = Math.atan2(z, x) - (rot || 0), seg = (2 * Math.PI) / n;
    const fa = (Math.floor(a / seg) + 0.5) * seg;
    return Math.hypot(x, z) * Math.cos(a - fa) - Math.cos(Math.PI / n);
  }
  function cornerAngle(n, x, z, rot) {
    const seg = (2 * Math.PI) / n, a = ((Math.atan2(z, x) - (rot || 0)) % seg + seg) % seg;
    return Math.min(a, seg - a);
  }
  const box2 = (x, z, hx, hz) => Math.max(Math.abs(x) - hx, Math.abs(z) - hz);
  function superE(x, z, hx, hz, k) {
    const u = Math.abs(x) / Math.max(0.5, hx), v = Math.abs(z) / Math.max(0.5, hz);
    return (Math.pow(Math.pow(u, k) + Math.pow(v, k), 1 / k) - 1) * Math.min(hx, hz);
  }
  /** A faceted crystal along +y from 0 to h (see the Crystal parameters). */
  function crystal(o) {
    const n = o.n || 6, h = Math.max(2, o.h), rx = Math.max(0.5, o.rx), rz = Math.max(0.5, o.rz || o.rx), sq = rx / rz;
    const tip = clamp(o.tip == null ? 0.25 : o.tip, 0.02, 0.9), sharp = o.sharp || 1, twist = (o.twist || 0) * RAD;
    const bt = o.double ? clamp(o.btip == null ? tip * 0.7 : o.btip, 0.02, 0.6) : 0;
    const y0 = bt * h, y1 = h * (1 - tip);
    const R = (y) => {
      let r = 1;
      if (y < y0) r = Math.pow(Math.max(0, y / y0), 1 / sharp);
      else if (y > y1) r = Math.pow(Math.max(0, (h - y) / (h - y1)), 1 / sharp);
      const yb = clamp((y - y0) / Math.max(1, y1 - y0), 0, 1);
      const body = 1 - (o.taper || 0) * yb + (o.bulge || 0) * Math.sin(Math.PI * yb) + (o.flare || 0) * Math.max(0, 1 - y / Math.max(2, h * 0.12)) * 0.8;
      return r * Math.max(0.05, body);
    };
    const ch = o.chamfer || 0;
    const f = (x, y, z) => {
      if (y < 0 || y > h) return Math.max(-y, y - h, f(x, clamp(y, 0, h), z)) + 0.01;   // above / below: also the distance across
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
    return { f, edge, grad: (x, y) => clamp(y / h, 0, 1), box: [-mr, 0, -mr, mr, h, mr] };
  }
  /** A rectangular block 0..h: half sizes hx, hz, taper, bulge, twist, chamfer, round, pyramidion (tip share). */
  function slab(o) {
    const h = Math.max(1, o.h), hx = Math.max(0.5, o.hx), hz = Math.max(0.5, o.hz), tip = o.tip || 0, twist = (o.twist || 0) * RAD, ch = o.chamfer || 0;
    const yb = h * (1 - tip), k = o.round || 0;
    const sc = (y) => {
      let s = 1 - (o.taper || 0) * clamp(y / yb, 0, 1) + (o.bulge || 0) * Math.sin(Math.PI * clamp(y / yb, 0, 1));
      if (y > yb) s *= Math.max(0, (h - y) / Math.max(0.5, h - yb));
      return Math.max(0.02, s);
    };
    const f = (x, y, z) => {
      if (y < 0 || y > h) return Math.max(-y, y - h, f(x, clamp(y, 0, h), z)) + 0.01;
      const s = sc(y), a = twist * (y / h), c = Math.cos(a), sn = Math.sin(a);
      const X = x * c + z * sn, Z = -x * sn + z * c, ax = hx * s, az = hz * s;
      let d = k ? superE(X, Z, ax, az, 2 + 6 * (1 - k)) : box2(X, Z, ax, az);
      if (ch) d = Math.max(d, (Math.abs(X) + Math.abs(Z) - (ax + az) + ch * Math.min(ax, az) * 1.2) * 0.7071);
      return d;
    };
    const edge = (x, y, z) => { const s = sc(y); return Math.abs(Math.abs(x) - hx * s) < 0.9 && Math.abs(Math.abs(z) - hz * s) < 0.9; };
    const m = Math.max(hx, hz) * (1 + Math.max(0, o.bulge || 0)) * 1.42 + 1;
    return { f, edge, grad: (x, y) => clamp(y / h, 0, 1), box: [-m, 0, -m, m, h, m] };
  }
  function ellipsoid(o) {
    const rx = Math.max(0.5, o.rx), ry = Math.max(0.5, o.ry), rz = Math.max(0.5, o.rz), m = Math.min(rx, ry, rz);
    const f = (x, y, z) => (Math.hypot(x / rx, y / ry, z / rz) - 1) * m;
    return { f, grad: (x, y) => clamp(0.5 + y / (2 * ry), 0, 1), box: [-rx - 1, -ry - 1, -rz - 1, rx + 1, ry + 1, rz + 1] };
  }
  /** Convex jagged polytope: k planes around an ellipsoid (radii a, b, c), each cut in by up to `jag`; v(i) = 0..1 per plane. */
  function jagged(o, v) {
    const planes = [];
    const k = o.k || 14, jag = o.jag == null ? 0.25 : o.jag, [a, b, c] = o.r;
    for (let i = 0; i < k; i++) {
      const u = v(i, 0) * 2 - 1, th = v(i, 1) * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const nrm = [s * Math.cos(th), u, s * Math.sin(th)];
      planes.push([nrm, Math.hypot(nrm[0] * a, nrm[1] * b, nrm[2] * c) * (1 - jag * v(i, 2))]);
    }
    for (const sg of [1, -1]) for (let i = 0; i < 4; i++) {
      const th = (i / 4) * Math.PI * 2 + v(100 + i + (sg > 0 ? 0 : 10), 0) * 0.8, tilt = 0.25 + v(100 + i + (sg > 0 ? 0 : 10), 1) * 0.25;
      const nrm = [Math.cos(th) * (1 - tilt), sg * tilt * 2.2, Math.sin(th) * (1 - tilt)], l = Math.hypot(...nrm), nn = nrm.map((q) => q / l);
      planes.push([nn, Math.hypot(nn[0] * a, nn[1] * b, nn[2] * c) * (0.82 + 0.12 * v(100 + i + (sg > 0 ? 0 : 10), 2))]);
    }
    const f = (x, y, z) => { let d = -Infinity; for (const [n, dd] of planes) { const q = n[0] * x + n[1] * y + n[2] * z - dd; if (q > d) d = q; } return d; };
    const edge = (x, y, z) => { let a1 = -Infinity, a2 = -Infinity; for (const [n, dd] of planes) { const q = n[0] * x + n[1] * y + n[2] * z - dd; if (q > a1) { a2 = a1; a1 = q; } else if (q > a2) a2 = q; } return a1 - a2 < 0.55; };
    return { f, edge, grad: (x, y) => clamp(0.5 + y / (2 * b), 0, 1), box: [-a - 1, -b - 1, -c - 1, a + 1, b + 1, c + 1] };
  }

  /* ======================================================================
   * Palettes: every list runs from shadow to highlight (texture lightness, tested), one material family each
   * ====================================================================== */
  const m = (n) => 'minecraft:' + n;
  const PALETTES = {
    // crystals: dark, mid, light, glint
    amethyst: { name: 'Amethyst', look: 'Deep violet to soft lilac', body: ['purple_concrete', 'purple_wool', 'amethyst_block', 'purpur_block'], base: ['smooth_basalt', 'tuff', 'calcite'], trim: ['calcite'], accent: ['budding_amethyst'], edge: 'purple_stained_glass', glow: 'froglight', worn: ['purple_terracotta'], partial: { stairs: 'purpur_stairs', slab: 'purpur_slab', wall: 'end_stone_brick_wall', pane: 'purple_stained_glass_pane' }, tip: 'crystal' },
    quartz: { name: 'Quartz', look: 'Grey shadow to white', body: ['light_gray_concrete', 'polished_diorite', 'calcite', 'quartz_block'], base: ['polished_andesite', 'diorite'], trim: ['chiseled_quartz_block'], accent: ['quartz_bricks'], edge: 'white_stained_glass', glow: 'froglight', worn: ['diorite'], partial: { stairs: 'quartz_stairs', slab: 'quartz_slab', wall: 'diorite_wall', pane: 'white_stained_glass_pane' }, tip: 'needle' },
    diamond: { name: 'Diamond', look: 'Teal shadow to bright cyan', body: ['cyan_terracotta', 'cyan_concrete', 'prismarine_bricks', 'diamond_block'], base: ['dark_prismarine', 'prismarine'], trim: ['sea_lantern'], accent: ['prismarine_bricks'], edge: 'cyan_stained_glass', glow: 'sea_lantern', worn: ['prismarine'], partial: { stairs: 'prismarine_brick_stairs', slab: 'prismarine_brick_slab', wall: 'prismarine_wall', pane: 'cyan_stained_glass_pane' }, tip: 'needle' },
    ice: { name: 'Ice', look: 'Blue shadow to snow white', body: ['light_blue_concrete', 'blue_ice', 'packed_ice', 'snow_block'], base: ['packed_ice', 'snow_block'], trim: ['snow_block'], accent: ['blue_ice'], edge: 'light_blue_stained_glass', glow: 'sea_lantern', worn: ['packed_ice'], partial: { stairs: 'diorite_stairs', slab: 'diorite_slab', wall: 'diorite_wall', pane: 'light_blue_stained_glass_pane' }, tip: 'needle' },
    emerald: { name: 'Emerald', look: 'Forest green to bright lime', body: ['green_concrete', 'green_wool', 'lime_concrete', 'lime_wool', 'emerald_block'], base: ['moss_block', 'mossy_cobblestone'], trim: ['lime_terracotta'], accent: ['emerald_block'], edge: 'lime_stained_glass', glow: 'verdant', worn: ['green_terracotta'], partial: { stairs: 'mossy_cobblestone_stairs', slab: 'mossy_cobblestone_slab', wall: 'mossy_cobblestone_wall', pane: 'lime_stained_glass_pane' }, tip: 'crystal' },
    ruby: { name: 'Ruby', look: 'Near black to strong red', body: ['red_nether_bricks', 'red_concrete', 'red_wool', 'redstone_block'], base: ['blackstone', 'polished_blackstone'], trim: ['red_terracotta'], accent: ['redstone_block'], edge: 'red_stained_glass', glow: 'shroomlight', worn: ['red_terracotta'], partial: { stairs: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', wall: 'red_nether_brick_wall', pane: 'red_stained_glass_pane' }, tip: 'needle' },
    sapphire: { name: 'Sapphire', look: 'Navy to ice blue', body: ['blue_concrete', 'lapis_block', 'light_blue_concrete', 'blue_ice'], base: ['cobbled_deepslate', 'tuff'], trim: ['blue_ice'], accent: ['lapis_block'], edge: 'blue_stained_glass', glow: 'sea_lantern', worn: ['blue_terracotta'], partial: { stairs: 'cobbled_deepslate_stairs', slab: 'cobbled_deepslate_slab', wall: 'cobbled_deepslate_wall', pane: 'blue_stained_glass_pane' }, tip: 'needle' },
    end: { name: 'End crystal', look: 'Dusky purple to pale purpur', body: ['purple_terracotta', 'magenta_terracotta', 'purpur_block', 'purpur_pillar'], base: ['end_stone_bricks', 'end_stone'], trim: ['purpur_pillar'], accent: ['purpur_block'], edge: 'magenta_stained_glass', glow: 'end_rod', worn: ['end_stone'], partial: { stairs: 'purpur_stairs', slab: 'purpur_slab', wall: 'end_stone_brick_wall', pane: 'magenta_stained_glass_pane' }, tip: 'needle' },
    nether: { name: 'Nether', look: 'Charred red to glowing orange', body: ['nether_bricks', 'red_nether_bricks', 'netherrack', 'magma_block'], base: ['blackstone', 'basalt'], trim: ['shroomlight'], accent: ['magma_block'], edge: 'orange_stained_glass', glow: 'shroomlight', worn: ['netherrack'], partial: { stairs: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', wall: 'red_nether_brick_wall', pane: 'orange_stained_glass_pane' }, tip: 'needle' },
    // stone styles
    // stone styles: smooth, low-noise blocks in one family, so a lit face reads as one tone and the shading as bands
    deepslate: { name: 'Slate', look: 'Dark polished slate', body: ['deepslate_tiles', 'polished_deepslate', 'polished_tuff', 'polished_andesite'], base: ['deepslate_bricks', 'cobbled_deepslate'], trim: ['chiseled_deepslate'], accent: ['polished_blackstone'], edge: 'tinted_glass', glow: 'sea_lantern', worn: ['cracked_deepslate_tiles'], crack: 'cracked_deepslate_tiles', mossy: 'mossy_cobblestone' },
    blackstone: { name: 'Blackstone', look: 'Black with gold flecks', body: ['blackstone', 'polished_blackstone_bricks', 'polished_blackstone', 'polished_deepslate'], base: ['cobbled_deepslate'], trim: ['chiseled_polished_blackstone'], accent: ['gilded_blackstone'], edge: 'tinted_glass', glow: 'shroomlight', worn: ['cracked_polished_blackstone_bricks'], crack: 'cracked_polished_blackstone_bricks' },
    basalt: { name: 'Basalt', look: 'Dark grey columns', body: ['polished_blackstone', 'smooth_basalt', 'polished_basalt', 'polished_tuff'], base: ['blackstone'], trim: ['basalt'], accent: ['magma_block'], edge: 'tinted_glass', glow: 'magma', worn: ['blackstone'], crack: 'magma_block' },
    tuff: { name: 'Tuff', look: 'Warm grey tuff', body: ['polished_deepslate', 'tuff_bricks', 'polished_tuff', 'polished_andesite'], base: ['tuff'], trim: ['chiseled_tuff_bricks'], accent: ['chiseled_tuff'], edge: 'glass', glow: 'copper_bulb', worn: ['cobblestone'], crack: 'cobblestone', mossy: 'mossy_cobblestone' },
    stone: { name: 'Stone bricks', look: 'Grey bricks', body: ['deepslate_bricks', 'tuff_bricks', 'stone_bricks', 'smooth_stone'], base: ['cobbled_deepslate', 'cobblestone'], trim: ['stone', 'polished_andesite'], accent: ['chiseled_stone_bricks'], edge: 'glass', glow: 'glowstone', worn: ['cracked_stone_bricks'], crack: 'cracked_stone_bricks', mossy: 'mossy_stone_bricks' },
    greystone: { name: 'Grey stone', look: 'Smooth natural grey', body: ['polished_deepslate', 'stone', 'polished_andesite', 'smooth_stone'], base: ['cobbled_deepslate', 'cobblestone'], trim: ['stone_bricks'], accent: ['polished_deepslate'], edge: 'glass', glow: 'glowstone', worn: ['andesite', 'cobblestone'], crack: 'gravel', mossy: 'mossy_cobblestone' },
    rockstone: { name: 'Fieldstone', look: 'Natural grey rock', body: ['deepslate', 'stone', 'andesite'], base: ['cobbled_deepslate', 'cobblestone'], trim: ['granite', 'polished_granite'], accent: ['blackstone', 'polished_blackstone'], edge: 'glass', glow: 'glowstone', worn: ['gravel'], crack: 'gravel', mossy: 'mossy_cobblestone' },
    obsidian: { name: 'Obsidian', look: 'Black, glossy', body: ['black_concrete', 'obsidian', 'polished_blackstone'], base: ['blackstone', 'polished_blackstone_bricks'], trim: ['chiseled_polished_blackstone'], accent: ['crying_obsidian'], edge: 'tinted_glass', glow: 'crying', worn: ['blackstone'], crack: 'crying_obsidian' },
    copper: { name: 'Oxidised copper', look: 'Verdigris teal', body: ['weathered_cut_copper', 'oxidized_cut_copper', 'oxidized_copper'], base: ['weathered_copper'], trim: ['oxidized_chiseled_copper'], accent: ['cut_copper'], edge: 'glass', glow: 'copper_bulb', worn: ['exposed_cut_copper'], crack: 'oxidized_copper_grate' },
    endstone: { name: 'End stone', look: 'Pale yellow stone', body: ['sandstone', 'end_stone', 'end_stone_bricks'], base: ['purpur_block'], trim: ['purpur_pillar'], accent: ['obsidian'], edge: 'magenta_stained_glass', glow: 'end_rod', worn: ['end_stone'], crack: 'end_stone' },
    prismarine: { name: 'Prismarine', look: 'Sea green to aqua', body: ['dark_prismarine', 'prismarine', 'prismarine_bricks'], base: ['cyan_terracotta'], trim: ['dark_prismarine'], accent: ['warped_wart_block'], edge: 'cyan_stained_glass', glow: 'sea_lantern', worn: ['prismarine'], crack: 'prismarine' },
    sandstone: { name: 'Sandstone', look: 'Desert sand', body: ['sandstone', 'cut_sandstone', 'smooth_sandstone'], base: ['yellow_terracotta'], trim: ['chiseled_sandstone'], accent: ['gold_block'], edge: 'yellow_stained_glass', glow: 'shroomlight', worn: ['sandstone'], crack: 'smooth_sandstone' },
    terracotta: { name: 'Canyon', look: 'Brown terracotta, red and orange bands', body: ['brown_terracotta', 'terracotta', 'light_gray_terracotta'], base: ['gray_terracotta'], trim: ['red_terracotta', 'orange_terracotta'], accent: ['black_terracotta'], edge: 'orange_stained_glass', glow: 'ochre', worn: ['light_gray_terracotta'], crack: 'red_sand' },
    quartzstone: { name: 'Marble', look: 'White quartz', body: ['smooth_stone', 'white_concrete', 'calcite', 'smooth_quartz'], base: ['quartz_pillar'], trim: ['chiseled_quartz_block'], accent: ['gold_block'], edge: 'white_stained_glass', glow: 'froglight', worn: ['diorite'], crack: 'calcite' },
    snow: { name: 'Snow', look: 'Calcite shadow to snow white', body: ['calcite', 'white_wool', 'snow_block'], base: ['packed_ice'], trim: ['packed_ice'], accent: ['blue_ice'], edge: 'light_blue_stained_glass', glow: 'sea_lantern', worn: ['powder_snow'], crack: 'packed_ice' },
    // nature
    mountain: { name: 'Mountain', look: 'Grey rock, grass, snow', body: ['deepslate', 'tuff', 'stone', 'andesite'], base: ['coarse_dirt', 'dirt'], skin: { base: 'grass_block[snowy=false]' }, trim: ['snow_block'], accent: ['gravel'], edge: 'packed_ice', glow: 'glowstone', worn: ['gravel'], crack: 'cobblestone', mossy: 'mossy_cobblestone' },
    volcano: { name: 'Volcano', look: 'Black rock, ash and magma', body: ['blackstone', 'smooth_basalt', 'basalt', 'polished_basalt'], base: ['cobbled_deepslate', 'tuff'], trim: ['magma_block'], accent: ['black_concrete', 'polished_blackstone'], edge: 'orange_stained_glass', glow: 'magma', worn: ['gravel'], crack: 'magma_block' },
    redcap: { name: 'Red cap', look: 'Red cap, white stem', body: ['red_concrete', 'red_wool', 'red_mushroom_block'], base: ['white_terracotta', 'mushroom_stem', 'white_wool'], trim: ['smooth_sandstone'], accent: ['white_concrete'], edge: 'glass', glow: 'shroomlight', worn: ['red_terracotta'] },
    browncap: { name: 'Brown cap', look: 'Brown cap, white stem', body: ['brown_concrete', 'brown_wool', 'brown_mushroom_block'], base: ['white_terracotta', 'mushroom_stem', 'white_wool'], trim: ['smooth_sandstone'], accent: ['calcite'], edge: 'glass', glow: 'shroomlight', worn: ['brown_terracotta'] },
    glowcap: { name: 'Warped cap', look: 'Teal cap, dark stem', body: ['cyan_terracotta', 'warped_wart_block', 'prismarine'], base: ['warped_stem'], trim: ['warped_hyphae'], accent: ['shroomlight'], edge: 'cyan_stained_glass', glow: 'shroomlight', worn: ['warped_nylium'] },
    sandrock: { name: 'Red rock', look: 'Orange to red sandstone', body: ['brown_terracotta', 'orange_terracotta', 'smooth_red_sandstone', 'cut_red_sandstone'], base: ['coarse_dirt'], trim: ['terracotta'], accent: ['red_terracotta'], edge: 'orange_stained_glass', glow: 'ochre', worn: ['red_sand'], crack: 'red_sand' },
  };
  const FIXED = { moss: 'moss_block', water: 'water[level=0]', lava: 'lava[level=0]' };
  const AXIS_BLOCK = /(_log|_wood|_stem|_hyphae|basalt|_pillar|^deepslate$|bamboo_block|hay_block|bone_block|froglight|muddy_mangrove_roots)$/;
  const full = (n) => { const id = n.startsWith('minecraft:') ? n : m(n); return AXIS_BLOCK.test(C().parse(id).name) && !C().parse(id).props.axis ? id + '[axis=y]' : id; };

  /* ======================================================================
   * Parameters
   * ====================================================================== */
  const num = (id, label, g, min, max, def, o) => Object.assign({ id, label, g, t: 'num', min, max, def, step: 1 }, o);
  const seg = (id, label, g, ch, def, o) => Object.assign({ id, label, g, t: 'seg', ch, def }, o);
  const bool = (id, label, g, def, o) => Object.assign({ id, label, g, t: 'bool', def: !!def }, o);
  const STEPS = [['shape', 'Shape'], ['inside', 'Inside'], ['materials', 'Materials'], ['finish', 'Finish']];
  const GLOW_PATTERNS = [['none', 'None', 'No glow'], ['edges', 'Edges', 'Along the ridges where two faces meet'], ['veins', 'Veins', 'Thin wandering lines over the surface'], ['core', 'Core', 'Glass windows over a glowing inside'], ['rings', 'Rings', 'Bands at even heights'], ['runes', 'Runes', 'Small glyph marks on the faces'], ['speckles', 'Speckles', 'Single lights scattered with space between them']];
  /** The share of the surface a pattern may light at 100 % (the cap). */
  const GLOW_CAP = { edges: 0.6, veins: 0.25, core: 0.3, rings: 0.3, runes: 0.25, speckles: 0.12 };
  const LOOKS = [
    ['polished', 'Polished', 'Clean faces, crisp light, no weathering', { rough: 0, weather: 0, moss: 0, cracks: 0, light: true, lCon: 110, lDither: 25, glow: 'none', detail: 'high' }],
    ['raw', 'Raw', 'Rough natural surface, strong light', { rough: 45, weather: 15, moss: 0, cracks: 15, light: true, lCon: 130, lDither: 55, glow: 'none', detail: 'medium' }],
    ['glowing', 'Glowing', 'Lit from within along the ridges', { rough: 0, weather: 0, moss: 0, cracks: 0, light: true, lCon: 90, lDither: 30, glow: 'edges', glowAmt: 60, detail: 'high' }],
    ['frozen', 'Frozen', 'Cold light, frosted ice palette where there is one', { rough: 10, weather: 0, moss: 0, cracks: 0, light: true, lCon: 100, lDither: 40, lColour: [0.62, 0.74, 1], lTint: 35, glow: 'none', pal: 'ice' }],
    ['ancient', 'Ancient', 'Weathered, cracked and mossy', { rough: 20, weather: 45, moss: 35, cracks: 40, light: true, lCon: 115, lDither: 50, glow: 'none', detail: 'medium' }],
  ];
  /** The parameters every generator shares (appended after its own). step = where it lives; more = behind "More". */
  function common(f) {
    const out = [], sz = f.size || {};
    out.push(num('w', 'Width', 'shape', sz.w ? sz.w[0] : 2, sz.w ? sz.w[1] : 128, sz.w ? sz.w[2] : 16, { dim: true, unit: 'blocks', tip: 'Exactly this many blocks from west to east' }));
    if (!sz.noD) out.push(num('d', 'Depth', 'shape', sz.d ? sz.d[0] : 2, sz.d ? sz.d[1] : 128, sz.d ? sz.d[2] : 16, { dim: true, unit: 'blocks', tip: 'Exactly this many blocks from north to south' }));
    out.push(num('h', 'Height', 'shape', sz.h ? sz.h[0] : 4, sz.h ? sz.h[1] : 256, sz.h ? sz.h[2] : 32, { dim: true, unit: 'blocks', tip: 'Exactly this many blocks tall' }));
    if (f.seed) out.push({ id: 'seed', label: 'Variation', g: 'shape', t: 'seed', def: 1, tip: 'Another number gives another arrangement with the same settings' });
    out.push(num('scale', 'Scale', 'shape', 25, 400, 100, { unit: '%', step: 5, more: true, tip: 'Multiplies width, depth and height at once' }));
    out.push(seg('inside', 'Inside', 'inside', TH.builds.inside.MODES, 'solid'));
    out.push(num('wall', 'Wall', 'inside', 1, 16, 2, { unit: 'blocks', tip: 'Thickness of the shell, measured straight in from the surface (slanted faces too)', when: (p) => p.inside !== 'solid' }));
    out.push(seg('fill', 'Fill with', 'inside', TH.builds.inside.FILLS, 'air', { when: (p) => p.inside !== 'solid' }));
    out.push(seg('support', 'Supports', 'inside', TH.builds.inside.SUPPORTS, 'none', { when: (p) => p.inside !== 'solid' }));
    out.push(seg('pal', 'Palette', 'materials', f.pals.map((k) => [k, PALETTES[k].name]), f.pals[0], { palette: true }));
    (f.parts || ['body']).forEach((pt) => out.push({ id: 'mat_' + pt, label: PART_LABEL[pt] || pt, g: 'materials', t: 'block', def: null, part: pt, more: true }));
    out.push(bool('edges', 'Glass edges', 'materials', false, { more: true, tip: 'The ridges in the palette’s glass' }));
    out.push({ id: 'look', label: 'Look', g: 'finish', t: 'look' });
    out.push(bool('light', 'Light', 'finish', true, { tip: 'Shade every face by the light direction' }));
    out.push(num('lAz', 'Light from', 'finish', 0, 359, 225, { unit: '°', light: true }));
    out.push(num('lEl', 'Light height', 'finish', -90, 90, 45, { unit: '°', light: true }));
    out.push(num('lCon', 'Strength', 'finish', 0, 200, 100, { unit: '%', light: true, tip: '0 = flat, no shading · 100 = the whole ramp from shadow to highlight · more = harder' }));
    out.push(num('lSteps', 'Shades', 'finish', 2, 9, 9, { light: true, more: true, tip: 'How many blocks of the ramp are used (at most the ramp’s length)' }));
    out.push(num('lDither', 'Blend', 'finish', 0, 100, 35, { unit: '%', light: true, more: true, tip: '0 = clean bands between the shades · more = a fine mix at the borders' }));
    out.push(num('lAo', 'Corners darker', 'finish', 0, 100, 40, { unit: '%', light: true, more: true, tip: 'Blocks in corners and crevices get darker (ambient occlusion)' }));
    out.push(num('lRim', 'Edge light', 'finish', 0, 100, 0, { unit: '%', light: true, more: true, tip: 'A bright line where the lit side turns away from the light' }));
    out.push(bool('lShadow', 'Cast shadows', 'finish', false, { light: true, more: true }));
    out.push(bool('lFollow', 'Light turns with the angle', 'finish', false, { light: true, more: true }));
    out.push({ id: 'lColour', label: 'Light colour', g: 'finish', t: 'colour', def: [1, 1, 1], light: true, more: true });
    out.push({ id: 'lShadowC', label: 'Shadow colour', g: 'finish', t: 'colour', def: null, optional: true, light: true, more: true });
    out.push(num('lTint', 'Tint', 'finish', 0, 100, 0, { unit: '%', light: true, more: true, tip: '0 = the palette as it is · more = blocks picked by colour toward the light colour' }));
    out.push(num('lHue', 'Warm and cool', 'finish', 0, 100, 0, { unit: '%', light: true, more: true, tip: 'Shadows drift cooler, highlights warmer' }));
    out.push(seg('lPool', 'Pick tint blocks from', 'finish', TH.builds.shade.POOLS.filter((x) => x[0] !== 'custom'), 'all', { light: true, more: true }));
    if (f.glow !== false) {
      out.push(seg('glow', 'Glow', 'finish', GLOW_PATTERNS, f.glowDef || 'none'));
      out.push(num('glowAmt', 'Glow amount', 'finish', 0, 100, 50, { unit: '%', tip: '0 = none · 100 = the most this pattern allows (speckles 12 %, veins 25 % of the surface)', when: (p) => p.glow !== 'none' }));
      out.push(seg('glowBlock', 'Glow block', 'finish', [['palette', 'Palette']].concat(Object.keys(DT().GLOW).map((k) => [k, DT().GLOW[k].name, 'Light level ' + DT().GLOW[k].light])), 'palette', { more: true, when: (p) => p.glow !== 'none' }));
    }
    out.push(seg('detail', 'Detail', 'finish', [['low', 'Blocks', 'Full blocks only'], ['medium', 'Smooth', 'Stairs and slabs on slopes'], ['high', 'Fine', 'Adds walls, trapdoors, panes, bars'], ['max', 'Finest', 'Everything: snow layers, carpets, dripstone, end rods, amethyst']], 'medium'));
    out.push({ id: 'off', label: 'Leave out', g: 'finish', t: 'kinds', def: [], more: true });
    if (f.tip) { out.push(seg('tipStyle', 'Tip', 'finish', [['palette', 'Palette']].concat(DT().TIP_STYLES.map(([k, l, t]) => [k, l, t])), 'palette', { more: true })); out.push(num('tipLen', 'Tip parts', 'finish', 1, 4, 3, { more: true })); }
    out.push(num('rough', 'Roughness', 'finish', 0, 100, f.roughDef || 0, { unit: '%', more: true, tip: 'Noise on the surface: 0 = clean faces' }));
    out.push(num('weather', 'Weathering', 'finish', 0, 100, 0, { unit: '%', more: true, tip: 'Worn blocks in patches' }));
    out.push(num('moss', 'Moss', 'finish', 0, 100, 0, { unit: '%', more: true, tip: 'Moss on top, vines down the sides from 60 %' }));
    out.push(num('cracks', 'Cracks', 'finish', 0, 100, 0, { unit: '%', more: true, tip: 'Cracked lines; deep cracks from 60 %' }));
    out.push(bool('spawn', 'Spawn-proof tops', 'finish', false, { more: true, tip: 'Open top blocks outside become bottom slabs, so mobs cannot spawn on them' }));
    out.push(num('ax', 'X', 'finish', -180, 180, 0, { step: 0.5, unit: '°', angle: true, more: true }));
    out.push(num('ay', 'Y', 'finish', -180, 180, 0, { step: 0.5, unit: '°', angle: true, more: true }));
    out.push(num('az', 'Z', 'finish', -180, 180, 0, { step: 0.5, unit: '°', angle: true, more: true }));
    out.push(seg('order', 'Order', 'finish', TH.builds.rotate.ORDERS.map((o) => [o, o.split('').join(' ')]), 'YXZ', { angle: true, more: true }));
    return out;
  }
  const PART_LABEL = { body: 'Body', base: 'Base', trim: 'Trim', accent: 'Accent', edge: 'Edges', glow: 'Glow' };
  const GROUP_LABEL = { shape: 'Shape', inside: 'Inside', materials: 'Materials', finish: 'Finish' };

  /* ======================================================================
   * Families
   * ====================================================================== */
  const FAMILIES = [];
  const fam = (o) => { FAMILIES.push(o); return o; };
  const FACETS = [[3, '3'], [4, '4'], [5, '5'], [6, '6'], [8, '8']];
  const CRYS = ['amethyst', 'quartz', 'diamond', 'ice', 'emerald', 'ruby', 'sapphire', 'end', 'nether'];
  const STONES = ['deepslate', 'blackstone', 'basalt', 'tuff', 'stone', 'obsidian', 'copper', 'endstone', 'prismarine', 'sandstone', 'terracotta', 'quartzstone'];
  const OLD = ['rockstone'].concat(STONES, ['sandrock']);
  const rx = (p) => p.w / 2, rz = (p) => (p.d || p.w) / 2;
  const sh = (id, label, min, max, def, o) => num(id, label, 'shape', min, max, def, o);

  // ---------------- crystals ----------------
  fam({
    id: 'crystal', group: 'crystals', name: 'Crystal', tip: true, pals: CRYS, parts: ['body', 'base'], size: { w: [2, 96, 11], d: [2, 96, 11], h: [6, 256, 48] }, key: ['facets', 'taper', 'tip', 'lean'],
    params: [sh('facets', 'Faces', 3, 8, 6, { t: 'seg', ch: FACETS, tip: 'How many flat faces go round it' }), sh('taper', 'Taper', 0, 90, 15, { unit: '%', tip: 'How much narrower the top of the body is than the bottom' }), sh('tip', 'Point length', 5, 70, 25, { unit: '% of height', tip: 'How much of the height is the pointed end' }), sh('lean', 'Lean', 0, 60, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 45, { unit: '°', tip: '0 = north, 90 = east' }), sh('sharp', 'Point curve', 50, 250, 100, { unit: '%', tip: 'Below 100 the point bulges, above it narrows fast' }), sh('bulge', 'Belly', -50, 50, 0, { unit: '%', tip: 'Wider in the middle (or a waist below 0)' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), sh('flare', 'Foot', 0, 100, 0, { unit: '%', tip: 'A wider foot at the ground' }), sh('chamfer', 'Bevel', 0, 100, 0, { unit: '%', tip: 'Cuts the corners between the faces' }), seg('base', 'Base', 'shape', [['none', 'None'], ['rock', 'Rock']], 'none')],
    variants: [['Amethyst point', { pal: 'amethyst', facets: 6 }], ['Ice needle', { pal: 'ice', facets: 4, taper: 40, tip: 45, sharp: 180, w: 7, d: 7, h: 64 }], ['Twisted ruby', { pal: 'ruby', facets: 5, twist: 180, tip: 30 }], ['Leaning emerald', { pal: 'emerald', lean: 25, base: 'rock' }], ['Sapphire obelisk', { pal: 'sapphire', facets: 8, chamfer: 40, taper: 25, tip: 15 }]],
    make(p) {
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, bulge: p.bulge / 100, tip: p.tip / 100, sharp: p.sharp / 100, twist: p.twist, flare: p.flare / 100, chamfer: p.chamfer / 100 }), { part: 'body' });
      const R = leanMat(p.lean, p.leanDir), prims = [place(c, [0, 0, 0], R)];
      if (p.base === 'rock') prims.push(Object.assign(ellipsoid({ rx: rx(p) * 1.2, ry: Math.max(2, p.h * 0.06), rz: rz(p) * 1.2 }), { part: 'base' }));
      return { prims, tips: [tipAt([0, 0, 0], R, [0, p.h, 0])] };
    },
  });
  fam({
    id: 'quartz2', group: 'crystals', name: 'Double point', tip: true, pals: CRYS, parts: ['body'], size: { w: [2, 80, 9], d: [2, 80, 9], h: [6, 256, 40] }, key: ['facets', 'tip', 'btip', 'lean'],
    params: [sh('facets', 'Faces', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('tip', 'Top point', 5, 50, 22, { unit: '% of height' }), sh('btip', 'Bottom point', 5, 50, 18, { unit: '% of height' }), sh('lean', 'Lean', 0, 60, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 30, { unit: '°' }), sh('sharp', 'Point curve', 50, 250, 100, { unit: '%' }), sh('bulge', 'Belly', -40, 50, 0, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' })],
    variants: [['Clear quartz', { pal: 'quartz' }], ['Herkimer diamond', { pal: 'diamond', h: 28, w: 13, d: 13, tip: 30, btip: 30 }], ['Amethyst wand', { pal: 'amethyst', h: 60, w: 7, d: 7 }]],
    make(p) {
      const c = Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), tip: p.tip / 100, btip: p.btip / 100, double: true, sharp: p.sharp / 100, bulge: p.bulge / 100, twist: p.twist }), { part: 'body' });
      const R = leanMat(p.lean, p.leanDir);
      return { prims: [place(c, [0, 0, 0], R)], tips: [tipAt([0, 0, 0], R, [0, p.h, 0])] };
    },
  });
  fam({
    id: 'cluster', group: 'crystals', name: 'Crystal cluster', tip: true, seed: true, pals: CRYS, parts: ['body', 'base'], size: { w: [8, 160, 35], d: [8, 160, 35], h: [8, 200, 40] }, key: ['count', 'spread', 'girth', 'vary'],
    params: [sh('count', 'Crystals', 1, 40, 12), sh('spread', 'Lean out', 0, 70, 35, { unit: '°', tip: 'How far the outer crystals lean away from the middle' }), sh('girth', 'Thickness', 20, 200, 100, { unit: '%' }), sh('vary', 'Height range', 0, 90, 60, { unit: '%', tip: '0 = all about as tall · more = the outer ones shorter' }), sh('facets', 'Faces', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('tip', 'Point length', 5, 60, 25, { unit: '% of height' }), sh('taper', 'Taper', 0, 80, 10, { unit: '%' }), seg('base', 'Base', 'shape', [['none', 'None'], ['rock', 'Rock']], 'rock')],
    variants: [['Geode cluster', { pal: 'amethyst', count: 14 }], ['Ice spikes', { pal: 'ice', count: 9, spread: 15, girth: 70, tip: 40 }], ['Emerald bloom', { pal: 'emerald', count: 22, spread: 55 }], ['Ruby crown', { pal: 'ruby', count: 8, spread: 50, vary: 20 }]],
    make(p, V) {
      const prims = [], tips = [], n = p.count, W = rx(p), Dz = rz(p);
      for (let i = 0; i < n; i++) {
        const first = i === 0, a = V('pos', i, 0) * Math.PI * 2, r = first ? 0 : Math.sqrt(0.15 + 0.85 * V('pos', i, 1)) * 0.62;
        const px = Math.cos(a) * r * W, pz = Math.sin(a) * r * Dz;
        const h = first ? p.h : p.h * (1 - (p.vary / 100) * (0.35 + 0.65 * V('height', i))) * (1 - r * 0.35);
        const rad = Math.max(1, (Math.min(W, Dz) * 0.18 + h * 0.06) * (p.girth / 100) * (first ? 1.15 : 0.7 + V('girth', i) * 0.5));
        const c = Object.assign(crystal({ n: p.facets, h, rx: rad, rz: rad, tip: p.tip / 100, taper: p.taper / 100, rot: V('turn', i) * 6 }), { part: 'body' });
        const lean = first ? V('lean', i) * 6 : (p.spread * (0.4 + 0.6 * r / 0.62)) * (0.75 + V('lean', i) * 0.5), dir = Math.atan2(px, -pz) / RAD;
        const R = leanMat(lean, dir), o = [px, -Math.max(1, rad * 0.4), pz];
        prims.push(place(c, o, R)); tips.push(tipAt(o, R, [0, h, 0]));
      }
      if (p.base === 'rock') prims.push(Object.assign(ellipsoid({ rx: W * 0.8, ry: Math.max(2, p.h * 0.08), rz: Dz * 0.8 }), { part: 'base' }));
      return { prims, tips };
    },
  });
  fam({
    id: 'shard', group: 'crystals', name: 'Floating shard', seed: true, floating: true, fitMain: true, pals: CRYS.concat(['obsidian', 'deepslate']), parts: ['body'], size: { w: [4, 80, 14], d: [4, 80, 10], h: [8, 200, 40] }, key: ['jag', 'hover', 'chips'],
    params: [sh('jag', 'Jaggedness', 0, 60, 25, { unit: '%', tip: 'How deep the faces cut in' }), sh('hover', 'Hover', 0, 40, 6, { unit: 'blocks', tip: 'Gap under the shard' }), sh('chips', 'Orbiting chips', 0, 16, 5), sh('facets', 'Faces', 6, 30, 14), sh('orbit', 'Orbit', 50, 300, 140, { unit: '%' }), sh('tiltS', 'Tilt', 0, 60, 15, { unit: '°' })],
    variants: [['Void shard', { pal: 'obsidian', jag: 35, chips: 7 }], ['Sky prism', { pal: 'diamond', jag: 15, chips: 3, hover: 12 }], ['Amethyst splinter', { pal: 'amethyst', jag: 45, facets: 22 }]],
    make(p, V) {
      const a = rx(p), c = rz(p), b = Math.max(2, (p.h - p.hover) / 2);
      const core = Object.assign(jagged({ r: [a, b, c], jag: p.jag / 100, k: p.facets }, (i, j) => V('face', i, j)), { part: 'body', main: true });
      const R = leanMat(p.tiltS, V('tilt', 0) * 360), o = [0, p.hover + b, 0];
      const prims = [place(core, o, R)];
      for (let i = 0; i < p.chips; i++) {
        const s = Math.max(1, Math.min(a, c) * (0.18 + V('chip', i, 0) * 0.25)), ang = (i / Math.max(1, p.chips)) * Math.PI * 2 + V('chip', i, 1) * 0.6, rr = Math.max(a, c) * (p.orbit / 100) + s + 2;
        const ch = Object.assign(jagged({ r: [s, s * (1.3 + V('chip', i, 2)), s], jag: 0.3, k: 9 }, (k, j) => V('chipface' + i, k, j)), { part: 'body' });
        prims.push(place(ch, [Math.cos(ang) * rr, p.hover + b * (0.4 + V('chip', i, 3) * 1.2), Math.sin(ang) * rr], leanMat(V('chip', i, 4) * 60, V('chip', i, 5) * 360)));
      }
      return { prims };
    },
  });
  fam({
    id: 'geode', group: 'crystals', name: 'Geode', seed: true, pals: ['amethyst', 'diamond', 'emerald', 'ruby', 'sapphire'], parts: ['body', 'base', 'trim'], size: { w: [8, 120, 29], d: [8, 120, 29], h: [8, 120, 25] }, key: ['open', 'shell', 'crystals'],
    params: [seg('open', 'Opening', 'shape', [['half', 'Cut in half'], ['crack', 'Crack'], ['closed', 'Closed']], 'half'), sh('shell', 'Shell', 3, 8, 4, { unit: 'blocks', tip: 'Basalt, calcite and the crystal lining' }), sh('crystals', 'Crystals inside', 0, 100, 60, { unit: '%' }), sh('crackW', 'Crack width', 1, 12, 3, { unit: 'blocks' })],
    variants: [['Amethyst geode', { pal: 'amethyst', open: 'half' }], ['Cracked egg', { pal: 'amethyst', open: 'crack', w: 21, d: 21, h: 29 }], ['Diamond geode', { pal: 'diamond' }]],
    make(p, V) {
      const Rx = rx(p), Ry = p.h / 2, Rz = rz(p), mn = Math.min(Rx, Ry, Rz), sh2 = Math.min(p.shell, mn - 1);
      const crackDir = V('crack', 0) * Math.PI * 2, seed = strHash('geode') ^ (p.seed | 0);
      const f = (x, y, z) => {
        const e = Math.hypot(x / Rx, (y - Ry) / Ry, z / Rz), d = (e - 1) * mn;
        let v = Math.max(d, -(d + sh2));
        if (p.open === 'half') v = Math.max(v, z - 0.5);
        if (p.open === 'crack') {
          const ang = Math.atan2(z, x) - crackDir, along = Math.cos(ang) > 0 ? Math.abs(Math.sin(ang)) * Math.hypot(x, z) : 99;
          v = Math.max(v, p.crackW / 2 - Math.abs(along + (vnoise(y * 0.18, 0, 0, seed) - 0.5) * p.crackW * 1.6));
        }
        return v;
      };
      const partAt = (x, y, z) => { const e = (1 - Math.hypot(x / Rx, (y - Ry) / Ry, z / Rz)) * mn; return e < 1 ? 'base' : e < 2 ? 'trim' : 'body'; };
      return { prims: [{ f, partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-Rx - 1, -1, -Rz - 1, Rx + 1, p.h + 1, Rz + 1] }], geode: { amount: p.crystals / 100 } };
    },
  });
  fam({
    id: 'spire', group: 'crystals', name: 'Crystal spire', tip: true, seed: true, fitMain: true, pals: CRYS, parts: ['body'], size: { w: [3, 60, 9], d: [3, 60, 9], h: [16, 256, 96] }, key: ['taper', 'sats', 'satH', 'facets'],
    params: [sh('taper', 'Taper', 0, 90, 55, { unit: '%' }), sh('sats', 'Side crystals', 0, 12, 5), sh('satH', 'Side height', 10, 70, 30, { unit: '% of height' }), sh('facets', 'Faces', 3, 8, 6, { t: 'seg', ch: FACETS }), sh('tip', 'Point length', 5, 50, 18, { unit: '% of height' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' })],
    variants: [['Amethyst spire', { pal: 'amethyst' }], ['End tower', { pal: 'end', facets: 8, sats: 8 }], ['Frozen needle', { pal: 'ice', facets: 4, taper: 75, sats: 3 }]],
    make(p, V) {
      const prims = [Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, tip: p.tip / 100, twist: p.twist, flare: 0.3 }), { part: 'body', main: true })], tips = [{ p: [0, p.h, 0], dir: [0, 1, 0] }];
      for (let i = 0; i < p.sats; i++) {
        const a = (i / p.sats) * Math.PI * 2 + V('side', i, 0) * 0.5, r = Math.max(rx(p), rz(p)) * 0.8, h = p.h * (p.satH / 100) * (0.6 + V('side', i, 1) * 0.6), rad = Math.max(1, rx(p) * 0.4);
        const o = [Math.cos(a) * r, -1, Math.sin(a) * r], R = leanMat(18 + V('side', i, 2) * 18, Math.atan2(Math.cos(a), -Math.sin(a)) / RAD);
        prims.push(place(Object.assign(crystal({ n: p.facets, h, rx: rad, rz: rad, tip: 0.3 }), { part: 'body' }), o, R));
        tips.push(tipAt(o, R, [0, h, 0]));
      }
      return { prims, tips };
    },
  });
  fam({
    id: 'prism', group: 'crystals', name: 'Prism', pals: CRYS.concat(STONES), parts: ['body'], size: { w: [3, 128, 15], d: [3, 128, 15], h: [3, 256, 40] }, key: ['facets', 'taper', 'twist', 'lying'],
    params: [sh('facets', 'Faces', 3, 8, 3, { t: 'seg', ch: FACETS }), sh('taper', 'Taper', 0, 90, 0, { unit: '%' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' }), bool('lying', 'Lying down', 'shape', false), sh('chamfer', 'Bevel', 0, 100, 0, { unit: '%' })],
    variants: [['Triangle prism', { facets: 3, pal: 'quartz' }], ['Hex column', { facets: 6, pal: 'basalt' }], ['Lying prism', { facets: 3, lying: true, pal: 'diamond', h: 9, w: 48, d: 11 }], ['Twisted column', { facets: 4, twist: 90, pal: 'tuff' }]],
    make(p) {
      if (!p.lying) return { prims: [Object.assign(crystal({ n: p.facets, h: p.h, rx: rx(p), rz: rz(p), taper: p.taper / 100, tip: 0.0001, sharp: 0.05, twist: p.twist, chamfer: p.chamfer / 100 }), { part: 'body' })] };
      // lying: the length runs along the width, the cross-section fills height x depth
      const c = Object.assign(crystal({ n: p.facets, h: p.w, rx: p.h / 2, rz: rz(p), taper: p.taper / 100, tip: 0.0001, sharp: 0.05, twist: p.twist, chamfer: p.chamfer / 100, rot: Math.PI / 2 }), { part: 'body' });
      return { prims: [place(c, [-p.w / 2, p.h / 2, 0], mat({ z: -90 }))] };
    },
  });
  fam({
    id: 'bipyramid', group: 'crystals', name: 'Bipyramid', tip: true, pals: CRYS.concat(STONES), parts: ['body'], size: { w: [3, 128, 19], d: [3, 128, 19], h: [4, 256, 35] }, key: ['facets', 'mid', 'sharp', 'lift'],
    params: [sh('facets', 'Faces', 3, 8, 4, { t: 'seg', ch: FACETS }), sh('mid', 'Widest at', 15, 85, 45, { unit: '% of height' }), sh('sharp', 'Curve', 40, 250, 100, { unit: '%' }), sh('lift', 'Hover', 0, 40, 0, { unit: 'blocks' }), sh('twist', 'Twist', 0, 360, 0, { unit: '°' })],
    variants: [['Octahedron', { facets: 4, mid: 50, pal: 'diamond' }], ['Hex diamond', { facets: 6, mid: 35, pal: 'emerald' }], ['Floating gem', { facets: 4, lift: 6, pal: 'ruby' }]],
    make(p) {
      const t = p.mid / 100, hh = Math.max(4, p.h - p.lift);
      const c = Object.assign(crystal({ n: p.facets, h: hh, rx: rx(p), rz: rz(p), tip: 1 - t, btip: t, double: true, sharp: p.sharp / 100, twist: p.twist }), { part: 'body' });
      const o = [0, p.lift, 0];
      return { prims: [place(c, o, I3)], tips: [tipAt(o, I3, [0, hh, 0])], floating: p.lift > 0 };
    },
  });

  // monoliths, nature and the shapes: builds-gen-world.js (registered through _api.fam)

  /* ======================================================================
   * Parameters: lists, defaults, cleaning
   * ====================================================================== */
  const byId = new Map();
  /** A family's full parameter list; f.defs overrides shared defaults (palette, light, surface) for this family. */
  function finish(f) {
    f.all = (f.params || []).map((q) => Object.assign({}, q, { more: !(f.key || []).includes(q.id) })).concat(common(f));
    if (f.defs) f.all = f.all.map((q) => (f.defs[q.id] !== undefined ? Object.assign({}, q, { def: f.defs[q.id] }) : q));
    byId.set(f.id, f);
  }
  FAMILIES.forEach(finish);
  /** Families from other modules (builds-gen-world.js). */
  const register = (o) => { FAMILIES.push(o); finish(o); return o; };
  const GROUPS = [['crystals', 'Crystals'], ['monoliths', 'Monoliths'], ['nature', 'Nature'], ['shapes', 'Shapes']];
  function params(id) { const f = byId.get(id); return f ? f.all : []; }
  function defaults(id) {
    const f = byId.get(id), o = {};
    if (!f) return o;
    f.all.forEach((q) => { if (q.def !== undefined) o[q.id] = Array.isArray(q.def) ? q.def.slice() : q.def; });
    return o;
  }
  function clean(id, p) {
    const f = byId.get(id), d = defaults(id), o = {};
    if (!f) return o;
    f.all.forEach((q) => {
      if (q.t === 'look') return;
      let v = p && p[q.id] !== undefined ? p[q.id] : d[q.id];
      if (q.t === 'num') { v = Number(v); if (!Number.isFinite(v)) v = q.def; v = clamp(v, q.min, q.max); }
      else if (q.t === 'seg') { if (!(q.ch.some((c) => c[0] === v))) v = q.def; }
      else if (q.t === 'bool') v = !!v;
      else if (q.t === 'seed') { v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 1) v = 1; }
      else if (q.t === 'kinds') v = Array.isArray(v) ? v.filter((k) => DT().KINDS.includes(k)) : [];
      else if (q.t === 'colour') v = Array.isArray(v) && v.length === 3 && v.every((c) => Number.isFinite(+c)) ? v.map((c) => clamp(+c, 0, 1)) : (q.def ? q.def.slice() : null);
      else if (q.t === 'block') v = typeof v === 'string' && C().known(v) ? v : null;
      o[q.id] = v;
    });
    return o;
  }
  /** The values a Look sets (only the ones this generator has; the palette only when it offers it). */
  function look(id, key) {
    const f = byId.get(id), L = LOOKS.find((x) => x[0] === key);
    if (!f || !L) return {};
    const ids = new Set(f.all.map((q) => q.id)), out = {};
    Object.entries(L[3]).forEach(([k, v]) => { if (!ids.has(k)) return; if (k === 'pal' && !f.pals.includes(v)) return; if (k === 'glow' && v === 'edges' && f.glowDef && f.glowDef !== 'none') { out[k] = f.glowDef; return; } out[k] = v; });
    return out;
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
  /**
   * The build. With no angle the size is fitted: the model is stretched per axis until the blocks whose centre is
   * inside span exactly Width x Height x Depth (a few quick passes without the detail work).
   */
  function gen(id, raw) {
    const f = byId.get(id) || FAMILIES[0];
    const p = clean(f.id, raw);
    const k = p.scale / 100;
    const want = [Math.max(1, Math.round(p.w * k)), Math.max(1, Math.round(p.h * k)), Math.max(1, Math.round((p.d || p.w) * k))];
    p.w = want[0]; p.h = want[1]; p.d = want[2];
    const flat = !p.ax && !p.ay && !p.az;
    let ks = [1, 1, 1];
    if (flat) {
      // aim at the size or up to 2 blocks above it (those are trimmed off at the end, never under): proportional
      // steps, then halving between the last k that came out too small and the last that came out too big
      const under = [0, 0, 0], over = [Infinity, Infinity, Infinity];
      let bestK = ks, bestE = Infinity;
      // across, up to 2 over is trimmed evenly from both sides; the height must come out exact (trimming it would cut
      // the point or the foot)
      const slack = [2, 0, 2];
      const err = (bb) => bb.reduce((e, v, a) => e + Math.max(0, want[a] - v) * 10 + Math.max(0, v - want[a] - slack[a]) * 3, 0);
      for (let pass = 0; pass < 7; pass++) {
        const bb = run(f, p, ks, true);
        if (!bb) break;
        const e = err(bb);
        if (e < bestE) { bestE = e; bestK = ks; }
        const ok = bb.map((v, a) => v >= want[a] && v - want[a] <= slack[a]);
        if (ok.every(Boolean)) break;
        ks = ks.map((v, a) => {
          if (ok[a]) return v;
          if (bb[a] < want[a]) under[a] = Math.max(under[a], v); else over[a] = Math.min(over[a], v);
          const prop = v * clamp((want[a] + (slack[a] ? 0.8 : 0.3)) / Math.max(1, bb[a]), 0.2, 5);
          return under[a] > 0 && over[a] < Infinity ? (prop > under[a] && prop < over[a] ? prop : (under[a] + over[a]) / 2) : prop;
        });
      }
      ks = bestK;
    }
    const s = run(f, p, ks, false, flat ? want : null);
    return s;
  }
  function run(f, p, ks, measure, want) {
    const core = C(), D = DT();
    const seed = p.seed | 0, V = variation(seed);
    const model = f.make(p, V);
    const pal = PALETTES[p.pal] || PALETTES[f.pals[0]];
    const G = mat({ x: p.ax, y: p.ay, z: p.az, order: p.order });
    const prims = model.prims.filter(Boolean).map((q) => stretch(q, ks));
    const scaleP = (v) => [v[0] * ks[0], v[1] * ks[1], v[2] * ks[2]];
    const rough = p.rough / 100, seedN = seed * 31 + 5, ramp = rough > 0 ? 1 + rough * 3 : 0;
    // an odd width has its middle on a block, an even one between two blocks
    const SX = p.w % 2 ? 0.5 : 0, SZ = p.d % 2 ? 0.5 : 0;
    const wBox = (b) => {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) { const q = app(G, [x, y, z]); q[0] += SX; q[2] += SZ; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); } }
      return [lo, hi];
    };
    let LO = [Infinity, Infinity, Infinity], HI = [-Infinity, -Infinity, -Infinity];
    const pr = prims.map((q) => { const [lo, hi] = wBox(q.box); for (let a = 0; a < 3; a++) { LO[a] = Math.min(LO[a], lo[a]); HI[a] = Math.max(HI[a], hi[a]); } return { q, lo, hi }; });
    const pad = ramp;
    LO = LO.map((v) => Math.floor(v - 1 - pad)); HI = HI.map((v) => Math.ceil(v + 2 + pad));
    const [sx, sy, sz] = [HI[0] - LO[0], HI[1] - LO[1], HI[2] - LO[2]];
    if (sx * sy * sz > MAX_CELLS) throw Object.assign(new Error('This build is too big to generate (' + sx + ' × ' + sy + ' × ' + sz + '). Make it smaller or lower the scale.'), { user: true });
    const N = sx * sy * sz, I = (x, y, z) => (y * sz + z) * sx + x;
    const best = new Float32Array(N).fill(9), own = new Int16Array(N).fill(-1);
    // roughness noise lives on the unstretched shape, so the size fit scales it with the shape (no jumps)
    const kmin = Math.min(ks[0], ks[1], ks[2]);
    const rN = (x, y, z) => (fbm(x / ks[0] * 0.16, y / ks[1] * 0.16, z / ks[2] * 0.16, seedN) - 0.5) * 2 * kmin;
    const evalP = (q, mx, my, mz) => {
      let d = q.f(mx, my, mz);
      if (ramp) d += rN(mx, my, mz) * ramp * 0.6;
      if (q.carve && q.carve(mx, my, mz)) d = Math.max(d, 0.5);
      if (my < 0) d = Math.max(d, -my);   // nothing below the ground (roughness noise must not grow a floor)
      const b = q.box, ob = Math.max(b[0] - mx, mx - b[3], b[2] - mz, mz - b[5]);   // nor outside its own box
      return ob > 0 ? Math.max(d, ob) : d;
    };
    const toModel = (wx, wy, wz) => { wx -= SX; wz -= SZ; return [G[0][0] * wx + G[1][0] * wy + G[2][0] * wz, G[0][1] * wx + G[1][1] * wy + G[2][1] * wz, G[0][2] * wx + G[1][2] * wy + G[2][2] * wz]; };
    // 1. rasterise each primitive over its own box
    pr.forEach(({ q, lo, hi }, qi) => {
      const x0 = Math.max(0, Math.floor(lo[0] - LO[0] - 1 - pad)), x1 = Math.min(sx - 1, Math.ceil(hi[0] - LO[0] + 1 + pad));
      const y0 = Math.max(0, Math.floor(lo[1] - LO[1] - 1 - pad)), y1 = Math.min(sy - 1, Math.ceil(hi[1] - LO[1] + 1 + pad));
      const z0 = Math.max(0, Math.floor(lo[2] - LO[2] - 1 - pad)), z1 = Math.min(sz - 1, Math.ceil(hi[2] - LO[2] + 1 + pad));
      q.cell = [x0, y0, z0, x1, y1, z1];
      if (q.height && G[0][0] === 1 && G[1][1] === 1 && G[2][2] === 1) {
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const mx = LO[0] + x + 0.5 - SX, mz = LO[2] + z + 0.5 - SZ;
          if (mx < q.box[0] || mx > q.box[3] || mz < q.box[2] || mz > q.box[5]) continue;   // outside the ground of the field
          const H = q.height(mx, mz);
          for (let y = y0; y <= y1; y++) {
            const my = LO[1] + y + 0.5, i = I(x, y, z);
            let d = my - H;
            if (my < 0) d = Math.max(d, -my);   // nothing under the ground (no plate under a height field)
            if (d > 2.5 + ramp) { if (d < best[i]) { best[i] = d; own[i] = qi; } break; }
            if (ramp && Math.abs(d) < 2 + ramp) d += rN(mx, my, mz) * ramp * 0.6;
            if (q.carve && q.carve(mx, my, mz)) d = Math.max(d, 0.5);
            if (d < best[i]) { best[i] = d; own[i] = qi; }
          }
        }
        return;
      }
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const [mx, my, mz] = toModel(LO[0] + x + 0.5, LO[1] + y + 0.5, LO[2] + z + 0.5);
        const d = evalP(q, mx, my, mz), i = I(x, y, z);
        if (d < best[i]) { best[i] = d; own[i] = qi; }
      }
    });
    // the measuring pass of the size fit: the span of the blocks whose centre is inside
    if (measure) {
      let lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
      // generators with orbiting or side parts (fitMain) size the width and depth of their main body (the rest goes
      // round it); the height is always the whole build
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!(best[i] <= 0)) continue;
        if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
        if (f.fitMain && !pr[own[i]].q.main) continue;
        if (x < lo[0]) lo[0] = x; if (z < lo[2]) lo[2] = z; if (x > hi[0]) hi[0] = x; if (z > hi[2]) hi[2] = z;
      }
      return hi[0] < 0 ? null : [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
    }
    // 2. which cells are filled; surface cells get their coverage for the detail pass
    const level = p.detail, allow = D.allowed(level, p.off), detail = level !== 'low';
    const cov = new Map(), state = new Uint8Array(N);   // 1 = full, 2 = partial (from coverage)
    const here = [];
    const inside = (wx, wy, wz) => { const [mx, my, mz] = toModel(wx, wy, wz); for (let k2 = 0; k2 < here.length; k2++) if (evalP(here[k2], mx, my, mz) <= 0) return true; return false; };
    // the span of the centre-inside blocks: nothing may stick out of it (a partial block on top would add a layer)
    let CB = null;
    if (want) {
      CB = [Infinity, Infinity, Infinity, -1, -1, -1];
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) if (best[i] <= 0) { CB[0] = Math.min(CB[0], x); CB[1] = Math.min(CB[1], y); CB[2] = Math.min(CB[2], z); CB[3] = Math.max(CB[3], x); CB[4] = Math.max(CB[4], y); CB[5] = Math.max(CB[5], z); }
      // a block or two over the size: trim the outer layers (both sides in x and z, the bottom in y: it sinks a little)
      for (const a of [0, 1, 2]) {
        const ex = CB[a + 3] - CB[a] + 1 - want[a];
        if (ex <= 0 || ex > 3) continue;
        if (a === 1) CB[1] += ex; else { CB[a] += Math.floor(ex / 2); CB[a + 3] -= Math.ceil(ex / 2); }
      }
      // orbiting / side parts may reach past the main body across: only the height is held there
      if (f.fitMain) { CB[0] = 0; CB[2] = 0; CB[3] = sx - 1; CB[5] = sz - 1; }
    }
    const inCB = (x, y, z) => !CB || (x >= CB[0] && y >= CB[1] && z >= CB[2] && x <= CB[3] && y <= CB[4] && z <= CB[5]);
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      const d = best[i];
      if (d > 1.2 || !inCB(x, y, z)) continue;
      if (!detail || d < -1.2 || (pr[own[i]].q.heightfield && d < -0.9)) { if (d <= 0) state[i] = 1; continue; }
      const cx = LO[0] + x, cy = LO[1] + y, cz = LO[2] + z;
      here.length = 0;
      for (const { q } of pr) { const c = q.cell; if (x >= c[0] && y >= c[1] && z >= c[2] && x <= c[3] && y <= c[4] && z <= c[5]) here.push(q); }
      let ins = 0;
      for (const fy of [0.125, 0.875]) for (const fz of [0.125, 0.875]) for (const fx of [0.125, 0.875]) if (inside(cx + fx, cy + fy, cz + fz)) ins++;
      if (ins === 8 && d < -0.35) { state[i] = 1; continue; }
      if (ins === 0 && d > 0.35) continue;
      const mk = D.cover(inside, cx, cy, cz), n = D.count(mk);
      if (n === 64 || (n === 0 && d <= 0)) state[i] = 1;   // a needle point thinner than the sub-samples: its centre counts
      else if (n > 0) { state[i] = 2; cov.set(i, mk); }
    }
    // 3. Inside: solid, hollow, open or cavity (builds-inside.js, true distance from the surface)
    let cavity = null, support = null;
    if (p.inside && p.inside !== 'solid') {
      const solid = new Uint8Array(N);
      for (let i = 0; i < N; i++) solid[i] = state[i] ? 1 : 0;
      const r = TH.builds.inside.carve(solid, [sx, sy, sz], { mode: p.inside, wall: p.wall, support: p.support });
      cavity = r.cavity; support = r.support;
      for (let i = 0; i < N; i++) if (state[i] && !r.keep[i]) { state[i] = 0; cov.delete(i); }
      // a part right next to the hollow would open the shell: those stay full blocks
      cov.forEach((mk, i) => { for (const o of [1, -1, sx, -sx, sx * sz, -sx * sz]) { const j = i + o; if (j >= 0 && j < N && (cavity[j] || support[j])) { state[i] = 1; cov.delete(i); break; } } });
    }
    const filled = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && state[I(x, y, z)] > 0;
    const exposedAt = (x, y, z) => !filled(x + 1, y, z) || !filled(x - 1, y, z) || !filled(x, y + 1, z) || !filled(x, y - 1, z) || !filled(x, y, z + 1) || !filled(x, y, z - 1);
    // 4. parts and materials, written straight into the schematic
    const s = core.create(sx, sy, sz, f.name), SB = s.blocks;
    const putId = (i, id) => { SB[i] = id ? core.pal(s, id) : 0; };
    const idAt = (i) => (SB[i] ? s.palette[SB[i]] : null);
    const ramps = {}, rampFor = (part) => ramps[part] || (ramps[part] = rampOfPart(pal, part, p));
    const glowKey = p.glowBlock === 'palette' || !p.glowBlock ? pal.glow : p.glowBlock, GL = D.GLOW[glowKey] || D.GLOW.sea_lantern;
    const glowId = p.mat_glow || GL.id, edgeId = p.mat_edge || full(pal.edge || 'glass');
    const worn = (pal.worn || []).map(full), crack = pal.crack ? full(pal.crack) : null, moss = full(pal.moss || FIXED.moss);
    const gAmt = (p.glowAmt || 0) / 100, wAmt = p.weather / 100, mAmt = p.moss / 100, cAmt = p.cracks / 100;
    const partOf = new Uint8Array(N), ridge = new Uint8Array(N);
    const PARTS = ['body', 'base', 'trim', 'accent', 'edge', 'glow'];
    const modelOf = (x, y, z) => toModel(LO[0] + x + 0.5, LO[1] + y + 0.5, LO[2] + z + 0.5);
    const surface = [];
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      if (!state[i]) continue;
      const q = pr[own[i]] ? pr[own[i]].q : pr[0].q, [mx, my, mz] = modelOf(x, y, z);
      let part = q.partAt ? q.partAt(mx, my, mz) : q.part || 'body';
      const exposed = exposedAt(x, y, z);
      if (exposed) surface.push(i);
      if (exposed && q.edge && q.edge(mx, my, mz)) ridge[i] = 1;
      if (exposed && p.edges && ridge[i] && part === 'body') part = 'edge';
      partOf[i] = PARTS.indexOf(part) + 1;
      const t = clamp(q.grad ? q.grad(mx, my, mz) : my / Math.max(1, p.h), 0, 1);
      let id;
      if (part === 'glow') id = glowId;
      else if (part === 'edge') id = edgeId;
      else if (pal.skin && pal.skin[part] && !filled(x, y + 1, z)) id = m(pal.skin[part]);   // grass on top of the dirt
      else { const r = rampFor(part); id = r[clamp(Math.round((p.light ? 0.5 : t) * (r.length - 1) + bayer(x, y, z) * 0.95), 0, r.length - 1)]; }
      if (exposed && part !== 'glow' && part !== 'edge') {
        if (cAmt && Math.abs(vnoise(mx * 0.11, my * 0.07, mz * 0.11, seedN + 6) - 0.5) < 0.012 + 0.035 * cAmt) { if (cAmt > 0.6 && hash(x, y, z, seedN + 1) < (cAmt - 0.6) * 2) { state[i] = 0; continue; } if (crack) id = crack; }
      }
      putId(i, id);
    }
    // weathering and moss gather where they would in the world: near the foot, on upward faces, in corners and
    // crevices, in patches (low-frequency noise), never as an even sprinkle. A score per surface block, the best
    // share wins (more = a superset).
    if ((wAmt || mAmt) && surface.length) {
      const yMin = CB ? CB[1] : 0, yMax = CB ? CB[4] : sy - 1, hh = Math.max(1, yMax - yMin);
      const crev = (x, y, z) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy, z + dz)) n++; return n / 27; };
      const cand = surface.filter((i) => state[i] && partOf[i] && partOf[i] < 5);
      const pick = (amt, cap, score) => cand.map((i) => [i, score(i)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, Math.round(Math.pow(amt, 1.1) * cap * cand.length));
      const xyz = (i) => [i % sx, Math.floor(i / (sx * sz)), Math.floor(i / sx) % sz];
      if (wAmt && worn.length) pick(wAmt, 0.4, (i) => { const [x, y, z] = xyz(i), [mx, my, mz] = modelOf(x, y, z), t = (y - yMin) / hh; return fbm(mx * 0.13, my * 0.13, mz * 0.13, seedN + 4) * 0.55 + Math.pow(1 - t, 1.5) * 0.35 + (ridge[i] ? 0.12 : 0) + crev(x, y, z) * 0.2; })
        .forEach(([i]) => putId(i, worn[hash(i, 3, 1, seedN) < 0.5 ? 0 : worn.length - 1]));
      if (mAmt) {
        const mossy = pal.mossy ? full(pal.mossy) : null;
        pick(mAmt, 0.45, (i) => { const [x, y, z] = xyz(i), [mx, my, mz] = modelOf(x, y, z), t = (y - yMin) / hh, up = !filled(x, y + 1, z); return fbm(mx * 0.1, my * 0.08, mz * 0.1, seedN + 8) * 0.5 + (1 - t) * 0.3 + (up ? 0.22 : 0) + crev(x, y, z) * 0.35; })
          .forEach(([i]) => { const [x, y, z] = xyz(i); if (!filled(x, y + 1, z)) putId(i, moss); else if (mossy) putId(i, mossy); });
      }
    }
    // 5. glow: each pattern scores every surface block, the best `amount` share lights up (nested: more = a superset)
    const glowCells = [];
    if (p.glow && p.glow !== 'none' && gAmt > 0 && f.glow !== false) {
      const per = Math.max(3, Math.round(p.h / 7));
      const RUNES = [[1, 0, 1, 0, 1, 0, 1, 0, 1], [1, 1, 1, 0, 1, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0, 1, 0, 0], [0, 1, 0, 1, 1, 1, 0, 1, 0], [1, 1, 0, 0, 1, 0, 0, 1, 1], [1, 0, 1, 1, 1, 1, 1, 0, 1]];
      const score = (i) => {
        if (!state[i] || partOf[i] === 6) return Infinity;
        const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz)), [mx, my, mz] = modelOf(x, y, z), hsh = hash(x, y, z, seedN + 9);
        switch (p.glow) {
          case 'edges': return ridge[i] ? hsh : Infinity;
          case 'veins': return Math.abs(fbm(mx * 0.09, my * 0.09, mz * 0.09, seedN + 2) - 0.5) + hsh * 0.004;
          case 'rings': { const d = Math.abs(((my % per) + per) % per - per / 2); return (per / 2 - d) + hsh * 0.01; }
          case 'runes': {
            if (model.runes) return model.runes(mx / ks[0], my / ks[1], mz / ks[2]);   // the generator's own carved runes
            // 3 x 3 glyphs on a grid over the faces; a whole glyph lights up at once
            const u = Math.abs(mx) > Math.abs(mz) ? mz : mx, gu = Math.floor((u + 1000) / 4), gv = Math.floor(my / 4), lu = ((Math.floor(u + 1000) % 4) + 4) % 4, lv = ((Math.floor(my) % 4) + 4) % 4;
            if (lu > 2 || lv > 2) return Infinity;
            const g = RUNES[Math.floor(hash(gu, gv, 7, seedN) * RUNES.length)];
            return g[lv * 3 + lu] ? hash(gu, gv, 3, seedN) : Infinity;
          }
          case 'core': return hsh;
          default: return hsh;   // speckles
        }
      };
      const list = surface.map((i) => [i, score(i)]).filter((x) => Number.isFinite(x[1])).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const want2 = Math.max(1, Math.round(Math.pow(gAmt, 1.2) * (GLOW_CAP[p.glow] || 0.2) * surface.length));
      const taken = new Set();
      const near = (i) => { const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz)); for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (taken.has(I(x + dx, y + dy, z + dz))) return true; return false; };
      for (const [i] of list) {
        if (glowCells.length >= want2) break;
        if (p.glow === 'speckles' && near(i)) continue;   // speckles keep a block of space between them
        taken.add(i); glowCells.push(i);
      }
      const behind = GL.behind || p.glow === 'core';
      for (const i of glowCells) {
        state[i] = 1; cov.delete(i); partOf[i] = 6;
        if (!behind) { putId(i, glowId); continue; }
        // behind glass: the surface block becomes glass, the light sits right under it
        const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        putId(i, p.glow === 'core' ? edgeId : GL.behind);
        let under = false;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]]) {
          if (filled(x + dx, y + dy, z + dz)) continue;
          const X = x - dx, Y = y - dy, Z = z - dz, j = I(X, Y, Z);
          if (X >= 0 && Y >= 0 && Z >= 0 && X < sx && Y < sy && Z < sz && (state[j] || (cavity && cavity[j]))) { state[j] = 1; cov.delete(j); partOf[j] = 6; putId(j, glowId); if (cavity) cavity[j] = 0; under = true; }
        }
        if (!under) putId(i, glowId);   // nothing behind it: the light itself
      }
    }
    // 6. the detail pass: partial blocks from the coverage
    const fallback = {};
    if (pal.partial) Object.entries(pal.partial).forEach(([kk, v]) => { if (C().known(m(v))) fallback[kk] = m(v); });
    cov.forEach((mk, i) => {
      const cur = idAt(i);
      if (!state[i] || !cur) return;
      const pt = partOf[i];
      // a block whose centre is inside always stays (so the size holds); the others may become a part or air
      if (pt === 6 || pt === 5 || core.def(cur).shape !== 'cube' || core.def(cur).cut) { if (D.count(mk) < 32 && best[i] > 0) { state[i] = 0; putId(i, null); } return; }
      const c = D.choose(mk, { block: cur, allow, fallback });
      if (!c) { if (best[i] <= 0) return; state[i] = 0; putId(i, null); } else putId(i, c);
    });
    for (let i = 0; i < N; i++) if (!state[i]) SB[i] = 0;
    // the hollow: its fill and its supports
    if (cavity) {
      const fillId = { glow: glowId, dark: rampFor('body')[0], water: m(FIXED.water), lava: m(FIXED.lava) }[p.fill] || null;
      const supId = rampFor('base')[0];
      for (let i = 0; i < N; i++) { if (support[i]) putId(i, supId); else if (cavity[i] && fillId) putId(i, fillId); }
    }
    const set = (x, y, z, id) => { if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) SB[I(x, y, z)] = core.pal(s, id); };
    const at = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz ? SB[I(x, y, z)] : -1);
    if (model.fluid) {
      const fid = m(FIXED[model.fluid.id]);
      const fat = (x, y, z) => model.fluid.at(x / ks[0], Math.floor(y / ks[1]), z / ks[2]);
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (SB[i] || !inCB(x, y, z)) continue;
        const [mx, my, mz] = modelOf(x, y, z);
        if (fat(mx, Math.floor(my), mz)) SB[i] = core.pal(s, fid);
      }
    }
    if (model.molten) {
      const r = model.molten.r, my0 = model.molten.y * ks[1];
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!SB[i]) continue;
        const [mx, my, mz] = modelOf(x, y, z), dd = Math.hypot(mx / ks[0], (my - my0) * 1.4 / ks[1], mz / ks[2]);
        if (dd < r + 1.2 && dd > r - 1 && hash(x, y, z, seedN) < 0.5) SB[i] = core.pal(s, m('magma_block'));
      }
    }
    // the generator's own finishing touches (ejecta, foam): model coordinates (unstretched), a part or a block id
    if (model.decorate) {
      const cellOf = (mx, my, mz) => { const w = app(G, [mx * ks[0], my * ks[1], mz * ks[2]]); return [Math.floor(w[0] + SX - LO[0]), Math.floor(w[1] - LO[1]), Math.floor(w[2] + SZ - LO[2])]; };
      const idOf = (v) => (v.startsWith('minecraft:') ? v : rampFor(v)[Math.floor(rampFor(v).length / 2)]);
      model.decorate({
        atModel: (mx, my, mz, v, onlyEmpty) => { const [x, y, z] = cellOf(mx, my, mz); if (!inCB(x, y, z) || (onlyEmpty === false ? false : onlyEmpty && at(x, y, z) !== 0)) return; if (at(x, y, z) < 0) return; set(x, y, z, idOf(v)); },
        onTop: (mx, mz, v) => { const c = cellOf(mx, 0, mz); for (let y = sy - 2; y >= 0; y--) if (at(c[0], y, c[2]) > 0) { if (at(c[0], y + 1, c[2]) === 0 && inCB(c[0], y + 1, c[2])) set(c[0], y + 1, c[2], idOf(v)); return; } },
      });
    }
    if (model.geode && model.geode.amount > 0) {
      const sizes = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'];
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (SB[i] || !inCB(x, y, z) || hash(x, y, z, seedN + 21) > model.geode.amount * 0.45) continue;
        const [mx, my, mz] = modelOf(x, y, z);
        if (Math.hypot(mx / (p.w / 2), (my - p.h / 2) / (p.h / 2), mz / (p.d / 2)) > 0.97) continue;
        for (const [dx, dy, dz, dir] of [[0, -1, 0, 'up'], [0, 1, 0, 'down'], [1, 0, 0, 'west'], [-1, 0, 0, 'east'], [0, 0, 1, 'north'], [0, 0, -1, 'south']]) {
          const v = at(x + dx, y + dy, z + dz);
          if (v > 0 && partOfIdx(s.palette[v], rampFor('body'))) { SB[i] = core.pal(s, D.complete(m(sizes[Math.floor(hash(x, y, z, seedN + 5) * 4)]) + '[facing=' + dir + ']')); break; }
        }
      }
    }
    if (mAmt > 0.6) {
      for (let y = sy - 1; y >= 0; y--) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const v = at(x, y, z);
        if (!v || core.parse(s.palette[v]).name !== 'moss_block') continue;
        for (const [dx, dz, side] of [[1, 0, 'west'], [-1, 0, 'east'], [0, 1, 'north'], [0, -1, 'south']]) {
          if (hash(x + dx, y, z + dz, seedN + 31) > (mAmt - 0.6) * 1.6 || !inCB(x + dx, y, z + dz)) continue;
          const len = 1 + Math.floor(hash(x, y, z + dz, seedN) * 4);
          for (let k2 = 0; k2 < len; k2++) { if (at(x + dx, y - k2, z + dz) !== 0 || at(x, y - k2, z) <= 0) break; set(x + dx, y - k2, z + dz, D.complete(m('vine') + '[' + side + '=true]')); }
        }
      }
    }
    if ((p.detail === 'high' || p.detail === 'max') && GL.decor && glowCells.length && !(p.off || []).includes(/amethyst/.test(GL.decor) ? 'amethyst' : /candle/.test(GL.decor) ? 'candle' : 'rod')) {
      glowCells.forEach((i) => {
        if (hash(i, 7, 3, seedN) > 0.15 + gAmt * 0.45) return;
        const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        for (const [dx, dy, dz, dir] of [[0, 1, 0, 'up'], [1, 0, 0, 'east'], [-1, 0, 0, 'west'], [0, 0, 1, 'south'], [0, 0, -1, 'north']]) {
          if (at(x + dx, y + dy, z + dz) !== 0 || !inCB(x + dx, y + dy, z + dz)) continue;
          if (/candle/.test(GL.decor) && dir !== 'up') continue;
          set(x + dx, y + dy, z + dz, D.decorState(GL.decor, dir, 1 + (i % 4)));
          break;
        }
      });
    }
    // 7. sharp tips: the top blocks of the apex column become thinner parts (the height stays)
    const tipStyle = p.tipStyle === 'palette' ? (pal.tip || 'needle') : p.tipStyle;
    if (f.tip && model.tips && tipStyle && tipStyle !== 'none' && p.detail !== 'low') {
      for (const tp of model.tips) {
        const w = app(G, scaleP(tp.p)), dir = app(G, tp.dir);
        w[0] += SX; w[2] += SZ;
        const cx = Math.floor(w[0] - LO[0]), cz = Math.floor(w[2] - LO[2]), cy = Math.floor(w[1] - LO[1]);
        let top = null;
        for (let y = Math.min(sy - 1, cy + 1); y >= Math.max(0, cy - 14) && !top; y--) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { if (at(cx + dx, y, cz + dz) > 0) { top = [cx + dx, y, cz + dz]; break; } }
        if (!top) continue;
        if (dir[1] > 0.85) {
          const blk = s.palette[at(top[0], top[1], top[2])], mat0 = core.def(blk).shape === 'cube' ? blk : rampFor('body')[rampFor('body').length - 1];
          const seq = D.tipStack(tipStyle, p.tipLen, mat0, edgeId);
          // the column under the apex: only the cells that are a lone point (no neighbour beside them) are replaced
          let n = 0;
          while (n < seq.length && top[1] - n >= 0 && at(top[0], top[1] - n, top[2]) > 0 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => at(top[0] + dx, top[1] - n, top[2] + dz) > 0)) n++;
          if (!n) { if (sy - 1 - top[1] >= 1 && at(top[0], top[1] + 1, top[2]) === 0 && top[1] + 1 <= (CB ? CB[4] : sy - 1)) set(top[0], top[1] + 1, top[2], seq[seq.length - 1]); continue; }
          const use = seq.slice(seq.length - n);
          use.forEach((id2, k2) => set(top[0], top[1] - n + 1 + k2, top[2], id2));
        } else {
          const dn = Object.entries(D.DIRS).sort((a, b) => (b[1][0] * dir[0] + b[1][1] * dir[1] + b[1][2] * dir[2]) - (a[1][0] * dir[0] + a[1][1] * dir[1] + a[1][2] * dir[2]))[0];
          set(top[0], top[1], top[2], D.complete(tipStyle === 'crystal' ? m('amethyst_cluster') + '[facing=' + dn[0] + ']' : m('end_rod') + '[facing=' + dn[0] + ']'));
        }
      }
    }
    // 8. spawn-proof tops: an open top block outside becomes a bottom slab (the height stays)
    if (p.spawn) {
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const v = at(x, y, z);
        if (v <= 0 || (y + 1 < sy && at(x, y + 1, z) !== 0)) continue;
        const id0 = s.palette[v];
        if (core.def(id0).shape !== 'cube' || core.def(id0).cut || /water|lava|glow|lantern|froglight|magma|shroom/.test(id0)) continue;
        const sl = D.variant(id0, 'slab') || fallback.slab;
        if (sl) set(x, y, z, D.complete(sl + '[type=bottom]'));
      }
    }
    if (!f.floating && !model.floating && p.inside !== 'cavity') dropCrumbs(s);   // a cavity's core stands free inside on purpose
    // 9. light: every part along its own ramp, normals from the shape itself, a highlight on the ridges
    let out = s;
    if (p.light) {
      const SH = TH.builds.shade, L0 = SH.lightVec(p.lAz, p.lEl), L = p.lFollow ? app(G, L0) : L0;
      const rampMap = new Map(), only = new Set();
      ['body', 'base', 'trim', 'accent'].forEach((pt) => { const r = rampFor(pt).map((id2) => core.parse(id2).base); r.forEach((b) => { if (!rampMap.has(b)) rampMap.set(b, r); only.add(b); }); });
      const normals = new Float32Array(N * 3), boost = new Int8Array(N);
      const e = 0.5;
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        if (!SB[i] || !exposedAt(x, y, z)) continue;
        const q = pr[own[i]] ? pr[own[i]].q : null;
        if (!q) continue;
        const wx = LO[0] + x + 0.5, wy = LO[1] + y + 0.5, wz = LO[2] + z + 0.5;
        const fd = (dx, dy, dz) => { const [a, b, c] = toModel(wx + dx, wy + dy, wz + dz); return evalP(q, a, b, c); };
        let gx = fd(e, 0, 0) - fd(-e, 0, 0), gy = fd(0, e, 0) - fd(0, -e, 0), gz = fd(0, 0, e) - fd(0, 0, -e);
        const gl = Math.hypot(gx, gy, gz);
        if (gl > 1e-6) { normals[i * 3] = gx / gl; normals[i * 3 + 1] = gy / gl; normals[i * 3 + 2] = gz / gl; }
        if (ridge[i]) boost[i] = 1;
      }
      out = SH.shade(s, { vec: L, ramp: rampFor('body').map((id2) => core.parse(id2).base), ramps: rampMap, only, normals, boost, steps: p.lSteps, contrast: p.lCon / 100, dither: p.lDither / 100, ao: p.lAo / 100, rim: p.lRim / 100, shadows: p.lShadow, ambient: 0.2,
        colour: (p.lTint || p.lHue) ? { light: p.lColour || [1, 1, 1], shadow: p.lShadowC, tint: p.lTint / 100, hue: p.lHue / 100, pool: p.lPool } : null });
    }
    D.connect(out);
    out.name = f.name + ' ' + p.h + (f.pals.length > 1 ? ', ' + PALETTES[p.pal].name.toLowerCase() : '');
    const r = core.trim(out);
    r.name = out.name;
    return r;
  }
  const partOfIdx = (id, ramp) => ramp.some((r) => C().parse(r).base === C().parse(id).base);
  /**
   * No floating crumbs: a piece that neither stands on the ground nor is the biggest piece goes (lonely tip cells of
   * a leaning crystal, a cut-off corner). Generators that float by design skip it.
   */
  function dropCrumbs(s) {
    const [sx, sy, sz] = s.size, B = s.blocks, N = B.length, comp = new Int32Array(N).fill(-1), info = [];
    let minY = sy;
    for (let i = 0; i < N; i++) if (B[i]) { minY = Math.min(minY, Math.floor(i / (sx * sz))); }
    for (let i0 = 0; i0 < N; i0++) {
      if (!B[i0] || comp[i0] >= 0) continue;
      const id = info.length, st = [i0];
      let n = 0, ground = false;
      comp[i0] = id;
      while (st.length) {
        const i = st.pop(), x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        n++; if (y === minY) ground = true;
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

  TH.builds.gen = { _run: run, FAMILIES, GROUPS, GROUP_LABEL, STEPS, PALETTES, PART_LABEL, GLOW_PATTERNS, GLOW_CAP, LOOKS, look, params, defaults, clean, gen, byId: (id) => byId.get(id), rng, hash, vnoise, fbm, variation,
    _api: { fam: register, slab, ellipsoid, jagged, crystal, place, mat, app, appT, leanMat, I3, fbm, vnoise, hash, strHash, clamp, lerp, RAD, superE, box2, num, seg, bool, rx, rz, tipAt } };
})();
