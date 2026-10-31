// Tests for the Skin Editor engine (js/modules/skins-engine.js; geometry from js/core/mc-skin.js).
//   node tools/test-skins.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/core/mc-skin.js', 'js/modules/skins-engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const E = ctx.TH.skinsEngine, M = ctx.TH.mcSkin;

// arrays from the VM realm are not deepStrictEqual to local ones: compare plain copies
const plain = (v) => (v && typeof v === 'object' && typeof v.length === 'number' ? Array.from(v, plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
const _deq = assert.deepStrictEqual;
assert.deepStrictEqual = (a, b, m) => _deq(plain(a), plain(b), m);
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; } };
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], GREEN = [0, 255, 0, 255], CLEAR = [0, 0, 0, 0];
const px = (b, x, y) => Array.from(E.get(b, x, y));
const count = (b, pred) => { let k = 0; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (pred(px(b, x, y), x, y)) k++; return k; };
const rect = (m, part, face) => E.rectOf(m, part, face);
const solid = (c) => { const b = E.newBuf(); for (let i = 0; i < 64 * 64; i++) b.data.set(c, i * 4); return b; };
/** a skin with every used pixel set to a colour derived from its position (so copies can be traced) */
function traced(model) {
  const b = E.newBuf(), map = E.regionMap(model);
  for (let i = 0; i < 4096; i++) if (map[i] >= 0) b.data.set([i & 255, i >> 8, 77, 255], i * 4);
  return b;
}

/* ---------------- UV map ---------------- */
t('classic model: 72 faces, used pixel count = 1632 per layer (wiki: 1,632 usable pixels per layer, 3,264 in all)', () => {
  const R = E.faceRects('classic');
  assert.strictEqual(R.length, 72);
  const base = R.filter((r) => r.layer === 'base').reduce((s, r) => s + r.w * r.h, 0), outer = R.filter((r) => r.layer === 'outer').reduce((s, r) => s + r.w * r.h, 0);
  assert.strictEqual(base, 1632); assert.strictEqual(outer, 1632);
});
t('slim model: 3,136 usable pixels (wiki) = 3264 - 4 arms x 32', () => {
  const R = E.faceRects('slim');
  assert.strictEqual(R.reduce((s, r) => s + r.w * r.h, 0), 3136);
});
t('no two faces overlap and every face is inside the 64x64 sheet', () => {
  ['classic', 'slim'].forEach((m) => {
    const seen = new Uint8Array(4096);
    E.faceRects(m).forEach((r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { assert(x < 64 && y < 64); assert(!seen[y * 64 + x], m + ' overlap at ' + x + ',' + y); seen[y * 64 + x] = 1; } });
  });
});
t('known face rects: head front 8,8; hat front 40,8; body front 20,20; right arm front 44,20; left leg front 20,52; left sleeve front 52,52', () => {
  const r = (p, f) => { const q = rect('classic', p, f); return [q.x, q.y, q.w, q.h]; };
  assert.deepStrictEqual(r('head', 'front'), [8, 8, 8, 8]);
  assert.deepStrictEqual(r('hat', 'front'), [40, 8, 8, 8]);
  assert.deepStrictEqual(r('body', 'front'), [20, 20, 8, 12]);
  assert.deepStrictEqual(r('rarm', 'front'), [44, 20, 4, 12]);
  assert.deepStrictEqual(r('lleg', 'front'), [20, 52, 4, 12]);
  assert.deepStrictEqual(r('lsleeve', 'front'), [52, 52, 4, 12]);
  assert.deepStrictEqual(r('head', 'top'), [8, 0, 8, 8]);
  assert.deepStrictEqual(r('head', 'bottom'), [16, 0, 8, 8]);
  assert.deepStrictEqual(r('head', 'back'), [24, 8, 8, 8]);
});
t('slim right arm: front 44,20 3 wide, left side 47,20, back 51,20', () => {
  assert.deepStrictEqual([rect('slim', 'rarm', 'front').x, rect('slim', 'rarm', 'front').w], [44, 3]);
  assert.strictEqual(rect('slim', 'rarm', 'left').x, 47);
  assert.strictEqual(rect('slim', 'rarm', 'back').x, 51);
});
t('regionAt: unused corner pixels are null; 8,8 is the head front 0,0', () => {
  assert.strictEqual(E.regionAt('classic', 0, 0), null);
  assert.strictEqual(E.regionAt('classic', 56, 16), null);
  const r = E.regionAt('classic', 8, 8);
  assert.strictEqual(r.part, 'head'); assert.strictEqual(r.face, 'front'); assert.strictEqual(r.fx, 0);
  assert.strictEqual(E.regionAt('slim', 54, 20), null, 'slim leaves 54,20 unused');
});
t('engine geometry matches TH.mcSkin.skinParts uv offsets', () => {
  M.skinParts(false).forEach((p) => assert.deepStrictEqual(Array.from(p.uv), E.PART[p.id].uv, p.id));
});

