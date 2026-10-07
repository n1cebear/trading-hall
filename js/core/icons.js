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
    coal: 'item/coal', paper: 'item/paper', bell: 'item/bell', chest: 'item/chest_minecart', bed: 'item/red_bed',
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

  function src(key) {
    if (EXTERNAL[key]) return EXTERNAL[key];
    const path = ALIAS[key] || (key.includes('/') ? key : 'item/' + key);
    return BASE + path + '.png';
  }

  function icon(key, opts) {
    opts = opts || {};
    const size = opts.size || 16;
    const url = src(key);
    const wrap = document.createElement('span');
    wrap.className = 'mc' + (opts.glint ? ' mc-glint' : '') + (opts.cls ? ' ' + opts.cls : '');
    wrap.style.setProperty('--mc', size + 'px');
    if (opts.glint) wrap.style.setProperty('--mc-src', `url("${url}")`);
    if (opts.title) wrap.title = opts.title;
    wrap.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { wrap.classList.add('mc-missing'); wrap.textContent = FALLBACK[key] || opts.fallback || '▪'; };
    wrap.appendChild(img);
    return wrap;
  }

  icon.src = src;

  icon.item = function (itemId, material, opts) {
    opts = Object.assign({}, opts);
    let key;
    if (itemId === 'shield') key = 'shield';
    else if (ITEM_PLAIN[itemId]) key = ITEM_PLAIN[itemId];
    else if (material === 'turtle') key = 'turtle_helmet';
    else if (!material || material === 'plain' || material === 'mace') key = itemId;
    else key = material + '_' + itemId;
    // leather armour is a greyscale sprite tinted in-game; approximate the default brown
    if (material === 'leather') opts.cls = (opts.cls ? opts.cls + ' ' : '') + 'mc-leather';
    return icon(key, opts);
  };

  icon.prof = (profId, opts) => icon(PROF[profId] || 'item/villager_spawn_egg', opts);
  icon.trim = (patternId, opts) => icon(`item/${patternId}_armor_trim_smithing_template`, opts);
  const ITEM_NAME_FIX = { nether_quartz: 'quartz', redstone_dust: 'redstone' };
  icon.trimMaterial = (itemName, opts) => {
    const k = itemName.toLowerCase().replace(/ /g, '_');
    return icon('item/' + (ITEM_NAME_FIX[k] || k), opts);
  };

  return icon;
})();
