/**
 * Builds — placeholder for the build planner (orange accent, nav tab marked "soon").
 * Idea: plan a build, get a materials list in blocks, stacks and shulker boxes. No state yet.
 */
(function () {
  const { h } = TH.util;

  const IDEAS = [
    ['block/crafting_table_front', 'Plan a build', 'Name it, size it, pick the blocks. Keep every project in one place.'],
    ['chest', 'Materials list', 'Totals in blocks, stacks and shulker boxes, ready to take to the storage room.'],
    ['map', 'Tick as you gather', 'Check off materials as they land in your inventory and see what is left.'],
  ];

  function render(root) {
    root.append(
      h('div.page-head',
        h('div', h('h2', 'Builds'),
          h('p', 'Plan a build and know exactly what to gather before you place the first block.'))),
      h('div.panel.soon-banner.bd-banner',
        h('div.big', TH.icon('block/crafting_table_front', { size: 48 })),
        h('div',
          h('b', 'Coming soon'),
          h('div.muted', 'The build planner is still on the drawing board. Here is what it is aiming for.'))),
      h('div.grid.bd-ideas', IDEAS.map(([ico, title, text]) => h('div.panel.bd-idea',
        h('h4', TH.icon(ico, { size: 28 }), title),
        h('div.muted', text)))));
  }

  TH.app.register({
    id: 'builds',
    name: 'Builds',
    icon: 'mc:block/crafting_table_front',
    soon: true,
    render,
  });
})();
