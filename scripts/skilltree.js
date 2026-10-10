// The universal gathering Skill Tree: 30 spoke skills (plus 14 extras) that serve every profession,
// laid out as a hexagon. The six themes are six spokes; the tier 1 skills form
// the inner ring (the starting choices) and each spoke grows outward to its
// capstone. Tier 3 skills bridge to the neighbouring spokes, so players can
// cross themes. Skill points and prior purchases open later nodes.
// Capstones (tier 5) cost 2 points and lock each other out: one per character.
// 0.31.0 adds 14 skills off the spokes (EXTRA_SKILLS): an inner ring of
// "middle pieces" between neighbouring tier 1 skills, an outer ring between
// neighbouring tier 3 skills, and tier 4 choices that sit beside a spoke skill
// and lock it out (either one opens the capstone). Two outer pairs are also
// either/or choices.
import { MODULE_ID } from "./rules.js";
import { SKILL_TREE_ID } from "./integrations.js";

export const TREE_NAME = "Gathering Skill Tree";
export const CAPSTONE_POINTS = 2;
// Layout version stored on the tree; older trees are moved on load.
export const LAYOUT_VERSION = 9;
// Fixed group id so module.css can restyle this tree only (no group box).
export const GROUP_ID = "gatheringProfessions";
export const GRID_SIZE = 25;
const CENTER = (GRID_SIZE - 1) / 2;
// Spoke direction per theme on the grid: up, upper-right, lower-right, down,
// lower-left, upper-left. (2, ±1) steps are close to true 60° hexagon spokes.
const SPOKES = Object.freeze([[0, -2], [2, -1], [2, 1], [0, 2], [-2, 1], [-2, -1]]);
// The tier (row index) whose skills also open from the neighbouring spokes.
export const BRIDGE_ROW = 2;

export const THEMES = Object.freeze([
  { key: "bounty", label: "Bounty", color: "#d4a84a" },
  { key: "fortune", label: "Fortune", color: "#9b6bd6" },
  { key: "technique", label: "Technique", color: "#c0563e" },
  { key: "craft", label: "Craft", color: "#6f8fb0" },
  { key: "wayfinding", label: "Wayfinding", color: "#4f9a58" },
  { key: "fellowship", label: "Fellowship", color: "#3e9c9c" }
]);

const skill = (key, name, col, row, img, text, perk) => Object.freeze({ key, name, col, row, img: `icons/${img}`, text, perk: Object.freeze(perk) });

