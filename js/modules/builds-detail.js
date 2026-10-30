/**
 * Builds detail toolkit (pure, no DOM): the partial and thin blocks every generator, the quick editor, the rotation and
 * the shading share.
 *
 *   variant(name, kind)        the stairs / slab / wall / trapdoor / pane / fence / bars / carpet of a block, or null
 *   LEVELS, KINDS              detail levels (low = full blocks only ... max = everything) and the kinds of part a pass
 *                              may use (each can be switched off on its own)
 *   cover(fn), shapeMask(id)   4 x 4 x 4 sub-cell occupancy (64 samples as two 32-bit words): of a field, or of a block
 *   choose(cov, o)             the best block for a cell from its sub-cell coverage: empty, full, slab, stairs,
 *                              trapdoor (closed / open), wall post or snow layers, among the kinds allowed and available
 *   complete(id)               a partial block with every state property set (valid in .schem / .litematic)
 *   connect(s)                 re-derive the neighbour-dependent states of panes, bars, fences and walls
 *   tipStack(style, n, mat)    a 1-pixel point: decreasing-thickness parts stacked on a spire (bottom to top)
 *   GLOW                       glowing blocks and decorations, with their lit states
 *   isThin(id)                 blocks that are not a solid volume (rods, panes, plants, lanterns ...): carried as items
 *
 * Coordinates: sub-cell index i = (y * 4 + z) * 4 + x, y up; word 0 holds y 0-1, word 1 holds y 2-3. Stairs facing F
 * have their tall back toward F; an open trapdoor facing F lies against the side opposite F (as in the game's models).
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const DIRS = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  const HORIZ = ['north', 'south', 'west', 'east'];
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };

  /* ======================================================================
   * Variants: a block's partial forms
   * ====================================================================== */
  const exists = (name, shape) => {
    const id = 'minecraft:' + name;
    if (!C().known(id)) return false;
    return !shape || C().def(id).shape === shape;
  };
  // blocks whose partial forms carry another name
  const SPECIAL = {
    stairs: { quartz_block: 'quartz_stairs', purpur_block: 'purpur_stairs', smooth_quartz: 'smooth_quartz_stairs', copper_block: 'cut_copper_stairs', exposed_copper: 'exposed_cut_copper_stairs', weathered_copper: 'weathered_cut_copper_stairs', oxidized_copper: 'oxidized_cut_copper_stairs', prismarine_bricks: 'prismarine_brick_stairs', dark_prismarine: 'dark_prismarine_stairs', smooth_stone: 'stone_stairs', chiseled_stone_bricks: 'stone_brick_stairs', cracked_stone_bricks: 'stone_brick_stairs', polished_basalt: 'polished_blackstone_stairs', smooth_basalt: 'polished_deepslate_stairs', basalt: 'polished_blackstone_stairs', calcite: 'diorite_stairs', obsidian: 'polished_blackstone_stairs', crying_obsidian: 'polished_blackstone_stairs', deepslate: 'cobbled_deepslate_stairs', end_stone: 'end_stone_brick_stairs', quartz_bricks: 'quartz_stairs', chiseled_quartz_block: 'quartz_stairs', quartz_pillar: 'quartz_stairs', cut_sandstone: 'smooth_sandstone_stairs', chiseled_sandstone: 'sandstone_stairs', snow_block: 'diorite_stairs', packed_ice: 'diorite_stairs', amethyst_block: 'purpur_stairs', budding_amethyst: 'purpur_stairs', gilded_blackstone: 'blackstone_stairs', chiseled_tuff_bricks: 'tuff_brick_stairs', chiseled_tuff: 'tuff_stairs', mossy_cobblestone: 'mossy_cobblestone_stairs', cracked_deepslate_bricks: 'deepslate_brick_stairs', cracked_deepslate_tiles: 'deepslate_tile_stairs', chiseled_deepslate: 'polished_deepslate_stairs', cracked_polished_blackstone_bricks: 'polished_blackstone_brick_stairs', moss_block: 'mossy_cobblestone_stairs', pale_moss_block: 'diorite_stairs' },
    slab: { quartz_block: 'quartz_slab', purpur_block: 'purpur_slab', smooth_quartz: 'smooth_quartz_slab', copper_block: 'cut_copper_slab', exposed_copper: 'exposed_cut_copper_slab', weathered_copper: 'weathered_cut_copper_slab', oxidized_copper: 'oxidized_cut_copper_slab', prismarine_bricks: 'prismarine_brick_slab', dark_prismarine: 'dark_prismarine_slab', chiseled_stone_bricks: 'stone_brick_slab', cracked_stone_bricks: 'stone_brick_slab', polished_basalt: 'polished_blackstone_slab', smooth_basalt: 'polished_deepslate_slab', basalt: 'polished_blackstone_slab', calcite: 'diorite_slab', obsidian: 'polished_blackstone_slab', crying_obsidian: 'polished_blackstone_slab', deepslate: 'cobbled_deepslate_slab', end_stone: 'end_stone_brick_slab', quartz_bricks: 'quartz_slab', chiseled_quartz_block: 'quartz_slab', quartz_pillar: 'quartz_slab', cut_sandstone: 'cut_sandstone_slab', chiseled_sandstone: 'sandstone_slab', snow_block: 'diorite_slab', packed_ice: 'diorite_slab', amethyst_block: 'purpur_slab', budding_amethyst: 'purpur_slab', gilded_blackstone: 'blackstone_slab', chiseled_tuff_bricks: 'tuff_brick_slab', chiseled_tuff: 'tuff_slab', mossy_cobblestone: 'mossy_cobblestone_slab', cracked_deepslate_bricks: 'deepslate_brick_slab', cracked_deepslate_tiles: 'deepslate_tile_slab', chiseled_deepslate: 'polished_deepslate_slab', cracked_polished_blackstone_bricks: 'polished_blackstone_brick_slab', moss_block: 'mossy_cobblestone_slab', pale_moss_block: 'diorite_slab' },
    wall: { stone: 'stone_brick_wall', stone_bricks: 'stone_brick_wall', cracked_stone_bricks: 'stone_brick_wall', chiseled_stone_bricks: 'stone_brick_wall', smooth_stone: 'stone_brick_wall', deepslate: 'cobbled_deepslate_wall', polished_basalt: 'polished_blackstone_wall', smooth_basalt: 'polished_deepslate_wall', basalt: 'polished_blackstone_wall', obsidian: 'polished_blackstone_wall', crying_obsidian: 'polished_blackstone_wall', calcite: 'diorite_wall', end_stone: 'end_stone_brick_wall', quartz_block: 'diorite_wall', smooth_quartz: 'diorite_wall', purpur_block: 'end_stone_brick_wall', amethyst_block: 'end_stone_brick_wall', prismarine_bricks: 'prismarine_wall', dark_prismarine: 'prismarine_wall', cut_sandstone: 'sandstone_wall', smooth_sandstone: 'sandstone_wall', chiseled_tuff_bricks: 'tuff_brick_wall', mossy_cobblestone: 'mossy_cobblestone_wall', moss_block: 'mossy_cobblestone_wall', gilded_blackstone: 'blackstone_wall', snow_block: 'diorite_wall', packed_ice: 'diorite_wall' },
    trapdoor: { iron_block: 'iron_trapdoor', copper_block: 'copper_trapdoor', exposed_copper: 'exposed_copper_trapdoor', weathered_copper: 'weathered_copper_trapdoor', oxidized_copper: 'oxidized_copper_trapdoor', cut_copper: 'copper_trapdoor' },
    pane: { glass: 'glass_pane', tinted_glass: 'purple_stained_glass_pane', ice: 'light_blue_stained_glass_pane', packed_ice: 'light_blue_stained_glass_pane', blue_ice: 'light_blue_stained_glass_pane', sea_lantern: 'white_stained_glass_pane', amethyst_block: 'purple_stained_glass_pane', budding_amethyst: 'magenta_stained_glass_pane', diamond_block: 'light_blue_stained_glass_pane', emerald_block: 'lime_stained_glass_pane', redstone_block: 'red_stained_glass_pane', quartz_block: 'white_stained_glass_pane', purpur_block: 'magenta_stained_glass_pane', prismarine: 'cyan_stained_glass_pane' },
    bars: { iron_block: 'iron_bars', copper_block: 'copper_bars', exposed_copper: 'exposed_copper_bars', weathered_copper: 'weathered_copper_bars', oxidized_copper: 'oxidized_copper_bars' },
    fence: { nether_bricks: 'nether_brick_fence', red_nether_bricks: 'nether_brick_fence' },
    carpet: { moss_block: 'moss_carpet', pale_moss_block: 'pale_moss_carpet', snow_block: 'snow' },
  };
  const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped', 'poplar'];
  const vCache = new Map();
  /** The partial form `kind` of block `name` (base name, no namespace) as a base id 'minecraft:x', or null. */
  function variant(name, kind) {
    name = C().parse(name).name;
    const key = name + '|' + kind;
    if (vCache.has(key)) return vCache.get(key);
    let out = null;
    const sp = SPECIAL[kind] && SPECIAL[kind][name];
    const want = { stairs: 'stairs', slab: 'slab', wall: 'wall', fence: 'fence', carpet: null, pane: null, bars: null, trapdoor: null }[kind];
    if (sp && exists(sp)) out = sp;
    else {
      const wood = WOODS.find((w) => name === w + '_planks' || name === w + '_log' || name === w + '_wood' || name === 'stripped_' + w + '_log' || name === w + '_stem' || name === w + '_hyphae' || name === w + '_block');
      const stems = [name, name.replace(/_planks$/, ''), name.replace(/bricks$/, 'brick'), name.replace(/tiles$/, 'tile'), name.replace(/_block$/, ''), name.replace(/s$/, '')];
      if (kind === 'stairs' || kind === 'slab' || kind === 'wall') {
        const list = wood && kind !== 'wall' ? [wood] : stems;
        for (const st of list) { const n = st + '_' + kind; if (exists(n, want)) { out = n; break; } }
      } else if (kind === 'fence' && wood) { if (exists(wood + '_fence')) out = wood + '_fence'; }
      else if (kind === 'trapdoor' && wood) { if (exists(wood + '_trapdoor')) out = wood + '_trapdoor'; }
      else if (kind === 'pane') { if (/glass$/.test(name) && exists(name + '_pane')) out = name + '_pane'; }
      else if (kind === 'carpet') { const m = name.match(/^([a-z_]+?)_(wool|concrete|terracotta|concrete_powder|stained_glass)$/); if (m && exists(m[1] + '_carpet')) out = m[1] + '_carpet'; }
    }
    out = out ? 'minecraft:' + out : null;
    vCache.set(key, out);
    return out;
  }

  /* ======================================================================
   * Detail levels and the kinds of part a pass may use
   * ====================================================================== */
  const KINDS = ['stairs', 'slab', 'wall', 'trapdoor', 'pane', 'bars', 'fence', 'button', 'carpet', 'snow', 'dripstone', 'rod', 'amethyst', 'chain', 'candle'];
  const KIND_LABEL = { stairs: 'Stairs', slab: 'Slabs', wall: 'Walls', trapdoor: 'Trapdoors', pane: 'Panes', bars: 'Bars', fence: 'Fences', button: 'Buttons', carpet: 'Carpets', snow: 'Snow layers', dripstone: 'Dripstone', rod: 'End rods', amethyst: 'Amethyst', chain: 'Chains', candle: 'Candles' };
  const LEVELS = {
    low: [],
    medium: ['stairs', 'slab'],
    high: ['stairs', 'slab', 'wall', 'trapdoor', 'pane', 'bars', 'fence', 'button'],
    max: KINDS.slice(),
  };
  /** The kinds a pass may use: the level's kinds minus the ones switched off (off = array or Set of kind ids). */
  function allowed(level, off) {
    const o = off instanceof Set ? off : new Set(off || []);
    return new Set((LEVELS[level] || LEVELS.medium).filter((k) => !o.has(k)));
  }

  /* ======================================================================
   * Sub-cell occupancy: 4 x 4 x 4 samples per cell
   * ====================================================================== */
  const SUB = 4, NS = 64;
  const bitOf = (x, y, z) => (y * 4 + z) * 4 + x;
  function pop(v) { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
  const count = (m) => pop(m[0]) + pop(m[1]);
  const ham = (a, b) => pop((a[0] ^ b[0]) >>> 0) + pop((a[1] ^ b[1]) >>> 0);
  /** Mask from a predicate over sub-cell indices (x, y, z in 0..3). */
  function mk(fn) {
    const m = [0, 0];
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) if (fn(x, y, z)) { const b = bitOf(x, y, z); m[b >> 5] = (m[b >> 5] | (1 << (b & 31))) >>> 0; }
    return m;
  }
  /** Coverage of a cell (cx, cy, cz = its min corner) from inside(x, y, z) at the 64 sub-cell centres. */
  function cover(inside, cx, cy, cz) {
    const m = [0, 0];
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
      if (!inside(cx + (x + 0.5) / 4, cy + (y + 0.5) / 4, cz + (z + 0.5) / 4)) continue;
      const b = bitOf(x, y, z); m[b >> 5] = (m[b >> 5] | (1 << (b & 31))) >>> 0;
    }
    return m;
  }
  const side = (f) => ({ north: (x, z) => z < 2, south: (x, z) => z >= 2, west: (x) => x < 2, east: (x) => x >= 2 })[f];
  const thinSide = (f) => ({ north: (x, z) => z === 0, south: (x, z) => z === 3, west: (x) => x === 0, east: (x) => x === 3 })[f];
  const FULL = [0xffffffff, 0xffffffff], EMPTY = [0, 0];
  const M = {
    full: FULL, empty: EMPTY,
    slab_bottom: mk((x, y) => y < 2), slab_top: mk((x, y) => y >= 2),
    wall: mk((x, y, z) => x >= 1 && x <= 2 && z >= 1 && z <= 2),
    td_bottom: mk((x, y) => y === 0), td_top: mk((x, y) => y === 3),
    snow4: mk((x, y) => y < 2), snow6: mk((x, y) => y < 3), snow2: mk((x, y) => y < 1),
  };
  HORIZ.forEach((f) => {
    const sd = side(f);
    M['stairs_bottom_' + f] = mk((x, y, z) => y < 2 || sd(x, z));
    M['stairs_top_' + f] = mk((x, y, z) => y >= 2 || sd(x, z));
    M['td_open_' + f] = mk((x, y, z) => thinSide(OPP[f])(x, z));
  });

  /** Occupancy of a placed block state (for resampling in a rotation): solid shapes only; thin things get EMPTY. */
  const maskCache = new Map();
  function shapeMask(id) {
    let m = maskCache.get(id);
    if (m) return m;
    const p = C().parse(id), d = C().def(id), pr = p.props;
    if (C().isAir(id)) m = EMPTY;
    else if (d.shape === 'slab') m = pr.type === 'top' ? M.slab_top : pr.type === 'double' ? FULL : M.slab_bottom;
    else if (d.shape === 'stairs') m = M['stairs_' + (pr.half === 'top' ? 'top' : 'bottom') + '_' + (HORIZ.includes(pr.facing) ? pr.facing : 'north')];
    else if (p.name === 'snow') { const n = +pr.layers || 1; m = n >= 8 ? FULL : n >= 6 ? M.snow6 : n >= 4 ? M.snow4 : n >= 2 ? M.snow2 : EMPTY; }
    else if (/_trapdoor$/.test(p.name)) m = pr.open === 'true' ? M['td_open_' + (HORIZ.includes(pr.facing) ? pr.facing : 'north')] : pr.half === 'top' ? M.td_top : M.td_bottom;
    else if (d.shape === 'wall') m = M.wall;
    else if (d.shape === 'cube' || d.shape === 'liquid') m = FULL;
    else m = EMPTY;
    maskCache.set(id, m);
    return m;
  }
  /** Blocks that are not a solid volume (rods, panes, bars, fences, plants, lanterns, candles ...): carried as items. */
  function isThin(id) {
    if (C().isAir(id)) return false;
    const d = C().def(id), n = C().parse(id).name;
    if (d.shape === 'slab' || d.shape === 'stairs' || d.shape === 'wall' || /_trapdoor$/.test(n) || n === 'snow') return false;
    return d.shape !== 'cube' && d.shape !== 'liquid';
  }

  /* ======================================================================
   * Complete states (every property, as the game writes it)
   * ====================================================================== */
  function complete(id) {
    const p = C().parse(id), d = C().def(id), pr = Object.assign({}, p.props), n = p.name;
    const set = (k, v) => { if (pr[k] == null) pr[k] = v; };
    if (d.shape === 'stairs') { set('facing', 'north'); set('half', 'bottom'); set('shape', 'straight'); set('waterlogged', 'false'); }
    else if (d.shape === 'slab') { set('type', 'bottom'); set('waterlogged', 'false'); }
    else if (d.shape === 'wall') { ['east', 'north', 'south', 'west'].forEach((k) => set(k, 'none')); set('up', 'true'); set('waterlogged', 'false'); }
    else if (/_trapdoor$/.test(n)) { set('facing', 'north'); set('half', 'bottom'); set('open', 'false'); set('powered', 'false'); set('waterlogged', 'false'); }
    else if (/(_pane|_bars)$/.test(n) || (d.shape === 'fence' && !/_gate$/.test(n))) { ['east', 'north', 'south', 'west'].forEach((k) => set(k, 'false')); set('waterlogged', 'false'); }
    else if (n === 'snow') set('layers', '1');
    else if (n === 'end_rod' || /lightning_rod$/.test(n)) { set('facing', 'up'); if (/lightning_rod$/.test(n)) { set('powered', 'false'); set('waterlogged', 'false'); } }
    else if (/chain$/.test(n)) { set('axis', 'y'); set('waterlogged', 'false'); }
    else if (n === 'pointed_dripstone') { set('thickness', 'tip'); set('vertical_direction', 'up'); set('waterlogged', 'false'); }
    else if (/amethyst_(cluster|bud)$/.test(n)) { set('facing', 'up'); set('waterlogged', 'false'); }
    else if (/candle$/.test(n)) { set('candles', '1'); set('lit', 'false'); set('waterlogged', 'false'); }
    else if (/lantern$/.test(n) && n !== 'sea_lantern' && n !== 'jack_o_lantern') { set('hanging', 'false'); set('waterlogged', 'false'); }
    else if (/_button$/.test(n)) { set('face', 'floor'); set('facing', 'north'); set('powered', 'false'); }
    else if (/pressure_plate$/.test(n)) set(/weighted/.test(n) ? 'power' : 'powered', /weighted/.test(n) ? '0' : 'false');
    else if (/_leaves$/.test(n)) { set('distance', '7'); set('persistent', 'true'); set('waterlogged', 'false'); }
    else if (/copper_bulb$/.test(n)) { set('lit', 'false'); set('powered', 'false'); }
    else if (n === 'redstone_lamp') set('lit', 'false');
    else if (n === 'sea_pickle') { set('pickles', '1'); set('waterlogged', 'false'); }
    else if (n === 'vine') ['east', 'north', 'south', 'up', 'west'].forEach((k) => set(k, 'false'));
    else if (n === 'ladder') { set('facing', 'north'); set('waterlogged', 'false'); }
    else if (d.axis && C().def(id).shape === 'cube') set('axis', 'y');
    return C().stateOf(p.base, sortProps(pr));
  }
  /** The game writes properties in alphabetical order; we do too, so equal states compare equal. */
  function sortProps(pr) { const o = {}; Object.keys(pr).sort().forEach((k) => { o[k] = pr[k]; }); return o; }
  const st = (base, props) => complete(C().stateOf(base, props));

  /* ======================================================================
   * Choose the best block for a cell from its coverage
   * ====================================================================== */
  const PEN = { full: 0, empty: 0, slab: 3, stairs: 3, trapdoor: 5, wall: 6, snow: 4, carpet: 6 };
  /** Every column of sub-samples is all in or all out: the coverage has no shape in height. */
  function vertical(cov) {
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
      let c = 0;
      for (let y = 0; y < 4; y++) { const b = bitOf(x, y, z); c += (cov[b >> 5] >>> (b & 31)) & 1; }
      if (c !== 0 && c !== 4) return false;
    }
    return true;
  }
  /**
   * cov = coverage mask; o = { block (base id of the full block), allow: Set of kinds, fallback: { kind: base id } }.
   * Returns a state id, or null (empty). Stairs and slabs come from the block itself when it has them, else from the
   * fallback (a palette's partial blocks), else that kind is skipped.
   */
  function choose(cov, o) {
    const n = count(cov);
    if (n === 0) return null;
    if (n === NS) return o.block;
    const allow = o.allow || LEVELS.medium;
    const has = (k) => (allow.has ? allow.has(k) : allow.includes(k));
    const vb = (k) => variant(o.block, k) || (o.fallback && o.fallback[k]) || null;
    const cand = [['empty', EMPTY, null], ['full', FULL, o.block]];
    if (has('slab') && vb('slab')) { cand.push(['slab', M.slab_bottom, st(vb('slab'), { type: 'bottom' })], ['slab', M.slab_top, st(vb('slab'), { type: 'top' })]); }
    if (has('stairs') && vb('stairs')) HORIZ.forEach((f) => { ['bottom', 'top'].forEach((hf) => cand.push(['stairs', M['stairs_' + hf + '_' + f], st(vb('stairs'), { facing: f, half: hf })])); });
    if (has('trapdoor') && vb('trapdoor')) {
      cand.push(['trapdoor', M.td_bottom, st(vb('trapdoor'), { half: 'bottom' })], ['trapdoor', M.td_top, st(vb('trapdoor'), { half: 'top' })]);
      HORIZ.forEach((f) => cand.push(['trapdoor', M['td_open_' + f], st(vb('trapdoor'), { facing: f, open: 'true' })]));
    }
    if (has('wall') && vb('wall')) cand.push(['wall', M.wall, st(vb('wall'), { up: 'true' })]);
    if (has('snow') && C().parse(o.block).name === 'snow_block') [[2, M.snow2], [4, M.snow4], [6, M.snow6]].forEach(([k, m]) => cand.push(['snow', m, st('minecraft:snow', { layers: String(k) })]));
    // full or empty, whichever is closer (a tie is full); a part only when it is clearly better. A cut that is the
    // same at every height (a vertical diagonal wall, which no block can show) stays a block or air instead of turning
    // into saw teeth of stairs.
    const cf = ham(cov, FULL), ce = n;
    let best = cf <= ce ? o.block : null;
    if (vertical(cov)) {
      // only a thin post fits a cut with no shape in height: a wall when the coverage is a column in the middle
      const w = cand.find((c) => c[0] === 'wall');
      return w && ham(cov, w[1]) <= 6 && ham(cov, w[1]) < Math.min(cf, ce) ? w[2] : best;
    }
    const base = Math.min(cf, ce);
    let bc = base;
    for (let k = 2; k < cand.length; k++) {
      const [kind, m, id] = cand[k], c = ham(cov, m) + PEN[kind];
      if (c < bc && c <= 0.85 * base) { bc = c; best = id; }
    }
    return best;
  }

  /* ======================================================================
   * Connections: panes, bars, fences and walls follow their neighbours
   * ====================================================================== */
  const connKind = (name, d) => (/(_pane|_bars)$/.test(name) ? 'pane' : d.shape === 'wall' ? 'wall' : d.shape === 'fence' && !/_gate$/.test(name) ? 'fence' : null);
  /** Re-derive north / south / east / west (and a wall's up) of every pane, bar, fence and wall from its neighbours. */
  function connect(s, box) {
    const core = C(), [sx, sy, sz] = s.size;
    const info = s.palette.map((id, i) => {
      if (!i || core.isAir(id)) return null;
      const d = core.def(id), p = core.parse(id);
      return { id, d, p, kind: connKind(p.name, d), solid: d.shape === 'cube' && !d.cut };
    });
    if (!info.some((x) => x && x.kind)) return s;
    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? null : info[s.blocks[(y * sz + z) * sx + x]]);
    const x0 = box ? Math.max(0, box[0]) : 0, y0 = box ? Math.max(0, box[1]) : 0, z0 = box ? Math.max(0, box[2]) : 0;
    const x1 = box ? Math.min(sx - 1, box[3]) : sx - 1, y1 = box ? Math.min(sy - 1, box[4]) : sy - 1, z1 = box ? Math.min(sz - 1, box[5]) : sz - 1;
    const changes = [];   // applied after the scan, so every block sees its neighbours as they were
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const a = at(x, y, z);
      if (!a || !a.kind) continue;
      const pr = Object.assign({}, a.p.props);
      const links = {};
      HORIZ.forEach((f) => {
        const v = DIRS[f], b = at(x + v[0], y, z + v[2]);
        links[f] = !!(b && (b.solid || b.kind === a.kind || (a.kind === 'pane' && b.kind === 'wall') || (a.kind === 'wall' && (b.kind === 'pane' || /_gate$/.test(b.p.name))) || (a.kind === 'fence' && /_gate$/.test(b.p.name))));
      });
      if (a.kind === 'wall') {
        const above = at(x, y + 1, z), tall = !!(above && (above.solid || above.kind === 'wall'));
        HORIZ.forEach((f) => { pr[f] = links[f] ? (tall ? 'tall' : 'low') : 'none'; });
        const straight = (links.north && links.south && !links.east && !links.west) || (links.east && links.west && !links.north && !links.south);
        pr.up = straight && !(above && above.kind === 'wall') ? 'false' : 'true';
      } else HORIZ.forEach((f) => { pr[f] = links[f] ? 'true' : 'false'; });
      if (pr.waterlogged == null) pr.waterlogged = 'false';
      const id = core.stateOf(a.p.base, sortProps(pr));
      if (id !== a.id) changes.push([(y * sz + z) * sx + x, id]);
    }
    changes.forEach(([i, id]) => { s.blocks[i] = core.pal(s, id); });
    return s;
  }

  /* ======================================================================
   * Sharp tips: decreasing-thickness parts stacked to a 1-pixel point
   * ====================================================================== */
  const TIP_STYLES = [
    ['none', 'Blocks', 'Full blocks only: the tip ends in a block'],
    ['stepped', 'Stepped', 'A slab on top of the last block'],
    ['needle', 'Needle', 'Wall, lightning rod, then a glowing end rod'],
    ['spike', 'Spike', 'Wall, fence, then a chain'],
    ['crystal', 'Crystal', 'Glass pane, then an amethyst cluster'],
    ['dripstone', 'Dripstone', 'Pointed dripstone: base, middle, frustum, tip'],
  ];
  /** The parts on top of a spire made of `mat` (its block), bottom to top, at most n of them (the thinnest are kept). */
  function tipStack(style, n, mat, glass) {
    if (!n || style === 'none') return [];
    const wall = variant(mat, 'wall') || 'minecraft:cobblestone_wall';
    const pane = variant(glass || mat, 'pane') || 'minecraft:glass_pane';
    const seq = {
      stepped: [st(variant(mat, 'slab') || 'minecraft:stone_slab', { type: 'bottom' })],
      needle: [st(wall, { up: 'true' }), st('minecraft:lightning_rod', { facing: 'up' }), st('minecraft:end_rod', { facing: 'up' })],
      spike: [st(wall, { up: 'true' }), st('minecraft:oak_fence', {}), st('minecraft:iron_chain', { axis: 'y' })],
      crystal: [st(pane, {}), st('minecraft:amethyst_cluster', { facing: 'up' })],
      dripstone: ['base', 'middle', 'frustum', 'tip'].map((t) => st('minecraft:pointed_dripstone', { thickness: t, vertical_direction: 'up' })),
    }[style] || [];
    return seq.slice(Math.max(0, seq.length - n));
  }

  /* ======================================================================
   * Glow: blocks that light up, in their lit states
   * ====================================================================== */
  const GLOW = {
    sea_lantern: { name: 'Sea lantern', id: 'minecraft:sea_lantern' },
    shroomlight: { name: 'Shroomlight', id: 'minecraft:shroomlight' },
    glowstone: { name: 'Glowstone', id: 'minecraft:glowstone' },
    copper_bulb: { name: 'Copper bulb', id: 'minecraft:copper_bulb[lit=true,powered=false]' },
    redstone_lamp: { name: 'Redstone lamp', id: 'minecraft:redstone_lamp[lit=true]' },
    froglight: { name: 'Froglight', id: 'minecraft:pearlescent_froglight[axis=y]' },
    ochre: { name: 'Ochre froglight', id: 'minecraft:ochre_froglight[axis=y]' },
    verdant: { name: 'Verdant froglight', id: 'minecraft:verdant_froglight[axis=y]' },
    crying: { name: 'Crying obsidian', id: 'minecraft:crying_obsidian' },
    magma: { name: 'Magma behind glass', id: 'minecraft:magma_block', behind: 'minecraft:orange_stained_glass' },
    lava: { name: 'Lava behind glass', id: 'minecraft:lava[level=0]', behind: 'minecraft:orange_stained_glass' },
    amethyst: { name: 'Amethyst', id: 'minecraft:amethyst_block', decor: 'minecraft:amethyst_cluster' },
    sculk: { name: 'Sculk', id: 'minecraft:sculk' },
    end_rod: { name: 'End rods', id: 'minecraft:sea_lantern', decor: 'minecraft:end_rod' },
    candles: { name: 'Candles', id: 'minecraft:shroomlight', decor: 'minecraft:candle' },
  };
  /** A decoration (amethyst cluster, end rod, candle) attached to a surface, pointing along `dir` ('up', 'north' ...). */
  function decorState(base, dir, k) {
    const n = C().parse(base).name;
    if (/amethyst_(cluster|bud)$/.test(n)) return st(base, { facing: dir });
    if (n === 'end_rod' || /lightning_rod$/.test(n)) return st(base, { facing: dir });
    if (/candle$/.test(n)) return st(base, { candles: String(Math.max(1, Math.min(4, k || 1))), lit: 'true' });
    return complete(base);
  }

  TH.builds.detail = {
    variant, KINDS, KIND_LABEL, LEVELS, allowed, SUB, NS, bitOf, pop, count, ham, mk, cover, MASK: M, FULL, EMPTY, shapeMask, isThin,
    complete, sortProps, choose, connect, connKind, TIP_STYLES, tipStack, GLOW, decorState, DIRS, HORIZ, OPP,
  };
})();
