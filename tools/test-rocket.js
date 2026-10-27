// Tests for the Creeper rocket in the Builds library (js/modules/builds-farms.js, creeperRocket).
//   node tools/test-rocket.js        (-v lists every option set with its size and blocks)
// Builds every option set (height x flames, and every creeper colour) in a VM with the game's block database and checks:
// 34 x 34 (fits a 35 x 35 plot) and as high as the option says (127 by default: y 63 to 189); known blocks (full cubes,
// slabs, stairs, buttons) that never fall; only fully oxidised copper, under 3 %; one connected piece; the SHAPE mirror
// symmetric on both horizontal axes and turning 90 degrees onto itself (the weathering colours are irregular on
// purpose); hollow and sealed; spawn-proof (no block with a full top has open air on it, outside or inside); a
// 24 x 24 x 24 head with the face on all four sides texel by texel in every colour set; the body as wide as the build
// and wider than the head; the bottom at least 16 wide; grey parts without white or red; the size table; the same build
// every time; and that the files export and read back unchanged.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, Float32Array, DataView, Map, Set, Math, JSON, Object, Array, String, Number, Promise, Error };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('window.TH = { data: {}, langData: {}, icon: () => null };', ctx);
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js', 'js/modules/builds-farms.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const C = ctx.TH.builds.core, IO = ctx.TH.builds.io, F = ctx.TH.builds.farms, DB = ctx.TH.data.blockDb.b;

