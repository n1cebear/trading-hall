/**
 * Potion brewing engine (pure JS, no DOM; tested with node in tools/test-potions.js).
 * Reads TH.data.potions (js/data/potions.js) and turns its mix tables into a graph.
 *
 *   state      = { pot, form }   pot = a potion id ('long_invisibility'), form = 'potion' | 'splash' | 'lingering' | 'arrow'
 *   E.next(s)  every brewing step from a state: [{ ing, to, kind: 'mix' | 'form' | 'craft' }]
 *   E.paths(pot)            every shortest brewing route (fewest brewing operations) from a Water Bottle to a drinkable pot,
 *                           deduplicated, best first (ties: fewer rare ingredients). A route = [{ ing, from, to }].
 *   E.allPaths(pot, max)    every simple route up to max operations (alternatives that are longer than needed)
 *   E.route(pot, form, i)   route i completed with the form steps (gunpowder, dragon's breath, the arrow crafting)
 *   E.ingredientsOf(pot, form)  every ingredient any shortest route uses (for the ingredient filter)
 *   E.cost(route, batches)  ingredients, brewing operations, fuel and time for N batches of 3 bottles
 *   E.effects(pot, form)    effects with ticks / amplifier / potency in that form
 *   E.plan(items)           brewing schedule for several targets: shared steps merged, bottles in threes
 * Bottle forms keep every mix: a splash Awkward Potion takes a golden carrot like a drinkable one. The tool shows the
 * canonical order (all effect steps first, then gunpowder, then dragon's breath, then arrows); adding gunpowder earlier
 * gives the same result with the same number of operations.
 */
