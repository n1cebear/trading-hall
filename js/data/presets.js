window.TH = window.TH || {};
TH.data = TH.data || {};

/**
 * Built-in presets.
 *
 * enchants: id -> 'max' | level | { level, slots: ['label', ...] }
 *   `slots` = one librarian per entry (e.g. Protection IV for helmet, chest, legs).
 *   The special value 'all-librarian' means every librarian-tradeable enchant at max.
 * roles: non-librarian villagers, each with a purpose, a one-word `short` label (shown on hall tiles) and how many you want.
 *   Librarians are derived automatically from the enchant list.
 */
TH.data.presets = [
  {
    id: 'bare',
    name: 'Bare minimum',
    desc: 'Just the seven books every survival world needs. No other villagers.',
    enchants: {
      protection: 4,
      feather_falling: 4,
      efficiency: 5,
      fortune: 3,
      unbreaking: 3,
      mending: 'max',
      sharpness: 5,
    },
    roles: [],
  },
  {
    id: 'blueprint',
    name: 'Essentials',
    desc: 'From your Trading Hall Blueprint sheet: 23 librarian stalls + 16 generator, blacksmith & utility villagers.',
    enchants: {
      // core
      mending: 'max',
      unbreaking: 'max',
      efficiency: 'max',
      fortune: { level: 3, slots: ['Pickaxe', 'Shovel / Axe'] },
      silk_touch: 'max',
      protection: { level: 4, slots: ['Helmet', 'Chestplate', 'Leggings'] },
      sharpness: 'max',
      // added
      infinity: 'max',
      power: 'max',
      punch: 'max',
      flame: 'max',
      looting: 'max',
      sweeping_edge: 'max',
      smite: 'max',
      fire_aspect: 'max',
      aqua_affinity: 'max',
      respiration: 'max',
      feather_falling: 'max',
      depth_strider: 'max',
      riptide: 'max',
    },
    roles: [
      { prof: 'fletcher', purpose: 'Sticks → Emerald', short: 'Sticks', target: 4, group: 'generator', note: '32 sticks → 1 emerald. Fed by log farm.' },
      { prof: 'farmer', purpose: 'Pumpkins / Melons → Emerald', short: 'Pumpkin', target: 2, group: 'generator', note: 'Pumpkins 15 → 1, Melons 4 → 1.' },
      { prof: 'cleric', purpose: 'Rotten Flesh → Emerald', short: 'Flesh', target: 2, group: 'generator', note: '32 flesh → 1 emerald. Zombie farm drops.' },
      { prof: 'mason', purpose: 'Clay / Stone → Emerald', short: 'Clay', target: 2, group: 'generator', note: '20 clay → 1 emerald. Dumps strip-mine junk.' },
      { prof: 'armorer', purpose: 'Iron → Emerald · Diamond armor', short: 'Iron', target: 1, group: 'blacksmith', note: '4 iron → 1 emerald. Master: enchanted diamond armor.' },
      { prof: 'toolsmith', purpose: 'Diamond pickaxe / axe', short: 'Pickaxe', target: 1, group: 'blacksmith', note: 'Renewable diamond tools.' },
      { prof: 'weaponsmith', purpose: 'Diamond sword', short: 'Sword', target: 1, group: 'blacksmith', note: 'Master rolls enchanted swords — buy & disenchant.' },
      { prof: 'farmer', purpose: 'Emerald → Golden Carrot', short: 'Gold carrot', target: 1, group: 'utility', note: 'Best food in the game.' },
      { prof: 'cleric', purpose: 'Emerald → Ender Pearl', short: 'Pearl', target: 1, group: 'utility', note: '5 emeralds → 1 pearl.' },
      { prof: 'cartographer', purpose: 'Explorer maps', short: 'Maps', target: 1, group: 'utility', note: 'Mansions, monuments, trial chambers.' },
    ],
  },
  {
    id: 'generators',
    name: 'Emerald generators',
    desc: 'No books, just the villagers that turn farm output into emeralds.',
    enchants: {},
    roles: [
      { prof: 'fletcher', purpose: 'Sticks → Emerald', short: 'Sticks', target: 4, group: 'generator', note: '32 sticks → 1 emerald. Fed by a tree farm.' },
      { prof: 'farmer', purpose: 'Pumpkins / Melons → Emerald', short: 'Pumpkin', target: 2, group: 'generator', note: 'Pumpkins 15 → 1, Melons 4 → 1.' },
      { prof: 'farmer', purpose: 'Crops → Emerald', short: 'Carrot', target: 1, group: 'generator', note: 'Carrots or potatoes.' },
      { prof: 'cleric', purpose: 'Rotten Flesh → Emerald', short: 'Flesh', target: 2, group: 'generator', note: '32 flesh → 1 emerald. Zombie farm drops.' },
      { prof: 'mason', purpose: 'Clay / Stone → Emerald', short: 'Clay', target: 2, group: 'generator', note: '20 clay → 1 emerald.' },
      { prof: 'shepherd', purpose: 'Wool → Emerald', short: 'Wool', target: 1, group: 'generator', note: 'Novice trade. Sheep farm output.' },
      { prof: 'fisherman', purpose: 'String / Coal → Emerald', short: 'String', target: 1, group: 'generator', note: 'Novice trades. Pairs with a spider farm.' },
      { prof: 'armorer', purpose: 'Iron → Emerald · Diamond armor', short: 'Iron', target: 1, group: 'generator', note: '4 iron → 1 emerald. Iron farm output.' },
    ],
  },
  {
    id: 'all',
    name: 'Every single enchantment',
    desc: 'Every enchantment a librarian can sell, at max level. Keeps your current roles.',
    enchants: 'all-librarian',
  },
  {
    id: 'empty',
    name: 'Blank',
    desc: 'Empty plan. Pick every book and villager yourself. Logged prices are remembered if you add an enchant back.',
    enchants: {},
    roles: [],
  },
];

/** Groups used to organise non-librarian roles in the planner. */
TH.data.roleGroups = [
  { id: 'generator', name: 'Emerald generators', hint: 'Turn farm output into emeralds' },
  { id: 'blacksmith', name: 'Blacksmiths', hint: 'Gear & tools' },
  { id: 'utility', name: 'Utility', hint: 'Things you buy' },
];
