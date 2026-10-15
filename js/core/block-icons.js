window.TH = window.TH || {};

/**
 * Inventory-style block icons, drawn from the game's own item models (js/data/block-db.js, tools/build-block-db.js).
 *
 *   TH.icon.block('minecraft:polished_tuff_wall', { size: 32, fallback: 'block/polished_tuff', title, cls })
 *     -> a .mc span (same box as TH.icon) whose <img> fills in when the textures are ready (no layout shift).
 *   TH.icon.block.has(id)    true when the database knows the block (else the caller should use its flat icon)
 *   TH.icon.block.entry(id)  the raw database entry or null
 *
 * How it draws: every element (box) of the inventory model is projected with the model's own "gui" display transform
 * (rotation [30, 225, 0] for cubes, [30, 135, 0] for stairs / walls / fences, scale 0.625 ...), the same maths the game
 * uses, and rasterised pixel by pixel in a small software renderer (z-buffer, nearest texel, alpha test, translucent
 * blend). Faces are shaded like the inventory: up 100 %, faces turned left 80 %, right 60 %, down 50 %. Tinted faces
 * (grass, leaves) multiply the item's fixed tint. Items whose model is a flat sprite (doors, torches, saplings, panes)
 * use the flat texture; special items (chests, beds, banners, heads) and unknown ids fall back to opts.fallback.
 * Rendered at 2x the device size and scaled down; results are cached per id + pixel size, textures once each.
 */
