// Collects the tool's own English UI strings (not the game's names) into tools/ui-strings.json for translation.
//   node tools/extract-ui-strings.js
// It scans string literals in the modules, core and index.html, keeps those that read like UI text, and drops anything that is a
// game name from Mojang's en_us language file. Digits become {n}, so "5 builds" and "12 builds" are one entry.
// The runtime (js/core/ui-i18n.js) matches whole text nodes, so a string only helps when it is shown as one piece.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const files = [];
for (const d of ['js/modules', 'js/core']) for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js') && !/ui-i18n|icon-list|three/.test(f)) files.push(d + '/' + f);
for (const f of ['js/data/presets.js', 'js/data/items.js', 'js/data/enchantments.js', 'js/data/villagers.js', 'js/data/trims.js']) files.push(f);
files.push('index.html');

// game names: never translated by hand
const game = new Set();
try {
  const ctx = { window: {}, console }; ctx.window = ctx; ctx.TH = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data/lang/en_us.js'), 'utf8'), ctx);
  Object.values((ctx.TH && ctx.TH.langData && ctx.TH.langData.en_us) || {}).forEach((v) => game.add(String(v).toLowerCase()));
} catch (e) { console.warn('no en_us lang', e.message); }

const out = new Map();
const lit = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
function ok(s) {
  if (s.length < 2 || s.length > 600) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^(https?:|minecraft:|block\/|item\/|entity\/|#\/|mc:)/.test(s)) return false;
  if (/[_]{1}[a-z]/.test(s) && !/ /.test(s)) return false;
  if (!/ /.test(s) && /[.#\[\]=:]/.test(s)) return false;            // selectors, ids, urls
  if (/[{}<>]/.test(s) && !/\{n\}/.test(s)) return false;
  if (!/[a-z]/.test(s)) return false;                                  // constants, layer strings
  if (!/ /.test(s) && !/^[A-Z]/.test(s)) return false;                 // lone lowercase words are code
  if (/^[A-Z][a-z]+[A-Z]/.test(s) && !/ /.test(s)) return false;       // camelCase names
  if (/\$\{/.test(s)) return false;                                    // template with code
  if (!/^([A-Z]|\{n\} [A-Za-z])/.test(s)) return false;               // fragments and selectors start with punctuation or lowercase
  if (/(^|[ ,(])\.[a-z][a-z-]+/.test(s)) return false;                  // css selectors
  if (/\b(float|vec[0-9]|uniform|gl_|const|function)\b/.test(s)) return false;   // shader / code
  if (/^(Digit|Key|Arrow)[A-Za-z{]/.test(s)) return false;             // key codes
  return true;
}
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  let m;
  while ((m = lit.exec(src))) {
    let s = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
    s = s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\u2019/g, '’').replace(/\\u2192/g, '→').replace(/\\u00b7/g, '·');
    s = s.replace(/\s+/g, ' ').trim();
    if (!ok(s)) continue;
    const key = s.replace(/\d[\d.,]*/g, '{n}');
    if (game.has(key.toLowerCase())) continue;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(f.replace(/^js\//, ''));
  }
}
const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-strings-extra.json'), 'utf8'));   // shell texts (menu, footer, dialogs) that are not string literals
extra.forEach((k) => { if (!out.has(k)) out.set(k, new Set(['extra'])); });
const keys = [...out.keys()].filter((k) => !/n{n}cebear/.test(k)).sort((a, b) => a.localeCompare(b));
fs.writeFileSync(path.join(__dirname, 'ui-strings.json'), JSON.stringify(keys, null, 1));
console.log(keys.length + ' strings -> tools/ui-strings.json');
