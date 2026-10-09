/**
 * Portal Calculator (crimson accent). Two-way converter Overworld <-> Nether with an obsidian portal between the sides,
 * and a technical map (grid, chunk lines, both coordinate scales, pan / zoom) that holds the saved portals.
 *
 * Java link rule, written in Overworld scale (Nether coordinates x 8): entering a portal sends you to the converted spot
 * in the other dimension and the game looks for a portal within a square around it. Going to the Nether that square is
 * 16 Nether blocks, going back it is 128 Overworld blocks, which is the same 128 in Overworld scale. So two portals of
 * different dimensions can link when their Overworld-scale positions are at most 128 apart on both X and Z. The nearest
 * one wins (measured in the destination dimension). With no portal in range the game builds a new one.
 *
 * Seed: where terrain, caves or structures sit cannot be computed here (that needs the game's world generation), so the
 * seed field only builds links into Chunkbase's seed map, centred on the same spot.
 *
 * State (state.portal): dir 'ow' | 'ne' = the side typed in last, x/y/z = that side's coordinates (the other side is
 * derived), seed, portals [{ id, name, dim, x, y, z }], view { x, z, s } for the map. Typing patches the other side, the
 * status and the map in place, so no field loses focus.
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

  /**
   * Obsidian portal: the smallest legal frame (4 x 5 blocks, no corners) around a 2 x 3 portal. Every block is a
   * 4 x 4 pixel texture (obsidian / portal), generated in code and drawn crisp.
   */
  function portalArt() {
    const U = 4, B = 4, CW = 4, CH = 5, PX = U * B;                    // texture pixel, pixels per block edge in blocks, frame size
    const cv = document.createElement('canvas');
    cv.width = CW * PX; cv.height = CH * PX; cv.className = 'pt-art';
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Nether portal');
    const ctx = cv.getContext('2d');
    let seed = 5;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const OBS = ['#0f0a1c', '#160f2b', '#1d1438', '#2a1d4e', '#3a2866'];
    const PORT = ['#4a1590', '#6a22c4', '#8a38e8', '#a455ff', '#c58bff'];
    const block = (bx, by, pal, bias) => {
      for (let j = 0; j < B * 4; j++) for (let i = 0; i < B * 4; i++) {
        let k = Math.floor(rnd() * pal.length * 0.8 + bias);
        k = clamp(k, 0, pal.length - 1);
        ctx.fillStyle = pal[k]; ctx.fillRect(bx * PX + i * (PX / (B * 4)), by * PX + j * (PX / (B * 4)), PX / (B * 4), PX / (B * 4));
      }
    };
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const edge = x === 0 || y === 0 || x === CW - 1 || y === CH - 1;
      if (!edge) continue;
      if ((x === 0 || x === CW - 1) && (y === 0 || y === CH - 1)) continue;   // frame corners stay empty
      block(x, y, OBS, 0);
    }
    for (let y = 1; y < CH - 1; y++) for (let x = 1; x < CW - 1; x++) block(x, y, PORT, 0.6);
    // lit rim on the frame edge nearest the portal
    ctx.fillStyle = 'rgba(190,120,255,.35)';
    ctx.fillRect(PX, PX - 1, 2 * PX, 1); ctx.fillRect(PX, (CH - 1) * PX, 2 * PX, 1);
    ctx.fillRect(PX - 1, PX, 1, 3 * PX); ctx.fillRect(3 * PX, PX, 1, 3 * PX);
    return cv;
  }

  function render(root) {
    const st = S();
    st.view = st.view || { x: 450, z: -700, s: 0.5 };
    const inputs = { ow: {}, ne: {} };
    const statusEl = h('div.pt-status-bar');
    const listEl = h('div.pt-list');
    const mapEl = h('div.pt-map');
    const readout = h('div.pt-readout', 'Hover the map');
    const rowStatus = new Map();
    const seedLinks = [];
    let sel = null, fitted = false;

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
      const seedBtn = h('a.btn.small.pt-seedmap', { target: '_blank', rel: 'noopener', 'aria-disabled': 'true' }, 'Seed map');
      seedLinks.push([d, seedBtn]);
      return h('div.pt-side.pt-side-' + d,
        h('div.pt-side-head', TH.icon(d === 'ow' ? 'wheat' : 'netherite_ingot', { size: 24 }), h('h3', DIMS[d])),
        h('div.pt-fields', fields),
        h('div.pt-side-foot',
          h('button.btn.small.pt-pin', { type: 'button', onclick: () => addPortal(Object.assign({ dim: d }, side(d)), DIMS[d] + ' portal ' + (st.portals.length + 1)) }, 'Save portal'),
          copy, seedBtn));
    }

    function copyText(d, btn) {
      const c = side(d), t = c.x + ' ' + c.y + ' ' + c.z;
      const ok = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1400); };
      try { navigator.clipboard.writeText(t).then(ok, () => TH.util.toast(t)); } catch (e) { TH.util.toast(t); }
    }

    /** Chunkbase seed map, centred on this side's X / Z. */
    function seedUrl(d) {
      const c = side(d), sd = String(st.seed || '').trim();
      if (!sd) return null;
      return 'https://www.chunkbase.com/apps/seed-map#seed=' + encodeURIComponent(sd) + '&platform=java_1_21&dimension=' + (d === 'ow' ? 'overworld' : 'nether') + '&x=' + c.x + '&z=' + c.z;
    }

    function update(keep) {
      ['ow', 'ne'].forEach((d) => {
        const c = side(d);
        ['x', 'y', 'z'].forEach((k) => { const f = inputs[d][k]; if (f !== keep && document.activeElement !== f) f.value = c[k]; });
      });
      seedLinks.forEach(([d, a]) => {
        const u = seedUrl(d);
        if (u) { a.href = u; a.removeAttribute('aria-disabled'); a.title = 'Open Chunkbase at this spot'; }
        else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = 'Enter a seed first'; }
      });
      const p = current();
      const lk = linkOf(p, st.portals);
      const w = warnings(p);
      statusEl.replaceChildren(
        h('div.pt-rule', st.dir === 'ow'
          ? h('span', 'Overworld ÷ 8 = Nether. X and Z only, rounded down. Y stays the same.')
          : h('span', 'Nether × 8 = Overworld. X and Z only. Y stays the same.')),
        h('div.pt-link', lk.to
          ? h('span', 'A portal at the ' + DIMS[p.dim] + ' spot connects to ', h('b', lk.to.name || 'a saved portal'), ' (' + DIMS[lk.to.dim] + ', ' + lk.dist + ' blocks from the target).')
          : h('span', 'No saved portal in range. The game would ', h('b', 'build a new portal'), ' near the ' + DIMS[other(p.dim)] + ' target.')),
        ...(w.length ? [h('ul.pt-warn', w.map((t) => h('li', t)))] : []));
      statuses(); drawMap();
    }

    // ---------- saved portals ----------
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
        const txt = lk.to ? '→ ' + (lk.to.name || 'portal') + ' · ' + lk.dist + ' off' : '→ new portal gets built';
        el.textContent = txt;
        el.title = 'Arrives at ' + DIMS[other(p.dim)] + ' ' + fmt(lk.target.x) + ' ' + fmt(lk.target.y) + ' ' + fmt(lk.target.z) + (lk.to ? ', links to ' + lk.to.name : ', no portal in range');
      }
    }

    function buildList() {
      rowStatus.clear();
      if (!st.portals.length) {
        listEl.replaceChildren(h('div.pt-empty', 'No portals yet. Save the calculator spot, or click the map to place one.'));
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
        const dimBtn = h('button.pt-dimkey' + (p.dim === 'ne' ? '.is-ne' : ''), { type: 'button', title: 'Switch dimension (now ' + DIMS[p.dim] + ')', 'aria-label': 'Dimension: ' + DIMS[p.dim],
          onclick: () => { p.dim = other(p.dim); save(); buildList(); update(); } }, p.dim === 'ow' ? 'OW' : 'NE');
        const del = h('button.icon-btn.pt-del', { type: 'button', 'aria-label': 'Remove ' + p.name,
          onclick: () => { st.portals = st.portals.filter((q) => q !== p); save(); buildList(); update(); } }, '×');
        const go = h('button.icon-btn.pt-go', { type: 'button', title: 'Show on map', 'aria-label': 'Show ' + p.name + ' on map',
          onclick: () => { const c = scaled(p); st.view.x = c.x; st.view.z = c.z; sel = p.id; save(); drawMap(); } }, '◎');
        return h('div.pt-row' + (sel === p.id ? '.is-sel' : ''), { 'data-dim': p.dim, 'data-id': p.id,
          onfocusin: () => { if (sel !== p.id) { sel = p.id; listEl.querySelectorAll('.pt-row').forEach((r) => r.classList.toggle('is-sel', r.dataset.id === p.id)); drawMap(); } } },
        h('div.pt-row-top', dimBtn, name, go, del),
        h('div.pt-row-xyz', coord('x'), coord('y'), coord('z')),
        status);
      }));
    }

    // ---------- technical map ----------
    const NS = 'http://www.w3.org/2000/svg';
    const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for (const key in a) e.setAttribute(key, a[key]); if (txt != null) e.textContent = txt; return e; };
    const STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

    function fitView() {
      const pts = st.portals.map(scaled).concat([scaled(current())]);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      pts.forEach((q) => { x0 = Math.min(x0, q.x - RANGE); x1 = Math.max(x1, q.x + RANGE); z0 = Math.min(z0, q.z - RANGE); z1 = Math.max(z1, q.z + RANGE); });
      const r = mapEl.getBoundingClientRect(), W = r.width || 700, H = r.height || 440;
      st.view.x = (x0 + x1) / 2; st.view.z = (z0 + z1) / 2;
      st.view.s = clamp(Math.min((W - 80) / Math.max(x1 - x0, 64), (H - 80) / Math.max(z1 - z0, 64)), 0.002, 8);
    }

    function drawMap() {
      const r = mapEl.getBoundingClientRect(), W = Math.max(280, r.width || 700), H = Math.max(240, r.height || 440);
      if (!fitted && r.width) { fitted = true; fitView(); }
      const v = st.view, sx = (x) => (x - v.x) * v.s + W / 2, sz = (z) => (z - v.z) * v.s + H / 2;
      const wx = (px) => (px - W / 2) / v.s + v.x, wz = (py) => (py - H / 2) / v.s + v.z;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Technical map of your portals in Overworld coordinates' });
      const x0 = wx(0), x1 = wx(W), z0 = wz(0), z1 = wz(H);

      // grid: chunk lines (16) when zoomed in, then a major step with at least ~70px between lines
      const major = STEPS.find((s) => s * v.s >= 70) || STEPS[STEPS.length - 1];
      const grid = (step, cls) => {
        for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) svg.append(el('line', { x1: sx(x), y1: 0, x2: sx(x), y2: H, class: cls + (x === 0 ? ' pt-axis' : '') }));
        for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) svg.append(el('line', { x1: 0, y1: sz(z), x2: W, y2: sz(z), class: cls + (z === 0 ? ' pt-axis' : '') }));
      };
      if (16 * v.s >= 9 && major !== 16) grid(16, 'pt-g-chunk');
      const mid = STEPS.filter((s) => s < major && s * v.s >= 24).pop();
      if (mid && mid !== 16) grid(mid, 'pt-g-minor');
      grid(major, 'pt-g-major');

      // zones (link range) of every portal and the calculator spot
      const pts = st.portals.map((p) => Object.assign({ p }, scaled(p)));
      const cs = scaled(current());
      pts.forEach((q) => svg.append(el('rect', { x: sx(q.x - RANGE), y: sz(q.z - RANGE), width: RANGE * 2 * v.s, height: RANGE * 2 * v.s, class: 'pt-zone pt-' + q.p.dim + (q.p.id === sel ? ' is-sel' : '') })));
      svg.append(el('rect', { x: sx(cs.x - RANGE), y: sz(cs.z - RANGE), width: RANGE * 2 * v.s, height: RANGE * 2 * v.s, class: 'pt-zone pt-cur' }));

      // links with the distance between target and portal
      pts.forEach((q) => {
        const lk = linkOf(q.p, st.portals);
        if (!lk.to) return;
        const t = scaled(lk.to);
        svg.append(el('line', { x1: sx(q.x), y1: sz(q.z), x2: sx(t.x), y2: sz(t.z), class: 'pt-line' }));
      });

      // portals: square = Overworld, diamond = Nether
      pts.forEach((q) => {
        const cx = sx(q.x), cz = sz(q.z), on = q.p.id === sel, r0 = on ? 7 : 5;
        const g = el('g', { class: 'pt-mark pt-' + q.p.dim });
        g.append(el('title', {}, q.p.name + ' · ' + DIMS[q.p.dim] + ' ' + q.p.x + ' ' + q.p.y + ' ' + q.p.z));
        g.append(q.p.dim === 'ow'
          ? el('rect', { x: cx - r0, y: cz - r0, width: r0 * 2, height: r0 * 2, class: 'pt-pin' })
          : el('rect', { x: cx - r0, y: cz - r0, width: r0 * 2, height: r0 * 2, class: 'pt-pin', transform: `rotate(45 ${cx} ${cz})` }));
        g.append(el('text', { x: cx + 11, y: cz - 7, class: 'pt-lbl' }, q.p.name));
        g.append(el('text', { x: cx + 11, y: cz + 6, class: 'pt-sub' }, q.p.dim === 'ow' ? q.p.x + ', ' + q.p.z : q.p.x + ', ' + q.p.z + ' → ' + q.p.x * 8 + ', ' + q.p.z * 8));
        svg.append(g);
      });
      // calculator spot: crosshair
      const cx = sx(cs.x), cz = sz(cs.z);
      svg.append(el('path', { d: `M${cx - 9} ${cz}H${cx + 9}M${cx} ${cz - 9}V${cz + 9}`, class: 'pt-cross' }));
      svg.append(el('circle', { cx, cy: cz, r: 3.5, class: 'pt-cross-dot' }));

      // axis labels: Overworld on top / left, Nether (divided by 8) underneath
      const lab = (txt, x, y, cls, anchor) => svg.append(el('text', { x, y, class: cls, 'text-anchor': anchor || 'start' }, txt));
      for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
        lab(fmt(x), sx(x) + 4, 12, 'pt-ax');
        lab(fmt(x / 8), sx(x) + 4, 24, 'pt-ax pt-ax-ne');
      }
      for (let z = Math.ceil(z0 / major) * major; z <= z1; z += major) {
        lab(fmt(z), 4, sz(z) - 14, 'pt-ax');
        lab(fmt(z / 8), 4, sz(z) - 3, 'pt-ax pt-ax-ne');
      }
      lab('OW', W - 6, 12, 'pt-ax', 'end'); lab('NE ÷ 8', W - 6, 24, 'pt-ax pt-ax-ne', 'end');

      // scale bar
      const bar = [16, 32, 64, 100, 128, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((b) => b * v.s >= 70) || 100000;
      svg.append(el('path', { d: `M12 ${H - 14}H${12 + bar * v.s}M12 ${H - 19}V${H - 9}M${12 + bar * v.s} ${H - 19}V${H - 9}`, class: 'pt-scale' }));
      lab(fmt(bar) + ' blocks', 16, H - 22, 'pt-ax');
      mapEl.replaceChildren(svg, readout, mapTools);
      mapEl._proj = { wx, wz, W, H };
    }

    // pan / zoom / click / hover
    let drag = null;
    const zoomAt = (px, py, f) => {
      const r = mapEl.getBoundingClientRect(), W = r.width, H = r.height, v = st.view;
      const bx = (px - W / 2) / v.s + v.x, bz = (py - H / 2) / v.s + v.z;
      v.s = clamp(v.s * f, 0.002, 12);
      v.x = bx - (px - W / 2) / v.s; v.z = bz - (py - H / 2) / v.s;
      save(); drawMap();
    };
    mapEl.addEventListener('wheel', (e) => { e.preventDefault(); const r = mapEl.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    mapEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.pt-tools')) return; mapEl.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, vx: st.view.x, vz: st.view.z, moved: false }; });
    mapEl.addEventListener('pointermove', (e) => {
      const r = mapEl.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) { st.view.x = drag.vx - dx / st.view.s; st.view.z = drag.vz - dy / st.view.s; drawMap(); }
      }
      const pr = mapEl._proj; if (!pr) return;
      const x = Math.round(pr.wx(px)), z = Math.round(pr.wz(py));
      readout.replaceChildren(h('span', 'Overworld ', h('b', fmt(x) + ', ' + fmt(z))), h('span', 'Nether ', h('b.ne', fmt(Math.floor(x / 8)) + ', ' + fmt(Math.floor(z / 8)))),
        h('span', 'Chunk ', h('b', Math.floor(x / 16) + ', ' + Math.floor(z / 16))));
    });
    mapEl.addEventListener('pointerup', (e) => {
      const d = drag; drag = null;
      if (!d) return;
      if (d.moved) { save(); return; }
      if (e.target.closest('.pt-tools')) return;
      const r = mapEl.getBoundingClientRect(), pr = mapEl._proj;       // a click places the calculator spot
      Object.assign(st, { dir: 'ow', x: Math.round(pr.wx(e.clientX - r.left)), z: Math.round(pr.wz(e.clientY - r.top)) }); save(); update();
    });
    const mapTools = h('div.pt-tools',
      h('button.btn.small', { type: 'button', 'aria-label': 'Zoom in', onclick: () => { const r = mapEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.5); } }, '+'),
      h('button.btn.small', { type: 'button', 'aria-label': 'Zoom out', onclick: () => { const r = mapEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.5); } }, '−'),
      h('button.btn.small', { type: 'button', onclick: () => { fitView(); save(); drawMap(); } }, 'Fit'));
    new ResizeObserver(() => { if (mapEl.isConnected) drawMap(); }).observe(mapEl);

    const tips = [
      ['Connect a pair', 'Build the second portal within 16 blocks of the converted spot on the Nether side, or within 128 blocks on the Overworld side.'],
      ['Keep pairs apart', 'Nether portals of different pairs need more than 32 blocks between them. Their Overworld partners need more than 256.'],
      ['Java rules', 'Bedrock searches differently, so check links there in game.'],
    ];

    const seed = h('input.field.pt-seed', { id: 'pt-seed', type: 'text', value: st.seed || '', placeholder: 'World seed (optional)', 'aria-label': 'World seed', autocomplete: 'off', spellcheck: false,
      oninput: () => { st.seed = seed.value; save(); update(); } });

    root.append(
      h('div.page-head', h('h2', 'Portal Calculator')),
      h('section.panel.pt-calc', { 'aria-label': 'Convert coordinates' },
        h('div.pt-grid',
          sideCol('ow'),
          h('div.pt-mid',
            h('div.pt-art-wrap', portalArt()),
            h('div.pt-ops', h('span', '÷ 8'), h('span.pt-ops-arrows', { 'aria-hidden': 'true' }, '⇄'), h('span', '× 8'))),
          sideCol('ne')),
        h('div.pt-seedrow', h('label', { for: 'pt-seed' }, 'Seed'), seed,
          h('span.pt-seedhint', 'Opens the same spot in Chunkbase’s seed map. Terrain itself can’t be worked out here.')),
        statusEl),
      h('section.panel.pt-mapbox', { 'aria-label': 'Portal map' },
        h('div.pt-head', h('h3', 'Portal map'), h('span.muted', 'Drag to pan, scroll to zoom, click to place the calculator spot. Squares are the 128 block link range.')),
        h('div.pt-mapgrid',
          h('div.pt-mapcol', mapEl,
            h('div.pt-legend', h('span.pt-key.pt-ow', 'Overworld portal'), h('span.pt-key.pt-ne', 'Nether portal (at ×8)'), h('span.pt-key.pt-cur', 'Calculator spot'))),
          h('div.pt-listwrap',
            h('div.pt-listhead', h('h4', 'Your portals'),
              h('button.btn.small', { type: 'button', onclick: () => addPortal(current(), DIMS[st.dir] + ' portal ' + (st.portals.length + 1)) }, '+ Add')),
            listEl))),
      h('div.pt-tips', tips.map(([t, x]) => h('div.panel.bd-idea', h('h4', t), h('div.muted', x)))));

    buildList();
    update();
    requestAnimationFrame(() => { fitted = false; drawMap(); });
  }

  TH.app.register({
    id: 'portal',
    name: 'Portal Calculator',
    short: 'Portal',
    icon: 'mc:block/crying_obsidian',
    init(store) {
      store.define('portal', { dir: 'ow', x: 800, y: 70, z: -1200, seed: '', portals: SAMPLE });
      const s = store.get().portal;
      if (!Array.isArray(s.portals)) s.portals = [];
    },
    render,
  });
})();
