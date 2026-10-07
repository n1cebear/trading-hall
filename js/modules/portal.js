/**
 * Portal Calculator — placeholder for the Nether <-> Overworld coordinate converter
 * (crimson accent, nav tab marked "soon"). No calculator yet, just the pitch.
 */
(function () {
  const { h } = TH.util;

  const IDEAS = [
    ['item/compass_00', 'Divide and multiply', 'Overworld X and Z divided by 8 give the Nether spot; Nether X and Z times 8 go back.'],
    ['item/arrow', 'Y stays the same', 'Height is not scaled, so only X and Z change. The tool will flag Y values the Nether cannot hold.'],
    ['block/crying_obsidian', 'Link your portals', 'Tips for lining portals up so each pair connects where you want it: spacing, search range and where to build the second one.'],
  ];

  function render(root) {
    root.append(
      h('div.page-head',
        h('div', h('h2', 'Portal Calculator'),
          h('p', 'Convert coordinates between the Overworld and the Nether, and plan portals that link up.'))),
      h('div.panel.soon-banner.pt-banner',
        h('div.big', TH.icon('block/crying_obsidian', { size: 48 })),
        h('div',
          h('b', 'Coming soon'),
          h('div.muted', 'The calculator itself is not built yet. Here is the plan.'))),
      h('div.grid.pt-ideas', IDEAS.map(([ico, title, text]) => h('div.panel.bd-idea',
        h('h4', TH.icon(ico, { size: 28 }), title),
        h('div.muted', text)))));
  }

  TH.app.register({
    id: 'portal',
    name: 'Portal Calculator',
    short: 'Portal',
    icon: 'mc:block/crying_obsidian',
    soon: true,
    render,
  });
})();
