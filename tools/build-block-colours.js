// Average texture colour of every block (side texture, opaque pixels, tint applied) -> js/data/block-colours.js
//   node tools/build-block-colours.js
// Reads the bundled textures in assets/mc/block (git-ignored; fetch them first with tools/fetch-icons.js and
// tools/fetch-artifact-assets.js). The table drives the Builds light shading with a light colour (nearest block by
// colour in Lab), so it has to be the same in the browser, offline and in the node tests: that is why it is a data file
// and not measured on a canvas at run time like the Palettes tool does.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');
const root = path.join(__dirname, '..');

/** Minimal PNG decoder (8-bit RGBA / RGB / grey / grey+alpha / palette, non-interlaced) -> { w, h, px: Uint8Array RGBA }. */
function png(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0, plte = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (inter || depth === 16) throw new Error('unsupported png (depth ' + depth + ', interlace ' + inter + ')');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], raw = zlib.inflateSync(Buffer.concat(idat)), stride = Math.ceil(w * ch * depth / 8);
  const bpp = Math.max(1, (ch * depth) >> 3);
  const packed = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride, out = packed;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, b = y ? out[row - stride + x] : 0, c = x >= bpp && y ? out[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + x] = v & 255;
    }
  }
  // samples to one byte each (sub-byte palette / grey images)
  let out = packed;
  if (depth < 8) {
    out = Buffer.alloc(w * h * ch);
    const per = 8 / depth, mask = (1 << depth) - 1, scale = ct === 3 ? 1 : 255 / mask;
    for (let y = 0; y < h; y++) for (let x = 0; x < w * ch; x++) {
      const byte = packed[y * stride + Math.floor(x / per)], shift = 8 - depth * (x % per + 1);
      out[y * w * ch + x] = Math.round(((byte >> shift) & mask) * scale);
    }
  }
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    let r, g, b, al = 255;
    if (ct === 6) { r = out[o]; g = out[o + 1]; b = out[o + 2]; al = out[o + 3]; }
    else if (ct === 2) { r = out[o]; g = out[o + 1]; b = out[o + 2]; }
    else if (ct === 0) { r = g = b = out[o]; }
    else if (ct === 4) { r = g = b = out[o]; al = out[o + 1]; }
    else { const k = out[o]; r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; al = trns && k < trns.length ? trns[k] : 255; }
    px.set([r, g, b, al], i * 4);
  }
  return { w, h, px };
}

const ctx = { console, Map, Set, Math, JSON, Object, Array, String, Number, Uint16Array, Uint8Array, Uint32Array, Int32Array, Float32Array };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext('window.TH = { data: {}, langData: {}, icon: () => null };', ctx);
for (const f of ['js/data/block-db.js', 'js/modules/builds-core.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const C = ctx.TH.builds.core, DB = ctx.TH.data.blockDb.b;
const names = [...new Set(Object.keys(C.BLOCKS).concat(Object.keys(DB)))].sort();
// textures not bundled yet come from the same mirror the app uses (js/core/icons.js VERSION) and are kept in assets/mc
const BASE = 'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@26.3/assets/minecraft/textures/';
async function ensure(tex) {
  const file = path.join(root, 'assets/mc', tex + '.png');
  if (fs.existsSync(file) || process.argv.includes('--offline')) return;
  try {
    const r = await fetch(BASE + tex + '.png');
    if (!r.ok) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  } catch (e) { /* offline: the block gets no colour */ }
}
(async () => {
const want = [...new Set(names.map((n) => { const d = C.def('minecraft:' + n); return d.s || d.t; }).filter((t) => t && t[0] !== '#' && /^block\//.test(t)))];
for (let i = 0; i < want.length; i += 16) await Promise.all(want.slice(i, i + 16).map(ensure));
const out = {};
let miss = 0;
for (const n of names) {
  const d = C.def('minecraft:' + n);
  const tex = d.s || d.t;
  if (!tex || tex[0] === '#') continue;
  const file = path.join(root, 'assets/mc', tex + '.png');
  if (!fs.existsSync(file)) { miss++; continue; }
  let im;
  try { im = png(fs.readFileSync(file)); } catch (e) { miss++; continue; }
  const W = Math.min(im.w, im.h);   // animated strips: the first frame
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const o = (y * im.w + x) * 4;
    if (im.px[o + 3] < 40) continue;
    r += im.px[o]; g += im.px[o + 1]; b += im.px[o + 2]; k++;
  }
  if (!k) continue;
  let rgb = [r / k, g / k, b / k];
  const tint = typeof d.tint === 'string' ? d.tint : d.tint && (d.tint.s || d.tint.t);
  if (tint && /^#[0-9a-f]{6}$/i.test(tint)) rgb = rgb.map((v, i) => v * parseInt(tint.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  out[n] = rgb.map(Math.round);
}
const body = Object.entries(out).map(([n, c]) => n + ':[' + c.join(',') + ']').join(',');
fs.writeFileSync(path.join(root, 'js/data/block-colours.js'),
  '// Generated by tools/build-block-colours.js: average colour (sRGB 0-255) of each block\'s side texture.\n' +
  'window.TH = window.TH || {}; TH.data = TH.data || {};\nTH.data.blockColours = {' + body + '};\n');
console.log('block colours: ' + Object.keys(out).length + ' blocks, ' + miss + ' textures missing');
})();
