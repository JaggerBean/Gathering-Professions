// Recipes window: one tab per recipe provider (refining per gathering
// profession, plus crafting professions from other modules), products grouped
// with their recipes, have/need counts, success chance, batch crafting, timed
// jobs, GM controls and inline editor, and an experiment panel for providers
// that support it.
import { MODULE_ID } from "./rules.js";
import { successChance, formatDuration } from "./gather-ui.js";
import { gpDialog } from "./dialogs.js";
import { inventoryCount, maxBatch, actorJobs, deliverDueJobs, formatMinutes, productItem, itemPickerGroups } from "./refining.js";
import { recipeProviders, providerFor } from "./recipe-registry.js";

const FALLBACK_ICON = "icons/svg/item-bag.svg";
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Crafting failed.");
}

const imgFor = name => productItem(name)?.img || Array.from(game.items ?? []).find(item => item.name === name)?.img || FALLBACK_ICON;

/* ---------------------------------------------------------------------- */
/* Model (pure apart from game lookups; unit tested)                       */
/* ---------------------------------------------------------------------- */

/**
 * @param {Actor|null} actor
 * @param {{isGM?: boolean, tab?: string, onlyCraftable?: boolean, search?: string, now?: number}} options
 */
export function buildRecipesModel(actor, { isGM = false, tab = "", onlyCraftable = false, search = "", now = game.time?.worldTime ?? 0 } = {}) {
  const providers = recipeProviders().filter(entry => entry.visible?.(actor, isGM) ?? true);
  const provider = providers.find(entry => entry.key === tab) ?? providers[0] ?? null;
  const query = search.trim().toLowerCase();
  const tabs = providers.map(entry => {
    const rows = entry.recipes({});
    return { key: entry.key, label: entry.label, verb: entry.verb, icon: entry.icon, total: rows.length,
      known: rows.filter(row => entry.isKnown(row, actor)).length, active: entry === provider };
  });
  const groups = new Map();
  for (const row of provider ? provider.recipes({ includeDisabled: isGM }) : []) {
    const done = Boolean(provider.isDone?.(row, actor));
    if (done && !isGM) continue;
    const known = provider.isKnown(row, actor);
    const key = row.group ?? row.output;
    const group = groups.get(key) ?? { name: row.groupLabel ?? row.group ?? row.output, img: row.groupImg ?? imgFor(row.output), tier: row.tier, recipes: [], hidden: 0 };
    groups.set(key, group);
    group.tier = Math.min(group.tier, row.tier);
    if (!known && !isGM) { group.hidden++; continue; }
    const inputs = row.inputs.map(([name, need], index) => {
      const have = actor ? inventoryCount(actor, name) : 0;
      return { name, img: imgFor(name), need, have, ok: have >= need, mode: row.inputMeta?.[index]?.mode ?? null, reason: row.inputMeta?.[index]?.reason ?? "" };
    });
    const max = actor ? maxBatch(actor, row) : 0;
    const blocked = actor ? provider.blocked?.(actor, row) ?? null : null;
    let chance = null;
    let target = null;
    const check = actor ? provider.check?.(actor, row) ?? null : null;
    if (check) {
      target = check.target;
      chance = Math.round(successChance(check.modifier, check.die ?? 0, check.target, check.extraDice ?? []) * 100);
    }
    const minutes = provider.minutes(row);
    group.recipes.push({ id: row.id, tier: row.tier, quantity: row.quantity, inputs, max: row.noBatch ? Math.min(max, 1) : max, chance, target, known, blocked, done,
      title: row.title ?? "", brief: row.brief ?? "", rewardText: row.rewardText ?? "", actionLabel: row.actionLabel ?? "", noBatch: Boolean(row.noBatch),
      learn: provider.learnState(row, actor), disabled: Boolean(row.disabled), edited: Boolean(row.edited), custom: Boolean(row.custom),
      minutes, time: formatMinutes(minutes), ownTime: row.minutes !== undefined && row.minutes !== null });
  }
  let products = [...groups.values()].filter(group => group.recipes.length)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  if (query) products = products.filter(group => group.name.toLowerCase().includes(query)
    || group.recipes.some(row => row.inputs.some(input => input.name.toLowerCase().includes(query))));
  if (onlyCraftable) products = products.map(group => ({ ...group, recipes: group.recipes.filter(row => row.max > 0 && !row.blocked) })).filter(group => group.recipes.length);
  const jobs = actor ? actorJobs(actor).map(job => ({ ...job, img: job.img || imgFor(job.name), done: job.ready <= now, left: formatDuration(Math.max(0, job.ready - now)) })) : [];
  return {
    tabs, active: provider?.key ?? "", verb: provider?.verb ?? "", action: provider?.action ?? "Make", rollLabel: provider?.rollLabel ?? "",
    learnOptions: provider?.learnOptions ?? [], learnHint: provider?.learnHint ?? "", perCharacter: Boolean(provider?.perCharacter),
    hiddenHint: provider?.hiddenHint ?? "Not yet discovered", hiddenWord: provider?.hiddenWord ?? "unknown", emptyText: provider?.emptyText ?? "No recipes known yet.",
    gmHint: provider?.gmHint ?? "", canEdit: Boolean(provider?.gm?.create), canScroll: Boolean(provider?.gm?.scroll),
    experiment: Boolean(provider?.experiment), products, jobs, isGM,
    panel: provider?.panel ? provider.panel(actor, isGM) : "", providerKey: provider?.key ?? "",
    carried: actor && provider?.carried ? provider.carried(actor) : [], carriedLabel: provider?.carriedLabel ?? "Recipe scrolls you carry", carriedAction: provider?.carriedAction ?? "Learn",
    actor: actor ? { id: actor.id, name: actor.name, img: actor.img } : null
  };
}

