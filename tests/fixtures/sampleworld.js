// Automated-test scaffolding only (never loaded by the module): builds a small
// sample world in the in-memory document doubles used by tests/world.mjs.
// Contents: materials, rare tables, Gatherer nodes, the
// universal gathering Skill Tree (with its perk Items), and a test character. Every created document carries
// flags.gathering-professions.sampleWorld so the sample world can be removed cleanly.
import { MODULE_ID, PROFESSIONS } from "../../scripts/rules.js";
import { SKILL_TREE_ID, skillTreeConfig } from "../../scripts/integrations.js";
import { buildUniversalTree, TREE_NAME } from "../../scripts/skilltree.js";
import { NODE_DEFAULTS, nodeOwnership, placePin, pinsFor } from "../../scripts/nodes.js";

const SAMPLE_FLAG = { [MODULE_ID]: { sampleWorld: true } };
const SAMPLE_NAME = "Gathering Sample World";

function isSample(document) {
  return document?.getFlag?.(MODULE_ID, "sampleWorld") === true;
}

function observer() {
  return { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
}

/** True when any test-kit document exists in the world. */
export function sampleWorldExists() {
  return [game.items, game.tables, game.journal, game.actors, game.folders]
    .some(collection => Array.from(collection ?? []).some(isSample));
}

function loot(name, img, description, folder, extraFlags = {}) {
  return {
    name, img, type: "loot", folder, ownership: observer(),
    system: { quantity: 1, description: { value: `<p>${description}</p>` } },
    flags: foundry.utils.mergeObject(foundry.utils.deepClone(SAMPLE_FLAG), extraFlags)
  };
}

function tableResults(entries) {
  let low = 1;
  return entries.map(({ item, weight }) => {
    const range = [low, low + weight - 1];
    low += weight;
    return { type: "document", documentUuid: item.uuid, name: item.name, img: item.img, weight, range, drawn: false };
  });
}

async function makeTable(name, entries, folder) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return RollTable.implementation.create({
    name, folder, formula: `1d${total}`, replacement: true, displayRoll: false,
    ownership: observer(), flags: foundry.utils.deepClone(SAMPLE_FLAG),
    results: tableResults(entries)
  });
}

