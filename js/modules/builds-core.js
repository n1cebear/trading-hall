/**
 * Builds core (no UI): the Schematic data model and the block table.
 *
 *   Schematic = { name, size: [sx, sy, sz], palette: ['minecraft:air', 'minecraft:stone', ...], blocks: Uint16Array }
 *   blocks is dense, indexed (y * sz + z) * sx + x, 0 = air (palette[0] is always air).
 *   Palette entries are full Java block states ('minecraft:oak_stairs[facing=north,half=bottom]'); rendering only reads
 *   the properties it understands (facing, axis, type, half), everything else is kept for export.
 *
 * Block table (BLOCKS): name -> { t, s, b (top / side / bottom texture paths), f / k (front / back for directional
 * blocks), shape, fam, grp, fn (functional reason), tint, ov, cut, icon }.
 *   fam = replacement family: a block may only be swapped for another non-functional block of the same family
 *         (cube, log, glass, leaves, light, gravity, slab, stairs, fence, carpet), so the shape and physics stay the same.
 *   fn  = why the block makes the mechanics work; functional blocks are never replaceable.
 * Every texture is written as a literal 'block/...' string so tools/build-icon-list.js bundles it for the artifact.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const AIR = 'minecraft:air';
  const AIRS = new Set(['air', 'cave_air', 'void_air', 'structure_void']);

  /* ======================================================================
   * Block ids
   * ====================================================================== */
  /** 'minecraft:oak_log[axis=x]' -> { ns, name: 'oak_log', props: { axis: 'x' } } (memoised). */
  const parseCache = new Map();
  function parse(id) {
    let p = parseCache.get(id);
    if (p) return p;
    const s = String(id || '').trim();
    const br = s.indexOf('[');
    const base = br >= 0 ? s.slice(0, br) : s;
    const ci = base.indexOf(':');
    const ns = ci >= 0 ? base.slice(0, ci) : 'minecraft';
    const name = (ci >= 0 ? base.slice(ci + 1) : base).toLowerCase();
    const props = {};
    if (br >= 0) s.slice(br + 1, s.lastIndexOf(']') > br ? s.lastIndexOf(']') : undefined).split(',').forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k && v != null) props[k.trim()] = v.trim();
    });
    p = { ns, name, props, base: ns + ':' + name };
    if (parseCache.size > 5000) parseCache.clear();
    parseCache.set(id, p);
    return p;
  }
  const isAir = (id) => !id || AIRS.has(parse(id).name);
  /** Rebuild a state string from a base id and props. */
  function stateOf(base, props) {
    const ks = props ? Object.keys(props) : [];
    return ks.length ? base + '[' + ks.map((k) => k + '=' + props[k]).join(',') + ']' : base;
  }
  /** Replace the block of a state but keep its properties ('minecraft:oak_slab[type=top]' -> 'minecraft:stone_slab[type=top]'). */
  function withBase(id, newBase) {
    const p = parse(id), n = parse(newBase);
    return stateOf(n.base, p.props);
  }

  /* ======================================================================
   * Block table
   * ====================================================================== */
  const BLOCKS = {};
  const G = { stone: 'Stone', deep: 'Deepslate', sand: 'Sandstone', nether: 'Nether', end: 'End and sea', wood: 'Wood', colour: 'Colours', mineral: 'Minerals', ore: 'Ores', natural: 'Natural', glass: 'Glass', leaves: 'Leaves', light: 'Light', redstone: 'Redstone', farm: 'Farming', misc: 'Other' };
  function put(name, d) { BLOCKS[name] = d; return d; }
  // full opaque building cube: one texture, or top / side / bottom
  function cube(name, t, s, b, o) { return put(name, Object.assign({ t, s: s || t, b: b || t, shape: 'cube', fam: 'cube', grp: 'stone' }, o)); }
  function grp(g, list) { list.forEach((n) => { BLOCKS[n].grp = g; }); }

  // ---- stone family ----
  cube('stone', 'block/stone');
  cube('cobblestone', 'block/cobblestone');
  cube('mossy_cobblestone', 'block/mossy_cobblestone');
  cube('stone_bricks', 'block/stone_bricks');
  cube('mossy_stone_bricks', 'block/mossy_stone_bricks');
  cube('cracked_stone_bricks', 'block/cracked_stone_bricks');
  cube('chiseled_stone_bricks', 'block/chiseled_stone_bricks');
  cube('smooth_stone', 'block/smooth_stone');
  cube('granite', 'block/granite');
  cube('polished_granite', 'block/polished_granite');
  cube('diorite', 'block/diorite');
  cube('polished_diorite', 'block/polished_diorite');
  cube('andesite', 'block/andesite');
  cube('polished_andesite', 'block/polished_andesite');
  cube('calcite', 'block/calcite');
  cube('tuff', 'block/tuff');
  cube('polished_tuff', 'block/polished_tuff');
  cube('tuff_bricks', 'block/tuff_bricks');
  cube('bricks', 'block/bricks');
  cube('mud_bricks', 'block/mud_bricks');
  cube('packed_mud', 'block/packed_mud');
  // ---- deepslate ----
  cube('deepslate', 'block/deepslate_top', 'block/deepslate', 'block/deepslate_top', { grp: 'deep', axis: true });
  cube('cobbled_deepslate', 'block/cobbled_deepslate', null, null, { grp: 'deep' });
  cube('polished_deepslate', 'block/polished_deepslate', null, null, { grp: 'deep' });
  cube('deepslate_bricks', 'block/deepslate_bricks', null, null, { grp: 'deep' });
  cube('cracked_deepslate_bricks', 'block/cracked_deepslate_bricks', null, null, { grp: 'deep' });
  cube('deepslate_tiles', 'block/deepslate_tiles', null, null, { grp: 'deep' });
  cube('chiseled_deepslate', 'block/chiseled_deepslate', null, null, { grp: 'deep' });
  // ---- sandstone ----
  cube('sandstone', 'block/sandstone_top', 'block/sandstone', 'block/sandstone_bottom', { grp: 'sand' });
  cube('smooth_sandstone', 'block/sandstone_top', null, null, { grp: 'sand' });
  cube('cut_sandstone', 'block/sandstone_top', 'block/cut_sandstone', 'block/sandstone_top', { grp: 'sand' });
  cube('chiseled_sandstone', 'block/sandstone_top', 'block/chiseled_sandstone', 'block/sandstone_top', { grp: 'sand' });
  cube('red_sandstone', 'block/red_sandstone_top', 'block/red_sandstone', 'block/red_sandstone_bottom', { grp: 'sand' });
  cube('smooth_red_sandstone', 'block/red_sandstone_top', null, null, { grp: 'sand' });
  cube('cut_red_sandstone', 'block/red_sandstone_top', 'block/cut_red_sandstone', 'block/red_sandstone_top', { grp: 'sand' });
  // ---- nether ----
  cube('netherrack', 'block/netherrack', null, null, { grp: 'nether' });
  cube('nether_bricks', 'block/nether_bricks', null, null, { grp: 'nether' });
  cube('red_nether_bricks', 'block/red_nether_bricks', null, null, { grp: 'nether' });
  cube('cracked_nether_bricks', 'block/cracked_nether_bricks', null, null, { grp: 'nether' });
  cube('blackstone', 'block/blackstone_top', 'block/blackstone', 'block/blackstone_top', { grp: 'nether' });
  cube('polished_blackstone', 'block/polished_blackstone', null, null, { grp: 'nether' });
  cube('polished_blackstone_bricks', 'block/polished_blackstone_bricks', null, null, { grp: 'nether' });
  cube('chiseled_polished_blackstone', 'block/chiseled_polished_blackstone', null, null, { grp: 'nether' });
  cube('basalt', 'block/basalt_top', 'block/basalt_side', 'block/basalt_top', { grp: 'nether', axis: true });
  cube('polished_basalt', 'block/polished_basalt_top', 'block/polished_basalt_side', 'block/polished_basalt_top', { grp: 'nether', axis: true });
  cube('smooth_basalt', 'block/smooth_basalt', null, null, { grp: 'nether' });
  cube('quartz_block', 'block/quartz_block_top', 'block/quartz_block_side', 'block/quartz_block_bottom', { grp: 'nether' });
  cube('smooth_quartz', 'block/quartz_block_bottom', null, null, { grp: 'nether' });
  cube('quartz_bricks', 'block/quartz_bricks', null, null, { grp: 'nether' });
  cube('quartz_pillar', 'block/quartz_pillar_top', 'block/quartz_pillar_side', 'block/quartz_pillar_top', { grp: 'nether', axis: true });
  cube('chiseled_quartz_block', 'block/chiseled_quartz_block_top', 'block/chiseled_quartz_block', 'block/chiseled_quartz_block_top', { grp: 'nether' });
  cube('nether_wart_block', 'block/nether_wart_block', null, null, { grp: 'nether' });
  cube('warped_wart_block', 'block/warped_wart_block', null, null, { grp: 'nether' });
  cube('crimson_nylium', 'block/crimson_nylium', 'block/crimson_nylium_side', 'block/netherrack', { grp: 'nether' });
  cube('warped_nylium', 'block/warped_nylium', 'block/warped_nylium_side', 'block/netherrack', { grp: 'nether' });
  cube('obsidian', 'block/obsidian', null, null, { grp: 'nether' });
  cube('crying_obsidian', 'block/crying_obsidian', null, null, { grp: 'nether' });
  // ---- end + sea ----
  cube('end_stone', 'block/end_stone', null, null, { grp: 'end' });
  cube('end_stone_bricks', 'block/end_stone_bricks', null, null, { grp: 'end' });
  cube('purpur_block', 'block/purpur_block', null, null, { grp: 'end' });
  cube('purpur_pillar', 'block/purpur_pillar_top', 'block/purpur_pillar_side', 'block/purpur_pillar_top', { grp: 'end', axis: true });
  cube('prismarine', 'block/prismarine', null, null, { grp: 'end' });
  cube('prismarine_bricks', 'block/prismarine_bricks', null, null, { grp: 'end' });
  cube('dark_prismarine', 'block/dark_prismarine', null, null, { grp: 'end' });
  // ---- wood ----
  const WOODS = [
    // [wood, planks, log side, log top, log name, leaves tint]
    ['oak', 'block/oak_planks', 'block/oak_log', 'block/oak_log_top', 'oak_log', '#48b518'],
    ['spruce', 'block/spruce_planks', 'block/spruce_log', 'block/spruce_log_top', 'spruce_log', '#619961'],
    ['birch', 'block/birch_planks', 'block/birch_log', 'block/birch_log_top', 'birch_log', '#80a755'],
    ['jungle', 'block/jungle_planks', 'block/jungle_log', 'block/jungle_log_top', 'jungle_log', '#48b518'],
    ['acacia', 'block/acacia_planks', 'block/acacia_log', 'block/acacia_log_top', 'acacia_log', '#48b518'],
    ['dark_oak', 'block/dark_oak_planks', 'block/dark_oak_log', 'block/dark_oak_log_top', 'dark_oak_log', '#48b518'],
    ['mangrove', 'block/mangrove_planks', 'block/mangrove_log', 'block/mangrove_log_top', 'mangrove_log', '#92c648'],
    ['cherry', 'block/cherry_planks', 'block/cherry_log', 'block/cherry_log_top', 'cherry_log', null],
    ['pale_oak', 'block/pale_oak_planks', 'block/pale_oak_log', 'block/pale_oak_log_top', 'pale_oak_log', null],
    ['crimson', 'block/crimson_planks', 'block/crimson_stem', 'block/crimson_stem_top', 'crimson_stem', null],
    ['warped', 'block/warped_planks', 'block/warped_stem', 'block/warped_stem_top', 'warped_stem', null],
    ['bamboo', 'block/bamboo_planks', 'block/bamboo_block', 'block/bamboo_block_top', 'bamboo_block', null],
  ];
  const STRIPPED = {
    oak: ['block/stripped_oak_log', 'block/stripped_oak_log_top'], spruce: ['block/stripped_spruce_log', 'block/stripped_spruce_log_top'],
    birch: ['block/stripped_birch_log', 'block/stripped_birch_log_top'], jungle: ['block/stripped_jungle_log', 'block/stripped_jungle_log_top'],
    acacia: ['block/stripped_acacia_log', 'block/stripped_acacia_log_top'], dark_oak: ['block/stripped_dark_oak_log', 'block/stripped_dark_oak_log_top'],
    mangrove: ['block/stripped_mangrove_log', 'block/stripped_mangrove_log_top'], cherry: ['block/stripped_cherry_log', 'block/stripped_cherry_log_top'],
    pale_oak: ['block/stripped_pale_oak_log', 'block/stripped_pale_oak_log_top'],
  };
  const LEAVES = {
    oak: 'block/oak_leaves', spruce: 'block/spruce_leaves', birch: 'block/birch_leaves', jungle: 'block/jungle_leaves',
    acacia: 'block/acacia_leaves', dark_oak: 'block/dark_oak_leaves', mangrove: 'block/mangrove_leaves', cherry: 'block/cherry_leaves',
    pale_oak: 'block/pale_oak_leaves',
  };
  WOODS.forEach(([w, planks, side, top, logName, tint]) => {
    cube(w + '_planks', planks, null, null, { grp: 'wood' });
    put(logName, { t: top, s: side, b: top, shape: 'cube', fam: 'log', grp: 'wood', axis: true });
    if (w !== 'bamboo') put(logName.replace(/_(log|stem)$/, w === 'crimson' || w === 'warped' ? '_hyphae' : '_wood'), { t: side, s: side, b: side, shape: 'cube', fam: 'log', grp: 'wood', axis: true });
    if (STRIPPED[w]) put('stripped_' + logName, { t: STRIPPED[w][1], s: STRIPPED[w][0], b: STRIPPED[w][1], shape: 'cube', fam: 'log', grp: 'wood', axis: true });
    if (LEAVES[w]) put(w + '_leaves', { t: LEAVES[w], s: LEAVES[w], b: LEAVES[w], shape: 'cube', fam: 'leaves', grp: 'leaves', tint: tint || null, leafy: true });
  });
  put('azalea_leaves', { t: 'block/azalea_leaves', s: 'block/azalea_leaves', b: 'block/azalea_leaves', shape: 'cube', fam: 'leaves', grp: 'leaves', leafy: true });
  put('flowering_azalea_leaves', { t: 'block/flowering_azalea_leaves', s: 'block/flowering_azalea_leaves', b: 'block/flowering_azalea_leaves', shape: 'cube', fam: 'leaves', grp: 'leaves', leafy: true });
  cube('bookshelf', 'block/oak_planks', 'block/bookshelf', 'block/oak_planks', { grp: 'wood' });
  // ---- colours (literal lists: the icon list scanner only sees written-out strings) ----
  const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const WOOL = ['block/white_wool', 'block/orange_wool', 'block/magenta_wool', 'block/light_blue_wool', 'block/yellow_wool', 'block/lime_wool', 'block/pink_wool', 'block/gray_wool', 'block/light_gray_wool', 'block/cyan_wool', 'block/purple_wool', 'block/blue_wool', 'block/brown_wool', 'block/green_wool', 'block/red_wool', 'block/black_wool'];
  const CONCRETE = ['block/white_concrete', 'block/orange_concrete', 'block/magenta_concrete', 'block/light_blue_concrete', 'block/yellow_concrete', 'block/lime_concrete', 'block/pink_concrete', 'block/gray_concrete', 'block/light_gray_concrete', 'block/cyan_concrete', 'block/purple_concrete', 'block/blue_concrete', 'block/brown_concrete', 'block/green_concrete', 'block/red_concrete', 'block/black_concrete'];
  const POWDER = ['block/white_concrete_powder', 'block/orange_concrete_powder', 'block/magenta_concrete_powder', 'block/light_blue_concrete_powder', 'block/yellow_concrete_powder', 'block/lime_concrete_powder', 'block/pink_concrete_powder', 'block/gray_concrete_powder', 'block/light_gray_concrete_powder', 'block/cyan_concrete_powder', 'block/purple_concrete_powder', 'block/blue_concrete_powder', 'block/brown_concrete_powder', 'block/green_concrete_powder', 'block/red_concrete_powder', 'block/black_concrete_powder'];
  const TERRA = ['block/white_terracotta', 'block/orange_terracotta', 'block/magenta_terracotta', 'block/light_blue_terracotta', 'block/yellow_terracotta', 'block/lime_terracotta', 'block/pink_terracotta', 'block/gray_terracotta', 'block/light_gray_terracotta', 'block/cyan_terracotta', 'block/purple_terracotta', 'block/blue_terracotta', 'block/brown_terracotta', 'block/green_terracotta', 'block/red_terracotta', 'block/black_terracotta'];
  const STAINED = ['block/white_stained_glass', 'block/orange_stained_glass', 'block/magenta_stained_glass', 'block/light_blue_stained_glass', 'block/yellow_stained_glass', 'block/lime_stained_glass', 'block/pink_stained_glass', 'block/gray_stained_glass', 'block/light_gray_stained_glass', 'block/cyan_stained_glass', 'block/purple_stained_glass', 'block/blue_stained_glass', 'block/brown_stained_glass', 'block/green_stained_glass', 'block/red_stained_glass', 'block/black_stained_glass'];
  COLORS.forEach((c, i) => {
    cube(c + '_wool', WOOL[i], null, null, { grp: 'colour' });
    cube(c + '_concrete', CONCRETE[i], null, null, { grp: 'colour' });
    cube(c + '_terracotta', TERRA[i], null, null, { grp: 'colour' });
    put(c + '_concrete_powder', { t: POWDER[i], s: POWDER[i], b: POWDER[i], shape: 'cube', fam: 'gravity', grp: 'colour' });
    put(c + '_stained_glass', { t: STAINED[i], s: STAINED[i], b: STAINED[i], shape: 'cube', fam: 'glass', grp: 'glass', cut: 'translucent' });
    put(c + '_carpet', { t: WOOL[i], s: WOOL[i], b: WOOL[i], shape: 'carpet', fam: 'carpet', grp: 'colour' });
  });
  cube('terracotta', 'block/terracotta', null, null, { grp: 'colour' });
  // ---- minerals + ores ----
  [['iron_block', 'block/iron_block'], ['gold_block', 'block/gold_block'], ['diamond_block', 'block/diamond_block'], ['emerald_block', 'block/emerald_block'],
    ['lapis_block', 'block/lapis_block'], ['coal_block', 'block/coal_block'], ['netherite_block', 'block/netherite_block'], ['amethyst_block', 'block/amethyst_block'],
    ['copper_block', 'block/copper_block'], ['exposed_copper', 'block/exposed_copper'], ['weathered_copper', 'block/weathered_copper'], ['oxidized_copper', 'block/oxidized_copper'],
    ['cut_copper', 'block/cut_copper'], ['raw_iron_block', 'block/raw_iron_block'], ['raw_gold_block', 'block/raw_gold_block'], ['raw_copper_block', 'block/raw_copper_block'],
  ].forEach(([n, t]) => cube(n, t, null, null, { grp: 'mineral' }));
  [['coal_ore', 'block/coal_ore'], ['iron_ore', 'block/iron_ore'], ['copper_ore', 'block/copper_ore'], ['gold_ore', 'block/gold_ore'], ['redstone_ore', 'block/redstone_ore'],
    ['lapis_ore', 'block/lapis_ore'], ['diamond_ore', 'block/diamond_ore'], ['emerald_ore', 'block/emerald_ore'], ['deepslate_diamond_ore', 'block/deepslate_diamond_ore'],
    ['deepslate_iron_ore', 'block/deepslate_iron_ore'], ['nether_quartz_ore', 'block/nether_quartz_ore'], ['nether_gold_ore', 'block/nether_gold_ore'],
  ].forEach(([n, t]) => cube(n, t, null, null, { grp: 'ore' }));
  cube('ancient_debris', 'block/ancient_debris_top', 'block/ancient_debris_side', 'block/ancient_debris_top', { grp: 'ore' });
  // ---- natural ----
  cube('dirt', 'block/dirt', null, null, { grp: 'natural' });
  cube('coarse_dirt', 'block/coarse_dirt', null, null, { grp: 'natural' });
  cube('rooted_dirt', 'block/rooted_dirt', null, null, { grp: 'natural' });
  cube('grass_block', 'block/grass_block_top', 'block/grass_block_side', 'block/dirt', { grp: 'natural', tint: { t: '#91bd59' }, ov: { s: 'block/grass_block_side_overlay', tint: '#91bd59' } });
  cube('podzol', 'block/podzol_top', 'block/podzol_side', 'block/dirt', { grp: 'natural' });
  cube('mycelium', 'block/mycelium_top', 'block/mycelium_side', 'block/dirt', { grp: 'natural' });
  cube('moss_block', 'block/moss_block', null, null, { grp: 'natural' });
  cube('clay', 'block/clay', null, null, { grp: 'natural' });
  cube('snow_block', 'block/snow', null, null, { grp: 'natural' });
  cube('packed_ice', 'block/packed_ice', null, null, { grp: 'natural' });
  cube('blue_ice', 'block/blue_ice', null, null, { grp: 'natural' });
  cube('pumpkin', 'block/pumpkin_top', 'block/pumpkin_side', 'block/pumpkin_top', { grp: 'natural' });
  cube('melon', 'block/melon_top', 'block/melon_side', 'block/melon_top', { grp: 'natural' });
  cube('hay_block', 'block/hay_block_top', 'block/hay_block_side', 'block/hay_block_top', { grp: 'farm', axis: true });
  cube('dried_kelp_block', 'block/dried_kelp_top', 'block/dried_kelp_side', 'block/dried_kelp_bottom', { grp: 'natural' });
  cube('sponge', 'block/sponge', null, null, { grp: 'natural' });
  cube('bone_block', 'block/bone_block_top', 'block/bone_block_side', 'block/bone_block_top', { grp: 'natural', axis: true });
  cube('crafting_table', 'block/crafting_table_top', 'block/crafting_table_side', 'block/oak_planks', { grp: 'wood', f: 'block/crafting_table_front', dir: 'fixed-front' });
  put('sand', { t: 'block/sand', s: 'block/sand', b: 'block/sand', shape: 'cube', fam: 'gravity', grp: 'natural' });
  put('red_sand', { t: 'block/red_sand', s: 'block/red_sand', b: 'block/red_sand', shape: 'cube', fam: 'gravity', grp: 'natural' });
  put('gravel', { t: 'block/gravel', s: 'block/gravel', b: 'block/gravel', shape: 'cube', fam: 'gravity', grp: 'natural' });
  put('ice', { t: 'block/ice', s: 'block/ice', b: 'block/ice', shape: 'cube', fam: null, grp: 'natural', cut: 'translucent', fn: 'Ice melts near light and makes things slide.' });
  // ---- glass + light ----
  put('glass', { t: 'block/glass', s: 'block/glass', b: 'block/glass', shape: 'cube', fam: 'glass', grp: 'glass', cut: 'cutout' });
  put('tinted_glass', { t: 'block/tinted_glass', s: 'block/tinted_glass', b: 'block/tinted_glass', shape: 'cube', fam: 'glass', grp: 'glass', cut: 'translucent' });
  [['glowstone', 'block/glowstone'], ['sea_lantern', 'block/sea_lantern'], ['shroomlight', 'block/shroomlight']].forEach(([n, t]) => put(n, { t, s: t, b: t, shape: 'cube', fam: 'light', grp: 'light', glow: true }));
  put('ochre_froglight', { t: 'block/ochre_froglight_top', s: 'block/ochre_froglight_side', b: 'block/ochre_froglight_top', shape: 'cube', fam: 'light', grp: 'light', glow: true, axis: true });
  put('pearlescent_froglight', { t: 'block/pearlescent_froglight_top', s: 'block/pearlescent_froglight_side', b: 'block/pearlescent_froglight_top', shape: 'cube', fam: 'light', grp: 'light', glow: true, axis: true });
  put('jack_o_lantern', { t: 'block/pumpkin_top', s: 'block/pumpkin_side', b: 'block/pumpkin_top', f: 'block/jack_o_lantern', shape: 'cube', fam: 'light', grp: 'light', glow: true, dir: 'f4' });
  put('torch', { t: 'block/torch', s: 'block/torch', b: 'block/torch', shape: 'torch', fam: null, grp: 'light', icon: 'block/torch', fn: 'Light: keeps mobs from spawning and plants growing.' });
  put('wall_torch', { t: 'block/torch', s: 'block/torch', b: 'block/torch', shape: 'torch', fam: null, grp: 'light', icon: 'block/torch', item: 'torch', fn: 'Light: keeps mobs from spawning and plants growing.' });

  // ---- functional: redstone, transport, containers, liquids, crops ----
  const RS = 'Redstone part: the machine needs exactly this block.';
  put('redstone_wire', { t: 'block/redstone_dust_dot', s: 'block/redstone_dust_dot', b: 'block/redstone_dust_dot', shape: 'dust', grp: 'redstone', icon: 'item/redstone', item: 'redstone', fn: RS, tint: '#e02a1b', ov: { t: 'block/redstone_dust_line0', tint: '#e02a1b' } });
  put('redstone_block', { t: 'block/redstone_block', s: 'block/redstone_block', b: 'block/redstone_block', shape: 'cube', grp: 'redstone', fn: RS });
  put('redstone_torch', { t: 'block/redstone_torch', s: 'block/redstone_torch', b: 'block/redstone_torch', shape: 'torch', grp: 'redstone', icon: 'block/redstone_torch', fn: RS });
  put('redstone_wall_torch', { t: 'block/redstone_torch', s: 'block/redstone_torch', b: 'block/redstone_torch', shape: 'torch', grp: 'redstone', icon: 'block/redstone_torch', item: 'redstone_torch', fn: RS });
  put('redstone_lamp', { t: 'block/redstone_lamp', s: 'block/redstone_lamp', b: 'block/redstone_lamp', shape: 'cube', grp: 'redstone', fn: RS });
  put('repeater', { t: 'block/repeater', s: 'block/smooth_stone', b: 'block/smooth_stone', shape: 'diode', grp: 'redstone', icon: 'item/repeater', fn: RS });
  put('comparator', { t: 'block/comparator', s: 'block/smooth_stone', b: 'block/smooth_stone', shape: 'diode', grp: 'redstone', icon: 'item/comparator', fn: RS });
  put('piston', { t: 'block/piston_side', s: 'block/piston_side', b: 'block/piston_side', f: 'block/piston_top', i: 'block/piston_inner', k: 'block/piston_bottom', dir: 'f6', side: 'rot', shape: 'cube', solidish: true, grp: 'redstone', fn: 'Pistons break or push blocks: that is how the farm harvests.' });
  put('sticky_piston', { t: 'block/piston_side', s: 'block/piston_side', b: 'block/piston_side', f: 'block/piston_top_sticky', i: 'block/piston_inner', k: 'block/piston_bottom', dir: 'f6', side: 'rot', shape: 'cube', solidish: true, grp: 'redstone', fn: 'Pistons break or push blocks: that is how the farm harvests.' });
  put('piston_head', { t: 'block/piston_side', s: 'block/piston_side', b: 'block/piston_side', f: 'block/piston_top', k: 'block/piston_side', dir: 'f6', side: 'rot', shape: 'pistonhead', grp: 'redstone', fn: 'The arm of an extended piston.' });
  put('observer', { t: 'block/observer_top', s: 'block/observer_side', b: 'block/observer_top', f: 'block/observer_front', k: 'block/observer_back', dir: 'f6', side: 'observer', shape: 'cube', solidish: true, grp: 'redstone', fn: 'The observer notices the crop growing and fires the pistons.' });
  put('dispenser', { t: 'block/furnace_top', s: 'block/furnace_side', b: 'block/furnace_top', f: 'block/dispenser_front', fv: 'block/dispenser_front_vertical', dir: 'f6', shape: 'cube', solidish: true, grp: 'redstone', fn: RS });
  put('dropper', { t: 'block/furnace_top', s: 'block/furnace_side', b: 'block/furnace_top', f: 'block/dropper_front', fv: 'block/dropper_front_vertical', dir: 'f6', shape: 'cube', solidish: true, grp: 'redstone', fn: RS });
  put('hopper', { t: 'block/hopper_top', s: 'block/hopper_outside', b: 'block/hopper_outside', k: 'block/hopper_inside', shape: 'hopper', grp: 'redstone', icon: 'item/hopper', fn: 'Hoppers collect the drops and move them into the chest.' });
  put('chest', { t: '#chest_top', s: '#chest_side', b: '#chest_top', f: '#chest_front', dir: 'f4', shape: 'chest', grp: 'misc', icon: 'chest', fn: 'Storage: the hoppers feed into it.' });
  put('trapped_chest', { t: '#chest_top', s: '#chest_side', b: '#chest_top', f: '#chest_front', dir: 'f4', shape: 'chest', grp: 'redstone', icon: 'chest', fn: RS });
  put('barrel', { t: 'block/barrel_top', s: 'block/barrel_side', b: 'block/barrel_bottom', dir: 'f6', f: 'block/barrel_top', k: 'block/barrel_bottom', side: 'rot', shape: 'cube', grp: 'misc', fn: 'Storage: items are collected into it.' });
  put('furnace', { t: 'block/furnace_top', s: 'block/furnace_side', b: 'block/furnace_top', f: 'block/furnace_front', dir: 'f4', shape: 'cube', grp: 'misc', fn: 'Workstation: it cooks what the farm delivers.' });
  put('composter', { t: 'block/composter_top', s: 'block/composter_side', b: 'block/composter_bottom', shape: 'cube', grp: 'farm', fn: 'Composter: part of the bone meal loop.' });
  put('rail', { t: 'block/rail', s: 'block/rail', b: 'block/rail', shape: 'rail', grp: 'redstone', icon: 'block/rail', fn: 'Rails carry the minecart.' });
  put('powered_rail', { t: 'block/powered_rail', s: 'block/powered_rail', b: 'block/powered_rail', shape: 'rail', grp: 'redstone', icon: 'block/powered_rail', fn: 'Rails carry the minecart.' });
  put('detector_rail', { t: 'block/detector_rail', s: 'block/detector_rail', b: 'block/detector_rail', shape: 'rail', grp: 'redstone', icon: 'block/detector_rail', fn: 'Rails carry the minecart.' });
  put('activator_rail', { t: 'block/activator_rail', s: 'block/activator_rail', b: 'block/activator_rail', shape: 'rail', grp: 'redstone', icon: 'block/activator_rail', fn: 'Rails carry the minecart.' });
  put('lever', { t: 'block/cobblestone', s: 'block/cobblestone', b: 'block/cobblestone', shape: 'lever', grp: 'redstone', icon: 'block/lever', fn: RS });
  put('stone_button', { t: 'block/stone', s: 'block/stone', b: 'block/stone', shape: 'button', grp: 'redstone', fn: RS });
  put('oak_button', { t: 'block/oak_planks', s: 'block/oak_planks', b: 'block/oak_planks', shape: 'button', grp: 'redstone', fn: RS });
  put('stone_pressure_plate', { t: 'block/stone', s: 'block/stone', b: 'block/stone', shape: 'plate', grp: 'redstone', fn: RS });
  put('oak_pressure_plate', { t: 'block/oak_planks', s: 'block/oak_planks', b: 'block/oak_planks', shape: 'plate', grp: 'redstone', fn: RS });
  put('tnt', { t: 'block/tnt_top', s: 'block/tnt_side', b: 'block/tnt_bottom', shape: 'cube', grp: 'redstone', fn: RS });
  put('note_block', { t: 'block/note_block', s: 'block/note_block', b: 'block/note_block', shape: 'cube', grp: 'redstone', fn: RS });
  put('target', { t: 'block/target_top', s: 'block/target_side', b: 'block/target_top', shape: 'cube', grp: 'redstone', fn: RS });
  put('daylight_detector', { t: 'block/daylight_detector_top', s: 'block/daylight_detector_side', b: 'block/daylight_detector_side', shape: 'sensor', grp: 'redstone', fn: RS });
  put('slime_block', { t: 'block/slime_block', s: 'block/slime_block', b: 'block/slime_block', shape: 'cube', cut: 'translucent', grp: 'redstone', fn: 'Slime sticks to pistons and bounces mobs.' });
  put('honey_block', { t: 'block/honey_block_top', s: 'block/honey_block_side', b: 'block/honey_block_bottom', shape: 'cube', cut: 'translucent', grp: 'redstone', fn: 'Honey sticks to pistons and slows mobs.' });
  put('water', { t: 'block/water_still', s: 'block/water_still', b: 'block/water_still', shape: 'liquid', cut: 'translucent', tint: '#3f76e4', alpha: 0.72, grp: 'misc', icon: 'item/water_bucket', item: 'water_bucket', fn: 'Water makes the crop grow or carries items and mobs.' });
  put('lava', { t: 'block/lava_still', s: 'block/lava_still', b: 'block/lava_still', shape: 'liquid', grp: 'misc', glow: true, icon: 'item/lava_bucket', item: 'lava_bucket', fn: 'Lava kills or cooks: the farm depends on it.' });
  put('mud', { t: 'block/mud', s: 'block/mud', b: 'block/mud', shape: 'cube', grp: 'farm', fn: 'Mud is slightly lower than a full block, so the hopper below can pull the drops through it.' });
  put('farmland', { t: 'block/farmland_moist', s: 'block/dirt', b: 'block/dirt', shape: 'farmland', grp: 'farm', fn: 'Crops only grow on farmland.' });
  put('soul_sand', { t: 'block/soul_sand', s: 'block/soul_sand', b: 'block/soul_sand', shape: 'cube', grp: 'nether', fn: 'Soul sand makes bubble columns and slows mobs.' });
  put('magma_block', { t: 'block/magma', s: 'block/magma', b: 'block/magma', shape: 'cube', grp: 'nether', glow: true, fn: 'Magma hurts mobs and makes down-bubbles.' });
  put('spawner', { t: 'block/spawner', s: 'block/spawner', b: 'block/spawner', shape: 'cube', cut: 'cutout', grp: 'misc', fn: 'The spawner is the heart of the farm.' });
  put('sugar_cane', { t: 'block/sugar_cane', s: 'block/sugar_cane', b: 'block/sugar_cane', shape: 'cross', tint: '#91bd59', grp: 'farm', icon: 'item/sugar_cane', fn: 'The crop itself.' });
  put('bamboo', { t: 'block/bamboo_stalk', s: 'block/bamboo_stalk', b: 'block/bamboo_stalk', shape: 'bamboo', grp: 'farm', icon: 'item/bamboo', fn: 'The crop itself.' });
  put('cactus', { t: 'block/cactus_top', s: 'block/cactus_side', b: 'block/cactus_bottom', shape: 'cactus', grp: 'farm', fn: 'The crop itself.' });
  put('wheat', { t: 'block/wheat_stage7', s: 'block/wheat_stage7', b: 'block/wheat_stage7', shape: 'cross', grp: 'farm', icon: 'item/wheat', item: 'wheat_seeds', fn: 'The crop itself.' });
  put('short_grass', { t: 'block/short_grass', s: 'block/short_grass', b: 'block/short_grass', shape: 'cross', tint: '#91bd59', grp: 'natural', fam: null });
  put('poppy', { t: 'block/poppy', s: 'block/poppy', b: 'block/poppy', shape: 'cross', grp: 'natural' });
  put('dandelion', { t: 'block/dandelion', s: 'block/dandelion', b: 'block/dandelion', shape: 'cross', grp: 'natural' });
  put('oak_sapling', { t: 'block/oak_sapling', s: 'block/oak_sapling', b: 'block/oak_sapling', shape: 'cross', grp: 'natural' });

  // ---- shaped variants generated from their base block (no new textures) ----
  const VARIANT_BASES = {
    // slab / stairs prefix -> base block
    stone: 'stone', cobblestone: 'cobblestone', mossy_cobblestone: 'mossy_cobblestone', stone_brick: 'stone_bricks', mossy_stone_brick: 'mossy_stone_bricks',
    smooth_stone: 'smooth_stone', granite: 'granite', polished_granite: 'polished_granite', diorite: 'diorite', polished_diorite: 'polished_diorite',
    andesite: 'andesite', polished_andesite: 'polished_andesite', brick: 'bricks', mud_brick: 'mud_bricks', sandstone: 'sandstone', smooth_sandstone: 'smooth_sandstone',
    cut_sandstone: 'cut_sandstone', red_sandstone: 'red_sandstone', cobbled_deepslate: 'cobbled_deepslate', polished_deepslate: 'polished_deepslate',
    deepslate_brick: 'deepslate_bricks', deepslate_tile: 'deepslate_tiles', tuff: 'tuff', polished_tuff: 'polished_tuff', tuff_brick: 'tuff_bricks',
    nether_brick: 'nether_bricks', red_nether_brick: 'red_nether_bricks', blackstone: 'blackstone', polished_blackstone: 'polished_blackstone',
    polished_blackstone_brick: 'polished_blackstone_bricks', quartz: 'quartz_block', smooth_quartz: 'smooth_quartz', end_stone_brick: 'end_stone_bricks',
    purpur: 'purpur_block', prismarine: 'prismarine', prismarine_brick: 'prismarine_bricks', dark_prismarine: 'dark_prismarine', cut_copper: 'cut_copper',
  };
  WOODS.forEach(([w]) => { VARIANT_BASES[w] = w + '_planks'; });
  Object.entries(VARIANT_BASES).forEach(([pre, base]) => {
    const b = BLOCKS[base];
    if (!b) return;
    const slabSide = base === 'smooth_stone' ? 'block/smooth_stone_slab_side' : b.s;
    put(pre + '_slab', { t: b.t, s: slabSide, b: b.b, shape: 'slab', fam: 'slab', grp: b.grp, from: base });
    if (base !== 'smooth_stone') put(pre + '_stairs', { t: b.t, s: b.s, b: b.b, shape: 'stairs', fam: 'stairs', grp: b.grp, from: base });
  });
  WOODS.forEach(([w]) => {
    if (w === 'bamboo') return;
    const p = BLOCKS[w + '_planks'];
    put(w + '_fence', { t: p.t, s: p.s, b: p.b, shape: 'fence', fam: 'fence', grp: 'wood', from: w + '_planks' });
  });
  put('nether_brick_fence', { t: 'block/nether_bricks', s: 'block/nether_bricks', b: 'block/nether_bricks', shape: 'fence', fam: 'fence', grp: 'nether', from: 'nether_bricks' });
  // stone walls render like fences (post + arms), their own family
  [['cobblestone_wall', 'cobblestone'], ['mossy_cobblestone_wall', 'mossy_cobblestone'], ['stone_brick_wall', 'stone_bricks'], ['brick_wall', 'bricks'],
    ['cobbled_deepslate_wall', 'cobbled_deepslate'], ['deepslate_brick_wall', 'deepslate_bricks'], ['andesite_wall', 'andesite'], ['granite_wall', 'granite'],
    ['diorite_wall', 'diorite'], ['sandstone_wall', 'sandstone'], ['blackstone_wall', 'blackstone'], ['nether_brick_wall', 'nether_bricks'], ['mud_brick_wall', 'mud_bricks'],
  ].forEach(([n, base]) => { const b = BLOCKS[base]; put(n, { t: b.t, s: b.s, b: b.b, shape: 'wall', fam: 'wall', grp: b.grp, from: base }); });

  // families that do not take part in swapping
  Object.values(BLOCKS).forEach((d) => { if (d.fn) d.fam = null; });

  /** Group order for pickers. */
  const GROUP_ORDER = ['stone', 'deep', 'sand', 'wood', 'colour', 'nether', 'end', 'mineral', 'ore', 'natural', 'glass', 'leaves', 'light', 'farm', 'redstone', 'misc'];

  const UNKNOWN = { t: '#unknown', s: '#unknown', b: '#unknown', shape: 'cube', unknown: true, fam: null, fn: null };
  /*
   * Blocks not in BLOCKS come from the game's block database (js/data/block-db.js, every block of the current version):
   * shape (cube / slab / stairs / wall / fence / carpet / cross; panes draw as fences, any other shape as a cube with
   * its side texture), top / side / bottom textures, translucency, leaves, light, tint. Building shapes swap within
   * their family; plain building cubes join the 'cube' family, machines and odd blocks never swap.
   */
  const DB_SHAPE = { cube: 'cube', slab: 'slab', stairs: 'stairs', wall: 'wall', fence: 'fence', pane: 'fence', carpet: 'carpet', cross: 'cross' };
  const DB_BUILD = /(bricks?|tiles|planks|stone|wool|concrete|terracotta|polished|chiseled|^cut_|smooth|_block$|tuff|sulfur|cinnabar|copper$|deepslate|blackstone|sandstone|moss|mud|calcite|basalt|prismarine|purpur|quartz|_log$|_wood$|_stem$|hyphae)/;
  const DB_FUNC = /crafter|vault|spawner|command|structure|jigsaw|redstone|observer|piston|dispenser|dropper|tnt|sculk_(sensor|shrieker|catalyst)|target|lamp|bulb|furnace|smoker|chest|barrel|hopper|beacon|conduit|respawn|lodestone|anvil|table|loom|grindstone|stonecutter|lectern|composter|cauldron|bell|honey|slime|note_block|jukebox|daylight|rail|button|pressure_plate|trapdoor|door|fence_gate|bed$|sign$|banner$|shulker|creaking_heart|heavy_core|trial|copper_golem/;
  /** A viewer shape for the database's 'other' blocks (buttons, plates, rails, fans, lanterns ...); else a cube. */
  function dbOther(name, flags) {
    if (/_button$/.test(name)) return 'button';
    if (/pressure_plate$/.test(name)) return 'plate';
    if (/_trapdoor$|^snow$|leaf_litter|pink_petals|wildflowers|lily_pad|glow_lichen|sculk_vein|resin_clump|^vine$/.test(name)) return 'carpet';
    if (/rail$/.test(name)) return 'rail';
    if (/torch$/.test(name)) return 'torch';
    if (/_fence_gate$|_bars$/.test(name)) return 'fence';
    if (/^(farmland|dirt_path)$/.test(name)) return 'farmland';
    if (/_door$|_bed$|chest$|shulker_box$|_head$|_skull$|_banner$|_sign$|anvil|cauldron|lectern|stonecutter|grindstone|enchanting_table|end_portal_frame|daylight|composter|bell|vault|heavy_core|decorated_pot|campfire|cake|beacon|conduit|sniffer_egg|dried_ghast|copper_golem_statue|_shelf$|hopper|brewing_stand|piston|moving_piston|sculk_sensor|sculk_shrieker|honey_block|slime_block|scaffolding|chorus|mushroom|dragon_egg|end_gateway|end_portal$|nether_portal|cactus|bubble_column|structure_void|light$|barrier/.test(name)) return 'cube';
    if (flags & 64 || flags & 4 || /coral|_fan$|lantern|chain$|candle|pointed_dripstone|sulfur_spike|propagule|azalea|dripleaf|spore_blossom|sea_pickle|turtle_egg|frogspawn|cocoa|stem$|crop$|pitcher|fire$|tripwire|lever|end_rod|lightning_rod|potted_|flower_pot|shelf_mushroom|red_shrub/.test(name)) return 'cross';
    return 'cube';
  }
  const dbCache = new Map();
  function dbDef(name) {
    if (dbCache.has(name)) return dbCache.get(name);
    const D = TH.data && TH.data.blockDb, e = D && D.b[name];
    let d = null;
    if (e) {
      const k = (t) => (t && t !== 'missingno' ? (String(t).includes('/') ? t : 'block/' + t) : null);
      const tsb = [].concat(e[1] || []), flags = e[2] || 0;
      const t = k(tsb[0]), s = k(tsb[1] || tsb[0]), b = k(tsb[2] || tsb[0]);
      if (t || s) {
        const shape = DB_SHAPE[e[0]] || dbOther(name, flags);
        const functional = DB_FUNC.test(name);
        const fam = functional ? null : { slab: 'slab', stairs: 'stairs', wall: 'wall', carpet: 'carpet' }[shape] || (shape === 'fence' && e[0] === 'fence' ? 'fence' : null)
          || (shape === 'cube' && e[0] === 'cube' ? (flags & 8 ? 'leaves' : flags & 2 ? 'glass' : DB_BUILD.test(name) ? 'cube' : null) : null);
        d = { t: t || s, s: s || t, b: b || s || t, shape, fam, grp: 'misc', db: true,
          cut: flags & 2 ? 'translucent' : (flags & 4) || e[0] === 'pane' ? 'cutout' : null, leafy: !!(flags & 8), glow: !!(flags & 16), tint: e[3] || null };
        if (!(flags & 1)) { const m = name.match(/^(.+)_wall_(torch|sign|hanging_sign|banner|fan)$/); if (m) d.item = m[1] + '_' + m[2]; }
        if (d.tint && name === 'grass_block') d.tint = { t: d.tint };
      }
    }
    dbCache.set(name, d);
    return d;
  }
  /** Definition for a block state id (unknown blocks get a neutral cube). */
  function def(id) {
    const p = parse(id);
    return (p.ns === 'minecraft' && (BLOCKS[p.name] || dbDef(p.name))) || UNKNOWN;
  }
  const known = (id) => def(id) !== UNKNOWN;
  /** Is this block one the user may swap? Returns { ok, why }. */
  function replaceable(id) {
    const d = def(id);
    if (d === UNKNOWN) return { ok: false, why: 'Not a block this tool knows, so it stays as it is.' };
    if (d.fn) return { ok: false, why: d.fn };
    if (!d.fam) return { ok: false, why: 'This block has no safe replacement of the same shape.' };
    return { ok: true, why: '' };
  }
  /** Every non-functional block of a family (for the picker), in group order. */
  function familyOf(fam) {
    return Object.keys(BLOCKS).filter((n) => BLOCKS[n].fam === fam && !BLOCKS[n].fn).sort((a, b) => GROUP_ORDER.indexOf(BLOCKS[a].grp) - GROUP_ORDER.indexOf(BLOCKS[b].grp) || a.localeCompare(b));
  }
  /** Building blocks offered to the shape generators (full blocks people build with). */
  function buildingBlocks() {
    return Object.keys(BLOCKS).filter((n) => ['cube', 'log', 'glass', 'leaves', 'light', 'gravity'].includes(BLOCKS[n].fam)).sort((a, b) => GROUP_ORDER.indexOf(BLOCKS[a].grp) - GROUP_ORDER.indexOf(BLOCKS[b].grp) || a.localeCompare(b));
  }

  /* ---- names (Mojang strings when the language data has them) ---- */
  function lang(key) {
    const L = TH.langData || {};
    const d = TH.i18n && L[TH.i18n.lang];
    return (d && d[key]) || (L.en_us && L.en_us[key]) || null;
  }
  const titleCase = (s) => s.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  function nameOf(id) {
    const p = parse(id);
    const d = BLOCKS[p.name] || dbDef(p.name);
    const n = d && d.item ? d.item : p.name;
    const dbn = TH.data && TH.data.blockDb && TH.data.blockDb.names;   // English names of the game version (where not the id in title case)
    return lang('block.' + p.ns + '.' + p.name) || lang('item.' + p.ns + '.' + n) || lang('block.' + p.ns + '.' + n) || (dbn && (dbn[p.name] || dbn[n])) || titleCase(n);
  }
  /** Icon key for TH.icon: the item sprite when there is one, else the block's side texture. */
  function iconOf(id) {
    const d = def(id);
    if (d.icon) return d.icon;
    const t = d.s || d.t;
    return t && t[0] !== '#' ? t : 'item/barrier';
  }

  /** The inventory-style icon of a block (TH.icon.block: isometric model or item sprite), else the flat texture. */
  function blockIcon(id, opts) {
    const p = parse(id);
    if (TH.icon.block && TH.icon.block.has(p.base)) return TH.icon.block(p.base, Object.assign({ fallback: iconOf(id) }, opts));
    return TH.icon(iconOf(id), opts);
  }

  /* ======================================================================
   * Schematic helpers
   * ====================================================================== */
  function create(sx, sy, sz, name) {
    return { name: name || 'Untitled', size: [sx, sy, sz], palette: [AIR], blocks: new Uint16Array(sx * sy * sz) };
  }
  const idx = (s, x, y, z) => (y * s.size[2] + z) * s.size[0] + x;
  const inside = (s, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < s.size[0] && y < s.size[1] && z < s.size[2];
  /** Palette index of a state, adding it when new (a Map cache lives on the schematic, non-enumerable). */
  function pal(s, id) {
    if (isAir(id)) return 0;
    let m = s._pi;
    if (!m) { m = new Map(s.palette.map((p, i) => [p, i])); Object.defineProperty(s, '_pi', { value: m, writable: true }); }
    let i = m.get(id);
    if (i == null) { i = s.palette.length; s.palette.push(id); m.set(id, i); }
    return i;
  }
  function get(s, x, y, z) { return inside(s, x, y, z) ? s.palette[s.blocks[idx(s, x, y, z)]] : AIR; }
  function set(s, x, y, z, id) { if (inside(s, x, y, z)) s.blocks[idx(s, x, y, z)] = pal(s, id); }
  /** Build a schematic by calling fn(x, y, z) -> block id | null for every cell. */
  function fromFunction(size, fn, name) {
    const s = create(size[0], size[1], size[2], name);
    for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
      const id = fn(x, y, z);
      if (id) s.blocks[idx(s, x, y, z)] = pal(s, id);
    }
    return s;
  }
  /** Non-air block count. */
  function volume(s) { let n = 0; const b = s.blocks; for (let i = 0; i < b.length; i++) if (b[i]) n++; return n; }
  /** [{ id, n }] per palette state, most first. byBase merges states of the same block. */
  function counts(s, byBase) {
    const c = new Uint32Array(s.palette.length), b = s.blocks;
    for (let i = 0; i < b.length; i++) c[b[i]]++;
    const m = new Map();
    for (let i = 1; i < c.length; i++) if (c[i]) { const k = byBase ? parse(s.palette[i]).base : s.palette[i]; m.set(k, (m.get(k) || 0) + c[i]); }
    return [...m].map(([id, n]) => ({ id, n })).sort((a, b2) => b2.n - a.n || a.id.localeCompare(b2.id));
  }
  /** Bounding box of the non-air blocks: { min:[x,y,z], max:[x,y,z] } or null. */
  function bbox(s) {
    const [sx, sy, sz] = s.size, b = s.blocks;
    let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
      if (!b[i]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return x1 < 0 ? null : { min: [x0, y0, z0], max: [x1, y1, z1] };
  }
  /** Copy with the size cropped to the blocks (an empty schematic stays 1x1x1). */
  function trim(s) {
    const bb = bbox(s);
    if (!bb) return create(1, 1, 1, s.name);
    const [x0, y0, z0] = bb.min, w = bb.max[0] - x0 + 1, hh = bb.max[1] - y0 + 1, d = bb.max[2] - z0 + 1;
    if (x0 === 0 && y0 === 0 && z0 === 0 && w === s.size[0] && hh === s.size[1] && d === s.size[2]) return s;
    const o = create(w, hh, d, s.name);
    o.palette = s.palette.slice();
    for (let y = 0; y < hh; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) o.blocks[(y * d + z) * w + x] = s.blocks[idx(s, x + x0, y + y0, z + z0)];
    return compact(o);
  }
  /** Drop unused palette entries and merge duplicates. */
  function compact(s) {
    const used = new Uint8Array(s.palette.length), b = s.blocks;
    for (let i = 0; i < b.length; i++) used[b[i]] = 1;
    const map = new Uint16Array(s.palette.length), pal2 = [AIR], seen = new Map([[AIR, 0]]);
    for (let i = 1; i < s.palette.length; i++) {
      if (!used[i]) continue;
      const id = isAir(s.palette[i]) ? AIR : s.palette[i];
      let j = seen.get(id);
      if (j == null) { j = pal2.length; pal2.push(id); seen.set(id, j); }
      map[i] = j;
    }
    for (let i = 0; i < b.length; i++) b[i] = map[b[i]];
    s.palette = pal2; s._pi = null;
    return s;
  }
  /** Blocks per layer (y): Uint32Array of counts. */
  function layers(s) {
    const [sx, sy, sz] = s.size, out = new Uint32Array(sy), b = s.blocks, per = sx * sz;
    for (let y = 0; y < sy; y++) { let n = 0; for (let i = y * per, e = i + per; i < e; i++) if (b[i]) n++; out[y] = n; }
    return out;
  }
  /** Copy b into a at offset (dx, dy, dz), growing a as needed; air in b never overwrites. Returns a new schematic. */
  function merge(a, b, dx, dy, dz) {
    const x0 = Math.min(0, dx), y0 = Math.min(0, dy), z0 = Math.min(0, dz);
    const x1 = Math.max(a.size[0], dx + b.size[0]), y1 = Math.max(a.size[1], dy + b.size[1]), z1 = Math.max(a.size[2], dz + b.size[2]);
    const o = create(x1 - x0, y1 - y0, z1 - z0, a.name);
    const copy = (src, ox, oy, oz) => {
      const [sx, sy, sz] = src.size, map = src.palette.map((p) => pal(o, p));
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const v = src.blocks[(y * sz + z) * sx + x];
        if (v) o.blocks[idx(o, x + ox, y + oy, z + oz)] = map[v];
      }
    };
    copy(a, -x0, -y0, -z0); copy(b, dx - x0, dy - y0, dz - z0);
    return o;
  }
  /** Shift all blocks by (dx, dy, dz) inside a grown box. */
  const translate = (s, dx, dy, dz) => merge(create(1, 1, 1, s.name), s, dx, dy, dz);
  function clone(s) { return { name: s.name, size: s.size.slice(), palette: s.palette.slice(), blocks: new Uint16Array(s.blocks) }; }
  /**
   * Apply block swaps { 'minecraft:stone_bricks': 'minecraft:deepslate_bricks' } (keys and values are base ids).
   * Only the palette changes: properties are kept, functional blocks are never touched. Returns a new schematic.
   */
  function applySwaps(s, swaps) {
    if (!swaps || !Object.keys(swaps).length) return s;
    const o = { name: s.name, size: s.size.slice(), palette: s.palette.map((id) => {
      const p = parse(id), to = swaps[p.base];
      return to && replaceable(id).ok ? withBase(id, to) : id;
    }), blocks: new Uint16Array(s.blocks) };
    return compact(o);
  }
  /** Run-length text of the block indices: "count*index" pairs (count omitted when 1), comma separated. */
  function rle(blocks) {
    const out = [];
    for (let i = 0; i < blocks.length;) {
      const v = blocks[i];
      let j = i + 1;
      while (j < blocks.length && blocks[j] === v) j++;
      out.push(j - i > 1 ? (j - i) + '*' + v : String(v));
      i = j;
    }
    return out.join(',');
  }
  function unrle(text, n) {
    const out = new Uint16Array(n);
    let i = 0;
    for (const part of String(text).split(',')) {
      if (!part) continue;
      const st = part.indexOf('*');
      const c = st >= 0 ? parseInt(part.slice(0, st), 10) : 1, v = parseInt(st >= 0 ? part.slice(st + 1) : part, 10);
      if (!(c > 0) || !(v >= 0) || i + c > n) throw new Error('bad block data');
      out.fill(v, i, i + c); i += c;
    }
    if (i !== n) throw new Error('block data has the wrong length');
    return out;
  }

  /* ======================================================================
   * Materials: what you need in your inventory
   * ====================================================================== */
  const STACK16 = new Set(['ender_pearl', 'snowball', 'egg', 'sign', 'oak_sign', 'bucket', 'honey_bottle', 'armor_stand']);
  const UNSTACK = new Set(['water_bucket', 'lava_bucket', 'minecart', 'hopper_minecart']);
  /** One placed block -> { item, n } (double slabs count 2, water is a bucket per source). */
  function itemOf(id) {
    const p = parse(id), d = p.ns === 'minecraft' ? BLOCKS[p.name] || dbDef(p.name) : null;
    let item = (d && d.item) || p.name, n = 1;
    if (d && d.shape === 'slab' && p.props.type === 'double') n = 2;
    if (p.name === 'piston_head' || p.name === 'moving_piston' || p.name === 'bubble_column') return null;
    if ((p.name === 'water' || p.name === 'lava') && p.props.level && p.props.level !== '0') return null;   // flowing liquid: no bucket
    return { item: p.ns + ':' + item, n, block: p.ns + ':' + p.name };
  }
  const stackOf = (item) => { const n = parse(item).name; return UNSTACK.has(n) ? 1 : STACK16.has(n) ? 16 : 64; };
  /** [{ item, block, n, stack }] sorted by count. */
  function materials(s) {
    const m = new Map();
    counts(s).forEach(({ id, n }) => {
      const it = itemOf(id);
      if (!it) return;
      const e = m.get(it.item) || { item: it.item, block: it.block, n: 0, stack: stackOf(it.item) };
      e.n += n * it.n;
      m.set(it.item, e);
    });
    return [...m.values()].sort((a, b) => b.n - a.n || a.item.localeCompare(b.item));
  }

  TH.builds.core = {
    AIR, parse, isAir, stateOf, withBase, BLOCKS, GROUPS: G, GROUP_ORDER, COLORS, def, known, replaceable, familyOf, buildingBlocks, nameOf, iconOf, blockIcon, titleCase,
    create, idx, inside, pal, get, set, fromFunction, volume, counts, bbox, trim, compact, layers, merge, translate, clone, applySwaps, rle, unrle,
    itemOf, stackOf, materials,
  };
})();
