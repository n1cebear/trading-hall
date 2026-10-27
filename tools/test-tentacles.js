// Tests for the Kraken tentacles in the Builds library (js/modules/builds-farms.js, krakenTentacles).
//   node tools/test-tentacles.js        (-v lists every option set with its size and blocks)
// Builds every shape option (tentacles x height x pond) in a VM with the game's block database and checks: the height,
// known blocks, one connected creature (every tentacle reaches the body on the pond floor), one piece per tentacle above
// the water, the water only in the pond and never above the surface, foam on the water line, suckers, the same build
// every time, the colour sets, the size table, and that the files export and read back unchanged.
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

const ID = 'kraken_tentacles';
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const f = F.FARMS.find((x) => x.id === ID);
const plain = (v) => JSON.parse(JSON.stringify(v));
const nameOf = (id) => C.parse(id).name;
const COLOURS = {
  purple: ['purple_terracotta', 'purple_concrete', 'magenta_terracotta', 'pink_concrete'],
  green: ['dark_prismarine', 'prismarine', 'prismarine_bricks', 'sea_lantern'],
  red: ['red_terracotta', 'orange_terracotta', 'pink_terracotta', 'white_terracotta'],
};
/** Every combination of the options that change the shape (the colour stays at its default). */
function shapes() {
  let out = [{}];
  f.opts.filter((op) => !op.look).forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
  return out;
}
/** Names per cell, flat, so the checks below do not parse ids millions of times. */
function grid(s) {
  const names = s.palette.map((p) => (C.isAir(p) ? null : nameOf(p)));
  return { s, n: names, at: (x, y, z) => names[s.blocks[C.idx(s, x, y, z)]] };
}
/** Connected pieces (6 neighbours) of the cells that pass keep(name, y). */
function pieces(g, keep) {
  const [sx, sy, sz] = g.s.size, seen = new Uint8Array(sx * sy * sz), sizes = [];
  const ok = (x, y, z) => { if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return false; const nm = g.at(x, y, z); return !!nm && keep(nm, y); };
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (seen[C.idx(g.s, x, y, z)] || !ok(x, y, z)) continue;
    let k = 0; const st = [[x, y, z]]; seen[C.idx(g.s, x, y, z)] = 1;
    while (st.length) {
      const [a, b, c] = st.pop(); k++;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = a + dx, Y = b + dy, Z = c + dz;
        if (ok(X, Y, Z) && !seen[C.idx(g.s, X, Y, Z)]) { seen[C.idx(g.s, X, Y, Z)] = 1; st.push([X, Y, Z]); }
      }
    }
    sizes.push(k);
  }
  return sizes;
}
/** [{ name, y }] scan helper: the y levels a block name appears on. */
function levels(g, name) {
  const [sx, sy, sz] = g.s.size, ys = new Set();
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (g.at(x, y, z) === name) ys.add(y);
  return [...ys].sort((a, b) => a - b);
}
const report = [];

t('the kraken is a Structure with tags, card art, options and steps', () => {
  assert.ok(f, 'in the library');
  assert.strictEqual(f.cat, 'build');
  assert.ok(f.tags.includes('ocean') && f.tags.includes('creature') && f.tags.includes('statue'));
  assert.match(f.icon, /^item\/[a-z_]+_spawn_egg$/);
  assert.ok(Array.isArray(f.art) && /^entity\//.test(f.art[0]) && f.art.length >= 7);
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['count', 'size', 'colour', 'pond']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.ok(f.opts.find((op) => op.id === 'colour').look, 'the colour does not change the shape');
  assert.deepStrictEqual(plain(F.options(ID, { count: '9', size: 'x', colour: 'blue', pond: 'yes' })), { count: '5', size: '35', colour: 'purple', pond: 'pond' });
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': height, blocks, one creature, one piece per tentacle above the water', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, vol = C.volume(s), n = +o.count, H = +o.size;
    assert.strictEqual(sy, H, 'as high as the option says');
    assert.ok(sx <= 2.5 * H && sz <= 2.5 * H, 'footprint ' + sx + ' x ' + sz);
    assert.ok(vol < 100000, 'under 100 000 blocks');
    const pal = COLOURS.purple;
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p);
      assert.ok(DB[nm], nm + ' is a 26.3 block');
      assert.ok(C.known(p), nm + ' is known to the viewer');
      if (nm !== 'water') { assert.strictEqual(C.def(p).shape, 'cube', nm + ' is a full cube'); assert.ok(C.replaceable(p).ok, nm + ' can be swapped'); }
    });
    pal.forEach((b) => assert.ok(s.palette.some((p) => nameOf(p) === b), b + ' is used'));
    // the water line: the top water layer with the pond, the foam layer without it
    const foamY = levels(g, 'white_concrete');
    assert.strictEqual(foamY.length, 1, 'the foam lies on one level');
    const ws = foamY[0];
    assert.ok(levels(g, 'calcite').every((y) => y === ws), 'the spray too');
    const water = levels(g, 'water');
    if (o.pond === 'pond') {
      assert.ok(water.length && water[water.length - 1] === ws && water[0] === 1, 'water from the floor up to the foam (' + water.join(',') + ')');
      assert.ok(levels(g, 'sand').length && levels(g, 'gravel').length, 'a sand and gravel floor and shore');
      // the water sits in a closed basin: no water cell has open air beside or below it
      for (let y = 1; y <= ws; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        if (g.at(x, y, z) !== 'water') continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          assert.ok(X >= 0 && Z >= 0 && X < sx && Z < sz && Y >= 0, 'water at the edge of the build at ' + [x, y, z]);
          assert.ok(g.at(X, Y, Z) !== null || false, 'water leaks into air at ' + [X, Y, Z]);
        }
      }
    } else {
      assert.strictEqual(water.length, 0, 'tentacles only: no water');
      assert.ok(!levels(g, 'sand').length, 'and no pond');
    }
    // one creature: every block except the water is one piece, so every tentacle reaches the body on the floor
    const all = pieces(g, (nm) => nm !== 'water');
    assert.strictEqual(all.length, 1, 'one connected piece without the water, got ' + all.length + ' (' + all.slice(0, 6).join(', ') + ')');
    // above the water every tentacle stands on its own (the arch counts once: both its ends are under the surface);
    // a sucker cut off by the window's lower edge may show as a crumb, it is attached below (checked just above)
    const up = pieces(g, (nm, y) => y > ws + 1 && nm !== 'water').filter((k) => k >= 12);
    assert.strictEqual(up.length, n, n + ' tentacles above the water, got ' + up.length + ' (' + up.join(', ') + ')');
    // suckers on every tentacle
    const sucker = pal[3];
    assert.ok(C.counts(s, true).find((r) => nameOf(r.id) === sucker).n >= 4 * n, 'suckers');
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).slice(0, 6).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });
}

