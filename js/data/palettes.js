/**
 * Curated block palettes for the Palettes tool. One line each: "Name | tags | blocks" (first block = the main one,
 * the order after it is roughly how much of it to use). Block names are the ones of TH.builds.core.BLOCKS (full building
 * blocks); anything unknown is dropped at load. Tags drive the filter chips.
 * Original combinations written for this toolbox (inspired by what builders pair up, not copied from any site).
 */
window.TH = window.TH || {};
TH.data = TH.data || {};
TH.data.palettes = (function () {
  const L = `
Castle Keep | medieval stone dark | stone_bricks cobblestone andesite spruce_planks dark_oak_log
Old Village | medieval rustic wood | oak_planks cobblestone spruce_log stripped_oak_log mossy_cobblestone
Mossy Ruins | natural stone | mossy_stone_bricks mossy_cobblestone stone_bricks moss_block cracked_stone_bricks
Tudor Cottage | medieval rustic light | white_terracotta dark_oak_planks oak_planks cobblestone stripped_dark_oak_log
Gothic Cathedral | gothic dark stone | deepslate_bricks polished_deepslate stone_bricks blackstone dark_prismarine
Dark Fortress | gothic dark | blackstone polished_blackstone_bricks deepslate_tiles crying_obsidian dark_oak_planks
Raven Tower | gothic dark | polished_blackstone deepslate_bricks black_concrete gray_concrete spruce_planks
Stone Cabin | rustic stone wood | cobblestone spruce_planks stripped_spruce_log stone_bricks spruce_log
Hunter's Lodge | rustic wood dark | spruce_planks dark_oak_log cobblestone stripped_spruce_log bookshelf
Whitewashed Manor | medieval light | white_concrete quartz_bricks stone_bricks dark_oak_planks stripped_dark_oak_log
Forest Hideout | natural wood | spruce_log stripped_spruce_log spruce_planks moss_block podzol
Tavern | medieval wood warm | oak_planks dark_oak_planks oak_log bookshelf stripped_oak_log
Blacksmith | medieval stone dark | cobblestone blackstone stone_bricks spruce_log gray_concrete
Windmill | rustic light wood | white_wool oak_planks stripped_oak_log spruce_planks cobblestone
Barn Red | rustic warm | red_terracotta white_terracotta spruce_planks oak_planks hay_block
Farmstead | rustic wood natural | oak_planks stripped_oak_log hay_block dirt coarse_dirt
Cherry Blossom Temple | japanese warm light | cherry_planks stripped_cherry_log cherry_log white_concrete dark_oak_planks
Pagoda | japanese warm | red_concrete dark_oak_planks stripped_dark_oak_log stone_bricks white_terracotta
Zen Garden | japanese neutral light | smooth_stone andesite bamboo_planks stripped_birch_log sand
Bamboo Hut | japanese natural wood | bamboo_planks bamboo_block stripped_oak_log oak_planks jungle_planks
Shogun Hall | japanese dark | dark_oak_planks stripped_dark_oak_log black_concrete red_terracotta stone_bricks
Sakura Grove | japanese light | pink_concrete cherry_planks pink_terracotta white_wool stripped_cherry_log
Desert Palace | desert warm light | sandstone cut_sandstone smooth_sandstone orange_terracotta chiseled_sandstone
Oasis Town | desert warm | smooth_sandstone sandstone terracotta jungle_planks cyan_terracotta
Canyon Ridge | desert warm | red_sandstone orange_terracotta red_terracotta terracotta brown_terracotta
Badlands Bands | desert warm colourful | terracotta orange_terracotta yellow_terracotta white_terracotta red_terracotta brown_terracotta
Sun Temple | desert warm | cut_sandstone chiseled_sandstone gold_block orange_concrete smooth_sandstone
Dune Fort | desert neutral | sand sandstone cut_sandstone smooth_red_sandstone acacia_planks
Pyramid Core | desert warm dark | sandstone cut_sandstone chiseled_sandstone lapis_block gold_block
Red Rock | desert warm dark | red_sandstone cut_red_sandstone smooth_red_sandstone red_terracotta nether_bricks
Nether Fortress | nether dark warm | nether_bricks red_nether_bricks nether_wart_block blackstone crimson_planks
Crimson Forest | nether warm dark | crimson_planks crimson_stem crimson_nylium nether_wart_block shroomlight
Warped Grove | nether cool | warped_planks warped_stem warped_nylium warped_wart_block shroomlight
Bastion | nether dark | polished_blackstone_bricks blackstone polished_blackstone basalt gold_block
Basalt Deltas | nether dark neutral | basalt smooth_basalt polished_basalt blackstone netherrack
Lava Forge | nether warm dark | netherrack magma_block obsidian blackstone red_nether_bricks
Soul Valley | nether cool dark | soul_sand basalt blackstone warped_wart_block smooth_basalt
Quartz Palace | nether light | quartz_block quartz_bricks smooth_quartz quartz_pillar chiseled_quartz_block
Quartz and Gold | nether light warm | quartz_block smooth_quartz gold_block chiseled_quartz_block yellow_concrete
End City | end light fantasy | purpur_block purpur_pillar end_stone_bricks end_stone magenta_concrete
Void Temple | end dark fantasy | obsidian crying_obsidian purpur_block black_concrete purple_concrete
Ocean Monument | ocean cool | prismarine prismarine_bricks dark_prismarine sea_lantern cyan_terracotta
Deep Sea | ocean cool dark | dark_prismarine blue_terracotta blue_concrete cyan_concrete prismarine
Coral Reef | ocean colourful | pink_concrete magenta_concrete orange_concrete cyan_concrete yellow_concrete
Harbour | ocean wood | spruce_planks oak_planks white_concrete blue_terracotta stone_bricks
Lighthouse | ocean light | white_concrete red_concrete stone_bricks light_gray_concrete sea_lantern
Glacier | winter cool light | packed_ice blue_ice snow_block white_concrete light_blue_concrete
Frozen Keep | winter cool | snow_block packed_ice stone_bricks light_blue_terracotta spruce_planks
Winter Cabin | winter rustic | spruce_planks snow_block spruce_log stripped_spruce_log cobblestone
Polar Night | winter cool dark | blue_ice blue_terracotta gray_concrete black_concrete light_blue_concrete
Alpine Chalet | winter wood light | white_concrete spruce_planks dark_oak_log snow_block stone_bricks
Autumn Forest | natural warm | orange_terracotta dark_oak_log brown_terracotta red_terracotta oak_planks
Fall Harvest | natural warm | pumpkin hay_block orange_concrete brown_concrete oak_planks
Jungle Temple | natural | mossy_cobblestone mossy_stone_bricks jungle_planks moss_block jungle_log
Swamp Hut | natural dark | mangrove_planks mangrove_log mud_bricks moss_block spruce_planks
Mangrove Bay | natural warm | mangrove_planks stripped_mangrove_log mud_bricks packed_mud mangrove_log
Meadow | natural light | grass_block oak_planks birch_planks white_wool lime_terracotta
Birch Cottage | natural light wood | birch_planks stripped_birch_log birch_log white_wool oak_planks
Cherry and Birch | natural light | cherry_planks birch_planks white_concrete stripped_cherry_log pink_wool
Pale Garden | natural neutral light | pale_oak_planks pale_oak_log stripped_pale_oak_log white_concrete moss_block
Dripstone Cave | natural dark | deepslate tuff calcite cobbled_deepslate amethyst_block
Lush Cave | natural colourful | moss_block clay rooted_dirt lime_terracotta calcite
Amethyst Geode | fantasy cool | amethyst_block calcite tuff purple_concrete smooth_basalt
Mushroom Isle | fantasy colourful | mycelium red_wool white_wool brown_wool purple_terracotta
Ancient City | dark gothic | deepslate_tiles deepslate_bricks polished_deepslate deepslate cobbled_deepslate
Deep Dark | dark cool | deepslate polished_deepslate cobbled_deepslate blue_terracotta black_concrete
Mountain Stone | stone neutral | stone andesite cobblestone gravel tuff
Granite Estate | stone warm | granite polished_granite stone_bricks andesite oak_planks
Diorite Hall | stone light | diorite polished_diorite calcite white_concrete stone_bricks
Tuff Monastery | stone neutral | tuff polished_tuff tuff_bricks calcite spruce_planks
Slate | stone dark neutral | deepslate_tiles deepslate_bricks stone_bricks gray_concrete light_gray_concrete
Industrial Grey | modern stone neutral | gray_concrete light_gray_concrete black_concrete stone_bricks iron_block
Steel and Glass | modern cool | light_gray_concrete gray_concrete glass iron_block white_concrete
Sky Loft | modern light | white_concrete light_gray_concrete glass oak_planks smooth_stone
Brutalist | modern stone | stone_bricks gray_concrete smooth_stone polished_andesite andesite
Concrete Jungle | modern neutral | light_gray_concrete gray_concrete white_concrete black_concrete green_concrete
Minimal White | modern light neutral | white_concrete white_wool quartz_block smooth_quartz light_gray_concrete
Scandi Home | modern light wood | white_concrete birch_planks stripped_birch_log light_gray_wool gray_concrete
Mid Century | modern warm wood | orange_terracotta oak_planks dark_oak_planks cyan_terracotta white_concrete
Art Deco | modern dark warm | black_concrete gold_block quartz_block polished_blackstone smooth_quartz
Neon City | modern dark colourful | black_concrete cyan_concrete magenta_concrete purple_concrete sea_lantern
Cyberpunk | modern dark colourful | black_concrete gray_concrete magenta_concrete light_blue_concrete yellow_concrete
Steampunk | rustic dark warm | copper_block cut_copper exposed_copper dark_oak_planks iron_block
Copper Age | warm | copper_block cut_copper exposed_copper weathered_copper oxidized_copper
Verdigris Roof | cool | oxidized_copper weathered_copper cut_copper stone_bricks dark_oak_planks
Gold Rush | warm | gold_block raw_gold_block yellow_concrete orange_terracotta oak_planks
Emerald City | cool colourful | emerald_block green_concrete lime_concrete stone_bricks white_concrete
Diamond Vault | cool | diamond_block light_blue_concrete cyan_concrete stone_bricks iron_block
Netherite Hall | dark | netherite_block black_concrete blackstone gray_concrete obsidian
Lapis Library | cool wood | lapis_block bookshelf dark_oak_planks blue_concrete light_blue_terracotta
Redstone Lab | warm dark | red_concrete iron_block gray_concrete stone_bricks smooth_stone
Fairy Tale | fantasy colourful light | pink_concrete white_concrete purple_terracotta cherry_planks magenta_wool
Witch Hut | fantasy dark | dark_oak_planks purple_terracotta green_terracotta spruce_log moss_block
Mage Tower | fantasy cool | purple_concrete blue_concrete stone_bricks amethyst_block lapis_block
Dragon Lair | fantasy dark warm | blackstone red_concrete obsidian magma_block gray_concrete
Elven Treehouse | fantasy natural light | birch_planks stripped_birch_log oak_leaves moss_block white_wool
Candy Shop | colourful light | pink_concrete white_concrete red_concrete magenta_concrete light_blue_concrete
Pastel Dream | colourful light | pink_wool light_blue_wool lime_wool yellow_wool purple_wool white_wool
Rainbow | colourful | red_concrete orange_concrete yellow_concrete lime_concrete light_blue_concrete purple_concrete
Sunset | colourful warm | orange_concrete red_terracotta orange_terracotta yellow_concrete pink_terracotta
Sunrise | colourful warm light | yellow_concrete orange_terracotta pink_terracotta white_terracotta yellow_terracotta
Ocean Breeze | colourful cool | light_blue_concrete cyan_concrete white_concrete blue_concrete cyan_terracotta
Forest Green | colourful natural | green_concrete lime_terracotta green_terracotta moss_block spruce_planks
Lavender Fields | colourful cool light | purple_terracotta magenta_terracotta pink_terracotta light_blue_wool white_wool
Berry | colourful dark | purple_concrete magenta_concrete red_terracotta purple_terracotta black_concrete
Peach | colourful warm light | orange_concrete pink_terracotta white_terracotta yellow_terracotta sandstone
Mint | colourful cool light | lime_concrete white_concrete cyan_concrete light_gray_concrete light_blue_terracotta
Coffee | warm dark wood | brown_concrete brown_terracotta dark_oak_planks spruce_planks white_terracotta
Chocolate | warm dark | brown_concrete brown_wool dark_oak_planks brown_terracotta white_wool
Cream | warm light neutral | white_terracotta sandstone birch_planks smooth_sandstone white_concrete
Terracotta Village | desert warm | terracotta white_terracotta orange_terracotta brown_terracotta cyan_terracotta
Pink Terracotta | colourful warm | pink_terracotta white_terracotta magenta_terracotta red_terracotta brown_terracotta
Blue Terracotta | colourful cool | blue_terracotta light_blue_terracotta cyan_terracotta white_terracotta gray_terracotta
Green Terracotta | colourful natural | green_terracotta lime_terracotta cyan_terracotta white_terracotta brown_terracotta
Yellow Terracotta | colourful warm | yellow_terracotta orange_terracotta white_terracotta brown_terracotta terracotta
Midnight | dark cool | black_concrete blue_concrete blue_terracotta gray_concrete purple_concrete
Charcoal and Ember | dark warm | black_concrete gray_concrete orange_concrete red_terracotta blackstone
Storm | dark cool neutral | gray_concrete light_gray_concrete black_concrete blue_terracotta stone_bricks
Fog | light cool neutral | light_gray_concrete white_concrete light_blue_terracotta calcite smooth_stone
Wheat Fields | natural warm light | hay_block yellow_terracotta oak_planks sandstone dirt
Orchard | natural colourful | oak_planks lime_concrete red_wool lime_concrete grass_block
Pumpkin Patch | natural warm | pumpkin orange_concrete dark_oak_planks hay_block brown_terracotta
Melon Garden | natural colourful | melon lime_concrete green_concrete oak_planks dirt
Spruce Stack | wood dark | spruce_planks spruce_log stripped_spruce_log dark_oak_planks oak_planks
Oak Classic | wood warm | oak_planks oak_log stripped_oak_log birch_planks spruce_planks
Acacia Savanna | wood warm | acacia_planks stripped_acacia_log acacia_log terracotta orange_terracotta
Dark Oak Study | wood dark | dark_oak_planks dark_oak_log stripped_dark_oak_log bookshelf crafting_table
Warm Woods | wood warm | oak_planks acacia_planks jungle_planks birch_planks stripped_jungle_log
Cool Woods | wood cool dark | spruce_planks warped_planks dark_oak_planks mangrove_planks stripped_dark_oak_log
Bone and Ash | neutral light | bone_block calcite white_concrete light_gray_concrete diorite
Salt Flats | desert light neutral | white_concrete calcite sand smooth_sandstone light_gray_concrete
Clay Pit | natural neutral | clay light_gray_terracotta gray_terracotta brown_terracotta dirt
Mud Brick Village | desert rustic warm | mud_bricks packed_mud mangrove_planks stripped_mangrove_log coarse_dirt
Graveyard | gothic dark natural | cobbled_deepslate mossy_cobblestone gravel dark_oak_log stone_bricks
Pirate Cove | ocean wood dark | dark_oak_planks spruce_planks stripped_spruce_log blue_terracotta stone_bricks
Treasure Cave | dark warm | deepslate gold_block raw_gold_block gold_ore copper_ore
Frostfire | fantasy cool warm | packed_ice blue_ice orange_concrete red_concrete white_concrete
Toxic Swamp | dark colourful | green_concrete lime_concrete black_concrete moss_block green_terracotta
Royal | colourful dark | purple_concrete gold_block white_concrete blue_terracotta red_concrete
Autumn Sky | colourful warm | light_blue_concrete orange_terracotta white_terracotta yellow_concrete brown_terracotta
`;
  return L.trim().split('\n').map((line, i) => {
    const [name, tags, blocks] = line.split('|').map((x) => x.trim());
    return { id: 'c' + i, name, tags: tags.split(/\s+/), blocks: blocks.split(/\s+/) };
  });
})();
