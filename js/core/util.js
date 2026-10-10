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

  /**
   * In-page confirm / prompt (the artifact viewer swallows native confirm() and prompt()).
   * ask({ text, ok, danger, input }) -> Promise<true|false>, or with input: Promise<string|null>.
   */
  function ask(o) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const field = o.input != null ? h('input.field.th-ask-input', { type: 'text', value: o.input, 'aria-label': o.text }) : null;
      const close = (v) => { document.removeEventListener('keydown', onKey, true); wrap.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
      const yes = () => close(field ? (field.value.trim() || null) : true);
      const okBtn = h('button.btn' + (o.danger ? '.danger' : '.primary'), { type: 'button', onclick: yes }, o.ok || 'OK');
      const wrap = h('div.th-ask', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.text, onclick: (e) => { if (e.target === wrap) close(field ? null : false); } },
        h('div.th-ask-box.panel', h('p.th-ask-text', o.text), field,
          h('div.th-ask-btns', h('button.btn', { type: 'button', onclick: () => close(field ? null : false) }, 'Cancel'), okBtn)));
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(field ? null : false); }
        else if (e.key === 'Enter' && document.activeElement !== okBtn.previousSibling) { e.preventDefault(); yes(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.body.append(wrap);
      (field || okBtn).focus();
      if (field) field.select();
    });
  }
  /** Run fn straight away, or after the user agrees when needed is true. */
  function guard(needed, text, fn, ok) {
    if (!needed) { fn(); return; }
    ask({ text, ok: ok || 'Remove', danger: true }).then((y) => { if (y) fn(); });
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

  /**
   * App tooltip. TH.util.tooltip(target, content, opts) -> dispose().
   * content: string | Node | array | () => any (function is re-evaluated on every show, so it can be live).
   * Nodes can use .th-tooltip-title / .th-tooltip-sub / .th-tooltip-tag. opts: { delay: 250 }.
   * One shared element; skips touch; hides on leave/blur/scroll/pointerdown. Removes a native title (moved to aria-label).
   */
  let tipEl = null, tipTimer = 0, tipOwner = null;
  function tipHide() {
    clearTimeout(tipTimer); tipOwner = null;
    if (tipEl) tipEl.classList.remove('on');
  }
  function tipShow(target, content) {
    let c = typeof content === 'function' ? content() : content;
    if (c == null || c === '' || (Array.isArray(c) && !c.length)) return tipHide();
    if (!tipEl) {
      tipEl = h('div.th-tooltip', { role: 'tooltip' });
      document.body.appendChild(tipEl);
      ['scroll', 'resize', 'blur'].forEach((ev) => window.addEventListener(ev, tipHide, true));
      document.addEventListener('pointerdown', tipHide, true);
    }
    tipOwner = target;
    tipEl.textContent = '';
    append(tipEl, [c]);
    tipEl.classList.remove('below');
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const zf = parseFloat(document.documentElement.style.zoom) || 1, r0 = target.getBoundingClientRect();
    const r = { left: r0.left / zf, top: r0.top / zf, right: r0.right / zf, bottom: r0.bottom / zf, width: r0.width / zf, height: r0.height / zf };
    const w = tipEl.offsetWidth, ht = tipEl.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight, gap = 8;
    let top = r.top - ht - gap, below = false;
    if (top < 4 && r.bottom + gap + ht <= vh - 4) { top = r.bottom + gap; below = true; }
    top = clamp(top, 4, Math.max(4, vh - ht - 4));
    const left = clamp(r.left + r.width / 2 - w / 2, 4, Math.max(4, vw - w - 4));
    tipEl.style.left = Math.round(left) + 'px'; tipEl.style.top = Math.round(top) + 'px';
    tipEl.classList.toggle('below', below);
    tipEl.classList.add('on');
  }
  function tooltip(target, content, opts) {
    if (!target) return () => {};
    const delay = (opts && opts.delay != null) ? opts.delay : 250;
    const t = target.getAttribute('title');
    if (t != null) { if (content == null) content = t; if (!target.hasAttribute('aria-label') && !target.textContent.trim()) target.setAttribute('aria-label', t); target.removeAttribute('title'); }
    const enter = (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => tipShow(target, content), delay);
    };
    const leave = () => { if (tipOwner === target || !tipOwner) tipHide(); };
    const focus = (e) => { if (target.matches(':focus-visible')) { clearTimeout(tipTimer); tipTimer = setTimeout(() => tipShow(target, content), delay); } };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('focus', focus);
    target.addEventListener('blur', leave);
    return () => { target.removeEventListener('pointerenter', enter); target.removeEventListener('pointerleave', leave); target.removeEventListener('focus', focus); target.removeEventListener('blur', leave); leave(); };
  }

  /** "Recommended!" in the accent colour (`.th-reco`): inline text, max one per group. */
  function reco(label) {
    return h('span.th-reco', label || 'Recommended!');
  }
  /**
   * Scroll edge shadows (CSS: styles.css "scroll edge shadows"). Keep SCROLL_Y / SCROLL_X in sync with the CSS lists.
   * Always: every container gets its computed padding (--sc-pt/-pr/-pb/-pl) and gap along its axis (--sc-gap) as inline
   * custom properties: sticky offsets are measured inside the scroller's padding, and padding / gap differ per style and
   * breakpoint (e.g. .panel in Pixel/Soft), so CSS cannot hard-code them.
   * Attribute path (fallback): when animation-timeline is unsupported (Firefox) or reduced motion is on (module rules
   * switch pseudo animations off; the shade is state, not motion) it sets :root[data-sc-js] (which turns the timeline
   * animations off, so the two paths never double up) and toggles [data-sc-start] / [data-sc-end] from passive scroll
   * listeners. A ResizeObserver per container, a MutationObserver on <body> (containers rendered later by modules,
   * menus, dialogs; class / hidden / open changes) and one on <html> (style / theme switches) keep both up to date.
   * TH.util.scrollEdges.force(true | false | null) forces the fallback on / off / back to auto (debugging).
   */
  const SCROLL_Y = '.th-scroll, .tr-grid, .hl-next-panel, .hl-wiz-side, .hl-cb-list, .hc-help, .lang-list, .ec-side, .hl-detail';
  const SCROLL_X = '.th-scroll-x, .hl-quick, .hc-bar, .ec-mats';
  const scrollEdges = (function () {
    const root = document.documentElement;
    const native = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
    const rm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const els = new Set();
    let forced = null, on = false, raf = 0;
    const setAttr = (el, name, v) => { if (el.hasAttribute(name) !== v) el.toggleAttribute(name, v); };
    const setVar = (el, name, v) => { if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };
    function edges(el) {
      let start = false, end = false;
      if (on) {
        const x = el.__scX, cs = getComputedStyle(el), ov = x ? cs.overflowX : cs.overflowY;
        if (ov === 'auto' || ov === 'scroll') {
          const pos = Math.abs(x ? el.scrollLeft : el.scrollTop);
          const max = x ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
          start = max > 1 && pos > 1; end = max > 1 && pos < max - 1;
        }
      }
      setAttr(el, 'data-sc-start', start); setAttr(el, 'data-sc-end', end);
    }
    function measure(el) {
      const cs = getComputedStyle(el), flow = /flex|grid/.test(cs.display);
      setVar(el, '--sc-pt', cs.paddingTop); setVar(el, '--sc-pr', cs.paddingRight);
      setVar(el, '--sc-pb', cs.paddingBottom); setVar(el, '--sc-pl', cs.paddingLeft);
      const gap = flow ? (el.__scX ? cs.columnGap : cs.rowGap) : '0px';
      setVar(el, '--sc-gap', gap === 'normal' ? '0px' : gap);
      edges(el);
    }
    const onScroll = (e) => { if (on) edges(e.currentTarget); };
    const ro = window.ResizeObserver ? new ResizeObserver((list) => list.forEach((en) => measure(en.target))) : null;
    function attach(el, x) {
      if (els.has(el)) return;
      el.__scX = x; els.add(el);
      el.addEventListener('scroll', onScroll, { passive: true });
      if (ro) ro.observe(el);
    }
    function detach(el) {
      els.delete(el);
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.unobserve(el);
    }
    function scan() {
      raf = 0;
      els.forEach((el) => { if (!el.isConnected) detach(el); });
      document.querySelectorAll(SCROLL_Y).forEach((el) => attach(el, false));
      document.querySelectorAll(SCROLL_X).forEach((el) => attach(el, true));
      els.forEach(measure); // content / padding may have changed without the container resizing
    }
    const queue = () => { if (!raf) raf = requestAnimationFrame(scan); };
    function update() {
      const want = forced != null ? forced : (!native || !!(rm && rm.matches));
      if (want !== on) { on = want; root.toggleAttribute('data-sc-js', on); }
      scan();
    }
    function start() {
      new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
      new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['data-style', 'data-theme', 'data-neu'] });
      window.addEventListener('resize', queue, { passive: true });
      if (rm) { if (rm.addEventListener) rm.addEventListener('change', update); else if (rm.addListener) rm.addListener(update); }
      update();
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    return {
      refresh: scan,
      force: (v) => { forced = v == null ? null : !!v; update(); },
      get active() { return on; },
    };
  })();

  /**
   * Sliding knob for every one-of-N segmented toggle (`.seg`, DESIGN.md "Surface tiers" rule 3b). No module JS needed:
   * a MutationObserver on <body> sees `.on` / aria-checked / aria-pressed changes on a seg's keys and segs added by
   * re-renders; a ResizeObserver per seg (and style / font changes) re-places the knob without motion.
   * Writes on the seg: data-knob = "on" (slides) | "still" (placed without a transition) | "none" (no active key), and
   * --seg-x / --seg-y / --seg-w / --seg-h = the active key's box (offsetLeft/Top/Width/Height inside the seg). The knob is the
   * seg's ::before (styles.css, style-neu.css); the keys sit above it. First paint never slides; a seg that a module
   * re-rendered (new element, same aria-label / aria-labelledby / id) slides from the last known position when the
   * selection changed. Reduced motion: CSS drops the transition. TH.util.segKnob.refresh() re-places every seg.
   */
  const segKnob = (function () {
    const ACTIVE = ':scope > .on, :scope > [aria-checked="true"], :scope > [aria-pressed="true"]';
    const last = new Map();       // seg key -> { i, n, x, y, w, h } (survives re-renders)
    const known = new WeakMap();  // seg element -> last placed geometry
    const watched = new Set();
    const keyOf = (s) => s.id || s.getAttribute('aria-label') || s.getAttribute('aria-labelledby') || s.className;
    const ro = window.ResizeObserver ? new ResizeObserver((list) => list.forEach((en) => place(en.target, false))) : null;
    function setGeo(s, g) {
      s.style.setProperty('--seg-x', g.x + 'px'); s.style.setProperty('--seg-y', g.y + 'px');
      s.style.setProperty('--seg-w', g.w + 'px'); s.style.setProperty('--seg-h', g.h + 'px');
    }
    const settle = (s) => { s.offsetWidth; getComputedStyle(s, '::before').transform; }; // commit the start position
    function place(s, animate) {
      if (!s.isConnected) return;
      if (ro && !watched.has(s)) { watched.add(s); ro.observe(s); }
      const keys = [...s.children].filter((c) => c.tagName === 'BUTTON' || /radio/.test(c.getAttribute('role') || ''));
      const act = s.querySelector(ACTIVE);
      if (!act) { s.dataset.knob = 'none'; known.delete(s); return; }
      if (!act.offsetWidth) return; // hidden (closed menu, display:none): the ResizeObserver places it once it shows
      const g = { i: keys.indexOf(act), n: keys.length, x: act.offsetLeft, y: act.offsetTop, w: act.offsetWidth, h: act.offsetHeight };
      const prev = known.get(s), k = keyOf(s);
      if (prev) {
        // a changed selection always slides; anything else (resize, style switch) only re-targets: a running slide keeps
        // going to the new box, a resting knob jumps ("on" falls back to "still" on transitionend)
        if (prev.i !== g.i) { if (s.dataset.knob !== 'on') { s.dataset.knob = 'still'; settle(s); } s.dataset.knob = 'on'; }
        else if (s.dataset.knob !== 'on') s.dataset.knob = 'still';
        setGeo(s, g);
      } else {
        if (!s.__segEnd) { s.__segEnd = true; s.addEventListener('transitionend', (e) => { if (e.pseudoElement === '::before' && e.propertyName === 'transform' && s.dataset.knob === 'on') s.dataset.knob = 'still'; }); }
        const from = last.get(k);
        s.dataset.knob = 'still';
        if (animate && from && from.i !== g.i && from.n === g.n) { setGeo(s, from); settle(s); s.dataset.knob = 'on'; }
        setGeo(s, g);
      }
      known.set(s, g); last.set(k, g);
    }
    function all(animate) { document.querySelectorAll('.seg').forEach((s) => place(s, animate)); }
    function onMutate(records) {
      const todo = new Map(); // seg -> animate
      const add = (s, a) => { if (s && !(todo.get(s))) todo.set(s, a); };
      for (const r of records) {
        const t = r.target;
        if (r.type === 'attributes') {
          if (t.parentElement && t.parentElement.classList.contains('seg')) add(t.parentElement, true);
          else if (t.classList && t.classList.contains('seg')) add(t, false);
          else if (r.attributeName === 'class' && t.querySelectorAll) t.querySelectorAll('.seg').forEach((s) => add(s, false)); // e.g. a menu un-hidden
        } else {
          if (t.classList && t.classList.contains('seg')) add(t, true);
          r.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (n.classList.contains('seg')) add(n, true);
            n.querySelectorAll('.seg').forEach((s) => add(s, true));
          });
        }
      }
      watched.forEach((s) => { if (!s.isConnected) { watched.delete(s); if (ro) ro.unobserve(s); } });
      todo.forEach((a, s) => place(s, a));
    }
    function start() {
      new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked', 'aria-pressed'] });
      new MutationObserver(() => all(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-style', 'data-theme', 'data-neu'] });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => all(false));
      all(false);
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    return { refresh: () => all(false) };
  })();

  return { h, append, reco, roman, clamp, uid, debounce, toast, ask, guard, emerald, stepper, ring, download, reveal, tooltip, scrollEdges, segKnob };
})();
