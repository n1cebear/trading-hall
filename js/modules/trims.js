/**
 * Armor trims — a real 3D previewer.
 *
 * state.trims = {
 *   v: 2,
 *   owned: { [patternId]: true },            // smithing templates the user owns (also feeds the overview stat)
 *   upgradeOwned: false,                      // owns a netherite upgrade template
 *   outfit: { helmet|chestplate|leggings|boots: { armor, pattern, material, dye, show } },
 *     armor    = armor material id (TH.data.armorMaterials), pattern = trim pattern id | null,
 *     material = trim material id | null, dye = '#rrggbb' | null (leather only), show = piece visible
 *   focus: 'chestplate',                      // last edited piece (source of "same material for all")
 *   elytra: false,                            // wear an elytra instead of the chestplate (3D view only)
 *   lastMaterial: 'quartz',                   // trim material used when a pattern is picked on a bare piece (quartz = default)
 *   sync: false,                              // "same for all": every edit goes to all pieces
 *   skin: { kind: 'steve'|'alex'|'name'|'file', name, data (dataURL), slim },
 *   anim: 'idle'|'walk'|'run'|'jump'|'sneak'|'mine'|'fight'|'swim'|'fly',   // viewer animation (never autoplays with reduced motion)
 *   saved: [{ id, name, outfit, skin?, updated }], savedId, saveName, renaming, renameText
 * }
 *
 * Architecture (all in this file, no build step):
 *   - textures : image cache, trim palette swapping on 2D canvases, per-piece armor+trim composites
 *   - skin     : Steve/Alex, username lookup, upload (64x64 or legacy 64x32)
 *   - viewer   : three.js (vendored, lazy ESM import) with a hand-built player model (64x64 UVs)
 *   - ui       : outfit column, viewer, pattern gallery, materials list, saved outfits
 * css/trims.css and js/vendor/three.lite.module.min.js are loaded on demand from here.
 * `?assets=raw` swaps the texture base to raw.githubusercontent.com (dev/testing only).
 */
