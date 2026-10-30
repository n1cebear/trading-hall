/**
 * Builds light shading (pure, no DOM): shade a build from any light direction onto a ramp of blocks, optionally in a
 * light colour.
 *
 *   shade(s, o)   -> a new schematic (the same object when o is off). o = {
 *     az, el            light direction, degrees: azimuth seen from above, 0 = north, 90 = east, 180 = south, 270 =
 *                       west; elevation -90 (from below) .. 90 (from straight above). The light comes FROM there.
 *     vec               (instead of az / el) the direction toward the light, [x, y, z]
 *     ramp              block ids from shadow to highlight (3-9 used; any length is resampled to `steps`)
 *     steps             3..9 shades, ambient 0..1, contrast 0.5..2, dither 0..1 (0 = clean bands), ao 0..1,
 *                       shadows (true = a simple ray test toward the light), rim 0..1 (light on the terminator)
 *     region            [x0, y0, z0, x1, y1, z1] (inclusive) or null; only: Set of base ids to change, or null
 *     colour            { light: [r, g, b] 0..1, shadow: [r, g, b] | null, tint 0..1, hue 0..1 (cool shadows, warm
 *                       highlights), pool: 'all' | 'concrete' | 'terracotta' | 'wool' | 'stone' | 'glass' | 'custom',
 *                       custom: [ids] }  (null = plain ramp)
 *   }
 * Per exposed block: a normal from the empty cells around it (26 neighbours, nearer ones weigh more), Lambert with
 * ambient, ambient occlusion from the solid cells on its open side, an optional shadow ray, a rim term, contrast, then
 * a step on the ramp (ordered 4 x 4 x 4 Bayer dither, so the result is the same every time). Hidden blocks take the
 * middle of the ramp. With a light colour the ramp step's colour is multiplied by the light (and shadow) colour,
 * blended by `tint`, shifted by `hue`, and the nearest block of the allowed pool by colour (CIE Lab, from
 * js/data/block-colours.js) is used; tint 0 and hue 0 give exactly the plain ramp.
 * Stairs, slabs and walls take the ramp block's own part when it has one (else they stay); thin blocks, functional
 * blocks and blocks with data (chests, signs ...) are never changed, so block entities and entities pass through.
 *
 *   lightVec(az, el), RAMPS, rampOf(key), rampFrom(block, n, pool), POOLS, pool(key, custom), lab(rgb), nearest(...)
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const DT = () => TH.builds.detail;
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function lightVec(az, el) {
    const a = (+az || 0) * RAD, e = clamp(+el || 0, -90, 90) * RAD;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  }
  /** Quick directions: [key, label, az, el]. 'Front' is the south side, the one the Front view looks at. */
  const LIGHT_KEYS = [
    ['top', 'Top', 0, 90], ['front', 'Front', 180, 35], ['back', 'Back', 0, 35], ['left', 'Left', 270, 35], ['right', 'Right', 90, 35],
    ['tl', 'Top left', 225, 55], ['tr', 'Top right', 135, 55], ['low', 'Low sun', 225, 12], ['below', 'Below', 180, -60],
  ];
  const LIGHT_COLOURS = [
    ['white', 'White', [1, 1, 1]], ['sun', 'Warm sun', [1, 0.86, 0.62]], ['moon', 'Cool moon', [0.62, 0.74, 1]], ['pink', 'Neon pink', [1, 0.35, 0.8]],
    ['cyan', 'Neon cyan', [0.3, 1, 0.95]], ['amethyst', 'Amethyst', [0.72, 0.45, 1]], ['fire', 'Fire', [1, 0.55, 0.2]], ['toxic', 'Toxic', [0.6, 1, 0.25]],
  ];

  /* ---- colours ---- */
  const colours = () => (TH.data && TH.data.blockColours) || {};
  function lab(rgb) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = f(rgb[0]), G = f(rgb[1]), B = f(rgb[2]);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const fx = t(X), fy = t(Y), fz = t(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  const labCache = new Map();
  const labOf = (name) => { let v = labCache.get(name); if (!v) { const c = colours()[name]; v = c ? lab(c) : null; labCache.set(name, v); } return v; };
  const nameOf = (id) => C().parse(id).name;
  const lum = (id) => { const l = labOf(nameOf(id)); return l ? l[0] : 50; };

  /* ---- block pools for the colour mode ---- */
  const POOLS = [['all', 'All blocks'], ['concrete', 'Concrete'], ['terracotta', 'Terracotta'], ['wool', 'Wool'], ['stone', 'Stone'], ['glass', 'Glass'], ['custom', 'My list']];
  const poolCache = new Map();
  function pool(key, custom) {
    if (key === 'custom') return (custom || []).map((id) => C().parse(id).base).filter((b) => labOf(nameOf(b)));
    if (poolCache.has(key)) return poolCache.get(key);
    const core = C(), names = Object.keys(colours()).filter((n) => {
      const d = core.def('minecraft:' + n);
      if (d.shape !== 'cube' || d.fn || !d.fam || /glazed|_ore$|command|spawner|shulker|sus|_log$|_wood$|_stem$|hyphae|grass_block|mycelium|podzol|farmland|leaves|tnt|sponge|infested|reinforced|budding|crafter|vault|bookshelf|pumpkin|melon|hay|honey|slime|target|bee|barrel|loom|furnace|table|chest|anchor|lodestone/.test(n)) return false;
      if (key === 'concrete') return /_concrete$/.test(n);
      if (key === 'terracotta') return /terracotta$/.test(n);
      if (key === 'wool') return /_wool$/.test(n);
      if (key === 'glass') return /glass$/.test(n) && n !== 'tinted_glass';
      if (key === 'stone') return ['stone', 'deep', 'sand', 'nether', 'end'].includes(d.grp) && !/concrete|terracotta|wool|glass/.test(n);
      return d.fam === 'cube' || d.fam === 'glass';
    }).map((n) => 'minecraft:' + n);
    poolCache.set(key, names);
    return names;
  }
  function nearest(L, list) {
    let best = list[0], bd = Infinity;
    for (const id of list) {
      const l = labOf(nameOf(id));
      if (!l) continue;
      const d = (l[0] - L[0]) * (l[0] - L[0]) + (l[1] - L[1]) * (l[1] - L[1]) + (l[2] - L[2]) * (l[2] - L[2]);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  /* ---- ramps: shadow to highlight ---- */
  const RAMPS = {
    stone: ['deepslate', 'cobbled_deepslate', 'tuff', 'andesite', 'stone', 'polished_andesite', 'diorite', 'calcite'],
    amethyst: ['obsidian', 'crying_obsidian', 'purple_terracotta', 'purple_concrete', 'amethyst_block', 'purpur_block', 'magenta_terracotta'],
    sand: ['brown_terracotta', 'orange_terracotta', 'red_sandstone', 'stripped_birch_wood', 'sandstone', 'smooth_sandstone', 'white_terracotta'],
    wood: ['dark_oak_planks', 'spruce_planks', 'jungle_planks', 'oak_planks', 'birch_planks', 'pale_oak_planks'],
    ice: ['lapis_block', 'blue_concrete', 'light_blue_concrete', 'blue_ice', 'packed_ice', 'snow_block'],
    nether: ['nether_bricks', 'red_nether_bricks', 'crimson_planks', 'netherrack', 'red_terracotta', 'magma_block'],
    copper: ['oxidized_copper', 'weathered_copper', 'exposed_copper', 'copper_block', 'raw_copper_block'],
    end: ['obsidian', 'purpur_pillar', 'purpur_block', 'end_stone_bricks', 'end_stone'],
    sea: ['dark_prismarine', 'prismarine_bricks', 'prismarine', 'warped_wart_block', 'sea_lantern'],
    grey: ['black_concrete', 'gray_concrete', 'light_gray_concrete', 'white_concrete'],
    moss: ['dark_oak_planks', 'green_terracotta', 'moss_block', 'green_concrete', 'lime_terracotta', 'lime_concrete'],
  };
  const RAMP_LABEL = { stone: 'Stone', amethyst: 'Amethyst', sand: 'Sand', wood: 'Wood', ice: 'Ice', nether: 'Nether', copper: 'Copper', end: 'End', sea: 'Sea', grey: 'Grey', moss: 'Moss' };
  /** A ready ramp as ids, darkest first (sorted by the texture colours when we have them). */
  function rampOf(key) {
    const r = (RAMPS[key] || RAMPS.stone).map((n) => 'minecraft:' + n).filter((id) => C().known(id));
    return Object.keys(colours()).length ? r.slice().sort((a, b) => lum(a) - lum(b)) : r;
  }
  /** A ramp of n blocks around one block's colour: same hue family, from darkest to lightest (texture colours). */
  function rampFrom(block, n, poolKey) {
    const base = labOf(nameOf(block));
    if (!base) return [C().parse(block).base];
    const P = pool(poolKey || 'all').filter((id) => labOf(nameOf(id)));
    const chroma = Math.hypot(base[1], base[2]);
    const near = P.map((id) => { const l = labOf(nameOf(id)); return { id, l, d: chroma > 12 ? Math.hypot(l[1] - base[1], l[2] - base[2]) : Math.hypot(l[1], l[2]) }; })
      .filter((x) => x.d < (chroma > 12 ? 28 : 14)).sort((a, b) => a.l[0] - b.l[0]);
    if (!near.some((x) => x.id === C().parse(block).base)) near.push({ id: C().parse(block).base, l: base }), near.sort((a, b) => a.l[0] - b.l[0]);
    n = clamp(n || 5, 3, 9);
    if (near.length <= n) return near.map((x) => x.id);
    const out = [];
    for (let i = 0; i < n; i++) { const id = near[Math.round(i * (near.length - 1) / (n - 1))].id; if (!out.includes(id)) out.push(id); }
    return out;
  }
  /** Resample a ramp to k steps. */
  function steps(ramp, k) {
    if (!ramp.length) return ramp;
    k = clamp(Math.round(k || ramp.length), 1, 9);
    if (ramp.length === k) return ramp.slice();
    const out = [];
    for (let i = 0; i < k; i++) out.push(ramp[k === 1 ? 0 : Math.round(i * (ramp.length - 1) / (k - 1))]);
    return out;
  }

  /* ---- the pass ---- */
  const BAYER = (() => {   // 4 x 4 x 4 ordered dither thresholds in 0..1
    const b2 = [[0, 2], [3, 1]], out = new Float32Array(64);
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
      const b4 = (u, v) => 4 * b2[u & 1][v & 1] + b2[(u >> 1) & 1][(v >> 1) & 1];
      out[(y * 4 + z) * 4 + x] = ((b4(x, z) * 4 + ((y * 3 + x + z) & 3)) + 0.5) / 64;
    }
    return out;
  })();
  const N26 = [];
  for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) { const l = Math.hypot(dx, dy, dz); N26.push([dx, dy, dz, dx / l / l, dy / l / l, dz / l / l]); }

  function shade(s, o) {
    if (!s || !o || !(o.ramp && o.ramp.length) && !o.colour) return s;
    const core = C(), D = DT(), [sx, sy, sz] = s.size, B = s.blocks;
    const L = o.vec ? (() => { const l = Math.hypot(...o.vec) || 1; return o.vec.map((v) => v / l); })() : lightVec(o.az, o.el);
    const ambient = clamp(o.ambient == null ? 0.25 : +o.ambient, 0, 1), contrast = clamp(o.contrast == null ? 1 : +o.contrast, 0.3, 3);
    const dither = clamp(o.dither == null ? 0.6 : +o.dither, 0, 1), ao = clamp(o.ao == null ? 0.4 : +o.ao, 0, 1), rim = clamp(+o.rim || 0, 0, 1);
    let ramp = steps((o.ramp && o.ramp.length ? o.ramp : rampOf('stone')).map((id) => core.parse(id).base), o.steps || (o.ramp ? o.ramp.length : 6));
    const K = ramp.length;
    // what a cell is: solid for normals / shadows (full and half volumes), changeable (a building block)
    const info = s.palette.map((id, i) => {
      if (!i || core.isAir(id)) return { solid: false, change: false };
      const d = core.def(id), m = D.shapeMask(id), solid = D.count(m) >= 32;
      const kind = d.shape === 'stairs' ? 'stairs' : d.shape === 'slab' ? 'slab' : d.shape === 'wall' ? 'wall' : d.shape === 'cube' ? 'cube' : null;
      const change = !!kind && core.replaceable(id).ok && !D.isThin(id) && (!o.only || o.only.has(core.parse(id).base));
      return { solid, change, kind, props: core.parse(id).props };
    });
    const solidAt = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && info[B[(y * sz + z) * sx + x]].solid;
    const rg = o.region;
    const inReg = (x, y, z) => !rg || (x >= rg[0] && y >= rg[1] && z >= rg[2] && x <= rg[3] && y <= rg[4] && z <= rg[5]);
    const out = core.clone(s);
    const OB = out.blocks;
    const maxSteps = Math.ceil(Math.max(sx, sy, sz) * 1.8);
    // the colour mode
    const col = o.colour && ((+o.colour.tint || 0) > 0 || (+o.colour.hue || 0) > 0) ? o.colour : null;
    const P = col ? pool(col.pool || 'all', col.custom) : null;
    const rampRGB = ramp.map((id) => colours()[nameOf(id)] || [128, 128, 128]);
    const lightC = col ? (col.light || [1, 1, 1]) : null, shadowC = col ? col.shadow || null : null;
    const pick = new Map();
    const colourBlock = (k, t) => {
      const key = k + '|' + Math.round(t * 16);
      let v = pick.get(key);
      if (v) return v;
      const base = rampRGB[k], tint = clamp(+col.tint || 0, 0, 1), tq = Math.round(t * 16) / 16;
      const lc = shadowC ? [0, 1, 2].map((a) => shadowC[a] + (lightC[a] - shadowC[a]) * tq) : [0, 1, 2].map((a) => 1 + (lightC[a] - 1) * tq);
      const rgb = [0, 1, 2].map((a) => clamp(base[a] * (1 + (lc[a] - 1) * tint), 0, 255));
      const lb = lab(rgb), hs = (+col.hue || 0) * 22;
      lb[2] += hs * (tq - 0.5) * 2; lb[1] -= hs * (0.5 - tq) * 0.6;   // warm highlights (yellow), cool shadows (blue)
      v = nearest(lb, P.length ? P : ramp);
      pick.set(key, v);
      return v;
    };
    const variantOf = (full, inf) => {
      if (inf.kind === 'cube') return full;
      const v = D.variant(full, inf.kind);
      return v ? D.complete(core.stateOf(v, inf.props)) : null;
    };
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      const inf = info[B[i]];
      if (!inf.change || !inReg(x, y, z)) continue;
      let nx = 0, ny = 0, nz = 0, open = 0;
      for (const [dx, dy, dz, wx, wy, wz] of N26) if (!solidAt(x + dx, y + dy, z + dz)) { nx += wx; ny += wy; nz += wz; open++; }
      let t;
      const exposed = !solidAt(x + 1, y, z) || !solidAt(x - 1, y, z) || !solidAt(x, y + 1, z) || !solidAt(x, y - 1, z) || !solidAt(x, y, z + 1) || !solidAt(x, y, z - 1);
      const nl = Math.hypot(nx, ny, nz);
      if (!exposed || nl < 1e-6) t = 0.5;
      else {
        nx /= nl; ny /= nl; nz /= nl;
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        let lit = Math.max(0, ndl);
        if (lit > 0 && o.shadows) {
          let px = x + 0.5 + nx * 0.75, py = y + 0.5 + ny * 0.75, pz = z + 0.5 + nz * 0.75;
          for (let k = 0; k < maxSteps; k++) {
            px += L[0] * 0.5; py += L[1] * 0.5; pz += L[2] * 0.5;
            const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
            if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) break;
            if ((cx !== x || cy !== y || cz !== z) && info[B[(cy * sz + cz) * sx + cx]].solid) { lit = 0; break; }
          }
        }
        let v = ambient + (1 - ambient) * lit;
        if (rim) v += rim * 0.5 * Math.exp(-(ndl * ndl) / 0.04);
        if (ao) {
          let occ = 0, tot = 0;
          for (const [dx, dy, dz] of N26) { if (dx * nx + dy * ny + dz * nz <= 0.2) continue; tot++; if (solidAt(x + dx, y + dy, z + dz)) occ++; }
          if (tot) v *= 1 - ao * 0.8 * (occ / tot);
        }
        t = clamp(0.5 + (v - 0.5) * contrast, 0, 1);
      }
      const th = BAYER[((y & 3) * 4 + (z & 3)) * 4 + (x & 3)] - 0.5;
      const k = clamp(Math.round(t * (K - 1) + th * dither), 0, K - 1);
      const full = col ? colourBlock(k, t) : ramp[k];
      const id = variantOf(full, inf);
      if (id) OB[i] = core.pal(out, id);
    }
    return core.compact(out);
  }

  TH.builds.shade = { shade, lightVec, LIGHT_KEYS, LIGHT_COLOURS, RAMPS, RAMP_LABEL, rampOf, rampFrom, steps, POOLS, pool, lab, labOf, nearest };
})();