export const SPOKE_SKILLS = Object.freeze([
  // Bounty: more material per gather.
  skill("steadyHands", "Steady Hands", 0, 0, "containers/bags/sack-leather-brown.webp", "+1 yield on Successful, Excellent, and Masterful extractions.", { yieldBonus: 1 }),
  skill("lightTouch", "Light Touch", 0, 1, "magic/nature/leaf-hand-green.webp", "15% chance a gather does not use a node pull.", { conserveChance: 15 }),
  skill("bountiful", "Bountiful", 0, 2, "commodities/currency/coins-assorted-mix-copper-silver-gold.webp", "Excellent and Masterful extractions draw one extra result from the node.", { extraDraws: 1 }),
  skill("abundance", "Abundance", 0, 3, "magic/nature/tree-spirit-green.webp", "+2 yield on Successful, Excellent, and Masterful extractions.", { yieldBonus: 2 }),
  skill("masterHarvester", "Master Harvester", 0, 4, "tools/hand/sickle-steel-grey.webp", "Capstone. Excellent and Masterful extractions draw one more extra result, and +1 yield on full successes.", { extraDraws: 1, yieldBonus: 1 }),
  // Fortune: rare finds.
  skill("keenEye", "Keen Eye", 1, 0, "magic/perception/eye-ringed-green.webp", "+3% rare-find chance.", { rareChance: 3 }),
  skill("discerningEye", "Discerning Eye", 1, 1, "commodities/gems/gem-faceted-round-white.webp", "After a rare find climbs to a higher tier, each fresh climb d20 climbs again on 19–20 instead of only 20.", { climbExpand: 1 }),
  skill("treasureHunter", "Treasure Hunter", 1, 2, "skills/trades/gaming-gambling-dice-gray.webp", "+6% rare-find chance.", { rareChance: 6 }),
  skill("richFind", "Rich Find", 1, 3, "commodities/gems/gem-rough-cushion-purple.webp", "A rare find draws one extra time from the rare-find table.", { rareDraws: 1 }),
  skill("fortunesFavour", "Fortune's Favour", 1, 4, "magic/control/buff-luck-fortune-green.webp", "Capstone. +5% rare-find chance, and fresh climb d20s roll twice, keeping the better.", { rareChance: 5, climbAdvantage: true }),
  // Technique: better checks.
  skill("proficientGatherer", "Proficient Gatherer", 2, 0, "tools/hand/pickaxe-steel-white.webp", "+1 to gathering checks.", { checkBonus: 1 }),
  skill("secondLook", "Second Look", 2, 1, "magic/time/hourglass-tilted-gray.webp", "Once per long rest, when a gather fails you may reroll the check. You are asked each time; if you decline, the reroll stays available for a later failure.", { rerolls: 1 }),
  skill("practicedTechnique", "Practiced Technique", 2, 2, "skills/melee/hand-grip-staff-blue.webp", "Gathering DCs are 2 lower for you.", { dcReduction: 2 }),
  skill("expertTechnique", "Expert Technique", 2, 3, "magic/earth/strike-fist-stone-gray.webp", "Add 1d4 to gathering checks.", { checkDie: 4 }),
  skill("grandmastersTouch", "Grandmaster's Touch", 2, 4, "magic/symbols/star-yellow.webp", "Capstone. Once per long rest, choose before gathering to make it a Masterful extraction automatically (no check roll). It always earns a rare find on the material's tier, and you roll the Fortune die (d20) to see whether it climbs higher.", { masterfulUses: 1 }),
  // Craft: tools and versatility.
  skill("toolwise", "Toolwise", 3, 0, "tools/hand/hammer-and-nail.webp", "+1 to checks when you gather with an accepted tool.", { toolBonus: 1 }),
  skill("jackOfAllTrades", "Jack of All Trades", 3, 1, "skills/trades/construction-carpentry-hammer.webp", "Untrained DC penalties are halved for you.", { untrainedRelief: 0.5 }),
  skill("masterworkHandling", "Masterwork Handling", 3, 2, "skills/trades/smithing-anvil-silver-red.webp", "Tool bonuses also apply on nodes that use a skill check.", { toolWithSkill: true }),
  skill("weatherproof", "Weatherproof", 3, 3, "magic/holy/barrier-shield-winged-blue.webp", "Ignore DC increases from season, weather, and time of day.", { ignoreConditionDc: true }),
  skill("masterArtisan", "Master Artisan", 3, 4, "tools/smithing/anvil.webp", "Capstone. Your tool proficiency bonus is doubled, and you ignore untrained DC penalties.", { toolDouble: true, untrainedRelief: 1 }),
  // Wayfinding: discovery and conditions.
  skill("trailSense", "Trail Sense", 4, 0, "magic/movement/trail-streak-zigzag-yellow.webp", "Sense hidden nodes as if your rank were 1 higher.", { senseBonus: 1 }),
  skill("readerOfSeasons", "Reader of Seasons", 4, 1, "magic/time/clock-stopwatch-white-blue.webp", "'Scarce now' penalties are halved for you. Materials at ×0 stay unavailable.", { scarcityRelief: 0.5 }),
  skill("pathfinder", "Pathfinder", 4, 2, "tools/navigation/map-chart-tan.webp", "The gathering window shows you current drop odds and the chance to find nothing.", { seeOdds: true }),
  skill("deepSense", "Deep Sense", 4, 3, "magic/perception/third-eye-blue-red.webp", "Sense hidden nodes as if your rank were 1 higher (stacks with Trail Sense).", { senseBonus: 1 }),
  skill("wayfarer", "Wayfarer", 4, 4, "tools/navigation/compass-brass-blue-red.webp", "Capstone. Ignore 'Scarce now' penalties, and sense every hidden node that can be sensed.", { scarcityRelief: 1, senseAll: true }),
  // Fellowship: helping the party.
  skill("fieldHand", "Field Hand", 5, 0, "skills/social/diplomacy-handshake-yellow.webp", "Assist from the gathering window: an ally's next gather at that node gets +2.", { assistBonus: 2 }),
  skill("reliablePartner", "Reliable Partner", 5, 1, "skills/social/peace-luck-insult.webp", "Your Assist gives +2 more (+4 total with Field Hand).", { assistBonus: 2 }),
  skill("conservationist", "Conservationist", 5, 2, "magic/nature/root-vine-entwined-thorns.webp", "+15% chance a gather does not use a node pull.", { conserveChance: 15 }),
  skill("mentor", "Mentor", 5, 3, "skills/trades/academics-investigation-puzzles.webp", "Your Assist adds 1d4 to the ally's check and halves their untrained penalties.", { assistDie: 4, assistUntrainedRelief: 0.5 }),
  skill("stewardOfTheWilds", "Steward of the Wilds", 5, 4, "magic/nature/leaf-glow-green.webp", "Capstone. +20% chance a gather does not use a node pull.", { conserveChance: 20 })
]);

