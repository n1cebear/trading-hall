/*
 * Enchantment data for the Trading Hall tracker.
 * Minecraft Java Edition 1.21.x (verified against minecraft.wiki, up to 1.21.11 / Lunge).
 * Plain browser script: attaches everything to window.TH.data.
 */
window.TH = window.TH || {};
TH.data = TH.data || {};

TH.data.enchantCategories = [
  { id: 'armor', name: 'Armor', hint: 'Helmet, chestplate, leggings, boots' },
  { id: 'melee', name: 'Swords & Axes', hint: 'Swords, axes, spears' },
  { id: 'mace', name: 'Mace', hint: 'Mace only' },
  { id: 'tools', name: 'Tools', hint: 'Pickaxe, shovel, axe, hoe' },
  { id: 'bow', name: 'Bow', hint: 'Bow only' },
  { id: 'crossbow', name: 'Crossbow', hint: 'Crossbow only' },
  { id: 'trident', name: 'Trident', hint: 'Trident only' },
  { id: 'fishing', name: 'Fishing Rod', hint: 'Fishing rod only' },
  { id: 'universal', name: 'Universal', hint: 'Any damageable item' },
  { id: 'curse', name: 'Curses', hint: 'Negative enchantments' }
];

// Shared exclusivity sets (mirrors minecraft:exclusive_set/* tags).
// Some combinations (e.g. Sharpness + Density) are impossible in Survival,
// but the tag still lists them, so they are kept for completeness.
(function () {
  var ARMOR = ['protection', 'fire_protection', 'blast_protection', 'projectile_protection'];
  var DAMAGE = ['sharpness', 'smite', 'bane_of_arthropods', 'impaling', 'density', 'breach'];
  var BOOTS = ['frost_walker', 'depth_strider'];
  var MINING = ['fortune', 'silk_touch'];
  var BOW = ['infinity', 'mending'];
  var CROSSBOW = ['multishot', 'piercing'];
  var RIPTIDE = ['riptide', 'loyalty', 'channeling'];

  // Everything in `set` except `self`.
  function others(set, self) {
    return set.filter(function (id) { return id !== self; });
  }

  var ALL_ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];

  TH.data.enchantments = [
    // ---- Armor -------------------------------------------------------------
    {
      id: 'protection',
      name: 'Protection',
      maxLevel: 4,
      category: 'armor',
      appliesTo: ALL_ARMOR,
      librarian: true,
      treasure: false,
      exclusiveWith: others(ARMOR, 'protection'),
      desc: 'Reduces most types of damage.',
      rebalance: { biome: 'plains', tier: 'special' }
    },
    {
      id: 'fire_protection',
      name: 'Fire Protection',
      maxLevel: 4,
      category: 'armor',
      appliesTo: ALL_ARMOR,
      librarian: true,
      treasure: false,
      exclusiveWith: others(ARMOR, 'fire_protection'),
      desc: 'Reduces fire damage and burn time.',
      rebalance: { biome: 'desert', tier: 'common' }
    },
    {
      id: 'blast_protection',
      name: 'Blast Protection',
      maxLevel: 4,
      category: 'armor',
      appliesTo: ALL_ARMOR,
      librarian: true,
      treasure: false,
      exclusiveWith: others(ARMOR, 'blast_protection'),
      desc: 'Reduces explosion damage and knockback.',
      rebalance: { biome: 'taiga', tier: 'common' }
    },
    {
      id: 'projectile_protection',
      name: 'Projectile Protection',
      maxLevel: 4,
      category: 'armor',
      appliesTo: ALL_ARMOR,
      librarian: true,
      treasure: false,
      exclusiveWith: others(ARMOR, 'projectile_protection'),
      desc: 'Reduces projectile damage.',
      rebalance: { biome: 'jungle', tier: 'common' }
    },
    {
      id: 'thorns',
      name: 'Thorns',
      maxLevel: 3,
      category: 'armor',
      appliesTo: ALL_ARMOR,
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Damages attackers that hit you.',
      rebalance: { biome: 'desert', tier: 'common' }
    },

    // ---- Boots -------------------------------------------------------------
    {
      id: 'feather_falling',
      name: 'Feather Falling',
      maxLevel: 4,
      category: 'armor',
      appliesTo: ['boots'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Reduces fall damage.',
      rebalance: { biome: 'jungle', tier: 'common' }
    },
    {
      id: 'depth_strider',
      name: 'Depth Strider',
      maxLevel: 3,
      category: 'armor',
      appliesTo: ['boots'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(BOOTS, 'depth_strider'),
      desc: 'Increases underwater movement speed.',
      rebalance: { biome: 'swamp', tier: 'common' }
    },
    {
      id: 'frost_walker',
      name: 'Frost Walker',
      maxLevel: 2,
      category: 'armor',
      appliesTo: ['boots'],
      librarian: true,
      treasure: true,
      exclusiveWith: others(BOOTS, 'frost_walker'),
      desc: 'Freezes water into frosted ice as you walk.',
      rebalance: { biome: 'snow', tier: 'common' }
    },
    {
      id: 'soul_speed',
      name: 'Soul Speed',
      maxLevel: 3,
      category: 'armor',
      appliesTo: ['boots'],
      librarian: false,
      treasure: true,
      exclusiveWith: [],
      desc: 'Increases speed on soul sand and soul soil.'
    },

    // ---- Leggings (no own category; grouped with armor) --------------------
    {
      id: 'swift_sneak',
      name: 'Swift Sneak',
      maxLevel: 3,
      category: 'armor',
      appliesTo: ['leggings'],
      librarian: false,
      treasure: true,
      exclusiveWith: [],
      desc: 'Increases movement speed while sneaking.'
    },

    // ---- Helmet ------------------------------------------------------------
    {
      id: 'respiration',
      name: 'Respiration',
      maxLevel: 3,
      category: 'armor',
      appliesTo: ['helmet'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Extends underwater breathing time.',
      rebalance: { biome: 'swamp', tier: 'common' }
    },
    {
      id: 'aqua_affinity',
      name: 'Aqua Affinity',
      maxLevel: 1,
      category: 'armor',
      appliesTo: ['helmet'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Removes the underwater mining speed penalty.',
      rebalance: { biome: 'snow', tier: 'common' }
    },

    // ---- Melee (swords, axes, spears) --------------------------------------
    {
      id: 'sharpness',
      name: 'Sharpness',
      maxLevel: 5,
      category: 'melee',
      appliesTo: ['sword', 'axe', 'spear'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'sharpness'),
      desc: 'Increases melee damage.',
      rebalance: { biome: 'savanna', tier: 'special' }
    },
    {
      id: 'smite',
      name: 'Smite',
      maxLevel: 5,
      category: 'melee',
      appliesTo: ['sword', 'axe', 'spear', 'mace'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'smite'),
      desc: 'Increases damage against undead mobs.',
      rebalance: { biome: 'plains', tier: 'common' }
    },
    {
      id: 'bane_of_arthropods',
      name: 'Bane of Arthropods',
      maxLevel: 5,
      category: 'melee',
      appliesTo: ['sword', 'axe', 'spear', 'mace'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'bane_of_arthropods'),
      desc: 'Increases damage against arthropods and slows them.',
      rebalance: { biome: 'plains', tier: 'common' }
    },
    {
      id: 'knockback',
      name: 'Knockback',
      maxLevel: 2,
      category: 'melee',
      appliesTo: ['sword', 'spear'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases knockback dealt.',
      rebalance: { biome: 'savanna', tier: 'common' }
    },
    {
      id: 'fire_aspect',
      name: 'Fire Aspect',
      maxLevel: 2,
      category: 'melee',
      appliesTo: ['sword', 'spear', 'mace'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Sets the target on fire.',
      rebalance: { biome: 'taiga', tier: 'common' }
    },
    {
      id: 'looting',
      name: 'Looting',
      maxLevel: 3,
      category: 'melee',
      appliesTo: ['sword', 'spear'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases mob drops.',
      rebalance: { biome: 'snow', tier: 'common' }
    },
    {
      id: 'sweeping_edge',
      name: 'Sweeping Edge',
      maxLevel: 3,
      category: 'melee',
      appliesTo: ['sword'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases sweep attack damage.',
      rebalance: { biome: 'savanna', tier: 'common' }
    },
    {
      id: 'lunge',
      name: 'Lunge',
      maxLevel: 3,
      category: 'melee',
      appliesTo: ['spear'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Propels you forward on a spear jab at the cost of hunger.'
    },

    // ---- Mace --------------------------------------------------------------
    {
      id: 'density',
      name: 'Density',
      maxLevel: 5,
      category: 'mace',
      appliesTo: ['mace'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'density'),
      desc: 'Increases smash attack damage per block fallen.'
    },
    {
      id: 'breach',
      name: 'Breach',
      maxLevel: 4,
      category: 'mace',
      appliesTo: ['mace'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'breach'),
      desc: 'Reduces the effectiveness of the target\'s armor.'
    },
    {
      id: 'wind_burst',
      name: 'Wind Burst',
      maxLevel: 3,
      category: 'mace',
      appliesTo: ['mace'],
      librarian: false,
      treasure: true,
      exclusiveWith: [],
      desc: 'Launches you upward after a smash attack.'
    },

    // ---- Tools -------------------------------------------------------------
    {
      id: 'efficiency',
      name: 'Efficiency',
      maxLevel: 5,
      category: 'tools',
      appliesTo: ['pickaxe', 'shovel', 'axe', 'hoe', 'shears'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases mining speed.',
      rebalance: { biome: 'desert', tier: 'special' }
    },
    {
      id: 'fortune',
      name: 'Fortune',
      maxLevel: 3,
      category: 'tools',
      appliesTo: ['pickaxe', 'shovel', 'axe', 'hoe'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(MINING, 'fortune'),
      desc: 'Increases block drops.',
      rebalance: { biome: 'taiga', tier: 'special' }
    },
    {
      id: 'silk_touch',
      name: 'Silk Touch',
      maxLevel: 1,
      category: 'tools',
      appliesTo: ['pickaxe', 'shovel', 'axe', 'hoe'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(MINING, 'silk_touch'),
      desc: 'Mined blocks drop themselves.',
      rebalance: { biome: 'snow', tier: 'special' }
    },

    // ---- Bow ---------------------------------------------------------------
    {
      id: 'power',
      name: 'Power',
      maxLevel: 5,
      category: 'bow',
      appliesTo: ['bow'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases arrow damage.',
      rebalance: { biome: 'jungle', tier: 'common' }
    },
    {
      id: 'punch',
      name: 'Punch',
      maxLevel: 2,
      category: 'bow',
      appliesTo: ['bow'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Increases arrow knockback.',
      rebalance: { biome: 'plains', tier: 'common' }
    },
    {
      id: 'flame',
      name: 'Flame',
      maxLevel: 1,
      category: 'bow',
      appliesTo: ['bow'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Arrows set targets on fire.',
      rebalance: { biome: 'taiga', tier: 'common' }
    },
    {
      id: 'infinity',
      name: 'Infinity',
      maxLevel: 1,
      category: 'bow',
      appliesTo: ['bow'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(BOW, 'infinity'),
      desc: 'Shooting consumes no regular arrows.',
      rebalance: { biome: 'desert', tier: 'common' }
    },

    // ---- Crossbow ----------------------------------------------------------
    {
      id: 'multishot',
      name: 'Multishot',
      maxLevel: 1,
      category: 'crossbow',
      appliesTo: ['crossbow'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(CROSSBOW, 'multishot'),
      desc: 'Fires three projectiles at once.'
    },
    {
      id: 'piercing',
      name: 'Piercing',
      maxLevel: 4,
      category: 'crossbow',
      appliesTo: ['crossbow'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(CROSSBOW, 'piercing'),
      desc: 'Arrows pass through multiple entities.'
    },
    {
      id: 'quick_charge',
      name: 'Quick Charge',
      maxLevel: 3,
      category: 'crossbow',
      appliesTo: ['crossbow'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Reduces crossbow reload time.'
    },

    // ---- Trident -----------------------------------------------------------
    {
      id: 'impaling',
      name: 'Impaling',
      maxLevel: 5,
      category: 'trident',
      appliesTo: ['trident'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(DAMAGE, 'impaling'),
      desc: 'Increases damage against aquatic mobs.'
    },
    {
      id: 'loyalty',
      name: 'Loyalty',
      maxLevel: 3,
      category: 'trident',
      appliesTo: ['trident'],
      librarian: true,
      treasure: false,
      exclusiveWith: ['riptide'],
      desc: 'Thrown trident returns to you.'
    },
    {
      id: 'riptide',
      name: 'Riptide',
      maxLevel: 3,
      category: 'trident',
      appliesTo: ['trident'],
      librarian: true,
      treasure: false,
      exclusiveWith: others(RIPTIDE, 'riptide'),
      desc: 'Launches you with the trident in water or rain.'
    },
    {
      id: 'channeling',
      name: 'Channeling',
      maxLevel: 1,
      category: 'trident',
      appliesTo: ['trident'],
      librarian: true,
      treasure: false,
      exclusiveWith: ['riptide'],
      desc: 'Summons lightning on hit during thunderstorms.'
    },

    // ---- Fishing rod -------------------------------------------------------
    {
      id: 'luck_of_the_sea',
      name: 'Luck of the Sea',
      maxLevel: 3,
      category: 'fishing',
      appliesTo: ['fishing_rod'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Improves fishing treasure odds.'
    },
    {
      id: 'lure',
      name: 'Lure',
      maxLevel: 3,
      category: 'fishing',
      appliesTo: ['fishing_rod'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Decreases wait time for a bite.'
    },

    // ---- Universal ---------------------------------------------------------
    {
      id: 'unbreaking',
      name: 'Unbreaking',
      maxLevel: 3,
      category: 'universal',
      appliesTo: ['any'],
      librarian: true,
      treasure: false,
      exclusiveWith: [],
      desc: 'Items lose durability less often.',
      rebalance: { biome: 'jungle', tier: 'special' }
    },
    {
      id: 'mending',
      name: 'Mending',
      maxLevel: 1,
      category: 'universal',
      appliesTo: ['any'],
      librarian: true,
      treasure: true,
      exclusiveWith: others(BOW, 'mending'),
      desc: 'Repairs the item with collected experience.',
      rebalance: { biome: 'swamp', tier: 'special' }
    },

    // ---- Curses ------------------------------------------------------------
    {
      id: 'binding_curse',
      name: 'Curse of Binding',
      maxLevel: 1,
      category: 'curse',
      appliesTo: ['helmet', 'chestplate', 'leggings', 'boots', 'elytra', 'pumpkin', 'head'],
      librarian: true,
      treasure: true,
      exclusiveWith: [],
      desc: 'The item cannot be removed once equipped.',
      rebalance: { biome: 'savanna', tier: 'common' }
    },
    {
      id: 'vanishing_curse',
      name: 'Curse of Vanishing',
      maxLevel: 1,
      category: 'curse',
      appliesTo: ['any'],
      librarian: true,
      treasure: true,
      exclusiveWith: [],
      desc: 'The item disappears on death.',
      rebalance: { biome: 'swamp', tier: 'common' }
    }
  ];
})();

/**
 * Emerald price range of a librarian enchanted-book trade (Java Edition).
 *
 * The game rolls: cost = 2 + 3 * level + nextInt(5 + 10 * level)
 * nextInt(n) yields 0 .. n-1, so:
 *   min = 2 + 3 * level
 *   max = 2 + 3 * level + 4 + 10 * level = 6 + 13 * level
 * Treasure enchantments (Mending, Frost Walker, curses, ...) cost double.
 * The result is capped at 64 before any discounts (hero of the village,
 * curing, reputation) are applied. The book itself costs 1 extra book.
 *
 * @param {Object|string} ench  enchantment object or its id
 * @param {number} level        enchantment level (1..maxLevel)
 * @returns {{min:number, max:number}} integer emerald bounds (pre-discount)
 */
TH.data.bookPrice = function (ench, level) {
  if (typeof ench === 'string') {
    ench = TH.data.enchantments.find(function (e) { return e.id === ench; });
  }
  var lvl = Math.max(1, Math.floor(level || 1));
  var mult = ench && ench.treasure ? 2 : 1;
  var min = (2 + 3 * lvl) * mult;
  var max = (6 + 13 * lvl) * mult;
  return { min: Math.min(min, 64), max: Math.min(max, 64) };
};

/**
 * Rates an observed price against the possible range for that book.
 *   'perfect' - equals the minimum
 *   'great'   - within the bottom 25% of the range
 *   'good'    - within the bottom 60% of the range
 *   'meh'     - anything above that
 *   'unknown' - price is null/undefined
 *
 * @param {Object|string} ench
 * @param {number} level
 * @param {?number} price  observed emerald cost (pre-discount)
 * @returns {string}
 */
TH.data.priceTier = function (ench, level, price) {
  if (price === null || price === undefined || isNaN(price)) return 'unknown';
  var range = TH.data.bookPrice(ench, level);
  if (price <= range.min) return 'perfect';
  var span = range.max - range.min;
  if (span <= 0) return 'perfect';
  var pos = (price - range.min) / span;
  if (pos <= 0.25) return 'great';
  if (pos <= 0.6) return 'good';
  return 'meh';
};
