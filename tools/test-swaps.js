// Tests for block swaps, whole-set swaps and the schematic exporters (js/modules/builds-core.js, builds-io.js).
//   node tools/test-swaps.js
// Both files are loaded in a VM with the game's block database (js/data/block-db.js); no DOM is needed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, DataView, Map, Set, Math, JSON, Object, Array, String, Number, Promise, Error };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('window.TH = { data: {}, langData: {}, icon: () => null };', ctx);
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const C = ctx.TH.builds.core, IO = ctx.TH.builds.io;

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const props = (id) => JSON.parse(JSON.stringify(C.parse(id).props));
/** A 4 x 3 x 1 build from a list of states (null = air). */
function build(states) {
  return C.fromFunction([states.length, 1, 1], (x) => states[x] || null, 'Test');
}
const ids = (s) => Array.from(s.palette.slice(1)).sort();

/* ---- coverage: what swaps with what ---- */
t('wooden trapdoors, gates, doors, buttons, plates, signs, fences are swappable within their class', () => {
  const pairs = [
    ['oak_trapdoor', 'cherry_trapdoor'], ['oak_fence_gate', 'warped_fence_gate'], ['oak_door', 'bamboo_door'], ['oak_button', 'poplar_button'],
    ['oak_pressure_plate', 'crimson_pressure_plate'], ['oak_sign', 'spruce_sign'], ['oak_wall_sign', 'spruce_wall_sign'], ['oak_hanging_sign', 'pale_oak_hanging_sign'],
    ['oak_wall_hanging_sign', 'mangrove_wall_hanging_sign'], ['oak_fence', 'bamboo_fence'], ['oak_log', 'poplar_log'], ['stripped_oak_wood', 'stripped_crimson_hyphae'],
    ['copper_trapdoor', 'waxed_oxidized_copper_trapdoor'], ['copper_door', 'weathered_copper_door'], ['red_bed', 'blue_bed'], ['red_banner', 'white_banner'],
    ['red_candle', 'candle'], ['shulker_box', 'lime_shulker_box'], ['glass_pane', 'red_stained_glass_pane'], ['iron_bars', 'copper_bars'],
    ['stone_button', 'polished_blackstone_button'], ['red_glazed_terracotta', 'blue_glazed_terracotta'], ['lantern', 'copper_lantern'],
  ];
  pairs.forEach(([a, b]) => assert.ok(C.canSwap('minecraft:' + a, 'minecraft:' + b), a + ' -> ' + b));
});
t('swaps never cross a behaviour class', () => {
  const bad = [
    ['oak_trapdoor', 'iron_trapdoor'], ['oak_door', 'iron_door'], ['iron_door', 'oak_door'], ['oak_door', 'copper_door'], ['oak_button', 'stone_button'],
    ['oak_pressure_plate', 'stone_pressure_plate'], ['stone_pressure_plate', 'light_weighted_pressure_plate'], ['oak_sign', 'oak_wall_sign'], ['oak_fence_gate', 'oak_fence'],
    ['oak_trapdoor', 'oak_slab'], ['observer', 'stone'], ['stone', 'observer'], ['hopper', 'chest'], ['copper_bulb', 'stone'], ['oak_fence', 'oak_wall'],
    ['oak_slab', 'oak_stairs'], ['glass_pane', 'glass'], ['white_carpet', 'snow'], ['white_carpet', 'vine'], ['torch', 'redstone_torch'], ['lantern', 'end_rod'],
  ];
  bad.forEach(([a, b]) => assert.ok(!C.canSwap('minecraft:' + a, 'minecraft:' + b), a + ' -/-> ' + b));
  assert.ok(!C.replaceable('minecraft:iron_door').ok);
  assert.match(C.replaceable('minecraft:iron_door').why, /redstone/);
  assert.ok(!C.replaceable('minecraft:iron_trapdoor').ok);
  assert.ok(!C.replaceable('minecraft:observer').ok);
  assert.ok(!C.canSwap('minecraft:copper_bulb', 'minecraft:redstone_lamp') && !C.canSwap('minecraft:copper_bulb', 'minecraft:stone'), 'bulbs only swap among bulbs');
});
t('the picker family lists database blocks (poplar) and nothing functional', () => {
  const fam = C.familyOf(C.def('minecraft:oak_trapdoor').fam);
  assert.ok(fam.includes('poplar_trapdoor') && fam.includes('cherry_trapdoor') && fam.includes('bamboo_trapdoor') && fam.includes('waxed_oxidized_copper_trapdoor'));
  assert.ok(!fam.includes('iron_trapdoor'));
  assert.strictEqual(fam[0], 'oak_trapdoor');
  assert.ok(C.familyOf('cube').includes('poplar_planks'));
});

