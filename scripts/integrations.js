// Skill Tree link, rank mirrors, and rare-find draws.
import { MODULE_ID, PROFESSIONS, rankForActor, selectedProfession } from "./rules.js";

export const SKILL_TREE_ID = "skill-tree";
export const DEFAULT_SKILL_TREE = Object.freeze({ uuid: "", pointsPerRank: 2, startingPoints: 2, pointsVersion: 2 });
// Perks moved to perks.js; re-exported so older imports keep working.
export { MAX_PERK_YIELD, readPerk, normalizePerk, actorPerks } from "./perks.js";

function wholeNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

/** World Skill Tree settings with safe defaults. */
export function skillTreeConfig() {
  let saved = {};
  try { saved = globalThis.game?.settings?.get(MODULE_ID, "skillTree") || {}; }
  catch { /* Not registered yet. */ }
  // Existing 3/3 worlds use the new 2/2 rate without removing spent points.
  const oldThreePointRate = saved.pointsVersion !== 2 && saved.pointsPerRank === 3 && saved.startingPoints === 3;
  return {
    uuid: typeof saved.uuid === "string" ? saved.uuid : "",
    pointsPerRank: oldThreePointRate ? 2 : wholeNumber(saved.pointsPerRank, DEFAULT_SKILL_TREE.pointsPerRank),
    startingPoints: oldThreePointRate ? 2 : wholeNumber(saved.startingPoints, DEFAULT_SKILL_TREE.startingPoints),
    pointsVersion: 2
  };
}

export function normalizeSkillTreeConfig(value = {}) {
  const uuid = typeof value.uuid === "string" ? value.uuid.trim() : "";
  const pointsPerRank = Number(value.pointsPerRank);
  const startingPoints = Number(value.startingPoints ?? 0);
  if (!Number.isInteger(pointsPerRank) || pointsPerRank < 0 || pointsPerRank > 100) throw new Error("Points per rank must be a whole number from 0 to 100.");
  if (!Number.isInteger(startingPoints) || startingPoints < 0 || startingPoints > 100) throw new Error("Starting points must be a whole number from 0 to 100.");
  return { uuid, pointsPerRank, startingPoints, pointsVersion: 2 };
}

/** The Skill Tree module API, or null when the module is missing or inactive. */
export function skillTreeApi() {
  const module = globalThis.game?.modules?.get(SKILL_TREE_ID);
  return module?.active ? module.API ?? null : null;
}

/** Journal entries that the Skill Tree module marks as trees. */
export function availableSkillTrees() {
  if (!globalThis.game?.modules?.get(SKILL_TREE_ID)?.active) return [];
  return Array.from(globalThis.game?.journal ?? []).filter(entry => entry.getFlag?.(SKILL_TREE_ID, "isSkillTree"));
}

export function configuredSkillTree() {
  const { uuid } = skillTreeConfig();
  if (!uuid) return null;
  try { return globalThis.fromUuidSync?.(uuid) ?? null; }
  catch { return null; }
}

/** Points a character has earned at this rank: Rank 1 points plus each rank-up. */
export function pointsOwed(rank, config = skillTreeConfig()) {
  return rank > 0 ? config.startingPoints + (rank - 1) * config.pointsPerRank : 0;
}

function treeKey(tree) {
  return tree.id ?? String(tree.uuid ?? "").split(".").pop();
}

/** Points the actor already has in a tree: spent on skills plus unspent. */
function pointsInTree(api, actor, tree) {
  try { return Math.max(0, Number(api.getSkillTreePoints?.(actor, tree)?.total) || 0); }
  catch { return 0; }
}