const GUIDE = `<h2>How to test Gathering Professions</h2>
<ol>
<li>Open the <strong>Test Gatherer</strong> character. It has Mining selected and 95 Mining XP (Rank 1). Strength and Wisdom are 14.</li>
<li>Select its token on a scene (or assign it to your user), then open this journal's <strong>Copper Vein</strong> page and click <strong>Gather</strong>.</li>
<li>Read the profession chat card: d20 + Strength + d4 against the material DC, margin, extraction result, and yield.</li>
<li>One success gives 5 XP and reaches 100 XP: Rank 2. A notification shows the Skill Tree points gained (2 per rank; the character starts with 2).</li>
<li>Open the character sheet header <strong>Skill Tree</strong> button (Gathering Skill Tree). It is one tree for every profession: six themed spokes (Bounty, Fortune, Technique, Craft, Wayfinding, Fellowship) and five tiers. Skills need points and a connected skill, with no profession-rank gate. Cross-theme links between tiers 2 and 3 open in either direction.</li>
<li>Try <strong>Steady Hands</strong> (+1 yield), <strong>Keen Eye</strong> (+3% rare find), and <strong>Proficient Gatherer</strong> (+1 check). Gather again: the card's <strong>Skills</strong> section lists what applied.</li>
<li>A Masterful extraction (margin 10+) always draws from the rare table.</li>
<li>Untrained check: in the Professions menu (left hammer), as GM switch the character to Herbalism, then gather Copper Vein again. No profession die; XP is banked.</li>
<li>Herbalism: gather <strong>Moonpetal Patch</strong> with Herbalism selected. The same tree applies.</li>
</ol>
<h3>Universal skill tree (0.9.0)</h3>
<ol>
<li>Capstones (tier 5) cost 2 points. Taking one locks the other five.</li>
<li><strong>Second Look</strong> rerolls one Failed extraction per long rest; a dnd5e long rest refreshes it.</li>
<li><strong>Light Touch</strong>, <strong>Conservationist</strong>, and <strong>Steward of the Wilds</strong> give a chance that a gather uses no pull (a notification says so).</li>
<li><strong>Pathfinder</strong> shows players the drop odds in the gathering window. <strong>Reader of Seasons</strong> softens "Scarce now".</li>
<li><strong>Field Hand</strong>: open a node's gathering window with that character and click <strong>Assist others here</strong>. The next gather there by another character (within an in-game hour) gets the bonus.</li>
<li>To give a character points quickly, raise its XP in the Professions menu (GM) or set skill points in the Skill Tree window.</li>
</ol>
<h3>Nodes (0.6.0)</h3>
<ol>
<li>Open the <strong>Node Manager</strong>: the mountain button in the left Token or Notes controls. The three test nodes are listed. If a scene was open when the kit was made, they also have pins on it.</li>
<li><strong>Deep Silver Seam</strong> is hidden: players cannot see its pin or page. It needs Mining rank 2 and <strong>Test Miner's Pick</strong>. It rolls <strong>Athletics</strong> (Test Gatherer is proficient), plus the profession die. It has DC +2, yield +1, and a +15% rare-find chance.</li>
<li>As the Test Gatherer at Rank 1, gather Deep Silver Seam: a warning says rank 2 is required, and no pull is used. At Rank 2 without the pick, it asks for the tool. Drag <strong>Test Miner's Pick</strong> from the Items folder onto the character, then gather.</li>
<li>Profession sense is set to rank 2. Assign the Test Gatherer to a player. Once it reaches Mining rank 2, that player sees the Deep Silver Seam pin without a reveal.</li>
<li>In the Node Manager, use the eye button to reveal or hide a node for everyone. Use the rotate button to refill pulls. When a node runs out of pulls, its pin turns grey.</li>
<li>Click <strong>New Node</strong> to try the Node Builder. Pick materials and weights, and it makes the table, the page, and a pin.</li>
</ol>
<h3>Conditions (0.8.0)</h3>
<ol>
<li><strong>Test Moonpetal</strong> has condition rules: Night ×3, Day ×0.5, Winter ×0. Open it with the Material button in its Item sheet header to see them.</li>
<li>Open <strong>Conditions &amp; Biomes</strong> (cloud button in the Node Manager). On the Current tab, pin Time = Night, then open Moonpetal Patch: the strip shows Night, and the GM view shows Moonpetal ×3. Pin Season = Winter (or your calendar's winter season): gathering is blocked with a reason, and no pull is used.</li>
<li>On the Difficulty tab, add Weather = Blizzard, +5. Pin Weather = Blizzard: the gathering window's chance drops, and the chat card shows "Conditions: Blizzard +5".</li>
<li>On Biomes &amp; Scenes, set a scene's biome. In the Node Manager, give a node a Biome, or override a material's rules on just that node (Materials tab → condition rules).</li>
<li>Set every pin back to Automatic when you are done.</li>
</ol>
<p>Nodes allow 5 pulls and reset after 8 in-game hours. Click <strong>Reset</strong> on the page as GM to refill.</p>
<p>Removed by the test suite when it finishes.</p>`;

/**
 * Create the full kit. Refuses if a kit already exists.
 * @returns {Promise<object>} uuids of the main documents
 */
