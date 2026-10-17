// Adds official Minecraft names to js/data/lang/<code>.js from Mojang's language files (minecraft-assets mirror).
// The lang files are merged, never rebuilt from scratch: keys already there stay, new keys are added, and only the
// key families listed in WANT are touched. Run after adding a feature that shows new game names:
//   node tools/build-lang.js            (every language that has a file in js/data/lang)
//   node tools/build-lang.js de_de fr_fr  (only these)
// Potion Brewing (js/modules/potions.js) needs: potion / splash / lingering / tipped arrow names, every effect name,
// the potency numerals (potion.potency.N) and the brewing ingredients.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const DIR = path.join(root, 'js/data/lang');
const VERSION = '26.3';
const URL_OF = (c) => `https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${VERSION}/assets/minecraft/lang/${c}.json`;
const RAW_OF = (c) => `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${VERSION}/assets/minecraft/lang/${c}.json`;

// which keys to take (regexes over the Mojang key)
const ITEMS = ['nether_wart', 'redstone', 'glowstone_dust', 'fermented_spider_eye', 'gunpowder', 'dragon_breath', 'sugar', 'rabbit_foot',
  'glistering_melon_slice', 'spider_eye', 'magma_cream', 'blaze_powder', 'blaze_rod', 'ghast_tear', 'golden_carrot', 'pufferfish', 'turtle_helmet',
  'turtle_scute', 'phantom_membrane', 'breeze_rod', 'glass_bottle', 'arrow', 'brewing_stand', 'potion', 'splash_potion', 'lingering_potion',
  'tipped_arrow', 'slime_ball', 'brown_mushroom', 'melon_slice', 'gold_nugget', 'carrot', 'sugar_cane', 'rabbit_hide', 'water_bucket', 'cauldron'];
const BLOCKS = ['stone', 'cobweb', 'slime_block', 'brewing_stand', 'cauldron', 'glass', 'hopper', 'nether_wart', 'glowstone', 'soul_sand', 'redstone_ore'];
const WANT = [
  /^item\.minecraft\.(potion|splash_potion|lingering_potion|tipped_arrow)\.effect\.[a-z_]+$/,
  /^effect\.minecraft\.[a-z_]+$/,
  /^effect\.none$/,
  /^potion\.potency\.\d+$/,
  /^potion\.(whenDrank|withAmplifier|withDuration)$/,
  /^container\.brewing$/,
  new RegExp('^item\\.minecraft\\.(' + ITEMS.join('|') + ')$'),
  new RegExp('^block\\.minecraft\\.(' + BLOCKS.join('|') + ')$'),
];
const want = (k) => WANT.some((r) => r.test(k));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function grab(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 404) return null;
      if (res.ok) return await res.text();
    } catch (e) { /* retry */ }
    await sleep(400 * 2 ** i);
  }
  return null;
}

function readLangFile(file, code) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/TH\.langData\[(["'])([^"']+)\1\]\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!m || m[2] !== code) throw new Error('unexpected format in ' + file);
  return { data: JSON.parse(m[3]), eol: src.includes('\r\n') ? '\r\n' : '\n' };
}

(async () => {
  const only = process.argv.slice(2);
  const codes = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => f.slice(0, -3))
    .filter((c) => !only.length || only.includes(c));
  let i = 0, done = 0, added = 0;
  const failed = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < codes.length) {
      const code = codes[i++];
      const file = path.join(DIR, code + '.js');
      let txt = await grab(URL_OF(code));
      if (!txt) txt = await grab(RAW_OF(code));
      if (!txt) { failed.push(code); continue; }
      let mojang;
      try { mojang = JSON.parse(txt); } catch (e) { failed.push(code); continue; }
      const { data, eol } = readLangFile(file, code);
      let n = 0;
      for (const [k, v] of Object.entries(mojang)) {
        if (!want(k) || typeof v !== 'string') continue;
        if (data[k] !== v) { data[k] = v; n++; }
      }
      fs.writeFileSync(file, 'TH.langData = TH.langData || {};' + eol + 'TH.langData[' + JSON.stringify(code) + '] = ' + JSON.stringify(data) + ';' + eol);
      added += n; done++;
    }
  }));
  console.log(`${done}/${codes.length} language files updated, ${added} keys added or changed` + (failed.length ? '; failed: ' + failed.join(', ') : ''));
})();