/* ---- states are kept ---- */
t('oak trapdoor -> cherry keeps facing, half, open, waterlogged, powered', () => {
  const st = 'minecraft:oak_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]';
  const s = C.applySwaps(build([st]), { 'minecraft:oak_trapdoor': 'minecraft:cherry_trapdoor' });
  assert.deepStrictEqual(ids(s), ['minecraft:cherry_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]']);
});
t('fence gates keep in_wall and open; doors keep both halves, hinge and open', () => {
  const s = C.applySwaps(build([
    'minecraft:oak_fence_gate[facing=east,in_wall=true,open=true,powered=false]',
    'minecraft:oak_door[facing=south,half=lower,hinge=right,open=true,powered=false]',
    'minecraft:oak_door[facing=south,half=upper,hinge=right,open=true,powered=false]',
  ]), { 'minecraft:oak_fence_gate': 'minecraft:dark_oak_fence_gate', 'minecraft:oak_door': 'minecraft:mangrove_door' });
  assert.deepStrictEqual(ids(s), [
    'minecraft:dark_oak_fence_gate[facing=east,in_wall=true,open=true,powered=false]',
    'minecraft:mangrove_door[facing=south,half=lower,hinge=right,open=true,powered=false]',
    'minecraft:mangrove_door[facing=south,half=upper,hinge=right,open=true,powered=false]',
  ].sort());
});
t('refused swaps leave the block as it is (iron door, observer, cross-class)', () => {
  const s0 = build(['minecraft:iron_door[facing=north,half=lower,hinge=left,open=false,powered=false]', 'minecraft:observer[facing=up,powered=false]', 'minecraft:oak_trapdoor[facing=west,half=bottom,open=false,powered=false,waterlogged=false]']);
  const s = C.applySwaps(s0, { 'minecraft:iron_door': 'minecraft:oak_door', 'minecraft:observer': 'minecraft:stone', 'minecraft:oak_trapdoor': 'minecraft:iron_trapdoor' });
  assert.deepStrictEqual(ids(s), ids(s0));
});
t('a mixed cube swap drops properties the new block does not have', () => {
  const s = C.applySwaps(build(['minecraft:deepslate[axis=x]', 'minecraft:stone']), { 'minecraft:deepslate': 'minecraft:stone_bricks', 'minecraft:stone': 'minecraft:basalt' });
  assert.deepStrictEqual(ids(s), ['minecraft:basalt', 'minecraft:stone_bricks']);
  const s2 = C.applySwaps(build(['minecraft:basalt[axis=z]']), { 'minecraft:basalt': 'minecraft:polished_basalt' });
  assert.deepStrictEqual(ids(s2), ['minecraft:polished_basalt[axis=z]']);
});

