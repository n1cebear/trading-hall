/**
 * Builds (orange accent): one tab, two sections around one 3D stage.
 *   Library   = our farms + schematic files you open (.schem, .litematic, .nbt, .schematic, .json); farm info,
 *               build steps, tips, and "Customise blocks" (swap decorative blocks, functional ones stay).
 *   Create    = Generate: 30 generators in four groups (crystals, monoliths, nature, shapes; builds-gen.js) plus the nine
 *               classic shapes, settings in tabs, angle on X / Y / Z, light shading (builds-create.js);
 *               Make it myself: the quick editor on the stage (builds-editor.js, model builds-edit.js).
 *   Library builds get a non-destructive angle and light too (state.xf, applied in effective()).
 * The material list is its own tool, Materials (js/modules/materials.js + builds-mats.js): its "Material list" keys
 * here set state.builds.matSrc and go to #/materials; TH.builds.api (end of this file) is its window onto Builds.
 *
 * Files: builds-core.js (data model + block table, loaded with the page), then on first visit builds-io.js (loader /
 * exporter), builds-shapes.js, builds-farms.js, builds-view.js (mesher + three.js viewer, which imports
 * js/vendor/three.lite.module.min.js itself), builds-mats.js (Materials) and ../data/recipes.js.
 *
 * state.builds = {
 *   v, section: 'library'|'create', cur: 'farm:<id>'|'file:<id>', stage: key shown on the stage,
 *   mode: 'loop'|'once'|'still', speed, grid, outline, auto,
 *   shape: { kind, p: { [kind]: params }, block: { [kind]: id }, block2: { [kind]: id } },
 *   swaps: { [key]: { 'minecraft:stone_bricks': 'minecraft:deepslate_bricks' } },
 *   fopt: { [farmId]: { size: '24', tail: 'off' } }   (options of built-in builds that have some, e.g. the mob heads)
 *   ticks: { [key]: { [itemId]: 1 } }, have: { [key]: { [itemId]: n } }, units: 'items'|'stacks'|'boxes'|'dc',
 *   sort: 'count'|'name'|'group', matSrc: 'stage'|<key>, lists: [{ id, name, text, at }],
 *   mats: { raw, cont: 'box'|'dc', pack: 'tight'|'sorted', hide, sc, pick: { [itemId]: recipe index } },
 *   files: [{ id, name, size, palette, data (run-length text), added, declared, xz }]   (only files small enough; see FILE_CAP)
 *          xz = the file's block entities, entities, ticks and metadata (core().extrasOf), gzip + base64; see XZ_CAP
 *   paste: null (before v4 the one pasted list; migrated into lists)
 * }
 * Keys: 'farm:<id>', 'file:<id>', 'shape', 'list:<id>' (+ '#raw' for the raw-material ticks). Every change is saved silently and the page is patched in place.
 */
