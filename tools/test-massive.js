// Tests for massive builds: limits and messages, streamed decode into typed arrays (.schem v2 / v3, .litematic) with
// round trips through our own exporters at millions of blocks, palette-remap swaps, counting, the chunk mesher (face
// counts, greedy merging, LOD, cuts), the IndexedDB storage layer (on a Map backend) and run-length text.
//   node tools/test-massive.js        (-v prints timings)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const verbose = process.argv.includes('-v');

global.window = global;
global.TH = { data: {}, langData: {}, icon: () => null };
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js', 'js/modules/builds-view.js', 'js/modules/builds-store.js', 'js/modules/builds-detail.js', 'js/modules/builds-rotate.js', 'js/modules/builds-inside.js', 'js/modules/builds-resize.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const C = TH.builds.core, IO = TH.builds.io, K = TH.builds.chunks, ST = TH.builds.store;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ms = (t0) => Math.round(performance.now() - t0) + ' ms';
const log = (...a) => { if (verbose) console.log('   ', ...a); };

/* ---- builds ---- */
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** A big mixed build that fills its whole box (bedrock floor + corner posts), with holes, ores and some stairs and glass. */
function mixed(W, H, D, kinds) {
  const s = C.create(W, H, D, 'Mixed');
  const ids = ['minecraft:stone', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite', 'minecraft:tuff', 'minecraft:deepslate[axis=y]', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:glass']
    .concat(Array.from({ length: Math.max(0, (kinds || 0) - 8) }, (_, i) => 'minecraft:' + C.COLORS[i % 16] + '_wool' + (i >= 16 ? '' : ''))).map((id) => C.pal(s, id));
  const B = s.blocks;
  for (let y = 0, i = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++, i++) {
    const r = hash(x, y, z);
    if (y === 0 || ((x === 0 || x === W - 1) && (z === 0 || z === D - 1))) { B[i] = ids[0]; continue; }
    if (r < 0.15) continue;
    B[i] = ids[Math.floor(hash(z, x, y) * ids.length)];
  }
  return s;
}
/** Every cell: does `b` hold the same state as `a`? (palette order may differ) */
function sameBlocks(a, b) {
  assert.deepStrictEqual(b.size, a.size, 'size');
  const map = a.palette.map((id) => b.palette.indexOf(id === 'minecraft:air' ? 'minecraft:air' : id));
  for (let i = 0; i < a.blocks.length; i++) if (b.blocks[i] !== (a.blocks[i] ? map[a.blocks[i]] : 0)) throw new Error('cell ' + i + ' differs: ' + a.palette[a.blocks[i]] + ' vs ' + b.palette[b.blocks[i]]);
}

/* ---- limits and messages ---- */
t('limits scale with device memory and never go below a quarter', () => {
  const L8 = IO.limits(8), L4 = IO.limits(4), L1 = IO.limits(1);
  assert.strictEqual(L8.cells, 134217728); assert.strictEqual(L8.blocks, 16777216);
  assert.strictEqual(L4.cells, L8.cells / 2); assert.strictEqual(L1.cells, L8.cells / 4);
  assert.ok(L8.blocks >= 10000000, 'at least 10 M blocks on a desktop');
});
t('the too-big messages name the size, the limit and what to do (never the old 300,000)', async () => {
  const L = { cells: 1000, blocks: 500, fileMB: 1 };
  const s = C.fromFunction([12, 10, 10], () => 'minecraft:stone');   // 1200 cells
  const bytes = await IO.toSchem(s);
  await assert.rejects(IO.load({ name: 'big.schem', bytes }, { limits: L }), (e) => e.user && /12 × 10 × 10 = 1,200 cells/.test(e.message) && /up to 1,000 cells/.test(e.message) && /smaller part/.test(e.message) && !/300,000/.test(e.message));
  const s2 = C.fromFunction([10, 10, 9], () => 'minecraft:stone');   // 900 cells, 900 blocks
  await assert.rejects(IO.load({ name: 'b.schem', bytes: await IO.toSchem(s2) }, { limits: L }), (e) => e.user && /900 blocks/.test(e.message) && /up to 500 blocks/.test(e.message));
  assert.ok(/12.3 million/.test(IO.tooBig.blocks(12345678, IO.limits(8))), 'millions read as millions');
  assert.ok(/512 MB/.test(IO.tooBig.file(900, IO.limits(8))));
});
t('a 5 million block build is not refused', () => {
  assert.ok(5e6 < IO.limits(8).blocks && 500 * 300 * 500 <= IO.limits(8).cells, '500 x 300 x 500 fits');
});

