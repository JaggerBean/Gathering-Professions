import { MODULE_ID, PROFESSIONS, ABILITY_LABELS, DEFAULT_PROFESSIONS, RANK_XP, RANK_DC_REDUCTION, TIER_DC, TIER_XP, TIER_UNTRAINED_DC, GATHER_ATTEMPTS_PER_REST, MINING_MATERIALS, activeRules, rankForXp, rankForActor, selectedProfession, materialRule, checkFormula, getProfessions, normalizeProfessions, professionFlag } from "./rules.js";
import { openMaterialManager, openMaterialEditor, openProgressEditor, openProfessionMenu, openPerkEditor, registerSceneControls, registerUIHooks, registerSettingsMenu } from "./ui.js";
import { ensureWorldContent } from "./worldcontent.js";
import { availablePresets, applyMaterialPreset } from "./presets.js";
import { REFINING, REFINING_VERSION, GENERATED, refiningProfessions, refiningRecipes, allRecipes, createRecipe, updateRecipe, setRecipeDisabled, resetRecipe, deleteRecipe, setLearnedState, discoveredNames, isKnown, recordDiscoveries, backfillDiscoveries, registerDiscoveryHooks, prepareRefinedItems, craftRecipe, actorJobs, deliverDueJobs, deliverAllDueJobs } from "./refining.js";
import { openRecipes } from "./recipes-ui.js";
import { registerRecipeProvider, unregisterRecipeProvider, recipeProviders, providerFor } from "./recipe-registry.js";
import { refiningProvider, inventoryCount, maxBatch, removeFromInventory, addToInventory, addGold, queueJob, formatMinutes, itemPickerGroups } from "./refining.js";
import { successChance } from "./gather-ui.js";
import { DEFAULT_TOOLS, buildDefaultTools } from "./gatheringtools.js";
import { DEFAULT_SKILL_TREE, skillTreeConfig, normalizeSkillTreeConfig, syncProfessionState, resetUniversalTreeSkills, drawRareFind, availableSkillTrees, configuredSkillTree } from "./integrations.js";
import { PERK_EFFECTS, actorPerks, normalizePerk, readPerk, rareChanceTotal, applyPerksToCheck, rerollsLeft, spendReroll, resetRestUses, masterfulLeft, spendMasterful, restUsesLeft, spendRestUse, withMomentum, familiarReduction } from "./perks.js";
import { configureSkillEffects, chooseDraw, offerAppraisal, fieldRepair, repairableTools, setFamiliarBiome, requestLastPull, shareHaul, markRefillCut, handleGmRequest, requestGm } from "./skill-effects.js";
import { UNIVERSAL_SKILLS, buildUniversalTree, relayoutUniversalTree, needsRelayout } from "./skilltree.js";
import { assistPower, assistLabel, offerAssist, withdrawAssist, findAssist, consumeAssist, handleClearAssist } from "./assist.js";
import { pinsFor, pageProfessions, requiredTools, nodeUsage, lastPullHolder, getToolLibrary, addToolToLibrary, removeToolFromLibrary, createRareTable, readNode, nodeGate, applyNodeCheck, isGathererPage, refreshNodeVisibility, refreshPinTint, autoResetExpired, allNodePages, buildNode, updateNode, duplicateNode, deleteNode, resetNodes, setNodeHidden, placePin, placeLinkedNode, normalizeNode } from "./nodes.js";
import { openNodeManager, openNodeBuilder, startPinPlacement, registerNodeUI } from "./node-ui.js";
import { openGatheringWindow, xpProgress } from "./gather-ui.js";
import { DEFAULT_BIOMES, currentConditions, nodeScene, adjustedResults, withAdjustedDraw, weightedPick, conditionDcModifier, getBiomes, normalizeBiomes, normalizeConditionDc, normalizeRules, getOverrides } from "./conditions.js";
import { openConditionsWindow } from "./conditions-ui.js";
import { getDegreeOfSuccess, calculateGatheringYield, gatheringXp, validateBaseYield, upgradePartial, naturalMasterful, autoMasterful } from "./gathering.js";
import { resolveRareFind, whisperStoryFind, rollClimb, finishRareFind, climbState } from "./rarefinds.js";
import { toolDurability, wearTool, durabilityLabel, normalizeDurability } from "./durability.js";
import { buildRareFinds, RARE_FINDS } from "./rareitems.js";
import { gatheringAllowance, reserveGatherAttempt, resetGatherAttempts } from "./gather-limits.js";
import { LEGACY_MODULE_ID, migrateLegacyNamespace } from "./migration.js";
import { gpDialog } from "./dialogs.js";
import { runActorAction, registerActionHooks, withActorActionLease } from "./actions.js";
import { registerSkillPurchaseHooks } from "./skill-purchases.js";
import { rollProfessionCheck } from "./checks.js";
import { registerPricingHooks, MATERIAL_BANDS, RARE_BANDS, PRICE_FACTOR, campaignPrice, tidyPrice, priceInGp } from "./pricing.js";
import { repriceWorld, registerPriceContributor } from "./repricing.js";

// Bump when campaign pricing changes: the active GM reprices the world once.
const PRICING_VERSION = 2;

const RESULT = Symbol("gatheringProfessionResult");
const actorQueues = new WeakMap();
const refundQueues = new WeakMap();
const gatherContexts = new WeakMap();

function queueActorTask(actor, task) {
  const previous = actorQueues.get(actor) ?? Promise.resolve();
  const completion = previous.catch(() => {}).then(task);
  actorQueues.set(actor, completion);
  const cleanup = () => { if (actorQueues.get(actor) === completion) actorQueues.delete(actor); };
  completion.then(cleanup, cleanup);
  return completion;
}

function progress(actor, profession) {
  return Math.max(0, Number(professionFlag(actor, "xp", profession)) || 0);
}

async function addXp(actor, profession, amount) {
  if (!amount) return;
  const before = progress(actor, profession);
  const after = before + amount;
  await actor.setFlag(MODULE_ID, `xp.${profession}`, after);
  if (selectedProfession(actor) === profession && !activeRules().milestoneAdvancement && rankForXp(after) > rankForXp(before)) {
    ui.notifications.info(`${actor.name} reached ${PROFESSIONS[profession].label} rank ${rankForXp(after)}!`);
    await syncProfessionState(actor);
  }
}

const SUCCESS_DEGREES = new Set(["successful", "excellent", "masterful"]);

// Perk and node yield apply only to full successes; partial and failed stay fixed.
// A full success always yields at least 1, even with a negative node modifier.
function applyPerkYield(extraction, degree, perks, node = null) {
  const success = SUCCESS_DEGREES.has(degree.id);
  extraction.perkBonus = success ? perks.yieldBonus : 0;
  extraction.nodeBonus = success ? Number(node?.yieldModifier) || 0 : 0;
  if (success) extraction.quantity = Math.max(1, extraction.quantity + extraction.perkBonus + extraction.nodeBonus);
  return extraction;
}

// Tiered rare finds (see rarefinds.js); found Items are awarded here.
async function rollRareFind(actor, rule, degree, perks, node = null, { natural20 = false, trained = true, fortuneDie = false } = {}) {
  const rare = await resolveRareFind({ rule, degree, natural20, trained, perks, node, fortuneDie });
  if (rare?.trigger && !rare.pending) for (const item of rare.items) await awardItem({ item, quantity: 1 }, actor);
  return rare;
}

/* A player requests the Fortune die from the chat card or gathering window.
 * The active GM resolves it so clients cannot award the same find twice. */
const CLIMB_FLAG = "rareClimbs";
const climbLocks = new Set();

/** Roll a pending climb; once the find settles, offer Appraiser's Eye on this client. */
async function requestPendingClimb(actor, id) {
  const result = await requestPendingClimbRoll(actor, id);
  if (result && !result.pending) {
    try {
      const items = result.items ?? (await Promise.all((result.itemUuids ?? []).map(uuid => fromUuid(uuid)))).filter(Boolean);
      await offerAppraisal(actor, { tableUuid: result.tableUuid ?? result.table?.uuid, items });
    } catch (error) { logFailure("Appraiser's Eye failed")(error); }
  }
  return result;
}

async function requestPendingClimbRoll(actor, id) {
  if (!actor || !(game.user.isGM || actor.isOwner)) throw new Error("Only the character's owner can roll this.");
  if (isActiveGM()) return rollPendingClimb(actor, id);
  if (!game.users?.activeGM) throw new Error("An active GM is needed to roll the Fortune die.");
  const requestId = foundry.utils.randomID();
  await actor.setFlag(MODULE_ID, "climbRequest", { id, requestId });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error("The GM did not answer the Fortune die request."));
    }, 30000);
    const poll = setInterval(async () => {
      const response = actor.getFlag(MODULE_ID, `climbResponses.${requestId}`);
      if (!response) return;
      clearInterval(poll);
      clearTimeout(timeout);
      try { await actor.unsetFlag(MODULE_ID, `climbResponses.${requestId}`); }
      catch (error) { console.warn(`${MODULE_ID}: could not clear Fortune die response`, error); }
      if (response.error) reject(new Error(response.error));
      else resolve(response.result);
    }, 100);
  });
}