const theme = key => THEMES.findIndex(entry => entry.key === key);
/**
 * A skill off the spokes, at a fixed grid cell.
 * kind: "middle" (opens from any skill in `requires`) or "choice" (beside a
 * spoke skill, locks it out, and also opens the next skill on that spoke).
 */
const extra = (key, name, themeKey, cell, img, text, perk, { requires, opens = [], lockout = [], kind = "middle" }) => Object.freeze({
  key, name, col: theme(themeKey), row: null, cell: Object.freeze(cell), img: `icons/${img}`, text, perk: Object.freeze(perk),
  requires: Object.freeze(requires), opens: Object.freeze(opens), lockout: Object.freeze(lockout), kind, extra: true
});

export const EXTRA_SKILLS = Object.freeze([
  // Inner ring: between neighbouring tier 1 skills.
  extra("luckyStrike", "Lucky Strike", "fortune", [14, 9], "magic/control/buff-luck-fortune-rainbow.webp",
    "A natural 20 on a gathering check does not use a node pull.", { naturalRefund: true }, { requires: ["steadyHands", "keenEye"] }),
  extra("momentum", "Momentum", "technique", [15, 12], "skills/movement/arrow-upward-yellow.webp",
    "After an Excellent or Masterful gather, +1 to your next gathering check within the hour.", { momentumBonus: 1 }, { requires: ["keenEye", "proficientGatherer"] }),
  extra("toolSteward", "Tool Steward", "craft", [14, 15], "tools/hand/wrench-steel.webp",
    "The first natural 1 each long rest does not wear your tool.", { toolSteward: 1 }, { requires: ["proficientGatherer", "toolwise"] }),
  extra("fieldRepair", "Field Repair", "craft", [10, 15], "tools/smithing/tongs-steel-grey.webp",
    "Once per long rest, restore 1d4 durability to one of your gathering tools (even a broken one) from the gathering window.", { fieldRepairs: 1 }, { requires: ["toolwise", "trailSense"] }),
  extra("timekeeper", "Timekeeper", "wayfinding", [9, 12], "magic/time/hourglass-yellow-green.webp",
    "Nodes you exhaust refill 25% sooner.", { refillCut: 25 }, { requires: ["trailSense", "fieldHand"] }),
  extra("deepReserves", "Deep Reserves", "bounty", [10, 9], "magic/life/heart-cross-strong-flame-green.webp",
    "+1 free gathering attempt per long rest.", { extraAttempts: 1 }, { requires: ["fieldHand", "steadyHands"], lockout: ["secondWind"] }),
  // Outer ring: between neighbouring tier 3 skills.
  extra("secondWind", "Second Wind", "technique", [16, 5], "skills/movement/feet-winged-boots-brown.webp",
    "Once per long rest, a gather beyond your free attempts adds no exhaustion.", { secondWind: 1 }, { requires: ["bountiful", "treasureHunter"], lockout: ["deepReserves"] }),
  extra("efficientRefiner", "Efficient Refiner", "craft", [17, 20], "tools/smithing/crucible.webp",
    "Refining 4 or more units at once: every 4 units use one fewer of the recipe's first ingredient (on a success).", { refineSaver: true }, { requires: ["practicedTechnique", "masterworkHandling"], lockout: ["fieldProcessing"] }),
  extra("fieldProcessing", "Field Processing", "craft", [7, 20], "environment/wilderness/camp-improvised.webp",
    "Refining takes 25% less time (when refining takes world time).", { refineTimeCut: 25 }, { requires: ["masterworkHandling", "pathfinder"], lockout: ["efficientRefiner"] }),
  extra("familiarGround", "Familiar Ground", "wayfinding", [3, 12], "environment/wilderness/terrain-forest-gray.webp",
    "Choose one biome in the gathering window: gathering DCs there are 2 lower for you. Only the GM can change it afterwards.", { familiarDc: 2 }, { requires: ["pathfinder", "conservationist"] }),
  extra("sharedHaul", "Shared Haul", "fellowship", [8, 5], "containers/bags/coinpouch-simple-leather-tan.webp",
    "When an ally you Assist gets an Excellent or Masterful extraction, you also get 1 of that material.", { sharedHaul: 1 }, { requires: ["conservationist", "bountiful"] }),
  // Tier 4 choices: beside a spoke skill, which they lock out.
  extra("carefulSelection", "Careful Selection", "bounty", [10, 2], "tools/scribal/magnifying-glass.webp",
    "Once per long rest, draw two results from the node and choose which one you gather.", { carefulUses: 1 }, { requires: ["bountiful"], opens: ["masterHarvester"], lockout: ["abundance"], kind: "choice" }),
  extra("appraisersEye", "Appraiser's Eye", "fortune", [23, 9], "commodities/gems/gem-cut-faceted-princess-purple.webp",
    "Once per long rest, after a rare find, reroll it on the same table and keep whichever result you prefer.", { appraiseUses: 1 }, { requires: ["treasureHunter"], opens: ["fortunesFavour"], lockout: ["richFind"], kind: "choice" }),
  extra("lastPull", "Last Pull", "wayfinding", [3, 19], "magic/nature/root-vines-grow-brown.webp",
    "Once per long rest, gather once from an exhausted node.", { lastPulls: 1 }, { requires: ["pathfinder"], opens: ["wayfarer"], lockout: ["deepSense"], kind: "choice" })
]);

