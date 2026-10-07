window.TH = window.TH || {};
TH.data = TH.data || {};

// Rarity follows the item rarity shown in-game (Java 1.21+). Silence is 'epic'.
TH.data.trimPatterns = [
  { id: 'sentry',    name: 'Sentry',    source: 'Pillager Outpost',  rarity: 'uncommon', duplicateWith: 'Cobblestone' },
  { id: 'dune',      name: 'Dune',      source: 'Desert Pyramid',    rarity: 'uncommon', duplicateWith: 'Sandstone' },
  { id: 'coast',     name: 'Coast',     source: 'Shipwreck',         rarity: 'uncommon', duplicateWith: 'Cobblestone' },
  { id: 'wild',      name: 'Wild',      source: 'Jungle Pyramid',    rarity: 'uncommon', duplicateWith: 'Mossy Cobblestone' },
  { id: 'tide',      name: 'Tide',      source: 'Ocean Monument (Elder Guardian drop)', rarity: 'uncommon', duplicateWith: 'Prismarine' },
  { id: 'ward',      name: 'Ward',      source: 'Ancient City',      rarity: 'rare',     duplicateWith: 'Cobbled Deepslate' },
  { id: 'silence',   name: 'Silence',   source: 'Ancient City',      rarity: 'epic',     duplicateWith: 'Cobbled Deepslate' },
  { id: 'vex',       name: 'Vex',       source: 'Woodland Mansion',  rarity: 'rare',     duplicateWith: 'Cobblestone' },
  { id: 'snout',     name: 'Snout',     source: 'Bastion Remnant',   rarity: 'uncommon', duplicateWith: 'Blackstone' },
  { id: 'rib',       name: 'Rib',       source: 'Nether Fortress',   rarity: 'uncommon', duplicateWith: 'Netherrack' },
  { id: 'eye',       name: 'Eye',       source: 'Stronghold',        rarity: 'rare',     duplicateWith: 'End Stone' },
  { id: 'spire',     name: 'Spire',     source: 'End City',          rarity: 'rare',     duplicateWith: 'Purpur Block' },
  { id: 'wayfinder', name: 'Wayfinder', source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta' },
  { id: 'shaper',    name: 'Shaper',    source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta' },
  { id: 'raiser',    name: 'Raiser',    source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta' },
  { id: 'host',      name: 'Host',      source: 'Trail Ruins',       rarity: 'uncommon', duplicateWith: 'Terracotta' },
  { id: 'flow',      name: 'Flow',      source: 'Trial Chambers (Ominous Vault)', rarity: 'uncommon', duplicateWith: 'Breeze Rod' },
  { id: 'bolt',      name: 'Bolt',      source: 'Trial Chambers (Vault)',         rarity: 'uncommon', duplicateWith: 'Block of Copper' }
];

TH.data.trimMaterials = [
  { id: 'amethyst',  name: 'Amethyst',  item: 'Amethyst Shard',   color: '#9a5cc6' },
  { id: 'copper',    name: 'Copper',    item: 'Copper Ingot',     color: '#b4684d' },
  { id: 'diamond',   name: 'Diamond',   item: 'Diamond',          color: '#6eecd2' },
  { id: 'emerald',   name: 'Emerald',   item: 'Emerald',          color: '#11a036' },
  { id: 'gold',      name: 'Gold',      item: 'Gold Ingot',       color: '#deb12d' },
  { id: 'iron',      name: 'Iron',      item: 'Iron Ingot',       color: '#c6c6c6' },
  { id: 'lapis',     name: 'Lapis',     item: 'Lapis Lazuli',     color: '#416e97' },
  { id: 'netherite', name: 'Netherite', item: 'Netherite Ingot',  color: '#625859' },
  { id: 'quartz',    name: 'Quartz',    item: 'Nether Quartz',    color: '#e3d4c4' },
  { id: 'redstone',  name: 'Redstone',  item: 'Redstone Dust',    color: '#971607' },
  { id: 'resin',     name: 'Resin',     item: 'Resin Brick',      color: '#fc7812' }
];

TH.data.armorMaterials = [
  { id: 'leather',   name: 'Leather',   color: '#a0653f' },
  { id: 'copper',    name: 'Copper',    color: '#c06c4c' },
  { id: 'chainmail', name: 'Chainmail', color: '#8c8c8c' },
  { id: 'iron',      name: 'Iron',      color: '#d8d8d8' },
  { id: 'golden',    name: 'Golden',    color: '#f5d33c' },
  { id: 'diamond',   name: 'Diamond',   color: '#4fd8d0' },
  { id: 'netherite', name: 'Netherite', color: '#4a4246' },
  { id: 'turtle',    name: 'Turtle Shell', color: '#47a03a', pieces: ['helmet'] }
];
