// Tests for the potion brewing engine (js/modules/potions-engine.js + js/data/potions.js).
//   node tools/test-potions.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/data/potions.js', 'js/modules/potions-engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const E = ctx.TH.potionsEngine, D = ctx.TH.data.potions;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const ings = (r) => r.map((s) => s.ing).join(',');
const json = (x) => JSON.parse(JSON.stringify(x));

t('every mix names known potions and ingredients', () => {
  D.mixes.forEach(([a, i, b]) => { assert(E.pot(a) && E.pot(b), a + '/' + b); assert(D.ingredients[i], i); });
  D.starts.forEach(([i, p]) => { assert(D.ingredients[i], i); assert(E.pot(p), p); });
});
t('Awkward = Water + Nether Wart (1 op)', () => {
  assert.strictEqual(E.ops('awkward'), 1);
  assert.deepStrictEqual(json(E.paths('awkward').map(ings)), ['nether_wart']);
});
t('Thick = Water + Glowstone, Mundane from 12 ingredients', () => {
  assert.deepStrictEqual(json(E.paths('thick').map(ings)), ['glowstone_dust']);
  const m = E.paths('mundane').map(ings).sort();
  assert.deepStrictEqual(json(m), ['blaze_powder', 'breeze_rod', 'cobweb', 'ghast_tear', 'glistering_melon_slice', 'magma_cream', 'rabbit_foot', 'redstone', 'slime_block', 'spider_eye', 'stone', 'sugar'].sort());
});
t('golden carrot, pufferfish, turtle shell and phantom membrane make no Mundane Potion', () => {
  ['golden_carrot', 'pufferfish', 'turtle_helmet', 'phantom_membrane'].forEach((i) => assert(!E.paths('mundane').some((r) => r[0].ing === i), i));
});
t('Weakness = Water + Fermented Spider Eye (1 op), only from Water', () => {
  assert.strictEqual(E.ops('weakness'), 1);
  assert.deepStrictEqual(json(E.paths('weakness').map(ings)), ['fermented_spider_eye']);
  ['thick', 'mundane', 'awkward', 'strength', 'strong_strength'].forEach((p) => assert(!E.next({ pot: p, form: 'potion' }).some((s) => s.to.pot === 'weakness'), p));
});
t('Extended Invisibility: exactly two routes of 4 ops', () => {
  assert.strictEqual(E.ops('long_invisibility'), 4);
  const p = E.paths('long_invisibility').map(ings).sort();
  assert.deepStrictEqual(json(p), ['nether_wart,golden_carrot,fermented_spider_eye,redstone', 'nether_wart,golden_carrot,redstone,fermented_spider_eye'].sort());
});
t('Invisibility only through Night Vision', () => {
  assert.deepStrictEqual(json(E.paths('invisibility').map(ings)), ['nether_wart,golden_carrot,fermented_spider_eye']);
});
t('enhanced Swiftness and Leaping cannot be corrupted', () => {
  ['strong_swiftness', 'strong_leaping'].forEach((p) => assert(!E.next({ pot: p, form: 'potion' }).some((s) => s.ing === 'fermented_spider_eye'), p));
  assert.deepStrictEqual(json(E.paths('strong_slowness').map(ings).sort()), ['nether_wart,rabbit_foot,fermented_spider_eye,glowstone_dust', 'nether_wart,sugar,fermented_spider_eye,glowstone_dust'].sort());
});
t('Harming from Healing or Poison', () => {
  const p = E.paths('harming').map(ings).sort();
  assert.deepStrictEqual(json(p), ['nether_wart,glistering_melon_slice,fermented_spider_eye', 'nether_wart,spider_eye,fermented_spider_eye'].sort());
  assert.strictEqual(E.next({ pot: 'long_poison', form: 'potion' }).find((s) => s.ing === 'fermented_spider_eye').to.pot, 'harming');
  assert.strictEqual(E.next({ pot: 'strong_poison', form: 'potion' }).find((s) => s.ing === 'fermented_spider_eye').to.pot, 'strong_harming');
  assert.strictEqual(E.next({ pot: 'strong_healing', form: 'potion' }).find((s) => s.ing === 'fermented_spider_eye').to.pot, 'strong_harming');
});
t('removed 1.9 recipes stay out (Water Breathing/Fire Resistance + FSE)', () => {
  ['water_breathing', 'fire_resistance', 'long_water_breathing', 'long_fire_resistance'].forEach((p) => assert(!E.next({ pot: p, form: 'potion' }).some((s) => s.ing === 'fermented_spider_eye'), p));
});
t('redstone and glowstone are exclusive', () => {
  D.potions.filter((p) => p.v === 'long').forEach((p) => assert(!E.next({ pot: p.id, form: 'potion' }).some((s) => s.ing === 'glowstone_dust'), p.id));
  D.potions.filter((p) => p.v === 'strong').forEach((p) => assert(!E.next({ pot: p.id, form: 'potion' }).some((s) => s.ing === 'redstone'), p.id));
  ['mundane', 'thick'].forEach((p) => assert.strictEqual(E.next({ pot: p, form: 'potion' }).filter((s) => s.kind === 'mix').length, 0, p));
});
t('Oozing, Weaving, Infested, Wind Charging: no extended or enhanced version', () => {
  ['oozing', 'weaving', 'infested', 'wind_charged'].forEach((p) => {
    assert.strictEqual(E.ops(p), 2);
    assert.strictEqual(E.next({ pot: p, form: 'potion' }).filter((s) => s.kind === 'mix').length, 0, p);
  });
});
t('Luck cannot be brewed', () => { assert.strictEqual(E.reachable('luck'), false); assert.deepStrictEqual(json(E.paths('luck')), []); });
t('every other potion is reachable', () => { D.potions.filter((p) => !p.unbrewable).forEach((p) => assert(E.reachable(p.id), p.id)); });
t('splash / lingering / arrow add gunpowder, dragon breath, crafting', () => {
  assert.deepStrictEqual(json(E.route('awkward', 'splash').map((s) => s.ing)), ['nether_wart', 'gunpowder']);
  assert.deepStrictEqual(json(E.route('awkward', 'lingering').map((s) => s.ing)), ['nether_wart', 'gunpowder', 'dragon_breath']);
  const a = E.route('long_invisibility', 'arrow');
  assert.strictEqual(E.brewOps(a), 6);
  assert.strictEqual(a[a.length - 1].kind, 'craft');
  assert(E.next({ pot: 'swiftness', form: 'splash' }).some((s) => s.ing === 'redstone' && s.to.form === 'splash'));
  assert(!E.next({ pot: 'swiftness', form: 'potion' }).some((s) => s.ing === 'dragon_breath'));
});
t('durations (ticks) match the wiki', () => {
  const want = {
    night_vision: 3600, long_night_vision: 9600, invisibility: 3600, long_invisibility: 9600, leaping: 3600, long_leaping: 9600, strong_leaping: 1800,
    fire_resistance: 3600, long_fire_resistance: 9600, swiftness: 3600, long_swiftness: 9600, strong_swiftness: 1800, slowness: 1800, long_slowness: 4800,
    strong_slowness: 400, turtle_master: 400, long_turtle_master: 800, strong_turtle_master: 400, water_breathing: 3600, long_water_breathing: 9600,
    poison: 900, long_poison: 1800, strong_poison: 432, regeneration: 900, long_regeneration: 1800, strong_regeneration: 450, strength: 3600,
    long_strength: 9600, strong_strength: 1800, weakness: 1800, long_weakness: 4800, slow_falling: 1800, long_slow_falling: 4800, luck: 6000,
    wind_charged: 3600, weaving: 3600, oozing: 3600, infested: 3600,
  };
  Object.entries(want).forEach(([p, ticks]) => assert.strictEqual(E.duration(p, 'potion'), ticks, p));
  assert.strictEqual(E.fmtTicks(E.duration('strong_poison', 'potion')), '0:21');
  assert.strictEqual(E.fmtTicks(E.duration('strong_regeneration', 'potion')), '0:22');
  assert.strictEqual(E.fmtTicks(E.duration('long_swiftness', 'lingering')), '2:00');
  assert.strictEqual(E.fmtTicks(E.duration('swiftness', 'arrow')), '0:22');
  assert.strictEqual(E.duration('swiftness', 'splash'), 3600);
  assert.deepStrictEqual(json(E.effects('strong_turtle_master', 'potion').map((e) => [e.id, e.amp])), [['slowness', 5], ['resistance', 3]]);
  assert.strictEqual(E.effects('healing', 'lingering')[0].potency, 0.5);
});
t('potion colours match the wiki (Turtle Master blends)', () => {
  assert.strictEqual(E.hex(E.color('water')), '#385dc6');
  assert.strictEqual(E.hex(E.color('turtle_master')), '#8d82e6');
  assert.strictEqual(E.hex(E.color('strong_turtle_master')), '#8d85e6');
  assert.strictEqual(E.hex(E.color('swiftness')), '#33ebff');
});
t('cost: batches of 3, fuel 1/20 powder per op, 20 s per op', () => {
  const c = E.cost(E.route('long_invisibility', 'potion'), 2);
  assert.strictEqual(c.ops, 8); assert.strictEqual(c.bottles, 6); assert.strictEqual(c.seconds, 160);
  assert.strictEqual(c.powder, 0.4); assert.strictEqual(c.ingredients.golden_carrot, 2);
  const a = E.cost(E.route('poison', 'arrow'), 1);
  assert.strictEqual(a.out, 24); assert.strictEqual(a.ingredients.arrow, 24); assert.strictEqual(a.ops, 4);
});
t('planner merges shared steps', () => {
  const p = E.plan([{ pot: 'swiftness', form: 'potion', n: 3 }, { pot: 'long_swiftness', form: 'potion', n: 3 }]);
  // wart x2, sugar x2, redstone x1
  assert.strictEqual(p.ops, 5); assert.strictEqual(p.bottles, 6); assert.strictEqual(p.shopping.blaze_powder, 1);
  const q = E.plan([{ pot: 'healing', form: 'splash', n: 2 }, { pot: 'harming', form: 'splash', n: 1 }]);
  // wart, melon (3 bottles), FSE on one, gunpowder on all three
  assert.strictEqual(q.ops, 4);
  const r = E.plan([{ pot: 'night_vision', form: 'potion', n: 1 }, { pot: 'swiftness', form: 'potion', n: 1 }, { pot: 'strength', form: 'potion', n: 1 }]);
  assert.strictEqual(r.ops, 4);   // one wart brew for all three, then one effect brew each
  const s = E.plan([{ pot: 'poison', form: 'arrow', n: 16 }]);
  assert.strictEqual(s.bottles, 2); assert.strictEqual(s.shopping.arrow, 16); assert.strictEqual(s.ops, 4);
});
t('ingredient sets for the filter', () => {
  const s = E.ingredientsOf('harming', 'splash');
  ['nether_wart', 'glistering_melon_slice', 'spider_eye', 'fermented_spider_eye', 'gunpowder'].forEach((i) => assert(s.has(i), i));
  assert(!s.has('dragon_breath'));
});
console.log(n + ' potion engine tests passed' + (process.exitCode ? ' (some failed)' : ''));
