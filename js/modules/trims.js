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
 *   focus: 'chestplate',                      // slot the editor + pattern gallery work on
 *   lastMaterial: 'quartz',                   // trim material used when a pattern is picked on a bare piece (quartz = default)
 *   sync: false,                              // "same for all": every edit goes to all pieces
 *   skin: { kind: 'steve'|'alex'|'name'|'file', name, data (dataURL), slim },
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
  const upd = (fn, opts) => TH.store.update((s) => { fn(norm(s.trims)); }, opts);
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
    const P = (id, box, uv, g, mirror) => ({ id, box, uv, g: g || 0, mirror: !!mirror });
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
    helmet: [{ box: [-4, 24, -4, 8, 8, 8], uv: [0, 0], g: 1 }],
    chestplate: [{ box: [-4, 12, -2, 8, 12, 4], uv: [16, 16], g: 1 }, { box: [-8, 12, -2, 4, 12, 4], uv: [40, 16], g: 1 }, { box: [4, 12, -2, 4, 12, 4], uv: [40, 16], g: 1, mirror: true }],
    leggings: [{ box: [-4, 12, -2, 8, 12, 4], uv: [16, 16], g: 0.5 }, { box: [-3.9, 0, -2, 4, 12, 4], uv: [0, 16], g: 0.5 }, { box: [-0.1, 0, -2, 4, 12, 4], uv: [0, 16], g: 0.5, mirror: true }],
    boots: [{ box: [-3.9, 0, -2, 4, 12, 4], uv: [0, 16], g: 1 }, { box: [-0.1, 0, -2, 4, 12, 4], uv: [0, 16], g: 1, mirror: true }],
  };

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
      el, ready: false, error: null, renderer: null, scene: null, camera: null, player: null, skinGroup: null, slim: null,
      pieces: {}, shadow: null, target: null, key: null,
      yaw: 0.55, pitch: 0.12, zoom: 1, vel: 0, goal: null, auto: false, interacted: false,
      dirty: true, raf: 0, last: 0, inView: true, w: 0, h: 0, sig: {}, skinSig: '',
    };
    const HOME = { yaw: 0.55, pitch: 0.12, zoom: 1 };
    const ZMIN = 0.55, ZMAX = 2.4, PMAX = 0.75;
    let initP = null;

    const canvasTex = (c) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const mat = () => new THREE.MeshLambertMaterial({ transparent: false, alphaTest: 0.5, side: THREE.FrontSide });

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
      PIECES.forEach((p) => {
        const g = new THREE.Group(), m = mat();
        armorParts[p].forEach((part) => { const mesh = new THREE.Mesh(boxGeometry(part, 64, 32), m); g.add(mesh); });
        g.visible = false;
        S.pieces[p] = { group: g, mat: m };
        S.player.add(g);
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
      const d = fit() / S.zoom, cp = Math.cos(S.pitch);
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
      if (moving || S.dirty) { resize(); place(); S.renderer.render(S.scene, S.camera); S.dirty = false; }
      if (moving || dragging) wake();
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
    S.reset = () => {
      stopAuto(); S.vel = 0;
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
      if (S.slim !== slim || !S.skinGroup) {
        if (S.skinGroup) { S.player.remove(S.skinGroup); S.skinGroup.children.forEach((m) => m.geometry.dispose()); }
        const g = new THREE.Group();
        const m = S.skinMat || (S.skinMat = mat());
        skinParts(slim).forEach((p) => { const mesh = new THREE.Mesh(boxGeometry(p, 64, 64), m); mesh.renderOrder = p.g ? 1 : 0; g.add(mesh); });
        S.skinGroup = g; S.slim = slim;
        S.player.add(g);
      }
      if (S.skinMat.map) S.skinMat.map.dispose();
      S.skinMat.map = canvasTex(canvas);
      S.skinMat.needsUpdate = true;
      S.dirty = true; wake();
    };
    S.setPiece = (piece, canvas) => {
      if (!S.ready) return;
      const p = S.pieces[piece];
      if (!canvas) { p.group.visible = false; }
      else {
        if (p.mat.map) p.mat.map.dispose();
        p.mat.map = canvasTex(canvas);
        p.mat.needsUpdate = true;
        p.group.visible = true;
      }
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
    V.init().then(() => {
      const skSig = JSON.stringify([st.skin.kind, st.skin.slim, (st.skin.data || '').length, st.skin.name]);
      if (skSig !== V.skinSig) {
        V.skinSig = skSig;
        resolveSkin(st.skin).then((r) => { if (V.skinSig === skSig) V.setSkin(r.canvas, st.skin.slim); })
          .catch(() => { V.skinSig = ''; toast('Could not load that skin — showing Steve'); upd((s) => { s.skin = { kind: 'steve', name: '', data: null, slim: false }; }); });
      }
      PIECES.forEach((p) => {
        const o = st.outfit[p];
        const sig = o.show ? pieceKey(p, o) : 'hidden';
        if (V.sig[p] === sig) return;
        V.sig[p] = sig;
        if (!o.show) { V.setPiece(p, null); return; }
        pieceTexture(p, o).then((c) => { if (V.sig[p] === sig) V.setPiece(p, c); })
          .catch(() => { toast('Could not load the ' + armorName(p, o.armor) + ' texture'); });
      });
    }).catch(() => { /* error shown in the viewer panel */ });
  }
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

  let pendingReveal = null; // set by handlers, consumed by the next render
  const markReveal = (...parts) => { pendingReveal = new Set(parts); };

  const icoPiece = (piece, mat, size) => TH.icon.item(piece, mat, { size: size || 32 });

  /** Whether the focused slot's armor-material choice is revealed (UI only, not saved). */
  let chooserOpen = true;

  /** A row of icon+name picker tiles (trim material). */
  function tileRow(items, selected, onPick, cls) {
    return h('div.tr-tiles' + (cls ? '.' + cls : ''), { role: 'radiogroup' }, items.map((it) => {
      const on = it.id === selected;
      const b = h('button.tr-tile' + (on ? '.on' : ''), {
        type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': it.label, 'data-focus': it.focus,
        onclick: () => onPick(it.id),
      }, h('span.tr-tile-ico', it.icon), it.name ? h('span.tr-tile-name', it.name) : null);
      return withTip(b, it.tip);
    }));
  }

  function render(root, state) {
    hideTip();
    if (!cssReady) {
      ensureCss().then(() => { if (TH.app && TH.app.render) TH.app.render(); });
      root.append(h('div.page-head', h('div', h('h2', 'Armor trims'))), h('div.panel.tr-loading', 'Loading the previewer…'));
      return;
    }
    const st = norm(state.trims);
    const M = computeMaterials(st);
    const focus = st.focus, fo = st.outfit[focus];
    const gm = fo.material || st.lastMaterial;           // trim material the browser shows / applies
    const short = shortNames(D.trimPatterns.map((p) => patName(p.id)));
    const mshort = shortNames(D.trimMaterials.map((m) => matName(m.id)));
    const patShort = (id) => short[D.trimPatterns.findIndex((x) => x.id === id)];
    const matShort = (id) => mshort[D.trimMaterials.findIndex((x) => x.id === id)];

    /* ---- edits ---- */
    const setField = (field, val) => {
      markReveal('gallery');
      upd((s) => {
        const targets = s.sync ? PIECES : [focus];
        targets.forEach((p) => {
          const o = s.outfit[p];
          if (field === 'armor') { if (!(ARMOR[val].pieces && !ARMOR[val].pieces.includes(p))) o.armor = val; }
          else if (field === 'pattern') { o.pattern = val; if (val && !o.material) o.material = s.lastMaterial; }
          else if (field === 'material') o.material = val;
          else if (field === 'dye') { if (ARMOR[o.armor].dyeable) o.dye = val; }
        });
        if (field === 'material') s.lastMaterial = val;
      });
      if (st.sync && field === 'armor' && ARMOR[val].pieces) toast(ARMOR[val].name + ' only exists as a helmet — the other pieces kept their armor');
    };
    /** Copy the focused piece's armor material, dye, pattern and trim material onto every other piece. */
    const copyToAll = (s) => {
      const src = s.outfit[s.focus];
      PIECES.forEach((p) => {
        if (p === s.focus) return;
        const o = s.outfit[p];
        if (!(ARMOR[src.armor].pieces && !ARMOR[src.armor].pieces.includes(p))) { o.armor = src.armor; o.dye = src.dye; }
        o.pattern = src.pattern; o.material = src.material;
      });
    };
    const applyAll = () => {
      markReveal('gallery');
      upd(copyToAll);
      toast('Applied the ' + PIECE_NAME[focus].toLowerCase() + ' look to every piece');
    };

    /* ---- left: the four slots, the focused one reveals its armor choice ---- */
    const validArmor = D.armorMaterials.filter((m) => !m.pieces || m.pieces.includes(focus));
    const chooser = () => {
      const mats = h('div.tr-armors', { style: '--n:' + validArmor.length, role: 'radiogroup', 'aria-label': 'Armor material for the ' + PIECE_NAME[focus].toLowerCase() },
        validArmor.map((m) => {
          const on = m.id === fo.armor;
          const b = h('button.tr-ico' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': armorName(focus, m.id), 'data-focus': 'tr-armor-' + m.id, onclick: () => setField('armor', m.id) },
            TH.icon.item(focus, m.id, { size: 28 }));
          return withTip(b, [armorName(focus, m.id)]);
        }));
      const dyes = ARMOR[fo.armor].dyeable ? h('div.tr-dyes', { role: 'radiogroup', 'aria-label': 'Leather dye colour' },
        h('button.tr-dye.none' + (!fo.dye ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(!fo.dye), 'aria-label': 'Undyed leather', title: 'Undyed', onclick: () => setField('dye', null), style: { '--c': D.leatherDefault } }),
        D.dyes.map((d) => {
          const nm = itemName(d.id + '_dye', d.id.replace('_', ' ') + ' dye');
          return h('button.tr-dye' + (fo.dye === d.color ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(fo.dye === d.color), 'aria-label': nm, title: nm, onclick: () => setField('dye', d.color), style: { '--c': d.color } });
        }),
        h('label.tr-dye.custom' + (fo.dye && !D.dyes.some((d) => d.color === fo.dye) ? '.on' : ''), { title: 'Custom colour' },
          h('span.sr', 'Custom dye colour'),
          h('input', { type: 'color', value: fo.dye || D.leatherDefault, onchange: (e) => setField('dye', e.target.value.toLowerCase()) }))) : null;
      return h('div.tr-choose', { 'aria-label': 'Armor material' }, mats, dyes);
    };
    const stack = PIECES.map((p) => {
      const o = st.outfit[p], on = p === focus;
      const trimmed = o.pattern && o.material;
      const btn = h('button.tr-slot-main', {
        type: 'button', 'aria-pressed': String(on), 'aria-expanded': on ? String(chooserOpen) : null, 'data-focus': 'tr-slot-' + p,
        'aria-label': PIECE_NAME[p] + ': ' + armorName(p, o.armor) + (trimmed ? ', ' + patName(o.pattern) + ', ' + matName(o.material) : ', no trim') + (on ? '. Choose the armor material' : ''),
        onclick: () => { if (on) chooserOpen = !chooserOpen; else chooserOpen = true; markReveal(on ? 'chooser' : 'gallery', 'chooser'); upd((s) => { s.focus = p; }); },
      },
      h('span.tr-slot-ico', icoPiece(p, o.armor, 32)),
      h('span.tr-slot-text', h('b', armorName(p, o.armor)), h('span', trimmed ? patShort(o.pattern) + ' · ' + matShort(o.material) : 'No trim')),
      trimmed ? h('span.tr-sw', TH.icon.trimMaterial(TRIMM[o.material].item, { size: 16 })) : null);
      withTip(btn, () => pieceTipLines(st, p));
      const eye = h('button.tr-eye' + (o.show ? '.on' : ''), { type: 'button', 'aria-pressed': String(o.show), 'data-focus': 'tr-show-' + p,
        'aria-label': 'Show ' + PIECE_NAME[p] + ' in the preview',
        onclick: () => upd((s) => { s.outfit[p].show = !s.outfit[p].show; }) }, h('span.tr-eyeico'));
      withTip(eye, [(o.show ? 'Hide ' : 'Show ') + PIECE_NAME[p].toLowerCase() + ' in the preview']);
      return h('div.tr-slotwrap' + (on ? '.on' : '') + (o.show ? '' : '.off'),
        h('div.tr-slot', btn, eye),
        on && chooserOpen ? chooser() : null);
    });

    const hud = h('section.panel.tr-card.tr-hud', { 'aria-label': 'Outfit' },
      savedPanel(st),
      h('div.tr-card-head', h('h3', 'Outfit'), h('span.faint', 'Pick a piece')),
      h('div.tr-stack', stack),
      h('div.tr-applybar',
        h('button.btn.primary.tr-applyall', { type: 'button', 'data-focus': 'tr-apply-all', title: 'Copy the ' + PIECE_NAME[focus].toLowerCase() + '\'s armor, pattern and trim material onto every piece (the turtle shell stays helmet-only)', onclick: applyAll }, 'Apply to all pieces'),
        h('label.tr-sync', { title: 'While on, every change goes to all pieces' },
          h('span.switch', h('input', { type: 'checkbox', checked: st.sync, 'data-focus': 'tr-sync', 'aria-label': 'Same for all pieces',
            onchange: (e) => { const on = e.target.checked; markReveal('gallery'); upd((s) => { s.sync = on; if (on) copyToAll(s); }); } }), h('span')),
          h('span', 'Same for all'))));

    /* ---- skin ---- */
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
    const skinBox = h('section.panel.tr-skin', { 'aria-label': 'Skin' },
      h('div.tr-skin-row', nameInput, goBtn),
      h('div.tr-skin-row.tr-skin-row2',
        h('div.seg.tr-seg.tr-pick', { role: 'radiogroup', 'aria-label': 'Default skin' }, skinBtn('steve', 'Steve'), skinBtn('alex', 'Alex')),
        h('button.btn.small', { type: 'button', title: sk.kind === 'file' ? 'Uploaded: ' + sk.name : 'Upload a skin PNG', onclick: () => file.click() }, 'Upload skin'), file,
        h('div.seg.tr-seg.tr-arms', { role: 'radiogroup', 'aria-label': 'Arm width' },
          [[false, 'Classic'], [true, 'Slim']].map(([v, n]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sk.slim === v), class: sk.slim === v ? 'on' : '', title: v ? 'Slim (3px) arms' : 'Classic (4px) arms', onclick: () => upd((s) => { s.skin.slim = v; }) }, n)))));

    /* ---- centre: viewer ---- */
    const autoBtn = h('button.tr-vbtn' + (V.auto ? '.on' : ''), { type: 'button', 'aria-pressed': String(V.auto), title: 'Slowly rotate', onclick: () => V.setAuto(!V.auto) }, h('span.tr-vico.rot'), h('span', 'Rotate'));
    V.onAuto = (on) => { autoBtn.classList.toggle('on', on); autoBtn.setAttribute('aria-pressed', String(on)); };
    const stage = h('div.tr-stage');
    const viewer = h('section.panel.tr-viewer', { 'aria-label': '3D preview' },
      stage,
      h('div.tr-vbar',
        autoBtn,
        h('button.tr-vbtn', { type: 'button', title: 'Reset the view (double-click the preview)', onclick: () => V.reset() }, h('span.tr-vico.reset'), h('span', 'Reset')),
        h('button.tr-vbtn', { type: 'button', title: 'Save the preview as a PNG', onclick: async () => {
          const b = await V.shot();
          if (!b) { toast('Nothing to save yet'); return; }
          const a = h('a', { href: URL.createObjectURL(b), download: 'armor-trim-preview.png' });
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        } }, h('span.tr-vico.cam'), h('span', 'PNG'))),
      h('div.tr-hint', 'Drag to rotate · scroll or pinch to zoom · drop a skin PNG here'),
      h('div.tr-drop', { 'aria-hidden': 'true' }, 'Drop the skin PNG'));
    if (V.error) stage.append(h('div.tr-error', V.error, h('br'), h('span', 'The flat previews still work.')));
    else {
      stage.append(V.el);
      if (!V.ready) stage.append(h('div.tr-loadingv', 'Loading the 3D viewer…'));
    }
    const dropOn = (on) => viewer.classList.toggle('dropping', on);
    viewer.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropOn(true); } });
    viewer.addEventListener('dragleave', (e) => { if (!viewer.contains(e.relatedTarget)) dropOn(false); });
    viewer.addEventListener('drop', (e) => { dropOn(false); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); takeFile(f); } });

    /* ---- right: trim material row + pattern browser + slim materials bar ---- */
    const matOpts = D.trimMaterials.map((m, i) => ({
      id: m.id, label: matName(m.id), focus: 'tr-trimmat-' + m.id, icon: TH.icon.trimMaterial(m.item, { size: 26 }),
      tip: () => [ingredientName(m)].concat(ARMOR[fo.armor].trimMat === m.id && m.darker ? ['Darker shade on ' + ARMOR[fo.armor].name.toLowerCase() + ' armor'] : []),
    }));
    const browser = h('section.panel.tr-card.tr-browser', { 'aria-label': 'Trim browser' },
      h('div.tr-card-head',
        h('h3', 'Trim')),
      h('div.tr-sub', 'Trim material'),
      tileRow(matOpts, gm, (id) => { markReveal('gallery'); setField('material', id); }, 'mats'),
      h('div.tr-sub', 'Pattern'),
      h('div.tr-grid', { role: 'radiogroup', 'aria-label': 'Trim pattern for the ' + PIECE_NAME[focus].toLowerCase() },
        [{ id: null, name: 'No trim' }].concat(D.trimPatterns).map((p, i) => {
          const on = (fo.pattern || null) === p.id;
          const cv = h('canvas.tr-thumb', { width: 96, height: 80 });
          paintThumb(cv, focus, Object.assign({}, fo, { pattern: p.id, material: p.id ? gm : null }));
          const b = h('button.tr-pat' + (on ? '.on' : '') + (p.id ? '.r-' + p.rarity : ''), { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': p.id ? patName(p.id) : 'No trim', 'data-focus': 'tr-pat-' + (p.id || 'none'),
            onclick: () => setField('pattern', p.id) },
          cv,
          h('span.tr-pat-foot', p.id ? h('span.tr-pat-ico', TH.icon.trim(p.id, { size: 20 })) : h('span.tr-pat-ico.none'), h('span.tr-pat-name', p.id ? short[i - 1] : 'No trim')),
          null);
          if (p.id) withTip(b, () => patternTipLines(p)); else withTip(b, ['No trim', 'Remove the trim from this piece']);
          return b;
        })));

    /* materials list: templates, duplication cost, trim materials (clean rows, no toggles) */
    const none = !M.trimmed;
    const row = (icon, text, qty, tipLines) => { const r = h('li.tr-mrow', h('span.tr-mico', icon), h('span.tr-mname', text), qty != null ? h('b.tr-mqty', '×' + qty) : null); return tipLines ? withTip(r, tipLines) : r; };
    const group = (label, rows) => h('div.tr-mgroup', h('div.tr-mlabel', label), h('ul.tr-mlist', rows));
    const mkids = [];
    if (none) mkids.push(h('p.tr-note', M.pcs.length ? 'No trims yet. Pick a pattern to see the templates and materials it needs.' : 'No pieces are shown. Show at least one piece to see what it needs.'));
    else {
      mkids.push(group('Templates', M.templates.map((t) => row(TH.icon(t.icon, { size: 24 }), patName(t.id), t.qty, () => patternTipLines(t.data)))));
      if (M.copies) mkids.push(group('Duplication', [row(TH.icon('diamond', { size: 24 }), itemName('diamond', 'Diamond'), M.diamonds, [M.copies + ' extra cop' + (M.copies === 1 ? 'y' : 'ies'), M.copies + ' × ' + D.templateCopyDiamonds + ' diamonds'])]
        .concat(M.dupes.map((r) => row(TH.icon(r.icon, { size: 24 }), r.name, r.qty)))));
      mkids.push(group('Trim materials', M.ingredients.map((r) => row(TH.icon(r.icon, { size: 24 }), r.item, r.qty))));
    }
    const mats = h('section.panel.tr-card.tr-mats', { 'aria-label': 'Materials needed' },
      h('div.tr-card-head', h('h3', 'Materials'), h('button.btn.small', { type: 'button', disabled: none, onclick: () => copyText(materialsText(st, M)) }, 'Copy list')),
      mkids);

    const right = h('div.tr-right', browser, mats);

    root.append(
      h('div.page-head.tr-head',
        h('div.tr-title', h('h2', 'Armor trims'), h('p', 'Preview, compare and cost out armor trims.'))),
      h('div.tr-layout', h('div.tr-col.a', hud, skinBox), h('div.tr-col.b', viewer), right));

    /* every native title= becomes the app tooltip (one coherent style) */
    root.querySelectorAll('[title]').forEach((el) => { const t = el.getAttribute('title'); el.removeAttribute('title'); if (t) withTip(el, [t]); });

    // after the new DOM is in the page: attach the persistent 3D canvas, push state into it, run entrances
    V.el.setAttribute('aria-label', '3D preview. ' + PIECES.filter((p) => st.outfit[p].show).map((p) => armorName(p, st.outfit[p].armor) + (st.outfit[p].pattern ? ' with ' + patName(st.outfit[p].pattern) : '')).join(', ') + '. Drag to rotate, scroll to zoom, double-click to reset.');
    V.init().then(() => { const s = stage.querySelector('.tr-loadingv'); if (s) s.remove(); V.wake(); }).catch(() => { stage.replaceChildren(h('div.tr-error', V.error || 'The 3D viewer could not start.', h('br'), h('span', 'The flat previews still work.'))); });
    syncViewer(st);
    const rv = pendingReveal; pendingReveal = null;
    if (rv && TH.util.reveal) requestAnimationFrame(() => {
      if (rv.has('gallery')) TH.util.reveal(root.querySelector('.tr-grid'), { step: 0.025, max: 18 });
      if (rv.has('chooser') && root.querySelector('.tr-choose')) TH.util.reveal(root.querySelector('.tr-choose'), { step: 0.04 });
      if (rv.has('saved')) TH.util.reveal(root.querySelector('.tr-saved-list'), { step: 0.04 });
    });
  }

  /** Fill a thumbnail canvas with the flat front view of the piece (sync if cached, otherwise when loaded). */
  function paintThumb(cv, piece, o) {
    const draw = (src) => {
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height);
      x.imageSmoothingEnabled = false;
      const s = Math.max(1, Math.floor(Math.min((cv.width - 8) / src.width, (cv.height - 8) / src.height)));
      const w = src.width * s, hh = src.height * s;
      x.drawImage(src, 0, 0, src.width, src.height, Math.round((cv.width - w) / 2), Math.round((cv.height - hh) / 2), w, hh);
    };
    thumb(piece, o).then((src) => { if (cv.isConnected !== false) draw(src); }).catch(() => { cv.classList.add('err'); });
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
      markReveal('saved');
      upd((s) => {
        const id = uid('outfit');
        s.saved.push({ id, name, outfit: Object.fromEntries(PIECES.map((p) => [p, clonePiece(s.outfit[p])])), skin: s.skin.kind === 'file' ? null : { kind: s.skin.kind, name: s.skin.name, slim: s.skin.slim, data: s.skin.data }, updated: Date.now() });
        s.savedId = id; s.saveName = '';
      });
      toast('Saved “' + name + '”');
    }
    const cards = st.saved.map((g) => {
      const active = st.savedId === g.id;
      if (st.renaming === g.id) {
        const rn = h('input.field', { type: 'text', maxlength: 40, value: st.renameText, 'aria-label': 'New name', 'data-focus': 'tr-rename',
          oninput: (e) => upd((s) => { s.renameText = e.target.value; }, { silent: true }),
          onkeydown: (e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') upd((s) => { s.renaming = null; }); } });
        const commit = () => upd((s) => { const x = s.saved.find((y) => y.id === g.id); if (x) x.name = (s.renameText || '').trim() || x.name; s.renaming = null; });
        return h('div.tr-schip.editing', rn, h('button.btn.small.primary', { type: 'button', onclick: commit }, 'OK'), h('button.btn.small.ghost', { type: 'button', onclick: () => upd((s) => { s.renaming = null; }) }, '✕'));
      }
      const trimmedN = PIECES.filter((p) => g.outfit[p] && g.outfit[p].show !== false && g.outfit[p].pattern).length;
      return h('div.tr-schip' + (active ? '.active' : ''),
        h('button.tr-saved-main', { type: 'button', 'aria-pressed': String(active), title: 'Load ' + g.name + ' (' + trimmedN + ' trimmed)', 'data-focus': 'tr-saved-' + g.id,
          onclick: () => { markReveal('gallery'); upd((s) => {
            const x = s.saved.find((y) => y.id === g.id); if (!x) return;
            PIECES.forEach((p) => { if (x.outfit[p]) s.outfit[p] = clonePiece(x.outfit[p]); });
            if (x.skin && x.skin.kind) s.skin = Object.assign({ name: '', data: null, slim: false }, x.skin);
            s.savedId = g.id;
          }); toast('Loaded “' + g.name + '”'); } }, g.name),
        h('button.x-btn', { type: 'button', title: 'Rename', 'aria-label': 'Rename ' + g.name, onclick: () => upd((s) => { s.renaming = g.id; s.renameText = g.name; }) }, '✎'),
        h('button.x-btn', { type: 'button', title: 'Delete', 'aria-label': 'Delete ' + g.name, onclick: () => { upd((s) => { s.saved = s.saved.filter((y) => y.id !== g.id); if (s.savedId === g.id) s.savedId = null; }); } }, '✕'));
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
