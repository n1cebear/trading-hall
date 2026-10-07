/*
 * Enchantable items, materials, anvil multipliers and recommended loadouts
 * for the Enchanting tab. Minecraft Java Edition 1.21.x (incl. 1.21.11 spears).
 * Plain browser script: attaches everything to window.TH.data.
 */
window.TH = window.TH || {};
TH.data = TH.data || {};

/**
 * Anvil cost multipliers per enchantment level (Java Edition).
 * `item` applies when the sacrifice is an item, `book` when it is an enchanted book
 * (book = max(1, floor(item / 2)), i.e. the data-driven `anvil_cost` halved).
 * Source: minecraft.wiki "Anvil mechanics" + 1.21 enchantment definitions.
 */
TH.data.anvilMultipliers = {
  protection: { item: 1, book: 1 },
  fire_protection: { item: 2, book: 1 },
  feather_falling: { item: 2, book: 1 },
  blast_protection: { item: 4, book: 2 },
  projectile_protection: { item: 2, book: 1 },
  thorns: { item: 8, book: 4 },
  respiration: { item: 4, book: 2 },
  aqua_affinity: { item: 4, book: 2 },
  depth_strider: { item: 4, book: 2 },
  frost_walker: { item: 4, book: 2 },
  soul_speed: { item: 8, book: 4 },
  swift_sneak: { item: 8, book: 4 },
  sharpness: { item: 1, book: 1 },
  smite: { item: 2, book: 1 },
  bane_of_arthropods: { item: 2, book: 1 },
  knockback: { item: 2, book: 1 },
  fire_aspect: { item: 4, book: 2 },
  looting: { item: 4, book: 2 },
  sweeping_edge: { item: 4, book: 2 },
  lunge: { item: 2, book: 1 },
  density: { item: 2, book: 1 },
  breach: { item: 4, book: 2 },
  wind_burst: { item: 4, book: 2 },
  efficiency: { item: 1, book: 1 },
  fortune: { item: 4, book: 2 },
  silk_touch: { item: 8, book: 4 },
  power: { item: 1, book: 1 },
  punch: { item: 4, book: 2 },
  flame: { item: 4, book: 2 },
  infinity: { item: 8, book: 4 },
  multishot: { item: 4, book: 2 },
  piercing: { item: 1, book: 1 },
  quick_charge: { item: 2, book: 1 },
  impaling: { item: 4, book: 2 },
  loyalty: { item: 1, book: 1 },
  riptide: { item: 4, book: 2 },
  channeling: { item: 8, book: 4 },
  luck_of_the_sea: { item: 4, book: 2 },
  lure: { item: 4, book: 2 },
  unbreaking: { item: 2, book: 1 },
  mending: { item: 4, book: 2 },
  binding_curse: { item: 8, book: 4 },
  vanishing_curse: { item: 8, book: 4 }
};

/** Total experience points needed to go from level 0 to `level` (Java Edition). */
TH.data.xpForLevel = function (level) {
  var L = Math.max(0, level | 0);
  if (L <= 16) return L * L + 6 * L;
  if (L <= 31) return Math.round(2.5 * L * L - 40.5 * L + 360);
  return Math.round(4.5 * L * L - 162.5 * L + 2220);
};

/**
 * Materials, in picker order. `icon` = texture of the material item (TH.icon key),
 * `lang` = Minecraft item id whose localized name labels the material outside English.
 * Material never changes anvil costs; it only picks the item texture and name.
 */