/** Every universal skill: the 30 spoke skills, then the extras. */
export const UNIVERSAL_SKILLS = Object.freeze([...SPOKE_SKILLS, ...EXTRA_SKILLS]);

export const TIERS = 5;
export const isCapstone = entry => !entry.extra && entry.row === TIERS - 1;

/** Grid cell for a skill: spoke = theme (col), distance from centre = tier (row); extras have their own cell. */
export function gridPosition(entry) {
  if (entry.cell) return { col: entry.cell[0], row: entry.cell[1] };
  const [dx, dy] = SPOKES[entry.col];
  const reach = entry.row + 2;
  return { row: CENTER + dy * reach, col: CENTER + dx * reach };
}

/** Spokes next to this one around the hexagon. */
export function neighbourSpokes(col) {
  const count = THEMES.length;
  return [(col + count - 1) % count, (col + 1) % count];
}

/**
 * Skills that unlock this one: the previous tier on the same spoke. Cross-spoke
 * links between tiers 2 and 3 can be traversed in either direction.
 */
export function prerequisites(entry, skills = UNIVERSAL_SKILLS) {
  if (entry.extra) return skills.filter(other => entry.requires.includes(other.key));
  // Tier 4 choices also open the next skill on their spoke.
  const choices = skills.filter(other => other.extra && other.opens.includes(entry.key));
  if (entry.row === 0) return choices;
  const spokes = entry.row === BRIDGE_ROW ? [entry.col, ...neighbourSpokes(entry.col)] : [entry.col];
  return [...skills.filter(other => !other.extra && (
    (other.row === entry.row - 1 && spokes.includes(other.col)) ||
    (entry.row === BRIDGE_ROW - 1 && other.row === BRIDGE_ROW && neighbourSpokes(entry.col).includes(other.col)))), ...choices];
}

