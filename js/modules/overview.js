/**
 * Overview — the landing page (route "#/" or no hash). A hidden module: reachable via the logo, not a nav tab.
 *
 * One fixed-height stage (no page scroll) split into five equal panes, one per tool (Enchanting first). Every pane
 * carries its own little living diorama built from real Minecraft textures (TH.icon / TH.icon.tex) plus CSS:
 *   Enchanting = enchanting table between bookshelves, a floating glinting book, a rune ring orbiting it and
 *                galactic glyphs streaming from the shelves into the book (like the real table particles).
 *   Potion Brewing = a brewing stand with three potions bobbing over it and coloured bubbles rising.
 *   Trading Hall = a villager watching emeralds arc from an emerald block over to an enchanted book on a shelf.
 *   Trims = a hand of smithing templates fanned behind a diamond chestplate, trim materials gliding past below.
 *   Builds = a little house that assembles itself block by block on a blueprint grid, then dissolves and rebuilds.
 *   Portal = an obsidian frame with the real animated portal texture, tilting with the pointer, between two
 *            coordinate readouts (Overworld / Nether) that keep converting.
 * Everything is DOM built once + CSS keyframes on transform / opacity (GPU), so the stage paints and moves at once.
 * The pane under the pointer (or focused / tapped) swells open (flex-grow) and shows the pitch, a live stat and the CTA;
 * its diorama slides to the right and grows; the pointer drives a soft light and per-layer parallax.
 * Touch: tap focuses a pane, tap again opens the tool. Keys 1-6 jump to a tool, arrows move between panes.
 * Live stats come from each module's badge(state).
 */
