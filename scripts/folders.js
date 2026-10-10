// Items-tab layout (0.31.2, user-approved): everything for a gathering
// profession under Gathering / <Profession>, plus Gathering / Tools and
// Gathering / Skill Tree. Crafting Professions uses Crafting / <Profession>.
export const GATHERING_ROOT = "Gathering";

/** Folder path for a profession's items of one kind. */
export const ITEM_FOLDERS = Object.freeze({
  herbalism: { materials: ["Gathering", "Herbalism", "Wild"], refined: ["Gathering", "Herbalism", "Prepared"], rare: ["Gathering", "Herbalism", "Rare Finds"] },
  mining: { materials: ["Gathering", "Mining", "Ores"], refined: ["Gathering", "Mining", "Refined"], rare: ["Gathering", "Mining", "Rare Finds"] },
  logging: { materials: ["Gathering", "Logging", "Logs"], refined: ["Gathering", "Logging", "Timber"], rare: ["Gathering", "Logging", "Rare Finds"] },
  skinning: { materials: ["Gathering", "Skinning", "Materials"], refined: ["Gathering", "Skinning", "Refined"], rare: ["Gathering", "Skinning", "Rare Finds"] }
});
export const TOOLS_PATH = Object.freeze(["Gathering", "Tools"]);
export const SKILL_TREE_PATH = Object.freeze(["Gathering", "Skill Tree"]);

/** A profession's folder path (custom professions get Gathering / <Label> / <Kind>). */
export function professionFolder(profession, kind, label = profession) {
  return ITEM_FOLDERS[profession]?.[kind] ?? [GATHERING_ROOT, label, { materials: "Materials", refined: "Refined", rare: "Rare Finds" }[kind] ?? kind];
}

/** Find or create a nested Item folder path like ["Gathering", "Herbalism", "Wild"]. */
export async function itemFolderPath(names) {
  let parent = null;
  for (const name of names) {
    let folder = Array.from(game.folders ?? []).find(entry => entry.type === "Item" && entry.name === name && (entry.folder?.id ?? entry.folder ?? null) === (parent?.id ?? null));
    folder ??= await Folder.implementation.create({ name, type: "Item", folder: parent?.id ?? null });
    parent = folder;
  }
  return parent;
}
