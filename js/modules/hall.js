/**
 * Trading Hall module — the main tab.
 *
 * One combined plan: librarian books + every other villager you want.
 *   1. Setup wizard (Start → Books → Trades → Review) picks WHAT you want.
 *   2. Dashboard shows WHERE you are: an infinite, zoomable canvas of your hall (hall-canvas.js:
 *      drag tiles anywhere, marquee-select, snap + guides, undo), a sortable "Next up" list that becomes a details panel for the
 *      selected villager, and "Check an offer" (judges an in-game offer, adds it in one tap).
 *
 * state.hall = {
 *   setupDone, step, editing, migrated,
 *   books:   { [enchId]: { level, stalls: [{ id, label, done, price }] } },  // one stall = one librarian
 *   archive: { [enchId]: book },             // removed books, restored with their progress if re-added
 *   trades:  [{ id, prof, purpose, target, have, group, note }],
 *   layout:  { v: 3, pos: { [villagerKey]: { x, y } } },   // world px of each tile's top-left (tile 72, grid unit 80)
 *   check:   { open, ench, level, price, query },   // the "Check an offer" dialog
 *   ui:      { selected, multi: [keys] (2+ selected), nextSort: type|name|pos|price, search, expanded: { [enchId]: true },
 *            view: { px, py, z, snap, guides, map } | null (canvas pan / zoom / toolbar toggles) },
 *   activePreset,
 * }
 * villagerKey = 'b:' + stallId  |  't:' + tradeId + ':' + n   (n = 0 .. target-1)
 * Every villager always has a position: new ones are auto-placed (sorted by type) into free space after the layout.
 */
