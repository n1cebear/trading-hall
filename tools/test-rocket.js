// Tests for the Creeper rocket in the Builds library (js/modules/builds-farms.js, creeperRocket).
//   node tools/test-rocket.js        (-v lists every option set with its size and blocks)
// Builds every option set in a VM with the game's block database and checks: 36 x 36 and as high as the option says
// (127 by default: y 63 to 189); known blocks (full cubes, glass, slabs, stairs, buttons) that never fall; only fully
// no copper at all; one connected piece; the shape mirror symmetric (the 2 x 1 chamber is the one exception
// front to back); hollow; three sealed rooms: the head (30 x 30 x 30), the cane body (34 across, at least 15 high) and
// the 2 x 1 x 3 AFK chamber with a slab floor and the roof as the highest block; spawn-proof outside and in the small
// pockets; the 32 block head with the face on all four sides in every colour set; the body wider than the head; the
// bottom at least 16 wide; green under half of the cane wall; the wall fill and wear options; the size table; the same
// build every time; and that the files export and read back unchanged.
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
// the layout the generator promises: 36 wide (centre between x 17 and 18), flames y 0..9, nozzle y 10..14, the head
// 32 x 32 x 32 (x and z 2..33, y 15..46), the body plate y 47, the body from y 48 to the nose (22 % of the height); the
// AFK chamber at x 17..18, z 17, y H-4..H-2 over a slab floor
const S = 36, HEAD = { lo: 2, hi: 33, y0: 15, y1: 46 }, PLATE_Y = 47, MID = 17, CEN = 17.5;
// the nose is a third of what is above the body plate, so the cane body is twice as tall as the nose
const noseY = (H) => H - Math.round((H - PLATE_Y - 1) / 3);
// the AFK chamber: air at y H-8..H-6 over a slab floor at H-9, its roof at H-5, the needle point above (H-4..H-1)
const chamber = (H) => [[17, 17], [18, 17]].flatMap(([x, z]) => [H - 8, H - 7, H - 6].map((y) => [x, y, z]));
// the chamber box and the caps around it (the one place that is not symmetric front to back)
const inChamberBox = (H, x, y, z) => x >= 15 && x <= 20 && z >= 15 && z <= 20 && y >= H - 10 && y <= H - 4;
// the creeper's face (entity/creeper/creeper.png, texels 8..15 x 8..15), left half; the right half is its mirror
const FACE = ['PMGP', 'MGGG', 'GDDP', 'GDKG', 'PGPD', 'PMDK', 'PMKK', 'PPDP'];
const COLOURS = {
  charged: { K: 'black_concrete', D: 'blue_concrete', M: 'cyan_concrete', G: 'light_blue_concrete', P: 'light_blue_wool', W: 'white_concrete' },
  grey: { K: 'black_concrete', D: 'gray_concrete', M: 'tuff', G: 'andesite', P: 'stone', W: 'polished_diorite' },
  ember: { K: 'black_concrete', D: 'red_nether_bricks', M: 'red_terracotta', G: 'orange_terracotta', P: 'orange_concrete', W: 'yellow_concrete' },
  green: { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' },
};
/** The face block of a colour set at column p (0..31 across the side) and row r (0 = top texel row): 4 blocks per texel. */
const faceAt = (col, p, r) => COLOURS[col][FACE[r][Math.floor((p < 16 ? p : 31 - p) / 4)]];
const STALK = ['lime_wool', 'lime_concrete', 'bamboo_block', 'green_wool', 'bone_block', 'lime_terracotta', 'green_terracotta'];
const SANDY = ['smooth_sandstone', 'sandstone', 'cut_sandstone', 'chiseled_sandstone'];
const GLOW = ['glowstone', 'shroomlight'];
// the dark end of the nose ramp (the tip) and every grey the rocket parts may use: andesite, stone, smooth stone,
// cobblestone and tuff as the base, deepslate and blackstone as small dark accents
const DARK = ['polished_deepslate', 'polished_tuff', 'tuff', 'deepslate_tiles', 'deepslate_tile'];
const GREY = ['polished_andesite', 'andesite', 'stone', 'smooth_stone', 'cobblestone', 'mossy_cobblestone', 'tuff_bricks', 'tuff_brick', 'stone_brick', 'cracked_stone_bricks', 'deepslate_bricks', 'deepslate_brick', 'cobbled_deepslate', 'polished_blackstone', 'blackstone'].concat(DARK);
const stem = (nm) => nm.replace(/_(slab|stairs)$/, '');

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
/** Air rooms (6 neighbours): room(x, y, z) gives a number, 1 for the open air (reached from outside the box), 0 for a block. */
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
function widthAt(g, y) {
  let lo = -1, hi = -1;
  for (let x = 0; x < g.sx; x++) if (g.at(x, y, MID)) { if (lo < 0) lo = x; hi = x; }
  return lo < 0 ? 0 : hi - lo + 1;
}
/** Could a mob stand on this block? Full cubes (not glass), top and double slabs, upside-down stairs. */
function fullTop(id) {
  const d = C.def(id), p = C.parse(id).props;
  if (d.shape === 'cube') return d.fam !== 'glass';
  if (d.shape === 'slab') return p.type === 'top' || p.type === 'double';
  if (d.shape === 'stairs') return p.half === 'top';
  return false;
}
const inHead = (x, y, z) => y >= HEAD.y0 && y <= HEAD.y1 && x >= HEAD.lo && x <= HEAD.hi && z >= HEAD.lo && z <= HEAD.hi;
const report = [];

t('the rocket is a Structure with tags, icon, options and steps', () => {
  assert.ok(f && f.cat === 'build' && f.icon === 'item/firework_rocket' && !f.art);
  assert.ok(f.tags.includes('statue') && f.tags.includes('mob-head'));
  assert.ok(f.pitch && f.how && f.steps.length >= 4 && f.tips.length >= 3 && f.level && f.dim === 'overworld');
  for (const s of ['y 63', '189', '36 x 36', '27 x 27', 'about 34 across', '2 x 1']) assert.ok(f.pitch.includes(s), 'the pitch says ' + s);
  assert.ok(f.tips.some((s) => /spawn-proofed/i.test(s)));
  assert.deepStrictEqual(plain(f.opts.map((op) => op.id)), ['size', 'flames', 'colour', 'fill', 'wear']);
  f.opts.forEach((op) => assert.ok(op.choices.some((c) => c[0] === op.def), op.id + ' default is a choice'));
  assert.deepStrictEqual(plain(F.options(ID, { size: '20', flames: 'x', colour: 'pink', fill: 'sand', wear: 'old' })), { size: '127', flames: 'on', colour: 'charged', fill: 'sandy', wear: 'weathered' });
  assert.ok(f.opts[0].choices.every((c) => +c[0] >= 70));
  for (const id of ['colour', 'fill', 'wear']) assert.ok(f.opts.find((op) => op.id === id).look, id + ' does not change the shape');
  assert.deepStrictEqual(plain(f.opts.find((op) => op.id === 'colour').choices.map((c) => c[0])), Object.keys(COLOURS));
});

for (const o of shapes()) {
  const label = JSON.stringify(o);
  t(label + ': size, blocks, one piece, symmetric, hollow, three sealed rooms, spawn-proof, silhouette', () => {
    const s = F.schematic(ID, o), g = grid(s), [sx, sy, sz] = s.size, H = +o.size, vol = C.volume(s), yn = noseY(H);
    assert.deepStrictEqual([sx, sy, sz], [S, H, S], '36 x 36 and ' + H + ' high');
    for (const [x, z] of [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]]) assert.ok(g.at(x, 0, z), 'a fin stands on the corner ' + [x, z]);
    s.palette.slice(1).forEach((p) => {
      const nm = nameOf(p), d = C.def(p);
      assert.ok(DB[nm] && C.known(p), nm + ' is a known 26.3 block');
      assert.ok(['cube', 'slab', 'stairs', 'button', 'carpet'].includes(d.shape), nm + ' is a cube, slab, stair, button or carpet (' + d.shape + ')');
      assert.ok(C.replaceable(p).ok, nm + ' can be swapped');
      assert.ok(d.fam !== 'gravity' && !/(^|_)sand$|gravel|powder|anvil|scaffolding/.test(nm), nm + ' does not fall');
      assert.ok(!/copper/.test(nm), nm + ': no copper');
    });
    assert.strictEqual(pieces(g).length, 1, 'one connected piece');
    // the shape is mirror symmetric left to right; front to back and by quarter turns except the 2 x 1 chamber
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const here = !g.at(x, y, z);
      assert.strictEqual(here, !g.at(sx - 1 - x, y, z), 'mirror x at ' + [x, y, z]);
      if (inChamberBox(H, x, y, z) || inChamberBox(H, x, y, sz - 1 - z)) continue;
      assert.strictEqual(here, !g.at(x, y, sz - 1 - z), 'mirror z at ' + [x, y, z]);
      assert.strictEqual(here, !g.at(sz - 1 - z, y, x), 'quarter turn at ' + [x, y, z]);
    }
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!g.at(x, y, z)) continue;
      let air = false;
      for (let dy = -1; dy <= 1 && !air; dy++) for (let dz = -1; dz <= 1 && !air; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !g.at(x + dx, y + dy, z + dz)) { air = true; break; }
      assert.ok(air, 'a buried block at ' + [x, y, z]);
    }
    // the rooms
    const R = rooms(g), head = R.room(MID, HEAD.y0 + 15, MID), body = R.room(MID, PLATE_Y + 6, MID), ch = R.room(17, H - 7, 17);
    assert.ok(head > 1 && body > 1 && ch > 1 && new Set([head, body, ch]).size === 3, 'three separate sealed rooms');
    for (let y = HEAD.y0 + 1; y < HEAD.y1; y++) for (let z = HEAD.lo + 1; z < HEAD.hi; z++) for (let x = HEAD.lo + 1; x < HEAD.hi; x++) assert.strictEqual(R.room(x, y, z), head, 'the head room is 30 x 30 x 30 clear at ' + [x, y, z]);
    assert.strictEqual(R.size[head], 30 * 30 * 30, 'the head room is exactly the inside of the cube');
    let clear = 0;
    for (let y = PLATE_Y + 1; y < yn && R.room(MID, y, MID) === body; y++) clear++;
    assert.ok(clear >= (H >= 127 ? 45 : 15), 'the body room is ' + clear + ' high');
    assert.ok(yn - PLATE_Y - 1 >= 2 * (H - yn), 'the cane body (' + (yn - PLATE_Y - 1) + ') is at least twice the nose (' + (H - yn) + ')');
    for (const y of [PLATE_Y + 1, Math.floor((PLATE_Y + yn) / 2), yn - 1]) {
      for (let x = 1; x <= 34; x++) { assert.strictEqual(R.room(x, y, MID), body, 'the body room is 34 wide at x ' + x + ', y ' + y); assert.strictEqual(R.room(MID, y, x), body); }
      let area = 0; for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (R.room(x, y, z) === body) area++;
      assert.ok(area >= 0.72 * 34 * 34, 'the round body room covers ' + area + ' blocks at y ' + y);
    }
    // the chamber: exactly 2 x 1 x 3 of air on a slab floor, the roof the highest block
    assert.strictEqual(R.size[ch], 6, 'the chamber holds 6 blocks of air');
    chamber(H).forEach(([x, y, z]) => assert.strictEqual(R.room(x, y, z), ch));
    for (const x of [17, 18]) {
      assert.match(g.id(x, H - 9, 17), /_slab\[type=bottom\]$/, 'a bottom slab floor');
      assert.ok(g.at(x, H - 5, 17), 'a roof');
    }
    let highest = -1; for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (g.at(x, y, z)) highest = Math.max(highest, y);
    assert.strictEqual(highest, H - 1, 'the chamber roof is the highest layer');
    // spawn-proof: no full top with air on it, outside, in the chamber or in the small pockets (the farm rooms are the player's)
    const spots = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const id = g.id(x, y, z);
      if (!id || !fullTop(id) || g.at(x, y + 1, z)) continue;
      const rm = R.room(x, y + 1, z);
      if (rm !== head && rm !== body) spots.push([x, y, z].join(','));
    }
    assert.strictEqual(spots.length, 0, 'spawnable tops: ' + spots.slice(0, 8).join(' | '));
    // the head's top is one flat layer: above the roof only the body (inside its circle) and carpets on the corners
    for (let z = HEAD.lo; z <= HEAD.hi; z++) for (let x = HEAD.lo; x <= HEAD.hi; x++) {
      const b = g.at(x, HEAD.y1 + 1, z), inBody = Math.pow(Math.pow(Math.abs(x - CEN), 2.2) + Math.pow(Math.abs(z - CEN), 2.2), 1 / 2.2) <= 17.6;
      if (!inBody) assert.ok(/_carpet$/.test(b || ''), 'a carpet on the head corner at ' + [x, z] + ': ' + b);
      assert.ok(g.at(x, HEAD.y1, z), 'the roof is closed');
    }
    // the silhouette
    assert.strictEqual(widthAt(g, HEAD.y0 + 1), 32);
    for (let y = PLATE_Y; y < yn; y++) assert.strictEqual(widthAt(g, y), S, 'body at y ' + y);
    for (let y = yn + 1; y < H; y++) assert.ok(widthAt(g, y) <= widthAt(g, y - 1), 'the nose narrows at y ' + y);
    // a long slim nose: at least a third of the height, half the body width by its middle, a small cap on top
    // a needle: narrow round the chamber (6 wide), then a point 2 wide at the very top
    for (let y = H - 10; y <= H - 5; y++) assert.ok(widthAt(g, y) <= 8, 'narrow round the chamber: ' + widthAt(g, y) + ' at y ' + y);
    assert.strictEqual(widthAt(g, H - 1), 2, 'a sharp point on top');
    assert.ok(widthAt(g, H - 3) <= 4, 'the point narrows');
    // round: the outside of the body wall lies on a circle (within the 2.2 superellipse's slight squareness)
    const ym = Math.floor((PLATE_Y + yn) / 2);
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!g.at(x, ym, z)) continue;
      const rr = Math.hypot(x - CEN, z - CEN);
      const edge = N6.some(([dx, , dz]) => !g.at(x + dx, ym, z + dz) && rooms(g).room(x + dx, ym, z + dz) === 1);
      if (edge) assert.ok(rr >= 16.4 && rr <= 18.8, 'the body is round: wall at radius ' + rr.toFixed(1));
    }
    for (let y = o.flames === 'off' ? 10 : 0; y < HEAD.y0; y++) assert.ok(widthAt(g, y) >= 16, 'bottom ' + widthAt(g, y) + ' wide at y ' + y);
    report.push([label, s.size.join(' x '), vol, C.counts(s, true).map((r) => nameOf(r.id) + ' ' + r.n).join(', ')]);
  });

  t(label + ': cane wall, grey parts, nose cone, flames', () => {
    const s = F.schematic(ID, o), g = grid(s), H = +o.size, yn = noseY(H);
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    let green = 0, wall = 0, nodes = 0;
    for (let y = PLATE_Y + 3; y < yn - 2; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const b = g.at(x, y, z);
      if (!b) continue;
      wall++;
      if (STALK.includes(b) || b === 'moss_block') green++;
      if (b === 'bone_block' && g.at(x, y - 1, z) === 'lime_terracotta') nodes++;
    }
    assert.ok(green > 0.6 * wall && green < 0.9 * wall, 'green stalks make most of the cane wall, the fill shows in the gaps (' + green + ' of ' + wall + ')');
    assert.ok(nodes >= 16, 'node rows on the stalks (' + nodes + ')');
    for (const b of SANDY.slice(0, 2)) assert.ok(counts[b] > 50, 'sandstone in the gaps: ' + b);
    // grey parts and the nose; no white or red outside the head and the flames
    for (let y = 10; y < H; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const b = g.at(x, y, z);
      if (!b || inHead(x, y, z)) continue;
      assert.ok(!/^(white|red)_concrete/.test(b), 'no white or red at ' + [x, y, z]);
      if (y >= yn || y === PLATE_Y || y === HEAD.y1 || (y < HEAD.y1 && Math.hypot(x - CEN, z - CEN) > 22.6)) assert.ok(b === 'stone_button' || GREY.includes(stem(b)) || (y >= yn ? false : true), 'grey at ' + [x, y, z] + ': ' + b);
    }
    // the nose grades from light at its foot to dark at the tip, with several tones on every stretch
    const nose = []; for (let y = yn + 2; y < H - 10; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const b = g.at(x, y, z); if (b) nose.push([y, stem(b)]); }
    const darkShare = (part) => part.filter(([, b]) => DARK.includes(b)).length / Math.max(1, part.length);
    const lowN = nose.filter(([y]) => y < yn + (H - 10 - yn) / 3), highN = nose.filter(([y]) => y >= yn + (2 * (H - 10 - yn)) / 3);
    assert.ok(darkShare(highN) > darkShare(lowN) + 0.2, 'the nose darkens upward (' + darkShare(lowN).toFixed(2) + ' -> ' + darkShare(highN).toFixed(2) + ')');
    assert.ok(new Set(nose.map(([, b]) => b)).size >= 5, 'at least 5 greys on the nose');
    assert.ok(nose.filter(([, b]) => ['andesite', 'polished_andesite', 'stone', 'smooth_stone'].includes(b)).length > 0.4 * nose.length, 'andesite and stone are the main grey');
    assert.ok(!Object.keys(counts).some((n) => /^(light_)?gray_concrete/.test(n)), 'no grey concrete');
    // the cane darkens toward the bottom: more of the darkest stalk tone in the lower third
    const caneDark = (y0, y1) => { let d = 0, n = 0; for (let y = y0; y < y1; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const b = g.at(x, y, z); if (STALK.includes(b)) { n++; if (b === 'green_terracotta' || b === 'green_wool') d++; } } return d / Math.max(1, n); };
    const third = Math.floor((yn - PLATE_Y) / 3);
    assert.ok(caneDark(PLATE_Y + 2, PLATE_Y + third) > caneDark(yn - third, yn - 2), 'the cane is darker low down');
    let dark = 0, light = 0;
    for (let y = yn; y < H; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const b = g.at(x, y, z); if (!b) continue; if (DARK.includes(stem(b))) dark++; else light++; }
    assert.ok(dark > 30 && light > 200, 'a light grey nose with a darker band and tip (' + dark + ' / ' + light + ')');
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const b = g.at(x, H - 1, z); if (b) assert.ok(DARK.includes(stem(b)), 'the top is dark: ' + b); }
    const glow = GLOW.reduce((a, b) => a + (counts[b] || 0), 0);
    if (o.flames === 'off') {
      assert.strictEqual(glow, 0, 'no flames');
      for (let y = 0; y < 10; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (Math.hypot(x - CEN, z - CEN) < 13) assert.strictEqual(g.at(x, y, z), null, 'nothing under the nozzle');
    } else {
      assert.ok(glow > 100, 'glowing flames');
      assert.ok(/^(red|orange)_concrete/.test(g.at(MID - 10, 0, MID) || ''), 'the flames reach the ground');
    }
  });
}

