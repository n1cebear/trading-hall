window.TH = window.TH || {};

/**
 * Module registry + router.
 *
 * Adding a feature = one new file in js/modules/ that calls:
 *   TH.app.register({
 *     id: 'trims', name: 'Armor Trims', icon: '◆',
 *     soon: false,                       // optional "coming soon" tag in nav
 *     init(store) {},                    // optional: define state slice
 *     render(root, state) {},            // required: draw into root
 *     badge(state) { return '3' },       // optional: nav badge text
 *   });
 * and a <script> tag in index.html.
 */
TH.app = (function () {
  const { h } = TH.util;
  const modules = [];
  let current = null;

  function register(mod) { modules.push(mod); }

  function route() {
    const id = (location.hash || '').replace('#/', '') || modules[0].id;
    current = modules.find((m) => m.id === id) || modules[0];
    render();
  }

  function render() {
    const state = TH.store.get();
    const nav = document.getElementById('nav');
    nav.replaceChildren(...modules.map((m) => {
      const badge = m.badge && m.badge(state);
      return h('a.nav-item' + (m === current ? '.active' : ''), { href: '#/' + m.id, 'aria-current': m === current ? 'page' : null },
        h('span.nav-icon', { 'aria-hidden': 'true' }, typeof m.icon === 'string' && m.icon.startsWith('mc:') ? TH.icon(m.icon.slice(3), { size: 18 }) : m.icon),
        h('span.nav-name', m.name),
        badge ? h('span.nav-badge', badge) : null,
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

  function applyTheme() {
    const t = TH.store.get().settings.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
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
      const act = e.target.dataset.act;
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
    applyTheme();
    document.getElementById('themeBtn').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      TH.store.update((s) => { s.settings.theme = dark ? 'light' : 'dark'; });
      applyTheme();
    });
    initMenu();
    initLang();
    initSaveState();
    initOffline();
    TH.store.subscribe(render);
    window.addEventListener('hashchange', route);
    // load the saved language's official game names before the first paint
    TH.i18n.setLang(TH.store.get().settings.lang || 'en_us').then(route);
  }

  /** "Saved" status in the top bar (data auto-saves on every change) + one-click backup file. */
  function initSaveState() {
    const el = document.getElementById('saveState');
    const txt = el.querySelector('.save-text');
    let t;
    window.addEventListener('th:saved', () => {
      txt.textContent = 'Saved';
      el.classList.add('flash');
      el.title = 'Saved automatically in this browser at ' + new Date().toLocaleTimeString();
      clearTimeout(t);
      t = setTimeout(() => el.classList.remove('flash'), 900);
    });
    const btn = document.getElementById('backupBtn');
    btn.appendChild(TH.icon('item/bundle', { size: 20 }));
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
    const el = document.getElementById('saveState');
    const net = () => {
      el.classList.toggle('offline', !navigator.onLine);
      el.querySelector('.save-text').textContent = navigator.onLine ? 'Saved' : 'Saved · offline';
    };
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    net();
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const warm = () => {
        const sw = navigator.serviceWorker.controller || reg.active;
        if (sw && TH.iconList) sw.postMessage({ type: 'warm', urls: TH.iconList.map(TH.icon.remote) });
      };
      navigator.serviceWorker.ready.then(() => setTimeout(warm, 1500));
    }).catch(() => { /* offline support is a bonus */ });
  }

  /** Language picker: switches game terms only (official Mojang strings); UI stays English. */
  function initLang() {
    const sel = document.getElementById('langSel');
    const cur = TH.store.get().settings.lang || 'en_us';
    sel.replaceChildren(...TH.i18n.languages.map((l) =>
      h('option', { value: l.code, selected: l.code === cur }, l.region && TH.i18n.languages.filter((x) => x.name === l.name).length > 1 ? `${l.name} (${l.region})` : l.name)));
    sel.addEventListener('change', () => {
      const code = sel.value;
      TH.i18n.setLang(code).then(() => TH.store.update((s) => { s.settings.lang = code; }));
    });
  }

  return { register, start, render, pendingFocus: null, get modules() { return modules; } };
})();