async function handleClimbRequest(actor, data, user) {
  if (typeof data?.requestId !== "string" || !/^[A-Za-z0-9]+$/.test(data.requestId)) return;
  if (!/^[A-Za-z0-9]+$/.test(data.id ?? "")) return;
  let response;
  try {
    if (!user || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) {
      throw new Error("Only the character's owner can roll this.");
    }
    const result = await rollPendingClimb(actor, data.id);
    response = { result: result ? { tier: result.tier, pending: result.pending, tableUuid: result.table?.uuid ?? null,
      itemUuids: (result.items ?? []).map(item => item.uuid) } : null };
  } catch (error) {
    response = { error: error.message || "Fortune die failed." };
  }
  await actor.setFlag(MODULE_ID, `climbResponses.${data.requestId}`, response);
}

async function handleDiscoveryRequest(actor, data, user) {
  if (!user || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) return;
  const page = typeof data.pageUuid === "string" ? await fromUuid(data.pageUuid) : null;
  if (!isGathererPage(page) || !page.testUserPermission?.(user, "OBSERVER")) return;
  const table = await fromUuid(page.flags?.gatherer?.table ?? "");
  const allowed = new Set(Array.from(table?.results ?? []).map(result => result.documentUuid).filter(Boolean));
  const known = new Set(page.getFlag(MODULE_ID, "discovered") ?? []);
  const fresh = [];
  for (const uuid of Array.isArray(data.uuids) ? data.uuids : []) {
    if (typeof uuid !== "string" || !allowed.has(uuid) || known.has(uuid)) continue;
    const material = await fromUuid(uuid);
    if (!material || !Array.from(actor.items ?? []).some(item => item.name === material.name)) continue;
    known.add(uuid);
    fresh.push(uuid);
  }
  if (fresh.length) await page.setFlag(MODULE_ID, "discovered", [...known]);
}

async function handleActorRequests(actor, changes, userId) {
  const user = userId ? game.users?.get?.(userId) ?? Array.from(game.users ?? []).find(entry => entry.id === userId) : null;
  if (!user) return;
  const request = key => changes.flags?.[MODULE_ID]?.[key] ?? changes[`flags.${MODULE_ID}.${key}`];
  if (request("climbRequest")) await handleClimbRequest(actor, request("climbRequest"), user);
  if (request("assistClearRequest")) await handleClearAssist(request("assistClearRequest"), user, actor);
  if (request("discoveryRequest")) await handleDiscoveryRequest(actor, request("discoveryRequest"), user);
  if (request("refundRequest")?.actorUuid === actor.uuid) await handleRefundPull(request("refundRequest"), user);
  if (request("gmRequest")) await handleGmRequest(actor, request("gmRequest"), user).catch(logFailure("skill request failed"));
}

async function storePendingClimb(actor, rare, context) {
  const id = foundry.utils.randomID();
  await actor.setFlag(MODULE_ID, `${CLIMB_FLAG}.${id}`, { ...climbState(rare), ...context, created: Date.now() });
  return id;
}

function climbButton(actorUuid, id, rare) {
  const range = rare.climbThreshold < 20 ? `${rare.climbThreshold}–20` : "20";
  return `<div class="gp-climb">Tier ${rare.tier} table. Roll the Fortune die: ${escapeHtml(range)} climbs to the next tier${rare.climbAdvantage ? " (roll twice, keep the better)" : ""}.
    <button type="button" class="gp-climb-roll" data-gp-climb="${escapeHtml(id)}" data-gp-actor="${escapeHtml(actorUuid)}"><i class="fas fa-dice-d20"></i> Roll the Fortune die</button></div>`;
}

function climbLines(rare) {
  return (rare.steps ?? []).map(step => {
    const source = step.roll === null ? "Natural 20 on the check" : `Fortune die ${step.roll}`;
    return step.to > 5 ? `${source}: beyond tier 5!` : `${source}: tier ${step.from} → ${step.to}`;
  });
}

/**
 * The player's Fortune die for a pending climb. Owner (or GM) only.
 * @returns {Promise<object|null>} the updated find, or null when nothing was rolled
 */
async function rollPendingClimb(actor, id) {
  if (!actor || !(game.user.isGM || actor.isOwner)) throw new Error("Only the character's owner can roll this.");
  const key = `${actor.uuid}.${id}`;
  if (climbLocks.has(key)) return null;
  climbLocks.add(key);
  try {
    const stored = actor.getFlag(MODULE_ID, `${CLIMB_FLAG}.${id}`);
    if (!stored?.pending) {
      ui.notifications.warn("This Fortune die has already been rolled.");
      return null;
    }
    const state = foundry.utils.deepClone(stored);
    const { roll, climbs } = await rollClimb(state);
    const speaker = ChatMessage.getSpeaker({ actor });
    if (state.pending) {
      await actor.setFlag(MODULE_ID, `${CLIMB_FLAG}.${id}`, state);
      await roll.toMessage({ speaker, flavor: `<div class="gathering-profession-check"><strong>Fortune die — climbs!</strong>
        <div class="gp-check-section gp-rare">${climbLines(state).map(escapeHtml).join("<br>")}</div>${climbButton(actor.uuid, id, state)}</div>` });
      return state;
    }
    const rare = await finishRareFind(state);
    await actor.setFlag(MODULE_ID, `${CLIMB_FLAG}.${id}`, { ...state, pending: false,
      settling: true, awardItems: rare.items.map(item => ({ uuid: item.uuid, name: item.name })) });
    try {
      for (const item of rare.items) await awardItem({ item, quantity: 1 }, actor);
    } catch (error) {
      throw new Error(`Rare-find award failed for ${actor.name}; the find is locked for GM review to prevent duplicate items.`, { cause: error });
    }
    await actor.unsetFlag(MODULE_ID, `${CLIMB_FLAG}.${id}`);
    const lines = climbLines(rare);
    if (!climbs) lines.push(`Fortune die ${rare.lastRoll}: stays at tier ${rare.tier} (needs ${rare.climbThreshold}+)`);
    const found = [...rare.items.map(item => `${escapeHtml(item.name)} ×1`), ...rare.texts.map(escapeHtml)];
    await roll.toMessage({ speaker, flavor: `<div class="gathering-profession-check"><strong>Fortune die</strong>
      <div class="gp-check-section gp-rare"><strong>Rare Find!</strong> · Tier ${rare.tier}${rare.tableName ? ` (${escapeHtml(rare.tableName)})` : ""}<br>${lines.map(escapeHtml).join("<br>")}
      <br>${found.join("<br>") || "Nothing on the table."}
      ${rare.story ? '<br><strong class="gp-story-flag">Something more lies hidden here… the GM will reveal it.</strong>' : ""}</div></div>` });
    if (rare.story) await whisperStoryFind({ actor, item: { name: stored.itemName }, page: { name: stored.pageName }, rare });
    Hooks.callAll("gatheringProfessionsRareClimb", { actor, id, rare });
    return rare;
  } finally { climbLocks.delete(key); }
}

/** Chat buttons: enabled for the character's owners while the roll is waiting. */
function bindClimbButtons(_message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  for (const button of root?.querySelectorAll?.("[data-gp-climb]") ?? []) {
    const actor = globalThis.fromUuidSync?.(button.dataset.gpActor);
    const waiting = actor?.getFlag?.(MODULE_ID, `${CLIMB_FLAG}.${button.dataset.gpClimb}`)?.pending;
    const allowed = Boolean(actor && (game.user.isGM || actor.isOwner) && waiting);
    button.disabled = !allowed;
    if (!waiting) button.innerHTML = '<i class="fas fa-check"></i> Rolled';
    button.addEventListener("click", event => {
      event.preventDefault();
      button.disabled = true;
      void requestPendingClimb(actor, button.dataset.gpClimb).catch(error => {
        button.disabled = false;
        logFailure("Fortune die failed")(error);
        ui.notifications.error(error.message || "Fortune die failed.");
      });
    });
  }
}

