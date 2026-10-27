// Tests for the mob-head statues in the Builds library (guardian and creeper head, js/modules/builds-farms.js).
//   node tools/test-heads.js            (-v lists every size with its blocks)
//   node tools/test-heads.js --stats    rewrites the size / block count table (STATS in builds-farms.js) of every
//                                       build with options (heads and the kraken), after changing a generator
// Builds every size / option of both heads in a VM with the game's block database and checks: mirror symmetry left to
// right, size, only known full-cube building blocks, one connected piece (no floating blocks), hollow, the eye / face
// counts, the twelve spikes, and that the files export and read back unchanged.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, Int8Array, Int32Array, Uint16Array, Uint32Array, DataView, Map, Set, Math, JSON, Object, Array, String, Number, Promise, Error };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('window.TH = { data: {}, langData: {}, icon: () => null };', ctx);
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js', 'js/modules/builds-farms.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const C = ctx.TH.builds.core, IO = ctx.TH.builds.io, F = ctx.TH.builds.farms, DB = ctx.TH.data.blockDb.b;

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const farm = (id) => F.FARMS.find((f) => f.id === id);
/** Every combination of a build's options. */
function combos(f) {
  let out = [{}];
  (f.opts || []).forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
  return out;
}
const SCALE = { 16: 1, 24: 1.5, 32: 2, 48: 3, 64: 4 };
const CREEPER = { 8: 1, 16: 2, 24: 3, 32: 4, 48: 6, 64: 8, 96: 12 };
const nameOf = (id) => C.parse(id).name;
const count = (s, test) => { let k = 0; const [sx, sy, sz] = s.size; for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (test(C.get(s, x, y, z), x, y, z)) k++; return k; };
/** Connected pieces (6 neighbours) of the blocks that pass `keep` (default: every block). */
function pieces(s, keep) {
  const [sx, sy, sz] = s.size, seen = new Uint8Array(sx * sy * sz), sizes = [];
  const ok = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && !C.isAir(C.get(s, x, y, z)) && (!keep || keep(C.get(s, x, y, z)));
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (!ok(x, y, z) || seen[C.idx(s, x, y, z)]) continue;
    let k = 0; const st = [[x, y, z]]; seen[C.idx(s, x, y, z)] = 1;
    while (st.length) {
      const [a, b, c] = st.pop(); k++;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = a + dx, Y = b + dy, Z = c + dz;
        if (ok(X, Y, Z) && !seen[C.idx(s, X, Y, Z)]) { seen[C.idx(s, X, Y, Z)] = 1; st.push([X, Y, Z]); }
      }
    }
    sizes.push(k);
  }
  return sizes;
}
function mirrorX(s) {
  const [sx, sy, sz] = s.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx / 2; x++) {
    assert.strictEqual(C.get(s, x, y, z), C.get(s, sx - 1 - x, y, z), s.name + ': not a mirror image at x ' + x + ' y ' + y + ' z ' + z);
  }
}
const report = [];

/* ---- library entries ---- */
t('both heads are Structures with tags, card art, options and steps', () => {
  for (const id of ['guardian_head', 'creeper_head']) {
    const f = farm(id);
    assert.ok(f, id + ' is in the library');
    assert.strictEqual(f.cat, 'build');
    assert.ok(f.tags.includes('statue') && f.tags.includes('mob-head'));
    assert.match(f.icon, /^item\/[a-z_]+_spawn_egg$/);
    assert.ok(Array.isArray(f.art) && /^entity\//.test(f.art[0]) && f.art.length >= 7);
    assert.ok(f.pitch && f.how && f.steps.length >= 3 && f.tips.length >= 2 && f.level && f.dim === 'overworld');
    f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  }
});
t('options fall back to the defaults', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.options('guardian_head', { size: '99', tail: 'maybe' }))), { size: '32', tail: 'off' });
  // saves from before the wider range keep their size: 16, 24 and 32 are still choices of both heads
  for (const v of ['16', '24', '32']) for (const id of ['guardian_head', 'creeper_head']) assert.strictEqual(F.options(id, { size: v }).size, v, id + ' keeps ' + v);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(farm('guardian_head').opts[0].choices.map((c) => c[0]))), ['16', '24', '32', '48', '64']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(farm('creeper_head').opts[0].choices.map((c) => c[0]))), ['8', '16', '24', '32', '48', '64', '96']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.options('creeper_head'))), { size: '24', colour: 'green' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.options('cow_crusher', { size: '16' }))), {});
  assert.strictEqual(F.schematic('guardian_head', { size: 'x' }), F.schematic('guardian_head'), 'same cache entry for the default');
  assert.ok(F.schematic('cow_crusher', { size: '16' }), 'old builds ignore options');
});

