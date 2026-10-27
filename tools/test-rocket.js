// Tests for the Creeper rocket in the Builds library (js/modules/builds-farms.js, creeperRocket).
//   node tools/test-rocket.js        (-v lists every option set with its size and blocks)
// Builds every option set (height x flames) in a VM with the game's block database and checks: exactly 35 x 35 wide
// and as high as the option says (at least 70), known full-cube blocks that can be swapped and never fall, one connected
// piece, mirror symmetric on both horizontal axes (and the parts below the head top turn 90 degrees onto themselves),
// hollow (every block touches air, the inside is sealed off from the outside), the creeper face on all four sides of the
// head texel by texel, the sugar cane colours and nodes on the tube, the flames, the size table, the same build every
// time, and that the files export and read back unchanged.
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
// the layout the generator promises: the head is 25 wide (x and z 5..29) from y 12 to 35, the tube starts at y 38
const HEAD = { lo: 5, hi: 29, y0: 12, y1: 35 }, TUBE_Y = 38, MID = 17;
// the creeper's face (entity/creeper/creeper.png, texels 8..15 x 8..15), left half; the right half is its mirror
const FACE = ['PMGP', 'MGGG', 'GDDP', 'GDKG', 'PGPD', 'PMDK', 'PMKK', 'PPDP'];
const FACE_BLOCK = { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' };
/** The face block at column p (0..24 across the side) and row r (0 = top texel row). */
const faceAt = (p, r) => FACE_BLOCK[FACE[r][Math.min(3, Math.floor((p <= 12 ? p : 24 - p) / 3))]];
const SUGAR = ['lime_wool', 'bamboo_block', 'bone_block', 'lime_concrete', 'lime_terracotta', 'moss_block'];
const FIRE = ['yellow_concrete', 'glowstone', 'shroomlight', 'red_concrete'];

function shapes() {
  let out = [{}];
  f.opts.forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
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
const report = [];

t('the rocket is a Structure with tags, card art, options and steps', () => {
  assert.ok(f, 'in the library');
  assert.strictEqual(f.cat, 'build');
  assert.ok(f.tags.includes('statue') && f.tags.includes('mob-head'));
  f.tags.forEach((tg) => assert.match(tg, /^[a-z-]+$/));
  assert.strictEqual(f.icon, 'item/firework_rocket');
  assert.ok(!f.art, 'the card shows the rocket icon, so it does not look like the Creeper head card');
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['size', 'flames']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.deepStrictEqual(plain(F.options(ID, { size: '20', flames: 'maybe' })), { size: '80', flames: 'on' });
  assert.ok(f.opts[0].choices.every((c) => +c[0] >= 70), 'every height is at least 70');
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': 35 x 35, height, blocks, one piece, symmetric, hollow and sealed', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, H = +o.size, vol = C.volume(s);
    assert.deepStrictEqual([sx, sy, sz], [35, H, 35], 'exactly 35 x 35 and ' + H + ' high');
    assert.ok(sy >= 70);
    // the fins reach every edge of the square, at the ground
    for (const [x, z] of [[0, 0], [34, 0], [0, 34], [34, 34]]) assert.ok(g.at(x, 0, z), 'a fin tip stands on the corner ' + [x, z]);
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p), d = C.def(p);
      assert.ok(DB[nm], nm + ' is a 26.3 block');
      assert.ok(C.known(p), nm + ' is known to the viewer');
      assert.strictEqual(d.shape, 'cube', nm + ' is a full cube');
      assert.ok(C.replaceable(p).ok, nm + ' can be swapped');
      assert.ok(d.fam !== 'gravity' && !/sand|gravel|powder|anvil|scaffolding/.test(nm), nm + ' does not fall');
    });
    // one piece: the fins hold the head, the flames hang on the nozzle
    const parts = pieces(g);
    assert.strictEqual(parts.length, 1, 'one connected piece, got ' + parts.length + ' (' + parts.slice(0, 6).join(', ') + ')');
    // mirror symmetric left to right and front to back
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      assert.strictEqual(g.at(x, y, z), g.at(sx - 1 - x, y, z), 'mirror x at ' + [x, y, z]);
      assert.strictEqual(g.at(x, y, z), g.at(x, y, sz - 1 - z), 'mirror z at ' + [x, y, z]);
    }
    // the shape (not the colours) turns onto itself by 90 degrees, every layer
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) assert.strictEqual(!g.at(x, y, z), !g.at(sz - 1 - z, y, x), 'quarter turn at ' + [x, y, z]);
    // hollow: every block has air among its 26 neighbours ...
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!g.at(x, y, z)) continue;
      let air = false;
      for (let dy = -1; dy <= 1 && !air; dy++) for (let dz = -1; dz <= 1 && !air; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !g.at(x + dx, y + dy, z + dz)) { air = true; break; }
      assert.ok(air, 'a buried block at ' + [x, y, z]);
    }
    // ... and the inside is one sealed room: the middle of the head, the tube and the nose are air nobody outside reaches
    const out = outsideAir(g);
    for (const y of [HEAD.y0 + 6, HEAD.y0 + 18, TUBE_Y + 4, H - 12]) {
      assert.strictEqual(g.at(MID, y, MID), null, 'hollow at y ' + y);
      assert.ok(!out(MID, y, MID), 'sealed at y ' + y);
    }
    assert.ok(vol < 0.15 * sx * sy * sz, 'a shell, not a solid (' + vol + ' blocks)');
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });

  t(label + ': the creeper face on all four sides, the cane tube, the flames', () => {
    const s = F.schematic(ID, o), g = grid(s), H = +o.size;
    const sides = { south: (p, y) => g.at(HEAD.lo + p, y, HEAD.hi), north: (p, y) => g.at(HEAD.lo + p, y, HEAD.lo), east: (p, y) => g.at(HEAD.hi, y, HEAD.lo + p), west: (p, y) => g.at(HEAD.lo, y, HEAD.lo + p) };
    for (const [side, get] of Object.entries(sides)) {
      let black = 0, dark = 0;
      for (let y = HEAD.y0; y <= HEAD.y1; y++) for (let p = 0; p <= 24; p++) {
        const want = faceAt(p, 7 - Math.floor((y - HEAD.y0) / 3)), got = get(p, y);
        assert.strictEqual(got, want, side + ' face at column ' + p + ', y ' + y);
        if (got === 'black_concrete') black++;
        if (got === 'green_concrete') dark++;
      }
      // eyes and mouth: 4 black texels in each half, the middle texel column 7 blocks wide (3 + the middle + 3)
      assert.strictEqual(black, 78, side + ': 78 black blocks');
      assert.strictEqual(dark, 111, side + ': 111 dark green blocks');
    }
    // the face blocks are only on the head's sides
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    assert.strictEqual(counts.black_concrete, 4 * 78);
    assert.strictEqual(counts.green_concrete, 4 * 111);
    // the tube: the sugar cane colours, each stalk with its pale node row over a dark one
    for (const b of SUGAR) assert.ok(counts[b] > 100, 'the cane uses ' + b);
    let nodes = 0;
    for (let y = TUBE_Y + 1; y < H - 20; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) if (g.at(x, y, z) === 'bone_block' && g.at(x, y - 1, z) === 'lime_terracotta') nodes++;
    assert.ok(nodes >= 12 * Math.floor((H - 20 - TUBE_Y) / 16), 'node rows on the stalks (' + nodes + ')');
    // a joint ring (dark under pale) on the head and under the nose, 25 wide
    for (const y of [HEAD.y1 + 1, H - 18]) { assert.strictEqual(g.at(HEAD.lo, y, MID), 'lime_terracotta', 'dark joint ring at y ' + y); assert.strictEqual(g.at(HEAD.lo, y + 1, MID), 'bone_block', 'pale joint ring at y ' + (y + 1)); }
    // the nose ends in a one-block spike at the top
    assert.strictEqual(g.at(MID, H - 1, MID), 'bone_block');
    let top = 0; for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) if (g.at(x, H - 1, z)) top++;
    assert.strictEqual(top, 1, 'a single spike block on top');
    // the flames: from the nozzle down to the ground, or none
    const fire = FIRE.reduce((a, b) => a + (counts[b] || 0), 0);
    if (o.flames === 'off') {
      assert.strictEqual(fire, 0, 'no flames');
      assert.strictEqual(g.at(MID, 0, MID), null);
    } else {
      assert.ok(fire > 100, 'flames');
      assert.ok(/^(orange|red)_concrete$/.test(g.at(MID, 0, MID)), 'the flame touches the ground');
    }
  });
}

t('the same options always give the same build', () => {
  for (const o of [{ size: '70', flames: 'on' }, { size: '100', flames: 'off' }]) {
    const a = f.make(F.options(ID, o)), b = f.make(F.options(ID, o));
    assert.deepStrictEqual(plain(a.size), plain(b.size));
    assert.deepStrictEqual(plain(a.palette), plain(b.palette));
    assert.ok(a.blocks.every((v, i) => v === b.blocks[i]), 'same blocks');
  }
});
t('the parts above the flames are the same with and without them', () => {
  const a = grid(F.schematic(ID, { size: '80', flames: 'on' })), b = grid(F.schematic(ID, { size: '80', flames: 'off' }));
  for (let y = 8; y < 80; y++) for (let z = 0; z < 35; z++) for (let x = 0; x < 35; x++) assert.strictEqual(a.at(x, y, z), b.at(x, y, z), 'at ' + [x, y, z]);
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
  for (const o of [{ size: '70', flames: 'on' }, { size: '100', flames: 'off' }]) {
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
