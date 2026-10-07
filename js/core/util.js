window.TH = window.TH || {};

/** Small DOM + formatting helpers shared by every module. */
TH.util = (function () {
  /**
   * Hyperscript-style element builder.
   * h('div.card.big', { onclick: fn, title: 'x' }, child, [children], 'text')
   */
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const roman = (n) => ROMAN[n] || String(n);

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** Emerald icon (inline svg) used next to every price. */
  function emerald(cls) {
    return TH.icon('emerald', { size: 14, cls: 'emerald' + (cls ? ' ' + cls : '') });
  }

  /** A -/value/+ stepper. onChange receives the new number. */
  function stepper(value, { min = 0, max = 999, onChange, label }) {
    const input = h('input.stepper-input', {
      type: 'number', min, max, value, 'aria-label': label,
      onchange: () => onChange(clamp(parseInt(input.value, 10) || 0, min, max)),
    });
    return h('div.stepper',
      h('button.step', { type: 'button', 'aria-label': 'Decrease ' + label, onclick: () => onChange(clamp(value - 1, min, max)) }, '−'),
      input,
      h('button.step', { type: 'button', 'aria-label': 'Increase ' + label, onclick: () => onChange(clamp(value + 1, min, max)) }, '+'),
    );
  }

  /** Circular progress ring. */
  function ring(done, total, size) {
    size = size || 44;
    const r = size / 2 - 4, c = 2 * Math.PI * r;
    const pct = total ? done / total : 0;
    const wrap = h('div.ring', { style: { width: size + 'px', height: size + 'px' } });
    wrap.innerHTML =
      `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
    wrap.appendChild(h('span.ring-label', total ? Math.round(pct * 100) + '%' : '–'));
    return wrap;
  }

  function download(filename, text) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /**
   * Replays the tab-switch entrance (fade + rise, staggered) on part of the page, for structural in-module changes
   * (material / item / mode / list re-sort). Same keyframes as `.module.enter` (`rise` in styles.css).
   *   reveal(container, { items, from, step, max })
   *   items: selector (scoped to container; ":scope > x" ok) or array of elements; default = container's direct children
   *   from:  skip the first N items; step: seconds between items (default .06); max: cap on staggered index (default 12)
   * Restarts cleanly when called again, does nothing under prefers-reduced-motion, removes its classes when done.
   */
  const revealing = new WeakMap();
  function reveal(container, opts) {
    try {
      if (!container || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      opts = opts || {};
      let els = !opts.items ? Array.from(container.children)
        : typeof opts.items === 'string' ? Array.from(container.querySelectorAll(opts.items)) : Array.from(opts.items);
      els = els.slice(opts.from || 0);
      if (!els.length) return;
      const max = opts.max || 12, step = opts.step == null ? 0.06 : opts.step;
      const prev = revealing.get(container);
      if (prev) prev.forEach((el) => { el.classList.remove('th-rv'); el.style.removeProperty('--i'); });
      els.forEach((el) => { el.classList.remove('th-rv'); });
      void container.offsetWidth; // flush so the animation restarts
      els.forEach((el, i) => {
        el.style.setProperty('--i', Math.min(i, max));
        el.style.setProperty('--rv-step', step + 's');
        el.classList.add('th-rv');
      });
      revealing.set(container, els);
      const done = (el) => { el.classList.remove('th-rv'); el.style.removeProperty('--i'); el.style.removeProperty('--rv-step'); };
      els.forEach((el) => {
        const on = (e) => { if (e.target === el && e.animationName === 'rise') { el.removeEventListener('animationend', on); done(el); } };
        el.addEventListener('animationend', on);
      });
      setTimeout(() => els.forEach((el) => { if (el.classList.contains('th-rv')) done(el); }), 700 + Math.min(els.length, max) * step * 1000);
    } catch (e) { /* motion is a bonus */ }
  }

  return { h, append, roman, clamp, uid, debounce, toast, emerald, stepper, ring, download, reveal };
})();
