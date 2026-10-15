// Writes js/data/block-db.js: every block of the game version the app uses (VERSION in js/core/icons.js), read from the
// game's own blockstate -> model -> item files (InventivetalentDev/minecraft-assets on GitHub / jsDelivr).
//   node tools/build-block-db.js        (network; downloads are cached in the OS temp folder, so a rerun is quick)
// Then: node tools/build-icon-list.js && node tools/fetch-icons.js (the textures the DB names).
//
// Output (TH.data.blockDb, see js/core/block-icons.js for the reader):
//   v      game version
//   tpl    geometry templates: [[from3, to3, faces, rot?, noShade?], ...] per model that owns elements. faces =
//          { dir: [textureVar, uv4 | 0, faceRotation, tintIndex] } (tintIndex -1 = none)
//   gui    the gui display transforms [rx, ry, rz, tx, ty, tz, sx, sy, sz]
//   b      id -> [shape, [top, side, bottom] | one texture, flags, tint, icon] (trailing zeros dropped)
//          shape  cube | slab | stairs | wall | fence | pane | cross | carpet | other (of the placed block)
//          top / side / bottom  texture keys ('stone' = 'block/stone', anything with a '/' is a full key)
//          flags  1 has an item, 2 translucent, 4 cutout, 8 leaves, 16 gives light, 32 special item (no model icon),
//                 64 flat item sprite
//          tint   '#rrggbb' or 0 (grass / foliage colour of the item, fixed biome)
//          icon   [tpl, gui, { var: texture } | one texture for every var] = the inventory model, or ['sprite texture'] = a flat sprite, or 0
//   names  id -> English name, only where it is not just the id in title case ('hay_block' -> 'Hay Bale')
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.join(__dirname, '..');
const VERSION = (fs.readFileSync(path.join(root, 'js/core/icons.js'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
if (!VERSION) throw new Error('VERSION not found in js/core/icons.js');
const RAW = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${VERSION}/`;
const CDN = `https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${VERSION}/`;
const CACHE = path.join(os.tmpdir(), 'toolbox-mc-' + VERSION);
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'toolbox-build' } });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(500 * 2 ** i);
  }
  throw new Error('failed: ' + url);
}
/** A file of the repo (cached on disk). null when it does not exist. */
async function file(rel) {
  const c = path.join(CACHE, rel.replace(/[\\/]/g, '__'));
  if (fs.existsSync(c)) { const t = fs.readFileSync(c, 'utf8'); return t === '\0404' ? null : t; }
  let t = null;
  try { t = await get(RAW + rel); } catch (e) { t = await get(CDN + rel); }
  fs.writeFileSync(c, t == null ? '\0404' : t);
  return t;
}
async function listing() {
  const c = path.join(CACHE, '_tree.json');
  if (!fs.existsSync(c)) {
    let paths = null;
    const t = await get(`https://api.github.com/repos/InventivetalentDev/minecraft-assets/git/trees/${VERSION}?recursive=1`).catch(() => null);
    if (t) { const j = JSON.parse(t); if (Array.isArray(j.tree) && !j.truncated) paths = j.tree.map((x) => x.path); }
    if (!paths) {
      const f = await get(`https://data.jsdelivr.com/v1/package/gh/InventivetalentDev/minecraft-assets@${VERSION}/flat`);
      paths = JSON.parse(f).files.map((x) => x.name.replace(/^\//, ''));
    }
    fs.writeFileSync(c, JSON.stringify(paths));
  }
  return JSON.parse(fs.readFileSync(c, 'utf8'));
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

const MC = 'assets/minecraft/';
const bare = (s) => String(s).replace(/^minecraft:/, '');
const modelPath = (ref) => { let r = bare(ref); if (!r.includes('/')) r = 'block/' + r; return MC + 'models/' + r + '.json'; };
const titleCase = (s) => s.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

(async () => {
  const paths = await listing();
  const has = new Set(paths);
  const blocks = paths.filter((p) => p.startsWith(MC + 'blockstates/') && p.endsWith('.json')).map((p) => p.slice(MC.length + 12, -5)).filter((b) => !b.startsWith('_')).sort();
  const itemIds = paths.filter((p) => p.startsWith(MC + 'items/') && p.endsWith('.json')).map((p) => p.slice(MC.length + 6, -5));
  console.log(`${VERSION}: ${blocks.length} blocks, ${itemIds.length} items`);

  // ---- fetch every blockstate + item definition, then the model chains ----
  const json = new Map();
  const load = async (rel) => { if (json.has(rel)) return json.get(rel); const t = await file(rel); const j = t ? JSON.parse(t) : null; json.set(rel, j); return j; };
  await pool(blocks.map((b) => MC + 'blockstates/' + b + '.json').concat(blocks.filter((b) => has.has(MC + 'items/' + b + '.json')).map((b) => MC + 'items/' + b + '.json')), 16, load);
  const lang = JSON.parse(await file(MC + 'lang/en_us.json'));

  // model chain resolution (fetches parents on demand)
  async function chain(ref) {
    const out = [];
    let r = ref, guard = 0;
    while (r && guard++ < 20) {
      const name = bare(r).includes('/') ? bare(r) : 'block/' + bare(r);
      if (name.startsWith('builtin/')) { out.push({ name, j: {} }); break; }
      const j = await load(modelPath(name));
      if (!j) break;
      out.push({ name, j });
      r = j.parent;
    }
    return out;
  }
  function merged(ch) {
    const tex = {};
    for (let i = ch.length - 1; i >= 0; i--) Object.assign(tex, ch[i].j.textures || {});
    const own = ch.find((c) => c.j.elements);
    const gui = (ch.find((c) => c.j.display && c.j.display.gui) || {}).j;
    const names = ch.map((c) => c.name);
    const generated = names.some((n) => n === 'item/generated' || n === 'builtin/generated' || n === 'item/handheld');
    return { tex, own, gui: gui ? gui.display.gui : null, names, generated };
  }
  // a texture value may be an object ({ sprite, force_translucent }) and a face may name a var without the '#'
  const texStr = (x) => (x && typeof x === 'object' ? x.sprite : x);
  const resolveTex = (tex, v, depth = 0) => {
    let x = texStr(v);
    if (x && x[0] !== '#' && !x.includes('/') && !x.includes(':')) x = '#' + x;
    while (x && x[0] === '#' && depth++ < 10) x = texStr(tex[x.slice(1)]);
    return x && x[0] !== '#' ? bare(x) : null;
  };
  const short = (t) => (t && t.startsWith('block/') ? t.slice(6) : t);

  // templates + gui transforms
  const tplIndex = new Map(), tpls = [], guiIndex = new Map(), guis = [];
  function tplOf(own) {
    if (tplIndex.has(own.name)) return tplIndex.get(own.name);
    const els = own.j.elements.map((e) => {
      const faces = {};
      Object.entries(e.faces || {}).forEach(([d, f]) => { faces[d] = [String(f.texture || '').replace(/^#/, ''), f.uv || 0, f.rotation || 0, f.tintindex == null ? -1 : f.tintindex]; });
      const el = [e.from, e.to, faces];
      if (e.rotation && e.rotation.angle) el[3] = [e.rotation.origin, e.rotation.axis, e.rotation.angle];
      if (e.shade === false) { el[3] = el[3] || 0; el[4] = 1; }
      return el;
    });
    const i = tpls.push(els) - 1;
    tplIndex.set(own.name, i);
    return i;
  }
  function guiOf(g) {
    const v = [...(g && g.rotation || [30, 225, 0]), ...(g && g.translation || [0, 0, 0]), ...(g && g.scale || [0.625, 0.625, 0.625])];
    const k = v.join(',');
    if (!guiIndex.has(k)) guiIndex.set(k, guis.push(v) - 1);
    return guiIndex.get(k);
  }
  /** The texture vars a template uses, resolved for one model. */
  function texMap(t, tex) {
    const m = {};
    tpls[t].forEach((e) => Object.values(e[2]).forEach((f) => { if (!(f[0] in m)) { const r = resolveTex(tex, '#' + f[0]); if (r) m[f[0]] = short(r); } }));
    return m;
  }
  /** top / side / bottom of a resolved model: faces of its first (largest) element. */
  function tsb(md) {
    if (!md.own) return null;
    const els = md.own.j.elements;
    let best = els[0], vol = -1;
    els.forEach((e) => { const v = (e.to[0] - e.from[0]) * (e.to[1] - e.from[1]) * (e.to[2] - e.from[2]); if (v > vol + 1e-6) { vol = v; best = e; } });
    const f = best.faces || {}, r = (d) => (f[d] ? resolveTex(md.tex, f[d].texture) : null);
    const side = r('east') || r('south') || r('west') || r('north') || r('up');
    return [short(r('up') || side), short(side), short(r('down') || r('up') || side)];
  }
  const SHAPES = [
    [/^block\/(slab|slab_top)$/, 'slab'], [/^block\/(stairs|inner_stairs|outer_stairs)$/, 'stairs'], [/^block\/(template_wall_post|wall_inventory)$/, 'wall'],
    [/^block\/(fence_post|fence_inventory)$/, 'fence'], [/^block\/template_glass_pane_(post|noside)$/, 'pane'],
    [/^block\/(cross|tinted_cross|crop|cross_emissive|template_seagrass|stem_growth\d)$/, 'cross'], [/^block\/carpet$/, 'carpet'],
    [/^block\/(cube|cube_all|cube_column|leaves)$/, 'cube'],
  ];
  const shapeOf = (names) => { for (const [re, s] of SHAPES) if (names.some((n) => re.test(n))) return s; return 'other'; };

  /** The item definition's plain model + tints (select / condition: the fallback; special: flagged). */
  function itemModel(m) {
    for (let g = 0; m && g < 10; g++) {
      if (m.type === 'minecraft:model') return { model: m.model, tints: m.tints || [] };
      if (m.type === 'minecraft:special') return { model: m.base, tints: [], special: true };
      m = m.fallback || m.on_false || (m.cases && m.cases[0] && m.cases[0].model) || (m.entries && m.entries[0] && m.entries[0].model) || null;
    }
    return null;
  }
  const tintHex = (t) => {
    if (!t) return 0;
    if (t.type === 'minecraft:constant') return '#' + ((t.value >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    if (t.type === 'minecraft:grass') return '#91bd59';
    if (t.type === 'minecraft:foliage' || t.type === 'minecraft:dry_foliage') return '#48b518';
    return 0;
  };
  const TRANSLUCENT = /(^|_)glass($|_pane$)|^ice$|^frosted_ice$|slime_block|honey_block|nether_portal|bubble_column/;
  const CUTOUT = /^glass$|^glass_pane$|_leaves$|spawner|^iron_bars$|_door$|_trapdoor$|ladder|scaffolding|vine|cobweb|_sapling$|grate|^vault$|trial_spawner|mangrove_roots|chain$|lantern|rail$|torch/;
  const GLOW = /glowstone|sea_lantern|shroomlight|froglight|lantern$|^jack_o_lantern$|torch$|^beacon$|^end_rod$|magma_block|redstone_lamp|^lava$|copper_bulb|creaking_heart|^light$|campfire|^crying_obsidian$|respawn_anchor|^conduit$|sculk_catalyst|candle_cake|ochre|verdant|pearlescent/;

  const out = {}, names = {}, missingTex = new Set();
  const texExists = (t) => has.has(MC + 'textures/' + (t.includes('/') ? t : 'block/' + t) + '.png');
  let done = 0;
  async function one(id) {
    const st = json.get(MC + 'blockstates/' + id + '.json');
    // the placed block's model: the variant named like the block, else the first variant / the first multipart part
    let ref = null;
    if (st && st.variants) {
      const vs = Object.values(st.variants).map((v) => (Array.isArray(v) ? v[0] : v));
      ref = (vs.find((v) => bare(v.model) === 'block/' + id) || vs[0] || {}).model;
    } else if (st && st.multipart) {
      const p = st.multipart.find((x) => !x.when) || st.multipart[0];
      ref = p && (Array.isArray(p.apply) ? p.apply[0] : p.apply).model;
    }
    const bm = ref ? merged(await chain(ref)) : null;
    const idef = json.get(MC + 'items/' + id + '.json');
    const im = idef ? itemModel(idef.model) : null;
    const imd = im && im.model ? merged(await chain(im.model)) : null;
    let flags = 0;
    if (idef) flags |= 1;
    let tint = 0;
    if (im) tint = tintHex(im.tints[0]);
    if (!tint && !idef && /grass_block|^short_grass$|^tall_grass$|^fern$|large_fern|sugar_cane/.test(id)) tint = '#91bd59';
    if (!tint && /_leaves$|^vine$/.test(id) && !/cherry|azalea|pale_oak|poplar/.test(id)) tint = '#48b518';
    let icon = 0;
    if (im && im.special) flags |= 32;
    else if (imd && imd.generated) {
      const l0 = resolveTex(imd.tex, '#layer0');
      if (l0) { icon = [short(l0)]; flags |= 64; }
    } else if (imd && imd.own && imd.own.j.elements.length <= 64) {
      const t = tplOf(imd.own);
      icon = [t, guiOf(imd.gui), texMap(t, imd.tex)];
    }
    let shape = bm ? shapeOf(bm.names) : 'other';
    // a model of its own that is one full cube (grass block, crafter, ...) is a cube too
    if (shape === 'other' && bm && bm.own && bm.own.j.elements.every((e) => e.from.join() === '0,0,0' && e.to.join() === '16,16,16')) shape = 'cube';
    let t3 = (bm && tsb(bm)) || (imd && tsb(imd)) || null;
    if (!t3 && icon && icon.length === 1) t3 = [icon[0], icon[0], icon[0]];
    if (!t3 && bm) { const pt = resolveTex(bm.tex, '#particle'); if (pt) t3 = [short(pt), short(pt), short(pt)]; }   // entity-drawn blocks: their particle
    if (!t3) t3 = [0, 0, 0];
    if (shape === 'pane' && icon && icon.length === 1) t3 = [icon[0], icon[0], icon[0]];   // the pane, not its edge
    if (TRANSLUCENT.test(id)) flags |= 2;
    if (CUTOUT.test(id) || shape === 'cross') flags |= 4;
    if (/_leaves$/.test(id)) flags |= 8;
    if (GLOW.test(id)) flags |= 16;
    [...t3, ...(icon && icon.length === 1 ? icon : []), ...(icon && icon[2] ? Object.values(icon[2]) : [])].forEach((t) => { if (t && !texExists(t)) missingTex.add(t); });
    // compact: one texture instead of three / a whole map when they are all the same, trailing zeros dropped
    const one = (a) => (a.length && a.every((x) => x === a[0]) ? a[0] : null);
    if (icon && icon[2]) { const v = one(Object.values(icon[2])); if (v) icon[2] = v; }
    const e = [shape, one(t3) != null ? one(t3) : t3.map((x) => x || 0), flags, tint, icon];
    while (e.length > 1 && !e[e.length - 1]) e.pop();
    out[id] = e;
    if (++done % 400 === 0) console.log('  ' + done + ' / ' + blocks.length * 2);
  }
  // pass 1 fetches every model chain in parallel; pass 2 runs in id order so template numbers are stable between runs
  await pool(blocks, 16, one);
  tplIndex.clear(); tpls.length = 0; guiIndex.clear(); guis.length = 0; missingTex.clear();
  for (const id of blocks) await one(id);
  // English names (blocks and items) that are not just the id in title case
  const ids = new Set(blocks.concat(itemIds));
  ids.forEach((id) => { const n = lang['block.minecraft.' + id] || lang['item.minecraft.' + id]; if (n && n !== titleCase(id)) names[id] = n; });

  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  const db = { v: VERSION, gui: guis, tpl: tpls, b: sorted, names: Object.fromEntries(Object.keys(names).sort().map((k) => [k, names[k]])) };
  const js = '// Generated by tools/build-block-db.js from the Minecraft ' + VERSION + ' assets: every block, its shape, textures and inventory model.\n'
    + 'window.TH = window.TH || {};\nTH.data = TH.data || {};\nTH.data.blockDb = ' + JSON.stringify(db) + ';\n';
  fs.writeFileSync(path.join(root, 'js/data/block-db.js'), js);
  console.log(`js/data/block-db.js: ${Object.keys(out).length} blocks, ${tpls.length} templates, ${guis.length} gui transforms, ${Object.keys(names).length} names, ${Math.round(js.length / 1024)} KB`);
  if (missingTex.size) console.log('textures named but not in the repo (skipped by the icon list):', [...missingTex].slice(0, 30).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
