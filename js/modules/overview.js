/**
 * Overview — the landing page (route "#/" or no hash). A hidden module: reachable via the logo, not a nav tab.
 * Cards are built from the registered modules, so their live stats come from each module's badge(state).
 */
(function () {
  const { h } = TH.util;

  const TOOLS = [
    { id: 'hall', icon: () => TH.icon('emerald', { size: 56 }), kicker: 'Villager trading',
      pitch: 'Plan a trading hall slot by slot. Pick the trades you want, price the emeralds, and tick off every librarian as you lock them in.',
      cta: 'Open the hall', unit: 'librarians done' },
    { id: 'enchanting', icon: () => TH.icon('enchanted_book', { size: 56, glint: true }), kicker: 'Gear & books',
      pitch: 'Build the perfect gear set, see which books you still need, and keep a plan of every item you have left to enchant.',
      cta: 'Start enchanting', unit: 'plan items done' },
    { id: 'trims', icon: () => TH.icon.trim('sentry', { size: 56 }), kicker: 'Armor trims',
      pitch: 'Dress a 3D character in any armor, pattern and trim material, piece by piece, then get the full shopping list.',
      cta: 'Try on trims', unit: 'templates owned' },
    { id: 'builds', icon: () => TH.icon('block/crafting_table_front', { size: 56 }), kicker: 'Build planning', soon: true, soonLabel: 'soon',
      pitch: 'Plan a build and get the materials list for it. Blocks, stacks and shulker boxes, worked out for you.',
      cta: 'See what is coming', unit: '' },
    { id: 'portal', icon: () => TH.icon('block/crying_obsidian', { size: 56 }), kicker: 'Nether travel', soon: true, soonLabel: 'soon',
      pitch: 'Convert coordinates between the Overworld and the Nether (divide or multiply by 8) and line your portals up.',
      cta: 'See what is coming', unit: '' },
  ];

  function stat(mod, state, unit) {
    let b = null;
    try { b = mod && mod.badge && mod.badge(state); } catch (e) { /* stats are a bonus */ }
    if (b && typeof b === 'string') { const m = b.match(/^(\d+)\s*\/\s*(\d+)$/); b = m ? { done: +m[1], total: +m[2] } : null; }
    if (!b || typeof b !== 'object' || !b.total) return null;
    return h('div.ov-stat',
      h('div.ov-stat-row', h('b', b.done + '/' + b.total), h('span', unit)),
      h('div.bar', h('span', { style: { width: Math.min(100, (b.done / b.total) * 100) + '%' } })));
  }

  function render(root, state) {
    const mods = TH.app.modules;
    const trimsOwned = state.trims ? Object.values(state.trims.owned || {}).filter(Boolean).length : 0;

    const cards = TOOLS.map((t, i) => {
      const mod = mods.find((m) => m.id === t.id);
      if (!mod) return null;
      let st = stat(mod, state, t.unit);
      if (t.id === 'trims' && trimsOwned && TH.data && TH.data.trimPatterns) {
        st = stat({ badge: () => ({ done: trimsOwned, total: TH.data.trimPatterns.length }) }, state, t.unit);
      }
      const card = h('a.ov-card', { href: '#/' + t.id, 'data-tool': t.id, style: { '--i': i } },
        h('div.ov-art', h('span.ov-icon', t.icon())),
        h('div.ov-body',
          h('div.ov-kicker', t.kicker, t.soon ? h('span.ov-soon', t.soonLabel || 'preview') : null),
          h('h3', mod.name),
          h('p', t.pitch),
          st),
        h('span.ov-cta', t.cta, h('span.ov-arrow', { 'aria-hidden': 'true' }, '→')));
      TH.util.tooltip(card, () => h('span', h('span.th-tooltip-title', mod.name, t.soon ? h('span.th-tooltip-tag', t.soonLabel || 'preview') : null), h('span.th-tooltip-sub', t.kicker)));
      return card;
    });

    root.append(
      h('section.ov-hero',
        h('div.ov-eyebrow', 'A Minecraft toolbox'),
        h('h2', 'Pick a tool, ', h('em', 'start building.')),
        h('p', 'Everything saves in this browser and works offline. Each tool has its own colour so you always know where you are.')),
      h('div.ov-grid', cards),
      h('p.ov-foot', 'Tip: click the logo at any time to come back here.'));
  }

  TH.app.register({ id: 'overview', name: 'Overview', icon: 'mc:compass', hidden: true, render });
})();
