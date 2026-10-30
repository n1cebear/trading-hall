/**
 * Builds > Create > Make it myself: the quick editor UI on the Builds stage (model: builds-edit.js, chunked meshes,
 * ghost and face picking: builds-view.js).
 *
 *   TH.builds.editorUI.enter(c) / leave(c)   switch the stage into the editor and back
 *   TH.builds.editorUI.side(c)              the side panels: tools, tool options, selection, blocks, canvas, light, files
 *   TH.builds.editorUI.bar(c)               the block bar under the stage (current, recent, favourites, undo / redo)
 *   TH.builds.editorUI.drop(c, schem)       start from a build (a generated shape, a Library build)
 *   TH.builds.editorUI.out()                the canvas as a cropped schematic (export, Material List)
 *
 * Mouse: left = the tool, right-drag = turn, middle / Shift+right / Space+drag = move, wheel = zoom, Alt+click = pick
 * a block, hold E = erase. Touch: one finger = the tool (tap to place), two fingers = move and zoom; the View tool
 * (V) turns with one finger. Keys: 1-9, 0 and Shift+1-5 pick tools, [ and ] move the work layer, Ctrl+Z / Ctrl+Y undo /
 * redo, Ctrl+C / X / V / D copy, cut, paste, repeat, Delete clears the selection, R turns it 90°, Esc cancels.
 * State: state.builds.make = { size, palette, data (run-length), name, block, recent, fav, tool, opt: {...}, mirror, plane }.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const { h, clamp, toast } = TH.util;
  const core = () => TH.builds.core, E = () => TH.builds.edit, D = () => TH.builds.detail, CU = () => TH.builds.createUI;
  const SAVE_CAP = 600000;

  const TOOLS = [
    ['Draw', [['place', 'Place', '1', 'Place blocks on the face you point at (drag to paint)'], ['erase', 'Erase', '2', 'Remove blocks (hold E with any tool)'], ['paint', 'Paint', '3', 'Turn blocks into the current block'], ['pick', 'Pick', '4', 'Take the block you click as the current block (Alt+click with any tool)'], ['fill', 'Fill', '5', 'A block: the connected run of it becomes the current block. Empty ground: fills a closed area of the work layer']]],
    ['Shapes', [['line', 'Line', '6', 'Drag from one point to another'], ['box', 'Box', '7', 'Drag a rectangle on the work layer; its height is in the options'], ['sphere', 'Sphere', '8', 'Drag the footprint: a sphere or ellipsoid'], ['cylinder', 'Cylinder', '9', 'Drag the footprint: a round column'], ['cone', 'Cone', 'Shift+1', 'Drag the footprint: a round cone'], ['pyramid', 'Pyramid', 'Shift+2', 'Drag the footprint: a stepped pyramid']]],
    ['Edit', [['select', 'Select', '0', 'Drag a box to select; then copy, move, turn, repeat ...'], ['move', 'Move', 'Shift+3', 'Drag the selection over the work layer'], ['extrude', 'Extrude', 'Shift+4', 'Push the flat face you click one block out (Shift+click: in)'], ['replace', 'Replace', 'Shift+5', 'Click a block: every block like it (in the selection, else everywhere) becomes the current block'], ['view', 'View', 'V', 'Turn the view with the left button or one finger']]],
  ];
  const TOOL_BY = {};
  TOOLS.forEach(([, list]) => list.forEach((t) => { TOOL_BY[t[0]] = t; }));
  const KEY_TOOL = { Digit1: 'place', Digit2: 'erase', Digit3: 'paint', Digit4: 'pick', Digit5: 'fill', Digit6: 'line', Digit7: 'box', Digit8: 'sphere', Digit9: 'cylinder', Digit0: 'select' };
  const SHIFT_TOOL = { Digit1: 'cone', Digit2: 'pyramid', Digit3: 'move', Digit4: 'extrude', Digit5: 'replace' };
  const ICON = {
    place: ['.......', '.#####.', '.#...#.', '.#.#.#.', '.#...#.', '.#####.', '.......'], erase: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
    paint: ['.####..', '.####..', '.####..', '...#...', '...#...', '...#...', '...#...'], pick: ['.....##', '....###', '...###.', '..###..', '.###...', '.##....', '#......'],
    fill: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..#.#..', '...#...'], line: ['......#', '.....#.', '....#..', '...#...', '..#....', '.#.....', '#......'],
    box: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'], sphere: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
    cylinder: ['.#####.', '#.....#', '.#####.', '#.....#', '#.....#', '#.....#', '.#####.'], cone: ['...#...', '...#...', '..###..', '..###..', '.#####.', '.#####.', '#######'],
    pyramid: ['.......', '...#...', '..###..', '.#####.', '#######', '.......', '.......'], select: ['##.#.##', '#.....#', '.......', '#.....#', '.......', '#.....#', '##.#.##'],
    move: ['...#...', '..###..', '...#...', '#######', '...#...', '..###..', '...#...'], extrude: ['...#...', '..###..', '.#.#.#.', '...#...', '#######', '#######', '.......'],
    replace: ['###....', '#.#..#.', '###.###', '......#', '#.#....', '.###...', '..#....'], view: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'],
    undo: ['..#....', '.##....', '#######', '.##...#', '..#...#', '......#', '..#####'], redo: ['....#..', '....##.', '#######', '#...##.', '#...#..', '#......', '#####..'],
    star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
  };

  /* ---- state ---- */
  const M = { W: null, sel: null, clip: null, stamp: false, drag: null, tempErase: false, saveT: 0, loaded: false, c: null, hoverKey: '' };
  const S = () => M.c.S();
  const mk = () => S().make || {};
  const opt = () => Object.assign({ brush: 1, round: false, boxMode: 'solid', shapeH: 5, auto: true, hollow: false, overwrite: false, selH: 0, rep: 2, repDir: 'x', gap: 0 }, mk().opt || {});
  const saveMk = (fn) => M.c.save((b) => { b.make = b.make || {}; fn(b.make); });

  function load() {
    if (M.W) return M.W;
    const r = mk();
    let W = null;
    try {
      if (r.size && r.data && r.palette) {
        const s = core().create(r.size[0], r.size[1], r.size[2], r.name || 'My build');
        s.palette = r.palette.slice(); s.blocks = core().unrle(r.data, r.size[0] * r.size[1] * r.size[2]);
        if (Array.isArray(r.be)) s.be = r.be;
        W = E().create(s, { pad: 0, min: 1 });
      }
    } catch (e) { W = null; }
    M.W = W || E().create([48, 48, 48], { name: 'My build' });
    if (r.mirror) Object.assign(M.W.mirror, r.mirror);
    return M.W;
  }
  function persist() {
    clearTimeout(M.saveT);
    M.saveT = setTimeout(() => {
      const W = M.W; if (!W) return;
      const data = core().rle(W.s.blocks);
      if (data.length > SAVE_CAP) return;   // too big to keep after a reload: it stays for this visit
      const be = W.s.be && W.s.be.length && JSON.stringify(W.s.be).length < 200000 ? W.s.be : null;
      saveMk((m) => { m.size = W.s.size.slice(); m.palette = W.s.palette.slice(); m.data = data; m.name = W.s.name; m.be = be; m.mirror = Object.assign({}, W.mirror); });
    }, 700);
  }

  /* ---- the stage ---- */
  function V() { return M.c.V(); }
  function enter(c) {
    M.c = c;
    const W = load(), v = V();
    if (!v || !v.ready) return;
    v.setEdit(W.s, { layer: 'top' });
    v.setPlane(clamp(mk().plane || 0, 0, W.s.size[1] - 1));
    v.editInput = input;
    v.keyFilter = keys; v.keyUp = keyUp;
    v.auto = false; v.autoOk = false;   // no slow turn while you build
    // the layer slider under the stage covers the canvas
    const UI = c.UI();
    if (UI && UI.layer) { UI.layer.max = W.s.size[1]; UI.layer.value = W.s.size[1]; UI.layer.dispatchEvent(new Event('input')); }
    showMirror();
    refresh();
  }
  function leave() {
    const v = V();
    if (v && v.inEdit && v.inEdit()) { v.setSymmetry(null); v.leaveEdit(); v.setAuto(!!S().auto); }
    M.drag = null; M.stamp = false;
  }
  function dirty(box) { if (!box) return; const v = V(); if (v) v.editDirty(box); persist(); refresh(); }
  function showMirror() {
    const v = V(), W = M.W; if (!v || !W) return;
    const planes = ['x', 'y', 'z'].map((k, a) => (W.mirror[k] ? { axis: a, m: W.s.size[a] } : null)).filter(Boolean);
    v.setSymmetry(planes.length ? { schem: W.s, planes, flags: null } : null);
  }

  /* ---- the current block, oriented the way you place it ---- */
  const cur = () => mk().block || 'minecraft:stone_bricks';
  function useBlock(id) {
    id = core().parse(id).base;
    saveMk((m) => { m.block = id; m.recent = [id].concat((m.recent || []).filter((x) => x !== id)).slice(0, 10); });
    refresh();
  }
  /** Stairs face the way you look, slabs go on top when you click under a block, logs follow the face, others face you. */
  function orient(id, res) {
    const p = core().parse(id), d = core().def(id), v = V();
    const look = v ? [-Math.sin(v.yaw), -Math.cos(v.yaw)] : [0, -1];
    const hz = Math.abs(look[0]) > Math.abs(look[1]) ? (look[0] > 0 ? 'east' : 'west') : (look[1] > 0 ? 'south' : 'north');
    const opp = { north: 'south', south: 'north', east: 'west', west: 'east' };
    const pr = {};
    const n = res && res.n ? res.n : [0, 1, 0];
    if (d.shape === 'stairs') { pr.facing = hz; pr.half = n[1] < 0 ? 'top' : 'bottom'; }
    else if (d.shape === 'slab') pr.type = n[1] < 0 ? 'top' : 'bottom';
    else if (d.axis) pr.axis = n[0] ? 'x' : n[2] ? 'z' : 'y';
    else if (/_trapdoor$/.test(p.name)) { pr.facing = opp[hz]; pr.half = n[1] < 0 ? 'top' : 'bottom'; }
    else if (p.name === 'end_rod' || /lightning_rod$/.test(p.name) || /amethyst_(cluster|bud)$/.test(p.name)) pr.facing = n[1] > 0 ? 'up' : n[1] < 0 ? 'down' : n[0] > 0 ? 'east' : n[0] < 0 ? 'west' : n[2] > 0 ? 'south' : 'north';
    else if (/chain$/.test(p.name)) pr.axis = n[0] ? 'x' : n[2] ? 'z' : 'y';
    else if (/(chest|furnace|smoker|barrel|observer|dispenser|dropper|carved_pumpkin|jack_o_lantern|glazed_terracotta|lectern|loom|stonecutter|beehive|anvil)$/.test(p.name)) pr.facing = /observer/.test(p.name) ? hz : opp[hz];
    return D().complete(core().stateOf(p.base, pr));
  }

  /* ---- input ---- */
  const tool = () => (M.tempErase ? 'erase' : mk().tool || 'place');
  const I = (x, y, z) => M.W.I(x, y, z);
  const inB = (q) => M.W.inB(q[0], q[1], q[2]);
  function shapeCells(t, a, b) {
    const W = M.W, o = opt();
    if (t === 'box') return W.box(a, b, o.boxMode);
    if (t === 'sphere') return W.ellipsoid(a, b, o.hollow);
    if (t === 'cylinder') return W.cylinder(a, b, o.hollow);
    if (t === 'cone') return W.cone(a, b);
    if (t === 'pyramid') return W.pyramid(a, b);
    if (t === 'select') return W.box(a, b, 'frame');
    return [];
  }
  /** The far corner of a dragged footprint on the work layer of `a`, with the height the tool wants. */
  function footprint(e, a, t) {
    const v = V(), pt = v.rayPlane(e, a[1]);
    if (!pt) return null;
    const [sx, sy, sz] = M.W.s.size, o = opt();
    const bx = clamp(Math.floor(pt[0]), 0, sx - 1), bz = clamp(Math.floor(pt[1]), 0, sz - 1);
    const w = Math.abs(bx - a[0]) + 1, d = Math.abs(bz - a[2]) + 1;
    let H = o.shapeH;
    if (t === 'sphere' && o.auto) H = Math.min(w, d);
    if ((t === 'cone' || t === 'pyramid') && o.auto) H = t === 'pyramid' ? Math.ceil(Math.min(w, d) / 2) : Math.max(w, d);
    if (t === 'select') H = o.selH || topIn(a[0], bx, a[2], bz) - a[1] + 1;
    return [bx, clamp(a[1] + Math.max(1, H) - 1, 0, sy - 1), bz];
  }
  /** Highest block over a footprint (selection height 'up to the top'). */
  function topIn(x0, x1, z0, z1) {
    const s = M.W.s, [sx, sy, sz] = s.size;
    for (let y = sy - 1; y >= 0; y--) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (s.blocks[(y * sz + z) * sx + x]) return y;
    return 0;
  }
  const ghost = (cells, o) => { const v = V(); if (v) v.setGhost(cells, o); };
  function idle() {
    // nothing pending: the selection's frame, if there is one
    if (M.sel) ghost(M.W.box([M.sel[0], M.sel[1], M.sel[2]], [M.sel[3], M.sel[4], M.sel[5]], 'frame'));
    else ghost(null);
  }
  function hoverCells(e) {
    const t = tool(), r = V().pickFace(e);
    if (!r) return null;
    if (M.stamp && M.clip) return { cells: clipCells(M.clip, stampAt(r)) };
    const o = opt();
    if (t === 'place') return inB(r.place) ? { cells: M.W.brush(r.place[0], r.place[1], r.place[2], o.brush, o.round) } : null;
    if (t === 'erase' || t === 'paint' || t === 'pick' || t === 'replace') return r.hit ? { cells: t === 'pick' || t === 'replace' ? [I(...r.hit)] : M.W.brush(r.hit[0], r.hit[1], r.hit[2], o.brush, o.round), erase: t === 'erase' } : null;
    if (t === 'fill') return r.hit ? { cells: [I(...r.hit)] } : inB(r.place) ? { cells: [I(...r.place)] } : null;
    if (t === 'extrude') return r.hit ? { cells: M.W.faceRegion(r.hit[0], r.hit[1], r.hit[2], r.n).map((i) => { const [x, y, z] = M.W.XYZ(i), q = [x + r.n[0], y + r.n[1], z + r.n[2]]; return inB(q) ? I(...q) : -1; }).filter((i) => i >= 0) } : null;
    if (['line', 'box', 'sphere', 'cylinder', 'cone', 'pyramid', 'select', 'move'].includes(t)) return inB(r.place) ? { cells: [I(...r.place)] } : null;
    return null;
  }
  function stampAt(r) { const [w, , d] = M.clip.size; return [r.place[0] - Math.floor(w / 2), r.place[1], r.place[2] - Math.floor(d / 2)]; }
  function clipCells(clip, at) {
    const out = [], [w, hh, d] = clip.size;
    for (let y = 0; y < hh; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (clip.blocks[(y * d + z) * w + x]) { const q = [x + at[0], y + at[1], z + at[2]]; if (inB(q)) out.push(I(...q)); }
    return out;
  }
  const input = {
    hover(e) {
      const k = e.clientX + ',' + e.clientY;
      if (k === M.hoverKey) return;
      M.hoverKey = k;
      const g = hoverCells(e);
      if (g) ghost(g.cells, { erase: g.erase }); else idle();
      const r = V().pickFace(e);
      status(r && r.hit ? core().nameOf(core().get(M.W.s, ...r.hit)) + ' · x ' + r.hit[0] + ' y ' + r.hit[1] + ' z ' + r.hit[2] : r ? 'x ' + r.place[0] + ' y ' + r.place[1] + ' z ' + r.place[2] : '');
    },
    leave() { idle(); status(''); },
    down(e) {
      const t = tool();
      if (t === 'view') return false;
      const r = V().pickFace(e);
      if (e.altKey) { if (r && r.hit) useBlock(core().get(M.W.s, ...r.hit)); return true; }
      if (!r) return true;
      const W = M.W, o = opt();
      if (M.stamp && M.clip) { dirty(W.paste(M.clip, stampAt(r))); return true; }
      if (t === 'place' || t === 'erase' || t === 'paint') {
        const st = { tool: t, last: null, cells: new Set(), res: r };
        M.drag = st;
        addStroke(r);
        return true;
      }
      if (t === 'pick') { if (r.hit) useBlock(core().get(W.s, ...r.hit)); return true; }
      if (t === 'fill') { dirty(r.hit ? W.flood(r.hit[0], r.hit[1], r.hit[2], orient(cur(), r)) : W.fillLayer(r.place[0], r.place[1], r.place[2], orient(cur(), r)) || (toast('That area is open to the edge of the canvas, so nothing was filled'), null)); return true; }
      if (t === 'replace') { if (r.hit) { const from = core().get(W.s, ...r.hit); dirty(W.replace(M.sel, from, cur())); toast('Every ' + core().nameOf(from) + (M.sel ? ' in the selection' : '') + ' is now ' + core().nameOf(cur())); } return true; }
      if (t === 'extrude') { if (r.hit) dirty(W.extrude(r.hit[0], r.hit[1], r.hit[2], r.n, !e.shiftKey)); return true; }
      if (t === 'move') {
        if (!M.sel) { toast('Select something first (Select tool, 0)'); return true; }
        M.drag = { tool: 'move', y: M.sel[1], start: V().rayPlane(e, M.sel[1]), d: [0, 0, 0] };
        return true;
      }
      if (!inB(r.place)) return true;
      M.drag = { tool: t, a: r.place.slice(), b: r.place.slice(), res: r };
      input.move(e);
      return true;
    },
    move(e) {
      const st = M.drag; if (!st) return;
      if (st.tool === 'place' || st.tool === 'erase' || st.tool === 'paint') { const r = V().pickFace(e); if (r) addStroke(r); return; }
      if (st.tool === 'move') {
        const pt = V().rayPlane(e, st.y); if (!pt || !st.start) return;
        st.d = [Math.round(pt[0] - st.start[0]), 0, Math.round(pt[1] - st.start[1])];
        const s = M.sel;
        ghost(M.W.box([s[0] + st.d[0], s[1], s[2] + st.d[2]], [s[3] + st.d[0], s[4], s[5] + st.d[2]], 'frame'));
        return;
      }
      if (st.tool === 'line') { const r = V().pickFace(e); if (r && inB(r.place)) st.b = r.place.slice(); ghost(M.W.line(st.a, st.b, opt().brush)); return; }
      const b = footprint(e, st.a, st.tool);
      if (b) st.b = b;
      ghost(shapeCells(st.tool, st.a, st.b));
      status(st.tool === 'select' ? 'Selection ' + dims(st.a, st.b) : TOOL_BY[st.tool][1] + ' ' + dims(st.a, st.b));
    },
    up() {
      const st = M.drag; M.drag = null;
      if (!st) return;
      const W = M.W, o = opt();
      if (st.stroke) { dirty(st.stroke.end()); idle(); return; }
      if (st.tool === 'move') { if (st.d && (st.d[0] || st.d[2])) { dirty(W.move(M.sel, st.d)); M.sel = [M.sel[0] + st.d[0], M.sel[1], M.sel[2] + st.d[2], M.sel[3] + st.d[0], M.sel[4], M.sel[5] + st.d[2]]; } idle(); refresh(); return; }
      if (st.tool === 'select') { M.sel = [Math.min(st.a[0], st.b[0]), Math.min(st.a[1], st.b[1]), Math.min(st.a[2], st.b[2]), Math.max(st.a[0], st.b[0]), Math.max(st.a[1], st.b[1]), Math.max(st.a[2], st.b[2])]; idle(); refresh(); return; }
      const cells = st.tool === 'line' ? W.line(st.a, st.b, o.brush) : shapeCells(st.tool, st.a, st.b);
      dirty(W.apply(cells, orient(cur(), st.res), o.overwrite ? 'set' : 'place', TOOL_BY[st.tool][1]));
      idle();
    },
    cancel() { const st = M.drag; M.drag = null; if (st && st.stroke) dirty(st.stroke.end()); idle(); },
  };
  const dims = (a, b) => (Math.abs(b[0] - a[0]) + 1) + ' × ' + (Math.abs(b[1] - a[1]) + 1) + ' × ' + (Math.abs(b[2] - a[2]) + 1);
  /** A painting stroke: one undo step, the chunks re-meshed as it goes. */
  function addStroke(r) {
    const st = M.drag, W = M.W, o = opt();
    const p = st.tool === 'place' ? r.place : r.hit;
    if (!p || !inB(p)) return;
    const k = p.join();
    if (st.last === k) return;
    st.last = k;
    if (!st.stroke) st.stroke = W.stroke(TOOL_BY[st.tool][1]);
    const box = st.stroke.add(W.brush(p[0], p[1], p[2], o.brush, o.round), st.tool === 'erase' ? null : orient(cur(), r), st.tool === 'erase' ? 'erase' : st.tool === 'paint' ? 'paint' : 'place');
    if (box) { const v = V(); if (v) v.editDirty(box); }
  }

  /* ---- keys ---- */
  function keys(e) {
    const W = M.W, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return true; }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return true; }
    if (ctrl && e.key === 'c' && M.sel) { e.preventDefault(); M.clip = W.copy(M.sel); toast('Copied ' + dims(M.sel, M.sel.slice(3))); return true; }
    if (ctrl && e.key === 'x' && M.sel) { e.preventDefault(); M.clip = W.copy(M.sel); dirty(W.del(M.sel)); return true; }
    if (ctrl && e.key === 'v' && M.clip) { e.preventDefault(); M.stamp = true; toast('Click to place the copy · Esc to stop'); return true; }
    if (ctrl && e.key === 'd' && M.sel) { e.preventDefault(); repeat(1); return true; }
    if (ctrl || e.altKey) return false;
    if (e.code in KEY_TOOL && !e.shiftKey) { setTool(KEY_TOOL[e.code]); return true; }
    if (e.code in SHIFT_TOOL && e.shiftKey) { setTool(SHIFT_TOOL[e.code]); return true; }
    if (e.key === 'v' || e.key === 'V') { setTool('view'); return true; }
    if (e.key === 'e' || e.key === 'E') { if (!M.tempErase) { M.tempErase = true; refresh(); } e.preventDefault(); return true; }
    if (e.key === '[' || e.key === ']') { setPlane((V().planeY || 0) + (e.key === ']' ? 1 : -1)); return true; }
    if (e.key === 'Escape') { M.stamp = false; if (M.drag) input.cancel(); else { M.sel = null; idle(); refresh(); } return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && M.sel) { dirty(W.del(M.sel)); return true; }
    if ((e.key === 'r' || e.key === 'R') && M.sel) { turn({ y: 90 }); return true; }
    return false;
  }
  function keyUp(e) { if ((e.key === 'e' || e.key === 'E') && M.tempErase) { M.tempErase = false; refresh(); } }
  function setTool(t) { M.stamp = false; saveMk((m) => { m.tool = t; }); M.c.patch(); idle(); }
  function setPlane(y) { const v = V(); y = clamp(y, 0, M.W.s.size[1] - 1); v.setPlane(y); saveMk((m) => { m.plane = y; }); const sl = M.c.UI().side.querySelector('[data-param="plane"]'); if (sl && sl.setValue) sl.setValue(y); }
  function undo() { const b = M.W.undo(); if (b) dirty(b); else toast('Nothing to undo'); }
  function redo() { const b = M.W.redo(); if (b) dirty(b); else toast('Nothing to redo'); }
  function repeat(n) { const o = opt(), s = M.sel, w = [s[3] - s[0] + 1, s[4] - s[1] + 1, s[5] - s[2] + 1], ax = { x: 0, y: 1, z: 2 }[o.repDir] || 0, step = [0, 0, 0]; step[ax] = w[ax] + o.gap; dirty(M.W.stack(s, n || o.rep, step)); }
  function turn(a) {
    const s = M.sel; if (!s) return;
    const before = M.W.count(), box = M.W.turn(s, a);
    if (!box) return;
    dirty(box);
    // the selection follows the turned blocks
    M.sel = [box[0], box[1], box[2], box[3], box[4], box[5]].map((v, i) => clamp(v, 0, M.W.s.size[i % 3] - 1));
    if (M.W.count() < before) toast('Some blocks went past the edge of the canvas or were merged');
    idle();
  }

  /* ---- side panels ---- */
  let statusEl = null;
  function status(t) { if (statusEl) statusEl.textContent = t; }
  function refresh() {
    if (!M.c || !M.c.UI() || !M.W) return;
    const UI = M.c.UI();
    if (UI.makeCount) UI.makeCount.textContent = M.c.fmtN(M.W.count()) + ' blocks · canvas ' + M.W.s.size.join(' × ');
    if (UI.undoB) { UI.undoB.disabled = !M.W.canUndo(); UI.redoB.disabled = !M.W.canRedo(); }
    UI.side.querySelectorAll('.bd-tool').forEach((b) => { const on = b.dataset.tool === tool(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const bar = UI.viewer.querySelector('.bd-mbar');
    if (bar) bar.replaceWith(blockBar(M.c));
    const selP = UI.side.querySelector('.bd-selpanel');
    if (selP) { selP.hidden = !M.sel; const t2 = selP.querySelector('.bd-count'); if (t2 && M.sel) t2.textContent = dims(M.sel, M.sel.slice(3)); }
    if (UI.title && V() && V().inEdit && V().inEdit()) { UI.title.textContent = M.W.s.name || 'My build'; UI.meta.textContent = M.c.fmtN(M.W.count()) + ' blocks · canvas ' + M.W.s.size.join(' × '); }
  }
  function glyphOf(name) { M.c.GLYPH[name] = M.c.GLYPH[name] || ICON[name]; return M.c.glyph(name); }
  function toolsPanel(c) {
    const groups = TOOLS.map(([label, list]) => h('div.bd-tgrp', h('div.bd-tlbl', label), h('div.bd-tkeys', list.map(([id, name, key, what]) => {
      const b = h('button.btn.small.bd-tool', { type: 'button', 'data-tool': id, 'aria-pressed': String(tool() === id), class: tool() === id ? 'on' : null, onclick: () => setTool(id) }, glyphOf(id), h('span', name));
      c.tip(b, () => [h('div.th-tooltip-title', name + ' · ' + key), h('div.th-tooltip-sub', what)]);
      return b;
    }))));
    statusEl = h('p.bd-note.bd-mstatus', { 'aria-live': 'polite' });
    return h('section.panel.bd-pan.bd-tools.has-sel', { 'aria-label': 'Tools' }, h('div.bd-pan-head', h('h3', 'Make it myself'), c.UI().makeCount = h('span.bd-count')), h('div.bd-tgroups', groups), statusEl);
  }
  function optionsPanel(c) {
    const t = tool(), o = opt(), CUx = CU();
    const set = (k, v) => { saveMk((m) => { m.opt = Object.assign({}, m.opt || {}, { [k]: v }); }); };
    const rows = [];
    if (['place', 'erase', 'paint', 'line'].includes(t)) {
      rows.push(CUx.numRow(c, 'Brush', 1, 9, 1, o.brush, (v) => set('brush', v), { tip: 'Size of the brush in blocks' }));
      if (t !== 'line') rows.push(CUx.switchRow(c, 'Round', o.round, (v) => set('round', v), 'a ball, not a cube'));
    }
    if (t === 'box') rows.push(CUx.segRow(c, 'Fill', [['solid', 'Solid'], ['hollow', 'Hollow'], ['walls', 'Walls'], ['frame', 'Frame']], o.boxMode, (v) => set('boxMode', v)));
    if (['sphere', 'cylinder'].includes(t)) rows.push(CUx.switchRow(c, 'Hollow', o.hollow, (v) => set('hollow', v), 'only the shell'));
    if (['box', 'cylinder', 'sphere', 'cone', 'pyramid'].includes(t)) {
      if (t !== 'box' && t !== 'cylinder') rows.push(CUx.switchRow(c, 'Auto height', o.auto, (v) => set('auto', v), t === 'sphere' ? 'as round as the footprint' : 'from the footprint'));
      rows.push(CUx.numRow(c, 'Height', 1, 128, 1, o.shapeH, (v) => set('shapeH', v)));
      rows.push(CUx.switchRow(c, 'Overwrite', o.overwrite, (v) => set('overwrite', v), 'replace blocks in the way'));
    }
    if (t === 'select') rows.push(CUx.numRow(c, 'Height', 0, 128, 1, o.selH, (v) => set('selH', v), { tip: '0 = up to the highest block in the box' }));
    const hint = { place: 'Click a face to put a block on it, or the grid to start on the work layer. Drag to paint.', erase: 'Click or drag over blocks to remove them.', paint: 'Click or drag over blocks to turn them into the current block.', pick: 'Click a block to build with it.', fill: 'Click a block to fill its connected run, or the floor inside a closed outline.', line: 'Drag from the start to the end.', box: 'Drag on the work layer; the height is set here.', sphere: 'Drag the footprint on the work layer.', cylinder: 'Drag the footprint on the work layer.', cone: 'Drag the footprint on the work layer.', pyramid: 'Drag the footprint on the work layer.', select: 'Drag a box. Then use the selection panel or the keys.', move: 'Drag the selection to its new place.', extrude: 'Click a flat face to push it out; Shift+click pulls it in.', replace: 'Click a block: every one like it becomes the current block.', view: 'Drag to turn, right-drag to move, wheel to zoom.' }[t];
    return h('section.panel.bd-pan.bd-topts', { 'aria-label': 'Tool options' }, h('div.bd-pan-head', h('h3', TOOL_BY[t][1]), h('span.bd-count', 'key ' + TOOL_BY[t][2])), h('p.bd-note', hint), rows);
  }
  function selPanel(c) {
    const o = opt(), CUx = CU();
    const set = (k, v) => saveMk((m) => { m.opt = Object.assign({}, m.opt || {}, { [k]: v }); });
    const key = (label, fn, t) => c.tip(h('button.btn.small', { type: 'button', onclick: fn }, label), t);
    const need = (fn) => () => { if (!M.sel) { toast('Select something first'); return; } fn(); };
    let ang = { x: 0, y: 90, z: 0, order: 'YXZ', smooth: false };
    const angEl = CUx.angle({ c, get: () => ang, set: (pt) => { Object.assign(ang, pt); angEl.setSize(M.sel ? 'Turns to ' + TH.builds.rotate.bounds([M.sel[3] - M.sel[0] + 1, M.sel[4] - M.sel[1] + 1, M.sel[5] - M.sel[2] + 1], ang).join(' × ') : ''); }, smooth: true, title: 'Turn the selection' });
    const p = h('section.panel.bd-pan.bd-selpanel', { 'aria-label': 'Selection', hidden: !M.sel },
      h('div.bd-pan-head', h('h3', 'Selection'), h('span.bd-count', M.sel ? dims(M.sel, M.sel.slice(3)) : '')),
      h('div.bd-actions', key('Copy', need(() => { M.clip = M.W.copy(M.sel); toast('Copied'); }), 'Ctrl+C'), key('Cut', need(() => { M.clip = M.W.copy(M.sel); dirty(M.W.del(M.sel)); }), 'Ctrl+X'),
        key('Paste', () => { if (!M.clip) { toast('Copy something first'); return; } M.stamp = true; toast('Click to place the copy · Esc to stop'); }, 'Ctrl+V: the copy follows the pointer, click to place it'),
        key('Delete', need(() => dirty(M.W.del(M.sel))), 'Delete'), key('Fill', need(() => dirty(M.W.apply(M.W.box(M.sel.slice(0, 3), M.sel.slice(3), 'solid'), cur(), 'set', 'Fill'))), 'Fill the box with the current block'),
        key('Deselect', () => { M.sel = null; idle(); refresh(); }, 'Esc')),
      h('div.bd-sub', 'Repeat'),
      CUx.numRow(c, 'Copies', 1, 32, 1, o.rep, (v) => set('rep', v)),
      CUx.segRow(c, 'Along', [['x', 'X'], ['y', 'Y'], ['z', 'Z']], o.repDir, (v) => set('repDir', v)),
      CUx.numRow(c, 'Gap', 0, 16, 1, o.gap, (v) => set('gap', v)),
      h('div.bd-actions', key('Repeat', need(() => repeat()), 'Ctrl+D repeats once')),
      h('div.bd-sub', 'Flip and scale'),
      h('div.bd-actions', key('Flip X', need(() => dirty(M.W.flip(M.sel, 0))), 'Mirror east and west (stairs turn too)'), key('Flip Y', need(() => dirty(M.W.flip(M.sel, 1))), 'Upside down'), key('Flip Z', need(() => dirty(M.W.flip(M.sel, 2))), 'Mirror north and south'),
        key('× 2', need(() => { dirty(M.W.scale(M.sel, 2)); }), 'Twice as big'), key('× ½', need(() => dirty(M.W.scale(M.sel, 0.5))), 'Half the size')),
      angEl,
      h('div.bd-actions', key('Turn', need(() => turn(Object.assign({}, ang, { level: 'medium' }))), 'Turn the selection by the angle above (R turns 90° about Y)')));
    return p;
  }
  function blocksPanel(c) {
    const id = cur(), fav = (mk().fav || []).includes(id);
    const btn = h('button.btn.bd-swap', { type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      c.closePickers();
      if (open) return;
      btn.setAttribute('aria-expanded', 'true');
      btn.after(c.blockPicker({ ids: placeable(), current: id, label: 'Build with', onPick: (x) => { c.closePickers(); useBlock(x); c.patch(); } }));
    } }, core().blockIcon(id, { size: 24 }), h('span.bd-swap-txt', h('span.bd-swap-name', core().nameOf(id)), h('span.bd-swap-was', 'Click to pick another block')), c.glyph('swap', 'bd-swap-ico'));
    const star = c.tip(h('button.btn.small.bd-vk.sq' + (fav ? '.on' : ''), { type: 'button', 'aria-pressed': String(fav), 'aria-label': 'Favourite', onclick: () => { saveMk((m) => { const f = m.fav || []; m.fav = f.includes(id) ? f.filter((x) => x !== id) : [id].concat(f).slice(0, 16); }); c.patch(); } }, glyphOf('star')), fav ? 'Remove from favourites' : 'Add to favourites');
    return h('section.panel.bd-pan', { 'aria-label': 'Block' }, h('div.bd-pan-head', h('h3', 'Block')), h('div.bd-partrow', btn, star),
      h('p.bd-note', 'Stairs face the way you look, slabs and logs follow the face you click, Alt+click picks a block from the build.'));
  }
  let placeCache = null;
  function placeable() {
    if (placeCache) return placeCache;
    const C = core(), DB = (TH.data && TH.data.blockDb && TH.data.blockDb.b) || {};
    placeCache = [...new Set(Object.keys(C.BLOCKS).concat(Object.keys(DB)))].filter((n) => C.known('minecraft:' + n) && !/^(air|cave_air|void_air|structure_void|moving_piston|piston_head|bubble_column|end_gateway|end_portal|nether_portal|fire|soul_fire|light|barrier)$/.test(n) && !/_wall_(sign|banner|torch|fan|hanging_sign|head|skull)$/.test(n));
    return placeCache;
  }
  function canvasPanel(c) {
    const W = M.W, CUx = CU(), [sx, sy, sz] = W.s.size;
    const sizes = [32, 48, 64, 96, 128, 192, 256];
    const grow = (n) => {
      const [a, b, d] = W.s.size, size = [Math.max(n, 1), Math.max(n, 1), Math.max(n, 1)];
      if (size[0] < a || size[1] < b || size[2] < d) {
        const bb = core().bbox(W.s);
        if (bb && (bb.max[0] - bb.min[0] >= n || bb.max[1] - bb.min[1] >= n || bb.max[2] - bb.min[2] >= n)) { toast('The build is bigger than that'); return; }
      }
      const bb = core().bbox(W.s), off = bb ? [Math.floor((size[0] - (bb.max[0] - bb.min[0] + 1)) / 2) - bb.min[0], -bb.min[1], Math.floor((size[2] - (bb.max[2] - bb.min[2] + 1)) / 2) - bb.min[2]] : [0, 0, 0];
      W.grow(size, off); M.sel = null; enter(c); persist(); c.patch();
      toast('The canvas is now ' + size.join(' × ') + ' (the undo history starts again)');
    };
    const mir = (k, L, t) => { const b = c.tip(h('button.btn.small.bd-vk' + (W.mirror[k] ? '.on' : ''), { type: 'button', 'aria-pressed': String(!!W.mirror[k]), onclick: () => { W.mirror[k] = !W.mirror[k]; b.classList.toggle('on', W.mirror[k]); b.setAttribute('aria-pressed', String(W.mirror[k])); showMirror(); persist(); } }, c.glyph('mirror'), h('span', L)), t); return b; };
    const plane = CUx.numRow(c, 'Work layer', 0, sy - 1, 1, clamp(mk().plane || 0, 0, sy - 1), (v) => setPlane(v), { tip: 'The grid you build on when you click empty space ([ and ] move it)', pid: 'plane' });
    return h('section.panel.bd-pan', { 'aria-label': 'Canvas' }, h('div.bd-pan-head', h('h3', 'Canvas'), h('span.bd-count', sx + ' × ' + sy + ' × ' + sz)),
      CUx.segRow(c, 'Size', sizes.map((n) => [n, String(n)]), sizes.includes(sx) && sx === sy && sy === sz ? sx : null, (v) => grow(v), { aria: 'Canvas size' }),
      plane,
      h('div.bd-prow2.bd-colrow', h('span.bd-plabel', 'Mirror'), h('div.bd-actions', mir('x', 'X', 'Every edit is mirrored east–west across the middle'), mir('y', 'Y', 'Mirrored top–bottom'), mir('z', 'Z', 'Mirrored north–south'))),
      h('div.bd-actions',
        c.tip(h('button.btn.small', { type: 'button', onclick: () => { const s = CU().schem(c); dirty(W.drop(s)); toast('Added ' + s.name); } }, c.glyph('plus'), 'Add the generator’s shape'), 'Put the shape from Generate into the middle of the canvas'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => { if (!W.count()) return; dirty(W.clearAll()); M.sel = null; } }, c.glyph('x'), 'Clear'), 'Remove every block (Ctrl+Z brings it back)')));
  }
  function lightPanel(c) {
    const L = Object.assign({}, CU().XF_LIGHT, mk().light || {}, { on: true });
    const el = CU().light({ c, toggle: false, paletteRamp: false, get: () => L, set: (pt) => { Object.assign(L, pt); saveMk((m) => { m.light = Object.assign({}, L); }); } });
    const bake = () => {
      const ramp = TH.builds.shade.rampOf(L.ramp || 'stone');
      dirty(M.W.shade(M.sel, { az: L.az, el: L.el, ramp, steps: L.steps, contrast: L.contrast / 100, dither: L.dither / 100, ao: L.ao / 100, rim: L.rim / 100, shadows: L.shadows, colour: (L.tint || L.hue) ? { light: L.colour, shadow: L.shadowC, tint: L.tint / 100, hue: L.hue / 100, pool: L.pool } : null }));
    };
    return h('section.panel.bd-pan.bd-mlight', { 'aria-label': 'Light' }, h('div.bd-pan-head', h('h3', 'Shade by light')),
      h('p.bd-note', 'Repaints the building blocks along a ramp from shadow to highlight, lit from this direction. One undo step.'), el,
      h('div.bd-actions', c.tip(h('button.btn.small.primary', { type: 'button', onclick: bake }, 'Bake shading'), 'Into the selection, or the whole build when nothing is selected')));
  }
  function filesPanel(c) {
    const out = () => M.W.out(M.W.s.name || 'My build');
    const UI = c.UI();
    UI.undoB = c.tip(h('button.btn.small', { type: 'button', onclick: undo, disabled: !M.W.canUndo() }, glyphOf('undo'), 'Undo'), 'Ctrl+Z');
    UI.redoB = c.tip(h('button.btn.small', { type: 'button', onclick: redo, disabled: !M.W.canRedo() }, glyphOf('redo'), 'Redo'), 'Ctrl+Y or Ctrl+Shift+Z');
    const name = h('input.field', { type: 'text', value: M.W.s.name || 'My build', 'aria-label': 'Name', maxlength: 60, oninput: (e) => { M.W.s.name = e.target.value.trim() || 'My build'; UI.title.textContent = M.W.s.name; persist(); } });
    return h('section.panel.bd-pan.bd-create-acts', { 'aria-label': 'Your build' },
      h('div.bd-pan-head', h('h3', 'Your build')), name,
      h('div.bd-actions', UI.undoB, UI.redoB),
      h('div.bd-actions',
        c.tip(h('button.btn.small.primary', { type: 'button', onclick: () => c.exportAs(out(), 'schem') }, c.glyph('down'), '.schem'), '.schem (Sponge 2): WorldEdit, FAWE, Axiom, Litematica'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.exportAs(out(), 'litematic') }, '.litematic'), 'Litematica schematic'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.exportAs(out(), 'json') }, 'JSON'), 'This toolbox’s own format'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.keep(out()) }, c.glyph('file'), 'Keep in Library'), 'Add it to your builds'),
        c.tip(h('button.btn.small', { type: 'button', onclick: () => c.toMats('edit') }, 'Material list'), 'The blocks it needs')));
  }
  function side(c) {
    M.c = c; load();
    return [toolsPanel(c), optionsPanel(c), selPanel(c), blocksPanel(c), canvasPanel(c), lightPanel(c), filesPanel(c)];
  }
  /** Under the stage: the current block, recent and favourite blocks as quick keys. */
  function blockBar(c) {
    M.c = c;
    const m = mk(), now = cur();
    const key = (id, kind) => c.tip(h('button.btn.small.bd-bkey' + (id === now ? '.on' : ''), { type: 'button', 'aria-pressed': String(id === now), 'aria-label': core().nameOf(id), onclick: () => { useBlock(id); } }, core().blockIcon(id, { size: 20 })), core().nameOf(id) + (kind ? ' · ' + kind : ''));
    const fav = (m.fav || []).slice(0, 10), rec = (m.recent || []).filter((x) => !fav.includes(x)).slice(0, 8);
    return h('div.bd-mbar', { role: 'group', 'aria-label': 'Blocks' },
      h('span.bd-bar-lbl', 'Block'), key(now),
      fav.length ? [h('span.bd-bar-lbl', 'Favourites'), fav.map((x) => key(x, 'favourite'))] : null,
      rec.length ? [h('span.bd-bar-lbl', 'Recent'), rec.map((x) => key(x, 'recent'))] : null);
  }
  function drop(c, s) {
    M.c = c;
    const W = load();
    const need = [s.size[0] + 4, s.size[1] + 2, s.size[2] + 4];
    if (need.some((v, a) => v > W.s.size[a])) {
      const n = Math.max(...need, ...W.s.size);
      const size = [Math.max(n, W.s.size[0]), Math.max(n, W.s.size[1]), Math.max(n, W.s.size[2])];
      W.grow(size, [Math.floor((size[0] - W.s.size[0]) / 2), 0, Math.floor((size[2] - W.s.size[2]) / 2)]);
    }
    const box = W.drop(s);
    if (V() && V().inEdit && V().inEdit()) dirty(box); else persist();
    return box;
  }
  TH.builds.editorUI = { enter, leave, side, bar: blockBar, drop, out: () => (M.W ? M.W.out(M.W.s.name || 'My build') : null), load: () => load(), refresh, ICON };
})();