/* ---------------------------------------------------------------------- */
/* Render                                                                  */
/* ---------------------------------------------------------------------- */

function chanceWord(chance) {
  if (chance === null) return "";
  const word = chance >= 85 ? "Sure" : chance >= 60 ? "Likely" : chance >= 35 ? "Even" : chance >= 15 ? "Risky" : "Long shot";
  return `<span class="gp-rw-chance gp-chance-${word.toLowerCase().replace(" ", "-")}" title="Chance of a success or better">${chance}% · ${word}</span>`;
}

function gmControls(row, model) {
  if (!model.isGM) return "";
  const needsActor = model.perCharacter && !model.actor;
  const learnOption = ([value, label]) => `<option value="${value}" ${row.learn === value ? "selected" : ""}>${label}</option>`;
  const seeTitle = model.perCharacter ? (row.known ? `${model.actor?.name ?? "This character"} knows this recipe` : "Not known") : (row.known ? "The party knows this recipe" : "Hidden from players");
  return `<div class="gp-rw-gm">
      <span class="gp-rw-known ${row.known ? "yes" : "no"}" title="${escape(seeTitle)}"><i class="fas ${row.known ? "fa-eye" : "fa-eye-slash"}"></i></span>
      <select data-learn="${escape(row.id)}" ${needsActor ? "disabled" : ""} title="${escape(needsActor ? "Choose a character above to grant recipes" : model.learnHint)}">${model.learnOptions.map(learnOption).join("")}</select>
      ${model.canEdit ? `<button type="button" data-act="edit-recipe" data-recipe="${escape(row.id)}" title="Edit recipe"><i class="fas fa-pen"></i></button>` : ""}
      ${model.canScroll ? `<button type="button" data-act="make-scroll" data-recipe="${escape(row.id)}" title="Make a recipe scroll Item (for loot or shops)"><i class="fas fa-scroll"></i></button>` : ""}
      ${row.custom ? `<button type="button" data-act="delete-recipe" data-recipe="${escape(row.id)}" title="Delete your recipe"><i class="fas fa-trash"></i></button>`
        : model.canEdit ? `<button type="button" class="${row.disabled ? "gp-rw-enable" : ""}" data-act="toggle-recipe" data-recipe="${escape(row.id)}" title="${row.disabled ? "Enable this recipe again" : "Disable for everyone"}"><i class="fas ${row.disabled ? "fa-toggle-off" : "fa-toggle-on"}"></i>${row.disabled ? " Enable" : ""}</button>
           ${row.edited ? `<button type="button" data-act="reset-recipe" data-recipe="${escape(row.id)}" title="Reset to the module's default"><i class="fas fa-rotate-left"></i></button>` : ""}` : ""}
      ${row.custom ? '<span class="gp-rw-tag">Yours</span>' : row.disabled ? '<span class="gp-rw-tag off">Disabled</span>' : row.edited ? '<span class="gp-rw-tag">Edited</span>' : ""}
    </div>`;
}

