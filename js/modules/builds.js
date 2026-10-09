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

  /*
   * Worked examples: how a finished build card could look (needs, steps, pitfall, source). Facts summarised in our own
   * words from the Minecraft Wiki tutorials; only numbers the wiki states are shown, the rest stays out.
   */
  const EXAMPLES = [
    { dim: 'overworld', icon: 'iron', name: 'Iron golem farm', level: 'Medium', edition: 'Java and Bedrock rules differ',
      pitch: 'A small village pod where golems spawn, get carried by water to a lava blade, and drop iron into a hopper.',
      needs: [['item/hopper', '1 hopper'], ['item/lava_bucket', 'Water and lava buckets'], ['chest', 'Chest'], [null, 'Villagers and beds'], [null, 'Torches for light control']],
      steps: ['Gather villagers in a pod with beds and workstations so they panic or gossip (Java: 3 panicking or 5 gossiping).',
        'Make a solid spawn platform with air or water above it. Buttons, plates and other non-solid blocks stop spawns.',
        'Push spawned golems with water to a lava blade over a hopper.',
        'Collect iron in a chest. Build several farms more than 64 blocks apart to multiply output.'],
      tip: 'Bedrock needs at least 20 beds and 10 villagers, and more villagers for each extra golem. Best case on Java is about 404 iron an hour.',
      link: 'https://minecraft.wiki/w/Tutorial:Iron_golem_farming' },
    { dim: 'overworld', icon: 'item/sugar_cane', name: 'Sugar cane farm', level: 'Easy', edition: 'Java and Bedrock',
      pitch: 'Cane beside water, an observer and a piston to cut it, a hopper to catch the drops.',
      needs: [['item/sugar_cane', 'Sugar cane'], [null, 'Dirt, sand or mud next to water'], [null, 'Piston and observer'], ['item/hopper', 'Hoppers']],
      steps: ['Plant the cane on a valid block next to water.',
        'Let an observer (or a daylight sensor clock) fire a piston when the cane grows.',
        'The piston knocks the cane into a water stream.',
        'Hoppers (or a hopper minecart) collect it while the base keeps growing.'],
      tip: 'Zero-tick designs are much faster but a different build. Start with the observer version.',
      link: 'https://minecraft.wiki/w/Tutorial:Sugar_cane_farming' },
    { dim: 'overworld', icon: 'item/bamboo', name: 'Bamboo farm', level: 'Easy', edition: 'Java',
      pitch: 'Two rows of bamboo with pistons on both sides and one observer at the top.',
      needs: [['item/bamboo', '16 bamboo'], [null, '16 mud blocks'], [null, '16 pistons'], [null, '1 observer'], ['item/hopper', 'Hoppers']],
      steps: ['Plant two rows of 8 bamboo on the mud.',
        'Line both sides with inward-facing pistons and put hoppers underneath.',
        'The observer sees growth at the top and the pistons break the bamboo.',
        'A small second timer clears what falls late, so less is lost. Keep the area lit.'],
      tip: 'Bamboo grows about one stage per plant every 68 seconds on Java (about 205 on Bedrock). Bone meal adds 1 to 2 blocks.',
      link: 'https://minecraft.wiki/w/Tutorial:Bamboo_farming' },
    { dim: 'overworld', icon: 'item/hopper', name: 'Item sorter', level: 'Easy', edition: 'Java',
      pitch: 'One hopper lane per item, added one lane at a time. Wrong items slide on to the next lane.',
      needs: [['diamond', '1 of the item per lane'], [null, '21 filler items (15 for 16-stack items)'], ['item/hopper', '2 hoppers per lane'], ['chest', 'Chest per lane'], ['redstone', 'Redstone']],
      steps: ['Put the target item and the filler items in the top hopper.',
        'Point it away from the lower hopper, which stays powered so it cannot pull.',
        'When the top hopper is full the power drops and the extras go into the chest.',
        'Everything else keeps moving along to the next lane.'],
      tip: 'This version has no overflow protection. Packed tightly side by side, a full lane can unlock its neighbours. Use a hybrid design if you tile lanes close together.',
      link: 'https://minecraft.wiki/w/Tutorial:Item_sorting' },
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

  function exampleCard(x) {
    const dm = DIMS.find((d) => d.id === x.dim);
    return h('article.panel.bd-example',
      h('div.bd-card-top', h('span.bd-ico', TH.icon(x.icon, { size: 36 })),
        h('span.bd-pills', h('span.pill.bd-dim.dim-' + x.dim, dm.name), h('span.pill.bd-level', x.level))),
      h('h4', x.name),
      h('p.muted', x.pitch),
      h('div.bd-sub', 'You need'),
      h('ul.bd-needs', x.needs.map(([ico, t]) => h('li', ico ? TH.icon(ico, { size: 18 }) : h('span.bd-needs-dot'), t))),
      h('div.bd-sub', 'How it works'),
      h('ol.bd-steps', x.steps.map((t) => h('li', t))),
      h('p.bd-tip', h('b', 'Good to know '), x.tip),
      h('div.bd-foot', h('span.muted', x.edition), h('a.bd-link', { href: x.link, target: '_blank', rel: 'noopener' }, 'Wiki tutorial \u2192')));
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
        type: 'button', 'data-dim': d.id, 'aria-pressed': d.id === dim,
        class: d.id === dim ? 'on' : null,
        onclick: () => { dim = d.id; apply(); },
      }, d.name)));
    chips.querySelectorAll('button').forEach((b, i) => TH.util.tooltip(b, ([{ hint: 'Every planned build' }].concat(DIMS))[i].hint));

    function apply() {
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
    }
    apply();

    root.append(
      h('div.page-head', h('h2', 'Builds')),
      h('div.panel.soon-banner.bd-banner',
        h('div.big', TH.icon('block/crafting_table_front', { size: 48 })),
        h('div',
          h('b', 'Coming soon'),
          h('div.muted', 'Nothing here is buildable in the app yet. This is the roadmap: each build is the easiest design that is still worth having.'))),
      h('h3.section-title', 'Example builds ', h('span.pill.bd-status-ex', 'preview')),
      h('div.bd-examples', EXAMPLES.map(exampleCard)),
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
