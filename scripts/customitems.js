// Items this module provides itself (no compendium has them), created in the
// world on demand by presets and refining. Icons come from Foundry's core
// library. Each created Item carries flags.gathering-professions.customItem.
import { MODULE_ID } from "./rules.js";

const item = (img, price, rarity, description) => Object.freeze({ img, price, rarity, description });

export const CUSTOM_ITEMS = Object.freeze({
  // Logging rare finds.
  "Birch Bark Roll": item("icons/commodities/wood/bark-beige.webp", 0.5, "common",
    "A long curl of papery birch bark peeled in one piece. Woodsfolk write on it, roof shelters with it, and light fires with it even when it is wet."),
  "Knotwood Burl": item("icons/commodities/wood/log-cut-cherry-brown.webp", 5, "uncommon",
    "A swollen knot cut from an old trunk, its grain whorled like smoke. Turners and bowyers pay well for burls; no two bowls carved from one look alike."),
  "Petrified Heartwood": item("icons/commodities/wood/log-cut-petrified-violet.webp", 25, "uncommon",
    "The core of a tree so old it has half turned to stone. It rings like crystal when struck and takes a polish no living wood can match."),
  "Golden Resin Tear": item("icons/commodities/gems/gem-amber-insect-orange.webp", 50, "rare",
    "A hardened drop of resin the size of a thumb, clear gold with a tiny winged insect caught inside. Prized by jewellers, alchemists, and collectors of curiosities."),
  "Elderwood Heartcore": item("icons/commodities/wood/log-cut-walnut.webp", 150, "rare",
    "Dark, dense heartwood from a tree that stood for a thousand years. It barely burns, never rots, and holds an enchantment better than most metals."),
  "Lightning-Struck Ironbark": item("icons/commodities/wood/bark-grey.webp", 200, "very rare",
    "Bark seared from an ironwood split by lightning. Faint blue lines run through the char, and the hair on your arm stands up when you hold it."),
  "Seed of the Old Grove": item("icons/magic/nature/seed-acorn-glowing-green.webp", 250, "very rare",
    "A seed that glows faintly green and is warm to the touch. Druids say such seeds fall only where an ancient grove still remembers being a forest.")
});

/** World Item data for a custom item, or null when the name is not one. */
export function customItemData(name, folder = null) {
  const entry = CUSTOM_ITEMS[name];
  if (!entry) return null;
  return {
    name, type: "loot", img: entry.img, folder,
    system: {
      description: { value: `<p>${entry.description}</p>` },
      price: { value: entry.price, denomination: "gp" },
      rarity: entry.rarity, quantity: 1, weight: { value: 0.5, units: "lb" },
      type: { value: "material" }
    },
    flags: { [MODULE_ID]: { customItem: name } }
  };
}
