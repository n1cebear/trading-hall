/**
 * Portal Calculator (crimson accent). Two-way converter Overworld <-> Nether, with a portal graphic between the sides,
 * and a map that holds the saved portals and shows how they link.
 *
 * Java link rule, written in Overworld scale (Nether coordinates x 8): entering a portal sends you to the converted spot
 * in the other dimension and the game looks for a portal within a square around it. Going to the Nether that square is
 * 16 Nether blocks, going back it is 128 Overworld blocks, which is the same 128 in Overworld scale. So two portals of
 * different dimensions can link when their Overworld-scale positions are at most 128 apart on both X and Z. The nearest
 * one wins (measured in the destination dimension). With no portal in range the game builds a new one.
 *
 * State (state.portal): dir 'ow' | 'ne' = the side that was typed in last, x/y/z = that side's coordinates (the other
 * side is derived), portals [{ id, name, dim, x, y, z }]. Typing patches the other side, the status and the map in
 * place, so no field loses focus.
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
    if (p.dim === 'ow' && p.y > 118) w.push('Y ' + p.y + ' is above the Nether ceiling area. The game builds the Nether side lower, so Y is not carried over.');
    else if (p.dim === 'ow' && p.y < 0) w.push('Y ' + p.y + ' is below the Nether floor. The game builds the Nether side higher.');
    if (p.dim === 'ne' && (p.y < 0 || p.y > 127)) w.push('Y ' + p.y + ' is outside the Nether (0 to 127).');
    if (p.dim === 'ne' && t.y > 320) w.push('The Overworld side tops out at Y 320.');
    return w;
  }

  /** Pixel portal: obsidian frame (no corners, like the real thing) around animated portal cells. */
  function portalArt() {
    const NS = 'http://www.w3.org/2000/svg', C = 16, W = 6, H = 7;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W * C} ${H * C}`);
    svg.setAttribute('class', 'pt-art');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('shape-rendering', 'crispEdges');
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const cell = (x, y, cls, style) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x * C); r.setAttribute('y', y * C); r.setAttribute('width', C); r.setAttribute('height', C);
      r.setAttribute('class', cls); if (style) r.setAttribute('style', style);
      svg.append(r);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (!edge) continue;
      if ((x === 0 || x === W - 1) && (y === 0 || y === H - 1)) continue;     // no frame corners
      cell(x, y, 'pt-obs pt-obs' + Math.floor(rnd() * 3));
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      cell(x, y, 'pt-pc pt-pc' + Math.floor(rnd() * 4), `animation-delay:${(-rnd() * 4).toFixed(2)}s;animation-duration:${(2.4 + rnd() * 2.2).toFixed(2)}s`);
    }
    return svg;
  }

  function render(root) {
    const st = S();
    const inputs = { ow: {}, ne: {} };
    const statusEl = h('div.pt-status-bar');
    const listEl = h('div.pt-list');
    const mapEl = h('div.pt-map');
    const rowStatus = new Map();
    let sel = null;

    const side = (d) => (st.dir === d ? { x: st.x, y: st.y, z: st.z } : toOther({ x: st.x, y: st.y, z: st.z }, st.dir));
    const current = () => ({ dim: st.dir, x: st.x, y: st.y, z: st.z });

    function sideCol(d) {
      const fields = ['x', 'y', 'z'].map((k) => {
        const f = h('input.field', {
          id: `pt-${d}-${k}`, type: 'number', inputMode: 'numeric', step: 1, value: side(d)[k], 'aria-label': `${DIMS[d]} ${k.toUpperCase()}`,
          oninput: () => {
            if (st.dir !== d) { const cur = side(d); Object.assign(st, { dir: d, x: cur.x, y: cur.y, z: cur.z }); }
            st[k] = num(f.value); save(); update(f);
          },
          onchange: () => { f.value = side(d)[k]; },
        });
        inputs[d][k] = f;
        return h('label.pt-in', h('span', k.toUpperCase()), f);
      });
      const copy = h('button.btn.small.pt-copy', { type: 'button', onclick: () => copyText(d, copy) }, 'Copy');
      return h('div.pt-side.pt-side-' + d,
        h('div.pt-side-head', TH.icon(d === 'ow' ? 'wheat' : 'netherite_ingot', { size: 28 }), h('h3', DIMS[d])),
        h('div.pt-fields', fields),
        h('div.pt-side-foot',
          h('button.btn.small.pt-pin', { type: 'button', onclick: () => addPortal(Object.assign({ dim: d }, side(d)), DIMS[d] + ' portal ' + (st.portals.length + 1)) }, 'Save portal'),
          copy));
    }

    function copyText(d, btn) {
      const c = side(d), t = c.x + ' ' + c.y + ' ' + c.z;
      const ok = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1400); };
      try { navigator.clipboard.writeText(t).then(ok, () => TH.util.toast(t)); } catch (e) { TH.util.toast(t); }
    }

    function update(keep) {
      ['ow', 'ne'].forEach((d) => {
        const c = side(d);
        ['x', 'y', 'z'].forEach((k) => { const f = inputs[d][k]; if (f !== keep && document.activeElement !== f) f.value = c[k]; });
      });
      const p = current();
      const lk = linkOf(p, st.portals);
      const w = warnings(p);
      statusEl.replaceChildren(
        h('div.pt-rule', st.dir === 'ow'
          ? h('span', 'Overworld ÷ 8 = Nether. X and Z only, rounded down.')
          : h('span', 'Nether × 8 = Overworld. X and Z only.'), h('span', ' Y stays the same.')),
        h('div.pt-link', lk.to
          ? h('span', 'A portal at the ' + DIMS[p.dim] + ' spot connects to ', h('b', lk.to.name || 'a saved portal'), ' (' + DIMS[lk.to.dim] + ', ' + lk.dist + ' blocks from the target).')
          : h('span', 'No saved portal in range. The game would ', h('b', 'build a new portal'), ' near the ' + DIMS[other(p.dim)] + ' target.')),
        ...(w.length ? [h('ul.pt-warn', w.map((t) => h('li', t)))] : []));
      statuses(); drawMap();
    }

    // ---- saved portals (inside the map panel) ----
    function addPortal(p, name) {
      const q = { id: TH.util.uid('pt'), name, dim: p.dim, x: p.x, y: p.y, z: p.z };
      st.portals.push(q); sel = q.id; save(); buildList(); update();
      TH.util.toast('Saved ' + name);
    }

    function statuses() {
      for (const p of st.portals) {
        const el = rowStatus.get(p.id);
        if (!el) continue;
        const lk = linkOf(p, st.portals);
        el.className = 'pt-rstatus ' + (lk.to ? 'is-linked' : 'is-new');
        el.textContent = lk.to
          ? 'Goes to ' + DIMS[lk.to.dim] + ' ' + fmt(lk.target.x) + ' ' + fmt(lk.target.y) + ' ' + fmt(lk.target.z) + ', links to ' + (lk.to.name || 'a saved portal') + ' (' + lk.dist + ' away)'
          : 'Goes to ' + DIMS[other(p.dim)] + ' ' + fmt(lk.target.x) + ' ' + fmt(lk.target.y) + ' ' + fmt(lk.target.z) + ', no portal in range: a new one is built';
      }
    }

    function buildList() {
      rowStatus.clear();
      if (!st.portals.length) {
        listEl.replaceChildren(h('div.pt-empty', 'No portals saved yet. Use "Save portal" above to see how it links to the others.'));
        return;
      }
      listEl.replaceChildren(...st.portals.map((p) => {
        const status = h('div.pt-rstatus');
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
        return h('div.pt-row' + (sel === p.id ? '.is-sel' : ''), { 'data-dim': p.dim, 'data-id': p.id,
          onfocusin: () => { if (sel !== p.id) { sel = p.id; listEl.querySelectorAll('.pt-row').forEach((r) => r.classList.toggle('is-sel', r.dataset.id === p.id)); drawMap(); } } },
        h('div.pt-row-top', h('span.pt-dot'), name, del),
        seg,
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
      const side0 = Math.max(x1 - x0, z1 - z0, 400);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, vx = cx - side0 / 2, vz = cz - side0 / 2;
      const k = side0 / 100;
      const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for (const key in a) e.setAttribute(key, a[key]); if (txt != null) e.textContent = txt; return e; };
      const svg = el('svg', { viewBox: [vx, vz, side0, side0].join(' '), role: 'img', 'aria-label': 'Map of your portals in Overworld coordinates', preserveAspectRatio: 'xMidYMid meet' });
      for (const q of pts) {
        svg.append(el('rect', { x: q.x - RANGE, y: q.z - RANGE, width: RANGE * 2, height: RANGE * 2, class: 'pt-zone pt-' + q.p.dim + (q.p.id === sel ? ' is-sel' : '') }));
      }
      svg.append(el('rect', { x: cs.x - RANGE, y: cs.z - RANGE, width: RANGE * 2, height: RANGE * 2, class: 'pt-zone pt-cur' }));
      for (const q of pts) {
        const lk = linkOf(q.p, st.portals);
        if (lk.to) { const t = scaled(lk.to); svg.append(el('line', { x1: q.x, y1: q.z, x2: t.x, y2: t.z, class: 'pt-line', 'stroke-width': k * 0.35 })); }
      }
      for (const q of pts) {
        const pin = el('circle', { cx: q.x, cy: q.z, r: k * (q.p.id === sel ? 1.6 : 1.1), class: 'pt-pin pt-' + q.p.dim });
        pin.append(el('title', {}, q.p.name + ' (' + DIMS[q.p.dim] + ' ' + q.p.x + ' ' + q.p.y + ' ' + q.p.z + ')'));
        svg.append(pin);
        svg.append(el('text', { x: q.x, y: q.z - k * 2.4, class: 'pt-lbl', 'font-size': k * 2.8, 'text-anchor': 'middle' }, q.p.name));
      }
      svg.append(el('path', { d: `M${cs.x - k * 1.6} ${cs.z}H${cs.x + k * 1.6}M${cs.x} ${cs.z - k * 1.6}V${cs.z + k * 1.6}`, class: 'pt-cross', 'stroke-width': k * 0.5 }));
      mapEl.replaceChildren(svg);
    }

    const tips = [
      ['Connect a pair', 'Build the second portal within 16 blocks of the converted spot on the Nether side, or within 128 blocks on the Overworld side.'],
      ['Keep pairs apart', 'Nether portals of different pairs need more than 32 blocks between them. Their Overworld partners need more than 256.'],
      ['Java rules', 'Bedrock searches differently, so check links there in game.'],
    ];

    root.append(
      h('div.page-head', h('h2', 'Portal Calculator')),
      h('section.panel.pt-calc', { 'aria-label': 'Convert coordinates' },
        h('div.pt-grid',
          sideCol('ow'),
          h('div.pt-mid',
            h('div.pt-art-wrap', portalArt()),
            h('div.pt-ops', h('span', '÷ 8'), h('span.pt-ops-arrows', { 'aria-hidden': 'true' }, '⇄'), h('span', '× 8'))),
          sideCol('ne')),
        statusEl),
      h('section.panel.pt-mapbox', { 'aria-label': 'Your portals and map' },
        h('div.pt-head', h('h3', 'Your portals'), h('span.muted', 'Overworld scale. Squares are the 128 block link range.')),
        h('div.pt-mapgrid',
          h('div.pt-listwrap', listEl),
          h('div.pt-mapcol', mapEl,
            h('div.pt-legend', h('span.pt-key.pt-ow', 'Overworld'), h('span.pt-key.pt-ne', 'Nether'), h('span.pt-key.pt-cur', 'Calculator spot'))))),
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
