// Tests for what schematic files carry besides blocks (js/modules/builds-core.js + builds-io.js):
// container contents, sign text and every other block entity, entities (item frames, paintings, armor stands,
// minecarts), Litematica ticks, data version, metadata and the orientation data (region Position / signed Size,
// Sponge Offset, WorldEdit's WEOffset, block states).
//   node tools/test-containers.js
// Fixtures are written here with the raw NBT writer in each format's own layout (WorldEdit v2 / Sponge v3 / Litematica),
// independent of the app's exporters. Basti's real files are used too when they are on this machine (skipped otherwise).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, DataView, Map, Set, Math, JSON, Object, Array, String, Number, Promise, Error, BigInt, Date };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('window.TH = { data: {}, langData: {}, icon: () => null };', ctx);
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const C = ctx.TH.builds.core, IO = ctx.TH.builds.io;

/* ---- typed NBT shorthands ([type, value], the form IO.writeNBT takes) ---- */
const B = (v) => [1, v], SH = (v) => [2, v], I = (v) => [3, v], LG = (v) => [4, String(v)], F = (v) => [5, v], D = (v) => [6, v], S = (v) => [8, v];
const IA = (a) => [11, a], CO = (o) => [10, o], LS = (et, a) => [9, [et, a]];
const strs = (a) => LS(8, a), comps = (a) => LS(10, a), dbls = (a) => LS(6, a), flts = (a) => LS(5, a);
// items: 1.20.5+ (id / count int / components) and before (id / Count byte / tag)
const it = (id, count, components) => Object.assign({ id: S('minecraft:' + id), count: I(count) }, components ? { components: CO(components) } : {});
const old = (id, count, tag) => Object.assign({ id: S('minecraft:' + id), Count: B(count) }, tag ? { tag: CO(tag) } : {});
const slot = (n, item) => Object.assign({ Slot: B(n) }, item);
const uuid = (k) => IA([k, k * 7, -k * 13, k * 31]);

