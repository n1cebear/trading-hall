// Tests for the Builds Create tools: generators (js/modules/builds-gen.js), the detail toolkit (builds-detail.js), the
// 3D rotation (builds-rotate.js), the light shading (builds-shade.js) and the quick editor model (builds-edit.js).
//   node tools/test-shapes.js        (-v prints every generator and variant with its size and blocks)
// Runs in a VM with the game's block database (26.3) and the block colour table (js/data/block-colours.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

// the modules run in this process's own global scope (not a vm context: every global lookup through a contextified
// sandbox is slow, and the generators make millions of them)
global.window = global;
global.TH = { data: {}, langData: {}, icon: () => null };
for (const f of ['js/data/block-db.js', 'js/data/block-colours.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js', 'js/modules/builds-view.js', 'js/modules/builds-shapes.js',
  'js/modules/builds-detail.js', 'js/modules/builds-rotate.js', 'js/modules/builds-shade.js', 'js/modules/builds-gen.js', 'js/modules/builds-edit.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const TH = global.TH, C = TH.builds.core, IO = TH.builds.io, G = TH.builds.gen, D = TH.builds.detail, R = TH.builds.rotate, SH = TH.builds.shade, E = TH.builds.edit, DB = TH.data.blockDb.b;

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const plain = (v) => JSON.parse(JSON.stringify(v));
const nameOf = (id) => C.parse(id).name;
const report = [];

/* ---------------- helpers ---------------- */
/** Every palette state is a real block with valid states for the kinds we place. */
function validStates(s, label) {
  s.palette.slice(1).forEach((id) => {
    const p = C.parse(id), n = p.name, d = C.def(id), pr = p.props;
    assert.ok(DB[n], label + ': ' + n + ' is a 26.3 block');
    if (d.shape === 'stairs') { assert.ok(['north', 'south', 'east', 'west'].includes(pr.facing) && ['top', 'bottom'].includes(pr.half) && pr.shape, label + ': stairs state ' + id); }
    if (d.shape === 'slab') assert.ok(['top', 'bottom', 'double'].includes(pr.type), label + ': slab state ' + id);
    if (d.shape === 'wall') ['north', 'south', 'east', 'west'].forEach((k) => assert.ok(['none', 'low', 'tall'].includes(pr[k]), label + ': wall side ' + id));
    if (/(_pane|_bars)$/.test(n)) ['north', 'south', 'east', 'west'].forEach((k) => assert.ok(['true', 'false'].includes(pr[k]), label + ': pane side ' + id));
    if (/_trapdoor$/.test(n)) assert.ok(pr.facing && pr.half && pr.open, label + ': trapdoor state ' + id);
    if (n === 'pointed_dripstone') assert.ok(['tip', 'frustum', 'middle', 'base', 'tip_merge'].includes(pr.thickness) && ['up', 'down'].includes(pr.vertical_direction), label + ': dripstone ' + id);
    if (/amethyst_(cluster|bud)$/.test(n) || n === 'end_rod') assert.ok(['up', 'down', 'north', 'south', 'east', 'west'].includes(pr.facing), label + ': facing ' + id);
    if (/candle$/.test(n)) assert.ok(+pr.candles >= 1 && +pr.candles <= 4, label + ': candles ' + id);
    if (n === 'snow') assert.ok(+pr.layers >= 1 && +pr.layers <= 8, label + ': layers ' + id);
  });
}
/** Connected pieces (6 neighbours) of the non-air cells (thin blocks count). */
function pieces(s) {
  const [sx, sy, sz] = s.size, seen = new Uint8Array(sx * sy * sz), out = [];
  for (let i0 = 0; i0 < s.blocks.length; i0++) {
    if (!s.blocks[i0] || seen[i0]) continue;
    let k = 0; const st = [i0]; seen[i0] = 1;
    while (st.length) {
      const i = st.pop(), x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz)); k++;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= sx || Y >= sy || Z >= sz) continue;
        const j = (Y * sz + Z) * sx + X;
        if (s.blocks[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    out.push(k);
  }
  return out.sort((a, b) => b - a);
}
/** Empty cells that air from outside the box cannot reach (holes inside a closed shape). */
function enclosed(s, solidOnly) {
  const [sx, sy, sz] = s.size, X = sx + 2, Y = sy + 2, Z = sz + 2, seen = new Uint8Array(X * Y * Z);
  const solid = s.palette.map((id, i) => i > 0 && (!solidOnly || !D.isThin(id)));
  const full = (x, y, z) => x >= 1 && y >= 1 && z >= 1 && x <= sx && y <= sy && z <= sz && solid[s.blocks[((y - 1) * sz + (z - 1)) * sx + (x - 1)]];
  const st = [0]; seen[0] = 1;
  while (st.length) {
    const i = st.pop(), x = i % X, z = Math.floor(i / X) % Z, y = Math.floor(i / (X * Z));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (a < 0 || b < 0 || c < 0 || a >= X || b >= Y || c >= Z) continue;
      const j = (b * Z + c) * X + a;
      if (!seen[j] && !full(a, b, c)) { seen[j] = 1; st.push(j); }
    }
  }
  let n = 0;
  for (let y = 1; y <= sy; y++) for (let z = 1; z <= sz; z++) for (let x = 1; x <= sx; x++) if (!seen[(y * Z + z) * X + x] && !full(x, y, z)) n++;
  return n;
}
const countMap = (s) => Object.fromEntries(C.counts(s).map((x) => [x.id, x.n]));
const sameBlocks = (a, b) => a.size.join() === b.size.join() && a.blocks.every((v, i) => a.palette[v] === b.palette[b.blocks[i]] || (!v && !b.blocks[i]));

/* ======================================================================
 * Generators
 * ====================================================================== */
const FLOAT = new Set(['shard', 'floating', 'bipyramid', 'alignment', 'henge', 'dolmen', 'broken', 'cluster', 'spire', 'totem', 'rock', 'crater', 'waterfall', 'mushroom', 'ziggurat', 'helix', 'stepped', 'split', 'obelisk', 'geode', 'volcano', 'mountain']);
const CRYSTAL_ONE_PIECE = ['crystal', 'quartz2', 'prism', 'spire', 'cluster', 'geode'];
t('every generator has a group, palettes, parameters with unique ids, and its variants are valid', () => {
  assert.ok(G.FAMILIES.length >= 30, G.FAMILIES.length + ' generators');
  const groups = new Set(G.GROUPS.map((g) => g[0]));
  const mono = G.FAMILIES.filter((f) => f.group === 'monoliths');
  assert.ok(mono.length >= 13, mono.length + ' monoliths');
  assert.ok(mono.reduce((n, f) => n + (f.variants || []).length, 0) >= 30, 'monolith variants');
  for (const f of G.FAMILIES) {
    assert.ok(groups.has(f.group), f.id + ' group');
    const ids = G.params(f.id).map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length, f.id + ' has duplicate parameter ids: ' + ids.filter((x, i) => ids.indexOf(x) !== i));
    f.pals.forEach((k) => assert.ok(G.PALETTES[k], f.id + ' palette ' + k));
    (f.variants || []).forEach(([label, patch]) => Object.keys(patch).forEach((k) => assert.ok(ids.includes(k), f.id + ' variant ' + label + ' sets unknown ' + k)));
    for (const q of G.params(f.id)) if (q.t === 'seg') assert.ok(q.ch.some((c) => c[0] === q.def) || q.def === 'palette', f.id + '.' + q.id + ' default');
  }
  // every palette block is real
  Object.entries(G.PALETTES).forEach(([k, pal]) => ['body', 'base', 'trim', 'accent', 'worn'].forEach((part) => (pal[part] || []).forEach((n) => assert.ok(DB[n], k + '.' + part + ' ' + n))));
});
for (const f of G.FAMILIES) {
  t(f.id + ': defaults and variants build valid blocks within the size', () => {
    for (const [label, patch] of [['default', {}]].concat(f.variants || [])) {
      const p = G.clean(f.id, patch), s = G.gen(f.id, patch);
      assert.ok(C.volume(s) > 20, label + ': has blocks');
      validStates(s, f.id + ' ' + label);
      assert.ok(s.size[1] <= Math.ceil(p.h * p.scale / 100) + 10, f.id + ' ' + label + ': height ' + s.size[1] + ' for ' + p.h);
      report.push([f.id, label, s.size.join(' x '), C.volume(s), C.counts(s, true).slice(0, 4).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
    }
  });
}
t('the same seed gives the same build, another seed another one', () => {
  for (const id of ['cluster', 'shard', 'henge', 'rock', 'mountain']) {
    const a = G.gen(id, { seed: 7 }), b = G.gen(id, { seed: 7 }), c = G.gen(id, { seed: 8 });
    assert.ok(sameBlocks(a, b), id + ' repeats');
    assert.ok(!sameBlocks(a, c), id + ' changes with the seed');
  }
});
t('crystals are one connected piece (floating shards may float by design)', () => {
  for (const id of CRYSTAL_ONE_PIECE) {
    for (const patch of [{}, { detail: 'low' }, { detail: 'high' }, { lean: 30 }]) {
      const s = G.gen(id, patch), pc = pieces(s);
      assert.strictEqual(pc.length, 1, id + ' ' + JSON.stringify(patch) + ': ' + pc.length + ' pieces (' + pc.slice(0, 5).join(', ') + ')');
    }
  }
});
t('size options are respected: height and footprint follow width / depth / height and scale', () => {
  for (const [id, w, d, h, tol] of [['crystal', 10, 10, 40, 3], ['prism', 9, 9, 30, 1], ['slab', 4, 1, 9, 0], ['obelisk', 6, 6, 50, 3], ['totem', 7, 7, 30, 1]]) {
    const s = G.gen(id, { w, d, h, tipStyle: 'none', detail: 'low' });
    assert.ok(s.size[1] <= h + 1 && s.size[1] >= h - tol, id + ' height ' + s.size[1] + ' / ' + h + ' (a point thinner than a block is not filled)');
    assert.ok(s.size[0] <= w + 2 && s.size[2] <= d + 2, id + ' footprint ' + s.size);
  }
  const big = G.gen('crystal', { h: 200, w: 16, d: 16 });
  assert.ok(big.size[1] >= 190 && big.size[1] <= 204, 'a 200-tall crystal: ' + big.size[1]);
  const half = G.gen('prism', { h: 40, scale: 50 });
  assert.ok(Math.abs(half.size[1] - 20) <= 1, 'scale 50% halves the height: ' + half.size[1]);
  const slab = G.gen('slab', { w: 4, d: 1, h: 9 });
  assert.deepStrictEqual(plain(slab.size), [4, 9, 1], 'the 1 : 4 : 9 slab is exactly 4 x 9 x 1');
  assert.strictEqual(C.volume(slab), 36);
});
t('symmetric shapes stay symmetric (slab monolith, square prism, ziggurat)', () => {
  for (const [id, patch] of [['slab', { w: 6, d: 2, h: 12 }], ['prism', { facets: 4, w: 9, d: 9, edges: false }], ['ziggurat', { w: 21, d: 21, stairs: false, temple: false }]]) {
    // the shape (the blocks follow a dithered gradient, so they are compared as one block)
    const g = G.gen(id, Object.assign({ detail: 'low' }, patch)), s = C.fromFunction(g.size, (x, y, z) => (g.blocks[(y * g.size[2] + z) * g.size[0] + x] ? 'minecraft:stone' : null), 'occ');
    const r = TH.builds.sym.check(s, [{ axis: 0, m: TH.builds.sym.centre(s, 0) }, { axis: 2, m: TH.builds.sym.centre(s, 2) }]);
    assert.strictEqual(r.diff, 0, id + ': ' + r.diff + ' blocks without a mirrored twin');
  }
});
t('hollow keeps a closed wall of the chosen thickness', () => {
  const solid = G.gen('crystal', { h: 30, w: 12, d: 12, detail: 'low', tipStyle: 'none' }), hol = G.gen('crystal', { h: 30, w: 12, d: 12, detail: 'low', hollow: true, thick: 1, tipStyle: 'none' });
  assert.ok(C.volume(hol) < C.volume(solid) * 0.6, 'hollow has far fewer blocks');
  assert.ok(enclosed(hol, true) > 50, 'with a closed space inside');
  const h2 = G.gen('crystal', { h: 30, w: 12, d: 12, detail: 'low', hollow: true, thick: 2, tipStyle: 'none' });
  assert.ok(C.volume(h2) > C.volume(hol), 'a 2-thick wall has more blocks');
});
t('detail levels: low = full blocks, medium adds stairs / slabs, high may add walls and trapdoors; parts can be left out', () => {
  const low = G.gen('bipyramid', { detail: 'low' }), med = G.gen('bipyramid', { detail: 'medium' });
  assert.ok(low.palette.slice(1).every((id) => C.def(id).shape === 'cube' || D.isThin(id)), 'low: only cubes (and the tip)');
  assert.ok(med.palette.some((id) => /_(stairs|slab)\[/.test(id)), 'medium: stairs or slabs');
  const noStairs = G.gen('bipyramid', { detail: 'medium', off: ['stairs'] });
  assert.ok(!noStairs.palette.some((id) => /_stairs\[/.test(id)), 'stairs switched off');
  const tip = G.gen('spire', { detail: 'high', tipStyle: 'dripstone', tipLen: 4 });
  assert.ok(tip.palette.some((id) => /pointed_dripstone.*thickness=tip/.test(id)), 'a dripstone tip');
  const needle = G.gen('crystal', { tipStyle: 'needle', tipLen: 3 });
  assert.ok(needle.palette.some((id) => /end_rod/.test(id)) && needle.palette.some((id) => /lightning_rod/.test(id)), 'needle tip: rod parts');
  // the top block is the thinnest part: the end rod sits above everything else in its column
  const [sx, sy, sz] = needle.size;
  let top = null;
  for (let y = sy - 1; y >= 0 && !top; y--) for (let z = 0; z < sz && !top; z++) for (let x = 0; x < sx; x++) if (needle.blocks[(y * sz + z) * sx + x]) { top = C.get(needle, x, y, z); break; }
  assert.ok(/end_rod/.test(top), 'the highest block is the end rod: ' + top);
});
t('glow patterns place glowing blocks; magma sits behind glass; decorations at high detail', () => {
  for (const g of ['edges', 'veins', 'core', 'rings', 'runes', 'speckles']) {
    const s = G.gen('obelisk', { glow: g, glowAmt: 80, glowBlock: 'sea_lantern', h: 40 });
    assert.ok(C.counts(s, true).some((r) => nameOf(r.id) === 'sea_lantern'), g + ': sea lanterns');
  }
  const m = G.gen('split', { pal: 'basalt', glowBlock: 'magma', glow: 'veins', glowAmt: 90 });
  assert.ok(m.palette.some((id) => nameOf(id) === 'magma_block') && m.palette.some((id) => /orange_stained_glass/.test(id)), 'magma behind glass');
  const am = G.gen('crystal', { glow: 'speckles', glowAmt: 100, glowBlock: 'amethyst', detail: 'max' });
  assert.ok(am.palette.some((id) => /amethyst_cluster\[/.test(id)), 'amethyst clusters on the glowing blocks');
});
t('surface: weathering, moss with vines, cracks change blocks deterministically', () => {
  const base = G.gen('obelisk', { pal: 'stone', h: 40, detail: 'low' }), w = G.gen('obelisk', { pal: 'stone', h: 40, weather: 80, moss: 90, cracks: 50, detail: 'low' });
  assert.ok(w.palette.some((id) => nameOf(id) === 'moss_block'), 'moss');
  assert.ok(G.gen('obelisk', { pal: 'stone', h: 40, moss: 90 }).palette.some((id) => /moss/.test(id)), 'moss in medium detail too (as mossy parts)');
  assert.ok(w.palette.some((id) => /cracked/.test(id) || /mossy_cobblestone|cobblestone/.test(id)), 'worn and cracked');
  assert.ok(w.palette.some((id) => /vine\[/.test(id)), 'vines hang down from 60% moss');
  assert.ok(!sameBlocks(base, w));
  assert.ok(sameBlocks(w, G.gen('obelisk', { pal: 'stone', h: 40, weather: 80, moss: 90, cracks: 50, detail: 'low' })), 'repeatable');
});
t('the angle parameter turns a generated build in 3D; 0 0 0 is the plain build', () => {
  const a = G.gen('slab', { w: 6, d: 2, h: 12, detail: 'low' }), b = G.gen('slab', { w: 6, d: 2, h: 12, detail: 'low', ay: 90 });
  assert.deepStrictEqual(plain(b.size), [2, 12, 6], 'yaw 90 swaps width and depth');
  assert.strictEqual(C.volume(a), C.volume(b));
  const c = G.gen('slab', { w: 6, d: 2, h: 12, detail: 'low', ax: 90 });
  assert.deepStrictEqual(plain(c.size), [6, 2, 12], 'pitch 90 lays it down');
  const d45 = G.gen('crystal', { ay: 45, ax: 22.5 });
  assert.strictEqual(pieces(d45).length, 1, 'a tilted crystal is still one piece');
});
t('light: the generator can shade by a light direction and colour', () => {
  const s = G.gen('crystal', { light: true, lAz: 90, lEl: 0, lDither: 0, lRamp: 'stone' });
  assert.ok(s.palette.some((id) => nameOf(id) === 'calcite') && s.palette.some((id) => /deepslate/.test(id)), 'the stone ramp from dark to light');
});

/* ======================================================================
 * Detail toolkit
 * ====================================================================== */
t('variants: stairs / slabs / walls / panes / trapdoors exist and are of the right shape', () => {
  const cases = [['stone_bricks', 'stairs', 'stone_brick_stairs'], ['oak_planks', 'slab', 'oak_slab'], ['quartz_block', 'stairs', 'quartz_stairs'], ['purple_stained_glass', 'pane', 'purple_stained_glass_pane'], ['oak_planks', 'trapdoor', 'oak_trapdoor'], ['tuff_bricks', 'wall', 'tuff_brick_wall'], ['iron_block', 'bars', 'iron_bars'], ['purple_wool', 'carpet', 'purple_carpet']];
  for (const [b, k, want] of cases) assert.strictEqual(D.variant(b, k), 'minecraft:' + want, b + ' ' + k);
  assert.strictEqual(D.variant('glass', 'stairs'), null, 'glass has no stairs');
  for (const n of Object.keys(DB).filter((n) => C.def('minecraft:' + n).shape === 'cube').slice(0, 600)) for (const k of ['stairs', 'slab', 'wall']) { const v = D.variant(n, k); if (v) assert.strictEqual(C.def(v).shape, k, n + ' ' + k + ' -> ' + v); }
});
t('choose: the coverage picks full, empty, slab, stairs, trapdoor or wall', () => {
  const M = D.MASK, o = { block: 'minecraft:stone_bricks', allow: D.allowed('high') };
  assert.strictEqual(D.choose(D.FULL, o), 'minecraft:stone_bricks');
  assert.strictEqual(D.choose(D.EMPTY, o), null);
  assert.match(D.choose(M.slab_bottom, o), /stone_brick_slab\[type=bottom/);
  assert.match(D.choose(M.slab_top, o), /stone_brick_slab\[type=top/);
  assert.match(D.choose(M.stairs_bottom_north, o), /stone_brick_stairs\[facing=north,half=bottom/);
  assert.match(D.choose(M.stairs_top_east, o), /stone_brick_stairs\[facing=east,half=top/);
  assert.match(D.choose(M.wall, o), /stone_brick_wall/);
  assert.match(D.choose(M.td_bottom, { block: 'minecraft:oak_planks', allow: D.allowed('high') }), /oak_trapdoor\[.*half=bottom/);
  assert.strictEqual(D.choose(M.slab_bottom, { block: 'minecraft:stone_bricks', allow: D.allowed('low') }), 'minecraft:stone_bricks', 'low: half full stays a block');
  // a vertical diagonal cut (no block can show it) stays a block or air, never a stair
  const diag = D.mk((x, y, z) => x + z < 4);
  assert.ok(!/stairs/.test(D.choose(diag, o) || ''), 'diagonal: ' + D.choose(diag, o));
  // the fallback: amethyst has no stairs of its own
  assert.match(D.choose(M.stairs_bottom_west, { block: 'minecraft:amethyst_block', allow: D.allowed('medium'), fallback: { stairs: 'minecraft:purpur_stairs' } }), /purpur_stairs/);
});
t('connect: panes, bars, fences and walls take their neighbours; every state is complete', () => {
  const s = C.create(3, 1, 1, 'x');
  C.set(s, 0, 0, 0, 'minecraft:stone'); C.set(s, 1, 0, 0, 'minecraft:glass_pane'); C.set(s, 2, 0, 0, 'minecraft:glass_pane');
  D.connect(s);
  assert.match(C.get(s, 1, 0, 0), /east=true.*north=false.*south=false.*west=true/);
  assert.match(C.get(s, 2, 0, 0), /west=true/);
  const w = C.create(1, 2, 3, 'w');
  ['minecraft:cobblestone_wall', 'minecraft:cobblestone_wall', 'minecraft:cobblestone_wall'].forEach((id, z) => C.set(w, 0, 0, z, id));
  C.set(w, 0, 1, 1, 'minecraft:stone');
  D.connect(w);
  assert.match(C.get(w, 0, 0, 1), /north=tall.*south=tall/, 'a block above makes the sides tall: ' + C.get(w, 0, 0, 1));
  assert.match(C.get(w, 0, 0, 0), /south=low/);
  for (const id of ['minecraft:oak_stairs', 'minecraft:stone_slab', 'minecraft:oak_trapdoor', 'minecraft:candle', 'minecraft:end_rod', 'minecraft:iron_chain', 'minecraft:pointed_dripstone']) assert.ok(C.parse(D.complete(id)).props && Object.keys(C.parse(D.complete(id)).props).length >= 1, id);
});
t('tip stacks get thinner to the top and only use real blocks', () => {
  for (const [st] of D.TIP_STYLES) {
    const seq = D.tipStack(st, 4, 'minecraft:stone_bricks', 'minecraft:glass');
    seq.forEach((id) => assert.ok(DB[nameOf(id)], st + ' ' + id));
    if (st !== 'none') assert.ok(seq.length >= 1, st);
  }
  assert.deepStrictEqual(plain(D.tipStack('dripstone', 4, 'minecraft:stone').map((id) => C.parse(id).props.thickness)), ['base', 'middle', 'frustum', 'tip']);
});
t('the material list counts candles, sea pickles and snow layers per item; a door counts once', () => {
  const s = C.create(4, 2, 1, 'x');
  C.set(s, 0, 0, 0, 'minecraft:candle[candles=3,lit=true,waterlogged=false]');
  C.set(s, 1, 0, 0, 'minecraft:snow[layers=5]');
  C.set(s, 2, 0, 0, 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]');
  C.set(s, 2, 1, 0, 'minecraft:oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]');
  C.set(s, 3, 0, 0, 'minecraft:sea_pickle[pickles=4,waterlogged=false]');
  const m = Object.fromEntries(C.materials(s).map((r) => [nameOf(r.item), r.n]));
  assert.strictEqual(m.candle, 3); assert.strictEqual(m.snow, 5); assert.strictEqual(m.oak_door, 1); assert.strictEqual(m.sea_pickle, 4);
});

/* ======================================================================
 * Rotation
 * ====================================================================== */
/**
 * A test build with states of every kind. ax: the axis it will be turned about. Only states the game can show after
 * the turn go in (stairs turned about an axis along their facing would need a corner shape no block has, a slab on
 * its side snaps to a double slab: both are checked on their own below).
 */
function sample(ax) {
  const s = C.create(7, 5, 4, 'Sample');
  for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 7; x++) C.set(s, x, y, z, 'minecraft:stone_bricks');
  C.set(s, 0, 3, 0, 'minecraft:oak_stairs[facing=' + (ax === 'x' ? 'north' : 'east') + ',half=bottom,shape=straight,waterlogged=false]');
  if (!ax || ax === 'y') C.set(s, 1, 3, 0, 'minecraft:oak_slab[type=bottom,waterlogged=false]');
  C.set(s, 2, 3, 0, 'minecraft:oak_log[axis=x]');
  C.set(s, 3, 3, 0, 'minecraft:observer[facing=north,powered=false]');
  C.set(s, 4, 3, 1, 'minecraft:chest[facing=south,type=single,waterlogged=false]');
  C.set(s, 5, 3, 2, 'minecraft:oak_sign[rotation=4,waterlogged=false]');
  C.set(s, 6, 4, 3, 'minecraft:end_rod[facing=east]');
  s.be = [{ x: 4, y: 3, z: 1, id: 'minecraft:chest', nbt: { Items: [9, [10, []]] } }];
  s.ents = [{ pos: [1.5, 3.2, 3.5], id: 'minecraft:armor_stand', nbt: { Rotation: [9, [5, [0, 0]]] } }];
  return s;
}
t('no angle: the very same build comes back (byte identical)', () => {
  const s = sample();
  assert.strictEqual(R.rotate(s, {}), s);
  assert.strictEqual(R.rotate(s, { x: 0, y: 360, z: 0 }), s);
  assert.strictEqual(SH.shade(s, null), s);
});
for (const ax of ['x', 'y', 'z']) {
  t('90° about ' + ax.toUpperCase() + ' is lossless and four turns give the original back', () => {
    const s = sample(ax);
    const once = R.rotate(s, { [ax]: 90 });
    assert.strictEqual(C.volume(once), C.volume(s), 'same block count');
    assert.strictEqual(once.be.length, 1, 'the chest keeps its contents');
    assert.ok(C.parse(C.get(once, once.be[0].x, once.be[0].y, once.be[0].z)).name === 'chest', 'the block entity sits on the chest');
    let r = s;
    for (let k = 0; k < 4; k++) r = R.rotate(r, { [ax]: 90 });
    assert.deepStrictEqual(plain(r.size), plain(s.size));
    for (let i = 0; i < s.blocks.length; i++) assert.strictEqual(r.palette[r.blocks[i]] || 'air', s.palette[s.blocks[i]] || 'air', 'cell ' + i);
    assert.deepStrictEqual(plain(r.be.map((b) => [b.x, b.y, b.z])), [[4, 3, 1]]);
    r.ents[0].pos.forEach((v, a) => assert.ok(Math.abs(v - s.ents[0].pos[a]) < 1e-6, 'entity back in place'));
    const back = R.rotate(once, { [ax]: -90 });
    for (let i = 0; i < s.blocks.length; i++) assert.strictEqual(back.palette[back.blocks[i]] || 'air', s.palette[s.blocks[i]] || 'air', 'and back with -90');
  });
}
t('90° turns move states the right way (facing, axis, stairs half, slab type, sign rotation)', () => {
  const s = sample(), y = R.rotate(s, { y: 90 });
  const find = (sch, re) => sch.palette.find((id) => re.test(id));
  assert.match(find(y, /oak_stairs/), /facing=north/, 'east -> north by +90 yaw');
  assert.match(find(y, /oak_log/), /axis=z/);
  assert.match(find(y, /observer/), /facing=west/);
  assert.match(find(y, /oak_sign/), /rotation=0/, 'west-facing sign (4) turns to south (0)');
  assert.match(find(y, /chest/), /facing=east/);
  const x = R.rotate(s, { x: 180 });
  assert.match(find(x, /oak_slab/), /type=top/, 'upside down');
  assert.match(find(x, /oak_stairs/), /half=top/);
  const z = R.rotate(s, { z: 90 });
  assert.match(find(z, /end_rod/), /facing=up/, 'east -> up by +90 roll');
  assert.match(find(z, /oak_slab/), /type=double/, 'a slab on its side snaps to a double slab');
  // entities: yaw turns with the build
  const e = y.ents[0].nbt.Rotation[1][1][0];
  assert.ok(Math.abs(((e % 360) + 360) % 360 - 270) < 1e-6, 'armor stand yaw 0 (south) -> 270 (east): ' + e);
});
t('compositions: X then back is the identity; the order changes the result', () => {
  // no stairs here: after the yaw they would lie along the X axis, where a quarter turn has no stairs state
  const s = sample('x');
  C.set(s, 0, 3, 0, 'minecraft:stone_bricks');
  const a = R.rotate(R.rotate(s, { x: 90, y: 90, order: 'YXZ' }), { x: -90 }), b = R.rotate(s, { y: 90 });
  assert.ok(sameBlocks(a, b), 'Y then X, then -X = Y');
  const m1 = R.matrix({ x: 90, y: 90, order: 'YXZ' }), m2 = R.matrix({ x: 90, y: 90, order: 'XYZ' });
  assert.notDeepStrictEqual(plain(m1), plain(m2));
});
function solidBox(w, h, d) { return C.fromFunction([w, h, d], () => 'minecraft:stone', 'box'); }
function shell(w, h, d) { return C.fromFunction([w, h, d], (x, y, z) => (x === 0 || y === 0 || z === 0 || x === w - 1 || y === h - 1 || z === d - 1 ? 'minecraft:stone' : null), 'shell'); }
for (const o of [{ y: 45 }, { y: 22.5 }, { x: 45 }, { z: 22.5 }, { x: 22.5, y: 45 }, { y: 67.5, z: 45 }]) {
  t('rotation ' + JSON.stringify(o) + ': connected, no holes, about the same volume, closed shells stay closed', () => {
    const s = solidBox(14, 9, 7), r = R.rotate(s, o);
    assert.strictEqual(pieces(r).length, 1, 'one piece');
    assert.strictEqual(enclosed(r), 0, 'no holes inside a solid');
    const k = C.volume(r) / C.volume(s);
    assert.ok(k > 0.85 && k < 1.25, 'volume ratio ' + k.toFixed(3));
    const sh2 = shell(14, 10, 12), rs = R.rotate(sh2, o);
    assert.ok(enclosed(rs) > 0.5 * enclosed(sh2), 'a hollow box stays closed (' + enclosed(rs) + ' of ' + enclosed(sh2) + ' inside)');
    validStates(rs, 'rot');
    const sm = R.rotate(s, Object.assign({ smooth: true, level: 'high' }, o));
    validStates(sm, 'smooth');
    assert.strictEqual(pieces(sm).length, 1, 'smooth: one piece');
  });
}
t('smooth edges use stairs and slabs on a tilted build; exact blocks only full blocks', () => {
  const s = solidBox(16, 6, 6), ex = R.rotate(s, { x: 30 }), sm = R.rotate(s, { x: 30, smooth: true, level: 'medium' });
  assert.ok(ex.palette.slice(1).every((id) => nameOf(id) === 'stone'), 'exact');
  assert.ok(sm.palette.some((id) => /stone_(stairs|slab)/.test(id)), 'smooth: stairs or slabs');
});
t('16 steps of 22.5° come back close to the original; a big build turns quickly', () => {
  const s = C.fromFunction([16, 10, 12], (x, y, z) => ((x - 7.5) ** 2 / 64 + (y - 4.5) ** 2 / 25 + (z - 5.5) ** 2 / 36 <= 1 ? 'minecraft:stone' : null), 'egg');
  let r = s;
  for (let k = 0; k < 16; k++) r = R.rotate(r, { y: 22.5, pivot: 'centre' });
  // compare the footprint overlap after centring
  const cells = (q) => { const out = new Set(), [sx, sy, sz] = q.size; for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (q.blocks[(y * sz + z) * sx + x]) out.add([x - Math.floor(sx / 2), y, z - Math.floor(sz / 2)].join()); return out; };
  const A = cells(s), B = cells(r);
  let inter = 0; A.forEach((k) => { if (B.has(k)) inter++; });
  const iou = inter / (A.size + B.size - inter);
  assert.ok(iou > 0.7, 'overlap ' + iou.toFixed(3));
  const big = C.fromFunction([40, 200, 40], (x, y, z) => ((x - 19.5) ** 2 + (z - 19.5) ** 2 < 300 ? 'minecraft:stone' : null), 'tower');
  const t0 = Date.now();
  R.rotate(big, { x: 22.5, y: 45, fast: true });
  assert.ok(Date.now() - t0 < 3000, 'fast preview of a 200-tall tower: ' + (Date.now() - t0) + ' ms');
});
t('bounds tells the rotated size without rotating', () => {
  assert.deepStrictEqual(plain(R.bounds([10, 4, 2], { y: 90 })), [2, 4, 10]);
  assert.deepStrictEqual(plain(R.bounds([10, 4, 2], {})), [10, 4, 2]);
});

/* ======================================================================
 * Light shading
 * ====================================================================== */
const ball = () => C.fromFunction([11, 11, 11], (x, y, z) => ((x - 5) ** 2 + (y - 5) ** 2 + (z - 5) ** 2 <= 25 ? 'minecraft:stone' : null), 'ball');
const ramp = () => SH.rampOf('stone');
const step = (s, x, y, z, r) => r.indexOf(C.parse(C.get(s, x, y, z)).base);
t('light from the top: the top is the lightest step, the bottom the darkest', () => {
  const r = ramp(), s = SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0, ao: 0 });
  assert.strictEqual(step(s, 5, 10, 5, r), r.length - 1, 'top');
  assert.ok(step(s, 5, 0, 5, r) <= 2, 'bottom ' + step(s, 5, 0, 5, r));
  assert.ok(step(s, 5, 10, 5, r) > step(s, 0, 5, 5, r) && step(s, 0, 5, 5, r) >= step(s, 5, 0, 5, r), 'top > side >= bottom');
  const low = SH.shade(ball(), { az: 0, el: 45, ramp: r, dither: 0, ao: 0 });
  assert.ok(step(low, 5, 10, 5, r) > step(low, 5, 0, 5, r), 'a light from above is still lighter on top than below');
});
t('turning the light by 180° mirrors the shading', () => {
  const r = ramp(), a = SH.shade(ball(), { az: 90, el: 0, ramp: r, dither: 0, ao: 0 }), b = SH.shade(ball(), { az: 270, el: 0, ramp: r, dither: 0, ao: 0 });
  for (let y = 0; y < 11; y++) for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) assert.strictEqual(C.get(a, x, y, z), C.get(b, 10 - x, y, z), 'mirrored at ' + [x, y, z]);
});
t('shading keeps to the ramp and its step count, and is deterministic', () => {
  const r = ramp();
  for (const k of [3, 5, 9]) {
    const s = SH.shade(ball(), { az: 225, el: 40, ramp: r, steps: k, dither: 0.8 });
    const used = new Set(C.counts(s, true).map((x) => x.id));
    assert.ok(used.size <= k, k + ' steps, ' + used.size + ' blocks');
    used.forEach((id) => assert.ok(r.includes(id), id + ' from the ramp'));
    assert.ok(sameBlocks(s, SH.shade(ball(), { az: 225, el: 40, ramp: r, steps: k, dither: 0.8 })), 'repeatable');
  }
});
t('shading works on rotated and detailed builds and leaves block entities and entities alone', () => {
  const s = sample(), r = ramp();
  const sh = SH.shade(R.rotate(s, { y: 90 }), { az: 0, el: 60, ramp: r });
  assert.strictEqual(sh.be.length, 1, 'the chest data passes through');
  assert.ok(C.parse(C.get(sh, sh.be[0].x, sh.be[0].y, sh.be[0].z)).name === 'chest', 'and the chest is still there');
  assert.strictEqual(sh.ents.length, 1);
  const det = G.gen('bipyramid', { detail: 'medium' }), shd = SH.shade(det, { az: 0, el: 90, ramp: r });
  assert.ok(shd.palette.some((id) => /_(stairs|slab)\[/.test(id)), 'stairs and slabs stay stairs and slabs');
  validStates(shd, 'shaded');
  assert.strictEqual(C.volume(shd), C.volume(det));
});
t('light colour: a red light pulls the lit side to red; tint 0 is the plain ramp; only pool blocks', () => {
  const r = ramp(), base = SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0 });
  const red = SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0, colour: { light: [1, 0, 0], tint: 1, pool: 'concrete' } });
  const L = (id) => SH.labOf(nameOf(id)), redLab = SH.lab([255, 0, 0]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(dist(L(C.get(red, 5, 10, 5)), redLab) < dist(L(C.get(base, 5, 10, 5)), redLab), 'the top is redder: ' + C.get(red, 5, 10, 5));
  const zero = SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0, colour: { light: [1, 0, 0], tint: 0, pool: 'concrete' } });
  assert.ok(sameBlocks(zero, base), 'tint 0 = no colour');
  const pool = new Set(SH.pool('concrete'));
  C.counts(red, true).forEach((x) => assert.ok(pool.has(x.id), x.id + ' is concrete'));
  assert.ok(sameBlocks(red, SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0, colour: { light: [1, 0, 0], tint: 1, pool: 'concrete' } })), 'repeatable');
  const hue = SH.shade(ball(), { az: 0, el: 90, ramp: r, dither: 0, colour: { light: [1, 1, 1], tint: 0, hue: 1, pool: 'wool' } });
  C.counts(hue, true).forEach((x) => assert.match(x.id, /_wool$/));
  assert.ok(SH.rampFrom('minecraft:amethyst_block', 5, 'all').length >= 3, 'a ramp from a block colour');
});

/* ======================================================================
 * Quick editor
 * ====================================================================== */
t('editor: box (solid / hollow / walls), sphere, cylinder, cone, pyramid have the right cells', () => {
  const W = E.create([32, 32, 32]);
  assert.strictEqual(W.box([2, 0, 2], [6, 4, 6], 'solid').length, 125);
  assert.strictEqual(W.box([2, 0, 2], [6, 4, 6], 'hollow').length, 125 - 27);
  assert.strictEqual(W.box([2, 0, 2], [6, 4, 6], 'walls').length, 5 * 16);
  const sp = W.ellipsoid([0, 0, 0], [8, 8, 8]);
  assert.ok(sp.length > 300 && sp.length < 500, 'sphere d9: ' + sp.length);
  assert.ok(W.ellipsoid([0, 0, 0], [8, 8, 8], true).length < sp.length);
  assert.ok(W.cylinder([0, 0, 0], [6, 9, 6]).length > W.cone([0, 0, 0], [6, 9, 6]).length);
  assert.strictEqual(W.pyramid([0, 0, 0], [4, 2, 4]).length, 25 + 9 + 1);
  assert.strictEqual(W.line([0, 0, 0], [5, 0, 0], 1).length, 6);
});
t('editor: apply, mirror, undo / redo', () => {
  const W = E.create([16, 8, 16]);
  W.mirror.x = true;
  const box = W.apply(W.brush(2, 0, 3, 1), 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'place');
  assert.ok(box, 'something changed');
  assert.match(C.get(W.s, 2, 0, 3), /facing=east/);
  assert.match(C.get(W.s, 13, 0, 3), /facing=west/, 'the mirrored stair faces the other way');
  W.mirror.x = false;
  W.apply(W.box([0, 1, 0], [3, 2, 3], 'solid'), 'minecraft:stone', 'place');
  assert.strictEqual(W.count(), 2 + 32);
  W.undo(); assert.strictEqual(W.count(), 2);
  W.undo(); assert.strictEqual(W.count(), 0);
  W.redo(); assert.strictEqual(W.count(), 2);
  W.redo(); assert.strictEqual(W.count(), 34);
  W.apply(W.brush(0, 1, 0, 1), null, 'erase'); assert.strictEqual(W.count(), 33);
  W.apply(W.box([0, 1, 0], [3, 1, 3], 'solid'), 'minecraft:glass', 'paint');
  assert.strictEqual(C.counts(W.s, true).find((x) => x.id === 'minecraft:glass').n, 15, 'paint only over blocks');
});
t('editor: flood fill, fill an area, replace, extrude', () => {
  const W = E.create([16, 8, 16]);
  W.apply(W.box([0, 0, 0], [6, 0, 6], 'walls'), 'minecraft:stone', 'place');
  assert.ok(W.fillLayer(3, 0, 3, 'minecraft:oak_planks'), 'a closed ring fills');
  assert.strictEqual(C.counts(W.s, true).find((x) => x.id === 'minecraft:oak_planks').n, 25);
  assert.strictEqual(W.fillLayer(10, 0, 10, 'minecraft:oak_planks'), null, 'an open area does not fill');
  W.flood(3, 0, 3, 'minecraft:birch_planks');
  assert.strictEqual(C.counts(W.s, true).find((x) => x.id === 'minecraft:birch_planks').n, 25);
  W.replace(null, 'minecraft:stone', 'minecraft:deepslate_bricks');
  assert.ok(!C.counts(W.s, true).some((x) => x.id === 'minecraft:stone'));
  const before = W.count();
  W.extrude(3, 0, 3, [0, 1, 0], true);
  assert.strictEqual(W.count(), before + 49, 'the whole top face goes up one block');
  W.extrude(3, 1, 3, [0, 1, 0], false);
  assert.strictEqual(W.count(), before, 'and back in');
});
t('editor: copy / paste, repeat, move and turn carry block entities; flip mirrors states', () => {
  const W = E.create([24, 10, 24]);
  W.apply([W.I(2, 0, 2)], 'minecraft:chest[facing=north,type=single,waterlogged=false]', 'place');
  W.s.be = [{ x: 2, y: 0, z: 2, id: 'minecraft:chest', nbt: { Items: [9, [10, []]] } }];
  W.apply([W.I(3, 0, 2)], 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'place');
  const clip = W.copy([2, 0, 2, 3, 0, 2]);
  assert.strictEqual(clip.be.length, 1);
  W.paste(clip, [10, 0, 10]);
  assert.strictEqual(W.s.be.length, 2, 'the pasted chest has its contents');
  W.stack([2, 0, 2, 3, 0, 2], 2, [0, 0, 3]);
  assert.strictEqual(W.s.be.length, 4, 'two more copies');
  W.move([10, 0, 10, 11, 0, 10], [0, 2, 0]);
  assert.ok(W.s.be.some((b) => b.x === 10 && b.y === 2 && b.z === 10), 'moved with its block');
  W.flip([10, 2, 10, 11, 2, 10], 0);
  assert.match(C.get(W.s, 10, 2, 10), /oak_stairs.*facing=west/, 'flipped stairs face the other way');
  W.turn([2, 0, 2, 3, 0, 2], { y: 90 });
  assert.strictEqual(C.volume(W.copy([0, 0, 0, 23, 0, 23])), 6, 'turned in place, nothing lost');
  assert.ok(W.s.be.every((b) => /chest/.test(C.get(W.s, b.x, b.y, b.z))), 'every block entity on a chest');
  const n = W.undoS.length;
  W.undo(); W.undo();
  assert.strictEqual(W.undoS.length, n - 2);
});
t('editor: scale doubles a selection; shade bakes light into blocks; out() crops; drop adds a generated build', () => {
  const W = E.create([32, 32, 32]);
  W.apply(W.box([0, 0, 0], [1, 1, 1], 'solid'), 'minecraft:stone', 'place');
  W.scale([0, 0, 0, 1, 1, 1], 2);
  assert.strictEqual(W.count(), 64);
  W.shade(null, { az: 0, el: 90, ramp: ramp(), dither: 0 });
  assert.ok(C.counts(W.s, true).length > 1, 'shaded into several steps');
  assert.deepStrictEqual(plain(W.out().size), [4, 4, 4]);
  const g = G.gen('crystal', { h: 20, w: 6, d: 6 }), W2 = E.create(g, { pad: 4 });
  assert.strictEqual(W2.count(), C.volume(g));
  W2.clearAll(); assert.strictEqual(W2.count(), 0);
  W2.drop(g); assert.strictEqual(W2.count(), C.volume(g));
});

/* ======================================================================
 * Files
 * ====================================================================== */
async function roundTrip(s, fmt) {
  const bytes = fmt === 'litematic' ? await IO.toLitematic(s) : await IO.toSchem(s);
  return IO.load({ name: 'x.' + fmt, bytes });
}
t('generated, rotated and shaded builds export to .schem, .litematic and JSON and read back unchanged', async () => {
  const list = [G.gen('spire', { detail: 'max', tipStyle: 'dripstone', glow: 'speckles', glowBlock: 'candles', glowAmt: 80 }), R.rotate(sample(), { y: 45, smooth: true, level: 'high' }), SH.shade(G.gen('henge', {}), { az: 0, el: 50, ramp: ramp() })];
  for (const s of list) {
    for (const fmt of ['schem', 'litematic']) {
      const back = await roundTrip(s, fmt);
      assert.deepStrictEqual(plain(back.size), plain(s.size), fmt + ' size');
      assert.deepStrictEqual(countMap(back), countMap(s), fmt + ' blocks');
    }
    const j = IO.fromJSON(JSON.parse(IO.toJSON(s)));
    assert.deepStrictEqual(countMap(j), countMap(s), 'json');
  }
});

(async () => {
  let n = 0;
  const only = process.argv.find((a) => a.startsWith('--only='));
  for (const [name, fn] of tests) {
    if (only && !name.includes(only.slice(7))) continue;
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  if (process.argv.includes('-v')) report.forEach((r) => console.log(r.join(' | ')));
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' shape tests passed');
})();