/* ---- every size ---- */
for (const id of ['guardian_head', 'creeper_head']) {
  for (const o of combos(farm(id))) {
    const label = id + ' ' + JSON.stringify(o);
    t(label + ': symmetric, known blocks, one piece', () => {
      const s = F.schematic(id, o), [sx, sy, sz] = s.size, vol = C.volume(s);
      mirrorX(s);
      s.palette.slice(1).forEach((p) => {
        const nm = nameOf(p);
        assert.ok(DB[nm], nm + ' is a 26.3 block');
        assert.ok(C.known(p), nm + ' is known to the viewer');
        assert.strictEqual(C.def(p).shape, 'cube', nm + ' is a full cube');
        assert.ok(C.replaceable(p).ok, nm + ' can be swapped in Customise blocks');
      });
      const parts = pieces(s);
      assert.strictEqual(parts.length, 1, 'one connected piece, got ' + parts.length + ' (' + parts.slice(0, 5).join(', ') + ')');
      report.push([label, s.size.join(' x '), vol, C.counts(s, true).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
      if (id === 'creeper_head') {
        const k = CREEPER[o.size], N = 8 * k;
        assert.deepStrictEqual([sx, sy, sz], [N, N, N]);
        assert.strictEqual(vol, N ** 3 - (N - 2) ** 3, 'hollow, one block thick');
        // the face, all black as in game: two 2 x 2 eyes, the nose (2), the mouth (4 + 4) and its two legs: 20 texels,
        // all on the south side, in both colours
        assert.strictEqual(count(s, (b) => nameOf(b) === 'black_concrete'), 20 * k * k);
        assert.strictEqual(count(s, (b, x, y, z) => nameOf(b) === 'black_concrete' && z !== N - 1), 0, 'the face is on the front');
        const want = ['........', '........', '.XX..XX.', '.XX..XX.', '...XX...', '..XXXX..', '..XXXX..', '..X..X..'];
        const blk = (c, r) => nameOf(C.get(s, c * k, N - 1 - r * k, N - 1));
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) assert.strictEqual(blk(c, r) === 'black_concrete', want[r][c] === 'X', 'face texel ' + c + ', ' + r);
        assert.ok(!count(s, (b) => /^(green|blue)_concrete$/.test(nameOf(b))), 'no dark colour inside the face');
        if (o.colour === 'charged') assert.ok(count(s, (b) => nameOf(b) === 'light_blue_wool') > 0, 'charged: light blue skin');
        assert.ok(vol < 100000, 'under 100 000 blocks');
      } else {
        const k = SCALE[o.size], body = 16 * k;
        assert.ok(sx >= body + 4 * k && sx <= 24 * k + 1 && sy === sx, 'width ' + sx + ' for a ' + body + ' body (spikes add about 3.2 px a side)');
        if (o.tail === 'on') assert.ok(sz > 40 * k, 'the tail reaches back'); else assert.strictEqual(sz, sx, 'a cube without the tail');
        // the eye: a red pupil framed by white on the front face
        assert.strictEqual(count(s, (b) => nameOf(b) === 'red_concrete'), k === 1.5 ? 16 : 4 * k * k, 'the pupil is 2 x 2 pixels');
        assert.ok(count(s, (b) => nameOf(b) === 'white_concrete') >= 10);
        // twelve spikes, orange, each its own piece touching the body
        const orange = (b) => /^orange_(wool|concrete|terracotta)$/.test(nameOf(b));
        assert.strictEqual(pieces(s, orange).length, 12, 'twelve spikes');
        // hollow: the middle of the body is air
        assert.ok(C.isAir(C.get(s, Math.floor(sx / 2), Math.floor(sy / 2), sz - 1 - Math.floor(sx / 2))), 'the body is hollow');
        // the head is the same with or without the tail (front half compared)
        if (o.tail === 'on') { const h0 = F.schematic(id, Object.assign({}, o, { tail: 'off' })); for (let y = 0; y < sy; y++) for (let z = 0; z < sx / 2; z++) for (let x = 0; x < sx; x++) assert.strictEqual(C.get(s, x, y, sz - 1 - z), C.get(h0, x, y, sx - 1 - z)); }
      }
    });
  }
}

/* ---- the size table (tooltips of the size keys) ---- */
/** [w, h, l, blocks, water] as the STATS table stores it. */
function measure(id, o) {
  const s = F.schematic(id, o), water = C.counts(s, true).filter((r) => nameOf(r.id) === 'water').reduce((a, r) => a + r.n, 0);
  return JSON.parse(JSON.stringify(s.size.concat([C.volume(s)], water ? [water] : [])));
}
/** One option set per table key (the 'look' options stay at their default). */
const statCombos = (f) => { const seen = new Map(); combos(f).forEach((o) => { const k = F.statKey(f, F.options(f.id, o)); if (!seen.has(k)) seen.set(k, o); }); return seen; };
if (process.argv.includes('--stats')) {
  const lines = [];
  F.FARMS.filter((f) => f.make && f.opts).forEach((f) => {
    lines.push('    ' + f.id + ': {');
    const rows = [...statCombos(f)].map(([k, o]) => "'" + k + "': [" + measure(f.id, o).join(', ') + ']');
    for (let i = 0; i < rows.length; i += 4) lines.push('      ' + rows.slice(i, i + 4).join(', ') + ',');
    lines.push('    },');
  });
  const file = path.join(root, 'js/modules/builds-farms.js'), src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/(\/\/ @stats-begin\n)[\s\S]*?(\s*\/\/ @stats-end)/, (m, a) => a + lines.join('\n') + '\n    // @stats-end');
  fs.writeFileSync(file, out);
  console.log('STATS rewritten: ' + lines.filter((l) => l.endsWith(': {')).length + ' builds');
  process.exit(0);
}
t('the size table matches every head size (tooltips)', () => {
  for (const id of ['guardian_head', 'creeper_head']) {
    const f = farm(id), m = statCombos(f);
    assert.strictEqual(Object.keys(F.STATS[id] || {}).length, m.size, id + ': one row per option set (run node tools/test-heads.js --stats)');
    for (const [k, o] of m) assert.deepStrictEqual(JSON.parse(JSON.stringify(F.STATS[id][k])), measure(id, o), id + ' ' + k + ' (run node tools/test-heads.js --stats)');
    const st = F.stats(id, { size: '16' });
    assert.ok(st && st.n > 0 && st.size.length === 3);
  }
});

/* ---- files ---- */
async function roundTrip(s, fmt) {
  const bytes = fmt === 'litematic' ? await IO.toLitematic(s) : await IO.toSchem(s);
  return IO.load({ name: 'x.' + fmt, bytes });
}
const countMap = (s) => Object.fromEntries(C.counts(s).map((x) => [x.id, x.n]));
t('both heads export to .schem, .litematic and JSON and read back unchanged', async () => {
  for (const [id, o] of [['guardian_head', { size: '16', tail: 'on' }], ['creeper_head', { size: '16' }]]) {
    const s = F.schematic(id, o);
    for (const fmt of ['schem', 'litematic']) {
      const back = await roundTrip(s, fmt);
      assert.deepStrictEqual(back.size, s.size, fmt + ' size');
      assert.deepStrictEqual(countMap(back), countMap(s), fmt + ' blocks');
    }
    const j = IO.fromJSON(JSON.parse(IO.toJSON(s)));
    assert.deepStrictEqual(countMap(j), countMap(s), 'json');
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  if (process.argv.includes('-v')) report.forEach((r) => console.log(r.join(' | ')));
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' head tests passed');
})();