/** Clear only this universal tree's purchases and refund its current budget. */
async function resetTreeSkills(actor, api, tree, owed, backupKey, { preserveBackup = false } = {}) {
  const pages = Array.from(tree.pages ?? []).filter(page => page.getFlag?.(MODULE_ID, "universalSkill"));
  if (!pages.length) throw new Error("The linked tree is not a Gathering Professions universal skill tree.");
  const pageByUuid = new Map(pages.map(page => [page.uuid, page]));
  const id = treeKey(tree);
  const pointData = api.getSkillTreePoints(actor, tree);
  if (!pointData || !Number.isFinite(Number(pointData.total))) throw new Error(`${actor.name}: Could not read Skill Tree points.`);
  const key = `treePoints.${id}`;
  const recorded = actor.getFlag(MODULE_ID, key);
  const backupPath = `${backupKey}.${id}`;
  let backup = preserveBackup ? actor.getFlag(MODULE_ID, backupPath) : null;
  const skills = actor.getFlag(SKILL_TREE_ID, "skills") ?? [];
  if (!Array.isArray(skills)) throw new Error(`${actor.name}: Skill Tree skills are invalid.`);
  if (!backup) {
    const purchased = skills.filter(skill => pageByUuid.has(skill.uuid) && Number(skill.points) > 0);
    const purchasedKeys = new Set(purchased.map(skill => pageByUuid.get(skill.uuid).getFlag(MODULE_ID, "universalSkill")));
    const items = Array.from(actor.items ?? []).filter(item => purchasedKeys.has(item.getFlag?.(MODULE_ID, "universalSkill")));
    backup = { points: pointData.total, recorded: recorded ?? null, skills: purchased,
      items: items.map(item => item.toObject()) };
    await actor.setFlag(MODULE_ID, backupPath, backup);
  }
  const purchasedKeys = new Set(backup.skills.map(skill => pageByUuid.get(skill.uuid)?.getFlag(MODULE_ID, "universalSkill")));
  const itemIds = Array.from(actor.items ?? []).filter(item => purchasedKeys.has(item.getFlag?.(MODULE_ID, "universalSkill")))
    .map(item => item.id);
  const otherSkills = skills.filter(skill => !pageByUuid.has(skill.uuid));
  if (otherSkills.length !== skills.length) await actor.setFlag(SKILL_TREE_ID, "skills", otherSkills);
  if (itemIds.length) await actor.deleteEmbeddedDocuments("Item", itemIds);
  const after = api.getSkillTreePoints(actor, tree);
  const delta = owed - Number(after?.total);
  if (!Number.isFinite(delta)) throw new Error(`${actor.name}: Could not read Skill Tree points after reset.`);
  if (delta) await api.grantSkillPoints(actor, delta, { skillTree: tree });
  if (Number(api.getSkillTreePoints(actor, tree)?.total) !== owed) {
    throw new Error(`${actor.name}: Skill Tree point reset did not reach ${owed}.`);
  }
  if (recorded !== owed) await actor.setFlag(MODULE_ID, key, owed);
  await actor.setFlag(MODULE_ID, `pointRebalanceVersion.${id}`, 1);
  return { points: owed, removedSkills: backup.skills.length, removedItems: backup.items.length };
}

/** One-time reset of old point grants when the active GM loads the world. */
async function rebalanceExistingPoints(actor, api, tree, owed) {
  if (!api?.getSkillTreePoints || !api?.grantSkillPoints) return;
  if (!Array.from(tree.pages ?? []).some(page => page.getFlag?.(MODULE_ID, "universalSkill"))) return;
  const id = treeKey(tree);
  const marker = `pointRebalanceVersion.${id}`;
  if (actor.getFlag(MODULE_ID, marker) === 1) return;
  const pointData = api.getSkillTreePoints(actor, tree);
  if (!pointData || !Number.isFinite(Number(pointData.total))) return;
  const recorded = actor.getFlag(MODULE_ID, `treePoints.${id}`);
  if (actor.getFlag(MODULE_ID, `pointRebalanceBackup.${id}`) || Number(recorded) > owed || Number(pointData.total) > owed) {
    await resetTreeSkills(actor, api, tree, owed, "pointRebalanceBackup", { preserveBackup: true });
  } else {
    await actor.setFlag(MODULE_ID, marker, 1);
  }
}

