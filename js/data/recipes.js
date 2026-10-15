/**
 * Recipes (Java 1.21) for the material list: a small rule-based engine, no UI.
 *
 *   TH.data.recipes.recipesFor(id)        -> [{ method, in: [[id, n], ...], out, note?, grid?, shapeless?, tool? }]
 *                                            every way to make the item
 *   TH.data.recipes.best(id, opts)        -> the recipe that needs the fewest base items (null = raw: mined / found / farmed)
 *   TH.data.recipes.raw(rows, opts)       -> { rows: [{ item, n }], steps: [{ item, method, crafts, made, need, recipe }] }
 *                                            the whole list expanded to raw materials, batches rounded up per step
 *   TH.data.recipes.describe(recipe, id)  -> '6× Polished Tuff → 4× Polished Tuff Stairs (crafting table)'
 *   opts = { sc: true (prefer the stonecutter), pick: { [id]: recipe index chosen by the user } }
 *
 * Crafting recipes carry the shape the game uses: `grid` = 9 cells of the 3 x 3 crafting grid (row by row, top left
 * aligned like the recipe book; null = empty), `shapeless` = true when the items may go anywhere (they are laid out in
 * order). Patterns are written 'AAA/A.A/AAA': rows split by '/', A-D = the 1st-4th input, '.' = empty, '*' = shapeless.
 * Every pattern is checked against the input counts when the table is built (a mismatch throws, so a typo cannot ship).
 * Conversions carry the `tool` texture (water bucket, axe, shears).
 *
 * Ids are 'minecraft:<name>' (bare names work too); 'tag:planks' etc. stand for "any planks". Only recipes we are sure
 * about are listed; anything without a rule counts as raw (you mine it, farm it or find it). Fuel for smelting is not
 * counted. Texture keys are written out as 'item/...' / 'block/...' literals so tools/build-icon-list.js bundles them.
 */