/* ---- decode / encode ---- */
t('varints: one, two and three byte values decode straight into a Uint16Array, with a palette map', () => {
  const a = Uint16Array.from([0, 1, 127, 128, 300, 16383, 16384, 65535, 5]);
  const enc = IO.writeVarints(a);
  assert.strictEqual(enc.length, 1 + 1 + 1 + 2 + 2 + 2 + 3 + 3 + 1);
  const u = new Uint8Array(enc.buffer, enc.byteOffset, enc.length);
  assert.deepStrictEqual(Array.from(IO.readVarints(u, a.length)), Array.from(a));
  const out = new Uint16Array(a.length), map = []; map[5] = 9; map[1] = 2;
  IO.readVarints(u, a.length, out, map);
  assert.strictEqual(out[8], 9); assert.strictEqual(out[1], 2); assert.strictEqual(out[2], 0);
});
t('.schem v2 round trip at 4 million cells (palette over 128 entries = two-byte varints)', async () => {
  const s = mixed(160, 160, 160, 140);
  let t0 = performance.now();
  const bytes = await IO.toSchem(s);
  log('toSchem', ms(t0), Math.round(bytes.length / 1024) + ' KB');
  t0 = performance.now();
  const back = await IO.load({ name: 'm.schem', bytes });
  log('load .schem', ms(t0), C.volume(back).toLocaleString('en') + ' blocks');
  sameBlocks(s, back);
});
t('.litematic round trip at 5 million blocks', async () => {
  const s = mixed(200, 150, 200);
  assert.ok(C.volume(s) > 4.9e6);
  let t0 = performance.now();
  const bytes = await IO.toLitematic(s);
  log('toLitematic', ms(t0), Math.round(bytes.length / 1024) + ' KB');
  t0 = performance.now();
  const back = await IO.load({ name: 'm.litematic', bytes });
  log('load .litematic', ms(t0));
  sameBlocks(s, back);
});
t('.schem v3 (blocks under Blocks.Data) at 1 million cells', async () => {
  const s = mixed(100, 100, 100);
  const pal = {};
  s.palette.forEach((p, i) => { pal[p] = [3, i]; });
  const root = { Schematic: [10, { Version: [3, 3], DataVersion: [3, 3955], Width: [2, 100], Height: [2, 100], Length: [2, 100], Blocks: [10, { Palette: [10, pal], Data: [7, IO.writeVarints(s.blocks)], BlockEntities: [9, [10, []]] }] }] };
  const bytes = await IO.gzip(IO.writeNBT('', root));
  const back = await IO.load({ name: 'v3.schem', bytes });
  sameBlocks(s, back);
});
t('a .litematic with two regions is merged into one box', async () => {
  // write one region file, then glue a second region in by hand
  const a = C.fromFunction([4, 3, 5], (x, y, z) => (y === 0 ? 'minecraft:stone' : null));
  const bytes = await IO.toLitematic(a);
  const { value: T } = IO.readNBT(await IO.gunzip(bytes), true);
  const regs = T.Regions[1], k = Object.keys(regs)[0], r2 = JSON.parse(JSON.stringify(regs[k], (kk, v) => (v instanceof Int32Array ? { __i32: Array.from(v) } : v)), (kk, v) => (v && v.__i32 ? Int32Array.from(v.__i32) : v));
  r2[1].Position = [10, { x: [3, 10], y: [3, 0], z: [3, 0] }];
  regs.second = r2;
  const back = await IO.load({ name: 'two.litematic', bytes: await IO.gzip(IO.writeNBT('', T)) });
  assert.deepStrictEqual(back.size, [14, 1, 5]);
  assert.strictEqual(C.volume(back), 40);
});
t('writing a clean build does not copy its block array; a messy one is compacted', async () => {
  const s = mixed(40, 40, 40);
  const t0 = performance.now();
  await IO.toSchem(s);
  s.palette.push('minecraft:stone');   // a duplicate entry (as a big swap view may have)
  s.blocks[5] = s.palette.length - 1;
  const back = await IO.load({ name: 'd.schem', bytes: await IO.toSchem(s) });
  assert.strictEqual(back.palette.filter((p) => p === 'minecraft:stone').length, 1);
  log('clean write 64 K cells', ms(t0));
});

