/**
 * Palettes (rose accent): block palettes for builders.
 *   Browse = 140 hand-made palettes (js/data/palettes.js) with tag filters, search, favourites and your own.
 *   Make   = build a palette block by block; suggestions come from the real texture colours (similar shades,
 *            contrast, lighter / darker, neutrals), plus "Surprise me" and "More like this", which generate endless new ones.
 *   Preview (right column in Browse / Make) = a mosaic painted with the palette in one of 18 patterns (PATTERNS), the
 *            block list with a usage share, favourite / copy / save, "Open in editor".
 *   Editor (view 'edit') = the preview takes the space of the list: a big canvas (32x18 / 48x27 / 64x36), manual painting
 *            (brush 1-3, fill, replace all, pick, eraser, undo / redo), painted cells sit on top of the generated pattern;
 *            block order (roles), swap / remove / add, share sliders (weights), pattern chooser, save as your palette.
 *
 * Colours: every block texture is drawn once on a small canvas and averaged (sRGB -> Lab), so matching is done on what
 * the blocks really look like. That runs after the first paint; until it finishes the suggestion rows say so.
 *
 * state.palettes = { tab: 'browse'|'make', view: 'list'|'edit', sel: 'c12'|'m_x'|'draft'|'gen', mode (browse pattern id or
 *   'own'), seed, dir, tag, q, fav: [id], mine: [{ id, name, blocks, tags, w?, look? }], draft: [block], dw: { block: weight },
 *   gen: { name, blocks } | null, ed: editor doc | null }
 * w = raw usage weights by block name (missing = the default 50, 30, 20 ... by position). look = { pat, tile, dir, seed,
 * size, edits } where edits = { b: [block], r: [value, run, ...] } run-length over a 64-wide grid (value 0 = not painted).
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
  const DEFW = [50, 30, 20, 14, 10, 8, 6, 5];
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
    if (st.sel === 'draft') return { id: 'draft', name: 'Your palette', blocks: st.draft, tags: [], w: st.dw };
    if (st.sel === 'gen' && st.gen) return { id: 'gen', name: st.gen.name, blocks: st.gen.blocks, tags: [] };
    const m = st.mine.find((p) => p.id === st.sel);
    if (m) return Object.assign({ tags: ['yours'] }, m, { blocks: m.blocks.filter(isBlock) });
    return curated().find((p) => p.id === st.sel) || curated()[0];
  }
  const wOf = (wm, nm, i) => (wm && wm[nm] > 0 ? wm[nm] : DEFW[i] || 4);
  function shares(names, wm) {
    const w = names.map((nm, i) => wOf(wm, nm, i)), t = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / t);
  }
  /** Whole percentages that add up to 100 (largest remainder). */
  function pcts(names, wm) {
    const s = shares(names, wm), raw = s.map((v) => v * 100), out = raw.map(Math.floor);
    let left = 100 - out.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return names.length ? out : [];
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
    up: 'M8 4l6 6-1 1-5-5-5 5-1-1z',
    down: 'M8 12L2 6l1-1 5 5 5-5 1 1z',
    wand: 'M11 1h2v2h2v2h-2v2h-2V5H9V3h2zM2 13l7-7 2 2-7 7H2z',
    edit: 'M11 1h2l2 2v2l-1 1-3-3zM9 4l3 3-7 7H2v-3z',
    back: 'M7 2l1 1-4 4h10v2H4l4 4-1 1-6-6z',
    brush: 'M12 1h3v3L9 10 6 7zM5 8l3 3-1 2H5l-1 1H1v-3l1-1V9z',
    fill: 'M7 1h2v3l5 5-6 6-7-7 5-5zM3 8l5 5 4-4H3zM14 11l1 2v2h-2v-2z',
    replace: 'M4 1l4 4H5v5H3V5H0zM12 15l-4-4h3V6h2v5h3z',
    pick: 'M12 1h2l1 1v2l-2 2 1 1-1 1-1-1-6 6H3v-3l6-6-1-1 1-1 1 1z',
    erase: 'M9 1l6 6-7 7H4l-3-3zM2 15h13v-1H2z',
    undo: 'M5 2v3h7l2 2v5l-2 2H7v-2h5V7H5v3L1 6z',
    redo: 'M11 2v3H4L2 7v5l2 2h5v-2H4V7h7v3l4-4z',
    fit: 'M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z',
    minus: 'M2 7h12v2H2z',
    swap: 'M11 1l4 4-4 4V6H3V4h8zM5 7v3h8v2H5v3l-4-4z',
    sort: 'M3 1h2v10h2l-3 4-3-4h2zM9 2h6v2H9zM9 6h5v2H9zM9 10h3v2H9z',
    image: 'M1 2h14v12H1zM3 4v6l3-3 3 3 2-2 2 2V4zM10 5h2v2h-2z',
  };
  const glyph = (k) => {
    const s = h('span.pl-ico', { 'aria-hidden': 'true' });
    s.style.setProperty('--m', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><path d='${GLYPH[k]}'/></svg>`)}")`);
    return s;
  };

  /* ================= pattern engine (pure: names + options -> block index per cell) ================= */
  const SIZES = [[32, 18], [48, 27], [64, 36]];
  const MAXW = 64;   // edit keys are y * MAXW + x, so they survive a change of canvas size
  const PATTERNS = [
    { id: 'mix', name: 'Mix', grp: 'Textures', tile: 1, tip: 'Every block at random, as often as its share says' },
    { id: 'gradient', name: 'Gradient', grp: 'Textures', tile: 1, tip: 'From the first block at the top to the last one at the bottom' },
    { id: 'noise', name: 'Noise', grp: 'Textures', tile: 1, tip: 'Soft clouds, neighbours in the palette blend into each other' },
    { id: 'cobble', name: 'Cobble', grp: 'Textures', tile: 1, tip: 'Random patches, like a cobbled path' },
    { id: 'stripes', name: 'Stripes', grp: 'Textures', tile: 2, dir: true, tip: 'Bands in palette order, each as wide as its share' },
    { id: 'plaid', name: 'Plaid', grp: 'Textures', tile: 1, tip: 'Woven bands across and down' },
    { id: 'checker', name: 'Checker', grp: 'Floors', tile: 2, tip: 'First and second block as a checkerboard, the others as accents' },
    { id: 'diamonds', name: 'Diamonds', grp: 'Floors', tile: 1, tip: 'A diagonal checker: diamonds on the main block' },
    { id: 'herringbone', name: 'Herringbone', grp: 'Floors', tile: 1, tip: 'Planks in a zig-zag, like a parquet floor' },
    { id: 'chevron', name: 'Chevron', grp: 'Floors', tile: 1, tip: 'Zig-zag rows of the first two blocks' },
    { id: 'basket', name: 'Basket weave', grp: 'Floors', tile: 1, tip: 'Squares of planks that turn every other square' },
    { id: 'frames', name: 'Frames', grp: 'Floors', tile: 1, tip: 'Rings from the edge inwards' },
    { id: 'medallion', name: 'Medallion', grp: 'Floors', tile: 1, tip: 'A border, a patterned field and an inlay in the middle' },
    { id: 'starburst', name: 'Starburst', grp: 'Floors', tile: 0, tip: 'Rays around a centre piece' },
    { id: 'running', name: 'Brick wall', grp: 'Walls', tile: 1, tip: 'Running bond: every course shifted by half a brick, with a plinth and a top' },
    { id: 'stack', name: 'Stack bond', grp: 'Walls', tile: 1, tip: 'Bricks stacked straight above each other' },
    { id: 'flemish', name: 'Flemish bond', grp: 'Walls', tile: 1, tip: 'Long and short bricks taking turns, the short ones in the second block' },
    { id: 'house', name: 'House front', grp: 'Walls', tile: 0, tip: 'A half-timbered front: plinth, pillars, windows, a beam and the roof edge' },
    { id: 'roof', name: 'Roof', grp: 'Walls', tile: 1, tip: 'Shingle rows between a ridge and an eave' },
  ];
  const PAT = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));
  const OLD = { wall: 'running', floor: 'medallion' };
  const patId = (m) => (PAT[m] ? m : OLD[m] || 'mix');

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mix32(x, v) { x = Math.imul(x ^ (v | 0), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return x ^ (x >>> 16); }
  /** Stable 0..1 per (a, b, c) and seed. */
  function hash3(a, b, c, s) { return (mix32(mix32(mix32(s ^ 0x9e3779b9, a), b), c) >>> 0) / 4294967296; }
  const mod = (a, m) => ((a % m) + m) % m;

  /**
   * layout(names, { pat, seed, W, H, tile, dir, w }) -> Uint8Array(W * H) of block indices.
   * Roles come from the order: 0 = main, 1 = second, 2 = accent, last = trim (plinths, borders). Shares (w) set how
   * much of each block the random parts use and how wide bands are.
   */
  function layout(names, o) {
    o = o || {};
    const n = names.length, W = o.W || 32, H = o.H || 18, out = new Uint8Array(W * H);
    if (n < 2) return out;
    const pat = patId(o.pat), T = clamp(o.tile || 1, 1, 3), seed = o.seed | 0, r = rng(seed);
    const w = names.map((nm, i) => wOf(o.w, nm, i)), sh = shares(names, o.w);
    const R = (k) => Math.min(k, n - 1), trim = n - 1;
    const ALL = names.map((_, i) => i);
    const H3 = (a, b, c) => hash3(a, b, c, seed);
    const pickIn = (u, set) => { let t = 0; for (const i of set) t += w[i]; let x = u * t; for (const i of set) { x -= w[i]; if (x < 0) return i; } return set[set.length - 1]; };
    const wpick = (u) => pickIn(u, ALL);
    const rest = (from) => ALL.slice(from);
    const restShare = (from) => sh.slice(from).reduce((a, b) => a + b, 0);
    const byT = (t) => { t = clamp(t, 0, 0.99999); let c = 0; for (let i = 0; i < n; i++) { c += sh[i]; if (t < c) return i; } return n - 1; };
    const each = (fn) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = fn(x, y); };
    const TW = Math.ceil(W / T), TH = Math.ceil(H / T);
    const tiles = (fn) => { const t = new Uint8Array(TW * TH); for (let Y = 0; Y < TH; Y++) for (let X = 0; X < TW; X++) t[Y * TW + X] = fn(X, Y); each((x, y) => t[Math.floor(y / T) * TW + Math.floor(x / T)]); };
    // ordered bands (first block first), each about T * n * share wide
    const bands = (scale) => { const a = []; ALL.forEach((i) => { const k = Math.max(1, Math.round(sh[i] * n * scale)); for (let j = 0; j < k; j++) a.push(i); }); return a; };

    switch (pat) {
      case 'gradient':
        tiles((X, Y) => byT((Y + 0.5) / TH + (H3(X, Y, 2) - 0.5) * 0.3));
        break;
      case 'noise': {
        const G = 5, gw = Math.ceil(TW / G) + 2, g = (i, j) => H3(i, j, 3), sm = (t) => t * t * (3 - 2 * t);
        const v = [];
        for (let Y = 0; Y < TH; Y++) for (let X = 0; X < TW; X++) {
          const fx = X / G, fy = Y / G, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
          const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
          v.push([(a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty + (H3(X, Y, 4) - 0.5) * 0.06, Y * TW + X]);
        }
        // rank -> share: every block gets exactly its share, the noise only decides where
        const rank = new Float32Array(v.length);
        v.sort((p, q) => p[0] - q[0]).forEach((p, i) => { rank[p[1]] = (i + 0.5) / v.length; });
        tiles((X, Y) => byT(rank[Y * TW + X]));
        break;
      }
      case 'cobble': {
        const C = 3;
        tiles((X, Y) => {
          const gx = Math.floor(X / C), gy = Math.floor(Y / C);
          let best = 1e9, id = [0, 0];
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const px = (gx + i + 0.15 + H3(gx + i, gy + j, 5) * 0.7) * C, py = (gy + j + 0.15 + H3(gx + i, gy + j, 6) * 0.7) * C;
            const d = (X + 0.5 - px) ** 2 + (Y + 0.5 - py) ** 2 + H3(X, Y, 7) * 1.2;
            if (d < best) { best = d; id = [gx + i, gy + j]; }
          }
          return wpick(H3(id[0], id[1], 8));
        });
        break;
      }
      case 'stripes': {
        const seq = bands(T), P = seq.length, off = Math.floor(r() * P), dir = o.dir || 'v';
        each((x, y) => seq[mod((dir === 'h' ? y : dir === 'd' ? x + y : x) + off, P)]);
        break;
      }
      case 'plaid': {
        const line = (len, salt) => {
          const a = []; let k = 0, prev = -1;
          while (a.length < len) {
            let c = wpick(H3(k, salt, 9)); if (c === prev) c = wpick(H3(k, salt, 10));
            const wd = T * (1 + Math.floor(H3(k, salt, 11) * 3));
            for (let j = 0; j < wd; j++) a.push(c);
            prev = c; k++;
          }
          return a;
        };
        const cx = line(W, 1), cy = line(H, 2);
        each((x, y) => (cx[x] === cy[y] ? cx[x] : ((x + y) & 1 ? cx[x] : cy[y])));
        break;
      }
      case 'checker': {
        const acc = n > 2 ? restShare(2) : 0;
        tiles((X, Y) => (!((X + Y) & 1) ? 0 : (acc && H3(X, Y, 12) < acc ? pickIn(H3(X, Y, 13), rest(2)) : 1)));
        break;
      }
      case 'diamonds': {
        const P = 2 + 4 * T, half = P / 2, ox = Math.floor(r() * P), oy = Math.floor(r() * P);
        each((x, y) => {
          const X = x + ox, Y = y + oy, cx = mod(X, P) - (P - 1) / 2, cy = mod(Y, P) - (P - 1) / 2, d = Math.abs(cx) + Math.abs(cy);
          if (d >= half) return 0;
          if (d < half / 2) return n >= 4 ? 3 : 0;
          return n >= 3 && ((Math.floor(X / P) + Math.floor(Y / P)) & 1) ? 2 : 1;
        });
        break;
      }
      case 'herringbone': {
        const L = T + 1, ox = Math.floor(r() * 2 * L), acc = n > 2 ? restShare(2) * 0.35 : 0;
        each((x, y) => {
          const X = x + ox, d = X - y, b = Math.floor((d + L) / (2 * L)), hz = d - b * 2 * L >= 0;
          const key = hz ? y : X - 2 * L * b;
          if (acc && H3(b, key, hz ? 14 : 15) < acc) return pickIn(H3(b, key, 16), rest(2));
          return hz ? 0 : 1;
        });
        break;
      }
      case 'chevron': {
        const L = T + 1, Z = 2 * L, oy = Math.floor(r() * Z), acc = n > 2 ? restShare(2) * 0.25 : 0;
        each((x, y) => {
          const g = Math.floor(x / Z), xl = (g & 1) ? Z - 1 - x % Z : x % Z, row = Math.floor((xl + y + oy) / L);
          if (acc && H3(g, row, 24) < acc) return pickIn(H3(g, row, 25), rest(2));
          return row & 1;
        });
        break;
      }
      case 'basket': {
        const L = T + 1;
        each((x, y) => {
          const o2 = (Math.floor(x / L) + Math.floor(y / L)) & 1, i = o2 ? x % L : y % L;
          return i % 2 === 0 ? 0 : (o2 ? 1 : R(2));
        });
        break;
      }
      case 'frames': {
        const seq = bands(T).reverse(), P = seq.length, off = Math.floor(r() * n);
        each((x, y) => seq[mod(Math.min(x, y, W - 1 - x, H - 1 - y) + off * T, P)]);
        break;
      }
      case 'medallion': {
        const fs = Math.floor(r() * 3), cs = Math.floor(r() * 3), cx = (W - 1) / 2, cy = (H - 1) / 2, rr = Math.max(3, Math.round(H * 0.3)), F = T + 1;
        each((x, y) => {
          const e = Math.min(x, y, W - 1 - x, H - 1 - y);
          if (e < T) return trim;
          if (e < T + 1) return R(2);
          const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
          const dc = cs === 0 ? dx + dy : cs === 1 ? Math.hypot(dx, dy) * 1.08 : Math.max(dx, dy) * 1.25;
          if (dc <= rr) return dc > rr - 1 ? trim : dc <= rr * 0.45 ? R(4) : R(3);
          if (fs === 0) return (Math.floor(x / F) + Math.floor(y / F)) & 1 ? R(1) : 0;
          if (fs === 1) return mod(x + y, 4) === 0 && mod(x - y, 4) === 0 ? R(1) : 0;
          return mod(x + y, 4) === 0 || mod(x - y, 4) === 0 ? R(1) : 0;
        });
        break;
      }
      case 'starburst': {
        const Sn = [12, 16, 20][Math.floor(r() * 3)], off = r(), cx = (W - 1) / 2, cy = (H - 1) / 2, core0 = H * 0.15;
        each((x, y) => {
          const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy);
          if (dd < core0) return R(2);
          if (dd < core0 + 1) return trim;
          const sec = Math.floor(mod((Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) * Sn + off, Sn));
          return n >= 4 && sec % 4 === 3 ? 3 : sec % 2 ? 1 : 0;
        });
        break;
      }
      case 'running': case 'stack': case 'flemish': {
        const base = T + 1, body = n >= 3 ? ALL.slice(0, n - 1) : ALL, ox = Math.floor(r() * 12);
        const BL = [3, 4, 6][T - 1];
        const stretch = n >= 4 ? [0].concat(ALL.slice(2, n - 1)) : [0];
        each((x, y) => {
          if (y >= H - base || y === 0) return trim;   // plinth and coping
          const c = Math.floor((H - base - 1 - y) / T);     // courses counted up from the plinth
          if (pat === 'flemish') {
            const SL = T + 1, P = SL + T, pos = mod(x + ox + ((c & 1) ? Math.floor(P / 2) : 0), P);
            if (pos >= SL) return R(1);
            const b = Math.floor((x + ox + ((c & 1) ? Math.floor(P / 2) : 0)) / P);
            return pickIn(H3(b, c, 17), stretch);
          }
          const sx = x + ox + (pat === 'running' && (c & 1) ? Math.floor(BL / 2) : 0), b = Math.floor(sx / BL);
          let v = pickIn(H3(b, c, 18), body);
          if (v === pickIn(H3(b - 1, c, 18), body)) v = pickIn(H3(b, c, 19), body);
          return v;
        });
        break;
      }
      case 'house': {
        const s = H / 18, bay = Math.max(6, Math.round(8 * s)), win = Math.max(2, Math.round(2 * s)), wl = Math.floor((bay - win) / 2);
        const wy0 = Math.round(6 * s), wy1 = Math.round(10 * s), ox = Math.floor(r() * bay);
        each((x, y) => {
          if (y >= H - Math.round(3 * s)) return H3(x, y, 20) < 0.18 ? R(1) : trim;   // plinth
          if (y < Math.round(2 * s)) return R(3);                                      // roof edge
          if (y === Math.round(3 * s)) return R(1);                                    // beam under the roof
          const bx = mod(x + ox, bay), inWin = bx >= wl && bx < wl + win;
          if (bx === 0 || bx === bay - 1) return R(2);                                 // pillars
          if (inWin && y >= wy0 && y <= wy1) return R(4);                              // windows
          if (inWin && (y === wy0 - 1 || y === wy1 + 1)) return R(2);                  // window frames
          const u = H3(x, y, 21);
          return u < 0.05 ? R(2) : u < 0.21 ? R(1) : 0;
        });
        break;
      }
      case 'roof': {
        const acc = n > 2 ? restShare(2) * 0.6 : 0;
        each((x, y) => {
          if (y < T || y >= H - T) return trim;   // ridge and eave
          const rw = Math.floor(y / T), k = Math.floor((x + (rw & 1) * T) / (2 * T));
          if (acc && H3(k, rw, 22) < acc) return pickIn(H3(k, rw, 23), rest(2));
          return rw % 3 === 2 ? 1 : 0;
        });
        break;
      }
      default:
        tiles((X, Y) => wpick(H3(X, Y, 1)));
    }
    return out;
  }

  /** Painted cells: Map(y * MAXW + x -> block) <-> { b: [block], r: [value, run, ...] }. */
  function encEdits(map) {
    if (!map || !map.size) return null;
    const names = [...new Set(map.values())], idx = new Map(names.map((b, i) => [b, i + 1]));
    let maxK = 0; map.forEach((_, k) => { if (k > maxK) maxK = k; });
    const r = []; let prev = -1, run = 0;
    for (let k = 0; k <= maxK; k++) {
      const v = map.has(k) ? idx.get(map.get(k)) : 0;
      if (v === prev) run++; else { if (run) r.push(prev, run); prev = v; run = 1; }
    }
    r.push(prev, run);
    return { b: names, r };
  }
  function decEdits(e) {
    const m = new Map();
    if (!e || !Array.isArray(e.b) || !Array.isArray(e.r)) return m;
    let k = 0;
    for (let i = 0; i + 1 < e.r.length; i += 2) {
      const v = e.r[i], run = e.r[i + 1] | 0;
      if (v > 0 && e.b[v - 1]) for (let j = 0; j < run; j++) m.set(k + j, e.b[v - 1]);
      k += run;
    }
    return m;
  }
  /** Final block name per cell: the pattern, then painted cells on top (only blocks still in the palette). */
  function compose(names, o, edits) {
    const lay = layout(names, o), W = o.W, out = new Array(lay.length);
    for (let i = 0; i < lay.length; i++) out[i] = names[lay[i]];
    if (edits && edits.size) edits.forEach((b, k) => { const x = k % MAXW, y = Math.floor(k / MAXW); if (x < W && y < o.H && names.includes(b)) out[y * W + x] = b; });
    return out;
  }

  /* ---------------- drawing ---------------- */
  const CP = 16;
  const imgs = new Map(), ready = new Map();
  function loadImg(n) {
    if (imgs.has(n)) return imgs.get(n);
    // CORS so the canvas stays readable (PNG export); a texture that refuses CORS is loaded plainly instead
    const p = new Promise((res) => {
      const plain = () => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = texOf(n); };
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = plain; im.src = texOf(n);
    }).then((im) => { ready.set(n, im); return im; });
    imgs.set(n, p);
    return p;
  }
  function drawTex(cx, im, x, y, c) {
    if (!im) { cx.fillStyle = '#777'; cx.fillRect(x * c, y * c, c, c); return; }
    const w = Math.min(im.naturalWidth, im.naturalHeight);
    cx.drawImage(im, 0, 0, w, w, x * c, y * c, c, c);
  }
  /** Paint a grid of block names onto a canvas (async: waits for the textures; a newer call wins). */
  async function paintGrid(cv, grid, W, H) {
    const token = (cv._tok = (cv._tok || 0) + 1);
    const uniq = [...new Set(grid)].filter(Boolean);
    await Promise.all(uniq.map(loadImg));
    if (cv._tok !== token) return;
    if (cv.width !== W * CP || cv.height !== H * CP) { cv.width = W * CP; cv.height = H * CP; }
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    for (let i = 0; i < grid.length; i++) drawTex(cx, ready.get(grid[i]), i % W, Math.floor(i / W), CP);
  }
  const grey = (i, n) => { const v = Math.round(200 - (i / Math.max(1, n - 1)) * 150); return [v, v, v]; };
  /** Pattern thumbnail: one pixel per cell in the blocks' average colours (crisp, cheap, readable at 40px). */
  function drawThumb(cv, names, o, edits) {
    const W = o.W, H = o.H;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const cx = cv.getContext('2d');
    if (!names.length) { cx.clearRect(0, 0, W, H); return; }
    const grid = compose(names, o, edits), rgb = new Map(names.map((b, i) => [b, col.get(b) ? col.get(b).rgb : grey(i, names.length)]));
    const img = cx.createImageData(W, H), d = img.data;
    for (let i = 0; i < grid.length; i++) { const c = rgb.get(grid[i]) || [128, 128, 128]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
    cx.putImageData(img, 0, 0);
  }
  const flash = (el) => { el.classList.remove('pl-flash'); void el.offsetWidth; el.classList.add('pl-flash'); };

  /* ---------------- UI ---------------- */
  const tile = (n, cls) => h('img' + (cls || '.pl-t'), { src: texOf(n), alt: '', draggable: false, loading: 'lazy', decoding: 'async' });
  /** One-of-N switch, patched in place with .set(id) (the sliding knob follows). */
  function seg(label, items, cur, on) {
    const el = h('div.seg', { role: 'radiogroup', 'aria-label': label });
    const bs = items.map(([id, t, tp]) => {
      const b = h('button', { type: 'button', role: 'radio', onclick: () => on(id) }, t);
      b.dataset.id = String(id);
      if (tp) tip(b, tp);
      return b;
    });
    el.append(...bs);
    el.set = (v) => bs.forEach((b) => { const o = b.dataset.id === String(v); b.classList.toggle('on', o); b.setAttribute('aria-checked', String(o)); });
    el.set(cur);
    return el;
  }
  const iconBtn = (g, label, onclick, cls) => tip(h('button.btn.small.pl-ibtn' + (cls || ''), { type: 'button', 'aria-label': label, onclick }, glyph(g)), label);
  let listScroll = 0;   // where the list was when the editor opened (survives re-renders)
  const E = { key: null, edits: new Map(), undo: [], redo: [] };   // editor runtime (undo stacks live here, not in the save)

  function render(root) {
    const st = S();
    if (!['browse', 'make'].includes(st.tab)) st.tab = 'browse';
    if (st.view !== 'edit' || !st.ed || !Array.isArray(st.ed.blocks)) st.view = 'list';
    loadColours();
    if (st.mode !== 'own') st.mode = patId(st.mode);
    if (!['v', 'h', 'd'].includes(st.dir)) st.dir = 'v';
    if (!st.dw || typeof st.dw !== 'object') st.dw = {};

    /* ----- preview ----- */
    const mosaic = h('canvas.pl-mosaic', { width: 32 * CP, height: 18 * CP, role: 'img' });
    const pvName = h('h3.pl-pv-name');
    const pvSub = h('span.pl-pv-sub');
    const list = h('div.pl-blist');
    const pats = h('div.pl-pats.pl-pats-mini', { role: 'radiogroup', 'aria-label': 'Pattern' });
    const patName = h('span.pl-patname');
    const favBtn = h('button.btn.small.pl-fav-btn', { type: 'button', onclick: () => toggleFav(current().id) }, glyph('heart'), h('span', 'Favourite'));
    const copyBtn = h('button.btn.small', { type: 'button', onclick: () => copyList(current()) }, glyph('copy'), 'Copy list');
    const moreBtn = h('button.btn.small', { type: 'button', onclick: moreLike }, glyph('wand'), 'More like this');
    const editBtn = h('button.btn.small', { type: 'button', onclick: editCopy }, glyph('edit'), 'Edit a copy');
    const openBtn = h('button.btn.small.pl-open', { type: 'button', onclick: () => openEditor() }, glyph('fit'), h('span', 'Open in editor'));
    const shuffleBtn = h('button.btn.small.pl-shuffle', { type: 'button', 'aria-label': 'Shuffle', onclick: () => { st.seed = (Math.random() * 1e9) | 0; save(); paintNow(); patchPats(); } }, glyph('dice'), h('span.pl-lbl', 'Shuffle'));
    tip(shuffleBtn, 'Paint the mosaic again with the same palette');
    tip(moreBtn, 'Generate a new palette around this one\'s main block');
    tip(editBtn, 'Open a copy of this palette in Make');
    tip(openBtn, 'The big preview: paint blocks by hand, change blocks and shares, try every pattern');
    const preview = h('section.panel.pl-pv', { 'aria-label': 'Preview' },
      h('div.pl-pv-top', h('div.pl-pv-head', pvName, pvSub), openBtn),
      h('div.pl-stage', mosaic),
      h('div.pl-pv-tools', patName, shuffleBtn),
      pats,
      list,
      h('div.pl-pv-acts', favBtn, copyBtn, moreBtn, editBtn));

    const pvOpts = (p) => {
      if (st.mode === 'own' && p.look) { const [W, H] = SIZES[p.look.size] || SIZES[0]; return { pat: p.look.pat, tile: p.look.tile, dir: p.look.dir, seed: p.look.seed, w: p.w, W, H }; }
      const pt = PAT[patId(st.mode)];
      return { pat: pt.id, tile: pt.tile || 1, dir: st.dir, seed: st.seed, w: p.w, W: 32, H: 18 };
    };
    function paintNow() {
      const p = current();
      if (st.mode === 'own' && !p.look) st.mode = 'mix';
      const o = pvOpts(p);
      flash(mosaic);
      paintGrid(mosaic, p.blocks.length ? compose(p.blocks, o, st.mode === 'own' && p.look ? decEdits(p.look.edits) : null) : [], o.W, o.H);
      mosaic.setAttribute('aria-label', 'Sample painted with ' + p.name);
    }
    function patchPats() {
      const p = current();
      const items = (p.look ? [{ id: 'own', name: 'Your layout', tip: 'The layout you saved in the editor' }] : []).concat(PATTERNS);
      if (st.mode === 'own' && !p.look) st.mode = 'mix';
      const cur = st.mode;
      pats.replaceChildren(...items.map((pt) => {
        const cv = h('canvas.pl-pat-cv', { width: 32, height: 18, 'aria-hidden': 'true' });
        const o = pt.id === 'own' ? pvOpts(Object.assign({}, p, {})) : { pat: pt.id, tile: pt.tile || 1, dir: st.dir, seed: st.seed, w: p.w, W: 32, H: 18 };
        if (pt.id === 'own') { const [W, H] = SIZES[p.look.size] || SIZES[0]; Object.assign(o, { pat: p.look.pat, tile: p.look.tile, dir: p.look.dir, seed: p.look.seed, W, H }); }
        drawThumb(cv, p.blocks, o, pt.id === 'own' ? decEdits(p.look.edits) : null);
        const b = h('button.pl-pat' + (cur === pt.id ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(cur === pt.id), 'aria-label': pt.name,
          onclick: () => { st.mode = pt.id; save(); pats.querySelectorAll('.pl-pat').forEach((x) => { const o2 = x === b; x.classList.toggle('on', o2); x.setAttribute('aria-checked', String(o2)); }); patName.textContent = pt.name; paintNow(); } }, cv);
        tip(b, () => [h('div.th-tooltip-title', pt.name), h('div.th-tooltip-sub', pt.tip)]);
        return b;
      }));
      patName.textContent = (items.find((x) => x.id === cur) || PATTERNS[0]).name;
    }
    function patchPreview() {
      const p = current();
      pvName.textContent = p.name;
      pvSub.textContent = p.blocks.length + (p.blocks.length === 1 ? ' block' : ' blocks') + (p.tags && p.tags.length ? ' · ' + p.tags.slice(0, 3).join(', ') : '');
      const pc = pcts(p.blocks, p.w);
      list.replaceChildren(...p.blocks.map((b, i) => h('div.pl-brow', tile(b), h('span.pl-bname', nameOf(b)), h('span.pl-bshare', pc[i] + '%'))));
      const isFav = st.fav.includes(p.id), real = p.id !== 'draft' && p.id !== 'gen';
      favBtn.classList.toggle('on', isFav);
      favBtn.querySelector('span:last-child').textContent = real ? (isFav ? 'Favourited' : 'Favourite') : 'Save';
      favBtn.dataset.mode = real ? 'fav' : 'save';
      editBtn.hidden = p.id === 'draft';
      openBtn.disabled = !p.blocks.length;
      preview.classList.toggle('is-empty', !p.blocks.length);
      patchPats();
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
        const w = p.w && Object.keys(p.w).length ? Object.assign({}, p.w) : undefined;
        st.mine.unshift({ id, name: (nm || '').trim() || 'My palette', blocks: p.blocks.slice(), tags: ['yours'], w });
        save();
        toast('Saved to Yours');
        if (st.tab === 'browse') { st.tag = 'mine'; select(id, true); patchBrowse(); } else { patchPreview(); }
      });
    }
    function copyList(p) {
      const pc = pcts(p.blocks, p.w);
      const text = p.name + '\n' + p.blocks.map((b, i) => nameOf(b) + ' (minecraft:' + b + ') ' + pc[i] + '%').join('\n');
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
      const p = current();
      st.draft = p.blocks.slice(0, MAXB); st.dw = Object.assign({}, p.w || {}); st.sel = 'draft'; setTab('make');
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
      const open = h('button.pl-heart.pl-copen', { type: 'button', 'aria-label': 'Open in editor', onclick: (e) => { e.stopPropagation(); if (st.sel !== p.id) select(p.id, true); openEditor(); } }, glyph('fit'));
      tip(open, 'Open in editor');
      // first click selects (the preview follows), a click on the selected card or a double click opens the editor
      const el = h('div.pl-card' + (st.sel === p.id ? '.on' : ''), { 'data-id': p.id, role: 'button', tabindex: '0', 'aria-label': p.name + ', ' + p.blocks.map(nameOf).join(', '),
        onclick: () => { if (st.sel === p.id && el.classList.contains('on')) openEditor(); else select(p.id); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (st.sel === p.id) openEditor(); else select(p.id); } } },
        h('div.pl-strip', p.blocks.slice(0, 6).map((b) => tile(b))),
        h('div.pl-cap', h('span.pl-cname', p.name), open, heart),
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
    const clearBtn = h('button.btn.small', { type: 'button', onclick: () => { st.draft = []; st.dw = {}; save(); patchMake(); } }, 'Clear');
    const sBtn = h('button.btn.small', { type: 'button', onclick: () => { const run = () => { const D = st.draft; const g = D.length ? generate(D[0], KINDS[Math.floor(rnd() * KINDS.length)]) : surprise(); st.draft = g.blocks.slice(0, MAXB); st.dw = {}; save(); patchMake(); }; if (colReady) run(); else loadColours().then(run); } }, glyph('wand'), 'Fill it for me');
    const mkOpen = h('button.btn.small', { type: 'button', onclick: () => openEditor() }, glyph('fit'), 'Open in editor');
    tip(sBtn, 'Builds a palette around your first block (or a random one)');
    tip(mkOpen, 'Paint with this palette, set shares and try every pattern');
    const make = h('div.pl-main-in',
      h('section.panel.pl-pan.pl-pan-slots', { 'aria-label': 'Your palette' },
        h('div.pl-pan-head', h('h3', 'Your palette'), h('span.pl-count', 'up to ' + MAXB + ' blocks')),
        slots, h('div.pl-make-acts', saveBtn, mkOpen, sBtn, clearBtn)),
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
            tip(h(cls, { type: 'button', 'aria-label': 'Remove ' + nameOf(b), onclick: () => { D.splice(i, 1); delete st.dw[b]; save(); patchMake(); } }, glyph('x')), 'Remove'),
            tip(h(cls, { type: 'button', 'aria-label': 'Move right', disabled: i === D.length - 1, onclick: () => mv(1) }, glyph('right')), 'Move right')));
      }));
      saveBtn.disabled = D.length < 2;
      clearBtn.disabled = !D.length;
      mkOpen.disabled = !D.length;
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

    /* ================= editor ================= */
    let ed = null;   // DOM + patch functions, built the first time the editor opens in this render
    const doc = () => st.ed;
    function newDoc(p) {
      const lk = p.look || null;
      const pat = lk ? lk.pat : patId(st.mode === 'own' ? 'mix' : st.mode);
      return {
        key: Math.random().toString(36).slice(2, 10), src: p.id, sig: p.blocks.join(), from: st.tab,
        name: p.id === 'draft' ? 'Your palette' : p.name, base: p.name, blocks: p.blocks.slice(0, MAXB), w: Object.assign({}, p.w || {}),
        pat, tile: lk ? lk.tile : (PAT[pat].tile || 1), dir: lk ? lk.dir : st.dir, seed: lk ? lk.seed : st.seed, size: lk ? lk.size : 1,
        edits: lk ? lk.edits : null, dirty: false, cur: p.blocks[0], tool: 'brush', brush: 1, zoom: 1,
      };
    }
    function openEditor() {
      const p = current();
      if (!p.blocks.length) return;
      const d = st.ed;
      const same = d && d.src === p.id && (p.id === 'draft' || d.sig === p.blocks.join() || String(p.id).startsWith('m_'));
      const go = () => {
        if (same) {
          d.from = st.tab;
          if (p.id === 'draft') { d.blocks = st.draft.slice(); d.w = Object.assign({}, st.dw); }
        } else st.ed = newDoc(p);
        enterEditor();
      };
      if (d && d.dirty && !same) TH.util.ask({ text: 'Your edits in the editor are not saved. Open this palette anyway?', ok: 'Open', danger: true }).then((y) => { if (y) go(); });
      else go();
    }
    function enterEditor() {
      listScroll = window.scrollY;
      st.view = 'edit'; save();
      showView();
      const top = body.getBoundingClientRect().top + window.scrollY - 90;
      if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    }
    function leaveEditor() {
      const d = doc();
      st.view = 'list';
      if (d) {
        st.tab = d.from === 'make' ? 'make' : 'browse';
        if (String(d.src).startsWith('m_') && st.mine.some((m) => m.id === d.src)) st.sel = d.src;
        if (d.src === 'draft' && st.tab === 'make') st.sel = 'draft';
      }
      save();
      tabsSeg.set(st.tab);
      showView();
      window.scrollTo(0, listScroll);
    }

    function buildEditor() {
      const nameField = h('input.field.pl-ed-name', { type: 'text', 'aria-label': 'Palette name', maxlength: 48, oninput: () => { doc().name = nameField.value; doc().dirty = true; save(); patchHead(); } });
      const sub = h('div.pl-ed-sub');
      const backBtn = h('button.btn.small.pl-back', { type: 'button', onclick: leaveEditor }, glyph('back'), h('span', 'Back to palettes'));
      tip(backBtn, 'Back to the list (Esc)');
      const head = h('div.pl-ed-head', h('div.pl-ed-title', nameField, sub), backBtn);

      /* stage */
      const cv = h('canvas.pl-ed-cv', { role: 'img', 'aria-label': 'Editor canvas' });
      const cursor = h('div.pl-ed-cursor', { 'aria-hidden': 'true' });
      const wrap = h('div.pl-ed-wrap', cv, cursor);
      const viewEl = h('div.pl-ed-view', wrap);
      const toolSeg = seg('Tool', [
        ['brush', [glyph('brush'), h('span', 'Brush')], 'Paint cells (B)'],
        ['fill', [glyph('fill'), h('span', 'Fill')], 'Fill the connected area of one block (F)'],
        ['replace', [glyph('replace'), h('span', 'Replace')], 'Click a block: every cell of it becomes the selected block (R)'],
        ['pick', [glyph('pick'), h('span', 'Pick')], 'Take the block under the cursor (I)'],
        ['erase', [glyph('erase'), h('span', 'Eraser')], 'Back to the generated pattern (E)'],
      ], 'brush', (t) => { doc().tool = t; save(); patchTools(); });
      toolSeg.classList.add('pl-ed-tools');
      const brushSeg = seg('Brush size', [[1, '1'], [2, '2'], [3, '3']], 1, (b) => { doc().brush = b; save(); patchTools(); });
      brushSeg.classList.add('pl-ed-brush');
      tip(brushSeg, 'Brush size in blocks');
      const undoBtn = iconBtn('undo', 'Undo (Ctrl+Z)', () => undo());
      const redoBtn = iconBtn('redo', 'Redo (Ctrl+Y)', () => redo());
      const bar1 = h('div.pl-ed-bar', toolSeg, brushSeg, h('div.pl-ed-sp'), undoBtn, redoBtn);
      const blockBar = h('div.pl-ed-blocks', { role: 'radiogroup', 'aria-label': 'Paint with' });
      const sizeSeg = seg('Canvas size', SIZES.map(([w, hh], i) => [i, w + ' x ' + hh]), 1, (i) => { pushUndo(); doc().size = i; doc().dirty = true; save(); sizeSeg.set(i); fullPaint(true); patchCounts(); });
      tip(sizeSeg, 'How many blocks the canvas holds');
      const zoomTxt = h('span.pl-ed-zoom');
      const zoom = (z) => { doc().zoom = clamp(z, 1, 4); save(); patchZoom(); };
      const fitBtn = iconBtn('fit', 'Fit', () => zoom(1));
      const zOut = iconBtn('minus', 'Zoom out', () => zoom(doc().zoom / 1.5 < 1.05 ? 1 : doc().zoom / 1.5));
      const zIn = iconBtn('plus', 'Zoom in', () => zoom(doc().zoom * 1.5));
      const editsTxt = h('span.pl-ed-count');
      const resetBtn = h('button.btn.small', { type: 'button', onclick: () => { if (!E.edits.size) return; pushUndo(); E.edits.clear(); commitEdits(); fullPaint(false); } }, 'Reset edits');
      const bakeBtn = h('button.btn.small', { type: 'button', onclick: bake }, 'Bake');
      const clearBtn2 = h('button.btn.small', { type: 'button', onclick: clearAll }, 'Clear');
      tip(resetBtn, 'Remove everything you painted, the pattern shows again');
      tip(bakeBtn, 'Turn the whole pattern into painted cells, so a new pattern or Shuffle no longer changes it');
      tip(clearBtn2, 'Cover the canvas with the selected block, to paint from scratch');
      const bar2 = h('div.pl-ed-bar.pl-ed-bar2', sizeSeg, h('div.pl-ed-zoomgrp', zOut, zoomTxt, zIn, fitBtn), h('div.pl-ed-sp'), editsTxt, resetBtn, bakeBtn, clearBtn2);
      const stagePan = h('section.panel.pl-ed-stagepan', { 'aria-label': 'Editor' }, bar1, h('div.pl-stage.pl-ed-stage', viewEl), blockBar, bar2);

      /* side: blocks */
      const rows = h('div.pl-ed-rows');
      const addBtn = h('button.btn.small', { type: 'button', onclick: () => openPicker('add') }, glyph('plus'), 'Add block');
      const sortBtn = h('button.btn.small', { type: 'button', onclick: sortLight }, glyph('sort'), 'Light to dark');
      const evenBtn = h('button.btn.small', { type: 'button', onclick: () => { pushUndo(); doc().w = {}; changed(); } }, 'Reset shares');
      tip(sortBtn, 'Order the blocks from light to dark (the order sets the roles: first = main)');
      tip(evenBtn, 'Back to the usual shares by position');
      const bCount = h('span.pl-count');
      const picker = h('div.pl-ed-picker', { hidden: true });
      const blocksPan = h('section.panel.pl-pan.pl-ed-pan', { 'aria-label': 'Blocks' },
        h('div.pl-pan-head', h('h3', 'Blocks'), bCount),
        h('p.pl-hint.pl-ed-hint', 'The order sets the roles: the first block is the main one, the last one trims plinths and borders.'),
        rows, h('div.pl-make-acts', addBtn, sortBtn, evenBtn), picker);

      /* side: pattern */
      const patGrid = h('div.pl-ed-pats');
      const tileSeg = seg('Tile size', [[1, '1 x 1'], [2, '2 x 2'], [3, '3 x 3']], 1, (t) => { pushUndo(); doc().tile = t; changed(true); });
      const dirSeg = seg('Direction', [['v', 'Vertical'], ['h', 'Horizontal'], ['d', 'Diagonal']], 'v', (v) => { pushUndo(); doc().dir = v; changed(true); });
      const tileRow = h('div.pl-ed-opt', h('span.pl-ed-optl', 'Tile size'), tileSeg);
      const dirRow = h('div.pl-ed-opt', h('span.pl-ed-optl', 'Direction'), dirSeg);
      const shBtn = h('button.btn.small', { type: 'button', onclick: () => { pushUndo(); doc().seed = (Math.random() * 1e9) | 0; changed(true); } }, glyph('dice'), 'Shuffle');
      tip(shBtn, 'Roll the pattern again (your painted cells stay)');
      const patPan = h('section.panel.pl-pan.pl-ed-pan', { 'aria-label': 'Pattern' },
        h('div.pl-pan-head', h('h3', 'Pattern'), h('span.pl-count.pl-ed-patname'), shBtn), patGrid, tileRow, dirRow);

      /* side: save */
      const saveBtn2 = h('button.btn.small.primary', { type: 'button', onclick: () => edSave(false) }, glyph('save'), h('span', 'Save'));
      const saveNew = h('button.btn.small', { type: 'button', onclick: () => edSave(true) }, 'Save as new');
      const copyBtn2 = h('button.btn.small', { type: 'button', onclick: () => copyList({ name: doc().name, blocks: doc().blocks, w: doc().w }) }, glyph('copy'), 'Copy list');
      const pngBtn = h('button.btn.small', { type: 'button', onclick: () => png(false) }, glyph('image'), 'PNG');
      const imgBtn = h('button.btn.small', { type: 'button', onclick: () => png(true) }, glyph('copy'), 'Copy image');
      tip(saveNew, 'Keep this one as a separate palette in Yours');
      tip(pngBtn, 'Download the canvas as a picture');
      tip(imgBtn, 'Copy the canvas as a picture');
      if (window.TH_LOCAL_ASSETS) pngBtn.hidden = true;   // the artifact page cannot download files
      const acts = h('div.pl-ed-acts', saveBtn2, saveNew, copyBtn2, pngBtn, imgBtn);

      const side = h('div.pl-ed-side', head, blocksPan, patPan, acts);
      const el = h('div.pl-ed', h('div.pl-ed-main', stagePan), side);

      /* ---- state helpers ---- */
      const dims = () => SIZES[doc().size] || SIZES[1];
      const opts = () => { const d = doc(), [W, H] = dims(); return { pat: d.pat, tile: d.tile, dir: d.dir, seed: d.seed, w: d.w, W, H }; };
      let lay = null;
      const gen = (x, y) => doc().blocks[lay[y * dims()[0] + x]];
      const finalAt = (x, y) => { const e = E.edits.get(y * MAXW + x); return e && doc().blocks.includes(e) ? e : gen(x, y); };
      function syncDraft() { const d = doc(); if (d.src === 'draft') { st.draft = d.blocks.slice(); st.dw = Object.assign({}, d.w); } }
      function loadDoc() {
        const d = doc();
        if (E.key !== d.key) { E.key = d.key; E.edits = decEdits(d.edits); E.undo = []; E.redo = []; }
        if (!d.blocks.includes(d.cur)) d.cur = d.blocks[0];
        if (!PAT[d.pat]) d.pat = patId(d.pat);
      }
      function snap() { const d = doc(); return { blocks: d.blocks.slice(), w: Object.assign({}, d.w), pat: d.pat, tile: d.tile, dir: d.dir, seed: d.seed, size: d.size, edits: new Map(E.edits) }; }
      function restore(s) { const d = doc(); Object.assign(d, { blocks: s.blocks, w: s.w, pat: s.pat, tile: s.tile, dir: s.dir, seed: s.seed, size: s.size }); E.edits = s.edits; d.edits = encEdits(E.edits); d.dirty = true; syncDraft(); save(); patchAll(true); }
      function pushUndo(s) { E.undo.push(s || snap()); if (E.undo.length > 80) E.undo.shift(); E.redo = []; patchUndo(); }
      function undo() { if (!E.undo.length) return; E.redo.push(snap()); restore(E.undo.pop()); }
      function redo() { if (!E.redo.length) return; E.undo.push(snap()); restore(E.redo.pop()); }
      function commitEdits() { const d = doc(); d.edits = encEdits(E.edits); d.dirty = true; save(); patchCounts(); patchHead(); }
      /** Something about the palette or the pattern changed: repaint everything visibly (with the flash). */
      function changed(patternOnly) { const d = doc(); d.dirty = true; syncDraft(); save(); if (patternOnly) { patchPattern(); fullPaint(true); patchHead(); } else patchAll(true); }

      /* ---- painting ---- */
      let paintTok = 0;
      async function fullPaint(fl) {
        const d = doc(), [W, H] = dims(), tok = ++paintTok;
        lay = layout(d.blocks, opts());
        await Promise.all(d.blocks.map(loadImg));
        if (tok !== paintTok || !cv.isConnected && el.isConnected) return;
        if (cv.width !== W * CP || cv.height !== H * CP) { cv.width = W * CP; cv.height = H * CP; }
        wrap.style.setProperty('--ar', W + ' / ' + H);
        const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawTex(cx, ready.get(finalAt(x, y)), x, y, CP);
        if (fl) flash(cv);
      }
      function drawCell(x, y) { const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false; drawTex(cx, ready.get(finalAt(x, y)), x, y, CP); }
      function cellAt(e) {
        const r = cv.getBoundingClientRect(), [W, H] = dims();
        if (!r.width) return null;
        const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
        return x < 0 || y < 0 || x >= W || y >= H ? null : [x, y];
      }
      function foot(x, y) {
        const s = (doc().tool === 'brush' || doc().tool === 'erase') ? doc().brush : 1, o = Math.floor((s - 1) / 2), [W, H] = dims(), out = [];
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const a = x - o + i, b = y - o + j; if (a >= 0 && b >= 0 && a < W && b < H) out.push([a, b]); }
        return out;
      }
      function dab(x, y, stroke) {
        const d = doc();
        foot(x, y).forEach(([a, b]) => {
          const k = b * MAXW + a, had = E.edits.get(k);
          if (d.tool === 'erase') { if (had === undefined) return; if (!stroke.changed) { pushUndo(stroke.snap); stroke.changed = true; } E.edits.delete(k); }
          else { if (had === d.cur) return; if (!stroke.changed) { pushUndo(stroke.snap); stroke.changed = true; } E.edits.set(k, d.cur); }
          drawCell(a, b);
        });
      }
      function line(a, b, fn) {   // Bresenham, so a fast drag leaves no gaps
        let [x0, y0] = a; const [x1, y1] = b, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (;;) { fn(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      }
      function flood(x, y) {
        const d = doc(), [W, H] = dims(), A = finalAt(x, y);
        if (A === d.cur) return;
        pushUndo();
        const seen = new Uint8Array(W * H), q = [[x, y]]; seen[y * W + x] = 1;
        while (q.length) {
          const [a, b] = q.pop();
          E.edits.set(b * MAXW + a, d.cur);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([i, j]) => { const u = a + i, v = b + j; if (u >= 0 && v >= 0 && u < W && v < H && !seen[v * W + u] && finalAt(u, v) === A) { seen[v * W + u] = 1; q.push([u, v]); } });
        }
        commitEdits(); fullPaint(false);
      }
      function replaceAll(x, y) {
        const d = doc(), [W, H] = dims(), A = finalAt(x, y);
        if (A === d.cur) return;
        pushUndo();
        for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) if (finalAt(a, b) === A) E.edits.set(b * MAXW + a, d.cur);
        commitEdits(); fullPaint(false);
      }
      function bake() {
        const [W, H] = dims();
        pushUndo();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) E.edits.set(y * MAXW + x, finalAt(x, y));
        commitEdits(); toast('The pattern is now painted in');
      }
      function clearAll() {
        const [W, H] = dims(), d = doc();
        pushUndo();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) E.edits.set(y * MAXW + x, d.cur);
        commitEdits(); fullPaint(false);
      }
      let stroke = null;
      cv.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const c = cellAt(e); if (!c) return;
        e.preventDefault();
        const d = doc();
        if (d.tool === 'fill') return flood(c[0], c[1]);
        if (d.tool === 'replace') return replaceAll(c[0], c[1]);
        if (d.tool === 'pick') { d.cur = finalAt(c[0], c[1]); d.tool = 'brush'; save(); patchBlockBar(); patchTools(); return; }
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
        stroke = { last: c, changed: false, snap: snap() };
        dab(c[0], c[1], stroke);
      });
      cv.addEventListener('pointermove', (e) => {
        const c = cellAt(e);
        moveCursor(c, e.pointerType);
        if (!stroke || !c) return;
        line(stroke.last, c, (x, y) => dab(x, y, stroke));
        stroke.last = c;
      });
      const end = () => { if (stroke && stroke.changed) commitEdits(); stroke = null; };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { cursor.style.opacity = '0'; });
      function moveCursor(c, type) {
        if (!c || type === 'touch') { cursor.style.opacity = '0'; return; }
        const [W, H] = dims(), f = foot(c[0], c[1]);
        if (!f.length) return;
        const x0 = Math.min(...f.map((p) => p[0])), y0 = Math.min(...f.map((p) => p[1])), x1 = Math.max(...f.map((p) => p[0])), y1 = Math.max(...f.map((p) => p[1]));
        Object.assign(cursor.style, { left: (x0 / W * 100) + '%', top: (y0 / H * 100) + '%', width: ((x1 - x0 + 1) / W * 100) + '%', height: ((y1 - y0 + 1) / H * 100) + '%', opacity: '1' });
      }

      /* ---- palette changes ---- */
      function setCur(b) { doc().cur = b; save(); patchBlockBar(); patchRows(); }
      function move(i, dd) {
        const B = doc().blocks, j = i + dd; if (j < 0 || j >= B.length) return;
        pushUndo(); [B[i], B[j]] = [B[j], B[i]]; changed();
        const btn = rows.children[j] && rows.children[j].querySelector(dd < 0 ? '.pl-mv-up' : '.pl-mv-dn');
        if (btn && !btn.disabled) btn.focus({ preventScroll: true });
      }
      function removeAt(i) {
        const d = doc(), b = d.blocks[i];
        if (d.blocks.length <= 1) { toast('A palette needs at least one block'); return; }
        pushUndo(); d.blocks.splice(i, 1); delete d.w[b];
        E.edits.forEach((v, k) => { if (v === b) E.edits.delete(k); });
        d.edits = encEdits(E.edits);
        changed();
      }
      function swapBlock(i, nb) {
        const d = doc(), old = d.blocks[i];
        if (old === nb) return;
        pushUndo();
        const at = d.blocks.indexOf(nb);
        if (at >= 0) { d.blocks.splice(i, 1); } else { d.blocks[i] = nb; if (d.w[old]) d.w[nb] = d.w[old]; }
        delete d.w[old];
        E.edits.forEach((v, k) => { if (v === old) E.edits.set(k, nb); });
        d.edits = encEdits(E.edits);
        if (d.cur === old) d.cur = nb;
        changed();
        toast(nameOf(old) + ' → ' + nameOf(nb));
      }
      function addTo(nb) {
        const d = doc();
        if (d.blocks.includes(nb)) { setCur(nb); return; }
        if (d.blocks.length >= MAXB) { toast('A palette holds up to ' + MAXB + ' blocks'); return; }
        pushUndo(); d.blocks.push(nb); d.cur = nb; changed();
      }
      function sortLight() {
        const d = doc();
        if (!colReady) { loadColours().then(sortLight); return; }
        pushUndo();
        d.blocks.sort((a, b) => ((col.get(b) || { L: 0 }).L - (col.get(a) || { L: 0 }).L));
        changed();
      }
      let wDrag = null;
      function setWeight(b, v) {
        const d = doc();
        if (!wDrag) { pushUndo(); wDrag = true; }
        // the first touch of a slider fixes every block's weight, so the others keep their share
        d.blocks.forEach((x, i) => { if (!(d.w[x] > 0)) d.w[x] = wOf(d.w, x, i); });
        d.w[b] = v; d.dirty = true; syncDraft();
        patchShares();
        if (!wRaf) wRaf = setTimeout(() => { wRaf = 0; fullPaint(false); patchPattern(); }, 40);
      }
      let wRaf = 0;

      /* ---- picker (add / swap) ---- */
      let pickMode = null;   // { kind: 'add' } | { kind: 'swap', i }
      const pkSearch = h('input.field.pl-search', { type: 'search', placeholder: 'Find a block', 'aria-label': 'Search blocks', oninput: () => patchPickGrid() });
      const pkTitle = h('b.pl-ed-pktitle');
      const pkClose = h('button.btn.small', { type: 'button', onclick: () => closePicker() }, 'Done');
      const pkNear = h('div.pl-srow');
      const pkGrid = h('div.pl-pick.pl-ed-pick');
      picker.append(h('div.pl-ed-pkhead', pkTitle, pkClose), pkSearch, pkNear, pkGrid);
      function openPicker(kind, i) {
        pickMode = { kind, i };
        const d = doc();
        pkTitle.textContent = kind === 'swap' ? 'Swap ' + nameOf(d.blocks[i]) + ' for' : 'Add a block';
        picker.hidden = false; pkSearch.value = '';
        patchPickGrid();
        picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        pkSearch.focus({ preventScroll: true });
      }
      function closePicker() { pickMode = null; picker.hidden = true; }
      function pickTile(b) {
        const d = doc(), on = d.blocks.includes(b);
        const e = h('button.pl-add' + (on ? '.on' : ''), { type: 'button', 'aria-label': nameOf(b), onclick: () => {
          if (!pickMode) return;
          if (pickMode.kind === 'swap') { swapBlock(pickMode.i, b); closePicker(); } else { addTo(b); patchPickGrid(); }
        } }, tile(b));
        tip(e, () => nameOf(b));
        return e;
      }
      function patchPickGrid() {
        if (!pickMode) return;
        const q = pkSearch.value.trim().toLowerCase(), d = doc();
        const list = blocks().filter((b) => !q || nameOf(b).toLowerCase().includes(q));
        pkGrid.replaceChildren(...(list.length ? list.map(pickTile) : [h('p.pl-none', 'No block matches.')]));
        const ref = pickMode.kind === 'swap' ? [d.blocks[pickMode.i]] : d.blocks;
        const m = colReady && !q ? mean(ref) : null;
        if (m) {
          const near = sortBy(pool(d.blocks), (c) => dist(c, m)).slice(0, 12);
          pkNear.replaceChildren(h('div.pl-stitle', h('b', pickMode.kind === 'swap' ? 'Close in colour' : 'Goes well with it')), h('div.pl-row', near.map(pickTile)));
          pkNear.hidden = false;
        } else pkNear.hidden = true;
      }

      /* ---- patches ---- */
      function patchHead() {
        const d = doc(), mine = String(d.src).startsWith('m_') && st.mine.some((m) => m.id === d.src);
        if (document.activeElement !== nameField) nameField.value = d.name;
        sub.replaceChildren(...[
          mine ? h('span', 'Saved in Yours') : d.src === 'draft' ? h('span', 'From Make') : h('span', 'A copy of ' + d.base),
          d.dirty ? h('span.pl-ed-dirty', 'Unsaved changes') : null].filter(Boolean));
        saveBtn2.querySelector('span:last-child').textContent = mine ? 'Save' : 'Save to Yours';
        saveNew.hidden = !mine;
      }
      function patchTools() {
        const d = doc();
        toolSeg.set(d.tool); brushSeg.set(d.brush);
        brushSeg.classList.toggle('is-off', !(d.tool === 'brush' || d.tool === 'erase'));
        el.dataset.tool = d.tool;
      }
      function patchUndo() { undoBtn.disabled = !E.undo.length; redoBtn.disabled = !E.redo.length; }
      function patchCounts() {
        const [W, H] = dims(); let k = 0;
        E.edits.forEach((v, key) => { if (key % MAXW < W && Math.floor(key / MAXW) < H && doc().blocks.includes(v)) k++; });
        editsTxt.textContent = k ? k + ' painted' : 'Nothing painted';
        resetBtn.disabled = !k;
        patchUndo();
      }
      function patchZoom() {
        const z = doc().zoom;
        wrap.style.setProperty('--z', z);
        viewEl.classList.toggle('is-zoomed', z > 1);
        zoomTxt.textContent = Math.round(z * 100) + '%';
        zOut.disabled = z <= 1; fitBtn.disabled = z <= 1; zIn.disabled = z >= 4;
      }
      function patchBlockBar() {
        const d = doc();
        blockBar.replaceChildren(...d.blocks.map((b, i) => {
          const on = d.cur === b;
          const e = h('button.pl-ed-bt' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': nameOf(b), onclick: () => setCur(b) }, tile(b));
          tip(e, () => [h('div.th-tooltip-title', nameOf(b)), h('div.th-tooltip-sub', 'Key ' + (i + 1))]);
          return e;
        }), ...(d.blocks.length < MAXB ? [tip(h('button.pl-ed-bt.pl-ed-bt-add', { type: 'button', 'aria-label': 'Add block', onclick: () => openPicker('add') }, glyph('plus')), 'Add a block')] : []));
      }
      function patchShares() {
        const d = doc(), pc = pcts(d.blocks, d.w);
        [...rows.children].forEach((r, i) => { const s = r.querySelector('.pl-ed-share'); if (s) s.textContent = pc[i] + '%'; const rg = r.querySelector('input'); if (rg && document.activeElement !== rg) rg.value = String(wOf(d.w, d.blocks[i], i)); });
      }
      function patchRows() {
        const d = doc(), pc = pcts(d.blocks, d.w), n = d.blocks.length;
        bCount.textContent = n + ' / ' + MAXB;
        rows.replaceChildren(...d.blocks.map((b, i) => {
          const role = i === 0 ? 'Main' : n > 2 && i === n - 1 ? 'Trim' : i === 1 ? 'Second' : i === 2 ? 'Accent' : 'Detail';
          const rg = h('input.pl-ed-range', { type: 'range', min: 1, max: 100, step: 1, value: String(wOf(d.w, b, i)), 'aria-label': 'Share of ' + nameOf(b),
            oninput: () => setWeight(b, +rg.value), onchange: () => { wDrag = null; save(); patchHead(); } });
          const pickB = h('button.pl-ed-rt' + (d.cur === b ? '.on' : ''), { type: 'button', 'aria-label': 'Paint with ' + nameOf(b), onclick: () => setCur(b) }, tile(b));
          tip(pickB, 'Paint with it');
          return h('div.pl-ed-row',
            pickB,
            h('div.pl-ed-rmid',
              h('div.pl-ed-rname', h('span.pl-bname', nameOf(b)), h('span.pl-ed-role', role), h('span.pl-ed-share', pc[i] + '%')),
              rg),
            h('div.pl-ed-racts',
              iconBtn('up', 'Move up', () => move(i, -1), '.pl-mv-up'),
              iconBtn('down', 'Move down', () => move(i, 1), '.pl-mv-dn'),
              iconBtn('swap', 'Swap for another block', () => openPicker('swap', i)),
              iconBtn('x', 'Remove', () => removeAt(i))));
        }));
        rows.querySelectorAll('.pl-mv-up')[0].disabled = true;
        const dn = rows.querySelectorAll('.pl-mv-dn'); dn[dn.length - 1].disabled = true;
        addBtn.disabled = n >= MAXB;
      }
      function patchPattern() {
        const d = doc(), pt = PAT[d.pat] || PATTERNS[0];
        el.querySelector('.pl-ed-patname').textContent = pt.name;
        const groupsP = ['Textures', 'Floors', 'Walls'];
        if (!patGrid.childElementCount) {
          patGrid.append(...groupsP.map((g) => h('div.pl-ed-pgrp', h('div.pl-stitle', h('b', g)),
            h('div.pl-ed-pgrid', { role: 'radiogroup', 'aria-label': g }, PATTERNS.filter((p) => p.grp === g).map((p) => {
              const b = h('button.pl-pat.pl-pat-big', { type: 'button', role: 'radio', 'data-pat': p.id, onclick: () => {
                if (doc().pat === p.id) return;
                pushUndo(); doc().pat = p.id; if (p.tile) doc().tile = p.tile; changed(true);
              } }, h('canvas.pl-pat-cv', { width: 32, height: 18, 'aria-hidden': 'true' }), h('span.pl-pat-l', p.name));
              tip(b, p.tip);
              return b;
            })))));
        }
        patGrid.querySelectorAll('.pl-pat').forEach((b) => {
          const p = PAT[b.dataset.pat], on = p.id === d.pat;
          b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
          drawThumb(b.querySelector('canvas'), d.blocks, { pat: p.id, tile: on ? d.tile : (p.tile || 1), dir: d.dir, seed: d.seed, w: d.w, W: 32, H: 18 });
        });
        tileSeg.set(d.tile); dirSeg.set(d.dir);
        tileRow.hidden = !pt.tile; dirRow.hidden = !pt.dir;
      }
      function patchAll(fl) {
        loadDoc();
        patchHead(); patchTools(); patchBlockBar(); patchRows(); patchPattern(); patchZoom(); patchCounts();
        sizeSeg.set(doc().size);
        if (pickMode) patchPickGrid();
        fullPaint(fl);
        tintEd();
      }
      function tintEd() {
        const cs = doc().blocks.map((b) => col.get(b)).filter(Boolean), k = cs.length;
        if (!k) return;
        const c = [0, 1, 2].map((j) => Math.round(cs.reduce((a, x) => a + x.rgb[j], 0) / k));
        el.style.setProperty('--pc', `rgb(${c[0]} ${c[1]} ${c[2]})`);
      }

      /* ---- save / export ---- */
      function edSave(asNew) {
        const d = doc();
        const look = { pat: d.pat, tile: d.tile, dir: d.dir, seed: d.seed, size: d.size, edits: encEdits(E.edits) };
        const nm = (nameField.value || '').trim() || d.name || 'My palette';
        const m = !asNew && String(d.src).startsWith('m_') ? st.mine.find((x) => x.id === d.src) : null;
        const w = Object.keys(d.w).length ? Object.assign({}, d.w) : undefined;
        if (m) Object.assign(m, { name: nm, blocks: d.blocks.slice(), w, look });
        else {
          const id = 'm_' + Math.random().toString(36).slice(2, 8);
          st.mine.unshift({ id, name: nm, blocks: d.blocks.slice(), tags: ['yours'], w, look });
          d.src = id;
        }
        d.name = nm; d.base = nm; d.sig = d.blocks.join(); d.dirty = false;
        st.sel = d.src; st.mode = 'own';
        save(); patchHead();
        toast(m ? 'Saved' : 'Saved to Yours');
      }
      function png(copy) {
        let ok = true;
        try { cv.toBlob((blob) => {
          if (!blob) { toast('This picture cannot be saved here'); return; }
          if (copy) {
            try { navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => toast('Copied the picture'), () => toast('Copying pictures is blocked here')); }
            catch (e) { toast('Copying pictures is blocked here'); }
            return;
          }
          const a = h('a', { href: URL.createObjectURL(blob), download: (doc().name || 'palette').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png' });
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        }, 'image/png'); } catch (e) { ok = false; }
        if (!ok) toast('This picture cannot be saved here');
      }

      /* ---- keys ---- */
      function onKey(e) {
        if (st.view !== 'edit' || !el.isConnected) return false;
        if (document.querySelector('.th-ask')) return false;
        const t = e.target, typing = t && (t.tagName === 'INPUT' && !/range|button|checkbox|radio/.test(t.type) || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (e.key === 'Escape') {
          if (pickMode) { closePicker(); e.preventDefault(); return true; }
          if (typing) { t.blur(); return true; }
          e.preventDefault(); leaveEditor(); return true;
        }
        if (typing) return false;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return true; }
        if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return true; }
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        const tools = { b: 'brush', f: 'fill', r: 'replace', i: 'pick', e: 'erase' };
        if (tools[k]) { doc().tool = tools[k]; save(); patchTools(); return true; }
        if (/^[1-8]$/.test(k) && doc().blocks[+k - 1]) { setCur(doc().blocks[+k - 1]); return true; }
        return false;
      }

      return { el, patchAll, onKey, onColours: () => { patchPattern(); tintEd(); if (pickMode) patchPickGrid(); } };
    }

    /* ----- shell ----- */
    const main = h('div.pl-main');
    const tabsSeg = seg('Palettes section', [['browse', 'Browse'], ['make', 'Make']], st.tab, (t) => setTab(t));
    const tabs = h('div.pl-tabs', tabsSeg);
    const listView = h('div.pl-layout', main, h('div.pl-side', preview));
    const body = h('div.pl-body');
    function setTab(t) {
      st.tab = t; save();
      tabsSeg.set(t);
      if (st.view === 'edit') { st.view = 'list'; save(); showView(); }
      if (t === 'make') { main.replaceChildren(make); if (st.sel !== 'draft') { st.sel = 'draft'; save(); } patchMake(); }
      else { if (st.sel === 'draft') { st.sel = (curated()[0] || {}).id; save(); } main.replaceChildren(browse); patchBrowse(); patchPreview(); }
    }
    function showView() {
      const editing = st.view === 'edit' && st.ed;
      root.classList.toggle('pl-editing', !!editing);
      let next;
      if (editing) { if (!ed) ed = buildEditor(); next = ed.el; ed.patchAll(false); }
      else {
        next = listView;
        if (st.tab === 'make') { main.replaceChildren(make); patchMake(); } else { main.replaceChildren(browse); patchBrowse(); patchPreview(); }
      }
      if (body.firstChild === next) return;
      body.replaceChildren(next);
      if (root.isConnected) { next.classList.remove('pl-in'); void next.offsetWidth; next.classList.add('pl-in'); }
    }
    root.append(h('div.page-head.pl-head', h('h2', 'Block Palettes'), tabs), body);
    if (st.view === 'edit') showView();
    else { body.append(listView); setTab(st.tab); }

    const onKey = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (ed && ed.onKey(e)) e.stopPropagation();
    };
    document.addEventListener('keydown', onKey);
    // colours finished (first visit): tint, and fill the suggestions
    const onReady = () => {
      if (!root.isConnected) { colWaiters.delete(onReady); return; }   // the module was left before the colours arrived
      tintPreview();
      patchPats();
      if (st.view !== 'edit' && st.tab === 'make') patchMake();
      if (ed) ed.onColours();
    };
    colWaiters.add(onReady);
    if (colReady) setTimeout(onReady, 0);
  }

  TH.palettes = { col, suggestions, generate, layout, compose, PATTERNS, encEdits, decEdits };   // for the console and tests
  TH.app.register({
    id: 'palettes',
    name: 'Block Palettes',
    short: 'Palette',
    icon: () => h('span.pl-navico', ['block/cherry_planks', 'block/stone_bricks', 'block/bricks', 'block/oak_planks'].map((t) => h('i', { style: { backgroundImage: 'url("' + TH.icon.tex(t) + '")' } }))),
    init(store) {
      store.define('palettes', { tab: 'browse', view: 'list', sel: 'c0', mode: 'mix', seed: 7, dir: 'v', tag: 'all', q: '', fav: [], mine: [], draft: [], dw: {}, gen: null, ed: null });
      const s = store.get().palettes;
      ['fav', 'mine', 'draft'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
    },
    render,
  });
})();