window.TH = window.TH || {};
TH.data = TH.data || {};
TH.data.recipes = (function () {
  'use strict';
  const R = Object.create(null);   // bare output name -> [recipe]
  const bare = (id) => { const s = String(id || ''); if (s.startsWith('tag:')) return s; const i = s.indexOf(':'); return (i >= 0 ? s.slice(i + 1) : s).replace(/\[.*$/, ''); };
  const full = (n) => (n.startsWith('tag:') ? n : 'minecraft:' + n);

  /** 'AAA/A.A/AAA' + inputs -> { grid: 9 cells, shapeless } (validated against the counts). */
  function layout(out, ins, pat) {
    if (!pat) return null;
    const ids = ins.map(([i]) => i);
    if (pat === '*') {
      const cells = [];
      ins.forEach(([i, c]) => { for (let k = 0; k < c; k++) cells.push(i); });
      if (cells.length > 9) throw new Error('recipes: too many items for ' + out);
      while (cells.length < 9) cells.push(null);
      return { grid: cells, shapeless: true };
    }
    const rows = pat.split('/');
    if (rows.length > 3 || rows.some((r) => r.length > 3)) throw new Error('recipes: bad pattern for ' + out);
    const grid = new Array(9).fill(null), seen = ins.map(() => 0);
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const ch = r[x]; if (ch === '.') continue; const k = ch.charCodeAt(0) - 65; if (!(k >= 0 && k < ids.length)) throw new Error('recipes: bad key in ' + out); grid[y * 3 + x] = ids[k]; seen[k]++; } });
    ins.forEach(([, c], k) => { if (seen[k] !== c) throw new Error('recipes: pattern of ' + out + ' does not match its inputs'); });
    return { grid, shapeless: false };
  }
  function add(out, method, ins, n, note, pat, tool) {
    const r = { method, in: ins.map(([i, c]) => [i, c]), out: n, note: note || null };
    const lay = method === 'crafting' ? layout(out, ins, pat) : null;
    if (lay) { r.grid = lay.grid; r.shapeless = lay.shapeless; }
    if (tool) r.tool = tool;
    (R[out] || (R[out] = [])).push(r);
  }
  /** craft(output, [[input, count], ...], made, pattern, note) */
  const craft = (out, ins, n, pat, note) => add(out, 'crafting', ins, n, note, pat);
  const cut = (out, from, n) => add(out, 'stonecutting', [[from, 1]], n);
  const smelt = (out, from) => add(out, 'smelting', [[from, 1]], 1);
  const convert = (out, from, note, tool) => add(out, 'conversion', [[from, 1]], 1, note, null, tool);
  const P2 = 'AA/AA', P3 = 'AAA/AAA/AAA', RING = 'AAA/ABA/AAA', STAIRS = 'A../AA./AAA';

  const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  /* ======================================================================
   * Stone-type blocks: shapes, stonecutter chains, polished / bricks / chiseled / cut / smooth / cracked
   * ====================================================================== */
  // stonecutter parents: block -> [the block it is cut from, how many one cut gives]
  const CUT_PARENT = {
    stone_bricks: ['stone', 1], chiseled_stone_bricks: ['stone_bricks', 1],
    polished_granite: ['granite', 1], polished_diorite: ['diorite', 1], polished_andesite: ['andesite', 1],
    cut_sandstone: ['sandstone', 1], chiseled_sandstone: ['sandstone', 1],
    cut_red_sandstone: ['red_sandstone', 1], chiseled_red_sandstone: ['red_sandstone', 1],
    chiseled_nether_bricks: ['nether_bricks', 1],
    quartz_bricks: ['quartz_block', 1], quartz_pillar: ['quartz_block', 1], chiseled_quartz_block: ['quartz_block', 1],
    purpur_pillar: ['purpur_block', 1],
    end_stone_bricks: ['end_stone', 1],
    polished_blackstone: ['blackstone', 1], polished_blackstone_bricks: ['polished_blackstone', 1], chiseled_polished_blackstone: ['polished_blackstone', 1],
    polished_deepslate: ['cobbled_deepslate', 1], deepslate_bricks: ['polished_deepslate', 1], deepslate_tiles: ['deepslate_bricks', 1], chiseled_deepslate: ['cobbled_deepslate', 1],
    polished_tuff: ['tuff', 1], tuff_bricks: ['polished_tuff', 1], chiseled_tuff: ['tuff', 1], chiseled_tuff_bricks: ['tuff_bricks', 1],
    polished_basalt: ['basalt', 1],
    cut_copper: ['copper_block', 4], chiseled_copper: ['cut_copper', 1], copper_grate: ['copper_block', 4],
  };
  /** Every block a stonecutter can turn into `name`, with the number one cut gives: [[from, n], ...] (nearest first). */
  function cutSources(name) {
    const out = [];
    let cur = name, k = 1;
    while (CUT_PARENT[cur]) { const [p, n] = CUT_PARENT[cur]; k *= n; out.push([p, k]); cur = p; }
    return out;
  }
  Object.keys(CUT_PARENT).forEach((b) => cutSources(b).forEach(([from, n]) => cut(b, from, n)));

  // slabs / stairs / walls: [prefix, base block, which exist: s = slab, t = stairs, w = wall]
  const SHAPES = [
    ['stone', 'stone', 'st'], ['smooth_stone', 'smooth_stone', 's'], ['cobblestone', 'cobblestone', 'stw'], ['mossy_cobblestone', 'mossy_cobblestone', 'stw'],
    ['stone_brick', 'stone_bricks', 'stw'], ['mossy_stone_brick', 'mossy_stone_bricks', 'stw'],
    ['granite', 'granite', 'stw'], ['polished_granite', 'polished_granite', 'st'], ['diorite', 'diorite', 'stw'], ['polished_diorite', 'polished_diorite', 'st'],
    ['andesite', 'andesite', 'stw'], ['polished_andesite', 'polished_andesite', 'st'],
    ['sandstone', 'sandstone', 'stw'], ['smooth_sandstone', 'smooth_sandstone', 'st'], ['cut_sandstone', 'cut_sandstone', 's'],
    ['red_sandstone', 'red_sandstone', 'stw'], ['smooth_red_sandstone', 'smooth_red_sandstone', 'st'], ['cut_red_sandstone', 'cut_red_sandstone', 's'],
    ['brick', 'bricks', 'stw'], ['mud_brick', 'mud_bricks', 'stw'],
    ['prismarine', 'prismarine', 'stw'], ['prismarine_brick', 'prismarine_bricks', 'st'], ['dark_prismarine', 'dark_prismarine', 'st'],
    ['nether_brick', 'nether_bricks', 'stw'], ['red_nether_brick', 'red_nether_bricks', 'stw'],
    ['quartz', 'quartz_block', 'st'], ['smooth_quartz', 'smooth_quartz', 'st'], ['purpur', 'purpur_block', 'st'],
    ['end_stone_brick', 'end_stone_bricks', 'stw'],
    ['blackstone', 'blackstone', 'stw'], ['polished_blackstone', 'polished_blackstone', 'stw'], ['polished_blackstone_brick', 'polished_blackstone_bricks', 'stw'],
    ['cobbled_deepslate', 'cobbled_deepslate', 'stw'], ['polished_deepslate', 'polished_deepslate', 'stw'], ['deepslate_brick', 'deepslate_bricks', 'stw'], ['deepslate_tile', 'deepslate_tiles', 'stw'],
    ['tuff', 'tuff', 'stw'], ['polished_tuff', 'polished_tuff', 'stw'], ['tuff_brick', 'tuff_bricks', 'stw'],
    ['cut_copper', 'cut_copper', 'st'],
  ];
  const BASE_OF = Object.create(null);   // shaped item -> the block whose texture / family it shares
  SHAPES.forEach(([pre, base, has]) => {
    const srcs = [[base, 1]].concat(cutSources(base));
    if (has.includes('s')) { BASE_OF[pre + '_slab'] = base; craft(pre + '_slab', [[base, 3]], 6, 'AAA'); srcs.forEach(([f, k]) => cut(pre + '_slab', f, 2 * k)); }
    if (has.includes('t')) { BASE_OF[pre + '_stairs'] = base; craft(pre + '_stairs', [[base, 6]], 4, STAIRS); srcs.forEach(([f, k]) => cut(pre + '_stairs', f, k)); }
    if (has.includes('w')) { BASE_OF[pre + '_wall'] = base; craft(pre + '_wall', [[base, 6]], 6, 'AAA/AAA'); srcs.forEach(([f, k]) => cut(pre + '_wall', f, k)); }
  });

  // 2x2 crafting, 4 -> 4
  [['stone_bricks', 'stone'], ['polished_granite', 'granite'], ['polished_diorite', 'diorite'], ['polished_andesite', 'andesite'],
    ['cut_sandstone', 'sandstone'], ['cut_red_sandstone', 'red_sandstone'], ['polished_blackstone', 'blackstone'], ['polished_blackstone_bricks', 'polished_blackstone'],
    ['polished_deepslate', 'cobbled_deepslate'], ['deepslate_bricks', 'polished_deepslate'], ['deepslate_tiles', 'deepslate_bricks'],
    ['polished_tuff', 'tuff'], ['tuff_bricks', 'polished_tuff'], ['end_stone_bricks', 'end_stone'], ['quartz_bricks', 'quartz_block'],
    ['polished_basalt', 'basalt'], ['mud_bricks', 'packed_mud'], ['cut_copper', 'copper_block'], ['copper_grate', 'copper_block'],
  ].forEach(([o, i]) => craft(o, [[i, 4]], 4, P2));
  craft('quartz_pillar', [['quartz_block', 2]], 2, 'A/A');
  // chiseled = two slabs stacked
  [['chiseled_stone_bricks', 'stone_brick_slab'], ['chiseled_sandstone', 'sandstone_slab'], ['chiseled_red_sandstone', 'red_sandstone_slab'],
    ['chiseled_quartz_block', 'quartz_slab'], ['purpur_pillar', 'purpur_slab'], ['chiseled_nether_bricks', 'nether_brick_slab'],
    ['chiseled_polished_blackstone', 'polished_blackstone_slab'], ['chiseled_deepslate', 'cobbled_deepslate_slab'], ['chiseled_tuff', 'tuff_slab'],
    ['chiseled_tuff_bricks', 'tuff_brick_slab'], ['chiseled_copper', 'cut_copper_slab'],
  ].forEach(([o, i]) => craft(o, [[i, 2]], 1, 'A/A'));
  // furnace
  [['stone', 'cobblestone'], ['smooth_stone', 'stone'], ['cracked_stone_bricks', 'stone_bricks'], ['smooth_sandstone', 'sandstone'],
    ['smooth_red_sandstone', 'red_sandstone'], ['smooth_quartz', 'quartz_block'], ['cracked_nether_bricks', 'nether_bricks'],
    ['cracked_polished_blackstone_bricks', 'polished_blackstone_bricks'], ['deepslate', 'cobbled_deepslate'], ['cracked_deepslate_bricks', 'deepslate_bricks'],
    ['cracked_deepslate_tiles', 'deepslate_tiles'], ['smooth_basalt', 'basalt'], ['glass', 'sand'], ['terracotta', 'clay'], ['brick', 'clay_ball'],
    ['nether_brick', 'netherrack'], ['popped_chorus_fruit', 'chorus_fruit'], ['dried_kelp', 'kelp'],
  ].forEach(([o, i]) => smelt(o, i));
  // blocks from items
  craft('sandstone', [['sand', 4]], 1, P2);
  craft('red_sandstone', [['red_sand', 4]], 1, P2);
  craft('bricks', [['brick', 4]], 1, P2);
  craft('nether_bricks', [['nether_brick', 4]], 1, P2);
  craft('red_nether_bricks', [['nether_brick', 2], ['nether_wart', 2]], 1, 'AB/BA');
  craft('quartz_block', [['quartz', 4]], 1, P2);
  craft('purpur_block', [['popped_chorus_fruit', 4]], 4, P2);
  craft('prismarine', [['prismarine_shard', 4]], 1, P2);
  craft('prismarine_bricks', [['prismarine_shard', 9]], 1, P3);
  craft('dark_prismarine', [['prismarine_shard', 8], ['black_dye', 1]], 1, RING);
  craft('sea_lantern', [['prismarine_shard', 4], ['prismarine_crystals', 5]], 1, 'ABA/BBB/ABA');
  craft('mossy_cobblestone', [['cobblestone', 1], ['moss_block', 1]], 1, '*');
  craft('mossy_cobblestone', [['cobblestone', 1], ['vine', 1]], 1, '*');
  craft('mossy_stone_bricks', [['stone_bricks', 1], ['moss_block', 1]], 1, '*');
  craft('mossy_stone_bricks', [['stone_bricks', 1], ['vine', 1]], 1, '*');
  craft('packed_mud', [['mud', 1], ['wheat', 1]], 1, '*');
  craft('nether_brick_fence', [['nether_bricks', 4], ['nether_brick', 2]], 6, 'ABA/ABA');
  BASE_OF.nether_brick_fence = 'nether_bricks';
  craft('dripstone_block', [['pointed_dripstone', 4]], 1, P2);
  craft('amethyst_block', [['amethyst_shard', 4]], 1, P2);
  craft('glowstone', [['glowstone_dust', 4]], 1, P2);
  craft('snow_block', [['snowball', 4]], 1, P2);
  craft('clay', [['clay_ball', 4]], 1, P2);
  craft('honey_block', [['honey_bottle', 4]], 1, P2);
  craft('bone_block', [['bone_meal', 9]], 1, P3);
  craft('bone_meal', [['bone', 1]], 3, '*');
  craft('packed_ice', [['ice', 9]], 1, P3);
  craft('blue_ice', [['packed_ice', 9]], 1, P3);
  craft('hay_block', [['wheat', 9]], 1, P3);
  craft('melon', [['melon_slice', 9]], 1, P3);
  craft('dried_kelp_block', [['dried_kelp', 9]], 1, P3);
  craft('slime_block', [['slime_ball', 9]], 1, P3);
  craft('moss_carpet', [['moss_block', 2]], 3, 'AA');
  // storage blocks (9 -> 1)
  [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'],
    ['coal_block', 'coal'], ['redstone_block', 'redstone'], ['netherite_block', 'netherite_ingot'], ['copper_block', 'copper_ingot'],
    ['raw_iron_block', 'raw_iron'], ['raw_gold_block', 'raw_gold'], ['raw_copper_block', 'raw_copper'],
  ].forEach(([o, i]) => craft(o, [[i, 9]], 1, P3));
  craft('iron_nugget', [['iron_ingot', 1]], 9, '*');
  craft('gold_nugget', [['gold_ingot', 1]], 9, '*');

  /* ======================================================================
   * Colours: concrete, terracotta, glass, wool, carpet
   * ====================================================================== */
  COLORS.forEach((c) => {
    const dye = c + '_dye';
    craft(c + '_concrete_powder', [['sand', 4], ['gravel', 4], [dye, 1]], 8, '*');
    convert(c + '_concrete', c + '_concrete_powder', 'Place the powder in water', 'item/water_bucket');
    craft(c + '_terracotta', [['terracotta', 8], [dye, 1]], 8, RING);
    smelt(c + '_glazed_terracotta', c + '_terracotta');
    craft(c + '_stained_glass', [['glass', 8], [dye, 1]], 8, RING);
    craft(c + '_stained_glass_pane', [[c + '_stained_glass', 6]], 16, 'AAA/AAA');
    craft(c + '_stained_glass_pane', [['glass_pane', 8], [dye, 1]], 8, RING);
    if (c !== 'white') craft(c + '_wool', [['white_wool', 1], [dye, 1]], 1, '*');
    craft(c + '_carpet', [[c + '_wool', 2]], 3, 'AA');
    BASE_OF[c + '_carpet'] = c + '_wool';
    BASE_OF[c + '_stained_glass_pane'] = c + '_stained_glass';
  });
  craft('white_wool', [['string', 4]], 1, P2);
  craft('glass_pane', [['glass', 6]], 16, 'AAA/AAA');
  BASE_OF.glass_pane = 'glass';

  /* ======================================================================
   * Wood: planks, wood, stripped, stairs, slabs, fences, gates, doors, trapdoors, signs
   * ====================================================================== */
  const WOODS = [
    // [wood, log, wood block]
    ['oak', 'oak_log', 'oak_wood'], ['spruce', 'spruce_log', 'spruce_wood'], ['birch', 'birch_log', 'birch_wood'], ['jungle', 'jungle_log', 'jungle_wood'],
    ['acacia', 'acacia_log', 'acacia_wood'], ['dark_oak', 'dark_oak_log', 'dark_oak_wood'], ['mangrove', 'mangrove_log', 'mangrove_wood'],
    ['cherry', 'cherry_log', 'cherry_wood'], ['pale_oak', 'pale_oak_log', 'pale_oak_wood'], ['crimson', 'crimson_stem', 'crimson_hyphae'], ['warped', 'warped_stem', 'warped_hyphae'],
    ['bamboo', 'bamboo_block', null],
  ];
  const AXE = 'item/iron_axe';
  WOODS.forEach(([w, log, wood]) => {
    const planks = w + '_planks', slog = 'stripped_' + log, swood = wood ? 'stripped_' + wood : null, k = w === 'bamboo' ? 2 : 4;
    [log, slog, wood, swood].filter(Boolean).forEach((src) => craft(planks, [[src, 1]], k, '*'));
    convert(slog, log, 'Use an axe on it', AXE);
    if (wood) { craft(wood, [[log, 4]], 3, P2); craft(swood, [[slog, 4]], 3, P2); convert(swood, wood, 'Use an axe on it', AXE); BASE_OF[swood] = slog; }
    BASE_OF[slog] = log;
    craft(w + '_stairs', [[planks, 6]], 4, STAIRS);
    craft(w + '_slab', [[planks, 3]], 6, 'AAA');
    craft(w + '_fence', [[planks, 4], ['stick', 2]], 3, 'ABA/ABA');
    craft(w + '_fence_gate', [['stick', 4], [planks, 2]], 1, 'ABA/ABA');
    craft(w + '_door', [[planks, 6]], 3, 'AA/AA/AA');
    craft(w + '_trapdoor', [[planks, 6]], 2, 'AAA/AAA');
    craft(w + '_button', [[planks, 1]], 1, 'A');
    craft(w + '_pressure_plate', [[planks, 2]], 1, 'AA');
    craft(w + '_sign', [[planks, 6], ['stick', 1]], 3, 'AAA/AAA/.B.');
    craft(w + '_hanging_sign', [[slog, 6], ['iron_chain', 2]], 6, 'B.B/AAA/AAA');
    ['stairs', 'slab', 'fence', 'fence_gate', 'door', 'trapdoor', 'button', 'pressure_plate', 'sign', 'hanging_sign'].forEach((s) => { BASE_OF[w + '_' + s] = planks; });
  });
  craft('bamboo_block', [['bamboo', 9]], 1, P3);
  convert('stripped_bamboo_block', 'bamboo_block', 'Use an axe on it', AXE);
  craft('bamboo_mosaic', [['bamboo_slab', 2]], 1, 'A/A');
  craft('bamboo_mosaic_stairs', [['bamboo_mosaic', 6]], 4, STAIRS);
  craft('bamboo_mosaic_slab', [['bamboo_mosaic', 3]], 6, 'AAA');
  BASE_OF.bamboo_mosaic_stairs = BASE_OF.bamboo_mosaic_slab = 'bamboo_mosaic';
  // "any planks": sticks, chests and friends take planks of any wood
  craft('stick', [['tag:planks', 2]], 4, 'A/A');
  craft('tag:planks', [['tag:logs', 1]], 4, '*');
  craft('crafting_table', [['tag:planks', 4]], 1, P2);
  craft('chest', [['tag:planks', 8]], 1, 'AAA/A.A/AAA');
  craft('barrel', [['tag:planks', 6], ['tag:wooden_slabs', 2]], 1, 'ABA/A.A/ABA');
  craft('tag:wooden_slabs', [['tag:planks', 3]], 6, 'AAA');
  craft('composter', [['tag:wooden_slabs', 7]], 1, 'A.A/A.A/AAA');
  craft('bookshelf', [['tag:planks', 6], ['book', 3]], 1, 'AAA/BBB/AAA');
  craft('chiseled_bookshelf', [['tag:planks', 6], ['tag:wooden_slabs', 3]], 1, 'AAA/BBB/AAA');
  craft('book', [['paper', 3], ['leather', 1]], 1, '*');
  craft('paper', [['sugar_cane', 3]], 3, 'AAA');
  craft('ladder', [['stick', 7]], 3, 'A.A/AAA/A.A');
  craft('scaffolding', [['bamboo', 6], ['string', 1]], 6, 'ABA/A.A/A.A');
  craft('note_block', [['tag:planks', 8], ['redstone', 1]], 1, RING);

  /* ======================================================================
   * Light, metal, redstone, misc
   * ====================================================================== */
  craft('torch', [['coal', 1], ['stick', 1]], 4, 'A/B');
  craft('soul_torch', [['coal', 1], ['stick', 1], ['soul_soil', 1]], 4, 'A/B/C');
  craft('lantern', [['iron_nugget', 8], ['torch', 1]], 1, RING);
  craft('soul_lantern', [['iron_nugget', 8], ['soul_torch', 1]], 1, RING);
  craft('iron_chain', [['iron_ingot', 1], ['iron_nugget', 2]], 1, 'B/A/B');   // 'chain' before 1.21.9
  craft('iron_bars', [['iron_ingot', 6]], 16, 'AAA/AAA');
  craft('iron_door', [['iron_ingot', 6]], 3, 'AA/AA/AA');
  craft('iron_trapdoor', [['iron_ingot', 4]], 1, P2);
  craft('bucket', [['iron_ingot', 3]], 1, 'A.A/.A.');
  craft('redstone_lamp', [['redstone', 4], ['glowstone', 1]], 1, '.A./ABA/.A.');
  craft('jack_o_lantern', [['carved_pumpkin', 1], ['torch', 1]], 1, 'A/B');
  convert('carved_pumpkin', 'pumpkin', 'Use shears on it', 'item/shears');
  // Java 1.21.5 changed the centre of the lodestone from a netherite ingot to an iron ingot
  craft('lodestone', [['chiseled_stone_bricks', 8], ['iron_ingot', 1]], 1, RING);
  craft('target', [['redstone', 4], ['hay_block', 1]], 1, '.A./ABA/.A.');
  craft('end_rod', [['blaze_rod', 1], ['popped_chorus_fruit', 1]], 4, 'A/B');
  craft('furnace', [['cobblestone', 8]], 1, 'AAA/A.A/AAA');
  craft('smoker', [['tag:logs', 4], ['furnace', 1]], 1, '.A./ABA/.A.');
  craft('blast_furnace', [['iron_ingot', 5], ['furnace', 1], ['smooth_stone', 3]], 1, 'AAA/ABA/CCC');
  craft('hopper', [['iron_ingot', 5], ['chest', 1]], 1, 'A.A/ABA/.A.');
  craft('redstone_torch', [['redstone', 1], ['stick', 1]], 1, 'A/B');
  craft('repeater', [['stone', 3], ['redstone_torch', 2], ['redstone', 1]], 1, 'BCB/AAA');
  craft('comparator', [['stone', 3], ['redstone_torch', 3], ['quartz', 1]], 1, '.B./BCB/AAA');
  craft('observer', [['cobblestone', 6], ['redstone', 2], ['quartz', 1]], 1, 'AAA/BBC/AAA');
  craft('piston', [['tag:planks', 3], ['cobblestone', 4], ['iron_ingot', 1], ['redstone', 1]], 1, 'AAA/BCB/BDB');
  craft('sticky_piston', [['piston', 1], ['slime_ball', 1]], 1, 'B/A');
  craft('dropper', [['cobblestone', 7], ['redstone', 1]], 1, 'AAA/A.A/ABA');
  craft('dispenser', [['cobblestone', 7], ['redstone', 1], ['bow', 1]], 1, 'AAA/ACA/ABA');
  craft('bow', [['stick', 3], ['string', 3]], 1, '.AB/A.B/.AB');
  craft('rail', [['iron_ingot', 6], ['stick', 1]], 16, 'A.A/ABA/A.A');
  craft('powered_rail', [['gold_ingot', 6], ['stick', 1], ['redstone', 1]], 6, 'A.A/ABA/ACA');
  craft('detector_rail', [['iron_ingot', 6], ['stone_pressure_plate', 1], ['redstone', 1]], 6, 'A.A/ABA/ACA');
  craft('activator_rail', [['iron_ingot', 6], ['stick', 2], ['redstone_torch', 1]], 6, 'ABA/ACA/ABA');
  craft('lever', [['stick', 1], ['cobblestone', 1]], 1, 'A/B');
  craft('stone_button', [['stone', 1]], 1, 'A');
  craft('stone_pressure_plate', [['stone', 2]], 1, 'AA');
  craft('tripwire_hook', [['iron_ingot', 1], ['stick', 1], ['tag:planks', 1]], 2, 'A/B/C');
  craft('trapped_chest', [['chest', 1], ['tripwire_hook', 1]], 1, '*');
  craft('daylight_detector', [['glass', 3], ['quartz', 3], ['tag:wooden_slabs', 3]], 1, 'AAA/BBB/CCC');
  craft('tnt', [['gunpowder', 5], ['sand', 4]], 1, 'ABA/BAB/ABA');
  craft('minecart', [['iron_ingot', 5]], 1, 'A.A/AAA');
  craft('hopper_minecart', [['hopper', 1], ['minecart', 1]], 1, 'A/B');
  craft('armor_stand', [['stick', 6], ['smooth_stone_slab', 1]], 1, 'AAA/.A./ABA');
  craft('anvil', [['iron_block', 3], ['iron_ingot', 4]], 1, 'AAA/.B./BBB');
  craft('cauldron', [['iron_ingot', 7]], 1, 'A.A/A.A/AAA');
  craft('flower_pot', [['brick', 3]], 1, 'A.A/.A.');
  craft('item_frame', [['stick', 8], ['leather', 1]], 1, RING);
  craft('crafter', [['iron_ingot', 5], ['crafting_table', 1], ['redstone', 2], ['dropper', 1]], 1, 'AAA/ABA/CDC');

  /* ======================================================================
   * Names, icons, groups
   * ====================================================================== */
  // Mojang names that are not just the id in title case (also used to read pasted lists)
  const NAMES = {
    quartz: 'Nether Quartz', redstone: 'Redstone Dust', slime_ball: 'Slimeball', jack_o_lantern: "Jack o'Lantern", tnt: 'TNT',
    repeater: 'Redstone Repeater', comparator: 'Redstone Comparator', hay_block: 'Hay Bale', smooth_quartz: 'Smooth Quartz Block',
    quartz_block: 'Block of Quartz', iron_block: 'Block of Iron', gold_block: 'Block of Gold', diamond_block: 'Block of Diamond',
    emerald_block: 'Block of Emerald', lapis_block: 'Block of Lapis Lazuli', coal_block: 'Block of Coal', redstone_block: 'Block of Redstone',
    netherite_block: 'Block of Netherite', copper_block: 'Block of Copper', amethyst_block: 'Block of Amethyst',
    raw_iron_block: 'Block of Raw Iron', raw_gold_block: 'Block of Raw Gold', raw_copper_block: 'Block of Raw Copper',
    bamboo_block: 'Block of Bamboo', stripped_bamboo_block: 'Block of Stripped Bamboo', redstone_wire: 'Redstone Dust',
    'tag:planks': 'Any Planks', 'tag:logs': 'Any Logs', 'tag:wooden_slabs': 'Any Wooden Slabs', nether_brick: 'Nether Brick',
    water_bucket: 'Water Bucket', lava_bucket: 'Lava Bucket', short_grass: 'Short Grass',
  };
  // textures for items that are not blocks of the builds table (literal keys, bundled for the offline artifact)
  const ICON = {
    prismarine_shard: 'item/prismarine_shard', prismarine_crystals: 'item/prismarine_crystals', stick: 'item/stick', string: 'item/string',
    brick: 'item/brick', nether_brick: 'item/nether_brick', clay_ball: 'item/clay_ball', quartz: 'item/quartz', iron_ingot: 'item/iron_ingot',
    gold_ingot: 'item/gold_ingot', copper_ingot: 'item/copper_ingot', netherite_ingot: 'item/netherite_ingot', diamond: 'item/diamond',
    emerald: 'item/emerald', lapis_lazuli: 'item/lapis_lazuli', coal: 'item/coal', redstone: 'item/redstone', glowstone_dust: 'item/glowstone_dust',
    bone_meal: 'item/bone_meal', bone: 'item/bone', wheat: 'item/wheat', sugar_cane: 'item/sugar_cane', paper: 'item/paper', book: 'item/book',
    leather: 'item/leather', slime_ball: 'item/slime_ball', honey_bottle: 'item/honey_bottle', snowball: 'item/snowball', kelp: 'item/kelp',
    dried_kelp: 'item/dried_kelp', melon_slice: 'item/melon_slice', amethyst_shard: 'item/amethyst_shard', pointed_dripstone: 'item/pointed_dripstone',
    popped_chorus_fruit: 'item/popped_chorus_fruit', chorus_fruit: 'item/chorus_fruit', iron_nugget: 'item/iron_nugget', gold_nugget: 'item/gold_nugget',
    gunpowder: 'item/gunpowder', nether_wart: 'item/nether_wart', bamboo: 'item/bamboo', blaze_rod: 'item/blaze_rod', iron_chain: 'item/iron_chain',
    lantern: 'item/lantern', soul_lantern: 'item/soul_lantern', bucket: 'item/bucket', water_bucket: 'item/water_bucket', lava_bucket: 'item/lava_bucket',
    raw_iron: 'item/raw_iron', raw_gold: 'item/raw_gold', raw_copper: 'item/raw_copper', bow: 'item/bow', minecart: 'item/minecart',
    hopper: 'item/hopper', repeater: 'item/repeater', comparator: 'item/comparator', torch: 'block/torch', soul_torch: 'block/soul_torch',
    redstone_torch: 'block/redstone_torch', vine: 'block/vine', moss_block: 'block/moss_block', gravel: 'block/gravel', sand: 'block/sand',
    red_sand: 'block/red_sand', netherrack: 'block/netherrack', terracotta: 'block/terracotta', soul_soil: 'block/soul_soil', mud: 'block/mud',
    packed_mud: 'block/packed_mud', carved_pumpkin: 'block/carved_pumpkin', ice: 'block/ice', cobblestone: 'block/cobblestone', tuff: 'block/tuff',
    stone: 'block/stone', end_stone: 'block/end_stone', basalt: 'block/basalt_side', blackstone: 'block/blackstone', cobbled_deepslate: 'block/cobbled_deepslate',
    clay: 'block/clay', glass: 'block/glass', glass_pane: 'block/glass', lodestone: 'block/lodestone_side', target: 'block/target_side',
    iron_bars: 'block/iron_bars', ladder: 'block/ladder', scaffolding: 'block/scaffolding_side', end_rod: 'block/end_rod', dripstone_block: 'block/dripstone_block',
    'tag:planks': 'block/oak_planks', 'tag:logs': 'block/oak_log', 'tag:wooden_slabs': 'block/oak_planks', armor_stand: 'item/armor_stand',
    item_frame: 'item/item_frame', flower_pot: 'item/flower_pot', cauldron: 'item/cauldron', iron_door: 'item/iron_door', crafter: 'block/crafter_north',
    white_dye: 'item/white_dye', orange_dye: 'item/orange_dye', magenta_dye: 'item/magenta_dye', light_blue_dye: 'item/light_blue_dye',
    yellow_dye: 'item/yellow_dye', lime_dye: 'item/lime_dye', pink_dye: 'item/pink_dye', gray_dye: 'item/gray_dye', light_gray_dye: 'item/light_gray_dye',
    cyan_dye: 'item/cyan_dye', purple_dye: 'item/purple_dye', blue_dye: 'item/blue_dye', brown_dye: 'item/brown_dye', green_dye: 'item/green_dye',
    red_dye: 'item/red_dye', black_dye: 'item/black_dye', pumpkin: 'block/pumpkin_side', crafting_table: 'block/crafting_table_front',
    furnace: 'block/furnace_front',
  };
  // the station of every method (the texture shown in the recipe pictures)
  const STATION = { crafting: 'block/crafting_table_front', stonecutting: 'block/stonecutter_side', smelting: 'block/furnace_front' };
  // a name hint -> group (the builds table groups: stone, deep, sand, nether, end, wood, colour, mineral, ore, natural, glass, leaves, light, redstone, farm, misc)
  const GROUP_RULES = [
    [/^tag:|planks|_log$|_wood$|_stem$|hyphae|bamboo|bookshelf|^stick$|crafting_table|^chest$|barrel|ladder|scaffolding|composter|_sign$|_door$|_trapdoor$|_fence_gate$|^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|crimson|warped)_/, 'wood'],
    [/_dye$|concrete|terracotta|wool|carpet|^string$/, 'colour'],
    [/glass/, 'glass'],
    [/leaves/, 'leaves'],
    [/deepslate/, 'deep'],
    [/sandstone/, 'sand'],
    [/nether|blackstone|quartz|basalt|crimson|warped|soul_|magma|obsidian|glowstone|shroomlight|wart/, 'nether'],
    [/end_stone|purpur|prismarine|sea_lantern|coral|chorus|end_rod|sponge|kelp/, 'end'],
    [/redstone|piston|observer|hopper|repeater|comparator|rail|lever|button|pressure_plate|^target$|tnt|dispenser|dropper|daylight|note_block|slime|honey_block|tripwire|crafter|minecart/, 'redstone'],
    [/_ore$|ancient_debris/, 'ore'],
    [/copper|iron|gold|diamond|emerald|lapis|netherite|amethyst|coal|chain|lodestone|anvil|cauldron|bucket/, 'mineral'],
    [/lantern|torch|froglight|lamp|candle/, 'light'],
    [/stone|brick|tuff|granite|diorite|andesite|calcite|mud|dripstone|cobble|smooth|flower_pot/, 'stone'],
    [/dirt|grass|sand|gravel|clay|moss|snow|ice|pumpkin|melon|bone|podzol|mycelium|vine|leather|paper|book|gunpowder|blaze/, 'natural'],
    [/wheat|hay|sugar_cane|cactus|farmland|seeds|carrot|potato|beetroot/, 'farm'],
  ];
  function groupOf(id) {
    const n = bare(id);
    const C = TH.builds && TH.builds.core;
    if (C && C.BLOCKS[n] && C.BLOCKS[n].grp) return C.BLOCKS[n].grp;
    if (BASE_OF[n] && BASE_OF[n] !== n) return groupOf(BASE_OF[n]);
    for (const [re, g] of GROUP_RULES) if (re.test(n)) return g;
    return 'misc';
  }
  const titleCase = (s) => s.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  function nameOf(id) {
    const s = String(id || '');
    if (s.startsWith('text:')) return s.slice(5);
    const n = bare(s);
    if (NAMES[n]) return NAMES[n];
    const C = TH.builds && TH.builds.core;
    return C ? C.nameOf('minecraft:' + n) : titleCase(n);
  }

  /* ======================================================================
   * Choosing and expanding
   * ====================================================================== */
  const METHOD = { crafting: 'Crafting table', stonecutting: 'Stonecutter', smelting: 'Furnace', conversion: 'By hand' };
  const ORDER = { stonecutting: 0, crafting: 1, smelting: 2, conversion: 3 };
  function recipesFor(id) { return R[bare(id)] || []; }
  const knows = (id) => !!R[bare(id)];
  /** The recipes worth offering under opts: without the stonecutter preference a crafting recipe (if any) wins. */
  function usable(n, opts) {
    const list = R[n] || [];
    if (opts && opts.sc === false && list.some((r) => r.method !== 'stonecutting')) return list.filter((r) => r.method !== 'stonecutting');
    return list;
  }
  function memoFor(opts) {
    const sig = (opts && opts.sc === false ? 'c' : 's') + JSON.stringify((opts && opts.pick) || {});
    const all = memoFor.all || (memoFor.all = new Map());
    if (!all.has(sig)) { if (all.size > 12) all.clear(); all.set(sig, new Map()); }
    return all.get(sig);
  }
  /** [raw items per one output, processing steps] of the cheapest way to make n (Infinity on a loop). */
  function cost(n, opts, seen) {
    const memo = memoFor(opts);
    if (memo.has(n)) return memo.get(n);
    const list = usable(n, opts);
    if (!list.length) { const v = [1, 0, -1]; memo.set(n, v); return v; }
    seen = seen || new Set();
    if (seen.has(n)) return [Infinity, Infinity, -1];
    seen.add(n);
    let bestV = [Infinity, Infinity, -1];
    list.forEach((r, i) => {
      let c = 0, s = 1;
      r.in.forEach(([inp, k]) => { const v = cost(bare(inp), opts, seen); c += k * v[0]; s = Math.max(s, v[1] + 1); });
      c /= r.out;
      const better = c < bestV[0] - 1e-9 || (Math.abs(c - bestV[0]) < 1e-9 && (s < bestV[1] || (s === bestV[1] && ORDER[r.method] < ORDER[list[bestV[2]].method])));
      if (better) bestV = [c, s, i];
    });
    seen.delete(n);
    // a recipe the user picked (index into recipesFor) wins, when it is usable under opts
    const pick = opts && opts.pick && opts.pick[full(n)];
    const pr = pick != null ? R[n][pick] : null;
    if (pr && list.indexOf(pr) >= 0) {
      let c = 0, s = 1;
      pr.in.forEach(([inp, k]) => { const v = cost(bare(inp), opts, seen); c += k * v[0]; s = Math.max(s, v[1] + 1); });
      if (c !== Infinity) bestV = [c / pr.out, s, list.indexOf(pr)];
    }
    if (bestV[0] !== Infinity) memo.set(n, bestV);
    return bestV;
  }
  /** Index into recipesFor(id) of the chosen recipe, or -1 for a raw item. Without opts.pick: the cheapest. */
  function bestIndex(id, opts) {
    const n = bare(id), list = usable(n, opts);
    if (!list.length) return -1;
    const v = cost(n, opts);
    return v[2] < 0 ? -1 : (R[n] || []).indexOf(list[v[2]]);
  }
  /** The cheapest recipe ignoring the user's own pick (what the UI marks "best"). */
  function cheapest(id, opts) { return bestIndex(id, { sc: !(opts && opts.sc === false) }); }
  function best(id, opts) { const i = bestIndex(id, opts); return i < 0 ? null : R[bare(id)][i]; }

  /**
   * Expand rows [{ item, n }] to raw materials. Demand is gathered per item first and every step rounds up to whole
   * batches once (10 stairs = 3 crafts of 4 = 18 blocks), so the raw totals are exactly what you need to gather.
   * Text rows ('text:...') stay as they are.
   */
  function raw(rows, opts) {
    const need = new Map();
    const addNeed = (k, v) => need.set(k, (need.get(k) || 0) + v);
    rows.forEach((r) => { if (r.n > 0) addNeed(String(r.item).startsWith('text:') ? r.item : bare(r.item), r.n); });
    // consumers before producers: reverse post-order of a DFS over the chosen recipes
    const order = [], state = new Map();
    const visit = (n) => {
      if (state.get(n)) return;
      state.set(n, 1);
      const r = n.startsWith('text:') ? null : best(n, opts);
      if (r) r.in.forEach(([i]) => visit(bare(i)));
      order.push(n);
    };
    [...need.keys()].forEach(visit);
    order.reverse();
    const steps = [], out = [];
    order.forEach((n) => {
      const d = need.get(n) || 0;
      if (!d) return;
      const r = n.startsWith('text:') ? null : best(n, opts);
      if (!r) { out.push({ item: n.startsWith('text:') ? n : full(n), n: d }); return; }
      const crafts = Math.ceil(d / r.out);
      steps.push({ item: full(n), method: r.method, crafts, made: crafts * r.out, need: d, recipe: r });
      r.in.forEach(([i, k]) => addNeed(bare(i), crafts * k));
    });
    out.sort((a, b) => b.n - a.n || String(a.item).localeCompare(String(b.item)));
    return { rows: out, steps: steps.reverse() };   // steps in the order you do them: raw side first
  }

  function describe(r, id) {
    if (!r) return nameOf(id) + ': mined, farmed or found';
    const ins = r.in.map(([i, k]) => k + '× ' + nameOf(i)).join(' + ');
    return ins + ' → ' + r.out + '× ' + nameOf(id) + ' (' + METHOD[r.method].toLowerCase() + ')' + (r.note ? ' · ' + r.note : '');
  }
  function iconKey(id) { return ICON[bare(id)] || null; }
  /** The texture of the block or tool that does this recipe (crafting table, stonecutter, furnace, water bucket, axe...). */
  function stationOf(r) { return r ? r.tool || STATION[r.method] || null : null; }
  const baseOf = (id) => { const b = BASE_OF[bare(id)]; return b ? full(b) : null; };
  /** Every item id the engine knows by name (outputs and inputs), for reading pasted lists. */
  function allIds() {
    const s = new Set(Object.keys(R));
    Object.values(R).forEach((list) => list.forEach((r) => r.in.forEach(([i]) => s.add(bare(i)))));
    return [...s].filter((n) => !n.startsWith('tag:')).map(full);
  }

  return { recipesFor, best, bestIndex, cheapest, raw, describe, nameOf, iconKey, stationOf, baseOf, groupOf, knows, allIds, METHOD, STATION, NAMES, COLORS, bare };
})();
