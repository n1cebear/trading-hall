window.TH = window.TH || {};

/**
 * Skin Editor engine (TH.skinsEngine): pure functions on RGBA pixel buffers, no DOM. Tested by tools/test-skins.js.
 *
 *   buffer   = { w, h, data: Uint8ClampedArray(w * h * 4) }        (a skin is 64 x 64, a cape 64 x 32)
 *   mask     = Uint8Array(w * h), 1 = may be changed, or null (= everything)
 *   colour   = [r, g, b, a] (0..255)
 *   doc      = { model: 'classic' | 'slim', active, layers: [{ id, name, buf, opacity 0..1, blend, visible, locked }] }
 *   dirty    = { x0, y0, x1, y1 } inclusive pixel rect, or null when nothing changed
 *
 * UV layout = Minecraft box UV (64 x 64, see DESIGN.md "Skin Editor facts"): a box w x h x d at texture offset (u, v) has
 *   top (u+d, v, w, d)  bottom (u+d+w, v, w, d)  right (u, v+d, d, h)  front (u+d, v+d, w, h)  left (u+d+w, v+d, d, h)  back (u+2d+w, v+d, w, h)
 * Model geometry (box positions for picking) comes from TH.mcSkin.skinParts (js/core/mc-skin.js), shared with the viewers.
 */
