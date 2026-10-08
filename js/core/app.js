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
      return h('a.nav-item' + (m === current ? '.active' : ''), { href: '#/' + m.id, 'data-tool': m.id, 'aria-current': m === current ? 'page' : null },
        h('span.nav-icon', { 'aria-hidden': 'true' }, typeof m.icon === 'string' && m.icon.startsWith('mc:') ? TH.icon(m.icon.slice(3), { size: 18 }) : m.icon),
        h('span.nav-name', m.short ? [h('span.nm-full', m.name), h('span.nm-short', m.short)] : m.name),
        badgeEl(badge),
        m.soon ? h('span.nav-soon', 'soon') : null,
      );
    }));

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
    m: '#d9e4f2', n: '#9fb3cc', s: '#ffe27a',
    b: '#3b6fd6', B: '#86b2ff', g: '#3fb250',
    t: '#b9783a', T: '#8a5424', G: '#f2c33c', L: '#5a3716',
    r: '#d6332a', R: '#9c1f19',
  };
  const PX = {
    sun: ['...oo...', '.o.yy.o.', '..yyyy..', 'oyyyyyyo', 'oyyyyyyo', '..yyyy..', '.o.yy.o.', '...oo...'],
    moon: ['..mmmm..', '.mmmm...', 'mmmm....', 'mmmm....', 'mmmn....', 'mmmmn...', '.mmmnnn.', '..nnnn..'],
    menu: ['cccccccc', 'dddddddd', '........', 'cccccccc', 'dddddddd', '........', 'cccccccc', 'dddddddd'],
    chest: ['.LLLLLL.', 'LttttttL', 'LtttttTL', 'LLLLLLLL', 'LTttGttL', 'LttttttL', 'LTTTTTTL', '.LLLLLL.'],
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
    document.getElementById('backupBtn').replaceChildren(pixIcon('chest'));
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

  function applyTheme() {
    const t = TH.store.get().settings.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    syncThemeBtn();
  }

  /** Top-right ⋯ menu: backup export/import and reset. */
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
    menu.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'export') {
        TH.util.download(`trading-hall-${new Date().toISOString().slice(0, 10)}.json`, TH.store.exportJSON());
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
    document.getElementById('themeBtn').addEventListener('click', () => {
      const dark = isDark();
      TH.store.update((s) => { s.settings.theme = dark ? 'light' : 'dark'; });
      applyTheme();
    });
    initMenu();
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

  /** Save status lives on the chest (backup) button as an outline: saved = accent, pending = neutral pulse, error = red. */
  function initSaveState() {
    const btn = document.getElementById('backupBtn');
    let t, last = null;
    const set = (state) => {
      btn.dataset.save = state;
      const label = state === 'error' ? 'Could not save in this browser · click to back up'
        : state === 'pending' ? 'Saving… · click to back up'
        : 'All changes saved' + (last ? ' (' + last + ')' : '') + ' · click to back up';
      btn.dataset.tip = label;
      btn.setAttribute('aria-label', label);
    };
    window.addEventListener('th:saved', () => {
      last = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      set('pending');
      clearTimeout(t);
      t = setTimeout(() => set('saved'), 650);
    });
    window.addEventListener('th:save-error', () => { clearTimeout(t); set('error'); });
    set('saved');
    btn.addEventListener('click', () => {
      TH.util.download(`toolbox-backup-${new Date().toISOString().slice(0, 10)}.json`, TH.store.exportJSON());
      TH.util.toast('Backup file saved — import it via ⋯ on another device');
    });
  }

  /**
   * Offline: on http(s) a service worker caches the app and every Minecraft texture
   * (see sw.js + js/core/icon-list.js). Shows "Offline" in the status when there is no network.
   */
  function initOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
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
