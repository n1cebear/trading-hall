window.TH = window.TH || {};
TH.data = TH.data || {};

/**
 * Potion brewing, Minecraft Java Edition 26.3 (default vanilla brewing recipes; 26.3 made them data-driven).
 * Everything the Potion Brewing tool shows comes from these tables; js/modules/potions-engine.js turns them into a graph.
 *
 * Sources: minecraft.wiki (Brewing, Potion, Effect, Effect colors, Splash / Lingering Potion, Tipped Arrow, Brewing Stand,
 * checked Oct 2026) and the 26.3 language file. The mix table follows the order of the game's own brewing setup
 * (PotionBrewing: addContainerRecipe / addMix / addStartMix); addStartMix(item, potion) means BOTH
 *   Water Bottle + item -> Mundane Potion   and   Awkward Potion + item -> potion.
 *
 *   potions   registry order (= creative inventory order): id, base (the name family), v ('n' | 'long' | 'strong'),
 *             effects [[effect, ticks, amplifier]] (instant effects: ticks 1), cat, tag (variant pill)
 *   effects   colour (the game's effect colour, decimal in the wiki table), kind (good / bad / neutral), instant
 *   mixes     [from, ingredient, to] potion mixes, kept for every bottle form (drinkable, splash, lingering)
 *   starts    [ingredient, potion] start mixes (see above)
 *   containers [from item, ingredient, to item] (gunpowder makes splash, dragon's breath makes lingering)
 *   forms     how each bottle form scales durations (lingering 1/4, tipped arrow 1/8)
 */
