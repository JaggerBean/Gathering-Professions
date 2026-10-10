// Player-facing gathering window: node banner and flavor, discovered yields,
// character readiness with success chance, and an animated result reveal.
import { MODULE_ID, PROFESSIONS, ABILITY_LABELS, RANK_DIE, materialRule, checkFormula, rankForActor, activeRules, selectedProfession, professionFlag } from "./rules.js";
import { actorPerks, applyPerksToCheck, relievedMultiplier, masterfulLeft, restUsesLeft, withMomentum, momentumBonus, familiarReduction, familiarBiome } from "./perks.js";
import { assistPower, assistLabel, activeOffer, findAssist, offerAssist, withdrawAssist } from "./assist.js";
import { durabilityLabel, toolDurability } from "./durability.js";
import { NODE_DEFAULTS, readNode, pageProfessions, nodeUsage, isDepleted, lastPullHolder, nodeGate, applyNodeCheck, bestTool, matchingTools, nodeTools, requiredTools, toolNames, resetNodes, setNodeHidden, pinsFor } from "./nodes.js";
import { currentConditions, nodeScene, conditionChips, weightMultiplier, rulesFor, abundance, conditionDcModifier, missShare, getBiomes } from "./conditions.js";
import { gatheringAllowance } from "./gather-limits.js";
import { escape, nodeMaterials, openNodeManager } from "./node-ui.js";

const FALLBACK_ICON = "icons/svg/book.svg";
const PROFESSION_COLORS = { mining: "#c8923f", herbalism: "#5fae6a", logging: "#a8743f", fishing: "#4a8fc4", skinning: "#b07a5a" };

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Gathering failed.");
}

/* ---------------------------------------------------------------------- */
/* Pure helpers (unit tested)                                              */
/* ---------------------------------------------------------------------- */