/** Skills that taking this one locks out: the other capstones, and either/or partners. */
export function lockouts(entry, skills = UNIVERSAL_SKILLS) {
  const capstones = isCapstone(entry) ? skills.filter(other => isCapstone(other) && other !== entry) : [];
  const partners = skills.filter(other => other !== entry && ((entry.lockout ?? []).includes(other.key) || (other.lockout ?? []).includes(entry.key)));
  return [...capstones, ...partners];
}

const nameOf = key => UNIVERSAL_SKILLS.find(other => other.key === key)?.name ?? key;
const orList = keys => keys.map(nameOf).join(" or ");

function skillText(entry) {
  const theme = THEMES[entry.col];
  const cost = isCapstone(entry) ? `${CAPSTONE_POINTS} points. Only one capstone per character.` : "1 point.";
  if (entry.extra) {
    const partners = lockouts(entry).map(other => other.name);
    const where = entry.kind === "choice" ? ` Opens from ${orList(entry.requires)}, and also opens ${orList(entry.opens)}.` : ` Middle piece: opens from ${orList(entry.requires)}.`;
    const choice = partners.length ? ` Choose one: taking it locks out ${partners.join(" and ")}.` : "";
    return `<p>${entry.text}</p><p><em>${theme.label} · ${cost}${where}${choice}</em></p>`;
  }
  const bridge = entry.row === BRIDGE_ROW || entry.row === BRIDGE_ROW - 1
    ? " Cross-theme links open in either direction." : "";
  const partners = lockouts(entry).filter(other => other.extra).map(other => other.name);
  const choice = partners.length ? ` Choose one: taking it locks out ${partners.join(" and ")}.` : "";
  return `<p>${entry.text}</p><p><em>${theme.label} · ${cost}${bridge}${choice}</em></p>`;
}

/** Per-skill Skill Tree flags that depend on the layout. */
function skillFlags(entry) {
  const { row, col } = gridPosition(entry);
  return {
    points: isCapstone(entry) ? CAPSTONE_POINTS : 1, color: THEMES[entry.col].color,
    requirements: [],
    row, col, groupId: GROUP_ID
  };
}

function treeFlags() {
  return {
    isSkillTree: true, linkedSkillRule: "some", multipleItemsRule: "all", skillStyle: "circle",
    // Its own point pool, so points from other trees never mix in.
    independentSkillPoints: true,
    groups: [{ id: GROUP_ID, name: "", hideTotal: true, color: "#d4a84a", sound: "", image: "", blurBackground: false, minRows: GRID_SIZE, minCols: GRID_SIZE }]
  };
}

/** Set links and capstone lockouts (and any extra page changes) by skill key. */
async function linkPages(tree, pageByKey, extra = () => ({})) {
  const uuids = list => list.filter(other => pageByKey.has(other.key)).map(other => pageByKey.get(other.key).uuid);
  await tree.updateEmbeddedDocuments("JournalEntryPage", UNIVERSAL_SKILLS.filter(entry => pageByKey.has(entry.key)).map(entry => ({
    _id: pageByKey.get(entry.key).id,
    [`flags.${SKILL_TREE_ID}.connectedSkills`]: uuids(prerequisites(entry)),
    [`flags.${SKILL_TREE_ID}.lockoutSkills`]: uuids(lockouts(entry)),
    ...extra(entry)
  })));
}

/** Item data for a universal skill's perk Item. */
function skillItemData(entry, { folder = null, ownership, extraFlags = {} }) {
  return {
    name: entry.name, type: "feat", img: entry.img, folder, ownership,
    system: { description: { value: `<p>${entry.text}</p>` } },
    flags: foundry.utils.mergeObject({ [MODULE_ID]: { perk: { enabled: true, profession: "any", ...entry.perk }, universalSkill: entry.key } }, extraFlags, { inplace: false })
  };
}