/* ---- the fixture build, 5 x 3 x 4, in its own frame (0 0 0 = lowest corner) ---- */
const NEW_DV = 3955, OLD_DV = 3465;
function fixtureNew() {
  const blocks = [], be = [], ents = [];
  const put = (x, y, z, st, id, data) => { blocks.push([x, y, z, 'minecraft:' + st]); if (id) be.push([x, y, z, 'minecraft:' + id, data || {}]); };
  const nestedShulker = it('red_shulker_box', 1, { 'minecraft:container': comps([{ slot: I(0), item: CO(it('diamond', 64)) }, { slot: I(1), item: CO(it('emerald', 12)) }]) });
  put(0, 0, 0, 'chest[facing=north,type=single,waterlogged=false]', 'chest', {
    CustomName: S('"Loot"'), lock: CO({ items: S('minecraft:tripwire_hook') }),
    Items: comps([
      slot(0, it('diamond_sword', 1, { 'minecraft:enchantments': CO({ 'minecraft:sharpness': I(5), 'minecraft:unbreaking': I(3) }), 'minecraft:custom_name': S('Biter'), 'minecraft:damage': I(12) })),
      slot(1, it('shulker_box', 1, { 'minecraft:container': comps([{ slot: I(0), item: CO(it('stone', 64)) }, { slot: I(5), item: CO(nestedShulker) }]) })),
      slot(2, it('bundle', 1, { 'minecraft:bundle_contents': comps([it('arrow', 16), it('torch', 8)]) })),
      slot(26, it('enchanted_book', 1, { 'minecraft:stored_enchantments': CO({ 'minecraft:mending': I(1) }) })),
    ]),
  });
  put(1, 0, 0, 'barrel[facing=up,open=false]', 'barrel', { LootTable: S('minecraft:chests/simple_dungeon'), LootTableSeed: LG('-4611686018427387905') });
  put(2, 0, 0, 'hopper[enabled=true,facing=down]', 'hopper', { TransferCooldown: I(0), Items: comps([slot(0, it('iron_nugget', 4))]) });
  put(3, 0, 0, 'oak_wall_sign[facing=south,waterlogged=false]', 'sign', {
    is_waxed: B(1),
    front_text: CO({ color: S('red'), has_glowing_text: B(1), messages: strs(['Storage', 'east wing', '', '→']) }),
    back_text: CO({ color: S('black'), has_glowing_text: B(0), messages: strs(['back side', '', '', '']) }),
  });
  put(4, 0, 0, 'red_banner[rotation=4]', 'banner', { patterns: comps([{ color: S('white'), pattern: S('minecraft:creeper') }, { color: S('black'), pattern: S('minecraft:border') }]) });
  put(0, 1, 0, 'player_head[powered=false,rotation=8]', 'skull', { profile: CO({ name: S('n1cebear'), id: uuid(5) }) });
  put(1, 1, 0, 'spawner', 'mob_spawner', { Delay: SH(20), SpawnData: CO({ entity: CO({ id: S('minecraft:zombie') }) }), MaxNearbyEntities: SH(6) });
  put(2, 1, 0, 'command_block[conditional=false,facing=up]', 'command_block', { Command: S('say hi'), auto: B(0), powered: B(0), TrackOutput: B(1), SuccessCount: I(0) });
  put(3, 1, 0, 'lectern[facing=west,has_book=true,powered=false]', 'lectern', { Page: I(2), Book: CO(it('written_book', 1, { 'minecraft:written_book_content': CO({ title: CO({ raw: S('Rules') }), author: S('Basti'), pages: comps([{ raw: S('Page one') }]) }) })) });
  put(4, 1, 0, 'decorated_pot[cracked=false,facing=north,waterlogged=false]', 'decorated_pot', { sherds: strs(['minecraft:brick', 'minecraft:heart_pottery_sherd', 'minecraft:brick', 'minecraft:skull_pottery_sherd']), item: CO(it('gold_ingot', 3)) });
  put(0, 2, 0, 'beacon', 'beacon', { primary_effect: S('minecraft:haste'), secondary_effect: S('minecraft:regeneration') });
  put(1, 2, 0, 'jukebox[has_record=true]', 'jukebox', { RecordItem: CO(it('music_disc_cat', 1)), ticks_since_song_started: LG('120') });
  put(2, 2, 0, 'campfire[facing=east,lit=true,signal_fire=false,waterlogged=false]', 'campfire', { Items: comps([slot(0, it('beef', 1))]), CookingTimes: IA([10, 0, 0, 0]), CookingTotalTimes: IA([600, 0, 0, 0]) });
  put(3, 2, 0, 'bee_nest[facing=north,honey_level=3]', 'beehive', { bees: comps([{ entity_data: CO({ id: S('minecraft:bee') }), min_ticks_in_hive: I(600), ticks_in_hive: I(10) }]) });
  put(4, 2, 0, 'end_gateway', 'end_gateway', { Age: LG('9007199254740993'), ExactTeleport: B(1), exit_portal: IA([100, 64, -200]) });
  put(0, 0, 2, 'red_bed[facing=south,occupied=false,part=foot]', 'bed', {});
  put(0, 0, 3, 'red_bed[facing=south,occupied=false,part=head]', 'bed', {});
  put(1, 0, 2, 'red_shulker_box[facing=up]', 'shulker_box', { Items: comps([slot(13, it('netherite_ingot', 2))]), CustomName: S('{"text":"Spare"}') });
  put(2, 0, 2, 'oak_hanging_sign[attached=false,rotation=0,waterlogged=false]', 'hanging_sign', { is_waxed: B(0), front_text: CO({ color: S('black'), has_glowing_text: B(0), messages: strs(['Shop', '', '', '']) }), back_text: CO({ color: S('black'), has_glowing_text: B(0), messages: strs(['', '', '', '']) }) });
  put(3, 0, 2, 'stone');
  put(4, 0, 2, 'oak_door[facing=east,half=lower,hinge=left,open=false,powered=false]');
  put(4, 1, 2, 'oak_door[facing=east,half=upper,hinge=left,open=false,powered=false]');
  put(3, 0, 3, 'oak_stairs[facing=west,half=top,shape=straight,waterlogged=false]');
  put(4, 0, 3, 'spruce_trapdoor[facing=north,half=top,open=true,powered=false,waterlogged=false]');
  put(2, 0, 3, 'comparator[facing=south,mode=subtract,powered=false]', 'comparator', { OutputSignal: I(3) });
  put(1, 1, 3, 'cobblestone');
  // entities (pos in the build's frame; TileX/Y/Z and block_pos in the same frame)
  const base = (id, k, extra) => Object.assign({ id: S('minecraft:' + id), UUID: uuid(k), Motion: dbls([0, 0, 0]), OnGround: B(0), Air: SH(300), Fire: SH(-1), Invulnerable: B(0), PortalCooldown: I(0), fall_distance: D(0) }, extra);
  ents.push([[1.5, 1.5, 3.03125], base('item_frame', 1, { Rotation: flts([0, 0]), Facing: B(3), TileX: I(1), TileY: I(1), TileZ: I(3), block_pos: IA([1, 1, 3]), Item: CO(it('clock', 1)), ItemRotation: B(3), ItemDropChance: F(1), Invisible: B(0), Fixed: B(1) })]);
  ents.push([[0.96875, 1.5, 3.5], base('glow_item_frame', 2, { Rotation: flts([270, 0]), Facing: B(5), TileX: I(0), TileY: I(1), TileZ: I(3), block_pos: IA([0, 1, 3]), Item: CO(it('enchanted_book', 1, { 'minecraft:stored_enchantments': CO({ 'minecraft:efficiency': I(5) }) })), ItemRotation: B(1), ItemDropChance: F(1), Invisible: B(1), Fixed: B(0) })]);
  ents.push([[2.5, 1.5, 3.96875], base('painting', 3, { Rotation: flts([180, 0]), facing: B(2), TileX: I(2), TileY: I(1), TileZ: I(3), block_pos: IA([2, 1, 3]), variant: S('minecraft:kebab') })]);
  ents.push([[3.5, 1, 1.5], base('armor_stand', 4, { Rotation: flts([90, 0]), ShowArms: B(1), NoBasePlate: B(1), Small: B(0), Invisible: B(0), Pose: CO({ Head: flts([10, 20, 0]), RightArm: flts([-30, 0, 15]) }), equipment: CO({ head: CO(it('diamond_helmet', 1, { 'minecraft:enchantments': CO({ 'minecraft:protection': I(4) }) })), mainhand: CO(it('trident', 1)) }) })]);
  ents.push([[2.5, 1.0625, 1.5], base('chest_minecart', 5, { Rotation: flts([0, 0]), Items: comps([slot(0, it('rail', 64)), slot(1, it('powered_rail', 32))]) })]);
  return { dv: NEW_DV, size: [5, 3, 4], blocks, be, ents };
}
function fixtureOld() {   // 1.20.1 items: id / Count byte / tag, JSON sign lines
  const f = { dv: OLD_DV, size: [3, 2, 2], blocks: [], be: [], ents: [] };
  f.blocks.push([0, 0, 0, 'minecraft:chest[facing=east,type=single,waterlogged=false]'], [1, 0, 0, 'minecraft:spruce_wall_sign[facing=north,waterlogged=false]'], [2, 0, 1, 'minecraft:stone_bricks'], [0, 1, 1, 'minecraft:white_shulker_box[facing=down]']);
  f.be.push([0, 0, 0, 'minecraft:chest', { Items: comps([
    slot(0, old('netherite_pickaxe', 1, { Damage: I(7), Enchantments: comps([{ id: S('minecraft:efficiency'), lvl: SH(5) }, { id: S('minecraft:fortune'), lvl: SH(3) }]), display: CO({ Name: S('{"text":"Digger"}') }) })),
    slot(4, old('blue_shulker_box', 1, { BlockEntityTag: CO({ Items: comps([slot(0, old('gold_block', 64)), slot(1, old('lapis_block', 20))]) }) })),
    slot(8, old('cobblestone', 64)),
  ]) }]);
  f.be.push([1, 0, 0, 'minecraft:sign', { is_waxed: B(0), front_text: CO({ color: S('black'), has_glowing_text: B(0), messages: strs(['{"text":"Old sign"}', '{"text":"line two"}', '""', '""']) }), back_text: CO({ color: S('black'), has_glowing_text: B(0), messages: strs(['""', '""', '""', '""']) }) }]);
  f.be.push([0, 1, 1, 'minecraft:shulker_box', { Items: comps([slot(0, old('ender_pearl', 16))]) }]);
  f.ents.push([[1.5, 1.5, 0.03125], { id: S('minecraft:item_frame'), UUID: uuid(9), Facing: B(3), TileX: I(1), TileY: I(1), TileZ: I(0), Rotation: flts([0, 0]), Item: CO(old('compass', 1)), ItemRotation: B(2) }]);
  return f;
}