/* ---- the solid class: every full block stands in for every other, states made valid ---- */
const M = (n) => 'minecraft:' + n;
const sw1 = (state, to) => ids(C.applySwaps(build([state]), { [C.parse(state).base]: M(to) }));
const chips = (a, b) => JSON.parse(JSON.stringify(C.swapWarnings(M(a), M(b)).map((x) => x.text)));
t('glazed terracotta <-> stone, wool, planks, concrete, copper block (both ways), facing dropped or defaulted', () => {
  ['stone', 'white_wool', 'oak_planks', 'red_concrete', 'copper_block', 'waxed_oxidized_cut_copper', 'deepslate_tiles', 'purpur_block', 'tube_coral_block', 'mud_bricks'].forEach((b) => {
    assert.ok(C.canSwap(M('white_glazed_terracotta'), M(b)), 'glazed -> ' + b);
    assert.ok(C.canSwap(M(b), M('white_glazed_terracotta')), b + ' -> glazed');
  });
  assert.deepStrictEqual(sw1('minecraft:white_glazed_terracotta[facing=east]', 'stone'), ['minecraft:stone']);
  assert.deepStrictEqual(sw1('minecraft:stone', 'white_glazed_terracotta'), ['minecraft:white_glazed_terracotta'], 'no facing: the game default (north)');
  assert.deepStrictEqual(sw1('minecraft:white_glazed_terracotta[facing=east]', 'carved_pumpkin'), ['minecraft:carved_pumpkin[facing=east]'], 'facing kept where both have it');
  assert.deepStrictEqual(sw1('minecraft:jack_o_lantern[facing=west]', 'red_glazed_terracotta'), ['minecraft:red_glazed_terracotta[facing=west]']);
  assert.deepStrictEqual(chips('white_glazed_terracotta', 'stone'), []);
  assert.deepStrictEqual(chips('white_glazed_terracotta', 'jack_o_lantern'), ['Gives off light']);
  assert.ok(C.familyOf(C.def(M('white_glazed_terracotta')).fam).length > 300, 'the picker offers every solid block');
  assert.strictEqual(C.familyOf('glazed'), C.familyOf('cube'), 'one class, one list');
});
t('logs and pillars <-> solid blocks: axis dropped, defaulted or kept', () => {
  assert.deepStrictEqual(sw1('minecraft:oak_log[axis=x]', 'stone'), ['minecraft:stone']);
  assert.deepStrictEqual(sw1('minecraft:stone', 'oak_log'), ['minecraft:oak_log'], 'axis=y is the default');
  assert.deepStrictEqual(sw1('minecraft:oak_log[axis=z]', 'basalt'), ['minecraft:basalt[axis=z]']);
  assert.deepStrictEqual(sw1('minecraft:quartz_pillar[axis=x]', 'stripped_cherry_wood'), ['minecraft:stripped_cherry_wood[axis=x]']);
  assert.deepStrictEqual(sw1('minecraft:hay_block[axis=x]', 'ochre_froglight'), ['minecraft:ochre_froglight[axis=x]']);
  assert.deepStrictEqual(chips('stone', 'oak_log'), ['Burns']);
  assert.deepStrictEqual(chips('hay_block', 'stone'), ['Full fall damage']);
});
t('leaves, mushroom blocks, grates, redstone ore: their own states stay valid', () => {
  assert.deepStrictEqual(sw1('minecraft:stone', 'oak_leaves'), ['minecraft:oak_leaves[persistent=true]'], 'leaves from a block never decay');
  assert.deepStrictEqual(sw1('minecraft:oak_leaves[distance=3,persistent=false,waterlogged=false]', 'cherry_leaves'), ['minecraft:cherry_leaves[distance=3,persistent=false,waterlogged=false]'], 'a tree stays a tree');
  assert.deepStrictEqual(sw1('minecraft:oak_leaves[distance=3,persistent=false,waterlogged=true]', 'moss_block'), ['minecraft:moss_block']);
  assert.deepStrictEqual(sw1('minecraft:red_mushroom_block[down=false,east=true,north=true,south=false,up=true,west=true]', 'mushroom_stem'), ['minecraft:mushroom_stem[down=false,east=true,north=true,south=false,up=true,west=true]']);
  assert.deepStrictEqual(sw1('minecraft:red_mushroom_block[down=false,east=true,north=true,south=false,up=true,west=true]', 'stone'), ['minecraft:stone']);
  assert.deepStrictEqual(sw1('minecraft:copper_grate[waterlogged=true]', 'exposed_copper_grate'), ['minecraft:exposed_copper_grate[waterlogged=true]']);
  assert.deepStrictEqual(sw1('minecraft:copper_grate[waterlogged=true]', 'glass'), ['minecraft:glass']);
  assert.deepStrictEqual(sw1('minecraft:redstone_ore[lit=false]', 'deepslate_redstone_ore'), ['minecraft:deepslate_redstone_ore[lit=false]']);
  assert.deepStrictEqual(sw1('minecraft:grass_block[snowy=true]', 'podzol'), ['minecraft:podzol[snowy=true]']);
  assert.deepStrictEqual(sw1('minecraft:grass_block[snowy=true]', 'dirt'), ['minecraft:dirt']);
  assert.deepStrictEqual(chips('stone', 'oak_leaves'), ['Lets light through', 'Burns']);
});
t('warning chips: each relaxed rule says what changes (and nothing when it behaves the same)', () => {
  const want = [
    ['stone', 'sand', ['Falls without support']], ['sand', 'stone', []], ['red_concrete', 'red_concrete_powder', ['Falls without support']], ['gravel', 'red_sand', []],
    ['stone', 'glowstone', ['Gives off light']], ['glowstone', 'stone', ['Gives no light']], ['glowstone', 'sea_lantern', []], ['glowstone', 'crying_obsidian', ['Dimmer light']],
    ['stone', 'glass', ['Lets light through']], ['glass', 'stone', ['Blocks light']], ['glass', 'red_stained_glass', []], ['glass', 'tinted_glass', ['Blocks light']],
    ['glass', 'oak_leaves', ['Burns']], ['sea_lantern', 'glass', ['Gives no light', 'Lets light through']],
    ['stone', 'soul_sand', ['Makes bubble columns', 'Slower to walk on', 'Lower than a full block']], ['soul_sand', 'magma_block', ['Gives off light', 'Bubbles go the other way', 'No longer slows mobs', 'Hurts to stand on', 'Full height']],
    ['magma_block', 'stone', ['Gives no light', 'No bubble column', 'No longer hurts']], ['stone', 'mud', ['Lower than a full block']], ['mud', 'packed_mud', ['Full height']],
    ['stone', 'ice', ['Lets light through', 'Slippery', 'Melts near light']], ['packed_ice', 'blue_ice', []], ['blue_ice', 'stone', ['Not slippery']],
    ['stone', 'oak_planks', ['Burns']], ['oak_planks', 'crimson_planks', []], ['stone', 'white_wool', ['Burns']],
    ['stone', 'copper_block', ['Turns green over time']], ['stone', 'waxed_copper_block', []], ['stone', 'oxidized_copper', []],
    ['obsidian', 'stone', ['No portal frame', 'Explosions break it']], ['obsidian', 'crying_obsidian', ['Gives off light', 'No portal frame']], ['iron_block', 'stone', ['No beacon base']], ['iron_block', 'gold_block', []],
    ['stone', 'tube_coral_block', ['Dies out of water']], ['stone', 'dead_tube_coral_block', []], ['stone', 'sponge', ['Soaks up water']], ['stone', 'grass_block', ['Fades when covered']],
    ['oak_fence', 'nether_brick_fence', ['Does not join wooden fences']], ['nether_brick_fence', 'oak_fence', ['Does not join nether brick fences', 'Burns']],
    ['oak_fence', 'warped_fence', []], ['lantern', 'soul_lantern', ['Dimmer light']], ['lantern', 'copper_lantern', ['Turns green over time']], ['torch', 'soul_torch', ['Dimmer light']],
    ['campfire', 'soul_campfire', ['Dimmer light']], ['copper_bulb', 'oxidized_copper_bulb', ['Dimmer light']], ['copper_bulb', 'waxed_copper_bulb', []],
    ['poppy', 'wither_rose', ['Withers what touches it']], ['small_amethyst_bud', 'amethyst_cluster', ['Brighter light']], ['oak_trapdoor', 'copper_trapdoor', ['Turns green over time']],
  ];
  want.forEach(([a, b, w]) => {
    assert.ok(C.canSwap(M(a), M(b)), a + ' -> ' + b + ' allowed');
    const got = chips(a, b);
    assert.deepStrictEqual(got, w, a + ' -> ' + b + ': ' + got.join(' / '));
  });
  assert.ok(C.swapWarnings(M('stone'), M('sand'))[0].tip.length > 10, 'each chip has a tooltip line');
});
t('locked blocks stay locked, with a reason; some may be swapped away but are never offered', () => {
  const locked = ['observer', 'piston', 'sticky_piston', 'redstone_block', 'redstone_lamp', 'tnt', 'target', 'slime_block', 'honey_block', 'spawner', 'bedrock', 'barrier',
    'command_block', 'note_block', 'hopper', 'chest', 'trapped_chest', 'barrel', 'iron_door', 'iron_trapdoor', 'frosted_ice', 'sculk_sensor', 'heavy_weighted_pressure_plate',
    'pale_moss_carpet', 'chiseled_bookshelf', 'beacon', 'respawn_anchor', 'lodestone', 'crafter', 'water', 'lava', 'farmland', 'snow', 'vine', 'ladder', 'powder_snow', 'smithing_table',
    'end_portal_frame', 'decorated_pot', 'jukebox', 'beehive', 'cobweb', 'wheat', 'redstone_torch', 'repeater', 'lever', 'rail', 'daylight_detector', 'dispenser', 'furnace'];
  locked.forEach((n) => {
    const r = C.replaceable(M(n));
    assert.ok(!r.ok && r.why.length > 10, n + ' stays: ' + r.why);
    assert.ok(!C.canSwap(M('stone'), M(n)) && !C.canSwap(M(n), M('stone')), n + ' never swaps');
  });
  assert.match(C.replaceable(M('bedrock')).why, /cannot be broken/);
  assert.match(C.replaceable(M('smithing_table')).why, /workstation/i);
  ['infested_stone', 'reinforced_deepslate', 'budding_amethyst', 'suspicious_sand'].forEach((n) => {
    assert.ok(C.replaceable(M(n)).ok, n + ' may be swapped away');
    assert.ok(!C.canSwap(M('stone'), M(n)), n + ' is never offered');
    assert.ok(!C.familyOf(C.def(M(n)).fam).includes(n), n + ' not in the picker');
  });
  assert.ok(C.canSwap(M('infested_stone'), M('stone')) && C.canSwap(M('suspicious_sand'), M('sand')));
  assert.ok(C.canSwap(M('infested_stone'), M('infested_stone')), 'back to itself');
});
t('fences, gates, doors, trapdoors, buttons, plates: sub-families', () => {
  const ok = [['oak_fence', 'nether_brick_fence'], ['bamboo_fence', 'crimson_fence'], ['oak_fence_gate', 'bamboo_fence_gate'], ['crimson_fence_gate', 'pale_oak_fence_gate'],
    ['oak_door', 'warped_door'], ['copper_door', 'waxed_oxidized_copper_door'], ['oak_trapdoor', 'waxed_weathered_copper_trapdoor'], ['bamboo_button', 'crimson_button'],
    ['stone_button', 'polished_blackstone_button'], ['oak_pressure_plate', 'warped_pressure_plate'], ['stone_pressure_plate', 'polished_blackstone_pressure_plate']];
  const no = [['oak_fence_gate', 'oak_fence'], ['oak_door', 'copper_door'], ['copper_door', 'iron_door'], ['oak_trapdoor', 'iron_trapdoor'], ['oak_button', 'stone_button'],
    ['oak_pressure_plate', 'stone_pressure_plate'], ['stone_pressure_plate', 'heavy_weighted_pressure_plate'], ['oak_fence', 'cobblestone_wall'], ['iron_bars', 'oak_fence']];
  ok.forEach(([a, b]) => assert.ok(C.canSwap(M(a), M(b)) && C.canSwap(M(b), M(a)), a + ' <-> ' + b));
  no.forEach(([a, b]) => assert.ok(!C.canSwap(M(a), M(b)) && !C.canSwap(M(b), M(a)), a + ' </> ' + b));
  assert.deepStrictEqual(sw1('minecraft:oak_fence[east=true,north=false,south=false,waterlogged=false,west=true]', 'nether_brick_fence'), ['minecraft:nether_brick_fence[east=true,north=false,south=false,waterlogged=false,west=true]']);
  assert.deepStrictEqual(sw1('minecraft:copper_trapdoor[facing=north,half=top,open=true,powered=false,waterlogged=false]', 'jungle_trapdoor'), ['minecraft:jungle_trapdoor[facing=north,half=top,open=true,powered=false,waterlogged=false]']);
});
t('shape families hold every material of the game (copper, waxed, resin, tuff, mud brick, pale oak, cherry, bamboo, mosaic ...)', () => {
  const names = Object.keys(ctx.TH.data.blockDb.b);
  const check = (re, fam, skip) => {
    const all = names.filter((n) => re.test(n) && !(skip || []).includes(n)), have = new Set(C.familyOf(fam));
    all.forEach((n) => assert.ok(have.has(n), n + ' in ' + fam));
    return all;
  };
  check(/_slab$/, 'slab'); check(/_stairs$/, 'stairs'); check(/_wall$/, 'wall'); check(/_fence$/, 'fence'); check(/_carpet$/, 'carpet', ['pale_moss_carpet']);
  check(/_pane$|_bars$/, 'pane');
  ['waxed_oxidized_cut_copper_stairs', 'bamboo_mosaic_stairs', 'resin_brick_stairs', 'tuff_brick_stairs', 'mud_brick_stairs', 'pale_oak_stairs', 'cherry_stairs', 'quartz_stairs', 'smooth_quartz_stairs', 'prismarine_brick_stairs', 'purpur_stairs', 'polished_deepslate_stairs', 'blackstone_stairs', 'red_nether_brick_stairs']
    .forEach((n) => assert.ok(C.canSwap(M('oak_stairs'), M(n)) && C.canSwap(M(n), M('oak_stairs')), 'oak_stairs <-> ' + n));
  ['waxed_exposed_cut_copper_slab', 'bamboo_mosaic_slab', 'resin_brick_slab', 'smooth_stone_slab', 'cut_red_sandstone_slab', 'petrified_oak_slab', 'pale_oak_slab', 'dark_prismarine_slab']
    .forEach((n) => assert.ok(C.canSwap(M('stone_slab'), M(n)), 'stone_slab -> ' + n));
  assert.deepStrictEqual(sw1('minecraft:oak_stairs[facing=east,half=top,shape=outer_left,waterlogged=true]', 'waxed_oxidized_cut_copper_stairs'), ['minecraft:waxed_oxidized_cut_copper_stairs[facing=east,half=top,shape=outer_left,waterlogged=true]']);
  assert.deepStrictEqual(sw1('minecraft:resin_brick_slab[type=double,waterlogged=false]', 'tuff_slab'), ['minecraft:tuff_slab[type=double,waterlogged=false]']);
  assert.deepStrictEqual(sw1('minecraft:iron_bars[east=true,north=false,south=false,waterlogged=false,west=true]', 'lime_stained_glass_pane'), ['minecraft:lime_stained_glass_pane[east=true,north=false,south=false,waterlogged=false,west=true]']);
});
t('decoration families: heads, pots, flowers, torches, lanterns, coral, saplings', () => {
  const ok = [['creeper_head', 'player_head'], ['zombie_wall_head', 'dragon_wall_head'], ['flower_pot', 'potted_poppy'], ['potted_cactus', 'potted_bamboo'], ['poppy', 'cornflower'],
    ['peony', 'rose_bush'], ['oak_sapling', 'cherry_sapling'], ['torch', 'copper_torch'], ['wall_torch', 'soul_wall_torch'], ['lantern', 'waxed_copper_lantern'], ['iron_chain', 'copper_chain'],
    ['tube_coral_fan', 'dead_horn_coral_fan'], ['crimson_fungus', 'warped_roots'], ['anvil', 'damaged_anvil'], ['oak_shelf', 'bamboo_shelf'], ['copper_chest', 'oxidized_copper_chest'], ['short_grass', 'fern'], ['dead_bush', 'short_dry_grass']];
  ok.forEach(([a, b]) => assert.ok(C.canSwap(M(a), M(b)), a + ' -> ' + b));
  const no = [['creeper_head', 'creeper_wall_head'], ['torch', 'wall_torch'], ['poppy', 'peony'], ['poppy', 'short_grass'], ['short_grass', 'dead_bush'], ['oak_sapling', 'poppy'], ['lantern', 'torch'], ['tube_coral', 'tube_coral_fan']];
  no.forEach(([a, b]) => assert.ok(!C.canSwap(M(a), M(b)), a + ' -/-> ' + b));
  assert.deepStrictEqual(sw1('minecraft:wall_torch[facing=east]', 'soul_wall_torch'), ['minecraft:soul_wall_torch[facing=east]']);
  assert.deepStrictEqual(sw1('minecraft:lantern[hanging=true,waterlogged=false]', 'copper_lantern'), ['minecraft:copper_lantern[hanging=true,waterlogged=false]']);
});
t('block entities stay with blocks that hold the same kind (shelf, campfire, head, sign, shulker) and are listed when lost', () => {
  const s = C.fromFunction([6, 1, 1], (x) => ['minecraft:oak_shelf[facing=north,powered=false,side_chain=unconnected,waterlogged=false]', 'minecraft:campfire[facing=north,lit=true,signal_fire=false,waterlogged=false]',
    'minecraft:player_head[powered=false,rotation=0]', 'minecraft:oak_sign[rotation=0,waterlogged=false]', 'minecraft:suspicious_sand[dusted=0]', 'minecraft:red_shulker_box[facing=up]'][x], 'BE');
  s.be = [['shelf', 0], ['campfire', 1], ['skull', 2], ['sign', 3], ['brushable_block', 4], ['shulker_box', 5]].map(([id, x]) => ({ x, y: 0, z: 0, id: M(id), nbt: { tag: [8, id] } }));
  const o = C.applySwaps(s, { [M('oak_shelf')]: M('cherry_shelf'), [M('campfire')]: M('soul_campfire'), [M('player_head')]: M('creeper_head'), [M('oak_sign')]: M('birch_sign'), [M('suspicious_sand')]: M('sand'), [M('red_shulker_box')]: M('blue_shulker_box') });
  assert.strictEqual(o.be.length, 5);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(o.beLost)), [{ x: 4, y: 0, z: 0, id: M('brushable_block'), from: M('suspicious_sand'), to: M('sand') }]);
  assert.deepStrictEqual(ids(o), ['minecraft:birch_sign[rotation=0,waterlogged=false]', 'minecraft:blue_shulker_box[facing=up]', 'minecraft:cherry_shelf[facing=north,powered=false,side_chain=unconnected,waterlogged=false]',
    'minecraft:creeper_head[powered=false,rotation=0]', 'minecraft:sand', 'minecraft:soul_campfire[facing=north,lit=true,signal_fire=false,waterlogged=false]']);
});
t('a big build (4.2 M cells) swaps by palette only, whatever the class', () => {
  const sx = 256, sy = 64, sz = 257;
  const s = C.create(sx, sy, sz, 'Big');
  const pal = ['minecraft:white_glazed_terracotta[facing=east]', 'minecraft:oak_log[axis=x]', 'minecraft:stone', 'minecraft:observer[facing=up,powered=false]'].map((p) => C.pal(s, p));
  for (let i = 0; i < s.blocks.length; i++) s.blocks[i] = pal[i % 4];
  const t0 = Date.now();
  const o = C.applySwaps(s, { [M('white_glazed_terracotta')]: M('red_concrete'), [M('oak_log')]: M('stone'), [M('stone')]: M('sand'), [M('observer')]: M('stone') });
  const ms = Date.now() - t0;
  assert.strictEqual(o.blocks, s.blocks, 'the block array is shared');
  assert.ok(ms < 50, 'palette only: ' + ms + ' ms');
  assert.deepStrictEqual(Array.from(o.palette.slice(1)), ['minecraft:red_concrete', 'minecraft:stone', 'minecraft:sand', 'minecraft:observer[facing=up,powered=false]']);
  assert.strictEqual(s.palette[1], 'minecraft:white_glazed_terracotta[facing=east]', 'the original stays');
  const cnt = Object.fromEntries(C.counts(o, true).map((x) => [x.id, x.n]));
  assert.strictEqual(s.blocks.length % 4, 0);
  assert.strictEqual(cnt['minecraft:stone'], s.blocks.length / 4, 'logs became stone, stone became sand, the observer stays');
  assert.strictEqual(cnt['minecraft:sand'], s.blocks.length / 4);
  assert.strictEqual(cnt['minecraft:observer'], s.blocks.length / 4);
});
t('whole-set swaps stay coherent: wood set with shelves, copper stage with bulbs (chips listed once)', () => {
  const s0 = build(['minecraft:oak_planks', 'minecraft:oak_shelf[facing=north,powered=false,side_chain=unconnected,waterlogged=false]', 'minecraft:oak_log[axis=y]']);
  const p = C.setPlan(s0, {}, 'wood', 'oak', 'warped');
  assert.strictEqual(p.kinds, 3);
  assert.ok(p.change.some((c) => c.to === M('warped_shelf')));
  const s1 = build(['minecraft:copper_bulb[lit=true,powered=false]', 'minecraft:cut_copper', 'minecraft:copper_block']);
  const q = C.setPlan(s1, {}, 'copper', '', 'oxidized');
  assert.strictEqual(q.kinds, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(q.warn.map((x) => x.text))), ['Dimmer light']);
});