/** Journal page data for a universal skill (links are set afterwards). */
function skillPageData(entry, item, extraFlags = {}) {
  return {
    name: entry.name, type: "text", src: entry.img, text: { content: skillText(entry), format: 1 },
    flags: foundry.utils.mergeObject({
      [SKILL_TREE_ID]: {
        linkedSkillRule: 0, mutualExclusion: 0, allowIncompleteProgression: 0, minimumPointsInGroup: 0,
        itemUuids: [item.uuid], connectedSkills: [], lockoutSkills: [], conditionScript: "",
        onUnlockScript: "", skillStyle: "default", sound: "", ...skillFlags(entry)
      },
      [MODULE_ID]: { universalSkill: entry.key }
    }, extraFlags, { inplace: false })
  };
}

const keyOf = document => document.getFlag?.(MODULE_ID, "universalSkill") ?? document.flags?.[MODULE_ID]?.universalSkill;

/**
 * Add skills a tree is missing (e.g. the 0.31.0 extras on an older tree): new
 * perk Items next to the existing ones, and new pages. Existing pages keep
 * their UUIDs, so unlocked skills stay unlocked.
 * @returns {Promise<number>} skills added
 */
async function addMissingSkills(tree, pageByKey) {
  const missing = UNIVERSAL_SKILLS.filter(entry => !pageByKey.has(entry.key));
  if (!missing.length) return 0;
  const existingItem = Array.from(globalThis.game?.items ?? []).find(item => item.getFlag?.(MODULE_ID, "universalSkill"));
  const ownership = existingItem?.ownership ? foundry.utils.deepClone(existingItem.ownership) : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const itemByKey = new Map(Array.from(globalThis.game?.items ?? []).filter(item => keyOf(item)).map(item => [keyOf(item), item]));
  const toCreate = missing.filter(entry => !itemByKey.has(entry.key));
  if (toCreate.length) {
    const created = await Item.implementation.create(toCreate.map(entry => skillItemData(entry, { folder: existingItem?.folder?.id ?? null, ownership })));
    for (const item of created) itemByKey.set(keyOf(item), item);
  }
  const pages = await tree.createEmbeddedDocuments("JournalEntryPage", missing.map(entry => skillPageData(entry, itemByKey.get(entry.key))));
  for (const page of pages) pageByKey.set(keyOf(page), page);
  return missing.length;
}

/** True when a universal tree was built with an older layout. */
export function needsRelayout(tree) {
  const pages = Array.from(tree?.pages ?? []);
  if (!pages.some(page => page.getFlag?.(MODULE_ID, "universalSkill"))) return false;
  return (Number(tree.getFlag?.(MODULE_ID, "layoutVersion")) || 1) < LAYOUT_VERSION;
}

/**
 * Update an existing universal tree: positions, links, descriptions,
 * requirements, group, and its own point pool. Page UUIDs stay the same, so
 * skills characters already unlocked stay unlocked.
 */
export async function relayoutUniversalTree(tree) {
  const pageByKey = new Map(Array.from(tree.pages ?? [])
    .map(page => [page.getFlag?.(MODULE_ID, "universalSkill"), page]).filter(([key]) => key));
  if (!pageByKey.size) throw new Error(`${tree.name} is not a universal gathering tree.`);
  await tree.update({ [`flags.${SKILL_TREE_ID}`]: treeFlags(), [`flags.${MODULE_ID}.layoutVersion`]: LAYOUT_VERSION });
  await addMissingSkills(tree, pageByKey);
  // Re-link each page to the world skill Item with the same key (trees built
  // before 0.15.0 could be linked out of order).
  const itemByKey = new Map(Array.from(globalThis.game?.items ?? [])
    .filter(item => item.getFlag?.(MODULE_ID, "universalSkill")).map(item => [item.getFlag(MODULE_ID, "universalSkill"), item]));
  await linkPages(tree, pageByKey, entry => ({
    ...Object.fromEntries(Object.entries(skillFlags(entry))
      .map(([key, value]) => [`flags.${SKILL_TREE_ID}.${key}`, value])),
    ...(itemByKey.has(entry.key) ? { [`flags.${SKILL_TREE_ID}.itemUuids`]: [itemByKey.get(entry.key).uuid] } : {}),
    "text.content": skillText(entry)
  }));
  await syncSkillItems();
  return tree;
}

