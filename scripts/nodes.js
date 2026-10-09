// Gathering nodes: per-node overrides on Gatherer journal pages, gates that
// run before a pull is used, check adjustments, hidden pins with profession
// sense, depleted pin tint, and the Node Builder's create/edit/delete logic.
import { MODULE_ID, PROFESSIONS, ABILITY_LABELS, rankForActor, selectedProfession, professionKey, materialRule } from "./rules.js";
import { actorPerks } from "./perks.js";
import { isBroken } from "./durability.js";
import { normalizeRules } from "./conditions.js";

export const GATHERER_PAGE_TYPE = "gatherer.gatherer";
export const DEPLETED_TINT = "#5a5a5a";
export const ACTIVE_TINT = "#ffffff";

export const NODE_DEFAULTS = Object.freeze({
  profession: "", tier: 1, checkType: "default", checkKey: "",
  dcModifier: 0, yieldModifier: 0, minRank: 0, toolName: "", tools: [],
  rareChance: 0, rareTable: "", hidden: true, senseRank: 0, icon: "", flavor: "", biome: "", materialRules: {},
  built: false, tableUuid: "", linkGroup: ""
});

const int = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

function inRange(name, value, min, max) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return number;
}

export function skillChoices() {
  const skills = globalThis.CONFIG?.DND5E?.skills ?? {};
  return Object.fromEntries(Object.entries(skills).map(([key, value]) => [key, value?.label ?? key]));
}

export function skillLabel(key) {
  return skillChoices()[key] ?? key;
}

/** Validate GM input for a node. Throws a readable Error. */
export function normalizeNode(input = {}) {
  const profession = String(professionKey(input.profession ?? ""));
  if (profession && !Object.hasOwn(PROFESSIONS, profession)) throw new Error("Choose a valid profession for this node.");
  const checkType = String(input.checkType ?? "default");
  if (!["default", "ability", "skill"].includes(checkType)) throw new Error("Choose a valid check for this node.");
  const checkKey = checkType === "default" ? "" : String(input.checkKey ?? "");
  if (checkType === "ability" && !Object.hasOwn(ABILITY_LABELS, checkKey)) throw new Error("Choose a valid ability for this node's check.");
  if (checkType === "skill") {
    const skills = skillChoices();
    const known = Object.keys(skills).length ? Object.hasOwn(skills, checkKey) : /^[a-z]{2,4}$/.test(checkKey);
    if (!known) throw new Error("Choose a valid skill for this node's check.");
  }
  const toolName = String(input.toolName ?? "").trim();
  if (toolName.length > 100) throw new Error("Tool name is too long.");
  const tools = normalizeTools(input.tools);
  return {
    profession,
    tier: inRange("Tier", input.tier ?? 1, 1, 5),
    checkType, checkKey,
    dcModifier: inRange("DC modifier", input.dcModifier, -20, 20),
    yieldModifier: inRange("Yield modifier", input.yieldModifier, -10, 10),
    minRank: inRange("Minimum rank", input.minRank, 0, 5),
    toolName, tools,
    rareChance: inRange("Rare-find bonus", input.rareChance, 0, 100),
    rareTable: String(input.rareTable ?? "").trim(),
    hidden: input.hidden === true || input.hidden === "true",
    senseRank: inRange("Profession sense rank", input.senseRank, 0, 5),
    icon: String(input.icon ?? "").trim(),
    flavor: String(input.flavor ?? "").trim().slice(0, 2000),
    biome: String(input.biome ?? "").trim(),
    materialRules: normalizeMaterialRules(input.materialRules),
    built: input.built === true,
    tableUuid: String(input.tableUuid ?? ""),
    linkGroup: String(input.linkGroup ?? "")
  };
}

