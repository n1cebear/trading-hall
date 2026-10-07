window.TH = window.TH || {};
TH.data = TH.data || {};

/**
 * Built-in presets.
 *
 * enchants: id -> 'max' | level | { level, slots: ['label', ...] }
 *   `slots` = one librarian per entry (e.g. Protection IV for helmet, chest, legs).
 *   The special value 'all-librarian' means every librarian-tradeable enchant at max.
 * roles: non-librarian villagers, each with a purpose and how many you want.
 *   Librarians are derived automatically from the enchant list.
 */
TH.data.presets = [
  {
    id: 'blueprint',
    name: 'My Blueprint',
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
      { prof: 'fletcher', purpose: 'Sticks → Emerald', target: 4, group: 'generator', note: '32 sticks → 1 emerald. Fed by log farm.' },
      { prof: 'farmer', purpose: 'Pumpkins / Melons → Emerald', target: 2, group: 'generator', note: 'Pumpkins 15 → 1, Melons 4 → 1.' },
      { prof: 'cleric', purpose: 'Rotten Flesh → Emerald', target: 2, group: 'generator', note: '32 flesh → 1 emerald. Zombie farm drops.' },
      { prof: 'mason', purpose: 'Clay / Stone → Emerald', target: 2, group: 'generator', note: '20 clay → 1 emerald. Dumps strip-mine junk.' },
      { prof: 'armorer', purpose: 'Iron → Emerald · Diamond armor', target: 1, group: 'blacksmith', note: '4 iron → 1 emerald. Master: enchanted diamond armor.' },
      { prof: 'toolsmith', purpose: 'Diamond pickaxe / axe', target: 1, group: 'blacksmith', note: 'Renewable diamond tools.' },
      { prof: 'weaponsmith', purpose: 'Diamond sword', target: 1, group: 'blacksmith', note: 'Master rolls enchanted swords — buy & disenchant.' },
      { prof: 'farmer', purpose: 'Emerald → Golden Carrot', target: 1, group: 'utility', note: 'Best food in the game.' },
      { prof: 'cleric', purpose: 'Emerald → Ender Pearl', target: 1, group: 'utility', note: '5 emeralds → 1 pearl.' },
      { prof: 'cartographer', purpose: 'Explorer maps', target: 1, group: 'utility', note: 'Mansions, monuments, trial chambers.' },
    ],
  },
  {
    id: 'all',
    name: 'Everything tradeable',
    desc: 'Every enchantment a librarian can sell, at max level. Keeps your current roles.',
    enchants: 'all-librarian',
  },
  {
    id: 'empty',
    name: 'Blank slate',
    desc: 'Clear the wanted list and roles. Logged prices are remembered if you add an enchant back.',
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
