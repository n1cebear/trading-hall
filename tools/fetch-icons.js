// Downloads every texture in js/core/icon-list.js into assets/mc/ (git-ignored, never published)
// so the app works fully offline when opened straight from your PC (index.html as a file).
//   node tools/build-icon-list.js && node tools/fetch-icons.js
// Files already there are kept. 16 downloads at a time, with retries (jsDelivr, then raw GitHub as a fallback).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const ctx = { location: { protocol: 'https:' }, console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/core/icons.js', 'js/core/icon-list.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const { TH } = ctx;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 404) return null;
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (e) { /* retry */ }
    await sleep(400 * 2 ** i);
  }
  return null;
}

(async () => {
  let ok = 0, fresh = 0;
  const failed = [], todo = [];
  for (const key of TH.iconList) {
    const out = path.join(root, TH.icon.localPath(key));
    if (fs.existsSync(out)) ok++; else todo.push([key, out]);
  }
  let i = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (i < todo.length) {
      const [key, out] = todo[i++];
      const url = TH.icon.remote(key);
      let buf = await grab(url);
      if (!buf && url.includes('cdn.jsdelivr.net/gh/')) buf = await grab(url.replace(/^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+\/[^@]+)@([^/]+)\//, 'https://raw.githubusercontent.com/$1/$2/'));
      if (!buf) { failed.push(key); continue; }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      ok++; fresh++;
    }
  }));
  console.log(`${ok}/${TH.iconList.length} textures in assets/mc/ (${fresh} new)` + (failed.length ? `; failed: ${failed.join(', ')}` : ''));
})();
