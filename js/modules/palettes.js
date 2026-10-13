/**
 * Palettes (rose accent): block palettes for builders.
 *   Browse = 140 hand-made palettes (js/data/palettes.js) with tag filters, search, favourites and your own.
 *   Make   = build a palette block by block; suggestions come from the real texture colours (similar shades,
 *            contrast, lighter / darker, neutrals), plus "Surprise me" and "More like this", which generate endless new ones.
 *   Preview (always on the right) = a mosaic painted with the palette in four patterns (mix, gradient, noise, stripes),
 *            the block list with a usage share, favourite / copy / save.
 *
 * Colours: every block texture is drawn once on a small canvas and averaged (sRGB -> Lab), so matching is done on what
 * the blocks really look like. That runs after the first paint; until it finishes the suggestion rows say so.
 *
 * state.palettes = { tab: 'browse'|'make', sel: 'c12'|'m_x'|'draft'|'gen', mode, seed, tag, q, fav: [id], mine: [{ id, name, blocks }],
 *                    draft: [block], gen: { name, blocks } | null }
 * Blocks are plain names ('stone_bricks'); the universe is the building blocks of TH.builds.core plus soul sand and magma.
 */
(function () {
  'use strict';
  const { h, toast, clamp } = TH.util;
  const core = () => TH.builds.core;
  const S = () => TH.store.get().palettes;
  const save = () => TH.store.update(() => {}, { silent: true });
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  const MAXB = 8;
  const WEIGHT = [5, 3, 2, 1.4, 1, 0.8, 0.6, 0.5];
  const TAG_ORDER = ['warm', 'cool', 'dark', 'light', 'colourful', 'neutral', 'natural', 'stone', 'wood', 'medieval', 'gothic', 'japanese', 'desert', 'nether', 'end', 'ocean', 'winter', 'modern', 'rustic', 'fantasy'];

  /* ---------------- block universe + names ---------------- */
  let universe = null;
  function blocks() {
    if (universe) return universe;
    const C = core();
    const extra = ['soul_sand', 'magma_block'].filter((n) => C.BLOCKS[n]);
    universe = C.buildingBlocks().filter((n) => !C.BLOCKS[n].tint).concat(extra);
    return universe;
  }
  const isBlock = (n) => blocks().includes(n);
  const nameOf = (n) => core().nameOf('minecraft:' + n);
  const texOf = (n) => TH.icon.tex(core().BLOCKS[n].s);
  const groupOf = (n) => core().BLOCKS[n].grp;

  /* ---------------- colours (average texture colour, Lab) ---------------- */
  const col = new Map();
  let colReady = false, colP = null;
  const colWaiters = new Set();
  function toLab(r, g, b) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const fx = t(X), fy = t(Y), fz = t(Z);
    const L = 116 * fy - 16, a = 500 * (fx - fy), bb = 200 * (fy - fz);
    return { L, a, b: bb, C: Math.hypot(a, bb), H: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
  }
  function loadColours() {
    if (colP) return colP;
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const one = (n) => new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const w = Math.min(im.naturalWidth, im.naturalHeight) || 16;
          cx.clearRect(0, 0, 16, 16); cx.drawImage(im, 0, 0, w, w, 0, 0, 16, 16);
          const d = cx.getImageData(0, 0, 16, 16).data;
          let r = 0, g = 0, b = 0, k = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
          if (k) { r /= k; g /= k; b /= k; col.set(n, Object.assign({ rgb: [r, g, b] }, toLab(r, g, b))); }
        } catch (e) { /* unreadable texture: no colour, never suggested */ }
        res();
      };
      im.onerror = () => res();
      im.src = texOf(n);
    });
    colP = (async () => {
      const list = blocks().slice();
      for (let i = 0; i < list.length; i += 24) await Promise.all(list.slice(i, i + 24).map(one));
      colReady = true;
      colWaiters.forEach((f) => f());
    })();
    return colP;
  }
    const dist = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
  const mean = (names) => {
    const cs = names.map((n) => col.get(n)).filter(Boolean);
    if (!cs.length) return null;
    const k = cs.length, L = cs.reduce((s, c) => s + c.L, 0) / k, a = cs.reduce((s, c) => s + c.a, 0) / k, b = cs.reduce((s, c) => s + c.b, 0) / k;
    return { L, a, b, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
  };
  const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const rgbCss = (c, al) => `rgb(${Math.round(c.rgb[0])} ${Math.round(c.rgb[1])} ${Math.round(c.rgb[2])}${al != null ? ' / ' + al : ''})`;

  /* ---------------- suggestions + generators ---------------- */
  const pool = (skip) => blocks().filter((n) => col.has(n) && !skip.includes(n));
  const sortBy = (list, fn) => list.map((n) => [n, fn(col.get(n))]).sort((x, y) => x[1] - y[1]).map((x) => x[0]);
  function suggestions(D) {
    const m = mean(D);
    if (!m) return [];
    const P = pool(D);
    const chromatic = m.C > 14;
    const comp = (m.H + 180) % 360;
    return [
      ['Similar shades', 'Close to what you have', sortBy(P, (c) => dist(c, m)).slice(0, 12)],
      ['Contrast', chromatic ? 'The opposite side of the colour wheel' : 'A coloured accent against your neutrals',
        (chromatic ? sortBy(P.filter((n) => col.get(n).C > 18), (c) => hueDiff(c.H, comp) * 1.4 + Math.abs(c.L - m.L) * 0.5)
          : sortBy(P.filter((n) => col.get(n).C > 28), (c) => -c.C + Math.abs(c.L - m.L) * 0.4)).slice(0, 12)],
      ['Lighter', 'Same colour family, brighter', sortBy(P.filter((n) => col.get(n).L > m.L + 6), (c) => hueDiff(c.H, m.H) * (chromatic ? 1.2 : 0.2) + (c.L - m.L) * 0.7 + Math.abs(c.C - m.C)).slice(0, 12)],
      ['Darker', 'Same colour family, deeper', sortBy(P.filter((n) => col.get(n).L < m.L - 6), (c) => hueDiff(c.H, m.H) * (chromatic ? 1.2 : 0.2) + (m.L - c.L) * 0.7 + Math.abs(c.C - m.C)).slice(0, 12)],
      ['Neutrals', 'Quiet blocks to calm the palette down', sortBy(P.filter((n) => col.get(n).C < 12), (c) => Math.abs(c.L - m.L)).slice(0, 12)],
    ].filter((r) => r[2].length);
  }
  const rnd = () => Math.random();
  const pickFrom = (list, k) => { const a = list.slice(), out = []; while (out.length < k && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  /** A fresh palette around `anchor`. Kinds: analogous, gradient, contrast, accent. Returns { name, blocks }. */
  function generate(anchor, kind) {
    const a = col.get(anchor);
    if (!a) return { name: 'Surprise', blocks: [anchor] };
    const P = pool([anchor]);
    const n = 5 + (rnd() < 0.4 ? 1 : 0);
    const near = (tol) => P.filter((b) => { const c = col.get(b); return a.C < 14 ? c.C < 16 : (c.C > 8 && hueDiff(c.H, a.H) < tol); });
    let out = [anchor], name = 'Surprise';
    if (kind === 'gradient') {
      const g = sortBy(near(32), (c) => c.L);
      const k = Math.min(n - 1, g.length);
      for (let i = 0; i < k; i++) out.push(g[Math.round(i * (g.length - 1) / Math.max(1, k - 1))]);
      out = [...new Set(out)];
      name = 'Gradient';
    } else if (kind === 'contrast') {
      const comp = (a.H + 180) % 360;
      const opp = sortBy(P.filter((b) => col.get(b).C > 18), (c) => hueDiff(c.H, comp) + Math.abs(c.L - a.L) * 0.3).slice(0, 10);
      out.push(...pickFrom(sortBy(near(40), (c) => dist(c, a)).slice(0, 12), 2), ...pickFrom(opp, 2));
      name = 'Contrast';
    } else if (kind === 'accent') {
      const neut = sortBy(P.filter((b) => col.get(b).C < 12), (c) => Math.abs(c.L - a.L)).slice(0, 14);
      const acc = P.filter((b) => col.get(b).C > 30);
      out.push(...pickFrom(neut, 3), ...pickFrom(acc, 1));
      name = 'Accent';
    } else {
      out.push(...pickFrom(sortBy(near(46), (c) => dist(c, a)).slice(0, 16), n - 1));
      name = 'Analogous';
    }
    out = [...new Set(out)];
    if (out.length < 4) out.push(...pickFrom(sortBy(P.filter((b) => !out.includes(b)), (c) => dist(c, a)).slice(0, 10), 4 - out.length));
    return { name: name + ' · ' + nameOf(anchor), blocks: out.slice(0, MAXB) };
  }
  const KINDS = ['analogous', 'gradient', 'contrast', 'accent'];
  function surprise(anchor) {
    const list = blocks().filter((n) => col.has(n));
    return generate(anchor || list[Math.floor(rnd() * list.length)], KINDS[Math.floor(rnd() * KINDS.length)]);
  }

  /* ---------------- current palette ---------------- */
  function all() { return (TH.data.palettes || []).map((p) => ({ id: p.id, name: p.name, tags: p.tags, blocks: p.blocks.filter(isBlock) })).filter((p) => p.blocks.length >= 3); }
  let ALL = null;
  const curated = () => ALL || (ALL = all());
  function current() {
    const st = S();
    if (st.sel === 'draft') return { id: 'draft', name: 'Your palette', blocks: st.draft, tags: [] };
    if (st.sel === 'gen' && st.gen) return { id: 'gen', name: st.gen.name, blocks: st.gen.blocks, tags: [] };
    return curated().find((p) => p.id === st.sel) || st.mine.find((p) => p.id === st.sel) || curated()[0];
  }

  /* ---------------- icons ---------------- */
  const GLYPH = {
    heart: 'M2 3h4v1h1v1h2V4h1V3h4v1h1v4h-1v1h-1v1h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4V9H3V8H2z',
    plus: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
    x: 'M3 2l5 5 5-5 1 1-5 5 5 5-1 1-5-5-5 5-1-1 5-5-5-5z',
    copy: 'M5 1h9v1h1v10h-1v1H5v-1H4V2h1zM6 3v8h7V3zM1 4h2v2H2v7h1v1h7v-1h2v2h-1v1H2v-1H1z',
    save: 'M2 1h10l3 3v10l-1 1H2l-1-1V2zM4 3v3h7V3zM4 9v4h8V9z',
    dice: 'M2 2h12v12H2zM4 4v2h2V4zM10 4v2h2V4zM7 7v2h2V7zM4 10v2h2v-2zM10 10v2h2v-2z',
    left: 'M10 2l1 1-5 5 5 5-1 1-6-6z',
    right: 'M6 2l6 6-6 6-1-1 5-5-5-5z',
    wand: 'M11 1h2v2h2v2h-2v2h-2V5H9V3h2zM2 13l7-7 2 2-7 7H2z',
    edit: 'M11 1h2l2 2v2l-1 1-3-3zM9 4l3 3-7 7H2v-3z',
  };
  const glyph = (k) => {
    const s = h('span.pl-ico', { 'aria-hidden': 'true' });
    s.style.setProperty('--m', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><path d='${GLYPH[k]}'/></svg>`)}")`);
    return s;
  };

  /* ---------------- mosaic ---------------- */
  const imgs = new Map();
  function loadImg(n) {
    if (imgs.has(n)) return imgs.get(n);
    const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = texOf(n); });
    imgs.set(n, p);
    return p;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const CW = 32, CH = 18, CP = 16;
  /** Which block index goes into each of the CW x CH cells. */
  function layout(names, mode, seed) {
    const r = rng(seed), n = names.length, out = new Array(CW * CH);
    const w = names.map((_, i) => WEIGHT[i] || 0.4), tot = w.reduce((a, b) => a + b, 0);
    const wpick = () => { let x = r() * tot; for (let i = 0; i < n; i++) { x -= w[i]; if (x <= 0) return i; } return 0; };
    // light -> dark order for the smooth patterns
    const order = names.map((nm, i) => [i, (col.get(nm) || { L: i * 10 }).L]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const byT = (t) => order[clamp(Math.floor(clamp(t, 0, 0.9999) * n), 0, n - 1)];
    if (mode === 'gradient') {
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) out[y * CW + x] = byT(y / (CH - 1) + (r() - 0.5) * 0.42);
    } else if (mode === 'noise') {
      const G = 7, gw = Math.ceil(CW / G) + 2, gh = Math.ceil(CH / G) + 2, g = Array.from({ length: gw * gh }, () => r());
      const sm = (t) => t * t * (3 - 2 * t);
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const fx = x / G, fy = y / G, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
        const v = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        out[y * CW + x] = byT(v * 1.15 - 0.07 + (r() - 0.5) * 0.12);
      }
    } else if (mode === 'wall' || mode === 'floor') {
      // roles by position in the palette; with fewer blocks the last one fills the rest
      const R = (k) => Math.min(k, n - 1);
      const dark = order[n - 1], light = order[0];
      const main = 0, second = R(1), third = R(2), fourth = R(3), fifth = R(4);
      const at = (x, y, v) => { out[y * CW + x] = v; };
      if (mode === 'wall') {
        // a half-timbered house front: plinth, corner and bay pillars, a beam, a roof edge, windows, a body of the main block
        for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
          let v = r() < 0.16 ? second : main;
          if (r() < 0.05) v = third;
          if (y >= CH - 3) v = r() < 0.18 ? second : dark;                                  // plinth
          else if (y <= 1) v = n > 3 ? fourth : light;                                      // roof edge
          else if (y === 3) v = second;                                                     // beam under the roof
          else if (x % 8 === 0 || x % 8 === 7 || x === CW - 1) v = third;                    // pillars
          else if (y >= 6 && y <= 10 && (x % 8 === 3 || x % 8 === 4)) v = n > 4 ? fifth : light;   // windows
          else if (y === 5 && (x % 8 === 3 || x % 8 === 4) || y === 11 && (x % 8 === 3 || x % 8 === 4)) v = third;   // window frames
          at(x, y, v);
        }
      } else {
        // a floor seen from above: dark border, a ring, a 2x2 checker, and a medallion in the middle
        for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
          const edge = Math.min(x, y, CW - 1 - x, CH - 1 - y);
          let v;
          if (edge === 0) v = dark;
          else if (edge === 1) v = third;
          else v = (((x >> 1) + (y >> 1)) & 1) ? second : main;
          if (edge >= 2 && r() < 0.05) v = wpick();
          at(x, y, v);
        }
        for (let y = 5; y <= 12; y++) for (let x = 11; x <= 20; x++) {
          const ring = x === 11 || x === 20 || y === 5 || y === 12;
          at(x, y, ring ? dark : (x >= 14 && x <= 17 && y >= 8 && y <= 9) ? fifth : fourth);
        }
      }
    } else {
      for (let i = 0; i < out.length; i++) out[i] = wpick();
    }
    return out;
  }
  async function paint(cv, names, mode, seed) {
    const ims = await Promise.all(names.map(loadImg));
    if (cv._names !== names.join()) return;   // a newer palette took over while the textures loaded
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    const lay = layout(names, mode, seed);
    cv.width = CW * CP; cv.height = CH * CP;
    cx.imageSmoothingEnabled = false;
    for (let i = 0; i < lay.length; i++) {
      const im = ims[lay[i]];
      if (!im) continue;
      const w = Math.min(im.naturalWidth, im.naturalHeight);
      cx.drawImage(im, 0, 0, w, w, (i % CW) * CP, Math.floor(i / CW) * CP, CP, CP);
    }
  }

  /* ---------------- UI ---------------- */
  const tile = (n, cls) => h('img' + (cls || '.pl-t'), { src: texOf(n), alt: '', draggable: false, loading: 'lazy', decoding: 'async' });
  const seg = (label, items, cur, on) => h('div.seg', { role: 'radiogroup', 'aria-label': label },
    items.map(([id, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === id), class: cur === id ? 'on' : null, onclick: () => on(id) }, t)));

  function render(root) {
    const st = S();
    if (!['browse', 'make'].includes(st.tab)) st.tab = 'browse';
    loadColours();
    if (!['mix', 'gradient', 'noise', 'wall', 'floor'].includes(st.mode)) st.mode = 'mix';

    /* ----- preview ----- */
    const mosaic = h('canvas.pl-mosaic', { width: CW * CP, height: CH * CP, role: 'img' });
    const pvName = h('h3.pl-pv-name');
    const pvSub = h('span.pl-pv-sub');
    const list = h('div.pl-blist');
    const modeSeg = h('div.pl-modes');
    const favBtn = h('button.btn.small.pl-fav-btn', { type: 'button', onclick: () => toggleFav(current().id) }, glyph('heart'), h('span', 'Favourite'));
    const copyBtn = h('button.btn.small', { type: 'button', onclick: copyList }, glyph('copy'), 'Copy list');
    const moreBtn = h('button.btn.small', { type: 'button', onclick: moreLike }, glyph('wand'), 'More like this');
    const editBtn = h('button.btn.small', { type: 'button', onclick: editCopy }, glyph('edit'), 'Edit a copy');
    const shuffleBtn = h('button.btn.small', { type: 'button', onclick: () => { st.seed = (Math.random() * 1e9) | 0; save(); paintNow(); } }, glyph('dice'), 'Shuffle');
    tip(shuffleBtn, 'Paint the mosaic again with the same palette');
    tip(moreBtn, 'Generate a new palette around this one\'s main block');
    tip(editBtn, 'Open a copy of this palette in Make');
    const preview = h('section.panel.pl-pv', { 'aria-label': 'Preview' },
      h('div.pl-pv-head', pvName, pvSub),
      h('div.pl-stage', mosaic),
      h('div.pl-pv-tools', modeSeg, shuffleBtn),
      list,
      h('div.pl-pv-acts', favBtn, copyBtn, moreBtn, editBtn));

    function paintNow() {
      const p = current();
      mosaic._names = p.blocks.join();
      mosaic.classList.remove('pl-flash'); void mosaic.offsetWidth; mosaic.classList.add('pl-flash');
      paint(mosaic, p.blocks, st.mode, st.seed);
      mosaic.setAttribute('aria-label', 'Sample build painted with ' + p.name);
    }
    function patchModes() {
      modeSeg.replaceChildren(seg('Pattern', [['mix', 'Mix'], ['gradient', 'Gradient'], ['noise', 'Noise'], ['wall', 'Wall'], ['floor', 'Floor']], st.mode, (m) => { st.mode = m; save(); patchModes(); paintNow(); }));
    }
    function share(i, n) { const w = Array.from({ length: n }, (_, k) => WEIGHT[k] || 0.4); const t = w.reduce((a, b) => a + b, 0); return Math.round(w[i] / t * 100); }
    function patchPreview() {
      const p = current();
      pvName.textContent = p.name;
      pvSub.textContent = p.blocks.length + (p.blocks.length === 1 ? ' block' : ' blocks') + (p.tags && p.tags.length ? ' · ' + p.tags.slice(0, 3).join(', ') : '');
      list.replaceChildren(...p.blocks.map((b, i) => h('div.pl-brow', tile(b), h('span.pl-bname', nameOf(b)), h('span.pl-bshare', share(i, p.blocks.length) + '%'))));
      const isFav = st.fav.includes(p.id), real = p.id !== 'draft' && p.id !== 'gen';
      favBtn.classList.toggle('on', isFav);
      favBtn.querySelector('span:last-child').textContent = real ? (isFav ? 'Favourited' : 'Favourite') : 'Save';
      favBtn.dataset.mode = real ? 'fav' : 'save';
      editBtn.hidden = p.id === 'draft';
      moreBtn.hidden = false;
      preview.classList.toggle('is-empty', !p.blocks.length);
      paintNow();
      tintPreview();
    }
    function tintPreview() {
      const cs = current().blocks.map((b) => col.get(b)).filter(Boolean), k = cs.length;
      if (!k) { preview.style.removeProperty('--pc'); return; }
      const r = cs.reduce((a, c) => a + c.rgb[0], 0) / k, g = cs.reduce((a, c) => a + c.rgb[1], 0) / k, b = cs.reduce((a, c) => a + c.rgb[2], 0) / k;
      preview.style.setProperty('--pc', `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`);
    }

    /* ----- actions ----- */
    function select(id, quiet) {
      st.sel = id; save();
      root.querySelectorAll('.pl-card.on').forEach((c) => c.classList.remove('on'));
      const c = root.querySelector('.pl-card[data-id="' + id + '"]');
      if (c) c.classList.add('on');
      patchPreview();
      if (!quiet && matchMedia('(max-width: 1000px)').matches) preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function toggleFav(id) {
      if (id === 'draft' || id === 'gen') { saveMine(current()); return; }
      const i = st.fav.indexOf(id);
      if (i >= 0) st.fav.splice(i, 1); else st.fav.push(id);
      save();
      root.querySelectorAll('.pl-card[data-id="' + id + '"] .pl-heart').forEach((b) => b.classList.toggle('on', i < 0));
      patchPreview();
      if (st.tag === 'fav') patchBrowse();
    }
    function saveMine(p) {
      if (!p.blocks.length) return;
      TH.util.ask({ text: 'Name this palette', ok: 'Save', input: p.name === 'Your palette' ? '' : p.name }).then((nm) => {
        if (nm == null) return;
        const id = 'm_' + Math.random().toString(36).slice(2, 8);
        st.mine.unshift({ id, name: (nm || '').trim() || 'My palette', blocks: p.blocks.slice(), tags: ['yours'] });
        save();
        toast('Saved to Yours');
        if (st.tab === 'browse') { st.tag = 'mine'; select(id, true); patchBrowse(); } else { patchPreview(); }
      });
    }
    function copyList() {
      const p = current();
      const text = p.name + '\n' + p.blocks.map((b, i) => nameOf(b) + ' (minecraft:' + b + ') ' + share(i, p.blocks.length) + '%').join('\n');
      const ok = () => toast('Copied the block list');
      try { navigator.clipboard.writeText(text).then(ok, () => toast(p.blocks.map(nameOf).join(', '))); } catch (e) { toast(p.blocks.map(nameOf).join(', ')); }
    }
    function moreLike() {
      const run = () => {
        const p = current();
        const g = generate(p.blocks[0], KINDS[Math.floor(rnd() * KINDS.length)]);
        st.gen = g; st.sel = 'gen'; save();
        root.querySelectorAll('.pl-card.on').forEach((c) => c.classList.remove('on'));
        patchPreview();
      };
      if (colReady) run(); else loadColours().then(run);
    }
    function editCopy() {
      st.draft = current().blocks.slice(0, MAXB); st.sel = 'draft'; setTab('make');
    }
    function surpriseMe() {
      const run = () => { st.gen = surprise(); st.sel = 'gen'; save(); root.querySelectorAll('.pl-card.on').forEach((c) => c.classList.remove('on')); patchPreview(); };
      if (colReady) run(); else loadColours().then(run);
    }

    /* ----- browse ----- */
    const search = h('input.field.pl-search', { type: 'search', placeholder: 'Search palettes or blocks', 'aria-label': 'Search palettes', value: st.q || '', oninput: (e) => { st.q = e.target.value; save(); patchBrowse(true); } });
    const chips = h('div.pl-chips', { role: 'group', 'aria-label': 'Filter by tag' });
    const grid = h('div.pl-grid');
    const count = h('span.pl-count');
    const surpriseBtn = h('button.btn.small.pl-surprise', { type: 'button', onclick: surpriseMe }, glyph('dice'), 'Surprise me');
    tip(surpriseBtn, 'A brand new palette made from the real block colours');
    const browse = h('div.pl-main-in',
      h('section.panel.pl-pan', { 'aria-label': 'Browse palettes' },
        h('div.pl-pan-head', h('h3', 'Palettes'), count, surpriseBtn),
        search, chips, grid));
    function allWithMine() { return st.mine.map((m) => Object.assign({ tags: ['yours'] }, m, { blocks: m.blocks.filter(isBlock) })).concat(curated()); }
    function tagCount() {
      const c = {};
      curated().forEach((p) => p.tags.forEach((t) => { c[t] = (c[t] || 0) + 1; }));
      return TAG_ORDER.filter((t) => c[t]).map((t) => [t, c[t]]);
    }
    function card(p) {
      const fav = st.fav.includes(p.id);
      const heart = h('button.pl-heart' + (fav ? '.on' : ''), { type: 'button', 'aria-label': 'Favourite ' + p.name, onclick: (e) => { e.stopPropagation(); toggleFav(p.id); } }, glyph('heart'));
      const el = h('div.pl-card' + (st.sel === p.id ? '.on' : ''), { 'data-id': p.id, role: 'button', tabindex: '0', 'aria-label': p.name + ', ' + p.blocks.map(nameOf).join(', '),
        onclick: () => select(p.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id); } } },
        h('div.pl-strip', p.blocks.slice(0, 6).map((b) => tile(b))),
        h('div.pl-cap', h('span.pl-cname', p.name), heart),
        h('div.pl-extra', { 'aria-hidden': 'true' },
          h('div.pl-xnames', p.blocks.map((b) => h('span.pl-xn', tile(b, '.pl-xt'), nameOf(b)))),
          p.tags && p.tags.length ? h('div.pl-xtags', p.tags.map((t) => h('span', t))) : null));
      return el;
    }
    function filtered() {
      const q = (st.q || '').trim().toLowerCase();
      return allWithMine().filter((p) => {
        if (st.tag === 'fav' && !st.fav.includes(p.id)) return false;
        if (st.tag === 'mine' && !String(p.id).startsWith('m_')) return false;
        if (st.tag !== 'all' && st.tag !== 'fav' && st.tag !== 'mine' && !p.tags.includes(st.tag)) return false;
        if (q && !(p.name.toLowerCase().includes(q) || p.blocks.some((b) => nameOf(b).toLowerCase().includes(q)))) return false;
        return true;
      });
    }
    function patchBrowse(keepChips) {
      const list = filtered();
      count.textContent = list.length + (list.length === 1 ? ' palette' : ' palettes');
      grid.replaceChildren(...(list.length ? list.map(card) : [h('p.pl-none', st.tag === 'fav' ? 'No favourites yet. Tap the heart on a palette.' : st.tag === 'mine' ? 'Nothing saved yet. Build one in Make.' : 'No palette matches.')]));
      if (keepChips) return;
      const mk = (id, t, n) => h('button.chip' + (st.tag === id ? '.on' : ''), { type: 'button', 'aria-pressed': String(st.tag === id), onclick: () => { st.tag = id; save(); patchBrowse(); } }, t, n != null ? h('em', String(n)) : null);
      chips.replaceChildren(mk('all', 'All', curated().length + st.mine.length), mk('fav', 'Favourites', st.fav.length), mk('mine', 'Yours', st.mine.length), ...tagCount().map(([t, n]) => mk(t, t[0].toUpperCase() + t.slice(1), n)));
    }

    /* ----- make ----- */
    const slots = h('div.pl-slots');
    const sugg = h('div.pl-sugg');
    const pickSearch = h('input.field.pl-search', { type: 'search', placeholder: 'Find a block to add', 'aria-label': 'Search blocks', oninput: () => patchPicker() });
    const pickGrid = h('div.pl-pick');
    const groups = ['all', ...new Set(blocks().map(groupOf))];
    let grp = 'all';
    const grpChips = h('div.pl-chips');
    const saveBtn = h('button.btn.small.primary', { type: 'button', onclick: () => saveMine(current()) }, glyph('save'), 'Save palette');
    const clearBtn = h('button.btn.small', { type: 'button', onclick: () => { st.draft = []; save(); patchMake(); } }, 'Clear');
    const sBtn = h('button.btn.small', { type: 'button', onclick: () => { const run = () => { const D = st.draft; const g = D.length ? generate(D[0], KINDS[Math.floor(rnd() * KINDS.length)]) : surprise(); st.draft = g.blocks.slice(0, MAXB); save(); patchMake(); }; if (colReady) run(); else loadColours().then(run); } }, glyph('wand'), 'Fill it for me');
    tip(sBtn, 'Builds a palette around your first block (or a random one)');
    const make = h('div.pl-main-in',
      h('section.panel.pl-pan', { 'aria-label': 'Your palette' },
        h('div.pl-pan-head', h('h3', 'Your palette'), h('span.pl-count', 'up to ' + MAXB + ' blocks')),
        slots, h('div.pl-make-acts', saveBtn, sBtn, clearBtn)),
      h('section.panel.pl-pan', { 'aria-label': 'Suggestions' },
        h('div.pl-pan-head', h('h3', 'Goes well with it'), h('span.pl-count', 'from the real block colours')), sugg),
      h('section.panel.pl-pan', { 'aria-label': 'All blocks' },
        h('div.pl-pan-head', h('h3', 'All blocks'), h('span.pl-count', blocks().length + ' blocks')), pickSearch, grpChips, pickGrid));
    function addBlock(b) {
      if (st.draft.includes(b)) return;
      if (st.draft.length >= MAXB) { toast('A palette holds up to ' + MAXB + ' blocks'); return; }
      st.draft.push(b); st.sel = 'draft'; save(); patchMake();
    }
    function patchMake() {
      if (st.sel !== 'draft') { st.sel = 'draft'; save(); }
      const D = st.draft;
      slots.replaceChildren(...Array.from({ length: MAXB }, (_, i) => {
        const b = D[i];
        if (!b) return h('div.pl-slot.empty' + (i === D.length ? '.next' : ''), { 'aria-hidden': 'true' }, i === D.length ? glyph('plus') : null);
        const mv = (d) => { const j = i + d; if (j < 0 || j >= D.length) return; [D[i], D[j]] = [D[j], D[i]]; save(); patchMake(); };
        const cls = 'button.pl-sbtn';
        return h('div.pl-slot', tile(b, '.pl-st'),
          h('span.pl-sname', nameOf(b)),
          h('div.pl-sacts',
            tip(h(cls, { type: 'button', 'aria-label': 'Move left', disabled: i === 0, onclick: () => mv(-1) }, glyph('left')), 'Move left'),
            tip(h(cls, { type: 'button', 'aria-label': 'Remove ' + nameOf(b), onclick: () => { D.splice(i, 1); save(); patchMake(); } }, glyph('x')), 'Remove'),
            tip(h(cls, { type: 'button', 'aria-label': 'Move right', disabled: i === D.length - 1, onclick: () => mv(1) }, glyph('right')), 'Move right')));
      }));
      saveBtn.disabled = D.length < 2;
      clearBtn.disabled = !D.length;
      // suggestions
      if (!D.length) {
        const starters = ['stone_bricks', 'oak_planks', 'white_concrete', 'deepslate_bricks', 'sandstone', 'spruce_planks', 'terracotta', 'quartz_block', 'red_concrete', 'blue_concrete', 'lime_concrete', 'cherry_planks'].filter(isBlock);
        sugg.replaceChildren(h('p.pl-hint', 'Start with one block, then the suggestions follow its colour.'), h('div.pl-row', starters.map((b) => chip(b))));
      } else if (!colReady) {
        sugg.replaceChildren(h('p.pl-hint', 'Reading the block colours…'));
      } else {
        sugg.replaceChildren(...suggestions(D).map(([t, sub, list]) => h('div.pl-srow', h('div.pl-stitle', h('b', t), h('span', sub)), h('div.pl-row', list.map((b) => chip(b))))));
      }
      patchPicker();
      patchPreview();
    }
    function chip(b) {
      const e = h('button.pl-add', { type: 'button', 'aria-label': 'Add ' + nameOf(b), onclick: () => addBlock(b) }, tile(b));
      tip(e, () => nameOf(b));
      return e;
    }
    function patchPicker() {
      const q = pickSearch.value.trim().toLowerCase();
      const list = blocks().filter((b) => (grp === 'all' || groupOf(b) === grp) && (!q || nameOf(b).toLowerCase().includes(q)));
      pickGrid.replaceChildren(...(list.length ? list.map((b) => {
        const on = S().draft.includes(b);
        const e = h('button.pl-add' + (on ? '.on' : ''), { type: 'button', 'aria-label': (on ? 'Already in the palette: ' : 'Add ') + nameOf(b), onclick: () => addBlock(b) }, tile(b));
        tip(e, () => nameOf(b));
        return e;
      }) : [h('p.pl-none', 'No block matches.')]));
      grpChips.replaceChildren(...groups.map((g) => h('button.chip' + (grp === g ? '.on' : ''), { type: 'button', 'aria-pressed': String(grp === g), onclick: () => { grp = g; patchPicker(); } }, g === 'all' ? 'All' : core().GROUPS[g] || g)));
    }

    /* ----- shell ----- */
    const main = h('div.pl-main');
    const tabs = h('div.pl-tabs');
    function setTab(t) {
      st.tab = t; save();
      tabs.replaceChildren(seg('Palettes section', [['browse', 'Browse'], ['make', 'Make']], t, setTab));
      if (t === 'make') { main.replaceChildren(make); if (st.sel !== 'draft') { st.sel = 'draft'; save(); } patchMake(); }
      else { if (st.sel === 'draft') { st.sel = (curated()[0] || {}).id; save(); } main.replaceChildren(browse); patchBrowse(); patchPreview(); }
    }
    root.append(
      h('div.page-head.pl-head', h('h2', 'Block Palettes'), tabs),
      h('div.pl-layout', main, h('div.pl-side', preview)));
    patchModes();
    setTab(st.tab);
    // colours finished (first visit): tint, and fill the suggestions
    const onReady = () => {
      if (!preview.isConnected) { colWaiters.delete(onReady); return; }
      tintPreview();
      if (st.tab === 'make') patchMake();
    };
    colWaiters.add(onReady);
    if (colReady) onReady();
  }

  TH.palettes = { col, suggestions, generate };   // for the console
  TH.app.register({
    id: 'palettes',
    name: 'Block Palettes',
    short: 'Palettes',
    icon: () => h('span.pl-navico', ['block/cherry_planks', 'block/pink_concrete', 'block/purple_concrete', 'block/white_concrete'].map((t) => h('i', { style: { backgroundImage: 'url("' + TH.icon.tex(t) + '")' } }))),
    init(store) {
      store.define('palettes', { tab: 'browse', sel: 'c0', mode: 'mix', seed: 7, tag: 'all', q: '', fav: [], mine: [], draft: [], gen: null });
      const s = store.get().palettes;
      ['fav', 'mine', 'draft'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
    },
    render,
  });
})();
