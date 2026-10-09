// Player-facing Recipes window: refining recipes the party has discovered,
// grouped by product under one tab per profession, with have/need counts,
// success chance, batch crafting, and the character's timed jobs.
import { MODULE_ID, PROFESSIONS, materialRule } from "./rules.js";
import { successChance, formatDuration } from "./gather-ui.js";
import { gpDialog } from "./dialogs.js";
import {
  REFINE_MINUTES, refiningProfessions, refiningRecipes, allRecipes, discoveredNames, isKnown, learnedStates, findRecipe, inventoryCount, maxBatch,
  refineCheckFor, actorJobs, deliverDueJobs, formatMinutes, productItem
} from "./refining.js";

const FALLBACK_ICON = "icons/svg/item-bag.svg";
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Refining failed.");
}

const imgFor = name => productItem(name)?.img || Array.from(game.items ?? []).find(item => item.name === name)?.img || FALLBACK_ICON;

/* ---------------------------------------------------------------------- */
/* Model (pure apart from game lookups; unit tested)                       */
/* ---------------------------------------------------------------------- */

/**
 * @param {Actor|null} actor
 * @param {{isGM?: boolean, names?: Set<string>, tab?: string, onlyCraftable?: boolean, search?: string, now?: number}} options
 */
export function buildRecipesModel(actor, { isGM = false, names = discoveredNames(), states = learnedStates(), tab = "", onlyCraftable = false, search = "", now = game.time?.worldTime ?? 0 } = {}) {
  const professions = refiningProfessions();
  const active = professions.find(entry => entry.key === tab)?.key ?? professions[0]?.key ?? "";
  const query = search.trim().toLowerCase();
  const tabs = professions.map(entry => {
    const recipes = refiningRecipes(entry.key);
    return { ...entry, total: recipes.length, known: recipes.filter(row => isKnown(row, names, states)).length, active: entry.key === active };
  });
  const groups = new Map();
  for (const row of refiningRecipes(active, { includeDisabled: isGM })) {
    const known = isKnown(row, names, states);
    const group = groups.get(row.output) ?? { name: row.output, img: imgFor(row.output), tier: row.tier, recipes: [], hidden: 0 };
    groups.set(row.output, group);
    group.tier = Math.min(group.tier, row.tier);
    if (!known && !isGM) { group.hidden++; continue; }
    const inputs = row.inputs.map(([name, need]) => {
      const have = actor ? inventoryCount(actor, name) : 0;
      return { name, img: imgFor(name), need, have, ok: have >= need };
    });
    const max = actor ? maxBatch(actor, row) : 0;
    let chance = null;
    let target = null;
    if (actor) {
      const check = refineCheckFor(actor, row);
      target = check.target;
      chance = Math.round(successChance(check.modifier, check.die ?? 0, check.target) * 100);
    }
    group.recipes.push({ id: row.id, tier: row.tier, quantity: row.quantity, inputs, max, chance, target, known,
      learn: states[row.id] ?? "auto", disabled: Boolean(row.disabled), edited: Boolean(row.edited), custom: Boolean(row.custom),
      minutes: REFINE_MINUTES[row.tier - 1], time: formatMinutes(REFINE_MINUTES[row.tier - 1]) });
  }
  let products = [...groups.values()].filter(group => group.recipes.length)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  if (query) products = products.filter(group => group.name.toLowerCase().includes(query)
    || group.recipes.some(row => row.inputs.some(input => input.name.toLowerCase().includes(query))));
  if (onlyCraftable) products = products.map(group => ({ ...group, recipes: group.recipes.filter(row => row.max > 0) })).filter(group => group.recipes.length);
  const jobs = actor ? actorJobs(actor).map(job => ({ ...job, img: job.img || imgFor(job.name), done: job.ready <= now, left: formatDuration(Math.max(0, job.ready - now)) })) : [];
  const profession = PROFESSIONS[active];
  const current = tabs.find(entry => entry.active);
  return { tabs, active, verb: current?.verb ?? "", action: current?.action ?? "Make", professionLabel: profession?.label ?? "", products, jobs, isGM,
    actor: actor ? { id: actor.id, name: actor.name, img: actor.img } : null };
}

