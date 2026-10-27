// Tests for the Creeper rocket in the Builds library (js/modules/builds-farms.js, creeperRocket).
//   node tools/test-rocket.js        (-v lists every option set with its size and blocks)
// Builds every option set (height x flames, and every creeper colour) in a VM with the game's block database and checks:
// exactly 35 x 35 wide and as high as the option says (127 by default: y 63 to 189), known full-cube blocks that can be
// swapped and never fall, one connected piece, mirror symmetric on both horizontal axes (the shape also turns 90 degrees
// onto itself), hollow (every block touches air, the inside is sealed off from the outside), the body as wide as the plot
// as the head, the bottom (flames or nozzle) at least 16 wide, the creeper face on all four sides of the head texel by
// texel in every colour set, no cane green on the creeper unless asked for, the cane colours and nodes, the joint rings,
// the size table, the same build every time, and that the files export and read back unchanged.
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
// the layout the generator promises: flames y 0..9, nozzle y 10..14, the head 23 wide (x and z 6..28) from y 15 to 38,
// the collar y 39..43, the ring y 44..45, the body from y 46; the nose is 30 % of the height, the ring under it 2 lower,
// a 2 block spike
const HEAD = { lo: 6, hi: 28, y0: 15, y1: 38 }, COLLAR_Y = 39, RING_Y = 44, BODY_Y = 46, MID = 17;
const noseRing = (H) => H - 2 - Math.round(H * 0.3) - 2;
// the creeper's face (entity/creeper/creeper.png, texels 8..15 x 8..15), left half; the right half is its mirror
const FACE = ['PMGP', 'MGGG', 'GDDP', 'GDKG', 'PGPD', 'PMDK', 'PMKK', 'PPDP'];
const COLOURS = {
  charged: { K: 'black_concrete', D: 'blue_concrete', M: 'cyan_concrete', G: 'light_blue_concrete', P: 'light_blue_wool', W: 'white_concrete' },
  grey: { K: 'black_concrete', D: 'gray_concrete', M: 'tuff', G: 'andesite', P: 'stone', W: 'polished_diorite' },
  ember: { K: 'black_concrete', D: 'red_nether_bricks', M: 'red_terracotta', G: 'orange_terracotta', P: 'orange_concrete', W: 'yellow_concrete' },
  green: { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' },
};
/** The face block of a colour set at column p (0..22 across the side) and row r (0 = top texel row): 3 blocks per texel, the inner texel 2 on each side of the middle column. */
const faceAt = (col, p, r) => COLOURS[col][FACE[r][Math.min(3, Math.floor((p <= 11 ? p : 22 - p) / 3))]];
// the neutral rocket set and where it goes
const NOSE = ['white_concrete', 'light_gray_concrete', 'red_concrete', 'iron_block'], FIN = ['white_concrete', 'light_gray_concrete', 'red_concrete'];
const RING = ['light_gray_concrete', 'bone_block'], COLLAR = ['white_concrete', 'red_concrete'], NOZZLE = ['light_gray_concrete', 'polished_deepslate', 'orange_concrete'];
const CANE = ['lime_wool', 'bamboo_block', 'bone_block', 'lime_concrete', 'lime_terracotta', 'moss_block'];
const CANE_GREEN = ['lime_wool', 'lime_concrete', 'green_wool', 'green_concrete', 'moss_block', 'lime_terracotta', 'bamboo_block'];
const GLOW = ['glowstone', 'shroomlight'];

/** Every combination of the options that change the shape (the colour stays at its default). */
function shapes() {
  let out = [{}];
  f.opts.filter((op) => !op.look).forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
  return out;
}
function grid(s) {
  const names = s.palette.map((p) => (C.isAir(p) ? null : nameOf(p)));
  const [sx, sy, sz] = s.size;
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? null : names[s.blocks[C.idx(s, x, y, z)]]);
  return { s, at, sx, sy, sz };
}
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Connected pieces (6 neighbours) of the blocks. */
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
/** The width of a layer through the middle row (z 17), first block to last, ignoring the diagonal fins (which never touch z 17). */
function widthAt(g, y) {
  let lo = -1, hi = -1;
  for (let x = 0; x < g.sx; x++) if (g.at(x, y, MID)) { if (lo < 0) lo = x; hi = x; }
  return lo < 0 ? 0 : hi - lo + 1;
}
const report = [];

