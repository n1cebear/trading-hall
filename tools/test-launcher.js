// Tests for the Creeper launcher in the Builds library (js/modules/builds-farms.js, creeperRocket(o, { launcher: true })).
//   node tools/test-launcher.js        (-v lists every option set with its size and blocks)
// Checks: the Creeper rocket is unchanged (block hashes from before the launcher shared its code); 64 x 36 with the
// boosters, 36 x 36 core only, as high as the option says; known blocks (cubes, glass, slabs, stairs, buttons,
// carpets) that never fall, no copper; one connected piece; the shape mirror symmetric (the 2 x 1 chamber the one
// exception front to back); hollow; the head exactly 32 rows with its roof as the 32nd, its room 30 x 30 x 30; the
// cane room 34 across and tall; the sealed 2 x 1 x 3 chamber; spawn-proof outside and in the sealed pockets; the face on
// all four sides; the cane only greens, sand and glass, with three sand bands; the boosters; the options; the size
// table; and that the files export and read back unchanged.
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

const ID = 'creeper_launcher';
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const f = F.FARMS.find((x) => x.id === ID);
const plain = (v) => JSON.parse(JSON.stringify(v));
const nameOf = (id) => C.parse(id).name;
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE = ['PMGP', 'MGGG', 'GDDP', 'GDKG', 'PGPD', 'PMDK', 'PMKK', 'PPDP'];
const COLOURS = {
  charged: { K: 'black_concrete', D: 'blue_concrete', M: 'cyan_concrete', G: 'light_blue_concrete', P: 'light_blue_wool', W: 'white_concrete' },
  grey: { K: 'black_concrete', D: 'gray_concrete', M: 'tuff', G: 'andesite', P: 'stone', W: 'polished_diorite' },
  ember: { K: 'black_concrete', D: 'red_nether_bricks', M: 'red_terracotta', G: 'orange_terracotta', P: 'orange_concrete', W: 'yellow_concrete' },
  green: { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' },
};
const faceAt = (col, p, r) => COLOURS[col][FACE[r][Math.floor((p < 16 ? p : 31 - p) / 4)]];
const GREENS = ['lime_wool', 'lime_concrete', 'green_wool', 'green_concrete', 'green_terracotta', 'moss_block'];
const SAND = ['smooth_sandstone', 'cut_sandstone', 'sandstone', 'chiseled_sandstone'];
const YH = 15, YT = 46, YB = 47;   // head bottom, roof (the head's 32nd row), first row of the cane body
const noseY = (H) => H - Math.round((H - YB - 1) / 3);

function shapes() {
  let out = [{}];
  f.opts.filter((op) => !op.look).forEach((op) => { out = out.flatMap((o) => op.choices.map((c) => Object.assign({}, o, { [op.id]: c[0] }))); });
  return out;
}
/** Grid helpers, with the core's centre and the head box for this size (the core sits in the middle of the width). */
function grid(s) {
  const ids = s.palette.map((p) => (C.isAir(p) ? null : p)), names = ids.map((p) => p && nameOf(p));
  const [sx, sy, sz] = s.size;
  const idx = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -1 : s.blocks[C.idx(s, x, y, z)]);
  const at = (x, y, z) => { const k = idx(x, y, z); return k < 0 ? null : names[k]; };
  const id = (x, y, z) => { const k = idx(x, y, z); return k < 0 ? null : ids[k]; };
  const cx = sx / 2 - 0.5, cz = sz / 2 - 0.5;
  return { s, at, id, sx, sy, sz, cx, cz, head: { x0: cx - 15.5, x1: cx + 15.5, z0: cz - 15.5, z1: cz + 15.5 } };
}
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
function rooms(g) {
  const W = g.sx, L = g.sz, n = W * g.sy * L, r = new Int32Array(n), id = (x, y, z) => (y * L + z) * W + x, size = [0, 0];
  const flood = (x0, y0, z0, k) => {
    const st = [[x0, y0, z0]]; r[id(x0, y0, z0)] = k; size[k] = 1;
    while (st.length) {
      const [a, b, c] = st.pop();
      for (const [dx, dy, dz] of N6) {
        const X = a + dx, Y = b + dy, Z = c + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= W || Y >= g.sy || Z >= L || r[id(X, Y, Z)] || g.at(X, Y, Z)) continue;
        r[id(X, Y, Z)] = k; size[k]++; st.push([X, Y, Z]);
      }
    }
  };
  for (let y = 0; y < g.sy; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) if ((!x || !z || !y || x === W - 1 || z === L - 1 || y === g.sy - 1) && !g.at(x, y, z) && !r[id(x, y, z)]) flood(x, y, z, 1);
  let k = 2;
  for (let y = 0; y < g.sy; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) if (!g.at(x, y, z) && !r[id(x, y, z)]) { size.push(0); flood(x, y, z, k++); }
  return { room: (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= g.sy || z >= L ? 1 : r[id(x, y, z)]), size };
}
/** Width of a layer along a row of z, from x0 to x1 (the first to the last block in that range). */
function widthAt(g, y, z, x0 = 0, x1 = g.sx - 1) {
  let lo = -1, hi = -1;
  for (let x = x0; x <= x1; x++) if (g.at(x, y, z)) { if (lo < 0) lo = x; hi = x; }
  return lo < 0 ? 0 : hi - lo + 1;
}
function fullTop(id) {
  const d = C.def(id), p = C.parse(id).props;
  if (d.shape === 'cube') return d.fam !== 'glass';
  if (d.shape === 'slab') return p.type === 'top' || p.type === 'double';
  if (d.shape === 'stairs') return p.half === 'top';
  return false;
}
const cnt = (s) => Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
const report = [];

