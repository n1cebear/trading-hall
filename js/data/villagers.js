window.TH = window.TH || {};
TH.data = TH.data || {};

TH.data.professions = [
  {
    id: 'armorer', name: 'Armorer',
    workstation: 'Blast Furnace', workstationId: 'blast_furnace',
    color: '#9fb4c7',
    glyph: '🛡️',
    usefulFor: 'Diamond armor, shields, coal/iron to emeralds',
    keyTrades: [
      { level: 'Novice', give: '15 coal', get: '1 emerald' },
      { level: 'Apprentice', give: '4 iron ingots', get: '1 emerald' },
      { level: 'Expert', give: '1 diamond', get: '1 emerald' },
      { level: 'Expert', give: '13-27 emeralds', get: 'Enchanted Diamond Chestplate' },
      { level: 'Master', give: '13-27 emeralds', get: 'Enchanted Diamond Helmet' }
    ]
  },
  {
    id: 'butcher', name: 'Butcher',
    workstation: 'Smoker', workstationId: 'smoker',
    color: '#d9776b',
    glyph: '🥩',
    usefulFor: 'Cooked food, raw meat and dried kelp to emeralds',
    keyTrades: [
      { level: 'Novice', give: '14 raw chicken', get: '1 emerald' },
      { level: 'Novice', give: '1 emerald', get: '6 Rabbit Stew' },
      { level: 'Journeyman', give: '1 emerald', get: '5 Cooked Porkchop' },
      { level: 'Expert', give: '10 dried kelp blocks', get: '1 emerald' },
      { level: 'Master', give: '10 sweet berries', get: '1 emerald' }
    ]
  },
  {
    id: 'cartographer', name: 'Cartographer',
    workstation: 'Cartography Table', workstationId: 'cartography_table',
    color: '#e0c36a',
    glyph: '🗺️',
    usefulFor: 'Explorer maps, banner patterns, paper to emeralds',
    keyTrades: [
      { level: 'Novice', give: '24 paper', get: '1 emerald' },
      { level: 'Apprentice', give: '13 emeralds + compass', get: 'Ocean Explorer Map' },
      { level: 'Apprentice', give: '1 glass pane', get: '1 emerald' },
      { level: 'Journeyman', give: '14 emeralds + compass', get: 'Woodland Explorer Map' },
      { level: 'Master', give: '8 emeralds', get: 'Globe Banner Pattern' }
    ]
  },
  {
    id: 'cleric', name: 'Cleric',
    workstation: 'Brewing Stand', workstationId: 'brewing_stand',
    color: '#c58be0',
    glyph: '⚗️',
    usefulFor: 'Ender pearls, redstone, lapis, glowstone, XP bottles',
    keyTrades: [
      { level: 'Novice', give: '32 rotten flesh', get: '1 emerald' },
      { level: 'Novice', give: '1 emerald', get: '2 Redstone Dust' },
      { level: 'Apprentice', give: '1 emerald', get: '1 Lapis Lazuli' },
      { level: 'Expert', give: '5 emeralds + glass bottle', get: 'Bottle o\' Enchanting' },
      { level: 'Expert', give: '5 emeralds', get: 'Ender Pearl' }
    ]
  },
  {
    id: 'farmer', name: 'Farmer',
    workstation: 'Composter', workstationId: 'composter',
    color: '#8fcf6a',
    glyph: '🌾',
    usefulFor: 'Easy emeralds from crops, golden carrots, glistering melons',
    keyTrades: [
      { level: 'Novice', give: '20 wheat / 26 potatoes / 22 carrots / 15 beetroots', get: '1 emerald' },
      { level: 'Apprentice', give: '4 pumpkins', get: '1 emerald' },
      { level: 'Journeyman', give: '4 melons', get: '1 emerald' },
      { level: 'Master', give: '3 emeralds', get: '3 Golden Carrots' },
      { level: 'Master', give: '4 emeralds', get: '3 Glistering Melon Slices' }
    ]
  },
  {
    id: 'fisherman', name: 'Fisherman',
    workstation: 'Barrel', workstationId: 'barrel',
    color: '#5fb8d6',
    glyph: '🎣',
    usefulFor: 'String/coal/fish to emeralds, enchanted fishing rods',
    keyTrades: [
      { level: 'Novice', give: '20 string', get: '1 emerald' },
      { level: 'Novice', give: '10 coal', get: '1 emerald' },
      { level: 'Journeyman', give: '15 raw cod', get: '1 emerald' },
      { level: 'Expert', give: '13 raw salmon', get: '1 emerald' },
      { level: 'Expert', give: '1 emerald', get: 'Boat (wood type matches biome)' }
    ]
  },
  {
    id: 'fletcher', name: 'Fletcher',
    workstation: 'Fletching Table', workstationId: 'fletching_table',
    color: '#d6a35c',
    glyph: '🏹',
    usefulFor: 'Sticks to emeralds, tipped arrows, enchanted bows',
    keyTrades: [
      { level: 'Novice', give: '32 sticks', get: '1 emerald' },
      { level: 'Novice', give: '1 emerald', get: '16 Arrows' },
      { level: 'Apprentice', give: '10 gravel + 1 emerald', get: '10 Flint' },
      { level: 'Expert', give: '8-22 emeralds', get: 'Enchanted Crossbow / Bow' },
      { level: 'Master', give: '2 emeralds + 5 arrows', get: '5 Tipped Arrows' }
    ]
  },
  {
    id: 'leatherworker', name: 'Leatherworker',
    workstation: 'Cauldron', workstationId: 'cauldron',
    color: '#b5784a',
    glyph: '🧥',
    usefulFor: 'Saddles, leather horse armor, flint to emeralds',
    keyTrades: [
      { level: 'Novice', give: '6 leather', get: '1 emerald' },
      { level: 'Apprentice', give: '26 flint', get: '1 emerald' },
      { level: 'Expert', give: '4 scutes', get: '1 emerald' },
      { level: 'Expert', give: '6 emeralds', get: 'Leather Horse Armor' },
      { level: 'Master', give: '6 emeralds', get: 'Saddle' }
    ]
  },
  {
    id: 'librarian', name: 'Librarian',
    workstation: 'Lectern', workstationId: 'lectern',
    color: '#c8a26a',
    glyph: '📚',
    usefulFor: 'Enchanted books, bookshelves, name tags, glass',
    keyTrades: [
      { level: 'Novice', give: '24 paper', get: '1 emerald' },
      { level: 'Novice', give: '9 emeralds', get: '1 Bookshelf' },
      { level: 'Novice', give: '5-64 emeralds + book', get: 'Enchanted Book (any level)' },
      { level: 'Journeyman', give: '1 emerald', get: '4 Glass' },
      { level: 'Master', give: '20 emeralds', get: 'Name Tag' }
    ]
  },
  {
    id: 'mason', name: 'Mason',
    workstation: 'Stonecutter', workstationId: 'stonecutter',
    color: '#a9a39a',
    glyph: '🧱',
    usefulFor: 'Quartz blocks, terracotta, polished stones, clay to emeralds',
    keyTrades: [
      { level: 'Novice', give: '10 clay balls', get: '1 emerald' },
      { level: 'Apprentice', give: '20 stone', get: '1 emerald' },
      { level: 'Expert', give: '1 emerald', get: '1 Glazed / Dyed Terracotta' },
      { level: 'Master', give: '1 emerald', get: '1 Block of Quartz' },
      { level: 'Master', give: '1 emerald', get: '1 Quartz Pillar' }
    ]
  },
  {
    id: 'shepherd', name: 'Shepherd',
    workstation: 'Loom', workstationId: 'loom',
    color: '#e9e4d6',
    glyph: '🐑',
    usefulFor: 'Wool of all colors, beds, banners, paintings',
    keyTrades: [
      { level: 'Novice', give: '18 white wool', get: '1 emerald' },
      { level: 'Novice', give: '2 emeralds', get: 'Shears' },
      { level: 'Apprentice', give: '1 emerald', get: '1 Colored Wool / Carpet' },
      { level: 'Expert', give: '3 emeralds', get: '1 Banner' },
      { level: 'Master', give: '2 emeralds', get: '3 Paintings' }
    ]
  },
  {
    id: 'toolsmith', name: 'Toolsmith',
    workstation: 'Smithing Table', workstationId: 'smithing_table',
    color: '#7fa7a0',
    glyph: '⛏️',
    usefulFor: 'Enchanted diamond tools, coal/iron to emeralds',
    keyTrades: [
      { level: 'Novice', give: '15 coal', get: '1 emerald' },
      { level: 'Apprentice', give: '1 emerald', get: 'Bell' },
      { level: 'Journeyman', give: '1 diamond', get: '1 emerald' },
      { level: 'Expert', give: '17-31 emeralds', get: 'Enchanted Diamond Pickaxe' },
      { level: 'Master', give: '13-27 emeralds', get: 'Enchanted Diamond Axe / Shovel' }
    ]
  },
  {
    id: 'weaponsmith', name: 'Weaponsmith',
    workstation: 'Grindstone', workstationId: 'grindstone',
    color: '#d06a6a',
    glyph: '⚔️',
    usefulFor: 'Enchanted diamond swords and axes, coal/iron to emeralds',
    keyTrades: [
      { level: 'Novice', give: '15 coal', get: '1 emerald' },
      { level: 'Apprentice', give: '4 iron ingots', get: '1 emerald' },
      { level: 'Journeyman', give: '24 flint', get: '1 emerald' },
      { level: 'Expert', give: '1 diamond', get: '1 emerald' },
      { level: 'Master', give: '8-22 emeralds', get: 'Enchanted Diamond Sword' }
    ]
  }
];

TH.data.villagerLevels = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