(function () {
  /** TH.util.h, but its style object may also carry custom properties ('--x'), which Object.assign would drop */
  const h = (sel, attrs, ...kids) => {
    const st = attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs) && attrs.style;
    if (!st || typeof st !== 'object') return TH.util.h(sel, attrs, ...kids);
    const el = TH.util.h(sel, Object.assign({}, attrs, { style: undefined }), ...kids);
    for (const k in st) { if (st[k] == null) continue; if (k.startsWith('--')) el.style.setProperty(k, String(st[k])); else el.style[k] = st[k]; }
    return el;
  };
  const tex = (p) => TH.icon.tex(p);
  // Standard Galactic Alphabet look-alikes (the enchanting table script); kept to widely available glyphs
  const SGA = Array.from('ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ᒲリ∷ᓭℸ⚍⍊∴');

  const TOOLS = [
    { id: 'enchanting', line: 'Books, anvil order and XP for every item.', kicker: 'Gear & books', wall: 'block/bookshelf',
      pitch: 'Plan every enchanted item. See exactly which books you still need and tick the anvil steps off one by one.',
      points: ['Cheapest anvil order', 'Books to get, per item', 'Level and XP costs'], unit: 'items done' },
    { id: 'potions', line: 'Every potion, and how to brew it.', kicker: 'Brewing', wall: 'block/nether_bricks',
      pitch: 'Find any potion by name, effect or ingredient, see the brewing chain step by step and plan a whole brewing session.',
      points: ['Every potion in every form', 'Brewing chains drawn out', 'Planner with a shopping list'], unit: '' },
    { id: 'hall', line: 'Plan the hall and price every librarian.', kicker: 'Villager trading', wall: 'block/spruce_planks',
      pitch: 'Lay out your trading hall, price the emeralds and lock in every librarian.',
      points: ['Hall planner canvas', 'Book lists per librarian', 'Emerald totals'], unit: 'librarians' },
    { id: 'trims', line: 'Every armor trim, live in 3D.', kicker: 'Armor trims', wall: 'block/deepslate_tiles',
      pitch: 'Dress a 3D character in any armor and trim, piece by piece, then get the shopping list.',
      points: ['Live 3D preview', 'Every pattern and material', 'Skins and saved outfits'], unit: 'templates' },
    { id: 'builds', line: 'Farms and builds in 3D, block by block.', kicker: 'Build planning', wall: 'block/bricks',
      pitch: 'Look at farms and builds in 3D, open your own schematics and shape domes, spheres and towers.',
      points: ['3D viewer, layer by layer', 'Your own schematics', 'Shape generator'], unit: '' },
    { id: 'materials', line: 'Every block, packed into shulker boxes.', kicker: 'Material lists', wall: 'block/barrel_side',
      pitch: 'Paste a Litematica list or pick a build: recipes, raw materials and how it all packs into shulker boxes.',
      points: ['Litematica lists read as is', 'Recipes drawn like the game', 'Shulker box packing'], unit: '' },
    { id: 'palettes', line: 'Block palettes that belong together.', kicker: 'Block palettes', wall: 'block/pink_concrete',
      pitch: 'Pick blocks that look good together. Browse 140 palettes, or build your own from the real block colours.',
      points: ['140 ready-made palettes', 'Matching blocks from real colours', 'Live mosaic preview'], unit: '' },
    { id: 'portal', line: 'Overworld and Nether, lined up.', kicker: 'Nether travel', wall: 'block/netherrack',
      pitch: 'Convert coordinates between the Overworld and the Nether and line your portals up.',
      points: ['Overworld and Nether', 'Linked portal finder', 'Portal map'], unit: '' },
  ];

  function readStat(mod, state) {
    let b = null;
    try { b = mod && mod.badge && mod.badge(state); } catch (e) { /* stats are a bonus */ }
    if (b && typeof b === 'string') { const m = b.match(/^(\d+)\s*\/\s*(\d+)$/); b = m ? { done: +m[1], total: +m[2] } : null; }
    return b && typeof b === 'object' && b.total ? b : null;
  }
  const statEl = (b, unit) => h('div.lp-stat',
    h('span.lp-bar', h('span', { style: { width: Math.min(100, (b.done / b.total) * 100) + '%' } })),
    h('span.lp-stat-n', h('b', b.done), ' / ' + b.total + (unit ? ' ' + unit : '')));

  /* ---------------- diorama helpers (scene box = 360 x 360 css px, scaled as a whole) ---------------- */
  const px = (n) => n + 'px';
  /** a parallax layer: --d = how far it drifts with the pointer (px) */
  const layer = (d, ...kids) => h('div.lp-l', { style: { '--d': d } }, ...kids);
  /** absolutely placed wrapper */
  const at = (x, y, cls, kids, style) => h('div.lp-at' + (cls || ''), { style: Object.assign({ left: px(x), top: px(y) }, style) }, kids);
  /**
   * Isometric block made of three textured faces (2D matrices, no 3D context needed).
   * s = edge length, hgt = height as a share of s (the enchanting table is 12/16 tall); x,y = top-left of its box.
   */
  function cube(s, faces, x, y, o) {
    o = o || {};
    const face = (cls, key) => h('i.lp-face.' + cls, { style: { backgroundImage: `url("${tex(key)}")` } });
    return h('span.lp-cube' + (o.cls || ''), { style: Object.assign({ '--cs': px(s), '--ch': o.hgt || 1, left: px(x), top: px(y) }, o.style) },
      face('ft', faces.top), face('fl', faces.left || faces.side), face('fr', faces.right || faces.side));
  }

  function sceneEnchanting() {
    const ring = SGA.slice(0, 14).map((g, i) => h('span.lp-orb', { style: { '--o': (-(i / 14) * 18).toFixed(2) + 's' } }, h('span.lp-orb-y', g)));
    const flow = Array.from({ length: 10 }, (_, i) => {
      const left = i % 2 === 0;
      return h('span.lp-flow', { style: { '--x0': px(left ? 52 : 308), '--y0': px(178 + (i % 5) * 12), '--x1': px(176 + (i % 3) * 4), '--y1': px(158),
        '--t': (2.8 + (i % 4) * 0.45).toFixed(2) + 's', '--o': (-i * 0.62).toFixed(2) + 's' } }, h('span', SGA[(i * 7) % SGA.length]));
    });
    const shelf = (x, y) => cube(36, { top: 'block/oak_planks', side: 'block/bookshelf' }, x, y, { cls: '.lp-dim' });
    return [
      layer(4, h('div.lp-rays')),
      layer(8, shelf(14, 196), shelf(14, 160), shelf(284, 196), shelf(284, 160)),
      layer(14, cube(80, { top: 'block/enchanting_table_top', side: 'block/enchanting_table_side' }, 111, 200, { hgt: 0.75 })),
      layer(20, h('div.lp-ring', ring), h('div.lp-flows', flow),
        at(132, 92, '.lp-book', h('div.lp-bob', TH.icon('enchanted_book', { size: 96, glint: true })))),
    ];
  }

  function scenePotions() {
    // a brewing stand with three potions bobbing over its arms and bubbles in potion colours rising from it
    const B = (TH.potions && TH.potions.bottle) || ((id, f, size) => TH.icon('item/potion', { size }));
    const cols = ['#33ebff', '#f82423', '#cd5cab', '#ffc700', '#c2ff66', '#8d82e6'];
    const bubs = Array.from({ length: 14 }, (_, i) => h('span.lp-pbub', { style: { left: px(150 + ((i * 29) % 64)), '--c': cols[i % cols.length], '--o': (-i * 0.41).toFixed(2) + 's', '--dx': px(((i * 17) % 50) - 25), '--z': px(5 + (i % 3) * 3) } }));
    const pots = [['swiftness', 44, 112], ['strong_healing', 148, 44], ['regeneration', 252, 112]].map(([id, x, y], i) =>
      at(x, y, '.lp-ppot', h('div.lp-bob', { style: { animationDelay: (-i * 1.3).toFixed(1) + 's' } }, B(id, 'potion', 64))));
    return [
      layer(4, h('div.lp-halo')),
      layer(10, at(116, 152, '.lp-pstand', TH.icon('item/brewing_stand', { size: 128 }))),
      layer(18, ...pots),
      layer(24, h('div.lp-pbubs', bubs)),
    ];
  }

  function sceneHall() {
    const happy = [[96, 66], [262, 52], [250, 128], [110, 140], [180, 22], [296, 92]].map(([x, y], i) =>
      at(x, y, '.lp-happy', null, { '--o': (-i * 0.55).toFixed(2) + 's' }));
    const coins = [0, 1, 2].map((i) => h('span.lp-coin', { style: { '--o': (-i * 0.9).toFixed(2) + 's' } }, h('span.lp-coin-y', h('span.lp-coin-r', TH.icon('emerald', { size: 30 })))));
    return [
      layer(5, h('div.lp-halo')),
      layer(9, at(134, 34, '.lp-vil', [h('span.lp-tag', 'Librarian'), h('span.lp-face-vil', { style: { backgroundImage: `url("${tex('entity/villager/villager')}")` } })]), ...happy),
      layer(15, cube(56, { top: 'block/emerald_block', side: 'block/emerald_block' }, 24, 224), cube(56, { top: 'block/oak_planks', side: 'block/bookshelf' }, 239, 224)),
      layer(22, at(42, 158, '.lp-stack', [h('div.lp-bob', TH.icon('emerald', { size: 56 })), h('b.lp-count', '24')]),
        at(256, 150, '.lp-tradebook', h('div.lp-pulse', TH.icon('enchanted_book', { size: 64, glint: true }))),
        h('div.lp-coins', coins)),
    ];
  }

  function sceneTrims() {
    const fan = ['wild', 'coast', 'sentry', 'dune', 'spire'].map((p, i) => h('span.lp-card', { style: { '--r': ((i - 2) * 19) + 'deg', '--i': i } },
      TH.icon.trim(p, { size: 76 }), p === 'sentry' ? h('span.lp-sheen', { style: { '--mask': `url("${TH.icon.src('item/sentry_armor_trim_smithing_template')}")` } }) : null));
    const mats = ['Iron Ingot', 'Copper Ingot', 'Gold Ingot', 'Lapis Lazuli', 'Emerald', 'Diamond', 'Netherite Ingot', 'Redstone Dust', 'Amethyst Shard', 'Nether Quartz', 'Resin Brick'];
    const run = () => mats.map((m) => h('span.lp-mat', TH.icon.trimMaterial(m, { size: 30 })));
    const twinkles = [[60, 70], [292, 60], [318, 196], [40, 214], [214, 30]].map(([x, y], i) => at(x, y, '.lp-twinkle', null, { '--o': (-i * 0.8).toFixed(2) + 's' }));
    return [
      layer(4, h('div.lp-halo'), ...twinkles),
      layer(10, h('div.lp-fan', fan)),
      layer(18, at(130, 166, '.lp-chest', h('div.lp-bob', TH.icon('diamond_chestplate', { size: 100 })))),
      layer(26, h('div.lp-mats', h('div.lp-mats-run', run(), run()))),
    ];
  }

  function sceneBuilds() {
    const s = 34, ox = 180, oy = 132;   // iso origin of grid corner (0,0,0) inside the scene box
    const P = 'block/oak_planks', L = { top: 'block/oak_log_top', side: 'block/oak_log' }, G = 'block/glass', C = 'block/cobblestone';
    const plan = [];
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) plan.push([gx, gy, 0, C]);
    [[0, 0, L], [1, 0, P], [2, 0, L], [0, 1, P], [0, 2, L]].forEach(([gx, gy, t]) => plan.push([gx, gy, 1, t]));
    [[0, 0, L], [1, 0, G], [2, 0, L], [0, 1, G], [0, 2, L]].forEach(([gx, gy, t]) => plan.push([gx, gy, 2, t]));
    [[0, 0, P], [1, 0, P], [2, 0, P], [0, 1, P], [0, 2, P]].forEach(([gx, gy, t]) => plan.push([gx, gy, 3, t]));
    plan.push([2, 2, 1, { top: 'block/crafting_table_top', left: 'block/crafting_table_front', right: 'block/crafting_table_side' }]);
    const blocks = plan.map(([gx, gy, gz, t], i) => {
      const faces = typeof t === 'string' ? { top: t, side: t } : t;
      const x = ox + (gx - gy) * 0.866 * s - 0.866 * s, y = oy + (gx + gy) * 0.5 * s - gz * s - s;
      return cube(s, faces, Math.round(x * 10) / 10, Math.round(y * 10) / 10, { cls: '.lp-drop' + (i === plan.length - 1 ? '.lp-last' : ''), style: { zIndex: gx + gy + gz, '--i': i } });
    });
    return [
      layer(4, h('div.lp-blueprint')),
      layer(14, h('div.lp-house', blocks)),
    ];
  }

  function sceneMaterials() {
    // two shulker boxes on the floor, items rising out of the open one, a slim checklist beside them
    const box = (x, y, s, cls) => cube(s, { top: 'block/shulker_box', side: 'block/shulker_box' }, x, y, { cls });
    const items = ['block/stone_bricks', 'block/oak_planks', 'block/glass', 'item/redstone', 'block/sea_lantern', 'item/iron_ingot'];
    const pops = items.map((t, i) => h('span.lp-mpop', { style: { left: px(120 + (i % 3) * 34), '--o': (-i * 0.75).toFixed(2) + 's', '--dx': px(((i * 23) % 40) - 20) } }, TH.icon(t, { size: 30 })));
    const rows = [0, 1, 2, 3].map((i) => h('span.lp-mrow', { style: { '--o': (-i * 0.9).toFixed(2) + 's' } }, h('i'), h('b')));
    return [
      layer(4, h('div.lp-halo')),
      layer(12, box(36, 196, 60, '.lp-dim'), box(118, 168, 84, '.lp-mbox')),
      layer(20, h('div.lp-mpops', pops)),
      layer(26, h('div.lp-mlist', rows)),
    ];
  }

  function scenePalettes() {
    const sw = ['block/cherry_log', 'block/cherry_planks', 'block/pink_concrete', 'block/white_concrete', 'block/purple_concrete'];
    const swatches = sw.map((t, i) => h('i.lp-sw', { style: { left: px(22 + i * 50), backgroundImage: `url("${tex(t)}")`, '--o': (-i * 0.7).toFixed(2) + 's' } }));
    const cubes = [
      cube(70, { top: 'block/cherry_log_top', side: 'block/cherry_log' }, 28, 96, { cls: '.lp-pcube', style: { '--o': '0s' } }),
      cube(70, { top: 'block/pink_concrete', side: 'block/pink_concrete' }, 150, 66, { cls: '.lp-pcube', style: { '--o': '-1.4s' } }),
      cube(70, { top: 'block/cherry_planks', side: 'block/cherry_planks' }, 86, 150, { cls: '.lp-pcube', style: { '--o': '-2.6s' } }),
    ];
    const spark = [[30, 60], [250, 40], [262, 190], [20, 200], [150, 26]].map(([x, y], i) => at(x, y, '.lp-twinkle', null, { '--o': (-i * 0.8).toFixed(2) + 's' }));
    return [layer(4, h('div.lp-halo'), ...spark), layer(14, ...cubes), layer(22, h('div.lp-swrow', swatches))];
  }

  const COORDS = [[1024, -512], [-2400, 880], [312, 4096], [-60, -1600], [7777, 256]];
  function scenePortal() {
    const B = 40, fx = 100, fy = 22;   // obsidian block size and frame position (4 x 5 blocks)
    const frame = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      if (r > 0 && r < 4 && c > 0 && c < 3) continue;
      const crying = (r === 4 && c === 2) || (r === 0 && c === 0) || (r === 2 && c === 3);
      frame.push(h('i.lp-obs', { style: { left: px(c * B), top: px(r * B), backgroundImage: `url("${tex(crying ? 'block/crying_obsidian' : 'block/obsidian')}")` } }));
    }
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) cells.push(h('i.lp-pcell', { style: { left: px(B + c * B), top: px(B + r * B) } }, h('img', { src: tex('block/nether_portal'), alt: '', draggable: false })));
    const ember = Array.from({ length: 12 }, (_, i) => at(40 + ((i * 53) % 280), 300, '.lp-ember', null, { '--o': (-i * 0.47).toFixed(2) + 's', '--dx': px(((i * 37) % 40) - 20), '--t': (3.4 + (i % 4) * 0.6).toFixed(1) + 's' }));
    const read = (cls, label, key) => at(cls === '.lp-ow' ? 30 : 242, 244, '.lp-read' + cls, [
      h('span.lp-read-k', TH.icon(key, { size: 18 }), label), h('b.lp-x', 'X'), h('b.lp-z', 'Z')]);
    return [
      layer(4, h('div.lp-halo'), ...ember),
      layer(16, h('div.lp-frame-wrap', h('div.lp-frame', { style: { left: px(fx), top: px(fy) } }, frame, cells, h('i.lp-swirl')))),
      layer(24, read('.lp-ow', 'Overworld', 'block/grass_block_side'), read('.lp-ne', 'Nether', 'block/netherrack'),
        at(152, 268, '.lp-ratio', [h('b', '÷8'), h('span', '×8')])),
    ];
  }

  const SCENES = { enchanting: sceneEnchanting, potions: scenePotions, hall: sceneHall, trims: sceneTrims, builds: sceneBuilds, materials: sceneMaterials, palettes: scenePalettes, portal: scenePortal };

  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hovers = () => !!(window.matchMedia && matchMedia('(hover: hover)').matches);
  let keepOpen = -1;   // survives a same-route re-render (no animation), reset on a fresh entry

  function render(root, state) {
    const mods = TH.app.modules;
    const fresh = root.classList.contains('enter');
    if (fresh) keepOpen = -1;
    const trimsOwned = state.trims ? Object.values(state.trims.owned || {}).filter(Boolean).length : 0;
    const items = TOOLS.map((t) => ({ t, mod: mods.find((m) => m.id === t.id) })).filter((x) => x.mod);
    const panes = [];
    let open = -1, hoverTimer = 0;

    const stage = h('div.lp-stage', { role: 'group', 'aria-label': 'Tools' });
    const setOpen = (i) => {
      if (i === open) return;
      open = keepOpen = i;
      stage.classList.toggle('has-open', i >= 0);
      panes.forEach((p, j) => p.classList.toggle('is-open', j === i));
    };

    items.forEach(({ t, mod }, i) => {
      let b = readStat(mod, state);
      if (t.id === 'trims' && trimsOwned && TH.data && TH.data.trimPatterns) b = { done: trimsOwned, total: TH.data.trimPatterns.length };
      const soon = t.soon ? h('em.lp-soon', 'soon') : null;
      const pane = h('a.lp-pane.panel', { href: '#/' + t.id, 'data-tool': t.id, style: { '--i': i }, 'aria-label': mod.name + (t.soon ? ' (coming soon)' : '') + ' - ' + t.kicker },
        h('span.lp-wall', { 'aria-hidden': 'true', style: { backgroundImage: `url("${tex(t.wall)}")` } }),
        h('span.lp-glow', { 'aria-hidden': 'true' }),
        h('div.lp-place', { 'aria-hidden': 'true' }, h('div.lp-scene.lp-scene-' + t.id, SCENES[t.id]())),
        h('div.lp-label', { 'aria-hidden': 'true' },
          h('span.lp-kick', t.kicker, soon),
          h('span.lp-title', mod.name),
          h('span.lp-line', t.line),
          b ? statEl(b, '') : null),
        h('div.lp-detail',
          h('span.lp-kick', { style: { '--k': 0 } }, t.kicker, t.soon ? h('em.lp-soon', 'soon') : null),
          h('h3.lp-name', { style: { '--k': 1 } }, mod.name),
          h('p.lp-pitch', { style: { '--k': 2 } }, t.pitch),
          h('ul.lp-points', { style: { '--k': 3 } }, t.points.map((p) => h('li', p))),
          b ? h('div', { style: { '--k': 4 } }, statEl(b, t.unit)) : null,
          h('span.lp-cta', { style: { '--k': 5 } }, t.soon ? 'Take a look' : 'Open ' + (mod.short || mod.name), h('i', { 'aria-hidden': 'true' }, '→'))));
      pane.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch' || !hovers()) return;
        clearTimeout(hoverTimer); hoverTimer = setTimeout(() => setOpen(i), open < 0 ? 40 : 90);
      });
      pane.addEventListener('focus', () => { if (pane.matches(':focus-visible')) setOpen(i); });
      // touch: the first tap focuses the pane, the second one opens the tool (a mouse click always goes straight in)
      pane.addEventListener('click', (e) => { if (i !== open && (e.pointerType === 'touch' || e.pointerType === 'pen' || !hovers())) { e.preventDefault(); setOpen(i); } });
      panes.push(pane);
    });
    stage.append(...panes);

    stage.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch' || !hovers()) return;
      clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { if (!stage.contains(document.activeElement)) setOpen(-1); }, 260);
    });
    stage.addEventListener('focusout', (e) => { if (!stage.contains(e.relatedTarget) && !stage.matches(':hover')) setOpen(-1); });
    stage.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const at0 = panes.indexOf(document.activeElement);
      if (!k || at0 < 0) return;
      e.preventDefault();
      panes[(at0 + k + panes.length) % panes.length].focus();
    });

    // pointer light + parallax: one rAF-throttled write of four custom properties on the pane under the pointer
    if (!reduced()) {
      let ev = null, raf = 0;
      const apply = () => {
        raf = 0;
        const p = ev && ev.target.closest && ev.target.closest('.lp-pane');
        if (!p) return;
        const r = p.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        p.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        p.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        p.style.setProperty('--px', ((x - 0.5) * 2).toFixed(3));
        p.style.setProperty('--py', ((y - 0.5) * 2).toFixed(3));
      };
      stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; ev = e; if (!raf) raf = requestAnimationFrame(apply); });
      stage.addEventListener('pointerout', (e) => {
        const p = e.target.closest && e.target.closest('.lp-pane');
        if (p && !p.contains(e.relatedTarget)) ['--px', '--py'].forEach((v) => p.style.setProperty(v, '0'));
      });
    }

    // portal readouts keep converting (a text swap every few seconds, no layout work beyond two short strings)
    const ow = stage.querySelector('.lp-ow'), ne = stage.querySelector('.lp-ne');
    if (ow && ne) {
      let k = 0;
      const show = () => {
        const [x, z] = COORDS[k % COORDS.length];
        ow.querySelector('.lp-x').textContent = 'X ' + x; ow.querySelector('.lp-z').textContent = 'Z ' + z;
        ne.querySelector('.lp-x').textContent = 'X ' + Math.floor(x / 8); ne.querySelector('.lp-z').textContent = 'Z ' + Math.floor(z / 8);
        stage.querySelector('.lp-scene-portal').dataset.flip = String(k % 2);
      };
      show();
      if (!reduced()) {
        const iv = setInterval(() => { if (!root.isConnected) { clearInterval(iv); return; } k++; show(); }, 2800);
      }
    }

    if (!fresh && keepOpen >= 0 && keepOpen < panes.length) setOpen(keepOpen);
    root.append(stage);
  }

  // number keys 1-8 open the tools while the landing page is showing
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    if (location.hash && location.hash !== '#/' && location.hash !== '#') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    const mods = TH.app.modules;
    const list = TOOLS.filter((x) => mods.find((m) => m.id === x.id));
    const pick = list[+e.key - 1];
    if (pick) { e.preventDefault(); location.hash = '#/' + pick.id; }
  });

  TH.app.register({ id: 'overview', name: 'Overview', icon: 'mc:compass', hidden: true, render });
})();