export async function createSampleWorld() {
  if (!game.user.isGM) throw new Error("Only the GM may create the sample world.");
  if (!game.modules.get("gatherer")?.active) throw new Error("Enable the Gatherer module first.");
  if (sampleWorldExists()) throw new Error("A sample world already exists. Remove it first.");
  for (const key of ["mining", "herbalism"]) {
    if (!PROFESSIONS[key]) throw new Error(`The sample world needs a "${key}" profession. Add it in Professions & Skill Tree.`);
  }

  // Remember the GM's own settings so removal can restore them.
  const previous = {
    professions: foundry.utils.deepClone(game.settings.get(MODULE_ID, "professions")),
    skillTree: foundry.utils.deepClone(game.settings.get(MODULE_ID, "skillTree"))
  };

  const folderData = type => ({ name: SAMPLE_NAME, type, color: "#7a4fb0", flags: foundry.utils.deepClone(SAMPLE_FLAG) });
  const [itemFolder, tableFolder, journalFolder, actorFolder] = await Folder.implementation.create(
    ["Item", "RollTable", "JournalEntry", "Actor"].map(folderData));

  const material = (profession, tier, baseYield, conditions = []) => ({ [MODULE_ID]: { material: { enabled: true, profession, tier, baseYield, untrainedDc: 0, conditions } } });
  const [copper, silver, moonpetal, sapphire, truffle] = await Item.implementation.create([
    loot("Test Copper Ore", "icons/commodities/metal/nugget-copper.webp", "Mining tier 1 test material. Base Yield 1d4.", itemFolder.id, material("mining", 1, "1d4")),
    loot("Test Silver Ore", "icons/commodities/metal/nugget-silver.webp", "Mining tier 3 test material. Base Yield 1d2.", itemFolder.id, material("mining", 3, "1d2")),
    loot("Test Moonpetal", "icons/consumables/plants/leaf-glowing-blue.webp", "Herbalism tier 1 test material. Base Yield 1d3. Night ×3, Day ×0.5, Winter ×0.", itemFolder.id, material("herbalism", 1, "1d3", [{ type: "time", value: "night", multiplier: 3 }, { type: "time", value: "day", multiplier: 0.5 }, { type: "season", value: "winter", multiplier: 0 }])),
    loot("Test Star Sapphire", "icons/commodities/gems/gem-faceted-round-blue.webp", "Rare find from the Mining rare table.", itemFolder.id),
    loot("Test Glowcap Truffle", "icons/consumables/mushrooms/cap-glowing-yellow.webp", "Rare find from the Herbalism rare table.", itemFolder.id)
  ]);
  const [pick] = await Item.implementation.create([{
    name: "Test Miner's Pick", img: "icons/tools/hand/pickaxe-steel-grey.webp", type: "tool", folder: itemFolder.id, ownership: observer(),
    system: { quantity: 1, proficient: 1, ability: "str", description: { value: "<p>Required tool for the Deep Silver Seam test node. Proficient, so it adds proficiency bonus.</p>" } },
    flags: foundry.utils.deepClone(SAMPLE_FLAG)
  }]);

  const miningTable = await makeTable("Test Mining Node", [{ item: copper, weight: 3 }, { item: silver, weight: 1 }], tableFolder.id);
  const herbTable = await makeTable("Test Herb Patch", [{ item: moonpetal, weight: 1 }], tableFolder.id);
  const rareOre = await makeTable("Test Rare Ores", [{ item: sapphire, weight: 1 }], tableFolder.id);
  const rareHerb = await makeTable("Test Rare Herbs", [{ item: truffle, weight: 1 }], tableFolder.id);
  const seamTable = await makeTable("Test Silver Seam", [{ item: silver, weight: 1 }], tableFolder.id);

  const node = (name, table, settings) => {
    const nodeData = { ...NODE_DEFAULTS, hidden: false, icon: Array.from(table.results ?? [])[0]?.img ?? "", ...settings };
    return { name, type: "gatherer.gatherer", ownership: nodeOwnership(nodeData),
      flags: { gatherer: { table: table.uuid, draws: "5", time: "8", quantity: "1" },
        [MODULE_ID]: { sampleWorld: true, node: nodeData } } };
  };
  const nodes = await JournalEntry.implementation.create({
    name: "Gathering Test Nodes", folder: journalFolder.id, ownership: observer(), flags: foundry.utils.deepClone(SAMPLE_FLAG),
    pages: [
      { name: "How to Test", type: "text", text: { content: GUIDE }, flags: foundry.utils.deepClone(SAMPLE_FLAG) },
      node("Copper Vein", miningTable, { profession: "mining", tier: 1 }),
      node("Moonpetal Patch", herbTable, { profession: "herbalism", tier: 1 }),
      node("Deep Silver Seam", seamTable, { profession: "mining", tier: 3, checkType: "skill", checkKey: "ath",
        dcModifier: 2, yieldModifier: 1, minRank: 2, tools: [{ uuid: pick.uuid, name: pick.name, img: pick.img }], rareChance: 15, hidden: true, senseRank: 2 })
    ]
  });

  // The universal Skill Tree: one web for every profession.
  const { tree } = await buildUniversalTree({ itemFolder: itemFolder.id, journalFolder: journalFolder.id,
    name: TREE_NAME, ownership: observer(), extraFlags: foundry.utils.deepClone(SAMPLE_FLAG) });

  // Point the professions at the rare tables and link the tree.
  const professions = Object.values(PROFESSIONS).map(profession => ({ ...profession,
    rareTable: profession.key === "mining" ? rareOre.uuid : profession.key === "herbalism" ? rareHerb.uuid : profession.rareTable }));
  const api = game.modules.get(MODULE_ID).api;
  await api.setProfessions(professions);
  await api.setSkillTreeConfig({ uuid: tree.uuid, pointsPerRank: 2, startingPoints: 2 });

  const actor = await Actor.implementation.create({
    name: "Test Gatherer", type: "character", folder: actorFolder.id, img: "icons/svg/mystery-man.svg",
    system: { abilities: { str: { value: 14 }, dex: { value: 12 }, con: { value: 12 }, int: { value: 10 }, wis: { value: 14 }, cha: { value: 10 } },
      skills: { ath: { value: 1 } } },
    prototypeToken: { name: "Test Gatherer", actorLink: true },
    flags: {
      [MODULE_ID]: { sampleWorld: true, selectedProfession: "mining", xp: { mining: 95 } },
      [SKILL_TREE_ID]: { selectedSkillTree: tree.uuid }
    }
  });
  await api.syncActor(actor);

  // Pins on the open scene, in a row near its centre.
  const scene = globalThis.canvas?.scene;
  if (scene) {
    const centerX = (scene.width ?? scene.dimensions?.width ?? 2000) / 2;
    const centerY = (scene.height ?? scene.dimensions?.height ?? 2000) / 2;
    const nodePages = Array.from(nodes.pages).filter(page => page.type === "gatherer.gatherer");
    for (const [index, page] of nodePages.entries()) await placePin(page, scene, centerX + (index - 1) * 200, centerY);
  }

  await game.settings.set(MODULE_ID, "sampleWorldPrevious", previous);
  ui.notifications.info("Sample world created.");
  nodes.sheet?.render(true);
  return { actor: actor.uuid, nodes: nodes.uuid, tree: tree.uuid, miningTable: miningTable.uuid, rareOre: rareOre.uuid };
}

