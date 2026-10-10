window.TH = window.TH || {};

/**
 * Module registry + router.
 *
 * Adding a feature = one new file in js/modules/ that calls:
 *   TH.app.register({
 *     id: 'trims', name: 'Armor Trims', icon: '◆',
 *     soon: false,                       // optional "coming soon" tag in nav
 *     short: 'Portal',                   // optional: shorter nav label on phones
 *     hidden: true,                      // optional: routable but not a nav tab (the overview landing)
 *     init(store) {},                    // optional: define state slice
 *     render(root, state) {},            // required: draw into root
 *     badge(state) { return '3' },       // optional: nav badge: string, or { done, total } -> progress pill
 *   });
 * and a <script> tag in index.html.
 * <html data-tool="<module id>"> is set on every route; styles.css maps it to the feature accent colour.
 */
TH.app = (function () {
  const { h } = TH.util;
  const modules = [];
  let current = null;

  function register(mod) { modules.push(mod); }

  function route() {
    // no hash (fresh visit / logo) = the overview landing page; it is a module but not a nav tab
    const id = (location.hash || '').replace('#/', '') || 'overview';
    current = modules.find((m) => m.id === id) || modules.find((m) => m.id === 'overview') || modules[0];
    window.scrollTo(0, 0);
    render();
  }

  /** Module badge: a string, or { done, total } rendered as a progress pill. */
  function badgeEl(b) {
    if (b == null || b === '' || b === false) return null;
    if (typeof b === 'object') {
      const total = Math.max(0, +b.total || 0), done = Math.min(total, Math.max(0, +b.done || 0));
      const el = h('span.nav-badge.is-progress' + (total && done >= total ? '.is-done' : ''), done + '/' + total);
      TH.util.tooltip(el, done + ' of ' + total + ' done');
      el.style.setProperty('--p', (total ? (done / total) * 100 : 0) + '%');
      return el;
    }
    return h('span.nav-badge', String(b));
  }

  /** Re-draw only the nav badges (for modules that patch their view without a full render). */
  function refreshBadges() {
    const state = TH.store.get();
    modules.forEach((m) => {
      const a = document.querySelector('#nav .nav-item[data-tool="' + m.id + '"]');
      if (!a) return;
      const old = a.querySelector('.nav-badge'), next = badgeEl(m.badge && m.badge(state));
      if (old && next) old.replaceWith(next); else if (old) old.remove(); else if (next) a.querySelector('.nav-name').after(next);
    });
    fitNav();
  }

  /**
   * Top-nav fit (desktop; phones use the bottom tab bar). Measured, not a breakpoint: #nav[data-fit] steps through
   *   full names -> short names -> inactive tabs icon-only (active keeps its label) -> all tabs icon-only
   *   -> 'tight' (all icon-only + the brand folds to its logo, .topbar[data-brand="compact"]; ~641-790px)
   * and takes the widest stage whose measured width fits the room left between brand and toolbar. The width every stage
   * needs is measured once per nav content (labels, badges, active tab, style, fonts) and cached; resizes only compare.
   * Hysteresis: a wider stage only comes back with FIT_HYST px to spare, so the bar never flickers at a threshold.
   */
  const FIT = ['full', 'short', 'icons', 'all', 'tight'];
  const FIT_HYST = 16; // extra px a wider stage needs before it comes back
  const FIT_PAD = 12;  // breathing room every stage keeps beside the grid gaps, so the bar never looks jammed
  const phoneMQ = matchMedia('(max-width: 640px)');
  let fitNeed = null, fitSig = '', fitRO = null, fitBrandGain = 0;
  const iconOnly = (a) => {
    const f = a.parentElement && a.parentElement.dataset.fit;
    return !phoneMQ.matches && (f === 'all' || f === 'tight' || (f === 'icons' && !a.classList.contains('active')));
  };
  /** What the tab's badge / "soon" tag says, for the tooltip and the aria-label of an icon-only tab. */
  function navNote(a) {
    const b = a.querySelector('.nav-badge');
    if (b) {
      const m = b.classList.contains('is-progress') && b.textContent.match(/^(\d+)\/(\d+)$/);
      return m ? m[1] + ' of ' + m[2] + ' done' : b.textContent;
    }
    return a.querySelector('.nav-soon') ? 'Coming soon' : '';
  }
  /** App tooltip with the tab's name, shown only while the tab is icon-only. */
  function navTip(a, m) {
    TH.util.tooltip(a, () => {
      if (!iconOnly(a)) return null;
      const note = navNote(a);
      return [h('div.th-tooltip-title', m.name), note ? h('div.th-tooltip-sub', note) : null].filter(Boolean);
    });
  }
  /** Room the nav can take: the top bar's content box minus brand, toolbar and the grid / flex gaps. */
  function navRoom(bar, nav) {
    const cs = getComputedStyle(bar);
    let w = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), n = 0;
    for (const el of bar.children) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue;
      n++;
      w -= parseFloat(s.marginLeft) + parseFloat(s.marginRight);
      if (el !== nav) w -= el.getBoundingClientRect().width;
    }
    return w - Math.max(0, n - 1) * (parseFloat(cs.columnGap) || 0);
  }
  function fitNav(force) {
    const nav = document.getElementById('nav'), bar = nav && nav.closest('.topbar');
    if (!nav || !bar || !nav.firstElementChild) return;
    if (!fitRO && window.ResizeObserver) {
      fitRO = new ResizeObserver(() => fitNav());
      // not the brand: fitNav itself folds it ('tight'), observing it would re-enter at the same depth (RO loop warning)
      [bar, bar.querySelector('.topbar-actions')].forEach((el) => el && fitRO.observe(el));
      phoneMQ.addEventListener('change', () => fitNav(true));
      if (document.fonts) { document.fonts.addEventListener('loadingdone', () => fitNav(true)); document.fonts.ready.then(() => fitNav(true)); }
    }
    if (!phoneMQ.matches) {
      const sig = document.documentElement.dataset.style + '|' + nav.textContent + '|' + (nav.querySelector('.active') || {}).href;
      const brand = bar.querySelector('.brand');
      if (force || !fitNeed || sig !== fitSig) {
        // measure every stage synchronously (no paint in between, so nothing flashes)
        const was = nav.dataset.fit, wasB = bar.dataset.brand;
        fitNeed = FIT.map((s) => { nav.dataset.fit = s; return nav.scrollWidth + nav.offsetWidth - nav.clientWidth; });
        delete bar.dataset.brand;
        const bw = brand ? brand.getBoundingClientRect().width : 0;
        bar.dataset.brand = 'compact';
        fitBrandGain = brand ? Math.max(0, bw - brand.getBoundingClientRect().width) : 0;
        if (was) nav.dataset.fit = was; else delete nav.dataset.fit;
        if (wasB) bar.dataset.brand = wasB; else delete bar.dataset.brand;
        fitSig = sig;
      }
      // room next to the full brand; 'tight' also folds the brand to its logo and gains that width
      const room = navRoom(bar, nav) - (bar.dataset.brand === 'compact' ? fitBrandGain : 0), cur = FIT.indexOf(nav.dataset.fit);
      let pick = FIT.length - 1;
      for (let i = 0; i < FIT.length; i++) {
        const r = room + (FIT[i] === 'tight' ? fitBrandGain : 0);
        if (fitNeed[i] + FIT_PAD <= r + 0.5 - (cur >= 0 && i < cur ? FIT_HYST : 0)) { pick = i; break; }
      }
      if (nav.dataset.fit !== FIT[pick]) nav.dataset.fit = FIT[pick];
      if (FIT[pick] === 'tight') bar.dataset.brand = 'compact'; else delete bar.dataset.brand;
    } else delete bar.dataset.brand;
    // icon-only tabs keep their name for assistive tech
    nav.querySelectorAll('.nav-item').forEach((a) => {
      if (!iconOnly(a)) { a.removeAttribute('aria-label'); return; }
      const name = (modules.find((m) => m.id === a.dataset.tool) || {}).name || a.textContent, note = navNote(a);
      a.setAttribute('aria-label', note ? name + ', ' + note : name);
    });
  }

  /** Background: small pixelated mob faces (cropped from entity skins) rising slowly. */
  function initAtmosphere() {
    const box = document.getElementById('atmosphere');
    if (!box || !TH.icon.mobFaces || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const faces = TH.icon.mobFaces, N = 18;
    for (let i = 0; i < N; i++) {
      const [p, sw, sh, fx, fy, fw, fh, k] = faces[i % faces.length];
      const el = document.createElement('span');
      el.className = 'mob';
      const st = el.style;
      st.setProperty('--tex', 'url("' + TH.icon.tex(p) + '")');
      st.setProperty('--w', fw * k); st.setProperty('--h', fh * k);
      st.setProperty('--bs', sw * k + 'px ' + sh * k + 'px');
      st.setProperty('--bp', -fx * k + 'px ' + -fy * k + 'px');
      st.setProperty('--x', Math.round(((i * 37) % 97) + 1));
      st.setProperty('--d', 70 + ((i * 13) % 50));
      st.setProperty('--w2', (i * 29) % 110);
      box.appendChild(el);
    }
  }

  function render() {
    const state = TH.store.get();
    const nav = document.getElementById('nav');
    document.documentElement.dataset.tool = current.id;
    nav.replaceChildren(...modules.filter((m) => !m.hidden).map((m) => {
      const badge = m.badge && m.badge(state);
      const a = h('a.nav-item' + (m === current ? '.active' : ''), { href: '#/' + m.id, 'data-tool': m.id, 'aria-current': m === current ? 'page' : null },
        h('span.nav-icon', { 'aria-hidden': 'true' }, typeof m.icon === 'string' && m.icon.startsWith('mc:') ? TH.icon(m.icon.slice(3), { size: 18 }) : m.icon),
        h('span.nav-name', m.short ? [h('span.nm-full', m.name), h('span.nm-short', m.short)] : m.name),
        badgeEl(badge),
        m.soon ? h('span.nav-soon', 'soon') : null,
      );
      navTip(a, m);
      return a;
    }));
    fitNav();

    const view = document.getElementById('view');
    // preserve scroll + focused field across re-renders of the same module
    const scroll = window.scrollY;
    let focusKey = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.focus;
    let caret = null;
    try { caret = focusKey ? document.activeElement.selectionStart : null; } catch (e) { /* number inputs */ }
    if (TH.app.pendingFocus) { focusKey = TH.app.pendingFocus; caret = null; TH.app.pendingFocus = null; }
    // staggered entrance only when the tab actually changes, never on re-render
    const root = h('div.module.module-' + current.id + (view.dataset.mod !== current.id ? '.enter' : ''));
    try {
      current.render(root, state);
    } catch (err) {
      // one broken module must never take the whole app down
      console.error(err);
      root.replaceChildren(h('div.panel.module-error', `Something went wrong in “${current.name}”: ${err.message}`));
    }
    view.replaceChildren(root);
    if (view.dataset.mod === current.id) window.scrollTo(0, scroll);
    view.dataset.mod = current.id;
    if (focusKey) {
      const el = view.querySelector(`[data-focus="${focusKey}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret != null) try { el.setSelectionRange(caret, caret); } catch (e) { /* number inputs */ }
      }
    }
  }


  /**
   * Pixel-art glyphs for the top toolbar, drawn on an 8x8 grid and shown at 2x (16px) with
   * crispEdges, so they stay sharp and render even when the texture CDN is unreachable.
   * Palette letters: see PX_PAL (c = currentColor, d = currentColor at 45%).
   */
  const PX_PAL = {
    y: '#ffd23c', o: '#f08a1c', w: '#f4f1e6', k: '#2a2a35', c: 'currentColor', d: 'currentColor',
    m: '#b8c4d6', n: '#9fb3cc', s: '#ffe27a',
    b: '#3b6fd6', B: '#86b2ff', g: '#3fb250',
    t: '#b9783a', T: '#8a5424', G: '#f2c33c', L: '#5a3716',
    r: '#d6332a', R: '#9c1f19',
  };
  const PX = {
    sun: ['...oo...', '.o.yy.o.', '..yyyy..', 'oyyyyyyo', 'oyyyyyyo', '..yyyy..', '.o.yy.o.', '...oo...'],
    moon: ['..mmmm..', '.mmmm...', 'mmmm....', 'mmmm....', 'mmmn....', 'mmmmn...', '.mmmnnn.', '..nnnn..'],
    menu: ['cccccccc', 'dddddddd', '........', 'cccccccc', 'dddddddd', '........', 'cccccccc', 'dddddddd'],
    floppy: ['ccmmmmc.', 'ccmmkmcc', 'ccmmmmcc', 'cccccccc', 'cwwwwwwc', 'cwwwwwwc', 'cwwwwwwc', 'cwwwwwwc'],
    style: ['cccccc..', 'c....c..', 'c..ccccc', 'c..c...c', 'cccc...c', '...c...c', '...c...c', '...ccccc'],
    globe: ['..bbbb..', '.bggBbb.', 'bgggbbgb', 'bggbbggb', 'bbbbgggb', 'bbgbbggb', '.bbbbbb.', '..bbbb..'],
    up: ['...cc...', '..cccc..', '.cccccc.', '...cc...', '...cc...', '...cc...', 'cccccccc', '........'],
    down: ['........', 'cccccccc', '...cc...', '...cc...', '...cc...', '.cccccc.', '..cccc..', '...cc...'],
    tnt: ['rrrrrrrr', 'rRrRrRrR', 'wwwwwwww', 'wkwkkwkw', 'wwwwwwww', 'rRrRrRrR', 'rrrrrrrr', '........'],
  };
  function pixIcon(name, scale = 2) {
    const art = PX[name];
    let rects = '';
    art.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const ch = row[x];
        let e = x + 1;
        while (e < row.length && row[e] === ch) e++;
        if (ch !== '.') rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${PX_PAL[ch]}"${ch === 'd' ? ' fill-opacity=".45"' : ''}/>`;
        x = e;
      }
    });
    const n = art.length * scale;
    const span = document.createElement('span');
    span.className = 'pix';
    span.innerHTML = `<svg viewBox="0 0 8 8" width="${n}" height="${n}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
    return span;
  }

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** Fill the toolbar buttons with pixel glyphs (theme glyph shows the current mode: sun by day, moon by night). */
  function initToolbarIcons() {
    document.getElementById('backupBtn').replaceChildren(pixIcon('floppy'));
    document.getElementById('menuBtn').replaceChildren(pixIcon('menu'));
    document.querySelector('.lang-globe').replaceChildren(pixIcon('globe'));
    document.querySelectorAll('#menu .mi').forEach((el) => el.replaceChildren(pixIcon(el.dataset.ico)));
    const tb = document.getElementById('themeBtn');
    tb.replaceChildren(pixIcon('sun'), pixIcon('moon'));
    // one coherent app tooltip for the toolbar (text lives in data-tip; static titles are moved there)
    ['brand', 'backupBtn', 'themeBtn', 'menuBtn', 'langBtn', 'lang'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.title) { if (!el.dataset.tip) el.dataset.tip = el.title; el.removeAttribute('title'); }
      if (id !== 'lang') TH.util.tooltip(el, () => el.dataset.tip);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtn);
  }
  function syncThemeBtn() {
    const tb = document.getElementById('themeBtn');
    const dark = isDark();
    tb.dataset.mode = dark ? 'dark' : 'light';
    tb.setAttribute('aria-pressed', dark);
    tb.dataset.tip = dark ? 'Night mode (click for light)' : 'Day mode (click for dark)';
  }

  /** Run a theme / style change as a cross-fade (View Transitions), or with transitions muted when that is not available. */
  function morph(fn) {
    const el = document.documentElement;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
    if (document.startViewTransition) {
      const t = document.startViewTransition(fn);
      t.finished.catch(() => {});
      return;
    }
    el.classList.add('th-switching'); fn();
    setTimeout(() => el.classList.remove('th-switching'), 350);
  }

  /** The whole page runs at the sizing of a 90% browser zoom (a notch smaller reads better). No switch: it is just the default size. */
  const applyZoom = () => { document.documentElement.style.zoom = '0.9'; };

  function applyTheme() {
    const t = TH.store.get().settings.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    syncThemeBtn();
  }

  /**
   * Visual style, persisted in settings.style:
   *   "classic" = blocky inventory (default) | "pixel" = Minecraft neumorphism | "soft" = smooth neumorphism.
   * <html data-style> carries the value; both neumorphic styles also get the boolean data-neu attribute, which scopes the
   * shared tier system in css/style-neu.css. Old saves are migrated once in store.js (styleV). Unknown values = classic.
   */
  const STYLES = ['classic', 'pixel', 'soft'];
  const styleOf = (v) => (STYLES.includes(v) ? v : 'classic');
  function applyStyle() {
    const s = styleOf(TH.store.get().settings.style);
    const root = document.documentElement;
    root.dataset.style = s;
    if (s === 'classic') delete root.dataset.neu; else root.dataset.neu = '';
    document.querySelectorAll('#styleSeg [data-style-key]').forEach((b) => {
      const on = b.dataset.styleKey === s;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    fitNav(); // nav tab metrics differ per style
  }

  /** ⋯ menu style switcher: 3 keys (radio semantics), applies instantly and keeps the menu open so styles can be compared. */
  function initStyleSeg() {
    const seg = document.getElementById('styleSeg');
    if (!seg) return;
    const keys = [...seg.querySelectorAll('[data-style-key]')];
    const tips = {
      classic: ['Classic', 'Blocky inventory'],
      pixel: ['Pixel', 'Minecraft neumorphism: pixel bevels, stepped shadows'],
      soft: ['Soft', 'Smooth neumorphism: soft blurred light, no pixel bevels'],
    };
    const pick = (key) => {
      if (styleOf(TH.store.get().settings.style) !== key) TH.store.update((st) => { st.settings.style = key; }, { silent: true });
      morph(applyStyle);
    };
    keys.forEach((b) => {
      const [t, sub] = tips[b.dataset.styleKey];
      TH.util.tooltip(b, () => [TH.util.h('div.th-tooltip-title', t), TH.util.h('div.th-tooltip-sub', sub)]);
    });
    seg.addEventListener('click', (e) => {
      e.stopPropagation(); // the document click handler would close the menu
      const b = e.target.closest('[data-style-key]');
      if (b) pick(b.dataset.styleKey);
    });
    seg.addEventListener('keydown', (e) => {
      const i = keys.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const j = step ? (i + step + keys.length) % keys.length : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      keys[j].focus();
      pick(keys[j].dataset.styleKey);
    });
  }

  /** Top-right ⋯ menu: backup export/import, style toggle and reset. */
  function initMenu() {
    const btn = document.getElementById('menuBtn');
    const menu = document.getElementById('menu');
    const file = document.getElementById('importFile');
    const toggle = (open) => {
      menu.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open);
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu.classList.contains('hidden')); });
    document.addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    // the style keys keep the menu open on purpose; leaving the page (link, back button, keyboard) still closes it
    window.addEventListener('hashchange', () => toggle(false));
    menu.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'export') {
        TH.util.download(`toolbox-${new Date().toISOString().slice(0, 10)}.json`, TH.store.exportJSON());
      } else if (act === 'import') {
        file.click();
      } else if (act === 'reset' && confirm('Erase all progress, prices, gear and presets? This cannot be undone.')) {
        TH.store.reset();
      }
    });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        TH.store.importJSON(await f.text());
        TH.util.toast('Backup restored');
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        TH.util.toast('Import failed: ' + err.message);
      }
      file.value = '';
    });
  }

  function start() {
    modules.forEach((m) => m.init && m.init(TH.store));
    initToolbarIcons();
    applyTheme();
    applyStyle();
    document.getElementById('themeBtn').addEventListener('click', () => {
      const dark = isDark();
      TH.store.update((s) => { s.settings.theme = dark ? 'light' : 'dark'; });
      morph(() => { applyTheme(); fitNav(); });
    });
    initMenu();
    initStyleSeg();
    applyZoom(); if (window.TH_LOCAL_ASSETS) document.documentElement.dataset.artifact = "1";
    initLang();
    initSaveState();
    initOffline();
    initFooter();
    initAtmosphere();
    TH.store.subscribe(render);
    window.addEventListener('hashchange', route);
    // load the saved language's official game names before the first paint
    TH.i18n.setLang(TH.store.get().settings.lang || 'en_us').then(route);
  }

  /** Global footer: (c) + current year, and an About toggle that expands the footer upward (aria-expanded, Esc closes). */
  function initFooter() {
    const yr = document.getElementById('footYear'), btn = document.getElementById('footToggle'), box = document.getElementById('footAbout');
    if (yr) yr.textContent = new Date().getFullYear();
    if (!btn || !box) return;
    box.inert = true;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    let raf = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));
    /** After opening, scroll just enough that the whole panel (and the bar below it) is visible, in step with the reveal. */
    const revealPanel = () => {
      const clip = box.firstElementChild, grow = clip.scrollHeight - clip.offsetHeight;
      const nav = document.getElementById('nav');
      const bottomLimit = innerHeight - (getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0) - 8;
      const tb = document.querySelector('.topbar');
      const topLimit = (tb ? tb.getBoundingClientRect().bottom : 0) + 8;
      const foot = btn.closest('.foot').getBoundingClientRect();
      let delta = Math.max(0, foot.bottom + grow - bottomLimit);
      // never push the top of the panel under the sticky top bar
      delta = Math.min(delta, Math.max(0, box.getBoundingClientRect().top - topLimit));
      if (delta < 1) return;
      const y0 = scrollY;
      if (reduced()) { scrollTo(0, y0 + delta); return; }
      const t0 = performance.now(), D = 450;
      stop();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / D);
        scrollTo(0, y0 + delta * ease(p));
        raf = p < 1 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };
    const set = (open) => {
      btn.setAttribute('aria-expanded', open);
      box.inert = !open;
      if (open) revealPanel();
      box.classList.toggle('open', open);
    };
    btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true' && box.contains(document.activeElement)) { set(false); btn.focus(); } });
  }

  /**
   * Save button (floppy). Click = flush state to localStorage now. Every save (manual or auto, `th:saved`) blinks the
   * floppy (data-save="saving") and shows a brief "SAVED" to its left; failure = red + "NOT SAVED" until the next good save.
   */
  function initSaveState() {
    const btn = document.getElementById('backupBtn');
    const msg = document.getElementById('saveMsg');
    let t, m, last = null;
    const tip = (txt) => { btn.dataset.tip = txt; btn.setAttribute('aria-label', txt); };
    const OK = 'Save now · auto-saves as you go';
    tip(OK);
    window.addEventListener('th:saved', () => {
      last = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      btn.dataset.save = 'saving';
      msg.textContent = 'SAVED';
      msg.className = 'save-msg show';
      tip(OK + ' · last saved ' + last);
      clearTimeout(t); clearTimeout(m);
      t = setTimeout(() => { btn.dataset.save = 'saved'; }, 700);
      m = setTimeout(() => { msg.className = 'save-msg'; }, 1500);
    });
    window.addEventListener('th:save-error', () => {
      clearTimeout(t); clearTimeout(m);
      btn.dataset.save = 'error';
      msg.textContent = 'NOT SAVED';
      msg.className = 'save-msg show err';
      tip('Could not save in this browser (storage blocked or full) · use ⋯ → Export backup');
    });
    btn.addEventListener('click', () => TH.store.flush());
  }

  /**
   * Offline: on http(s) a service worker caches the app and every Minecraft texture
   * (see sw.js + js/core/icon-list.js). Shows "Offline" in the status when there is no network.
   */
  function initOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || window.TH_LOCAL_ASSETS) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const warm = () => {
        const sw = navigator.serviceWorker.controller || reg.active;
        if (sw && TH.iconList) sw.postMessage({ type: 'warm', urls: TH.iconList.map(TH.icon.remote).concat((TH.icon.mobFaces || []).map((f) => TH.icon.tex(f[0]))) });
      };
      navigator.serviceWorker.ready.then(() => setTimeout(warm, 1500));
    }).catch(() => { /* offline support is a bonus */ });
  }

  /** Short bar code from a locale code: "en_us" -> EN, "en_gb" -> EN-GB, "pt_br" -> PT-BR, "esan" -> ESAN. */
  function langShort(l) {
    const parts = l.code.split('_');
    if (parts.length < 2) return l.code.toUpperCase();
    const [base, reg] = parts;
    const shared = TH.i18n.languages.filter((x) => x.code.split('_')[0] === base).length > 1;
    if (!shared || reg === base || l.code === 'en_us') return base.toUpperCase();
    return (base + '-' + reg).toUpperCase();
  }

  /** Language picker: custom listbox (button shows a short code, the list shows full names). Game terms only; UI stays English. */
  function initLang() {
    const wrap = document.getElementById('lang'), btn = document.getElementById('langBtn'), list = document.getElementById('langList'), codeEl = document.getElementById('langCode');
    const langs = TH.i18n.languages;
    const label = (l) => (l.region && langs.filter((x) => x.name === l.name).length > 1 ? `${l.name} (${l.region})` : l.name);
    let cur = TH.store.get().settings.lang || 'en_us';
    if (!langs.some((l) => l.code === cur)) cur = 'en_us';
    const opts = langs.map((l) => h('li.lang-opt', { role: 'option', id: 'lang-' + l.code, 'data-code': l.code, 'aria-selected': 'false' },
      h('span.lang-opt-code', langShort(l)), h('span.lang-opt-name', label(l))));
    list.replaceChildren(...opts);
    const curLang = () => langs.find((l) => l.code === cur) || langs[0];
    const paint = () => {
      const l = curLang();
      codeEl.textContent = langShort(l);
      btn.dataset.tip = 'Game names language: ' + label(l);
      opts.forEach((o) => o.setAttribute('aria-selected', String(o.dataset.code === cur)));
    };
    let active = 0, typed = '', typedT;
    const setActive = (i, scroll = true) => {
      active = Math.max(0, Math.min(opts.length - 1, i));
      opts.forEach((o, k) => o.classList.toggle('active', k === active));
      list.setAttribute('aria-activedescendant', opts[active].id);
      if (scroll) opts[active].scrollIntoView({ block: 'nearest' });
    };
    const isOpen = () => !list.classList.contains('hidden');
    const open = () => {
      list.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      setActive(langs.findIndex((l) => l.code === cur), false);
      list.focus({ preventScroll: true });
      list.scrollTop = Math.max(0, opts[active].offsetTop - list.clientHeight / 2 + opts[active].offsetHeight / 2);
    };
    const close = (refocus) => {
      if (!isOpen()) return;
      list.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    };
    const choose = (i) => {
      const code = langs[i].code;
      close(true);
      if (code === cur) return;
      cur = code;
      paint();
      TH.i18n.setLang(code).then(() => TH.store.update((s) => { s.settings.lang = code; }));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); isOpen() ? close(true) : open(); });
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); }
    });
    list.addEventListener('click', (e) => { e.stopPropagation(); const o = e.target.closest('.lang-opt'); if (o) choose(opts.indexOf(o)); });
    list.addEventListener('mousemove', (e) => { const o = e.target.closest('.lang-opt'); if (o && opts.indexOf(o) !== active) setActive(opts.indexOf(o), false); });
    list.addEventListener('keydown', (e) => {
      const k = e.key, page = Math.max(1, Math.floor(list.clientHeight / 30) - 1);
      if (k === 'ArrowDown') setActive(active + 1);
      else if (k === 'ArrowUp') setActive(active - 1);
      else if (k === 'PageDown') setActive(active + page);
      else if (k === 'PageUp') setActive(active - page);
      else if (k === 'Home') setActive(0);
      else if (k === 'End') setActive(opts.length - 1);
      else if (k === 'Enter' || k === ' ') choose(active);
      else if (k === 'Escape') close(true);
      else if (k === 'Tab') close(false);
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typed += k.toLowerCase();
        clearTimeout(typedT);
        typedT = setTimeout(() => { typed = ''; }, 700);
        const names = langs.map((l) => label(l).toLowerCase());
        let i = names.findIndex((n, j) => j >= (typed.length > 1 ? active : active + 1) && n.startsWith(typed));
        if (i < 0) i = names.findIndex((n) => n.startsWith(typed));
        if (i >= 0) setActive(i);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(false); });
    paint();
  }

  return { register, start, render, refreshBadges, pendingFocus: null, get modules() { return modules; } };
})();
