// Tests for the Armor Trims material list + state migration (js/modules/trims.js, js/data/trims.js).
//   node tools/test-trims.js
// trims.js is loaded in a VM with tiny DOM / TH stubs; only its pure parts (TH.trims) are tested.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');

const fakeEl = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, {
  get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? () => fakeEl() : undefined),
});
const ctx = { console, URL, setTimeout, clearTimeout, location: { href: 'http://localhost/', search: '' }, navigator: {} };
ctx.window = ctx;
ctx.document = { currentScript: null, createElement: fakeEl, addEventListener() {}, querySelector: () => null, documentElement: { dataset: {} } };
ctx.matchMedia = () => ({ matches: false });
ctx.localStorage = { getItem: () => null, setItem() {} };
vm.createContext(ctx);
vm.runInContext(`
  window.TH = { data: {}, langData: {}, i18n: { lang: 'en_us', trimPattern: (id) => id[0].toUpperCase() + id.slice(1) + ' Armor Trim', trimMaterial: (id) => id[0].toUpperCase() + id.slice(1) + ' Material' },
    util: { h: () => document.createElement('div'), uid: (p) => p + Math.random(), toast() {}, clamp: (n, a, b) => Math.max(a, Math.min(b, n)), tooltip() {} },
    icon: Object.assign(() => null, { tex: (p) => 'https://x/' + p + '.png', trimKey: (id) => 'item/' + id + '_armor_trim_smithing_template', trimMaterialKey: (n) => 'item/' + n }),
    app: { register() {} } };`, ctx);