function recipeRow(row, model, state) {
  const MODES = { used: "used up", kept: "kept", risk: "kept, at risk on a bad failure" };
  const inputs = row.inputs.map(input => `<span class="gp-rw-input ${input.ok ? "ok" : "missing"} ${input.mode ? `mode-${escape(input.mode)}` : ""}" title="${escape(input.name)}: have ${input.have}, need ${input.need}${input.mode ? ` (${MODES[input.mode] ?? input.mode})` : ""}${input.reason ? ` — ${escape(input.reason)}` : ""}">
      <img src="${escape(input.img)}" alt=""><span>${input.need}× ${escape(input.name)}</span><small>${input.have}</small>${input.mode && input.mode !== "used" ? `<i class="fas ${input.mode === "risk" ? "fa-triangle-exclamation" : "fa-rotate"} gp-rw-mode" title="${escape(MODES[input.mode])}"></i>` : ""}</span>`).join(row.reasons ? "" : '<i class="fas fa-plus gp-rw-plus"></i>');
  const reasons = row.inputs.some(input => input.reason) ? `<ul class="gp-rw-reasons">${row.inputs.filter(input => input.reason).map(input => `<li><strong>${escape(input.name)}</strong> — ${escape(input.reason)}${input.mode && input.mode !== "used" ? ` <em>(${escape(MODES[input.mode])})</em>` : ""}</li>`).join("")}</ul>` : "";
  const batch = Math.min(Math.max(1, Number(state.batch?.[row.id]) || 1), Math.max(1, row.max));
  const canCraft = model.actor && row.max > 0 && !row.blocked && !state.busy && !row.disabled;
  const why = !model.actor ? "Choose a character" : row.blocked ? row.blocked : row.max > 0 ? `Up to ${row.max}` : "Not enough materials";
  return `<div class="gp-rw-recipe ${canCraft ? "craftable" : ""} ${row.disabled ? "gp-rw-off" : ""}">
      ${row.title || row.brief ? `<div class="gp-rw-titlebox">${row.title ? `<strong class="gp-rw-title">${escape(row.title)}</strong>` : ""}${row.done ? ' <span class="gp-rw-tag">Completed</span>' : ""}${row.brief ? `<p class="gp-rw-brief">${escape(row.brief)}</p>` : ""}</div>` : ""}
      <div class="gp-rw-inputs">${row.title ? '<span class="gp-rw-bring">Bring:</span>' : ""}${inputs}${row.rewardText ? `<i class="fas fa-arrow-right gp-rw-arrow"></i><span class="gp-rw-out">${escape(row.rewardText)}</span>` : `<i class="fas fa-arrow-right gp-rw-arrow"></i><span class="gp-rw-out">${row.quantity}×</span>`}</div>
      ${reasons}
      <div class="gp-rw-meta">
        <span class="gp-tier-badge tier-${row.tier}">T${row.tier}</span>
        ${row.target !== null ? `<span title="Check DC">DC ${row.target}</span>` : ""}
        ${chanceWord(row.chance)}
        <span title="${row.ownTime ? "Time per unit (this recipe)" : "Time per unit (tier default)"}"><i class="fas fa-hourglass-half"></i> ${escape(row.minutes ? row.time : "Instant")}</span>
        ${row.blocked ? `<span class="gp-rw-blocked" title="${escape(row.blocked)}"><i class="fas fa-lock"></i> ${escape(row.blocked)}</span>` : ""}
      </div>
      ${gmControls(row, model)}
      <div class="gp-rw-make">
        ${row.noBatch ? "" : `<input type="number" min="1" max="${Math.max(1, row.max)}" value="${batch}" data-batch="${escape(row.id)}" ${row.max > 1 ? "" : "disabled"} aria-label="How many">`}
        <button type="button" class="gp-rw-craft" data-act="craft" data-recipe="${escape(row.id)}" ${canCraft ? "" : "disabled"} title="${escape(why)}"><i class="fas fa-hammer"></i> ${escape(row.actionLabel || model.action)}</button>
      </div>
    </div>`;
}

/** Experiment panel: put inventory items in and try (providers with experiment()). */
export function renderExperiment(model, experiment = {}, inventory = []) {
  if (!model.experiment || !model.actor) return "";
  const names = experiment.names ?? [];
  const query = String(experiment.search ?? "").trim().toLowerCase();
  const choices = inventory.filter(item => !names.includes(item.name) && (!query || item.name.toLowerCase().includes(query)));
  const picker = experiment.picker ? `<div class="gp-rw-picker">
      <input type="search" class="gp-rw-picksearch" data-exp="search" value="${escape(experiment.search ?? "")}" placeholder="Search ${escape(model.actor.name)}'s inventory" data-focus-key="exp">
      <div class="gp-rw-picktiles">${choices.map(item => `<button type="button" class="gp-rw-picktile" data-act="exp-add" data-name="${escape(item.name)}" title="${escape(item.name)} (${item.quantity})"><img src="${escape(item.img)}" alt=""><span>${escape(item.name)}</span><small>${item.quantity}</small></button>`).join("") || '<p class="gp-rw-empty">Nothing else to add.</p>'}</div>
    </div>` : "";
  const result = experiment.result ? `<p class="gp-rw-expresult ${escape(experiment.result.kind)}"><i class="fas ${experiment.result.kind === "learned" ? "fa-lightbulb" : experiment.result.kind === "warm" ? "fa-fire-flame-curved" : "fa-wind"}"></i> ${escape(experiment.result.message)}</p>` : "";
  return `<section class="gp-rw-experiment" data-drop-slot="experiment" title="Drag items from ${escape(model.actor.name)}'s sheet here">
      <h4><i class="fas fa-flask"></i> Experiment <small>Try combining items to discover a recipe. Nothing is used up.</small></h4>
      <div class="gp-rw-expslots">${names.map((name, index) => `<span class="gp-rw-input ok"><img src="${escape(imgFor(name))}" alt=""><span>${escape(name)}</span>
        <button type="button" class="gp-rw-iconbtn" data-act="exp-remove" data-index="${index}" title="Take out"><i class="fas fa-xmark"></i></button></span>`).join("")}
        ${names.length < 6 ? `<button type="button" class="gp-rw-addinput" data-act="exp-pick"><i class="fas fa-plus"></i> Add item</button>` : ""}
        <button type="button" class="gp-rw-craft" data-act="exp-try" ${names.length ? "" : "disabled"}><i class="fas fa-flask"></i> Try</button></div>
      ${picker}${result}
    </section>`;
}

