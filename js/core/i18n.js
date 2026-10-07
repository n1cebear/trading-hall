window.TH = window.TH || {};

/**
 * Official Minecraft names for game terms (enchantments, items, villagers, trims).
 * Strings come from Mojang's own language files (assets/minecraft/lang/<code>.json),
 * extracted into js/data/lang/<code>.js — never translated by hand.
 * The tool's own UI text stays English.
 *
 * Missing keys fall back to Mojang's en_us strings (like the game does) when en_us.js is
 * loaded, then to the English names in TH.data.
 *
 *   TH.i18n.ench('mending')            -> "Reparatur" (de_de)
 *   TH.i18n.enchLevel('sharpness', 5)  -> "Schärfe V"  (uses the game's own level numerals)
 *   TH.i18n.level(3)                   -> "III"
 *   TH.i18n.item('diamond_sword')      -> "Diamantschwert"
 *   TH.i18n.block('lectern')           -> "Lesepult"
 *   TH.i18n.prof('librarian')          -> "Bibliothekar"
 *   TH.i18n.trimPattern('sentry'), TH.i18n.trimMaterial('amethyst')
 *   TH.i18n.lang, TH.i18n.languages, TH.i18n.setLang(code) -> Promise
 */
TH.i18n = (function () {
  TH.langData = TH.langData || {};
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  let lang = 'en_us';

  const dict = () => TH.langData[lang] || {};
  const get = (key) => {
    const v = dict()[key];
    return v !== undefined ? v : (TH.langData.en_us || {})[key];
  };

  const titleCase = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const enchData = (id) => (TH.data.enchantments || []).find((e) => e.id === id);
  const profData = (id) => (TH.data.professions || []).find((p) => p.id === id);

  const api = {
    get lang() { return lang; },
    /** [{ code, name, region }] — filled in by js/data/lang/index.js */
    languages: [{ code: 'en_us', name: 'English', region: 'United States' }],

    ench: (id) => get('enchantment.minecraft.' + id) || (enchData(id) || {}).name || titleCase(id),
    level: (n) => get('enchantment.level.' + n) || ROMAN[n] || String(n),
    enchLevel(id, n) {
      const e = enchData(id);
      return e && e.maxLevel === 1 ? api.ench(id) : api.ench(id) + ' ' + api.level(n);
    },
    item: (id) => get('item.minecraft.' + id) || get('block.minecraft.' + id) || titleCase(id),
    block: (id) => get('block.minecraft.' + id) || get('item.minecraft.' + id) || titleCase(id),
    prof: (id) => get('entity.minecraft.villager.' + id) || (profData(id) || {}).name || titleCase(id),
    trimPattern: (id) => get('trim_pattern.minecraft.' + id) || titleCase(id),
    trimMaterial: (id) => get('trim_material.minecraft.' + id) || titleCase(id),

    /** Switch language; lazy-loads js/data/lang/<code>.js (+ en_us.js as fallback; works from file://). */
    setLang(code) {
      const load = (c) => (TH.langData[c] || typeof document === 'undefined') ? Promise.resolve() : new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'js/data/lang/' + c + '.js';
        s.onload = s.onerror = () => resolve();
        document.head.appendChild(s);
      });
      return Promise.all([load('en_us'), load(code)]).then(() => {
        lang = TH.langData[code] ? code : 'en_us';
      });
    },
  };
  return api;
})();