t('the same options always give the same build', () => {
  for (const o of [{ count: '3', size: '20', pond: 'pond' }, { count: '7', size: '35', pond: 'none' }]) {
    const a = f.make(F.options(ID, o)), b = f.make(F.options(ID, o));
    assert.deepStrictEqual(plain(a.size), plain(b.size));
    assert.deepStrictEqual(plain(a.palette), plain(b.palette));
    assert.ok(a.blocks.every((v, i) => v === b.blocks[i]), 'same blocks');
  }
});
t('the colour sets change only the blocks, not the shape', () => {
  const base = F.schematic(ID, { count: '5', size: '20', colour: 'purple' });
  for (const col of ['green', 'red']) {
    const s = F.schematic(ID, { count: '5', size: '20', colour: col });
    assert.deepStrictEqual(plain(s.size), plain(base.size));
    for (let i = 0; i < s.blocks.length; i++) assert.strictEqual(!s.blocks[i], !base.blocks[i], col + ': the same cells are filled');
    COLOURS[col].forEach((b) => assert.ok(s.palette.some((p) => nameOf(p) === b), col + ' uses ' + b));
    COLOURS.purple.forEach((b) => assert.ok(!s.palette.some((p) => nameOf(p) === b), col + ' has no ' + b));
  }
});
t('the size table matches every option set (tooltips)', () => {
  const seen = new Set();
  for (const o of shapes()) {
    const s = F.schematic(ID, o), water = C.counts(s, true).filter((r) => nameOf(r.id) === 'water').reduce((a, r) => a + r.n, 0);
    const k = F.statKey(f, F.options(ID, o));
    seen.add(k);
    assert.deepStrictEqual(plain(F.STATS[ID][k]), plain(s.size.concat([C.volume(s)], water ? [water] : [])), k + ' (run node tools/test-heads.js --stats)');
  }
  assert.strictEqual(Object.keys(F.STATS[ID]).length, seen.size);
});

async function roundTrip(s, fmt) {
  const bytes = fmt === 'litematic' ? await IO.toLitematic(s) : await IO.toSchem(s);
  return IO.load({ name: 'x.' + fmt, bytes });
}
const countMap = (s) => Object.fromEntries(C.counts(s).map((x) => [x.id, x.n]));
t('exports to .schem, .litematic and JSON and reads back unchanged (water included)', async () => {
  for (const o of [{ count: '3', size: '20', pond: 'pond', colour: 'green' }, { count: '5', size: '20', pond: 'none', colour: 'red' }]) {
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
t('the material list counts the water as buckets and nothing else as water', () => {
  const s = F.schematic(ID, { count: '3', size: '20', pond: 'pond' });
  const m = C.materials(s), w = m.find((r) => r.item === 'minecraft:water_bucket');
  assert.ok(w && w.n === C.counts(s, true).find((r) => nameOf(r.id) === 'water').n, 'one bucket per water block');
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  if (process.argv.includes('-v')) report.forEach((r) => console.log(r.join(' | ')));
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' tentacle tests passed');
})();