/** Delete every kit document and restore the GM's previous profession settings. */
export async function removeSampleWorld() {
  if (!game.user.isGM) throw new Error("Only the GM may remove the sample world.");
  const remove = async (cls, collection) => {
    const ids = Array.from(collection ?? []).filter(isSample).map(document => document.id);
    if (ids.length) await cls.deleteDocuments(ids);
    return ids.length;
  };
  let count = 0;
  // Pins first, while their pages still exist.
  for (const entry of Array.from(game.journal ?? []).filter(isSample)) {
    for (const page of entry.pages ?? []) {
      for (const { scene, note } of pinsFor(page)) { await scene.deleteEmbeddedDocuments("Note", [note.id]); count++; }
    }
  }
  count += await remove(Actor.implementation, game.actors);
  count += await remove(JournalEntry.implementation, game.journal);
  count += await remove(RollTable.implementation, game.tables);
  count += await remove(Item.implementation, game.items);
  count += await remove(Folder.implementation, game.folders);

  const previous = game.settings.get(MODULE_ID, "sampleWorldPrevious");
  if (previous?.professions) await game.settings.set(MODULE_ID, "professions", previous.professions);
  // Restore the GM's link; if none was saved, drop the deleted test tree.
  if (previous?.skillTree) await game.settings.set(MODULE_ID, "skillTree", previous.skillTree);
  else if (skillTreeConfig().uuid && !fromUuidSync(skillTreeConfig().uuid)) await game.settings.set(MODULE_ID, "skillTree", { ...skillTreeConfig(), uuid: "" });
  await game.settings.set(MODULE_ID, "sampleWorldPrevious", {});
  ui.notifications.info(`Sample world removed (${count} documents).`);
  return count;
}
