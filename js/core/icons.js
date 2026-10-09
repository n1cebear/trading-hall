window.TH = window.TH || {};

/**
 * Real Minecraft textures, loaded at runtime from a public asset mirror
 * (nothing from Mojang is copied into this project). Offline, every icon falls
 * back to a small text glyph so the UI never breaks.
 *
 *   TH.icon('emerald')                    alias or raw texture path ('item/emerald')
 *   TH.icon.item('sword', 'diamond')      enchantable items by id + material
 *   TH.icon.prof('librarian')             profession = its workstation block
 *   TH.icon.trim('sentry')                armor trim smithing template
 *   options: { size: 16, glint: false, title, cls }
 */
TH.icon = (function () {
  const VERSION = '1.21.11';
  const BASE = `https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${VERSION}/assets/minecraft/textures/`;
  // textures that have no flat sprite in the game files
  const EXTERNAL = { shield: 'https://minecraft.wiki/images/Invicon_Shield.png', anvil: 'https://minecraft.wiki/images/Invicon_Anvil.png' };

  const ALIAS = {
    emerald: 'item/emerald', book: 'item/book', enchanted_book: 'item/enchanted_book',
    xp: 'item/experience_bottle', lapis: 'item/lapis_lazuli', anvil: 'block/anvil_top',
    bookshelf: 'block/bookshelf', enchanting_table: 'block/enchanting_table_top', obsidian: 'block/obsidian',
    name_tag: 'item/name_tag', spawn_egg: 'item/villager_spawn_egg', map: 'item/filled_map', compass: 'item/compass_00',
    stick: 'item/stick', pumpkin: 'block/pumpkin_side', melon: 'item/melon_slice', rotten_flesh: 'item/rotten_flesh',
    clay: 'item/clay_ball', golden_carrot: 'item/golden_carrot', ender_pearl: 'item/ender_pearl', quartz: 'item/quartz',
    string: 'item/string', leather: 'item/leather', iron: 'item/iron_ingot', diamond: 'item/diamond', gold: 'item/gold_ingot',
    coal: 'item/coal', paper: 'item/paper', bell: 'item/bell', chest: 'item/chest_minecart',
    totem: 'item/totem_of_undying', redstone: 'item/redstone', glass: 'block/glass', wool: 'block/white_wool',
    cod: 'item/cod', chicken: 'item/chicken', wheat: 'item/wheat', arrow: 'item/arrow', star: 'item/nether_star',
    villager: 'item/villager_spawn_egg',
  };

  const PROF = {
    armorer: 'block/blast_furnace_front_on', butcher: 'block/smoker_front', cartographer: 'block/cartography_table_side3',
    cleric: 'item/brewing_stand', farmer: 'block/composter_side', fisherman: 'block/barrel_top',
    fletcher: 'block/fletching_table_front', leatherworker: 'item/cauldron', librarian: 'block/lectern_front',
    mason: 'block/stonecutter_side', shepherd: 'block/loom_front', toolsmith: 'block/smithing_table_front',
    weaponsmith: 'block/grindstone_side',
  };

  const ITEM_PLAIN = { crossbow: 'crossbow_standby', shears: 'shears', brush: 'brush', mace: 'mace' };
  const FALLBACK = { emerald: '◆', book: '▤', enchanted_book: '✦', xp: '✧', anvil: '⚒' };

  // Opened as a local file? Prefer textures downloaded by tools/fetch-icons.js (git-ignored assets/mc/).
  const LOCAL = typeof location !== 'undefined' && location.protocol === 'file:';
  const LOCAL_BASE = 'assets/mc/';

  const path = (key) => ALIAS[key] || (key.includes('/') ? key : 'item/' + key);
  /** CDN / wiki URL for a key (used by the service worker warm-up and as the local fallback). */
  function remote(key) {
    return EXTERNAL[key] || BASE + path(key) + '.png';
  }
  /** Local file path for a key (what tools/fetch-icons.js writes). */
  const localPath = (key) => LOCAL_BASE + (EXTERNAL[key] ? 'external/' + key : path(key)) + '.png';
  function src(key) {
    return LOCAL ? localPath(key) : remote(key);
  }

  /*
   * Enchantment glint = vanilla 1.21 item glint (geometry + motion live in styles.css `.mc-gl`). The texture is
   * textures/misc/enchanted_glint_item.png (always from the CDN: it needs CORS to be read). Vanilla's glint.fsh outputs
   * `tex.rgb * GlintAlpha` (Glint Strength, default 0.75) and the glint pipeline blends SRC_COLOR, ONE, so the item gains
   * (0.75 * tex)^2 per channel. That square is baked once into a blob texture here (one 128x128 pass for the whole page,
   * nothing per icon); CSS then adds it with `plus-lighter`. Until it is baked (or if the canvas is unreadable) the raw
   * texture is used with a dimming filter as an approximation.
   */
  const GLINT_ALPHA = 0.75;
  let glintState = 0;   // 0 = not requested, 1 = raw texture set, 2 = baked
  function glintTex() {
    if (glintState) return;
    glintState = 1;
    const raw = BASE + 'misc/enchanted_glint_item.png', root = document.documentElement.style;
    root.setProperty('--mc-glint-tex', `url("${raw}")`);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          for (let k = 0; k < 3; k++) { const v = GLINT_ALPHA * d[i + k] / 255; d[i + k] = Math.round(v * v * 255); }
          d[i + 3] = 255;
        }
        x.putImageData(im, 0, 0);
        c.toBlob((b) => {
          if (!b) return;
          root.setProperty('--mc-glint-tex', `url("${URL.createObjectURL(b)}")`);
          root.setProperty('--mc-glint-filter', 'none');
          glintState = 2;
        }, 'image/png');
      } catch (e) { /* tainted canvas: keep the raw approximation */ }
    };
    img.src = raw;
  }

  function icon(key, opts) {
    opts = opts || {};
    const size = opts.size || 16;
    const url = src(key);
    const wrap = document.createElement('span');
    wrap.className = 'mc' + (opts.glint ? ' mc-glint' : '') + (opts.cls ? ' ' + opts.cls : '');
    wrap.style.setProperty('--mc', size + 'px');
    if (opts.glint) { wrap.style.setProperty('--mc-src', `url("${url}")`); glintTex(); }
    if (opts.title) wrap.title = opts.title;
    wrap.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => {
      // local copy missing -> try the CDN once, then fall back to a glyph
      if (LOCAL && img.src.indexOf(LOCAL_BASE) !== -1) { img.src = remote(key); return; }
      wrap.classList.add('mc-missing');
      wrap.textContent = FALLBACK[key] || opts.fallback || '▪';
    };
    wrap.appendChild(img);
    if (opts.glint) { const gl = document.createElement('span'); gl.className = 'mc-gl'; wrap.appendChild(gl); }   // masked additive layer (styles.css)
    return wrap;
  }

  icon.src = src;
  icon.remote = remote;
  icon.localPath = localPath;

  icon.itemKey = function (itemId, material) {
    if (itemId === 'shield') return 'shield';
    if (ITEM_PLAIN[itemId]) return ITEM_PLAIN[itemId];
    if (material === 'turtle') return 'turtle_helmet';
    if (!material || material === 'plain' || material === 'mace') return itemId;
    return material + '_' + itemId;
  };

  icon.item = function (itemId, material, opts) {
    opts = Object.assign({}, opts);
    const key = icon.itemKey(itemId, material);
    // leather armour is a greyscale sprite tinted in-game; approximate the default brown
    if (material === 'leather') opts.cls = (opts.cls ? opts.cls + ' ' : '') + 'mc-leather';
    return icon(key, opts);
  };

  icon.profKey = (profId) => PROF[profId] || 'item/villager_spawn_egg';
  icon.trimKey = (patternId) => `item/${patternId}_armor_trim_smithing_template`;
  icon.trimMaterialKey = (itemName) => {
    const k = itemName.toLowerCase().replace(/ /g, '_');
    return 'item/' + ({ nether_quartz: 'quartz', redstone_dust: 'redstone' }[k] || k);
  };
  /**
   * Mob faces for the background: crop of the front-of-head region of the entity skin.
   * [texture path, skin w, skin h, face x, face y, face w, face h, px scale]
   */
  icon.mobFaces = [
    ['entity/blaze', 64, 32, 8, 8, 8, 8, 3], ['entity/creeper/creeper', 64, 32, 8, 8, 8, 8, 3],
    ['entity/zombie/zombie', 64, 64, 8, 8, 8, 8, 3], ['entity/skeleton/skeleton', 64, 32, 8, 8, 8, 8, 3],
    ['entity/enderman/enderman', 64, 32, 8, 8, 8, 8, 3], ['entity/villager/villager', 64, 64, 8, 8, 8, 10, 3],
    ['entity/ghast/ghast', 128, 64, 32, 32, 32, 32, 1], ['entity/spider/spider', 64, 32, 40, 12, 8, 8, 3],
    ['entity/skeleton/wither_skeleton', 64, 32, 8, 8, 8, 8, 3], ['entity/skeleton/stray', 64, 32, 8, 8, 8, 8, 3],
    ['entity/zombie/husk', 64, 64, 8, 8, 8, 8, 3], ['entity/snow_golem', 64, 64, 8, 8, 8, 8, 3],
    ['entity/wolf/wolf', 64, 32, 4, 4, 6, 6, 4], ['entity/illager/pillager', 64, 64, 8, 8, 8, 10, 3], ['entity/armadillo', 64, 64, 43, 17, 7, 5, 4],
  ];
  /** URL of any texture path (entity/..., item/...). Entity skins always come from the CDN mirror (cached by sw.js). */
  icon.tex = (p) => BASE + p + '.png';

  icon.aliases = ALIAS;
  icon.external = EXTERNAL;

  icon.prof = (profId, opts) => icon(PROF[profId] || 'item/villager_spawn_egg', opts);
  icon.trim = (patternId, opts) => icon(`item/${patternId}_armor_trim_smithing_template`, opts);
  const ITEM_NAME_FIX = { nether_quartz: 'quartz', redstone_dust: 'redstone' };
  icon.trimMaterial = (itemName, opts) => {
    const k = itemName.toLowerCase().replace(/ /g, '_');
    return icon('item/' + (ITEM_NAME_FIX[k] || k), opts);
  };

  return icon;
})();