(function () {
  'use strict';
  const { h, uid, toast, clamp } = TH.util;
  const D = TH.data;
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const rel = (p) => new URL(p, SRC).href;
  const PIECES = D.armorPieces.map((p) => p.id);
  const PIECE_NAME = Object.fromEntries(D.armorPieces.map((p) => [p.id, p.name]));
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const ARMOR = byId(D.armorMaterials), TRIMM = byId(D.trimMaterials), PAT = byId(D.trimPatterns);
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const RAW = /[?&]assets=raw\b/.test(location.search);
  const TEXBASE = RAW ? 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.11/assets/minecraft/textures/' : TH.icon.tex('').slice(0, -4);
    const hex2rgb = (x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)];

  /* ======================================================================
   * Names (Mojang strings via TH.i18n, English data as the fallback)
   * ====================================================================== */
  function lang(key) {
    const L = TH.langData || {};
    const d = L[TH.i18n.lang];
    return (d && d[key]) || (L.en_us && L.en_us[key]) || null;
  }
  const itemName = (id, fb) => lang('item.minecraft.' + id) || lang('block.minecraft.' + id) || fb || id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const armorItemId = (piece, mat) => (mat === 'turtle' ? 'turtle_helmet' : mat + '_' + piece);
  const armorName = (piece, mat) => itemName(armorItemId(piece, mat), ARMOR[mat].name + ' ' + PIECE_NAME[piece]);
  const patName = (id) => TH.i18n.trimPattern(id);
  const matName = (id) => TH.i18n.trimMaterial(id);
  const ingredientName = (m) => itemName(m.itemId, m.item);
  const blockName = (p) => itemName(p.block, p.duplicateWith);
  const templateTitle = () => itemName('netherite_upgrade_smithing_template', 'Smithing Template');

  /** Strip the words every name shares ("… Armor Trim", "… Material") so tiles can show the short part. */
  function shortNames(names) {
    if (names.length < 2) return names.slice();
    let suf = names[0], pre = names[0];
    for (const n of names) {
      while (!n.endsWith(suf) && suf) suf = suf.slice(1);
      while (!n.startsWith(pre) && pre) pre = pre.slice(0, -1);
    }
    const si = suf.search(/[\s-]/);
    suf = si >= 0 ? suf.slice(si) : '';
    const pm = pre.match(/^.*[\s:-]/);
    pre = pm ? pm[0] : '';
    return names.map((n) => {
      const r = n.slice(pre.length, n.length - suf.length).trim();
      return r || n;
    });
  }

  /* ======================================================================
   * State
   * ====================================================================== */
  const DEMO = { armor: 'diamond', pattern: 'sentry', material: 'quartz' };
  const defaults = () => ({
    v: 2, owned: {}, upgradeOwned: false, focus: 'chestplate', lastMaterial: 'quartz', sync: false,
    outfit: Object.fromEntries(PIECES.map((p) => [p, { armor: DEMO.armor, pattern: DEMO.pattern, material: DEMO.material, dye: null, show: true }])),
    skin: { kind: 'steve', name: '', data: null, slim: false },
    saved: [], savedId: null, saveName: '', renaming: null, renameText: '',
  });

  const ANIMS = [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['jump', 'Jump'], ['sneak', 'Sneak'], ['mine', 'Mine'], ['fight', 'Fight'], ['swim', 'Swim'], ['fly', 'Fly']];

  /** Fill every field with a valid value (safe to call on anything: old saves, imports, hand-edited backups). */
  function norm(st) {
    const dft = defaults();
    if (!st.owned || typeof st.owned !== 'object') st.owned = {};
    st.upgradeOwned = !!st.upgradeOwned;
    if (!st.outfit || typeof st.outfit !== 'object') st.outfit = {};
    // groundwork version (no v): every piece was bare netherite -> give the previewer a nicer first look
    const legacy = !st.v && PIECES.every((p) => !(st.outfit[p] && st.outfit[p].pattern));
    PIECES.forEach((p) => {
      let o = st.outfit[p];
      if (!o || typeof o !== 'object' || legacy) o = st.outfit[p] = Object.assign({}, dft.outfit[p]);
      if (!ARMOR[o.armor] || (ARMOR[o.armor].pieces && !ARMOR[o.armor].pieces.includes(p))) o.armor = DEMO.armor;
      if (!PAT[o.pattern]) o.pattern = null;
      if (!TRIMM[o.material]) o.material = o.pattern ? 'quartz' : null;
      if (o.pattern && !o.material) o.material = 'quartz';
      o.dye = typeof o.dye === 'string' && /^#[0-9a-f]{6}$/i.test(o.dye) ? o.dye.toLowerCase() : null;
      o.show = o.show !== false;
    });
    if (!PIECES.includes(st.focus)) st.focus = 'chestplate';
    if (!TRIMM[st.lastMaterial]) st.lastMaterial = 'quartz';
    st.sync = !!st.sync;
    st.elytra = !!st.elytra;
    if (!ANIMS.some((a) => a[0] === st.anim)) st.anim = 'idle';
    const sk = st.skin && typeof st.skin === 'object' ? st.skin : (st.skin = {});
    if (!['steve', 'alex', 'name', 'file'].includes(sk.kind)) sk.kind = 'steve';
    if (typeof sk.name !== 'string') sk.name = '';
    if (typeof sk.data !== 'string') sk.data = null;
    if ((sk.kind === 'file' || sk.kind === 'name') && !sk.data && sk.kind === 'file') sk.kind = 'steve';
    sk.slim = typeof sk.slim === 'boolean' ? sk.slim : sk.kind === 'alex'; // the user may override the arm model for any skin
    if (!Array.isArray(st.saved)) st.saved = [];
    st.saved = st.saved.filter((g) => g && g.outfit && typeof g.name === 'string');
    if (typeof st.saveName !== 'string') st.saveName = '';
    if (st.renaming != null && !st.saved.some((g) => g.id === st.renaming)) st.renaming = null;
    if (typeof st.renameText !== 'string') st.renameText = '';
    if (st.savedId && !st.saved.some((g) => g.id === st.savedId)) st.savedId = null;
    st.v = 2;
    return st;
  }
  const cur = () => norm(TH.store.get().trims);
  /** Mutate state.trims through fn(draft). opts.silent skips the re-render. */
  const upd = (fn, opts) => {
    const live = !!(UI && UI.wrap.isConnected) && !(opts && opts.silent);   // mounted: patch the page in place instead of re-rendering it
    TH.store.update((s) => { fn(norm(s.trims)); }, live ? { silent: true } : opts);
    if (live) refresh();
  };
  const clonePiece = (o) => ({ armor: o.armor, pattern: o.pattern, material: o.material, dye: o.dye, show: o.show });

  /* ======================================================================
   * Textures: image cache, trim palette swap, armor + trim composites
   * ====================================================================== */
  const imgCache = new Map();
  function loadImg(url) {
    let p = imgCache.get(url);
    if (!p) {
      p = new Promise((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => res(i);
        i.onerror = () => { imgCache.delete(url); rej(new Error('Could not load ' + url)); };
        i.src = url;
      });
      imgCache.set(url, p);
    }
    return p;
  }
  const loadTex = (path) => loadImg(TEXBASE + path + '.png');
  const mkCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });
  const memo = (map, key, fn) => { let p = map.get(key); if (!p) { p = fn(); map.set(key, p); p.catch(() => map.delete(key)); } return p; };

  const palCache = new Map();
  const palette = (name) => memo(palCache, name, async () => {
    const img = await loadTex('trims/color_palettes/' + name);
    const c = mkCanvas(img.naturalWidth, 1);
    const x = ctxOf(c);
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, 1).data;
    const out = [];
    for (let i = 0; i < c.width; i++) out.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    return out;
  });

  /** Palette name for a trim material on an armor material: the `_darker` set when the armor is the same metal. */
  function paletteName(armor, mat) {
    const m = TRIMM[mat];
    return m && m.darker && ARMOR[armor] && ARMOR[armor].trimMat === mat ? mat + '_darker' : mat;
  }

  const trimCache = new Map();
  /** Grayscale pattern mask -> coloured trim layer (each grey shade is looked up in trim_palette, replaced by the material colour). */
  const trimLayer = (pattern, legs, pal) => memo(trimCache, [pattern, legs, pal].join('|'), async () => {
    const [mask, key, colors] = await Promise.all([
      loadTex('trims/entity/' + (legs ? 'humanoid_leggings' : 'humanoid') + '/' + pattern), palette('trim_palette'), palette(pal)]);
    const c = mkCanvas(mask.naturalWidth, mask.naturalHeight);
    const x = ctxOf(c);
    x.drawImage(mask, 0, 0);
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    const lookup = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const g = d[i];
      let k = lookup.get(g);
      if (k === undefined) {
        let best = 0, bd = 1e9;
        key.forEach((kc, n) => { const dd = Math.abs(kc[0] - g); if (dd < bd) { bd = dd; best = n; } });
        lookup.set(g, k = best);
      }
      const col = colors[Math.min(k, colors.length - 1)];
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
    }
    x.putImageData(im, 0, 0);
    return c;
  });

  const armorCache = new Map();
  /** Armor layer texture (leather: dyed + the untinted overlay on top). */
  const armorLayer = (armor, legs, dye) => memo(armorCache, [armor, legs, armor === 'leather' ? dye || '' : ''].join('|'), async () => {
    const m = ARMOR[armor], dir = legs ? 'humanoid_leggings' : 'humanoid';
    const base = await loadTex('entity/equipment/' + dir + '/' + m.tex);
    const c = mkCanvas(base.naturalWidth, base.naturalHeight);
    const x = ctxOf(c);
    x.drawImage(base, 0, 0);
    if (m.dyeable) {
      const rgb = hex2rgb(dye || D.leatherDefault);
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * rgb[0] / 255; d[i + 1] = d[i + 1] * rgb[1] / 255; d[i + 2] = d[i + 2] * rgb[2] / 255; }
      x.putImageData(im, 0, 0);
      try { x.drawImage(await loadTex('entity/equipment/' + dir + '/leather_overlay'), 0, 0); } catch (e) { /* overlay is a bonus */ }
    }
    return c;
  });

  const pieceCache = new Map();
  const pieceKey = (piece, o) => [piece, o.armor, o.armor === 'leather' ? o.dye || '' : '', o.pattern || '', o.pattern ? o.material : ''].join('|');
  /** Final 64x32 texture of one armor piece: armor layer with the palette-swapped trim composited on top. */
  const pieceTexture = (piece, o) => memo(pieceCache, pieceKey(piece, o), async () => {
    const legs = piece === 'leggings';
    const base = await armorLayer(o.armor, legs, o.dye);
    const c = mkCanvas(base.width, base.height);
    const x = ctxOf(c);
    x.drawImage(base, 0, 0);
    if (o.pattern && o.material) x.drawImage(await trimLayer(o.pattern, legs, paletteName(o.armor, o.material)), 0, 0);
    return c;
  });

  /** Flat front view of a piece (what the pattern gallery shows), cropped to its pixels. */
  function frontView(tex, piece) {
    const c = mkCanvas(16, 24), x = c.getContext('2d');
    const flip = (sx, sy, w, hh, dx, dy) => { x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(tex, sx, sy, w, hh, 0, 0, w, hh); x.restore(); };
    if (piece === 'helmet') x.drawImage(tex, 8, 8, 8, 8, 0, 0, 8, 8);
    else if (piece === 'chestplate') { x.drawImage(tex, 44, 20, 4, 12, 0, 0, 4, 12); x.drawImage(tex, 20, 20, 8, 12, 4, 0, 8, 12); flip(44, 20, 4, 12, 12, 0); }
    else if (piece === 'leggings') { x.drawImage(tex, 20, 20, 8, 12, 0, 0, 8, 12); x.drawImage(tex, 4, 20, 4, 12, 0, 12, 4, 12); flip(4, 20, 4, 12, 4, 12); }
    else { x.drawImage(tex, 4, 20, 4, 12, 0, 0, 4, 12); flip(4, 20, 4, 12, 4, 0); }
    const d = x.getImageData(0, 0, 16, 24).data;
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
    for (let yy = 0; yy < 24; yy++) for (let xx = 0; xx < 16; xx++) if (d[(yy * 16 + xx) * 4 + 3] > 0) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
    if (x1 < 0) return c;
    const out = mkCanvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }
  const thumbCache = new Map();
  const thumb = (piece, o) => memo(thumbCache, pieceKey(piece, o), async () => frontView(await pieceTexture(piece, o), piece));

  /* ======================================================================
   * Skin: Steve / Alex, username lookup, upload
   * ====================================================================== */
  /** Image -> 64x64 skin canvas (legacy 64x32 skins are converted like the game does) + slim-arms detection. */
  function skinFromImage(img) {
    const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
    if (!(w >= 64 && w % 64 === 0 && (hh === w || hh * 2 === w))) throw new Error('Skin must be 64x64 (or old 64x32) pixels');
    const s = w / 64, legacy = hh * 2 === w;
    const c = mkCanvas(64, 64), x = ctxOf(c);
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, w, hh, 0, 0, 64, legacy ? 32 : 64);
    if (s > 1 && !legacy) x.imageSmoothingEnabled = false;
    if (legacy) {
      // opaque hat layer on old skins is not a hat: clear it (the game's "notch transparency" rule)
      const hat = x.getImageData(32, 0, 32, 16), hd = hat.data;
      let opaque = true;
      for (let i = 3; i < hd.length; i += 4) if (hd[i] < 128) { opaque = false; break; }
      if (opaque) x.clearRect(32, 0, 32, 16);
      const snap = mkCanvas(64, 32);
      snap.getContext('2d').drawImage(c, 0, 0);
      const flipCopy = (sx, sy, ww, hh2, dx, dy) => { x.save(); x.translate(dx + ww, dy); x.scale(-1, 1); x.drawImage(snap, sx, sy, ww, hh2, 0, 0, ww, hh2); x.restore(); };
      const mirrorBox = (u, v, dw, dh, dd, du, dv) => {
        flipCopy(u + dd, v, dw, dd, du + dd, dv);                       // top
        flipCopy(u + dd + dw, v, dw, dd, du + dd + dw, dv);             // bottom
        flipCopy(u + dd + dw, v + dd, dd, dh, du, dv + dd);             // inner side -> outer side
        flipCopy(u + dd, v + dd, dw, dh, du + dd, dv + dd);             // front
        flipCopy(u, v + dd, dd, dh, du + dd + dw, dv + dd);             // outer side -> inner side
        flipCopy(u + dd + dw + dd, v + dd, dw, dh, du + dd + dw + dd, dv + dd); // back
      };
      mirrorBox(0, 16, 4, 12, 4, 16, 48);   // left leg from the right leg
      mirrorBox(40, 16, 4, 12, 4, 32, 48);  // left arm from the right arm
    }
    const d = x.getImageData(0, 0, 64, 64).data;
    // slim arms leave the 4th column of the arm's back face empty: right arm back is x 52-55, left arm back x 44-47
    const empty = (px, y0) => { for (let yy = y0; yy < y0 + 12; yy++) if (d[(yy * 64 + px) * 4 + 3] > 8) return false; return true; };
    return { canvas: c, slim: !legacy && empty(54, 20) && empty(55, 20) && empty(46, 52) && empty(47, 52) };
  }

  /** Promise with a timeout (the underlying request keeps running, we just stop waiting). */
  const withTimeout = (p, ms, what) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(what + ' timed out')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
  const getJson = async (url) => {
    const r = await fetch(url, { mode: 'cors', headers: { Accept: 'application/json' } });
    if (r.status === 404 || r.status === 204) { const e = new Error('not found'); e.notFound = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  /**
   * Username -> skin, through a chain of CORS-friendly services (the first one that works wins):
   *  a) ashcon.app    JSON with the skin PNG as base64 (+ the model flag)
   *  b) playerdb.co   uuid, then crafatar.com/skins/<uuid> (image, CORS *); slim is detected from the pixels
   *  c) mc-heads.net  and  d) minotar.net: plain skin images
   * Images load with crossOrigin=anonymous so the canvas / WebGL stay untainted. Returns { canvas, slim, via }.
   */
  async function fetchNamedSkin(name) {
    const n = encodeURIComponent(name), T = 8000;
    const img = (url) => withTimeout(loadImg(url), T, url);
    const services = [
      ['ashcon', async () => {
        const j = await withTimeout(getJson('https://api.ashcon.app/mojang/v2/user/' + n), T, 'ashcon');
        const sk = j && j.textures && j.textures.skin;
        if (!sk) throw new Error('no skin');
        let im;
        if (sk.data) im = await img('data:image/png;base64,' + sk.data);
        else im = await img(sk.url);
        const r = skinFromImage(im);
        if (j.textures.slim != null) r.slim = !!j.textures.slim;
        return r;
      }],
      ['playerdb', async () => {
        const j = await withTimeout(getJson('https://playerdb.co/api/player/minecraft/' + n), T, 'playerdb');
        const id = j && j.data && j.data.player && (j.data.player.raw_id || (j.data.player.id || '').replace(/-/g, ''));
        if (!id) { const e = new Error('not found'); e.notFound = true; throw e; }
        return skinFromImage(await img('https://crafatar.com/skins/' + id));
      }],
      ['mc-heads', async () => skinFromImage(await img('https://mc-heads.net/skin/' + n))],
      ['minotar', async () => skinFromImage(await img('https://minotar.net/skin/' + n))],
    ];
    const failed = []; let notFound = 0;
    for (const [id, run] of services) {
      try { const r = await run(); r.via = id; return r; }
      catch (e) { failed.push(id); if (e && e.notFound) notFound++; }
    }
    const err = new Error(notFound >= 2 ? 'No Minecraft account named ' + name + '.' : 'Could not load ' + name + '’s skin: ' + failed.join(', ') + ' all failed or are blocked. You can still upload the PNG.');
    err.failed = failed;
    throw err;
  }

  const skinCache = new Map();
  async function resolveSkin(sk) {
    if (sk.kind === 'steve') return { canvas: skinFromImage(await loadTex('entity/player/wide/steve')).canvas, slim: false };
    if (sk.kind === 'alex') return { canvas: skinFromImage(await loadTex('entity/player/slim/alex')).canvas, slim: true };
    const key = sk.kind + '|' + (sk.data || '').length + '|' + sk.name;
    return memo(skinCache, key, async () => {
      if (!sk.data) throw new Error('no skin data');
      return skinFromImage(await loadImg(sk.data));
    });
  }

  /* ======================================================================
   * 3D viewer (three.js): hand-built player model + armor shells
   * ====================================================================== */
  let THREE = null;
  let threeP = null;
  const loadThree = () => threeP || (threeP = import(rel('../vendor/three.lite.module.min.js')).then((m) => { THREE = m; return m; }));

  // Model parts. Boxes are [x, y, z, w, h, d] of the min corner in model units (1 unit = 1 skin pixel, y up, feet at 0,
  // character faces +z), `uv` the skin texture offset, `g` the inflation. Left limbs of armor reuse the right limb UV mirrored.
  const skinParts = (slim) => {
    const aw = slim ? 3 : 4;
    const BONE = { head: 'head', hat: 'head', body: 'torso', jacket: 'torso', rarm: 'rarm', rsleeve: 'rarm', larm: 'larm', lsleeve: 'larm', rleg: 'rleg', rpants: 'rleg', lleg: 'lleg', lpants: 'lleg' };
    const P = (id, box, uv, g, mirror) => ({ id, box, uv, g: g || 0, mirror: !!mirror, bone: BONE[id] });
    const rarm = [slim ? -7 : -8, 12, -2, aw, 12, 4], larm = [4, 12, -2, aw, 12, 4];
    return [
      P('head', [-4, 24, -4, 8, 8, 8], [0, 0]), P('hat', [-4, 24, -4, 8, 8, 8], [32, 0], 0.5),
      P('body', [-4, 12, -2, 8, 12, 4], [16, 16]), P('jacket', [-4, 12, -2, 8, 12, 4], [16, 32], 0.25),
      P('rarm', rarm, [40, 16]), P('rsleeve', rarm, [40, 32], 0.25),
      P('larm', larm, [32, 48]), P('lsleeve', larm, [48, 48], 0.25),
      P('rleg', [-3.9, 0, -2, 4, 12, 4], [0, 16]), P('rpants', [-3.9, 0, -2, 4, 12, 4], [0, 32], 0.25),
      P('lleg', [-0.1, 0, -2, 4, 12, 4], [16, 48]), P('lpants', [-0.1, 0, -2, 4, 12, 4], [0, 48], 0.25),
    ];
  };
  const armorParts = {
    helmet: [{ bone: 'head', box: [-4, 24, -4, 8, 8, 8], uv: [0, 0], g: 1 }],
    chestplate: [{ bone: 'torso', box: [-4, 12, -2, 8, 12, 4], uv: [16, 16], g: 1 }, { bone: 'rarm', box: [-8, 12, -2, 4, 12, 4], uv: [40, 16], g: 1 }, { bone: 'larm', box: [4, 12, -2, 4, 12, 4], uv: [40, 16], g: 1, mirror: true }],
    leggings: [{ bone: 'torso', box: [-4, 12, -2, 8, 12, 4], uv: [16, 16], g: 0.5 }, { bone: 'rleg', box: [-3.9, 0, -2, 4, 12, 4], uv: [0, 16], g: 0.5 }, { bone: 'lleg', box: [-0.1, 0, -2, 4, 12, 4], uv: [0, 16], g: 0.5, mirror: true }],
    boots: [{ bone: 'rleg', box: [-3.9, 0, -2, 4, 12, 4], uv: [0, 16], g: 1 }, { bone: 'lleg', box: [-0.1, 0, -2, 4, 12, 4], uv: [0, 16], g: 1, mirror: true }],
  };

  /* Skeleton = vanilla HumanoidModel: six independent parts (nothing is parented; sneak moves them explicitly), pivots in
     three.js model units (y up, character faces +z, feet at 0). The pose maths below is written in vanilla's own
     coordinates (y down, front = -z, xRot positive = swing back) and converted in applyPose():
     three.x = mc.x, three.y = -mc.y, three.z = -mc.z for rotations (and positions), euler order ZYX like ModelPart. */
  const PIV = { torso: [0, 24, 0], head: [0, 24, 0], rarm: [-5, 22, 0], larm: [5, 22, 0], rleg: [-1.9, 12, 0], lleg: [1.9, 12, 0] };
  const WING_PIV = [5, 24, -2];   // ElytraModel pivot (+0.125 block layer offset towards the back)
  const BONES = ['head', 'torso', 'rarm', 'larm', 'rleg', 'lleg'];

  /* ---- pose maths (20 ticks/s timebase, evaluated continuously = interpolated) ----
     A pose is a Float64Array: 6 parts x [rotX, rotY, rotZ, offX, offY, offZ] (vanilla coordinates), then rootX / rootY. */
  const sn = Math.sin, cs = Math.cos, PI = Math.PI;
  const ease = (u) => u * u * (3 - 2 * u);
  const ROOT_X = 36, ROOT_Y = 37, POSE_LEN = 38;
  const newPose = () => new Float64Array(POSE_LEN);
  /* amt = limbSwingAmount target; swing = attack animation (period/dur in ticks); look = head pitch (rad, + = down) */
  const ANIM_CFG = {
    idle: { amt: 0 },
    walk: { amt: 0.6 },
    run: { amt: 1 },
    jump: { amt: 0.6, jump: true },
    sneak: { amt: 0.3, crouch: true },
    mine: { amt: 0, swing: { period: 6, dur: 6 }, look: 0.45 },
    fight: { amt: 0.3, swing: { period: 12, dur: 6 }, look: 0.08 },
    swim: { amt: 0.8, swim: true },
    fly: { amt: 0.6, fly: true },
  };
  const JUMP_Y = (() => { const ys = [0]; let y = 0, v = 0.42; for (let i = 0; i < 40; i++) { y += v; v = (v - 0.08) * 0.98; if (y <= 0) break; ys.push(y); } ys.push(0); return ys; })();   // blocks per tick
  const JUMP_CYCLE = JUMP_Y.length + 3;
  const jumpHeight = (tk) => { const t = tk % JUMP_CYCLE; if (t >= JUMP_Y.length - 1) return 0; const i = Math.floor(t), f = t - i; return JUMP_Y[i] + (JUMP_Y[i + 1] - JUMP_Y[i]) * f; };

  /** HumanoidModel.setupAnim for the animation `cfg`. age = ageInTicks, ls = limbSwing, amt = limbSwingAmount, at = ticks since the animation started. */
  function computePose(P, cfg, age, ls, amt, at) {
    P.fill(0);
    const head = P.subarray(0, 6), body = P.subarray(6, 12), ra = P.subarray(12, 18), la = P.subarray(18, 24), rl = P.subarray(24, 30), ll = P.subarray(30, 36);
    const fly = !!cfg.fly, swim = !!cfg.swim, k = fly ? 1 / 500 : 1;   // fall flying divides the limb swing by (speed^2/0.2)^3
    head[0] = swim || fly ? -PI / 4 : (cfg.look || 0);
    ra[0] = cs(ls * 0.6662 + PI) * 2 * amt * 0.5 * k; la[0] = cs(ls * 0.6662) * 2 * amt * 0.5 * k;
    rl[0] = cs(ls * 0.6662) * 1.4 * amt * k; ll[0] = cs(ls * 0.6662 + PI) * 1.4 * amt * k;
    rl[1] = 0.005; ll[1] = -0.005; rl[2] = 0.005; ll[2] = -0.005;
    if (cfg.swing) {   // setupAttackAnimation (right arm)
      const ph = at % cfg.swing.period, t = ph < cfg.swing.dur ? ph / cfg.swing.dur : 0;
      if (t > 0) {
        const by = sn(Math.sqrt(t) * 2 * PI) * 0.2;
        body[1] = by;
        ra[5] = sn(by) * 5; ra[3] = 5 - cs(by) * 5; la[5] = -sn(by) * 5; la[3] = cs(by) * 5 - 5;
        ra[1] += by; la[1] += by; la[0] += by;
        let f = 1 - t; f *= f; f *= f; f = 1 - f;
        const f1 = sn(f * PI), f2 = sn(t * PI) * -(head[0] - 0.7) * 0.75;
        ra[0] -= f1 * 1.2 + f2; ra[1] += by * 2; ra[2] += sn(t * PI) * -0.4;
      }
    }
    if (cfg.crouch) {
      body[0] = 0.5; ra[0] += 0.4; la[0] += 0.4;
      rl[5] = ll[5] = 3.9; rl[4] = ll[4] = 0.2; head[4] = 4.2; body[4] = 3.2; ra[4] = la[4] = 3.2;   // vanilla 12.2 / 4.2 / 3.2 / 5.2 and legs z = 4
      P[ROOT_Y] = -2;                                                                                  // PlayerRenderer render offset (-0.125 block)
    }
    // AnimationUtils.bobModelPart: idle arm sway
    ra[2] += cs(age * 0.09) * 0.05 + 0.05; ra[0] += sn(age * 0.067) * 0.05;
    la[2] -= cs(age * 0.09) * 0.05 + 0.05; la[0] -= sn(age * 0.067) * 0.05;
    if (swim) {        // swimAmount = 1: the crawl stroke (26 limbSwing units per cycle)
      const f5 = ((ls % 26) + 26) % 26;
      if (f5 < 14) { const q = (65 * f5 - f5 * f5) / 714; ra[0] = la[0] = 0; ra[2] = PI - 1.8707964 * q; la[2] = PI + 1.8707964 * q; }
      else if (f5 < 22) { const t = (f5 - 14) / 8; ra[0] = la[0] = PI / 2 * t; ra[2] = 1.2707963 + 1.8707964 * t; la[2] = 5.012389 - 1.8707964 * t; }
      else { const t = (f5 - 22) / 4; ra[0] = la[0] = PI / 2 - PI / 2 * t; ra[2] = la[2] = PI; }
      ra[1] = la[1] = PI;
      rl[0] = 0.3 * cs(ls * 0.33333334); ll[0] = 0.3 * cs(ls * 0.33333334 + PI);
      P[ROOT_X] = PI / 2; P[ROOT_Y] = 5;
    }
    if (fly) { P[ROOT_X] = PI / 2 + sn(age * 0.045) * 0.1; P[ROOT_Y] = 6 + sn(age * 0.06) * 0.6; }
    if (cfg.jump) P[ROOT_Y] = jumpHeight(at) * 16;
    return P;
  }
  /** ElytraModel.setupAnim target [rotX, rotY, rotZ(left wing, vanilla sign), offY]. */
  const wingTarget = (cfg) => cfg.fly ? [0.34906584, 0, -PI / 2, 0] : cfg.crouch ? [0.6981317, 0.08726646, -0.7853982, 3] : [0.2617994, 0, -0.2617994, 0];
  const CAMS = { jump: { k: 1.2, y: 24 } };

  /** One cuboid with Minecraft box UV mapping (64x`th` texture), explicit normals, optional mirrored UVs. */
  function boxGeometry(p, tw, th) {
    const [bx, by, bz, w, hh, d] = p.box, g = p.g || 0, [u, v] = p.uv;
    const x0 = bx - g, x1 = bx + w + g, y0 = by - g, y1 = by + hh + g, z0 = bz - g, z1 = bz + d + g;
    const R = {
      front: [u + d, v + d, w, hh], back: [u + 2 * d + w, v + d, w, hh],
      right: [u, v + d, d, hh], left: [u + d + w, v + d, d, hh],
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    };
    // corners seen from outside: bottom-left, bottom-right, top-right, top-left
    const faces = [
      { n: [0, 0, 1], c: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], r: R.front },
      { n: [0, 0, -1], c: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], r: R.back },
      { n: [-1, 0, 0], c: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], r: p.mirror ? R.left : R.right },
      { n: [1, 0, 0], c: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], r: p.mirror ? R.right : R.left },
      { n: [0, 1, 0], c: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], r: R.top },
      { n: [0, -1, 0], c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], r: R.bottom },
    ];
    const pos = [], nor = [], uvs = [], idx = [];
    faces.forEach((f, i) => {
      let [rx, ry, rw, rh] = f.r;
      let ua = rx / tw, ub = (rx + rw) / tw;
      if (p.mirror) { const t = ua; ua = ub; ub = t; }
      const va = 1 - (ry + rh) / th, vb = 1 - ry / th;
      const uv = [[ua, va], [ub, va], [ub, vb], [ua, vb]];
      f.c.forEach((c, k) => { pos.push(c[0], c[1], c[2]); nor.push(f.n[0], f.n[1], f.n[2]); uvs.push(uv[k][0], uv[k][1]); });
      const o = i * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    return geo;
  }

  const V = (function () {
    const el = h('div.tr-canvas', { tabindex: 0, role: 'img', 'aria-label': '3D preview of the armor outfit. Drag to rotate, scroll to zoom, double-click to reset.' });
    const S = {
      el, ready: false, error: null, renderer: null, scene: null, camera: null, player: null, slim: null,
      pieces: {}, bones: null, rig: null, rigRoot: null, skinMeshes: null, pose: newPose(), from: newPose(), tgt: newPose(), blend: 1, anim: 'idle', animT: 0, age: 0, limb: 0, amt: 0, wing: wingTarget({}), wings: null, elytraOn: false, camK: 1, camY: 16.5, shadow: null, target: null, key: null,
      yaw: 0.55, pitch: 0.12, zoom: 1, vel: 0, goal: null, auto: false, interacted: false,
      dirty: true, raf: 0, last: 0, inView: true, w: 0, h: 0, sig: {}, skinSig: '',
    };
    const HOME = { yaw: 0.55, pitch: 0.12, zoom: 1 };
    const ZMIN = 0.55, ZMAX = 2.4, PMAX = 0.75;
    let initP = null;

    const texOf = new WeakMap();   // one GPU texture per composited canvas: re-selecting a look re-uploads nothing
    const canvasTex = (c) => {
      let t = texOf.get(c);
      if (t) return t;
      t = new THREE.CanvasTexture(c);
      texOf.set(c, t);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const mat = () => new THREE.MeshLambertMaterial({ transparent: false, alphaTest: 0.5, side: THREE.FrontSide });

    /** A cuboid mesh parented to its bone, its geometry re-centred on the bone's pivot. */
    function bonedMesh(part, tw, th, material) {
      const geo = boxGeometry(part, tw, th), pv = PIV[part.bone];
      geo.translate(-pv[0], -pv[1], -pv[2]);
      const mesh = new THREE.Mesh(geo, material);
      S.bones[part.bone].add(mesh);
      return mesh;
    }
    function applyPose() {
      if (!S.bones) return;
      const q = S.pose, b = S.bones;
      S.rigRoot.position.y = 12 + q[ROOT_Y]; S.rigRoot.rotation.x = q[ROOT_X];
      BONES.forEach((id, i) => {
        const o = i * 6, g = b[id], pv = PIV[id];
        g.rotation.set(q[o], -q[o + 1], -q[o + 2]);
        g.position.set(pv[0] + q[o + 3], pv[1] - q[o + 4], pv[2] - q[o + 5]);
      });
      const w = S.wing;   // ElytraModel: right wing mirrors the left
      S.wings.l.rotation.set(w[0], -w[1], -w[2]); S.wings.r.rotation.set(w[0], w[1], w[2]);
      S.wings.l.position.y = S.wings.r.position.y = WING_PIV[1] - w[3];
      const lift = Math.max(0, q[ROOT_Y]), sc = Math.max(0.55, 1 - lift * 0.04) * (q[ROOT_X] > 0.5 ? 0.9 : 1);
      S.shadow.scale.set(sc, sc, sc); S.shadow.material.opacity = 1 - Math.min(0.5, lift * 0.05);
    }
    /** Advance the 20 ticks/s simulation by dt seconds (continuous, so frames interpolate between ticks). */
    function stepAnim(dt) {
      const slow = reduced(), cfg = ANIM_CFG[S.anim], tk = dt * 20 * (slow ? 0.3 : 1);
      if (!(slow && S.anim === 'idle')) S.age += tk;
      S.animT += tk;
      S.amt += (cfg.amt - S.amt) * (1 - Math.pow(0.6, tk));   // WalkAnimationState: speed += (target - speed) * 0.4 per tick
      S.limb += S.amt * tk;                                      // position += speed per tick
      S.blend = slow ? 1 : Math.min(1, S.blend + dt / 0.3);
      const e = S.blend < 1 ? ease(S.blend) : 1;
      computePose(S.tgt, cfg, S.age, S.limb, S.amt, S.animT);
      for (let i = 0; i < POSE_LEN; i++) S.pose[i] = S.from[i] + (S.tgt[i] - S.from[i]) * e;
      const wt = wingTarget(cfg), wk = slow ? 1 : 1 - Math.pow(0.9, tk);   // wings ease 10% per tick like the vanilla model
      for (let i = 0; i < 4; i++) S.wing[i] += (wt[i] - S.wing[i]) * wk;
      const cam = CAMS[S.anim] || { k: 1, y: 16.5 }, ck = slow ? 1 : 1 - Math.pow(0.85, tk);
      S.camK += (cam.k - S.camK) * ck; S.camY += (cam.y - S.camY) * ck;
      applyPose();
    }
    const settled = () => S.blend >= 1 && Math.abs(S.camK - (CAMS[S.anim] || { k: 1 }).k) < 0.002;

    function build() {
      const canvas = document.createElement('canvas');
      canvas.className = 'tr-gl';
      S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
      S.renderer.setClearColor(0x000000, 0);
      S.renderer.outputColorSpace = THREE.SRGBColorSpace;
      S.scene = new THREE.Scene();
      S.camera = new THREE.PerspectiveCamera(28, 1, 10, 400);
      S.scene.add(S.camera);
      S.target = new THREE.Vector3(0, 16.5, 0);
      S.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bccb, 1.55));
      S.key = new THREE.DirectionalLight(0xffffff, 1.5);
      S.scene.add(S.key);
      S.keyTarget = new THREE.Vector3(0, 16, 0);
      // soft contact shadow
      const sc = mkCanvas(64, 64), sx = sc.getContext('2d');
      const grd = sx.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      sx.fillStyle = grd; sx.fillRect(0, 0, 64, 64);
      const st = new THREE.CanvasTexture(sc);
      S.shadow = new THREE.Mesh(new THREE.CircleGeometry(15, 32), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
      S.shadow.rotation.x = -Math.PI / 2; S.shadow.position.y = 0.05;
      S.scene.add(S.shadow);
      S.player = new THREE.Group();
      S.scene.add(S.player);
      S.rigRoot = new THREE.Group(); S.rigRoot.position.set(0, 12, 0);   // whole-body pivot (hips): swim / fly tilt, jump height
      S.rig = new THREE.Group(); S.rig.position.set(0, -12, 0);
      S.rigRoot.add(S.rig); S.player.add(S.rigRoot);
      S.bones = {};
      BONES.forEach((id) => {
        const g = new THREE.Group();
        g.rotation.order = 'ZYX'; g.position.set(PIV[id][0], PIV[id][1], PIV[id][2]);
        S.rig.add(g); S.bones[id] = g;
      });
      // elytra: two 10x20x2 wings (inflated 1) on a 64x32 texture, hidden until switched on
      S.wingMat = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
      S.wings = {};
      [['l', 1], ['r', -1]].forEach(([id, sg]) => {
        const g = new THREE.Group();
        g.rotation.order = 'ZYX'; g.position.set(WING_PIV[0] * sg, WING_PIV[1], WING_PIV[2]);
        const geo = boxGeometry({ box: sg > 0 ? [-10, -20, -2, 10, 20, 2] : [0, -20, -2, 10, 20, 2], uv: [22, 0], g: 1, mirror: sg < 0 }, 64, 32);
        g.add(new THREE.Mesh(geo, S.wingMat));
        g.visible = false; S.rig.add(g); S.wings[id] = g;
      });
      PIECES.forEach((p) => {
        const m = mat();
        const meshes = armorParts[p].map((part) => { const mesh = bonedMesh(part, 64, 32, m); mesh.visible = false; return mesh; });
        S.pieces[p] = { meshes, mat: m };
      });
      el.prepend(canvas);
      S.canvas = canvas;
    }

    function fit() {
      const t = Math.tan((S.camera.fov * Math.PI) / 360);
      const aspect = Math.max(0.2, S.w / Math.max(1, S.h));
      return Math.max(26 / t, 16 / (t * aspect));
    }
    function place() {
      if (!S.camera) return;
      const d = fit() * S.camK / S.zoom, cp = Math.cos(S.pitch);
      S.target.y = S.camY;
      S.camera.position.set(S.target.x + d * Math.sin(S.yaw) * cp, S.target.y + d * Math.sin(S.pitch), S.target.z + d * Math.cos(S.yaw) * cp);
      S.camera.lookAt(S.target);
      S.camera.updateMatrixWorld();
      S.key.position.copy(S.camera.localToWorld(new THREE.Vector3(-40, 70, 30)));
      S.key.target.position.copy(S.keyTarget);
      S.key.target.updateMatrixWorld();
    }
    function resize() {
      if (!S.renderer) return;
      const w = el.clientWidth, hh = el.clientHeight;
      if (!w || !hh) return;
      if (w === S.w && hh === S.h) return;
      S.w = w; S.h = hh;
      S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      S.renderer.setSize(w, hh, false);
      S.camera.aspect = w / hh;
      S.camera.updateProjectionMatrix();
      S.dirty = true;
    }
    const visible = () => el.isConnected && !document.hidden && S.inView && S.ready;

    function frame(now) {
      S.raf = 0;
      if (!visible()) return;
      const dt = Math.min(0.05, (now - (S.last || now)) / 1000);
      S.last = now;
      let moving = false;
      if (S.goal) {
        const k = 1 - Math.pow(0.0005, dt);
        S.yaw += (S.goal.yaw - S.yaw) * k; S.pitch += (S.goal.pitch - S.pitch) * k; S.zoom += (S.goal.zoom - S.zoom) * k;
        if (Math.abs(S.goal.yaw - S.yaw) + Math.abs(S.goal.pitch - S.pitch) + Math.abs(S.goal.zoom - S.zoom) < 0.002) { S.yaw = S.goal.yaw; S.pitch = S.goal.pitch; S.zoom = S.goal.zoom; S.goal = null; }
        moving = true;
      }
      if (!dragging && Math.abs(S.vel) > 0.01) { S.yaw += S.vel * dt; S.vel *= Math.exp(-3.2 * dt); moving = true; }
      if (S.auto && !dragging && !S.goal) { S.yaw += 0.45 * dt; moving = true; }
      if (!(reduced() && S.anim === 'idle' && settled())) { stepAnim(dt); moving = true; }
      if (moving || S.dirty) { resize(); place(); S.renderer.render(S.scene, S.camera); S.dirty = false; }
      if (moving || dragging) S.raf = requestAnimationFrame(frame); // keep S.last: wake() would zero it and freeze dt
    }
    function wake() { if (!S.raf && visible()) { S.last = 0; S.raf = requestAnimationFrame(frame); } }
    S.wake = () => { S.dirty = true; wake(); };

    /* ---- input ---- */
    let dragging = false;
    const ptrs = new Map();
    let pinch0 = 0, zoom0 = 1, lastT = 0;
    const stopAuto = () => { if (S.auto) { S.auto = false; S.onAuto && S.onAuto(false); } S.interacted = true; };
    const pdist = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stopAuto(); S.goal = null; S.vel = 0; dragging = true; lastT = e.timeStamp;
      if (ptrs.size === 2) { pinch0 = pdist(); zoom0 = S.zoom; }
      el.classList.add('grab');
    });
    el.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) { S.zoom = clamp(zoom0 * pdist() / pinch0, ZMIN, ZMAX); }
      else {
        S.yaw -= dx * 0.0105; S.pitch = clamp(S.pitch + dy * 0.007, -PMAX, PMAX);
        const dt = Math.max(0.004, (e.timeStamp - lastT) / 1000);
        S.vel = clamp(S.vel * 0.5 + (-dx * 0.0105 / dt) * 0.5, -9, 9);
      }
      lastT = e.timeStamp;
      S.dirty = true; wake();
    });
    const up = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      if (ptrs.size === 1) { const r = [...ptrs.values()][0]; r.x = r.x; }
      if (!ptrs.size) { dragging = false; el.classList.remove('grab'); if (e.timeStamp - lastT > 90 || reduced()) S.vel = 0; wake(); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      stopAuto();
      S.goal = null;
      S.zoom = clamp(S.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0013)), ZMIN, ZMAX);
      S.dirty = true; wake();
    }, { passive: false });
    /** Switch the animation (blends from the current pose). opts.silent: do not persist / notify (restoring state). */
    S.setAnim = (id, opts) => {
      if (!ANIM_CFG[id]) id = 'idle';
      if (id === S.anim && !(opts && opts.force)) return;
      S.from.set(S.pose); S.blend = reduced() ? 1 : 0; S.animT = 0; S.anim = id;
      S.onAnim && S.onAnim(id);
      if (!(opts && opts.silent) && S.persist) S.persist(id);
      S.dirty = true; wake();
    };
    S.reset = () => {
      stopAuto(); S.vel = 0; S.setAnim('idle');
      if (reduced()) { Object.assign(S, HOME); S.goal = null; } else S.goal = Object.assign({}, HOME, { yaw: Math.round((S.yaw - HOME.yaw) / (Math.PI * 2)) * Math.PI * 2 + HOME.yaw });
      S.dirty = true; wake();
    };
    el.addEventListener('dblclick', S.reset);
    el.addEventListener('keydown', (e) => {
      const k = e.key;
      const map = { ArrowLeft: () => { S.yaw -= 0.16; }, ArrowRight: () => { S.yaw += 0.16; }, ArrowUp: () => { S.pitch = clamp(S.pitch - 0.08, -PMAX, PMAX); }, ArrowDown: () => { S.pitch = clamp(S.pitch + 0.08, -PMAX, PMAX); },
        '+': () => { S.zoom = clamp(S.zoom * 1.12, ZMIN, ZMAX); }, '=': () => { S.zoom = clamp(S.zoom * 1.12, ZMIN, ZMAX); }, '-': () => { S.zoom = clamp(S.zoom / 1.12, ZMIN, ZMAX); } };
      if (map[k]) { e.preventDefault(); stopAuto(); S.goal = null; map[k](); S.dirty = true; wake(); }
      else if (k === '0' || k === 'Home') { e.preventDefault(); S.reset(); }
    });

    S.setAuto = (on) => { S.auto = !!on; if (on) { S.goal = null; S.vel = 0; } S.onAuto && S.onAuto(S.auto); wake(); };

    /* ---- content ---- */
    S.setSkin = (canvas, slim) => {
      if (!S.ready) return;
      if (S.slim !== slim || !S.skinMeshes) {
        if (S.skinMeshes) S.skinMeshes.forEach((m) => { if (m.parent) m.parent.remove(m); m.geometry.dispose(); });
        const m = S.skinMat || (S.skinMat = mat());
        S.skinMeshes = skinParts(slim).map((p) => { const mesh = bonedMesh(p, 64, 64, m); mesh.renderOrder = p.g ? 1 : 0; return mesh; });
        S.slim = slim;
      }
      if (S.skinMat.map) S.skinMat.map.dispose();
      S.skinMat.map = canvasTex(canvas);
      S.skinMat.needsUpdate = true;
      S.dirty = true; wake();
    };
    S.setPiece = (piece, canvas) => {
      if (!S.ready) return;
      S.appliedAt = performance.now();
      const p = S.pieces[piece];
      if (!canvas) { p.meshes.forEach((m) => { m.visible = false; }); }
      else {
        p.mat.map = canvasTex(canvas);
        p.mat.needsUpdate = true;
        p.meshes.forEach((m) => { m.visible = true; });
      }
      S.dirty = true; wake();
    };
    S.setElytra = (on, canvas) => {
      if (!S.ready) return;
      if (canvas) { S.wingMat.map = canvasTex(canvas); S.wingMat.needsUpdate = true; }
      S.elytraOn = !!on && !!S.wingMat.map;
      S.wings.l.visible = S.wings.r.visible = S.elytraOn;
      S.onElytra && S.onElytra(!!on);
      S.dirty = true; wake();
    };
    S.shot = () => new Promise((res) => {
      if (!S.ready) return res(null);
      resize(); place(); S.renderer.render(S.scene, S.camera);
      S.canvas.toBlob((b) => res(b), 'image/png');
    });

    S.init = () => initP || (initP = loadThree().then(() => {
      try {
        build();
      } catch (e) { S.error = 'WebGL is not available in this browser.'; throw e; }
      S.ready = true;
      new ResizeObserver(() => { S.dirty = true; wake(); }).observe(el);
      new IntersectionObserver((en) => { S.inView = en[en.length - 1].isIntersecting; if (S.inView) { S.dirty = true; wake(); } }).observe(el);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) S.wake(); });
      S.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.ready = false; });
      S.canvas.addEventListener('webglcontextrestored', () => { S.ready = true; S.sig = {}; S.skinSig = ''; S.dirty = true; S.onRestore && S.onRestore(); });
      return S;
    }).catch((e) => { S.error = S.error || 'Could not start the 3D viewer: ' + (e && e.message ? e.message : e); throw e; }));
    return S;
  })();


  /** Push the outfit + skin from state into the 3D scene (only what changed). */
  function syncViewer(st) {
    if (V.onElytra) V.onElytra(!!st.elytra);
    V.init().then(() => {
      const skSig = JSON.stringify([st.skin.kind, st.skin.slim, (st.skin.data || '').length, st.skin.name]);
      if (skSig !== V.skinSig) {
        V.skinSig = skSig;
        resolveSkin(st.skin).then((r) => { if (V.skinSig === skSig) V.setSkin(r.canvas, st.skin.slim); })
          .catch(() => { V.skinSig = ''; toast('Could not load that skin — showing Steve'); upd((s) => { s.skin = { kind: 'steve', name: '', data: null, slim: false }; }); });
      }
      PIECES.forEach((p) => {
        const o = st.outfit[p], vis = o.show && !(p === 'chestplate' && st.elytra);   // an elytra replaces the chestplate (the chosen look is kept)
        const sig = vis ? pieceKey(p, o) : 'hidden';
        if (V.sig[p] === sig) return;
        V.sig[p] = sig;
        if (!vis) { V.setPiece(p, null); return; }
        pieceTexture(p, o).then((c) => { if (V.sig[p] === sig) V.setPiece(p, c); })
          .catch(() => { toast('Could not load the ' + armorName(p, o.armor) + ' texture'); });
      });
      const ey = !!st.elytra, esig = 'e' + ey;
      if (V.sig.elytra !== esig) {
        V.sig.elytra = esig;
        if (!ey) V.setElytra(false);
        else elytraCanvas().then((c) => { if (V.sig.elytra === esig) V.setElytra(true, c); }).catch(() => { toast('Could not load the elytra texture'); });
      }
    }).catch(() => { /* error shown in the viewer panel */ });
  }
  const elytraCache = new Map();
  const elytraCanvas = () => memo(elytraCache, 'e', async () => { const img = await loadTex('entity/equipment/wings/elytra'); const c = mkCanvas(64, 32); c.getContext('2d').drawImage(img, 0, 0); return c; });
  V.onRestore = () => syncViewer(cur());

  /* ======================================================================
   * Materials list
   * ====================================================================== */
  /**
   * What the (visible, trimmed) outfit still needs. The armor itself (and the netherite upgrade) is deliberately not
   * listed: the user already owns the enchanted armor. Only: smithing templates (one per trimmed piece; at most one
   * original per pattern, every further piece needs a copy = 1 template + 7 diamonds + the pattern's base block),
   * the duplication cost, and the trim materials (one ingot / gem per trimmed piece).
   */
  function computeMaterials(st) {
    const pcs = PIECES.filter((p) => st.outfit[p].show);
    const trimmed = pcs.filter((p) => st.outfit[p].pattern && st.outfit[p].material);
    const byPat = {};
    trimmed.forEach((p) => { (byPat[st.outfit[p].pattern] = byPat[st.outfit[p].pattern] || []).push(p); });
    const templates = D.trimPatterns.filter((p) => byPat[p.id]).map((p) => ({ id: p.id, qty: byPat[p.id].length, owned: !!st.owned[p.id], data: p, icon: TH.icon.trimKey(p.id), title: patName(p.id) }));
    const ingredients = new Map();
    trimmed.forEach((p) => {
      const m = TRIMM[st.outfit[p].material];
      const r = ingredients.get(m.id) || { id: m.id, qty: 0, icon: TH.icon.trimMaterialKey(m.item), name: matName(m.id), item: ingredientName(m) };
      r.qty++; ingredients.set(m.id, r);
    });
    const dupes = new Map();
    let diamonds = 0, copies = 0, finds = 0;
    templates.forEach((t) => {
      t.copies = Math.max(0, t.qty - 1);
      t.find = t.owned ? 0 : 1;
      copies += t.copies; finds += t.find;
      diamonds += t.copies * D.templateCopyDiamonds;
      if (t.copies) { const r = dupes.get(t.data.block) || { icon: t.data.blockIcon, name: blockName(t.data), qty: 0 }; r.qty += t.copies; dupes.set(t.data.block, r); }
    });
    return { pcs, templates, ingredients: [...ingredients.values()], dupes: [...dupes.values()], diamonds, copies, finds, trimmed: trimmed.length };
  }

  function materialsText(st, M) {
    const L = ['Armor trim materials'];
    if (M.templates.length) {
      L.push('', 'Smithing templates');
      M.templates.forEach((t) => L.push('- ' + t.qty + 'x ' + t.title + (t.owned ? ' (have the original' : ' (find the original in ' + t.data.source) + (t.copies ? ', copy it ' + t.copies + 'x' : '') + ')'));
    }
    if (M.copies) {
      L.push('', 'Duplicating (1 template + ' + D.templateCopyDiamonds + ' diamonds + base block = 1 extra copy)');
      L.push('- ' + M.diamonds + 'x ' + itemName('diamond', 'Diamond'));
      M.dupes.forEach((r) => L.push('- ' + r.qty + 'x ' + r.name));
    }
    if (M.ingredients.length) { L.push('', 'Trim materials'); M.ingredients.forEach((r) => L.push('- ' + r.qty + 'x ' + r.item)); }
    return L.join('\n');
  }

  /* ======================================================================
   * Minecraft-style tooltip
   * ====================================================================== */
  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = h('div.th-tooltip.tr-tip', { role: 'tooltip', 'aria-hidden': 'true' }); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }
  /** lines: first = title, the rest = muted lines (strings). */
  function showTip(lines, x, y) {
    const t = tip();
    t.replaceChildren(...lines.map((l, i) => i === 0 ? h('b.th-tooltip-title', l) : h('span.th-tooltip-sub', l)));
    t.classList.add('show');
    const r = t.getBoundingClientRect();
    t.style.left = clamp(x + 14, 6, window.innerWidth - r.width - 6) + 'px';
    t.style.top = clamp(y + 16, 6, window.innerHeight - r.height - 6) + 'px';
  }
  /** Attach a tooltip (lines built lazily) to hover and keyboard focus. */
  function withTip(el, lines) {
    const get = typeof lines === 'function' ? lines : () => lines;
    el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') showTip(get(), e.clientX, e.clientY); });
    el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') showTip(get(), e.clientX, e.clientY); });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('pointerdown', hideTip);
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) { const r = el.getBoundingClientRect(); showTip(get(), r.left, r.bottom - 14); } });
    el.addEventListener('blur', hideTip);
    return el;
  }

  const pieceTipLines = (st, p) => {
    const o = st.outfit[p];
    const L = [armorName(p, o.armor)];
    L.push(o.pattern && o.material ? patName(o.pattern) + ' · ' + matName(o.material) : 'No trim');
    if (!o.show) L.push('Hidden in the preview');
    return L;
  };
  const rarityLabel = (r) => ({ common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' })[r] || '';
  const patternTipLines = (pat) => [patName(pat.id), templateTitle() + (pat.rarity ? ' · ' + rarityLabel(pat.rarity) : ''), 'Found in: ' + pat.source,
    'Duplicate: ' + D.templateCopyDiamonds + ' ' + itemName('diamond', 'Diamond') + ' + ' + blockName(pat)];

  /* ======================================================================
   * UI
   * ====================================================================== */
  let cssP = null, cssReady = false;
  function ensureCss() {
    if (!cssP) {
      cssP = new Promise((res) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = rel('../../css/trims.css');
        l.onload = () => { cssReady = true; res(true); };
        l.onerror = () => { cssReady = true; res(false); };
        document.head.appendChild(l);
      });
    }
    return cssP;
  }

  /* The page is built once (mount) and then patched in place (patch): no re-render, no entrance animation, the
     viewer canvas never leaves its node. `upd` applies the change silently and calls refresh() instead of the app render. */
  let UI = null;
  function refresh() {
    if (!UI) return;
    patch(cur());
    if (TH.app.refreshBadges) TH.app.refreshBadges();
  }

  const icoPiece = (piece, mat, size) => TH.icon.item(piece, mat, { size: size || 32 });
  /** Native title= becomes the app tooltip (one coherent style). */
  const tipTitles = (root) => root.querySelectorAll('[title]').forEach((el) => { const t = el.getAttribute('title'); el.removeAttribute('title'); if (t) withTip(el, [t]); });
  const sel = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); };

  /** A row of icon picker tiles (trim material). Selection is patched through .sync(). */
  function tileRow(items, onPick, cls) {
    const btns = new Map();
    const el = h('div.tr-tiles' + (cls ? '.' + cls : ''), { role: 'radiogroup', 'aria-label': 'Trim material' }, items.map((it) => {
      const b = h('button.tr-tile', {
        type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': it.label, 'data-focus': it.focus,
        onclick: () => onPick(it.id),
      }, h('span.tr-tile-ico', it.icon));
      btns.set(it.id, b);
      return withTip(b, it.tip);
    }));
    el.sync = (selected) => btns.forEach((b, id) => sel(b, id === selected));
    return el;
  }

  /* ---- edits (always read the live state, so one set of handlers lives as long as the page) ---- */
  /** Armor material / dye of one piece (every piece while "same material for all" is on). s.focus remembers the last edited piece. */
  function setField(field, val, piece) {
    const c = cur();
    upd((s) => {
      s.focus = piece;
      (s.sync ? PIECES : [piece]).forEach((p) => {
        const o = s.outfit[p];
        if (field === 'armor') { if (!(ARMOR[val].pieces && !ARMOR[val].pieces.includes(p))) o.armor = val; }
        else if (field === 'dye') { if (ARMOR[o.armor].dyeable) o.dye = val; }
      });
    });
    if (c.sync && field === 'armor' && ARMOR[val].pieces) toast(ARMOR[val].name + ' only exists as a helmet — the other pieces kept their armor');
  }
  /** Trim pattern on the given pieces (a row = all four, a thumbnail = one). */
  function setPattern(id, pieces) {
    upd((s) => { pieces.forEach((p) => { const o = s.outfit[p]; o.pattern = id; if (id && !o.material) o.material = s.lastMaterial; }); });
  }
  /** Trim material for every piece. */
  function setTrimMat(id) {
    upd((s) => { PIECES.forEach((p) => { s.outfit[p].material = id; }); s.lastMaterial = id; });
  }
  /** Copy the last edited piece's armor material and dye onto the other pieces. */
  const copyToAll = (s) => {
    const src = s.outfit[s.focus];
    PIECES.forEach((p) => {
      if (p === s.focus) return;
      if (!(ARMOR[src.armor].pieces && !ARMOR[src.armor].pieces.includes(p))) { const o = s.outfit[p]; o.armor = src.armor; o.dye = src.dye; }
    });
  };

  let names = null;
  const patShort = (id) => names.pat[D.trimPatterns.findIndex((x) => x.id === id)];
  const matShort = (id) => names.mat[D.trimMaterials.findIndex((x) => x.id === id)];

  /** One plain piece row: label, every armor material (selected one highlighted), eye toggle, dye colours for leather. */
  function makeSlot(p) {
    const armorBtns = new Map();
    const mats = h('div.tr-armors', { role: 'radiogroup', 'aria-label': 'Armor material for the ' + PIECE_NAME[p].toLowerCase() },
      D.armorMaterials.filter((m) => !m.pieces || m.pieces.includes(p)).map((m) => {
        const b = h('button.tr-ico', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': armorName(p, m.id), 'data-focus': 'tr-armor-' + p + '-' + m.id, onclick: () => setField('armor', m.id, p) },
          TH.icon.item(p, m.id, { size: 24 }));
        armorBtns.set(m.id, b);
        return withTip(b, [armorName(p, m.id)]);
      }));
    const eye = h('button.tr-eye', { type: 'button', 'data-focus': 'tr-show-' + p, 'aria-label': 'Show ' + PIECE_NAME[p] + ' in the preview',
      onclick: () => upd((s) => { s.outfit[p].show = !s.outfit[p].show; }) }, h('span.tr-eyeico'));
    withTip(eye, () => { const c = cur(); return [p === 'chestplate' && c.elytra ? 'Hidden while the elytra is worn' : (c.outfit[p].show ? 'Hide ' : 'Show ') + PIECE_NAME[p].toLowerCase() + ' in the preview']; });
    const el = h('div.tr-slotwrap', h('b.tr-pname', PIECE_NAME[p]), mats, eye);
    let dyes = null, last = {};
    function setDyes(n) { if (dyes && n) dyes.replaceWith(n); else if (n) el.append(n); else if (dyes) dyes.remove(); dyes = n; }
    function update(st) {
      const o = st.outfit[p];
      el.classList.toggle('off', !o.show || (p === 'chestplate' && st.elytra));
      eye.classList.toggle('on', o.show); eye.setAttribute('aria-pressed', String(o.show));
      if (last.armor !== o.armor) armorBtns.forEach((b, id) => sel(b, id === o.armor));
      const dyeKey = ARMOR[o.armor].dyeable ? 'd' + (o.dye || '') : '';
      if (last.dye !== dyeKey) {
        setDyes(ARMOR[o.armor].dyeable ? h('div.tr-dyes', { role: 'radiogroup', 'aria-label': 'Leather dye colour for the ' + PIECE_NAME[p].toLowerCase() },
          h('button.tr-dye.none' + (!o.dye ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(!o.dye), 'aria-label': 'Undyed leather', title: 'Undyed', onclick: () => setField('dye', null, p), style: { '--c': D.leatherDefault } }),
          D.dyes.map((d) => {
            const nm = itemName(d.id + '_dye', d.id.replace('_', ' ') + ' dye');
            return h('button.tr-dye' + (o.dye === d.color ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(o.dye === d.color), 'aria-label': nm, title: nm, onclick: () => setField('dye', d.color, p), style: { '--c': d.color } });
          }),
          h('label.tr-dye.custom' + (o.dye && !D.dyes.some((d) => d.color === o.dye) ? '.on' : ''), { title: 'Custom colour' },
            h('span.sr', 'Custom dye colour'),
            h('input', { type: 'color', value: o.dye || D.leatherDefault, onchange: (e) => setField('dye', e.target.value.toLowerCase(), p) }))) : null);
        if (dyes) tipTitles(dyes);
      }
      last = { armor: o.armor, dye: dyeKey };
    }
    return { el, update };
  }

  function buildSkin(st) {
    const sk = st.skin;
    const nameInput = h('input.field', { type: 'text', placeholder: 'Minecraft username', maxlength: 16, value: sk.kind === 'name' ? sk.name : '', 'aria-label': 'Minecraft username', autocomplete: 'off', spellcheck: false, 'data-focus': 'tr-user',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } } });
    async function lookup() {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) { toast('Usernames are 1–16 letters, digits or _'); return; }
      goBtn.disabled = true; goBtn.textContent = '…';
      try {
        const r = await fetchNamedSkin(name);
        upd((s) => { s.skin = { kind: 'name', name, data: r.canvas.toDataURL('image/png'), slim: r.slim }; });
        toast('Loaded the skin of ' + name + (r.slim ? ' (slim arms)' : ''));
      } catch (e) {
        goBtn.disabled = false; goBtn.textContent = 'Load';
        toast(e && e.message ? e.message : 'Could not load the skin');
      }
    }
    const goBtn = h('button.btn.small', { type: 'button', onclick: lookup }, 'Load');
    const file = h('input', { type: 'file', accept: 'image/png', class: 'sr', 'aria-label': 'Upload a skin PNG', tabindex: -1, onchange: () => { const f = file.files[0]; file.value = ''; if (f) takeFile(f); } });
    const skinBtn = (k, n) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sk.kind === k), class: sk.kind === k ? 'on' : '', onclick: () => upd((s) => { s.skin = { kind: k, name: '', data: null, slim: k === 'alex' }; }) }, n);
    const box = h('section.panel.tr-skin', { 'aria-label': 'Skin' },
      h('div.tr-skin-row', nameInput, goBtn),
      h('div.tr-skin-row.tr-skin-row2',
        h('div.seg.tr-seg.tr-pick', { role: 'radiogroup', 'aria-label': 'Default skin' }, skinBtn('steve', 'Steve'), skinBtn('alex', 'Alex')),
        h('button.btn.small', { type: 'button', title: sk.kind === 'file' ? 'Uploaded: ' + sk.name : 'Upload a skin PNG', onclick: () => file.click() }, 'Upload skin'), file,
        h('div.seg.tr-seg.tr-arms', { role: 'radiogroup', 'aria-label': 'Arm width' },
          [[false, 'Classic'], [true, 'Slim']].map(([v, n]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sk.slim === v), class: sk.slim === v ? 'on' : '', title: v ? 'Slim (3px) arms' : 'Classic (4px) arms', onclick: () => upd((s) => { s.skin.slim = v; }) }, n)))));
    tipTitles(box);
    return box;
  }

  function buildViewer(st) {
    const autoBtn = h('button.tr-vbtn' + (V.auto ? '.on' : ''), { type: 'button', 'aria-pressed': String(V.auto), title: 'Slowly rotate', onclick: () => V.setAuto(!V.auto) }, h('span.tr-vico.rot'), h('span', 'Rotate'));
    V.onAuto = (on) => { autoBtn.classList.toggle('on', on); autoBtn.setAttribute('aria-pressed', String(on)); };
    const animBtns = ANIMS.map(([id, label]) => h('button.tr-anim' + (V.anim === id ? '.on' : ''), { type: 'button', 'aria-pressed': String(V.anim === id), 'data-anim': id, 'data-focus': 'tr-anim-' + id, onclick: () => V.setAnim(id, { force: true }) }, label));
    V.onAnim = (id) => animBtns.forEach((b) => { const on = b.dataset.anim === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const elyBtn = h('button.tr-vbtn' + (st.elytra ? '.on' : ''), { type: 'button', 'aria-pressed': String(!!st.elytra), 'data-focus': 'tr-elytra', title: 'Wear an elytra instead of the chestplate', onclick: () => upd((s) => { s.elytra = !s.elytra; }) }, h('span.tr-vico.wing'), h('span', 'Elytra'));
    V.onElytra = (on) => { elyBtn.classList.toggle('on', on); elyBtn.setAttribute('aria-pressed', String(on)); };
    const stage = h('div.tr-stage');
    const viewer = h('section.panel.tr-viewer', { 'aria-label': '3D preview' },
      stage,
      h('div.tr-vbar',
        elyBtn,
        autoBtn,
        h('button.tr-vbtn', { type: 'button', title: 'Reset the view (double-click the preview)', onclick: () => V.reset() }, h('span.tr-vico.reset'), h('span', 'Reset')),
        h('button.tr-vbtn', { type: 'button', title: 'Save the preview as a PNG', onclick: async () => {
          const b = await V.shot();
          if (!b) { toast('Nothing to save yet'); return; }
          const a = h('a', { href: URL.createObjectURL(b), download: 'armor-trim-preview.png' });
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        } }, h('span.tr-vico.cam'), h('span', 'PNG'))),
      h('div.tr-anims', { role: 'group', 'aria-label': 'Animation' }, animBtns),
      h('div.tr-hint', 'Drag to rotate · scroll or pinch to zoom · drop a skin PNG here'),
      h('div.tr-drop', { 'aria-hidden': 'true' }, 'Drop the skin PNG'));
    if (V.error) stage.append(h('div.tr-error', V.error, h('br'), h('span', 'The flat previews still work.')));
    else {
      stage.append(V.el);
      if (!V.ready) stage.append(h('div.tr-loadingv', 'Loading the 3D viewer…'));
    }
    if (!V.animInit) { V.animInit = true; V.persist = (id) => { const need = id === 'fly' && !cur().elytra; upd((s) => { s.anim = id; if (need) s.elytra = true; }, { silent: !need }); }; if (!reduced() && st.anim !== 'idle') V.setAnim(st.anim, { silent: true }); }
    else V.onAnim(V.anim);
    const dropOn = (on) => viewer.classList.toggle('dropping', on);
    viewer.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropOn(true); } });
    viewer.addEventListener('dragleave', (e) => { if (!viewer.contains(e.relatedTarget)) dropOn(false); });
    viewer.addEventListener('drop', (e) => { dropOn(false); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); takeFile(f); } });
    tipTitles(viewer);
    V.init().then(() => { const s = stage.querySelector('.tr-loadingv'); if (s) s.remove(); V.wake(); }).catch(() => { stage.replaceChildren(h('div.tr-error', V.error || 'The 3D viewer could not start.', h('br'), h('span', 'The flat previews still work.'))); });
    return viewer;
  }

  function mount(st) {
    names = { pat: shortNames(D.trimPatterns.map((p) => patName(p.id))), mat: shortNames(D.trimMaterials.map((m) => matName(m.id))) };
    const wrap = h('div.tr-page');
    const U = { wrap, sig: {} };

    /* ---- left: the four piece rows + saved outfits ---- */
    const slots = PIECES.map(makeSlot);
    const savedHost = h('div.tr-saved-host', { style: { display: 'contents' } });
    const syncBox = h('input', { type: 'checkbox', 'data-focus': 'tr-sync', 'aria-label': 'Same material for all pieces',
      onchange: (e) => { const on = e.target.checked; upd((s) => { s.sync = on; if (on) copyToAll(s); }); } });
    const syncLabel = h('label.tr-sync', h('span.switch', syncBox, h('span')), h('span', 'Same material for all'));
    withTip(syncLabel, ['While on, picking an armor material or dye sets every piece', 'Turning it on copies the last edited piece (the turtle shell stays helmet-only)']);
    const hud = h('section.panel.tr-card.tr-hud', { 'aria-label': 'Outfit' },
      h('div.tr-card-head', h('h3', 'Armor')),
      h('div.tr-stack', slots.map((s) => s.el)),
      h('div.tr-applybar', syncLabel));

    const skinHost = h('div', { style: { display: 'contents' } });
    const viewer = buildViewer(st);

    /* ---- right: trim material row + one row of four pieces per pattern ---- */
    const matOpts = D.trimMaterials.map((m) => ({
      id: m.id, label: matName(m.id), focus: 'tr-trimmat-' + m.id, icon: TH.icon.trimMaterial(m.item, { size: 22 }),
      tip: () => [ingredientName(m)],
    }));
    const tiles = tileRow(matOpts, setTrimMat, 'mats');
    const pats = [{ id: null, name: 'No trim' }].concat(D.trimPatterns).map((p, i) => {
      const pcs = PIECES.map((pc) => {
        const cv = h('canvas.tr-thumb', { width: 88, height: 88 });
        const b = h('button.tr-pt', { type: 'button', 'aria-pressed': 'false', 'aria-label': PIECE_NAME[pc] + ': ' + (p.id ? patName(p.id) : 'no trim'), 'data-focus': 'tr-pat-' + (p.id || 'none') + '-' + pc,
          onclick: () => setPattern(p.id, [pc]) }, cv);
        withTip(b, () => [PIECE_NAME[pc], p.id ? patName(p.id) : 'No trim'].concat(p.id ? ['Click: this piece only'] : []));
        return { pc, b, cv };
      });
      const main = h('button.tr-pr-main', { type: 'button', 'aria-label': (p.id ? patName(p.id) : 'No trim') + ' on all pieces', 'data-focus': 'tr-pat-' + (p.id || 'none') },
        h('span.tr-pat-name', p.id ? names.pat[i - 1] : 'No trim'),
        h('span.tr-pat-foot', p.id ? [h('span.tr-pat-ico', TH.icon.trim(p.id, { size: 18 })), h('span.tr-pat-ico', TH.icon(p.blockIcon, { size: 18 }))] : null));
      const row = h('div.tr-pr' + (p.id ? '.r-' + p.rarity : ''), { onclick: (e) => { if (!e.target.closest('.tr-pt')) setPattern(p.id, PIECES); } }, main, h('div.tr-pr-pcs', pcs.map((x) => x.b)));
      if (p.id) withTip(main, () => patternTipLines(p).concat(['Click: all pieces'])); else withTip(main, ['No trim', 'Remove the trim from every piece']);
      return { p, row, pcs };
    });
    const grid = h('div.tr-grid', pats.map((x) => x.row));
    const browser = h('section.panel.tr-card.tr-browser', { 'aria-label': 'Trim browser' },
      h('div.tr-card-head', h('h3', 'Trim')),
      h('div.tr-sub', 'Trim material'), tiles,
      h('div.tr-sub', h('span', 'Pattern'), h('span.faint', 'row = all pieces · piece = just that one')), grid);

    /* ---- materials list ---- */
    const body = h('div.tr-mbody', { style: { display: 'contents' } });
    let matsText = '';
    const copyBtn = h('button.btn.small', { type: 'button', onclick: () => copyText(matsText) }, 'Copy list');
    const matsEl = h('section.panel.tr-card.tr-mats', { 'aria-label': 'Materials needed' }, h('div.tr-card-head', h('h3', 'Materials'), copyBtn), body);

    wrap.append(
      h('div.page-head.tr-head', h('div.tr-title', h('h2', 'Armor trims'), h('p', 'Preview, compare and cost out armor trims.'))),
      h('div.tr-layout', h('div.tr-col.a', hud, savedHost), h('div.tr-col.b', viewer, skinHost), h('div.tr-right', browser, matsEl)));
    tipTitles(wrap);

    const row = (icon, text, qty, tipLines) => { const r = h('li.tr-mrow', h('span.tr-mico', icon), h('span.tr-mname', text), qty != null ? h('b.tr-mqty', '×' + qty) : null); return tipLines ? withTip(r, tipLines) : r; };
    const group = (label, rows) => h('div.tr-mgroup', h('div.tr-mlabel', label), h('ul.tr-mlist', rows));

    U.update = (st, M, gm) => {
      slots.forEach((s) => s.update(st));
      const ss = JSON.stringify([st.saved.map((g) => [g.id, g.name, g.outfit]), st.renaming, PIECES.map((p) => { const o = st.outfit[p]; return [o.armor, o.pattern, o.material, o.dye, o.show]; })]);
      if (U.sig.saved !== ss) { U.sig.saved = ss; const sp = savedPanel(st); tipTitles(sp); savedHost.replaceChildren(sp); }
      syncBox.checked = st.sync;
      const sk = JSON.stringify([st.skin.kind, st.skin.slim, st.skin.name]);
      if (U.sig.skin !== sk) { U.sig.skin = sk; skinHost.replaceChildren(buildSkin(st)); }
      tiles.sync(gm);
      pats.forEach(({ p, row, pcs }) => {
        const n = pcs.filter(({ pc, b }) => { const on = (st.outfit[pc].pattern || null) === p.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); return on; }).length;
        row.classList.toggle('on', n === PIECES.length);
      });
      U.paint = () => pats.forEach(({ p, pcs }) => pcs.forEach(({ pc, cv }) => paintThumb(cv, pc, Object.assign({}, st.outfit[pc], { pattern: p.id, material: p.id ? gm : null }))));
      // materials panel text
      const none = !M.trimmed;
      copyBtn.disabled = none;
      matsText = materialsText(st, M);
      const ms = JSON.stringify([M.pcs, M.templates.map((t) => [t.id, t.qty]), M.copies, M.diamonds, M.dupes.map((r) => [r.name, r.qty]), M.ingredients.map((r) => [r.item, r.qty])]);
      if (U.sig.mats !== ms) {
        U.sig.mats = ms;
        const mk = [];
        if (none) mk.push(h('p.tr-note', M.pcs.length ? 'No trims yet. Pick a pattern to see the templates and materials it needs.' : 'No pieces are shown. Show at least one piece to see what it needs.'));
        else {
          mk.push(group('Templates', M.templates.map((t) => row(TH.icon(t.icon, { size: 20 }), patName(t.id), t.qty, () => patternTipLines(t.data)))));
          if (M.copies) mk.push(group('Duplication', [row(TH.icon('diamond', { size: 20 }), itemName('diamond', 'Diamond'), M.diamonds, [M.copies + ' extra cop' + (M.copies === 1 ? 'y' : 'ies'), M.copies + ' × ' + D.templateCopyDiamonds + ' diamonds'])]
            .concat(M.dupes.map((r) => row(TH.icon(r.icon, { size: 20 }), r.name, r.qty)))));
          mk.push(group('Trim materials', M.ingredients.map((r) => row(TH.icon(r.icon, { size: 20 }), r.item, r.qty))));
        }
        body.replaceChildren(...mk);
      }
    };
    return U;
  }

  let paintT = 0;
  function patch(st) {
    const M = computeMaterials(st);
    const gm = st.lastMaterial;   // trim material the pattern rows show / apply
    const a = document.activeElement;
    const fk = a && UI.wrap.contains(a) && a.dataset && a.dataset.focus;
    syncViewer(st);                 // the 3D model first: its cached textures are applied before anything else runs
    UI.update(st, M, gm);
    clearTimeout(paintT); paintT = setTimeout(() => UI.paint && UI.paint(), 0);   // thumbnails after (cached -> instant, new -> when composed)
    if (fk && !a.isConnected) {
      const el = UI.wrap.querySelector('[data-focus="' + fk + '"]');
      if (el) el.focus({ preventScroll: true });
    }
    V.el.setAttribute('aria-label', '3D preview. ' + PIECES.filter((p) => st.outfit[p].show).map((p) => armorName(p, st.outfit[p].armor) + (st.outfit[p].pattern ? ' with ' + patName(st.outfit[p].pattern) : '')).join(', ') + '. Drag to rotate, scroll to zoom, double-click to reset.');
    warm(st);
  }

  /* Pre-composite (idle, in small chunks) what the next click will need: every trim material and armor material of the
     focused piece, and the gallery thumbnails of every trim material, so later clicks hit the cache. */
  let warmKey = '', warmTimer = 0;
  function warm(st) {
    const key = PIECES.map((p) => [p, st.outfit[p].pattern, st.outfit[p].dye].join('|')).join('/');
    if (key === warmKey) return;
    warmKey = key;
    clearTimeout(warmTimer);
    const jobs = [];
    const mats = D.trimMaterials.map((m) => m.id);
    PIECES.forEach((p) => {
      const o = st.outfit[p], armors = D.armorMaterials.filter((a) => !a.pieces || a.pieces.includes(p));
      armors.forEach((a) => jobs.push(() => armorLayer(a.id, p === 'leggings', o.dye)));
      if (o.pattern) mats.forEach((m) => jobs.push(() => pieceTexture(p, Object.assign({}, o, { material: m }))));
      mats.forEach((m) => D.trimPatterns.forEach((pt) => jobs.push(() => thumb(p, Object.assign({}, o, { pattern: pt.id, material: m })))));
    });
    let i = 0;
    const step = () => {
      if (warmKey !== key) return;
      const end = Math.min(jobs.length, i + 6);
      for (; i < end; i++) { try { const r = jobs[i](); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
      if (i < jobs.length) warmTimer = setTimeout(step, 30);
    };
    warmTimer = setTimeout(step, 250);
  }

  function render(root, state) {
    hideTip();
    if (!cssReady) {
      ensureCss().then(() => { if (TH.app && TH.app.render) TH.app.render(); });
      root.append(h('div.page-head', h('div', h('h2', 'Armor trims'))), h('div.panel.tr-loading', 'Loading the previewer…'));
      return;
    }
    const st = norm(state.trims);
    if (!UI) UI = mount(st);
    root.append(UI.wrap);
    patch(st);
  }

  /** Fill a thumbnail canvas with the flat front view of the piece (sync if cached, otherwise when loaded). */
  function paintThumb(cv, piece, o) {
    const key = pieceKey(piece, o);
    if (cv._key === key) return;
    cv._key = key;
    const draw = (src) => {
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height);
      x.imageSmoothingEnabled = false;
      const s = Math.max(1, Math.floor(Math.min((cv.width - 8) / src.width, (cv.height - 8) / src.height)));
      const w = src.width * s, hh = src.height * s;
      x.drawImage(src, 0, 0, src.width, src.height, Math.round((cv.width - w) / 2), Math.round((cv.height - hh) / 2), w, hh);
    };
    thumb(piece, o).then((src) => { if (cv._key === key) { draw(src); cv.classList.remove('err'); } }).catch(() => { if (cv._key === key) cv.classList.add('err'); });
  }

  function copyText(text) {
    const ok = () => toast('Materials list copied');
    const fallback = () => {
      const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('Could not copy'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }

  /* ---- saved outfits ---- */
  function savedPanel(st) {
    const input = h('input.field', { type: 'text', placeholder: 'Save outfit as…', maxlength: 40, value: st.saveName, 'aria-label': 'Name for the saved outfit', 'data-focus': 'tr-save-name',
      oninput: (e) => upd((s) => { s.saveName = e.target.value; }, { silent: true }),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } } });
    function save() {
      const name = input.value.trim() || 'Outfit ' + (st.saved.length + 1);
      upd((s) => {
        const id = uid('outfit');
        s.saved.push({ id, name, outfit: Object.fromEntries(PIECES.map((p) => [p, clonePiece(s.outfit[p])])), skin: s.skin.kind === 'file' ? null : { kind: s.skin.kind, name: s.skin.name, slim: s.skin.slim, data: s.skin.data }, updated: Date.now() });
        s.savedId = id; s.saveName = '';
      });
      toast('Saved “' + name + '”');
    }
    const cards = st.saved.map((g) => {
      if (st.renaming === g.id) {
        const rn = h('input.field', { type: 'text', maxlength: 40, value: st.renameText, 'aria-label': 'New name', 'data-focus': 'tr-rename',
          oninput: (e) => upd((s) => { s.renameText = e.target.value; }, { silent: true }),
          onkeydown: (e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') upd((s) => { s.renaming = null; }); } });
        const commit = () => upd((s) => { const x = s.saved.find((y) => y.id === g.id); if (x) x.name = (s.renameText || '').trim() || x.name; s.renaming = null; });
        setTimeout(() => { if (rn.isConnected && document.activeElement !== rn) { rn.focus(); rn.select(); } }, 60);
        return h('div.tr-schip.editing', rn, h('button.btn.small.primary', { type: 'button', onclick: commit }, 'OK'), h('button.btn.small.ghost', { type: 'button', onclick: () => upd((s) => { s.renaming = null; }) }, '✕'));
      }
      const trimmedN = PIECES.filter((p) => g.outfit[p] && g.outfit[p].show !== false && g.outfit[p].pattern).length;
      const same = PIECES.every((p) => { const a = g.outfit[p], c = st.outfit[p]; return a && ['armor', 'pattern', 'material', 'dye'].every((k) => (a[k] || null) === (c[k] || null)) && (a.show !== false) === c.show; });
      const active = same; // accent marker only while the current outfit still equals this saved one
      return h('div.tr-schip' + (active ? '.active' : ''),
        h('button.tr-saved-main', { type: 'button', 'aria-pressed': String(active), title: 'Load ' + g.name + ' (' + trimmedN + ' trimmed)', 'data-focus': 'tr-saved-' + g.id,
          onclick: () => { upd((s) => {
            const x = s.saved.find((y) => y.id === g.id); if (!x) return;
            PIECES.forEach((p) => { if (x.outfit[p]) s.outfit[p] = clonePiece(x.outfit[p]); });
            if (x.skin && x.skin.kind) s.skin = Object.assign({ name: '', data: null, slim: false }, x.skin);
            s.savedId = g.id;
          }); toast('Loaded “' + g.name + '”'); } }, g.name),
        h('span.tr-chip-acts',
          h('button.tr-cbtn.edit', { type: 'button', title: 'Rename', 'aria-label': 'Rename ' + g.name, 'data-focus': 'tr-ren-' + g.id, onclick: () => upd((s) => { s.renaming = g.id; s.renameText = g.name; }) }, h('span.tr-cico')),
          h('button.tr-cbtn.del', { type: 'button', title: 'Delete', 'aria-label': 'Delete ' + g.name, onclick: () => { upd((s) => { s.saved = s.saved.filter((y) => y.id !== g.id); if (s.savedId === g.id) s.savedId = null; }); } }, h('span.tr-cico'))));
    });
    return h('div.tr-saved', { role: 'group', 'aria-label': 'Saved outfits' },
      h('div.tr-save-row', input, h('button.btn.small.primary', { type: 'button', title: 'Save the current outfit and skin', onclick: save }, 'Save')),
      st.saved.length ? h('div.tr-saved-list', cards) : null);
  }

  /* ---- skin upload ---- */
  async function takeFile(f) {
    try {
      if (!/png$/i.test(f.type) && !/\.png$/i.test(f.name)) throw new Error('Please choose a PNG file');
      if (f.size > 2e6) throw new Error('That file is too large for a skin');
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That is not a valid PNG')); i.src = url; });
      const r = skinFromImage(img);
      upd((s) => { s.skin = { kind: 'file', name: f.name.replace(/\.png$/i, ''), data: r.canvas.toDataURL('image/png'), slim: r.slim }; });
      toast('Skin loaded' + (r.slim ? ' (slim arms detected)' : ''));
    } catch (e) { toast(e.message || 'Could not use that file'); }
  }

  /* ======================================================================
   * Register
   * ====================================================================== */
  TH.app.register({
    id: 'trims',
    name: 'Trims',
    icon: 'mc:item/sentry_armor_trim_smithing_template',
    init(store) {
      store.define('trims', defaults());
      norm(store.get().trims);
      ensureCss();
    },
    badge(state) {
      const t = state.trims;
      const n = t && t.owned ? Object.values(t.owned).filter(Boolean).length : 0;
      return n ? { done: Math.min(n, D.trimPatterns.length), total: D.trimPatterns.length } : null;
    },
    render,
  });
})();
