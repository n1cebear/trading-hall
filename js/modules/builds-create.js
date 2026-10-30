/**
 * Builds > Create > Generate: the generator browser and its settings, plus the shared angle and light controls
 * (also used by the Library's "Angle and light" panel and the quick editor). UI only; the work is done by
 * builds-gen.js, builds-rotate.js and builds-shade.js.
 *
 *   TH.builds.createUI.side(ctx)          -> [panels] for the Generate mode
 *   TH.builds.createUI.angle(o)           -> element: X / Y / Z rows (step keys 22.5 / 45 / 90, −/+, free degrees,
 *                                            a slider), order, pivot, exact / smooth, reset
 *   TH.builds.createUI.light(o)           -> element: compass picker (azimuth around, elevation toward the middle),
 *                                            quick directions, elevation, contrast, steps, dither, occlusion, rim,
 *                                            shadows, ramp, light colour (quick colours, hue, saturation), shadow
 *                                            colour, tint strength, hue shift, block pool
 *   TH.builds.createUI.xfPanel(ctx, key)  -> the Library's non-destructive angle + light of a build
 *   TH.builds.createUI.schem(ctx)         -> the shape on the Create stage (generators and the classic shapes)
 *
 * ctx (from builds.js): { S, save, show, regen, glyph, tip, press, blockPicker, exportAs, keep, toMats, fmtN, toast, edit, V }
 * State: state.builds.shape = { kind, p: { [kind]: params }, block, block2, tab, group, lock }, state.builds.xf[key].
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const { h, clamp } = TH.util;
  const G = () => TH.builds.gen, SH = () => TH.builds.shade, RT = () => TH.builds.rotate, core = () => TH.builds.core, D = () => TH.builds.detail;

  /* ======================================================================
   * Small controls
   * ====================================================================== */
  let uid = 0;
  const nid = (p) => 'bdc-' + p + '-' + (++uid);
  /** Label | slider | stepper. set(v, live) is called on every move (live) and on release. */
  function numRow(c, label, lo, hi, step, val, set, o) {
    o = o || {};
    const id = nid('n');
    const fmt = (v) => (Math.abs(step) < 1 ? String(+(+v).toFixed(1)) : String(Math.round(v)));
    const sl = h('input.slider.bd-num-slider', { type: 'range', min: lo, max: hi, step, value: val, id, 'aria-label': label });
    const inp = h('input.stepper-input', { type: 'number', min: o.free ? null : lo, max: o.free ? null : hi, step: o.free ? 'any' : step, value: fmt(val), 'aria-label': label + (o.unit ? ' (' + o.unit + ')' : '') });
    const fillV = () => sl.style.setProperty('--fill', ((clamp(+sl.value, lo, hi) - lo) / Math.max(1e-9, hi - lo) * 100).toFixed(1) + '%');
    const put = (v, live) => {
      v = +v; if (!Number.isFinite(v)) return;
      if (!o.free) v = clamp(v, lo, hi);
      sl.value = clamp(v, lo, hi); inp.value = fmt(v); fillV(); set(v, live);
    };
    sl.addEventListener('input', () => put(sl.value, true));
    sl.addEventListener('change', () => put(sl.value, false));
    inp.addEventListener('change', () => put(inp.value, false));
    fillV();
    const minus = h('button.step', { type: 'button', 'aria-label': 'Less ' + label.toLowerCase(), onclick: () => put(+inp.value - (o.stepKey || step), false) }, '−');
    const plus = h('button.step', { type: 'button', 'aria-label': 'More ' + label.toLowerCase(), onclick: () => put(+inp.value + (o.stepKey || step), false) }, '+');
    const row = h('div.bd-prow2', { 'data-param': o.pid || null }, h('label.bd-plabel', { for: id }, label), sl, h('div.stepper.bd-stepper', minus, inp, plus));
    if (o.tip && c.tip) c.tip(row.firstChild, o.tip);
    row.setValue = (v) => { sl.value = clamp(v, lo, hi); inp.value = fmt(v); fillV(); };
    return row;
  }
  /** Label | exclusive keys (one sliding knob). */
  function segRow(c, label, choices, val, set, o) {
    o = o || {};
    const btns = choices.map(([v, t, tt]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === val), class: v === val ? 'on' : null, onclick: () => {
        btns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        set(v);
      } }, t);
      if (tt && c.tip) c.tip(b, tt);
      return b;
    });
    const seg = h('div.seg.bd-pseg' + (choices.length > 5 ? '.bd-pseg-many' : ''), { role: 'radiogroup', 'aria-label': o.aria || label }, btns);
    return h('div.bd-prow2.bd-segrow' + (choices.length > 5 ? '.bd-segrow-wide' : ''), { 'data-param': o.pid || null }, h('span.bd-plabel', label), seg);
  }
  function switchRow(c, label, val, set, hint, o) {
    const cb = h('input', { type: 'checkbox', checked: !!val, onchange: () => set(cb.checked) });
    return h('label.bd-prow2.bd-switchrow', { 'data-param': (o && o.pid) || null }, h('span.bd-plabel', label), h('span.bd-switch-hint', hint || ''), h('span.switch', cb, h('span')));
  }
  const sub = (t) => h('div.bd-sub.bd-csub', t);

  /* ======================================================================
   * Angle: X / Y / Z
   * ====================================================================== */
  const STEPS = [[22.5, '22.5°'], [45, '45°'], [90, '90°']];
  let angleStep = 45;
  /**
   * o = { c (ctx), get() -> { x, y, z, order, pivot, smooth, level }, set(patch, live), pivot: bool, smooth: bool, title }
   * The angle keys only change the numbers; the caller re-builds (debounced while a slider moves).
   */
  function angle(o) {
    const c = o.c, cur = o.get();
    const rows = [['x', 'X', 'Pitch: tips the build forward and back (about the east-west axis)'], ['y', 'Y', 'Yaw: turns the build around (about the vertical axis)'], ['z', 'Z', 'Roll: tips the build to the side (about the north-south axis)']].map(([k, L, t]) => {
      const row = numRow(c, L, -180, 180, 0.5, +cur[k] || 0, (v, live) => o.set({ [k]: wrap(v) }, live), { free: true, unit: 'degrees', tip: t, stepKey: angleStep, pid: 'a' + k });
      row.classList.add('bd-angrow');
      return [k, row];
    });
    const wrap = (v) => { let a = ((+v + 180) % 360 + 360) % 360 - 180; if (a === -180 && v > 0) a = 180; return Math.round(a * 100) / 100; };
    const step = segRow(c, 'Step', STEPS.map(([v, t]) => [v, t, 'The − and + keys turn by ' + t]), angleStep, (v) => {
      angleStep = v;
      rows.forEach(([k, row]) => {
        const [mi, inp, pl] = row.querySelectorAll('.stepper > *');
        mi.onclick = null; pl.onclick = null;
        const go = (d) => { const nv = wrap(+inp.value + d * v); row.setValue(nv); o.set({ [k]: nv }, false); };
        mi.replaceWith(Object.assign(h('button.step', { type: 'button', 'aria-label': 'Turn back by ' + v + '°', onclick: () => go(-1) }, '−')));
        pl.replaceWith(Object.assign(h('button.step', { type: 'button', 'aria-label': 'Turn on by ' + v + '°', onclick: () => go(1) }, '+')));
      });
    }, { aria: 'Turn step' });
    // the step keys of every row use the chosen step (re-wired once now)
    step.querySelector('.on').click();
    const order = segRow(c, 'Order', RT().ORDERS.map((x) => [x, x.split('').join(' → '), 'First ' + x[0] + ', then ' + x[1] + ', then ' + x[2]]), cur.order || 'YXZ', (v) => o.set({ order: v }, false), { aria: 'Rotation order' });
    const parts = [h('div.bd-sub.bd-csub', o.title || 'Angle'), ...rows.map((r) => r[1]), step, order];
    if (o.pivot) parts.push(segRow(c, 'Pivot', [['centre', 'Centre', 'Turn about the middle of the build'], ['base', 'Base', 'Turn about the middle of its bottom'], ['corner', 'Corner', 'Turn about its north-west bottom corner']], cur.pivot || 'centre', (v) => o.set({ pivot: v }, false)));
    if (o.smooth) parts.push(segRow(c, 'Edges', [['exact', 'Exact blocks', 'Only the blocks the build has'], ['smooth', 'Smooth edges', 'Stairs and slabs where a slope cuts a block']], cur.smooth ? 'smooth' : 'exact', (v) => o.set({ smooth: v === 'smooth' }, false)));
    const size = h('span.bd-angsize', { 'aria-live': 'polite' });
    const reset = h('button.btn.small', { type: 'button', onclick: () => { rows.forEach(([, row]) => row.setValue(0)); o.set({ x: 0, y: 0, z: 0 }, false); } }, c.glyph ? c.glyph('reset') : null, 'Reset angle');
    if (c.tip) c.tip(reset, 'Back to the build as it was: X, Y and Z at 0');
    parts.push(h('div.bd-actions.bd-angfoot', reset, size));
    const el = h('div.bd-angle', { role: 'group', 'aria-label': o.title || 'Angle' }, parts);
    el.setSize = (t) => { size.textContent = t || ''; };
    return el;
  }

  /* ======================================================================
   * Light
   * ====================================================================== */
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  function hsv(hh, s) { const f = (n) => { const k = (n + hh / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
  function hueSat(rgb) { const mx = Math.max(...rgb), mn = Math.min(...rgb), d = mx - mn; let hh = 0; if (d) { if (mx === rgb[0]) hh = ((rgb[1] - rgb[2]) / d) % 6; else if (mx === rgb[1]) hh = (rgb[2] - rgb[0]) / d + 2; else hh = (rgb[0] - rgb[1]) / d + 4; } return [((hh * 60) + 360) % 360, mx ? d / mx : 0]; }
  /** One colour: quick colours, hue and saturation. */
  function colourRows(c, label, val, set) {
    let [hu, sa] = hueSat(val || [1, 1, 1]);
    const sw = h('span.bd-swatch', { 'aria-hidden': 'true' });
    const paint = (rgb) => { sw.style.background = toHex(rgb); };
    paint(val || [1, 1, 1]);
    const apply = (rgb, live) => { paint(rgb); set(rgb, live); };
    const keys = SH().LIGHT_COLOURS.map(([k, n, rgb]) => {
      const b = h('button.btn.small.bd-ckey', { type: 'button', 'aria-label': n, onclick: () => { [hu, sa] = hueSat(rgb); hueR.setValue(hu); satR.setValue(sa * 100); apply(rgb, false); } }, h('span.bd-swatch', { style: { background: toHex(rgb) } }));
      if (c.tip) c.tip(b, n);
      return b;
    });
    const hueR = numRow(c, 'Hue', 0, 359, 1, hu, (v, live) => { hu = v; apply(hsv(hu, sa), live); }, { unit: '°' });
    const satR = numRow(c, 'Saturation', 0, 100, 1, sa * 100, (v, live) => { sa = v / 100; apply(hsv(hu, sa), live); }, { unit: '%' });
    hueR.classList.add('bd-huerow');
    return [h('div.bd-prow2.bd-colrow', h('span.bd-plabel', label), h('div.bd-ckeys', { role: 'group', 'aria-label': label + ' quick colours' }, keys), sw), hueR, satR];
  }
  /** The compass: azimuth around (north up), elevation from the rim (0) to the middle (straight above). */
  function compass(c, get, set) {
    const S = 132, R = 56, cx = S / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + S + ' ' + S); svg.setAttribute('class', 'bd-compass-svg'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<rect class="ring" x="' + (cx - R) + '" y="' + (cx - R) + '" width="' + 2 * R + '" height="' + 2 * R + '" rx="6"/>' +
      '<path class="cross" d="M' + cx + ' ' + (cx - R) + 'V' + (cx + R) + 'M' + (cx - R) + ' ' + cx + 'H' + (cx + R) + '"/>' +
      '<rect class="mid" x="' + (cx - R / 2) + '" y="' + (cx - R / 2) + '" width="' + R + '" height="' + R + '" rx="4"/>' +
      [['N', cx, 10], ['S', cx, S - 3], ['W', 6, cx + 4], ['E', S - 6, cx + 4]].map(([t, x, y]) => '<text x="' + x + '" y="' + y + '">' + t + '</text>').join('') +
      '<line class="ray" x1="' + cx + '" y1="' + cx + '" x2="' + cx + '" y2="' + cx + '"/><rect class="sun" width="10" height="10" rx="2"/>';
    const sun = svg.querySelector('.sun'), ray = svg.querySelector('.ray');
    const place = () => {
      const { az, el } = get(), r = R * (90 - clamp(el, 0, 90)) / 90, a = az * Math.PI / 180;
      const x = cx + Math.sin(a) * r, y = cx - Math.cos(a) * r;
      sun.setAttribute('x', x - 5); sun.setAttribute('y', y - 5); ray.setAttribute('x2', x); ray.setAttribute('y2', y);
      sun.classList.toggle('below', el < 0);
    };
    const box = h('div.bd-compass', { tabindex: 0, role: 'slider', 'aria-label': 'Light direction: drag around for the azimuth, toward the middle for a higher sun', 'aria-valuemin': 0, 'aria-valuemax': 360 }, svg);
    const at = (e, live) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * S - cx, y = (e.clientY - r.top) / r.height * S - cx;
      const az = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360, el = 90 * (1 - clamp(Math.hypot(x, y) / R, 0, 1));
      set({ az: Math.round(az), el: Math.round(el) }, live); place();
    };
    let drag = false;
    box.addEventListener('pointerdown', (e) => { drag = true; try { box.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } at(e, true); });
    box.addEventListener('pointermove', (e) => { if (drag) at(e, true); });
    const up = (e) => { if (!drag) return; drag = false; at(e, false); };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', () => { drag = false; });
    box.addEventListener('keydown', (e) => {
      const { az, el } = get(), d = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (!d) return;
      e.preventDefault(); set({ az: (az + d[0] + 360) % 360, el: clamp(el + d[1], -90, 90) }, false); place();
    });
    place();
    box.place = place;
    if (c.tip) c.tip(box, 'Drag around the square for the direction, toward the middle for a higher light. Arrow keys work too.');
    return box;
  }
  /**
   * o = { c, get() -> light settings, set(patch, live), onToggle (optional: the on / off switch), follow: bool }
   * Settings: { on, az, el, contrast, steps, dither, ao, rim, shadows, follow, ramp, colour, shadowC, tint, hue, pool }
   */
  function light(o) {
    const c = o.c, L = o.get();
    const parts = [];
    if (o.toggle !== false) parts.push(switchRow(c, 'Light', L.on, (v) => { o.set({ on: v }, false); body.hidden = !v; }, 'shade by direction'));
    const pick = compass(c, () => o.get(), (pt, live) => { elR.setValue(pt.el); azR.setValue(pt.az); o.set(pt, live); });
    const quick = h('div.bd-lkeys', { role: 'group', 'aria-label': 'Quick light directions' }, SH().LIGHT_KEYS.map(([k, t, az, el]) => {
      const b = h('button.btn.small', { type: 'button', onclick: () => { azR.setValue(az); elR.setValue(el); o.set({ az, el }, false); pick.place(); } }, t);
      if (c.tip) c.tip(b, 'Light from ' + t.toLowerCase() + ' (azimuth ' + az + '°, elevation ' + el + '°)');
      return b;
    }));
    const azR = numRow(c, 'Azimuth', 0, 360, 1, L.az, (v, live) => { o.set({ az: v }, live); pick.place(); }, { unit: '°', tip: '0 = from the north, 90 = east, 180 = south (the front), 270 = west' });
    const elR = numRow(c, 'Elevation', -90, 90, 1, L.el, (v, live) => { o.set({ el: v }, live); pick.place(); }, { unit: '°', tip: '90 = straight above, 0 = level with the build, below 0 = from underneath' });
    const ramps = [['palette', 'Palette']].concat(Object.keys(SH().RAMPS).map((k) => [k, SH().RAMP_LABEL[k]]));
    const body = h('div.bd-lightbody', { hidden: o.toggle !== false && !L.on },
      h('div.bd-lpick', pick, quick), azR, elR,
      numRow(c, 'Contrast', 30, 250, 5, L.contrast, (v, live) => o.set({ contrast: v }, live), { unit: '%' }),
      numRow(c, 'Steps', 3, 9, 1, L.steps, (v, live) => o.set({ steps: v }, live), { tip: 'How many blocks of the ramp are used, shadow to highlight' }),
      numRow(c, 'Dither', 0, 100, 1, L.dither, (v, live) => o.set({ dither: v }, live), { unit: '%', tip: '0 = clean bands, more = a smoother mix at the borders' }),
      numRow(c, 'Occlusion', 0, 100, 1, L.ao, (v, live) => o.set({ ao: v }, live), { unit: '%', tip: 'Blocks in corners and crevices get darker' }),
      numRow(c, 'Rim light', 0, 100, 1, L.rim, (v, live) => o.set({ rim: v }, live), { unit: '%', tip: 'A light edge where the lit side turns into shadow' }),
      switchRow(c, 'Shadows', L.shadows, (v) => o.set({ shadows: v }, false), 'cast by the build'),
      o.follow ? switchRow(c, 'Turns with it', L.follow, (v) => o.set({ follow: v }, false), 'light follows the angle') : null,
      o.ramp !== false ? segRow(c, 'Ramp', ramps.filter((r) => o.paletteRamp !== false || r[0] !== 'palette'), L.ramp, (v) => o.set({ ramp: v }, false), { aria: 'Block ramp' }) : null,
      sub('Light colour'),
      ...colourRows(c, 'Light', L.colour, (rgb, live) => o.set({ colour: rgb }, live)),
      switchRow(c, 'Shadow colour', !!L.shadowC, (v) => { o.set({ shadowC: v ? [0.4, 0.5, 1] : null }, false); shBody.hidden = !v; }, 'its own tint in the shadow'),
      (function () { const b = h('div.bd-shbody', { hidden: !L.shadowC }, ...colourRows(c, 'Shadow', L.shadowC || [0.4, 0.5, 1], (rgb, live) => o.set({ shadowC: rgb }, live))); return b; })(),
      numRow(c, 'Tint', 0, 100, 1, L.tint, (v, live) => o.set({ tint: v }, live), { unit: '%', tip: '0 = the plain ramp; more = blocks picked by colour toward the light colour' }),
      numRow(c, 'Hue shift', 0, 100, 1, L.hue, (v, live) => o.set({ hue: v }, live), { unit: '%', tip: 'Shadows drift cooler, highlights warmer' }),
      segRow(c, 'Pick from', SH().POOLS.filter((x) => x[0] !== 'custom'), L.pool || 'all', (v) => o.set({ pool: v }, false), { aria: 'Blocks the colour may pick' }));
    const shBody = body.querySelector('.bd-shbody');
    parts.push(body);
    return h('div.bd-light', { role: 'group', 'aria-label': 'Light' }, parts);
  }

  /* ======================================================================
   * Generate: the browser and the settings
   * ====================================================================== */
  const BASIC = () => TH.builds.shapes.SHAPES;
  const isGen = (k) => !!(G() && G().byId(k));
  const TAB_ORDER = ['shape', 'size', 'surface', 'glow', 'detail', 'angle', 'light', 'blocks'];
  /** Params of the classic shapes (builds-shapes.js) in the generators' format, plus an angle. */
  function basicParams(kind) {
    const sh = BASIC()[kind], out = [];
    sh.params.forEach(([id, label, lo, hi, def]) => {
      if (id === 'centre') out.push({ id, label: 'Centre', g: 'shape', t: 'seg', ch: [['block', 'On a block', 'Odd width: the middle is one block'], ['edge', 'Between', 'Even width: the middle falls between blocks']], def: 'block' });
      else if (['hollow', 'ring', 'floor', 'caps'].includes(id)) out.push({ id, label: id === 'caps' && kind === 'cone' ? 'Base' : label, g: 'shape', t: 'bool' });
      else if (id === 'axis') out.push({ id, label: 'Axis', g: 'shape', t: 'seg', ch: [['y', 'Lying'], ['x', 'East–west'], ['z', 'North–south']], def: 'y' });
      else if (id === 'preset') out.push({ id, label: 'Kind', g: 'shape', t: 'seg', ch: Object.entries(TH.builds.shapes.TREE_PRESETS).map(([k, v]) => [k, v.name]), def: 'oak' });
      else if (id === 'seed') out.push({ id, label: 'Seed', g: 'shape', t: 'seed', def: 1 });
      else out.push({ id, label, g: 'shape', t: 'num', min: lo, max: hi, def, step: 1, when: id === 'thick' ? (p) => p.hollow || p.ring : null });
    });
    ['ax', 'ay', 'az'].forEach((id) => out.push({ id, g: 'angle', t: 'num', angle: true }));
    out.push({ id: 'order', g: 'angle', t: 'seg' }, { id: 'rsmooth', g: 'angle', t: 'bool' });
    out.push({ id: 'block', g: 'blocks', t: 'basicBlock' });
    return out;
  }
  function paramsOf(kind) { return isGen(kind) ? G().params(kind) : basicParams(kind); }
  function valuesOf(c, kind) {
    const st = c.S().shape, raw = st.p[kind] || {};
    if (isGen(kind)) return G().clean(kind, raw);
    const d = TH.builds.shapes.defaults()[kind];
    return Object.assign({ ax: 0, ay: 0, az: 0, order: 'YXZ', rsmooth: false }, d, raw);
  }

  /** The shape on the Create stage: a generator, or a classic shape turned by its angle. */
  const cache = { sig: '', s: null };
  function schem(c, fast) {
    const st = c.S().shape, kind = st.kind;
    if (isGen(kind)) {
      const raw = st.p[kind] || {}, sig = 'g|' + kind + JSON.stringify(raw);
      if (sig !== cache.sig) { cache.s = G().gen(kind, raw); cache.sig = sig; }
      return cache.s;
    }
    const base = c.basicSchem();
    const v = valuesOf(c, kind);
    if (!v.ax && !v.ay && !v.az) return base;
    const sig = 'b|' + kind + JSON.stringify(st.p[kind] || {}) + (base && base.name) + (fast ? 'f' : '');
    if (sig !== cache.sig) { cache.s = RT().rotate(base, { x: v.ax, y: v.ay, z: v.az, order: v.order, smooth: v.rsmooth, level: 'medium', fast }); cache.sig = sig; }
    return cache.s;
  }

  function side(c) {
    const st = c.S().shape;
    if (!isGen(st.kind) && !BASIC()[st.kind]) c.save((b) => { b.shape.kind = 'crystal'; });
    if (!st.group) st.group = isGen(st.kind) ? G().byId(st.kind).group : 'shapes';
    return [browser(c), settings(c), actions(c)];
  }
  const GROUP_NOTE = { crystals: 'Huge crystals, clusters, shards, geodes', monoliths: 'Slabs, obelisks, stone circles, rune stones', nature: 'Rocks, mountains, volcanoes, mushrooms', shapes: 'Spheres, domes, arches, helixes, ziggurats' };
  function browser(c) {
    const st = c.S().shape, groups = G().GROUPS;
    const tiles = h('div.bd-gens', { role: 'list' });
    const count = h('span.bd-count');
    const fill = () => {
      const g = c.S().shape.group;
      const fams = G().FAMILIES.filter((f) => f.group === g);
      const list = fams.map((f) => [f.id, f.name, f]).concat(g === 'shapes' ? Object.entries(BASIC()).map(([k, v]) => [k, v.name, null]) : []);
      tiles.replaceChildren(...list.map(([k, name, f]) => {
        const on = c.S().shape.kind === k;
        const b = h('button.btn.bd-gen' + (on ? '.on' : ''), { type: 'button', role: 'listitem', 'aria-pressed': String(on), onclick: () => { if (c.S().shape.kind === k) return; c.save((bb) => { bb.shape.kind = k; }); c.show('shape', { animate: true, layer: 'top' }); c.patch(); } },
          c.genArt(k), h('span.bd-gen-name', name));
        c.tip(b, () => [h('div.th-tooltip-title', name), f && f.variants ? h('div.th-tooltip-sub', f.variants.map((v) => v[0]).join(' · ')) : h('div.th-tooltip-sub', 'Classic shape')]);
        return b;
      }));
      count.textContent = list.length + ' generators';
    };
    const seg = h('div.seg.bd-gengrp', { role: 'radiogroup', 'aria-label': 'Generator group' }, groups.map(([id, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.group === id), class: st.group === id ? 'on' : null, onclick: () => {
        seg.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        c.save((bb) => { bb.shape.group = id; }); fill(); note.textContent = GROUP_NOTE[id];
      } }, label);
      return b;
    }));
    const note = h('p.bd-note', GROUP_NOTE[st.group] || '');
    fill();
    return h('section.panel.bd-pan.bd-genpanel.has-sel', { 'aria-label': 'Generators' }, h('div.bd-pan-head', h('h3', 'Generate'), count), seg, note, tiles);
  }

  /** Settings: variants on top, then one tab per group of parameters (only the open tab is shown; switching only toggles `hidden`). */
  function settings(c) {
    const st = c.S().shape, kind = st.kind, gen = isGen(kind), fam = gen ? G().byId(kind) : null;
    const name = gen ? fam.name : BASIC()[kind].name;
    const P = paramsOf(kind);
    const v = valuesOf(c, kind);
    const size = h('span.bd-count.bd-shape-size', { 'aria-live': 'polite' });
    const set = (patch, live) => {
      c.save((b) => { const p = b.shape.p[kind] || (b.shape.p[kind] = {}); Object.assign(p, patch); });
      Object.assign(v, patch);
      sync();
      c.regen(live);
    };
    // groups present, in a fixed order
    const groups = TAB_ORDER.filter((g) => P.some((q) => q.g === g));
    const tab = groups.includes(st.tab) ? st.tab : groups[0];
    const panes = {};
    groups.forEach((g) => { panes[g] = h('div.bd-ppane', { role: 'tabpanel', hidden: g !== tab, 'aria-label': (G().GROUP_LABEL[g] || g) }); });
    // tab keys wrap onto a second row on narrow panels, so they are single keys, not one sliding-knob seg
    const tabs = h('div.bd-ptabs', { role: 'tablist', 'aria-label': 'Settings' }, groups.map((g) => {
      const b = h('button.btn.small', { type: 'button', role: 'tab', 'aria-selected': String(g === tab), class: g === tab ? 'on' : null, onclick: () => {
        tabs.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
        Object.entries(panes).forEach(([k, el]) => { el.hidden = k !== g; });
        c.save((bb) => { bb.shape.tab = g; });
      } }, G().GROUP_LABEL[g] || g);
      return b;
    }));
    // rows per group
    const rows = [];
    const lockRow = () => switchRow(c, 'Keep ratio', !!st.lock, (on) => c.save((b) => { b.shape.lock = on; }), 'width, depth and height together');
    P.forEach((q) => {
      const pane = panes[q.g];
      if (!pane || q.angle || q.id === 'order' || q.id === 'rsmooth' || /^l[A-Z]/.test(q.id) || q.id === 'light') return;
      let row = null;
      if (q.t === 'num') {
        if (q.dim) {
          row = numRow(c, q.label, q.min, q.max, q.step || 1, v[q.id], (val, live) => {
            const patch = { [q.id]: val };
            if (c.S().shape.lock && v[q.id] > 0) {
              const k = val / v[q.id];
              ['w', 'd', 'h'].forEach((o) => { if (o !== q.id && v[o] != null) { const pq = P.find((x) => x.id === o); patch[o] = clamp(Math.round(v[o] * k), pq.min, pq.max); const r = pane.querySelector('[data-param="' + o + '"]'); if (r && r.setValue) r.setValue(patch[o]); } });
            }
            set(patch, live);
          }, { unit: q.unit, tip: q.tip, pid: q.id });
        } else row = numRow(c, q.label, q.min, q.max, q.step || 1, v[q.id], (val, live) => set({ [q.id]: val }, live), { unit: q.unit, tip: q.tip, pid: q.id });
      } else if (q.t === 'seg' && q.palette) row = paletteRow(c, q, v[q.id], (val) => set({ [q.id]: val }, false));
      else if (q.t === 'seg') row = segRow(c, q.label, q.ch, v[q.id], (val) => { set({ [q.id]: val }, false); }, { pid: q.id });
      else if (q.t === 'bool') row = switchRow(c, q.label, v[q.id], (val) => set({ [q.id]: val }, false), q.tip || '', { pid: q.id });
      else if (q.t === 'seed') row = seedRow(c, v.seed, (val) => set({ seed: val }, false));
      else if (q.t === 'kinds') row = kindsRow(c, v, (val) => set({ off: val }, false));
      else if (q.t === 'block') row = partRow(c, q, v[q.id], (val) => set({ [q.id]: val }, false));
      else if (q.t === 'basicBlock') row = c.basicBlocks();
      if (!row) return;
      if (q.when) rows.push([q, row]);
      pane.append(row);
      if (q.id === 'h' && q.g === 'size') pane.append(lockRow());
    });
    if (panes.angle) panes.angle.append(angle({ c, get: () => ({ x: v.ax, y: v.ay, z: v.az, order: v.order, smooth: v.rsmooth }), set: (pt, live) => {
      const m = {}; if ('x' in pt) m.ax = pt.x; if ('y' in pt) m.ay = pt.y; if ('z' in pt) m.az = pt.z; if (pt.order) m.order = pt.order; if ('smooth' in pt) m.rsmooth = pt.smooth;
      set(m, live);
    }, smooth: !gen, title: gen ? 'Angle (the shape is generated at this angle)' : 'Angle' }));
    if (panes.light) panes.light.append(light({ c, follow: true, get: () => ({ on: v.light, az: v.lAz, el: v.lEl, contrast: v.lCon, steps: v.lSteps, dither: v.lDither, ao: v.lAo, rim: v.lRim, shadows: v.lShadow, follow: v.lFollow, ramp: v.lRamp, colour: v.lColour, shadowC: v.lShadowC, tint: v.lTint, hue: v.lHue, pool: v.lPool }),
      set: (pt, live) => { const map = { on: 'light', az: 'lAz', el: 'lEl', contrast: 'lCon', steps: 'lSteps', dither: 'lDither', ao: 'lAo', rim: 'lRim', shadows: 'lShadow', follow: 'lFollow', ramp: 'lRamp', colour: 'lColour', shadowC: 'lShadowC', tint: 'lTint', hue: 'lHue', pool: 'lPool' }, m = {}; Object.keys(pt).forEach((k) => { m[map[k]] = pt[k]; }); set(m, live); } }));
    if (panes.surface && gen) panes.surface.prepend(styleKeys(c, (patch) => { set(patch, false); c.patch(); }));
    function sync() { rows.forEach(([q, row]) => row.classList.toggle('off', !q.when(v))); }
    sync();
    const variants = gen && fam.variants && fam.variants.length ? h('div.bd-variants', { role: 'group', 'aria-label': 'Variants' }, fam.variants.map(([label, patch]) => {
      const b = h('button.btn.small', { type: 'button', onclick: () => { c.save((bb) => { bb.shape.p[kind] = Object.assign({ seed: (bb.shape.p[kind] || {}).seed || 1 }, patch); }); c.regen(false); c.patch(); c.toast(label); } }, label);
      c.tip(b, () => [h('div.th-tooltip-title', label), h('div.th-tooltip-sub', 'Starts from the defaults with ' + Object.entries(patch).map(([k, x]) => k + ' ' + (Array.isArray(x) ? x.join(' ') : x)).join(', '))]);
      return b;
    })) : null;
    const resetAll = h('button.btn.small', { type: 'button', onclick: () => { c.save((b) => { b.shape.p[kind] = {}; }); c.regen(false); c.patch(); } }, c.glyph('reset'), 'Defaults');
    c.tip(resetAll, 'Every setting of this generator back to its default');
    const panel = h('section.panel.bd-pan.bd-params', { 'aria-label': name + ' settings' },
      h('div.bd-pan-head', h('h3', name), size), variants ? [sub('Variants'), variants] : null, tabs, ...groups.map((g) => panes[g]), h('div.bd-actions', resetAll));
    panel.size = size;
    c.UI().createSize = size;
    try { const s = schem(c); size.textContent = s.size.join(' × ') + ' · ' + c.fmtN(core().volume(s)) + ' blocks'; } catch (e) { size.textContent = e.user ? e.message : 'Could not build'; }
    return panel;
  }
  /** Surface styles: quick picks that set roughness, weathering, moss and cracks together. */
  function styleKeys(c, set) {
    const S2 = [['Clean', { rough: 0, weather: 0, moss: 0, cracks: 0 }], ['Ancient', { rough: 15, weather: 35, moss: 10, cracks: 30 }], ['Overgrown', { rough: 20, weather: 25, moss: 75, cracks: 10 }], ['Weathered', { rough: 45, weather: 65, moss: 15, cracks: 45 }]];
    return h('div.bd-prow2.bd-colrow', h('span.bd-plabel', 'Style'), h('div.bd-variants', S2.map(([l, p]) => { const b = h('button.btn.small', { type: 'button', onclick: () => set(p) }, l); c.tip(b, Object.entries(p).map(([k, x]) => k + ' ' + x + '%').join(' · ')); return b; })));
  }
  function seedRow(c, seed, set) {
    const lbl = h('span.bd-seed', '#' + seed);
    const inp = h('input.field.bd-seedin', { type: 'number', min: 1, value: seed, 'aria-label': 'Seed number', onchange: () => { const n = Math.max(1, Math.round(+inp.value || 1)); lbl.textContent = '#' + n; set(n); } });
    const roll = h('button.btn.small', { type: 'button', onclick: () => { const n = 1 + Math.floor(Math.random() * 99999); inp.value = n; lbl.textContent = '#' + n; set(n); } }, c.glyph('dice'), 'Re-roll');
    c.tip(roll, 'A new random seed: the same settings, another build. The number brings it back.');
    return h('div.bd-prow2.bd-seedrow', h('span.bd-plabel', 'Seed'), inp, roll);
  }
  function kindsRow(c, v, set) {
    const lvl = D().LEVELS[v.detail] || [];
    const off = new Set(v.off || []);
    const keys = D().KINDS.map((k) => {
      const inLvl = lvl.includes(k), on = inLvl && !off.has(k);
      const b = h('button.btn.small.bd-kind' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), disabled: !inLvl, onclick: () => {
        if (off.has(k)) off.delete(k); else off.add(k);
        const now = !off.has(k); b.classList.toggle('on', now); b.setAttribute('aria-pressed', String(now));
        set([...off]);
      } }, D().KIND_LABEL[k]);
      c.tip(b, inLvl ? (on ? 'Used: click to leave ' + D().KIND_LABEL[k].toLowerCase() + ' out' : 'Left out: click to use it again') : 'Not used at this detail level');
      return b;
    });
    return h('div.bd-prow2.bd-colrow', h('span.bd-plabel', 'Parts'), h('div.bd-kinds', { role: 'group', 'aria-label': 'Block parts the detail pass may use' }, keys));
  }
  function paletteRow(c, q, val, set) {
    const btns = q.ch.map(([k, label]) => {
      const pal = G().PALETTES[k], icon = 'minecraft:' + (pal.body[Math.min(1, pal.body.length - 1)]);
      const on = k === val;
      const b = h('button.btn.bd-paltile' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => {
        btns.forEach((x) => { const o2 = x === b; x.classList.toggle('on', o2); x.setAttribute('aria-checked', String(o2)); });
        set(k);
      } }, core().blockIcon(icon, { size: 24 }), h('span', label));
      c.tip(b, () => [h('div.th-tooltip-title', label), h('div.th-tooltip-sub', pal.body.map((n) => core().nameOf('minecraft:' + n)).join(' → '))]);
      return b;
    });
    return h('div.bd-palgrid', { role: 'radiogroup', 'aria-label': 'Palette' }, btns);
  }
  /** One part of the palette (body, base, trim ...): the palette's gradient, or one block of your own. */
  function partRow(c, q, val, set) {
    const btn = h('button.btn.bd-swap', { type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      c.closePickers();
      if (open) return;
      btn.setAttribute('aria-expanded', 'true');
      btn.after(c.blockPicker({ ids: core().buildingBlocks(), current: val || 'minecraft:air', label: 'Pick the ' + q.label.toLowerCase() + ' block', onPick: (id) => { set(id); c.patch(); } }));
    } }, val ? core().blockIcon(val, { size: 24 }) : h('span.bd-palchip', { 'aria-hidden': 'true' }), h('span.bd-swap-txt', h('span.bd-swap-name', val ? core().nameOf(val) : 'From the palette'), h('span.bd-swap-was', q.label)), c.glyph('swap', 'bd-swap-ico'));
    const reset = val ? h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Back to the palette', onclick: () => { set(null); c.patch(); } }, c.glyph('reset')) : null;
    if (reset) c.tip(reset, 'Back to the palette gradient');
    return h('div.bd-partrow', btn, reset);
  }
  function actions(c) {
    const s = () => schem(c);
    const dl = (fmt) => () => { try { c.exportAs(s(), fmt); } catch (e) { c.toast(e.message); } };
    return h('section.panel.bd-pan.bd-create-acts', { 'aria-label': 'Use this shape' },
      h('div.bd-actions',
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.replay() }, c.glyph('replay'), 'Build it'), 'Watch it being built, block by block'),
        c.tip(h('button.btn.small.primary', { type: 'button', onclick: dl('schem') }, c.glyph('down'), '.schem'), '.schem (Sponge 2): WorldEdit, FAWE, Axiom, Litematica'),
        c.tip(h('button.btn.small', { type: 'button', onclick: dl('litematic') }, '.litematic'), 'Litematica schematic'),
        c.tip(h('button.btn.small', { type: 'button', onclick: dl('json') }, 'JSON'), 'This toolbox’s own format')),
      h('div.bd-actions',
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.edit(s()) }, c.glyph('plus'), 'Edit by hand'), 'Open it in Make it myself and change it block by block'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.keep(s()) }, c.glyph('file'), 'Keep in Library'), 'Add it to your builds in the Library'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.toMats('shape') }, 'Material list'), 'The blocks it needs, with recipes and packing')));
  }

  /* ======================================================================
   * Library: angle and light of any build (non-destructive, saved per build)
   * ====================================================================== */
  const XF_LIGHT = { on: false, az: 225, el: 50, contrast: 100, steps: 6, dither: 60, ao: 40, rim: 0, shadows: false, ramp: 'stone', colour: [1, 1, 1], shadowC: null, tint: 0, hue: 0, pool: 'all' };
  function xfOf(c, key) { const x = (c.S().xf || {})[key] || {}; return { x: x.x || 0, y: x.y || 0, z: x.z || 0, order: x.order || 'YXZ', pivot: x.pivot || 'centre', smooth: !!x.smooth, light: Object.assign({}, XF_LIGHT, x.light || {}) }; }
  /** The build with its angle and light applied (cached per key and settings). fast: the quick preview while dragging. */
  const xfCache = new Map();
  function applyXf(c, key, s, fast) {
    const x = (c.S().xf || {})[key];
    if (!s || !x) return s;
    const sig = JSON.stringify(x) + (fast ? 'f' : '');
    const hit = xfCache.get(key);
    if (hit && hit.src === s && hit.sig === sig) return hit.s;
    let out = s;
    if (x.x || x.y || x.z) out = RT().rotate(out, { x: x.x, y: x.y, z: x.z, order: x.order, pivot: x.pivot, smooth: x.smooth, level: 'medium', fast });
    const L = x.light;
    if (L && L.on) {
      const ramp = SH().rampOf(L.ramp || 'stone');
      out = SH().shade(out, { az: L.az, el: L.el, ramp, steps: L.steps, contrast: L.contrast / 100, dither: L.dither / 100, ao: L.ao / 100, rim: L.rim / 100, shadows: L.shadows, colour: (L.tint || L.hue) ? { light: L.colour, shadow: L.shadowC, tint: L.tint / 100, hue: L.hue / 100, pool: L.pool } : null });
    }
    xfCache.set(key, { src: s, sig, s: out });
    return out;
  }
  function xfPanel(c, key) {
    const cur = xfOf(c, key);
    const n = (cur.x || cur.y || cur.z ? 1 : 0) + (cur.light.on ? 1 : 0);
    let tm = 0;
    const set = (patch, live) => {
      c.save((b) => { b.xf = b.xf || {}; const x = b.xf[key] || (b.xf[key] = {}); Object.assign(x, patch); if (!x.x && !x.y && !x.z && !(x.light && x.light.on)) delete b.xf[key]; });
      clearTimeout(tm);
      tm = setTimeout(() => { c.show(key, { keepView: true, fast: live }); ang.setSize(c.UI().shown ? 'New size ' + c.UI().shown.size.join(' × ') : ''); }, live ? 120 : 0);
    };
    const ang = angle({ c, get: () => xfOf(c, key), set: (pt, live) => set(pt, live), pivot: true, smooth: true, title: 'Angle' });
    const lt = light({ c, paletteRamp: false, get: () => xfOf(c, key).light, set: (pt, live) => set({ light: Object.assign(xfOf(c, key).light, pt) }, live) });
    const sh = c.UI().shown;
    if (sh) ang.setSize('Size ' + sh.size.join(' × '));
    return h('section.panel.bd-pan.bd-xf' + (n ? '.has-sel' : ''), { 'aria-label': 'Angle and light' },
      h('div.bd-pan-head', h('h3', 'Angle and light'), h('span.bd-count', n ? 'changed' : 'as it came')),
      h('p.bd-note', 'Turn the build about X, Y and Z and shade it from a light. The original stays as it is: reset to go back. Downloads and the Material List use what you see.'),
      ang, sub('Light'), lt,
      h('div.bd-actions', c.tip(h('button.btn.small', { type: 'button', onclick: () => c.edit(c.effective(key)) }, c.glyph('plus'), 'Edit by hand'), 'Open this build in Make it myself')));
  }

  /* Tile art: 11 x 11 pixel pictures, '#' = body, '+' = shade (drawn by builds.js shapeArt). */
  const GEN_ART = {
    crystal: ['.....#.....', '....##+....', '....##+....', '...###++...', '...###++...', '...###++...', '...###++...', '...###++...', '...###++...', '..####+++..', '.#########.'],
    quartz2: ['.....#.....', '....##+....', '...###++...', '...###++...', '...###++...', '...###++...', '...###++...', '...###++...', '....##+....', '.....#.....', '...........'],
    cluster: ['.....#.....', '..#..#+..#.', '..#+.#+.#+.', '..#+##++#+.', '.##+##++#+.', '.##+##++##+', '.##+##++##+', '.##+##++##+', '##########+', '+++++++++++', '...........'],
    shard: ['......#....', '.....##+...', '....###+...', '...####++..', '..#####++..', '..####+++..', '...###++...', '...##++....', '....#+.....', '...........', '.#.......+.'],
    geode: ['...#####...', '..#++++##..', '.#+.#.#.##.', '#+.#.#.#.#+', '#+#.#.#.##+', '#+.#.#.#.#+', '#+#.#.#.##+', '.#+.#.#.#+.', '..#+++++#..', '...#####...', '...........'],
    spire: ['.....#.....', '.....#.....', '.....#+....', '....##+....', '....##+....', '....##+....', '...###++...', '...###++...', '.#.###++.#.', '.#####+++#+', '###########'],
    prism: ['...........', '.....#.....', '....###....', '...##+++...', '...##+++...', '...##+++...', '...##+++...', '...##+++...', '...##+++...', '...##+++...', '...#####...'],
    bipyramid: ['.....#.....', '....##+....', '...###++...', '..####+++..', '.#####++++.', '..####+++..', '...###++...', '....##+....', '.....#.....', '...........', '...........'],
    slab: ['...........', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '...#####+..', '..#########'],
    obelisk: ['.....#.....', '....##+....', '....##+....', '....##+....', '....##+....', '...###++...', '...###++...', '...###++...', '...###++...', '..#######..', '.#########.'],
    broken: ['...........', '...........', '...........', '...........', '...##+.....', '...###.....', '...##+.....', '...##+.....', '...##+..###', '...##+.####', '..######+++'],
    menhir: ['...........', '....##.....', '...###+....', '...###++...', '...###++...', '..####++...', '..####++...', '..####+++..', '..####+++..', '..#####++..', '.#########.'],
    henge: ['...........', '...........', '.#########.', '.#+..#+..#+', '.#+..#+..#+', '.#+..#+..#+', '.#+..#+..#+', '.#+..#+..#+', '.#+..#+..#+', '###########', '...........'],
    dolmen: ['...........', '...........', '...........', '.#########+', '..+++++++..', '..#+...#+..', '..#+...#+..', '..#+...#+..', '..#+...#+..', '###########', '...........'],
    alignment: ['...........', '...........', '.#.........', '.#+.#......', '.#+.#+.#...', '.#+.#+.#+.#', '.#+.#+.#+.#', '.#+.#+.#+.#', '.#+.#+.#+.#', '###########', '...........'],
    totem: ['...#####...', '..#######..', '...##+##...', '...#.#.#...', '...##+##...', '..#######..', '...#+#+#...', '...##+##...', '...#.#.#...', '..#######..', '.#########.'],
    runestone: ['...........', '...####....', '..######...', '..#+#+##+..', '..##+#+#+..', '..#+##+#+..', '..##+#+#+..', '..#+#+##+..', '..##+#+#+..', '..######+..', '.#########.'],
    floating: ['.+.......+.', '...#####...', '...#####+..', '+..#####+..', '...#####+.+', '...#####+..', '...#####+..', '...........', '...........', '..#######..', '.#########.'],
    split: ['...........', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '..##+.##+..', '.#########.'],
    stepped: ['...........', '....###....', '....###+...', '...#####...', '...#####+..', '..#######..', '..#######+.', '.#########.', '.#########+', '###########', '...........'],
    twisted: ['.....#.....', '....##.....', '....+##....', '.....##+...', '....##+....', '...##+.....', '....+##....', '.....##+...', '....##+....', '...###+....', '..#######..'],
    rock: ['...........', '...........', '...........', '....####...', '..#######..', '.#####+##+.', '.####+++##+', '.#####++##+', '###########', '+++++++++++', '...........'],
    mountain: ['...........', '.....#.....', '....###....', '....##+#...', '...####++..', '..#####+++.', '..######++.', '.#########+', '###########', '+++++++++++', '...........'],
    volcano: ['...........', '...........', '....#.#....', '...##.##...', '...###+#...', '..####++#..', '..#####++#.', '.#####+++#.', '###########', '+++++++++++', '...........'],
    crater: ['...........', '...........', '...........', '...........', '.##.....##.', '###.....###', '####...####', '#####+#####', '###########', '+++++++++++', '...........'],
    waterfall: ['######+....', '######+....', '###++#+....', '###++#+....', '###++#+....', '###++#+....', '###++#+....', '###++#+....', '###++#+++..', '#####++++++', '...........'],
    mushroom: ['...#####...', '.#########.', '###+##+####', '###########', '+++++++++++', '....##+....', '....##+....', '....##+....', '....##+....', '...####+...', '...........'],
    ziggurat: ['...........', '...........', '....###....', '...#####...', '...#+#+#...', '..#######..', '..#+#+#+#..', '.#########.', '.#+#+#+#+#.', '###########', '...........'],
    arch: ['...........', '.#########.', '###########', '###+...+###', '##+.....+##', '##.......##', '##.......##', '##.......##', '##.......##', '##.......##', '...........'],
    helix: ['....###....', '...#...#...', '....###+...', '...#.+.#...', '....###....', '...#...#+..', '....###....', '...#.+.#...', '....###+...', '...#...#...', '....###....'],
  };

  TH.builds.createUI = { GEN_ART, side, angle, light, xfPanel, applyXf, schem, numRow, segRow, switchRow, isGen, paramsOf, valuesOf, compass, XF_LIGHT };
})();
