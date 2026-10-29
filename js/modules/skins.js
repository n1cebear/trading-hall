/**
 * Skin Editor (tool id 'skins', accent --c-skin periwinkle). Paint a Minecraft Java skin on the 3D model and on the flat
 * 64x64 sheet (both always in sync), with layers, history, versions ("presets") and a library of your skins.
 *
 * Files: js/modules/skins-engine.js (pure pixel engine, tests: tools/test-skins.js), js/modules/skins-view.js (3D viewport),
 * js/core/mc-skin.js (shared with Trims: decoding, lookups, skeleton, poses), css/skins.css.
 *
 * state.skins = {
 *   v: 1,
 *   work: { name, model, active, layers: [{ id, name, opacity, blend, visible, locked, png }], cape: png | null, libId, edited, versions: [] } | null,
 *   lib: [{ id, name, model, png, layers, cape, created, edited, tags: [], fav, versions: [{ id, name, model, png, layers, t }] }],
 *   ui: tool options, colours, view settings (see UI_DEFAULTS)
 * }
 * The page is built once and patched in place (no re-render while painting); every store write is silent.
 */
(function () {
  'use strict';
  const { h, toast, clamp, uid } = TH.util;
  const E = TH.skinsEngine;
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LOCAL = !!window.TH_LOCAL_ASSETS;
  const phoneMQ = window.matchMedia ? matchMedia('(max-width: 760px)') : { matches: false, addEventListener() {} };

  const DEFAULT_SKINS = [['steve', 'Steve', 'wide'], ['alex', 'Alex', 'slim'], ['ari', 'Ari', 'wide'], ['efe', 'Efe', 'slim'], ['kai', 'Kai', 'wide'],
    ['makena', 'Makena', 'slim'], ['noor', 'Noor', 'slim'], ['sunny', 'Sunny', 'wide'], ['zuri', 'Zuri', 'wide']];
  // public Mojang staff and well-known creator accounts (looked up live; a failure just leaves the card out)
  const COMMUNITY = ['Notch', 'jeb_', 'Dinnerbone', 'Grumm', 'deadmau5', 'Technoblade', 'Dream', 'CaptainSparklez', 'DanTDM', 'Ph1LzA'];
  const ANIMS = [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['sneak', 'Sneak'], ['crouch', 'Crouch'], ['wave', 'Wave'], ['attack', 'Attack'], ['sit', 'Sit'], ['spin', 'Spin'], ['jump', 'Jump'], ['swim', 'Swim'], ['fly', 'Fly']];
  const BGS = [
    { id: 'studio', name: 'Studio', group: 'Plain' }, { id: 'dark', name: 'Dark', group: 'Plain' }, { id: 'light', name: 'Light', group: 'Plain' },
    { id: 'checker', name: 'Checkerboard', group: 'Plain' }, { id: 'custom', name: 'Your colour', group: 'Plain' },
    { id: 'sunset', name: 'Sunset', group: 'Gradient' }, { id: 'ocean', name: 'Ocean', group: 'Gradient' }, { id: 'mint', name: 'Mint', group: 'Gradient' }, { id: 'dusk', name: 'Dusk', group: 'Gradient' },
    { id: 'plains', name: 'Plains', group: 'Scenery', tex: 'block/grass_block_side' }, { id: 'cave', name: 'Cave', group: 'Scenery', tex: 'block/stone' },
    { id: 'water', name: 'Underwater', group: 'Scenery', tex: 'block/sand' }, { id: 'snow', name: 'Snowy', group: 'Scenery', tex: 'block/snow' },
    { id: 'nether', name: 'Nether', group: 'Scenery', tex: 'block/netherrack' }, { id: 'end', name: 'The End', group: 'Scenery', tex: 'block/end_stone' },
  ];
  /* tools: [id, label, key, group, hint] */
  const TOOLS = [
    ['orbit', 'Turn and play', 'C', 'view', 'Drag to turn the model, right-drag or Shift-drag to pan. Animations play with this tool'],
    ['pencil', 'Pencil', 'B', 'draw', 'Paint pixels. Alt-click picks a colour'],
    ['eraser', 'Eraser', 'E', 'draw', 'Erase pixels'],
    ['shade', 'Shade', 'S', 'draw', 'Lighten, darken, smudge or blur what is there'],
    ['noise', 'Noise and dither', 'N', 'draw', 'Add texture: random noise or a dither of both colours'],
    ['line', 'Line', 'L', 'shape', 'Drag a straight line'],
    ['rect', 'Rectangle', 'R', 'shape', 'Drag a rectangle (filled or outline)'],
    ['ellipse', 'Ellipse', 'O', 'shape', 'Drag an ellipse (filled or outline)'],
    ['gradient', 'Gradient', 'Q', 'shape', 'Drag from the first colour to the second'],
    ['fill', 'Fill', 'G', 'fill', 'Fill an area of one colour'],
    ['replace', 'Replace colour', 'F', 'fill', 'Click a colour: every pixel of it becomes the current colour'],
    ['picker', 'Colour picker', 'I', 'fill', 'Click to take a colour'],
    ['select', 'Select', 'M', 'select', 'Select pixels: box, lasso, magic wand or one colour'],
    ['move', 'Move', 'V', 'select', 'Drag the selection (or the whole layer) to move it'],
  ];
  const TOOL = Object.fromEntries(TOOLS.map((t) => [t[0], { id: t[0], label: t[1], key: t[2], group: t[3], hint: t[4] }]));
  const PAINT_TOOLS = new Set(['pencil', 'eraser', 'shade', 'noise']);
  const SHAPE_TOOLS = new Set(['line', 'rect', 'ellipse', 'gradient']);
  const BASE_PARTS = [['head', 'Head'], ['body', 'Body'], ['rarm', 'Right arm'], ['larm', 'Left arm'], ['rleg', 'Right leg'], ['lleg', 'Left leg']];
  const MC_PALETTE = ['#f9fffe', '#9d9d97', '#474f52', '#1d1d21', '#835432', '#b02e26', '#f9801d', '#fed83d', '#80c71f', '#5e7c16', '#169c9c', '#3ab3da', '#3c44aa', '#8932b8', '#c74ebd', '#f38baa',
    '#f9d4b4', '#e0ac7c', '#c68642', '#8d5524', '#5c3a21', '#3b2416', '#2b1d0e', '#1f2a44'];

  const UI_DEFAULTS = {
    tool: 'pencil', size: 1, shape: 'square', hardness: 1, opacity: 1, amount: 0.25, shadeMode: 'darken', noiseMode: 'noise', tolerance: 0, contiguous: true, limit: 'none',
    sample: 'layer', filled: false, gradType: 'linear', gradSteps: 0, dither: false, selMode: 'rect', selOp: 'new', sym: { body: false, faceX: false, faceY: false },
    color: '#3c44aaff', color2: '#f9fffeff', recent: [], palettes: [], anim: 'idle', speed: 1, bg: 'studio', bgColor: '#20212b', lit: true, overlay: 'none', gameLook: true,
    main: 'model', dock: true, dockZoom: 4, sheetZoom: 0, sheetGrid: true, sheetLabels: false, hidden: {}, locks: {}, capeOn: true, elytra: false, side: 'versions', view: 'model', defModel: 'auto',
  };
  const defaults = () => ({ v: 1, work: null, lib: [], ui: JSON.parse(JSON.stringify(UI_DEFAULTS)) });
  function norm(s) {
    if (!s || typeof s !== 'object') s = defaults();
    s.v = 1;
    if (!Array.isArray(s.lib)) s.lib = [];
    s.lib = s.lib.filter((x) => x && typeof x.png === 'string');
    s.lib.forEach((x) => { if (!Array.isArray(x.tags)) x.tags = []; if (!Array.isArray(x.versions)) x.versions = []; x.model = x.model === 'slim' ? 'slim' : 'classic'; x.fav = !!x.fav; });
    s.ui = Object.assign(JSON.parse(JSON.stringify(UI_DEFAULTS)), s.ui && typeof s.ui === 'object' ? s.ui : {});
    const u = s.ui;
    u.sym = Object.assign({ body: false, faceX: false, faceY: false }, u.sym);
    if (!TOOL[u.tool]) u.tool = 'pencil';
    u.size = clamp(Math.round(+u.size || 1), 1, 8);
    ['opacity', 'hardness', 'amount'].forEach((k) => { u[k] = clamp(+u[k], 0, 1); if (!Number.isFinite(u[k])) u[k] = UI_DEFAULTS[k]; });
    if (!E.hex2rgba(u.color)) u.color = UI_DEFAULTS.color;
    if (!E.hex2rgba(u.color2)) u.color2 = UI_DEFAULTS.color2;
    if (!Array.isArray(u.recent)) u.recent = [];
    if (!Array.isArray(u.palettes)) u.palettes = [];
    if (!ANIMS.some((a) => a[0] === u.anim)) u.anim = 'idle';
    if (!BGS.some((b) => b.id === u.bg)) u.bg = 'studio';
    if (!['none', 'grid', 'parts'].includes(u.overlay)) u.overlay = 'none';
    if (!['model', 'sheet'].includes(u.main)) u.main = 'model';
    u.dock = u.dock !== false; u.dockZoom = clamp(Math.round(+u.dockZoom || 4), 2, 8);
    delete u.view; delete u.sheetOpen;
    if (!['versions', 'history'].includes(u.side)) u.side = 'versions';
    if (typeof u.hidden !== 'object' || !u.hidden) u.hidden = {};
    if (typeof u.locks !== 'object' || !u.locks) u.locks = {};
    if (s.work && (!Array.isArray(s.work.layers) || !s.work.layers.length)) s.work = null;
    if (s.work && !Array.isArray(s.work.versions)) s.work.versions = [];
    return s;
  }
  const st = () => TH.store.get().skins;
  const ui = () => st().ui;
  const save = (fn) => TH.store.update((s) => fn(s.skins), { silent: true });

  /* ====================================================================== small helpers */
  const ICON = {
    orbit: 'M4 10a6 6 0 0 1 10.5-4M16 10a6 6 0 0 1-10.5 4M14 2v4h-4M6 18v-4h4',
    pencil: 'M3 17l1-4 9-9 3 3-9 9zM12 5l3 3',
    eraser: 'M3 13l7-7 6 6-5 5H6zM8 17h9',
    shade: 'M4 4h12v12H4zM4 16L16 4M10 16l6-6M4 10l6-6',
    noise: 'M4 4h2v2H4zM10 4h2v2h-2zM7 7h2v2H7zM13 7h2v2h-2zM4 10h2v2H4zM10 10h2v2h-2zM7 13h2v2H7zM14 14h2v2h-2z',
    line: 'M4 16L16 4M3 15h3v3H3zM14 2h3v3h-3z',
    rect: 'M4 5h12v10H4z',
    ellipse: 'M10 4c4 0 7 2.7 7 6s-3 6-7 6-7-2.7-7-6 3-6 7-6z',
    gradient: 'M4 4h12v12H4zM8 4v12M12 4v12M16 4v12',
    fill: 'M5 9l5-5 6 6-5 5zM5 9h11M17 13c0 1.5 1 2.5 1 3.5a1 1 0 0 1-2 0c0-1 1-2 1-3.5z',
    replace: 'M3 3h6v6H3zM11 11h6v6h-6zM12 5h3v3M15 5l-3 3M8 15H5v-3M5 15l3-3',
    picker: 'M13 3l4 4-2 2-4-4zM11 5l-7 7v3h3l7-7M4 15l-1 2',
    select: 'M3 3h3M8 3h4M14 3h3v3M17 8v4M17 14v3h-3M12 17H8M6 17H3v-3M3 12V8M3 6V3',
    move: 'M10 2v16M2 10h16M10 2L7 5M10 2l3 3M10 18l-3-3M10 18l3-3M2 10l3-3M2 10l3 3M18 10l-3-3M18 10l-3 3',
    mirror: 'M10 2v16M8 5L3 10l5 5zM12 5l5 5-5 5z',
    adjust: 'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M9 13v4',
    parts: 'M7 2h6v5H7zM6 8h8v6H6zM3 8h2v6H3zM15 8h2v6h-2zM7 15h2v4H7zM11 15h2v4h-2z',
    ref: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 8h1',
    undo: 'M7 4L3 8l4 4M3 8h9a5 5 0 0 1 0 10H8',
    redo: 'M13 4l4 4-4 4M17 8H8a5 5 0 0 0 0 10h4',
    eye: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 8h.01M8 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
    lock: 'M5 9h10v8H5zM7 9V6a3 3 0 0 1 6 0v3',
    plus: 'M10 4v12M4 10h12', x: 'M5 5l10 10M15 5L5 15', up: 'M10 4v12M5 9l5-5 5 5', down: 'M10 16V4M5 11l5 5 5-5',
    copy: 'M7 7h10v10H7zM3 13V3h10', merge: 'M5 3v5l5 5 5-5V3M10 13v4', play: 'M6 4l10 6-10 6z', pause: 'M5 4h3v12H5zM12 4h3v12h-3z',
    reset: 'M4 10a6 6 0 1 0 2-4.5M4 3v4h4', cam: 'M3 6h3l2-2h4l2 2h3v10H3zM10 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    grid: 'M3 3h14v14H3zM8 3v14M13 3v14M3 8h14M3 13h14', light: 'M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M4.5 15.5L6 14M14 6l1.5-1.5M7 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
    cape: 'M6 3h8l2 14-6-2-6 2z', wing: 'M10 6c-3-3-7-2-8 2 3 0 5 2 6 6 1-3 2-5 2-8zM10 6c3-3 7-2 8 2-3 0-5 2-6 6-1-3-2-5-2-8z',
    heart: 'M10 17l-6-6a3.5 3.5 0 0 1 6-4 3.5 3.5 0 0 1 6 4z', edit: 'M3 17l1-4 9-9 3 3-9 9z', dl: 'M10 3v10M5 9l5 5 5-5M3 17h14',
    swap: 'M5 7h10l-3-3M15 13H5l3 3', help: 'M7 7a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.7M10 15h.01', zoomin: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM12 12l5 5M6 8h4M8 6v4', zoomout: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM12 12l5 5M6 8h4',
    flipH: 'M10 2v16M7 5L3 10l4 5zM13 5l4 5-4 5', flipV: 'M2 10h16M5 7l5-4 5 4zM5 13l5 4 5-4', rotL: 'M4 10a6 6 0 1 0 2-4.5M4 3v4h4', rotR: 'M16 10a6 6 0 1 1-2-4.5M16 3v4h-4',
    check: 'M4 10l4 4 8-8', side: 'M3 3h14v14H3zM12 3v14',
  };
  function ico(name, size) {
    const s = document.createElement('span');
    s.className = 'sk-ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 20 20" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="' + ICON[name] + '"/></svg>';
    return s;
  }
  /** tooltip: [title, ...sub lines] (function = live) */
  function tip(el, lines) {
    const get = typeof lines === 'function' ? lines : () => lines;
    TH.util.tooltip(el, () => { const L = get(); if (!L) return null; return (Array.isArray(L) ? L : [L]).filter(Boolean).map((l, i) => h(i ? 'div.th-tooltip-sub' : 'div.th-tooltip-title', l)); });
    return el;
  }
  const keyName = (k) => (k ? ' (' + k + ')' : '');
  /** square icon key */
  function ibtn(icon, label, onclick, opts) {
    const o = opts || {};
    const b = h('button.btn.sk-ib' + (o.cls ? '.' + o.cls : ''), { type: 'button', 'aria-label': label + (o.key ? ', ' + o.key : ''), onclick, 'data-focus': o.focus || null }, ico(icon, o.size || 18), o.text ? h('span.sk-ibt', o.text) : null);
    tip(b, o.tip || [label + keyName(o.key)].concat(o.sub ? [o.sub] : []));
    return b;
  }
  /** set CSS custom properties (TH.util.h drops '--x' keys of a style object) */
  const vars = (el, o) => { Object.keys(o).forEach((k) => el.style.setProperty(k, o[k])); return el; };
  const press = (b, on) => { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on)); };
  const sel = (b, on) => { b.classList.toggle('on', !!on); b.setAttribute('aria-checked', String(!!on)); };
  /** an exclusive .seg of text keys: items [[value, label, tip]] */
  function seg(label, items, get, set, cls) {
    const keys = items.map(([v, l, t]) => { const b = h('button', { type: 'button', role: 'radio', 'data-v': String(v), onclick: () => { set(v); paint(); } }, l); if (t) tip(b, t); return b; });
    const el = h('div.seg.sk-seg' + (cls ? '.' + cls : ''), { role: 'radiogroup', 'aria-label': label }, keys);
    const paint = () => { const cur = String(get()); keys.forEach((b) => { const on = b.dataset.v === cur; sel(b, on); b.tabIndex = on ? 0 : -1; }); };
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const i = keys.findIndex((b) => b.classList.contains('on')), j = (i + d + keys.length) % keys.length;
      keys[j].focus(); keys[j].click();
    });
    el.paint = paint; paint();
    return el;
  }
  /** a labelled slider (the shared .slider) showing its value; fmt(value) -> text */
  function slider(label, min, max, step, get, set, fmt, onEnd) {
    const out = h('span.sk-sval');
    const inp = h('input.slider', { type: 'range', min, max, step, 'aria-label': label,
      oninput: () => { set(+inp.value); out.textContent = fmt(+inp.value); }, onchange: () => onEnd && onEnd(+inp.value) });
    const el = h('label.sk-slider', h('span.sk-slbl', label), inp, out);
    el.paint = () => { const v = get(); if (+inp.value !== v) inp.value = v; out.textContent = fmt(v); };
    el.paint();
    return el;
  }
  /** a small toggle key (aria-pressed) */
  function toggle(label, get, set, opts) {
    const o = opts || {};
    const b = h('button.btn.small.sk-tg', { type: 'button', onclick: () => { set(!get()); b.paint(); } }, o.icon ? ico(o.icon, 16) : null, o.text === false ? null : h('span', label));
    if (o.text === false) b.setAttribute('aria-label', label);
    tip(b, o.tip || label);
    b.paint = () => press(b, get());
    b.paint();
    return b;
  }

  /* ---- pixels <-> images ---- */
  const mkCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  function bufToCanvas(buf, cv) {
    const c = cv || mkCanvas(buf.w, buf.h);
    if (c.width !== buf.w || c.height !== buf.h) { c.width = buf.w; c.height = buf.h; }
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), 0, 0);
    return c;
  }
  const bufToURL = (buf) => { try { return bufToCanvas(buf).toDataURL('image/png'); } catch (e) { return E.pngDataURL(buf); } };
  const imgToBuf = (img) => {
    const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height, c = mkCanvas(w, hh), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, hh);
    return { w, h: hh, data: d.data };
  };
  const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url; });
  const urlToBuf = async (url) => imgToBuf(await loadImage(url));
  const fileToURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
  const texURL = (name, kind) => TH.icon.tex('entity/player/' + kind + '/' + name);
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  /**
   * A 3/4 view of the whole player from the front-right, drawn with 2D canvas transforms (one affine transform per
   * visible face, back to front): the gallery / library / version thumbnails. Base layer as the game shows it (solid).
   */
  const ISO = (() => {
    const th = 0.62, ph = 0.32, R = [Math.cos(th), 0, Math.sin(th) * -1], F = [Math.sin(th) * -1 * Math.cos(ph) * -1, Math.sin(ph), Math.cos(th) * Math.cos(ph)];
    // camera from the front-left of the screen = the model's right side: right vector R, towards-camera F, up U = F x R
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const Rv = [Math.cos(th), 0, Math.sin(th)], Fv = [-Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)], Uv = cross(Fv, Rv);
    void R; void F;
    return { R: Rv, F: Fv, U: Uv };
  })();
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function isoRender(buf, slim, size, cv) {
    const c = cv || mkCanvas(size, size), x = c.getContext('2d');
    c.width = size; c.height = size;
    x.clearRect(0, 0, size, size);
    const show = E.cloneBuf(buf); E.flattenBase(show, slim ? 'slim' : 'classic', 'game');
    const src = bufToCanvas(show);
    const model = slim ? 'slim' : 'classic', faces = [];
    TH.mcSkin.skinParts(slim).forEach((p) => {
      const [bx, by, bz, w, hh, d] = p.box, g = p.g || 0, x0 = bx - g, x1 = bx + w + g, y0 = by - g, y1 = by + hh + g, z0 = bz - g, z1 = bz + d + g;
      const C = { front: [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [0, 0, 1]], back: [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [0, 0, -1]],
        right: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [-1, 0, 0]], left: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [1, 0, 0]],
        top: [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [0, 1, 0]], bottom: [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [0, -1, 0]] };
      Object.keys(C).forEach((f) => {
        const [tl, tr, bl, n] = C[f];
        if (dot(n, ISO.F) <= 0.01) return;
        const r = E.rectOf(model, p.id, f), mid = [(tr[0] + bl[0]) / 2, (tr[1] + bl[1]) / 2, (tr[2] + bl[2]) / 2];
        faces.push({ r, tl, tr, bl, z: dot(mid, ISO.F) + (g ? 0.01 : 0), shade: f === 'top' ? 1 : f === 'front' ? 0.86 : 0.7 });
      });
    });
    faces.sort((a, b) => a.z - b.z);
    const k = size / 40, ox = size / 2, oy = size * 0.94;
    const P = (p) => [ox + dot(p, ISO.R) * k, oy - dot(p, ISO.U) * k];
    x.imageSmoothingEnabled = false;
    faces.forEach((f) => {
      const a = P(f.tl), b = P(f.tr), cc = P(f.bl), r = f.r;
      x.setTransform((b[0] - a[0]) / r.w, (b[1] - a[1]) / r.w, (cc[0] - a[0]) / r.h, (cc[1] - a[1]) / r.h, a[0], a[1]);
      x.filter = f.shade < 1 ? 'brightness(' + f.shade + ')' : 'none';
      x.drawImage(src, r.x, r.y, r.w, r.h, -0.02, -0.02, r.w + 0.04, r.h + 0.04);
    });
    x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
    return c;
  }

  /* ====================================================================== the editor core (document, history, painting) */
  const V = TH.skinsView.create();
  const ED = {
    doc: E.newDoc('classic'), comp: E.newBuf(), disp: E.newBuf(), hist: new E.History({ maxSteps: 200, maxBytes: 8e6 }),
    sel: null, float: null, clip: null, stroke: null, shape: null, hover: null, loaded: false, peek: null,
    cape: null, capeCv: null,
  };
  const model = () => ED.doc.model;
  const layer = () => ED.doc.layers[ED.doc.active];
  let usedMaskCache = {};
  const usedMask = (m) => usedMaskCache[m] || (usedMaskCache[m] = Uint8Array.from(E.regionMap(m), (v) => (v >= 0 ? 1 : 0)));
  const selActive = () => ED.sel && E.selCount(ED.sel) > 0;

  /** what a tool may change: used pixels, not in a locked part, inside the "stay inside" region and the selection */
  function maskFor(px, py, limit) {
    const m = usedMask(model()).slice();
    const locked = Object.keys(ui().locks).filter((k) => ui().locks[k]);
    if (locked.length) { const L = E.partsMask(model(), locked); for (let i = 0; i < m.length; i++) if (L[i]) m[i] = 0; }
    const lim = limit || ui().limit;
    if ((lim === 'face' || lim === 'part') && px != null) { const R = E.regionMask(model(), px, py, lim); if (R) for (let i = 0; i < m.length; i++) m[i] &= R[i]; }
    if (selActive()) for (let i = 0; i < m.length; i++) m[i] &= ED.sel[i];
    return m;
  }
  /** recomposite (rect or all), refresh the display buffer (game look) and push it to the 3D view + the sheet */
  function touched(rect, opts) {
    if (ED.float) rect = null;
    if (rect) E.composite(ED.doc, ED.comp, rect); else E.composite(ED.doc, ED.comp);
    if (ED.float) E.drop(ED.comp, ED.float.piece);
    ED.disp.data.set(ED.comp.data);
    if (ui().gameLook) E.flattenBase(ED.disp, model(), 'game');
    if (!ED.peek) {
      if (rect && !(opts && opts.full)) V.updateRect(ED.disp, rect); else V.setSkin(ED.disp, model() === 'slim');
      Sheet.invalidate();
    }
    if (!(opts && opts.quiet)) markEdited();
  }
  /** show another skin for a moment (version compare); null = back to the working copy */
  function peek(buf, slim) {
    ED.peek = buf ? { buf, slim } : null;
    if (buf) { const d = E.cloneBuf(buf); if (ui().gameLook) E.flattenBase(d, slim ? 'slim' : 'classic', 'game'); V.setSkin(d, slim); }
    else V.setSkin(ED.disp, model() === 'slim');
    Sheet.invalidate();
  }

  /* ---- edited state + autosave of the working copy (PNG per layer, debounced) ---- */
  let saveT = 0;
  function markEdited() {
    if (!ED.loaded) return;
    const s = st();
    if (s.work && !s.work.edited) save((x) => { x.work.edited = true; });
    patchStatus();
    clearTimeout(saveT); saveT = setTimeout(flushWork, 700);
  }
  function workFromDoc(extra) {
    const prev = st().work || {};
    return Object.assign({ name: prev.name || 'My skin', libId: prev.libId || null, edited: !!prev.edited, versions: prev.versions || [], cape: prev.cape || null }, extra || {}, {
      model: ED.doc.model, active: ED.doc.active,
      layers: ED.doc.layers.map((L) => ({ id: L.id, name: L.name, opacity: L.opacity, blend: L.blend, visible: L.visible, locked: L.locked, png: bufToURL(L.buf) })),
    });
  }
  function flushWork() {
    clearTimeout(saveT);
    if (!ED.loaded) return;
    try { const w = workFromDoc(); save((s) => { s.work = w; }); } catch (e) { /* storage full: the toolbar shows NOT SAVED */ }
  }
  async function docFromSaved(w) {
    const doc = { model: w.model === 'slim' ? 'slim' : 'classic', active: 0, layers: [] };
    for (const L of (w.layers || [{ name: 'Skin', png: w.png }])) {
      let buf;
      try { const b = await urlToBuf(L.png); buf = b.w === 64 && b.h === 64 ? { w: 64, h: 64, data: new Uint8ClampedArray(b.data) } : E.newBuf(); } catch (e) { buf = E.newBuf(); }
      doc.layers.push(Object.assign(E.newLayer(L.name || 'Skin', buf), L.id ? { id: L.id } : {}, { opacity: L.opacity == null ? 1 : L.opacity, blend: E.BLENDS.includes(L.blend) ? L.blend : 'normal', visible: L.visible !== false, locked: !!L.locked }));
    }
    if (!doc.layers.length) doc.layers.push(E.newLayer('Skin'));
    doc.active = clamp(w.active | 0, 0, doc.layers.length - 1);
    return doc;
  }

  /** replace the document (new skin / open / restore a version). meta = new working-copy fields (name, libId, ...). */
  function setDoc(doc, meta, opts) {
    commitFloat();
    ED.doc = doc; ED.sel = null; ED.stroke = null; ED.shape = null; ED.peek = null;
    if (!(opts && opts.keepHistory)) ED.hist.clear();
    usedMaskCache = {};
    ED.loaded = true;
    if (meta) { const w = workFromDoc(Object.assign({ edited: false, versions: [], libId: null }, meta)); save((s) => { s.work = w; }); }
    touched(null, { quiet: !(opts && opts.edited), full: true });
    if (meta && 'cape' in meta) loadCape(meta.cape);
    patchAll();
  }
  /* ---- one-shot operations with an undo step ---- */
  function op(name, fn, opts) {
    const L = layer();
    if (!L) return null;
    if (L.locked && !(opts && opts.ignoreLock)) { toast('This layer is locked'); return null; }
    commitFloat();
    const before = E.cloneBuf(L.buf), r = fn(L.buf, L);
    if (!r) return null;
    if (ED.hist.pixels(name, L.id, before, L.buf)) { touched(r === true ? null : r); patchHistory(); patchPalette(); }
    return r;
  }
  function docOp(name, fn) {
    commitFloat();
    const before = E.snapshot(ED.doc), r = fn(ED.doc);
    if (r === false) return false;
    ED.hist.doc(name, before, E.snapshot(ED.doc));
    usedMaskCache = {};
    touched(null, { full: true });
    patchAll();
    return true;
  }
  function undo() { if (ED.stroke) return; commitFloat(); const r = ED.hist.undo(ED.doc); if (!r) { toast('Nothing to undo'); return; } afterHist(r); toast('Undo: ' + r.name); }
  function redo() { if (ED.stroke) return; commitFloat(); const r = ED.hist.redo(ED.doc); if (!r) { toast('Nothing to redo'); return; } afterHist(r); toast('Redo: ' + r.name); }
  function afterHist(r) { if (r.all) { usedMaskCache = {}; touched(null, { full: true }); patchAll(); } else { touched(r.rect); patchHistory(); patchPalette(); } }

  /* ---- strokes (shared by the 3D view and the sheet) ---- */
  function strokeOpts(px, py, secondary) {
    const u = ui(), t = u.tool;
    const tool = t === 'eraser' ? 'eraser' : t === 'shade' ? u.shadeMode : t === 'noise' ? u.noiseMode : 'pencil';
    const c1 = E.hex2rgba(secondary ? u.color2 : u.color), c2 = E.hex2rgba(secondary ? u.color : u.color2);
    return { tool, color: c1, color2: c2, size: u.size, shape: u.shape, hardness: u.hardness, opacity: u.opacity, amount: t === 'noise' && u.noiseMode === 'dither' ? 0.5 : u.amount,
      mask: maskFor(px, py), model: model(), sym: u.sym, seed: (Math.random() * 1e6) | 0 };
  }
  function strokeStart(px, py, secondary) {
    const L = layer();
    if (!L) return false;
    if (L.locked) { toast('This layer is locked'); return false; }
    if (!L.visible) toast('The active layer is hidden');
    commitFloat();
    ED.stroke = { before: E.cloneBuf(L.buf), st: E.beginStroke(L.buf, strokeOpts(px, py, secondary)), layer: L, secondary, name: TOOL[ui().tool].label };
    touched(E.strokeTo(ED.stroke.st, px, py));
    return true;
  }
  function strokeMove(px, py, connect) {
    const S = ED.stroke;
    if (!S) return;
    if (!connect) S.st.last = null;
    const r = E.strokeTo(S.st, px, py);
    if (r) touched(r);
  }
  function strokeEnd() {
    const S = ED.stroke;
    if (!S) return;
    ED.stroke = null;
    if (ED.hist.pixels(S.name, S.layer.id, S.before, S.layer.buf)) {
      if (ui().tool === 'pencil' || ui().tool === 'noise') pushRecent(S.secondary ? ui().color2 : ui().color);
      patchHistory(); patchPalette();
    }
  }
  function strokeCancel() { const S = ED.stroke; if (!S) return; ED.stroke = null; S.layer.buf.data.set(S.before.data); touched(null); }

  /* ---- shapes: preview pixels while dragging, painted on release ---- */
  function shapePts(t, a, b) {
    if (t === 'rect') return E.rectPts(a[0], a[1], b[0], b[1], ui().filled);
    if (t === 'ellipse') return E.ellipsePts(a[0], a[1], b[0], b[1], ui().filled);
    return E.linePts(a[0], a[1], b[0], b[1]);
  }
  function shapeApply(a, b, secondary) {
    const t = ui().tool, u = ui();
    if (t === 'gradient') {
      const c1 = E.hex2rgba(secondary ? u.color2 : u.color), c2 = E.hex2rgba(secondary ? u.color : u.color2);
      return op('Gradient', (buf) => E.gradient(buf, a[0], a[1], b[0], b[1], { type: u.gradType, c1, c2, steps: u.gradSteps, dither: u.dither, mask: maskFor(a[0], a[1], u.limit === 'none' && !selActive() ? 'face' : u.limit), opacity: u.opacity }));
    }
    const o = strokeOpts(a[0], a[1], secondary);
    o.tool = 'pencil';
    const r = op(TOOL[t].label, (buf) => { const s = E.beginStroke(buf, o); shapePts(t, a, b).forEach(([x, y]) => { s.last = null; E.strokeTo(s, x, y); }); return s.dirty.r; });
    if (r) pushRecent(secondary ? u.color2 : u.color);
    return r;
  }

  /* ---- click tools ---- */
  function clickTool(px, py, secondary, ev) {
    const u = ui(), t = u.tool, c = E.hex2rgba(secondary ? u.color2 : u.color);
    if (t === 'picker') return pickAt(px, py, secondary);
    if (t === 'fill') {
      const sample = u.sample === 'all' ? ED.comp : null;
      const r = op('Fill', (buf) => E.fill(buf, px, py, c, { tolerance: u.tolerance, contiguous: u.contiguous, limit: u.limit, model: model(), mask: maskFor(null), sample, opacity: u.opacity }));
      if (r) pushRecent(secondary ? u.color2 : u.color);
      return r;
    }
    if (t === 'replace') {
      const from = E.get(u.sample === 'all' ? ED.comp : layer().buf, px, py);
      const r = op('Replace colour', (buf) => E.replaceColor(buf, from, c, u.tolerance, maskFor(null)));
      if (r) { pushRecent(secondary ? u.color2 : u.color); toast('Replaced ' + E.rgba2hex(from)); }
      return r;
    }
    if (t === 'select' && (u.selMode === 'wand' || u.selMode === 'colour')) {
      const s = E.selWand(u.sample === 'all' ? ED.comp : layer().buf, px, py, { tolerance: u.tolerance, contiguous: u.selMode === 'wand', limit: u.limit, model: model() });
      setSel(combineSel(s, ev));
    }
    return null;
  }
  function pickAt(px, py, secondary) {
    const c = E.pickColor(ui().sample === 'layer' && ui().tool === 'picker' ? layer().buf : ED.comp, px, py);
    if (!c) return;
    if (!c[3]) { toast('That pixel is transparent'); return; }
    setColor(E.rgba2hex(c, true), secondary ? 1 : 0);
    toast('Picked ' + E.rgba2hex(c));
  }
  const combineSel = (s, ev) => {
    const o = ev && ev.shiftKey ? 'add' : ev && ev.altKey ? 'sub' : ui().selOp;
    if (o === 'new' || !ED.sel) return o === 'sub' ? null : s;
    return E.selCombine(ED.sel, s, o);
  };
  function setSel(s) { commitFloat(); ED.sel = s && E.selCount(s) ? s : null; Sheet.invalidate(); patchOptions(); }

  /* ---- floating selection (move tool, paste) ---- */
  function liftSel() {
    if (ED.float) return true;
    const L = layer();
    if (L.locked) { toast('This layer is locked'); return false; }
    const s = selActive() ? ED.sel : usedMask(model());
    const before = E.cloneBuf(L.buf), piece = E.lift(L.buf, s, true);
    if (!piece) { L.buf.data.set(before.data); toast('Nothing to move here'); return false; }
    ED.float = { piece, before, layer: L, name: 'Move' };
    return true;
  }
  function moveFloat(dx, dy) { if (!ED.float && !liftSel()) return; ED.float.piece.x += dx; ED.float.piece.y += dy; touched(null); }
  function transformFloat(kind) {
    if (!ED.float && !liftSel()) return;
    ED.float.piece = E.flTransform(ED.float.piece, kind);
    ED.float.name = { flipH: 'Flip', flipV: 'Flip', rotCW: 'Rotate', rotCCW: 'Rotate' }[kind] || 'Move';
    touched(null);
  }
  function commitFloat() {
    const F = ED.float;
    if (!F) return;
    ED.float = null;
    E.drop(F.layer.buf, F.piece);
    if (ED.sel) {   // the selection follows the moved pixels
      const s = E.selNew();
      for (let y = 0; y < F.piece.h; y++) for (let x = 0; x < F.piece.w; x++) { const tx = F.piece.x + x, ty = F.piece.y + y; if (tx >= 0 && ty >= 0 && tx < 64 && ty < 64 && F.piece.data[(y * F.piece.w + x) * 4 + 3]) s[ty * 64 + tx] = 1; }
      ED.sel = s;
    }
    if (ED.hist.pixels(F.name, F.layer.id, F.before, F.layer.buf)) patchHistory();
    touched(null);
  }
  function cancelFloat() { const F = ED.float; if (!F) return; ED.float = null; F.layer.buf.data.set(F.before.data); touched(null); }
  function copySel(cut) {
    const s = selActive() ? ED.sel : null;
    if (!s) { toast('Select something first (M)'); return; }
    commitFloat();
    if (cut) op('Cut', (buf) => { ED.clip = E.lift(buf, s, true); return true; });
    else ED.clip = E.lift(layer().buf, s, false);
    toast(cut ? 'Cut' : 'Copied');
  }
  function pasteSel() {
    if (!ED.clip) return false;
    commitFloat();
    const L = layer();
    if (L.locked) { toast('This layer is locked'); return true; }
    const p = { x: ED.clip.x, y: ED.clip.y, w: ED.clip.w, h: ED.clip.h, data: new Uint8ClampedArray(ED.clip.data) };
    if (ED.hover) { p.x = ED.hover[0]; p.y = ED.hover[1]; }
    ED.float = { piece: p, before: E.cloneBuf(L.buf), layer: L, name: 'Paste' };
    setTool('move');
    touched(null);
    toast('Pasted: drag it into place, Enter drops it');
    return true;
  }
  function deleteSel() {
    if (ED.float) { cancelFloat(); }
    if (!selActive()) { toast('Select something first (M)'); return; }
    op('Delete', (buf) => { E.lift(buf, ED.sel, true); return true; });
  }

  /* ====================================================================== colours */
  /** slot 0 = primary, 1 = secondary */
  function setColor(hex, slot) {
    const c = E.hex2rgba(hex);
    if (!c) return;
    const v = E.rgba2hex(c, true).length === 7 ? E.rgba2hex(c) + 'ff' : E.rgba2hex(c, true);
    save((s) => { if (slot) s.ui.color2 = v; else s.ui.color = v; });
    patchColor();
  }
  function swapColors() { save((s) => { const t = s.ui.color; s.ui.color = s.ui.color2; s.ui.color2 = t; }); patchColor(); }
  function pushRecent(hex) {
    const v = String(hex).slice(0, 9).toLowerCase();
    save((s) => { s.ui.recent = [v].concat(s.ui.recent.filter((x) => x !== v)).slice(0, 14); });
    patchRecent();
  }

  /* ====================================================================== opening skins */
  /** an image (url) -> working copy. meta: { name, source } */
  async function openImageURL(url, meta, opts) {
    const img = await urlToBuf(url);
    const r = E.importImage(img, opts && opts.model ? { model: opts.model } : null);
    r.notes.forEach((n) => toast(n));
    const doc = E.newDoc(r.model, { w: 64, h: 64, data: new Uint8ClampedArray(r.buf.data) });
    setDoc(doc, Object.assign({ name: 'My skin', cape: null }, meta));
    return r;
  }
  async function openFile(f) {
    try {
      if (!/png$/i.test(f.type || '') && !/\.png$/i.test(f.name || '')) {
        if (/json$/i.test(f.type || '') || /\.json$/i.test(f.name || '')) return importCollection(await f.text());
        throw new Error('Please choose a PNG skin');
      }
      if (f.size > 2e6) throw new Error('That file is too large for a skin');
      const url = await fileToURL(f);
      await confirmLeave();
      await openImageURL(url, { name: (f.name || 'My skin').replace(/\.png$/i, '').slice(0, 40) });
      toast('Opened ' + (f.name || 'the skin'));
      closeSheet();
    } catch (e) { toast(e && e.message ? e.message : 'Could not open that file'); }
  }
  /** Ask before throwing away unsaved edits (the working copy is kept as a version so nothing is lost). */
  async function confirmLeave() {
    const w = st().work;
    if (!w || !w.edited || !ED.loaded) return true;
    if (w.libId && st().lib.some((x) => x.id === w.libId && x.png === bufToURL(ED.comp))) return true;
    // never lose work: park the edits as their own entry in My skins (a saved original is never overwritten silently)
    save((s) => { s.work.name = (s.work.name || 'My skin').replace(/ (unsaved edits)$/, '') + ' (unsaved edits)'; });
    saveToLibrary({ quiet: true, asNew: true });
    toast('Your unsaved edits were kept in My skins');
    return true;
  }
  async function openDefault(name, kind) {
    try {
      await confirmLeave();
      await openImageURL(texURL(name, kind), { name: name[0].toUpperCase() + name.slice(1) + ' copy' }, { model: kind === 'slim' ? 'slim' : 'classic' });
      toast('Editing a copy of ' + name[0].toUpperCase() + name.slice(1));
      closeSheet();
    } catch (e) { toast('Could not load that skin'); }
  }
  async function openUsername(name) {
    name = String(name || '').trim();
    if (LOCAL) { toast('Username lookups need the online toolbox'); return; }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) { toast('Usernames are 1–16 letters, digits or _'); return; }
    toast('Looking up ' + name + '…');
    try {
      const r = await TH.mcSkin.fetchNamedSkin(name);
      await confirmLeave();
      await openImageURL(r.canvas.toDataURL('image/png'), { name: name + ' copy', cape: r.cape || null }, { model: r.slim ? 'slim' : 'classic' });
      toast('Editing a copy of ' + name + '’s skin' + (r.cape ? ' (with cape)' : ''));
      closeSheet();
    } catch (e) { toast(e && e.message ? e.message : 'Could not load that skin'); }
  }
  function newBlank(baseHex, kind) {
    confirmLeave();
    const doc = E.newDoc(kind === 'slim' ? 'slim' : 'classic');
    if (baseHex) { const c = E.hex2rgba(baseHex); const m = E.partsMask(doc.model, BASE_PARTS.map((p) => p[0])); for (let i = 0; i < 4096; i++) if (m[i]) doc.layers[0].buf.data.set(c, i * 4); }
    setDoc(doc, { name: 'New skin', cape: null });
    toast('New skin');
    closeSheet();
  }
  async function pasteClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('no');
      const items = await navigator.clipboard.read();
      for (const it of items) { const t = it.types.find((x) => x.startsWith('image/')); if (t) { await openFile(new File([await it.getType(t)], 'pasted.png', { type: 'image/png' })); return; } }
      toast('There is no image on the clipboard');
    } catch (e) { toast('Press Ctrl+V to paste a skin image'); }
  }

  /* ====================================================================== library (My skins) + versions */
  function saveToLibrary(opts) {
    flushWork();
    const w = st().work, png = bufToURL(ED.comp), now = Date.now();
    let id = w.libId && !(opts && opts.asNew) ? w.libId : null;
    const entry = { name: w.name || 'My skin', model: model(), png, layers: w.layers, cape: w.cape || null, edited: now, versions: w.versions || [] };
    save((s) => {
      const ex = id && s.lib.find((x) => x.id === id);
      if (ex) Object.assign(ex, entry);
      else { id = uid('skin'); s.lib.unshift(Object.assign({ id, created: now, tags: [], fav: false }, entry)); }
      s.work.libId = id; s.work.edited = false;
    });
    patchStatus(); Lib.invalidate();
    if (!(opts && opts.quiet)) toast('Saved to My skins');
  }
  async function openLib(id) {
    const e = st().lib.find((x) => x.id === id);
    if (!e) return;
    await confirmLeave();
    const doc = await docFromSaved(e.layers ? Object.assign({}, e, { layers: e.layers }) : { model: e.model, layers: [{ name: 'Skin', png: e.png }] });
    setDoc(doc, { name: e.name, libId: e.id, versions: e.versions || [], cape: e.cape || null });
    toast('Opened ' + e.name);
    closeSheet();
  }
  function versionNow(name) {
    flushWork();
    const w = st().work;
    return { id: uid('ver'), name: name || 'Version ' + ((w.versions || []).length + 1), model: model(), png: bufToURL(ED.comp), layers: w.layers, t: Date.now() };
  }
  function saveVersion(name) {
    const v = versionNow(name);
    save((s) => { s.work.versions = [v].concat(s.work.versions || []).slice(0, 40); });
    Side.paintVersions();
    toast('Saved “' + v.name + '”. Keep editing, it stays here');
    return v;
  }
  async function restoreVersion(id) {
    const v = (st().work.versions || []).find((x) => x.id === id);
    if (!v) return;
    const before = E.snapshot(ED.doc);
    const doc = await docFromSaved({ model: v.model, layers: v.layers || [{ name: 'Skin', png: v.png }] });
    ED.doc.model = doc.model; ED.doc.layers = doc.layers; ED.doc.active = doc.active;
    ED.hist.doc('Restore ' + v.name, before, E.snapshot(ED.doc));
    usedMaskCache = {};
    touched(null, { full: true }); patchAll();
    toast('Restored “' + v.name + '” (Ctrl+Z goes back)');
  }
  const libThumbs = new Map();
  /** iso thumbnail of a stored skin png (cached per png) */
  function thumbFor(png, slim, size, cv) {
    const key = png.length + '|' + png.slice(-40) + '|' + slim + '|' + size;
    const c = cv || mkCanvas(size, size);
    const hit = libThumbs.get(key);
    if (hit) { c.width = size; c.height = size; c.getContext('2d').drawImage(hit, 0, 0); return c; }
    urlToBuf(png).then((b) => { if (b.w !== 64) b = E.importImage(b).buf; const r = isoRender({ w: 64, h: 64, data: b.data }, slim, size); libThumbs.set(key, r); c.width = size; c.height = size; c.getContext('2d').drawImage(r, 0, 0); }).catch(() => { c.classList.add('err'); });
    return c;
  }

  /* ====================================================================== collection export / import */
  function exportCollection() {
    flushWork();
    const s = st();
    const data = { app: 'toolbox-skins', v: 1, exportedAt: new Date().toISOString(), work: s.work, lib: s.lib };
    TH.util.download('my-skins-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data));
    toast('Exported ' + s.lib.length + ' skin' + (s.lib.length === 1 ? '' : 's'));
  }
  function importCollection(text) {
    try {
      const d = JSON.parse(text);
      if (!d || d.app !== 'toolbox-skins' || !Array.isArray(d.lib)) throw new Error('That is not a skin collection');
      let n = 0;
      save((s) => { d.lib.forEach((e) => { if (!e || typeof e.png !== 'string' || !/^data:image\/png/.test(e.png)) return; if (s.lib.some((x) => x.id === e.id)) e = Object.assign({}, e, { id: uid('skin') }); s.lib.push(Object.assign({ tags: [], fav: false, versions: [] }, e)); n++; }); });
      Lib.invalidate();
      toast('Imported ' + n + ' skin' + (n === 1 ? '' : 's') + ' into My skins');
    } catch (e) { toast(e.message || 'Could not read that file'); }
  }

  /* ====================================================================== export */
  function exportBuf() {
    const b = E.cloneBuf(ED.comp);
    if (ui().exportClean !== false) E.clearUnused(b, model());
    return b;
  }
  const fileName = () => (st().work.name || 'skin').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'skin';
  function downloadBlob(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function downloadPNG() {
    const cv = bufToCanvas(exportBuf());
    cv.toBlob((b) => { if (b) { ED.lastExport = b; downloadBlob(b, fileName() + '.png'); toast('Downloaded ' + fileName() + '.png (' + (model() === 'slim' ? 'slim' : 'classic') + ' arms)'); } }, 'image/png');
  }
  function copyPNG() {
    const cv = bufToCanvas(exportBuf());
    cv.toBlob(async (b) => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Skin PNG copied'); } catch (e) { toast('This browser cannot copy images: use Download'); }
    }, 'image/png');
  }
  async function downloadShot() { const b = await V.shot(); if (b) downloadBlob(b, fileName() + '-render.png'); else toast('Nothing to save yet'); }

  /* ====================================================================== cape (64 x 32) */
  function loadCape(png) {
    if (!png) { ED.cape = null; ED.capeCv = null; V.setCape(null, false); V.setElytra(ui().elytra, null); patchCape(); return; }
    urlToBuf(png).then((b) => {
      const c = mkCanvas(64, 32), x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      const im = mkCanvas(b.w, b.h); im.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
      if (b.w >= 64 && b.h * 2 === b.w) x.drawImage(im, 0, 0, b.w, b.h, 0, 0, 64, 32); else x.drawImage(im, 0, 0);
      ED.capeCv = c; ED.cape = imgToBuf(c); ED.cape = { w: 64, h: 32, data: new Uint8ClampedArray(ED.cape.data) };
      applyCape(); patchCape();
    }).catch(() => toast('Could not read that cape'));
  }
  let elytraDefault = null;
  function applyCape() {
    V.setCape(ED.capeCv, ui().capeOn);
    const hasWing = ED.cape && (() => { for (let y = 0; y < 22; y++) for (let x = 22; x < 46; x++) if (ED.cape.data[(y * 64 + x) * 4 + 3] > 8) return true; return false; })();
    if (hasWing && ui().capeOn) V.setElytra(ui().elytra, ED.capeCv);
    else if (ui().elytra) {
      if (elytraDefault) V.setElytra(true, elytraDefault);
      else loadImage(TH.icon.tex('entity/equipment/wings/elytra')).then((img) => { elytraDefault = mkCanvas(64, 32); elytraDefault.getContext('2d').drawImage(img, 0, 0); V.setElytra(ui().elytra, elytraDefault); }).catch(() => toast('Could not load the elytra texture'));
    } else V.setElytra(false, null);
  }
  function capeChanged() {
    if (!ED.capeCv) return;
    ED.capeCv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(ED.cape.data), 64, 32), 0, 0);
    V.refreshCape();
    clearTimeout(capeT); capeT = setTimeout(() => save((s) => { if (s.work) s.work.cape = ED.capeCv.toDataURL('image/png'); }), 500);
    markEdited();
  }
  let capeT = 0;
  function newCape(hex) {
    const b = E.newBuf(64, 32), c = E.hex2rgba(hex || ui().color);
    E.capeRects().filter((r) => r.part === 'cape').forEach((r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) b.data.set(c, (y * 64 + x) * 4); });
    const url = bufToURL(b);
    save((s) => { if (s.work) s.work.cape = url; s.ui.capeOn = true; });
    loadCape(url);
  }

  /* ====================================================================== the flat 64x64 sheet */
  const PART_TINT = { head: '#ff6b6b', hat: '#ff6b6b', body: '#5bc0ff', jacket: '#5bc0ff', rarm: '#ffd23c', rsleeve: '#ffd23c', larm: '#b48cff', lsleeve: '#b48cff', rleg: '#45d483', rpants: '#45d483', lleg: '#ff9f43', lpants: '#ff9f43' };
  const Sheet = (function () {
    const cv = h('canvas.sk-sheet-cv', { width: 64, height: 64, tabindex: 0, role: 'img', 'aria-label': 'The flat skin texture, 64 by 64 pixels. Paint here like on the model.' });
    const wrap = h('div.sk-sheet-scroll', cv);
    const img = mkCanvas(64, 64);
    let raf = 0, z = 6, dpr = 1, peekBuf = null;
    const S = { el: wrap, cv };
    S.invalidate = (pb) => { peekBuf = ED.peek ? (pb || (ED.peek && ED.peek.buf)) : null; if (!raf) raf = requestAnimationFrame(draw); };
    /** docked: the chosen size (never more than ~half the stage); main view: fit the stage (or the chosen zoom) */
    const docked = () => ui().main !== 'sheet';
    function maxDock() { const st = wrap.closest('.sk-stage'); if (!st || !st.clientHeight) return 8; return Math.max(2, Math.floor(Math.min(st.clientHeight * 0.5, st.clientWidth * 0.45) / 64)); }
    function fitZoom() {
      const u = ui();
      if (docked()) return clamp(u.dockZoom, 2, maxDock());
      if (u.sheetZoom) return u.sheetZoom;
      const cs = getComputedStyle(wrap), w = (wrap.clientWidth || 384) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), hh = (wrap.clientHeight || 384) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return clamp(Math.floor(Math.min(w, hh) / 64), 2, 16);
    }
    S.zoom = () => z;
    S.setZoom = (nz) => {
      if (docked()) save((s) => { s.ui.dockZoom = clamp(nz, 2, Math.min(8, maxDock())); });
      else save((s) => { s.ui.sheetZoom = nz ? clamp(nz, 2, 20) : 0; });
      S.invalidate(); patchSheetZoom();
    };
    function size() {
      z = fitZoom(); dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = 64 * z;
      if (cv.width !== Math.round(px * dpr)) { cv.width = Math.round(px * dpr); cv.height = Math.round(px * dpr); }
      cv.style.width = px + 'px'; cv.style.height = px + 'px';
    }
    function draw() {
      raf = 0;
      if (!wrap.isConnected) return;
      size();
      if (UI && UI.sheetZoom && UI.sheetZoom.textContent !== z + '×') UI.sheetZoom.textContent = z + '×';
      const x = cv.getContext('2d'), k = z * dpr, u = ui(), m = ED.peek ? (ED.peek.slim ? 'slim' : 'classic') : model();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, cv.width, cv.height);
      // checkerboard (2 squares per pixel)
      const dark = document.documentElement.dataset.theme === 'light' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches) ? ['#ddd3bd', '#efe6d1'] : ['#24242c', '#2e2e38'];
      x.fillStyle = dark[0]; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = dark[1];
      const q = k / 2;
      for (let yy = 0; yy < 128; yy++) for (let xx = (yy & 1); xx < 128; xx += 2) x.fillRect(Math.round(xx * q), Math.round(yy * q), Math.ceil(q), Math.ceil(q));
      // the image
      const src = peekBuf || ED.comp;
      img.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.data), 64, 64), 0, 0);
      x.imageSmoothingEnabled = false;
      x.drawImage(img, 0, 0, 64 * k, 64 * k);
      // reference image under the regions
      if (REF.img && REF.show) { const r = refRect(); if (r) { x.globalAlpha = REF.opacity; x.imageSmoothingEnabled = true; x.drawImage(REF.img, r[0] * k, r[1] * k, r[2] * k, r[3] * k); x.imageSmoothingEnabled = false; x.globalAlpha = 1; } }
      // unused areas dimmed
      const map = E.regionMap(m);
      x.fillStyle = 'rgba(0,0,0,.42)';
      for (let i = 0; i < 4096; i++) if (map[i] < 0) x.fillRect((i % 64) * k, Math.floor(i / 64) * k, k, k);
      // part tint + labels
      const R = E.faceRects(m);
      if (u.sheetLabels) {
        R.forEach((r) => { x.fillStyle = PART_TINT[r.part]; x.globalAlpha = r.layer === 'outer' ? 0.14 : 0.2; x.fillRect(r.x * k, r.y * k, r.w * k, r.h * k); });
        x.globalAlpha = 1;
      }
      // pixel grid + face outlines
      if (u.sheetGrid && z >= 5) {
        x.fillStyle = 'rgba(128,128,128,.16)';
        for (let i = 1; i < 64; i++) { x.fillRect(Math.round(i * k), 0, 1, cv.height); x.fillRect(0, Math.round(i * k), cv.width, 1); }
      }
      x.strokeStyle = 'rgba(160,160,170,.55)'; x.lineWidth = Math.max(1, dpr);
      R.forEach((r) => x.strokeRect(r.x * k + 0.5, r.y * k + 0.5, r.w * k - 1, r.h * k - 1));
      if (u.sheetLabels && z >= 5) {
        x.font = '600 ' + Math.max(9, Math.round(k * 1.25)) + 'px ' + getComputedStyle(document.body).fontFamily;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const seen = new Set();
        R.forEach((r) => {
          if (r.face !== 'front' || seen.has(r.part)) return;
          seen.add(r.part);
          const name = E.PART[r.part].label;
          x.fillStyle = 'rgba(0,0,0,.65)'; x.fillText(name, (r.x + r.w / 2) * k + 1, (r.y + r.h / 2) * k + 1);
          x.fillStyle = '#fff'; x.fillText(name, (r.x + r.w / 2) * k, (r.y + r.h / 2) * k);
        });
        x.font = '500 ' + Math.max(8, Math.round(k * 0.9)) + 'px ' + getComputedStyle(document.body).fontFamily;
        R.forEach((r) => { if (r.face === 'front' || r.w * k < 30) return; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(r.face, (r.x + r.w / 2) * k, (r.y + r.h / 2) * k); });
      }
      // selection: two-tone dashed outline
      if (ED.sel && !ED.peek) {
        const segs = E.selEdges(ED.sel);
        x.lineWidth = Math.max(1, dpr * 1.2);
        [['#000', 0], ['#fff', 4 * dpr]].forEach(([c, off]) => {
          x.strokeStyle = c; x.setLineDash([4 * dpr, 4 * dpr]); x.lineDashOffset = off;
          x.beginPath(); segs.forEach(([a, b, c2, d]) => { x.moveTo(a * k, b * k); x.lineTo(c2 * k, d * k); }); x.stroke();
        });
        x.setLineDash([]);
      }
      if (ED.float && !ED.peek) {
        const p = ED.float.piece;
        x.strokeStyle = getAccent(); x.lineWidth = 2 * dpr; x.setLineDash([3 * dpr, 3 * dpr]);
        x.strokeRect(p.x * k, p.y * k, p.w * k, p.h * k); x.setLineDash([]);
      }
      // cursor: brush footprint (with its mirror twins) or the shape preview
      const pts = cursorPts();
      if (pts.length && !ED.peek) {
        x.fillStyle = 'rgba(255,255,255,.28)'; x.strokeStyle = getAccent(); x.lineWidth = Math.max(1, dpr);
        pts.forEach(([px, py]) => { x.fillRect(px * k, py * k, k, k); x.strokeRect(px * k + 0.5, py * k + 0.5, k - 1, k - 1); });
      }
      if (ED.lasso && ED.lasso.length > 1) {
        x.strokeStyle = getAccent(); x.lineWidth = 1.5 * dpr; x.beginPath();
        ED.lasso.forEach(([a, b], i) => (i ? x.lineTo(a * k, b * k) : x.moveTo(a * k, b * k))); x.stroke();
      }
    }
    let accent = null;
    const getAccent = () => accent || (accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8c96ff');
    S.themeChanged = () => { accent = null; S.invalidate(); };
    /* ---- input ---- */
    const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.floor(((e.clientX - r.left) / r.width) * 64), Math.floor(((e.clientY - r.top) / r.height) * 64), ((e.clientX - r.left) / r.width) * 64, ((e.clientY - r.top) / r.height) * 64]; };
    let drag = null, spaceDown = false, ptrs = new Map(), pinch = null;
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && wrap.matches(':hover') && !/input|textarea/i.test(e.target.tagName)) { spaceDown = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { if (drag && drag.kind === 'paint') strokeCancel(); drag = null; const a = [...ptrs.values()]; pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: z, sx: wrap.scrollLeft, sy: wrap.scrollTop, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 }; return; }
      if (ED.peek) return;
      const [px, py, fx, fy] = at(e), t = ui().tool, sec = e.button === 2;
      if (e.button === 1 || spaceDown || t === 'orbit') { drag = { kind: 'pan', x: e.clientX, y: e.clientY, sx: wrap.scrollLeft, sy: wrap.scrollTop }; cv.classList.add('grab'); return; }
      if (e.altKey && t !== 'select' && t !== 'move') { pickAt(px, py, sec); return; }
      if (PAINT_TOOLS.has(t)) { if (strokeStart(px, py, sec)) drag = { kind: 'paint' }; return; }
      if (SHAPE_TOOLS.has(t)) { ED.shape = { a: [px, py], b: [px, py], sec }; drag = { kind: 'shape' }; S.invalidate(); return; }
      if (t === 'select') {
        const mode = ui().selMode;
        if (mode === 'rect') { drag = { kind: 'box', a: [px, py], ev: e }; ED.boxSel = [px, py, px, py]; }
        else if (mode === 'lasso') { drag = { kind: 'lasso', ev: e }; ED.lasso = [[fx, fy]]; }
        else clickTool(px, py, sec, e);
        S.invalidate(); return;
      }
      if (t === 'move') { drag = { kind: 'move', last: [px, py] }; if (!liftSel()) drag = null; else touched(null); return; }
      clickTool(px, py, sec, e);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (pinch && ptrs.size === 2) {
        const a = [...ptrs.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        const nz = clamp(Math.round(pinch.z * d / pinch.d), 3, 20);
        if (nz !== z) S.setZoom(nz);
        wrap.scrollLeft = pinch.sx - (mx - pinch.mx); wrap.scrollTop = pinch.sy - (my - pinch.my);
        return;
      }
      const [px, py, fx, fy] = at(e);
      const inside = px >= 0 && py >= 0 && px < 64 && py < 64;
      const prev = ED.hover;
      ED.hover = inside ? [px, py] : null;
      if (!drag) { if (!prev || !ED.hover || prev[0] !== px || prev[1] !== py) { S.invalidate(); hoverInfo(ED.hover); syncCursor3D(); } return; }
      if (drag.kind === 'pan') { wrap.scrollLeft = drag.sx - (e.clientX - drag.x); wrap.scrollTop = drag.sy - (e.clientY - drag.y); return; }
      if (drag.kind === 'paint') {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        (evs.length ? evs : [e]).forEach((ce) => { const q = at(ce); strokeMove(q[0], q[1], true); });
        hoverInfo(ED.hover);
        return;
      }
      if (drag.kind === 'shape') { ED.shape.b = [clamp(px, 0, 63), clamp(py, 0, 63)]; S.invalidate(); syncCursor3D(); return; }
      if (drag.kind === 'box') { ED.boxSel = [drag.a[0], drag.a[1], clamp(px, 0, 63), clamp(py, 0, 63)]; S.invalidate(); return; }
      if (drag.kind === 'lasso') { ED.lasso.push([clamp(fx, 0, 64), clamp(fy, 0, 64)]); S.invalidate(); return; }
      if (drag.kind === 'move') { const dx = px - drag.last[0], dy = py - drag.last[1]; if (dx || dy) { drag.last = [px, py]; moveFloat(dx, dy); } }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (pinch) { if (ptrs.size < 2) pinch = null; return; }
      const d = drag; drag = null; cv.classList.remove('grab');
      if (!d) return;
      if (d.kind === 'paint') strokeEnd();
      else if (d.kind === 'shape') { const s = ED.shape; ED.shape = null; shapeApply(s.a, s.b, s.sec); S.invalidate(); syncCursor3D(); }
      else if (d.kind === 'box') { const b = ED.boxSel; ED.boxSel = null; setSel(combineSel(E.selRect(64, 64, b[0], b[1], b[2], b[3]), d.ev)); }
      else if (d.kind === 'lasso') { const L = ED.lasso; ED.lasso = null; setSel(L.length > 2 ? combineSel(E.selLasso(64, 64, L), d.ev) : null); }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!drag && ED.hover) { ED.hover = null; S.invalidate(); hoverInfo(null); syncCursor3D(); } });
    wrap.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      S.setZoom(z + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    new ResizeObserver(() => S.invalidate()).observe(wrap);
    return S;
  })();
  /** pixels the cursor covers right now (brush footprint + mirror twins, or the shape being dragged, or the box selection) */
  function cursorPts() {
    if (ED.shape) {
      if (ui().tool === 'gradient') return E.linePts(ED.shape.a[0], ED.shape.a[1], ED.shape.b[0], ED.shape.b[1]);
      return shapePts(ui().tool, ED.shape.a, ED.shape.b);
    }
    if (ED.boxSel) return E.rectPts(ED.boxSel[0], ED.boxSel[1], ED.boxSel[2], ED.boxSel[3], false);
    if (!ED.hover) return [];
    const t = ui().tool;
    if (!PAINT_TOOLS.has(t) && !SHAPE_TOOLS.has(t) && !['fill', 'replace', 'picker'].includes(t)) return [];
    const size = PAINT_TOOLS.has(t) || t === 'line' || t === 'rect' || t === 'ellipse' ? ui().size : 1;
    const out = [], seen = new Set();
    E.footprint(size, ui().shape, 1).forEach(([dx, dy]) => {
      const x = ED.hover[0] + dx, y = ED.hover[1] + dy;
      if (x < 0 || y < 0 || x > 63 || y > 63) return;
      (PAINT_TOOLS.has(t) ? E.symPixels(model(), x, y, ui().sym) : [[x, y]]).forEach((p) => { const k = p[0] + p[1] * 64; if (!seen.has(k)) { seen.add(k); out.push(p); } });
    });
    return out;
  }
  function syncCursor3D() { V.setCursor(cursorPts(), 'rgba(255,255,255,.5)'); }

  /* ====================================================================== 3D view hookup */
  let last3D = null;   // last painted pixel on the model: connect only within the same face
  V.onPaint = (phase, hit, ev) => {
    const t = ui().tool, sec = false;
    if (ED.peek) return;
    if (phase === 'cancel') { strokeCancel(); ED.shape = null; last3D = null; syncCursor3D(); return; }
    if (phase === 'start') {
      last3D = null;
      if (!hit) return;
      ED.hover = [hit.x, hit.y];
      if (PAINT_TOOLS.has(t)) { if (strokeStart(hit.x, hit.y, sec)) last3D = hit; return; }
      if (SHAPE_TOOLS.has(t)) { ED.shape = { a: [hit.x, hit.y], b: [hit.x, hit.y], sec, face: hit.part + hit.face }; syncCursor3D(); return; }
      if (t === 'select' && (ui().selMode === 'rect' || ui().selMode === 'lasso')) { toast('Draw box and lasso selections on the flat sheet'); return; }
      if (t === 'move') { toast('Move pixels on the flat sheet (or with the arrow keys)'); return; }
      clickTool(hit.x, hit.y, sec, ev);
      return;
    }
    if (phase === 'move') {
      if (ED.stroke) {
        if (!hit) { last3D = null; return; }
        const same = last3D && last3D.part === hit.part && last3D.face === hit.face;
        if (!last3D || hit.x !== last3D.x || hit.y !== last3D.y) strokeMove(hit.x, hit.y, same);
        last3D = hit;
      } else if (ED.shape && hit && hit.part + hit.face === ED.shape.face) { ED.shape.b = [hit.x, hit.y]; syncCursor3D(); Sheet.invalidate(); }
      return;
    }
    if (phase === 'end') {
      if (ED.stroke) strokeEnd();
      if (ED.shape) { const s = ED.shape; ED.shape = null; shapeApply(s.a, s.b, s.sec); syncCursor3D(); }
      last3D = null;
    }
  };
  V.onHover = (hit) => {
    const nh = hit ? [hit.x, hit.y] : null, ph = ED.hover;
    if (ED.shape) return;
    if ((nh && ph && nh[0] === ph[0] && nh[1] === ph[1]) || (!nh && !ph)) return;
    ED.hover = nh;
    hoverInfo(nh); syncCursor3D(); Sheet.invalidate();
  };
  V.onPickColor = (hit) => pickAt(hit.x, hit.y, false);
  V.onAnim = () => patchViewBar();
  V.onRestore = () => { touched(null, { quiet: true, full: true }); applyCape(); };

  /** the line under the viewport: what is under the cursor */
  function hoverInfo(p) {
    if (!UI) return;
    if (!p) { UI.info.textContent = ''; return; }
    const r = E.regionAt(model(), p[0], p[1]), c = E.get(ED.comp, p[0], p[1]);
    UI.info.textContent = (r ? E.PART[r.part].label + ' · ' + r.face : 'Unused area') + ' · ' + p[0] + ', ' + p[1] + (c[3] ? ' · ' + E.rgba2hex(c, true) : ' · transparent');
  }

  /* ====================================================================== tools */
  function setTool(id) {
    if (!TOOL[id]) return;
    if (id !== 'move') commitFloat();
    if (ED.stroke) strokeEnd();
    ED.shape = null;
    save((s) => { s.ui.tool = id; });
    // pose lock: painting always happens in the still pose; the Turn tool plays the chosen animation
    V.setLock(id !== 'orbit');
    V.setMode(id === 'orbit' ? 'orbit' : 'paint');
    patchTools(); patchOptions(); patchViewBar(); syncCursor3D(); Sheet.invalidate();
    if (UI) UI.stage.dataset.tool = id;
  }
  function buildRail() {
    const groups = [['view', 'View'], ['draw', 'Draw'], ['shape', 'Shapes'], ['fill', 'Fill and pick'], ['select', 'Select']];
    const btns = new Map();
    const rail = h('div.sk-rail', { role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
      groups.map(([g, gl]) => h('div.sk-rg', { role: 'group', 'aria-label': gl }, TOOLS.filter((t) => t[3] === g).map((t) => {
        const b = ibtn(t[0], t[1], () => setTool(t[0]), { key: t[2], sub: t[4], cls: 'sk-tool', focus: 'sk-tool-' + t[0] });
        b.dataset.tool = t[0];
        btns.set(t[0], b);
        return b;
      }))),
      h('div.sk-rg', { role: 'group', 'aria-label': 'Helpers' },
        UI_HELPERS.mirror = ibtn('mirror', 'Mirror painting', () => { save((s) => { s.ui.sym.body = !s.ui.sym.body; }); patchTools(); patchOptions(); syncCursor3D(); }, { key: 'Y', sub: 'Paint the left and right side together (arms, legs and the head)', cls: 'sk-tool' }),
        ibtn('adjust', 'Adjust colours', () => openAdjust(), { key: 'A', sub: 'Hue, saturation, brightness, contrast, posterise, invert', cls: 'sk-tool' }),
        ibtn('parts', 'Part tools', () => openPartTools(), { key: 'P', sub: 'Mirror a limb, clear a part, make the outer layer, classic ⇄ slim', cls: 'sk-tool' }),
        ibtn('ref', 'Reference image', () => openReference(), { key: 'J', sub: 'Trace over a picture or stamp it onto a face', cls: 'sk-tool' })));
    rail.paint = () => { btns.forEach((b, id) => press(b, ui().tool === id)); press(UI_HELPERS.mirror, ui().sym.body); };
    return rail;
  }
  const UI_HELPERS = {};

  /* ---- the options bar: only the options of the active tool, in a bar of fixed height ---- */
  function buildOptions() {
    const u = ui;
    const set = (k) => (v) => save((s) => { s.ui[k] = v; });
    const pct = (v) => Math.round(v * 100) + '%';
    const W = {};
    W.size = (() => {
      const out = h('b.sk-num');
      const minus = ibtn('zoomout', 'Smaller brush', () => { save((s) => { s.ui.size = clamp(s.ui.size - 1, 1, 8); }); W.size.paint(); syncCursor3D(); Sheet.invalidate(); }, { key: '[', size: 16, cls: 'sk-mini' });
      const plus = ibtn('zoomin', 'Bigger brush', () => { save((s) => { s.ui.size = clamp(s.ui.size + 1, 1, 8); }); W.size.paint(); syncCursor3D(); Sheet.invalidate(); }, { key: ']', size: 16, cls: 'sk-mini' });
      const el = h('div.sk-opt.sk-size', h('span.sk-slbl', 'Size'), minus, out, plus);
      el.paint = () => { out.textContent = u().size + ' px'; };
      return el;
    })();
    W.shape = seg('Brush shape', [['square', 'Square', 'Square brush'], ['circle', 'Round', 'Round brush'], ['diamond', 'Diamond', 'Diamond brush']], () => u().shape, (v) => { set('shape')(v); syncCursor3D(); Sheet.invalidate(); });
    W.hard = slider('Hardness', 0, 1, 0.05, () => u().hardness, set('hardness'), pct);
    W.opacity = slider('Opacity', 0.05, 1, 0.05, () => u().opacity, set('opacity'), pct);
    W.amount = slider('Strength', 0.02, 1, 0.02, () => u().amount, set('amount'), pct);
    W.limit = seg('Stay inside', [['none', 'Anywhere', 'Paint anywhere'], ['face', 'Face', 'Stay inside the face you start on'], ['part', 'Part', 'Stay inside the body part you start on']], () => u().limit, set('limit'));
    W.shade = seg('Shade mode', [['darken', 'Darken'], ['lighten', 'Lighten'], ['smudge', 'Smudge'], ['blur', 'Blur']], () => u().shadeMode, set('shadeMode'));
    W.noise = seg('Noise mode', [['noise', 'Noise', 'Random light and dark pixels'], ['dither', 'Dither', 'A checker of the two colours']], () => u().noiseMode, set('noiseMode'));
    W.filled = seg('Fill', [[false, 'Outline'], [true, 'Filled']], () => u().filled, set('filled'));
    W.grad = seg('Gradient type', [['linear', 'Linear'], ['radial', 'Radial']], () => u().gradType, set('gradType'));
    W.steps = (() => {
      const out = h('b.sk-num');
      const el = h('div.sk-opt', h('span.sk-slbl', 'Steps'),
        ibtn('zoomout', 'Fewer steps', () => { save((s) => { s.ui.gradSteps = s.ui.gradSteps <= 2 ? 0 : s.ui.gradSteps - 1; }); el.paint(); }, { size: 16, cls: 'sk-mini' }), out,
        ibtn('zoomin', 'More steps', () => { save((s) => { s.ui.gradSteps = s.ui.gradSteps < 2 ? 2 : Math.min(12, s.ui.gradSteps + 1); }); el.paint(); }, { size: 16, cls: 'sk-mini' }));
      el.paint = () => { out.textContent = u().gradSteps ? String(u().gradSteps) : 'Smooth'; };
      return el;
    })();
    W.dither = toggle('Dither', () => u().dither, (v) => set('dither')(v), { tip: ['Dither', 'Mix neighbouring steps in a pixel pattern'] });
    W.tol = slider('Tolerance', 0, 128, 1, () => u().tolerance, set('tolerance'), (v) => String(v));
    W.contig = seg('Fill area', [[true, 'Connected', 'Only the touching pixels of that colour'], [false, 'Everywhere', 'Every pixel of that colour']], () => u().contiguous, set('contiguous'));
    W.sample = seg('Look at', [['layer', 'This layer', 'Compare colours on the active layer'], ['all', 'All layers', 'Compare what you see (all layers)']], () => u().sample, set('sample'));
    W.selMode = seg('Selection', [['rect', 'Box'], ['lasso', 'Lasso'], ['wand', 'Wand', 'Magic wand: the touching pixels of one colour'], ['colour', 'Colour', 'Every pixel of one colour']], () => u().selMode, set('selMode'));
    W.selOp = seg('Selection mode', [['new', 'New'], ['add', 'Add', 'Add (or hold Shift)'], ['sub', 'Subtract', 'Subtract (or hold Alt)']], () => u().selOp, set('selOp'));
    const act = (icon, label, fn, key) => ibtn(icon, label, fn, { key, size: 16, cls: 'sk-mini' });
    W.selActs = h('div.sk-opt.sk-acts', act('select', 'Select all', () => setSel(usedMask(model()).slice()), 'Ctrl+A'), act('x', 'Deselect', () => setSel(null), 'Ctrl+D'),
      act('swap', 'Invert selection', () => setSel(ED.sel ? E.selInvert(ED.sel).map((v, i) => v & usedMask(model())[i]) : usedMask(model()).slice()), 'Ctrl+I'),
      act('copy', 'Copy', () => copySel(false), 'Ctrl+C'), act('dl', 'Paste', () => { if (!pasteSel()) toast('Copy a selection first'); }, 'Ctrl+V'), act('x', 'Delete the selected pixels', deleteSel, 'Del'));
    W.moveActs = h('div.sk-opt.sk-acts', act('flipH', 'Flip left-right', () => transformFloat('flipH'), 'Shift+H'), act('flipV', 'Flip upside down', () => transformFloat('flipV'), 'Shift+V'),
      act('rotL', 'Turn left', () => transformFloat('rotCCW'), 'Shift+,'), act('rotR', 'Turn right', () => transformFloat('rotCW'), 'Shift+.'),
      act('check', 'Drop it here', () => commitFloat(), 'Enter'), act('x', 'Cancel the move', () => cancelFloat(), 'Esc'));
    W.sym = h('div.sk-opt.sk-sym', { role: 'group', 'aria-label': 'Mirror' },
      toggle('Body mirror', () => u().sym.body, (v) => { save((s) => { s.ui.sym.body = v; }); patchTools(); syncCursor3D(); }, { icon: 'mirror', text: false, tip: ['Body mirror (Y)', 'Left and right side together: arm to arm, leg to leg, head and body onto themselves'] }),
      toggle('Mirror across each face', () => u().sym.faceX, (v) => { save((s) => { s.ui.sym.faceX = v; }); syncCursor3D(); }, { icon: 'flipH', text: false, tip: ['Mirror across each face', 'Left half to right half of the same face'] }),
      toggle('Mirror up and down', () => u().sym.faceY, (v) => { save((s) => { s.ui.sym.faceY = v; }); syncCursor3D(); }, { icon: 'flipV', text: false, tip: ['Mirror up and down', 'Top half to bottom half of the same face'] }));
    W.orbit = h('div.sk-opt.sk-hint', 'Drag to turn · right-drag or Shift-drag to pan · scroll to zoom. Pick an animation under the model.');
    W.picker = h('div.sk-opt.sk-hint', 'Click a pixel to take its colour. Right-click sets the second colour. Alt-click works with every tool.');
    W.replace = h('div.sk-opt.sk-hint', 'Click a colour: every pixel of it becomes the current colour.');
    W.selInfo = h('span.sk-selinfo');
    const ROWS = {
      orbit: ['orbit'], pencil: ['size', 'shape', 'opacity', 'limit', 'sym'], eraser: ['size', 'shape', 'hard', 'opacity', 'limit', 'sym'],
      shade: ['shade', 'size', 'shape', 'amount', 'limit', 'sym'], noise: ['noise', 'size', 'shape', 'amount', 'limit', 'sym'],
      line: ['size', 'opacity', 'sym'], rect: ['filled', 'size', 'opacity', 'sym'], ellipse: ['filled', 'size', 'opacity', 'sym'],
      gradient: ['grad', 'steps', 'dither', 'opacity', 'limit'], fill: ['tol', 'contig', 'limit', 'sample', 'opacity'], replace: ['replace', 'tol', 'sample'],
      picker: ['picker', 'sample'], select: ['selMode', 'selOp', 'tol', 'selActs', 'selInfo'], move: ['moveActs', 'selInfo'],
    };
    const bar = h('div.sk-opts', { role: 'group', 'aria-label': 'Tool options' });
    const title = h('span.sk-opt-title');
    let shown = '';
    bar.paint = () => {
      const t = u().tool, key = t + (t === 'pencil' && u().size > 1 ? '+h' : '');
      if (shown !== key) {
        shown = key;
        const list = ROWS[t].slice();
        if (t === 'pencil' && u().size > 1) list.splice(2, 0, 'hard');
        bar.replaceChildren(title, ...list.map((k) => W[k]));
      }
      title.textContent = TOOL[t].label;
      W.hard.style.display = (t === 'pencil' || t === 'eraser' || t === 'shade' || t === 'noise') && u().size === 1 ? 'none' : '';
      Object.values(W).forEach((w) => w.paint && w.paint());
      W.sym.querySelectorAll('.sk-tg').forEach((b) => b.paint());
      W.selInfo.textContent = ED.float ? 'Moving ' + ED.float.piece.w + ' × ' + ED.float.piece.h : selActive() ? E.selCount(ED.sel) + ' pixels selected' : t === 'move' ? 'No selection: moves the whole layer' : '';
    };
    W.size.paint();
    return bar;
  }

  /* ====================================================================== viewport (stage + view bar) */
  function applyBg(stage) {
    const b = BGS.find((x) => x.id === ui().bg) || BGS[0];
    stage.dataset.bg = b.id;
    stage.style.setProperty('--sk-bgc', ui().bgColor);
    if (b.tex) stage.style.setProperty('--sk-tex', 'url("' + TH.icon.src(b.tex) + '")'); else stage.style.removeProperty('--sk-tex');
  }
  /** a popover panel anchored inside the stage (not a dropdown list: a small grid of keys) */
  function popover(btn, build, label) {
    const pop = h('div.sk-pop', { role: 'dialog', 'aria-label': label, hidden: true });
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      if (!pop.hidden) return close();
      pop.replaceChildren(...[].concat(build(close)));
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      const f = pop.querySelector('.on, button'); if (f) f.focus({ preventScroll: true });
    });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } });
    return pop;
  }
  /**
   * The stage: ONE well holding both views. The main view fills it (3D model by default); the other one is docked in the
   * bottom-right corner as a compact card at its real size (the flat sheet = exactly 64 × 64 × zoom). Every view control
   * is a small overlay inside its own view. Swap (⇄) trades places, the dock folds to a small key.
   */
  function buildStage() {
    const stage = h('div.sk-stage', { 'data-bg': 'studio' });
    applyBg(stage);
    const vb = (icon, label, fn, o) => ibtn(icon, label, fn, Object.assign({ cls: 'sk-vb', size: 16 }, o));
    /* ---- model overlays ---- */
    const playBtn = vb('pause', 'Pause', () => {
      if (ui().tool !== 'orbit') { setTool('orbit'); V.setPaused(false); return; }
      V.setPaused(!V.paused);
    }, { key: 'K', tip: () => [V.lock ? 'Play the animation (K)' : V.paused ? 'Play (K)' : 'Pause (K)', V.lock ? 'Switches to the Turn tool: paint tools always hold the still pose' : ''] });
    const animBtn = h('button.btn.small.sk-vb.sk-animbtn', { type: 'button', 'aria-label': 'Animation' }, h('span.sk-animname'), h('span.sk-chev', { 'aria-hidden': 'true' }));
    tip(animBtn, () => ['Animation', 'Plays with the Turn tool (C). Painting always uses the still pose']);
    const animPop = popover(animBtn, (close) => [h('div.sk-pop-title', 'Animation'), h('div.sk-pop-grid', ANIMS.map(([id, l]) => {
      const b = h('button.btn.small', { type: 'button', onclick: () => { save((s) => { s.ui.anim = id; if (id === 'fly') s.ui.elytra = true; }); if (id === 'fly') applyCape(); if (ui().tool !== 'orbit') setTool('orbit'); V.setAnim(id); close(); patchViewBar(); } }, l);
      press(b, ui().anim === id);
      return b;
    })), slider('Speed', 0.25, 2.5, 0.25, () => ui().speed, (v) => { save((s) => { s.ui.speed = v; }); V.setSpeed(v); }, (v) => v + '×')], 'Animation');
    const bgBtn = h('button.btn.small.sk-vb.sk-ib', { type: 'button', 'aria-label': 'Background' }, h('span.sk-bgsw'));
    tip(bgBtn, () => ['Background', (BGS.find((b) => b.id === ui().bg) || BGS[0]).name]);
    const bgPop = popover(bgBtn, () => {
      const groups = ['Plain', 'Gradient', 'Scenery'].map((g) => [h('div.sk-pop-title', g), h('div.sk-pop-grid.sk-bggrid', BGS.filter((b) => b.group === g).map((b) => {
        const k = h('button.btn.sk-bgkey', { type: 'button', 'data-bg': b.id, 'aria-label': b.name, onclick: () => { save((s) => { s.ui.bg = b.id; }); applyBg(stage); patchViewBar(); grid.querySelectorAll('.sk-bgkey').forEach((x) => press(x, x.dataset.bg === b.id)); } },
          vars(h('span.sk-bgprev', { 'data-bg': b.id }), b.tex ? { '--sk-tex': 'url("' + TH.icon.src(b.tex) + '")' } : { '--sk-bgc': ui().bgColor }), h('span', b.name));
        press(k, ui().bg === b.id);
        return k;
      }))]);
      const col = h('input.sk-colin', { type: 'color', value: ui().bgColor, 'aria-label': 'Your background colour', oninput: (e) => { save((s) => { s.ui.bgColor = e.target.value; s.ui.bg = 'custom'; }); applyBg(stage); patchViewBar(); } });
      const grid = h('div.sk-bgwrap', groups, h('label.sk-colrow', h('span', 'Your colour'), col));
      return grid;
    }, 'Background');
    const T = (icon, label, k, sub, get, set) => { const b = vb(icon, label, () => { set(!get()); b.paint(); }, { key: k, sub }); b.paint = () => press(b, get()); b.paint(); return b; };
    const lightBtn = T('light', 'Shading', 'Shift+L', 'Off = flat colours, exactly as painted', () => ui().lit, (v) => { save((s) => { s.ui.lit = v; }); V.setLighting(v); });
    const gridBtn = vb('grid', 'Overlay on the model', () => { const n = { none: 'grid', grid: 'parts', parts: 'none' }[ui().overlay]; save((s) => { s.ui.overlay = n; }); V.setOverlay(n); patchViewBar(); },
      { tip: () => ['Overlay on the model (Shift+G)', { none: 'Off. Click: pixel grid', grid: 'Pixel grid. Click: body parts', parts: 'Body parts. Click: off' }[ui().overlay]] });
    const gameBtn = T('eye', 'Game look', null, 'On: the base layer is solid like in the game (see-through base pixels show their colour, often black). Off: gaps show', () => ui().gameLook, (v) => { save((s) => { s.ui.gameLook = v; }); touched(null, { quiet: true, full: true }); });
    const capeBtn = T('cape', 'Cape', null, 'Show the cape on the back', () => ui().capeOn, (v) => { save((s) => { s.ui.capeOn = v; }); if (v && !ED.cape) { openCape(); } applyCape(); patchCape(); });
    const elyBtn = T('wing', 'Elytra', null, 'Wear an elytra (uses the cape’s elytra look when it has one)', () => ui().elytra, (v) => { save((s) => { s.ui.elytra = v; }); applyCape(); });
    const shotBtn = vb('cam', 'Save a picture of the model', downloadShot);
    const sides = h('div.sk-sides', { role: 'group', 'aria-label': 'Look from' }, [['front', 'Front'], ['back', 'Back'], ['right', 'Right'], ['left', 'Left'], ['top', 'Top']].map(([id, l]) => {
      const b = h('button.btn.small.sk-side', { type: 'button', onclick: () => V.view(id) }, l); tip(b, 'Look at the ' + (id === 'right' || id === 'left' ? id + ' side' : id)); return b;
    }));
    const zoomGrp = h('div.sk-ovg', { role: 'group', 'aria-label': 'Zoom' }, vb('zoomout', 'Zoom out', () => V.zoomBy(1 / 1.2), { key: '-' }), vb('zoomin', 'Zoom in', () => V.zoomBy(1.2), { key: '+' }),
      vb('reset', 'Reset the view', () => V.reset(), { key: 'Home', sub: 'or double-click with the Turn tool' }));
    const toggles = h('div.sk-ovg.sk-toggles', { role: 'group', 'aria-label': 'Show' }, bgBtn, gridBtn, lightBtn, gameBtn, capeBtn, elyBtn, shotBtn);
    // phones: the toggles fold into one key (same keys, in a small grid)
    const moreBtn = vb('adjust', 'View options', () => {}, { cls: 'sk-vb.sk-more', sub: 'Background, overlay, shading, game look, cape, elytra' });
    const morePop = popover(moreBtn, () => h('div.sk-pop-grid.sk-moregrid', [bgBtn, gridBtn, lightBtn, gameBtn, capeBtn, elyBtn, shotBtn].map((b) => {
      const c = h('button.btn.small', { type: 'button', onclick: () => { b.click(); c.classList.toggle('on', b.classList.contains('on')); } }, ico(b === bgBtn ? 'ref' : iconOf(b), 16), h('span', b.getAttribute('aria-label').split(',')[0]));
      c.classList.toggle('on', b.classList.contains('on'));
      return c;
    })), 'View options');
    const info = h('div.sk-info', { 'aria-live': 'off' });
    const swapM = vb('side', 'Make the model big', () => setMain('model'), { cls: 'sk-vb.sk-swapkey', sub: 'Swap the model and the flat sheet (Shift+1)' });
    const modelPane = h('div.sk-pane.sk-pane-model', V.el,
      h('div.sk-ov.sk-ov-tl', sides),
      h('div.sk-ov.sk-ov-tr', toggles, moreBtn, zoomGrp),
      h('div.sk-ov.sk-ov-bl', playBtn, animBtn, info),
      h('div.sk-ov.sk-ov-dock', swapM));
    if (!V.ready) modelPane.append(h('div.sk-loading', 'Loading the 3D viewer…'));
    /* ---- sheet pane + its overlays ---- */
    const sheetZoom = h('span.sk-zoomv');
    const sheetCtl = h('div.sk-ov.sk-ov-sheet', { role: 'group', 'aria-label': 'Flat sheet' },
      vb('zoomout', 'Smaller sheet', () => Sheet.setZoom(Sheet.zoom() - 1), { sub: 'Ctrl + scroll on the sheet' }), sheetZoom, vb('zoomin', 'Bigger sheet', () => Sheet.setZoom(Sheet.zoom() + 1), { sub: 'Ctrl + scroll on the sheet' }),
      toggle('Pixel grid', () => ui().sheetGrid, (v) => { save((s) => { s.ui.sheetGrid = v; }); Sheet.invalidate(); }, { icon: 'grid', text: false, tip: ['Pixel grid', 'Lines between the pixels'] }),
      toggle('Body parts', () => ui().sheetLabels, (v) => { save((s) => { s.ui.sheetLabels = v; }); Sheet.invalidate(); }, { icon: 'parts', text: false, tip: ['Body parts', 'Colour every part and name it'] }),
      vb('swap', 'Swap views', () => setMain(ui().main === 'sheet' ? 'model' : 'sheet'), { sub: 'Make the flat sheet big, the model small (Shift+2)' }),
      vb('x', 'Fold the sheet away', () => setDock(false), { cls: 'sk-vb.sk-foldkey', sub: 'Shift+3 brings it back' }));
    sheetCtl.querySelectorAll('.sk-tg').forEach((b) => b.classList.add('sk-vb'));
    const sheetPane = h('div.sk-pane.sk-pane-sheet', Sheet.el, sheetCtl);
    const unfold = h('button.btn.small.sk-unfold', { type: 'button', onclick: () => setDock(true) }, ico('side', 16), h('span', 'Flat sheet'));
    tip(unfold, ['Show the flat sheet (Shift+3)', 'The 64 × 64 texture, docked in the corner']);
    const drop = h('div.sk-drop', { 'aria-hidden': 'true' }, 'Drop a skin PNG to open it');
    stage.append(modelPane, sheetPane, unfold, animPop, bgPop, morePop, drop);
    V.init().then(() => { const s = stage.querySelector('.sk-loading'); if (s) s.remove(); V.setLighting(ui().lit); V.setOverlay(ui().overlay); V.setHidden(ui().hidden); V.setSpeed(ui().speed); V.want = ui().anim; V.setLock(ui().tool !== 'orbit'); V.setMode(ui().tool === 'orbit' ? 'orbit' : 'paint'); if (ED.loaded) touched(null, { quiet: true, full: true }); applyCape(); V.wake(); })
      .catch(() => { const s = stage.querySelector('.sk-loading'); if (s) s.remove(); modelPane.append(h('div.sk-error', V.error || 'The 3D viewer could not start.', h('br'), h('span', 'The flat sheet still works.'))); setMain('sheet'); });
    const box = h('section.panel.sk-viewer', { 'aria-label': 'Model and flat sheet' }, stage);
    box.paint = () => {
      const a = ANIMS.find((x) => x[0] === ui().anim);
      animBtn.querySelector('.sk-animname').textContent = a ? a[1] : 'Idle';
      const playing = !V.lock && !V.paused;
      playBtn.querySelector('.sk-ico').replaceWith(ico(playing ? 'pause' : 'play', 16));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      press(playBtn, playing);
      [lightBtn, gameBtn, capeBtn, elyBtn].forEach((b) => b.paint());
      press(gridBtn, ui().overlay !== 'none');
      bgBtn.querySelector('.sk-bgsw').dataset.bg = ui().bg;
      vars(bgBtn.querySelector('.sk-bgsw'), { '--sk-bgc': ui().bgColor });
      sheetCtl.querySelectorAll('.sk-tg').forEach((b) => b.paint());
    };
    UI_STAGE.info = info; UI_STAGE.sheetZoom = sheetZoom; UI_STAGE.sheetPane = sheetPane;
    return { stage, box };
  }
  const UI_STAGE = {};
  /** the icon name a view key was built with (for the phone "View options" grid) */
  const iconOf = (b) => { const d = b.querySelector('path') && b.querySelector('path').getAttribute('d'); return Object.keys(ICON).find((k) => ICON[k] === d) || 'grid'; };
  /** which view fills the stage: 'model' | 'sheet' */
  function setMain(m) {
    save((s) => { s.ui.main = m === 'sheet' ? 'sheet' : 'model'; s.ui.dock = true; });
    applyView();
  }
  function setDock(on) { save((s) => { s.ui.dock = !!on; }); applyView(); }
  /* ====================================================================== colour panel */
  function buildColor() {
    const sv = h('canvas.sk-sv', { width: 200, height: 120, 'aria-label': 'Saturation and brightness', role: 'slider', tabindex: 0 });
    const hue = h('canvas.sk-hue', { width: 200, height: 14, 'aria-label': 'Hue', role: 'slider', tabindex: 0 });
    const alpha = h('canvas.sk-alpha', { width: 200, height: 14, 'aria-label': 'Opacity of the colour', role: 'slider', tabindex: 0 });
    const hex = h('input.field.sk-hex', { type: 'text', maxlength: 9, spellcheck: false, autocomplete: 'off', 'aria-label': 'Colour code', 'data-focus': 'sk-hex',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); hex.blur(); } }, onchange: () => { const c = E.hex2rgba(hex.value); if (c) setColor(E.rgba2hex(c, true), slot); else paint(); } });
    let slot = 0, hsv = [0, 0, 0], a = 255;
    const sw1 = h('button.sk-sw1', { type: 'button', 'aria-label': 'First colour', onclick: () => { slot = 0; paint(); } }), sw2 = h('button.sk-sw2', { type: 'button', 'aria-label': 'Second colour', onclick: () => { slot = 1; paint(); } });
    tip(sw1, ['First colour', 'Left click, pencil and fill']); tip(sw2, ['Second colour', 'Right click on the sheet, dither and gradient end']);
    const swapB = ibtn('swap', 'Swap the colours', () => { swapColors(); }, { key: 'X', size: 16, cls: 'sk-mini' });
    const cur = () => (slot ? ui().color2 : ui().color);
    function fromState() { const c = E.hex2rgba(cur()); const v = E.rgb2hsv(c[0], c[1], c[2]); if (v[1] > 0.001 && v[2] > 0.001) hsv = v; else hsv = [hsv[0], v[1], v[2]]; a = c[3]; }
    function commit() { const rgb = E.hsv2rgb(hsv[0], hsv[1], hsv[2]); const v = E.rgba2hex(rgb.concat(a), true); const val = v.length === 7 ? v + 'ff' : v; save((s) => { if (slot) s.ui.color2 = val; else s.ui.color = val; }); drawAll(false); }
    function drawAll(read) {
      if (read !== false) fromState();
      const x = sv.getContext('2d'), w = sv.width, hh = sv.height;
      const base = E.hsv2rgb(hsv[0], 1, 1);
      x.fillStyle = 'rgb(' + base + ')'; x.fillRect(0, 0, w, hh);
      let g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, hh);
      g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(0, 0, w, hh);
      const mx = hsv[1] * (w - 1), my = (1 - hsv[2]) * (hh - 1);
      x.strokeStyle = hsv[2] > 0.5 ? '#000' : '#fff'; x.lineWidth = 2; x.strokeRect(mx - 4, my - 4, 8, 8);
      const hx = hue.getContext('2d'); const hg = hx.createLinearGradient(0, 0, hue.width, 0);
      for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, 'rgb(' + E.hsv2rgb(i * 60, 1, 1) + ')');
      hx.fillStyle = hg; hx.fillRect(0, 0, hue.width, hue.height);
      hx.fillStyle = '#fff'; hx.fillRect(hsv[0] / 360 * (hue.width - 3), 0, 3, hue.height); hx.strokeStyle = '#000'; hx.strokeRect(hsv[0] / 360 * (hue.width - 3) - 0.5, 0.5, 4, hue.height - 1);
      const ax = alpha.getContext('2d');
      for (let i = 0; i < alpha.width; i += 7) for (let j = 0; j < 2; j++) { ax.fillStyle = ((i / 7 + j) & 1) ? '#999' : '#ddd'; ax.fillRect(i, j * 7, 7, 7); }
      const rgb = E.hsv2rgb(hsv[0], hsv[1], hsv[2]), ag = ax.createLinearGradient(0, 0, alpha.width, 0);
      ag.addColorStop(0, 'rgba(' + rgb + ',0)'); ag.addColorStop(1, 'rgba(' + rgb + ',1)'); ax.fillStyle = ag; ax.fillRect(0, 0, alpha.width, alpha.height);
      ax.fillStyle = '#fff'; ax.fillRect(a / 255 * (alpha.width - 3), 0, 3, alpha.height); ax.strokeStyle = '#000'; ax.strokeRect(a / 255 * (alpha.width - 3) - 0.5, 0.5, 4, alpha.height - 1);
      const c1 = E.hex2rgba(ui().color), c2 = E.hex2rgba(ui().color2);
      sw1.style.setProperty('--c', 'rgba(' + c1.slice(0, 3) + ',' + c1[3] / 255 + ')'); sw2.style.setProperty('--c', 'rgba(' + c2.slice(0, 3) + ',' + c2[3] / 255 + ')');
      sw1.classList.toggle('on', slot === 0); sw2.classList.toggle('on', slot === 1);
      if (document.activeElement !== hex) hex.value = E.rgba2hex(E.hex2rgba(cur()), true).toUpperCase();
    }
    const paint = () => drawAll(true);
    const drag = (cv, fn) => {
      const go = (e) => { const r = cv.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); commit(); };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); go(e); const mv = (ev) => go(ev); const end = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', end); pushRecent(cur()); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', end); });
    };
    drag(sv, (fx, fy) => { hsv[1] = fx; hsv[2] = 1 - fy; });
    drag(hue, (fx) => { hsv[0] = fx * 359.9; });
    drag(alpha, (fx) => { a = Math.round(fx * 255); });
    const keys = (cv, fn) => cv.addEventListener('keydown', (e) => { const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); fn(d * (e.shiftKey ? 10 : 1), e.key); commit(); });
    keys(sv, (d, k) => { if (k === 'ArrowLeft' || k === 'ArrowRight') hsv[1] = clamp(hsv[1] + d / 100, 0, 1); else hsv[2] = clamp(hsv[2] + d / 100, 0, 1); });
    keys(hue, (d) => { hsv[0] = (hsv[0] + d + 360) % 360; });
    keys(alpha, (d) => { a = clamp(a + d * 2, 0, 255); });
    const swatch = (hexv, title, onpick, extra) => { const b = vars(h('button.sk-swatch', { type: 'button', 'aria-label': title || hexv, onclick: (e) => onpick(hexv, e), oncontextmenu: (e) => { e.preventDefault(); setColor(hexv, 1); } }, extra), { '--c': hexv }); tip(b, [hexv.toUpperCase().slice(0, 7), 'Click: first colour · right-click: second']); return b; };
    const pick = (v, e) => setColor(v, e && e.shiftKey ? 1 : slot);
    const recentRow = h('div.sk-swatches');
    const skinRow = h('div.sk-swatches');
    const mcRow = h('div.sk-swatches', MC_PALETTE.map((v) => swatch(v, v, pick)));
    const palsBox = h('div.sk-pals');
    const savePal = h('button.btn.small', { type: 'button', onclick: async () => {
      const name = await TH.util.ask({ text: 'Name for this palette (the colours of your skin)', input: 'Palette ' + (ui().palettes.length + 1), ok: 'Save palette' });
      if (!name) return;
      save((s) => { s.ui.palettes.unshift({ id: uid('pal'), name, colors: E.palette(ED.comp, 24, 10, model()) }); });
      paintPals(); toast('Palette saved');
    } }, 'Save as palette');
    tip(savePal, ['Save as palette', 'Keeps the colours of this skin to use on other skins']);
    function paintRecent() { recentRow.replaceChildren(...(ui().recent.length ? ui().recent.map((v) => swatch(v, v, pick)) : [h('span.sk-empty', 'Colours you use show up here')])); }
    function paintSkinPal() { skinRow.replaceChildren(...E.palette(ED.comp, 24, 10, model()).map((v) => swatch(v, v, pick))); }
    function paintPals() {
      palsBox.replaceChildren(...ui().palettes.map((p) => h('div.sk-pal', h('div.sk-pal-head', h('span.sk-pal-name', p.name),
        ibtn('x', 'Delete the palette ' + p.name, () => { save((s) => { s.ui.palettes = s.ui.palettes.filter((x) => x.id !== p.id); }); paintPals(); }, { size: 14, cls: 'sk-mini' })),
      h('div.sk-swatches', p.colors.map((v) => swatch(v, v, pick))))));
    }
    const panel = h('section.panel.sk-panel.sk-color', { 'aria-label': 'Colour' },
      h('div.sk-ph', h('h3', 'Colour'), h('div.sk-swpair', sw1, sw2, swapB)),
      sv, hue, alpha, h('div.sk-hexrow', h('span.sk-slbl', 'Code'), hex),
      h('div.sk-sub', 'Recent'), recentRow, h('div.sk-sub', 'This skin'), skinRow, savePal, h('div.sk-sub', 'Minecraft'), mcRow, palsBox);
    panel.paint = paint; panel.paintRecent = paintRecent; panel.paintSkinPal = paintSkinPal; panel.paintPals = paintPals;
    paint(); paintRecent(); paintPals();
    return panel;
  }

  /* ====================================================================== parts + layers panel */
  function buildLayers() {
    const partRows = BASE_PARTS.map(([id, label]) => {
      const outer = E.PART[id].outer;
      const eye = (pid, name) => { const b = ibtn('eye', 'Show ' + name, () => { save((s) => { s.ui.hidden[pid] = !s.ui.hidden[pid]; }); V.setPartVisible(pid, !ui().hidden[pid]); paintParts(); }, { size: 16, cls: 'sk-mini.sk-eye' }); b.dataset.pid = pid; return b; };
      const lock = (pid, name) => { const b = ibtn('lock', 'Lock ' + name, () => { save((s) => { s.ui.locks[pid] = !s.ui.locks[pid]; }); paintParts(); }, { size: 16, cls: 'sk-mini.sk-lock', sub: 'A locked part cannot be painted' }); b.dataset.pid = pid; return b; };
      const name = h('button.sk-pname', { type: 'button', onclick: (e) => { const ids = e.shiftKey ? [outer] : e.altKey ? [id] : [id, outer]; setSel(E.partsMask(model(), ids)); toast('Selected the ' + label.toLowerCase() + (e.shiftKey ? ' (outer layer)' : e.altKey ? ' (base)' : '')); } }, label);
      tip(name, [label, 'Click: select it · Alt: base only · Shift: outer layer only']);
      return h('div.sk-prow', name, h('span.sk-pl', 'Base'), eye(id, label), lock(id, label), h('span.sk-pl', 'Outer'), eye(outer, E.PART[outer].label), lock(outer, E.PART[outer].label));
    });
    const outerAll = toggle('Outer layer', () => !['hat', 'jacket', 'rsleeve', 'lsleeve', 'rpants', 'lpants'].every((p) => ui().hidden[p]), (v) => setOuter(v), { tip: ['Outer layer (H)', 'Show or hide the hat, jacket, sleeves and pants'] });
    const model2 = seg('Arm width', [['classic', 'Classic', 'Classic (wide): 4 px arms'], ['slim', 'Slim', 'Slim: 3 px arms']], () => model(), (v) => { if (v !== model()) convertModel(v, 'middle'); });
    function paintParts() {
      partRows.forEach((r) => {
        r.querySelectorAll('.sk-eye').forEach((b) => { const hid = !!ui().hidden[b.dataset.pid]; press(b, !hid); b.classList.toggle('off', hid); });
        r.querySelectorAll('.sk-lock').forEach((b) => press(b, !!ui().locks[b.dataset.pid]));
      });
      outerAll.paint(); model2.paint();
    }
    const list = h('div.sk-layers', { role: 'listbox', 'aria-label': 'Paint layers' });
    const opac = slider('Opacity', 0, 1, 0.05, () => (layer() ? layer().opacity : 1), (v) => { layer().opacity = v; touched(null); }, (v) => Math.round(v * 100) + '%', () => markEdited());
    const blend = seg('Blend', [['normal', 'Normal'], ['multiply', 'Multiply', 'Darkens: good for shading'], ['screen', 'Screen', 'Lightens: good for highlights'], ['overlay', 'Overlay', 'Adds contrast']],
      () => (layer() ? layer().blend : 'normal'), (v) => docOp('Blend mode', (d) => { d.layers[d.active].blend = v; }));
    const acts = h('div.sk-lacts',
      ibtn('plus', 'New layer', () => docOp('New layer', (d) => { E.addLayer(d); }), { size: 16, cls: 'sk-mini' }),
      ibtn('copy', 'Duplicate the layer', () => docOp('Duplicate layer', (d) => { E.duplicateLayer(d, d.active); }), { size: 16, cls: 'sk-mini' }),
      ibtn('merge', 'Merge down', () => { if (ED.doc.active === 0) { toast('This is the bottom layer'); return; } docOp('Merge down', (d) => E.mergeDown(d, d.active)); }, { size: 16, cls: 'sk-mini' }),
      ibtn('up', 'Move the layer up', () => docOp('Move layer', (d) => E.moveLayer(d, d.active, d.active + 1)), { size: 16, cls: 'sk-mini' }),
      ibtn('down', 'Move the layer down', () => docOp('Move layer', (d) => E.moveLayer(d, d.active, d.active - 1)), { size: 16, cls: 'sk-mini' }),
      ibtn('x', 'Delete the layer', () => { if (ED.doc.layers.length < 2) { toast('A skin keeps at least one layer'); return; } docOp('Delete layer', (d) => E.removeLayer(d, d.active)); }, { size: 16, cls: 'sk-mini' }));
    function paintList() {
      const d = ED.doc;
      list.replaceChildren(...d.layers.map((L, i) => ({ L, i })).reverse().map(({ L, i }) => {
        const eye = ibtn('eye', (L.visible ? 'Hide ' : 'Show ') + L.name, (e) => { e.stopPropagation(); docOp(L.visible ? 'Hide layer' : 'Show layer', (dd) => { dd.layers[i].visible = !dd.layers[i].visible; }); }, { size: 16, cls: 'sk-mini.sk-eye' });
        press(eye, L.visible); eye.classList.toggle('off', !L.visible);
        const lk = ibtn('lock', (L.locked ? 'Unlock ' : 'Lock ') + L.name, (e) => { e.stopPropagation(); L.locked = !L.locked; markEdited(); paintList(); }, { size: 16, cls: 'sk-mini.sk-lock' });
        press(lk, L.locked);
        const th = h('canvas.sk-lthumb', { width: 64, height: 64 });
        th.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(L.buf.data), 64, 64), 0, 0);
        const nm = h('span.sk-lname', L.name);
        const row = h('div.sk-lrow' + (i === d.active ? '.on' : ''), { role: 'option', tabindex: 0, 'aria-selected': String(i === d.active),
          onclick: () => { if (d.active !== i) { commitFloat(); d.active = i; markEdited(); paintList(); patchOptions(); } },
          ondblclick: async () => { const n = await TH.util.ask({ text: 'Layer name', input: L.name, ok: 'Rename' }); if (n) { L.name = n.slice(0, 30); markEdited(); paintList(); } },
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } } }, th, nm, h('span.sk-lmeta', L.blend !== 'normal' ? L.blend : L.opacity < 1 ? Math.round(L.opacity * 100) + '%' : ''), eye, lk);
        tip(row, [L.name, 'Double-click to rename']);
        return row;
      }));
      opac.paint(); blend.paint();
    }
    /* cape */
    const capeTh = h('canvas.sk-capeth', { width: 64, height: 32 });
    const capeInfo = h('span.sk-capeinfo');
    const capeFile = h('input', { type: 'file', accept: 'image/png', class: 'sr', tabindex: -1, 'aria-label': 'Upload a cape PNG', onchange: async () => { const f = capeFile.files[0]; capeFile.value = ''; if (!f) return; const url = await fileToURL(f); save((s) => { if (s.work) s.work.cape = url; s.ui.capeOn = true; }); loadCape(url); } });
    const capeActs = h('div.sk-lacts.sk-capeacts',
      h('button.btn.small', { type: 'button', onclick: () => openCape() }, 'Edit cape'),
      h('button.btn.small', { type: 'button', onclick: () => newCape() }, 'New'),
      h('button.btn.small', { type: 'button', onclick: () => capeFile.click() }, 'Upload'),
      ibtn('x', 'Remove the cape', () => { save((s) => { if (s.work) s.work.cape = null; }); loadCape(null); }, { size: 16, cls: 'sk-mini' }), capeFile);
    function paintCape() {
      const x = capeTh.getContext('2d'); x.clearRect(0, 0, 64, 32);
      if (ED.capeCv) x.drawImage(ED.capeCv, 0, 0);
      capeTh.hidden = !ED.capeCv;
      capeInfo.textContent = ED.capeCv ? 'Cape 64 × 32 (with its elytra look)' : 'No cape. Make one or upload a cape PNG';
      capeActs.querySelector('.btn').disabled = !ED.capeCv;
    }
    const panel = h('section.panel.sk-panel.sk-lpanel', { 'aria-label': 'Parts and layers' },
      h('div.sk-ph', h('h3', 'Body'), model2), h('div.sk-parts', partRows), outerAll,
      h('div.sk-ph', h('h3', 'Layers')), list, acts, opac, blend,
      h('div.sk-ph', h('h3', 'Cape')), h('div.sk-caperow', capeTh, capeInfo), capeActs);
    panel.paint = () => { paintParts(); paintList(); paintCape(); };
    panel.paintList = paintList; panel.paintParts = paintParts; panel.paintCape = paintCape;
    return panel;
  }
  function setOuter(on) {
    save((s) => { ['hat', 'jacket', 'rsleeve', 'lsleeve', 'rpants', 'lpants'].forEach((p) => { s.ui.hidden[p] = !on; }); });
    V.setHidden(ui().hidden);
    if (UI) UI.layers.paintParts();
    toast(on ? 'Outer layer shown' : 'Outer layer hidden: you paint the base');
  }
  function convertModel(to, mode, keepPixels) {
    docOp(keepPixels ? 'Arm width' : to === 'slim' ? 'Convert to slim' : 'Convert to classic', (d) => {
      const from = d.model;
      if (!keepPixels) d.layers.forEach((L) => { L.buf = E.refitArms(L.buf, from, to, mode || 'middle'); });
      d.model = to;
    });
    toast(to === 'slim' ? 'Slim arms (3 px)' : 'Classic arms (4 px)');
  }

  /* ====================================================================== versions + history panel */
  const Side = { paintVersions() {}, paintHistory() {} };
  function buildSide() {
    const tabs = seg('Show', [['versions', 'Versions', 'Saved looks of this skin'], ['history', 'History', 'Every step, click one to go back']], () => ui().side, (v) => { save((s) => { s.ui.side = v; }); show(); });
    const vList = h('div.sk-vers.th-scroll');
    const hList = h('div.sk-hist.th-scroll', { role: 'list' });
    const presetBtn = h('button.btn.primary.sk-preset', { type: 'button', onclick: async () => { const n = await TH.util.ask({ text: 'Name this version', input: 'Version ' + ((st().work.versions || []).length + 1), ok: 'Save version' }); if (n) saveVersion(n.slice(0, 40)); } }, 'Undecided? Save as preset');
    tip(presetBtn, ['Save as preset', 'Keep this look as a version of the skin, then try something else. Restore or compare it any time']);
    const undoRow = h('div.sk-lacts', ibtn('undo', 'Undo', undo, { key: 'Ctrl+Z', size: 16, cls: 'sk-mini' }), ibtn('redo', 'Redo', redo, { key: 'Ctrl+Y', size: 16, cls: 'sk-mini' }), h('span.sk-hcount'));
    const body = h('div.sk-sidebody');
    function show() { tabs.paint(); body.replaceChildren(...(ui().side === 'history' ? [undoRow, hList] : [presetBtn, vList])); if (ui().side === 'history') Side.paintHistory(); else Side.paintVersions(); }
    Side.paintVersions = () => {
      const vs = (st().work && st().work.versions) || [];
      if (!vs.length) { vList.replaceChildren(h('p.sk-empty', 'No versions yet. Save one before you try something new: you can always come back to it.')); return; }
      vList.replaceChildren(...vs.map((v) => {
        const cv = thumbFor(v.png, v.model === 'slim', 72);
        cv.className = 'sk-vthumb';
        const peekBtn = ibtn('eye', 'Hold to compare', () => {}, { size: 16, cls: 'sk-mini', sub: 'Shows this version on the model while you hold it' });
        const on = async () => { const b = await urlToBuf(v.png); peek({ w: 64, h: 64, data: new Uint8ClampedArray(b.data) }, v.model === 'slim'); };
        const off = () => peek(null);
        peekBtn.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => peekBtn.addEventListener(ev, off));
        peekBtn.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat) on(); }); peekBtn.addEventListener('keyup', (e) => { if (e.key === ' ') off(); });
        return h('div.sk-ver', cv, h('div.sk-vmeta', h('b.sk-vname', v.name), h('span.sk-vtime', fmtDate(v.t) + ' · ' + (v.model === 'slim' ? 'Slim' : 'Classic'))),
          h('div.sk-vacts',
            h('button.btn.small', { type: 'button', onclick: () => restoreVersion(v.id) }, 'Restore'), peekBtn,
            ibtn('edit', 'Rename', async () => { const n = await TH.util.ask({ text: 'Version name', input: v.name, ok: 'Rename' }); if (n) { save((s) => { const x = s.work.versions.find((y) => y.id === v.id); if (x) x.name = n.slice(0, 40); }); Side.paintVersions(); } }, { size: 16, cls: 'sk-mini' }),
            ibtn('copy', 'Duplicate', () => { save((s) => { const i = s.work.versions.findIndex((y) => y.id === v.id); s.work.versions.splice(i + 1, 0, Object.assign({}, v, { id: uid('ver'), name: v.name + ' copy', t: Date.now() })); }); Side.paintVersions(); }, { size: 16, cls: 'sk-mini' }),
            ibtn('x', 'Delete', () => TH.util.guard(true, 'Delete the version “' + v.name + '”?', () => { save((s) => { s.work.versions = s.work.versions.filter((y) => y.id !== v.id); }); Side.paintVersions(); }, 'Delete'), { size: 16, cls: 'sk-mini' })));
      }));
    };
    Side.paintHistory = () => {
      if (ui().side !== 'history') return;
      const L = ED.hist.list();
      undoRow.querySelector('.sk-hcount').textContent = L.length ? L.filter((s) => s.done).length + ' of ' + L.length + ' steps' : '';
      hList.replaceChildren(h('button.sk-hstep' + (ED.hist.at === 0 ? '.on' : ''), { type: 'button', onclick: () => { ED.hist.goTo(ED.doc, -1); afterHist({ all: true }); } }, h('span', 'Start')),
        ...L.map((s, i) => h('button.sk-hstep' + (s.done ? '' : '.undone') + (i === ED.hist.at - 1 ? '.on' : ''), { type: 'button', role: 'listitem', onclick: () => { commitFloat(); ED.hist.goTo(ED.doc, i); afterHist({ all: true }); } }, h('span', s.name), h('time', fmtDate(s.t).split(' ').pop()))));
      const on = hList.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const panel = h('section.panel.sk-panel.sk-side', { 'aria-label': 'Versions and history' }, h('div.sk-ph', tabs), body);
    panel.paint = show;
    show();
    return panel;
  }

  /* ====================================================================== top bar */
  function buildTop() {
    const name = h('input.field.sk-name', { type: 'text', maxlength: 40, 'aria-label': 'Skin name', spellcheck: false, 'data-focus': 'sk-name',
      oninput: () => save((s) => { if (s.work) s.work.name = name.value; }), onchange: () => { if (!name.value.trim()) { name.value = 'My skin'; save((s) => { s.work.name = 'My skin'; }); } markEdited(); } });
    const status = h('span.sk-status', { 'aria-live': 'polite' });
    const big = (icon, label, fn, sub, key) => { const b = h('button.btn.sk-topbtn', { type: 'button', onclick: fn }, ico(icon, 18), h('span', label)); tip(b, [label + keyName(key), sub]); return b; };
    const saveBtn = h('button.btn.primary.sk-save', { type: 'button', onclick: () => saveToLibrary() }, 'Save to My skins');
    tip(saveBtn, () => ['Save to My skins (Ctrl+S)', st().work && st().work.libId ? 'Updates the saved copy' : 'Adds it to your library']);
    const bar = h('div.sk-top', { role: 'toolbar', 'aria-label': 'Skin' },
      h('div.sk-topg', big('plus', 'New', () => openNew(), 'Blank or from a default skin', 'Ctrl+Alt+N'), big('dl', 'Open', () => openOpen(), 'Upload, paste or load a player'), big('parts', 'Browse', () => openBrowse(), 'My skins, default skins and players'), big('cam', 'Export', () => openExport(), 'Download the PNG and how to use it')),
      h('div.sk-topg.sk-namebox', name, status),
      h('div.sk-topg.sk-topend', ibtn('undo', 'Undo', undo, { key: 'Ctrl+Z' }), ibtn('redo', 'Redo', redo, { key: 'Ctrl+Y' }), ibtn('help', 'Keyboard shortcuts', () => openKeys(), { key: '?' }), saveBtn));
    bar.paint = () => {
      const w = st().work;
      if (w && document.activeElement !== name) name.value = w.name || '';
      status.textContent = !w ? '' : w.edited ? 'Edited' : w.libId ? 'Saved' : 'Not in My skins yet';
      status.dataset.state = !w ? '' : w.edited ? 'edited' : w.libId ? 'saved' : 'new';
    };
    return bar;
  }

  /* ====================================================================== overlay sheets (dialog on desktop, bottom sheet on phones) */
  let sheetEl = null, sheetClose = null, sheetPrev = null;
  function openSheet(title, body, opts) {
    closeSheet();
    const o = opts || {};
    sheetPrev = document.activeElement;
    const x = ibtn('x', 'Close', () => closeSheet(), { key: 'Esc' });
    const box = h('div.sk-dlg.panel' + (o.wide ? '.wide' : '') + (o.side ? '.side' : ''), { role: 'dialog', 'aria-modal': o.modeless ? null : 'true', 'aria-label': title },
      h('div.sk-dlg-head', h('h3', title), x), h('div.sk-dlg-body', body));
    sheetEl = h('div.sk-overlay' + (o.modeless ? '.modeless' : ''), { onpointerdown: (e) => { if (e.target === sheetEl) closeSheet(); } }, box);
    sheetClose = o.onClose || null;
    document.body.appendChild(sheetEl);
    box.querySelectorAll('[title]').forEach((el) => TH.util.tooltip(el));
    const f = box.querySelector('[autofocus], .sk-dlg-body input, .sk-dlg-body button');
    if (f) f.focus({ preventScroll: true });
    return box;
  }
  function closeSheet() {
    if (!sheetEl) return;
    const fn = sheetClose; sheetClose = null;
    sheetEl.remove(); sheetEl = null;
    if (fn) fn();
    if (sheetPrev && sheetPrev.isConnected) sheetPrev.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetEl && !document.querySelector('.th-ask')) { e.preventDefault(); e.stopPropagation(); closeSheet(); } }, true);

  /* ---- New ---- */
  function openNew() {
    let base = '#c68642', kind = ui().defModel === 'slim' ? 'slim' : 'classic';
    const baseIn = h('input.sk-colin', { type: 'color', value: base, 'aria-label': 'Base colour', oninput: (e) => { base = e.target.value; } });
    const kindSeg = seg('Arm width', [['classic', 'Classic'], ['slim', 'Slim']], () => kind, (v) => { kind = v; });
    const cards = DEFAULT_SKINS.map(([id, label, k]) => {
      const cv = h('canvas.sk-card-cv', { width: 96, height: 96 });
      urlToBuf(texURL(id, k)).then((b) => { const r = isoRender({ w: 64, h: 64, data: b.data }, k === 'slim', 96); cv.getContext('2d').drawImage(r, 0, 0); }).catch(() => cv.classList.add('err'));
      const b = h('button.btn.sk-card', { type: 'button', onclick: () => openDefault(id, k) }, cv, h('span.sk-card-name', label), h('span.sk-card-sub', k === 'slim' ? 'Slim' : 'Classic'));
      tip(b, ['Start from ' + label, 'Edits a copy of the default skin']);
      return b;
    });
    openSheet('New skin', [
      h('div.sk-newrow', h('div.sk-newblank', h('h4', 'Blank'), h('p.sk-hint', 'A plain body in one colour, ready to paint.'), h('div.sk-row', h('label.sk-colrow', h('span', 'Base colour'), baseIn), kindSeg),
        h('div.sk-row', h('button.btn.primary', { type: 'button', onclick: () => newBlank(base, kind) }, 'Start blank'), h('button.btn', { type: 'button', onclick: () => newBlank(null, kind) }, 'Fully transparent')))),
      h('h4', 'From a default skin'), h('div.sk-cards', cards)], { wide: true });
  }

  /* ---- Open ---- */
  function openOpen() {
    const file = h('input', { type: 'file', accept: 'image/png,.png,.json', class: 'sr', tabindex: -1, 'aria-label': 'Choose a skin PNG', onchange: () => { const f = file.files[0]; file.value = ''; if (f) openFile(f); } });
    const user = h('input.field', { type: 'text', maxlength: 16, placeholder: 'Username', 'aria-label': 'Minecraft username', spellcheck: false, autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') openUsername(user.value); } });
    openSheet('Open a skin', [
      h('div.sk-openrow', h('button.btn.primary', { type: 'button', autofocus: true, onclick: () => file.click() }, 'Choose a PNG file'), file, h('p.sk-hint', 'Or drop a PNG anywhere on this page. 64 × 64, old 64 × 32 and HD skins all work.')),
      h('div.sk-openrow', h('button.btn', { type: 'button', onclick: pasteClipboard }, 'Paste from the clipboard'), h('p.sk-hint', 'Copied a skin image? Paste it here or press Ctrl+V on the page.')),
      LOCAL ? h('p.sk-hint', 'Looking up a player’s skin needs the online toolbox.') : h('div.sk-openrow', h('div.sk-inrow', user, h('button.btn', { type: 'button', onclick: () => openUsername(user.value) }, 'Load player')), h('p.sk-hint', 'Edits a copy of any Java player’s current skin (and cape).'))]);
  }

  /* ---- Browse: My skins, default skins, players ---- */
  const Lib = { tab: 'mine', q: '', invalidate() { if (Lib.paint) Lib.paint(); } };
  const commCache = new Map();
  function openBrowse(tab) {
    if (tab) Lib.tab = tab;
    const search = h('input.field.sk-search', { type: 'search', placeholder: 'Search my skins or a username', 'aria-label': 'Search', value: Lib.q, oninput: () => { Lib.q = search.value; paintBody(); },
      onkeydown: (e) => { if (e.key === 'Enter' && Lib.tab !== 'mine' && /^[A-Za-z0-9_]{1,16}$/.test(search.value.trim())) openUsername(search.value.trim()); } });
    const tabs = seg('Gallery', [['mine', 'My skins'], ['default', 'Default skins']].concat(LOCAL ? [] : [['players', 'Players']]), () => Lib.tab, (v) => { Lib.tab = v; paintBody(); });
    let defKind = 'auto';
    const body = h('div.sk-gallery.th-scroll');
    const card = (cv, title, sub, onOpen, extra, fav) => {
      const b = h('div.sk-card.sk-gcard', cv, h('span.sk-card-name', title), h('span.sk-card-sub', sub), h('div.sk-gacts', h('button.btn.small.primary', { type: 'button', onclick: onOpen }, 'Edit a copy'), extra));
      if (fav) b.classList.add('fav');
      return b;
    };
    function paintBody() {
      tabs.paint();
      const q = Lib.q.trim().toLowerCase();
      if (Lib.tab === 'mine') {
        const items = st().lib.filter((e) => !q || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))).sort((a, b) => (b.fav - a.fav) || (b.edited - a.edited));
        if (!items.length) { body.replaceChildren(h('p.sk-empty', st().lib.length ? 'No skin matches “' + Lib.q + '”.' : 'Nothing here yet. Save a skin with “Save to My skins” and it shows up here.')); return; }
        body.replaceChildren(h('div.sk-cards', items.map((e) => {
          const cv = thumbFor(e.png, e.model === 'slim', 112); cv.className = 'sk-card-cv';
          const heart = ibtn('heart', e.fav ? 'Remove from favourites' : 'Favourite', () => { save((s) => { const x = s.lib.find((y) => y.id === e.id); if (x) x.fav = !x.fav; }); paintBody(); }, { size: 14, cls: 'sk-mini' });
          press(heart, e.fav);
          const more = [heart,
            ibtn('edit', 'Rename and tags', async () => { const n = await TH.util.ask({ text: 'Name (add tags after a #, e.g. “Knight #armor #blue”)', input: e.name + (e.tags.length ? ' #' + e.tags.join(' #') : ''), ok: 'Save' }); if (!n) return; const parts = n.split('#'); save((s) => { const x = s.lib.find((y) => y.id === e.id); if (x) { x.name = parts[0].trim().slice(0, 40) || x.name; x.tags = parts.slice(1).map((t) => t.trim()).filter(Boolean).slice(0, 8); } }); paintBody(); }, { size: 14, cls: 'sk-mini' }),
            ibtn('copy', 'Duplicate', () => { save((s) => { const i = s.lib.findIndex((y) => y.id === e.id); s.lib.splice(i + 1, 0, Object.assign(JSON.parse(JSON.stringify(e)), { id: uid('skin'), name: e.name + ' copy', created: Date.now(), edited: Date.now() })); }); paintBody(); }, { size: 14, cls: 'sk-mini' }),
            ibtn('dl', 'Download the PNG', () => { const a = h('a', { href: e.png, download: (e.name || 'skin').replace(/[^\w\- ]+/g, '') + '.png' }); document.body.appendChild(a); a.click(); a.remove(); }, { size: 14, cls: 'sk-mini' }),
            ibtn('x', 'Delete', () => TH.util.guard(true, 'Delete “' + e.name + '” from My skins?', () => { save((s) => { s.lib = s.lib.filter((y) => y.id !== e.id); if (s.work && s.work.libId === e.id) s.work.libId = null; }); paintBody(); patchStatus(); }, 'Delete'), { size: 14, cls: 'sk-mini' })];
          const c = card(cv, e.name, (e.model === 'slim' ? 'Slim' : 'Classic') + ' · ' + fmtDate(e.edited) + (e.versions && e.versions.length ? ' · ' + e.versions.length + ' versions' : '') + (e.tags.length ? ' · #' + e.tags.join(' #') : ''), () => openLib(e.id), h('span.sk-gmore', more), e.fav);
          c.querySelector('.btn.primary').textContent = 'Open';
          return c;
        })));
        return;
      }
      if (Lib.tab === 'default') {
        const kindSeg = seg('Arm width', [['auto', 'Their own'], ['wide', 'All classic'], ['slim', 'All slim']], () => defKind, (v) => { defKind = v; paintBody(); });
        body.replaceChildren(h('div.sk-row', h('span.sk-slbl', 'Arms'), kindSeg), h('div.sk-cards', DEFAULT_SKINS.filter(([id, l]) => !q || l.toLowerCase().includes(q)).map(([id, label, k0]) => {
          const k = defKind === 'auto' ? k0 : defKind;
          const cv = h('canvas.sk-card-cv', { width: 112, height: 112 });
          urlToBuf(texURL(id, k)).then((b) => cv.getContext('2d').drawImage(isoRender({ w: 64, h: 64, data: b.data }, k === 'slim', 112), 0, 0)).catch(() => cv.classList.add('err'));
          return card(cv, label, (k === 'slim' ? 'Slim' : 'Classic') + ' · default skin', () => openDefault(id, k));
        })));
        return;
      }
      // players: Mojang staff + creators, plus whatever was typed
      const names = COMMUNITY.slice();
      const typed = Lib.q.trim();
      if (/^[A-Za-z0-9_]{3,16}$/.test(typed) && !names.some((n) => n.toLowerCase() === typed.toLowerCase())) names.unshift(typed);
      const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || n === typed);
      body.replaceChildren(h('p.sk-hint', 'Mojang staff and well-known players. Type any username above and press Enter to open theirs.'), h('div.sk-cards', shown.map((n) => {
        const cv = h('canvas.sk-card-cv', { width: 112, height: 112 });
        const c = card(cv, n, 'Loading…', () => openUsername(n));
        const sub = c.querySelector('.sk-card-sub');
        let p = commCache.get(n.toLowerCase());
        if (!p) { p = TH.mcSkin.fetchNamedSkin(n); commCache.set(n.toLowerCase(), p); p.catch(() => {}); }
        p.then((r) => { const d = r.canvas.getContext('2d').getImageData(0, 0, 64, 64).data; cv.getContext('2d').drawImage(isoRender({ w: 64, h: 64, data: d }, r.slim, 112), 0, 0); sub.textContent = (r.slim ? 'Slim' : 'Classic') + (r.cape ? ' · cape' : ''); })
          .catch(() => { c.remove(); });
        return c;
      })));
    }
    Lib.paint = paintBody;
    openSheet('Browse skins', [h('div.sk-row.sk-browsebar', tabs, search), body], { wide: true, onClose: () => { Lib.paint = null; } });
    paintBody();
  }

  /* ---- Export ---- */
  function openExport() {
    flushWork();
    const ck = E.check(ED.comp, model());
    const warn = [];
    if (ck.transparentBase) warn.push(ck.transparentBase + ' base-layer pixels are see-through: the game shows them in their stored colour (usually black). Part tools → “Make the base solid” fixes it.');
    if (ck.partialBase) warn.push(ck.partialBase + ' base-layer pixels are half see-through: the game shows them fully solid.');
    if (ck.unusedPixels) warn.push(ck.unusedPixels + ' pixels lie in unused areas; they are left out of the download.');
    const capeBtn = ED.capeCv ? h('button.btn', { type: 'button', onclick: () => ED.capeCv.toBlob((b) => downloadBlob(b, fileName() + '-cape.png'), 'image/png') }, 'Download the cape PNG') : null;
    const imp = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', tabindex: -1, 'aria-label': 'Import a skin collection', onchange: async () => { const f = imp.files[0]; imp.value = ''; if (f) importCollection(await f.text()); } });
    openSheet('Export', [
      h('div.sk-exprow', h('canvas.sk-expthumb', { width: 120, height: 120 }), h('div',
        h('p.sk-hint', (st().work.name || 'My skin') + ' · ' + (model() === 'slim' ? 'Slim (3 px arms)' : 'Classic (4 px arms)') + ' · 64 × 64 PNG'),
        h('div.sk-row', h('button.btn.primary', { type: 'button', autofocus: true, onclick: downloadPNG }, 'Download PNG'), h('button.btn', { type: 'button', onclick: copyPNG }, 'Copy PNG'), capeBtn),
        warn.length ? h('ul.sk-warn', warn.map((w) => h('li', w))) : h('p.sk-ok', 'Ready for Minecraft: every base pixel is solid.'))),
      h('div.sk-help',
        h('h4', 'Put it on in Minecraft (Java Edition)'),
        h('ol', h('li', 'Open the Minecraft Launcher and go to Minecraft: Java Edition, then Skins.'), h('li', 'Choose New skin, pick the PNG you downloaded and the arm width: ' + (model() === 'slim' ? 'Slim' : 'Classic') + '.'), h('li', 'Save & use. Or upload it on minecraft.net under Profile, Skin.')),
        h('h4', 'Bedrock Edition'),
        h('ol', h('li', 'Dressing Room, then Classic skins.'), h('li', 'Owned, Import, Choose new skin, and pick the PNG.')),
        h('p.sk-hint', 'This editor never asks for your account. Skins only change through Mojang’s own launcher or website.')),
      h('h4', 'Your collection'),
      h('div.sk-row', h('button.btn', { type: 'button', onclick: exportCollection }, 'Export My skins (.json)'), h('button.btn', { type: 'button', onclick: () => imp.click() }, 'Import a collection'), imp, h('button.btn', { type: 'button', onclick: downloadShot }, 'Save a picture of the model'))], { wide: true });
    const t = document.querySelector('.sk-expthumb');
    if (t) t.getContext('2d').drawImage(isoRender(ED.comp, model() === 'slim', 120), 0, 0);
  }

  /* ---- Adjust colours (live preview, Apply / Cancel) ---- */
  function openAdjust() {
    const L = layer();
    if (L.locked) { toast('This layer is locked'); return; }
    commitFloat();
    const before = E.cloneBuf(L.buf), o = { hue: 0, sat: 0, bright: 0, contrast: 0, posterize: 0, invert: false, gray: false };
    const mask = maskFor(null);
    let applied = false;
    const run = () => { L.buf.data.set(before.data); E.adjust(L.buf, o, mask); touched(null, { quiet: true }); };
    const s = (label, k, min, max, fmt) => slider(label, min, max, 1, () => (k === 'hue' || k === 'posterize' ? o[k] : Math.round(o[k] * 100)), (v) => { o[k] = k === 'hue' || k === 'posterize' ? v : v / 100; run(); }, fmt);
    const box = openSheet('Adjust colours', [
      h('p.sk-hint', selActive() ? 'Changes the selected pixels of the layer “' + L.name + '”.' : 'Changes the whole layer “' + L.name + '”. Select pixels first to change only those.'),
      s('Hue', 'hue', -180, 180, (v) => v + '°'), s('Saturation', 'sat', -100, 100, (v) => v + '%'), s('Brightness', 'bright', -100, 100, (v) => v + '%'), s('Contrast', 'contrast', -100, 100, (v) => v + '%'),
      s('Posterise', 'posterize', 0, 8, (v) => (v < 2 ? 'Off' : v + ' levels')),
      h('div.sk-row', toggle('Invert', () => o.invert, (v) => { o.invert = v; run(); }), toggle('Greyscale', () => o.gray, (v) => { o.gray = v; run(); })),
      h('div.sk-row.sk-dlg-acts', h('button.btn', { type: 'button', onclick: () => closeSheet() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: () => { applied = true; if (ED.hist.pixels('Adjust colours', L.id, before, L.buf)) { patchHistory(); patchPalette(); markEdited(); } closeSheet(); } }, 'Apply'))],
    { modeless: true, side: true, onClose: () => { if (!applied) { L.buf.data.set(before.data); touched(null, { quiet: true }); } } });
    void box;
  }

  /* ---- Part tools ---- */
  function openPartTools() {
    let mirror = true, puffMode = 'copy', fit = 'middle';
    const pt = (label, fn, sub) => { const b = h('button.btn.small', { type: 'button', onclick: fn }, label); if (sub) tip(b, [label, sub]); return b; };
    const copyRow = [['rarm', 'larm', 'Right arm → left arm'], ['larm', 'rarm', 'Left arm → right arm'], ['rleg', 'lleg', 'Right leg → left leg'], ['lleg', 'rleg', 'Left leg → right leg']]
      .map(([a, b, l]) => pt(l, () => op('Copy ' + E.PART[a].label.toLowerCase(), (buf) => E.unionRect(E.copyPart(buf, model(), a, b, mirror), E.copyPart(buf, model(), E.PART[a].outer, E.PART[b].outer, mirror)))));
    const clearRow = BASE_PARTS.map(([id, l]) => pt(l, () => op('Clear ' + l.toLowerCase(), (buf) => E.clearPart(buf, model(), id))))
      .concat(BASE_PARTS.map(([id]) => { const o = E.PART[id].outer; return pt(E.PART[o].label, () => op('Clear ' + E.PART[o].label.toLowerCase(), (buf) => E.clearPart(buf, model(), o))); }));
    const puffRow = [['All', null], ['Hat', ['head']], ['Jacket', ['body']], ['Sleeves', ['rarm', 'larm']], ['Pants', ['rleg', 'lleg']]].map(([l, parts]) =>
      pt(l === 'All' ? 'Whole outer layer' : l, () => op('Make ' + l.toLowerCase(), (buf) => E.puff(buf, model(), puffMode, parts, false)), 'Builds it from the base layer; outer pixels you already painted stay'));
    openSheet('Part tools', [
      h('h4', 'Copy a limb'), h('div.sk-row', seg('Copy as', [[true, 'Mirrored', 'Like a mirror image: the outer side stays outside'], [false, 'Same', 'Face by face, unchanged']], () => mirror, (v) => { mirror = v; })), h('div.sk-btnrow', copyRow),
      h('h4', 'Outer layer from the base'), h('div.sk-row', seg('Puff', [['copy', 'Copy', 'The whole base, one layer out'], ['outline', 'Outline', 'Only the rim of every face, a shade darker'], ['details', 'Details', 'Only what differs from the main colour of each face']], () => puffMode, (v) => { puffMode = v; })), h('div.sk-btnrow', puffRow),
      h('h4', 'Arm width'), h('p.sk-hint', 'Converting re-fits the arm pixels: slim drops one column of each arm face, classic doubles one.'),
      h('div.sk-row', seg('Column', [['middle', 'Middle', 'Drop or double the column next to the middle'], ['inner', 'Inner', 'Drop or double the column at the body'], ['outer', 'Outer', 'Drop or double the outside column']], () => fit, (v) => { fit = v; })),
      h('div.sk-btnrow', pt('Convert to slim (3 px)', () => convertModel('slim', fit)), pt('Convert to classic (4 px)', () => convertModel('classic', fit)), pt('Only switch the model', () => convertModel(model() === 'slim' ? 'classic' : 'slim', null, true), 'Keeps every pixel where it is')),
      h('h4', 'Clear a part'), h('div.sk-btnrow', clearRow),
      h('h4', 'Clean up'), h('div.sk-btnrow',
        pt('Make the base solid', () => op('Make base solid', (buf) => E.flattenBase(buf, model(), 'fill', E.hex2rgba(ui().color2))), 'See-through base pixels are filled with the second colour, as the game cannot show them'),
        pt('Clear unused pixels', () => op('Clear unused', (buf) => E.clearUnused(buf, model())), 'Pixels outside every part are never shown'),
        pt('Merge all layers', () => { if (ED.doc.layers.length > 1) docOp('Merge all layers', (d) => { E.flattenDoc(d); }); else toast('There is only one layer'); }))], { modeless: true, side: true });
  }

  /* ---- Reference image ---- */
  const REF = { img: null, show: true, opacity: 0.5, part: 'head', face: 'front', whole: false };
  function refRect() {
    if (REF.whole) return [0, 0, 64, 64];
    const r = E.rectOf(model(), REF.part, REF.face);
    return r ? [r.x, r.y, r.w, r.h] : null;
  }
  function openReference() {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr', tabindex: -1, 'aria-label': 'Choose a reference image', onchange: async () => { const f = file.files[0]; file.value = ''; if (!f) return; REF.img = await loadImage(await fileToURL(f)); REF.show = true; Sheet.invalidate(); paint(); } });
    const partSeg = seg('Part', [['head', 'Head'], ['hat', 'Hat'], ['body', 'Body'], ['rarm', 'R arm'], ['larm', 'L arm'], ['rleg', 'R leg'], ['lleg', 'L leg']], () => REF.part, (v) => { REF.part = v; REF.whole = false; Sheet.invalidate(); });
    const faceSeg = seg('Face', [['front', 'Front'], ['back', 'Back'], ['right', 'Right'], ['left', 'Left'], ['top', 'Top'], ['bottom', 'Bottom']], () => REF.face, (v) => { REF.face = v; REF.whole = false; Sheet.invalidate(); });
    const info = h('p.sk-hint');
    const paint = () => { info.textContent = REF.img ? 'The picture shows on the flat sheet over the chosen face. Paint over it, or stamp it on.' : 'Load a picture to trace over it on the flat sheet.'; };
    openSheet('Reference image', [
      h('div.sk-row', h('button.btn.primary', { type: 'button', onclick: () => file.click() }, 'Choose a picture'), file, toggle('Show', () => REF.show, (v) => { REF.show = v; Sheet.invalidate(); }), toggle('Whole sheet', () => REF.whole, (v) => { REF.whole = v; Sheet.invalidate(); }, { tip: ['Whole sheet', 'Stretch it over the whole 64 × 64 texture (e.g. another skin)'] })),
      info, partSeg, faceSeg,
      slider('Opacity', 0.1, 1, 0.05, () => REF.opacity, (v) => { REF.opacity = v; Sheet.invalidate(); }, (v) => Math.round(v * 100) + '%'),
      h('div.sk-row.sk-dlg-acts', h('button.btn', { type: 'button', onclick: () => { REF.img = null; Sheet.invalidate(); paint(); } }, 'Remove'),
        h('button.btn.primary', { type: 'button', onclick: () => { if (!REF.img) { toast('Choose a picture first'); return; } const r = refRect(); const c = mkCanvas(REF.img.naturalWidth, REF.img.naturalHeight); c.getContext('2d').drawImage(REF.img, 0, 0); const src = imgToBuf(c); op('Stamp reference', (buf) => E.project({ w: src.w, h: src.h, data: src.data }, buf, r, 1, maskFor(null))); } }, 'Stamp onto the layer'))],
    { modeless: true, side: true });
    paint();
  }

  /* ---- Cape editor (64 x 32 sheet with pencil, eraser, fill, picker) ---- */
  function openCape() {
    if (!ED.cape) { newCape(); setTimeout(openCape, 120); return; }
    let tool = 'pencil';
    const cv = h('canvas.sk-capecv', { width: 64, height: 32 });
    const hist = new E.History({ maxSteps: 60 });
    const draw = () => { cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(ED.cape.data), 64, 32), 0, 0); };
    let stroke = null;
    const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * 64), Math.floor((e.clientY - r.top) / r.height * 32)]; };
    const capeMask = (() => { const m = new Uint8Array(64 * 32); E.capeRects().forEach((r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * 64 + x] = 1; }); return m; })();
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = at(e), c = E.hex2rgba(e.button === 2 ? ui().color2 : ui().color), before = E.cloneBuf(ED.cape);
      if (tool === 'picker' || e.altKey) { const p = E.pickColor(ED.cape, x, y); if (p && p[3]) setColor(E.rgba2hex(p, true), e.button === 2 ? 1 : 0); return; }
      if (tool === 'fill') { if (E.fill(ED.cape, x, y, c, { mask: capeMask })) { hist.pixels('Fill', 'cape', before, ED.cape); draw(); capeChanged(); } return; }
      stroke = { before, st: E.beginStroke(ED.cape, { tool: tool === 'eraser' ? 'eraser' : 'pencil', color: c, mask: capeMask }) };
      E.strokeTo(stroke.st, x, y); draw(); capeChanged();
    });
    cv.addEventListener('pointermove', (e) => { if (!stroke) return; const [x, y] = at(e); E.strokeTo(stroke.st, x, y); draw(); capeChanged(); });
    const end = () => { if (!stroke) return; hist.pixels('Cape', 'cape', stroke.before, ED.cape); stroke = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    const capeDoc = { layers: [{ id: 'cape', buf: null }] };
    const step = (fn) => { capeDoc.layers[0].buf = ED.cape; if (fn()) { draw(); capeChanged(); } };
    const tools = seg('Cape tool', [['pencil', 'Pencil'], ['eraser', 'Eraser'], ['fill', 'Fill'], ['picker', 'Picker']], () => tool, (v) => { tool = v; });
    openSheet('Cape', [
      h('p.sk-hint', 'The cape texture is 64 × 32: the cape itself on the left (front at 1,1, 10 × 16), the elytra look on the right. Uses your current colours.'),
      h('div.sk-row', tools, ibtn('undo', 'Undo', () => step(() => hist.undo(capeDoc)), { size: 16, cls: 'sk-mini' }), ibtn('redo', 'Redo', () => step(() => hist.redo(capeDoc)), { size: 16, cls: 'sk-mini' })),
      h('div.sk-capewrap', cv),
      h('div.sk-row', h('button.btn.small', { type: 'button', onclick: () => { if (ED.capeCv) ED.capeCv.toBlob((b) => downloadBlob(b, fileName() + '-cape.png'), 'image/png'); } }, 'Download cape PNG'))],
    { modeless: true, side: true });
    draw();
    if (!ui().capeOn) { save((s) => { s.ui.capeOn = true; }); applyCape(); patchViewBar(); }
  }

  /* ---- shortcuts card ---- */
  function openKeys() {
    const rows = TOOLS.map((t) => [t[2], t[1]]).concat([
      ['[ / ]', 'Brush smaller / bigger'], ['X', 'Swap the two colours'], ['Alt + click', 'Pick a colour'], ['Y', 'Mirror painting on / off'], ['H', 'Show / hide the outer layer'],
      ['1 … 9, 0', 'Opacity 10 … 90 %, 100 %'], ['Shift + 1 / 2 / 3', 'Model big / flat sheet big / fold the docked view'], ['Ctrl + Z', 'Undo'], ['Ctrl + Y, Ctrl + Shift + Z', 'Redo'],
      ['Ctrl + C / X / V', 'Copy / cut / paste the selection'], ['Ctrl + A / D', 'Select all / nothing'], ['Delete', 'Clear the selected pixels'], ['Arrows', 'Move the selection (Move tool), turn the model'],
      ['Enter / Esc', 'Drop / cancel a move'], ['Space + drag', 'Pan the view'], ['Right-drag', 'Turn the model while painting'], ['K', 'Play / pause the animation'], ['Home (on the model)', 'Reset the view'],
      ['A', 'Adjust colours'], ['P', 'Part tools'], ['J', 'Reference image'], ['Ctrl + S', 'Save to My skins'], ['?', 'This card']]);
    openSheet('Keyboard shortcuts', h('dl.sk-keys', rows.map(([k, d]) => [h('dt', h('kbd', k)), h('dd', d)])), { wide: true });
  }

  /* ====================================================================== keyboard, paste, drop */
  const isTyping = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)) && !(t.type === 'range');
  const active = () => UI && UI.wrap.isConnected;
  document.addEventListener('keydown', (e) => {
    if (!active() || isTyping(e.target) || document.querySelector('.th-ask')) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.length === 1 ? k.toLowerCase() : k;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod) {
      if (lk === 'z' && !e.shiftKey) { done(); undo(); }
      else if (lk === 'y' || (lk === 'z' && e.shiftKey)) { done(); redo(); }
      else if (lk === 's') { done(); saveToLibrary(); }
      else if (lk === 'c' && selActive()) { done(); copySel(false); }
      else if (lk === 'x' && selActive()) { done(); copySel(true); }
      else if (lk === 'v' && ED.clip) { done(); pasteSel(); }
      else if (lk === 'a') { done(); setSel(usedMask(model()).slice()); }
      else if (lk === 'd') { done(); setSel(null); }
      else if (lk === 'i') { done(); setSel(ED.sel ? E.selInvert(ED.sel).map((v, i) => v & usedMask(model())[i]) : null); }
      else if (lk === 'n' && e.altKey) { done(); openNew(); }
      return;
    }
    if (sheetEl && !sheetEl.classList.contains('modeless')) return;
    if (e.altKey) return;
    if (e.shiftKey && /^Digit[123]$/.test(e.code)) { done(); setView({ Digit1: 'model', Digit2: 'sheet', Digit3: 'both' }[e.code]); return; }
    if (e.shiftKey && lk === 'h' && (ED.float || ui().tool === 'move')) { done(); transformFloat('flipH'); return; }
    if (e.shiftKey && lk === 'v' && (ED.float || ui().tool === 'move')) { done(); transformFloat('flipV'); return; }
    if (e.shiftKey && (k === '<' || k === ',')) { done(); transformFloat('rotCCW'); return; }
    if (e.shiftKey && (k === '>' || k === '.')) { done(); transformFloat('rotCW'); return; }
    if (e.shiftKey && lk === 'l') { done(); save((s) => { s.ui.lit = !s.ui.lit; }); V.setLighting(ui().lit); patchViewBar(); return; }
    if (e.shiftKey && lk === 'g') { done(); const n = { none: 'grid', grid: 'parts', parts: 'none' }[ui().overlay]; save((s) => { s.ui.overlay = n; }); V.setOverlay(n); patchViewBar(); return; }
    const tool = TOOLS.find((t) => t[2].toLowerCase() === lk && !e.shiftKey);
    if (tool) { done(); setTool(tool[0]); return; }
    if (/^[0-9]$/.test(k)) { done(); const v = k === '0' ? 1 : +k / 10; save((s) => { s.ui.opacity = v; }); patchOptions(); toast('Opacity ' + Math.round(v * 100) + '%'); return; }
    if (k === '[' || k === ']') { done(); save((s) => { s.ui.size = clamp(s.ui.size + (k === ']' ? 1 : -1), 1, 8); }); patchOptions(); syncCursor3D(); Sheet.invalidate(); return; }
    if (lk === 'x') { done(); swapColors(); return; }
    if (lk === 'y') { done(); save((s) => { s.ui.sym.body = !s.ui.sym.body; }); patchTools(); patchOptions(); syncCursor3D(); toast(ui().sym.body ? 'Mirror painting on' : 'Mirror painting off'); return; }
    if (lk === 'h') { done(); setOuter(['hat', 'jacket', 'rsleeve', 'lsleeve', 'rpants', 'lpants'].every((p) => ui().hidden[p])); return; }
    if (lk === 'k') { done(); if (ui().tool !== 'orbit') { setTool('orbit'); V.setPaused(false); } else V.setPaused(!V.paused); return; }
    if (lk === 'a') { done(); openAdjust(); return; }
    if (lk === 'p') { done(); openPartTools(); return; }
    if (lk === 'j') { done(); openReference(); return; }
    if (k === '?') { done(); openKeys(); return; }
    if (k === 'Enter' && ED.float) { done(); commitFloat(); return; }
    if (k === 'Escape') { if (ED.float) { done(); cancelFloat(); } else if (ED.sel) { done(); setSel(null); } return; }
    if ((k === 'Delete' || k === 'Backspace') && (selActive() || ED.float)) { done(); deleteSel(); return; }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (arrow && (ui().tool === 'move' || ED.float) && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sk-canvas'))) { done(); const n = e.shiftKey ? 4 : 1; moveFloat(arrow[0] * n, arrow[1] * n); return; }
    if (k === '0' && !e.shiftKey) { done(); V.reset(); }
  }, true);
  window.addEventListener('paste', (e) => {
    if (!active() || isTyping(e.target)) return;
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((x) => /^image\//.test(x.type));
    if (f) { e.preventDefault(); openFile(f); }
  });
  ['dragover', 'drop', 'dragleave'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!active() || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    UI.wrap.classList.toggle('dropping', ev === 'dragover');
    if (ev === 'drop') { const f = e.dataTransfer.files[0]; if (f) openFile(f); }
  }));
  window.addEventListener('pagehide', () => flushWork());
  window.addEventListener('hashchange', () => { if (ED.loaded) flushWork(); });

  /* ====================================================================== patches (in place, no re-render) */
  let UI = null;
  const patchStatus = () => UI && UI.top.paint();
  const patchTools = () => UI && UI.rail.paint();
  const patchOptions = () => UI && UI.opts.paint();
  const patchViewBar = () => UI && UI.viewer.paint();
  const patchColor = () => UI && UI.color.paint();
  const patchRecent = () => UI && UI.color.paintRecent();
  let palT = 0;
  const patchPalette = () => { if (!UI) return; clearTimeout(palT); palT = setTimeout(() => { UI.color.paintSkinPal(); UI.layers.paintList(); }, 250); };
  const patchHistory = () => { if (UI) Side.paintHistory(); };
  const patchCape = () => { if (UI) { UI.layers.paintCape(); UI.viewer.paint(); } };
  const patchSheetZoom = () => { if (UI && UI.sheetZoom) UI.sheetZoom.textContent = Sheet.zoom() + '×'; };
  function patchAll() {
    if (!UI) return;
    [UI.top, UI.rail, UI.opts, UI.viewer, UI.color, UI.layers].forEach((p) => p.paint());
    UI.color.paintSkinPal(); Side.paintVersions(); Side.paintHistory();
    UI.stage.dataset.tool = ui().tool;
  }

  /** Shift+1 / 2 / 3: model big, sheet big, fold / unfold the docked view */
  function setView(v) { if (v === 'both') { if (ui().main === 'sheet') setMain('model'); else setDock(!ui().dock); } else setMain(v); }
  function applyView() {
    if (!UI) return;
    const u = ui();
    UI.stage.dataset.main = u.main;
    UI.stage.dataset.dock = u.dock ? 'open' : 'closed';
    Sheet.invalidate(); V.wake();
    setTimeout(() => { Sheet.invalidate(); patchSheetZoom(); V.wake(); }, 30);
  }
  /** phones: the side panels open as bottom sheets */
  function openPanel(which) {
    const panel = { color: UI.color, layers: UI.layers, side: UI.side }[which];
    const home = panel.parentNode, next = panel.nextSibling;
    openSheet({ color: 'Colour', layers: 'Body and layers', side: 'Versions and history' }[which], panel, { modeless: true, side: true, onClose: () => home.insertBefore(panel, next) });
  }

  function mount() {
    const wrap = h('div.sk-page');
    const top = buildTop(), rail = buildRail(), opts = buildOptions();
    const { stage, box: viewer } = buildStage();
    const color = buildColor(), layers = buildLayers(), side = buildSide();
    const panelKeys = h('div.sk-pkeys', [['color', 'Colour', 'adjust'], ['layers', 'Layers', 'parts'], ['side', 'Versions', 'copy']].map(([id, l, ic]) => {
      const b = h('button.btn.sk-pkey', { type: 'button', onclick: () => openPanel(id) }, ico(ic, 18), h('span', l)); return b;
    }));
    const centre = h('div.sk-centre', h('div.sk-centre-top', opts), viewer);
    wrap.append(
      h('div.page-head.sk-head', h('h2', 'Skin editor')),
      top,
      h('div.sk-work', rail, centre, h('div.sk-right.th-scroll', color, layers, side)),
      panelKeys,
      h('div.sk-dropall', { 'aria-hidden': 'true' }, 'Drop a skin PNG to open it'));
    UI = { wrap, top, rail, opts, viewer, stage, color, layers, side, sheetZoom: UI_STAGE.sheetZoom, info: UI_STAGE.info };
    phoneMQ.addEventListener('change', () => { if (sheetEl && sheetEl.querySelector('.sk-panel')) closeSheet(); applyView(); });
    new MutationObserver(() => Sheet.themeChanged()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tool', 'data-style'] });
    return UI;
  }

  let booting = null;
  async function boot() {
    const w = st().work;
    try {
      if (w) { const doc = await docFromSaved(w); setDoc(doc, null); if (w.cape) loadCape(w.cape); }
      else await openImageURL(texURL('steve', 'wide'), { name: 'Steve copy', cape: null }, { model: 'classic' });
    } catch (e) {
      const doc = E.newDoc('classic');
      const m = E.partsMask('classic', BASE_PARTS.map((p) => p[0])), c = E.hex2rgba('#c68642');
      for (let i = 0; i < 4096; i++) if (m[i]) doc.layers[0].buf.data.set(c, i * 4);
      setDoc(doc, { name: 'New skin', cape: null });
    }
    V.want = ui().anim;
    applyView(); patchSheetZoom();
  }

  function render(root) {
    if (!UI) mount();
    root.append(UI.wrap);
    setTool(ui().tool);
    applyView();
    patchAll();
    if (!booting) booting = boot();
    else { touched(null, { quiet: true, full: true }); }
    setTimeout(patchSheetZoom, 50);
  }

  /** Pure parts for tools/test-skins.js and the console. */
  TH.skins = { defaults, norm, isoRender, get ED() { return ED; }, get V() { return V; }, UI_DEFAULTS };

  TH.app.register({
    id: 'skins',
    name: 'Skin Editor',
    short: 'Skins',
    icon: () => { const s = h('span.sk-navico', { 'aria-hidden': 'true' }); s.style.setProperty('--tex', 'url("' + texURL('steve', 'wide') + '")'); return s; },
    init(store) {
      store.define('skins', defaults());
      const s = store.get();
      s.skins = norm(s.skins);
    },
    badge(state) { const n = state.skins && state.skins.lib ? state.skins.lib.length : 0; return n ? String(n) : null; },
    render,
  });
})();
