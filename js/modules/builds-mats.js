/**
 * The smart material list: the UI of the Materials tool (js/modules/materials.js mounts it) plus its pure helpers.
 * Loaded lazily with the other builds-* files (TH.builds.api.load()), namespace TH.builds.mats.
 *
 *   Source  = the build last on the Builds stage, any farm / machine / structure, your kept files and shape, or a saved
 *             LIST (pasted text or an imported .txt / .csv; Litematica "Material List" tables and CSV exports read as is).
 *   List    = one row per item: texture, name, a recipe key (hover = the recipe drawn like the game: a 3x3 crafting
 *             grid, stonecutter, furnace...; click = the full details with every way to make it and the raw materials),
 *             the needed amount split into shulker boxes / stacks / items, a "have" field that understands units
 *             ("2sb", "3 stacks", "1.5 shulker", "64x"; a bare number counts in the unit picked above the list),
 *             quick +1 stack / +1 shulker box keys and a tick (got it all).
 *   Raw     = a switch turns the whole list into the raw materials (TH.data.recipes.raw), with its own ticks.
 *   Side    = one panel: the source as a compact card (stats, slim progress, View in 3D / Change) and the Packing:
 *             every container one inset well of item icons with counts ("Tight" = fewest containers, "Sorted" = by group).
 *
 * Pure helpers (no DOM, tested with node): parse(text), resolve(name), stackOf(id), split(n, stack, units),
 *   amountText(n, stack, units), parseAmount(text, units, stack), pack(rows, o).
 * State (state.builds, shared with Builds): lists [{ id, name, text, at }], ticks { [key]: { item: 1 } },
 *   have { [key]: { item: n items } }, units 'items'|'stacks'|'boxes'|'dc', sort 'count'|'name'|'group',
 *   matSrc 'stage'|<source key>, mats { raw, cont: 'box'|'dc', pack: 'tight'|'sorted', hide, sc, pick: { item: recipe index } }.
 *   Source keys: 'farm:<id>', 'file:<id>', 'shape', 'list:<id>'; raw-mode ticks / have live under '<key>#raw'.
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
TH.builds.mats = (function () {
  'use strict';
  const core = () => TH.builds.core;
  const RC = () => TH.data.recipes;
  const SLOTS = { box: 27, dc: 54 };

  /* ======================================================================
   * Parsing pasted lists
   * ====================================================================== */
  /** An integer count: "3011", "3 011", "3,011", "3.011" (thousands), "64x". */
  function num(s) {
    s = String(s == null ? '' : s).trim().replace(/^[x×]\s*/i, '');
    if (/^\d{1,3}([ ,.'’  ]\d{3})+(?!\d)/.test(s)) return parseInt(s.match(/^\d{1,3}(?:[ ,.'’  ]\d{3})+/)[0].replace(/\D/g, ''), 10);
    const m = s.match(/^\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }
  const isNum = (s) => /^\s*[x×]?\s*\d[\d ,.'’  ]*\s*$/i.test(String(s == null ? '' : s));
  /** Split one CSV / TSV line (quotes honoured). */
  function splitSep(line, sep) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (c === sep) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  const UNIT_RE = /^(stacks?|st|sbs?|shulkers?|shulker\s*box(?:es)?|boxes|box|dcs?|double\s*chests?|chests?)\.?$/i;
  function unitOf(u) {
    u = String(u || '').toLowerCase();
    if (/^st/.test(u)) return 'st';
    if (/^(sb|shulker|box)/.test(u)) return 'sb';
    if (/^(dc|double|chest)/.test(u)) return 'dc';
    return null;
  }
  const HEAD_NAME = /^(item|items|name|block|blocks|material|materials)$/i, HEAD_TOTAL = /^(total|count|amount|qty|quantity|needed|required)$/i;
  /**
   * Read a material list: Litematica text tables (+---+ borders, | cells |), Litematica CSV, markdown tables, CSV / TSV,
   * and plain lines ("Stone Bricks 64", "64x Stone Bricks", "Stone Bricks: 64", "Stone Bricks x64", "Stone Bricks 3 stacks").
   * Returns { title, rows: [{ name, n, have, unit, q, done }] } (same names merged). Never throws.
   */
  function parse(text) {
    const rows = [];
    let title = null, cols = null;
    String(text || '').split(/\r?\n/).forEach((rawLine) => {
      let line = rawLine.replace(/ /g, ' ').trim();
      if (!line || /^[+\-=|:\s_~]+$/.test(line)) return;   // table borders, markdown separators
      let cells = null, tabular = false;
      if ((line.match(/\|/g) || []).length >= 2 || line.startsWith('|')) {
        cells = line.split('|').map((c) => c.trim());
        if (cells[0] === '') cells.shift();
        if (cells.length && cells[cells.length - 1] === '') cells.pop();
        tabular = true;
      } else if (line.includes('\t')) { cells = splitSep(line, '\t'); tabular = true; }
      else if (line.includes(',') || line.includes(';')) {
        const sep = line.includes(';') && !line.includes(',') ? ';' : ',';
        const c = splitSep(line, sep);
        if (c.length >= 2 && (c.slice(1).some(isNum) || (cols && c.length >= 2) || c.some((x) => HEAD_TOTAL.test(x)))) { cells = c; tabular = true; }
      }
      if (tabular) {
        cells = cells.map((c) => c.replace(/^"|"$/g, '').trim());
        if (cells.length === 1 || (cells.length >= 1 && /material list/i.test(cells[0]) && !cells.slice(1).some(isNum))) {
          const m = cells.join(' ').match(/material list(?: for)?(?: (?:placement|schematic|area|selection))?\s*['"“‘](.+?)['"”’]/i);
          if (m) title = m[1].trim();
          else if (/material list/i.test(cells[0])) title = title || null;
          return;
        }
        const hi = cells.findIndex((c) => HEAD_NAME.test(c)), ti = cells.findIndex((c) => HEAD_TOTAL.test(c));
        if (hi >= 0 && ti >= 0) { cols = { name: hi, total: ti, avail: cells.findIndex((c) => /^(available|have|owned|in inventory)$/i.test(c)), width: cells.length }; return; }
        let name, n, have = 0;
        if (cols) {
          // a name with the separator in it (unquoted "Target 0.4s,1s") shows up as extra leading cells
          const extra = Math.max(0, cells.length - cols.width);
          name = cells.slice(cols.name, cols.name + extra + 1).join(cols.width && line.includes('|') ? '|' : ',').trim();
          const at = (i) => cells[i > cols.name ? i + extra : i];
          n = num(at(cols.total));
          if (cols.avail >= 0) { const a = num(at(cols.avail)); have = a > 0 ? a : 0; }
        } else {
          const ni = cells.findIndex((c, i) => i > 0 && isNum(c));
          if (ni < 0) return;
          name = cells.slice(0, ni).join(', ').trim();
          n = num(cells[ni]);
          const u = cells[ni + 1] && UNIT_RE.test(cells[ni + 1]) ? unitOf(cells[ni + 1]) : null;
          if (u) { rows.push({ name, n: 0, have: 0, unit: u, q: parseFloat(String(cells[ni]).replace(',', '.')) }); return; }
        }
        if (name && /[a-z]/i.test(name) && n > 0 && !HEAD_NAME.test(name)) rows.push({ name, n, have, unit: null, q: 0 });
        return;
      }
      // plain line
      let done = false;
      line = line.replace(/^[-*•·>]\s+/, '');
      const ck = line.match(/^\[( |x|X|✓)\]\s*/);
      if (ck) { done = ck[1] !== ' '; line = line.slice(ck[0].length); }
      line = line.replace(/\s*\([^)]*\)\s*$/, '');   // our own copy text: "Stone Bricks: 1 234 (19 st + 18)"
      let m, name = null, n = NaN, unit = null, q = 0;
      if (/^\d+[.)]\s+/.test(line) && /\d\s*$|:\s*\d/.test(line.replace(/^\d+[.)]\s+/, ''))) line = line.replace(/^\d+[.)]\s+/, '');   // "1. Stone 64"
      if ((m = line.match(/^(.+?)(?:\s*[:=–—-]\s*|\s+[x×]?\s*)(\d+(?:[.,]\d+)?)\s*([a-z ]+?)\.?$/i)) && UNIT_RE.test(m[3].trim())) { name = m[1]; unit = unitOf(m[3].trim()); q = parseFloat(m[2].replace(',', '.')); }
      else if ((m = line.match(/^(\d+(?:[.,]\d+)?)\s*([a-z ]+?)\s+(?:of\s+)?([a-z].*)$/i)) && UNIT_RE.test(m[2].trim())) { name = m[3]; unit = unitOf(m[2].trim()); q = parseFloat(m[1].replace(',', '.')); }
      else if ((m = line.match(/^(.+?)\s*[:=]\s*([x×]?\s*\d[\d ,.'’]*)\s*$/i))) { name = m[1]; n = num(m[2]); }
      else if ((m = line.match(/^(\d[\d,.'’]*(?: \d{3})*)\s*[x×]?\s+(.+)$/i)) && /[a-z]/i.test(m[2])) { name = m[2]; n = num(m[1]); }
      else if ((m = line.match(/^(\d+)[x×](.+)$/i))) { name = m[2]; n = num(m[1]); }
      else if ((m = line.match(/^(.+?)\s+[x×]?\s*(\d[\d,.'’]*(?: \d{3})*)$/i))) { name = m[1]; n = num(m[2]); }
      else if ((m = line.match(/^(.+?)\s*[–—-]\s*(\d[\d ,.'’]*)$/))) { name = m[1]; n = num(m[2]); }
      if (!name) return;
      name = name.replace(/\s*[:=–—-]+\s*$/, '').replace(/\s+[x×]$/i, '').trim();
      if (!/[a-z]/i.test(name) || HEAD_NAME.test(name)) return;
      if (unit) { if (q > 0) rows.push({ name, n: 0, have: 0, unit, q, done }); return; }
      if (n > 0) rows.push({ name, n, have: 0, unit: null, q: 0, done });
    });
    // merge the same names
    const m = new Map();
    rows.forEach((r) => {
      const k = r.name.toLowerCase().replace(/\s+/g, ' ');
      const e = m.get(k);
      if (!e) m.set(k, Object.assign({}, r));
      else { e.n += r.n; e.have += r.have; if (r.unit) { e.q = (e.unit === r.unit ? e.q : 0) + r.q; e.unit = r.unit; } e.done = e.done && r.done; }
    });
    return { title, rows: [...m.values()] };
  }

  /* ======================================================================
   * Names -> item ids
   * ====================================================================== */
  let byName = null;
  function nameIndex() {
    if (byName) return byName;
    byName = new Map();
    const put = (k, id) => { k = String(k || '').toLowerCase().replace(/\s+/g, ' ').trim(); if (k && !byName.has(k)) byName.set(k, id); };
    const R = RC(), C = core();
    Object.entries(R.NAMES).forEach(([n, label]) => { if (!n.startsWith('tag:') && n !== 'redstone_wire') put(label, 'minecraft:' + n); });
    Object.keys(C.BLOCKS).forEach((n) => { const d = C.BLOCKS[n], it = 'minecraft:' + (d.item || n); put(C.nameOf('minecraft:' + n), it); put(n.replace(/_/g, ' '), it); });
    R.allIds().forEach((id) => { put(R.nameOf(id), id); put(R.bare(id).replace(/_/g, ' '), id); });
    // every block and item of the game version (js/data/block-db.js): its English name and the id in words
    const DB = TH.data && TH.data.blockDb;
    if (DB) {
      Object.entries(DB.names).forEach(([n, label]) => put(label, 'minecraft:' + ((C.def('minecraft:' + n) || {}).item || n)));
      Object.keys(DB.b).forEach((n) => { const it = 'minecraft:' + ((C.def('minecraft:' + n) || {}).item || n); put(C.nameOf('minecraft:' + n), it); put(n.replace(/_/g, ' '), it); });
    }
    const L = (TH.langData && TH.langData.en_us) || {};
    Object.keys(L).forEach((k) => { const m = k.match(/^(?:block|item)\.minecraft\.([a-z0-9_]+)$/); if (m) put(L[k], 'minecraft:' + m[1]); });
    return byName;
  }
  /** 'Polished Tuff Wall' -> 'minecraft:polished_tuff_wall'; names that are not plain words (e.g. "Target 0.4s,1s") -> null. */
  function resolve(name) {
    const k = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k) return null;
    const idx = nameIndex();
    const hit = idx.get(k) || idx.get(k.replace(/^minecraft:/, '').replace(/_/g, ' '));
    if (hit) return hit;
    if (/^minecraft:[a-z0-9_]+$/.test(k)) return k;
    // Mojang names are the id in title case: guess it for plain words
    if (/^[a-z][a-z' ]*[a-z]$/.test(k) && k.split(' ').length <= 6) return 'minecraft:' + k.replace(/'/g, '').replace(/ /g, '_');
    return null;
  }

  /* ======================================================================
   * Stack sizes, amounts in units, packing
   * ====================================================================== */
  const UNSTACK = /(^|_)bucket$|_bed$|shulker_box$|minecart$|_boat$|_raft$|_sword$|_pickaxe$|_axe$|_shovel$|_hoe$|_helmet$|_chestplate$|_leggings$|_boots$|^music_disc|_horse_armor$|^(potion|splash_potion|lingering_potion|totem_of_undying|saddle|elytra|shield|bow|crossbow|trident|mace|fishing_rod|flint_and_steel|shears|writable_book|written_book|enchanted_book|cake|spyglass|brush|carrot_on_a_stick|warped_fungus_on_a_stick)$/;
  const STACK16 = /_sign$|_banner$|^(ender_pearl|snowball|egg|blue_egg|brown_egg|bucket|honey_bottle|armor_stand)$/;
  function stackOf(id) {
    const s = String(id || '');
    if (s.startsWith('text:')) return 64;
    const n = RC().bare(s);
    if (n === 'bucket') return 16;
    if (UNSTACK.test(n)) return 1;
    if (STACK16.test(n)) return 16;
    return core() ? core().stackOf('minecraft:' + n) : 64;
  }
  const fmt = (n) => Math.round(n).toLocaleString('en').replace(/,/g, ' ');
  const dec = (x) => (x > 0 && x < 1 ? Math.max(0.01, Math.round(x * 100) / 100) : Math.round(x * 10) / 10).toLocaleString('en', { maximumFractionDigits: 2 });
  /** Items in one of a unit: items 1, stacks one stack, boxes 27 stacks, dc 54 stacks. */
  function unitSize(units, stack) { stack = stack || 64; return units === 'stacks' ? stack : units === 'boxes' ? stack * 27 : units === 'dc' ? stack * 54 : 1; }
  /**
   * n items split the way you would carry them in these units: [[count, tag], ...] with tag 'dc' | 'sb' | 'st' | ''
   * (items). 'items' -> [[n, '']]; 'stacks' -> stacks + rest; 'boxes' -> boxes + stacks + rest; 'dc' -> chests + stacks + rest.
   */
  function split(n, stack, units) {
    n = Math.max(0, Math.round(n || 0)); stack = stack || 64;
    const out = [];
    let left = n;
    if (units === 'boxes' || units === 'dc') {
      const per = stack * (units === 'dc' ? 54 : 27), k = Math.floor(left / per);
      if (k) { out.push([k, units === 'dc' ? 'dc' : 'sb']); left -= k * per; }
    }
    if (units !== 'items' && units && stack > 1) { const k = Math.floor(left / stack); if (k) { out.push([k, 'st']); left -= k * stack; } }
    if (left || !out.length) out.push([left, '']);
    return out;
  }
  const U_SHORT = { sb: 'sb', dc: 'dc', st: 'st' };
  const U_WORD = { sb: ['shulker box', 'shulker boxes'], dc: ['double chest', 'double chests'], st: ['stack', 'stacks'] };
  /** The text a "have" field shows for n items in these units: '1797', '28 st 5', '1 sb 1 st 5'. */
  function amountText(n, stack, units) {
    const p = split(n, stack, units);
    // a lone remainder in a bigger unit gets the items mark, or it would read back as stacks / boxes ('63x', not '63')
    if (p.length === 1 && !p[0][1] && units && units !== 'items' && p[0][0]) return p[0][0] + 'x';
    return p.map(([k, u]) => (u ? k + ' ' + U_SHORT[u] : String(k))).join(' ');
  }
  /** In words: '1 shulker box + 3 stacks + 5'. */
  function amountWords(n, stack, units) { return split(n, stack, units).map(([k, u]) => (u ? fmt(k) + ' ' + U_WORD[u][k === 1 ? 0 : 1] : fmt(k))).join(' + '); }
  /**
   * What you typed in a "have" field -> items (0 for an empty field, NaN when it cannot be read).
   * A bare number counts in `units` ('2' with Shulkers picked = 2 shulker boxes); a number after another one is items
   * ('3 st 5', '1 sb 3 st 5'); suffixes always win: '64x' / 'x64' / '64 items', '3s' / '3 st' / '3 stacks',
   * '2sb' / '2 box' / '1.5 shulker', '1 dc' / '1 double chest'. '1 797', '1,797' and '1.5' / '1,5' read as you mean them.
   */
  function parseAmount(text, units, stack) {
    stack = stack || 64;
    let s = String(text == null ? '' : text).toLowerCase().replace(/[  ]/g, ' ').trim();
    if (!s) return 0;
    s = s.replace(/shulker\s*box(?:es)?|shulkers?/g, 'sb').replace(/double\s*chests?/g, 'dc').replace(/\band\b|\+|=/g, ' ')
      .replace(/(^|[^\d.,])(\d{1,3})((?:[ ,.'’]\d{3})+)(?![\d.,])/g, (m, a, b, c) => a + b + c.replace(/\D/g, ''))
      .replace(/(\d),(\d)/g, '$1.$2').trim();
    const re = /\s*([x×]\s*)?(\d+(?:\.\d+)?|\.\d+)\s*([a-z×]*)\.?\s*/y;
    let i = 0, total = 0, any = false;
    while (i < s.length) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m || !m[0]) return NaN;
      i = re.lastIndex;
      const v = parseFloat(m[2]), suf = m[3];
      let f;
      if (m[1] || /^(x|×|i|it|items?|pcs?|pieces?)$/.test(suf)) f = 1;
      else if (/^(s|st|stk|stacks?)$/.test(suf)) f = stack;
      else if (/^(sb|sbs|b|bx|box|boxes)$/.test(suf)) f = stack * 27;
      else if (/^(dc|dcs|c|chests?)$/.test(suf)) f = stack * 54;
      else if (!suf) f = any ? 1 : unitSize(units, stack);
      else return NaN;
      total += v * f; any = true;
    }
    return any ? Math.round(total) : NaN;
  }
  /** { main, sub } for n items (kept for callers of the old API). */
  function amount(n, stack, units) { return { main: amountWords(n, stack, units), sub: fmt(n) + ' items' }; }
  /** Stacks of one row: [64, 64, ..., rest]. */
  function stacks(n, stack) { const out = []; let left = n; while (left > 0) { out.push(Math.min(stack, left)); left -= stack; } return out; }
  /**
   * Pack rows [{ item, n, stack }] into containers of o.size slots (27 shulker box, 54 double chest).
   * o.mode 'tight': whole containers of one item first, then first-fit decreasing by slots (an item stays in one
   * container when it can); if that would need more containers than the slots strictly need, the rest is filled in
   * order instead, so Tight is always the fewest containers. 'sorted': the rows in the given order, container by
   * container. Returns [{ slots: [{ item, n, stack }] }].
   */
  function pack(rows, o) {
    const size = (o && o.size) || 27, mode = (o && o.mode) || 'tight';
    const chunks = rows.filter((r) => r.n > 0).map((r, i) => ({ r, i, st: stacks(r.n, r.stack || 64) }));
    const total = chunks.reduce((a, c) => a + c.st.length, 0);
    const slot = (c, n) => ({ item: c.r.item, n, stack: c.r.stack || 64 });
    if (mode === 'sorted') {
      const bins = [];
      let cur = null;
      chunks.forEach((c) => c.st.forEach((n) => { if (!cur || cur.slots.length >= size) { cur = { slots: [] }; bins.push(cur); } cur.slots.push(slot(c, n)); }));
      return bins;
    }
    const full = [], rest = [];
    chunks.forEach((c) => {
      let st = c.st;
      while (st.length >= size) { full.push({ slots: st.slice(0, size).map((n) => slot(c, n)) }); st = st.slice(size); }
      if (st.length) rest.push({ c, st });
    });
    rest.sort((a, b) => b.st.length - a.st.length || a.c.i - b.c.i);
    let bins = [];
    rest.forEach((x) => {
      let b = bins.find((y) => size - y.slots.length >= x.st.length);
      if (!b) { b = { slots: [] }; bins.push(b); }
      x.st.forEach((n) => b.slots.push(slot(x.c, n)));
    });
    if (full.length + bins.length > Math.ceil(total / size)) {
      bins = [];
      let cur = null;
      rest.forEach((x) => x.st.forEach((n) => { if (!cur || cur.slots.length >= size) { cur = { slots: [] }; bins.push(cur); } cur.slots.push(slot(x.c, n)); }));
    }
    return full.concat(bins);
  }

  /* ======================================================================
   * UI
   * ====================================================================== */
  let A = null;   // TH.builds.api (init)
  let M = null;   // the mounted page
  const h = (...a) => TH.util.h(...a);
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  const S = () => A.S();
  const save = (fn) => A.save(fn);
  const MS = () => S().mats;
  const U = () => S().units || 'items';
  const ropts = () => ({ sc: MS().sc !== false, pick: MS().pick || {} });
  const isText = (f) => /\.(txt|csv|tsv|md|text|list)$/i.test(f.name || '') || /^text\//.test(f.type || '');
  const isTextItem = (id) => String(id).startsWith('text:');
  const LIST_NAME_CAP = 48;
  const hovers = () => !!(window.matchMedia && matchMedia('(hover: hover)').matches);

  // small pixel glyphs (7x7, currentColor)
  const GL = {
    chev: ['.......', '.#...#.', '..#.#..', '...#...', '.......', '.......', '.......'],
    list: ['#.#####', '.......', '#.#####', '.......', '#.#####', '.......', '#.#####'],
    pen: ['....##.', '...#.##', '..#.##.', '.#.##..', '#.##...', '##.....', '###....'],
    arrow: ['.......', '....#..', '.....#.', '#######', '.....#.', '....#..', '.......'],
    cube: ['..###..', '.#####.', '#######', '#..#..#', '#..#..#', '.#.#.#.', '..###..'],
    plus: ['...#...', '...#...', '...#...', '#######', '...#...', '...#...', '...#...'],
    x: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
    copy: ['####...', '#..#...', '#..####', '#..#..#', '####..#', '...#..#', '...####'],
    down: ['...#...', '...#...', '...#...', '#.###.#', '.#####.', '..###..', '#######'],
    up: ['#######', '..###..', '.#####.', '#.###.#', '...#...', '...#...', '...#...'],
    file: ['####...', '#..##..', '#...##.', '#....#.', '#....#.', '#....#.', '######.'],
    star: ['...#...', '...#...', '..###..', '#######', '.#####.', '.##.##.', '#.....#'],
    check: ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
    stack: ['.#####.', '.......', '.#####.', '.......', '.#####.', '#######', '#######'],
    mix: ['#....##', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '##....#'],
    flame: ['...#...', '..##...', '..###..', '.####..', '.#####.', '##.###.', '.#####.'],
    swap: ['..#....', '.###...', '#.#....', '..#..#.', '....#.#', '...###.', '....#..'],
  };
  const glUrl = new Map();
  function gl(name, cls) {
    let u = glUrl.get(name);
    if (!u) {
      let d = '';
      (GL[name] || GL.x).forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') d += 'M' + x + ' ' + y + 'h1v1h-1z'; });
      u = 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 7 7' shape-rendering='crispEdges'><path d='" + d + "'/></svg>") + '")';
      glUrl.set(name, u);
    }
    const el = h('span.mt-gl' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    el.style.setProperty('--m', u);
    return el;
  }
  /** The little container pictures: a shulker box texture, a double chest drawn in pixels, a stack glyph. */
  function unitIco(tag, size) {
    if (tag === 'sb') return TH.icon('block/shulker_box', { size: size || 14, cls: 'mt-uico' });
    if (tag === 'dc') return h('span.mt-uico.mt-dc', { 'aria-hidden': 'true', style: { width: (size || 14) + 'px', height: (size || 14) + 'px' } });
    if (tag === 'st') return gl('stack', 'mt-uico');
    return null;
  }
  /** n items as numbers with unit pictures: 2[box] 12[stack] 4. */
  function bits(n, stack, units) {
    return split(n, stack, units).map(([k, u]) => h('span.mt-bit', h('b', fmt(k)), unitIco(u)));
  }

  /* ---- icons: the block table, the recipe table, the shape's base block, else a guess at the texture name ---- */
  let iconSet = null;
  const found = new Map();   // item -> texture key that loaded
  function iconKeyOf(id) {
    const C = core(), R = RC(), n = R.bare(id);
    if (C.BLOCKS[n]) return C.iconOf('minecraft:' + n);
    if (R.iconKey(n)) return R.iconKey(n);
    const b = R.baseOf(n);
    if (b) return iconKeyOf(b);
    return null;
  }
  function iconFor(id, size) {
    const s = String(id || '');
    if (!s || isTextItem(s)) return h('span.mt-noico', { 'aria-hidden': 'true' });
    // blocks: the inventory look (isometric model, or the item sprite for doors, torches, plants ...)
    if (TH.icon.block && TH.icon.block.has(s)) return TH.icon.block(s, { size, fallback: iconKeyOf(s) || undefined });
    const key = found.get(s) || iconKeyOf(s);
    if (key) return TH.icon(key, { size });
    const n = RC().bare(s);
    let cands = ['block/' + n, 'item/' + n, 'block/' + n + '_side', 'block/' + n + '_top', 'block/' + n + '_front'];
    const m = n.match(/^(.*?)_(stairs|slab|wall|fence|fence_gate|carpet|pane|button|pressure_plate)$/);
    if (m) cands.push('block/' + m[1], 'block/' + m[1] + 's', 'block/' + m[1] + '_planks', 'block/' + m[1] + '_block');
    if (TH.iconList) {
      iconSet = iconSet || new Set(TH.iconList);
      cands = cands.filter((k) => iconSet.has(k)).concat(cands.filter((k) => !iconSet.has(k)));
    }
    const el = TH.icon(cands[0], { size });
    const img = el.querySelector('img');
    if (img) {
      let i = 0;
      img.addEventListener('load', () => found.set(s, cands[i]), { once: true });
      img.onerror = () => {
        i++;
        if (i < cands.length) { img.src = TH.icon.src(cands[i]); return; }
        el.replaceChildren(); el.classList.add('mt-noico-mc');
      };
    }
    return el;
  }
  const nameOf = (id) => (M && M.d && M.d.names.get(id)) || RC().nameOf(id);
  /** An item picture with a Minecraft-style count in its corner. */
  function slotIco(id, n, size, tipText) {
    const el = h('span.mt-si', iconFor(id, size || 24), n > 1 ? h('b.mt-n', fmt(n)) : null);
    if (tipText !== false) tip(el, () => [h('div.th-tooltip-title', nameOf(id)), n > 1 ? h('div.th-tooltip-sub', '× ' + fmt(n)) : null].filter(Boolean));
    return el;
  }

  /* ---- sources ---- */
  function lists() { return S().lists || []; }
  function listRec(key) { return lists().find((l) => 'list:' + l.id === key); }
  function validKey(key) {
    if (!key || key === 'stage' || key === 'paste') return false;
    if (key.startsWith('list:')) return !!listRec(key);
    return A.sources().some((s) => s.key === key);
  }
  function srcKey() { const st = S(); return validKey(st.matSrc) ? st.matSrc : A.stageKey(); }
  function srcInfo(key) {
    if (key.startsWith('list:')) { const l = listRec(key); return { key, name: l ? l.name : 'List', kind: 'list', icon: null }; }
    const s = A.sources().find((x) => x.key === key);
    return s || { key, name: A.keyName(key) || 'Build', kind: 'yours', icon: null };
  }
  const KIND = { farm: 'Farm', machine: 'Machine', build: 'Structure', yours: 'Your build', shape: 'Your shape', list: 'Your list' };

  const parseCache = new Map();
  function listRows(text) {
    let v = parseCache.get(text);
    if (v) return v;
    const p = parse(text), m = new Map();
    p.rows.forEach((r) => {
      const id = resolve(r.name), item = id || 'text:' + r.name.trim();
      const stack = stackOf(item);
      const n = r.unit ? Math.round(r.q * stack * (r.unit === 'st' ? 1 : r.unit === 'sb' ? 27 : 54)) : r.n;
      const e = m.get(item);
      if (e) { e.n += n; e.have0 += r.have || 0; }
      else m.set(item, { item, n, have0: r.have || 0, done0: !!r.done, label: id && (core().known(id) || RC().knows(id) || RC().NAMES[RC().bare(id)] || (TH.data.blockDb && TH.data.blockDb.names[RC().bare(id)])) ? null : r.name.trim() });
    });
    v = { title: p.title, rows: [...m.values()].filter((r) => r.n > 0) };
    if (parseCache.size > 20) parseCache.clear();
    parseCache.set(text, v);
    return v;
  }
  function baseRows(key) {
    if (key.startsWith('list:')) { const l = listRec(key); return l ? listRows(l.text || '').rows.map((r) => Object.assign({}, r)) : []; }
    const s = A.effective(key);
    return s ? core().materials(s).map((m) => ({ item: m.item, n: m.n, have0: 0, label: null })) : [];
  }

  /* ---- the rows on screen ---- */
  const GROUP_ORDER = () => core().GROUP_ORDER;
  function compute() {
    const st = S(), key = srcKey(), raw = !!MS().raw, R = RC();
    const base = baseRows(key);
    let rows = base, steps = [], usedBy = null;
    if (raw) {
      const r = R.raw(base, ropts());
      rows = r.rows.map((x) => ({ item: x.item, n: x.n, have0: 0, label: null }));
      steps = r.steps;
      usedBy = new Map();
      base.forEach((b) => R.raw([b], ropts()).rows.forEach((x) => { const a = usedBy.get(x.item) || []; a.push([b.item, b.n, b.label]); usedBy.set(x.item, a); }));
    }
    rows.forEach((r) => {
      r.stack = stackOf(r.item);
      r.name = r.label || R.nameOf(r.item);
      r.grp = isTextItem(r.item) ? 'misc' : R.groupOf(r.item);
      r.nrec = isTextItem(r.item) ? 0 : R.recipesFor(r.item).length;
    });
    const go = GROUP_ORDER();
    const gi = (g) => { const i = go.indexOf(g); return i < 0 ? 99 : i; };
    if (st.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (st.sort === 'group') rows.sort((a, b) => gi(a.grp) - gi(b.grp) || b.n - a.n || a.name.localeCompare(b.name));
    else rows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const names = new Map(rows.map((r) => [r.item, r.name]));
    base.forEach((b) => { if (b.label && !names.has(b.item)) names.set(b.item, b.label); });
    return { key, tk: key + (raw ? '#raw' : ''), raw, base, rows, steps, usedBy, names };
  }
  // gathered state
  const tmap = (tk) => (S().ticks[tk] || {});
  const hmap = (tk) => ((S().have || {})[tk] || {});
  function haveOf(r) { const t = tmap(M.d.tk)[r.item], hv = hmap(M.d.tk)[r.item]; return t ? r.n : Math.min(r.n, hv || 0); }
  const isDone = (r) => !!tmap(M.d.tk)[r.item] || (hmap(M.d.tk)[r.item] || 0) >= r.n;
  function setHave(r, v, tick) {
    const tk = M.d.tk;
    v = Math.max(0, Math.round(v || 0));
    save((b) => {
      b.have = b.have || {};
      const t = b.ticks[tk] || (b.ticks[tk] = {}), hv = b.have[tk] || (b.have[tk] = {});
      if (tick === true || v >= r.n) { t[r.item] = 1; hv[r.item] = r.n; }
      else { delete t[r.item]; if (v > 0) hv[r.item] = v; else delete hv[r.item]; }
      if (!Object.keys(t).length) delete b.ticks[tk];
      if (!Object.keys(hv).length) delete b.have[tk];
    });
  }

  /* ---- render ---- */
  function render() {
    const st = S();
    if (!st.mats) st.mats = { raw: false, cont: 'box', pack: 'tight', hide: false, sc: true, pick: {} };
    if (!st.matSrc || st.matSrc === 'paste') save((b) => { b.matSrc = 'stage'; });
    M = { d: null, open: new Set(), rowEls: new Map(), packAll: false, rawAll: false };
    // head: the source key and Add a list; the picker and the add form fold open under it
    M.srcBtn = h('button.btn.mt-srckey', { type: 'button', 'aria-expanded': 'false', onclick: () => togglePick() });
    tip(M.srcBtn, 'Pick what to list: any build, your files and shapes, or a saved list');
    M.keys = h('div.mt-head-keys');
    M.pick = h('div.mt-pick', { hidden: true });
    M.add = h('div.mt-add', { hidden: true });
    M.head = h('section.mt-head', { 'aria-label': 'Material list source' }, h('div.mt-head-row', M.srcBtn, M.keys), M.pick, M.add);
    // list
    M.listTitle = h('h3');
    M.listCount = h('span.mt-count');
    M.q = h('input.field.mt-q', { type: 'search', placeholder: 'Filter the list', 'aria-label': 'Filter the list', autocomplete: 'off', spellcheck: false, oninput: () => applyFilter() });
    M.hideCb = h('input', { type: 'checkbox', checked: !!MS().hide, onchange: () => { save((b) => { b.mats.hide = M.hideCb.checked; }); applyFilter(); } });
    M.rawCb = h('input', { type: 'checkbox', checked: !!MS().raw, onchange: () => setRaw(M.rawCb.checked) });
    const hideSw = h('label.mt-sw', h('span.switch', M.hideCb, h('span')), h('span', 'Hide gathered'));
    const rawSw = tip(h('label.mt-sw', h('span.switch', M.rawCb, h('span')), h('span', 'Raw materials')), 'Show what you gather instead: the whole list broken down to raw materials, using the best recipes');
    M.sortSeg = seg('Sort materials', [['count', 'Most'], ['name', 'A–Z'], ['group', 'Group']], () => S().sort, (v) => { save((b) => { b.sort = v; }); refresh(); },
      { count: 'Most first', name: 'A to Z', group: 'By group: stone, wood, colours…' });
    M.unitSeg = seg('Amounts as', [['items', 'Items'], ['stacks', 'Stacks'], ['boxes', 'Shulkers'], ['dc', 'Chests']], () => U(), (v) => { save((b) => { b.units = v; }); syncUnits(); },
      { items: 'Single items. A number you type counts as items', stacks: 'Stacks (64, 16 or 1 per slot). A number you type counts as stacks', boxes: 'Shulker boxes (27 slots). A number you type counts as shulker boxes', dc: 'Double chests (54 slots). A number you type counts as double chests' });
    M.rows = h('div.mt-rows', { role: 'list' });
    // column labels: only shown when the list is wide enough for the extra columns (css/materials.css)
    M.colItems = h('span.mt-ch-items');
    M.colHead = h('div.mt-colhead', { 'aria-hidden': 'true' }, h('span.mt-ch-need', 'Needed'), M.colItems, h('span.mt-ch-have', 'Have'), h('span.mt-ch-still', 'Still needed'));
    M.empty = h('p.mt-note.mt-empty', { hidden: true });
    M.acts = h('div.mt-actions.mt-lacts');
    M.list = h('section.panel.mt-pan.mt-list', { 'aria-label': 'Material list' },
      h('div.mt-pan-head', M.listTitle, M.listCount),
      h('div.mt-tools', h('div.mt-tools-a', M.q, hideSw, rawSw), h('div.mt-tools-b', M.sortSeg, M.unitSeg)),
      M.colHead, M.rows, M.empty, M.acts);
    // side: the source card + packing in one panel, raw materials below
    M.card = h('div.mt-card');
    M.packBody = h('div.mt-packbody');
    M.packPanel = h('section.panel.mt-pan.mt-pack', { 'aria-label': 'Source and packing' }, M.card, M.packBody);
    M.rawPanel = h('section.panel.mt-pan.mt-raw', { 'aria-label': 'Raw materials' });
    M.fileIn = h('input', { type: 'file', hidden: true, accept: '.txt,.csv,.tsv,.md,.schem,.schematic,.litematic,.nbt,.json', onchange: () => { const f = M.fileIn.files[0]; M.fileIn.value = ''; if (f) importFile(f, M.fileFor); M.fileFor = null; } });
    M.root = h('div.mt-page', M.head, h('div.mt-grid', M.list, h('div.mt-side', M.packPanel, M.rawPanel)), M.fileIn);
    // drop a file anywhere on the page
    M.root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); M.root.classList.add('dropping'); } });
    M.root.addEventListener('dragleave', (e) => { if (!M.root.contains(e.relatedTarget)) M.root.classList.remove('dropping'); });
    M.root.addEventListener('drop', (e) => { M.root.classList.remove('dropping'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); importFile(f, M.add.hidden ? null : 'form'); } });
    refresh();
    return [M.root];
  }

  /** A one-of-N .seg (the shared sliding knob), patched in place. */
  function seg(label, opts, get, set, tips) {
    const btns = opts.map(([id, t]) => {
      const b = h('button', { type: 'button', role: 'radio', 'data-v': id, onclick: () => { if (get() === id) return; set(id); sync(); } }, t);
      if (tips && tips[id]) tip(b, tips[id]);
      return b;
    });
    const el = h('div.seg', { role: 'radiogroup', 'aria-label': label }, btns);
    function sync() { btns.forEach((b) => { const on = b.dataset.v === get(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
    el.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement), step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (i < 0 || !step) return;
      e.preventDefault(); const j = (i + step + btns.length) % btns.length; btns[j].focus(); btns[j].click();
    });
    sync();
    el.sync = sync;
    return el;
  }

  /** Recompute everything for the current source and patch the page (scroll position kept). */
  function refresh() {
    const y = window.scrollY;
    M.d = compute();
    syncHead();
    buildList();
    buildCard();
    buildPack();
    buildRaw();
    syncProgress();
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }
  function setRaw(on) {
    M.rawCb.checked = on;
    save((b) => { b.mats.raw = on; });
    M.open.clear();
    refresh();
  }

  /* ---- head ---- */
  function srcThumb(info, size) {
    return info.icon ? h('span.mt-thumb', { 'aria-hidden': 'true' }, TH.icon(info.icon, { size: size || 24 }))
      : h('span.mt-thumb.mt-thumb-file', { 'aria-hidden': 'true' }, gl(info.kind === 'list' ? 'list' : 'file'));
  }
  function syncHead() {
    const d = M.d, info = srcInfo(d.key);
    M.srcBtn.replaceChildren(srcThumb(info, 24), h('span.mt-srckey-name', info.name), gl('chev', 'mt-chev'));
    M.srcBtn.setAttribute('aria-label', 'Material list for ' + info.name + '. Change the source');
    const k = [tip(h('button.btn.mt-key', { type: 'button', onclick: () => openAdd(null) }, gl('plus'), 'Add a list'), 'Paste a list (Litematica material list, CSV or lines like "Stone Bricks 64") or open a .txt, .csv or schematic file')];
    if (info.kind === 'list') k.push(h('button.btn.mt-key', { type: 'button', onclick: () => openAdd(listRec(d.key)) }, gl('pen'), 'Edit list'));
    M.keys.replaceChildren(...k);
  }
  function syncHeadOpen() {
    const open = !M.pick.hidden || !M.add.hidden;
    M.head.classList.toggle('panel', open);
    M.head.classList.toggle('has-open', open);
  }

  /* ---- source picker (folds open under the head, no dropdown) ---- */
  function togglePick(force) {
    const open = force != null ? force : M.pick.hidden;
    if (open) { M.add.hidden = true; fillPick(); }
    M.pick.hidden = !open;
    M.srcBtn.setAttribute('aria-expanded', String(open));
    syncHeadOpen();
    if (open) {
      const f = M.pick.querySelector('.mt-pick-q');
      if (f && hovers()) f.focus({ preventScroll: true });
      const top = M.head.getBoundingClientRect().top;
      if (top < 60) window.scrollBy({ top: top - 90 });
    }
  }
  function choose(key) {
    save((b) => { b.matSrc = key; });
    M.open.clear(); M.packAll = false; M.rawAll = false;
    togglePick(false);
    refresh();
  }
  function fillPick() {
    const cur = srcKey(), all = A.sources();
    const q = h('input.field.mt-pick-q', { type: 'search', placeholder: 'Search builds and lists', 'aria-label': 'Search sources', autocomplete: 'off', spellcheck: false });
    const opt = (key, name, icon, kind) => {
      const on = key === cur;
      return h('button.btn.mt-opt' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), 'data-name': name.toLowerCase(), onclick: () => choose(key) },
        h('span.mt-opt-ico', icon ? TH.icon(icon, { size: 24 }) : gl(kind === 'list' ? 'list' : 'file')), h('span.mt-opt-name', name));
    };
    const groups = [];
    const L = lists();
    if (L.length) {
      groups.push(['Your lists', L.map((l) => {
        const key = 'list:' + l.id;
        const ren = tip(h('button.mt-x', { type: 'button', 'aria-label': 'Rename ' + l.name, onclick: () => renameList(l, wrap) }, gl('pen')), 'Rename');
        const del = tip(h('button.mt-x', { type: 'button', 'aria-label': 'Delete ' + l.name, onclick: () => deleteList(l) }, gl('x')), 'Delete this list');
        const wrap = h('div.mt-opt-row', { 'data-name': l.name.toLowerCase() }, opt(key, l.name, null, 'list'), ren, del);
        return wrap;
      })]);
    }
    const yours = all.filter((s) => s.kind === 'yours' || s.kind === 'shape');
    if (yours.length) groups.push(['Your builds', yours.map((s) => opt(s.key, s.name, s.icon, s.kind))]);
    [['farm', 'Farms'], ['machine', 'Machines'], ['build', 'Structures']].forEach(([k, t]) => {
      const g = all.filter((s) => s.kind === k);
      if (g.length) groups.push([t, g.map((s) => opt(s.key, s.name, s.icon, s.kind))]);
    });
    const body = h('div.mt-pick-body.th-scroll', groups.map(([t, els]) => h('div.mt-pick-grp', h('div.mt-eyebrow', t), h('div.mt-pick-opts', els))));
    const none = h('p.mt-note', { hidden: true }, 'Nothing matches.');
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase();
      let any = false;
      body.querySelectorAll('.mt-pick-grp').forEach((g) => {
        let vis = 0;
        g.querySelectorAll('.mt-pick-opts > *').forEach((o) => { const ok = !t || (o.dataset.name || '').includes(t); o.hidden = !ok; if (ok) vis++; });
        g.hidden = !vis; if (vis) any = true;
      });
      none.hidden = any;
    });
    M.pick.replaceChildren(h('div.mt-pick-top', q, h('button.btn.mt-key', { type: 'button', onclick: () => togglePick(false) }, 'Done')), body, none);
    M.pick.onkeydown = (e) => { if (e.key === 'Escape') { togglePick(false); M.srcBtn.focus(); } };
  }
  function renameList(l, wrap) {
    const f = h('input.field.mt-ren', { type: 'text', value: l.name, maxlength: LIST_NAME_CAP, 'aria-label': 'List name' });
    const done = (ok) => {
      const v = f.value.trim();
      if (ok && v && v !== l.name) save((b) => { const x = (b.lists || []).find((y) => y.id === l.id); if (x) x.name = v; });
      fillPick(); syncHead(); buildCard();
    };
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
    f.addEventListener('blur', () => { if (f.isConnected) done(true); });
    wrap.replaceChildren(f);
    f.focus(); f.select();
  }
  function deleteList(l) {
    TH.util.guard(true, 'Delete the list “' + l.name + '”? Its ticks go with it.', () => {
      const key = 'list:' + l.id;
      save((b) => {
        b.lists = (b.lists || []).filter((x) => x.id !== l.id);
        [key, key + '#raw'].forEach((k) => { delete b.ticks[k]; if (b.have) delete b.have[k]; });
        if (b.matSrc === key) b.matSrc = 'stage';
      });
      TH.util.toast('Deleted ' + l.name);
      refresh(); togglePick(true);
    }, 'Delete');
  }

  /* ---- add / edit a list ---- */
  function openAdd(rec) {
    togglePick(false);
    const name = h('input.field.mt-add-name', { type: 'text', maxlength: LIST_NAME_CAP, placeholder: 'Name, e.g. Castle walls', 'aria-label': 'List name', value: rec ? rec.name : '' });
    const ta = h('textarea.field.mt-paste', { rows: 8, spellcheck: false, 'aria-label': 'Material list text', placeholder: 'Paste the Litematica material list (the table or the CSV), or lines like:\nStone Bricks 64\n64x Oak Planks\nGlass: 3 stacks' });
    ta.value = rec ? rec.text : '';
    const status = h('p.mt-add-status', { 'aria-live': 'polite' });
    const saveBtn = h('button.btn.primary.mt-key', { type: 'button', onclick: () => commit() }, rec ? 'Save changes' : 'Save list');
    const fileBtn = tip(h('button.btn.mt-key', { type: 'button', onclick: () => { M.fileFor = 'form'; M.fileIn.click(); } }, gl('up'), 'Choose a file'), '.txt / .csv become a list here; a .litematic, .schem, .nbt or .schematic opens as a build with its 3D view and this list');
    const cancel = h('button.btn.ghost.mt-key', { type: 'button', onclick: () => { M.add.hidden = true; syncHeadOpen(); } }, 'Cancel');
    function check() {
      const p = listRows(ta.value), unk = p.rows.filter((r) => isTextItem(r.item)).length;
      status.textContent = !ta.value.trim() ? 'Paste a list or choose a file.' : p.rows.length ? p.rows.length + (p.rows.length === 1 ? ' material' : ' materials') + ' found' + (unk ? ' · ' + unk + ' kept as text (no texture)' : '') + (p.rows.some((r) => r.have0) ? ' · “Available” counts kept as what you have' : '') : 'No materials found yet. Each line needs a name and a number.';
      saveBtn.disabled = !p.rows.length;
      if (!name.value.trim() && p.title && !/^unnamed$/i.test(p.title)) name.placeholder = p.title;
    }
    function commit() {
      const p = listRows(ta.value);
      if (!p.rows.length) return;
      const nm = (name.value.trim() || (p.title && !/^unnamed$/i.test(p.title) ? p.title : '') || (rec ? rec.name : 'List ' + (lists().length + 1))).slice(0, LIST_NAME_CAP);
      const id = rec ? rec.id : TH.util.uid('l');
      saveList(id, nm, ta.value, p);
      M.add.hidden = true;
      choose('list:' + id);
      TH.util.toast((rec ? 'Updated ' : 'Saved ') + nm);
    }
    ta.addEventListener('input', check);
    M.add.replaceChildren(h('div.mt-add-head', h('span.mt-eyebrow.mt-acc', rec ? 'Edit list' : 'Add a list'), h('span.mt-note', 'Litematica: Material List → copy the table or “Write to file”')), name, ta, status, h('div.mt-actions', saveBtn, fileBtn, cancel));
    M.add.form = { name, ta, check };
    M.add.hidden = false;
    syncHeadOpen();
    M.add.onkeydown = (e) => { if (e.key === 'Escape') { M.add.hidden = true; syncHeadOpen(); M.srcBtn.focus(); } };
    check();
    ta.focus({ preventScroll: true });
  }
  /** Store a list; Litematica's Available column fills "have" for items that have none yet. */
  function saveList(id, name, text, p) {
    const key = 'list:' + id;
    save((b) => {
      b.lists = b.lists || [];
      const ex = b.lists.find((x) => x.id === id);
      if (ex) { ex.name = name; ex.text = text; ex.at = Date.now(); } else b.lists.unshift({ id, name, text, at: Date.now() });
      b.have = b.have || {};
      p.rows.forEach((r) => {
        if (r.have0 > 0) { const hv = b.have[key] || (b.have[key] = {}); if (hv[r.item] == null) hv[r.item] = Math.min(r.have0, r.n); if (hv[r.item] >= r.n) (b.ticks[key] || (b.ticks[key] = {}))[r.item] = 1; }
        if (r.done0) (b.ticks[key] || (b.ticks[key] = {}))[r.item] = 1;
      });
    });
  }
  const mounted = () => !!(M && M.root && M.root.isConnected);
  /** A file (picker, drop here, or a .txt dropped on the Builds stage): text lists become saved lists, schematics open as builds. */
  function importFile(f, into) {
    if (!isText(f) && /\.(schem|schematic|litematic|nbt|json)$/i.test(f.name || '')) {
      if (M && M.add) { M.add.hidden = true; syncHeadOpen(); }
      A.openFile(f, { mats: true, done: () => { if (mounted()) { M.open.clear(); refresh(); } } });
      return;
    }
    if (f.size > 4e6) { TH.util.toast('That file is too big for a material list.'); return; }
    f.text().then((text) => {
      const p = listRows(text);
      if (into === 'form' && mounted() && M.add.form && !M.add.hidden) {
        M.add.form.ta.value = text;
        if (!M.add.form.name.value.trim()) M.add.form.name.value = (p.title && !/^unnamed$/i.test(p.title) ? p.title : String(f.name).replace(/\.[a-z]+$/i, '')).slice(0, LIST_NAME_CAP);
        M.add.form.check();
        return;
      }
      if (!p.rows.length) { TH.util.toast('No materials found in ' + f.name); return; }
      const id = TH.util.uid('l'), nm = (p.title && !/^unnamed$/i.test(p.title) ? p.title : String(f.name).replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ')).slice(0, LIST_NAME_CAP);
      saveList(id, nm, text, p);
      if (mounted()) { M.add.hidden = true; syncHeadOpen(); choose('list:' + id); }
      else { save((b) => { b.matSrc = 'list:' + id; }); location.hash = '#/materials'; }
      TH.util.toast('Saved ' + nm + ' · ' + p.rows.length + ' materials');
    }, () => TH.util.toast('Could not read ' + f.name));
  }

  /* ---- the source card (top of the side panel): what, how much, how far ---- */
  function buildCard() {
    const d = M.d, info = srcInfo(d.key);
    let size = null;
    if (!info.key.startsWith('list:')) { const s = A.effective(info.key); if (s && s.size) size = s.size.join(' × '); }
    const keys = [];
    if (info.kind === 'list') keys.push(tip(h('button.btn.mt-key', { type: 'button', onclick: () => openAdd(listRec(d.key)) }, gl('pen'), 'Edit'), 'Edit the list text or its name'));
    else keys.push(tip(h('button.btn.mt-key', { type: 'button', onclick: () => A.view3d(d.key) }, gl('cube'), 'View in 3D'), 'Open it on the Builds stage'));
    keys.push(tip(h('button.btn.mt-key', { type: 'button', onclick: () => togglePick(true) }, gl('swap'), 'Change'), 'Pick another build or list'));
    const slots = d.rows.reduce((a, r) => a + Math.ceil(r.n / r.stack), 0), items = d.rows.reduce((a, r) => a + r.n, 0);
    const stat = (v, ico, word, t) => tip(h('span.mt-stat', { tabindex: 0 }, h('b', v), ico, word ? h('span', word) : null), t);
    M.prog = h('span.mt-bar', { role: 'img' }, h('span'));
    M.progN = h('span.mt-prog-n');
    M.card.replaceChildren(
      h('div.mt-card-top', srcThumb(info, 32),
        h('div.mt-card-txt', h('span.mt-card-name', info.name), h('span.mt-card-sub', h('span', KIND[info.kind] || 'Build'), size ? h('span', size) : null)),
        h('div.mt-card-keys', keys)),
      h('div.mt-stats',
        stat(fmt(items), null, d.raw ? 'raw items' : 'items', 'Every item you need, counted one by one'),
        stat(fmt(d.rows.length), null, 'kinds', 'Different items in the list'),
        stat(fmt(slots), unitIco('st', 12), null, fmt(slots) + ' stacks: one inventory slot each (64, 16 or 1 per stack)'),
        stat(dec(slots / 27), unitIco('sb', 14), null, dec(slots / 27) + ' shulker boxes (' + Math.ceil(slots / 27) + ' to carry it all)'),
        stat(dec(slots / 54), unitIco('dc', 14), null, dec(slots / 54) + ' double chests (' + Math.ceil(slots / 54) + ' to store it all)')),
      h('div.mt-prog', M.prog, M.progN));
  }
  function syncProgress() {
    const d = M.d;
    let doneN = 0, items = 0, got = 0;
    d.rows.forEach((r) => { items += r.n; got += haveOf(r); if (isDone(r)) doneN++; });
    const pct = items ? got / items : 0;
    if (M.prog) {
      M.prog.firstChild.style.width = (pct * 100).toFixed(1) + '%';
      M.prog.setAttribute('aria-label', Math.round(pct * 100) + '% of the items gathered');
      M.progN.textContent = doneN + ' / ' + d.rows.length;
      M.prog.parentElement.classList.toggle('is-done', !!d.rows.length && doneN === d.rows.length);
      if (!M.progTip) { M.progTip = true; tip(M.prog.parentElement, () => { let g = 0, n = 0, k = 0; M.d.rows.forEach((r) => { n += r.n; g += haveOf(r); if (isDone(r)) k++; }); return [h('div.th-tooltip-title', k + ' of ' + M.d.rows.length + ' gathered'), h('div.th-tooltip-sub', fmt(g) + ' of ' + fmt(n) + ' items · ' + (n ? Math.round(g / n * 100) : 0) + '%')]; }); }
    }
    const clr = M.acts.querySelector('.mt-clear');
    if (clr) clr.disabled = !(Object.keys(tmap(d.tk)).length || Object.keys(hmap(d.tk)).length);
  }

  /* ---- the list ---- */
  function buildList() {
    const d = M.d, st = S();
    M.listTitle.textContent = d.raw ? 'Raw materials' : 'Material list';
    M.listCount.textContent = d.rows.length + (d.rows.length === 1 ? ' kind' : ' kinds');
    M.rowEls = new Map();
    M.sortSeg.sync(); M.unitSeg.sync();
    M.rawCb.checked = d.raw;
    const out = [];
    let g = null;
    d.rows.forEach((r) => {
      if (st.sort === 'group' && r.grp !== g) { g = r.grp; out.push(h('div.mt-eyebrow.mt-grp', { 'data-grp': g }, core().GROUPS[g] || 'Other')); }
      out.push(rowEl(r));
    });
    M.rows.replaceChildren(...out);
    M.empty.textContent = d.key.startsWith('list:') ? 'This list has no materials. Edit it to paste the text again.' : 'Nothing to gather here yet.';
    const local = !!window.TH_LOCAL_ASSETS;
    M.acts.replaceChildren(...[
      tip(h('button.btn.mt-key', { type: 'button', onclick: () => copy(listText(), 'Material list copied') }, gl('copy'), 'Copy as text'), 'Grouped, with the amounts in the units you picked; paste it anywhere (or back in here)'),
      local ? null : h('button.btn.mt-key', { type: 'button', onclick: () => A.download(fileName('txt'), listText(), 'text/plain') }, gl('down'), '.txt'),
      local ? null : tip(h('button.btn.mt-key', { type: 'button', onclick: () => A.download(fileName('csv'), listCSV(), 'text/csv') }, gl('down'), 'CSV'), 'For a spreadsheet'),
      h('button.btn.ghost.mt-key.mt-clear', { type: 'button', onclick: () => { save((b) => { delete b.ticks[d.tk]; if (b.have) delete b.have[d.tk]; }); refresh(); } }, 'Clear ticks')].filter(Boolean));
    applyFilter();
  }
  function rowEl(r) {
    const done = isDone(r), open = M.open.has(r.item);
    const cb = h('input', { type: 'checkbox', checked: done, 'aria-label': 'Got all of ' + r.name, onchange: () => { setHave(r, cb.checked ? r.n : 0, cb.checked); patchRow(r); } });
    const chk = tip(h('label.check.mt-chk', cb, h('span')), 'Got it all');
    const nameBtn = h('button.mt-name', { type: 'button', 'aria-expanded': String(open), onclick: () => toggleRow(r) }, h('span.mt-label', r.name));
    let rkey = null;
    if (r.nrec) {
      const st = RC().stationOf(RC().best(r.item, ropts())) || 'block/crafting_table_front';
      rkey = h('button.mt-rkey', { type: 'button', 'aria-expanded': String(open), 'aria-label': 'How to make ' + r.name, onclick: () => toggleRow(r) }, TH.icon(st, { size: 16 }));
      tip(rkey, () => recipeTip(r));
    }
    const need = h('div.mt-need');
    const have = haveField(r);
    const plusSt = r.stack > 1 ? tip(h('button.mt-qk', { type: 'button', 'aria-label': 'Add a stack of ' + r.name, onclick: () => bump(r, r.stack) }, gl('plus', 'mt-qk-plus'), unitIco('st', 12)), 'Add one stack (' + r.stack + ')') : null;
    const plusSb = tip(h('button.mt-qk', { type: 'button', 'aria-label': 'Add a shulker box of ' + r.name, onclick: () => bump(r, r.stack * 27) }, gl('plus', 'mt-qk-plus'), unitIco('sb', 14)), 'Add one shulker box (' + fmt(r.stack * 27) + ')');
    const det = h('div.mt-det', { hidden: !open });
    const itemsC = h('div.mt-items'), stillC = h('div.mt-still');   // wide lists only: the exact count and what is still missing
    const el = h('div.mt-row' + (done ? '.done' : '') + (open ? '.open' : ''), { role: 'listitem', 'data-item': r.item },
      chk, h('span.mt-ico', iconFor(r.item, 32)), h('div.mt-namecell', nameBtn, rkey), need, itemsC, have.wrap, stillC, h('div.mt-quick', plusSt, plusSb), det);
    el._r = r; el._cb = cb; el._need = need; el._have = have; el._det = det; el._items = itemsC; el._still = stillC; el._btns = [nameBtn, rkey].filter(Boolean);
    M.rowEls.set(r.item, el);
    fillNeed(el);
    if (open) fillDet(el);
    return el;
  }
  /** The needed amount: split into the picked unit (with unit pictures) over the other reading. */
  function fillNeed(el) {
    const r = el._r, u = U(), hv = haveOf(r), left = r.n - hv;
    const main = h('span.mt-need-main', bits(r.n, r.stack, u));
    const sub = u === 'items' ? (r.stack > 1 && r.n >= r.stack ? h('span.mt-need-sub', bits(r.n, r.stack, 'stacks')) : null) : h('span.mt-need-sub', h('span.mt-bit', h('b', fmt(r.n))));
    const still = hv > 0 && left > 0 ? h('span.mt-left', '−' + fmt(left)) : null;
    el._need.replaceChildren(main, h('span.mt-need-line', sub, still));
    // wide columns: the other reading of the amount, and what is still missing in the picked unit
    el._items.replaceChildren(...(u === 'items' ? (r.stack > 1 && r.n >= r.stack ? bits(r.n, r.stack, 'stacks') : []) : [h('span.mt-bit', h('b', fmt(r.n)))]));
    el._still.replaceChildren(isDone(r) ? gl('check', 'mt-still-ok') : hv > 0 ? h('span.mt-still-n', bits(left, r.stack, u)) : h('span.mt-still-all', '–'));
    if (M.colItems) M.colItems.textContent = u === 'items' ? 'Stacks' : 'Items';
    tip(el._need, () => [h('div.th-tooltip-title', amountWords(r.n, r.stack, u === 'items' ? 'boxes' : u)), h('div.th-tooltip-sub', fmt(r.n) + ' items' + (r.stack !== 64 ? ' · stacks of ' + r.stack : '')),
      hv > 0 && left > 0 ? h('div.th-tooltip-sub', 'still ' + amountWords(left, r.stack, u === 'items' ? 'stacks' : u)) : null].filter(Boolean));
  }
  /** The "have" field: reads units ('2sb', '3 st 5', '64x'; a bare number in the picked unit) and shows the exact total under it. */
  function haveField(r) {
    const f = h('input.field.mt-hv', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: false, placeholder: 'have', 'aria-label': 'You have, ' + r.name });
    const help = h('span.mt-hv-help', { 'aria-live': 'polite' });
    const wrap = h('div.mt-have', f, help);
    const show = () => { const hv = haveOf(r); f.value = hv ? amountText(hv, r.stack, U()) : ''; f.classList.remove('bad'); helpFor(hv); };
    function helpFor(v, typed) {
      if (!(v > 0)) { help.replaceChildren(); return; }
      const parts = split(v, r.stack, U() === 'items' ? 'boxes' : U());
      const words = parts.length > 1 || parts[0][1] ? h('span', '= ', ...bits(v, r.stack, U() === 'items' ? 'boxes' : U())) : null;
      help.replaceChildren(...[typed || U() !== 'items' ? h('b', '= ' + fmt(v)) : null, U() === 'items' ? words : null].filter(Boolean));
    }
    f.addEventListener('input', () => {
      const v = parseAmount(f.value, U(), r.stack);
      if (Number.isNaN(v)) { f.classList.add('bad'); help.replaceChildren(h('span.mt-hv-bad', 'e.g. 2sb · 3 st 5 · 64x')); return; }
      f.classList.remove('bad');
      setHave(r, Math.min(v, r.n), false);
      helpFor(v, true);
      patchRow(r, f);
    });
    f.addEventListener('change', show);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); show(); f.select(); } });
    tip(f, () => [h('div.th-tooltip-title', 'How many you have'), h('div.th-tooltip-sub', 'A number counts in ' + ({ items: 'items', stacks: 'stacks', boxes: 'shulker boxes', dc: 'double chests' })[U()] + ', the unit picked above the list'),
      h('div.th-tooltip-sub', 'Or say it: 2sb · 3 st 5 · 1.5 shulker · 1 dc · 64x')]);
    show();
    return { wrap, f, help, show };
  }
  function bump(r, k) {
    const v = Math.min(r.n, haveOf(r) + k);
    setHave(r, v, v >= r.n);
    patchRow(r);
  }
  /** Update one row (and everything that counts it) without rebuilding it. `keep` = the field being typed in. */
  function patchRow(r, keep) {
    const el = M.rowEls.get(r.item);
    if (!el) return;
    const done = isDone(r);
    el.classList.toggle('done', done);
    el._cb.checked = done;
    if (el._have.f !== keep) el._have.show();
    fillNeed(el);
    syncProgress();
    dimPack();
    if (MS().hide && done && document.activeElement !== keep) applyFilter();
  }
  function syncUnits() {
    M.rowEls.forEach((el) => { fillNeed(el); if (document.activeElement !== el._have.f) el._have.show(); });
    buildRaw();
  }
  function applyFilter() {
    const t = (M.q.value || '').trim().toLowerCase(), hide = !!MS().hide;
    let vis = 0;
    M.rowEls.forEach((el) => { const ok = (!t || el._r.name.toLowerCase().includes(t)) && !(hide && el.classList.contains('done')); el.hidden = !ok; if (ok) vis++; });
    M.rows.querySelectorAll('.mt-grp').forEach((g) => {
      let n = g.nextElementSibling, any = false;
      while (n && !n.classList.contains('mt-grp')) { if (!n.hidden) { any = true; break; } n = n.nextElementSibling; }
      g.hidden = !any;
    });
    M.empty.hidden = !!vis || (!!M.d.rows.length && !(t || hide));
    if (M.d.rows.length && !vis) M.empty.textContent = hide && !t ? 'Everything is gathered.' : 'Nothing matches the filter.';
  }

  /* ---- recipes, drawn the way the game shows them ---- */
  const cell = (id, n) => h('span.mt-cell', id ? iconFor(id, 20) : null, id && n > 1 ? h('b.mt-n', fmt(n)) : null);
  const inId = (i) => (String(i).startsWith('tag:') ? i : 'minecraft:' + RC().bare(i));
  /** One recipe as a picture: the 3x3 crafting grid (or the one input slot), the station, the result with its count. */
  function recipeVis(rc, id) {
    const R = RC();
    let input;
    if (rc.method === 'crafting' && rc.grid) {
      input = h('span.mt-cg' + (rc.shapeless ? '.shapeless' : ''), rc.grid.map((x) => cell(x ? inId(x) : null)),
        rc.shapeless ? tip(h('span.mt-cg-mix', { tabindex: -1 }, gl('mix')), 'Shapeless: any order') : null);
    } else input = h('span.mt-cg1', rc.in.map(([i, k]) => cell(inId(i), k)));
    const st = R.stationOf(rc);
    const via = h('span.mt-via', st ? TH.icon(st, { size: 18 }) : null, rc.method === 'smelting' ? gl('flame', 'mt-flame') : null, gl('arrow', 'mt-arrow'));
    return h('span.mt-rv', { 'data-m': rc.method }, input, via, h('span.mt-out', cell(id, rc.out)));
  }
  /** A compact one-line version: inputs with counts -> station -> result (other methods, crafting steps). */
  function recipeFlow(rc, id, k) {
    k = k || 1;
    const st = RC().stationOf(rc);
    return h('span.mt-flow', rc.in.map(([i, c]) => cell(inId(i), c * k)), h('span.mt-via', st ? TH.icon(st, { size: 16 }) : null, gl('arrow', 'mt-arrow')), cell(id, rc.out * k));
  }
  /** The tooltip of a row's recipe key: the recipe in use drawn in full, the other ways small, the raw materials as icons. */
  function recipeTip(r) {
    const R = RC(), list = R.recipesFor(r.item);
    if (!list.length) return null;
    const used = R.bestIndex(r.item, ropts()), cheap = R.cheapest(r.item, ropts()), off = (rc) => MS().sc === false && rc.method === 'stonecutting' && list.some((x) => x.method !== 'stonecutting');
    const main = list[used >= 0 ? used : 0];
    const others = list.filter((x) => x !== main);
    const raw = R.raw([{ item: r.item, n: r.n }], ropts()).rows;
    return h('div.mt-rtip',
      h('div.th-tooltip-title', r.name),
      h('div.mt-rtip-main', recipeVis(main, r.item), list.indexOf(main) === cheap && list.length > 1 ? h('span.mt-best', gl('star')) : null),
      others.length ? h('div.mt-rtip-others', others.map((x) => h('div.mt-rtip-o' + (off(x) ? '.off' : ''), recipeVis(x, r.item), list.indexOf(x) === cheap ? h('span.mt-best', gl('star')) : null))) : null,
      raw.length && !(raw.length === 1 && raw[0].item === r.item) ? h('div.mt-rtip-raw', raw.map((x) => cell(x.item, x.n))) : null);
  }

  /* ---- a row opened: every recipe with "Use", the raw materials, what it goes into ---- */
  function toggleRow(r) {
    const el = M.rowEls.get(r.item);
    if (!el) return;
    const open = !M.open.has(r.item);
    if (open) M.open.add(r.item); else M.open.delete(r.item);
    el._btns.forEach((b) => b.setAttribute('aria-expanded', String(open)));
    el.classList.toggle('open', open);
    el._det.hidden = !open;
    if (open) fillDet(el);
  }
  function fillDet(el) {
    const r = el._r, R = RC(), d = M.d;
    const parts = [];
    if (isTextItem(r.item)) parts.push(h('p.mt-note', 'A name the tool does not know, so it stays as text: no texture or recipe.'));
    else {
      const list = R.recipesFor(r.item);
      if (list.length) {
        const cheap = R.cheapest(r.item, ropts()), used = R.bestIndex(r.item, ropts()), pick = (MS().pick || {})[r.item];
        parts.push(h('div.mt-rcps', list.map((rc, i) => {
          const off = MS().sc === false && rc.method === 'stonecutting' && list.some((x) => x.method !== 'stonecutting');
          const use = i !== used && list.length > 1 && !off
            ? tip(h('button.btn.mt-key.mt-use', { type: 'button', onclick: () => pickRecipe(r.item, i === cheap ? null : i) }, 'Use'), 'Count the list with this recipe')
            : null;
          const mark = i === used && list.length > 1 ? tip(h('span.mt-inuse', { tabindex: 0 }, gl('check')), 'In use') : null;
          return h('div.mt-rcp' + (i === used ? '.used' : '') + (off ? '.off' : ''), recipeVis(rc, r.item), i === cheap && list.length > 1 ? tip(h('span.mt-best', { tabindex: 0 }, gl('star')), 'Best: the fewest raw items') : null, mark, use,
            rc.note ? h('span.mt-rcp-note', rc.note) : null);
        })));
        if (pick != null) parts.push(h('button.mt-link', { type: 'button', onclick: () => pickRecipe(r.item, null) }, 'Back to the best recipe'));
        const rw = R.raw([{ item: r.item, n: r.n }], ropts());
        parts.push(h('div.mt-det-raw', h('span.mt-eyebrow', 'Raw'), h('div.mt-icons', rw.rows.map((x) => slotIco(x.item, x.n, 24)))));
      } else if (!d.raw) parts.push(h('p.mt-note', 'No recipe: you mine, farm or find it as it is.'));
      if (d.raw && d.usedBy && d.usedBy.get(r.item)) {
        parts.push(h('div.mt-det-raw', h('span.mt-eyebrow', 'Goes into'), h('div.mt-icons', d.usedBy.get(r.item).map(([it, n, label]) => { if (label) M.d.names.set(it, label); return slotIco(it, n, 24); }))));
      }
    }
    el._det.replaceChildren(...parts);
  }
  function pickRecipe(item, i) {
    save((b) => { b.mats.pick = b.mats.pick || {}; if (i == null) delete b.mats.pick[item]; else b.mats.pick[item] = i; });
    refresh();
  }

  /* ---- packing: one card per container, its slots as icons on one quiet well ---- */
  /** The rows to pack: the list itself, or (switch 'Raw materials') everything broken down to what you mine and farm. */
  function packSource() {
    const d = M.d;
    if (MS().packRaw && !d.raw) {
      const R = RC();
      return R.raw(d.base, ropts()).rows.map((x) => ({ item: x.item, n: x.n, stack: stackOf(x.item), name: R.nameOf(x.item), grp: isTextItem(x.item) ? 'misc' : R.groupOf(x.item) }))
        .sort((a, b) => b.n - a.n);
    }
    return d.rows;
  }
  function packRows() {
    const rows = packSource();
    if (MS().pack !== 'sorted') return rows;
    const go = GROUP_ORDER(), gi = (g) => { const i = go.indexOf(g); return i < 0 ? 99 : i; };
    return rows.map((r, i) => [r, i]).sort((a, b) => gi(a[0].grp) - gi(b[0].grp) || a[1] - b[1]).map((x) => x[0]);
  }
  const CONT = { box: ['Shulker box', 'Shulker boxes', 'Box '], dc: ['Double chest', 'Double chests', 'Chest '] };
  function buildPack() {
    const ms = MS(), cont = ms.cont === 'dc' ? 'dc' : 'box', size = SLOTS[cont];
    const bins = pack(packRows(), { size, mode: ms.pack === 'sorted' ? 'sorted' : 'tight' });
    M.bins = bins;
    const slots = bins.reduce((a, b) => a + b.slots.length, 0), free = bins.length * size - slots;
    const contSeg = seg('Container', [['box', 'Shulker boxes'], ['dc', 'Double chests']], () => (MS().cont === 'dc' ? 'dc' : 'box'), (v) => { save((b) => { b.mats.cont = v; }); M.packAll = false; buildPack(); });
    const modeSeg = seg('Packing', [['tight', 'Tight'], ['sorted', 'Sorted']], () => (MS().pack === 'sorted' ? 'sorted' : 'tight'), (v) => { save((b) => { b.mats.pack = v; }); buildPack(); },
      { tight: 'Fewest containers: big items first, each kept in one container where it fits', sorted: 'Related blocks together: by group, in list order, container by container' });
    const whatSeg = M.d.raw ? null : seg('What to pack', [['list', 'The list'], ['raw', 'Raw materials']], () => (MS().packRaw ? 'raw' : 'list'), (v) => { save((b) => { b.mats.packRaw = v === 'raw'; }); M.packAll = false; buildPack(); },
      { list: 'Pack the blocks of the list as they are', raw: 'Pack what you actually gather: the list broken down to raw materials' });
    const grid = h('div.mt-boxes');
    const FIRST = 6;
    const showN = M.packAll ? bins.length : Math.min(bins.length, FIRST);
    const more = bins.length > showN ? h('button.btn.mt-key.mt-more', { type: 'button', onclick: () => { M.packAll = true; more.remove(); chunked(grid, bins, showN); } }, 'Show all ' + bins.length) : null;
    for (let i = 0; i < showN && i < FIRST; i++) grid.append(boxEl(bins[i], i, size, cont));
    if (showN > FIRST) chunked(grid, bins, FIRST, showN);
    const count = bins.length ? tip(h('span.mt-count', { tabindex: 0 }, h('b', fmt(bins.length)), unitIco(cont === 'dc' ? 'dc' : 'sb', 14), free ? h('span', fmt(free) + ' free') : null),
      fmt(slots) + ' slots in ' + bins.length + ' ' + (bins.length === 1 ? CONT[cont][0] : CONT[cont][1]).toLowerCase() + (free ? ', ' + free + ' slots free' : ', completely full')) : h('span.mt-count', 'Nothing to pack');
    M.packBody.replaceChildren(...[
      h('div.mt-pan-head', h('h3', 'Packing'), count),
      h('div.mt-tools-b', ...[whatSeg, contSeg, modeSeg].filter(Boolean)),
      grid, more,
      bins.length ? h('div.mt-actions', tip(h('button.btn.mt-key', { type: 'button', onclick: () => copy(packText(), 'Packing copied') }, gl('copy'), 'Copy packing'), 'Every container with what goes in it, as text')) : null].filter(Boolean));
    dimPack();
  }
  /** Build the remaining container cards a few per tick, so 50 double chests never block the page. */
  function chunked(grid, bins, from, to) {
    to = to == null ? bins.length : to;
    const cont = MS().cont === 'dc' ? 'dc' : 'box', size = SLOTS[cont];
    let i = from;
    const step = () => {
      if (!grid.isConnected && i > from) return;
      const end = Math.min(to, i + 4);
      for (; i < end; i++) grid.append(boxEl(bins[i], i, size, cont));
      dimPack();
      if (i < to) setTimeout(step, 16);   // not rAF: it pauses in background tabs and would leave the list half built
    };
    step();
  }
  function boxEl(b, i, size, cont) {
    const cells = [];
    for (let k = 0; k < size; k++) {
      const s = b.slots[k];
      if (!s) { cells.push(h('span.mt-cell.e')); continue; }
      cells.push(tip(h('span.mt-cell', { 'data-item': s.item }, iconFor(s.item, 24), s.n > 1 ? h('b.mt-n', String(s.n)) : null), () => nameOf(s.item) + ' × ' + s.n));
    }
    const by = new Map();
    b.slots.forEach((s) => by.set(s.item, (by.get(s.item) || 0) + s.n));
    const head = tip(h('div.mt-box-head', { tabindex: 0 }, unitIco(cont === 'dc' ? 'dc' : 'sb', 16), h('span.mt-box-name', CONT[cont][2] + (i + 1)), h('span.mt-box-fill', b.slots.length + '/' + size)),
      () => [h('div.th-tooltip-title', CONT[cont][0] + ' ' + (i + 1)), ...[...by].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([it, n]) => h('div.th-tooltip-sub', nameOf(it) + ' × ' + fmt(n))), by.size > 8 ? h('div.th-tooltip-sub', '+ ' + (by.size - 8) + ' more') : null].filter(Boolean));
    return h('div.mt-box', { role: 'group', 'aria-label': CONT[cont][0] + ' ' + (i + 1) }, head, h('div.mt-well' + (size === 54 ? '.c54' : ''), cells));
  }
  function dimPack() {
    if (!M || !M.packBody) return;
    const done = new Set(M.d.rows.filter(isDone).map((r) => r.item));
    M.packBody.querySelectorAll('.mt-cell[data-item]').forEach((s) => s.classList.toggle('done', done.has(s.dataset.item)));
  }

  /* ---- raw materials (side) / crafting steps in raw mode ---- */
  function buildRaw() {
    const d = M.d, R = RC(), u = U();
    const scCb = h('input', { type: 'checkbox', checked: MS().sc !== false, onchange: () => { save((b) => { b.mats.sc = scCb.checked; }); refresh(); } });
    const scSw = tip(h('label.mt-sw', h('span.switch', scCb, h('span')), TH.icon('block/stonecutter_side', { size: 16 }), h('span', 'Prefer the stonecutter')), 'Cut stairs, slabs, walls and polished or brick blocks in a stonecutter: one block each, no leftovers. Off: the crafting table');
    if (!d.raw) {
      const r = R.raw(d.base, ropts()), rows = r.rows.map((x) => Object.assign(x, { stack: stackOf(x.item), name: R.nameOf(x.item) }));
      const N = 12, shown = M.rawAll ? rows : rows.slice(0, N);
      const line = (x) => h('div.mt-rawrow', h('span.mt-rawrow-ico', iconFor(x.item, 24)), h('span.mt-rawrow-name', x.name), h('span.mt-rawrow-n', bits(x.n, x.stack, u)));
      M.rawPanel.replaceChildren(...[
        h('div.mt-pan-head', h('h3', 'Raw materials'), h('span.mt-count', rows.length + (rows.length === 1 ? ' kind' : ' kinds'))),
        scSw,
        r.steps.length ? null : h('p.mt-note', 'Nothing here needs crafting: every block is gathered as it is.'),
        h('div.mt-rawlist', shown.map(line)),
        rows.length > shown.length ? h('button.mt-link', { type: 'button', onclick: () => { M.rawAll = true; buildRaw(); } }, 'Show all ' + rows.length) : null,
        r.steps.length ? h('div.mt-actions', tip(h('button.btn.mt-key', { type: 'button', onclick: () => setRaw(true) }, 'Use as the list'), 'Tick off the raw materials instead')) : null].filter(Boolean));
      return;
    }
    const step = (s) => h('div.mt-step', recipeFlow(s.recipe, s.item, s.crafts),
      h('span.mt-step-x', '×' + s.crafts), s.made > s.need ? tip(h('span.mt-step-spare', { tabindex: 0 }, '+' + fmt(s.made - s.need)), fmt(s.made - s.need) + ' spare') : null);
    M.rawPanel.replaceChildren(
      h('div.mt-pan-head', h('h3', 'Crafting steps'), h('span.mt-count', d.steps.length + (d.steps.length === 1 ? ' step' : ' steps'))),
      scSw,
      d.steps.length ? null : h('p.mt-note', 'Nothing to craft: the list is raw already.'),
      h('div.mt-steps', d.steps.map(step)),
      h('div.mt-actions', h('button.btn.mt-key', { type: 'button', onclick: () => setRaw(false) }, 'Back to the build list')));
  }

  /* ---- text out ---- */
  function copy(text, msg) {
    const ok = () => TH.util.toast(msg);
    const fb = () => { const ta = h('textarea', { style: { position: 'fixed', opacity: 0, left: '-9999px' } }); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { TH.util.toast('Could not copy'); } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
  }
  const fileName = (ext) => String(srcInfo(M.d.key).name || 'materials').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (M.d.raw ? '-raw' : '') + '-materials.' + ext;
  function listText() {
    const d = M.d, u = U(), info = srcInfo(d.key);
    const slots = d.rows.reduce((a, r) => a + Math.ceil(r.n / r.stack), 0), items = d.rows.reduce((a, r) => a + r.n, 0);
    const out = [info.name + ' — ' + (d.raw ? 'raw materials' : 'materials') + ' (' + d.rows.length + ' kinds · ' + fmt(items) + ' items · ' + fmt(slots) + ' stacks · ' + dec(slots / 27) + ' shulker boxes)', ''];
    const go = GROUP_ORDER(), byG = new Map();
    d.rows.forEach((r) => { if (!byG.has(r.grp)) byG.set(r.grp, []); byG.get(r.grp).push(r); });
    [...byG.keys()].sort((a, b) => (go.indexOf(a) < 0 ? 99 : go.indexOf(a)) - (go.indexOf(b) < 0 ? 99 : go.indexOf(b))).forEach((g) => {
      out.push((core().GROUPS[g] || 'Other').toUpperCase());
      byG.get(g).forEach((r) => {
        const hv = haveOf(r), uu = u === 'items' ? 'stacks' : u;
        out.push((isDone(r) ? '[x] ' : '[ ] ') + r.name + ': ' + fmt(r.n) + (r.stack > 1 && r.n >= r.stack ? ' (' + amountWords(r.n, r.stack, uu) + ')' : '') + (hv && !isDone(r) ? ' · have ' + fmt(hv) : ''));
      });
      out.push('');
    });
    return out.join('\n').trim() + '\n';
  }
  function listCSV() {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = [['Item', 'Total', 'Have', 'Missing', 'Stacks', 'Shulker boxes', 'Gathered', 'Group'].map(q).join(',')];
    M.d.rows.forEach((r) => { const hv = haveOf(r), sl = Math.ceil(r.n / r.stack); rows.push([q(r.name), r.n, hv, r.n - hv, sl, (sl / 27).toFixed(2), isDone(r) ? 'yes' : 'no', q(core().GROUPS[r.grp] || 'Other')].join(',')); });
    return rows.join('\n') + '\n';
  }
  function packText() {
    const cont = MS().cont === 'dc' ? 'dc' : 'box', size = SLOTS[cont];
    return M.bins.map((b, i) => {
      const by = new Map();
      b.slots.forEach((s) => { const e = by.get(s.item) || { n: 0, st: 0, stack: s.stack }; e.n += s.n; e.st++; by.set(s.item, e); });
      return CONT[cont][0] + ' ' + (i + 1) + ' (' + b.slots.length + '/' + size + '): ' + [...by].map(([it, e]) => nameOf(it) + ' ×' + fmt(e.n) + (e.st > 1 ? ' (' + e.st + ' slots)' : '')).join(', ');
    }).join('\n') + '\n';
  }

  function init(api) { A = api; }
  return { parse, resolve, stackOf, amount, split, amountText, amountWords, parseAmount, unitSize, pack, init, render, importFile, isText, listRows };
})();