/* ---- sets ---- */
t('set detection', () => {
  const chk = (n, kind, token, role) => assert.deepStrictEqual(JSON.parse(JSON.stringify(C.setOf(n))), { kind, token, role }, n);
  chk('dark_oak_trapdoor', 'wood', 'dark_oak', 'trapdoor'); chk('oak_trapdoor', 'wood', 'oak', 'trapdoor'); chk('stripped_spruce_log', 'wood', 'spruce', 'stripped_log');
  chk('crimson_stem', 'wood', 'crimson', 'log'); chk('warped_hyphae', 'wood', 'warped', 'wood'); chk('bamboo_block', 'wood', 'bamboo', 'log');
  chk('light_blue_wool', 'colour', 'light_blue', 'wool'); chk('glass', 'colour', 'plain', 'stained_glass'); chk('red_stained_glass_pane', 'colour', 'red', 'stained_glass_pane');
  chk('deepslate_brick_wall', 'stone', 'deepslate_brick', 'wall'); chk('stone_bricks', 'stone', 'stone_brick', 'block'); chk('red_nether_brick_slab', 'stone', 'red_nether_brick', 'slab');
  chk('waxed_exposed_cut_copper', 'copper', 'waxed_exposed', 'cut_copper'); chk('copper_block', 'copper', '', 'block'); chk('oxidized_copper', 'copper', 'oxidized', 'block');
  assert.strictEqual(C.setOf('red_sand'), null);
  assert.strictEqual(C.setName('wood', 'crimson', 'log'), 'crimson_stem');
  assert.strictEqual(C.setName('wood', 'crimson', 'leaves'), null);
  assert.strictEqual(C.setName('copper', 'weathered', 'block'), 'weathered_copper');
  assert.strictEqual(C.setName('stone', 'deepslate_tile', 'block'), 'deepslate_tiles');
  assert.strictEqual(C.relate('minecraft:oak_sign', 'minecraft:spruce_sign', 'minecraft:oak_wall_sign'), 'minecraft:spruce_wall_sign');
});
t('group swap oak -> spruce: counts, states, what stays', () => {
  const cells = [];
  const add = (st, k) => { for (let i = 0; i < k; i++) cells.push(st); };
  add('minecraft:oak_planks', 10); add('minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 4); add('minecraft:oak_log[axis=y]', 3);
  add('minecraft:oak_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]', 2); add('minecraft:oak_fence_gate[facing=east,in_wall=true,open=false,powered=false]', 1);
  add('minecraft:oak_wall_sign[facing=north,waterlogged=false]', 1); add('minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]', 5); add('minecraft:stone', 7);
  const s0 = C.fromFunction([cells.length, 1, 1], (x) => cells[x], 'Hut');
  const sets = C.setsIn(s0, {});
  const oak = sets.find((x) => x.kind === 'wood' && x.token === 'oak');
  assert.strictEqual(oak.n, 26);
  const plan = C.setPlan(s0, {}, 'wood', 'oak', 'spruce');
  assert.strictEqual(plan.kinds, 7); assert.strictEqual(plan.blocks, 26); assert.strictEqual(plan.stay.length, 0);
  const sw = C.withChanges(s0, {}, plan.change);
  const s = C.applySwaps(s0, sw);
  const cnt = Object.fromEntries(C.counts(s, true).map((x) => [x.id, x.n]));
  assert.deepStrictEqual(cnt, { 'minecraft:spruce_planks': 10, 'minecraft:stone': 7, 'minecraft:spruce_leaves': 5, 'minecraft:spruce_stairs': 4, 'minecraft:spruce_log': 3, 'minecraft:spruce_trapdoor': 2, 'minecraft:spruce_fence_gate': 1, 'minecraft:spruce_wall_sign': 1 });
  assert.ok(s.palette.includes('minecraft:spruce_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]'));
  // crimson has no leaves: they stay, the note says it never burns
  const p2 = C.setPlan(s0, {}, 'wood', 'oak', 'crimson');
  assert.strictEqual(p2.stay.length, 1); assert.strictEqual(p2.stay[0].id, 'minecraft:oak_leaves');
  assert.ok(p2.change.some((c) => c.to === 'minecraft:crimson_stem'));
  assert.match(p2.note, /never burns/);
  // a second set swap on top of the first: spruce -> oak goes back to the original (no swaps left)
  const back = C.withChanges(s0, sw, C.setPlan(s0, sw, 'wood', 'spruce', 'oak').change);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(back)), {});
});

