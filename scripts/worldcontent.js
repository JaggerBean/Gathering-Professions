// Permanent world content the module keeps in place. On the active GM's load
// (once per CONTENT_VERSION, or on demand from Gathering Content):
//   1. The universal gathering Skill Tree: link the existing one, or build it
//      (journal + 30 skill Items in "Gathering Skill Tree" folders).
//   2. Rare finds: clear any-tier fallbacks that point at deleted tables, and
//      build the default tier tables when no profession has any.
//   3. Gathering tools: create the basic tool for each profession with no
//      accepted tools, and make it that profession's default.
//   4. Difficulty: when no condition DC modifiers exist, use the recommended
//      values (moderate, penalties only).
// Nothing the GM made is deleted.
import { MODULE_ID, PROFESSIONS } from "./rules.js";
import { SKILL_TREE_PATH, itemFolderPath } from "./folders.js";
import { skillTreeConfig, configuredSkillTree, availableSkillTrees } from "./integrations.js";
import { buildUniversalTree } from "./skilltree.js";
import { buildRareFinds } from "./rareitems.js";
import { buildDefaultTools } from "./gatheringtools.js";
import { getConditionDc, defaultConditionDcRows } from "./conditions.js";

export const CONTENT_VERSION = 3;
export const TREE_FOLDER = "Gathering Skill Tree";

const isUniversal = tree => Array.from(tree?.pages ?? []).some(page => page.getFlag?.(MODULE_ID, "universalSkill"));

async function folderFor(type, name = TREE_FOLDER) {
  const existing = Array.from(game.folders ?? []).find(folder => folder.type === type && folder.name === name && !folder.folder);
  return existing ?? Folder.implementation.create({ name, type });
}

/** GM: put the gathering tree and rare-find tables in place. */
export async function ensureWorldContent({ force = false } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM may set up gathering content.");
  const done = Number(game.settings.get(MODULE_ID, "worldContentVersion")) || 0;
  if (!force && done >= CONTENT_VERSION) return null;
  const api = game.modules.get(MODULE_ID).api;
  const report = { tree: "", built: false, rareTables: 0, clearedFallbacks: 0, tools: 0, conditionDc: 0 };

  const skillTreeActive = game.modules.get("skill-tree")?.active === true;
  if (skillTreeActive) {
    let tree = configuredSkillTree();
    if (!isUniversal(tree)) tree = availableSkillTrees().find(isUniversal) ?? null;
    if (!tree) {
      const journalFolder = await folderFor("JournalEntry");
      const itemFolder = await itemFolderPath(SKILL_TREE_PATH);
      tree = (await buildUniversalTree({ itemFolder: itemFolder.id, journalFolder: journalFolder.id })).tree;
      report.built = true;
    }
    report.tree = tree.name;
    if (skillTreeConfig().uuid !== tree.uuid) await api.setSkillTreeConfig({ ...skillTreeConfig(), uuid: tree.uuid });
  } else {
    report.tree = "Skill Tree inactive";
  }

  const professions = Object.values(PROFESSIONS).map(profession => {
    if (profession.rareTable && !globalThis.fromUuidSync?.(profession.rareTable)) {
      report.clearedFallbacks++;
      return { ...profession, rareTable: "" };
    }
    return profession;
  });
  if (report.clearedFallbacks) await api.setProfessions(professions);
  if (!Object.values(PROFESSIONS).some(profession => profession.rareTables?.some(Boolean))) {
    report.rareTables = (await buildRareFinds()).tables;
  }
  report.tools = await buildDefaultTools();
  if (!getConditionDc().length) {
    const rows = defaultConditionDcRows();
    await game.settings.set(MODULE_ID, "conditionDc", rows);
    report.conditionDc = rows.length;
  }
  if (skillTreeActive) await game.settings.set(MODULE_ID, "worldContentVersion", CONTENT_VERSION);
  return report;
}
