/**
 * Overview — the landing page (route "#/" or no hash). A hidden module: reachable via the logo, not a nav tab.
 * A bento of tool tiles (Enchanting featured, always first) built from the registered modules; live stats come from each
 * module's badge(state). Pointer light + tilt on the tiles, a Minecraft-style hotbar at the bottom, and the keys 1-5 jump to a tool.
 */
(function () {
  const { h } = TH.util;

  const TOOLS = [
    { id: 'enchanting', icon: (n) => TH.icon('enchanted_book', { size: n, glint: true }), kicker: 'Gear & books',
      pitch: 'Plan every enchanted item, see exactly which books you still need and tick the anvil steps off one by one.', unit: 'items done' },
    { id: 'hall', icon: (n) => TH.icon('emerald', { size: n }), kicker: 'Villager trading',
      pitch: 'Lay out your trading hall, price the emeralds and lock in every librarian.', unit: 'librarians' },
    { id: 'trims', icon: (n) => TH.icon.trim('sentry', { size: n }), kicker: 'Armor trims',
      pitch: 'Dress a 3D character in any armor and trim, then get the shopping list.', unit: 'templates' },
    { id: 'builds', icon: (n) => TH.icon('block/crafting_table_front', { size: n }), kicker: 'Build planning', soon: true,
      pitch: 'Blocks, stacks and shulker boxes for any build, worked out for you.', unit: '' },
    { id: 'portal', icon: (n) => TH.icon('block/crying_obsidian', { size: n }), kicker: 'Nether travel',
      pitch: 'Convert coordinates between the Overworld and the Nether and line your portals up.', unit: '' },
  ];

  function stat(mod, state, unit) {
    let b = null;
    try { b = mod && mod.badge && mod.badge(state); } catch (e) { /* stats are a bonus */ }
    if (b && typeof b === 'string') { const m = b.match(/^(\d+)\s*\/\s*(\d+)$/); b = m ? { done: +m[1], total: +m[2] } : null; }
    if (!b || typeof b !== 'object' || !b.total) return null;
    return h('div.lp-stat',
      h('div.lp-bar', h('span', { style: { width: Math.min(100, (b.done / b.total) * 100) + '%' } })),
      h('span.lp-stat-n', h('b', b.done), '/' + b.total + (unit ? ' ' + unit : '')));
  }

  const calm = () => !(window.matchMedia && (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches));

  /** pointer light + a little tilt; everything is driven by CSS variables */
  function lively(el) {
    if (!calm()) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      el.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * 6).toFixed(2) + 'deg');
      el.style.setProperty('--px', ((x - 0.5) * 14).toFixed(1) + 'px'); el.style.setProperty('--py', ((y - 0.5) * 12).toFixed(1) + 'px');
    });
    el.addEventListener('pointerleave', () => ['--mx', '--my', '--rx', '--ry', '--px', '--py'].forEach((k) => el.style.removeProperty(k)));
  }

  function render(root, state) {
    const mods = TH.app.modules;
    const trimsOwned = state.trims ? Object.values(state.trims.owned || {}).filter(Boolean).length : 0;
    const items = TOOLS.map((t) => ({ t, mod: mods.find((m) => m.id === t.id) })).filter((x) => x.mod);

    const tiles = items.map(({ t, mod }, i) => {
      let st = stat(mod, state, t.unit);
      if (t.id === 'trims' && trimsOwned && TH.data && TH.data.trimPatterns) st = stat({ badge: () => ({ done: trimsOwned, total: TH.data.trimPatterns.length }) }, state, t.unit);
      const big = i === 0;
      const tile = h('a.lp-tile' + (big ? '.is-feature' : ''), { href: '#/' + t.id, 'data-tool': t.id, 'data-slot': i + 1, style: { '--i': i }, 'aria-label': mod.name + (t.soon ? ' (coming soon)' : '') },
        h('span.lp-aura', { 'aria-hidden': 'true' }),
        h('span.lp-mark', { 'aria-hidden': 'true' }, t.icon(big ? 220 : 150)),
        h('span.lp-slot', { 'aria-hidden': 'true' }, String(i + 1)),
        t.soon ? h('span.lp-soon', 'soon') : null,
        h('div.lp-art', h('span.lp-icon', t.icon(big ? 104 : 64))),
        h('div.lp-body',
          h('span.lp-kick', t.kicker),
          h('h3.lp-name', mod.name),
          h('p.lp-pitch', t.pitch),
          st),
        h('span.lp-go', { 'aria-hidden': 'true' }, '→'));
      lively(tile);
      return tile;
    });

    const hotbar = h('nav.lp-hotbar', { 'aria-label': 'Quick access' }, items.map(({ t, mod }, i) => h('a.lp-hb', { href: '#/' + t.id, 'data-tool': t.id, title: mod.name, 'aria-label': mod.name + ', key ' + (i + 1),
      onpointerenter: () => root.querySelector('.lp-tile[data-tool="' + t.id + '"]')?.classList.add('is-peek'),
      onpointerleave: () => root.querySelector('.lp-tile[data-tool="' + t.id + '"]')?.classList.remove('is-peek') },
      h('span.lp-hb-ico', t.icon(30)), h('kbd', String(i + 1)))));

    root.append(
      h('section.lp-hero',
        h('span.lp-eyebrow', 'n1cebear’s toolbox'),
        h('h2.lp-title', h('span', 'Plan it.'), ' ', h('span', 'Enchant it.'), ' ', h('span', 'Build it.')),
        h('p.lp-sub', 'Survival planners and calculators for Minecraft, in one place.')),
      h('div.lp-grid', tiles),
      h('div.lp-hotbar-wrap', hotbar, h('span.lp-hint', 'press ', h('kbd', '1'), '–', h('kbd', String(items.length)), ' to jump')));
  }

  // number keys 1-5 open the tools while the landing page is showing
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