/** GM action for one character; the caller serializes it with other actor tasks. */
export async function resetUniversalTreeSkills(actor, tree = configuredSkillTree()) {
  if (!game.user.isGM) throw new Error("Only the GM may reset skills.");
  if (actor?.type !== "character" || !tree || tree.uuid !== configuredSkillTree()?.uuid) {
    throw new Error("Choose a character and the linked gathering skill tree.");
  }
  const api = skillTreeApi();
  if (!api?.getSkillTreePoints || !api?.grantSkillPoints) throw new Error("The Skill Tree module is not ready.");
  const selected = selectedProfession(actor);
  const rank = selected ? rankForActor(actor, selected) : 0;
  return resetTreeSkills(actor, api, tree, pointsOwed(rank), "lastSkillResetBackup");
}

/**
 * Mirror effective ranks into flags.gathering-professions.effectiveRank.<key>
 * and the selected profession's rank into professionRank for point awards,
 * then top the actor up to the points their rank has earned in
 * the linked tree. Points are tracked per tree (treePoints.<treeId>), so a new
 * tree or a higher points setting grants the difference. The first sync with
 * a tree counts points already spent or held there. The 2-point migration
 * resets old universal-tree choices and refunds the new budget once.
 * Call it inside the actor's existing task queue, never from a nested queue.
 * @returns {Promise<{granted: number}>}
 */
export async function syncProfessionState(actor, { grant = true } = {}) {
  if (!actor || actor.type !== "character") return { granted: 0 };
  const ranks = Object.fromEntries(Object.keys(PROFESSIONS).map(key => [key, rankForActor(actor, key)]));
  const mirrored = actor.getFlag(MODULE_ID, "effectiveRank") ?? {};
  if (Object.entries(ranks).some(([key, rank]) => mirrored[key] !== rank)) {
    await actor.setFlag(MODULE_ID, "effectiveRank", ranks);
  }
  // Point awards use the selected profession's rank.
  const selected = selectedProfession(actor);
  const professionRank = selected ? ranks[selected] : 0;
  if (actor.getFlag(MODULE_ID, "professionRank") !== professionRank) {
    await actor.setFlag(MODULE_ID, "professionRank", professionRank);
  }

  if (!grant) return { granted: 0 };
  const api = skillTreeApi();
  const tree = configuredSkillTree();
  const owed = pointsOwed(professionRank);
  if (api && tree) await rebalanceExistingPoints(actor, api, tree, owed);
  if (!professionRank || !api?.grantSkillPoints || !tree) return { granted: 0 };
  const key = `treePoints.${treeKey(tree)}`;
  const stored = actor.getFlag(MODULE_ID, key);
  const recorded = Number.isInteger(stored) ? stored : null;
  const points = recorded === null ? Math.max(0, owed - pointsInTree(api, actor, tree)) : Math.max(0, owed - recorded);
  if (points > 0) await api.grantSkillPoints(actor, points, { skillTree: tree });
  const next = Math.max(owed, recorded ?? 0);
  if (next !== recorded) await actor.setFlag(MODULE_ID, key, next);
  if (points > 0) {
    globalThis.ui?.notifications?.info(`${actor.name} gained ${points} skill point${points === 1 ? "" : "s"} in ${tree.name}.`);
  }
  return { granted: points };
}

/**
 * Roll once on a rare-find RollTable without posting Foundry's own card.
 * @returns {Promise<{table: object, items: object[], texts: string[]}>}
 */
export async function drawRareFind(tableUuid) {
  const table = await globalThis.fromUuid?.(tableUuid);
  if (!table?.roll) throw new Error(`Rare-find table not found: ${tableUuid}`);
  // roll() reads the table without marking results drawn, so players need no
  // edit permission on the table and it never runs dry.
  const draw = await table.roll();
  const ItemClass = globalThis.CONFIG?.Item?.documentClass?.implementation;
  const items = [];
  const texts = [];
  for (const result of draw?.results ?? []) {
    const document = result.documentUuid ? await globalThis.fromUuid(result.documentUuid) : null;
    if (ItemClass && document instanceof ItemClass) items.push(document);
    else texts.push(String(result.name ?? result.text ?? result.description ?? "").trim() || "Unknown result");
  }
  return { table, items, texts };
}
