/**
 * Builds rotation (pure, no DOM): turn a schematic about X (pitch), Y (yaw) and Z (roll), any angle, in 3D.
 *
 *   rotate(s, o)        o = { x, y, z (degrees), order: 'YXZ' | 'XYZ' | 'ZYX' ..., pivot: 'centre' | 'base' | 'corner',
 *                       smooth: false | true, level, off (detail kinds switched off), fast }. Returns a new schematic
 *                       (the same object when every angle is 0, so an unrotated build stays exactly as it was).
 *   matrix(o)           the 3 x 3 rotation (rows), order 'YXZ' = first Y, then X, then Z.
 *   rotState(id, R, o)  a block state turned by the axis-snapped rotation of R (see "States" below).
 *   bounds(size, o)     the size of the rotated box (for the live size readout, without rotating).
 *
 * Angles: +Y turns east toward north (counter-clockwise seen from above), +X turns up toward south, +Z turns east
 * toward up (right-hand rule on each axis).
 *
 * Multiples of 90 degrees are exact: every cell moves to exactly one cell (lossless, 4 steps give the original back).
 * Other angles resample: every output cell looks back into the source at 9 points (centre + 8 octants); cells on the
 * surface take all 64 sub-samples, from the real shape of slabs, stairs, snow and trapdoors. Exact blocks: a cell is
 * filled when at least half of it is covered (majority block, its state turned). Smooth edges: the detail toolkit
 * picks the best stairs / slab / trapdoor / wall for the coverage. A seal pass then restores face connections
 * between blocks that only touch at an edge or a corner, so a closed shape stays watertight. Thin things (rods,
 * panes, plants, lanterns, torches ...) are carried as items: their cell centre moves, and connection states
 * (panes, bars, fences, walls) are re-derived from the new neighbours.
 *
 * States: facings, axes, stair halves, slab sides, trapdoors, attached blocks (face + facing), connection sides and
 * rail shapes are turned with the rotation snapped to the nearest quarter turns. What the game cannot show snaps to
 * the nearest valid state: a slab on its side becomes a double slab (so walls stay closed), stairs turned so that
 * both halves lie sideways keep their facing and become bottom stairs, a horizontal-only block (stairs, doors,
 * chests ...) whose facing turns up or down keeps its facing; signs, banners and heads (rotation 0-15) turn in
 * 22.5 degree steps by the yaw (exact for 22.5 multiples).
 * Block entities and entities move with their block / position; entity yaw, item frame and painting facings turn too.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const DT = () => TH.builds.detail;
  const RAD = Math.PI / 180;
  const DIR = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  const nameOfVec = (v) => {
    const a = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
    if (a[1] >= a[0] && a[1] >= a[2]) return v[1] > 0 ? 'up' : 'down';
    if (a[0] >= a[2]) return v[0] > 0 ? 'east' : 'west';
    return v[2] > 0 ? 'south' : 'north';
  };
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };

  /* ======================================================================
   * Matrices
   * ====================================================================== */
  const cs = (deg) => {
    const q = ((deg % 360) + 360) % 360;
    if (q === 0) return [1, 0]; if (q === 90) return [0, 1]; if (q === 180) return [-1, 0]; if (q === 270) return [0, -1];
    return [Math.cos(q * RAD), Math.sin(q * RAD)];
  };
  function axisMat(ax, deg) {
    const [c, s] = cs(deg);
    if (ax === 'X') return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (ax === 'Y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  }
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const app = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
  const tr = (R) => [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  const ORDERS = ['YXZ', 'XYZ', 'ZXY', 'ZYX'];
  const angleOf = (o, ax) => +((o && o[ax.toLowerCase()]) || 0) || 0;
  /** Rotation matrix: the axes in `order` are applied first to last. */
  function matrix(o) {
    const order = ORDERS.includes(o && o.order) ? o.order : 'YXZ';
    let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const ax of order) R = mul(axisMat(ax, angleOf(o, ax)), R);
    return R;
  }
  const isZero = (o) => !angleOf(o, 'X') && !angleOf(o, 'Y') && !angleOf(o, 'Z') || ['X', 'Y', 'Z'].every((a) => angleOf(o, a) % 360 === 0);
  const is90 = (o) => ['X', 'Y', 'Z'].every((a) => angleOf(o, a) % 90 === 0);
  /** The rotation snapped to the nearest axis permutation (for block states): each axis goes to its closest axis, once. */
  function snap(R) {
    const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], usedRow = new Set();
    // columns = images of the unit axes; assign greedily by the largest |entry|
    const ent = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ent.push([Math.abs(R[i][j]), i, j]);
    ent.sort((a, b) => b[0] - a[0]);
    const usedCol = new Set();
    for (const [, i, j] of ent) { if (usedRow.has(i) || usedCol.has(j)) continue; out[i][j] = R[i][j] >= 0 ? 1 : -1; usedRow.add(i); usedCol.add(j); }
    // keep it a rotation (det +1): flip the weakest assignment if it came out mirrored
    const det = out[0][0] * (out[1][1] * out[2][2] - out[1][2] * out[2][1]) - out[0][1] * (out[1][0] * out[2][2] - out[1][2] * out[2][0]) + out[0][2] * (out[1][0] * out[2][1] - out[1][1] * out[2][0]);
    if (det < 0) { const w = ent.filter(([, i, j]) => out[i][j]).pop(); out[w[1]][w[2]] *= -1; }
    return out;
  }

  /* ======================================================================
   * States
   * ====================================================================== */
  const SIX = /observer|piston|dispenser|dropper|^end_rod$|lightning_rod|amethyst_cluster|amethyst_bud|^barrel$|shulker_box|command_block|^hopper$|^crafter$/;
  const rotVecName = (Rs, name) => nameOfVec(app(Rs, DIR[name]));
  const RAIL_ENDS = { north_south: ['north', 'south'], east_west: ['east', 'west'], south_east: ['south', 'east'], south_west: ['south', 'west'], north_west: ['north', 'west'], north_east: ['north', 'east'] };
  function railShape(shape, Rs) {
    if (/^ascending_/.test(shape)) { const d = rotVecName(Rs, shape.slice(10)); return d === 'up' || d === 'down' ? shape : 'ascending_' + d; }
    const ends = RAIL_ENDS[shape];
    if (!ends) return shape;
    const e = ends.map((d) => rotVecName(Rs, d));
    if (e.some((d) => d === 'up' || d === 'down')) return shape;
    const has = (a) => e.includes(a);
    if (has('north') && has('south')) return 'north_south';
    if (has('east') && has('west')) return 'east_west';
    return (has('north') ? 'north' : 'south') + '_' + (has('east') ? 'east' : 'west');
  }
  const stCache = new Map();
  /** A block state turned by Rs (an axis permutation, see snap) and yaw (degrees, for 0-15 rotations). */
  function rotState(id, Rs, yaw, R) {
    const key = id + '|' + Rs.flat().join() + '|' + yaw + '|' + (R ? R.flat().map((v) => v.toFixed(3)).join() : '');
    let out = stCache.get(key);
    if (out) return out;
    const core = C(), p = core.parse(id), pr = Object.assign({}, p.props), n = p.name, d = core.def(id);
    const hz = (v) => v !== 'up' && v !== 'down';
    if (Object.keys(pr).length) {
      // stairs: the bottom half and the back half are the two halves of one shape; whichever ends up vertical is the half
      if (d.shape === 'stairs' && pr.facing && pr.half) {
        const h = rotVecName(Rs, pr.half === 'top' ? 'up' : 'down'), f = rotVecName(Rs, pr.facing);
        if (!hz(h)) { pr.half = h === 'up' ? 'top' : 'bottom'; pr.facing = f; }
        else if (!hz(f)) { pr.half = f === 'up' ? 'top' : 'bottom'; pr.facing = h; pr.shape = 'straight'; }
        else { pr.facing = f; pr.half = 'bottom'; pr.shape = 'straight'; }
      } else if (d.shape === 'slab' && (pr.type === 'top' || pr.type === 'bottom')) {
        const h = rotVecName(Rs, pr.type === 'top' ? 'up' : 'down');
        pr.type = h === 'up' ? 'top' : h === 'down' ? 'bottom' : 'double';
      } else if (/_trapdoor$/.test(n) && pr.facing) {
        // the panel's outward side: down / up when closed, the side opposite the facing when open
        const nrm = rotVecName(Rs, pr.open === 'true' ? OPP[pr.facing] : pr.half === 'top' ? 'up' : 'down');
        if (hz(nrm)) { pr.open = 'true'; pr.facing = OPP[nrm]; }
        else { pr.open = 'false'; pr.half = nrm === 'up' ? 'top' : 'bottom'; const f = rotVecName(Rs, pr.facing); if (hz(f)) pr.facing = f; }
      } else if (pr.face && pr.facing) {
        // buttons, levers, grindstones, bells: what they hang on
        const a = rotVecName(Rs, pr.face === 'floor' ? 'down' : pr.face === 'ceiling' ? 'up' : OPP[pr.facing]);
        if (hz(a)) { pr.face = 'wall'; pr.facing = OPP[a]; }
        else { pr.face = a === 'down' ? 'floor' : 'ceiling'; const f = rotVecName(Rs, pr.facing); if (hz(f)) pr.facing = f; }
      } else if (pr.facing && DIR[pr.facing]) {
        const f = rotVecName(Rs, pr.facing);
        if (hz(f) || SIX.test(n) || (n === 'hopper' && f === 'down')) pr.facing = f;
        else if (n === 'pointed_dripstone') { /* dripstone uses vertical_direction */ }
      }
      if (n === 'pointed_dripstone' && pr.vertical_direction) { const v = rotVecName(Rs, pr.vertical_direction); if (!hz(v)) pr.vertical_direction = v; }
      if (pr.axis && /^[xyz]$/.test(pr.axis)) { const v = app(Rs, pr.axis === 'x' ? [1, 0, 0] : pr.axis === 'y' ? [0, 1, 0] : [0, 0, 1]); pr.axis = Math.abs(v[0]) ? 'x' : Math.abs(v[1]) ? 'y' : 'z'; }
      if (pr.shape && n.endsWith('rail')) pr.shape = railShape(pr.shape, Rs);
      if (pr.rotation != null && /^\d+$/.test(pr.rotation)) {
        // 16 steps of 22.5 degrees, 0 = facing south, turning clockwise seen from above
        const r = +pr.rotation, th = r * 22.5 * RAD, dir = [-Math.sin(th), 0, Math.cos(th)];
        let v = R ? app(R, dir) : app(Rs, dir);
        if (Math.hypot(v[0], v[2]) <= 0.3) v = app(axisMat('Y', yaw || 0), dir);   // tipped onto its back: only the yaw counts
        if (Math.hypot(v[0], v[2]) > 0.3) pr.rotation = String(((Math.round(Math.atan2(-v[0], v[2]) / RAD / 22.5) % 16) + 16) % 16);
      }
      // connection sides (fences, walls, panes, vines, mushroom blocks, glow lichen ...): the sides move with the block
      const sides = ['north', 'south', 'east', 'west', 'up', 'down'].filter((k) => pr[k] != null);
      if (sides.length >= 2) {
        const old = {}; sides.forEach((k) => { old[k] = pr[k]; });
        const dflt = (k) => (d.shape === 'wall' ? (k === 'up' ? 'true' : 'none') : 'false');
        sides.forEach((k) => { pr[k] = dflt(k); });
        sides.forEach((k) => { const t = rotVecName(Rs, k); if (pr[t] != null || sides.includes(t)) pr[t] = old[k]; });
      }
    }
    out = core.stateOf(p.base, DT() ? DT().sortProps(pr) : pr);
    if (Object.keys(p.props).length && !Object.keys(pr).length) out = id;
    stCache.set(key, out);
    if (stCache.size > 20000) stCache.clear();
    return out;
  }

  /* ---- entities: position, yaw, facing bytes, hanging block positions ---- */
  const FACE6 = ['down', 'up', 'north', 'south', 'west', 'east'];
  const FACE4 = ['south', 'west', 'north', 'east'];
  function rotEntity(e, Rs, R, fwd, yaw) {
    const nbt = Object.assign({}, e.nbt || {});
    const rot = nbt.Rotation;
    if (rot && rot[0] === 9 && rot[1] && Array.isArray(rot[1][1]) && rot[1][1].length >= 1) {
      // yaw 0 faces south, 90 west: turning the build counter-clockwise by a turns the entity by -a
      const ys = +rot[1][1][0], th = ys * RAD, dir = app(R, [-Math.sin(th), 0, Math.cos(th)]);
      const ny = Math.hypot(dir[0], dir[2]) > 1e-6 ? Math.atan2(-dir[0], dir[2]) / RAD : ys;
      nbt.Rotation = [9, [rot[1][0], [Math.round(ny * 1000) / 1000].concat(rot[1][1].slice(1))]];
    }
    if (nbt.Facing && (nbt.Facing[0] === 1 || nbt.Facing[0] === 3)) {
      const f = FACE6[nbt.Facing[1]];
      if (f) nbt.Facing = [nbt.Facing[0], FACE6.indexOf(rotVecName(Rs, f))];
    }
    if (nbt.facing && (nbt.facing[0] === 1 || nbt.facing[0] === 3)) {
      const f = FACE4[nbt.facing[1]];
      if (f) { const t = rotVecName(Rs, f); if (FACE4.includes(t)) nbt.facing = [nbt.facing[0], FACE4.indexOf(t)]; }
    }
    const cell = (x, y, z) => fwd([x + 0.5, y + 0.5, z + 0.5]).map(Math.floor);
    if (nbt.TileX && nbt.TileY && nbt.TileZ) { const q = cell(nbt.TileX[1], nbt.TileY[1], nbt.TileZ[1]); nbt.TileX = [nbt.TileX[0], q[0]]; nbt.TileY = [nbt.TileY[0], q[1]]; nbt.TileZ = [nbt.TileZ[0], q[2]]; }
    if (nbt.block_pos && nbt.block_pos[0] === 11 && nbt.block_pos[1].length === 3) nbt.block_pos = [11, cell(...nbt.block_pos[1])];
    return { pos: fwd(e.pos), id: e.id, nbt };
  }

  /* ======================================================================
   * The rotation
   * ====================================================================== */
  /** Pivot of a box (cell-edge coordinates). */
  const pivotOf = (size, pv) => (pv === 'corner' ? [0, 0, 0] : pv === 'base' ? [size[0] / 2, 0, size[2] / 2] : [size[0] / 2, size[1] / 2, size[2] / 2]);
  function frame(size, o) {
    const R = matrix(o), P = pivotOf(size, o && o.pivot);
    const fwd = (v) => { const q = app(R, [v[0] - P[0], v[1] - P[1], v[2] - P[2]]); return [q[0] + P[0], q[1] + P[1], q[2] + P[2]]; };
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const cx of [0, size[0]]) for (const cy of [0, size[1]]) for (const cz of [0, size[2]]) {
      const q = fwd([cx, cy, cz]);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); }
    }
    lo = lo.map((v) => Math.round(v * 1e6) / 1e6); hi = hi.map((v) => Math.round(v * 1e6) / 1e6);
    const out = [0, 1, 2].map((a) => Math.max(1, Math.ceil(hi[a] - lo[a] - 1e-6)));
    return { R, P, fwd, lo, out };
  }
  /** Size of the rotated box, without rotating (the live readout). */
  function bounds(size, o) { return isZero(o) ? size.slice() : frame(size, o).out; }

  // full block behind a partial one (quartz_stairs -> quartz_block), so the smooth pass can choose its parts again
  let fullIdx = null;
  function fullOf(id) {
    const core = C(), d = core.def(id), p = core.parse(id);
    if (d.shape === 'cube') return p.base;
    if (!fullIdx) {
      fullIdx = new Map();
      const names = Object.keys(core.BLOCKS).concat(TH.data && TH.data.blockDb ? Object.keys(TH.data.blockDb.b) : []);
      for (const n of names) {
        if (core.def('minecraft:' + n).shape !== 'cube') continue;
        for (const k of ['stairs', 'slab', 'wall']) { const v = DT().variant(n, k); if (v && !fullIdx.has(v)) fullIdx.set(v, 'minecraft:' + n); }
      }
      // prefer the block of the same name (quartz_slab -> quartz_block, not smooth_quartz)
      names.forEach((n) => { ['stairs', 'slab', 'wall'].forEach((k) => { const v = 'minecraft:' + n.replace(/s$/, '') + '_' + k; if (fullIdx.has(v) && core.def('minecraft:' + n).shape === 'cube' && DT().variant(n, k) === v) fullIdx.set(v, 'minecraft:' + n); }); });
    }
    return fullIdx.get(p.base) || null;
  }

  function rotate(s, o) {
    o = o || {};
    if (!s || isZero(o)) return s;
    const core = C(), D = DT();
    const [sx, sy, sz] = s.size, F = frame(s.size, o), { R, fwd, lo, out } = F;
    const Rs = snap(R), yaw = angleOf(o, 'Y');
    const [ox, oy, oz] = out;
    const res = core.create(ox, oy, oz, s.name);
    const B = s.blocks, OB = res.blocks;
    const rstate = (pi) => (pi ? rotState(s.palette[pi], Rs, yaw, R) : null);
    const palMap = new Int32Array(s.palette.length).fill(-1);
    const mapPal = (pi) => { if (palMap[pi] < 0) palMap[pi] = core.pal(res, rstate(pi)); return palMap[pi]; };
    const thin = s.palette.map((id, i) => i > 0 && D.isThin(id));
    const masks = s.palette.map((id, i) => (i && !thin[i] ? D.shapeMask(id) : D.EMPTY));
    const fullM = masks.map((m) => m[0] === 0xffffffff && m[1] === 0xffffffff);
    const cellOut = (q) => [Math.floor(q[0] - lo[0] + 1e-7), Math.floor(q[1] - lo[1] + 1e-7), Math.floor(q[2] - lo[2] + 1e-7)];
    const oidx = (x, y, z) => (y * oz + z) * ox + x;
    const inO = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < ox && y < oy && z < oz;
    const thinList = [];

    if (is90(o)) {
      // exact: every cell moves to one cell
      for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) {
        const v = B[i];
        if (!v) continue;
        const q = cellOut(fwd([x + 0.5, y + 0.5, z + 0.5]));
        if (inO(q[0], q[1], q[2])) OB[oidx(q[0], q[1], q[2])] = mapPal(v);
      }
    } else {
      // resample: look back into the source
      const Rt = tr(R), P = F.P;
      const sAt = (vx, vy, vz) => {
        const cx = Math.floor(vx), cy = Math.floor(vy), cz = Math.floor(vz);
        if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return 0;
        const v = B[(cy * sz + cz) * sx + cx];
        if (!v || thin[v]) return 0;
        if (fullM[v]) return v;
        const b = D.bitOf(Math.min(3, Math.floor((vx - cx) * 4)), Math.min(3, Math.floor((vy - cy) * 4)), Math.min(3, Math.floor((vz - cz) * 4)));
        return (masks[v][b >> 5] >>> (b & 31)) & 1 ? v : 0;
      };
      const back = (ux, uy, uz) => { const a = ux - P[0], b = uy - P[1], c = uz - P[2]; return [Rt[0][0] * a + Rt[0][1] * b + Rt[0][2] * c + P[0], Rt[1][0] * a + Rt[1][1] * b + Rt[1][2] * c + P[1], Rt[2][0] * a + Rt[2][1] * b + Rt[2][2] * c + P[2]]; };
      const level = o.smooth ? (o.level || 'medium') : 'low', allow = D.allowed(level, o.off);
      const OCT = [0.25, 0.75];
      const cov = new Uint8Array(ox * oy * oz);   // 0..64 coverage, for the seal pass
      const tally = new Map();
      const sub = [];
      for (let k = 0; k < 4; k++) sub.push((k + 0.5) / 4);
      for (let y = 0; y < oy; y++) for (let z = 0; z < oz; z++) for (let x = 0; x < ox; x++) {
        const wx = lo[0] + x, wy = lo[1] + y, wz = lo[2] + z;
        const c = back(wx + 0.5, wy + 0.5, wz + 0.5);
        if (c[0] < -1 || c[1] < -1 || c[2] < -1 || c[0] > sx + 1 || c[1] > sy + 1 || c[2] > sz + 1) continue;
        const v0 = sAt(c[0], c[1], c[2]);
        if (o.fast) { if (v0) { OB[oidx(x, y, z)] = mapPal(v0); cov[oidx(x, y, z)] = 64; } continue; }
        let hits = v0 ? 1 : 0, same = true;
        for (const fy of OCT) for (const fz of OCT) for (const fx of OCT) {
          const q = back(wx + fx, wy + fy, wz + fz), v = sAt(q[0], q[1], q[2]);
          if (v) hits++;
          if (v !== v0) same = false;
        }
        const i = oidx(x, y, z);
        if (same) { if (v0) { OB[i] = mapPal(v0); cov[i] = 64; } continue; }
        // a surface cell: all 64 sub-samples
        const m = [0, 0];
        tally.clear();
        let n = 0;
        for (let by = 0; by < 4; by++) for (let bz = 0; bz < 4; bz++) for (let bx = 0; bx < 4; bx++) {
          const q = back(wx + sub[bx], wy + sub[by], wz + sub[bz]), v = sAt(q[0], q[1], q[2]);
          if (!v) continue;
          n++;
          const b = D.bitOf(bx, by, bz); m[b >> 5] = (m[b >> 5] | (1 << (b & 31))) >>> 0;
          tally.set(v, (tally.get(v) || 0) + 1);
        }
        cov[i] = n;
        if (!n) continue;
        let best = 0, bn = -1;
        tally.forEach((k, v) => { if (k > bn) { bn = k; best = v; } });
        if (o.smooth) {
          const full = fullOf(s.palette[best]);
          if (full) { const idc = D.choose(m, { block: full, allow }); if (idc) OB[i] = core.pal(res, idc); continue; }
        }
        if (n >= 32) OB[i] = mapPal(best);
      }
      seal(res, cov);
    }
    // thin things ride along with their cell centre
    for (let y = 0, i = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++, i++) if (B[i] && thin[B[i]]) thinList.push([x, y, z, B[i]]);
    const lostThin = [];
    if (!is90(o)) for (const [x, y, z, v] of thinList) {
      const q = cellOut(fwd([x + 0.5, y + 0.5, z + 0.5]));
      let put = false;
      for (const d of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const X = q[0] + d[0], Y = q[1] + d[1], Z = q[2] + d[2];
        if (inO(X, Y, Z) && !OB[oidx(X, Y, Z)]) { OB[oidx(X, Y, Z)] = mapPal(v); put = true; break; }
      }
      if (!put) lostThin.push([x, y, z]);
    }
    // block entities follow their block; entities and ticks follow their position
    const toOut = (v) => { const q = fwd(v); return [q[0] - lo[0], q[1] - lo[1], q[2] - lo[2]]; };
    const used = new Set();
    const findCell = (bx, by, bz, base) => {
      const q = cellOut(fwd([bx + 0.5, by + 0.5, bz + 0.5]));
      for (let r = 0; r <= 1; r++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const X = q[0] + dx, Y = q[1] + dy, Z = q[2] + dz;
        if (!inO(X, Y, Z) || used.has(oidx(X, Y, Z))) continue;
        const v = OB[oidx(X, Y, Z)];
        if (v && core.parse(res.palette[v]).base === base) return [X, Y, Z];
      }
      return null;
    };
    if (s.be) {
      res.be = [];
      for (const b of s.be) {
        const base = core.parse(core.get(s, b.x, b.y, b.z)).base, c = findCell(b.x, b.y, b.z, base);
        if (c) { used.add(oidx(c[0], c[1], c[2])); res.be.push(Object.assign({}, b, { x: c[0], y: c[1], z: c[2] })); }
        else (res.beLost = res.beLost || []).push({ x: b.x, y: b.y, z: b.z, id: b.id, from: base, to: 'rotation' });
      }
    }
    if (s.ents) res.ents = s.ents.map((e) => rotEntity(e, Rs, R, toOut, yaw));
    if (s.ticks) {
      const mv = (t) => { const c = cellOut(fwd([t.x + 0.5, t.y + 0.5, t.z + 0.5])); return inO(c[0], c[1], c[2]) ? Object.assign({}, t, { x: c[0], y: c[1], z: c[2] }) : null; };
      res.ticks = { block: (s.ticks.block || []).map(mv).filter(Boolean), fluid: (s.ticks.fluid || []).map(mv).filter(Boolean) };
    }
    ['dv', 'src', 'declared'].forEach((k) => { if (s[k] != null) res[k] = s[k]; });
    const r0 = s.origin || [0, 0, 0];
    res.origin = [r0[0] + Math.round(lo[0]), r0[1] + Math.round(lo[1]), r0[2] + Math.round(lo[2])];
    if (lostThin.length) Object.defineProperty(res, 'lostThin', { value: lostThin.length });
    D.connect(res);
    return is90(o) ? res : core.trim(res);
  }

  /**
   * Restore face connections: two filled cells that touch only at an edge (or a corner) get the cell between them with
   * the most coverage filled, with the block of one of them. Keeps a rotated closed shape watertight.
   */
  function seal(s, cov) {
    const core = C(), [sx, sy, sz] = s.size, B = s.blocks;
    const solid = s.palette.map((id, i) => i > 0 && !DT().isThin(id));
    const fullBlock = s.palette.map((id, i) => (i && solid[i] ? (core.def(id).shape === 'cube' ? i : (() => { const f = fullOf(id); return f ? core.pal(s, f) : i; })()) : 0));
    const f = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && solid[B[(y * sz + z) * sx + x]];
    const I = (x, y, z) => (y * sz + z) * sx + x;
    for (let pass = 0; pass < 2; pass++) {
      let added = 0;
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        if (!f(x, y, z)) continue;
        const a = B[I(x, y, z)];
        // edge diagonals (two axes), forward half only
        for (const [dx, dy, dz] of [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]]) {
          if (!f(x + dx, y + dy, z + dz)) continue;
          // the two cells that share a face with both: one step along each of the two axes
          const steps = [[dx, 0, 0], [0, dy, 0], [0, 0, dz]].filter((v) => v[0] || v[1] || v[2]);
          const p1 = [x + steps[0][0], y + steps[0][1], z + steps[0][2]], p2 = [x + steps[1][0], y + steps[1][1], z + steps[1][2]];
          if (f(...p1) || f(...p2)) continue;
          const c1 = cov[I(...p1)] || 0, c2 = cov[I(...p2)] || 0, pick = c1 >= c2 ? p1 : p2;
          B[I(...pick)] = fullBlock[a] || a; cov[I(...pick)] = 64; added++;
        }
        // corner diagonals (three axes): is there a face path through two filled cells?
        for (const [dx, dy, dz] of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]]) {
          if (!f(x + dx, y + dy, z + dz)) continue;
          const e = [[dx, 0, 0], [0, dy, 0], [0, 0, dz]];
          let ok = false, best = null, bc = -1;
          for (let i = 0; i < 3 && !ok; i++) for (let j = 0; j < 3 && !ok; j++) {
            if (i === j) continue;
            const q1 = [x + e[i][0], y + e[i][1], z + e[i][2]], q2 = [q1[0] + e[j][0], q1[1] + e[j][1], q1[2] + e[j][2]];
            if (f(...q1) && f(...q2)) ok = true;
            else { const c = (f(...q1) ? 64 : cov[I(...q1)] || 0) + (f(...q2) ? 64 : cov[I(...q2)] || 0); if (c > bc) { bc = c; best = [q1, q2]; } }
          }
          if (ok || !best) continue;
          for (const q of best) if (!f(...q)) { B[I(...q)] = fullBlock[a] || a; cov[I(...q)] = 64; added++; }
        }
      }
      if (!added) break;
    }
    return s;
  }

  TH.builds.rotate = { rotate, matrix, rotState, bounds, isZero, is90, snap, fullOf, ORDERS, seal };
})();