/** Items the character carries that teach recipes (scrolls), each with a Learn button. */
export function renderCarried(model) {
  if (!model.carried?.length) return "";
  return `<section class="gp-rw-carried"><h4><i class="fas fa-scroll"></i> ${escape(model.carriedLabel)}</h4>
      ${model.carried.map(entry => `<div class="gp-rw-carry"><img src="${escape(entry.img || FALLBACK_ICON)}" alt=""><span>${escape(entry.name)}</span>
        ${entry.note ? `<small>${escape(entry.note)}</small>` : ""}
        <button type="button" class="gp-rw-craft" data-act="use-carried" data-item="${escape(entry.id)}" ${entry.disabled ? "disabled" : ""} title="${escape(entry.note || model.carriedAction)}"><i class="fas fa-book-open-reader"></i> ${escape(model.carriedAction)}</button></div>`).join("")}
    </section>`;
}

export function renderRecipesWindow(model, state = {}) {
  const characters = state.characters ?? [];
  const who = characters.length
    ? `<select data-act-change="actor" aria-label="Character">${model.isGM ? '<option value="">— GM view —</option>' : ""}${characters.map(actor =>
      `<option value="${escape(actor.id)}" ${actor.id === model.actor?.id ? "selected" : ""}>${escape(actor.name)}</option>`).join("")}</select>`
    : '<span class="gp-rw-noactor">No character</span>';
  const tabs = model.tabs.map(tab => `<button type="button" class="gp-rw-tab ${tab.active ? "active" : ""}" data-act="tab" data-tab="${escape(tab.key)}" title="${escape(tab.label)}">
      <i class="fas ${escape(tab.icon)}"></i> ${escape(tab.verb)} <small>${tab.known}/${tab.total}</small></button>`).join("");
  const cards = model.products.map(group => `<section class="gp-rw-card">
      <header><img src="${escape(group.img)}" alt=""><strong>${escape(group.name)}</strong>
        ${group.recipes.length > 1 ? `<small>${group.recipes.length} recipes</small>` : ""}
        ${group.hidden ? `<em class="gp-rw-more" title="${escape(model.hiddenHint)}"><i class="fas fa-question"></i> ${group.hidden} more ${escape(model.hiddenWord)}</em>` : ""}</header>
      ${group.recipes.map(row => recipeRow(row, model, state) + (state.editing?.id === row.id ? renderEditor(state.editing, state.editorItems) : "")).join("")}
    </section>`).join("");
  const empty = state.onlyCraftable ? "Nothing you can make right now." : model.emptyText;
  const jobs = model.jobs.length ? `<section class="gp-rw-jobs"><h4><i class="fas fa-hourglass-half"></i> In progress</h4>
      ${model.jobs.map(job => `<div class="gp-rw-job ${job.done ? "done" : ""}"><img src="${escape(job.img)}" alt=""><span>${job.quantity}× ${escape(job.name)}</span>
        <small>${job.done ? "Ready" : `${escape(job.left)} left`}</small></div>`).join("")}
      ${model.jobs.some(job => job.done) && state.canCollect ? '<button type="button" data-act="collect"><i class="fas fa-box-open"></i> Collect finished work</button>' : ""}
    </section>` : "";
  const gmBar = model.isGM && model.active ? `<div class="gp-rw-gmbar">${model.canEdit ? `<button type="button" data-act="new-recipe"><i class="fas fa-plus"></i> New ${escape(model.verb.toLowerCase())} recipe</button>` : ""}<span>${escape(model.gmHint)}</span></div>` : "";
  return `<div class="gp-rw">
    <header class="gp-rw-head">
      ${model.actor ? `<img class="gp-rw-portrait" src="${escape(model.actor.img || FALLBACK_ICON)}" alt="">` : ""}
      <div class="gp-rw-who">${who}${model.rollLabel ? `<small>${escape(model.rollLabel)}</small>` : ""}</div>
      <label class="gp-rw-filter"><input type="checkbox" data-act-change="craftable" ${state.onlyCraftable ? "checked" : ""}> Can make now</label>
      <input type="search" class="gp-rw-search" data-act-change="search" placeholder="Search" value="${escape(state.search ?? "")}">
    </header>
    <nav class="gp-rw-tabs">${tabs || '<span class="gp-rw-noactor">No recipes available yet.</span>'}</nav>
    ${jobs}
    ${gmBar}
    ${model.panel ? `<section class="gp-rw-panel" data-panel="${escape(model.providerKey)}">${model.panel}</section>` : ""}
    ${renderCarried(model)}
    ${renderExperiment(model, state.experiment, state.inventory)}
    <div class="gp-rw-list">${state.editing && !state.editing.id ? `<section class="gp-rw-card">${renderEditor(state.editing, state.editorItems)}</section>` : ""}${cards || `<p class="gp-rw-empty">${escape(empty)}</p>`}</div>
  </div>`;
}

