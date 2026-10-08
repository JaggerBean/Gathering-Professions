// Default gathering tools: one basic tool per profession, created as real
// world tool Items ("Gathering Tools" folder) and set as that profession's
// accepted tools. Basic tools add no bonus; they are required to gather and
// wear on a natural 1 (durability.js). Better tools are added by the GM to a
// profession's list (Gathering Tools dialog) or to a single node's list.
import { MODULE_ID, PROFESSIONS } from "./rules.js";

export const TOOLS_FOLDER = "Gathering Tools";

const tool = (name, img, text) => Object.freeze({ name, img: `icons/${img}`, text });

export const DEFAULT_TOOLS = Object.freeze({
  mining: tool("Miner's Pick", "tools/hand/pickaxe-steel-grey.webp", "A sturdy iron pick for breaking stone and prying ore from a vein."),
  herbalism: tool("Herbalism Sickle", "tools/hand/sickle-steel-grey.webp", "A small curved blade for cutting herbs and flowers cleanly."),
  logging: tool("Woodcutter's Axe", "weapons/axes/axe-broad-brown.webp", "A broad-bladed axe for felling trees and splitting timber."),
  skinning: tool("Skinning Knife", "weapons/daggers/dagger-simple-black.webp", "A thin, sharp knife for taking hides and parts cleanly.")
});

const asEntry = item => ({ uuid: item.uuid, name: item.name, img: item.img ?? "" });

/**
 * GM: create the basic tool for each profession that has no accepted tools
 * yet, and set it as that profession's default. Existing lists are kept.
 * @returns {Promise<number>} tools created
 */
export async function buildDefaultTools() {
  if (!game.user.isGM) throw new Error("Only the GM may create gathering tools.");
  const professions = Object.values(PROFESSIONS);
  const missing = professions.filter(profession => DEFAULT_TOOLS[profession.key] && !(profession.tools ?? []).length);
  if (!missing.length) return 0;
  const folder = Array.from(game.folders ?? []).find(entry => entry.type === "Item" && entry.name === TOOLS_FOLDER && !entry.folder)
    ?? await Folder.implementation.create({ name: TOOLS_FOLDER, type: "Item" });
  const observer = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const created = await Item.implementation.create(missing.map(profession => {
    const entry = DEFAULT_TOOLS[profession.key];
    return {
      name: entry.name, type: "tool", img: entry.img, folder: folder.id, ownership: observer,
      system: { quantity: 1, proficient: 0, description: { value: `<p>${entry.text}</p><p><em>Basic ${profession.label} tool: required to gather; no bonus. A natural 1 on a gathering check costs 1 durability.</em></p>` } },
      flags: { [MODULE_ID]: { defaultTool: profession.key } }
    };
  }));
  // Match by flag: Foundry may return created documents in a different order.
  const byProfession = new Map(created.map(item => [item.getFlag?.(MODULE_ID, "defaultTool") ?? item.flags?.[MODULE_ID]?.defaultTool, item]));
  await game.modules.get(MODULE_ID).api.setProfessions(professions.map(profession =>
    byProfession.has(profession.key) ? { ...profession, tools: [asEntry(byProfession.get(profession.key))] } : profession));
  return created.length;
}
