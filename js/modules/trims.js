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
 *   glint: false,                             // enchantment glint on the armor (3D view only)
 *   elytra: false,                            // wear an elytra instead of the chestplate (3D view only)
 *   lastMaterial: 'quartz',                   // trim material used when a pattern is picked on a bare piece (quartz = default)
 *   sync: false,                              // "same for all": every edit goes to all pieces
 *   skin: { kind: 'steve'|'alex'|'name'|'file', name, data (dataURL), slim },   ('name'/'file' = the Player key)
 *   player: null | the last player skin while Steve/Alex is shown (same shape),
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
    skin: { kind: 'steve', name: '', data: null, slim: false }, player: null,
    saved: [], savedId: null, saveName: '', renaming: null, renameText: '', backdrop: 'studio', studioColor: '',
  });

  /* Preview backdrops: a CSS sky on the stage + (except studio) an 8x8 voxel island of real blocks under the player (genTerrain, seeded per backdrop). */
  const BACKDROPS = [
    { id: 'studio', name: 'Studio' },
    { id: 'plains', name: 'Plains', seed: 13, icon: 'block/grass_block_side' },
    { id: 'nether', name: 'Nether', seed: 5, icon: 'block/netherrack' },
    { id: 'end', name: 'The End', seed: 11, icon: 'block/end_stone' },
    { id: 'deepdark', name: 'Deep Dark', seed: 13, icon: 'block/sculk' },
  ];
  const ANIMS = [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['jump', 'Jump'], ['sneak', 'Sneak'], ['mine', 'Mine'], ['fight', 'Fight'], ['swim', 'Swim'], ['fly', 'Fly']];

  /* Skin kinds: 'name' (username lookup) and 'file' (upload) are the "Player" key, 'steve' / 'alex' the defaults. */
  const isPlayer = (k) => k === 'name' || k === 'file';
  const DEFAULT_SKIN = (k) => ({ kind: k, name: '', data: null, slim: k === 'alex' });
  /** Replace the active skin; a player skin being replaced by a default is stashed in s.player, a new player skin clears the stash. */
  function setSkin(s, next) {
    if (isPlayer(next.kind)) s.player = null;
    else if (isPlayer(s.skin.kind) && s.skin.data) s.player = Object.assign({}, s.skin);
    s.skin = next;
  }

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
    st.glint = !!st.glint;
    if (!ANIMS.some((a) => a[0] === st.anim)) st.anim = 'idle';
    if (!BACKDROPS.some((b) => b.id === st.backdrop)) st.backdrop = 'studio';
    if (typeof st.studioColor !== 'string') st.studioColor = '';
    const sk = st.skin && typeof st.skin === 'object' ? st.skin : (st.skin = {});
    if (!['steve', 'alex', 'name', 'file'].includes(sk.kind)) sk.kind = 'steve';
    if (typeof sk.name !== 'string') sk.name = '';
    if (typeof sk.data !== 'string') sk.data = null;
    if (isPlayer(sk.kind) && !sk.data) sk.kind = 'steve';   // a player skin without pixels cannot be shown
    // Steve / Alex have a fixed arm model (Classic / Slim is disabled for them); player skins keep the user's choice
    sk.slim = sk.kind === 'steve' ? false : sk.kind === 'alex' ? true : typeof sk.slim === 'boolean' ? sk.slim : false;
    // st.player = the last player skin, stashed while Steve / Alex is shown so "Player" can bring it back (null when none
    // or when the player skin is the active one, so the PNG is never stored twice). Old saves have no field -> null.
    const pl = st.player;
    st.player = !isPlayer(sk.kind) && pl && typeof pl === 'object' && isPlayer(pl.kind) && typeof pl.data === 'string'
      ? { kind: pl.kind, name: typeof pl.name === 'string' ? pl.name : '', data: pl.data, slim: !!pl.slim } : null;
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

  /* Flat front views for the pattern rows. Every piece is drawn into the same 16x32 "player front" space (head 4..12 x
     0..8, torso 4..12 x 8..20, arms 0..4 / 12..16, legs 4..8 / 8..12 x 20..32), cut out with a FIXED crop box per piece
     (from the armor layer UVs, wide enough for every material) and centred on one 16x16 square. All four pieces then share
     one pixel scale, so a helmet is exactly as big next to a chestplate as it is on the player. */
  const THUMB_UNITS = 16;
  const CROP = { helmet: [4, 0, 8, 8], chestplate: [0, 8, 16, 12], leggings: [4, 15, 8, 14], boots: [4, 26, 8, 6] };
  function frontView(tex, piece) {
    const c = mkCanvas(16, 32), x = c.getContext('2d');
    const flip = (sx, sy, w, hh, dx, dy) => { x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(tex, sx, sy, w, hh, 0, 0, w, hh); x.restore(); };
    if (piece === 'helmet') x.drawImage(tex, 8, 8, 8, 8, 4, 0, 8, 8);
    else if (piece === 'chestplate') { x.drawImage(tex, 44, 20, 4, 12, 0, 8, 4, 12); x.drawImage(tex, 20, 20, 8, 12, 4, 8, 8, 12); flip(44, 20, 4, 12, 12, 8); }
    else if (piece === 'leggings') { x.drawImage(tex, 20, 20, 8, 12, 4, 8, 8, 12); x.drawImage(tex, 4, 20, 4, 12, 4, 20, 4, 12); flip(4, 20, 4, 12, 8, 20); }
    else { x.drawImage(tex, 4, 20, 4, 12, 4, 20, 4, 12); flip(4, 20, 4, 12, 8, 20); }
    const [cx, cy, cw, ch] = CROP[piece];
    const out = mkCanvas(THUMB_UNITS, THUMB_UNITS);
    out.getContext('2d').drawImage(c, cx, cy, cw, ch, (THUMB_UNITS - cw) >> 1, (THUMB_UNITS - ch) >> 1, cw, ch);
    return out;
  }
  /* Inventory sprite of the worn piece (the big icon in the Armor rows): leather is dyed like the game does, and the
     item trim overlay (trims/items/<piece>_trim) is palette-swapped in the trim material. */
  const spriteCache = new Map();
  const itemSprite = (piece, o) => memo(spriteCache, [piece, o.armor, o.armor === 'leather' ? o.dye || '' : '', o.pattern ? paletteName(o.armor, o.material) : ''].join('|'), async () => {
    const id = armorItemId(piece, o.armor);
    const base = await loadTex('item/' + id);
    const c = mkCanvas(16, 16), x = ctxOf(c);
    x.imageSmoothingEnabled = false;
    x.drawImage(base, 0, 0, 16, 16, 0, 0, 16, 16);
    if (ARMOR[o.armor].dyeable) {
      const rgb = hex2rgb(o.dye || D.leatherDefault), im = x.getImageData(0, 0, 16, 16), d = im.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * rgb[0] / 255; d[i + 1] = d[i + 1] * rgb[1] / 255; d[i + 2] = d[i + 2] * rgb[2] / 255; }
      x.putImageData(im, 0, 0);
      try { x.drawImage(await loadTex('item/' + id + '_overlay'), 0, 0, 16, 16, 0, 0, 16, 16); } catch (e) { /* overlay is a bonus */ }
    }
    if (o.pattern && o.material && o.armor !== 'turtle') {
      try {
        const [mask, key, colors] = await Promise.all([loadTex('trims/items/' + piece + '_trim'), palette('trim_palette'), palette(paletteName(o.armor, o.material))]);
        const t = mkCanvas(16, 16), tx = ctxOf(t);
        tx.drawImage(mask, 0, 0, 16, 16, 0, 0, 16, 16);
        const im = tx.getImageData(0, 0, 16, 16), d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          let best = 0, bd = 1e9;
          key.forEach((kc, n) => { const dd = Math.abs(kc[0] - d[i]); if (dd < bd) { bd = dd; best = n; } });
          const col = colors[Math.min(best, colors.length - 1)];
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
        }
        tx.putImageData(im, 0, 0);
        x.drawImage(t, 0, 0);
      } catch (e) { /* the plain sprite is fine */ }
    }
    return c;
  });
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
  /* Successful username lookups are cached in localStorage (name -> { uuid, model, data }) so repeated loads never hit the
     rate-limited APIs again. Separate from the app state on purpose: it is a disposable cache, a few KB per skin, max 8. */
  const SKIN_CACHE = 'th.trims.skins.v1', SKIN_TTL = 6 * 3600e3, SKIN_MAX = 8;
  const skinCacheAll = () => { try { const o = JSON.parse(localStorage.getItem(SKIN_CACHE) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const skinCacheGet = (name) => { const e = skinCacheAll()[name.toLowerCase()]; return e && e.data && Date.now() - (e.t || 0) < SKIN_TTL ? e : null; };
  function skinCachePut(name, entry) {
    try {
      const all = skinCacheAll();
      all[name.toLowerCase()] = Object.assign({ t: Date.now() }, entry);
      Object.keys(all).sort((x, y) => all[y].t - all[x].t).slice(SKIN_MAX).forEach((k) => { delete all[k]; });
      localStorage.setItem(SKIN_CACHE, JSON.stringify(all));
    } catch (e) { /* storage full / blocked: the cache is a bonus */ }
  }
  const notFoundErr = (name) => { const e = new Error('No Minecraft account named ' + name + '.'); e.notFound = true; return e; };
  /** JSON from a URL regardless of the status code (playerdb answers unknown names with 400 + a JSON body). */
  const anyJson = async (url, ms, what) => {
    const r = await withTimeout(fetch(url, { mode: 'cors', headers: { Accept: 'application/json' } }), ms, what);
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    return { status: r.status, j };
  };
  /** The textures property of a Mojang profile (base64 JSON) -> { url, model }. */
  function decodeTextures(props) {
    try {
      const pr = (props || []).find((x) => x && x.name === 'textures') || (props || [])[0];
      if (!pr || !pr.value) return null;
      const t = JSON.parse(atob(pr.value)), sk = t && t.textures && t.textures.SKIN;
      if (!sk) return null;
      return { url: sk.url || null, model: sk.metadata && sk.metadata.model === 'slim' ? 'slim' : 'classic' };
    } catch (e) { return null; }
  }
  /**
   * Username -> skin. 1) playerdb.co: uuid + the profile's textures property (skin URL, `model: slim`).
   * 2) the skin PNG by uuid from CORS-friendly mirrors: crafthead, crafatar, mc-heads, then textures.minecraft.net itself
   *    (often no CORS), then minotar by name. 3) Only if all of that fails: ashcon.app (429 = Mojang rate limit, skipped
   *    quietly), then name-based mirrors. Images load with crossOrigin=anonymous so the canvas / WebGL stay untainted.
   * The arm model comes from the profile when known, otherwise from the pixels. Returns { canvas, slim, via, uuid }.
   */
  async function fetchNamedSkin(name) {
    const cached = skinCacheGet(name);
    if (cached) {
      try {
        const r = skinFromImage(await loadImg(cached.data));
        if (cached.model) r.slim = cached.model === 'slim';
        return Object.assign(r, { via: 'cache', uuid: cached.uuid });
      } catch (e) { /* stale entry: look it up again */ }
    }
    const n = encodeURIComponent(name), T = 7000;
    const img = (url) => withTimeout(loadImg(url), T, url);
    let uuid = null, model = null, texUrl = null;
    try {
      const { j } = await anyJson('https://playerdb.co/api/player/minecraft/' + n, T, 'playerdb');
      const pl = j && j.data && j.data.player;
      if (j && j.code === 'player.found' && pl) {
        uuid = pl.raw_id || String(pl.id || '').replace(/-/g, '') || null;
        texUrl = pl.skin_texture || null;
        const tx = decodeTextures(pl.properties);
        if (tx) { texUrl = tx.url || texUrl; model = tx.model; }
      } else if (j && /invalid_username|not_found|notfound|unknown/i.test(String(j.code || ''))) throw notFoundErr(name);
    } catch (e) { if (e && e.notFound) throw e; }
    const https = (u) => String(u).replace(/^http:/, 'https:');
    const finish = (r, via) => {
      if (model) r.slim = model === 'slim';
      r.via = via; r.uuid = uuid;
      skinCachePut(name, { uuid, model: model || (r.slim ? 'slim' : 'classic'), data: r.canvas.toDataURL('image/png') });
      return r;
    };
    const tryImages = async (list) => {
      for (const [via, url] of list) {
        try { return finish(skinFromImage(await img(url)), via); } catch (e) { /* next mirror */ }
      }
      return null;
    };
    let r = null;
    if (uuid) {
      const list = [['crafthead', 'https://crafthead.net/skin/' + uuid], ['crafatar', 'https://crafatar.com/skins/' + uuid], ['mc-heads', 'https://mc-heads.net/skin/' + uuid]];
      if (texUrl) list.push(['mojang', https(texUrl)]);
      list.push(['minotar', 'https://minotar.net/skin/' + n]);
      r = await tryImages(list);
      if (r) return r;
    }
    // late fallback: ashcon (a 429 here only means Mojang rate-limited it)
    let ashconMissing = false;
    try {
      const { status, j } = await anyJson('https://api.ashcon.app/mojang/v2/user/' + n, T, 'ashcon');
      if (status === 404) ashconMissing = true;
      const sk = status === 200 && j && j.textures && j.textures.skin;
      if (sk) {
        if (!uuid && j.uuid) uuid = String(j.uuid).replace(/-/g, '');
        if (!model && j.textures.slim != null) model = j.textures.slim ? 'slim' : 'classic';
        r = await tryImages(sk.data ? [['ashcon', 'data:image/png;base64,' + sk.data]] : sk.url ? [['ashcon', https(sk.url)]] : []);
        if (r) return r;
      }
    } catch (e) { /* quiet */ }
    if (ashconMissing && !uuid) throw notFoundErr(name);
    if (!uuid) {
      r = await tryImages([['mc-heads', 'https://mc-heads.net/skin/' + n], ['minotar', 'https://minotar.net/skin/' + n], ['crafthead', 'https://crafthead.net/skin/' + n]]);
      if (r) return r;
    }
    throw new Error('Could not load ' + name + '’s skin right now (the skin services did not answer). Try again later or upload the PNG.');
  }

  /** Cheap fingerprint of a data URL (length + a few sampled chars) so two uploads of the same size still differ. */
  const dataSig = (d) => { d = d || ''; let a = d.length; for (let i = 0; i < d.length; i += 97) a = (a * 31 + d.charCodeAt(i)) | 0; return a; };
  const skinCache = new Map();
  async function resolveSkin(sk) {
    if (sk.kind === 'steve') return { canvas: skinFromImage(await loadTex('entity/player/wide/steve')).canvas, slim: false };
    if (sk.kind === 'alex') return { canvas: skinFromImage(await loadTex('entity/player/slim/alex')).canvas, slim: true };
    const key = sk.kind + '|' + dataSig(sk.data) + '|' + sk.name;
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

  /* ======================================================================
   * Backdrop terrain: a deterministic 8x8 voxel island per backdrop. Pure data here (one quad bucket per texture,
   * shared faces culled); V turns each bucket into one mesh. 1 block = 16 units (1 skin px = 1 unit), feet at y = 0.
   * ====================================================================== */
  const TN = 8, BS = 16, TERR_CAM = { r: 78, p: 0.42, y: 30 };   // camera framing while an island is shown (see place())
  const hash = (s, a, b) => {
    let x = Math.imul(s + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 101, 0xc2b2ae35) ^ Math.imul(b + 37, 0x27d4eb2f);
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  };
  const vnoise = (s, x, z, f) => {   // value noise, lattice every f cells, smoothstepped
    const gx = x / f + 0.5, gz = z / f + 0.5, ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
    const n = (p, q) => hash(s, ix + p, iz + q);
    return (n(0, 0) * (1 - a) + n(1, 0) * a) * (1 - b) + (n(0, 1) * (1 - a) + n(1, 1) * a) * b;
  };
  // blocks: [top, side, bottom] texture keys ('name#tint', layers joined by '+'); side / bottom default to top
  const TBLK = {
    grass: ['grass_block_top#91bd59', 'grass_block_side+grass_block_side_overlay#91bd59', 'dirt'], dirt: ['dirt'], stone: ['stone'], gravel: ['gravel'],
    rack: ['netherrack'], soul: ['soul_sand'], magma: ['magma'], quartz: ['nether_quartz_ore'], gold: ['nether_gold_ore'], nylium: ['crimson_nylium', 'crimson_nylium_side', 'netherrack'],
    endst: ['end_stone'], obsid: ['obsidian'],
    slate: ['deepslate_top', 'deepslate'], cobslate: ['cobbled_deepslate'], sculk: ['sculk'], catalyst: ['sculk_catalyst_top', 'sculk_catalyst_side', 'sculk_catalyst_bottom'],
  };
  const TGLOW = new Set(['magma']);   // light-emitting blocks: self-lit through an emissive map
  // per backdrop: fill(depth below the surface, cell) -> block; deco(cell, put) plants / decals on top; feat(pick, put) one-off accents
  const TERRA = {
    plains: {
      fill: (d, c) => d === 0 ? (c.n < 0.24 && c.r > 0.5 ? (c.h < 0.55 ? 'stone' : 'gravel') : 'grass') : d === 1 ? (c.n < 0.24 ? 'stone' : 'dirt') : c.v(d) < 0.18 ? 'dirt' : 'stone',
      deco: (c, put) => { if (c.top !== 'grass' || c.r < 0.55) return; if (c.h2 < 0.22) put.cross('short_grass#91bd59', c); else if (c.h2 < 0.32) put.cross(['poppy', 'dandelion', 'cornflower'][Math.floor(c.h * 3)], c); },
    },
    nether: {
      fill: (d, c) => d === 0 ? (c.n < 0.22 ? 'soul' : c.n > 0.74 ? 'nylium' : c.h < 0.13 && c.r > 0.45 ? 'magma' : 'rack') : c.v(d) < 0.1 ? 'quartz' : c.v(d) < 0.14 ? 'gold' : 'rack',
      deco: (c, put) => { if (c.top === 'nylium' && c.r > 0.55) { if (c.h2 < 0.35) put.cross('crimson_roots', c); else if (c.h2 < 0.47) put.cross('crimson_fungus', c); } },
    },
    end: {
      fill: () => 'endst',
      feat: (pick, put) => {
        pick((c) => c.r > 0.7 && c.back && c.t >= 0, 1, (c) => { put.block(c, 1, 'obsid'); put.block(c, 2, 'obsid'); });   // a broken obsidian pillar stub on the rim
        pick((c) => c.r > 0.5 && c.r < 0.85 && c.back, 2, (c) => { put.box(c, 1, 'chorus_plant', [3, 0, 3, 13, 16, 13]); put.box(c, 2, 'chorus_flower', [2, 0, 2, 14, 12, 14]); });
      },
    },
    deepdark: {
      fill: (d, c) => d === 0 ? (c.n > 0.36 ? 'sculk' : c.h < 0.14 ? 'cobslate' : 'slate') : d === 1 ? (c.n > 0.82 ? 'sculk' : 'slate') : c.v(d) < 0.12 ? 'cobslate' : 'slate',
      deco: (c, put) => { if (c.top === 'slate' && c.r > 0.5 && c.h2 < 0.5) put.decal('sculk_vein', c); },
      feat: (pick, put) => {
        pick((c) => c.top === 'sculk' && c.r > 0.55 && c.back, 3, (c) => { put.box(c, 1, ['sculk_sensor_top', 'sculk_sensor_side', 'sculk_sensor_bottom'], [0, 0, 0, 16, 8, 16]); put.cross('sculk_sensor_tendril_inactive', c, 0.5); });
        pick((c) => c.r > 0.78 && c.top !== 'sculk', 4, (c) => put.swap(c, 'catalyst'));
      },
    },
  };
  // tall accents only go in .back: the half facing away from the default camera (HOME yaw 0.55), so they never hide the player
  // faces: normal, unit-cube corners BL BR TR TL seen from outside (u runs BL->BR, v BL->TL), texture slot (0 top, 1 side, 2 bottom)
  const TFACES = [
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 1], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 1],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 0], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 2],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 1], [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], 1],
  ];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const terrCache = new Map();
  /** { buckets: Map(key -> { tex, dbl, p, n, u, i }), tris } for one backdrop (memoised: it never changes). */
  function genTerrain(id, seed) {
    const ck = id + seed;
    if (terrCache.has(ck)) return terrCache.get(ck);
    const R = TERRA[id], half = TN / 2, cols = [], solid = new Set(), buckets = new Map(), at = (i, k, j) => i + ',' + k + ',' + j;
    // 1) heightmap: flat around the feet, rising behind the player and dropping towards the default camera (a diorama slope); the rim crumbles away in an ordered dither
    for (let i = 0; i < TN; i++) for (let j = 0; j < TN; j++) {
      const r = Math.hypot(i + 0.5 - half, j + 0.5 - half) / half, h = hash(seed, i, j), keep = Math.min(1, Math.max(0, (1.12 - r) / 0.4));
      if (keep < BAYER[(j & 3) * 4 + (i & 3)] * 0.7 + h * 0.3) continue;
      const n = vnoise(seed + 1, i, j, 3), sd = ((i + 0.5 - half) * 0.52 + (j + 0.5 - half) * 0.85) / half;   // sd < 0: the side away from the default camera
      let t = 0;
      if (r > 0.45) { t = Math.max(-2, Math.min(1, Math.round(-sd * r * 1.6 + (n - 0.5) * 1.8))); if (keep < 1 && h < 0.4) t--; }
      const c = { i, j, r, t, h, back: sd < -0.12, h2: hash(seed + 2, i, j), n: vnoise(seed + 3, i, j, 2.5), v: (d) => hash(seed + 10 + d, i, j), blk: {} };
      const b = Math.min(t - 1, -1 - Math.floor((1.1 - r) * 2.6 + hash(seed + 4, i, j)));   // the underside tapers like a floating island
      for (let k = t; k > b; k--) { c.blk[k] = R.fill(t - k, c); solid.add(at(i, k, j)); }
      c.top = c.blk[t];
      cols.push(c);
    }
    // 2) decorations + one-off features (a feature clears the cell's decorations)
    const extra = [];
    const put = {
      cross: (tex, c, y0) => extra.push({ c, k: c.t + 1, cross: tex, y0: y0 || 0 }),
      decal: (tex, c) => extra.push({ c, k: c.t, decal: tex }),
      block: (c, up, blk) => { c.blk[c.t + up] = blk; solid.add(at(c.i, c.t + up, c.j)); },
      box: (c, up, tex, e) => extra.push({ c, k: c.t + up, box: Array.isArray(tex) ? tex : [tex], e }),
      swap: (c, blk) => { c.blk[c.t] = c.top = blk; },
    };
    if (R.deco) cols.forEach((c) => R.deco(c, put));
    const taken = new Set();
    if (R.feat) R.feat((ok, salt, fn) => {
      let best = null, bv = -1;
      cols.forEach((c) => { const v = hash(seed + 50 + salt, c.i, c.j); if (!taken.has(c) && ok(c) && v > bv) { bv = v; best = c; } });
      if (!best) return;
      taken.add(best);
      for (let x = extra.length - 1; x >= 0; x--) if (extra[x].c === best) extra.splice(x, 1);
      fn(best);
    }, put);
    // 3) faces
    const bucket = (tex, dbl) => {
      const key = tex + (dbl ? '|2' : '');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { tex, dbl: !!dbl, p: [], n: [], u: [], i: [] }));
      return b;
    };
    const quad = (b, pts, nrm, uv) => {
      const o = b.p.length / 3;
      pts.forEach((q, x) => { b.p.push(q[0], q[1], q[2]); b.n.push(nrm[0], nrm[1], nrm[2]); b.u.push(uv[x][0], uv[x][1]); });
      b.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const origin = (c, k) => [(c.i - half) * BS, (k - 1) * BS, (c.j - half) * BS];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cube = (c, k, texs, e, cull) => {   // e = box extents in px (0..16); uv crops like Minecraft's auto-UV
      const o = origin(c, k), ex = e ? e.map((v) => v / 16) : [0, 0, 0, 1, 1, 1];
      TFACES.forEach(([nrm, cs, slot]) => {
        if (cull && solid.has(at(c.i + nrm[0], k + nrm[1], c.j + nrm[2]))) return;
        const bl = cs[0], rt = cs[1].map((v, x) => v - bl[x]), up = cs[3].map((v, x) => v - bl[x]);
        const pts = cs.map((q) => q.map((v, x) => ex[x] + (ex[x + 3] - ex[x]) * v));
        quad(bucket(texs[slot] || texs[1] || texs[0]), pts.map((q) => [o[0] + q[0] * BS, o[1] + q[1] * BS, o[2] + q[2] * BS]), nrm,
          pts.map((q) => { const d = q.map((v, x) => v - bl[x]); return [dot(d, rt), dot(d, up)]; }));
      });
    };
    cols.forEach((c) => Object.keys(c.blk).forEach((k) => cube(c, +k, TBLK[c.blk[k]], null, true)));
    extra.forEach((x) => {
      const o = origin(x.c, x.k);
      if (x.box) cube(x.c, x.k, x.box, x.e, false);
      else if (x.decal) { const y = o[1] + BS + 0.15; quad(bucket(x.decal), [[o[0], y, o[2] + BS], [o[0] + BS, y, o[2] + BS], [o[0] + BS, y, o[2]], [o[0], y, o[2]]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); }
      else {   // cross plant: two diagonal double-sided quads, lit as if facing up (flat, like in game); y0 = start height (tendrils sit on a half block)
        const b = bucket(x.cross, true), y0 = o[1] + x.y0 * BS, y1 = o[1] + BS, v = 1 - x.y0;
        [[[0, 0], [1, 1]], [[1, 0], [0, 1]]].forEach(([a, z]) => quad(b, [[o[0] + a[0] * BS, y0, o[2] + a[1] * BS], [o[0] + z[0] * BS, y0, o[2] + z[1] * BS], [o[0] + z[0] * BS, y1, o[2] + z[1] * BS], [o[0] + a[0] * BS, y1, o[2] + a[1] * BS]], [0, 1, 0], [[0, 0], [1, 0], [1, v], [0, v]]));
      }
    });
    let tris = 0;
    buckets.forEach((b) => { tris += b.i.length / 3; });
    const T = { buckets, tris };
    terrCache.set(ck, T);
    return T;
  }
  /** 16x16 canvas for a terrain texture key: layers drawn in order, '#rrggbb' multiplies a layer (biome tint); animated strips use frame 0. */
  const terrTexCache = new Map();
  const terrainCanvas = (key) => memo(terrTexCache, key, async () => {
    const c = mkCanvas(16, 16), x = ctxOf(c);
    for (const layer of key.split('+')) {
      const [name, tint] = layer.split('#'), img = await loadTex('block/' + name), l = mkCanvas(16, 16), lx = ctxOf(l);
      lx.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);
      if (tint) {
        const rgb = hex2rgb('#' + tint), im = lx.getImageData(0, 0, 16, 16), d = im.data;
        for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * rgb[0] / 255; d[i + 1] = d[i + 1] * rgb[1] / 255; d[i + 2] = d[i + 2] * rgb[2] / 255; }
        lx.putImageData(im, 0, 0);
      }
      x.drawImage(l, 0, 0);
    }
    return c;
  });

  const V = (function () {
    const el = h('div.tr-canvas', { tabindex: 0, role: 'img', 'aria-label': '3D preview of the armor outfit. Drag to rotate, scroll to zoom, double-click to reset.' });
    const S = {
      el, ready: false, error: null, renderer: null, scene: null, camera: null, player: null, slim: null,
      pieces: {}, bones: null, rig: null, rigRoot: null, skinMeshes: null, pose: newPose(), from: newPose(), tgt: newPose(), blend: 1, anim: 'idle', animT: 0, age: 0, limb: 0, amt: 0, wing: wingTarget({}), wings: null, elytraOn: false, camK: 1, camY: 16.5, bdCam: null, shadow: null, target: null, key: null,
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
      S.camera = new THREE.PerspectiveCamera(28, 1, 10, 900);
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
        const meshes = armorParts[p].map((part) => {
          const mesh = bonedMesh(part, 64, 32, m), [bx, by, bz, w, hh, d] = part.box, pv = PIV[part.bone];
          mesh.visible = false;
          mesh.userData.c = [bx + w / 2 - pv[0], by + hh / 2 - pv[1], bz + d / 2 - pv[2]];   // box centre in bone space (the pop scales around it)
          return mesh;
        });
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
    function terrFit(r) {
      const t = Math.tan((S.camera.fov * Math.PI) / 360), aspect = Math.max(0.2, S.w / Math.max(1, S.h));
      return r / Math.sin(Math.atan(t * Math.min(1, aspect)));
    }
    function place() {
      if (!S.camera) return;
      const B = S.bdCam || { r: 0, p: 0, y: 0 };   // a terrain island: back + up until its bounding sphere (radius r) fits the frame
      const d = fit() * S.camK / S.zoom, pitch = S.pitch + B.p, cp = Math.cos(pitch);
      if (S.onZoom && S.lastZ !== S.zoom) { S.lastZ = S.zoom; S.onZoom(S.zoom); }
      S.target.y = S.camY;   // always look at the figure, whatever the backdrop (the island sits under it)
      S.camera.position.set(S.target.x + d * Math.sin(S.yaw) * cp, S.target.y + d * Math.sin(pitch), S.target.z + d * Math.cos(S.yaw) * cp);
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
      if (S.glintOn && S.glint && !reduced()) { tickGlint(); moving = true; }
      if (tickFx(performance.now())) moving = true;
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
    S.zoomTo = (z) => { S.zoom = clamp(z, ZMIN, ZMAX); S.goal = null; S.dirty = true; wake(); };
    S.zoomBy = (f) => S.zoomTo(S.zoom * f);
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
    /* ---- change feedback: the piece that changed pops (scales ~6% around its own centre and settles) with a short
       white shimmer, ~260ms. Several pieces at once cascade top to bottom. Skipped under reduced motion. ---- */
    const FX_MS = 260;
    S.fx = {};
    function fxApply(pc, k, e) {
      const set = (m) => { const c = m.userData.c; m.scale.setScalar(k); m.position.set(c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)); };
      pc.meshes.forEach(set);
      if (pc.gl) pc.gl.forEach(set);
      pc.mat.emissive.setScalar(e);
    }
    function tickFx(now) {
      let any = false;
      PIECES.forEach((id) => {
        const f = S.fx[id];
        if (!f) return;
        const t = (now - f) / FX_MS, pc = S.pieces[id];
        if (t >= 1 || t < 0 || reduced()) { fxApply(pc, 1, 0); delete S.fx[id]; return; }
        fxApply(pc, 1 + 0.075 * Math.sin(Math.PI * t) * (1 - t * 0.35), 0.42 * (1 - t) * (1 - t));
        any = true;
      });
      return any;
    }
    S.setPiece = (piece, canvas, fx) => {
      if (!S.ready) return;
      S.appliedAt = performance.now();
      const p = S.pieces[piece];
      if (fx && canvas && !reduced()) S.fx[piece] = performance.now();
      p.src = canvas || null;
      if (!canvas) { p.meshes.forEach((m) => { m.visible = false; }); }
      else {
        p.mat.map = canvasTex(canvas);
        p.mat.needsUpdate = true;
        p.meshes.forEach((m) => { m.visible = true; });
      }
      applyGlint(piece);
      S.dirty = true; wake();
    };
    /* ---- enchantment glint = vanilla 1.21 worn-armor glint (RenderType armorEntityGlint): ONE extra pass per armor mesh
       with textures/misc/enchanted_glint_armor.png and TextureTransform ENTITY_GLINT_TEXTURING = setupGlintTexturing(0.16):
       texCoord = translate(-f, g) * rotateZ(PI/18) * scale(0.16) * armorUV, t = millis * glintSpeed (0.5) * 8,
       f = (t % 110000) / 110000 (27.5s per texture width), g = (t % 30000) / 30000 (7.5s per height). So the whole 64x32
       armor sheet spans only 0.16 of the glint: big soft bands, not fine stripes (x8 / two layers at -50/10deg was the
       pre-1.17 item glint). glint.fsh outputs rgb * GlintAlpha (Glint Strength, default 0.75) and blends SRC_COLOR, ONE
       (alpha ZERO, ONE): the armor gains (0.75 tex)^2, untinted. Depth: vanilla uses depth EQUAL on the armor's own
       geometry; here a polygon offset over the same geometry, no depth write. Armor-transparent texels are cut by
       alphaTest on the armor's alpha (SRC_COLOR blending ignores alpha, so it must discard). UVs here have v up
       (flipY), which mirrors the rotation sign and the v scroll: three rotation +10deg, offset (-f, -g). ---- */
    const GLINT = { scale: 0.16, rot: Math.PI / 18, strength: 0.75, speed: 0.5 };
    const maskOf = new WeakMap();   // armor canvas -> alpha mask texture (the alphaMap reads the green channel)
    const maskTex = (c) => {
      let t = maskOf.get(c);
      if (t) return t;
      const m = mkCanvas(c.width, c.height), x = m.getContext('2d');
      x.drawImage(c, 0, 0);
      const im = x.getImageData(0, 0, m.width, m.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; }
      x.putImageData(im, 0, 0);
      t = new THREE.CanvasTexture(m);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      maskOf.set(c, t);
      return t;
    };
    function makeGlint(img) {
      const src = mkCanvas(img.width, img.height); src.getContext('2d').drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(src);
      t.wrapS = t.wrapT = 1000;   // RepeatWrapping
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(GLINT.scale, GLINT.scale); t.rotation = GLINT.rot;
      const texs = [t];
      // GlintAlpha as an sRGB colour: the sRGB-encoded output is then ~0.75 * tex, as in vanilla's non-linear framebuffer
      const k = new THREE.Color().setRGB(GLINT.strength, GLINT.strength, GLINT.strength, THREE.SRGBColorSpace);
      PIECES.forEach((id) => {
        const pc = S.pieces[id];
        pc.gmats = texs.map((tx) => new THREE.MeshBasicMaterial({
          map: tx, color: k, transparent: true, alphaTest: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
          blending: 5 /* CustomBlending */, blendEquation: 100 /* Add */, blendSrc: 202 /* SrcColor */, blendDst: 201 /* One */,
          blendSrcAlpha: 200 /* Zero */, blendDstAlpha: 201 /* One */, blendEquationAlpha: 100,
        }));
        pc.gl = [];
        pc.meshes.forEach((m) => pc.gmats.forEach((gm) => { const g = new THREE.Mesh(m.geometry, gm); g.renderOrder = 5; g.visible = false; g.userData.c = m.userData.c; g.scale.copy(m.scale); g.position.copy(m.position); m.parent.add(g); pc.gl.push(g); }));
      });
      S.glint = { texs };
      PIECES.forEach(applyGlint);
    }
    function applyGlint(id) {
      const pc = S.pieces[id];
      if (!S.glint || !pc.gl) return;
      const on = S.glintOn && !!pc.src;
      if (on) pc.gmats.forEach((m) => { const mk = maskTex(pc.src); if (m.alphaMap !== mk) { m.alphaMap = mk; m.needsUpdate = true; } });
      pc.gl.forEach((g) => { g.visible = on; });
    }
    function tickGlint() {
      const t = performance.now() * GLINT.speed * 8;
      S.glint.texs.forEach((tx) => { tx.offset.set(-(t % 110000) / 110000, -(t % 30000) / 30000); });
    }
    S.setGlint = (on, img) => {
      if (!S.ready) return;
      S.glintOn = !!on;
      if (S.glintOn && !S.glint && img) makeGlint(img);
      if (S.glint) { PIECES.forEach(applyGlint); tickGlint(); }
      S.onGlint && S.onGlint(S.glintOn);
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
    /* ---- backdrop terrain: one Lambert mesh per texture bucket of genTerrain(); old GPU buffers are freed on every switch ---- */
    S.setBackdrop = (T, canv) => {
      if (!S.ready) return;
      if (S.terrain) {
        S.scene.remove(S.terrain);
        if (!S.terrain.userData.lost) {   // buffers of a lost context died with it: deleting them only spams WebGL warnings
          S.terrain.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
          S.terrainTex.forEach((t) => t.dispose());
        }
        S.terrain = null; S.bdCam = null;
      }
      if (T) {
        const g = new THREE.Group(), texs = new Map();
        T.buckets.forEach((b) => {
          let t = texs.get(b.tex);
          if (!t) {
            t = new THREE.CanvasTexture(canv[b.tex]);
            t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
            texs.set(b.tex, t);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
          geo.setIndex(b.i);
          const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial(Object.assign({ map: t, alphaTest: 0.5, side: b.dbl ? THREE.DoubleSide : THREE.FrontSide }, TGLOW.has(b.tex) && { emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.6 })));
          m.renderOrder = -2;   // opaque terrain first, then the contact shadow (-1) on top, then the player
          g.add(m);
        });
        S.terrain = g; S.terrainTex = [...texs.values()]; S.bdCam = TERR_CAM;
        S.shadow.renderOrder = -1;
        S.scene.add(g);
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
      S.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.ready = false; if (S.terrain) S.terrain.userData.lost = true; });
      S.canvas.addEventListener('webglcontextrestored', () => { S.ready = true; S.sig = {}; S.skinSig = ''; S.dirty = true; S.onRestore && S.onRestore(); });
      return S;
    }).catch((e) => { S.error = S.error || 'Could not start the 3D viewer: ' + (e && e.message ? e.message : e); throw e; }));
    return S;
  })();


  /** Push the outfit + skin from state into the 3D scene (only what changed). */
  function syncViewer(st) {
    if (V.onElytra) V.onElytra(!!st.elytra);
    if (V.onGlint) V.onGlint(!!st.glint);
    V.init().then(() => {
      const skSig = JSON.stringify([st.skin.kind, st.skin.slim, dataSig(st.skin.data), st.skin.name]);
      if (skSig !== V.skinSig) {
        V.skinSig = skSig;
        resolveSkin(st.skin).then((r) => { if (V.skinSig === skSig) V.setSkin(r.canvas, st.skin.slim); })
          .catch(() => { V.skinSig = ''; toast('Could not load that skin — showing Steve'); upd((s) => { s.skin = { kind: 'steve', name: '', data: null, slim: false }; }); });
      }
      let order = 0;
      PIECES.forEach((p) => {
        const o = st.outfit[p], vis = o.show && !(p === 'chestplate' && st.elytra);   // an elytra replaces the chestplate (the chosen look is kept)
        const sig = vis ? pieceKey(p, o) : 'hidden';
        if (V.sig[p] === sig) return;
        const first = V.sig[p] === undefined;   // first fill (page load / context restore): no pop
        V.sig[p] = sig;
        if (!vis) { V.setPiece(p, null); return; }
        const delay = first || reduced() ? 0 : 45 * order++;   // several pieces at once: a quick top-to-bottom cascade
        pieceTexture(p, o).then((c) => {
          const go = () => { if (V.sig[p] === sig) V.setPiece(p, c, !first); };
          if (delay) setTimeout(go, delay); else go();
        }).catch(() => { toast('Could not load the ' + armorName(p, o.armor) + ' texture'); });
      });
      const bd = BACKDROPS.find((x) => x.id === st.backdrop) || BACKDROPS[0];
      if (V.sig.bd !== bd.id) {
        V.sig.bd = bd.id;
        if (!bd.seed) V.setBackdrop(null);
        else {
          const T = genTerrain(bd.id, bd.seed), keys = [...new Set([...T.buckets.values()].map((b) => b.tex))];
          Promise.all(keys.map(terrainCanvas)).then((cs) => { if (V.sig.bd === bd.id) V.setBackdrop(T, Object.fromEntries(keys.map((k, i) => [k, cs[i]]))); })
            .catch(() => { if (V.sig.bd === bd.id) V.setBackdrop(null); toast('Could not load the ' + bd.name + ' blocks'); });
        }
      }
      const gl = !!st.glint;
      if (V.glintOn !== gl || (gl && !V.glint)) {
        if (!gl) V.setGlint(false);
        else glintImg().then((img) => { if (cur().glint) V.setGlint(true, img); }).catch(() => { toast('Could not load the enchantment glint texture'); });
      }
      const ey = !!st.elytra, esig = 'e' + ey;
      if (V.sig.elytra !== esig) {
        V.sig.elytra = esig;
        if (!ey) V.setElytra(false);
        else elytraCanvas().then((c) => { if (V.sig.elytra === esig) V.setElytra(true, c); }).catch(() => { toast('Could not load the elytra texture'); });
      }
    }).catch(() => { /* error shown in the viewer panel */ });
  }
  const glintImg = () => loadTex('misc/enchanted_glint_armor');
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
   * Tooltips: the shared app tooltip (TH.util.tooltip). lines = [title, ...muted lines]
   * ====================================================================== */
  function withTip(el, lines) {
    const get = typeof lines === 'function' ? lines : () => lines;
    TH.util.tooltip(el, () => (get() || []).map((l, i) => h(i ? 'span.th-tooltip-sub' : 'span.th-tooltip-title', l)));
    return el;
  }
  /** Native title= becomes the app tooltip (one coherent style). */
  const tipTitles = (root) => root.querySelectorAll('[title]').forEach((el) => TH.util.tooltip(el));

  const pieceTipLines = (st, p) => {
    const o = st.outfit[p];
    const L = [armorName(p, o.armor)];
    L.push(o.pattern && o.material ? patName(o.pattern) + ' · ' + matName(o.material) : 'No trim');
    if (!o.show) L.push('Hidden in the preview');
    return L;
  };
  const rarityLabel = (r) => ({ common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' })[r] || '';
  const patternTipLines = (pat) => [patName(pat.id), templateTitle() + (pat.rarity ? ' · ' + rarityLabel(pat.rarity) : ''), 'Found in: ' + pat.source];
  const dupTipLines = (pat) => ['Duplicate the template', '1 template + ' + D.templateCopyDiamonds + ' ' + itemName('diamond', 'Diamond') + ' + 1 ' + blockName(pat), '= 2 templates'];

  /* ======================================================================
   * UI
   * ====================================================================== */
  let cssP = null, cssReady = false;
  function ensureCss() {
    if (!cssP) {
      // index.html links it statically (before style-neu.css, so the neumorphic overrides win): never append a second copy,
      // which would land after style-neu.css and beat it. On-demand loading stays for pages without the static link.
      const have = document.querySelector('link[rel="stylesheet"][href$="css/trims.css"]');
      if (have) {
        cssP = new Promise((res) => {
          const done = (ok) => { cssReady = true; res(ok); };
          if (have.sheet) return done(true);
          have.addEventListener('load', () => done(true), { once: true });
          have.addEventListener('error', () => done(false), { once: true });
          setTimeout(() => done(!!have.sheet), 4000); // a load that already failed never fires again
        });
        return cssP;
      }
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

  const sel = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); };
  const press = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
  /** Segment heading: title on the left, at most one quiet action group on the right. */
  const head = (title, ...right) => h('div.tr-card-head', h('h3', title), right.length ? h('div.tr-card-acts', right) : null);
  /** 7x7 pixel glyphs (CSS masks, currentColor). */
  const glyph = (n) => h('span.tr-vico.' + n, { 'aria-hidden': 'true' });

  /** Paint a 16x16 sprite canvas into `cv` (sync when cached). */
  function paintSprite(cv, piece, o) {
    const key = [piece, o.armor, o.dye, o.pattern, o.material].join('|');
    if (cv._key === key) return;
    cv._key = key;
    itemSprite(piece, o).then((src) => {
      if (cv._key !== key) return;
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height); x.imageSmoothingEnabled = false;
      x.drawImage(src, 0, 0, cv.width, cv.height);
      cv.classList.remove('err');
    }).catch(() => { if (cv._key === key) cv.classList.add('err'); });
  }

  /** Small popover menu under `btn`. getItems() -> { items: [{ id, label, icon?, hint? }], current? }. */
  function popMenu(btn, getItems, onPick, label) {
    let pop = null;
    const wrap = h('div.tr-popwrap', btn);
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    function close(focus) {
      if (!pop) return;
      pop.remove(); pop = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      if (focus) btn.focus();
    }
    function open(kbd) {
      const { items, current } = getItems();
      const radio = current !== undefined;
      pop = h('div.tr-pop', { role: 'menu', 'aria-label': label, tabindex: -1,
        onkeydown: (e) => {
          const bs = [...pop.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
          else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); bs[e.key === 'Home' ? 0 : bs.length - 1].focus(); }
          else if (e.key === 'Escape') { e.preventDefault(); close(true); }
          else if (e.key === 'Tab') close();
        } },
      items.map((it) => h('button' + (radio && it.id === current ? '.on' : ''), {
        type: 'button', role: radio ? 'menuitemradio' : 'menuitem', 'aria-checked': radio ? String(it.id === current) : null,
        onclick: () => { close(true); onPick(it.id); },
      }, it.icon ? h('span.tr-pop-ico', it.icon) : null, h('span.tr-pop-label', it.label), it.hint ? h('span.tr-pop-hint', it.hint) : null)));
      wrap.append(pop);
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      (kbd ? pop.querySelector('.on') || pop.querySelector('button') : pop).focus({ preventScroll: true });   // mouse: no focus ring on an item
    }
    btn.addEventListener('click', (e) => (pop ? close() : open(e.detail === 0)));   // detail 0 = keyboard (Enter / Space)
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !pop) { e.preventDefault(); open(true); } });
    return wrap;
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
  /** Trim pattern on the given pieces (a row = all four, a piece preview = one). */
  function setPattern(id, pieces) {
    upd((s) => { pieces.forEach((p) => { const o = s.outfit[p]; o.pattern = id; if (id && !o.material) o.material = s.lastMaterial; }); });
  }
  /** Trim material for every piece. */
  function setTrimMat(id) {
    upd((s) => { PIECES.forEach((p) => { s.outfit[p].material = id; }); s.lastMaterial = id; });
  }

  /* ---- randomisers: every one of them always lands on a value that differs from the current one ---- */
  /** Random element of arr, avoiding every value in `avoid` (falls back to avoiding fewer when nothing is left). */
  const pick = (arr, avoid) => {
    const not = [].concat(avoid == null ? [] : avoid);
    let a = arr.filter((x) => !not.includes(x));
    if (!a.length) a = arr.filter((x) => x !== not[0]);
    if (!a.length) a = arr;
    return a[Math.floor(Math.random() * a.length)];
  };
  const PAT_IDS = () => D.trimPatterns.map((p) => p.id);
  const MAT_IDS = () => D.trimMaterials.map((m) => m.id);
  /** Surprise me: armor material, trim pattern and trim material (leather gets a dye). Same look on every piece, or
      (each = shift-click) an independent roll per piece. */
  function surprise(each) {
    upd((s) => {
      const armorsFor = (p) => D.armorMaterials.filter((a) => !a.pieces || a.pieces.includes(p)).map((a) => a.id);
      const common = D.armorMaterials.filter((a) => !a.pieces).map((a) => a.id);
      const dyes = D.dyes.map((d) => d.color);
      const all = (k) => PIECES.map((p) => s.outfit[p][k]);
      const one = { armor: pick(common, all('armor')), pat: pick(PAT_IDS(), all('pattern')), mat: pick(MAT_IDS(), all('material')) };
      one.dye = pick(dyes, all('dye'));
      PIECES.forEach((p) => {
        const o = s.outfit[p];
        o.armor = each ? pick(armorsFor(p), o.armor) : one.armor;
        o.dye = o.armor === 'leather' ? (each ? pick(dyes, o.dye) : one.dye) : o.dye;
        o.pattern = each ? pick(PAT_IDS(), o.pattern) : one.pat;
        o.material = each ? pick(MAT_IDS(), o.material) : one.mat;
      });
      s.lastMaterial = s.outfit[s.focus].material;
    });
  }
  /** Pattern: one new pattern on every piece; the trim material and the armor stay. */
  function randomPattern() {
    upd((s) => {
      const id = pick(PAT_IDS(), PIECES.map((p) => s.outfit[p].pattern));
      PIECES.forEach((p) => { const o = s.outfit[p]; o.pattern = id; if (!o.material) o.material = s.lastMaterial; });
    });
  }
  /** Material: one new trim material; the pattern(s) and the armor stay. */
  function randomMaterial() {
    upd((s) => {
      const id = pick(MAT_IDS(), PIECES.map((p) => s.outfit[p].pattern ? s.outfit[p].material : null).filter(Boolean).concat(s.lastMaterial));
      PIECES.forEach((p) => { if (s.outfit[p].pattern) s.outfit[p].material = id; });
      s.lastMaterial = id;
    });
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

  /** One piece row: the worn item (big) over its name, every armor material (selected one pressed in), eye toggle, leather dyes. */
  function makeSlot(p) {
    const armorBtns = new Map();
    const big = h('canvas.tr-big', { width: 16, height: 16 });
    const id = h('div.tr-slot-id', big, h('b.tr-pname', PIECE_NAME[p]));
    withTip(id, () => pieceTipLines(cur(), p));
    const mats = h('div.tr-armors', { role: 'radiogroup', 'aria-label': 'Armor material for the ' + PIECE_NAME[p].toLowerCase() },
      D.armorMaterials.filter((m) => !m.pieces || m.pieces.includes(p)).map((m) => {
        const b = h('button.btn.tr-ico', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': armorName(p, m.id), 'data-focus': 'tr-armor-' + p + '-' + m.id, onclick: () => setField('armor', m.id, p) },
          TH.icon.item(p, m.id, { size: 24 }));
        armorBtns.set(m.id, b);
        return withTip(b, () => [armorName(p, m.id)].concat(p === 'chestplate' && cur().elytra ? ['Click to wear it (takes the elytra off)'] : []));
      }));
    const eye = h('button.tr-eye', { type: 'button', 'data-focus': 'tr-show-' + p, 'aria-label': 'Show ' + PIECE_NAME[p] + ' in the preview',
      onclick: () => upd((s) => { s.outfit[p].show = !s.outfit[p].show; }) }, h('span.tr-eyeico'));
    withTip(eye, () => { const c = cur(); return [p === 'chestplate' && c.elytra ? 'Hidden while the elytra is worn' : (c.outfit[p].show ? 'Hide the ' : 'Show the ') + PIECE_NAME[p].toLowerCase() + ' in the preview']; });
    const el = h('div.tr-slot', { 'data-piece': p }, id, mats, eye);
    // chestplate under an elytra: a notice tag over the greyed row; any click in the row (except the eye) takes the elytra off
    // and the click still applies, so the kept chestplate look comes back. Hover / focus swaps the tag text (CSS), touch shows both.
    let ely = null;
    if (p === 'chestplate') {
      ely = h('button.pill.tr-ely', { type: 'button', hidden: true, 'data-focus': 'tr-ely-off', 'aria-label': 'Elytra active. Wear the chestplate instead' },
        TH.icon('item/elytra', { size: 20 }), h('span.tr-ely-on', 'Elytra active'), h('span.tr-ely-go', 'Click to wear chestplate'), h('span.tr-ely-tap', '· tap to wear chestplate'));
      el.prepend(ely);
      el.addEventListener('click', (e) => { if (cur().elytra && !e.target.closest('.tr-eye')) upd((s) => { s.elytra = false; }); });
    }
    let dyes = null, last = {};
    function setDyes(n) { if (dyes && n) dyes.replaceWith(n); else if (n) el.append(n); else if (dyes) dyes.remove(); dyes = n; }
    function update(st) {
      const o = st.outfit[p];
      el.classList.toggle('off', !o.show || (p === 'chestplate' && st.elytra));
      if (ely) { el.classList.toggle('ely', !!st.elytra); ely.hidden = !st.elytra; }
      eye.classList.toggle('on', o.show); eye.setAttribute('aria-pressed', String(o.show));
      if (last.armor !== o.armor) armorBtns.forEach((b, mid) => sel(b, mid === o.armor));
      paintSprite(big, p, o);
      const dyeKey = ARMOR[o.armor].dyeable ? 'd' + (o.dye || '') : '';
      if (last.dye !== dyeKey) {
        setDyes(ARMOR[o.armor].dyeable ? h('div.tr-dyes', { role: 'radiogroup', 'aria-label': 'Leather dye colour for the ' + PIECE_NAME[p].toLowerCase() },
          h('button.tr-dye.none' + (!o.dye ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(!o.dye), 'aria-label': 'Undyed leather', title: 'Undyed', 'data-focus': 'tr-dye-' + p + '-none', onclick: () => setField('dye', null, p), style: '--c:' + D.leatherDefault }),
          D.dyes.map((d) => {
            const nm = itemName(d.id + '_dye', d.id.replace('_', ' ') + ' dye');
            return h('button.tr-dye' + (o.dye === d.color ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(o.dye === d.color), 'aria-label': nm, title: nm, 'data-focus': 'tr-dye-' + p + '-' + d.id, onclick: () => setField('dye', d.color, p), style: '--c:' + d.color });
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

  /** Radiogroup keyboard: arrows / Home / End move to and pick the neighbouring key (roving tabindex is set by the caller). */
  function radioKeys(group) {
    group.addEventListener('keydown', (e) => {
      const keys = [...group.querySelectorAll('button[role="radio"]:not(:disabled)')], i = keys.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const j = step ? (i + step + keys.length) % keys.length : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1;
      if (j < 0 || j === i) return;
      e.preventDefault();
      keys[j].focus();
      keys[j].click();
    });
    return group;
  }

  function buildSkin(st) {
    const sk = st.skin;
    const nameInput = h('input.field', { type: 'text', placeholder: 'Username', maxlength: 16, value: sk.kind === 'name' ? sk.name : '', 'aria-label': 'Minecraft username', autocomplete: 'off', spellcheck: false, 'data-focus': 'tr-user',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } } });
    async function lookup() {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) { toast('Usernames are 1–16 letters, digits or _'); return; }
      goBtn.disabled = true; goBtn.classList.add('busy'); goBtn.textContent = 'Loading…';
      try {
        const r = await fetchNamedSkin(name);
        upd((s) => { setSkin(s, { kind: 'name', name, data: r.canvas.toDataURL('image/png'), slim: r.slim }); });
        toast('Loaded the skin of ' + name + (r.slim ? ' (slim arms)' : ''));
      } catch (e) {
        toast(e && e.message ? e.message : 'Could not load the skin');
      } finally {
        goBtn.disabled = false; goBtn.classList.remove('busy'); goBtn.textContent = 'Load';   // the panel is only rebuilt when the skin identity changes, so always reset here
      }
    }
    const goBtn = h('button.btn.small', { type: 'button', 'data-focus': 'tr-user-go', onclick: lookup }, 'Load');
    const file = h('input', { type: 'file', accept: 'image/png', class: 'sr', 'aria-label': 'Upload a skin PNG', tabindex: -1, onchange: () => { const f = file.files[0]; file.value = ''; if (f) takeFile(f); } });
    /* Player = the user's own skin (the active one, or the one stashed while Steve / Alex is shown) */
    const mine = isPlayer(sk.kind) ? sk : st.player;
    const playerOn = isPlayer(sk.kind);
    if (mine && mine.kind === 'name') nameInput.value = mine.name;
    const pickPlayer = () => {
      if (playerOn) return;
      if (st.player) upd((s) => { if (s.player) setSkin(s, s.player); });
      else { nameInput.focus(); toast('Type a username and press Load, or upload a skin PNG'); }
    };
    const skinKeys = [
      ['player', 'Player', playerOn, pickPlayer, mine ? 'Your skin: ' + (mine.name || 'uploaded PNG') + (mine.kind === 'file' ? ' (uploaded)' : '') : 'Your own skin: load a username or upload a PNG'],
      ['steve', 'Steve', sk.kind === 'steve', () => upd((s) => { setSkin(s, DEFAULT_SKIN('steve')); }), 'Default Steve skin (classic arms)'],
      ['alex', 'Alex', sk.kind === 'alex', () => upd((s) => { setSkin(s, DEFAULT_SKIN('alex')); }), 'Default Alex skin (slim arms)'],
    ].map(([k, n, on, go, tip]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? 0 : -1, class: on ? 'on' : '', 'data-focus': 'tr-skin-' + k, title: tip, onclick: go }, n));
    // Classic / Slim only applies to player skins; Steve and Alex have a fixed model (shown, but disabled with a tooltip on the group)
    const armsFixed = !playerOn;
    const armKeys = [[false, 'Classic'], [true, 'Slim']].map(([v, n]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sk.slim === v), tabindex: sk.slim === v ? 0 : -1, class: sk.slim === v ? 'on' : '', disabled: armsFixed, 'data-focus': 'tr-arms-' + n,
      title: armsFixed ? null : v ? 'Slim (3px) arms' : 'Classic (4px) arms', onclick: () => upd((s) => { s.skin.slim = v; }) }, n));
    const box = h('section.panel.tr-card.tr-skin', { 'aria-label': 'Skin' },
      head('Skin'),
      h('div.tr-skin-row.tr-skin-modes',
        radioKeys(h('div.seg.tr-seg.tr-pick', { role: 'radiogroup', 'aria-label': 'Skin' }, skinKeys)),
        radioKeys(h('div.seg.tr-seg.tr-arms', Object.assign({ role: 'radiogroup', 'aria-label': 'Arm width' }, armsFixed ? { 'aria-disabled': 'true', title: (sk.kind === 'alex' ? 'Alex always has slim arms' : 'Steve always has classic arms') + '. Pick Player to choose' } : {}), armKeys))),
      h('div.tr-skin-row.tr-skin-src', { role: 'group', 'aria-label': 'Your skin' },
        nameInput, goBtn,
        h('button.btn.small', { type: 'button', 'data-focus': 'tr-upload', title: mine && mine.kind === 'file' ? 'Uploaded: ' + mine.name + '. Upload another PNG (or drop it on the preview)' : 'Upload a skin PNG (or drop it on the preview)', onclick: () => file.click() }, 'Upload'), file));
    tipTitles(box);
    return box;
  }

  const bdIcon = (b) => (b.icon ? TH.icon(b.icon, { size: 16 }) : h('span.tr-bd-studio'));
  function buildViewer(st) {
    /* one row of individual raised controls aligned to the stage edges: toggles left, view actions right */
    const vbtn = (icon, label, attrs) => h('button.btn.small.tr-vbtn' + (label ? '' : '.sq'), Object.assign({ type: 'button' }, attrs), glyph(icon), label ? h('span.tr-vlabel', label) : null);
    const autoBtn = vbtn('rot', 'Rotate', { 'aria-pressed': String(V.auto), 'data-focus': 'tr-rotate', title: 'Slowly rotate', onclick: () => V.setAuto(!V.auto) });
    V.onAuto = (on) => press(autoBtn, on);
    const elyBtn = vbtn('wing', 'Elytra', { 'aria-pressed': String(!!st.elytra), 'data-focus': 'tr-elytra', title: 'Wear an elytra instead of the chestplate', onclick: () => upd((s) => { s.elytra = !s.elytra; }) });
    V.onElytra = (on) => press(elyBtn, on);
    const glintBtn = vbtn('glint', 'Glint', { 'aria-pressed': String(!!st.glint), 'data-focus': 'tr-glint', title: 'Enchantment glint on the armor', onclick: () => upd((s) => { s.glint = !s.glint; }) });
    V.onGlint = (on) => press(glintBtn, on);
    press(autoBtn, V.auto); press(elyBtn, !!st.elytra); press(glintBtn, !!st.glint);
    const bdIco = h('span.tr-bd-cur'), bdName = h('span.tr-vlabel.tr-bdname');
    const bgBtn = h('button.btn.small.tr-vbtn.tr-bgbtn', { type: 'button', 'data-focus': 'tr-backdrop', 'aria-label': 'Backdrop' }, bdIco, bdName, h('span.tr-chev', { 'aria-hidden': 'true' }));
    withTip(bgBtn, () => ['Backdrop', (BACKDROPS.find((b) => b.id === cur().backdrop) || BACKDROPS[0]).name]);
    const bgMenu = popMenu(bgBtn, () => ({ current: cur().backdrop, items: BACKDROPS.map((b) => ({ id: b.id, label: b.name, icon: bdIcon(b) })) }), (id) => upd((s) => { s.backdrop = id; }), 'Backdrop');
    const resetBtn = vbtn('reset', null, { title: 'Reset the view (double-click the preview)', 'aria-label': 'Reset the view', onclick: () => V.reset() });
    const pngBtn = vbtn('cam', null, { title: 'Save the preview as a PNG', 'aria-label': 'Save the preview as a PNG', onclick: async () => {
      const b = await V.shot();
      if (!b) { toast('Nothing to save yet'); return; }
      const a = h('a', { href: URL.createObjectURL(b), download: 'armor-trim-preview.png' });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    } });
    const animBtns = ANIMS.map(([id, label]) => h('button.tr-anim', { type: 'button', role: 'radio', 'aria-checked': String(V.anim === id), 'data-anim': id, 'data-focus': 'tr-anim-' + id, onclick: () => V.setAnim(id, { force: true }) }, label));
    V.onAnim = (id) => animBtns.forEach((b) => sel(b, b.dataset.anim === id));
    const stage = h('div.tr-stage', { 'data-bg': st.backdrop });
    if (st.studioColor) stage.style.setProperty('--tr-studio', st.studioColor);
    const studioIn = h('input.tr-studio-color', { type: 'color', value: st.studioColor || '#1d1e26', 'aria-label': 'Studio colour', title: 'Studio colour',
      oninput: (e) => { stage.style.setProperty('--tr-studio', e.target.value); studioLab.style.setProperty('--tr-studio-sw', e.target.value); upd((x) => { x.studioColor = e.target.value; }, { silent: true }); } });
    const studioLab = h('label.btn.small.tr-vbtn.sq.tr-studio', { title: 'Studio colour' }, studioIn);
    if (st.studioColor) studioLab.style.setProperty('--tr-studio-sw', st.studioColor);
    const zPct = h('button.btn.small.tr-vbtn.tr-zpct', { type: 'button', title: 'Reset the zoom to 100%', 'aria-label': 'Zoom level, click for 100%', onclick: () => V.zoomTo(1) }, '100%');
    V.onZoom = (z) => { const t = Math.round(z * 100) + '%'; if (zPct.textContent !== t) zPct.textContent = t; };
    const zoomGrp = h('div.tr-zoom', { role: 'group', 'aria-label': 'Zoom' },
      h('button.btn.small.tr-vbtn.sq', { type: 'button', 'aria-label': 'Zoom out', onclick: () => V.zoomBy(1 / 1.2) }, '\u2212'), zPct,
      h('button.btn.small.tr-vbtn.sq', { type: 'button', 'aria-label': 'Zoom in', onclick: () => V.zoomBy(1.2) }, '+'));
    const hint = h('div.tr-hint', { 'aria-hidden': 'true' }, 'Drag to rotate · scroll or pinch to zoom');
    const viewer = h('section.panel.tr-card.tr-viewer', { 'aria-label': '3D preview' },
      h('div.tr-vbar', h('div.tr-vgrp', { role: 'group', 'aria-label': 'Preview options' }, elyBtn, glintBtn, autoBtn), h('div.tr-vgrp.end', { role: 'group', 'aria-label': 'View' }, bgMenu, studioLab, zoomGrp, resetBtn, pngBtn)),
      stage,
      h('div.seg.tr-anims', { role: 'radiogroup', 'aria-label': 'Animation' }, animBtns),
      h('div.tr-drop', { 'aria-hidden': 'true' }, 'Drop the skin PNG'));
    viewer.setBd = (id) => {
      stage.dataset.bg = id;
      const b = BACKDROPS.find((x) => x.id === id) || BACKDROPS[0];
      bdName.textContent = b.name; studioLab.hidden = id !== 'studio';
      if (bdIco.dataset.id !== b.id) { bdIco.dataset.id = b.id; bdIco.replaceChildren(bdIcon(b)); }
    };
    viewer.setBd(st.backdrop);
    if (V.error) stage.append(h('div.tr-error', V.error, h('br'), h('span', 'The flat previews still work.')));
    else {
      stage.append(V.el, hint);
      if (!V.ready) stage.append(h('div.tr-loadingv', 'Loading the 3D viewer…'));
    }
    const used = () => stage.classList.add('used');
    V.el.addEventListener('pointerdown', used, { once: true });
    V.el.addEventListener('wheel', used, { once: true, passive: true });
    if (!V.animInit) { V.animInit = true; V.persist = (id) => { const need = id === 'fly' && !cur().elytra; upd((s) => { s.anim = id; if (need) s.elytra = true; }, { silent: !need }); }; if (!reduced() && st.anim !== 'idle') V.setAnim(st.anim, { silent: true }); }
    V.onAnim(V.anim);
    const dropOn = (on) => viewer.classList.toggle('dropping', on);
    viewer.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropOn(true); } });
    viewer.addEventListener('dragleave', (e) => { if (!viewer.contains(e.relatedTarget)) dropOn(false); });
    viewer.addEventListener('drop', (e) => { dropOn(false); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); takeFile(f); } });
    tipTitles(viewer);
    V.init().then(() => { const s = stage.querySelector('.tr-loadingv'); if (s) s.remove(); V.wake(); }).catch(() => { stage.replaceChildren(h('div.tr-error', V.error || 'The 3D viewer could not start.', h('br'), h('span', 'The flat previews still work.'))); });
    return viewer;
  }

  /** Three raised actions: Surprise me (everything; shift = per piece), Pattern, Material. */
  function randomBar() {
    return h('div.tr-rnd', { role: 'group', 'aria-label': 'Randomise' },
      h('span.tr-rnd-ico', { 'aria-hidden': 'true' }, glyph('dice')),
      h('div.seg.tr-rnd-seg',
        h('button.tr-surprise', { type: 'button', 'data-focus': 'tr-rnd-all', title: 'Random armor, pattern and trim material · Shift-click: every piece different', onclick: (e) => surprise(e.shiftKey) }, 'Surprise me'),
        h('button', { type: 'button', 'data-focus': 'tr-rnd-pattern', title: 'Random pattern on every piece (keeps the material and armor)', onclick: randomPattern }, 'Pattern'),
        h('button', { type: 'button', 'data-focus': 'tr-rnd-material', title: 'Random trim material (keeps the patterns and armor)', onclick: randomMaterial }, 'Material')));
  }

  function mount(st) {
    names = { pat: shortNames(D.trimPatterns.map((p) => patName(p.id))), mat: shortNames(D.trimMaterials.map((m) => matName(m.id))) };
    const wrap = h('div.tr-page');
    const U = { wrap, sig: {} };

    /* ---- left: Armor (four piece rows) + saved outfits + skin ---- */
    const slots = PIECES.map(makeSlot);
    const syncBox = h('input', { type: 'checkbox', 'data-focus': 'tr-sync', 'aria-label': 'Same material for all pieces',
      onchange: (e) => { const on = e.target.checked; upd((s) => { s.sync = on; if (on) copyToAll(s); }); } });
    const syncLabel = h('label.tr-sync', h('span.switch', syncBox, h('span')), h('span', 'Same material for all'));
    withTip(syncLabel, ['Same material for all', 'Picking an armor material or dye sets every piece', 'Turning it on copies the last edited piece (the turtle shell stays helmet-only)']);
    const hud = h('section.panel.tr-card.tr-hud', { 'aria-label': 'Armor' }, head('Armor', syncLabel), h('div.tr-stack', slots.map((s) => s.el)));
    const savedBody = h('div.tr-saved-body');
    const savedEl = h('section.panel.tr-card.tr-saved', { 'aria-label': 'Saved outfits' }, head('Saved outfits'), savedBody);

    /* ---- skin (left column, under Saved outfits) + middle: the preview alone, so the stage gets the height ---- */
    const skinHost = h('div', { style: { display: 'contents' } });
    const viewer = buildViewer(st);

    /* ---- right: trim material row + one row per pattern (template + name, duplication cost, four pieces) ---- */
    const tiles = new Map();
    const tileRow = h('div.tr-tiles', { role: 'radiogroup', 'aria-label': 'Trim material' }, D.trimMaterials.map((m) => {
      const b = h('button.btn.tr-tile', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': matName(m.id), 'data-focus': 'tr-trimmat-' + m.id, onclick: () => setTrimMat(m.id) },
        TH.icon.trimMaterial(m.item, { size: 22 }));
      tiles.set(m.id, b);
      return withTip(b, [matName(m.id), ingredientName(m)]);
    }));
    const pats = [{ id: null }].concat(D.trimPatterns).map((p, i) => {
      const title = p.id ? patName(p.id) : 'No trim';
      const pcs = PIECES.map((pc) => {
        const cv = h('canvas.tr-thumb', { width: THUMB_UNITS * 6, height: THUMB_UNITS * 6 });
        const b = h('button.btn.tr-pt', { type: 'button', 'aria-pressed': 'false', 'aria-label': PIECE_NAME[pc] + ': ' + title, 'data-focus': 'tr-pat-' + (p.id || 'none') + '-' + pc,
          onclick: () => setPattern(p.id, [pc]) }, cv);
        withTip(b, () => [PIECE_NAME[pc] + ' · ' + title, 'Just this piece']);
        return { pc, b, cv };
      });
      const main = h('button.tr-pr-main', { type: 'button', 'aria-label': title + ' on all pieces', 'data-focus': 'tr-pat-' + (p.id || 'none'), onclick: () => setPattern(p.id, PIECES) },
        p.id ? h('span.tr-pr-tpl', TH.icon.trim(p.id, { size: 32 })) : h('span.tr-pr-tpl.none', TH.icon('item/barrier', { size: 22 })),
        h('span.tr-pr-name', p.id ? names.pat[i - 1] : 'No trim'));
      withTip(main, () => (p.id ? patternTipLines(p) : ['No trim', 'Removes the trim']).concat(['Click: all pieces']));
      const dup = h('span.tr-pr-dup', p.id ? [TH.icon(p.blockIcon, { size: 16 })] : null);
      if (p.id) withTip(dup, dupTipLines(p));
      const row = h('div.tr-pr', { role: 'group', 'aria-label': title, onclick: (e) => { if (!e.target.closest('button')) setPattern(p.id, PIECES); } }, main, dup, h('div.tr-pr-pcs', pcs.map((x) => x.b)));
      return { p, row, pcs };
    });
    const browser = h('section.panel.tr-card.tr-browser', { 'aria-label': 'Trim' },
      head('Trim', randomBar()),
      h('div.tr-sub', 'Material'), tileRow,
      h('div.tr-sub', 'Pattern'), h('div.tr-grid', pats.map((x) => x.row)));

    /* ---- materials list ---- */
    const body = h('div.tr-mbody');
    let matsText = '';
    const copyBtn = h('button.btn.small', { type: 'button', 'data-focus': 'tr-copy', onclick: () => copyText(matsText) }, 'Copy list');
    const matsEl = h('section.panel.tr-card.tr-mats', { 'aria-label': 'Materials needed' }, head('Materials', copyBtn), body);

    wrap.append(
      h('div.page-head.tr-head', h('h2', 'Armor trims')),
      h('div.tr-layout', h('div.tr-col.a', hud, savedEl, skinHost), h('div.tr-col.b', viewer), h('div.tr-col.c', browser, matsEl)));
    tipTitles(wrap);

    const item = (icon, text, qty, tipLines) => { const r = h('li.tr-mi', h('span.tr-mico', icon), h('span.tr-mname', text), h('b.tr-mqty', '×' + qty)); return tipLines ? withTip(r, tipLines) : r; };
    const group = (label, items) => h('div.tr-mgroup', h('div.tr-mlabel', label), h('ul.tr-mlist', items));

    U.update = (st, M, gm) => {
      slots.forEach((s) => s.update(st));
      const ss = JSON.stringify([st.saved.map((g) => [g.id, g.name, g.outfit]), st.renaming, PIECES.map((p) => { const o = st.outfit[p]; return [o.armor, o.pattern, o.material, o.dye, o.show]; })]);
      if (U.sig.saved !== ss) { U.sig.saved = ss; const sp = savedPanel(st); savedBody.replaceChildren(...sp); savedBody.querySelectorAll('[title]').forEach((el) => TH.util.tooltip(el));
        const row = savedBody.querySelector('.tr-slots'), on = row && row.querySelector('.tr-oslot-main.on'), rs = on && on.parentNode;   // keep the worn outfit's slot in view
        if (rs) row.scrollLeft = Math.max(0, rs.offsetLeft + rs.offsetWidth - row.clientWidth + 2);
      }
      syncBox.checked = st.sync;
      const sk = JSON.stringify([st.skin.kind, st.skin.slim, st.skin.name, st.player && [st.player.kind, st.player.name]]);
      if (U.sig.skin !== sk) {
        U.sig.skin = sk;
        // the panel is rebuilt on a skin change: keep keyboard focus on the same key (or move it to the newly checked one)
        const a = document.activeElement, fk = a && skinHost.contains(a) && a.dataset.focus;
        skinHost.replaceChildren(buildSkin(st));
        if (fk) {
          let el = skinHost.querySelector('[data-focus="' + fk + '"]');
          if (el && el.disabled) el = skinHost.querySelector('.tr-pick [aria-checked="true"]');
          if (el) el.focus({ preventScroll: true });
        }
      }
      viewer.setBd(st.backdrop);
      tiles.forEach((b, id) => sel(b, id === gm));
      pats.forEach(({ p, row, pcs }) => {
        const n = pcs.filter(({ pc, b }) => { const on = (st.outfit[pc].pattern || null) === p.id; press(b, on); return on; }).length;
        row.classList.toggle('on', n === PIECES.length);
      });
      U.paint = () => pats.forEach(({ p, pcs }) => pcs.forEach(({ pc, cv }) => paintThumb(cv, pc, Object.assign({}, st.outfit[pc], { pattern: p.id, material: p.id ? gm : null }))));
      const none = !M.trimmed;
      copyBtn.disabled = none;
      matsText = materialsText(st, M);
      const ms = JSON.stringify([M.pcs, M.templates.map((t) => [t.id, t.qty]), M.copies, M.diamonds, M.dupes.map((r) => [r.name, r.qty]), M.ingredients.map((r) => [r.item, r.qty])]);
      if (U.sig.mats !== ms) {
        U.sig.mats = ms;
        const mk = [];
        if (none) mk.push(h('p.tr-note', M.pcs.length ? 'No trims yet. Pick a pattern to see what it needs.' : 'No pieces are shown. Show a piece to see what it needs.'));
        else {
          mk.push(group('Templates', M.templates.map((t) => item(TH.icon(t.icon, { size: 20 }), names.pat[D.trimPatterns.indexOf(t.data)], t.qty,
            () => patternTipLines(t.data).concat([t.copies ? '1 original + ' + t.copies + ' cop' + (t.copies === 1 ? 'y' : 'ies') : '1 original'])))));
          if (M.copies) mk.push(group('Duplication', [item(TH.icon('diamond', { size: 20 }), itemName('diamond', 'Diamond'), M.diamonds, [M.copies + ' extra cop' + (M.copies === 1 ? 'y' : 'ies'), M.copies + ' × ' + D.templateCopyDiamonds + ' diamonds'])]
            .concat(M.dupes.map((r) => item(TH.icon(r.icon, { size: 20 }), r.name, r.qty)))));
          mk.push(group('Trim materials', M.ingredients.map((r) => item(TH.icon(r.icon, { size: 20 }), r.item, r.qty))));
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
    if (!cssReady) {
      ensureCss().then(() => { if (TH.app && TH.app.render) TH.app.render(); });
      root.append(h('div.page-head.tr-head', h('h2', 'Armor trims')), h('div.panel.tr-loading', 'Loading the previewer…'));
      return;
    }
    const st = norm(state.trims);
    if (!UI) UI = mount(st);
    root.append(UI.wrap);
    patch(st);
  }

  /** Fill a piece preview canvas: the 16x16-unit front view at one integer scale (same for every piece). */
  function paintThumb(cv, piece, o) {
    const key = pieceKey(piece, o);
    if (cv._key === key) return;
    cv._key = key;
    const draw = (src) => {
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height);
      x.imageSmoothingEnabled = false;
      const k = Math.floor(cv.width / THUMB_UNITS);
      x.drawImage(src, 0, 0, THUMB_UNITS, THUMB_UNITS, 0, 0, THUMB_UNITS * k, THUMB_UNITS * k);
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

  /* ---- saved outfits: one row of slots (filled = load, hover/focus shows rename + delete; dashed "+" = save the current
     outfit, then rename it inline; dashed empty slots reserve the row). More outfits than slots: the row scrolls sideways. ---- */
  const OUTFIT_SLOTS = 4;
  function savedPanel(st) {
    function save() {
      const taken = new Set(st.saved.map((g) => g.name));
      let n = st.saved.length + 1; while (taken.has('Outfit ' + n)) n++;
      const name = 'Outfit ' + n;
      upd((s) => {
        const id = uid('outfit');
        s.saved.push({ id, name, outfit: Object.fromEntries(PIECES.map((p) => [p, clonePiece(s.outfit[p])])), skin: s.skin.kind === 'file' ? null : { kind: s.skin.kind, name: s.skin.name, slim: s.skin.slim, data: s.skin.data }, updated: Date.now() });
        s.savedId = id; s.saveName = '';
        s.renaming = id; s.renameText = name;   // name it right away (Enter keeps the default)
      });
      toast('Saved “' + name + '”');
    }
    let renameRow = null;
    const slots = st.saved.map((g) => {
      const renaming = st.renaming === g.id;
      if (renaming) {
        const rn = h('input.field', { type: 'text', maxlength: 40, value: st.renameText, 'aria-label': 'Name for ' + g.name, 'data-focus': 'tr-rename',
          oninput: (e) => upd((s) => { s.renameText = e.target.value; }, { silent: true }),
          onkeydown: (e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') upd((s) => { s.renaming = null; }); } });
        const commit = () => upd((s) => { const x = s.saved.find((y) => y.id === g.id); if (x) x.name = (s.renameText || '').trim() || x.name; s.renaming = null; });
        setTimeout(() => { if (rn.isConnected && document.activeElement !== rn) { rn.focus(); rn.select(); } }, 60);
        renameRow = h('div.tr-rename', rn, h('button.btn.small.primary', { type: 'button', onclick: commit }, 'OK'), h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Cancel', onclick: () => upd((s) => { s.renaming = null; }) }, '✕'));
      }
      const trimmedN = PIECES.filter((p) => g.outfit[p] && g.outfit[p].show !== false && g.outfit[p].pattern).length;
      const active = PIECES.every((p) => { const a = g.outfit[p], c = st.outfit[p]; return a && ['armor', 'pattern', 'material', 'dye'].every((k) => (a[k] || null) === (c[k] || null)) && (a.show !== false) === c.show; });
      const chest = g.outfit.chestplate || g.outfit.helmet || {};
      return h('div.tr-oslot' + (renaming ? '.is-renaming' : ''),
        h('button.btn.tr-oslot-main' + (active ? '.on' : ''), { type: 'button', 'aria-pressed': String(active), title: 'Load ' + g.name + ' (' + trimmedN + ' trimmed)', 'data-focus': 'tr-saved-' + g.id,
          onclick: () => { upd((s) => {
            const x = s.saved.find((y) => y.id === g.id); if (!x) return;
            PIECES.forEach((p) => { if (x.outfit[p]) s.outfit[p] = clonePiece(x.outfit[p]); });
            if (x.skin && x.skin.kind) setSkin(s, Object.assign({ name: '', data: null, slim: false }, x.skin));
            s.savedId = g.id;
          }); toast('Loaded “' + g.name + '”'); } },
          TH.icon.item(g.outfit.chestplate ? 'chestplate' : 'helmet', chest.armor || 'diamond', { size: 24 }), h('span.tr-oslot-name', g.name)),
        h('span.tr-chip-acts',
          h('button.tr-cbtn.edit', { type: 'button', title: 'Rename', 'aria-label': 'Rename ' + g.name, 'data-focus': 'tr-ren-' + g.id, onclick: () => upd((s) => { s.renaming = g.id; s.renameText = g.name; }) }, h('span.tr-cico')),
          h('button.tr-cbtn.del', { type: 'button', title: 'Delete', 'aria-label': 'Delete ' + g.name, onclick: () => { upd((s) => { s.saved = s.saved.filter((y) => y.id !== g.id); if (s.savedId === g.id) s.savedId = null; if (s.renaming === g.id) s.renaming = null; }); } }, h('span.tr-cico'))));
    });
    const add = h('button.tr-oslot-add', { type: 'button', 'aria-label': 'Save the current outfit', title: 'Save the current outfit and skin', 'data-focus': 'tr-save', onclick: save }, h('span.tr-plus', { 'aria-hidden': 'true' }));
    const empty = Array.from({ length: Math.max(0, OUTFIT_SLOTS - st.saved.length - 1) }, () => h('span.tr-oslot-empty', { 'aria-hidden': 'true' }));
    // naming takes the slot row's place (same height), so the panel never grows
    return [renameRow || h('div.tr-slots.th-scroll-x', { role: 'group', 'aria-label': 'Saved outfits' }, slots, add, empty)];
  }

  /* ---- skin upload ---- */
  async function takeFile(f) {
    try {
      if (!/png$/i.test(f.type) && !/\.png$/i.test(f.name)) throw new Error('Please choose a PNG file');
      if (f.size > 2e6) throw new Error('That file is too large for a skin');
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That is not a valid PNG')); i.src = url; });
      const r = skinFromImage(img);
      upd((s) => { setSkin(s, { kind: 'file', name: f.name.replace(/\.png$/i, ''), data: r.canvas.toDataURL('image/png'), slim: r.slim }); });
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