/* ---------------------------------------------------------------------- */
/* Inline recipe editor (GM)                                               */
/* ---------------------------------------------------------------------- */

const MAX_INPUTS = 6;

/** Editor state for a recipe (row) or a new one on a provider's tab. */
export function editorDraft(row, providerKey) {
  return { id: row?.id ?? null, profession: providerKey, tier: row?.tier ?? 1, output: row?.output ?? "", quantity: row?.quantity ?? 1,
    minutes: row?.minutes ?? "",
    inputs: (row?.inputs?.length ? row.inputs : [["", 1]]).map(([name, quantity]) => [name, quantity]), picker: null, search: "" };
}

/** Picker groups for the editor: the provider's own groups, else Other items. */
export function itemOptions(providerKey, search = "") {
  const provider = providerFor(providerKey);
  return provider?.itemGroups ? provider.itemGroups(search) : itemPickerGroups(search, []);
}

function slotButton(slot, name, picking) {
  return `<button type="button" class="gp-rw-slot ${name ? "" : "empty"} ${picking ? "open" : ""}" data-act="pick" data-slot="${slot}" data-drop-slot="${slot}"
      title="Click to choose, or drag an Item from the Items sidebar here">${name ? `<img src="${escape(imgFor(name))}" alt=""><span>${escape(name)}</span>` : '<i class="fas fa-plus"></i><span>Choose an item</span>'}<i class="fas fa-caret-down gp-rw-caret"></i></button>`;
}

function pickerPanel(draft, groups) {
  return `<div class="gp-rw-picker">
      <input type="search" class="gp-rw-picksearch" data-draft="search" value="${escape(draft.search)}" placeholder="Search items" data-focus-key="picker">
      ${groups.map(group => `<div class="gp-rw-pickgroup"><h5>${escape(group.label)}</h5><div class="gp-rw-picktiles">
        ${group.items.map(item => `<button type="button" class="gp-rw-picktile" data-act="choose" data-name="${escape(item.name)}" title="${escape(item.name)}"><img src="${escape(item.img)}" alt=""><span>${escape(item.name)}</span></button>`).join("")}
        ${group.more ? `<em class="gp-rw-pickmore">+${group.more} more: type to search</em>` : ""}</div></div>`).join("") || '<p class="gp-rw-empty">No items match.</p>'}
    </div>`;
}