const ID = 'creeper_rocket';
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const f = F.FARMS.find((x) => x.id === ID);
const plain = (v) => JSON.parse(JSON.stringify(v));
const nameOf = (id) => C.parse(id).name;
// the layout the generator promises: 34 wide (centre between x 16 and 17), flames y 0..9, nozzle y 10..14, the head
// 24 x 24 x 24 (x and z 5..28, y 15..38), the collar y 39..43, the ring y 44..45, the body from y 46; the nose is 30 %
// of the height with its ring 2 lower; an iron spike at H - 2 with a cap on top
const S = 34, HEAD = { lo: 5, hi: 28, y0: 15, y1: 38 }, COLLAR_Y = 39, RING_Y = 44, BODY_Y = 46, MID = 16, CEN = 16.5;
const noseRing = (H) => H - 2 - Math.round(H * 0.3) - 2;
// the creeper's face (entity/creeper/creeper.png, texels 8..15 x 8..15), left half; the right half is its mirror
const FACE = ['PMGP', 'MGGG', 'GDDP', 'GDKG', 'PGPD', 'PMDK', 'PMKK', 'PPDP'];
const COLOURS = {
  charged: { K: 'black_concrete', D: 'blue_concrete', M: 'cyan_concrete', G: 'light_blue_concrete', P: 'light_blue_wool', W: 'white_concrete' },
  grey: { K: 'black_concrete', D: 'gray_concrete', M: 'tuff', G: 'andesite', P: 'stone', W: 'polished_diorite' },
  ember: { K: 'black_concrete', D: 'red_nether_bricks', M: 'red_terracotta', G: 'orange_terracotta', P: 'orange_concrete', W: 'yellow_concrete' },
  green: { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' },
};
/** The face block of a colour set at column p (0..23 across the side) and row r (0 = top texel row): 3 blocks per texel. */
const faceAt = (col, p, r) => COLOURS[col][FACE[r][Math.floor((p < 12 ? p : 23 - p) / 3)]];
const CANE = ['lime_wool', 'bamboo_block', 'bone_block', 'lime_concrete', 'lime_terracotta', 'moss_block'];
const CANE_GREEN = ['lime_wool', 'lime_concrete', 'green_wool', 'green_concrete', 'moss_block', 'lime_terracotta', 'bamboo_block'];
const GLOW = ['glowstone', 'shroomlight'];
// the grey rocket parts: the base names (a slab or stair of them counts too)
const GREY = ['polished_andesite', 'andesite', 'stone', 'light_gray_concrete', 'gray_concrete', 'cobblestone', 'tuff', 'polished_deepslate', 'cobbled_deepslate', 'deepslate_tile', 'deepslate_tiles', 'iron_block', 'stone_brick', 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_brick', 'mossy_stone_bricks', 'oxidized_copper', 'oxidized_cut_copper'];
const RUST = ['brown_terracotta', 'orange_terracotta', 'brown_concrete', 'orange_concrete'];
const stem = (nm) => nm.replace(/_(slab|stairs)$/, '');
const greyish = (nm) => nm === 'stone_button' || GREY.includes(stem(nm)) || RUST.includes(stem(nm));

/** Every combination of the options that change the shape (the colour stays at its default). */
function shapes() {
  let out = [{}];
  f.opts.filter((op) => !op.look).forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
  return out;
}
function grid(s) {
  const ids = s.palette.map((p) => (C.isAir(p) ? null : p)), names = ids.map((p) => p && nameOf(p));
  const [sx, sy, sz] = s.size;
  const idx = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -1 : s.blocks[C.idx(s, x, y, z)]);
  const at = (x, y, z) => { const k = idx(x, y, z); return k < 0 ? null : names[k]; };
  const id = (x, y, z) => { const k = idx(x, y, z); return k < 0 ? null : ids[k]; };
  return { s, at, id, sx, sy, sz };
}
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function pieces(g) {
  const seen = new Uint8Array(g.sx * g.sy * g.sz), sizes = [], id = (x, y, z) => (y * g.sz + z) * g.sx + x;
  for (let y = 0; y < g.sy; y++) for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
    if (!g.at(x, y, z) || seen[id(x, y, z)]) continue;
    let k = 0; const st = [[x, y, z]]; seen[id(x, y, z)] = 1;
    while (st.length) {
      const [a, b, c] = st.pop(); k++;
      for (const [dx, dy, dz] of N6) { const X = a + dx, Y = b + dy, Z = c + dz; if (g.at(X, Y, Z) && !seen[id(X, Y, Z)]) { seen[id(X, Y, Z)] = 1; st.push([X, Y, Z]); } }
    }
    sizes.push(k);
  }
  return sizes;
}
/** The air reachable from outside the box (6 neighbours, a one-block margin around it). */
function outsideAir(g) {
  const W = g.sx + 2, Hh = g.sy + 2, L = g.sz + 2, seen = new Uint8Array(W * Hh * L), id = (x, y, z) => ((y + 1) * L + (z + 1)) * W + (x + 1);
  const st = [[-1, -1, -1]]; seen[id(-1, -1, -1)] = 1;
  while (st.length) {
    const [a, b, c] = st.pop();
    for (const [dx, dy, dz] of N6) {
      const X = a + dx, Y = b + dy, Z = c + dz;
      if (X < -1 || Y < -1 || Z < -1 || X > g.sx || Y > g.sy || Z > g.sz || seen[id(X, Y, Z)] || g.at(X, Y, Z)) continue;
      seen[id(X, Y, Z)] = 1; st.push([X, Y, Z]);
    }
  }
  return (x, y, z) => !!seen[id(x, y, z)];
}
/** The width of a layer along the row z 16 (first block to last); the diagonal fins never touch it. */
function widthAt(g, y) {
  let lo = -1, hi = -1;
  for (let x = 0; x < g.sx; x++) if (g.at(x, y, MID)) { if (lo < 0) lo = x; hi = x; }
  return lo < 0 ? 0 : hi - lo + 1;
}
/** Does this block have a full, solid top a mob could stand on? (full cubes, top and double slabs, upside-down stairs) */
function fullTop(id) {
  const d = C.def(id), p = C.parse(id).props;
  if (d.shape === 'cube') return true;
  if (d.shape === 'slab') return p.type === 'top' || p.type === 'double';
  if (d.shape === 'stairs') return p.half === 'top';
  return false;
}
const inHead = (x, y, z) => y >= HEAD.y0 && y <= HEAD.y1 && x >= HEAD.lo && x <= HEAD.hi && z >= HEAD.lo && z <= HEAD.hi;
const report = [];

