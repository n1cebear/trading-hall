window.TH = window.TH || {};

/**
 * Shared Minecraft player-skin helpers (TH.mcSkin), used by Armor Trims (js/modules/trims.js) and the Skin Editor
 * (js/modules/skins*.js). Moved out of trims.js unchanged (Oct 2026):
 *   - skin / cape image decoding (64x64, legacy 64x32 conversion, slim detection, cape 64x32 / 22x17)
 *   - username lookup chain (playerdb -> skin mirrors -> ashcon) with a small localStorage cache, capes
 *   - the vanilla HumanoidModel skeleton, pose maths (ANIM_CFG / computePose / wingTarget) and box-UV geometry
 * No DOM is touched at load time, so node tests can load it in a VM.
 */
TH.mcSkin = (function () {
  'use strict';
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
  const mkCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });

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
  /** The textures property of a Mojang profile (base64 JSON) -> { url, model, cape } (cape = the equipped cape's URL or null). */
  function decodeTextures(props) {
    try {
      const pr = (props || []).find((x) => x && x.name === 'textures') || (props || [])[0];
      if (!pr || !pr.value) return null;
      const t = JSON.parse(atob(pr.value)), tx = (t && t.textures) || {}, sk = tx.SKIN;
      if (!sk) return null;
      return { url: sk.url || null, model: sk.metadata && sk.metadata.model === 'slim' ? 'slim' : 'classic', cape: (tx.CAPE && tx.CAPE.url) || null };
    } catch (e) { return null; }
  }
  /**
   * Cape image -> 64x32 canvas (cape.png layout: the 10x16x1 cape box at uv 0,0, i.e. outer face at 1,1 and inner face at
   * 12,1; the elytra wings at 22,0). HD capes (128x64, ...) are scaled down, legacy 22x17 capes sit in the top-left corner.
   */
  function capeFromImage(img) {
    const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
    const c = mkCanvas(64, 32), x = ctxOf(c);
    x.imageSmoothingEnabled = false;
    if (w >= 64 && w % 64 === 0 && hh * 2 === w) x.drawImage(img, 0, 0, w, hh, 0, 0, 64, 32);
    else if (w <= 64 && hh <= 32 && w >= 22 && hh >= 17) x.drawImage(img, 0, 0);
    else throw new Error('Not a cape texture');
    return c;
  }
  /** True when the cape texture has its own elytra (the game then draws the elytra in the cape's look). */
  function capeHasElytra(c) {
    const d = ctxOf(c).getImageData(22, 0, 24, 22).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  }
  /**
   * The equipped Mojang cape of a profile as a 64x32 PNG data URL, or null (no cape / not reachable). `url` comes from the
   * profile (textures.minecraft.net answers with CORS); crafatar's /capes/<uuid> is the fallback (404 = no cape).
   * `known` = the profile was read, so a missing URL really means "no cape". OptiFine capes are not looked up.
   */
  async function fetchCape(uuid, url, known) {
    const list = [];
    if (url) list.push(String(url).replace(/^http:/, 'https:'));
    if (uuid && (url || !known)) list.push('https://crafatar.com/capes/' + uuid);
    for (const u of list) {
      try { return capeFromImage(await withTimeout(loadImg(u), 7000, 'cape')).toDataURL('image/png'); } catch (e) { /* next source */ }
    }
    return null;
  }
  /**
   * Username -> skin. 1) playerdb.co: uuid + the profile's textures property (skin URL, `model: slim`).
   * 2) the skin PNG by uuid from CORS-friendly mirrors: crafthead, crafatar, mc-heads, then textures.minecraft.net itself
   *    (often no CORS), then minotar by name. 3) Only if all of that fails: ashcon.app (429 = Mojang rate limit, skipped
   *    quietly), then name-based mirrors. Images load with crossOrigin=anonymous so the canvas / WebGL stay untainted.
   * The arm model comes from the profile when known, otherwise from the pixels. Returns { canvas, slim, via, uuid }.
   */
  /** Username -> skin + cape: the skin lookup below, then the cape of the same profile (r.cape = PNG data URL or null). */
  async function fetchNamedSkin(name) {
    const cached = skinCacheGet(name);
    if (cached && cached.cape !== undefined) {   // entries from before capes were looked up have no `cape` field: look them up again
      try {
        const r = skinFromImage(await loadImg(cached.data));
        if (cached.model) r.slim = cached.model === 'slim';
        return Object.assign(r, { via: 'cache', uuid: cached.uuid, cape: cached.cape });
      } catch (e) { /* stale entry: look it up again */ }
    }
    const r = await lookupSkin(name);
    r.cape = await fetchCape(r.uuid, r.capeUrl, r.capeKnown);
    skinCachePut(name, { uuid: r.uuid, model: r.slim ? 'slim' : 'classic', data: r.canvas.toDataURL('image/png'), cape: r.cape });
    return r;
  }
  /** The cape of a player skin saved before capes existed (no lookup of the skin itself). Resolves to a data URL or null. */
  async function fetchNamedCape(name) {
    const cached = skinCacheGet(name);
    if (cached && cached.cape !== undefined) return cached.cape;
    const { j } = await anyJson('https://playerdb.co/api/player/minecraft/' + encodeURIComponent(name), 7000, 'playerdb');
    const pl = j && j.code === 'player.found' && j.data && j.data.player;
    if (!pl) return null;
    const uuid = pl.raw_id || String(pl.id || '').replace(/-/g, '') || null, tx = decodeTextures(pl.properties);
    return fetchCape(uuid, (tx && tx.cape) || pl.cape_texture || null, !!tx);
  }
  async function lookupSkin(name) {
    const n = encodeURIComponent(name), T = 7000;
    const img = (url) => withTimeout(loadImg(url), T, url);
    let uuid = null, model = null, texUrl = null, capeUrl = null, capeKnown = false;
    try {
      const { j } = await anyJson('https://playerdb.co/api/player/minecraft/' + n, T, 'playerdb');
      const pl = j && j.data && j.data.player;
      if (j && j.code === 'player.found' && pl) {
        uuid = pl.raw_id || String(pl.id || '').replace(/-/g, '') || null;
        texUrl = pl.skin_texture || null;
        capeUrl = pl.cape_texture || null;
        const tx = decodeTextures(pl.properties);
        if (tx) { texUrl = tx.url || texUrl; model = tx.model; capeUrl = tx.cape || capeUrl; capeKnown = true; }
      } else if (j && /invalid_username|not_found|notfound|unknown/i.test(String(j.code || ''))) throw notFoundErr(name);
    } catch (e) { if (e && e.notFound) throw e; }
    const https = (u) => String(u).replace(/^http:/, 'https:');
    const finish = (r, via) => {
      if (model) r.slim = model === 'slim';
      r.via = via; r.uuid = uuid; r.capeUrl = capeUrl; r.capeKnown = capeKnown;
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
        if (!capeKnown) { const cp = j.textures.cape; capeUrl = cp ? (cp.data ? 'data:image/png;base64,' + cp.data : cp.url || null) : null; capeKnown = true; }
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
    // Skin Editor extras (Trims never lists them): rest = the static painting pose, the rest are showcase loops
    rest: { amt: 0, still: true },
    crouch: { amt: 0, crouch: true },
    attack: { amt: 0, swing: { period: 10, dur: 6 }, look: 0.05 },
    wave: { amt: 0, wave: true },
    sit: { amt: 0, sit: true },
    spin: { amt: 0, spin: true },
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
    // AnimationUtils.bobModelPart: idle arm sway (the still painting pose holds the arms a little away from the body instead)
    if (cfg.still) { ra[2] += 0.1; la[2] -= 0.1; }
    else {
      ra[2] += cs(age * 0.09) * 0.05 + 0.05; ra[0] += sn(age * 0.067) * 0.05;
      la[2] -= cs(age * 0.09) * 0.05 + 0.05; la[0] -= sn(age * 0.067) * 0.05;
    }
    if (cfg.wave) { ra[0] = -0.2; ra[1] = 0; ra[2] = 2.55 + sn(age * 0.32) * 0.32; head[2] = sn(age * 0.16) * 0.06; }
    if (cfg.sit) {   // the riding pose (HumanoidModel: riding)
      ra[0] -= 0.62831855; la[0] -= 0.62831855;
      rl[0] = -1.4137167; rl[1] = 0.31415927; rl[2] = 0.07853982; ll[0] = -1.4137167; ll[1] = -0.31415927; ll[2] = -0.07853982;
      P[ROOT_Y] = -10;
    }
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

  /** One cuboid with Minecraft box UV mapping (64x`th` texture), explicit normals, optional mirrored UVs. THREE = the three.js module. */
  /** One cuboid with Minecraft box UV mapping (64x`th` texture), explicit normals, optional mirrored UVs. */
  function boxGeometry(THREE, p, tw, th) {
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

  return {
    loadImg, mkCanvas, ctxOf, skinFromImage, withTimeout, decodeTextures, capeFromImage, capeHasElytra, fetchCape, fetchNamedSkin, fetchNamedCape, lookupSkin, dataSig,
    skinParts, PIV, WING_PIV, BONES, ROOT_X, ROOT_Y, POSE_LEN, newPose, ANIM_CFG, JUMP_Y, JUMP_CYCLE, jumpHeight, computePose, wingTarget, ease, boxGeometry,
  };
})();