TH.icon.block = (function () {
  'use strict';
  const DB = () => (TH.data && TH.data.blockDb) || null;
  const bare = (id) => { const s = String(id || ''); const b = s.indexOf('['); const n = b >= 0 ? s.slice(0, b) : s; const c = n.indexOf(':'); return (c >= 0 ? n.slice(c + 1) : n).toLowerCase(); };
  const key = (t) => (t.includes('/') ? t : 'block/' + t);
  function entry(id) { const d = DB(); return (d && d.b[bare(id)]) || null; }
  /** Can this id be drawn as a model (not special, has an icon)? */
  function drawable(e) { return !!(e && e[4] && !((e[2] || 0) & 32)); }

  /* ---- textures: pixels of the first frame, loaded once ---- */
  const texCache = new Map();
  function texture(k) {
    let p = texCache.get(k);
    if (p) return p;
    p = new Promise((res, rej) => {
      const img = new Image();
      const url = TH.icon.src(k);
      if (url && !url.startsWith('data:') && !url.startsWith('assets/')) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        try {
          const w = img.naturalWidth, hgt = Math.min(img.naturalHeight, w);   // animated strips: frame 1
          const c = document.createElement('canvas');
          c.width = w; c.height = hgt;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0);
          res({ w, h: hgt, d: x.getImageData(0, 0, w, hgt).data });
        } catch (e) { rej(e); }   // tainted canvas (index.html opened as a file): flat fallback
      };
      img.onerror = () => {
        // local copy missing -> the CDN once
        const r = TH.icon.remote(k);
        if (img.src !== r && !img.dataset.retry) { img.dataset.retry = '1'; img.crossOrigin = 'anonymous'; img.src = r; return; }
        rej(new Error('texture ' + k));
      };
      img.src = url;
    });
    texCache.set(k, p);
    p.catch(() => {});
    return p;
  }

  /* ---- maths ---- */
  const RAD = Math.PI / 180;
  function rotXYZ(v, rx, ry, rz) {
    // JOML rotationXYZ: v' = Rx * Ry * Rz * v
    let [x, y, z] = v, c, s, t;
    if (rz) { c = Math.cos(rz); s = Math.sin(rz); t = x * c - y * s; y = x * s + y * c; x = t; }
    if (ry) { c = Math.cos(ry); s = Math.sin(ry); t = x * c + z * s; z = -x * s + z * c; x = t; }
    if (rx) { c = Math.cos(rx); s = Math.sin(rx); t = y * c - z * s; z = y * s + z * c; y = t; }
    return [x, y, z];
  }
  function rotAxis(p, r) {
    // element rotation: [origin, axis, angle]
    const [o, ax, ang] = r, a = ang * RAD, c = Math.cos(a), s = Math.sin(a);
    let x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2], t;
    if (ax === 'x') { t = y * c - z * s; z = y * s + z * c; y = t; }
    else if (ax === 'y') { t = x * c + z * s; z = -x * s + z * c; x = t; }
    else { t = x * c - y * s; y = x * s + y * c; x = t; }
    return [x + o[0], y + o[1], z + o[2]];
  }
  const NORMAL = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
  /** Face corners TL, TR, BL in model units (texture top-left / u / v directions as the game maps them). */
  function corners(dir, a, b) {
    const [x1, y1, z1] = a, [x2, y2, z2] = b;
    switch (dir) {
      case 'north': return [[x2, y2, z1], [x1, y2, z1], [x2, y1, z1]];
      case 'south': return [[x1, y2, z2], [x2, y2, z2], [x1, y1, z2]];
      case 'west': return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z1]];
      case 'east': return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z2]];
      case 'up': return [[x1, y2, z1], [x2, y2, z1], [x1, y2, z2]];
      default: return [[x1, y1, z2], [x2, y1, z2], [x1, y1, z1]];
    }
  }
  function defaultUV(dir, a, b) {
    const [x1, y1, z1] = a, [x2, y2, z2] = b;
    switch (dir) {
      case 'down': return [x1, 16 - z2, x2, 16 - z1];
      case 'up': return [x1, z1, x2, z2];
      case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
      case 'south': return [x1, 16 - y2, x2, 16 - y1];
      case 'west': return [z1, 16 - y2, z2, 16 - y1];
      default: return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    }
  }
  const hexRGB = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  /** Draw one model (entry icon [tpl, gui, texmap]) into an R x R canvas. */
  function drawModel(e, R, tex) {
    const D = DB(), [tplI, guiI, tm] = e[4], els = D.tpl[tplI], g = D.gui[guiI] || [30, 225, 0, 0, 0, 0, 0.625, 0.625, 0.625];
    const tint = e[3] ? hexRGB(e[3]) : null;
    const rx = g[0] * RAD, ry = g[1] * RAD, rz = g[2] * RAD;
    const toScreen = (p) => {
      // model units -> centred block units, gui transform (scale, rotate, translate), then pixels (y up -> down)
      const v = rotXYZ([(p[0] - 8) / 16 * g[6], (p[1] - 8) / 16 * g[7], (p[2] - 8) / 16 * g[8]], rx, ry, rz);
      return [R / 2 + (v[0] + g[3] / 16) * R, R / 2 - (v[1] + g[4] / 16) * R, v[2] + g[5] / 16];
    };
    const faces = [];
    els.forEach((el) => {
      const [from, to, fs, rot, noShade] = el;
      Object.keys(fs).forEach((dir) => {
        const [tv, uv0, frot, ti] = fs[dir];
        const tk = typeof tm === 'string' ? tm : tm[tv];
        const t = tk && tex.get(key(tk));
        if (!t) return;
        let c = corners(dir, from, to);
        let n = NORMAL[dir];
        if (rot) { c = c.map((p) => rotAxis(p, rot)); n = rotAxis(n, [[0, 0, 0], rot[1], rot[2]]); }
        const nn = rotXYZ(n, rx, ry, rz);
        const shade = noShade ? 1 : nn[1] > 0.5 ? 1 : nn[1] < -0.5 ? 0.5 : nn[0] < 0 ? 0.8 : 0.6;
        const uv = uv0 || defaultUV(dir, from, to);
        const uvc = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
        const k = ((frot || 0) / 90) & 3;
        const tl = uvc[(0 - k + 4) % 4], tr = uvc[(1 - k + 4) % 4], bl = uvc[(3 - k + 4) % 4];
        const P = c.map(toScreen);
        faces.push({ P, tl, tr, bl, t, shade, tint: ti >= 0 && tint ? tint : null, z: (P[1][2] + P[2][2]) / 2 });
      });
    });
    faces.sort((a, b) => a.z - b.z);
    const img = new Uint8ClampedArray(R * R * 4), zb = new Float32Array(R * R).fill(-1e9);
    faces.forEach((f) => {
      const [p0, p1, p3] = f.P;
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p3[0] - p0[0], by = p3[1] - p0[1];
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-6) return;
      const p2 = [p1[0] + bx, p1[1] + by];
      const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p3[0], p2[0]))), maxX = Math.min(R - 1, Math.ceil(Math.max(p0[0], p1[0], p3[0], p2[0])));
      const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p3[1], p2[1]))), maxY = Math.min(R - 1, Math.ceil(Math.max(p0[1], p1[1], p3[1], p2[1])));
      const dz1 = p1[2] - p0[2], dz3 = p3[2] - p0[2];
      const { w, h: th, d } = f.t;
      const du1 = f.tr[0] - f.tl[0], dv1 = f.tr[1] - f.tl[1], du3 = f.bl[0] - f.tl[0], dv3 = f.bl[1] - f.tl[1];
      const sh = f.shade, tn = f.tint;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const qx = x + 0.5 - p0[0], qy = y + 0.5 - p0[1];
          const s = (qx * by - qy * bx) / det, t = (ax * qy - ay * qx) / det;
          if (s < -1e-4 || s > 1.0001 || t < -1e-4 || t > 1.0001) continue;
          const z = p0[2] + s * dz1 + t * dz3, i = y * R + x;
          if (z < zb[i] - 1e-4) continue;
          const u = f.tl[0] + s * du1 + t * du3, v = f.tl[1] + s * dv1 + t * dv3;
          const tx = Math.min(w - 1, Math.max(0, Math.floor(u / 16 * w))), ty = Math.min(th - 1, Math.max(0, Math.floor(v / 16 * th)));
          const o = (ty * w + tx) * 4, a = d[o + 3];
          if (a < 8) continue;
          let r = d[o] * sh, gg = d[o + 1] * sh, b = d[o + 2] * sh;
          if (tn) { r = r * tn[0] / 255; gg = gg * tn[1] / 255; b = b * tn[2] / 255; }
          const j = i * 4;
          if (a >= 250) { img[j] = r; img[j + 1] = gg; img[j + 2] = b; img[j + 3] = 255; zb[i] = z; }
          else {
            const al = a / 255, da = img[j + 3] / 255, oa = al + da * (1 - al);
            img[j] = (r * al + img[j] * da * (1 - al)) / oa; img[j + 1] = (gg * al + img[j + 1] * da * (1 - al)) / oa; img[j + 2] = (b * al + img[j + 2] * da * (1 - al)) / oa;
            img[j + 3] = oa * 255;
          }
        }
      }
    });
    return new ImageData(img, R, R);
  }
  /** A flat sprite with a tint (short grass, vines, lily pad). */
  function drawSprite(t, R, tint) {
    const img = new Uint8ClampedArray(R * R * 4), tn = hexRGB(tint);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const o = ((Math.floor(y / R * t.h)) * t.w + Math.floor(x / R * t.w)) * 4, j = (y * R + x) * 4;
      img[j] = t.d[o] * tn[0] / 255; img[j + 1] = t.d[o + 1] * tn[1] / 255; img[j + 2] = t.d[o + 2] * tn[2] / 255; img[j + 3] = t.d[o + 3];
    }
    return new ImageData(img, R, R);
  }
  function texKeys(e) {
    const ic = e[4];
    if (ic.length === 1) return [key(ic[0])];
    return [...new Set((typeof ic[2] === 'string' ? [ic[2]] : Object.values(ic[2])).map(key))];
  }

  const urlCache = new Map();
  /** Promise of an image URL for this block at R pixels (null = cannot draw). */
  function render(name, R) {
    const k = name + '|' + R;
    let p = urlCache.get(k);
    if (p) return p;
    const e = entry(name);
    p = Promise.all(texKeys(e).map((t) => texture(t).then((v) => [t, v]))).then((list) => {
      const tex = new Map(list), c = document.createElement('canvas');
      c.width = c.height = R;
      const data = e[4].length === 1 ? drawSprite(list[0][1], R, e[3]) : drawModel(e, R, tex);
      c.getContext('2d').putImageData(data, 0, 0);
      return c.toDataURL('image/png');
    }).catch(() => null);
    urlCache.set(k, p);
    return p;
  }

  function block(id, opts) {
    opts = opts || {};
    const size = opts.size || 16, e = entry(id), name = bare(id);
    const flatKey = opts.fallback || (e && e[4] && e[4].length === 1 ? key(e[4][0]) : null);
    // flat sprites without a tint and anything the database cannot draw: the plain texture icon
    if (!drawable(e) || (e[4].length === 1 && !e[3])) {
      if (flatKey) return TH.icon(flatKey, opts);
      const ph = document.createElement('span');
      ph.className = 'mc mc-missing' + (opts.cls ? ' ' + opts.cls : '');
      ph.style.setProperty('--mc', size + 'px');
      ph.setAttribute('aria-hidden', 'true');
      return ph;
    }
    const wrap = document.createElement('span');
    wrap.className = 'mc mc-iso' + (opts.cls ? ' ' + opts.cls : '');
    wrap.style.setProperty('--mc', size + 'px');
    wrap.setAttribute('aria-hidden', 'true');
    if (opts.title) wrap.title = opts.title;
    const img = document.createElement('img');
    img.alt = ''; img.draggable = false; img.decoding = 'async';
    wrap.appendChild(img);
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const R = Math.max(16, Math.round(size * dpr) * 2);
    render(name, R).then((url) => {
      if (url) { img.src = url; return; }
      if (flatKey || e[1]) { const f = TH.icon(flatKey || key([].concat(e[1])[1] || [].concat(e[1])[0]), opts); wrap.replaceWith(f); }
    });
    return wrap;
  }
  block.has = (id) => drawable(entry(id));
  block.entry = entry;
  block.render = render;
  return block;
})();