/* ---------------- picking ---------------- */
t('rayBox: hits a unit box from +z on its front face', () => {
  const h = E.rayBox([0.5, 0.5, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1]);
  assert(h && Math.abs(h.t - 4) < 1e-9); assert.deepStrictEqual(Array.from(h.n), [0, 0, 1]);
  assert.strictEqual(E.rayBox([5, 5, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1]), null);
});
t('pick: a ray at the head front centre-left lands on head front pixel column 3..4, row of the eyes', () => {
  // head box x -4..4, y 24..32, z -4..4; pixel (fx, fy) centre = x -4 + fx + .5, y 32 - fy - .5
  const p = E.pick('classic', [{ id: 'head', o: [-4 + 2.5, 32 - 4.5, 50], d: [0, 0, -1] }]);
  assert.strictEqual(p.face, 'front'); assert.strictEqual(p.x, 8 + 2); assert.strictEqual(p.y, 8 + 4);
});
t('pick: the outer hat layer is hit before the head (inflated 0.5)', () => {
  const p = E.pick('classic', [{ id: 'head', o: [0.5, 28.5, 50], d: [0, 0, -1] }, { id: 'hat', o: [0.5, 28.5, 50], d: [0, 0, -1] }]);
  assert.strictEqual(p.part, 'hat'); assert.strictEqual(p.x, 40 + 4);
});
t('pick: back, top, side faces map into their rects', () => {
  const back = E.pick('classic', [{ id: 'head', o: [-3.5, 31.5, -50], d: [0, 0, 1] }]);   // seen from behind: x -3.5 is the right-most column of the back
  assert.strictEqual(back.face, 'back'); assert.strictEqual(back.x, 24 + 7); assert.strictEqual(back.y, 8);
  const top = E.pick('classic', [{ id: 'head', o: [-3.5, 50, 3.5], d: [0, -1, 0] }]);       // front-left corner of the top = bottom-left of the top rect
  assert.strictEqual(top.face, 'top'); assert.strictEqual(top.x, 8); assert.strictEqual(top.y, 7);
  const side = E.pick('classic', [{ id: 'rarm', o: [-50, 23.5, -1.5], d: [1, 0, 0] }]);      // right arm outer side, back half
  assert.strictEqual(side.face, 'right'); assert.strictEqual(side.part, 'rarm'); assert.strictEqual(side.x, 40); assert.strictEqual(side.y, 20);
});
t('hitPixel stays inside its face at the far edges', () => {
  const r = E.hitPixel('classic', 'body', [4, 12, 2], 'front');
  assert.strictEqual(r.x, 27); assert.strictEqual(r.y, 31);
});

/* ---------------- mirror / symmetry ---------------- */
t('mirrorPixel: right arm front <-> left arm front, columns reversed', () => {
  assert.deepStrictEqual(Array.from(E.mirrorPixel('classic', 44, 25)), [36 + 3, 52 + 5]);
  assert.deepStrictEqual(Array.from(E.mirrorPixel('classic', 39, 57)), [44, 25]);
});
t('mirrorPixel: head front mirrors onto itself, head right side <-> left side', () => {
  assert.deepStrictEqual(Array.from(E.mirrorPixel('classic', 8, 10)), [15, 10]);
  assert.deepStrictEqual(Array.from(E.mirrorPixel('classic', 0, 10)), [16 + 7, 10]);
});
t('mirrorPixel is an involution on every used pixel (classic and slim)', () => {
  ['classic', 'slim'].forEach((m) => { for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const a = E.mirrorPixel(m, x, y); if (!a) continue; const b = E.mirrorPixel(m, a[0], a[1]); assert.deepStrictEqual(Array.from(b), [x, y], m + ' ' + x + ',' + y); } });
});
t('slim mirror: right arm front col 0 <-> left arm front col 2', () => {
  assert.deepStrictEqual(Array.from(E.mirrorPixel('slim', 44, 20)), [36 + 2, 52]);
});
t('symPixels with body + faceX gives up to 4 pixels', () => {
  const s = E.symPixels('classic', 44, 25, { body: true, faceX: true });
  assert.strictEqual(s.length, 4);
});

/* ---------------- strokes + brushes ---------------- */
t('pencil stroke interpolates between far points (no gaps)', () => {
  const b = E.newBuf(), st = E.beginStroke(b, { color: RED });
  E.strokeTo(st, 2, 2); E.strokeTo(st, 20, 9);
  assert.strictEqual(count(b, (c) => c[3]), 19);
});
t('stroke opacity does not stack on overlapping dabs', () => {
  const b = solid([255, 255, 255, 255]), st = E.beginStroke(b, { color: [0, 0, 0, 255], opacity: 0.5, size: 3 });
  E.strokeTo(st, 10, 10); E.strokeTo(st, 12, 10); E.strokeTo(st, 10, 10);
  assert.deepStrictEqual(px(b, 11, 10).slice(0, 3), [128, 128, 128].map((v) => px(b, 11, 10)[0]));
  assert(Math.abs(px(b, 11, 10)[0] - 127.5) <= 1, 'half grey: ' + px(b, 11, 10));
});
t('brush footprints: size 3 square = 9, circle 5 smaller than square 5', () => {
  assert.strictEqual(E.footprint(3, 'square', 1).length, 9);
  assert(E.footprint(5, 'circle', 1).length < E.footprint(5, 'square', 1).length);
  assert(E.footprint(5, 'diamond', 1).length < E.footprint(5, 'circle', 1).length);
});
t('soft brush: hardness 0 gives partial coverage at the rim', () => {
  const b = E.newBuf(), st = E.beginStroke(b, { color: RED, size: 5, shape: 'circle', hardness: 0 });
  E.strokeTo(st, 20, 20);
  assert.strictEqual(px(b, 20, 20)[3], 255); assert(px(b, 22, 20)[3] < 255 && px(b, 22, 20)[3] > 0);
});
t('eraser clears alpha, mask protects pixels', () => {
  const b = solid(RED), mask = E.selRect(64, 64, 0, 0, 9, 63), st = E.beginStroke(b, { tool: 'eraser', size: 1, mask });
  E.strokeTo(st, 5, 5); E.strokeTo(st, 15, 5);
  assert.strictEqual(px(b, 5, 5)[3], 0); assert.strictEqual(px(b, 12, 5)[3], 255);
});
t('mirror painting paints the left arm when painting the right arm', () => {
  const b = E.newBuf(), st = E.beginStroke(b, { color: BLUE, model: 'classic', sym: { body: true } });
  E.strokeTo(st, 44, 25);
  assert.deepStrictEqual(px(b, 39, 57), BLUE);
});
t('lighten / darken change lightness only where there is paint', () => {
  const b = solid([100, 100, 100, 255]); b.data.fill(0, 0, 4);
  const st = E.beginStroke(b, { tool: 'darken', amount: 0.2, size: 2 });
  E.strokeTo(st, 0, 0);
  assert(px(b, 1, 1)[0] < 100); assert.strictEqual(px(b, 0, 0)[3], 0);
  const s2 = E.beginStroke(b, { tool: 'lighten', amount: 0.2 }); E.strokeTo(s2, 5, 5);
  assert(px(b, 5, 5)[0] > 100);
});
t('noise is deterministic per seed and keeps alpha', () => {
  const a = solid([120, 120, 120, 255]), b = solid([120, 120, 120, 255]);
  [a, b].forEach((x) => { const st = E.beginStroke(x, { tool: 'noise', amount: 0.3, size: 4, seed: 7 }); E.strokeTo(st, 10, 10); });
  assert.deepStrictEqual(Array.from(a.data), Array.from(b.data));
  assert(count(a, (c) => c[0] !== 120) > 4);
});
t('dither alternates the two colours in a Bayer pattern', () => {
  const b = E.newBuf(), st = E.beginStroke(b, { tool: 'dither', color: RED, color2: BLUE, amount: 0.5, size: 4 });
  E.strokeTo(st, 10, 10);
  const reds = count(b, (c) => c[0] === 255), blues = count(b, (c) => c[2] === 255);
  assert.strictEqual(reds, 8); assert.strictEqual(blues, 8);
});
t('blur softens a hard edge; smudge drags colour along the stroke', () => {
  const b = E.newBuf(); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) E.set(b, x, y, x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  const st = E.beginStroke(b, { tool: 'blur', size: 1 }); E.strokeTo(st, 32, 10);
  assert(px(b, 32, 10)[0] > 0 && px(b, 32, 10)[0] < 255);
  const s2 = E.beginStroke(b, { tool: 'smudge', amount: 0.8 }); E.strokeTo(s2, 28, 20); E.strokeTo(s2, 36, 20);
  assert(px(b, 34, 20)[0] < 255, 'black dragged into white');
});

