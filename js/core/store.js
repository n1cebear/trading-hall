window.TH = window.TH || {};

/**
 * Single persisted state tree. Modules own a top-level key each
 * (state.enchants, state.villagers, state.trims, ...) and may register
 * defaults + migrations via TH.store.define(key, defaults).
 */
TH.store = (function () {
  const KEY = 'tradingHall.state';
  const VERSION = 1;
  const defaults = { version: VERSION, settings: { theme: 'auto' }, customPresets: [] };
  const listeners = new Set();
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(structuredClone(defaults), JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt -> start fresh */ }
    return structuredClone(defaults);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      window.dispatchEvent(new Event('th:saved'));
    } catch (e) { /* storage blocked */ }
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
    if (typeof incoming !== 'object' || !incoming) throw new Error('Not a Trading Hall backup');
    state = Object.assign(structuredClone(defaults), incoming);
    save();
    listeners.forEach((l) => l(state));
  }

  function reset() {
    state = structuredClone(defaults);
    save();
    // modules re-register their defaults on reload
    location.reload();
  }

  return { define, get, update, subscribe, exportJSON, importJSON, reset, VERSION };
})();