for (const f of ['js/data/trims.js', 'js/modules/trims.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const T = ctx.TH.trims, D = ctx.TH.data;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const json = (x) => JSON.parse(JSON.stringify(x));
/** A state with the given looks: { helmet: ['sentry', 'gold'], ... } (missing pieces = no trim). */
function outfit(looks, extra) {
  const st = T.norm(T.defaults());
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((p) => {
    const l = looks[p];
    st.outfit[p].pattern = l ? l[0] : null;
    st.outfit[p].material = l ? l[1] : null;
    if (l && l[2]) st.outfit[p].armor = l[2];
  });
  return T.norm(Object.assign(st, extra || {}));
}
const qty = (list, key) => Object.fromEntries(list.map((r) => [r[key], r.qty]));
/** Invariants every material list must meet. */
function check(M) {
  const tpl = M.templates.reduce((a, r) => a + r.qty, 0), ing = M.ingredients.reduce((a, r) => a + r.qty, 0);
  assert.strictEqual(tpl, M.trimmed, 'one template per trimmed piece');
  assert.strictEqual(ing, M.trimmed, 'one trim material per trimmed piece');
  assert.strictEqual(M.copies, M.templates.reduce((a, r) => a + (r.qty - 1), 0), 'copies = templates - 1 per pattern');
  assert.strictEqual(M.diamonds, M.copies * D.templateCopyDiamonds, '7 diamonds per copy');
  assert.strictEqual(M.dupes.reduce((a, r) => a + r.qty, 0), M.copies, 'one base block per copy');
  M.templates.forEach((r) => assert.strictEqual(r.pieces.length, r.qty));
  M.ingredients.forEach((r) => assert.strictEqual(r.pieces.length, r.qty));
}

t('same trim everywhere: 1 pattern x4, 3 copies, 21 diamonds, 3 cobblestone, 4 quartz', () => {
  const M = T.computeMaterials(outfit({ helmet: ['sentry', 'quartz'], chestplate: ['sentry', 'quartz'], leggings: ['sentry', 'quartz'], boots: ['sentry', 'quartz'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { sentry: 4 });
  assert.strictEqual(M.copies, 3); assert.strictEqual(M.diamonds, 21);
  assert.deepStrictEqual(json(M.dupes.map((r) => [r.name, r.qty])), [['Cobblestone', 3]]);
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { quartz: 4 });
  assert.strictEqual(M.mixed, false);
});
t('four different patterns and materials: 4 originals, no copies, one of each material', () => {
  const M = T.computeMaterials(outfit({ helmet: ['sentry', 'gold'], chestplate: ['dune', 'iron'], leggings: ['ward', 'redstone'], boots: ['flow', 'emerald'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { sentry: 1, dune: 1, ward: 1, flow: 1 });
  assert.strictEqual(M.copies, 0); assert.strictEqual(M.diamonds, 0); assert.strictEqual(M.dupes.length, 0);
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { gold: 1, iron: 1, redstone: 1, emerald: 1 });
  assert.strictEqual(M.mixed, true);
  assert.deepStrictEqual(json(M.perPiece.map((x) => [x.piece, x.pattern, x.material])), [['helmet', 'sentry', 'gold'], ['chestplate', 'dune', 'iron'], ['leggings', 'ward', 'redstone'], ['boots', 'flow', 'emerald']]);
});
t('same pattern, different materials: one template x4 (3 copies), four materials', () => {
  const M = T.computeMaterials(outfit({ helmet: ['rib', 'gold'], chestplate: ['rib', 'iron'], leggings: ['rib', 'gold'], boots: ['rib', 'netherite'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { rib: 4 });
  assert.deepStrictEqual(json(M.dupes.map((r) => [r.name, r.qty])), [['Netherrack', 3]]);
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { gold: 2, iron: 1, netherite: 1 });
  assert.deepStrictEqual(json(M.ingredients.find((r) => r.id === 'gold').pieces), ['helmet', 'leggings']);
  assert.strictEqual(M.mixed, true);
});
t('two patterns sharing a base block: copies of both add up on one block line', () => {
  // ward + silence both copy with cobbled deepslate; coast with cobblestone
  const M = T.computeMaterials(outfit({ helmet: ['ward', 'amethyst'], chestplate: ['ward', 'amethyst'], leggings: ['silence', 'amethyst'], boots: ['silence', 'lapis'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { ward: 2, silence: 2 });
  assert.strictEqual(M.copies, 2); assert.strictEqual(M.diamonds, 14);
  assert.deepStrictEqual(json(M.dupes.map((r) => [r.name, r.qty])), [['Cobbled Deepslate', 2]]);
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { amethyst: 3, lapis: 1 });
});
t('three + one: copies only for the shared pattern', () => {
  const M = T.computeMaterials(outfit({ helmet: ['eye', 'diamond', 'netherite'], chestplate: ['eye', 'diamond', 'netherite'], leggings: ['eye', 'copper', 'netherite'], boots: ['spire', 'resin', 'iron'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { eye: 3, spire: 1 });
  assert.deepStrictEqual(json(M.dupes.map((r) => [r.name, r.qty])), [['End Stone', 2]]);
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { diamond: 2, copper: 1, resin: 1 });
});
t('untrimmed and hidden pieces are not counted', () => {
  const st = outfit({ helmet: ['host', 'gold'], chestplate: ['host', 'gold'], leggings: null, boots: ['bolt', 'copper'] });
  st.outfit.boots.show = false;
  const M = T.computeMaterials(st);
  check(M);
  assert.strictEqual(M.trimmed, 2);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { host: 2 });
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { gold: 2 });
});
t('elytra worn: the chestplate is not counted (and a note is flagged)', () => {
  const M = T.computeMaterials(outfit({ helmet: ['vex', 'gold'], chestplate: ['wild', 'emerald'], leggings: ['vex', 'gold'], boots: ['vex', 'gold'] }, { elytra: true }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { vex: 3 });
  assert.deepStrictEqual(json(qty(M.ingredients, 'id')), { gold: 3 });
  assert.strictEqual(M.elytraChest, true);
  assert.strictEqual(M.mixed, false);
});
t('owned original: still 1 original + copies, nothing to find', () => {
  const st = outfit({ helmet: ['tide', 'quartz'], chestplate: ['tide', 'quartz'], leggings: ['tide', 'quartz'], boots: ['tide', 'quartz'] });
  st.owned.tide = true;
  const M = T.computeMaterials(st);
  check(M);
  assert.strictEqual(M.finds, 0); assert.strictEqual(M.copies, 3);
});
t('turtle shell helmet can be trimmed and counts like any piece', () => {
  const M = T.computeMaterials(outfit({ helmet: ['snout', 'gold', 'turtle'] }));
  check(M);
  assert.deepStrictEqual(json(qty(M.templates, 'id')), { snout: 1 });
});
t('copy-list text has the per-piece lines when the pieces differ', () => {
  const st = outfit({ helmet: ['sentry', 'gold'], chestplate: ['dune', 'iron'], leggings: ['sentry', 'gold'], boots: null });
  const txt = T.materialsText(st, T.computeMaterials(st));
  assert(/Per piece/.test(txt), txt);
  assert(/- Helmet: Sentry Armor Trim, Gold Material/.test(txt), txt);
  assert(/- 2x Sentry Armor Trim \(find the original in Pillager Outpost, copy it 1x\)/.test(txt), txt);
  assert(/- 7x Diamond/.test(txt) && /- 1x Cobblestone/.test(txt), txt);
});
t('sharedLook: majority look, n = pieces that share it', () => {
  const st = outfit({ helmet: ['sentry', 'gold'], chestplate: ['sentry', 'gold'], leggings: ['sentry', 'gold'], boots: ['dune', 'gold'] });
  assert.deepStrictEqual(json(T.sharedLook(st)), { key: 'sentry|gold', n: 3 });
  const all = outfit({ helmet: ['a', 'x'] });   // invalid ids are cleaned by norm
  assert.strictEqual(T.sharedLook(all).n, 4);
});
t('old saves keep loading: v2 state without target / cape fields', () => {
  const old = { v: 2, owned: {}, outfit: { helmet: { armor: 'iron', pattern: 'coast', material: 'lapis', dye: null, show: true } }, skin: { kind: 'name', name: 'jeb_', data: 'data:image/png;base64,AA', slim: false } };
  const st = T.norm(old);
  assert.strictEqual(st.target, 'all');
  assert.strictEqual(st.cape, true);
  assert.strictEqual(st.skin.cape, undefined, 'a name skin from before capes stays "not looked up"');
  assert.strictEqual(st.outfit.helmet.pattern, 'coast');
  assert.strictEqual(st.outfit.boots.armor, 'diamond', 'a missing piece gets the default look');
  const st2 = T.norm({ v: 2, skin: { kind: 'steve' }, target: 'boots', cape: false });
  assert.strictEqual(st2.skin.cape, null); assert.strictEqual(st2.target, 'boots'); assert.strictEqual(st2.cape, false);
  assert.strictEqual(T.norm({ target: 'gloves' }).target, 'all');
});

console.log(n + ' trims tests passed' + (process.exitCode ? ' (with failures)' : ''));