(function (root) {
  'use strict';
  const TH = root.TH = root.TH || {};
  let D = null, POT = null, FORM = null, MIX = null, BY_ING = null, PREV = null;

  function init() {
    if (D === TH.data.potions && POT) return;
    D = TH.data.potions;
    POT = new Map(D.potions.map((p, i) => [p.id, Object.assign({ order: i }, p)]));
    FORM = new Map(D.forms.map((f, i) => [f.id, Object.assign({ order: i }, f)]));
    // the full mix table: explicit mixes + start mixes (Water -> Mundane, Awkward -> potion)
    const all = D.mixes.slice();
    D.starts.forEach(([ing, pot]) => { all.push(['water', ing, 'mundane']); all.push(['awkward', ing, pot]); });
    MIX = new Map();     // from -> [{ ing, to }]
    PREV = new Map();    // to -> [{ ing, from }]
    BY_ING = new Map();  // ing -> [[from, to]]
    all.forEach(([from, ing, to]) => {
      if (!POT.has(from) || !POT.has(to)) throw new Error('unknown potion in mix ' + from + ' + ' + ing + ' -> ' + to);
      (MIX.get(from) || MIX.set(from, []).get(from)).push({ ing, to });
      (PREV.get(to) || PREV.set(to, []).get(to)).push({ ing, from });
      (BY_ING.get(ing) || BY_ING.set(ing, []).get(ing)).push([from, to]);
    });
    cache.clear();
  }
  const cache = new Map();
  const memo = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };

  const pot = (id) => { init(); return POT.get(id) || null; };
  const form = (id) => { init(); return FORM.get(id) || null; };
  const rare = (ing) => ((D.ingredients[ing] || {}).rare || 1);

  /** Every brewing step out of a state. */
  function next(s) {
    init();
    const out = [];
    if (s.form !== 'arrow') (MIX.get(s.pot) || []).forEach((m) => out.push({ ing: m.ing, to: { pot: m.to, form: s.form }, kind: 'mix' }));
    D.containers.forEach(([from, ing, to]) => { if (from === s.form) out.push({ ing, to: { pot: s.pot, form: to }, kind: 'form' }); });
    if (s.form === 'lingering') out.push({ ing: 'arrow', to: { pot: s.pot, form: 'arrow' }, kind: 'craft' });
    return out;
  }
  /** Which ingredient turns `from` into `to` (drinkable mixes), or null. */
  function mixIng(from, to) { init(); const m = (MIX.get(from) || []).find((x) => x.to === to); return m ? m.ing : null; }

  /** Fewest brewing operations from a Water Bottle to each potion (BFS over the mix table). */
  function dist() {
    return memo('dist', () => {
      const d = new Map([['water', 0]]), q = ['water'];
      while (q.length) {
        const a = q.shift();
        (MIX.get(a) || []).forEach(({ to }) => { if (!d.has(to)) { d.set(to, d.get(a) + 1); q.push(to); } });
      }
      return d;
    });
  }
  const reachable = (id) => { init(); return dist().has(id); };
  const ops = (id) => { init(); const n = dist().get(id); return n == null ? null : n; };

  const rarity = (route) => route.reduce((s, st) => s + rare(st.ing), 0);
  /** Every shortest route to a drinkable potion, best first. */
  function paths(id) {
    init();
    return memo('paths:' + id, () => {
      const n = ops(id);
      if (n == null) return [];
      if (n === 0) return [[]];
      return allPaths(id, n);
    });
  }
  /**
   * Every simple route from Water to `id` with at most `max` operations (no potion visited twice), deduplicated,
   * sorted by length, then rarity, then the order of the mix table.
   */
  function allPaths(id, max) {
    init();
    const out = [], seen = new Set();
    (function walk(cur, route, visited) {
      if (cur === id && route.length) {
        const key = route.map((s) => s.ing + '>' + s.to).join('|');
        if (!seen.has(key)) { seen.add(key); out.push(route.slice()); }
        return;
      }
      if (route.length >= max) return;
      (MIX.get(cur) || []).forEach(({ ing, to }) => {
        if (visited.has(to)) return;
        if (to !== id && !canReach(to, id, max - route.length - 1)) return;
        visited.add(to); route.push({ ing, from: cur, to });
        walk(to, route, visited);
        route.pop(); visited.delete(to);
      });
    })('water', [], new Set(['water']));
    return out.sort((a, b) => a.length - b.length || rarity(a) - rarity(b));
  }
  /** Can `to` be reached from `from` in at most k operations? (memoised reverse BFS per target) */
  function canReach(from, to, k) {
    const back = memo('back:' + to, () => {
      const r = new Map([[to, 0]]), q = [to];
      while (q.length) {
        const a = q.shift();
        (PREV.get(a) || []).forEach(({ from: f }) => { if (!r.has(f)) { r.set(f, r.get(a) + 1); q.push(f); } });
      }
      return r;
    });
    const n = back.get(from);
    return n != null && n <= k;
  }

  /** Form steps after the potion is brewed: gunpowder, dragon's breath, and the arrow crafting. */
  function formSteps(id, f) {
    const s = [];
    if (f === 'splash' || f === 'lingering' || f === 'arrow') s.push({ ing: 'gunpowder', from: id, to: id, form: 'splash', kind: 'form' });
    if (f === 'lingering' || f === 'arrow') s.push({ ing: 'dragon_breath', from: id, to: id, form: 'lingering', kind: 'form' });
    if (f === 'arrow') s.push({ ing: 'arrow', from: id, to: id, form: 'arrow', kind: 'craft' });
    return s;
  }
  /** Route i (default the best) to a potion in a form, with the form steps appended. Steps: { ing, from, to, form, kind }. */
  function route(id, f, i) {
    const p = paths(id);
    if (!p.length) return null;
    const r = p[Math.min(i || 0, p.length - 1)].map((s) => Object.assign({ form: 'potion', kind: 'mix' }, s));
    return r.concat(formSteps(id, f || 'potion'));
  }
  const brewOps = (r) => r.filter((s) => s.kind !== 'craft').length;

  /** Every ingredient any shortest route to (pot, form) uses. */
  function ingredientsOf(id, f) {
    init();
    return memo('ings:' + id + ':' + f, () => {
      const set = new Set();
      paths(id).forEach((r) => r.forEach((s) => set.add(s.ing)));
      formSteps(id, f || 'potion').forEach((s) => { if (s.kind !== 'craft') set.add(s.ing); });
      return set;
    });
  }
  /** The ingredient that gives a potion its effect (the first effect / base ingredient of the best route), for sorting. */
  function keyIngredient(id) {
    const r = paths(id)[0];
    if (!r || !r.length) return null;
    const own = r.find((s) => s.ing !== 'nether_wart' && D.ingredients[s.ing] && D.ingredients[s.ing].role === 'effect');
    return (own || r[r.length - 1]).ing;
  }

  /**
   * Cost of a route for N batches (a batch = one full brewing stand, up to 3 bottles brewed together).
   * Every brewing operation uses 1 ingredient and 1 fuel charge (blaze powder = 20 charges) and takes 20 s.
   */
  function cost(r, batches) {
    init();
    batches = Math.max(1, batches | 0);
    const ings = {};
    let n = 0;
    r.forEach((s) => {
      if (s.kind === 'craft') { ings.arrow = (ings.arrow || 0) + D.ARROWS_PER_POTION * D.SLOTS * batches; return; }
      ings[s.ing] = (ings[s.ing] || 0) + batches;
      n++;
    });
    const bottles = D.SLOTS * batches;
    const out = r.length && r[r.length - 1].form === 'arrow' ? bottles * D.ARROWS_PER_POTION : bottles;
    return {
      ops: n * batches, perBatch: n, bottles, out, ingredients: ings, charges: n * batches,
      powder: (n * batches) / D.FUEL_PER_POWDER, seconds: (n * batches * D.BREW_TICKS) / 20,
    };
  }

  /** The potion's effects in a form: [{ id, ticks, amp, instant, potency }]. Durations scale like the game (floor, min 1 tick). */
  function effects(id, f) {
    const p = pot(id), fm = form(f || 'potion');
    if (!p) return [];
    return p.effects.map(([e, ticks, amp]) => {
      const inst = !!(D.effects[e] && D.effects[e].instant);
      return { id: e, amp, instant: inst, ticks: inst ? 0 : Math.max(1, Math.floor(ticks * fm.scale)), potency: inst ? fm.instant : 1 };
    });
  }
  /** Longest effect duration in a form, in ticks (instant = 0). */
  const duration = (id, f) => effects(id, f).reduce((m, e) => Math.max(m, e.ticks), 0);
  /** Game-style mm:ss (the tooltip floors seconds, so 432 ticks = 0:21). */
  function fmtTicks(t) {
    const s = Math.floor(t / 20);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /** The potion colour like the game: effect colours averaged, weighted by level (amplifier + 1). */
  function color(id) {
    const p = pot(id);
    if (!p || !p.effects.length) return D.NO_EFFECT_COLOR;
    let r = 0, g = 0, b = 0, w = 0;
    p.effects.forEach(([e, , amp]) => {
      const c = D.effects[e].color, k = amp + 1;
      r += k * ((c >> 16) & 255); g += k * ((c >> 8) & 255); b += k * (c & 255); w += k;
    });
    return (Math.floor(r / w) << 16) | (Math.floor(g / w) << 8) | Math.floor(b / w);
  }
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');

  /** What the extended / enhanced version of a potion is (or why not). */
  function variants(id) {
    init();
    const p = pot(id), base = p.base;
    return D.potions.filter((x) => x.base === base).map((x) => x.id);
  }
  /** Notes that matter when brewing this potion (the UI draws them as icon + short line). */
  function cautions(id, f) {
    init();
    const p = pot(id), out = [], fam = variants(id).map(pot);
    const has = (v) => fam.some((x) => x.v === v);
    if (p.unbrewable) out.push({ k: 'no', t: 'Cannot be brewed: creative inventory and commands only.' });
    if (p.cat !== 'base' && !p.unbrewable) {
      if (p.v === 'n' && !has('long') && !has('strong')) out.push({ k: 'no', t: 'Cannot be extended or enhanced.' });
      else if (p.v === 'n' && !has('long')) out.push({ k: 'info', t: 'Cannot be extended with redstone.' });
      else if (p.v === 'n' && !has('strong')) out.push({ k: 'info', t: 'Cannot be enhanced with glowstone.' });
      if (p.v === 'long' && has('strong')) out.push({ k: 'info', t: 'Glowstone no longer works on it: extended and enhanced never mix.' });
      if (p.v === 'strong' && has('long')) out.push({ k: 'info', t: 'Redstone no longer works on it: extended and enhanced never mix.' });
    }
    if (id === 'strong_swiftness' || id === 'strong_leaping') out.push({ k: 'no', t: 'Cannot be corrupted: a fermented spider eye does nothing here.' });
    if (id === 'long_poison') out.push({ k: 'info', t: 'A fermented spider eye turns it into a normal Potion of Harming (the extra time is lost).' });
    if (p.effects.some(([e]) => e === 'instant_health' || e === 'instant_damage')) out.push({ k: 'info', t: 'Undead mobs take it the other way round: healing hurts them, harming heals them.' });
    if (p.effects.some(([e]) => e === 'poison' || e === 'regeneration')) out.push({ k: 'info', t: 'Undead mobs are immune to it.' });
    if (id === 'strong_slowness') out.push({ k: 'info', t: 'Swiftness II and Leaping II cannot be corrupted, so Slowness IV only comes from glowstone.' });
    if (p.base === 'strength') out.push({ k: 'info', t: 'A fermented spider eye does nothing to it in Java (Weakness comes straight from a Water Bottle).' });
    if (id === 'weakness') out.push({ k: 'info', t: 'The one effect potion brewed without nether wart.' });
    if (id === 'mundane' || id === 'thick') out.push({ k: 'info', t: 'A dead end in Java: nothing more can be brewed from it, not even redstone or glowstone.' });
    if (f === 'lingering' && p.effects.some(([e]) => D.effects[e].instant)) out.push({ k: 'info', t: 'In a lingering cloud instant effects work at half strength, but hit again while you stay in it.' });
    if (f === 'arrow') out.push({ k: 'info', t: 'Tipped arrows keep the level; durations are 1/8 of the drinkable potion.' });
    return out;
  }

  /* ======================================================================
   * Planner: several targets brewed together. Each bottle walks its own route; a brewing operation takes one
   * ingredient and up to three bottles that are waiting for that ingredient (they may be different potions:
   * gunpowder turns any three bottles into splash potions). Routes are picked per target among the shortest ones so
   * that shared steps line up, and the greedy scheduler never brews an ingredient early that more bottles still need.
   * ====================================================================== */
  /** items: [{ pot, form, n }] (n = bottles, or arrows for form 'arrow'). */
  function plan(items) {
    init();
    const goals = items.filter((it) => pot(it.pot) && reachable(it.pot) && it.n > 0).map((it) => ({
      pot: it.pot, form: form(it.form) ? it.form : 'potion', n: it.n | 0,
      bottles: it.form === 'arrow' ? Math.ceil(it.n / D.ARROWS_PER_POTION) : (it.n | 0),
    }));
    if (!goals.length) return { brews: [], ops: 0, bottles: 0, shopping: {}, seconds: 0, powder: 0, goals, crafts: [] };
    // candidate routes per goal (shortest only, capped); try the combinations when there are few, else best routes
    const cands = goals.map((g) => paths(g.pot).slice(0, 6).map((r, i) => route(g.pot, g.form, i)));
    let combos = [[]];
    for (const c of cands) {
      const nx = [];
      combos.forEach((cb) => c.forEach((_, i) => nx.push(cb.concat(i))));
      combos = nx;
      if (combos.length > 256) { combos = [goals.map(() => 0)]; break; }
    }
    let best = null;
    combos.forEach((pick) => {
      const res = schedule(goals, pick.map((i, k) => cands[k][i]));
      const score = res.ops * 1000 + res.rarity;
      if (!best || score < best.score) best = Object.assign(res, { score, pick });
    });
    return best;
  }
  function schedule(goals, routes) {
    // one entry per bottle: its brewing steps (crafting is not a brew)
    const bottles = [];
    goals.forEach((g, gi) => {
      const steps = routes[gi].filter((s) => s.kind !== 'craft');
      for (let k = 0; k < g.bottles; k++) bottles.push({ g: gi, steps, at: 0, state: { pot: 'water', form: 'potion' } });
    });
    const brews = [];
    const left = () => bottles.filter((b) => b.at < b.steps.length);
    let guard = 0;
    while (left().length && guard++ < 5000) {
      const live = left();
      const ready = new Map(), later = new Map();
      live.forEach((b) => {
        const ing = b.steps[b.at].ing;
        (ready.get(ing) || ready.set(ing, []).get(ing)).push(b);
        b.steps.slice(b.at + 1).forEach((s) => later.set(s.ing, (later.get(s.ing) || 0) + 1));
      });
      // full brews first; then ingredients nothing else will wait for; then the biggest group
      const opts = [...ready.entries()].map(([ing, bs]) => ({ ing, bs, full: bs.length >= D.SLOTS, more: later.get(ing) || 0 }));
      opts.sort((a, b) => (b.full - a.full) || ((a.more > 0) - (b.more > 0)) || (b.bs.length - a.bs.length) || (rare(a.ing) - rare(b.ing)));
      const o = opts[0];
      // the bottles with the longest way to go first, same potions together
      const take = o.bs.slice().sort((a, b) => (b.steps.length - b.at) - (a.steps.length - a.at) || (a.state.pot < b.state.pot ? -1 : 1)).slice(0, D.SLOTS);
      const slots = take.map((b) => {
        const s = b.steps[b.at], from = Object.assign({}, b.state), to = { pot: s.to, form: s.form };
        b.state = to; b.at++;
        return { from, to, goal: b.g };
      });
      brews.push({ ing: o.ing, slots });
    }
    // shopping list
    const shopping = {};
    brews.forEach((b) => { shopping[b.ing] = (shopping[b.ing] || 0) + 1; });
    const nb = bottles.length;
    shopping.glass_bottle = nb;
    const crafts = [];
    goals.forEach((g, gi) => {
      if (g.form !== 'arrow') return;
      const arrows = g.bottles * D.ARROWS_PER_POTION;
      shopping.arrow = (shopping.arrow || 0) + arrows;
      crafts.push({ goal: gi, potions: g.bottles, arrows });
    });
    const ops = brews.length;
    shopping.blaze_powder = (shopping.blaze_powder || 0) + Math.ceil(ops / D.FUEL_PER_POWDER);
    return {
      brews, ops, bottles: nb, shopping, crafts, goals,
      powder: Math.ceil(ops / D.FUEL_PER_POWDER), charges: ops, seconds: (ops * D.BREW_TICKS) / 20,
      free: brews.reduce((s, b) => s + (D.SLOTS - b.slots.length), 0),
      rarity: brews.reduce((s, b) => s + rare(b.ing), 0),
    };
  }

  TH.potionsEngine = {
    init, pot, form, next, mixIng, reachable, ops, paths, allPaths, route, formSteps, brewOps, ingredientsOf, keyIngredient,
    cost, effects, duration, fmtTicks, color, hex, variants, cautions, plan,
    get data() { init(); return D; },
    get mixesByIngredient() { init(); return BY_ING; },
    get mixesFrom() { init(); return MIX; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