/* ---------------- shapes, gradient, fill ---------------- */
t('rectangle outline vs filled, ellipse outline', () => {
  const a = E.newBuf(); E.drawRect(a, 0, 0, 4, 3, { color: RED }); assert.strictEqual(count(a, (c) => c[3]), 14);
  const b = E.newBuf(); E.drawRect(b, 0, 0, 4, 3, { color: RED, filled: true }); assert.strictEqual(count(b, (c) => c[3]), 20);
  const c = E.newBuf(); E.drawEllipse(c, 0, 0, 7, 7, { color: RED }); const f = E.newBuf(); E.drawEllipse(f, 0, 0, 7, 7, { color: RED, filled: true });
  assert(count(c, (q) => q[3]) < count(f, (q) => q[3])); assert.strictEqual(px(f, 0, 0)[3], 0, 'corner outside the ellipse');
});
t('line with size 2 is thicker than size 1', () => {
  const a = E.newBuf(), b = E.newBuf();
  E.drawLine(a, 0, 0, 10, 10, { color: RED }); E.drawLine(b, 0, 0, 10, 10, { color: RED, size: 2 });
  assert(count(b, (c) => c[3]) > count(a, (c) => c[3]));
});
t('linear gradient goes from c1 to c2, steps posterise, mask limits', () => {
  const b = E.newBuf(), mask = E.selRect(64, 64, 0, 0, 63, 0);
  E.gradient(b, 0, 0, 63, 0, { c1: [0, 0, 0, 255], c2: [255, 255, 255, 255], mask });
  assert.strictEqual(px(b, 0, 0)[0], 0); assert.strictEqual(px(b, 63, 0)[0], 255); assert.strictEqual(px(b, 10, 5)[3], 0);
  const s = E.newBuf(); E.gradient(s, 0, 0, 63, 0, { c1: [0, 0, 0, 255], c2: [255, 255, 255, 255], steps: 4 });
  assert.strictEqual(new Set(Array.from({ length: 64 }, (_, x) => px(s, x, 0)[0])).size, 4);
});
t('radial gradient is symmetric around its centre', () => {
  const b = E.newBuf(); E.gradient(b, 32, 32, 42, 32, { type: 'radial', c1: RED, c2: BLUE });
  assert.deepStrictEqual(px(b, 27, 32), px(b, 37, 32));
});
t('bucket fill: contiguous stays inside an outline, global takes every match', () => {
  const b = E.newBuf(); E.drawRect(b, 0, 0, 9, 9, { color: RED });
  E.fill(b, 5, 5, BLUE, {});
  assert.deepStrictEqual(px(b, 5, 5), BLUE); assert.deepStrictEqual(px(b, 20, 20), CLEAR);
  const g = E.newBuf(); E.set(g, 1, 1, RED); E.set(g, 30, 30, RED);
  E.fill(g, 1, 1, GREEN, { contiguous: false }); assert.deepStrictEqual(px(g, 30, 30), GREEN);
});
t('bucket fill tolerance includes near colours', () => {
  const b = solid([100, 100, 100, 255]); E.set(b, 3, 3, [110, 100, 100, 255]);
  E.fill(b, 0, 0, RED, { tolerance: 5 }); assert.deepStrictEqual(px(b, 3, 3), [110, 100, 100, 255]);
  const c = solid([100, 100, 100, 255]); E.set(c, 3, 3, [110, 100, 100, 255]);
  E.fill(c, 0, 0, BLUE, { tolerance: 12 }); assert.deepStrictEqual(px(c, 3, 3), BLUE);
});
t('bucket fill limited to one face never leaks into the neighbour face or unused pixels', () => {
  const b = E.newBuf();
  E.fill(b, 10, 10, RED, { model: 'classic', limit: 'face' });
  assert.strictEqual(count(b, (c) => c[3]), 64);
  const p = E.newBuf(); E.fill(p, 10, 10, RED, { model: 'classic', limit: 'part' });
  assert.strictEqual(count(p, (c) => c[3]), 8 * 8 * 6);
  const u = E.newBuf(); assert.strictEqual(E.fill(u, 0, 0, RED, { model: 'classic' }), null, 'unused pixel: nothing');
});
t('replace colour swaps every matching pixel', () => {
  const b = E.newBuf(); E.set(b, 1, 1, RED); E.set(b, 9, 9, RED); E.set(b, 5, 5, BLUE);
  E.replaceColor(b, RED, GREEN, 0);
  assert.deepStrictEqual(px(b, 9, 9), GREEN); assert.deepStrictEqual(px(b, 5, 5), BLUE);
});

