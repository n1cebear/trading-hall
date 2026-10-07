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
  const applicable = (s) => itemById[s.item].enchants.map((id) => byId[id]).filter(Boolean);
  const conflictList = (id, ids) => ids.filter((x) => TH.anvil.conflicts(x, id));

  function resetPlan(e) {
    e.existing = {}; e.selected = {}; e.uses = 0; e.loadout = null; e.gearId = null; e.showExisting = false;
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
  let cacheKey = null, cachePlan = null;
  function currentPlan(s) {
    const order = itemById[s.item].enchants;
    const books = order.filter((id) => s.selected[id]).map((id) => ({ id, level: s.selected[id] }));
    const key = JSON.stringify([s.existing, s.uses, books]);
    if (key !== cacheKey) {
      cacheKey = key;
      try { cachePlan = TH.anvil.plan({ enchants: s.existing, uses: s.uses }, books); } catch (err) { cachePlan = { error: err.message, steps: [], books: [] }; }
    }
    return cachePlan;
  }

  /* ---------- saved gear ---------- */

  function renderGear(state) {
    const s = state.enchanting;
    if (!s.gear.length) return null;
    return h('section.ec-gear', { 'aria-label': 'Saved gear' },
      h('div.ec-section-head', h('h3.section-title', 'Your gear'), h('span.faint', 'Click to load and plan upgrades')),
      h('div.ec-gear-list', s.gear.map((g) => {
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
              e.uses = g.uses; e.selected = {}; e.loadout = null; e.gearId = g.id; e.showExisting = true;
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
      })));
  }

  /* ---------- 1. material, then item ---------- */

  function materialHint(m) {
    if (m === 'turtle') return 'Turtle only comes as a helmet.';
    if (m === 'leather' || m === 'chainmail') return matName(m) + ' is armor only — no tools or weapons.';
    if (m === 'wooden' || m === 'stone') return matName(m) + ' is tools and weapons only — no armor.';
    return null;
  }

  function itemButton(it, s) {
    const on = it.id === s.item;
    const name = itemName(it.id, s.material);
    return h('button.ec-item' + (on ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(on), 'data-focus': 'ec-item-' + it.id, title: name,
      onclick: () => pickItem(it.id),
    },
    itemIcon(it.id, s.material, 32),
    h('span.ec-item-name', name),
    it.since ? h('span.ec-new', it.since) : null);
  }

  function renderPicker(s) {
    // items that don't exist in the picked material (leather sword, turtle boots…) are hidden; the hint says why
    const matItems = D.items.filter((i) => !isPlain(i) && i.materials.includes(s.material));
    const plainItems = D.items.filter(isPlain);
    const hint = materialHint(s.material);
    return h('section.panel.ec-card.ec-picker',
      h('div.ec-card-head', h('span.ec-num', '1'), h('h3', 'Pick material, then item')),
      h('div.ec-mats', { role: 'radiogroup', 'aria-label': 'Material' }, MATS.map((m) => {
        const on = s.material === m;
        return h('button.ec-mat' + (on ? '.on' : ''), {
          type: 'button', role: 'radio', 'aria-checked': String(on), 'data-focus': 'ec-mat-' + m,
          title: T.item(D.materials[m].lang), onclick: () => pickMaterial(m),
        }, TH.icon(D.materials[m].icon, { size: 22 }), h('span', matName(m)));
      })),
      h('div.ec-group-name', h('span', matName(s.material)), hint ? h('span.ec-mat-hint', hint) : null),
      h('div.ec-items', { role: 'group', 'aria-label': matName(s.material) + ' items' },
        matItems.map((it) => itemButton(it, s))),
      h('div.ec-group-name.ec-indep', h('span', 'Material-independent'), h('span.ec-mat-hint', 'Look the same in every material')),
      h('div.ec-items', { role: 'group', 'aria-label': 'Material-independent items' },
        plainItems.map((it) => itemButton(it, s))),
    );
  }

  /* ---------- 2. current item ---------- */

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
        h('label.ec-toggle',
          h('span.switch', h('input', {
            type: 'checkbox', checked: open, 'data-focus': 'ec-has-existing',
            onchange: (ev) => set((e) => {
              if (ev.target.checked) e.showExisting = true;
              else { e.showExisting = false; e.existing = {}; pruneSelected(e); }
            }),
          }), h('span')),
          h('span', 'It already has enchantments'),
          ex.length ? h('span.chip', ex.length) : null),
        open
          ? h('div.ec-existing',
            list.map((ench) => {
              const cur = s.existing[ench.id] || 0;
              const blockedBy = conflictList(ench.id, ex.filter((x) => x !== ench.id));
              const nm = enchName(ench.id);
              return h('div.ec-ex-row' + (cur ? '.on' : ''),
                h('span.ec-ex-name', nm, blockedBy.length && !cur ? h('span.faint', ' · replaces ' + blockedBy.map(enchName).join(', ')) : null),
                h('div.lvl-chips.ec-lv', { role: 'group', 'aria-label': nm + ' level on item' },
                  h('button' + (!cur ? '.on' : ''), { type: 'button', 'aria-pressed': String(!cur), 'aria-label': nm + ': none', 'data-focus': `ec-ex-${ench.id}-0`, onclick: () => setExisting(ench.id, 0) }, '–'),
                  Array.from({ length: ench.maxLevel }, (_, i) => h('button' + (cur === i + 1 ? '.on' : ''), {
                    type: 'button', 'aria-pressed': String(cur === i + 1), 'aria-label': lvlName(ench.id, i + 1), 'data-focus': `ec-ex-${ench.id}-${i + 1}`,
                    onclick: () => setExisting(ench.id, i + 1),
                  }, lvl(i + 1)))));
            }))
          : null,
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

      return h('div.ec-ench' + (sel ? '.on' : '') + (blocked ? '.blocked' : '') + (selConf.length ? '.conflict' : ''),
        h('label.check', h('input', {
          type: 'checkbox', id: inputId, checked: !!sel, disabled: blocked, 'data-focus': inputId,
          'aria-describedby': inputId + '-sub', onchange: () => toggleSelect(id),
        }), h('span')),
        h('label.ec-ench-text', { for: inputId },
          h('span.ec-ench-name', h('span.ec-ench-title', nm),
            has && !maxed ? h('span.pill.tier-unknown', 'has ' + lvl(has)) : null,
            ench.category === 'curse' ? h('span.pill.tier-meh', 'curse') : null,
            (it.anvilOnly || []).includes(id) ? h('span.pill.tier-good', { title: 'The enchanting table can’t put this on this item, but an anvil can' }, 'anvil only') : null),
          h('span.ec-ench-sub' + subCls, { id: inputId + '-sub', title: sub }, sub)),
        h('div.ec-ench-side',
          ench.maxLevel > 1 && !blocked
            ? h('div.lvl-chips.ec-lv', { role: 'group', 'aria-label': nm + ' book level' },
              Array.from({ length: ench.maxLevel }, (_, i) => i + 1).filter((l) => l > has).map((l) => h('button' + (sel === l ? '.on' : ''), {
                type: 'button', 'aria-pressed': String(sel === l), 'aria-label': lvlName(id, l), 'data-focus': `ec-lv-${id}-${l}`,
                onclick: () => (sel === l ? toggleSelect(id) : setSelectedLevel(id, l)),
              }, lvl(l))))
            : null,
          hallChip(status)));
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
        renderSaveBox(s, null));
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
        h('div.ec-final-ench', Object.keys(fin.enchants).map((id) => h('span.ec-ench-pill', lvlName(id, fin.enchants[id]))))));
    const finWarn = TH.anvil.penalty(fin.uses) >= 31
      ? h('p.ec-note', 'After this, more anvil work on it (even repairs) will be Too Expensive.')
      : null;

    // books to get
    let emeraldTotal = 0, fromHall = 0;
    const shop = plan.books.map((b) => {
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
      stepList, finalBox, finWarn, shopBox, renderSaveBox(s, plan));
  }

  function renderSaveBox(s, plan) {
    const g = s.gear.find((x) => x.id === s.gearId);
    const canApply = plan && plan.steps.length > 0;
    const dirty = g && (g.item !== s.item || g.material !== s.material || g.uses !== s.uses || JSON.stringify(sortObj(g.enchants)) !== JSON.stringify(sortObj(s.existing)));

    const applyBtn = canApply ? h('button.btn.primary', {
      type: 'button', title: 'Update the item to the result of this plan',
      onclick: () => {
        set((e) => {
          e.existing = Object.assign({}, plan.final.enchants);
          e.uses = Math.min(plan.final.uses, MAX_USES + 4);
          e.selected = {}; e.loadout = null; e.showExisting = true;
          const x = e.gear.find((y) => y.id === e.gearId);
          if (x) { x.enchants = Object.assign({}, e.existing); x.uses = e.uses; x.updated = Date.now(); }
        });
        toast(g ? `“${g.name}” updated` : 'Applied — the item now has these enchants');
      },
    }, g ? 'Mark as applied' : 'I did it — apply to item') : null;

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

  /* ---------- page ---------- */

  function render(root, state) {
    const s = state.enchanting;
    if (!itemById[s.item]) s.item = 'sword';
    if (!MATS.includes(s.material)) s.material = 'diamond';
    if (!fits(itemById[s.item], s.material)) s.material = itemById[s.item].defaultMaterial;
    TH.util.append(root, [
      h('div.page-head',
        h('div',
          h('h2', 'Enchanting'),
          h('p', 'Pick an item and the enchantments you want — get the cheapest anvil order that never hits “Too Expensive!”.'))),
      renderGear(state),
      h('div.ec-layout',
        h('div.ec-main', renderPicker(s), renderCurrent(s), renderSelect(state, s)),
        h('div.ec-side', renderPlan(state, s))),
    ]);
  }

  TH.app.register({
    id: 'enchanting', name: 'Enchanting', icon: 'mc:enchanted_book',
    init(store) {
      store.define('enchanting', DEFAULTS);
      const s = store.get().enchanting;
      if (!Array.isArray(s.gear)) s.gear = [];
      s.renaming = null;
      s.uses = clamp(s.uses | 0, 0, MAX_USES + 4);
      if (!MATS.includes(s.material)) s.material = 'diamond';
    },
    render,
  });
})();
