// Tests for the Builds smart resize (js/modules/builds-resize.js): bigger or smaller without doubled walls.
//   node tools/test-resize.js        (-v prints the wall-thickness stats of Basti's file when it is on this machine)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

global.window = global;
global.TH = { data: {}, langData: {}, icon: () => null };
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js', 'js/modules/builds-io.js', 'js/modules/builds-view.js', 'js/modules/builds-detail.js', 'js/modules/builds-rotate.js', 'js/modules/builds-inside.js', 'js/modules/builds-resize.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const C = TH.builds.core, RS = TH.builds.resize, IO = TH.builds.io;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const plain = (v) => JSON.parse(JSON.stringify(v));

/** A hollow box with 1-thick walls, floor and roof. */
const hollowBox = (w, h, d) => C.fromFunction([w, h, d], (x, y, z) => (x === 0 || y === 0 || z === 0 || x === w - 1 || y === h - 1 || z === d - 1 ? 'minecraft:stone_bricks' : null), 'box');
/** Thickness of the wall crossed when walking along axis a from the outside at the middle of the other two axes. */
function wallAt(s, a) {
  const [sx, sy, sz] = s.size, c = [sx >> 1, sy >> 1, sz >> 1];
  let n = 0;
  for (let i = 0; i < s.size[a]; i++) { const p = c.slice(); p[a] = i; if (C.get(s, p[0], p[1], p[2]) === 'minecraft:air') break; n++; }
  return n;
}
/** A three-storey house: 1-thick walls, 1-thick floors every 5 blocks, a row of glass-pane windows, a stair roof. */
function house() {
  const W = 15, D = 11, H = 16, s = C.create(W, H + 4, D, 'House');
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const wall = x === 0 || z === 0 || x === W - 1 || z === D - 1, floor = y % 5 === 0;
    if (floor || wall) C.set(s, x, y, z, 'minecraft:oak_planks');
    if (wall && !floor && y % 5 === 2 && z === 0 && x % 3 === 1 && x > 0 && x < W - 1) C.set(s, x, y, z, 'minecraft:glass_pane');
  }
  // a stair roof: rows of stairs stepping in from both long sides
  for (let k = 0; k < 4; k++) for (let x = 0; x < W; x++) {
    C.set(s, x, H + k, k, 'minecraft:oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]');
    C.set(s, x, H + k, D - 1 - k, 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]');
  }
  C.set(s, 7, 1, 5, 'minecraft:chest[facing=south,type=single,waterlogged=false]');
  s.be = [{ x: 7, y: 1, z: 5, id: 'minecraft:chest', nbt: { Items: [9, [10, []]] } }];
  s.ents = [{ pos: [7.5, 6.2, 5.5], id: 'minecraft:armor_stand', nbt: {} }];
  TH.builds.detail.connect(s);
  return s;
}
const count = (s, re) => C.counts(s).filter((r) => re.test(r.id)).reduce((a, r) => a + r.n, 0);

