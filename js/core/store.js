window.TH = window.TH || {};

/**
 * Single persisted state tree. Modules own a top-level key each
 * (state.enchants, state.villagers, state.trims, ...) and may register
 * defaults + migrations via TH.store.define(key, defaults).
 */
TH.store = (function () {
  const KEY = 'tradingHall.state';
  const VERSION = 1;
  const defaults = { version: VERSION, settings: { theme: 'auto', style: 'classic', styleV: 2, zoom: 0.9 }, customPresets: [] };
  const listeners = new Set();
  let state = load();

  /**
   * One-time style migration (styleV 2): before it, "soft" meant the pixel neumorphism, now called "pixel"; "soft" is
   * the smooth style. Saves without styleV >= 2 get soft -> pixel once; afterwards "soft" is never touched again.
   * The pre-paint script in index.html applies the same rule to localStorage directly.
   */
  function migrate(st) {
    const s = st.settings = Object.assign({ theme: 'auto', style: 'classic' }, st.settings);
    if (!(s.styleV >= 2)) {
      if (s.style === 'soft') s.style = 'pixel';
      s.styleV = 2;
    }
    return st;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(Object.assign(structuredClone(defaults), JSON.parse(raw)));
    } catch (e) { /* storage blocked or corrupt -> start fresh */ }
    return structuredClone(defaults);
  }

  /** Write state to localStorage now; returns true on success (also fires th:saved / th:save-error). */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      window.dispatchEvent(new Event('th:saved'));
      return true;
    } catch (e) { window.dispatchEvent(new Event('th:save-error')); /* storage blocked */ return false; }
  }

  /** Register a module slice with default values (merged shallowly, never overwrites saved data). */
  function define(key, initial) {
    if (state[key] == null) state[key] = structuredClone(initial);
    else if (typeof initial === 'object' && !Array.isArray(initial)) {
      state[key] = Object.assign(structuredClone(initial), state[key]);
    }
  }

  const get = () => state;

  /** Mutate state through fn(draft). Pass {silent:true} to skip re-render (e.g. while typing). */
  function update(fn, opts) {
    fn(state);
    save();
    if (!(opts && opts.silent)) listeners.forEach((l) => l(state));
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function exportJSON() {
    return JSON.stringify({ app: 'trading-hall', exportedAt: new Date().toISOString(), state }, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    const incoming = parsed.state || parsed;
    if (typeof incoming !== 'object' || !incoming) throw new Error('Not a toolbox backup');
    state = migrate(Object.assign(structuredClone(defaults), incoming));
    save();
    listeners.forEach((l) => l(state));
  }

  function reset() {
    state = structuredClone(defaults);
    save();
    // modules re-register their defaults on reload
    location.reload();
  }

  return { define, get, update, subscribe, exportJSON, importJSON, reset, flush: save, VERSION };
})();