/** Accepted tools: [{uuid, name, img}]. Accepts an array or its JSON text. */
export function normalizeTools(value) {
  let list = value;
  if (typeof list === "string") {
    try { list = list.trim() ? JSON.parse(list) : []; } catch { throw new Error("Tool list is not valid."); }
  }
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Tool list is not valid.");
  const seen = new Set();
  const tools = [];
  for (const entry of list) {
    const uuid = String(entry?.uuid ?? "").trim();
    const name = String(entry?.name ?? "").trim();
    if (!uuid && !name) continue;
    const key = uuid || `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push({ uuid, name: name.slice(0, 100), img: String(entry?.img ?? "") });
  }
  if (tools.length > 10) throw new Error("A node can accept at most 10 tools.");
  return tools;
}

/** Node overrides of material condition rules: {itemUuid: rules[]}. */
export function normalizeMaterialRules(value) {
  let map = value;
  if (typeof map === "string") {
    try { map = map.trim() ? JSON.parse(map) : {}; } catch { throw new Error("Node condition rules are not valid."); }
  }
  if (map == null) return {};
  if (typeof map !== "object" || Array.isArray(map)) throw new Error("Node condition rules are not valid.");
  return Object.fromEntries(Object.entries(map).filter(([uuid]) => uuid).map(([uuid, rules]) => [uuid, normalizeRules(rules)]));
}

export function isGathererPage(page) {
  return page?.type === GATHERER_PAGE_TYPE;
}

/** Node settings on a Gatherer page, or null for a page without them. */
export function readNode(page) {
  const saved = page?.getFlag?.(MODULE_ID, "node") ?? page?.flags?.[MODULE_ID]?.node;
  if (!saved) return null;
  return { ...NODE_DEFAULTS, ...saved, profession: professionKey(saved.profession),
    tier: int(saved.tier, 1), dcModifier: int(saved.dcModifier), yieldModifier: int(saved.yieldModifier),
    minRank: int(saved.minRank), rareChance: int(saved.rareChance), senseRank: int(saved.senseRank),
    tools: Array.isArray(saved.tools) ? saved.tools : [],
    materialRules: saved.materialRules && typeof saved.materialRules === "object" ? saved.materialRules : {},
    hidden: saved.hidden === true };
}

/** Linked family ID, also supported on hand-made Gatherer pages without node overrides. */
export function linkGroupFor(page) {
  return readNode(page)?.linkGroup || page?.getFlag?.(MODULE_ID, "nodeLinkGroup") || page?.flags?.[MODULE_ID]?.nodeLinkGroup || "";
}

export function allNodePages() {
  return Array.from(globalThis.game?.journal ?? []).flatMap(entry => Array.from(entry.pages ?? []).filter(isGathererPage));
}

/* ---------------------------------------------------------------------- */
/* Tools, gates, and check adjustments                                     */
/* ---------------------------------------------------------------------- */

function itemsOf(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items.contents)) return items.contents;
  return typeof items[Symbol.iterator] === "function" ? Array.from(items) : [];
}

export function findTool(actor, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return itemsOf(actor).find(item => String(item.name ?? "").trim().toLowerCase() === wanted) ?? null;
}

/** Proficiency bonus the actor gets with a tool Item (0 if not proficient). */
export function toolProficiencyBonus(actor, item) {
  if (!item) return 0;
  const system = item.system ?? {};
  const prof = Number(actor?.system?.attributes?.prof) || 0;
  let multiplier = system.prof?.multiplier;
  if (!Number.isFinite(multiplier)) multiplier = Number.isFinite(Number(system.proficient)) && system.proficient !== null ? Number(system.proficient) : NaN;
  if (!Number.isFinite(multiplier)) multiplier = Number(actor?.system?.tools?.[system.type?.baseItem]?.value) || 0;
  return Math.floor(multiplier * prof);
}

/** Accepted tools on a node, including a pre-0.6.1 name-only tool. */
export function nodeTools(node) {
  if (!node) return [];
  const tools = Array.isArray(node.tools) ? [...node.tools] : [];
  if (node.toolName && !tools.some(tool => tool.name?.toLowerCase() === node.toolName.toLowerCase())) tools.push({ uuid: "", name: node.toolName, img: "" });
  return tools;
}

function liveName(tool) {
  if (!tool.uuid) return tool.name;
  try { return globalThis.fromUuidSync?.(tool.uuid)?.name || tool.name; }
  catch { return tool.name; }
}

/** True when an actor's Item is a copy of the tool (by source ID) or has its name. */
export function itemMatchesTool(item, tool) {
  if (!item || !tool) return false;
  if (tool.uuid) {
    const sources = [item.uuid, item._stats?.compendiumSource, item._stats?.duplicateSource, item.flags?.core?.sourceId, item.flags?.[MODULE_ID]?.toolSource];
    if (sources.includes(tool.uuid)) return true;
    const original = globalThis.fromUuidSync?.(tool.uuid);
    const defaultType = original?.flags?.[MODULE_ID]?.defaultTool;
    if (defaultType && item.flags?.[MODULE_ID]?.defaultTool === defaultType) return true;
  }
  const name = String(liveName(tool) ?? "").trim().toLowerCase();
  return Boolean(name) && String(item.name ?? "").trim().toLowerCase() === name;
}

/** A profession's default accepted tools (Gathering Tools settings). */
export function professionTools(profession) {
  const tools = PROFESSIONS[profession]?.tools;
  return Array.isArray(tools) ? tools.filter(tool => tool?.uuid || tool?.name) : [];
}

/**
 * Tools a gather needs: the node's own list when it has one (e.g. a vein that
 * only accepts a better pick), otherwise the profession's default tools.
 * The profession is the node's, else the hint (material or page profession).
 */
export function requiredTools(node, profession = null) {
  const own = nodeTools(node);
  if (own.length) return own;
  return professionTools(node?.profession || profession);
}

/** Every profession a Gatherer page can produce, including its explicit node profession. */
export function pageProfessions(page, node = readNode(page)) {
  const tableUuid = page?.flags?.gatherer?.table;
  let table = null;
  try { table = tableUuid ? globalThis.fromUuidSync?.(tableUuid) : null; } catch { table = null; }
  const professions = new Set(node?.profession ? [node.profession] : []);
  for (const result of Array.from(table?.results ?? [])) {
    if (Number(result.weight) <= 0) continue;
    let item = null;
    try { item = result.documentUuid ? globalThis.fromUuidSync?.(result.documentUuid) : null; } catch { item = null; }
    const rule = item ? materialRule(item) : null;
    if (rule) professions.add(rule.profession);
  }
  return [...professions];
}

/** First profession for display and compatibility with older API callers. */
export function pageProfession(page, node = readNode(page)) {
  return pageProfessions(page, node)[0] ?? null;
}

/** Carried Items that match one of the accepted tools (broken ones included). */
export function matchingTools(actor, node, profession = null) {
  const tools = requiredTools(node, profession);
  return tools.length ? itemsOf(actor).filter(item => tools.some(tool => itemMatchesTool(item, tool))) : [];
}

/** The carried, unbroken accepted tool with the highest proficiency bonus, or null. */
export function bestTool(actor, node, profession = null) {
  const tools = requiredTools(node, profession);
  if (!tools.length) return null;
  let best = null;
  for (const item of itemsOf(actor)) {
    if (!tools.some(tool => itemMatchesTool(item, tool)) || isBroken(item)) continue;
    const bonus = toolProficiencyBonus(actor, item);
    if (!best || bonus > best.bonus) best = { item, bonus };
  }
  return best;
}

export function toolNames(node, profession = null) {
  return requiredTools(node, profession).map(liveName).filter(Boolean);
}

/**
 * Checks that run before Gatherer uses a pull.
 * @returns {{ok: boolean, reason?: string}}
 */
export function nodeGate(actor, node, profession = null) {
  if (node?.minRank > 0 && node.profession && PROFESSIONS[node.profession]) {
    const rank = rankForActor(actor, node.profession);
    if (rank < node.minRank) {
      return { ok: false, reason: `${PROFESSIONS[node.profession].label} rank ${node.minRank} required to gather here (${actor?.name ?? "this character"} has ${rank || "none"}).` };
    }
  }
  // Every gather needs an accepted tool (node list, else the profession's defaults).
  if (requiredTools(node, profession).length && !bestTool(actor, node, profession)) {
    const broken = matchingTools(actor, node, profession);
    if (broken.length) return { ok: false, reason: `${broken.map(item => item.name).join(" and ")} ${broken.length > 1 ? "are" : "is"} broken. Have the GM repair it, or bring another tool.` };
    const names = toolNames(node, profession);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
    return { ok: false, reason: `You need ${list} to gather here.` };
  }
  return { ok: true };
}

/**
 * Apply a node's check override, tool bonus, and DC modifier to a check built
 * by checkFormula(). Without a node only the required tool is applied.
 */
export function applyNodeCheck(check, actor, node, profession = null) {
  node ??= {};
  let { ability, modifier } = check;
  let checkLabel = ABILITY_LABELS[ability] ?? ability;
  let skill = null;
  if (node.checkType === "ability" && node.checkKey) {
    ability = node.checkKey;
    modifier = Number(actor?.system?.abilities?.[ability]?.mod) || 0;
    checkLabel = ABILITY_LABELS[ability] ?? ability;
  } else if (node.checkType === "skill" && node.checkKey) {
    skill = node.checkKey;
    const data = actor?.system?.skills?.[skill];
    ability = data?.ability ?? globalThis.CONFIG?.DND5E?.skills?.[skill]?.ability ?? ability;
    // dnd5e's prepared skill total already includes ability, proficiency, and expertise.
    modifier = Number(data?.total ?? data?.mod) || Number(actor?.system?.abilities?.[data?.ability]?.mod) || 0;
    checkLabel = skillLabel(skill);
  }
  const best = bestTool(actor, node, profession);
  const tool = best?.item ?? null;
  // A skill already carries proficiency, so the tool bonus does not stack with it.
  const toolBonus = tool && !skill ? best.bonus : 0;
  const dcModifier = int(node.dcModifier);
  return {
    ...check, ability, modifier, checkLabel, skill,
    toolName: tool?.name ?? "", toolItem: tool, toolBonus, toolProficiency: best?.bonus ?? 0, dcModifier,
    target: check.target + dcModifier,
    formula: `1d20 + ${modifier}${toolBonus ? ` + ${toolBonus}` : ""}${check.trained ? ` + 1d${check.die}` : ""}`
  };
}

/* ---------------------------------------------------------------------- */
/* Depletion, pins, and visibility                                         */
/* ---------------------------------------------------------------------- */

export function nodeUsage(page) {
  const gatherer = page?.flags?.gatherer ?? {};
  const draws = parseInt(gatherer.draws) || 0;
  const used = Number(gatherer.data?.drawsUsed) || 0;
  return { draws, used, remaining: draws ? Math.max(0, draws - used) : null, time: parseFloat(gatherer.time) || 0, firstDrawTime: Number(gatherer.data?.firstDrawTime) || 0 };
}

export function isDepleted(page) {
  const { draws, used } = nodeUsage(page);
  return draws > 0 && used >= draws;
}

export function pinsFor(page) {
  const entryId = page?.parent?.id;
  return Array.from(globalThis.game?.scenes ?? []).flatMap(scene =>
    Array.from(scene.notes ?? []).filter(note => note.pageId === page.id && (!entryId || note.entryId === entryId))
      .map(note => ({ scene, note })));
}

/** Grey pins on depleted nodes, white otherwise. GM only. */
export async function refreshPinTint(page) {
  const tint = isDepleted(page) ? DEPLETED_TINT : ACTIVE_TINT;
  const byScene = new Map();
  for (const { scene, note } of pinsFor(page)) {
    const current = String(note.texture?.tint ?? ACTIVE_TINT).toLowerCase();
    if (current === tint) continue;
    if (!byScene.has(scene)) byScene.set(scene, []);
    byScene.get(scene).push({ _id: note.id, "texture.tint": tint });
  }
  for (const [scene, updates] of byScene) await scene.updateEmbeddedDocuments("Note", updates);
}

function ownedCharacters(user) {
  return Array.from(globalThis.game?.actors ?? []).filter(actor => actor.type === "character"
    && actor.testUserPermission?.(user, "OWNER"));
}

/**
 * Whether a character senses a hidden node: profession rank (plus sense perks)
 * at or above the node's sense rank, or a sense-everything perk.
 */
export function sensesNode(actor, node) {
  if (!node?.hidden || !(node.senseRank > 0)) return false;
  const perks = actorPerks(actor, node.profession || selectedProfession(actor));
  if (perks.senseAll) return true;
  if (!node.profession) return false;
  const rank = rankForActor(actor, node.profession);
  return rank > 0 && rank + perks.senseBonus >= node.senseRank;
}

/** Who should see a node page (and so its pins). */
export function nodeOwnership(node) {
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ownership = { default: node.hidden ? LEVELS.NONE : LEVELS.OBSERVER };
  for (const user of globalThis.game?.users ?? []) {
    if (user.isGM) continue;
    let sensed = false;
    if (node.hidden && node.senseRank > 0) sensed = ownedCharacters(user).some(actor => sensesNode(actor, node));
    ownership[user.id] = sensed ? LEVELS.OBSERVER : LEVELS.NONE;
  }
  if (!node.hidden) for (const key of Object.keys(ownership)) ownership[key] = LEVELS.OBSERVER;
  return ownership;
}

/** Reapply hidden/revealed/sensed ownership to node pages. GM only. */
export async function refreshNodeVisibility(pages = allNodePages()) {
  let changed = 0;
  for (const page of pages) {
    const node = readNode(page);
    if (!node) continue;
    const desired = nodeOwnership(node);
    const current = page.ownership ?? {};
    if (Object.entries(desired).every(([key, level]) => current[key] === level)) continue;
    await page.update({ ownership: desired });
    changed++;
  }
  return changed;
}

/** Reset nodes whose Gatherer timer ran out, so pins un-grey without a visit. GM only. */
export async function autoResetExpired(pages = allNodePages()) {
  const now = Number(globalThis.game?.time?.worldTime) || 0;
  let reset = 0;
  for (const page of pages) {
    const { time, used, firstDrawTime } = nodeUsage(page);
    if (!time || !used || now - firstDrawTime < time * 3600) continue;
    await page.setFlag("gatherer", "data", { drawsUsed: 0, firstDrawTime: now });
    reset++;
  }
  return reset;
}

export async function resetNodes(pages) {
  const now = Number(globalThis.game?.time?.worldTime) || 0;
  for (const page of pages) await page.setFlag("gatherer", "data", { drawsUsed: 0, firstDrawTime: now });
  return pages.length;
}

export async function setNodeHidden(pages, hidden) {
  for (const page of pages) {
    const node = readNode(page) ?? { ...NODE_DEFAULTS };
    await page.setFlag(MODULE_ID, "node", { ...node, hidden });
  }
  return refreshNodeVisibility(pages);
}

/* ---------------------------------------------------------------------- */
/* Builder                                                                 */
/* ---------------------------------------------------------------------- */

const OBSERVER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;

async function ensureFolder(type, name, key = type) {
  const existing = Array.from(game.folders ?? []).find(folder => folder.type === type && folder.getFlag?.(MODULE_ID, "nodeFolder") === key);
  if (existing) return existing;
  return Folder.implementation.create({ name, type, color: "#8a6a2f", flags: { [MODULE_ID]: { nodeFolder: key } } });
}

/** The "Nodes — <Scene>" journal for a scene id ("" = unplaced). */
export async function sceneJournal(sceneId) {
  const key = sceneId || "none";
  const existing = Array.from(game.journal ?? []).find(entry => entry.getFlag?.(MODULE_ID, "nodeJournal") === key);
  if (existing) return existing;
  const scene = sceneId ? game.scenes?.get(sceneId) : null;
  const folder = await ensureFolder("JournalEntry", "Gathering Nodes");
  return JournalEntry.implementation.create({
    name: `Nodes — ${scene?.name ?? "Unplaced"}`, folder: folder.id,
    ownership: { default: OBSERVER() }, flags: { [MODULE_ID]: { nodeJournal: key } }
  });
}

function cleanMaterials(materials) {
  const list = (materials ?? []).map(entry => ({ uuid: String(entry.uuid ?? ""), weight: Number(entry.weight) }))
    .filter(entry => entry.uuid && entry.weight > 0);
  for (const entry of list) {
    if (!Number.isInteger(entry.weight) || entry.weight > 1000) throw new Error("Material weights must be whole numbers from 1 to 1000.");
  }
  if (!list.length) throw new Error("Give at least one material a weight above 0.");
  return list;
}

async function tableResults(materials) {
  let low = 1;
  const results = [];
  for (const { uuid, weight } of materials) {
    const item = await fromUuid(uuid);
    if (!item) throw new Error(`Material not found: ${uuid}`);
    results.push({ type: "document", documentUuid: item.uuid, name: item.name, img: item.img, weight, range: [low, low + weight - 1], drawn: false });
    low += weight;
  }
  return { results, total: low - 1 };
}

/** Read material weights back from a builder-made table. */
export function tableMaterials(table) {
  return Array.from(table?.results ?? []).filter(result => result.documentUuid)
    .map(result => ({ uuid: result.documentUuid, weight: Number(result.weight) || 1 }));
}

function gathererFlags(data, tableUuid) {
  const draws = Number(data.draws ?? 0);
  const time = Number(data.time ?? 0);
  if (!Number.isInteger(draws) || draws < 0 || draws > 1000) throw new Error("Pulls must be a whole number from 0 to 1000 (0 = unlimited).");
  if (!Number.isFinite(time) || time < 0 || time > 100000) throw new Error("Reset hours must be 0 or more (0 = never).");
  return { table: tableUuid, draws: draws ? String(draws) : "", time: time ? String(time) : "", quantity: "1" };
}

/**
 * Create a node: RollTable + Gatherer page in the scene's node journal.
 * @param {object} data name, sceneId, materials [{uuid, weight}], draws, time, and node fields
 * @returns {Promise<JournalEntryPage>}
 */
export async function buildNode(data) {
  if (!game.user.isGM) throw new Error("Only the GM may build nodes.");
  const name = String(data.name ?? "").trim();
  if (!name) throw new Error("Name the node.");
  const materials = cleanMaterials(data.materials);
  const node = normalizeNode({ ...data, built: true });
  const flags = gathererFlags(data, "");
  const { results, total } = await tableResults(materials);
  const folder = await ensureFolder("RollTable", "Node Tables");
  const table = await RollTable.implementation.create({
    name: `${name} (Node)`, folder: folder.id, formula: `1d${total}`, replacement: true, displayRoll: false,
    ownership: { default: OBSERVER() }, flags: { [MODULE_ID]: { nodeTable: true } }, results
  });
  if (!node.icon) node.icon = results[0]?.img || "icons/svg/book.svg";
  node.tableUuid = table.uuid;
  const entry = await sceneJournal(data.sceneId ?? "");
  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
    name, type: GATHERER_PAGE_TYPE, ownership: nodeOwnership(node),
    flags: { gatherer: { ...flags, table: table.uuid }, [MODULE_ID]: { node } }
  }]);
  return page;
}

/** Edit a node. Builder-made tables are rewritten when materials are given. */
export async function updateNode(page, data) {
  if (!game.user.isGM) throw new Error("Only the GM may edit nodes.");
  const previous = readNode(page) ?? { ...NODE_DEFAULTS, built: false };
  const node = normalizeNode({ ...previous, ...data, built: previous.built, tableUuid: previous.tableUuid });
  let tableUuid = page.flags?.gatherer?.table ?? "";
  if (previous.built && data.materials) {
    const materials = cleanMaterials(data.materials);
    const table = await fromUuid(previous.tableUuid);
    const { results, total } = await tableResults(materials);
    if (table) {
      const ids = Array.from(table.results ?? []).map(result => result.id);
      if (ids.length) await table.deleteEmbeddedDocuments("TableResult", ids);
      await table.update({ formula: `1d${total}` });
      await table.createEmbeddedDocuments("TableResult", results);
      tableUuid = table.uuid;
    }
  }
  const name = String(data.name ?? page.name).trim() || page.name;
  await page.update({
    name,
    "flags.gatherer.draws": gathererFlags(data, tableUuid).draws,
    "flags.gatherer.time": gathererFlags(data, tableUuid).time,
    [`flags.${MODULE_ID}.node`]: node
  });
  for (const { scene, note } of pinsFor(page)) {
    await scene.updateEmbeddedDocuments("Note", [{ _id: note.id, text: name, "texture.src": node.icon || note.texture?.src }]);
  }
  await refreshNodeVisibility([page]);
  return page;
}

export async function duplicateNode(page) {
  if (!game.user.isGM) throw new Error("Only the GM may duplicate nodes.");
  const node = readNode(page);
  if (node?.built) {
    const table = await fromUuid(node.tableUuid);
    const sceneKey = page.parent?.getFlag?.(MODULE_ID, "nodeJournal");
    const usage = nodeUsage(page);
    return buildNode({ ...node, linkGroup: "", name: `${page.name} (copy)`, sceneId: sceneKey === "none" ? "" : sceneKey ?? "",
      materials: tableMaterials(table), draws: usage.draws, time: usage.time });
  }
  // Hand-made Gatherer page: copy it as-is, sharing its table.
  const data = page.toObject();
  delete data._id;
  data.name = `${page.name} (copy)`;
  if (data.flags?.gatherer) delete data.flags.gatherer.data;
  if (data.flags?.[MODULE_ID]?.node) data.flags[MODULE_ID].node.linkGroup = "";
  if (data.flags?.[MODULE_ID]) delete data.flags[MODULE_ID].nodeLinkGroup;
  const [copy] = await page.parent.createEmbeddedDocuments("JournalEntryPage", [data]);
  return copy;
}

/** Create a separate Gatherer page and pin that share the source's loot table. */
export async function placeLinkedNode(page, scene, x, y) {
  if (!game.user.isGM) throw new Error("Only the GM may place nodes.");
  if (!isGathererPage(page) || !scene || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Choose a valid node and map position.");
  const source = readNode(page);
  const tableUuid = page.flags?.gatherer?.table;
  if (!tableUuid || !await fromUuid(tableUuid)) throw new Error("This node needs a valid loot table before it can be linked.");
  const linkGroup = linkGroupFor(page) || page.uuid;
  const data = page.toObject();
  delete data._id;
  data.flags ??= {};
  data.flags.gatherer ??= {};
  delete data.flags.gatherer.data;
  data.flags[MODULE_ID] ??= {};
  delete data.flags[MODULE_ID].discovered;
  if (source) {
    data.flags[MODULE_ID].node = normalizeNode({ ...source, linkGroup });
    if (source.linkGroup !== linkGroup) await page.setFlag(MODULE_ID, "node", normalizeNode({ ...source, linkGroup }));
  } else {
    data.flags[MODULE_ID].nodeLinkGroup = linkGroup;
    if (linkGroupFor(page) !== linkGroup) await page.setFlag(MODULE_ID, "nodeLinkGroup", linkGroup);
  }
  const [copy] = await page.parent.createEmbeddedDocuments("JournalEntryPage", [data]);
  try {
    await placePin(copy, scene, x, y);
  } catch (error) {
    await copy.delete();
    throw error;
  }
  return copy;
}

export async function deleteNode(page) {
  if (!game.user.isGM) throw new Error("Only the GM may delete nodes.");
  const node = readNode(page);
  for (const { scene, note } of pinsFor(page)) await scene.deleteEmbeddedDocuments("Note", [note.id]);
  await page.delete();
  if (node?.built && node.tableUuid && !allNodePages().some(other => other.flags?.gatherer?.table === node.tableUuid)) {
    const table = await fromUuid(node.tableUuid);
    if (table?.getFlag?.(MODULE_ID, "nodeTable")) await table.delete();
  }
}

/** Drop a pin for a node at scene coordinates. */
export async function placePin(page, scene, x, y) {
  if (!game.user.isGM) throw new Error("Only the GM may place node pins.");
  const node = readNode(page) ?? NODE_DEFAULTS;
  const [note] = await scene.createEmbeddedDocuments("Note", [{
    entryId: page.parent.id, pageId: page.id, x: Math.round(x), y: Math.round(y),
    texture: { src: node.icon || "icons/svg/book.svg", tint: isDepleted(page) ? DEPLETED_TINT : ACTIVE_TINT },
    iconSize: 48, text: page.name, global: true,
    flags: { [MODULE_ID]: { nodePin: true } }
  }]);
  return note;
}

/* ---------------------------------------------------------------------- */
/* Tool library and rare tables                                            */
/* ---------------------------------------------------------------------- */

export function getToolLibrary() {
  let saved = [];
  try { saved = globalThis.game?.settings?.get(MODULE_ID, "toolLibrary") ?? []; } catch { saved = []; }
  try { return normalizeTools(saved).filter(tool => tool.uuid); } catch { return []; }
}

/** Add an Item (by uuid) to the world tool library. Returns the entry. GM only. */
export async function addToolToLibrary(uuid) {
  if (!game.user.isGM) throw new Error("Only the GM may edit the tool library.");
  const item = await fromUuid(uuid);
  if (!item || item.documentName !== "Item") throw new Error("Drop an Item to add a tool.");
  const entry = { uuid: item.uuid, name: item.name, img: item.img ?? "" };
  const library = getToolLibrary().filter(tool => tool.uuid !== entry.uuid);
  library.push(entry);
  library.sort((a, b) => a.name.localeCompare(b.name));
  await game.settings.set(MODULE_ID, "toolLibrary", library);
  return entry;
}

/** Remove a tool from the library. Nodes that accept it keep their copy. */
export async function removeToolFromLibrary(uuid) {
  if (!game.user.isGM) throw new Error("Only the GM may edit the tool library.");
  await game.settings.set(MODULE_ID, "toolLibrary", getToolLibrary().filter(tool => tool.uuid !== uuid));
}

/** Create a rare-find table from [{uuid, weight}] in the "Rare Find Tables" folder. */
export async function createRareTable(name, entries) {
  if (!game.user.isGM) throw new Error("Only the GM may create tables.");
  const title = String(name ?? "").trim();
  if (!title) throw new Error("Name the rare-find table.");
  const materials = cleanMaterials(entries);
  const { results, total } = await tableResults(materials);
  const folder = await ensureFolder("RollTable", "Rare Find Tables", "rareTables");
  return RollTable.implementation.create({
    name: title, folder: folder.id, formula: `1d${total}`, replacement: true, displayRoll: false,
    ownership: { default: OBSERVER() }, flags: { [MODULE_ID]: { rareTable: true } }, results
  });
}