TH.data.materials = {
  netherite: { name: 'Netherite', icon: 'netherite_ingot', lang: 'netherite_ingot' },
  diamond: { name: 'Diamond', icon: 'diamond', lang: 'diamond' },
  iron: { name: 'Iron', icon: 'iron_ingot', lang: 'iron_ingot' },
  golden: { name: 'Golden', icon: 'gold_ingot', lang: 'gold_ingot' },
  copper: { name: 'Copper', icon: 'copper_ingot', lang: 'copper_ingot' },
  stone: { name: 'Stone', icon: 'block/cobblestone', lang: 'stone' },
  wooden: { name: 'Wooden', icon: 'block/oak_planks', lang: 'oak_planks' },
  chainmail: { name: 'Chainmail', icon: 'iron_chain', lang: 'chainmail_chestplate' },
  leather: { name: 'Leather', icon: 'leather', lang: 'leather' },
  turtle: { name: 'Turtle', icon: 'turtle_scute', lang: 'turtle_helmet' }
};
TH.data.materialOrder = ['netherite', 'diamond', 'iron', 'golden', 'copper', 'stone', 'wooden', 'chainmail', 'leather', 'turtle'];

/**
 * Smithing-table cost of upgrading ONE diamond item to netherite (enchantments and anvil uses carry over).
 * `id` = Minecraft item id (name via TH.i18n.item), `icon` = texture path for TH.icon.
 */
TH.data.netheriteUpgrade = [
  { id: 'netherite_ingot', icon: 'item/netherite_ingot', count: 1 },
  { id: 'netherite_upgrade_smithing_template', icon: 'item/netherite_upgrade_smithing_template', count: 1 }
];

