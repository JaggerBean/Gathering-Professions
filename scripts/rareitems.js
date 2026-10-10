// Default rare finds: three unique Items per profession and tier, each only
// obtainable from that tier's rare-find table. The GM can rename, re-art, or
// replace them freely after building; the tables are ordinary RollTables.
import { MODULE_ID, PROFESSIONS } from "./rules.js";
import { professionFolder, itemFolderPath } from "./folders.js";

export const RARE_TIERS = 5;
// dnd5e rarity per tier (display only).
export const TIER_RARITY = Object.freeze(["uncommon", "rare", "veryRare", "legendary", "artifact"]);

const find = (name, img, text) => Object.freeze({ name, img: `icons/${img}`, text });

export const RARE_FINDS = Object.freeze({
  mining: [
    [find("Sparkvein Quartz", "commodities/gems/gem-faceted-round-white.webp", "A quartz shard with a thread of trapped lightning flickering at its core."),
      find("Humming Geode", "commodities/stone/geode-raw-white.webp", "A fist-sized geode lined with violet crystal that hums when struck."),
      find("Miner's Luckstone", "commodities/stone/ore-pile-tan.webp", "A smooth grey pebble that grows cold before a cave-in, or so the old miners swear.")],
    [find("Emberheart Garnet", "commodities/gems/gem-faceted-diamond-green.webp", "A deep red garnet that stays warm to the touch, even in snow."),
      find("Moonsilver Nugget", "commodities/metal/ingot-stamped-silver.webp", "Silver ore that glows a pale blue under moonlight."),
      find("Fossilized Wyrmscale", "commodities/stone/ore-chunk-black.webp", "A stone-hard scale from a drake that died before the first kingdoms.")],
    [find("Starfall Iron", "commodities/stone/ore-chunk-black.webp", "Meteoric iron, cold and impossibly dense, pitted by its fall from the sky."),
      find("Living Opal", "commodities/gems/gem-rough-navette-purple.webp", "An opal whose colours shift with the mood of whoever holds it."),
      find("Rune-Stamped Deep Ingot", "commodities/metal/ingot-gold.webp", "A smelted ingot stamped with runes no living smith can read.")],
    [find("Adamant Heartstone", "commodities/stone/geode-raw-white.webp", "The dark, unbreakable core of an adamantine seam."),
      find("Phoenix Ruby", "magic/fire/flame-burning-hand-orange.webp", "A ruby with a tiny flame dancing inside that never goes out."),
      find("Titan's Tear Diamond", "commodities/gems/gem-faceted-round-white.webp", "A flawless diamond the size of an egg, said to be a weeping giant's tear.")],
    [find("Worldvein Crystal", "magic/light/orb-lightbulb-gray.webp", "A crystal pulsing in time with the ley lines that run beneath the world."),
      find("Primordial Ore", "commodities/stone/ore-pile-tan.webp", "A fragment of stone older than the world's making, warm and faintly alive."),
      find("Godforge Ember", "magic/fire/flame-burning-hand-orange.webp", "A coal from a divine forge. It has not stopped burning in ten thousand years.")]
  ],
  herbalism: [
    [find("Four-Leaf Dewclover", "magic/control/buff-luck-fortune-green.webp", "A clover whose dew never dries. Lucky, or so the halflings say."),
      find("Whisperbloom", "magic/nature/leaf-glow-green.webp", "A pale flower that murmurs softly when the wind is still."),
      find("Honeyglow Moss", "magic/nature/leaf-hand-green.webp", "Golden moss that glows faintly and smells of warm honey.")],
    [find("Silverthread Fern", "consumables/plants/thorned-stem-vine-green.webp", "A fern with leaves veined in true silver."),
      find("Dreamcap", "magic/nature/leaf-glow-green.webp", "A blue mushroom; a sliver under the tongue brings vivid, telling dreams."),
      find("Sunpetal Lily", "magic/life/heart-cross-strong-flame-green.webp", "A lily that drinks daylight and gives it back as a soft glow at night.")],
    [find("Wraithroot", "magic/nature/root-vine-entwined-thorns.webp", "A bone-white root. Those who taste it glimpse spirits for an hour."),
      find("Phoenix Sage", "magic/fire/flame-burning-hand-orange.webp", "Ash-red leaves that rekindle into fresh growth when burned."),
      find("Feyheart Rose", "magic/life/heart-cross-strong-flame-green.webp", "A rose from where the Feywild runs thin; its thorns draw no blood.")],
    [find("Moonflower of Ages", "magic/nature/leaf-glow-green.webp", "Blooms once a century, under a full moon, and never wilts once picked."),
      find("Bloodthorn Bloom", "magic/nature/root-vine-entwined-thorns.webp", "A crimson flower that feeds on old battlefields."),
      find("Sylvan Starlotus", "magic/light/orb-lightbulb-gray.webp", "A lotus whose petals hold the reflection of stars, even by day.")],
    [find("Seed of the World Tree", "magic/nature/tree-spirit-green.webp", "A seed that hums with the life of every forest in the world."),
      find("Everbloom Blossom", "magic/life/heart-cross-strong-flame-green.webp", "A flower that has not wilted since the gods walked the land."),
      find("Ambrosia Petal", "magic/control/buff-luck-fortune-green.webp", "A single petal of the gods' own garden, sweet beyond words.")]
  ],
  logging: [
    [find("Knotted Luckwood", "commodities/wood/bark-beige.webp", "A branch knotted into a perfect spiral. Carvers prize it for charms."),
      find("Amberdrop Resin", "commodities/gems/gem-amber-insect-orange.webp", "A bead of fresh amber with a tiny insect caught inside."),
      find("Songbird Heartwood", "commodities/wood/lumber-stack.webp", "Heartwood that chimes like birdsong when tapped.")],
    [find("Ironbark Strip", "commodities/wood/bark-beige.webp", "Bark as hard as forged iron, yet light as cork."),
      find("Whispering Willow Branch", "commodities/wood/lumber-stack.webp", "A willow switch that turns toward hidden water."),
      find("Petrified Ghostwood", "commodities/stone/ore-chunk-black.webp", "Grey stone-wood, cold to the touch, from a forest that died in a single night.")],
    [find("Duskwood Burl", "commodities/wood/bark-beige.webp", "A dark burl whose grain swirls like smoke at twilight."),
      find("Emberoak Heartwood", "magic/fire/flame-burning-hand-orange.webp", "Oak that smoulders gently forever and never turns to ash."),
      find("Spiritbirch Bark", "commodities/wood/bark-beige.webp", "Pale bark on which faint runes surface and fade.")],
    [find("Treant's Living Heartwood", "magic/nature/tree-spirit-green.webp", "Heartwood still alive and slowly growing, freely given by an ancient treant."),
      find("Stormstruck Ashwood", "commodities/wood/lumber-stack.webp", "Ash split by lightning; static crackles along its grain."),
      find("Elvenwood Bough of Ages", "commodities/wood/lumber-stack.webp", "A silver-barked bough from a tree the elves planted at the dawn of their realm.")],
    [find("Branch of the World Tree", "magic/nature/tree-spirit-green.webp", "A living branch of the tree that holds up the sky in the old songs."),
      find("Primeval Amber", "commodities/gems/gem-amber-insect-orange.webp", "Amber holding a creature no scholar has ever named."),
      find("Heartwood of the Dreaming Grove", "commodities/wood/lumber-stack.webp", "Wood that shows the sleeper's dreams to anyone who rests their head on it.")]
  ],
  skinning: [
    [find("Silverfox Tail", "commodities/materials/hair-tuft-white.webp", "A flawless silver tail, soft as smoke."),
      find("Glossy Raven Pinion", "commodities/materials/feather-blue.webp", "A raven feather with an oil-sheen of every colour."),
      find("Perfect Antler Tine", "commodities/bones/horn-antler-brown.webp", "An antler tine without a single crack or chip.")],
    [find("Shimmerhide Strip", "commodities/leather/leather-scrap-brown.webp", "A strip of hide that blurs at the edges, as if not quite here."),
      find("Owlbear Down", "commodities/materials/feather-white.webp", "Downy owlbear feathers, warmer than any wool."),
      find("Wyvern Barb", "commodities/claws/claw-bear-brown.webp", "A curved tail barb still beaded with dried venom.")],
    [find("Shadowcat Pelt", "commodities/leather/fur-white.webp", "A pelt that drinks in lamplight and hides its wearer in shadow."),
      find("Basilisk Eye", "commodities/biological/eye-purple.webp", "A petrified eye; looking into it makes your fingers stiffen."),
      find("Griffon Primary Feather", "commodities/materials/feather-white.webp", "A flight feather as long as a man's arm.")],
    [find("Drakescale Plate", "commodities/leather/scales-green.webp", "A single scale from a true dragon, harder than steel."),
      find("Unicorn Mane Lock", "commodities/materials/hair-tuft-white.webp", "A lock of mane that heals small cuts it touches."),
      find("Manticore Spine Crown", "commodities/biological/mouth-pincer-brown.webp", "A ring of tail spines, the mark of a manticore's elder.")],
    [find("Phoenix Plume", "commodities/materials/feather-red.webp", "A tail feather that bursts into harmless flame each dawn."),
      find("Behemoth Heartscale", "commodities/leather/scales-green.webp", "The scale that guarded a behemoth's heart, warm and slowly beating."),
      find("Pelt of the White Hart", "commodities/leather/fur-white.webp", "The pelt of the legendary white hart, freely given at its death.")]
  ]
});