/** The perk and description a universal skill Item should carry now. */
export function skillItemChanges(entry) {
  return { [`flags.${MODULE_ID}.perk`]: { enabled: true, profession: "any", ...entry.perk }, "system.description.value": `<p>${entry.text}</p>` };
}

/**
 * Rewrite universal skill Items (world Items and copies on characters) whose
 * perk no longer matches the skill definition, e.g. after a skill rebalance.
 * The perk flag is replaced, not merged, so retired effects are dropped.
 * @returns {Promise<number>} Items updated
 */
export async function syncSkillItems() {
  const byKey = new Map(UNIVERSAL_SKILLS.map(entry => [entry.key, entry]));
  const stale = item => {
    const entry = byKey.get(item.getFlag?.(MODULE_ID, "universalSkill"));
    if (!entry) return null;
    const perk = item.getFlag(MODULE_ID, "perk") ?? {};
    const wanted = { enabled: true, profession: "any", ...entry.perk };
    const same = Object.keys({ ...perk, ...wanted }).every(key => (perk[key] ?? 0) === (wanted[key] ?? 0) || (!perk[key] && !wanted[key]));
    const description = item.system?.description?.value;
    const sameText = description === undefined || description === `<p>${entry.text}</p>`;
    return same && sameText ? null : entry;
  };
  let updated = 0;
  const fix = async (collection, updateMany) => {
    const changes = [];
    for (const item of collection ?? []) {
      const entry = stale(item);
      if (!entry) continue;
      // Clear first so effects the skill no longer has do not survive a merge.
      changes.push({ _id: item.id, [`flags.${MODULE_ID}.-=perk`]: null });
      changes.push({ _id: item.id, ...skillItemChanges(entry) });
    }
    if (!changes.length) return;
    const clears = changes.filter((_, index) => index % 2 === 0);
    const sets = changes.filter((_, index) => index % 2 === 1);
    await updateMany(clears);
    await updateMany(sets);
    updated += sets.length;
  };
  await fix(globalThis.game?.items, list => Item.implementation.updateDocuments(list));
  for (const actor of globalThis.game?.actors ?? []) {
    await fix(actor.items, list => actor.updateEmbeddedDocuments("Item", list));
  }
  return updated;
}

/**
 * Create the perk Items and the Skill Tree journal.
 * @param {{itemFolder?: string, journalFolder?: string, extraFlags?: object, ownership?: object}} options
 * @returns {Promise<{tree: JournalEntry, items: Item[]}>}
 */
export async function buildUniversalTree({ itemFolder = null, journalFolder = null, extraFlags = {}, ownership = null, name = TREE_NAME } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM may build the skill tree.");
  // Players open the tree and the Skill Tree module copies perk Items onto
  // their actors, so both need at least Observer.
  ownership ??= { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const items = await Item.implementation.create(UNIVERSAL_SKILLS.map(entry => skillItemData(entry, { folder: itemFolder, ownership, extraFlags })));
  // Match by flag: Foundry may return created documents in a different order.
  const itemByKey = new Map(items.map(item => [keyOf(item), item]));
  const tree = await JournalEntry.implementation.create({
    name, folder: journalFolder, ownership,
    flags: foundry.utils.mergeObject({ [SKILL_TREE_ID]: treeFlags(), [MODULE_ID]: { layoutVersion: LAYOUT_VERSION } }, extraFlags, { inplace: false })
  });
  const pages = await tree.createEmbeddedDocuments("JournalEntryPage", UNIVERSAL_SKILLS.map(entry => skillPageData(entry, itemByKey.get(entry.key), extraFlags)));
  // Links need the page UUIDs, so they are set after creation.
  await linkPages(tree, new Map(pages.map(page => [keyOf(page), page])));
  return { tree, items };
}
