// Downloads every texture in js/core/icon-list.js into assets/mc/ (git-ignored, never published)
// so the app works fully offline when opened straight from your PC (index.html as a file).
//   node tools/build-icon-list.js && node tools/fetch-icons.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const ctx = { location: { protocol: 'https:' }, console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/core/icons.js', 'js/core/icon-list.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const { TH } = ctx;

(async () => {
  let ok = 0, failed = [];
  for (const key of TH.iconList) {
    const out = path.join(root, TH.icon.localPath(key));
    if (fs.existsSync(out)) { ok++; continue; }
    const res = await fetch(TH.icon.remote(key)).catch(() => null);
    if (!res || !res.ok) { failed.push(key); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    ok++;
  }
  console.log(`${ok}/${TH.iconList.length} textures in assets/mc/` + (failed.length ? `; failed: ${failed.join(', ')}` : ''));
})();
