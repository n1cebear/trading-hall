/**
 * Builds generators, part 2: Monoliths, Nature and Shapes (the crystals live in builds-gen.js, which also runs the
 * pipeline: size fit, detail, Inside, glow, light). Registered with TH.builds.gen._api.fam(...).
 *
 * The rules these follow (how good Minecraft builders make them):
 *   - a clear silhouette from exact geometry (boxes, slabs, rings, profiles); randomness only for intended features,
 *     always through the Variation (V(key, i)), never per-block noise; natural shapes use low-frequency lumps
 *   - materials are bands and inlays with meaning: strata in rock, a cornice on a tier, carved lines and runes, a
 *     voussoir ring and keystone on an arch, gills and spots on a mushroom, snow above a line on gentle slopes only
 *   - the light (builds-shade.js) does the shading along each part's ramp; weathering and moss gather at the base, on
 *     upward faces and in crevices (builds-gen.js), not everywhere
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const A = TH.builds.gen._api;
  const { fam, slab, ellipsoid, jagged, crystal, place, mat, leanMat, I3, fbm, vnoise, hash, strHash, clamp, lerp, RAD, superE, num, seg, bool, rx, rz, tipAt } = A;
  const sh = (id, label, min, max, def, o) => num(id, label, 'shape', min, max, def, o);
  const smooth = (a, b, t) => { const u = clamp((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

  /* ======================================================================
   * Primitives
   * ====================================================================== */
  /** An axis-aligned box (model space). Edges = where two faces meet. */
  function boxP(x0, y0, z0, x1, y1, z1, part, o) {
    const f = (x, y, z) => Math.max(x0 - x, x - x1, y0 - y, y - y1, z0 - z, z - z1);
    const edge = (x, y, z) => (Math.min(Math.abs(x - x0), Math.abs(x - x1)) < 0.9 ? 1 : 0) + (Math.min(Math.abs(y - y0), Math.abs(y - y1)) < 0.9 ? 1 : 0) + (Math.min(Math.abs(z - z0), Math.abs(z - z1)) < 0.9 ? 1 : 0) >= 2;
    return Object.assign({ f, edge, part: part || 'body', grad: (x, y) => clamp((y - y0) / Math.max(1, y1 - y0), 0, 1), box: [x0, y0, z0, x1, y1, z1] }, o || {});
  }
  /**
   * A hewn stone 0..h: superellipse section (round 0 = square, 1 = round), taper, belly, a rounded top (dome = share of
   * the height), and low-frequency lumps (amp blocks) so it reads as one stone, not as noise.
   */
  function stoneP(o) {
    const h = Math.max(1, o.h), k = 2 + 8 * Math.pow(1 - clamp(o.round || 0, 0, 1), 2), cap = Math.max(0.5, clamp(o.dome == null ? 0.15 : o.dome, 0, 1) * h), amp = o.amp || 0, seed = o.seed || 1;
    const fq = o.fq || 1 / Math.max(2, Math.min(o.hx, o.hz) * 1.6 + 1);
    const sc = (y) => {
      const t = clamp(y / h, 0, 1);
      let s = 1 - (o.taper || 0) * t + (o.belly || 0) * Math.sin(Math.PI * t);
      const u = y - (h - cap);
      if (u > 0) s *= Math.sqrt(Math.max(0, 1 - (u / cap) * (u / cap)));
      return Math.max(0.03, s);
    };
    const f = (x, y, z) => {
      if (y < 0 || y > h) return Math.max(-y, y - h, f(x, clamp(y, 0, h), z)) + 0.01;
      const s = sc(y);
      let d = superE(x, z, o.hx * s, o.hz * s, k);
      if (amp) d += (fbm(x * fq + 3.1, y * fq * 0.6, z * fq + 5.3, seed) - 0.5) * 2 * amp;
      return d;
    };
    const m = Math.max(o.hx, o.hz) * (1 + Math.max(0, o.belly || 0)) + amp + 1;
    return { f, part: o.part || 'body', grad: (x, y) => clamp(y / h, 0, 1), box: [-m, 0, -m, m, h, m], partAt: o.partAt || null };
  }
  /** Horizontal bands (strata): band k of thickness t, with a gentle dip and a slow wave; returns the band index. */
  const bandAt = (x, y, z, t, dip, seed) => Math.floor((y + dip * x * 0.15 + (vnoise(x * 0.06, 0, z * 0.06, seed) - 0.5) * 1.6) / Math.max(1, t));
  /** Strata colours: body, trim, body, accent, ... */
  const strataPart = (b, amt) => { const k = ((b % 4) + 4) % 4; return amt <= 0 ? 'body' : k === 1 ? 'trim' : k === 3 && amt > 0.5 ? 'accent' : 'body'; };

  /* ======================================================================
   * Monoliths
   * ====================================================================== */
  const MONO_PALS = ['obsidian', 'deepslate', 'greystone', 'stone', 'basalt', 'blackstone', 'tuff', 'sandstone', 'quartzstone', 'copper', 'prismarine', 'endstone', 'terracotta'];
  const OLD = ['rockstone', 'greystone', 'tuff', 'sandrock', 'deepslate', 'basalt', 'sandstone', 'endstone'];
  const MONO = (o) => fam(Object.assign({ group: 'monoliths', pals: MONO_PALS, parts: ['body', 'base', 'trim', 'accent'], size: { w: [1, 64, 8], d: [1, 64, 2], h: [3, 256, 18] }, defs: { lDither: 10, lCon: 115 } }, o));
  /** A stepped plinth under a body of half sizes (bx, bz): step k sticks out (n - k) blocks. Returns its height. */
  function plinth(n, bx, bz, prims) {
    for (let k = 0; k < n; k++) { const o = n - k; prims.push(boxP(-bx - o, k, -bz - o, bx + o, k + 1, bz + o, 'base')); }
    return n;
  }
  const lean = (p) => leanMat(p.lean || 0, p.leanDir || 0);

  MONO({ id: 'slab', name: 'Slab monolith', key: ['plinth', 'chamfer', 'lean'],
    params: [sh('plinth', 'Plinth steps', 0, 4, 0), sh('chamfer', 'Bevel', 0, 100, 0, { unit: '%', tip: 'Cuts the four upright edges' }), sh('lean', 'Lean', 0, 30, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 90, { unit: '°' }), sh('taper', 'Taper', 0, 60, 0, { unit: '%' })],
    variants: [['The black slab', { pal: 'obsidian', w: 4, d: 1, h: 9 }], ['Giant slab', { pal: 'obsidian', w: 16, d: 4, h: 36 }], ['Marble tablet', { pal: 'quartzstone', w: 9, d: 3, h: 12, plinth: 2 }], ['Mossy slab', { pal: 'greystone', w: 8, d: 2, h: 16, moss: 35, weather: 30 }]],
    defs: { pal: 'obsidian', lDither: 0, lCon: 120 },
    make(p) {
      const prims = [], n = Math.min(p.plinth, Math.floor((Math.min(p.w, p.d) - 1) / 2), p.h - 2), bx = rx(p) - n, bz = rz(p) - n;
      plinth(n, Math.max(0.5, bx), Math.max(0.5, bz), prims);
      const b = Object.assign(slab({ h: p.h - n, hx: Math.max(0.5, bx), hz: Math.max(0.5, bz), taper: p.taper / 100, chamfer: p.chamfer / 100 }), { part: 'body' });
      prims.push(place(b, [0, n, 0], lean(p)));
      return { prims };
    } });

  MONO({ id: 'obelisk', name: 'Obelisk', tip: true, size: { w: [3, 48, 8], d: [3, 48, 8], h: [8, 256, 40] }, key: ['taper', 'pyr', 'plinth', 'carving'],
    params: [sh('taper', 'Taper', 0, 70, 0, { unit: '%' }), seg('pyr', 'Pyramid top', 'shape', [['low', 'Low'], ['even', '45°'], ['sharp', 'Sharp']], 'even'), sh('plinth', 'Plinth steps', 0, 4, 2), seg('carving', 'Carving', 'shape', [['none', 'None'], ['glyphs', 'Glyphs'], ['bands', 'Bands']], 'glyphs'), bool('gild', 'Gilded top', 'shape', true), sh('chamfer', 'Bevel', 0, 100, 0, { unit: '%' })],
    variants: [['Sandstone obelisk', { pal: 'sandstone' }], ['Marble obelisk', { pal: 'quartzstone', carving: 'bands', plinth: 3 }], ['Obsidian needle', { pal: 'obsidian', w: 5, d: 5, h: 48, taper: 40, pyr: 'sharp', plinth: 1, gild: false, glow: 'edges', glowAmt: 50, glowBlock: 'crying' }], ['Deepslate pillar', { pal: 'deepslate', carving: 'bands', gild: false, glow: 'rings', glowAmt: 40 }]],
    defs: { pal: 'sandstone' },
    make(p) {
      const prims = [], n = Math.min(p.plinth, Math.floor((Math.min(p.w, p.d) - 3) / 2), Math.floor(p.h / 6)), bx = rx(p) - n, bz = rz(p) - n;
      plinth(n, bx, bz, prims);
      const top = Math.min(bx, bz) * (1 - p.taper / 100), slope = { low: 0.6, even: 1, sharp: 1.9 }[p.pyr], ph = clamp(top * slope, 1, (p.h - n) * 0.4), hb = p.h - n;
      const c = slab({ h: hb, hx: bx, hz: bz, taper: p.taper / 100 * (hb - ph) / hb, tip: ph / hb, chamfer: p.chamfer / 100 });
      const yb = hb - ph;
      c.part = 'body';
      c.partAt = (x, y, z) => {
        if (y > yb - 0.01) return p.gild ? 'accent' : 'body';
        const s = 1 - (p.taper / 100 * (hb - ph) / hb) * clamp(y / yb, 0, 1), ax = bx * s, az = bz * s;
        const onX = Math.abs(x) > ax - 0.75, onZ = Math.abs(z) > az - 0.75;
        if (p.carving === 'bands') { const q = y / yb; if ((q > 0.9 && q < 0.93) || (q > 0.06 && q < 0.09) || (q > 0.5 && q < 0.52)) return 'trim'; }
        if (p.carving === 'glyphs' && (onX || onZ) && y > yb * 0.12 && y < yb * 0.88) {
          const u = onZ ? x : z, half = onZ ? ax : az, cw = Math.max(0.5, half * 0.28);
          if (Math.abs(u) < cw + 0.01 && half > 1.4) { const row = Math.floor(y), k = hash(Math.round(u * 2), row, onZ ? 1 : 2, 77); return row % 2 === 0 && k < 0.7 ? 'trim' : 'body'; }
        }
        return 'body';
      };
      const tips = [];
      prims.push(place(c, [0, n, 0], I3)); tips.push(tipAt([0, n, 0], I3, [0, hb, 0]));
      return { prims, tips };
    } });

  MONO({ id: 'broken', name: 'Broken monolith', seed: true, fitMain: true, key: ['break', 'fallen', 'rubble'], size: { w: [2, 64, 8], d: [1, 64, 3], h: [4, 200, 20] },
    params: [sh('break', 'Break height', 30, 85, 55, { unit: '% of height' }), sh('fallen', 'Fallen part', 0, 100, 80, { unit: '%', tip: 'How much of the top lies on the ground beside it' }), sh('rubble', 'Rubble', 0, 12, 5), sh('jag', 'Jagged break', 0, 100, 60, { unit: '%' })],
    variants: [['Toppled giant', { pal: 'deepslate', w: 10, d: 4, h: 30, weather: 35, cracks: 30 }], ['Ancient ruin', { pal: 'sandstone', weather: 40, moss: 15 }], ['Overgrown', { pal: 'greystone', moss: 60, weather: 30 }]],
    defs: { pal: 'greystone', weather: 25 },
    make(p, V) {
      const prims = [], hb = Math.max(2, Math.round(p.h * p.break / 100)), X = rx(p), Z = rz(p), amp = Math.max(0.6, X * 0.45) * p.jag / 100, seed = (p.seed | 0) + 11;
      const breakY = (u, v) => hb - amp * 0.5 + (vnoise(u * 0.45 + 1.7, v * 0.45, 0.3, seed) - 0.5) * 2 * amp;
      const stump = boxP(-X, 0, -Z, X, hb + amp, Z, 'body', { main: true });
      const sf = stump.f; stump.f = (x, y, z) => Math.max(sf(x, y, z), y - breakY(x, z));
      prims.push(stump);
      const len = (p.h - hb) * p.fallen / 100;
      // the top lies on its wide face, toward +z or -z (the Variation), with a little yaw
      const dir = V('fall', 0) < 0.5 ? 1 : -1;
      if (len >= 1.5) {
        const z0 = Z + 1.2, piece = boxP(-X, 0, 0, X, 2 * Z, len, 'body');
        const pf = piece.f; piece.f = (x, y, z) => Math.max(pf(x, y, z), (amp * 0.5 + (vnoise(x * 0.45 + 1.7, y * 0.45, 0.3, seed) - 0.5) * 2 * amp) - z);
        // it lies to the east or west of the stump, its broken end toward it
        const yaw = (V('fall', 1) - 0.5) * 16, R = mat({ y: (dir > 0 ? 90 : -90) + yaw });
        prims.push(place(piece, [dir * (X + 1.2), 0, 0], R));
        void z0;
      }
      for (let i = 0; i < p.rubble; i++) {
        const a = (dir > 0 ? Math.PI / 2 : -Math.PI / 2) + (V('rub', i, 0) - 0.5) * 2.6, r = Math.max(X, Z) + 0.8 + V('rub', i, 1) * Math.max(2, X * 0.8), s = 0.5 + V('rub', i, 2) * Math.min(1.4, X * 0.25);
        prims.push(place(Object.assign(jagged({ r: [s * 1.2, s * 0.8, s], jag: 0.25, k: 9 }, (k, j) => V('rubf' + i, k, j)), { part: 'body' }), [Math.cos(a) * r, s * 0.45, Math.sin(a) * r], mat({ y: V('rub', i, 3) * 360 })));
      }
      return { prims };
    } });

  MONO({ id: 'menhir', name: 'Standing stone', seed: true, pals: OLD, size: { w: [2, 40, 6], d: [2, 40, 4], h: [3, 120, 14] }, key: ['taper', 'round', 'lumps', 'lean'],
    params: [sh('taper', 'Taper', 0, 70, 25, { unit: '%' }), sh('round', 'Roundness', 0, 100, 70, { unit: '%' }), sh('lumps', 'Lumps', 0, 100, 15, { unit: '%', tip: 'Gentle bulges over the whole stone (the Variation moves them)' }), sh('lean', 'Lean', 0, 25, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 70, { unit: '°' }), sh('belly', 'Belly', -30, 40, 8, { unit: '%' })],
    variants: [['Mossy menhir', { pal: 'rockstone', moss: 40 }], ['Tuff stone', { pal: 'tuff' }], ['Sun stone', { pal: 'sandrock' }], ['Tall needle', { pal: 'greystone', w: 4, d: 3, h: 24, taper: 45 }]],
    defs: { pal: 'rockstone', lDither: 20 },
    make(p) {
      const s = stoneP({ h: p.h, hx: rx(p), hz: rz(p), taper: p.taper / 100, round: p.round / 100, dome: clamp(Math.min(rx(p), rz(p)) / p.h * 1.2, 0.08, 0.35), belly: p.belly / 100, amp: Math.min(rx(p), rz(p)) * 0.22 * p.lumps / 100, seed: (p.seed | 0) + 3 });
      return { prims: [place(s, [0, 0, 0], lean(p))] };
    } });

  MONO({ id: 'henge', name: 'Stone circle', seed: true, pals: OLD.concat(['stone', 'quartzstone']), size: { w: [12, 160, 33], d: [12, 160, 33], h: [3, 64, 9] }, key: ['stones', 'lintels', 'stoneW', 'ruin'],
    params: [sh('stones', 'Stones', 4, 36, 14), seg('lintels', 'Lintels', 'shape', [['ring', 'Ring'], ['pairs', 'Pairs'], ['none', 'None']], 'ring'), sh('stoneW', 'Stone width', 1, 12, 3, { unit: 'blocks' }), sh('ruin', 'Ruin', 0, 80, 0, { unit: '%', tip: 'Some stones shorter or gone, their lintels fallen' }), sh('stoneD', 'Stone depth', 1, 8, 2, { unit: 'blocks' }), sh('lintelT', 'Lintel height', 1, 4, 1, { unit: 'blocks' }), bool('altar', 'Altar stone', 'shape', true), bool('inner', 'Inner horseshoe', 'shape', false)],
    variants: [['Stonehenge', { pal: 'greystone', stones: 16, inner: true, ruin: 25, weather: 30, moss: 15 }], ['Druid circle', { pal: 'rockstone', stones: 9, lintels: 'none', moss: 45, h: 6 }], ['Trilithon ring', { pal: 'sandstone', stones: 10, lintels: 'pairs', stoneW: 4 }], ['Glowing ring', { pal: 'deepslate', lintels: 'pairs', glow: 'runes', glowAmt: 60 }]],
    defs: { pal: 'greystone', lDither: 15 },
    make(p, V) {
      const prims = [], n = p.stones, X = rx(p), Z = rz(p), D = p.stoneD, W2 = p.stoneW / 2, lt = p.lintels === 'none' ? 0 : Math.min(p.lintelT, p.h - 2);
      const R = Math.max(2, X - D / 2), Rz = Math.max(2, Z - D / 2), sq = R / Rz, Hu = p.h - lt;
      const ang0 = Math.PI / 2 + Math.PI / n;   // the gap between two stones faces south (the entrance)
      const st = [];
      for (let i = 0; i < n; i++) {
        const gone = p.ruin && V('gone', i) < p.ruin / 250;
        const short = p.ruin ? V('short', i) < p.ruin / 120 : false;
        st.push({ a: ang0 + (i / n) * Math.PI * 2, gone, hh: gone ? 0 : short ? Math.max(2, Math.round(Hu * (0.45 + V('sh', i) * 0.35))) : Hu });
      }
      st.forEach((s) => {
        if (s.gone) return;
        const o = [Math.cos(s.a) * R, 0, Math.sin(s.a) * Rz];
        const b = boxP(-D / 2, 0, -W2, D / 2, s.hh, W2, 'body');
        prims.push(place(b, o, mat({ y: -s.a / RAD + (V('yaw', st.indexOf(s)) - 0.5) * 8 })));
      });
      // lintels: a curved beam on the ring, from the middle of one stone to the middle of the next, resting on both
      const ring = (a0, a1) => {
        const span = ((a1 - a0) + Math.PI * 4) % (Math.PI * 2), mid = a0 + span / 2;
        return { part: 'body', grad: () => 1, box: [-X - 1, Hu, -Z - 1, X + 1, Hu + lt, Z + 1], f: (x, y, z) => {
          const r = Math.hypot(x, z * sq), a = Math.atan2(z * sq, x);
          let da = Math.abs(((a - mid) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) - span / 2 - W2 / R * 0.6;
          return Math.max(Math.abs(r - R) - D / 2 - 0.05, y - Hu - lt, Hu - y, da * R);
        } };
      };
      if (lt) for (let i = 0; i < n; i++) {
        const a = st[i], b = st[(i + 1) % n];
        if (p.lintels === 'pairs' && i % 2) continue;
        if (a.gone || b.gone || a.hh < Hu || b.hh < Hu) continue;
        if (p.lintels === 'ring' && i === n - 1 && n % 2 === 1) continue;
        prims.push(ring(a.a, b.a));
      }
      if (p.inner) {
        // five trilithons in a horseshoe open to the south, taller than the ring
        const Ri = R * 0.55, Rzi = Rz * 0.55;
        for (let k = 0; k < 5; k++) {
          const a = Math.PI * 1.5 + (k - 2) * 0.55, o = [Math.cos(a) * Ri, 0, Math.sin(a) * Rzi], hh = Math.max(2, Math.round(Hu * (k === 2 ? 1 : 0.85)));
          const gap = Math.max(1, Math.round(p.stoneW * 0.4)), tw = W2;
          for (const sgn of [-1, 1]) prims.push(place(boxP(-D / 2, 0, -tw, D / 2, hh, tw, 'body'), [o[0] + Math.sin(a) * sgn * (tw + gap / 2), 0, o[2] - Math.cos(a) * sgn * (tw + gap / 2)], mat({ y: -a / RAD })));
          if (lt) prims.push(place(boxP(-D / 2, hh, -(2 * tw + gap / 2), D / 2, hh + lt, 2 * tw + gap / 2, 'body'), o, mat({ y: -a / RAD })));
        }
      }
      if (p.altar) prims.push(boxP(-Math.max(1, p.stoneW * 0.8), 0, -Math.max(0.5, D * 0.6), Math.max(1, p.stoneW * 0.8), 1, Math.max(0.5, D * 0.6), 'accent'));
      return { prims };
    } });

  MONO({ id: 'dolmen', name: 'Dolmen', seed: true, pals: OLD, size: { w: [5, 60, 13], d: [4, 60, 10], h: [3, 40, 7] }, key: ['legs', 'capT', 'tilt'],
    params: [sh('legs', 'Uprights', 3, 8, 4), sh('capT', 'Capstone', 1, 8, 2, { unit: 'blocks' }), sh('tilt', 'Cap tilt', 0, 20, 6, { unit: '°', tip: 'The capstone slopes down to the back, as on portal tombs' }), sh('overhang', 'Overhang', 0, 50, 20, { unit: '%' })],
    variants: [['Portal tomb', { pal: 'rockstone', legs: 4, tilt: 12, moss: 30 }], ['Basalt table', { pal: 'basalt', legs: 3, tilt: 0 }], ['Desert dolmen', { pal: 'sandrock', weather: 30 }], ['Long chamber', { pal: 'greystone', legs: 7, w: 9, d: 18, h: 6 }]],
    defs: { pal: 'rockstone', lDither: 20 },
    make(p, V) {
      const prims = [], X = rx(p), Z = rz(p), cap = Math.min(p.capT, p.h - 2), legH = p.h - cap, ov = 1 - p.overhang / 100 * 0.5;
      const cx = Math.max(1, X * ov * 0.72), cz = Math.max(1, Z * ov * 0.72), t = Math.max(0.5, Math.min(X, Z) * 0.12);
      // the uprights stand along a U: front left, back left, back right, front right (open to the south)
      const path = [[-cx, cz], [-cx, -cz], [cx, -cz], [cx, cz]], segs = [];
      let L = 0; for (let i = 0; i < 3; i++) { const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); segs.push(l); L += l; }
      const n = p.legs, len = L / n * 0.82;
      for (let k = 0; k < n; k++) {
        let d = (k + 0.5) / n * L, i = 0; while (i < 2 && d > segs[i]) { d -= segs[i]; i++; }
        const a = path[i], b = path[i + 1], u = d / segs[i], x = lerp(a[0], b[0], u), z = lerp(a[1], b[1], u), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const s = stoneP({ h: legH + 0.6, hx: Math.max(0.6, len / 2), hz: t, round: 0.3, dome: 0.05, amp: 0.25, seed: k + 5 });
        prims.push(place(s, [x, 0, z], mat({ y: -ang / RAD + (V('leg', k) - 0.5) * 8 })));
      }
      const c = stoneP({ h: cap, hx: X, hz: Z, round: 0.7, dome: 0.4, amp: Math.min(0.8, cap * 0.25), seed: 9, part: 'body' });
      prims.push(place(c, [0, legH, 0], mat({ x: -p.tilt, y: (V('cap', 0) - 0.5) * 10 })));
      return { prims };
    } });

  MONO({ id: 'alignment', name: 'Menhir rows', seed: true, pals: OLD, size: { w: [8, 200, 48], d: [2, 60, 9], h: [3, 64, 9] }, key: ['count', 'rows', 'fall'],
    params: [sh('count', 'Stones per row', 2, 30, 10), sh('rows', 'Rows', 1, 5, 2), sh('fall', 'Last stone', 20, 100, 55, { unit: '% of height', tip: 'The rows get shorter toward the east' }), sh('round', 'Roundness', 0, 100, 55, { unit: '%' })],
    variants: [['Carnac rows', { pal: 'rockstone', rows: 3, d: 11, moss: 30 }], ['Avenue of tuff', { pal: 'tuff', rows: 2, fall: 100 }], ['Rune path', { pal: 'deepslate', rows: 2, glow: 'runes', glowAmt: 60, fall: 70 }]],
    defs: { pal: 'rockstone', lDither: 20 },
    make(p, V) {
      const prims = [], X = rx(p), Z = rz(p), gapX = p.w / p.count, gapZ = p.d / p.rows;
      const sw = clamp(gapX * 0.3, 0.6, p.h * 0.3), sd = clamp(gapZ * 0.32, 0.5, 2.5);
      for (let r = 0; r < p.rows; r++) for (let i = 0; i < p.count; i++) {
        const t = i / Math.max(1, p.count - 1), k = r * 100 + i, x = -X + gapX * (i + 0.5), z = -Z + gapZ * (r + 0.5);
        const hh = Math.max(2, p.h * lerp(1, p.fall / 100, t) * (i === 0 ? 1 : 0.88 + V('h', k) * 0.12));
        const s = stoneP({ h: hh, hx: sw * (0.85 + V('w', k) * 0.15), hz: sd, taper: 0.28, round: p.round / 100, dome: 0.2, amp: sw * 0.15, seed: k + 1 });
        prims.push(place(s, [x, 0, z], leanMat((V('lean', k) - 0.5) * 8, V('dir', k) * 360)));
      }
      return { prims };
    } });

  MONO({ id: 'totem', name: 'Totem pillar', size: { w: [3, 40, 7], d: [3, 40, 7], h: [6, 200, 28] }, key: ['segs', 'vary', 'faces', 'capH'],
    params: [sh('segs', 'Heads', 1, 10, 3), sh('vary', 'Neck bands', 0, 60, 30, { unit: '%', tip: 'How much narrower the bands between the heads are' }), bool('faces', 'Carved faces', 'shape', true), sh('capH', 'Cap', 0, 6, 2, { unit: 'blocks' }), bool('wings', 'Wings', 'shape', true)],
    variants: [['Canyon totem', { pal: 'terracotta' }], ['Prismarine pillar', { pal: 'prismarine', segs: 4, glow: 'rings', glowAmt: 40, wings: false }], ['Copper stack', { pal: 'copper', segs: 3 }], ['Sandstone guardian', { pal: 'sandstone', segs: 2, h: 20 }]],
    defs: { pal: 'terracotta', lDither: 10 },
    make(p) {
      const prims = [], X = rx(p), Z = rz(p), cap = Math.min(p.capH, Math.floor(p.h / 4)), k = p.segs;
      const bodyH = p.h - cap, neck = p.vary > 0 ? Math.max(1, Math.round(bodyH / k * 0.22)) : 0, head = (bodyH - neck * (k - 1)) / k;
      const hx = p.wings && cap ? X * 0.72 : X, hz = p.wings && cap ? Z * 0.72 : Z;
      let y = 0;
      for (let i = 0; i < k; i++) {
        const y0 = y, c = boxP(-hx, y0, -hz, hx, y0 + head, hz, 'body');
        if (p.faces) c.partAt = (x, yy, z) => {
          const onZ = Math.abs(z) > hz - 0.75, onX = Math.abs(x) > hx - 0.75;
          if (!onZ && !onX) return 'body';
          const u = onZ ? x : z, half = onZ ? hx : hz, v = (yy - y0) / head;
          if (v > 0.84 && v < 0.94 && Math.abs(u) < half * 0.85) return 'trim';                             // brow
          if (v > 0.6 && v < 0.78 && Math.abs(Math.abs(u) - half * 0.42) < Math.max(0.5, half * 0.16)) return 'accent';   // eyes
          if (v > 0.38 && v < 0.6 && Math.abs(u) < Math.max(0.5, half * 0.12)) return 'trim';              // nose
          if (v > 0.16 && v < 0.3 && Math.abs(u) < half * 0.55) return 'accent';                           // mouth
          return 'body';
        };
        prims.push(c);
        y += head;
        if (i < k - 1 && neck) { const s = 1 - p.vary / 100 * 0.6; prims.push(boxP(-hx * s, y, -hz * s, hx * s, y + neck, hz * s, 'trim')); y += neck; }
      }
      if (cap) {
        prims.push(boxP(-hx, bodyH, -hz, hx, p.h - (p.wings ? 1 : 0), hz, 'trim'));
        if (p.wings) prims.push(boxP(-X, p.h - 1, -Z * 0.55, X, p.h, Z * 0.55, 'trim'), boxP(-X * 0.55, p.h - 1, -Z, X * 0.55, p.h, Z, 'trim'));
      }
      return { prims };
    } });

  // runes: 3 x 5 strokes, Futhark-like
  const RUNES = [
    ['010', '011', '010', '011', '010'], ['110', '101', '110', '100', '100'], ['010', '010', '010', '010', '010'], ['101', '101', '010', '010', '010'],
    ['110', '101', '110', '101', '101'], ['100', '110', '101', '100', '100'], ['111', '010', '010', '010', '010'], ['101', '010', '101', '010', '101'],
    ['001', '010', '100', '010', '001'], ['100', '010', '001', '010', '100'], ['010', '111', '010', '010', '010'], ['101', '111', '101', '101', '101'],
  ];
  MONO({ id: 'runestone', name: 'Rune stone', seed: true, glowDef: 'runes', size: { w: [5, 48, 15], d: [2, 24, 4], h: [8, 120, 24] }, key: ['runes', 'band', 'taper'],
    params: [sh('runes', 'Rune rows', 0, 12, 3, { tip: 'Rows of runes on both broad faces (more if the stone is tall enough)' }), bool('band', 'Serpent band', 'shape', true), sh('taper', 'Taper', 0, 40, 12, { unit: '%' }), sh('plinth', 'Plinth steps', 0, 3, 1), sh('lean', 'Lean', 0, 20, 0, { unit: '°' }), sh('leanDir', 'Lean toward', 0, 359, 90, { unit: '°' })],
    variants: [['Sea runes', { pal: 'deepslate', glowBlock: 'sea_lantern' }], ['Carved granite', { pal: 'greystone', glow: 'none' }], ['Redstone runes', { pal: 'stone', glowBlock: 'redstone_lamp' }], ['Amethyst runes', { pal: 'blackstone', glowBlock: 'amethyst' }], ['Glowstone runes', { pal: 'sandstone', glowBlock: 'glowstone' }]],
    defs: { pal: 'deepslate', glowAmt: 100, lDither: 10 },
    make(p, V) {
      const prims = [], n = Math.min(p.plinth, Math.floor(p.h / 6)), X = rx(p) - n, Z = rz(p) - n, hb = p.h - n;
      plinth(n, X, Math.max(0.5, Z), prims);
      const dome = clamp(X / hb * 0.9, 0.1, 0.5), s = stoneP({ h: hb, hx: X, hz: Math.max(0.5, Z), taper: p.taper / 100, round: 0.25, dome });
      // the face outline in front view: half width at height y
      const halfW = (y) => { const t = clamp(y / hb, 0, 1), cap = dome * hb, u = y - (hb - cap); let w = X * (1 - p.taper / 100 * t); if (u > 0) w *= Math.sqrt(Math.max(0, 1 - (u / cap) * (u / cap))); return w; };
      const inOutline = (x, y) => Math.abs(x) <= halfW(y) - 0.01;
      // the serpent band: one block in from the outline; the rune rows inside it
      const band = (x, y) => p.band && y > 1 && inOutline(x, y) && !inOutline(Math.abs(x) + 1.2, y) && inOutline(Math.abs(x) + 0.2, y) || (p.band && Math.abs(y - 1.5) < 0.5 && Math.abs(x) < halfW(y) - 1);
      const glyph = (x, y) => {
        const top = hb - dome * hb - 1, rows = Math.min(p.runes, Math.floor((top - 3) / 6));
        if (rows <= 0) return -1;
        const y0 = top - rows * 6;
        if (y < y0 || y >= top) return -1;
        const r = Math.floor((y - y0) / 6), ly = 4 - Math.floor(y - y0 - r * 6);
        if (ly < 0 || ly > 4) return -1;
        const cols = Math.floor((halfW(y) * 2 - (p.band ? 4 : 1) + 1) / 4);
        if (cols <= 0) return -1;
        const x0 = -(cols * 4 - 1) / 2, c = Math.floor((x - x0) / 4), lx = Math.floor(x - x0 - c * 4);
        if (c < 0 || c >= cols || lx > 2) return -1;
        const g = RUNES[Math.floor(V('rune', r * 40 + c) * RUNES.length)];
        return g[ly][lx] === '1' ? r * 40 + c : -1;
      };
      s.partAt = (x, y, z) => (Math.abs(z) > Math.max(0.5, Z) * (1 - p.taper / 100 * clamp(y / hb, 0, 1)) - 0.8 && (band(x, y) || glyph(x, y) >= 0) ? 'accent' : 'body');
      prims.push(place(s, [0, n, 0], lean(p)));
      // the glow pattern "runes" lights whole glyphs (the amount = how many)
      const L = lean(p);
      return { prims, runes: (mx, my, mz) => { const q = A.appT(L, [mx, my - n, mz]); const g = glyph(q[0], q[1]); return g >= 0 && Math.abs(q[2]) > 0.2 ? V('lit', g) : Infinity; } };
    } });

  MONO({ id: 'floating', name: 'Floating monolith', seed: true, floating: true, fitMain: true, size: { w: [2, 48, 6], d: [1, 24, 2], h: [6, 160, 24] }, key: ['hover', 'chips', 'pedestal', 'orbit'],
    params: [sh('hover', 'Hover', 1, 40, 4, { unit: 'blocks' }), sh('chips', 'Orbiting shards', 0, 24, 8), bool('pedestal', 'Pedestal', 'shape', true), sh('orbit', 'Orbit', 60, 400, 170, { unit: '%' }), sh('tiltO', 'Orbit tilt', 0, 45, 15, { unit: '°' })],
    variants: [['Void slab', { pal: 'obsidian', glow: 'edges', glowAmt: 50, glowBlock: 'crying' }], ['End relic', { pal: 'endstone', glowBlock: 'end_rod', glow: 'rings', glowAmt: 40 }], ['Prismarine tablet', { pal: 'prismarine', glow: 'core', glowAmt: 40 }]],
    defs: { pal: 'obsidian', lDither: 0 },
    make(p, V) {
      const prims = [], X = rx(p), Z = rz(p), ped = p.pedestal ? 2 : 0, y0 = ped + p.hover, bh = Math.max(2, p.h - y0);
      if (p.pedestal) {
        prims.push(boxP(-X - 2, 0, -Z - 2, X + 2, 1, Z + 2, 'base'), boxP(-X - 1, 1, -Z - 1, X + 1, 2, Z + 1, 'base'));
        prims.push(boxP(-Math.max(0.5, X - 1), 1.5, -Math.max(0.5, Z - 0.5), Math.max(0.5, X - 1), 2, Math.max(0.5, Z - 0.5), 'glow'));
      }
      prims.push(boxP(-X, y0, -Z, X, y0 + bh, Z, 'body', { main: true }));
      const rr = Math.max(X, Z) * p.orbit / 100 + 2.5, tilt = p.tiltO * RAD, s = clamp(Math.min(X, 3) * 0.55, 0.9, 2.6);
      for (let i = 0; i < p.chips; i++) {
        const a = (i / p.chips) * Math.PI * 2 + V('chip', 0) * 0.5, y = y0 + bh * 0.5 + Math.sin(a) * Math.sin(tilt) * rr;
        const sz = s * (0.85 + V('chip', i, 1) * 0.3);
        const c = Object.assign(crystal({ n: 4, h: sz * 3.2, rx: sz, tip: 0.45, btip: 0.45, double: true }), { part: 'body' });
        prims.push(place(c, [Math.cos(a) * rr, y - sz * 1.6, Math.sin(a) * rr * Math.cos(tilt)], mat({ y: -a / RAD, z: 20 + V('chip', i, 2) * 30 })));
      }
      return { prims };
    } });

  MONO({ id: 'split', name: 'Split monolith', size: { w: [3, 64, 10], d: [1, 32, 3], h: [4, 200, 22] }, key: ['gap', 'zig', 'open', 'seam'],
    params: [sh('gap', 'Gap', 1, 12, 2, { unit: 'blocks' }), sh('zig', 'Zigzag', 0, 100, 50, { unit: '%', tip: 'How far the split zigzags from side to side' }), sh('open', 'Lean apart', 0, 15, 3, { unit: '°' }), bool('seam', 'Glowing seam', 'shape', true), sh('plinth', 'Plinth steps', 0, 3, 1)],
    variants: [['Molten seam', { pal: 'basalt', glowBlock: 'magma' }], ['Sea rift', { pal: 'deepslate', glowBlock: 'sea_lantern' }], ['Crying split', { pal: 'obsidian', glowBlock: 'crying' }], ['Cold split', { pal: 'greystone', seam: false, open: 6 }]],
    defs: { pal: 'basalt', glowBlock: 'magma', lDither: 0 },
    make(p) {
      const prims = [], n = Math.min(p.plinth, Math.floor(p.h / 6)), X = rx(p) - n, Z = Math.max(0.5, rz(p) - n), hb = p.h - n, g = p.gap / 2;
      plinth(n, X + p.gap * 0, Z, prims);
      const per = Math.max(3, hb / 3), amp = X * 0.3 * p.zig / 100;
      const seam = (y) => { const t = ((y / per) % 1 + 1) % 1; return amp * (t < 0.5 ? 4 * t - 1 : 3 - 4 * t); };   // a crisp zigzag
      for (const sg of [-1, 1]) {
        const c = boxP(-X - g, 0, -Z, X + g, hb, Z, 'body');
        const f0 = c.f;
        c.f = (x, y, z) => Math.max(f0(x, y, z), sg * (seam(y) - x) + g);
        if (p.seam) c.partAt = (x, y) => (Math.abs(x - seam(y)) < g + 1.1 && y > 0.5 && y < hb - 1 ? 'glow' : 'body');
        c.box = [sg < 0 ? -X - g : -amp - g - 1, 0, -Z, sg < 0 ? amp + g + 1 : X + g, hb, Z];
        // each half leans away from the split about its outer foot
        const piv = [sg * (X + g), n, 0], R = mat({ z: -sg * p.open });
        const q = place(c, [0, 0, 0], I3), qf = q.f, Rt = (v) => A.appT(R, v);
        q.f = (x, y, z) => { const v = Rt([x - piv[0], y - piv[1], z]); return qf(v[0] + piv[0], v[1] + n, v[2]); };
        if (q.partAt) { const pa = q.partAt; q.partAt = (x, y, z) => { const v = Rt([x - piv[0], y - piv[1], z]); return pa(v[0] + piv[0], v[1] + n, v[2]); }; }
        q.box = [q.box[0] - hb * Math.sin(p.open * RAD) - 1, n, -Z, q.box[3] + hb * Math.sin(p.open * RAD) + 1, n + hb + 1, Z];
        q.grad = (x, y) => clamp(y / p.h, 0, 1);
        prims.push(q);
      }
      return { prims };
    } });

  MONO({ id: 'stepped', name: 'Stepped monolith', size: { w: [3, 80, 11], d: [3, 80, 11], h: [4, 200, 24] }, key: ['tiers', 'stepIn', 'cornice', 'litSteps'],
    params: [sh('tiers', 'Tiers', 2, 10, 4), sh('stepIn', 'Step in', 1, 6, 1, { unit: 'blocks' }), bool('cornice', 'Cornice', 'shape', true), bool('litSteps', 'Lit steps', 'shape', false), seg('heights', 'Tier heights', 'shape', [['even', 'Even'], ['falling', 'Getting shorter']], 'falling')],
    variants: [['Basalt steps', { pal: 'basalt', tiers: 5 }], ['Marble tower', { pal: 'quartzstone', tiers: 4, litSteps: true }], ['Tuff tower', { pal: 'tuff', tiers: 6, heights: 'even' }]],
    defs: { pal: 'quartzstone', lDither: 0 },
    make(p) {
      const prims = [], k = p.tiers, X = rx(p), Z = rz(p);
      const wts = []; for (let i = 0; i < k; i++) wts.push(p.heights === 'even' ? 1 : 1 - i * 0.6 / k);
      const tot = wts.reduce((a, b) => a + b, 0);
      let y = 0;
      for (let i = 0; i < k; i++) {
        const th = p.h * wts[i] / tot, hx = Math.max(0.5, X - i * p.stepIn), hz = Math.max(0.5, Z - i * p.stepIn), y0 = y;
        const c = boxP(-hx, y0, -hz, hx, y0 + th, hz, 'body');
        c.partAt = (x, yy, z) => {
          if (yy > y0 + th - 1) {
            if (p.litSteps && i < k - 1 && (Math.abs(x) > hx - p.stepIn - 0.01 || Math.abs(z) > hz - p.stepIn - 0.01) && (Math.abs(x) < hx - 0.6 && Math.abs(z) < hz - 0.6)) return 'glow';
            return p.cornice ? 'trim' : 'body';
          }
          return 'body';
        };
        prims.push(c);
        y += th;
      }
      return { prims };
    } });

  MONO({ id: 'twisted', name: 'Twisted monolith', tip: true, size: { w: [2, 48, 8], d: [2, 48, 8], h: [6, 256, 32] }, key: ['twist', 'taper', 'chamfer'],
    params: [sh('twist', 'Twist', 0, 720, 180, { unit: '°' }), sh('taper', 'Taper', 0, 70, 25, { unit: '%' }), sh('chamfer', 'Bevel', 0, 100, 0, { unit: '%' }), sh('tip', 'Pyramid top', 0, 40, 10, { unit: '% of height' }), sh('plinth', 'Plinth steps', 0, 3, 0)],
    variants: [['Spiral obsidian', { pal: 'obsidian', twist: 270 }], ['Copper corkscrew', { pal: 'copper', twist: 540, w: 8, d: 3 }], ['End helix', { pal: 'endstone', twist: 360, glow: 'edges', glowAmt: 40, glowBlock: 'end_rod' }]],
    defs: { pal: 'copper', lDither: 15 },
    make(p) {
      const prims = [], n = Math.min(p.plinth, Math.floor(p.h / 8)), X = rx(p), Z = rz(p);
      if (n) plinth(n, Math.max(X, Z) * 0.75, Math.max(X, Z) * 0.75, prims);
      const c = Object.assign(slab({ h: p.h - n, hx: X * (n ? 0.75 : 1), hz: Z * (n ? 0.75 : 1), taper: p.taper / 100, twist: p.twist, chamfer: p.chamfer / 100, tip: p.tip / 100 }), { part: 'body' });
      prims.push(place(c, [0, n, 0], I3));
      return { prims, tips: [tipAt([0, n, 0], I3, [0, p.h - n, 0])] };
    } });

  /* ======================================================================
   * Nature
   * ====================================================================== */
  const ROCKS = ['rockstone', 'greystone', 'sandrock', 'tuff', 'deepslate', 'basalt', 'sandstone', 'endstone', 'blackstone'];
  fam({ id: 'rock', group: 'nature', name: 'Rock', seed: true, pals: ROCKS, parts: ['body', 'base', 'trim', 'accent'], size: { w: [3, 128, 15], d: [3, 128, 12], h: [2, 160, 9] }, key: ['kind', 'lumps', 'strata', 'sink'],
    params: [seg('kind', 'Kind', 'shape', [['boulder', 'Boulder'], ['stack', 'Sea stack'], ['hoodoos', 'Hoodoos'], ['arch', 'Rock arch']], 'boulder'), sh('lumps', 'Side stones', 0, 6, 2, { tip: 'Boulder: smaller stones against it · Hoodoos: how many spires' }), sh('strata', 'Layers', 0, 100, 0, { unit: '%', tip: 'Horizontal bands of a second stone' }), sh('sink', 'Sunk in', 0, 60, 25, { unit: '%' }), sh('bumps', 'Bumps', 0, 100, 45, { unit: '%', tip: 'Gentle lumps over the surface (low frequency, never per block)' })],
    variants: [['Mossy boulder', { kind: 'boulder', pal: 'rockstone', moss: 50 }], ['Sea stack', { kind: 'stack', pal: 'sandrock', h: 36, w: 14, d: 12, strata: 70 }], ['Hoodoos', { kind: 'hoodoos', pal: 'sandrock', h: 22, w: 20, d: 16, lumps: 4, strata: 60 }], ['Desert arch', { kind: 'arch', pal: 'sandrock', w: 36, h: 20, d: 9, strata: 60 }], ['Granite tor', { kind: 'stack', pal: 'greystone', h: 14, w: 12, d: 10, strata: 0, bumps: 70 }]],
    defs: { pal: 'rockstone', lDither: 15 },
    make(p, V) {
      const prims = [], W = rx(p), Dz = rz(p), H = p.h, seed = (p.seed | 0) + 17, bump = p.bumps / 100;
      const strata = p.strata / 100, bt = clamp(Math.round(H / 8), 2, 5);
      const parted = (pr) => { pr.partAt = (x, y, z) => strataPart(bandAt(x, y, z, bt, 1, seed), strata); return pr; };
      if (p.kind === 'boulder') {
        const sink = p.sink / 100, ry = H / (2 - 2 * sink * 0.8), cy = H - ry;
        // a boulder is faceted, not an egg: a rounded body cut by a dozen planes (the Variation turns them)
        const main = ellipsoid({ rx: W * 1.12, ry: ry * 1.12, rz: Dz * 1.12 }), mf = main.f, amp = Math.min(W, ry, Dz) * 0.1 * bump, fq = 1.4 / Math.max(2, Math.min(W, Dz));
        const cut = jagged({ r: [W, ry, Dz], jag: 0.08 + 0.14 * bump, k: 12 }, (k, j) => V('facet', k, j)).f;
        prims.push(parted(place({ f: (x, y, z) => Math.max(mf(x, y, z), cut(x, y, z), y + cy - H) + (fbm(x * fq, y * fq, z * fq, seed) - 0.5) * 2 * amp, part: 'body', edge: (x, y, z) => false, grad: main.grad, box: [-W - amp - 1, -ry - 1, -Dz - amp - 1, W + amp + 1, ry + 1, Dz + amp + 1], main: true }, [0, cy, 0], I3)));
        for (let i = 0; i < p.lumps; i++) {
          const a = V('side', i, 0) * Math.PI * 2, s = 0.3 + V('side', i, 1) * 0.25, r = Math.min(W, Dz) * s;
          prims.push(parted(place(Object.assign(ellipsoid({ rx: r * 1.15, ry: r * 0.8, rz: r }), { part: 'body' }), [Math.cos(a) * (W * 0.92), r * 0.35, Math.sin(a) * (Dz * 0.92)], mat({ y: a / RAD }))));
        }
      } else if (p.kind === 'stack') {
        // a sea stack: horizontal strata that step in and out, a wave-cut notch at the foot, a flat green top
        const s = stoneP({ h: H, hx: W, hz: Dz, taper: 0.22, round: 0.55, dome: 0.04, amp: Math.min(W, Dz) * 0.14 * bump, seed });
        const f0 = s.f, step = (y) => { const b = Math.floor(y / bt); return (b % 2 ? -0.6 : 0) + (y < H * 0.12 ? (1 - y / (H * 0.12)) * Math.min(W, Dz) * 0.18 : 0); };
        s.f = (x, y, z) => f0(x, y, z) - step(y) * -1 + 0;
        s.f = (x, y, z) => f0(x, y, z) + step(y);
        s.partAt = (x, y, z) => (y > H - 1.2 ? 'base' : strataPart(bandAt(x, y, z, bt, 0.4, seed), strata));
        prims.push(s);
      } else if (p.kind === 'hoodoos') {
        const n = Math.max(1, p.lumps + 1);
        for (let i = 0; i < n; i++) {
          // spread evenly round the footprint (the first one tallest), slim columns under wider caps
          const a = (i / n) * Math.PI * 2 + V('hoo', i, 0) * 0.7, rr = n === 1 ? 0 : 0.5 + V('hoo', i, 1) * 0.3, hh = H * (i === 0 ? 1 : 0.5 + V('hoo', i, 2) * 0.4), sr = Math.min(W, Dz) * (n === 1 ? 0.45 : Math.max(0.12, 0.42 / Math.sqrt(n)) * (0.85 + V('hoo', i, 3) * 0.3));
          const o = [Math.cos(a) * rr * (W - sr), 0, Math.sin(a) * rr * (Dz - sr)];
          const col = stoneP({ h: hh - Math.max(1, sr * 0.7), hx: sr, hz: sr * 0.9, taper: 0.35, belly: -0.12, round: 0.75, dome: 0.02, amp: sr * 0.18 * bump, seed: seed + i });
          col.partAt = (x, y, z) => strataPart(bandAt(x, y, z, bt, 0, seed), strata);
          prims.push(place(col, o, I3));
          const capR = sr * 1.25, ch = Math.max(1, sr * 0.7);
          prims.push(place(Object.assign(stoneP({ h: ch, hx: capR, hz: capR * 0.9, round: 0.8, dome: 0.5, amp: capR * 0.12, seed: seed + 50 + i }), { part: 'trim' }), [o[0], hh - ch, o[2]], I3));
        }
      } else {
        // a natural arch: a thick band of rock over an oval opening, with strata
        const span = W * 0.62, rise = H * 0.62, t = Math.max(2, Math.min(W * 0.3, H * 0.38));
        const f = (x, y, z) => {
          const outer = Math.max(Math.abs(x) - W, y - H, -y, Math.abs(z) - Dz * (0.75 + 0.25 * smooth(H, 0, y)));
          const hole = Math.hypot(x / span, y / rise) - 1;
          const d = Math.max(outer, -hole * Math.min(span, rise));
          return d + (fbm(x * 0.12, y * 0.12, z * 0.12, seed) - 0.5) * 2 * bump * 1.2;
        };
        prims.push({ f, part: 'body', grad: (x, y) => clamp(y / H, 0, 1), box: [-W - 2, 0, -Dz - 2, W + 2, H + 1, Dz + 2], partAt: (x, y, z) => strataPart(bandAt(x, y, z, bt, 0.6, seed), strata) });
        void t;
      }
      return { prims };
    } });

  fam({ id: 'mountain', group: 'nature', name: 'Mountain', seed: true, pals: ['mountain', 'sandrock', 'deepslate', 'tuff'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [16, 256, 96], d: [16, 256, 96], h: [8, 192, 48] }, glow: false, key: ['peaks', 'ridges', 'snow', 'steep'],
    params: [sh('peaks', 'Peaks', 1, 6, 2), sh('ridges', 'Ridges', 0, 100, 60, { unit: '%' }), sh('snow', 'Snow line', 0, 100, 65, { unit: '% of height' }), sh('steep', 'Steepness', 50, 250, 130, { unit: '%' }), sh('grass', 'Grass up to', 0, 80, 35, { unit: '% of height' }), sh('plateau', 'Flat top', 0, 80, 0, { unit: '%', tip: 'Cuts the peaks flat: a mesa or a table mountain' }), sh('strata', 'Layers', 0, 100, 0, { unit: '%', tip: 'Bands of a second stone in the rock' })],
    variants: [['Alpine peak', { pal: 'mountain', peaks: 1, snow: 55 }], ['Twin peaks', { pal: 'mountain', peaks: 2 }], ['Red mesa', { pal: 'sandrock', steep: 250, snow: 100, grass: 0, ridges: 25, plateau: 55, strata: 70, h: 32 }], ['Dark range', { pal: 'deepslate', peaks: 4, w: 128, d: 80, snow: 70 }]],
    defs: { pal: 'mountain', lDither: 15, lCon: 115 },
    make(p, V) {
      const W = rx(p), Dz = rz(p), seed = (p.seed | 0) * 13 + 7, pk = [];
      for (let i = 0; i < p.peaks; i++) pk.push(i ? [(V('peak', i, 0) - 0.5) * 1.1, (V('peak', i, 1) - 0.5) * 1.1, 0.55 + V('peak', i, 2) * 0.35] : [(V('peak', 0, 0) - 0.5) * 0.3, (V('peak', 0, 1) - 0.5) * 0.3, 1]);
      const ex = p.steep / 100, rid = p.ridges / 100;
      const raw = (x, z) => {
        const u = x / W, v = z / Dz;
        let hh = 0;
        for (const [px, pz, s] of pk) { const r = Math.hypot(u - px, v - pz) / 1.05; hh = Math.max(hh, s * Math.pow(Math.max(0, 1 - r), ex)); }
        // ridged noise: sharp crests running down from the peaks, valleys between them
        const wx = u * 2.2 + (vnoise(u * 1.5, 1, v * 1.5, seed) - 0.5) * 0.8, wz = v * 2.2 + (vnoise(u * 1.5, 2, v * 1.5, seed) - 0.5) * 0.8;
        const r1 = 1 - Math.abs(vnoise(wx * 1.6, 3, wz * 1.6, seed + 5) * 2 - 1), r2 = 1 - Math.abs(vnoise(wx * 3.4, 4, wz * 3.4, seed + 9) * 2 - 1);
        const ridged = r1 * r1 * 0.65 + r2 * r2 * 0.35;
        const edge = smooth(1, 0.8, Math.hypot(u, v));
        const v0 = clamp(hh * (1 - rid * 0.45 + rid * 0.7 * ridged) * edge, 0, 1.2);
        const cap = 1 - p.plateau / 100 * 0.7;
        return p.plateau ? Math.min(v0, cap) / cap : v0;
      };
      const bt = clamp(Math.round(p.h / 10), 2, 6);
      const height = (x, z) => { const r = Math.hypot(x / W, z / Dz); return r <= 1 ? Math.max(1, p.h * raw(x, z)) : 0; };
      const slope = (x, z) => Math.hypot(height(x + 1, z) - height(x - 1, z), height(x, z + 1) - height(x, z - 1)) / 2;
      const partAt = (x, y, z) => {
        const sl = slope(x, z), n = (vnoise(x * 0.15, 0, z * 0.15, seed + 2) - 0.5) * p.h * 0.12;
        if (y > p.h * p.snow / 100 + n && sl < 1.6) return 'trim';                       // snow on what is not too steep
        if (y < p.h * p.grass / 100 + n && sl < 1.0) return 'base';                      // grass on the gentle lower slopes
        if (sl < 0.75 && y < p.h * 0.7 && vnoise(x * 0.3, y * 0.2, z * 0.3, seed + 4) > 0.62) return 'accent';   // scree
        if (!p.strata) return 'body';
        const sp = strataPart(bandAt(x, y, z, bt, 0.2, seed), p.strata / 100);
        return sp === 'trim' && p.pal === 'mountain' ? 'accent' : sp;   // (the mountain's trim is its snow)   // bare rock (in bands) on the cliffs
      };
      return { prims: [{ f: (x, y, z) => y - height(x, z), partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, p.h * 1.2 + 1, Dz], heightfield: true, height }] };
    } });

  fam({ id: 'volcano', group: 'nature', name: 'Volcano', seed: true, pals: ['volcano', 'deepslate', 'blackstone'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [16, 256, 72], d: [16, 256, 72], h: [8, 160, 36] }, glow: false, key: ['crater', 'depth', 'flows', 'lava'],
    params: [sh('crater', 'Crater width', 10, 60, 26, { unit: '%' }), sh('depth', 'Crater depth', 5, 80, 30, { unit: '% of height' }), sh('flows', 'Lava flows', 0, 10, 3), bool('lava', 'Lava lake', 'shape', true), sh('steep', 'Steepness', 60, 220, 140, { unit: '%' })],
    variants: [['Active volcano', { flows: 5 }], ['Sleeping cone', { flows: 0, lava: false, pal: 'deepslate' }], ['Caldera', { crater: 55, depth: 20, steep: 80, flows: 2 }]],
    defs: { pal: 'volcano', lDither: 15 },
    make(p, V) {
      const W = rx(p), Dz = rz(p), seed = (p.seed | 0) * 7 + 3, cw = p.crater / 100, dep = Math.max(2, p.h * p.depth / 100), ex = p.steep / 100;
      const flows = []; for (let i = 0; i < p.flows; i++) flows.push((i / Math.max(1, p.flows)) * Math.PI * 2 + V('flow', i) * 1.2);
      const cone = (r) => Math.pow(Math.max(0, (1 - r) / (1 - cw * 0.8)), ex);
      const rimN = (a) => (vnoise(Math.cos(a) * 2 + 5, 0, Math.sin(a) * 2 + 5, seed) - 0.5) * Math.max(1, p.h * 0.06);
      // a lava flow: a channel down the slope from a notch in the rim, meandering slowly
      const chan = (x, z) => {
        const u = x / W, v = z / Dz, r = Math.hypot(u, v), a = Math.atan2(v, u);
        if (r < cw * 0.95 || r > 0.98) return 0;
        for (let i = 0; i < flows.length; i++) {
          const ca = flows[i] + Math.sin(r * 7 + i * 1.7) * 0.12 * r, d = Math.abs(((a - ca) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * r * Math.min(W, Dz);
          const wdt = 0.7 + r * 1.6;
          if (d < wdt) return 1;
        }
        return 0;
      };
      const height = (x, z) => {
        const u = x / W, v = z / Dz, r = Math.hypot(u, v), a = Math.atan2(v, u);
        if (r > 1) return 0;
        let hh = p.h * Math.min(1, cone(r)) + rimN(a) * smooth(cw * 2, cw, r);
        if (r < cw) hh = Math.min(hh, p.h + rimN(a) - dep * (1 - Math.pow(r / cw, 3)));
        hh -= chan(x, z) * 1.2;
        return Math.max(1, Math.min(p.h, hh));
      };
      const lavaY = p.h - dep * 0.55;
      const partAt = (x, y, z) => {
        const r = Math.hypot(x / W, z / Dz);
        if (chan(x, z) || (r < cw && y < lavaY + 2 && p.lava)) return 'trim';              // magma under the lava
        if (r < cw * 1.25 && y > p.h - dep * 1.2) return 'accent';                          // the scorched rim
        return y < p.h * 0.3 + (vnoise(x * 0.12, 0, z * 0.12, seed) - 0.5) * p.h * 0.15 ? 'base' : 'body';   // ash below, dark rock above
      };
      const fluid = { id: 'lava', at: (x, y, z) => {
        const r = Math.hypot(x / W, z / Dz), hh = height(x, z);
        if (p.lava && r < cw && y <= lavaY && y >= hh - 0.5) return true;
        return chan(x, z) && y >= hh - 0.5 && y < hh + 0.5;
      } };
      return { prims: [{ f: (x, y, z) => y - height(x, z), partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, p.h + 2, Dz], heightfield: true, height }], fluid };
    } });

  fam({ id: 'crater', group: 'nature', name: 'Meteor crater', seed: true, pals: ['rockstone', 'sandrock', 'mountain', 'endstone'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [12, 200, 48], d: [12, 200, 48], h: [4, 60, 12] }, key: ['rim', 'meteor', 'ejecta', 'molten'],
    params: [sh('rim', 'Rim height', 0, 100, 40, { unit: '%' }), sh('meteor', 'Meteor size', 0, 40, 14, { unit: '%' }), sh('ejecta', 'Ejecta', 0, 100, 50, { unit: '%', tip: 'Rocks and dark streaks thrown out round the crater' }), bool('molten', 'Still glowing', 'shape', true)],
    variants: [['Fresh impact', { molten: true }], ['Old crater', { molten: false, moss: 35, meteor: 8, ejecta: 25 }], ['Desert impact', { pal: 'sandrock' }], ['End impact', { pal: 'endstone' }]],
    defs: { pal: 'rockstone', lDither: 12 },
    make(p, V) {
      const W = rx(p), Dz = rz(p), seed = (p.seed | 0) * 5 + 1;
      const rays = []; for (let i = 0; i < 7; i++) rays.push(V('ray', i) * Math.PI * 2);
      // flat land two blocks thick, a raised rim round a bowl whose floor is one block above the bottom, the meteor on it
      const ground = 2, ms = Math.min(W, Dz) * p.meteor / 100, rimH = Math.max(1, (p.h - ground) * (0.35 + 0.65 * p.rim / 100)), Rc = 0.6;
      const height = (x, z) => {
        const u = x / W, v = z / Dz, r = Math.hypot(u, v);
        if (r > 1) return 0;
        const q = r / Rc, n = (fbm(x * 0.1, 1, z * 0.1, seed) - 0.5) * 1.2;
        if (q < 1) return Math.max(1, 1 + (ground + rimH - 1) * Math.pow(q, 3) + n * q);          // the bowl: steep near the rim, flat floor
        return Math.max(1, ground + rimH * Math.exp(-Math.pow((q - 1) * 3.2, 2)) + n * 0.6);         // the rim falls away outside
      };
      const ray = (x, z) => { const a = Math.atan2(z, x), r = Math.hypot(x / W, z / Dz); return r > Rc && rays.some((ra) => Math.abs(Math.sin(a - ra)) * r * Math.min(W, Dz) < 0.5 + (1 - r) * 0.8 && Math.cos(a - ra) > 0) && p.ejecta > 0 && vnoise(x * 0.25, 0, z * 0.25, seed + 3) < 0.15 + p.ejecta / 300; };
      const partAt = (x, y, z) => {
        const r = Math.hypot(x / W, z / Dz);
        if (r < Rc * 0.45) return 'accent';                                                 // the scorched floor
        if (ray(x, z) && y >= ground - 0.5) return 'accent';                                // dark rays of thrown-out rock
        return 'body';
      };
      const depth = ground + rimH - 1;
      const prims = [{ f: (x, y, z) => y - height(x, z), partAt, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, p.h + 1, Dz], heightfield: true, height }];
      const floorY = 1; void depth;
      if (ms > 0.8) prims.push(place(Object.assign(jagged({ r: [ms, ms * 0.8, ms * 0.9], jag: 0.22, k: 16 }, (i, j) => V('meteor', i, j)), { part: 'accent' }), [0, floorY + ms * 0.4, 0], mat({ x: 15, y: V('meteor', 99) * 90 })));
      // ejecta: loose rocks on the ground outside the rim, fewer farther out
      const decorate = (api) => {
        if (!p.ejecta) return;
        const n = Math.round(p.ejecta / 100 * Math.min(W, Dz) * 2.2);
        for (let i = 0; i < n; i++) {
          const a = V('ej', i, 0) * Math.PI * 2, r = Rc + 0.1 + Math.pow(V('ej', i, 1), 1.6) * 0.35;
          const x = Math.cos(a) * r * W, z = Math.sin(a) * r * Dz;
          api.onTop(x, z, i % 3 === 0 ? 'accent' : 'body');
        }
      };
      return { prims, molten: p.molten && ms > 0.8 ? { r: ms + 1.2, y: floorY } : null, decorate };
    } });

  fam({ id: 'waterfall', group: 'nature', name: 'Waterfall cliff', seed: true, pals: ['rockstone', 'mountain', 'sandrock', 'deepslate', 'tuff'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [10, 160, 36], d: [8, 80, 24], h: [8, 160, 28] }, glow: false, key: ['fallW', 'ribbons', 'pool', 'ledges'],
    params: [sh('fallW', 'Fall width', 1, 16, 4, { unit: 'blocks' }), sh('ribbons', 'Ribbons', 1, 4, 2, { tip: 'The fall splits round rocks into this many ribbons' }), sh('pool', 'Pool', 0, 100, 60, { unit: '%' }), sh('ledges', 'Ledges', 0, 6, 2), sh('curve', 'Curve', 0, 100, 45, { unit: '%', tip: 'How much the cliff wraps round the pool' }), sh('strata', 'Layers', 0, 100, 0, { unit: '%', tip: 'Bands of a second stone in the cliff' })],
    variants: [['Mossy falls', { pal: 'rockstone', moss: 45 }], ['Canyon fall', { pal: 'sandrock', ledges: 4, curve: 70, strata: 70 }], ['Tall fall', { pal: 'mountain', h: 56, fallW: 3, ribbons: 1 }]],
    defs: { pal: 'mountain', lDither: 12 },
    make(p) {
      const W = rx(p), Dz = rz(p), seed = (p.seed | 0) * 3 + 2, fw = p.fallW, H = p.h;
      const lt = clamp(Math.round(H / (p.ledges + 2)), 2, 8);
      // the cliff face (z of the face at x, y): set back in a curve round the pool, ledges stick out in bands
      const face = (x, y) => -Dz * 0.15 + (x * x) / (W * W) * Dz * 1.1 * (p.curve / 100) + (fbm(x * 0.1, y * 0.08, 0, seed) - 0.5) * 2.2 - (p.ledges && Math.floor(y / lt) % 2 === 1 && y < H - 2 ? 1 : 0);
      const ground = 2, poolR = Math.max(2, Math.min(W * 0.55, Dz * 0.5) * p.pool / 100);
      const fz = (y) => face(0, y);
      const inPool = (x, z) => p.pool > 0 && Math.hypot(x / poolR, (z - fz(ground) - poolR * 0.85) / (poolR * 0.75)) < 1;
      const ribbon = (x) => {
        if (Math.abs(x) > fw / 2) return false;
        if (p.ribbons <= 1 || fw < 3) return true;
        const k = Math.floor((x + fw / 2) / fw * (p.ribbons * 2 - 1));
        return k % 2 === 0;
      };
      const f = (x, y, z) => {
        const cliff = Math.max(z - Dz, Math.abs(x) - W, y - H, -y, face(x, y) - z);
        const land = Math.max(y - ground, Math.abs(x) - W, Math.abs(z) - Dz, -y);
        return Math.min(cliff, land);
      };
      const river = (x, y, z) => Math.abs(x) <= fw / 2 + 0.01 && y > H - 1.01 && z > fz(H) - 0.5;
      const carve = (x, y, z) => river(x, y, z) || (inPool(x, z) && y > 0.99 && y < ground + 0.01);
      const partAt = (x, y, z) => {
        if (y > H - 1.1 && z > face(x, y) + 0.3) return 'base';                                     // grass on the top
        if (y <= ground + 0.01 && z < face(x, y) - 0.5) return Math.hypot(x / (poolR + 1.5), (z - fz(ground) - poolR * 0.85) / (poolR * 0.75 + 1.5)) < 1 ? 'accent' : 'base';
        return strataPart(Math.floor(y / lt), p.strata / 100);
      };
      const fluid = { id: 'water', at: (x, y, z) => {
        if (river(x, y, z)) return y <= H && y > H - 1.01;
        const zf = fz(y);
        if (ribbon(x) && z >= zf - 1.4 && z < zf - 0.4 && y >= ground && y < H) return true;             // the falling sheet, one block in front of the face
        if (inPool(x, z) && y > 0.99 && y <= ground) return true;
        return false;
      } };
      // foam where the fall hits the pool, rocks in the pool
      const decorate = (api) => {
        for (let x = -fw / 2; x <= fw / 2; x += 1) if (ribbon(x)) api.atModel(x, ground + 0.5, fz(ground) - 0.9 - 1, 'minecraft:white_stained_glass', true);
        if (p.ribbons > 1 && fw >= 3) for (let x = -fw / 2; x <= fw / 2; x += 1) if (!ribbon(x)) for (let y = ground + 1; y < H - 1; y += 3) api.atModel(x, y + 0.5, fz(y) - 0.9, 'body', false);
      };
      // built with the pool to the north; turned round so the fall faces south (the front view)
      const fl = (fn) => (x, y, z) => fn(x, y, -z);
      return { prims: [{ f: fl(f), part: 'body', grad: (x, y) => clamp(y / H, 0, 1), box: [-W, 0, -Dz, W, H, Dz], partAt: fl(partAt), carve: fl(carve) }], fluid: { id: 'water', at: fl(fluid.at) },
        decorate: (api) => decorate({ atModel: (x, y, z, v, o) => api.atModel(x, y, -z, v, o), onTop: (x, z, v) => api.onTop(x, -z, v) }) };
    } });

  fam({ id: 'mushroom', group: 'nature', name: 'Giant mushroom', seed: true, pals: ['redcap', 'browncap', 'glowcap'], parts: ['body', 'base', 'trim', 'accent'], size: { w: [6, 96, 23], d: [6, 96, 23], h: [6, 160, 26] }, key: ['capShape', 'capH', 'stem', 'spots'],
    params: [seg('capShape', 'Cap', 'shape', [['dome', 'Dome'], ['flat', 'Flat'], ['cone', 'Cone']], 'dome'), sh('capH', 'Cap height', 10, 60, 32, { unit: '% of height' }), sh('stem', 'Stem width', 10, 50, 22, { unit: '%' }), sh('spots', 'Spots', 0, 100, 50, { unit: '%' }), sh('bend', 'Bend', 0, 40, 10, { unit: '°' }), bool('gills', 'Gills', 'shape', true), bool('ring', 'Ring on the stem', 'shape', true)],
    variants: [['Fly agaric', { pal: 'redcap', spots: 60 }], ['Flat brown', { pal: 'browncap', capShape: 'flat', spots: 0, ring: false }], ['Warped cap', { pal: 'glowcap', capShape: 'cone', spots: 35 }], ['Tall parasol', { pal: 'browncap', capShape: 'flat', h: 36, w: 27, d: 27, capH: 18, stem: 12, spots: 30 }]],
    defs: { pal: 'redcap', lDither: 15 },
    make(p, V) {
      const W = rx(p), Dz = rz(p), ch = Math.max(2, p.h * p.capH / 100), st = Math.max(0.8, Math.min(W, Dz) * p.stem / 100), seed = (p.seed | 0) + 23;
      const bend = p.bend * RAD, bd = V('bend', 0) * Math.PI * 2, top = p.h - ch;
      const off = (y) => Math.sin(bend) * (y * y) / (2 * Math.max(4, top)), sx = (y) => off(y) * Math.cos(bd), sz = (y) => off(y) * Math.sin(bd);
      const cx = sx(top), cz = sz(top);
      // the stem: a bulb at the foot, a slight taper, a skirt (ring) under the cap
      const stemR = (y) => st * (1 + 0.55 * Math.max(0, 1 - y / Math.max(2, st * 2.5)) - 0.15 * clamp(y / top, 0, 1));
      const stem = { f: (x, y, z) => Math.max(Math.hypot(x - sx(y), z - sz(y)) - stemR(y), -y, y - top - ch * 0.6), part: 'base', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W, 0, -Dz, W, top + ch * 0.6, Dz] };
      const prims = [stem];
      if (p.ring && top > 5) {
        const ry = top * 0.78, rr = st * 1.9;
        prims.push({ f: (x, y, z) => { const r = Math.hypot(x - sx(ry), z - sz(ry)); return Math.max(r - rr, Math.abs(y - (ry - (r - st) * 0.5)) - 0.5, st * 0.8 - r); }, part: 'trim', grad: () => 0.5, box: [-W, ry - rr, -Dz, W, ry + 1, Dz] });
      }
      // the cap: a shell (thick in the middle, thin at the rim) with its underside hollow, so the gills show
      const shape = (r, Y) => (p.capShape === 'cone' ? r + Y - 1 : p.capShape === 'flat' ? Math.hypot(r, Y * 1.7) - 1 : Math.hypot(r, Y) - 1);
      const capF = (x, y, z) => {
        const X = (x - cx) / W, Z = (z - cz) / Dz, Y = (y - top) / ch, r = Math.hypot(X, Z);
        const outer = Math.max(shape(r, Y), -Y) * Math.min(W, ch);
        const inner = Math.max(shape(r / 0.97, (Y + 0.12) / 0.62), -(Y + 0.12)) * Math.min(W, ch);
        return Math.max(outer, -inner);
      };
      // spots: round, evenly spread (one per cell of a coarse grid, jittered), on the cap's outside
      const g = Math.max(3, Math.min(W, Dz) * 0.42), sr = Math.max(0.7, g * 0.28);
      // seen from above: discs on a jittered grid, so they sit evenly over the cap (and stretch a little down the sides)
      const spot = (x, y, z) => {
        if (!p.spots) return false;
        const gx = Math.floor((x - cx) / g), gz = Math.floor((z - cz) / g);
        for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
          const i = gx + a, k = gz + c;
          if (hash(i, 7, k, seed) > p.spots / 100) continue;
          const px = cx + (i + 0.25 + hash(i, 1, k, seed) * 0.5) * g, pz = cz + (k + 0.25 + hash(i, 2, k, seed) * 0.5) * g;
          if (Math.hypot(x - px, z - pz) < sr * (0.85 + hash(i, 3, k, seed) * 0.4)) return true;
        }
        return false;
      };
      const nG = Math.max(12, Math.round(Math.min(W, Dz) * 2.2));
      const cap = { f: capF, part: 'body', grad: (x, y) => clamp((y - top) / ch, 0, 1), box: [cx - W - 1, top - 1, cz - Dz - 1, cx + W + 1, p.h + 1, cz + Dz + 1],
        partAt: (x, y, z) => {
          const X = (x - cx) / W, Z = (z - cz) / Dz, Y = (y - top) / ch, r = Math.hypot(X, Z);
          const under = Math.max(shape(r / 0.97, (Y + 0.12) / 0.62), -(Y + 0.12)) > -0.2 && Y < 0.45;
          if (under) return p.gills && r > 0.2 && Math.abs(Math.sin(Math.atan2(Z, X) * nG / 2)) < 0.55 ? 'trim' : 'trim';
          return spot(x, y, z) ? 'accent' : 'body';
        } };
      prims.push(cap);
      return { prims };
    } });

  /* ======================================================================
   * Shapes
   * ====================================================================== */
  const BUILT = ['sandstone', 'stone', 'quartzstone', 'deepslate', 'terracotta', 'prismarine', 'blackstone', 'tuff', 'greystone', 'copper', 'endstone'];
  fam({ id: 'ziggurat', group: 'shapes', name: 'Ziggurat', pals: BUILT, parts: ['body', 'trim', 'accent'], size: { w: [9, 200, 41], d: [9, 200, 41], h: [4, 128, 20] }, key: ['tiers', 'stepIn', 'stairs', 'temple'],
    params: [sh('tiers', 'Tiers', 2, 20, 5), sh('stepIn', 'Step in', 1, 8, 3, { unit: 'blocks' }), bool('stairs', 'Stairway', 'shape', true), bool('temple', 'Temple on top', 'shape', true), bool('cornice', 'Cornice', 'shape', true)],
    variants: [['Desert ziggurat', { pal: 'sandstone' }], ['Jungle temple', { pal: 'stone', moss: 40, weather: 30 }], ['Dark pyramid', { pal: 'blackstone', glow: 'edges', glowAmt: 12, glowBlock: 'shroomlight' }], ['Marble terraces', { pal: 'quartzstone', tiers: 7, stepIn: 2, temple: false }]],
    defs: { pal: 'sandstone', lDither: 0 },
    make(p) {
      const k = p.tiers, X = rx(p), Z = rz(p), prims = [];
      // the stairway sticks out in front of the tiers: they are set back by that much on the south side
      const out = p.stairs ? Math.max(1, Math.round(Math.min(p.h * 0.35, Z * 0.3))) : 0, Zt = Z - out / 2, zc = -out / 2;
      const topX = Math.max(1, X - k * p.stepIn), topZ = Math.max(1, Zt - k * p.stepIn);
      const tempH = p.temple ? clamp(Math.round(Math.min(topX, topZ) * 1.1), 3, Math.max(3, Math.floor(p.h * 0.35))) : 0;
      const th = Math.max(1, (p.h - tempH) / k), top = th * k;
      for (let i = 0; i < k; i++) {
        const hx = Math.max(1, X - i * p.stepIn), hz = Math.max(1, Zt - i * p.stepIn), y0 = i * th;
        const c = boxP(-hx, y0, zc - hz, hx, y0 + th, zc + hz, 'body');
        if (p.cornice) c.partAt = (x, y) => (y > y0 + th - 1 && th > 1.5 ? 'trim' : 'body');
        prims.push(c);
      }
      if (p.stairs) {
        // a straight stairway up the south face, one block up for one block in (true stairs), with a rail each side
        const sw = Math.max(1, Math.round(Math.min(X, Z) * 0.18)), z1 = Z, z0 = zc + topZ, sl = top / Math.max(1, z1 - z0);
        const ramp = { f: (x, y, z) => Math.max(Math.abs(x) - sw, -y, y - top, z - z1, (y - (z1 - z) * sl) / Math.hypot(1, sl), z0 - 1 - z), part: 'body', grad: () => 0.5, box: [-sw - 1, 0, z0 - 1, sw + 1, top, z1 + 1] };
        const rail = { f: (x, y, z) => Math.max(Math.abs(Math.abs(x) - sw - 0.5) - 0.5, -y, y - top - 1, z - z1, (y - 1 - (z1 - z) * sl) / Math.hypot(1, sl), z0 - 1 - z), part: 'trim', grad: () => 0.5, box: [-sw - 2, 0, z0 - 1, sw + 2, top + 1, z1 + 1] };
        prims.push(ramp, rail);
      }
      if (p.temple) {
        const hx = Math.max(1, topX * 0.75), hz = Math.max(1, topZ * 0.75), y0 = top, door = Math.max(0.5, Math.min(hx * 0.3, 1.5));
        const t = boxP(-hx, y0, zc - hz, hx, y0 + tempH - 1, zc + hz, 'body');
        t.carve = (x, y, z) => z > zc + hz - 1.2 && Math.abs(x) < door && y < y0 + Math.max(2, tempH - 2);
        prims.push(t, boxP(-hx - 1, y0 + tempH - 1, zc - hz - 1, hx + 1, y0 + tempH, zc + hz + 1, 'trim'));
      }
      return { prims };
    } });

  fam({ id: 'arch', group: 'shapes', name: 'Arch and bridge', pals: BUILT, parts: ['body', 'trim', 'accent'], size: { w: [7, 200, 31], d: [1, 40, 5], h: [4, 120, 17] }, key: ['archShape', 'ring', 'piers', 'deck'],
    params: [seg('archShape', 'Shape', 'shape', [['round', 'Round'], ['pointed', 'Pointed'], ['flat', 'Flat']], 'round'), sh('ring', 'Arch ring', 1, 6, 2, { unit: 'blocks', tip: 'Thickness of the band of arch stones round the opening' }), sh('piers', 'Pier width', 1, 20, 4, { unit: 'blocks' }), bool('deck', 'Bridge deck', 'shape', false), bool('keystone', 'Keystone', 'shape', true), sh('above', 'Wall above', 0, 20, 2, { unit: 'blocks' })],
    variants: [['Roman arch', { archShape: 'round', piers: 5 }], ['Gothic arch', { archShape: 'pointed', pal: 'deepslate', d: 3 }], ['Stone bridge', { deck: true, w: 48, h: 14, d: 7, pal: 'stone', piers: 6 }], ['Desert gate', { pal: 'sandstone', archShape: 'flat', w: 21, h: 13 }]],
    defs: { pal: 'stone', lDither: 0 },
    make(p) {
      const W = rx(p), Z = rz(p), deck = p.deck ? 2 : 0, H = p.h - deck, sp = Math.max(1, W - p.piers), t = p.ring, top = Math.max(t + 1, H - p.above);
      // the intrados: how far a point is inside the opening (> 0 inside), in blocks
      const rise = p.archShape === 'flat' ? 0 : p.archShape === 'pointed' ? Math.min(top - t, sp * 1.3) : Math.min(top - t, sp);
      const spring = Math.max(0, top - t - rise);
      const open = (x, y) => {
        const ax = Math.abs(x);
        if (y < spring) return sp - ax;
        if (p.archShape === 'flat') return Math.min(sp - ax, top - t - y);
        if (p.archShape === 'pointed') { const R = (sp * sp + rise * rise) / (2 * sp), cxp = sp - R; return R - Math.hypot(ax - cxp, (y - spring) * (sp * 1.3 > rise ? 1 : 1)); }
        return (1 - Math.hypot(ax / sp, (y - spring) / Math.max(0.5, rise))) * Math.min(sp, Math.max(0.5, rise));
      };
      const f = (x, y, z) => Math.max(Math.abs(x) - W, y - H, -y, Math.abs(z) - Z, Math.min(open(x, y), y > spring - 0.01 ? 99 : open(x, y)) > 0 ? Math.min(open(x, y), 0.6) : -99);
      const body = { f: (x, y, z) => Math.max(Math.abs(x) - W, y - H, -y, Math.abs(z) - Z, open(x, y)), part: 'body', grad: (x, y) => clamp(y / H, 0, 1), box: [-W - 1, 0, -Z - 1, W + 1, H + 1, Z + 1],
        partAt: (x, y) => {
          const o = open(x, y);
          if (o > -t - 0.01 && y > spring - 0.01) return p.keystone && Math.abs(x) < Math.max(0.6, t * 0.5) && y > spring + rise - 0.5 ? 'accent' : 'trim';   // voussoirs, keystone
          if (y > H - 1.01 && !p.deck) return 'trim';                                       // the cornice
          if (y < 1 && Math.abs(x) > sp) return 'trim';                                     // the pier plinths
          return 'body';
        } };
      void f;
      const prims = [body];
      if (p.deck) {
        prims.push(boxP(-W, H, -Z, W, H + 1, Z, 'trim'));
        prims.push(boxP(-W, H + 1, -Z, W, H + 2, -Z + 1, 'trim'), boxP(-W, H + 1, Z - 1, W, H + 2, Z, 'trim'));
      }
      return { prims };
    } });

  fam({ id: 'helix', group: 'shapes', name: 'Helix and stairs', pals: ['quartzstone', 'stone', 'deepslate', 'copper', 'prismarine', 'blackstone', 'amethyst', 'sandstone'], parts: ['body', 'trim', 'accent'], size: { w: [5, 120, 15], d: [5, 120, 15], h: [4, 256, 32] }, key: ['kind', 'turns', 'band', 'column'],
    params: [seg('kind', 'Kind', 'shape', [['stair', 'Spiral stair'], ['helix', 'Helix'], ['double', 'Double helix']], 'stair'), sh('turns', 'Turns', 1, 12, 2), sh('band', 'Band width', 1, 16, 4, { unit: 'blocks' }), bool('column', 'Centre column', 'shape', true), bool('rail', 'Railing', 'shape', true), sh('bandT', 'Band thickness', 1, 6, 1, { unit: 'blocks' })],
    variants: [['Spiral staircase', { kind: 'stair' }], ['DNA tower', { kind: 'double', pal: 'amethyst', glow: 'rings', glowAmt: 40, rail: false }], ['Copper coil', { kind: 'helix', pal: 'copper', turns: 5, column: false, rail: false }]],
    defs: { pal: 'quartzstone', lDither: 0 },
    make(p) {
      const W = rx(p), Dz = rz(p), R = Math.min(W, Dz), rc = p.column ? Math.max(0.6, R * 0.16) : 0, band = p.kind === 'stair' ? R - Math.max(0, rc - 0.3) : Math.min(p.band, R - rc), sq = W / Dz;
      const prims = [];
      if (p.kind === 'stair') {
        // one step per block of height, a wedge from the column to the outside; each turn has h / turns steps
        const per = Math.max(4, Math.round(p.h / p.turns)), dA = Math.PI * 2 / per, thick = Math.max(1, p.bandT);
        const stepAt = (x, z) => { let a = Math.atan2(z * sq, x); if (a < 0) a += Math.PI * 2; return Math.floor(a / dA); };
        const f = (x, y, z) => {
          const r = Math.hypot(x, z * sq);
          if (r > R + 0.01 || r < R - band - 0.01) return Math.max(r - R, R - band - r, 0.3);
          const j = stepAt(x, z);
          let best = Infinity;
          for (let turn = Math.floor((y - 1) / per) - 1; turn <= Math.floor(y / per) + 1; turn++) {
            const yy = turn * per + j;
            if (yy < 0 || yy >= p.h) continue;
            best = Math.min(best, Math.max(yy - y, y - (yy + thick)));
          }
          return Math.max(best, -0.0);
        };
        prims.push({ f, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W - 1, 0, -Dz - 1, W + 1, p.h, Dz + 1], partAt: (x, y, z) => (Math.hypot(x, z * sq) > R - 1.01 && p.rail ? 'trim' : 'body') });
        if (p.rail) {
          // the railing: a band one block high along the outer edge of every step
          prims.push({ f: (x, y, z) => {
            const r = Math.hypot(x, z * sq);
            if (r > R + 0.01 || r < R - 1.01) return Math.max(r - R, R - 1 - r, 0.3);
            const j = stepAt(x, z);
            let best = Infinity;
            for (let turn = Math.floor((y - 2) / per) - 1; turn <= Math.floor(y / per) + 1; turn++) { const yy = turn * per + j + thick; if (yy < 0 || yy > p.h) continue; best = Math.min(best, Math.max(yy - y, y - (yy + 1))); }
            return best;
          }, part: 'trim', grad: () => 0.5, box: [-W - 1, 0, -Dz - 1, W + 1, p.h, Dz + 1] });
        }
      } else {
        const strands = p.kind === 'double' ? 2 : 1, bt = p.bandT, pitch = p.h / p.turns;
        const f = (x, y, z) => {
          const r = Math.hypot(x, z * sq), a = Math.atan2(z * sq, x);
          let best = Infinity;
          for (let s = 0; s < strands; s++) {
            const ph = ((a / (Math.PI * 2) + s / strands) % 1 + 1) % 1;
            let dy = (((y / pitch) - ph) % 1 + 1) % 1; dy = Math.min(dy, 1 - dy) * pitch;
            best = Math.min(best, Math.max(dy - bt / 2, Math.abs(r - (R - band / 2)) - band / 2, -y, y - p.h));
          }
          return best;
        };
        prims.push({ f, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-W - 1, 0, -Dz - 1, W + 1, p.h, Dz + 1] });
        if (strands === 2) {
          // rungs across the middle every few blocks (the base pairs)
          const gap = Math.max(2, Math.round(pitch / 6));
          prims.push({ f: (x, y, z) => {
            const yy = Math.round(y / gap) * gap; if (yy < 1 || yy > p.h - 1) return 1;
            const a = (yy / pitch) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), along = x * c + z * sq * sn, across = -x * sn + z * sq * c;
            return Math.max(Math.abs(y - yy) - 0.5, Math.abs(across) - 0.5, Math.abs(along) - (R - band));
          }, part: 'accent', grad: () => 0.5, box: [-W, 0, -Dz, W, p.h, Dz] });
        }
      }
      if (p.column) prims.push({ f: (x, y, z) => Math.max(Math.hypot(x, z * sq) - rc, -y, y - p.h), part: 'trim', grad: () => 0.5, box: [-rc - 1, 0, -rc - 1, rc + 1, p.h, rc + 1] });
      return { prims };
    } });

  // ---------------- the classic shapes, now with palettes, light, detail and Inside ----------------
  const SOLIDS = ['greystone', 'stone', 'quartzstone', 'sandstone', 'deepslate', 'blackstone', 'copper', 'prismarine', 'terracotta', 'amethyst', 'ice', 'emerald', 'obsidian', 'endstone', 'snow'];
  const bandsP = sh('bands', 'Bands', 0, 12, 0, { tip: 'Horizontal bands in the trim block' });
  const banded = (prim, p, h0, h1) => { if (p.bands) { const pa = prim.partAt; prim.partAt = (x, y, z) => { const k = Math.floor((y - h0) / Math.max(1, (h1 - h0) / (p.bands * 2 + 1))); return k % 2 === 1 ? 'trim' : pa ? pa(x, y, z) : prim.part; }; } return prim; };
  const SHAPE = (o) => fam(Object.assign({ group: 'shapes', pals: SOLIDS, parts: ['body', 'trim', 'accent'], defs: { pal: 'quartzstone', lDither: 12 } }, o));
  SHAPE({ id: 'sphere', name: 'Sphere', size: { w: [3, 160, 21], d: [3, 160, 21], h: [3, 160, 21] }, key: ['w', 'h', 'bands'],
    params: [bandsP],
    variants: [['Planet', { pal: 'terracotta', bands: 5 }], ['Marble ball', { pal: 'quartzstone' }], ['Ice orb', { pal: 'ice', glow: 'core', glowAmt: 30 }], ['Egg', { w: 15, d: 15, h: 21, pal: 'sandstone' }]],
    make(p) { return { prims: [banded(Object.assign(ellipsoid({ rx: rx(p), ry: p.h / 2, rz: rz(p) }), { part: 'body', box: [-rx(p) - 1, 0, -rz(p) - 1, rx(p) + 1, p.h, rz(p) + 1] }), p, 0, p.h)].map((q) => { const f0 = q.f; return Object.assign(q, { f: (x, y, z) => f0(x, y - p.h / 2, z), grad: (x, y) => clamp(y / p.h, 0, 1) }); }) }; } });
  SHAPE({ id: 'dome', name: 'Dome', size: { w: [3, 160, 21], d: [3, 160, 21], h: [2, 120, 11] }, key: ['drum', 'ribs', 'oculus'],
    params: [sh('drum', 'Drum', 0, 60, 0, { unit: '% of height', tip: 'A straight wall under the dome' }), sh('ribs', 'Ribs', 0, 16, 0, { tip: 'Raised ribs from the foot to the top, in the trim block' }), bool('oculus', 'Opening on top', 'shape', false), bandsP],
    variants: [['Observatory', { pal: 'quartzstone', drum: 30, ribs: 8 }], ['Igloo', { pal: 'snow', w: 11, d: 11, h: 6 }], ['Copper dome', { pal: 'copper', ribs: 12, drum: 15 }]],
    make(p) {
      const X = rx(p), Z = rz(p), dh = p.h * p.drum / 100, rh = p.h - dh, oc = p.oculus ? Math.max(0.8, Math.min(X, Z) * 0.18) : 0;
      const f = (x, y, z) => {
        const d = y < dh ? superE(x, z, X, Z, 2) : (Math.hypot(x / X, (y - dh) / rh, z / Z) - 1) * Math.min(X, Z, rh);
        const o = oc ? oc - Math.hypot(x, z) : -99;
        return Math.max(d, -y, y - p.h, o);
      };
      const prim = { f, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-X - 1, 0, -Z - 1, X + 1, p.h, Z + 1] };
      if (p.ribs) prim.partAt = (x, y, z) => (Math.abs(Math.sin(Math.atan2(z / Z, x / X) * p.ribs / 2)) < 0.12 + 0.6 / Math.max(X, Z) ? 'trim' : y < dh && y > dh - 1 ? 'trim' : 'body');
      return { prims: [banded(prim, p, 0, p.h)] };
    } });
  SHAPE({ id: 'cylinder', name: 'Cylinder', size: { w: [2, 160, 15], d: [2, 160, 15], h: [1, 256, 21] }, key: ['bands', 'rims', 'flutes'],
    params: [bandsP, bool('rims', 'Rims', 'shape', true, { tip: 'A ring of trim at the top and the foot' }), sh('flutes', 'Flutes', 0, 24, 0, { tip: 'Grooves down the sides, like a column' })],
    variants: [['Column', { pal: 'quartzstone', w: 7, d: 7, h: 30, flutes: 12 }], ['Silo', { pal: 'copper', w: 13, d: 13, h: 28, bands: 4 }], ['Tower', { pal: 'stone', w: 15, d: 15, h: 32, rims: true }]],
    make(p) {
      const X = rx(p), Z = rz(p);
      const prim = { f: (x, y, z) => { let d = superE(x, z, X, Z, 2); if (p.flutes && Math.min(X, Z) > 2.5) d += Math.max(0, Math.cos(Math.atan2(z / Z, x / X) * p.flutes)) * 0.7 - 0.2; return Math.max(d, -y, y - p.h); }, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-X - 1, 0, -Z - 1, X + 1, p.h, Z + 1] };
      if (p.rims) prim.partAt = (x, y) => (y < 1 || y > p.h - 1 ? 'trim' : 'body');
      return { prims: [banded(prim, p, 1, p.h - 1)] };
    } });
  SHAPE({ id: 'cone', name: 'Cone', tip: true, size: { w: [2, 160, 17], d: [2, 160, 17], h: [2, 256, 21] }, key: ['h', 'curve', 'bands'],
    params: [sh('curve', 'Curve', -60, 60, 0, { unit: '%', tip: 'Below 0 the sides sag in (a spire), above 0 they bulge out (a bell)' }), bandsP],
    variants: [['Spire', { pal: 'deepslate', w: 9, d: 9, h: 30, curve: -40 }], ['Witch hat', { pal: 'blackstone', curve: -55, w: 13, d: 13, h: 19 }], ['Tent', { pal: 'terracotta', curve: 20 }]],
    make(p) {
      const X = rx(p), Z = rz(p), k = 1 + p.curve / 100 * 0.9;
      const prim = { f: (x, y, z) => { const t = clamp(y / p.h, 0, 1), s = Math.pow(1 - t, k > 1 ? 1 / (2 - k) : k); return Math.max(superE(x, z, Math.max(0.05, X * s), Math.max(0.05, Z * s), 2), -y, y - p.h); }, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-X - 1, 0, -Z - 1, X + 1, p.h, Z + 1] };
      return { prims: [banded(prim, p, 0, p.h)], tips: [tipAt([0, 0, 0], I3, [0, p.h, 0])] };
    } });
  SHAPE({ id: 'pyramid', name: 'Pyramid', size: { w: [3, 200, 21], d: [3, 200, 21], h: [2, 128, 11] }, key: ['style', 'gild', 'bands'],
    params: [seg('style', 'Sides', 'shape', [['smooth', 'Smooth'], ['stepped', 'Stepped']], 'smooth'), bool('gild', 'Capstone', 'shape', true, { tip: 'The top in the accent block' }), bandsP],
    variants: [['Great pyramid', { pal: 'sandstone', w: 41, d: 41, h: 21 }], ['Step pyramid', { pal: 'sandstone', style: 'stepped' }], ['Obsidian pyramid', { pal: 'obsidian', gild: false, glow: 'edges', glowAmt: 40, glowBlock: 'crying' }]],
    defs: { pal: 'sandstone', lDither: 0 },
    make(p) {
      const X = rx(p), Z = rz(p);
      const prim = { f: (x, y, z) => { let t = clamp(y / p.h, 0, 1); if (p.style === 'stepped') t = Math.floor(y) / p.h; const s = 1 - t; return Math.max(Math.abs(x) - X * s, Math.abs(z) - Z * s, -y, y - p.h); }, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-X - 1, 0, -Z - 1, X + 1, p.h, Z + 1],
        edge: (x, y, z) => { const s = 1 - clamp(y / p.h, 0, 1); return Math.abs(Math.abs(x) - X * s) < 0.9 && Math.abs(Math.abs(z) - Z * s) < 0.9; } };
      if (p.gild) prim.partAt = (x, y) => (y > p.h * 0.88 ? 'accent' : 'body');
      return { prims: [banded(prim, p, 0, p.h * 0.88)] };
    } });
  SHAPE({ id: 'torus', name: 'Torus', size: { w: [5, 200, 25], d: [5, 200, 25], h: [2, 80, 7] }, key: ['w', 'tube', 'bands'],
    params: [sh('tube', 'Tube', 10, 50, 28, { unit: '% of width', tip: 'How thick the ring is across' }), sh('bands', 'Segments', 0, 24, 0, { tip: 'Segments round the ring in the trim block' })],
    variants: [['Ring', { pal: 'quartzstone' }], ['Portal ring', { pal: 'obsidian', glow: 'edges', glowAmt: 40, glowBlock: 'crying' }], ['Life ring', { pal: 'terracotta', bands: 8, tube: 35 }]],
    make(p) {
      const X = rx(p), Z = rz(p), t = Math.max(0.6, Math.min(X, Z) * p.tube / 100), cy = p.h / 2, sq = X / Z;
      const prim = { f: (x, y, z) => { const r = Math.hypot(x, z * sq); return (Math.hypot((r - (X - t)) / t, (y - cy) / cy) - 1) * Math.min(t, cy); }, part: 'body', grad: (x, y) => clamp(y / p.h, 0, 1), box: [-X - 1, 0, -Z - 1, X + 1, p.h, Z + 1] };
      if (p.bands) prim.partAt = (x, y, z) => (Math.floor(((Math.atan2(z * sq, x) / (Math.PI * 2)) + 1) * p.bands * 2) % 2 ? 'trim' : 'body');
      return { prims: [prim] };
    } });
})();