/* ---------------------------------------------------------------------- */
/* Render                                                                  */
/* ---------------------------------------------------------------------- */

function chanceWord(chance) {
  if (chance === null) return "";
  const word = chance >= 85 ? "Sure" : chance >= 60 ? "Likely" : chance >= 35 ? "Even" : chance >= 15 ? "Risky" : "Long shot";
  return `<span class="gp-rw-chance gp-chance-${word.toLowerCase().replace(" ", "-")}" title="Chance of a success or better">${chance}% · ${word}</span>`;
}

function recipeRow(row, model, state) {
  const inputs = row.inputs.map(input => `<span class="gp-rw-input ${input.ok ? "ok" : "missing"}" title="${escape(input.name)}: have ${input.have}, need ${input.need}">
      <img src="${escape(input.img)}" alt=""><span>${input.need}× ${escape(input.name)}</span><small>${input.have}</small></span>`).join('<i class="fas fa-plus gp-rw-plus"></i>');
  const batch = Math.min(Math.max(1, Number(state.batch?.[row.id]) || 1), Math.max(1, row.max));
  const canCraft = model.actor && row.max > 0 && !state.busy && !row.disabled;
  const learnOption = (value, label) => `<option value="${value}" ${row.learn === value ? "selected" : ""}>${label}</option>`;
  const gm = model.isGM ? `<div class="gp-rw-gm">
        <span class="gp-rw-known ${row.known ? "yes" : "no"}" title="${row.known ? "The party knows this recipe" : "Hidden from players"}"><i class="fas ${row.known ? "fa-eye" : "fa-eye-slash"}"></i></span>
        <select data-learn="${escape(row.id)}" title="Auto: learned once the party has had every ingredient">${learnOption("auto", "Auto")}${learnOption("learned", "Learned")}${learnOption("unlearned", "Unlearned")}</select>
        <button type="button" data-act="edit-recipe" data-recipe="${escape(row.id)}" title="Edit recipe"><i class="fas fa-pen"></i></button>
        ${row.custom ? `<button type="button" data-act="delete-recipe" data-recipe="${escape(row.id)}" title="Delete your recipe"><i class="fas fa-trash"></i></button>`
          : `<button type="button" class="${row.disabled ? "gp-rw-enable" : ""}" data-act="toggle-recipe" data-recipe="${escape(row.id)}" title="${row.disabled ? "Enable this recipe again" : "Disable for everyone"}"><i class="fas ${row.disabled ? "fa-toggle-off" : "fa-toggle-on"}"></i>${row.disabled ? " Enable" : ""}</button>
             ${row.edited ? `<button type="button" data-act="reset-recipe" data-recipe="${escape(row.id)}" title="Reset to the module's default"><i class="fas fa-rotate-left"></i></button>` : ""}`}
        ${row.custom ? '<span class="gp-rw-tag">Yours</span>' : row.disabled ? '<span class="gp-rw-tag off">Disabled</span>' : row.edited ? '<span class="gp-rw-tag">Edited</span>' : ""}
      </div>` : "";
  return `<div class="gp-rw-recipe ${row.max > 0 ? "craftable" : ""} ${row.disabled ? "gp-rw-off" : ""}">
      <div class="gp-rw-inputs">${inputs}<i class="fas fa-arrow-right gp-rw-arrow"></i><span class="gp-rw-out">${row.quantity}×</span></div>
      <div class="gp-rw-meta">
        <span class="gp-tier-badge tier-${row.tier}">T${row.tier}</span>
        ${row.target !== null ? `<span title="Check DC">DC ${row.target}</span>` : ""}
        ${chanceWord(row.chance)}
        <span title="Time per unit"><i class="fas fa-hourglass-half"></i> ${escape(row.time)}</span>
      </div>
      ${gm}
      <div class="gp-rw-make">
        <input type="number" min="1" max="${Math.max(1, row.max)}" value="${batch}" data-batch="${escape(row.id)}" ${row.max > 1 ? "" : "disabled"} aria-label="How many">
        <button type="button" class="gp-rw-craft" data-act="craft" data-recipe="${escape(row.id)}" ${canCraft ? "" : "disabled"} title="${model.actor ? (row.max > 0 ? `Up to ${row.max}` : "Not enough materials") : "Choose a character"}"><i class="fas fa-hammer"></i> ${escape(model.action)}</button>
      </div>
    </div>`;
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
        ${group.hidden ? `<em class="gp-rw-more" title="Gather new materials to discover more ways to make this"><i class="fas fa-question"></i> ${group.hidden} more undiscovered</em>` : ""}</header>
      ${group.recipes.map(row => recipeRow(row, model, state) + (state.editing?.id === row.id ? renderEditor(state.editing, state.editorItems) : "")).join("")}
    </section>`).join("");
  const empty = state.onlyCraftable ? "Nothing you can make right now." : "No recipes discovered yet. Gather materials to discover what they refine into.";
  const jobs = model.jobs.length ? `<section class="gp-rw-jobs"><h4><i class="fas fa-hourglass-half"></i> In progress</h4>
      ${model.jobs.map(job => `<div class="gp-rw-job ${job.done ? "done" : ""}"><img src="${escape(job.img)}" alt=""><span>${job.quantity}× ${escape(job.name)}</span>
        <small>${job.done ? "Ready" : `${escape(job.left)} left`}</small></div>`).join("")}
      ${model.jobs.some(job => job.done) && state.canCollect ? '<button type="button" data-act="collect"><i class="fas fa-box-open"></i> Collect finished work</button>' : ""}
    </section>` : "";
  return `<div class="gp-rw">
    <header class="gp-rw-head">
      ${model.actor ? `<img class="gp-rw-portrait" src="${escape(model.actor.img || FALLBACK_ICON)}" alt="">` : ""}
      <div class="gp-rw-who">${who}${model.professionLabel ? `<small>Rolls ${escape(model.professionLabel)} at the recipe's tier</small>` : ""}</div>
      <label class="gp-rw-filter"><input type="checkbox" data-act-change="craftable" ${state.onlyCraftable ? "checked" : ""}> Can make now</label>
      <input type="search" class="gp-rw-search" data-act-change="search" placeholder="Search" value="${escape(state.search ?? "")}">
    </header>
    <nav class="gp-rw-tabs">${tabs || '<span class="gp-rw-noactor">No refining available (needs the professions and their source modules).</span>'}</nav>
    ${jobs}
    ${model.isGM && model.active ? `<div class="gp-rw-gmbar"><button type="button" data-act="new-recipe"><i class="fas fa-plus"></i> New ${escape(model.verb.toLowerCase())} recipe</button><span>Eye: whether players see it. Auto = learned once the party has had every ingredient.</span></div>` : ""}
    <div class="gp-rw-list">${state.editing && !state.editing.id ? `<section class="gp-rw-card">${renderEditor(state.editing, state.editorItems)}</section>` : ""}${cards || `<p class="gp-rw-empty">${empty}</p>`}</div>
  </div>`;
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

const api = () => game.modules.get(MODULE_ID).api.refining;
const MAX_INPUTS = 6;

/** Editor state for a recipe (row) or a new one on a profession's tab. */
export function editorDraft(row, profession) {
  return { id: row?.id ?? null, profession: row?.profession ?? profession, tier: row?.tier ?? 1, output: row?.output ?? "", quantity: row?.quantity ?? 1,
    inputs: (row?.inputs?.length ? row.inputs : [["", 1]]).map(([name, quantity]) => [name, quantity]), picker: null, search: "" };
}

const OTHER_LIMIT = 60;

/**
 * Items to pick from, grouped: the profession's materials, refined goods,
 * then every other world Item (first matches only until the GM searches).
 */
export function itemOptions(profession, search = "") {
  const query = search.trim().toLowerCase();
  const items = Array.from(game.items ?? []).filter(item => item?.name).sort((a, b) => a.name.localeCompare(b.name));
  const match = item => !query || item.name.toLowerCase().includes(query);
  const refined = new Set(allRecipes({ includeDisabled: true }).map(row => row.output));
  const seen = new Set();
  const take = list => list.filter(item => match(item) && !seen.has(item.name) && seen.add(item.name)).map(item => ({ name: item.name, img: item.img || FALLBACK_ICON }));
  const label = PROFESSIONS[profession]?.label ?? "Profession";
  const groups = [
    { label: `${label} materials`, items: take(items.filter(item => materialRule(item)?.profession === profession)) },
    { label: "Refined goods", items: take(items.filter(item => refined.has(item.name))) },
    { label: "Other items", items: take(items) }
  ];
  const other = groups[2];
  other.more = Math.max(0, other.items.length - OTHER_LIMIT);
  other.items = other.items.slice(0, OTHER_LIMIT);
  return groups.filter(group => group.items.length || group.more);
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
  const picker = slot => (draft.picker === slot ? pickerPanel(draft, groups) : "");
  const rows = draft.inputs.map(([name, quantity], index) => `<div class="gp-rw-editrow">
      ${slotButton(String(index), name, draft.picker === String(index))}
      <input type="number" min="1" max="99" value="${quantity}" data-draft="qty" data-index="${index}" aria-label="Quantity needed">
      <button type="button" class="gp-rw-iconbtn" data-act="remove-input" data-index="${index}" title="Remove ingredient" ${draft.inputs.length > 1 ? "" : "disabled"}><i class="fas fa-xmark"></i></button>
    </div>${picker(String(index))}`).join("");
  return `<div class="gp-rw-edit">
    <div class="gp-rw-edithead"><strong>${draft.id ? "Edit recipe" : "New recipe"}</strong>
      <label>Tier <select data-draft="tier">${[1, 2, 3, 4, 5].map(tier => `<option value="${tier}" ${tier === Number(draft.tier) ? "selected" : ""}>${tier}</option>`).join("")}</select></label></div>
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

/** The draft as recipe fields for the API. */
export function draftFields(draft) {
  return { profession: draft.profession, tier: Number(draft.tier), output: draft.output, quantity: Number(draft.quantity),
    inputs: draft.inputs.filter(([name]) => String(name ?? "").trim()).map(([name, quantity]) => [name, Number(quantity)]) };
}

let RecipesClass = null;
let instance = null;

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

    view = { actorId: defaultActor()?.id ?? null, tab: "", onlyCraftable: false, search: "", batch: {}, busy: false, editing: null };
    #hooks = [];
    #timer = null;

    get actor() {
      const actor = this.view.actorId ? game.actors.get(this.view.actorId) : null;
      return actor && (game.user.isGM || actor.isOwner) ? actor : null;
    }

    async _prepareContext() { return {}; }

    async _renderHTML() {
      const model = buildRecipesModel(this.actor, { isGM: game.user.isGM, tab: this.view.tab, onlyCraftable: this.view.onlyCraftable, search: this.view.search });
      this.view.tab = model.active;
      const editing = game.user.isGM ? this.view.editing : null;
      const editorItems = editing?.picker ? itemOptions(editing.profession, editing.search) : [];
      return renderRecipesWindow(model, { ...this.view, editing, editorItems, characters: ownedCharacters(), canCollect: Boolean(this.actor) && !game.users?.activeGM });
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

    #refresh() {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { if (this.rendered) void this.render(); }, 120);
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("click", event => {
        const button = event.target.closest?.("[data-act]");
        if (button && !button.disabled) void this.#onAction(button).catch(error => { this.view.busy = false; report(error); this.#refresh(); });
      });
      this.element.addEventListener("change", event => this.#onChange(event.target));
      this.element.addEventListener("input", event => { if (event.target.matches?.(".gp-rw-search, .gp-rw-picksearch")) this.#onChange(event.target); });
      // Drag an Item from the sidebar onto a product or ingredient slot.
      this.element.addEventListener("dragover", event => { if (event.target.closest?.("[data-drop-slot]")) event.preventDefault(); });
      this.element.addEventListener("drop", event => {
        const slot = event.target.closest?.("[data-drop-slot]");
        if (!slot || !this.view.editing) return;
        event.preventDefault();
        let data = null;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
        const item = data?.type === "Item" && data.uuid ? fromUuidSync(data.uuid) : null;
        if (!item?.name) return ui.notifications.warn("Drop an Item from the Items sidebar.");
        this.#choose(slot.dataset.dropSlot, item.name);
      });
      const mine = document => [document?.parent?.id, document?.id].includes(this.view.actorId);
      for (const hook of ["createItem", "updateItem", "deleteItem"]) this.#hooks.push([hook, Hooks.on(hook, item => { if (mine(item)) this.#refresh(); })]);
      this.#hooks.push(["updateActor", Hooks.on("updateActor", actor => { if (actor.id === this.view.actorId) this.#refresh(); })]);
      const watched = ["discoveredItems", "recipeLearned", "recipeEdits", "customRecipes"].map(key => `${MODULE_ID}.${key}`);
      this.#hooks.push(["updateSetting", Hooks.on("updateSetting", setting => { if (watched.includes(setting.key)) this.#refresh(); })]);
      this.#hooks.push(["updateWorldTime", Hooks.on("updateWorldTime", () => this.#refresh())]);
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

    #onChange(target) {
      const draft = this.view.editing;
      const field = target.dataset?.draft;
      if (draft && field) {
        if (field === "tier") draft.tier = Number(target.value);
        if (field === "quantity") draft.quantity = Number(target.value);
        if (field === "qty") draft.inputs[Number(target.dataset.index)][1] = Number(target.value);
        if (field === "search") { draft.search = target.value; return this.#refresh(); }
        return;
      }
      const act = target.dataset?.actChange;
      if (target.dataset?.batch) { this.view.batch[target.dataset.batch] = Number(target.value) || 1; return; }
      if (target.dataset?.learn) { void api().setLearned(target.dataset.learn, target.value).catch(report); return; }
      if (act === "actor") { this.view.actorId = target.value || null; return this.render(); }
      if (act === "craftable") { this.view.onlyCraftable = target.checked; return this.render(); }
      if (act === "search") { this.view.search = target.value; return this.#refresh(); }
    }

    async #onAction(button) {
      const act = button.dataset.act;
      if (act === "tab") { this.view.tab = button.dataset.tab; this.view.editing = null; return this.render(); }
      if (act === "collect") { await deliverDueJobs(this.actor); return this.render(); }
      if (act === "new-recipe") { this.view.editing = editorDraft(null, this.view.tab); return this.render(); }
      if (act === "edit-recipe") {
        const id = button.dataset.recipe;
        this.view.editing = this.view.editing?.id === id ? null : editorDraft(findRecipe(id, { includeDisabled: true }), this.view.tab);
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
          if (draft.id) await api().update(draft.id, fields); else await api().create(fields);
          this.view.editing = null;
          ui.notifications.info(`Recipe for ${fields.output} saved.`);
          return this.render();
        }
      }
      if (act === "toggle-recipe") {
        const row = findRecipe(button.dataset.recipe, { includeDisabled: true });
        return api().disable(row.id, !row.disabled);
      }
      if (act === "reset-recipe") return api().reset(button.dataset.recipe);
      if (act === "delete-recipe") {
        const row = findRecipe(button.dataset.recipe, { includeDisabled: true });
        const ok = await gpDialog().confirm({ window: { title: "Delete recipe?" }, content: `<p>Delete your recipe for <strong>${escape(row?.output)}</strong>?</p>` });
        if (ok) return api().delete(button.dataset.recipe);
      }
      if (act === "craft") {
        const id = button.dataset.recipe;
        const input = this.element.querySelector(`[data-batch="${CSS.escape(id)}"]`);
        const batch = Math.max(1, Math.trunc(Number(input?.value) || 1));
        this.view.busy = true;
        await this.render();
        try { await game.modules.get(MODULE_ID).api.refining.craft(this.actor, id, batch); }
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