t('the Creeper rocket is unchanged (block hashes from before the launcher shared its generator)', () => {
  const hash = (s) => { let h = 2166136261 >>> 0; const mix = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } }; mix(s.size.join(',')); for (let i = 0; i < s.blocks.length; i++) { mix(s.palette[s.blocks[i]] || ''); mix('|'); } return h.toString(16); };
  const BEFORE = { '{}': 'fd8fe711', '{"size":"100"}': '6d52ff45', '{"flames":"off"}': '2a19d07d', '{"size":"100","flames":"off"}': 'ceb4765d', '{"colour":"grey","fill":"glass","wear":"clean"}': 'e3cf6754', '{"colour":"ember","fill":"mixed","wear":"rusty"}': '8aa27916', '{"colour":"green","size":"100","wear":"clean"}': '6d8646e2' };
  for (const [k, v] of Object.entries(BEFORE)) assert.strictEqual(hash(F.schematic('creeper_rocket', JSON.parse(k))), v, 'creeper_rocket ' + k);
});

t('the launcher is a Structure with tags, icon, options and steps', () => {
  assert.ok(f && f.cat === 'build' && f.icon === 'item/firework_rocket' && f.tags.includes('statue') && f.tags.includes('mob-head'));
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  for (const s of ['y 63', '189', '64 x 36', '36 x 36', '2 x 1']) assert.ok(f.pitch.includes(s), 'the pitch says ' + s);
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['size', 'flames', 'boosters', 'colour', 'fill', 'wear']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.deepStrictEqual(plain(F.options(ID, {})), { size: '127', flames: 'on', boosters: 'on', colour: 'charged', fill: 'sandy', wear: 'weathered' });
  for (const id of ['colour', 'fill', 'wear']) assert.ok(f.opts.find((op) => op.id === id).look);
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': size, blocks, one piece, symmetric, hollow, rooms, chamber, spawn-proof, head of 32 rows, boosters', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, H = +o.size, yn = noseY(H), B = o.boosters === 'on', vol = C.volume(s);
    assert.deepStrictEqual([sx, sy, sz], [B ? 64 : 36, H, 36]);
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p), d = C.def(p);
      assert.ok(DB[nm] && C.known(p), nm + ' is a known 26.3 block');
      assert.ok(['cube', 'slab', 'stairs', 'button', 'carpet'].includes(d.shape), nm + ' ' + d.shape);
      assert.ok(C.replaceable(p).ok, nm + ' can be swapped');
      assert.ok(d.fam !== 'gravity' && !/(^|_)sand$|gravel|powder|anvil|scaffolding|copper/.test(nm), nm + ' does not fall and is no copper');
    });
    assert.strictEqual(pieces(g).length, 1, 'one connected piece (the boosters are attached)');
    const chamberBox = (x, y, z) => Math.abs(x - g.cx) <= 3 && z >= g.cz - 3 && z <= g.cz + 3 && y >= H - 14 && y <= H - 8;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const here = !g.at(x, y, z);
      assert.strictEqual(here, !g.at(sx - 1 - x, y, z), 'mirror x at ' + [x, y, z]);
      if (!chamberBox(x, y, z) && !chamberBox(x, y, sz - 1 - z)) assert.strictEqual(here, !g.at(x, y, sz - 1 - z), 'mirror z at ' + [x, y, z]);
      if (here) continue;
      let air = false;
      for (let dy = -1; dy <= 1 && !air; dy++) for (let dz = -1; dz <= 1 && !air; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !g.at(x + dx, y + dy, z + dz)) { air = true; break; }
      assert.ok(air, 'a buried block at ' + [x, y, z]);
    }
    // the head: exactly 32 rows (y 15..46), the roof the 32nd; nothing of the head's skin below or above
    const R = rooms(g), X = g.cx - 0.5, Z = g.cz - 0.5;
    const head = R.room(X, YH + 15, Z), body = R.room(X, YB + 6, Z), ch = R.room(X, H - 11, Z);
    assert.ok(head > 1 && body > 1 && ch > 1 && new Set([head, body, ch]).size === 3, 'three separate sealed rooms');
    assert.strictEqual(R.size[head], 30 * 30 * 30, 'the head room is 30 x 30 x 30');
    for (let y = YH; y <= YT; y++) assert.ok(g.at(g.head.x0, y, Z), 'the face side at y ' + y);
    assert.ok(!g.at(g.head.x0, YH - 1, Z) || !/(wool|concrete)$/.test(g.at(g.head.x0, YH - 1, Z)), 'no head row under y 15');
    // over the roof: the body (its tuff ring at the edge, its room inside), never another row of creeper skin
    for (let x = g.head.x0; x <= g.head.x1; x++) assert.ok(!Object.values(COLOURS.charged).includes(g.at(x, YB, Z)), 'no creeper skin at y 47, x ' + x);
    assert.strictEqual(R.room(X, YB, Z), body, 'the body room starts right on the roof');
    assert.strictEqual(g.at(g.head.x0 - 1, YT, Z), null, 'no collar row beside the roof');
    let clear = 0; for (let y = YB; y < yn && R.room(X, y, Z) === body; y++) clear++;
    assert.ok(clear >= (H >= 127 ? 45 : 15), 'the body room is ' + clear + ' high');
    assert.ok(yn - YB >= 2 * (H - yn), 'the cane body is twice the nose');
    const mid = Math.floor((YB + yn) / 2);
    assert.strictEqual(widthAt(g, mid, Z, g.cx - 17.5, g.cx + 17.5), 36, 'the core is 36 wide');
    let across = 0; for (let x = g.cx - 17.5; x <= g.cx + 17.5; x++) if (R.room(x, mid, Z) === body) across++;
    assert.strictEqual(across, 34, 'the cane room is 34 across');
    assert.strictEqual(R.size[ch], 6, 'the chamber holds 6 blocks of air');
    for (const x of [X, X + 1]) { assert.ok(R.room(x, H - 11, Z) === ch && R.room(x, H - 10, Z) === ch && R.room(x, H - 12, Z) === ch); assert.match(g.id(x, H - 13, Z), /_slab\[type=bottom\]$/, 'a slab floor'); }
    assert.strictEqual(widthAt(g, H - 1, Z), 2, 'the spike ends 2 wide on top');
    const spots = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const id = g.id(x, y, z);
      if (!id || !fullTop(id) || g.at(x, y + 1, z)) continue;
      const rm = R.room(x, y + 1, z);
      if (rm !== head && rm !== body) spots.push([x, y, z].join(','));
    }
    assert.strictEqual(spots.length, 0, 'spawnable tops: ' + spots.slice(0, 8).join(' | '));
    for (let y = o.flames === 'off' ? 10 : 0; y < YH; y++) assert.ok(widthAt(g, y, Z, g.cx - 17.5, g.cx + 17.5) >= 16, 'the core bottom is at least 16 wide at y ' + y);
    if (B) {
      // the boosters: 14 wide, east and west, a cone on top at 70 to 85 % of the height, their own nozzles and flames
      const bx = g.cx - 25, top = (() => { let y = sy - 1; while (y > 0 && !g.at(Math.floor(bx), y, Z)) y--; return y; })();
      assert.strictEqual(widthAt(g, 60, Z, 0, Math.floor(g.cx - 18)), 14, 'a 14 wide booster');
      assert.ok(top >= 0.75 * H && top <= 0.85 * H, 'the booster tip at ' + top);
      for (let y = o.flames === 'off' ? 10 : 0; y < YH; y++) assert.ok(widthAt(g, y, Z, 0, Math.floor(g.cx - 18)) >= 8, 'the booster bottom is at least 8 wide at y ' + y);
      const br = R.room(Math.floor(bx), 50, Z);
      assert.ok(br > 1 && br !== body && br !== head, 'the booster is hollow and sealed on its own, apart from the farm rooms');
      assert.strictEqual(R.room(Math.floor(sx - 1 - bx), 50, Z) === br, false, 'each booster is its own room');
    }
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).slice(0, 12).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });

  t(label + ': the cane: greens, sand and glass only, green stalks with nodes, three sand bands', () => {
    const s = F.schematic(ID, o), g = grid(s), H = +o.size, yn = noseY(H);
    let green = 0, wall = 0, nodes = 0, bands = 0;
    for (let y = YB + 2; y < yn - 2; y++) {
      let row = 0, sand = 0;
      for (let z = 0; z < 36; z++) for (let x = 0; x < g.sx; x++) {
        if (Math.hypot(x - g.cx, z - g.cz) > 18.5) continue;
        const b = g.at(x, y, z);
        if (!b) continue;
        assert.ok(GREENS.includes(b) || SAND.includes(b) || b === 'glass', 'the cane is green, sand or glass: ' + b + ' at ' + [x, y, z]);
        wall++; row++;
        if (GREENS.includes(b)) green++;
        if (SAND.includes(b)) sand++;
        if (b === 'lime_wool' && ['green_wool', 'green_concrete'].includes(g.at(x, y - 1, z))) nodes++;
      }
      if (sand === row) bands++;
    }
    assert.ok(green > 0.55 * wall, 'green stalks make most of the cane (' + green + ' of ' + wall + ')');
    assert.ok(nodes > 100, 'pale node rims over dark bands (' + nodes + ')');
    assert.strictEqual(bands, 6, 'three sand bands of 2 rows');
  });
}

