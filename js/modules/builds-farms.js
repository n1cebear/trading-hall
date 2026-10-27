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
    {
      id: 'guardian_head', cat: 'build', dim: 'overworld', icon: 'item/guardian_spawn_egg', level: 'Medium', name: 'Guardian head',
      art: ['entity/guardian', 64, 64, 16, 16, 12, 12, [5, 5, 2, 2, '#790b12']],
      tags: ['statue', 'mob-head', 'ocean'],
      pitch: 'The ocean monument guardian as a giant statue: prismarine body, the big eye with its red pupil and twelve orange spikes, one on every edge. Perfectly symmetric.',
      how: 'Made from the real mob: the game’s guardian model and texture, every texture pixel matched to the block with the closest colour. The spikes sit where the game puts them, in the middle of each edge at 45 degrees.',
      opts: [
        { id: 'size', label: 'Body width in blocks', def: '24', choices: [['16', '16', 'Body 16 blocks wide: one block per texture pixel'], ['24', '24', 'Body 24 blocks wide: one and a half blocks per pixel'], ['32', '32', 'Body 32 blocks wide: two blocks per pixel']] },
        { id: 'tail', label: 'Tail', def: 'off', choices: [['off', 'Head only', 'Just the head with its spikes'], ['on', 'With tail', 'The three tail segments and the fin, straight back from the head']] },
      ],
      make: (o) => guardianHead(o),
      steps: [
        'Pick a size. Lay the bottom plate first, then go up layer by layer: the body is a hollow box with notched edges, one block thick.',
        'Mottle the walls as in the picture: prismarine, dark prismarine for the shade, prismarine bricks for the light flecks and acacia wood where the spikes come out.',
        'On the front, build the eye: white concrete with polished diorite corners, a dark prismarine band above it and the red concrete pupil in the middle.',
        'Add the twelve spikes, one in the middle of every edge, pointing out at 45 degrees: orange concrete at the base, orange wool at the tip.',
        'With the tail: three shrinking segments straight back from the rear, and the fin of stripped oak, mossy cobblestone and yellow terracotta on the last one.',
      ],
      tips: [
        'Use "Only this layer" under the 3D view to read one layer at a time; the spikes are easiest from the side view.',
        'It is hollow inside: a hidden room behind the eye, or a sea lantern chamber, fits easily.',
        'Swap the whole orange colour set in Customise blocks for red or yellow spikes in one click.',
        'Build it underwater next to an ocean monument; the prismarine looks right at home there.',
      ],
    },
    {
      id: 'creeper_head', cat: 'build', dim: 'overworld', icon: 'item/creeper_spawn_egg', level: 'Easy', name: 'Creeper head',
      art: ['entity/creeper/creeper', 64, 32, 8, 8, 8, 8],
      tags: ['statue', 'mob-head', 'pixel-art'],
      pitch: 'A giant creeper head: the famous face on the front and the mottled green skin on the other five sides, copied pixel by pixel from the game texture.',
      how: 'Every pixel of the creeper’s 8 x 8 head texture becomes a square of blocks. Six tones: black and green concrete for the face, lime concrete, lime wool, green wool and white concrete for the skin.',
      opts: [
        { id: 'size', label: 'Size in blocks', def: '24', choices: [['16', '16', '16 blocks a side: each texture pixel is 2 x 2 blocks'], ['24', '24', '24 blocks a side: each texture pixel is 3 x 3 blocks'], ['32', '32', '32 blocks a side: each texture pixel is 4 x 4 blocks']] },
      ],
      make: (o) => creeperHead(o),
      steps: [
        'Pick a size: every texture pixel is a 2 x 2, 3 x 3 or 4 x 4 square of blocks.',
        'Lay the bottom face, then build the four walls ring by ring and close the top. The head is hollow, one block thick.',
        'The south side is the face: black concrete for the eyes and the mouth, green concrete around them.',
        'The other sides copy the creeper’s skin: lime concrete, lime wool, green wool and a few white concrete flecks.',
      ],
      tips: [
        'Each side mirrors the left half of the real texture, so the head is perfectly symmetric. The face is symmetric in the game too.',
        'Mobs can spawn on the flat top at night: put a few torches or lanterns up there.',
        'A door in the back turns it into a small house.',
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

  /* ======================================================================
   * Mob heads: statues voxelised from the real mob models and textures (Java 1.21.11 entity/guardian.png,
   * entity/creeper/creeper.png). Every texel was matched once to the block whose texture has the closest average
   * colour (CIELAB distance); the letters below are those blocks, '.' = a transparent texel. Both heads are mirror
   * images left to right: the left half (the mob's right) is the source, the other half is its mirror.
   * ====================================================================== */
  const GUARDIAN_TEX = [
    '.........RRRR...PPDPSSSSPPPPPPPPPSSPPPPP........BBPBPPPP........',
    '........RRRRRR..DDDDSSSSDDDDDDDDSSSSDDDD........BDPBPPDB........',
    '........RRRRRR..................................PPDPPPPP........',
    '................................................PPPPPDPP........',
    '................................................BDDPPDDP........',
    '................................................PPPPPPPP........',
    '................................................PPDPPPPP........',
    '................................................PBPPPPPP........',
    '........................................PPPPPBBPDDDDPPPPPPPPDDDD',
    '........................................PDPDPPPPDPPDPDPPPDPPDPDD',
    '........................................PPPDPPDPDDPDPDPPDDDPDPPD',
    '........................................PPPPPPPPPDDDPPBPPPPPDDDD',
    '................................................................',
    '................................................................',
    '................DDDDSSSDDDDDDDDDSSSSDDDD........................',
    '................PPPPPSDDPPPPPPPPPSSPPDPP........................',
    'PD............DPPPBBBBDBPPBBPD............DPBBPBBBPBBDPB........',
    'PD............DPPPPPPDDPPPPPPD............DPBPDDPPPPDDDP........',
    'PD............DPBPPPPPDPPPPBPD............DPPPDDDPPDDPPP........',
    'PD............DPBPPPPPPPPPPPPD............DPPDDPDDDDPPPB........',
    'PS............SPBDDDDDDDDDDPPS............SPBPPPPPDPPPPB........',
    'SS............SSPDDwWWWWwDDPSS............SSPDPPDDDPPPPP........',
    'SS............SSBDDWWWWWWDDPSS............SSPDPPDDDDPPPP........',
    'PS............SPPPPwWWWWwPPPPS............SPPDDPPPPDDPPB........',
    'PD............DPPPPPDPPPDPPPPD............DPDPDDPPPPDDPP........',
    'PD............DPPPDDDPPDDPPDPD............DPDPPPPPPPDPPP........',
    'PD............DPPDDDPPPPDPPDPD............DPPPPPPPPPPPPP........',
    'PD............DPPPPPPDPPPDPPPD............DPPPPPPPPPPPPP........',
    '............PDDP.........FMMMD..................................',
    '............PDDP..........YYFMDD................................',
    '............PDDP.........FFMMMPMD...............................',
    '............DDDP..........YYYMMMMD..............................',
    '............PSSP.........FFFMFMMPD.............PPPP.............',
    '............SSSS..........YYYMMMDD.............DPPP.............',
    '............SSSS.........FFMMMPDD..............PPPP.............',
    '............PSSP..........YYFMDD...............PPDP.............',
    '............PDDP.........FMMMD.................PPPP.............',
    '............PDDP...............................PDPP.............',
    '............PDDP.........................DPPPDPPPDPPDPPPP.......',
    '............PDDP.........................PPDDPPDDPPPPPPDD.......',
    'PPPDPPPPPPPPPD............DPPPPDPPPPPPPPPPPPPPPPPPPP............',
    'PDDDPDPPPDDPPD............DPPPDPPPPPPPPPPPDDDDPPDDPP............',
    'PDDDPPDPDDDPPD............DPPPDPPPPPPPPPPDDPDDPDDDDP............',
    'PDPDDPDDDDPPPD............DPPPPPDPPPPPPPPDPPDDDDDDDP............',
    'PDDDDDDDDPDPPS............SPPPPPDDPPPPPPPDDDDDPDDDPP............',
    'PDPDDDPDPPDPSS............SSPPPPDDPPPPDDPDDDDPDPDPDP............',
    'PPPDDPPDDDDPSS............SSPPPDDPDDDDPPPDDPPPPDPDDP............',
    'PPPDPPDDDDDPPS............SPPPPDPPPPDPPPPDPPDPDDDDPP............',
    'PPDDDDDDDPDPPD............DPPPDPPPPPDPPPPDDDDDDPDDDP............',
    'PDDPPDDPDPPPPD............DPPPDPPPPDDPPPPPDDPPDDDDPP............',
    'PDPPPDPDPPDPPD............DPPPPPPPDDPPPPPDPDPDDDDPDP............',
    'PPPPPPPDPPPPPD............DPPPPPPPPDPPPPPPPPPPPPPDPP............',
    '................PPPPSSSSPPPPPPPPSSSSPPPPPPPPSSSSPPPPPPPPSSSSDPPP',
    '................DDDDSSSSDDDDDDDDSSSSDDDDDDDDSSSSDDDDDDDDSSSSDDDD',
    '.......PPBPPP...................................................',
    '.......PDPPDP...................................................',
    '.......BDPPDP...................................................',
    '.......BDPPDP...................................................',
    '.......PDPPDP...................................................',
    '.......PDPPDP...................................................',
    '.......PPPPPP...................................................',
    'BPBBPPPDPDPPPPPPPDDD............................................',
    'PDDDDDPDDDPDDDDDPDDD............................................',
    'PPPPPPPDDDPPPPPPPDDP............................................',
  ];
  const GUARDIAN_BLOCK = {
    P: 'minecraft:prismarine', B: 'minecraft:prismarine_bricks', D: 'minecraft:dark_prismarine', S: 'minecraft:acacia_wood',
    W: 'minecraft:white_concrete', w: 'minecraft:polished_diorite', R: 'minecraft:red_concrete',
    O: 'minecraft:orange_wool', o: 'minecraft:orange_concrete', T: 'minecraft:orange_terracotta',
    F: 'minecraft:stripped_oak_wood', M: 'minecraft:mossy_cobblestone', Y: 'minecraft:yellow_terracotta',
  };
  // vanilla GuardianModel boxes in model units (x = the mob's left, y DOWN, z = back; the eye looks toward -z):
  // [x0, y0, z0, w, h, d, texture u, v]. The body is a 12 x 12 x 16 core with 2 px plates on four sides, so a 16 px
  // cube with notched edges; the right plate is a mirrored copy of the left one in the game as well.
  const G_BODY = [[-6, 10, -8, 12, 12, 16, 0, 0], [-8, 10, -6, 2, 12, 12, 0, 28], [6, 10, -6, 2, 12, 12, 0, 28], [-6, 8, -6, 12, 2, 12, 16, 40], [-6, 22, -6, 12, 2, 12, 16, 40]];
  const G_TAIL = [[-2, 14, 7, 4, 4, 8, 40, 0], [-1.5, 14.5, 14, 3, 3, 7, 0, 54], [-1, 15, 20, 2, 2, 6, 41, 32]];
  const G_FIN = [-0.5, 11.5, 23, 1, 9, 9, 25, 19];   // the game puts it at x 0..1, half a texel off the middle; centred here
  /** The texel of a box face at a point (model units). f: n = front (-z), s = back, w = -x, e = +x, u = top (-y), d = bottom. */
  function gTexel(b, f, x, y, z) {
    const [x0, y0, z0, w, h, d, u, v] = b;
    const cl = (t, n) => Math.max(0, Math.min(n - 1, Math.floor(t + 1e-6)));
    const i = cl(x - x0, w), j = cl(y - y0, h), k = cl(z - z0, d);
    const uv = { n: [u + d + i, v + d + j], s: [u + 2 * d + w + (w - 1 - i), v + d + j], w: [u + (d - 1 - k), v + d + j], e: [u + d + w + k, v + d + j],
      u: [u + d + i, v + (d - 1 - k)], d: [u + d + w + i, v + (d - 1 - k)] }[f];
    const c = (GUARDIAN_TEX[uv[1]] || '')[uv[0]];
    return c && c !== '.' ? c : null;
  }
  const inBox = (b, x, y, z) => x >= b[0] && x < b[0] + b[3] && y >= b[1] && y < b[1] + b[4] && z >= b[2] && z < b[2] + b[5];
  /**
   * The twelve spikes: one in the middle of every edge of the 16 px cube, 2 x 9 x 2, turned 45 degrees so it points
   * straight out of the edge (vanilla SPIKE_X/Y/Z and their rotations). World units: X right, Y up, Z toward the viewer.
   * The tip of the spike texture (bright orange) is the outer end.
   */
  const G_SPIKES = (function () {
    const out = [], r = Math.SQRT1_2;
    [-1, 1].forEach((a) => [-1, 1].forEach((b) => {
      out.push({ p: [0, 8 * a, 8 * b], e: [1, 0, 0], n: [0, a * r, b * r] });   // edges along X
      out.push({ p: [8 * a, 0, 8 * b], e: [0, 1, 0], n: [a * r, 0, b * r] });   // along Y
      out.push({ p: [8 * a, 8 * b, 0], e: [0, 0, 1], n: [a * r, b * r, 0] });   // along Z
    }));
    out.forEach((sp) => { const [a, b, c] = sp.n, [d, e, f] = sp.e; sp.m = [b * f - c * e, c * d - a * f, a * e - b * d]; });
    return out;
  })();
  const G_SCALE = { 16: 1, 24: 1.5, 32: 2 };

  /** Guardian: o.size '16' | '24' | '32' (the body's width in blocks), o.tail 'off' | 'on'. Hollow body; solid spikes, tail and fin. */
  function guardianHead(o) {
    const s = G_SCALE[o.size] || 1.5, tail = o.tail === 'on';
    const W = Math.round(24 * s), H = W, Zmin = tail ? -34 : -12, L = Math.round((12 - Zmin) * s);   // -34: whole voxel steps from -12 at every scale, so the head is the same with and without the tail
    const at = (i, j, k) => (j * L + k) * W + i;
    const X = (i) => (i + 0.5) / s - 12, Y = (j) => (j + 0.5) / s - 12, Z = (k) => (k + 0.5) / s + Zmin;
    const boxes = tail ? G_BODY.concat(G_TAIL) : G_BODY;
    // model coordinates of a voxel centre: x = X, y = 16 - Y, z = -Z
    const solid = new Uint8Array(W * H * L);
    for (let j = 0; j < H; j++) for (let k = 0; k < L; k++) for (let i = 0; i < W; i++) {
      const x = X(i), y = 16 - Y(j), z = -Z(k);
      if (G_BODY.some((b) => inBox(b, x, y, z))) solid[at(i, j, k)] = 1;
      else if (tail && G_TAIL.some((b) => inBox(b, x, y, z))) solid[at(i, j, k)] = 2;   // the tail is solid: hollow segments would only touch at their corners
    }
    // a body block is on the surface when a neighbour is not body (the tail counts as outside, so the back wall stays
    // closed behind it and the tail sits on it); a tail block when a neighbour is empty
    const isSolid = (i, j, k, only) => i >= 0 && j >= 0 && k >= 0 && i < W && j < H && k < L && (only ? solid[at(i, j, k)] === only : solid[at(i, j, k)] > 0);
    // faces in the order that wins on an edge: front, top, sides, back, bottom ([di, dj, dk, model face])
    const DIRS = [[0, 0, 1, 'n'], [0, 1, 0, 'u'], [-1, 0, 0, 'w'], [1, 0, 0, 'e'], [0, 0, -1, 's'], [0, -1, 0, 'd']];
    const out = new Array(W * H * L).fill(null);
    const eps = 1e-6;
    for (let j = 0; j < H; j++) for (let k = 0; k < L; k++) for (let i = 0; i < W / 2; i++) {
      const x = X(i), y = 16 - Y(j), z = -Z(k), id = at(i, j, k);
      if (solid[id]) {
        let c = null, face = null;
        for (const [di, dj, dk, f] of DIRS) {
          if (isSolid(i + di, j + dj, k + dk, solid[id] === 1 ? 1 : 0)) continue;
          if (!face) face = f;
          const nx = x + di / s, ny = y - dj / s, nz = z - dk / s;
          for (const b of boxes) if (inBox(b, x, y, z) && !inBox(b, nx, ny, nz)) { c = gTexel(b, f, x, y, z); if (c) break; }
          if (c) { face = f; break; }
        }
        if (!face) { if (solid[id] === 2) out[id] = 'P'; continue; }   // inside: the body is hollow, the tail solid
        // the eye: a 2 x 2 x 1 box just in front of the face, centred (it follows the player in the game)
        if (face === 'n' && z < -7 && Math.abs(x) <= 1 + eps && y >= 15 - eps && y <= 17 + eps) c = 'R';
        out[id] = c || 'P';
        continue;
      }
      let sp = null;
      for (const S of G_SPIKES) {
        const dx = x - S.p[0], dy = Y(j) - S.p[1], dz = Z(k) - S.p[2];
        const al = dx * S.n[0] + dy * S.n[1] + dz * S.n[2];
        if (Math.abs(al) > 4.5 + eps) continue;
        if (Math.abs(dx * S.e[0] + dy * S.e[1] + dz * S.e[2]) > 1 + eps || Math.abs(dx * S.m[0] + dy * S.m[1] + dz * S.m[2]) > 1 + eps) continue;
        const tip = 4.5 - al;   // texture rows from the tip: bright orange, then orange, then the dark base
        sp = tip < 1.5 ? 'O' : tip < 7.5 ? 'o' : 'T';
        break;
      }
      if (sp) { out[id] = sp; continue; }
      if (tail && x >= G_FIN[0] - eps && y >= G_FIN[1] && y < G_FIN[1] + G_FIN[4] && z >= G_FIN[2] && z < G_FIN[2] + G_FIN[5]) out[id] = gTexel(G_FIN, 'w', x, y, z);
    }
    for (let j = 0; j < H; j++) for (let k = 0; k < L; k++) for (let i = W / 2; i < W; i++) out[at(i, j, k)] = out[at(W - 1 - i, j, k)];
    const name = 'Guardian head ' + (o.size || '24') + (tail ? ' with tail' : '');
    return TH.builds.core.trim(TH.builds.core.fromFunction([W, H, L], (i, j, k) => { const c = out[at(i, j, k)]; return c ? GUARDIAN_BLOCK[c] : null; }, name));
  }

  // creeper head (8 x 8 x 8 box at texture 0,0): top 8..16 x 0..8, bottom 16..24, then the sides in a row at y 8..16:
  // right side 0..8, face 8..16, left side 16..24, back 24..32
  const CREEPER_TEX = [
    '........GPPPPMPGGPPGMPPP........',
    '........MMPPPMPMGPGGPMPP........',
    '........GGMPGWPPPPGPMPGP........',
    '........GGMGGPGGPPWWWGGP........',
    '........GGPPGWGGWGGWWGMP........',
    '........MGPMWMWGPPGWMGMP........',
    '........PPMGPMMMMGWMMPGG........',
    '........GGMMWMPMGPGGPMPG........',
    'GGPGGMGGPMGPWPGMGGPMGMGGWGGWPPGM',
    'GMPMGPGPMGGGMPGWGMWMMPGWMPGMMGGP',
    'MWPPPMMPGDDPMDDWMWPGMMMWPGWMMGPG',
    'GWGGPPPPGDKGGKDGPWGGWPPWPGPGMPMG',
    'GPGMGGGPPGPDDWMGGWPGWPGPPGWGGPMP',
    'GPMMMGGPPMDKKDPPGWMGWGGPPMPGMPGW',
    'MPGMMGPPPMKKKKGMMWPMMGWWPMMGWGGM',
    'GWPPPGPMPPDPPDMGGPPPWGWMGGMPPGMG',
  ];
  const CREEPER_BLOCK = {
    K: 'minecraft:black_concrete', D: 'minecraft:green_concrete', M: 'minecraft:green_wool', G: 'minecraft:lime_concrete', P: 'minecraft:lime_wool', W: 'minecraft:white_concrete',
  };
  /** Creeper: o.size '16' | '24' | '32' (the cube's side), each texel a 2, 3 or 4 block square; the face looks south. Hollow. */
  function creeperHead(o) {
    const s = { 16: 2, 24: 3, 32: 4 }[o.size] || 3, N = 8 * s;
    const t = (u, v) => CREEPER_TEX[v][u];
    return TH.builds.core.fromFunction([N, N, N], (i, j, k) => {
      if (i > 0 && j > 0 && k > 0 && i < N - 1 && j < N - 1 && k < N - 1) return null;   // hollow
      const m = i < N / 2 ? i : N - 1 - i;   // the right half mirrors the left half
      const c = Math.floor(m / s), r = 7 - Math.floor(j / s), q = Math.floor(k / s);
      let ch;
      if (k === N - 1) ch = t(8 + c, 8 + r);   // the face
      else if (j === N - 1) ch = t(8 + c, q);   // top
      else if (m === 0) ch = t(q, 8 + r);   // the sides (the mob's right side, mirrored on the left)
      else if (k === 0) ch = t(31 - c, 8 + r);   // back
      else ch = t(16 + c, q);   // bottom
      return CREEPER_BLOCK[ch] || CREEPER_BLOCK.G;
    }, 'Creeper head ' + (o.size || '24'));
  }

  /** A build's options with every missing or unknown value set to its default ({} for builds without options). */
  function options(id, o) {
    const f = FARMS.find((x) => x.id === id), out = {};
    ((f && f.opts) || []).forEach((op) => { const v = o && o[op.id]; out[op.id] = op.choices.some((c) => c[0] === v) ? v : op.def; });
    return out;
  }
  const cache = new Map();
  /** The farm's original schematic (built once per option set, never modified: callers get a fresh copy when they need to change it). */
  function schematic(id, o) {
    const f = FARMS.find((x) => x.id === id);
    if (!f) return null;
    const opt = options(id, o), ck = f.make ? id + '|' + JSON.stringify(opt) : id;
    let s = cache.get(ck);
    if (!s) { s = f.make ? f.make(opt) : TH.builds.io.fromJSON({ name: f.name, legend: f.legend, layers: f.layers }); cache.set(ck, s); }
    return s;
  }

  FARMS.forEach((f) => { f.cat = f.cat || 'farm'; });

  TH.builds.farms = { FARMS, PLANNED, DIMS, schematic, options, phases, hasPhases: (id) => !!PHASES[id] };
})();
