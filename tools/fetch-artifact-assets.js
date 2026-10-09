// Downloads everything the app needs to run with NO network (assets/mc/, git-ignored): the icon textures of
// js/core/icon-list.js plus the 3D Trims textures (armor, trims, palettes, player skins, elytra, glint).
// Used for the claude.ai artifact build (tools/build-artifact.js) and for opening index.html as a file.
//   node tools/fetch-artifact-assets.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const VERSION = '1.21.11';
const RAW = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${VERSION}/assets/minecraft/textures/`;
const API = (d) => `https://api.github.com/repos/InventivetalentDev/minecraft-assets/contents/assets/minecraft/textures/${d.slice(0, -1)}?ref=${VERSION}`;
const DIRS = ['entity/equipment/humanoid/', 'entity/equipment/humanoid_leggings/', 'entity/equipment/wings/', 'trims/entity/humanoid/',
  'trims/entity/humanoid_leggings/', 'trims/color_palettes/', 'trims/items/'];
const FILES = ['entity/player/wide/steve.png', 'entity/player/slim/alex.png', 'misc/enchanted_glint_item.png', 'misc/enchanted_glint_armor.png'];

(async () => {
  const want = new Set(FILES.map((f) => '/assets/minecraft/textures/' + f));
  for (const d of DIRS) {
    const r = await fetch(API(d), { headers: { 'User-Agent': 'toolbox-build' } });
    const j = await r.json();
    if (!Array.isArray(j)) { console.log('listing failed for', d, j.message); continue; }
    for (const f of j) if (f.type === 'file' && f.name.endsWith('.png')) want.add('/assets/minecraft/textures/' + d + f.name);
  }
  let ok = 0, skip = 0, fail = [];
  for (const n of want) {
    const rel = n.replace('/assets/minecraft/textures/', '');
    const out = path.join(root, 'assets/mc', rel);
    if (fs.existsSync(out)) { skip++; continue; }
    const r = await fetch(RAW + rel).catch(() => null);
    if (!r || !r.ok) { fail.push(rel); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    ok++;
  }
  console.log(`trim/3D textures: ${ok} new, ${skip} already there, ${fail.length} failed` + (fail.length ? ': ' + fail.slice(0, 10).join(', ') : ''));
})();