t('the rocket is a Structure with tags, icon, options and steps', () => {
  assert.ok(f, 'in the library');
  assert.strictEqual(f.cat, 'build');
  assert.ok(f.tags.includes('statue') && f.tags.includes('mob-head'));
  assert.strictEqual(f.icon, 'item/firework_rocket');
  assert.ok(!f.art);
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  assert.ok(/y 63/.test(f.pitch) && /189/.test(f.pitch) && /34 wide/.test(f.pitch) && /35 x 35/.test(f.pitch), 'the text says the size and where the base and tip go');
  assert.ok(f.tips.some((s) => /spawn-proofed/i.test(s)), 'a tip on spawn-proofing');
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['size', 'flames', 'colour']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.deepStrictEqual(plain(F.options(ID, { size: '20', flames: 'maybe', colour: 'pink' })), { size: '127', flames: 'on', colour: 'charged' });
  assert.ok(f.opts[0].choices.every((c) => +c[0] >= 70), 'every height is at least 70');
  assert.ok(f.opts.find((op) => op.id === 'colour').look, 'the creeper colour does not change the shape');
  assert.deepStrictEqual(plain(f.opts.find((op) => op.id === 'colour').choices.map((c) => c[0])), Object.keys(COLOURS));
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': size, blocks, one piece, symmetric shape, hollow, sealed, spawn-proof', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, H = +o.size, vol = C.volume(s);
    assert.deepStrictEqual([sx, sy, sz], [S, H, S], '34 x 34 and ' + H + ' high');
    for (const [x, z] of [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]]) assert.ok(g.at(x, 0, z), 'a fin tip stands on the corner ' + [x, z]);
    let copper = 0;
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p), d = C.def(p);
      assert.ok(DB[nm], nm + ' is a 26.3 block');
      assert.ok(C.known(p), nm + ' is known to the viewer');
      assert.ok(['cube', 'slab', 'stairs', 'button'].includes(d.shape), nm + ' is a cube, slab, stair or button (' + d.shape + ')');
      assert.ok(C.replaceable(p).ok, nm + ' can be swapped');
      assert.ok(d.fam !== 'gravity' && !/sand|gravel|powder|anvil|scaffolding/.test(nm), nm + ' does not fall');
      if (/copper/.test(nm)) assert.ok(/^oxidized_/.test(nm), nm + ': only fully oxidised copper, which never changes and needs no wax');
    });
    C.counts(s, true).forEach((r) => { if (/copper/.test(nameOf(r.id))) copper += r.n; });
    assert.ok(copper > 0 && copper < 0.03 * vol, 'copper is a rare accent (' + copper + ' of ' + vol + ')');
    const parts = pieces(g);
    assert.strictEqual(parts.length, 1, 'one connected piece, got ' + parts.length + ' (' + parts.slice(0, 6).join(', ') + ')');
    // the shape (block or air) is mirror symmetric and turns onto itself; the colours may weather irregularly
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const here = !g.at(x, y, z);
      assert.strictEqual(here, !g.at(sx - 1 - x, y, z), 'mirror x at ' + [x, y, z]);
      assert.strictEqual(here, !g.at(x, y, sz - 1 - z), 'mirror z at ' + [x, y, z]);
      assert.strictEqual(here, !g.at(sz - 1 - z, y, x), 'quarter turn at ' + [x, y, z]);
    }
    // hollow: every block has air among its 26 neighbours; the inside is sealed
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!g.at(x, y, z)) continue;
      let air = false;
      for (let dy = -1; dy <= 1 && !air; dy++) for (let dz = -1; dz <= 1 && !air; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !g.at(x + dx, y + dy, z + dz)) { air = true; break; }
      assert.ok(air, 'a buried block at ' + [x, y, z]);
    }
    const out = outsideAir(g);
    for (const y of [HEAD.y0 + 6, HEAD.y0 + 18, BODY_Y + 4, noseRing(H) + 6]) {
      assert.strictEqual(g.at(MID, y, MID), null, 'hollow at y ' + y);
      assert.ok(!out(MID, y, MID), 'sealed at y ' + y);
    }
    assert.ok(vol < 0.2 * sx * sy * sz, 'a shell, not a solid (' + vol + ' blocks)');
    // spawn-proof: no block with a full top has air on it, outside or inside (the top of the build counts too)
    const spots = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const id = g.id(x, y, z);
      if (id && fullTop(id) && !g.at(x, y + 1, z)) spots.push([x, y, z].join(','));
    }
    assert.strictEqual(spots.length, 0, 'spawnable tops: ' + spots.slice(0, 8).join(' | '));
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    assert.ok(counts.stone_button > 400, 'stone buttons on the floors inside');
    const caps = Object.entries(counts).filter(([n]) => /_(slab|stairs)$/.test(n)).reduce((a, [, n]) => a + n, 0);
    assert.ok(caps > 500, 'slabs and stairs smooth the steps (' + caps + ')');
    // the silhouette: a 24 cube head, a stepped collar, the body and rings as wide as the build, a narrowing nose
    assert.strictEqual(widthAt(g, HEAD.y0 + 1), 24);
    for (let y = BODY_Y; y < noseRing(H); y++) assert.strictEqual(widthAt(g, y), S, 'body at y ' + y);
    for (const y of [RING_Y, RING_Y + 1, noseRing(H), noseRing(H) + 1]) assert.strictEqual(widthAt(g, y), S, 'ring at y ' + y);
    for (let y = COLLAR_Y + 1; y < RING_Y; y++) assert.ok(widthAt(g, y) >= widthAt(g, y - 1) && widthAt(g, y) > 24, 'collar widens at y ' + y);
    for (let y = noseRing(H) + 3; y < H; y++) assert.ok(widthAt(g, y) <= widthAt(g, y - 1), 'the nose narrows at y ' + y);
    // seen along a diagonal the body is clearly wider than the head too (head: the head box; body: the cane blocks)
    const spread = (y0, y1, keep) => { let lo = 99, hi = -99; for (let y = y0; y <= y1; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (g.at(x, y, z) && keep(x, y, z)) { lo = Math.min(lo, x - z); hi = Math.max(hi, x - z); } return (hi - lo) / Math.SQRT2; };
    const headD = spread(HEAD.y0, HEAD.y1, (x, y, z) => inHead(x, y, z));
    const caneish = CANE.concat(['mossy_cobblestone']);
    const bodyD = spread(BODY_Y, noseRing(H) - 1, (x, y, z) => caneish.includes(g.at(x, y, z)));
    assert.ok(bodyD >= headD + 2, 'body ' + bodyD.toFixed(1) + ' vs head ' + headD.toFixed(1) + ' across the diagonal');
    // the bottom: at least 16 wide everywhere below the head (flames or the nozzle)
    for (let y = o.flames === 'off' ? 10 : 0; y < HEAD.y0; y++) assert.ok(widthAt(g, y) >= 16, 'bottom ' + widthAt(g, y) + ' wide at y ' + y);
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });

  t(label + ': cane body, grey nose, fins and rings, flames', () => {
    const s = F.schematic(ID, o), g = grid(s), H = +o.size, yc = noseRing(H);
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    for (const b of CANE) assert.ok(counts[b] > 100, 'the cane uses ' + b);
    let nodes = 0;
    for (let y = BODY_Y + 1; y < yc; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (g.at(x, y, z) === 'bone_block' && g.at(x, y - 1, z) === 'lime_terracotta') nodes++;
    assert.ok(nodes >= 8 * Math.floor((yc - BODY_Y) / 16), 'node rows on the stalks (' + nodes + ')');
    // grey parts: the nose (with its spike), the fins (outside the body radius), the collar and the rings; no white, no red
    const only = (y0, y1, keep, what) => { for (let y = y0; y <= y1; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const b = g.at(x, y, z); if (b && keep(x, z)) assert.ok(greyish(b), what + ': ' + b + ' at ' + [x, y, z]); } };
    only(yc, H - 1, () => true, 'nose');
    only(HEAD.y1 + 1, RING_Y + 1, (x, z) => Math.hypot(x - CEN, z - CEN) <= 17, 'collar and ring');
    only(10, HEAD.y1, (x, z) => Math.hypot(x - CEN, z - CEN) > 17.2, 'fin');   // below the body only fins reach out this far
    for (let y = 0; y < H; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const b = g.at(x, y, z);
      if (!b || inHead(x, y, z)) continue;
      assert.ok(!/^white_concrete/.test(b), 'no white outside the head at ' + [x, y, z]);
      if (y > 9) assert.ok(!/^red_concrete/.test(b), 'no red stripes at ' + [x, y, z]);
    }
    assert.strictEqual(g.at(0, RING_Y, MID), 'polished_deepslate');
    assert.strictEqual(g.at(0, RING_Y + 1, MID), 'deepslate_tiles');
    assert.strictEqual(g.at(0, yc, MID), 'polished_deepslate');
    assert.strictEqual(g.at(0, yc + 1, MID), 'oxidized_cut_copper', 'one oxidised copper ring');
    assert.ok(counts.brown_terracotta > 50 && counts.orange_terracotta > 5, 'rust');
    // the spike: 2 x 2 iron with a cap on top
    for (const [x, z] of [[16, 16], [17, 16], [16, 17], [17, 17]]) { assert.strictEqual(g.at(x, H - 2, z), 'iron_block'); assert.ok(g.at(x, H - 1, z) && !fullTop(g.id(x, H - 1, z)), 'capped spike'); }
    let top = 0; for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (g.at(x, H - 1, z)) top++;
    assert.strictEqual(top, 4, 'only the spike reaches the top');
    const glow = GLOW.reduce((a, b) => a + (counts[b] || 0), 0);
    if (o.flames === 'off') {
      assert.strictEqual(glow, 0, 'no flames');
      for (let y = 0; y < 10; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (Math.hypot(x - CEN, z - CEN) < 13) assert.strictEqual(g.at(x, y, z), null, 'nothing under the nozzle at ' + [x, y, z]);
    } else {
      assert.ok(glow > 100, 'glowing flames');
      assert.ok(/^(yellow_concrete|glowstone)/.test(g.at(MID - 8, 9, MID) || ''), 'yellow at the top of the flames');
      assert.ok(/^(red_concrete|orange_concrete)/.test(g.at(MID - 10, 0, MID) || ''), 'red at the ground');
    }
  });
}

for (const col of Object.keys(COLOURS)) {
  t('creeper colour ' + col + ': a 24 block cube with the face on all four sides, nothing else changes', () => {
    const o = { size: '100', flames: 'on', colour: col }, s = F.schematic(ID, o), g = grid(s), P = COLOURS[col];
    const sides = { south: (p, y) => g.at(HEAD.lo + p, y, HEAD.hi), north: (p, y) => g.at(HEAD.lo + p, y, HEAD.lo), east: (p, y) => g.at(HEAD.hi, y, HEAD.lo + p), west: (p, y) => g.at(HEAD.lo, y, HEAD.lo + p) };
    const onHead = new Set();
    let headK = 0, headD = 0;
    for (const [side, get] of Object.entries(sides)) {
      let black = 0, dark = 0;
      for (let y = HEAD.y0; y <= HEAD.y1; y++) for (let p = 0; p < 24; p++) {
        const got = get(p, y);
        assert.strictEqual(got, faceAt(col, p, 7 - Math.floor((y - HEAD.y0) / 3)), side + ' face at column ' + p + ', y ' + y);
        onHead.add(got);
        if (got === P.K) black++;
        if (got === P.D) dark++;
      }
      // eyes and mouth: 8 black texels, 12 dark ones, each 3 x 3 blocks
      assert.strictEqual(black, 72, side + ': 72 black blocks');
      assert.strictEqual(dark, 108, side + ': 108 dark blocks');
      headK += black; headD += dark;
    }
    // the head is a cube: every side of the box is filled, 24 x 24 x 24
    for (let y = HEAD.y0; y <= HEAD.y1; y++) for (let p = 0; p < 24; p++) for (const get of Object.values(sides)) assert.ok(get(p, y));
    assert.strictEqual(widthAt(g, HEAD.y0), 24);
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    assert.strictEqual(counts.black_concrete, headK, 'black only on the faces');
    if (col !== 'grey') assert.strictEqual(counts[P.D], headD, 'the dark face colour only on the faces');
    if (col !== 'green') for (const b of onHead) assert.ok(!CANE_GREEN.includes(b), col + ': ' + b + ' is a cane green on the head');
    // the colour changes the head and nothing else
    const b = grid(F.schematic(ID, { size: '100', flames: 'on', colour: 'charged' }));
    for (let y = 0; y < 100; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      if (!inHead(x, y, z)) assert.strictEqual(g.id(x, y, z), b.id(x, y, z), col + ': only the head changes, not ' + [x, y, z]);
      else assert.strictEqual(!g.at(x, y, z), !b.at(x, y, z));
    }
  });
}

t('the same options always give the same build', () => {
  for (const o of [{ size: '100', flames: 'on', colour: 'grey' }, { size: '127', flames: 'off', colour: 'ember' }]) {
    const a = f.make(F.options(ID, o)), b = f.make(F.options(ID, o));
    assert.deepStrictEqual(plain(a.size), plain(b.size));
    assert.deepStrictEqual(plain(a.palette), plain(b.palette));
    assert.ok(a.blocks.every((v, i) => v === b.blocks[i]), 'same blocks');
  }
});
t('the parts above the nozzle are the same with and without flames', () => {
  const a = grid(F.schematic(ID, { size: '127', flames: 'on' })), b = grid(F.schematic(ID, { size: '127', flames: 'off' }));
  for (let y = 11; y < 127; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) assert.strictEqual(a.id(x, y, z), b.id(x, y, z), 'at ' + [x, y, z]);
});
t('the size table matches every option set (tooltips)', () => {
  const seen = new Set();
  for (const o of shapes()) {
    const s = F.schematic(ID, o), k = F.statKey(f, F.options(ID, o));
    seen.add(k);
    assert.deepStrictEqual(plain(F.STATS[ID][k]), plain(s.size.concat([C.volume(s)])), k + ' (run node tools/test-heads.js --stats)');
  }
  assert.strictEqual(Object.keys(F.STATS[ID]).length, seen.size);
});

async function roundTrip(s, fmt) {
  const bytes = fmt === 'litematic' ? await IO.toLitematic(s) : await IO.toSchem(s);
  return IO.load({ name: 'x.' + fmt, bytes });
}
const countMap = (s) => Object.fromEntries(C.counts(s).map((x) => [x.id, x.n]));
t('exports to .schem, .litematic and JSON and reads back unchanged (slab, stair and button states included)', async () => {
  for (const o of [{ size: '100', flames: 'on', colour: 'grey' }, { size: '127', flames: 'off', colour: 'charged' }]) {
    const s = F.schematic(ID, o);
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
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  if (process.argv.includes('-v')) report.forEach((r) => console.log(r.join(' | ')));
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' rocket tests passed');
})();