(function () {
  var TOOL = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'];
  var ARMOR = ['leather', 'chainmail', 'copper', 'iron', 'golden', 'diamond', 'netherite'];
  var BASIC = ['unbreaking', 'mending', 'vanishing_curse'];
  var WEAR = ['unbreaking', 'mending', 'binding_curse', 'vanishing_curse'];
  var PROT = ['protection', 'fire_protection', 'blast_protection', 'projectile_protection', 'thorns'];
  var DIG = ['efficiency', 'fortune', 'silk_touch'];

  // Short reasons reused across loadouts.
  var R = {
    unbreaking: 'Items last ~4× longer (armor ~2.5×).',
    mending: 'Repairs with XP orbs — the item can last forever.',
    mending_bow: 'Repair with XP; you still need arrows.',
    protection: 'Best all-round damage reduction; stacks across all four pieces.',
    efficiency: 'Mines much faster; V lets diamond/netherite insta-mine many blocks with Haste II.',
    fortune: 'More drops from ores, crops and leaves.',
    silk: 'Collect blocks themselves (ores, glass, ice, grass, sculk).'
  };

  function L(id, name, desc, enchants, reasons) {
    return { id: id, name: name, desc: desc, enchants: enchants, reasons: reasons || {} };
  }

  TH.data.itemGroups = [
    { id: 'melee', name: 'Weapons' },
    { id: 'tools', name: 'Tools' },
    { id: 'ranged', name: 'Ranged' },
    { id: 'armor', name: 'Armor' },
    { id: 'other', name: 'Other' }
  ];

  /**
   * materials = ['plain'] for items that come in one form only (bow, mace, shears, …).
   * enchants = everything that can be put on the item with an anvil (Java),
   * including "secondary" ones the enchanting table never rolls (e.g. Sharpness on axes,
   * Swift Sneak on leggings). tableOnlyNote marks interesting anvil-only cases.
   */
  TH.data.items = [
    {
      id: 'sword', name: 'Sword', group: 'melee', materials: TOOL, defaultMaterial: 'diamond',
      enchants: ['sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'sweeping_edge'].concat(BASIC),
      loadouts: [
        L('best', 'Best overall', 'All-purpose sword. Knockback left out: it pushes mobs out of reach and out of sweep range.',
          { sharpness: 5, looting: 3, sweeping_edge: 3, fire_aspect: 2, unbreaking: 3, mending: 1 },
          { sharpness: 'More damage to every mob.', looting: 'More drops, including rare ones.', sweeping_edge: 'Sweep attacks hit crowds harder.', fire_aspect: 'Extra burn damage; animals drop cooked meat.', unbreaking: R.unbreaking, mending: R.mending }),
        L('farm', 'Mob farm', 'For XP/drop farms: Smite for undead, no Fire Aspect (burning loot, angry farms).',
          { smite: 5, looting: 3, sweeping_edge: 3, unbreaking: 3, mending: 1 },
          { smite: 'Much higher damage against zombies, skeletons, wither skeletons.', looting: 'More drops per kill.', sweeping_edge: 'Hits the whole pile at once.', unbreaking: R.unbreaking, mending: 'Repairs itself from the farm XP.' }),
        L('pvp', 'Pushy (PvP)', 'Keeps enemies away — fun for PvP, annoying in farms.',
          { sharpness: 5, knockback: 2, fire_aspect: 2, unbreaking: 3, mending: 1 },
          { sharpness: 'More damage.', knockback: 'Pushes targets back.', fire_aspect: 'Burn damage over time.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'axe', name: 'Axe', group: 'melee', materials: TOOL, defaultMaterial: 'diamond',
      enchants: ['efficiency', 'fortune', 'silk_touch', 'sharpness', 'smite', 'bane_of_arthropods'].concat(BASIC),
      anvilOnly: ['sharpness', 'smite', 'bane_of_arthropods'],
      loadouts: [
        L('lumber', 'Lumberjack', 'Chops trees fast and lasts forever.',
          { efficiency: 5, unbreaking: 3, mending: 1 },
          { efficiency: R.efficiency, unbreaking: R.unbreaking, mending: R.mending }),
        L('battle', 'Battle axe', 'Axes hit hard and disable shields. Sharpness is anvil-only on axes.',
          { sharpness: 5, efficiency: 5, unbreaking: 3, mending: 1 },
          { sharpness: 'Big damage boost (only via books).', efficiency: 'Still a great wood tool.', unbreaking: R.unbreaking, mending: R.mending }),
        L('silk', 'Silk Touch', 'For melons, mushroom blocks, bookshelves and the like.',
          { efficiency: 5, silk_touch: 1, unbreaking: 3, mending: 1 },
          { efficiency: R.efficiency, silk_touch: R.silk, unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'mace', name: 'Mace', group: 'melee', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['density', 'breach', 'smite', 'bane_of_arthropods', 'wind_burst', 'fire_aspect'].concat(BASIC),
      loadouts: [
        L('smash', 'Smash', 'Maximum fall damage plus chain-jumping with Wind Burst.',
          { density: 5, wind_burst: 3, fire_aspect: 2, unbreaking: 3, mending: 1 },
          { density: 'More smash damage per block fallen.', wind_burst: 'Launches you back up for repeat smashes (from trial chamber vaults).', fire_aspect: 'Burn damage.', unbreaking: R.unbreaking, mending: R.mending }),
        L('breach', 'Armor breaker', 'Better against armored players and mobs.',
          { breach: 4, wind_burst: 3, fire_aspect: 2, unbreaking: 3, mending: 1 },
          { breach: 'Ignores part of the target’s armor.', wind_burst: 'Bounce back up after a hit.', fire_aspect: 'Burn damage.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'spear', name: 'Spear', group: 'melee', materials: TOOL, defaultMaterial: 'diamond', since: '1.21.11',
      enchants: ['sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'lunge'].concat(BASIC),
      loadouts: [
        L('best', 'Best overall', 'Damage, drops and the Lunge dash.',
          { sharpness: 5, looting: 3, fire_aspect: 2, lunge: 3, unbreaking: 3, mending: 1 },
          { sharpness: 'More damage on every jab.', looting: 'More drops.', fire_aspect: 'Burn damage.', lunge: 'Dash forward when you jab (costs hunger).', unbreaking: R.unbreaking, mending: R.mending }),
        L('joust', 'Jouster', 'Mounted charges that send enemies flying.',
          { sharpness: 5, knockback: 2, lunge: 3, unbreaking: 3, mending: 1 },
          { sharpness: 'More damage.', knockback: 'Pushes targets away.', lunge: 'Closes distance quickly.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'pickaxe', name: 'Pickaxe', group: 'tools', materials: TOOL, defaultMaterial: 'diamond',
      enchants: DIG.concat(BASIC),
      loadouts: [
        L('fortune', 'Fortune', 'For mining ores: up to ~2.2× diamonds on average.',
          { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
          { efficiency: R.efficiency, fortune: R.fortune, unbreaking: R.unbreaking, mending: R.mending }),
        L('silk', 'Silk Touch', 'Keep a second pick for ores you want as blocks, glass, ice, spawners-adjacent blocks.',
          { efficiency: 5, silk_touch: 1, unbreaking: 3, mending: 1 },
          { efficiency: R.efficiency, silk_touch: R.silk, unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'shovel', name: 'Shovel', group: 'tools', materials: TOOL, defaultMaterial: 'diamond',
      enchants: DIG.concat(BASIC),
      loadouts: [
        L('dig', 'Digger', 'Terraforming workhorse.',
          { efficiency: 5, unbreaking: 3, mending: 1 },
          { efficiency: 'Insta-mines dirt, sand and gravel.', unbreaking: R.unbreaking, mending: R.mending }),
        L('silk', 'Silk Touch', 'Pick up grass blocks, mycelium, snow and clay blocks.',
          { efficiency: 5, silk_touch: 1, unbreaking: 3, mending: 1 },
          { efficiency: 'Insta-mines dirt, sand and gravel.', silk_touch: R.silk, unbreaking: R.unbreaking, mending: R.mending }),
        L('fortune', 'Flint', 'Fortune III gravel always drops flint.',
          { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
          { efficiency: 'Fast digging.', fortune: 'Gravel drops flint every time at Fortune III.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'hoe', name: 'Hoe', group: 'tools', materials: TOOL, defaultMaterial: 'diamond',
      enchants: DIG.concat(BASIC),
      loadouts: [
        L('farm', 'Farmer', 'More crops, seeds and saplings.',
          { fortune: 3, efficiency: 5, unbreaking: 3, mending: 1 },
          { fortune: 'More crops, seeds and sapling/apple drops from leaves.', efficiency: 'Breaks leaves, hay, sculk, moss instantly.', unbreaking: R.unbreaking, mending: R.mending }),
        L('silk', 'Silk Touch', 'Collect leaves, sculk blocks, moss and nylium.',
          { silk_touch: 1, efficiency: 5, unbreaking: 3, mending: 1 },
          { silk_touch: R.silk, efficiency: 'Fast breaking.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'shears', name: 'Shears', group: 'tools', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['efficiency'].concat(BASIC),
      loadouts: [
        L('best', 'Best', 'Faster wool and leaves.',
          { efficiency: 5, unbreaking: 3, mending: 1 },
          { efficiency: 'Cuts wool and leaves faster.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'brush', name: 'Brush', group: 'tools', materials: ['plain'], defaultMaterial: 'plain',
      enchants: BASIC,
      loadouts: [L('best', 'Best', 'Only durability enchants apply.', { unbreaking: 3, mending: 1 }, { unbreaking: R.unbreaking, mending: R.mending })]
    },
    {
      id: 'bow', name: 'Bow', group: 'ranged', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['power', 'punch', 'flame', 'infinity'].concat(BASIC),
      loadouts: [
        L('mending', 'Mending', 'Never breaks; you carry arrows (and can use tipped ones).',
          { power: 5, punch: 2, flame: 1, unbreaking: 3, mending: 1 },
          { power: 'More arrow damage.', punch: 'Knocks targets back.', flame: 'Sets targets on fire.', unbreaking: R.unbreaking, mending: R.mending_bow }),
        L('infinity', 'Infinity', 'One arrow forever; bow eventually breaks.',
          { power: 5, punch: 2, flame: 1, unbreaking: 3, infinity: 1 },
          { power: 'More arrow damage.', punch: 'Knocks targets back.', flame: 'Sets targets on fire.', unbreaking: 'Lasts much longer since it can’t self-repair.', infinity: 'A single normal arrow is never used up.' })
      ]
    },
    {
      id: 'crossbow', name: 'Crossbow', group: 'ranged', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['multishot', 'piercing', 'quick_charge'].concat(BASIC),
      loadouts: [
        L('multishot', 'Multishot', 'Crowd control and firework rockets ×3.',
          { multishot: 1, quick_charge: 3, unbreaking: 3, mending: 1 },
          { multishot: 'Fires three projectiles for one.', quick_charge: 'Reloads much faster.', unbreaking: R.unbreaking, mending: R.mending }),
        L('piercing', 'Piercing', 'Arrows go through lines of mobs and shields.',
          { piercing: 4, quick_charge: 3, unbreaking: 3, mending: 1 },
          { piercing: 'Passes through up to 5 mobs; arrows can be picked up again.', quick_charge: 'Reloads much faster.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'trident', name: 'Trident', group: 'ranged', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['impaling', 'loyalty', 'riptide', 'channeling'].concat(BASIC),
      loadouts: [
        L('loyalty', 'Loyalty + Channeling', 'Throwable weapon that comes back; lightning in storms.',
          { loyalty: 3, channeling: 1, impaling: 5, unbreaking: 3, mending: 1 },
          { loyalty: 'Returns to you after a throw.', channeling: 'Summons lightning on hit during thunderstorms (charged creepers!).', impaling: 'Big damage to aquatic mobs (and anything wet in Bedrock only).', unbreaking: R.unbreaking, mending: R.mending }),
        L('riptide', 'Riptide', 'Travel tool: launch yourself in water or rain.',
          { riptide: 3, impaling: 5, unbreaking: 3, mending: 1 },
          { riptide: 'Launches you; combine with elytra in rain.', impaling: 'Melee damage against aquatic mobs.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'fishing_rod', name: 'Fishing Rod', group: 'ranged', materials: ['plain'], defaultMaterial: 'plain',
      enchants: ['luck_of_the_sea', 'lure'].concat(BASIC),
      loadouts: [
        L('best', 'Best', 'Faster bites and better treasure.',
          { luck_of_the_sea: 3, lure: 3, unbreaking: 3, mending: 1 },
          { luck_of_the_sea: 'More treasure (books, saddles, name tags).', lure: 'Fish bite sooner.', unbreaking: R.unbreaking, mending: 'Fishing gives XP, so it repairs itself.' })
      ]
    },
    {
      id: 'helmet', name: 'Helmet', group: 'armor', materials: ARMOR.concat(['turtle']), defaultMaterial: 'diamond',
      enchants: PROT.concat(['respiration', 'aqua_affinity']).concat(WEAR),
      loadouts: [
        L('best', 'Best overall', 'Protection plus the two underwater helpers.',
          { protection: 4, respiration: 3, aqua_affinity: 1, unbreaking: 3, mending: 1 },
          { protection: R.protection, respiration: 'Breathe ~45 s longer underwater.', aqua_affinity: 'Mine at normal speed underwater.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'chestplate', name: 'Chestplate', group: 'armor', materials: ARMOR, defaultMaterial: 'diamond',
      enchants: PROT.concat(WEAR),
      loadouts: [
        L('best', 'Best overall', 'Simple and strong.',
          { protection: 4, unbreaking: 3, mending: 1 },
          { protection: R.protection, unbreaking: R.unbreaking, mending: R.mending }),
        L('thorns', 'Thorns', 'Hurts attackers, but costs extra durability (Mending covers it).',
          { protection: 4, thorns: 3, unbreaking: 3, mending: 1 },
          { protection: R.protection, thorns: 'Damages mobs that hit you.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'leggings', name: 'Leggings', group: 'armor', materials: ARMOR, defaultMaterial: 'diamond',
      enchants: PROT.concat(['swift_sneak']).concat(WEAR),
      loadouts: [
        L('best', 'Best overall', 'Swift Sneak comes from Ancient City chests only — not librarians.',
          { protection: 4, swift_sneak: 3, unbreaking: 3, mending: 1 },
          { protection: R.protection, swift_sneak: 'Sneak almost at walking speed.', unbreaking: R.unbreaking, mending: R.mending }),
        L('simple', 'No Swift Sneak', 'Everything a librarian can sell.',
          { protection: 4, unbreaking: 3, mending: 1 },
          { protection: R.protection, unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'boots', name: 'Boots', group: 'armor', materials: ARMOR, defaultMaterial: 'diamond',
      enchants: PROT.concat(['feather_falling', 'depth_strider', 'frost_walker', 'soul_speed']).concat(WEAR),
      loadouts: [
        L('best', 'Best overall', 'Depth Strider for water travel. Soul Speed comes from bastion chests / piglin bartering.',
          { protection: 4, feather_falling: 4, depth_strider: 3, soul_speed: 3, unbreaking: 3, mending: 1 },
          { protection: R.protection, feather_falling: 'Cuts fall damage massively.', depth_strider: 'Walk underwater at land speed.', soul_speed: 'Run fast on soul sand/soil.', unbreaking: R.unbreaking, mending: R.mending }),
        L('frost', 'Frost Walker', 'Walk across water on ice instead of swimming.',
          { protection: 4, feather_falling: 4, frost_walker: 2, soul_speed: 3, unbreaking: 3, mending: 1 },
          { protection: R.protection, feather_falling: 'Cuts fall damage massively.', frost_walker: 'Freezes water under you; immune to magma blocks.', soul_speed: 'Run fast on soul sand/soil.', unbreaking: R.unbreaking, mending: R.mending }),
        L('simple', 'Librarian only', 'Everything a librarian can sell.',
          { protection: 4, feather_falling: 4, depth_strider: 3, unbreaking: 3, mending: 1 },
          { protection: R.protection, feather_falling: 'Cuts fall damage massively.', depth_strider: 'Walk underwater at land speed.', unbreaking: R.unbreaking, mending: R.mending })
      ]
    },
    {
      id: 'elytra', name: 'Elytra', group: 'armor', materials: ['plain'], defaultMaterial: 'plain',
      enchants: WEAR,
      loadouts: [L('best', 'Best', 'Mending is the only way to keep an elytra without phantom membranes.', { unbreaking: 3, mending: 1 }, { unbreaking: 'Flies ~4× longer between repairs.', mending: R.mending })]
    },
    {
      id: 'shield', name: 'Shield', group: 'other', materials: ['plain'], defaultMaterial: 'plain',
      enchants: BASIC,
      loadouts: [L('best', 'Best', 'Only durability enchants apply.', { unbreaking: 3, mending: 1 }, { unbreaking: R.unbreaking, mending: R.mending })]
    },
    {
      id: 'flint_and_steel', name: 'Flint and Steel', group: 'other', materials: ['plain'], defaultMaterial: 'plain',
      enchants: BASIC,
      loadouts: [L('best', 'Best', 'Only durability enchants apply.', { unbreaking: 3, mending: 1 }, { unbreaking: R.unbreaking, mending: R.mending })]
    },
    {
      id: 'carrot_on_a_stick', name: 'Carrot on a Stick', group: 'other', materials: ['plain'], defaultMaterial: 'plain',
      enchants: BASIC,
      loadouts: [L('best', 'Best', 'Only durability enchants apply.', { unbreaking: 3, mending: 1 }, { unbreaking: R.unbreaking, mending: R.mending })]
    },
    {
      id: 'warped_fungus_on_a_stick', name: 'Warped Fungus on a Stick', short: 'Fungus Stick', group: 'other', materials: ['plain'], defaultMaterial: 'plain',
      enchants: BASIC,
      loadouts: [L('best', 'Best', 'Only durability enchants apply.', { unbreaking: 3, mending: 1 }, { unbreaking: R.unbreaking, mending: R.mending })]
    }
  ];

})();