t('a hollow box scaled 2x keeps 1-thick walls and has the right outer size (stretch and resample)', () => {
  const b = hollowBox(10, 8, 12);
  for (const mode of ['stretch', 'thin', 'auto']) {
    const r = RS.resize(b, { factor: [2, 2, 2], mode });
    assert.deepStrictEqual(plain(r.s.size), [20, 16, 24], mode + ' size');
    for (const a of [0, 1, 2]) assert.strictEqual(wallAt(r.s, a), 1, mode + ': wall along ' + 'XYZ'[a]);
  }
  // resample: exactly the 1-thick shell of a 20 x 16 x 24 box, corners included, on the outside on every side
  assert.strictEqual(C.volume(RS.resize(b, { factor: [2, 2, 2], mode: 'thin' }).s), 20 * 16 * 24 - 18 * 14 * 22, 'resample gives a clean 1-thick shell');
  const p = RS.resize(b, { factor: [2, 2, 2], mode: 'plain' });
  for (const a of [0, 1, 2]) assert.strictEqual(wallAt(p.s, a), 2, 'plain scale doubles the walls (for contrast)');
});
t('a three-storey house: floors stay 1 thick, the windows stay single panes, the roof stays valid stairs', () => {
  const h = house();
  for (const f of [1.5, 2]) {
    const r = RS.resize(h, { factor: [f, f, f], mode: 'stretch' }), s = r.s;
    assert.deepStrictEqual(plain(s.size), h.size.map((v) => Math.round(v * f)), 'size at ' + f);
    // floors: along y through the middle the solid runs are 1 block (the floors)
    const [sx, sy, sz] = s.size, x = 3, z = sz >> 1;   // a column inside the house, away from the chest
    let run = 0, runs = [];
    for (let y = 0; y <= sy; y++) { const v = y < sy && C.get(s, x, y, z) !== 'minecraft:air'; if (v) run++; else { if (run) runs.push(run); run = 0; } }
    assert.ok(runs.length >= 3 && runs.slice(0, 3).every((n) => n === 1), 'floors 1 thick at ' + f + ': ' + runs);
    // windows: still single panes (no pane next to a pane along the wall) and every pane state valid
    for (let y = 0; y < sy; y++) for (let xx = 1; xx < sx; xx++) if (/glass_pane/.test(C.get(s, xx, y, 0))) assert.ok(!/glass_pane/.test(C.get(s, xx - 1, y, 0)) || !/glass_pane/.test(C.get(s, xx, y, 1)), 'panes stay single panes');
    assert.ok(count(s, /glass_pane/) >= count(h, /glass_pane/), 'no window lost');
    s.palette.filter((id) => /oak_stairs/.test(id)).forEach((id) => assert.match(id, /facing=(north|south),half=bottom/));
    assert.strictEqual((s.be || []).length, 1, 'the chest contents stay with one chest');
    assert.strictEqual((s.ents || []).length, 1, 'the entity is not duplicated');
    const b = s.be[0], e = s.ents[0];
    assert.ok(/chest/.test(C.get(s, b.x, b.y, b.z)), 'the block entity sits on a chest');
    e.pos.forEach((v, a) => assert.ok(v >= 0 && v <= s.size[a], 'the entity stays inside'));
  }
});
t('shrinking and growing back is about the original; factor 1 gives the very same build', () => {
  const h = house();
  assert.strictEqual(RS.resize(h, { factor: [1, 1, 1] }).s, h);
  const small = RS.resize(h, { size: [11, 16, 8], mode: 'stretch' }).s, back = RS.resize(small, { size: h.size, mode: 'stretch' }).s;
  assert.deepStrictEqual(plain(back.size), plain(h.size));
  let same = 0, tot = 0;
  for (let i = 0; i < h.blocks.length; i++) { if (!h.blocks[i] && !back.blocks[i]) continue; tot++; if (C.parse(h.palette[h.blocks[i]]).base === C.parse(back.palette[back.blocks[i]] || 'minecraft:air').base) same++; }
  assert.ok(same / tot > 0.7, 'shrink then grow keeps ' + Math.round(same / tot * 100) + '%');
  for (const a of [0, 1, 2]) assert.strictEqual(wallAt(small, a), 1, 'the shrunk house keeps 1-thick walls');
});
t('a round shell (dome) in resample mode keeps its wall thin and closed', () => {
  const R = 8, dome = C.fromFunction([17, 9, 17], (x, y, z) => { const d = Math.hypot(x - 8, y, z - 8); return d <= R + 0.5 && d > R - 0.5 ? 'minecraft:white_concrete' : null; }, 'dome');
  const r = RS.resize(dome, { factor: [2, 2, 2] });
  assert.strictEqual(r.mode, 'thin', 'auto picks resample for a round build');
  const stats = RS.wallStats(r.s);
  assert.ok(stats.every((v) => v <= 2), 'thin walls: ' + stats);
  assert.ok(C.volume(r.s) < C.volume(RS.resize(dome, { factor: [2, 2, 2], mode: 'plain' }).s) * 0.6, 'far fewer blocks than plain scaling');
});
t('resample thins walls through their thickness only: a 2-high pane row and a rod keep their height, no gaps', () => {
  const s = C.create(3, 2, 3, 'Bits');
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) C.set(s, x, y, 1, 'minecraft:glass_pane');
  TH.builds.detail.connect(s);
  const r = RS.resize(s, { factor: [2, 2, 2], mode: 'thin' }).s;
  for (let x = 0; x < 6; x++) { let n = 0; for (let y = 0; y < 4; y++) if (/glass_pane/.test(C.get(r, x, y, 2))) n++; assert.strictEqual(n, 4, 'column ' + x + ' of the pane row is whole'); }
  let thick = 0; for (let z = 0; z < 6; z++) if (/glass_pane/.test(C.get(r, 2, 1, z))) thick++;
  assert.strictEqual(thick, 1, 'the pane row stays one block thick');
  const rod = C.create(1, 2, 1, 'Rod'); C.set(rod, 0, 0, 0, 'minecraft:end_rod[facing=up]'); C.set(rod, 0, 1, 0, 'minecraft:end_rod[facing=up]');
  const rr = RS.resize(rod, { factor: [1, 2, 1], mode: 'thin' }).s;
  assert.strictEqual(count(rr, /end_rod/), 4, 'the rod grows without gaps');
});
t('a long hall without identical slices still grows and says how (repeating units)', () => {
  const s = C.create(12, 3, 3, 'Bays');
  for (let x = 0; x < 12; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) C.set(s, x, y, z, x % 3 === 0 ? 'minecraft:stone_bricks' : x % 3 === 1 ? 'minecraft:glass' : 'minecraft:oak_planks');
  const r = RS.resize(s, { size: [18, 3, 3], mode: 'stretch' });
  assert.strictEqual(r.s.size[0], 18);
  assert.ok(r.notes.some((n) => /repeating unit/.test(n)), 'notes: ' + r.notes.join(' | '));
  for (let x = 0; x + 3 < 18; x++) assert.strictEqual(C.get(r.s, x, 0, 0), C.get(r.s, x + 3, 0, 0), 'the bay pattern repeats every 3 blocks');
});

