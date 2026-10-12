/**
 * Builds loader + exporter (no UI).
 *
 *   TH.builds.io.load(file | { name, bytes }) -> Promise<Schematic>     detects the format from the bytes
 *   TH.builds.io.toJSON(schem) -> string                                 our own format (n1cebear-schematic v1)
 *   TH.builds.io.fromJSON(obj) -> Schematic                              also reads the layer-string format of the built-in farms
 *   TH.builds.io.toSchem(schem) -> Promise<Uint8Array>                   Sponge .schem v2, gzipped
 *
 * Formats read: our JSON, Sponge .schem v1 / v2 / v3, Litematica .litematic (all regions merged), vanilla structure
 * .nbt, MCEdit / WorldEdit legacy .schematic (numeric ids, common blocks only). Gzip goes through the browser's
 * DecompressionStream; uncompressed NBT is read as is.
 *
 * Errors are thrown as Error objects whose message is a plain sentence for the user.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';
  const C = () => TH.builds.core;
  const MAX_BLOCKS = 300000;      // non-air blocks we are willing to show
  const MAX_VOLUME = 6000000;     // cells of the bounding box (memory)
  const fail = (msg) => { const e = new Error(msg); e.user = true; return e; };

  /* ======================================================================
   * gzip
   * ====================================================================== */
  const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') throw fail('This browser cannot unpack compressed schematic files. Try a current Chrome, Edge, Firefox or Safari.');
    try { return await pipe(bytes, new DecompressionStream('gzip')); } catch (e) { throw fail('This file looks compressed but could not be unpacked. It may be damaged.'); }
  }
  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') throw fail('This browser cannot write compressed files. Use the JSON download instead.');
    return pipe(bytes, new CompressionStream('gzip'));
  }

  /* ======================================================================
   * NBT (big endian, Java edition)
   * Tags are read into plain JS values: compounds -> objects, lists -> arrays, byte/int arrays -> typed arrays,
   * long arrays -> { longs: Int32Array of [lo, hi] pairs }, longs -> Number when safe (BigInt text otherwise).
   * ====================================================================== */
  function readNBT(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    const need = (n) => { if (p + n > bytes.length) throw fail('This file ends too early. It may be damaged or cut off.'); };
    const u8 = () => { need(1); return bytes[p++]; };
    const i16 = () => { need(2); const v = dv.getInt16(p); p += 2; return v; };
    const i32 = () => { need(4); const v = dv.getInt32(p); p += 4; return v; };
    const str = () => {
      need(2); const n = dv.getUint16(p); p += 2; need(n);
      const s = new TextDecoder('utf-8').decode(bytes.subarray(p, p + n)); p += n; return s;
    };
    let depth = 0;
    function payload(t) {
      switch (t) {
        case 1: need(1); return dv.getInt8(p++);
        case 2: return i16();
        case 3: return i32();
        case 4: { need(8); const hi = dv.getInt32(p), lo = dv.getUint32(p + 4); p += 8; return hi * 4294967296 + lo; }
        case 5: { need(4); const v = dv.getFloat32(p); p += 4; return v; }
        case 6: { need(8); const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { const n = i32(); if (n < 0) throw fail('This file has a broken byte array.'); need(n); const a = new Int8Array(bytes.buffer.slice(bytes.byteOffset + p, bytes.byteOffset + p + n)); p += n; return a; }
        case 8: return str();
        case 9: {
          const et = u8(), n = i32();
          if (n < 0 || n > 50000000) throw fail('This file has a broken list.');
          if (++depth > 512) throw fail('This file is nested too deeply.');
          const a = new Array(n);
          for (let i = 0; i < n; i++) a[i] = payload(et);
          depth--;
          return a;
        }
        case 10: {
          if (++depth > 512) throw fail('This file is nested too deeply.');
          const o = {};
          for (;;) {
            const tt = u8();
            if (tt === 0) break;
            const name = str();
            o[name] = payload(tt);
          }
          depth--;
          return o;
        }
        case 11: { const n = i32(); if (n < 0) throw fail('This file has a broken int array.'); need(4 * n); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getInt32(p + 4 * i); p += 4 * n; return a; }
        case 12: {
          const n = i32(); if (n < 0) throw fail('This file has a broken long array.'); need(8 * n);
          const a = new Int32Array(2 * n);   // [lo, hi] per long: bit k of long i is bit k of the 64-bit word stream
          for (let i = 0; i < n; i++) { a[2 * i + 1] = dv.getInt32(p + 8 * i); a[2 * i] = dv.getInt32(p + 8 * i + 4); }
          p += 8 * n;
          return { longs: a, length: n };
        }
        default: throw fail('This file isn’t a schematic I can read (unknown data inside).');
      }
    }
    const t = u8();
    if (t !== 10) throw fail('This file isn’t a schematic I can read.');
    const name = str();
    return { name, value: payload(10) };
  }

  /** Minimal NBT writer: values tagged as [type, value]. */
  function writeNBT(rootName, compound) {
    const chunks = [];
    let size = 0;
    const push = (u8) => { chunks.push(u8); size += u8.length; };
    const num = (bytesN, fn) => { const b = new Uint8Array(bytesN); fn(new DataView(b.buffer)); push(b); };
    const enc = new TextEncoder();
    const wstr = (s) => { const b = enc.encode(s); num(2, (d) => d.setUint16(0, b.length)); push(b); };
    function wpay(t, v) {
      switch (t) {
        case 1: num(1, (d) => d.setInt8(0, v)); break;
        case 2: num(2, (d) => d.setInt16(0, v)); break;
        case 3: num(4, (d) => d.setInt32(0, v)); break;
        case 7: num(4, (d) => d.setInt32(0, v.length)); push(new Uint8Array(v.buffer, v.byteOffset, v.length)); break;
        case 8: wstr(v); break;
        case 9: { const [et, arr] = v; num(1, (d) => d.setInt8(0, arr.length ? et : 0)); num(4, (d) => d.setInt32(0, arr.length)); arr.forEach((x) => wpay(et, x)); break; }
        case 10: Object.entries(v).forEach(([k, [tt, vv]]) => { num(1, (d) => d.setInt8(0, tt)); wstr(k); wpay(tt, vv); }); num(1, (d) => d.setInt8(0, 0)); break;
        case 11: num(4, (d) => d.setInt32(0, v.length)); num(4 * v.length, (d) => v.forEach((x, i) => d.setInt32(4 * i, x))); break;
        case 12: { const n = v.length / 2; num(4, (d) => d.setInt32(0, n)); num(8 * n, (d) => { for (let i = 0; i < n; i++) { d.setInt32(8 * i, v[2 * i + 1]); d.setInt32(8 * i + 4, v[2 * i]); } }); break; }   // Int32Array of [lo, hi] pairs
        default: throw new Error('nbt type ' + t);
      }
    }
    num(1, (d) => d.setInt8(0, 10)); wstr(rootName); wpay(10, compound);
    const out = new Uint8Array(size);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  /* ======================================================================
   * Format readers (each returns a Schematic)
   * ====================================================================== */
  const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
  function guard(sx, sy, sz) {
    if (!(sx > 0 && sy > 0 && sz > 0)) throw fail('This schematic is empty.');
    if (sx * sy * sz > MAX_VOLUME) throw fail('This build is too big for the viewer (' + sx + ' x ' + sy + ' x ' + sz + '). Try a smaller selection, up to about 300,000 blocks.');
  }
  function finish(s) {
    const n = C().volume(s);
    if (!n) throw fail('This schematic has no blocks in it, only air.');
    if (n > MAX_BLOCKS) throw fail('This build has ' + n.toLocaleString('en') + ' blocks. The viewer handles up to ' + MAX_BLOCKS.toLocaleString('en') + ', so please export a smaller part.');
    return C().trim(C().compact(s));
  }
  /** Unsigned LEB128 varints (Sponge BlockData). */
  function readVarints(bytes, count) {
    const out = new Uint16Array(count);
    let p = 0;
    for (let i = 0; i < count; i++) {
      let v = 0, shift = 0, b;
      do {
        if (p >= bytes.length) throw fail('The block data in this file is shorter than its size says.');
        b = bytes[p++] & 0xff; v |= (b & 0x7f) << shift; shift += 7;
      } while (b & 0x80 && shift < 35);
      if (v > 65535) throw fail('This file uses more block types than the viewer supports.');
      out[i] = v;
    }
    return out;
  }
  function writeVarints(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) { let v = arr[i]; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
    return Int8Array.from(out.map((b) => (b > 127 ? b - 256 : b)));
  }

  /** Sponge .schem v1 / v2 (root = Schematic) and v3 (root.Schematic, blocks under Blocks). */
  function readSponge(root, name) {
    const S = root.Schematic && typeof root.Schematic === 'object' && !Array.isArray(root.Schematic) ? root.Schematic : root;
    const ver = num(S.Version);
    const sx = num(S.Width) & 0xffff, sy = num(S.Height) & 0xffff, sz = num(S.Length) & 0xffff;
    guard(sx, sy, sz);
    const B = ver >= 3 ? (S.Blocks || {}) : S;
    const palObj = B.Palette, data = ver >= 3 ? B.Data : S.BlockData;
    if (!palObj || !data) throw fail('This .schem file has no block palette or block data.');
    const pal = [];
    Object.entries(palObj).forEach(([state, i]) => { pal[num(i)] = state; });
    const idx = readVarints(new Uint8Array(data.buffer, data.byteOffset, data.length), sx * sy * sz);
    const s = C().create(sx, sy, sz, name);
    const map = pal.map((st) => (st ? C().pal(s, st) : 0));
    for (let i = 0; i < idx.length; i++) s.blocks[i] = map[idx[i]] || 0;   // Sponge index = (y * Length + z) * Width + x, same as ours
    return s;
  }

  /** Litematica: every region placed at its position (negative sizes grow backwards), bit-packed palette indices spanning longs. */
  function readLitematic(root, name) {
    const regs = root.Regions || {};
    const list = Object.entries(regs).map(([rn, r]) => {
      const P = r.Position || {}, Z = r.Size || {};
      const sx = num(Z.x), sy = num(Z.y), sz = num(Z.z);
      const ax = Math.abs(sx), ay = Math.abs(sy), az = Math.abs(sz);
      const x0 = num(P.x) + (sx < 0 ? sx + 1 : 0), y0 = num(P.y) + (sy < 0 ? sy + 1 : 0), z0 = num(P.z) + (sz < 0 ? sz + 1 : 0);
      return { rn, r, ax, ay, az, x0, y0, z0 };
    }).filter((g) => g.ax && g.ay && g.az);
    if (!list.length) throw fail('This .litematic file has no regions with blocks.');
    const mx = Math.min(...list.map((g) => g.x0)), my = Math.min(...list.map((g) => g.y0)), mz = Math.min(...list.map((g) => g.z0));
    const W = Math.max(...list.map((g) => g.x0 + g.ax)) - mx, H = Math.max(...list.map((g) => g.y0 + g.ay)) - my, L = Math.max(...list.map((g) => g.z0 + g.az)) - mz;
    guard(W, H, L);
    const s = C().create(W, H, L, (root.Metadata && root.Metadata.Name) || name);
    list.forEach((g) => {
      const palL = g.r.BlockStatePalette || [];
      const states = palL.map((e) => {
        const props = e.Properties || {};
        return C().stateOf(e.Name || 'minecraft:air', Object.keys(props).length ? props : null);
      });
      const map = states.map((st) => C().pal(s, st));
      const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palL.length))));
      const L64 = g.r.BlockStates;
      if (!L64 || !L64.longs) throw fail('A region in this .litematic file has no block data.');
      const words = L64.longs, mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1, total = g.ax * g.ay * g.az;
      if (Math.ceil(total * bits / 64) > L64.length) throw fail('The block data in this .litematic file is shorter than its size says.');
      for (let i = 0; i < total; i++) {
        const bit = i * bits, w = bit >>> 5, o = bit & 31;
        let v = (words[w] >>> o);
        if (o + bits > 32) v |= words[w + 1] << (32 - o);
        v &= mask;
        const x = i % g.ax, z = Math.floor(i / g.ax) % g.az, y = Math.floor(i / (g.ax * g.az));   // litematica index = (y * sz + z) * sx + x
        const pi = map[v];
        if (pi) s.blocks[C().idx(s, g.x0 - mx + x, g.y0 - my + y, g.z0 - mz + z)] = pi;
      }
    });
    return s;
  }

  /** Vanilla structure block file: size [x,y,z], palette (or palettes[0]), blocks [{ pos, state }]. */
  function readStructure(root, name) {
    const sz = root.size;
    const sx = num(sz[0]), sy = num(sz[1]), szz = num(sz[2]);
    guard(sx, sy, szz);
    const palL = root.palette || (Array.isArray(root.palettes) && root.palettes[0]) || [];
    const s = C().create(sx, sy, szz, name);
    const map = palL.map((e) => C().pal(s, C().stateOf(e.Name || 'minecraft:air', e.Properties && Object.keys(e.Properties).length ? e.Properties : null)));
    (root.blocks || []).forEach((b) => {
      const p = b.pos;
      if (!p || p.length < 3) return;
      const v = map[num(b.state)];
      if (v) C().set(s, num(p[0]), num(p[1]), num(p[2]), s.palette[v]);
    });
    return s;
  }

  /* MCEdit / WorldEdit .schematic before 1.13: numeric ids. The common blocks only; the rest shows as unknown. */
  const LEGACY = {
    1: ['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'], 2: 'grass_block', 3: ['dirt', 'coarse_dirt', 'podzol'], 4: 'cobblestone',
    5: ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks'], 7: 'bedrock', 8: 'water', 9: 'water', 10: 'lava', 11: 'lava',
    12: ['sand', 'red_sand'], 13: 'gravel', 14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore', 17: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log'], 18: ['oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves'],
    19: 'sponge', 20: 'glass', 21: 'lapis_ore', 22: 'lapis_block', 23: 'dispenser', 24: ['sandstone', 'chiseled_sandstone', 'cut_sandstone'], 25: 'note_block', 29: 'sticky_piston', 33: 'piston',
    35: 'WOOL', 41: 'gold_block', 42: 'iron_block', 43: 'smooth_stone', 44: 'smooth_stone_slab', 45: 'bricks', 46: 'tnt', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian', 50: 'torch',
    53: 'oak_stairs', 54: 'chest', 55: 'redstone_wire', 56: 'diamond_ore', 57: 'diamond_block', 58: 'crafting_table', 60: 'farmland', 61: 'furnace', 62: 'furnace', 66: 'rail', 67: 'cobblestone_stairs',
    69: 'lever', 70: 'stone_pressure_plate', 72: 'oak_pressure_plate', 73: 'redstone_ore', 74: 'redstone_ore', 75: 'redstone_torch', 76: 'redstone_torch', 77: 'stone_button', 79: 'ice', 80: 'snow_block', 81: 'cactus', 82: 'clay', 83: 'sugar_cane',
    85: 'oak_fence', 86: 'pumpkin', 87: 'netherrack', 88: 'soul_sand', 89: 'glowstone', 91: 'jack_o_lantern', 93: 'repeater', 94: 'repeater', 95: 'STAINED', 98: ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks'],
    103: 'melon', 108: 'brick_stairs', 109: 'stone_brick_stairs', 112: 'nether_bricks', 113: 'nether_brick_fence', 114: 'nether_brick_stairs', 121: 'end_stone', 123: 'redstone_lamp', 124: 'redstone_lamp',
    126: ['oak_slab', 'spruce_slab', 'birch_slab', 'jungle_slab', 'acacia_slab', 'dark_oak_slab'], 128: 'sandstone_stairs', 133: 'emerald_block', 139: 'cobblestone_wall', 143: 'oak_button', 149: 'comparator', 150: 'comparator', 151: 'daylight_detector',
    152: 'redstone_block', 154: 'hopper', 155: 'quartz_block', 156: 'quartz_stairs', 157: 'activator_rail', 158: 'dropper', 159: 'TERRA', 160: 'glass', 161: ['acacia_leaves', 'dark_oak_leaves'], 162: ['acacia_log', 'dark_oak_log'],
    165: 'slime_block', 168: ['prismarine', 'prismarine_bricks', 'dark_prismarine'], 169: 'sea_lantern', 170: 'hay_block', 171: 'CARPET', 172: 'terracotta', 173: 'coal_block', 174: 'packed_ice', 179: 'red_sandstone',
    201: 'purpur_block', 206: 'end_stone_bricks', 213: 'magma_block', 214: 'nether_wart_block', 215: 'red_nether_bricks', 216: 'bone_block', 218: 'observer', 251: 'CONCRETE', 252: 'CONCRETE_POWDER', 27: 'powered_rail', 28: 'detector_rail',
  };
  function legacyName(id, data) {
    const e = LEGACY[id];
    if (e == null) return id ? 'legacy:block_' + id : null;
    const col = C().COLORS[data & 15];
    if (e === 'WOOL') return col + '_wool';
    if (e === 'STAINED') return col + '_stained_glass';
    if (e === 'TERRA') return col + '_terracotta';
    if (e === 'CARPET') return col + '_carpet';
    if (e === 'CONCRETE') return col + '_concrete';
    if (e === 'CONCRETE_POWDER') return col + '_concrete_powder';
    if (Array.isArray(e)) return e[(id === 17 || id === 162 || id === 18 || id === 161 ? data & 3 : id === 126 ? data & 7 : data & 15)] || e[0];
    return e;
  }
  function readLegacy(root, name) {
    const sx = num(root.Width), sy = num(root.Height), sz = num(root.Length);
    guard(sx, sy, sz);
    const ids = root.Blocks, data = root.Data || new Int8Array(ids.length), add = root.AddBlocks;
    const s = C().create(sx, sy, sz, name);
    const cache = new Map();
    for (let i = 0; i < sx * sy * sz; i++) {
      let id = ids[i] & 0xff;
      if (add) id |= ((i & 1 ? add[i >> 1] & 0x0f : (add[i >> 1] >> 4) & 0x0f) << 8);
      if (!id) continue;
      const k = id * 16 + (data[i] & 15);
      let v = cache.get(k);
      if (v == null) { const n = legacyName(id, data[i] & 15); v = n ? C().pal(s, n.includes(':') ? n : 'minecraft:' + n) : 0; cache.set(k, v); }
      s.blocks[i] = v;
    }
    return s;
  }

  /* ======================================================================
   * Our JSON
   * ====================================================================== */
  const FORMAT = 'n1cebear-schematic';
  function toJSON(s, extra) {
    return JSON.stringify(Object.assign({ format: FORMAT, version: 1, name: s.name, size: s.size, palette: s.palette, data: C().rle(s.blocks) }, extra || {}));
  }
  /**
   * Read our JSON. Two shapes:
   *   { format, size, palette, data: rle }                              exported files
   *   { name, legend: { 'S': 'minecraft:stone', ... }, layers: [[row, ...], ...] }   hand-written (built-in farms):
   *     layers bottom to top, each layer = rows along z (north to south), each row = characters along x (west to east),
   *     '.' or ' ' = air.
   */
  function fromJSON(o, fallbackName) {
    if (!o || typeof o !== 'object') throw fail('This JSON file isn’t a schematic I can read.');
    if (Array.isArray(o.layers) && o.legend) {
      const sy = o.layers.length, sz = Math.max(...o.layers.map((l) => l.length)), sx = Math.max(...o.layers.flat().map((r) => r.length));
      guard(sx, sy, sz);
      const s = C().create(sx, sy, sz, o.name || fallbackName || 'Build');
      o.layers.forEach((layer, y) => layer.forEach((row, z) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.' || ch === ' ') continue;
          const id = o.legend[ch];
          if (!id) throw new Error('Unknown legend key "' + ch + '" in layer ' + y);
          C().set(s, x, y, z, id);
        }
      }));
      return s;
    }
    if (!Array.isArray(o.size) || !Array.isArray(o.palette) || o.data == null) throw fail('This JSON file isn’t a schematic I can read.');
    const [sx, sy, sz] = o.size.map(num);
    guard(sx, sy, sz);
    const s = C().create(sx, sy, sz, o.name || fallbackName || 'Build');
    s.palette = o.palette.map((p, i) => (i === 0 ? C().AIR : String(p)));
    try { s.blocks = C().unrle(o.data, sx * sy * sz); } catch (e) { throw fail('The block data in this JSON file is damaged.'); }
    for (let i = 0; i < s.blocks.length; i++) if (s.blocks[i] >= s.palette.length) throw fail('The block data in this JSON file is damaged.');
    return s;
  }

  /* ======================================================================
   * Sponge .schem v2 writer
   * ====================================================================== */
  const DATA_VERSION = 3955;   // Java 1.21.1
  async function toSchem(s) {
    const pal = {};
    s.palette.forEach((p, i) => { pal[i === 0 ? 'minecraft:air' : p] = [3, i]; });
    // duplicate states would collide in the palette compound: compact() merges them, so map through it
    const root = {
      Version: [3, 2], DataVersion: [3, DATA_VERSION],
      Width: [2, s.size[0]], Height: [2, s.size[1]], Length: [2, s.size[2]],
      Offset: [11, Int32Array.from([0, 0, 0])],
      PaletteMax: [3, s.palette.length],
      Palette: [10, pal],
      BlockData: [7, writeVarints(s.blocks)],
      BlockEntities: [9, [10, []]],
      Metadata: [10, { Name: [8, s.name || 'Build'], Author: [8, "n1cebear's toolbox"] }],
    };
    return gzip(writeNBT('Schematic', root));
  }

  /* ======================================================================
   * Entry
   * ====================================================================== */
  const baseName = (n) => String(n || 'Build').replace(/\.(schem|schematic|litematic|nbt|json)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Build';
  async function load(src) {
    let bytes, name;
    if (src && typeof src.arrayBuffer === 'function') {
      if (src.size > 40 * 1024 * 1024) throw fail('This file is too large (over 40 MB) for the viewer.');
      bytes = new Uint8Array(await src.arrayBuffer()); name = src.name;
    } else { bytes = src.bytes; name = src.name; }
    if (!bytes || !bytes.length) throw fail('This file is empty.');
    const nice = baseName(name);
    // JSON?
    let k = 0; while (k < bytes.length && k < 64 && (bytes[k] === 0x20 || bytes[k] === 0x0a || bytes[k] === 0x0d || bytes[k] === 0x09 || bytes[k] === 0xef || bytes[k] === 0xbb || bytes[k] === 0xbf)) k++;
    if (bytes[k] === 0x7b) {
      let o;
      try { o = JSON.parse(new TextDecoder('utf-8').decode(bytes)); } catch (e) { throw fail('This JSON file could not be read. It may be damaged.'); }
      return finish(fromJSON(o, nice));
    }
    if (isGzip(bytes)) bytes = await gunzip(bytes);
    if (bytes[0] !== 10) throw fail('This file isn’t a schematic I can read. Supported: .schem, .litematic, .nbt (structure), .schematic and our .json.');
    const { value: root } = readNBT(bytes);
    let s;
    if (root.Regions && root.Metadata) s = readLitematic(root, nice);
    else if ((root.Schematic && (root.Schematic.Blocks || root.Schematic.Palette)) || (root.Palette && root.BlockData)) s = readSponge(root, nice);
    else if (root.Blocks && root.Width != null && (root.Materials != null || root.Data)) s = readLegacy(root, nice);
    else if (Array.isArray(root.size) && (root.palette || root.palettes) && root.blocks) s = readStructure(root, nice);
    else throw fail('This file isn’t a schematic I can read. It is NBT, but not a .schem, .litematic, structure or .schematic file.');
    s.name = s.name || nice;
    return finish(s);
  }

  TH.builds.io = { load, readNBT, writeNBT, toJSON, fromJSON, toSchem, gunzip, gzip, readVarints, writeVarints, MAX_BLOCKS, FORMAT };
})();