t('the rocket is a Structure with tags, icon, options and steps', () => {
  assert.ok(f, 'in the library');
  assert.strictEqual(f.cat, 'build');
  assert.ok(f.tags.includes('statue') && f.tags.includes('mob-head'));
  f.tags.forEach((tg) => assert.match(tg, /^[a-z-]+$/));
  assert.strictEqual(f.icon, 'item/firework_rocket');
  assert.ok(!f.art, 'the card shows the rocket icon, so it does not look like the Creeper head card');
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  assert.ok(/y 63/.test(f.pitch) && /189/.test(f.pitch) && f.steps.some((s) => /y 63/.test(s) && /189/.test(s)), 'the text says where the base and the tip go');
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['size', 'flames', 'colour']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.deepStrictEqual(plain(F.options(ID, { size: '20', flames: 'maybe', colour: 'pink' })), { size: '127', flames: 'on', colour: 'charged' });
  assert.ok(f.opts[0].choices.every((c) => +c[0] >= 70), 'every height is at least 70');
  assert.strictEqual(63 + 127 - 1, 189, 'the default height covers y 63 to 189');
  assert.ok(f.opts.find((op) => op.id === 'colour').look, 'the creeper colour does not change the shape');
  assert.deepStrictEqual(plain(f.opts.find((op) => op.id === 'colour').choices.map((c) => c[0])), Object.keys(COLOURS));
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': 35 x 35, height, blocks, one piece, symmetric, hollow and sealed', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, H = +o.size, vol = C.volume(s);
    assert.deepStrictEqual([sx, sy, sz], [35, H, 35], 'exactly 35 x 35 and ' + H + ' high');
    // the fins reach every corner of the square, at the ground
    for (const [x, z] of [[0, 0], [34, 0], [0, 34], [34, 34]]) assert.ok(g.at(x, 0, z), 'a fin tip stands on the corner ' + [x, z]);
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p), d = C.def(p);
      assert.ok(DB[nm], nm + ' is a 26.3 block');
      assert.ok(C.known(p), nm + ' is known to the viewer');
      assert.strictEqual(d.shape, 'cube', nm + ' is a full cube');
      assert.ok(C.replaceable(p).ok, nm + ' can be swapped');
      assert.ok(d.fam !== 'gravity' && !/sand|gravel|powder|anvil|scaffolding/.test(nm), nm + ' does not fall');
    });
    const parts = pieces(g);
    assert.strictEqual(parts.length, 1, 'one connected piece, got ' + parts.length + ' (' + parts.slice(0, 6).join(', ') + ')');
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      assert.strictEqual(g.at(x, y, z), g.at(sx - 1 - x, y, z), 'mirror x at ' + [x, y, z]);
      assert.strictEqual(g.at(x, y, z), g.at(x, y, sz - 1 - z), 'mirror z at ' + [x, y, z]);
      assert.strictEqual(!g.at(x, y, z), !g.at(sz - 1 - z, y, x), 'quarter turn at ' + [x, y, z]);
    }
    // hollow: every block has air among its 26 neighbours, and the inside is sealed
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
    assert.ok(vol < 0.15 * sx * sy * sz, 'a shell, not a solid (' + vol + ' blocks)');
    // the silhouette: the body is never narrower than the head, the joint rings wider still; the nose tapers
    for (let y = BODY_Y; y < noseRing(H); y++) assert.ok(widthAt(g, y) >= 33, 'body ' + widthAt(g, y) + ' wide at y ' + y);
    assert.strictEqual(widthAt(g, HEAD.y0 + 1), 23);
    assert.strictEqual(widthAt(g, BODY_Y + 1), 35);
    for (const y of [RING_Y, RING_Y + 1, noseRing(H), noseRing(H) + 1]) assert.strictEqual(widthAt(g, y), 35, 'ring at y ' + y);
    // the collar widens from the head to the body
    for (let y = COLLAR_Y; y < RING_Y; y++) assert.strictEqual(widthAt(g, y), 27 + 2 * (y - COLLAR_Y), 'collar at y ' + y);
    // seen along a diagonal the body is still wider than the head: compare the spread across the other diagonal
    // (head blocks: the head box; body blocks: the cane rows inside the 17.5 radius, so the fins do not count)
    const spread = (y0, y1, keep) => { let lo = 99, hi = -99; for (let y = y0; y <= y1; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (g.at(x, y, z) && keep(x, z)) { lo = Math.min(lo, x - z); hi = Math.max(hi, x - z); } return (hi - lo) / Math.SQRT2; };
    const headD = spread(HEAD.y0, HEAD.y1, (x, z) => x >= HEAD.lo && x <= HEAD.hi && z >= HEAD.lo && z <= HEAD.hi);
    const bodyD = spread(BODY_Y, noseRing(H) - 1, (x, z) => Math.hypot(x - MID, z - MID) <= 17.5);
    assert.ok(bodyD > headD + 1, 'body ' + bodyD.toFixed(1) + ' vs head ' + headD.toFixed(1) + ' across the diagonal');
    for (let y = noseRing(H) + 3; y < H; y++) assert.ok(widthAt(g, y) <= widthAt(g, y - 1), 'the nose narrows at y ' + y);
    // the bottom: at least 16 wide everywhere below the head (flames or the nozzle)
    const lowest = o.flames === 'off' ? 10 : 0;
    for (let y = lowest; y < HEAD.y0; y++) assert.ok(widthAt(g, y) >= 16, 'bottom ' + widthAt(g, y) + ' wide at y ' + y);
    assert.ok(widthAt(g, 10) >= 16, 'the nozzle rim is at least 16 wide');
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });

  t(label + ': the cane body and nose, the rings, the flames', () => {
    const s = F.schematic(ID, o), g = grid(s), H = +o.size, yc = noseRing(H);
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    for (const b of CANE) assert.ok(counts[b] > 100, 'the cane uses ' + b);
    let nodes = 0;
    for (let y = BODY_Y + 1; y < yc; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) if (g.at(x, y, z) === 'bone_block' && g.at(x, y - 1, z) === 'lime_terracotta') nodes++;
    assert.ok(nodes >= 12 * Math.floor((yc - BODY_Y) / 16), 'node rows on the stalks (' + nodes + ')');
    // the neutral rocket set: rings light grey under bone, a white collar with a red top row, a white nose with grey
    // seams and red, white fins with red tips, a light grey nozzle with an orange rim, an iron spike
    for (const y of [RING_Y, yc]) { assert.strictEqual(g.at(0, y, MID), 'light_gray_concrete'); assert.strictEqual(g.at(0, y + 1, MID), 'bone_block'); }
    const only = (y0, y1, keep, set, what) => { for (let y = y0; y <= y1; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) { const b = g.at(x, y, z); if (b && keep(x, z)) assert.ok(set.includes(b), what + ': ' + b + ' at ' + [x, y, z]); } };
    const all = () => true, inner = (x, z) => Math.hypot(x - MID, z - MID) <= 17.5;
    only(RING_Y, RING_Y + 1, inner, RING, 'ring'); only(yc, yc + 1, inner, RING, 'ring');
    only(COLLAR_Y, RING_Y - 1, (x, z) => inner(x, z) && Math.abs(Math.abs(x - MID) - Math.abs(z - MID)) > 1, COLLAR, 'collar');   // the fins pass the collar on the diagonals
    only(yc + 2, H - 1, all, NOSE, 'nose');
    only(0, H - 1, (x, z) => !inner(x, z), FIN, 'fin');
    only(10, 14, (x, z) => Math.hypot(x - MID, z - MID) < 11, NOZZLE, 'nozzle');
    assert.ok(counts.red_concrete > 100 && counts.white_concrete > 1000, 'a white rocket with red');
    // a two-block iron spike on top
    assert.strictEqual(g.at(MID, H - 1, MID), 'iron_block');
    assert.strictEqual(g.at(MID, H - 2, MID), 'iron_block');
    let top = 0; for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) if (g.at(x, H - 1, z)) top++;
    assert.strictEqual(top, 1, 'a single spike block on top');
    const glow = GLOW.reduce((a, b) => a + (counts[b] || 0), 0);
    if (o.flames === 'off') {
      assert.strictEqual(glow, 0, 'no flames');
      for (let y = 0; y < 10; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) if (Math.hypot(x - MID, z - MID) < 13) assert.strictEqual(g.at(x, y, z), null, 'nothing under the nozzle at ' + [x, y, z]);
    } else {
      assert.ok(glow > 100, 'glowing flames');
      assert.ok(['yellow_concrete', 'glowstone'].includes(g.at(MID - 8, 9, MID)), 'yellow at the top of the flames');
      assert.ok(['red_concrete', 'orange_concrete'].includes(g.at(MID - 10, 0, MID)), 'red at the ground');
    }
  });
}

