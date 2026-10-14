/**
 * Builds > Materials: the smart material list (loaded lazily with the other builds-* files).
 *
 *   Source  = the build on the stage, any farm / machine / structure, your kept files and shape, or a saved LIST
 *             (pasted text or an imported .txt / .csv; Litematica "Material List" tables and CSV exports read as is).
 *   List    = one row per item: texture, name, amount (items / stacks / shulker boxes / double chests), a tick and a
 *             "have" count (Litematica's Available column fills it). Rows open to show their recipes (best one marked,
 *             e.g. the stonecutter instead of crafting stairs) and the raw materials behind them.
 *   Raw     = a switch turns the whole list into the raw materials (TH.data.recipes.raw), with its own ticks.
 *   Packing = how many slots / shulker boxes / double chests it fills, and every container drawn slot by slot
 *             ("Tight" = fewest containers, "Sorted" = list order by group).
 *
 * Pure helpers (no DOM, tested with node): parse(text), resolve(name), stackOf(id), amount(n, stack, units), pack(rows, o).
 * State (state.builds): lists [{ id, name, text, at }], ticks { [key]: { item: 1 } }, have { [key]: { item: n } },
 *   units 'items'|'stacks'|'boxes'|'dc', sort 'count'|'name'|'group', matSrc 'stage'|<source key>,
 *   mats { raw, cont: 'box'|'dc', pack: 'tight'|'sorted', hide, sc, pick: { item: recipe index } }.
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
    if (/^\d{1,3}([ ,.'’  ]\d{3})+(?!\d)/.test(s)) return parseInt(s.match(/^\d{1,3}(?:[ ,.'’  ]\d{3})+/)[0].replace(/\D/g, ''), 10);
    const m = s.match(/^\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }
  const isNum = (s) => /^\s*[x×]?\s*\d[\d ,.'’  ]*\s*$/i.test(String(s == null ? '' : s));
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
      let line = rawLine.replace(/ /g, ' ').trim();
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
   * Stack sizes, amounts, packing
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
  const fmt = (n) => Math.round(n).toLocaleString('en').replace(/,/g, ' ');
  const dec = (x) => (x > 0 && x < 1 ? Math.max(0.01, Math.round(x * 100) / 100) : Math.round(x * 10) / 10).toLocaleString('en', { maximumFractionDigits: 2 });
  /** { main, sub } for n items with this stack size in units 'items' | 'stacks' | 'boxes' | 'dc'. */
  function amount(n, stack, units) {
    if (units === 'items' || !units) return { main: fmt(n), sub: '' };
    const slots = Math.ceil(n / stack);
    if (stack === 1) {
      if (units === 'stacks') return { main: fmt(n), sub: 'unstackable' };
      const per = SLOTS[units === 'dc' ? 'dc' : 'box'];
      return { main: fmt(n), sub: 'unstackable · ' + dec(slots / per) + (units === 'dc' ? ' double chests' : ' boxes') };
    }
    const st = Math.floor(n / stack), rest = n % stack;
    if (units === 'stacks') return { main: st ? fmt(st) + (rest ? ' st + ' + rest : ' st') : String(rest), sub: fmt(n) + ' items' + (stack !== 64 ? ' · stacks of ' + stack : '') };
    const size = units === 'dc' ? SLOTS.dc : SLOTS.box, per = stack * size;
    const bx = Math.floor(n / per), r2 = n % per, st2 = Math.floor(r2 / stack), r3 = r2 % stack;
    const word = units === 'dc' ? (bx > 1 ? ' chests' : ' chest') : (bx > 1 ? ' boxes' : ' box');
    const parts = [];
    if (bx) parts.push(fmt(bx) + word);
    if (st2) parts.push(st2 + ' st');
    if (r3) parts.push(String(r3));
    return { main: parts.join(' + ') || '0', sub: dec(n / per) + (units === 'dc' ? ' double chests' : ' boxes') + ' · ' + fmt(n) + ' items' };
  }
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
  let A = null;   // the builds.js api (init)
  let M = null;   // the mounted section
  const h = (...a) => TH.util.h(...a);
  const tip = (el, c) => { TH.util.tooltip(el, c); return el; };
  const S = () => A.S();
  const save = (fn) => A.save(fn);
  const MS = () => S().mats;
  const ropts = () => ({ sc: MS().sc !== false, pick: MS().pick || {} });
  const isText = (f) => /\.(txt|csv|tsv|md|text|list)$/i.test(f.name || '') || /^text\//.test(f.type || '');
  const LIST_NAME_CAP = 48;

  // small pixel glyphs of our own (7x7, currentColor)
  const GL = {
    chev: ['.......', '.#...#.', '..#.#..', '...#...', '.......', '.......', '.......'],
    list: ['#.#####', '.......', '#.#####', '.......', '#.#####', '.......', '#.#####'],
    pen: ['....##.', '...#.##', '..#.##.', '.#.##..', '#.##...', '##.....', '###....'],
    arrow: ['.......', '....#..', '.....#.', '#######', '.....#.', '....#..', '.......'],
    cube: ['..###..', '.#####.', '#######', '#..#..#', '#..#..#', '.#.#.#.', '..###..'],
  };
  const glUrl = new Map();
  function gl(name, cls) {
    if (!GL[name]) return A.glyph(name, cls);
    let u = glUrl.get(name);
    if (!u) {
      let d = '';
      GL[name].forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') d += 'M' + x + ' ' + y + 'h1v1h-1z'; });
      u = 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 7 7' shape-rendering='crispEdges'><path d='" + d + "'/></svg>") + '")';
      glUrl.set(name, u);
    }
    const el = h('span.bd-ico' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    el.style.setProperty('--m', u);
    return el;
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
    if (!s || s.startsWith('text:')) return h('span.bd-noico', { 'aria-hidden': 'true' });
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
        el.replaceChildren(); el.classList.add('bd-noico-mc');
      };
    }
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
      else m.set(item, { item, n, have0: r.have || 0, done0: !!r.done, label: id && (core().BLOCKS[RC().bare(id)] || RC().knows(id) || RC().NAMES[RC().bare(id)]) ? null : r.name.trim() });
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
      r.grp = String(r.item).startsWith('text:') ? 'misc' : R.groupOf(r.item);
      r.nrec = String(r.item).startsWith('text:') ? 0 : R.recipesFor(r.item).length;
    });
    const go = GROUP_ORDER();
    const gi = (g) => { const i = go.indexOf(g); return i < 0 ? 99 : i; };
    if (st.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (st.sort === 'group') rows.sort((a, b) => gi(a.grp) - gi(b.grp) || b.n - a.n || a.name.localeCompare(b.name));
    else rows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return { key, tk: key + (raw ? '#raw' : ''), raw, base, rows, steps, usedBy, names: new Map(rows.map((r) => [r.item, r.name])) };
  }
  // gathered state
  const tmap = (tk) => (S().ticks[tk] || {});
  const hmap = (tk) => ((S().have || {})[tk] || {});
  function haveOf(r) { const t = tmap(M.d.tk)[r.item], hv = hmap(M.d.tk)[r.item]; return t ? r.n : Math.min(r.n, hv || 0); }
  const isDone = (r) => !!tmap(M.d.tk)[r.item] || (hmap(M.d.tk)[r.item] || 0) >= r.n;
  function setHave(r, v, tick) {
    const tk = M.d.tk;
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
    M = { d: null, open: new Set(), rowEls: new Map(), packAll: false, rawAll: false };
    // head: source + totals
    M.srcBtn = h('button.btn.bd-ckey.bd-msrc', { type: 'button', 'aria-expanded': 'false', onclick: () => togglePick() });
    M.keys = h('div.bd-mh-keys');
    M.pick = h('div.bd-mpick', { hidden: true });
    M.add = h('div.bd-madd', { hidden: true });
    M.stats = h('div.bd-mstats');
    M.prog = h('div.bd-prog', { role: 'img' }, h('span'));
    M.progTxt = h('span.bd-mprog-txt');
    M.head = h('section.panel.bd-pan.bd-mhead.has-sel', { 'aria-label': 'Material list source' },
      h('div.bd-mh-top', M.srcBtn, M.keys), M.pick, M.add, M.stats, h('div.bd-mat-progress', M.prog, M.progTxt));
    // list
    M.listTitle = h('h3');
    M.listCount = h('span.bd-count');
    M.q = h('input.field.bd-mq', { type: 'search', placeholder: 'Filter the list', 'aria-label': 'Filter the list', autocomplete: 'off', spellcheck: false, oninput: () => applyFilter() });
    M.hideCb = h('input', { type: 'checkbox', checked: !!MS().hide, onchange: () => { save((b) => { b.mats.hide = M.hideCb.checked; }); applyFilter(); } });
    M.rawCb = h('input', { type: 'checkbox', checked: !!MS().raw, onchange: () => { save((b) => { b.mats.raw = M.rawCb.checked; }); M.open.clear(); refresh(); } });
    const hideSw = h('label.bd-msw', h('span.switch', M.hideCb, h('span')), h('span', 'Hide gathered'));
    const rawSw = tip(h('label.bd-msw', h('span.switch', M.rawCb, h('span')), h('span', 'Raw materials')), 'Show what you gather instead: the whole list broken down to raw materials, using the best recipes');
    M.sortSeg = seg('Sort materials', [['count', 'Most'], ['name', 'A–Z'], ['group', 'Group']], () => S().sort, (v) => { save((b) => { b.sort = v; }); refresh(); },
      { count: 'Most first', name: 'A to Z', group: 'By group: stone, wood, colours…' });
    M.unitSeg = seg('Amounts as', [['items', 'Items'], ['stacks', 'Stacks'], ['boxes', 'Shulkers'], ['dc', 'Chests']], () => S().units, (v) => { save((b) => { b.units = v; }); syncUnits(); },
      { items: 'Single items', stacks: 'Stacks (64, 16 or 1 per slot)', boxes: 'Shulker boxes (27 slots)', dc: 'Double chests (54 slots)' });
    M.rows = h('div.bd-mrows', { role: 'list' });
    M.empty = h('p.bd-note.bd-mempty', { hidden: true });
    M.acts = h('div.bd-actions.bd-macts');
    M.list = h('section.panel.bd-pan.bd-mlist', { 'aria-label': 'Material list' },
      h('div.bd-pan-head', M.listTitle, M.listCount),
      h('div.bd-mtools', h('div.bd-mtools-a', M.q, hideSw, rawSw), h('div.bd-mtools-b', M.sortSeg, M.unitSeg)),
      M.rows, M.empty, M.acts);
    // side
    M.packPanel = h('section.panel.bd-pan.bd-mpack', { 'aria-label': 'Packing' });
    M.rawPanel = h('section.panel.bd-pan.bd-mraw', { 'aria-label': 'Raw materials' });
    M.fileIn = h('input', { type: 'file', hidden: true, accept: '.txt,.csv,.tsv,.md,.schem,.schematic,.litematic,.nbt,.json', onchange: () => { const f = M.fileIn.files[0]; M.fileIn.value = ''; if (f) importFile(f, M.fileFor); M.fileFor = null; } });
    M.root = h('div.bd-mx', M.head, h('div.bd-mgrid', M.list, h('div.bd-mside', M.packPanel, M.rawPanel)), M.fileIn);
    // drop a file anywhere on the section
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

  /** Recompute everything for the current source and patch the section (scroll position kept). */
  function refresh() {
    const y = window.scrollY;
    M.d = compute();
    syncHead();
    buildList();
    buildPack();
    buildRaw();
    syncProgress();
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }

  /* ---- head ---- */
  function syncHead() {
    const d = M.d, info = srcInfo(d.key), st = S();
    const total = d.base.reduce((a, r) => a + r.n, 0);
    const ico = info.icon ? h('span.bd-thumb', { 'aria-hidden': 'true' }, TH.icon(info.icon, { size: 32 })) : h('span.bd-thumb.bd-thumb-file', { 'aria-hidden': 'true' }, gl(info.kind === 'list' ? 'list' : 'file'));
    M.srcBtn.replaceChildren(ico,
      h('span.bd-ckey-txt', h('span.bd-msrc-eye', 'Material list for'), h('span.bd-ckey-name', info.name), h('span.bd-ckey-sub', [KIND[info.kind] || 'Build', d.base.length + (d.base.length === 1 ? ' kind' : ' kinds'), fmt(total) + ' items'].join(' · '))),
      h('span.bd-msrc-chg', gl('chev', 'bd-msrc-chev'), h('span', 'Change')));
    M.srcBtn.setAttribute('aria-label', 'Material list for ' + info.name + '. Change the source');
    const k = [];
    k.push(tip(h('button.btn.small', { type: 'button', onclick: () => openAdd(null) }, A.glyph('plus'), 'Add a list'), 'Paste a list (Litematica material list, CSV or lines like "Stone Bricks 64") or open a .txt, .csv or schematic file'));
    if (info.kind === 'list') k.push(h('button.btn.small', { type: 'button', onclick: () => openAdd(listRec(d.key)) }, gl('pen'), 'Edit list'));
    else k.push(tip(h('button.btn.small', { type: 'button', onclick: () => A.view3d(d.key) }, gl('cube'), 'View in 3D'), 'Open this build on the 3D stage'));
    M.keys.replaceChildren(...k);
    // totals
    const slots = d.rows.reduce((a, r) => a + Math.ceil(r.n / r.stack), 0), items = d.rows.reduce((a, r) => a + r.n, 0);
    const stat = (v, l, t) => tip(h('div.bd-mstat', h('b', v), h('span', l)), t);
    M.stats.replaceChildren(
      stat(fmt(items), d.raw ? 'raw items' : 'items', 'Every item you need, counted one by one'),
      stat(fmt(d.rows.length), 'kinds', 'Different items in the list'),
      stat(fmt(slots), 'stacks', 'Inventory slots: one stack per slot (64, 16 or 1 per stack)'),
      stat(dec(slots / 27), 'shulker boxes', Math.ceil(slots / 27) + ' boxes of 27 slots'),
      stat(dec(slots / 54), 'double chests', Math.ceil(slots / 54) + ' double chests of 54 slots'));
    if (!st.matSrc || st.matSrc === 'paste') save((b) => { b.matSrc = 'stage'; });
  }

  /* ---- source picker (folds open under the head, no dropdown) ---- */
  function togglePick(force) {
    const open = force != null ? force : M.pick.hidden;
    if (open) { M.add.hidden = true; fillPick(); }
    M.pick.hidden = !open;
    M.srcBtn.setAttribute('aria-expanded', String(open));
    if (open) { const f = M.pick.querySelector('.bd-mpick-q'); if (f && matchMedia('(hover: hover)').matches) f.focus({ preventScroll: true }); }
  }
  function choose(key) {
    save((b) => { b.matSrc = key; });
    M.open.clear(); M.packAll = false;
    togglePick(false);
    refresh();
  }
  function fillPick() {
    const cur = srcKey(), all = A.sources();
    const q = h('input.field.bd-mpick-q', { type: 'search', placeholder: 'Search builds and lists', 'aria-label': 'Search sources', autocomplete: 'off', spellcheck: false });
    const opt = (key, name, icon, kind) => {
      const on = key === cur;
      const b = h('button.btn.bd-mopt' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), 'data-name': name.toLowerCase(), onclick: () => choose(key) },
        h('span.bd-mopt-ico', icon ? TH.icon(icon, { size: 24 }) : gl(kind === 'list' ? 'list' : 'file')), h('span.bd-mopt-name', name));
      return b;
    };
    const groups = [];
    const L = lists();
    if (L.length) {
      groups.push(['Your lists', L.map((l) => {
        const key = 'list:' + l.id;
        const nameBtn = opt(key, l.name, null, 'list');
        const ren = tip(h('button.bd-x', { type: 'button', 'aria-label': 'Rename ' + l.name, onclick: () => renameList(l, wrap) }, gl('pen')), 'Rename');
        const del = tip(h('button.bd-x', { type: 'button', 'aria-label': 'Delete ' + l.name, onclick: () => deleteList(l) }, A.glyph('x')), 'Delete this list');
        const wrap = h('div.bd-mopt-row', { 'data-name': l.name.toLowerCase() }, nameBtn, ren, del);
        return wrap;
      })]);
    }
    const yours = all.filter((s) => s.kind === 'yours' || s.kind === 'shape');
    if (yours.length) groups.push(['Your builds', yours.map((s) => opt(s.key, s.name, s.icon, s.kind))]);
    [['farm', 'Farms'], ['machine', 'Machines'], ['build', 'Structures']].forEach(([k, t]) => {
      const g = all.filter((s) => s.kind === k);
      if (g.length) groups.push([t, g.map((s) => opt(s.key, s.name, s.icon, s.kind))]);
    });
    const body = h('div.bd-mpick-body.th-scroll', groups.map(([t, els]) => h('div.bd-mpick-grp', h('div.bd-mpick-lbl', t), h('div.bd-mpick-opts', els))));
    const none = h('p.bd-note', { hidden: true }, 'Nothing matches.');
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase();
      let any = false;
      body.querySelectorAll('.bd-mpick-grp').forEach((g) => {
        let vis = 0;
        g.querySelectorAll('.bd-mpick-opts > *').forEach((o) => { const ok = !t || (o.dataset.name || '').includes(t); o.hidden = !ok; if (ok) vis++; });
        g.hidden = !vis; if (vis) any = true;
      });
      none.hidden = any;
    });
    M.pick.replaceChildren(h('div.bd-mpick-top', q, h('button.btn.small', { type: 'button', onclick: () => togglePick(false) }, 'Done')), body, none);
    M.pick.onkeydown = (e) => { if (e.key === 'Escape') { togglePick(false); M.srcBtn.focus(); } };
  }
  function renameList(l, wrap) {
    const f = h('input.field.bd-mren', { type: 'text', value: l.name, maxlength: LIST_NAME_CAP, 'aria-label': 'List name' });
    const done = (ok) => {
      const v = f.value.trim();
      if (ok && v && v !== l.name) save((b) => { const x = (b.lists || []).find((y) => y.id === l.id); if (x) x.name = v; });
      fillPick(); syncHead();
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
      fillPick(); refresh(); togglePick(true);
    }, 'Delete');
  }

  /* ---- add / edit a list ---- */
  function openAdd(rec) {
    togglePick(false);
    const name = h('input.field.bd-madd-name', { type: 'text', maxlength: LIST_NAME_CAP, placeholder: 'Name, e.g. Castle walls', 'aria-label': 'List name', value: rec ? rec.name : '' });
    const ta = h('textarea.field.bd-paste', { rows: 8, spellcheck: false, 'aria-label': 'Material list text', placeholder: 'Paste the Litematica material list (the table or the CSV), or lines like:\nStone Bricks 64\n64x Oak Planks\nGlass: 3 stacks' });
    ta.value = rec ? rec.text : '';
    const status = h('p.bd-madd-status', { 'aria-live': 'polite' });
    const saveBtn = h('button.btn.small.primary', { type: 'button', onclick: () => commit() }, rec ? 'Save changes' : 'Save list');
    const fileBtn = tip(h('button.btn.small', { type: 'button', onclick: () => { M.fileFor = 'form'; M.fileIn.click(); } }, A.glyph('up'), 'Choose a file'), '.txt / .csv become a list here; a .litematic, .schem, .nbt or .schematic opens as a build with its 3D view and this list');
    const cancel = h('button.btn.small.ghost', { type: 'button', onclick: () => { M.add.hidden = true; } }, 'Cancel');
    function check() {
      const p = listRows(ta.value), unk = p.rows.filter((r) => String(r.item).startsWith('text:')).length;
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
    M.add.replaceChildren(h('div.bd-madd-head', h('span.bd-msrc-eye', rec ? 'Edit list' : 'Add a list'), h('span.bd-note', 'Litematica: Material List → copy the table or “Write to file”')), name, ta, status, h('div.bd-actions', saveBtn, fileBtn, cancel));
    M.add.form = { name, ta, check };
    M.add.hidden = false;
    M.add.onkeydown = (e) => { if (e.key === 'Escape') { M.add.hidden = true; M.srcBtn.focus(); } };
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
  /** A file from the Materials section (picker or drop): text lists become saved lists, schematics open as builds. */
  function importFile(f, into) {
    if (!isText(f) && /\.(schem|schematic|litematic|nbt|json)$/i.test(f.name || '')) { M.add.hidden = true; A.openFile(f, { mats: true }); return; }
    if (f.size > 4e6) { TH.util.toast('That file is too big for a material list.'); return; }
    f.text().then((text) => {
      const p = listRows(text);
      if (into === 'form' && M && M.add.form && !M.add.hidden) {
        M.add.form.ta.value = text;
        if (!M.add.form.name.value.trim()) M.add.form.name.value = (p.title && !/^unnamed$/i.test(p.title) ? p.title : String(f.name).replace(/\.[a-z]+$/i, '')).slice(0, LIST_NAME_CAP);
        M.add.form.check();
        return;
      }
      if (!p.rows.length) { TH.util.toast('No materials found in ' + f.name); return; }
      const id = TH.util.uid('l'), nm = (p.title && !/^unnamed$/i.test(p.title) ? p.title : String(f.name).replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ')).slice(0, LIST_NAME_CAP);
      saveList(id, nm, text, p);
      if (M && M.root.isConnected) { M.add.hidden = true; choose('list:' + id); }
      else { save((b) => { b.matSrc = 'list:' + id; b.section = 'materials'; }); A.refresh(); }
      TH.util.toast('Saved ' + nm + ' · ' + p.rows.length + ' materials');
    }, () => TH.util.toast('Could not read ' + f.name));
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
      if (st.sort === 'group' && r.grp !== g) { g = r.grp; out.push(h('div.bd-mgrp', { 'data-grp': g }, core().GROUPS[g] || 'Other')); }
      out.push(rowEl(r));
    });
    M.rows.replaceChildren(...out);
    M.empty.textContent = d.key.startsWith('list:') ? 'This list has no materials. Edit it to paste the text again.' : 'Nothing to gather here yet.';
    // actions
    const local = !!window.TH_LOCAL_ASSETS;
    M.acts.replaceChildren(
      tip(h('button.btn.small', { type: 'button', onclick: () => copy(listText(), 'Material list copied') }, A.glyph('copy'), 'Copy as text'), 'Grouped, with the amounts in the units you picked; paste it anywhere (or back in here)'),
      local ? null : h('button.btn.small', { type: 'button', onclick: () => A.download(fileName('txt'), listText(), 'text/plain') }, A.glyph('down'), '.txt'),
      local ? null : tip(h('button.btn.small', { type: 'button', onclick: () => A.download(fileName('csv'), listCSV(), 'text/csv') }, A.glyph('down'), 'CSV'), 'For a spreadsheet'),
      h('button.btn.small.ghost.bd-mclear', { type: 'button', onclick: () => { save((b) => { delete b.ticks[d.tk]; if (b.have) delete b.have[d.tk]; }); refresh(); } }, 'Clear ticks'));
    applyFilter();
  }
  function rowEl(r) {
    const a = amount(r.n, r.stack, S().units), done = isDone(r), hv = haveOf(r);
    const cb = h('input', { type: 'checkbox', checked: done, 'aria-label': 'Gathered ' + r.name, onchange: () => { setHave(r, cb.checked ? r.n : 0, cb.checked); patchRow(r); } });
    const have = haveField(r, hv);
    const nameBtn = h('button.bd-mrow-name', { type: 'button', 'aria-expanded': String(M.open.has(r.item)), onclick: () => toggleRow(r) },
      h('span.bd-mrow-label', r.name), r.nrec ? h('span.bd-mrow-tag', r.nrec > 1 ? r.nrec + ' recipes' : 'recipe') : null, gl('chev', 'bd-mrow-chev'));
    const amt = h('span.bd-mat-amt', h('b', a.main), h('small', subText(r, a, hv)));
    const det = h('div.bd-mdet', { hidden: !M.open.has(r.item) });
    const el = h('div.bd-mrow' + (done ? '.done' : ''), { role: 'listitem', 'data-item': r.item },
      h('label.check.bd-mrow-chk', cb, h('span')), h('span.bd-mrow-ico', iconFor(r.item, 24)), nameBtn, have, amt, det);
    el._r = r; el._cb = cb; el._amt = amt; el._have = have; el._det = det; el._btn = nameBtn;
    M.rowEls.set(r.item, el);
    if (M.open.has(r.item)) fillDet(el);
    return el;
  }
  function subText(r, a, hv) {
    if (hv > 0 && hv < r.n) return 'still ' + fmt(r.n - hv) + (a.sub ? ' · ' + a.sub.replace(/ · [\d ]+ items$/, '') : '');
    return a.sub;
  }
  /** A number field that never loses focus while typing (the row is patched around it). */
  function haveField(r, hv) {
    const f = h('input.field.bd-have', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'have', 'aria-label': 'You have ' + r.name, value: hv ? String(hv) : '' });
    tip(f, 'How many you have already (ticks itself when it reaches ' + fmt(r.n) + ')');
    f.addEventListener('input', () => {
      const v = parseInt(f.value.replace(/\D/g, ''), 10) || 0;
      setHave(r, v, false);
      patchRow(r, f);
    });
    f.addEventListener('change', () => { const v = haveOf(r); f.value = v ? String(v) : ''; });
    return f;
  }
  /** Update one row (and everything that counts it) without rebuilding it. `keep` = the field being typed in. */
  function patchRow(r, keep) {
    const el = M.rowEls.get(r.item);
    if (!el) return;
    const done = isDone(r), hv = haveOf(r), a = amount(r.n, r.stack, S().units);
    el.classList.toggle('done', done);
    el._cb.checked = done;
    el.querySelectorAll('.bd-have').forEach((f) => { if (f !== keep) f.value = hv ? String(hv) : ''; });
    el._amt.lastChild.textContent = subText(r, a, hv);
    syncProgress();
    dimPack();
    if (S().mats.hide && done && document.activeElement !== keep) applyFilter();
  }
  function syncUnits() {
    const u = S().units;
    M.rowEls.forEach((el) => { const r = el._r, a = amount(r.n, r.stack, u); el._amt.firstChild.textContent = a.main; el._amt.lastChild.textContent = subText(r, a, haveOf(r)); });
    buildRaw();
  }
  function applyFilter() {
    const t = (M.q.value || '').trim().toLowerCase(), hide = !!MS().hide;
    let vis = 0;
    M.rowEls.forEach((el) => { const ok = (!t || el._r.name.toLowerCase().includes(t)) && !(hide && el.classList.contains('done')); el.hidden = !ok; if (ok) vis++; });
    M.rows.querySelectorAll('.bd-mgrp').forEach((g) => {
      let n = g.nextElementSibling, any = false;
      while (n && !n.classList.contains('bd-mgrp')) { if (!n.hidden) { any = true; break; } n = n.nextElementSibling; }
      g.hidden = !any;
    });
    M.empty.hidden = !!vis || (!!M.d.rows.length && !(t || hide));
    if (M.d.rows.length && !vis) M.empty.textContent = hide && !t ? 'Everything is gathered.' : 'Nothing matches the filter.';
  }
  function syncProgress() {
    const d = M.d;
    let doneN = 0, items = 0, got = 0;
    d.rows.forEach((r) => { items += r.n; got += haveOf(r); if (isDone(r)) doneN++; });
    const pct = items ? got / items : 0;
    M.prog.firstChild.style.width = (pct * 100).toFixed(1) + '%';
    M.prog.setAttribute('aria-label', Math.round(pct * 100) + '% of the items gathered');
    M.progTxt.textContent = doneN + ' of ' + d.rows.length + ' gathered' + (items ? ' · ' + Math.round(pct * 100) + '% of the items' : '');
    const clr = M.acts.querySelector('.bd-mclear');
    if (clr) clr.disabled = !(Object.keys(tmap(d.tk)).length || Object.keys(hmap(d.tk)).length);
  }

  /* ---- a row opened: recipes, raw materials, what it is used for ---- */
  function toggleRow(r) {
    const el = M.rowEls.get(r.item);
    if (!el) return;
    const open = !M.open.has(r.item);
    if (open) M.open.add(r.item); else M.open.delete(r.item);
    el._btn.setAttribute('aria-expanded', String(open));
    el._det.hidden = !open;
    if (open) fillDet(el);
  }
  const chip = (id, n, label) => { const nm = label || RC().nameOf(id); return h('span.bd-rq', { title: null }, h('span.bd-rq-ico', iconFor(id, 20)), h('span.bd-rq-n', fmt(n) + '×'), h('span.bd-rq-name', nm)); };
  function formula(rcp, id, k) {
    k = k || 1;
    const ins = [];
    rcp.in.forEach(([i, c], j) => { if (j) ins.push(h('span.bd-rq-plus', '+')); ins.push(chip(String(i).startsWith('tag:') ? i : 'minecraft:' + RC().bare(i), c * k)); });
    return h('span.bd-rf', ins, h('span.bd-rq-to', { 'aria-label': 'makes' }, gl('arrow')), chip(id, rcp.out * k));
  }
  function fillDet(el) {
    const r = el._r, R = RC(), d = M.d;
    const parts = [];
    if (String(r.item).startsWith('text:')) parts.push(h('p.bd-note', 'A name the tool does not know, so it stays as text: no texture or recipe.'));
    else {
      const list = R.recipesFor(r.item);
      if (list.length) {
        const cheap = R.cheapest(r.item, ropts()), used = R.bestIndex(r.item, ropts()), pick = (MS().pick || {})[r.item];
        parts.push(h('div.bd-msub', list.length > 1 ? 'Ways to make it' : 'How to make it'));
        parts.push(h('div.bd-rcps', list.map((rc, i) => {
          const off = MS().sc === false && rc.method === 'stonecutting' && list.some((x) => x.method !== 'stonecutting');
          const tags = [];
          if (i === cheap) tags.push(h('span.bd-rtag.best', 'Best'));
          if (i === used && list.length > 1) tags.push(h('span.bd-rtag', 'In use'));
          const use = i !== used && list.length > 1 && !off ? h('button.bd-link.bd-ruse', { type: 'button', onclick: () => pickRecipe(r.item, i === cheap ? null : i) }, 'Use this') : null;
          return h('div.bd-rcp' + (i === used ? '.used' : '') + (off ? '.off' : ''),
            h('span.bd-rcp-m', R.METHOD[rc.method]), formula(rc, r.item), h('span.bd-rcp-tags', tags, use),
            rc.note ? h('span.bd-rcp-note', rc.note) : null);
        })));
        if (pick != null) parts.push(h('button.bd-link', { type: 'button', onclick: () => pickRecipe(r.item, null) }, 'Back to the best recipe'));
        const rw = R.raw([{ item: r.item, n: r.n }], ropts());
        parts.push(h('div.bd-msub', 'Raw for ' + fmt(r.n)));
        parts.push(h('div.bd-rraw', rw.rows.map((x) => chip(x.item, x.n))));
      } else if (!d.raw) parts.push(h('p.bd-note', 'No recipe: you mine, farm or find it as it is.'));
      if (d.raw && d.usedBy && d.usedBy.get(r.item)) {
        parts.push(h('div.bd-msub', 'Goes into'));
        parts.push(h('div.bd-rraw', d.usedBy.get(r.item).map(([it, n, label]) => chip(it, n, label || R.nameOf(it)))));
      }
    }
    const hv = haveOf(r);
    const f2 = haveField(r, hv);
    f2.classList.add('bd-have-det');
    parts.push(h('label.bd-mdet-have', h('span', 'You have'), f2, h('span.bd-note', 'of ' + fmt(r.n))));
    el._det.replaceChildren(...parts);
  }
  function pickRecipe(item, i) {
    save((b) => { b.mats.pick = b.mats.pick || {}; if (i == null) delete b.mats.pick[item]; else b.mats.pick[item] = i; });
    refresh();
  }

  /* ---- packing ---- */
  function packRows() {
    const d = M.d;
    if (MS().pack !== 'sorted') return d.rows;
    const go = GROUP_ORDER(), gi = (g) => { const i = go.indexOf(g); return i < 0 ? 99 : i; };
    return d.rows.map((r, i) => [r, i]).sort((a, b) => gi(a[0].grp) - gi(b[0].grp) || a[1] - b[1]).map((x) => x[0]);
  }
  const CONT = { box: ['Shulker box', 'Shulker boxes'], dc: ['Double chest', 'Double chests'] };
  function buildPack() {
    const ms = MS(), cont = ms.cont === 'dc' ? 'dc' : 'box', size = SLOTS[cont];
    const bins = pack(packRows(), { size, mode: ms.pack === 'sorted' ? 'sorted' : 'tight' });
    M.bins = bins;
    const slots = bins.reduce((a, b) => a + b.slots.length, 0), free = bins.length * size - slots;
    const contSeg = seg('Container', [['box', 'Shulker boxes'], ['dc', 'Double chests']], () => (MS().cont === 'dc' ? 'dc' : 'box'), (v) => { save((b) => { b.mats.cont = v; }); M.packAll = false; buildPack(); });
    const modeSeg = seg('Packing', [['tight', 'Tight'], ['sorted', 'Sorted']], () => (MS().pack === 'sorted' ? 'sorted' : 'tight'), (v) => { save((b) => { b.mats.pack = v; }); buildPack(); },
      { tight: 'Fewest containers: big items first, each kept in one container where it fits', sorted: 'Related blocks together: by group, in list order, container by container' });
    const grid = h('div.bd-cboxes');
    const FIRST = 6;
    const showN = M.packAll ? bins.length : Math.min(bins.length, FIRST);
    const more = bins.length > showN ? h('button.btn.small.bd-cmore', { type: 'button', onclick: () => { M.packAll = true; more.remove(); chunked(grid, bins, showN); } }, 'Show all ' + bins.length + ' ' + CONT[cont][1].toLowerCase()) : null;
    for (let i = 0; i < showN && i < FIRST; i++) grid.append(boxEl(bins[i], i, size, cont));
    if (showN > FIRST) chunked(grid, bins, FIRST, showN);
    M.packPanel.replaceChildren(...[
      h('div.bd-pan-head', h('h3', 'Packing'), h('span.bd-count', bins.length + ' ' + (bins.length === 1 ? CONT[cont][0] : CONT[cont][1]).toLowerCase())),
      h('div.bd-mtools-b', contSeg, modeSeg),
      h('p.bd-note.bd-psum', bins.length ? fmt(slots) + ' slots in ' + bins.length + ' ' + (bins.length === 1 ? CONT[cont][0] : CONT[cont][1]).toLowerCase() + (free ? ' · ' + free + ' slots free' : ' · completely full') : 'Nothing to pack.'),
      grid, more,
      bins.length ? h('div.bd-actions', tip(h('button.btn.small', { type: 'button', onclick: () => copy(packText(), 'Packing copied') }, A.glyph('copy'), 'Copy packing as text'), 'Every container with what goes in it')) : null].filter(Boolean));
    dimPack();
  }
  /** Build the remaining container cards a few per frame, so 50 double chests never block the page. */
  function chunked(grid, bins, from, to) {
    to = to == null ? bins.length : to;
    const size = SLOTS[MS().cont === 'dc' ? 'dc' : 'box'], cont = MS().cont === 'dc' ? 'dc' : 'box';
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
    const by = new Map();
    b.slots.forEach((s) => by.set(s.item, (by.get(s.item) || 0) + s.n));
    const main = [...by].sort((x, y) => y[1] - x[1]);
    const names = main.slice(0, 2).map(([it]) => M.d.names.get(it) || RC().nameOf(it));
    const cells = [];
    for (let k = 0; k < size; k++) {
      const s = b.slots[k];
      if (!s) { cells.push(h('span.bd-slot.is-empty')); continue; }
      const nm = M.d.names.get(s.item) || RC().nameOf(s.item);
      cells.push(tip(h('span.bd-slot', { 'data-item': s.item }, iconFor(s.item, 24), s.n > 1 ? h('b', String(s.n)) : null), nm + ' × ' + s.n));
    }
    return h('div.bd-cbox', { role: 'group', 'aria-label': CONT[cont][0] + ' ' + (i + 1) },
      h('div.bd-cbox-head', h('span.bd-cbox-name', CONT[cont][0] + ' ' + (i + 1)), h('span.bd-cbox-fill', b.slots.length + '/' + size)),
      h('div.bd-cbox-sub', names.join(', ') + (main.length > 2 ? ' + ' + (main.length - 2) + ' more' : '')),
      h('div.bd-cgrid' + (size === 54 ? '.c54' : ''), cells));
  }
  function dimPack() {
    if (!M || !M.packPanel) return;
    const done = new Set(M.d.rows.filter(isDone).map((r) => r.item));
    M.packPanel.querySelectorAll('.bd-slot[data-item]').forEach((s) => s.classList.toggle('done', done.has(s.dataset.item)));
  }

  /* ---- raw materials (side) / crafting steps in raw mode ---- */
  function buildRaw() {
    const d = M.d, R = RC(), u = S().units;
    const scCb = h('input', { type: 'checkbox', checked: MS().sc !== false, onchange: () => { save((b) => { b.mats.sc = scCb.checked; }); refresh(); } });
    const scSw = tip(h('label.bd-msw', h('span.switch', scCb, h('span')), h('span', 'Prefer the stonecutter')), 'Cut stairs, slabs, walls and polished or brick blocks in a stonecutter: one block each, no leftovers. Off: the crafting table');
    if (!d.raw) {
      const r = R.raw(d.base, ropts()), rows = r.rows.map((x) => Object.assign(x, { stack: stackOf(x.item), name: R.nameOf(x.item) }));
      const N = 12, shown = M.rawAll ? rows : rows.slice(0, N);
      const line = (x) => { const a = amount(x.n, x.stack, u); return h('div.bd-rawrow', h('span.bd-rawrow-ico', iconFor(x.item, 20)), h('span.bd-rawrow-name', x.name), h('span.bd-rawrow-n', a.main)); };
      M.rawPanel.replaceChildren(...[
        h('div.bd-pan-head', h('h3', 'Raw materials'), h('span.bd-count', rows.length + (rows.length === 1 ? ' kind' : ' kinds'))),
        h('p.bd-note', r.steps.length ? 'Everything broken down to what you mine, farm or find, using the best recipe for each block.' : 'Nothing here needs crafting: every block is gathered as it is.'),
        scSw,
        h('div.bd-rawlist', shown.map(line)),
        rows.length > shown.length ? h('button.bd-more', { type: 'button', onclick: () => { M.rawAll = true; buildRaw(); } }, h('span', 'Show all ' + rows.length)) : null,
        r.steps.length ? h('div.bd-actions', h('button.btn.small', { type: 'button', onclick: () => { M.rawCb.checked = true; save((b) => { b.mats.raw = true; }); M.open.clear(); refresh(); } }, 'Use as the list')) : null].filter(Boolean));
      return;
    }
    const step = (s) => h('div.bd-step',
      h('span.bd-rcp-m', R.METHOD[s.method]),
      formula(s.recipe, s.item, s.crafts),
      s.made > s.need ? h('span.bd-step-spare', '+' + fmt(s.made - s.need) + ' spare') : null);
    M.rawPanel.replaceChildren(
      h('div.bd-pan-head', h('h3', 'Crafting steps'), h('span.bd-count', d.steps.length + (d.steps.length === 1 ? ' step' : ' steps'))),
      h('p.bd-note', d.steps.length ? 'From the raw materials to the build list, in the order you do them.' : 'Nothing to craft: the list is raw already.'),
      scSw,
      h('div.bd-steps2', d.steps.map(step)),
      h('div.bd-actions', h('button.btn.small', { type: 'button', onclick: () => { M.rawCb.checked = false; save((b) => { b.mats.raw = false; }); M.open.clear(); refresh(); } }, 'Back to the build list')));
  }

  /* ---- text out ---- */
  function copy(text, msg) {
    const ok = () => TH.util.toast(msg);
    const fb = () => { const ta = h('textarea', { style: { position: 'fixed', opacity: 0, left: '-9999px' } }); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { TH.util.toast('Could not copy'); } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
  }
  const fileName = (ext) => String(srcInfo(M.d.key).name || 'materials').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (M.d.raw ? '-raw' : '') + '-materials.' + ext;
  function listText() {
    const d = M.d, u = S().units, info = srcInfo(d.key);
    const slots = d.rows.reduce((a, r) => a + Math.ceil(r.n / r.stack), 0), items = d.rows.reduce((a, r) => a + r.n, 0);
    const out = [info.name + ' — ' + (d.raw ? 'raw materials' : 'materials') + ' (' + d.rows.length + ' kinds · ' + fmt(items) + ' items · ' + fmt(slots) + ' stacks · ' + dec(slots / 27) + ' shulker boxes)', ''];
    const go = GROUP_ORDER(), byG = new Map();
    d.rows.forEach((r) => { if (!byG.has(r.grp)) byG.set(r.grp, []); byG.get(r.grp).push(r); });
    [...byG.keys()].sort((a, b) => (go.indexOf(a) < 0 ? 99 : go.indexOf(a)) - (go.indexOf(b) < 0 ? 99 : go.indexOf(b))).forEach((g) => {
      out.push((core().GROUPS[g] || 'Other').toUpperCase());
      byG.get(g).forEach((r) => {
        const a = amount(r.n, r.stack, u === 'items' ? 'stacks' : u), hv = haveOf(r);
        out.push((isDone(r) ? '[x] ' : '[ ] ') + r.name + ': ' + fmt(r.n) + (r.stack > 1 && r.n >= r.stack ? ' (' + a.main + ')' : '') + (hv && !isDone(r) ? ' · have ' + fmt(hv) : ''));
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
    const name = (it) => M.d.names.get(it) || RC().nameOf(it);
    return M.bins.map((b, i) => {
      const by = new Map();
      b.slots.forEach((s) => { const e = by.get(s.item) || { n: 0, st: 0, stack: s.stack }; e.n += s.n; e.st++; by.set(s.item, e); });
      return CONT[cont][0] + ' ' + (i + 1) + ' (' + b.slots.length + '/' + size + '): ' + [...by].map(([it, e]) => name(it) + ' ×' + fmt(e.n) + (e.st > 1 ? ' (' + e.st + ' slots)' : '')).join(', ');
    }).join('\n') + '\n';
  }

  function init(api) { A = api; }
  return { parse, resolve, stackOf, amount, pack, init, render, importFile, isText, listRows };
})();
