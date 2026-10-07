/**
 * Enchanting module — item picker, enchant selection and optimal anvil order.
 *
 * state.enchanting = {
 *   item: 'sword', material: 'diamond',  // material = picked material row (plain items ignore it)
 *   existing: { [enchId]: level },      // enchantments already on the item
 *   uses: 0,                            // prior anvil uses (penalty 2^n − 1)
 *   showExisting: false,                // "already enchanted" panel open
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
 *   planGot: { 'protection:4': 3, 'mat:netherite_ingot': 1 }, // obtained ticks = count needed when ticked
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
    item: 'sword', material: 'diamond', existing: {}, uses: 0, showExisting: false,
    selected: {}, loadout: null, gearId: null, gear: [], saveName: '', renaming: null, renameText: '',
    mode: 'single', planEditing: null, plan: [], planGot: {}, renameCost: '', anvilName: '',
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
    if (!ench.librarian) return { cls: 'none', text: 'not sold by librarians' };
    if (!offers) return null;
    const o = offers[id];
    if (!o) return { cls: 'missing', text: 'not in your hall' };
    if (o.level >= level) return { cls: 'have', text: 'In your hall', price: o.price, perfect: o.perfect };
    return { cls: 'low', text: `Hall has ${lvl(o.level)}`, price: o.price };
  }

  function hallChip(status) {
    if (!status) return null;
    return h('span.ec-hall.' + status.cls, { title: status.text + (status.price != null ? ` · ${status.price} emeralds` : '') },
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
    e.existing = {}; e.selected = {}; e.uses = 0; e.loadout = null; e.gearId = null; e.showExisting = false; e.planEditing = null; e.anvilName = '';
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
      if (e.selected[id]) { delete e.selected[id]; return; }
      for (const c of conflictList(id, Object.keys(e.selected))) delete e.selected[c];
      e.selected[id] = Math.max(byId[id].maxLevel, 1);
    });
  }

  function setSelectedLevel(id, level) {
    set((e) => {
      for (const c of conflictList(id, Object.keys(e.selected))) delete e.selected[c];
      e.selected[id] = level;
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
  const ARMOR_IDS = ['helmet', 'chestplate', 'leggings', 'boots', 'elytra', 'shield'];
  const isArmorItem = (id) => ARMOR_IDS.includes(id);
  function armorToolSections(entries, itemOf, render, listCls) {
    const armor = entries.filter((x) => isArmorItem(itemOf(x))).sort((a, b) => ARMOR_IDS.indexOf(itemOf(a)) - ARMOR_IDS.indexOf(itemOf(b)));
    const tools = entries.filter((x) => !isArmorItem(itemOf(x)));
    return [['Armor', armor], ['Tools', tools]].filter(([, l]) => l.length).map(([name, l]) => h('div.ec-sec',
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
              e.uses = g.uses; e.selected = {}; e.loadout = null; e.gearId = g.id; e.showExisting = true; e.planEditing = null;
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
                if (!confirm(`Delete “${g.name}”?`)) return;
                set((e) => { e.gear = e.gear.filter((x) => x.id !== g.id); if (e.gearId === g.id) e.gearId = null; });
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
  const HUD_ARMOR = ['helmet', 'chestplate', 'leggings', 'boots', 'shield', 'elytra'];
  const HUD_TOOLS = ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'spear', 'bow', 'crossbow', 'trident', 'mace', 'fishing_rod'];

  /** Material-less name for greyed-out tiles ("Sword", "Fishing Rod"). */
  const genericName = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  function itemButton(itemId, s, extraCls) {
    const it = itemById[itemId];
    if (!it) return null;
    const ok = fits(it, s.material);
    const on = ok && it.id === s.item;
    const name = ok ? itemName(it.id, s.material) : genericName(it.id);
    const tip = ok ? name : 'Not available in ' + matName(s.material);
    return h('button.ec-item' + (on ? '.on' : '') + (ok ? '' : '.na') + (extraCls || ''), {
      type: 'button', 'aria-pressed': String(on), 'data-focus': 'ec-item-' + it.id, title: tip, disabled: !ok,
      onclick: () => pickItem(it.id),
    },
    ok ? itemIcon(it.id, s.material, 32) : itemIcon(it.id, it.materials.includes('iron') ? 'iron' : it.defaultMaterial, 32),
    h('span.ec-item-name', name),
    it.since ? h('span.ec-new', it.since) : null);
  }

  function renderPicker(s) {
    const placed = new Set(HUD_ARMOR.concat(HUD_TOOLS));
    const rest = D.items.filter((i) => !placed.has(i.id)).map((i) => i.id);
    const hint = materialHint(s.material);
    return h('section.panel.ec-card.ec-picker',
      h('div.ec-card-head', h('span.ec-num', '1'), h('h3', 'Pick material, then item')),
      h('div.ec-mats', { role: 'radiogroup', 'aria-label': 'Material' }, MATS.map((m) => {
        const on = s.material === m;
        const nm = matName(m);
        return h('button.ec-mat' + (on ? '.on' : ''), {
          type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': nm, 'data-focus': 'ec-mat-' + m,
          title: nm, onclick: () => pickMaterial(m),
        }, matIcon(m, 26));
      })),
      h('div.ec-mat-line', h('b', matName(s.material)), hint ? h('span.ec-mat-hint', hint) : null),
      h('div.ec-segs',
        h('div.ec-seg', h('div.ec-group-name', h('span', 'Armor')),
          h('div.ec-slots.armor', HUD_ARMOR.map((id) => itemButton(id, s)))),
        h('div.ec-seg', h('div.ec-group-name', h('span', 'Tools & weapons')),
          h('div.ec-slots.grid', HUD_TOOLS.concat(rest).map((id) => itemButton(id, s))))),
    );
  }

  /* ---------- 2. current item ---------- */

  /** Reads the anvil's rename cost back into prior-work penalty and anvil uses. */
  function renameResult(raw) {
    const n = parseInt(raw, 10);
    if (!raw || !isFinite(n)) return { text: 'Enter the cost to see how many times it went through an anvil.' };
    if (n < 1) return { text: 'The rename cost is at least 1.' };
    const pen = n - 1;
    const uses = Math.log2(pen + 1);
    if (!Number.isInteger(uses)) return { text: `Penalty ${pen} isn’t 0, 1, 3, 7, 15, 31 … so that cost can’t come from anvil work alone (other renames or mods?).` };
    return { uses, text: `Penalty ${pen} → ${uses} anvil use${uses === 1 ? '' : 's'}` };
  }

  function renderUsesHelper(s) {
    const out = h('span.ec-rc-out');
    const btn = h('button.btn.small', { type: 'button', hidden: true }, 'Use this');
    let cur = null;
    const update = (raw) => {
      cur = renameResult(raw);
      out.textContent = cur.text;
      out.classList.toggle('ok', cur.uses != null);
      btn.hidden = cur.uses == null || cur.uses === st().uses;
    };
    btn.onclick = () => { if (cur && cur.uses != null) set((e) => { e.uses = clamp(cur.uses, 0, MAX_USES + 4); }); };
    update(s.renameCost);
    return h('div.ec-uses-help',
      h('p.ec-help', 'Every anvil job on an item adds “prior work”: the next job costs 2 × (previous penalty) + 1 more levels, so the penalty is 0, 1, 3, 7, 15, 31 … = 2',
        h('sup', 'uses'), ' − 1. Enchanted books you found or bought carry their own penalty too.'),
      h('div.ec-rc',
        h('label.ec-rc-label', { for: 'ec-rename-cost' }, 'Don’t know the uses? Put the item in an anvil, type any name, and read the cost:'),
        h('div.ec-rc-row',
          h('input.field', {
            id: 'ec-rename-cost', type: 'number', min: 1, max: 99, inputmode: 'numeric', placeholder: 'rename cost', value: s.renameCost, 'data-focus': 'ec-rename-cost',
            'aria-label': 'Rename cost shown in the anvil',
            oninput: (ev) => { set((e) => { e.renameCost = ev.target.value; }, { silent: true }); update(ev.target.value); },
          }),
          h('span.ec-rc-eq', 'cost − 1 = penalty →'),
          out, btn)));
  }

  function renderCurrent(s) {
    const pen = TH.anvil.penalty(s.uses);
    const ex = Object.keys(s.existing);
    const list = applicable(s);
    const open = !!s.showExisting || ex.length > 0;
    return h('section.panel.ec-card',
      h('div.ec-card-head', h('span.ec-num', '2'), h('h3', 'Your ', itemName(s.item, s.material), ' right now'),
        h('span.ec-head-icon', itemIcon(s.item, s.material, 28))),
      h('div.ec-current',
        h('div.ec-uses',
          h('div.ec-uses-text',
            h('div.ec-label', 'Times through an anvil'),
            h('p.ec-help', 'Each anvil job (enchant, repair, rename) counts once. Fresh items are 0.')),
          h('div.ec-uses-ctl',
            stepper(s.uses, { min: 0, max: Math.max(MAX_USES, s.uses), label: 'anvil uses', onChange: (v) => set((e) => { e.uses = v; }) }),
            pen ? h('span.ec-pen' + (pen >= 15 ? '.warn' : ''), '+', h('b', pen), ' lvl each job') : null)),
        h('div.ec-has' + (open ? '.on' : ''),
        h('label.ec-toggle',
          h('span.switch', h('input', {
            type: 'checkbox', checked: open, 'data-focus': 'ec-has-existing',
            onchange: (ev) => set((e) => {
              if (ev.target.checked) e.showExisting = true;
              else { e.showExisting = false; e.existing = {}; pruneSelected(e); }
            }),
          }), h('span')),
          h('span.ec-toggle-text', 'It already has enchantments'),
          ex.length ? h('span.chip.ec-count', ex.length) : null),
        open ? renderUsesHelper(s) : null,
        open
          ? h('div.ec-existing',
            list.map((ench) => {
              const cur = s.existing[ench.id] || 0;
              const blockedBy = conflictList(ench.id, ex.filter((x) => x !== ench.id));
              const nm = enchName(ench.id);
              return h('div.ec-ex-row' + (cur ? '.on' : ''),
                h('span.ec-ex-name', nm, blockedBy.length && !cur ? h('span.faint', ' · replaces ' + blockedBy.map(enchName).join(', ')) : null),
                h('div.lvl-chips.ec-lv', { role: 'group', 'aria-label': nm + ' level on item' },
                  h('button.none' + (!cur ? '.on' : ''), { type: 'button', 'aria-pressed': String(!cur), 'aria-label': nm + ': none', 'data-focus': `ec-ex-${ench.id}-0`, onclick: () => setExisting(ench.id, 0) }, '–'),
                  Array.from({ length: ench.maxLevel }, (_, i) => h('button' + (cur === i + 1 ? '.on' : ''), {
                    type: 'button', 'aria-pressed': String(cur === i + 1), 'aria-label': lvlName(ench.id, i + 1), 'data-focus': `ec-ex-${ench.id}-${i + 1}`,
                    onclick: () => setExisting(ench.id, i + 1),
                  }, lvl(i + 1)))));
            }))
          : null),
      ),
    );
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

    function row(ench) {
      const id = ench.id;
      const nm = enchName(id);
      const sel = s.selected[id] || 0;
      const has = s.existing[id] || 0;
      const maxed = has >= ench.maxLevel;
      const exConf = conflictList(id, exIds);
      const selConf = sel ? [] : conflictList(id, selIds);
      const blocked = maxed || exConf.length > 0;
      const level = sel || Math.max(ench.maxLevel, 1);
      const status = !blocked ? hallStatus(offers, id, level) : null;
      const inputId = 'ec-sel-' + id;

      // second line: the reason it can't be picked, the swap it causes, or what it does
      let sub, subCls = '';
      if (maxed) { sub = 'Already ' + lvlName(id, has) + ' on your item'; subCls = '.ok'; }
      else if (exConf.length) { sub = 'Can’t combine with ' + enchName(exConf[0]) + ' on your item'; subCls = '.bad'; }
      else if (selConf.length) { sub = 'Replaces ' + selConf.map(enchName).join(', '); subCls = '.warn'; }
      else sub = (sel && lo && lo.reasons[id]) || ench.desc;

      return h('div.ec-ench' + (sel ? '.on' : '') + (has ? '.has' : '') + (blocked ? '.blocked' : '') + (selConf.length ? '.conflict' : ''),
        h('label.check', h('input', {
          type: 'checkbox', id: inputId, checked: !!sel, disabled: blocked, 'data-focus': inputId,
          'aria-describedby': inputId + '-sub', onchange: () => toggleSelect(id),
        }), h('span')),
        h('label.ec-ench-text', { for: inputId },
          h('span.ec-ench-name', h('span.ec-ench-title', nm),
            has ? h('span.pill.ec-onitem', { title: 'Already on your item' }, 'on item' + (maxed ? '' : ' ' + lvl(has))) : null,
            ench.category === 'curse' ? h('span.pill.tier-meh', 'curse') : null,
            (it.anvilOnly || []).includes(id) ? h('span.pill.tier-good', { title: 'The enchanting table can’t put this on this item, but an anvil can' }, 'anvil only') : null),
          h('span.ec-ench-sub' + subCls, { id: inputId + '-sub', title: sub }, sub)),
        h('div.ec-ench-side',
          hallChip(status),
          ench.maxLevel > 1 && !blocked
            ? h('div.lvl-chips.ec-lv', { role: 'group', 'aria-label': nm + ' book level' },
              Array.from({ length: ench.maxLevel }, (_, i) => i + 1).filter((l) => l > has).map((l) => h('button' + (sel === l ? '.on' : ''), {
                type: 'button', 'aria-pressed': String(sel === l), 'aria-label': lvlName(id, l), 'data-focus': `ec-lv-${id}-${l}`,
                onclick: () => (sel === l ? toggleSelect(id) : setSelectedLevel(id, l)),
              }, lvl(l))))
            : h('div.lvl-chips.ec-lv.is-empty', { 'aria-hidden': 'true' })));
    }

    return h('section.panel.ec-card',
      h('div.ec-card-head', h('span.ec-num', '3'), h('h3', 'Choose enchantments'),
        selIds.length ? h('button.btn.ghost.small.ec-clear', { type: 'button', onclick: () => set((e) => { e.selected = {}; e.loadout = null; }) }, 'Clear') : null),
      h('div.ec-loadouts',
        h('span.ec-label', 'Quick builds'),
        h('div.ec-lo-list', it.loadouts.map((l) => h('button.btn.small.ec-lo' + (s.loadout === l.id ? '.on' : ''), {
          type: 'button', title: l.desc, 'aria-pressed': String(s.loadout === l.id), 'data-focus': 'ec-lo-' + l.id, onclick: () => applyLoadout(l),
        }, TH.icon('enchanted_book', { size: 14 }), l.name)))),
      lo ? h('p.ec-lo-desc', lo.desc) : null,
      h('div.ec-ench-list', normal.map(row)),
      curses.length ? h('details.ec-curses', h('summary', 'Curses (' + curses.length + ')'), h('div.ec-ench-list', curses.map(row))) : null,
    );
  }

  /* ---------- plan panel ---------- */

  function nodeChip(node, s) {
    const names = node.enchants.map((e) => lvlName(e.id, e.level));
    if (node.kind === 'item') {
      return h('span.ec-node.item', { title: names.join(', ') || 'No enchantments' },
        itemIcon(s.item, s.material, 20), h('span', itemName(s.item, s.material)));
    }
    if (node.fromStep != null) {
      return h('span.ec-node.book', { title: names.join(', ') },
        bookIcon(20), h('span', 'Book from step ', h('b.ec-ref', node.fromStep)));
    }
    return h('span.ec-node.book', bookIcon(20), h('span', names[0]));
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
    const custom = (s.anvilName || '').trim();
    const lines = ids.map((id) => {
      const curse = byId[id] && byId[id].category === 'curse';
      return h('div.mct-line' + (curse ? '.curse' : '') + '', lvlName(id, fin[id]));
    });
    return h('div.panel.ec-preview', { 'aria-label': 'Preview of the finished item', 'aria-live': 'polite' },
      h('div.ec-pv-row',
        h('div.mct-slot', TH.icon.item(s.item, effMat(s.item, s.material), { size: 32, glint: ench })),
        h('div.mct', h('div.mct-name' + (ench ? '.ench' : '') + (custom ? '.custom' : ''), custom || itemName(s.item, s.material)), lines)),
      h('label.ec-pv-rename',
        h('span', 'Rename in anvil'),
        h('input.field', {
          type: 'text', value: s.anvilName, maxlength: 50, placeholder: 'optional custom name', 'data-focus': 'ec-anvil-name', 'aria-label': 'Custom name (anvil rename)',
          oninput: (ev) => {
            const v = ev.target.value;
            set((e) => { e.anvilName = v; }, { silent: true });
            const nm = ev.target.closest('.ec-preview').querySelector('.mct-name');
            if (nm) { nm.textContent = v.trim() || itemName(st().item, st().material); nm.classList.toggle('custom', !!v.trim()); }
          },
        })));
  }

  function renderPlan(state, s) {
    const plan = currentPlan(s);
    const offers = hallOffers(state);
    const head = h('div.ec-plan-head', TH.icon('anvil', { size: 22 }), h('h3', 'Anvil plan'));

    if (plan.error) return h('aside.panel.ec-plan', head, h('p.ec-alert', plan.error));

    if (!plan.books.length) {
      return h('aside.panel.ec-plan', { 'aria-live': 'polite' }, head,
        h('div.empty.ec-empty',
          h('div.empty-icon', { 'aria-hidden': 'true' }, bookIcon(40)),
          plan.skipped.length ? 'Your item already has everything you picked.' : 'Pick enchantments and the cheapest anvil order shows up here.'),
        renderPlanBox(s, plan), renderSaveBox(s, null));
    }

    const steps = plan.steps;
    const naive = plan.naive;
    const usable = plan.ok || plan.partial;
    const save = naive.totalLevels - plan.totalLevels;

    // total, XP-bar style: the bar is this plan's cost against one-book-at-a-time
    let compare = null, fill = 100;
    if (plan.ok && !naive.ok) compare = h('span', 'One book at a time hits ', h('b.ec-bad', 'Too Expensive!'), ' — this order doesn’t.');
    else if (plan.ok && save > 0) {
      fill = Math.max(4, Math.round((plan.totalLevels / naive.totalLevels) * 100));
      compare = h('span', 'One book at a time: ', h('b', naive.totalLevels), ' → you save ', h('b.ec-save-n', save), ' level' + (save === 1 ? '' : 's'));
    } else if (plan.ok && steps.length > 1) compare = h('span', 'Same as one book at a time — order barely matters here.');

    const total = h('div.ec-total' + (usable ? '' : '.bad'),
      h('div.ec-total-num', h('span.ec-xp', usable ? plan.totalLevels : '—'),
        h('span.ec-total-label', plan.partial ? 'levels, without the left-out books' : 'levels total')),
      h('div.bar.ec-xpbar', { role: 'img', 'aria-label': compare ? compare.textContent : 'total levels' }, h('span', { style: { width: (usable ? fill : 0) + '%' } })),
      compare ? h('div.ec-compare', compare) : null,
      usable ? h('div.ec-total-sub', steps.length + ' step' + (steps.length === 1 ? '' : 's') + ' · ≈ ' + (plan.totalXP || 0).toLocaleString() + ' XP points') : null);

    // one short warning, only when it matters
    let alert = null;
    if (!plan.ok) {
      alert = h('p.ec-alert', TH.icon('item/barrier', { size: 14 }),
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
          x.cost > 39 ? 'Too Expensive!' : [h('span.ec-arrow', { 'aria-hidden': 'true' }, '→ '), h('b', x.cost), ' lvl']))))
      : null;

    // result
    const fin = plan.final;
    const finalBox = h('div.ec-final',
      itemIcon(s.item, s.material, 32),
      h('div.ec-final-body',
        h('b', itemName(s.item, s.material)),
        h('div.ec-final-ench', sortIds(Object.keys(fin.enchants)).map((id) => h('span.ec-ench-pill', lvlName(id, fin.enchants[id]))))));
    const finWarn = TH.anvil.penalty(fin.uses) >= 31
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

    return h('aside.panel.ec-plan', { 'aria-live': 'polite' },
      head, total, alert,
      stepList ? h('p.ec-slot-hint', 'Left slot first, right slot second.') : null,
      stepList, finalBox, finWarn, renderPlanBox(s, plan), shopBox, renderSaveBox(s, plan));
  }

  /** "Add to plan" / linked-entry status, in the single-item plan panel. */
  function renderPlanBox(s, plan) {
    const en = editingEntry(s);
    const hasBooks = !!(plan && !plan.error && usedBooks(plan).length);
    const open = s.plan.filter((x) => !x.done).length;
    const toPlan = () => set((e) => { e.mode = 'plan'; });
    if (en) {
      const dirty = !sameEntry(en, s);
      return h('div.ec-planbox.linked',
        h('div.ec-planbox-text', TH.icon('item/writable_book', { size: 20 }),
          h('span', dirty ? [h('b', 'Changed'), ' since it went into your plan'] : [h('b', 'In your plan'), en.done ? ' · done' : ''])),
        h('div.ec-planbox-btns',
          dirty ? h('button.btn.primary', { type: 'button', disabled: !hasBooks, 'data-focus': 'ec-plan-update', onclick: updateEntry }, 'Update plan item') : null,
          h('button.btn', { type: 'button', 'data-focus': 'ec-plan-open', onclick: toPlan }, 'Open plan', h('span.ec-planbox-n', open))));
    }
    return h('div.ec-planbox',
      h('button.btn.ec-add', { type: 'button', disabled: !hasBooks, 'data-focus': 'ec-plan-add', onclick: addToPlan },
        TH.icon('item/writable_book', { size: 18 }), 'Add to plan'),
      h('span.ec-planbox-hint', hasBooks
        ? (open ? ['Your plan has ', h('b', open), ' item' + (open === 1 ? '' : 's'), ' — ', h('button.ec-link', { type: 'button', onclick: toPlan }, 'open it')] : 'Plan several items, get one shopping list.')
        : 'Pick enchantments to add this item to your plan.'));
  }

  function renderSaveBox(s, plan) {
    const g = s.gear.find((x) => x.id === s.gearId);
    const canApply = plan && plan.steps.length > 0;
    const dirty = g && (g.item !== s.item || g.material !== s.material || g.uses !== s.uses || JSON.stringify(sortObj(g.enchants)) !== JSON.stringify(sortObj(s.existing)));

    const linked = editingEntry(s);
    const isDone = !!(linked && linked.done);
    const applyBtn = canApply || isDone ? h('button.btn' + (isDone ? '.ec-undone' : '.primary'), {
      type: 'button', 'aria-pressed': String(isDone), 'data-focus': 'ec-done',
      title: isDone ? 'Mark as not done again' : 'Check this item off in your plan' + (g ? ' and update the saved gear' : ''),
      onclick: () => doneFromEditor(plan),
    }, isDone ? '✓ Done — undo' : 'Done') : null;

    return h('div.ec-savebox',
      g ? h('div.ec-loaded', h('span', 'Editing ', h('b', g.name)),
        dirty ? h('button.btn.small', {
          type: 'button', onclick: () => {
            set((e) => { const x = e.gear.find((y) => y.id === e.gearId); if (x) Object.assign(x, { item: e.item, material: e.material, enchants: Object.assign({}, e.existing), uses: e.uses, updated: Date.now() }); });
            toast('Saved');
          },
        }, 'Save changes') : null,
        h('button.btn.small.ghost', { type: 'button', onclick: () => set((e) => { e.gearId = null; }) }, 'Close')) : null,
      applyBtn,
      !g ? h('form.ec-save', {
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
        'aria-label': 'Name for saved gear', oninput: (ev) => set((e) => { e.saveName = ev.target.value; }, { silent: true }),
      }),
      h('button.btn', { type: 'submit', title: 'Save the item as it is now (current enchants and anvil uses)' }, 'Save item')) : null,
    );
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
      e.plan.push(en);
      e.planEditing = en.id;
      name = itemName(en.item, en.material);
    });
    toast(`Added ${name} to your plan`);
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
      e.showExisting = Object.keys(en.existing).length > 0; e.loadout = null;
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
      } else {
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

  /* ---------- planner: view ---------- */

  function renderModeSwitch(s) {
    const n = s.plan.filter((x) => !x.done).length;
    const total = s.plan.length;
    const btn = (mode, label, icon, extra) => h('button' + (s.mode === mode ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(s.mode === mode), 'data-focus': 'ec-mode-' + mode,
      onclick: () => set((e) => { e.mode = mode; }),
    }, TH.icon(icon, { size: 16 }), h('span', label), extra);
    return h('div.seg.ec-mode', { role: 'group', 'aria-label': 'Enchanting view' },
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
    if (!o) return h('span.ec-hall.missing', 'Not in your hall');
    if (o.level < level) return h('span.ec-hall.low', 'Your hall only has ' + lvl(o.level));
    return h('span.ec-hall.have', { title: o.price != null ? `Your hall · ${o.price} emeralds + 1 book${count > 1 ? ' each' : ''}` : 'Your hall · price not set' },
      h('span.ec-hall-text', 'Your hall ·'),
      o.price != null ? [h('span.ec-price', h('b', o.price), emerald()), count > 1 ? h('span.ec-each', 'each') : null] : h('span.ec-hall-text', 'price not set'),
      o.perfect ? h('span.ec-star', { 'aria-label': 'perfect price' }, '★') : null);
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
      }), h('span')),
      h('label.ec-todo-body', { for: inputId }, body),
      cost);
  }

  function renderEntry(en, p, s, idx) {
    const name = itemName(en.item, en.material);
    const gear = en.gearId ? s.gear.find((g) => g.id === en.gearId) : null;
    const books = usedBooks(p);
    const remove = h('button.x-btn', { type: 'button', title: 'Remove from plan', 'aria-label': 'Remove ' + name + ' from plan', 'data-focus': 'ec-pi-rm-' + en.id, onclick: () => removeEntry(en) }, '✕');

    if (en.done) {
      const fin = p.final ? p.final.enchants : {};
      return h('article.panel.ec-pi.done',
        h('div.ec-pi-head',
          h('span.ec-pi-icon', itemIcon(en.item, en.material, 28)),
          h('div.ec-pi-title', h('b', name), gear ? h('span.faint', gear.name) : null),
          h('label.ec-done-check', { title: 'Uncheck to put it back on your to-do list' },
            h('span.check', h('input', { type: 'checkbox', checked: true, 'aria-label': name + ' is done', 'data-focus': 'ec-pi-done-' + en.id, onchange: () => setDone(en.id, false) }), h('span')),
            h('span.ec-done-pill', 'Done')),
          h('div.ec-pi-actions', remove)),
        h('div.ec-final-ench.ec-pi-ench', sortIds(Object.keys(fin)).map((id) => h('span.ec-ench-pill', lvlName(id, fin[id])))));
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
        h('span.ec-step-num', { 'aria-label': 'Step ' + x.n }, x.n),
        nodeChip(x.target, en), h('span.ec-plus', { 'aria-hidden': 'true' }, '+'), nodeChip(x.sacrifice, en)),
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

    return h('article.panel.ec-pi' + (all ? '.complete' : ''), { 'aria-label': name },
      h('div.ec-pi-head',
        h('span.ec-pi-num', idx + 1),
        h('span.ec-pi-icon', itemIcon(en.item, en.material, 32)),
        h('div.ec-pi-title',
          h('b', name),
          h('span.faint', [gear ? gear.name : null, Object.keys(en.existing).length ? 'has ' + Object.keys(en.existing).length + ' enchant' + (Object.keys(en.existing).length > 1 ? 's' : '') : null,
            en.uses ? en.uses + ' anvil use' + (en.uses === 1 ? '' : 's') : null].filter(Boolean).join(' · ') || 'fresh item')),
        h('div.ec-pi-actions',
          h('button.btn.small', { type: 'button', title: 'Load into the editor', 'data-focus': 'ec-pi-edit-' + en.id, onclick: () => editEntry(en) }, 'Edit'),
          remove)),
      h('div.ec-pi-ench', books.slice().sort((a, b) => byUse(a.id, b.id)).map((b) => h('span.ec-want', bookIcon(14), lvlName(b.id, b.level)))),
      canUpgrade(en) ? h('label.ec-tile' + (upgrade ? '.on' : ''),
        h('span.switch', h('input', {
          type: 'checkbox', checked: upgrade, 'data-focus': 'ec-pi-up-' + en.id,
          onchange: (ev) => withEntry(en.id, (x) => { x.upgrade = ev.target.checked; x.ticks = x.ticks.filter((k) => k !== 's'); }),
        }), h('span')),
        h('span.ec-tile-text', h('b', 'Upgrading from diamond'), h('span', 'Adds the smithing step and its materials'))) : null,
      alert,
      rows.length ? progressBar(done, rows.length, name + ' progress') : null,
      rows.length ? h('ol.ec-todos', rows.map((r) => todoRow(en.id, r.key, en.ticks.includes(r.key), r.body, r.cost, r.bad ? '.bad' : ''))) : null,
      h('div.ec-pi-foot',
        rows.length ? h('span.ec-pi-total', h('b', p.totalLevels || 0), ' levels · ', rows.length, ' step' + (rows.length === 1 ? '' : 's')) : h('span'),
        h('button.btn.small' + (all ? '.primary' : ''), { type: 'button', 'data-focus': 'ec-pi-done-' + en.id, title: gear ? 'Check off and update “' + gear.name + '”' : 'Check this item off', onclick: () => setDone(en.id, true, p) },
          'Done')));
  }

  function renderPlanView(state, s) {
    if (!s.plan.length) {
      return h('section.panel.ec-pv-empty',
        h('div.empty',
          h('div.empty-icon', { 'aria-hidden': 'true' }, TH.icon('item/writable_book', { size: 44 })),
          h('h3', 'Your plan is empty'),
          h('p', 'Plan everything you want to enchant — a sword, a pickaxe, a full set of armor — and get one shopping list and one to-do list.'),
          h('ol.ec-howto',
            h('li', 'Switch to ', h('b', 'Single item'), ' and pick an item.'),
            h('li', 'Choose its enchantments (and what it already has).'),
            h('li', 'Press ', h('b', 'Add to plan'), '. Repeat for every item.')),
          h('button.btn.primary', { type: 'button', 'data-focus': 'ec-pv-start', onclick: newItem }, 'Pick the first item')));
    }

    const offers = hallOffers(state);
    const rows = s.plan.map((en) => ({ en, p: entryPlan(en) }));
    const open = rows.filter((r) => !r.en.done);
    const finished = rows.length - open.length;

    // ---- a) books, merged ----
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
    const gotBooks = books.reduce((n, b) => n + (isGot(s, b.key, b.count) ? b.count : 0), 0);

    // ---- b) costs ----
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

    // ---- d) base materials (diamond → netherite only) ----
    const ups = open.filter(({ en }) => en.upgrade && canUpgrade(en)).length;

    const toolbar = h('div.ec-pv-bar',
      h('button.btn.small', { type: 'button', 'data-focus': 'ec-pv-add', onclick: newItem }, '+ Add another item'),
      h('span.spacer'),
      finished ? h('button.btn.small.ghost', { type: 'button', onclick: () => set((e) => { e.plan = e.plan.filter((x) => !x.done); }) }, 'Clear finished (' + finished + ')') : null,
      h('button.btn.small.ghost', { type: 'button', onclick: () => window.print() }, 'Print'),
      h('button.btn.small.ghost.danger', {
        type: 'button', onclick: () => {
          if (!confirm('Remove every item from your plan?')) return;
          set((e) => { e.plan = []; e.planGot = {}; e.planEditing = null; });
        },
      }, 'Clear plan'));

    const costs = h('section.panel.ec-pv-box.ec-costs', { 'aria-label': 'Costs total' },
      h('div.ec-sub-head', 'Costs total', h('span.faint', open.length + ' item' + (open.length === 1 ? '' : 's'))),
      h('div.ec-total',
        h('div.ec-total-num', h('span.ec-xp', levels), h('span.ec-total-label', 'levels for every anvil step')),
        h('div.ec-total-sub', '≈ ' + points.toLocaleString() + ' XP points', left !== levels ? ' · ' + left + ' levels still to spend' : '')),
      h('div.ec-cost-rows',
        h('div.ec-cost', TH.icon('emerald', { size: 20 }), h('span.ec-cost-label', 'Emeralds for hall trades'), h('b', emeralds)),
        h('div.ec-cost', TH.icon('book', { size: 20 }), h('span.ec-cost-label', 'Plain books for those trades'), h('b', hallBooks)),
        ups ? h('div.ec-cost', TH.icon('item/netherite_ingot', { size: 20 }), h('span.ec-cost-label', 'Netherite upgrades'), h('b', ups)) : null),
      unpriced ? h('p.ec-pv-note', unpriced + ' hall book' + (unpriced > 1 ? 's have' : ' has') + ' no price yet — set it in the Trading Hall tab.') : null,
      bad ? h('p.ec-alert', TH.icon('item/barrier', { size: 14 }), h('span', bad + ' item' + (bad > 1 ? 's hit' : ' hits') + ' Too Expensive! — see the checklist.')) : null);

    const bookBox = h('section.panel.ec-pv-box', { 'aria-label': 'Books to get' },
      h('div.ec-sub-head', 'Books to get', h('span.faint', bookTotal)),
      bookTotal ? progressBar(gotBooks, bookTotal, 'Books obtained') : null,
      books.length
        ? h('ul.ec-buy', books.map((b) => {
          const got = isGot(s, b.key, b.count);
          const inputId = 'ec-got-' + b.key.replace(':', '-');
          return h('li.ec-buy-row' + (got ? '.on' : ''),
            h('label.check', h('input', { type: 'checkbox', id: inputId, checked: got, 'data-focus': inputId, onchange: (ev) => setGot(b.key, b.count, ev.target.checked) }), h('span')),
            bookIcon(20),
            h('label.ec-buy-text', { for: inputId },
              h('span.ec-buy-name', lvlName(b.id, b.level), b.count > 1 ? h('span.ec-x', '×' + b.count) : null),
              h('span.ec-buy-for', b.items.join(', '))),
            sourceChip(offers, b.id, b.level, b.count));
        }))
        : h('p.ec-pv-note', 'Nothing to buy — every open item is done or has no books.'));

    const matBox = ups ? h('section.panel.ec-pv-box', { 'aria-label': 'Base item materials' },
      h('div.ec-sub-head', 'Base item materials', h('span.faint', 'diamond → netherite')),
      h('ul.ec-buy', UPGRADE.map((m) => {
        const n = m.count * ups, key = 'mat:' + m.id, got = isGot(s, key, n);
        const inputId = 'ec-got-' + m.id;
        return h('li.ec-buy-row' + (got ? '.on' : ''),
          h('label.check', h('input', { type: 'checkbox', id: inputId, checked: got, 'data-focus': inputId, onchange: (ev) => setGot(key, n, ev.target.checked) }), h('span')),
          TH.icon(m.icon, { size: 20 }),
          h('label.ec-buy-text', { for: inputId }, h('span.ec-buy-name', matItemName(m), h('span.ec-x', '×' + n))));
      }))) : null;

    const allSteps = open.reduce((n, { en, p }) => n + p.steps.length + (en.upgrade && canUpgrade(en) ? 1 : 0), 0);
    const doneSteps = open.reduce((n, { en, p }) => n + en.ticks.filter((k) => k === 's' ? en.upgrade && canUpgrade(en) : p.steps.some((x) => 'n' + x.n === k)).length, 0);

    return [
      toolbar,
      h('div.ec-pv',
        h('div.ec-pv-side', costs, bookBox, matBox),
        h('section.ec-pv-main', { 'aria-label': 'Anvil to-do checklist' },
          h('div.ec-section-head', h('h3.section-title', 'Anvil to-do'),
            allSteps ? h('span.faint', doneSteps + ' of ' + allSteps + ' steps done') : null),
          armorToolSections(rows.map((r, i) => Object.assign({ i }, r)), (r) => r.en.item, (r) => renderEntry(r.en, r.p, s, r.i), '.ec-pi-list'))),
    ];
  }

  /* ---------- page ---------- */

  function render(root, state) {
    const s = state.enchanting;
    if (!itemById[s.item]) s.item = 'sword';
    if (!MATS.includes(s.material)) s.material = 'diamond';
    if (!fits(itemById[s.item], s.material)) s.material = itemById[s.item].defaultMaterial;
    const planMode = s.mode === 'plan';
    TH.util.append(root, [
      h('div.page-head',
        h('div',
          h('h2', 'Enchanting'),
          h('p', planMode
            ? 'Everything you plan to enchant — one shopping list and one anvil to-do list.'
            : 'Pick an item and the enchantments you want — get the cheapest anvil order that never hits “Too Expensive!”.')),
        renderModeSwitch(s)),
      planMode ? renderPlanView(state, s) : [
        renderGear(state),
        h('div.ec-layout',
          h('div.ec-main', renderLinked(s), renderPicker(s), renderCurrent(s), renderSelect(state, s)),
          h('div.ec-side', renderPreview(s), renderPlan(state, s))),
      ],
    ]);
  }

  function migrate(s) {
    if (!Array.isArray(s.gear)) s.gear = [];
    s.renaming = null;
    if (typeof s.renameCost !== 'string') s.renameCost = '';
    if (typeof s.anvilName !== 'string') s.anvilName = '';
    s.uses = clamp(s.uses | 0, 0, MAX_USES + 4);
    if (!MATS.includes(s.material)) s.material = 'diamond';
    if (s.mode !== 'plan') s.mode = 'single';
    if (!s.planGot || typeof s.planGot !== 'object' || Array.isArray(s.planGot)) s.planGot = {};
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
    },
    render,
    badge(state) {
      const plan = (state.enchanting && state.enchanting.plan) || [];
      return plan.length ? { done: plan.filter((x) => x.done).length, total: plan.length } : null;
    },
  });
})();
