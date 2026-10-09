/**
 * Hall canvas — an infinite, zoomable layout editor for the villager tiles (js/modules/hall.js feeds it data).
 *
 * World space is in px at zoom 1. A tile is 72x72, the grid unit G is 80. `.hc-world` carries one
 * `translate3d(pan) scale(zoom)` transform; every tile sits in it with `translate: x y`.
 * While a gesture runs we only touch transforms / classes (rAF-throttled); the store is written ONCE, on
 * pointerup, through opts.onChange. All hit-testing uses our own position map, never the DOM.
 *
 *   const api = TH.hallCanvas.mount(holder, { onChange({pos, sel, view}), onNotify(msg) });
 *   api.update({ items, selected, pos, view })   items: [{ key, status, sig, label, color, pinned, tip: {title, sub}, body() }]
 *   opts.onPin(keys): the P key asks the host to toggle "pin position" (pinned tiles never move; the host owns the set)
 *   api.reveal(key, { pulse })   api.swap(a, b) -> bool   api.busy()   api.el
 *   TH.hallCanvas.autoPlace(keys, pos) -> { key: {x, y} }  (spots for tiles without a position)
 *   TH.hallCanvas.shapePlace(keys, shapeName, pos) -> same, filling a named starting layout (SHAPES) first
 */
window.TH = window.TH || {};

