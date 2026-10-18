/**
 * Potion Brewing (azure accent, --c-pot): every potion of Java 26.3 and, above all, HOW TO BREW IT, step by step.
 *   Steps (first tab, the heart of the tool)  a slim picker column (search, recent + favourites, every potion) beside the
 *               stage: the potion bar (form, variant, favourite, add to plan), 'You need' (ingredients, blaze powder, glass
 *               bottles for N batches of 3), the order switch, and the big step flow (Fill glass bottles, Add Nether Wart,
 *               Add ..., each with the ingredient, an arrow and the bottle it makes). Below it, quieter: effects in every
 *               form, cautions, what to brew next, other sources. 'My plan' turns the stage into the merged brewing order
 *               for several potions (shared steps, bottles in threes) with a tick per step and Send to Material List.
 *   Library     filter bar (search, form, variant, type / ingredient / effect chips with live counts, sort) + cards; a card
 *               opens its steps.
 *   Ingredients every brewing ingredient: where it comes from and what it does at each stage.
 *   Guide       how brewing works, drawn rather than written.
 * Mechanics live in js/modules/potions-engine.js (pure, node-tested: tools/test-potions.js), data in js/data/potions.js.
 * Names are the game's own (TH.langData via tools/build-lang.js). Everything patches in place: no re-render animations.
 *
 * state.potions = { view: 'steps'|'library'|'ings'|'guide', mode: 'one'|'plan', sel, form, variant, q, types: [], ings: [],
 *   ingMode, effs: [], sort, dir, alt, batches, plan: [{ pot, form, n }], ticks: { sig, done: [brew index] }, fav: [],
 *   recent: [], filtersOpen, pickOpen }
 */
