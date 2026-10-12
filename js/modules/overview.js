/**
 * Overview — the landing page (route "#/" or no hash). A hidden module: reachable via the logo, not a nav tab.
 * The screen is split into one tall pane per tool (Enchanting first). The pane under the pointer swells open and shows the
 * detailed view: an animated particle scene, the tool's icon, what it does and a little live mock-up of it. Keys 1-5 jump to a tool.
 * Live stats come from each module's badge(state).
 */
(function () {
  const { h } = TH.util;

  const TOOLS = [
    { id: 'enchanting', icon: (n) => TH.icon('enchanted_book', { size: n, glint: true }), kicker: 'Gear & books', fx: 'glyphs',
      pitch: 'Plan every enchanted item. See exactly which books you still need and tick the anvil steps off one by one.',
      points: ['Cheapest anvil order', 'Books to get, per item', 'Plans sorted the smart way', 'Level and XP costs'], unit: 'items done' },
    { id: 'hall', icon: (n) => TH.icon('emerald', { size: n }), kicker: 'Villager trading', fx: 'emeralds',
      pitch: 'Lay out your trading hall, price the emeralds and lock in every librarian.',
      points: ['Hall planner canvas', 'Book lists per librarian', 'Offer checker', 'Emerald totals'], unit: 'librarians' },
    { id: 'trims', icon: (n) => TH.icon.trim('sentry', { size: n }), kicker: 'Armor trims', fx: 'sparkle',
      pitch: 'Dress a 3D character in any armor and trim, piece by piece, then get the shopping list.',
      points: ['Live 3D preview', 'Every pattern and material', 'Per-piece armor', 'Skins and saved outfits'], unit: 'templates' },
    { id: 'builds', icon: (n) => TH.icon('block/crafting_table_front', { size: n }), kicker: 'Build planning', fx: 'blocks', soon: true,
      pitch: 'Blocks, stacks and shulker boxes for any build, worked out for you.',
      points: ['Material lists', 'Stacks and shulker boxes', 'Example builds'], unit: '' },
    { id: 'portal', icon: (n) => TH.icon('block/crying_obsidian', { size: n }), kicker: 'Nether travel', fx: 'vortex',
      pitch: 'Convert coordinates between the Overworld and the Nether and line your portals up.',
      points: ['Overworld and Nether', 'Linked portal finder', 'Seed preview links'], unit: '' },
  ];

  function stat(mod, state, unit) {
    let b = null;
    try { b = mod && mod.badge && mod.badge(state); } catch (e) { /* stats are a bonus */ }
    if (b && typeof b === 'string') { const m = b.match(/^(\d+)\s*\/\s*(\d+)$/); b = m ? { done: +m[1], total: +m[2] } : null; }
    if (!b || typeof b !== 'object' || !b.total) return null;
    return h('div.lp-stat',
      h('div.lp-bar', h('span', { style: { width: Math.min(100, (b.done / b.total) * 100) + '%' } })),
      h('span.lp-stat-n', h('b', b.done), '/' + b.total + (unit ? ' ' + unit : '')));
  }

  /** a tiny decorative mock-up of the tool, drawn from real icons */
  function mock(id) {
    if (id === 'enchanting') {
      return h('div.lp-mock.lp-mc', h('b', 'Diamond Sword'), h('span', 'Mending'), h('span', 'Unbreaking III'), h('span', 'Sharpness V'), h('span', 'Looting III'),
        h('div.lp-mc-cost', TH.icon('xp', { size: 14 }), '6 steps · 44 lvl'));
    }
    if (id === 'hall') {
      const row = (ico, text, price) => h('div.lp-trade', TH.icon(ico, { size: 22 }), h('span', text), h('b', price, TH.util.emerald()));
      return h('div.lp-mock.lp-trades', row('enchanted_book', 'Mending', '14'), row('enchanted_book', 'Unbreaking III', '9'), row('enchanted_book', 'Efficiency V', '17'));
    }
    if (id === 'trims') {
      return h('div.lp-mock.lp-tiles', ['sentry', 'dune', 'coast', 'wild'].map((p) => h('span.lp-tile-k', TH.icon.trim(p, { size: 30 }))));
    }
    if (id === 'builds') {
      return h('div.lp-mock.lp-stack', h('b', '3'), h('span', '× 64'), h('i', '+'), h('b', '12'), h('small', 'oak planks · 1 shulker box'));
    }
    return h('div.lp-mock.lp-coords', h('div', h('small', 'Overworld'), h('b', '1024 · -512')), h('span.lp-arrow', '⇄'), h('div', h('small', 'Nether'), h('b', '128 · -64')));
  }

  const fine = () => !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hovers = () => !!(window.matchMedia && matchMedia('(hover: hover)').matches);

  /* ---------- particle scenes: one canvas per pane, only the open pane is animated ---------- */
  function scene(cv, kind, color) {
    const ctx = cv.getContext('2d');
    const N = kind === 'blocks' ? 0 : kind === 'vortex' ? 90 : kind === 'sparkle' ? 36 : 70;
    const ps = Array.from({ length: N }, (_, i) => ({ a: Math.random(), b: Math.random(), s: 0.3 + Math.random() * 0.9, p: Math.random() * 6.28, z: 2 + Math.floor(Math.random() * 3), i }));
    const cells = [];
    return function draw(t, dt) {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      if (!W) return;
      ctx.fillStyle = color;
      if (kind === 'glyphs' || kind === 'emeralds') {
        ps.forEach((q) => {
          q.b -= dt * 0.00006 * (0.6 + q.s * 1.2);
          if (q.b < -0.05) { q.b = 1.05; q.a = Math.random(); }
          const x = (q.a + Math.sin(t * 0.0006 * q.s + q.p) * 0.03) * W, y = q.b * H, z = q.z * 2 + 2;
          ctx.globalAlpha = (0.25 + 0.55 * Math.abs(Math.sin(t * 0.002 * q.s + q.p))) * Math.min(1, q.b * 2.2, (1.05 - q.b) * 6 + 0.2);
          if (kind === 'emeralds') { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-z / 2, -z / 2, z, z); ctx.restore(); }
          else { ctx.fillRect(x, y, z, z); if (q.i % 5 === 0) { ctx.fillRect(x - z, y + z, z, z); ctx.fillRect(x + z, y + z, z, z); } }
        });
      } else if (kind === 'sparkle') {
        ps.forEach((q) => {
          const x = q.a * W, y = q.b * H, k = Math.max(0, Math.sin(t * 0.0015 * q.s + q.p)), z = 1 + Math.round(k * 3);
          ctx.globalAlpha = 0.15 + k * 0.7;
          ctx.fillRect(x - z * 2, y, z * 4 + 1, z); ctx.fillRect(x, y - z * 2, z, z * 4 + 1);
        });
      } else if (kind === 'blocks') {
        const g = 34, cols = Math.ceil(W / g), rows = Math.ceil(H / g);
        if (!cells.length || cells.cols !== cols) { cells.length = 0; cells.cols = cols; for (let i = 0; i < cols * rows; i++) cells.push({ t0: Math.random() * 9000 }); }
        cells.forEach((c, i) => {
          const k = (Math.sin((t + c.t0) * 0.0007) + 1) / 2; if (k < 0.72) return;
          const x = (i % cols) * g + 3, y = Math.floor(i / cols) * g + 3;
          ctx.globalAlpha = (k - 0.72) * 1.3; ctx.fillRect(x, y, g - 6, g - 6);
        });
      } else {
        const cx = W * 0.62, cy = H * 0.5, R = Math.min(W, H) * 0.55;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9); g.addColorStop(0, 'rgba(140,60,255,.35)'); g.addColorStop(1, 'rgba(140,60,255,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ps.forEach((q) => {
          const r = (0.08 + q.a * 0.92) * R, ang = q.p + t * 0.0004 * (1.6 / (0.25 + q.a)) * q.s;
          const x = cx + Math.cos(ang) * r * 1.15, y = cy + Math.sin(ang) * r * 0.62 - q.a * 8;
          ctx.globalAlpha = 0.25 + 0.6 * (1 - q.a); ctx.fillStyle = q.i % 3 === 0 ? '#ff5a4e' : q.i % 3 === 1 ? '#b57bff' : '#e9d5ff';
          ctx.fillRect(x, y, q.z, q.z);
        });
      }
      ctx.globalAlpha = 1;
    };
  }

  function render(root, state) {
    const mods = TH.app.modules;
    const trimsOwned = state.trims ? Object.values(state.trims.owned || {}).filter(Boolean).length : 0;
    const items = TOOLS.map((t) => ({ t, mod: mods.find((m) => m.id === t.id) })).filter((x) => x.mod);
    const panes = [];
    let open = -1, raf = 0, last = 0, openTimer = 0;   // all panes are equals: none is open until you point at one
    const draws = new Map();

    const sync = () => {
      panes.forEach((p, i) => { p.classList.toggle('is-open', i === open); p.setAttribute('aria-expanded', String(i === open)); });
      const cvs = root.querySelectorAll('.lp-fx');
      cvs.forEach((cv, i) => { if (i !== open) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); });
    };
    const setOpen = (i) => { if (i === open) return; open = i; sync(); };

    const tick = (t) => {
      if (!root.isConnected) { cancelAnimationFrame(raf); return; }
      const dt = Math.min(64, t - last); last = t;
      const d = draws.get(open); if (d) d(t, dt);
      raf = requestAnimationFrame(tick);
    };

    const el = items.map(({ t, mod }, i) => {
      let st = stat(mod, state, t.unit);
      if (t.id === 'trims' && trimsOwned && TH.data && TH.data.trimPatterns) st = stat({ badge: () => ({ done: trimsOwned, total: TH.data.trimPatterns.length }) }, state, t.unit);
      const cv = h('canvas.lp-fx', { 'aria-hidden': 'true' });
      const pane = h('a.lp-pane', { href: '#/' + t.id, 'data-tool': t.id, style: { '--i': i }, 'aria-label': mod.name + (t.soon ? ' (coming soon)' : ''), 'aria-expanded': 'false' },
        h('span.lp-bg', { 'aria-hidden': 'true' }), cv,
        h('div.lp-rail', { 'aria-hidden': 'true' }, h('span.lp-rn', String(i + 1)), h('span.lp-rico', t.icon(44)), h('span.lp-rname', mod.name)),
        h('div.lp-open',
          h('span.lp-num', { style: { '--k': 0 } }, String(i + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0')),
          h('div.lp-cols',
            h('div.lp-text',
              h('span.lp-kick', { style: { '--k': 1 } }, t.kicker, t.soon ? h('em', 'soon') : null),
              h('h3.lp-name', { style: { '--k': 2 } }, mod.name),
              h('p.lp-pitch', { style: { '--k': 3 } }, t.pitch),
              h('ul.lp-points', { style: { '--k': 4 } }, t.points.map((p, j) => h('li', { style: { '--j': j } }, p))),
              st ? h('div', { style: { '--k': 5 } }, st) : null,
              h('span.lp-cta', { style: { '--k': 6 } }, t.soon ? 'Take a look' : 'Open', h('i', '→'))),
            h('div.lp-art',
              h('div.lp-ico', { style: { '--k': 2 } }, t.icon(176)),
              h('div', { style: { '--k': 4 } }, mock(t.id))))));
      // the pane under the pointer swells open (a short delay avoids flicker while crossing panes)
      pane.addEventListener('pointerenter', () => { if (!hovers()) return; clearTimeout(openTimer); openTimer = setTimeout(() => setOpen(i), 70); });
      pane.addEventListener('focus', () => setOpen(i));
      pane.addEventListener('click', (e) => { if (!hovers() && i !== open) { e.preventDefault(); setOpen(i); } });
      if (fine() && hovers()) {
        pane.addEventListener('pointermove', (e) => {
          const r = pane.getBoundingClientRect();
          pane.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * 22).toFixed(1) + 'px');
          pane.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * 18).toFixed(1) + 'px');
          pane.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
          pane.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
        });
      }
      panes.push(pane);
      return { pane, cv, t };
    });

    root.append(
      h('div.lp-split', { role: 'group', 'aria-label': 'Tools', onpointerleave: () => { if (hovers()) { clearTimeout(openTimer); openTimer = setTimeout(() => setOpen(-1), 200); } } }, el.map((x) => x.pane)),
      h('p.lp-hint', 'hover a tool to open it · click to go · ', h('kbd', '1'), '–', h('kbd', String(items.length)), ' to jump'));

    // size the canvases to their panes and start the scenes
    const ro = new ResizeObserver(() => el.forEach(({ cv }) => { const r = cv.getBoundingClientRect(); const z = parseFloat(document.documentElement.style.zoom) || 1; cv.width = Math.max(1, Math.round(r.width / z)); cv.height = Math.max(1, Math.round(r.height / z)); }));
    el.forEach(({ cv, t }) => { ro.observe(cv); const col = getComputedStyle(cv.parentElement).getPropertyValue('--tc').trim() || '#b07cff'; draws.set(el.findIndex((x) => x.cv === cv), scene(cv, t.fx, col)); });
    sync();
    if (fine()) raf = requestAnimationFrame((t) => { last = t; tick(t); });
  }

  // number keys 1-5 open the tools while the landing page is showing
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    if (location.hash && location.hash !== '#/' && location.hash !== '#') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    const mods = TH.app.modules;
    const list = TOOLS.filter((x) => mods.find((m) => m.id === x.id));
    const pick = list[+e.key - 1];
    if (pick) { e.preventDefault(); location.hash = '#/' + pick.id; }
  });

  TH.app.register({ id: 'overview', name: 'Overview', icon: 'mc:compass', hidden: true, render });
})();