/* ---- swaps and counting ---- */
t('swaps on a big build are a palette remap: the block array is shared, the original stays as it was', () => {
  const s = mixed(170, 150, 170);   // 4.3 M cells
  const before = C.counts(s, true).find((r) => r.id === 'minecraft:stone').n;
  const t0 = performance.now();
  const o = C.applySwaps(s, { 'minecraft:stone': 'minecraft:deepslate_bricks' });
  const took = performance.now() - t0;
  log('swap on 4.3 M cells', Math.round(took) + ' ms');
  assert.strictEqual(o.blocks, s.blocks, 'shared, not copied');
  assert.ok(took < 50, 'O(palette): ' + took);
  assert.strictEqual(C.counts(o, true).find((r) => r.id === 'minecraft:deepslate_bricks').n, before);
  assert.ok(!C.counts(o, true).some((r) => r.id === 'minecraft:stone'));
  C.compact(o);   // copy on write
  assert.notStrictEqual(o.blocks, s.blocks);
  assert.strictEqual(C.counts(s, true).find((r) => r.id === 'minecraft:stone').n, before, 'original untouched');
  // a small build still gets its own copy (as before)
  const sm = mixed(20, 20, 20), so = C.applySwaps(sm, { 'minecraft:stone': 'minecraft:deepslate_bricks' });
  assert.notStrictEqual(so.blocks, sm.blocks);
});
t('counting 5 million blocks', () => {
  const s = mixed(200, 150, 200);
  const t0 = performance.now();
  const n = C.volume(s), c = C.counts(s), m = C.materials(s);
  log('volume + counts + materials', ms(t0));
  assert.strictEqual(c.reduce((a, r) => a + r.n, 0), n);
  assert.ok(m.length >= 7);
});
t('run-length text round trip at 4 million cells', () => {
  const s = mixed(160, 160, 160);
  const t0 = performance.now();
  const r = C.rle(s.blocks), b = C.unrle(r, s.blocks.length);
  log('rle + unrle', ms(t0), (r.length / 1e6).toFixed(1) + ' M chars');
  assert.deepStrictEqual(b, s.blocks);
  assert.throws(() => C.unrle('3*1,2', 3));
});

t('resize of a big build: smart up to 8 M cells, plain (with a note) beyond, nothing past the memory limit', () => {
  const s = C.fromFunction([160, 100, 160], (x, y, z) => (y < 2 || x === 0 ? 'minecraft:stone' : null));   // 2.6 M cells
  const t0 = performance.now(), r = TH.builds.resize.resize(s, { factor: [1.5, 1.5, 1.5], mode: 'auto' });   // 8.6 M cells
  log('resize 2.6 M -> 8.6 M cells', ms(t0), r.mode);
  assert.strictEqual(r.mode, 'plain');
  assert.ok(r.notes.some((n) => /scaled plainly/.test(n)));
  const r2 = TH.builds.resize.resize(s, { size: [6000, 100, 6000] });
  assert.strictEqual(r2.mode, 'none'); assert.strictEqual(r2.s, s);
  assert.ok(/Too big/.test(r2.notes[0]));
});
t('rotation of a big build: quarter turns exact, free angles use one sample a cell past 6 M cells', () => {
  const s = C.fromFunction([200, 60, 200], (x, y, z) => (y < 3 ? 'minecraft:stone' : null));
  let t0 = performance.now();
  const q = TH.builds.rotate.rotate(s, { y: 90 });
  log('rotate 2.4 M cells by 90', ms(t0));
  assert.strictEqual(C.volume(q), C.volume(s));
  t0 = performance.now();
  const f = TH.builds.rotate.rotate(s, { y: 30 });
  log('rotate 2.4 M cells by 30 (out ' + (f.size[0] * f.size[1] * f.size[2] / 1e6).toFixed(1) + ' M cells)', ms(t0));
  assert.ok(C.volume(f) > C.volume(s) * 0.9);
});