/* ---------------- selections ---------------- */
t('rect / lasso / wand selections', () => {
  assert.strictEqual(E.selCount(E.selRect(64, 64, 2, 2, 5, 4)), 12);
  const l = E.selLasso(64, 64, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert(E.selCount(l) >= 100 && E.selCount(l) <= 121);
  const b = E.newBuf(); E.drawRect(b, 0, 0, 3, 3, { color: RED, filled: true });
  assert.strictEqual(E.selCount(E.selWand(b, 1, 1, {})), 16);
});
t('selection combine: add, subtract, intersect, invert', () => {
  const a = E.selRect(64, 64, 0, 0, 3, 0), b = E.selRect(64, 64, 2, 0, 5, 0);
  assert.strictEqual(E.selCount(E.selCombine(a, b, 'add')), 6);
  assert.strictEqual(E.selCount(E.selCombine(a, b, 'sub')), 2);
  assert.strictEqual(E.selCount(E.selCombine(a, b, 'and')), 2);
  assert.strictEqual(E.selCount(E.selInvert(a)), 4096 - 4);
});
t('lift + move + drop moves pixels; copy keeps the source', () => {
  const b = E.newBuf(); E.set(b, 1, 1, RED); E.set(b, 2, 1, BLUE);
  const fl = E.lift(b, E.selRect(64, 64, 1, 1, 2, 1), true);
  assert.deepStrictEqual(px(b, 1, 1), CLEAR);
  fl.x = 10; fl.y = 10; E.drop(b, fl);
  assert.deepStrictEqual(px(b, 10, 10), RED); assert.deepStrictEqual(px(b, 11, 10), BLUE);
  const c = E.lift(b, E.selRect(64, 64, 10, 10, 11, 10), false); assert(c); assert.deepStrictEqual(px(b, 10, 10), RED);
});
t('floating transforms: flipH swaps, rotCW turns a 2x1 into a 1x2', () => {
  const fl = { x: 0, y: 0, w: 2, h: 1, data: new Uint8ClampedArray([...RED, ...BLUE]) };
  const f = E.flTransform(fl, 'flipH'); assert.deepStrictEqual(Array.from(f.data.slice(0, 4)), BLUE);
  const r = E.flTransform(fl, 'rotCW'); assert.strictEqual(r.w, 1); assert.strictEqual(r.h, 2); assert.deepStrictEqual(Array.from(r.data.slice(0, 4)), RED);
  const back = E.flTransform(E.flTransform(r, 'rotCCW'), 'flipH'); assert.deepStrictEqual(Array.from(back.data.slice(0, 4)), BLUE);
});
t('selection edges trace a 2x2 square with 8 unit segments', () => {
  assert.strictEqual(E.selEdges(E.selRect(64, 64, 0, 0, 1, 1)).length, 8);
});

/* ---------------- adjustments + palette ---------------- */
t('adjust: invert, grayscale, hue shift, posterise', () => {
  const b = E.newBuf(); E.set(b, 0, 0, RED);
  E.adjust(b, { invert: true }); assert.deepStrictEqual(px(b, 0, 0), [0, 255, 255, 255]);
  E.adjust(b, { hue: 180 }); assert.deepStrictEqual(px(b, 0, 0), RED);
  E.adjust(b, { gray: true }); const g = px(b, 0, 0); assert(g[0] === g[1] && g[1] === g[2]);
  const p = E.newBuf(); E.set(p, 0, 0, [100, 140, 30, 255]); E.adjust(p, { posterize: 2 }); assert.deepStrictEqual(px(p, 0, 0), [0, 255, 0, 255]);
});
t('palette: most used first, near colours merged', () => {
  const b = E.newBuf(); for (let i = 0; i < 30; i++) E.set(b, i, 0, RED); for (let i = 0; i < 10; i++) E.set(b, i, 1, BLUE); E.set(b, 0, 2, [254, 1, 0, 255]);
  const pal = E.palette(b, 8);
  assert.deepStrictEqual(Array.from(pal), ['#ff0000', '#0000ff']);
});

/* ---------------- layers ---------------- */
t('composite: layer order, opacity, visibility, multiply', () => {
  const doc = E.newDoc('classic', solid([200, 200, 200, 255]));
  const L = E.addLayer(doc, 'Top'); E.set(L.buf, 0, 0, [0, 0, 0, 255]); L.opacity = 0.5;
  assert(Math.abs(px(E.composite(doc), 0, 0)[0] - 100) <= 1);
  L.visible = false; assert.strictEqual(px(E.composite(doc), 0, 0)[0], 200);
  L.visible = true; L.opacity = 1; L.blend = 'multiply'; E.set(L.buf, 1, 0, [128, 255, 255, 255]);
  assert(Math.abs(px(E.composite(doc), 1, 0)[0] - 100) <= 1);
});
t('merge down + move + remove keep the active layer sensible', () => {
  const doc = E.newDoc('classic'); E.addLayer(doc, 'A'); E.addLayer(doc, 'B');
  assert.strictEqual(doc.layers.length, 3); assert.strictEqual(doc.active, 2);
  E.set(doc.layers[2].buf, 3, 3, RED);
  E.mergeDown(doc, 2); assert.strictEqual(doc.layers.length, 2); assert.deepStrictEqual(px(doc.layers[1].buf, 3, 3), RED);
  E.moveLayer(doc, 1, 0); assert.strictEqual(doc.active, 0); assert.strictEqual(doc.layers[0].name, 'A');
  E.removeLayer(doc, 0); assert.strictEqual(doc.layers.length, 1); assert.strictEqual(E.removeLayer(doc, 0), false, 'never removes the last layer');
});

/* ---------------- history ---------------- */
t('undo / redo restore pixels exactly, steps are named', () => {
  const doc = E.newDoc('classic'), H = new E.History(), L = doc.layers[0];
  const before = E.cloneBuf(L.buf); const st = E.beginStroke(L.buf, { color: RED }); E.strokeTo(st, 0, 0); E.strokeTo(st, 9, 0);
  const step = H.pixels('Pencil', L.id, before, L.buf);
  assert.strictEqual(step.idx.length, 10);
  H.undo(doc); assert.strictEqual(count(L.buf, (c) => c[3]), 0);
  H.redo(doc); assert.strictEqual(count(L.buf, (c) => c[3]), 10);
  assert.deepStrictEqual(H.list().map((s) => s.name), ['Pencil']);
});
t('history: no-op stroke adds no step; new step after undo drops the redo branch', () => {
  const doc = E.newDoc('classic'), H = new E.History(), L = doc.layers[0];
  assert.strictEqual(H.pixels('x', L.id, E.cloneBuf(L.buf), L.buf), null);
  const b0 = E.cloneBuf(L.buf); E.set(L.buf, 0, 0, RED); H.pixels('a', L.id, b0, L.buf);
  const b1 = E.cloneBuf(L.buf); E.set(L.buf, 1, 0, RED); H.pixels('b', L.id, b1, L.buf);
  H.undo(doc); const b2 = E.cloneBuf(L.buf); E.set(L.buf, 2, 0, RED); H.pixels('c', L.id, b2, L.buf);
  assert.deepStrictEqual(H.list().map((s) => s.name), ['a', 'c']); assert.strictEqual(H.canRedo, false);
});
t('history memory cap drops the oldest steps', () => {
  const doc = E.newDoc('classic'), H = new E.History({ maxBytes: 5000 }), L = doc.layers[0];
  for (let k = 0; k < 10; k++) { const b = E.cloneBuf(L.buf); E.fill(L.buf, 0, 0, [k * 20, 0, 0, 255], { contiguous: false }); H.pixels('fill ' + k, L.id, b, L.buf); }
  assert(H.bytes <= 5000 || H.steps.length === 1); assert(H.steps.length < 10);
});
t('document steps (add layer) undo and redo', () => {
  const doc = E.newDoc('classic'), H = new E.History();
  const s0 = E.snapshot(doc); E.addLayer(doc, 'New'); H.doc('Add layer', s0, E.snapshot(doc));
  H.undo(doc); assert.strictEqual(doc.layers.length, 1); H.redo(doc); assert.strictEqual(doc.layers.length, 2);
});

/* ---------------- formats + game rules ---------------- */
t('legacy 64x32 -> 64x64: left leg front = flipped right leg front, left arm front = flipped right arm front', () => {
  const src = E.newBuf(64, 32); for (let i = 0; i < 64 * 32; i++) src.data.set([i & 255, (i >> 8) + 10, 5, 255], i * 4);
  const b = E.fromLegacy(src);
  assert.strictEqual(b.h, 64);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) {
    assert.deepStrictEqual(px(b, 20 + 3 - x, 52 + y), px(src, 4 + x, 20 + y), 'leg front');
    assert.deepStrictEqual(px(b, 36 + 3 - x, 52 + y), px(src, 44 + x, 20 + y), 'arm front');
  }
  // the outer side of the right leg (0,20) becomes the outer side of the left leg (24,52), flipped
  assert.deepStrictEqual(px(b, 24 + 3, 52), px(src, 0, 20));
});
t('legacy: an all-opaque hat area is cleared (notch transparency hack), a real hat is kept', () => {
  const src = E.newBuf(64, 32); src.data.fill(255);
  const b = E.fromLegacy(src); assert.strictEqual(px(b, 40, 8)[3], 0); assert.strictEqual(px(b, 20, 20)[3], 255);
  const s2 = E.newBuf(64, 32); s2.data.fill(255); s2.data[(0 * 64 + 40) * 4 + 3] = 0;
  assert.strictEqual(px(E.fromLegacy(s2), 41, 8)[3], 255);
});
t('flattenBase: base pixels become opaque (game rule); outer stays transparent', () => {
  const b = E.newBuf(); E.set(b, 8, 8, [10, 20, 30, 100]);
  E.flattenBase(b, 'classic', 'game');
  assert.deepStrictEqual(px(b, 8, 8), [10, 20, 30, 255]); assert.strictEqual(px(b, 9, 8)[3], 255); assert.strictEqual(px(b, 40, 8)[3], 0);
  const f = E.newBuf(); E.set(f, 8, 8, [255, 255, 255, 128]); E.flattenBase(f, 'classic', 'fill', [0, 0, 0, 255]);
  assert(Math.abs(px(f, 8, 8)[0] - 128) <= 1);
});
t('check() counts transparent base pixels and unused paint', () => {
  const b = solid(RED); const r = E.check(b, 'classic');
  assert.strictEqual(r.transparentBase, 0); assert.strictEqual(r.unusedPixels, 4096 - 3264);
  const e = E.check(E.newBuf(), 'classic'); assert.strictEqual(e.transparentBase, 1632); assert.strictEqual(e.emptyOuter, true);
});
t('clearUnused clears exactly the unused pixels', () => {
  const b = solid(RED); E.clearUnused(b, 'slim');
  assert.strictEqual(count(b, (c) => c[3]), 3136);
});
t('slim detection + classic -> slim -> classic keeps the side faces and the outer columns', () => {
  const b = traced('classic');
  assert.strictEqual(E.detectSlim(b), false);
  const s = E.refitArms(b, 'classic', 'slim');
  assert.strictEqual(E.detectSlim(s), true);
  // side faces are unchanged in content; the slim back face moved 1px left
  assert.deepStrictEqual(px(s, 40, 20), px(b, 40, 20), 'right side face stays');
  assert.deepStrictEqual(px(s, 47, 20), px(b, 48, 20), 'left side face shifts to 47');
  // the outer column of the right arm front (col 0) survives
  assert.deepStrictEqual(px(s, 44, 25), px(b, 44, 25));
  const c = E.refitArms(s, 'slim', 'classic');
  assert.strictEqual(E.detectSlim(c), false);
  assert.deepStrictEqual(px(c, 48, 20), px(b, 48, 20), 'side face returns to 48');
});
t('copyPart with mirror: right arm onto left arm equals painting with body mirror', () => {
  const b = E.newBuf(); E.set(b, 44, 25, RED); E.set(b, 40, 22, BLUE);
  E.copyPart(b, 'classic', 'rarm', 'larm', true);
  const m1 = E.mirrorPixel('classic', 44, 25), m2 = E.mirrorPixel('classic', 40, 22);
  assert.deepStrictEqual(px(b, m1[0], m1[1]), RED); assert.deepStrictEqual(px(b, m2[0], m2[1]), BLUE);
});
t('clearPart clears all six faces of one part only', () => {
  const b = solid(RED); E.clearPart(b, 'classic', 'head');
  assert.strictEqual(px(b, 8, 8)[3], 0); assert.strictEqual(px(b, 40, 8)[3], 255);
});
t('puff: copy fills the hat from the head, outline only the rim, details skip the main colour', () => {
  const b = E.newBuf(); E.fill(b, 10, 10, RED, { model: 'classic', limit: 'part' }); E.set(b, 11, 11, BLUE);
  const c = E.cloneBuf(b); E.puff(c, 'classic', 'copy', ['head']); assert.deepStrictEqual(px(c, 43, 11), BLUE); assert.deepStrictEqual(px(c, 42, 10), RED);
  const o = E.cloneBuf(b); E.puff(o, 'classic', 'outline', ['head']); assert.strictEqual(px(o, 40, 8)[3], 255); assert.strictEqual(px(o, 43, 11)[3], 0);
  const d = E.cloneBuf(b); E.puff(d, 'classic', 'details', ['head']); assert.deepStrictEqual(px(d, 43, 11), BLUE); assert.strictEqual(px(d, 42, 10)[3], 0);
});
t('validate: sizes, legacy, HD downscale note, wrong size and empty images', () => {
  const ok = (w, h) => E.validate({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
  assert.strictEqual(ok(64, 64).kind, 'skin'); assert.strictEqual(ok(64, 32).kind, 'legacy');
  assert.strictEqual(ok(128, 128).kind, 'hd'); assert.strictEqual(ok(128, 128).scale, 2);
  assert.strictEqual(ok(100, 50).ok, false);
  assert.strictEqual(E.validate({ w: 64, h: 64, data: new Uint8ClampedArray(64 * 64 * 4) }).ok, false);
});
t('downscale keeps the most common colour of each block', () => {
  const big = E.newBuf(128, 128); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) E.set(big, x, y, (x + y) % 4 === 0 ? BLUE : RED);
  const s = E.downscale(big, 2); assert.strictEqual(s.w, 64); assert.deepStrictEqual(px(s, 0, 0), RED);
});
t('importImage: 128x128 HD -> 64x64, slim auto-detected', () => {
  const big = E.newBuf(128, 128); big.data.fill(255);
  const r = E.importImage({ w: 128, h: 128, data: big.data });
  assert.strictEqual(r.buf.w, 64); assert.strictEqual(r.model, 'classic'); assert(r.notes.length);
});
t('PNG encoder: valid signature, IHDR, CRCs and zlib stream inflate back to the pixels', () => {
  const b = traced('classic'), png = Buffer.from(E.encodePNG(b));
  assert.deepStrictEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.strictEqual(png.readUInt32BE(16), 64); assert.strictEqual(png.readUInt32BE(20), 64);
  const len = png.readUInt32BE(33), idat = png.slice(41, 41 + len);
  assert.strictEqual(png.readUInt32BE(41 + len), E.crc32(png, 37, 41 + len));
  const raw = zlib.inflateSync(idat);
  assert.strictEqual(raw.length, 64 * (64 * 4 + 1));
  assert.deepStrictEqual(Array.from(raw.slice(1 + 8 * 4, 1 + 8 * 4 + 4)), px(b, 8, 0));
  assert(E.pngDataURL(b).startsWith('data:image/png;base64,iVBORw0KGgo'));
});
t('raw base64 round trip of a layer', () => {
  const b = traced('slim'), s = E.bufToB64(b), r = E.b64ToBuf(s);
  assert.deepStrictEqual(Array.from(r.data), Array.from(b.data)); assert.strictEqual(E.b64ToBuf('nope'), null);
});
t('project scales an image into a face rect (reference stamp)', () => {
  const src = E.newBuf(2, 2); E.set(src, 0, 0, RED); E.set(src, 1, 0, BLUE); E.set(src, 0, 1, GREEN); E.set(src, 1, 1, GREEN);
  const b = E.newBuf(), R = rect('classic', 'head', 'front'); E.project(src, b, [R.x, R.y, R.w, R.h], 1);
  assert.deepStrictEqual(px(b, 8, 8), RED); assert.deepStrictEqual(px(b, 15, 8), BLUE); assert.deepStrictEqual(px(b, 8, 15), GREEN);
});
t('hex colours parse and print (#rgb, #rrggbb, #rrggbbaa)', () => {
  assert.deepStrictEqual(Array.from(E.hex2rgba('#f00')), RED); assert.deepStrictEqual(Array.from(E.hex2rgba('00ff0080')), [0, 255, 0, 128]);
  assert.strictEqual(E.hex2rgba('zz'), null); assert.strictEqual(E.rgba2hex([1, 2, 3, 255]), '#010203'); assert.strictEqual(E.rgba2hex([1, 2, 3, 4], true), '#01020304');
});
t('HSV round trip', () => {
  [[255, 0, 0], [12, 200, 99], [128, 128, 128]].forEach((c) => { const h = E.rgb2hsv(...c); assert.deepStrictEqual(E.hsv2rgb(...h), c); });
});
t('cape rects: the cape front is 1,1 10x16 and the elytra front 24,2', () => {
  const R = E.capeRects(), f = R.find((r) => r.part === 'cape' && r.face === 'front'), e = R.find((r) => r.part === 'elytra' && r.face === 'front');
  assert.deepStrictEqual([f.x, f.y, f.w, f.h], [1, 1, 10, 16]); assert.deepStrictEqual([e.x, e.y], [24, 2]);
});
t('pose maths: every Skin Editor animation produces finite numbers', () => {
  ['rest', 'idle', 'walk', 'run', 'sneak', 'crouch', 'wave', 'attack', 'sit', 'spin', 'fly', 'jump'].forEach((id) => {
    const P = M.newPose(); M.computePose(P, M.ANIM_CFG[id], 37, 12, 0.6, 9);
    assert(Array.from(P).every(Number.isFinite), id);
  });
  const P = M.newPose(); M.computePose(P, M.ANIM_CFG.rest, 100, 0, 0, 100);
  const Q = M.newPose(); M.computePose(Q, M.ANIM_CFG.rest, 7, 0, 0, 7);
  assert.deepStrictEqual(Array.from(P), Array.from(Q), 'the rest pose never moves');
});

/* ---- gradients across a whole part, face to face copies (Oct 2026 bug report: arm backs did not match the fronts) ---- */
t('gradient: straight sRGB line, the exact picked colours at both ends (no hue detour)', () => {
  const b = E.newBuf(), c1 = [226, 232, 230, 255], c2 = [0, 0, 52, 255];
  E.gradient(b, 10, 0, 10, 11, { c1, c2 });
  assert.deepStrictEqual(px(b, 10, 0), c1); assert.deepStrictEqual(px(b, 10, 11), c2);
  for (let y = 0; y < 12; y++) { const t2 = y / 11, c = px(b, 3, y); [0, 1, 2].forEach((k) => assert(Math.abs(c[k] - (c1[k] + (c2[k] - c1[k]) * t2)) <= 1, 'row ' + y)); }
});
['classic', 'slim'].forEach((m) => t('partGradient (' + m + '): every side face of an arm and its sleeve has the same colour at the same height, ends exact', () => {
  const b = E.newBuf(), c1 = [226, 232, 230, 255], c2 = [0, 0, 52, 255], F = E.rectOf(m, 'rarm', 'front');
  const r = E.partGradient(b, m, { a: [F.x + 1, F.y], b: [F.x + 1, F.y + F.h - 1], c1, c2, layers: 'both' });
  assert(r, 'paints something');
  ['rarm', 'rsleeve'].forEach((part) => ['front', 'back', 'right', 'left'].forEach((face) => {
    const R = E.rectOf(m, part, face);
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) assert.deepStrictEqual(px(b, R.x + x, R.y + y), px(b, F.x, F.y + y), part + ' ' + face + ' row ' + y);
  }));
  assert.deepStrictEqual(px(b, F.x, F.y), c1); assert.deepStrictEqual(px(b, F.x, F.y + F.h - 1), c2);
  assert.deepStrictEqual(px(b, E.rectOf(m, 'larm', 'front').x, E.rectOf(m, 'larm', 'front').y), CLEAR, 'other parts stay untouched');
}));
t('partGradient: only this layer by default; top and bottom take the end colours; width axis runs across front and back mirrored', () => {
  const m = 'classic', b = E.newBuf(), F = E.rectOf(m, 'rleg', 'front');
  E.partGradient(b, m, { a: [F.x, F.y], b: [F.x, F.y + F.h - 1], c1: RED, c2: BLUE });
  assert.deepStrictEqual(px(b, E.rectOf(m, 'rpants', 'front').x, E.rectOf(m, 'rpants', 'front').y), CLEAR);
  assert.deepStrictEqual(px(b, E.rectOf(m, 'rleg', 'top').x, E.rectOf(m, 'rleg', 'top').y), RED);
  assert.deepStrictEqual(px(b, E.rectOf(m, 'rleg', 'bottom').x, E.rectOf(m, 'rleg', 'bottom').y), BLUE);
  const w = E.newBuf();
  E.partGradient(w, m, { a: [F.x, F.y + 3], b: [F.x + F.w - 1, F.y + 3], c1: RED, c2: BLUE, axis: 'width' });
  const B = E.rectOf(m, 'rleg', 'back');
  assert.deepStrictEqual(px(w, F.x, F.y), RED); assert.deepStrictEqual(px(w, F.x + 3, F.y), BLUE);
  assert.deepStrictEqual(px(w, B.x + 3, B.y), RED, 'the back is the mirror of the front');
});
t('copyFace: front to back keeps every pixel (same or mirrored); different widths resample by row', () => {
  const m = 'slim', b = traced(m), F = E.rectOf(m, 'rsleeve', 'front'), B = E.rectOf(m, 'rsleeve', 'back');
  const r = E.copyFace(b, m, 'rsleeve', 'front', 'back', 'same');
  assert(r);
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) assert.deepStrictEqual(px(b, B.x + x, B.y + y), px(b, F.x + x, F.y + y));
  E.copyFace(b, m, 'rsleeve', 'front', 'back', 'mirror');
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) assert.deepStrictEqual(px(b, B.x + x, B.y + y), px(b, F.x + F.w - 1 - x, F.y + y));
  const L = E.rectOf(m, 'rsleeve', 'left');
  E.copyFace(b, m, 'rsleeve', 'front', 'left', 'same');
  for (let y = 0; y < L.h; y++) assert.deepStrictEqual(px(b, L.x, L.y + y), px(b, F.x, F.y + y), 'row ' + y);
});

