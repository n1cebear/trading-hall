/**
 * Trading Hall module — the main tab.
 *
 * One combined plan: librarian books + every other villager you want.
 *   1. Setup wizard (Start → Books → Trades → Review) picks WHAT you want.
 *   2. Dashboard shows WHERE you are: an infinite, zoomable canvas of your hall (hall-canvas.js:
 *      drag tiles anywhere, marquee-select, snap + guides, undo), a sortable "Next up" list that becomes a details panel for the
 *      selected villager, and "Check an offer" (judges an in-game offer, adds it in one tap).
 *
 * Trade catalog entries / preset roles may carry `short` (one-word tile label); it is derived from `purpose` when missing.
 *
 * state.hall = {
 *   setupDone, step, editing, migrated,
 *   books:   { [enchId]: { level, stalls: [{ id, label, done, price, level? }] } },  // one stall = one librarian
 *     // book.level = level of the first copy (the default); stall.level only when a copy wants a different tier
 *     // (absent = book.level; normLevels() drops overrides equal to book.level). stall.label = the copy's tag.
 *   archive: { [enchId]: book },             // removed books, restored with their progress if re-added
 *   trades:  [{ id, prof, purpose, target, group, note }],
 *   tradeLocked: { [tileKey 't:<tradeId>:<n>']: true },   // villagers you have traded with; per tile (replaces the old trade.have count)
 *   layout:  { v: 3, pos: { [villagerKey]: { x, y } }, pinned: [villagerKey], auto? },   // pinned = position fixed (separate from a trade being locked in)
 *     // pos = world px of each tile's top-left (tile 72, grid unit 80)
 *     // auto = true while every position was machine-placed (never dragged / tidied); only then may a preset re-shape it
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
  const LOCK_WHY = 'Lock trade: you traded with it once; Minecraft fixes its offers, so no more rerolling.';
  const PIN_WHY = 'Pin: fixes its place on the canvas, so it can’t be dragged, swapped or tidied away (P).';
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
    { prof: 'fletcher', purpose: 'Sticks → Emerald', short: 'Sticks', item: 'item/stick', group: 'generator', target: 4, note: '32 sticks → 1 emerald. Fed by a tree farm.' },
    { prof: 'farmer', purpose: 'Pumpkins / Melons → Emerald', short: 'Pumpkin', item: 'item/melon_slice', group: 'generator', target: 2, note: 'Auto pumpkin & melon farms pay for everything.' },
    { prof: 'farmer', purpose: 'Crops → Emerald', short: 'Carrot', item: 'item/carrot', group: 'generator', target: 1, note: 'Wheat, carrots, potatoes or beetroot.' },
    { prof: 'cleric', purpose: 'Rotten Flesh → Emerald', short: 'Flesh', item: 'item/rotten_flesh', group: 'generator', target: 2, note: '32 flesh → 1 emerald. Zombie farm drops.' },
    { prof: 'mason', purpose: 'Clay / Stone → Emerald', short: 'Clay', item: 'item/clay_ball', group: 'generator', target: 2, note: 'Dumps strip-mine stone and clay.' },
    { prof: 'fisherman', purpose: 'String / Coal → Emerald', short: 'String', item: 'item/string', group: 'generator', target: 1, note: 'Novice trades. Pairs with a spider farm.' },
    { prof: 'shepherd', purpose: 'Wool → Emerald', short: 'Wool', item: 'block/white_wool', group: 'generator', target: 1, note: 'Novice trade. Sheep farm output.' },
    { prof: 'butcher', purpose: 'Kelp / Berries → Emerald', short: 'Kelp', item: 'item/dried_kelp', group: 'generator', target: 1, note: 'Dried kelp blocks & sweet berries.' },
    { prof: 'leatherworker', purpose: 'Leather → Emerald', short: 'Leather', item: 'item/leather', group: 'generator', target: 1, note: 'Novice trade. Pairs with a cow farm.' },
    // blacksmiths
    { prof: 'armorer', purpose: 'Iron → Emerald · Diamond armor', short: 'Iron', item: 'item/iron_ingot', group: 'blacksmith', target: 1, note: 'Iron farm → emeralds. Master sells enchanted diamond armor.' },
    { prof: 'toolsmith', purpose: 'Diamond pickaxe / axe', short: 'Pickaxe', item: 'item/diamond_pickaxe', group: 'blacksmith', target: 1, note: 'Renewable (often enchanted) diamond tools.' },
    { prof: 'weaponsmith', purpose: 'Diamond sword', short: 'Sword', item: 'item/diamond_sword', group: 'blacksmith', target: 1, note: 'Master rolls enchanted swords.' },
    // utility
    { prof: 'farmer', purpose: 'Emerald → Golden Carrot', short: 'Gold carrot', item: 'item/golden_carrot', group: 'utility', target: 1, note: 'Best food in the game.' },
    { prof: 'cleric', purpose: 'Emerald → Ender Pearl', short: 'Pearl', item: 'item/ender_pearl', group: 'utility', target: 1, note: 'Pearls for stasis chambers & travel.' },
    { prof: 'cleric', purpose: 'Emerald → Bottle o’ Enchanting', short: 'XP bottle', item: 'item/experience_bottle', group: 'utility', target: 1, note: 'XP for anvils and mending.' },
    { prof: 'cartographer', purpose: 'Explorer maps', short: 'Maps', item: 'item/filled_map', group: 'utility', target: 1, note: 'Mansions, monuments, trial chambers.' },
    { prof: 'mason', purpose: 'Emerald → Quartz blocks', short: 'Quartz', item: 'block/quartz_block_side', group: 'utility', target: 1, note: 'Master trade: quartz without the Nether trip.' },
    { prof: 'mason', purpose: 'Emerald → Terracotta', short: 'Terracotta', item: 'block/terracotta', group: 'utility', target: 1, note: 'Glazed & dyed terracotta for builds.' },
    { prof: 'shepherd', purpose: 'Emerald → Colored wool & banners', short: 'Dyed wool', item: 'block/red_wool', group: 'utility', target: 1, note: 'Every color without dye farms.' },
    { prof: 'leatherworker', purpose: 'Emerald → Saddle', short: 'Saddle', item: 'item/saddle', group: 'utility', target: 1, note: 'Master trade.' },
    { prof: 'butcher', purpose: 'Emerald → Cooked food', short: 'Cooked', item: 'item/cooked_porkchop', group: 'utility', target: 1, note: 'Rabbit stew, porkchops, chicken.' },
    { prof: 'fletcher', purpose: 'Emerald → Arrows', short: 'Arrows', item: 'item/arrow', group: 'utility', target: 1, note: 'Arrows, flint and tipped arrows.' },
  ];

  /** Direction of a catalog row: what the player sells to the villager (item -> emerald) or buys from it (emerald -> item). */
  CATALOG.forEach((c) => { c.dir = c.dir || (c.group === 'generator' ? 'sell' : 'buy'); });
  CATALOG.splice(CATALOG.findIndex((c) => c.prof === 'armorer') + 1, 0,
    { prof: 'armorer', purpose: 'Emerald → Diamond armor', short: 'Diamond armor', item: 'item/diamond_chestplate', group: 'blacksmith', dir: 'buy', target: 1, note: 'Master armorer: diamond armor, often enchanted.' });
  CATALOG.find((c) => c.prof === 'armorer' && c.purpose.startsWith('Iron')).dir = 'sell';
  /** Sell / buy side of any trade: catalog rows say it themselves, custom ones carry `dir`. */
  const dirOf = (t) => { const c = catOf(t.prof, t.purpose); return c ? c.dir : (t.dir || (t.group === 'generator' ? 'sell' : 'buy')); };

  /** Catalog entry for a trade (matched by profession + purpose). */
  const tradeShort = (t) => shortOf(t.prof, t.purpose);
  const PRESET_SHORT = {};
  (D.presets || []).forEach((p) => (p.roles || []).forEach((r) => { if (r.short) PRESET_SHORT[r.prof + '|' + r.purpose] = r.short; }));
  const catOf = (profId, purpose) => CATALOG.find((c) => c.prof === profId && c.purpose === purpose);
  /** What a villager is about, in a word or two: explicit `short` from the catalog, else derived from its purpose ("A → B": the side that is not Emerald). */
  function shortOf(profId, purpose) {
    const c = catOf(profId, purpose);
    if (c && c.short) return c.short;
    if (PRESET_SHORT[profId + '|' + purpose]) return PRESET_SHORT[profId + '|' + purpose];
    if (!purpose) return '';
    const parts = purpose.split('→').map((x) => x.trim());
    const w = (parts.find((x) => !/^emerald/i.test(x)) || parts[0]).split(/[\/,·&]/)[0].trim();
    return w.length > 12 ? w.slice(0, 11) + '…' : w;
  }

  const STEPS = [
    { t: 'Start', d: 'Pick a preset, or start from scratch' },
    { t: 'Villagers', d: 'Librarian books and other traders' },
    { t: 'Review', d: 'Final check & Finish' },
  ];

  const DEFAULTS = {
    setupDone: false, step: 0, editing: false, migrated: false,
    books: {}, archive: {}, trades: [],
    layout: { v: 3, pos: {}, pinned: [] },
    tradeLocked: {},
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
  /** Effective tier of one copy (librarian) of a book. */
  const stLv = (book, st) => (st && st.level) || book.level;
  /** Set every copy's tier from one array (index = copy); the first copy becomes book.level, others override only when different. */
  function setLevels(book, levels, maxLevel) {
    book.level = clamp(levels[0] || book.level, 1, maxLevel);
    book.stalls.forEach((st, i) => {
      const lv = clamp(levels[i] || book.level, 1, maxLevel);
      if (lv === book.level) delete st.level; else st.level = lv;
    });
  }
  /** Drop invalid / redundant per-copy overrides (migration + after edits). */
  function normLevels(book, maxLevel) {
    if (!book || !Array.isArray(book.stalls)) return;
    if (!isFinite(book.level)) book.level = maxLevel || 1;
    setLevels(book, book.stalls.map((st) => (isFinite(st.level) && st.level >= 1 ? Math.round(st.level) : null)), maxLevel || 10);
  }
  /**
   * The cover shown for an enchantment on cards (Books step, Review). Today: the vanilla enchanted book.
   * The one hook for custom covers later (e.g. per-category books in the style of a resource pack).
   */
  const bookCover = (enchId, o) => TH.icon('enchanted_book', Object.assign({ size: 24 }, o));
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
      book.stalls.forEach((stall, i) => out.push({ key: 'b:' + stall.id, kind: 'book', ench: ENCH[id], book, stall, idx: i, lv: stLv(book, stall) }));
    }
    for (const t of hall.trades) {
      for (let n = 0; n < t.target; n++) out.push({ key: tradeKey(t.id, n), kind: 'trade', trade: t, n, prof: profOf(t), hall });
    }
    return out;
  }

  const tradeKey = (id, n) => 't:' + id + ':' + n;
  const tradeIsLocked = (hall, id, n) => !!(hall && hall.tradeLocked && hall.tradeLocked[tradeKey(id, n)]);
  /** How many tiles of this trade are locked (derived — only tiles below `target` count). */
  function haveOf(hall, tr) {
    let n = 0;
    for (let i = 0; i < tr.target; i++) if (tradeIsLocked(hall, tr.id, i)) n++;
    return n;
  }

  /** needed | locked | perfect */
  function status(v) {
    if (v.kind === 'trade') return tradeIsLocked(v.hall, v.trade.id, v.n) ? 'locked' : 'needed';
    const s = v.stall;
    if (s.done) return s.price != null && s.price <= minPrice(v.ench, v.lv) ? 'perfect' : 'locked';
    return 'needed';
  }

  /** Counters for the header, stats and nav badge. */
  function totals(hall) {
    const t = { stalls: 0, locked: 0, trades: 0, have: 0, perfect: 0, over: 0 };
    for (const id of bookIds(hall)) {
      const book = hall.books[id];
      for (const s of book.stalls) {
        t.stalls++;
        if (!s.done) continue;
        const min = minPrice(ENCH[id], stLv(book, s));
        t.locked++;
        if (s.price != null) s.price <= min ? t.perfect++ : (t.over += s.price - min);
      }
    }
    for (const tr of hall.trades) { t.trades += tr.target; t.have += haveOf(hall, tr); }
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
    for (const tr of hall.trades) add(tr.prof, tr.target, haveOf(hall, tr));
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
    if (L.pinned) L.pinned = L.pinned.filter((k) => pl.byKey[k]);
    // a layout nobody has arranged yet (fresh, or only ever machine-placed) follows the active preset's starting shape
    if (!Object.keys(L.pos).length) L.auto = true;
    const shape = L.auto && presetShape(hall);
    const keys = autoOrder(pl.tray).map((v) => v.key);
    Object.assign(L.pos, shape ? TH.hallCanvas.shapePlace(keys, shape, L.pos) : TH.hallCanvas.autoPlace(keys, L.pos));
    return pl.tray.length;
  }

  /** Starting-layout shape of the active built-in preset (presets.js `layout`), or null. */
  function presetShape(hall) {
    const p = hall.activePreset && D.presets.find((x) => x.id === hall.activePreset);
    return p && p.layout && TH.hallCanvas.shapes && TH.hallCanvas.shapes[p.layout] ? p.layout : null;
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
      out[id] = { level, slots: cfg.slots || [], levels: Array.isArray(cfg.levels) ? cfg.levels : null };
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
        if (cfg.levels) setLevels(book, cfg.levels.map((l) => (l === 'max' ? ENCH[id].maxLevel : +l || cfg.level)), ENCH[id].maxLevel); else setLevels(book, [cfg.level], ENCH[id].maxLevel);
      }
      if (preset.roles) {
        const old = hall.trades;
        hall.trades = preset.roles.map((r) => {
          const prev = old.find((o) => o.prof === r.prof && o.purpose === r.purpose);
          return {
            id: prev ? prev.id : uid('tr'), prof: r.prof, purpose: r.purpose || '', target: r.target || 1,
            group: r.group || 'other', note: r.note || '',
          };
        });
      }
      hall.activePreset = preset.id;
      // a preset with a starting shape re-lays the hall only while the layout is still machine-made (never dragged or
      // tidied by the user); pinned tiles stay. An arranged hall is kept as it is, new villagers are added after it.
      const L = hall.layout;
      if (preset.layout && L && (L.auto || !Object.keys(L.pos || {}).length)) {
        const pins = new Set(L.pinned || []);
        L.pos = Object.fromEntries(Object.entries(L.pos || {}).filter(([k]) => pins.has(k)));
        L.auto = true;
        if (hall.setupDone) placeNew(hall);
      }
    });
    toast(`Loaded “${preset.name}”`);
  }

  /** Current plan as a preset (no progress). */
  function snapshot(hall, name) {
    const enchants = {};
    for (const id of bookIds(hall)) {
      const b = hall.books[id];
      const labels = b.stalls.map((s) => s.label);
      const lvs = b.stalls.map((s) => stLv(b, s));
      enchants[id] = b.stalls.length > 1 || labels[0] ? Object.assign({ level: b.level, slots: labels }, lvs.some((l) => l !== b.level) ? { levels: lvs } : null) : b.level;
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
    // every copy may want its own tier: the offer fits the copies that want this level or lower
    const pool = book.stalls.some((s) => !s.done) ? book.stalls.filter((s) => !s.done) : book.stalls;
    const minWant = Math.min(...pool.map((s) => stLv(book, s)));
    if (level < minWant) {
      return { ...base, kind: 'skip', title: 'Skip it — level too low', text: `You want ${enchLabel(e, minWant)}; this one is only ${lvlText(level)}. Reroll.` };
    }
    const open = book.stalls.filter((s) => !s.done && stLv(book, s) <= level).length;
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
    // open copy that wants this tier or lower; the highest wanted tier first (a IV offer fills the IV copy before the III one)
    const open = order.filter((v) => !v.stall.done && v.lv <= level).sort((a, b) => b.lv - a.lv)[0];
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
    prevPlan = null;
    upd((hall) => { hall.setupDone = true; hall.editing = false; hall.step = 0; });
    setTimeout(() => window.scrollTo({ top: 0 }), 0);
  }

  function renderWizard(root, state) {
    const hall = state.hall;
    const step = clamp(hall.step || 0, 0, STEPS.length - 1);
    const body = [stepStart, stepVillagers, stepReview][step](state);

    root.append(
      h('div.page-head.hl-wiz-head',
        h('h2', TITLE),
        hall.editing ? h('button.btn', { type: 'button', onclick: finishSetup }, '← Back to hall') : null,
      ),
      h('div.hl-wiz-layout',
        h('section.hl-wiz-body', { 'aria-label': STEPS[step].t }, body),
        wizardSide(hall, step)),
    );
    queueFitSide();
  }

  /**
   * Keep the sticky wizard sidebar exactly inside the visible area: below the top bar (or its own place in the page
   * while that is lower) and above the viewport bottom / the end of the layout. So its floating Back / Next row is
   * always on screen on desktop, and the sidebar never slides under the top bar at the end of the page.
   */
  let sideRaf = 0;
  function fitSide() {
    sideRaf = 0;
    const s = document.querySelector('.hl-wiz-side');
    if (!s) return;
    const cs = getComputedStyle(s);
    if (cs.position !== 'sticky') { s.style.maxHeight = ''; return; }
    const lay = s.parentElement.getBoundingClientRect();
    const top = Math.max(parseFloat(cs.top) || 0, s.getBoundingClientRect().top);
    const bottom = Math.min(innerHeight - 16, lay.bottom);
    s.style.maxHeight = Math.max(200, Math.round(bottom - top)) + 'px';
  }
  // a 0 ms timer, not rAF (rAF stalls in background tabs); scroll events already arrive at most once per frame
  function queueFitSide() { clearTimeout(sideRaf); sideRaf = setTimeout(fitSide, 0); }

  /* ---- running summary (footer + review share these) ---- */

  /** Selected books as { e, level, n } in catalog order. */
  function bookSummary(hall) { return bookIds(hall).map((id) => ({ e: ENCH[id], level: hall.books[id].level, n: hall.books[id].stalls.length })); }
  /** Other villagers by profession as { prof, target } (librarians excluded), biggest first. */
  function tradeSummary(hall) { return profCounts(hall).filter((r) => r.prof.id !== 'librarian').sort((a, b) => b.target - a.target); }
  const bookChipText = (b) => enchShort(b.e) + (b.e.maxLevel > 1 ? ' ' + lvlText(b.level) : '');

  /** "Pumpkin, Carrot" — which trades a profession is used for in the plan (for lists that only name the profession). */
  function tradeShorts(hall, profId) {
    const out = [];
    for (const t of hall.trades) if (t.prof === profId) { const sh = tradeShort(t); if (sh && !out.includes(sh)) out.push(sh); }
    return out.join(', ');
  }

  let justAdded = null;
  /** Last rendered sidebar numbers, so a changed value can play a small "bump" animation. */
  const sideSeen = {};
  const bumpNum = (key, v, pre) => {
    const bump = sideSeen[key] != null && sideSeen[key] !== v;
    sideSeen[key] = v;
    return h('b' + (bump ? '.is-bump' : ''), (pre || '') + v);
  };

  /**
   * Plan grouped per workstation: one row per profession (icon once + count); librarians carry a compact
   * text list of their books. Shared by the wizard sidebar and the Review summary. No accents, no dividers.
   */
  function wsList(hall, o) {
    o = o || {};
    const t = totals(hall);
    const books = bookSummary(hall);
    const key = o.key || 'ws';
    const row = (prof, n, sub, extra) => h('li.hl-ws-row', { title: wsName(prof) + ' ×' + n + (sub ? ': ' + sub : '') },
      TH.icon.prof(prof.id, { size: 20 }),
      h('span.hl-ws-name', h('span', wsName(prof)), sub ? h('small', sub) : null),
      h('em.hl-ws-n', bumpNum(key + '-' + prof.id, n, '×')),
      extra || null);
    return h('ul.hl-ws-list',
      t.stalls ? row(PROF.librarian, t.stalls, plural(books.length, 'book'),
        o.books === false ? null : h('span.hl-ws-books', books.map((b) => h('span', { title: enchLabel(b.e, b.level) }, bookChipText(b), b.n > 1 ? h('small', '×' + b.n) : null)))) : null,
      tradeSummary(hall).map((r) => row(r.prof, r.target, tradeShorts(hall, r.prof.id) || profName(r.prof))));
  }

  /** Sticky right column: plain running total, the plan per workstation, and the floating Back / Next row. */
  function wizardSide(hall, step) {
    const t = totals(hall);
    return h('aside.hl-wiz-side', { 'aria-label': 'Total so far' },
      h('div.panel.hl-side-panel',
        h('ol.hl-mini', { 'aria-label': 'Setup steps' }, STEPS.map((st, i) => h('li' + (i < step ? '.is-done' : i === step ? '.is-current' : ''),
          h('button', { type: 'button', 'aria-current': i === step ? 'step' : null, 'data-focus': 'step-' + i, title: (i + 1) + '. ' + st.t + ' — ' + st.d, onclick: () => goStep(i) },
            h('span.hl-mini-n', { 'aria-hidden': 'true' }, i < step ? '✓' : String(i + 1)), h('span.hl-mini-t', st.t))))),
        h('div.hl-side-sum', { 'aria-live': 'polite' },
          h('div.hl-side-title', 'Total so far'),
          h('div.hl-side-total', bumpNum('tot', t.total), h('span', t.total === 1 ? 'villager' : 'villagers')),
          h('div.hl-side-split', bumpNum('lib', t.stalls), t.stalls === 1 ? ' librarian · ' : ' librarians · ', bumpNum('oth', t.trades), ' other')),
        t.total ? wsList(hall, { key: 'side' }) : h('p.hl-side-empty', 'Nothing planned yet.'),
        wizardNav(step)));
  }

  /**
   * Back / Next as standalone buttons (shared sticky action row, .th-act-row in styles.css): the last row of the
   * sidebar panel, floating at the bottom of its scroll area (or the viewport when it stacks), at rest flush at the end.
   */
  function wizardNav(step) {
    const last = step === STEPS.length - 1;
    return h('div.th-act-row.hl-wiz-nav', { role: 'group', 'aria-label': 'Setup steps navigation' },
      step > 0 ? h('button.btn', { type: 'button', 'data-focus': 'wiz-back', onclick: () => goStep(step - 1) }, '← Back') : null,
      last
        ? h('button.btn.primary', { type: 'button', 'data-focus': 'wiz-finish', onclick: finishSetup }, 'Finish → Hall')
        : h('button.btn.primary', { type: 'button', 'data-focus': 'wiz-next', onclick: () => goStep(step + 1) }, 'Next: ' + STEPS[step + 1].t + ' →'));
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
    try { body.replaceChildren([stepStart, stepVillagers, stepReview][step](state)); } finally { justAdded = null; }
    const sy = side.scrollTop, ns = wizardSide(state.hall, step);
    ns.style.maxHeight = side.style.maxHeight;
    side.replaceWith(ns);
    ns.scrollTop = sy;
    window.scrollTo(0, y);
    fitSide();
    TH.app.refreshBadges();
    if (o.focus) { const el = document.querySelector('[data-focus="' + o.focus + '"]'); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---- step 1: start ---- */

  /* "Previous plan": the custom plan you had before picking a preset this visit, so a switch can be undone from the
     overview itself (module memory only; cleared on Finish and by a page reload, e.g. after Reset everything). */
  let prevPlan = null;
  const PLAN_KEYS = ['books', 'archive', 'trades', 'tradeLocked', 'layout', 'activePreset'];
  /** Comparable shape of a plan: books (level × librarians) and trades (prof | purpose | count). */
  function planSig(hall) {
    const b = bookIds(hall).map((id) => id + ':' + hall.books[id].level + 'x' + hall.books[id].stalls.length);
    const t = hall.trades.map((x) => x.prof + '|' + (x.purpose || '') + '|' + x.target).sort();
    return b.join(',') + '/' + t.join(',');
  }
  function presetSig(p, hall) {
    const spec = resolveSpec(p);
    const b = SORTED.filter((e) => spec[e.id]).map((e) => e.id + ':' + spec[e.id].level + 'x' + Math.max(1, spec[e.id].slots.length));
    const t = p.roles ? p.roles.map((r) => r.prof + '|' + (r.purpose || '') + '|' + (r.target || 1)).sort() : planSig(hall).split('/')[1].split(',').filter(Boolean);
    return b.join(',') + '/' + t.join(',');
  }
  /** The preset the plan currently equals (the remembered one first), else null. */
  function matchedPreset(hall, list) {
    if (!totals(hall).total) return list.find((p) => p.id === 'empty' && hall.activePreset === 'empty') || null;
    const sig = planSig(hall);
    const order = list.slice().sort((a, b) => (b.id === hall.activePreset) - (a.id === hall.activePreset));
    return order.find((p) => p.id !== 'empty' && presetSig(p, hall) === sig) || null;
  }

  function stepStart(state) {
    const hall = state.hall;
    const t = totals(hall);
    const builtIn = D.presets.filter((p) => p.id !== 'empty');
    const blank = D.presets.find((p) => p.id === 'empty') || { id: 'empty', name: 'Blank', enchants: {}, roles: [] };
    const custom = state.customPresets;
    const match = matchedPreset(hall, builtIn.concat(custom, [blank]));
    const isCustomPlan = t.total > 0 && !match;
    const showPrev = prevPlan && planSig(hall) !== prevPlan.sig;
    const ico = (name) => TH.icon(name, { size: 30 });
    const icons = { bare: 'item/iron_pickaxe', blueprint: 'map', generators: 'emerald', all: 'block/bookshelf' };

    /** { stalls, trades (null = keeps yours), books: ['Mending', 'Prot IV ×3'], profs: [[profId, n]] } */
    const sumOfPreset = (p) => {
      const info = presetInfo(p);
      const profs = {};
      (p.roles || []).forEach((r) => { profs[r.prof] = (profs[r.prof] || 0) + (r.target || 1); });
      return {
        stalls: info.stalls, trades: info.trades,
        books: info.ids.map((id) => { const n = Math.max(1, info.spec[id].slots.length); return bookChipText({ e: ENCH[id], level: info.spec[id].level }) + (n > 1 ? ' ×' + n : ''); }),
        profs: Object.entries(profs).sort((a, b) => b[1] - a[1]),
      };
    };
    const sumOfPlan = (pl) => {
      const tt = totals(pl);
      return {
        stalls: tt.stalls, trades: tt.trades,
        books: bookSummary(pl).map((b) => bookChipText(b) + (b.n > 1 ? ' ×' + b.n : '')),
        profs: tradeSummary(pl).map((r) => [r.prof.id, r.target]),
      };
    };

    const pick = (p) => {
      if (match && match.id === p.id) return;
      if (isCustomPlan) prevPlan = { sig: planSig(hall), plan: structuredClone(Object.fromEntries(PLAN_KEYS.map((k) => [k, hall[k]]))) };
      applyPreset(p);
      if (isCustomPlan) toast(`Loaded “${p.name}” — “Previous plan” at the top switches back`);
    };
    const restore = () => {
      const s = prevPlan;
      prevPlan = null;
      upd((x) => { for (const k of PLAN_KEYS) x[k] = structuredClone(s.plan[k]); });
      toast('Switched back to your previous plan');
    };

    /** One equal-height preset strip: icon | name + description + key books | librarians / others + workstation icons | check. */
    const strip = (o) => {
      const s = o.sum;
      const profs = s ? s.profs.slice(0, 5) : [];
      return h('li.hl-preset-item' + (o.tileCls || ''),
        h('button.hl-preset' + (o.on ? '.is-on' : '') + (s ? '' : '.is-slim'), {
          type: 'button', 'aria-pressed': String(!!o.on), 'data-focus': 'preset-' + o.key, onclick: o.onPick,
        },
          h('span.hl-preset-icon', { 'aria-hidden': 'true' }, o.icon),
          h('span.hl-preset-main',
            h('b.hl-preset-name', o.title),
            h('span.hl-preset-desc', o.desc),
            s ? h('span.hl-preset-books', s.books.length ? s.books.slice(0, 6).join(' · ') + (s.books.length > 6 ? '  +' + (s.books.length - 6) : '') : 'No books') : null),
          s ? h('span.hl-preset-meta',
            h('span.hl-preset-counts',
              h('span', h('b', s.stalls), s.stalls === 1 ? ' librarian' : ' librarians'),
              s.trades == null ? h('span', 'keeps your trades') : h('span', h('b', s.trades), ' other')),
            h('span.hl-preset-profs', { 'aria-hidden': 'true' },
              profs.map(([pid]) => h('span', { title: PROF[pid] ? profName(PROF[pid]) : pid }, TH.icon.prof(pid, { size: 18 }))),
              s.profs.length > 5 ? h('small', '+' + (s.profs.length - 5)) : null)) : null,
          h('span.hl-preset-check', { 'aria-hidden': 'true' })),
        o.reco ? TH.util.reco() : null,
        o.del ? h('button.x-btn.hl-preset-del', {
          type: 'button', title: 'Delete preset', 'aria-label': 'Delete preset ' + o.title, onclick: o.del,
        }, '✕') : null);
    };
    const presetStrip = (p, icon, extra) => strip(Object.assign({
      key: p.id, title: p.name, desc: p.desc, icon, sum: sumOfPreset(p), on: !!match && match.id === p.id, onPick: () => pick(p),
    }, extra));

    const own = h('li.hl-preset-item.hl-own', h('button.hl-own-btn' + (match && match.id === 'empty' ? '.is-on' : ''), {
      type: 'button', 'aria-pressed': String(!!match && match.id === 'empty'), 'data-focus': 'preset-empty', onclick: () => pick(blank),
    }, h('span.hl-own-plus', { 'aria-hidden': 'true' }, '+'), h('span.hl-own-text', h('b', 'Create your own'), h('span', 'Start empty and pick every book and villager yourself'))));

    return h('div.hl-presets',
            h('ul.hl-preset-grid',
        isCustomPlan ? strip({ key: 'current', title: 'Current plan', desc: 'Your own plan, as you left it. Press Next to edit it.', icon: ico('item/writable_book'), sum: sumOfPlan(hall), on: true, onPick: () => {} }) : null,
        showPrev ? strip({ key: 'previous', title: 'Previous plan', desc: 'Your plan before you picked a preset. Pick it to switch back.', icon: ico('item/writable_book'), sum: sumOfPlan(prevPlan.plan), onPick: restore }) : null,
        own,
        builtIn.slice().sort((a, b) => (b.id === 'blueprint') - (a.id === 'blueprint')).map((p) => presetStrip(p, ico(icons[p.id] || 'item/chest_minecart'), { reco: p.id === 'blueprint', tileCls: p.id === 'blueprint' ? '.is-reco' : '' }))),
      custom.length ? [
        h('h3.section-title.hl-sec-title', 'Your presets'),
        h('ul.hl-preset-grid', custom.map((p) => presetStrip(p, ico('item/writable_book'), {
          del: () => { if (confirm(`Delete preset “${p.name}”?`)) TH.store.update((st) => { st.customPresets = st.customPresets.filter((x) => x.id !== p.id); }); },
        }))),
      ] : null,
    );
  }

  /* ---- step 2: books (strips) ---- */

  /** The items an enchant category is for, shown once in the group head instead of a book icon on every strip. */
  const PART_ICON = { helmet: 'diamond_helmet', chestplate: 'diamond_chestplate', leggings: 'diamond_leggings', boots: 'diamond_boots' };
  const CAT_ITEMS = {
    armor: ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'], boots: ['diamond_boots'], helmet: ['diamond_helmet'],
    melee: ['diamond_sword', 'diamond_axe', 'diamond_spear'], mace: ['mace'], tools: ['diamond_pickaxe', 'diamond_shovel', 'diamond_axe', 'diamond_hoe'],
    bow: ['bow'], crossbow: ['crossbow_standby'], trident: ['trident'], fishing: ['fishing_rod'], universal: ['anvil'], curse: ['item/barrier'],
  };

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
    ), h('p.hl-hint.hl-books-hint', 'Need the same book twice, e.g. one per armor piece? Press + on its row.'));

    let shown = 0;
    const groups = [];
    for (const cat of D.enchantCategories) {
      const items = SORTED.filter((e) => e.category === cat.id && enchMatches(e, q));
      if (!items.length) continue;
      shown += items.length;
      const selectable = items.filter((e) => e.librarian);
      const allOn = selectable.length && selectable.every((e) => hall.books[e.id]);
      const onCount = items.filter((e) => hall.books[e.id]).length;
      groups.push(groupEntry(items.length, h('section.hl-group', { 'aria-label': cat.name },
        h('div.hl-group-head',
          h('span.hl-group-items', { 'aria-hidden': 'true' }, (CAT_ITEMS[cat.id] || []).map((i) => TH.icon(i, { size: 32 }))),
          h('span.hl-group-title', h('h3', cat.name), h('small', cat.hint)),
          onCount ? h('span.hl-group-count', onCount + ' on') : null,
          h('span.spacer'),
          selectable.length > 1 ? h('button.btn.ghost.small', {
            type: 'button', 'aria-label': (allOn ? 'Deselect all in ' : 'Select all in ') + cat.name, 'data-focus': 'catall-' + cat.id,
            onclick: () => upd((x) => selectable.forEach((e) => (allOn ? removeBook(x, e.id) : x.books[e.id] || addBook(x, e.id)))),
          }, allOn ? 'None' : 'All') : null),
        h('ul.hl-strips.hl-strips-2', items.map((e) => bookStrip(hall, e))))));
    }
    if (groups.length) out.append(h('div.hl-groups.hl-groups-stack', groups.map((g) => g.el)));
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

  /*
   * Enchantment / trade CARDS (Books + Trades steps; read-only variant on Review). One card per catalog row:
   *   head row:  [tick + cover + name (+ ×n count) / sub line] [tag (single copy)] [tier chips] [+]
   *   copy rows: [i/n] [tag] [locked] [tier chips] [×]          (only with 2+ copies; books)
   *   copy chips: [i/n  in hall  ×] …                            (only with 2+ copies; trades: copies have no own data)
   * Every row shares one grid (main | tiers | action), so tier chips start on one line and + / × share one column.
   */

  /** "+" key: adds one more copy of this card. */
  const plusBtn = (o) => h('button.btn.small.ghost.hl-dup', {
    type: 'button', title: 'Add one more', 'data-focus': 'dup-' + o.key, 'aria-label': `Add another ${o.name}`,
    disabled: o.max, onclick: o.onAdd,
  }, plusIco());
  /** "×" key: removes one copy. */
  const delBtn = (o) => h('button.x-btn.hl-del', {
    type: 'button', title: o.title || 'Remove this one', 'aria-label': o.label, 'data-focus': 'rm-' + o.key, onclick: o.onDel,
  }, '✕');
  /** One card row on the shared grid. */
  const cardRow = (cls, main, lv, act, attrs) => h('div.hl-card-row' + (cls || ''), attrs || null,
    h('div.hl-strip-main', main), h('span.hl-strip-lv', lv), h('span.hl-card-act', act));

  /* Duplicated books: every villager column keeps its normal size; columns that do not fit are folded into a "+n" key
     (click = show all, wrapped). Measured after every render / resize, never by shrinking the tier keys. */
  const openCols = new Set();
  function fitCols() {
    document.querySelectorAll('.hl-cols-v').forEach((box) => {
      const cols = [...box.querySelectorAll(':scope > .hl-vcol')], more = box.querySelector(':scope > .hl-vmore');
      const card = box.closest('.hl-cols');
      cols.forEach((c) => { if (c.hidden) c.hidden = false; });
      if (more && !more.hidden) more.hidden = true;
      if (!cols.length || (card && card.classList.contains('is-open'))) return;
      const gap = 4, moreW = 46, avail = box.clientWidth, widths = cols.map((c) => c.offsetWidth);
      if (widths.reduce((a, w) => a + w, 0) + gap * (cols.length - 1) <= avail) return;
      let used = 0, shown = 0;
      for (let i = 0; i < cols.length; i++) {
        const w = widths[i] + (i ? gap : 0);
        if (used + w + gap + moreW <= avail) { used += w; shown++; } else break;
      }
      shown = Math.max(1, shown);
      cols.forEach((c, i) => { if (i >= shown) c.hidden = true; });
      if (more) {
        const t = '+' + (cols.length - shown);
        if (more.textContent !== t) more.textContent = t;
        more.title = cols.slice(shown).map((c, i) => (c.querySelector('.hl-tag') || {}).value || ('#' + (shown + i + 1))).join(', ');
        more.hidden = false;
      }
    });
  }
  let colsMO = null, colsRO = null;
  function watchCols(root) {
    if (colsMO) colsMO.disconnect();
    if (colsRO) colsRO.disconnect();
    let raf = 0;
    const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitCols); };
    colsMO = new MutationObserver(sched); colsMO.observe(root, { childList: true, subtree: true });
    colsRO = new ResizeObserver(sched); colsRO.observe(root);
    sched();
  }

  function bookStrip(hall, e) {
    const book = hall.books[e.id];
    const on = !!book;
    const local = enchLocal(e);
    const sub = local !== e.name ? e.name : null;

    if (!e.librarian) {
      return h('li.hl-card-item', h('div.hl-strip.hl-card.is-disabled', { title: 'Librarians never sell this book' },
        cardRow('.hl-card-head', [
          h('span.hl-tick', { 'aria-hidden': 'true' }),
          h('span.hl-strip-text', h('b', local), h('small', TH.icon('item/barrier', { size: 12 }), NOT_LIBRARIAN[e.id] || 'Not sold by librarians'))])));
    }

    const n = on ? book.stalls.length : 0;
    const multi = n > 1;
    const stalls = on ? book.stalls : [];
    const fresh = () => TH.store.get().hall.books[e.id];

    /** Tier chips for copy i (all levels of the enchant; max-only enchants get none). */
    const tiers = (i) => {
      if (e.maxLevel <= 1) return null;
      const key = 'lvl-' + e.id + '-' + i;
      const cur = on ? stLv(book, stalls[i]) : e.maxLevel;
      return levelChips(e, cur, (lv) => softUpdate((x) => {
        const b = x.books[e.id] || addBook(x, e.id);
        const lvs = b.stalls.map((s) => stLv(b, s));
        lvs[i] = lv;
        setLevels(b, lvs, e.maxLevel);
      }, { focus: key + '-' + (lv - 1) }), { key, label: local + ' level' + (multi ? ` (copy ${i + 1})` : '') });
    };
    /** Quiet inline tag field for copy i (stored as stall.label). */
    const tag = (st, i) => h('input.hl-slot.hl-tag', {
      value: st.label || '', maxlength: 24, spellcheck: false,
      placeholder: '+ tag',
      title: 'Optional tag, e.g. which armor piece this librarian is for',
      'data-focus': 'lbl-' + st.id, 'aria-label': `${local} ${multi ? 'copy ' + (i + 1) + ' ' : ''}tag`,
      oninput: (ev) => upd((x) => { const b = x.books[e.id]; const s = b && b.stalls.find((y) => y.id === st.id); if (s) s.label = ev.target.value; }, { silent: true }),
    });

    const partKey = e.appliesTo && e.appliesTo.length === 1 ? PART_ICON[e.appliesTo[0]] : null;
    const toggle = h('button.hl-card-toggle', {
      type: 'button', 'aria-pressed': String(on), title: e.desc, 'data-focus': 'strip-' + e.id, 'aria-label': on ? `${local}, selected` : local,
      onclick: () => {
        if (!on) { upd((x) => addBook(x, e.id)); return; }
        if (book.stalls.some(hasProgress) && !confirm(`Remove ${local}? Its logged progress is remembered if you add it back.`)) return;
        upd((x) => removeBook(x, e.id));
      },
    },
    h('span.hl-tick', { 'aria-hidden': 'true' }),
    partKey ? h('span.hl-part', { title: e.appliesTo[0] + ' only' }, TH.icon(partKey, { size: 20 })) : null,
    h('span.hl-strip-text',
      h('span.hl-card-name', h('b', local), multi ? h('span.hl-count', { title: n + ' librarians' }, '×' + n) : null),
      (sub || e.treasure || (on && !multi && stalls[0].done)) ? h('small',
        sub ? h('span', sub) : null,
        e.treasure ? h('span.hl-treasure', 'treasure') : null,
        on && !multi && stalls[0].done ? h('span.hl-ok', 'locked') : null) : null));

    const add = on ? plusBtn({
      key: e.id, name: local, max: n >= 16,
      onAdd: () => {
        const ns = newStall();
        softUpdate((x) => { const b = x.books[e.id]; if (b) b.stalls.push(ns); }, { added: ns.id, focus: 'dup-' + e.id });
      },
    }) : null;

    if (!multi) {
      return h('li.hl-card-item', { 'data-book': e.id },
        h('div.hl-strip.hl-card' + (on ? '.is-on' : ''),
          cardRow('.hl-card-head', [toggle, on ? tag(stalls[0], 0) : null, add], tiers(0), null)));
    }
    // 2+ villagers: the one stripe is split into a column per villager (name + "+" once on the left, then one well per
    // villager: tiers on top, tag underneath, x on hover). No lines, the wells are the segments.
    const col = (st, i) => {
      const onDel = () => {
        if (hasProgress(st) && !confirm('This librarian has logged progress. Remove it anyway?')) return;
        const b0 = fresh();
        const rest = b0 ? b0.stalls.filter((s) => s.id !== st.id) : [];
        softUpdate((x) => {
          const b = x.books[e.id];
          if (!b) return;
          const lvs = b.stalls.filter((s) => s.id !== st.id).map((s) => stLv(b, s));
          b.stalls = b.stalls.filter((s) => s.id !== st.id);
          setLevels(b, lvs, e.maxLevel);
        }, { focus: rest.length > 1 ? 'rm-' + rest[Math.min(i, rest.length - 1)].id : 'dup-' + e.id });
      };
      return h('div.hl-vcol' + (st.done ? '.is-done' : '') + (justAdded === st.id ? '.is-new' : ''), { 'data-n': i },
        h('div.hl-vcol-top', tiers(i) || h('span.hl-vcol-max', 'max')),
        h('div.hl-vcol-bot', tag(st, i), delBtn({ key: st.id, label: `Remove ${local} ${i + 1} of ${n}`, onDel })));
    };
    return h('li.hl-card-item', { 'data-book': e.id },
      h('div.hl-strip.hl-card.is-on.is-multi.hl-cols' + (openCols.has(e.id) ? '.is-open' : ''),
        h('div.hl-cols-main', toggle, add),
        h('div.hl-cols-v', stalls.map(col), h('button.hl-vmore', { type: 'button', hidden: true, 'aria-label': 'Show all villagers',
          onclick: (ev) => { const c = ev.currentTarget.closest('.hl-cols'); if (openCols.has(e.id)) openCols.delete(e.id); else openCols.add(e.id); c.classList.toggle('is-open', openCols.has(e.id)); fitCols(); } }))));
  }

  /* ---- step 3: trades (strips) ---- */

  const SIDES = [
    { id: 'sell', title: 'Sell to villagers', hint: 'Items from your farms, turned into emeralds', from: 'item/iron_ingot', to: 'item/emerald' },
    { id: 'buy', title: 'Buy from villagers', hint: 'Spend emeralds on what you need', from: 'item/emerald', to: 'item/diamond_chestplate' },
  ];

  /** Books (left) and other villagers (right) in one step; stacked when the step is narrow. */
  function stepVillagers(state) {
    return h('div.hl-combo-wrap', h('div.hl-combo',
      h('section.hl-combo-col.hl-combo-books', { 'aria-label': 'Librarian books' }, h('h3.section-title.hl-sec-title', 'Librarians and books'), stepBooks(state)),
      h('section.hl-combo-col.hl-combo-trades', { 'aria-label': 'Other villagers' }, h('h3.section-title.hl-sec-title', 'Other villagers'), stepTrades(state))));
  }

  function stepTrades(state) {
    const hall = state.hall;
    const catalogKeys = new Set(CATALOG.map((c) => c.prof + '|' + c.purpose));
    const sideEl = (sd) => {
      const rows = CATALOG.filter((c) => c.dir === sd.id);
      const custom = hall.trades.filter((t) => !catalogKeys.has(t.prof + '|' + t.purpose) && dirOf(t) === sd.id);
      const count = hall.trades.filter((t) => dirOf(t) === sd.id).reduce((a, t) => a + t.target, 0);
      return h('section.hl-ts.hl-ts-' + sd.id, { 'aria-label': sd.title },
        h('div.hl-ts-head',
          h('span.hl-flow', { 'aria-hidden': 'true' }, TH.icon(sd.from, { size: 28 }), h('span.hl-flow-arrow'), TH.icon(sd.to, { size: 28 })),
          h('span.hl-group-title', h('h3', sd.title), h('small', sd.hint)),
          count ? h('span.hl-group-count', plural(count, 'villager')) : null),
        h('ul.hl-strips', rows.map((c) => tradeStrip(hall, c)), custom.map((t) => customTradeStrip(t))),
        h('div.hl-add-row', h('button.btn.small', { type: 'button', onclick: () => addCustomTrade(sd.id) }, '+ Custom trade')));
    };
    return h('div.hl-books', h('div.hl-groups', h('div.hl-sides', SIDES.map(sideEl))));
  }

  /** A category section plus its layout weight (rows), for groupColumns. */
  const groupEntry = (rows, el) => ({ w: rows + 1.5, el });
  /**
   * Category sections in two balanced columns (Books + Trades steps). The groups stay in catalog order and are split
   * once, at the point where both columns hold about the same number of rows, so DOM / tab order = reading order and
   * one stacked column (narrow content, see hall.css @container hl-groups) is still the original order.
   * Weights count catalog rows, not selections or copies, so pressing + never moves a group to the other column.
   */
  function groupColumns(groups) {
    const total = groups.reduce((a, g) => a + g.w, 0);
    let split = groups.length, acc = 0, best = Infinity;
    for (let i = 0; i <= groups.length; i++) {
      const diff = Math.abs(total - 2 * acc);
      if (diff < best) { best = diff; split = i; }
      if (i < groups.length) acc += groups[i].w;
    }
    return h('div.hl-groups',
      h('div.hl-gcols',
        h('div.hl-gcol', groups.slice(0, split).map((g) => g.el)),
        h('div.hl-gcol', groups.slice(split).map((g) => g.el))));
  }

  /** CSS-drawn plus sign for icon buttons. */
  const plusIco = () => h('span.hl-plus-ico', { 'aria-hidden': 'true' });

  /** Workstation icon + the item the villager trades (from the catalog), as one slot. */
  function tradeIcons(prof, purpose, size) {
    const c = CATALOG.find((x) => x.prof === prof.id && x.purpose === purpose);
    return h('span.hl-trade-ico' + (c && c.item ? '.has-item' : ''), { 'aria-hidden': 'true' },
      c && c.item ? TH.icon(c.item, { size: size || 34 }) : TH.icon.prof(prof.id, { size: size || 30 }),
      c && c.item ? h('span.hl-trade-item', TH.icon.prof(prof.id, { size: 14 })) : null);
  }

  /** Remove copy i of a trade: later copies move up one, keeping their lock state, canvas spot and pin. */
  function removeTradeCopy(x, id, i) {
    const tr = x.trades.find((y) => y.id === id);
    if (!tr) return;
    if (tr.target <= 1) { x.trades = x.trades.filter((y) => y.id !== id); return; }
    const tl = x.tradeLocked || (x.tradeLocked = {});
    const L = x.layout || {};
    const pos = L.pos || {};
    const pins = new Set(L.pinned || []);
    for (let j = i; j < tr.target - 1; j++) {
      const a = tradeKey(id, j), b = tradeKey(id, j + 1);
      if (tl[b]) tl[a] = true; else delete tl[a];
      if (pos[b]) pos[a] = pos[b]; else delete pos[a];
      if (pins.has(b)) pins.add(a); else pins.delete(a);
    }
    const last = tradeKey(id, tr.target - 1);
    delete tl[last]; delete pos[last]; pins.delete(last);
    if (L.pinned) L.pinned = Array.from(pins);
    tr.target -= 1;
  }

  /** Copies of a trade as compact chips (i/n · in hall · ×), under the card head; only with 2+ copies. */
  function tradeCopies(t, key, name) {
    const hall = TH.store.get().hall;
    const n = t.target;
    return h('div.hl-card-row.hl-copychips',
      h('div.hl-strip-main', Array.from({ length: n }, (_, i) => {
        const locked = tradeIsLocked(hall, t.id, i);
        return h('span.hl-copychip' + (locked ? '.is-done' : '') + (justAdded === t.id + ':' + i ? '.is-new' : ''),
          h('span.hl-idx', { 'aria-label': `${i + 1} of ${n}` }, `${i + 1}/${n}`),
          locked ? h('span.hl-ok', { title: 'Traded with: in your hall' }, 'in hall') : null,
          delBtn({
            key: key + '-' + i, label: `Remove ${name} ${i + 1} of ${n}`,
            onDel: () => {
              if (locked && !confirm('This villager is locked in your hall. Remove it anyway?')) return;
              softUpdate((x) => removeTradeCopy(x, t.id, i), { focus: n > 2 ? 'rm-' + key + '-' + Math.min(i, n - 2) : 'dup-' + key });
            },
          }));
      })),
      h('span.hl-strip-lv'), h('span.hl-card-act'));
  }

  const tradePlus = (t, key, name) => plusBtn({
    key, name, max: t.target >= 64,
    onAdd: () => softUpdate((x) => { const tr = x.trades.find((y) => y.id === t.id); if (tr) tr.target = clamp(tr.target + 1, 1, 64); },
      { added: t.id + ':' + t.target, focus: 'dup-' + key }),
  });

  function tradeStrip(hall, c) {
    const t = findTrade(hall, c.prof, c.purpose);
    const p = PROF[c.prof];
    const on = !!t;
    const key = 'tr-' + CATALOG.indexOf(c);
    const n = on ? t.target : 0;
    const multi = n > 1;
    const toggle = h('button.hl-card-toggle', {
      type: 'button', 'aria-pressed': String(on), 'data-focus': key, title: c.note, 'aria-label': c.purpose + (on ? ', selected' : ''),
      onclick: () => upd((x) => {
        if (on) x.trades = x.trades.filter((tr) => tr !== findTrade(x, c.prof, c.purpose));
        else x.trades.push({ id: uid('tr'), prof: c.prof, purpose: c.purpose, target: 1, group: c.group, dir: c.dir, note: c.note });
      }),
    },
    h('span.hl-tick', { 'aria-hidden': 'true' }),
    tradeIcons(p, c.purpose),
    h('span.hl-strip-text',
      h('span.hl-card-name', h('b', c.purpose), multi ? h('span.hl-count', { title: n + ' villagers' }, '×' + n) : null),
      h('small', h('span.hl-prof-dot', profName(p)), h('span', on && t.note ? t.note : c.note))));
    return h('li.hl-card-item', { 'data-trade': on ? t.id : null },
      h('div.hl-strip.hl-card.hl-strip-trade' + (on ? '.is-on' : '') + (multi ? '.is-multi' : ''),
        cardRow('.hl-card-head', [toggle, on ? tradePlus(t, key, c.purpose) : null],
          on && !multi && tradeIsLocked(hall, t.id, 0) ? h('span.hl-ok.hl-have', 'in hall') : null, null),
        multi ? tradeCopies(t, key, c.purpose) : null));
  }

  function customTradeStrip(t) {
    const p = profOf(t);
    const n = t.target;
    const key = 'ct-' + t.id;
    const name = t.purpose || 'custom trade';
    const set = (fn, opts) => upd((x) => { const tr = x.trades.find((y) => y.id === t.id); if (tr) fn(tr, x); }, opts);
    return h('li.hl-card-item', { 'data-trade': t.id },
      h('div.hl-strip.hl-card.hl-strip-trade.hl-strip-custom.is-on' + (n > 1 ? '.is-multi' : ''),
        cardRow('.hl-card-head.hl-custom-main', [
          TH.icon.prof(p.id, { size: 24, cls: 'hl-strip-icon' }),
          h('select.field', { 'aria-label': 'Profession', 'data-focus': 'cprof-' + t.id, onchange: (e) => set((tr) => { tr.prof = e.target.value; }) },
            D.professions.filter((x) => x.id !== 'librarian').map((x) => h('option', { value: x.id, selected: x.id === t.prof }, profName(x)))),
          h('input.field.hl-custom-purpose', {
            value: t.purpose, placeholder: dirOf(t) === 'sell' ? 'What do you sell? e.g. Glass → Emerald' : 'What do you buy? e.g. Emerald → Bell', 'data-focus': 'purpose-' + t.id, 'aria-label': 'Purpose',
            oninput: (e) => set((tr) => { tr.purpose = e.target.value; }, { silent: true }),
            onchange: () => TH.app.render(),
          })],
        n === 1 ? delBtn({ key: key + '-0', title: 'Remove this trade', label: `Remove ${name}`, onDel: () => upd((x) => removeTradeCopy(x, t.id, 0)) }) : null,
        tradePlus(t, key, name)),
        n > 1 ? tradeCopies(t, key, name) : null));
  }

  function addCustomTrade(dir) {
    const id = uid('tr');
    TH.app.pendingFocus = 'purpose-' + id;
    upd((x) => { x.trades.push({ id, prof: 'farmer', purpose: '', target: 1, group: 'other', dir: dir || 'buy', note: '' }); });
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

    // read-only cards (same look as the Books / Trades step cards, no controls)
    const tradeCard = (tr) => {
      const p = profOf(tr);
      return h('li.hl-card-item', h('div.hl-strip.hl-card.hl-strip-trade.is-ro',
        cardRow('.hl-card-head', [tradeIcons(p, tr.purpose, 22), h('span.hl-strip-text',
          h('span.hl-card-name', h('b', tr.purpose || profName(p)), tr.target > 1 ? h('span.hl-count', { title: tr.target + ' villagers' }, '×' + tr.target) : null),
          h('small', h('span.hl-prof-dot', profName(p)), tradeShort(tr) ? h('span', tradeShort(tr)) : null))])));
    };
    const sideCount = (id) => hall.trades.filter((tr) => dirOf(tr) === id).reduce((a, tr) => a + tr.target, 0);
    const sideBlock = (sd) => {
      const list = hall.trades.filter((tr) => dirOf(tr) === sd.id);
      return h('div.hl-rev-side',
        h('div.hl-ts-head', h('span.hl-flow', { 'aria-hidden': 'true' }, TH.icon(sd.from, { size: 24 }), h('span.hl-flow-arrow'), TH.icon(sd.to, { size: 24 })),
          h('span.hl-group-title', h('h3', sd.title)), list.length ? h('span.hl-group-count', plural(sideCount(sd.id), 'villager')) : null),
        list.length ? h('ul.hl-strips.hl-rev-cards', list.map(tradeCard)) : h('p.muted.hl-rev-none', sd.id === 'sell' ? 'Nothing sold yet.' : 'Nothing bought yet.'));
    };
    const bookCard = (id) => {
      const e = ENCH[id], b = hall.books[id], n = b.stalls.length;
      const lvCount = new Map();
      b.stalls.forEach((st) => { const lv = stLv(b, st); lvCount.set(lv, (lvCount.get(lv) || 0) + 1); });
      const tags = b.stalls.map((st) => st.label).filter(Boolean);
      return h('li.hl-card-item', h('div.hl-strip.hl-card.is-on.is-ro',
        cardRow('.hl-card-head', [h('span.hl-strip-text',
          h('span.hl-card-name', h('b', enchLocal(e)), n > 1 ? h('span.hl-count', { title: n + ' librarians' }, '×' + n) : null),
          tags.length ? h('small', h('span', tags.join(' · '))) : null)],
        e.maxLevel > 1 ? h('span.hl-lvpills', [...lvCount.entries()].sort((x, y) => y[0] - x[0]).map(([lv, k]) =>
          h('span.hl-lvpill', { title: enchLabel(e, lv) + (k > 1 ? ' ×' + k : '') }, lvlText(lv), lvCount.size > 1 && k > 1 ? h('small', '×' + k) : null))) : null)));
    };
    // books grouped by the item they are for, like the Books step
    const bookGroups = D.enchantCategories.map((cat) => {
      const ids = bookIds(hall).filter((id) => ENCH[id].category === cat.id);
      return ids.length ? h('section.hl-group', { 'aria-label': cat.name },
        h('div.hl-group-head.hl-rev-ghead',
          h('span.hl-group-items', { 'aria-hidden': 'true' }, (CAT_ITEMS[cat.id] || []).map((i) => TH.icon(i, { size: 22 }))),
          h('span.hl-group-title', h('h3', cat.name))),
        h('ul.hl-strips.hl-strips-2.hl-rev-cards', ids.map(bookCard))) : null;
    }).filter(Boolean);

    return h('div.hl-review.is-compact',
      // plain totals (like the sidebar) + the plan per workstation (workstation names: what you craft)
      h('section.panel.hl-review-card',
        h('div.hl-review-head', h('h3.section-title', 'Books'), h('span.hl-toolbar-info', libBooks(t.stalls, books.length)), h('span.spacer'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => goStep(1) }, 'Edit')),
        books.length ? h('div.hl-groups.hl-groups-stack', bookGroups) : h('p.muted', 'No books selected.')),
      h('section.panel.hl-review-card',
        h('div.hl-review-head', h('h3.section-title', `Other villagers (${t.trades})`), h('span.spacer'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => goStep(1) }, 'Edit')),
        hall.trades.length ? h('div.hl-groups', h('div.hl-sides', SIDES.map(sideBlock))) : h('p.muted', 'No other villagers.')),
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

    const editBtn = h('button.btn', { type: 'button', onclick: () => upd((x) => { x.setupDone = false; x.editing = true; x.step = 1; setSel(x.ui, []); }) }, '✎ Edit setup');
    const head = () => h('div.page-head.hl-page-head', h('h2', TITLE));

    if (!t.total) {
      root.append(
        head(),
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
      head(),
      h('div.hl-dash',
        renderMap(hall, pl, t),
        h('div.hl-col', renderProgress(t, line, preset, editBtn), renderSide(hall, pl))),
    );
    if (hall.check.open) root.append(renderCheck(hall));
    fitDash(root);
  }

  /** Pixel isometric cube that fills bottom to top (stepped layers, like stacking blocks). */
  /**
   * Progress block: a pixel-textured emerald-style block drawn isometrically on a canvas (texture generated in code, no
   * network). The empty part is a dark ghost of the block, the filled part is the textured block rising from the bottom.
   */
  const BLOCK_TEX = {};
  function blockTexture(accent) {
    if (BLOCK_TEX[accent]) return BLOCK_TEX[accent];
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d');
    const pal = ['#0b6e30', '#12913f', '#17b24d', '#26d062', '#5ff08f'];
    let seed = 11; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      let k = 2 + Math.floor(rnd() * 2);
      const diag = (i + j) % 8;
      if (diag === 3 || diag === 4) k = Math.min(4, k + 1);          // soft diagonal sheen like the real block
      if (i === 0 || j === 0) k = 4;                                   // lit rim (top-left)
      if (i === 15 || j === 15) k = 0;                                 // shadow rim (bottom-right)
      x.fillStyle = pal[k]; x.fillRect(i, j, 1, 1);
    }
    return (BLOCK_TEX[accent] = c);
  }

  function progressCube(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const STEPS = 8, lvl = total ? Math.round((done / total) * STEPS) : 0;
    const W = 112, H = 124, k = 3.5;                                   // k = screen px per texture px
    const dpr = 2;
    const cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr; cv.className = 'hl-cube'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', pct + '% locked in');
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tex = blockTexture('emerald');
    const ox = W / 2, oy = 8, hh = 16 * k;                              // top corner, vertical edge length
    const top = (dy) => ctx.setTransform(dpr * k, dpr * k * 0.5, -dpr * k, dpr * k * 0.5, dpr * ox, dpr * (oy + dy));
    const left = (dy) => ctx.setTransform(dpr * k, dpr * k * 0.5, 0, dpr * k, dpr * (ox - 16 * k), dpr * (oy + 8 * k + dy));
    const right = (dy) => ctx.setTransform(dpr * k, -dpr * k * 0.5, 0, dpr * k, dpr * ox, dpr * (oy + 16 * k + dy));
    const face = (set, dy, shade, alpha, clipPts) => {
      ctx.save();
      if (clipPts) { ctx.beginPath(); clipPts.forEach(([px, py], i) => (i ? ctx.lineTo(px * dpr, py * dpr) : ctx.moveTo(px * dpr, py * dpr))); ctx.closePath(); ctx.clip(); }
      set(dy); ctx.globalAlpha = alpha; ctx.drawImage(tex, 0, 0);
      if (shade) { ctx.fillStyle = 'rgba(0,0,0,' + shade + ')'; ctx.fillRect(0, 0, 16, 16); }
      ctx.restore();
    };
    // ghost block (empty part): the same texture, flat and dark
    ctx.save(); ctx.filter = 'grayscale(1) brightness(.35)';
    face(left, 0, 0.12, 0.55); face(right, 0, 0.3, 0.55); face(top, 0, 0, 0.7);
    ctx.restore();
    if (lvl > 0) {
      const d = hh * (1 - lvl / STEPS);                                 // how far the surface sits below the top
      const L = [[ox - 16 * k, oy + 8 * k + d], [ox, oy + 16 * k + d], [ox, oy + 32 * k], [ox - 16 * k, oy + 24 * k]];
      const R = [[ox, oy + 16 * k + d], [ox + 16 * k, oy + 8 * k + d], [ox + 16 * k, oy + 24 * k], [ox, oy + 32 * k]];
      face(left, 0, 0.12, 1, L); face(right, 0, 0.3, 1, R); face(top, d, 0, 1);
    }
    const txt = h('span.hl-cube-pct', pct + '%');
    return h('span.hl-cube-wrap', cv, txt);
  }

  /** Right column, top: overall progress as a cube + the two main actions. */
  function renderProgress(t, line, preset, editBtn) {
    return h('section.panel.hl-prog' + (t.done === t.total ? '.is-done' : ''), { 'aria-label': 'Overall progress' },
      h('div.hl-prog-main',
        progressCube(t.done, t.total),
        h('div.hl-prog-text',
          h('h3', `${t.done} / ${t.total} locked in`),
          h('p', line),
          preset ? h('span.chip', 'Based on ', preset.name) : null)),
      progressStats(t),
      h('div.hl-prog-actions', editBtn,
        t.stalls ? h('button.btn.primary', { type: 'button', 'data-focus': 'hero-check', onclick: () => openCheck(null) }, TH.icon('enchanted_book', { size: 18 }), 'Check an offer') : null));
  }

  /** Square outline whose stroke is traced clockwise from the top-left in proportion to frac (a neutral base outline underneath). */
  function progressSquare(frac) {
    const NS = 'http://www.w3.org/2000/svg', pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el('svg', { viewBox: '0 0 16 16', class: 'hl-psq', role: 'img', 'aria-label': pct + '%', focusable: 'false', 'shape-rendering': 'crispEdges' });
    const r = { x: 1, y: 1, width: 14, height: 14, pathLength: 100 };
    svg.append(el('rect', Object.assign({ class: 'hl-psq-base' }, r)));
    if (pct > 0) svg.append(el('rect', Object.assign({ class: 'hl-psq-fill', 'stroke-dasharray': pct + ' 100' }, r)));
    return svg;
  }

  /** One row of the progress block: indicator (or an icon / spacer), label, value. */
  function pstat(lead, label, value, frac) {
    return h('li.hl-pstat', frac == null ? h('span.hl-psq-gap', { 'aria-hidden': 'true' }, lead || null) : progressSquare(frac),
      h('span.hl-pstat-lbl', label), h('b', value));
  }

  function progressStats(t) {
    const f = (a, b) => (b ? a / b : 0);
    return h('ul.hl-pstats', { 'aria-label': 'Progress details' },
      pstat(null, 'Librarians', [`${t.locked} `, h('small', `/ ${t.stalls}`)], f(t.locked, t.stalls)),
      pstat(null, 'Other villagers', [`${t.have} `, h('small', `/ ${t.trades}`)], f(t.have, t.trades)),
      pstat(TH.icon('star', { size: 14 }), 'Perfect-price books', String(t.perfect), null),
      pstat(TH.icon('emerald', { size: 14 }), 'Emeralds above perfect', String(t.over), null));
  }

  /** Make the dashboard exactly fill the viewport below its own top edge (canvas fully visible, no page scroll). */
  function fitDash(root) {
    const apply = () => {
      const dash = root.querySelector('.hl-dash');
      if (!dash) return;
      const top = dash.getBoundingClientRect().top + (window.scrollY || 0);
      root.style.setProperty('--hl-dash-top', Math.round(top) + 'px');
    };
    apply();
    requestAnimationFrame(apply);
    if (!fitDash.bound) { fitDash.bound = true; window.addEventListener('resize', () => { const r = document.querySelector('.module-hall'); if (r) fitDash(r); }); }
  }

  /* ---- hall canvas (the layout editor itself lives in hall-canvas.js) ---- */

  let canvas = null;
  // what the side panel showed last render (slide-in only when it changes)
  let lastDetail = null;

  function villagerName(v) {
    if (v.kind === 'book') return enchLabel(v.ench, v.lv) + (v.stall.label ? ' (' + v.stall.label + ')' : '');
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
    const c = book ? null : catOf(v.prof.id, v.trade.purpose);
    return {
      name: book ? enchShort(v.ench) : profName(v.prof),
      item: c && c.item ? c.item : null,
      corner: book ? (v.ench.maxLevel > 1 ? lvlText(v.lv) : null) : (v.trade.target > 1 ? '#' + (v.n + 1) : null),
      tag: book && v.stall.label ? v.stall.label.charAt(0).toUpperCase() : null,
      paid: book && v.stall.done && v.stall.price != null ? v.stall.price : null,
      perfect: book ? minPrice(v.ench, v.lv) : null,
    };
  }

  /** Tile contents: marks (star / padlock / label tag), level or #n, icon, short name, price. */
  function tileBody(v, pinned) {
    const t = tileParts(v), st = status(v);
    const mark = st === 'perfect' ? h('span.hc-star', { title: 'Perfect price' }, '★')
      : st === 'locked' ? h('span.hc-lock', { title: 'Locked in' }) : null;
    const price = t.perfect == null ? null
      : t.paid != null ? h('span.hc-price.is-paid', { title: 'You paid ' + t.paid }, t.paid)
        : h('span.hc-price', { title: 'Perfect price' }, t.perfect);
    return [
      mark || t.tag ? h('span.hc-marks', mark, t.tag ? h('span.hc-tag', { title: v.stall.label }, t.tag) : null) : null,
      t.corner ? h('span.hc-lv', t.corner) : null,
      pinned ? h('span.hc-pin', { title: 'Position pinned' }, TH.hallCanvas.pinIcon(11)) : null,
      h('span.hc-ico', villagerIcon(v, 28), t.item ? h('span.hc-item', TH.icon(t.item, { size: 13 })) : null),
      h('span.hc-name', t.name),
      price,
    ];
  }

  function tileLabel(v, pinned) {
    const st = status(v);
    const extra = v.kind === 'book' && v.stall.done && v.stall.price != null ? `, ${v.stall.price} emeralds` : '';
    const who = v.kind === 'book' ? profName(PROF.librarian) : profName(v.prof);
    return `${who}: ${villagerName(v)} — ${STATUS_LABEL[st]}${extra}${pinned ? ', position pinned' : ''}`;
  }

  /** Hover tooltip: books "Unbreaking III" / "Librarian · perfect 11 · locked in"; villagers "Farmer — Pumpkins / Melons → Emerald" / state. */
  function tileTip(v, pinned) {
    const st = status(v);
    const state = [STATUS_LABEL[st]];
    if (v.kind === 'book') {
      if (v.stall.done && v.stall.price != null) state.push('paid ' + v.stall.price);
      if (pinned) state.push('pinned');
      return {
        title: enchLabel(v.ench, v.lv) + (v.stall.label ? ' (' + v.stall.label + ')' : ''),
        sub: [profName(PROF.librarian), 'perfect ' + minPrice(v.ench, v.lv)].concat(state).join(' · '),
      };
    }
    if (pinned) state.push('pinned');
    const t = v.trade;
    return {
      title: profName(v.prof) + (t.purpose ? ' — ' + t.purpose : ''), // e.g. "Farmer — Pumpkins / Melons → Emerald"
      sub: (t.target > 1 ? `#${v.n + 1} of ${t.target} · ` : '') + state.join(' · '),
    };
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
      if (ch.pos) { x.layout.pos = ch.pos; x.layout.auto = false; } // the user arranged it: never re-shape it silently
      if (ch.sel) setSel(x.ui, ch.sel);
      if (ch.view) x.ui.view = ch.view;
    }, { silent: !!ch.view && !ch.pos && !ch.sel });
  }

  function ensureCanvas() {
    if (!canvas) {
      canvas = TH.hallCanvas.mount(null, {
        onChange: onCanvasChange, onNotify: toast,
        onPin: (keys) => { const pins = pinnedSet(get()); setPinned(keys, keys.some((k) => !pins.has(k))); },
        // phones: the details sheet is fixed over the lower part of the page; tell the canvas how much of it is covered
        getInset: (r) => {
          const sheet = document.querySelector('.hl-detail');
          return sheet && getComputedStyle(sheet).position === 'fixed' ? Math.max(0, r.bottom - sheet.getBoundingClientRect().top) : 0;
        },
      });
    }
    return canvas;
  }

  const HINT = 'Arrange villagers like your real build: drag them anywhere, scroll to pan, Ctrl + scroll to zoom. Press ? for all shortcuts.';

  function renderMap(hall, pl, t) {
    const keys = selKeys(hall, pl);
    const cv = ensureCanvas();
    const pins = pinnedSet(hall);
    const items = autoOrder(pl.list).map((v) => {
      const t = tileParts(v), st = status(v), pinned = pins.has(v.key);
      return {
        key: v.key, status: st, label: tileLabel(v, pinned), color: v.kind === 'book' ? PROF.librarian.color : v.prof.color,
        pinned, tip: tileTip(v, pinned),
        sig: [I18.lang, st, t.name, t.item, t.corner, t.tag, t.paid, t.perfect, pinned ? 'p' : ''].join('|'),
        body: () => tileBody(v, pinned),
      };
    });
    cv.update({ items, selected: keys, pos: hall.layout.pos, view: hall.ui.view });

    const legend = h('ul.hl-legend', { 'aria-label': 'Legend' },
      ['needed', 'locked', 'perfect'].map((k) => h('li', h('i.hl-sw.is-' + k, { 'aria-hidden': 'true' }), STATUS_LABEL[k])),
      h('li', h('i.hl-sw.is-selected', { 'aria-hidden': 'true' }), 'selected'));

    return h('section.panel.hl-map' + (keys.length ? '.has-selection' : ''), { 'aria-label': 'Hall layout' },
      h('div.hl-map-head',
        h('div.hl-map-title', h('h3', 'Your hall'), h('span.hl-map-count', plural(pl.list.length, 'villager')), legend,
          h('p.hl-hint', { title: HINT }, HINT))),
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

  /** Pinned villager keys (position fixed on the canvas), only those that still exist. */
  const pinnedSet = (hall) => new Set((hall.layout && hall.layout.pinned) || []);
  function setPinned(keys, on) {
    let n = 0;
    upd((x) => {
      const set = pinnedSet(x);
      for (const k of keys) { if (on !== set.has(k)) { n++; if (on) set.add(k); else set.delete(k); } }
      x.layout.pinned = Array.from(set);
    });
    toast(n ? `${on ? 'Pinned' : 'Unpinned'} ${plural(n, 'villager')}` : 'Nothing to change');
  }

  /** Bulk lock / unlock: librarians get their lock ticked, other villagers get their own tile locked (exactly that tile). */
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
          const tl = x.tradeLocked || (x.tradeLocked = {});
          if (!!tl[k] === on) continue;
          if (on) tl[k] = true; else delete tl[k];
          n++;
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
    if (!canvas.swap(keys[0], keys[1])) return;
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
      const min = minPrice(v.ench, v.lv);
      perfectSum += min;
      if (!v.stall.done) continue;
      if (v.stall.price == null) { noPrice++; continue; }
      paid += v.stall.price; over += Math.max(0, v.stall.price - min);
    }
    const byBook = new Map(), byTrade = new Map();
    for (const v of vs) {
      if (v.kind === 'book') {
        const id = v.ench.id + ':' + v.lv;
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
    const pins = pinnedSet(hall), pinnedN = keys.filter((k) => pins.has(k)).length;
    const sec = (title, n, body) => h('section.hl-ov-sec', h('h4.hl-side-h', title, h('em', n)), body);

    return h('section.panel.hl-detail.hl-multi' + (fresh ? '.enter' : ''), { role: 'region', 'aria-label': 'Selection overview' },
      h('div.hl-detail-head',
        h('span.hl-detail-icon.hl-multi-icon', { 'aria-hidden': 'true' }, h('b', vs.length)),
        h('div', h('h3', `${vs.length} villagers selected`),
          h('div.hl-detail-sub', plural(books.length, 'librarian'), ' · ', plural(vs.length - books.length, 'other villager'))),
        h('button.x-btn.hl-detail-close', { type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', 'data-focus': 'detail-close', onclick: clearSelection }, '✕')),
      h('p.hl-hint.hl-lock-why', LOCK_WHY),
      h('p.hl-hint.hl-lock-why', PIN_WHY),
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
        enchLabel(r.v.ench, r.v.lv),
        `${r.done} of ${r.n} locked · perfect ${minPrice(r.v.ench, r.v.lv)}`, r)))) : null,
      byTrade.size ? sec('Villagers', byTrade.size, h('ul.hl-ov-list', Array.from(byTrade.values()).map((r) => row(
        TH.icon.prof(r.v.prof.id, { size: 22 }),
        r.v.trade.purpose || profName(r.v.prof),
        `${profName(r.v.prof)}${tradeShort(r.v.trade) ? ' · ' + tradeShort(r.v.trade) : ''} · ${r.done} of ${r.n} in your hall`, r)))) : null,
      h('div.hl-row-btns.hl-ov-actions',
        h('button.btn.small' + (cnt.needed >= lockedAll ? '.primary' : ''), { type: 'button', disabled: cnt.needed === 0, onclick: () => bulkLock(keys, true) }, cnt.needed && lockedAll ? `Lock ${cnt.needed} more` : 'Lock trades'),
        h('button.btn.small', { type: 'button', disabled: lockedAll === 0, onclick: () => bulkLock(keys, false) }, lockedAll && cnt.needed ? `Unlock ${lockedAll}` : 'Unlock trades'),
        h('button.btn.small', { type: 'button', disabled: pinnedN === keys.length, 'data-focus': 'pin-all', onclick: () => setPinned(keys, true) }, TH.hallCanvas.pinIcon(13), pinnedN ? `Pin ${keys.length - pinnedN} more` : 'Pin all'),
        h('button.btn.small', { type: 'button', disabled: pinnedN === 0, onclick: () => setPinned(keys, false) }, TH.hallCanvas.pinIcon(13), pinnedN && pinnedN < keys.length ? `Unpin ${pinnedN}` : 'Unpin all'),
        keys.length === 2 ? h('button.btn.small', { type: 'button', 'data-focus': 'swap', disabled: pinnedN > 0, title: pinnedN ? 'Pinned villagers can’t be swapped' : null, onclick: () => swapTwo(keys) }, '⇄ Swap') : null,
        h('button.btn.small.ghost', { type: 'button', disabled: true, title: 'Select a single librarian to check an offer' }, 'Check offer'),
        h('button.btn.small.ghost', { type: 'button', onclick: clearSelection }, 'Clear selection')),
      h('p.hl-hint.hl-detail-hint', 'Drag any selected villager to move them all together (pinned ones stay put). Ctrl/⌘-click adds or removes one. Click empty canvas to close.'));
  }

  function renderDetail(hall, pl, v, fresh) {
    const pos = pl.posOf[v.key];
    const where = pos ? posLabel(pos) : 'not placed';
    const close = h('button.x-btn.hl-detail-close', {
      type: 'button', 'aria-label': 'Close details', title: 'Close (Esc)', 'data-focus': 'detail-close',
      onclick: () => upd((x) => { setSel(x.ui, []); }),
    }, '✕');
    const isLocked = status(v) !== 'needed';
    const isPinned = pinnedSet(hall).has(v.key);
    const lockRow = h('div.hl-lockrows',
      h('div.hl-lockrow',
        h('button.btn.small' + (isLocked ? '' : '.primary'), { type: 'button', 'data-focus': 'lock-btn', onclick: () => { if (!isLocked && v.kind === 'book' && v.stall.price == null) TH.app.pendingFocus = 'price-' + v.stall.id; bulkLock([v.key], !isLocked); } },
          isLocked ? 'Unlock trade' : 'Lock trade'),
        h('span.hl-lock-why', LOCK_WHY + (v.kind === 'book' ? ' You can log the price below.' : ''))),
      h('div.hl-lockrow',
        h('button.btn.small' + (isPinned ? '.on' : ''), { type: 'button', 'aria-pressed': String(isPinned), 'data-focus': 'pin-btn', onclick: () => setPinned([v.key], !isPinned) },
          TH.hallCanvas.pinIcon(13), isPinned ? 'Unpin' : 'Pin'),
        h('span.hl-lock-why', PIN_WHY)));
    const moveHint = h('p.hl-hint.hl-detail-hint', isPinned ? 'Pinned: it stays where it is until you unpin it. Click empty canvas to close.' : 'Drag it anywhere to move it, or onto another villager to swap. Click empty canvas to close.');
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
            h('label.hl-field.hl-grow', h('span.hl-field-label', 'Note'),
              h('input.field', {
                value: t.note || '', placeholder: 'Perfect roll, location…', 'data-focus': 'tnote-' + t.id,
                oninput: (e) => set((tr) => { tr.note = e.target.value; }, { silent: true }),
              }))),
          h('details.hl-keytrades', { open: true }, h('summary', `Notable ${profName(p).toLowerCase()} trades`),
            h('ul', p.keyTrades.map((k) => h('li', h('span.faint', k.level), ` ${k.give} → ${k.get}`)))),
        ]);
    }

    const e = v.ench, s = v.stall, lv = v.lv;
    const range = D.bookPrice(e, lv);
    const setStall = (fn, opts) => upd((x) => { const f = findStall(x, s.id); if (f) fn(f.stall, f.book); }, opts);
    const pill = tierPill(e, lv, s.price);
    return wrap(null, 'Librarian details', TH.icon('enchanted_book', { size: 32, glint: status(v) === 'perfect' }),
      [enchLabel(e, lv), s.label ? h('span.chip', s.label) : null],
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
                  const tier = D.priceTier(e, lv, val);
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
        book: (a, b) => byLocale(enchLabel(a.ench, a.lv), enchLabel(b.ench, b.lv)) || bType(a, b),
        trade: (a, b) => byLocale(a.purpose || profName(profOf(a)), b.purpose || profName(profOf(b))) || tType(a, b),
      };
    }
    if (sort === 'pos') {
      return { book: (a, b) => (posRank(a.pos) - posRank(b.pos)) || bType(a, b), trade: (a, b) => (tPos(a) - tPos(b)) || tType(a, b) };
    }
    if (sort === 'price') {
      return { book: (a, b) => (minPrice(a.ench, a.lv) - minPrice(b.ench, b.lv)) || bType(a, b), trade: tType };
    }
    return { book: bType, trade: tType };
  }

  function renderNext(hall, pl) {
    const sort = SORT_IDS.includes(hall.ui.nextSort) ? hall.ui.nextSort : 'type';
    const cmp = sorters(sort, pl);
    const stalls = stallsInHallOrder(hall);
    const needed = stalls.filter((v) => !v.stall.done).sort(cmp.book);
    const improve = stalls.filter((v) => v.stall.done && v.stall.price != null && v.stall.price > minPrice(v.ench, v.lv)).sort(cmp.book);
    const noPrice = stalls.filter((v) => v.stall.done && v.stall.price == null).sort(cmp.book);
    const toGet = hall.trades.filter((t) => haveOf(hall, t) < t.target).slice().sort(cmp.trade);
    const profs = profCounts(hall);
    const selectCell = (key) => {
      upd((x) => { setSel(x.ui, [key]); });
      if (canvas) canvas.reveal(key);
    };
    const stallTitle = (v) => [h('b', enchLabel(v.ench, v.lv)), v.stall.label ? h('small', v.stall.label) : null];

    const group = (title, n, items, empty) => h('section.hl-next-group',
      h('h4', title, h('span.hl-badge.is-static', n)),
      n ? h('ul.hl-strips.hl-strips-flat', items) : h('p.hl-done-line', '✓ ', empty));

    const row = (v, sub, action, onMain, title) => h('li.hl-strip.hl-strip-next',
      h('button.hl-strip-main', { type: 'button', onclick: onMain, title, 'data-focus': 'next-' + v.key },
        TH.icon('enchanted_book', { size: 20, cls: 'hl-strip-icon' }),
        h('span.hl-strip-text', h('span.hl-strip-title', stallTitle(v)), sub && sub.length ? h('small', sub) : null)),
      action);
    const sortCtl = h('div.hl-sort',
      h('span.hl-field-label', { id: 'hl-sort-label' }, 'Sort'),
      h('div.seg.hl-seg', { role: 'group', 'aria-labelledby': 'hl-sort-label' },
        SORTS.map(([id, label]) => h('button' + (sort === id ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(sort === id), 'data-focus': 'sort-' + id,
          onclick: () => upd((x) => { x.ui.nextSort = id; }),
        }, label))));

    const panel = h('div.panel.hl-next-panel', { role: 'region', 'aria-label': 'Next up' },
      h('div.hl-next-head', h('h3', 'Next up'), h('p.hl-hint', 'What’s left to do. Tap a row to find it on the canvas and open its details.')),
      sortCtl,
      group('Still needed', needed.length, needed.map((v) => row(v,
        [v.book.stalls.length > 1 ? `${v.idx + 1} of ${v.book.stalls.length}` : ''].filter(Boolean),
        null, () => selectCell(v.key), 'Open details')),
        'All librarians locked in'),
      improve.length || noPrice.length ? group('Could improve', improve.length + noPrice.length,
        improve.map((v) => row(v,
          [cost(v.stall.price, 'is-old'), '→', cost(minPrice(v.ench, v.lv), 'is-new'), `save ${v.stall.price - minPrice(v.ench, v.lv)}`],
          null, () => selectCell(v.key), 'Open details')).concat(
          noPrice.map((v) => row(v, 'No price logged — tap to add it', null, () => selectCell(v.key), 'Log the price'))),
        '') : null,
      group('Villagers to get', toGet.reduce((a, t) => a + t.target - haveOf(hall, t), 0), toGet.map((t) => h('li.hl-strip.hl-strip-next',
        h('div.hl-strip-main',
          TH.icon.prof(profOf(t).id, { size: 20, cls: 'hl-strip-icon' }),
          h('span.hl-strip-text', h('b', profName(profOf(t)), tradeShort(t) ? ' · ' + tradeShort(t) : ''), h('small', t.purpose ? t.purpose + ' · ' : '', h('b', haveOf(hall, t)), ' / ', t.target))),
        h('button.btn.small', {
          type: 'button', 'aria-label': `Got one more ${profName(profOf(t))} (${t.purpose})`, 'data-focus': 'plus-' + t.id,
          onclick: () => upd((x) => { const tr = x.trades.find((y) => y.id === t.id); if (!tr) return; const tl = x.tradeLocked || (x.tradeLocked = {}); for (let i = 0; i < tr.target; i++) if (!tl[tradeKey(tr.id, i)]) { tl[tradeKey(tr.id, i)] = true; break; } }),
        }, '+1'))),
        'Every other villager is in'),
      h('section.hl-next-group',
        h('h4', 'Workstations to place'),
        h('ul.hl-strips.hl-strips-flat', profs.map((r) => {
          const left = r.target - r.have;
          return h('li.hl-strip.hl-strip-ro.hl-strip-next',
            h('span.hl-strip-main',
              TH.icon.prof(r.prof.id, { size: 20, cls: 'hl-strip-icon' }),
              h('span.hl-strip-text', h('b', wsName(r.prof)), h('small', profName(r.prof)))),
            h('span.hl-ws-count', h('b', '×' + r.target), left ? h('span.faint', `${left} to go`) : h('span.hl-ok', 'done')));
        }))));
    return panel;
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

  /** Old model: trade.have = N  ->  the first N tiles of that trade are locked (hall.tradeLocked). */
  function migrateTradeLocks(hall) {
    if (!hall.tradeLocked || typeof hall.tradeLocked !== 'object') hall.tradeLocked = {};
    for (const tr of hall.trades || []) {
      if (tr.have != null) {
        const n = Math.min(Math.max(0, tr.have | 0), tr.target || 1);
        for (let i = 0; i < n; i++) hall.tradeLocked[tradeKey(tr.id, i)] = true;
        delete tr.have;
      }
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
    watchCols(root);
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

  TH.hall = { bookOffers, applyPreset, canvasApi: () => canvas, totals: (state) => totals((state || TH.store.get()).hall), catalog: CATALOG };

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
      for (const [id, b] of Object.entries(hall.books || {}).concat(Object.entries(hall.archive || {}))) {
        (b && b.stalls || []).forEach((st) => { delete st.rolls; delete st.count; delete st.session; delete st.target; if (typeof st.label !== 'string') st.label = ''; });
        // per-copy tiers (Oct 2026): older saves have none (= book.level); drop invalid / redundant overrides
        if (b && ENCH[id]) normLevels(b, ENCH[id].maxLevel);
      }
      if (!hall.ui.expanded || typeof hall.ui.expanded !== 'object') hall.ui.expanded = {};
      migrateLayout(hall);
      hall.archive = hall.archive || {};
      if (!Array.isArray(s.customPresets)) s.customPresets = [];
      migrate(s);
      if (!hall.stepsV2) { hall.stepsV2 = true; if (hall.step >= 2) hall.step -= 1; }
      migrateTradeLocks(hall);
      if (hall.setupDone) placeNew(hall);
      store.update(() => {}, { silent: true }); // persist migration / defaults
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onDocClick, true);
      window.addEventListener('hashchange', () => document.body.classList.remove('hl-noscroll'));
      trackTopbar();
      window.addEventListener('scroll', queueFitSide, { passive: true });
      window.addEventListener('resize', queueFitSide);
      if (document.fonts) document.fonts.ready.then(queueFitSide);
    },
    badge(state) {
      const t = totals(state.hall);
      return t.total ? `${t.done}/${t.total}` : '';
    },
    render,
  });
})();