(function () {
  'use strict';
  const { h, toast, clamp } = TH.util;
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const rel = (p) => new URL(p, SRC).href;
  const LAZY = ['builds-io.js', 'builds-shapes.js', 'builds-farms.js', 'builds-view.js', '../data/recipes.js', 'builds-mats.js',
    '../data/block-colours.js', 'builds-detail.js', 'builds-rotate.js', 'builds-shade.js', 'builds-inside.js', 'builds-resize.js', 'builds-gen.js', 'builds-edit.js', 'builds-create.js', 'builds-editor.js'];
  const FILE_CAP = 400000;    // characters of run-length data we keep in the saved state per file
  const MAX_FILES = 4;
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const B = () => TH.builds;
  const core = () => TH.builds.core;

  const DEFAULTS = {
    v: 4, browse: true, meta: {}, section: 'library', cur: 'farm:cow_crusher', stage: 'farm:cow_crusher',
    lib: { q: '', type: 'all', use: 'all', tech: 'all', topic: 'all', sort: 'name', more: false },
    mode: 'once', speed: 1, grid: true, outline: false, auto: true,
    shape: { kind: 'crystal', p: {}, block: {}, block2: {}, group: 'crystals', tab: 'shape', lock: false },
    make: {}, xf: {}, createMode: 'gen',
    swaps: {}, fopt: {}, ticks: {}, have: {}, units: 'items', sort: 'count', files: [], paste: null, matSrc: 'stage', lists: [], viewHelp: false,
    mats: { raw: false, cont: 'box', pack: 'tight', hide: false, sc: true, pick: {}, inside: false },
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
    if (!loadP) loadP = LAZY.reduce((p, f) => p.then(() => loadScript(rel(f))), Promise.resolve()).then(restoreExtras).then(() => { ready = true; }, (e) => { loadErr = e; loadP = null; throw e; });
    return loadP;
  }

  /*
   * What a kept file carries besides blocks (container contents, sign text, entities, metadata: core().extrasOf) is
   * saved with it as gzip + base64 text (`rec.xz`; JSON of typed NBT packs about 10:1), and unpacked once when the
   * build tools load, before anything reads a file.
   */
  const XZ_CAP = 1500000;   // characters of packed extras we keep per file
  async function packX(x) {
    const z = await TH.builds.io.gzip(new TextEncoder().encode(JSON.stringify(x)));
    let s = '';
    for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode.apply(null, z.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function unpackX(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(await TH.builds.io.gunzip(u)));
  }
  async function restoreExtras() {
    const recs = (TH.store.get().builds.files || []).filter((r) => r.xz && !mem.extras.has(r.id));
    for (const r of recs) {
      try { mem.extras.set(r.id, await unpackX(r.xz)); } catch (e) { console.warn('Builds: could not unpack the contents of ' + r.name, e); }
    }
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
    glass: ['#######', '#....##', '#...#.#', '#..#..#', '#.#...#', '##....#', '#######'],
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
    mirror: ['...#...', '#.....#', '##.#.##', '###.###', '##.#.##', '#.....#', '...#...'],
    centre: ['...#...', '.#####.', '.#...#.', '##.#.##', '.#...#.', '.#####.', '...#...'],
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
    const rows = SHAPE_ART[kind] || (B().createUI && B().createUI.GEN_ART[kind]) || SHAPE_ART.sphere;
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
  const mem = { files: new Map(), extras: new Map(), shape: null, shapeSig: '', paste: null };
  function fileRec(id) { return (S().files || []).find((f) => f.id === id); }
  function original(key) {
    if (!key) return null;
    if (key.startsWith('farm:')) return B().farms.schematic(key.slice(5), (S().fopt || {})[key.slice(5)]);
    if (key.startsWith('file:')) {
      const id = key.slice(5);
      if (mem.files.has(id)) return mem.files.get(id);
      const r = fileRec(id);
      if (!r) return null;
      try {
        const s = core().create(r.size[0], r.size[1], r.size[2], r.name);
        s.palette = r.palette.slice(); s.blocks = core().unrle(r.data, r.size[0] * r.size[1] * r.size[2]);
        if (r.declared) s.declared = r.declared;
        if (mem.extras.has(id)) core().setExtras(s, mem.extras.get(id));
        else if (r.xz) Object.defineProperty(s, 'xzLost', { value: true });   // saved contents that could not be unpacked: the note says so
        mem.files.set(id, s);
        return s;
      } catch (e) { return null; }
    }
    if (key === 'shape') { try { return B().createUI.schem(ctx()); } catch (e) { if (e.user) toast(e.message); else console.error(e); return mem.lastShape || null; } }
    if (key === 'edit') return B().editorUI ? B().editorUI.out() : null;
    return null;
  }
  /** The schematic as shown: the original with the user's block swaps, then its angle and light (Library). fast: a quick preview while a slider moves. */
  function effective(key, fast) {
    const s = original(key);
    if (key === 'shape' && s) mem.lastShape = s;
    if (!s || key === 'shape' || key === 'edit') return s;
    const sw = S().swaps[key];
    const out = sw && Object.keys(sw).length ? core().applySwaps(s, sw) : s;
    return B().createUI ? B().createUI.applyXf(ctx(), key, out, fast) : out;
  }
  function keyName(key) {
    if (!key) return '';
    if (key.startsWith('farm:')) { const f = B().farms.FARMS.find((x) => x.id === key.slice(5)); return f ? f.name + optSuffix(f) : 'Farm'; }
    if (key.startsWith('file:')) { const r = fileRec(key.slice(5)); const m = mem.files.get(key.slice(5)); const meta = S().meta && S().meta[key]; return (meta && meta.name) || (m && m.name) || (r && r.name) || 'File'; }
    if (key === 'shape') { const s = original('shape'); return s ? s.name : 'Shape'; }
    if (key === 'edit') return (S().make && S().make.name) || 'My build';
    if (key === 'paste') return 'Pasted material list';
    return '';
  }
  /** The chosen options of a built-in build that has some (size, tail ...), defaults filled in. */
  const farmOpts = (f) => B().farms.options(f.id, (S().fopt || {})[f.id]);
  /** ' · 24' style suffix for names and file names: the size, and every other option not at its default ('7 tentacles'). */
  function optSuffix(f) {
    if (!f.opts || !f.opts.length) return '';
    const o = farmOpts(f);
    return f.opts.map((op) => { const c = op.choices.find((x) => x[0] === o[op.id]); return op.id === 'size' ? c[1] : o[op.id] !== op.def ? (op.unit ? c[1] + ' ' + op.unit : c[1].toLowerCase()) : null; }).filter(Boolean).map((t) => ' · ' + t).join('');
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
  /** A classic shape (builds-shapes.js) without its angle; the Create stage turns it (builds-create.js schem). */
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
    const ext = fmt === 'json' ? '.json' : fmt === 'litematic' ? '.litematic' : '.schem';
    try {
      if (fmt === 'json') downloadBlob(name + ext, B().io.toJSON(s), 'application/json');
      else if (fmt === 'litematic') downloadBlob(name + ext, await B().io.toLitematic(s), 'application/octet-stream');
      else downloadBlob(name + ext, await B().io.toSchem(s), 'application/octet-stream');
      toast('Downloaded ' + name + ext + keptText(s, fmt));
    } catch (e) { toast(e.message || 'Could not write that file'); }
  }
  /** ' · with what is in 6 containers, 5 signs, 4 entities · facing and position as imported' (+ warnings), for the toast. */
  function keptText(s, fmt) {
    if (!s || !core().hasExtras(s)) return s && s.src ? ' · facing and position as imported' : '';
    const m = core().extrasSummary(s), bits = [];
    if (m.filled) bits.push('what is in ' + m.filled + (m.filled === 1 ? ' container' : ' containers'));
    const signs = (s.be || []).filter((b) => /sign$/.test(b.id)).length;
    if (signs) bits.push(signs + (signs === 1 ? ' sign' : ' signs'));
    const other = m.be - m.containers - signs;
    if (other > 0) bits.push(other + ' other ' + (other === 1 ? 'block' : 'blocks') + ' with data');
    if (m.entities) bits.push(m.entities + (m.entities === 1 ? ' entity' : ' entities'));
    let t = bits.length ? ' · with ' + bits.join(', ') : '';
    t += ' · facing and position as imported';
    if (m.lost) t += ' · ' + m.lost + (m.lost === 1 ? ' block lost its contents' : ' blocks lost their contents') + ' in a swap';
    if (fmt === 'schem' && m.ticks) t += ' · .schem has no scheduled ticks (' + m.ticks + ' left out)';
    return t;
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
    const secs = [['library', 'Library'], ['create', 'Create']];   // the material list is its own tool now (materials.js)
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
    const resetV = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Reset the view', onclick: () => V && V.reset() }, glyph('reset')), 'Reset the view (R, or double-click empty space)');
    tip(zoomOut, 'Zoom out'); tip(zoomIn, 'Zoom in');
    const hint = h('div.bd-hint', { 'aria-hidden': 'true', hidden: !!S().viewHelp }, 'Drag to turn · right-drag to move · scroll to zoom · W A S D to fly');
    // standard views + the controls card (a '?' key: tooltip on hover, a small card on click / touch)
    const viewKey = (v, label, t) => tip(h('button.btn.small.bd-vk.bd-viewkey', { type: 'button', onclick: () => { if (V) { V.view(v); seen(); } } }, label), t);
    const helpCard = h('div.bd-help', { id: 'bd-help', role: 'note', hidden: true },
      h('div.bd-help-title', 'Moving around'),
      ...[['Drag', 'turn around the centre'], ['Right-drag or Shift+drag', 'move'], ['Scroll', 'zoom to the pointer'], ['W A S D, arrows', 'fly'], ['Space or E · Shift or Q', 'up · down'],
        ['Double-click a block', 'turn around that block'], ['Two fingers', 'pinch to zoom, drag to move'], ['T · F · G · R', 'top · front · side · reset']]
        .map(([k, v]) => h('div.bd-help-row', h('span.bd-help-k', k), h('span.bd-help-v', v))));
    const helpKey = h('button.btn.small.bd-vk.sq.bd-helpkey', { type: 'button', 'aria-label': 'How to move around', 'aria-expanded': 'false', 'aria-controls': 'bd-help', onclick: () => {
      const open = helpCard.hidden;
      helpCard.hidden = !open; helpKey.setAttribute('aria-expanded', String(open)); seen();
    } }, '?');
    tip(helpKey, () => (helpCard.hidden ? [h('div.th-tooltip-title', 'Moving around'), h('div.th-tooltip-sub', 'Drag to turn · right-drag to move · scroll to zoom'), h('div.th-tooltip-sub', 'W A S D to fly · Space / Shift up and down'), h('div.th-tooltip-sub', 'Double-click a block to turn around it')] : 'Hide the controls'));
    const views = h('div.bd-views', { role: 'group', 'aria-label': 'Views' },
      viewKey('top', 'Top', 'Straight down from above (T)'), viewKey('front', 'Front', 'From the south (F)'), viewKey('side', 'Side', 'From the east (G)'), helpKey);
    /** The first time someone moves the camera, the hint line goes (the '?' key keeps the controls). */
    function seen() { if (!S().viewHelp) { save((b) => { b.viewHelp = true; }); hint.hidden = true; } }
    const drop = h('div.bd-drop', { 'aria-hidden': 'true' }, h('span', 'Drop a schematic file'), h('small', '.schem · .litematic · .nbt · .schematic · .json'));
    const loading = h('div.bd-loading', 'Loading the 3D view…');
    const runBtn = h('button.btn.small.bd-run', { type: 'button', 'aria-pressed': 'false', hidden: true, onclick: () => { if (!V || !V.hasRun()) return; V.setRun(!V.run); syncRun(); } }, glyph('run'), h('span', 'Run the machine'));
    tip(runBtn, 'Play the machine: the plants grow, the observer fires and the pistons move');
    const phaseCap = h('div.bd-phase', { 'aria-live': 'polite', hidden: true });
    stage.append(h('div.bd-label', title, meta), h('div.bd-runbox', runBtn, phaseCap), h('div.bd-frametools', { role: 'group', 'aria-label': 'View' }, zoomOut, zoomIn, resetV), views, helpCard, hint, drop, loading);
    // the first real move of the camera (drag, wheel, keys) also counts as having seen the hint
    ['pointerdown', 'wheel', 'keydown'].forEach((ev) => stage.addEventListener(ev, (e) => {
      if (!e.target.closest || !e.target.closest('.bd-canvas')) return;
      seen();
      if (ev === 'pointerdown' && !helpCard.hidden) { helpCard.hidden = true; helpKey.setAttribute('aria-expanded', 'false'); }
    }, { passive: true }));
    helpCard.addEventListener('keydown', (e) => { if (e.key === 'Escape') { helpCard.hidden = true; helpKey.setAttribute('aria-expanded', 'false'); helpKey.focus(); } });

    // ---- animation bar ----
    const playBtn = h('button.btn.small.bd-vk.bd-play', { type: 'button', 'aria-label': 'Pause', onclick: () => { if (!V) return; if (V.playing && V.mode !== 'still') V.pause(); else { if (S().mode === 'still') setMode('loop'); V.play(); } } }, glyph('pause'));
    const replayBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Build it again', onclick: () => { if (!V) return; if (S().mode === 'still') setMode('once'); V.replay(); } }, glyph('replay')), 'Build it again from the first block');
    const modes = [['loop', 'Loop', 'Build it, hold, take it apart and start again, forever'], ['once', 'Build', 'Build it once, block by block, and leave it standing'], ['still', 'Still', 'No animation: the finished build right away']];
    const modeBtns = modes.map(([id, label, t]) => tip(h('button', { type: 'button', role: 'radio', 'data-mode': id, 'aria-checked': 'false', onclick: () => setMode(id) }, label), t));
    const modeSeg = h('div.seg.bd-modes', { role: 'radiogroup', 'aria-label': 'Animation' }, modeBtns);
    const speeds = [[0.5, '0.5×', 'Half speed'], [1, '1×', 'Normal speed'], [2, '2×', 'Double speed'], [4, '4×', 'Four times as fast']];
    const speedBtns = speeds.map(([v, label, al]) => h('button', { type: 'button', role: 'radio', 'data-speed': v, 'aria-checked': 'false', 'aria-label': al, onclick: () => { save((b) => { b.speed = v; }); if (V) V.setSpeed(v); syncBar(); } }, label));
    const speedSeg = tip(h('div.seg.bd-speeds', { role: 'radiogroup', 'aria-label': 'Speed' }, speedBtns), 'Animation speed');
    const layer = h('input.slider.bd-layer', { type: 'range', min: 1, max: 1, value: 1, step: 1, 'aria-label': 'Show layers up to' });
    const layerLbl = h('span.bd-layer-lbl');
    layer.addEventListener('input', () => { if (V) V.setLayer(+layer.value - 1); syncLayer(); });
    tip(layer, 'Hide the upper layers to look inside. Drag down to see the build from the bottom up.');
    const sliceBtn = tip(h('button.btn.small.bd-vk', { type: 'button', 'aria-pressed': 'false', onclick: () => { if (!V) return; V.setSlice(!V.slice); syncLayer(); } }, glyph('slice'), h('span.bd-vlabel', 'Only this layer')), 'Show only the chosen layer, from above, with its outline');
    const gridBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Blueprint grid', onclick: () => { save((b) => { b.grid = !b.grid; }); if (V) V.setGrid(S().grid); syncBar(); } }, glyph('grid')), 'Blueprint grid');
    const outlineBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Layer outline', onclick: () => { save((b) => { b.outline = !b.outline; }); if (V) V.setOutline(S().outline); syncBar(); } }, glyph('outline')), 'Outline of the top shown layer');
    const rotBtn = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Turn slowly', onclick: () => { save((b) => { b.auto = !b.auto; }); if (V) V.setAuto(S().auto); syncBar(); } }, glyph('rot')), 'Turn slowly while idle');
    const GLASS = [['tint', 'Glass: see-through', 'Glass, panes and windows lightly tinted, so you see in and see them'], ['solid', 'Glass: solid', 'Glass nearly opaque, to read the shape of a glass build'], ['clear', 'Glass: as in game', 'Glass as clear as in Minecraft']];
    const glassBtn = h('button.btn.small.bd-vk.bd-glasskey', { type: 'button', onclick: () => {
      const i = (GLASS.findIndex((g) => g[0] === (S().glass || 'tint')) + 1) % GLASS.length;
      save((b) => { b.glass = GLASS[i][0]; }); if (V) V.setGlass(GLASS[i][0]); syncGlass();
    } }, glyph('glass'), h('span.bd-vlabel'));
    tip(glassBtn, () => { const g = GLASS.find((x) => x[0] === (S().glass || 'tint')) || GLASS[0]; return [h('div.th-tooltip-title', g[1]), h('div.th-tooltip-sub', g[2]), h('div.th-tooltip-sub', 'Click for the next look')]; });
    const syncGlass = () => { const g = GLASS.find((x) => x[0] === (S().glass || 'tint')) || GLASS[0]; glassBtn.querySelector('.bd-vlabel').textContent = g[1]; glassBtn.setAttribute('aria-label', g[1] + ' (click for the next look)'); };
    syncGlass();
    const symBtn = tip(h('button.btn.small.bd-vk.bd-symkey', { type: 'button', 'aria-pressed': 'false', 'aria-controls': 'bd-sym', onclick: () => { sym.open = !sym.open; symChanged(); } }, glyph('mirror'), h('span.bd-vlabel', 'Symmetry')), 'Mirror planes: check which blocks have no mirrored twin');
    const bar = h('div.bd-abar', { role: 'group', 'aria-label': 'Animation and view' },
      h('div.bd-bar-grp', playBtn, replayBtn, modeSeg, speedSeg),
      h('div.bd-bar-grp.bd-bar-layer', h('label.bd-bar-lbl', { for: 'bd-layer' }, 'Layer'), layer, layerLbl, sliceBtn),
      h('div.bd-bar-grp.bd-bar-end', glassBtn, gridBtn, outlineBtn, rotBtn));
    layer.id = 'bd-layer';
    stage.querySelector('.bd-frametools').prepend(symBtn);   // the Symmetry key sits with the view keys on the stage
    const symPanel = symPanelUI();
    const viewer = h('section.panel.bd-viewer', { 'aria-label': '3D view' }, stage, bar, symPanel.el);

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
      const s = (V && V.schem) || UI.shown;   // the mirrored preview when it is on
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
        symNote(s, hit),
        r.ok ? null : core().known(id) ? h('span.th-tooltip-tag', 'Functional') : h('span.th-tooltip-tag', 'Unknown block')].filter(Boolean));
      hov.classList.add('on');
      placeHov();
    }

    UI = { wrap, layout, head, secBtns, stage, title, meta, runBtn, phaseCap, loading, playBtn, modeBtns, speedBtns, layer, layerLbl, sliceBtn, gridBtn, outlineBtn, rotBtn, symBtn, symPanel, side, viewer, fileIn, hov, onHover, shown: null, shownKey: null, picker: null };
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
    V.glassMode = ['tint', 'solid', 'clear'].includes(st.glass) ? st.glass : 'tint';
    UI.loading.hidden = false; UI.loading.textContent = 'Loading the 3D view…'; UI.loading.classList.remove('err');
    return V.init().then(() => { UI.loading.hidden = true; if (inMake()) B().editorUI.enter(ctx()); else show(st.section === 'create' ? 'shape' : (st.stage || st.cur), { animate: true, layer: 'top' }); }).catch(() => {
      if (!UI.wrap.isConnected) return;   // left the tab while it was loading: it starts again on return
      UI.loading.hidden = false;
      UI.loading.textContent = (V && V.error) || 'The 3D view could not start.';
      UI.loading.classList.add('err');
    });
  }
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#/builds' && V) {
      V.setSymmetry(null); V.dispose(); if (UI) UI.hov.classList.remove('on');
      sym.cache = null; sym.cls = null; if (sym.timer) { clearTimeout(sym.timer); sym.timer = 0; }   // the flags are rebuilt on return
    }
  });

  /** Put a schematic on the stage. opts: animate, keepView, layer: 'top'. */
  function show(key, opts) {
    opts = opts || {};
    if (inMake()) return;   // the editor owns the stage
    let s = effective(key, opts.fast);
    if (!s && key === 'shape') return;
    if (!s && key !== 'farm:cow_crusher') { key = 'farm:cow_crusher'; s = effective(key); save((b) => { b.cur = key; }); }
    if (!s) return;
    // all layers were showing and the height changed (resize, angle): keep showing all of them
    const wasTop = UI.shown && +UI.layer.value >= UI.shown.size[1] && UI.shown.size[1] !== s.size[1];
    if (wasTop) opts = Object.assign({}, opts, { layer: 'top' });
    UI.shown = s; UI.shownKey = key;
    if (S().stage !== key) save((b) => { b.stage = key; });
    UI.title.textContent = keyName(key) || s.name;
    const n = core().volume(s);
    UI.meta.textContent = s.size[0] + ' × ' + s.size[1] + ' × ' + s.size[2] + ' · ' + fmtN(n) + ' blocks';
    UI.layer.max = s.size[1];
    if (opts.layer === 'top' || +UI.layer.value > s.size[1] || !opts.keepView) UI.layer.value = s.size[1];
    if (V && V.ready) {
      const st = stageSchem(s, key);   // the build, or its mirrored preview while the symmetry preview is on
      const ph = st === s && key.startsWith('farm:') ? B().farms.phases(key.slice(5), s) : null;
      V.setSchematic(st, { animate: !!opts.animate, keepView: !!opts.keepView, keepZoom: !!opts.keepView, phases: ph, layer: opts.layer || (+UI.layer.value >= s.size[1] ? 'top' : null) }).then(() => { if (V) { V.setLayer(+UI.layer.value - 1); syncLayer(); syncRun(); syncSym(); } });
    } else if (V) V.schem = s;
    syncLayer();
    syncSym();
  }

  /* ======================================================================
   * Symmetry: mirror planes on the stage (the maths is TH.builds.sym in builds-view.js)
   * ====================================================================== */
  const AX = ['X', 'Y', 'Z'], AX_ORDER = [0, 2, 1];
  const AX_TIP = ['Mirror east and west: a plane across X', 'Mirror top and bottom: a plane across Y', 'Mirror north and south: a plane across Z'];
  const sym = { open: false, on: [true, false, false], m: [1, 1, 1], preview: false, flip: 0, src: null, srcSig: '', cls: null, cache: null, staged: '', timer: 0 };
  const symPlanes = () => AX_ORDER.filter((a) => sym.on[a]).map((a) => ({ axis: a, m: sym.m[a] }));
  const symActive = () => sym.open && sym.on.some(Boolean) && !!(B() && B().sym);
  /** Track the build on the stage; the planes go back to its centre when another build (or another size) comes on. */
  function symFor(s, key) {
    if (!s || !B().sym) return;
    const sig = key + '|' + s.size.join('x');
    if (sym.src === s && sym.srcSig === sig) return;
    const keep = sym.srcSig === sig;   // the same build at the same size (block swaps): the planes stay where they are
    sym.src = s; sym.srcSig = sig; sym.cache = null; sym.cls = null;
    if (!keep) { const box = B().sym.box(s); for (let a = 0; a < 3; a++) sym.m[a] = B().sym.centre(s, a, box); }
  }
  /** What the stage shows: the build, or (preview on) the build with one half mirrored onto the other. */
  function stageSchem(s, key) {
    if (!s || !B().sym) return s;
    symFor(s, key);
    const pv = symActive() && sym.preview;
    sym.staged = pv ? sym.srcSig + '|' + symPlanes().map((p) => p.axis + ':' + p.m).join() + '|' + sym.flip : '';
    return pv ? B().sym.mirror(s, symPlanes(), sym.flip) : s;
  }
  /** Put the build (or its preview) on the stage again without moving the camera; only when that changes what is shown. */
  function restage() {
    sym.timer = 0;
    if (!V || !V.ready || !UI.shown) return;
    const was = sym.staged, key = UI.shownKey, s = UI.shown, st = stageSchem(s, key);
    if (st === s && V.schem === s) return;
    if (st !== s && sym.staged === was && V.schem && V.schem !== s) return;   // the same preview is already on the stage
    const ph = st === s && key.startsWith('farm:') ? B().farms.phases(key.slice(5), s) : null;
    V.setSchematic(st, { keepView: true, keepZoom: true, phases: ph }).then(() => { if (V) { V.setLayer(+UI.layer.value - 1); syncLayer(); syncRun(); syncSym(); } });
  }
  /** Something about the planes changed: redraw now (one pass, cheap), put the preview on the stage after a short pause. */
  function symChanged(wait) {
    syncSym();
    if (sym.timer) clearTimeout(sym.timer);
    sym.timer = setTimeout(restage, wait || 0);
  }
  function symResult() {
    const s = sym.src, planes = symPlanes(), sig = planes.map((p) => p.axis + ':' + p.m).join();
    if (!sym.cls || sym.cls.s !== s) sym.cls = { s, c: B().sym.classes(s) };
    if (!sym.cache || sym.cache.s !== s || sym.cache.sig !== sig) sym.cache = { s, sig, r: B().sym.check(s, planes, sym.cls.c) };
    return sym.cache.r;
  }
  const halfTxt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  /** Tooltip line on a hovered block that has no mirrored twin. */
  function symNote(s, hit) {
    if (!symActive() || sym.preview || !sym.cache || s !== sym.src) return null;
    const [sx, , sz] = s.size, f = sym.cache.r.flags[(hit[1] * sz + hit[2]) * sx + hit[0]];
    if (!f) return null;
    return h('span.th-tooltip-sub.bd-sym-bad', 'No mirrored twin across ' + AX.filter((n, a) => f & (1 << a)).join(' and '));
  }
  function symPanelUI() {
    const rows = AX_ORDER.map((a) => {
      const key = tip(h('button.btn.small.bd-vk.sq.bd-sym-ax', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Mirror plane across ' + AX[a], onclick: () => { sym.on[a] = !sym.on[a]; symChanged(); } }, AX[a]), AX_TIP[a]);
      const slider = h('input.slider.bd-sym-pos', { type: 'range', min: 1, max: 1, value: 1, step: 1, 'aria-label': 'Position of the plane across ' + AX[a] });
      slider.addEventListener('input', () => { sym.m[a] = +slider.value; symChanged(160); });
      tip(slider, 'Move the plane in half-block steps (arrow keys work too)');
      const at = h('span.bd-sym-at');
      const centre = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Back to the centre', onclick: () => { if (!sym.src) return; sym.m[a] = B().sym.centre(sym.src, a); symChanged(); } }, glyph('centre')), 'Back to the centre of the build');
      const res = h('span.bd-sym-res', { 'aria-live': 'polite' });
      const el = h('div.bd-sym-row', key, slider, at, centre, res);
      return { axis: a, el, key, slider, at, centre, res };
    });
    const prevBtn = tip(h('button.btn.small.bd-vk', { type: 'button', 'aria-pressed': 'false', onclick: () => { sym.preview = !sym.preview; symChanged(); } }, glyph('mirror'), h('span', 'Mirrored preview')), 'Show the build as if it were perfectly symmetric: one half mirrored onto the other. Your build is not changed.');
    const flipBtn = tip(h('button.btn.small.bd-vk', { type: 'button', onclick: () => { symPlanes().forEach((p) => { sym.flip ^= 1 << p.axis; }); symChanged(); } }, glyph('swap'), h('span', 'Other half')), 'Mirror the other half instead');
    const sum = h('p.bd-sym-sum', { 'aria-live': 'polite' });
    const el = h('div.bd-sym', { id: 'bd-sym', role: 'group', 'aria-label': 'Symmetry', hidden: true }, ...rows.map((r) => r.el), h('div.bd-sym-foot', prevBtn, flipBtn, sum));
    return { el, rows, prevBtn, flipBtn, sum };
  }
  function syncSym() {
    if (!UI || !UI.symPanel) return;
    const P = UI.symPanel, s = UI.shown, has = !!(s && B() && B().sym);
    press(UI.symBtn, sym.open);
    P.el.hidden = !sym.open;
    if (has) symFor(s, UI.shownKey);
    const active = has && symActive(), r = active ? symResult() : null;
    P.rows.forEach((row) => {
      const a = row.axis, on = sym.on[a], n = s ? s.size[a] : 1;
      press(row.key, on);
      row.el.classList.toggle('off', !on);
      row.slider.max = String(Math.max(1, 2 * n - 1));
      sym.m[a] = clamp(sym.m[a], 1, Math.max(1, 2 * n - 1));
      row.slider.value = String(sym.m[a]);
      row.slider.style.setProperty('--fill', ((sym.m[a] - 1) / Math.max(1, 2 * n - 2) * 100).toFixed(1) + '%');
      row.slider.disabled = !on; row.centre.disabled = !on;
      row.at.textContent = AX[a].toLowerCase() + ' ' + halfTxt((sym.m[a] - 1) / 2);
      const q = r && r.res.find((x) => x.axis === a);
      const pc = q ? (q.diff ? Math.min(99, Math.floor(q.pct * 100)) : 100) : 0;
      row.res.textContent = !q ? 'Off' : !q.diff ? '100% symmetric across ' + AX[a] : pc + '% symmetric, ' + fmtN(q.diff) + (q.diff === 1 ? ' block differs' : ' blocks differ');
      row.res.classList.toggle('bad', !!(q && q.diff));
    });
    press(P.prevBtn, sym.preview);
    P.prevBtn.disabled = !active;
    P.flipBtn.disabled = !active || !sym.preview;
    P.sum.textContent = !active ? 'Turn on a plane to check the build.' : sym.preview ? 'One half mirrored onto the other. Your build is not changed.'
      : r.diff ? fmtN(r.diff) + (r.diff === 1 ? ' block has no mirrored twin. It is marked red.' : ' blocks have no mirrored twin. They are marked red.') : 'Every block has its mirrored twin.';
    if (V && V.ready && !inMake()) V.setSymmetry(active ? { schem: sym.preview ? V.schem : sym.src, planes: symPlanes(), flags: sym.preview ? null : r.flags } : null);
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
  /** Create > Make it myself: the quick editor has the stage. */
  const inMake = () => S().section === 'create' && S().createMode === 'make' && !!(B().editorUI);
  function go(sec, mode) {
    const st = S(), wasMake = inMake();
    if (st.section === sec && (!mode || st.createMode === mode)) return;
    save((b) => { b.section = sec; if (mode) b.createMode = mode; });
    if (wasMake && !inMake()) { B().editorUI.leave(); UI.shownKey = null; }
    // the stage follows the section: Library shows the chosen farm / file, Create the shape (or the editor)
    if (inMake()) { if (V && V.ready) B().editorUI.enter(ctx()); }
    else if (sec === 'library' && UI.shownKey !== st.cur) show(st.cur, { animate: true, layer: 'top' });
    else if (sec === 'create' && UI.shownKey !== 'shape') show('shape', { animate: true, layer: 'top' });
    patch();
  }

  function patch() {
    const st = S();
    UI.secBtns.forEach((b) => { const on = b.dataset.sec === st.section; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    UI.wrap.dataset.sec = st.section;
    const make = inMake();
    UI.viewer.classList.toggle('is-make', make);
    const oldBar = UI.viewer.querySelector('.bd-mbar');
    if (make) { const nb = B().editorUI.bar(ctx()); if (oldBar) oldBar.replaceWith(nb); else UI.stage.after(nb); } else if (oldBar) oldBar.remove();
    if (make && sym.open) { sym.open = false; syncSym(); }
    const browsing = st.section === 'library' && st.browse;
    UI.layout.classList.toggle('is-browse', browsing);
    if (UI.wasBrowse && !browsing && !reduced()) {   // the build comes in, the library folds up beside it
      [UI.viewer, UI.side].forEach((e) => { e.classList.add('bd-enter'); setTimeout(() => e.classList.remove('bd-enter'), 700); });
    }
    UI.wasBrowse = browsing;
    UI.picker = null;
    const body = st.section === 'create' ? createSide() : librarySide();
    UI.side.replaceChildren(...body);
    syncBar(); syncLayer();
    if (make) B().editorUI.refresh();
  }

  /* ======================================================================
   * Library
   * ====================================================================== */
  const DIM_NAME = { overworld: 'Overworld', nether: 'Nether', end: 'End' };
  /**
   * Card art: the texture icon, or (art) a crop of a mob skin: [entity texture, skin w, h, crop x, y, w, h, optional
   * overlay [x, y, w, h, colour] in crop texels, e.g. the guardian's pupil, a separate box in the game model].
   */
  function thumb(icon, art) {
    if (art && TH.icon.tex) {
      const [tex, tw, th, x, y, w, hh, dot] = art, px = Math.max(1, Math.floor(36 / Math.max(w, hh)));
      const el = h('span.mc.bd-face', { 'aria-hidden': 'true' });
      el.style.cssText = '--mc:' + w * px + 'px;width:' + w * px + 'px;height:' + hh * px + 'px;background-image:url("' + TH.icon.tex(tex) + '");background-size:' + tw * px + 'px ' + th * px + 'px;background-position:' + -x * px + 'px ' + -y * px + 'px';
      if (dot) { const d = h('span.bd-face-dot'); d.style.cssText = 'left:' + dot[0] * px + 'px;top:' + dot[1] * px + 'px;width:' + dot[2] * px + 'px;height:' + dot[3] * px + 'px;background:' + dot[4]; el.append(d); }
      return h('span.bd-thumb', { 'aria-hidden': 'true' }, el);
    }
    return h('span.bd-thumb', { 'aria-hidden': 'true' }, TH.icon(icon, { size: 32 }));
  }
  function pickKey(key) {
    save((b) => { b.cur = key; b.section = 'library'; b.browse = false; });
    patch();   // the viewer is on screen again before it is filled
    show(key, { animate: true, layer: 'top' });
  }
  const USE = { afk: ['AFK', 'Runs by itself while you do something else nearby'], semi: ['Semi-AFK', 'Mostly automatic, you top it up or collect now and then'], manual: ['Manual', 'You do the work by hand'] };
  const CATS = [['all', 'All'], ['farm', 'Farms'], ['machine', 'Machines'], ['build', 'Structures'], ['yours', 'Yours']];
  const TECH = [['all', 'Any'], ['redstone', 'Redstone'], ['no-redstone', 'No redstone']];
  const TAG_LABEL = { pistons: 'Pistons', observer: 'Observers', hoppers: 'Hoppers', crops: 'Crops', mobs: 'Mobs', food: 'Food', utility: 'Utility', house: 'Houses', defence: 'Defence', medieval: 'Medieval', landmark: 'Landmarks', coastal: 'Coastal', decor: 'Decor', japanese: 'Japanese', village: 'Village', wood: 'Wood', stone: 'Stone', 'no-redstone': 'No redstone', redstone: 'Redstone', statue: 'Statues', 'mob-head': 'Mob heads', ocean: 'Ocean', 'pixel-art': 'Pixel art', creature: 'Creatures' };
  const tagLabel = (t) => TAG_LABEL[t] || (t[0].toUpperCase() + t.slice(1));
  const NOT_TOPIC = new Set(['redstone', 'no-redstone', 'yours']);
  const LEVEL_RANK = { Easy: 0, Medium: 1, Hard: 2 };
  const USE_RANK = ['afk', 'semi', 'manual', null];
  function useBadge(u) { return u && USE[u] ? h('span.pill.bd-use.bd-use-' + u, USE[u][0]) : null; }

  /** Everything the Library can show: our builds plus the files you opened (with the tags you gave them). */
  function libEntries() {
    const st = S(), fp = fileParts();
    const farms = B().farms.FARMS.map((f) => ({ key: 'farm:' + f.id, farm: f, cat: f.cat || 'farm', name: f.name, pitch: f.pitch, icon: f.icon, art: f.art || null, use: f.use || null, tags: f.tags || [], level: f.level, dim: f.dim }));
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
    save((b) => { b.files = (b.files || []).filter((x) => x.id !== rec.id); delete b.swaps[key]; delete b.ticks[key]; delete b.ticks[key + '#raw']; if (b.have) { delete b.have[key]; delete b.have[key + '#raw']; } delete b.meta[key]; if (b.matSrc === key) b.matSrc = 'stage'; if (b.cur === key) b.cur = 'farm:cow_crusher'; if (b.stage === key) b.stage = b.cur; });
    mem.files.delete(rec.id); mem.extras.delete(rec.id);
    if (mem.sessionOnly) mem.sessionOnly = mem.sessionOnly.filter((x) => x.id !== rec.id);
    if (UI.shownKey === key) show(S().cur, { animate: true, layer: 'top' });
    patch();
  }

  /** One build as a card: icon, name, a two-line pitch, badges. */
  function card(e) {
    const st = S(), on = st.cur === e.key;
    const del = e.rec ? tip(h('button.bd-x.bd-card-x', { type: 'button', 'aria-label': 'Remove ' + e.name, onclick: (ev) => { ev.stopPropagation(); removeFile(e.rec); } }, glyph('x')), 'Remove from the library') : null;
    return h('div.bd-cardwrap', h('button.bd-card' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), onclick: () => pickKey(e.key) },
      h('span.bd-card-top', e.icon ? thumb(e.icon, e.art) : h('span.bd-thumb.bd-thumb-file', { 'aria-hidden': 'true' }, glyph('file')), h('span.bd-card-name', e.name)),
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
      cur.icon ? thumb(cur.icon, cur.art) : h('span.bd-thumb.bd-thumb-file', { 'aria-hidden': 'true' }, glyph('file')),
      h('span.bd-ckey-txt', h('span.bd-ckey-name', cur.name), h('span.bd-ckey-sub', [USE[cur.use] ? USE[cur.use][0] : null, cur.level, cur.dim ? DIM_NAME[cur.dim] : null].filter(Boolean).join(' · '))));
    tip(key, 'Browse all builds, with search and filters');
    const prev = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Previous build', disabled: list.length < 2, onclick: () => step(-1) }, glyph('left')), 'Previous build' + (act ? ' in this filter' : ''));
    const next = tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Next build', disabled: list.length < 2, onclick: () => step(1) }, glyph('right')), 'Next build' + (act ? ' in this filter' : ''));
    return h('section.panel.bd-pan.bd-compact.has-sel', { 'aria-label': 'Library' },
      h('div.bd-pan-head', h('h3', 'Library'), h('span.bd-count', list.length + (act ? ' match your filter' : ' builds'))),
      h('div.bd-crow', prev, key, next),
      h('div.bd-morerow', h('button.bd-more', { type: 'button', onclick: () => { save((b) => { b.browse = true; }); patch(); } }, h('span', act ? 'Browse all builds (filter on)' : 'Browse all builds')),
        h('button.bd-more', { type: 'button', onclick: () => toMats(cur.key) }, h('span', 'Material list'), h('em', '→'))));
  }

  /** Name, how you use it and tags for a file you opened: this is what makes your own builds findable in the Library. */
  function fileInfo(key) {
    const st = S(), m = st.meta[key] || {}, rec = fileRec(key.slice(5));
    if (!rec) return null;
    const upd = (fn) => { save((b) => { const x = b.meta[key] || (b.meta[key] = {}); fn(x); }); };
    const name = h('input.field', { type: 'text', value: m.name || rec.name, 'aria-label': 'Name', maxlength: 60, oninput: (e) => { upd((x) => { x.name = e.target.value.trim() || rec.name; }); if (UI.shownKey === key) UI.title.textContent = e.target.value.trim() || rec.name; } });
    const useSeg = h('div.seg.bd-useseg', { role: 'radiogroup', 'aria-label': 'How you use it' }, [['', 'Not a farm'], ['afk', 'AFK'], ['semi', 'Semi-AFK'], ['manual', 'Manual']].map(([id, t]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String((m.use || '') === id), class: (m.use || '') === id ? 'on' : null, onclick: () => { upd((x) => { x.use = id || null; }); patch(); } }, t)));
    const tags = m.tags || [];
    const chips = h('div.bd-tagrow', tags.map((t) => h('span.pill.bd-tag.bd-tag-x', tagLabel(t), h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: () => { upd((x) => { x.tags = (x.tags || []).filter((y) => y !== t); }); patch(); } }, glyph('x')))));
    const add = h('input.field', { type: 'text', placeholder: 'Add a tag, press Enter', 'aria-label': 'Add a tag', maxlength: 24,
      onkeydown: (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const t = add.value.trim().toLowerCase().replace(/[^a-z0-9 -]+/g, '').replace(/\s+/g, '-'); if (!t || tags.includes(t) || tags.length >= 8) return; upd((x) => { x.tags = (x.tags || []).concat(t); }); patch(); } });
    return h('section.panel.bd-pan.bd-info', { 'aria-label': 'About this build' },
      h('div.bd-pan-head', h('h3', 'Your build'), h('span.bd-count', rec.size.join(' × '))),
      h('p.bd-note', 'Name it and tag it so you can find it in the Library: AFK, redstone, whatever you like.'),
      h('div.bd-sub', 'Name'), name, h('div.bd-sub', 'How you use it'), useSeg, h('div.bd-sub', 'Tags'), chips, add,
      insideNote(effective(key)),
      h('button.bd-link', { type: 'button', onclick: () => toMats(key) }, 'Material list, recipes and packing →'));
  }

  /* ---- what the file carries besides blocks: contents, sign text, other data, entities, orientation ---- */
  const insideOpen = { items: false, signs: false };   // the two fold-outs stay open across re-renders of the side
  const plural = (n, one, many) => fmtN(n) + ' ' + (n === 1 ? one : many);
  /** "29 × 43 × 56 · region at 28 0 55, size -29 43 -56 · front faces east (by its door) · kept as imported". */
  function orientText(s) {
    const src = s.src || {}, parts = [s.size.join(' × ') + ' (X × Y × Z)'];
    if (src.fmt === 'litematic' && src.region && src.region.size) parts.push('region at ' + src.region.pos.join(' ') + ', size ' + src.region.size.join(' '));
    else if (src.fmt === 'litematic' && src.parts) parts.push(src.parts.length + ' regions, joined into one');
    if (src.fmt === 'sponge') {
      const o = src.offset || [0, 0, 0], m = src.meta || {};
      if (o.some(Boolean)) parts.push('offset ' + o.join(' '));
      if (m.WEOffsetX && m.WEOffsetY && m.WEOffsetZ) parts.push('paste origin ' + [m.WEOffsetX[1], m.WEOffsetY[1], m.WEOffsetZ[1]].map((v) => -v).join(' ') + ' from the corner');
    }
    if (s.origin && s.origin.some(Boolean)) parts.push('empty edge cropped (' + s.origin.join(' ') + ')');
    const f = core().frontOf(s);
    parts.push((f ? 'front faces ' + f.facing + ' (by its ' + (f.by === 'door' ? 'door' : 'wall signs') + ')' : 'no clear front') + ' · orientation kept as imported');
    return parts.join(' · ');
  }
  /** Item icon (inventory look for blocks, the item sprite otherwise, via the Material List's icon finder). */
  const itemIco = (id, size) => (B().mats && B().mats.iconFor ? B().mats.iconFor(id, size) : core().blockIcon(id, { size }));
  function itemList(m) {
    return h('ul.bd-needs.bd-inside-items', m.items.map((x) => tip(h('li', { tabindex: 0 }, itemIco(x.id, 18), h('span.bd-needs-n', fmtN(x.n)), h('span', core().nameOf(x.id) + (x.ench ? ' ✦' : ''))),
      () => [h('div.th-tooltip-title', core().nameOf(x.id)), h('div.th-tooltip-sub', fmtN(x.n) + ' in ' + plural(x.stacks, 'stack', 'stacks')),
        x.nested ? h('div.th-tooltip-sub', fmtN(x.nested) + ' of them inside shulker boxes or bundles') : null, x.ench ? h('div.th-tooltip-tag', 'Enchanted') : null,
        x.names.length ? h('div.th-tooltip-sub', 'Named: ' + x.names.join(', ')) : null].filter(Boolean))));
  }
  function signList(m) {
    return h('div.bd-signs', m.signs.map((sg) => h('div.bd-sign',
      h('span.bd-sign-at', (sg.hanging ? 'Hanging sign' : 'Sign') + ' at ' + sg.x + ' ' + sg.y + ' ' + sg.z + (sg.glow ? ' · glowing' : '') + (sg.waxed ? ' · waxed' : '')),
      h('span.bd-sign-text', sg.front.filter((l) => l.trim()).join(' / ') || '(front empty)'),
      sg.back.some((l) => l.trim()) ? h('span.bd-sign-text.bd-sign-back', 'Back: ' + sg.back.filter((l) => l.trim()).join(' / ')) : null)));
  }
  /** A fold-out key: the list sits under it, toggled with `hidden` (no re-render, no motion). */
  function fold(which, label, body) {
    body.hidden = !insideOpen[which];
    const b = h('button.bd-link.bd-fold', { type: 'button', 'aria-expanded': String(insideOpen[which]), onclick: () => {
      insideOpen[which] = !insideOpen[which]; body.hidden = !insideOpen[which]; b.setAttribute('aria-expanded', String(insideOpen[which]));
      b.textContent = (insideOpen[which] ? 'Hide ' : 'Show ') + label;
    } }, (insideOpen[which] ? 'Hide ' : 'Show ') + label);
    return [b, body];
  }
  const countLine = (list, max) => {
    const shown = list.slice(0, max || 6).map((k) => k.label + ' ' + fmtN(k.n)).join(' · ');
    return list.length > (max || 6) ? shown + ' · +' + (list.length - (max || 6)) + ' more' : shown;
  };
  /** The "Inside the build" part of the info panel: containers (+ item list), other data blocks (+ sign text), entities, orientation, warnings. */
  function insideNote(s) {
    if (!s) return null;
    const C = core(), m = C.hasExtras(s) ? C.extrasSummary(s) : null;
    const out = [h('div.bd-sub', 'Inside the build')];
    if (s.xzLost) out.push(h('p.bd-note.bd-warn', 'The saved contents of this file could not be read back. Open the file again to bring them back.'));
    if (!m) out.push(h('p.bd-note', s.src ? 'This file has no container contents, sign text or entities.' : 'No container contents, sign text or entities came with this file.'));
    else {
      if (m.containers) {
        const row = tip(h('p.bd-inside', { tabindex: 0 }, h('b', 'Containers'), ' ' + fmtN(m.containers) + ' · ' + fmtN(m.filled) + ' with items · ' + plural(m.stacks, 'stack', 'stacks')),
          () => [h('div.th-tooltip-title', 'Containers'), ...m.contKinds.map((k) => h('div.th-tooltip-sub', k.label + ' ' + fmtN(k.n)))]);
        out.push(row);
        if (m.items.length) out.push(...fold('items', m.items.length === 1 ? 'the item' : 'all ' + m.items.length + ' items', itemList(m)));
      } else if (m.items.length) out.push(...fold('items', 'the ' + plural(m.items.length, 'item', 'items') + ' in frames and on entities', itemList(m)));
      if (m.kinds.length) {
        out.push(tip(h('p.bd-inside', { tabindex: 0 }, h('b', 'With data'), ' ' + countLine(m.kinds)), () => [h('div.th-tooltip-title', 'Blocks that carry data'), ...m.kinds.map((k) => h('div.th-tooltip-sub', k.label + ' ' + fmtN(k.n)))]));
        if (m.signs.length) out.push(...fold('signs', 'the sign text', signList(m)));
      }
      if (m.ents.length) out.push(tip(h('p.bd-inside', { tabindex: 0 }, h('b', 'Entities'), ' ' + countLine(m.ents)), () => [h('div.th-tooltip-title', 'Entities'), ...m.ents.map((k) => h('div.th-tooltip-sub', k.label + ' ' + fmtN(k.n)))]));
      if (m.lost) out.push(h('p.bd-note.bd-warn', plural(m.lost, 'block', 'blocks') + ' lost what they held in a swap (the new block cannot hold it). Reset that swap to keep it.'));
      out.push(h('p.bd-note', 'All of it goes into every download, exactly as it came.'));
    }
    out.push(h('p.bd-note.bd-orient', orientText(s)));
    return out;
  }

  function librarySide() {
    const st = S(), farms = B().farms;
    const cur = st.cur;
    if (st.browse) return [browsePanel(), plannedPanel()];
    const out = [compactPanel()];
    if (cur.startsWith('farm:')) out.push(farmInfo(farms.FARMS.find((f) => 'farm:' + f.id === cur)));
    if (cur.startsWith('file:')) { const fi = fileInfo(cur); if (fi) out.push(fi); }
    if (original(cur)) out.push(customisePanel(cur));
    if (original(cur) && B().createUI) out.push(B().createUI.xfPanel(ctx(), cur));
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
      optRows(f),
      f.useText ? [h('div.bd-sub', 'How you use it'), h('p.bd-use-text', f.useText)] : null,
      f.tags && f.tags.length ? h('div.bd-tagrow', f.tags.map((t) => h('span.pill.bd-tag', (t === 'no-redstone' ? 'No redstone' : t === 'redstone' ? 'Redstone' : TAG_LABEL[t] || t)))) : null,
      h('div.bd-sub', 'You need'),
      h('ul.bd-needs', top.map((m) => h('li', core().blockIcon(m.block, { size: 18 }), h('span.bd-needs-n', fmtN(m.n)), h('span', core().nameOf(m.item)))),
        mats.length > top.length ? h('li', h('button.bd-link', { type: 'button', onclick: () => toMats('farm:' + f.id) }, '+ ' + (mats.length - top.length) + ' more in Materials')) : null),
      h('button.bd-link', { type: 'button', onclick: () => toMats('farm:' + f.id) }, 'Full material list, recipes and packing →'),
      h('div.bd-sub', 'Build it'),
      h('ol.bd-steps', f.steps.map((t) => h('li', t))),
      h('div.bd-sub', 'Good to know'),
      h('ul.bd-tips', f.tips.map((t) => h('li', t))));
  }

  /** Option rows of a built-in build that has some (the mob heads: size, tail): one exclusive seg each, the stage follows. */
  function optRows(f) {
    if (!f.opts || !f.opts.length) return null;
    const o = farmOpts(f), key = 'farm:' + f.id;
    const pick = (op, v) => {
      if (o[op.id] === v) return;
      save((b) => { b.fopt = b.fopt || {}; const m = b.fopt[f.id] || (b.fopt[f.id] = {}); m[op.id] = v; });
      if (UI.shownKey === key) show(key, { layer: 'top' });   // no build animation: the new size just stands there, framed
      patch();
    };
    /**
     * Tooltip: what the choice means, and the size and block count it gives (from the measured table, so a giant is
     * never built just to hover it; else built on first hover and cached). Over 100 000 blocks it says so.
     */
    const info = (op, c) => () => {
      if (op.look) return [h('div.th-tooltip-title', c[2] || c[1])];
      const oo = Object.assign({}, o, { [op.id]: c[0] });
      let st = B().farms.stats(f.id, oo);
      if (!st) { const s = B().farms.schematic(f.id, oo); st = s && { size: s.size, n: core().volume(s), water: core().counts(s, true).filter((r) => core().parse(r.id).name === 'water').reduce((a, r) => a + r.n, 0) }; }
      return [h('div.th-tooltip-title', c[2] || c[1]),
        st ? h('div.th-tooltip-sub', st.size.join(' × ') + ' · ' + fmtN(st.n) + ' blocks' + (st.water ? ', ' + fmtN(st.water) + ' of them water' : '')) : null,
        st && st.n - st.water > 100000 ? h('div.th-tooltip-sub.bd-optwarn', 'Over 100 000 blocks: a very long build, and slow on older devices') : null].filter(Boolean);
    };
    // the option groups flow side by side while they fit (Tentacles, Height ...), each group its label over its keys
    return h('div.bd-opts', f.opts.map((op) => h('div.bd-opt', h('div.bd-sub', op.label),
      h('div.seg.bd-optseg' + (op.choices.length > 4 ? '.bd-optseg-many' : ''), { role: 'radiogroup', 'aria-label': f.name + ' ' + op.label.toLowerCase() }, op.choices.map((c) => {
        const on = o[op.id] === c[0];
        return tip(h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : null, onclick: () => pick(op, c[0]) }, c[1]), info(op, c));
      })))));
  }

  /** Blocks whose extra data (text, contents, patterns) lives in a block entity: a file without block entities has none of it. */
  const ENTITY_DATA = /(_sign|_banner|chest|shulker_box|barrel|hopper|dispenser|dropper|furnace|smoker|lectern|jukebox|decorated_pot|spawner|beehive|bee_nest|command_block|_skull|_head|crafter|brewing_stand|campfire|chiseled_bookshelf|_shelf|vault|trial_spawner)$/;
  /** Close every open picker in the side column (one is open at a time). */
  function closePickers() {
    UI.side.querySelectorAll('[aria-expanded="true"]').forEach((b) => { if (b.matches('.bd-swap, .bd-setkey')) b.setAttribute('aria-expanded', 'false'); });
    UI.side.querySelectorAll('.bd-picker').forEach((p) => p.remove());
  }
  /**
   * Customise blocks: whole sets (wood type, stone, colour, copper) in one go, then one row per replaceable block
   * (texture, name, count), the locked functional ones, and the downloads (with your changes, or the original).
   */
  function customisePanel(key) {
    const st = S(), orig = original(key);
    const swaps = st.swaps[key] || {};
    const rows = core().counts(orig, true);
    const free = rows.filter((r) => core().replaceable(r.id).ok), locked = rows.filter((r) => !core().replaceable(r.id).ok);
    const n = Object.keys(swaps).length;
    const mkRow = (r) => {
      const to = swaps[r.id] && core().canSwap(r.id, swaps[r.id]) ? swaps[r.id] : null, cur = to || r.id;
      const btn = h('button.btn.bd-swap' + (to ? '.on' : ''), { type: 'button', 'aria-expanded': 'false', onclick: () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        closePickers();
        if (open) return;
        btn.setAttribute('aria-expanded', 'true');
        const fam = core().def(r.id).fam;
        btn.after(blockPicker({ ids: core().familyOf(fam), current: cur, original: r.id, note: core().famNote(fam), onPick: (id) => setSwap(key, r.id, id), label: 'Replace ' + core().nameOf(r.id) }));
      } },
      core().blockIcon(cur, { size: 24 }),
      h('span.bd-swap-txt', h('span.bd-swap-name', core().nameOf(cur)), to ? h('span.bd-swap-was', 'was ' + core().nameOf(r.id)) : h('span.bd-swap-was', 'Click to replace')),
      h('span.bd-swap-n', fmtN(r.n)), glyph('swap', 'bd-swap-ico'));
      return btn;
    };
    const lockRow = (r) => tip(h('div.bd-lockrow', { tabindex: 0 }, core().blockIcon(r.id, { size: 20 }), h('span.bd-swap-name', core().nameOf(r.id)), h('span.bd-swap-n', fmtN(r.n)), glyph('lock', 'bd-lock-ico')),
      () => [h('div.th-tooltip-title', core().nameOf(r.id) + ' stays'), h('div.th-tooltip-sub', core().replaceable(r.id).why)]);
    // whole sets: only those with two or more kinds of block (one kind is the same as its single row)
    const sets = core().setsIn(orig, swaps).filter((x) => x.blocks.length > 1).slice(0, 6);
    const setRow = (set) => {
      const btn = h('button.btn.bd-swap.bd-setkey', { type: 'button', 'aria-expanded': 'false', onclick: () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        closePickers();
        if (open) return;
        btn.setAttribute('aria-expanded', 'true');
        btn.after(setPicker(key, set));
      } },
      core().blockIcon(set.icon, { size: 24 }),
      h('span.bd-swap-txt', h('span.bd-swap-name', set.label), h('span.bd-swap-was', core().KIND_LABEL[set.kind] + ' · ' + set.blocks.length + ' kinds of block')),
      h('span.bd-swap-n', fmtN(set.n)), glyph('swap', 'bd-swap-ico'));
      return tip(btn, () => [h('div.th-tooltip-title', 'Change every ' + set.label + ' block at once'), h('div.th-tooltip-sub', set.blocks.slice(0, 6).map((b) => core().nameOf(b.id)).join(', ') + (set.blocks.length > 6 ? ' …' : ''))]);
    };
    const name = keyName(key), cur = effective(key);
    // what the downloads carry besides blocks (or why a file has none of it)
    const xm = cur && core().hasExtras(cur) ? core().extrasSummary(cur) : null;
    const extra = !xm && key.startsWith('file:') && cur && cur.palette.some((p) => ENTITY_DATA.test(core().parse(p).name))
      ? h('p.bd-note.bd-faint', 'This file came without container contents or sign text, so the downloads have none either.')
      : xm ? h('p.bd-note.bd-faint', 'Container contents, sign text' + (xm.entities ? ', entities' : '') + ' and the build’s facing and position are in every file.'
        + (xm.lost ? ' ' + plural(xm.lost, 'block', 'blocks') + ' lost what they held in a swap.' : '') + (xm.ticks ? ' .schem leaves out the ' + plural(xm.ticks, 'scheduled tick', 'scheduled ticks') + '.' : '')) : null;
    const dl = (fmt) => () => exportAs(effective(key), fmt, name + (n ? '-custom' : ''));
    const panel = h('section.panel.bd-pan.bd-custom-panel' + (n ? '.has-sel' : ''), { 'aria-label': 'Customise blocks' },
      h('div.bd-pan-head', h('h3', 'Customise blocks'), n ? h('span.bd-count', n + ' swapped') : h('span.bd-count', 'your version')),
      free.length ? h('p.bd-note', 'Swap building blocks for ones you like. The parts that make it work stay as they are.') : h('p.bd-note', 'Every block here is part of the mechanism, so nothing can be swapped.'),
      sets.length ? h('div.bd-sub', 'Whole sets') : null,
      sets.length ? h('div.bd-swaps.bd-sets', sets.map(setRow)) : null,
      free.length && sets.length ? h('div.bd-sub', 'Single blocks') : null,
      h('div.bd-swaps', free.map(mkRow)),
      locked.length ? h('div.bd-sub', 'Keeps working only with these') : null,
      locked.length ? h('div.bd-locks', locked.map(lockRow)) : null,
      h('div.bd-sub', 'Download'),
      h('p.bd-note', n ? 'The file is your version: every swap applied, every block keeps its facing, half, open and waterlogged state.' : 'The file is the build as you see it.'),
      extra,
      h('div.bd-actions',
        tip(h('button.btn.small.primary', { type: 'button', onclick: dl('schem') }, glyph('down'), n ? 'Download with your changes' : 'Download .schem'), '.schem (Sponge 2): WorldEdit, FAWE, Axiom, Litematica'),
        tip(h('button.btn.small', { type: 'button', onclick: dl('litematic') }, '.litematic'), 'Litematica schematic' + (n ? ', with your changes' : '')),
        tip(h('button.btn.small', { type: 'button', onclick: dl('json') }, 'JSON'), 'This toolbox’s own format' + (n ? ', with your changes' : ''))),
      n ? h('div.bd-actions',
        tip(h('button.btn.small', { type: 'button', onclick: () => exportAs(original(key), 'schem', name) }, glyph('down'), 'Original .schem'), 'The build as designed, without your swaps'),
        h('button.btn.small', { type: 'button', onclick: () => { save((b) => { delete b.swaps[key]; }); show(key, { keepView: true }); patch(); toast('Back to the original blocks'); } }, glyph('reset'), 'Reset to original')) : null);
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
  /** Replace the whole swap map of a build (whole-set swaps, the Material List). */
  function setSwaps(key, map) {
    save((b) => { if (map && Object.keys(map).length) b.swaps[key] = Object.assign({}, map); else delete b.swaps[key]; });
    if (UI && UI.wrap.isConnected && UI.shownKey === key) { show(key, { keepView: true }); patch(); }
  }
  /** One set picked: every other wood type (stone, colour, copper stage) as a tile, then what changes, with counts. */
  function setPicker(key, set) {
    const orig = original(key), swaps = S().swaps[key] || {};
    const top = set.blocks.slice().sort((a, b) => b.n - a.n)[0];
    const preview = h('div.bd-plan', h('p.bd-note', 'Pick one to see what changes.'));
    let chosen = null;
    const tiles = core().setTokens(set.kind).filter((tk) => tk !== set.token).map((tk) => {
      const plan = core().setPlan(orig, swaps, set.kind, set.token, tk);
      const rep = core().setName(set.kind, tk, top.role);
      const icon = rep ? 'minecraft:' + rep : core().setIcon(set.kind, tk);
      const b = h('button.btn.bd-pick-tile', { type: 'button', 'aria-pressed': 'false', 'aria-label': core().setLabel(set.kind, tk), disabled: !plan.kinds, onclick: () => pick(tk, plan, b) }, core().blockIcon(icon, { size: 24 }));
      return tip(b, () => [h('div.th-tooltip-title', core().setLabel(set.kind, tk)), h('div.th-tooltip-sub', plan.kinds ? plan.kinds + ' of ' + set.blocks.length + ' kinds change · ' + fmtN(plan.blocks) + ' blocks' : 'Nothing here has a ' + core().setLabel(set.kind, tk) + ' version'), plan.note ? h('div.th-tooltip-sub', plan.note) : null].filter(Boolean));
    });
    const line = (from, to, nn, why) => h('div.bd-plan-row' + (to ? '' : '.stay'), core().blockIcon(from, { size: 20 }), h('span.bd-plan-name', core().nameOf(from)),
      to ? [glyph('right', 'bd-plan-arr'), core().blockIcon(to, { size: 20 }), h('span.bd-plan-name.bd-plan-new', core().nameOf(to))] : h('span.bd-plan-why', why), h('span.bd-swap-n', fmtN(nn)));
    function pick(tk, plan, btn) {
      chosen = tk;
      tiles.forEach((t) => { const on = t === btn; t.classList.toggle('on', on); t.setAttribute('aria-pressed', String(on)); });
      const apply = h('button.btn.small.primary', { type: 'button', onclick: () => {
        setSwaps(key, core().withChanges(orig, S().swaps[key] || {}, plan.change));
        if (!UI.wrap.isConnected || UI.shownKey !== key) patch();
        toast(plan.kinds + (plan.kinds === 1 ? ' kind of block is now ' : ' kinds of block are now ') + core().setLabel(set.kind, chosen));
      } }, 'Change ' + plan.kinds + (plan.kinds === 1 ? ' kind' : ' kinds') + ' · ' + fmtN(plan.blocks) + ' blocks');
      preview.replaceChildren(...[
        h('div.bd-plan-rows.th-scroll', plan.change.map((c) => line(c.from, c.to, c.n)), plan.stay.map((x) => line(x.id, null, x.n, x.why))),
        plan.note ? h('p.bd-note.bd-plan-note', plan.note) : null,
        h('div.bd-actions', apply, h('button.btn.small', { type: 'button', onclick: () => { closePickers(); } }, 'Cancel'))].filter(Boolean));
    }
    const el = h('div.bd-picker.bd-setpick', { role: 'dialog', 'aria-label': 'Change every ' + set.label + ' block' },
      h('p.bd-note', 'Every ' + set.label + ' block changes at once. Facing, open, half and the rest stay as they are.'),
      h('div.bd-pick-grid', tiles), preview);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const k = el.previousElementSibling; closePickers(); if (k) k.focus(); } });
    return el;
  }

  /** Compact block picker: search + grouped tiles with real textures. */
  function blockPicker(o) {
    const field = h('input.field.bd-pick-search', { type: 'search', placeholder: 'Search blocks', 'aria-label': 'Search blocks', autocomplete: 'off', spellcheck: false });
    const body = h('div.bd-pick-body.th-scroll');
    const G = core().GROUPS, ord = core().GROUP_ORDER;
    const origName = o.original ? core().parse(o.original).name : null, origBurns = origName ? core().burns(origName) : null;
    function fill() {
      const q = field.value.trim().toLowerCase();
      const ids = o.ids.filter((n) => !q || core().nameOf('minecraft:' + n).toLowerCase().includes(q) || n.includes(q.replace(/ /g, '_')));
      const groups = new Map();
      ids.forEach((n) => { const g = core().def('minecraft:' + n).grp || 'misc'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); });
      const out = [];
      [...groups.keys()].sort((a, b) => ord.indexOf(a) - ord.indexOf(b)).forEach((g) => {
        out.push(h('div.bd-pick-grp', G[g] || g));
        out.push(h('div.bd-pick-grid', groups.get(g).map((n) => {
          const id = 'minecraft:' + n, on = core().parse(o.current).name === n, orig = origName === n;
          const fire = origName && !orig && core().burns(n) !== origBurns ? (origBurns ? 'Does not burn' : 'Burns: keep it away from lava and fire') : null;
          const b = h('button.btn.bd-pick-tile' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), 'aria-label': core().nameOf(id), onclick: () => o.onPick(id) }, core().blockIcon(id, { size: 24 }), orig ? h('span.bd-pick-orig', { 'aria-hidden': 'true' }) : null);
          return tip(b, () => [h('div.th-tooltip-title', core().nameOf(id)), orig ? h('div.th-tooltip-sub', 'The original block') : null, fire ? h('div.th-tooltip-sub', fire) : null].filter(Boolean));
        })));
      });
      body.replaceChildren(...(out.length ? out : [h('p.bd-note', 'No block matches “' + field.value + '”.')]));
    }
    field.addEventListener('input', fill);
    fill();
    const el = h('div.bd-picker', { role: 'dialog', 'aria-label': o.label || 'Pick a block' }, o.note ? h('p.bd-note', o.note) : null, o.ids.length > 12 ? h('div.bd-pick-top', field) : null, body);
    setTimeout(() => { if (el.isConnected && matchMedia('(hover: hover)').matches) field.focus({ preventScroll: true }); }, 30);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.remove(); UI.side.querySelectorAll('[aria-expanded="true"]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.focus(); }); } });
    return el;
  }

  /* ---- files you open ---- */
  async function openFile(f, opts) {
    if (!ready) return;
    if (B().mats.isText(f)) { B().mats.importFile(f); return; }   // a .txt / .csv material list
    opts = opts || {};
    toast('Reading ' + f.name + '…');
    try {
      const s = await B().io.load(f);
      if (!s.name || /^(unnamed|untitled|schematic|structure|default|template|new)$/i.test(String(s.name).trim())) {
        // "castle_final-v2.litematic" -> "Castle Final V2" (shortened to 36 characters)
        let n = f.name.replace(/\.[^.]+$/, '').replace(/[_\-+.]+/g, ' ').replace(/\s+/g, ' ').trim();
        n = n.replace(/\b([a-z])/g, (m) => m.toUpperCase());
        s.name = (n.length > 36 ? n.slice(0, 35).trim() + '…' : n) || 'Imported build';
      }
      const id = TH.util.uid('f');
      mem.files.set(id, s);
      let kept = true;
      const data = core().rle(s.blocks);
      // container contents, sign text, entities and the file's metadata go into the saved state too (packed)
      const x = core().extrasOf(s);
      let xz = null;
      if (Object.keys(x).length) { try { xz = await packX(x); mem.extras.set(id, x); } catch (e) { xz = ''; } }
      save((b) => {
        b.files = b.files || [];
        if (data.length <= FILE_CAP && (xz == null || (xz && xz.length <= XZ_CAP))) {
          const rec = { id, name: s.name, size: s.size.slice(), palette: s.palette.slice(), data, added: Date.now(), declared: s.declared || 0 };
          if (xz) rec.xz = xz;
          b.files.unshift(rec);
          while (b.files.length > MAX_FILES) { const old = b.files.pop(); mem.extras.delete(old.id); delete b.swaps['file:' + old.id]; delete b.ticks['file:' + old.id]; }
        } else kept = false;
      });
      if (!kept) {
        // session only: show it under Your builds until the page reloads
        mem.sessionOnly = mem.sessionOnly || [];
        mem.sessionOnly.unshift({ id, name: s.name, size: s.size.slice(), session: true });
      }
      if (opts.mats) {   // opened from the Materials tool: it becomes its source, and it waits on the Builds stage and in the Library
        save((b) => { b.cur = 'file:' + id; b.stage = 'file:' + id; b.browse = false; b.section = 'library'; b.matSrc = 'file:' + id; });
        if (UI && UI.wrap.isConnected) { show('file:' + id, { layer: 'top' }); patch(); }
        if (opts.done) opts.done();
      } else pickKey('file:' + id);
      const unknown = s.palette.filter((p, i) => i && !core().known(p)).length;
      const m = core().hasExtras(s) ? core().extrasSummary(s) : null;
      const inside = m ? [m.filled ? m.filled + (m.filled === 1 ? ' container' : ' containers') + ' with items' : '', m.signs.length ? m.signs.length + (m.signs.length === 1 ? ' sign' : ' signs') : '', m.entities ? m.entities + (m.entities === 1 ? ' entity' : ' entities') : ''].filter(Boolean).join(', ') : '';
      toast('Opened ' + s.name + ' · ' + fmtN(core().volume(s)) + ' blocks' + (inside ? ' · ' + inside : '') + (unknown ? ' · ' + unknown + ' unknown block type' + (unknown > 1 ? 's' : '') : '') + (kept ? '' : ' · too big to keep after a reload'));
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
  /**
   * Re-build the shape on the stage after a setting changed. While a slider moves (live) it waits a little (big builds
   * take a moment to generate and mesh); on release it builds right away. The camera stays where it is.
   */
  let regenT = 0, regenR = 0;
  function regen(live) {
    clearTimeout(regenT); cancelAnimationFrame(regenR);
    const run = () => {
      if (inMake()) return;
      const t0 = performance.now();
      if (UI.shownKey === 'shape' || S().section === 'create') show('shape', { keepView: true, layer: 'top' });
      const sch = original('shape'), sz = UI.createSize;
      if (sz && sch) sz.textContent = sch.size.join(' × ') + ' · ' + fmtN(core().volume(sch)) + ' blocks' + (performance.now() - t0 > 600 ? ' · ' + Math.round(performance.now() - t0) + ' ms' : '');
    };
    if (live) regenT = setTimeout(() => { regenR = requestAnimationFrame(run); }, 140); else regenR = requestAnimationFrame(run);
  }
  /** What builds-create.js and builds-editor.js get to work with. */
  let CTX = null;
  function ctx() {
    if (CTX) return CTX;
    CTX = {
      S, save, show, regen, glyph, GLYPH, tip, press, blockPicker, exportAs, toMats, fmtN, toast, effective, original,
      patch: () => patch(), UI: () => UI, V: () => V, keep: keepSchem, genArt: shapeArt, basicSchem: () => shapeSchem(), basicBlocks: () => blocksPanel(),
      closePickers: () => closePickers(),
      /** Hold to compare: the build as it came (block swaps kept, no size, angle or light) while on, then back. */
      peek: (key, on) => {
        if (!V || !V.ready || UI.shownKey !== key) return;
        if (!on) { if (UI.peeking) { UI.peeking = false; show(key, { keepView: true }); } return; }
        if (UI.peeking) return;
        const s = original(key), sw = S().swaps[key];
        if (!s) return;
        UI.peeking = true;
        V.setSchematic(sw && Object.keys(sw).length ? core().applySwaps(s, sw) : s, { keepView: true, keepZoom: true, layer: 'top' });
      },
      replay: () => { if (V) { if (S().mode === 'still') setMode('once'); V.replay(); } },
      edit: (s) => { if (!s) return; save((b) => { b.section = 'create'; b.createMode = 'make'; }); B().editorUI.drop(ctx(), s); if (V && V.ready) B().editorUI.enter(ctx()); patch(); toast('Opened ' + s.name + ' in Make it myself'); },
    };
    return CTX;
  }
  function createSide() {
    const mode = S().createMode === 'make' ? 'make' : 'gen';
    const btns = [['gen', 'Generate', 'Shapes made from settings: crystals, monoliths, nature and more'], ['make', 'Make it myself', 'Build by hand with tools: boxes, spheres, lines, fill, copy, mirror, undo']].map(([id, label, t]) => tip(h('button', { type: 'button', role: 'radio', 'aria-checked': String(mode === id), class: mode === id ? 'on' : null, onclick: () => go('create', id) }, label), t));
    const seg = h('div.seg.bd-cmode', { role: 'radiogroup', 'aria-label': 'Create mode' }, btns);
    const body = mode === 'make' ? B().editorUI.side(ctx()) : B().createUI.side(ctx());
    return [h('div.bd-cmodebar', seg)].concat(body);
  }
  /** The block keys of a classic shape (main block, and leaves / floor / caps when it has a second one), for its Blocks tab. */
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
          regen(); patch();
        } }));
      } }, core().blockIcon(cur, { size: 24 }), h('span.bd-swap-txt', h('span.bd-swap-name', core().nameOf(cur)), h('span.bd-swap-was', label)), glyph('swap', 'bd-swap-ico'));
      return btn;
    };
    return h('div.bd-swaps.bd-blocks-panel', row(1, kind === 'tree' ? 'Logs' : 'Main block'), second ? row(2, lbl2) : null);
  }
  /** Keep a build (the shape, your hand-made build) in the Library as one of your files. */
  function keepSchem(src) {
    const s = core().clone(src);
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
  // The material list is its own tool (js/modules/materials.js, UI in builds-mats.js); TH.builds.api is its window onto
  // Builds: the lazy loader, the shared state.builds, the schematics by key, and the way back to the 3D stage.
  function matSources() {
    const st = S();
    const farms = B().farms.FARMS.map((f) => ({ key: 'farm:' + f.id, name: f.name, icon: f.icon, kind: f.cat || 'farm' }));
    const recs = (mem.sessionOnly || []).filter((r) => mem.files.has(r.id)).concat(st.files || []);
    const yours = recs.map((r) => ({ key: 'file:' + r.id, name: (st.meta['file:' + r.id] || {}).name || r.name, icon: null, kind: 'yours' }));
    let shape = null, made = null;
    try { shape = { key: 'shape', name: original('shape').name, icon: null, kind: 'shape' }; } catch (e) { /* no shape yet */ }
    try { const e = B().editorUI && B().editorUI.out(); if (e && core().volume(e)) made = { key: 'edit', name: e.name || 'My build', icon: null, kind: 'shape' }; } catch (e) { /* nothing built by hand yet */ }
    return yours.concat(shape ? [shape] : [], made ? [made] : [], farms);
  }
  TH.builds.api = {
    load: () => loadAll(), isReady: () => ready, loadError: () => loadErr,
    S, save, effective, original, keyName, glyph, sources: matSources, openFile, download: downloadBlob,
    /** The user's block swaps of a build ({ original base: shown base }); setSwaps replaces them (the stage follows). */
    swaps: (key) => Object.assign({}, S().swaps[key] || {}), setSwaps,
    /** Builds that can take swaps (the shape generator has its own block keys instead). */
    swappable: (key) => /^(farm|file):/.test(key || ''),
    /** The block count a .litematic header claims for a kept file (0 when unknown). */
    declared(key) { if (!key || !key.startsWith('file:')) return 0; const id = key.slice(5), m = mem.files.get(id), r = fileRec(id); return (m && m.declared) || (r && r.declared) || 0; },
    /** The build last on the Builds stage (what "stage" means as a material list source). */
    stageKey: () => (UI && UI.wrap.isConnected && UI.shownKey) || S().stage || S().cur,
    /** Show this build on the Builds stage (the shape opens in Create). */
    view3d(key) {
      save((b) => {
        if (key === 'shape') { b.section = 'create'; b.createMode = 'gen'; b.stage = 'shape'; }
        else if (key === 'edit') { b.section = 'create'; b.createMode = 'make'; }
        else if (/^(farm|file):/.test(key)) { b.cur = key; b.stage = key; b.section = 'library'; b.browse = false; }
      });
      location.hash = '#/builds';
    },
  };
  /** Open the Materials tool with this build / list as the source (the 'Material list' keys around Builds). */
  function toMats(key) {
    save((b) => { b.matSrc = key; });
    location.hash = '#/materials';
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
      if (!b.fopt || typeof b.fopt !== 'object' || Array.isArray(b.fopt)) b.fopt = {};
      ['swaps', 'ticks', 'shape'].forEach((k) => { if (!b[k] || typeof b[k] !== 'object') b[k] = structuredClone(DEFAULTS[k]); });
      ['p', 'block', 'block2'].forEach((k) => { if (!b.shape[k] || typeof b.shape[k] !== 'object') b.shape[k] = {}; });
      // Create (Oct 30 2026): generator groups, Make it myself, per-build angle and light
      if (typeof b.shape.kind !== 'string') b.shape.kind = 'crystal';
      ['make', 'xf'].forEach((k) => { if (!b[k] || typeof b[k] !== 'object' || Array.isArray(b[k])) b[k] = {}; });
      if (!['gen', 'make'].includes(b.createMode)) b.createMode = 'gen';
      if (!Array.isArray(b.files)) b.files = [];
      if (!['library', 'create'].includes(b.section)) b.section = 'library';   // 'materials' moved out into its own tool
      if (typeof b.cur !== 'string' || !/^(farm|file):/.test(b.cur)) b.cur = 'farm:cow_crusher';
      if (b.cur.startsWith('file:') && !b.files.some((f) => 'file:' + f.id === b.cur)) b.cur = 'farm:cow_crusher';
      if (typeof b.stage !== 'string' || (b.stage.startsWith('file:') && !b.files.some((f) => 'file:' + f.id === b.stage))) b.stage = b.cur;
      if (!['loop', 'once', 'still'].includes(b.mode)) b.mode = 'once';
      if (!(b.v >= 2)) { if (b.mode === 'loop') b.mode = 'once'; }   // looping used to be the default; now it is opt-in
      if (!(b.v >= 3)) { b.browse = true; b.v = 3; }   // the Library opens as a browser first
      if (!b.meta || typeof b.meta !== 'object') b.meta = {};
      if (!b.lib || typeof b.lib !== 'object') b.lib = structuredClone(DEFAULTS.lib);
      // materials (v4): saved lists, have counts, list options; the one old pasted list becomes a saved list once
      if (!Array.isArray(b.lists)) b.lists = [];
      if (!b.have || typeof b.have !== 'object') b.have = {};
      b.mats = Object.assign(structuredClone(DEFAULTS.mats), b.mats && typeof b.mats === 'object' ? b.mats : {});
      if (!b.mats.pick || typeof b.mats.pick !== 'object') b.mats.pick = {};
      if (!['items', 'stacks', 'boxes', 'dc'].includes(b.units)) b.units = 'items';
      if (!['count', 'name', 'group'].includes(b.sort)) b.sort = 'count';
      if (!(b.v >= 4)) {
        const txt = b.paste && typeof b.paste.text === 'string' ? b.paste.text : '';
        if (txt.trim()) {
          const id = TH.util.uid('l');
          b.lists.unshift({ id, name: 'Pasted list', text: txt, at: b.paste.at || Date.now() });
          if (b.ticks.paste) { b.ticks['list:' + id] = b.ticks.paste; }
          if (b.matSrc === 'paste') b.matSrc = 'list:' + id;
        }
        delete b.ticks.paste;
        b.paste = null;
        b.v = 4;
      }
      if (typeof b.matSrc !== 'string' || b.matSrc === 'paste') b.matSrc = 'stage';
    },
    render,
  });
})();
