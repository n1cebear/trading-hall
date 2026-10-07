window.TH = window.TH || {};
TH.data = TH.data || {};

/**
 * Armor-trim data (Java Edition 1.21.x).
 *
 * Patterns: `id` is the Mojang pattern id (= texture name under textures/trims/entity/humanoid/),
 *   `source` where the template is found, `rarity` as shown in-game, `duplicateWith` the base block
 *   (English fallback name) + `block` its item/block id + `blockIcon` its texture key (for TH.icon).
 *   Duplication recipe (all templates): 1 template + 7 diamonds + 1 base block -> 2 templates.
 */
TH.data.trimPatterns = [
  { id: 'sentry',    name: 'Sentry',    source: 'Pillager Outpost',  rarity: 'uncommon', duplicateWith: 'Cobblestone',       block: 'cobblestone',       blockIcon: 'block/cobblestone' },
  { id: 'dune',      name: 'Dune',      source: 'Desert Pyramid',    rarity: 'uncommon', duplicateWith: 'Sandstone',         block: 'sandstone',         blockIcon: 'block/sandstone' },
  { id: 'coast',     name: 'Coast',     source: 'Shipwreck',         rarity: 'uncommon', duplicateWith: 'Cobblestone',       block: 'cobblestone',       blockIcon: 'block/cobblestone' },
  { id: 'wild',      name: 'Wild',      source: 'Jungle Pyramid',    rarity: 'uncommon', duplicateWith: 'Mossy Cobblestone', block: 'mossy_cobblestone', blockIcon: 'block/mossy_cobblestone' },
  { id: 'tide',      name: 'Tide',      source: 'Ocean Monument (Elder Guardian drop)', rarity: 'uncommon', duplicateWith: 'Prismarine', block: 'prismarine', blockIcon: 'block/prismarine' },
  { id: 'ward',      name: 'Ward',      source: 'Ancient City',      rarity: 'rare',     duplicateWith: 'Cobbled Deepslate', block: 'cobbled_deepslate', blockIcon: 'block/cobbled_deepslate' },
  { id: 'silence',   name: 'Silence',   source: 'Ancient City',      rarity: 'epic',     duplicateWith: 'Cobbled Deepslate', block: 'cobbled_deepslate', blockIcon: 'block/cobbled_deepslate' },
  { id: 'vex',       name: 'Vex',       source: 'Woodland Mansion',  rarity: 'rare',     duplicateWith: 'Cobblestone',       block: 'cobblestone',       blockIcon: 'block/cobblestone' },
  { id: 'snout',     name: 'Snout',     source: 'Bastion Remnant',   rarity: 'uncommon', duplicateWith: 'Blackstone',        block: 'blackstone',        blockIcon: 'block/blackstone' },
  { id: 'rib',       name: 'Rib',       source: 'Nether Fortress',   rarity: 'uncommon', duplicateWith: 'Netherrack',        block: 'netherrack',        blockIcon: 'block/netherrack' },
  { id: 'eye',       name: 'Eye',       source: 'Stronghold',        rarity: 'rare',     duplicateWith: 'End Stone',         block: 'end_stone',         blockIcon: 'block/end_stone' },
  { id: 'spire',     name: 'Spire',     source: 'End City',          rarity: 'rare',     duplicateWith: 'Purpur Block',      block: 'purpur_block',      blockIcon: 'block/purpur_block' },
  { id: 'wayfinder', name: 'Wayfinder', source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta',        block: 'terracotta',        blockIcon: 'block/terracotta' },
  { id: 'shaper',    name: 'Shaper',    source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta',        block: 'terracotta',        blockIcon: 'block/terracotta' },
  { id: 'raiser',    name: 'Raiser',    source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta',        block: 'terracotta',        blockIcon: 'block/terracotta' },
  { id: 'host',      name: 'Host',      source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta',        block: 'terracotta',        blockIcon: 'block/terracotta' },
  { id: 'flow',      name: 'Flow',      source: 'Trial Chambers (Ominous Vault)', rarity: 'uncommon', duplicateWith: 'Breeze Rod',      block: 'breeze_rod',   blockIcon: 'item/breeze_rod' },
  { id: 'bolt',      name: 'Bolt',      source: 'Trial Chambers (Vault)',         rarity: 'uncommon', duplicateWith: 'Block of Copper', block: 'copper_block', blockIcon: 'block/copper_block' }
];

/**
 * Trim materials. `id` = Mojang trim material id = palette file (textures/trims/color_palettes/<id>.png);
 * `itemId` the ingredient item id, `item` its English name (kept: TH.icon.trimMaterial(m.item) uses it),
 * `color` the tooltip colour of the material line, `darker` = a `<id>_darker` palette exists (used when the
 * armor itself is made of the same material, e.g. iron trim on iron armor).
 */
TH.data.trimMaterials = [
  { id: 'amethyst',  name: 'Amethyst',  item: 'Amethyst Shard',   itemId: 'amethyst_shard',  color: '#9a5cc6' },
  { id: 'copper',    name: 'Copper',    item: 'Copper Ingot',     itemId: 'copper_ingot',    color: '#b4684d', darker: true },
  { id: 'diamond',   name: 'Diamond',   item: 'Diamond',          itemId: 'diamond',         color: '#6eecd2', darker: true },
  { id: 'emerald',   name: 'Emerald',   item: 'Emerald',          itemId: 'emerald',         color: '#11a036' },
  { id: 'gold',      name: 'Gold',      item: 'Gold Ingot',       itemId: 'gold_ingot',      color: '#deb12d', darker: true },
  { id: 'iron',      name: 'Iron',      item: 'Iron Ingot',       itemId: 'iron_ingot',      color: '#ececec', darker: true },
  { id: 'lapis',     name: 'Lapis',     item: 'Lapis Lazuli',     itemId: 'lapis_lazuli',    color: '#416e97' },
  { id: 'netherite', name: 'Netherite', item: 'Netherite Ingot',  itemId: 'netherite_ingot', color: '#625859', darker: true },
  { id: 'quartz',    name: 'Quartz',    item: 'Nether Quartz',    itemId: 'quartz',          color: '#e3d4c4' },
  { id: 'redstone',  name: 'Redstone',  item: 'Redstone Dust',    itemId: 'redstone',        color: '#971607' },
  { id: 'resin',     name: 'Resin',     item: 'Resin Brick',      itemId: 'resin_brick',     color: '#fc7812' }
];

/**
 * Armor materials. `id` matches TH.icon.item (golden_helmet ...); `tex` is the file name under
 * textures/entity/equipment/humanoid[_leggings]/ (gold, turtle_scute differ from the id);
 * `trimMat` the trim material whose `_darker` palette applies; `dyeable` leather only;
 * `pieces` limits which slots exist (turtle = helmet only).
 */
TH.data.armorMaterials = [
  { id: 'leather',   name: 'Leather',   tex: 'leather',      color: '#a0653f', dyeable: true },
  { id: 'copper',    name: 'Copper',    tex: 'copper',       color: '#c06c4c', trimMat: 'copper' },
  { id: 'chainmail', name: 'Chainmail', tex: 'chainmail',    color: '#8c8c8c' },
  { id: 'iron',      name: 'Iron',      tex: 'iron',         color: '#d8d8d8', trimMat: 'iron' },
  { id: 'golden',    name: 'Golden',    tex: 'gold',         color: '#f5d33c', trimMat: 'gold' },
  { id: 'diamond',   name: 'Diamond',   tex: 'diamond',      color: '#4fd8d0', trimMat: 'diamond' },
  { id: 'netherite', name: 'Netherite', tex: 'netherite',    color: '#4a4246', trimMat: 'netherite' },
  { id: 'turtle',    name: 'Turtle Shell', tex: 'turtle_scute', color: '#47a03a', pieces: ['helmet'] }
];

/** Slots, in top-to-bottom order of the armor stand. */
TH.data.armorPieces = [
  { id: 'helmet',     name: 'Helmet' },
  { id: 'chestplate', name: 'Chestplate' },
  { id: 'leggings',   name: 'Leggings' },
  { id: 'boots',      name: 'Boots' }
];

/** Leather dye colours (DyeColor texture diffuse colours) + the default undyed leather colour. */
TH.data.leatherDefault = '#a06540';
TH.data.dyes = [
  { id: 'white',      color: '#f9fffe' }, { id: 'light_gray', color: '#9d9d97' }, { id: 'gray',   color: '#474f52' }, { id: 'black',  color: '#1d1d21' },
  { id: 'brown',      color: '#835432' }, { id: 'red',        color: '#b02e26' }, { id: 'orange', color: '#f9801d' }, { id: 'yellow', color: '#fed83d' },
  { id: 'lime',       color: '#80c71f' }, { id: 'green',      color: '#5e7c16' }, { id: 'cyan',   color: '#169c9c' }, { id: 'light_blue', color: '#3ab3da' },
  { id: 'blue',       color: '#3c44aa' }, { id: 'purple',     color: '#8932b8' }, { id: 'magenta', color: '#c74ebd' }, { id: 'pink',  color: '#f38baa' }
];

/** The netherite upgrade template (not a trim pattern): needed once per netherite piece. */
TH.data.trimNetheriteUpgrade = {
  id: 'netherite_upgrade', source: 'Bastion Remnant', rarity: 'uncommon', duplicateWith: 'Netherrack', block: 'netherrack', blockIcon: 'block/netherrack',
  icon: 'item/netherite_upgrade_smithing_template'
};

/** Duplicating any smithing template: 1 template + 7 diamonds + 1 base block -> 2 templates (one extra copy). */
TH.data.templateCopyDiamonds = 7;