/* ---- chunk mesher ---- */
function meshAll(s, lod, filt) {
  const T = K.tables(s.palette), n = s.size.map((v) => Math.ceil(v / K.CK));
  let faces = 0, quads = 0, tris = 0;
  for (let cy = 0; cy < n[1]; cy++) for (let cz = 0; cz < n[2]; cz++) for (let cx = 0; cx < n[0]; cx++) {
    const job = K.extract(s, cx, cy, cz, lod, filt || null, T);
    if (!job) continue;
    const out = K.mesh(job, T);
    faces += out.faces;
    [out.o, out.t].forEach((g) => { if (g) { quads += g.verts / 4; tris += g.idx.length / 3; } });
  }
  return { faces, quads, tris, tiles: T.reg.tiles.length };
}
const cube = (n, id) => C.fromFunction([n, n, n], () => id || 'minecraft:stone');
t('a solid cube in one chunk is exactly 6 quads (only its outside, merged)', () => {
  const r = meshAll(cube(20));
  assert.strictEqual(r.quads, 6); assert.strictEqual(r.tris, 12);
});
t('a solid cube over 8 chunks: each side is one quad per chunk it crosses', () => {
  assert.strictEqual(meshAll(cube(40)).quads, 24);   // 4 chunk faces per side x 6
});
t('a hollow box shows its inner faces too (12 quads for a 1-thick shell)', () => {
  const n = 20, s = C.fromFunction([n, n, n], (x, y, z) => (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1 ? 'minecraft:stone' : null));
  // inner faces meet the walls at their edges: ambient occlusion darkens the edge rows. A row whose shading only changes
  // across it still merges along it, so each inner side is its middle + 4 edge strips + 4 corners
  const r = meshAll(s);
  assert.strictEqual(r.quads, 6 + 6 * 9, 'quads ' + r.quads);
  const unit = meshAll(C.fromFunction([n, n, n], (x, y, z) => (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1 ? 'minecraft:glass' : null)));
  // glass next to glass hides its face, no ambient occlusion: 6 outside + 6 inside
  assert.strictEqual(unit.quads, 12);
});
t('greedy merging only joins faces of the same texture: a checkerboard of two blocks stays one face per block', () => {
  const s = C.fromFunction([8, 1, 8], (x, y, z) => ((x + z) % 2 ? 'minecraft:stone' : 'minecraft:dirt'));
  const r = meshAll(s);
  assert.strictEqual(r.quads, 64 + 64 + 4 * 8);   // top and bottom per block, each side row is a checkerboard too
});
t('the same visible surface as the small-build mesher (face for face) for cubes, stairs and panes', () => {
  const s = C.fromFunction([30, 12, 30], (x, y, z) => {
    if (y === 0) return 'minecraft:stone';
    if (y < 4 && (x === 3 || z === 3)) return 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]';
    if (y < 6 && x === 10) return 'minecraft:glass_pane[east=false,north=true,south=true,waterlogged=false,west=false]';
    if (y < 3 && hash(x, y, z) < 0.3) return 'minecraft:cobblestone';
    return null;
  });
  // the small mesher with hidden faces culled, counted in unit faces; the chunk mesher's area must match
  const big = C.fromFunction([30, 12, 30], (x, y, z) => C.get(s, x, y, z));
  const M = TH.builds.mesh(big, { still: true, cullHidden: true });
  const T = K.tables(s.palette), job = K.extract(s, 0, 0, 0, 0, null, T), out = K.mesh(job, T);
  const area = (g) => { let a = 0; for (let q = 0; q < g.verts; q += 4) { const p = (k) => [g.pos[(q + k) * 3], g.pos[(q + k) * 3 + 1], g.pos[(q + k) * 3 + 2]]; const A = p(0), B = p(1), D = p(3); const u = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), v = Math.hypot(D[0] - A[0], D[1] - A[1], D[2] - A[2]); a += u * v; } return a; };
  const areaOld = (g) => { let a = 0; for (let q = 0; q < g.verts; q += 4) { const p = (k) => [g.pos[(q + k) * 3], g.pos[(q + k) * 3 + 1], g.pos[(q + k) * 3 + 2]]; const A = p(0), B = p(1), D = p(3); a += Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * Math.hypot(D[0] - A[0], D[1] - A[1], D[2] - A[2]); } return a; };
  const a1 = area(out.o) + (out.t ? area(out.t) : 0), a0 = areaOld(M.opaque) + areaOld(M.trans);
  assert.ok(Math.abs(a1 - a0) < 0.01, 'area ' + a1 + ' vs ' + a0);
  assert.ok(out.o.verts / 4 < M.opaque.verts / 4, 'fewer quads after merging');
});
t('uneven ambient occlusion is never merged (an L of blocks keeps its shading per face)', () => {
  const s = C.fromFunction([6, 2, 6], (x, y, z) => (y === 0 || (y === 1 && x === 0) ? 'minecraft:stone' : null));
  const T = K.tables(s.palette), out = K.mesh(K.extract(s, 0, 0, 0, 0, null, T), T);
  // the top row next to the wall is darker on one edge: those faces stay single
  const cols = new Set();
  for (let v = 0; v < out.o.verts; v++) cols.add(out.o.col[v * 4]);
  assert.ok(cols.size >= 2, 'shading kept');
});
t('a cut leaves cells outside as air and closes the cut (a cube cut to x 10..19 is a closed box again)', () => {
  const s = cube(30), r = meshAll(s, 0, { lo: [10, 0, 0], hi: [19, 29, 29] });
  assert.strictEqual(r.quads, 6);
  const hidden = meshAll(C.fromFunction([10, 10, 10], (x) => (x < 5 ? 'minecraft:stone' : 'minecraft:glass')), 0, { show: Uint8Array.from([1, 1, 0]) });
  assert.strictEqual(hidden.quads, 6, 'hidden glass is air');
});
t('LOD 1 is half resolution: a 64 cube is still 6 sides, thin blocks are left out', () => {
  assert.strictEqual(meshAll(cube(64), 1).quads, 6 * 4);
  const panes = C.fromFunction([16, 16, 16], () => 'minecraft:glass_pane[east=true,north=false,south=false,waterlogged=false,west=true]');
  const T = K.tables(panes.palette);
  assert.strictEqual(K.extract(panes, 0, 0, 0, 1, null, T), null, 'nothing to draw far away');
  assert.ok(K.extract(panes, 0, 0, 0, 0, null, T), 'but near they are drawn');
});
t('chunk meshing of a noisy 1.5 million cell build (every face visible: the worst case) stays compact far away', () => {
  const s = mixed(128, 96, 128);
  const t0 = performance.now(), r = meshAll(s, 0), took = performance.now() - t0, t1 = performance.now(), r1 = meshAll(s, 1);
  log('mesh 4 M cells LOD0', Math.round(took) + ' ms', r.quads.toLocaleString('en') + ' quads; LOD1', ms(t1), r1.quads.toLocaleString('en') + ' quads');
  assert.ok(r1.quads * 3 < r.quads, 'LOD 1 is much lighter');
});

