/**
 * Builds (orange accent): one tab, three sections around one 3D stage.
 *   Library   = our farms + schematic files you open (.schem, .litematic, .nbt, .schematic, .json); farm info,
 *               build steps, tips, and "Customise blocks" (swap decorative blocks, functional ones stay).
 *   Create    = shape generators (sphere, ellipsoid, circle, dome, cylinder, cone, pyramid, torus, tree), live preview.
 *   Materials = the block list of whatever the stage shows: items / stacks / shulker boxes, ticks, copy as text,
 *               plus a Litematica material list paste.
 * (A fourth section, block palettes, will join the switch later.)
 *
 * Files: builds-core.js (data model + block table, loaded with the page), then on first visit builds-io.js (loader /
 * exporter), builds-shapes.js, builds-farms.js and builds-view.js (mesher + three.js viewer, which imports
 * js/vendor/three.lite.module.min.js itself).
 *
 * state.builds = {
 *   v, section: 'library'|'create'|'materials', cur: 'farm:<id>'|'file:<id>', stage: key shown on the stage,
 *   mode: 'loop'|'once'|'still', speed, grid, outline, auto,
 *   shape: { kind, p: { [kind]: params }, block: { [kind]: id }, block2: { [kind]: id } },
 *   swaps: { [key]: { 'minecraft:stone_bricks': 'minecraft:deepslate_bricks' } },
 *   ticks: { [key]: { [itemId]: 1 } }, units: 'items'|'stacks'|'boxes', sort: 'count'|'name',
 *   files: [{ id, name, size, palette, data (run-length text), added }]   (only files small enough; see FILE_CAP)
 *   paste: { text, at } | null
 * }
 * Keys: 'farm:<id>', 'file:<id>', 'shape', 'paste'. Every change is saved silently and the page is patched in place.
 */
