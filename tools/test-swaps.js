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
    ['oak_trapdoor', 'iron_trapdoor'], ['oak_door', 'iron_door'], ['iron_door', 'oak_door'], ['oak_trapdoor', 'copper_trapdoor'], ['oak_button', 'stone_button'],
    ['oak_pressure_plate', 'stone_pressure_plate'], ['stone_pressure_plate', 'light_weighted_pressure_plate'], ['oak_sign', 'oak_wall_sign'], ['oak_fence_gate', 'oak_fence'],
    ['oak_trapdoor', 'oak_slab'], ['red_glazed_terracotta', 'red_terracotta'], ['lantern', 'soul_lantern'], ['observer', 'stone'], ['oak_log', 'stone'], ['hopper', 'chest'],
  ];
  bad.forEach(([a, b]) => assert.ok(!C.canSwap('minecraft:' + a, 'minecraft:' + b), a + ' -/-> ' + b));
  assert.ok(!C.replaceable('minecraft:iron_door').ok);
  assert.match(C.replaceable('minecraft:iron_door').why, /redstone/);
  assert.ok(!C.replaceable('minecraft:iron_trapdoor').ok);
  assert.ok(!C.replaceable('minecraft:observer').ok);
  assert.ok(!C.replaceable('minecraft:copper_bulb').ok);
});
t('the picker family lists database blocks (poplar) and nothing functional', () => {
  const fam = C.familyOf(C.def('minecraft:oak_trapdoor').fam);
  assert.ok(fam.includes('poplar_trapdoor') && fam.includes('cherry_trapdoor') && fam.includes('bamboo_trapdoor'));
  assert.ok(!fam.includes('iron_trapdoor') && !fam.includes('copper_trapdoor'));
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
t('a big palette packs across 64-bit words (.litematic)', async () => {
  const states = [];
  ['north', 'south', 'east', 'west'].forEach((f) => ['top', 'bottom'].forEach((hh) => ['true', 'false'].forEach((o) => ['true', 'false'].forEach((w) => C.familyOf('trapdoor_wood').forEach((b) => states.push('minecraft:' + b + '[facing=' + f + ',half=' + hh + ',open=' + o + ',powered=false,waterlogged=' + w + ']'))))));
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