/* ---- exports ---- */
async function roundTrip(s, fmt) {
  const bytes = fmt === 'litematic' ? await IO.toLitematic(s) : await IO.toSchem(s);
  return IO.load({ name: 'x.' + fmt, bytes });
}
const countMap = (s) => Object.fromEntries(C.counts(s).map((x) => [x.id, x.n]));
t('export round-trip (.schem and .litematic) keeps every block and state, swaps included', async () => {
  const cells = [];
  const add = (st, k) => { for (let i = 0; i < k; i++) cells.push(st); };
  add('minecraft:oak_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]', 5); add('minecraft:oak_door[facing=south,half=lower,hinge=right,open=true,powered=false]', 1);
  add('minecraft:oak_fence_gate[facing=east,in_wall=true,open=true,powered=false]', 2); add('minecraft:stone_bricks', 40); add('minecraft:observer[facing=up,powered=false]', 1);
  add(null, 3); add('minecraft:red_wool', 9); add('minecraft:poplar_planks', 17);
  // 3 layers so the y / z order is exercised
  const W = 13, D = 2, H = Math.ceil(cells.length / (W * D));
  const s0 = C.fromFunction([W, H, D], (x, y, z) => cells[(y * D + z) * W + x] || null, 'Round trip');
  const sw = C.withChanges(s0, {}, C.setPlan(s0, {}, 'wood', 'oak', 'cherry').change.concat([{ from: 'minecraft:stone_bricks', to: 'minecraft:deepslate_bricks' }, { from: 'minecraft:observer', to: 'minecraft:stone' }]));
  const mine = C.applySwaps(s0, sw);
  const want = countMap(mine);
  assert.ok(want['minecraft:cherry_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]'] === 5);
  assert.ok(want['minecraft:observer[facing=up,powered=false]'] === 1);
  for (const fmt of ['schem', 'litematic']) {
    const back = await roundTrip(mine, fmt);
    assert.deepStrictEqual(countMap(back), want, fmt + ' counts');
    // positions too: the read file is trimmed, the source is already tight
    for (let i = 0; i < mine.blocks.length; i++) assert.strictEqual(back.palette[back.blocks[i]], mine.palette[mine.blocks[i]], fmt + ' cell ' + i);
  }
  // the original stays untouched
  assert.ok(countMap(s0)['minecraft:oak_trapdoor[facing=north,half=top,open=true,waterlogged=true,powered=false]'] === 5);
});
t('export round-trip of a cross-class swap keeps block entities, positions and the defaulted states', async () => {
  const st = ['minecraft:oak_wall_sign[facing=south,waterlogged=false]', 'minecraft:red_shulker_box[facing=up]', 'minecraft:white_glazed_terracotta[facing=east]', 'minecraft:oak_log[axis=x]',
    'minecraft:stone', 'minecraft:glass', 'minecraft:oak_fence[east=true,north=false,south=false,waterlogged=false,west=false]', 'minecraft:campfire[facing=north,lit=true,signal_fire=false,waterlogged=false]'];
  const s0 = C.fromFunction([st.length, 1, 2], (x, y, z) => (z ? (x % 2 ? 'minecraft:stone' : null) : st[x]), 'BE round trip');
  s0.be = [
    { x: 0, y: 0, z: 0, id: M('sign'), nbt: { front_text: [10, { messages: [9, [8, ['"Hall"', '""', '""', '""']]], color: [8, 'black'], has_glowing_text: [1, 0] }], is_waxed: [1, 1] } },
    { x: 1, y: 0, z: 0, id: M('shulker_box'), nbt: { CustomName: [8, '"Box"'] } },
    { x: 7, y: 0, z: 0, id: M('campfire'), nbt: { CookingTimes: [11, [0, 0, 0, 0]] } },
  ];
  const sw = { [M('oak_wall_sign')]: M('spruce_wall_sign'), [M('red_shulker_box')]: M('lime_shulker_box'), [M('white_glazed_terracotta')]: M('stone'), [M('oak_log')]: M('red_concrete'),
    [M('stone')]: M('white_glazed_terracotta'), [M('glass')]: M('oak_leaves'), [M('oak_fence')]: M('nether_brick_fence'), [M('campfire')]: M('soul_campfire') };
  const mine = C.applySwaps(s0, sw);
  assert.ok(!mine.beLost, 'nothing lost');
  assert.deepStrictEqual(Array.from(mine.palette.slice(1)).sort(), ['minecraft:lime_shulker_box[facing=up]', 'minecraft:nether_brick_fence[east=true,north=false,south=false,waterlogged=false,west=false]',
    'minecraft:oak_leaves[persistent=true]', 'minecraft:red_concrete', 'minecraft:soul_campfire[facing=north,lit=true,signal_fire=false,waterlogged=false]',
    'minecraft:spruce_wall_sign[facing=south,waterlogged=false]', 'minecraft:stone', 'minecraft:white_glazed_terracotta']);
  for (const fmt of ['schem', 'litematic']) {
    const back = await roundTrip(mine, fmt);
    for (let i = 0; i < mine.blocks.length; i++) assert.strictEqual(back.palette[back.blocks[i]], mine.palette[mine.blocks[i]], fmt + ' cell ' + i);
    const be = (s) => JSON.stringify((s.be || []).map((b) => [b.x, b.y, b.z, b.id, b.nbt]).sort());
    assert.strictEqual(be(back), be(mine), fmt + ' block entities');
  }
});
t('a big palette packs across 64-bit words (.litematic)', async () => {
  const states = [];
  ['north', 'south', 'east', 'west'].forEach((f) => ['top', 'bottom'].forEach((hh) => ['true', 'false'].forEach((o) => ['true', 'false'].forEach((w) => C.familyOf('trapdoor').forEach((b) => states.push('minecraft:' + b + '[facing=' + f + ',half=' + hh + ',open=' + o + ',powered=false,waterlogged=' + w + ']'))))));
  const s = C.fromFunction([states.length, 2, 1], (x, y) => (y ? states[(x * 7) % states.length] : states[x]), 'Many');
  const back = await roundTrip(s, 'litematic');
  for (let i = 0; i < s.blocks.length; i++) assert.strictEqual(back.palette[back.blocks[i]], s.palette[s.blocks[i]]);
  const back2 = await roundTrip(s, 'schem');
  assert.deepStrictEqual(countMap(back2), countMap(s));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' swap tests passed');
})();