for (const col of Object.keys(COLOURS)) {
  t('creeper colour ' + col + ': the face on all four sides, only the head changes', () => {
    const s = F.schematic(ID, { size: '100', colour: col }), g = grid(s), P = COLOURS[col], h = g.head;
    const sides = { south: (p, y) => g.at(h.x0 + p, y, h.z1), north: (p, y) => g.at(h.x0 + p, y, h.z0), east: (p, y) => g.at(h.x1, y, h.z0 + p), west: (p, y) => g.at(h.x0, y, h.z0 + p) };
    for (const [side, get] of Object.entries(sides)) {
      let black = 0, dark = 0;
      for (let y = YH; y <= YT; y++) for (let p = 0; p < 32; p++) {
        const got = get(p, y);
        assert.strictEqual(got, faceAt(col, p, 7 - Math.floor((y - YH) / 4)), side + ' face at ' + p + ', y ' + y);
        if (got === P.K) black++;
        if (got === P.D) dark++;
      }
      assert.strictEqual(black, 128); assert.strictEqual(dark, 192);
    }
    const b = grid(F.schematic(ID, { size: '100', colour: 'charged' }));
    const inHead = (x, y, z) => y >= YH && y <= YT && x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1;
    for (let y = 0; y < 100; y++) for (let z = 0; z < 36; z++) for (let x = 0; x < g.sx; x++) if (!inHead(x, y, z) && !(y === YB && /_carpet$/.test(g.at(x, y, z) || ''))) assert.strictEqual(g.id(x, y, z), b.id(x, y, z), col + ': only the head changes at ' + [x, y, z]);
  });
}