TH.hallCanvas = (function () {
  /** The page runs under CSS zoom: pointer and rect values are in screen px, the canvas maths in CSS px. */
  const ZF = () => parseFloat(document.documentElement.style.zoom) || 1;
  const scaledRect = (el) => { const r = el.getBoundingClientRect(), z = ZF(); return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z }; };
  const { h, clamp, debounce } = TH.util;

  const TILE = 72, G = 80;
  const ZMIN = 0.25, ZMAX = 3;
  const SLOP = 4, HOLD_MS = 350, EDGE = 32, GUIDE_PX = 6;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const snapG = (v) => Math.round(v / G) * G;
  const clonePos = (p) => { const o = {}; for (const k in p) o[k] = { x: p[k].x, y: p[k].y }; return o; };
  const hit = (ax, ay, bx, by) => Math.abs(ax - bx) < TILE - 0.01 && Math.abs(ay - by) < TILE - 0.01;

  /* ---------- pure layout helpers ---------- */

  /** Nearest free, grid-snapped spot to (x, y) for `key` (everything else in `pos` is an obstacle). */
  function freeSpot(pos, key, x, y) {
    const others = [];
    for (const k in pos) if (k !== key) others.push(pos[k]);
    const free = (cx, cy) => !others.some((o) => hit(cx, cy, o.x, o.y));
    const bx = snapG(x), by = snapG(y);
    for (const R of [8, 24, 60]) {
      const cands = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const cx = bx + i * G, cy = by + j * G;
        cands.push({ cx, cy, d: (cx - x) * (cx - x) + (cy - y) * (cy - y) });
      }
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands) if (free(c.cx, c.cy)) return { x: c.cx, y: c.cy };
    }
    return { x: bx, y: by };
  }

  /** Spots for tiles that have none: row-major from the last occupied row (fills the end of that row, then wraps below). */
  function autoPlace(keys, pos) {
    const have = Object.values(pos || {});
    const out = {};
    if (!keys.length) return out;
    let minC = 0, cols = 12, startRow = 0;
    if (have.length) {
      const c0 = Math.min(...have.map((p) => Math.round(p.x / G)));
      const c1 = Math.max(...have.map((p) => Math.round(p.x / G)));
      minC = c0; cols = clamp(c1 - c0 + 1, 6, 16);
      startRow = Math.round(Math.max(...have.map((p) => p.y)) / G);
    }
    const taken = have.slice();
    const isFree = (x, y) => !taken.some((o) => hit(x, y, o.x, o.y));
    let r = startRow, c = 0;
    for (const k of keys) {
      for (let guard = 0; guard < 5000; guard++) {
        const x = (minC + c) * G, y = r * G;
        c++; if (c >= cols) { c = 0; r++; }
        if (isFree(x, y)) { out[k] = { x, y }; taken.push(out[k]); break; }
      }
    }
    return out;
  }

  /**
   * Named starting layouts as [col, row] cells on the 80px grid, in fill order. `wings` (the Essentials preset):
   * two mirrored wings around a centre corridor (col 5 stays free between the inner columns, row 4 between the halves).
   * Each wing quarter = an outer row of 4 (cols 0-3 / 7-10), two tiles stacked in the inner column next to the corridor
   * (col 4 / col 6), and another outer row of 4: 4 quarters x 10 = 40 tiles.
   */
  const SHAPES = (() => {
    const quarter = (outer, inner, r0) => [
      ...outer.map((c) => [c, r0]), [inner, r0 + 1], [inner, r0 + 2], ...outer.map((c) => [c, r0 + 3])];
    const L = [0, 1, 2, 3], R = [7, 8, 9, 10];
    return { wings: [...quarter(L, 4, 0), ...quarter(R, 6, 0), ...quarter(L, 4, 5), ...quarter(R, 6, 5)] };
  })();

  /** Spots for tiles without one, filling the free cells of a named shape first (in its order), the rest via autoPlace. */
  function shapePlace(keys, shape, pos) {
    const cells = SHAPES[shape];
    if (!cells) return autoPlace(keys, pos);
    const taken = Object.values(pos || {}).slice();
    const out = {};
    let ci = 0;
    const rest = [];
    for (const k of keys) {
      let spot = null;
      while (ci < cells.length && !spot) {
        const x = cells[ci][0] * G, y = cells[ci][1] * G;
        ci++;
        if (!taken.some((o) => hit(x, y, o.x, o.y))) spot = { x, y };
      }
      if (spot) { out[k] = spot; taken.push(spot); } else rest.push(k);
    }
    return Object.assign(out, autoPlace(rest, Object.assign({}, pos, out)));
  }

  /* ---------- pixel icons (rect lists on an 11x11 grid) ---------- */

  const mir = (rs) => rs.map(([x, y, w, hh]) => [11 - x - w, y, w, hh]);
  const ICONS = {
    minus: [[2, 5, 7, 1]],
    plus: [[2, 5, 7, 1], [5, 2, 1, 7]],
    fit: [[1, 1, 3, 1], [1, 2, 1, 2], [7, 1, 3, 1], [9, 2, 1, 2], [1, 7, 1, 2], [1, 9, 3, 1], [9, 7, 1, 2], [7, 9, 3, 1], [3, 3, 2, 2], [6, 6, 2, 2]],
    sel: [[1, 1, 3, 1], [1, 2, 1, 2], [7, 1, 3, 1], [9, 2, 1, 2], [1, 7, 1, 2], [1, 9, 3, 1], [9, 7, 1, 2], [7, 9, 3, 1], [3, 3, 5, 5]],
    grid: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [1 + c * 4, 1 + r * 4, 1, 1])),
    snap: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c * 4, r * 4, 3, 3])),
    guides: [[5, 0, 1, 2], [5, 3, 1, 2], [5, 6, 1, 2], [5, 9, 1, 2], [0, 5, 2, 1], [3, 5, 2, 1], [6, 5, 2, 1], [9, 5, 2, 1], [5, 5, 1, 1]],
    undo: [[2, 4, 1, 1], [3, 3, 1, 3], [4, 2, 1, 5], [5, 4, 4, 1], [9, 5, 1, 2], [8, 7, 1, 1], [5, 8, 3, 1]],
    tidy: [[2, 8, 1, 1], [3, 7, 1, 1], [4, 6, 1, 1], [5, 5, 1, 1], [6, 4, 1, 1], [3, 8, 1, 1], [4, 7, 1, 1], [5, 6, 1, 1], [6, 5, 1, 1], [7, 4, 1, 1], [8, 1, 1, 3], [7, 2, 3, 1], [1, 5, 1, 1], [4, 9, 1, 1]],
    left: [[1, 0, 1, 11], [3, 2, 7, 3], [3, 6, 4, 3]],
    centerX: [[5, 0, 1, 11], [1, 2, 9, 3], [3, 6, 5, 3]],
    right: [[9, 0, 1, 11], [2, 2, 6, 3], [5, 6, 3, 3]],
    top: [[0, 1, 11, 1], [2, 3, 3, 7], [6, 3, 3, 4]],
    middle: [[0, 5, 11, 1], [2, 1, 3, 9], [6, 3, 3, 5]],
    bottom: [[0, 9, 11, 1], [2, 2, 3, 7], [6, 5, 3, 4]],
    distH: [[0, 0, 1, 11], [10, 0, 1, 11], [4, 2, 3, 7]],
    distV: [[0, 0, 11, 1], [0, 10, 11, 1], [2, 4, 7, 3]],
    map: [[1, 1, 9, 1], [1, 9, 9, 1], [1, 2, 1, 7], [9, 2, 1, 7], [3, 3, 3, 3], [6, 5, 2, 2]],
    help: [[3, 1, 5, 1], [2, 2, 2, 1], [7, 2, 2, 1], [7, 3, 2, 1], [6, 4, 2, 1], [5, 5, 2, 1], [5, 6, 1, 1], [5, 8, 1, 1]],
  };
  ICONS.redo = mir(ICONS.undo);
  function icon(name) {
    const rects = ICONS[name].map(([x, y, w, hh]) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}"/>`).join('');
    return h('span.hc-pix', { 'aria-hidden': 'true', html: `<svg viewBox="0 0 11 11" width="22" height="22" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>` });
  }

  /** Pushpin (pin position) as a pixel icon; shared with the host's side panel. */
  const PIN_RECTS = [[3, 0, 5, 1], [4, 1, 3, 4], [2, 5, 7, 1], [5, 6, 1, 4]];
  function pinIcon(size) {
    const rects = PIN_RECTS.map(([x, y, w, hh]) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}"/>`).join('');
    return h('span.hc-pix.hc-pinico', { 'aria-hidden': 'true', html: `<svg viewBox="0 0 11 11" width="${size || 14}" height="${size || 14}" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>` });
  }

  const HELP = [
    ['Select', [['Click', 'select a villager'], ['Ctrl / ⌘ + click', 'add or remove one'], ['Shift + click', 'add to selection'], ['Drag empty space', 'select with a box (Ctrl/Shift adds)'], ['Click empty space', 'clear selection']]],
    ['Move', [['Drag a villager', 'moves the whole selection'], ['Drop on a villager', 'swap the two'], ['Hold Alt', 'no snapping or guides while dragging'], ['Arrow keys', 'nudge 80px (Shift: 8px)'], ['P', 'pin or unpin the selection: pinned villagers stay put']]],
    ['Navigate', [['Scroll / trackpad', 'pan'], ['Ctrl / ⌘ + scroll, pinch', 'zoom to the cursor'], ['Space + drag, middle / right drag', 'pan'], ['F or Shift 1', 'fit everything'], ['Shift 2', 'zoom to selection'], ['0  ·  + / −', '100%  ·  zoom']]],
    ['Edit', [['Ctrl / ⌘ + A', 'select all'], ['Ctrl / ⌘ + Z', 'undo (Shift or Y: redo)'], ['Esc', 'clear selection']]],
    ['Touch', [['One finger', 'pan'], ['Two fingers', 'pinch to zoom'], ['Hold, then drag', 'on a villager: move  ·  on empty space: select box']]],
  ];

  /* ====================================================================== */

  function mount(container, opts) {
    opts = opts || {};
    const S = {
      items: new Map(), order: [], pos: {}, sel: new Set(),
      view: { px: 0, py: 0, z: 1 }, prefs: { snap: false, grid: true, guides: true, map: matchMedia('(min-width: 641px)').matches },
      past: [], future: [], pinned: new Set(), tipTimer: 0, tipKey: null, g: null, ptrs: new Map(), pinch: null, space: false, hover: false,
      size: { w: 0, h: 0 }, haveView: false, needFit: true, anim: 0, dirty: true, lastNudge: null, colors: null, colorsAt: 0, orderSig: '',
    };
    let raf = 0;

    /* ---------- DOM ---------- */
    const world = h('div.hc-world');
    const ovl = h('div.hc-ovl', { 'aria-hidden': 'true' });
    const marquee = h('div.hc-marquee');
    const guideEls = [];
    const tip = h('div.th-tooltip.hc-tip.hc-ui', { hidden: true, role: 'presentation', 'aria-hidden': 'true' });
    const live = h('div.hc-live', { role: 'status', 'aria-live': 'polite' });
    const miniCv = h('canvas.hc-mini-cv', { 'aria-hidden': 'true' });
    const mini = h('div.hc-minimap.hc-ui', miniCv);
    const zoomBtn = h('button.hc-btn.hc-zoom', { type: 'button', title: 'Reset to 100% (0)', 'aria-label': 'Zoom level, click for 100%', onclick: () => zoomTo(1) }, '100%');

    const btn = (ico, title, fn, extra) => h('button.hc-btn' + (extra || ''), { type: 'button', title, 'aria-label': title.replace(/\s*\(.*\)$/, ''), onclick: fn }, icon(ico));
    const bUndo = btn('undo', 'Undo (Ctrl+Z)', () => undo());
    const bRedo = btn('redo', 'Redo (Ctrl+Shift+Z)', () => redo());
    const bSnap = btn('snap', 'Snap to grid (off by default; hold Alt to bypass)', () => togglePref('snap'));
    const bGrid = btn('grid', 'Show grid', () => togglePref('grid'));
    const bGuides = btn('guides', 'Smart guides', () => togglePref('guides'));
    const bMap = btn('map', 'Minimap', () => togglePref('map'));
    const bHelp = btn('help', 'Shortcuts (?)', () => toggleHelp());
    const bSelZoom = btn('sel', 'Zoom to selection (Shift+2)', () => zoomSel());
    const bars = h('div.hc-bars.hc-ui');
    const mainBar = h('div.hc-bar',
      h('div.hc-grp', btn('minus', 'Zoom out (−)', () => zoomBy(1 / 1.25)), zoomBtn, btn('plus', 'Zoom in (+)', () => zoomBy(1.25))),
      h('div.hc-grp', btn('fit', 'Fit all (F)', () => fit(true)), bSelZoom),
      h('div.hc-grp', bGrid, bSnap, bGuides),
      h('div.hc-grp', bUndo, bRedo),
      h('div.hc-grp', btn('tidy', 'Tidy up: sort by type into rows', () => tidy())),
      h('div.hc-grp', bMap, bHelp));
    const alignBtns = [
      ['left', 'Align left', () => align('x0')], ['centerX', 'Align centers', () => align('xc')], ['right', 'Align right', () => align('x1')],
      ['top', 'Align top', () => align('y0')], ['middle', 'Align middles', () => align('yc')], ['bottom', 'Align bottom', () => align('y1')],
      ['distH', 'Distribute horizontally', () => distribute('x')], ['distV', 'Distribute vertically', () => distribute('y')],
    ].map(([ic, t, fn]) => btn(ic, t, fn));
    const alignBar = h('div.hc-bar.hc-align', { hidden: true },
      h('span.hc-bar-lbl', 'Align'), h('div.hc-grp', alignBtns.slice(0, 3)), h('div.hc-grp', alignBtns.slice(3, 6)), h('div.hc-grp', alignBtns.slice(6)));
    bars.append(mainBar, alignBar);

    const help = h('div.hc-help.hc-ui', { hidden: true, role: 'dialog', 'aria-label': 'Canvas shortcuts' },
      h('div.hc-help-head', h('b', 'Canvas shortcuts'), h('button.x-btn', { type: 'button', 'aria-label': 'Close shortcuts', onclick: () => toggleHelp(false) }, '✕')),
      h('dl', HELP.map(([t, rows]) => [h('h4', t), rows.map(([k, v]) => [h('dt', k), h('dd', v)])])));

    ovl.append(marquee);
    const vp = h('div.hc-viewport', {
      tabindex: '0', role: 'group', 'data-focus': 'hc-vp',
      'aria-label': 'Hall layout canvas. Tab through villagers, Enter selects, arrow keys move the selection, question mark lists shortcuts.',
    }, world, ovl, bars, mini, tip, help);
    const root = h('div.hc', vp, live);
    if (container) container.append(root);

    const ctx = miniCv.getContext('2d');

    /* ---------- coordinates ---------- */
    const toWorld = (lx, ly) => ({ x: (lx - S.view.px) / S.view.z, y: (ly - S.view.py) / S.view.z });
    const toLocal = (wx, wy) => ({ x: wx * S.view.z + S.view.px, y: wy * S.view.z + S.view.py });
    const rectOf = () => scaledRect(vp);
    const keysArr = () => Array.from(S.items.keys());

    function bboxOf(keys) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const k of keys) {
        const p = S.pos[k]; if (!p) continue;
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + TILE); y1 = Math.max(y1, p.y + TILE);
      }
      return x0 === Infinity ? null : { x0, y0, x1, y1 };
    }

    function hitTest(wx, wy) {
      for (let i = S.order.length - 1; i >= 0; i--) {
        const p = S.pos[S.order[i]];
        if (p && wx >= p.x && wx < p.x + TILE && wy >= p.y && wy < p.y + TILE) return S.order[i];
      }
      return null;
    }

    /* ---------- rendering (direct, no store) ---------- */
    function setTile(k) {
      const rec = S.items.get(k), p = S.pos[k];
      if (!rec || !p || (S.tw && S.tw.items[k])) return;
      rec.vx = p.x; rec.vy = p.y;
      rec.el.style.translate = p.x + 'px ' + p.y + 'px';
    }
    /** Set logical positions for some tiles; the visuals glide there (JS tween, so re-parenting the canvas can't cut it short). */
    function place(partial, glide) {
      hideTip();
      const tw = {};
      if (S.tw) { const old = S.tw; S.tw = null; for (const k in old.items) if (!(k in partial)) setTile(k); }
      for (const k in partial) {
        const p = S.pos[k] = { x: partial[k].x, y: partial[k].y }, rec = S.items.get(k);
        if (!rec) continue;
        if (glide && !reduced() && rec.vx != null && (rec.vx !== p.x || rec.vy !== p.y)) tw[k] = { ax: rec.vx, ay: rec.vy, bx: p.x, by: p.y };
        else setTile(k);
      }
      if (Object.keys(tw).length) { S.tw = { t0: performance.now(), ms: 220, items: tw }; schedule(); }
    }
    function stepTween(now) {
      const tw = S.tw; if (!tw) return;
      const k = clamp((now - tw.t0) / tw.ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      for (const key in tw.items) {
        const it = tw.items[key], rec = S.items.get(key); if (!rec) continue;
        rec.vx = k === 1 ? it.bx : it.ax + (it.bx - it.ax) * e; rec.vy = k === 1 ? it.by : it.ay + (it.by - it.ay) * e;
        rec.el.style.translate = rec.vx + 'px ' + rec.vy + 'px';
      }
      S.miniDirty = true;
      if (k === 1) S.tw = null; else schedule();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

    /* dots sit in the 8px gaps at world (80k-4, 80k-4): the centre of the gap at every tile corner; the gradient dot is centred in its cell, hence the sz/2 shift */
    function paintGrid() {
      const sz = G * S.view.z, on = S.prefs.grid && sz >= 10;
      vp.classList.toggle('has-grid', on);
      if (on) { vp.style.setProperty('--hc-gs', sz + 'px'); vp.style.setProperty('--hc-gx', (Math.round(S.view.px) - 4 * S.view.z - sz / 2) + 'px'); vp.style.setProperty('--hc-gy', (Math.round(S.view.py) - 4 * S.view.z - sz / 2) + 'px'); }
    }
    function applyView() {
      const { px, py, z } = S.view;
      const rx = Math.round(px), ry = Math.round(py);
      world.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(${z})`;
      vp.classList.toggle('is-lod', z < 0.5);
      paintGrid();
      zoomBtn.textContent = Math.round(z * 100) + '%';
    }

    const settleView = debounce(() => vp.classList.remove('is-vchg'), 160);
    function setView(v, persist) {
      S.view.z = clamp(v.z, ZMIN, ZMAX); S.view.px = v.px; S.view.py = v.py;
      // while the view changes the world is a GPU-scaled layer (cheap); once it settles it re-rasterises, so text stays crisp
      if (!vp.classList.contains('is-vchg')) vp.classList.add('is-vchg');
      settleView();
      hideTip();
      S.dirty = true; S.miniDirty = true; schedule();
      if (persist !== false) persistView();
    }

    function cancelAnim() { if (S.anim) { cancelAnimationFrame(S.anim); S.anim = 0; } }

    /** Tween to a view (interpolates zoom geometrically and the world point at the centre). */
    function animateView(t, ms) {
      cancelAnim();
      const { w, h: hh } = S.size;
      t = { px: t.px, py: t.py, z: clamp(t.z, ZMIN, ZMAX) };
      if (!ms || reduced() || !w) { setView(t); return; }
      const a = S.view, t0 = performance.now();
      const ca = { x: (w / 2 - a.px) / a.z, y: (hh / 2 - a.py) / a.z };
      const cb = { x: (w / 2 - t.px) / t.z, y: (hh / 2 - t.py) / t.z };
      const za = a.z, zb = t.z;
      const step = (now) => {
        const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
        const z = za * Math.pow(zb / za, e);
        const c = { x: ca.x + (cb.x - ca.x) * e, y: ca.y + (cb.y - ca.y) * e };
        setView({ z, px: w / 2 - c.x * z, py: hh / 2 - c.y * z }, k === 1);
        S.anim = k < 1 ? requestAnimationFrame(step) : 0;
      };
      S.anim = requestAnimationFrame(step);
    }

    function viewFor(bb, pad, maxZ) {
      const { w, h: hh } = S.size;
      const bw = Math.max(bb.x1 - bb.x0, TILE) + pad * 2, bh = Math.max(bb.y1 - bb.y0, TILE) + pad * 2;
      const z = clamp(Math.min(w / bw, hh / bh), ZMIN, Math.min(maxZ, ZMAX));
      const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      return { z, px: w / 2 - cx * z, py: hh / 2 - cy * z };
    }
    function fit(animate) {
      const bb = bboxOf(keysArr());
      if (!bb || !S.size.w) return;
      animateView(viewFor(bb, 48, 1.5), animate ? 360 : 0);
    }
    /** First ever view: fit everything, but never smaller than a readable 55% (narrow screens start at the top-left instead). */
    function initialView() {
      const bb = bboxOf(keysArr());
      if (!bb || !S.size.w) return;
      const v = viewFor(bb, 48, 1.5);
      if (v.z < 0.5) { const z = 0.55; setView({ z, px: 20 - bb.x0 * z, py: 64 - bb.y0 * z }); } else setView(v);
    }
    function zoomSel() {
      const bb = bboxOf(Array.from(S.sel));
      if (!bb) { notify('Select something first', true); return; }
      animateView(viewFor(bb, 72, 2), 360);
    }
    function zoomAt(lx, ly, z, ms) {
      z = clamp(z, ZMIN, ZMAX);
      const w = toWorld(lx, ly);
      const t = { z, px: lx - w.x * z, py: ly - w.y * z };
      if (ms) animateView(t, ms); else setView(t);
    }
    const zoomBy = (f) => { cancelAnim(); zoomAt(S.size.w / 2, S.size.h / 2, S.view.z * f, 160); };
    const zoomTo = (z) => { cancelAnim(); zoomAt(S.size.w / 2, S.size.h / 2, z, 200); };

    /** px of the canvas bottom hidden by an overlay (the details sheet on phones), supplied by the host */
    const inset = () => Math.max(0, Math.min(S.size.h * 0.7, (opts.getInset && opts.getInset(rectOf())) || 0));
    /** After a tap: if the details sheet now covers the tapped tile, pan it back into the visible part. */
    function keepAboveSheet(key) {
      const p = S.pos[key], ins = inset(); if (!p || !ins) return;
      const bottom = toLocal(0, p.y + TILE).y, limit = S.size.h - ins - 14;
      if (bottom > limit) animateView({ z: S.view.z, px: S.view.px, py: S.view.py - (bottom - limit) }, 220);
    }

    /** Pan/zoom so that tile `key` is centred (zoom up to a readable level). */
    function reveal(key, o) {
      o = o || {};
      const p = S.pos[key], rec = S.items.get(key);
      if (!p || !rec) return;
      const r = rectOf();
      if (r.bottom < 0 || r.top > innerHeight) vp.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      const z = clamp(Math.max(S.view.z, 0.9), ZMIN, 1.6), free = (S.size.h - inset()) / 2; // centre in what a bottom sheet leaves visible
      if (S.size.w) animateView({ z, px: S.size.w / 2 - (p.x + TILE / 2) * z, py: free - (p.y + TILE / 2) * z }, 380);
      if (o.pulse) {
        rec.el.classList.remove('is-pulse'); void rec.el.offsetWidth; rec.el.classList.add('is-pulse');
        setTimeout(() => rec.el.classList.remove('is-pulse'), 2300);
      }
    }

    const persistView = debounce(() => {
      if (opts.onChange) opts.onChange({ view: viewState() });
    }, 350);
    // flush a pending view save if the page is left/reloaded within the debounce window
    addEventListener('pagehide', () => { if (opts.onChange) opts.onChange({ view: viewState() }); });
    const viewState = () => ({
      px: Math.round(S.view.px * 100) / 100, py: Math.round(S.view.py * 100) / 100, z: Math.round(S.view.z * 1000) / 1000,
      snap: S.prefs.snap, grid: S.prefs.grid, guides: S.prefs.guides, map: S.prefs.map, sv: 2,
    });

    /** Announce for screen readers; `toast` also shows it on screen (only for things the user can't otherwise see). */
    function notify(msg, toast) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); if (toast && opts.onNotify) opts.onNotify(msg); }

    /* ---------- selection ---------- */
    function paintSel() {
      for (const [k, r] of S.items) {
        const on = S.sel.has(k);
        if (r.on !== on) { r.on = on; r.el.classList.toggle('is-selected', on); r.el.setAttribute('aria-pressed', String(on)); }
      }
      alignBar.hidden = S.sel.size < 2;
      alignBtns[6].disabled = alignBtns[7].disabled = S.sel.size < 3;
      vp.classList.toggle('has-sel', S.sel.size > 0);
    }
    function setSel(keys, emit) {
      const prev = S.sel;
      S.sel = new Set(keys.filter((k) => S.items.has(k)));
      paintSel();
      if (emit) {
        const arr = Array.from(S.sel);
        const same = arr.length === prev.size && arr.every((k) => prev.has(k));
        if (!same) {
          const n = arr.length;
          live.textContent = n === 0 ? 'Selection cleared' : n === 1 ? ((S.items.get(arr[0]) || {}).label || '1 selected') + ' selected' : n + ' villagers selected';
        }
        if (!same && opts.onChange) opts.onChange({ sel: arr });
      }
    }
    function clickSelect(key, mods) {
      const cur = Array.from(S.sel);
      if (mods.ctrl) setSel(S.sel.has(key) ? cur.filter((k) => k !== key) : cur.concat(key), true);
      else if (mods.shift) setSel(cur.concat(key), true);
      else setSel([key], true);
    }

    /* ---------- history + commits ---------- */
    function pushHistory() {
      S.past.push(clonePos(S.pos)); if (S.past.length > 100) S.past.shift();
      S.future.length = 0; updateBtns();
    }
    function updateBtns() {
      bUndo.disabled = !S.past.length; bRedo.disabled = !S.future.length;
      bSnap.classList.toggle('on', S.prefs.snap); bSnap.setAttribute('aria-pressed', String(S.prefs.snap));
      bGrid.classList.toggle('on', S.prefs.grid); bGrid.setAttribute('aria-pressed', String(S.prefs.grid));
      bGuides.classList.toggle('on', S.prefs.guides); bGuides.setAttribute('aria-pressed', String(S.prefs.guides));
      bMap.classList.toggle('on', S.prefs.map); bMap.setAttribute('aria-pressed', String(S.prefs.map));
      mini.hidden = !S.prefs.map;
    }
    /** Apply new positions for some tiles; one history entry, one store write. */
    function commit(partial, o) {
      o = o || {};
      if (!o.noHistory) pushHistory();
      place(partial, o.glide);
      S.miniDirty = true; schedule();
      if (opts.onChange) opts.onChange(Object.assign({ pos: clonePos(S.pos) }, o.extra || {}));
    }
    function applySnapshot(snap) {
      const part = {};
      for (const k of S.items.keys()) if (snap[k] && !S.pinned.has(k)) part[k] = snap[k]; // a pinned tile never moves, not even by undo
      commit(part, { noHistory: true, glide: true });
      updateBtns();
    }
    function undo() {
      const prev = S.past.pop(); if (!prev) return;
      S.future.push(clonePos(S.pos)); applySnapshot(prev); notify('Undid last change');
    }
    function redo() {
      const nxt = S.future.pop(); if (!nxt) return;
      S.past.push(clonePos(S.pos)); applySnapshot(nxt); notify('Redid change');
    }

    /** Where would `keys` land if each moved to desired[k]? Reports clashes with the rest and a possible swap. */
    function evaluate(keys, desired, others) {
      const clash = new Set();
      let swap = null;
      if (keys.length === 1) {
        const d = desired[keys[0]], cx = d.x + TILE / 2, cy = d.y + TILE / 2;
        for (const o of others) if (!S.pinned.has(o.key) && cx >= o.x && cx < o.x + TILE && cy >= o.y && cy < o.y + TILE) { swap = o.key; break; }
      }
      for (const k of keys) {
        const d = desired[k];
        for (const o of others) if (o.key !== swap && hit(d.x, d.y, o.x, o.y)) { clash.add(o.key); clash.add(k); }
      }
      return { clash, swap };
    }
    /** Final positions for a drop / nudge: swap, or nudge the whole group to the nearest free snapped offset. */
    function resolve(keys, desired, orig, others) {
      const ev = evaluate(keys, desired, others);
      if (ev.swap) {
        const o = S.pos[ev.swap];
        return { pos: { [keys[0]]: { x: o.x, y: o.y }, [ev.swap]: orig[keys[0]] }, swap: ev.swap, moved: true };
      }
      if (!ev.clash.size) return { pos: desired, moved: false };
      const k0 = keys[0];
      const bx = snapG(desired[k0].x) - desired[k0].x, by = snapG(desired[k0].y) - desired[k0].y;
      const base = {}; keys.forEach((k) => { base[k] = { x: desired[k].x + bx, y: desired[k].y + by }; });
      const R = 14, offs = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) offs.push({ i, j, d: i * i + j * j });
      offs.sort((a, b) => a.d - b.d);
      for (const o of offs) {
        const out = {}; let ok = true;
        for (const k of keys) {
          const x = base[k].x + o.i * G, y = base[k].y + o.j * G;
          out[k] = { x, y };
          if (others.some((s) => hit(x, y, s.x, s.y))) { ok = false; break; }
        }
        if (ok) return { pos: out, moved: true };
      }
      return { pos: desired, moved: false };
    }
    const othersOf = (keys) => { const set = new Set(keys); return S.order.filter((k) => !set.has(k) && S.pos[k]).map((k) => ({ key: k, x: S.pos[k].x, y: S.pos[k].y })); };

    /* ---------- operations ---------- */
    function swap(a, b) {
      if (!S.pos[a] || !S.pos[b]) return false;
      if (S.pinned.has(a) || S.pinned.has(b)) { notify('Pinned villagers can’t be swapped. Unpin them first (P).', true); return false; }
      commit({ [a]: S.pos[b], [b]: S.pos[a] }, { glide: true });
      return true;
    }
    function tidy() {
      const keys = S.order.filter((k) => S.pos[k]);
      if (!keys.length) return;
      const n = keys.length, asp = S.size.h ? S.size.w / S.size.h : 1.6;
      const cols = clamp(Math.round(Math.sqrt(n * asp)), 4, 14);
      const bb = bboxOf(keys);
      const ox = snapG(bb.x0), oy = snapG(bb.y0);
      // pinned tiles stay where they are; everyone else flows row by row around them
      const fixed = keys.filter((k) => S.pinned.has(k)).map((k) => S.pos[k]);
      const part = {};
      let slot = 0;
      for (const k of keys) {
        if (S.pinned.has(k)) continue;
        let x, y;
        for (let guard = 0; guard < 20000; guard++, slot++) {
          x = ox + (slot % cols) * G; y = oy + Math.floor(slot / cols) * G;
          if (!fixed.some((f) => hit(x, y, f.x, f.y))) break;
        }
        slot++;
        part[k] = { x, y };
      }
      if (!Object.keys(part).length) { notify('Everything is pinned, nothing to tidy', true); return; }
      commit(part, { glide: true });
      setTimeout(() => fit(true), 120);
      notify(fixed.length ? `Tidied up around ${fixed.length} pinned` : 'Tidied up: sorted by type', true);
    }
    function separate(part, keys) {
      // after align / distribute: nudge tiles that now sit on top of others to the nearest free snapped spot
      const all = Object.assign({}, S.pos, part);
      for (const k of keys) {
        const p = all[k];
        if (Object.keys(all).some((o) => o !== k && hit(p.x, p.y, all[o].x, all[o].y))) {
          const f = freeSpot(all, k, p.x, p.y);
          all[k] = f; part[k] = f;
        }
      }
      return part;
    }
    function align(mode) {
      const keys = Array.from(S.sel).filter((k) => S.pos[k]);
      if (keys.length < 2) return;
      const bb = bboxOf(keys), part = {};
      for (const k of keys) {
        const p = S.pos[k];
        part[k] = {
          x: mode === 'x0' ? bb.x0 : mode === 'x1' ? bb.x1 - TILE : mode === 'xc' ? Math.round((bb.x0 + bb.x1) / 2 - TILE / 2) : p.x,
          y: mode === 'y0' ? bb.y0 : mode === 'y1' ? bb.y1 - TILE : mode === 'yc' ? Math.round((bb.y0 + bb.y1) / 2 - TILE / 2) : p.y,
        };
      }
      commitMovable(part, keys);
    }
    /** Align / distribute result: pinned tiles act as fixed references and are not moved. */
    function commitMovable(part, keys) {
      const mv = keys.filter((k) => !S.pinned.has(k));
      for (const k of keys) if (S.pinned.has(k)) delete part[k];
      if (!mv.length) { notify('Pinned villagers stay put. Unpin them first (P).', true); return; }
      commit(separate(part, mv), { glide: true });
      if (mv.length < keys.length) notify(`${keys.length - mv.length} pinned stayed in place`, true);
    }
    function distribute(axis) {
      const keys = Array.from(S.sel).filter((k) => S.pos[k]);
      if (keys.length < 3) { notify('Select three or more to distribute', true); return; }
      keys.sort((a, b) => S.pos[a][axis] - S.pos[b][axis]);
      const lo = S.pos[keys[0]][axis], hi = S.pos[keys[keys.length - 1]][axis], part = {};
      keys.forEach((k, i) => { part[k] = Object.assign({}, S.pos[k], { [axis]: Math.round(lo + ((hi - lo) * i) / (keys.length - 1)) }); });
      commitMovable(part, keys);
    }
    function nudge(dx, dy) {
      let keys = Array.from(S.sel).filter((k) => S.pos[k]);
      if (keys.length && keys.every((k) => S.pinned.has(k))) { notify('Pinned villagers stay put. Unpin them first (P).', true); return; }
      keys = keys.filter((k) => !S.pinned.has(k));
      if (!keys.length) { cancelAnim(); setView({ z: S.view.z, px: S.view.px - dx * S.view.z * 0.75, py: S.view.py - dy * S.view.z * 0.75 }); return; }
      const desired = {}, orig = {};
      keys.forEach((k) => { orig[k] = { x: S.pos[k].x, y: S.pos[k].y }; desired[k] = { x: orig[k].x + dx, y: orig[k].y + dy }; });
      const r = resolve(keys, desired, orig, othersOf(keys));
      const sig = keys.join('|'), now = performance.now();
      const merge = S.lastNudge && S.lastNudge.sig === sig && now - S.lastNudge.t < 600;
      S.lastNudge = { sig, t: now };
      commit(r.pos, { glide: r.moved, noHistory: merge });
      if (merge) { S.future.length = 0; updateBtns(); }
      ensureVisible(keys);
    }
    function ensureVisible(keys) {
      const bb = bboxOf(keys); if (!bb || !S.size.w) return;
      const a = toLocal(bb.x0, bb.y0), b = toLocal(bb.x1, bb.y1), m = 24;
      let dx = 0, dy = 0;
      if (a.x < m) dx = m - a.x; else if (b.x > S.size.w - m) dx = S.size.w - m - b.x;
      if (a.y < m) dy = m - a.y; else if (b.y > S.size.h - m) dy = S.size.h - m - b.y;
      if ((dx || dy) && b.x - a.x < S.size.w && b.y - a.y < S.size.h) animateView({ z: S.view.z, px: S.view.px + dx, py: S.view.py + dy }, 160);
    }

    function togglePref(k) {
      S.prefs[k] = !S.prefs[k]; if (k === 'grid') paintGrid(); updateBtns(); S.miniDirty = true; schedule(); persistView();
    }
    function toggleHelp(on) {
      help.hidden = on == null ? !help.hidden : !on;
      bHelp.classList.toggle('on', !help.hidden);
    }

    /* ---------- gestures ---------- */
    const showGuides = (list) => {
      while (guideEls.length < list.length) { const e = h('div.hc-guide'); ovl.append(e); guideEls.push(e); }
      guideEls.forEach((e, i) => {
        const g = list[i];
        if (!g) { e.hidden = true; return; }
        e.hidden = false; e.classList.toggle('is-h', !g.v);
        if (g.v) { const a = toLocal(g.at, g.from), b = toLocal(g.at, g.to); Object.assign(e.style, { left: Math.round(a.x) + 'px', top: a.y + 'px', width: '1px', height: Math.round(b.y - a.y) + 'px' }); }
        else { const a = toLocal(g.from, g.at), b = toLocal(g.to, g.at); Object.assign(e.style, { left: a.x + 'px', top: Math.round(a.y) + 'px', height: '1px', width: Math.round(b.x - a.x) + 'px' }); }
      });
    };

    function onDown(ev) {
      if (ev.target.closest('.hc-ui')) return;
      const touch = ev.pointerType !== 'mouse';
      if (!touch) {
        ev.preventDefault();
        if (S.g && !S.g.touch) abortGesture(); // a lost mouse-up must never wedge the canvas
        for (const [id, q] of S.ptrs) if (!q.touch) S.ptrs.delete(id);
      }
      if (!help.hidden) toggleHelp(false);
      vp.focus({ preventScroll: true });
      S.ptrs.set(ev.pointerId, { x: (ev.clientX / ZF()), y: (ev.clientY / ZF()), touch });
      try { vp.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointer */ }
      if (S.ptrs.size === 2 && touch) { startPinch(); return; }
      if (S.ptrs.size > 1 || S.g || S.pinch) return;
      cancelAnim();
      const r = rectOf(), lx = (ev.clientX / ZF()) - r.left, ly = (ev.clientY / ZF()) - r.top;
      const wp = toWorld(lx, ly);
      const g = {
        id: ev.pointerId, mode: 'pending', x0: lx, y0: ly, x: lx, y: ly, r, touch, held: false, t0: performance.now(),
        key: hitTest(wp.x, wp.y), mods: { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey, alt: ev.altKey },
      };
      S.g = g;
      if (!touch && (ev.button === 1 || ev.button === 2 || (ev.button === 0 && S.space))) { startPan(g); return; }
      if (!touch && ev.button !== 0) { S.g = null; return; }
      if (touch) {
        g.timer = setTimeout(() => {
          if (S.g !== g || g.mode !== 'pending') return;
          g.held = true;
          if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* ignore */ }
          if (g.key) startMove(g); else startMarquee(g);
          schedule();
        }, HOLD_MS);
        if (g.key) { const rec = S.items.get(g.key); if (rec) rec.el.classList.add('is-press'); }
      }
    }

    function startPan(g) { g.mode = 'pan'; g.lx = g.x; g.ly = g.y; vp.classList.add('is-panning'); }

    function onMove(ev) {
      const p = S.ptrs.get(ev.pointerId); if (!p) return;
      p.x = (ev.clientX / ZF()); p.y = (ev.clientY / ZF());
      if (S.pinch) { pinchMove(); return; }
      const g = S.g; if (!g || g.id !== ev.pointerId) return;
      g.x = (ev.clientX / ZF()) - g.r.left; g.y = (ev.clientY / ZF()) - g.r.top; g.mods.alt = ev.altKey;
      if (g.mode === 'pending') {
        if (Math.hypot(g.x - g.x0, g.y - g.y0) < SLOP) return;
        if (g.touch) { if (!g.held) { clearTimeout(g.timer); startPan(g); g.lx = g.x0; g.ly = g.y0; } } else if (g.key) startMove(g); else startMarquee(g);
      }
      if (g.mode === 'pan') {
        setView({ z: S.view.z, px: S.view.px + (g.x - g.lx), py: S.view.py + (g.y - g.ly) });
        g.lx = g.x; g.ly = g.y;
      } else if (g.mode === 'move' || g.mode === 'marquee') schedule();
    }

    function onUp(ev) {
      const had = S.ptrs.delete(ev.pointerId);
      if (S.pinch) { if (S.ptrs.size < 2) endPinch(); return; }
      const g = S.g; if (!g || g.id !== ev.pointerId || !had) return;
      g.x = (ev.clientX / ZF()) - g.r.left; g.y = (ev.clientY / ZF()) - g.r.top;
      if (g.mode === 'marquee') runMarquee(g); else if (g.mode === 'move') runMove(g); // the release may come before the next frame
      S.g = null;
      clearTimeout(g.timer);
      vp.classList.remove('is-panning', 'is-moving', 'is-marquee');
      const pressed = g.key && S.items.get(g.key); if (pressed) pressed.el.classList.remove('is-press');
      persistView();
      if (g.mode === 'pending') {
        if (g.key) { clickSelect(g.key, g.mods); if (g.touch) keepAboveSheet(g.key); }
        else if (!g.mods.ctrl && !g.mods.shift) setSel([], true);
      } else if (g.mode === 'marquee') {
        marquee.hidden = true; showGuides([]);
        const cur = Array.from(S.sel);
        S.sel = new Set(g.base0); // what the store still holds, so setSel can tell whether anything changed
        setSel(cur, true);
      } else if (g.mode === 'move') {
        endMove(g, true);
      }
    }

    function abortGesture() {
      const g = S.g; if (!g) return;
      S.g = null; clearTimeout(g.timer);
      vp.classList.remove('is-panning', 'is-moving', 'is-marquee');
      const pressed = g.key && S.items.get(g.key); if (pressed) pressed.el.classList.remove('is-press');
      if (g.mode === 'move') endMove(g, false);
      else if (g.mode === 'marquee') { marquee.hidden = true; setSel(Array.from(g.base0), false); }
    }

    /* ---- move ---- */
    function startMove(g) {
      if (S.pinned.has(g.key)) { // grabbing a pinned tile does nothing (and never selects it by accident)
        g.mode = 'blocked'; clearTimeout(g.timer);
        const pressed = S.items.get(g.key); if (pressed) pressed.el.classList.remove('is-press');
        notify('Pinned: unpin it (P) to move it', true);
        return;
      }
      g.mode = 'move';
      if (!S.sel.has(g.key)) {
        const next = (g.mods.ctrl || g.mods.shift) ? Array.from(S.sel).concat(g.key) : [g.key];
        g.selBefore = Array.from(S.sel);
        S.sel = new Set(next); paintSel(); g.selChanged = true;
      }
      g.keys = Array.from(S.sel).filter((k) => S.pos[k] && !S.pinned.has(k)); // pinned members of a group stay behind
      g.skipped = S.sel.size - g.keys.length;
      g.orig = {}; g.keys.forEach((k) => { g.orig[k] = { x: S.pos[k].x, y: S.pos[k].y }; });
      g.bb = bboxOf(g.keys);
      g.start = toWorld(g.x0, g.y0);
      g.others = othersOf(g.keys);
      g.flag = new Set();
      g.keys.forEach((k) => S.items.get(k).el.classList.add('is-dragging'));
      hideTip();
      if (g.keys.length > 1) { g.badge = h('span.hc-gbadge', String(g.keys.length)); S.items.get(g.key).el.append(g.badge); }
      if (S.tw) { const old = S.tw; S.tw = null; for (const k in old.items) setTile(k); }
      vp.classList.add('is-moving');
    }

    function runMove(g) {
      const cur = toWorld(g.x, g.y), z = S.view.z;
      let dx = cur.x - g.start.x, dy = cur.y - g.start.y;
      const o = g.orig[g.key], free = g.mods.alt;
      if (S.prefs.snap && !free) { dx = snapG(o.x + dx) - o.x; dy = snapG(o.y + dy) - o.y; }
      const guides = [];
      if (S.prefs.guides && !free && g.others.length) {
        const thr = GUIDE_PX / z, bb = g.bb, gridOn = S.prefs.snap;
        // one guide per axis: the closest centre-centre or same-edge (min-min, max-max) match; cross-edge pairs are ignored
        const best = (axis) => {
          const lo = axis === 'x' ? bb.x0 + dx : bb.y0 + dy, hi = axis === 'x' ? bb.x1 + dx : bb.y1 + dy;
          const mine = [lo, (lo + hi) / 2, hi];
          let pick = null;
          for (const s of g.others) {
            const a0 = axis === 'x' ? s.x : s.y, ref = [a0, a0 + TILE / 2, a0 + TILE];
            for (let i = 0; i < 3; i++) {
              const d = ref[i] - mine[i];
              if (Math.abs(d) > thr) continue;
              if (gridOn && Math.abs(d) < 0.5) continue; // already on the grid line: no guide needed
              if (!pick || Math.abs(d) < Math.abs(pick.d)) pick = { d, i, at: ref[i] };
            }
          }
          return pick;
        };
        const px = best('x'), py = best('y');
        if (px) dx += px.d;
        if (py) dy += py.d;
        const bx0 = bb.x0 + dx, bx1 = bb.x1 + dx, by0 = bb.y0 + dy, by1 = bb.y1 + dy;
        if (px) { // vertical line; spans the dragged selection plus every tile sharing that line
          let from = by0, to = by1;
          for (const s of g.others) { const v = [s.x, s.x + TILE / 2, s.x + TILE][px.i]; if (Math.abs(v - px.at) < 0.5) { from = Math.min(from, s.y); to = Math.max(to, s.y + TILE); } }
          guides.push({ v: true, at: px.at, from, to });
        }
        if (py) {
          let from = bx0, to = bx1;
          for (const s of g.others) { const v = [s.y, s.y + TILE / 2, s.y + TILE][py.i]; if (Math.abs(v - py.at) < 0.5) { from = Math.min(from, s.x); to = Math.max(to, s.x + TILE); } }
          guides.push({ v: false, at: py.at, from, to });
        }
      }
      g.dx = dx; g.dy = dy;
      const desired = {};
      for (const k of g.keys) { desired[k] = { x: g.orig[k].x + dx, y: g.orig[k].y + dy }; S.pos[k] = desired[k]; setTile(k); }
      g.desired = desired;
      const ev = evaluate(g.keys, desired, g.others);
      g.ev = ev;
      // classes: red outline on clashes, swap indicator on the target
      const flags = new Set(ev.clash); if (ev.swap) flags.add('swap:' + ev.swap);
      if (flags.size !== g.flag.size || [...flags].some((f) => !g.flag.has(f))) {
        g.flag.forEach((f) => { const r = S.items.get(f.startsWith('swap:') ? f.slice(5) : f); if (r) r.el.classList.remove('is-clash', 'is-swap-target'); });
        flags.forEach((f) => { const sw = f.startsWith('swap:'); const r = S.items.get(sw ? f.slice(5) : f); if (r) r.el.classList.add(sw ? 'is-swap-target' : 'is-clash'); });
        g.flag = flags;
      }
      showGuides(guides);
      S.miniDirty = true;
    }

    function endMove(g, commitIt) {
      showGuides([]);
      g.flag.forEach((f) => { const r = S.items.get(f.startsWith('swap:') ? f.slice(5) : f); if (r) r.el.classList.remove('is-clash', 'is-swap-target'); });
      g.keys.forEach((k) => { const r = S.items.get(k); if (r) r.el.classList.remove('is-dragging', 'is-clash'); });
      if (g.badge) g.badge.remove();
      const restore = () => g.keys.forEach((k) => { S.pos[k] = { x: g.orig[k].x, y: g.orig[k].y }; });
      if (!commitIt || !g.desired) {
        place(g.orig, true);
        if (g.selChanged) { S.sel = new Set(g.selBefore); paintSel(); }
        return;
      }
      restore(); // history must hold the pre-drag positions (the tiles themselves still show the drop point)
      const res = resolve(g.keys, g.desired, g.orig, g.others);
      const moved = !!res.swap || g.keys.some((k) => res.pos[k].x !== g.orig[k].x || res.pos[k].y !== g.orig[k].y);
      const extra = g.selChanged ? { sel: Array.from(S.sel) } : null;
      if (moved) {
        commit(res.pos, { glide: true, extra });
        if (res.swap) notify('Swapped two villagers', true);
        else if (g.skipped) notify(`${g.skipped} pinned stayed in place`, true);
      } else {
        place(g.orig, true);
        if (extra && opts.onChange) opts.onChange(extra);
      }
    }

    /* ---- marquee ---- */
    function startMarquee(g) {
      g.mode = 'marquee';
      g.anchor = toWorld(g.x0, g.y0);
      g.base = (g.mods.ctrl || g.mods.shift) ? new Set(S.sel) : new Set();
      g.base0 = new Set(S.sel);
      g.lastHits = '';
      marquee.hidden = false;
      vp.classList.add('is-marquee');
    }
    function runMarquee(g) {
      const { w, h: hh } = S.size;
      const cx = clamp(g.x, 0, w), cy = clamp(g.y, 0, hh);
      const c = toWorld(cx, cy), a = g.anchor;
      const wx0 = Math.min(a.x, c.x), wx1 = Math.max(a.x, c.x), wy0 = Math.min(a.y, c.y), wy1 = Math.max(a.y, c.y);
      const l = toLocal(wx0, wy0), r = toLocal(wx1, wy1);
      Object.assign(marquee.style, { left: l.x + 'px', top: l.y + 'px', width: r.x - l.x + 'px', height: r.y - l.y + 'px' });
      const next = new Set(g.base);
      for (const k of S.order) {
        const p = S.pos[k];
        if (p && p.x < wx1 && p.x + TILE > wx0 && p.y < wy1 && p.y + TILE > wy0) next.add(k);
      }
      const sig = Array.from(next).join('|');
      if (sig !== g.lastHits) { g.lastHits = sig; S.sel = next; paintSel(); }
    }

    /* ---- autoscroll while a drag / box reaches the edge ---- */
    function autoscroll(g) {
      const { w, h: hh } = S.size;
      const e = (v, max) => (v < EDGE ? EDGE - v : v > max - EDGE ? -(v - (max - EDGE)) : 0);
      const sx = clamp(e(g.x, w) * 0.4, -22, 22), sy = clamp(e(g.y, hh) * 0.4, -22, 22);
      g.edge = !!(sx || sy); // keep ticking while the pointer rests at an edge
      if (g.edge && performance.now() - g.t0 >= 150) setView({ z: S.view.z, px: S.view.px + sx, py: S.view.py + sy }, false);
    }

    /* ---- pinch ---- */
    function startPinch() {
      if (S.g) { const g = S.g; if (g.mode === 'move' || g.mode === 'marquee') abortGesture(); else { clearTimeout(g.timer); vp.classList.remove('is-panning'); S.g = null; } }
      const pts = Array.from(S.ptrs.values()), r = rectOf();
      const a = pts[0], b = pts[1];
      const c = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      S.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: S.view.z, w0: toWorld(c.x, c.y), r };
      cancelAnim();
    }
    function pinchMove() {
      const pts = Array.from(S.ptrs.values()); if (pts.length < 2) return;
      const p = S.pinch, a = pts[0], b = pts[1];
      const z = clamp(p.z0 * Math.hypot(a.x - b.x, a.y - b.y) / p.d0, ZMIN, ZMAX);
      const cx = (a.x + b.x) / 2 - p.r.left, cy = (a.y + b.y) / 2 - p.r.top;
      setView({ z, px: cx - p.w0.x * z, py: cy - p.w0.y * z });
    }
    function endPinch() { S.pinch = null; S.g = null; S.ptrs.clear(); }

    function onWheel(ev) {
      if (ev.target.closest('.hc-help')) return;
      hideTip();
      ev.preventDefault();
      cancelAnim();
      const r = rectOf(), lx = (ev.clientX / ZF()) - r.left, ly = (ev.clientY / ZF()) - r.top;
      let dx = ev.deltaX, dy = ev.deltaY;
      if (ev.deltaMode === 1) { dx *= 16; dy *= 16; } else if (ev.deltaMode === 2) { dx *= r.width; dy *= r.height; }
      if (ev.ctrlKey || ev.metaKey) zoomAt(lx, ly, S.view.z * Math.exp(-clamp(dy, -40, 40) * 0.0075));
      else {
        if (ev.shiftKey && !dx) { dx = dy; dy = 0; }
        setView({ z: S.view.z, px: S.view.px - dx, py: S.view.py - dy });
      }
    }

    /* ---------- frame loop ---------- */
    function frame(now) {
      raf = 0;
      if (S.tw) stepTween(now);
      const g = S.g;
      if (g && (g.mode === 'move' || g.mode === 'marquee')) {
        autoscroll(g);
        if (g.mode === 'move') runMove(g); else runMarquee(g);
        if (g.edge) schedule();
      }
      if (S.dirty) { S.dirty = false; applyView(); }
      if (S.miniDirty) { S.miniDirty = false; drawMini(); }
    }

    /* ---------- minimap ---------- */
    function colors() {
      const now = performance.now();
      if (!S.colors || now - S.colorsAt > 900) {
        const cs = getComputedStyle(root);
        S.colors = { acc: cs.getPropertyValue('--accent').trim() || '#17dd62', bg: cs.getPropertyValue('--bg-2').trim() || '#15151b', line: cs.getPropertyValue('--line-2').trim() || '#40404d', text: cs.getPropertyValue('--muted').trim() || '#aaa' };
        S.colorsAt = now;
      }
      return S.colors;
    }
    function drawMini() {
      if (mini.hidden) return;
      const W = miniCv.clientWidth, H = miniCv.clientHeight;
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      if (miniCv.width !== Math.round(W * dpr)) { miniCv.width = Math.round(W * dpr); miniCv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const c = colors(), { px, py, z } = S.view, { w, h: hh } = S.size;
      const vwr = { x0: -px / z, y0: -py / z, x1: (w - px) / z, y1: (hh - py) / z };
      const bb = bboxOf(keysArr()) || { x0: 0, y0: 0, x1: TILE, y1: TILE };
      /* World area = tile bounds + half the viewport's world size on every side, so the view rectangle stays visible when zoomed far out.
         It is re-derived only when the zoom, the viewport size, the tiles or the minimap size change — never while panning — and the
         resulting map transform (s, ox, oy) glides to the new values in ~200ms. */
      const vw = S.size.w / z, vh = hh / z;
      const key = [z.toFixed(4), S.size.w, hh, W, H, bb.x0, bb.y0, bb.x1, bb.y1].join('|');
      const now = performance.now();
      if (key !== S.mmKey) {
        S.mmKey = key;
        const x0 = bb.x0 - vw / 2, y0 = bb.y0 - vh / 2, x1 = bb.x1 + vw / 2, y1 = bb.y1 + vh / 2;
        const ts = Math.min(W / (x1 - x0), H / (y1 - y0));
        const tgt = { s: ts, ox: (W - (x1 - x0) * ts) / 2 - x0 * ts, oy: (H - (y1 - y0) * ts) / 2 - y0 * ts };
        if (!S.mmCur || S.g || !S.mmSized || S.mmSized.W !== W || S.mmSized.H !== H) { S.mmCur = tgt; S.mmFrom = null; }
        else { S.mmFrom = Object.assign({}, S.mmCur); S.mmAt = now; }
        S.mmTgt = tgt; S.mmSized = { W, H };
      }
      if (S.mmFrom) {
        const t = Math.min(1, (now - S.mmAt) / 200), e = 1 - Math.pow(1 - t, 3), f = S.mmFrom, g2 = S.mmTgt;
        S.mmCur = { s: f.s + (g2.s - f.s) * e, ox: f.ox + (g2.ox - f.ox) * e, oy: f.oy + (g2.oy - f.oy) * e };
        if (t >= 1) S.mmFrom = null; else { S.miniDirty = true; schedule(); }
      }
      const { s, ox, oy } = S.mmCur;
      S.mm = { s, ox, oy, W, H, target: S.mmTgt, animating: !!S.mmFrom };
      for (const k of S.order) {
        const p = S.pos[k], rec = S.items.get(k); if (!p) continue;
        ctx.fillStyle = (rec && rec.color) || c.acc;
        ctx.globalAlpha = S.sel.has(k) ? 1 : 0.8;
        const sz = Math.max(TILE * s, 2.5);
        ctx.fillRect(Math.round(p.x * s + ox), Math.round(p.y * s + oy), sz, sz);
        if (S.sel.has(k)) { ctx.globalAlpha = 1; ctx.strokeStyle = c.acc; ctx.lineWidth = 1; ctx.strokeRect(Math.round(p.x * s + ox) - 1.5, Math.round(p.y * s + oy) - 1.5, sz + 3, sz + 3); }
      }
      ctx.globalAlpha = 1;
      // the view rectangle is clamped to the map: when you pan away it rests against the edge instead of rescaling
      let rw = (vwr.x1 - vwr.x0) * s, rh = (vwr.y1 - vwr.y0) * s, rx = vwr.x0 * s + ox, ry = vwr.y0 * s + oy;
      rw = Math.min(rw, W - 2); rh = Math.min(rh, H - 2);
      rx = clamp(rx, 1, W - 1 - rw); ry = clamp(ry, 1, H - 1 - rh);
      ctx.fillStyle = c.acc; ctx.globalAlpha = 0.12; ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1; ctx.strokeStyle = c.acc; ctx.lineWidth = 1.5; ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    }
    function miniPan(ev) {
      if (!S.mm) return;
      const r = scaledRect(miniCv);
      const wx = ((ev.clientX / ZF()) - r.left - S.mm.ox) / S.mm.s, wy = ((ev.clientY / ZF()) - r.top - S.mm.oy) / S.mm.s;
      cancelAnim();
      setView({ z: S.view.z, px: S.size.w / 2 - wx * S.view.z, py: S.size.h / 2 - wy * S.view.z });
    }
    let miniDrag = false;
    miniCv.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); miniDrag = true; try { miniCv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } drawMini(); miniPan(ev); });
    miniCv.addEventListener('pointermove', (ev) => { if (miniDrag) miniPan(ev); });
    const miniEnd = () => { miniDrag = false; };
    miniCv.addEventListener('pointerup', miniEnd); miniCv.addEventListener('pointercancel', miniEnd);

    /* ---------- keyboard ---------- */
    function onKey(ev) {
      if (ev.target.closest && ev.target.closest('.hc-help') && ev.key !== 'Escape') return;
      const mod = ev.ctrlKey || ev.metaKey, k = ev.key;
      if (ev.target.closest && ev.target.closest('.hc-ui') && k !== 'Escape' && !mod) return; // toolbar buttons keep Space / Enter / arrows
      if (k === ' ') { ev.preventDefault(); return; }
      if (k === 'Escape') {
        if (S.g || S.pinch) { ev.preventDefault(); ev.stopPropagation(); abortGesture(); return; }
        if (!help.hidden) { ev.preventDefault(); ev.stopPropagation(); toggleHelp(false); return; }
        if (S.sel.size) { ev.preventDefault(); ev.stopPropagation(); setSel([], true); }
        return;
      }
      if (mod && (k === 'a' || k === 'A')) { ev.preventDefault(); setSel(S.order, true); return; }
      if (mod && (k === 'z' || k === 'Z')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (mod && (k === 'y' || k === 'Y')) { ev.preventDefault(); redo(); return; }
      if (mod || ev.altKey) return;
      const step = ev.shiftKey ? 8 : G;
      if (k === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); }
      else if (k === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); }
      else if (k === 'ArrowUp') { ev.preventDefault(); nudge(0, -step); }
      else if (k === 'ArrowDown') { ev.preventDefault(); nudge(0, step); }
      else if (ev.code === 'Digit1' && ev.shiftKey) { ev.preventDefault(); fit(true); }
      else if (ev.code === 'Digit2' && ev.shiftKey) { ev.preventDefault(); zoomSel(); }
      else if (k === 'f' || k === 'F') { ev.preventDefault(); fit(true); }
      else if (k === '0') { ev.preventDefault(); zoomTo(1); }
      else if (k === '+' || k === '=') { ev.preventDefault(); zoomBy(1.25); }
      else if (k === '-' || k === '_') { ev.preventDefault(); zoomBy(1 / 1.25); }
      else if (k === 'p' || k === 'P') {
        ev.preventDefault();
        if (!S.sel.size) notify('Select something to pin first', true); else if (opts.onPin) opts.onPin(Array.from(S.sel));
      }
      else if (k === '?') { ev.preventDefault(); toggleHelp(); }
    }
    const spaceOk = () => S.hover || vp.contains(document.activeElement);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' && !S.space && spaceOk() && !(ev.target.closest && ev.target.closest('input, textarea, select, .hc-ui'))) {
        S.space = true; vp.classList.add('is-space'); if (ev.target === document.body || vp.contains(ev.target)) ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => { if (ev.key === ' ' && S.space) { S.space = false; vp.classList.remove('is-space'); if (vp.contains(ev.target)) ev.preventDefault(); } });
    window.addEventListener('blur', () => { S.space = false; vp.classList.remove('is-space'); });

    function tileActivate(key, ev) {
      if (ev.detail !== 0) return; // pointer clicks are handled on pointerup
      clickSelect(key, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
    }
    function tileFocus(key, ev) {
      if (!ev.target.matches || !ev.target.matches(':focus-visible')) return;
      const p = S.pos[key]; if (!p || !S.size.w) return;
      const a = toLocal(p.x, p.y), m = 12;
      if (a.x < m || a.y < m || a.x + TILE * S.view.z > S.size.w - m || a.y + TILE * S.view.z > S.size.h - m) {
        const z = S.view.z;
        animateView({ z, px: S.size.w / 2 - (p.x + TILE / 2) * z, py: S.size.h / 2 - (p.y + TILE / 2) * z }, 200);
      }
    }

    /* ---------- tooltip (a styled panel anchored to the tile, not the mouse) ---------- */
    function hideTip() {
      clearTimeout(S.tipTimer); S.tipTimer = 0;
      if (S.tipKey != null) { S.tipKey = null; tip.hidden = true; }
    }
    function showTip(key) {
      const rec = S.items.get(key), p = S.pos[key];
      if (!rec || !p || !rec.tip || S.g || S.pinch || S.anim || (S.tw && S.tw.items[key])) return;
      tip.replaceChildren(h('b.th-tooltip-title', rec.tip.title), rec.tip.sub ? h('span.th-tooltip-sub', rec.tip.sub) : null);
      tip.hidden = false; tip.style.visibility = 'hidden';
      const a = toLocal(p.x, p.y), tw = TILE * S.view.z, w = tip.offsetWidth, hh = tip.offsetHeight, gap = 8;
      let x = a.x + tw / 2 - w / 2, y = a.y - hh - gap, below = false;
      if (y < 4) { y = a.y + tw + gap; below = true; }
      x = clamp(x, 6, Math.max(6, S.size.w - w - 6)); y = clamp(y, 4, Math.max(4, S.size.h - hh - 4));
      tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
      tip.classList.toggle('is-below', below);
      tip.style.visibility = ''; S.tipKey = key;
    }
    function armTip(key, delay) {
      hideTip();
      if (!key || S.g || S.pinch) return;
      S.tipTimer = setTimeout(() => { S.tipTimer = 0; showTip(key); }, delay);
    }
    vp.addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch') return;
      const t = ev.target.closest && ev.target.closest('.hc-tile');
      if (t) { if (t.dataset.key !== S.tipKey) armTip(t.dataset.key, 250); } else if (!ev.target.closest('.hc-tip')) hideTip();
    });
    vp.addEventListener('pointerleave', hideTip);
    vp.addEventListener('pointerdown', hideTip, true);
    vp.addEventListener('focusin', (ev) => { const t = ev.target.matches && ev.target.matches('.hc-tile:focus-visible') && ev.target; if (t) armTip(t.dataset.key, 250); });
    vp.addEventListener('focusout', hideTip);

    /* ---------- events ---------- */
    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', (ev) => { S.ptrs.delete(ev.pointerId); if (S.pinch) { if (S.ptrs.size < 2) endPinch(); } else if (S.g && S.g.id === ev.pointerId) abortGesture(); });
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('keydown', onKey);
    vp.addEventListener('contextmenu', (e) => e.preventDefault());
    vp.addEventListener('dragstart', (e) => e.preventDefault());
    vp.addEventListener('mousedown', (e) => { if (e.button === 1 && !e.target.closest('.hc-ui')) e.preventDefault(); });
    vp.addEventListener('auxclick', (e) => e.preventDefault());
    vp.addEventListener('pointerenter', () => { S.hover = true; });
    vp.addEventListener('pointerleave', () => { S.hover = false; });

    const ro = new ResizeObserver(() => {
      const w = vp.clientWidth, hh = vp.clientHeight;
      if (!w || !hh) return;
      const old = S.size;
      S.size = { w, h: hh };
      if (S.haveView && old.w && !S.needFit) { // keep the centre fixed when the viewport resizes
        const c = { x: (old.w / 2 - S.view.px) / S.view.z, y: (old.h / 2 - S.view.py) / S.view.z };
        setView({ z: S.view.z, px: w / 2 - c.x * S.view.z, py: hh / 2 - c.y * S.view.z }, false);
      }
      if (S.needFit && S.order.length) { S.needFit = false; S.haveView = true; initialView(); } else { S.dirty = true; S.miniDirty = true; schedule(); }
    });
    ro.observe(vp);

    /* ---------- data in ---------- */
    function makeTile(key) {
      const el = h('button.hc-tile', { type: 'button', 'data-key': key, 'data-focus': 'hc-t-' + key, 'aria-pressed': 'false' });
      el.addEventListener('click', (ev) => tileActivate(key, ev));
      el.addEventListener('focus', (ev) => tileFocus(key, ev));
      return el;
    }

    function update(d) {
      const busy = !!(S.g && S.g.mode !== 'pending') || !!S.pinch;
      const seen = new Set(), pinned = new Set();
      for (const it of d.items) {
        seen.add(it.key);
        let rec = S.items.get(it.key);
        if (!rec) { rec = { key: it.key, el: makeTile(it.key), sig: null, status: '' }; S.items.set(it.key, rec); world.append(rec.el); }
        rec.color = it.color; rec.label = it.label; rec.tip = it.tip || null;
        if (it.pinned) pinned.add(it.key);
        rec.el.classList.toggle('is-pinned', !!it.pinned);
        if (rec.sig !== it.sig) { rec.sig = it.sig; rec.el.replaceChildren(...[].concat(it.body()).flat(Infinity).filter(Boolean)); rec.el.setAttribute('aria-label', it.label); }
        if (rec.status !== it.status) { if (rec.status) rec.el.classList.remove('is-' + rec.status); rec.status = it.status; rec.el.classList.add('is-' + it.status); }
      }
      S.pinned = pinned;
      for (const [k, rec] of S.items) if (!seen.has(k)) { rec.el.remove(); S.items.delete(k); delete S.pos[k]; S.sel.delete(k); }
      S.order = d.items.map((i) => i.key);
      const osig = S.order.join('|');
      if (osig !== S.orderSig) {
        S.orderSig = osig;
        S.order.forEach((k, i) => { const el = S.items.get(k).el; if (world.children[i] !== el) world.insertBefore(el, world.children[i] || null); });
      }
      if (!busy) {
        const src = d.pos || {};
        const missing = [];
        for (const k of S.order) {
          const p = src[k];
          if (p && isFinite(p.x) && isFinite(p.y)) { const cur = S.pos[k]; if (!cur || cur.x !== p.x || cur.y !== p.y) { S.pos[k] = { x: p.x, y: p.y }; setTile(k); } } else missing.push(k);
        }
        if (missing.length) { const add = autoPlace(missing, S.pos); for (const k in add) { S.pos[k] = add[k]; setTile(k); } }
        S.sel = new Set((d.selected || []).filter((k) => S.items.has(k)));
        paintSel();
      }
      if (!S.viewApplied) { // the saved view only seeds the very first update; after that the canvas owns it
        S.viewApplied = true;
        // sv < 2: snap used to default on and was never distinguishable from a deliberate choice, so it is reset to off once
        if (d.view && d.view.sv === 2 && typeof d.view.snap === 'boolean') S.prefs.snap = d.view.snap;
        if (d.view && typeof d.view.grid === 'boolean') S.prefs.grid = d.view.grid;
        if (d.view && typeof d.view.guides === 'boolean') S.prefs.guides = d.view.guides;
        if (d.view && typeof d.view.map === 'boolean') S.prefs.map = d.view.map;
        if (d.view && isFinite(d.view.px) && isFinite(d.view.py) && isFinite(d.view.z)) { S.view = { px: d.view.px, py: d.view.py, z: clamp(d.view.z, ZMIN, ZMAX) }; S.needFit = false; S.haveView = true; }
      }
      if (!S.order.length) S.needFit = true;
      if (S.needFit && S.size.w && S.order.length) { S.needFit = false; S.haveView = true; initialView(); }
      updateBtns();
      S.dirty = true; S.miniDirty = true; schedule();
    }

    return {
      el: root, update, reveal, swap, minimap: () => (S.mm ? Object.assign({}, S.mm, { vw: S.size.w / S.view.z, vh: S.size.h / S.view.z, z: S.view.z }) : null), fit: () => fit(true), busy: () => !!(S.g && S.g.mode !== 'pending') || !!S.pinch,
    };
  }

  return { mount, autoPlace, shapePlace, shapes: SHAPES, pinIcon };
})();