/** Chance that d20 + modifier (+ d{die}) (+ each extra die) meets the target. 0–1. */
export function successChance(modifier, die, target, extraDice = []) {
  // Distribution of the sum of all dice, built one die at a time.
  let sums = new Map([[0, 1]]);
  for (const faces of [20, ...(die > 0 ? [die] : []), ...extraDice.filter(value => value > 0)]) {
    const next = new Map();
    for (const [sum, weight] of sums) for (let roll = 1; roll <= faces; roll++) next.set(sum + roll, (next.get(sum + roll) ?? 0) + weight / faces);
    sums = next;
  }
  let chance = 0;
  for (const [sum, weight] of sums) if (sum + modifier >= target) chance += weight;
  return Math.min(1, Math.round(chance * 1e9) / 1e9);
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export function discoveredSet(page) {
  const list = page?.getFlag?.(MODULE_ID, "discovered") ?? page?.flags?.[MODULE_ID]?.discovered ?? [];
  return new Set(Array.isArray(list) ? list : []);
}

function xpOf(actor, profession) {
  return Math.max(0, Number(professionFlag(actor, "xp", profession)) || 0);
}

function refillText(page, usage) {
  if (!usage.time) return usage.draws ? "Does not refill on its own" : "";
  if (!usage.used) return `Refills ${usage.time} h after the first pull`;
  const left = usage.firstDrawTime + usage.time * 3600 - (Number(game.time?.worldTime) || 0);
  return left > 0 ? `Refills in ${formatDuration(left)}` : "Refills on next visit";
}

function gathererRequirements(page, actor) {
  const list = String(page?.flags?.gatherer?.require ?? "").split(",").map(name => name.trim()).filter(Boolean);
  return list.map(name => ({ ok: Boolean(actor?.items?.getName?.(name)), label: name, title: "Required by the Gatherer page" }));
}

/**
 * Everything the window shows, computed from the page, actor, and viewer.
 * @param {JournalEntryPage} page
 * @param {Actor|null} actor
 * @param {{isGM?: boolean}} [viewer]
 */
export function buildGatherModel(page, actor, { isGM = false } = {}) {
  const node = readNode(page) ?? { ...NODE_DEFAULTS, hidden: false };
  const usage = nodeUsage(page);
  const discovered = discoveredSet(page);
  const conditions = currentConditions({ node, scene: nodeScene(page, pinsFor) });
  const perks = actor ? actorPerks(actor, node.profession || selectedProfession(actor)) : null;
  const raw = nodeMaterials(page).map(material => {
    const item = material.uuid ? globalThis.fromUuidSync?.(material.uuid) : null;
    const rule = item ? materialRule(item) : null;
    const multiplier = item ? relievedMultiplier(weightMultiplier(rulesFor(item, node), conditions), perks?.scarcityRelief ?? 0) : 1;
    return { ...material, rule, multiplier, hint: abundance(multiplier), known: isGM || discovered.has(material.uuid) };
  });
  const adjustedTotal = raw.reduce((sum, material) => sum + material.weight * material.multiplier, 0);
  // Weight lost to conditions is a chance to find nothing (see missShare).
  const miss = missShare(raw.map(material => ({ base: material.weight, weight: material.weight * material.multiplier })));
  const odds = adjustedTotal > 0 ? adjustedTotal / (1 - miss) : 0;
  const materials = raw.map(material => ({ ...material,
    nowPercent: odds > 0 ? Math.round(((material.weight * material.multiplier) / odds) * 100) : 0 }));
  const professionKey = node.profession || materials.find(material => material.rule)?.rule.profession || "";
  const profession = PROFESSIONS[professionKey] ?? null;
  const icon = node.icon || materials[0]?.img || FALLBACK_ICON;
  const model = {
    name: page.name, region: page.parent?.name ?? "", icon, flavor: node.flavor ?? "",
    profession: professionKey, professionLabel: profession?.label ?? "", tier: node.tier,
    color: PROFESSION_COLORS[professionKey] ?? "#d4a84a",
    usage, depleted: isDepleted(page), refill: refillText(page, usage),
    fill: usage.draws ? Math.round(((usage.remaining ?? 0) / usage.draws) * 100) : 100,
    materials, knownCount: materials.filter(material => material.known).length,
    conditions: conditionChips(conditions),
    empty: materials.length > 0 && adjustedTotal <= 0,
    missPercent: adjustedTotal > 0 ? Math.round(miss * 100) : 0,
    rareTable: node.rareTable ? globalThis.fromUuidSync?.(node.rareTable)?.name ?? "Custom table" : "",
    // Pathfinder lets players see the odds the GM sees.
    showOdds: isGM || Boolean(perks?.seeOdds),
    node, isGM, actor: null
  };
  if (!actor) return model;

  const rank = professionKey ? rankForActor(actor, professionKey) : 0;
  const assist = findAssist(actor, page);
  const base = profession ? checkFormula(actor, professionKey, xpOf(actor, professionKey), 0, {}) : null;
  const check = base ? applyPerksToCheck(applyNodeCheck(base, actor, node, professionKey), withMomentum(actor, perks), assist) : null;
  const chances = materials.filter(material => material.rule && material.multiplier > 0).map(material => {
    const rule = material.rule;
    const materialPerks = actorPerks(actor, rule.profession);
    const nodeCheck = applyNodeCheck(checkFormula(actor, rule.profession, xpOf(actor, rule.profession), rule.dc, rule), actor, node, rule.profession);
    nodeCheck.target += conditionDcModifier(conditions, rule.profession, { ignorePenalties: materialPerks.ignoreConditionDc }).total;
    nodeCheck.target -= familiarReduction(actor, materialPerks, conditions);
    const result = applyPerksToCheck(nodeCheck, withMomentum(actor, materialPerks), assist);
    return successChance(result.modifier + (result.toolBonus || 0) + result.perkFlat + result.assistFlat, result.trained ? result.die : 0, result.target, result.extraDice);
  });
  const gateProfessions = pageProfessions(page, node);
  const gate = gateProfessions.map(key => nodeGate(actor, node, key)).find(result => !result.ok) ?? nodeGate(actor, node);
  const requirements = [];
  if (node.minRank && professionKey) requirements.push({ ok: rank >= node.minRank, label: `${profession?.label ?? professionKey} rank ${node.minRank}+`, title: `You have rank ${rank || "none"}` });
  const shownTools = new Set();
  for (const key of gateProfessions.length ? gateProfessions : [professionKey]) {
    const accepted = requiredTools(node, key);
    const listKey = accepted.map(item => item.uuid || item.name).join("|");
    if (!accepted.length || shownTools.has(listKey)) continue;
    shownTools.add(listKey);
    const tool = bestTool(actor, node, key);
    const broken = tool ? [] : matchingTools(actor, node, key);
    const wear = tool ? durabilityLabel(tool.item) : "";
    requirements.push({ ok: Boolean(tool),
      label: tool ? `${tool.item.name}${tool.bonus ? ` (+${tool.bonus})` : ""}${wear ? ` · ${wear}` : ""}` : broken.length ? `${broken.map(item => item.name).join(", ")} (broken)` : toolNames(node, key).join(" or "),
      title: tool ? `Tool carried${wear ? `; durability ${wear}. A natural 1 on the check costs 1 durability.` : ""}` : broken.length ? "Broken: ask the GM to repair it" : "Carry one of these tools" });
  }
  requirements.push(...gathererRequirements(page, actor));
  const abilityLabel = check?.checkLabel ?? (check ? ABILITY_LABELS[check.ability] : "");
  const modifier = check ? check.modifier : 0;
  model.actor = {
    id: actor.id, name: actor.name, img: actor.img,
    rank, trained: rank > 0, die: rank > 0 ? RANK_DIE[rank - 1] : null,
    selected: selectedProfession(actor),
    checkLabel: abilityLabel, modifier, toolBonus: check?.toolBonus ?? 0, toolName: check?.toolName ?? "",
    formula: check ? `d20 ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}${check.toolBonus ? ` + ${check.toolBonus} tool` : ""}${check.trained ? ` + d${check.die}` : ""}`
      + `${check.perkFlat ? ` + ${check.perkFlat} skills` : ""}${check.assistFlat ? ` + ${check.assistFlat} assist` : ""}${check.extraDice.map(die => ` + d${die}`).join("")}` : "",
    chanceMin: chances.length ? Math.min(...chances) : null, chanceMax: chances.length ? Math.max(...chances) : null,
    requirements, gate,
    assistedBy: assist ? { name: assist.helper.name, label: assistLabel(assist) } : null,
    canAssist: Boolean(assistPower(actor)), offering: Boolean(activeOffer(actor, page)), assistText: assistLabel(assistPower(actor)),
    masterfulLeft: masterfulLeft(actor, perks), gatheringAllowance: gatheringAllowance(actor),
    // 0.31.0 skills.
    carefulLeft: restUsesLeft(actor, perks, "carefulUses"),
    lastPullLeft: restUsesLeft(actor, perks, "lastPulls"),
    lastPullHeld: lastPullHolder(page) === actor.uuid,
    momentum: momentumBonus(actor) && perks?.momentumBonus ? momentumBonus(actor) : 0,
    repairsLeft: restUsesLeft(actor, perks, "fieldRepairs"),
    repairable: Array.from(actor.items ?? []).filter(item => {
      const state = toolDurability(item);
      return (item.type === "tool" || item.getFlag?.(MODULE_ID, "durability") !== undefined) && !state.unbreakable && state.value < state.max;
    }).map(item => ({ id: item.id, name: item.name, label: durabilityLabel(item) })),
    familiar: perks?.familiarDc ? { dc: perks.familiarDc, biome: familiarBiome(actor), biomes: getBiomes(), here: familiarReduction(actor, perks, conditions) > 0 } : null
  };
  return model;
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                               */
/* ---------------------------------------------------------------------- */

function percent(value) { return `${Math.round(value * 100)}%`; }

function chanceText(actor) {
  if (actor.chanceMin === null) return "";
  const range = actor.chanceMin === actor.chanceMax ? percent(actor.chanceMin) : `${percent(actor.chanceMin)}–${percent(actor.chanceMax)}`;
  const mid = (actor.chanceMin + actor.chanceMax) / 2;
  const word = mid >= 0.75 ? "Easy" : mid >= 0.5 ? "Fair" : mid >= 0.25 ? "Hard" : "Very hard";
  return `<div class="gp-gw-chance gp-chance-${word.toLowerCase().replace(" ", "-")}" title="Base estimate; dnd5e conditions, bonuses and advantage can change the actual odds"><span>${word}</span> ~${range} base chance of a full success</div>`;
}

export function renderGatherWindow(model, state = {}) {
  const { usage, actor } = model;
  const tiles = model.materials.map(material => material.known
    ? `<div class="gp-gw-tile gp-now-${material.hint?.key ?? "normal"}" title="${escape(material.name)}${model.showOdds ? ` — ${material.nowPercent ?? material.percent}% now (base ${material.percent}%)${model.isGM && material.rule ? `, DC ${material.rule.dc}` : ""}` : ""}">
        <img src="${escape(material.img)}" alt=""><span>${escape(material.name)}</span>${model.showOdds ? `<small>${material.nowPercent ?? material.percent}%${material.multiplier !== undefined && material.multiplier !== 1 ? ` · ×${material.multiplier}` : ""}${model.isGM && material.rule ? ` · DC ${material.rule.dc}` : ""}</small>` : ""}${material.hint?.label ? `<em class="gp-now">${escape(material.hint.label)}</em>` : ""}</div>`
    : `<div class="gp-gw-tile unknown" title="Undiscovered"><div class="gp-gw-unknown"><i class="fas fa-question"></i></div><span>???</span></div>`).join("");
  const missHint = model.missPercent ? ` ${model.missPercent}% chance to find nothing now.` : "";
  const unknownHint = model.knownCount < model.materials.length ? "Undiscovered materials appear once your party gathers them here." : "";
  const yieldsHint = model.isGM
    ? `GM view: all materials and odds.${missHint}${model.rareTable ? ` Rare table: ${escape(model.rareTable)}.` : ""}`
    : model.showOdds ? `Pathfinder: current odds shown.${missHint}${unknownHint ? ` ${unknownHint}` : ""}` : unknownHint;

  const characterOptions = (state.characters ?? []).map(character => `<option value="${escape(character.id)}" ${character.id === actor?.id ? "selected" : ""}>${escape(character.name)}</option>`).join("");
  const picker = state.characters?.length > 1 || (!actor && state.characters?.length)
    ? `<select data-act-change="actor" aria-label="Gathering character">${actor ? "" : '<option value="">Choose a character…</option>'}${characterOptions}</select>` : "";

  let ready = "";
  let disabledReason = "";
  if (!actor) {
    ready = `<div class="gp-gw-noactor"><i class="fas fa-user-slash"></i> Select your token or choose a character.</div>`;
    disabledReason = "No character";
  } else {
    const professionLine = !model.profession ? "No profession on this node"
      : actor.trained ? `${escape(model.professionLabel)} · Rank ${actor.rank} <span class="gp-die-badge">d${actor.die}</span>`
      : `${escape(model.professionLabel)} · <em>Untrained</em> <span class="gp-gw-warn" title="No profession die or rank reduction. XP is banked.">XP banked</span>`;
    ready = `<div class="gp-gw-who">
        <img src="${escape(actor.img || "icons/svg/mystery-man.svg")}" alt="">
        <div><strong>${escape(actor.name)}</strong><div class="gp-gw-prof">${professionLine}</div></div>
      </div>
      ${actor.formula ? `<div class="gp-gw-check"><i class="fas fa-dice-d20"></i> ${escape(actor.checkLabel)} check: <strong>${escape(actor.formula)}</strong></div>` : ""}
      <div class="gp-gw-check"><i class="fas fa-hourglass-half"></i> Gathering attempts: ${actor.gatheringAllowance.limit
        ? `${actor.gatheringAllowance.remaining} / ${actor.gatheringAllowance.limit} free before long rest${actor.gatheringAllowance.remaining ? "" : ` · next attempt adds 1 exhaustion (currently ${actor.gatheringAllowance.exhaustion})`}`
        : "Unlimited"}${actor.gatheringAllowance.secondWind && actor.gatheringAllowance.limit && !actor.gatheringAllowance.remaining ? ` · Second Wind ready (no exhaustion)` : ""}</div>
      ${skillLines(actor, model)}
      ${actor.requirements.length ? `<div class="gp-gw-reqs">${actor.requirements.map(req => `<span class="gp-req ${req.ok ? "ok" : "missing"}" title="${escape(req.title)}"><i class="fas ${req.ok ? "fa-check" : "fa-xmark"}"></i> ${escape(req.label)}</span>`).join("")}</div>` : ""}
      ${actor.assistedBy ? `<div class="gp-gw-assisted"><i class="fas fa-handshake"></i> Assisted by <strong>${escape(actor.assistedBy.name)}</strong>: ${escape(actor.assistedBy.label)}</div>` : ""}
      ${chanceText(actor)}
      ${actor.canAssist ? `<div class="gp-gw-assist"><button type="button" data-act="assist" title="Your Assist applies to the next gather here by another character (within 1 hour)."><i class="fas fa-handshake-angle"></i> ${actor.offering ? "Withdraw assist" : `Assist others here (${escape(actor.assistText)})`}</button></div>` : ""}`;
    if (!actor.gate.ok) disabledReason = actor.gate.reason;
  }
  if (model.empty) disabledReason = `Nothing can be gathered here right now${model.conditions?.length ? ` (${model.conditions.map(chip => chip.label).join(", ")})` : ""}.`;
  if (model.depleted) disabledReason = actor?.lastPullLeft ? "This spot is exhausted. Last Pull can reopen one pull for you." : "This spot is exhausted.";
  if (actor?.gatheringAllowance.limit && !actor.gatheringAllowance.remaining
      && actor.gatheringAllowance.exhaustion >= actor.gatheringAllowance.maxExhaustion) {
    disabledReason = `Exhaustion is already at its maximum (${actor.gatheringAllowance.maxExhaustion}).`;
  }
  if (!globalThis.game?.users?.activeGM) disabledReason = disabledReason || "A GM must be connected to gather.";
  if (state.busy) disabledReason = "";

  const gmBar = model.isGM ? `<footer class="gp-gw-gm">
      <span>GM</span>
      <button type="button" data-act="edit" title="Edit in Node Manager"><i class="fas fa-pen"></i> Edit</button>
      <button type="button" data-act="refill" title="Refill pulls"><i class="fas fa-rotate"></i> Refill</button>
      <button type="button" data-act="toggle" title="${model.node.hidden ? "Reveal to players" : "Hide from players"}"><i class="fas ${model.node.hidden ? "fa-eye" : "fa-eye-slash"}"></i> ${model.node.hidden ? "Reveal" : "Hide"}</button>
      <button type="button" data-act="page" title="Open the original Gatherer page"><i class="fas fa-book-open"></i></button>
    </footer>` : "";

  return `<div class="gp-gw ${model.depleted ? "depleted" : ""}" style="--gp-prof:${escape(model.color)}">
    <header class="gp-gw-banner">
      <div class="gp-gw-emblem"><img src="${escape(model.icon)}" alt=""></div>
      <div class="gp-gw-title">
        <h1>${escape(model.name)}</h1>
        <div class="gp-gw-sub">${escape([model.professionLabel, model.tier ? `Tier ${model.tier}` : "", model.region].filter(Boolean).join(" · "))}${model.node.hidden && model.isGM ? ' <span class="gp-gw-hidden"><i class="fas fa-eye-slash"></i> Hidden</span>' : ""}</div>
      </div>
    </header>
    ${model.flavor ? `<p class="gp-gw-flavor">${escape(model.flavor).replace(/\n/g, "<br>")}</p>` : ""}
    ${model.conditions?.length ? `<div class="gp-gw-conditions">${model.conditions.map(chip => `<span class="gp-gw-cond" title="${escape(chip.type)}${model.isGM && chip.source ? ` (${escape(chip.source)})` : ""}"><i class="fas ${chip.icon}"></i> ${escape(chip.label)}</span>`).join("")}</div>` : ""}
    <div class="gp-gw-pulls">
      <div class="gp-gw-bar"><span style="width:${model.fill}%"></span></div>
      <div class="gp-gw-pulls-text"><span>${usage.draws ? (model.depleted ? "<strong>Exhausted</strong>" : `<strong>${usage.remaining}</strong> of ${usage.draws} pulls left`) : "Plentiful"}</span><span>${escape(model.refill)}</span></div>
    </div>
    <section class="gp-gw-section">
      <h3>Possible yields <small>${model.knownCount}/${model.materials.length} known</small></h3>
      <div class="gp-gw-tiles">${tiles || '<p class="gp-gw-hint">Nothing grows here.</p>'}</div>
      ${yieldsHint ? `<p class="gp-gw-hint">${yieldsHint}</p>` : ""}
    </section>
    <section class="gp-gw-section gp-gw-ready">
      <h3>Gatherer ${picker}</h3>
      ${ready}
    </section>
    <div class="gp-gw-action">
      <button type="button" class="gp-gw-gather" data-act="gather" ${disabledReason || state.busy ? "disabled" : ""}>
        ${state.busy ? '<i class="fas fa-spinner fa-spin"></i> Gathering…' : '<i class="fas fa-hand-sparkles"></i> Gather'}
      </button>
      ${model.depleted && actor?.lastPullLeft ? `<button type="button" class="gp-gw-lastpull" data-act="last-pull" ${state.busy ? "disabled" : ""} title="Once per long rest: the GM reopens one pull here for you."><i class="fas fa-seedling"></i> Last Pull (${actor.lastPullLeft} left)</button>` : ""}
      ${actor?.carefulLeft && !model.depleted ? `<label class="gp-gw-masterful" title="Once per long rest: draw two results from this node and choose which to gather."><input type="checkbox" data-act-change="careful" ${state.careful ? "checked" : ""} ${state.busy ? "disabled" : ""}> Use Careful Selection (${actor.carefulLeft} left)</label>` : ""}
      ${actor?.masterfulLeft ? `<label class="gp-gw-masterful" title="Once per long rest: this gather is an automatic Masterful extraction (no check roll). Its rare find still needs the Fortune die to climb."><input type="checkbox" data-act-change="masterful" ${state.masterful ? "checked" : ""} ${state.busy ? "disabled" : ""}> Use Grandmaster's Touch (${actor.masterfulLeft} left)</label>` : ""}
      ${disabledReason ? `<div class="gp-gw-why">${escape(disabledReason)}</div>` : ""}
    </div>
    <section class="gp-gw-result ${state.animate ? "animate" : ""}" data-result>${state.resultHtml ?? ""}</section>
    ${gmBar}
  </div>`;
}

/** Momentum, Familiar Ground and Field Repair lines in the gatherer panel. */
function skillLines(actor, model) {
  const lines = [];
  if (actor.momentum) lines.push(`<div class="gp-gw-check gp-gw-skill"><i class="fas fa-angles-up"></i> Momentum: +${actor.momentum} on your next check</div>`);
  if (actor.familiar) {
    const label = actor.familiar.biomes.find(biome => biome.key === actor.familiar.biome)?.label ?? actor.familiar.biome;
    const options = actor.familiar.biomes.map(biome => `<option value="${escape(biome.key)}" ${biome.key === actor.familiar.biome ? "selected" : ""}>${escape(biome.label)}</option>`).join("");
    lines.push(actor.familiar.biome && !model.isGM
      ? `<div class="gp-gw-check gp-gw-skill"><i class="fas fa-mountain-sun"></i> Familiar ground: ${escape(label)}${actor.familiar.here ? ` <strong>(here: DC −${actor.familiar.dc})</strong>` : ""}</div>`
      : `<div class="gp-gw-check gp-gw-skill"><i class="fas fa-mountain-sun"></i> Familiar ground: <select data-act-change="familiar" aria-label="Familiar biome">${actor.familiar.biome ? "" : '<option value="">Choose a biome…</option>'}${options}</select>${model.isGM ? "" : " <small>(choose once)</small>"}</div>`);
  }
  if (actor.repairsLeft && actor.repairable.length) {
    lines.push(`<div class="gp-gw-check gp-gw-skill"><i class="fas fa-screwdriver-wrench"></i> Field Repair (${actor.repairsLeft} left): ${actor.repairable.map(tool => `<button type="button" class="gp-gw-repair" data-act="repair" data-item="${escape(tool.id)}" title="Restore 1d4 durability">${escape(tool.name)} ${escape(tool.label)}</button>`).join(" ")}</div>`);
  }
  return lines.join("");
}

/** Result panel for one gather (all items drawn). */
export function renderResults(results, actor) {
  if (!results?.length) return `<h3>${escape(actor?.name ?? "")} searched</h3><div class="gp-res"><div class="gp-res-items"><div class="gp-res-nothing pop">Found nothing this time</div></div></div>`;
  let step = 0;
  const delay = () => `style="--d:${(step++ * 0.35).toFixed(2)}s"`;
  const blocks = results.map(result => {
    if (result.type === "plain") {
      return `<div class="gp-res">
        ${result.extra ? `<div class="gp-res-note pop" ${delay()}><i class="fas fa-plus"></i> Extra draw</div>` : ""}
        <div class="gp-res-items"><div class="gp-res-item pop" ${delay()}><img src="${escape(result.item.img)}" alt=""><b>×${result.quantity}</b><label>${escape(result.item.name)}</label></div></div></div>`;
    }
    const sign = value => (value >= 0 ? `+ ${value}` : `− ${Math.abs(value)}`);
    const items = result.quantity > 0
      ? `<div class="gp-res-item pop" ${delay()}><img src="${escape(result.item.img)}" alt=""><b>×${result.quantity}</b><label>${escape(result.item.name)}</label></div>` : "";
    const rares = (result.rare?.items ?? []).map(item => `<div class="gp-res-item pop rare" ${delay()}><img src="${escape(item.img)}" alt=""><b>×1</b><label>${escape(item.name)}</label></div>`).join("");
    const rareTexts = (result.rare?.texts ?? []).map(text => `<div class="gp-res-note pop" ${delay()}><i class="fas fa-gem"></i> ${escape(text)}</div>`).join("");
    const nothing = !items && !rares ? `<div class="gp-res-nothing pop" ${delay()}>Nothing gathered</div>` : "";
    const xp = result.xp > 0 ? `<div class="gp-res-xp pop" ${delay()}>
        <span>+${result.xp} ${escape(result.professionLabel)} XP${result.trained ? "" : " (banked)"}</span>
        ${result.xpBar ? `<div class="gp-res-xpbar"><span style="--from:${result.xpBar.from}%;--to:${result.xpBar.to}%"></span></div><small>${escape(result.xpBar.label)}</small>` : ""}
        ${result.rankUp ? `<div class="gp-res-rankup"><i class="fas fa-angles-up"></i> Rank ${result.rankUp}!</div>` : ""}
      </div>` : "";
    return `<div class="gp-res">
        ${result.auto ? `<div class="gp-res-note pop" ${delay()}><i class="fas fa-star"></i> Grandmaster's Touch: automatic Masterful extraction</div>` : `<div class="gp-res-dice pop" ${delay()}>
          <span class="gp-die d20" data-final="${result.d20}">${result.d20}</span>
          <span class="gp-op">${escape(sign(result.modifier))}</span>
          ${result.toolBonus ? `<span class="gp-op">+ ${result.toolBonus}</span>` : ""}
          ${result.die ? `<span class="gp-op">+</span><span class="gp-die" data-final="${result.dieRoll}" title="d${result.die}">${result.dieRoll}</span>` : ""}
          ${result.skillBonus ? `<span class="gp-op" title="Skills and assist">+ ${result.skillBonus}</span>` : ""}
          <span class="gp-op">=</span><strong class="gp-total">${result.total}</strong>
          <span class="gp-vs">vs DC ${result.target}</span>
        </div>`}
        <div class="gp-res-tier tier-${escape(result.degree.id)} pop" ${delay()}>${escape(result.degree.label)}<small>margin ${result.degree.margin >= 0 ? "+" : ""}${result.degree.margin}</small></div>
        <div class="gp-res-items">${items}${rares}${nothing}</div>
        ${result.rare?.trigger ? `<div class="gp-res-note rare pop" ${delay()}><i class="fas fa-star"></i> Rare find! ${escape(result.rare.trigger)}${result.rare.tier ? ` · Tier ${result.rare.tier}` : ""}${result.rare.climbs ? ` <i class="fas fa-angles-up" title="Climbed ${result.rare.climbs} tier${result.rare.climbs === 1 ? "" : "s"}"></i>` : ""}</div>` : ""}
        ${result.rare?.story ? `<div class="gp-res-note rare pop" ${delay()}><i class="fas fa-scroll"></i> Something more lies hidden here… the GM will reveal it.</div>` : ""}
        ${result.rare?.pending ? `<div class="gp-res-note rare pop" ${delay()}><button type="button" class="gp-climb-roll" data-gp-climb="${escape(result.rare.climbId)}" data-gp-actor="${escape(result.rare.actorUuid)}"><i class="fas fa-dice-d20"></i> Roll the Fortune die to climb past tier ${result.rare.tier}</button></div>` : ""}
        ${rareTexts}
        ${(result.notes ?? []).map(note => `<div class="gp-res-note pop" ${delay()}><i class="fas fa-star-half-stroke"></i> ${escape(note)}</div>`).join("")}
        ${xp}
      </div>`;
  }).join("");
  return `<h3>${escape(actor?.name ?? "")} gathered</h3>${blocks}`;
}

/** XP bar data after a gain: position within the current rank. */
export function xpProgress(xpAfter, gained, rank) {
  const thresholds = activeRules().rankXp;
  if (!rank) return null;
  const start = thresholds[rank - 1] ?? 0;
  const next = thresholds[rank];
  if (next === undefined) return { from: 100, to: 100, label: "Max rank" };
  const span = Math.max(1, next - start);
  const to = Math.min(100, Math.max(0, ((xpAfter - start) / span) * 100));
  const from = Math.min(to, Math.max(0, ((xpAfter - gained - start) / span) * 100));
  return { from: Math.round(from), to: Math.round(to), label: `${xpAfter} / ${next} XP to rank ${rank + 1}` };
}

/* ---------------------------------------------------------------------- */
/* Application                                                             */
/* ---------------------------------------------------------------------- */

const windows = new Map();
let WindowClass = null;

function ownedCharacters() {
  return Array.from(game.actors ?? []).filter(actor => actor.type === "character" && (game.user.isGM || actor.isOwner))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultActor() {
  const owned = ownedCharacters();
  const token = (canvas?.tokens?.controlled ?? []).map(entry => entry.actor).find(actor => actor && owned.includes(actor));
  if (token) return token;
  if (game.user.character && owned.includes(game.user.character)) return game.user.character;
  return game.user.isGM ? null : owned[0] ?? null;
}

/** Ask the active GM to record discovered materials on a node (party-wide). */
export async function recordDiscovery(page, uuids, actor = null) {
  const fresh = [...new Set(uuids)].filter(uuid => uuid && !discoveredSet(page).has(uuid));
  if (!fresh.length) return;
  if (game.user.isGM) {
    await page.setFlag(MODULE_ID, "discovered", [...discoveredSet(page), ...fresh]);
    return;
  }
  if (!actor?.isOwner) throw new Error("Choose a character you own to record discoveries.");
  await actor.setFlag(MODULE_ID, "discoveryRequest", { pageUuid: page.uuid, uuids: fresh,
    requestId: foundry.utils.randomID() });
}

function defineClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class GatheringWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["gathering-professions-ui", "gp-gathering-window"],
      tag: "div",
      window: { title: "Gathering", icon: "fas fa-hand-sparkles", resizable: false },
      position: { width: 470, height: "auto" }
    };

    constructor(page, options = {}) {
      super({ ...options, id: `gp-gather-${page.id}` });
      this.page = page;
      this.view = { busy: false, resultHtml: "", animate: false, actorId: defaultActor()?.id ?? null };
      this.hookIds = [];
      this.refreshTimer = null;
      this.refreshRunning = false;
      this.refreshDirty = false;
      this.refreshClosed = false;
    }

    get title() { return this.page.name; }

    get actor() {
      const actor = this.view.actorId ? game.actors.get(this.view.actorId) : null;
      return actor && (game.user.isGM || actor.isOwner) ? actor : null;
    }

    async _prepareContext() { return {}; }

    async _renderHTML() {
      this.refreshDirty = false;
      const model = buildGatherModel(this.page, this.actor, { isGM: game.user.isGM });
      const html = renderGatherWindow(model, { ...this.view, characters: ownedCharacters() });
      this.view.animate = false;
      return html;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      content.querySelectorAll(".gp-gw-result.animate .gp-die[data-final]").forEach(die => this.#shuffle(die));
    }

    #shuffle(element) {
      const final = element.dataset.final;
      const faces = element.classList.contains("d20") ? 20 : Math.max(4, Number(element.title?.replace("d", "")) || 6);
      let ticks = 0;
      const timer = setInterval(() => {
        element.textContent = String(1 + Math.floor(Math.random() * faces));
        if (++ticks >= 12) { clearInterval(timer); element.textContent = final; element.classList.add("landed"); }
      }, 55);
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("click", event => {
        const climb = event.target.closest?.("[data-gp-climb]");
        if (climb && !climb.disabled) {
          climb.disabled = true;
          void game.modules.get(MODULE_ID).api.rareFinds.climb(climb.dataset.gpActor, climb.dataset.gpClimb)
            .then(result => { if (result) climb.innerHTML = '<i class="fas fa-check"></i> Rolled — see chat'; else climb.disabled = false; })
            .catch(error => { climb.disabled = false; report(error); });
          return;
        }
        const button = event.target.closest?.("[data-act]");
        if (button && !button.disabled) void this.#onAction(button.dataset.act, button).catch(report);
      });
      this.element.addEventListener("change", event => {
        if (event.target.matches?.("[data-act-change='masterful']")) {
          this.view.masterful = event.target.checked;
          return;
        }
        if (event.target.matches?.("[data-act-change='careful']")) {
          this.view.careful = event.target.checked;
          return;
        }
        if (event.target.matches?.("[data-act-change='familiar']")) {
          const key = event.target.value;
          if (!key || !this.actor) return;
          void game.modules.get(MODULE_ID).api.gather.setFamiliarBiome(this.actor, key)
            .then(() => ui.notifications.info(`${this.actor.name} knows this kind of ground well.`)).catch(report);
          return;
        }
        if (event.target.matches?.("[data-act-change='actor']")) {
          this.view.masterful = false;
          this.view.careful = false;
          this.view.actorId = event.target.value || null;
          this.view.resultHtml = "";
          void this.render();
        }
      });
      // Batch hook bursts and never overlap renders or interrupt a gather.
      const rerender = () => {
        if (this.refreshClosed || !this.rendered) return;
        this.refreshDirty = true;
        if (this.refreshTimer !== null || this.refreshRunning || this.view.busy) return;
        this.refreshTimer = setTimeout(async () => {
          this.refreshTimer = null;
          if (this.refreshClosed || !this.rendered || this.view.busy) return;
          this.refreshDirty = false;
          this.refreshRunning = true;
          try { await this.render(); }
          catch (error) { report(error); }
          finally {
            this.refreshRunning = false;
            if (this.refreshDirty) rerender();
          }
        }, 50);
      };
      const listen = (hook, callback) => this.hookIds.push([hook, Hooks.on(hook, callback)]);
      const tableUuids = () => [this.page.flags?.gatherer?.table, readNode(this.page)?.rareTable].filter(Boolean);
      const relevantItem = item => {
        if (item.parent) return item.parent.id === this.view.actorId;
        if (tableUuids().some(uuid => Array.from(globalThis.fromUuidSync?.(uuid)?.results ?? []).some(result => result.documentUuid === item.uuid))) return true;
        const node = readNode(this.page);
        const professions = pageProfessions(this.page, node);
        return (professions.length ? professions : [null]).some(key => requiredTools(node, key)
          .some(tool => tool.uuid === item.uuid || tool.name?.toLowerCase() === item.name?.toLowerCase()));
      };
      listen("updateJournalEntryPage", page => { if (page.uuid === this.page.uuid) rerender(); });
      // Re-render for the chosen actor, and when anyone offers or withdraws an Assist.
      this.hookIds.push(["updateActor", Hooks.on("updateActor", (actor, changes) => {
        const flags = changes?.flags?.[MODULE_ID] ?? {};
        if (actor.id === this.view.actorId || "assist" in flags || "-=assist" in flags) rerender();
      })]);
      for (const hook of ["createItem", "updateItem", "deleteItem"]) listen(hook, item => { if (relevantItem(item)) rerender(); });
      for (const hook of ["updateRollTable", "deleteRollTable"]) listen(hook, table => { if (tableUuids().includes(table.uuid)) rerender(); });
      for (const hook of ["createTableResult", "updateTableResult", "deleteTableResult"]) listen(hook, result => {
        if (tableUuids().includes(result.parent?.uuid)) rerender();
      });
      const settings = new Set(["rules", "professions", "biomes", "conditionOverrides", "conditionDc", "skillTree"].map(key => `${MODULE_ID}.${key}`));
      settings.add("simple-timekeeping.configuration");
      listen("updateSetting", setting => { if (settings.has(setting?.key)) rerender(); });
      listen("updateScene", (scene, changes) => {
        if (scene.id !== nodeScene(this.page, pinsFor)?.id) return;
        const flags = changes?.flags?.[MODULE_ID];
        if ((flags && ("biome" in flags || "-=biome" in flags))
          || Object.hasOwn(changes ?? {}, `flags.${MODULE_ID}.biome`)
          || Object.hasOwn(changes ?? {}, `flags.${MODULE_ID}.-=biome`)) rerender();
      });
      const timeState = () => JSON.stringify([
        currentConditions({ node: readNode(this.page), scene: nodeScene(this.page, pinsFor) }),
        refillText(this.page, nodeUsage(this.page))
      ]);
      let previousTimeState = timeState();
      listen("updateWorldTime", () => {
        const state = timeState();
        if (state === previousTimeState) return;
        previousTimeState = state;
        rerender();
      });
      this.hookIds.push(["controlToken", Hooks.on("controlToken", (token, controlled) => {
        if (!controlled || this.view.busy || !token.actor || !ownedCharacters().includes(token.actor)) return;
        this.view.actorId = token.actor.id;
        rerender();
      })]);
      listen("deleteJournalEntryPage", page => { if (page.uuid === this.page.uuid) void this.close(); });
    }

    _onClose(options) {
      this.refreshClosed = true;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
      super._onClose?.(options);
      for (const [hook, id] of this.hookIds) Hooks.off(hook, id);
      windows.delete(this.page.uuid);
    }

    async #onAction(act, button = null) {
      const api = game.modules.get(MODULE_ID).api;
      switch (act) {
        case "gather": return this.#gather();
        case "last-pull": {
          if (!this.actor) return;
          await api.gather.lastPull(this.actor, this.page);
          ui.notifications.info(`Last Pull: one more pull at ${this.page.name} for ${this.actor.name}.`);
          return this.#gather();
        }
        case "repair": {
          const item = this.actor?.items.get(button?.dataset.item);
          if (!item) return;
          const result = await api.gather.fieldRepair(this.actor, item);
          ui.notifications.info(`Field Repair: ${item.name} ${result.after}/${result.max}.`);
          return this.render();
        }
        case "assist": {
          const actor = this.actor;
          if (!actor) return;
          if (activeOffer(actor, this.page)) {
            await withdrawAssist(actor);
            return ui.notifications.info(`${actor.name} is no longer assisting at ${this.page.name}.`);
          }
          await offerAssist(actor, this.page);
          return ui.notifications.info(`${actor.name} is ready to assist the next gather at ${this.page.name}.`);
        }
        case "edit": return openNodeManager({ select: this.page.uuid, tab: "basics" });
        case "refill": await resetNodes([this.page]); return ui.notifications.info(`Refilled ${this.page.name}.`);
        case "toggle": return setNodeHidden([this.page], !readNode(this.page)?.hidden);
        case "page": return this.page.parent?.sheet?.render(true, { pageId: this.page.id });
      }
    }

    async #gather() {
      const actor = this.actor;
      const Sheet = globalThis.gatherer;
      if (!actor || !Sheet || this.view.busy) return;
      this.view.busy = true;
      this.view.resultHtml = "";
      await this.render();

      let started = false;
      const startId = Hooks.on("gathererGather", data => { if (data.actor === actor) started = true; });
      let completeId = null;
      let timeout = null;
      const completed = new Promise(resolve => {
        completeId = Hooks.on("gatheringProfessionsGatherComplete", payload => {
          if (payload.page?.uuid === this.page.uuid && payload.actor?.id === actor.id) resolve(payload);
        });
        // Long enough for the Second Look prompt to be answered.
        timeout = setTimeout(() => resolve(null), 300000);
      });
      try {
        const sheet = new Sheet({ document: this.page });
        await sheet.getGathererData();
        const api = game.modules.get(MODULE_ID).api;
        if (this.view.masterful || this.view.careful) api.gather.setIntent(actor, { masterful: Boolean(this.view.masterful), careful: Boolean(this.view.careful) });
        await sheet._onGather(true, null, actor, null);
      } catch (error) {
        report(error);
      } finally {
        Hooks.off("gathererGather", startId);
        game.modules.get(MODULE_ID).api.gather.clearIntent(actor);
        this.view.masterful = false;
        this.view.careful = false;
      }
      const payload = started ? await completed : null;
      Hooks.off("gatheringProfessionsGatherComplete", completeId);
      clearTimeout(timeout);
      this.view.busy = false;
      if (payload) {
        this.view.resultHtml = renderResults(payload.results, actor);
        this.view.animate = true;
        const found = payload.results.filter(result => result.quantity > 0 && result.item?.uuid).map(result => result.item.uuid);
        void recordDiscovery(this.page, found, actor).catch(report);
      }
      if (this.rendered) await this.render();
      this.element?.querySelector("[data-result]")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  };
}

/** Open (or focus) the gathering window for a Gatherer page. */
export async function openGatheringWindow(page) {
  if (!page) return null;
  WindowClass ??= defineClass();
  let app = windows.get(page.uuid);
  if (!app) {
    app = new WindowClass(page);
    windows.set(page.uuid, app);
  }
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}