/** Professions with default rare finds that exist in this world. */
export function rareFindProfessions() {
  return Object.keys(RARE_FINDS).filter(key => Object.hasOwn(PROFESSIONS, key));
}

/**
 * GM: create the default rare-find Items and one RollTable per profession and
 * tier, then link each profession's tier tables. Professions that already have
 * a table for a tier keep it unless `replace` is true.
 * @returns {Promise<{tables: number, items: number}>}
 */
export async function buildRareFinds({ professions = rareFindProfessions(), replace = false } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM may build rare-find tables.");
  const observer = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const [tableRoot] = await Folder.implementation.create([{ name: "Rare Finds", type: "RollTable", color: "#7a4fb0" }]);
  const list = Object.values(PROFESSIONS).map(profession => ({ ...profession, rareTables: [...(profession.rareTables ?? [])] }));
  let tableCount = 0, itemCount = 0;
  for (const key of professions) {
    const profession = list.find(entry => entry.key === key);
    if (!profession || !RARE_FINDS[key]) continue;
    const tiers = Array.from({ length: RARE_TIERS }, (_, index) => index)
      .filter(index => replace || !profession.rareTables[index]);
    if (!tiers.length) continue;
    const itemFolder = await itemFolderPath(professionFolder(key, "rare", profession.label));
    for (const index of tiers) {
      const tier = index + 1;
      const items = await Item.implementation.create(RARE_FINDS[key][index].map(entry => ({
        name: entry.name, type: "loot", img: entry.img, folder: itemFolder.id, ownership: observer,
        system: { quantity: 1, rarity: TIER_RARITY[index], description: { value: `<p>${entry.text}</p><p><em>Rare find · ${profession.label} tier ${tier}. Found only on that rare-find table.</em></p>` } },
        flags: { [MODULE_ID]: { rareFind: { profession: key, tier } } }
      })));
      const table = await RollTable.implementation.create({
        name: `${profession.label} Rare Finds — Tier ${tier}`, folder: tableRoot.id, formula: `1d${items.length}`,
        replacement: true, displayRoll: false, ownership: observer,
        flags: { [MODULE_ID]: { rareFindTable: { profession: key, tier } } },
        results: items.map((item, slot) => ({ type: "document", documentUuid: item.uuid, name: item.name, img: item.img, weight: 1, range: [slot + 1, slot + 1], drawn: false }))
      });
      profession.rareTables[index] = table.uuid;
      tableCount++;
      itemCount += items.length;
    }
  }
  await game.modules.get(MODULE_ID).api.setProfessions(list);
  return { tables: tableCount, items: itemCount };
}
