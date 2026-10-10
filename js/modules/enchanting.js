/**
 * Enchanting module — item picker, enchant selection and optimal anvil order.
 *
 * state.enchanting = {
 *   item: 'sword', material: 'diamond',  // material = picked material row (plain items ignore it)
 *   existing: { [enchId]: level },      // enchantments already on the item
 *   uses: 0,                            // prior anvil uses (penalty 2^n − 1)
 *   selected: { [enchId]: level },      // books to apply (one book per enchant)
 *   loadout: null,                      // id of the last applied loadout (for reasons)
 *   gearId: null,                       // saved gear currently loaded
 *   gear: [{ id, name, item, material, enchants: {}, uses, updated }],
 *   saveName: '', renaming: null, renameText: '',
 *
 *   mode: 'single' | 'plan',            // "Single item" editor or "My plan" view
 *   planEditing: null,                  // id of the plan entry the editor is linked to
 *   plan: [{                            // the enchanting planner (several items, one shopping list)
 *     id, item, material,               // material = effective material ('plain' for bows etc.)
 *     existing: {}, uses: 0,            // the item as it is now
 *     selected: { [enchId]: level },    // books to apply
 *     upgrade: false,                   // netherite only: "Upgrading from diamond"
 *     gearId: null,                     // saved gear it came from (updated on "Mark item done")
 *     ticks: ['s', 'n1', 'n2', …],      // ticked to-do rows: 's' = smithing upgrade, 'n<step>' = anvil step
 *     done: false, added: timestamp,
 *   }],
 *   planGot: { 'mat:netherite_ingot': 1 }, // obtained ticks for base materials = count needed when ticked
 *   booksOwned: { 'mending:1': 1 },    // books in hand per enchant:level (spare ones are kept, never deleted)
 * }
 */

/* ======================================================================
 * TH.anvil — pure Java Edition anvil optimizer (no DOM; testable in Node).
 * ====================================================================== */
window.TH = window.TH || {};
TH.anvil = (function () {
  const D = TH.data;
  const multipliers = D.anvilMultipliers;
  const MAX_COST = 39; // Survival: 40+ shows "Too Expensive!"
  const byId = {};
  D.enchantments.forEach((e) => { byId[e.id] = e; });

  const penalty = (uses) => Math.pow(2, uses) - 1;
  const bookMult = (id) => (multipliers[id] ? multipliers[id].book : 1);
  const itemMult = (id) => (multipliers[id] ? multipliers[id].item : 1);
  const maxLevel = (id) => (byId[id] ? byId[id].maxLevel : 1);
  const xp = (lv) => D.xpForLevel(lv);

  function conflicts(a, b) {
    if (a === b) return false;
    const ea = byId[a], eb = byId[b];
    return !!((ea && ea.exclusiveWith.includes(b)) || (eb && eb.exclusiveWith.includes(a)));
  }

  /** Level that results when a book of `level` lands on something that has `cur`. */
  function mergedLevel(id, cur, level) {
    if (!cur) return level;
    if (cur === level) return Math.min(maxLevel(id), level + 1);
    return Math.max(cur, level);
  }

  const better = (a, b) => !b || a.lv < b.lv || (a.lv === b.lv && a.xp < b.xp);
  const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

  /**
   * Find the cheapest anvil order.
   * @param {{enchants?:Object<string,number>, uses?:number}} itemState  the target item
   * @param {{id:string, level:number}[]} books  one enchanted book per enchantment
   * @param {{maxCost?:number}} [opts]  maxCost: highest allowed single step (default 39)
   * @returns plan object (see bottom of function)
   */
  function plan(itemState, books, opts) {
    opts = opts || {};
    const maxCost = opts.maxCost != null ? opts.maxCost : MAX_COST;
    const start = { enchants: Object.assign({}, (itemState && itemState.enchants) || {}), uses: (itemState && itemState.uses) || 0 };

    // ---- 1. decide which books are actually needed ----
    const used = [], skipped = [], notes = [];
    for (const b of books || []) {
      const level = Math.max(1, Math.min(b.level || 1, maxLevel(b.id)));
      const cur = start.enchants[b.id] || 0;
      if (cur >= level) { skipped.push({ id: b.id, level, reason: 'already', has: cur }); continue; }
      const onItem = Object.keys(start.enchants).find((e) => conflicts(e, b.id));
      if (onItem) { skipped.push({ id: b.id, level, reason: 'conflict', with: onItem }); continue; }
      const inBooks = used.find((u) => conflicts(u.id, b.id) || u.id === b.id);
      if (inBooks) { skipped.push({ id: b.id, level, reason: inBooks.id === b.id ? 'duplicate' : 'conflict', with: inBooks.id }); continue; }
      if (cur && cur === level - 1) notes.push({ id: b.id, level, cur, text: 'equal-level' });
      used.push({ id: b.id, level, cur });
    }
    const n = used.length;
    if (n > 14) throw new Error('Too many books (max 14)');

    const result = {
      ok: true, steps: [], totalLevels: 0, totalXP: 0, maxStep: 0,
      start, final: { enchants: Object.assign({}, start.enchants), uses: start.uses },
      books: used.map((u) => ({ id: u.id, level: u.level })), skipped, notes, naive: null, partial: null, reason: null,
    };
    if (!n) return result;

    // value of each book as a sacrifice: onto another book / onto the item
    const vBook = used.map((u) => u.level * bookMult(u.id));
    const vItem = used.map((u) => mergedLevel(u.id, u.cur, u.level) * bookMult(u.id));
    const FULL = (1 << n) - 1;
    const sumB = new Array(FULL + 1).fill(0), sumI = new Array(FULL + 1).fill(0);
    for (let m = 1; m <= FULL; m++) {
      const low = m & -m, i = 31 - Math.clz32(low);
      sumB[m] = sumB[m ^ low] + vBook[i];
      sumI[m] = sumI[m ^ low] + vItem[i];
    }

    // ---- 2. DP over book subsets: best way to pre-merge a set of books, per anvil-use count ----
    // bookDP[mask] = Map(uses -> {lv, xp, A, ua, B, ub, cost})
    const bookDP = new Array(FULL + 1);
    for (let m = 1; m <= FULL; m++) {
      const cell = new Map();
      if ((m & (m - 1)) === 0) { cell.set(0, { lv: 0, xp: 0 }); bookDP[m] = cell; continue; }
      for (let A = (m - 1) & m; A > 0; A = (A - 1) & m) {
        const B = m ^ A;
        const dA = bookDP[A], dB = bookDP[B];
        for (const [ua, ea] of dA) {
          for (const [ub, eb] of dB) {
            const cost = penalty(ua) + penalty(ub) + sumB[B];
            if (cost > maxCost) continue;
            const u = Math.max(ua, ub) + 1;
            const cand = { lv: ea.lv + eb.lv + cost, xp: ea.xp + eb.xp + xp(cost), A, ua, B, ub, cost };
            if (better(cand, cell.get(u))) cell.set(u, cand);
          }
        }
      }
      bookDP[m] = cell;
    }

    // ---- 3. DP over the item: item(T) = item(A) + bookstack(B), item always on the left ----
    const itemDP = new Array(FULL + 1);
    itemDP[0] = new Map([[start.uses, { lv: 0, xp: 0 }]]);
    for (let T = 1; T <= FULL; T++) {
      const cell = new Map();
      for (let B = T; B > 0; B = (B - 1) & T) {
        const A = T ^ B;
        for (const [ua, ea] of itemDP[A]) {
          for (const [ub, eb] of bookDP[B]) {
            const cost = penalty(ua) + penalty(ub) + sumI[B];
            if (cost > maxCost) continue;
            const u = Math.max(ua, ub) + 1;
            const cand = { lv: ea.lv + eb.lv + cost, xp: ea.xp + eb.xp + xp(cost), A, ua, B, ub, cost };
            if (better(cand, cell.get(u))) cell.set(u, cand);
          }
        }
      }
      itemDP[T] = cell;
    }

    function pick(cell) {
      let best = null, bu = -1;
      for (const [u, e] of cell) {
        if (!best || better(e, best) || (e.lv === best.lv && e.xp === best.xp && u < bu)) { best = e; bu = u; }
      }
      return best ? { e: best, u: bu } : null;
    }

    // ---- 4. naive comparison: one book at a time, in the given order ----
    result.naive = naivePlan(start, used, maxCost);

    let mask = FULL;
    let choice = pick(itemDP[FULL]);
    if (!choice) {
      result.ok = false;
      result.reason = start.uses && penalty(start.uses) > maxCost ? 'penalty' : 'expensive';
      // best achievable subset: most books, then fewest levels
      let bestT = -1, bestC = null;
      for (let T = 1; T < FULL; T++) {
        const c = pick(itemDP[T]);
        if (!c) continue;
        if (bestT < 0 || popcount(T) > popcount(bestT) || (popcount(T) === popcount(bestT) && better(c.e, bestC.e))) { bestT = T; bestC = c; }
      }
      if (bestT < 0) return result;
      result.partial = {
        books: used.filter((_, i) => bestT & (1 << i)).map((u) => ({ id: u.id, level: u.level })),
        dropped: used.filter((_, i) => !(bestT & (1 << i))).map((u) => ({ id: u.id, level: u.level })),
      };
      mask = bestT; choice = bestC;
    }

    // ---- 5. rebuild the merge tree into readable steps ----
    const bookSteps = [], itemSteps = [];
    const enchOf = (m) => used.filter((_, i) => m & (1 << i)).map((u) => ({ id: u.id, level: u.level }));

    function buildBook(m, u) {
      if ((m & (m - 1)) === 0) return { kind: 'book', enchants: enchOf(m), uses: 0, from: null };
      const e = bookDP[m].get(u);
      const left = buildBook(e.A, e.ua), right = buildBook(e.B, e.ub);
      const step = { target: left, sacrifice: right, cost: e.cost, penalty: penalty(e.ua) + penalty(e.ub), enchantCost: sumB[e.B], resultUses: u };
      bookSteps.push(step);
      return { kind: 'book', enchants: enchOf(m), uses: u, from: step };
    }
    function buildItem(T, u) {
      if (T === 0) return { kind: 'item', enchants: Object.keys(start.enchants).map((id) => ({ id, level: start.enchants[id] })), uses: start.uses, from: null };
      const e = itemDP[T].get(u);
      const left = buildItem(e.A, e.ua), right = buildBook(e.B, e.ub);
      const step = { target: left, sacrifice: right, cost: e.cost, penalty: penalty(e.ua) + penalty(e.ub), enchantCost: sumI[e.B], resultUses: u };
      itemSteps.push(step);
      const ench = Object.assign({}, start.enchants);
      used.forEach((b, i) => { if (T & (1 << i)) ench[b.id] = mergedLevel(b.id, b.cur, b.level); });
      return { kind: 'item', enchants: Object.keys(ench).map((id) => ({ id, level: ench[id] })), uses: u, from: step };
    }
    const finalNode = buildItem(mask, choice.u);

    const steps = bookSteps.concat(itemSteps);
    steps.forEach((s, i) => { s.n = i + 1; });
    let run = 0;
    const strip = (node) => ({ kind: node.kind, enchants: node.enchants, uses: node.uses, fromStep: node.from ? node.from.n : null });
    result.steps = steps.map((s) => {
      run += s.cost;
      return {
        n: s.n, target: strip(s.target), sacrifice: strip(s.sacrifice), cost: s.cost,
        penalty: s.penalty, enchantCost: s.enchantCost, resultUses: s.resultUses,
        xp: xp(s.cost), running: run, tooExpensive: s.cost > maxCost,
      };
    });
    result.totalLevels = choice.e.lv;
    result.totalXP = choice.e.xp;
    result.maxStep = steps.reduce((m, s) => Math.max(m, s.cost), 0);
    result.final = {
      enchants: finalNode.enchants.reduce((o, x) => { o[x.id] = x.level; return o; }, {}),
      uses: choice.u,
    };
    return result;
  }

  function naivePlan(start, used, maxCost) {
    let uses = start.uses, total = 0, totalXP = 0, firstBad = null;
    const steps = used.map((b, i) => {
      const cost = penalty(uses) + mergedLevel(b.id, b.cur, b.level) * bookMult(b.id);
      uses += 1;
      total += cost; totalXP += xp(cost);
      if (cost > maxCost && firstBad == null) firstBad = i + 1;
      return { id: b.id, level: b.level, cost };
    });
    return { steps, totalLevels: total, totalXP, tooExpensiveAt: firstBad, ok: firstBad == null, finalUses: uses };
  }

  return { plan, multipliers, penalty, bookMult, itemMult, conflicts, mergedLevel, MAX_COST };
})();