TH.data.potions = {
  version: '26.3',
  BREW_TICKS: 400,          // 20 s per brewing operation, all three bottles at once
  FUEL_PER_POWDER: 20,      // one blaze powder = 20 brewing operations
  SLOTS: 3,                 // bottle slots in a brewing stand
  NO_EFFECT_COLOR: 0x385DC6, // water, awkward, mundane, thick (and the item model's default tint, -13083194)
  ARROWS_PER_POTION: 8,     // 8 arrows around 1 lingering potion = 8 tipped arrows

  forms: [
    { id: 'potion', item: 'potion', scale: 1, instant: 1, tex: 'item/potion', liquid: 'item/potion_overlay', label: 'Drinkable' },
    { id: 'splash', item: 'splash_potion', scale: 1, instant: 1, tex: 'item/splash_potion', liquid: 'item/potion_overlay', label: 'Splash' },
    { id: 'lingering', item: 'lingering_potion', scale: 0.25, instant: 0.5, tex: 'item/lingering_potion', liquid: 'item/potion_overlay', label: 'Lingering' },
    { id: 'arrow', item: 'tipped_arrow', scale: 0.125, instant: 1, tex: 'item/tipped_arrow_base', liquid: 'item/tipped_arrow_head', label: 'Tipped arrow' },
  ],

  // effect colours from minecraft.wiki "Effect colors" (Java); kind from the wiki's Effect table
  effects: {
    speed: { color: 0x33EBFF, kind: 'good' },
    slowness: { color: 0x8BAFE0, kind: 'bad' },
    strength: { color: 0xFFC700, kind: 'good' },
    instant_health: { color: 0xF82423, kind: 'good', instant: true },
    instant_damage: { color: 0xA9656A, kind: 'bad', instant: true },
    jump_boost: { color: 0xFDFF84, kind: 'good' },
    regeneration: { color: 0xCD5CAB, kind: 'good' },
    resistance: { color: 0x9146F0, kind: 'good' },
    fire_resistance: { color: 0xFF9900, kind: 'good' },
    water_breathing: { color: 0x98DAC0, kind: 'good' },
    invisibility: { color: 0xF6F6F6, kind: 'good' },
    night_vision: { color: 0xC2FF66, kind: 'good' },
    weakness: { color: 0x484D48, kind: 'bad' },
    poison: { color: 0x87A363, kind: 'bad' },
    luck: { color: 0x59C106, kind: 'good' },
    slow_falling: { color: 0xF3CFB9, kind: 'good' },
    wind_charged: { color: 0xBDC9FF, kind: 'bad' },
    weaving: { color: 0x78695A, kind: 'bad' },
    oozing: { color: 0x99FFA3, kind: 'bad' },
    infested: { color: 0x8C9B8C, kind: 'bad' },
  },

  // registry order = creative inventory order
  potions: [
    { id: 'water', base: 'water', v: 'n', effects: [], cat: 'base', ing: 'Filled from water' },
    { id: 'mundane', base: 'mundane', v: 'n', effects: [], cat: 'base' },
    { id: 'thick', base: 'thick', v: 'n', effects: [], cat: 'base' },
    { id: 'awkward', base: 'awkward', v: 'n', effects: [], cat: 'base' },
    { id: 'night_vision', base: 'night_vision', v: 'n', effects: [['night_vision', 3600, 0]], cat: 'good' },
    { id: 'long_night_vision', base: 'night_vision', v: 'long', effects: [['night_vision', 9600, 0]], cat: 'good' },
    { id: 'invisibility', base: 'invisibility', v: 'n', effects: [['invisibility', 3600, 0]], cat: 'good' },
    { id: 'long_invisibility', base: 'invisibility', v: 'long', effects: [['invisibility', 9600, 0]], cat: 'good' },
    { id: 'leaping', base: 'leaping', v: 'n', effects: [['jump_boost', 3600, 0]], cat: 'good' },
    { id: 'long_leaping', base: 'leaping', v: 'long', effects: [['jump_boost', 9600, 0]], cat: 'good' },
    { id: 'strong_leaping', base: 'leaping', v: 'strong', effects: [['jump_boost', 1800, 1]], cat: 'good' },
    { id: 'fire_resistance', base: 'fire_resistance', v: 'n', effects: [['fire_resistance', 3600, 0]], cat: 'good' },
    { id: 'long_fire_resistance', base: 'fire_resistance', v: 'long', effects: [['fire_resistance', 9600, 0]], cat: 'good' },
    { id: 'swiftness', base: 'swiftness', v: 'n', effects: [['speed', 3600, 0]], cat: 'good' },
    { id: 'long_swiftness', base: 'swiftness', v: 'long', effects: [['speed', 9600, 0]], cat: 'good' },
    { id: 'strong_swiftness', base: 'swiftness', v: 'strong', effects: [['speed', 1800, 1]], cat: 'good' },
    { id: 'slowness', base: 'slowness', v: 'n', effects: [['slowness', 1800, 0]], cat: 'bad' },
    { id: 'long_slowness', base: 'slowness', v: 'long', effects: [['slowness', 4800, 0]], cat: 'bad' },
    { id: 'strong_slowness', base: 'slowness', v: 'strong', effects: [['slowness', 400, 3]], cat: 'bad', tag: 'IV' },
    { id: 'turtle_master', base: 'turtle_master', v: 'n', effects: [['slowness', 400, 3], ['resistance', 400, 2]], cat: 'mixed' },
    { id: 'long_turtle_master', base: 'turtle_master', v: 'long', effects: [['slowness', 800, 3], ['resistance', 800, 2]], cat: 'mixed' },
    { id: 'strong_turtle_master', base: 'turtle_master', v: 'strong', effects: [['slowness', 400, 5], ['resistance', 400, 3]], cat: 'mixed' },
    { id: 'water_breathing', base: 'water_breathing', v: 'n', effects: [['water_breathing', 3600, 0]], cat: 'good' },
    { id: 'long_water_breathing', base: 'water_breathing', v: 'long', effects: [['water_breathing', 9600, 0]], cat: 'good' },
    { id: 'healing', base: 'healing', v: 'n', effects: [['instant_health', 1, 0]], cat: 'good' },
    { id: 'strong_healing', base: 'healing', v: 'strong', effects: [['instant_health', 1, 1]], cat: 'good' },
    { id: 'harming', base: 'harming', v: 'n', effects: [['instant_damage', 1, 0]], cat: 'bad' },
    { id: 'strong_harming', base: 'harming', v: 'strong', effects: [['instant_damage', 1, 1]], cat: 'bad' },
    { id: 'poison', base: 'poison', v: 'n', effects: [['poison', 900, 0]], cat: 'bad' },
    { id: 'long_poison', base: 'poison', v: 'long', effects: [['poison', 1800, 0]], cat: 'bad' },
    { id: 'strong_poison', base: 'poison', v: 'strong', effects: [['poison', 432, 1]], cat: 'bad' },
    { id: 'regeneration', base: 'regeneration', v: 'n', effects: [['regeneration', 900, 0]], cat: 'good' },
    { id: 'long_regeneration', base: 'regeneration', v: 'long', effects: [['regeneration', 1800, 0]], cat: 'good' },
    { id: 'strong_regeneration', base: 'regeneration', v: 'strong', effects: [['regeneration', 450, 1]], cat: 'good' },
    { id: 'strength', base: 'strength', v: 'n', effects: [['strength', 3600, 0]], cat: 'good' },
    { id: 'long_strength', base: 'strength', v: 'long', effects: [['strength', 9600, 0]], cat: 'good' },
    { id: 'strong_strength', base: 'strength', v: 'strong', effects: [['strength', 1800, 1]], cat: 'good' },
    { id: 'weakness', base: 'weakness', v: 'n', effects: [['weakness', 1800, 0]], cat: 'bad' },
    { id: 'long_weakness', base: 'weakness', v: 'long', effects: [['weakness', 4800, 0]], cat: 'bad' },
    { id: 'luck', base: 'luck', v: 'n', effects: [['luck', 6000, 0]], cat: 'good', unbrewable: true },
    { id: 'slow_falling', base: 'slow_falling', v: 'n', effects: [['slow_falling', 1800, 0]], cat: 'good' },
    { id: 'long_slow_falling', base: 'slow_falling', v: 'long', effects: [['slow_falling', 4800, 0]], cat: 'good' },
    { id: 'wind_charged', base: 'wind_charged', v: 'n', effects: [['wind_charged', 3600, 0]], cat: 'bad' },
    { id: 'weaving', base: 'weaving', v: 'n', effects: [['weaving', 3600, 0]], cat: 'bad' },
    { id: 'oozing', base: 'oozing', v: 'n', effects: [['oozing', 3600, 0]], cat: 'bad' },
    { id: 'infested', base: 'infested', v: 'n', effects: [['infested', 3600, 0]], cat: 'bad' },
  ],

  // potion mixes (the game's order); every one keeps the bottle form
  mixes: [
    ['water', 'glowstone_dust', 'thick'],
    ['water', 'redstone', 'mundane'],
    ['water', 'nether_wart', 'awkward'],
    ['awkward', 'golden_carrot', 'night_vision'],
    ['night_vision', 'redstone', 'long_night_vision'],
    ['night_vision', 'fermented_spider_eye', 'invisibility'],
    ['long_night_vision', 'fermented_spider_eye', 'long_invisibility'],
    ['invisibility', 'redstone', 'long_invisibility'],
    ['fire_resistance', 'redstone', 'long_fire_resistance'],
    ['leaping', 'redstone', 'long_leaping'],
    ['leaping', 'glowstone_dust', 'strong_leaping'],
    ['leaping', 'fermented_spider_eye', 'slowness'],
    ['long_leaping', 'fermented_spider_eye', 'long_slowness'],
    ['slowness', 'redstone', 'long_slowness'],
    ['slowness', 'glowstone_dust', 'strong_slowness'],
    ['awkward', 'turtle_helmet', 'turtle_master'],
    ['turtle_master', 'redstone', 'long_turtle_master'],
    ['turtle_master', 'glowstone_dust', 'strong_turtle_master'],
    ['swiftness', 'fermented_spider_eye', 'slowness'],
    ['long_swiftness', 'fermented_spider_eye', 'long_slowness'],
    ['swiftness', 'redstone', 'long_swiftness'],
    ['swiftness', 'glowstone_dust', 'strong_swiftness'],
    ['awkward', 'pufferfish', 'water_breathing'],
    ['water_breathing', 'redstone', 'long_water_breathing'],
    ['healing', 'glowstone_dust', 'strong_healing'],
    ['healing', 'fermented_spider_eye', 'harming'],
    ['strong_healing', 'fermented_spider_eye', 'strong_harming'],
    ['harming', 'glowstone_dust', 'strong_harming'],
    ['poison', 'fermented_spider_eye', 'harming'],
    ['long_poison', 'fermented_spider_eye', 'harming'],
    ['strong_poison', 'fermented_spider_eye', 'strong_harming'],
    ['poison', 'redstone', 'long_poison'],
    ['poison', 'glowstone_dust', 'strong_poison'],
    ['regeneration', 'redstone', 'long_regeneration'],
    ['regeneration', 'glowstone_dust', 'strong_regeneration'],
    ['strength', 'redstone', 'long_strength'],
    ['strength', 'glowstone_dust', 'strong_strength'],
    ['water', 'fermented_spider_eye', 'weakness'],
    ['weakness', 'redstone', 'long_weakness'],
    ['awkward', 'phantom_membrane', 'slow_falling'],
    ['slow_falling', 'redstone', 'long_slow_falling'],
  ],
  // start mixes: Water + item -> Mundane, Awkward + item -> potion
  starts: [
    ['breeze_rod', 'wind_charged'],
    ['slime_block', 'oozing'],
    ['stone', 'infested'],
    ['cobweb', 'weaving'],
    ['magma_cream', 'fire_resistance'],
    ['rabbit_foot', 'leaping'],
    ['sugar', 'swiftness'],
    ['glistering_melon_slice', 'healing'],
    ['spider_eye', 'poison'],
    ['ghast_tear', 'regeneration'],
    ['blaze_powder', 'strength'],
  ],
  containers: [
    ['potion', 'gunpowder', 'splash'],
    ['splash', 'dragon_breath', 'lingering'],
  ],

  /**
   * Brewing ingredients. tex = inventory texture, src = how you mostly get it (mob | farm | craft | mine | structure | fish),
   * where = a short line, rare = 1 (everyday) .. 5 (hard to get), used only to break ties between equally short recipes.
   * role: 'base' (from a Water Bottle), 'effect' (on an Awkward Potion), 'mod' (changes an existing potion), 'form'.
   */
  ingredients: {
    nether_wart: { tex: 'item/nether_wart', src: 'farm', rare: 1, role: 'base', where: 'Nether fortresses and bastions. Grows on soul sand, so farm it once and never run out.' },
    redstone: { tex: 'item/redstone', src: 'mine', rare: 1, role: 'mod', where: 'Redstone ore, witches, cleric villagers.' },
    glowstone_dust: { tex: 'item/glowstone_dust', src: 'mine', rare: 1, role: 'mod', where: 'Break glowstone in the Nether (2 to 4 dust each), witches, cleric villagers.' },
    fermented_spider_eye: { tex: 'item/fermented_spider_eye', src: 'craft', rare: 2, role: 'mod', where: 'Crafted: spider eye, brown mushroom and sugar.' },
    gunpowder: { tex: 'item/gunpowder', src: 'mob', rare: 1, role: 'form', where: 'Creepers, ghasts and witches; desert pyramid chests.' },
    dragon_breath: { tex: 'item/dragon_breath', src: 'mob', rare: 5, role: 'form', where: 'Catch the Ender Dragon\'s breath cloud in a glass bottle (also from the dragon fireball cloud).' },
    sugar: { tex: 'item/sugar', src: 'farm', rare: 1, role: 'effect', where: 'Crafted from sugar cane (or a honey bottle).' },
    rabbit_foot: { tex: 'item/rabbit_foot', src: 'mob', rare: 3, role: 'effect', where: 'A rare drop from rabbits.' },
    glistering_melon_slice: { tex: 'item/glistering_melon_slice', src: 'craft', rare: 2, role: 'effect', where: 'Crafted: a melon slice ringed by 8 gold nuggets.' },
    spider_eye: { tex: 'item/spider_eye', src: 'mob', rare: 1, role: 'effect', where: 'Spiders, cave spiders and witches.' },
    magma_cream: { tex: 'item/magma_cream', src: 'mob', rare: 2, role: 'effect', where: 'Magma cubes, or craft a slimeball with blaze powder.' },
    blaze_powder: { tex: 'item/blaze_powder', src: 'mob', rare: 2, role: 'effect', where: 'Crafted from a blaze rod (blazes in Nether fortresses). Also the stand\'s fuel.' },
    ghast_tear: { tex: 'item/ghast_tear', src: 'mob', rare: 4, role: 'effect', where: 'Ghasts in the Nether. Kill them over solid ground or the tear burns in lava.' },
    golden_carrot: { tex: 'item/golden_carrot', src: 'craft', rare: 2, role: 'effect', where: 'Crafted: a carrot ringed by 8 gold nuggets. Farmer villagers sell them too.' },
    pufferfish: { tex: 'item/pufferfish', src: 'fish', rare: 2, role: 'effect', where: 'Fishing, or pufferfish in warm oceans.' },
    turtle_helmet: { tex: 'item/turtle_helmet', src: 'craft', rare: 4, role: 'effect', where: 'Crafted from 5 turtle scutes, dropped when baby turtles grow up.' },
    phantom_membrane: { tex: 'item/phantom_membrane', src: 'mob', rare: 3, role: 'effect', where: 'Phantoms, which come after you skip sleep for a few nights.' },
    breeze_rod: { tex: 'item/breeze_rod', src: 'mob', rare: 4, role: 'effect', where: 'Breezes in trial chambers.' },
    stone: { tex: 'block/stone', src: 'mine', rare: 1, role: 'effect', block: true, where: 'Smelt cobblestone, or mine stone with Silk Touch.' },
    cobweb: { tex: 'block/cobweb', src: 'structure', rare: 2, role: 'effect', block: true, where: 'Mineshafts, strongholds and trial chambers; cut with shears or Silk Touch.' },
    slime_block: { tex: 'block/slime_block', src: 'craft', rare: 3, role: 'effect', block: true, where: 'Crafted from 9 slimeballs (slimes in swamps and slime chunks).' },
  },
  // the bottle itself and other things a plan needs
  extras: {
    glass_bottle: { tex: 'item/glass_bottle', where: 'Crafted: 3 glass in a V = 3 bottles. Fill at a water source or a water cauldron.' },
    arrow: { tex: 'item/arrow', where: 'Fletchers, skeletons, or craft flint, a stick and a feather (4 arrows).' },
    brewing_stand: { tex: 'item/brewing_stand', where: 'Crafted: 1 blaze rod over 3 cobblestone (or blackstone / cobbled deepslate).' },
  },

  /**
   * How to make or find each ingredient, for the ingredient tooltips (minecraft.wiki crafting templates, Oct 2026).
   * recipes: method 'crafting' with a 3x3 grid (row by row, null = empty) or shapeless inputs, or 'smelting'; out = count.
   * obtain: an icon for where it comes from (a spawn egg = that mob drops it, a tool = gather it with that tool).
   * parts: textures of things that only appear inside these pictures.
   */
  recipes: {
    fermented_spider_eye: [{ method: 'crafting', shapeless: ['spider_eye', 'brown_mushroom', 'sugar'], out: 1 }],
    glistering_melon_slice: [{ method: 'crafting', grid: ['gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'melon_slice', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget'], out: 1 }],
    golden_carrot: [{ method: 'crafting', grid: ['gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'carrot', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget'], out: 1 }],
    magma_cream: [{ method: 'crafting', shapeless: ['blaze_powder', 'slime_ball'], out: 1 }],
    blaze_powder: [{ method: 'crafting', shapeless: ['blaze_rod'], out: 2 }],
    sugar: [{ method: 'crafting', shapeless: ['sugar_cane'], out: 1 }, { method: 'crafting', shapeless: ['honey_bottle'], out: 3 }],
    glass_bottle: [{ method: 'crafting', grid: [null, null, null, 'glass', null, 'glass', null, 'glass', null], out: 3 }],
    turtle_helmet: [{ method: 'crafting', grid: [null, null, null, 'turtle_scute', 'turtle_scute', 'turtle_scute', 'turtle_scute', null, 'turtle_scute'], out: 1 }],
    slime_block: [{ method: 'crafting', grid: ['slime_ball', 'slime_ball', 'slime_ball', 'slime_ball', 'slime_ball', 'slime_ball', 'slime_ball', 'slime_ball', 'slime_ball'], out: 1 }],
    stone: [{ method: 'smelting', in: 'cobblestone', out: 1 }],
    arrow: [{ method: 'crafting', grid: [null, 'flint', null, null, 'stick', null, null, 'feather', null], out: 4 }],
    brewing_stand: [{ method: 'crafting', grid: [null, 'blaze_rod', null, 'cobblestone', 'cobblestone', 'cobblestone', null, null, null], out: 1 }],
  },
  obtain: {
    nether_wart: 'block/soul_sand', redstone: 'block/redstone_ore', glowstone_dust: 'block/glowstone', gunpowder: 'item/creeper_spawn_egg',
    dragon_breath: 'item/ender_dragon_spawn_egg', rabbit_foot: 'item/rabbit_spawn_egg', spider_eye: 'item/spider_spawn_egg', ghast_tear: 'item/ghast_spawn_egg',
    pufferfish: 'item/fishing_rod', phantom_membrane: 'item/phantom_spawn_egg', breeze_rod: 'item/breeze_spawn_egg', cobweb: 'item/shears',
    magma_cream: 'item/magma_cube_spawn_egg', blaze_powder: 'item/blaze_spawn_egg', turtle_helmet: 'item/turtle_spawn_egg', slime_block: 'item/slime_spawn_egg',
  },
  parts: {
    spider_eye: 'item/spider_eye', brown_mushroom: 'block/brown_mushroom', sugar: 'item/sugar', gold_nugget: 'item/gold_nugget', melon_slice: 'item/melon_slice',
    carrot: 'item/carrot', blaze_powder: 'item/blaze_powder', slime_ball: 'item/slime_ball', blaze_rod: 'item/blaze_rod', sugar_cane: 'item/sugar_cane',
    honey_bottle: 'item/honey_bottle', glass: 'block/glass', turtle_scute: 'item/turtle_scute', cobblestone: 'block/cobblestone', flint: 'item/flint',
    stick: 'item/stick', feather: 'item/feather', crafting: 'block/crafting_table_front', smelting: 'block/furnace_front',
  },

  /**
   * What each effect does (Java), level = amplifier + 1. Values from the wiki's Potion / Effect pages.
   * Short English; the tool shows them next to the effect icon.
   */
  effectInfo: {
    speed: (l) => `+${20 * l}% walking speed`,
    slowness: (l) => `-${Math.min(100, 15 * l)}% walking speed`,
    strength: (l) => `+${3 * l} melee attack damage`,
    weakness: () => '-4 melee attack damage',
    instant_health: (l) => `Heals ${4 * 2 ** (l - 1)} HP. Hurts undead mobs instead`,
    instant_damage: (l) => `Deals ${6 * 2 ** (l - 1)} HP of damage. Heals undead mobs instead`,
    jump_boost: (l) => (l >= 2 ? 'Jump about 2.5 blocks high, 2 blocks less fall damage' : 'Jump about 1.8 blocks high, 1 block less fall damage'),
    regeneration: (l) => `1 HP every ${l >= 2 ? '1.25' : '2.5'} s. Undead mobs are immune`,
    poison: (l) => `1 HP every ${l >= 2 ? '0.6' : '1.25'} s, never below 1 HP. Undead mobs are immune`,
    resistance: (l) => `-${Math.min(100, 20 * l)}% damage taken`,
    fire_resistance: () => 'No damage from fire, lava, magma blocks or blaze fireballs',
    water_breathing: () => 'Your air does not run out underwater',
    invisibility: () => 'You disappear; armor and held items still show',
    night_vision: () => 'See everything at full brightness, underwater too',
    luck: () => '+1 Luck (better fishing and chest loot)',
    slow_falling: () => 'Fall slowly, no fall damage',
    wind_charged: () => 'Bursts out a gust of wind when it dies',
    weaving: () => 'Leaves cobwebs when it dies, moves faster through cobwebs',
    oozing: () => 'Splits into two medium slimes when it dies',
    infested: () => '10% chance to release silverfish when it is hurt',
  },
  // total health over the whole effect, drinkable / splash (minecraft.wiki Potion page)
  totals: {
    regeneration: '18 HP in total', long_regeneration: '36 HP in total', strong_regeneration: '18 HP in total',
    poison: 'up to 36 HP in total', long_poison: 'up to 72 HP in total', strong_poison: 'up to 38 HP in total',
  },

  // other ways to get a potion than brewing it (minecraft.wiki, Java)
  sources: {
    water: ['Piglin bartering (10 in 469 per gold ingot)', 'Fished up as junk'],
    healing: ['Witches drop it if killed while drinking one (8.5%)', 'Abandoned camp secret chests (36%)'],
    strong_healing: ['Two in the brewing stand of every End ship'],
    fire_resistance: ['Witches drop it if killed while drinking one (8.5%)', 'Piglin bartering (8 in 469 per gold ingot)'],
    swiftness: ['Witches drop it if killed while drinking one (8.5%)', 'Abandoned camp secret chests (36%)', 'Trial spawners (5%)'],
    water_breathing: ['Witches drop it if killed while drinking one (8.5%)', 'Buried treasure chests (66.7%)'],
    invisibility: ['Wandering traders drop it if killed while drinking one (8.5%)'],
    long_invisibility: ['Wandering traders sell it for 5 emeralds'],
    regeneration: ['Ancient city chests (36.5%)', 'Trial chamber supply chests (20.4%)', 'Trial spawners (5%, ominous 7%)'],
    strength: ['Trial chamber supply chests (20.4%)', 'Ominous trial spawners (7%)'],
    leaping: ['Abandoned camp secret chests (36%)'],
    night_vision: ['Abandoned camp secret chests (36%)'],
    weakness: ['A splash potion of Weakness waits in every igloo basement'],
    luck: ['Creative inventory and commands only: it cannot be brewed'],
  },
  arrowSources: {
    poison: ['Bogged (50%, player kills)', 'Trial chamber chests and vaults'],
    slowness: ['Strays (50%, player kills)', 'Trial chamber supply chests'],
    strong_slowness: ['Ominous vaults in trial chambers (37.5%)'],
    weakness: ['Parched (50%, player kills)'],
  },
};