/* ---- format writers for the fixtures (each format's own layout) ---- */
const gz = (b) => new Uint8Array(zlib.gzipSync(Buffer.from(b)));
const gunz = (b) => { b = Buffer.from(b); return new Uint8Array(b[0] === 0x1f ? zlib.gunzipSync(b) : b); };
function paletteOf(f) {
  const pal = ['minecraft:air'], at = new Map(), idx = new Uint16Array(f.size[0] * f.size[1] * f.size[2]);
  f.blocks.forEach(([x, y, z, st]) => { if (!at.has(st)) { at.set(st, pal.length); pal.push(st); } idx[(y * f.size[2] + z) * f.size[0] + x] = at.get(st); });
  return { pal, idx };
}
/** WorldEdit-style Sponge v2: Offset = the world min corner, entities (Pos, TileX..) in world coordinates, WEOffset in Metadata. */
function spongeV2(f, off, weOff) {
  const { pal, idx } = paletteOf(f), P = {};
  pal.forEach((p, i) => { P[p] = I(i); });
  const shift = (o) => C.entShift(o, off);
  return gz(IO.writeNBT('Schematic', {
    Version: I(2), DataVersion: I(f.dv), Width: SH(f.size[0]), Height: SH(f.size[1]), Length: SH(f.size[2]), Offset: IA(off),
    Metadata: CO({ Name: S('Fixture v2'), Author: S('tester'), Date: LG('1700000000000'), WEOffsetX: I(weOff[0]), WEOffsetY: I(weOff[1]), WEOffsetZ: I(weOff[2]), RequiredMods: strs([]) }),
    PaletteMax: I(pal.length), Palette: CO(P), BlockData: [7, IO.writeVarints(idx)],
    BlockEntities: comps(f.be.map(([x, y, z, id, data]) => Object.assign({ Pos: IA([x, y, z]), Id: S(id) }, data))),
    Entities: comps(f.ents.map(([pos, data]) => { const o = Object.assign({}, data); delete o.id; return Object.assign({ Pos: dbls(pos.map((v, a) => v + off[a])), Id: data.id }, shift(o)); })),
  }));
}
/** Sponge v3: root Schematic, blocks + block entities under Blocks, { Pos, Id, Data } entries, entities relative to the box. */
function spongeV3(f) {
  const { pal, idx } = paletteOf(f), P = {};
  pal.forEach((p, i) => { P[p] = I(i); });
  return gz(IO.writeNBT('', { Schematic: CO({
    Version: I(3), DataVersion: I(f.dv), Width: SH(f.size[0]), Height: SH(f.size[1]), Length: SH(f.size[2]), Offset: IA([0, 0, 0]),
    Metadata: CO({ Name: S('Fixture v3'), Date: LG('1690000000000') }),
    Blocks: CO({ Palette: CO(P), Data: [7, IO.writeVarints(idx)], BlockEntities: comps(f.be.map(([x, y, z, id, data]) => ({ Pos: IA([x, y, z]), Id: S(id), Data: CO(data) }))) }),
    Entities: comps(f.ents.map(([pos, data]) => { const o = Object.assign({}, data); delete o.id; return { Pos: dbls(pos), Id: data.id, Data: CO(o) }; })),
  }) }));
}
/** Litematica: one region at Position with a signed Size; block entities / ticks from the lowest corner, entities from Position. */
function litematic(f, pos, size) {
  const { pal, idx } = paletteOf(f);
  const bits = Math.max(2, Math.ceil(Math.log2(pal.length))), total = idx.length, longs = Math.ceil(total * bits / 64);
  const words = new Array(longs).fill(0n);
  for (let i = 0; i < total; i++) { const b = BigInt(i * bits), w = Number(b / 64n), o = b % 64n, v = BigInt(idx[i]); words[w] |= (v << o) & 0xffffffffffffffffn; if (o + BigInt(bits) > 64n) words[w + 1] |= v >> (64n - o); }
  const lo = size.map((v) => (v < 0 ? v + 1 : 0));
  return gz(IO.writeNBT('', {
    MinecraftDataVersion: I(f.dv), Version: I(f.dv >= 3837 ? 7 : 6), SubVersion: I(1),
    Metadata: CO({ Name: S('Fixture lit'), Author: S('Arcosta_'), Description: S('negative region'), RegionCount: I(1), TotalVolume: I(total), TotalBlocks: I(f.blocks.length), TimeCreated: LG('1787592307013'), TimeModified: LG('1787592307013'), EnclosingSize: CO({ x: I(f.size[0]), y: I(f.size[1]), z: I(f.size[2]) }), PreviewImageData: IA([-1, 0x11223344, 7]) }),
    Regions: CO({ Main: CO({
      BlockStatePalette: comps(pal.map((st) => { const p = C.parse(st), k = Object.keys(p.props); return Object.assign({ Name: S(p.base) }, k.length ? { Properties: CO(Object.fromEntries(k.map((x) => [x, S(p.props[x])]))) } : {}); })),
      BlockStates: [12, words.map((w) => BigInt.asIntN(64, w).toString())],
      TileEntities: comps(f.be.map(([x, y, z, id, data]) => Object.assign({ z: I(z), x: I(x), id: S(id), y: I(y) }, data))),
      PendingBlockTicks: comps([{ Block: S('minecraft:comparator'), Priority: I(0), SubTick: LG('6369'), Time: I(11), x: I(2), y: I(0), z: I(3) }]),
      PendingFluidTicks: LS(0, []),
      Entities: comps(f.ents.map(([p, data]) => Object.assign({}, C.entShift(data, lo), { Pos: dbls(p.map((v, a) => v + lo[a])) }))),
      Position: CO({ x: I(pos[0]), y: I(pos[1]), z: I(pos[2]) }), Size: CO({ x: I(size[0]), y: I(size[1]), z: I(size[2]) }),
    }) }),
  }));
}