/* ---- Photoshop-like selections (Oct 2026): shapes, boolean modes, grow / shrink, moving the outline, Alt-copy ---- */
const selOf = (cells) => { const s = E.selNew(); cells.forEach(([x, y]) => { s[y * 64 + x] = 1; }); return s; };
const cellsOf = (s) => { const out = []; for (let i = 0; i < s.length; i++) if (s[i]) out.push((i % 64) + ',' + ((i / 64) | 0)); return out; };
t('selEllipse: a 5x5 ellipse is a plus-ish disc, symmetric, inside its box', () => {
  const s = E.selEllipse(64, 64, 10, 10, 14, 14);
  assert.strictEqual(s[12 * 64 + 12], 1); assert.strictEqual(s[10 * 64 + 10], 0, 'corners stay out'); assert.strictEqual(s[10 * 64 + 12], 1); assert.strictEqual(s[12 * 64 + 10], 1);
  assert.strictEqual(E.selCount(s), E.selCount(E.selEllipse(64, 64, 14, 14, 10, 10)), 'corner order does not matter');
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (s[y * 64 + x]) { assert(x >= 10 && x <= 14 && y >= 10 && y <= 14); assert.strictEqual(s[y * 64 + (24 - x)], 1, 'mirror symmetric'); }
  assert.strictEqual(E.selCount(E.selEllipse(64, 64, 3, 3, 3, 3)), 1, 'a one-pixel ellipse is that pixel');
});
t('selPolygon: a triangle selects the pixel centres inside it', () => {
  const s = E.selPolygon(64, 64, [[0, 0], [8, 0], [0, 8]]);
  assert.strictEqual(s[0], 1); assert.strictEqual(s[1 * 64 + 1], 1); assert.strictEqual(s[7 * 64 + 7], 0);
});
t('selCombine: new, add, subtract, intersect (the four Photoshop modes)', () => {
  const a = selOf([[1, 1], [2, 1]]), b = selOf([[2, 1], [3, 1]]);
  assert.deepStrictEqual(cellsOf(E.selCombine(a, b, 'new')), ['2,1', '3,1']);
  assert.deepStrictEqual(cellsOf(E.selCombine(a, b, 'add')), ['1,1', '2,1', '3,1']);
  assert.deepStrictEqual(cellsOf(E.selCombine(a, b, 'sub')), ['1,1']);
  assert.deepStrictEqual(cellsOf(E.selCombine(a, b, 'int')), ['2,1']);
  assert.deepStrictEqual(cellsOf(E.selInvert(E.selInvert(a))), cellsOf(a));
});
t('selGrow / selShrink by n pixels (square neighbourhood), shrink of a 1px line is empty, mask clips grow', () => {
  const one = selOf([[5, 5]]);
  assert.strictEqual(E.selCount(E.selGrow(one, 1)), 9); assert.strictEqual(E.selCount(E.selGrow(one, 2)), 25);
  const sq = E.selRect(64, 64, 2, 2, 6, 6);
  assert.strictEqual(E.selCount(E.selShrink(sq, 1)), 9); assert.strictEqual(E.selCount(E.selShrink(sq, 2)), 1); assert.strictEqual(E.selCount(E.selShrink(E.selRect(64, 64, 0, 0, 9, 0), 1)), 0);
  const edge = E.selRect(64, 64, 0, 0, 3, 3);
  assert.strictEqual(E.selCount(E.selShrink(edge, 1)), 4, 'the texture border counts as outside');
  const mask = E.selRect(64, 64, 5, 0, 5, 63);
  assert.deepStrictEqual(cellsOf(E.selGrow(one, 1, mask)), ['5,4', '5,5', '5,6']);
});
t('selShift moves the outline (not pixels), clipped at the texture edge', () => {
  assert.deepStrictEqual(cellsOf(E.selShift(selOf([[1, 1], [63, 2]]), 2, 1)), ['3,2']);
});
t('Move with Alt = copy: lift without cutting keeps the source, the dropped copy lands where it was moved', () => {
  const b = E.newBuf(); b.data.set(RED, (4 * 64 + 4) * 4);
  const fl = E.lift(b, selOf([[4, 4]]), false);
  assert.deepStrictEqual(px(b, 4, 4), RED, 'the source stays');
  fl.x += 3; E.drop(b, fl);
  assert.deepStrictEqual(px(b, 7, 4), RED); assert.deepStrictEqual(px(b, 4, 4), RED);
  const c = E.newBuf(); c.data.set(RED, (4 * 64 + 4) * 4); E.lift(c, selOf([[4, 4]]), true);
  assert.deepStrictEqual(px(c, 4, 4), CLEAR, 'a plain move cuts');
});

console.log(n + ' skins tests passed' + (process.exitCode ? ' (with failures)' : ''));
