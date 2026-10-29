window.TH = window.TH || {};

/**
 * Skin Editor 3D viewport (TH.skinsView.create()): the vanilla player model (TH.mcSkin skeleton, pose maths and box-UV
 * geometry, shared with Armor Trims) with painting support.
 *   - one 64x64 skin texture; paint updates upload only the changed rows (texSubImage2D on a dirty band), with a full
 *     re-upload as the fallback
 *   - per part: skin mesh + grid overlay mesh (pixel grid / part tint) + cursor overlay mesh (brush footprint)
 *   - picking: the camera ray is moved into every visible part's bone space and handed to TH.skinsEngine.pick (pure maths)
 *   - free camera around a look-at point (tx, ty, tz): orbit (right-drag, Alt+left-drag, one finger with the Turn tool),
 *     pan (middle-drag, Shift+right-drag, Space+left-drag, two fingers), zoom toward the cursor (wheel, pinch), double-click
 *     a part = fly to it (S.focus), eased flights (S.view sides, S.reset)
 *   - animations = TH.mcSkin.ANIM_CFG; while a paint tool is active the model holds the still 'rest' pose (pose lock)
 *   - cape (on the torso) and elytra (wings), as in Trims
 * Rendering is on demand (no loop while nothing moves); hidden / off-screen viewports stop.
 */