function configuredItem(thing) {
  const item = thing?.item;
  if (!(item instanceof CONFIG.Item.documentClass.implementation)) return null;
  return materialRule(item);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function rareFlavor(rare) {
  if (!rare) return "";
  if (rare.pending) {
    return `<div class="gp-check-section gp-rare"><strong>Rare Find!</strong> (${escapeHtml(rare.trigger)})<br>${climbLines(rare).map(escapeHtml).join("<br>")}
      ${climbButton(rare.actorUuid, rare.climbId, rare)}</div>`;
  }
  if (!rare.trigger) return `<div class="gp-check-section gp-rare">Rare-find roll: ${rare.chanceRoll.total} vs ${rare.chance}% — no rare find.</div>`;
  const found = [...rare.items.map(item => `${escapeHtml(item.name)} ×1`), ...rare.texts.map(escapeHtml)];
  const climbs = (rare.steps ?? []).map(step => step.to > 5
    ? `${step.roll === null ? "Natural 20 on the check" : `Climb roll ${step.roll}`}: beyond tier 5!`
    : `${step.roll === null ? "Natural 20 on the check" : `Climb roll ${step.roll}`}: tier ${step.from} → ${step.to}`);
  if (rare.steps?.length && !rare.story && rare.lastRoll !== null) climbs.push(`Climb roll ${rare.lastRoll}: stays at tier ${rare.tier} (needs ${rare.climbThreshold}+)`);
  const tier = rare.tier ? ` · Tier ${rare.tier}${rare.tableName ? ` (${escapeHtml(rare.tableName)})` : ""}` : "";
  return `<div class="gp-check-section gp-rare"><strong>Rare Find!</strong> (${escapeHtml(rare.trigger)})${tier}
    ${climbs.length ? `<br>${climbs.map(escapeHtml).join("<br>")}` : ""}
    <br>${found.join("<br>") || "Nothing on the table."}
    ${rare.story ? '<br><strong class="gp-story-flag">Something more lies hidden here… the GM will reveal it.</strong>' : ""}</div>`;
}

/** Tool durability lost to natural 1s. */
function wearFlavor(check) {
  const wear = check.wear;
  if (!wear) return "";
  const lost = wear.before - wear.after;
  return `<div class="gp-check-section gp-wear"><strong>Natural 1!</strong> ${escapeHtml(wear.name)} loses ${lost} durability (${wear.after}/${wear.max}).${wear.broke ? `<br><strong>${escapeHtml(wear.name)} breaks!</strong> It cannot be used until it is repaired.` : ""}</div>`;
}

/** Perk, Assist, reroll, and extra-draw lines for the chat card. */
function perkFlavor(check, perks) {
  const sources = key => escapeHtml((perks.effectSources?.[key] ?? []).join(", "));
  const lines = [];
  if (check.perkFlat) lines.push(`Check bonus: +${check.perkFlat} (${sources("checkBonus")})`);
  if (check.extraDice?.includes(perks.checkDie) && perks.checkDie) lines.push(`Bonus die: +1d${perks.checkDie} (${sources("checkDie")})`);
  if (check.perkDc) lines.push(`DC reduction: −${check.perkDc} (${sources("dcReduction")})`);
  if (check.untrainedRelief) lines.push(`Untrained relief: −${check.untrainedRelief}`);
  if (check.assist) lines.push(`Assisted by ${escapeHtml(check.assist.name)}: ${escapeHtml(check.assist.label)}`);
  if (check.reroll) lines.push(`Rerolled a failed ${check.reroll.first} (${escapeHtml(check.reroll.label)})`);
  if (check.upgraded) lines.push(`Partial counted as Successful (${sources("partialAsFull")})`);
  if (check.momentum) lines.push(`Momentum: +${check.momentum} (${sources("momentumBonus")})`);
  if (check.familiar) lines.push(`Familiar ground: DC −${check.familiar} (${sources("familiarDc")})`);
  if (check.stewarded) lines.push(`Natural 1 did not wear the tool (${sources("toolSteward")})`);
  if (check.lucky) lines.push(`Natural 20: this gather keeps its node pull (${sources("naturalRefund")})`);
  if (check.shared) lines.push(`${escapeHtml(check.shared.name)} also gets ${check.shared.amount} (${escapeHtml("Shared Haul")})`);
  if (check.appraised) lines.push(`Appraiser's Eye: traded for ${escapeHtml(check.appraised)}`);
  for (const extra of check.extras ?? []) lines.push(`Extra draw: ${escapeHtml(extra.item.name)} ×${extra.quantity} (${sources("extraDraws")})`);
  return lines.length ? `<div class="gp-check-section gp-perks"><strong>Skills</strong><br>${lines.join("<br>")}</div>` : "";
}

function checkFlavor(item, rule, check, roll, degree, extraction, xp, perks = { yieldSources: [] }, rare = null) {
  const label = PROFESSIONS[rule.profession].label;
  const ability = check.checkLabel ?? ABILITY_LABELS[check.ability] ?? check.ability.toUpperCase();
  const durability = check.toolItem && !check.wear ? durabilityLabel(check.toolItem) : "";
  const toolLine = check.toolName ? `<br>Tool: ${escapeHtml(check.toolName)} ${check.toolBonus ? `+${check.toolBonus} (proficient)` : "(not proficient)"}${durability ? ` · durability ${escapeHtml(durability)}` : ""}` : "";
  const nodeDcLine = (check.dcModifier ? `Node DC Modifier: ${check.dcModifier > 0 ? "+" : "−"}${Math.abs(check.dcModifier)}<br>\n    ` : "")
    + (check.conditionDc ? `Conditions: ${escapeHtml(check.conditionParts.join(", "))}<br>\n    ` : "");
  const d20 = roll?.dice[0]?.total ?? "?";
  const professionDie = roll?.dice[1]?.total ?? "?";
  const modifier = check.modifier >= 0 ? `+${check.modifier}` : `${check.modifier}`;
  const margin = degree.margin >= 0 ? `+${degree.margin}` : String(degree.margin);
  const yieldDetail = extraction.roll
    ? `${extraction.maximized ? "Maximum" : "Yield roll"}: ${escapeHtml(extraction.roll.result ?? extraction.baseTotal)} = ${extraction.baseTotal}`
    : degree.id === "partial" ? "Partial extraction: exactly 1; base yield is not rolled." : "Failed extraction: no yield roll.";
  return `<div class="gathering-profession-check">
    <strong>${escapeHtml(label)} — ${escapeHtml(item.name)}</strong>
    <div class="gp-check-section">Tier: ${rule.tier} · Rank: ${check.rank}${check.trained ? " (Selected profession)" : " (Untrained)"}<br>
    Profession Die: ${check.trained ? `d${check.die}` : "None"}<br>${escapeHtml(ability)} Modifier: ${modifier}${toolLine}</div>
    <div class="gp-check-section">Base DC: ${rule.dc}<br>
    Rank Reduction: ${check.reduction ? `−${check.reduction}` : "0"}<br>
    Untrained Tier DC: +${check.tierPenalty}<br>
    Untrained Material DC: +${check.materialPenalty}<br>
    ${nodeDcLine}Final DC: <strong>${check.target}</strong></div>
    ${check.auto ? `<div class="gp-check-section gp-perks"><strong>${escapeHtml(check.auto.label)}</strong>: automatic Masterful extraction. No check was rolled.</div>`
      : `<div class="gp-check-section">Dice: d20 (${d20}) ${modifier}${check.toolBonus ? ` + ${check.toolBonus}` : ""}${check.trained ? ` + d${check.die} (${professionDie})` : ""}<br>
    Roll Total: <strong>${roll.total}</strong><br>Margin: <strong>${margin}</strong></div>`}
    <p class="gp-degree gp-degree-${degree.id}"><strong>${degree.label}</strong>${degree.natural ? " (natural 20)" : ""}</p>
    <div class="gp-check-section">Base Yield: <strong>${escapeHtml(extraction.baseYield)}</strong><br>
    ${yieldDetail}<br>Yield Bonus: +${extraction.bonus}<br>
    ${extraction.nodeBonus ? `Node Yield: ${extraction.nodeBonus > 0 ? "+" : "−"}${Math.abs(extraction.nodeBonus)}<br>` : ""}
    ${extraction.perkBonus ? `Perk Bonus: +${extraction.perkBonus} (${escapeHtml(perks.yieldSources.join(", "))})<br>` : ""}
    Gathered: <strong>${extraction.quantity} ${escapeHtml(item.name)}</strong></div>
    ${wearFlavor(check)}
    ${perkFlavor(check, perks)}
    ${rareFlavor(rare)}
    <div class="gp-check-xp">${escapeHtml(label)} XP: <strong>+${xp}</strong>${check.trained ? "" : " (banked; no rank or bonuses until selected)"}</div>
  </div>`;
}

function gathererCheck(data) {
  const passthrough = [];
  const pending = [];
  for (const thing of data.things) {
    try {
      const rule = configuredItem(thing);
      if (!rule) {
        passthrough.push(thing);
        continue;
      }
      // Gatherer's hook is synchronous. Hold configured rewards until its
      // toChat call, after its normal item-award loop, so we can await real dice.
      pending.push({ thing, rule });
    } catch (error) {
      console.error(`${MODULE_ID}: profession check failed for ${thing?.item?.name}`, error);
      ui.notifications.error(`Profession check failed for ${thing?.item?.name || "a material"}; no item was awarded. Check the browser console.`);
    }
  }
  data.things = passthrough;
  Object.defineProperty(data.things, RESULT, { value: { pending } });
}

async function awardItem(thing, actor) {
  const quantityPath = game.settings.get("gatherer", "quantityPath");
  const existing = actor.items.getName(thing.item.name);
  if (existing) {
    const current = Number(foundry.utils.getProperty(existing.system, quantityPath)) || 0;
    const update = { system: {} };
    foundry.utils.setProperty(update.system, quantityPath, current + thing.quantity);
    await existing.update(update);
  } else {
    const itemData = thing.item.toObject();
    foundry.utils.setProperty(itemData.system, quantityPath, thing.quantity);
    await actor.createEmbeddedDocuments("Item", [itemData]);
  }
}

configureSkillEffects({ awardItem: (...args) => awardItem(...args) });

async function awardGatheringResult(actor, item, quantity, xp, profession) {
  if (quantity > 0) await awardItem({ item, quantity }, actor);
  if (xp > 0) await addXp(actor, profession, xp);
}

const GREAT_DEGREES = new Set(["excellent", "masterful"]);

/** Bountiful / Master Harvester: extra results from the node, each at base yield. */
async function drawExtras(sheet, actor, node, conditions, perks, degree) {
  const count = GREAT_DEGREES.has(degree.id) ? perks.extraDraws : 0;
  const table = sheet?.table;
  if (!count || !table?.results) return [];
  const adjusted = adjustedResults(table, node, conditions, { relief: perks.scarcityRelief });
  const extras = [];
  for (let draw = 0; draw < count; draw++) {
    const pick = await weightedPick(table, adjusted);
    const result = pick?.result;
    const item = result?.documentUuid ? await fromUuid(result.documentUuid) : null;
    if (!(item instanceof CONFIG.Item.documentClass.implementation)) continue;
    const rule = materialRule(item);
    const quantity = rule ? (await calculateGatheringYield(rule, getDegreeOfSuccess(0, 0))).quantity : 1;
    await awardItem({ item, quantity }, actor);
    extras.push({ item, quantity });
  }
  return extras;
}

/* Choices made before a gather (gathering window), read once by resolveCheck on
 * the same client: { masterful: true } = use Grandmaster's Touch. */
const gatherIntents = new Map();

function peekIntent(actor) {
  return gatherIntents.get(actor?.id) ?? {};
}

// Lucky Strike: gathers whose natural 20 should refund the pull, by actor id → page uuid.
const luckyStrikes = new Map();

function takeIntent(actor) {
  const intent = gatherIntents.get(actor?.id) ?? {};
  gatherIntents.delete(actor?.id);
  return intent;
}

/** Second Look is optional: ask the player each time a gather fails. */
async function askSecondLook(actor, roll, check, left) {
  const Dialog = foundry.applications?.api?.DialogV2 ? gpDialog() : null;
  if (!Dialog?.confirm) return false;
  try {
    return await Dialog.confirm({
      window: { title: "Second Look" },
      content: `<p>${escapeHtml(actor.name)}'s gather failed: <strong>${roll.total}</strong> against DC <strong>${check.target}</strong>.</p>
        <p>Use <strong>Second Look</strong> to reroll the check? (${left} use${left === 1 ? "" : "s"} left this long rest.) If you decline, it stays available for a later failure.</p>`,
      rejectClose: false, modal: true
    }) === true;
  } catch (error) { logFailure("Second Look prompt failed")(error); return false; }
}

async function resolveCheck({ thing, rule }, actor, sheet, originalToChat) {
  const page = sheet?.document;
  const node = readNode(page);
  const perks = actorPerks(actor, rule.profession);
  const base = applyNodeCheck(checkFormula(actor, rule.profession, progress(actor, rule.profession), rule.dc, rule), actor, node, rule.profession);
  const conditions = currentConditions({ node, scene: nodeScene(page, pinsFor) });
  const conditionDc = conditionDcModifier(conditions, rule.profession, { ignorePenalties: perks.ignoreConditionDc });
  base.conditionDc = conditionDc.total;
  base.conditionParts = conditionDc.parts;
  base.target += conditionDc.total;
  // Familiar Ground: lower DCs in the chosen biome.
  const familiar = familiarReduction(actor, perks, conditions);
  base.target -= familiar;
  // Grandmaster's Touch: chosen before gathering, spends a use, and skips the check.
  const intent = takeIntent(actor);
  const auto = Boolean(intent.masterful) && masterfulLeft(actor, perks) > 0;
  if (auto) await spendMasterful(actor);
  // An automatic Masterful has no roll, so an ally's Assist is kept for a later gather.
  const context = gatherContexts.get(sheet);
  const savedAssist = context?.receipt?.assist;
  const assist = page && !auto ? (context ? (savedAssist ? { ...savedAssist, helper: await fromUuid(savedAssist.helperUuid) } : null) : findAssist(actor, page)) : null;
  // Momentum from an earlier great gather is spent on this check.
  const checkPerks = auto ? perks : withMomentum(actor, perks);
  const check = applyPerksToCheck(base, checkPerks, assist);
  if (familiar) check.familiar = familiar;
  if (checkPerks.momentumApplied) {
    check.momentum = checkPerks.momentumApplied;
    await actor.unsetFlag(MODULE_ID, "momentum");
  }
  if (auto) check.auto = { label: perks.effectSources.masterfulUses.join(", ") || "Grandmaster's Touch" };
  if (assist) {
    check.assist = { name: assist.helper.name, label: assistLabel(assist) };
    if (!context) void consumeAssist(assist.helper, page, actor).catch(logFailure("could not clear assist"));
  }
  let roll = auto ? null : await rollProfessionCheck(actor, check);
  let degree = auto ? autoMasterful() : getDegreeOfSuccess(roll.total, check.target);
  const isNatural20 = result => result?.dice?.[0]?.total === 20;
  // Every natural 1 rolled on the check (a Second Look reroll included) wears the tool.
  let naturalOnes = roll?.dice?.[0]?.total === 1 ? 1 : 0;
  // Second Look: on a failure, the player chooses whether to spend a reroll.
  if (!auto && degree.id === "failed" && !isNatural20(roll) && rerollsLeft(actor, perks) > 0
    && await askSecondLook(actor, roll, check, rerollsLeft(actor, perks))) {
    await spendReroll(actor);
    check.reroll = { first: roll.total, label: perks.effectSources.rerolls.join(", ") };
    roll = await rollProfessionCheck(actor, check);
    degree = getDegreeOfSuccess(roll.total, check.target);
    if (roll.dice?.[0]?.total === 1) naturalOnes++;
  }
  // Tool Steward: the first natural 1s each long rest do not wear the tool.
  const steward = naturalOnes && check.toolItem ? Math.min(naturalOnes, restUsesLeft(actor, perks, "toolSteward")) : 0;
  if (steward) {
    await spendRestUse(actor, "toolSteward", steward);
    naturalOnes -= steward;
    check.stewarded = steward;
  }
  if (naturalOnes && check.toolItem) {
    try {
      const wear = await wearTool(check.toolItem, naturalOnes);
      if (wear) check.wear = { ...wear, name: check.toolItem.name, ones: naturalOnes };
    } catch (error) { logFailure("tool durability update failed")(error); }
  }
  // A natural 20 is always a Masterful extraction, whatever the DC.
  const natural20 = isNatural20(roll);
  if (natural20) degree = naturalMasterful(degree);
  else if (!auto && perks.partialAsFull) {
    degree = upgradePartial(degree);
    check.upgraded = Boolean(degree.upgraded);
  }
  const extraction = await calculateGatheringYield(rule, degree);
  applyPerkYield(extraction, degree, perks, node);
  const great = GREAT_DEGREES.has(degree.id);
  // Momentum carries into the next gather within the hour.
  if (great && perks.momentumBonus) await actor.setFlag(MODULE_ID, "momentum", { at: Number(game.time?.worldTime) || 0, bonus: perks.momentumBonus });
  if (natural20 && perks.naturalRefund && page) {
    luckyStrikes.set(actor.id, page.uuid);
    check.lucky = true;
  }
  const xp = gatheringXp(rule, degree);
  thing.quantity = extraction.quantity;
  await awardGatheringResult(actor, thing.item, extraction.quantity, xp, rule.profession);
  if (context?.receiptId) await requestGm(actor, "gatherResult", { pageUuid: page.uuid, receiptId: context.receiptId,
    itemUuid: thing.item.uuid, degree: degree.id, quantity: extraction.quantity, natural20 }, { wait: true });
  // Shared Haul: the assisting helper gets some of a great gather too.
  if (assist && great && extraction.quantity > 0) {
    try {
       if (context) context.shared.push({ helper: assist.helper, item: thing.item, profession: rule.profession });
       else {
         const amount = await shareHaul(assist.helper, thing.item, page, actor, rule.profession);
         if (amount) check.shared = { name: assist.helper.name, amount };
       }
    } catch (error) { logFailure("Shared Haul failed")(error); }
  }
  check.extras = [];
  try { check.extras = await drawExtras(sheet, actor, node, conditions, perks, degree); }
  catch (error) {
    console.error(`${MODULE_ID}: extra draw failed`, error);
    ui.notifications.error(`Extra draw at ${page?.name ?? "the node"}: ${error.message || "draw failed"}`);
  }
  let rare = null;
  try {
    rare = await rollRareFind(actor, rule, degree, perks, node, { natural20, trained: check.trained, fortuneDie: auto });
    if (rare?.story) await whisperStoryFind({ actor, item: thing.item, page, rare });
    if (rare?.pending) {
      rare.actorUuid = actor.uuid;
      rare.climbId = await storePendingClimb(actor, rare, { itemName: thing.item.name, pageUuid: page?.uuid ?? "", pageName: page?.name ?? "" });
    } else if (rare?.trigger && rare.items?.length) {
      // Appraiser's Eye: reroll the find and keep either result.
      const kept = await offerAppraisal(actor, { tableUuid: rare.table?.uuid, items: rare.items });
      if (kept) {
        check.appraised = kept.map(item => item.name).join(", ");
        rare.items = kept;
      }
    }
  }
  catch (error) {
    // The main material is already awarded; report the rare-table problem only.
    console.error(`${MODULE_ID}: rare-find draw failed`, error);
    ui.notifications.error(`Rare find for ${thing.item.name}: ${error.message || "draw failed"}`);
  }
  const flavor = checkFlavor(thing.item, rule, check, roll, degree, extraction, xp, perks, rare);
  try {
    if (roll) await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
    else await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: flavor });
  } catch (error) {
    console.error(`${MODULE_ID}: could not post roll`, error);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: flavor });
  }
  const awarded = [...(extraction.quantity > 0 ? [thing] : []), ...check.extras];
  if (awarded.length) await originalToChat.call(sheet, awarded, actor);
  // Summary for the gathering window's animated reveal.
  const xpAfter = progress(actor, rule.profession);
  const rankAfter = rankForActor(actor, rule.profession, xpAfter);
  const brief = item => ({ name: item.name, img: item.img, uuid: item.uuid });
  const firstExtraDie = check.trained ? 2 : 1;
  const skillBonus = roll ? check.perkFlat + check.assistFlat + roll.dice.slice(firstExtraDie).reduce((sum, die) => sum + (die.total ?? 0), 0) : 0;
  const notes = [];
  if (check.assist) notes.push(`Assisted by ${check.assist.name}`);
  if (check.reroll) notes.push(`Second Look: rerolled ${check.reroll.first}`);
  if (check.upgraded) notes.push("Partial counted as Successful");
  if (natural20) notes.push("Natural 20: Masterful extraction");
  if (auto) notes.push(`${check.auto.label}: automatic Masterful extraction`);
  if (check.wear) notes.push(check.wear.broke ? `Natural 1: ${check.wear.name} broke!` : `Natural 1: ${check.wear.name} ${check.wear.after}/${check.wear.max}`);
  if (check.stewarded) notes.push("Tool Steward: the natural 1 did not wear your tool");
  if (check.momentum) notes.push(`Momentum +${check.momentum}`);
  if (check.familiar) notes.push(`Familiar ground: DC −${check.familiar}`);
  if (check.lucky) notes.push("Lucky Strike: the pull is kept");
  if (check.shared) notes.push(`Shared Haul: ${check.shared.name} gets ${check.shared.amount}`);
  if (check.appraised) notes.push(`Appraiser's Eye: kept ${check.appraised}`);
  const main = {
    type: "profession", item: brief(thing.item), quantity: extraction.quantity,
    profession: rule.profession, professionLabel: PROFESSIONS[rule.profession]?.label ?? rule.profession,
    trained: check.trained, rank: check.rank, die: check.trained ? check.die : null,
    modifier: check.modifier, toolBonus: check.toolBonus ?? 0, skillBonus,
    d20: roll?.dice[0]?.total ?? null, dieRoll: roll && check.trained ? roll.dice[1]?.total ?? null : null,
    total: roll?.total ?? null, target: check.target, auto,
    degree: { id: degree.id, label: degree.label, margin: degree.margin }, xp,
    xpBar: check.trained && xp > 0 ? xpProgress(xpAfter, xp, rankAfter) : null,
    rankUp: check.trained && rankAfter > check.rank ? rankAfter : null,
    rare: rare?.trigger ? { trigger: rare.trigger, items: (rare.items ?? []).map(brief), texts: rare.texts ?? [],
      tier: rare.tier ?? null, startTier: rare.startTier ?? null, climbs: (rare.steps ?? []).length, story: Boolean(rare.story),
      pending: Boolean(rare.pending), climbId: rare.climbId ?? null, actorUuid: rare.actorUuid ?? null } : null,
    notes
  };
  return [main, ...check.extras.map(extra => ({ type: "plain", item: brief(extra.item), quantity: extra.quantity, extra: true }))];
}