/* ---- comparing ---- */
const bytesEq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
/** A typed compound with keys sorted (so key order never counts, values and types do). */
function canon(t, v) {
  if (t === 10) { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = [v[k][0], canon(v[k][0], v[k][1])]; }); return o; }
  if (t === 9) return [v[0], v[1].map((x) => canon(v[0], x))];
  return v;
}
const cbytes = (c) => IO.tagBytes(10, canon(10, IO.safeC(c)));
const posKey = (x, y, z) => x + ',' + y + ',' + z;
/** A model's block entities by position. */
const beMap = (s) => new Map((s.be || []).map((b) => [posKey(b.x, b.y, b.z), b]));
function assertBE(f, s, label) {
  const m = beMap(s);
  assert.strictEqual(m.size, f.be.length, label + ': block entity count');
  f.be.forEach(([x, y, z, id, data]) => {
    const b = m.get(posKey(x, y, z));
    assert.ok(b, label + ': block entity at ' + posKey(x, y, z));
    assert.strictEqual(b.id, id, label + ': id at ' + posKey(x, y, z));
    if (data.Items) assert.ok(bytesEq(IO.tagBytes(9, IO.safe(9, data.Items[1])), IO.tagBytes(9, b.nbt.Items[1])), label + ': Items bytes at ' + posKey(x, y, z));
    assert.ok(bytesEq(cbytes(data), IO.tagBytes(10, canon(10, b.nbt))), label + ': all data of ' + id + ' at ' + posKey(x, y, z));
  });
}
const HANGK = ['TileX', 'TileY', 'TileZ', 'block_pos'];
function assertEnts(f, s, label) {
  assert.strictEqual((s.ents || []).length, f.ents.length, label + ': entity count');
  f.ents.forEach(([pos, data], i) => {
    const e = s.ents[i];
    assert.strictEqual(e.id, data.id[1], label + ': entity id ' + i);
    pos.forEach((v, a) => assert.ok(Math.abs(e.pos[a] - v) < 1e-9, label + ': ' + data.id[1] + ' position ' + e.pos + ' vs ' + pos));
    assert.ok(bytesEq(cbytes(data), IO.tagBytes(10, canon(10, Object.assign({ id: [8, e.id] }, e.nbt)))), label + ': all data of ' + data.id[1] + ' (incl. TileX/Y/Z, Facing, Rotation, Item)');
  });
}
function assertBlocks(f, s, label) {
  f.blocks.forEach(([x, y, z, st]) => assert.strictEqual(C.get(s, x, y, z), st, label + ': block state at ' + posKey(x, y, z)));
  assert.strictEqual(C.volume(s), f.blocks.length, label + ': block count');
}
const load = (bytes, name) => IO.load({ name, bytes });
async function reexport(s, fmt) {
  if (fmt === 'json') return load(new TextEncoder().encode(IO.toJSON(s)), 'x.json');
  return load(fmt === 'schem' ? await IO.toSchem(s) : await IO.toLitematic(s), 'x.' + fmt);
}