/* ======================================================================
 * UI module
 * ====================================================================== */
(function () {
  if (!TH.app || !TH.util) return; // loaded in a test sandbox
  const { h, emerald, stepper, toast, uid, clamp } = TH.util;
  const D = TH.data;
  const T = TH.i18n;
  const byId = Object.fromEntries(D.enchantments.map((e) => [e.id, e]));
  const itemById = Object.fromEntries(D.items.map((i) => [i.id, i]));
  const MATS = D.materialOrder;
  const MAX_USES = 6;

  const DEFAULTS = {
    item: 'sword', material: 'diamond', existing: {}, uses: 0, own: false,
    selected: {}, loadout: null, gearId: null, gear: [], saveName: '', renaming: null, renameText: '',
    mode: 'single', planEditing: null, plan: [], planGot: {}, booksOwned: {}, renameCost: '', anvilName: '',
  };

  const st = () => TH.store.get().enchanting;
  const set = (fn, opts) => TH.store.update((s) => fn(s.enchanting), opts);

  /* ---------- names (game terms always via TH.i18n) ---------- */
  const enchName = (id) => T.ench(id);
  const lvlName = (id, level) => T.enchLevel(id, level);
  const lvl = (n) => T.level(n);

  const isPlain = (it) => it.materials.length === 1 && it.materials[0] === 'plain';
  const fits = (it, m) => isPlain(it) || it.materials.includes(m);
  /** The material actually used for an item (plain items ignore the picked material). */
  const effMat = (itemId, m) => {
    const it = itemById[itemId];
    if (isPlain(it)) return 'plain';
    return it.materials.includes(m) ? m : it.defaultMaterial;
  };
  /** Mojang item id, e.g. diamond_sword, turtle_helmet, bow. */
  function mcId(itemId, m) {
    const mat = effMat(itemId, m);
    if (mat === 'plain') return itemId;
    if (mat === 'turtle') return 'turtle_helmet';
    return mat + '_' + itemId;
  }
  const itemName = (itemId, m) => T.item(mcId(itemId, m));
  const matName = (m) => (T.lang === 'en_us' ? D.materials[m].name : T.item(D.materials[m].lang));
  const itemIcon = (itemId, m, size) => TH.icon.item(itemId, effMat(itemId, m), { size: size || 32 });
  const bookIcon = (size) => TH.icon('enchanted_book', { size: size || 20, glint: true });

  /* ---------- hall link ---------- */
  function hallOffers(state) {
    try {
      if (TH.hall && typeof TH.hall.bookOffers === 'function') return TH.hall.bookOffers(state) || {};
    } catch (e) { /* hall module failed — just hide the link */ }
    return null;
  }

  /** {cls, text, price} describing where a book comes from. */
  function hallStatus(offers, id, level) {
    const ench = byId[id];
    if (!ench.librarian) return { cls: 'none', text: 'not sold', title: 'Not sold by librarians (treasure)' };
    if (!offers) return null;
    const o = offers[id];
    if (!o) return { cls: 'missing', text: 'not in hall' };
    if (o.level >= level) return { cls: 'have', text: 'in hall', price: o.price, perfect: o.perfect };
    return { cls: 'low', text: `hall has ${lvl(o.level)}`, price: o.price };
  }

  function hallChip(status) {
    if (!status) return null;
    return h('span.ec-hall.' + status.cls, { title: (status.title || status.text) + (status.price != null ? ` · ${status.price} emeralds` : '') },
      h('span.ec-hall-text', status.text),
      status.price != null ? h('span.ec-price', h('b', status.price), emerald()) : null,
      status.perfect ? h('span.ec-star', { 'aria-label': 'perfect price' }, '★') : null);
  }

  /* ---------- state helpers ---------- */
  /** Most-used first: Mending, Unbreaking, then the item's own main enchants in data order (stable sort). */
  const RANK = { mending: 0, unbreaking: 1 };
  const rank = (id) => (id in RANK ? RANK[id] : 2);
  const byUse = (a, b) => rank(a) - rank(b);
  const sortIds = (ids) => ids.slice().sort(byUse);
  const applicable = (s) => itemById[s.item].enchants.slice().sort(byUse).map((id) => byId[id]).filter(Boolean);
  const conflictList = (id, ids) => ids.filter((x) => TH.anvil.conflicts(x, id));

  function resetPlan(e) {
    e.existing = {}; e.selected = {}; e.uses = 0; e.loadout = null; e.gearId = null; e.planEditing = null; e.anvilName = ''; e.saveName = '';
  }

  function pickItem(id) {
    set((e) => {
      if (e.item === id) return;
      e.item = id;
      resetPlan(e);
    });
  }

  /** Material first: switching to a material the current item doesn't come in moves to a sibling that does. */
  function pickMaterial(m) {
    set((e) => {
      e.matTouched = true;
      if (e.material === m) return;
      e.material = m;
      const cur = itemById[e.item];
      if (fits(cur, m)) return;
      const options = D.items.filter((i) => !isPlain(i) && i.materials.includes(m));
      const next = options.find((i) => i.group === cur.group) || options[0];
      if (next) { e.item = next.id; resetPlan(e); }
    });
  }

  function toggleSelect(id) {
    set((e) => {
      if (e.selected[id]) { delete e.selected[id]; e.loadout = null; return; }
      for (const c of conflictList(id, Object.keys(e.selected))) delete e.selected[c];
      e.selected[id] = Math.max(byId[id].maxLevel, 1);
      e.loadout = null;
    });
  }

  function setSelectedLevel(id, level) {
    set((e) => {
      for (const c of conflictList(id, Object.keys(e.selected))) delete e.selected[c];
      e.selected[id] = level;
      e.loadout = null;
    });
  }

  function setExisting(id, level) {
    set((e) => {
      if (!level) delete e.existing[id];
      else {
        for (const c of conflictList(id, Object.keys(e.existing))) delete e.existing[c];
        e.existing[id] = level;
      }
      pruneSelected(e);
    });
  }

  function pruneSelected(e) {
    for (const id of Object.keys(e.selected)) {
      if ((e.existing[id] || 0) >= e.selected[id]) delete e.selected[id];
      else if (conflictList(id, Object.keys(e.existing)).length) delete e.selected[id];
    }
  }

  function applyLoadout(lo) {
    set((e) => {
      e.selected = {};
      for (const [id, lv] of Object.entries(lo.enchants)) {
        if ((e.existing[id] || 0) >= lv) continue;
        if (conflictList(id, Object.keys(e.existing)).length) continue;
        e.selected[id] = lv;
      }
      e.loadout = lo.id;
    });
  }

  /* ---------- plan cache ---------- */
  const planCache = new Map();
  function planFor(itemId, existing, uses, selected) {
    const order = (itemById[itemId] || itemById.sword).enchants;
    const books = order.filter((id) => selected[id]).map((id) => ({ id, level: selected[id] }));
    const key = JSON.stringify([sortObj(existing), uses, books]);
    let p = planCache.get(key);
    if (!p) {
      try { p = TH.anvil.plan({ enchants: existing, uses }, books); } catch (err) { p = { error: err.message, steps: [], books: [], skipped: [] }; }
      if (planCache.size > 300) planCache.clear();
      planCache.set(key, p);
    }
    return p;
  }
  const currentPlan = (s) => planFor(s.item, s.existing, s.uses, s.selected);
  const entryPlan = (en) => planFor(en.item, en.existing, en.uses, en.selected);

  /* ---------- saved gear ---------- */

  /** Armor section = the four armor pieces plus elytra and shield; everything else is Tools. Armor is listed first. */
  const ARMOR_IDS = ['helmet', 'chestplate', 'leggings', 'boots', 'elytra'];
  const isArmorItem = (id) => ARMOR_IDS.includes(id);
  function armorToolSections(entries, itemOf, render, listCls, secCls) {
    const secOf = (l) => (typeof secCls === 'function' ? secCls(l) : secCls || '');
    const armor = entries.filter((x) => isArmorItem(itemOf(x))).sort((a, b) => ARMOR_IDS.indexOf(itemOf(a)) - ARMOR_IDS.indexOf(itemOf(b)));
    const tools = entries.filter((x) => !isArmorItem(itemOf(x)));
    return [['Armor', armor], ['Tools', tools]].filter(([, l]) => l.length).map(([name, l]) => h('div.ec-sec' + secOf(l),
      h('div.ec-group-name', h('span', name)),
      h('div' + (listCls || ''), l.map(render))));
  }

  function renderGear(state) {
    const s = state.enchanting;
    if (!s.gear.length) return null;
    return h('section.ec-gear', { 'aria-label': 'Saved gear' },
      h('div.ec-section-head', h('h3.section-title', 'Your gear'), h('span.faint', 'Click to load and plan upgrades')),
      armorToolSections(s.gear, (g) => g.item, (g) => {
        const it = itemById[g.item] || itemById.sword;
        const n = Object.keys(g.enchants).length;
        const active = s.gearId === g.id;
        if (s.renaming === g.id) {
          return h('div.panel.ec-gear-card.editing',
            itemIcon(it.id, g.material, 28),
            h('form.ec-rename', {
              onsubmit: (ev) => {
                ev.preventDefault();
                set((e) => { const x = e.gear.find((y) => y.id === g.id); if (x) x.name = (e.renameText || '').trim() || x.name; e.renaming = null; });
              },
            },
            h('input.field', {
              value: s.renameText, 'data-focus': 'ec-rename', 'aria-label': 'Gear name', maxlength: 40,
              oninput: (ev) => set((e) => { e.renameText = ev.target.value; }, { silent: true }),
              onkeydown: (ev) => { if (ev.key === 'Escape') set((e) => { e.renaming = null; }); },
            }),
            h('button.btn.small.primary', { type: 'submit' }, 'Save'),
            h('button.btn.small.ghost', { type: 'button', onclick: () => set((e) => { e.renaming = null; }) }, 'Cancel')));
        }
        return h('div.panel.ec-gear-card' + (active ? '.active' : ''),
          h('button.ec-gear-main', {
            type: 'button', 'aria-pressed': String(active), title: 'Load ' + g.name, 'data-focus': 'ec-gear-' + g.id,
            onclick: () => set((e) => {
              e.item = it.id;
              if (MATS.includes(g.material)) e.material = g.material;
              e.existing = Object.assign({}, g.enchants);
              e.uses = g.uses; e.selected = {}; e.loadout = null; e.gearId = g.id; e.planEditing = null;
            }),
          },
          itemIcon(it.id, g.material, 28),
          h('span.ec-gear-text',
            h('b', g.name),
            h('span.faint', n ? n + ' enchant' + (n > 1 ? 's' : '') + ' · ' + g.uses + ' anvil use' + (g.uses === 1 ? '' : 's') : 'unenchanted'))),
          h('div.ec-gear-actions',
            h('button.x-btn', {
              type: 'button', title: 'Rename', 'aria-label': 'Rename ' + g.name,
              onclick: () => { TH.app.pendingFocus = 'ec-rename'; set((e) => { e.renaming = g.id; e.renameText = g.name; }); },
            }, '✎'),
            h('button.x-btn', {
              type: 'button', title: 'Delete', 'aria-label': 'Delete ' + g.name,
              onclick: () => {
                TH.util.guard(true, `Delete “${g.name}”?`, () => set((e) => { e.gear = e.gear.filter((x) => x.id !== g.id); if (e.gearId === g.id) e.gearId = null; }), 'Delete');
              },
            }, '✕')));
      }, '.ec-gear-list'));
  }

  /* ---------- 1. material, then item ---------- */

  function materialHint(m) {
    if (m === 'turtle') return 'Turtle only comes as a helmet.';
    if (m === 'leather' || m === 'chainmail') return matName(m) + ' is armor only — no tools or weapons.';
    if (m === 'wooden' || m === 'stone') return matName(m) + ' is tools and weapons only — no armor.';
    return null;
  }

  /** Material icon overrides (the data file's chain texture isn't what players recognise). */
  const MAT_ICON = { chainmail: 'item/chainmail_chestplate' };
  const matIcon = (m, size) => TH.icon(MAT_ICON[m] || D.materials[m].icon, { size });

  /** Two segments side by side: armor (helmet to boots, then shield/elytra) and tools & weapons. */
  const HUD_ARMOR = ['helmet', 'chestplate', 'leggings', 'boots', 'elytra'];
  const HUD_TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'spear', 'bow', 'crossbow', 'trident', 'mace'];

  /** Material-less name for greyed-out tiles ("Sword", "Fishing Rod"). */
  const genericName = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  function itemButton(itemId, s, extraCls) {
    const it = itemById[itemId];
    if (!it) return null;
    const ok = fits(it, s.material);
    const on = ok && it.id === s.item;
    const name = ok ? itemName(it.id, s.material) : genericName(it.id);
    const tip = ok ? name : 'Not available in ' + matName(s.material);
    return h('button.ec-item' + (on ? '.on' : '') + (ok ? '' : '.na') + (it.since ? '.has-since' : '') + (extraCls || ''), {
      type: 'button', 'aria-pressed': String(on), 'data-focus': 'ec-item-' + it.id, title: tip, disabled: !ok,
      onclick: () => pickItem(it.id),
    },
    h('span.ec-item-ico', ok ? itemIcon(it.id, s.material, 32) : itemIcon(it.id, it.materials.includes('iron') ? 'iron' : it.defaultMaterial, 32)),
    h('span.ec-item-name', h('span', name)),
    it.since ? h('span.ec-new', it.since) : null);
  }

  function renderPicker(s) {
    const placed = new Set(HUD_ARMOR.concat(HUD_TOOLS));
    const rest = D.items.filter((i) => !placed.has(i.id)).map((i) => i.id);
    // three separate segments (DESIGN.md, Layout "Item picker"): each a .panel with a top-left eyebrow heading;
    // every icon is 32px (integer 2x of the 16px textures) so Material, Armor and Tools read as one family
    const grp = HUD_ARMOR.includes(s.item) ? 'armor' : HUD_TOOLS.includes(s.item) ? 'tools' : 'other';
    const box = (key, label, body) => h('section.panel.ec-card.ec-picker.ec-pick-' + key + (key === grp || (key === 'mat' && s.matTouched) ? '.has-sel' : ''), { 'aria-labelledby': 'ec-lbl-' + key },
      h('h3.ec-pick-label', { id: 'ec-lbl-' + key }, label), body);
    return [
      h('div.ec-toprow', box('mat', 'Material',
        h('div.ec-matkeys', { role: 'radiogroup', 'aria-labelledby': 'ec-lbl-mat' }, MATS.map((m) => {
          const on = s.material === m;
          const nm = matName(m);
          return h('button.btn.ec-matkey' + (on ? '.on' : ''), {
            type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': nm, 'data-focus': 'ec-mat-' + m,
            title: materialHint(m) ? nm + ' — ' + materialHint(m) : nm, onclick: () => pickMaterial(m),
          }, (() => { const ic = matIcon(m, 32); if (m === 'wooden' || m === 'stone') ic.classList.add('ec-mat-block'); return ic; })(), h('span.ec-mat-name', nm));
        })))),
      h('div.ec-pickrow',
        box('armor', 'Armor',
          h('div.ec-slots.armor', { role: 'group', 'aria-labelledby': 'ec-lbl-armor' }, HUD_ARMOR.map((id) => itemButton(id, s)))),
        box('tools', 'Tools & weapons',
          h('div.ec-slots.tools', { role: 'group', 'aria-labelledby': 'ec-lbl-tools' }, HUD_TOOLS.map((id) => itemButton(id, s)))),
        box('other', 'Other',
          h('div.ec-slots.other', { role: 'group', 'aria-labelledby': 'ec-lbl-other' }, rest.map((id) => itemButton(id, s))))),
    ];
  }

  /* ---------- 2. current item ---------- */

  /** Reads the anvil's rename cost back into prior-work penalty and anvil uses. */
  function renameResult(raw) {
    const n = parseInt(raw, 10);
    if (!raw || !isFinite(n)) return { text: 'Enter the cost shown.' };
    if (n < 1) return { text: 'The rename cost is at least 1.' };
    const pen = n - 1;
    const uses = Math.log2(pen + 1);
    if (!Number.isInteger(uses)) return { text: `Penalty ${pen} isn’t 0, 1, 3, 7, 15, 31 … so that cost can’t come from anvil work alone (other renames or mods?).` };
    return { uses, text: `Penalty ${pen} → ${uses} anvil use${uses === 1 ? '' : 's'}` };
  }

  /** Slim inline anvil-uses row (stepper + rename-cost helper); shown in "Already on it" mode or when something is on the item. */
  function renderUsesRow(s) {
    const pen = TH.anvil.penalty(s.uses);
    const out = h('span.ec-rc-out');
    const btn = h('button.btn.small', { type: 'button', hidden: true }, 'Use this');
    let cur = null;
    const update = (raw) => {
      cur = renameResult(raw);
      out.textContent = raw ? cur.text : '';
      out.classList.toggle('ok', cur.uses != null);
      btn.hidden = cur.uses == null || cur.uses === st().uses;
    };
    btn.onclick = () => { if (cur && cur.uses != null) set((e) => { e.uses = clamp(cur.uses, 0, MAX_USES + 4); }); };
    update(s.renameCost);
    return h('div.ec-usesrow',
      h('div.ec-ur-main',
        h('span.ec-label', { title: 'Times through an anvil. Enchanting, repairing and renaming each count once. Penalty = 2^uses − 1.' }, 'Times through anvil'),
        stepper(s.uses, { min: 0, max: Math.max(MAX_USES, s.uses), label: 'anvil uses', onChange: (v) => set((e) => { e.uses = v; }) }),
        h('span.ec-pen' + (pen >= 15 ? '.warn' : ''), pen ? '+' + pen + ' lvl each job' : 'fresh item')),
      h('div.ec-ur-rc',
        h('label.ec-label', { for: 'ec-rename-cost', title: 'Type any name in an anvil and enter the cost it shows' }, 'Unsure? Rename cost'),
        h('input.field', {
          id: 'ec-rename-cost', type: 'number', min: 1, max: 99, inputmode: 'numeric', placeholder: 'cost', value: s.renameCost, 'data-focus': 'ec-rename-cost',
          'aria-label': 'Rename cost shown in the anvil',
          oninput: (ev) => { set((e) => { e.renameCost = ev.target.value; }, { silent: true }); update(ev.target.value); },
        }),
        out, btn));
  }

  /* ---------- 3. enchantments (strips) ---------- */

  function renderSelect(state, s) {
    const it = itemById[s.item];
    const offers = hallOffers(state);
    const selIds = Object.keys(s.selected);
    const exIds = Object.keys(s.existing);
    const lo = it.loadouts.find((l) => l.id === s.loadout);
    const list = applicable(s);
    const curses = list.filter((e) => e.category === 'curse');
    const normal = list.filter((e) => e.category !== 'curse');

    const own = !!s.own;

    function row(ench) {
      const id = ench.id;
      const nm = enchName(id);
      const sel = s.selected[id] || 0;
      const has = s.existing[id] || 0;
      const maxed = has >= ench.maxLevel;
      const exConf = conflictList(id, exIds);
      const selConf = sel ? [] : conflictList(id, selIds);
      const blocked = !own && (maxed || exConf.length > 0);
      const level = sel || Math.max(ench.maxLevel, 1);
      const status = !blocked && !own ? hallStatus(offers, id, level) : null;
      const inputId = 'ec-sel-' + id;
      const onToggle = () => (own ? setExisting(id, has ? 0 : Math.max(ench.maxLevel, 1)) : toggleSelect(id));

      // second line: the reason it can't be picked, the swap it causes, or what it does
      let sub, subCls = '';
      if (own) {
        if (!has && exConf.length) { sub = 'Replaces ' + exConf.map(enchName).join(', ') + ' on the item'; subCls = '.warn'; }
        else sub = ench.desc;
      } else if (maxed) { sub = 'Already ' + lvlName(id, has) + ' on your item'; subCls = '.ok'; }
      else if (exConf.length) { sub = 'Can’t combine with ' + enchName(exConf[0]) + ' on your item'; subCls = '.bad'; }
      else if (selConf.length) { sub = 'Replaces ' + selConf.map(enchName).join(', '); subCls = '.warn'; }
      else sub = (sel && lo && lo.reasons[id]) || ench.desc;

      const showChips = ench.maxLevel > 1 && (own || maxed || !blocked);
      const chip = (l) => {
        if (own) {
          return h('button' + (has === l ? '.on.own' : ''), {
            type: 'button', 'aria-pressed': String(has === l), 'aria-label': lvlName(id, l) + ' already on item', 'data-focus': `ec-lv-${id}-${l}`,
            onclick: () => setExisting(id, has === l ? 0 : l),
          }, lvl(l));
        }
        if (l <= has) {
          return h('button.own' + (l === has ? '.top' : ''), {
            type: 'button', disabled: true, 'aria-label': lvlName(id, l) + ' (on item)', 'data-focus': `ec-lv-${id}-${l}`,
          }, lvl(l));
        }
        return h('button' + (sel === l ? '.on' : ''), {
          type: 'button', 'aria-pressed': String(sel === l), 'aria-label': lvlName(id, l), 'data-focus': `ec-lv-${id}-${l}`,
          onclick: () => (sel === l ? toggleSelect(id) : setSelectedLevel(id, l)),
        }, lvl(l));
      };
      const stat = (has || (!own && sel))
        ? h('span.ec-stat', has ? h('span.ec-stat-has', 'on item: ', h('b', lvl(has))) : null,
          null)
        : null;

      return h('div.ec-ench' + (!own && sel ? '.on' : '') + (has ? '.has' : '') + (own && has ? '.owned' : '') + (blocked ? '.blocked' : '') + (selConf.length ? '.conflict' : ''),
        h('label.check', h('input', {
          type: 'checkbox', id: inputId, checked: own ? !!has : !!sel, disabled: blocked, 'data-focus': inputId,
          'aria-describedby': inputId + '-sub', onchange: onToggle,
        }), h('span')),
        h('label.ec-ench-text', { for: inputId },
          h('span.ec-ench-name', h('span.ec-ench-title', nm),
            ench.category === 'curse' ? h('span.pill.tier-meh', 'curse') : null,
            (it.anvilOnly || []).includes(id) ? h('span.pill.tier-good', { title: 'The enchanting table can’t put this on this item, but an anvil can' }, 'anvil only') : null),
          h('span.ec-ench-sub' + subCls, { id: inputId + '-sub', title: sub }, sub)),
        h('div.ec-ench-side',
          h('div.ec-stat-slot', stat),
          showChips
            ? h('div.lvl-chips.ec-lv', { role: 'group', 'aria-label': nm + (own ? ' level already on item' : ' book level') },
              Array.from({ length: ench.maxLevel }, (_, i) => chip(i + 1)))
            : h('div.lvl-chips.ec-lv.is-empty', { 'aria-hidden': 'true' }),
          h('div.ec-hall-slot', hallChip(status))));
    }

    const ownSwitch = h('div.seg.ec-ownseg', { role: 'group', 'aria-label': 'Which enchantments are you setting' },
      h('button' + (!own ? '.on' : ''), { type: 'button', 'aria-pressed': String(!own), 'data-focus': 'ec-own-want', onclick: () => set((e) => { e.own = false; }) }, 'I want'),
      h('button' + (own ? '.on' : ''), { type: 'button', 'aria-pressed': String(own), 'data-focus': 'ec-own-has', onclick: () => set((e) => { e.own = true; }) },
        'Already on it', exIds.length ? h('span.nav-badge.count', { 'aria-label': exIds.length + ' on the item' }, exIds.length) : null));

    return h('section.panel.ec-card.ec-rowbox' + (selIds.length ? '.has-sel' : ''),
      h('div.ec-card-head', h('h3', 'Enchantments'),
        selIds.length ? h('button.btn.ghost.small.ec-clear', { type: 'button', onclick: () => set((e) => { e.selected = {}; e.loadout = null; }) }, 'Clear') : null),
      h('div.ec-ownbar', ownSwitch,
        h('span.ec-ownhint', own ? 'Tap what the item already has' : 'Tap what you want to add')),
      h('div.ec-loadouts.ec-row',
        h('span.ec-row-label', { id: 'ec-lbl-presets' }, 'Presets'),
        h('div.ec-lo-list', { role: 'group', 'aria-labelledby': 'ec-lbl-presets' }, it.loadouts.map((l) => h('button.btn.small.ec-lo' + (s.loadout === l.id ? '.on' : ''), {
          type: 'button', title: l.desc, 'aria-pressed': String(s.loadout === l.id), 'data-focus': 'ec-lo-' + l.id, onclick: () => applyLoadout(l),
        }, l.id === 'best' ? bookIcon(26) : itemIcon(s.item, s.material, 26), h('span.ec-lo-name', l.name), l.id === 'best' ? TH.util.reco() : null)).concat(s.loadout || selIds.length ? [h('button.btn.small.ec-lo.ec-lo-reset', {
          type: 'button', title: 'Back to nothing picked', 'data-focus': 'ec-lo-reset', onclick: () => set((e) => { e.selected = {}; e.loadout = null; }),
        }, '\u2715 Reset')] : []))),
      own || exIds.length ? renderUsesRow(s) : null,
      h('div.ec-for', itemIcon(s.item, s.material, 28), h('span', itemName(s.item, s.material))),
      h('div.ec-ench-list' + (own ? '.is-own' : ''), normal.map(row)),
      curses.length ? h('details.ec-curses', h('summary', 'Curses (' + curses.length + ')'), h('div.ec-ench-list' + (own ? '.is-own' : ''), curses.map(row))) : null,
    );
  }

  /* ---------- plan panel ---------- */

  /** Red chip: adding the books one at a time would hit Too Expensive!, the recommended order does not. */
  const oneBookWarn = (extra) => h('span.ec-warn-chip', { tabindex: '0', title: (extra ? extra + ' ' : '') + 'One book at a time hits Too Expensive! Using the recommended order doesn’t.' },
    TH.icon('item/barrier', { size: 14 }), h('span', 'WARNING! Too expensive'));
  const hitsNaive = (p) => !!(p && p.ok && p.naive && !p.naive.ok);

  function nodeChip(node, s, needed) {
    const names = node.enchants.map((e) => lvlName(e.id, e.level));
    if (node.kind === 'item') {
      return h('span.ec-node.item', { title: names.join(', ') || 'No enchantments' }, itemIcon(s.item, s.material, 20), h('span', itemName(s.item, s.material)));
    }
    if (node.fromStep != null) {
      return h('span.ec-node.book', { title: 'Book from step ' + node.fromStep },
        bookIcon(20), h('span', names.join(' + ') || 'Book'), h('small.ec-ref', 'BOOK FROM STEP ' + node.fromStep));
    }
    return h('span.ec-node.book' + (needed ? '.is-needed' : ''), needed ? { title: 'You still need this book (see Books to get)' } : {}, bookIcon(20), h('span', names.join(' + ')));
  }

  /** The gear's own name (the name field below the plan, or the loaded saved gear). */
  function gearLabel(s) {
    const g = s.gear.find((x) => x.id === s.gearId);
    return ((g ? g.name : s.saveName) || '').trim();
  }

  /** Live-update the preview's name line while typing in the gear name field. */
  function updatePreviewName(side) {
    const nm = side && side.querySelector('.mct-name');
    if (!nm) return;
    const cur = st(), c = gearLabel(cur);
    nm.textContent = c || itemName(cur.item, cur.material);
    nm.classList.toggle('custom', !!c);
  }

  /** Minecraft-style item slot + tooltip for the gear as it will look (existing + picked enchants). */
  function renderPreview(s) {
    const fin = Object.assign({}, s.existing);
    Object.keys(s.selected).forEach((id) => {
      Object.keys(fin).forEach((x) => { if (x !== id && conflictList(id, [x]).length) delete fin[x]; });
      if (s.selected[id] > 0) fin[id] = s.selected[id];
    });
    const ids = sortIds(Object.keys(fin));
    const ench = ids.length > 0;
    const custom = gearLabel(s);
    const lines = ids.map((id) => {
      const curse = byId[id] && byId[id].category === 'curse';
      return h('div.mct-line' + (curse ? '.curse' : '') + '', lvlName(id, fin[id]));
    });
    // first section of the Anvil plan panel (flat, no box of its own); the tooltip itself stays Minecraft-styled
    return h('div.ec-pv-sec',
      h('div.ec-preview', { role: 'group', 'aria-label': 'Preview', 'aria-live': 'polite' },
        h('div.ec-pv-row',
          h('div.mct-slot', TH.icon.item(s.item, effMat(s.item, s.material), { size: 32, glint: ench })),
          h('div.mct', h('div.mct-name' + (ench ? '.ench' : '') + (custom ? '.custom' : ''), custom || itemName(s.item, s.material)), lines))));
  }

  function renderPlan(state, s, plan) {
    const offers = hallOffers(state);
    const editingNow = editingEntry(s);
    const modeSw = renderModeCards(s);
    const editLine = editingNow ? h('div.ec-edit-line', h('span', 'Editing a plan item'),
      h('button.btn.ghost.small', { type: 'button', title: 'Stop editing this plan item and start a new one', onclick: () => set((e) => { e.planEditing = null; }) }, 'Stop editing')) : null;
    const head = [renderPreview(s)];

    if (plan.error) return h('aside.panel.ec-plan', modeSw, editLine, head, h('p.ec-alert', plan.error));

    if (!plan.books.length) {
      return h('aside.panel.ec-plan', { 'aria-live': 'polite' }, modeSw, editLine,
        h('div.ec-plan-body', head, h('div.empty.ec-empty',
          plan.skipped.length ? 'Your item already has everything you picked.' : 'Pick enchantments and the cheapest anvil order shows up here.'),
        renderActions(s)));
    }

    const steps = plan.steps;
    const naive = plan.naive;
    const usable = plan.ok || plan.partial;
    const save = naive.totalLevels - plan.totalLevels;

    // compact summary: levels · steps · XP, with the saving as small secondary text
    let compare = null;
    if (plan.ok && !naive.ok) compare = oneBookWarn();
    else if (plan.ok && save > 0) compare = h('span', 'Saves ', h('b.ec-save-n', save), ' level' + (save === 1 ? '' : 's'), ' vs one book at a time (', naive.totalLevels, ').');

    // levels still to spend: ticked steps of the linked plan item no longer count, a finished item counts for nothing
    const linked = editingEntry(s);
    const levelsLeft = linked && sameEntry(linked, s)
      ? (linked.done ? 0 : steps.filter((x) => !linked.ticks.includes('n' + x.n)).reduce((n, x) => n + x.cost, 0))
      : plan.totalLevels;
    const total = h('div.ec-sum' + (usable ? '' : '.bad'),
      h('div.ec-sum-main', { title: '≈ ' + (plan.totalXP || 0).toLocaleString() + ' XP points' },
        h('span.ec-sum-item', h('b', usable ? plan.totalLevels : '—'), h('span.ec-sum-lab', 'level' + (plan.totalLevels === 1 ? '' : 's') + (plan.partial ? ' · without left-out books' : ''))),
        h('span.ec-sum-item', h('b', steps.length), h('span.ec-sum-lab', 'anvil step' + (steps.length === 1 ? '' : 's')))),
      compare ? h('div.ec-compare', compare) : null, xpHint(levelsLeft));

    // one short warning, only when it matters
    let alert = null;
    if (!plan.ok) {
      alert = h('p.ec-alert',
        h('span', plan.reason === 'penalty'
          ? 'Too Expensive! — this item has been through the anvil too often.'
          : 'Too Expensive! — no order keeps every step under 40 levels.',
        plan.partial ? [' Leave out ', h('b', plan.partial.dropped.map((b) => lvlName(b.id, b.level)).join(', ')), ' and the rest works:'] : null));
    }

    const stepList = steps.length
      ? h('ol.ec-steps', steps.map((x) => h('li.ec-step' + (x.cost > 39 ? '.bad' : ''),
        h('span.ec-step-num', { 'aria-label': 'Step ' + x.n }, x.n),
        h('div.ec-step-line', nodeChip(x.target, s), h('span.ec-plus', { 'aria-hidden': 'true' }, '+'), nodeChip(x.sacrifice, s)),
        h('span.ec-step-cost' + (x.cost > 39 ? '.bad' : x.cost >= 30 ? '.warn' : ''),
          x.cost > 39 ? 'Too Expensive!' : [h('b', x.cost), h('span.ec-cost-unit', 'lvl')]))))
      : null;

    // the finished item is the preview at the top of this panel (.ec-preview); only its "too expensive afterwards" warning stays here
    const finWarn = TH.anvil.penalty(plan.final.uses) >= 31
      ? h('p.ec-note', 'After this, more anvil work on it (even repairs) will be Too Expensive.')
      : null;

    // books to get
    let emeraldTotal = 0, fromHall = 0;
    const shop = plan.books.slice().sort((a, b) => byUse(a.id, b.id)).map((b) => {
      const status = hallStatus(offers, b.id, b.level);
      if (status && status.cls === 'have') { emeraldTotal += status.price || 0; fromHall++; }
      return h('li', bookIcon(16), h('span.ec-shop-name', lvlName(b.id, b.level)), hallChip(status));
    });
    const shopBox = h('div.ec-shop',
      h('div.ec-sub-head', 'Books needed', h('span.faint', plan.books.length)),
      h('ul', shop),
      offers && fromHall
        ? h('div.ec-shop-total', h('span.ec-price', h('b', emeraldTotal), emerald()), h('span', `+ ${fromHall} book${fromHall > 1 ? 's' : ''} from your hall`))
        : null);

    return h('aside.panel.ec-plan', { 'aria-live': 'polite' }, modeSw, editLine,
      h('div.ec-plan-body',
        head, total, alert,
        stepList ? h('div.ec-plan-block', h('div.ec-sub-head', 'Anvil steps', h('span.faint', steps.length)), stepList) : null,
        finWarn, shopBox, renderActions(s)),
      renderActionBar(s, plan));
  }

  /** "Add to plan" / "Done": last row of the Anvil plan panel, sticky so it stays reachable while the plan scrolls. */
  function renderActionBar(s, plan) {
    const g = s.gear.find((x) => x.id === s.gearId);
    const en = editingEntry(s);
    const isDone = !!(en && en.done);
    const canApply = !!(plan && plan.steps.length > 0);
    const hasBooks = !!(plan && !plan.error && usedBooks(plan).length);
    const entryDirty = en && !sameEntry(en, s);

    const dup = !en && s.plan.some((x) => !x.done && sameEntry(x, s));
    const left = dup
      ? h('button.btn.ec-inplan', { type: 'button', disabled: true }, '✓ In your plan')
      : !en
      ? h('button.btn.ec-add', { type: 'button', disabled: !hasBooks, 'data-focus': 'ec-plan-add', onclick: addToPlan,
        title: hasBooks ? 'Add this item to your plan' : 'Pick enchantments first' }, 'Add to plan')
      : entryDirty
        ? h('button.btn.primary', { type: 'button', disabled: !hasBooks, 'data-focus': 'ec-plan-update', onclick: updateEntry }, 'Update plan item')
        : h('button.btn.ec-inplan', { type: 'button', disabled: true }, '✓ In your plan');
    const right = canApply || isDone ? h('button.btn' + (isDone ? '.ec-undone' : '.primary'), {
      type: 'button', 'aria-pressed': String(isDone), 'data-focus': 'ec-done',
      title: isDone ? 'Mark as not done again' : 'Check this item off in your plan' + (g ? ' and update the saved gear' : ''),
      onclick: () => doneFromEditor(plan),
    }, isDone ? '✓ Done — undo' : 'Done') : null;

    return h('div.th-act-row', { role: 'group', 'aria-label': 'Plan actions' }, left, right);
  }

  /** Sidebar action panel: name + save the gear, follow-ups after Done (the main actions float in renderActionBar). */
  function renderActions(s) {
    const g = s.gear.find((x) => x.id === s.gearId);
    const dirtyGear = g && (g.item !== s.item || g.material !== s.material || g.uses !== s.uses || JSON.stringify(sortObj(g.enchants)) !== JSON.stringify(sortObj(s.existing)));
    const en = editingEntry(s);
    const isDone = !!(en && en.done);

    return h('div.ec-actions',
      g ? h('div.ec-loaded', h('span', 'Editing ', h('b', g.name)),
        dirtyGear ? h('button.btn.small', {
          type: 'button', onclick: () => {
            set((e) => { const x = e.gear.find((y) => y.id === e.gearId); if (x) Object.assign(x, { item: e.item, material: e.material, enchants: Object.assign({}, e.existing), uses: e.uses, updated: Date.now() }); });
            toast('Saved');
          },
        }, 'Save changes') : null,
        h('button.btn.small.ghost', { type: 'button', onclick: () => set((e) => { e.gearId = null; }) }, 'Close'))
        : h('form.ec-save', {
          onsubmit: (ev) => {
            ev.preventDefault();
            const cur = st();
            const name = (cur.saveName || '').trim() || itemName(cur.item, cur.material);
            set((e) => {
              const id = uid('gear');
              e.gear.push({ id, name, item: e.item, material: e.material, enchants: Object.assign({}, e.existing), uses: e.uses, updated: Date.now() });
              e.gearId = id; e.saveName = '';
            });
            toast(`Saved “${name}”`);
          },
        },
        h('input.field', {
          placeholder: 'Name, e.g. Main sword', value: s.saveName, maxlength: 40, 'data-focus': 'ec-save-name',
          'aria-label': 'Name for saved gear',
          oninput: (ev) => {
            const v = ev.target.value;
            set((e) => { e.saveName = v; }, { silent: true });
            updatePreviewName(ev.target.closest('.ec-side'));
          },
        }),
        h('button.btn', { type: 'submit', title: 'Save the item as it is now (current enchants and anvil uses)' }, 'Save item')),
      isDone ? h('div.ec-act-row.follow',
        h('button.btn', { type: 'button', 'data-focus': 'ec-add-another', title: 'Put a fresh copy of this item and enchantments into your plan', onclick: addAnother },
          TH.icon('item/writable_book', { size: 16 }), 'Add another of the same'),
        h('button.btn.ghost', { type: 'button', 'data-focus': 'ec-start-over', title: 'Clear the editor and start a new item', onclick: newItem }, 'Start over')) : null);
  }

  function sortObj(o) { return Object.keys(o).sort().map((k) => [k, o[k]]); }

  /* ======================================================================
   * Planner — several items, one shopping list + anvil to-do list
   * ====================================================================== */

  const UPGRADE = D.netheriteUpgrade || [];
  /** Books the plan actually applies (a partial plan leaves some out). */
  const usedBooks = (p) => (p.error ? [] : p.ok ? p.books : p.partial ? p.partial.books : []);
  const canUpgrade = (en) => en.material === 'netherite';
  const editingEntry = (s) => s.plan.find((x) => x.id === s.planEditing) || null;
  const sameEntry = (en, s) => en.item === s.item && en.material === effMat(s.item, s.material) && en.uses === s.uses
    && JSON.stringify(sortObj(en.existing)) === JSON.stringify(sortObj(s.existing))
    && JSON.stringify(sortObj(en.selected)) === JSON.stringify(sortObj(s.selected));
  /** Game name (TH.i18n falls back to en_us, then to the English title-cased id). */
  const matItemName = (m) => T.item(m.id);

  function snapshot(e) {
    return {
      item: e.item, material: effMat(e.item, e.material),
      existing: Object.assign({}, e.existing), uses: e.uses, selected: Object.assign({}, e.selected),
    };
  }

  function addToPlan() {
    let name = '';
    set((e) => {
      const en = Object.assign({ id: uid('plan'), upgrade: false, gearId: e.gearId || null, ticks: [], done: false, added: Date.now() }, snapshot(e));
      e.plan.push(en);   // stays a plain editor: only the Edit button links the editor to a plan item
      name = itemName(en.item, en.material);
    });
    toast(`Added ${name} to your plan`);
  }

  /** A fresh, unchecked copy of the editor's item + enchant setup, added to the plan and opened. */
  function addAnother() {
    let name = '';
    set((e) => {
      const en = Object.assign({ id: uid('plan'), upgrade: false, gearId: null, ticks: [], done: false, added: Date.now() }, snapshot(e));
      e.plan.push(en);
      e.planEditing = en.id;
      name = itemName(en.item, en.material);
    });
    toast(`Added another ${name} to your plan`);
  }

  function updateEntry() {
    set((e) => {
      const en = e.plan.find((x) => x.id === e.planEditing);
      if (!en) return;
      Object.assign(en, snapshot(e), { ticks: [], done: false, gearId: e.gearId || en.gearId || null });
      if (!canUpgrade(en)) en.upgrade = false;
    });
    toast('Plan item updated');
  }

  /** Load a planned item into the single-item editor. */
  function editEntry(en) {
    set((e) => {
      e.mode = 'single';
      e.item = itemById[en.item] ? en.item : 'sword';
      if (MATS.includes(en.material)) e.material = en.material;
      e.existing = Object.assign({}, en.existing); e.uses = en.uses; e.selected = Object.assign({}, en.selected);
      e.loadout = null;
      e.gearId = en.gearId && e.gear.some((g) => g.id === en.gearId) ? en.gearId : null;
      e.planEditing = en.id;
    });
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function newItem() {
    set((e) => { e.mode = 'single'; resetPlan(e); });
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  const withEntry = (id, fn) => set((e) => { const en = e.plan.find((x) => x.id === id); if (en) fn(en, e); });

  function tick(id, key, on) {
    withEntry(id, (en) => {
      en.ticks = en.ticks.filter((k) => k !== key);
      if (on) en.ticks.push(key);
    });
  }

  /** Check an item off (or back on). Checking it also updates the saved gear it came from; unchecking restores that. */
  function setDone(id, on, p) {
    let gearName = null;
    withEntry(id, (x, e) => {
      const gg = x.gearId && e.gear.find((y) => y.id === x.gearId);
      if (on) {
        if (gg && p && p.final) {
          x.gearBefore = { item: gg.item, material: gg.material, enchants: Object.assign({}, gg.enchants), uses: gg.uses };
          gg.item = x.item; gg.material = x.material;
          gg.enchants = Object.assign({}, p.final.enchants);
          gg.uses = Math.min(p.final.uses, MAX_USES + 4); gg.updated = Date.now();
          gearName = gg.name;
        }
        x.done = true;
        // the applied books leave your inventory: consume owned copies (floor 0), remembered for undo
        const used = {};
        usedBooks(entryPlan(x)).forEach((b) => {
          const k = b.id + ':' + b.level;
          if ((e.booksOwned[k] || 0) - (used[k] || 0) > 0) used[k] = (used[k] || 0) + 1;
        });
        Object.keys(used).forEach((k) => { e.booksOwned[k] -= used[k]; if (e.booksOwned[k] <= 0) delete e.booksOwned[k]; });
        if (Object.keys(used).length) x.booksUsed = used; else delete x.booksUsed;
      } else {
        Object.keys(x.booksUsed || {}).forEach((k) => { e.booksOwned[k] = (e.booksOwned[k] || 0) + x.booksUsed[k]; });
        delete x.booksUsed;
        if (gg && x.gearBefore) { Object.assign(gg, x.gearBefore, { updated: Date.now() }); }
        delete x.gearBefore;
        x.done = false;
      }
    });
    if (on) toast(gearName ? `Done — “${gearName}” updated` : 'Item done');
  }

  /** The editor's Done button: adds the item to the plan if needed, then checks it off / back on. */
  function doneFromEditor(plan) {
    const cur = st();
    let en = editingEntry(cur);
    if (en && en.done) { setDone(en.id, false); return; }
    if (!en) {
      set((e) => {
        const n = Object.assign({ id: uid('plan'), upgrade: false, gearId: e.gearId || null, ticks: [], done: false, added: Date.now() }, snapshot(e));
        e.plan.push(n); e.planEditing = n.id; en = n;
      });
    } else if (!sameEntry(en, cur)) {
      set((e) => { const x = e.plan.find((y) => y.id === en.id); if (x) Object.assign(x, snapshot(e), { ticks: [] }); });
    }
    setDone(en.id, true, plan);
  }

  function removeEntry(en) {
    set((e) => {
      e.plan = e.plan.filter((x) => x.id !== en.id);
      if (e.planEditing === en.id) e.planEditing = null;
    });
  }

  /** Obtained ticks remember how many were needed, so they untick when the plan needs more. */
  const isGot = (s, key, need) => (s.planGot[key] || 0) >= need;
  const setGot = (key, need, on) => set((e) => { if (on) e.planGot[key] = need; else delete e.planGot[key]; });
  /** Books in hand per enchant:level; changes by delta, never below 0. */
  const owned = (s, key) => s.booksOwned[key] || 0;
  const bumpOwned = (key, delta) => set((e) => {
    const n = Math.max(0, (e.booksOwned[key] || 0) + delta);
    if (n) e.booksOwned[key] = n; else delete e.booksOwned[key];
  });

  /* ---------- planner: view ---------- */

  /** Single item / My plan as a slider: one persistent element (so the thumb glides between the two positions on a re-render). */
  let modeEl = null;
  function renderModeCards(s) {
    const total = s.plan.length;
    if (!modeEl) {
      const card = (mode, label, icon) => h('button.btn.ec-modecard', {
        type: 'button', 'data-m': mode, 'data-focus': 'ec-mode-' + mode,
        // only the Edit button links the editor to a plan item; leaving for the plan ends that session
        onclick: () => set((e) => { e.mode = mode; if (mode === 'plan') e.planEditing = null; }),
      }, h('span.ec-modecard-ico', TH.icon(icon, { size: 28 }), h('b.ec-modecard-n')), h('span.ec-modecard-t', label));
      modeEl = h('div.ec-modecards', { role: 'group', 'aria-label': 'Enchanting view', 'data-mode': s.mode },
        h('span.ec-slide-thumb', { 'aria-hidden': 'true' }), card('single', 'Single item', 'enchanted_book'), card('plan', 'My plan', 'item/writable_book'));
    }
    const editing = !!editingEntry(s) && s.mode === 'single';
    const single = modeEl.querySelector('[data-m="single"]');
    if (single.dataset.edit !== String(editing)) {
      single.dataset.edit = String(editing);
      single.querySelector('.ec-modecard-t').textContent = editing ? 'Edit mode' : 'Single item';
      single.querySelector('.ec-modecard-ico').firstChild.replaceWith(TH.icon(editing ? 'anvil' : 'enchanted_book', { size: 28 }));
    }
    modeEl.querySelectorAll('.ec-modecard').forEach((b) => {
      const on = b.dataset.m === s.mode;
      b.setAttribute('aria-pressed', String(on));
      if (b.dataset.m === 'plan') {
        b.disabled = total === 0 && s.mode !== 'plan';
        b.title = total === 0 ? 'Add an item to your plan first' : '';
        const n = b.querySelector('.ec-modecard-n'); n.textContent = total || ''; n.hidden = !total;
      }
    });
    modeEl.dataset.editing = editing ? '1' : '';
    if (modeEl.dataset.mode !== s.mode) setTimeout(() => { void modeEl.offsetWidth; modeEl.dataset.mode = s.mode; }, 0);
    return modeEl;
  }

  function renderModeSwitch(s, vertical) {
    const n = s.plan.filter((x) => !x.done).length;
    const total = s.plan.length;
    const btn = (mode, label, icon, extra) => h('button' + (s.mode === mode ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(s.mode === mode), 'data-focus': 'ec-mode-' + mode,
      disabled: mode === 'plan' && total === 0 && s.mode !== 'plan', title: mode === 'plan' && total === 0 ? 'Add an item to your plan first' : null,
      onclick: () => set((e) => { e.mode = mode; }),
    }, TH.icon(icon, { size: 16 }), h('span', label), extra);
    return h('div.seg.ec-mode' + (vertical ? '.is-vertical' : ''), { role: 'group', 'aria-label': 'Enchanting view' },
      btn('single', 'Single item', 'enchanted_book'),
      btn('plan', 'My plan', 'item/writable_book', total ? h('span.nav-badge.count', { 'aria-label': (total - n) + ' of ' + total + ' items done' }, (total - n) + '/' + total) : null));
  }

  /** Banner above the editor while it is linked to a plan entry. */
  function renderLinked(s) {
    const en = editingEntry(s);
    if (!en) return null;
    const idx = s.plan.indexOf(en) + 1;
    const dirty = !sameEntry(en, s);
    return h('div.ec-linked',
      TH.icon('item/writable_book', { size: 18 }),
      h('span.ec-linked-text', 'Editing plan item ', h('b', idx + ' of ' + s.plan.length), ' · ', itemName(en.item, en.material),
        dirty ? h('span.ec-linked-dirty', ' — press “Update plan item” to keep changes') : null),
      h('button.btn.small.ghost', { type: 'button', 'data-focus': 'ec-linked-back', onclick: () => set((e) => { e.mode = 'plan'; }) }, 'Back to plan'),
      h('button.btn.small.ghost', { type: 'button', title: 'Unlink the editor from this plan item', onclick: () => set((e) => { e.planEditing = null; }) }, 'Detach'));
  }

  function sourceChip(offers, id, level, count) {
    if (!byId[id] || !byId[id].librarian) return h('span.ec-hall.none', 'Not sold by librarians (treasure)');
    if (!offers) return null;
    const o = offers[id];
    if (!o) return h('span.ec-hall.missing', 'Not in hall');
    if (o.level < level) return h('span.ec-hall.low', 'Hall only has ' + lvl(o.level));
    return h('span.ec-hall.have', { title: o.price != null ? `In hall · ${o.price} emeralds + 1 book${count > 1 ? ' each' : ''}` : 'In hall · price not set' },
      h('span.ec-hall-text', 'In hall ·'),
      o.price != null ? [h('span.ec-price', h('b', o.price), emerald()), count > 1 ? h('span.ec-each', 'each') : null] : h('span.ec-hall-text', 'price not set'),
      o.perfect ? h('span.ec-star', { 'aria-label': 'perfect price' }, '★') : null);
  }

  /** Past level 30 every level costs more XP (levels 0-15: 2n+7 points, 16-30: 5n-38, 31+: 9n-158), so big totals are best done in rounds. */
  function xpHint(levels) {
    if (levels <= 30) return null;
    return h('p.ec-xp-hint', { tabindex: '0', title: 'More than 30 levels still to spend. Levels beyond 30 get expensive: each one costs 112 or more XP points (7–37 up to level 15, 42–107 up to level 30), so gather XP in rounds instead of banking it all at once.' }, TH.icon('xp', { size: 16 }), h('span', 'CAUTION: Level Efficiency'));
  }

  function progressBar(done, total, label) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return h('div.ec-prog' + (total && done === total ? '.full' : ''),
      h('div.bar', { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('span', { style: { width: pct + '%' } })),
      h('span.ec-prog-n', h('b', done), '/' + total));
  }

  function todoRow(id, key, checked, body, cost, extraCls) {
    const inputId = `ec-todo-${id}-${key}`;
    return h('li.ec-todo' + (checked ? '.on' : '') + (extraCls || ''),
      h('label.check', h('input', {
        type: 'checkbox', id: inputId, checked, 'data-focus': inputId,
        onchange: (ev) => tick(id, key, ev.target.checked),
      }), h('span', key === 's' ? '↑' : key.slice(1))),
      h('label.ec-todo-body', { for: inputId }, body),
      cost);
  }

  function renderEntry(en, p, s, idx, needSet) {
    needSet = needSet || new Set();
    const name = itemName(en.item, en.material);
    const gear = en.gearId ? s.gear.find((g) => g.id === en.gearId) : null;
    const books = usedBooks(p);
    const remove = h('button.btn.small.ec-pi-x', { type: 'button', title: 'Remove from plan', 'aria-label': 'Remove ' + name + ' from plan', 'data-focus': 'ec-pi-rm-' + en.id, onclick: () => removeEntry(en) }, '✕');

    if (en.done) {
      const fin = p.final ? p.final.enchants : {};
      return h('article.ec-pi.done',
        h('span.ec-pi-icon', itemIcon(en.item, en.material, 32)),
        h('div.ec-pi-title', h('b', name), gear ? h('span.faint', gear.name) : null),
        h('div.ec-final-ench.ec-pi-ench', sortIds(Object.keys(fin)).map((id) => h('span.ec-ench-pill', lvlName(id, fin[id])))),
        h('label.ec-done-check', { title: 'Uncheck to put it back on your to-do list' },
          h('span.check', h('input', { type: 'checkbox', checked: true, 'aria-label': name + ' is done', 'data-focus': 'ec-pi-done-' + en.id, onchange: () => setDone(en.id, false) }), h('span')),
          h('span.ec-done-pill', 'Done')),
        h('div.ec-pi-actions', remove));
    }

    // to-do rows: optional smithing upgrade, then the anvil steps
    const rows = [];
    const upgrade = en.upgrade && canUpgrade(en);
    if (upgrade) {
      rows.push({
        key: 's',
        body: h('span.ec-todo-line',
          h('span.ec-todo-tag', 'Smithing table'),
          h('span.ec-node', itemIcon(en.item, 'diamond', 20), h('span', itemName(en.item, 'diamond'))),
          h('span.ec-plus', { 'aria-hidden': 'true' }, '+'),
          UPGRADE.map((m) => h('span.ec-node.mat', { title: matItemName(m) }, TH.icon(m.icon, { size: 20 }), h('span.ec-node-sr', matItemName(m))))),
        cost: h('span.ec-step-cost', h('span.ec-arrow', { 'aria-hidden': 'true' }, '→ '), itemIcon(en.item, 'netherite', 20)),
      });
    }
    p.steps.forEach((x) => rows.push({
      key: 'n' + x.n,
      bad: x.cost > 39,
      body: h('span.ec-todo-line',
        nodeChip(x.target, en, needSet.has(en.id + '|' + x.n + '|t')), h('span.ec-plus', { 'aria-hidden': 'true' }, '+'), nodeChip(x.sacrifice, en, needSet.has(en.id + '|' + x.n + '|s'))),
      cost: h('span.ec-step-cost' + (x.cost > 39 ? '.bad' : x.cost >= 30 ? '.warn' : ''),
        x.cost > 39 ? 'Too Expensive!' : [h('span.ec-arrow', { 'aria-hidden': 'true' }, '→ '), h('b', x.cost), ' lvl']),
    }));
    const done = rows.filter((r) => en.ticks.includes(r.key)).length;
    const all = rows.length > 0 && done === rows.length;

    let alert = null;
    if (p.error) alert = h('p.ec-alert', p.error);
    else if (!p.ok) {
      alert = h('p.ec-alert', TH.icon('item/barrier', { size: 14 }), h('span', 'Too Expensive! — ',
        p.partial ? ['leave out ', h('b', p.partial.dropped.map((b) => lvlName(b.id, b.level)).join(', ')), '. Steps below skip it.'] : 'no order works. Edit this item.'));
    }

    const meta = [rows.length ? (p.totalLevels || 0) + ' levels' : null, gear ? gear.name : null,
      Object.keys(en.existing).length ? 'has ' + Object.keys(en.existing).length + ' enchant' + (Object.keys(en.existing).length > 1 ? 's' : '') : null,
      en.uses ? en.uses + ' anvil use' + (en.uses === 1 ? '' : 's') : null].filter(Boolean).join(' · ') || 'fresh item';
    return h('article.ec-pi.ec-pi-split' + (all ? '.complete' : ''), { 'aria-label': name },
      h('div.ec-pi-id',
        h('span.ec-pi-icon', itemIcon(en.item, en.material, 48)),
        h('b.ec-pi-name', name)),
      h('div.ec-pi-steps',
        canUpgrade(en) ? h('label.ec-tile' + (upgrade ? '.on' : ''),
          h('span.switch', h('input', {
            type: 'checkbox', checked: upgrade, 'data-focus': 'ec-pi-up-' + en.id,
            onchange: (ev) => withEntry(en.id, (x) => { x.upgrade = ev.target.checked; x.ticks = x.ticks.filter((k) => k !== 's'); }),
          }), h('span')),
          h('span.ec-tile-text', h('b', 'Upgrading from diamond'), h('span', 'Adds the smithing step and its materials'))) : null,
        alert,
        rows.length ? h('ol.ec-todos', rows.map((r) => todoRow(en.id, r.key, en.ticks.includes(r.key), r.body, r.cost, r.bad ? '.bad' : ''))) : null),
      h('div.ec-pi-aside',
        h('span.faint.ec-pi-meta', meta),
        rows.length ? h('span.ec-pi-prog', h('b', done), '/' + rows.length + ' steps') : null,
        hitsNaive(p) ? oneBookWarn() : null,
        h('div.ec-pi-actions',
          h('button.btn.small', { type: 'button', title: 'Load into the editor', 'data-focus': 'ec-pi-edit-' + en.id, onclick: () => editEntry(en) }, 'Edit'),
          h('button.btn.small' + (all ? '.primary' : ''), { type: 'button', 'data-focus': 'ec-pi-done-' + en.id, title: gear ? 'Check off and update “' + gear.name + '”' : 'Check this item off', onclick: () => setDone(en.id, true, p) }, 'Done'),
          remove)));
  }

  function renderPlanView(state, s) {
    if (!s.plan.length) {
      return h('div.ec-layout.ec-layout-single.is-empty', h('div.ec-main', h('div.ec-modewrap', renderModeCards(s)), h('div.ec-toprow', h('section.panel.ec-card.ec-pv-empty',
        h('div.empty',
          h('div.empty-icon', { 'aria-hidden': 'true' }, TH.icon('item/writable_book', { size: 44 })),
          h('h3', 'Your plan is empty'),
          h('p', 'Plan everything you want to enchant — a sword, a pickaxe, a full set of armor — and get one shopping list and one to-do list.'),
          h('ol.ec-howto',
            h('li', 'Switch to ', h('b', 'Single item'), ' and pick an item.'),
            h('li', 'Choose its enchantments (and what it already has).'),
            h('li', 'Press ', h('b', 'Add to plan'), '. Repeat for every item.')),
          h('button.btn.primary', { type: 'button', 'data-focus': 'ec-pv-start', onclick: newItem }, 'Pick the first item'))))));
    }

    const offers = hallOffers(state);
    const rows = s.plan.map((en) => ({ en, p: entryPlan(en) }));
    const open = rows.filter((r) => !r.en.done);
    const finished = rows.length - open.length;

    // books, merged over every open item
    const need = new Map();
    open.forEach(({ en, p }) => usedBooks(p).forEach((b) => {
      const key = b.id + ':' + b.level;
      if (!need.has(key)) need.set(key, { key, id: b.id, level: b.level, count: 0, items: [] });
      const x = need.get(key);
      x.count++;
      x.items.push(itemName(en.item, en.material));
    }));
    const books = [...need.values()].sort((a, b) => b.count - a.count || enchName(a.id).localeCompare(enchName(b.id)));
    const bookTotal = books.reduce((n, b) => n + b.count, 0);
    const gotBooks = books.reduce((n, b) => n + Math.min(owned(s, b.key), b.count), 0);

    // costs
    let levels = 0, points = 0, left = 0, emeralds = 0, hallBooks = 0, unpriced = 0, bad = 0;
    open.forEach(({ en, p }) => {
      if (!p.ok) bad++;
      p.steps.forEach((x) => { levels += x.cost; points += x.xp; if (!en.ticks.includes('n' + x.n)) left += x.cost; });
    });
    books.forEach((b) => {
      const stt = hallStatus(offers, b.id, b.level);
      if (stt && stt.cls === 'have') {
        hallBooks += b.count;
        if (stt.price != null) emeralds += stt.price * b.count; else unpriced += b.count;
      }
    });
    const ups = open.filter(({ en }) => en.upgrade && canUpgrade(en)).length;

    // progress always covers the whole plan: finished items count as fully done
    let levelsAll = 0, spentAll = 0, stepsAll = 0, stepsDoneAll = 0;
    rows.forEach(({ en, p }) => {
      const upg = en.upgrade && canUpgrade(en);
      const n = p.steps.length + (upg ? 1 : 0);
      const lv = p.steps.reduce((a, x) => a + x.cost, 0);
      stepsAll += n; levelsAll += lv;
      if (en.done) { stepsDoneAll += n; spentAll += lv; return; }
      p.steps.forEach((x) => { if (en.ticks.includes('n' + x.n)) { stepsDoneAll++; spentAll += x.cost; } });
      if (upg && en.ticks.includes('s')) stepsDoneAll++;
    });
    const allSteps = open.reduce((n, { en, p }) => n + p.steps.length + (en.upgrade && canUpgrade(en) ? 1 : 0), 0);
    const doneSteps = open.reduce((n, { en, p }) => n + en.ticks.filter((k) => k === 's' ? en.upgrade && canUpgrade(en) : p.steps.some((x) => 'n' + x.n === k)).length, 0);

    // ---- left: the same top row as Single item (mode slider + a summary panel), then the to-do list ----
    const planTools = h('div.ec-pv-tools',
      h('h3.ec-pick-label', 'Your plan'),
      h('span.spacer'),
      finished ? h('button.btn.small.ghost', { type: 'button', onclick: () => set((e) => { e.plan = e.plan.filter((x) => !x.done); }) }, 'Clear finished (' + finished + ')') : null,
      h('button.btn.small.ghost.danger', {
        type: 'button', onclick: () => {
          TH.util.guard(true, 'Remove every item from your plan?', () => set((e) => { e.plan = []; e.planGot = {}; e.booksOwned = {}; e.planEditing = null; }), 'Clear plan');
        },
      }, 'Clear plan'));

    // which book slots in the steps are still missing: owned copies are handed out in plan order, ticked steps are done
    const pool = {};
    Object.keys(s.booksOwned).forEach((k) => { pool[k] = s.booksOwned[k]; });
    const needSet = new Set();
    const usedMap = {};   // book copies already spent by ticked steps
    open.forEach(({ en, p }) => p.steps.forEach((x) => {
      if (en.ticks.includes('n' + x.n)) {
        [x.target, x.sacrifice].forEach((node) => {
          if (node && node.kind === 'book' && node.fromStep == null && node.enchants && node.enchants.length === 1) {
            const key = node.enchants[0].id + ':' + node.enchants[0].level;
            usedMap[key] = (usedMap[key] || 0) + 1;
          }
        });
        return;
      }
      [['t', x.target], ['s', x.sacrifice]].forEach(([side, node]) => {
        if (!node || node.kind !== 'book' || node.fromStep != null || !node.enchants || node.enchants.length !== 1) return;
        const key = node.enchants[0].id + ':' + node.enchants[0].level;
        if (pool[key] > 0) pool[key]--; else needSet.add(en.id + '|' + x.n + '|' + side);
      });
    }));
    const list = armorToolSections(rows.map((r, i) => Object.assign({ i }, r)), (r) => r.en.item, (r) => renderEntry(r.en, r.p, s, r.i, needSet), '.ec-pi-list', (list) => '.panel.ec-pv-cat' + (list.some((r) => r.en.id === s.planEditing) ? '.has-sel' : ''));

    // ---- right: shopping list in the sticky Anvil-plan style, floating actions at the foot ----
    const naiveCount = open.filter(({ p }) => hitsNaive(p)).length;
    const hitsNaive1 = naiveCount ? oneBookWarn(naiveCount + ' of your items:') : null;
    const costs = h('section.ec-pv-sec.ec-costs', { 'aria-label': 'Costs total' },
      h('h3.ec-pick-label', 'Progress'),
      h('div.ec-progress',
        h('div.ec-pg-big', h('span.ec-xp', left), h('span.ec-total-label', left === 0 && levels ? 'levels left: all spent' : 'levels left to spend')),
        h('div.ec-xpbar', { role: 'progressbar', 'aria-label': 'Levels spent', 'aria-valuemin': 0, 'aria-valuemax': levelsAll, 'aria-valuenow': spentAll },
          h('span', { style: { width: (levelsAll ? Math.round((spentAll / levelsAll) * 100) : 0) + '%' } })),
        h('div.ec-pg-spent', h('span.ec-pg-nums', h('b', spentAll), ' / ', h('b', levelsAll)), h('span', 'levels spent')),
        h('div.ec-pg-chips', hitsNaive1, xpHint(left)),
        h('div.ec-pg-xp', h('b', points.toLocaleString()), ' XP points in total'),
        h('div.ec-pg-meta',
          h('span', h('b', stepsDoneAll + '/' + stepsAll), ' anvil steps done'),
          h('span', h('b', open.length), open.length === 1 ? ' item to do' : ' items to do'),
          ups ? h('span', TH.icon('item/netherite_ingot', { size: 16 }), h('b', ups), ' netherite upgrade' + (ups === 1 ? '' : 's')) : null)),
      unpriced ? h('p.ec-pv-note', unpriced + ' hall book' + (unpriced > 1 ? 's have' : ' has') + ' no price yet — set it in the Trading Hall tab.') : null,
      bad ? h('p.ec-alert', TH.icon('item/barrier', { size: 14 }), h('span', bad + ' item' + (bad > 1 ? 's hit' : ' hits') + ' Too Expensive! — see the checklist.')) : null);

    const head = h('section.panel.ec-card.ec-pv-head.ec-pv-costs', { 'aria-label': 'Plan progress' }, costs);

    const bookBox = h('section.ec-pv-sec', { 'aria-label': 'Books to get' },
      h('div.ec-sub-head', 'Books to get', h('span.faint', bookTotal)),
      bookTotal ? progressBar(gotBooks, bookTotal, 'Books obtained') : null,
      books.length
        ? h('ul.ec-buy', books.map((b) => {
          const have = owned(s, b.key), full = have >= b.count, spare = Math.max(0, have - b.count), spent = (usedMap[b.key] || 0) >= b.count;
          const nm = lvlName(b.id, b.level);
          return h('li.ec-buy-row' + (spent ? '.spent' : full ? '.on' : ''), { 'data-book': b.key },
            h('div.ec-step', { role: 'group', 'aria-label': nm + ' books obtained' },
              h('button.ec-step-btn', { type: 'button', 'aria-label': 'One fewer ' + nm, disabled: !have, 'data-focus': 'ec-got-dec-' + b.key, onclick: () => bumpOwned(b.key, -1) }, '−'),
              h('span.ec-step-n', { 'aria-live': 'polite' }, h('b', have), '/' + b.count),
              h('button.ec-step-btn', { type: 'button', 'aria-label': 'One more ' + nm, 'data-focus': 'ec-got-inc-' + b.key, onclick: () => bumpOwned(b.key, 1) }, '+')),
            bookIcon(20),
            h('div.ec-buy-text', { title: b.items.join(', ') },
              h('span.ec-buy-name', nm, b.count > 1 ? h('span.ec-x', '×' + b.count) : null, spare ? h('span.ec-spare', spare + ' spare') : null),
            ),
            sourceChip(offers, b.id, b.level, b.count));
        }))
        : h('p.ec-pv-note', 'Nothing to buy — every open item is done or has no books.'));

    const matBox = ups ? h('section.ec-pv-sec', { 'aria-label': 'Base item materials' },
      h('div.ec-sub-head', 'Base item materials', h('span.faint', 'diamond → netherite')),
      h('ul.ec-buy', UPGRADE.map((m) => {
        const n = m.count * ups, key = 'mat:' + m.id, got = isGot(s, key, n);
        const inputId = 'ec-got-' + m.id;
        return h('li.ec-buy-row' + (got ? '.on' : ''),
          h('label.check', h('input', { type: 'checkbox', id: inputId, checked: got, 'data-focus': inputId, onchange: (ev) => setGot(key, n, ev.target.checked) }), h('span')),
          TH.icon(m.icon, { size: 20 }),
          h('label.ec-buy-text', { for: inputId }, h('span.ec-buy-name', matItemName(m), h('span.ec-x', '×' + n))));
      }))) : null;

    const actions = h('div.th-act-row', { role: 'group', 'aria-label': 'Plan actions' },
      h('button.btn.primary', { type: 'button', 'data-focus': 'ec-pv-add', onclick: newItem }, '+ Add another item'),
      h('button.btn', { type: 'button', onclick: () => window.print() }, 'Print'));

    return h('div.ec-layout.ec-layout-single',
      h('div.ec-main', h('div.ec-toprow', head), h('section.ec-pv-list', { 'aria-label': 'Anvil to-do checklist' }, list)),
      h('div.ec-side', h('aside.panel.ec-plan.ec-pvshop', { 'aria-label': 'Shopping list' }, renderModeCards(s), planTools, h('div.ec-plan-body', bookBox, matBox), actions)));
  }

  /* ---------- page ---------- */

  /* Re-renders (material / item / mode switches, presets, ticks) swap the DOM in place with NO entrance animation:
     the staggered entrance belongs to tool-tab switches only (app.js adds .module.enter when the tab changes). */

  function render(root, state) {
    const s = state.enchanting;
    if (!itemById[s.item]) s.item = 'sword';
    if (!MATS.includes(s.material)) s.material = 'diamond';
    if (!fits(itemById[s.item], s.material)) s.material = itemById[s.item].defaultMaterial;
    const planMode = s.mode === 'plan';
    const plan = planMode ? null : currentPlan(s);
    TH.util.append(root, [
      h('div.page-head', h('div', h('h2', 'Enchanting'))),
      // the Single item / My plan switch sits centred on top of the right column (grid area "mode", enchanting.css)
      planMode ? renderPlanView(state, s) : [
        renderGear(state),
        h('div.ec-layout.ec-layout-single',
          h('div.ec-main', renderPicker(s), renderSelect(state, s)),
          h('div.ec-side', renderPlan(state, s, plan))),
      ],
    ]);
    root.querySelectorAll('[title]').forEach((el) => TH.util.tooltip(el)); // app tooltip instead of native title
    queueMicrotask(fitSide);   // right after the swap, before the first paint (no jump)
    queueFitSide();
  }

  /* Keep the sticky sidebar inside the visible area (as the hall's wizard sidebar): from its current top (below the top
     bar, or its own place in the page while that is lower) to the viewport bottom / end of the layout, so the floating
     Add to plan / Done row is on screen without scrolling first. */
  let sideTimer = 0;
  function fitSide() {
    const s = document.querySelector('.ec-side');
    if (!s) return;
    const cs = getComputedStyle(s);
    if (cs.position !== 'sticky') { s.style.maxHeight = ''; return; }
    const z = parseFloat(document.documentElement.style.zoom) || 1;   // the page runs at CSS zoom: rects are screen px, max-height is CSS px
    const top = Math.max((parseFloat(cs.top) || 0) * z, s.getBoundingClientRect().top);
    const bottom = Math.min(innerHeight - 8, s.parentElement.getBoundingClientRect().bottom);
    const hpx = Math.max(200, Math.round((bottom - top) / z)) + 'px';
    s.style.maxHeight = hpx;
    s.style.height = '';
  }
  function queueFitSide() { clearTimeout(sideTimer); sideTimer = setTimeout(fitSide, 0); }   // timer, not rAF (stalls in background tabs)

  function migrate(s) {
    if (!Array.isArray(s.gear)) s.gear = [];
    s.renaming = null;
    s.own = !!s.own;
    if (typeof s.renameCost !== 'string') s.renameCost = '';
    if (typeof s.anvilName !== 'string') s.anvilName = '';
    s.uses = clamp(s.uses | 0, 0, MAX_USES + 4);
    if (!MATS.includes(s.material)) s.material = 'diamond';
    if (s.mode !== 'plan') s.mode = 'single';
    if (!s.planGot || typeof s.planGot !== 'object' || Array.isArray(s.planGot)) s.planGot = {};
    if (!s.booksOwned || typeof s.booksOwned !== 'object' || Array.isArray(s.booksOwned)) s.booksOwned = {};
    Object.keys(s.booksOwned).forEach((k) => { const n = Math.floor(Number(s.booksOwned[k])); if (n > 0) s.booksOwned[k] = n; else delete s.booksOwned[k]; });
    // old shape: planGot['ench:level'] = count needed when ticked (true) -> books owned
    Object.keys(s.planGot).forEach((k) => {
      if (k.indexOf('mat:') === 0) return;
      const n = s.planGot[k] === true ? 1 : Math.floor(Number(s.planGot[k]));
      if (n > 0) s.booksOwned[k] = Math.max(s.booksOwned[k] || 0, n);
      delete s.planGot[k];
    });
    if (!Array.isArray(s.plan)) s.plan = [];
    s.plan = s.plan.filter((en) => en && itemById[en.item]).map((en) => {
      const it = itemById[en.item];
      const material = isPlain(it) ? 'plain' : it.materials.includes(en.material) ? en.material : it.defaultMaterial;
      const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
      return {
        id: en.id || uid('plan'), item: en.item, material,
        existing: obj(en.existing), uses: clamp(en.uses | 0, 0, MAX_USES + 4), selected: obj(en.selected),
        upgrade: !!en.upgrade && material === 'netherite', gearId: en.gearId || null,
        ticks: Array.isArray(en.ticks) ? en.ticks.filter((k) => typeof k === 'string') : [],
        done: !!en.done, added: en.added || Date.now(),
        booksUsed: en.booksUsed && typeof en.booksUsed === 'object' ? en.booksUsed : undefined,
        gearBefore: en.gearBefore && typeof en.gearBefore === 'object' ? en.gearBefore : undefined,
      };
    });
    if (!s.plan.some((en) => en.id === s.planEditing)) s.planEditing = null;
  }

  TH.app.register({
    id: 'enchanting', name: 'Enchanting', icon: 'mc:enchanted_book',
    init(store) {
      store.define('enchanting', DEFAULTS);
      migrate(store.get().enchanting);
      window.addEventListener('scroll', queueFitSide, { passive: true });
      window.addEventListener('resize', queueFitSide);
    },
    render,
    badge(state) {
      const plan = (state.enchanting && state.enchanting.plan) || [];
      return plan.length ? { done: plan.filter((x) => x.done).length, total: plan.length } : null;
    },
  });
})();