(function () {
  'use strict';
  const { h, toast, clamp } = TH.util;
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const rel = (p) => new URL(p, SRC).href;
  const LAZY = ['builds-io.js', 'builds-shapes.js', 'builds-farms.js', 'builds-view.js'];
  const FILE_CAP = 400000;    // characters of run-length data we keep in the saved state per file
  const MAX_FILES = 4;
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const B = () => TH.builds;
  const core = () => TH.builds.core;

  const DEFAULTS = {
    v: 3, browse: true, meta: {}, section: 'library', cur: 'farm:cow_crusher', stage: 'farm:cow_crusher',
    lib: { q: '', type: 'all', use: 'all', tech: 'all', topic: 'all', sort: 'name', more: false },
    mode: 'once', speed: 1, grid: true, outline: false, auto: true,
    shape: { kind: 'sphere', p: {}, block: {}, block2: {} },
    swaps: {}, ticks: {}, units: 'items', sort: 'count', files: [], paste: null, matSrc: 'stage',
  };
  const SHAPE_BLOCK = { sphere: 'minecraft:stone_bricks', ellipsoid: 'minecraft:white_concrete', circle: 'minecraft:polished_andesite', dome: 'minecraft:glass', cylinder: 'minecraft:bricks', cone: 'minecraft:spruce_planks', pyramid: 'minecraft:sandstone', torus: 'minecraft:prismarine', tree: 'minecraft:oak_log' };
  const SHAPE_BLOCK2 = { dome: 'minecraft:polished_andesite', cylinder: 'minecraft:stone_bricks', tree: 'minecraft:oak_leaves' };

  const S = () => TH.store.get().builds;
  const save = (fn) => TH.store.update((s) => { fn(s.builds); }, { silent: true });

  /* ======================================================================
   * Lazy loading
   * ====================================================================== */
  let loadP = null, ready = false, loadErr = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  function loadAll() {
    if (!loadP) loadP = LAZY.reduce((p, f) => p.then(() => loadScript(rel(f))), Promise.resolve()).then(() => { ready = true; }, (e) => { loadErr = e; loadP = null; throw e; });
    return loadP;
  }

  /* ======================================================================
   * Small pixel glyphs (7x7 masks, currentColor)
   * ====================================================================== */
  const GLYPH = {
    play: ['.#.....', '.##....', '.###...', '.####..', '.###...', '.##....', '.#.....'],
    pause: ['.##.##.', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.##.##.'],
    replay: ['..###..', '.#...#.', '#.....#', '#..#..#', '...###.', '....#..', '.......'],
    grid: ['#.#.#.#', '.......', '#.#.#.#', '.......', '#.#.#.#', '.......', '#.#.#.#'],
    outline: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
    slice: ['.......', '.......', '#######', '#######', '.......', '.......', '.......'],
    rot: ['..###..', '.#...#.', '#.....#', '#.....#', '#....##', '.#..#.#', '..###..'],
    reset: ['##...##', '#.....#', '.......', '...#...', '.......', '#.....#', '##...##'],
    down: ['...#...', '...#...', '...#...', '#.###.#', '.#####.', '..###..', '#######'],
    up: ['#######', '..###..', '.#####.', '#.###.#', '...#...', '...#...', '...#...'],
    copy: ['####...', '#..#...', '#..####', '#..#..#', '####..#', '...#..#', '...####'],
    lock: ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'],
    swap: ['..#....', '.###...', '#.#....', '..#..#.', '....#.#', '...###.', '....#..'],
    dice: ['#######', '#.....#', '#.#.#.#', '#.....#', '#.#.#.#', '#.....#', '#######'],
    x: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
    plus: ['...#...', '...#...', '...#...', '#######', '...#...', '...#...', '...#...'],
    minus: ['.......', '.......', '.......', '#######', '.......', '.......', '.......'],
    left: ['....#..', '...##..', '..###..', '.####..', '..###..', '...##..', '....#..'],
    right: ['..#....', '..##...', '..###..', '..####.', '..###..', '..##...', '..#....'],
    run: ['#......', '####...', '#####..', '#######', '#####..', '####...', '#......'],
    file: ['####...', '#..##..', '#...##.', '#....#.', '#....#.', '#....#.', '######.'],
  };
  const glyphURL = new Map();
  function glyph(name, cls) {
    let u = glyphURL.get(name);
    if (!u) {
      const rows = GLYPH[name] || GLYPH.x;
      let d = '';
      rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') d += 'M' + x + ' ' + y + 'h1v1h-1z'; });
      u = 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 7 7' shape-rendering='crispEdges'><path d='" + d + "'/></svg>") + '")';
      glyphURL.set(name, u);
    }
    const el = h('span.bd-ico' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    el.style.setProperty('--m', u);
    return el;
  }
  /* Shape tiles: 11x11 pixel pictures (two tones: # = body, + = shade) */
  const SHAPE_ART = {
    sphere: ['...#####...', '..#######..', '.##########', '###########', '###########', '##########+', '#########++', '########++.', '.######++..', '..#####+...', '...+++.....'],
    ellipsoid: ['...........', '..#######..', '.#########.', '###########', '###########', '##########+', '.########+.', '..######+..', '...+++++...', '...........', '...........'],
    circle: ['...#####...', '..#.....#..', '.#.......#.', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '.#.......#.', '..#.....#..', '...#####...'],
    dome: ['...........', '...........', '...#####...', '..#######..', '.#########.', '.#########.', '###########', '##########+', '#########++', '+++++++++++', '...........'],
    cylinder: ['..#######..', '.#########.', '.+#######+.', '.#########.', '.#########.', '.#########.', '.#########.', '.#########.', '.########+.', '.+#######+.', '..+++++++..'],
    cone: ['.....#.....', '.....#.....', '....###....', '....###....', '...#####...', '...####+...', '..######+..', '..#####++..', '.#######++.', '.#######++.', '++++++++++.'],
    pyramid: ['...........', '.....#.....', '....###....', '...#####...', '..#######..', '.#########.', '###########', '##########+', '+++++++++++', '...........', '...........'],
    torus: ['...........', '...........', '..#######..', '.##.....##.', '##.......##', '##.......##', '.##.....++.', '..+++++++..', '...........', '...........', '...........'],
    tree: ['...#####...', '..#######..', '.#########.', '.#########.', '..##+#++#..', '...+#+++...', '.....#.....', '.....#.....', '.....#.....', '....###....', '...........'],
  };
  function shapeArt(kind) {
    const rows = SHAPE_ART[kind];
    let a = '', b = '';
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { if (r[x] === '#') a += 'M' + x + ' ' + y + 'h1v1h-1z'; else if (r[x] === '+') b += 'M' + x + ' ' + y + 'h1v1h-1z'; } });
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 11 11'); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'bd-shape-art');
    s.innerHTML = '<path class="b" d="' + a + '"/><path class="s" d="' + b + '"/>';
    return s;
  }

  /* ======================================================================
   * Schematics by key
   * ====================================================================== */
  const mem = { files: new Map(), shape: null, shapeSig: '', paste: null };
  function fileRec(id) { return (S().files || []).find((f) => f.id === id); }
  function original(key) {
    if (!key) return null;
    if (key.startsWith('farm:')) return B().farms.schematic(key.slice(5));
    if (key.startsWith('file:')) {
      const id = key.slice(5);
      if (mem.files.has(id)) return mem.files.get(id);
      const r = fileRec(id);
      if (!r) return null;
      try {
        const s = core().create(r.size[0], r.size[1], r.size[2], r.name);
        s.palette = r.palette.slice(); s.blocks = core().unrle(r.data, r.size[0] * r.size[1] * r.size[2]);
        mem.files.set(id, s);
        return s;
      } catch (e) { return null; }
    }
    if (key === 'shape') return shapeSchem();
    return null;
  }
  /** The schematic as shown: the original with the user's block swaps applied. */
  function effective(key) {
    const s = original(key);
    if (!s || key === 'shape') return s;
    const sw = S().swaps[key];
    return sw && Object.keys(sw).length ? core().applySwaps(s, sw) : s;
  }
  function keyName(key) {
    if (!key) return '';
    if (key.startsWith('farm:')) { const f = B().farms.FARMS.find((x) => x.id === key.slice(5)); return f ? f.name : 'Farm'; }
    if (key.startsWith('file:')) { const r = fileRec(key.slice(5)); const m = mem.files.get(key.slice(5)); return (m && m.name) || (r && r.name) || 'File'; }
    if (key === 'shape') { const s = shapeSchem(); return s ? s.name : 'Shape'; }
    if (key === 'paste') return 'Pasted material list';
    return '';
  }
  function shapeParams(kind) {
    const st = S().shape, d = B().shapes.defaults()[kind];
    const p = Object.assign({}, d, st.p[kind] || {});
    p.block = st.block[kind] || SHAPE_BLOCK[kind];
    p.block2 = st.block2[kind] || SHAPE_BLOCK2[kind] || p.block;
    if (kind === 'tree') {
      const pr = B().shapes.TREE_PRESETS[p.preset] || B().shapes.TREE_PRESETS.oak;
      if (!st.block.tree) p.block = pr.log;
      if (!st.block2.tree) p.block2 = pr.leaves;
    }
    return p;
  }
  function shapeSchem() {
    const kind = S().shape.kind, p = shapeParams(kind), sig = kind + JSON.stringify(p);
    if (sig !== mem.shapeSig) { mem.shape = B().shapes.make(kind, p); mem.shapeSig = sig; }
    return mem.shape;
  }
  const fileSafe = (n) => String(n || 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';
  function downloadBlob(name, data, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  async function exportAs(s, fmt, base) {
    const name = fileSafe(base || s.name);
    try {
      if (fmt === 'json') downloadBlob(name + '.json', B().io.toJSON(s), 'application/json');
      else downloadBlob(name + '.schem', await B().io.toSchem(s), 'application/octet-stream');
      toast('Downloaded ' + name + (fmt === 'json' ? '.json' : '.schem'));
    } catch (e) { toast(e.message || 'Could not write that file'); }
  }

  /* ======================================================================
   * UI
   * ====================================================================== */
  let UI = null, V = null;
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  const press = (b, on) => { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on)); };
  const fmtN = (n) => n.toLocaleString('en').replace(/,/g, ' ');

  function mount() {
    const wrap = h('div.bd-page');
    // ---- page head + section switch ----
    const secs = [['library', 'Library'], ['create', 'Create'], ['materials', 'Materials']];
    const secBtns = secs.map(([id, label]) => h('button', { type: 'button', role: 'radio', 'data-sec': id, 'aria-checked': 'false', onclick: () => go(id) }, label));
    const secSeg = h('div.seg.bd-sections', { role: 'radiogroup', 'aria-label': 'Builds section' }, secBtns);
    secSeg.addEventListener('keydown', (e) => {
      const i = secBtns.indexOf(document.activeElement), step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (i < 0 || !step) return;
      e.preventDefault(); const j = (i + step + secBtns.length) % secBtns.length; secBtns[j].focus(); go(secs[j][0]);
    });
    const head = h('div.page-head.bd-head', h('h2', 'Builds'), h('div.bd-head-seg', secSeg));

    // ---- stage ----
    const stage = h('div.bd-stage');
    const title = h('div.bd-title'), meta = h('div.bd-meta');
    const zoomOut = h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Zoom out', onclick: () => V && V.zoomBy(1 / 1.25) }, '−');
    const zoomIn = h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Zoom in', onclick: () => V && V.zoomBy(1.25) }, '+');
    const resetV = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Reset the view', onclick: () => V && V.reset() }, glyph('reset')), 'Reset the view (double-click the stage)');
    tip(zoomOut, 'Zoom out'); tip(zoomIn, 'Zoom in');
    const hint = h('div.bd-hint', { 'aria-hidden': 'true' }, 'Drag to turn · scroll or pinch to zoom · hover a block');
    const drop = h('div.bd-drop', { 'aria-hidden': 'true' }, h('span', 'Drop a schematic file'), h('small', '.schem · .litematic · .nbt · .schematic · .json'));
    const loading = h('div.bd-loading', 'Loading the 3D view…');
    const runBtn = h('button.btn.small.bd-run', { type: 'button', 'aria-pressed': 'false', hidden: true, onclick: () => { if (!V || !V.hasRun()) return; V.setRun(!V.run); syncRun(); } }, glyph('run'), h('span', 'Run the machine'));
    tip(runBtn, 'Play the machine: the plants grow, the observer fires and the pistons move');
    const phaseCap = h('div.bd-phase', { 'aria-live': 'polite', hidden: true });
    stage.append(h('div.bd-label', title, meta), h('div.bd-runbox', runBtn, phaseCap), h('div.bd-frametools', { role: 'group', 'aria-label': 'View' }, zoomOut, zoomIn, resetV), hint, drop, loading);

    // ---- animation bar ----
    const playBtn = h('button.btn.small.bd-vk.bd-play', { type: 'button', 'aria-label': 'Pause', onclick: () => { if (!V) return; if (V.playing && V.mode !== 'still') V.pause(); else { if (S().mode === 'still') setMode('loop'); V.play(); } } }, glyph('pause'));
    const replayBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Build it again', onclick: () => { if (!V) return; if (S().mode === 'still') setMode('once'); V.replay(); } }, glyph('replay')), 'Build it again from the first block');
    const modes = [['loop', 'Loop', 'Build it, hold, take it apart and start again, forever'], ['once', 'Build', 'Build it once, block by block, and leave it standing'], ['still', 'Still', 'No animation: the finished build right away']];
    const modeBtns = modes.map(([id, label, t]) => tip(h('button', { type: 'button', role: 'radio', 'data-mode': id, 'aria-checked': 'false', onclick: () => setMode(id) }, label), t));
    const modeSeg = h('div.seg.bd-modes', { role: 'radiogroup', 'aria-label': 'Animation' }, modeBtns);
    const speeds = [[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']];
    const speedBtns = speeds.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'data-speed': v, 'aria-checked': 'false', onclick: () => { save((b) => { b.speed = v; }); if (V) V.setSpeed(v); syncBar(); } }, label));
    const speedSeg = tip(h('div.seg.bd-speeds', { role: 'radiogroup', 'aria-label': 'Speed' }, speedBtns), 'Animation speed');
    const layer = h('input.slider.bd-layer', { type: 'range', min: 1, max: 1, value: 1, step: 1, 'aria-label': 'Show layers up to' });
    const layerLbl = h('span.bd-layer-lbl');
    layer.addEventListener('input', () => { if (V) V.setLayer(+layer.value - 1); syncLayer(); });
    tip(layer, 'Hide the upper layers to look inside. Drag down to see the build from the bottom up.');
    const sliceBtn = tip(h('button.btn.small.bd-vk', { type: 'button', 'aria-pressed': 'false', onclick: () => { if (!V) return; V.setSlice(!V.slice); syncLayer(); } }, glyph('slice'), h('span.bd-vlabel', 'Only this layer')), 'Show only the chosen layer, from above, with its outline');
    const gridBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Blueprint grid', onclick: () => { save((b) => { b.grid = !b.grid; }); if (V) V.setGrid(S().grid); syncBar(); } }, glyph('grid')), 'Blueprint grid');
    const outlineBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Layer outline', onclick: () => { save((b) => { b.outline = !b.outline; }); if (V) V.setOutline(S().outline); syncBar(); } }, glyph('outline')), 'Outline of the top shown layer');
    const rotBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Turn slowly', onclick: () => { save((b) => { b.auto = !b.auto; }); if (V) V.setAuto(S().auto); syncBar(); } }, glyph('rot')), 'Turn slowly while idle');
    const bar = h('div.bd-abar', { role: 'group', 'aria-label': 'Animation and view' },
      h('div.bd-bar-grp', playBtn, replayBtn, modeSeg, speedSeg),
      h('div.bd-bar-grp.bd-bar-layer', h('label.bd-bar-lbl', { for: 'bd-layer' }, 'Layer'), layer, layerLbl, sliceBtn),
      h('div.bd-bar-grp.bd-bar-end', gridBtn, outlineBtn, rotBtn));
    layer.id = 'bd-layer';
    const viewer = h('section.panel.bd-viewer', { 'aria-label': '3D view' }, stage, bar);

    // ---- side ----
    const side = h('div.bd-side');
    const layout = h('div.bd-layout', viewer, side);
    wrap.append(head, layout);

    // ---- drag and drop + file input ----
    const fileIn = h('input', { type: 'file', accept: '.schem,.schematic,.litematic,.nbt,.json', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) openFile(f); } });
    wrap.append(fileIn);
    const dropOn = (on) => viewer.classList.toggle('dropping', on);
    viewer.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropOn(true); } });
    viewer.addEventListener('dragleave', (e) => { if (!viewer.contains(e.relatedTarget)) dropOn(false); });
    viewer.addEventListener('drop', (e) => { dropOn(false); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); openFile(f); } });

    // ---- hover tooltip (follows the pointer; same look as the app tooltip) ----
    const hov = h('div.th-tooltip.bd-hovtip', { role: 'tooltip' });
    document.body.appendChild(hov);
    let px = 0, py = 0;
    stage.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; if (hov.classList.contains('on')) placeHov(); });
    function placeHov() {
      const zf = parseFloat(document.documentElement.style.zoom) || 1;
      const w = hov.offsetWidth, hh = hov.offsetHeight, vw = document.documentElement.clientWidth / 1, vh = window.innerHeight;
      let x = px / zf + 14, y = py / zf - hh - 12;
      if (y < 4) y = py / zf + 18;
      x = clamp(x, 4, Math.max(4, vw / zf - w - 4)); y = clamp(y, 4, Math.max(4, vh / zf - hh - 4));
      hov.style.left = Math.round(x) + 'px'; hov.style.top = Math.round(y) + 'px';
    }
    function onHover(hit) {
      const s = UI.shown;
      if (!hit || !s) { hov.classList.remove('on'); return; }
      const id = core().get(s, hit[0], hit[1], hit[2]);
      if (core().isAir(id)) { hov.classList.remove('on'); return; }
      const p = core().parse(id), props = Object.entries(p.props).filter(([k]) => ['facing', 'axis', 'type', 'half', 'shape'].includes(k));
      const r = core().replaceable(id);
      const orig = UI.shownKey && UI.shownKey !== 'shape' ? original(UI.shownKey) : null;
      const oid = orig ? core().get(orig, hit[0], hit[1], hit[2]) : null;
      const swapped = oid && core().parse(oid).base !== p.base;
      hov.replaceChildren(...[
        h('span.th-tooltip-title', core().nameOf(id)),
        h('span.th-tooltip-sub', 'x ' + hit[0] + ' · y ' + hit[1] + ' · z ' + hit[2] + ' · layer ' + (hit[1] + 1)),
        props.length ? h('span.th-tooltip-sub', props.map(([k, v]) => k + ' ' + v.replace(/_/g, ' ')).join(' · ')) : null,
        !core().known(id) ? h('span.th-tooltip-sub', id) : null,
        swapped ? h('span.th-tooltip-sub', 'Swapped from ' + core().nameOf(oid)) : null,
        r.ok ? null : core().known(id) ? h('span.th-tooltip-tag', 'Functional') : h('span.th-tooltip-tag', 'Unknown block')].filter(Boolean));
      hov.classList.add('on');
      placeHov();
    }

    UI = { wrap, layout, head, secBtns, stage, title, meta, runBtn, phaseCap, loading, playBtn, modeBtns, speedBtns, layer, layerLbl, sliceBtn, gridBtn, outlineBtn, rotBtn, side, viewer, fileIn, hov, onHover, shown: null, shownKey: null, picker: null };
    return UI;
  }

  /* ---- viewer life cycle ---- */
  function accent() { return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff8a3d').trim() || '#ff8a3d'; }
  function ensureViewer() {
    if (!V) {
      V = B().view.create(UI.stage);
      TH.builds.viewer = V;   // handle for debugging in the console
      V.onState = syncPlay;
      V.onRun = (k, info, running) => syncRun(info, running);
      V.onHover = (hit) => UI.onHover(hit);
      new MutationObserver(() => { if (V) V.setAccent(accent()); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tool'] });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (V) setTimeout(() => V.setAccent(accent()), 50); });
    }
    const st = S();
    V.accent = accent();
    V.mode = reduced() ? 'still' : st.mode; V.speed = st.speed; V.gridOn = st.grid; V.outlineOn = st.outline; V.auto = st.auto && !reduced(); V.autoOk = V.auto;
    UI.loading.hidden = false; UI.loading.textContent = 'Loading the 3D view…'; UI.loading.classList.remove('err');
    return V.init().then(() => { UI.loading.hidden = true; show(st.stage || st.cur, { animate: true, layer: 'top' }); }).catch(() => {
      if (!UI.wrap.isConnected) return;   // left the tab while it was loading: it starts again on return
      UI.loading.hidden = false;
      UI.loading.textContent = (V && V.error) || 'The 3D view could not start.';
      UI.loading.classList.add('err');
    });
  }
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#/builds' && V) { V.dispose(); if (UI) UI.hov.classList.remove('on'); }
  });

  /** Put a schematic on the stage. opts: animate, keepView, layer: 'top'. */
  function show(key, opts) {
    opts = opts || {};
    let s = effective(key);
    if (!s && key !== 'farm:cow_crusher') { key = 'farm:cow_crusher'; s = effective(key); save((b) => { b.cur = key; }); }
    if (!s) return;
    UI.shown = s; UI.shownKey = key;
    if (S().stage !== key) save((b) => { b.stage = key; });
    UI.title.textContent = s.name;
    const n = core().volume(s);
    UI.meta.textContent = s.size[0] + ' × ' + s.size[1] + ' × ' + s.size[2] + ' · ' + fmtN(n) + ' blocks';
    UI.layer.max = s.size[1];
    if (opts.layer === 'top' || +UI.layer.value > s.size[1] || !opts.keepView) UI.layer.value = s.size[1];
    if (V && V.ready) {
      const ph = key.startsWith('farm:') ? B().farms.phases(key.slice(5), s) : null;
      V.setSchematic(s, { animate: !!opts.animate, keepView: !!opts.keepView, keepZoom: !!opts.keepView, phases: ph, layer: opts.layer || (+UI.layer.value >= s.size[1] ? 'top' : null) }).then(() => { if (V) { V.setLayer(+UI.layer.value - 1); syncLayer(); syncRun(); } });
    } else if (V) V.schem = s;
    syncLayer();
  }

  function setMode(m) {
    save((b) => { b.mode = m; });
    if (V) V.setMode(reduced() ? 'still' : m);
    syncBar();
  }
  function syncPlay(state) {
    if (!UI) return;
    const playing = state.playing && state.mode !== 'still' && state.phase !== 'done';
    const want = playing ? 'pause' : 'play';
    if (UI.playBtn.dataset.g !== want) {
      UI.playBtn.dataset.g = want;
      UI.playBtn.replaceChildren(glyph(want));
      UI.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    UI.viewer.style.setProperty('--bd-prog', state.end ? (state.t / state.end).toFixed(3) : 1);
  }
  function syncBar() {
    const st = S();
    UI.modeBtns.forEach((b) => { const on = b.dataset.mode === (reduced() ? 'still' : st.mode); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    UI.speedBtns.forEach((b) => { const on = +b.dataset.speed === st.speed; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    press(UI.gridBtn, st.grid); press(UI.outlineBtn, st.outline); press(UI.rotBtn, st.auto && !reduced());
    if (V) syncPlay({ playing: V.playing, mode: V.mode, phase: V.phase, t: V.t, end: V.M ? V.M.span + V.M.drop : 1 });
  }
  /** The Run button and the caption of the machine phase on the stage. */
  function syncRun(info, running) {
    if (!UI) return;
    const has = !!(V && V.ready && V.hasRun && V.hasRun());
    UI.runBtn.hidden = !has;
    const on = has && V.run;
    press(UI.runBtn, on);
    const lbl = UI.runBtn.querySelector('span:last-child');
    if (lbl) lbl.textContent = on ? 'Stop the machine' : 'Run the machine';
    UI.phaseCap.hidden = !on;
    if (on) { const i = info || (V.phaseInfo && V.phaseInfo[V.runIdx]); UI.phaseCap.textContent = i ? i.label : ''; }
  }
  function syncLayer() {
    const max = +UI.layer.max || 1, v = +UI.layer.value || max;
    UI.layerLbl.textContent = (V && V.slice ? 'only ' : '') + v + ' / ' + max;
    UI.layer.style.setProperty('--fill', ((v - 1) / Math.max(1, max - 1) * 100).toFixed(1) + '%');
    press(UI.sliceBtn, !!(V && V.slice));
  }

  /* ---- sections ---- */
  function go(sec) {
    const st = S();
    if (st.section === sec) return;
    save((b) => { b.section = sec; });
    // the stage follows the section: Library shows the chosen farm / file, Create the shape, Materials keeps what is shown
    if (sec === 'library' && UI.shownKey !== st.cur) show(st.cur, { animate: true, layer: 'top' });
    if (sec === 'create' && UI.shownKey !== 'shape') show('shape', { animate: true, layer: 'top' });
    patch();
  }

  function patch() {
    const st = S();
    UI.secBtns.forEach((b) => { const on = b.dataset.sec === st.section; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    UI.wrap.dataset.sec = st.section;
    const browsing = st.section === 'library' && st.browse;
    UI.layout.classList.toggle('is-browse', browsing);
    if (UI.wasBrowse && !browsing && !reduced()) {   // the build comes in, the library folds up beside it
      [UI.viewer, UI.side].forEach((e) => { e.classList.add('bd-enter'); setTimeout(() => e.classList.remove('bd-enter'), 700); });
    }
    UI.wasBrowse = browsing;
    UI.picker = null;
    const body = st.section === 'create' ? createSide() : st.section === 'materials' ? materialsSide() : librarySide();
    UI.side.replaceChildren(...body);
    syncBar(); syncLayer();
  }

  /* ======================================================================
   * Library
   * ====================================================================== */
  const DIM_NAME = { overworld: 'Overworld', nether: 'Nether', end: 'End' };
  function thumb(icon) { return h('span.bd-thumb', { 'aria-hidden': 'true' }, TH.icon(icon, { size: 32 })); }
  function pickKey(key) {
    save((b) => { b.cur = key; b.section = 'library'; b.browse = false; });
    patch();   // the viewer is on screen again before it is filled
    show(key, { animate: true, layer: 'top' });
  }
  const USE = { afk: ['AFK', 'Runs by itself while you do something else nearby'], semi: ['Semi-AFK', 'Mostly automatic, you top it up or collect now and then'], manual: ['Manual', 'You do the work by hand'] };
  const CATS = [['all', 'All'], ['farm', 'Farms'], ['machine', 'Machines'], ['build', 'Structures'], ['yours', 'Yours']];
  const TECH = [['all', 'Any'], ['redstone', 'Redstone'], ['no-redstone', 'No redstone']];
  const TAG_LABEL = { pistons: 'Pistons', observer: 'Observers', hoppers: 'Hoppers', crops: 'Crops', mobs: 'Mobs', food: 'Food', utility: 'Utility', house: 'Houses', defence: 'Defence', medieval: 'Medieval', landmark: 'Landmarks', coastal: 'Coastal', decor: 'Decor', japanese: 'Japanese', village: 'Village', wood: 'Wood', stone: 'Stone', 'no-redstone': 'No redstone', redstone: 'Redstone' };
  const tagLabel = (t) => TAG_LABEL[t] || (t[0].toUpperCase() + t.slice(1));
  const NOT_TOPIC = new Set(['redstone', 'no-redstone', 'yours']);
  const LEVEL_RANK = { Easy: 0, Medium: 1, Hard: 2 };
  const USE_RANK = ['afk', 'semi', 'manual', null];
  function useBadge(u) { return u && USE[u] ? h('span.pill.bd-use.bd-use-' + u, USE[u][0]) : null; }

  /** Everything the Library can show: our builds plus the files you opened (with the tags you gave them). */
  function libEntries() {
    const st = S(), fp = fileParts();
    const farms = B().farms.FARMS.map((f) => ({ key: 'farm:' + f.id, farm: f, cat: f.cat || 'farm', name: f.name, pitch: f.pitch, icon: f.icon, use: f.use || null, tags: f.tags || [], level: f.level, dim: f.dim }));
    const mine = fp.rows.map((r) => {
      const m = st.meta[r.key] || {};
      return { key: r.key, rec: r.rec, cat: 'yours', name: m.name || r.rec.name, pitch: r.rec.size.join(' × ') + (r.rec.session ? ' · this visit only' : ''), icon: null, use: m.use || null, tags: ['yours'].concat(m.tags || []), level: 'Easy', dim: null };
    });
    return farms.concat(mine).map((e) => Object.assign(e, { text: (e.name + ' ' + e.pitch + ' ' + e.tags.join(' ') + ' ' + (e.use ? USE[e.use][0] : '')).toLowerCase() }));
  }
  function libMatch(e, lib, skip) {
    const t = (lib.q || '').trim().toLowerCase();
    if (t && !e.text.includes(t)) return false;
    if (skip !== 'type' && lib.type !== 'all' && e.cat !== lib.type) return false;
    if (skip !== 'use' && lib.use !== 'all' && e.use !== lib.use) return false;
    if (skip !== 'tech' && lib.tech !== 'all' && !e.tags.includes(lib.tech)) return false;
    if (skip !== 'topic' && lib.topic !== 'all' && !e.tags.includes(lib.topic)) return false;
    return true;
  }
  function libList(all) {
    const lib = S().lib;
    const list = all.filter((e) => libMatch(e, lib));
    list.sort((x, y) => (lib.sort === 'easy' ? (LEVEL_RANK[x.level] || 0) - (LEVEL_RANK[y.level] || 0) : lib.sort === 'afk' ? USE_RANK.indexOf(x.use) - USE_RANK.indexOf(y.use) : 0) || x.name.localeCompare(y.name));
    return list;
  }

  function removeFile(rec) {
    const key = 'file:' + rec.id;
    save((b) => { b.files = (b.files || []).filter((x) => x.id !== rec.id); delete b.swaps[key]; delete b.ticks[key]; delete b.meta[key]; if (b.cur === key) b.cur = 'farm:cow_crusher'; if (b.stage === key) b.stage = b.cur; });
    mem.files.delete(rec.id);
    if (mem.sessionOnly) mem.sessionOnly = mem.sessionOnly.filter((x) => x.id !== rec.id);
    if (UI.shownKey === key) show(S().cur, { animate: true, layer: 'top' });
    patch();
  }

  /** One build as a card: icon, name, a two-line pitch, badges. */
  function card(e) {
    const st = S(), on = st.cur === e.key;
    const del = e.rec ? tip(h('button.bd-x.bd-card-x', { type: 'button', 'aria-label': 'Remove ' + e.name, onclick: (ev) => { ev.stopPropagation(); removeFile(e.rec); } }, glyph('x')), 'Remove from the library') : null;
    return h('div.bd-cardwrap', h('button.bd-card' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), onclick: () => pickKey(e.key) },
      h('span.bd-card-top', e.icon ? thumb(e.icon) : h('span.bd-thumb.bd-thumb-file', { 'aria-hidden': 'true' }, glyph('file')), h('span.bd-card-name', e.name)),
      h('span.bd-card-sub', e.pitch),
      h('span.bd-card-tags', useBadge(e.use), e.dim ? h('span.pill.bd-dim', DIM_NAME[e.dim]) : null, e.cat !== 'yours' ? h('span.pill.bd-level', e.level) : null,
        st.swaps[e.key] && Object.keys(st.swaps[e.key]).length ? h('span.pill.bd-custom', 'custom') : null)), del);
  }

  /** Search + filter chips, shared by the wide browser. onChange refills the cards. */
  function filterBar(all, onChange, expanded) {
    const lib = S().lib;
    const box = h('div.bd-filters');
    const pick = (k, v) => { save((b) => { b.lib[k] = v; if (k === 'type' && !['all', 'farm', 'machine'].includes(v)) b.lib.use = 'all'; }); onChange(); fill(); };
    const group = (title, key, opts) => h('div.bd-fgrp', h('span.bd-flbl', title), h('div.bd-fchips', { role: 'group', 'aria-label': title }, opts.map(([id, label, n]) =>
      h('button.chip' + (lib[key] === id ? '.on' : n === 0 ? '.none' : ''), { type: 'button', 'aria-pressed': String(lib[key] === id), onclick: () => pick(key, id) }, label, n != null ? h('em', String(n)) : null))));
    function fill() {
      const cnt = (key, test) => all.filter((e) => libMatch(e, lib, key) && test(e)).length;
      const topics = [...new Set(all.flatMap((e) => e.tags))].filter((t) => !NOT_TOPIC.has(t)).sort((x, y) => tagLabel(x).localeCompare(tagLabel(y)));
      const showUse = ['all', 'farm', 'machine'].includes(lib.type);
      box.replaceChildren(...[
        group('Type', 'type', CATS.map(([id, l]) => [id, l, id === 'all' ? null : cnt('type', (e) => e.cat === id)])),
        showUse ? group('How you use it', 'use', [['all', 'Any'], ...Object.keys(USE).map((u) => [u, USE[u][0], cnt('use', (e) => e.use === u)])]) : null,
        group('Needs', 'tech', TECH.map(([id, l]) => [id, l, id === 'all' ? null : cnt('tech', (e) => e.tags.includes(id))])),
        topics.length ? group('Topic', 'topic', [['all', 'Any'], ...topics.map((t) => [t, tagLabel(t), cnt('topic', (e) => e.tags.includes(t))])]) : null,
        group('Sort', 'sort', [['name', 'A to Z'], ['easy', 'Easiest first'], ['afk', 'AFK first']])].filter(Boolean));
    }
    fill();
    const q = h('input.field.bd-search', { type: 'search', placeholder: 'Search builds, tags, blocks', 'aria-label': 'Search the library', value: lib.q || '', oninput: (ev) => { save((b) => { b.lib.q = ev.target.value; }); onChange(); fill(); } });
    return [q, box];
  }

  /** The wide browser: shown until a build is picked, and again from "Browse all builds". */
  function browsePanel() {
    const st = S(), all = libEntries();
    const grid = h('div.bd-cards', { role: 'list', 'aria-label': 'Builds' });
    const count = h('span.bd-count'), none = h('p.bd-none', 'Nothing matches. Clear a filter or the search.');
    const refill = () => {
      const list = libList(all);
      grid.replaceChildren(...list.map(card), fileParts().dz);
      count.textContent = list.length + (list.length === 1 ? ' build' : ' builds');
      none.hidden = !!list.length;
    };
    const [q, bar] = filterBar(all, refill);
    const back = UI.shownKey && UI.shownKey !== 'shape' ? h('button.btn.small', { type: 'button', onclick: () => { save((b) => { b.browse = false; }); patch(); } }, glyph('left'), 'Back to the build') : null;
    refill();
    return h('section.panel.bd-pan.bd-browse.has-sel', { 'aria-label': 'Library' },
      h('div.bd-pan-head', h('h3', 'Library'), count, back), h('p.bd-note', 'Pick a build and it opens in the 3D view, with the library tucked in beside it.'), q, bar, grid, none);
  }

  /** Beside the viewer: the current build as one compact key with step arrows, and a way back to the browser. */
  function compactPanel() {
    const st = S(), all = libEntries(), list = libList(all);
    const cur = all.find((e) => e.key === st.cur) || all[0];
    const i = list.findIndex((e) => e.key === st.cur);
    const step = (d) => { if (!list.length) return; const j = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length; pickKey(list[j].key); };
    const act = [st.lib.type !== 'all', st.lib.use !== 'all', st.lib.tech !== 'all', st.lib.topic !== 'all', (st.lib.q || '').trim()].filter(Boolean).length;
    const key = h('button.btn.bd-ckey', { type: 'button', 'aria-label': 'Current build: ' + cur.name + '. Browse all builds', onclick: () => { save((b) => { b.browse = true; }); patch(); } },
      cur.icon ? thumb(cur.icon) : h('span.bd-thumb.bd-thumb-file', { 'aria-hidden': 'true' }, glyph('file')),
      h('span.bd-ckey-txt', h('span.bd-ckey-name', cur.name), h('span.bd-ckey-sub', [USE[cur.use] ? USE[cur.use][0] : null, cur.level, cur.dim ? DIM_NAME[cur.dim] : null].filter(Boolean).join(' · '))));
    tip(key, 'Browse all builds, with search and filters');
    const prev = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Previous build', disabled: list.length < 2, onclick: () => step(-1) }, glyph('left')), 'Previous build' + (act ? ' in this filter' : ''));
    const next = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Next build', disabled: list.length < 2, onclick: () => step(1) }, glyph('right')), 'Next build' + (act ? ' in this filter' : ''));
    return h('section.panel.bd-pan.bd-compact.has-sel', { 'aria-label': 'Library' },
      h('div.bd-pan-head', h('h3', 'Library'), h('span.bd-count', list.length + (act ? ' match your filter' : ' builds'))),
      h('div.bd-crow', prev, key, next),
      h('button.bd-more', { type: 'button', onclick: () => { save((b) => { b.browse = true; }); patch(); } }, h('span', act ? 'Browse all builds (filter on)' : 'Browse all builds')));
  }

  /** Name, how you use it and tags for a file you opened: this is what makes your own builds findable in the Library. */
  function fileInfo(key) {
    const st = S(), m = st.meta[key] || {}, rec = fileRec(key.slice(5));
    if (!rec) return null;
    const upd = (fn) => { save((b) => { const x = b.meta[key] || (b.meta[key] = {}); fn(x); }); };
    const name = h('input.field', { type: 'text', value: m.name || rec.name, 'aria-label': 'Name', maxlength: 60, onchange: (e) => { upd((x) => { x.name = e.target.value.trim() || rec.name; }); UI.title.textContent = e.target.value.trim() || rec.name; } });
    const useSeg = h('div.seg.bd-useseg', { role: 'radiogroup', 'aria-label': 'How you use it' }, [['', 'Not a farm'], ['afk', 'AFK'], ['semi', 'Semi-AFK'], ['manual', 'Manual']].map(([id, t]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String((m.use || '') === id), class: (m.use || '') === id ? 'on' : null, onclick: () => { upd((x) => { x.use = id || null; }); patch(); } }, t)));
    const tags = m.tags || [];
    const chips = h('div.bd-tagrow', tags.map((t) => h('span.pill.bd-tag.bd-tag-x', tagLabel(t), h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: () => { upd((x) => { x.tags = (x.tags || []).filter((y) => y !== t); }); patch(); } }, glyph('x')))));
    const add = h('input.field', { type: 'text', placeholder: 'Add a tag, press Enter', 'aria-label': 'Add a tag', maxlength: 24,
      onkeydown: (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const t = add.value.trim().toLowerCase().replace(/[^a-z0-9 -]+/g, '').replace(/\s+/g, '-'); if (!t || tags.includes(t) || tags.length >= 8) return; upd((x) => { x.tags = (x.tags || []).concat(t); }); patch(); } });
    return h('section.panel.bd-pan.bd-info', { 'aria-label': 'About this build' },
      h('div.bd-pan-head', h('h3', 'Your build'), h('span.bd-count', rec.size.join(' × '))),
      h('p.bd-note', 'Name it and tag it so you can find it in the Library: AFK, redstone, whatever you like.'),
      h('div.bd-sub', 'Name'), name, h('div.bd-sub', 'How you use it'), useSeg, h('div.bd-sub', 'Tags'), chips, add);
  }

  function librarySide() {
    const st = S(), farms = B().farms;
    const cur = st.cur;
    if (st.browse) return [browsePanel(), plannedPanel()];
    const out = [compactPanel()];
    if (cur.startsWith('farm:')) out.push(farmInfo(farms.FARMS.find((f) => 'farm:' + f.id === cur)));
    if (cur.startsWith('file:')) { const fi = fileInfo(cur); if (fi) out.push(fi); }
    if (original(cur)) out.push(customisePanel(cur));
    out.push(plannedPanel());
    return out;
  }
  function farmInfo(f) {
    if (!f) return h('span');
    const mats = core().materials(effective('farm:' + f.id));
    const top = mats.slice(0, 6);
    return h('section.panel.bd-pan.bd-info', { 'aria-label': f.name },
      h('div.bd-pan-head', h('h3', f.name), h('span.bd-pills', useBadge(f.use), h('span.pill.bd-dim', DIM_NAME[f.dim]), h('span.pill.bd-level', f.level), h('span.pill.bd-ed', 'Java'))),
      h('p.bd-pitch', f.pitch),
      h('p.bd-how', f.how),
      f.useText ? [h('div.bd-sub', 'How you use it'), h('p.bd-use-text', f.useText)] : null,
      f.tags && f.tags.length ? h('div.bd-tagrow', f.tags.map((t) => h('span.pill.bd-tag', (t === 'no-redstone' ? 'No redstone' : t === 'redstone' ? 'Redstone' : TAG_LABEL[t] || t)))) : null,
      h('div.bd-sub', 'You need'),
      h('ul.bd-needs', top.map((m) => h('li', TH.icon(core().iconOf(m.block), { size: 18 }), h('span.bd-needs-n', fmtN(m.n)), h('span', core().nameOf(m.item)))),
        mats.length > top.length ? h('li', h('button.bd-link', { type: 'button', onclick: () => go('materials') }, '+ ' + (mats.length - top.length) + ' more in Materials')) : null),
      h('div.bd-sub', 'Build it'),
      h('ol.bd-steps', f.steps.map((t) => h('li', t))),
      h('div.bd-sub', 'Good to know'),
      h('ul.bd-tips', f.tips.map((t) => h('li', t))));
  }

  /** Customise blocks: one row per replaceable block (texture, name, count) + the locked functional ones. */
  function customisePanel(key) {
    const st = S(), orig = original(key);
    const swaps = st.swaps[key] || {};
    const rows = core().counts(orig, true);
    const free = rows.filter((r) => core().replaceable(r.id).ok), locked = rows.filter((r) => !core().replaceable(r.id).ok);
    const n = Object.keys(swaps).length;
    const pickerHost = h('div.bd-pickhost');
    const mkRow = (r) => {
      const to = swaps[r.id], cur = to || r.id;
      const btn = h('button.btn.bd-swap' + (to ? '.on' : ''), { type: 'button', 'aria-expanded': 'false', onclick: () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        UI.side.querySelectorAll('.bd-swap[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        UI.side.querySelectorAll('.bd-picker').forEach((p) => p.remove());
        if (open) return;
        btn.setAttribute('aria-expanded', 'true');
        const fam = core().def(r.id).fam;
        btn.after(blockPicker({ ids: core().familyOf(fam), current: cur, original: r.id, onPick: (id) => setSwap(key, r.id, id), label: 'Replace ' + core().nameOf(r.id) }));
      } },
      TH.icon(core().iconOf(cur), { size: 24 }),
      h('span.bd-swap-txt', h('span.bd-swap-name', core().nameOf(cur)), to ? h('span.bd-swap-was', 'was ' + core().nameOf(r.id)) : h('span.bd-swap-was', 'Click to replace')),
      h('span.bd-swap-n', fmtN(r.n)), glyph('swap', 'bd-swap-ico'));
      return btn;
    };
    const lockRow = (r) => tip(h('div.bd-lockrow', { tabindex: 0 }, TH.icon(core().iconOf(r.id), { size: 20 }), h('span.bd-swap-name', core().nameOf(r.id)), h('span.bd-swap-n', fmtN(r.n)), glyph('lock', 'bd-lock-ico')),
      () => [h('div.th-tooltip-title', core().nameOf(r.id) + ' stays'), h('div.th-tooltip-sub', core().replaceable(r.id).why)]);
    const name = keyName(key);
    const panel = h('section.panel.bd-pan.bd-custom-panel' + (n ? '.has-sel' : ''), { 'aria-label': 'Customise blocks' },
      h('div.bd-pan-head', h('h3', 'Customise blocks'), n ? h('span.bd-count', n + ' swapped') : h('span.bd-count', 'your version')),
      free.length ? h('p.bd-note', 'Swap building blocks for ones you like. The parts that make it work stay as they are.') : h('p.bd-note', 'Every block here is part of the mechanism, so nothing can be swapped.'),
      h('div.bd-swaps', free.map(mkRow)), pickerHost,
      locked.length ? h('div.bd-sub', 'Keeps working only with these') : null,
      locked.length ? h('div.bd-locks', locked.map(lockRow)) : null,
      h('div.bd-actions',
        h('button.btn.small', { type: 'button', disabled: !n, onclick: () => { save((b) => { delete b.swaps[key]; }); show(key, { keepView: true }); patch(); toast('Back to the original blocks'); } }, glyph('reset'), 'Reset to original'),
        h('button.btn.small.primary', { type: 'button', onclick: () => exportAs(effective(key), 'schem', name + (n ? '-custom' : '')) }, glyph('down'), n ? 'Download my version' : 'Download .schem'),
        h('button.btn.small', { type: 'button', onclick: () => exportAs(effective(key), 'json', name + (n ? '-custom' : '')) }, 'JSON')));
    return panel;
  }
  function setSwap(key, from, to) {
    save((b) => {
      const m = b.swaps[key] || (b.swaps[key] = {});
      if (!to || to === from) delete m[from]; else m[from] = to;
      if (!Object.keys(m).length) delete b.swaps[key];
    });
    show(key, { keepView: true });
    patch();
  }

  /** Compact block picker: search + grouped tiles with real textures. */
  function blockPicker(o) {
    const field = h('input.field.bd-pick-search', { type: 'search', placeholder: 'Search blocks', 'aria-label': 'Search blocks', autocomplete: 'off', spellcheck: false });
    const body = h('div.bd-pick-body.th-scroll');
    const G = core().GROUPS, ord = core().GROUP_ORDER;
    function fill() {
      const q = field.value.trim().toLowerCase();
      const ids = o.ids.filter((n) => !q || core().nameOf('minecraft:' + n).toLowerCase().includes(q) || n.includes(q.replace(/ /g, '_')));
      const groups = new Map();
      ids.forEach((n) => { const g = core().BLOCKS[n].grp || 'misc'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); });
      const out = [];
      [...groups.keys()].sort((a, b) => ord.indexOf(a) - ord.indexOf(b)).forEach((g) => {
        out.push(h('div.bd-pick-grp', G[g] || g));
        out.push(h('div.bd-pick-grid', groups.get(g).map((n) => {
          const id = 'minecraft:' + n, on = core().parse(o.current).name === n, orig = o.original && core().parse(o.original).name === n;
          const b = h('button.btn.bd-pick-tile' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), 'aria-label': core().nameOf(id), onclick: () => o.onPick(id) }, TH.icon(core().iconOf(id), { size: 24 }), orig ? h('span.bd-pick-orig', { 'aria-hidden': 'true' }) : null);
          return tip(b, () => [h('div.th-tooltip-title', core().nameOf(id)), orig ? h('div.th-tooltip-sub', 'The original block') : null].filter(Boolean));
        })));
      });
      body.replaceChildren(...(out.length ? out : [h('p.bd-note', 'No block matches “' + field.value + '”.')]));
    }
    field.addEventListener('input', fill);
    fill();
    const el = h('div.bd-picker', { role: 'dialog', 'aria-label': o.label || 'Pick a block' }, h('div.bd-pick-top', field), body);
    setTimeout(() => { if (el.isConnected && matchMedia('(hover: hover)').matches) field.focus({ preventScroll: true }); }, 30);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.remove(); UI.side.querySelectorAll('[aria-expanded="true"]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.focus(); }); } });
    return el;
  }

  /* ---- files you open ---- */
  async function openFile(f) {
    if (!ready) return;
    toast('Reading ' + f.name + '…');
    try {
      const s = await B().io.load(f);
      const id = TH.util.uid('f');
      mem.files.set(id, s);
      let kept = true;
      const data = core().rle(s.blocks);
      save((b) => {
        b.files = b.files || [];
        if (data.length <= FILE_CAP) {
          b.files.unshift({ id, name: s.name, size: s.size.slice(), palette: s.palette.slice(), data, added: Date.now() });
          while (b.files.length > MAX_FILES) { const old = b.files.pop(); delete b.swaps['file:' + old.id]; delete b.ticks['file:' + old.id]; }
        } else kept = false;
      });
      if (!kept) {
        // session only: show it under Your builds until the page reloads
        mem.sessionOnly = mem.sessionOnly || [];
        mem.sessionOnly.unshift({ id, name: s.name, size: s.size.slice(), session: true });
      }
      pickKey('file:' + id);
      const unknown = s.palette.filter((p, i) => i && !core().known(p)).length;
      toast('Opened ' + s.name + ' · ' + fmtN(core().volume(s)) + ' blocks' + (unknown ? ' · ' + unknown + ' unknown block type' + (unknown > 1 ? 's' : '') : '') + (kept ? '' : ' · too big to keep after a reload'));
    } catch (e) {
      toast(e && e.user ? e.message : 'This file isn’t a schematic I can read.');
      if (e && !e.user) console.error(e);
    }

  }
  function fileParts() {
    const st = S();
    const recs = (mem.sessionOnly || []).filter((r) => mem.files.has(r.id)).concat(st.files || []);
    const rows = recs.map((r) => ({ rec: r, key: 'file:' + r.id }));
    const dz = h('button.bd-dropzone', { type: 'button', onclick: () => UI.fileIn.click() },
      glyph('up', 'bd-dz-ico'), h('span.bd-dz-t', 'Open a schematic file'), h('span.bd-dz-s', '.schem, .litematic, .nbt, .schematic or .json · or drop it on the stage'));
    ['dragover', 'dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      if (ev === 'dragover') { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dz.classList.add('over'); } }
      else if (ev === 'dragleave') dz.classList.remove('over');
      else { dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); openFile(f); } }
    }));
    return { rows, dz };   // yours = shapes you kept and files you opened; they sit in the Library under the Yours type
  }
  function plannedPanel() {
    const P = B().farms.PLANNED;
    return h('section.panel.bd-pan.bd-planned', { 'aria-label': 'On the roadmap' },
      h('div.bd-pan-head', h('h3', 'On the roadmap'), h('span.bd-count', P.length + ' planned')),
      h('p.bd-note', 'Each one will be the easiest design that is still worth having.'),
      h('div.bd-plist', P.map(([dim, icon, name, pitch, link]) => h('div.bd-prow',
        h('span.bd-prow-ico', TH.icon(icon, { size: 20 })),
        h('span.bd-strip-txt', h('span.bd-prow-name', name, h('span.pill.bd-dim', DIM_NAME[dim])), h('span.bd-strip-sub', pitch),
          link ? h('a.bd-link', link.internal ? { href: link.href } : { href: link.href, target: '_blank', rel: 'noopener' }, link.label + ' →') : null)))));
  }

  /* ======================================================================
   * Create
   * ====================================================================== */
  let regenT = 0;
  function regen(live) {
    cancelAnimationFrame(regenT);
    regenT = requestAnimationFrame(() => {
      if (UI.shownKey === 'shape' || S().section === 'create') show('shape', { keepView: true, layer: 'top' });
      const sch = shapeSchem();
      const sz = UI.side.querySelector('.bd-shape-size');
      if (sz) sz.textContent = sch.size.join(' × ') + ' · ' + fmtN(core().volume(sch)) + ' blocks';
      if (!live) syncCreateHeads();
    });
  }
  function syncCreateHeads() {
    const blk = UI.side.querySelector('.bd-blocks-panel');
    if (blk) blk.replaceWith(blocksPanel());
  }
  function setParam(k, v, live) {
    const kind = S().shape.kind;
    save((b) => { const p = b.shape.p[kind] || (b.shape.p[kind] = {}); p[k] = v; });
    regen(live);
  }
  function createSide() {
    const st = S(), kind = st.shape.kind, SH = B().shapes.SHAPES;
    const tiles = Object.keys(SH).map((k) => {
      const on = k === kind;
      return tip(h('button.btn.bd-shape' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), onclick: () => {
        if (S().shape.kind === k) return;
        save((b) => { b.shape.kind = k; });
        show('shape', { animate: true, layer: 'top' }); patch();
      } }, shapeArt(k), h('span.bd-shape-name', SH[k].name)), SH[k].name);
    });
    const shapes = h('section.panel.bd-pan.has-sel', { 'aria-label': 'Shape' }, h('div.bd-pan-head', h('h3', 'Shape'), h('span.bd-count', '9 generators')), h('div.bd-shapes', tiles));
    return [shapes, paramsPanel(), blocksPanel(), createActions()];
  }
  function paramsPanel() {
    const kind = S().shape.kind, sh = B().shapes.SHAPES[kind], p = shapeParams(kind);
    const rows = [];
    const numRow = (id, label, lo, hi) => {
      const val = clamp(Math.round(+p[id] || lo), lo, hi);
      const sl = h('input.slider.bd-num-slider', { type: 'range', min: lo, max: hi, step: 1, value: val, 'aria-label': label });
      const inp = h('input.stepper-input', { type: 'number', min: lo, max: hi, value: val, 'aria-label': label });
      const fillV = () => sl.style.setProperty('--fill', ((+sl.value - lo) / Math.max(1, hi - lo) * 100).toFixed(1) + '%');
      const set = (v, live) => { v = clamp(Math.round(+v || lo), lo, hi); sl.value = v; inp.value = v; fillV(); setParam(id, v, live); };
      sl.addEventListener('input', () => set(sl.value, true));
      inp.addEventListener('change', () => set(inp.value));
      fillV();
      const step = h('div.stepper.bd-stepper',
        h('button.step', { type: 'button', 'aria-label': 'Decrease ' + label, onclick: () => set(+inp.value - 1) }, '−'), inp,
        h('button.step', { type: 'button', 'aria-label': 'Increase ' + label, onclick: () => set(+inp.value + 1) }, '+'));
      return h('div.bd-prow2', { 'data-param': id }, h('span.bd-plabel', label), sl, step);
    };
    const switchRow = (id, label, hint) => {
      const cb = h('input', { type: 'checkbox', checked: !!p[id], onchange: () => { setParam(id, cb.checked); syncDisabled(); } });
      const row = h('label.bd-prow2.bd-switchrow', { 'data-param': id }, h('span.bd-plabel', label), h('span.bd-switch-hint', hint || ''), h('span.switch', cb, h('span')));
      return row;
    };
    const segRow = (id, label, opts, live) => {
      const btns = opts.map(([v, t, tt]) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(p[id] === v), class: p[id] === v ? 'on' : null, onclick: () => {
          btns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
          if (id === 'preset') save((bb) => { delete bb.shape.block.tree; delete bb.shape.block2.tree; });
          setParam(id, v);
        } }, t);
        if (tt) tip(b, tt);
        return b;
      });
      return h('div.bd-prow2.bd-segrow', { 'data-param': id }, h('span.bd-plabel', label), h('div.seg.bd-pseg', { role: 'radiogroup', 'aria-label': label + ' (' + kind + ')' }, btns));
    };
    sh.params.forEach(([id, label, lo, hi]) => {
      if (id === 'centre') rows.push(segRow('centre', 'Centre', [['block', 'On a block', 'Odd width: the middle is one block'], ['edge', 'Between', 'Even width: the middle falls between blocks']]));
      else if (id === 'hollow') rows.push(switchRow('hollow', 'Hollow', 'only the shell'));
      else if (id === 'ring') rows.push(switchRow('ring', 'Ring', 'only the edge'));
      else if (id === 'floor') rows.push(switchRow('floor', 'Floor', 'second block'));
      else if (id === 'caps') rows.push(switchRow('caps', kind === 'cone' ? 'Base' : 'Caps', kind === 'cone' ? 'closed bottom' : 'top and bottom'));
      else if (id === 'axis') rows.push(segRow('axis', 'Axis', [['y', 'Lying', 'Flat on the ground'], ['x', 'East–west', 'Standing, open to the east and west'], ['z', 'North–south', 'Standing, open to the north and south']]));
      else if (id === 'preset') rows.push(segRow('preset', 'Kind', Object.entries(B().shapes.TREE_PRESETS).map(([k, v]) => [k, v.name])));
      else if (id === 'seed') {
        const lbl = h('span.bd-seed', '#' + (p.seed || 1));
        rows.push(h('div.bd-prow2', { 'data-param': 'seed' }, h('span.bd-plabel', 'Seed'), lbl,
          h('button.btn.small', { type: 'button', onclick: () => { const v = 1 + Math.floor(Math.random() * 99999); lbl.textContent = '#' + v; setParam('seed', v); } }, glyph('dice'), 'New seed')));
      } else rows.push(numRow(id, label, lo, hi));
    });
    const size = h('span.bd-count.bd-shape-size');
    const s = shapeSchem();
    size.textContent = s.size.join(' × ') + ' · ' + fmtN(core().volume(s)) + ' blocks';
    const panel = h('section.panel.bd-pan.bd-params', { 'aria-label': sh.name + ' settings' }, h('div.bd-pan-head', h('h3', sh.name), size), h('div.bd-prows', rows));
    function syncDisabled() {
      const pp = shapeParams(kind);
      panel.querySelectorAll('[data-param="thick"]').forEach((r) => r.classList.toggle('off', !(pp.hollow || pp.ring)));
      const blk = UI.side.querySelector('.bd-blocks-panel');
      if (blk) blk.replaceWith(blocksPanel());
    }
    setTimeout(syncDisabled, 0);
    return panel;
  }
  function blocksPanel() {
    const kind = S().shape.kind, p = shapeParams(kind);
    const second = kind === 'tree' || (kind === 'dome' && p.floor) || (kind === 'cylinder' && p.hollow && p.caps);
    const lbl2 = kind === 'tree' ? 'Leaves' : kind === 'dome' ? 'Floor' : 'Caps';
    const all = core().buildingBlocks();
    const row = (which, label) => {
      const cur = which === 2 ? p.block2 : p.block;
      const btn = h('button.btn.bd-swap', { type: 'button', 'aria-expanded': 'false', onclick: () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        UI.side.querySelectorAll('.bd-picker').forEach((x) => x.remove());
        UI.side.querySelectorAll('.bd-swap[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        if (open) return;
        btn.setAttribute('aria-expanded', 'true');
        const ids = kind === 'tree' ? all.filter((n) => core().BLOCKS[n].fam === (which === 2 ? 'leaves' : 'log') || (which === 2 && core().BLOCKS[n].fam !== 'log')) : all;
        btn.after(blockPicker({ ids, current: cur, label: 'Pick the ' + label.toLowerCase(), onPick: (id) => {
          save((b) => { (which === 2 ? b.shape.block2 : b.shape.block)[kind] = id; });
          regen(); syncCreateHeads();
        } }));
      } }, TH.icon(core().iconOf(cur), { size: 24 }), h('span.bd-swap-txt', h('span.bd-swap-name', core().nameOf(cur)), h('span.bd-swap-was', label)), glyph('swap', 'bd-swap-ico'));
      return btn;
    };
    return h('section.panel.bd-pan.bd-blocks-panel', { 'aria-label': 'Blocks' },
      h('div.bd-pan-head', h('h3', 'Blocks')),
      h('div.bd-swaps', row(1, kind === 'tree' ? 'Logs' : 'Main block'), second ? row(2, lbl2) : null));
  }
  function createActions() {
    return h('section.panel.bd-pan.bd-create-acts', { 'aria-label': 'Use this shape' },
      h('div.bd-actions',
        h('button.btn.small', { type: 'button', onclick: () => { if (V) { if (S().mode === 'still') setMode('once'); V.replay(); } } }, glyph('replay'), 'Build it'),
        h('button.btn.small.primary', { type: 'button', onclick: () => exportAs(shapeSchem(), 'schem') }, glyph('down'), 'Download .schem'),
        h('button.btn.small', { type: 'button', onclick: () => exportAs(shapeSchem(), 'json') }, 'JSON'),
        tip(h('button.btn.small', { type: 'button', onclick: keepShape }, glyph('file'), 'Keep in Library'), 'Add this shape to your builds in the Library, so you can customise it and find it again')));
  }
  function keepShape() {
    const s = core().clone(shapeSchem());
    const id = TH.util.uid('f'), data = core().rle(s.blocks);
    mem.files.set(id, s);
    save((b) => {
      b.files = b.files || [];
      if (data.length <= FILE_CAP) {
        b.files.unshift({ id, name: s.name, size: s.size.slice(), palette: s.palette.slice(), data, added: Date.now() });
        while (b.files.length > MAX_FILES) { const old = b.files.pop(); delete b.swaps['file:' + old.id]; delete b.ticks['file:' + old.id]; }
      }
    });
    if (data.length > FILE_CAP) { mem.sessionOnly = mem.sessionOnly || []; mem.sessionOnly.unshift({ id, name: s.name, size: s.size.slice(), session: true }); }
    pickKey('file:' + id);
    toast('Kept ' + s.name + ' in your builds');
  }

  /* ======================================================================
   * Materials
   * ====================================================================== */
  const SHULKER = 27;
  function amount(n, stack, units) {
    if (units === 'items' || stack === 1) return { main: fmtN(n), sub: stack === 1 && units !== 'items' ? 'unstackable' : '' };
    const st = Math.floor(n / stack), rest = n % stack;
    if (units === 'stacks') return { main: st ? st + (rest ? ' st + ' + rest : ' st') : String(rest), sub: fmtN(n) + ' items' };
    const per = stack * SHULKER, bx = Math.floor(n / per), r2 = n % per, st2 = Math.floor(r2 / stack), r3 = r2 % stack;
    const parts = []; if (bx) parts.push(bx + ' box' + (bx > 1 ? 'es' : '')); if (st2) parts.push(st2 + ' st'); if (r3) parts.push(String(r3));
    return { main: parts.join(' + ') || '0', sub: (n / per).toFixed(2) + ' boxes · ' + fmtN(n) + ' items' };
  }
  /** Parse a Litematica material list (the text table or CSV export) into [{ name, n }]. */
  function parsePaste(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      let cells;
      if (line.includes('|')) cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
      else if (line.includes(',')) cells = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      else if (line.includes('\t')) cells = line.split('\t').map((c) => c.trim());
      else { const m = line.match(/^\s*(.+?)\s*[:x×]?\s+(\d[\d\s,.]*)\s*$/); cells = m ? [m[1], m[2]] : null; }
      if (!cells || cells.length < 2) return;
      const name = cells[0], n = parseInt(String(cells[1]).replace(/[\s,.]/g, ''), 10);
      if (!name || !(n > 0) || /^item$|^total$|^name$/i.test(name) || /^[-=+]+$/.test(name)) return;
      out.push({ name, n });
    });
    const m = new Map();
    out.forEach((e) => m.set(e.name, (m.get(e.name) || 0) + e.n));
    return [...m].map(([name, n]) => ({ name, n }));
  }
  let byNameCache = null;
  function idByName(name) {
    if (!byNameCache) { byNameCache = new Map(); Object.keys(core().BLOCKS).forEach((n) => { byNameCache.set(core().nameOf('minecraft:' + n).toLowerCase(), 'minecraft:' + n); byNameCache.set(n.replace(/_/g, ' '), 'minecraft:' + n); }); }
    const k = name.toLowerCase().trim();
    return byNameCache.get(k) || byNameCache.get(k.replace(/^minecraft:/, '').replace(/_/g, ' ')) || null;
  }
  function materialsSide() {
    const st = S();
    const usePaste = st.matSrc === 'paste';
    if (usePaste && !st.paste) st.paste = { text: '' };
    const key = usePaste ? 'paste' : (UI.shownKey || st.stage || st.cur);
    let rows;
    if (usePaste) rows = parsePaste(st.paste.text).map((e) => { const id = idByName(e.name); return { item: id || 'text:' + e.name, block: id, n: e.n, stack: id ? core().stackOf(id) : 64, label: id ? core().nameOf(id) : e.name }; });
    else { const s = effective(key); rows = s ? core().materials(s).map((m) => Object.assign(m, { label: core().nameOf(m.item) })) : []; }
    if (st.sort === 'name') rows.sort((a, b) => a.label.localeCompare(b.label));
    const ticks = st.ticks[key] || {};
    const total = rows.reduce((a, r) => a + r.n, 0), done = rows.filter((r) => ticks[r.item]).length;
    const prog = h('div.bd-prog', { role: 'img', 'aria-label': done + ' of ' + rows.length + ' gathered' }, h('span', { style: { width: (rows.length ? done / rows.length * 100 : 0) + '%' } }));
    const progTxt = h('span.bd-count', done + ' of ' + rows.length + ' gathered');
    const units = [['items', 'Items'], ['stacks', 'Stacks'], ['boxes', 'Shulker boxes']];
    const unitSeg = h('div.seg.bd-units', { role: 'radiogroup', 'aria-label': 'Amounts as' }, units.map(([id, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.units === id), class: st.units === id ? 'on' : null, onclick: () => { save((b) => { b.units = id; }); patch(); } }, t)));
    const sortSeg = h('div.seg.bd-sort', { role: 'radiogroup', 'aria-label': 'Sort materials' }, [['count', 'Most first'], ['name', 'A–Z']].map(([id, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.sort === id), class: st.sort === id ? 'on' : null, onclick: () => { save((b) => { b.sort = id; }); patch(); } }, t)));
    const list = h('div.bd-mats', { role: 'list' }, rows.map((r) => {
      const a = amount(r.n, r.stack, st.units), on = !!ticks[r.item];
      const cb = h('input', { type: 'checkbox', checked: on, 'aria-label': 'Gathered ' + r.label, onchange: () => {
        save((b) => { const t = b.ticks[key] || (b.ticks[key] = {}); if (cb.checked) t[r.item] = 1; else delete t[r.item]; if (!Object.keys(t).length) delete b.ticks[key]; });
        row.classList.toggle('done', cb.checked);
        const T = S().ticks[key] || {}, d = rows.filter((x) => T[x.item]).length;
        progTxt.textContent = d + ' of ' + rows.length + ' gathered';
        prog.firstChild.style.width = (rows.length ? d / rows.length * 100 : 0) + '%';
        prog.setAttribute('aria-label', d + ' of ' + rows.length + ' gathered');
      } });
      const row = h('label.bd-mat' + (on ? '.done' : ''), { role: 'listitem' },
        h('span.check', cb, h('span')),
        h('span.bd-mat-ico', r.block ? TH.icon(core().iconOf(r.block), { size: 24 }) : h('span.bd-mat-noico')),
        h('span.bd-mat-name', r.label),
        h('span.bd-mat-amt', h('b', a.main), a.sub ? h('small', a.sub) : null));
      return row;
    }));
    const copy = h('button.btn.small', { type: 'button', onclick: () => {
      const text = keyName(key) + ' — materials\n' + rows.map((r) => { const a = amount(r.n, r.stack, st.units); return (ticks[r.item] ? '[x] ' : '[ ] ') + r.label + ': ' + a.main; }).join('\n');
      const ok = () => toast('Materials list copied');
      const fb = () => { const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } }); document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { toast('Could not copy'); } ta.remove(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
    } }, glyph('copy'), 'Copy as text');
    const clear = h('button.btn.small.ghost', { type: 'button', disabled: !done, onclick: () => { save((b) => { delete b.ticks[key]; }); patch(); } }, 'Clear ticks');
    const swaps = key !== 'paste' && key !== 'shape' ? Object.keys(st.swaps[key] || {}).length : 0;
    const srcSeg = h('div.seg.bd-src', { role: 'radiogroup', 'aria-label': 'Materials source' },
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(!usePaste), class: !usePaste ? 'on' : null, onclick: () => { save((b) => { b.matSrc = 'stage'; }); patch(); } }, 'From the stage'),
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(!!usePaste), class: usePaste ? 'on' : null, onclick: () => { save((b) => { b.matSrc = 'paste'; if (!b.paste) b.paste = { text: '' }; }); patch(); } }, 'Pasted list'));
    const linked = h('div.bd-linked', usePaste ? h('span', 'Pasted Litematica list') : [h('span.bd-linked-lbl', 'Linked to'), h('b', keyName(key)), swaps ? h('span.pill.bd-custom', swaps + ' swapped') : null]);
    const main = h('section.panel.bd-pan.bd-mat-panel.has-sel', { 'aria-label': 'Materials' },
      h('div.bd-pan-head', h('h3', 'Materials'), h('span.bd-count', fmtN(total) + ' items · ' + rows.length + ' kinds')),
      srcSeg, linked,
      h('div.bd-mat-tools', unitSeg, sortSeg),
      h('div.bd-mat-progress', prog, progTxt),
      rows.length ? list : h('p.bd-note', usePaste ? 'Paste a list below.' : 'Nothing on the stage yet.'),
      h('div.bd-actions', copy, clear, swaps ? h('button.btn.small.ghost', { type: 'button', onclick: () => go('library') }, glyph('swap'), 'Edit swaps') : null));
    const out = [main];
    if (usePaste) {
      const ta = h('textarea.field.bd-paste', { rows: 7, placeholder: 'Paste the material list from Litematica (the text table or CSV), or lines like "Stone Bricks 64".', 'aria-label': 'Litematica material list', value: st.paste.text || '' });
      let tm = 0;
      ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { save((b) => { b.paste = { text: ta.value, at: Date.now() }; }); const keep = ta.selectionStart; patch(); const t2 = UI.side.querySelector('.bd-paste'); if (t2) { t2.focus(); try { t2.setSelectionRange(keep, keep); } catch (e) { /* ignore */ } } }, 450); });
      out.push(h('section.panel.bd-pan', { 'aria-label': 'Paste a material list' }, h('div.bd-pan-head', h('h3', 'Paste a list')),
        h('p.bd-note', 'In Litematica open the Material List, use "Write to file" or copy the table, and paste it here. Names the tool knows get their textures.'), ta));
    }
    return out;
  }

  /* ======================================================================
   * Module
   * ====================================================================== */
  function render(root) {
    if (!ready) {
      root.append(h('div.page-head', h('h2', 'Builds')), h('div.panel.bd-boot', loadErr ? 'The Builds tool could not load. Check the connection and reload.' : 'Loading the build tools…'));
      loadAll().then(() => { if (location.hash === '#/builds' && TH.app && TH.app.render) TH.app.render(); }).catch(() => { if (location.hash === '#/builds') TH.app.render(); });
      return;
    }
    if (!UI) mount();
    root.append(UI.wrap);
    patch();
    if (!V || !V.ready) ensureViewer();
    else { V.wake(); }
  }

  TH.app.register({
    id: 'builds',
    name: 'Builds',
    icon: 'mc:block/crafting_table_front',
    init(store) {
      store.define('builds', DEFAULTS);
      const b = store.get().builds;
      ['swaps', 'ticks', 'shape'].forEach((k) => { if (!b[k] || typeof b[k] !== 'object') b[k] = structuredClone(DEFAULTS[k]); });
      ['p', 'block', 'block2'].forEach((k) => { if (!b.shape[k] || typeof b.shape[k] !== 'object') b.shape[k] = {}; });
      if (!Array.isArray(b.files)) b.files = [];
      if (!['library', 'create', 'materials'].includes(b.section)) b.section = 'library';
      if (typeof b.cur !== 'string' || !/^(farm|file):/.test(b.cur)) b.cur = 'farm:cow_crusher';
      if (b.cur.startsWith('file:') && !b.files.some((f) => 'file:' + f.id === b.cur)) b.cur = 'farm:cow_crusher';
      if (typeof b.stage !== 'string' || (b.stage.startsWith('file:') && !b.files.some((f) => 'file:' + f.id === b.stage))) b.stage = b.cur;
      if (!['loop', 'once', 'still'].includes(b.mode)) b.mode = 'once';
      if (!(b.v >= 2)) { if (b.mode === 'loop') b.mode = 'once'; }   // looping used to be the default; now it is opt-in
      if (!(b.v >= 3)) { b.browse = true; b.v = 3; }   // the Library opens as a browser first
      if (!b.meta || typeof b.meta !== 'object') b.meta = {};
      if (!b.lib || typeof b.lib !== 'object') b.lib = structuredClone(DEFAULTS.lib);
    },
    render,
  });
})();
