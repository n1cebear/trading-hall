/**
 * Builds — a roadmap page for the build planner (orange accent, nav tab marked "soon").
 * BUILDS is the growable list: one entry per planned build, tagged with the progression
 * dimension it needs and the "easiest still-useful design" pitch. Filter chips narrow it.
 */
(function () {
  const { h } = TH.util;

  const DIMS = [
    { id: 'overworld', name: 'Overworld', hint: 'Buildable without the Nether' },
    { id: 'nether', name: 'Nether', hint: 'Needs Nether access' },
    { id: 'end', name: 'End', hint: 'After beating the game' },
  ];

  // [dimension, icon, name, easiest still-useful design, optional link]
  const BUILDS = [
    ['overworld', 'iron', 'Easy iron farm', 'A golem platform with a lava blade: the simplest design that still pays out in stacks of iron.'],
    ['overworld', 'xp', 'Easy XP farm', 'A spawner or dark-room mob grinder with a drop chute and a kill spot, no AFK tricks required.'],
    ['overworld', 'wheat', 'Easy crop farm', 'A water-channel field harvested by a villager or a simple piston line, one crop first.'],
    ['overworld', 'block/spawner', 'Spawner-to-farm converter', 'Turn a found dungeon spawner into a lit, walled grinder with a chute into a chest.'],
    ['overworld', 'block/moss_block', 'Moss farm', 'Bone meal on a flat moss floor, harvested by a piston or shears row.'],
    ['overworld', 'item/bone_meal', 'Bone meal farm', 'A skeleton drop chute feeding a hopper line, so bones arrive ready to craft.'],
    ['overworld', 'item/sugar_cane', 'Sugar cane farm', 'Observer-triggered pistons along a water strip with a hopper at the edge.'],
    ['overworld', 'item/bamboo', 'Bamboo farm', 'One observer and piston line over a dirt strip, hopper collection underneath.'],
    ['overworld', 'block/cobblestone', 'Cobblestone farm', 'Lava meets water beside a piston, with every break dropping into a hopper.'],
    ['overworld', 'item/lava_bucket', 'Lava farm', 'Pointed dripstone over a cauldron refills lava slowly and safely, no Nether trip needed.'],
    ['overworld', 'item/beef', 'Cow crusher / lava cow crusher', 'Cows walk onto a lava or damage blade; cooked beef and leather land in a chest.'],
    ['overworld', 'villager', 'Custom villager trading hall', 'A hall laid out slot by slot, with the exact trades you want.', { href: '#/hall', label: 'Open the Trading Hall tool' }],
    ['overworld', 'item/hopper', 'Simple automatic item sorter', 'A hopper chain with one filter item per column, extendable one lane at a time.'],
    ['nether', 'quartz', 'Quartz-based builds and farms', 'A lit tunnel mine in a quartz biome with hopper pickup; unlocks everything that needs quartz.'],
    ['end', 'item/shulker_shell', 'Shulker farm', 'A spawn platform at an End city with a drop chute: the endgame source of shulker boxes.'],
  ];

  const FEATURES = [
    { status: 'next', label: 'Next up', icon: 'chest', name: 'Materials list',
      text: 'Works on its own and connects to builds.',
      points: [
        'Paste a Litematica material list, or type a manual list.',
        'Becomes a checklist that splits raw from crafted materials.',
        'Amounts as items, stacks, shulker boxes or double chests.',
        'Tick off what you have gathered; link a list to a build.',
      ] },
    { status: 'hold', label: 'On hold', icon: 'block/crafting_table_front', name: 'Plan a build',
      text: 'A shape helper and viewer for designing before you place a block.',
      points: [
        'Shapes: cubes, spheres, cylinders, domes, arches and more.',
        'Layer-by-layer viewer with vertical and horizontal limits.',
        'Slice view showing the outline of each layer.',
      ] },
  ];

  let dim = 'all';

  function buildCard(b) {
    const [d, ico, name, pitch, link] = b;
    const dm = DIMS.find((x) => x.id === d);
    return h('article.panel.bd-card', { 'data-dim': d },
      h('div.bd-card-top', h('span.bd-ico', TH.icon(ico, { size: 28 })), h('span.pill.bd-dim.dim-' + d, dm.name)),
      h('h4', name),
      h('p.muted', pitch),
      link ? h('a.bd-link', { href: link.href }, link.label + ' →') : null);
  }

  function featureCard(f) {
    return h('article.panel.bd-feature.is-' + f.status,
      h('div.bd-card-top', h('span.bd-ico', TH.icon(f.icon, { size: 32 })), h('span.pill.bd-status', f.label)),
      h('h4', f.name),
      h('p.muted', f.text),
      h('ul', f.points.map((p) => h('li', p))));
  }

  function render(root) {
    const grid = h('div.bd-grid', BUILDS.map(buildCard));
    const count = h('span.bd-count');
    const chips = h('div.seg.bd-filter', { role: 'group', 'aria-label': 'Filter by progression' },
      [{ id: 'all', name: 'All', hint: 'Every planned build' }].concat(DIMS).map((d) => h('button', {
        type: 'button', 'data-dim': d.id, title: d.hint, 'aria-pressed': d.id === dim,
        class: d.id === dim ? 'on' : null,
        onclick: () => { dim = d.id; apply(true); },
      }, d.name)));

    function apply(animate) {
      let n = 0;
      grid.querySelectorAll('.bd-card').forEach((c) => {
        const show = dim === 'all' || c.dataset.dim === dim;
        c.classList.toggle('hidden', !show);
        if (show) n++;
      });
      chips.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.dim === dim;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
      const cur = DIMS.find((x) => x.id === dim);
      count.textContent = n + ' planned' + (cur ? ' · ' + cur.hint : '');
      if (animate) TH.util.reveal(grid, { items: '.bd-card:not(.hidden)', step: 0.04 });
    }
    apply(false);

    root.append(
      h('div.page-head',
        h('div', h('h2', 'Builds'),
          h('p', 'Plan a build and know exactly what to gather before you place the first block.'))),
      h('div.panel.soon-banner.bd-banner',
        h('div.big', TH.icon('block/crafting_table_front', { size: 48 })),
        h('div',
          h('b', 'Coming soon'),
          h('div.muted', 'Nothing here is buildable in the app yet. This is the roadmap: each build is the easiest design that is still worth having.'))),
      h('h3.section-title', 'Planned builds'),
      h('div.bd-bar', chips, count),
      grid,
      h('h3.section-title', 'Tools around builds'),
      h('div.bd-features', FEATURES.map(featureCard)));
  }

  TH.app.register({
    id: 'builds',
    name: 'Builds',
    icon: 'mc:block/crafting_table_front',
    soon: true,
    render,
  });
})();