TH.skinsView = (function () {
  'use strict';
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const rel = (p) => new URL(p, SRC).href;
  let THREE = null, threeP = null;
  const loadThree = () => threeP || (threeP = import(rel('../vendor/three.lite.module.min.js')).then((m) => { THREE = m; return m; }));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const M = () => TH.mcSkin, E = () => TH.skinsEngine;
  const PART_TINT = { head: '#ff6b6b', hat: '#ff6b6b', body: '#5bc0ff', jacket: '#5bc0ff', rarm: '#ffd23c', rsleeve: '#ffd23c', larm: '#b48cff', lsleeve: '#b48cff', rleg: '#45d483', rpants: '#45d483', lleg: '#ff9f43', lpants: '#ff9f43' };

  function create() {
    const el = document.createElement('div');
    el.className = 'sk-canvas';
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', '3D skin preview. Paint with the active tool. Right-drag or Alt-drag turns, middle-drag or Space-drag pans, scroll zooms toward the pointer, double-click a part to fly to it.');
    const S = {
      el, ready: false, error: null, renderer: null, scene: null, camera: null, bones: null, rig: null, rigRoot: null,
      parts: {}, slim: null, skinCv: null, skinTex: null, gridCv: null, gridTex: null, curCv: null, curTex: null,
      pose: null, from: null, tgt: null, blend: 1, anim: 'rest', want: 'idle', speed: 1, paused: false, lock: true,
      animT: 0, age: 0, limb: 0, amt: 0, wing: [0.2617994, 0, -0.2617994, 0], spinYaw: 0,
      yaw: 0.5, pitch: 0.12, zoom: 1, tx: 0, ty: 16, tz: 0, vel: 0, goal: null, dirty: true, raf: 0, last: 0, inView: true, w: 0, h: 0,
      mode: 'paint', lit: true, overlay: 'none', hidden: {}, cape: null, capeOn: false, elytraOn: false, elytraTex: null,
    };
    // free camera: it orbits the look-at point (tx, ty, tz) at yaw / pitch, distance = fit() / zoom
    const HOME = { yaw: 0.5, pitch: 0.12, zoom: 1, tx: 0, ty: 16, tz: 0 };
    const CAM = ['yaw', 'pitch', 'zoom', 'tx', 'ty', 'tz'];
    const ZMIN = 0.45, ZMAX = 8, PMAX = 1.45;
    let initP = null;

    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const nearestTex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    /* ---- materials: shaded (Lambert) or flat (Basic); base opaque-ish, outer layer translucent ---- */
    const mats = {};
    function makeMats() {
      const common = (outer) => ({ map: S.skinTex, alphaTest: outer ? 0.004 : 0.5, transparent: !!outer, depthWrite: !outer, side: outer ? THREE.DoubleSide : THREE.FrontSide });
      mats.litBase = new THREE.MeshLambertMaterial(common(false));
      mats.litOuter = new THREE.MeshLambertMaterial(common(true));
      mats.flatBase = new THREE.MeshBasicMaterial(common(false));
      mats.flatOuter = new THREE.MeshBasicMaterial(common(true));
      const ov = (map) => ({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      mats.grid = new THREE.MeshBasicMaterial(ov(S.gridTex));
      mats.cur = new THREE.MeshBasicMaterial(ov(S.curTex));
    }
    const matFor = (outer) => (S.lit ? (outer ? mats.litOuter : mats.litBase) : (outer ? mats.flatOuter : mats.flatBase));

    function build() {
      const canvas = document.createElement('canvas');
      canvas.className = 'sk-gl';
      S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
      S.renderer.setClearColor(0x000000, 0);
      S.renderer.outputColorSpace = THREE.SRGBColorSpace;
      S.scene = new THREE.Scene();
      S.camera = new THREE.PerspectiveCamera(28, 1, 4, 900);
      S.scene.add(S.camera);
      S.target = new THREE.Vector3(0, 16, 0);
      S.hemi = new THREE.HemisphereLight(0xffffff, 0xb9bccb, 1.55);
      S.scene.add(S.hemi);
      S.key = new THREE.DirectionalLight(0xffffff, 1.4);
      S.scene.add(S.key);
      // contact shadow
      const sc = mkCanvas(64, 64), sx = sc.getContext('2d'), grd = sx.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, 'rgba(0,0,0,.5)'); grd.addColorStop(0.55, 'rgba(0,0,0,.2)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      sx.fillStyle = grd; sx.fillRect(0, 0, 64, 64);
      S.shadow = new THREE.Mesh(new THREE.CircleGeometry(15, 32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
      S.shadow.rotation.x = -Math.PI / 2; S.shadow.position.y = 0.05; S.shadow.renderOrder = -1;
      S.scene.add(S.shadow);
      S.player = new THREE.Group(); S.scene.add(S.player);
      S.rigRoot = new THREE.Group(); S.rigRoot.position.set(0, 12, 0);
      S.rig = new THREE.Group(); S.rig.position.set(0, -12, 0);
      S.rigRoot.add(S.rig); S.player.add(S.rigRoot);
      S.bones = {};
      const PIV = M().PIV;
      M().BONES.forEach((id) => { const g = new THREE.Group(); g.rotation.order = 'ZYX'; g.position.set(PIV[id][0], PIV[id][1], PIV[id][2]); S.rig.add(g); S.bones[id] = g; });
      // textures
      S.skinCv = mkCanvas(64, 64); S.skinTex = nearestTex(S.skinCv, true);
      S.gridCv = mkCanvas(512, 512); S.gridTex = nearestTex(S.gridCv, true);
      S.gridTex.magFilter = THREE.NearestFilter;
      S.curCv = mkCanvas(64, 64); S.curTex = nearestTex(S.curCv, true);
      makeMats();
      // elytra + cape (Trims geometry)
      const WP = M().WING_PIV;
      S.wingMat = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
      S.wings = {};
      [['l', 1], ['r', -1]].forEach(([id, sg]) => {
        const g = new THREE.Group(); g.rotation.order = 'ZYX'; g.position.set(WP[0] * sg, WP[1], WP[2]);
        g.add(new THREE.Mesh(M().boxGeometry(THREE, { box: sg > 0 ? [-10, -20, -2, 10, 20, 2] : [0, -20, -2, 10, 20, 2], uv: [22, 0], g: 1, mirror: sg < 0 }, 64, 32), S.wingMat));
        g.visible = false; S.rig.add(g); S.wings[id] = g;
      });
      S.capeMat = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.FrontSide });
      const cgeo = M().boxGeometry(THREE, { box: [-5, -16, 0, 10, 16, 1], uv: [0, 0] }, 64, 32); cgeo.rotateY(Math.PI);
      S.capeG = new THREE.Group(); S.capeG.add(new THREE.Mesh(cgeo, S.capeMat)); S.capeG.visible = false; S.bones.torso.add(S.capeG);
      S.pose = M().newPose(); S.from = M().newPose(); S.tgt = M().newPose();
      el.prepend(canvas);
      S.canvas = canvas;
      drawGrid();
    }

    /** (re)build the twelve skin parts for the arm model */
    function buildParts(slim) {
      Object.values(S.parts).forEach((p) => { [p.mesh, p.grid, p.cur].forEach((m) => { if (m.parent) m.parent.remove(m); }); p.mesh.geometry.dispose(); });
      S.parts = {};
      const PIV = M().PIV;
      M().skinParts(slim).forEach((p) => {
        const geo = M().boxGeometry(THREE, p, 64, 64), pv = PIV[p.bone];
        geo.translate(-pv[0], -pv[1], -pv[2]);
        const outer = !!p.g, mesh = new THREE.Mesh(geo, matFor(outer)), grid = new THREE.Mesh(geo, mats.grid), cur = new THREE.Mesh(geo, mats.cur);
        mesh.renderOrder = outer ? 2 : 0; grid.renderOrder = outer ? 3 : 1; cur.renderOrder = 4;
        [mesh, grid, cur].forEach((m) => S.bones[p.bone].add(m));
        S.parts[p.id] = { id: p.id, outer, mesh, grid, cur, pivot: pv };
      });
      S.slim = slim;
      applyVis();
    }
    function applyVis() {
      Object.values(S.parts).forEach((p) => {
        const vis = !S.hidden[p.id];
        p.mesh.visible = vis; p.grid.visible = vis && S.overlay !== 'none'; p.cur.visible = vis;
        p.mesh.material = matFor(p.outer);
      });
      S.dirty = true; wake();
    }
    /** pixel grid (texel borders) or part tint on a 512 canvas (8 px per texel) */
    function drawGrid() {
      const x = S.gridCv.getContext('2d');
      x.clearRect(0, 0, 512, 512);
      if (S.overlay === 'none' || !TH.skinsEngine) { if (S.gridTex) S.gridTex.needsUpdate = true; return; }
      const R = E().faceRects(S.slim ? 'slim' : 'classic');
      if (S.overlay === 'parts') {
        R.forEach((r) => { x.fillStyle = PART_TINT[r.part]; x.globalAlpha = r.layer === 'outer' ? 0.22 : 0.3; x.fillRect(r.x * 8, r.y * 8, r.w * 8, r.h * 8); });
        x.globalAlpha = 1;
      }
      x.fillStyle = 'rgba(0,0,0,.35)';
      R.forEach((r) => {
        for (let i = 0; i <= r.w; i++) x.fillRect((r.x + i) * 8 - (i === r.w ? 1 : 0), r.y * 8, 1, r.h * 8);
        for (let j = 0; j <= r.h; j++) x.fillRect(r.x * 8, (r.y + j) * 8 - (j === r.h ? 1 : 0), r.w * 8, 1);
      });
      x.fillStyle = 'rgba(255,255,255,.18)';
      R.forEach((r) => { for (let i = 0; i < r.w; i++) x.fillRect((r.x + i) * 8 + 1, r.y * 8, 1, r.h * 8); });
      S.gridTex.needsUpdate = true;
    }

    /* ---- texture uploads: only the changed rows of the 64x64 canvas ---- */
    function subUpload(tex, cv, rect) {
      const r = S.renderer, props = r && r.properties.get(tex), gl = r && r.getContext();
      const full = () => { tex.needsUpdate = true; };
      if (!rect || !props || !props.__webglTexture || props.__version !== tex.version) return full();
      try {
        const y0 = clamp(rect.y0, 0, cv.height - 1), y1 = clamp(rect.y1, 0, cv.height - 1);
        const img = cv.getContext('2d').getImageData(0, y0, cv.width, y1 - y0 + 1);
        r.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, cv.height - 1 - y1, gl.RGBA, gl.UNSIGNED_BYTE, img);
        S.subUploads = (S.subUploads || 0) + 1;
      } catch (e) { full(); }
    }
    const imgOf = (buf) => new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h);
    /** whole skin (buf = 64x64 RGBA) */
    S.setSkin = (buf, slim) => {
      if (!S.ready) { S.pending = [buf, slim]; return; }
      if (S.slim !== !!slim || !Object.keys(S.parts).length) { buildParts(!!slim); drawGrid(); }
      S.skinCv.getContext('2d').putImageData(imgOf(buf), 0, 0);
      S.skinTex.needsUpdate = true;
      S.dirty = true; wake();
    };
    /** only rect (inclusive) of buf changed */
    S.updateRect = (buf, rect) => {
      if (!S.ready) return;
      if (!rect) return S.setSkin(buf, S.slim);
      const x0 = clamp(rect.x0, 0, 63), y0 = clamp(rect.y0, 0, 63), x1 = clamp(rect.x1, 0, 63), y1 = clamp(rect.y1, 0, 63), w = x1 - x0 + 1, hh = y1 - y0 + 1;
      const sub = new ImageData(w, hh);
      for (let j = 0; j < hh; j++) sub.data.set(buf.data.subarray(((y0 + j) * 64 + x0) * 4, ((y0 + j) * 64 + x1 + 1) * 4), j * w * 4);
      S.skinCv.getContext('2d').putImageData(sub, x0, y0);
      subUpload(S.skinTex, S.skinCv, { y0, y1 });
      S.dirty = true; wake();
    };
    /** brush cursor: pixels [[x, y]] highlighted on the model (colour = rgba css) */
    let curRect = null, selMask = null, selDirty = false;
    /** the selection (64x64 mask or null) shows as a tint on the model, under the brush cursor */
    S.setSelection = (mask) => { selMask = mask || null; selDirty = true; S.setCursor(S.lastCur || null, S.lastCurColor); };
    S.setCursor = (pts, color) => {
      if (!S.ready) return;
      S.lastCur = pts; S.lastCurColor = color;
      const x = S.curCv.getContext('2d');
      let r = curRect;
      if (selMask || selDirty) {   // repaint the whole small canvas: selection tint, then the cursor
        x.clearRect(0, 0, 64, 64);
        // only the rim of the selection is marked, so the selected pixels keep their true colours on the model
        if (selMask) { x.fillStyle = 'rgba(140,150,255,.6)'; const m = selMask; for (let i = 0; i < 4096; i++) { if (!m[i]) continue; const cx = i & 63, cy = i >> 6; if (cx === 0 || cy === 0 || cx === 63 || cy === 63 || !m[i - 1] || !m[i + 1] || !m[i - 64] || !m[i + 64]) x.fillRect(cx, cy, 1, 1); } }
        r = { y0: 0, y1: 63 }; selDirty = false;
      } else if (curRect) x.clearRect(0, curRect.y0, 64, curRect.y1 - curRect.y0 + 1);
      curRect = null;
      if (pts && pts.length) {
        x.fillStyle = color || 'rgba(255,255,255,.55)';
        pts.forEach(([px, py]) => { x.fillRect(px, py, 1, 1); curRect = curRect ? { y0: Math.min(curRect.y0, py), y1: Math.max(curRect.y1, py) } : { y0: py, y1: py }; });
      }
      const u = r && curRect ? { y0: Math.min(r.y0, curRect.y0), y1: Math.max(r.y1, curRect.y1) } : r || curRect;
      if (u) { subUpload(S.curTex, S.curCv, u); S.dirty = true; wake(); }
    };
    S.setPartVisible = (id, on) => { S.hidden[id] = !on; if (S.ready) applyVis(); };
    S.setHidden = (map) => { S.hidden = Object.assign({}, map); if (S.ready) applyVis(); };
    S.setOverlay = (mode) => { S.overlay = mode || 'none'; if (S.ready) { drawGrid(); applyVis(); } };
    S.setLighting = (on) => { S.lit = !!on; if (S.ready) applyVis(); };

    /* ---- pose / animation ---- */
    function applyPose() {
      if (!S.bones) return;
      const q = S.pose, b = S.bones, PIV = M().PIV, RX = M().ROOT_X, RY = M().ROOT_Y;
      S.rigRoot.position.y = 12 + q[RY]; S.rigRoot.rotation.x = q[RX];
      S.player.rotation.y = S.spinYaw;
      M().BONES.forEach((id, i) => {
        const o = i * 6, g = b[id], pv = PIV[id];
        g.rotation.set(q[o], -q[o + 1], -q[o + 2]);
        g.position.set(pv[0] + q[o + 3], pv[1] - q[o + 4], pv[2] - q[o + 5]);
      });
      const w = S.wing, WP = M().WING_PIV;
      S.wings.l.rotation.set(w[0], -w[1], -w[2]); S.wings.r.rotation.set(w[0], w[1], w[2]);
      S.wings.l.position.y = S.wings.r.position.y = WP[1] - w[3];
      if (S.capeG.visible) { S.capeG.rotation.x = (6 + S.amt * 16 + Math.sin(S.limb * 0.6662) * 2.5 * S.amt) * Math.PI / 180; S.capeG.position.set(0, 0, -2); }
      const lift = Math.max(0, q[RY]), sc = Math.max(0.55, 1 - lift * 0.04) * (q[RX] > 0.5 ? 0.9 : 1);
      S.shadow.scale.set(sc, sc, sc);
    }
    const cfgOf = (id) => M().ANIM_CFG[id] || M().ANIM_CFG.idle;
    const live = () => (S.lock ? 'rest' : S.want);
    function stepAnim(dt) {
      const id = live(), cfg = cfgOf(id), slow = reduced(), run = !S.paused && id !== 'rest';
      const tk = dt * 20 * (run ? S.speed : 0) * (slow ? 0.3 : 1);
      S.age += tk; S.animT += tk;
      S.amt += (cfg.amt - S.amt) * (1 - Math.pow(0.6, Math.max(tk, dt * 20)));
      S.limb += S.amt * tk;
      if (cfg.spin && run) S.spinYaw += dt * 1.6 * S.speed;
      else if (!cfg.spin) S.spinYaw *= Math.pow(0.0001, dt);   // ease back to front
      S.blend = slow ? 1 : Math.min(1, S.blend + dt / 0.28);
      const e = S.blend < 1 ? M().ease(S.blend) : 1;
      M().computePose(S.tgt, cfg, S.age, S.limb, S.amt, S.animT);
      for (let i = 0; i < S.pose.length; i++) S.pose[i] = S.from[i] + (S.tgt[i] - S.from[i]) * e;
      const wt = M().wingTarget(cfg), wk = slow ? 1 : 1 - Math.pow(0.9, Math.max(tk, dt * 20));
      for (let i = 0; i < 4; i++) S.wing[i] += (wt[i] - S.wing[i]) * wk;
      applyPose();
    }
    const settled = () => S.blend >= 1 && (live() === 'rest' || S.paused) && Math.abs(S.spinYaw) < 0.0005 && Math.abs(S.amt) < 0.001;
    function switchTo() { if (!S.pose) { S.onAnim && S.onAnim(); return; } S.from.set(S.pose); S.blend = reduced() ? 1 : 0; S.animT = 0; S.dirty = true; wake(); S.onAnim && S.onAnim(); }
    /** the showcase animation (plays while no paint tool holds the pose) */
    S.setAnim = (id) => { if (!M().ANIM_CFG[id]) id = 'idle'; const was = live(); S.want = id; S.paused = false; if (live() !== was || !S.lock) switchTo(); else S.onAnim && S.onAnim(); };
    /** pose lock: true = hold the still painting pose */
    S.setLock = (on) => { if (S.lock === !!on) return; S.lock = !!on; switchTo(); };
    S.setPaused = (on) => { S.paused = !!on; S.dirty = true; wake(); S.onAnim && S.onAnim(); };
    S.setSpeed = (k) => { S.speed = clamp(k, 0.1, 3); wake(); };

    /* ---- camera ---- */
    function fit() {
      const t = Math.tan((S.camera.fov * Math.PI) / 360), aspect = Math.max(0.2, S.w / Math.max(1, S.h));
      return Math.max(21 / t, 14 / (t * aspect));   // the model fills the stage: it is the hero of the page
    }
    /** camera basis for yaw / pitch: right, up (screen directions in the world) and the view direction */
    const basis = (yaw, pitch) => {
      const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      return { r: [cy, 0, -sy], u: [-sy * sp, cp, -cy * sp], f: [-sy * cp, -sp, -cy * cp] };
    };
    const clampTarget = () => { S.tx = clamp(S.tx, -40, 40); S.ty = clamp(S.ty, -12, 52); S.tz = clamp(S.tz, -40, 40); };
    function place() {
      const d = fit() / S.zoom, cp = Math.cos(S.pitch);
      S.target.set(S.tx, S.ty, S.tz);
      S.camera.position.set(S.target.x + d * Math.sin(S.yaw) * cp, S.target.y + d * Math.sin(S.pitch), S.target.z + d * Math.cos(S.yaw) * cp);
      S.camera.lookAt(S.target);
      S.camera.updateMatrixWorld();
      S.key.position.copy(S.camera.localToWorld(new THREE.Vector3(-40, 70, 30)));
      S.key.target.position.set(0, 16, 0); S.key.target.updateMatrixWorld();
      if (S.onZoom && S.lastZ !== S.zoom) { S.lastZ = S.zoom; S.onZoom(S.zoom); }
    }
    function resize() {
      const w = el.clientWidth, hh = el.clientHeight;
      if (!w || !hh || (w === S.w && hh === S.h && S.pr === pixelRatio())) return;
      S.w = w; S.h = hh; S.pr = pixelRatio();
      S.renderer.setPixelRatio(S.pr);
      S.renderer.setSize(w, hh, false);
      S.camera.aspect = w / hh; S.camera.updateProjectionMatrix();
      S.dirty = true;
    }
    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, document.documentElement.dataset.perf === 'lite' ? 1 : 2);
    const visible = () => el.isConnected && !document.hidden && S.inView && S.ready;
    function frame(now) {
      S.raf = 0;
      if (!visible()) return;
      const dt = Math.min(0.05, (now - (S.last || now)) / 1000);
      S.last = now;
      let moving = false;
      if (S.goal) {   // a camera flight: ease-in-out over the goal's duration (focus, side, reset)
        const g = S.goal;
        g.t = Math.min(1, g.t + dt / g.dur);
        const e = g.t < 0.5 ? 4 * g.t * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 3) / 2;
        CAM.forEach((key) => { S[key] = g.from[key] + (g.to[key] - g.from[key]) * e; });
        if (g.t >= 1) { Object.assign(S, g.to); S.goal = null; S.onView && S.onView(); }
        moving = true;
      }
      if (!drag && Math.abs(S.vel) > 0.01) { S.yaw += S.vel * dt; S.vel *= Math.exp(-3.4 * dt); moving = true; }
      if (!settled()) { stepAnim(dt); moving = true; }
      if (moving || S.dirty) { resize(); place(); S.renderer.render(S.scene, S.camera); S.dirty = false; S.frames = (S.frames || 0) + 1; }
      if (moving || drag) S.raf = requestAnimationFrame(frame);
    }
    function wake() { if (!S.raf && visible()) { S.last = 0; S.raf = requestAnimationFrame(frame); } }
    S.wake = () => { S.dirty = true; wake(); };
    /** fly the camera to a goal (any of CAM keys); the shortest way round for yaw; reduced motion jumps */
    function flyTo(to, dur) {
      const goal = Object.assign({}, ...CAM.map((k) => ({ [k]: S[k] })), to);
      goal.yaw = S.yaw + Math.atan2(Math.sin(goal.yaw - S.yaw), Math.cos(goal.yaw - S.yaw));
      S.vel = 0;
      if (reduced() || !S.ready) { S.goal = null; Object.assign(S, goal); S.onView && S.onView(); }
      else S.goal = { from: Object.assign({}, ...CAM.map((k) => ({ [k]: S[k] }))), to: goal, t: 0, dur: dur || 0.55 };
      S.dirty = true; wake();
    }
    S.reset = () => flyTo(HOME);
    const SIDE_YAW = { front: 0, back: Math.PI, right: -Math.PI / 2, left: Math.PI / 2 };
    /** look at what the camera looks at now from a side: 'front' | 'back' | 'left' | 'right' | 'top' (keeps the focus and zoom) */
    S.view = (side) => flyTo({ yaw: side === 'top' ? S.yaw : SIDE_YAW[side] || 0, pitch: side === 'top' ? 1.3 : 0.08 });
    /** world-space box of some parts ([ids], visible or not) or of the cape: { c: [x, y, z], r: radius } */
    function boxOf(ids) {
      if (!S.ready) return null;
      S.scene.updateMatrixWorld();
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], v = new THREE.Vector3();
      const meshes = ids === 'cape' ? (S.capeG.visible ? S.capeG.children : []) : ids.map((id) => S.parts[id] && S.parts[id].mesh).filter(Boolean);
      meshes.forEach((m) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
          mn[0] = Math.min(mn[0], v.x); mn[1] = Math.min(mn[1], v.y); mn[2] = Math.min(mn[2], v.z);
          mx[0] = Math.max(mx[0], v.x); mx[1] = Math.max(mx[1], v.y); mx[2] = Math.max(mx[2], v.z);
        }
      });
      if (!isFinite(mn[0])) return null;
      return { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], r: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 };
    }
    /** the parts a focus name stands for (a picked part focuses its limb, base and outer layer together) */
    const FOCUS = { head: ['head', 'hat'], body: ['body', 'jacket'], arms: ['rarm', 'larm', 'rsleeve', 'lsleeve'], legs: ['rleg', 'lleg', 'rpants', 'lpants'],
      rarm: ['rarm', 'rsleeve'], larm: ['larm', 'lsleeve'], rleg: ['rleg', 'rpants'], lleg: ['lleg', 'lpants'], cape: 'cape' };
    const OWNER = { hat: 'head', jacket: 'body', rsleeve: 'rarm', lsleeve: 'larm', rpants: 'rleg', lpants: 'lleg' };
    /**
     * Fly to a part: name = head | body | arms | legs | rarm | larm | rleg | lleg | cape (or any part id), face = the face to
     * turn to (front, back, left, right, top, bottom; optional: else the camera keeps its side). Returns false if not there.
     */
    S.focus = (name, face) => {
      const ids = FOCUS[OWNER[name] || name];
      const b = ids && boxOf(ids);
      if (!b) return false;
      const t = Math.tan((S.camera.fov * Math.PI) / 360), aspect = Math.max(0.2, S.w / Math.max(1, S.h));
      const d = Math.max(b.r / t, b.r / (t * aspect)) * 1.15;
      const to = { tx: b.c[0], ty: b.c[1], tz: b.c[2], zoom: clamp(fit() / d, ZMIN, ZMAX) };
      if (face === 'top') to.pitch = 1.1;
      else if (face === 'bottom') to.pitch = -1.0;
      else if (face && face in SIDE_YAW) { to.yaw = SIDE_YAW[face]; to.pitch = 0.12; }
      else if (name === 'cape') { to.yaw = Math.PI; to.pitch = 0.12; }
      else to.pitch = clamp(S.pitch, -0.35, 0.6);
      flyTo(to, 0.6);
      return true;
    };
    S.zoomTo = (z) => { S.zoom = clamp(z, ZMIN, ZMAX); S.goal = null; S.dirty = true; wake(); };
    S.zoomBy = (f) => S.zoomTo(S.zoom * f);
    /** zoom by f keeping the point under the client point (cx, cy) where it is (no point: zoom on the look-at point) */
    S.zoomAt = (f, cx, cy) => {
      const z1 = clamp(S.zoom * f, ZMIN, ZMAX);
      if (cx == null || !S.ready || !S.w) return S.zoomTo(z1);
      resize(); place();
      const r = S.canvas.getBoundingClientRect(), nx = ((cx - r.left) / r.width) * 2 - 1, ny = -((cy - r.top) / r.height) * 2 + 1;
      const o = S.camera.position, p = new THREE.Vector3(nx, ny, 0.5).unproject(S.camera).sub(o);
      const B = basis(S.yaw, S.pitch), f3 = B.f, den = p.x * f3[0] + p.y * f3[1] + p.z * f3[2];
      if (Math.abs(den) > 1e-6) {
        // the point on the plane through the look-at point, facing the camera; the look-at point slides toward it
        const dist = ((S.tx - o.x) * f3[0] + (S.ty - o.y) * f3[1] + (S.tz - o.z) * f3[2]) / den;
        const P = [o.x + p.x * dist, o.y + p.y * dist, o.z + p.z * dist], k = S.zoom / z1;
        S.tx = P[0] + (S.tx - P[0]) * k; S.ty = P[1] + (S.ty - P[1]) * k; S.tz = P[2] + (S.tz - P[2]) * k;
        clampTarget();
      }
      S.zoomTo(z1);
    };
    S.orbitBy = (dx, dy) => { S.yaw -= dx * 0.0105; S.pitch = clamp(S.pitch + dy * 0.007, -PMAX, PMAX); S.goal = null; S.dirty = true; wake(); };
    /** move the look-at point with the pointer (dx, dy in client px): the model follows the hand */
    S.panBy = (dx, dy) => {
      const B = basis(S.yaw, S.pitch), k = (2 * (fit() / S.zoom) * Math.tan((S.camera ? S.camera.fov : 28) * Math.PI / 360)) / Math.max(1, S.h);
      S.tx -= (B.r[0] * dx - B.u[0] * dy) * k; S.ty -= (B.r[1] * dx - B.u[1] * dy) * k; S.tz -= (B.r[2] * dx - B.u[2] * dy) * k;
      clampTarget(); S.goal = null; S.dirty = true; wake();
    };
    /** the camera as plain numbers (for the UI / tests) */
    S.cam = () => ({ yaw: S.yaw, pitch: S.pitch, zoom: S.zoom, target: [S.tx, S.ty, S.tz], flying: !!S.goal });

    /* ---- picking ---- */
    const tmpV = () => new THREE.Vector3();
    /** pixel under the client point, or null. accept(partId) filters parts (default: every visible part). */
    S.pickAt = (cx, cy, accept) => {
      if (!S.ready || !S.w) return null;
      resize(); place();
      const r = S.canvas.getBoundingClientRect(), nx = ((cx - r.left) / r.width) * 2 - 1, ny = -((cy - r.top) / r.height) * 2 + 1;
      S.scene.updateMatrixWorld();
      const o = S.camera.position.clone(), far = tmpV().set(nx, ny, 0.5).unproject(S.camera);
      const rays = [];
      Object.values(S.parts).forEach((p) => {
        if (!p.mesh.visible || (accept && !accept(p.id))) return;
        const inv = p.mesh.matrixWorld.clone().invert(), lo = o.clone().applyMatrix4(inv), lf = far.clone().applyMatrix4(inv);
        rays.push({ id: p.id, o: [lo.x + p.pivot[0], lo.y + p.pivot[1], lo.z + p.pivot[2]], d: [lf.x - lo.x, lf.y - lo.y, lf.z - lo.z] });
      });
      return E().pick(S.slim ? 'slim' : 'classic', rays);
    };

    /*
     * ---- input ----
     * left button / one finger: paint with the active tool (the Turn tool: orbit) · right-drag or Alt+left-drag: orbit
     * (Alt+click without moving still picks a colour) · middle-drag, Shift+right-drag or Space+left-drag: pan ·
     * wheel: zoom toward the cursor · two fingers: pan + pinch zoom (always) · double-click a part: fly to it.
     */
    let drag = null;   // { kind: 'paint' | 'orbit' | 'pan' | 'alt' | 'multi', id, x, y, t }
    const ptrs = new Map();
    let pinch0 = 0, zoom0 = 1, mid0 = null, spaceDown = false, lastDown = null;
    const pdist = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
    const pmid = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && el.matches(':hover')) spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
    window.addEventListener('blur', () => { spaceDown = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    /** a second left click on the same spot within 350 ms = double-click: fly to the part under it (and do not paint again) */
    function dblFocus(e) {
      const now = e.timeStamp, prev = lastDown;
      lastDown = { t: now, x: e.clientX, y: e.clientY };
      if (!prev || now - prev.t > 350 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 6) return false;
      lastDown = null;
      const hit = S.pickAt(e.clientX, e.clientY);
      if (!hit) { S.reset(); return true; }
      S.focus(hit.part, hit.face);
      S.onFocus && S.onFocus(hit);
      return true;
    }
    el.addEventListener('pointerdown', (e) => {
      if (!S.ready) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      S.goal = null; S.vel = 0;
      if (ptrs.size === 2) {   // second finger: cancel a stroke, start pinch + two-finger pan
        if (drag && drag.kind === 'paint') S.onPaint && S.onPaint('cancel', null, e);
        drag = { kind: 'multi' }; pinch0 = pdist(); zoom0 = S.zoom; mid0 = pmid();
        return;
      }
      if (ptrs.size > 2) return;
      const btn = e.pointerType === 'mouse' ? e.button : 0;
      if (btn === 0 && !e.altKey && !spaceDown && !e.shiftKey && dblFocus(e)) { drag = null; ptrs.delete(e.pointerId); return; }
      let kind = 'orbit';
      if (btn === 1 || (btn === 0 && spaceDown) || (btn === 2 && e.shiftKey) || (btn === 0 && e.shiftKey && S.mode === 'orbit')) kind = 'pan';
      else if (btn === 2) kind = 'orbit';
      else if (btn === 0 && e.altKey) kind = 'alt';   // drag = orbit, click = pick a colour
      else if (btn === 0 && S.mode === 'paint') kind = 'paint';
      drag = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.timeStamp };
      el.classList.toggle('grab', kind === 'orbit' || kind === 'pan');
      if (kind === 'paint') S.onPaint && S.onPaint('start', S.pickAt(e.clientX, e.clientY), e);
      wake();
    });
    el.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!drag || !p) {
        if (S.mode === 'paint' && e.pointerType !== 'touch' && S.onHover) S.onHover(S.pickAt(e.clientX, e.clientY), e);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (drag.kind === 'multi' && ptrs.size === 2) {
        const m = pmid(), mx = m.x - mid0.x, my = m.y - mid0.y; mid0 = m;
        S.panBy(mx, my);
        const nz = clamp(zoom0 * pdist() / pinch0, ZMIN, ZMAX);
        if (Math.abs(nz - S.zoom) > 1e-4) S.zoomAt(nz / S.zoom, m.x, m.y);
        S.dirty = true; wake();
        S.onView && S.onView();
        return;
      }
      if (drag.id !== e.pointerId) return;
      if (drag.kind === 'alt') {   // Alt + left: becomes an orbit once it moves a few pixels
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.kind = 'orbit'; el.classList.add('grab');
      }
      if (drag.kind === 'none') return;
      if (drag.kind === 'paint') {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        (evs.length ? evs : [e]).forEach((ce) => { const hit = S.pickAt(ce.clientX, ce.clientY); S.onPaint && S.onPaint('move', hit, ce); });
        if (S.onHover) S.onHover(S.pickAt(e.clientX, e.clientY), e);
        return;
      }
      if (drag.kind === 'pan') S.panBy(dx, dy);
      else {
        S.orbitBy(dx, dy);
        const dt = Math.max(0.004, (e.timeStamp - drag.t) / 1000);
        S.vel = clamp(S.vel * 0.5 + (-dx * 0.0105 / dt) * 0.5, -9, 9);
      }
      drag.t = e.timeStamp;
      S.onView && S.onView();
    });
    const up = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      if (drag && drag.kind === 'paint' && drag.id === e.pointerId) S.onPaint && S.onPaint('end', null, e);
      if (drag && drag.kind === 'alt' && drag.id === e.pointerId && e.type === 'pointerup') { const hit = S.pickAt(e.clientX, e.clientY); if (hit && S.onPickColor) S.onPickColor(hit); }
      if (drag && drag.kind === 'multi' && ptrs.size === 1) { const [id, p] = [...ptrs.entries()][0]; drag = { kind: S.mode === 'orbit' ? 'orbit' : 'none', id, x: p.x, y: p.y, t: e.timeStamp }; wake(); return; }
      if (drag && drag.kind === 'orbit' && (e.timeStamp - drag.t > 90 || reduced())) S.vel = 0;
      if (drag && drag.kind !== 'orbit') S.vel = 0;
      if (!ptrs.size || (drag && drag.id === e.pointerId)) { drag = ptrs.size ? { kind: 'none' } : null; el.classList.remove('grab'); }
      if (!ptrs.size) drag = null;
      wake();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (!drag && S.onHover) S.onHover(null, e); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      S.goal = null;
      if (e.ctrlKey || !e.shiftKey) S.zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX, e.clientY);
      else S.orbitBy(e.deltaY * 0.4, 0);
      S.dirty = true; wake();
      S.onView && S.onView();
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const k = e.key, step = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[k];
      if (step && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (e.shiftKey) S.panBy(step[0], step[1]); else S.orbitBy(step[0], step[1]); }
      else if (k === '+' || k === '=') { e.preventDefault(); S.zoomBy(1.15); }
      else if (k === '-') { e.preventDefault(); S.zoomBy(1 / 1.15); }
      else if (k === '0' || k === 'Home') { e.preventDefault(); S.reset(); }
    });

    /* ---- cape + elytra ---- */
    S.setCape = (canvas, on) => {
      if (!S.ready) return;
      S.capeCv = canvas || null;
      if (canvas) { if (!S.capeTex || S.capeTex.image !== canvas) { if (S.capeTex) S.capeTex.dispose(); S.capeTex = nearestTex(canvas, true); } else S.capeTex.needsUpdate = true; S.capeMat.map = S.capeTex; S.capeMat.needsUpdate = true; }
      S.capeOn = !!on && !!canvas;
      S.capeG.visible = S.capeOn && !S.elytraOn;
      applyPose(); S.dirty = true; wake();
    };
    S.refreshCape = () => { if (S.capeTex) { S.capeTex.needsUpdate = true; S.dirty = true; wake(); } if (S.elytraTex) S.elytraTex.needsUpdate = true; };
    S.setElytra = (on, canvas) => {
      if (!S.ready) return;
      if (canvas && (!S.elytraTex || S.elytraTex.image !== canvas)) { if (S.elytraTex && S.elytraTex !== S.capeTex) S.elytraTex.dispose(); S.elytraTex = canvas === S.capeCv && S.capeTex ? S.capeTex : nearestTex(canvas, true); S.wingMat.map = S.elytraTex; S.wingMat.needsUpdate = true; }
      S.elytraOn = !!on && !!S.wingMat.map;
      S.wings.l.visible = S.wings.r.visible = S.elytraOn;
      S.capeG.visible = S.capeOn && !S.elytraOn;
      S.dirty = true; wake();
    };
    S.setMode = (m) => { S.mode = m === 'orbit' ? 'orbit' : 'paint'; el.dataset.mode = S.mode; if (S.mode === 'orbit' && S.onHover) S.onHover(null); };
    S.shot = () => new Promise((res) => {
      if (!S.ready) return res(null);
      resize(); place(); S.renderer.render(S.scene, S.camera);
      S.canvas.toBlob((b) => res(b), 'image/png');
    });

    S.init = () => initP || (initP = loadThree().then(() => {
      try { build(); } catch (e) { S.error = 'WebGL is not available in this browser.'; throw e; }
      S.ready = true;
      buildParts(false);
      applyPose();
      if (S.pending) { const [b, s] = S.pending; S.pending = null; S.setSkin(b, s); }
      new ResizeObserver(() => { S.dirty = true; wake(); }).observe(el);
      new IntersectionObserver((en) => { S.inView = en[en.length - 1].isIntersecting; if (S.inView) S.wake(); }).observe(el);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) S.wake(); });
      window.addEventListener('resize', () => S.wake());
      S.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.ready = false; });
      S.canvas.addEventListener('webglcontextrestored', () => { S.ready = true; S.skinTex.needsUpdate = true; S.gridTex.needsUpdate = true; S.curTex.needsUpdate = true; S.dirty = true; S.onRestore && S.onRestore(); wake(); });
      S.wake();
      return S;
    }).catch((e) => { S.error = S.error || 'Could not start the 3D viewer: ' + (e && e.message ? e.message : e); throw e; }));
    S.setMode('paint');
    return S;
  }

  return { create };
})();
