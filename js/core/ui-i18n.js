window.TH = window.TH || {};

/**
 * Whole-page translation of the tool's own text (the game's names come from Mojang's language files, see i18n.js).
 *
 * How it works: the app is written in English. When a language other than English is chosen, a dictionary
 * js/data/ui/<code>.js (TH.uiStrings.<code> = { 'English text': 'Translated text', ... }) is loaded and every text node and
 * the attributes placeholder / title / aria-label / alt on the page are swapped for their translation, once now and again for
 * everything the app adds later (MutationObserver). Nothing in the modules had to change.
 *   - A key matches a whole text node (whitespace normalised). Keys may hold {n} for a number: "{n} builds" -> "{n} Builds".
 *   - Text that is not in the dictionary stays English: game names, tool names, things you typed yourself.
 *   - The English original is remembered per node, so switching back (or to another language) always starts from English.
 *   - data-no-i18n on an element keeps its whole subtree untouched.
 * Harvest mode (dev): TH.ui.harvest(true) records every English string the page shows into TH.ui.seen.
 */
TH.ui = (function () {
  const SHORT = { de_de: 'de', fr_fr: 'fr', es_es: 'es', it_it: 'it', pt_br: 'pt', nl_nl: 'nl', sv_se: 'sv', da_dk: 'da', no_no: 'nb' };
  TH.uiStrings = TH.uiStrings || {};
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'CANVAS', 'SVG']);
  let cur = 'en', map = new Map(), pats = [], obs = null, queued = false, harvesting = false;
  const seen = new Set(), neg = new Map(), pending = new Set();

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const NUM = /\d[\d.,]*/g;
  const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

  function compile(dict) {
    map = new Map(); pats = []; neg.clear();
    Object.keys(dict).forEach((k) => {
      if (!k.includes('{n}')) { map.set(k, dict[k]); return; }
      const parts = k.split('{n}').map(esc);
      pats.push({ re: new RegExp('^' + parts.join('(\\d[\\d.,]*)') + '$'), to: dict[k], n: parts.length - 1 });
    });
    pats.sort((a, b) => b.re.source.length - a.re.source.length);
  }

  /** The translation of one English string, or null when there is none. */
  function tr(en) {
    const k = norm(en);
    if (!k || !/[A-Za-z]/.test(k)) return null;
    if (harvesting) seen.add(k.replace(NUM, '{n}') === k ? k : k.replace(NUM, '{n}'));
    if (cur === 'en') return null;
    if (map.has(k)) return map.get(k);
    if (neg.has(k)) return neg.get(k);
    let out = null;
    if (/\d/.test(k)) {
      for (const p of pats) {
        const m = k.match(p.re);
        if (m) { let i = 0; out = p.to.replace(/\{n\}/g, () => m[++i] || ''); break; }
      }
    }
    if (neg.size > 6000) neg.clear();
    neg.set(k, out);
    return out;
  }
  const keepSpace = (orig, t) => orig.slice(0, orig.length - orig.trimStart().length) + t + orig.slice(orig.trimEnd().length);

  function text(n) {
    const par = n.parentNode;
    if (!par || SKIP.has(par.nodeName.toUpperCase()) || (par.closest && par.closest('[data-no-i18n]'))) return;
    let en;
    if (n.__tr !== undefined && n.__tr === n.data) en = n.__en; else { en = n.data; n.__en = en; n.__tr = undefined; }
    const t = tr(en);
    if (t != null) { const v = keepSpace(en, t); if (n.data !== v) n.data = v; n.__tr = v; }
    else if (n.__tr !== undefined) { n.data = en; n.__tr = undefined; }
  }
  function attrs(el) {
    if (!el.getAttribute || (el.closest && el.closest('[data-no-i18n]'))) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v == null || !v) continue;
      const rec = el.__ui || (el.__ui = {});
      let en;
      if (rec[a] && rec[a].tr === v) en = rec[a].en; else { en = v; rec[a] = { en, tr: null }; }
      const t = tr(en);
      if (t != null) { if (v !== t) el.setAttribute(a, t); rec[a].tr = t; }
      else if (rec[a].tr != null) { el.setAttribute(a, en); rec[a].tr = null; }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP.has(root.nodeName.toUpperCase())) return; attrs(root); }
    const tw = document.createTreeWalker(root, 5 /* element + text */, { acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.nodeName.toUpperCase()) || n.hasAttribute('data-no-i18n')) ? 2 /* reject the subtree */ : 1) });
    let n = tw.nextNode();
    while (n) {
      if (n.nodeType === 3) text(n); else attrs(n);
      n = tw.nextNode();
    }
  }
  function flush() {
    queued = false;
    const list = [...pending]; pending.clear();
    list.forEach((n) => { if (n.isConnected || n.nodeType === 11) walk(n); });
  }
  function schedule(n) { pending.add(n); if (!queued) { queued = true; requestAnimationFrame(flush); } }

  function start() {
    if (obs || typeof MutationObserver === 'undefined') return;
    obs = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') { if (r.target.__tr === undefined || r.target.__tr !== r.target.data) schedule(r.target); }
        else if (r.type === 'attributes') schedule(r.target);
        else r.addedNodes.forEach((n) => schedule(n));
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function loadDict(code) {
    if (TH.uiStrings[code]) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/data/ui/' + code + '.js';
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  const api = {
    get lang() { return cur; },
    seen,
    /** Record every English string the page shows (dev tool for building the dictionaries). */
    harvest(on) { harvesting = !!on; if (on) { start(); neg.clear(); walk(document.body); } },
    /** Switch the page text to the language of a Mojang language code ('de_de'); anything we have no dictionary for is English. */
    setLang(code) {
      const short = SHORT[code] || 'en';
      return (short === 'en' ? Promise.resolve() : loadDict(short)).then(() => {
        cur = short !== 'en' && TH.uiStrings[short] ? short : 'en';
        compile(cur === 'en' ? {} : TH.uiStrings[cur]);
        document.documentElement.lang = cur === 'en' ? 'en' : cur;
        start();
        walk(document.body);
      });
    },
    /** Translate a string at once (for text the app puts in the DOM by other means). */
    t(en) { const x = tr(en); return x == null ? en : x; },
    walk,
  };
  return api;
})();