/** Inline editor shown under a recipe (or at the top for a new one). Pure; unit tested. */
export function renderEditor(draft, groups = []) {
  const provider = providerFor(draft.profession);
  const picker = slot => (draft.picker === slot ? pickerPanel(draft, groups) : "");
  const rows = draft.inputs.map(([name, quantity], index) => `<div class="gp-rw-editrow">
      ${slotButton(String(index), name, draft.picker === String(index))}
      <input type="number" min="1" max="99" value="${quantity}" data-draft="qty" data-index="${index}" aria-label="Quantity needed">
      <button type="button" class="gp-rw-iconbtn" data-act="remove-input" data-index="${index}" title="Remove ingredient" ${draft.inputs.length > 1 ? "" : "disabled"}><i class="fas fa-xmark"></i></button>
    </div>${picker(String(index))}`).join("");
  return `<div class="gp-rw-edit">
    <div class="gp-rw-edithead"><strong>${draft.id ? "Edit recipe" : "New recipe"}</strong>
      <span class="gp-rw-editopts">
        <label>Tier <select data-draft="tier">${[1, 2, 3, 4, 5].map(tier => `<option value="${tier}" ${tier === Number(draft.tier) ? "selected" : ""}>${tier}</option>`).join("")}</select></label>
        <label title="Minutes per unit. Blank = the tier's default (60 = 1 hour, 1440 = 1 day, 0 = instant)">Time <input type="number" min="0" max="10080" step="1" data-draft="minutes" data-focus-key="minutes" value="${escape(draft.minutes ?? "")}" placeholder="${escape(provider?.defaultMinutes?.(Number(draft.tier)) ?? "")}"> min</label>
      </span></div>
    <div class="gp-rw-editlabel">Makes</div>
    <div class="gp-rw-editrow">${slotButton("output", draft.output, draft.picker === "output")}
      <input type="number" min="1" max="99" value="${draft.quantity}" data-draft="quantity" aria-label="Quantity made"></div>
    ${picker("output")}
    <div class="gp-rw-editlabel">From</div>
    ${rows}
    ${draft.inputs.length < MAX_INPUTS ? '<button type="button" class="gp-rw-addinput" data-act="add-input"><i class="fas fa-plus"></i> Add ingredient</button>' : ""}
    <div class="gp-rw-editactions">
      <button type="button" class="gp-rw-craft" data-act="save-edit"><i class="fas fa-check"></i> ${draft.id ? "Save" : "Create"}</button>
      <button type="button" data-act="cancel-edit">Cancel</button>
    </div>
  </div>`;
}

/** The draft as recipe fields for the provider. */
export function draftFields(draft) {
  return { profession: draft.profession, tier: Number(draft.tier), output: draft.output, quantity: Number(draft.quantity),
    minutes: String(draft.minutes ?? "").trim() === "" ? null : Number(draft.minutes),
    inputs: draft.inputs.filter(([name]) => String(name ?? "").trim()).map(([name, quantity]) => [name, Number(quantity)]) };
}

/* ---------------------------------------------------------------------- */
/* Window                                                                  */
/* ---------------------------------------------------------------------- */