for (const col of Object.keys(COLOURS)) {
  t('creeper colour ' + col + ': a 32 block cube with the face on all four sides, nothing else changes', () => {
    const s = F.schematic(ID, { size: '100', colour: col }), g = grid(s), P = COLOURS[col];
    const sides = { south: (p, y) => g.at(HEAD.lo + p, y, HEAD.hi), north: (p, y) => g.at(HEAD.lo + p, y, HEAD.lo), east: (p, y) => g.at(HEAD.hi, y, HEAD.lo + p), west: (p, y) => g.at(HEAD.lo, y, HEAD.lo + p) };
    let headK = 0;
    for (const [side, get] of Object.entries(sides)) {
      let black = 0, darkN = 0;
      for (let y = HEAD.y0; y <= HEAD.y1; y++) for (let p = 0; p < 32; p++) {
        const got = get(p, y);
        assert.strictEqual(got, faceAt(col, p, 7 - Math.floor((y - HEAD.y0) / 4)), side + ' face at column ' + p + ', y ' + y);
        if (got === P.K) black++;
        if (got === P.D) darkN++;
      }
      assert.strictEqual(black, 128, side + ': 8 black texels of 4 x 4');
      assert.strictEqual(darkN, 192, side + ': 12 dark texels of 4 x 4');
      headK += black;
    }
    const counts = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
    assert.strictEqual(counts.black_concrete, headK, 'black only on the faces');
    const b = grid(F.schematic(ID, { size: '100', colour: 'charged' }));
    for (let y = 0; y < 100; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (!inHead(x, y, z) && !(y === HEAD.y1 + 1 && /_carpet$/.test(g.at(x, y, z) || ''))) assert.strictEqual(g.id(x, y, z), b.id(x, y, z), col + ': only the head (and the carpets on its corners) changes, not ' + [x, y, z]);
  });
}

t('cane wall: sandy, glass or mixed; the same shape and stalks, never sand', () => {
  const base = grid(F.schematic(ID, { size: '100', fill: 'sandy' }));
  const cnt = (s) => Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n]));
  const sandy = cnt(base.s), glass = F.schematic(ID, { size: '100', fill: 'glass' }), mixed = F.schematic(ID, { size: '100', fill: 'mixed' });
  assert.ok(!sandy.glass && sandy.smooth_sandstone > 200);
  const cg = cnt(glass), cm = cnt(mixed);
  assert.ok(cg.glass > 300 && !cg.smooth_sandstone, 'glass between the stalks');
  assert.ok(cm.glass > 80 && cm.smooth_sandstone > 80, 'sandstone with glass bands');
  for (const s of [glass, mixed]) {
    const g = grid(s);
    for (let y = 0; y < 100; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      assert.strictEqual(!g.at(x, y, z), !base.at(x, y, z), 'same shape');
      if (STALK.includes(base.at(x, y, z))) assert.ok(STALK.includes(g.at(x, y, z)) || g.at(x, y, z) === 'moss_block', 'the stalks stay green');
    }
    for (const n of Object.keys(cnt(s))) assert.ok(!/(^|_)sand$|gravel/.test(n), n);
  }
});
t('wear: clean has no moss or rust; rusty has more rust, moss and cracks than weathered; never copper; the same shape', () => {
  const cnt = (w) => { const s = F.schematic(ID, { size: '127', wear: w }); const c = Object.fromEntries(C.counts(s, true).map((r) => [nameOf(r.id), r.n])); c.s = s; return c; };
  const clean = cnt('clean'), wea = cnt('weathered'), rusty = cnt('rusty');
  const sum = (c, re) => Object.entries(c).filter(([n]) => re.test(n)).reduce((a, [, n]) => a + n, 0);
  assert.strictEqual(sum(clean, /^brown_|^orange_terracotta|moss|cracked/), 0, 'clean: no rust, moss or cracks');
  for (const c of [clean, wea, rusty]) assert.strictEqual(sum(c, /copper/), 0, 'no copper');
  assert.ok(sum(wea, /cracked|moss/) > 0, 'weathered shows some wear');
  assert.ok(sum(rusty, /^brown_|orange_terracotta/) > sum(wea, /^brown_|orange_terracotta/) && sum(rusty, /moss/) > sum(wea, /moss/) && sum(rusty, /cracked/) > sum(wea, /cracked/));
  const a = grid(clean.s), b = grid(rusty.s);
  for (let y = 0; y < 127; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) assert.strictEqual(!a.at(x, y, z), !b.at(x, y, z), 'same shape');
});
t('the same options always give the same build', () => {
  for (const o of [{ size: '100', colour: 'grey', fill: 'mixed', wear: 'rusty' }, { size: '127', flames: 'off', colour: 'ember' }]) {
    const a = f.make(F.options(ID, o)), b = f.make(F.options(ID, o));
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
  for (const o of [{ size: '100', colour: 'grey', fill: 'glass' }, { size: '127', flames: 'off', wear: 'rusty' }]) {
    const s = F.schematic(ID, o);
    for (const fmt of ['schem', 'litematic']) {
      const back = await roundTrip(s, fmt);
      assert.deepStrictEqual(plain(back.size), plain(s.size), fmt + ' size');
      assert.deepStrictEqual(countMap(back), countMap(s), fmt + ' blocks');
    }
    assert.deepStrictEqual(countMap(IO.fromJSON(JSON.parse(IO.toJSON(s)))), countMap(s), 'json');
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