(function () {
  const { h, emerald, ring, clamp, uid, toast, stepper: baseStepper } = TH.util;
  const D = TH.data;
  const I18 = TH.i18n;

  /* ================= static data ================= */

  const ENCH = Object.fromEntries(D.enchantments.map((e) => [e.id, e]));
  const PROF = Object.fromEntries(D.professions.map((p) => [p.id, p]));
  const CAT_IDX = Object.fromEntries(D.enchantCategories.map((c, i) => [c.id, i]));
  // enchantments ordered by category, then by data order
  const SORTED = D.enchantments.slice().sort((a, b) =>
    (CAT_IDX[a.category] - CAT_IDX[b.category]) || (D.enchantments.indexOf(a) - D.enchantments.indexOf(b)));
  const LIB_ENCH = SORTED.filter((e) => e.librarian);
  const GROUPS = D.roleGroups.concat([{ id: 'other', name: 'Other', hint: 'Anything else you want' }]);
  const TIER_LABEL = { perfect: 'Perfect', great: 'Great', good: 'Okay', meh: 'Pricey', unknown: 'No price' };
  const STATUS_LABEL = { needed: 'needed', locked: 'locked in', perfect: 'perfect price' };
  const TITLE = 'Trading Hall Planner';
  const LOCK_WHY = 'Locked = you traded with it once; Minecraft fixes its offers, so no more rerolling.';
  const CG = 80; // canvas grid unit (tile 72 + gap 8); keep in sync with hall-canvas.js

  /** Why an enchant can't come from a librarian. */
  const NOT_LIBRARIAN = {
    soul_speed: 'Only from bastion loot & piglin bartering',
    swift_sneak: 'Only from ancient city loot',
    wind_burst: 'Only from ominous trial vaults',
  };

  /** Short English names that fit a canvas tile (other languages use the full localized name, truncated). */
  const ABBR = {
    protection: 'Prot', fire_protection: 'FireP', blast_protection: 'Blast', projectile_protection: 'Proj',
    thorns: 'Thorn', feather_falling: 'Feath', depth_strider: 'Depth', frost_walker: 'Frost', soul_speed: 'Soul',
    swift_sneak: 'Sneak', respiration: 'Resp', aqua_affinity: 'Aqua', sharpness: 'Sharp', smite: 'Smite',
    bane_of_arthropods: 'Bane', knockback: 'Knock', fire_aspect: 'FireA', looting: 'Loot', sweeping_edge: 'Sweep',
    lunge: 'Lunge', density: 'Dens', breach: 'Breach', wind_burst: 'Wind', efficiency: 'Eff', fortune: 'Fort',
    silk_touch: 'Silk', power: 'Power', punch: 'Punch', flame: 'Flame', infinity: 'Inf', multishot: 'Multi',
    piercing: 'Pierce', quick_charge: 'Quick', impaling: 'Impal', loyalty: 'Loyal', riptide: 'Rip',
    channeling: 'Chan', luck_of_the_sea: 'Luck', lure: 'Lure', unbreaking: 'Unbr', mending: 'Mend',
    binding_curse: 'Bind', vanishing_curse: 'Vanish',
  };
  const PROF_SHORT = {
    armorer: 'Armor', butcher: 'Butcher', cartographer: 'Carto', cleric: 'Cleric', farmer: 'Farmer', fisherman: 'Fisher',
    fletcher: 'Fletch', leatherworker: 'Leather', mason: 'Mason', shepherd: 'Shep', toolsmith: 'Tools', weaponsmith: 'Weapon',
  };

  /** Curated catalog of useful non-librarian trades (wizard step 3). */
  const CATALOG = [
    // emerald generators
    { prof: 'fletcher', purpose: 'Sticks → Emerald', item: 'item/stick', group: 'generator', target: 4, note: '32 sticks → 1 emerald. Fed by a tree farm.' },
    { prof: 'farmer', purpose: 'Pumpkins / Melons → Emerald', item: 'item/melon_slice', group: 'generator', target: 2, note: 'Auto pumpkin & melon farms pay for everything.' },
    { prof: 'farmer', purpose: 'Crops → Emerald', item: 'item/carrot', group: 'generator', target: 1, note: 'Wheat, carrots, potatoes or beetroot.' },
    { prof: 'cleric', purpose: 'Rotten Flesh → Emerald', item: 'item/rotten_flesh', group: 'generator', target: 2, note: '32 flesh → 1 emerald. Zombie farm drops.' },
    { prof: 'mason', purpose: 'Clay / Stone → Emerald', item: 'item/clay_ball', group: 'generator', target: 2, note: 'Dumps strip-mine stone and clay.' },
    { prof: 'fisherman', purpose: 'String / Coal → Emerald', item: 'item/string', group: 'generator', target: 1, note: 'Novice trades. Pairs with a spider farm.' },
    { prof: 'shepherd', purpose: 'Wool → Emerald', item: 'block/white_wool', group: 'generator', target: 1, note: 'Novice trade. Sheep farm output.' },
    { prof: 'butcher', purpose: 'Kelp / Berries → Emerald', item: 'item/dried_kelp', group: 'generator', target: 1, note: 'Dried kelp blocks & sweet berries.' },
    { prof: 'leatherworker', purpose: 'Leather → Emerald', item: 'item/leather', group: 'generator', target: 1, note: 'Novice trade. Pairs with a cow farm.' },
    // blacksmiths
    { prof: 'armorer', purpose: 'Iron → Emerald · Diamond armor', item: 'item/iron_ingot', group: 'blacksmith', target: 1, note: 'Iron farm → emeralds. Master sells enchanted diamond armor.' },
    { prof: 'toolsmith', purpose: 'Diamond pickaxe / axe', item: 'item/diamond_pickaxe', group: 'blacksmith', target: 1, note: 'Renewable (often enchanted) diamond tools.' },
    { prof: 'weaponsmith', purpose: 'Diamond sword', item: 'item/diamond_sword', group: 'blacksmith', target: 1, note: 'Master rolls enchanted swords.' },
    // utility
    { prof: 'farmer', purpose: 'Emerald → Golden Carrot', item: 'item/golden_carrot', group: 'utility', target: 1, note: 'Best food in the game.' },
    { prof: 'cleric', purpose: 'Emerald → Ender Pearl', item: 'item/ender_pearl', group: 'utility', target: 1, note: 'Pearls for stasis chambers & travel.' },
    { prof: 'cleric', purpose: 'Emerald → Bottle o’ Enchanting', item: 'item/experience_bottle', group: 'utility', target: 1, note: 'XP for anvils and mending.' },
    { prof: 'cartographer', purpose: 'Explorer maps', item: 'item/filled_map', group: 'utility', target: 1, note: 'Mansions, monuments, trial chambers.' },
    { prof: 'mason', purpose: 'Emerald → Quartz blocks', item: 'block/quartz_block_side', group: 'utility', target: 1, note: 'Master trade: quartz without the Nether trip.' },
    { prof: 'mason', purpose: 'Emerald → Terracotta', item: 'block/terracotta', group: 'utility', target: 1, note: 'Glazed & dyed terracotta for builds.' },
    { prof: 'shepherd', purpose: 'Emerald → Colored wool & banners', item: 'block/red_wool', group: 'utility', target: 1, note: 'Every color without dye farms.' },
    { prof: 'leatherworker', purpose: 'Emerald → Saddle', item: 'item/saddle', group: 'utility', target: 1, note: 'Master trade.' },
    { prof: 'butcher', purpose: 'Emerald → Cooked food', item: 'item/cooked_porkchop', group: 'utility', target: 1, note: 'Rabbit stew, porkchops, chicken.' },
    { prof: 'fletcher', purpose: 'Emerald → Arrows', item: 'item/arrow', group: 'utility', target: 1, note: 'Arrows, flint and tipped arrows.' },
  ];

  const STEPS = [
    { t: 'Start', d: 'Pick a starting point', help: 'Start from a preset or from scratch. You can tweak everything in the next steps.' },
    { t: 'Books', d: 'Librarian enchants', help: 'Tap a book to add it. Need the same book twice (one per armor piece)? Press + on its row to add a copy right below.' },
    { t: 'Trades', d: 'Other villagers', help: 'Add the non-librarian villagers your hall should have, and how many of each.' },
    { t: 'Review', d: 'Check & finish', help: 'Here’s everything you’ll build. Save it as a preset if you like, then open your hall.' },
  ];

  const DEFAULTS = {
    setupDone: false, step: 0, editing: false, migrated: false,
    books: {}, archive: {}, trades: [],
    layout: { v: 3, pos: {} },
    check: { open: false, ench: '', level: null, price: null, query: '' },
    ui: { selected: null, multi: [], nextSort: 'type', search: '', expanded: {}, view: null },
    activePreset: null,
  };

  /* ================= small helpers ================= */

  const get = () => TH.store.get().hall;
  /** Mutate state.hall. Pass {silent:true} while typing. */
  const upd = (fn, opts) => TH.store.update((s) => fn(s.hall, s), opts);
  const isEn = () => !I18.lang || I18.lang.startsWith('en_');
  const enchLocal = (e) => I18.ench(e.id);
  const enchLabel = (e, lvl) => I18.enchLevel(e.id, lvl);
  const lvlText = (n) => I18.level(n);
  const enchShort = (e) => (isEn() && ABBR[e.id]) || enchLocal(e);
  const profName = (p) => I18.prof(p.id);
  const wsName = (p) => I18.block(p.workstationId);
  const profShort = (p) => (isEn() && PROF_SHORT[p.id]) || profName(p);
  const minPrice = (e, lvl) => D.bookPrice(e, lvl).min;
  const newStall = (label) => ({ id: uid('st'), label: label || '', done: false, price: null });
  const hasProgress = (st) => st.done || st.price != null;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** "23 librarians · 20 different books" — leads with librarians (one book can need several). */
  const libBooks = (stalls, books) => [h('b', stalls), stalls === 1 ? ' librarian' : ' librarians', ' · ',
    h('b', books), books === 1 ? ' book' : ' different books'];

  /** Emerald + number, vertically centred (flex). */
  const cost = (n, cls) => h('span.hl-cost' + (cls ? '.' + cls : ''), emerald(), h('b', n));

  /** Search helper: matches the localized AND the English name. */
  const enchMatches = (e, q) => !q || enchLocal(e).toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    || e.appliesTo.join(' ').includes(q) || ((D.enchantCategories.find((c) => c.id === e.category) || {}).name || '').toLowerCase().includes(q);

  function tierPill(e, lvl, price) {
    const t = D.priceTier(e, lvl, price);
    return h('span.pill.tier-' + t, TIER_LABEL[t]);
  }
  function profOf(t) { return PROF[t.prof] || PROF.farmer; }

  /** util.stepper + data-focus keys, so keyboard focus survives the re-render after each click. */
  function stepper(value, opts) {
    const el = baseStepper(value, opts);
    const key = 'stp-' + (opts.key || opts.label);
    const [dec, input, inc] = el.children;
    dec.dataset.focus = key + '-dec'; input.dataset.focus = key + '-in'; inc.dataset.focus = key + '-inc';
    return el;
  }

  /** Book ids in category order. */
  function bookIds(hall) { return SORTED.filter((e) => hall.books[e.id]).map((e) => e.id); }

  /** Flat list of every villager in the plan: book stalls first (by category), then trade instances. */
  function villagerList(hall) {
    const out = [];
    for (const id of bookIds(hall)) {
      const book = hall.books[id];
      book.stalls.forEach((stall, i) => out.push({ key: 'b:' + stall.id, kind: 'book', ench: ENCH[id], book, stall, idx: i }));
    }
    for (const t of hall.trades) {
      for (let n = 0; n < t.target; n++) out.push({ key: 't:' + t.id + ':' + n, kind: 'trade', trade: t, n, prof: profOf(t) });
    }
    return out;
  }

  /** needed | locked | perfect */
  function status(v) {
    if (v.kind === 'trade') return v.n < v.trade.have ? 'locked' : 'needed';
    const s = v.stall;
    if (s.done) return s.price != null && s.price <= minPrice(v.ench, v.book.level) ? 'perfect' : 'locked';
    return 'needed';
  }

  /** Counters for the header, stats and nav badge. */
  function totals(hall) {
    const t = { stalls: 0, locked: 0, trades: 0, have: 0, perfect: 0, over: 0 };
    for (const id of bookIds(hall)) {
      const book = hall.books[id];
      const min = minPrice(ENCH[id], book.level);
      for (const s of book.stalls) {
        t.stalls++;
        if (!s.done) continue;
        t.locked++;
        if (s.price != null) s.price <= min ? t.perfect++ : (t.over += s.price - min);
      }
    }
    for (const tr of hall.trades) { t.trades += tr.target; t.have += Math.min(tr.have, tr.target); }
    t.total = t.stalls + t.trades;
    t.done = t.locked + t.have;
    return t;
  }

  /** Per-profession target/have (librarians first) — drives workstation counts. */
  function profCounts(hall) {
    const m = {};
    const add = (p, target, have) => {
      m[p] = m[p] || { target: 0, have: 0 };
      m[p].target += target; m[p].have += have;
    };
    const t = totals(hall);
    if (t.stalls) add('librarian', t.stalls, t.locked);
    for (const tr of hall.trades) add(tr.prof, tr.target, Math.min(tr.have, tr.target));
    return D.professions
      .filter((p) => m[p.id] && m[p.id].target)
      .sort((a, b) => (b.id === 'librarian') - (a.id === 'librarian'))
      .map((p) => ({ prof: p, target: m[p.id].target, have: m[p.id].have }));
  }

  function findStall(hall, stallId) {
    for (const id of Object.keys(hall.books)) {
      const book = hall.books[id];
      const i = book.stalls.findIndex((s) => s.id === stallId);
      if (i >= 0) return { id, ench: ENCH[id], book, stall: book.stalls[i], idx: i };
    }
    return null;
  }

  /* ================= hall layout (free positions on the canvas) ================= */

  /** Reading-order rank of a position (row by row), unplaced last. */
  const posRank = (p) => (p ? Math.round(p.y / CG) * 100000 + Math.round(p.x / CG) : 1e9);
  /** Column letters like a spreadsheet: A..Z, AA.. */
  function colName(x) {
    let s = '';
    x += 1;
    while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
    return s;
  }
  /** Rough "C4" label for a position (nearest 80px cell from the origin); "not placed" without one. */
  function posLabel(p) {
    if (!p) return 'not placed';
    const c = Math.round(p.x / CG), r = Math.round(p.y / CG);
    return c >= 0 && r >= 0 ? colName(c) + (r + 1) : c + ',' + r;
  }

  /** Who stands where. `posOf` = { key: {x, y} } for villagers that have a spot; `tray` = those that still need one. */
  function placement(hall) {
    const list = villagerList(hall);
    const byKey = Object.fromEntries(list.map((v) => [v.key, v]));
    const src = (hall.layout && hall.layout.pos) || {};
    const posOf = {};
    for (const v of list) {
      const p = src[v.key];
      if (p && isFinite(p.x) && isFinite(p.y)) posOf[v.key] = p;
    }
    const stale = Object.keys(src).some((k) => !byKey[k]);
    return { posOf, byKey, list, tray: list.filter((v) => !posOf[v.key]), stale };
  }

  /** Book stalls in hall reading order (row by row), unplaced last. */
  function stallsInHallOrder(hall) {
    const pl = placement(hall);
    return pl.list.filter((v) => v.kind === 'book')
      .map((v, i) => ({ v, r: posRank(pl.posOf[v.key]), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => Object.assign(x.v, { pos: pl.posOf[x.v.key] }));
  }

  /** Auto-placement order: books by category, then other villagers by group and profession. */
  function autoOrder(list) {
    const books = list.filter((v) => v.kind === 'book');
    const trades = list.filter((v) => v.kind === 'trade').map((v, i) => ({ v, i }))
      .sort((a, b) => (GROUP_ORDER[a.v.trade.group || 'other'] - GROUP_ORDER[b.v.trade.group || 'other'])
        || byLocale(profName(a.v.prof), profName(b.v.prof)) || a.i - b.i)
      .map((x) => x.v);
    return books.concat(trades);
  }

  /** Give every villager without a spot one (free space after the existing layout, in type order) and drop spots of villagers that are gone. Returns how many were placed. */
  function placeNew(hall) {
    const pl = placement(hall);
    if (!pl.tray.length && !pl.stale) return 0;
    const L = hall.layout;
    L.pos = L.pos || {};
    for (const k of Object.keys(L.pos)) if (!pl.byKey[k]) delete L.pos[k];
    Object.assign(L.pos, TH.hallCanvas.autoPlace(autoOrder(pl.tray).map((v) => v.key), L.pos));
    return pl.tray.length;
  }

  /** Silently give new villagers a spot (called on render + init; no re-render, no toast). */
  function ensurePlaced() {
    const pl = placement(get());
    if (!pl.tray.length && !pl.stale) return;
    upd((hall) => { placeNew(hall); }, { silent: true });
  }

  /* ================= plan editing (books, trades, presets) ================= */

  function addBook(hall, id, level) {
    const e = ENCH[id];
    const book = hall.archive[id] || { level: e.maxLevel, stalls: [newStall()] };
    delete hall.archive[id];
    if (level) book.level = clamp(level, 1, e.maxLevel);
    if (!book.stalls.length) book.stalls.push(newStall());
    hall.books[id] = book;
    return book;
  }
  function removeBook(hall, id) {
    if (!hall.books[id]) return;
    hall.archive[id] = hall.books[id];
    delete hall.books[id];
  }

  /** Expand a preset's enchant spec into { id: {level, slots} }. */
  function resolveSpec(preset) {
    const spec = preset.enchants === 'all-librarian'
      ? Object.fromEntries(LIB_ENCH.filter((e) => e.category !== 'curse').map((e) => [e.id, 'max']))
      : (preset.enchants || {});
    const out = {};
    for (const [id, raw] of Object.entries(spec)) {
      const e = ENCH[id];
      if (!e || !e.librarian) continue;
      const cfg = raw && typeof raw === 'object' ? raw : { level: raw };
      const level = cfg.level === 'max' || cfg.level == null ? e.maxLevel : clamp(+cfg.level || e.maxLevel, 1, e.maxLevel);
      out[id] = { level, slots: cfg.slots || [] };
    }
    return out;
  }

  /** What a preset contains (for the preset cards). */
  function presetInfo(preset) {
    const spec = resolveSpec(preset);
    const ids = SORTED.filter((e) => spec[e.id]).map((e) => e.id);
    const stalls = ids.reduce((a, id) => a + Math.max(1, spec[id].slots.length), 0);
    const trades = preset.roles ? preset.roles.reduce((a, r) => a + (r.target || 0), 0) : null;
    return { ids, spec, stalls, trades };
  }

  /**
   * Apply a preset to the plan. Books that stay keep their logged progress;
   * removed books go to the archive (restored if re-added). Trades are replaced
   * when the preset defines roles (matching trades keep their id + "have").
   */
  function applyPreset(preset) {
    upd((hall) => {
      const spec = resolveSpec(preset);
      for (const id of Object.keys(hall.books)) if (!spec[id]) removeBook(hall, id);
      for (const [id, cfg] of Object.entries(spec)) {
        const book = hall.books[id] || addBook(hall, id);
        book.level = cfg.level;
        const n = Math.max(1, cfg.slots.length);
        while (book.stalls.length < n) book.stalls.push(newStall());
        // only trim stalls that carry no progress
        while (book.stalls.length > n && !hasProgress(book.stalls[book.stalls.length - 1])) book.stalls.pop();
        cfg.slots.forEach((l, i) => { if (!book.stalls[i].label) book.stalls[i].label = l; });
      }
      if (preset.roles) {
        const old = hall.trades;
        hall.trades = preset.roles.map((r) => {
          const prev = old.find((o) => o.prof === r.prof && o.purpose === r.purpose);
          return {
            id: prev ? prev.id : uid('tr'), prof: r.prof, purpose: r.purpose || '', target: r.target || 1,
            have: prev ? prev.have : 0, group: r.group || 'other', note: r.note || '',
          };
        });
      }
      hall.activePreset = preset.id;
    });
    toast(`Loaded “${preset.name}”`);
  }

  /** Current plan as a preset (no progress). */
  function snapshot(hall, name) {
    const enchants = {};
    for (const id of bookIds(hall)) {
      const b = hall.books[id];
      const labels = b.stalls.map((s) => s.label);
      enchants[id] = b.stalls.length > 1 || labels[0] ? { level: b.level, slots: labels } : b.level;
    }
    const roles = hall.trades.map(({ prof, purpose, target, group, note }) => ({ prof, purpose, target, group, note }));
    const t = totals(hall);
    return {
      id: uid('preset'), name,
      desc: `${plural(t.stalls, 'librarian')} · ${plural(t.trades, 'other villager')} · saved ${new Date().toLocaleDateString()}`,
      enchants, roles,
    };
  }

  function savePreset() {
    const name = prompt('Name this preset', 'My hall');
    if (!name || !name.trim()) return;
    const p = snapshot(get(), name.trim());
    TH.store.update((s) => { s.customPresets.push(p); s.hall.activePreset = p.id; });
    toast(`Saved preset “${p.name}”`);
  }

  function findTrade(hall, prof, purpose) { return hall.trades.find((t) => t.prof === prof && t.purpose === purpose); }

  /* ================= "Check an offer" logic ================= */
  // The player rerolls in-game (break + re-place the lectern). Whenever an offer shows up they
  // enter it here, get a verdict, and add it to the hall in one tap. No reroll bookkeeping.

  // dropdown UI state (not persisted)
  const ta = { open: false, hi: 0, q: '' };
  let checkJustOpened = false;

  /** Open the dialog; enchId pre-fills the enchantment (from a Next-up row or the details panel). */
  function openCheck(enchId) {
    const e = enchId && ENCH[enchId];
    ta.open = !e; ta.hi = 0; ta.q = ''; checkJustOpened = true;
    TH.app.pendingFocus = e ? 'chk-price' : 'chk-filter';
    upd((hall) => {
      const c = hall.check;
      Object.assign(c, { open: true, ench: '', query: '', level: null, price: null });
      if (e) Object.assign(c, { ench: e.id, query: enchLocal(e), level: hall.books[e.id] ? hall.books[e.id].level : e.maxLevel });
    });
  }
  function closeCheck() {
    upd((hall) => { hall.check.open = false; });
    document.body.classList.remove('hl-noscroll');
  }
  function clearOffer(c) { Object.assign(c, { ench: '', query: '', level: null, price: null }); }
  function clearCheck() {
    ta.open = false; ta.hi = 0; ta.q = '';
    TH.app.pendingFocus = 'chk-q';
    upd((hall) => clearOffer(hall.check));
  }

  /** Decide what to do with the offer. kind: idle | lock | skip | warn. */
  function verdict(hall) {
    const c = hall.check;
    const e = ENCH[c.ench];
    if (!e) return { kind: 'idle', title: 'Waiting for an offer…', text: 'Choose the enchantment the librarian is offering.' };
    const level = clamp(c.level || e.maxLevel, 1, e.maxLevel);
    const range = D.bookPrice(e, level);
    const price = c.price;
    const nm = enchLabel(e, level);
    const local = enchLocal(e);
    const base = { e, level, price, range };
    if (price != null && (price < range.min || price > range.max)) {
      return { ...base, kind: 'warn', title: 'Hmm, that price can’t happen', text: `${nm} always costs ${range.min}–${range.max} emeralds. Check the level and price.` };
    }
    const book = hall.books[e.id];
    if (!book) return { ...base, kind: 'skip', title: 'Skip it — not on your list', text: `You didn’t plan a ${nm} librarian. Reroll for the next offer.`, canAdd: true };
    if (level < book.level) {
      return { ...base, kind: 'skip', title: 'Skip it — level too low', text: `You want ${enchLabel(e, book.level)}; this one is only ${lvlText(level)}. Reroll.` };
    }
    const open = book.stalls.filter((s) => !s.done).length;
    if (open) {
      const tier = price == null ? 'unknown' : D.priceTier(e, level, price);
      const what = open > 1 ? `${open} ${local} librarians are still open.` : `Fills your open ${nm} spot.`;
      if (tier === 'meh') {
        return { ...base, kind: 'lock', title: 'Lock it — but it’s pricey', text: `${what} Perfect is ${range.min}; keep rerolling if you’re patient.` };
      }
      return {
        ...base, kind: 'lock',
        title: tier === 'perfect' ? 'Lock it — perfect price!' : 'Lock it — you need this',
        text: what + ' Trade with it once in-game so the offer sticks.',
      };
    }
    if (price == null) return { ...base, kind: 'idle', title: `You already have ${nm}`, text: 'Enter the price to see if this one is cheaper.' };
    const priced = book.stalls.filter((s) => s.price != null);
    if (priced.length < book.stalls.length) {
      return { ...base, kind: 'skip', title: 'Skip it — you already have it', text: 'One of your librarians has no price logged, so there’s nothing to compare. Set it on the hall canvas.' };
    }
    const worst = Math.max(...priced.map((s) => s.price));
    if (price < worst) return { ...base, kind: 'lock', title: `Lock it — cheaper than your ${worst} (save ${worst - price})`, text: `Replaces your priciest ${local} librarian.` };
    return { ...base, kind: 'skip', title: `Skip it — you already have it for ${worst}`, text: price === worst ? 'Same price — nothing to gain.' : `This one is ${price - worst} more expensive.` };
  }

  /**
   * Lock the offer into the best matching stall: the first open stall of that enchant
   * (in hall order); if all are locked and the offer is cheaper, replace the priciest one.
   */
  function lockOffer(hall, addIfMissing) {
    const c = hall.check;
    const e = ENCH[c.ench];
    if (!e) return null;
    const level = clamp(c.level || e.maxLevel, 1, e.maxLevel);
    let book = hall.books[e.id];
    if (!book) {
      if (!addIfMissing) return null;
      book = addBook(hall, e.id, level);
    }
    const order = stallsInHallOrder(hall).filter((v) => v.ench.id === e.id);
    const open = order.find((v) => !v.stall.done);
    let stall = open ? open.stall : null;
    let old = null;
    if (!stall) {
      const worst = book.stalls.filter((s) => s.price != null).sort((a, b) => b.price - a.price)[0];
      if (!worst || c.price == null || c.price >= worst.price) return null;
      stall = worst; old = worst.price;
    }
    stall.done = true;
    stall.price = c.price;
    placeNew(hall);
    const pos = placement(hall).posOf['b:' + stall.id];
    return { e, level, stall, old, pos, perfect: c.price != null && c.price <= minPrice(e, level) };
  }

  /** Pan/zoom the canvas to a tile and pulse it briefly (after adding an offer to the hall). */
  function flashTile(key) {
    setTimeout(() => { if (canvas) canvas.reveal(key, { pulse: true }); }, 80);
  }

  function doAdd(addIfMissing) {
    let res = null;
    ta.open = false; ta.hi = 0; ta.q = '';
    TH.app.pendingFocus = 'chk-q';
    upd((hall) => {
      res = lockOffer(hall, addIfMissing);
      if (res) { clearOffer(hall.check); hall.check.open = false; }
    });
    if (res) {
      TH.app.pendingFocus = null;
      const nm = enchLabel(res.e, res.level) + (res.stall.label ? ` (${res.stall.label})` : '');
      const where = res.pos ? ` at ${posLabel(res.pos)}` : '';
      toast(res.old != null
        ? `Replaced your ${res.old}-emerald ${nm}${where} — saved ${res.old - res.stall.price}`
        : `Locked ${nm}${where}${res.perfect ? ' — perfect price!' : ''}`);
      flashTile('b:' + res.stall.id);
    } else if (addIfMissing) {
      toast('Added back to your list — you already had it locked');
    }
  }

  /** Enter: add when the verdict says lock; on a skip, clear the fields for the next offer. */
  function primaryAction() {
    const v = verdict(get());
    if (v.kind === 'lock') doAdd(false);
    else if (v.kind === 'skip') clearCheck();
  }

  /** Dropdown options: still-needed first, then on-list, then the rest. Matches localized + English names. */
  function offerOptions(hall, q) {
    q = (q || '').trim().toLowerCase();
    const rank = (e) => {
      const b = hall.books[e.id];
      return b && b.stalls.some((s) => !s.done) ? 0 : b ? 1 : 2;
    };
    const starts = (e) => enchLocal(e).toLowerCase().startsWith(q) || e.name.toLowerCase().startsWith(q);
    return LIB_ENCH
      .filter((e) => !q || enchLocal(e).toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || (ABBR[e.id] || '').toLowerCase().startsWith(q))
      .map((e) => ({ e, rank: rank(e), pre: q && starts(e) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || a.pre - b.pre || enchLocal(a.e).localeCompare(enchLocal(b.e)));
  }

  function pickOffer(id) {
    const e = ENCH[id];
    ta.open = false; ta.hi = 0; ta.q = '';
    TH.app.pendingFocus = 'chk-price';
    upd((hall) => {
      const c = hall.check;
      c.ench = id; c.query = enchLocal(e);
      // default to the level you planned (or max); easy to change with the level chips
      c.level = hall.books[id] ? hall.books[id].level : e.maxLevel;
    });
  }

  /* ================= wizard ================= */

  function goStep(i) {
    upd((hall) => { hall.step = clamp(i, 0, STEPS.length - 1); });
    setTimeout(() => window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }), 0);
  }
  function finishSetup() {
    upd((hall) => { hall.setupDone = true; hall.editing = false; hall.step = 0; });
    setTimeout(() => window.scrollTo({ top: 0 }), 0);
  }

  function renderWizard(root, state) {
    const hall = state.hall;
    const step = clamp(hall.step || 0, 0, STEPS.length - 1);
    const body = [stepStart, stepBooks, stepTrades, stepReview][step](state);

    root.append(
      h('div.page-head.hl-wiz-head',
        h('div',
          h('h2', TITLE),
          h('p', (hall.editing ? 'Editing your plan. ' : '') + STEPS[step].help)),
        hall.editing ? h('button.btn', { type: 'button', onclick: finishSetup }, '← Back to hall') : null,
      ),
      h('nav.hl-steps', { 'aria-label': 'Setup steps' },
        h('ol', STEPS.map((s, i) => h('li' + (i < step ? '.is-done' : i === step ? '.is-current' : ''),
          h('button', { type: 'button', 'aria-current': i === step ? 'step' : null, 'data-focus': 'step-' + i, onclick: () => goStep(i) },
            h('span.hl-step-dot', { 'aria-hidden': 'true' }, i < step ? '✓' : String(i + 1)),
            h('span.hl-step-text', h('b', s.t), h('small', s.d))))))),
      h('div.hl-wiz-layout',
        h('section.hl-wiz-body', { 'aria-label': STEPS[step].t }, body),
        wizardSide(hall, step)),
    );
  }

  /* ---- running summary (footer + review share these) ---- */

  /** Selected books as { e, level, n } in catalog order. */
  function bookSummary(hall) { return bookIds(hall).map((id) => ({ e: ENCH[id], level: hall.books[id].level, n: hall.books[id].stalls.length })); }
  /** Other villagers by profession as { prof, target } (librarians excluded), biggest first. */
  function tradeSummary(hall) { return profCounts(hall).filter((r) => r.prof.id !== 'librarian').sort((a, b) => b.target - a.target); }
  const bookChipText = (b) => enchShort(b.e) + (b.e.maxLevel > 1 ? ' ' + lvlText(b.level) : '');

  let justAdded = null;
  /** Last rendered sidebar numbers, so a changed value can play a small "bump" animation. */
  const sideSeen = {};

  /** Sticky right column: running totals, book list, workstations and the step navigation. */
  function wizardSide(hall, step) {
    const t = totals(hall);
    const last = step === STEPS.length - 1;
    const books = bookSummary(hall);
    const profs = step >= 2 ? profCounts(hall).slice().sort((a, b) => b.target - a.target) : [];
    const num = (key, v) => {
      const bump = sideSeen[key] != null && sideSeen[key] !== v;
      sideSeen[key] = v;
      return h('b' + (bump ? '.is-bump' : ''), String(v));
    };
    const row = (key, icon, label, v, cls) => h('div.hl-side-row' + (cls || ''), icon, h('span.hl-side-label', label[0], label[1] ? h('span.hl-l-long', label[1]) : null), num(key, v));
    return h('aside.hl-wiz-side.panel', { 'aria-label': 'Total so far' },
      h('div.hl-side-sum', { 'aria-live': 'polite' },
        h('div.hl-side-title', 'TOTAL SO FAR'),
        row('lib', TH.icon.prof('librarian', { size: 18 }), [t.stalls === 1 ? 'librarian' : 'librarians'], t.stalls, '.is-lib'),
        row('oth', TH.icon('villager', { size: 18 }), ['other', t.trades === 1 ? ' villager' : ' villagers'], t.trades, '.is-oth'),
        row('tot', null, [t.total === 1 ? 'villager' : 'villagers', ' in total'], t.total, '.is-total')),
      books.length ? h('div.hl-side-sec.hl-side-books',
        h('div.hl-side-h', TH.icon('enchanted_book', { size: 14, glint: true }), 'Books', h('em', String(books.length))),
        h('div.hl-side-chips', books.map((b) => h('span.hl-fchip', bookChipText(b), b.n > 1 ? h('em', '×' + b.n) : null)))) : null,
      profs.length ? h('div.hl-side-sec.hl-side-profs',
        h('div.hl-side-h', 'Workstations'),
        h('ul.hl-side-ws', profs.map((r) => h('li', { style: '--pc:' + r.prof.color, title: wsName(r.prof) },
          TH.icon.prof(r.prof.id, { size: 18 }), h('span.hl-ws-name', wsName(r.prof)), h('em', '×' + r.target))))) : null,
      h('div.hl-wiz-nav',
        step > 0 ? h('button.btn.hl-nav-back', { type: 'button', onclick: () => goStep(step - 1) }, '← Back') : null,
        last
          ? h('button.btn.primary', { type: 'button', onclick: finishSetup }, 'Finish → Hall')
          : h('button.btn.primary', { type: 'button', onclick: () => goStep(step + 1) }, h('span.hl-nav-pre', 'Next: '), STEPS[step + 1].t + ' →')),
    );
  }

  /**
   * Change the plan without the page-wide re-render: patch only the step body and sidebar in place,
   * keep the scroll position and focus, and let the strip named by `added` animate in.
   */
  function softUpdate(fn, o) {
    o = o || {};
    TH.store.update((s) => fn(s.hall, s), { silent: true });
    const state = TH.store.get();
    const body = document.querySelector('.hl-wiz-body');
    const side = document.querySelector('.hl-wiz-side');
    if (!body || !side || state.hall.setupDone) { TH.app.render(); return; }
    const step = clamp(state.hall.step || 0, 0, STEPS.length - 1);
    const y = window.scrollY;
    justAdded = o.added || null;
    try { body.replaceChildren([stepStart, stepBooks, stepTrades, stepReview][step](state)); } finally { justAdded = null; }
    const sy = side.scrollTop, ns = wizardSide(state.hall, step);
    side.replaceWith(ns);
    ns.scrollTop = sy;
    window.scrollTo(0, y);
    TH.app.refreshBadges();
    if (o.focus) { const el = document.querySelector('[data-focus="' + o.focus + '"]'); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---- step 1: start ---- */

  function stepStart(state) {
    const hall = state.hall;
    const t = totals(hall);
    const builtIn = D.presets.filter((p) => p.id !== 'empty');
    const blank = D.presets.find((p) => p.id === 'empty') || { id: 'empty', name: 'Blank', enchants: {}, roles: [] };
    const icons = {
      bare: () => TH.icon('item/iron_pickaxe', { size: 32 }), blueprint: () => TH.icon('map', { size: 32 }),
      generators: () => TH.icon('emerald', { size: 32 }), all: () => TH.icon('block/bookshelf', { size: 32 }),
    };

    const card = (p, opts) => {
      const info = presetInfo(p);
      const on = hall.activePreset === p.id;
      const names = info.ids.map((id) => {
        const n = Math.max(1, info.spec[id].slots.length);
        return enchLabel(ENCH[id], info.spec[id].level) + (n > 1 ? ' ×' + n : '');
      });
      const profAgg = {};
      (p.roles || []).forEach((r) => { profAgg[r.prof] = (profAgg[r.prof] || 0) + (r.target || 0); });
      return h('div.hl-preset-wrap',
        h('button.hl-preset' + (on ? '.is-on' : ''), {
          type: 'button', 'aria-pressed': String(on), 'data-focus': 'preset-' + p.id,
          onclick: () => {
            const has = Object.values(hall.books).some((b) => b.stalls.some(hasProgress)) || hall.trades.some((x) => x.have);
            if (on || !has || confirm(`Switch to “${opts.title || p.name}”? Logged prices and progress are kept for books that stay.`)) applyPreset(p);
          },
        },
          h('span.hl-preset-top',
            h('span.hl-preset-icon', { 'aria-hidden': 'true' }, opts.icon),
            h('b.hl-preset-name', opts.title || p.name),
            h('span.hl-preset-check', { 'aria-hidden': 'true' })),
          h('span.hl-preset-desc', opts.desc || p.desc),
          h('span.hl-preset-chips',
            h('span.chip', TH.icon.prof('librarian', { size: 14 }), plural(info.stalls, 'librarian')),
            info.trades == null ? h('span.chip', 'keeps your trades') : h('span.chip', TH.icon('villager', { size: 14 }), plural(info.trades, 'other villager'))),
          names.length ? h('span.hl-preset-tags', names.slice(0, 9).map((n) => h('span', n)), names.length > 9 ? h('span.more', '+' + (names.length - 9) + ' more') : null) : null,
          Object.keys(profAgg).length ? h('span.hl-preset-profs', Object.entries(profAgg).map(([pid, n]) =>
            h('span', { title: PROF[pid] ? profName(PROF[pid]) : pid }, TH.icon.prof(pid, { size: 16 }), '×' + n))) : null,
        ),
        opts.custom ? h('button.x-btn.hl-preset-del', {
          type: 'button', title: 'Delete preset', 'aria-label': 'Delete preset ' + p.name,
          onclick: () => { if (confirm(`Delete preset “${p.name}”?`)) TH.store.update((s) => { s.customPresets = s.customPresets.filter((x) => x.id !== p.id); }); },
        }, '✕') : null,
      );
    };

    return h('div',
      t.total ? h('div.hl-note', TH.icon('book', { size: 16 }),
        h('span', 'You already have a plan (', plural(t.stalls, 'librarian'), ', ', plural(t.trades, 'other villager'),
          '). Pick a preset to replace it — logged progress is kept — or just press ', h('b', 'Next'), ' to edit it.')) : null,
      h('h3.section-title.hl-sec-title', 'Presets'),
      h('div.hl-preset-grid',
        builtIn.map((p) => card(p, { icon: icons[p.id] ? icons[p.id]() : TH.icon('item/chest_minecart', { size: 32 }) })),
        card(blank, { icon: TH.icon('book', { size: 32 }) })),
      state.customPresets.length ? [
        h('h3.section-title.hl-sec-title', 'Your presets'),
        h('div.hl-preset-grid', state.customPresets.map((p) => card(p, { icon: TH.icon('item/writable_book', { size: 32 }), custom: true }))),
      ] : null,
    );
  }

  /* ---- step 2: books (strips) ---- */

  function stepBooks(state) {
    const hall = state.hall;
    const q = (hall.ui.search || '').trim().toLowerCase();
    const t = totals(hall);
    const nBooks = Object.keys(hall.books).length;

    const out = h('div.hl-books');
    out.append(h('div.hl-toolbar',
      h('label.search', h('input.field', {
        type: 'search', placeholder: 'Search books or items…', value: hall.ui.search || '', 'data-focus': 'wiz-search', 'aria-label': 'Search enchantments',
        oninput: (e) => upd((x) => { x.ui.search = e.target.value; }),
      })),
      h('span.hl-toolbar-info', libBooks(t.stalls, nBooks)),
      h('span.spacer'),
      h('button.btn.ghost.small', { type: 'button', onclick: () => goStep(0), title: 'Switch to a preset' }, 'Presets'),
      nBooks ? h('button.btn.ghost.small', {
        type: 'button', onclick: () => { if (confirm('Deselect all books? Their progress is remembered if you add them back.')) upd((x) => { Object.keys(x.books).forEach((id) => removeBook(x, id)); }); },
      }, 'Clear all') : null,
    ));

    let shown = 0;
    for (const cat of D.enchantCategories) {
      const items = SORTED.filter((e) => e.category === cat.id && enchMatches(e, q));
      if (!items.length) continue;
      shown += items.length;
      const selectable = items.filter((e) => e.librarian);
      const allOn = selectable.length && selectable.every((e) => hall.books[e.id]);
      const onCount = items.filter((e) => hall.books[e.id]).length;
      out.append(h('section.hl-group', { 'aria-label': cat.name },
        h('div.hl-group-head',
          h('h3', cat.name), h('small', cat.hint),
          onCount ? h('span.hl-group-count', onCount + ' on') : null,
          h('span.spacer'),
          selectable.length > 1 ? h('button.btn.ghost.small', {
            type: 'button', 'aria-label': (allOn ? 'Deselect all in ' : 'Select all in ') + cat.name, 'data-focus': 'catall-' + cat.id,
            onclick: () => upd((x) => selectable.forEach((e) => (allOn ? removeBook(x, e.id) : x.books[e.id] || addBook(x, e.id)))),
          }, allOn ? 'None' : 'All') : null),
        h('ul.hl-strips', items.map((e) => bookStrip(hall, e)))));
    }
    if (!shown) out.append(h('div.panel.empty', h('div.empty-icon', TH.icon('compass', { size: 36 })), 'No enchantment matches “', hall.ui.search, '”. ',
      h('button.btn.small', { type: 'button', onclick: () => upd((x) => { x.ui.search = ''; }) }, 'Clear search')));
    return out;
  }

  /** Level chips (shared .lvl-chips). onPick(level). */
  function levelChips(e, level, onPick, opts) {
    opts = opts || {};
    return h('div.lvl-chips', { role: 'group', 'aria-label': opts.label || (enchLocal(e) + ' level') },
      Array.from({ length: e.maxLevel }, (_, i) => h('button' + (level === i + 1 ? '.on' : ''), {
        type: 'button', 'aria-pressed': String(level === i + 1), 'aria-label': 'Level ' + (i + 1),
        'data-focus': (opts.key || 'lvl-' + e.id) + '-' + i, disabled: opts.disabled,
        onclick: () => onPick(i + 1),
      }, lvlText(i + 1))));
  }

  /** Duplicate controls shared by book and trade strips: "i/n" index, "+" (insert below), "✕" (only inside a group). */
  function dupControls(i, n, o) {
    return [
      n > 1 ? h('span.hl-idx', { 'aria-label': `${i + 1} of ${n}` }, `${i + 1}/${n}`) : null,
      h('button.btn.small.ghost.hl-dup', {
        type: 'button', title: 'Add one more right below', 'data-focus': 'dup-' + o.key, 'aria-label': `Add another ${o.name} below`,
        disabled: o.max, onclick: o.onAdd,
      }, plusIco()),
      o.canDel ? h('button.x-btn.hl-del', {
        type: 'button', title: 'Remove this one', 'aria-label': `Remove ${o.name} ${i + 1} of ${n}`, 'data-focus': 'rm-' + o.key, onclick: o.onDel,
      }, '✕') : null,
    ];
  }

  function bookStrip(hall, e) {
    const book = hall.books[e.id];
    const on = !!book;
    const level = book ? book.level : e.maxLevel;
    const local = enchLocal(e);
    const sub = local !== e.name ? e.name : null;

    if (!e.librarian) {
      return h('li.hl-strip.is-disabled', { title: 'Librarians never sell this book' },
        h('div.hl-strip-main',
          h('span.hl-tick', { 'aria-hidden': 'true' }),
          TH.icon('enchanted_book', { size: 24, cls: 'hl-strip-icon' }),
          h('span.hl-strip-text', h('b', local), h('small', TH.icon('item/barrier', { size: 12 }), NOT_LIBRARIAN[e.id] || 'Not sold by librarians'))),
        h('span.hl-strip-lv'), h('span.hl-strip-acts'));
    }

    const n = book ? book.stalls.length : 0;
    const multi = n > 1;
    const lvl = () => (e.maxLevel > 1
      ? levelChips(e, level, (lv) => upd((x) => { (x.books[e.id] || addBook(x, e.id)).level = lv; }))
      : null);
    const textOf = (st, i) => h('span.hl-strip-text',
      h('b', local),
      (sub || e.treasure || st) ? h('small',
        sub ? h('span', sub) : null,
        e.treasure ? h('span.hl-treasure', 'treasure') : null,
        st && multi ? h('input.hl-slot', {
          value: st.label, placeholder: 'Label, e.g. ' + (['Helmet', 'Chestplate', 'Leggings', 'Boots'][i] || 'Spare'),
          'data-focus': 'lbl-' + st.id, 'aria-label': `${local} ${i + 1} label`,
          oninput: (ev) => upd((x) => { const b = x.books[e.id]; if (b && b.stalls[i]) b.stalls[i].label = ev.target.value; }, { silent: true }),
        }) : (st && st.label ? h('span', st.label) : null),
        st && st.done ? h('span.hl-ok', 'locked') : null) : null);

    if (!on) {
      return h('li.hl-strip-item', h('div.hl-strip',
        h('button.hl-strip-main', {
          type: 'button', 'aria-pressed': 'false', title: e.desc, 'data-focus': 'strip-' + e.id, 'aria-label': local,
          onclick: () => upd((x) => addBook(x, e.id)),
        },
          h('span.hl-tick', { 'aria-hidden': 'true' }),
          TH.icon('enchanted_book', { size: 24, cls: 'hl-strip-icon' }),
          textOf(null, 0)),
        h('span.hl-strip-lv', lvl()),
        h('span.hl-strip-acts')));
    }

    const strips = book.stalls.map((st, i) => {
      const inner = [
        h('span.hl-tick', { 'aria-hidden': 'true' }),
        TH.icon('enchanted_book', { size: 24, glint: true, cls: 'hl-strip-icon' }),
        textOf(st, i)];
      const main = multi
        ? h('div.hl-strip-main', inner)
        : h('button.hl-strip-main', {
          type: 'button', 'aria-pressed': 'true', title: e.desc, 'data-focus': 'strip-' + e.id, 'aria-label': `${local}, selected`,
          onclick: () => {
            if (book.stalls.some(hasProgress) && !confirm(`Remove ${local}? Its logged progress is remembered if you add it back.`)) return;
            upd((x) => removeBook(x, e.id));
          },
        }, inner);
      return h('div.hl-strip.is-on' + (justAdded === st.id ? '.is-new' : ''), { 'data-n': i },
        main,
        h('span.hl-strip-lv', i === 0 ? lvl() : null),
        h('span.hl-strip-acts', dupControls(i, n, {
          key: st.id, name: local, canDel: multi,
          onAdd: () => {
            const ns = newStall();
            softUpdate((x) => { const b = x.books[e.id]; if (b) b.stalls.splice(i + 1, 0, ns); }, { added: ns.id, focus: 'dup-' + ns.id });
          },
          onDel: () => {
            if (hasProgress(st) && !confirm('This librarian has logged progress. Remove it anyway?')) return;
            const rest = book.stalls.filter((s) => s !== st);
            softUpdate((x) => { const b = x.books[e.id]; if (b) b.stalls = b.stalls.filter((s) => s.id !== st.id); },
              { focus: 'dup-' + rest[Math.min(i, rest.length - 1)].id });
          },
        })));
    });
    return h('li.hl-strip-item.hl-dupgroup' + (multi ? '.is-multi' : ''), { 'data-book': e.id }, strips);
  }

  /* ---- step 3: trades (strips) ---- */

  function stepTrades(state) {
    const hall = state.hall;
    const out = h('div.hl-books');
    const catalogKeys = new Set(CATALOG.map((c) => c.prof + '|' + c.purpose));

    for (const g of GROUPS) {
      const cat = CATALOG.filter((c) => c.group === g.id);
      const custom = hall.trades.filter((t) => (t.group || 'other') === g.id && !catalogKeys.has(t.prof + '|' + t.purpose));
      const count = hall.trades.filter((t) => (t.group || 'other') === g.id).reduce((a, t) => a + t.target, 0);
      out.append(h('section.hl-group', { 'aria-label': g.name },
        h('div.hl-group-head', h('h3', g.name), h('small', g.hint), count ? h('span.hl-group-count', plural(count, 'villager')) : null),
        cat.length || custom.length ? h('ul.hl-strips',
          cat.map((c) => tradeStrip(hall, c)),
          custom.map((t) => customTradeStrip(t))) : null,
        g.id === 'other' ? h('div.hl-add-row',
          h('button.btn.small', { type: 'button', onclick: addCustomTrade }, '+ Custom trade'),
          !custom.length ? h('span.hl-hint', 'Anything not in the lists above — pick a profession and describe what it’s for.') : null) : null,
      ));
    }
    return out;
  }

  /** CSS-drawn plus sign for icon buttons. */
  const plusIco = () => h('span.hl-plus-ico', { 'aria-hidden': 'true' });

  /** Workstation icon + the item the villager trades (from the catalog), as one slot. */
  function tradeIcons(prof, purpose, size) {
    const c = CATALOG.find((x) => x.prof === prof.id && x.purpose === purpose);
    return h('span.hl-trade-ico' + (c && c.item ? '.has-item' : ''), { 'aria-hidden': 'true' },
      TH.icon.prof(prof.id, { size: size || 26 }),
      c && c.item ? h('span.hl-trade-item', TH.icon(c.item, { size: 16 })) : null);
  }

  function tradeStrip(hall, c) {
    const t = findTrade(hall, c.prof, c.purpose);
    const p = PROF[c.prof];
    const on = !!t;
    const key = 'tr-' + CATALOG.indexOf(c);
    const n = on ? t.target : 1;
    const multi = n > 1;
    const strips = Array.from({ length: n }, (_, i) => {
      const inner = [
        h('span.hl-tick', { 'aria-hidden': 'true' }),
        tradeIcons(p, c.purpose),
        h('span.hl-strip-text', h('b', c.purpose),
          h('small', h('span.hl-prof-dot', profName(p)), h('span', on && t.note ? t.note : c.note)))];
      const main = on && multi ? h('div.hl-strip-main', inner) : h('button.hl-strip-main', {
        type: 'button', 'aria-pressed': String(on), 'data-focus': key, title: c.note,
        onclick: () => upd((x) => {
          if (on) x.trades = x.trades.filter((tr) => tr !== findTrade(x, c.prof, c.purpose));
          else x.trades.push({ id: uid('tr'), prof: c.prof, purpose: c.purpose, target: 1, have: 0, group: c.group, note: c.note });
        }),
      }, inner);
      return h('div.hl-strip.hl-strip-trade' + (on ? '.is-on' : '') + (on && justAdded === t.id + ':' + i ? '.is-new' : ''), { style: '--pc:' + p.color },
        main,
        h('span.hl-strip-acts',
          on && i < t.have ? h('span.hl-ok.hl-have', 'in hall') : null,
          on ? dupControls(i, n, tradeDupOpts(t, i, key + '-' + i, c.purpose, () => findTrade(TH.store.get().hall, c.prof, c.purpose))) : null));
    });
    return h('li.hl-strip-item.hl-dupgroup' + (multi ? '.is-multi' : ''), { 'data-trade': on ? t.id : null }, strips);
  }

  /** Duplicate options for a trade strip: group size = trade.target. */
  function tradeDupOpts(t, i, key, name, find, removeAtOne) {
    const n = t.target;
    return {
      key, name, max: n >= 64, canDel: n > 1 || !!removeAtOne,
      onAdd: () => softUpdate(() => { const tr = find(); if (tr) tr.target = clamp(tr.target + 1, 1, 64); },
        { added: t.id + ':' + (i + 1), focus: 'dup-' + key.replace(/-\d+$/, '') + '-' + (i + 1) }),
      onDel: () => {
        if (n <= 1) { upd((x) => { x.trades = x.trades.filter((y) => y.id !== t.id); }); return; }
        softUpdate(() => { const tr = find(); if (tr) tr.target = clamp(tr.target - 1, 1, 64); },
          { focus: 'dup-' + key.replace(/-\d+$/, '') + '-' + Math.min(i, n - 2) });
      },
    };
  }

  function customTradeStrip(t) {
    const p = profOf(t);
    const n = t.target;
    const find = () => TH.store.get().hall.trades.find((y) => y.id === t.id);
    const set = (fn, opts) => upd((x) => { const tr = x.trades.find((y) => y.id === t.id); if (tr) fn(tr, x); }, opts);
    const strips = Array.from({ length: n }, (_, i) => h('div.hl-strip.hl-strip-trade.hl-strip-custom.is-on' + (justAdded === t.id + ':' + i ? '.is-new' : ''), { style: '--pc:' + p.color },
      i === 0
        ? h('div.hl-strip-main.hl-custom-main',
          TH.icon.prof(p.id, { size: 24, cls: 'hl-strip-icon' }),
          h('select.field', { 'aria-label': 'Profession', 'data-focus': 'cprof-' + t.id, onchange: (e) => set((tr) => { tr.prof = e.target.value; }) },
            D.professions.filter((x) => x.id !== 'librarian').map((x) => h('option', { value: x.id, selected: x.id === t.prof }, profName(x)))),
          h('input.field.hl-custom-purpose', {
            value: t.purpose, placeholder: 'What is it for? e.g. Glass → Emerald', 'data-focus': 'purpose-' + t.id, 'aria-label': 'Purpose',
            oninput: (e) => set((tr) => { tr.purpose = e.target.value; }, { silent: true }),
            onchange: () => TH.app.render(),
          }))
        : h('div.hl-strip-main.hl-custom-main',
          TH.icon.prof(p.id, { size: 24, cls: 'hl-strip-icon' }),
          h('span.hl-strip-text', h('b', t.purpose || 'Custom trade'), h('small', profName(p)))),
      h('span.hl-strip-acts', dupControls(i, n, tradeDupOpts(t, i, 'ct-' + t.id + '-' + i, t.purpose || 'custom trade', find, true)))));
    return h('li.hl-strip-item.hl-dupgroup' + (n > 1 ? '.is-multi' : ''), { 'data-trade': t.id }, strips);
  }

  function addCustomTrade() {
    const id = uid('tr');
    TH.app.pendingFocus = 'purpose-' + id;
    upd((x) => { x.trades.push({ id, prof: 'farmer', purpose: '', target: 1, have: 0, group: 'other', note: '' }); });
  }

  /* ---- step 4: review ---- */

  function stepReview(state) {
    const hall = state.hall;
    const t = totals(hall);
    const profs = profCounts(hall);
    const books = bookSummary(hall);

    if (!t.total) {
      return h('div.panel.empty', h('div.empty-icon', TH.icon('block/crafting_table_front', { size: 36 })), h('p', 'Your plan is empty.'),
        h('div.hl-row-btns.hl-center', h('button.btn', { type: 'button', onclick: () => goStep(0) }, 'Pick a preset'),
          h('button.btn', { type: 'button', onclick: () => goStep(1) }, 'Choose books')));
    }

    const big = (icon, n, label, sub) => h('div.hl-rev-stat',
      h('span.hl-rev-stat-ico', { 'aria-hidden': 'true' }, icon),
      h('div', h('b', n), h('span', label), sub ? h('small', sub) : null));

    // trades grouped by profession
    const byProf = new Map();
    hall.trades.forEach((tr) => { const k = profOf(tr).id; if (!byProf.has(k)) byProf.set(k, []); byProf.get(k).push(tr); });
    const tradeCols = [...byProf.entries()].map(([pid, list]) => {
      const p = PROF[pid];
      const sum = list.reduce((a, x) => a + x.target, 0);
      return h('section.hl-rev-prof', { style: '--pc:' + p.color },
        h('header', TH.icon.prof(p.id, { size: 22 }), h('b', profName(p)), h('span.hl-rev-n', '×' + sum)),
        h('ul', list.map((tr) => h('li', tradeIcons(p, tr.purpose, 16), h('span.hl-rev-purpose', tr.purpose || profName(p)),
          tr.target > 1 ? h('span.hl-rev-n', '×' + tr.target) : null))));
    });

    return h('div.hl-review',
      h('section.panel.hl-review-card.hl-rev-head',
        h('div.hl-rev-stats',
          big(TH.icon.prof('librarian', { size: 26 }), t.stalls, t.stalls === 1 ? 'librarian' : 'librarians', plural(books.length, 'different book')),
          big(TH.icon('villager', { size: 26 }), t.trades, 'other villagers', plural(hall.trades.length, 'trade')),
          big(TH.icon('block/crafting_table_front', { size: 26 }), t.total, 'villagers in total', plural(profs.length, 'profession'))),
        h('div.hl-rev-ws', h('span.hl-rev-ws-title', 'Workstations needed'),
          profs.map((r) => h('span.hl-fchip', { style: '--pc:' + r.prof.color, title: wsName(r.prof) },
            TH.icon.prof(r.prof.id, { size: 16 }), wsName(r.prof), h('em', '×' + r.target))))),
      h('section.panel.hl-review-card',
        h('div.hl-review-head', h('h3.section-title', 'Books'), h('span.hl-toolbar-info', libBooks(t.stalls, books.length)), h('span.spacer'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => goStep(1) }, 'Edit')),
        books.length ? h('ul.hl-rev-books', books.map((b) => h('li.hl-rev-book',
          TH.icon('enchanted_book', { size: 22, glint: true }),
          h('span.hl-rev-name', enchLabel(b.e, b.level)),
          b.n > 1 ? h('span.hl-rev-n', { title: b.n + ' librarians' }, '×' + b.n) : null))) : h('p.muted', 'No books selected.')),
      h('section.panel.hl-review-card',
        h('div.hl-review-head', h('h3.section-title', `Other villagers (${t.trades})`), h('span.spacer'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => goStep(2) }, 'Edit')),
        tradeCols.length ? h('div.hl-rev-profs', tradeCols) : h('p.muted', 'No other villagers.')),
      h('section.panel.hl-review-card.hl-review-actions',
        h('div', h('b', 'Happy with it?'), h('p.muted', 'Save it as a preset to reuse in another world, then press Finish → Hall to open your hall and arrange it.')),
        h('div.hl-row-btns',
          h('button.btn', { type: 'button', onclick: savePreset }, TH.icon('item/writable_book', { size: 16 }), 'Save as preset'))),
    );
  }

  /* ================= dashboard ================= */

  function renderDashboard(root, state) {
    const hall = state.hall;
    const pl = placement(hall);
    const t = totals(hall);
    const toFind = t.stalls - t.locked;
    const toGet = t.trades - t.have;
    const preset = hall.activePreset && (D.presets.concat(state.customPresets).find((p) => p.id === hall.activePreset));

    const editBtn = h('button.btn', { type: 'button', onclick: () => upd((x) => { x.setupDone = false; x.editing = true; x.step = 0; setSel(x.ui, []); }) }, '✎ Edit setup');
    const head = (sub) => h('div.page-head.hl-page-head', h('div', h('h2', TITLE), h('p', sub)));

    if (!t.total) {
      root.append(
        head('Nothing planned yet.'),
        h('div.panel.empty.hl-empty-hall',
          h('div.empty-icon', TH.icon('bell', { size: 36 })), h('h3', 'Your hall is empty'),
          h('p', 'Pick the books and villagers you want, and this page turns into your to-do list.'),
          h('button.btn.primary', { type: 'button', onclick: () => upd((x) => { x.setupDone = false; x.editing = false; x.step = 0; }) }, 'Start planning')));
      return;
    }

    const line = t.done === t.total
      ? 'Everything is locked in. What a hall!'
      : [toFind ? plural(toFind, 'librarian') + ' still needed' : null, toGet ? plural(toGet, 'villager') + ' to find' : null].filter(Boolean).join(' · ');

    root.append(
      head('Your hall at a glance. Check offers as you reroll, and arrange villagers like your real build.'),
      h('section.panel.hl-hero',
        ring(t.done, t.total, 76),
        h('div.hl-hero-text',
          h('h3', `${t.done} / ${t.total} villagers locked in`),
          h('p', line),
          preset ? h('span.chip', 'Based on ', preset.name) : null),
        h('div.hl-hero-actions', editBtn,
          t.stalls ? h('button.btn.primary', { type: 'button', 'data-focus': 'hero-check', onclick: () => openCheck(null) }, TH.icon('enchanted_book', { size: 18 }), 'Check an offer') : null)),
      h('div.stats.hl-stats',
        statTile(TH.icon('enchanted_book', { size: 28, glint: true }), `${t.locked}/${t.stalls}`, 'librarians locked', t.stalls ? t.locked / t.stalls : 0),
        statTile(TH.icon('villager', { size: 28 }), `${t.have}/${t.trades}`, 'other villagers', t.trades ? t.have / t.trades : 0),
        statTile(TH.icon('star', { size: 28 }), t.perfect, 'perfect-price books'),
        statTile(TH.icon('emerald', { size: 28 }), t.over, 'emeralds above perfect' + (t.locked && !t.over ? ' — nice!' : ''))),
      h('div.hl-dash', renderMap(hall, pl), renderSide(hall, pl)),
    );
    if (hall.check.open) root.append(renderCheck(hall));
  }

  function statTile(icon, num, label, frac) {
    return h('div.panel.stat.hl-stat',
      h('span.hl-stat-icon', { 'aria-hidden': 'true' }, icon),
      h('div.hl-stat-body', h('div.stat-num', num), h('div.stat-label', label),
        frac != null ? h('div.bar', h('span', { style: { width: Math.round(frac * 100) + '%' } })) : null));
  }

  /* ---- hall canvas (the layout editor itself lives in hall-canvas.js) ---- */

  let canvas = null;
  // what the side panel showed last render (slide-in only when it changes)
  let lastDetail = null;

  function villagerName(v) {
    if (v.kind === 'book') return enchLabel(v.ench, v.book.level) + (v.stall.label ? ' (' + v.stall.label + ')' : '');
    return (v.trade.purpose || profName(v.prof)) + (v.trade.target > 1 ? ' #' + (v.n + 1) : '');
  }

  function villagerIcon(v, size) {
    return v.kind === 'book'
      ? TH.icon('enchanted_book', { size, glint: status(v) === 'perfect' })
      : TH.icon.prof(v.prof.id, { size });
  }

  /** Short bits shown on a tile: name, level / #n corner, label letter, price. */
  function tileParts(v) {
    const book = v.kind === 'book';
    return {
      name: book ? enchShort(v.ench) : profShort(v.prof),
      corner: book ? (v.ench.maxLevel > 1 ? lvlText(v.book.level) : null) : (v.trade.target > 1 ? '#' + (v.n + 1) : null),
      tag: book && v.stall.label ? v.stall.label.charAt(0).toUpperCase() : null,
      paid: book && v.stall.done && v.stall.price != null ? v.stall.price : null,
      perfect: book ? minPrice(v.ench, v.book.level) : null,
    };
  }

  /** Tile contents: marks (star / padlock / label tag), level or #n, icon, short name, price. */
  function tileBody(v) {
    const t = tileParts(v), st = status(v);
    const mark = st === 'perfect' ? h('span.hc-star', { title: 'Perfect price' }, '★')
      : st === 'locked' ? h('span.hc-lock', { title: 'Locked in' }) : null;
    const price = t.perfect == null ? null
      : t.paid != null ? h('span.hc-price.is-paid', { title: 'You paid ' + t.paid }, t.paid)
        : h('span.hc-price', { title: 'Perfect price' }, t.perfect);
    return [
      mark || t.tag ? h('span.hc-marks', mark, t.tag ? h('span.hc-tag', { title: v.stall.label }, t.tag) : null) : null,
      t.corner ? h('span.hc-lv', t.corner) : null,
      h('span.hc-ico', villagerIcon(v, 28)),
      h('span.hc-name', t.name),
      price,
    ];
  }

  function tileLabel(v) {
    const st = status(v);
    const extra = v.kind === 'book' && v.stall.done && v.stall.price != null ? `, ${v.stall.price} emeralds` : '';
    const who = v.kind === 'book' ? profName(PROF.librarian) : profName(v.prof);
    return `${who}: ${villagerName(v)} — ${STATUS_LABEL[st]}${extra}`;
  }

  /* ---- selection (single: ui.selected, several: ui.multi) ---- */

  /** Selected villager keys that still exist (1 key = details panel, 2+ = overview panel). */
  function selKeys(hall, pl) {
    const m = (hall.ui.multi || []).filter((k) => pl.byKey[k]);
    if (m.length >= 2) return m;
    const k = hall.ui.selected;
    return k && pl.byKey[k] ? [k] : [];
  }
  function setSel(ui, keys) {
    keys = Array.from(new Set(keys));
    ui.selected = keys.length === 1 ? keys[0] : null;
    ui.multi = keys.length >= 2 ? keys : [];
  }
  const selCount = (hall) => (hall.ui.multi && hall.ui.multi.length >= 2 ? hall.ui.multi.length : hall.ui.selected ? 1 : 0);

  function clearSelection() {
    const hall = get();
    if (selCount(hall)) upd((x) => setSel(x.ui, []));
  }

  /** The canvas reports positions / selection / view; one store write per gesture. View-only changes are silent. */
  function onCanvasChange(ch) {
    upd((x) => {
      if (ch.pos) x.layout.pos = ch.pos;
      if (ch.sel) setSel(x.ui, ch.sel);
      if (ch.view) x.ui.view = ch.view;
    }, { silent: !!ch.view && !ch.pos && !ch.sel });
  }

  function ensureCanvas() {
    if (!canvas) {
      canvas = TH.hallCanvas.mount(null, {
        onChange: onCanvasChange, onNotify: toast,
        // phones: the details sheet is fixed over the lower part of the page; tell the canvas how much of it is covered
        getInset: (r) => {
          const sheet = document.querySelector('.hl-detail');
          return sheet && getComputedStyle(sheet).position === 'fixed' ? Math.max(0, r.bottom - sheet.getBoundingClientRect().top) : 0;
        },
      });
    }
    return canvas;
  }

  function renderMap(hall, pl) {
    const keys = selKeys(hall, pl);
    const cv = ensureCanvas();
    const items = autoOrder(pl.list).map((v) => {
      const t = tileParts(v), st = status(v);
      return {
        key: v.key, status: st, label: tileLabel(v), color: v.kind === 'book' ? PROF.librarian.color : v.prof.color,
        sig: [I18.lang, st, t.name, t.corner, t.tag, t.paid, t.perfect].join('|'),
        body: () => tileBody(v),
      };
    });
    cv.update({ items, selected: keys, pos: hall.layout.pos, view: hall.ui.view });

    const legend = h('ul.hl-legend', { 'aria-label': 'Legend' },
      ['needed', 'locked', 'perfect'].map((k) => h('li', h('i.hl-sw.is-' + k, { 'aria-hidden': 'true' }), STATUS_LABEL[k])),
      h('li', h('i.hl-sw.is-selected', { 'aria-hidden': 'true' }), 'selected'));

    return h('section.panel.hl-map' + (keys.length ? '.has-selection' : ''), { 'aria-label': 'Hall layout' },
      h('div.hl-map-head',
        h('div.hl-map-title', h('h3', 'Your hall'), h('span.hl-map-count', plural(pl.list.length, 'villager')), legend),
        h('p.hl-hint', 'Arrange villagers like your real build: drag them anywhere, scroll to pan, Ctrl + scroll to zoom. Press ? for all shortcuts.')),
      cv.el);
  }

  /* ---- right column: Next up, or the selection's details / overview ---- */

  function renderSide(hall, pl) {
    const keys = selKeys(hall, pl);
    const id = keys.length === 1 ? keys[0] : keys.length ? 'multi' : null;
    let detail = null;
    if (keys.length === 1) detail = renderDetail(hall, pl, pl.byKey[keys[0]], id !== lastDetail);
    else if (keys.length > 1) detail = renderMulti(hall, pl, keys, lastDetail !== 'multi');
    lastDetail = id;
    return h('aside.hl-side' + (keys.length ? '.has-detail' : ''), renderNext(hall, pl), detail);
  }

  /** Bulk lock / unlock: librarians get their lock ticked, other villagers count as "have" (up to / below each one's number). */
  function bulkLock(keys, on) {
    let n = 0;
    upd((x) => {
      for (const k of keys) {
        if (k.startsWith('b:')) {
          const f = findStall(x, k.slice(2));
          if (f && f.stall.done !== on) { f.stall.done = on; n++; }
        } else {
          const m = /^t:(.*):(\d+)$/.exec(k);
          const t = m && x.trades.find((y) => y.id === m[1]);
          if (!t) continue;
          const i = +m[2], before = t.have;
          t.have = on ? Math.max(t.have, i + 1) : Math.min(t.have, i);
          if (t.have !== before) n++;
        }
      }
    });
    toast(n ? `${on ? 'Locked' : 'Unlocked'} ${plural(n, 'villager')}` : 'Nothing to change');
  }

  /** Swap the positions of exactly two villagers (undoable on the canvas). */
  function swapTwo(keys) {
    if (keys.length !== 2 || !canvas) return;
    const pl = placement(get());
    const names = keys.map((k) => villagerName(pl.byKey[k]));
    canvas.swap(keys[0], keys[1]);
    toast(`Swapped ${names[0]} with ${names[1]}`);
  }

  /** Overview of 2+ selected tiles: counts, what they are, combined prices, bulk actions. */
  function renderMulti(hall, pl, keys, fresh) {
    const vs = keys.map((k) => pl.byKey[k]).sort((a, b) => posRank(pl.posOf[a.key]) - posRank(pl.posOf[b.key]));
    const books = vs.filter((v) => v.kind === 'book');
    const cnt = { needed: 0, locked: 0, perfect: 0 };
    vs.forEach((v) => { cnt[status(v)]++; });
    let perfectSum = 0, paid = 0, over = 0, noPrice = 0;
    for (const v of books) {
      const min = minPrice(v.ench, v.book.level);
      perfectSum += min;
      if (!v.stall.done) continue;
      if (v.stall.price == null) { noPrice++; continue; }
      paid += v.stall.price; over += Math.max(0, v.stall.price - min);
    }
    const byBook = new Map(), byTrade = new Map();
    for (const v of vs) {
      if (v.kind === 'book') {
        const id = v.ench.id + ':' + v.book.level;
        const r = byBook.get(id) || { v, n: 0, done: 0 };
        r.n++; if (v.stall.done) r.done++;
        byBook.set(id, r);
      } else {
        const r = byTrade.get(v.trade.id) || { v, n: 0, done: 0 };
        r.n++; if (status(v) !== 'needed') r.done++;
        byTrade.set(v.trade.id, r);
      }
    }
    const row = (icon, title, sub, r) => h('li.hl-ov-row',
      h('span.hl-ov-ico', { 'aria-hidden': 'true' }, icon),
      h('span.hl-ov-text', h('b', title), h('small', sub)),
      h('span.hl-ov-n', '×' + r.n));
    const stat = (cls, n, label) => h('div.hl-ov-stat' + cls, h('b', n), h('span', label));
    const lockedAll = cnt.locked + cnt.perfect;
    const sec = (title, n, body) => h('section.hl-ov-sec', h('h4.hl-side-h', title, h('em', n)), body);

    return h('section.panel.hl-detail.hl-multi' + (fresh ? '.enter' : ''), { role: 'region', 'aria-label': 'Selection overview' },
      h('div.hl-detail-head',
        h('span.hl-detail-icon.hl-multi-icon', { 'aria-hidden': 'true' }, h('b', vs.length)),
        h('div', h('h3', `${vs.length} villagers selected`),
          h('div.hl-detail-sub', plural(books.length, 'librarian'), ' · ', plural(vs.length - books.length, 'other villager'))),
        h('button.x-btn.hl-detail-close', { type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', 'data-focus': 'detail-close', onclick: clearSelection }, '✕')),
      h('p.hl-hint.hl-lock-why', LOCK_WHY),
      h('div.hl-ov-stats',
        stat('', lockedAll, 'locked in'),
        stat('.is-perfect', cnt.perfect, 'perfect ★'),
        stat('.is-needed', cnt.needed, 'still needed')),
      books.length ? h('div.hl-ov-prices',
        h('div', h('span.faint', 'Perfect total'), cost(perfectSum)),
        paid ? h('div', h('span.faint', 'Paid so far'), cost(paid)) : null,
        over ? h('div', h('span.faint', 'Above perfect'), h('span.hl-cost.is-old', emerald(), h('b', '+' + over))) : null,
        noPrice ? h('div.hl-ov-note', plural(noPrice, 'locked librarian') + ' without a logged price') : null) : null,
      byBook.size ? sec('Books', byBook.size, h('ul.hl-ov-list', Array.from(byBook.values()).map((r) => row(
        TH.icon('enchanted_book', { size: 22, glint: r.done === r.n }),
        enchLabel(r.v.ench, r.v.book.level),
        `${r.done} of ${r.n} locked · perfect ${minPrice(r.v.ench, r.v.book.level)}`, r)))) : null,
      byTrade.size ? sec('Villagers', byTrade.size, h('ul.hl-ov-list', Array.from(byTrade.values()).map((r) => row(
        TH.icon.prof(r.v.prof.id, { size: 22 }),
        r.v.trade.purpose || profName(r.v.prof),
        `${profName(r.v.prof)} · ${r.done} of ${r.n} in your hall`, r)))) : null,
      h('div.hl-row-btns.hl-ov-actions',
        h('button.btn.small' + (cnt.needed >= lockedAll ? '.primary' : ''), { type: 'button', disabled: cnt.needed === 0, onclick: () => bulkLock(keys, true) }, cnt.needed && lockedAll ? `Lock ${cnt.needed} more` : 'Lock all'),
        h('button.btn.small', { type: 'button', disabled: lockedAll === 0, onclick: () => bulkLock(keys, false) }, lockedAll && cnt.needed ? `Unlock ${lockedAll}` : 'Unlock all'),
        keys.length === 2 ? h('button.btn.small', { type: 'button', 'data-focus': 'swap', onclick: () => swapTwo(keys) }, '⇄ Swap') : null,
        h('button.btn.small.ghost', { type: 'button', disabled: true, title: 'Select a single librarian to check an offer' }, 'Check offer'),
        h('button.btn.small.ghost', { type: 'button', onclick: clearSelection }, 'Clear selection')),
      h('p.hl-hint.hl-detail-hint', 'Drag any selected villager to move them all together. Ctrl/⌘-click adds or removes one. Click empty canvas to close.'));
  }

  function renderDetail(hall, pl, v, fresh) {
    const pos = pl.posOf[v.key];
    const where = pos ? posLabel(pos) : 'not placed';
    const close = h('button.x-btn.hl-detail-close', {
      type: 'button', 'aria-label': 'Close details', title: 'Close (Esc)', 'data-focus': 'detail-close',
      onclick: () => upd((x) => { setSel(x.ui, []); }),
    }, '✕');
    const isLocked = status(v) !== 'needed';
    const lockRow = h('div.hl-lockrow',
      h('button.btn.small' + (isLocked ? '' : '.primary'), { type: 'button', 'data-focus': 'lock-btn', onclick: () => { if (!isLocked && v.kind === 'book' && v.stall.price == null) TH.app.pendingFocus = 'price-' + v.stall.id; bulkLock([v.key], !isLocked); } },
        isLocked ? 'Unlock' : 'Lock'),
      h('span.hl-lock-why', LOCK_WHY + (v.kind === 'book' ? ' Optionally log the price you paid below.' : '')));
    const moveHint = h('p.hl-hint.hl-detail-hint', 'Drag it anywhere to move it, or onto another villager to swap. Click empty canvas to close.');
    const wrap = (pc, label, icon, title, sub, body) => h('section.panel.hl-detail' + (fresh ? '.enter' : ''), {
      style: pc ? '--pc:' + pc : null, role: 'region', 'aria-label': label,
    },
    h('div.hl-detail-head',
      h('span.hl-detail-icon', { 'aria-hidden': 'true' }, icon),
      h('div', h('h3', title), h('div.hl-detail-sub', sub)),
      close),
    lockRow, body, moveHint);

    if (v.kind === 'trade') {
      const t = v.trade, p = v.prof;
      const set = (fn, opts) => upd((x) => { const tr = x.trades.find((y) => y.id === t.id); if (tr) fn(tr); }, opts);
      return wrap(p.color, 'Villager details', TH.icon.prof(p.id, { size: 32 }),
        [t.purpose || profName(p), t.target > 1 ? h('span.chip', '#' + (v.n + 1)) : null],
        [h('span.hl-pos', where), h('span', profName(p) + ' · ' + wsName(p))],
        [
          h('div.hl-detail-grid',
            h('div.hl-field', h('span.hl-field-label', 'In your hall'),
              h('div.hl-inline', stepper(t.have, { min: 0, max: t.target, label: 'villagers you have', key: 'have-' + t.id, onChange: (n) => set((tr) => { tr.have = n; }) }),
                h('span.muted', 'of ' + t.target + ' wanted'))),
            h('label.hl-field.hl-grow', h('span.hl-field-label', 'Note'),
              h('input.field', {
                value: t.note || '', placeholder: 'Perfect roll, location…', 'data-focus': 'tnote-' + t.id,
                oninput: (e) => set((tr) => { tr.note = e.target.value; }, { silent: true }),
              }))),
          h('details.hl-keytrades', { open: true }, h('summary', `Notable ${profName(p).toLowerCase()} trades`),
            h('ul', p.keyTrades.map((k) => h('li', h('span.faint', k.level), ` ${k.give} → ${k.get}`)))),
        ]);
    }

    const e = v.ench, b = v.book, s = v.stall;
    const range = D.bookPrice(e, b.level);
    const setStall = (fn, opts) => upd((x) => { const f = findStall(x, s.id); if (f) fn(f.stall, f.book); }, opts);
    const pill = tierPill(e, b.level, s.price);
    return wrap(null, 'Librarian details', TH.icon('enchanted_book', { size: 32, glint: status(v) === 'perfect' }),
      [enchLabel(e, b.level), s.label ? h('span.chip', s.label) : null],
      [h('span.hl-pos', where), h('span', profName(PROF.librarian) + ' · perfect'), cost(range.min), h('span', `· max ${range.max}`)],
      [
        h('div.hl-detail-grid',
          h('div.hl-field', h('span.hl-field-label', 'Price'),
            h('div.hl-inline',
              h('label.price', emerald(), h('input', {
                type: 'number', min: 1, max: 64, placeholder: '–', value: s.price ?? '', 'data-focus': 'price-' + s.id, 'aria-label': 'Price in emeralds',
                oninput: (ev) => {
                  const val = ev.target.value === '' ? null : clamp(+ev.target.value, 1, 64);
                  setStall((st) => { st.price = val; }, { silent: true });
                  const tier = D.priceTier(e, b.level, val);
                  pill.className = 'pill tier-' + tier; pill.textContent = TIER_LABEL[tier];
                },
                onchange: () => setTimeout(TH.app.render, 0),
              })),
              pill)),
          h('label.hl-field.hl-grow', h('span.hl-field-label', 'Label'),
            h('input.field', {
              value: s.label, placeholder: 'e.g. Helmet', 'data-focus': 'slabel-' + s.id,
              oninput: (ev) => setStall((st) => { st.label = ev.target.value; }, { silent: true }),
              onchange: () => setTimeout(TH.app.render, 0),
            }))),
        h('div.hl-row-btns',
          h('button.btn.small' + (s.done ? '' : '.primary'), { type: 'button', 'data-focus': 'detail-check', onclick: () => openCheck(e.id) },
            TH.icon('enchanted_book', { size: 16 }), s.done ? 'Check a cheaper offer' : 'Check an offer')),
      ]);
  }

  /* ---- next up ---- */

  const SORTS = [['type', 'Type'], ['name', 'Name'], ['pos', 'Position'], ['price', 'Price']];
  const SORT_IDS = SORTS.map((s) => s[0]);
  const ENCH_ORDER = Object.fromEntries(SORTED.map((e, i) => [e.id, i]));
  const GROUP_ORDER = Object.fromEntries(GROUPS.map((g, i) => [g.id, i]));
    const byLocale = (a, b) => a.localeCompare(b, (I18.lang || 'en_us').replace('_', '-'), { sensitivity: 'base' });

  /** Sort comparators for Next up. Books and trades each get one; ties fall back to type order. */
  function sorters(sort, pl) {
    const bType = (a, b) => (ENCH_ORDER[a.ench.id] - ENCH_ORDER[b.ench.id]) || (a.idx - b.idx);
    const tType = (a, b) => (GROUP_ORDER[a.group || 'other'] - GROUP_ORDER[b.group || 'other']) || byLocale(profName(profOf(a)), profName(profOf(b)));
    const tPos = (t) => {
      let best = 1e9;
      for (let n = 0; n < t.target; n++) best = Math.min(best, posRank(pl.posOf['t:' + t.id + ':' + n]));
      return best;
    };
    if (sort === 'name') {
      return {
        book: (a, b) => byLocale(enchLabel(a.ench, a.book.level), enchLabel(b.ench, b.book.level)) || bType(a, b),
        trade: (a, b) => byLocale(a.purpose || profName(profOf(a)), b.purpose || profName(profOf(b))) || tType(a, b),
      };
    }
    if (sort === 'pos') {
      return { book: (a, b) => (posRank(a.pos) - posRank(b.pos)) || bType(a, b), trade: (a, b) => (tPos(a) - tPos(b)) || tType(a, b) };
    }
    if (sort === 'price') {
      return { book: (a, b) => (minPrice(a.ench, a.book.level) - minPrice(b.ench, b.book.level)) || bType(a, b), trade: tType };
    }
    return { book: bType, trade: tType };
  }

  function renderNext(hall, pl) {
    const sort = SORT_IDS.includes(hall.ui.nextSort) ? hall.ui.nextSort : 'type';
    const cmp = sorters(sort, pl);
    const stalls = stallsInHallOrder(hall);
    const needed = stalls.filter((v) => !v.stall.done).sort(cmp.book);
    const improve = stalls.filter((v) => v.stall.done && v.stall.price != null && v.stall.price > minPrice(v.ench, v.book.level)).sort(cmp.book);
    const noPrice = stalls.filter((v) => v.stall.done && v.stall.price == null).sort(cmp.book);
    const toGet = hall.trades.filter((t) => t.have < t.target).slice().sort(cmp.trade);
    const profs = profCounts(hall);
    const selectCell = (key) => {
      upd((x) => { setSel(x.ui, [key]); });
      if (canvas) canvas.reveal(key);
    };
    const stallTitle = (v) => [h('b', enchLabel(v.ench, v.book.level)), v.stall.label ? h('small', v.stall.label) : null];

    const group = (title, n, items, empty) => h('section.hl-next-group',
      h('h4', title, h('span.hl-badge.is-static', n)),
      n ? h('ul.hl-strips.hl-strips-flat', items) : h('p.hl-done-line', '✓ ', empty));

    const row = (v, sub, action, onMain, title) => h('li.hl-strip.hl-strip-next' + (v.pos ? '' : '.is-unplaced'),
      h('button.hl-strip-main', { type: 'button', onclick: onMain, title, 'data-focus': 'next-' + v.key },
        h('span.hl-pos', v.pos ? posLabel(v.pos) : '–'),
        TH.icon('enchanted_book', { size: 20, cls: 'hl-strip-icon' }),
        h('span.hl-strip-text', h('span.hl-strip-title', stallTitle(v)), h('small', sub))),
      action);
    const sortCtl = h('div.hl-sort',
      h('span.hl-field-label', { id: 'hl-sort-label' }, 'Sort'),
      h('div.seg.hl-seg', { role: 'group', 'aria-labelledby': 'hl-sort-label' },
        SORTS.map(([id, label]) => h('button' + (sort === id ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(sort === id), 'data-focus': 'sort-' + id,
          onclick: () => upd((x) => { x.ui.nextSort = id; }),
        }, label))));

    return h('div.panel.hl-next-panel', { role: 'region', 'aria-label': 'Next up' },
      h('div.hl-next-head', h('h3', 'Next up'), h('p.hl-hint', 'What’s left to do. Tap a row to find it on the canvas and open its details.')),
      sortCtl,
      group('Still needed', needed.length, needed.map((v) => row(v,
        [v.book.stalls.length > 1 ? `${v.idx + 1} of ${v.book.stalls.length} · ` : '', 'perfect', cost(minPrice(v.ench, v.book.level))],
        null, () => selectCell(v.key), 'Open details')),
        'All librarians locked in'),
      improve.length || noPrice.length ? group('Could improve', improve.length + noPrice.length,
        improve.map((v) => row(v,
          [cost(v.stall.price, 'is-old'), '→', cost(minPrice(v.ench, v.book.level), 'is-new'), `save ${v.stall.price - minPrice(v.ench, v.book.level)}`],
          null, () => selectCell(v.key), 'Open details')).concat(
          noPrice.map((v) => row(v, 'No price logged — tap to add it', null, () => selectCell(v.key), 'Log the price'))),
        '') : null,
      group('Villagers to get', toGet.reduce((a, t) => a + t.target - t.have, 0), toGet.map((t) => h('li.hl-strip.hl-strip-next', { style: '--pc:' + profOf(t).color },
        h('div.hl-strip-main',
          TH.icon.prof(profOf(t).id, { size: 20, cls: 'hl-strip-icon' }),
          h('span.hl-strip-text', h('b', t.purpose || profName(profOf(t))), h('small', profName(profOf(t)), ' · ', h('b', t.have), ' / ', t.target))),
        h('button.btn.small', {
          type: 'button', 'aria-label': `Got one more ${profName(profOf(t))} (${t.purpose})`, 'data-focus': 'plus-' + t.id,
          onclick: () => upd((x) => { const tr = x.trades.find((y) => y.id === t.id); if (tr) tr.have = Math.min(tr.target, tr.have + 1); }),
        }, '+1'))),
        'Every other villager is in'),
      h('section.hl-next-group',
        h('h4', 'Workstations to place'),
        h('ul.hl-strips.hl-strips-flat', profs.map((r) => {
          const left = r.target - r.have;
          return h('li.hl-strip.hl-strip-ro.hl-strip-next', { style: '--pc:' + r.prof.color },
            h('span.hl-strip-main',
              TH.icon.prof(r.prof.id, { size: 20, cls: 'hl-strip-icon' }),
              h('span.hl-strip-text', h('b', wsName(r.prof)), h('small', profName(r.prof)))),
            h('span.hl-ws-count', h('b', '×' + r.target), left ? h('span.faint', `${left} to go`) : h('span.hl-ok', 'done')));
        }))));
  }

  /* ---- "Check an offer" dialog ---- */

  function renderCheck(hall) {
    const c = hall.check;
    const e = ENCH[c.ench];
    const needed = LIB_ENCH.filter((x) => hall.books[x.id] && hall.books[x.id].stalls.some((s) => !s.done));

    const vbox = h('div.hl-verdict-wrap', { 'aria-live': 'polite' });
    const abox = h('div.hl-check-actions');
    const listbox = h('ul.hl-cb-list', { id: 'hl-cb-list', role: 'listbox', 'aria-label': 'Enchantments' });
    const pop = h('div.hl-cb-pop');
    const closeList = (refocus) => {
      ta.open = false; ta.q = ''; paintList();
      if (refocus) trigger.focus();
    };
    const openList = () => {
      const cur = get().check.ench;
      ta.open = true; ta.q = ''; filter.value = '';
      const opts = offerOptions(get(), '');
      ta.hi = Math.max(0, opts.findIndex((o) => o.e.id === cur));
      paintList();
      filter.focus();
    };
    const filter = h('input.field.hl-cb-filter', {
      type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: 'Filter enchantments…', 'aria-label': 'Filter enchantments',
      'aria-controls': 'hl-cb-list', 'data-focus': 'chk-filter',
      oninput: (ev) => { ta.q = ev.target.value; ta.hi = 0; paintList(); },
      onblur: () => setTimeout(() => { if (ta.open && document.activeElement !== filter) closeList(false); }, 140),
      onkeydown: (ev) => {
        const opts = offerOptions(get(), ta.q);
        if (ev.key === 'ArrowDown' && opts.length) { ev.preventDefault(); ta.hi = (ta.hi + 1) % opts.length; paintList(); }
        else if (ev.key === 'ArrowUp' && opts.length) { ev.preventDefault(); ta.hi = (ta.hi - 1 + opts.length) % opts.length; paintList(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); if (opts.length) pickOffer(opts[clamp(ta.hi, 0, opts.length - 1)].e.id); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeList(true); }
        else if (ev.key === 'Tab') closeList(false);
      },
    });
    const trigger = h('button.field.hl-cb-btn', {
      type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-controls': 'hl-cb-list', 'aria-expanded': 'false',
      'aria-label': 'Enchantment', 'data-focus': 'chk-q',
      onclick: () => { if (ta.open) closeList(false); else openList(); },
      onkeydown: (ev) => {
        if (['ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault(); openList(); }
        else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key !== ' ') {
          ev.preventDefault(); openList(); filter.value = ev.key; ta.q = ev.key; paintList();
        }
      },
    },
    e ? TH.icon('enchanted_book', { size: 22, glint: true }) : TH.icon('enchanted_book', { size: 22 }),
    e ? h('span.hl-cb-val', h('b', enchLocal(e)), enchLocal(e) !== e.name ? h('small', e.name) : null) : h('span.hl-cb-val.is-empty', 'Choose an enchantment…'),
    h('i.hl-cb-caret', { 'aria-hidden': 'true' }));
    pop.append(filter,
      h('div.hl-cb-cols', { 'aria-hidden': 'true' }, h('span'), h('span', 'Enchantment'), h('span', 'Status'), h('span', 'Best price')),
      listbox);

    function paintList() {
      const hl = get();
      const opts = ta.open ? offerOptions(hl, ta.q) : [];
      ta.hi = clamp(ta.hi, 0, Math.max(0, opts.length - 1));
      trigger.setAttribute('aria-expanded', String(ta.open));
      if (ta.open && opts.length) filter.setAttribute('aria-activedescendant', 'hl-opt-' + ta.hi);
      else filter.removeAttribute('aria-activedescendant');
      pop.classList.toggle('is-open', ta.open);
      listbox.replaceChildren(...(opts.length ? opts.map((o, i) => {
        const b = hl.books[o.e.id];
        const lvl = b ? b.level : o.e.maxLevel;
        const local = enchLocal(o.e);
        return h('li.hl-cb-opt' + (i === ta.hi ? '.is-hi' : '') + (o.e.id === hl.check.ench ? '.is-cur' : '') + (o.rank === 0 ? '.is-needed' : ''), {
          id: 'hl-opt-' + i, role: 'option', 'aria-selected': String(o.e.id === hl.check.ench),
          onmousedown: (ev) => ev.preventDefault(),
          onclick: () => pickOffer(o.e.id),
        },
        TH.icon('enchanted_book', { size: 18 }),
        h('span.hl-cb-name', local, local !== o.e.name ? h('small', o.e.name) : null),
        h('span.hl-cb-st', o.rank === 0 ? h('span.pill.tier-perfect', 'needed') : o.rank === 1 ? h('span.pill.tier-unknown', 'have') : null),
        h('span.hl-cb-price', cost(minPrice(o.e, lvl))));
      }) : [h('li.hl-cb-none', 'No enchantment matches')]));
      const active = listbox.querySelector('.is-hi');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function paintVerdict() {
      const v = verdict(get());
      const vIcon = v.kind === 'lock' ? TH.icon('enchanted_book', { size: 30, glint: true })
        : v.kind === 'skip' ? TH.icon('item/barrier', { size: 26 })
          : v.kind === 'warn' ? TH.icon('item/redstone', { size: 26 })
            : TH.icon('block/lectern_front', { size: 26 });
      vbox.replaceChildren(h('div.hl-verdict.is-' + v.kind,
        h('span.hl-verdict-icon', { 'aria-hidden': 'true' }, vIcon),
        h('div',
          h('div.hl-verdict-title', v.title),
          h('div.hl-verdict-text', v.text),
          v.e ? h('div.hl-verdict-meta',
            v.price != null && v.kind !== 'warn' ? tierPill(v.e, v.level, v.price) : null,
            h('span', 'perfect price'), cost(v.range.min), h('span.faint', `· max ${v.range.max}`)) : null)));
      abox.replaceChildren(...[
        h('button.btn.primary.hl-big', {
          type: 'button', disabled: v.kind !== 'lock', 'data-focus': 'chk-add', onclick: () => doAdd(false),
        }, TH.icon('emerald', { size: 18 }), 'Add to my hall', v.kind === 'lock' ? h('kbd', 'Enter') : null),
        v.canAdd ? h('button.btn.hl-big', { type: 'button', onclick: () => doAdd(true) }, '+ Add to my list anyway') : null,
        v.e ? h('button.btn.ghost', { type: 'button', onclick: clearCheck, title: 'Clear the fields for the next offer' }, 'Clear') : null,
      ].filter(Boolean));
    }

    const priceInput = h('input', {
      type: 'number', min: 1, max: 64, inputmode: 'numeric', placeholder: '–', value: c.price ?? '', 'data-focus': 'chk-price', 'aria-label': 'Offered price in emeralds',
      oninput: (ev) => {
        const val = ev.target.value === '' ? null : clamp(+ev.target.value, 1, 64);
        TH.store.update((s) => { s.hall.check.price = val; }, { silent: true });
        paintVerdict();
      },
      onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); primaryAction(); } },
    });

    const level = e ? clamp(c.level || e.maxLevel, 1, e.maxLevel) : null;
    const range = e ? D.bookPrice(e, level) : null;

    const dialog = h('div.hl-check.panel', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hl-check-title', 'aria-describedby': 'hl-check-hint' },
      h('div.hl-check-head',
        h('div',
          h('h2', { id: 'hl-check-title' }, TH.icon.prof('librarian', { size: 28 }), 'Check an offer'),
          h('p.hl-hint', { id: 'hl-check-hint' }, 'Saw a trade in-game? Enter it here — we’ll tell you if it’s worth locking.')),
        h('button.x-btn.hl-check-close', { type: 'button', 'aria-label': 'Close (Esc)', onclick: closeCheck }, '✕')),
      h('div.hl-check-offer',
        h('span.hl-field-label', 'Enchantment'),
        h('div.hl-cb', trigger, pop),
        needed.length ? h('div.hl-quick', { role: 'group', 'aria-label': 'Still needed — tap to pick' },
          needed.map((x) => h('button.hl-quick-chip' + (c.ench === x.id ? '.on' : ''), {
            type: 'button', 'aria-pressed': String(c.ench === x.id), onclick: () => pickOffer(x.id),
          }, enchLocal(x)))) : null),
      h('div.hl-check-row',
        h('div.hl-field', h('span.hl-field-label', 'Level'),
          e ? levelChips(e, level, (lv) => upd((x) => { x.check.level = lv; }), { key: 'chk-lvl', label: 'Offered level', disabled: e.maxLevel === 1 })
            : h('div.lvl-chips', h('button', { type: 'button', disabled: true }, '–'))),
        h('div.hl-field', h('span.hl-field-label', 'Price'),
          h('div.hl-inline', h('label.price.hl-price-lg', emerald(), priceInput),
            range ? h('span.faint.hl-range', `${range.min}–${range.max}`) : null))),
      vbox, abox,
      h('p.hl-keys', h('kbd', 'Enter'), ' adds · ', h('kbd', 'Esc'), ' closes'),
    );

    paintList();
    paintVerdict();
    if (ta.open) { filter.value = ta.q; }
    const backdrop = h('div.hl-check-backdrop' + (checkJustOpened ? '.enter' : ''), {
      onclick: (ev) => { if (ev.target === ev.currentTarget) closeCheck(); },
    }, dialog);
    checkJustOpened = false;
    return backdrop;
  }

  /** Global keys: Esc / Enter / Tab trap in the check dialog; Esc clears the canvas selection. */
  function onKey(ev) {
    if (!document.querySelector('.module-hall')) return;
    const hall = get();
    const dlg = document.querySelector('.hl-check');
    const t = ev.target;
    const typing = t && t.matches && t.matches('input, textarea, select');
    if (dlg && hall.check.open) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeCheck(); }
      else if (ev.key === 'Enter' && !typing && !(t && t.closest && t.closest('button, a, summary'))) { ev.preventDefault(); primaryAction(); }
      else if (ev.key === 'Tab') {
        const f = Array.from(dlg.querySelectorAll('button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        else if (!dlg.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
      }
      return;
    }
    if (ev.key === 'Escape' && hall.setupDone && selCount(hall) && (!typing || (t.closest && t.closest('.hl-detail')))) {
      upd((x) => { setSel(x.ui, []); });
    }
  }

  /** A click outside the tile context (details panel, canvas, Next up, dialogs, menus) closes it. */
  function onDocClick(ev) {
    if (!document.querySelector('.module-hall')) return;
    const hall = get();
    if (!hall.setupDone || !selCount(hall) || (canvas && canvas.busy())) return;
    const t = ev.target;
    if (!t || !t.closest || t.closest('.hl-detail, .hc-viewport, .hl-side, .hl-check-backdrop, .toast, [role="dialog"], [role="menu"], .menu, [data-keep-selection]')) return;
    upd((x) => { setSel(x.ui, []); });
  }

  /* ================= migration ================= */

  /** One-time import from the old enchants/villagers modules. */
  function migrate(s) {
    const hall = s.hall;
    if (hall.migrated) return;
    hall.migrated = true;
    if (Object.keys(hall.books).length || hall.trades.length) return;
    const oldList = s.enchants && s.enchants.list;
    const oldRoles = s.villagers && s.villagers.roles;
    let any = false;
    for (const [id, ent] of Object.entries(oldList || {})) {
      const e = ENCH[id];
      if (!e || !ent || !e.librarian) continue;
      const slots = ent.slots && ent.slots.length ? ent.slots : [{}];
      const book = {
        level: clamp(ent.level || e.maxLevel, 1, e.maxLevel),
        stalls: slots.map((sl) => ({ id: uid('st'), label: sl.label || '', done: !!sl.done, price: sl.price ?? null })),
      };
      if (ent.wanted) { hall.books[id] = book; any = true; }
      else if (book.stalls.some(hasProgress)) hall.archive[id] = book;
    }
    for (const r of oldRoles || []) {
      hall.trades.push({
        id: r.id || uid('tr'), prof: PROF[r.prof] && r.prof !== 'librarian' ? r.prof : 'farmer', purpose: r.purpose || '',
        target: Math.max(1, r.target | 0), have: Math.max(0, r.have | 0), group: r.group || 'other', note: r.note || '',
      });
      any = true;
    }
    if (any) {
      hall.setupDone = true;
      hall.activePreset = (s.meta && s.meta.activePreset) || null;
    }
  }

  /** Layouts: v2 (cols x rows cell grid) → free positions in world px (col * 80, row * 80); anything older starts fresh. */
  function migrateLayout(hall) {
    const L = hall.layout || {};
    if (L.v === 3 && L.pos && typeof L.pos === 'object') return;
    const pos = {};
    if (L.v === 2 && L.cells) {
      for (const [cell, key] of Object.entries(L.cells)) {
        const [c, r] = String(cell).split(',').map(Number);
        if (typeof key === 'string' && isFinite(c) && isFinite(r)) pos[key] = { x: c * CG, y: r * CG };
      }
    }
    hall.layout = Object.assign({}, L.v === 2 ? L : {}, { v: 3, pos }); // old cols / rows / cells stay behind, unused
  }

  /* ================= module ================= */

  /** Sticky group headers sit just under the (sticky, variable-height) top bar. */
  function trackTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty('--hl-top', bar.offsetHeight + 'px');
    set();
    if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
    else window.addEventListener('resize', set);
  }

  function render(root, state) {
    if (!state.hall.setupDone) {
      document.body.classList.remove('hl-noscroll');
      renderWizard(root, state);
    } else {
      ensurePlaced();
      renderDashboard(root, state);
    }
  }

  /**
   * Cheapest locked offer per enchant, for other modules (e.g. Enchanting tab).
   * → { [enchId]: { level, price, perfect } }  (price may be null if not logged)
   */
  function bookOffers(state) {
    const hall = (state || TH.store.get()).hall;
    const out = {};
    if (!hall) return out;
    for (const id of Object.keys(hall.books)) {
      const b = hall.books[id];
      const locked = b.stalls.filter((s) => s.done);
      if (!locked.length || !ENCH[id]) continue;
      const priced = locked.filter((s) => s.price != null).sort((a, c) => a.price - c.price);
      const price = priced.length ? priced[0].price : null;
      out[id] = { level: b.level, price, perfect: price != null && price <= minPrice(ENCH[id], b.level) };
    }
    return out;
  }

  TH.hall = { bookOffers, applyPreset, totals: (state) => totals((state || TH.store.get()).hall), catalog: CATALOG };

  TH.app.register({
    id: 'hall',
    name: 'Trading Hall',
    icon: 'mc:emerald',
    init(store) {
      store.define('hall', DEFAULTS);
      const s = store.get();
      const hall = s.hall;
      // nested objects are replaced wholesale by saved data -> fill in any new fields
      // round 3: roll mode became "Check an offer" — drop reroll tracking silently
      delete hall.roll;
      hall.check = structuredClone(DEFAULTS.check);
      hall.ui = Object.assign(structuredClone(DEFAULTS.ui), hall.ui);
      ['arrange', 'pick', 'rearrange', 'layoutOpen'].forEach((k) => delete hall.ui[k]);
      if (!SORT_IDS.includes(hall.ui.nextSort)) hall.ui.nextSort = 'type';
      for (const b of Object.values(hall.books || {}).concat(Object.values(hall.archive || {}))) {
        (b && b.stalls || []).forEach((st) => { delete st.rolls; delete st.count; delete st.session; delete st.target; });
      }
      if (!hall.ui.expanded || typeof hall.ui.expanded !== 'object') hall.ui.expanded = {};
      migrateLayout(hall);
      hall.archive = hall.archive || {};
      if (!Array.isArray(s.customPresets)) s.customPresets = [];
      migrate(s);
      if (hall.setupDone) placeNew(hall);
      store.update(() => {}, { silent: true }); // persist migration / defaults
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onDocClick, true);
      window.addEventListener('hashchange', () => document.body.classList.remove('hl-noscroll'));
      trackTopbar();
    },
    badge(state) {
      const t = totals(state.hall);
      return t.total ? `${t.done}/${t.total}` : '';
    },
    render,
  });
})();