function announceComplete(sheet, actor, results) {
  Hooks.callAll("gatheringProfessionsGatherComplete", { page: sheet?.document ?? null, actor, results });
}

const plainResults = things => things.filter(thing => thing?.item)
  .map(thing => ({ type: "plain", item: { name: thing.item.name, img: thing.item.img, uuid: thing.item.uuid }, quantity: thing.quantity }));

/* Pull refunds: Gatherer does not await its pull update. The owner requests a
 * refund through an authenticated actor update; the GM waits for the pull. */
async function requestPullRefund(page, before, actor, ticket, { lucky = false } = {}) {
  const data = { type: "refundPull", pageUuid: page.uuid, before, actorUuid: actor.uuid, ticket, lucky };
  if (isActiveGM()) return handleRefundPull(data, game.user);
  await actor.setFlag(MODULE_ID, "refundRequest", { ...data, requestId: foundry.utils.randomID() });
}

async function handleRefundPull(data, user) {
  const page = await fromUuid(data.pageUuid);
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if (!isGathererPage(page) || !actor || !user || (!user.isGM && !actor.testUserPermission?.(user, "OWNER"))) return;
  const prior = refundQueues.get(page) ?? Promise.resolve();
  const refund = prior.catch(() => {}).then(() => runActorAction(actor, async () => {
    const record = typeof data.ticket === "string" ? actor.getFlag(MODULE_ID, `gatherTickets.${data.ticket}`) : null;
    if (!record || record.pageUuid !== page.uuid || record.expires < Date.now()) return;
    const perks = actorPerks(actor, readNode(page)?.profession || selectedProfession(actor));
    await actor.unsetFlag(MODULE_ID, `gatherTickets.${data.ticket}`);
    const lucky = data.lucky === true && perks.naturalRefund;
    if (!lucky) {
      if (!(perks.conserveChance > 0)) return;
      const roll = await new Roll("1d100").evaluate({ allowInteractive: false });
      if (roll.total > perks.conserveChance) return;
    }
    const before = Number(data.before);
    if (!Number.isInteger(before) || before < 0) return;
    for (let attempt = 0; attempt < 25; attempt++) {
      const used = Number(page.getFlag("gatherer", "data")?.drawsUsed) || 0;
      if (used > before) {
        // Refund this action's one pull, never restore the caller's old snapshot.
        await page.update({ "flags.gatherer.data.drawsUsed": Math.max(0, used - 1) });
        ui.notifications.info(lucky ? `Lucky Strike: ${actor.name} keeps the pull.` : `${actor.name} gathered with care: one pull refunded.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }));
  refundQueues.set(page, refund);
  const clear = () => { if (refundQueues.get(page) === refund) refundQueues.delete(page); };
  refund.then(clear, clear);
  return refund;
}

/** Mirror Gatherer's early refusals so they do not spend a gathering attempt. */
function gathererCanStart(sheet, actor) {
  if (!Array.from(game.users ?? []).some(user => user.active && user.isGM)) return false;
  if (!actor) return false;
  if (!sheet.table || (sheet.table.results && !Array.from(sheet.table.results).length)) return false;
  if (sheet.REQUIRE?.some(name => !actor.items?.getName?.(name))) return false;
  if (sheet.TOOLDC && sheet.TOOL && !actor.system?.tools?.[sheet.TOOL]) return false;
  const used = Number(sheet.document?.getFlag?.("gatherer", "data")?.drawsUsed) || 0;
  if (sheet.hasDraws && used >= sheet.MAX_DRAWS) return false;
  return true;
}

function integrateGatherer() {
  const Sheet = globalThis.gatherer;
  if (!Sheet?.prototype?.toChat) {
    console.error(`${MODULE_ID}: Gatherer 5 sheet was not available; integration is inactive.`);
    return;
  }
  // Node gates run before Gatherer uses a pull, so a refused attempt costs nothing.
  const originalGather = Sheet.prototype._onGather;
  if (typeof originalGather === "function") {
    Sheet.prototype._onGather = async function (...args) {
      const node = readNode(this.document);
      // Same actor Gatherer will use: (consumeDraw, harvestActor, gatheringActor, event).
      const actor = args[2] ?? globalThis.canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
      // Node gates and the required tool apply to every gather, node or plain Gatherer page.
      const gateProfessions = pageProfessions(this.document, node);
      if (node || gateProfessions.length) {
        const gate = actor ? gateProfessions.map(profession => nodeGate(actor, node, profession)).find(result => !result.ok)
          ?? nodeGate(actor, node) : { ok: true };
        if (!gate.ok) {
          ui.notifications.warn(gate.reason);
          return;
        }
      }
      // Last Pull: an exhausted node's reopened pull belongs to the actor who asked for it.
      const holder = lastPullHolder(this.document);
      if (holder && actor && holder !== actor.uuid) {
        ui.notifications.warn(`Someone is taking the last pull at ${this.document?.name ?? "this node"}.`);
        return;
      }
      // Season, weather, time, and biome reweight the node's table for this draw.
      const table = this.table;
      let started = false;
      let refundTicket = null;
      const runGather = async () => {
        if (actor?.type === "character" && gathererCanStart(this, actor)) {
          try { if (!await reserveGatherAttempt(actor, { pageUuid: this.document?.uuid, onReserved: ticket => { refundTicket = ticket; } })) return; }
          catch (error) {
            console.error(`${MODULE_ID}: could not reserve a gathering attempt`, error);
            ui.notifications.error(error.message || "Could not start gathering.");
            return;
          }
        }
        started = true;
        return originalGather.apply(this, args);
      };
      if (!table?.results) return runGather();
      const conditions = currentConditions({ node, scene: nodeScene(this.document, pinsFor) });
      const perks = actor ? actorPerks(actor, node?.profession || selectedProfession(actor)) : null;
      const adjusted = adjustedResults(table, node, conditions, { relief: perks?.scarcityRelief ?? 0 });
      if (adjusted.empty) {
        const now = [conditions.season, conditions.weather, conditions.time, conditions.biome].filter(Boolean).map(entry => entry.label).join(", ");
        ui.notifications.warn(`Nothing can be gathered here right now${now ? ` (${now})` : ""}.`);
        return;
      }
      const pullsBefore = Number(this.document?.getFlag?.("gatherer", "data")?.drawsUsed) || 0;
      let gathered = false;
      const watch = Hooks.on("gathererGather", data => { if (data?.actor === actor) gathered = true; });
      // Careful Selection: draw two results and let the player keep one.
      const careful = Boolean(peekIntent(actor).careful) && actor && restUsesLeft(actor, perks, "carefulUses") > 0;
      const choose = careful ? (first, second) => chooseDraw(actor, first, second) : null;
      let outcome;
      try { outcome = await withAdjustedDraw(table, adjusted, runGather, { choose }); }
      finally { Hooks.off("gathererGather", watch); }
      if (!started) return;
      if (adjusted.missed) {
        const now = [conditions.season, conditions.weather, conditions.time].filter(Boolean).map(entry => entry.label).join(", ");
        ui.notifications.info(`${actor?.name ?? "You"} searched ${this.document?.name ?? "the node"} but found nothing${now ? ` (${now})` : ""}.`);
      }
      // Lucky Strike: a natural 20 keeps the pull. Otherwise Light Touch /
      // Conservationist / Steward: chance the pull is refunded.
      const lucky = actor && luckyStrikes.get(actor.id) === this.document?.uuid;
      if (actor) luckyStrikes.delete(actor.id);
      if (actor && gathered && nodeUsage(this.document).draws > 0 && (lucky || perks?.conserveChance > 0)) {
        void requestPullRefund(this.document, pullsBefore, actor, refundTicket, { lucky }).catch(logFailure("pull refund failed"));
      }
      // Timekeeper: if this gather exhausted the node, it refills sooner.
      if (actor && gathered && !lucky && perks?.refillCut > 0 && nodeUsage(this.document).draws > 0) {
        void markRefillCut(actor, this.document).catch(logFailure("Timekeeper failed"));
      }
      return outcome;
    };
  }
  const originalToChat = Sheet.prototype.toChat;
  Sheet.prototype.toChat = async function (things, actor) {
    const result = things?.[RESULT];
    if (!result) return originalToChat.call(this, things, actor);
    if (!result.pending.length) {
      if (things.length) await originalToChat.call(this, things, actor);
      announceComplete(this, actor, plainResults(things));
      return;
    }
    if (result.completion) return result.completion;
    // Rapid clicks must not read the same old quantity or XP and lose an award.
    const completion = queueActorTask(actor, async () => {
      if (things.length) await originalToChat.call(this, things, actor);
      const results = plainResults(things);
      for (const pending of result.pending) {
        try { results.push(...await resolveCheck(pending, actor, this, originalToChat)); }
        catch (error) {
          console.error(`${MODULE_ID}: profession check or reward failed for ${pending.thing.item.name}`, error);
          ui.notifications.error(`Gathering ${pending.thing.item.name}: ${error.message || "profession check or reward failed"}`);
        }
      }
      announceComplete(this, actor, results);
    });
    result.completion = completion;
    return completion;
  };
}

// Register independently of Gatherer's sheet initialization so a late-loaded
// sheet cannot silently turn every profession check into an unchecked award.
Hooks.on("gathererGather", gathererCheck);

Hooks.once("init", () => {
  registerPricingHooks();
  registerSettingsMenu();
  registerSceneControls();
  registerNodeUI();
  game.settings.register(MODULE_ID, "rules", {
    name: "Profession Rules", scope: "world", config: false, type: Object,
    default: { rankXp: [...RANK_XP], tierDc: [...TIER_DC], tierXp: [...TIER_XP], tierUntrainedDc: [...TIER_UNTRAINED_DC], rankDcReduction: [...RANK_DC_REDUCTION], milestoneAdvancement: false, masterfulRareFind: true, gatherAttemptsPerRest: GATHER_ATTEMPTS_PER_REST }
  });
  game.settings.register(MODULE_ID, "professions", {
    name: "Gathering Professions", scope: "world", config: false, type: Array,
    default: DEFAULT_PROFESSIONS.map(profession => ({ ...profession }))
  });
  game.settings.register(MODULE_ID, "biomes", {
    name: "Biomes", scope: "world", config: false, type: Array, default: DEFAULT_BIOMES.map(biome => ({ ...biome }))
  });
  game.settings.register(MODULE_ID, "conditionOverrides", {
    name: "Condition Overrides", scope: "world", config: false, type: Object, default: { season: "", weather: "", time: "" }
  });
  game.settings.register(MODULE_ID, "conditionDc", {
    name: "Condition DC Modifiers", scope: "world", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "toolLibrary", {
    name: "Node Tool Library", scope: "world", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "worldContentVersion", {
    name: "Gathering Content Version", scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, "skillTree", {
    name: "Skill Tree Link", scope: "world", config: false, type: Object,
    default: { ...DEFAULT_SKILL_TREE }
  });
  game.settings.register(MODULE_ID, "discoveredItems", {
    name: "Party Discoveries", scope: "world", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "recipeLearned", {
    name: "Recipes learned or unlearned by the GM", scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "recipeEdits", {
    name: "Edited built-in recipes", scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "customRecipes", {
    name: "GM recipes", scope: "world", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "pricingVersion", {
    name: "Campaign Pricing Version", scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, "refiningVersion", {
    name: "Refined Items Version", scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, "legacyMigrationVersion", {
    name: "Legacy Namespace Migration", scope: "world", config: false, type: Number, default: 0
  });
});

Hooks.once("ready", async () => {
  if (isActiveGM()) {
    try {
      const migration = await migrateLegacyNamespace();
      if (migration.migrated) {
        ui.notifications.info(`Gathering Professions migrated ${migration.settings} setting(s) and ${migration.documents} document(s) from ${LEGACY_MODULE_ID}.`);
      }
    } catch (error) {
      console.error(`${MODULE_ID}: legacy namespace migration failed`, error);
      ui.notifications.error(`Gathering Professions could not migrate legacy data: ${error.message}`);
      return;
    }
  }
  if (!game.modules.get("gatherer")?.active) return;
  integrateGatherer();
  registerUIHooks();
  game.modules.get(MODULE_ID).api = {
    get professions() { return getProfessions(); },
    getProfessions,
    skillTreeConfig,
    availableSkillTrees,
    configuredSkillTree,
    actorPerks,
    perkEffects: PERK_EFFECTS,
    migration: { legacyId: LEGACY_MODULE_ID, run: () => migrateLegacyNamespace() },
    skillTree: {
      skills: UNIVERSAL_SKILLS,
      /** GM: build the universal tree (perk Items + Skill Tree journal) and link it. */
      async build({ link = true, ...options } = {}) {
        const built = await buildUniversalTree(options);
        if (link) await game.modules.get(MODULE_ID).api.setSkillTreeConfig({ ...skillTreeConfig(), uuid: built.tree.uuid });
        return built;
      },
      /** GM: move an existing universal tree to the current layout (keeps unlocked skills). */
      async relayout(tree = configuredSkillTree()) {
        if (!game.user.isGM) throw new Error("Only the GM may change the skill tree.");
        if (!tree) throw new Error("No skill tree is linked.");
        return relayoutUniversalTree(tree);
      }
    },
    assist: { power: assistPower, offer: offerAssist, withdraw: withdrawAssist, find: findAssist },
    presets: { list: () => availablePresets(), apply: key => applyMaterialPreset(key) },
    /** Campaign pricing: book × PRICE_FACTOR; module goods in tier bands. */
    pricing: {
      factor: PRICE_FACTOR, materialBands: MATERIAL_BANDS, rareBands: RARE_BANDS,
      campaignPrice, tidyPrice, priceInGp,
      /** GM: reprice the world (dryRun: just the plan). */
      reprice: options => repriceWorld(options),
      /** Add prices for another module's items: fn(prices, helpers) → Map<name, gp>. */
      registerContributor: registerPriceContributor
    },
    /** Refining: smelting, milling, tanning, preparation (Recipes window). */
    refining: {
      definitions: REFINING,
      generated: GENERATED,
      professions: () => refiningProfessions(),
      recipes: (profession, options) => (profession ? refiningRecipes(profession, options) : allRecipes(options)),
      discovered: () => [...discoveredNames()],
      isKnown: recipe => isKnown(recipe),
      /** GM: mark item names as found by the party. */
      discover: names => recordDiscoveries(Array.isArray(names) ? names : [names]),
      /** GM: create/import every refined product (visible to players). */
      prepare: professions => prepareRefinedItems(professions),
      craft: (actor, recipeId, batch = 1) => craftRecipe(actor, recipeId, batch, { addXp }),
      /** GM: "learned", "unlearned", or "auto" for the party. */
      setLearned: (recipeId, state) => setLearnedState(recipeId, state),
      /** GM: { profession, tier, output, quantity, inputs: [[name, qty]] } (names of world Items). */
      create: fields => createRecipe(fields),
      update: (recipeId, fields) => updateRecipe(recipeId, fields),
      disable: (recipeId, disabled = true) => setRecipeDisabled(recipeId, disabled),
      reset: recipeId => resetRecipe(recipeId),
      delete: recipeId => deleteRecipe(recipeId),
      jobs: actor => actorJobs(actor),
      collect: actor => deliverDueJobs(actor)
    },
    openRecipes,
    /** Recipes-window providers and shared crafting helpers (for companion modules). */
    recipes: {
      register: provider => registerRecipeProvider(provider),
      unregister: key => unregisterRecipeProvider(key),
      providers: () => recipeProviders(),
      provider: key => providerFor(key),
      inventoryCount, maxBatch, removeFromInventory, addToInventory, addGold, queueJob, formatMinutes, itemPickerGroups, successChance,
      runActorAction, rollProfessionCheck,
      degree: (total, target) => getDegreeOfSuccess(total, target),
      naturalMasterful: degree => naturalMasterful(degree),
      openRecipes
    },
    /** GM hub: open a section; companion modules add their own sections. */
    hub: {
      open: (section, options) => import("./hub.js").then(module => module.openHub(section, options)),
      registerSection: section => import("./hub.js").then(module => module.registerHubSection(section))
    },
    /** Extra sections in the profession menu (see ui.js openProgressEditor). */
    professionMenu: { hooks: { sections: "gatheringProfessions.menuSections", render: "gatheringProfessions.menuRender" } },
    rareFinds: {
      catalogue: RARE_FINDS,
      /** GM: create the default rare Items and tier tables, and link them. */
      build: options => buildRareFinds(options),
      resolve: resolveRareFind,
      /** Roll the Fortune die for a pending climb (owner or GM). */
      async climb(actor, id) {
        const document = typeof actor === "string" ? await fromUuid(actor) : actor;
        return requestPendingClimb(document, id);
      },
      /** Pending climbs on a character: {id: state}. */
      pending: actor => Object.fromEntries(Object.entries(actor?.getFlag?.(MODULE_ID, CLIMB_FLAG) ?? {}).filter(([, state]) => state?.pending))
    },
    openProfessionsEditor: () => import("./hub.js").then(module => module.openHub("professions")),
    openPerkEditor,
    gather: {
      /** Choose options for this client's next gather by the actor: { masterful: true }. */
      setIntent(actor, intent) { if (actor?.id) gatherIntents.set(actor.id, { ...intent }); },
      clearIntent(actor) { gatherIntents.delete(actor?.id); },
      /** Grandmaster's Touch uses left this long rest. */
      masterfulLeft: actor => masterfulLeft(actor, actorPerks(actor, selectedProfession(actor))),
      rerollsLeft: actor => rerollsLeft(actor, actorPerks(actor, selectedProfession(actor))),
      /** Other once-per-long-rest skills: toolSteward, fieldRepairs, secondWind, carefulUses, appraiseUses, lastPulls. */
      usesLeft: (actor, key) => restUsesLeft(actor, actorPerks(actor, selectedProfession(actor)), key),
      /** Last Pull: ask the GM to reopen one pull on an exhausted node for this actor. */
      lastPull: (actor, page) => requestLastPull(actor, page),
      /** Field Repair: 1d4 durability back on one of the actor's tools. */
      fieldRepair: (actor, item) => fieldRepair(actor, item),
      repairableTools,
      /** Familiar Ground: choose the actor's biome (GM may change it later). */
      setFamiliarBiome: (actor, key) => setFamiliarBiome(actor, key)
    },
    tools: {
      catalogue: DEFAULT_TOOLS,
      /** GM: create the basic tool for each profession with no accepted tools. */
      buildDefaults: () => buildDefaultTools(),
      /** Accepted tools for a gather: the node's own list, else the profession's. */
      required: requiredTools
    },
    durability: {
      get: toolDurability,
      /** GM: set durability and/or maximum (blank max = world default); also repairs. */
      async set(item, values) {
        if (!game.user.isGM) throw new Error("Only the GM may set tool durability.");
        const next = normalizeDurability(values);
        await item.setFlag(MODULE_ID, "durability", next);
        return toolDurability(item);
      },
      async repair(item) {
        if (!game.user.isGM) throw new Error("Only the GM may repair tools.");
        const max = toolDurability(item).max;
        await item.setFlag(MODULE_ID, "durability", { ...(item.getFlag(MODULE_ID, "durability") ?? {}), value: max || null });
        return toolDurability(item);
      }
    },
    content: {
      /** GM: link or build the gathering tree and build missing rare tables. */
      ensure: options => ensureWorldContent(options)
    },
    openGatheringWindow,
    openConditionsWindow,
    conditions: {
      current: currentConditions, biomes: getBiomes, overrides: getOverrides,
      async setBiomes(list) { if (!game.user.isGM) throw new Error("Only the GM may edit biomes."); const biomes = normalizeBiomes(list); await game.settings.set(MODULE_ID, "biomes", biomes); return biomes; },
      async setOverrides(value) { if (!game.user.isGM) throw new Error("Only the GM may override conditions."); const next = { season: String(value?.season ?? ""), weather: String(value?.weather ?? ""), time: String(value?.time ?? "") }; await game.settings.set(MODULE_ID, "conditionOverrides", next); return next; },
      async setDcModifiers(list) { if (!game.user.isGM) throw new Error("Only the GM may edit DC modifiers."); const rows = normalizeConditionDc(list); await game.settings.set(MODULE_ID, "conditionDc", rows); return rows; },
      async setSceneBiome(scene, key) { if (!game.user.isGM) throw new Error("Only the GM may set scene biomes."); if (key && !getBiomes().some(biome => biome.key === key)) throw new Error("Unknown biome."); return key ? scene.setFlag(MODULE_ID, "biome", key) : scene.unsetFlag(MODULE_ID, "biome"); }
    },
    nodes: {
      getToolLibrary, addToolToLibrary, removeToolFromLibrary, createRareTable,
      read: readNode, normalize: normalizeNode, all: allNodePages, gate: nodeGate,
      build: buildNode, update: updateNode, duplicate: duplicateNode, delete: deleteNode,
      reset: resetNodes, setHidden: setNodeHidden, placePin, placeLinked: placeLinkedNode, refreshVisibility: refreshNodeVisibility,
      openManager: openNodeManager, openBuilder: openNodeBuilder, startPlacement: startPinPlacement
    },
    async setProfessions(list) {
      if (!game.user.isGM) throw new Error("Only the GM may edit professions.");
      const professions = normalizeProfessions(list);
      await game.settings.set(MODULE_ID, "professions", professions);
      return professions;
    },
    async setSkillTreeConfig(value) {
      if (!game.user.isGM) throw new Error("Only the GM may link a Skill Tree.");
      const config = normalizeSkillTreeConfig(value);
      await game.settings.set(MODULE_ID, "skillTree", config);
      return config;
    },
    /** Mirror ranks and grant owed Skill Tree points for one actor. */
    syncActor(actor) {
      return queueActorTask(actor, () => syncProfessionState(actor));
    },
    /** GM: clear one character's universal tree and refund their current point budget. */
    resetSkills(actor, tree = configuredSkillTree()) {
      return queueActorTask(actor, () => resetUniversalTreeSkills(actor, tree));
    },
    /** GM: sync every character. Returns the total points granted. */
    async syncAllActors() {
      if (!game.user.isGM) throw new Error("Only the GM may sync every character.");
      let granted = 0;
      for (const actor of game.actors) {
        if (actor.type !== "character") continue;
        granted += (await queueActorTask(actor, () => syncProfessionState(actor))).granted;
      }
      return granted;
    },
    async setPerk(item, perk) {
      if (!game.user.isGM) throw new Error("Only the GM may configure perks.");
      if (perk === null) return item.setFlag(MODULE_ID, "perk", { enabled: false });
      return item.setFlag(MODULE_ID, "perk", normalizePerk(perk));
    },
    miningMaterials: MINING_MATERIALS,
    activeRules,
    rankForXp,
    rankForActor,
    selectedProfession,
    materialRule,
    getDegreeOfSuccess,
    calculateGatheringYield,
    gatheringXp,
    openMaterialManager,
    openMaterialEditor,
    openRulesEditor: () => import("./hub.js").then(module => module.openHub("rules")),
    openProgressEditor,
    openProfessionMenu,
    async selectProfession(actor, profession) {
      if (!actor || actor.type !== "character" || (!game.user.isGM && !actor.isOwner)) {
        throw new Error("Choose a character you own.");
      }
      const key = profession === "" || profession === null ? null : profession;
      if (key !== null && !Object.hasOwn(PROFESSIONS, key)) throw new Error("Choose a valid profession.");
      return queueActorTask(actor, async () => {
        const current = selectedProfession(actor);
        if (!game.user.isGM && (current || key === null)) {
          throw new Error("You may choose a profession once. Ask the GM to change it afterward.");
        }
        // Existing XP and manual ranks stay intact; inactive professions remain rank 0.
        await actor.setFlag(MODULE_ID, "selectedProfession", key);
        await syncProfessionState(actor);
      });
    },
    getProgress(actor) {
      return Object.fromEntries(Object.keys(PROFESSIONS).map(key => {
        const xp = progress(actor, key);
        const rank = rankForActor(actor, key, xp);
        return [key, { xp, rank, trained: rank > 0, nextRankXp: rank ? activeRules().rankXp[rank] ?? null : null }];
      }));
    },
    async setMaterial(item, material) {
      if (!game.user.isGM) throw new Error("Only the GM may configure materials.");
      const automatic = material?.profession === "automatic";
      if (automatic && !materialRule({ name: item.name, folder: item.folder, _source: item._source })) {
        throw new Error("This Item has no automatic Mining default. Choose a profession.");
      }
      if (!automatic && !PROFESSIONS[material?.profession]) throw new Error("Unknown profession.");
      const tier = Number(material.tier);
      if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new Error("Tier must be 1–5.");
      const baseYield = validateBaseYield(material.baseYield);
      const dc = material.dc == null ? null : Number(material.dc);
      const xp = material.xp == null ? null : Number(material.xp);
      const untrainedDc = Number(material.untrainedDc ?? 0);
      const rareTable = material.rareTable == null ? "" : String(material.rareTable).trim();
      const conditions = normalizeRules(material.conditions ?? []);
      if (!Number.isInteger(untrainedDc) || untrainedDc < 0) throw new Error("Extra untrained DC must be a nonnegative whole number.");
      if (dc !== null && (!Number.isInteger(dc) || dc < 1 || dc > 100)) throw new Error("DC must be a whole number from 1 to 100.");
      if (xp !== null && (!Number.isInteger(xp) || xp < 0)) throw new Error("XP must be a nonnegative whole number.");
      // Explicit nulls reset optional overrides even when Foundry merges flags.
      await item.setFlag(MODULE_ID, "material", { ...material, enabled: true,
        profession: automatic ? null : material.profession, tier, dc, xp, baseYield, untrainedDc, rareTable, conditions });
    },
    async setXp(actor, profession, xp) {
      if (!game.user.isGM) throw new Error("Only the GM may set profession XP.");
      if (!PROFESSIONS[profession]) throw new Error("Unknown profession.");
      const value = Number(xp);
      if (!Number.isInteger(value) || value < 0) throw new Error("XP must be a nonnegative whole number.");
      await actor.setFlag(MODULE_ID, `xp.${profession}`, value);
      await queueActorTask(actor, () => syncProfessionState(actor));
    },
    async setRank(actor, profession, rank) {
      if (!game.user.isGM) throw new Error("Only the GM may set profession ranks.");
      if (!activeRules().milestoneAdvancement) throw new Error("Enable GM-controlled ranks in Tier & Rank Rules first.");
      if (!PROFESSIONS[profession]) throw new Error("Unknown profession.");
      const value = Number(rank);
      if (selectedProfession(actor) !== profession) throw new Error("Only the selected profession can have a rank.");
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("Rank must be a whole number from 1 to 5.");
      await actor.setFlag(MODULE_ID, `rank.${profession}`, value);
      await queueActorTask(actor, () => syncProfessionState(actor));
    }
  };
  // Mirror ranks and grant any owed Skill Tree points (catch-up after a new
  // tree, a points change, or ranks set while offline). Only the first active
  // GM writes, so several GMs do not race. Deferred so the Skill Tree module's
  // own ready hook has published its API.
  if (game.user.isGM && game.users?.activeGM?.id === game.user.id) {
    setTimeout(() => void ensureWorldContent()
      .then(report => { if (report) ui.notifications.info(`Gathering content ready: ${report.tree}${report.rareTables ? `, ${report.rareTables} rare-find tables built` : ""}${report.tools ? `, ${report.tools} gathering tools created` : ""}.`); })
      .catch(logFailure("could not set up gathering content"))
      .then(() => migrateUniversalTree()).catch(logFailure("could not update the universal tree"))
      .finally(() => syncEveryCharacter())
      .then(() => setUpRefining()).catch(logFailure("could not set up refining"))
      .then(() => migratePricing()).catch(logFailure("could not apply campaign prices")), 0);
  }
  registerDiscoveryHooks(isActiveGM);
  for (const key of Object.keys(REFINING)) registerRecipeProvider(refiningProvider(key, { addXp }));
  // Companion modules (Crafting Professions) register here: the API is ready.
  Hooks.callAll("gatheringProfessions.ready", game.modules.get(MODULE_ID).api);
  Hooks.on("updateSetting", setting => {
    if (setting?.key === `${MODULE_ID}.skillTree` && isActiveGM()) syncEveryCharacter();
  });
  registerActionHooks();
  registerSkillPurchaseHooks();
  registerNodeHooks();
  registerGatheringHooks();
  console.info(`${MODULE_ID}: Gatherer profession checks active.`);
});

/** Active GM: record what the party carries, prepare refined Items once per version, deliver finished work. */
async function setUpRefining() {
  if (!isActiveGM()) return;
  await backfillDiscoveries();
  if ((game.settings.get(MODULE_ID, "refiningVersion") ?? 0) < REFINING_VERSION && refiningProfessions().length) {
    const result = await prepareRefinedItems();
    await game.settings.set(MODULE_ID, "refiningVersion", REFINING_VERSION);
    if (result.created || result.imported) ui.notifications.info(`Refining ready: ${result.created} refined items created, ${result.imported} imported.`);
    if (result.missing.length) console.warn(`${MODULE_ID}: refining items not found: ${result.missing.join(", ")}`);
  }
  await deliverAllDueJobs();
}

/** Active GM: apply campaign prices once per PRICING_VERSION (world items and inventories). */
async function migratePricing() {
  if (!isActiveGM() || (Number(game.settings.get(MODULE_ID, "pricingVersion")) || 0) >= PRICING_VERSION) return;
  const result = await repriceWorld();
  await game.settings.set(MODULE_ID, "pricingVersion", PRICING_VERSION);
  if (result.world.length || result.actors.length) ui.notifications.info(`Campaign prices applied: ${result.world.length} items, ${result.actors.length} carried items.`);
}

function syncEveryCharacter() {
  for (const actor of game.actors) {
    if (actor.type === "character") void queueActorTask(actor, () => syncProfessionState(actor))
      .catch(error => console.error(`${MODULE_ID}: could not sync ${actor.name}`, error));
  }
}

/** Bring the linked universal tree up to the current rules. Active GM only. */
async function migrateUniversalTree() {
  if (!game.modules.get("skill-tree")?.active) return;
  const tree = configuredSkillTree();
  if (tree && needsRelayout(tree)) {
    await relayoutUniversalTree(tree);
    ui.notifications.info(`Updated ${tree.name} skill tree rules.`);
  }
}

function isActiveGM() {
  return game.user.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
}

function logFailure(label) {
  return error => console.error(`${MODULE_ID}: ${label}`, error);
}

// Only the active GM writes ownership, pin tint, and timer resets.
function registerNodeHooks() {
  const refreshAllVisibility = foundry.utils.debounce?.(() => void refreshNodeVisibility().catch(logFailure("node visibility refresh failed")), 500)
    ?? (() => void refreshNodeVisibility().catch(logFailure("node visibility refresh failed")));
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    if (!isActiveGM() || !isGathererPage(page)) return;
    if (changes.flags?.gatherer) void refreshPinTint(page).catch(logFailure("pin tint failed"));
    if (changes.flags?.[MODULE_ID]?.node) void refreshNodeVisibility([page]).catch(logFailure("node visibility failed"));
  });
  Hooks.on("updateActor", (actor, changes, _options, userId) => {
    if (!isActiveGM() || actor.type !== "character") return;
    if (changes.flags?.[MODULE_ID] || changes.ownership) refreshAllVisibility();
    void handleActorRequests(actor, changes, userId).catch(logFailure("could not handle gathering request"));
  });
  const perkChanged = item => item?.parent?.type === "character" && readPerk(item);
  Hooks.on("createItem", item => { if (isActiveGM() && perkChanged(item)) refreshAllVisibility(); });
  Hooks.on("deleteItem", item => { if (isActiveGM() && perkChanged(item)) refreshAllVisibility(); });
  Hooks.on("updateUser", (_user, changes) => {
    if (isActiveGM() && "character" in changes) refreshAllVisibility();
  });
  Hooks.on("createUser", () => { if (isActiveGM()) refreshAllVisibility(); });
  Hooks.on("userConnected", () => {
    if (!isActiveGM()) return;
    refreshAllVisibility();
    void deliverAllDueJobs().catch(logFailure("refining delivery failed"));
    void autoResetExpired().catch(logFailure("node timer reset failed"));
    syncEveryCharacter();
  });
  let lastCheck = 0;
  Hooks.on("updateWorldTime", worldTime => {
    if (isActiveGM()) void deliverAllDueJobs(worldTime).catch(logFailure("refining delivery failed"));
    if (!isActiveGM() || Math.abs(worldTime - lastCheck) < 60) return;
    lastCheck = worldTime;
    void autoResetExpired().catch(logFailure("node timer reset failed"));
  });
  if (isActiveGM()) {
    void refreshNodeVisibility().catch(logFailure("node visibility refresh failed"));
    for (const page of allNodePages()) void refreshPinTint(page).catch(logFailure("pin tint failed"));
  }
}

// Pins open the gathering window; the active GM records party discoveries.
function registerGatheringHooks() {
  Hooks.on("renderChatMessageHTML", bindClimbButtons);
  // dnd5e long rest refreshes once-per-rest skills (Second Look).
  Hooks.on("dnd5e.restCompleted", (actor, result) => {
    if (result?.longRest && actor?.isOwner) {
      void resetRestUses(actor).catch(logFailure("could not refresh skill uses"));
      void resetGatherAttempts(actor).catch(logFailure("could not refresh gathering attempts"));
    }
  });
  Hooks.on("activateNote", note => {
    const page = note?.document?.page;
    if (!isGathererPage(page)) return;
    void openGatheringWindow(page).catch(logFailure("could not open gathering window"));
    return false;
  });
}
