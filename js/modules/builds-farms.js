/**
 * Built-in farm library (Java edition). Each farm is authored as layer strings (see TH.builds.io.fromJSON):
 * layers bottom to top, rows north to south (z), characters west to east (x), '.' = air.
 * The schematic is the ORIGINAL design and is never modified; user block swaps live in state.builds.swaps.
 *
 * PLANNED keeps the old roadmap list (non-viewable cards).
 */
window.TH = window.TH || {};
TH.builds = TH.builds || {};
(function () {
  'use strict';

  const FARMS = [
    {
      id: 'cow_crusher', dim: 'overworld', icon: 'item/beef', level: 'Easy', name: 'Cow crusher',
      pitch: 'Cows in a one-block hole over a hopper. Breed them from the rim; past 24 cows the crowd crushes itself and leather and beef drop into a chest.',
      how: 'Entity cramming: in Java a mob that touches more than 24 others (gamerule maxEntityCramming) takes damage every tick. No lava, no redstone.',
      legend: {
        S: 'minecraft:stone_bricks', H: 'minecraft:hopper[facing=south]', K: 'minecraft:chest[facing=south]', G: 'minecraft:glass',
        L: 'minecraft:oak_log', s: 'minecraft:oak_stairs[facing=east,half=bottom]', T: 'minecraft:torch',
      },
      layers: [
        ['...SSS', 'sSSSHS', '...SKS'],
        ['...LGL', '.sSG.G', '...LGL'],
        ['...LGL', '..sG.G', '...LGL'],
        ['...T..', '......', '......'],
      ],
      steps: [
        'Place the hopper pointing into a chest (sneak and click the chest), then the ring of stone bricks around the hopper.',
        'Build the walls two blocks high around the hopper: glass on the sides, logs in the corners. The glass above the chest keeps it openable.',
        'Add the three stairs on the west side so you can walk up onto the rim.',
        'Lead two cows into the hole with a lead (or push them in), then stand on the rim and feed them wheat.',
        'Keep breeding every five minutes. From the 25th cow on, the crowd takes damage and the drops fall into the hopper.',
      ],
      tips: [
        'Cramming drops no XP and no cooked beef. Put a campfire under a slab if you want cooked meat, or cook the beef in a furnace.',
        'To keep fewer cows, lower the limit: /gamerule maxEntityCramming 8 (single player or server).',
        'Babies count too, so the hole fills up quickly once you breed every cooldown.',
      ],
    },
    {
      id: 'sugar_cane', dim: 'overworld', icon: 'item/sugar_cane', level: 'Easy', name: 'Sugar cane farm',
      pitch: 'Seven canes on mud with a water strip behind them. One observer watches the last cane and fires a row of pistons; hoppers under the mud collect.',
      how: 'Mud is a little lower than a full block, so a hopper underneath still pulls in items lying on it. The observer sees the third cane block appear, the pistons break the second block and the top one falls with it.',
      legend: {
        S: 'minecraft:stone_bricks', H: 'minecraft:hopper[facing=west]', K: 'minecraft:chest[facing=north]', M: 'minecraft:mud', W: 'minecraft:water',
        P: 'minecraft:piston[facing=south]', O: 'minecraft:observer[facing=west]', R: 'minecraft:redstone_wire', G: 'minecraft:glass', c: 'minecraft:sugar_cane',
      },
      layers: [
        ['SSSSSSSSS.', 'SSSSSSSSS.', 'KHHHHHHHS.', 'SSSSSSSSS.'],
        ['SSSSSSSSS.', 'SWWWWWWWS.', 'GMMMMMMMS.', 'SSSSSSSSS.'],
        ['..........', 'SSSSSSSSS.', 'GcccccccS.', '.GGGGGGG..'],
        ['..........', '.PPPPPPPSS', 'G.......SS', '.GGGGGGG..'],
        ['..........', '.RRRRRRRRR', 'G.......OR', '.GGGGGGG..'],
      ],
      steps: [
        'Lay the chest and the hopper line under the cane row. Each hopper points west, the last one into the chest.',
        'Put mud on top of the hoppers and fill the strip behind the mud with water (two buckets make an endless source).',
        'Cover the water with blocks and set a piston on each, facing the cane row.',
        'Plant the sugar cane on the mud. Build the glass front and the side caps so drops cannot bounce out.',
        'Put the observer at the east end at the height of the third cane block, facing west, with its back to the dust.',
        'Run redstone dust from the observer’s back around the corner and along the tops of all pistons.',
      ],
      tips: [
        'Only the last cane triggers the harvest, so the others may be at different heights when it fires. That costs a little speed, nothing else.',
        'The observer fires a second time when the cane top disappears. The pistons then just push air.',
        'Make it longer: add columns in the middle. Dust loses one strength per block, so after about 12 pistons add a repeater.',
      ],
    },
    {
      id: 'bamboo', dim: 'overworld', icon: 'item/bamboo', level: 'Easy', name: 'Bamboo farm',
      pitch: 'Eight bamboo on mud over a hopper line. An observer five blocks up sees the last stalk reach it, and the pistons cut every stalk above its base.',
      how: 'The pistons break the second bamboo block; everything above it pops off and falls onto the mud, where the hoppers pull it in. The base block stays and grows again.',
      legend: {
        S: 'minecraft:stone_bricks', H: 'minecraft:hopper[facing=west]', K: 'minecraft:chest[facing=north]', M: 'minecraft:mud', b: 'minecraft:bamboo',
        P: 'minecraft:piston[facing=south]', O: 'minecraft:observer[facing=west]', R: 'minecraft:redstone_wire', G: 'minecraft:glass',
      },
      layers: [
        ['...........', 'SSSSSSSSSS.', 'KHHHHHHHHS.', 'SSSSSSSSSS.'],
        ['...........', 'SSSSSSSSSS.', 'GMMMMMMMMS.', 'SSSSSSSSSS.'],
        ['...........', 'SSSSSSSSSS.', 'GbbbbbbbbS.', '.GGGGGGGG..'],
        ['...........', '.PPPPPPPPSS', 'G........S.', '.GGGGGGGG..'],
        ['...........', '.RRRRRRRRRS', 'G........S.', '.GGGGGGGG..'],
        ['...........', '.GGGGGGGG.R', 'G........SS', '.GGGGGGGG..'],
        ['...........', '.GGGGGGGG..', 'G........OR', '.GGGGGGGG..'],
        ['...........', '.GGGGGGGG..', 'G..........', '.GGGGGGGG..'],
      ],
      steps: [
        'Lay the chest and eight hoppers pointing west, then cover the hoppers with mud.',
        'Build a row of blocks behind the mud and put a piston on each, facing the mud row, one block above the mud.',
        'Plant one bamboo on each mud block.',
        'Build the pillar at the east end and put the observer on top, five blocks above the mud, facing west.',
        'Lay redstone dust from the observer’s back down the two steps and along the tops of the pistons.',
        'Close the front and back with glass so falling bamboo stays above the hoppers. Keep the top open to the sky.',
      ],
      tips: [
        'Bamboo needs light 9 or more at its top. Open sky is enough by day; add lamps for night growth.',
        'A few pieces can land on the bamboo stubs. A second, slow clock on the same pistons clears them (see the wiki).',
        'Each stalk grows about one block every 68 seconds in Java. Bone meal adds one or two.',
      ],
    },
  ];

  // the old roadmap list: [dimension, icon, name, pitch, optional link]
  const PLANNED = [
    ['overworld', 'iron', 'Easy iron farm', 'A golem platform with a lava blade: the simplest design that still pays out in stacks of iron.', { href: 'https://minecraft.wiki/w/Tutorial:Iron_golem_farming', label: 'Wiki tutorial' }],
    ['overworld', 'xp', 'Easy XP farm', 'A spawner or dark-room mob grinder with a drop chute and a kill spot, no AFK tricks required.'],
    ['overworld', 'wheat', 'Easy crop farm', 'A water-channel field harvested by a villager or a simple piston line, one crop first.'],
    ['overworld', 'block/spawner', 'Spawner-to-farm converter', 'Turn a found dungeon spawner into a lit, walled grinder with a chute into a chest.'],
    ['overworld', 'block/moss_block', 'Moss farm', 'Bone meal on a flat moss floor, harvested by a piston or shears row.'],
    ['overworld', 'item/bone_meal', 'Bone meal farm', 'A skeleton drop chute feeding a hopper line, so bones arrive ready to craft.'],
    ['overworld', 'block/cobblestone', 'Cobblestone farm', 'Lava meets water beside a piston, with every break dropping into a hopper.'],
    ['overworld', 'item/lava_bucket', 'Lava farm', 'Pointed dripstone over a cauldron refills lava slowly and safely, no Nether trip needed.'],
    ['overworld', 'villager', 'Custom villager trading hall', 'A hall laid out slot by slot, with the exact trades you want.', { href: '#/hall', label: 'Open the Trading Hall tool', internal: true }],
    ['overworld', 'item/hopper', 'Simple automatic item sorter', 'A hopper chain with one filter item per column, extendable one lane at a time.', { href: 'https://minecraft.wiki/w/Tutorial:Item_sorting', label: 'Wiki tutorial' }],
    ['nether', 'quartz', 'Quartz-based builds and farms', 'A lit tunnel mine in a quartz biome with hopper pickup; unlocks everything that needs quartz.'],
    ['end', 'item/shulker_shell', 'Shulker farm', 'A spawn platform at an End city with a drop chute: the endgame source of shulker boxes.'],
  ];

  const DIMS = { overworld: 'Overworld', nether: 'Nether', end: 'End' };

  const cache = new Map();
  /** The farm's original schematic (built once, never modified: callers get a fresh copy when they need to change it). */
  function schematic(id) {
    const f = FARMS.find((x) => x.id === id);
    if (!f) return null;
    let s = cache.get(id);
    if (!s) { s = TH.builds.io.fromJSON({ name: f.name, legend: f.legend, layers: f.layers }); cache.set(id, s); }
    return s;
  }

  TH.builds.farms = { FARMS, PLANNED, DIMS, schematic };
})();
