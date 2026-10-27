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
      tags: ['statue', 'mob-head', 'ocean', 'creature'],
      pitch: 'The ocean monument guardian as a giant statue: prismarine body, the big eye with its red pupil and twelve orange spikes, one on every edge. Perfectly symmetric.',
      how: 'Made from the real mob: the game’s guardian model and texture, every texture pixel matched to the block with the closest colour. The spikes sit where the game puts them, in the middle of each edge at 45 degrees.',
      opts: [
        { id: 'size', label: 'Body width in blocks', def: '32', choices: [['16', '16', 'Body 16 blocks wide: one block per texture pixel'], ['24', '24', 'Body 24 blocks wide: one and a half blocks per pixel, so the pixels are one or two blocks wide'],
          ['32', '32', 'Body 32 blocks wide: two blocks per pixel'], ['48', '48', 'Body 48 blocks wide: three blocks per pixel'], ['64', '64', 'Body 64 blocks wide: four blocks per pixel']] },
        { id: 'tail', label: 'Tail', def: 'off', choices: [['off', 'Head only', 'Just the head with its spikes'], ['on', 'With tail', 'The three tail segments and the fin, straight back from the head']] },
      ],
      make: (o) => guardianHead(o),
      steps: [
        'Pick a size: 16, 32, 48 and 64 give every texture pixel the same width. Lay the bottom plate first, then go up layer by layer: the body is a hollow box with notched edges, one block thick.',
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
      tags: ['statue', 'mob-head', 'pixel-art', 'creature'],
      pitch: 'A giant creeper head: the famous face on the front and the mottled green skin on the other five sides, copied pixel by pixel from the game texture.',
      how: 'Every pixel of the creeper’s 8 x 8 head texture becomes a square of blocks. Six tones: black and green concrete for the face, lime concrete, lime wool, green wool and white concrete for the skin.',
      opts: [
        { id: 'size', label: 'Size in blocks', def: '24', choices: [8, 16, 24, 32, 48, 64, 96].map((n) => [String(n), String(n), n + ' blocks a side: ' + (n === 8 ? 'one block per texture pixel' : 'each texture pixel is ' + n / 8 + ' x ' + n / 8 + ' blocks')]) },
      ],
      make: (o) => creeperHead(o),
      steps: [
        'Pick a size: every texture pixel is a square of blocks, from one block at size 8 to 12 x 12 at size 96.',
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
    {
      id: 'kraken_tentacles', cat: 'build', dim: 'overworld', icon: 'item/squid_spawn_egg', level: 'Hard', name: 'Kraken tentacles',
      art: ['entity/squid/squid', 64, 32, 12, 12, 12, 16],
      tags: ['statue', 'ocean', 'creature'],
      pitch: 'A sea monster breaking the surface: thick tentacles rise out of a pond, one tall question mark, one arch diving back in, coiled tips, suckers on the underside and foam where they meet the water.',
      how: 'Each tentacle follows a drawn curve and is built as a round tube that thins from several blocks at the water to one block at the tip. They all grow from a body lying on the pond floor, so the creature is one piece, and it is hollow inside.',
      opts: [
        { id: 'count', label: 'Tentacles', unit: 'tentacles', def: '5', choices: [['3', '3', 'Three tentacles: the tall curl, the arch and a coil'], ['5', '5', 'Five tentacles: adds a sideways hook and a low wave'], ['7', '7', 'Seven tentacles: adds two small curls in the gaps']] },
        { id: 'size', label: 'Height in blocks', def: '35', choices: [['20', '20', 'Small: 20 blocks high'], ['35', '35', 'Medium: 35 blocks high'], ['60', '60', 'Giant: 60 blocks high']] },
        { id: 'colour', label: 'Colour', def: 'purple', look: true, choices: [['purple', 'Purple', 'Kraken purple: purple terracotta skin, purple concrete spots, magenta terracotta belly, pink suckers'], ['green', 'Sea green', 'Deep sea green: dark prismarine skin, prismarine spots and belly, glowing sea lantern suckers'], ['red', 'Red', 'Octopus red: red terracotta skin, orange spots, pink belly, white terracotta suckers']] },
        { id: 'pond', label: 'Water', def: 'pond', choices: [['pond', 'With pond', 'A round pond with a sand and gravel floor and a low shore'], ['none', 'Tentacles only', 'Just the creature and its foam, to sink into a lake you already have']] },
      ],
      make: (o) => krakenTentacles(o),
      steps: [
        'With the pond: dig a round hole as deep as the water, lay the sand and gravel floor and build the low shore around it.',
        'Build the body on the floor first: a flat dome that stays one block under the water line. Every tentacle starts inside it.',
        'Raise the tentacles layer by layer with "Only this layer": each one is a ring of blocks that drifts sideways as it climbs and gets smaller toward the tip.',
        'Put the suckers on the inside of every curve: lighter blocks in two staggered rows on the thick parts, single dots near the tip.',
        'Fill the pond with water last, then set the white foam ring around each tentacle on the surface, with a few calcite flecks just outside it.',
      ],
      tips: [
        'The Material list counts one water bucket per water block. Two buckets make an endless source, so you only need a few.',
        'Tentacles only: the body sits under the water, so the lake must be as deep as the water here. Line the foam rings up with the surface.',
        'It is hollow: a hidden room in the body or a sea lantern inside a tentacle tip is easy to add.',
        'Sea green suckers are sea lanterns and light the water at night. Swap the skin in Customise blocks for any colour you like.',
      ],
    },
    {
      id: 'creeper_rocket', cat: 'build', dim: 'overworld', icon: 'item/firework_rocket', level: 'Hard', name: 'Creeper rocket',
      tags: ['statue', 'mob-head', 'pixel-art', 'creature'],
      pitch: 'A rocket that houses your farms: a creeper head cube (face on all four sides) with room for a 27 x 27 farm, a tall round sugar cane body, twenty green stalks round it, with a round room about 34 across for a cane farm, and a slim needle nose with a 2 x 1 AFK chamber near its point. 36 x 36, so it fits a 36 x 36 plot. At 127 high it covers y 63 to 189: base at y 63, the point at y 189.',
      how: 'The head is a perfect 32 block cube, four blocks per texture pixel, hollow: 30 x 30 x 30 inside. The round body, 36 wide and twice as tall as the nose, holds a round room about 34 across. Its wall is twenty sugar cane stalks, 4 blocks each, shaded like the cane texture from a lit side to a dark edge, with a pale node band over a dark line every 8 rows, each stalk at its own height, and a little leaf beside each node; sandstone (or glass) shows only in the narrow gaps. The nose is a light grey cone that narrows to a 6 wide neck round the chamber and ends in a dark 2 wide point. The three rooms are sealed from each other. Every open top outside is a slab or a stair, so nothing spawns on the outside; the farm rooms are left empty for you.',
      opts: [
        { id: 'size', label: 'Height in blocks', def: '127', choices: [['100', '100', '100 blocks high: a shorter cane body'], ['127', '127', 'Covers y 63 to 189, the AFK chamber at the top']] },
        { id: 'flames', label: 'Flames', def: 'on', choices: [['on', 'With flames', 'Yellow, orange and red flames from the nozzle down to the ground, 18 blocks wide at the narrowest'], ['off', 'No flames', 'The rocket stands on its four fins, the 20 block nozzle open below']] },
        { id: 'colour', label: 'Creeper colour', def: 'charged', look: true, choices: [['charged', 'Charged', 'Charged blue head: light blue and cyan skin, a dark blue and black face'], ['grey', 'Grey', 'Stone grey head: stone, andesite and tuff, a grey and black face'], ['ember', 'Ember', 'Ember head: orange and red terracotta, a dark red and black face'], ['green', 'Green', 'The real creeper greens']] },
        { id: 'fill', label: 'Cane wall', def: 'sandy', look: true, choices: [['sandy', 'Sandy', 'Smooth, cut and plain sandstone between the green stalks'], ['glass', 'Glass', 'Glass between the stalks: the cane farm inside shows'], ['mixed', 'Mixed', 'Sandstone with bands of glass windows']] },
        { id: 'wear', label: 'Wear', def: 'weathered', look: true, choices: [['clean', 'Clean', 'Fresh: no moss, no cracks, no rust'], ['weathered', 'Weathered', 'A few moss and cobblestone patches, cracked bricks and short rust streaks'], ['rusty', 'Rusty', 'Old and rusty: more moss, cobblestone and cracked bricks, long rust streaks']] },
      ],
      make: (o) => creeperRocket(o),
      steps: [
        'Mark a 36 x 36 square with its bottom at y 63 (the 127 high rocket then ends at y 189). The four grey fins stand on its corners; with flames, the flame column stands in the middle.',
        'Build the flames and the deepslate bell nozzle, then the creeper head on top: a 32 block cube with a closed floor and roof, the face on every side, four blocks per pixel. Build your farm inside before you close the roof.',
        'Raise the round body wall straight on the roof of the head (the roof is the floor of the cane room), with andesite upside-down stairs under its overhang and carpets in the colour of the roof on the four corners of the head. Go layer by layer with "Only this layer": a tuff and andesite ring, then twenty green stalks 4 blocks wide (lime wool, lime concrete, bamboo block, green wool, darker low down), a bone node band over a lime terracotta line every 8 rows, sandstone (or glass) in the gaps. Build the cane farm inside as you go.',
        'Close it with the second grey ring and the nose: a dark band, then light grey rings that get smaller every layer, each step a stair or a slab, down to a 6 wide neck.',
        'In the neck, build the AFK chamber: two blocks of slab floor, three blocks of air above it, one block of deepslate round it and a roof; then the dark point on top, 4 and then 2 blocks wide, its last slabs the highest blocks.',
      ],
      tips: [
        'Spawn-proofed outside: no full block has open air on top. The farm rooms are yours to light or slab as the farm needs.',
        'The AFK chamber is sealed: break in through a wall or the floor with a pickaxe and close it behind you.',
        'The grey is andesite, smooth stone and stone with tuff bands and a little cobblestone; it darkens to tuff and deepslate toward the tip.',
        'Cane wall Glass shows the farm inside; the stalks stay green either way. The sandstone is never sand, so nothing falls.',
      ],
    },
    {
      id: 'creeper_launcher', cat: 'build', dim: 'overworld', icon: 'item/firework_rocket', level: 'Hard', name: 'Creeper launcher',
      tags: ['statue', 'mob-head', 'pixel-art', 'creature'],
      pitch: 'The Creeper rocket as a heavy launcher: the creeper head cube, the round sugar cane core and a needle nose with a 2 x 1 AFK chamber and an escape-tower spike, plus two grey boosters strapped east and west with their own nozzles and flames. 64 x 36 with the boosters (36 x 36 core only). At 127 high it covers y 63 to 189: base at y 63, the spike at y 189.',
      how: 'The core is the Creeper rocket: a perfect 32 block creeper cube (exactly 32 rows, its roof the top one) with room for a 27 x 27 farm, a round cane body with a room about 34 across, a needle nose round the sealed AFK chamber. The cane is all greens from the sugar cane palette (lit side, mid, shade, dark edge, pale node rims over dark node bands, bright leaves) with sand or glass between the stalks and three sandstone bands. The boosters are 14 wide hollow columns of smooth stone, andesite and stone with dark blackstone rings, braced to the head and touching the core. Every open top outside is a slab, a stair or a carpet; the farm rooms stay empty.',
      opts: [
        { id: 'size', label: 'Height in blocks', def: '127', choices: [['100', '100', '100 blocks high: a shorter cane body'], ['127', '127', 'Covers y 63 to 189, the AFK chamber near the top']] },
        { id: 'flames', label: 'Flames', def: 'on', choices: [['on', 'With flames', 'Flames from every nozzle down to the ground'], ['off', 'No flames', 'The rocket stands on its fins and the boosters\' nozzles']] },
        { id: 'boosters', label: 'Boosters', def: 'on', choices: [['on', 'With boosters', 'Two 14 wide boosters east and west: 64 x 36 in all'], ['off', 'Core only', 'Just the core, 36 x 36, to compare']] },
        { id: 'colour', label: 'Creeper colour', def: 'charged', look: true, choices: [['charged', 'Charged', 'Charged blue head: light blue and cyan skin, a dark blue and black face'], ['grey', 'Grey', 'Stone grey head: stone, andesite and tuff, a grey and black face'], ['ember', 'Ember', 'Ember head: orange and red terracotta, a dark red and black face'], ['green', 'Green', 'The real creeper greens']] },
        { id: 'fill', label: 'Cane wall', def: 'sandy', look: true, choices: [['sandy', 'Sandy', 'Smooth, cut and plain sandstone between the green stalks'], ['glass', 'Glass', 'Glass between the stalks: the cane farm inside shows'], ['mixed', 'Mixed', 'Sandstone with bands of glass windows']] },
        { id: 'wear', label: 'Wear', def: 'weathered', look: true, choices: [['clean', 'Clean', 'Fresh: no moss, no cracks, no rust'], ['weathered', 'Weathered', 'A few moss and cobblestone patches, cracked bricks'], ['rusty', 'Rusty', 'Old: more moss, cobblestone and cracked bricks, rust patches on the grey']] },
      ],
      make: (o) => creeperRocket(o, { launcher: true }),
      steps: [
        'Mark a 64 x 36 area (36 x 36 without boosters) with its bottom at y 63. The core stands in the middle, a booster 25 blocks to each side of its centre.',
        'Build the flames and nozzles first, the big one under the core and a smaller one under each booster, then the creeper head on the core: a 32 block cube, four blocks per pixel, the face on every side, the roof as its 32nd row.',
        'Raise both boosters with the head: hollow 14 wide columns with a blackstone ring every 10 rows, braced to the head at three heights.',
        'Raise the round cane body straight on the roof of the head, layer by layer with "Only this layer": twenty 4 wide green stalks with their nodes, sand or glass between them, three sandstone bands.',
        'Close the boosters with their cones and the core with its needle nose: the AFK chamber in the neck, the escape-tower spike above it as the highest block.',
      ],
      tips: [
        'Spawn-proofed outside: no full block has open air on top. The farm rooms are yours to light or slab as the farm needs.',
        'The AFK chamber is sealed: break in through a wall or the floor with a pickaxe and close it behind you.',
        'Boosters Core only gives the plain core with the new cane and spike, to compare with the Creeper rocket.',
        'The boosters are hollow and sealed too, with stone buttons on their floors so nothing spawns inside.',
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
  const G_SCALE = { 16: 1, 24: 1.5, 32: 2, 48: 3, 64: 4 };   // 8 and 12 were tried: the spikes fall apart into loose diagonal blocks and the pupil vanishes

  /** Guardian: o.size '16' | '24' | '32' | '48' | '64' (the body's width in blocks), o.tail 'off' | 'on'. Hollow body; solid spikes, tail and fin. */
  function guardianHead(o) {
    const s = G_SCALE[o.size] || 2, tail = o.tail === 'on';
    const W = Math.round(24 * s), H = W, Zmin = tail ? -34 : -12, L = Math.round((12 - Zmin) * s);   // -34: whole voxel steps from -12 at every scale, so the head is the same with and without the tail
    const at = (i, j, k) => (j * L + k) * W + i;
    const X = (i) => (i + 0.5) / s - 12, Y = (j) => (j + 0.5) / s - 12, Z = (k) => (k + 0.5) / s + Zmin;
    const boxes = tail ? G_BODY.concat(G_TAIL) : G_BODY;
    // model coordinates of a voxel centre: x = X, y = 16 - Y, z = -Z
    const solid = new Uint8Array(W * H * L);
    // a box as voxel index ranges [i0, i1) per axis (the voxel centre inside the box), filled range by range: the giant
    // sizes have millions of cells, so nothing is tested per cell
    const span = (n, f, lo, hi) => { let a = n, b = 0; for (let t = 0; t < n; t++) { const v = f(t); if (v >= lo && v < hi) { if (t < a) a = t; b = t + 1; } } return [a, b]; };
    const fill = (b, v) => {
      const [i0, i1] = span(W, X, b[0], b[0] + b[3]), [j0, j1] = span(H, (j) => 16 - Y(j), b[1], b[1] + b[4]), [k0, k1] = span(L, (k) => -Z(k), b[2], b[2] + b[5]);
      for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) if (!solid[at(i, j, k)]) solid[at(i, j, k)] = v;
    };
    G_BODY.forEach((b) => fill(b, 1));
    if (tail) G_TAIL.forEach((b) => fill(b, 2));   // the tail is solid: hollow segments would only touch at their corners
    // a body block is on the surface when a neighbour is not body (the tail counts as outside, so the back wall stays
    // closed behind it and the tail sits on it); a tail block when a neighbour is empty
    const isSolid = (i, j, k, only) => i >= 0 && j >= 0 && k >= 0 && i < W && j < H && k < L && (only ? solid[at(i, j, k)] === only : solid[at(i, j, k)] > 0);
    // faces in the order that wins on an edge: front, top, sides, back, bottom ([di, dj, dk, model face])
    const DIRS = [[0, 0, 1, 'n'], [0, 1, 0, 'u'], [-1, 0, 0, 'w'], [1, 0, 0, 'e'], [0, 0, -1, 's'], [0, -1, 0, 'd']];
    const out = new Array(W * H * L).fill(null);
    const eps = 1e-6;
    for (let j = 0; j < H; j++) for (let k = 0; k < L; k++) for (let i = 0; i < W / 2; i++) {
      const id = at(i, j, k);
      if (!solid[id]) continue;
      const x = X(i), y = 16 - Y(j), z = -Z(k);
      {
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
      }
    }
    // the spikes, each only over its own bounding box (the first spike wins where two meet), then the fin
    const near = (n, f, c, hw) => span(n, (t) => Math.abs(f(t) - c) <= hw ? 0 : 1, 0, 0.5);
    for (const S of G_SPIKES) {
      const hw = (a) => 4.5 * Math.abs(S.n[a]) + Math.abs(S.e[a]) + Math.abs(S.m[a]) + eps;
      const [i0, i1] = near(W / 2, X, S.p[0], hw(0)), [j0, j1] = near(H, Y, S.p[1], hw(1)), [k0, k1] = near(L, Z, S.p[2], hw(2));
      for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) {
        const id = at(i, j, k);
        if (solid[id] || out[id]) continue;
        const dx = X(i) - S.p[0], dy = Y(j) - S.p[1], dz = Z(k) - S.p[2];
        const al = dx * S.n[0] + dy * S.n[1] + dz * S.n[2];
        if (Math.abs(al) > 4.5 + eps) continue;
        if (Math.abs(dx * S.e[0] + dy * S.e[1] + dz * S.e[2]) > 1 + eps || Math.abs(dx * S.m[0] + dy * S.m[1] + dz * S.m[2]) > 1 + eps) continue;
        const tip = 4.5 - al;   // texture rows from the tip: bright orange, then orange, then the dark base
        out[id] = tip < 1.5 ? 'O' : tip < 7.5 ? 'o' : 'T';
      }
    }
    if (tail) {
      const [i0, i1] = span(W / 2, X, G_FIN[0] - eps, Infinity), [j0, j1] = span(H, (j) => 16 - Y(j), G_FIN[1], G_FIN[1] + G_FIN[4]), [k0, k1] = span(L, (k) => -Z(k), G_FIN[2], G_FIN[2] + G_FIN[5]);
      for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) {
        const id = at(i, j, k);
        if (!solid[id] && !out[id]) out[id] = gTexel(G_FIN, 'w', X(i), 16 - Y(j), -Z(k));
      }
    }
    for (let j = 0; j < H; j++) for (let k = 0; k < L; k++) for (let i = W / 2; i < W; i++) out[at(i, j, k)] = out[at(W - 1 - i, j, k)];
    const name = 'Guardian head ' + (o.size || '32') + (tail ? ' with tail' : '');
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
  /** Creeper: o.size '8' .. '96' (the cube's side), each texel a square of size / 8 blocks; the face looks south. Hollow. */
  function creeperHead(o) {
    const s = { 8: 1, 16: 2, 24: 3, 32: 4, 48: 6, 64: 8, 96: 12 }[o.size] || 3, N = 8 * s;
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

  /* ======================================================================
   * Kraken tentacles: thick tapering arms rising out of a pond. Every arm is a hand-placed path (a Catmull-Rom spline
   * through a few control points, then a logarithmic curl at the tip), voxelised as a tube of balls whose radius tapers
   * from the base to one block at the tip. The arms grow from a low body that lies on the pond floor under the water,
   * so the whole creature is one piece. Hollow (a shell two blocks deep where it is thick); the water fills the pond
   * around it, never the inside. Fixed seed: the same options always give the same build.
   * ====================================================================== */
  const KRAKEN_COLOURS = {
    purple: { skin: 'purple_terracotta', spot: 'purple_concrete', belly: 'magenta_terracotta', sucker: 'pink_concrete' },
    green: { skin: 'dark_prismarine', spot: 'prismarine', belly: 'prismarine_bricks', sucker: 'sea_lantern' },
    red: { skin: 'red_terracotta', spot: 'orange_terracotta', belly: 'pink_terracotta', sucker: 'white_terracotta' },
  };
  // per height: water layers over the floor, base radius of the arms, body radius, mottle scale
  const KRAKEN_SIZE = { 20: { ws: 3, r0: 2.8, body: 6, spot: 2.5 }, 35: { ws: 4, r0: 4.2, body: 9, spot: 3 }, 60: { ws: 6, r0: 6.2, body: 14, spot: 4 } };
  /**
   * Arm shapes. pts: control points after the waterline [u outward, v up, w sideways] in units of the height above the
   * water (u counts from the ring where the arms leave the body); curl: the tip coils toward 'out' / 'in' / 'side'
   * (turns, start radius as a share of the height); belly: the side the suckers face (the inside of the curl or arch).
   */
  const KRAKEN_ARMS = {
    tower: { w: 1, pts: [[0, 0, 0], [0.06, 0.24, 0.04], [-0.01, 0.5, -0.03], [0.05, 0.72, 0.02], [0.12, 0.86, 0]], curl: { dir: 'out', turns: 1.15, rho: 0.12 } },
    arch: { w: 0.9, pts: [[0, 0, 0], [0.07, 0.3, 0.03], [0.17, 0.5, 0.05], [0.29, 0.49, 0.04], [0.37, 0.24, 0.02], [0.4, 0, 0], [0.41, -1, 0]] },
    coil: { w: 0.85, pts: [[0, 0, 0], [0.08, 0.2, -0.05], [0.16, 0.42, -0.08], [0.15, 0.6, -0.05]], curl: { dir: 'in', turns: 1.4, rho: 0.11 } },
    hook: { w: 0.85, pts: [[0, 0, 0], [0.04, 0.24, 0.05], [0.01, 0.48, 0.12], [0.05, 0.66, 0.17]], curl: { dir: 'side', turns: 1.0, rho: 0.1 } },
    wave: { w: 0.7, pts: [[0, 0, 0], [0.1, 0.14, 0.04], [0.18, 0.28, -0.04], [0.25, 0.32, 0.03], [0.3, 0.42, 0]], curl: { dir: 'out', turns: 0.9, rho: 0.09 } },
    small: { w: 0.55, pts: [[0, 0, 0], [0.05, 0.18, 0.03], [0.1, 0.34, -0.02]], curl: { dir: 'out', turns: 1.2, rho: 0.08 } },
    small2: { w: 0.55, pts: [[0, 0, 0], [0.07, 0.16, -0.03], [0.13, 0.3, 0.02]], curl: { dir: 'in', turns: 1.1, rho: 0.08 } },
  };
  // the arms round the body, evenly spaced from the back (north); the order balances tall and low ones
  const KRAKEN_SETS = { 3: ['tower', 'arch', 'coil'], 5: ['tower', 'arch', 'wave', 'coil', 'hook'], 7: ['tower', 'arch', 'small', 'wave', 'small2', 'coil', 'hook'] };
  /** Smooth value noise in 0..1 on a grid of `sc` blocks (fixed seed). */
  function kNoise(x, y, z, sc, seed) {
    const hash = (a, b, c) => { let n = (a * 374761393 + b * 668265263 + c * 2147483647 + seed * 144269) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const fx = x / sc, fy = y / sc, fz = z / sc, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const s = (t) => t * t * (3 - 2 * t), tx = s(fx - ix), ty = s(fy - iy), tz = s(fz - iz);
    const l = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), tx), l(c(0, 1, 0), c(1, 1, 0), tx), ty), l(l(c(0, 0, 1), c(1, 0, 1), tx), l(c(0, 1, 1), c(1, 1, 1), tx), ty), tz);
  }
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };
  /** One arm as dense samples [{ p, r, t, b }] (point, radius, tangent, belly direction), about 0.2 blocks apart. */
  function krakenArm(arm, az, flip, P) {
    const { H, ws, r0, ring } = P;
    const d = [Math.cos(az), 0, Math.sin(az)], up = [0, 1, 0], sd = [Math.sin(az) * flip, 0, -Math.cos(az) * flip];
    const at = (u, v, w) => v3.add(v3.add(v3.mul(d, ring + u * H), v3.mul(sd, w * H)), [0, ws + v * H, 0]);
    // the base sits inside the body, the first control point is where the arm leaves the water
    const ctrl = [v3.add(v3.mul(d, ring * 0.55), [0, 1 + r0 * 0.3, 0])].concat(arm.pts.map(([u, v, w]) => v === -1 ? v3.add(at(u, 0, w), [0, 1 - ws, 0]) : at(u, v, w)));
    // the tip curl: a turtle in the plane of the last tangent and the curl direction, turning at a fixed rate while its
    // radius shrinks; it stops before the coil gets too tight to show its hole
    if (arm.curl) {
      const n = ctrl.length, T0 = v3.norm(v3.sub(ctrl[n - 1], ctrl[n - 2]));
      const K0 = arm.curl.dir === 'out' ? d : arm.curl.dir === 'in' ? v3.mul(d, -1) : sd;
      const K = v3.norm(v3.sub(K0, v3.mul(T0, v3.dot(K0, T0))));
      let p = ctrl[n - 1], ang = 0, rho = arm.curl.rho * H * arm.w;
      const dA = 0.24, end = arm.curl.turns * 2 * Math.PI;
      const pts = [];
      while (ang < end && rho > 1.7) {
        ang += dA;
        const T = v3.add(v3.mul(T0, Math.cos(ang)), v3.mul(K, Math.sin(ang)));
        p = v3.add(p, v3.mul(T, rho * dA));
        pts.push(p);
        rho *= 0.972;
      }
      // keep every third turtle point as a spline point (the spline smooths between them)
      pts.forEach((q, i) => { if (i % 3 === 2 || i === pts.length - 1) ctrl.push(q); });
      arm.curlK = K;
    }
    // Catmull-Rom through the control points
    const C = [ctrl[0]].concat(ctrl, [ctrl[ctrl.length - 1]]), raw = [];
    for (let i = 1; i < C.length - 2; i++) {
      const p0 = C[i - 1], p1 = C[i], p2 = C[i + 1], p3 = C[i + 2], steps = Math.max(2, Math.ceil(v3.len(v3.sub(p2, p1)) / 0.2));
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        raw.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    raw.push(ctrl[ctrl.length - 1]);
    let L = 0;
    const len = raw.map((q, i) => (L += i ? v3.len(v3.sub(q, raw[i - 1])) : 0));
    // the belly: perpendicular to the arm in its own plane, turned toward the inside of the curl (or of the arch)
    const Pn = arm.curl ? v3.norm(v3.cross(v3.norm(v3.sub(ctrl[ctrl.length - 1], ctrl[ctrl.length - 2])), arm.curlK)) : sd;
    const rB = r0 * arm.w, rT = 0.9;
    const out = raw.map((p, i) => {
      const T = v3.norm(v3.sub(raw[Math.min(raw.length - 1, i + 1)], raw[Math.max(0, i - 1)]));
      return { p, t: T, s: len[i], r: rT + (rB - rT) * Math.pow(1 - len[i] / L, 0.75), b: v3.norm(v3.cross(Pn, T)) };
    });
    // one sign for the whole arm: at the curl start the belly faces the curl, on the arch it faces down at the top
    const ref = arm.curl ? out[Math.round(out.length * 0.85)] : out.reduce((a, b) => (b.p[1] > a.p[1] ? b : a));
    const hint = arm.curl ? arm.curlK : [0, -1, 0];
    if (v3.dot(ref.b, hint) < 0) out.forEach((q) => { q.b = v3.mul(q.b, -1); });
    out.L = L;
    return out;
  }

  /** o.count '3' | '5' | '7', o.size '20' | '35' | '60' (height in blocks), o.colour 'purple' | 'green' | 'red', o.pond 'pond' | 'none'. */
  function krakenTentacles(o) {
    const n = +o.count || 5, Z = KRAKEN_SIZE[o.size] || KRAKEN_SIZE[35], pal = KRAKEN_COLOURS[o.colour] || KRAKEN_COLOURS.purple, pond = o.pond !== 'none';
    const Htot = +o.size || 35, ws = Z.ws, r0 = Z.r0;
    // the arms leave the water on a ring wide enough that neighbours keep a gap; the body reaches just past it
    const ring = Math.max(Z.body * 0.75, (n * (2 * r0 + 2.5)) / (2 * Math.PI));
    const A = ring + r0 * 0.9, Bv = ws - 1.5;
    const P = { H: Htot - ws - 1, ws, r0, ring };
    const arms = KRAKEN_SETS[n] || KRAKEN_SETS[5];
    const make = () => arms.map((id, i) => krakenArm(Object.assign({}, KRAKEN_ARMS[id]), -Math.PI / 2 + (i * 2 * Math.PI) / arms.length, i % 2 ? -1 : 1, P));
    let samples = make();
    // stretch the drawing once so the tallest tip ends exactly at the chosen height
    const top = Math.max(...samples.map((sm) => Math.max(...sm.map((q) => q.p[1] + q.r))));
    P.H *= (Htot - 0.5 - ws) / (top - ws);
    samples = make();
    // the grid: centre (0, 0), floor at y 0, voxel centres on whole numbers
    let R = A + 1;
    samples.forEach((sm) => sm.forEach((q) => { R = Math.max(R, Math.hypot(q.p[0], q.p[2]) + q.r + 2); }));
    let Rp = A + 3;   // the pond: everything that touches the water, plus room for the foam
    samples.forEach((sm) => sm.forEach((q) => { if (q.p[1] - q.r <= ws + 0.5) Rp = Math.max(Rp, Math.hypot(q.p[0], q.p[2]) + q.r + 2.5); }));
    Rp = Math.ceil(Rp);
    const ext = Math.ceil(Math.max(R, Rp + 3)), SX = 2 * ext + 1, SY = Htot + 6, SZ = SX;
    const at = (x, y, z) => (y * SZ + (z + ext)) * SX + (x + ext);
    const solid = new Uint8Array(SX * SY * SZ);   // 1 body, 2 arm
    const own = new Int32Array(SX * SY * SZ).fill(-1), best = new Float32Array(SX * SY * SZ).fill(9);
    const flat = [];   // every sample, with its arm
    samples.forEach((sm, ai) => sm.forEach((q) => { q.arm = ai; flat.push(q); }));
    // the body: a flat half ellipsoid on the floor, its top one block under the surface
    for (let y = 1; y <= ws - 1; y++) for (let z = -Math.ceil(A); z <= Math.ceil(A); z++) for (let x = -Math.ceil(A); x <= Math.ceil(A); x++) {
      if ((x * x + z * z) / (A * A) + ((y - 1) * (y - 1)) / (Bv * Bv) <= 1) solid[at(x, y, z)] = 1;
    }
    // the arms: a ball per sample; each block remembers its nearest sample (relative to the radius) for the colours
    flat.forEach((q, qi) => {
      const [px, py, pz] = q.p, r = q.r, r2 = r * r, rc = Math.ceil(r);
      for (let y = Math.max(0, Math.round(py) - rc); y <= Math.min(SY - 1, Math.round(py) + rc); y++) for (let z = Math.round(pz) - rc; z <= Math.round(pz) + rc; z++) for (let x = Math.round(px) - rc; x <= Math.round(px) + rc; x++) {
        const ex = x - px, ey = y - py, ez = z - pz, d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > r2) continue;
        const i = at(x, y, z), dn = d2 / r2;   // squared: the same order as the distance over the radius
        if (!solid[i]) solid[i] = 2;
        if (dn < best[i]) { best[i] = dn; own[i] = qi; }
      }
    });
    // a core line through the nearest blocks of the samples, one axis step at a time: every arm is one piece
    samples.forEach((sm) => {
      let c = sm[0].p.map(Math.round);
      sm.forEach((q) => {
        const g = q.p.map(Math.round);
        while (c[0] !== g[0] || c[1] !== g[1] || c[2] !== g[2]) {
          const a = c[0] !== g[0] ? 0 : c[1] !== g[1] ? 1 : 2;
          c = c.slice(); c[a] += Math.sign(g[a] - c[a]);
          const i = at(c[0], c[1], c[2]);
          if (!solid[i]) solid[i] = 2;
        }
      });
    });
    const inS = (x, y, z) => y >= 0 && y < SY && x >= -ext && x <= ext && z >= -ext && z <= ext && solid[at(x, y, z)] > 0;
    const out = new Array(SX * SY * SZ).fill(null);
    // hollow: a block stays when one of its 26 neighbours is outside
    for (let y = 0; y < SY; y++) for (let z = -ext; z <= ext; z++) for (let x = -ext; x <= ext; x++) {
      const i = at(x, y, z);
      if (!solid[i]) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !inS(x + dx, y + dy, z + dz)) { edge = true; break; }
      if (!edge) continue;
      const q = own[i] >= 0 ? flat[own[i]] : null;
      let c = kNoise(x, y, z, Z.spot, 7) > 0.68 ? pal.spot : pal.skin;
      if (q && solid[i] === 2) {
        const side = v3.dot(v3.sub([x, y, z], q.p), q.b) / Math.max(0.5, q.r);
        if (side > 0.42) c = pal.belly;
      }
      out[i] = c;
    }
    // suckers: on the belly every few blocks, two staggered rows on thick arms, one dot each near the tip
    samples.forEach((sm, ai) => {
      let next = 0;
      sm.forEach((q, k) => {
        if (q.s < next || q.p[1] < 1.5 || k > sm.length - 4) return;
        const rs = Math.max(0.5, Math.min(1.5, 0.3 * q.r));
        next = q.s + 2 * rs + 1.3;
        const side = v3.norm(v3.cross(q.t, q.b)), zig = q.r >= 2.6 ? (Math.round(q.s / (2 * rs + 1.3)) % 2 ? 0.55 : -0.55) : 0;
        const dir = v3.norm(v3.add(v3.mul(q.b, Math.cos(zig)), v3.mul(side, Math.sin(zig))));
        const c = v3.add(q.p, v3.mul(dir, q.r));
        const rc = Math.ceil(rs + 1);
        const hits = [];
        for (let y = Math.round(c[1]) - rc; y <= Math.round(c[1]) + rc; y++) for (let z = Math.round(c[2]) - rc; z <= Math.round(c[2]) + rc; z++) for (let x = Math.round(c[0]) - rc; x <= Math.round(c[0]) + rc; x++) {
          if (y < 0 || y >= SY) continue;
          const i = at(x, y, z);
          if (!out[i] || solid[i] !== 2 || own[i] < 0 || flat[own[i]].arm !== ai) continue;
          if (Math.hypot(x - c[0], y - c[1], z - c[2]) <= rs + 0.35) { out[i] = pal.sucker; hits.push(i); }
        }
        // big suckers stand out one block from the skin, in the middle
        if (rs >= 1.1 && hits.length) {
          const e = v3.add(c, v3.mul(dir, 0.9)).map(Math.round);
          const i = at(e[0], e[1], e[2]);
          if (e[1] > 0 && e[1] < SY && !solid[i] && [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => hits.includes(at(e[0] + dx, e[1] + dy, e[2] + dz)))) { out[i] = pal.sucker; solid[i] = 3; }
        }
      });
    });
    // foam on the water line: a white ring hugging every arm, dotted spray one block further out
    const foam = new Uint8Array(SX * SY * SZ);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let z = -ext; z <= ext; z++) for (let x = -ext; x <= ext; x++) {
      const i = at(x, ws, z);
      if (solid[i] || Math.hypot(x, z) > Rp - 0.5) continue;
      if (N4.some(([dx, dz]) => solid[at(x + dx, ws, z + dz)] === 2)) { foam[i] = 1; out[i] = 'white_concrete'; }
    }
    for (let z = -ext; z <= ext; z++) for (let x = -ext; x <= ext; x++) {
      const i = at(x, ws, z);
      if (solid[i] || foam[i] || Math.hypot(x, z) > Rp - 0.5) continue;
      if (N4.some(([dx, dz]) => foam[at(x + dx, ws, z + dz)] === 1) && kNoise(x * 3.7, 0, z * 3.7, 1, 11) > 0.55) { foam[i] = 2; out[i] = 'calcite'; }
    }
    // the pond: a sand and gravel floor, water up to the surface, a low shore of sand, gravel and prismarine
    if (pond) {
      const ground = (x, z) => { const k = kNoise(x, 0, z, 3, 3); return k > 0.7 ? 'gravel' : k < 0.22 ? 'clay' : 'sand'; };
      const shore = (x, y, z) => { const k = kNoise(x, y, z, 2.5, 5); return k > 0.66 ? 'prismarine' : k < 0.3 ? 'gravel' : 'sand'; };
      for (let z = -ext; z <= ext; z++) for (let x = -ext; x <= ext; x++) {
        const dd = Math.hypot(x, z);
        if (dd <= Rp + 2.6) out[at(x, 0, z)] = dd > Rp + 1.5 ? shore(x, 0, z) : ground(x, z);
        for (let y = 1; y <= ws; y++) {
          const i = at(x, y, z);
          if (out[i] || solid[i]) continue;
          if (dd <= Rp) out[i] = 'water';
          else if (dd <= Rp + 1.5 || (dd <= Rp + 2.6 && y < ws)) out[i] = shore(x, y, z);
        }
      }
    }
    const name = 'Kraken tentacles ' + Htot + (n !== 5 ? ', ' + n + ' arms' : '') + (pond ? '' : ', no pond');
    const C = TH.builds.core;
    return C.trim(C.fromFunction([SX, SY, SZ], (x, y, z) => { const c = out[(y * SZ + z) * SX + x]; return c ? 'minecraft:' + c : null; }, name));
  }

  /* ======================================================================
   * Creeper rocket: a rocket that houses farms. 36 x 36 (fits a 36 x 36 plot), even width so the even creeper cube sits
   * exactly in the middle. Three sealed rooms: the creeper head (30 x 30 x 30 inside, for a farm of about 27 x 27), the
   * sugar cane body (round, about 34 across inside; it runs on up into the nose) and a 2 x 1 AFK chamber, 3 high, in
   * the tip.
   *   bottom  flames (optional, 18 wide at the narrowest) and a deepslate bell nozzle, then the creeper head: a perfect
   *           32 x 32 x 32 cube, 4 blocks per texture pixel, the face on all four sides; Creeper colour recolours only
   *           it. Four grey fins stand on the corners. Upside-down stairs under the body's overhang make the collar.
   *   middle  the sugar cane body, round (a superellipse of power 2.2, barely squarer than a circle), 36 wide, two
   *           thirds of what is above the head: twenty stalks 4 blocks wide shaded like the texture's stalk (lit side to
   *           dark edge), a pale node band over a dark line every 8 rows at each stalk's own height, a leaf in the gap
   *           beside each node; the sandstone, glass or mixed fill only in the narrow gaps; grey rings at both ends.
   *           The head's corners show below it (a round 36 cannot cover a 32 square's corners).
   *   top     a needle nose, a third of what is above the head: a slightly concave light grey cone from the body's width
   *           to a 6 wide neck that holds the AFK chamber, then a dark point 4 and 2 wide, the highest block.
   * Every open top outside is a slab or a stair (spawn-proofing and smoothing); the small sealed pockets in the nozzle
   * and the flames get stone buttons; the farm rooms stay empty. The shape is mirror symmetric on both axes except the
   * 2 x 1 chamber; the wear is seeded noise, the same every time. The default height, 127, covers y 63 to 189.
   * ====================================================================== */
  // texture rows (top = 0) of the pale node row of the four stalks in block/sugar_cane.png (and a fifth set in their
  // rhythm for the diagonal stalk); the dark row is the one under it
  // node heights of the stalks round the body (a node every 8 rows, each stalk at its own height, as the four stalks of
  // block/sugar_cane.png are; the pattern repeats every 5 stalks)
  const CANE_NODES = [0, 4, 7, 2, 5];
  // one stalk, 4 blocks wide, from its lit side to its dark edge, after the texture's 2 pixel stalk (#aadb74 light,
  // #82a859 shade, #698747 edge): the plain rows, the pale node band and the dark line under it
  const CANE_STALK = {
    body: ['lime_wool', 'lime_concrete', 'bamboo_block[axis=y]', 'green_wool'],
    node: ['bone_block[axis=y]', 'bone_block[axis=y]', 'lime_wool', 'lime_concrete'],
    line: ['lime_terracotta', 'lime_terracotta', 'lime_terracotta', 'green_terracotta'],
  };
  const ROCKET_BLOCK = { hot: 'yellow_concrete', glow: 'glowstone', fire: 'orange_concrete', fire2: 'shroomlight', ember: 'red_concrete' };
  /** The creeper head's colour sets: the texture letters (K black and D dark: the face; M, G, P skin from dark to light; W flecks). */
  const ROCKET_CREEPER = {
    charged: { K: 'black_concrete', D: 'blue_concrete', M: 'cyan_concrete', G: 'light_blue_concrete', P: 'light_blue_wool', W: 'white_concrete' },
    grey: { K: 'black_concrete', D: 'gray_concrete', M: 'tuff', G: 'andesite', P: 'stone', W: 'polished_diorite' },
    ember: { K: 'black_concrete', D: 'red_nether_bricks', M: 'red_terracotta', G: 'orange_terracotta', P: 'orange_concrete', W: 'yellow_concrete' },
    green: { K: 'black_concrete', D: 'green_concrete', M: 'green_wool', G: 'lime_concrete', P: 'lime_wool', W: 'white_concrete' },
  };
  // how worn the rocket looks: noise thresholds for moss, worn patches and rust patches (2 = never), the share of
  // columns with a rust streak and the share of cracked bricks in the tuff rings. No copper anywhere.
  const ROCKET_WEAR = {
    clean: { moss: 2, patch: 2, rust: 2, streak: 0, crack: 0 },
    weathered: { moss: 0.84, patch: 0.8, rust: 2, streak: 0.03, crack: 0.15 },
    rusty: { moss: 0.72, patch: 0.74, rust: 0.8, streak: 0.13, crack: 0.4 },
  };
  // grey ramps from light to dark: every grey surface picks along its ramp from a gradient plus dithering noise
  const ROCKET_RAMP = {
    // the base grey: andesite, stone and smooth stone, going into tuff for an older look and deepslate only at the tip
    nose: ['polished_andesite', 'smooth_stone', 'andesite', 'stone', 'tuff', 'polished_tuff', 'polished_deepslate'],
    fin: ['polished_andesite', 'andesite', 'stone', 'tuff', 'cobblestone'],
    deep: ['deepslate_tiles', 'polished_deepslate', 'deepslate_bricks', 'cobbled_deepslate'],
    tuff: ['polished_tuff', 'tuff_bricks', 'tuff'],
    light: ['polished_andesite', 'smooth_stone', 'andesite', 'stone'],
    sand: ['smooth_sandstone', 'cut_sandstone', 'sandstone'],
    // the stalk's tones from light to dark: each column of a stalk starts at its place and shifts a step darker toward
    // the bottom of the body, a step lighter near the top
    cane: ['lime_wool', 'lime_concrete', 'bamboo_block[axis=y]', 'green_wool', 'green_terracotta'],
    // the Creeper launcher: the cane only in greens (from the sugar cane palette: #52a823, #3d7d1a, #306314, #72b947),
    // the boosters' light greys, their dark band rings and their cones darkening to the tip
    cane2: ['lime_wool', 'lime_concrete', 'green_wool', 'green_concrete', 'green_terracotta'],
    booster: ['smooth_stone', 'polished_andesite', 'andesite', 'stone'],
    boosterCone: ['smooth_stone', 'polished_andesite', 'andesite', 'stone', 'tuff', 'polished_tuff'],
    band: ['polished_blackstone', 'blackstone', 'polished_deepslate'],
  };
  // the launcher's stalk: the pale rim of a node (a light row) over its dark band, in greens only
  const CANE_STALK2 = {
    node: ['lime_wool', 'lime_wool', 'lime_concrete', 'lime_concrete'],
    line: ['green_wool', 'green_concrete', 'green_concrete', 'green_terracotta'],
  };
  // the carpet of the same colour, for the head's top corners outside the round body (spawn-proof and nearly flat)
  const carpetOf = (nm) => { const m = nm.match(/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/); return (m ? m[1] : { tuff: 'gray', andesite: 'light_gray', stone: 'light_gray', polished_diorite: 'white' }[nm] || 'light_gray') + '_carpet'; };
  // the slab and stair material for the top of each block (a block without its own slab takes a close one)
  const ROCKET_CAP = {
    polished_andesite: 'polished_andesite', andesite: 'andesite', stone: 'stone', light_gray_concrete: 'light_gray_concrete', gray_concrete: 'gray_concrete',
    tuff: 'tuff', polished_tuff: 'polished_tuff', tuff_bricks: 'tuff_brick', smooth_stone: 'stone', stone_bricks: 'stone_brick', cracked_stone_bricks: 'stone_brick', mossy_cobblestone: 'mossy_cobblestone', cobblestone: 'cobblestone', polished_deepslate: 'polished_deepslate', deepslate_tiles: 'deepslate_tile', cobbled_deepslate: 'cobbled_deepslate',
    polished_blackstone: 'polished_blackstone', blackstone: 'blackstone', deepslate_bricks: 'deepslate_brick', cracked_deepslate_bricks: 'deepslate_brick',
    brown_terracotta: 'brown_concrete', orange_terracotta: 'orange_concrete', brown_concrete: 'brown_concrete',
    yellow_concrete: 'yellow_concrete', glowstone: 'yellow_concrete', orange_concrete: 'orange_concrete', shroomlight: 'orange_concrete', red_concrete: 'red_concrete',
    smooth_sandstone: 'smooth_sandstone', sandstone: 'sandstone', cut_sandstone: 'sandstone', chiseled_sandstone: 'sandstone', moss_block: 'mossy_cobblestone',
  };
  /** A fixed hash in 0..1 of whole coordinates (the wear noise). */
  function rHash(x, y, z, seed) {
    let n = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  /**
   * o.size '100' | '127' (height), o.flames 'on' | 'off', o.colour 'charged' | 'grey' | 'ember' | 'green' (the head),
   * o.fill 'sandy' | 'glass' | 'mixed' (the cane wall between the stalks), o.wear 'clean' | 'weathered' | 'rusty'.
   * cfg.launcher: the Creeper launcher instead (o.boosters 'on' | 'off'): two boosters east and west, the greener cane
   * palette with sand bands, a longer spike, no collar stairs. Without cfg the Creeper rocket comes out unchanged.
   */
  function creeperRocket(o, cfg) {
    const LA = !!(cfg && cfg.launcher), boosters = LA && o.boosters !== 'off';
    const H = +o.size || 127, flames = o.flames !== 'off', cr = ROCKET_CREEPER[o.colour] || ROCKET_CREEPER.charged;
    const wr = ROCKET_WEAR[o.wear] || ROCKET_WEAR.weathered, fill = o.fill === 'glass' || o.fill === 'mixed' ? o.fill : 'sandy';
    // the launcher's grid is 64 wide (the core 36 in the middle, a 14 wide booster on each side); the core keeps its centre
    const Wx = LA ? 64 : 36, Wz = 36, Mx = Wx / 2 - 0.5, Mz = 17.5, hw = 16;
    const yf = 9, yh = 15, yt = yh + 31, yb = yt + 1, Ln = Math.round((H - yb - 1) / 3), yn = H - Ln;   // flame top, head (bottom, top row = roof), body, nose
    const Ro = 17.6, Rch = 2.6, P = LA ? 8 : 4;   // body radius, nose radius round the chamber, rows of the point above it
    const N = Wx * H * Wz, at = (x, y, z) => (y * Wz + z) * Wx + x;
    const se = (a, b, p) => Math.pow(Math.pow(a, p) + Math.pow(b, p), 1 / p);
    // the AFK chamber: 2 x 1 at the core's middle, three rows of air over a slab floor, one block of wall all round, the roof on top
    const CH = { x0: Mx - 0.5, x1: Mx + 0.5, z: Mz - 0.5, y0: H - P - 4, y1: H - P - 2 };
    const inChamber = (x, y, z) => x >= CH.x0 && x <= CH.x1 && z === CH.z && y >= CH.y0 && y <= CH.y1;
    const chamberFloor = (x, y, z) => x >= CH.x0 && x <= CH.x1 && z === CH.z && y === CH.y0 - 1;
    const chamberWall = (x, y, z) => x >= CH.x0 - 1 && x <= CH.x1 + 1 && z >= CH.z - 1 && z <= CH.z + 1 && y >= CH.y0 - 1 && y <= CH.y1 + 1;
    // the nose: a needle. A slightly concave cone from the body's radius in to a 6 wide neck that holds the chamber
    // (floor, three rows of air, roof), then a point: 4, 4, 2, 2 wide (the launcher: a longer escape-tower spike), the
    // last row the highest block
    const yNeck = CH.y0 - 2, POINT = LA ? [2, 1.6, 1.6, 0.8, 0.75, 0.75, 0.75, 0.75] : [2, 1.6, 0.8, 0.75];
    const noseR = (y) => (y >= H - P ? POINT[y - (H - P)] : y >= yNeck ? Rch : Rch + (Ro - Rch) * Math.pow(1 - (y - yn) / (yNeck - yn), 1.3));
    const nose = (a, b, y) => se(a, b, 2.2 - 0.2 * Math.min(1, (y - yn) / (yNeck - yn))) <= noseR(y);
    const T = 17.5, yTip = 12, yRoot = yt - 1;
    const finTop = (t) => yTip + (yRoot - yTip) * Math.pow((T - t) / (T - 12), 1.2);
    const finBot = (t) => (t >= 14 ? 0 : ((yh - 1) * (14 - t)) / 2);
    // the boosters: 14 wide round columns 25 blocks either side of the core's centre, a cone on top, their own bell and
    // flames below, braced to the head by three struts
    const BX = 25, BR = 7.05, yBt = Math.round(H * 0.7), Lc = Math.round(H * 0.1), STRUTS = [20, 30, 40];
    const reg = new Uint8Array(N);   // 1 head, 2 fin, 3 nozzle, 4 flame, 6 body, 8 collar, 9 nose, 10 chamber wall, 11 booster, 12 booster bell, 13 booster flame, 14 strut
    const forced = new Uint8Array(N);   // never hollowed: the head's floor and roof (the roof is also the body's floor), the chamber walls
    for (let y = 0; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const a = Math.abs(x - Mx), b = Math.abs(z - Mz), r = Math.hypot(a, b), q = se(a, b, 2.2), i = at(x, y, z);
      let g = 0;
      if (y >= yh && y <= yt && a <= hw && b <= hw) { g = 1; if (y === yh || y === yt) forced[i] = 1; }
      else if (y === yt && q <= Ro) g = LA ? 0 : 8;
      else if (y >= yb && y < yn && q <= Ro) g = 6;
      else if (y >= yn) {
        if (chamberWall(x, y, z)) { g = inChamber(x, y, z) ? 0 : 10; if (g) forced[i] = 1; }
        else if (nose(a, b, y)) g = 9;
      } else if (y > yf && y < yh) {
        const u = (yh - 1 - y) / (yh - yf - 2), ro = 8.8 + 1.2 * Math.pow(u, 1.3);
        if (r <= ro && !(y < yh - 1 && r <= ro - 1.3)) g = 3;
      } else if (flames && y <= yf) {
        const s = (yf - y) / yf, th = Math.atan2(b, a), rf = 8.8 + 1.8 * Math.pow(s, 1.4) + 1.1 * s * (1 + Math.cos(8 * th)) / 2;
        if (r <= rf) g = 4;
      }
      if (!g && boosters) {
        const bx = a - BX, rb = Math.hypot(bx, b);
        if (y >= yh && y <= yBt && rb <= BR) g = 11;
        else if (y > yBt && y <= yBt + Lc && rb <= Math.max(0.75, BR * Math.pow(1 - (y - yBt) / (Lc + 1), 0.85))) g = 11;
        else if (y > yf && y < yh) {
          const u = (yh - 1 - y) / (yh - yf - 2), ro = 3.7 + 1.3 * Math.pow(u, 1.3);
          if (rb <= ro && !(y < yh - 1 && rb <= ro - 1.2)) g = 12;
        } else if (flames && y <= yf) {
          const s = (yf - y) / yf, th = Math.atan2(b, Math.abs(bx)), rf = 4.3 + 1.2 * Math.pow(s, 1.4) + 0.8 * s * (1 + Math.cos(8 * th)) / 2;
          if (rb <= rf) g = 13;
        }
        if (!g && STRUTS.includes(y) && a > hw && a < BX - BR + 0.5 && b <= 1.5) { g = 14; forced[i] = 1; }
      }
      if (!g && y < yt && Math.abs(a - b) <= 1) {
        const t = (a + b) / 2;
        if (t >= 12 && t <= T && y >= finBot(t) - 0.01 && y <= finTop(t)) g = 2;
      }
      reg[i] = g;
    }
    const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < Wx && y < H && z < Wz && reg[at(x, y, z)] > 0;
    // the shell: the forced blocks, and every block with one of its 26 neighbours outside the solid; a booster and the
    // core keep their own walls where they touch (each is its own sealed column)
    const shell = new Uint8Array(N), grp = (g) => (g >= 11 && g <= 13 ? 2 : 1);
    const other = (x, y, z, k) => !solid(x, y, z) || grp(reg[at(x, y, z)]) !== k;
    for (let y = 0; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const i = at(x, y, z);
      if (!reg[i]) continue;
      let edge = !!forced[i];
      const k = grp(reg[i]);
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && other(x + dx, y + dy, z + dz, k)) { edge = true; break; }
      if (edge) shell[i] = 1;
    }
    // rooms: the outside air (0 means not yet reached), then every sealed pocket gets its own number
    const room = new Int32Array(N), st = [];
    const fillRoom = (i0, id) => {
      room[i0] = id; st.push(i0);
      while (st.length) {
        const i = st.pop(), x = i % Wx, z = Math.floor(i / Wx) % Wz, y = Math.floor(i / (Wx * Wz));
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= Wx || Y >= H || Z >= Wz) continue;
          const j = at(X, Y, Z);
          if (!shell[j] && !room[j]) { room[j] = id; st.push(j); }
        }
      }
    };
    for (let y = 0; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const i = at(x, y, z);
      if (!shell[i] && !room[i] && (x === 0 || z === 0 || x === Wx - 1 || z === Wz - 1 || y === 0 || y === H - 1)) fillRoom(i, 1);
    }
    let next = 2;
    for (let i = 0; i < N; i++) if (!shell[i] && !room[i]) fillRoom(i, next++);
    const farm = new Set([room[at(Mx - 0.5, yh + 15, Mz - 0.5)], room[at(Mx - 0.5, yb + 6, Mz - 0.5)], room[at(CH.x0, CH.y0, CH.z)]]);
    const outside = (x, y, z) => x < 0 || y < 0 || z < 0 || x >= Wx || y >= H || z >= Wz || room[at(x, y, z)] === 1;
    const tex = (u, v) => cr[CREEPER_TEX[v][u]];
    const fold = (p) => Math.floor((p < hw ? p : 2 * hw - 1 - p) / 4);   // 32 blocks a side: 4 per texel, the right half mirrors the left
    const stalkArc = (17.5 * 2 * Math.PI) / 20;
    /** The tone at v (0 light .. 1 dark) on a ramp, dithered: noise moves it up to half a step either way. */
    const ramp = (list, v, x, y, z, seed) => list[Math.max(0, Math.min(list.length - 1, Math.floor(v * list.length + (kNoise(x, y, z, 2.5, seed) - 0.5) * 1.2 + (rHash(x, y, z, seed + 1) - 0.5) * 0.6)))];
    const bodyV = (y) => (y - yb) / Math.max(1, yn - yb);   // 0 at the bottom of the body, 1 at the top
    // the sandy fill: more plain sandstone low down, smoother higher up, a few chiseled blocks
    const sandy = (x, y, z) => (rHash(x, y, z, 73) < 0.03 ? 'chiseled_sandstone' : ramp(ROCKET_RAMP.sand, 0.85 - 0.7 * bodyV(y), x, y, z, 71));
    // the launcher's three sand bands round the cane (2 rows each)
    const bandAt = (y) => LA && [0.3, 0.55, 0.8].some((f) => { const y0 = yb + Math.round(f * (yn - yb)); return y === y0 || y === y0 + 1; });
    const out = new Array(N).fill(null);
    for (let y = 0; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const i = at(x, y, z), g = reg[i];
      if (!shell[i]) continue;
      const a = Math.abs(x - Mx), b = Math.abs(z - Mz), r = Math.hypot(a, b);
      const n2 = kNoise(x, y, z, 5, 37), n3 = kNoise(x, y, z, 4, 41), fine = rHash(x, y, z, 43);
      let c;
      if (g === 1) {
        const px = x - (Mx - hw + 0.5), pz = z - (Mz - hw + 0.5), py = y - yh, row = 7 - Math.floor(py / 4), e = 2 * hw - 1;
        if (px === 0 || px === e) c = tex(8 + fold(pz), 8 + row);   // the face, on all four sides
        else if (pz === 0 || pz === e) c = tex(8 + fold(px), 8 + row);
        else if (py === 2 * hw - 1) c = tex(8 + fold(px), fold(pz));   // top
        else c = tex(16 + fold(px), fold(pz));   // bottom
      } else if (g === 2) {
        const t = (a + b) / 2;
        // darker at the foot, lighter up the fin and along its edges
        c = n3 > wr.rust ? 'brown_terracotta' : n2 > wr.patch ? (fine < 0.8 ? 'cobblestone' : 'mossy_cobblestone') : ramp(ROCKET_RAMP.fin, t >= 17 || finTop(t) - y < 1.5 ? 0.1 : 0.95 - 0.7 * (y / finTop(t)), x, y, z, 91);
      } else if (g === 3) c = y === yf + 1 ? (fine < 0.7 ? 'polished_blackstone' : 'blackstone') : n3 > wr.rust ? 'brown_terracotta' : ramp(ROCKET_RAMP.deep, r < 8.8 ? 0.15 : 0.3 + 0.5 * ((yh - 1 - y) / 4), x, y, z, 93);
      else if (g === 4 || g === 13) {
        const nn = kNoise(g === 4 ? a : Math.abs(a - BX), y, b, 2, 21) > 0.55, s = (yf - y) / yf;
        c = s < 0.3 ? (nn ? ROCKET_BLOCK.glow : ROCKET_BLOCK.hot) : s < 0.7 ? (nn ? ROCKET_BLOCK.fire2 : ROCKET_BLOCK.fire) : (nn ? ROCKET_BLOCK.fire : ROCKET_BLOCK.ember);
      } else if (g === 8) c = fine < 0.6 ? 'polished_andesite' : 'andesite';   // the collar stairs, set below
      else if (g === 10) c = fine < 0.6 ? 'polished_deepslate' : 'deepslate_tiles';
      else if (g === 11) {   // a booster: light grey with dark band rings and a few dark marks, its cone darkening to the tip
        if (y > yBt) c = ramp(ROCKET_RAMP.boosterCone, 0.1 + 0.8 * ((y - yBt) / Lc), x, y, z, 111);
        else if ((y - yh) % 10 === 8) c = ramp(ROCKET_RAMP.band, 0.4, x, y, z, 113);
        else c = rHash(x, y, z, 115) < 0.015 ? 'polished_blackstone' : ramp(ROCKET_RAMP.booster, 0.55 - 0.4 * ((y - yh) / (yBt - yh)), x, y, z, 117);
        if (y <= yBt && (y - yh) % 10 !== 8 && n2 > wr.patch) c = fine < 0.8 ? 'cobblestone' : 'mossy_cobblestone';
        if (y <= yBt && n3 > wr.rust) c = 'brown_terracotta';
      } else if (g === 12) c = y === yf + 1 ? 'polished_blackstone' : ramp(ROCKET_RAMP.deep, 0.4, x, y, z, 119);
      else if (g === 14) c = fine < 0.6 ? 'polished_andesite' : 'andesite';
      else if (g === 6) {
        if (y <= yb + 1 || y >= yn - 2) {   // the grey rings at both ends of the body: deepslate, a lighter row
          const deep = y === yb || y === yn - 1;
          c = deep ? ramp(ROCKET_RAMP.tuff, 0.4, x, y, z, 95) : ramp(ROCKET_RAMP.light, 0.4, x, y, z, 97);
          if (deep && rHash(x, y, z, 81) < wr.crack) c = 'cracked_stone_bricks';
          if (n2 > wr.patch) c = fine < 0.8 ? 'cobblestone' : 'mossy_cobblestone';
        } else if (bandAt(y)) c = ramp(ROCKET_RAMP.sand, 0.5, x, y, z, 121);
        else {
          // twenty stalks round the body, 4 blocks wide each (lit side first, going round), the wall fill only in the
          // narrow gaps between them; a node every 8 rows at each stalk's own height, a leaf in the gap beside it
          const th = Math.atan2(z - Mz, x - Mx) + Math.PI, s = th * 17.5, k = Math.round(s / stalkArc), d = s - k * stalkArc, kk = ((k % 20) + 20) % 20;
          const nodeAt = (st) => ((((y - yb - 3 + CANE_NODES[st % 5]) % 8) + 8) % 8);
          const STK = LA ? CANE_STALK2 : CANE_STALK, RMP = LA ? ROCKET_RAMP.cane2 : ROCKET_RAMP.cane;
          if (Math.abs(d) < 2) {
            const col = Math.min(3, Math.floor(d + 2)), r8 = nodeAt(kk), v = bodyV(y), dn = kNoise(x, y, z, 3, 99) - 0.5;
            const shift = (v < 0.4 && dn < 0.35 - v) ? 1 : (v > 0.7 && dn > 0.75 - v) ? -1 : 0;   // darker low down, lighter near the top
            c = r8 === 0 ? STK.node[col] : r8 === 7 ? STK.line[col] : RMP[Math.max(0, Math.min(4, col + shift))];
          } else {
            const nb = d > 0 ? kk : (kk + 19) % 20, n8 = nodeAt(nb);   // the stalk on the lit side of the gap
            const leaf = LA ? (n8 === 1 ? 'lime_wool' : n8 === 2 && rHash(x, y, z, 125) < 0.5 ? 'lime_concrete' : null) : (n8 === 1 ? 'lime_concrete' : null);
            c = leaf || (fill === 'glass' || (fill === 'mixed' && ((y - yb) % 9 >= 4 && (y - yb) % 9 <= 6)) ? 'glass' : sandy(x, y, z));
          }
          if (c !== 'glass' && kNoise(x, y, z, 4, 51) > wr.moss) c = 'moss_block';
        }
      } else {   // the nose: a deepslate band where it meets the body, then light grey grading through the greys to a dark tip
        const h = y - yn, dark = y >= yNeck - 2, t = Math.min(1, (y - yn) / Math.max(1, yNeck - 2 - yn));
        if (h <= 1) c = ramp(ROCKET_RAMP.deep, 0.35, x, y, z, 101);
        else c = ramp(ROCKET_RAMP.nose, dark ? 0.86 : 0.75 * Math.pow(t, 1.4), x, y, z, 61);
        if (!dark && n2 > wr.patch) c = fine < 0.6 ? 'cobblestone' : fine < 0.75 ? 'mossy_cobblestone' : 'tuff_bricks';
        else if (!dark && rHash(x, y, z, 103) < 0.03) c = 'cobblestone';   // a few cobblestone blocks here and there, even when clean
        if (n3 > wr.rust && h > 1 && !dark) c = 'brown_terracotta';
      }
      out[i] = c;
    }
    // rust streaks under the upper ring, down the cane wall (the launcher keeps its cane green and sand only)
    if (wr.streak && !LA) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      if (rHash(x, yn, z, 61) > wr.streak) continue;
      const L = 2 + Math.floor(rHash(x, yn, z, 67) * (wr.streak > 0.1 ? 7 : 3));
      for (let k = 3; k < 3 + L; k++) {
        const y = yn - k, i = at(x, y, z);
        if (!out[i] || out[i] === 'glass') break;
        if (!(outside(x + 1, y, z) || outside(x - 1, y, z) || outside(x, y, z + 1) || outside(x, y, z - 1))) continue;
        out[i] = k === 3 ? 'orange_terracotta' : k <= 3 + L / 2 ? 'brown_terracotta' : 'brown_concrete';
      }
    }
    const ids = new Array(N).fill(null);
    for (let i = 0; i < N; i++) if (out[i]) ids[i] = 'minecraft:' + out[i];
    const capOf = (nm) => ROCKET_CAP[nm.replace(/\[.*$/, '')] || 'polished_andesite';
    for (let y = 0; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const i = at(x, y, z);
      if (!out[i]) continue;
      const a = Math.abs(x - Mx), b = Math.abs(z - Mz);
      // the collar: upside-down stairs under the body's overhang, their lower step against the head
      if (reg[i] === 8) ids[i] = 'minecraft:' + out[i] + '_stairs[facing=' + (a >= b ? (x > Mx ? 'west' : 'east') : (z > Mz ? 'north' : 'south')) + ',half=top]';
      if (chamberFloor(x, y, z)) ids[i] = 'minecraft:polished_deepslate_slab[type=bottom]';
      if (y === H - 1) ids[i] = 'minecraft:' + capOf(out[i]) + '_slab[type=bottom]';   // the very top: nothing to stand on
    }
    // caps: a slab or stair on every block with open air on top outside (spawn-proofing and smoothing), a stone button
    // on the floor of the small sealed pockets (nozzle, flames, boosters); the farm rooms and the chamber stay empty
    for (let y = 1; y < H; y++) for (let z = 0; z < Wz; z++) for (let x = 0; x < Wx; x++) {
      const i = at(x, y, z), below = at(x, y - 1, z);
      if (out[i] || !out[below] || !/^minecraft:[a-z_]+(\[axis=y\])?$/.test(ids[below]) || out[below] === 'glass') continue;
      if (room[i] !== 1) { if (!farm.has(room[i])) ids[i] = 'minecraft:stone_button[face=floor,facing=north]'; continue; }
      if (reg[below] === 1) { ids[i] = 'minecraft:' + carpetOf(out[below]); continue; }   // the head's corners: a carpet in the roof's own colour, so the top stays one flat square
      const base = capOf(out[below]);
      const wall = (dx, dz) => solid(x + dx, y, z + dz);
      const ex = wall(1, 0), wx = wall(-1, 0), sz = wall(0, 1), nz = wall(0, -1);
      const fx = ex !== wx ? (ex ? 'east' : 'west') : null, fz = sz !== nz ? (sz ? 'south' : 'north') : null;
      const fac = fx && fz ? (Math.abs(x - Mx) >= Math.abs(z - Mz) ? fx : fz) : fx || fz;
      ids[i] = fac ? 'minecraft:' + base + '_stairs[facing=' + fac + ',half=bottom]' : 'minecraft:' + base + '_slab[type=bottom]';
    }
    const C = TH.builds.core;
    if (!LA) return C.fromFunction([Wx, H, Wz], (x, y, z) => ids[(y * Wz + z) * Wx + x], 'Creeper rocket ' + H + (flames ? '' : ', no flames'));
    return C.trim(C.fromFunction([Wx, H, Wz], (x, y, z) => ids[(y * Wz + z) * Wx + x], 'Creeper launcher ' + H + (boosters ? '' : ', core only') + (flames ? '' : ', no flames')));
  }

  /** A build's options with every missing or unknown value set to its default ({} for builds without options). */
  function options(id, o) {
    const f = FARMS.find((x) => x.id === id), out = {};
    ((f && f.opts) || []).forEach((op) => { const v = o && o[op.id]; out[op.id] = op.choices.some((c) => c[0] === v) ? v : op.def; });
    return out;
  }
  /**
   * Size and block count of every option set of the builds with options, measured once (node tools/test-heads.js
   * --stats prints this table; the tests check it), so the size keys can show them in their tooltips without building
   * a giant first. Key: the values of the options that change the shape, in option order ('look' options do not).
   * [width, height, length, blocks, of them water]
   */
  const STATS = {
    // @stats-begin
    guardian_head: {
      '16|off': [24, 24, 24, 1488], '16|on': [24, 24, 44, 1806], '24|off': [36, 36, 36, 4488], '24|on': [36, 36, 66, 5358],
      '32|off': [46, 46, 46, 7416], '32|on': [46, 46, 87, 9360], '48|off': [72, 72, 72, 21480], '48|on': [72, 72, 132, 28716],
      '64|off': [94, 94, 94, 42168], '64|on': [94, 94, 175, 57720],
    },
    creeper_head: {
      '8': [8, 8, 8, 296], '16': [16, 16, 16, 1352], '24': [24, 24, 24, 3176], '32': [32, 32, 32, 5768],
      '48': [48, 48, 48, 13256], '64': [64, 64, 64, 23816], '96': [96, 96, 96, 54152],
    },
    kraken_tentacles: {
      '3|20|pond': [35, 20, 35, 4226, 1711], '3|20|none': [20, 20, 19, 898], '3|35|pond': [51, 35, 51, 11712, 5456], '3|35|none': [32, 35, 30, 2847],
      '3|60|pond': [79, 60, 79, 37969, 21939], '3|60|none': [54, 60, 50, 7842], '5|20|pond': [39, 20, 39, 5267, 2013], '5|20|none': [26, 20, 23, 1317],
      '5|35|pond': [55, 35, 55, 13832, 6165], '5|35|none': [38, 35, 37, 3878], '5|60|pond': [81, 60, 81, 41359, 22332], '5|60|none': [57, 60, 61, 10500],
      '7|20|pond': [45, 20, 45, 6875, 2686], '7|20|none': [27, 20, 28, 1738], '7|35|pond': [63, 35, 63, 17489, 7890], '7|35|none': [41, 35, 45, 4829],
      '7|60|pond': [91, 60, 91, 50136, 27228], '7|60|none': [60, 60, 73, 12714],
    },
    creeper_rocket: {
      '100|on': [36, 100, 36, 17062], '100|off': [36, 100, 36, 15058], '127|on': [36, 127, 36, 20202], '127|off': [36, 127, 36, 18198],
    },
    creeper_launcher: {
      '100|on|on': [64, 100, 36, 25806], '100|on|off': [36, 100, 36, 16782], '100|off|on': [64, 100, 36, 22530], '100|off|off': [36, 100, 36, 14778],
      '127|on|on': [64, 127, 36, 31066], '127|on|off': [36, 127, 36, 19914], '127|off|on': [64, 127, 36, 27790], '127|off|off': [36, 127, 36, 17910],
    },
    // @stats-end
  };
  const statKey = (f, o) => (f.opts || []).filter((op) => !op.look).map((op) => o[op.id]).join('|');
  /** { size: [w, h, l], n, water } of a build with these options, from the table (null when it is not listed). */
  function stats(id, o) {
    const f = FARMS.find((x) => x.id === id), t = f && STATS[id], v = t && t[statKey(f, options(id, o))];
    return v ? { size: v.slice(0, 3), n: v[3], water: v[4] || 0 } : null;
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

  TH.builds.farms = { FARMS, PLANNED, DIMS, schematic, options, stats, statKey, STATS, phases, hasPhases: (id) => !!PHASES[id] };
})();
