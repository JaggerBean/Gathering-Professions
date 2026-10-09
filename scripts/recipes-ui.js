// Player-facing Recipes window: refining recipes the party has discovered,
// grouped by product under one tab per profession, with have/need counts,
// success chance, batch crafting, and the character's timed jobs.
import { MODULE_ID, PROFESSIONS } from "./rules.js";
import { successChance, formatDuration } from "./gather-ui.js";
import {
  REFINE_MINUTES, refiningProfessions, refiningRecipes, discoveredNames, isKnown, inventoryCount, maxBatch,
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
export function buildRecipesModel(actor, { isGM = false, names = discoveredNames(), tab = "", onlyCraftable = false, search = "", now = game.time?.worldTime ?? 0 } = {}) {
  const professions = refiningProfessions();
  const active = professions.find(entry => entry.key === tab)?.key ?? professions[0]?.key ?? "";
  const query = search.trim().toLowerCase();
  const tabs = professions.map(entry => {
    const recipes = refiningRecipes(entry.key);
    return { ...entry, total: recipes.length, known: recipes.filter(row => isKnown(row, names)).length, active: entry.key === active };
  });
  const groups = new Map();
  for (const row of refiningRecipes(active)) {
    const known = isKnown(row, names);
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
  const canCraft = model.actor && row.max > 0 && !state.busy;
  return `<div class="gp-rw-recipe ${row.max > 0 ? "craftable" : ""}">
      <div class="gp-rw-inputs">${inputs}<i class="fas fa-arrow-right gp-rw-arrow"></i><span class="gp-rw-out">${row.quantity}×</span></div>
      <div class="gp-rw-meta">
        <span class="gp-tier-badge tier-${row.tier}">T${row.tier}</span>
        ${row.target !== null ? `<span title="Check DC">DC ${row.target}</span>` : ""}
        ${chanceWord(row.chance)}
        <span title="Time per unit"><i class="fas fa-hourglass-half"></i> ${escape(row.time)}</span>
        ${model.isGM && !row.known ? '<span class="gp-rw-undisc" title="Players have not discovered this recipe"><i class="fas fa-eye-slash"></i> Undiscovered</span>' : ""}
      </div>
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
      ${group.recipes.map(row => recipeRow(row, model, state)).join("")}
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
    <div class="gp-rw-list">${cards || `<p class="gp-rw-empty">${empty}</p>`}</div>
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

    view = { actorId: defaultActor()?.id ?? null, tab: "", onlyCraftable: false, search: "", batch: {}, busy: false };
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
      return renderRecipesWindow(model, { ...this.view, characters: ownedCharacters(), canCollect: Boolean(this.actor) && !game.users?.activeGM });
    }

    _replaceHTML(result, content) {
      const focused = document.activeElement?.matches?.(".gp-rw-search") ? document.activeElement.selectionStart : null;
      content.innerHTML = result;
      if (focused !== null) {
        const search = content.querySelector(".gp-rw-search");
        search?.focus();
        search?.setSelectionRange(focused, focused);
      }
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
      this.element.addEventListener("input", event => { if (event.target.matches?.(".gp-rw-search")) this.#onChange(event.target); });
      const mine = document => [document?.parent?.id, document?.id].includes(this.view.actorId);
      for (const hook of ["createItem", "updateItem", "deleteItem"]) this.#hooks.push([hook, Hooks.on(hook, item => { if (mine(item)) this.#refresh(); })]);
      this.#hooks.push(["updateActor", Hooks.on("updateActor", actor => { if (actor.id === this.view.actorId) this.#refresh(); })]);
      this.#hooks.push(["updateSetting", Hooks.on("updateSetting", setting => { if (setting.key === `${MODULE_ID}.discoveredItems`) this.#refresh(); })]);
      this.#hooks.push(["updateWorldTime", Hooks.on("updateWorldTime", () => this.#refresh())]);
    }

    _onClose(options) {
      super._onClose?.(options);
      for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
      this.#hooks = [];
      instance = null;
    }

    #onChange(target) {
      const act = target.dataset?.actChange;
      if (target.dataset?.batch) { this.view.batch[target.dataset.batch] = Number(target.value) || 1; return; }
      if (act === "actor") { this.view.actorId = target.value || null; return this.render(); }
      if (act === "craftable") { this.view.onlyCraftable = target.checked; return this.render(); }
      if (act === "search") { this.view.search = target.value; return this.#refresh(); }
    }

    async #onAction(button) {
      const act = button.dataset.act;
      if (act === "tab") { this.view.tab = button.dataset.tab; return this.render(); }
      if (act === "collect") { await deliverDueJobs(this.actor); return this.render(); }
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
