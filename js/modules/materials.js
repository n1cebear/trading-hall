/**
 * Materials (amber accent): the smart material list as its own tool. Full width, no 3D stage.
 * The UI lives in builds-mats.js (TH.builds.mats); this module only mounts it. It shares the lazily loaded builds-*
 * files and state.builds (lists, ticks, have, units, mats, matSrc) with Builds through TH.builds.api (end of builds.js),
 * so old saves keep every list and tick. Builds' "Material list" keys set matSrc and come here; "View in 3D" goes back.
 */
(function () {
  'use strict';
  const { h } = TH.util;

  function render(root) {
    const api = TH.builds && TH.builds.api;
    root.append(h('div.page-head.mt-phead', h('h2', 'Material List')));
    if (!api) { root.append(h('div.panel.mt-boot', 'The Materials tool could not start.')); return; }
    if (!api.isReady()) {
      root.append(h('div.panel.mt-boot', api.loadError() ? 'The Materials tool could not load. Check the connection and reload.' : 'Loading the material list…'));
      api.load().then(() => { if (location.hash === '#/materials') TH.app.render(); }, () => { if (location.hash === '#/materials') TH.app.render(); });
      return;
    }
    TH.builds.mats.init(api);
    root.append(...TH.builds.mats.render());
  }

  TH.app.register({
    id: 'materials',
    name: 'Material List',
    short: 'List',
    icon: 'mc:block/shulker_box',
    render,
  });
})();