TH.skinsEngine = (function () {
  'use strict';
  const W = 64, H = 64;
  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);

  /* ====================================================================== buffers + colours */
  const newBuf = (w, h) => ({ w: w || W, h: h || H, data: new Uint8ClampedArray((w || W) * (h || H) * 4) });
  const cloneBuf = (b) => ({ w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) });
  const copyInto = (dst, src) => { dst.data.set(src.data); return dst; };
  const get = (b, x, y) => { const i = (y * b.w + x) * 4, d = b.data; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const set = (b, x, y, c) => { const i = (y * b.w + x) * 4, d = b.data; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] == null ? 255 : c[3]; };
  const inB = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
  const hex2rgba = (hex) => {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255];
  };
  const hx = (n) => (n | 0).toString(16).padStart(2, '0');
  const rgba2hex = (c, withAlpha) => '#' + hx(c[0]) + hx(c[1]) + hx(c[2]) + (withAlpha && c[3] !== 255 ? hx(c[3]) : '');
  const colorDist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
  const sameColor = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
    return [hh, mx ? d / mx : 0, mx];
  }
  function hsv2rgb(hh, s, v) {
    hh = ((hh % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let hh = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = rgb2hsv(r * 255, g * 255, b * 255)[0]; }
    return [hh, s, l];
  }
  function hsl2rgb(hh, s, l) {
    const v = l + s * Math.min(l, 1 - l), sv = v ? 2 * (1 - l / v) : 0;
    return hsv2rgb(hh, sv, v);
  }

  /** a over b (straight alpha), result written to out at index o */
  function over(d, o, r, g, b, a) {
    const da = d[o + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
    if (oa <= 0) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; return; }
    d[o] = (r * sa + d[o] * da * (1 - sa)) / oa;
    d[o + 1] = (g * sa + d[o + 1] * da * (1 - sa)) / oa;
    d[o + 2] = (b * sa + d[o + 2] * da * (1 - sa)) / oa;
    d[o + 3] = oa * 255;
  }

  /* ====================================================================== UV map */
  // part ids follow TH.mcSkin.skinParts: base parts and their outer layer (hat, jacket, sleeves, pants)
  const PARTS = [
    { id: 'head', label: 'Head', layer: 'base', uv: [0, 0], size: [8, 8, 8], outer: 'hat', pair: 'head' },
    { id: 'hat', label: 'Hat', layer: 'outer', uv: [32, 0], size: [8, 8, 8], base: 'head', pair: 'hat' },
    { id: 'body', label: 'Body', layer: 'base', uv: [16, 16], size: [8, 12, 4], outer: 'jacket', pair: 'body' },
    { id: 'jacket', label: 'Jacket', layer: 'outer', uv: [16, 32], size: [8, 12, 4], base: 'body', pair: 'jacket' },
    { id: 'rarm', label: 'Right arm', layer: 'base', uv: [40, 16], size: [4, 12, 4], outer: 'rsleeve', pair: 'larm', arm: true },
    { id: 'rsleeve', label: 'Right sleeve', layer: 'outer', uv: [40, 32], size: [4, 12, 4], base: 'rarm', pair: 'lsleeve', arm: true },
    { id: 'larm', label: 'Left arm', layer: 'base', uv: [32, 48], size: [4, 12, 4], outer: 'lsleeve', pair: 'rarm', arm: true },
    { id: 'lsleeve', label: 'Left sleeve', layer: 'outer', uv: [48, 48], size: [4, 12, 4], base: 'larm', pair: 'rsleeve', arm: true },
    { id: 'rleg', label: 'Right leg', layer: 'base', uv: [0, 16], size: [4, 12, 4], outer: 'rpants', pair: 'lleg' },
    { id: 'rpants', label: 'Right pants', layer: 'outer', uv: [0, 32], size: [4, 12, 4], base: 'rleg', pair: 'lpants' },
    { id: 'lleg', label: 'Left leg', layer: 'base', uv: [16, 48], size: [4, 12, 4], outer: 'lpants', pair: 'rleg' },
    { id: 'lpants', label: 'Left pants', layer: 'outer', uv: [0, 48], size: [4, 12, 4], base: 'lleg', pair: 'rpants' },
  ];
  const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));
  const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];
  const FACE_PAIR = { top: 'top', bottom: 'bottom', right: 'left', left: 'right', front: 'front', back: 'back' };
  /** the size of a part for a model (slim arms are 3 wide) */
  const partSize = (id, model) => { const p = PART[id]; return p.arm && model === 'slim' ? [3, p.size[1], p.size[2]] : p.size; };
  /** face rects of a box: { top: [x, y, w, h], ... } */
  function boxRects(u, v, w, hh, d) {
    return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, hh], front: [u + d, v + d, w, hh], left: [u + d + w, v + d, d, hh], back: [u + 2 * d + w, v + d, w, hh] };
  }
  const rectCache = {};
  /** every face of every part: [{ part, face, x, y, w, h, layer }] */
  function faceRects(model) {
    model = model === 'slim' ? 'slim' : 'classic';
    if (rectCache[model]) return rectCache[model];
    const out = [];
    PARTS.forEach((p) => {
      const [w, hh, d] = partSize(p.id, model), R = boxRects(p.uv[0], p.uv[1], w, hh, d);
      FACES.forEach((f) => { const [x, y, rw, rh] = R[f]; out.push({ part: p.id, face: f, x, y, w: rw, h: rh, layer: p.layer }); });
    });
    return (rectCache[model] = out);
  }
  const mapCache = {};
  /** Int16Array(64*64): index into faceRects(model), -1 = unused pixel */
  function regionMap(model) {
    model = model === 'slim' ? 'slim' : 'classic';
    if (mapCache[model]) return mapCache[model];
    const m = new Int16Array(W * H).fill(-1);
    faceRects(model).forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * W + x] = i; });
    return (mapCache[model] = m);
  }
  /** { part, face, fx, fy, rect } for a pixel, or null for an unused pixel */
  function regionAt(model, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const i = regionMap(model)[y * W + x];
    if (i < 0) return null;
    const r = faceRects(model)[i];
    return { part: r.part, face: r.face, fx: x - r.x, fy: y - r.y, rect: r };
  }
  const rectOf = (model, part, face) => faceRects(model).find((r) => r.part === part && r.face === face) || null;
  /** mask of a region: limit = 'face' | 'part' | 'layer' (base / outer) for the region under (x, y); null for an unused pixel */
  function regionMask(model, x, y, limit) {
    const r = regionAt(model, x, y);
    if (!r) return null;
    const m = new Uint8Array(W * H), map = regionMap(model), rects = faceRects(model);
    for (let i = 0; i < m.length; i++) {
      const k = map[i];
      if (k < 0) continue;
      const q = rects[k];
      if (limit === 'face' ? q === r.rect : limit === 'part' ? q.part === r.part : q.layer === r.rect.layer) m[i] = 1;
    }
    return m;
  }
  /** mask of whole parts (ids) */
  function partsMask(model, ids) {
    const want = new Set(ids), m = new Uint8Array(W * H), map = regionMap(model), rects = faceRects(model);
    for (let i = 0; i < m.length; i++) { const k = map[i]; if (k >= 0 && want.has(rects[k].part)) m[i] = 1; }
    return m;
  }
  /** Cape texture (64 x 32): the 10 x 16 x 1 cape box at 0,0 and the elytra wing (10 x 20 x 2) at 22,0 */
  const CAPE_PARTS = [
    { id: 'cape', label: 'Cape', uv: [0, 0], size: [10, 16, 1] },
    { id: 'elytra', label: 'Elytra', uv: [22, 0], size: [10, 20, 2] },
  ];
  function capeRects() {
    const out = [];
    CAPE_PARTS.forEach((p) => { const R = boxRects(p.uv[0], p.uv[1], p.size[0], p.size[1], p.size[2]); FACES.forEach((f) => { const [x, y, w, hh] = R[f]; out.push({ part: p.id, face: f, x, y, w, h: hh }); }); });
    return out;
  }

  /* ====================================================================== picking: ray -> box face -> pixel */
  /** Slab test. o, d = ray origin / direction, mn / mx = box corners. Returns { t, n: [nx, ny, nz] } of the entry hit, or null. */
  function rayBox(o, d, mn, mx) {
    let t0 = -Infinity, t1 = Infinity, n0 = null;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
      let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) { t0 = ta; n0 = [0, 0, 0]; n0[a] = d[a] > 0 ? -1 : 1; }   // entering through the min side faces -axis
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    if (t1 < 0 || !n0) return null;
    return { t: t0 >= 0 ? t0 : t1, n: n0 };
  }
  const NORMAL_FACE = (n) => (n[2] > 0.5 ? 'front' : n[2] < -0.5 ? 'back' : n[0] < -0.5 ? 'right' : n[0] > 0.5 ? 'left' : n[1] > 0.5 ? 'top' : 'bottom');
  /** box (model units, inflated) of a part: { mn, mx } */
  function partBox(model, id) {
    const p = TH.mcSkin.skinParts(model === 'slim').find((q) => q.id === id);
    if (!p) return null;
    const [bx, by, bz, w, hh, d] = p.box, g = p.g || 0;
    return { mn: [bx - g, by - g, bz - g], mx: [bx + w + g, by + hh + g, bz + d + g], bone: p.bone };
  }
  /**
   * Pixel for a point on a part's box surface (model units, rest pose; the same mapping as TH.mcSkin.boxGeometry).
   * face: 'front' | ... (from the hit normal). Returns { x, y, face, part } in texture pixels.
   */
  function hitPixel(model, id, point, face) {
    const b = partBox(model, id), r = rectOf(model, id, face);
    if (!b || !r) return null;
    const [x0, y0, z0] = b.mn, [x1, y1, z1] = b.mx, [px, py, pz] = point;
    const fr = (v, a, c) => clamp((v - a) / (c - a), 0, 0.999999);
    let s, t;   // 0..1 across the texture rect, left->right and top->bottom
    if (face === 'front') { s = fr(px, x0, x1); t = fr(y1 - py + y0, y0, y1); }
    else if (face === 'back') { s = fr(x1 - px + x0, x0, x1); t = fr(y1 - py + y0, y0, y1); }
    else if (face === 'right') { s = fr(pz, z0, z1); t = fr(y1 - py + y0, y0, y1); }
    else if (face === 'left') { s = fr(z1 - pz + z0, z0, z1); t = fr(y1 - py + y0, y0, y1); }
    else if (face === 'top') { s = fr(px, x0, x1); t = fr(pz, z0, z1); }
    else { s = fr(px, x0, x1); t = fr(z1 - pz + z0, z0, z1); }
    return { x: r.x + Math.floor(s * r.w), y: r.y + Math.floor(t * r.h), face, part: id };
  }
  /**
   * Pick on the rest-pose model: rays per part are given in model units (the caller transforms the world ray into each
   * part's bone space). parts = [{ id, o, d }]. Returns the nearest { x, y, part, face, t } or null.
   */
  function pick(model, rays) {
    let best = null;
    rays.forEach(({ id, o, d }) => {
      const b = partBox(model, id);
      if (!b) return;
      const hit = rayBox(o, d, b.mn, b.mx);
      if (!hit || (best && hit.t >= best.t)) return;
      const p = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t], face = NORMAL_FACE(hit.n);
      const px = hitPixel(model, id, p, face);
      if (px) best = Object.assign(px, { t: hit.t, point: p });
    });
    return best;
  }

  /* ====================================================================== mirror + symmetry */
  /** left-right body mirror: the twin pixel on the other side of the body (arms <-> arms, legs <-> legs, head / body onto themselves) */
  function mirrorPixel(model, x, y) {
    const r = regionAt(model, x, y);
    if (!r) return null;
    const t = rectOf(model, PART[r.part].pair, FACE_PAIR[r.face]);
    if (!t) return null;
    const fx = clamp(t.w - 1 - Math.round(r.fx * (t.w - 1) / Math.max(1, r.rect.w - 1)), 0, t.w - 1);
    return [t.x + (r.rect.w === t.w ? t.w - 1 - r.fx : fx), t.y + r.fy];
  }
  /** pixels painted together with (x, y): sym = { body, faceX, faceY } (faceX / faceY mirror inside the same face) */
  function symPixels(model, x, y, sym) {
    const out = [[x, y]];
    if (!sym) return out;
    const add = (p) => { if (p && !out.some((q) => q[0] === p[0] && q[1] === p[1])) out.push(p); };
    if (sym.body) add(mirrorPixel(model, x, y));
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const r = regionAt(model, out[i][0], out[i][1]);
      if (!r) continue;
      const R = r.rect;
      if (sym.faceX) add([R.x + R.w - 1 - r.fx, out[i][1]]);
      if (sym.faceY) add([out[i][0], R.y + R.h - 1 - r.fy]);
      if (sym.faceX && sym.faceY) add([R.x + R.w - 1 - r.fx, R.y + R.h - 1 - r.fy]);
    }
    return out;
  }

  /* ====================================================================== documents + layers */
  let layerN = 0;
  const lid = () => 'L' + Date.now().toString(36) + (layerN++).toString(36);
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
  function newLayer(name, buf) { return { id: lid(), name: name || 'Layer', buf: buf || newBuf(), opacity: 1, blend: 'normal', visible: true, locked: false }; }
  function newDoc(model, buf) { return { model: model === 'slim' ? 'slim' : 'classic', active: 0, layers: [newLayer('Skin', buf || newBuf())] }; }
  function addLayer(doc, name, buf, at) {
    const L = newLayer(name || 'Layer ' + (doc.layers.length + 1), buf);
    const i = at == null ? doc.active + 1 : at;
    doc.layers.splice(i, 0, L); doc.active = i;
    return L;
  }
  function removeLayer(doc, i) {
    if (doc.layers.length < 2) return false;
    doc.layers.splice(i, 1);
    doc.active = clamp(doc.active >= i ? doc.active - 1 : doc.active, 0, doc.layers.length - 1);
    return true;
  }
  function moveLayer(doc, i, to) {
    to = clamp(to, 0, doc.layers.length - 1);
    if (i === to) return false;
    const [L] = doc.layers.splice(i, 1); doc.layers.splice(to, 0, L);
    if (doc.active === i) doc.active = to;
    else if (i < doc.active && to >= doc.active) doc.active--;
    else if (i > doc.active && to <= doc.active) doc.active++;
    return true;
  }
  function duplicateLayer(doc, i) { const s = doc.layers[i], L = addLayer(doc, s.name + ' copy', cloneBuf(s.buf), i + 1); L.opacity = s.opacity; L.blend = s.blend; return L; }
  const blendCh = (mode, b, s) => {
    switch (mode) {
      case 'multiply': return b * s / 255;
      case 'screen': return 255 - (255 - b) * (255 - s) / 255;
      case 'overlay': return b < 128 ? 2 * b * s / 255 : 255 - 2 * (255 - b) * (255 - s) / 255;
      case 'darken': return Math.min(b, s);
      case 'lighten': return Math.max(b, s);
      default: return s;
    }
  };
  /** draw layer src onto dst with a blend mode + opacity (only where the result is visible) */
  function blendOnto(dst, src, mode, opacity, rect) {
    const d = dst.data, s = src.data, w = dst.w;
    const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0, x1 = rect ? rect.x1 : dst.w - 1, y1 = rect ? rect.y1 : dst.h - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 4, sa = s[o + 3] * opacity;
      if (sa <= 0) continue;
      if (!mode || mode === 'normal' || d[o + 3] === 0) { over(d, o, s[o], s[o + 1], s[o + 2], sa); continue; }
      over(d, o, blendCh(mode, d[o], s[o]), blendCh(mode, d[o + 1], s[o + 1]), blendCh(mode, d[o + 2], s[o + 2]), sa);
    }
  }
  /** merged image of the visible layers (rect = only that area, into `into`) */
  function composite(doc, into, rect) {
    const out = into || newBuf(doc.layers[0] ? doc.layers[0].buf.w : W, doc.layers[0] ? doc.layers[0].buf.h : H);
    if (rect) { for (let y = rect.y0; y <= rect.y1; y++) out.data.fill(0, (y * out.w + rect.x0) * 4, (y * out.w + rect.x1 + 1) * 4); }
    else out.data.fill(0);
    doc.layers.forEach((L) => { if (L.visible && L.opacity > 0) blendOnto(out, L.buf, L.blend, L.opacity, rect); });
    return out;
  }
  function mergeDown(doc, i) {
    if (i <= 0 || i >= doc.layers.length) return false;
    const top = doc.layers[i], bot = doc.layers[i - 1];
    if (top.visible) blendOnto(bot.buf, top.buf, top.blend, top.opacity);
    doc.layers.splice(i, 1);
    doc.active = i - 1;
    return true;
  }
  function flattenDoc(doc) { const b = composite(doc); doc.layers = [newLayer('Skin', b)]; doc.active = 0; return doc; }
  const snapshot = (doc) => ({ model: doc.model, active: doc.active, layers: doc.layers.map((L) => ({ id: L.id, name: L.name, opacity: L.opacity, blend: L.blend, visible: L.visible, locked: L.locked, buf: cloneBuf(L.buf) })) });
  function restore(doc, snap) {
    doc.model = snap.model; doc.active = snap.active;
    doc.layers = snap.layers.map((L) => Object.assign({}, L, { buf: cloneBuf(L.buf) }));
    return doc;
  }

  /* ====================================================================== brushes + strokes */
  /** footprint of one dab: [[dx, dy, f]] with f = coverage 0..1 (hardness softens the rim) */
  const fpCache = new Map();
  function footprint(size, shape, hardness) {
    size = clamp(Math.round(size || 1), 1, 16); hardness = hardness == null ? 1 : clamp(hardness, 0, 1);
    const key = size + '|' + shape + '|' + hardness.toFixed(2);
    if (fpCache.has(key)) return fpCache.get(key);
    const out = [];
    if (size === 1) out.push([0, 0, 1]);
    else {
      const lo = -Math.floor((size - 1) / 2), hi = lo + size - 1, c = (lo + hi) / 2, r = size / 2;
      for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) {
        const ex = dx - c, ey = dy - c;
        const dist = shape === 'circle' ? Math.hypot(ex, ey) : shape === 'diamond' ? Math.abs(ex) + Math.abs(ey) : Math.max(Math.abs(ex), Math.abs(ey));
        const lim = shape === 'square' ? r : r - (shape === 'diamond' ? 0.25 : 0.2);
        if (dist > lim) continue;
        const inner = lim * hardness, f = dist <= inner ? 1 : clamp(1 - (dist - inner) / Math.max(0.5, lim - inner + 0.5), 0.08, 1);
        out.push([dx, dy, f]);
      }
    }
    fpCache.set(key, out);
    return out;
  }
  const grow = (dr, x, y) => { if (!dr.r) dr.r = { x0: x, y0: y, x1: x, y1: y }; else { const r = dr.r; if (x < r.x0) r.x0 = x; if (y < r.y0) r.y0 = y; if (x > r.x1) r.x1 = x; if (y > r.y1) r.y1 = y; } };
  const unionRect = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)];
  /** deterministic 0..1 noise per pixel */
  const hash01 = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + (s | 0) * 2246822519, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  /**
   * A stroke paints from a snapshot of the buffer taken at its start with a per-pixel coverage map, so overlapping dabs
   * never stack up (opacity 50% stays 50% over the whole stroke) and the result is the same however fast the pointer moved.
   * opts: { tool: 'pencil' | 'eraser' | 'lighten' | 'darken' | 'noise' | 'dither' | 'smudge' | 'blur', color, color2, size, shape,
   *         hardness, opacity, amount, mask, model, sym, seed }
   */
  function beginStroke(buf, opts) {
    const o = Object.assign({ tool: 'pencil', color: [0, 0, 0, 255], color2: [255, 255, 255, 255], size: 1, shape: 'square', hardness: 1, opacity: 1, amount: 0.2, seed: 1 }, opts);
    return { buf, o, base: cloneBuf(buf), cov: new Float32Array(buf.w * buf.h), last: null, dirty: { r: null }, carry: null, fp: footprint(o.size, o.shape, o.hardness) };
  }
  /** write one pixel of the stroke from its coverage */
  function applyPx(st, x, y, f) {
    const b = st.buf, i = y * b.w + x, o = st.o;
    if (o.mask && !o.mask[i]) return;
    const cv = f * o.opacity;
    const kind = o.tool;
    if (kind === 'smudge' || kind === 'blur') return applyAccum(st, x, y, cv);
    if (cv <= st.cov[i]) return;
    st.cov[i] = cv;
    const s = st.base.data, d = b.data, p = i * 4;
    d[p] = s[p]; d[p + 1] = s[p + 1]; d[p + 2] = s[p + 2]; d[p + 3] = s[p + 3];
    if (kind === 'eraser') d[p + 3] = s[p + 3] * (1 - cv);
    else if (kind === 'lighten' || kind === 'darken') {
      if (s[p + 3] === 0) return;
      const [hh, sat, l] = rgb2hsl(s[p], s[p + 1], s[p + 2]);
      const nl = clamp(l + (kind === 'lighten' ? 1 : -1) * o.amount * cv, 0, 1);
      const c = hsl2rgb(hh, sat, nl);
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
    } else if (kind === 'noise') {
      if (s[p + 3] === 0) return;
      const n = (hash01(x, y, o.seed) - 0.5) * 2 * o.amount * 255 * cv;
      d[p] = clamp(s[p] + n, 0, 255); d[p + 1] = clamp(s[p + 1] + n, 0, 255); d[p + 2] = clamp(s[p + 2] + n, 0, 255);
    } else if (kind === 'dither') {
      const c = bayer(x, y) < (o.amount == null ? 0.5 : o.amount) ? o.color2 : o.color;
      over(d, p, c[0], c[1], c[2], c[3] * cv);
    } else over(d, p, o.color[0], o.color[1], o.color[2], o.color[3] * cv);
    grow(st.dirty, x, y);
  }
  /** smudge / blur change the live buffer (accumulating) */
  function applyAccum(st, x, y, cv) {
    const b = st.buf, d = b.data, p = (y * b.w + x) * 4;
    if (st.o.tool === 'blur') {
      let r = 0, g = 0, bl = 0, a = 0, n = 0;
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
        if (!inB(b, xx, yy)) continue;
        if (st.o.model && b.w === W && b.h === H && regionMap(st.o.model)[yy * W + xx] < 0) continue;   // never pull unused pixels in
        const q = (yy * b.w + xx) * 4, qa = st.base.data[q + 3] / 255;
        r += st.base.data[q] * qa; g += st.base.data[q + 1] * qa; bl += st.base.data[q + 2] * qa; a += qa; n++;
      }
      if (!a) return;
      const k = Math.min(1, cv);
      d[p] = d[p] * (1 - k) + (r / a) * k; d[p + 1] = d[p + 1] * (1 - k) + (g / a) * k; d[p + 2] = d[p + 2] * (1 - k) + (bl / a) * k; d[p + 3] = d[p + 3] * (1 - k) + (a / n * 255) * k;
    } else {   // smudge: carry the colour under the brush along the stroke
      const cur = [d[p], d[p + 1], d[p + 2], d[p + 3]];
      if (!st.carry) { st.carry = cur.slice(); return; }
      const k = clamp(st.o.amount == null ? 0.5 : st.o.amount, 0, 1) * cv;
      for (let c = 0; c < 4; c++) d[p + c] = cur[c] * (1 - k) + st.carry[c] * k;
      for (let c = 0; c < 4; c++) st.carry[c] = st.carry[c] * 0.6 + d[p + c] * 0.4;
    }
    grow(st.dirty, x, y);
  }
  /** one dab at (x, y), with every symmetric twin */
  function dab(st, x, y) {
    const b = st.buf, o = st.o;
    for (const [dx, dy, f] of st.fp) {
      const px = x + dx, py = y + dy;
      if (!inB(b, px, py)) continue;
      if (o.sym && o.model && b.w === W && b.h === H) { symPixels(o.model, px, py, o.sym).forEach(([qx, qy]) => applyPx(st, qx, qy, f)); }
      else applyPx(st, px, py, f);
    }
  }
  /** Bresenham points from a to b inclusive */
  function linePts(x0, y0, x1, y1) {
    const pts = [];
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (let n = 0; n < 4096; n++) {
      pts.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }
  /** continue the stroke to (x, y): every pixel between the last point and this one gets a dab (no gaps) */
  function strokeTo(st, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (!st.last) dab(st, x, y);
    else linePts(st.last[0], st.last[1], x, y).forEach(([px, py], i) => { if (i || st.o.tool === 'smudge') dab(st, px, py); });
    st.last = [x, y];
    return st.dirty.r;
  }
  const endStroke = (st) => st.dirty.r;
  /** paint a set of points as one stroke (shapes) */
  function paintPts(buf, pts, opts) {
    const st = beginStroke(buf, opts);
    pts.forEach(([x, y]) => dab(st, x, y));
    return st.dirty.r;
  }
  function drawLine(buf, x0, y0, x1, y1, opts) { return paintPts(buf, linePts(x0, y0, x1, y1), opts); }
  function rectPts(x0, y0, x1, y1, filled) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1), pts = [];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
    return pts;
  }
  function drawRect(buf, x0, y0, x1, y1, opts) { return paintPts(buf, rectPts(x0, y0, x1, y1, opts && opts.filled), opts); }
  /** ellipse inside the box (x0,y0)-(x1,y1): pixel centres inside, outline = inside pixels with an outside 4-neighbour */
  function ellipsePts(x0, y0, x1, y1, filled) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax + 1) / 2, ry = (by - ay + 1) / 2;
    const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0001;
    const pts = [];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
    return pts;
  }
  function drawEllipse(buf, x0, y0, x1, y1, opts) { return paintPts(buf, ellipsePts(x0, y0, x1, y1, opts && opts.filled), opts); }

  /** gradient from (x0, y0) colour c1 to (x1, y1) colour c2. opts: { type: 'linear' | 'radial', steps (0 = smooth), dither, mask } */
  function gradient(buf, x0, y0, x1, y1, opts) {
    const o = Object.assign({ type: 'linear', c1: [0, 0, 0, 255], c2: [255, 255, 255, 255], steps: 0, dither: false, mask: null, opacity: 1 }, opts);
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2), d = buf.data, dr = { r: null };
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const i = y * buf.w + x;
      if (o.mask && !o.mask[i]) continue;
      let t = o.type === 'radial' ? Math.hypot(x - x0, y - y0) / len : ((x - x0) * dx + (y - y0) * dy) / len2;
      t = clamp(t, 0, 1);
      if (o.steps > 1) {
        const f = t * (o.steps - 1), lo = Math.floor(f);
        t = (o.dither ? (f - lo > bayer(x, y) ? lo + 1 : lo) : Math.round(f)) / (o.steps - 1);
      } else if (o.dither) t = clamp(t + (bayer(x, y) - 0.5) / 8, 0, 1);
      const c = [0, 1, 2, 3].map((k) => o.c1[k] + (o.c2[k] - o.c1[k]) * t);
      over(d, i * 4, c[0], c[1], c[2], c[3] * o.opacity);
      grow(dr, x, y);
    }
    return dr.r;
  }

  /* ====================================================================== fill, replace, pick */
  /**
   * Bucket fill at (x, y). opts: { tolerance 0..255, contiguous (default true), limit: 'none' | 'face' | 'part', model, mask,
   *   sample (buffer the colours are compared on, default buf: pass the composite to fill "what you see"), opacity }.
   * Unused pixels are never filled when a model is given.
   */
  function floodSet(buf, x, y, opts) {
    const o = Object.assign({ tolerance: 0, contiguous: true, limit: 'none', model: null, mask: null, sample: null }, opts);
    if (!inB(buf, x, y)) return null;
    const S = o.sample || buf, target = get(S, x, y), w = buf.w, n = w * buf.h;
    const skin = o.model && buf.w === W && buf.h === H;
    let lim = null;
    if (skin) { lim = o.limit === 'face' || o.limit === 'part' ? regionMask(o.model, x, y, o.limit) : null; if (regionMap(o.model)[y * W + x] < 0) return null; }
    const okPx = (i) => (!o.mask || o.mask[i]) && (!lim || lim[i]) && (!skin || regionMap(o.model)[i] >= 0) && colorDist(target, [S.data[i * 4], S.data[i * 4 + 1], S.data[i * 4 + 2], S.data[i * 4 + 3]]) <= o.tolerance;
    const hit = new Uint8Array(n);
    if (o.contiguous) {
      const stack = [y * w + x];
      if (!okPx(stack[0])) return null;
      hit[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop(), px = i % w, py = (i - px) / w;
        [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]].forEach(([qx, qy]) => {
          if (!inB(buf, qx, qy)) return;
          const j = qy * w + qx;
          if (!hit[j] && okPx(j)) { hit[j] = 1; stack.push(j); }
        });
      }
    } else for (let i = 0; i < n; i++) if (okPx(i)) hit[i] = 1;
    return hit;
  }
  function fill(buf, x, y, color, opts) {
    const o = Object.assign({ opacity: 1 }, opts), hit = floodSet(buf, x, y, opts);
    if (!hit) return null;
    const w = buf.w, n = w * buf.h, dr = { r: null };
    const d = buf.data, replace = o.opacity >= 1 && color[3] === 255;
    for (let i = 0; i < n; i++) {
      if (!hit[i]) continue;
      const p = i * 4;
      if (color[3] === 0 && o.opacity >= 1) { d[p] = d[p + 1] = d[p + 2] = d[p + 3] = 0; }
      else if (replace) { d[p] = color[0]; d[p + 1] = color[1]; d[p + 2] = color[2]; d[p + 3] = 255; }
      else over(d, p, color[0], color[1], color[2], color[3] * o.opacity);
      grow(dr, i % w, (i - (i % w)) / w);
    }
    return dr.r;
  }
  /** every pixel within `tolerance` of `from` becomes `to` (keeps each pixel's alpha relation when keepAlpha) */
  function replaceColor(buf, from, to, tolerance, mask) {
    const d = buf.data, dr = { r: null };
    for (let i = 0; i < buf.w * buf.h; i++) {
      if (mask && !mask[i]) continue;
      const p = i * 4;
      if (colorDist(from, [d[p], d[p + 1], d[p + 2], d[p + 3]]) > (tolerance || 0)) continue;
      d[p] = to[0]; d[p + 1] = to[1]; d[p + 2] = to[2]; d[p + 3] = to[3];
      grow(dr, i % buf.w, Math.floor(i / buf.w));
    }
    return dr.r;
  }
  const pickColor = (buf, x, y) => (inB(buf, x, y) ? get(buf, x, y) : null);

  /* ====================================================================== selections */
  const selNew = (w, h) => new Uint8Array((w || W) * (h || H));
  function selRect(w, h, x0, y0, x1, y1) {
    const s = selNew(w, h), ax = clamp(Math.min(x0, x1), 0, w - 1), bx = clamp(Math.max(x0, x1), 0, w - 1), ay = clamp(Math.min(y0, y1), 0, h - 1), by = clamp(Math.max(y0, y1), 0, h - 1);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) s[y * w + x] = 1;
    return s;
  }
  /** lasso: pixel centres inside the polygon (even-odd), plus the pixels the outline passes through */
  function selLasso(w, h, pts) {
    const s = selNew(w, h);
    if (!pts || pts.length < 2) return s;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) s[y * w + x] = 1;
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      linePts(Math.floor(a[0]), Math.floor(a[1]), Math.floor(b[0]), Math.floor(b[1])).forEach(([x, y]) => { if (x >= 0 && y >= 0 && x < w && y < h) s[y * w + x] = 1; });
    }
    return s;
  }
  /** magic wand (contiguous) / select colour (global) */
  function selWand(buf, x, y, opts) {
    const hit = floodSet(buf, x, y, opts);
    return hit || selNew(buf.w, buf.h);
  }
  function selCombine(a, b, op) {
    const s = new Uint8Array(a.length);
    for (let i = 0; i < s.length; i++) s[i] = op === 'add' ? a[i] | b[i] : op === 'sub' ? a[i] & (b[i] ^ 1) : op === 'and' ? a[i] & b[i] : b[i];
    return s;
  }
  const selInvert = (s) => s.map((v) => v ^ 1);
  const selCount = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n += s[i]; return n; };
  function selBounds(s, w) {
    w = w || W;
    let r = null;
    for (let i = 0; i < s.length; i++) if (s[i]) { const x = i % w, y = (i - x) / w; if (!r) r = { x0: x, y0: y, x1: x, y1: y }; else { r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x); r.y1 = Math.max(r.y1, y); } }
    return r;
  }
  /** outline segments of a selection (for drawing marching ants): [[x0, y0, x1, y1]] on pixel edges */
  function selEdges(s, w, h) {
    w = w || W; h = h || H;
    const out = [], at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && s[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!s[y * w + x]) continue;
      if (!at(x, y - 1)) out.push([x, y, x + 1, y]);
      if (!at(x, y + 1)) out.push([x, y + 1, x + 1, y + 1]);
      if (!at(x - 1, y)) out.push([x, y, x, y + 1]);
      if (!at(x + 1, y)) out.push([x + 1, y, x + 1, y + 1]);
    }
    return out;
  }
  /** cut / copy the selected pixels into a floating piece { x, y, w, h, data } (cut clears them) */
  function lift(buf, sel, cut) {
    const r = selBounds(sel, buf.w);
    if (!r) return null;
    const fw = r.x1 - r.x0 + 1, fh = r.y1 - r.y0 + 1, fl = { x: r.x0, y: r.y0, w: fw, h: fh, data: new Uint8ClampedArray(fw * fh * 4) };
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const si = (r.y0 + y) * buf.w + r.x0 + x;
      if (!sel[si]) continue;
      const sp = si * 4, dp = (y * fw + x) * 4;
      for (let c = 0; c < 4; c++) fl.data[dp + c] = buf.data[sp + c];
      if (cut) buf.data[sp] = buf.data[sp + 1] = buf.data[sp + 2] = buf.data[sp + 3] = 0;
    }
    return fl;
  }
  /** flipH | flipV | rotCW | rotCCW of a floating piece (rotation keeps its centre) */
  function flTransform(fl, op) {
    const { w, h, data } = fl, out = new Uint8ClampedArray(data.length);
    const rot = op === 'rotCW' || op === 'rotCCW', nw = rot ? h : w, nh = rot ? w : h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let nx, ny;
      if (op === 'flipH') { nx = w - 1 - x; ny = y; }
      else if (op === 'flipV') { nx = x; ny = h - 1 - y; }
      else if (op === 'rotCW') { nx = h - 1 - y; ny = x; }
      else if (op === 'rotCCW') { nx = y; ny = w - 1 - x; }
      else { nx = x; ny = y; }
      const sp = (y * w + x) * 4, dp = (ny * nw + nx) * 4;
      for (let c = 0; c < 4; c++) out[dp + c] = data[sp + c];
    }
    const cx = fl.x + w / 2, cy = fl.y + h / 2;
    return { x: rot ? Math.round(cx - nw / 2) : fl.x, y: rot ? Math.round(cy - nh / 2) : fl.y, w: nw, h: nh, data: out };
  }
  /** paste a floating piece onto buf at its x, y (transparent pixels of the piece leave the buffer alone) */
  function drop(buf, fl, mask) {
    const dr = { r: null };
    for (let y = 0; y < fl.h; y++) for (let x = 0; x < fl.w; x++) {
      const tx = fl.x + x, ty = fl.y + y;
      if (!inB(buf, tx, ty)) continue;
      const sp = (y * fl.w + x) * 4, ti = ty * buf.w + tx;
      if (!fl.data[sp + 3] || (mask && !mask[ti])) continue;
      over(buf.data, ti * 4, fl.data[sp], fl.data[sp + 1], fl.data[sp + 2], fl.data[sp + 3]);
      grow(dr, tx, ty);
    }
    return dr.r;
  }

  /* ====================================================================== adjustments + palette */
  /** opts: { hue (deg), sat (-1..1), bright (-1..1), contrast (-1..1), posterize (levels, 0 = off), invert, gray } */
  function adjust(buf, opts, mask) {
    const o = Object.assign({ hue: 0, sat: 0, bright: 0, contrast: 0, posterize: 0, invert: false, gray: false }, opts);
    const d = buf.data, dr = { r: null }, cf = (1 + o.contrast) / (1 - Math.min(0.99, o.contrast) * 0.99 + 1e-9);
    for (let i = 0; i < buf.w * buf.h; i++) {
      if (mask && !mask[i]) continue;
      const p = i * 4;
      if (!d[p + 3]) continue;
      let r = d[p], g = d[p + 1], b = d[p + 2];
      if (o.hue || o.sat || o.gray) {
        let [hh, s, l] = rgb2hsl(r, g, b);
        hh += o.hue; s = o.gray ? 0 : clamp(s * (1 + o.sat), 0, 1);
        [r, g, b] = hsl2rgb(hh, s, l);
      }
      if (o.bright) { const k = o.bright * 255; r += k; g += k; b += k; }
      if (o.contrast) { r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; b = (b - 128) * cf + 128; }
      if (o.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
      if (o.posterize > 1) { const q = 255 / (o.posterize - 1); r = Math.round(clamp(r, 0, 255) / q) * q; g = Math.round(clamp(g, 0, 255) / q) * q; b = Math.round(clamp(b, 0, 255) / q) * q; }
      d[p] = clamp(r, 0, 255); d[p + 1] = clamp(g, 0, 255); d[p + 2] = clamp(b, 0, 255);
      grow(dr, i % buf.w, Math.floor(i / buf.w));
    }
    return dr.r;
  }
  /** the skin's own colours: up to n, most used first; near-duplicates (within `merge`) count together */
  function palette(buf, n, merge, model) {
    const counts = new Map(), d = buf.data, map = model ? regionMap(model) : null;
    for (let i = 0; i < buf.w * buf.h; i++) {
      const p = i * 4;
      if (d[p + 3] < 16 || (map && buf.w === W && map[i] < 0)) continue;
      const k = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const all = [...counts].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255, 255], n: c }));
    const out = [], m = merge == null ? 12 : merge;
    for (const e of all) {
      const near = out.find((x) => colorDist(x.c, e.c) <= m);
      if (near) near.n += e.n; else out.push(e);
    }
    return out.sort((a, b) => b.n - a.n).slice(0, n || 16).map((e) => rgba2hex(e.c));
  }

  /* ====================================================================== history (undo / redo) */
  /**
   * Named steps with compressed diffs: a pixel step keeps only the changed pixels of one layer (index + before + after,
   * 10 bytes per pixel); a document step (layers added / removed / reordered, model change) keeps two snapshots.
   * Oldest steps are dropped beyond maxSteps or maxBytes.
   */
  function History(opts) {
    this.max = (opts && opts.maxSteps) || 150;
    this.maxBytes = (opts && opts.maxBytes) || 6e6;
    this.steps = []; this.at = 0; this.bytes = 0; this.seq = 0;
  }
  const u32 = (b) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.w * b.h);
  History.prototype._push = function (step) {
    this.steps.splice(this.at).forEach((s) => { this.bytes -= s.bytes; });
    step.id = ++this.seq;
    this.steps.push(step); this.bytes += step.bytes; this.at = this.steps.length;
    while (this.steps.length > this.max || (this.bytes > this.maxBytes && this.steps.length > 1)) { const s = this.steps.shift(); this.bytes -= s.bytes; this.at--; }
    return step;
  };
  /** pixels of layer `layerId` changed from `before` to its current buffer. Returns the step or null when nothing changed. */
  History.prototype.pixels = function (name, layerId, before, after) {
    const a = u32(before), b = u32(after), idx = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) idx.push(i);
    if (!idx.length) return null;
    const I = Uint16Array.from(idx), B = new Uint32Array(I.length), A = new Uint32Array(I.length);
    for (let k = 0; k < I.length; k++) { B[k] = a[I[k]]; A[k] = b[I[k]]; }
    return this._push({ kind: 'px', name, layer: layerId, idx: I, before: B, after: A, bytes: I.length * 10 + 64, t: Date.now() });
  };
  /** a whole-document change: before / after = snapshot(doc) */
  History.prototype.doc = function (name, before, after) {
    const sz = (s) => s.layers.length * s.layers[0].buf.data.length;
    return this._push({ kind: 'doc', name, before, after, bytes: sz(before) + sz(after) + 64, t: Date.now() });
  };
  History.prototype._apply = function (doc, step, dir) {
    if (step.kind === 'doc') { restore(doc, dir < 0 ? step.before : step.after); return { all: true }; }
    const L = doc.layers.find((x) => x.id === step.layer);
    if (!L) return null;
    const v = u32(L.buf), src = dir < 0 ? step.before : step.after;
    const dr = { r: null };
    for (let k = 0; k < step.idx.length; k++) { const i = step.idx[k]; v[i] = src[k]; grow(dr, i % L.buf.w, Math.floor(i / L.buf.w)); }
    return { layer: L.id, rect: dr.r };
  };
  History.prototype.undo = function (doc) { if (!this.at) return null; const s = this.steps[--this.at]; const r = this._apply(doc, s, -1); return r && Object.assign(r, { name: s.name }); };
  History.prototype.redo = function (doc) { if (this.at >= this.steps.length) return null; const s = this.steps[this.at++]; const r = this._apply(doc, s, 1); return r && Object.assign(r, { name: s.name }); };
  /** jump to the state right after step index i (-1 = before every step) */
  History.prototype.goTo = function (doc, i) { while (this.at - 1 > i && this.at) this.undo(doc); while (this.at - 1 < i && this.at < this.steps.length) this.redo(doc); };
  History.prototype.list = function () { return this.steps.map((s, i) => ({ name: s.name, kind: s.kind, done: i < this.at, t: s.t, id: s.id })); };
  History.prototype.clear = function () { this.steps = []; this.at = 0; this.bytes = 0; };
  Object.defineProperty(History.prototype, 'canUndo', { get() { return this.at > 0; } });
  Object.defineProperty(History.prototype, 'canRedo', { get() { return this.at < this.steps.length; } });

  /* ====================================================================== formats + game rules */
  /** The game's legacy conversion (SkinTextureDownloader.processLegacySkin): 64x32 -> 64x64, left limbs = flipped copies of the right ones. */
  function fromLegacy(src) {
    const out = newBuf(W, H);
    for (let y = 0; y < 32; y++) out.data.set(src.data.subarray(y * src.w * 4, y * src.w * 4 + W * 4), y * W * 4);
    const copyFlip = (x, y, dx, dy, w, hh) => {
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
        const s = ((y + j) * W + x + i) * 4, d = ((y + dy + j) * W + x + dx + w - 1 - i) * 4;
        for (let c = 0; c < 4; c++) out.data[d + c] = out.data[s + c];
      }
    };
    copyFlip(4, 16, 16, 32, 4, 4); copyFlip(8, 16, 16, 32, 4, 4); copyFlip(0, 20, 24, 32, 4, 12); copyFlip(4, 20, 16, 32, 4, 12); copyFlip(8, 20, 8, 32, 4, 12); copyFlip(12, 20, 16, 32, 4, 12);
    copyFlip(44, 16, -8, 32, 4, 4); copyFlip(48, 16, -8, 32, 4, 4); copyFlip(40, 20, 0, 32, 4, 12); copyFlip(44, 20, -8, 32, 4, 12); copyFlip(48, 20, -16, 32, 4, 12); copyFlip(52, 20, -8, 32, 4, 12);
    // "Notch transparency hack": an all-opaque hat area (32,0)-(64,32) on an old skin is not a hat: its alpha is cleared
    let opaque = true;
    for (let y = 0; y < 32 && opaque; y++) for (let x = 32; x < 64; x++) if (out.data[(y * W + x) * 4 + 3] < 128) { opaque = false; break; }
    if (opaque) for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) out.data[(y * W + x) * 4 + 3] = 0;
    noAlpha(out);
    return out;
  }
  /** Base-layer areas the game draws fully opaque (setNoAlpha): head row, body row, left leg + left arm base. */
  const NO_ALPHA = [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]];
  function noAlpha(buf) { NO_ALPHA.forEach(([x0, y0, x1, y1]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.data[(y * W + x) * 4 + 3] = 255; }); return buf; }
  const inNoAlpha = (x, y) => NO_ALPHA.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  /**
   * What the game will show: base-layer pixels opaque (their stored colour; a fully transparent pixel is usually black),
   * mode 'game'. mode 'fill': transparent / see-through base pixels are blended over `fill` first (default black).
   */
  function flattenBase(buf, model, mode, fill) {
    const f = fill || [0, 0, 0, 255], map = regionMap(model || 'classic'), rects = faceRects(model || 'classic'), dr = { r: null };
    for (let i = 0; i < W * H; i++) {
      const k = map[i];
      if (k < 0 || rects[k].layer !== 'base') continue;
      const p = i * 4, a = buf.data[p + 3];
      if (a === 255) continue;
      if (mode === 'fill') { const sa = a / 255; for (let c = 0; c < 3; c++) buf.data[p + c] = buf.data[p + c] * sa + f[c] * (1 - sa); }
      buf.data[p + 3] = 255;
      grow(dr, i % W, Math.floor(i / W));
    }
    return dr.r;
  }
  /** issues worth a warning before export */
  function check(buf, model) {
    const map = regionMap(model), rects = faceRects(model);
    const r = { transparentBase: 0, partialBase: 0, unusedPixels: 0, partialOuter: 0, emptyOuter: true, colours: 0 };
    const cols = new Set();
    for (let i = 0; i < W * H; i++) {
      const a = buf.data[i * 4 + 3], k = map[i];
      if (k < 0) { if (a) r.unusedPixels++; continue; }
      if (a) cols.add(u32(buf)[i]);
      if (rects[k].layer === 'base') { if (a === 0) r.transparentBase++; else if (a < 255) r.partialBase++; }
      else { if (a) r.emptyOuter = false; if (a > 0 && a < 255) r.partialOuter++; }
    }
    r.colours = cols.size;
    return r;
  }
  /** unused pixels cleared (they are never shown; keeps the file small) */
  function clearUnused(buf, model) {
    const map = regionMap(model), dr = { r: null };
    for (let i = 0; i < W * H; i++) if (map[i] < 0 && buf.data[i * 4 + 3]) { buf.data.fill(0, i * 4, i * 4 + 4); grow(dr, i % W, Math.floor(i / W)); }
    return dr.r;
  }
  /** slim arms leave the 4th column of each arm's back face empty (right arm 54-55 / 20-31, left arm 46-47 / 52-63) */
  function detectSlim(buf) {
    if (buf.w !== W || buf.h !== H) return false;
    const empty = (px, y0) => { for (let y = y0; y < y0 + 12; y++) if (buf.data[(y * W + px) * 4 + 3] > 8) return false; return true; };
    return empty(54, 20) && empty(55, 20) && empty(46, 52) && empty(47, 52);
  }

  /** per-face column order: which column is on the outside of the body (0 = first column) for an arm face */
  const outerCol = (part, face, w) => {
    const right = part === 'rarm' || part === 'rsleeve';
    if (face === 'back') return right ? w - 1 : 0;
    return right ? 0 : w - 1;   // front, top, bottom
  };
  /** source columns for a new width: mode 'middle' (drop / double the column next to the middle on the inner side), 'inner', 'outer' */
  function colMap(fromW, toW, outer, mode) {
    // work in "from the outside" order, then flip back
    const fromOut = (i) => (outer === 0 ? i : fromW - 1 - i), toIdx = (i) => (outer === 0 ? i : toW - 1 - i);
    const order = [];
    if (toW < fromW) {   // 4 -> 3: drop one
      const dropAt = mode === 'outer' ? 0 : mode === 'inner' ? fromW - 1 : 2;
      for (let i = 0; i < fromW; i++) if (i !== dropAt) order.push(i);
    } else {             // 3 -> 4: double one
      const dup = mode === 'outer' ? 0 : mode === 'inner' ? fromW - 1 : 1;
      for (let i = 0; i < fromW; i++) { order.push(i); if (i === dup) order.push(i); }
    }
    const map = new Array(toW);
    order.forEach((src, k) => { map[toIdx(k)] = fromOut(src); });
    return map;
  }
  /** Re-fit every arm (base + sleeve) of a buffer from one model to the other. mode: 'middle' | 'inner' | 'outer'. */
  function refitArms(buf, from, to, mode) {
    if (from === to) return cloneBuf(buf);
    const out = cloneBuf(buf), fw = from === 'slim' ? 3 : 4, tw = to === 'slim' ? 3 : 4;
    ['rarm', 'rsleeve', 'larm', 'lsleeve'].forEach((id) => {
      const p = PART[id], [u, v] = p.uv, hh = p.size[1], d = p.size[2];
      const R0 = boxRects(u, v, fw, hh, d), R1 = boxRects(u, v, tw, hh, d);
      for (let y = v; y < v + d + hh; y++) for (let x = u; x < u + 2 * (d + 4); x++) out.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4);
      FACES.forEach((f) => {
        const [sx, sy, sw, sh] = R0[f], [dx, dy, dw] = R1[f];
        const cols = (f === 'right' || f === 'left') ? Array.from({ length: sw }, (_, i) => i) : colMap(sw, dw, outerCol(id, f, sw), mode || 'middle');
        for (let j = 0; j < sh; j++) cols.forEach((c, i) => {
          const s = ((sy + j) * W + sx + c) * 4, t = ((dy + j) * W + dx + i) * 4;
          for (let k = 0; k < 4; k++) out.data[t + k] = buf.data[s + k];
        });
      });
    });
    return out;
  }
  /** clear every face of a part */
  function clearPart(buf, model, part) {
    const dr = { r: null };
    faceRects(model).filter((r) => r.part === part).forEach((r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { buf.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4); grow(dr, x, y); } });
    return dr.r;
  }
  /**
   * Copy one part onto another of the same shape. mirror = true maps every pixel through the body mirror (right arm ->
   * left arm as it would look mirrored: the outer side stays outside); false copies the faces as they are.
   */
  function copyPart(buf, model, from, to, mirror) {
    const src = cloneBuf(buf), dr = { r: null };
    faceRects(model).filter((r) => r.part === from).forEach((r) => {
      const t = rectOf(model, to, mirror ? FACE_PAIR[r.face] : r.face);
      if (!t || t.w !== r.w || t.h !== r.h) return;
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        const s = ((r.y + j) * W + r.x + i) * 4, tx = t.x + (mirror ? r.w - 1 - i : i), ty = t.y + j, o = (ty * W + tx) * 4;
        for (let c = 0; c < 4; c++) buf.data[o + c] = src.data[s + c];
        grow(dr, tx, ty);
      }
    });
    return dr.r;
  }
  /**
   * Generate the outer layer from the base ("puff"): mode 'copy' (whole faces), 'outline' (the rim of every face, a
   * shade darker), 'details' (only pixels that differ from the face's main colour). parts = base part ids (default all).
   * overwrite = false keeps outer pixels that are already painted.
   */
  function puff(buf, model, mode, parts, overwrite) {
    const want = new Set(parts || PARTS.filter((p) => p.layer === 'base').map((p) => p.id)), dr = { r: null };
    faceRects(model).filter((r) => r.layer === 'base' && want.has(r.part)).forEach((r) => {
      const t = rectOf(model, PART[r.part].outer, r.face);
      const cnt = new Map();
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const k = u32(buf)[(r.y + j) * W + r.x + i]; cnt.set(k, (cnt.get(k) || 0) + 1); }
      const main = [...cnt].sort((a, b) => b[1] - a[1])[0][0];
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        const si = (r.y + j) * W + r.x + i, s = si * 4, ti = (t.y + j) * W + t.x + i, o = ti * 4;
        if (!overwrite && buf.data[o + 3]) continue;
        const rim = i === 0 || j === 0 || i === r.w - 1 || j === r.h - 1;
        if (mode === 'outline' && !rim) continue;
        if (mode === 'details' && u32(buf)[si] === main) continue;
        let c = [buf.data[s], buf.data[s + 1], buf.data[s + 2], buf.data[s + 3]];
        if (!c[3]) continue;
        if (mode === 'outline') { const [hh, sa, l] = rgb2hsl(c[0], c[1], c[2]); c = hsl2rgb(hh, sa, l * 0.8).concat(255); }
        for (let k = 0; k < 4; k++) buf.data[o + k] = c[k];
        grow(dr, ti % W, Math.floor(ti / W));
      }
    });
    return dr.r;
  }
  /** scale an image into a rect (nearest neighbour); the reference-image placement and the "stamp onto a face" action */
  function project(src, dst, rect, opacity, mask) {
    const [rx, ry, rw, rh] = rect, dr = { r: null };
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const tx = rx + i, ty = ry + j;
      if (!inB(dst, tx, ty) || (mask && !mask[ty * dst.w + tx])) continue;
      const sx = Math.min(src.w - 1, Math.floor((i + 0.5) * src.w / rw)), sy = Math.min(src.h - 1, Math.floor((j + 0.5) * src.h / rh)), s = (sy * src.w + sx) * 4;
      if (!src.data[s + 3]) continue;
      over(dst.data, (ty * dst.w + tx) * 4, src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3] * (opacity == null ? 1 : opacity));
      grow(dr, tx, ty);
    }
    return dr.r;
  }

  /** What an imported image is. { ok, kind: 'skin' | 'legacy' | 'hd' | 'hd-legacy' | 'cape' | 'bad', scale, notes[], error } */
  function validate(img) {
    const { w, h, data } = img, notes = [];
    if (!w || !h) return { ok: false, kind: 'bad', error: 'That image is empty.' };
    let kind = null, scale = 1;
    if (w % 64 === 0 && h === w) { scale = w / 64; kind = scale === 1 ? 'skin' : 'hd'; }
    else if (w % 64 === 0 && h * 2 === w) { scale = w / 64; kind = scale === 1 ? 'legacy' : 'hd-legacy'; }
    else if ((w === 22 && h === 17) || (w === 46 && h === 22)) kind = 'cape';
    else return { ok: false, kind: 'bad', error: 'A skin is 64 × 64 pixels (or the old 64 × 32). This image is ' + w + ' × ' + h + '.' };
    let any = false; const cols = new Set();
    for (let i = 0; i < w * h; i++) { const a = data[i * 4 + 3]; if (a) { any = true; if (cols.size < 5000) cols.add((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]); } }
    if (!any) return { ok: false, kind: 'bad', error: 'That image is fully transparent.' };
    if (kind === 'hd' || kind === 'hd-legacy') notes.push('HD skin (' + w + ' × ' + h + '): Java Edition only takes 64 × 64, so it will be scaled down ' + scale + '×.');
    if (kind === 'legacy' || kind === 'hd-legacy') notes.push('Old 64 × 32 skin: converted like the game does (the left arm and leg become mirrored copies of the right ones).');
    if (cols.size > 1500 * scale * scale && kind !== 'cape') notes.push('This looks like a photo, not a skin. It will load, but the parts may not line up.');
    return { ok: true, kind, scale, notes, colours: cols.size };
  }
  /** scale an HD image down by an integer factor: the most common colour of every block (keeps pixel art crisp) */
  function downscale(img, f) {
    const w = Math.floor(img.w / f), h = Math.floor(img.h / f), out = newBuf(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cnt = new Map();
      let best = null, bn = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
        const s = ((y * f + j) * img.w + x * f + i) * 4, k = img.data[s + 3] < 8 ? -1 : ((img.data[s] << 24) | (img.data[s + 1] << 16) | (img.data[s + 2] << 8) | img.data[s + 3]) >>> 0;
        const n = (cnt.get(k) || 0) + 1; cnt.set(k, n);
        if (n > bn) { bn = n; best = s; }
      }
      const o = (y * w + x) * 4;
      if (img.data[best + 3] >= 8) for (let c = 0; c < 4; c++) out.data[o + c] = img.data[best + c];
    }
    return out;
  }
  /** any accepted image -> { buf (64x64), model, notes } */
  function importImage(img, opts) {
    const v = validate(img);
    if (!v.ok) throw new Error(v.error);
    if (v.kind === 'cape') throw new Error('That is a cape texture: open it in the Cape panel.');
    let b = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
    if (v.scale > 1) b = downscale(b, v.scale);
    const legacy = v.kind === 'legacy' || v.kind === 'hd-legacy';
    if (legacy) b = fromLegacy(b);
    const model = opts && opts.model ? opts.model : legacy ? 'classic' : detectSlim(b) ? 'slim' : 'classic';
    return { buf: b, model, notes: v.notes, kind: v.kind };
  }

  /* ====================================================================== PNG (pure encoder, for node + a canvas-free fallback) */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b, s, e) => { let c = 0xffffffff; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  /** RGBA buffer -> PNG bytes (zlib "stored" blocks: no compression, always valid) */
  function encodePNG(buf) {
    const raw = new Uint8Array((buf.w * 4 + 1) * buf.h);
    for (let y = 0; y < buf.h; y++) { raw[y * (buf.w * 4 + 1)] = 0; raw.set(buf.data.subarray(y * buf.w * 4, (y + 1) * buf.w * 4), y * (buf.w * 4 + 1) + 1); }
    const blocks = Math.ceil(raw.length / 65535) || 1, z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    z[0] = 0x78; z[1] = 0x01;
    let o = 2;
    for (let b = 0; b < blocks; b++) {
      const s = b * 65535, n = Math.min(65535, raw.length - s);
      z[o++] = b === blocks - 1 ? 1 : 0; z[o++] = n & 255; z[o++] = n >> 8; z[o++] = ~n & 255; z[o++] = (~n >> 8) & 255;
      z.set(raw.subarray(s, s + n), o); o += n;
    }
    let a = 1, bb = 0;
    for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; bb = (bb + a) % 65521; }
    const ad = ((bb << 16) | a) >>> 0;
    z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
    const chunk = (type, data) => {
      const c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer);
      dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
      c.set(data, 8); dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
      return c;
    };
    const ih = new Uint8Array(13), dv = new DataView(ih.buffer);
    dv.setUint32(0, buf.w); dv.setUint32(4, buf.h); ih[8] = 8; ih[9] = 6;
    const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let k = 0; parts.forEach((p) => { out.set(p, k); k += p.length; });
    return out;
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function bytesToB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 3) {
      const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function b64ToBytes(s) {
    s = s.replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor(s.length * 3 / 4));
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63);
      if (o < out.length) out[o++] = (n >> 16) & 255; if (o < out.length) out[o++] = (n >> 8) & 255; if (o < out.length) out[o++] = n & 255;
    }
    return out;
  }
  const pngDataURL = (buf) => 'data:image/png;base64,' + bytesToB64(encodePNG(buf));
  /** raw RGBA <-> base64 (a canvas-free way to keep a layer) */
  const bufToB64 = (buf) => buf.w + 'x' + buf.h + ':' + bytesToB64(new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.length));
  function b64ToBuf(s) {
    const m = /^(\d+)x(\d+):(.*)$/.exec(s || '');
    if (!m) return null;
    const b = newBuf(+m[1], +m[2]), bytes = b64ToBytes(m[3]);
    if (bytes.length !== b.data.length) return null;
    b.data.set(bytes);
    return b;
  }

  return {
    W, H, clamp, newBuf, cloneBuf, copyInto, get, set, inB, hex2rgba, rgba2hex, colorDist, sameColor, rgb2hsv, hsv2rgb, rgb2hsl, hsl2rgb, over,
    PARTS, PART, FACES, FACE_PAIR, partSize, boxRects, faceRects, regionMap, regionAt, rectOf, regionMask, partsMask, CAPE_PARTS, capeRects,
    rayBox, partBox, hitPixel, pick, mirrorPixel, symPixels,
    BLENDS, newLayer, newDoc, addLayer, removeLayer, moveLayer, duplicateLayer, blendOnto, composite, mergeDown, flattenDoc, snapshot, restore,
    footprint, beginStroke, strokeTo, endStroke, linePts, drawLine, rectPts, drawRect, ellipsePts, drawEllipse, gradient, unionRect, bayer,
    floodSet, fill, replaceColor, pickColor, selNew, selRect, selLasso, selWand, selCombine, selInvert, selCount, selBounds, selEdges, lift, flTransform, drop,
    adjust, palette, History,
    fromLegacy, noAlpha, inNoAlpha, flattenBase, check, clearUnused, detectSlim, refitArms, clearPart, copyPart, puff, project, validate, downscale, importImage,
    encodePNG, crc32, bytesToB64, b64ToBytes, pngDataURL, bufToB64, b64ToBuf,
  };
})();