t('cane wall and wear: glass between the stalks, no copper, clean has no moss; the same shape', () => {
  const sandy = cnt(F.schematic(ID, { size: '100' })), glass = cnt(F.schematic(ID, { size: '100', fill: 'glass' })), mixed = cnt(F.schematic(ID, { size: '100', fill: 'mixed' }));
  assert.ok(!sandy.glass && glass.glass > 300 && mixed.glass > 80);
  const clean = cnt(F.schematic(ID, { size: '100', wear: 'clean' })), rusty = cnt(F.schematic(ID, { size: '100', wear: 'rusty' }));
  const sum = (c, re) => Object.entries(c).filter(([n]) => re.test(n)).reduce((a, [, n]) => a + n, 0);
  assert.strictEqual(sum(clean, /moss|^brown_|cracked/), 0, 'clean');
  assert.ok(sum(rusty, /moss|^brown_|cracked/) > sum(cnt(F.schematic(ID, { size: '100' })), /moss|^brown_|cracked/), 'rusty shows more wear');
  for (const c of [sandy, glass, mixed, clean, rusty]) assert.strictEqual(sum(c, /copper/), 0);
});
t('the same options always give the same build', () => {
  const o = { size: '100', boosters: 'on', wear: 'rusty' }, a = f.make(F.options(ID, o)), b = f.make(F.options(ID, o));
  assert.ok(a.blocks.every((v, i) => v === b.blocks[i]) && JSON.stringify(a.palette) === JSON.stringify(b.palette));
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
  const s = F.schematic(ID, { size: '100' });
  for (const fmt of ['schem', 'litematic']) {
    const back = await roundTrip(s, fmt);
    assert.deepStrictEqual(plain(back.size), plain(s.size), fmt + ' size');
    assert.deepStrictEqual(countMap(back), countMap(s), fmt + ' blocks');
  }
  assert.deepStrictEqual(countMap(IO.fromJSON(JSON.parse(IO.toJSON(s)))), countMap(s), 'json');
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  if (process.argv.includes('-v')) report.forEach((r) => console.log(r.join(' | ')));
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' launcher tests passed');
})();