for (const col of Object.keys(COLOURS)) {
  t('creeper colour ' + col + ': the face on all four sides, its own colours, nothing else changes', () => {
    const o = { size: '100', flames: 'on', colour: col }, s = F.schematic(ID, o), g = grid(s), P = COLOURS[col];
    const sides = { south: (p, y) => g.at(HEAD.lo + p, y, HEAD.hi), north: (p, y) => g.at(HEAD.lo + p, y, HEAD.lo), east: (p, y) => g.at(HEAD.hi, y, HEAD.lo + p), west: (p, y) => g.at(HEAD.lo, y, HEAD.lo + p) };
    const onHead = new Set();
    for (const [side, get] of Object.entries(sides)) {
      let black = 0, dark = 0;
      for (let y = HEAD.y0; y <= HEAD.y1; y++) for (let p = 0; p <= 22; p++) {
        const got = get(p, y);
        assert.strictEqual(got, faceAt(col, p, 7 - Math.floor((y - HEAD.y0) / 3)), side + ' face at column ' + p + ', y ' + y);
        onHead.add(got);
        if (got === P.K) black++;
        if (got === P.D) dark++;
      }
      // eyes and mouth: 4 black texels in each half, the middle texel column 5 blocks wide (2 + the middle + 2)
      assert.strictEqual(black, 66, side + ': 66 black blocks');
      assert.strictEqual(dark, 105, side + ': 105 dark blocks');
    }
    // the face colours are nowhere else
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    assert.strictEqual(counts[P.K], 4 * 66);
    assert.strictEqual(counts[P.D], 4 * 105);
    // only the Green set uses cane greens on the creeper
    if (col !== 'green') for (const b of onHead) assert.ok(!CANE_GREEN.includes(b), col + ': ' + b + ' is a cane green on the head');
    // the colour changes the head and nothing else
    const b = grid(F.schematic(ID, { size: '100', flames: 'on', colour: 'charged' }));
    for (let y = 0; y < 100; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) {
      const inHead = y >= HEAD.y0 && y <= HEAD.y1 && x >= HEAD.lo && x <= HEAD.hi && z >= HEAD.lo && z <= HEAD.hi;
      assert.strictEqual(!g.at(x, y, z), !b.at(x, y, z), col + ': the same cells are filled');
      if (!inHead) assert.strictEqual(g.at(x, y, z), b.at(x, y, z), col + ': only the head changes, not ' + [x, y, z]);
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
t('the parts above the flames are the same with and without them', () => {
  const a = grid(F.schematic(ID, { size: '127', flames: 'on' })), b = grid(F.schematic(ID, { size: '127', flames: 'off' }));
  for (let y = 10; y < 127; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) assert.strictEqual(a.at(x, y, z), b.at(x, y, z), 'at ' + [x, y, z]);
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
t('exports to .schem, .litematic and JSON and reads back unchanged', async () => {
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