(function () {
  'use strict';
  const { h, toast } = TH.util;
  const E = TH.potionsEngine;
  const D = () => TH.data.potions;
  const S = () => TH.store.get().potions;
  const save = () => TH.store.update(() => {}, { silent: true });
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  const FORMS = ['potion', 'splash', 'lingering', 'arrow'];
  const FORM_ITEM = { potion: 'potion', splash: 'splash_potion', lingering: 'lingering_potion', arrow: 'tipped_arrow' };
  const FORM_LABEL = { potion: 'Drinkable', splash: 'Splash', lingering: 'Lingering', arrow: 'Tipped arrow' };
  const VARS = [['all', 'All'], ['n', 'Normal'], ['long', 'Extended'], ['strong', 'Enhanced']];
  const TYPES = [['base', 'Bases'], ['good', 'Beneficial'], ['bad', 'Harmful'], ['mixed', 'Mixed'], ['instant', 'Instant'], ['fav', 'Favourites']];
  const SORTS = [['game', 'Game order', 'The order of the creative inventory'], ['name', 'Name'], ['duration', 'Duration', 'Longest effect in the chosen form'],
    ['steps', 'Steps', 'Fewest brewing operations from a Water Bottle'], ['ing', 'Ingredient', 'By the ingredient that gives the effect'],
    ['fuel', 'Fuel', 'Blaze powder per batch of three'], ['power', 'Strength', 'Highest effect level, then duration']];
  const SRC_LABEL = { mob: 'Mob drop', farm: 'Farm', craft: 'Crafted', mine: 'Mined', structure: 'Found', fish: 'Fishing' };

  /* ---------------- names (the game's own translations) ---------------- */
  const L = (k) => { const d = TH.langData || {}, a = d[TH.i18n.lang] || {}; return a[k] != null ? a[k] : (d.en_us || {})[k]; };
  const titleCase = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const potName = (id, f) => { const p = E.pot(id); return L('item.minecraft.' + FORM_ITEM[f || 'potion'] + '.effect.' + p.base) || titleCase(p.base); };
  const effOnly = (e) => L('effect.minecraft.' + e) || titleCase(e);
  const effName = (e, amp) => { const lv = amp ? (L('potion.potency.' + amp) || TH.util.roman(amp + 1)) : ''; return lv ? effOnly(e) + ' ' + lv : effOnly(e); };
  const ingName = (i) => TH.i18n.item(i);
  const vTag = (p) => (p.v === 'long' ? '+' : p.v === 'strong' ? (p.tag || 'II') : '');
  const vWord = (p) => (p.v === 'long' ? 'Extended' : p.v === 'strong' ? 'Enhanced' : 'Normal');

  /* ---------------- icons ---------------- */
  const GLYPH = {
    heart: 'M2 3h4v1h1v1h2V4h1V3h4v1h1v4h-1v1h-1v1h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4V9H3V8H2z',
    plus: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
    minus: 'M2 7h12v2H2z',
    x: 'M3 2l5 5 5-5 1 1-5 5 5 5-1 1-5-5-5 5-1-1 5-5-5-5z',
    up: 'M8 3l6 6-1 1-4-4v8H7V6l-4 4-1-1z',
    down: 'M8 13L2 7l1-1 4 4V2h2v8l4-4 1 1z',
    filter: 'M1 2h14v2l-5 5v6l-4-2V9L1 4z',
    info: 'M2 2h12v12H2zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z',
    no: 'M2 2h12v12H2zM3 3v10h10V3zM5 4l3 3 3-3 1 1-3 3 3 3-1 1-3-3-3 3-1-1 3-3-3-3z',
    send: 'M1 7h9V4l5 4-5 4V9H1z',
    copy: 'M5 1h9v1h1v10h-1v1H5v-1H4V2h1zM6 3v8h7V3zM1 4h2v2H2v7h1v1h7v-1h2v2h-1v1H2v-1H1z',
    back: 'M7 2l1 1-4 4h10v2H4l4 4-1 1-6-6z',
    check: 'M13 3l2 2-8 8-5-5 2-2 3 3z',
    star: 'M7 1h2v4h4v2h-2v1h-1v2h1v4h-2v-1H9v-1H7v1H6v1H4v-4h1V8H4V7H2V5h4V1z',
  };
  const glyph = (k) => {
    const s = h('span.po-ico', { 'aria-hidden': 'true' });
    s.style.setProperty('--m', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><path fill-rule='evenodd' d='${GLYPH[k]}'/></svg>`)}")`);
    return s;
  };
  const EFF_DIR = 'mob_effect/';   // + effect id (the textures are listed by tools/build-icon-list.js from js/data/potions.js)
  const effIcon = (e, size) => TH.icon(EFF_DIR + e, { size: size || 18, cls: 'po-eff' });
  function ingIcon(i, size) {
    const d = D().ingredients[i] || D().extras[i];
    if (d && d.block && TH.icon.block && TH.icon.block.has && TH.icon.block.has('minecraft:' + i)) return TH.icon.block('minecraft:' + i, { size: size || 16, fallback: d.tex });
    return TH.icon(d ? d.tex : 'item/' + i, { size: size || 16 });
  }

  /**
   * The real tinted bottle: the form's liquid layer (item/potion_overlay, item/tipped_arrow_head) multiplied by the potion
   * colour like the game's tint, the bottle (item/potion, splash_potion, lingering_potion, tipped_arrow_base) drawn over it.
   * One 16x16 canvas per form + colour, cached as a data URL; a canvas copy if the texture cannot be read back.
   */
  const T = { img: new Map(), done: new Map(), wait: new Map() };
  function loadImg(key) {
    if (!T.img.has(key)) {
      T.img.set(key, new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        let tried = false;
        im.onload = () => res(im);
        im.onerror = () => { if (!tried) { tried = true; im.src = TH.icon.remote(key); } else rej(new Error('texture ' + key)); };
        im.src = TH.icon.src(key);
      }));
    }
    return T.img.get(key);
  }
  function tinted(f, color) {
    const key = f + '|' + color;
    if (T.done.has(key)) return Promise.resolve(T.done.get(key));
    if (!T.wait.has(key)) {
      const fm = E.form(f);
      T.wait.set(key, Promise.all([loadImg(fm.liquid), loadImg(fm.tex)]).then(([liq, top]) => {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.drawImage(liq, 0, 0, 16, 16);
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = E.hex(color);
        x.fillRect(0, 0, 16, 16);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(liq, 0, 0, 16, 16);
        x.globalCompositeOperation = 'source-over';
        x.drawImage(top, 0, 0, 16, 16);
        let out = c;
        try { out = c.toDataURL('image/png'); } catch (e) { /* tainted (file://): keep the canvas, copies are drawn from it */ }
        T.done.set(key, out);
        return out;
      }).catch(() => { T.done.set(key, null); return null; }));
    }
    return T.wait.get(key);
  }
  function bottleAt(span, r, f, size) {
    if (typeof r === 'string') {
      const im = new Image();
      im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = r;
      span.replaceChildren(im);
      if (span.classList.contains('po-big')) { const sh = h('i.po-sheen'); sh.style.setProperty('--bm', `url("${r}")`); span.append(sh); }   // a light sweep over the glass
    } else if (r) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 16;
      cv.getContext('2d').drawImage(r, 0, 0);
      span.replaceChildren(cv);
    } else span.replaceChildren(TH.icon(E.form(f).tex, { size }));
  }
  /** Bottle icon of a potion in a form (.mc box, so it sizes like every other icon). */
  function bottle(potId, f, size, cls) {
    f = f || 'potion'; size = size || 32;
    const color = E.color(potId), key = f + '|' + color;
    const span = h('span.mc.po-bt' + (cls || ''), { 'aria-hidden': 'true' });
    span.style.setProperty('--mc', size + 'px');
    span.style.setProperty('--pc', E.hex(color));
    if (T.done.has(key)) bottleAt(span, T.done.get(key), f, size);
    else tinted(f, color).then((r) => bottleAt(span, r, f, size));
    return span;
  }

  /* ---------------- derived data per potion ---------------- */
  const allPots = () => D().potions;
  const formOps = (f) => (f === 'potion' ? 0 : f === 'splash' ? 1 : 2);
  const stepsOf = (id, f) => (E.reachable(id) ? E.ops(id) + formOps(f) : Infinity);
  const isInstant = (p) => p.effects.some(([e]) => D().effects[e].instant);
  const maxAmp = (p) => p.effects.reduce((m, [, , a]) => Math.max(m, a), -1);
  function durText(e) {
    if (!e.instant) return E.fmtTicks(e.ticks);
    return e.potency === 1 ? 'Instant' : 'Instant, half strength';
  }
  /** "Speed II · 1:30" lines for a potion in a form. */
  const effLines = (id, f) => E.effects(id, f).map((e) => ({ e, name: effName(e.id, e.amp), dur: durText(e) }));

  /* ---------------- filtering + sorting (pure on state) ---------------- */
  function searchText(p) {
    const parts = [potName(p.id, 'potion'), titleCase(p.base), p.id.replace(/_/g, ' ')];
    p.effects.forEach(([e]) => parts.push(effOnly(e), titleCase(e)));
    const r = E.paths(p.id)[0];
    if (r) r.forEach((s) => parts.push(ingName(s.ing)));
    return parts.join(' ').toLowerCase();
  }
  const searchCache = new Map();
  function groupOk(p, g, st, sel) {
    if (g === 'variant') return st.variant === 'all' || p.v === st.variant;
    if (g === 'q') {
      const q = (st.q || '').trim().toLowerCase();
      if (!q) return true;
      const k = TH.i18n.lang + ':' + p.id;
      if (!searchCache.has(k)) searchCache.set(k, searchText(p));
      return q.split(/\s+/).every((w) => searchCache.get(k).includes(w));
    }
    if (g === 'types') {
      const t = sel || st.types;
      if (!t.length) return true;
      return t.some((x) => (x === 'instant' ? isInstant(p) : x === 'fav' ? st.fav.includes(p.id) : p.cat === x));
    }
    if (g === 'ings') {
      const t = sel || st.ings;
      if (!t.length) return true;
      if (p.unbrewable) return false;
      const have = E.ingredientsOf(p.id, st.form);
      return st.ingMode === 'any' ? t.some((i) => have.has(i)) : t.every((i) => have.has(i));
    }
    if (g === 'effs') {
      const t = sel || st.effs;
      if (!t.length) return true;
      return t.some((e) => p.effects.some(([x]) => x === e));
    }
    return true;
  }
  const GROUPS = ['variant', 'q', 'types', 'ings', 'effs'];
  const passAll = (p, st, skip) => GROUPS.every((g) => g === skip || groupOk(p, g, st));
  function sortKey(p, st) {
    const f = st.form;
    switch (st.sort) {
      case 'name': return potName(p.id, f).toLowerCase();
      case 'duration': return E.duration(p.id, f) || (isInstant(p) ? 0.5 : 0);
      case 'steps': return stepsOf(p.id, f);
      case 'ing': { const k = E.keyIngredient(p.id); return k ? ingName(k).toLowerCase() : '￿'; }
      case 'fuel': return stepsOf(p.id, f);
      case 'power': return maxAmp(p) * 100000 + (E.duration(p.id, f) || 0);
      default: return E.pot(p.id).order;
    }
  }
  const VORDER = { n: 0, long: 1, strong: 2 };
  function results(st) {
    const list = allPots().filter((p) => passAll(p, st));
    const keys = new Map(list.map((p) => [p.id, sortKey(p, st)]));
    const dir = st.dir === -1 ? -1 : 1;
    return list.sort((a, b) => {
      const ka = keys.get(a.id), kb = keys.get(b.id);
      let c = 0;
      if (typeof ka === 'string' || typeof kb === 'string') c = String(ka).localeCompare(String(kb));
      else c = (ka === kb ? 0 : ka < kb ? -1 : 1);
      if (c) return c * dir;
      return (VORDER[a.v] - VORDER[b.v]) || (E.pot(a.id).order - E.pot(b.id).order);
    });
  }

  /* ---------------- shared bits ---------------- */
  function seg(label, items, cur, on, cls) {
    const el = h('div.seg' + (cls || ''), { role: 'radiogroup', 'aria-label': label });
    const bs = items.map(([id, t, tp, ico]) => {
      const b = h('button', { type: 'button', role: 'radio', onclick: () => on(id) }, ico || null, h('span.po-sl', t));
      b.dataset.id = String(id);
      if (tp) tip(b, tp);
      return b;
    });
    el.append(...bs);
    el.set = (v) => bs.forEach((b) => { const o = b.dataset.id === String(v); b.classList.toggle('on', o); b.setAttribute('aria-checked', String(o)); });
    el.set(cur);
    return el;
  }
  /** Small picture of a route: Water Bottle, then each ingredient and the bottle it makes (tooltips, cards, plan). */
  function miniChain(route, f, size) {
    size = size || 16;
    const out = [bottle('water', 'potion', size)];
    route.forEach((s) => {
      out.push(h('span.po-mc-ing', ingIcon(s.ing, size)));
      if (s.kind !== 'craft') out.push(bottle(s.to, s.form || 'potion', size));
      else out.push(bottle(s.to, 'arrow', size));
    });
    return h('span.po-mini', out);
  }
  function recipeTip(id, f) {
    const p = E.pot(id), r = E.route(id, f);
    const head = h('div.th-tooltip-title', potName(id, f) + (vTag(p) ? ' ' + vTag(p) : ''));
    if (!r) return [head, h('div.th-tooltip-sub', 'Cannot be brewed')];
    const n = E.brewOps(r);
    return h('div.po-rtip', head, miniChain(r, f, 18), h('div.th-tooltip-sub', n === 0 ? 'Fill a glass bottle with water' : n + (n === 1 ? ' brew' : ' brews') + ' · ' + secs(n * 20)));
  }
  function secs(s) {
    s = Math.round(s);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r ? m + ' min ' + r + ' s' : m + ' min';
    const hh = Math.floor(m / 60), mm = m % 60;
    return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
  }
  const fmt = (n) => Math.round(n).toLocaleString('en').replace(/,/g, ' ');
  function stacks(n, st) {
    st = st || 64;
    if (n < st) return '';
    const sb = Math.floor(n / (st * 27)), rest = n - sb * st * 27, k = Math.floor(rest / st), r = rest % st;
    return [sb ? sb + ' sb' : '', k ? k + ' st' : '', r ? String(r) : ''].filter(Boolean).join(' + ');
  }
  const powderText = (charges) => {
    const p = charges / D().FUEL_PER_POWDER;
    return (Number.isInteger(p) ? String(p) : p < 1 ? (Math.round(p * 100) / 100).toString() : (Math.round(p * 10) / 10).toString());
  };

  /* ================= render ================= */
  function render(root) {
    const st = S();
    const E2 = { cards: new Map(), pickRows: new Map() };
    let pq = '';   // the picker's own search (not saved; the library search is st.q)

    /* ----- head: Steps first ----- */
    const tabsSeg = seg('Potion Brewing section', [['steps', 'Steps'], ['library', 'Library'], ['ings', 'Ingredients'], ['guide', 'Guide']], st.view, (v) => setView(v));
    const head = h('div.page-head.po-head', h('h2', 'Potion Brewing'), h('div.po-tabs', tabsSeg));

    /* ================= shared actions ================= */
    function select(id, opts) {
      if (!E.pot(id)) return;
      if (st.sel !== id) st.alt = 0;
      st.sel = id;
      st.mode = 'one';
      st.recent = [id].concat(st.recent.filter((x) => x !== id)).slice(0, 8);
      save();
      E2.cards.forEach((c, k) => c.classList.toggle('on', k === id));
      if (st.view !== 'steps') setView('steps');
      else patchStage();
      patchPick();
      if (opts && opts.scroll && matchMedia('(max-width: 1000px)').matches) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function setForm(f) {
      if (!FORMS.includes(f) || st.form === f) return;
      st.form = f; save();
      formSeg.set(f); pickForm.set(f);
      if (st.view === 'library') patchList(); else { patchStage(); patchPick(); }
    }
    function toggleFav(id) {
      const i = st.fav.indexOf(id);
      if (i >= 0) st.fav.splice(i, 1); else st.fav.push(id);
      save();
      const c = E2.cards.get(id);
      if (c) { const b = c.querySelector('.po-heart'); b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', String(i < 0)); }
      if (st.view === 'steps') { patchStage(); patchPick(); }
      else if (st.types.includes('fav')) patchList(); else patchChips();
    }
    function addToPlan(id, f, quiet) {
      if (!E.reachable(id)) return;
      const step = f === 'arrow' ? 8 : 3;
      const ex = st.plan.find((x) => x.pot === id && x.form === f);
      if (ex) ex.n += step; else st.plan.push({ pot: id, form: f, n: step });
      save();
      TH.app.refreshBadges();
      if (!quiet) toast('Added to the plan: ' + potName(id, f));
      if (st.view === 'steps') { patchModeSeg(); if (st.mode === 'plan') patchStage(); }
    }
    function stat(v, label, small) { return h('div.po-stat' + (small ? '.is-sm' : ''), h('b', typeof v === 'number' ? fmt(v) : v), h('span', label)); }
    const nameTag = (id, f) => [h('span.po-nm', potName(id, f)), vTag(E.pot(id)) ? h('span.po-vtag', vTag(E.pot(id))) : null];

    /* ================= STEPS: picker column ================= */
    const pickQ = h('input.field.po-pickq', { type: 'search', placeholder: 'Choose a potion', 'aria-label': 'Choose a potion', autocomplete: 'off', spellcheck: false,
      oninput: () => { pq = pickQ.value; patchPick(); },
      onkeydown: (e) => { if (e.key === 'Enter') { const first = pickList.querySelector('.po-prk'); if (first) first.click(); } } });
    const pickToggle = h('button.btn.po-picktg', { type: 'button', 'aria-expanded': 'false', onclick: () => { st.pickOpen = !st.pickOpen; save(); patchPick(); } }, glyph('down'), h('span', 'All potions'));
    const toLibrary = h('button.btn.po-tolib', { type: 'button', onclick: () => setView('library') }, glyph('filter'), h('span', 'Filters'));
    tip(toLibrary, 'The full library: filter by type, ingredient and effect, sort, compare');
    const quickRow = h('div.po-quick', { 'aria-label': 'Recent and favourite potions' });
    const pickList = h('div.po-picklist.th-scroll');
    const pick = h('section.panel.po-pick', { 'aria-label': 'Choose a potion' },
      h('div.po-pick-top', h('div.search.po-pick-s', pickQ), toLibrary),
      quickRow, pickToggle, pickList);
    function patchPick() {
      // recent + favourites: one row of bottles
      const ids = [...new Set(st.fav.concat(st.recent))].filter((id) => E.pot(id)).slice(0, 10);
      quickRow.hidden = !ids.length;
      quickRow.replaceChildren(...ids.map((id) => tip(h('button.po-rkey' + (id === st.sel && st.mode === 'one' ? '.on' : '') + (st.fav.includes(id) ? '.is-fav' : ''), { type: 'button', 'aria-label': potName(id, st.form), onclick: () => (st.mode === 'plan' ? addToPlan(id, st.form) : select(id, { scroll: true })) }, bottle(id, st.form, 28)),
        () => potName(id, st.form) + (vTag(E.pot(id)) ? ' ' + vTag(E.pot(id)) : '') + (st.fav.includes(id) ? ' · favourite' : ''))));
      // the list (desktop: always; phone: when searching or opened)
      const qq = pq.trim().toLowerCase();
      const list = allPots().filter((p) => {
        if (!qq) return true;
        const k = TH.i18n.lang + ':' + p.id;
        if (!searchCache.has(k)) searchCache.set(k, searchText(p));
        return qq.split(/\s+/).every((w) => searchCache.get(k).includes(w));
      });
      const open = !!qq || !!st.pickOpen;
      pick.classList.toggle('is-open', open);
      pickToggle.setAttribute('aria-expanded', String(open));
      pickToggle.querySelector('.po-ico').replaceWith(glyph(open ? 'up' : 'down'));
      E2.pickRows.clear();
      pickList.replaceChildren(...(list.length ? list.map((p) => {
        const on = p.id === st.sel && st.mode === 'one';
        const add = h('button.po-prk-add', { type: 'button', 'aria-label': 'Add to plan', disabled: !E.reachable(p.id), onclick: (e) => { e.stopPropagation(); addToPlan(p.id, st.form); } }, glyph('plus'));
        tip(add, 'Add to plan (' + FORM_LABEL[st.form].toLowerCase() + ')');
        const row = h('div.po-prk' + (on ? '.on' : '') + (p.unbrewable ? '.is-na' : ''), { role: 'button', tabindex: '0', 'data-id': p.id,
          onclick: () => { if (st.mode === 'plan') addToPlan(p.id, st.form); else select(p.id, { scroll: true }); if (matchMedia('(max-width: 1000px)').matches) { pq = ''; pickQ.value = ''; st.pickOpen = false; save(); patchPick(); } },
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } } },
          bottle(p.id, st.form, 24), h('span.po-prk-n', nameTag(p.id, 'potion')), add);
        E2.pickRows.set(p.id, row);
        return row;
      }) : [h('p.po-hint', 'No potion matches.')]));
    }

    /* ================= STEPS: the stage ================= */
    const modeSeg = seg('What to brew', [['one', 'One potion'], ['plan', 'My plan']], st.mode, (m) => { st.mode = m; save(); patchModeSeg(); patchStage(); patchPick(); }, '.po-modeseg');
    const planN = h('em.po-tabn');
    modeSeg.querySelector('[data-id="plan"]').append(planN);
    function patchModeSeg() { modeSeg.set(st.mode); planN.textContent = st.plan.length ? String(st.plan.length) : ''; planN.hidden = !st.plan.length; }
    const pickForm = seg('Bottle form', FORMS.map((f) => [f, FORM_LABEL[f], f === 'arrow' ? 'Tipped arrows: 8 arrows around 1 lingering potion' : null, h('span.po-fi', { 'data-f': f })]), st.form, (f) => setForm(f), '.po-forms');
    const barIn = h('div.po-bar-in');
    const bar = h('section.panel.po-bar', { 'aria-label': 'Potion' }, h('div.po-bar-top', modeSeg, pickForm), barIn);
    const stepsPan = h('section.panel.po-steps', { 'aria-label': 'How to brew' });
    const infoPan = h('section.panel.po-info', { 'aria-label': 'About this potion' });
    const stage = h('div.po-stage', bar, stepsPan, infoPan);

    function patchStage() {
      patchModeSeg();
      pickForm.set(st.form);
      pickForm.querySelectorAll('.po-fi').forEach((s) => s.replaceChildren(bottle(st.mode === 'one' && E.reachable(st.sel) ? st.sel : 'swiftness', s.dataset.f, 16)));
      pickForm.hidden = st.mode === 'plan';
      if (st.mode === 'plan') return patchPlanStage();
      const id = st.sel, p = E.pot(id), f = st.form, fav = st.fav.includes(id);
      stage.style.setProperty('--pc', E.hex(E.color(id)));
      /* bar: the potion, its variants, favourite, add to plan */
      const fam = E.variants(id);
      const famSeg = fam.length > 1 ? seg('Variant', fam.map((x) => { const q2 = E.pot(x); return [x, q2.v === 'n' ? 'Normal' : q2.v === 'long' ? '+ Extended' : (q2.tag || 'II') + ' Enhanced', q2.v === 'long' ? 'Redstone: longer' : q2.v === 'strong' ? 'Glowstone: stronger, shorter' : null]; }), id, (x) => select(x), '.po-fam') : null;
      const favBtn = h('button.btn.small.po-favbtn' + (fav ? '.on' : ''), { type: 'button', 'aria-pressed': String(fav), 'aria-label': 'Favourite', onclick: () => toggleFav(id) }, glyph('heart'));
      tip(favBtn, fav ? 'Favourite · click to remove' : 'Add to favourites');
      const addBtn = h('button.btn.small', { type: 'button', disabled: !E.reachable(id), onclick: () => addToPlan(id, f) }, glyph('plus'), 'Add to plan');
      barIn.replaceChildren(
        h('div.po-bar-pot', h('span.po-bar-bt', bottle(id, f, 48, '.po-big')),
          h('div.po-bar-t', h('h3.po-bar-name', potName(id, f)), h('div.po-dsub', effLines(id, f).map((l) => h('span.po-bar-eff', effIcon(l.e.id, 18), l.name, h('b', l.dur))), !p.effects.length ? h('span', L('effect.none') || 'No Effects') : null))),
        h('div.po-bar-acts', famSeg, favBtn, addBtn));

      /* steps */
      const routes = E.reachable(id) ? E.paths(id) : [];
      const alt = Math.min(st.alt || 0, Math.max(0, routes.length - 1));
      const r = routes.length ? E.route(id, f, alt) : null;
      if (!r) {
        stepsPan.replaceChildren(h('div.po-steps-head', h('h3', 'How to brew')),
          h('div.po-none', h('span.po-none-bt', bottle(id, f, 56)), h('p', p.unbrewable ? 'This potion cannot be brewed. It only comes from the creative inventory or commands.' : 'Not brewable.')));
      } else {
        const n = Math.max(1, st.batches | 0);
        const cost = E.cost(r, n), ops = E.brewOps(r);
        const setB = (v) => { st.batches = Math.min(64, Math.max(1, v)); save(); patchStage(); };
        const batch = h('div.po-batchbox', h('span.po-lbl', 'Batches'),
          h('div.stepper.po-batch', h('button.step', { type: 'button', 'aria-label': 'Fewer batches', onclick: () => setB(n - 1) }, '−'),
            h('input.stepper-input', { type: 'number', min: 1, max: 64, value: n, 'aria-label': 'Batches of three bottles', onchange: (e) => setB(parseInt(e.target.value, 10) || 1) }),
            h('button.step', { type: 'button', 'aria-label': 'More batches', onclick: () => setB(n + 1) }, '+')),
          h('span.po-batch-x', '= ' + fmt(cost.out) + ' ' + (f === 'arrow' ? 'tipped arrows' : 'bottles')));
        const need = h('div.po-need',
          Object.entries(cost.ingredients).map(([i, k]) => tip(h('span.po-need-i', h('span.po-need-ico', ingIcon(i, 32)), h('b', '×' + fmt(k))), () => ingName(i) + ' ×' + fmt(k))),
          tip(h('span.po-need-i.is-fuel', h('span.po-need-ico', ingIcon('blaze_powder', 32)), h('b', powderText(cost.charges))), () => ingName('blaze_powder') + ': ' + cost.charges + ' of 20 fuel charges'),
          tip(h('span.po-need-i', h('span.po-need-ico', ingIcon('glass_bottle', 32)), h('b', '×' + fmt(cost.bottles))), () => ingName('glass_bottle') + ' ×' + cost.bottles + ', filled with water'));
        const alts = routes.length > 1 ? h('div.po-alts', { role: 'radiogroup', 'aria-label': 'Order' }, h('span.po-lbl', 'Order'), routes.map((rt, i) => {
          const b = h('button.po-alt' + (i === alt ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(i === alt), onclick: () => { st.alt = i; save(); patchStage(); } }, h('span.po-mini', rt.map((s) => ingIcon(s.ing, 16))));
          tip(b, () => rt.map((s) => ingName(s.ing)).join(' → '));
          return b;
        })) : null;
        // the big steps: fill the bottles, then one block per brew (and the arrow crafting)
        const blocks = [bigStep({ verb: 'Fill glass bottles', ing: 'glass_bottle', out: ['water', 'potion'], time: 'At water', last: !r.length, n: 0 })];
        r.forEach((s, i) => {
          const craft = s.kind === 'craft';
          blocks.push(bigStep({ verb: craft ? 'Craft with 8 arrows' : 'Add ' + ingName(s.ing), ing: s.ing, out: [s.to, craft ? 'arrow' : s.form], time: craft ? 'Crafting table' : '20 s', last: i === r.length - 1, n: i + 1 }));
        });
        stepsPan.replaceChildren(
          h('div.po-steps-head', h('h3', 'How to brew'), h('span.po-steps-sum', h('img.po-stand-ico', { src: TH.icon.src('item/brewing_stand'), alt: '' }), ops + (ops === 1 ? ' brew' : ' brews') + ' · ' + secs(ops * 20 * n) + (n > 1 ? ' for ' + n + ' batches' : ''))),
          h('div.po-needrow', h('span.po-lbl', 'You need'), need, batch),
          alts || '',
          h('div.po-flow', blocks));
        watchFlow(stepsPan.querySelector('.po-flow'));
      }
      patchInfo();
    }
    /** The connector arrow between steps only shows inside a row (a step that starts a new row has none). */
    const flowRO = window.ResizeObserver ? new ResizeObserver((list) => list.forEach((en) => markRows(en.target))) : null;
    function markRows(flow) {
      let top = null;
      const col = getComputedStyle(flow).flexDirection === 'column';
      [...flow.children].forEach((el) => { const t = el.offsetTop; el.classList.toggle('is-rowstart', !col && top !== null && Math.abs(t - top) > 4); top = t; });
    }
    function watchFlow(flow) { if (flowRO) { if (watchFlow.last) flowRO.unobserve(watchFlow.last); flowRO.observe(flow); } watchFlow.last = flow; requestAnimationFrame(() => markRows(flow)); }
    /** One big step: verb on top, ingredient, arrow, the bottle it makes, its name and time. */
    function bigStep(o) {
      const [pot, fm] = o.out;
      const el = h('div.po-bs' + (o.last ? '.is-last' : ''), { role: 'group', 'aria-label': o.verb },
        h('span.po-bs-verb', o.verb),
        h('span.po-bs-row', h('span.po-bs-ing', ingIcon(o.ing, 40)), h('span.po-bs-arrow', { 'aria-hidden': 'true' }), h('span.po-bs-out', bottle(pot, fm, 56))),
        h('span.po-bs-name', nameTag(pot, fm)),
        h('span.po-bs-time', o.time));
      tip(el.querySelector('.po-bs-ing'), () => ingName(o.ing));
      return el;
    }
    /** Secondary facts under the steps: effects in every form, cautions, next brews, other sources. */
    function patchInfo() {
      infoPan.hidden = st.mode !== 'one';
      if (st.mode !== 'one') return;
      const id = st.sel, f = st.form;
      const effs = E.effects(id, 'potion');
      const effBox = effs.length ? h('div.po-effs', effs.map((e) => {
        const info = D().effectInfo[e.id];
        return h('div.po-eff-row', effIcon(e.id, 18), h('div.po-eff-t', h('b', effName(e.id, e.amp)), info ? h('span', info(e.amp + 1)) : null));
      }), D().totals[id] ? h('div.po-eff-row.po-eff-tot', glyph('info'), h('span', D().totals[id])) : null)
        : h('div.po-effs', h('div.po-eff-row', h('span.muted', id === 'water' ? 'No effects. As a splash or lingering bottle it puts out fire and hurts endermen, blazes, striders and snow golems.' : 'No effects: a base for other potions.')));
      const forms = h('div.po-fgrid', { role: 'radiogroup', 'aria-label': 'Bottle form' }, FORMS.map((fm) => {
        const ls = effLines(id, fm), on = fm === f;
        const b = h('button.po-fcell' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => setForm(fm) },
          bottle(id, fm, 28), h('span.po-fcell-t', h('b', FORM_LABEL[fm]), ls.length ? ls.map((l) => h('span', l.dur)) : h('span', '—')));
        tip(b, () => [h('div.th-tooltip-title', potName(id, fm)), h('div.th-tooltip-sub', fm === 'potion' ? 'Drink it: full duration' : fm === 'splash' ? 'Thrown: full duration on a direct hit, less further away (4 block radius)' : fm === 'lingering' ? 'A cloud for up to 30 s: 1/4 of the duration, instant effects at half strength' : 'Hits one target: 1/8 of the duration, 8 arrows per potion')]);
        return b;
      }));
      const cs = E.cautions(id, f);
      const cautions = cs.length ? h('div.po-sec', h('span.po-lbl', 'Good to know'), h('div.po-notes', cs.map((c) => h('div.po-note.is-' + c.k, glyph(c.k === 'no' ? 'no' : 'info'), h('span', c.t))))) : null;
      const src = (f === 'arrow' ? (D().arrowSources[id] || []) : []).concat(f === 'potion' || f === 'splash' ? (D().sources[id] || []) : []);
      const srcBox = src.length ? h('div.po-sec', h('span.po-lbl', 'Where else'), h('ul.po-src', src.map((s) => h('li', s)))) : null;
      const nx = E.reachable(id) ? E.next({ pot: id, form: f === 'arrow' ? 'lingering' : f }).filter((s) => s.kind !== 'craft') : [];
      const nextBox = nx.length ? h('div.po-sec', h('span.po-lbl', 'Brew it further'), h('div.po-next', nx.map((s) => {
        const target = s.to.pot;
        const b = h('button.po-nx', { type: 'button', onclick: () => { if (s.kind === 'form') setForm(s.to.form); else select(target); } },
          ingIcon(s.ing, 20), h('span.po-nx-arrow', { 'aria-hidden': 'true' }), bottle(target, s.to.form, 24), h('span.po-nx-n', potName(target, s.to.form) + (vTag(E.pot(target)) ? ' ' + vTag(E.pot(target)) : '')));
        tip(b, () => ingName(s.ing) + ' → ' + potName(target, s.to.form));
        return b;
      }))) : null;
      infoPan.replaceChildren(h('div.po-info-grid',
        h('div.po-info-col', h('div.po-sec', h('span.po-lbl', 'Effects'), effBox), h('div.po-sec', h('span.po-lbl', 'In every form'), forms), cautions),
        h('div.po-info-col', nextBox, srcBox)));
    }

    /* ----- plan mode: merged brews with tick-off ----- */
    let lastPlan = null;
    const sendBtn = h('button.btn.primary', { type: 'button', onclick: sendToList }, glyph('send'), 'Send to Material List');
    const copyBtn = h('button.btn', { type: 'button', onclick: copyShop }, glyph('copy'), 'Copy list');
    tip(sendBtn, 'Saves the shopping list as a list in the Material List tool and opens it there');
    function planSig(items) { return items.map((x) => x.pot + '/' + x.form + '/' + x.n).join(','); }
    function patchPlanStage() {
      stage.style.setProperty('--pc', 'var(--accent)');
      const items = st.plan.filter((x) => E.pot(x.pot) && E.reachable(x.pot));
      const sig = planSig(items);
      if (!st.ticks || st.ticks.sig !== sig) { st.ticks = { sig, done: [] }; save(); }
      // bar: the plan's potions with steppers
      const rows = items.map((it) => {
        const stepN = it.form === 'arrow' ? 8 : 1;
        const set = (v) => { it.n = Math.max(stepN, Math.min(it.form === 'arrow' ? 8 * 64 : 999, v)); save(); TH.app.refreshBadges(); patchStage(); };
        return h('div.po-prow', bottle(it.pot, it.form, 32),
          h('div.po-prow-t', h('span.po-prow-n', nameTag(it.pot, it.form)), h('span.po-prow-s', FORM_LABEL[it.form] + ' · ' + (it.form === 'arrow' ? 'arrows' : 'bottles'))),
          h('div.stepper', h('button.step', { type: 'button', 'aria-label': 'Fewer', onclick: () => set(it.n - stepN) }, '−'),
            h('input.stepper-input', { type: 'number', min: stepN, value: it.n, 'aria-label': 'How many', onchange: (e) => set(parseInt(e.target.value, 10) || stepN) }),
            h('button.step', { type: 'button', 'aria-label': 'More', onclick: () => set(it.n + stepN) }, '+')),
          tip(h('button.po-heart.po-prm', { type: 'button', 'aria-label': 'Remove ' + potName(it.pot, it.form), onclick: () => { st.plan.splice(st.plan.indexOf(it), 1); save(); TH.app.refreshBadges(); patchStage(); } }, glyph('x')), 'Remove'));
      });
      barIn.replaceChildren(items.length ? h('div.po-plist', rows) : h('div.po-pempty', h('span.po-none-bt', bottle('awkward', 'potion', 48)), h('p', 'Nothing planned yet.'), h('p.po-hint', 'Pick a form above, then press + next to a potion in the list (or tap it while My plan is on).')));
      const res = lastPlan = E.plan(items);
      if (!items.length) { stepsPan.replaceChildren(h('div.po-steps-head', h('h3', 'Brewing order'))); return; }
      // you need
      const order = Object.keys(D().ingredients).concat(['blaze_powder', 'glass_bottle', 'arrow']);
      const shop = Object.entries(res.shopping || {}).filter(([, k]) => k > 0).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      const need = h('div.po-need', shop.map(([i, k]) => tip(h('span.po-need-i' + (i === 'blaze_powder' ? '.is-fuel' : ''), h('span.po-need-ico', ingIcon(i, 32)), h('b', '×' + fmt(k)), stacks(k) ? h('em', stacks(k)) : null),
        () => ingName(i) + ' ×' + fmt(k) + (i === 'glass_bottle' ? ', filled with water' : i === 'blaze_powder' ? ' (fuel ' + res.powder + ')' : ''))));
      // merged brews
      const merged = [];
      res.brews.forEach((b) => {
        const s = b.ing + '|' + b.slots.map((x) => x.from.pot + x.from.form + '>' + x.to.pot + x.to.form).join(',');
        const last = merged[merged.length - 1];
        if (last && last.sig === s) last.k++; else merged.push({ sig: s, b, k: 1 });
      });
      const done = new Set(st.ticks.done);
      let idx = 0;
      const blocks = merged.map((m, mi) => {
        const from = idx + 1; idx += m.k;
        const isDone = done.has(mi);
        const slots = [0, 1, 2].map((j) => {
          const s = m.b.slots[j];
          if (!s) return tip(h('span.po-slot.is-free'), 'Free slot: a water bottle here makes a spare');
          return tip(h('span.po-slot', bottle(s.to.pot, s.to.form, 32)), () => [h('div.th-tooltip-title', potName(s.to.pot, s.to.form) + (vTag(E.pot(s.to.pot)) ? ' ' + vTag(E.pot(s.to.pot)) : '')), h('div.th-tooltip-sub', 'from ' + potName(s.from.pot, s.from.form))]);
        });
        const outs = new Map();
        m.b.slots.forEach((s) => { const k = s.to.pot + '|' + s.to.form; outs.set(k, (outs.get(k) || 0) + 1); });
        const cb = h('input', { type: 'checkbox', checked: isDone, 'aria-label': 'Brew ' + from + ' done', onchange: (e) => {
          const d = new Set(st.ticks.done); if (e.target.checked) d.add(mi); else d.delete(mi);
          st.ticks.done = [...d]; save();
          el.classList.toggle('is-done', e.target.checked); patchProgress();
        } });
        const el = h('div.po-bs.po-pb' + (isDone ? '.is-done' : ''), { role: 'group', 'aria-label': 'Brew ' + from },
          h('span.po-bs-verb', h('span.po-pb-n', m.k > 1 ? 'Brew ' + from + '–' + idx : 'Brew ' + from), h('label.check.po-pb-ck', cb, h('span'))),
          h('span.po-bs-sub', 'Add ' + ingName(m.b.ing) + (m.k > 1 ? ' · ×' + m.k : '')),
          h('span.po-bs-row', h('span.po-bs-ing', ingIcon(m.b.ing, 40)), h('span.po-bs-arrow', { 'aria-hidden': 'true' }), h('span.po-pb-slots', slots)),
          h('span.po-pb-outs', [...outs.entries()].map(([k, c]) => { const [pp, ff] = k.split('|'); return h('span.po-pb-out', (c * m.k > 1 ? (c * m.k) + '× ' : '') + potName(pp, ff) + (vTag(E.pot(pp)) ? ' ' + vTag(E.pot(pp)) : '')); })));
        tip(el.querySelector('.po-bs-ing'), () => ingName(m.b.ing));
        return el;
      });
      const crafts = (res.crafts || []).map((c) => bigStep({ verb: 'Craft with 8 arrows', ing: 'arrow', out: [res.goals[c.goal].pot, 'arrow'], time: '×' + c.arrows + ' tipped arrows', last: true }));
      const prog = h('div.po-prog', h('span.bar', h('span')), h('span.po-prog-t'));
      function patchProgress() {
        const d = st.ticks.done.length, t = merged.length;
        prog.querySelector('.bar > span').style.width = (t ? (d / t) * 100 : 0) + '%';
        prog.querySelector('.po-prog-t').textContent = d + ' / ' + t + ' steps done';
      }
      patchProgress();
      stepsPan.replaceChildren(
        h('div.po-steps-head', h('h3', 'Brewing order'), h('span.po-steps-sum', h('img.po-stand-ico', { src: TH.icon.src('item/brewing_stand'), alt: '' }), res.ops + (res.ops === 1 ? ' brew' : ' brews') + ' · ' + secs(res.seconds) + ' · ' + res.bottles + ' bottles')),
        h('div.po-needrow', h('span.po-lbl', 'You need'), need, h('div.po-shop-acts', sendBtn, copyBtn)),
        prog,
        h('div.po-flow.is-plan', blocks, crafts));
      watchFlow(stepsPan.querySelector('.po-flow'));
    }
    function shopLines() {
      if (!lastPlan) return [];
      return Object.entries(lastPlan.shopping).filter(([, k]) => k > 0).map(([i, k]) => ['minecraft:' + i, k, ingName(i)]);
    }
    function sendToList() {
      const lines = shopLines();
      if (!lines.length) return;
      const n = st.plan.length;
      const name = 'Brewing plan · ' + n + (n === 1 ? ' potion' : ' potions');
      // English game names (the Material List reads them back to ids); the id when there is none
      const en = (TH.langData && TH.langData.en_us) || {};
      const text = lines.map(([id, k]) => { const b = id.slice(10); return (en['item.minecraft.' + b] || en['block.minecraft.' + b] || id) + ': ' + k; }).join('\n');
      const id = TH.util.uid('l');
      TH.store.update((s) => {
        const b = s.builds = s.builds || {};
        b.lists = Array.isArray(b.lists) ? b.lists : [];
        b.lists.unshift({ id, name, text, at: Date.now() });
        b.matSrc = 'list:' + id;
      }, { silent: true });
      toast('Saved ' + name + ' in the Material List');
      location.hash = '#/materials';
    }
    function copyShop() {
      const text = shopLines().map(([, k, nm]) => nm + ': ' + k).join('\n');
      try { navigator.clipboard.writeText(text).then(() => toast('Copied the shopping list'), () => toast(text)); } catch (e) { toast(text); }
    }

    /* ================= LIBRARY ================= */
    const q = h('input.field.po-search', { type: 'search', placeholder: 'Search potions, effects or ingredients', 'aria-label': 'Search potions', value: st.q || '', autocomplete: 'off', spellcheck: false,
      oninput: () => { st.q = q.value; save(); patchList(); } });
    const fBtnN = h('em.po-fn');
    const filtersBtn = h('button.btn.po-fbtn', { type: 'button', 'aria-expanded': String(!!st.filtersOpen), 'aria-controls': 'po-more', onclick: () => { st.filtersOpen = !st.filtersOpen; save(); syncFiltersOpen(); } }, glyph('filter'), h('span', 'Filters'), fBtnN);
    const formSeg = seg('Bottle form', FORMS.map((f) => [f, FORM_LABEL[f], f === 'arrow' ? 'Tipped arrows: 8 arrows around 1 lingering potion' : null, h('span.po-fi', { 'data-f': f })]), st.form, (f) => setForm(f), '.po-forms');
    const varSeg = seg('Variant', VARS.map(([id, t]) => [id, t, id === 'long' ? 'Redstone: longer duration' : id === 'strong' ? 'Glowstone: stronger effect, shorter' : null]), st.variant, (v) => { st.variant = v; save(); patchList(); }, '.po-vars');
    formSeg.querySelectorAll('.po-fi').forEach((s) => s.replaceChildren(bottle('swiftness', s.dataset.f, 16)));
    const sortRow = h('div.po-chips', { role: 'radiogroup', 'aria-label': 'Sort by' });
    const dirBtn = h('button.btn.small.po-dir', { type: 'button', onclick: () => { st.dir = st.dir === -1 ? 1 : -1; save(); patchSortRow(); patchList(); } });
    tip(dirBtn, () => (st.dir === -1 ? 'Descending · click for ascending' : 'Ascending · click for descending'));
    function patchSortRow() {
      sortRow.replaceChildren(...SORTS.map(([id, t, tp]) => {
        const on = st.sort === id;
        const b = h('button.btn.small' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => { if (st.sort !== id) { st.sort = id; st.dir = id === 'duration' || id === 'power' ? -1 : 1; } save(); patchSortRow(); patchList(); } }, t);
        if (tp) tip(b, tp);
        return b;
      }), dirBtn);
      dirBtn.replaceChildren(glyph(st.dir === -1 ? 'down' : 'up'));
      dirBtn.setAttribute('aria-label', st.dir === -1 ? 'Descending' : 'Ascending');
    }
    const typeRow = h('div.po-chips', { role: 'group', 'aria-label': 'Type' });
    const ingRow = h('div.po-chips.po-ingchips', { role: 'group', 'aria-label': 'Ingredients' });
    const effRow = h('div.po-chips.po-effchips', { role: 'group', 'aria-label': 'Effects' });
    const ingModeSeg = seg('Ingredient match', [['all', 'All', 'Potions that use every chosen ingredient'], ['any', 'Any', 'Potions that use at least one of them']], st.ingMode, (m) => { st.ingMode = m; save(); patchList(); }, '.po-mode');
    const clearBtn = h('button.btn.small.ghost.po-clear', { type: 'button', onclick: () => { st.types = []; st.ings = []; st.effs = []; st.q = ''; q.value = ''; st.variant = 'all'; varSeg.set('all'); save(); patchList(); } }, glyph('x'), h('span.po-clear-t', 'Clear filters'));
    clearBtn.setAttribute('aria-label', 'Clear filters');
    const INGS = Object.keys(D().ingredients);
    const EFFS = Object.keys(D().effects).filter((e) => allPots().some((p) => !p.unbrewable && p.effects.some(([x]) => x === e)));
    const chipEls = { types: new Map(), ings: new Map(), effs: new Map() };
    function toggle(g, id) {
      const a = st[g], i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else a.push(id);
      save(); patchList();
    }
    TYPES.forEach(([id, t]) => {
      const b = h('button.btn.small', { type: 'button', 'aria-pressed': 'false', onclick: () => toggle('types', id) }, id === 'fav' ? glyph('heart') : null, t, h('em.po-cn'));
      chipEls.types.set(id, b); typeRow.append(b);
    });
    INGS.forEach((id) => {
      const b = h('button.btn.small.po-ichip', { type: 'button', 'aria-pressed': 'false', 'aria-label': ingName(id), onclick: () => toggle('ings', id) }, ingIcon(id, 16), h('em.po-cn'));
      tip(b, () => [h('div.th-tooltip-title', ingName(id)), h('div.th-tooltip-sub', b.querySelector('.po-cn').textContent + ' potions in this view use it')]);
      chipEls.ings.set(id, b); ingRow.append(b);
    });
    EFFS.forEach((id) => {
      const b = h('button.btn.small.po-echip', { type: 'button', 'aria-pressed': 'false', 'aria-label': effOnly(id), onclick: () => toggle('effs', id) }, effIcon(id, 18), h('em.po-cn'));
      tip(b, () => [h('div.th-tooltip-title', effOnly(id)), h('div.th-tooltip-sub', b.querySelector('.po-cn').textContent + ' potions in this view have it')]);
      chipEls.effs.set(id, b); effRow.append(b);
    });
    function patchChips() {
      const others = (g) => allPots().filter((p) => passAll(p, st, g));
      Object.entries(chipEls).forEach(([g, map]) => {
        const base = others(g);
        map.forEach((b, id) => {
          const sel = g === 'ings' && st.ingMode === 'all' ? [...new Set(st.ings.concat(id))] : [id];
          const n = base.filter((p) => groupOk(p, g, st, sel)).length;
          const on = st[g].includes(id);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
          b.classList.toggle('is-zero', !n && !on);
          b.querySelector('.po-cn').textContent = String(n);
        });
      });
      const active = st.types.length + st.ings.length + st.effs.length + (st.variant !== 'all' ? 1 : 0);
      fBtnN.textContent = active ? String(active) : '';
      clearBtn.hidden = !active && !(st.q || '').trim();
      ingModeSeg.classList.toggle('is-off', st.ings.length < 2);
    }
    const row = (label, ...kids) => h('div.po-row', h('span.po-lbl', label), h('div.po-row-in', kids));
    const more = h('div.po-more', { id: 'po-more' },
      row('Sort', sortRow), row('Type', typeRow), row('Ingredients', h('div.po-ingwrap', ingRow, ingModeSeg)), row('Effects', effRow));
    function syncFiltersOpen() { filtersBtn.setAttribute('aria-expanded', String(!!st.filtersOpen)); more.classList.toggle('is-open', !!st.filtersOpen); filtersBtn.classList.toggle('on', !!st.filtersOpen); }
    const filters = h('section.panel.po-filters', { 'aria-label': 'Filters' },
      h('div.po-scene', { 'aria-hidden': 'true' }, h('i.po-stand'), h('i.po-bub'), h('i.po-bub'), h('i.po-bub')),
      h('div.po-frow', h('div.po-search-wrap.search', q), filtersBtn, clearBtn),
      h('div.po-frow.po-segs', formSeg, varSeg),
      more);
    const grid = h('div.po-grid');
    const count = h('span.po-count');
    const listPanel = h('section.panel.po-list', { 'aria-label': 'Potions' }, h('div.po-pan-head', h('h3', 'Potions'), count, h('span.po-hint.po-list-hint', 'Pick one to see its steps')), grid);
    function card(p) {
      const f = st.form, fav = st.fav.includes(p.id);
      const r = E.reachable(p.id) ? E.route(p.id, f) : null;
      const heart = h('button.po-heart' + (fav ? '.on' : ''), { type: 'button', 'aria-label': 'Favourite', 'aria-pressed': String(fav), onclick: (e) => { e.stopPropagation(); toggleFav(p.id); } }, glyph('heart'));
      const lines = effLines(p.id, f);
      const eff = lines.length ? lines.map((l) => h('span.po-cl', effIcon(l.e.id, 18), h('span.po-cl-n', l.name), h('b.po-cl-d', l.dur)))
        : [h('span.po-cl.po-cl-none', h('span.po-cl-n', L('effect.none') || 'No Effects'))];
      const ops = r ? E.brewOps(r) : null;
      const ingsEl = r ? h('span.po-cing', r.map((s) => ingIcon(s.ing, 16))) : h('span.po-cing.po-na', 'Creative only');
      const el = h('div.po-card' + (st.sel === p.id ? '.on' : '') + (p.unbrewable ? '.is-na' : ''), { role: 'button', tabindex: '0', 'data-id': p.id,
        'aria-label': potName(p.id, f) + (vTag(p) ? ' ' + vWord(p) : '') + ', show the steps',
        onclick: () => select(p.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id); } } },
        h('span.po-cbt', bottle(p.id, f, 40)),
        h('span.po-cmain',
          h('span.po-cname', h('span.po-cname-t', potName(p.id, f)), vTag(p) ? h('span.po-vtag', vTag(p)) : null),
          h('span.po-clines', eff),
          h('span.po-cfoot', ingsEl, ops != null ? h('span.po-cops', ops === 0 ? 'no brewing' : ops + (ops === 1 ? ' brew' : ' brews')) : null)),
        heart);
      tip(el, () => recipeTip(p.id, st.form));
      el.style.setProperty('--pc', E.hex(E.color(p.id)));
      E2.cards.set(p.id, el);
      return el;
    }
    function patchList() {
      patchChips();
      formSeg.set(st.form);
      const list = results(st);
      count.textContent = list.length + (list.length === 1 ? ' potion' : ' potions');
      E2.cards.clear();
      grid.replaceChildren(...(list.length ? list.map(card) : [h('div.po-none', h('span.po-none-bt', bottle('water', st.form, 48)), h('p', 'No potion matches these filters.'), h('button.btn.small', { type: 'button', onclick: () => clearBtn.click() }, 'Clear filters'))]));
    }

    /* ================= INGREDIENTS ================= */
    function ingView() {
      const mixes = E.mixesByIngredient;
      const items = Object.entries(D().ingredients).map(([id, d]) => {
        const uses = (mixes.get(id) || []);
        const water = uses.filter(([a]) => a === 'water').map(([, b]) => b);
        const awk = uses.filter(([a]) => a === 'awkward').map(([, b]) => b);
        const mods = uses.filter(([a]) => a !== 'water' && a !== 'awkward');
        const used = allPots().filter((p) => !p.unbrewable && FORMS.some((f) => E.ingredientsOf(p.id, f).has(id))).length;
        const line = (label, list) => (list.length ? h('div.po-iline', h('span.po-ilbl', label), h('span.po-ires', list.map((x) => tip(h('button.po-ib', { type: 'button', onclick: () => select(x) }, bottle(x, 'potion', 22)), () => potName(x))))) : null);
        const modLine = mods.length ? h('div.po-iline', h('span.po-ilbl', 'Changes'), h('span.po-ires.po-imods', mods.map(([a, b]) => tip(h('button.po-imod', { type: 'button', onclick: () => select(b) }, bottle(a, 'potion', 18), h('span.po-step-arrow.is-sm', { 'aria-hidden': 'true' }), bottle(b, 'potion', 18)), () => potName(a) + (vTag(E.pot(a)) ? ' ' + vTag(E.pot(a)) : '') + ' → ' + potName(b) + (vTag(E.pot(b)) ? ' ' + vTag(E.pot(b)) : ''))))) : null;
        const formLine = d.role === 'form' ? h('div.po-iline', h('span.po-ilbl', 'Turns'), h('span.po-ires', id === 'gunpowder' ? 'any potion into a splash potion' : 'a splash potion into a lingering potion')) : null;
        return h('article.po-ing', { 'data-id': id },
          h('div.po-ing-top', h('span.po-ing-ico', ingIcon(id, 32)), h('div.po-ing-t', h('h4', ingName(id)), h('span.po-src', SRC_LABEL[d.src] || d.src))),
          h('p.po-ing-w', d.where),
          line('From water', water), line('From awkward', awk), modLine, formLine,
          h('button.btn.small.po-ing-go', { type: 'button', onclick: () => { st.ings = [id]; st.types = []; st.effs = []; st.q = ''; q.value = ''; if (id === 'gunpowder' && st.form === 'potion') st.form = 'splash'; if (id === 'dragon_breath' && (st.form === 'potion' || st.form === 'splash')) st.form = 'lingering'; save(); setView('library'); } }, glyph('filter'), 'Show ' + used + ' potions'));
      });
      const ex = D().extras;
      return h('div.po-ingview',
        h('section.panel.po-ingpan', { 'aria-label': 'Ingredients' }, h('div.po-pan-head', h('h3', 'Ingredients'), h('span.po-count', Object.keys(D().ingredients).length + ' brewing ingredients')), h('div.po-inggrid', items)),
        h('section.panel.po-ingpan', { 'aria-label': 'Also needed' }, h('div.po-pan-head', h('h3', 'Also needed')),
          h('div.po-inggrid.is-sm', Object.entries(ex).map(([id, d]) => h('article.po-ing', h('div.po-ing-top', h('span.po-ing-ico', ingIcon(id, 32)), h('div.po-ing-t', h('h4', ingName(id)))), h('p.po-ing-w', d.where))),
            h('article.po-ing', h('div.po-ing-top', h('span.po-ing-ico', ingIcon('blaze_powder', 32)), h('div.po-ing-t', h('h4', ingName('blaze_powder')), h('span.po-src', 'Fuel'))), h('p.po-ing-w', 'One powder fuels 20 brews. The stand only uses fuel when a brew starts.')))));
    }

    /* ================= GUIDE ================= */
    function guideView() {
      const slot = (kids, cls) => h('span.po-gslot' + (cls || ''), kids);
      const stand = h('div.po-gstand', { 'aria-hidden': 'true' },
        slot(ingIcon('blaze_powder', 32), '.is-fuel'), slot(ingIcon('nether_wart', 32), '.is-top'),
        h('span.po-gpipes'),
        slot(bottle('water', 'potion', 32), '.is-b1'), slot(bottle('water', 'potion', 32), '.is-b2'), slot(bottle('water', 'potion', 32), '.is-b3'));
      const fact = (ico, t, sub) => h('div.po-gfact', h('span.po-gico', ico), h('div', h('b', t), sub ? h('span', sub) : null));
      const corr = D().mixes.filter(([, i]) => i === 'fermented_spider_eye').map(([a, , b]) => h('div.po-gcor', bottle(a, 'potion', 24), h('span.po-gcor-n', potName(a) + (vTag(E.pot(a)) ? ' ' + vTag(E.pot(a)) : '')), h('span.po-step-arrow', { 'aria-hidden': 'true' }), bottle(b, 'potion', 24), h('span.po-gcor-n', potName(b) + (vTag(E.pot(b)) ? ' ' + vTag(E.pot(b)) : ''))));
      const formRow = (f, t, sub) => h('div.po-gform', bottle('swiftness', f, 32), h('div', h('b', t), h('span', sub)));
      const pan = (title, ...kids) => h('section.panel.po-gpan', h('div.po-pan-head', h('h3', title)), ...kids);
      return h('div.po-guide',
        pan('The brewing stand', h('div.po-gstand-wrap', stand,
          h('div.po-gfacts',
            fact(TH.icon('item/clock_00', { size: 24 }), '20 seconds a brew', 'All three bottles at once, so brew in threes.'),
            fact(ingIcon('nether_wart', 24), 'One ingredient per brew', 'The top slot takes one item for up to three bottles.'),
            fact(ingIcon('blaze_powder', 24), 'Blaze powder = 20 brews', 'Fuel is only used when a brew starts.'),
            fact(bottle('water', 'potion', 24), 'Water bottles', 'Fill glass bottles at a water source or cauldron. Potions do not stack.')))),
        pan('Hoppers', h('div.po-gfacts',
          fact(TH.icon('item/hopper', { size: 24 }), 'Into the top', 'Ingredients go to the top slot.'),
          fact(TH.icon('item/hopper', { size: 24 }), 'Into a side', 'Bottles and blaze powder fuel.'),
          fact(TH.icon('item/hopper', { size: 24 }), 'Below the stand', 'Pulls out the bottles after every brew, so a hopper chain can brew a whole recipe hands-free.'))),
        pan('Modifiers', h('div.po-gfacts',
          fact(ingIcon('redstone', 24), 'Redstone: extended', 'Longer, same level. Not on an enhanced potion.'),
          fact(ingIcon('glowstone_dust', 24), 'Glowstone: enhanced', 'Level II, shorter. Not on an extended potion.'),
          fact(ingIcon('fermented_spider_eye', 24), 'Fermented spider eye: corrupted', 'Usually the opposite effect. Keeps + or II when the result has it.'),
          fact(ingIcon('gunpowder', 24), 'Gunpowder: splash', 'Same duration, thrown.'),
          fact(ingIcon('dragon_breath', 24), 'Dragon\'s breath: lingering', 'Only on a splash potion. A cloud with 1/4 of the duration.'))),
        pan('Corruption', h('div.po-gcors', corr), h('p.po-hint', 'Enhanced Swiftness and Leaping cannot be corrupted. Strength has no corrupted form in Java.')),
        pan('Forms and durations', h('div.po-gforms',
          formRow('potion', 'Drinkable', 'Full duration. Returns the glass bottle.'),
          formRow('splash', 'Splash', 'Full duration on a direct hit, falling off to nothing at 4 blocks. Instant effects scale the same way.'),
          formRow('lingering', 'Lingering', 'A cloud of radius 3 that shrinks to nothing in 30 s; every mob it touches takes 1/2 block off the radius. 1/4 duration, instant effects at half strength, applied again while you stay in it.'),
          formRow('arrow', 'Tipped arrow', '8 arrows around 1 lingering potion make 8. 1/8 duration, the level stays. Stacks to 64.'))),
        pan('Instant effects', h('div.po-gfacts',
          fact(effIcon('instant_health', 24), 'Healing', '4 HP, II = 8 HP. Hurts undead mobs (6 / 12).'),
          fact(effIcon('instant_damage', 24), 'Harming', '6 HP, II = 12 HP. Heals undead mobs.'),
          fact(effIcon('regeneration', 24), 'Undead and over-time effects', 'Undead mobs ignore Poison and Regeneration.'))),
        pan('Not brewable', h('div.po-gfacts',
          fact(bottle('luck', 'potion', 24), potName('luck'), 'Creative inventory and commands only; since 26.3 it cannot be turned into a splash or lingering potion either.'),
          fact(effIcon('levitation', 24), 'No potion for these', 'Levitation, Haste, Absorption, Blindness and many more effects have no brewing recipe.'),
          fact(bottle('mundane', 'potion', 24), 'Mundane and Thick', 'Dead ends in Java: nothing else is brewed from them.'))),
        pan('Other sources', h('div.po-gsrc', Object.entries(D().sources).filter(([id]) => id !== 'luck').map(([id, list]) => h('div.po-gfact', h('span.po-gico', bottle(id, id === 'weakness' ? 'splash' : 'potion', 24)), h('div', h('b', potName(id, id === 'weakness' ? 'splash' : 'potion') + (vTag(E.pot(id)) ? ' ' + vTag(E.pot(id)) : '')), list.map((x) => h('span', x))))),
          Object.entries(D().arrowSources).map(([id, list]) => h('div.po-gfact', h('span.po-gico', bottle(id, 'arrow', 24)), h('div', h('b', potName(id, 'arrow') + (vTag(E.pot(id)) ? ' ' + vTag(E.pot(id)) : '')), list.map((x) => h('span', x))))),
          h('div.po-gfact', h('span.po-gico', bottle('poison', 'arrow', 24)), h('div', h('b', 'Tipped arrows from villagers'), h('span', 'Expert fletchers trade tipped arrows; with Hero of the Village fletchers may gift some.'))))),
        pan('Brewing in 26.3', h('p.po-hint', 'Brewing recipes became data-driven in 26.3, so data packs can change them. This tool shows the default vanilla recipes.')));
    }

    /* ================= shell ================= */
    const stepsView = h('div.po-sv', pick, stage);
    const libView = h('div.po-lib', filters, listPanel);
    const body = h('div.po-body');
    let ingEl = null, guideEl = null;
    function setView(v) {
      if (!['steps', 'library', 'ings', 'guide'].includes(v)) v = 'steps';
      st.view = v; save();
      tabsSeg.set(v);
      root.dataset.poView = v;
      if (v === 'library') { body.replaceChildren(libView); patchList(); }
      else if (v === 'ings') body.replaceChildren(ingEl || (ingEl = ingView()));
      else if (v === 'guide') body.replaceChildren(guideEl || (guideEl = guideView()));
      else { body.replaceChildren(stepsView); patchStage(); patchPick(); }
      if (root.isConnected) window.scrollTo({ top: 0 });
    }
    root.append(head, body);
    patchSortRow();
    syncFiltersOpen();
    setView(st.view);
  }

  TH.potions = { bottle, potName, results };   // overview scene + console
  TH.app.register({
    id: 'potions',
    name: 'Potion Brewing',
    short: 'Brew',
    icon: () => bottle('swiftness', 'potion', 18),
    init(store) {
      // a first visit opens on a real example: Splash Potion of Healing II
      store.define('potions', { view: 'steps', mode: 'one', sel: 'strong_healing', form: 'splash', variant: 'all', q: '', types: [], ings: [], ingMode: 'all', effs: [], sort: 'game', dir: 1, alt: 0, batches: 1, plan: [], fav: [], recent: [], filtersOpen: false, pickOpen: false, ticks: null });
      const s = store.get().potions;
      ['types', 'ings', 'effs', 'plan', 'fav', 'recent'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
      // the first layout had Catalogue / Planner tabs
      if (s.view === 'plan') { s.view = 'steps'; s.mode = 'plan'; }
      if (s.view === 'list' || !['steps', 'library', 'ings', 'guide'].includes(s.view)) s.view = 'steps';
      if (s.mode !== 'plan') s.mode = 'one';
      if (!FORMS.includes(s.form)) s.form = 'potion';
      if (!['all', 'n', 'long', 'strong'].includes(s.variant)) s.variant = 'all';
      if (!SORTS.some(([id]) => id === s.sort)) s.sort = 'game';
      if (s.ingMode !== 'any') s.ingMode = 'all';
      if (!TH.data.potions.potions.some((p) => p.id === s.sel)) s.sel = 'strong_healing';
      s.plan = s.plan.filter((x) => x && TH.data.potions.potions.some((p) => p.id === x.pot) && FORMS.includes(x.form) && x.n > 0);
      s.fav = s.fav.filter((id) => TH.data.potions.potions.some((p) => p.id === id));
      s.types = s.types.filter((t) => TYPES.some(([id]) => id === t));
      s.ings = s.ings.filter((i) => TH.data.potions.ingredients[i]);
      s.effs = s.effs.filter((e) => TH.data.potions.effects[e]);
      if (!s.ticks || typeof s.ticks !== 'object' || !Array.isArray(s.ticks.done)) s.ticks = null;
      delete s.addForm;
    },
    badge(state) { const n = state.potions && state.potions.plan ? state.potions.plan.length : 0; return n ? String(n) : null; },
    render,
  });
})();