(async () => {
  // Basti's real build when it is on this machine: wall stats before and after
  const real = 'C:/Users/Basti/Downloads/63 Chorus Farm.litematic';
  if (fs.existsSync(real)) t('Basti’s Chorus Farm at 1.5x and 2x: no doubled thin parts, nothing duplicated', async () => {
    const s = await IO.load({ name: 'x.litematic', bytes: new Uint8Array(fs.readFileSync(real)) });
    const st0 = RS.wallStats(s), lines = ['before ' + s.size.join('x') + ' walls ' + st0 + ' blocks ' + C.volume(s) + ' be ' + (s.be || []).length + ' ents ' + (s.ents || []).length];
    for (const f of [1.5, 2]) for (const mode of ['auto', 'stretch', 'plain']) {
      const r = RS.resize(s, { factor: [f, f, f], mode }), st = RS.wallStats(r.s);
      lines.push(f + 'x ' + mode + ' (' + r.mode + ') ' + r.s.size.join('x') + ' walls ' + st + ' blocks ' + C.volume(r.s) + ' be ' + (r.s.be || []).length + ' ents ' + (r.s.ents || []).length + (r.notes.length ? ' · ' + r.notes.join(' | ') : ''));
      assert.ok((r.s.be || []).length <= (s.be || []).length, 'block entities never duplicated');
      if (f >= 1) assert.strictEqual((r.s.be || []).length, (s.be || []).length, 'growing keeps every block entity (' + mode + ')');
      assert.ok((r.s.ents || []).length === (s.ents || []).length, 'entities kept once');
      if (mode !== 'plain') assert.ok(st.every((v, a) => v <= Math.max(st0[a], 1) * 2), 'thin parts stay thin: ' + st + ' vs ' + st0);
    }
    if (process.argv.includes('-v')) lines.forEach((l) => console.log('  ' + l));
  });
  let n = 0;
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); process.exitCode = 1; }
  }
  console.log((process.exitCode ? 'FAILED ' : 'ok ') + n + '/' + tests.length + ' resize tests passed');
})();