/* ---- tests ---- */
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const F_NEW = fixtureNew(), F_OLD = fixtureOld();
const NEG = { pos: [4, 0, 3], size: [-5, 3, -4] };            // Basti's file has this shape: Position at the high corner, x and z negative
const ROT = { pos: [0, 0, 3], size: [5, 3, -4] };             // a "rotated" variant: only z counts backwards
const SOURCES = [
  ['.schem v2 (WorldEdit, offset)', () => spongeV2(F_NEW, [100, 64, -40], [-2, 0, -1]), 'a.schem', F_NEW],
  ['.schem v3', () => spongeV3(F_NEW), 'b.schem', F_NEW],
  ['.schem v3, old item format', () => spongeV3(F_OLD), 'c.schem', F_OLD],
  ['.litematic, negative region', () => litematic(F_NEW, NEG.pos, NEG.size), 'd.litematic', F_NEW],
  ['.litematic, rotated variant', () => litematic(F_NEW, ROT.pos, ROT.size), 'e.litematic', F_NEW],
  ['.litematic, old item format', () => litematic(F_OLD, [0, 0, 0], F_OLD.size), 'f.litematic', F_OLD],
];
SOURCES.forEach(([label, make, file, f]) => {
  t(label + ': import keeps blocks, block entities and entities exactly', async () => {
    const s = await load(make(), file);
    assertBlocks(f, s, label); assertBE(f, s, label); assertEnts(f, s, label);
    assert.strictEqual(s.dv, f.dv, 'data version kept');
  });
  ['schem', 'litematic', 'json'].forEach((fmt) => t(label + ' -> ' + fmt + ': no-op export keeps everything (same world positions)', async () => {
    const s = await reexport(await load(make(), file), fmt);
    assertBlocks(f, s, fmt); assertBE(f, s, fmt); assertEnts(f, s, fmt);
    assert.strictEqual(s.dv, f.dv, 'data version follows the item format');
  }));
  t(label + ': swapped export keeps every block entity and the orientation of swapped blocks', async () => {
    const s0 = await load(make(), file);
    const sw = f === F_NEW
      ? { 'minecraft:oak_wall_sign': 'minecraft:spruce_wall_sign', 'minecraft:red_shulker_box': 'minecraft:lime_shulker_box', 'minecraft:red_banner': 'minecraft:blue_banner', 'minecraft:oak_door': 'minecraft:cherry_door', 'minecraft:oak_stairs': 'minecraft:birch_stairs', 'minecraft:spruce_trapdoor': 'minecraft:acacia_trapdoor', 'minecraft:stone': 'minecraft:andesite', 'minecraft:red_bed': 'minecraft:cyan_bed', 'minecraft:oak_hanging_sign': 'minecraft:pale_oak_hanging_sign' }
      : { 'minecraft:spruce_wall_sign': 'minecraft:oak_wall_sign', 'minecraft:white_shulker_box': 'minecraft:black_shulker_box', 'minecraft:stone_bricks': 'minecraft:deepslate_bricks' };
    const s1 = C.applySwaps(s0, sw);
    assert.ok(!s1.beLost, 'nothing dropped');
    for (const fmt of ['schem', 'litematic']) {
      const s = await reexport(s1, fmt);
      const fx = Object.assign({}, f, { blocks: f.blocks.map(([x, y, z, st]) => { const p = C.parse(st), to = sw[p.base]; return [x, y, z, to ? C.stateOf(to, p.props) : st]; }) });
      assertBlocks(fx, s, 'swapped ' + fmt); assertBE(f, s, 'swapped ' + fmt); assertEnts(f, s, 'swapped ' + fmt);
    }
  });
});
t('.schem v2 -> .schem keeps Offset, WEOffset (the paste origin), Metadata and the WorldEdit entity frame', async () => {
  const src = spongeV2(F_NEW, [100, 64, -40], [-2, 0, -1]);
  const out = gunz(await IO.toSchem(await load(src, 'a.schem')));
  const a = IO.readNBT(gunz(src), true).value, b = IO.readNBT(out, true).value;
  assert.deepStrictEqual(Array.from(b.Offset[1]), [100, 64, -40]);
  ['WEOffsetX', 'WEOffsetY', 'WEOffsetZ', 'Author', 'Date', 'RequiredMods'].forEach((k) => assert.ok(bytesEq(IO.tagBytes(...a.Metadata[1][k]), IO.tagBytes(...b.Metadata[1][k])), k));
  // the entity list comes back byte for byte (key order aside), in world coordinates as WorldEdit wrote it
  a.Entities[1][1].forEach((e, i) => assert.ok(bytesEq(IO.tagBytes(10, canon(10, e)), IO.tagBytes(10, canon(10, b.Entities[1][1][i]))), 'entity ' + i));
  a.BlockEntities[1][1].forEach((e, i) => assert.ok(bytesEq(IO.tagBytes(10, canon(10, IO.safeC(e))), IO.tagBytes(10, canon(10, IO.safeC(b.BlockEntities[1][1][i])))), 'block entity ' + i));
});
[['negative', NEG], ['rotated', ROT]].forEach(([n, R]) => t('.litematic (' + n + ' region) -> .litematic: the whole file comes back, only TimeModified changes', async () => {
  const src = litematic(F_NEW, R.pos, R.size);
  const out = gunz(await IO.toLitematic(await load(src, 'd.litematic')));
  const a = IO.readNBT(gunz(src), true).value, b = IO.readNBT(out, true).value;
  const strip = (r) => { const m = Object.assign({}, r.Metadata[1]); delete m.TimeModified; return [r.MinecraftDataVersion, r.Version, r.SubVersion, m]; };
  assert.ok(bytesEq(IO.tagBytes(10, canon(10, IO.safeC(strip(a)[3]))), IO.tagBytes(10, canon(10, IO.safeC(strip(b)[3])))), 'metadata (author, description, dates, preview image)');
  [0, 1, 2].forEach((i) => assert.deepStrictEqual(strip(b)[i], strip(a)[i]));
  const ra = a.Regions[1].Main[1], rb = b.Regions[1].Main[1];
  assert.ok(rb, 'region name kept');
  Object.keys(ra).forEach((k) => assert.ok(bytesEq(IO.tagBytes(...[ra[k][0], k === 'BlockStates' ? ra[k][1] : canon(ra[k][0], IO.safe(ra[k][0], ra[k][1]))]), IO.tagBytes(...[rb[k][0], k === 'BlockStates' ? rb[k][1] : canon(rb[k][0], IO.safe(rb[k][0], rb[k][1]))])), 'region ' + k + ' identical'));
}));
t('.litematic <-> .schem: entities and block entities land on the same world spot', async () => {
  const s = await load(litematic(F_NEW, NEG.pos, NEG.size), 'd.litematic');
  const viaSchem = await reexport(s, 'schem'), back = await reexport(viaSchem, 'litematic');
  [viaSchem, back].forEach((x, i) => { assertBE(F_NEW, x, 'conv ' + i); assertEnts(F_NEW, x, 'conv ' + i); assertBlocks(F_NEW, x, 'conv ' + i); });
  // .schem -> .litematic writes one positive region at 0 0 0: Litematica pastes it from the same lowest corner
  const r = IO.readNBT(gunz(await IO.toLitematic(await load(spongeV2(F_NEW, [5, 6, 7], [0, 0, 0]), 'a.schem'))), true).value.Regions[1];
  const reg = Object.values(r)[0][1];
  assert.deepStrictEqual([reg.Size[1].x[1], reg.Size[1].y[1], reg.Size[1].z[1]], F_NEW.size);
  const fr = reg.Entities[1][1][0];
  assert.deepStrictEqual(fr.Pos[1][1], F_NEW.ents[0][0], 'item frame Pos relative to the region');
  assert.deepStrictEqual([fr.TileX[1], fr.TileY[1], fr.TileZ[1]], [1, 1, 3], 'item frame TileX/Y/Z in the same frame');
});
t('the paste origin maps across: WorldEdit WEOffset <-> Litematica region Position (lowest corner from the origin)', async () => {
  const lit = IO.readNBT(gunz(await IO.toLitematic(await load(spongeV2(F_NEW, [100, 64, -40], [-2, 0, -1]), 'a.schem'))), true).value;
  const reg = Object.values(lit.Regions[1])[0][1];
  assert.deepStrictEqual([reg.Position[1].x[1], reg.Position[1].y[1], reg.Position[1].z[1]], [-2, 0, -1]);
  const sch = IO.readNBT(gunz(await IO.toSchem(await load(litematic(F_NEW, [10, 2, -5], F_NEW.size), 'h.litematic'))), true).value;
  assert.deepStrictEqual([sch.Metadata[1].WEOffsetX[1], sch.Metadata[1].WEOffsetY[1], sch.Metadata[1].WEOffsetZ[1]], [10, 2, -5]);
  const neg = IO.readNBT(gunz(await IO.toSchem(await load(litematic(F_NEW, [7, 1, 9], NEG.size), 'i.litematic'))), true).value;
  assert.deepStrictEqual([neg.Metadata[1].WEOffsetX[1], neg.Metadata[1].WEOffsetY[1], neg.Metadata[1].WEOffsetZ[1]], [3, 1, 6], 'negative region: its lowest corner');
});
t('.litematic ticks survive .litematic export; .schem has no place for them', async () => {
  const s = await load(litematic(F_NEW, NEG.pos, NEG.size), 'd.litematic');
  assert.strictEqual(s.ticks.block.length, 1);
  const b = await reexport(s, 'litematic');
  assert.deepStrictEqual([b.ticks.block[0].x, b.ticks.block[0].y, b.ticks.block[0].z], [2, 0, 3]);
});
t('cropping empty space moves block entities, entities and the paste origin with the blocks', async () => {
  const f = { dv: NEW_DV, size: [6, 3, 4], blocks: F_NEW.blocks.map(([x, y, z, st]) => [x + 1, y, z, st]), be: F_NEW.be.map(([x, y, z, id, d]) => [x + 1, y, z, id, d]), ents: F_NEW.ents.map(([p, d]) => [[p[0] + 1, p[1], p[2]], C.entShift(d, [1, 0, 0])]) };
  const s = await load(spongeV2(f, [10, 0, 0], [-3, 0, 0]), 'g.schem');
  assert.deepStrictEqual(Array.from(s.size), [5, 3, 4], 'cropped');
  assert.deepStrictEqual(Array.from(s.origin), [1, 0, 0]);
  assertBE(F_NEW, s, 'cropped'); assertEnts(F_NEW, s, 'cropped');
  const b = IO.readNBT(gunz(await IO.toSchem(s)), true).value;
  assert.deepStrictEqual(Array.from(b.Offset[1]), [11, 0, 0], 'Offset follows the crop');
  assert.strictEqual(b.Metadata[1].WEOffsetX[1], -2, 'paste origin stays in the same world spot');
});
t('a swap that changes a block holding data drops it and lists it (the downloads warn)', () => {
  const s = C.fromFunction([2, 1, 1], (x) => (x ? 'minecraft:stone' : 'minecraft:oak_wall_sign[facing=north,waterlogged=false]'), 'T');
  s.be = [{ x: 0, y: 0, z: 0, id: 'minecraft:sign', nbt: {} }, { x: 1, y: 0, z: 0, id: 'minecraft:chest', nbt: {} }];
  const o = C.applySwaps(s, { 'minecraft:oak_wall_sign': 'minecraft:birch_wall_sign', 'minecraft:stone': 'minecraft:andesite' });
  assert.strictEqual(o.be.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(o.beLost)), [{ x: 1, y: 0, z: 0, id: 'minecraft:chest', from: 'minecraft:stone', to: 'minecraft:andesite' }]);
  assert.ok(!C.canSwap('minecraft:chiseled_bookshelf', 'minecraft:stone'), 'blocks that hold things never swap into plain cubes');
});
t('summary: containers, stacks, nested shulkers, signs and the other kinds', async () => {
  const s = await load(litematic(F_NEW, NEG.pos, NEG.size), 'd.litematic');
  const m = C.extrasSummary(s);
  assert.strictEqual(m.containers, 8, 'chest, barrel, hopper, lectern, pot, jukebox, campfire, shulker box');
  const by = Object.fromEntries(m.items.map((x) => [x.id, x]));
  assert.strictEqual(by['minecraft:diamond'].n, 64, 'a shulker inside a shulker inside a chest');
  assert.strictEqual(by['minecraft:diamond'].nested, 64);
  assert.strictEqual(by['minecraft:arrow'].n, 16, 'bundle contents');
  assert.strictEqual(by['minecraft:clock'].n, 1, 'framed item');
  assert.ok(by['minecraft:diamond_sword'].ench && by['minecraft:diamond_sword'].names[0] === 'Biter');
  assert.deepStrictEqual(Array.from(m.signs, (x) => x.front[0]), ['Storage', 'Shop']);
  assert.ok(m.signs[0].glow && m.signs[0].waxed);
  const k = Object.fromEntries(m.kinds.map((x) => [x.label, x.n]));
  ['Signs', 'Hanging signs', 'Banners', 'Heads', 'Spawners', 'Command blocks', 'Beacons', 'Bee nests and hives', 'End gateways', 'Comparators'].forEach((l) => assert.strictEqual(k[l], 1, l));
  assert.strictEqual(k.Beds, 2);
  const e = Object.fromEntries(m.ents.map((x) => [x.label, x.n]));
  assert.deepStrictEqual(e, { 'Item frames': 1, 'Glow item frames': 1, Paintings: 1, 'Armor stands': 1, 'Minecarts with chests': 1 });
  const o = C.extrasSummary(await load(spongeV3(F_OLD), 'c.schem'));
  assert.deepStrictEqual(Array.from(o.signs[0].front.slice(0, 2)), ['Old sign', 'line two'], 'JSON sign lines read as text');
  assert.strictEqual(Object.fromEntries(o.items.map((x) => [x.id, x.n]))['minecraft:gold_block'], 64, 'old-format shulker contents');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.frontOf(s))), { facing: 'east', by: 'door', n: 1 });
});
t('saved state round trip (extrasOf / setExtras through JSON)', async () => {
  const s = await load(litematic(F_NEW, NEG.pos, NEG.size), 'd.litematic');
  const x = JSON.parse(JSON.stringify(C.extrasOf(s)));
  const o = C.setExtras(C.clone(Object.assign({}, s, { be: null, ents: null, ticks: null, src: null, dv: null })), x);
  assertBE(F_NEW, o, 'restored'); assertEnts(F_NEW, o, 'restored');
  const b = IO.readNBT(gunz(await IO.toLitematic(o)), true).value;
  assert.deepStrictEqual([b.Regions[1].Main[1].Size[1].x[1], b.Regions[1].Main[1].Size[1].z[1]], [-5, -4], 'negative size kept after a reload');
});

