/**
 * Builds > Create > Generate: one fixed flow for every generator, plus the shared angle, light and resize controls
 * (also used by the Library's "Angle, light and size" panel and the quick editor). UI only; the work is done by
 * builds-gen.js, builds-rotate.js, builds-shade.js, builds-inside.js and builds-resize.js.
 *
 * The Generate screen, top to bottom, the same for every generator:
 *   Generate panel   group switch (Crystals, Monoliths, Nature, Shapes) over the generator tiles
 *   Settings panel   name + size readout, Variants (quick starts), then four step keys in a fixed order:
 *                    Shape (the 3-6 parameters that define it, width / depth / height, Variation)
 *                    Inside (solid, hollow, open, cavity; wall; fill; supports)
 *                    Materials (palette tiles showing their ramp from shadow to highlight)
 *                    Finish (a Look, the light, the glow, the detail)
 *                    Every step shows its few main controls; the rest sits behind ONE "More" key per step.
 *   Output panel     Build it, .schem, .litematic, JSON, Edit by hand, Keep in Library, Material list
 * Controls: one slider style (slider + stepper with the unit), one exclusive-keys style (.seg), one switch style,
 * one swatch style. A slider re-builds 140 ms after it rests (release builds at once); the camera stays.
 *
 * ctx (from builds.js): { S, save, show, regen, glyph, tip, press, blockPicker, exportAs, keep, toMats, fmtN, toast, edit, V, peek }
 * State: state.builds.shape = { kind, p: { [kind]: params }, block, block2, step, group, lock, more: { [step]: true } },
 * state.builds.xf[key] = { x, y, z, order, pivot, smooth, light: {...}, resize: { size, mode } }.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const { h, clamp } = TH.util;
  const G = () => TH.builds.gen, SH = () => TH.builds.shade, RT = () => TH.builds.rotate, core = () => TH.builds.core, D = () => TH.builds.detail, RS = () => TH.builds.resize, IN = () => TH.builds.inside;

  /* ======================================================================
   * Controls (one style each)
   * ====================================================================== */
  let uid = 0;
  const nid = (p) => 'bdc-' + p + '-' + (++uid);
  /** Label | slider | stepper (with its unit). set(v, live) is called while sliding (live) and on release. */
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
    // short units sit in the stepper (%, °) or after the label (blocks); a longer one ("% of height") goes in the tooltip
    const u = o.unit || '', inStep = u === '%' || u === '°' || /^% /.test(u), short = !inStep && u.length <= 6;
    const lab = h('label.bd-plabel', { for: id }, label, short && u ? h('small.bd-unit', u) : null);
    const row = h('div.bd-prow2', { 'data-param': o.pid || null }, lab, sl, h('div.stepper.bd-stepper', minus, inp, h('span.bd-sunit', { 'aria-hidden': 'true' }, inStep ? u.slice(0, 1) : ''), plus));
    const tipT = [o.tip, inStep && u.length > 1 ? 'In ' + u : !short && u ? 'In ' + u : ''].filter(Boolean).join(' · ');
    if (tipT && c.tip) c.tip(lab, tipT);
    row.setValue = (v) => { sl.value = clamp(v, lo, hi); inp.value = fmt(v); fillV(); };
    return row;
  }
  /** Label | exclusive keys (one sliding knob; wraps on narrow panels). */
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
    const many = choices.length > 4;
    const seg = h('div.seg.bd-pseg' + (many ? '.bd-pseg-many' : ''), { role: 'radiogroup', 'aria-label': o.aria || label }, btns);
    const lab = h('span.bd-plabel', label);
    if (o.tip && c.tip) c.tip(lab, o.tip);
    return h('div.bd-prow2.bd-segrow' + (many ? '.bd-segrow-wide' : ''), { 'data-param': o.pid || null }, lab, seg);
  }
  function switchRow(c, label, val, set, hint, o) {
    const cb = h('input', { type: 'checkbox', checked: !!val, onchange: () => set(cb.checked) });
    return h('label.bd-prow2.bd-switchrow', { 'data-param': (o && o.pid) || null }, h('span.bd-plabel', label), h('span.bd-switch-hint', hint || ''), h('span.switch', cb, h('span')));
  }
  const sub = (t) => h('div.bd-sub.bd-csub', t);
  /** One "More" key per step: the less used settings fold out under it (toggles `hidden`, nothing re-renders). */
  function more(c, key, rows) {
    const list = rows.filter(Boolean);
    if (!list.length) return null;
    const st = c.S().shape.more || {}, open = !!st[key];
    const body = h('div.bd-morebody', { hidden: !open }, list);
    const b = h('button.bd-link.bd-morekey', { type: 'button', 'aria-expanded': String(open), onclick: () => {
      const now = body.hidden; body.hidden = !now; b.setAttribute('aria-expanded', String(now)); b.textContent = now ? '− Less' : '+ More';
      c.save((bb) => { bb.shape.more = Object.assign({}, bb.shape.more || {}, { [key]: now }); });
    } }, open ? '− Less' : '+ More');
    if (c.tip) c.tip(b, 'The less used settings of this step');
    return [b, body];
  }

  /* ======================================================================
   * Angle: X / Y / Z
   * ====================================================================== */
  const STEPS = [[22.5, '22.5°'], [45, '45°'], [90, '90°']];
  let angleStep = 45;
  function angle(o) {
    const c = o.c, cur = o.get();
    const wrap = (v) => { let a = ((+v + 180) % 360 + 360) % 360 - 180; if (a === -180 && v > 0) a = 180; return Math.round(a * 100) / 100; };
    const rows = [['x', 'X', 'Tips the build forward and back (pitch, about the east-west line)'], ['y', 'Y', 'Turns the build around (yaw, about the up line)'], ['z', 'Z', 'Tips the build to the side (roll, about the north-south line)']].map(([k, L, t]) => {
      const row = numRow(c, L, -180, 180, 0.5, +cur[k] || 0, (v, live) => o.set({ [k]: wrap(v) }, live), { free: true, unit: '°', tip: t, stepKey: angleStep, pid: 'a' + k });
      row.classList.add('bd-angrow');
      return [k, row];
    });
    const rewire = (v) => rows.forEach(([k, row]) => {
      const keys = row.querySelectorAll('.stepper > button'), inp = row.querySelector('.stepper-input');
      const go = (d) => { const nv = wrap(+inp.value + d * v); row.setValue(nv); o.set({ [k]: nv }, false); };
      keys[0].replaceWith(h('button.step', { type: 'button', 'aria-label': 'Turn back by ' + v + '°', onclick: () => go(-1) }, '−'));
      keys[1].replaceWith(h('button.step', { type: 'button', 'aria-label': 'Turn on by ' + v + '°', onclick: () => go(1) }, '+'));
    });
    rewire(angleStep);
    const step = segRow(c, 'Step', STEPS.map(([v, t]) => [v, t, 'The − and + keys turn by ' + t]), angleStep, (v) => { angleStep = v; rewire(v); }, { aria: 'Turn step' });
    const parts = [sub(o.title || 'Angle'), ...rows.map((r) => r[1]), step];
    const extra = [segRow(c, 'Order', RT().ORDERS.map((x) => [x, x.split('').join(' → '), 'First ' + x[0] + ', then ' + x[1] + ', then ' + x[2]]), cur.order || 'YXZ', (v) => o.set({ order: v }, false), { aria: 'Rotation order' })];
    if (o.pivot) extra.push(segRow(c, 'Pivot', [['centre', 'Centre', 'Turn about the middle of the build'], ['base', 'Base', 'Turn about the middle of its bottom'], ['corner', 'Corner', 'Turn about its north-west bottom corner']], cur.pivot || 'centre', (v) => o.set({ pivot: v }, false)));
    if (o.smooth) parts.push(segRow(c, 'Edges', [['exact', 'Exact blocks', 'Only the blocks the build has'], ['smooth', 'Smooth', 'Stairs and slabs where a slope cuts a block']], cur.smooth ? 'smooth' : 'exact', (v) => o.set({ smooth: v === 'smooth' }, false)));
    parts.push(...extra);
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
  function colourRows(c, label, val, set) {
    let [hu, sa] = hueSat(val || [1, 1, 1]);
    const sw = h('span.bd-swatch', { 'aria-hidden': 'true' });
    const paint = (rgb) => { sw.style.background = toHex(rgb); };
    paint(val || [1, 1, 1]);
    const apply = (rgb, live) => { paint(rgb); set(rgb, live); };
    const keys = SH().LIGHT_COLOURS.map(([k, n, rgb]) => c.tip(h('button.btn.small.bd-ckey', { type: 'button', 'aria-label': n, onclick: () => { [hu, sa] = hueSat(rgb); hueR.setValue(hu); satR.setValue(sa * 100); apply(rgb, false); } }, h('span.bd-swatch', { style: { background: toHex(rgb) } })), n));
    const hueR = numRow(c, 'Hue', 0, 359, 1, hu, (v, live) => { hu = v; apply(hsv(hu, sa), live); }, { unit: '°' });
    const satR = numRow(c, 'Saturation', 0, 100, 1, sa * 100, (v, live) => { sa = v / 100; apply(hsv(hu, sa), live); }, { unit: '%' });
    return [h('div.bd-prow2.bd-colrow', h('span.bd-plabel', label), h('div.bd-ckeys', { role: 'group', 'aria-label': label + ' quick colours' }, keys), sw), hueR, satR];
  }
  /** The compass: north up, the light square goes round for the direction and toward the middle for a higher light. */
  function compass(c, get, set) {
    const S = 132, R = 56, cx = S / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + S + ' ' + S); svg.setAttribute('class', 'bd-compass-svg'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<rect class="ring" x="' + (cx - R) + '" y="' + (cx - R) + '" width="' + 2 * R + '" height="' + 2 * R + '" rx="6"/>' +
      '<path class="cross" d="M' + cx + ' ' + (cx - R) + 'V' + (cx + R) + 'M' + (cx - R) + ' ' + cx + 'H' + (cx + R) + '"/>' +
      '<rect class="mid" x="' + (cx - R / 2) + '" y="' + (cx - R / 2) + '" width="' + R + '" height="' + R + '" rx="4"/>' +
      [['N', cx, 10], ['S', cx, S - 3], ['W', 6, cx + 4], ['E', S - 6, cx + 4]].map(([t, x, y]) => '<text x="' + x + '" y="' + y + '">' + t + '</text>').join('') +
      '<rect class="block" x="' + (cx - 7) + '" y="' + (cx - 7) + '" width="14" height="14" rx="2"/><line class="ray" x1="' + cx + '" y1="' + cx + '" x2="' + cx + '" y2="' + cx + '"/><rect class="sun" width="10" height="10" rx="2"/>';
    const sun = svg.querySelector('.sun'), ray = svg.querySelector('.ray');
    const read = h('span.bd-compass-read', { 'aria-hidden': 'true' });
    const place = () => {
      const { az, el } = get(), r = R * (90 - clamp(el, 0, 90)) / 90, a = az * Math.PI / 180;
      const x = cx + Math.sin(a) * r, y = cx - Math.cos(a) * r;
      sun.setAttribute('x', x - 5); sun.setAttribute('y', y - 5); ray.setAttribute('x2', x); ray.setAttribute('y2', y);
      sun.classList.toggle('below', el < 0);
      read.textContent = Math.round(az) + '° · ' + Math.round(el) + '° up';
      box.setAttribute('aria-valuetext', 'from ' + Math.round(az) + ' degrees, ' + Math.round(el) + ' degrees up');
    };
    const box = h('div.bd-compass', { tabindex: 0, role: 'slider', 'aria-label': 'Light direction', 'aria-valuemin': 0, 'aria-valuemax': 360 }, svg, read);
    const at = (e, live) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * S - cx, y = (e.clientY - r.top) / r.height * S - cx;
      set({ az: Math.round((Math.atan2(x, -y) * 180 / Math.PI + 360) % 360), el: Math.round(90 * (1 - clamp(Math.hypot(x, y) / R, 0, 1))) }, live); place();
    };
    let drag = false;
    box.addEventListener('pointerdown', (e) => { drag = true; try { box.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } at(e, true); });
    box.addEventListener('pointermove', (e) => { if (drag) at(e, true); });
    box.addEventListener('pointerup', (e) => { if (!drag) return; drag = false; at(e, false); });
    box.addEventListener('pointercancel', () => { drag = false; });
    box.addEventListener('keydown', (e) => {
      const { az, el } = get(), d = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (!d) return;
      e.preventDefault(); set({ az: (az + d[0] + 360) % 360, el: clamp(el + d[1], -90, 90) }, false); place();
    });
    place();
    box.place = place;
    if (c.tip) c.tip(box, 'Drag the light square round the build for the direction, toward the middle for a higher light. Arrow keys work too.');
    return box;
  }
  /** The ramp the light uses, as block icons from shadow to highlight; the used steps are marked. */
  function rampStrip(ids, steps) {
    const used = new Set(SH().steps(ids, Math.min(steps || ids.length, ids.length)));
    return h('div.bd-ramp', { role: 'img', 'aria-label': 'Shadow to highlight: ' + ids.map((id) => core().nameOf(id)).join(', ') },
      h('span.bd-ramp-end', 'Shadow'), ids.map((id) => h('span.bd-ramp-step' + (used.has(id) ? '.on' : ''), core().blockIcon(id, { size: 18 }))), h('span.bd-ramp-end', 'Light'));
  }
  /**
   * The light, one layout everywhere. Main: (switch), compass with quick directions, Strength; More: shades, blend,
   * corners, edge light, shadows, (turns with the angle), (ramp), colour, shadow colour, tint, warm and cool, pool.
   * o = { c, get(), set(patch, live), toggle, follow, ramp (show the ramp choice), rampIds() (for the strip) }
   * Settings: { on, az, el, contrast, steps, dither, ao, rim, shadows, follow, ramp, colour, shadowC, tint, hue, pool }
   */
  function light(o) {
    const c = o.c, L = o.get();
    const pick = compass(c, () => o.get(), (pt, live) => o.set(pt, live));
    const quick = h('div.bd-lkeys', { role: 'group', 'aria-label': 'Quick light directions' }, SH().LIGHT_KEYS.map(([k, t, az, el]) => c.tip(h('button.btn.small', { type: 'button', onclick: () => { o.set({ az, el }, false); pick.place(); } }, t), 'Light from ' + t.toLowerCase() + ': ' + az + '° round, ' + el + '° up')));
    const strip = h('div.bd-rampwrap');
    const redrawRamp = () => { const ids = o.rampIds ? o.rampIds() : SH().rampOf(o.get().ramp || 'stone'); strip.replaceChildren(rampStrip(ids, o.get().steps)); };
    redrawRamp();
    const main = [
      h('div.bd-lpick', pick, quick),
      numRow(c, 'Strength', 0, 200, 5, L.contrast, (v, live) => o.set({ contrast: v }, live), { unit: '%', tip: '0 = flat, every face the same · 100 = the whole ramp from shadow to highlight · 200 = hard light' }),
      strip,
    ];
    const extra = [
      numRow(c, 'Shades', 2, 9, 1, L.steps, (v, live) => { o.set({ steps: v }, live); redrawRamp(); }, { tip: 'How many blocks of the ramp are used' }),
      numRow(c, 'Blend', 0, 100, 1, L.dither, (v, live) => o.set({ dither: v }, live), { unit: '%', tip: '0 = clean bands between the shades · 100 = a fine mix where they meet' }),
      numRow(c, 'Corners darker', 0, 100, 1, L.ao, (v, live) => o.set({ ao: v }, live), { unit: '%', tip: 'Blocks in corners and cracks get darker' }),
      numRow(c, 'Edge light', 0, 100, 1, L.rim, (v, live) => o.set({ rim: v }, live), { unit: '%', tip: 'A bright line where the lit side turns away' }),
      switchRow(c, 'Cast shadows', L.shadows, (v) => o.set({ shadows: v }, false), 'parts shade what is behind them'),
      o.follow ? switchRow(c, 'Turns with it', L.follow, (v) => o.set({ follow: v }, false), 'the light follows the angle') : null,
      o.ramp ? segRow(c, 'Ramp', Object.keys(SH().RAMPS).map((k) => [k, SH().RAMP_LABEL[k]]), L.ramp || 'stone', (v) => { o.set({ ramp: v }, false); redrawRamp(); }, { aria: 'Block ramp' }) : null,
      sub('Light colour'),
      ...colourRows(c, 'Light', L.colour || [1, 1, 1], (rgb, live) => o.set({ colour: rgb }, live)),
      numRow(c, 'Tint', 0, 100, 1, L.tint, (v, live) => o.set({ tint: v }, live), { unit: '%', tip: '0 = the blocks as they are · 100 = blocks picked by colour toward the light colour' }),
      numRow(c, 'Warm and cool', 0, 100, 1, L.hue, (v, live) => o.set({ hue: v }, live), { unit: '%', tip: 'Shadows drift cooler, highlights warmer' }),
      segRow(c, 'Pick from', SH().POOLS.filter((x) => x[0] !== 'custom'), L.pool || 'all', (v) => o.set({ pool: v }, false), { aria: 'Blocks the colour may pick' }),
      switchRow(c, 'Shadow colour', !!L.shadowC, (v) => { o.set({ shadowC: v ? [0.4, 0.5, 1] : null }, false); shBody.hidden = !v; }, 'its own tint in the shadow'),
    ];
    const shBody = h('div.bd-shbody', { hidden: !L.shadowC }, ...colourRows(c, 'Shadow', L.shadowC || [0.4, 0.5, 1], (rgb, live) => o.set({ shadowC: rgb }, live)));
    extra.push(shBody);
    const body = h('div.bd-lightbody', { hidden: o.toggle !== false && !L.on }, main, more(c, o.moreKey || 'light', extra));
    const parts = [];
    if (o.toggle !== false) parts.push(switchRow(c, 'Light', L.on, (v) => { o.set({ on: v }, false); body.hidden = !v; }, 'shade every face by the light'));
    parts.push(body);
    const el = h('div.bd-light', { role: 'group', 'aria-label': 'Light' }, parts);
    el.redrawRamp = redrawRamp;
    return el;
  }

  /* ======================================================================
   * Resize (Library builds and the editor)
   * ====================================================================== */
  /**
   * o = { c, size: [w, h, d] (the build now), get() -> { size: [..] | null, mode }, set(patch, live), peek(on) (before / after) }
   */
  function resizeUI(o) {
    const c = o.c, cur = o.get(), n = o.size, tgt = (cur.size || n).slice();
    let lock = true;
    const rows = ['Width', 'Height', 'Depth'].map((L, i) => {
      const a = [0, 1, 2][i];
      return numRow(c, L, 1, Math.max(512, n[a] * 4), 1, tgt[a], (v, live) => {
        const k = v / Math.max(1, tgt[a]);
        tgt[a] = Math.round(v);
        if (lock) [0, 1, 2].forEach((b) => { if (b !== a) { tgt[b] = Math.max(1, Math.round(tgt[b] * k)); rowsByAxis[b].setValue(tgt[b]); } });
        o.set({ size: tgt.slice() }, live);
      }, { unit: 'blocks', pid: 'rs' + a });
    });
    const rowsByAxis = rows;
    const quick = h('div.bd-variants', [0.5, 0.75, 1.5, 2, 3].map((f) => c.tip(h('button.btn.small', { type: 'button', onclick: () => { [0, 1, 2].forEach((a) => { tgt[a] = Math.max(1, Math.round(n[a] * f)); rowsByAxis[a].setValue(tgt[a]); }); o.set({ size: tgt.slice() }, false); } }, '× ' + (f === 0.5 ? '½' : f === 0.75 ? '¾' : f)), (f < 1 ? 'Smaller: ' : 'Bigger: ') + n.map((v) => Math.round(v * f)).join(' × '))));
    const reset = h('button.btn.small', { type: 'button', onclick: () => { [0, 1, 2].forEach((a) => { tgt[a] = n[a]; rowsByAxis[a].setValue(n[a]); }); o.set({ size: null }, false); } }, c.glyph('reset'), 'Original size');
    const peek = !o.peek ? null : c.tip(h('button.btn.small', { type: 'button', 'aria-pressed': 'false', onpointerdown: () => o.peek(true), onpointerup: () => o.peek(false), onpointerleave: () => o.peek(false), onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') o.peek(true); }, onkeyup: () => o.peek(false) }, 'Hold: before'), 'Hold to see the build as it was; let go for the new size');
    const info = h('p.bd-note.bd-rsinfo', { 'aria-live': 'polite' });
    const el = h('div.bd-resize', { role: 'group', 'aria-label': 'Size' },
      ...rows, switchRow(c, 'Keep ratio', lock, (v) => { lock = v; }, 'width, height and depth together'), quick,
      segRow(c, 'How', RS().MODES.map(([k, l, t]) => [k, { auto: 'Smart', stretch: 'Stretch', thin: 'Resample', plain: 'Plain' }[k] || l, l + ': ' + t]), cur.mode || 'auto', (v) => o.set({ mode: v }, false), { aria: 'Resize mode', tip: 'Smart picks Stretch or Resample for this build, so walls, floors and windows stay one block thick' }),
      info, h('div.bd-actions', peek, reset, o.apply || null));
    el.setInfo = (r) => {
      if (!r) { info.textContent = 'As it came: ' + n.join(' × ') + '.'; info.classList.remove('bd-warn'); return; }
      info.textContent = (r.mode === 'none' ? 'As it came' : 'Now ' + r.after.join(' × ') + ' · ' + c.fmtN(core().volume(r.s)) + ' blocks · ' + ({ stretch: 'stretched', thin: 'resampled, walls thinned', plain: 'plain scale' }[r.mode] || r.mode)) + (r.notes.length ? ' · ' + r.notes.join(' · ') : '');
      info.classList.toggle('bd-warn', r.notes.length > 0);
    };
    return el;
  }

  /* ======================================================================
   * Generate
   * ====================================================================== */
  const BASIC = () => TH.builds.shapes.SHAPES;
  const isGen = (k) => !!(G() && G().byId(k));
  /** The classic shapes (builds-shapes.js) in the same flow: their parameters in Shape, the shared Inside, an angle. */
  function basicParams(kind) {
    const sh = BASIC()[kind], out = [];
    sh.params.forEach(([id, label, lo, hi, def]) => {
      if (id === 'hollow' || id === 'thick') return;   // the shared Inside does this now
      if (id === 'centre') out.push({ id, label: 'Middle', g: 'shape', t: 'seg', ch: [['block', 'On a block', 'Odd width: the middle is one block'], ['edge', 'Between', 'Even width: the middle falls between blocks']], def: 'block', more: true });
      else if (['ring', 'floor', 'caps'].includes(id)) out.push({ id, label: id === 'caps' && kind === 'cone' ? 'Base' : label, g: 'shape', t: 'bool' });
      else if (id === 'axis') out.push({ id, label: 'Axis', g: 'shape', t: 'seg', ch: [['y', 'Lying'], ['x', 'East–west'], ['z', 'North–south']], def: 'y' });
      else if (id === 'preset') out.push({ id, label: 'Kind', g: 'shape', t: 'seg', ch: Object.entries(TH.builds.shapes.TREE_PRESETS).map(([k, v]) => [k, v.name]), def: 'oak' });
      else if (id === 'seed') out.push({ id, label: 'Variation', g: 'shape', t: 'seed', def: 1 });
      else out.push({ id, label, g: 'shape', t: 'num', min: lo, max: hi, def, step: 1, unit: 'blocks' });
    });
    out.push({ id: 'inside', label: 'Inside', g: 'inside', t: 'seg', ch: IN().MODES, def: 'solid' });
    out.push({ id: 'wall', label: 'Wall', g: 'inside', t: 'num', min: 1, max: 12, def: 1, unit: 'blocks', when: (p) => p.inside !== 'solid' });
    out.push({ id: 'fill', label: 'Fill with', g: 'inside', t: 'seg', ch: IN().FILLS, def: 'air', when: (p) => p.inside !== 'solid' });
    out.push({ id: 'support', label: 'Supports', g: 'inside', t: 'seg', ch: IN().SUPPORTS, def: 'none', when: (p) => p.inside !== 'solid' });
    out.push({ id: 'block', g: 'materials', t: 'basicBlock' });
    ['ax', 'ay', 'az'].forEach((id) => out.push({ id, g: 'finish', t: 'num', angle: true }));
    out.push({ id: 'order', g: 'finish', t: 'seg', angle: true }, { id: 'rsmooth', g: 'finish', t: 'bool', angle: true });
    return out;
  }
  function paramsOf(kind) { return isGen(kind) ? G().params(kind) : basicParams(kind); }
  function valuesOf(c, kind) {
    const st = c.S().shape, raw = st.p[kind] || {};
    if (isGen(kind)) return G().clean(kind, raw);
    const d = TH.builds.shapes.defaults()[kind];
    return Object.assign({ ax: 0, ay: 0, az: 0, order: 'YXZ', rsmooth: false, inside: 'solid', wall: 1, fill: 'air', support: 'none' }, d, raw, { hollow: false });
  }
  /** The shape on the Create stage: a generator, or a classic shape with its Inside and angle. */
  const cache = { sig: '', s: null };
  function schem(c, fast) {
    const st = c.S().shape, kind = st.kind;
    if (isGen(kind)) {
      const raw = st.p[kind] || {}, sig = 'g|' + kind + JSON.stringify(raw);
      if (sig !== cache.sig) { cache.s = G().gen(kind, raw); cache.sig = sig; }
      return cache.s;
    }
    const v = valuesOf(c, kind);
    const sig = 'b|' + kind + JSON.stringify(st.p[kind] || {}) + JSON.stringify(st.block[kind] || '') + JSON.stringify(st.block2[kind] || '') + (fast ? 'f' : '');
    if (sig === cache.sig) return cache.s;
    let s = c.basicSchem();
    if (v.inside && v.inside !== 'solid') s = IN().apply(s, { mode: v.inside, wall: v.wall, support: v.support }, { fill: { glow: 'minecraft:glowstone', dark: 'minecraft:deepslate', water: 'minecraft:water[level=0]', lava: 'minecraft:lava[level=0]' }[v.fill] || null, support: 'minecraft:stone_bricks' });
    if (v.ax || v.ay || v.az) s = RT().rotate(s, { x: v.ax, y: v.ay, z: v.az, order: v.order, smooth: v.rsmooth, level: 'medium', fast });
    cache.s = s; cache.sig = sig;
    return s;
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
      const list = G().FAMILIES.filter((f) => f.group === g).map((f) => [f.id, f.name, f]).concat(g === 'shapes' ? Object.entries(BASIC()).map(([k, v]) => [k, v.name, null]) : []);
      tiles.replaceChildren(...list.map(([k, name, f]) => {
        const on = c.S().shape.kind === k;
        const b = h('button.btn.bd-gen' + (on ? '.on' : ''), { type: 'button', role: 'listitem', 'aria-pressed': String(on), onclick: () => { if (c.S().shape.kind === k) return; c.save((bb) => { bb.shape.kind = k; }); c.show('shape', { animate: true, layer: 'top' }); c.patch(); } },
          c.genArt(k), h('span.bd-gen-name', name));
        c.tip(b, () => [h('div.th-tooltip-title', name), f && f.variants ? h('div.th-tooltip-sub', 'Starts: ' + f.variants.map((v) => v[0]).join(' · ')) : h('div.th-tooltip-sub', 'Classic shape')]);
        return b;
      }));
      count.textContent = list.length + ' to pick from';
    };
    const note = h('p.bd-note', GROUP_NOTE[st.group] || '');
    const seg = h('div.seg.bd-gengrp', { role: 'radiogroup', 'aria-label': 'Generator group' }, groups.map(([id, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.group === id), class: st.group === id ? 'on' : null, onclick: () => {
        seg.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        c.save((bb) => { bb.shape.group = id; }); fill(); note.textContent = GROUP_NOTE[id];
      } }, label);
      return b;
    }));
    fill();
    return h('section.panel.bd-pan.bd-genpanel.has-sel', { 'aria-label': 'Pick a shape' }, h('div.bd-pan-head', h('h3', 'Pick a shape'), count), seg, note, tiles);
  }

  const STEP_HINT = { shape: 'What it is and how big', inside: 'Solid or hollow', materials: 'Which blocks', finish: 'Light, glow and detail' };
  function settings(c) {
    const st = c.S().shape, kind = st.kind, gen = isGen(kind), fam = gen ? G().byId(kind) : null;
    const name = gen ? fam.name : BASIC()[kind].name;
    const P = paramsOf(kind), v = valuesOf(c, kind);
    const size = h('span.bd-count.bd-shape-size', { 'aria-live': 'polite' });
    const rowsWithWhen = [];
    const set = (patch, live) => {
      c.save((b) => { const p = b.shape.p[kind] || (b.shape.p[kind] = {}); Object.assign(p, patch); });
      Object.assign(v, patch);
      rowsWithWhen.forEach(([q, row]) => row.classList.toggle('off', !q.when(v)));
      c.regen(live);
    };
    const steps = (G().STEPS || [['shape', 'Shape'], ['inside', 'Inside'], ['materials', 'Materials'], ['finish', 'Finish']]).filter(([g]) => P.some((q) => q.g === g));
    const step = steps.some(([g]) => g === st.step) ? st.step : steps[0][0];
    const panes = {};
    steps.forEach(([g, label]) => { panes[g] = h('div.bd-ppane', { role: 'tabpanel', hidden: g !== step, 'aria-label': label }); });
    const stepSeg = h('div.seg.bd-stepseg', { role: 'tablist', 'aria-label': 'Steps' }, steps.map(([g, label]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(g === step), class: g === step ? 'on' : null, onclick: () => {
        stepSeg.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
        Object.entries(panes).forEach(([k, el]) => { el.hidden = k !== g; });
        c.save((bb) => { bb.shape.step = g; });
      } }, label);
      c.tip(b, STEP_HINT[g]);
      return b;
    }));
    /** One parameter as its control. */
    const rowFor = (q) => {
      let row = null;
      if (q.t === 'num' && q.dim) {
        row = numRow(c, q.label, q.min, q.max, q.step || 1, v[q.id], (val, live) => {
          const patch = { [q.id]: val };
          if (c.S().shape.lock && v[q.id] > 0) ['w', 'd', 'h'].forEach((o) => {
            if (o === q.id || v[o] == null) return;
            const pq = P.find((x) => x.id === o); patch[o] = clamp(Math.round(v[o] * val / v[q.id]), pq.min, pq.max);
            const r = panes.shape.querySelector('[data-param="' + o + '"]'); if (r && r.setValue) r.setValue(patch[o]);
          });
          set(patch, live);
        }, { unit: q.unit, tip: q.tip, pid: q.id });
      } else if (q.t === 'num') row = numRow(c, q.label, q.min, q.max, q.step || 1, v[q.id], (val, live) => set({ [q.id]: val }, live), { unit: q.unit, tip: q.tip, pid: q.id });
      else if (q.t === 'seg' && q.palette) row = paletteRow(c, q, v[q.id], (val) => set({ [q.id]: val }, false));
      else if (q.t === 'seg') row = segRow(c, q.label, q.ch, v[q.id], (val) => set({ [q.id]: val }, false), { pid: q.id, tip: q.tip });
      else if (q.t === 'bool') row = switchRow(c, q.label, v[q.id], (val) => set({ [q.id]: val }, false), q.tip || '', { pid: q.id });
      else if (q.t === 'seed') row = seedRow(c, v.seed, (val) => set({ seed: val }, false));
      else if (q.t === 'kinds') row = kindsRow(c, v, (val) => set({ off: val }, false));
      else if (q.t === 'block') row = partRow(c, q, v[q.id], (val) => set({ [q.id]: val }, false));
      else if (q.t === 'basicBlock') row = c.basicBlocks();
      if (row && q.when) { rowsWithWhen.push([q, row]); row.classList.toggle('off', !q.when(v)); }
      return row;
    };
    const skip = (q) => q.angle || q.light || q.t === 'look' || q.id === 'light' || q.id === 'lColour' || q.id === 'lShadowC';
    // Shape, Inside, Materials: main rows, then the rest behind More
    ['shape', 'inside', 'materials'].forEach((g) => {
      if (!panes[g]) return;
      const qs = P.filter((q) => q.g === g && !skip(q));
      const main = qs.filter((q) => !q.more), rest = qs.filter((q) => q.more);
      if (g === 'inside') panes[g].append(h('p.bd-note', 'Hollow builds keep a shell of this many blocks, measured straight in from every face, so slanted faces keep an even wall.'));
      main.forEach((q) => { const r = rowFor(q); if (r) panes[g].append(r); if (q.id === 'h' && g === 'shape') panes[g].append(switchRow(c, 'Keep ratio', !!st.lock, (on) => c.save((b) => { b.shape.lock = on; }), 'width, depth and height together')); });
      const m = more(c, g, rest.map(rowFor));
      if (m) panes[g].append(...m);
    });
    // Finish: a Look, the light, the glow, the detail; the rest behind More
    if (panes.finish) {
      const F = panes.finish, qid = (id) => P.find((q) => q.id === id);
      if (gen) F.append(lookRow(c, kind, (patch) => { set(patch, false); c.patch(); }));
      if (gen && qid('light')) {
        const lmap = { on: 'light', az: 'lAz', el: 'lEl', contrast: 'lCon', steps: 'lSteps', dither: 'lDither', ao: 'lAo', rim: 'lRim', shadows: 'lShadow', follow: 'lFollow', colour: 'lColour', shadowC: 'lShadowC', tint: 'lTint', hue: 'lHue', pool: 'lPool' };
        F.append(sub('Light'), light({ c, follow: true, moreKey: 'light',
          get: () => { const o = {}; Object.entries(lmap).forEach(([k, id]) => { o[k] = v[id]; }); return o; },
          rampIds: () => { const pal = G().PALETTES[v.pal] || {}; return (pal.body || []).map((n) => 'minecraft:' + n); },
          set: (pt, live) => { const m = {}; Object.keys(pt).forEach((k) => { m[lmap[k]] = pt[k]; }); set(m, live); } }));
      }
      if (qid('glow')) { F.append(sub('Glow')); ['glow', 'glowAmt'].forEach((id) => { const r = rowFor(qid(id)); if (r) F.append(r); }); }
      F.append(sub('Detail'), rowFor(qid('detail') || { id: 'x' }) || h('span'));
      const rest = P.filter((q) => q.g === 'finish' && !skip(q) && !['glow', 'glowAmt', 'detail'].includes(q.id) && q.t !== 'look');
      const angleEl = angle({ c, get: () => ({ x: v.ax, y: v.ay, z: v.az, order: v.order, smooth: v.rsmooth }), set: (pt, live) => {
        const m = {}; if ('x' in pt) m.ax = pt.x; if ('y' in pt) m.ay = pt.y; if ('z' in pt) m.az = pt.z; if (pt.order) m.order = pt.order; if ('smooth' in pt) m.rsmooth = pt.smooth;
        set(m, live);
      }, smooth: !gen, title: gen ? 'Angle (made at this angle)' : 'Angle' });
      const surf = rest.filter((q) => ['rough', 'weather', 'moss', 'cracks'].includes(q.id));
      const other = rest.filter((q) => !surf.includes(q));
      const m = more(c, 'finish', [surf.length ? sub('Surface') : null, ...surf.map(rowFor), angleEl, other.length ? sub('More detail') : null, ...other.map(rowFor)]);
      if (m) F.append(...m);
    }
    const variants = gen && fam.variants && fam.variants.length ? h('div.bd-variants', { role: 'group', 'aria-label': 'Quick starts' }, fam.variants.map(([label, patch]) => {
      const b = h('button.btn.small', { type: 'button', onclick: () => { c.save((bb) => { bb.shape.p[kind] = Object.assign({ seed: (bb.shape.p[kind] || {}).seed || 1 }, patch); }); c.regen(false); c.patch(); c.toast(label); } }, label);
      c.tip(b, () => [h('div.th-tooltip-title', label), h('div.th-tooltip-sub', 'Starts again from the defaults with ' + Object.entries(patch).map(([k, x]) => k + ' ' + (Array.isArray(x) ? x.join(' ') : x)).join(', '))]);
      return b;
    })) : null;
    const resetAll = c.tip(h('button.btn.small', { type: 'button', onclick: () => { c.save((b) => { b.shape.p[kind] = {}; }); c.regen(false); c.patch(); } }, c.glyph('reset'), 'Defaults'), 'Every setting of this shape back to its default');
    const panel = h('section.panel.bd-pan.bd-params', { 'aria-label': name + ' settings' },
      h('div.bd-pan-head', h('h3', name), size), variants ? [sub('Quick starts'), variants] : null, stepSeg, ...steps.map(([g]) => panes[g]), h('div.bd-actions', resetAll));
    c.UI().createSize = size;
    try { const s = schem(c); size.textContent = s.size.join(' × ') + ' · ' + c.fmtN(core().volume(s)) + ' blocks'; } catch (e) { size.textContent = e.user ? e.message : 'Could not build'; }
    return panel;
  }
  function lookRow(c, kind, set) {
    return h('div.bd-prow2.bd-colrow', h('span.bd-plabel', 'Look'), h('div.bd-variants', { role: 'group', 'aria-label': 'Looks' }, G().LOOKS.map(([k, l, t]) => c.tip(h('button.btn.small', { type: 'button', onclick: () => set(G().look(kind, k)) }, l), t))));
  }
  function seedRow(c, seed, set) {
    const inp = h('input.field.bd-seedin', { type: 'number', min: 1, value: seed, 'aria-label': 'Variation number', onchange: () => set(Math.max(1, Math.round(+inp.value || 1))) });
    const roll = c.tip(h('button.btn.small', { type: 'button', onclick: () => { const n = 1 + Math.floor(Math.random() * 99999); inp.value = n; set(n); } }, c.glyph('dice'), 'Another'), 'Another arrangement with the same settings. Typing a number brings one back.');
    const lab = c.tip(h('span.bd-plabel', 'Variation'), 'The only random part: the other settings never re-roll it');
    return h('div.bd-prow2.bd-seedrow', lab, inp, roll);
  }
  function kindsRow(c, v, set) {
    const lvl = D().LEVELS[v.detail] || [], off = new Set(v.off || []);
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
    return h('div.bd-prow2.bd-colrow', h('span.bd-plabel', 'Parts used'), h('div.bd-kinds', { role: 'group', 'aria-label': 'Block parts the detail pass may use' }, keys));
  }
  /** Palette tiles: the name, what it looks like, and its ramp from shadow to highlight as block icons. */
  function paletteRow(c, q, val, set) {
    const btns = q.ch.map(([k, label]) => {
      const pal = G().PALETTES[k], on = k === val;
      const b = h('button.btn.bd-paltile' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => {
        btns.forEach((x) => { const o2 = x === b; x.classList.toggle('on', o2); x.setAttribute('aria-checked', String(o2)); });
        set(k);
      } }, h('span.bd-palname', label), h('span.bd-palramp', { 'aria-hidden': 'true' }, pal.body.map((n) => core().blockIcon('minecraft:' + n, { size: 16 }))));
      c.tip(b, () => [h('div.th-tooltip-title', label), h('div.th-tooltip-sub', pal.look || ''), h('div.th-tooltip-sub', 'Shadow → highlight: ' + pal.body.map((n) => core().nameOf('minecraft:' + n)).join(', ')), h('div.th-tooltip-sub', 'Glows with ' + (D().GLOW[pal.glow] ? D().GLOW[pal.glow].name.toLowerCase() : 'its glow block'))]);
      return b;
    });
    return h('div.bd-palgrid', { role: 'radiogroup', 'aria-label': 'Palette' }, btns);
  }
  function partRow(c, q, val, set) {
    const btn = h('button.btn.bd-swap', { type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      c.closePickers();
      if (open) return;
      btn.setAttribute('aria-expanded', 'true');
      btn.after(c.blockPicker({ ids: core().buildingBlocks(), current: val || 'minecraft:air', label: 'Pick the ' + q.label.toLowerCase() + ' block', onPick: (id) => { set(id); c.patch(); } }));
    } }, val ? core().blockIcon(val, { size: 24 }) : h('span.bd-palchip', { 'aria-hidden': 'true' }), h('span.bd-swap-txt', h('span.bd-swap-name', val ? core().nameOf(val) : 'From the palette'), h('span.bd-swap-was', q.label)), c.glyph('swap', 'bd-swap-ico'));
    const reset = val ? c.tip(h('button.btn.small.bd-vk.sq', { type: 'button', 'aria-label': 'Back to the palette', onclick: () => { set(null); c.patch(); } }, c.glyph('reset')), 'Back to the palette') : null;
    return h('div.bd-partrow', btn, reset);
  }
  function actions(c) {
    const s = () => schem(c);
    const dl = (fmt) => () => { try { c.exportAs(s(), fmt); } catch (e) { c.toast(e.message); } };
    return h('section.panel.bd-pan.bd-create-acts', { 'aria-label': 'Use it' },
      h('div.bd-pan-head', h('h3', 'Use it')),
      h('div.bd-actions',
        c.tip(h('button.btn.small.primary', { type: 'button', onclick: dl('schem') }, c.glyph('down'), '.schem'), '.schem (Sponge 2): WorldEdit, FAWE, Axiom, Litematica'),
        c.tip(h('button.btn.small', { type: 'button', onclick: dl('litematic') }, '.litematic'), 'Litematica schematic'),
        c.tip(h('button.btn.small', { type: 'button', onclick: dl('json') }, 'JSON'), 'This toolbox’s own format'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.toMats('shape') }, 'Material list'), 'The blocks it needs, with recipes and packing')),
      h('div.bd-actions',
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.edit(s()) }, c.glyph('plus'), 'Edit by hand'), 'Open it in Make it myself and change it block by block'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.keep(s()) }, c.glyph('file'), 'Keep in Library'), 'Add it to your builds in the Library'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.replay() }, c.glyph('replay'), 'Build it'), 'Watch it being built, block by block')));
  }

  /* ======================================================================
   * Library: size, angle and light of any build (non-destructive, saved per build)
   * ====================================================================== */
  const XF_LIGHT = { on: false, az: 225, el: 45, contrast: 100, steps: 6, dither: 40, ao: 40, rim: 0, shadows: false, ramp: 'stone', colour: [1, 1, 1], shadowC: null, tint: 0, hue: 0, pool: 'all' };
  function xfOf(c, key) { const x = (c.S().xf || {})[key] || {}; return { x: x.x || 0, y: x.y || 0, z: x.z || 0, order: x.order || 'YXZ', pivot: x.pivot || 'centre', smooth: !!x.smooth, light: Object.assign({}, XF_LIGHT, x.light || {}), resize: Object.assign({ size: null, mode: 'auto' }, x.resize || {}) }; }
  const xfCache = new Map(), rsLast = new Map();
  /** The build with its size, angle and light applied (cached per key and settings). fast: the quick preview while dragging. */
  function applyXf(c, key, s, fast) {
    const x = (c.S().xf || {})[key];
    if (!s || !x) { rsLast.delete(key); return s; }
    const sig = JSON.stringify(x) + (fast ? 'f' : '');
    const hit = xfCache.get(key);
    if (hit && hit.src === s && hit.sig === sig) return hit.s;
    let out = s;
    if (x.resize && x.resize.size) { const r = RS().resize(out, { size: x.resize.size, mode: fast && x.resize.mode !== 'plain' ? 'plain' : x.resize.mode }); if (!fast) rsLast.set(key, r); out = r.s; } else rsLast.delete(key);
    if (x.x || x.y || x.z) out = RT().rotate(out, { x: x.x, y: x.y, z: x.z, order: x.order, pivot: x.pivot, smooth: x.smooth, level: 'medium', fast });
    const L = x.light;
    if (L && L.on) out = SH().shade(out, { az: L.az, el: L.el, ramp: SH().rampOf(L.ramp || 'stone'), steps: L.steps, contrast: L.contrast / 100, dither: L.dither / 100, ao: L.ao / 100, rim: L.rim / 100, shadows: L.shadows, colour: (L.tint || L.hue) ? { light: L.colour, shadow: L.shadowC, tint: L.tint / 100, hue: L.hue / 100, pool: L.pool } : null });
    xfCache.set(key, { src: s, sig, s: out });
    return out;
  }
  function xfPanel(c, key) {
    const cur = xfOf(c, key);
    const n = (cur.x || cur.y || cur.z ? 1 : 0) + (cur.light.on ? 1 : 0) + (cur.resize.size ? 1 : 0);
    let tm = 0;
    const orig = c.original(key);
    const set = (patch, live) => {
      c.save((b) => {
        b.xf = b.xf || {};
        const x = b.xf[key] || (b.xf[key] = {});
        Object.assign(x, patch);
        if (!x.x && !x.y && !x.z && !(x.light && x.light.on) && !(x.resize && x.resize.size)) delete b.xf[key];
      });
      clearTimeout(tm);
      tm = setTimeout(() => {
        c.show(key, { keepView: true, fast: live });
        const sh = c.UI().shown;
        ang.setSize(sh ? 'Size ' + sh.size.join(' × ') : '');
        rs.setInfo(rsLast.get(key) || null);
        const x = (c.S().xf || {})[key];
        count.textContent = x ? 'changed' : 'as it came'; panel.classList.toggle('has-sel', !!x);
      }, live ? 140 : 0);
    };
    const rs = resizeUI({ c, size: orig ? orig.size.slice() : [1, 1, 1], get: () => xfOf(c, key).resize, set: (pt, live) => set({ resize: Object.assign(xfOf(c, key).resize, pt) }, live), peek: (on) => c.peek(key, on) });
    rs.setInfo(rsLast.get(key) || null);
    const ang = angle({ c, get: () => xfOf(c, key), set: (pt, live) => set(pt, live), pivot: true, smooth: true, title: 'Angle' });
    const lt = light({ c, ramp: true, moreKey: 'xflight', get: () => xfOf(c, key).light, set: (pt, live) => set({ light: Object.assign(xfOf(c, key).light, pt) }, live) });
    const sh = c.UI().shown;
    if (sh) ang.setSize('Size ' + sh.size.join(' × '));
    const count = h('span.bd-count', n ? 'changed' : 'as it came');
    const panel = h('section.panel.bd-pan.bd-xf' + (n ? '.has-sel' : ''), { 'aria-label': 'Size, angle and light' },
      h('div.bd-pan-head', h('h3', 'Size, angle and light'), count),
      h('p.bd-note', 'Resize without doubling walls, turn about X, Y and Z, shade from a light. The original stays as it is; downloads and the Material List use what you see.'),
      sub('Size'), rs, ang, sub('Light'), lt,
      h('div.bd-actions', c.tip(h('button.btn.small', { type: 'button', onclick: () => c.edit(c.effective(key)) }, c.glyph('plus'), 'Edit by hand'), 'Open this build in Make it myself')));
    return panel;
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

  TH.builds.createUI = { GEN_ART, side, angle, light, resizeUI, rampStrip, more, xfPanel, applyXf, schem, numRow, segRow, switchRow, isGen, paramsOf, valuesOf, compass, XF_LIGHT };
})();
