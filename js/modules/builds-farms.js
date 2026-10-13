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
      use: 'semi', useText: 'Not AFK: you breed the cows every five minutes. The crowd and the hopper do the rest, so stay on the rim and keep wheat in hand.', tags: ['no-redstone', 'mobs', 'food'],
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
      use: 'afk', useText: 'Fully automatic. Stand anywhere within about 8 chunks (so the farm stays loaded), do something else, and empty the chest now and then.', tags: ['redstone', 'pistons', 'observer', 'crops'],
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
      use: 'afk', useText: 'Fully automatic. Stay within about 8 chunks and empty the chest now and then. Bamboo is also fuel and scaffolding, so it fills up fast.', tags: ['redstone', 'pistons', 'observer', 'crops'],
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
    {
      id: 'crop_field', dim: 'overworld', icon: 'item/wheat', level: 'Easy', name: 'Crop field',
      use: 'manual', useText: 'Hands on: walk along the rows and harvest, then replant. A villager farmer next to it can replant for you.', tags: ['no-redstone', 'crops', 'food'],
      pitch: 'A nine by nine field around one water block. Every crop is watered, you harvest by walking along it, and the fence keeps animals out.',
      how: 'One water source hydrates farmland up to four blocks away in every direction, so a 9 x 9 square with the water in the middle is the biggest field one bucket can feed.',
      legend: { P: 'minecraft:oak_planks', F: 'minecraft:farmland[moisture=7]', W: 'minecraft:water', w: 'minecraft:wheat[age=7]', f: 'minecraft:oak_fence', T: 'minecraft:torch' },
      layers: [
        ['PPPPPPPPPPP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PFFFFWFFFFP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PFFFFFFFFFP', 'PPPPPPPPPPP'],
        ['TfffffffffT', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwww.wwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'Tffff.ffffT'],
      ],
      steps: [
        'Flatten an 11 x 11 square and dig the whole 9 x 9 field one block down so the farmland sits level with the plank border.',
        'Hoe the dirt into farmland and put a water bucket in the centre hole.',
        'Plant seeds, carrots or potatoes on every block. Wheat as in the picture, or mix crops by row.',
        'Build the fence ring with a torch on each corner. Leave one fence out on the south side as the gate, or place a fence gate there.',
      ],
      tips: [
        'Water must be within four blocks of a farmland block, so the field cannot be wider than 9.',
        'Torches stop mobs spawning on the field and keep the crops lit at night; crops grow with light level 9 or more.',
        'Bone meal makes harvest time instant. A villager farmer next to it will replant for you.',
      ],
    },
    {
      id: 'cottage', cat: 'build', dim: 'overworld', icon: 'block/oak_planks', level: 'Easy', name: 'Starter cottage',
      tags: ['house', 'village', 'wood'],
      pitch: 'A seven by seven cottage with a cobblestone base, log corners, glass windows and a gabled roof. Room for a bed, chests and a crafting corner.',
      how: 'Walls are three blocks high so you can walk through the door without ducking. The roof is two stair slopes meeting at a flat ridge.',
      legend: { C: 'minecraft:cobblestone', L: 'minecraft:oak_log', P: 'minecraft:oak_planks', G: 'minecraft:glass', s: 'minecraft:oak_stairs[facing=east,half=bottom]', S: 'minecraft:oak_stairs[facing=west,half=bottom]', c: 'minecraft:crafting_table', K: 'minecraft:chest[facing=south]' },
      layers: [
        ['CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC'],
        ['LPPPPPL', 'Pc...KP', 'P.....P', 'P.....P', 'P.....P', 'P.....P', 'LPP.PPL'],
        ['LPGPGPL', 'P.....P', 'G.....G', 'P.....P', 'G.....G', 'P.....P', 'LGP.PGL'],
        ['LPPPPPL', 'P.....P', 'P.....P', 'P.....P', 'P.....P', 'P.....P', 'LPPPPPL'],
        ['sPPPPPS', 'sPPPPPS', 'sPPPPPS', 'sPPPPPS', 'sPPPPPS', 'sPPPPPS', 'sPPPPPS'],
        ['.sPPPS.', '.sPPPS.', '.sPPPS.', '.sPPPS.', '.sPPPS.', '.sPPPS.', '.sPPPS.'],
        ['..sPS..', '..sPS..', '..sPS..', '..sPS..', '..sPS..', '..sPS..', '..sPS..'],
      ],
      steps: [
        'Lay the 7 x 7 cobblestone foundation, then raise a log in each corner, three high.',
        'Fill the walls with planks. Leave the door gap in the middle of the south wall (two high) and put glass windows in the second course.',
        'Close the top wall ring with planks, including the beam over the door.',
        'Roof: a column of stairs on both long sides, then each layer one block further in. Fill behind them with planks. The two end walls stay solid under the slope.',
        'Furnish: crafting table and chest in the north corners, a bed and a furnace to taste.',
      ],
      tips: [
        'Swap the planks for spruce or birch in Customise blocks to change the look in one click.',
        'Place torches inside, not on the roof, or mobs spawn on the roof slabs.',
        'For a bigger house add two blocks of length and repeat the roof column.',
      ],
    },
    {
      id: 'watchtower', cat: 'build', dim: 'overworld', icon: 'block/stone_bricks', level: 'Easy', name: 'Watchtower',
      tags: ['defence', 'medieval', 'stone'],
      pitch: 'A five by five stone tower, ten blocks tall, with arrow slits and a crenellated lookout. Good for a base entrance or a village guard post.',
      how: 'Plain wall courses, two courses with slit windows, then the platform and the battlements. The inside is hollow so you can add a ladder or stairs as you like.',
      legend: { S: 'minecraft:stone_bricks', G: 'minecraft:glass', P: 'minecraft:oak_planks', T: 'minecraft:torch', C: 'minecraft:cobblestone' },
      layers: [
        ['CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC'],
        ['SSSSS', 'S...S', 'S...S', 'S...S', 'SS.SS'],
        ['SSSSS', 'S...S', 'S...S', 'S...S', 'SS.SS'],
        ['SSGSS', 'S...S', 'G...G', 'S...S', 'SSGSS'],
        ['SSSSS', 'S...S', 'S...S', 'S...S', 'SSSSS'],
        ['SSSSS', 'S...S', 'S...S', 'S...S', 'SSSSS'],
        ['SSGSS', 'S...S', 'G...G', 'S...S', 'SSGSS'],
        ['SSSSS', 'SPPPS', 'SPPPS', 'SPPPS', 'SSSSS'],
        ['S.S.S', '.....', 'S...S', '.....', 'S.S.S'],
        ['T...T', '.....', '.....', '.....', 'T...T'],
      ],
      steps: [
        'Build the 5 x 5 cobblestone base and raise the stone-brick ring around it.',
        'Leave a two-high door gap in the middle of the south wall and glass slits on the third and sixth courses.',
        'Lay the oak plank floor of the lookout one course above the upper windows.',
        'Add the battlements: every other block on the top course, with a torch on each corner.',
        'Inside, run a ladder up the wall, or build a stair up the inside corner.',
      ],
      tips: [
        'Skeletons shoot from the platform, so put a slab over the stair opening you use.',
        'Swap stone bricks for deepslate bricks for a darker, Gothic look.',
        'Remove the glass course if you prefer a solid tower.',
      ],
    },
    {
      id: 'lighthouse', cat: 'build', dim: 'overworld', icon: 'block/sea_lantern', level: 'Medium', name: 'Lighthouse',
      tags: ['landmark', 'coastal'],
      pitch: 'A red and white banded lighthouse with a glass lamp room and a sea lantern at the top. Thirteen blocks tall on a round stone base.',
      how: 'The footprint is a seven-wide octagon, which reads as round in Minecraft. Each band is two courses; the lamp room is glass around a sea lantern.',
      legend: { B: 'minecraft:smooth_stone', W: 'minecraft:white_concrete', R: 'minecraft:red_concrete', G: 'minecraft:glass', L: 'minecraft:sea_lantern' },
      layers: (function () {
        const OCT = ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'];
        const RING = ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'];
        const f = (rows, ch) => rows.map((r) => r.replace(/#/g, ch));
        const door = (rows) => rows.map((r, i) => (i === 6 ? r.slice(0, 3) + '.' + r.slice(4) : r));
        const win = (rows) => rows.map((r, i) => (i === 0 || i === 6 ? r.slice(0, 3) + 'G' + r.slice(4) : i === 3 ? 'G' + r.slice(1, 6) + 'G' : r));
        const lamp = ['..GGG..', '.G...G.', 'G.....G', 'G..L..G', 'G.....G', '.G...G.', '..GGG..'];
        return [f(OCT, 'B'), door(f(RING, 'W')), door(f(RING, 'W')), f(RING, 'R'), win(f(RING, 'R')), f(RING, 'W'), f(RING, 'W'), f(RING, 'R'), f(RING, 'R'), f(OCT, 'B'), lamp, lamp, f(OCT, 'R'), ['.......', '.......', '.......', '...R...', '.......', '.......', '.......']];
      })(),
      steps: [
        'Build the octagon base in smooth stone, then raise the bands from the bottom: two white, two red, two white, two red.',
        'Leave a two-high door gap in the south wall and put windows in the middle of the first red band.',
        'Close the tower with a smooth stone gallery floor. Inside, add a ladder or stairs up to it.',
        'Make the lamp room: two courses of glass around a sea lantern, then a red roof and a single block spire.',
      ],
      tips: [
        'Place it on a headland or a small island; torches on the shore help boats find the harbour.',
        'Swap the red concrete for orange to get an autumn lighthouse, or blue for a harbour beacon.',
        'Sea lantern is light level 15, so it lights a wide area of the water.',
      ],
    },
    {
      id: 'pavilion', cat: 'build', dim: 'overworld', icon: 'block/dark_oak_planks', level: 'Medium', name: 'Pagoda pavilion',
      tags: ['decor', 'japanese', 'landmark'],
      pitch: 'An open pavilion with four dark oak pillars and a three-tier red roof. A garden shrine or a rest stop by your path.',
      how: 'Four pillars rise three blocks from a stone base; the roof is three nested rings of red nether brick stairs that shrink toward a small spire.',
      legend: { B: 'minecraft:stone_bricks', L: 'minecraft:dark_oak_log', R: 'minecraft:red_nether_bricks', n: 'minecraft:red_nether_brick_stairs[facing=south,half=bottom]', s: 'minecraft:red_nether_brick_stairs[facing=north,half=bottom]', w: 'minecraft:red_nether_brick_stairs[facing=east,half=bottom]', e: 'minecraft:red_nether_brick_stairs[facing=west,half=bottom]', M: 'minecraft:sea_lantern', f: 'minecraft:dark_oak_fence' },
      layers: [
        ['BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBMBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB'],
        ['.......', '.L...L.', '.......', '.......', '.......', '.L...L.', '.......'],
        ['.......', '.L...L.', '.......', '.......', '.......', '.L...L.', '.......'],
        ['.......', '.L...L.', '.......', '.......', '.......', '.L...L.', '.......'],
        ['nnnnnnn', 'wRRRRRe', 'wRRRRRe', 'wRRRRRe', 'wRRRRRe', 'wRRRRRe', 'sssssss'],
        ['.......', '.nnnnn.', '.wRRRe.', '.wRRRe.', '.wRRRe.', '.sssss.', '.......'],
        ['.......', '.......', '..nnn..', '..wRe..', '..sss..', '.......', '.......'],
        ['.......', '.......', '.......', '...R...', '.......', '.......', '.......'],
        ['.......', '.......', '.......', '...f...', '.......', '.......', '.......'],
      ],
      steps: [
        'Lay a 7 x 7 stone brick base. The sea lantern in the centre is a glowing floor light.',
        'Raise a dark oak log pillar, three high, at each of the four inner corners (one block in from the edge).',
        'Build the lowest roof ring: stairs on every edge, facing outward, with red nether brick filling the inside of the ring.',
        'Repeat two more times, each ring one block smaller, and finish with a block and a fence post as the spire.',
        'Add steps on one side and a lantern or two for the evening.',
      ],
      tips: [
        'The stairs on each side face outward so the slope reads correctly; check the corner stairs from above.',
        'Swap red nether brick for blue concrete and sea lanterns for a water temple, or prismarine for an ocean one.',
        'Trapdoors on the roof edges give it the curled eaves of the real thing.',
      ],
    },
    {
      id: 'well', cat: 'build', dim: 'overworld', icon: 'block/cobblestone', level: 'Easy', name: 'Village well',
      tags: ['decor', 'village', 'stone'],
      pitch: 'A three by three well with a cobblestone wall, a water block, four posts and a small roof. A good first build for any village.',
      how: 'The water sits in the middle of a ring of cobblestone wall. Four fence posts hold a plank roof with a slab on top.',
      legend: { C: 'minecraft:cobblestone', W: 'minecraft:water', w: 'minecraft:cobblestone_wall', f: 'minecraft:oak_fence', P: 'minecraft:oak_planks', o: 'minecraft:oak_slab[type=bottom]' },
      layers: [
        ['CCC', 'CWC', 'CCC'],
        ['www', 'w.w', 'www'],
        ['f.f', '...', 'f.f'],
        ['f.f', '...', 'f.f'],
        ['PPP', 'PPP', 'PPP'],
        ['...', '.o.', '...'],
      ],
      steps: [
        'Dig one block down, fill a 3 x 3 square with cobblestone and put water in the centre.',
        'Ring the water with cobblestone wall.',
        'Raise a fence post on each corner, two high.',
        'Cap the posts with a 3 x 3 plank roof and a slab on the middle.',
      ],
      tips: [
        'Add a bucket on a fence with an item frame for the classic village look.',
        'A well lights nothing: put a torch on a post top or a lantern under the roof.',
        'Stone brick walls and a stone slab roof make it look older.',
      ],
    },
    {
      id: 'auto_smelter', cat: 'machine', dim: 'overworld', icon: 'block/furnace_front', level: 'Easy', name: 'Auto smelter',
      use: 'semi', useText: 'Load once, walk away. Fill the top chest with raw items and the side chest with fuel, come back later and take the finished items from the bottom chest.',
      tags: ['no-redstone', 'hoppers', 'utility'],
      pitch: 'A furnace fed by hoppers: raw items from a chest on top, fuel from a chest on the side, smelted items into a chest below. No redstone at all.',
      how: 'A hopper pointing into the top of a furnace fills its input slot, a hopper pointing into its side fills the fuel slot, and a hopper under the furnace takes the finished items out of the output slot.',
      legend: { S: 'minecraft:stone_bricks', K: 'minecraft:chest[facing=south]', H: 'minecraft:hopper[facing=down]', h: 'minecraft:hopper[facing=west]', F: 'minecraft:furnace[facing=south]' },
      layers: [
        ['SSS', 'SSS', 'SSS'],
        ['...', '.K.', '...'],
        ['...', '.H.', '...'],
        ['...', '.Fh', '...'],
        ['...', '.HK', '...'],
        ['...', '.K.', '...'],
      ],
      steps: [
        'Place the bottom chest, then a hopper above it pointing down into it. Sneak and click to place the hopper on the chest.',
        'Put the furnace on top of that hopper, facing the side you will stand on.',
        'Put a hopper on top of the furnace pointing down, with a chest on top of it: that is the input.',
        'Put a hopper on the east side of the furnace pointing west into it, and a chest on top of that hopper for fuel.',
        'Fill the top chest with raw ore, food or sand and the side chest with coal or charcoal.',
      ],
      tips: [
        'Only put smeltable items in the input chest. Anything else blocks the hopper.',
        'One stack of coal smelts 80 items, so one fuel chest runs a long time.',
        'To double the speed, build two of them side by side or put a second furnace under the input hopper.',
        'Blast furnaces and smokers work the same way and smelt ores or food twice as fast.',
      ],
    },
  ];

  // the old roadmap list: [dimension, icon, name, pitch, optional link]
  const PLANNED = [
    ['overworld', 'iron', 'Easy iron farm', 'A golem platform with a lava blade: the simplest design that still pays out in stacks of iron.', { href: 'https://minecraft.wiki/w/Tutorial:Iron_golem_farming', label: 'Wiki tutorial' }],
    ['overworld', 'xp', 'Easy XP farm', 'A spawner or dark-room mob grinder with a drop chute and a kill spot, no AFK tricks required.'],
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

  /**
   * Machine phases: the farm as the viewer steps through it. Each is the original schematic with a few blocks patched
   * (pistons extended, plants grown). Phase 0 is always the finished build as it stands.
   */
  const CANE = 'minecraft:sugar_cane', PIST_OUT = 'minecraft:piston[facing=south,extended=true]', HEAD = 'minecraft:piston_head[facing=south,type=normal]', AIR = 'minecraft:air';
  const PHASES = {
    sugar_cane: [
      { label: 'Planted: the cane is one block high', dur: 1.6 },
      { label: 'Grown: the observer sees the third block', dur: 1.6, patch: (set) => { for (let x = 1; x <= 7; x++) { set(x, 3, 2, CANE); set(x, 4, 2, CANE); } } },
      { label: 'Pistons fire and cut the cane', dur: 1.3, patch: (set) => { for (let x = 1; x <= 7; x++) { set(x, 3, 1, PIST_OUT); set(x, 3, 2, HEAD); set(x, 4, 2, AIR); } } },
    ],
    bamboo: [
      { label: 'Planted: the bamboo is one block high', dur: 1.6 },
      { label: 'Grown: the observer sees the top', dur: 1.6, patch: (set) => { for (let x = 1; x <= 8; x++) for (let y = 3; y <= 6; y++) set(x, y, 2, 'minecraft:bamboo'); } },
      { label: 'Pistons fire and cut the bamboo', dur: 1.3, patch: (set) => { for (let x = 1; x <= 8; x++) { set(x, 3, 1, PIST_OUT); set(x, 3, 2, HEAD); for (let y = 4; y <= 6; y++) set(x, y, 2, AIR); } } },
    ],
  };
  /** [{ label, dur, schem }] for a farm that has a machine to show, built from the schematic as shown (swaps included); else null. */
  function phases(id, base) {
    const P = PHASES[id];
    if (!P || !base) return null;
    const C = TH.builds.core;
    let cur = base;
    return P.map((ph, i) => {
      if (i === 0) return { label: ph.label, dur: ph.dur, schem: base };
      const s = C.clone(cur);   // each phase continues from the one before
      ph.patch((x, y, z, b) => C.set(s, x, y, z, b));
      cur = s;
      return { label: ph.label, dur: ph.dur, schem: s };
    });
  }

  const cache = new Map();
  /** The farm's original schematic (built once, never modified: callers get a fresh copy when they need to change it). */
  function schematic(id) {
    const f = FARMS.find((x) => x.id === id);
    if (!f) return null;
    let s = cache.get(id);
    if (!s) { s = TH.builds.io.fromJSON({ name: f.name, legend: f.legend, layers: f.layers }); cache.set(id, s); }
    return s;
  }

  FARMS.forEach((f) => { f.cat = f.cat || 'farm'; });

  TH.builds.farms = { FARMS, PLANNED, DIMS, schematic, phases, hasPhases: (id) => !!PHASES[id] };
})();
