/**
 * Armor trims — groundwork for the future previewer.
 *
 * Today: a reference of patterns + materials with "owned" toggles so you can
 * already track which templates you've found. The previewer will build on:
 *   state.trims = { owned: { [patternId]: true }, outfit: { helmet, chestplate, leggings, boots } }
 *   where each outfit piece = { armor: armorMaterialId, pattern: patternId, material: trimMaterialId }.
 */
(function () {
  const { h } = TH.util;
  const D = TH.data;
  const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

  function render(root, state) {
    const owned = state.trims.owned;
    const ownedCount = D.trimPatterns.filter((p) => owned[p.id]).length;

    root.append(
      h('div.page-head',
        h('div', h('h2', 'Armor trims'),
          h('p', 'Tick the smithing templates you own. A full outfit previewer with per-piece toggles is next on the list.'))),
      h('div.panel.soon-banner',
        h('div.big', TH.icon.item('chestplate', 'netherite', { size: 48, glint: true })),
        h('div',
          h('b', 'Previewer coming soon'),
          h('div.muted', `Will combine ${D.armorMaterials.length} armor materials × ${D.trimPatterns.length} patterns × ${D.trimMaterials.length} trim materials across ${PIECES.length} pieces.`)),
        h('div', { style: { marginLeft: 'auto', textAlign: 'right' } },
          h('div.stat-num', `${ownedCount}/${D.trimPatterns.length}`), h('div.stat-label', 'templates owned'))),
      h('h3.section-title', 'Trim materials'),
      h('div.swatches', D.trimMaterials.map((m) => h('div.swatch', { title: m.item }, TH.icon.trimMaterial(m.item, { size: 20 }), m.name))),
      h('h3.section-title', 'Patterns'),
      h('div.grid', D.trimPatterns.map((p) => h('div.panel.pattern' + (owned[p.id] ? '.owned' : ''),
        h('h4',
          TH.icon.trim(p.id, { size: 28 }), h('label.check', h('input', {
            type: 'checkbox', checked: !!owned[p.id], 'aria-label': 'Own ' + p.name,
            onchange: (e) => TH.store.update((s) => { s.trims.owned[p.id] = e.target.checked; }),
          }), h('span')),
          p.name,
          h('span.pill.rarity-' + p.rarity, p.rarity)),
        h('div.muted', TH.icon('compass', { size: 14 }), ' ' + p.source),
        h('div.faint', 'Duplicate with 7 diamonds + ' + p.duplicateWith),
      ))),
    );
  }

  TH.app.register({
    id: 'trims',
    name: 'Trims',
    icon: 'mc:item/sentry_armor_trim_smithing_template',
    soon: true,
    init(store) {
      store.define('trims', { owned: {}, outfit: Object.fromEntries(PIECES.map((p) => [p, { armor: 'netherite', pattern: null, material: null }])) });
    },
    render,
  });
})();
