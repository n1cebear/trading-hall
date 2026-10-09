// Builds the claude.ai artifact of the whole toolbox.
//   node tools/build-artifact.js            -> writes dist-artifact/index.html + dist-artifact/files.json
// files.json = published path -> source path for every file that is NEW or CHANGED since the last build
// (hashes are kept in dist-artifact/manifest.json), so later updates only send what changed.
// Run `node tools/fetch-icons.js && node tools/fetch-artifact-assets.js` once first (textures are bundled, the artifact
// page may not load anything from other hosts).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-artifact');
fs.mkdirSync(out, { recursive: true });

// ---- page: index.html without the document wrapper (the artifact adds its own), plus the bundled-assets switch ----
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "n1cebear's toolbox";
const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || '';
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '';
const keepHead = head.split(/\r?\n/).filter((l) => !/<meta charset|<meta name="viewport"|<title>|rel="manifest"|rel="preconnect"|theme-color/.test(l)).join('\n');
const page = `<title>${title}</title>\n<script>window.TH_LOCAL_ASSETS = true;</script>\n${keepHead}\n${body}`;
fs.writeFileSync(path.join(out, 'index.html'), page);

// ---- files ----
const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + f.name;
    if (f.isDirectory()) walk(rel);
    else if (!/LICENSE|\.md$/i.test(f.name)) files.push(rel);
  }
};
['css', 'js', 'fonts', 'assets/mc'].forEach(walk);
// language files: a popular subset (the artifact publish has a file limit); the others fall back to English
const LANGS = new Set('en_us en_gb de_de fr_fr es_es es_mx it_it pt_br pt_pt nl_nl pl_pl ru_ru uk_ua tr_tr cs_cz sv_se da_dk nb_no fi_fi hu_hu ro_ro ja_jp ko_kr zh_cn zh_tw'.split(' '));
for (let i = files.length - 1; i >= 0; i--) { const m = files[i].match(/^js\/data\/lang\/(.+)\.js$/); if (m && m[1] !== 'index' && !LANGS.has(m[1])) files.splice(i, 1); }
files.push('icon.svg');

const manifestPath = path.join(out, 'manifest.json');
const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const next = {}, changed = {};
for (const rel of files) {
  const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  next[rel] = h;
  if (prev[rel] !== h) changed[rel] = rel;
}
const keys = Object.keys(changed);
for (let i = 0, n = 1; i < keys.length; i += 250, n++) fs.writeFileSync(path.join(out, 'files-' + n + '.json'), JSON.stringify(Object.fromEntries(keys.slice(i, i + 250).map((k) => [k, k]))));
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(changed));
fs.writeFileSync(path.join(out, 'manifest.next.json'), JSON.stringify(next));
console.log(`page ${Math.round(page.length / 1024)} KB, ${Object.keys(changed).length} of ${files.length} files new or changed (dist-artifact/files-1.json, files-2.json ... 250 per publish). After publishing, rename manifest.next.json to manifest.json.`);