function ownedCharacters() {
  return Array.from(game.actors ?? []).filter(actor => actor.type === "character" && (game.user.isGM ? actor.hasPlayerOwner || actor.isOwner : actor.isOwner))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultActor() {
  const owned = ownedCharacters();
  const token = (canvas?.tokens?.controlled ?? []).map(entry => entry.actor).find(actor => actor && owned.includes(actor));
  if (token) return token;
  if (game.user.character && owned.includes(game.user.character)) return game.user.character;
  return game.user.isGM ? null : owned[0] ?? null;
}

/** An actor's inventory as unique names with total quantity (experiment picker). */
export function inventoryChoices(actor) {
  const map = new Map();
  for (const item of Array.from(actor?.items ?? [])) {
    if (!["loot", "consumable", "tool", "weapon", "equipment", "container"].includes(item.type)) continue;
    const entry = map.get(item.name) ?? { name: item.name, img: item.img || FALLBACK_ICON, quantity: 0 };
    entry.quantity += Math.max(0, Number(item.system?.quantity) || 0);
    map.set(item.name, entry);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let RecipesClass = null;
let instance = null;
const freshExperiment = () => ({ names: [], picker: false, search: "", result: null });

function defineClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class RecipesWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "gathering-professions-recipes",
      classes: ["gathering-professions-ui", "gp-recipes-window"],
      tag: "div",
      window: { title: "Recipes", icon: "fas fa-book-open", resizable: true },
      position: { width: 640, height: 720 }
    };

    view = { actorId: defaultActor()?.id ?? null, tab: "", onlyCraftable: false, search: "", batch: {}, busy: false, editing: null, experiment: freshExperiment() };
    #hooks = [];
    #timer = null;

    get actor() {
      const actor = this.view.actorId ? game.actors.get(this.view.actorId) : null;
      return actor && (game.user.isGM || actor.isOwner) ? actor : null;
    }

    get provider() { return providerFor(this.view.tab); }

    async _prepareContext() { return {}; }

    async _renderHTML() {
      const model = buildRecipesModel(this.actor, { isGM: game.user.isGM, tab: this.view.tab, onlyCraftable: this.view.onlyCraftable, search: this.view.search });
      if (model.active !== this.view.tab) { this.view.tab = model.active; this.view.experiment = freshExperiment(); }
      const editing = game.user.isGM ? this.view.editing : null;
      const editorItems = editing?.picker ? itemOptions(editing.profession, editing.search) : [];
      return renderRecipesWindow(model, { ...this.view, editing, editorItems, inventory: this.view.experiment.picker ? inventoryChoices(this.actor) : [],
        characters: ownedCharacters(), canCollect: Boolean(this.actor) && !game.users?.activeGM });
    }

    _replaceHTML(result, content) {
      const active = document.activeElement;
      const key = active?.matches?.(".gp-rw-search") ? "search" : active?.dataset?.focusKey ?? null;
      const caret = key ? active.selectionStart : null;
      const scroll = content.querySelector(".gp-rw-list")?.scrollTop ?? 0;
      content.innerHTML = result;
      const list = content.querySelector(".gp-rw-list");
      if (list) list.scrollTop = scroll;
      const target = key === "search" ? content.querySelector(".gp-rw-search") : key ? content.querySelector(`[data-focus-key="${key}"]`) : null;
      if (target) { target.focus(); target.setSelectionRange?.(caret, caret); }
    }

    refresh() {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { if (this.rendered) void this.render(); }, 120);
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("click", event => {
        const button = event.target.closest?.("[data-act]");
        if (button && !button.disabled) void this.#onAction(button).catch(error => { this.view.busy = false; report(error); this.refresh(); });
      });
      this.element.addEventListener("change", event => this.#onChange(event.target));
      this.element.addEventListener("input", event => { if (event.target.matches?.(".gp-rw-search, .gp-rw-picksearch")) this.#onChange(event.target); });
      // Drag Items onto editor slots (from the sidebar) or the experiment panel (from the sheet).
      this.element.addEventListener("dragover", event => { if (event.target.closest?.("[data-drop-slot]")) event.preventDefault(); });
      this.element.addEventListener("drop", event => {
        const slot = event.target.closest?.("[data-drop-slot]");
        if (!slot) return;
        event.preventDefault();
        let data = null;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
        const item = data?.type === "Item" && data.uuid ? fromUuidSync(data.uuid) : null;
        if (!item?.name) return ui.notifications.warn("Drop an Item.");
        if (slot.dataset.dropSlot === "experiment") return this.#expAdd(item.name);
        if (this.view.editing) this.#choose(slot.dataset.dropSlot, item.name);
      });
      const mine = document => [document?.parent?.id, document?.id].includes(this.view.actorId);
      for (const hook of ["createItem", "updateItem", "deleteItem"]) this.#hooks.push([hook, Hooks.on(hook, item => { if (mine(item)) this.refresh(); })]);
      this.#hooks.push(["updateActor", Hooks.on("updateActor", actor => { if (actor.id === this.view.actorId || game.user.isGM) this.refresh(); })]);
      this.#hooks.push(["updateSetting", Hooks.on("updateSetting", setting => { if (String(setting.key).startsWith(`${MODULE_ID}.`) || String(setting.key).includes("crafting")) this.refresh(); })]);
      this.#hooks.push(["updateWorldTime", Hooks.on("updateWorldTime", () => this.refresh())]);
      this.#hooks.push(["gatheringProfessions.recipeProviders", Hooks.on("gatheringProfessions.recipeProviders", () => this.refresh())]);
    }

    _onClose(options) {
      super._onClose?.(options);
      for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
      this.#hooks = [];
      instance = null;
    }

    #choose(slot, name) {
      const draft = this.view.editing;
      if (slot === "output") draft.output = name;
      else if (draft.inputs[Number(slot)]) draft.inputs[Number(slot)][0] = name;
      draft.picker = null;
      draft.search = "";
      return this.render();
    }

    #expAdd(name) {
      const experiment = this.view.experiment;
      if (!this.actor) return ui.notifications.warn("Choose a character first.");
      if (!experiment.names.includes(name) && experiment.names.length < 6) experiment.names.push(name);
      experiment.picker = false;
      experiment.search = "";
      experiment.result = null;
      return this.render();
    }

    #onChange(target) {
      const draft = this.view.editing;
      const field = target.dataset?.draft;
      if (draft && field) {
        if (field === "tier") draft.tier = Number(target.value);
        if (field === "quantity") draft.quantity = Number(target.value);
        if (field === "minutes") draft.minutes = target.value;
        if (field === "tier") return this.render();
        if (field === "qty") draft.inputs[Number(target.dataset.index)][1] = Number(target.value);
        if (field === "search") { draft.search = target.value; return this.refresh(); }
        return;
      }
      if (target.dataset?.exp === "search") { this.view.experiment.search = target.value; return this.refresh(); }
      const act = target.dataset?.actChange;
      if (target.dataset?.batch) { this.view.batch[target.dataset.batch] = Number(target.value) || 1; return; }
      if (target.dataset?.learn) { void Promise.resolve(this.provider?.setLearned(target.dataset.learn, target.value, this.actor)).catch(report).finally(() => this.refresh()); return; }
      if (act === "actor") { this.view.actorId = target.value || null; this.view.experiment = freshExperiment(); return this.render(); }
      if (act === "craftable") { this.view.onlyCraftable = target.checked; return this.render(); }
      if (act === "search") { this.view.search = target.value; return this.refresh(); }
    }

    async #onAction(button) {
      const act = button.dataset.act;
      const provider = this.provider;
      if (act === "tab") { this.view.tab = button.dataset.tab; this.view.editing = null; this.view.experiment = freshExperiment(); return this.render(); }
      if (act === "collect") { await deliverDueJobs(this.actor); return this.render(); }
      if (act === "use-carried") { await provider.useCarried(this.actor, button.dataset.item); return this.render(); }
      if (act === "panel") { await provider.onPanel?.(button.dataset.panelAct, button, this.actor); return this.render(); }
      // Experiment panel.
      const experiment = this.view.experiment;
      if (act === "exp-pick") { experiment.picker = !experiment.picker; experiment.search = ""; return this.render(); }
      if (act === "exp-add") return this.#expAdd(button.dataset.name);
      if (act === "exp-remove") { experiment.names.splice(Number(button.dataset.index), 1); experiment.result = null; return this.render(); }
      if (act === "exp-try") {
        const outcome = await provider.experiment(this.actor, [...experiment.names]);
        experiment.result = { kind: outcome.learned ? "learned" : outcome.warm ? "warm" : "cold", message: outcome.message };
        if (outcome.learned) experiment.names = [];
        return this.render();
      }
      if (act === "new-recipe") { this.view.editing = editorDraft(null, this.view.tab); return this.render(); }
      if (act === "edit-recipe") {
        const id = button.dataset.recipe;
        const row = provider.recipes({ includeDisabled: true }).find(entry => entry.id === id);
        this.view.editing = this.view.editing?.id === id ? null : editorDraft(row, this.view.tab);
        return this.render();
      }
      const draft = this.view.editing;
      if (draft) {
        if (act === "pick") { draft.picker = draft.picker === button.dataset.slot ? null : button.dataset.slot; draft.search = ""; return this.render(); }
        if (act === "choose") return this.#choose(draft.picker, button.dataset.name);
        if (act === "add-input" && draft.inputs.length < MAX_INPUTS) { draft.inputs.push(["", 1]); return this.render(); }
        if (act === "remove-input" && draft.inputs.length > 1) { draft.inputs.splice(Number(button.dataset.index), 1); draft.picker = null; return this.render(); }
        if (act === "cancel-edit") { this.view.editing = null; return this.render(); }
        if (act === "save-edit") {
          const fields = draftFields(draft);
          if (draft.id) await provider.gm.update(draft.id, fields); else await provider.gm.create(fields);
          this.view.editing = null;
          ui.notifications.info(`Recipe for ${fields.output} saved.`);
          return this.render();
        }
      }
      if (act === "toggle-recipe") {
        const row = provider.recipes({ includeDisabled: true }).find(entry => entry.id === button.dataset.recipe);
        return provider.gm.disable(row.id, !row.disabled);
      }
      if (act === "reset-recipe") return provider.gm.reset(button.dataset.recipe);
      if (act === "make-scroll") {
        const item = await provider.gm.scroll(button.dataset.recipe);
        if (item) ui.notifications.info(`Created ${item.name} in the Items sidebar.`);
        return;
      }
      if (act === "delete-recipe") {
        const row = provider.recipes({ includeDisabled: true }).find(entry => entry.id === button.dataset.recipe);
        const ok = await gpDialog().confirm({ window: { title: "Delete recipe?" }, content: `<p>Delete your recipe for <strong>${escape(row?.output)}</strong>?</p>` });
        if (ok) return provider.gm.delete(button.dataset.recipe);
      }
      if (act === "craft") {
        const id = button.dataset.recipe;
        const input = this.element.querySelector(`[data-batch="${CSS.escape(id)}"]`);
        const batch = Math.max(1, Math.trunc(Number(input?.value) || 1));
        this.view.busy = true;
        await this.render();
        try { await provider.craft(this.actor, id, batch); }
        finally { this.view.busy = false; this.view.batch[id] = 1; await this.render(); }
      }
    }
  };
}

/** Open (or focus) the Recipes window. */
export async function openRecipes({ actor = null, tab = "" } = {}) {
  RecipesClass ??= defineClass();
  instance ??= new RecipesClass();
  if (actor) instance.view.actorId = actor.id;
  if (tab) instance.view.tab = tab;
  await instance.render({ force: true });
  return instance;
}