/* ---- Basti's real files (only on his machine) ---- */
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const REAL = path.join(HOME, 'Downloads', '63 Chorus Farm.litematic');
const REAL_X = path.join(HOME, 'AppData', 'Roaming', 'ModrinthApp', 'profiles', 'Craft Attack 14 1.1', 'schematics', 'chorus farm');
t('real file: 63 Chorus Farm.litematic round-trips with only TimeModified changed', async () => {
  if (!fs.existsSync(REAL)) return 'skip';
  const src = new Uint8Array(fs.readFileSync(REAL));
  const s = await load(src, '63 Chorus Farm.litematic');
  assert.strictEqual(s.be.length, 47); assert.strictEqual(s.ents.length, 4); assert.strictEqual(s.ticks.block.length, 1);
  const a = IO.readNBT(gunz(src), true).value, b = IO.readNBT(gunz(await IO.toLitematic(s)), true).value;
  delete a.Metadata[1].TimeModified; delete b.Metadata[1].TimeModified;
  assert.ok(bytesEq(IO.tagBytes(10, canon(10, IO.safeC(a))), IO.tagBytes(10, canon(10, IO.safeC(b)))), 'whole file identical (key order aside)');
  // and through .schem and back: every block entity and entity at the same spot, same data
  const back = await reexport(await reexport(s, 'schem'), 'litematic');
  const j = (x) => JSON.stringify({ be: x.be, ents: x.ents });
  assert.strictEqual(j(back), j(s));
});
t('real files: the old exports of Builds had lost everything (documents the bug)', async () => {
  const f = path.join(REAL_X, '63-chorus-farm-custom.litematic'), g = path.join(REAL_X, '63-chorus-farm-custom.schem');
  if (!fs.existsSync(f) || !fs.existsSync(g)) return 'skip';
  for (const p of [f, g]) { const s = await load(new Uint8Array(fs.readFileSync(p)), path.basename(p)); assert.strictEqual((s.be || []).length + (s.ents || []).length, 0); }
});

// node tools/test-containers.js --write <dir>: write the fixture files (to try them in the app) instead of testing
const wi = process.argv.indexOf('--write');
if (wi > 0) {
  const dir = process.argv[wi + 1];
  fs.mkdirSync(dir, { recursive: true });
  SOURCES.forEach(([label, make, file]) => fs.writeFileSync(path.join(dir, 'fixture-' + file), make()));
  console.log('wrote ' + SOURCES.length + ' fixtures to ' + dir);
  return;
}
(async () => {
  let ok = 0, skip = 0;
  for (const [name, fn] of tests) {
    try { const r = await fn(); if (r === 'skip') { skip++; console.log('  skip ' + name + ' (file not on this machine)'); } else ok++; }
    catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
  }
  const failed = tests.length - ok - skip;
  console.log((failed ? 'FAILED ' : 'ok ') + ok + '/' + (tests.length - skip) + ' container tests passed' + (skip ? ', ' + skip + ' skipped' : ''));
  process.exit(failed ? 1 : 0);
})();
