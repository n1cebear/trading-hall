/**
 * Portal Calculator (crimson accent). Converter Overworld <-> Nether (a direction seg, the source fields, an animated
 * obsidian portal, the result well), saved portals with a live link check, and a technical map (grid, chunk lines, both
 * coordinate scales, pan / zoom) in Overworld scale.
 *
 * Layout: left column = Converter + Saved portals, right column = the map (a stage of the shared height --stage-h,
 * sticky). Stacked below 1100px (converter, map, saved portals).
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
 * State (state.portal): dir 'ow' | 'ne' = the source side of the converter, x/y/z = the source coordinates (the result
 * is derived; switching the direction keeps the spot: the old result becomes the new source), seed,
 * portals [{ id, name, dim, x, y, z }], view { x, z, s } for the map. Typing patches the result, the status, the list
 * statuses and the map in place (no re-render, no field loses focus).
 *
 * Textures (literal strings for tools/build-icon-list.js): 'block/obsidian', 'block/crying_obsidian',
 * 'block/nether_portal', 'block/grass_block_side', 'block/netherrack'.
 */
(function () {
  const { h, clamp } = TH.util;
  const RANGE = 128;                       // link square half-width, Overworld scale
  const LIMIT = 29999984;                  // world border
  const DIMS = { ow: 'Overworld', ne: 'Nether' };
  const DIM_ICON = { ow: 'block/grass_block_side', ne: 'block/netherrack' };
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
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  let lastSel = null;                      // selected saved portal, kept across re-renders (module memory, not saved)
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Pixel glyphs (16 x 16 grid, drawn as masks in the text colour). */
  const GLYPH = {
    copy: 'M5 1h9v1h1v10h-1v1H5v-1H4V2h1zM6 3v8h7V3zM1 4h2v2H2v7h1v1h7v-1h2v2h-1v1H2v-1H1z',
    save: 'M2 1h10l3 3v10l-1 1H2l-1-1V2zM4 3v3h7V3zM4 9v4h8V9z',
    edit: 'M11 1h2l2 2v2l-1 1-3-3zM9 4l3 3-7 7H2v-3z',
    del: 'M3 2l5 5 5-5 1 1-5 5 5 5-1 1-5-5-5 5-1-1 5-5-5-5z',
    map: 'M1 2h3l4 2 4-2h3v12h-3l-4-2-4 2H1zM3 4v8h1V4zM7 5v7h2V5zM12 4v8h1V4z',
    plus: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
    minus: 'M2 7h12v2H2z',
    fit: 'M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z',
    link: 'M2 7h5V5l4 3-4 3V9H2zM9 2h5v12H9v-2h3V4H9z',
  };
  const glyph = (k) => {
    const s = h('span.pt-ico', { 'aria-hidden': 'true' });
    s.style.setProperty('--m', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><path d='${GLYPH[k]}'/></svg>`)}")`);
    return s;
  };

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

  /** A nether portal: the smallest obsidian frame (4 x 5 blocks) around 2 x 3 animated portal blocks, real textures. */
  function portalArt(lit, cls) {
    const tex = TH.icon.tex;
    const cells = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      const inner = r > 0 && r < 4 && c > 0 && c < 3;
      if (inner) {
        cells.push(lit ? h('i.pt-pcell', { style: { gridArea: `${r + 1} / ${c + 1}` } }, h('img', { src: tex('block/nether_portal'), alt: '', draggable: false }))
          : h('i.pt-void', { style: { gridArea: `${r + 1} / ${c + 1}` } }));
        continue;
      }
      const crying = (r === 4 && c === 2) || (r === 0 && c === 0) || (r === 2 && c === 3);
      cells.push(h('i.pt-obs', { style: { gridArea: `${r + 1} / ${c + 1}`, backgroundImage: `url("${tex(crying ? 'block/crying_obsidian' : 'block/obsidian')}")` } }));
    }
    return h('div.pt-art' + (lit ? '.is-lit' : '') + (cls ? '.' + cls : ''), { role: 'img', 'aria-label': lit ? 'Nether portal' : 'Empty portal frame' }, cells);
  }

  function render(root) {
    const st = S();
    st.view = st.view || { x: 450, z: -700, s: 0.5 };
    if (st.dir !== 'ne') st.dir = 'ow';
    let sel = st.portals.some((p) => p.id === lastSel) ? lastSel : null;
    let editing = null, fitted = false;

    const src = () => ({ x: st.x, y: st.y, z: st.z });
    const dst = () => toOther(src(), st.dir);
    const side = (d) => (st.dir === d ? src() : dst());
    const current = () => ({ dim: st.dir, x: st.x, y: st.y, z: st.z });

    // ---------- converter ----------
    const dirBtns = ['ow', 'ne'].map((d) => h('button', { type: 'button', role: 'radio', 'data-d': d,
      onclick: () => setDir(d) }, DIMS[d], h('span.pt-arrow', { 'aria-hidden': 'true' }, '→'), DIMS[other(d)]));
    const dirSeg = h('div.seg.pt-dir', { role: 'radiogroup', 'aria-label': 'Convert from' }, dirBtns);
    dirSeg.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault(); const d = other(st.dir); setDir(d); dirBtns.find((b) => b.dataset.d === d).focus();
    });

    const sideHead = (role) => {
      const ico = h('span.pt-dim-ico'), name = h('span.pt-dim-name'), cap = h('span.pt-dim-cap', role === 'src' ? 'From' : 'To');
      return { el: h('div.pt-dim', ico, h('span.pt-dim-txt', cap, name)), set: (d) => { ico.replaceChildren(TH.icon(DIM_ICON[d], { size: 20 })); name.textContent = DIMS[d]; } };
    };
    const srcHead = sideHead('src'), dstHead = sideHead('dst');

    const inputs = {};
    const fields = ['x', 'y', 'z'].map((k) => {
      const f = h('input.field', {
        id: 'pt-in-' + k, type: 'number', inputMode: 'numeric', step: 1, value: st[k], autocomplete: 'off',
        oninput: () => { st[k] = num(f.value); save(); update(f); },
        onchange: () => { f.value = st[k]; },
      });
      inputs[k] = f;
      return h('label.pt-in', h('span.pt-axis-k', k.toUpperCase()), f);
    });
    const outs = {};
    const wellCells = ['x', 'y', 'z'].map((k) => { outs[k] = h('b.pt-out-v'); return h('div.pt-out', h('span.pt-axis-k', k.toUpperCase()), outs[k]); });
    const well = h('output.pt-well', { 'aria-live': 'polite', for: 'pt-in-x pt-in-y pt-in-z' }, wellCells);

    function copyKey(get, label) {
      const txt = h('span', 'Copy');
      const b = h('button.btn.small.pt-key', { type: 'button', onclick: () => {
        const t = get();
        const ok = () => { txt.textContent = 'Copied'; b.classList.add('is-done'); setTimeout(() => { txt.textContent = 'Copy'; b.classList.remove('is-done'); }, 1400); };
        try { navigator.clipboard.writeText(t).then(ok, () => TH.util.toast(t)); } catch (e) { TH.util.toast(t); }
      } }, glyph('copy'), txt);
      return tip(b, () => 'Copy ' + label() + ' as "' + get() + '"');
    }
    const coordTxt = (c) => c.x + ' ' + c.y + ' ' + c.z;
    const saveKey = (get) => tip(h('button.btn.small.pt-key', { type: 'button', onclick: () => { const p = get(); addPortal(p, DIMS[p.dim] + ' portal ' + (st.portals.length + 1)); } }, glyph('save'), 'Save'),
      () => 'Save this ' + DIMS[get().dim] + ' spot as a portal');
    const seedKey = (dimOf) => {
      const a = h('a.btn.small.pt-key.pt-seedmap', { target: '_blank', rel: 'noopener', onclick: (e) => { if (!a.href) { e.preventDefault(); seed.focus(); } } }, glyph('map'), 'Seed map');
      a._dim = dimOf;
      return tip(a, () => (seedUrl(dimOf()) ? 'Open Chunkbase’s seed map at this ' + DIMS[dimOf()] + ' spot' : 'Enter the world seed below first'));
    };
    const srcSeed = seedKey(() => st.dir), dstSeed = seedKey(() => other(st.dir));

    const srcBox = h('div.pt-src', h('div.pt-side-head', srcHead.el), h('div.pt-fields', fields),
      h('div.pt-keys', copyKey(() => coordTxt(src()), () => DIMS[st.dir]), saveKey(current), srcSeed));
    const dstBox = h('div.pt-dst', h('div.pt-side-head', dstHead.el), well,
      h('div.pt-keys', copyKey(() => coordTxt(dst()), () => DIMS[other(st.dir)]), saveKey(() => Object.assign({ dim: other(st.dir) }, dst())), dstSeed));

    const ratioOp = h('b.pt-op'), ratioTxt = h('span.pt-op-txt');
    const art = portalArt(true);
    const gate = h('div.pt-gate', h('div.pt-art-wrap', art), h('div.pt-ratio', ratioOp, ratioTxt));

    const statusEl = h('div.pt-status', { 'aria-live': 'polite' });
    const seed = h('input.field.pt-seed', { id: 'pt-seed', type: 'text', value: st.seed || '', placeholder: 'World seed (optional)', autocomplete: 'off', spellcheck: false,
      oninput: () => { st.seed = seed.value; save(); update(); } });
    const calcPanel = h('section.panel.pt-pan.pt-calc', { 'aria-labelledby': 'pt-h-calc' },
      h('div.pt-pan-head', h('h3', { id: 'pt-h-calc' }, 'Converter'), dirSeg),
      srcBox, gate, dstBox, statusEl,
      h('div.pt-seedrow', h('label.pt-eyebrow', { for: 'pt-seed' }, 'Seed'), seed));

    function setDir(d) {
      if (d === st.dir) return;
      const r = dst();
      Object.assign(st, { dir: d, x: r.x, y: r.y, z: r.z });
      ['x', 'y', 'z'].forEach((k) => { inputs[k].value = st[k]; });
      save(); update();
      if (!reduced()) { gate.classList.remove('is-flip'); void gate.offsetWidth; gate.classList.add('is-flip'); }
    }
    gate.addEventListener('animationend', (e) => { if (e.animationName === 'pt-flip') gate.classList.remove('is-flip'); });

    /** Chunkbase seed map, centred on this side's X / Z. */
    function seedUrl(d) {
      const c = side(d), sd = String(st.seed || '').trim();
      if (!sd) return null;
      return 'https://www.chunkbase.com/apps/seed-map#seed=' + encodeURIComponent(sd) + '&platform=java_1_21&dimension=' + (d === 'ow' ? 'overworld' : 'nether') + '&x=' + c.x + '&z=' + c.z;
    }

    function update(keep) {
      const d = st.dir;
      dirBtns.forEach((b) => { const on = b.dataset.d === d; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      srcHead.set(d); dstHead.set(other(d));
      calcPanel.dataset.dir = d;
      ['x', 'y', 'z'].forEach((k) => {
        const f = inputs[k];
        f.setAttribute('aria-label', DIMS[d] + ' ' + k.toUpperCase());
        if (f !== keep && document.activeElement !== f) f.value = st[k];
      });
      const r = dst();
      ['x', 'y', 'z'].forEach((k) => { outs[k].textContent = fmt(r[k]); });
      well.setAttribute('aria-label', DIMS[other(d)] + ' ' + r.x + ' ' + r.y + ' ' + r.z);
      ratioOp.textContent = d === 'ow' ? '÷ 8' : '× 8';
      ratioTxt.textContent = d === 'ow' ? 'X and Z, rounded down · Y stays' : 'X and Z · Y stays';
      [srcSeed, dstSeed].forEach((a) => {
        const u = seedUrl(a._dim());
        if (u) { a.href = u; a.removeAttribute('aria-disabled'); } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
      });

      const p = current();
      const lk = linkOf(p, st.portals);
      const w = warnings(p);
      calcPanel.classList.toggle('has-sel', !!lk.to);
      statusEl.replaceChildren(
        h('p.pt-link' + (lk.to ? '.is-linked' : ''), lk.to
          ? [h('span.pt-tag', 'Links'), h('span', 'A portal here connects to ', h('b', lk.to.name || 'a saved portal'), ', ' + lk.dist + ' blocks from the target.')]
          : [h('span.pt-tag', 'New'), h('span', st.portals.length ? 'No saved ' + DIMS[other(p.dim)] + ' portal in range. The game builds a new one near the result.' : 'Nothing saved yet. The game builds a new portal near the result.')]),
        ...w.map((t) => h('p.pt-warn', h('span.pt-tag', '!'), h('span', t))));
      statuses(); drawMap();
    }

    // ---------- saved portals ----------
    const listEl = h('div.pt-list.th-scroll');
    const countEl = h('span.pt-count');
    const rowStatus = new Map();
    const savedPanel = h('section.panel.pt-pan.pt-saved', { 'aria-labelledby': 'pt-h-saved' },
      h('div.pt-pan-head', h('h3', { id: 'pt-h-saved' }, 'Saved portals'), countEl),
      listEl);

    function select(id, centre) {
      sel = id; lastSel = id;
      if (centre && id) { const p = st.portals.find((q) => q.id === id); if (p) { const c = scaled(p); st.view.x = c.x; st.view.z = c.z; save(); } }
      listEl.querySelectorAll('.pt-row').forEach((r) => {
        const on = r.dataset.id === id;
        r.classList.toggle('is-sel', on);
        const m = r.querySelector('.pt-strip'); m.classList.toggle('on', on); m.setAttribute('aria-pressed', String(on));
      });
      savedPanel.classList.toggle('has-sel', !!id);
      mapPanel.classList.toggle('has-sel', !!id);
      drawMap();
    }

    function addPortal(p, name) {
      const q = { id: TH.util.uid('pt'), name, dim: p.dim, x: p.x, y: p.y, z: p.z };
      st.portals.push(q); save(); buildList(); select(q.id, false); update();
      TH.util.toast('Saved ' + name);
    }
    function removePortal(p) {
      TH.util.guard(true, 'Remove the portal "' + (p.name || 'Unnamed') + '"?', () => {
        st.portals = st.portals.filter((q) => q !== p);
        if (sel === p.id) sel = null;
        if (editing === p.id) editing = null;
        save(); buildList(); select(sel, false); update();
      });
    }

    function statuses() {
      for (const p of st.portals) {
        const el = rowStatus.get(p.id);
        if (!el) continue;
        const lk = linkOf(p, st.portals);
        el.classList.toggle('is-linked', !!lk.to);
        el.replaceChildren(glyph('link'), h('span', lk.to ? (lk.to.name || 'portal') + ' · ' + lk.dist + ' off' : 'builds a new portal'));
        el._tip = 'Arrives at ' + DIMS[other(p.dim)] + ' ' + fmt(lk.target.x) + ' ' + fmt(lk.target.y) + ' ' + fmt(lk.target.z) + (lk.to ? ', links to ' + lk.to.name : ', no portal in range');
      }
      countEl.textContent = st.portals.length ? String(st.portals.length) : '';
    }

    function editor(p, row) {
      const coord = (k) => {
        const f = h('input.field', { type: 'number', step: 1, inputMode: 'numeric', value: p[k], 'aria-label': (p.name || 'Portal') + ' ' + k.toUpperCase(),
          oninput: () => { p[k] = num(f.value); save(); patchRow(p, row); update(); }, onchange: () => { f.value = p[k]; } });
        return h('label.pt-in', h('span.pt-axis-k', k.toUpperCase()), f);
      };
      const name = h('input.field.pt-name', { type: 'text', value: p.name, maxLength: 40, 'aria-label': 'Portal name', placeholder: 'Name',
        oninput: () => { p.name = name.value; save(); patchRow(p, row); update(); } });
      const dimBtns = ['ow', 'ne'].map((d) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(p.dim === d), class: p.dim === d ? 'on' : null,
        onclick: () => {
          if (p.dim === d) return;
          p.dim = d; save();
          dimBtns.forEach((b, i) => { const on = ['ow', 'ne'][i] === d; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
          patchRow(p, row); update();
        } }, DIMS[d]));
      return h('div.pt-edit',
        h('div.pt-edit-top', name, h('div.seg.pt-dimseg', { role: 'radiogroup', 'aria-label': 'Dimension of ' + (p.name || 'portal') }, dimBtns)),
        h('div.pt-fields.pt-fields-sm', coord('x'), coord('y'), coord('z')),
        h('div.pt-keys',
          tip(h('button.btn.small', { type: 'button', onclick: () => {
            Object.assign(st, { dir: p.dim, x: p.x, y: p.y, z: p.z }); save(); update();
            calcPanel.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
          } }, 'Use in converter'), 'Put this portal into the converter'),
          h('button.btn.small', { type: 'button', onclick: () => { editing = null; buildList(); select(sel, false); } }, 'Done')));
    }

    function patchRow(p, row) {
      row.dataset.dim = p.dim;
      row.querySelector('.pt-row-name').textContent = p.name || 'Unnamed';
      row.querySelector('.pt-row-xyz').textContent = p.x + ' · ' + p.y + ' · ' + p.z;
      row.querySelector('.pt-row-dim').textContent = DIMS[p.dim];
      row.querySelector('.pt-row-ico').replaceChildren(TH.icon(DIM_ICON[p.dim], { size: 24 }));
    }

    function buildList() {
      rowStatus.clear();
      if (!st.portals.length) {
        listEl.replaceChildren(h('div.pt-empty', portalArt(false, 'is-small'),
          h('div.pt-empty-txt', h('b', 'No portals saved yet'), h('span', 'Save a spot from the converter. Each saved portal shows where it leads and whether it links up.'))));
        statuses();
        return;
      }
      listEl.replaceChildren(...st.portals.map((p) => {
        const status = h('span.pt-rstatus');
        rowStatus.set(p.id, status);
        const on = sel === p.id;
        const strip = h('button.btn.pt-strip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on),
          onclick: () => select(sel === p.id ? null : p.id, sel !== p.id) },
          h('span.pt-row-ico', TH.icon(DIM_ICON[p.dim], { size: 24 })),
          h('span.pt-row-txt',
            h('span.pt-row-name'),
            h('span.pt-row-meta', h('span.pt-row-dim'), h('span.pt-row-xyz'))),
          status);
        tip(status, () => status._tip || '');
        const row = h('div.pt-row' + (on ? '.is-sel' : '') + (editing === p.id ? '.is-edit' : ''), { 'data-id': p.id, 'data-dim': p.dim },
          h('div.pt-row-main', strip,
            tip(h('button.pt-x', { type: 'button', 'aria-label': 'Edit ' + p.name, 'aria-expanded': String(editing === p.id),
              onclick: () => { editing = editing === p.id ? null : p.id; if (editing) sel = p.id; buildList(); select(sel, false); } }, glyph('edit')), 'Edit'),
            tip(h('button.pt-x.pt-x-del', { type: 'button', 'aria-label': 'Remove ' + p.name, onclick: () => removePortal(p) }, glyph('del')), 'Remove')));
        if (editing === p.id) row.append(editor(p, row));
        patchRow(p, row);
        return row;
      }));
      statuses();
    }

    // ---------- technical map ----------
    const mapEl = h('div.pt-map', { tabIndex: 0, 'aria-label': 'Portal map. Arrow keys pan, plus and minus zoom.' });
    const readout = h('div.pt-readout', h('span', 'Hover the map'));
    const NS = 'http://www.w3.org/2000/svg';
    const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for (const key in a) e.setAttribute(key, a[key]); if (txt != null) e.textContent = txt; return e; };
    const STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

    function fitView() {
      const pts = st.portals.map(scaled).concat([scaled(current())]);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      pts.forEach((q) => { x0 = Math.min(x0, q.x - RANGE); x1 = Math.max(x1, q.x + RANGE); z0 = Math.min(z0, q.z - RANGE); z1 = Math.max(z1, q.z + RANGE); });
      const r = mapEl.getBoundingClientRect(), W = Math.max(240, r.width || 700), H = Math.max(200, r.height || 440);
      st.view.x = (x0 + x1) / 2; st.view.z = (z0 + z1) / 2;
      st.view.s = clamp(Math.min((W - 120) / Math.max(x1 - x0, 64), (H - 120) / Math.max(z1 - z0, 64)), 0.002, 8);
    }

    function drawMap() {
      if (!mapEl.isConnected) return;
      const r = mapEl.getBoundingClientRect(), W = Math.max(200, r.width || 700), H = Math.max(200, r.height || 440);
      if (!fitted && r.width > 200 && r.height > 150) { fitted = true; fitView(); }
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
      const zone = (x, z, cls) => el('rect', { x: sx(x - RANGE), y: sz(z - RANGE), width: RANGE * 2 * v.s, height: RANGE * 2 * v.s, rx: 2, class: cls });
      pts.forEach((q) => svg.append(zone(q.x, q.z, 'pt-zone pt-' + q.p.dim + (q.p.id === sel ? ' is-sel' : ''))));
      svg.append(zone(cs.x, cs.z, 'pt-zone pt-cur'));

      // links: a dashed line from each portal to the one it arrives at
      pts.forEach((q) => {
        const lk = linkOf(q.p, st.portals);
        if (!lk.to) return;
        const t = scaled(lk.to);
        svg.append(el('line', { x1: sx(q.x), y1: sz(q.z), x2: sx(t.x), y2: sz(t.z), class: 'pt-line' + (q.p.id === sel || lk.to.id === sel ? ' is-sel' : '') }));
      });

      // portals: square = Overworld, diamond = Nether; the selected one last, on top
      // labels never overlap: walk the marks top to bottom and push a label down past the ones it would cover
      const placed = [];
      const labelY = (cx, cz, w) => {
        let y = cz;
        for (let n = 0; n < 12; n++) {
          const hit = placed.find((b) => Math.abs(b.y - y) < 27 && cx + 12 < b.x + b.w && cx + 12 + w > b.x);
          if (!hit) break;
          y = hit.y + 27;
        }
        placed.push({ x: cx + 12, y, w });
        return y;
      };
      const ly = new Map();
      pts.slice().sort((a, b) => a.z - b.z || a.x - b.x).forEach((q) => {
        const w = Math.max(q.p.name.length * 7.4, 90);
        ly.set(q.p.id, labelY(sx(q.x), sz(q.z), w));
      });
      const order = pts.slice().sort((a, b) => (a.p.id === sel) - (b.p.id === sel));
      order.forEach((q) => {
        const cx = sx(q.x), cz = sz(q.z), on = q.p.id === sel, r0 = on ? 7 : 5, y = ly.get(q.p.id);
        const g = el('g', { class: 'pt-mark pt-' + q.p.dim + (on ? ' is-sel' : ''), 'data-id': q.p.id });
        g.append(el('title', {}, q.p.name + ' · ' + DIMS[q.p.dim] + ' ' + q.p.x + ' ' + q.p.y + ' ' + q.p.z + (q.p.dim === 'ne' ? ' (Overworld scale ' + q.p.x * 8 + ', ' + q.p.z * 8 + ')' : '')));
        if (y !== cz) g.append(el('path', { d: `M${cx + 5} ${cz + 3}L${cx + 10} ${y - 4}`, class: 'pt-leader' }));
        g.append(el('rect', Object.assign({ x: cx - r0, y: cz - r0, width: r0 * 2, height: r0 * 2, rx: 1.5, class: 'pt-pin' },
          q.p.dim === 'ne' ? { transform: `rotate(45 ${cx} ${cz})` } : {})));
        g.append(el('text', { x: cx + 12, y: y - 4, class: 'pt-lbl' }, q.p.name));
        g.append(el('text', { x: cx + 12, y: y + 9, class: 'pt-sub' }, (q.p.dim === 'ow' ? 'OW ' : 'NE ') + q.p.x + ', ' + q.p.z));
        svg.append(g);
      });
      // calculator spot: crosshair with a square centre
      const cx = sx(cs.x), cz = sz(cs.z);
      svg.append(el('path', { d: `M${cx - 11} ${cz}H${cx - 4}M${cx + 4} ${cz}H${cx + 11}M${cx} ${cz - 11}V${cz - 4}M${cx} ${cz + 4}V${cz + 11}`, class: 'pt-cross' }));
      svg.append(el('rect', { x: cx - 2.5, y: cz - 2.5, width: 5, height: 5, class: 'pt-cross-dot' }));

      // axis labels: Overworld on top / left, Nether (divided by 8) underneath
      const lab = (txt, x, y, cls, anchor) => svg.append(el('text', { x, y, class: cls, 'text-anchor': anchor || 'start' }, txt));
      for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
        if (sx(x) < 56 || sx(x) > W - 190) continue;                    // keep the corners for the Z labels and the zoom keys
        lab(fmt(x), sx(x) + 4, 14, 'pt-ax');
        lab(fmt(x / 8), sx(x) + 4, 27, 'pt-ax pt-ax-ne');
      }
      for (let z = Math.ceil(z0 / major) * major; z <= z1; z += major) {
        if (sz(z) < 44 || sz(z) > H - 40) continue;
        lab(fmt(z), 6, sz(z) - 15, 'pt-ax');
        lab(fmt(z / 8), 6, sz(z) - 3, 'pt-ax pt-ax-ne');
      }

      // scale bar
      const bar = [16, 32, 64, 100, 128, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((b) => b * v.s >= 70) || 100000;
      const by = H - 18, bx = W - 16 - bar * v.s;
      svg.append(el('path', { d: `M${bx} ${by}H${W - 16}M${bx} ${by - 5}V${by + 5}M${W - 16} ${by - 5}V${by + 5}`, class: 'pt-scale' }));
      lab(fmt(bar) + ' blocks', W - 16, by - 9, 'pt-ax', 'end');
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
    const zoomMid = (f) => { const r = mapEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
    mapEl.addEventListener('wheel', (e) => { e.preventDefault(); const r = mapEl.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    mapEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pt-tools') || e.button > 0) return;
      mapEl.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, vx: st.view.x, vz: st.view.z, moved: false };
      mapEl.classList.add('is-grab');
    });
    mapEl.addEventListener('pointermove', (e) => {
      const r = mapEl.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) { st.view.x = drag.vx - dx / st.view.s; st.view.z = drag.vz - dy / st.view.s; drawMap(); }
      }
      const pr = mapEl._proj; if (!pr || e.target.closest('.pt-tools')) return;
      const x = Math.round(pr.wx(px)), z = Math.round(pr.wz(py));
      readout.classList.add('is-live');
      readout.replaceChildren(h('span', 'OW ', h('b', fmt(x) + ', ' + fmt(z))), h('span', 'NE ', h('b.ne', fmt(Math.floor(x / 8)) + ', ' + fmt(Math.floor(z / 8)))),
        h('span', 'Chunk ', h('b', Math.floor(x / 16) + ', ' + Math.floor(z / 16))));
    });
    const endDrag = (e) => {
      const d = drag; drag = null; mapEl.classList.remove('is-grab');
      if (!d || e.type === 'pointercancel') return;
      if (d.moved) { save(); return; }
      if (e.target.closest('.pt-tools')) return;
      const mk = e.target.closest('.pt-mark');                       // a click on a portal selects it
      if (mk) { select(mk.dataset.id === sel ? null : mk.dataset.id, false); const row = listEl.querySelector(`.pt-row[data-id="${mk.dataset.id}"]`); if (row && sel) row.scrollIntoView({ block: 'nearest' }); return; }
      const r = mapEl.getBoundingClientRect(), pr = mapEl._proj;       // a click elsewhere places the converter spot (Overworld)
      const x = Math.round(pr.wx(e.clientX - r.left)), z = Math.round(pr.wz(e.clientY - r.top));
      Object.assign(st, { dir: 'ow', x, z }); save(); update();
    };
    mapEl.addEventListener('pointerup', endDrag);
    mapEl.addEventListener('pointercancel', endDrag);
    mapEl.addEventListener('keydown', (e) => {
      const pan = 60 / st.view.s;
      const k = { ArrowLeft: [-pan, 0], ArrowRight: [pan, 0], ArrowUp: [0, -pan], ArrowDown: [0, pan] }[e.key];
      if (k) { e.preventDefault(); st.view.x += k[0]; st.view.z += k[1]; save(); drawMap(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomMid(1.5); }
      else if (e.key === '-') { e.preventDefault(); zoomMid(1 / 1.5); }
    });
    const mapTools = h('div.pt-tools',
      tip(h('button.btn.small.pt-tool', { type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomMid(1.5) }, glyph('plus')), 'Zoom in'),
      tip(h('button.btn.small.pt-tool', { type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomMid(1 / 1.5) }, glyph('minus')), 'Zoom out'),
      tip(h('button.btn.small.pt-tool', { type: 'button', 'aria-label': 'Fit all portals', onclick: () => { fitView(); save(); drawMap(); } }, glyph('fit')), 'Fit all portals'));
    let ro = null;
    ro = new ResizeObserver(() => { if (!mapEl.isConnected) { ro.disconnect(); return; } drawMap(); });
    ro.observe(mapEl);

    const legend = h('div.pt-legend',
      h('span.pt-key-ow', 'Overworld portal'), h('span.pt-key-ne', 'Nether portal, at ×8'), h('span.pt-key-cur', 'Converter spot'), h('span.pt-key-zone', '128 block link range'));
    const mapPanel = h('section.panel.pt-pan.pt-mapbox', { 'aria-labelledby': 'pt-h-map' },
      h('div.pt-pan-head', h('h3', { id: 'pt-h-map' }, 'Map'), h('span.pt-note', 'Overworld scale · drag to pan, scroll to zoom, click to set the spot')),
      mapEl, legend);

    root.append(
      h('div.page-head', h('h2', 'Portal Calculator')),
      h('div.pt-page', calcPanel, mapPanel, savedPanel));

    buildList();
    select(sel, false);
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