/* ---- storage ---- */
t('storage layer: a big build goes in and comes back the same, extras included (Map backend)', async () => {
  const be = ST.memBackend(), store = ST.make(be);
  const s = mixed(120, 100, 120);
  s.be = [{ x: 1, y: 1, z: 1, id: 'minecraft:chest', nbt: { Items: [9, [10, []]] } }];
  s.declared = 1234;
  const t0 = performance.now();
  const r = await store.put('f1', s);
  log('store.put 1.4 M cells', ms(t0), Math.round(r.bytes / 1024) + ' KB');
  assert.ok(be.map.get('f1').z, 'gzipped');
  assert.ok(r.bytes < s.blocks.byteLength / 2);
  const back = await store.get('f1');
  sameBlocks(s, back);
  assert.strictEqual(back.declared, 1234);
  assert.strictEqual(back.be.length, 1);
  await store.del('f1');
  assert.strictEqual(await store.get('f1'), null);
});
t('storage layer without CompressionStream keeps the raw array', async () => {
  const keep = global.CompressionStream;
  try {
    global.CompressionStream = undefined;
    const be = ST.memBackend(), store = ST.make(be), s = mixed(20, 20, 20);
    await store.put('x', s);
    assert.ok(be.map.get('x').raw instanceof Uint16Array);
    sameBlocks(s, await store.get('x'));
  } finally { global.CompressionStream = keep; }
});

(async () => {
  let ok = 0;
  for (const [name, fn] of tests) {
    const t0 = performance.now();
    try { await fn(); ok++; console.log('  ok  ' + name + (verbose ? ' (' + ms(t0) + ')' : '')); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
  }
  console.log((ok === tests.length ? 'ok ' : 'FAILED ') + ok + '/' + tests.length + ' massive-build tests passed');
  process.exitCode = ok === tests.length ? 0 : 1;
})();
