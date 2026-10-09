/**
 * Portal Calculator (crimson accent). Converts Overworld <-> Nether coordinates and checks how saved portals link.
 *
 * Java link rule, written in Overworld scale (Nether coordinates x 8): entering a portal sends you to the converted spot
 * in the other dimension and the game looks for a portal within a square around it. Going to the Nether that square is
 * 16 Nether blocks, going back it is 128 Overworld blocks, which is the same 128 in Overworld scale. So two portals of
 * different dimensions can link when their Overworld-scale positions are at most 128 apart on both X and Z. The nearest
 * one wins (measured in the destination dimension). With no portal in range the game builds a new one.
 *
 * State (state.portal): dir 'ow' | 'ne' (what the input is), x/y/z (the input), portals [{ id, name, dim, x, y, z }].
 * Typing only patches the result, the statuses and the map, so no field loses focus.
 */
(function () {
  const { h, clamp } = TH.util;
  const RANGE = 128;                       // link square half-width, Overworld scale
  const LIMIT = 29999984;                  // world border
  const DIMS = { ow: 'Overworld', ne: 'Nether' };
  const SAMPLE = [
    { id: 'p1', name: 'Base', dim: 'ow', x: 800, y: 70, z: -1200 },
    { id: 'p2', name: 'Base (Nether side)', dim: 'ne', x: 102, y: 64, z: -146 },
  ];

  const S = () => TH.store.get().portal;
  const save = () => TH.store.update(() => {}, { silent: true });
  const num = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? clamp(n, -LIMIT, LIMIT) : 0; };
  const other = (d) => (d === 'ow' ? 'ne' : 'ow');
  const toOther = (p, d) => (d === 'ow'
    ? { x: Math.floor(p.x / 8), y: p.y, z: Math.floor(p.z / 8) }
    : { x: p.x * 8, y: p.y, z: p.z * 8 });
  const scaled = (p) => (p.dim === 'ne' ? { x: p.x * 8, z: p.z * 8 } : { x: p.x, z: p.z });
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /** The portal a traveller from `from` ({dim,x,y,z}) would arrive at, or null when the game would build a new one. */
  function linkOf(from, list) {
    const t = toOther(from, from.dim), dd = other(from.dim);
    const r = dd === 'ne' ? RANGE / 8 : RANGE;       // search square half-width in the destination dimension
    let best = null, bd = Infinity;
    for (const q of list) {
      if (q.dim !== dd || q === from) continue;
      if (Math.abs(q.x - t.x) > r || Math.abs(q.z - t.z) > r) continue;
      const d = Math.hypot(q.x - t.x, q.y - t.y, q.z - t.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best ? { to: best, dist: Math.round(bd), target: t } : { to: null, target: t };
  }

  function warnings(p) {
    const w = [];
    const t = toOther(p, p.dim);
    if (Math.abs(p.x) > LIMIT - 8 || Math.abs(p.z) > LIMIT - 8) w.push('Close to the world border, the portal may not generate.');
    if (p.dim === 'ow' && p.y > 118) w.push('Y ' + p.y + ' is above the Nether ceiling area: the Nether side will be built lower, so Y is not carried over.');
    else if (p.dim === 'ow' && p.y < 0) w.push('Y ' + p.y + ' is below the Nether floor: the Nether side will be built higher.');
    if (p.dim === 'ne' && (p.y < 0 || p.y > 127)) w.push('Y ' + p.y + ' is outside the Nether (0 to 127).');
    if (p.dim === 'ne' && t.y > 320) w.push('The Overworld side tops out at Y 320.');
    return w;
  }

  function render(root) {
    const st = S();
    const copyBtn = h('button.btn.small.pt-copy', { type: 'button', onclick: copyResult }, 'Copy');
    const resX = h('b'), resY = h('b'), resZ = h('b');
    const resBox = h('div.pt-result', { 'aria-live': 'polite' },
      h('div.pt-res-cell', h('small', 'X'), resX), h('div.pt-res-cell', h('small', 'Y'), resY), h('div.pt-res-cell', h('small', 'Z'), resZ));
    const rule = h('div.pt-rule');
    const link = h('div.pt-link');
    const warn = h('ul.pt-warn');
    const inputs = {};
    const listEl = h('div.pt-list');
    const mapEl = h('div.pt-map');
    const rowStatus = new Map();

    const field = (k, label) => {
      const f = h('input.field', {
        id: 'pt-' + k, type: 'number', inputMode: 'numeric', step: 1, value: st[k], 'aria-label': label,
        oninput: () => { st[k] = num(f.value); save(); update(); },
        onchange: () => { f.value = st[k]; },
      });
      inputs[k] = f;
      return h('label.pt-in', h('span', label), f);
    };

    const dirSeg = h('div.seg.pt-dir', { role: 'group', 'aria-label': 'Direction' },
      ['ow', 'ne'].map((d) => h('button', {
        type: 'button', 'data-d': d, 'aria-pressed': st.dir === d, class: st.dir === d ? 'on' : null,
        onclick: () => {
          if (st.dir === d) return;
          // switching direction keeps the spot: the converted result becomes the new input
          const r = toOther({ x: st.x, y: st.y, z: st.z }, st.dir);
          st.dir = d; st.x = r.x; st.y = r.y; st.z = r.z; save();
          dirSeg.querySelectorAll('button').forEach((b) => { const on = b.dataset.d === d; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
          ['x', 'y', 'z'].forEach((k) => { inputs[k].value = st[k]; });
          update();
        },
      }, DIMS[d] + ' → ' + DIMS[other(d)])));

    function current() { return { dim: st.dir, x: st.x, y: st.y, z: st.z }; }

    function update() {
      const p = current(), r = toOther(p, p.dim);
      resX.textContent = fmt(r.x); resY.textContent = fmt(r.y); resZ.textContent = fmt(r.z);
      resBox.dataset.dim = other(p.dim);
      rule.textContent = p.dim === 'ow' ? 'X and Z divided by 8, rounded down. Y stays.' : 'X and Z multiplied by 8. Y stays.';
      const lk = linkOf(p, st.portals);
      link.replaceChildren(lk.to
        ? h('span', 'Connects to ', h('b', lk.to.name || 'a saved portal'), ' (' + DIMS[lk.to.dim] + ', ' + lk.dist + ' blocks from the target).')
        : h('span', 'No saved portal in range. The game would ', h('b', 'build a new portal'), ' near the target.'));
      warn.replaceChildren(...warnings(p).map((t) => h('li', t)));
      statuses(); drawMap();
    }

    function copyResult() {
      const r = toOther(current(), st.dir), t = r.x + ' ' + r.y + ' ' + r.z;
      const ok = () => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400); };
      try { navigator.clipboard.writeText(t).then(ok, () => TH.util.toast(t)); } catch (e) { TH.util.toast(t); }
    }

    // ---- saved portals ----
    function addPortal(p, name) {
      st.portals.push({ id: TH.util.uid('pt'), name: name || DIMS[p.dim] + ' portal ' + (st.portals.length + 1), dim: p.dim, x: p.x, y: p.y, z: p.z });
      save(); buildList(); update();
    }

    function statuses() {
      for (const p of st.portals) {
        const el = rowStatus.get(p.id);
        if (!el) continue;
        const lk = linkOf(p, st.portals);
        el.className = 'pt-status ' + (lk.to ? 'is-linked' : 'is-new');
        el.textContent = lk.to
          ? '→ ' + DIMS[lk.to.dim] + ' ' + fmt(lk.target.x) + ', ' + fmt(lk.target.y) + ', ' + fmt(lk.target.z) + ' · links to ' + (lk.to.name || 'a saved portal') + ', ' + lk.dist + ' away'
          : '→ ' + DIMS[other(p.dim)] + ' ' + fmt(lk.target.x) + ', ' + fmt(lk.target.y) + ', ' + fmt(lk.target.z) + ' · no portal in range, a new one is built';
      }
    }

    function buildList() {
      rowStatus.clear();
      if (!st.portals.length) {
        listEl.replaceChildren(h('div.pt-empty', 'No portals saved yet. Save the spot above to see how it connects to your others.'));
        return;
      }
      listEl.replaceChildren(...st.portals.map((p) => {
        const status = h('div.pt-status');
        rowStatus.set(p.id, status);
        const coord = (k) => {
          const f = h('input.field', { type: 'number', step: 1, value: p[k], 'aria-label': p.name + ' ' + k.toUpperCase(),
            oninput: () => { p[k] = num(f.value); save(); update(); }, onchange: () => { f.value = p[k]; } });
          return f;
        };
        const name = h('input.field.pt-name', { type: 'text', value: p.name, maxLength: 40, 'aria-label': 'Portal name',
          oninput: () => { p.name = name.value; save(); update(); } });
        const seg = h('div.seg.pt-dim', { role: 'group', 'aria-label': 'Dimension' },
          ['ow', 'ne'].map((d) => h('button', { type: 'button', 'aria-pressed': p.dim === d, class: p.dim === d ? 'on' : null,
            onclick: () => { p.dim = d; save(); buildList(); update(); } }, d === 'ow' ? 'Overworld' : 'Nether')));
        const del = h('button.icon-btn.pt-del', { type: 'button', 'aria-label': 'Remove ' + p.name,
          onclick: () => { st.portals = st.portals.filter((q) => q !== p); save(); buildList(); update(); } }, '×');
        return h('div.pt-row', { 'data-dim': p.dim },
          h('div.pt-row-top', h('span.pt-dot'), name, seg, del),
          h('div.pt-row-xyz', coord('x'), coord('y'), coord('z')),
          status);
      }));
    }

    // ---- map (Overworld scale; squares = the 128 block link range around each portal's target) ----
    function drawMap() {
      const NS = 'http://www.w3.org/2000/svg';
      const pts = st.portals.map((p) => Object.assign({ p }, scaled(p)));
      const cur = current(), cs = scaled(cur);
      const all = pts.concat([{ cur: true, x: cs.x, z: cs.z }]);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      all.forEach((q) => { x0 = Math.min(x0, q.x - RANGE); x1 = Math.max(x1, q.x + RANGE); z0 = Math.min(z0, q.z - RANGE); z1 = Math.max(z1, q.z + RANGE); });
      const pad = Math.max(40, (Math.max(x1 - x0, z1 - z0)) * 0.06);
      x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
      const w = x1 - x0, hh = z1 - z0, side = Math.max(w, hh, 400);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, vx = cx - side / 2, vz = cz - side / 2;
      const k = side / 100;                       // one SVG unit-ish; strokes and text scale with the view
      const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for (const key in a) e.setAttribute(key, a[key]); if (txt != null) e.textContent = txt; return e; };
      const svg = el('svg', { viewBox: [vx, vz, side, side].join(' '), role: 'img', 'aria-label': 'Map of your portals in Overworld coordinates', preserveAspectRatio: 'xMidYMid meet' });
      for (const q of pts) {
        svg.append(el('rect', { x: q.x - RANGE, y: q.z - RANGE, width: RANGE * 2, height: RANGE * 2, class: 'pt-zone pt-' + q.p.dim }));
      }
      svg.append(el('rect', { x: cs.x - RANGE, y: cs.z - RANGE, width: RANGE * 2, height: RANGE * 2, class: 'pt-zone pt-cur' }));
      for (const q of pts) {
        const lk = linkOf(q.p, st.portals);
        if (lk.to) { const t = scaled(lk.to); svg.append(el('line', { x1: q.x, y1: q.z, x2: t.x, y2: t.z, class: 'pt-line', 'stroke-width': k * 0.35 })); }
      }
      for (const q of pts) {
        svg.append(el('circle', { cx: q.x, cy: q.z, r: k * 1.1, class: 'pt-pin pt-' + q.p.dim }));
        svg.append(el('text', { x: q.x, y: q.z - k * 2, class: 'pt-lbl', 'font-size': k * 2.8, 'text-anchor': 'middle' }, q.p.name));
      }
      svg.append(el('path', { d: `M${cs.x - k * 1.6} ${cs.z}H${cs.x + k * 1.6}M${cs.x} ${cs.z - k * 1.6}V${cs.z + k * 1.6}`, class: 'pt-cross', 'stroke-width': k * 0.5 }));
      mapEl.replaceChildren(svg);
    }

    const tips = [
      ['Connect a pair', 'Build the second portal within 16 blocks (Nether side) of the converted spot, or within 128 blocks on the Overworld side.'],
      ['Keep pairs apart', 'Nether portals of different pairs need more than 32 blocks between them. Their Overworld partners need more than 256.'],
      ['Java rules', 'Bedrock searches differently, so check links there in game.'],
    ];

    root.append(
      h('div.page-head', h('h2', 'Portal Calculator')),
      h('div.pt-layout',
        h('section.panel.pt-calc', { 'aria-label': 'Convert coordinates' },
          dirSeg,
          h('div.pt-ins', field('x', 'X'), field('y', 'Y'), field('z', 'Z')),
          h('div.pt-arrow', { 'aria-hidden': 'true' }, TH.icon('block/crying_obsidian', { size: 22 })),
          resBox,
          h('div.pt-meta', rule, copyBtn),
          link,
          warn,
          h('button.btn.primary.pt-save', { type: 'button', onclick: () => addPortal(current(), 'Portal ' + (st.portals.length + 1)) },
            'Save this portal')),
        h('section.panel.pt-saved', { 'aria-label': 'Your portals' },
          h('div.pt-head', h('h3', 'Your portals'),
            h('button.btn.small', { type: 'button', onclick: () => addPortal(Object.assign({ dim: other(st.dir) }, toOther(current(), st.dir)), 'Partner ' + (st.portals.length + 1)) }, 'Save the result too')),
          listEl)),
      h('section.panel.pt-mapbox', { 'aria-label': 'Portal map' },
        h('div.pt-head', h('h3', 'Map'), h('span.muted', 'Overworld scale. Squares are the 128 block link range.')),
        mapEl,
        h('div.pt-legend', h('span.pt-key.pt-ow', 'Overworld'), h('span.pt-key.pt-ne', 'Nether'), h('span.pt-key.pt-cur', 'Your input'))),
      h('div.pt-tips', tips.map(([t, x]) => h('div.panel.bd-idea', h('h4', t), h('div.muted', x)))));

    buildList();
    update();
  }

  TH.app.register({
    id: 'portal',
    name: 'Portal Calculator',
    short: 'Portal',
    icon: 'mc:block/crying_obsidian',
    init(store) {
      store.define('portal', { dir: 'ow', x: 800, y: 70, z: -1200, portals: SAMPLE });
      const s = store.get().portal;
      if (!Array.isArray(s.portals)) s.portals = [];
    },
    render,
  });
})();
