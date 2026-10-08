// Conditions & Biomes window, plus the reusable condition-rules editor used by
// the Material editor and the Node Manager.
import { MODULE_ID, PROFESSIONS, professionKey } from "./rules.js";
import {
  CONDITION_TYPES, conditionOptions, currentConditions, getOverrides, getBiomes, getConditionDc, sceneBiome, defaultConditionDcRows
} from "./conditions.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const option = (value, label, selected) => `<option value="${escape(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escape(label)}</option>`;

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Could not save conditions.");
}

/* ---------------------------------------------------------------------- */
/* Rules editor (material multipliers)                                     */
/* ---------------------------------------------------------------------- */

function typeOptions(selected) {
  return Object.entries(CONDITION_TYPES).map(([key, type]) => option(key, type.label, selected)).join("");
}

function valueOptions(type, selected) {
  const options = conditionOptions(type);
  const known = options.some(entry => entry.key === selected);
  return `${option("", options.length ? "Choose…" : "None defined", selected)}${!known && selected ? option(selected, selected, selected) : ""}${options.map(entry => option(entry.key, entry.label, selected)).join("")}`;
}

function ruleRow(rule = {}) {
  const type = rule.type ?? "season";
  return `<div class="ep-rule-row">
      <select data-rule="type" aria-label="Condition">${typeOptions(type)}</select>
      <select data-rule="value" aria-label="Value">${valueOptions(type, rule.value ?? "")}</select>
      <span class="ep-rule-x">×</span>
      <input data-rule="multiplier" type="number" min="0" max="10" step="0.05" value="${escape(rule.multiplier ?? 1)}" aria-label="Weight multiplier">
      <button type="button" class="ep-icon" data-rule-remove title="Remove rule"><i class="fas fa-xmark"></i></button>
    </div>`;
}

/** Editable list of {type, value, multiplier}, stored as JSON in a hidden input named `name`. */
export function rulesEditorHtml(rules, name, { emptyHint = "No rules: weight is unchanged in every condition." } = {}) {
  return `<div class="ep-rules" data-rules-editor>
      <input type="hidden" name="${escape(name)}" value="${escape(JSON.stringify(rules ?? []))}">
      <div class="ep-rule-rows">${(rules ?? []).map(ruleRow).join("")}</div>
      <p class="ep-hint ep-rules-empty" ${rules?.length ? "hidden" : ""}>${escape(emptyHint)}</p>
      <button type="button" class="ep-rule-add" data-rule-add><i class="fas fa-plus"></i> Add condition</button>
    </div>`;
}

function syncEditor(editor) {
  const rows = Array.from(editor.querySelectorAll(".ep-rule-row")).map(row => ({
    type: row.querySelector("[data-rule='type']").value,
    value: row.querySelector("[data-rule='value']").value,
    multiplier: Number(row.querySelector("[data-rule='multiplier']").value)
  })).filter(rule => rule.value);
  editor.querySelector("input[type='hidden']").value = JSON.stringify(rows);
  const empty = editor.querySelector(".ep-rules-empty");
  if (empty) empty.hidden = editor.querySelectorAll(".ep-rule-row").length > 0;
}

/** Wire every rules editor under root (delegated; safe to call once per root). */
export function bindRulesEditors(root, onChange = () => {}) {
  if (!root || root.dataset?.epRulesBound) return;
  if (root.dataset) root.dataset.epRulesBound = "1";
  root.addEventListener("click", event => {
    const add = event.target.closest?.("[data-rule-add]");
    const remove = event.target.closest?.("[data-rule-remove]");
    const editor = (add ?? remove)?.closest("[data-rules-editor]");
    if (!editor) return;
    if (add) editor.querySelector(".ep-rule-rows").insertAdjacentHTML("beforeend", ruleRow());
    if (remove) remove.closest(".ep-rule-row").remove();
    syncEditor(editor);
    onChange(editor);
  });
  root.addEventListener("change", event => {
    const row = event.target.closest?.(".ep-rule-row");
    if (!row) return;
    if (event.target.matches("[data-rule='type']")) row.querySelector("[data-rule='value']").innerHTML = valueOptions(event.target.value, "");
    const editor = row.closest("[data-rules-editor]");
    syncEditor(editor);
    onChange(editor);
  });
  root.addEventListener("input", event => {
    const editor = event.target.closest?.("[data-rules-editor]");
    if (editor && event.target.matches("[data-rule='multiplier']")) { syncEditor(editor); onChange(editor); }
  });
}

export function parseRules(value) {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}

export function rulesSummary(rules) {
  if (!rules?.length) return "No condition rules";
  return rules.map(rule => `${conditionOptions(rule.type).find(entry => entry.key === rule.value)?.label ?? rule.value} ×${rule.multiplier}`).join(", ");
}

/* ---------------------------------------------------------------------- */
/* Conditions & Biomes window                                              */
/* ---------------------------------------------------------------------- */

export const CONDITION_TABS = [["now", "Current", "fa-cloud-sun"], ["biomes", "Biomes & Scenes", "fa-mountain-sun"], ["dc", "Difficulty", "fa-shield-halved"]];

export function nowTab() {
  const auto = currentConditions({});
  const overrides = getOverrides();
  const stActive = Boolean(game.modules.get("simple-timekeeping")?.active);
  const cards = ["season", "weather", "time"].map(type => {
    const current = auto[type];
    return `<div class="ep-hub-card ep-cond-now">
      <div class="ep-hub-card-head"><i class="fas ${CONDITION_TYPES[type].icon}"></i> ${CONDITION_TYPES[type].label}</div>
      <div class="ep-cond-value">${current ? escape(current.label) : "<em>Unknown</em>"}${current?.source === "override" ? ' <span class="ep-pill ep-pill-gold">Pinned</span>' : ""}</div>
      <label class="ep-field"><span>Pin a value</span><select name="override_${type}">${option("", "Automatic (Simple Timekeeping)", overrides[type])}${conditionOptions(type).map(entry => option(entry.key, entry.label, overrides[type])).join("")}</select></label>
    </div>`;
  }).join("");
  return `${stActive ? "" : '<p class="ep-hub-note ep-hub-warn"><i class="fas fa-triangle-exclamation"></i> Simple Timekeeping is not active. Season, weather, and time are only known when pinned here.</p>'}
    <div class="ep-hub-grid ep-hub-grid-3">${cards}</div>
    <p class="ep-hub-note">Pinned values replace Simple Timekeeping's until you set them back to Automatic. Biome comes from each node, or from its scene.</p>
    <footer class="ep-hub-footer"><button type="button" class="ep-hub-primary" data-act="save-now"><i class="fas fa-floppy-disk"></i> Save pins</button></footer>`;
}

export function biomesTab() {
  const biomes = getBiomes();
  const rows = [...biomes, { key: "", label: "", color: "" }, { key: "", label: "", color: "" }].map((biome, index) => `<div class="ep-hub-row ${biome.key ? "" : "ep-hub-row-new"}">
      <input name="biome_color_${index}" type="color" value="${escape(biome.color || "#7a7a7a")}" aria-label="Color">
      <input name="biome_label_${index}" type="text" value="${escape(biome.label)}" placeholder="${biome.key ? "" : "New biome"}" aria-label="Name">
      ${biome.key ? `<code class="ep-hub-key">${escape(biome.key)}</code><input type="hidden" name="biome_key_${index}" value="${escape(biome.key)}">` : `<input class="ep-hub-key" name="biome_key_${index}" type="text" placeholder="key (auto)" aria-label="Key">`}
      ${biome.key ? `<label class="ep-hub-remove" title="Remove ${escape(biome.label)}"><input type="checkbox" name="biome_remove_${index}"><i class="fas fa-trash"></i></label>` : "<span></span>"}
    </div>`).join("");
  const scenes = Array.from(game.scenes ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const sceneRows = scenes.map(scene => `<div class="ep-hub-row ep-hub-row-scene"><span class="ep-hub-row-name"><i class="fas fa-map"></i> ${escape(scene.name)}</span>
      <select name="scene_${scene.id}">${option("", "No biome", sceneBiome(scene))}${biomes.map(biome => option(biome.key, biome.label, sceneBiome(scene))).join("")}</select></div>`).join("");
  return `<input type="hidden" name="biome_count" value="${biomes.length + 2}">
    <div class="ep-hub-grid ep-hub-grid-2">
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-mountain-sun"></i> Biomes</div>
        <div class="ep-hub-rows">${rows}</div>
        <p class="ep-hub-note">Rules store the key, so keys cannot change after saving. Fill a blank row to add a biome.</p></section>
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-map"></i> Scene default biome</div>
        <div class="ep-hub-rows ep-hub-scroll">${sceneRows || '<p class="ep-hub-note">No scenes.</p>'}</div>
        <p class="ep-hub-note">Nodes without their own biome use their scene's.</p></section>
    </div>
    <footer class="ep-hub-footer"><button type="button" class="ep-hub-primary" data-act="save-biomes"><i class="fas fa-floppy-disk"></i> Save biomes</button></footer>`;
}

function dcRow(rule = {}, index) {
  const type = rule.type ?? "weather";
  return `<div class="ep-hub-row ep-dc-row">
    <select name="dc_type_${index}" data-dc-type>${typeOptions(type)}</select>
    <select name="dc_value_${index}">${valueOptions(type, rule.value ?? "")}</select>
    <select name="dc_prof_${index}">${Object.values(PROFESSIONS).map(profession => option(profession.key, profession.label, professionKey(rule.profession ?? ""))).join("")}</select>
    <input name="dc_dc_${index}" type="number" min="-20" max="20" step="1" value="${escape(rule.dc ?? 2)}" aria-label="DC">
    <button type="button" class="ep-hub-icon" data-act="dc-remove" title="Remove"><i class="fas fa-xmark"></i></button></div>`;
}

const DC_GROUPS = ["season", "time", "weather", "biome"];

/** Every condition with its DC change for every profession (0 = none). */
export function dcTab(view = {}) {
  const rules = view.dcDraft ?? getConditionDc();
  const general = new Map(rules.filter(rule => !rule.profession).map(rule => [`${rule.type}:${rule.value}`, rule.dc]));
  const specific = view.dcSpecific ?? rules.filter(rule => rule.profession);
  const groups = DC_GROUPS.map(type => {
    const tiles = conditionOptions(type).map(entry => {
      const value = Number(general.get(`${type}:${entry.key}`) ?? 0);
      return `<label class="ep-dc-tile ${value > 0 ? "harder" : value < 0 ? "easier" : ""}">
        <span>${escape(entry.label)}</span>
        <input type="number" name="dcg_${type}__${escape(entry.key)}" min="-20" max="20" step="1" value="${value}" data-dc-grid>
      </label>`;
    }).join("");
    return `<section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas ${CONDITION_TYPES[type].icon}"></i> ${CONDITION_TYPES[type].label}</div>
      <div class="ep-dc-grid">${tiles || '<p class="ep-hub-note">None defined.</p>'}</div></section>`;
  }).join("");
  return `<p class="ep-hub-note">Each number is added to the final DC of every gathering check while that condition holds (0 = no change). They add up: rain at night is +2 and +2.</p>
    <div class="ep-dc-groups">${groups}</div>
    <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-user-gear"></i> Profession-specific extras <small>(optional, added on top)</small></div>
      <div class="ep-hub-rows">${specific.map(dcRow).join("") || '<p class="ep-hub-note">None.</p>'}</div>
      <button type="button" class="ep-hub-ghost" data-act="dc-add"><i class="fas fa-plus"></i> Add a profession-specific modifier</button></section>
    <footer class="ep-hub-footer">
      <button type="button" class="ep-hub-ghost" data-act="dc-defaults" title="Replace the grid with the recommended values"><i class="fas fa-wand-magic-sparkles"></i> Recommended values</button>
      <button type="button" class="ep-hub-primary" data-act="save-dc"><i class="fas fa-floppy-disk"></i> Save difficulty</button></footer>`;
}

function readSpecificRows(root) {
  return Array.from(root.querySelectorAll(".ep-dc-row")).map(row => ({
    type: row.querySelector("[name^='dc_type_']").value,
    value: row.querySelector("[name^='dc_value_']").value,
    profession: row.querySelector("[name^='dc_prof_']").value,
    dc: Number(row.querySelector("[name^='dc_dc_']").value)
  }));
}

/** Grid (every profession, non-zero only) plus profession-specific rows. */
export function readDcRows(root) {
  const general = Array.from(root.querySelectorAll("[data-dc-grid]")).map(input => {
    const [type, value] = input.name.slice(4).split("__");
    return { type, value, profession: "", dc: Number(input.value) || 0 };
  }).filter(rule => rule.dc !== 0);
  return [...general, ...readSpecificRows(root)];
}

/** Body of the conditions area (sub-tabs + content), used by the GM hub. */
export function renderConditionsWindow(view) {
  const tab = view.tab ?? "now";
  const nav = CONDITION_TABS.map(([id, label, icon]) => `<a class="ep-hub-subtab ${id === tab ? "active" : ""}" data-act="cond-tab" data-tab="${id}"><i class="fas ${icon}"></i> ${escape(label)}</a>`).join("");
  const body = tab === "biomes" ? biomesTab() : tab === "dc" ? dcTab(view) : nowTab();
  return `<div class="ep-cond"><nav class="ep-hub-subtabs">${nav}</nav><div class="ep-cond-body">${body}</div></div>`;
}

/** Bind the Difficulty "type" selects (profession rows). */
export function bindConditionInputs(root) {
  if (!root || root.dataset?.epCondBound) return;
  if (root.dataset) root.dataset.epCondBound = "1";
  root.addEventListener("change", event => {
    if (event.target.matches?.("[data-dc-type]")) {
      const row = event.target.closest(".ep-dc-row");
      row.querySelector("[name^='dc_value_']").innerHTML = valueOptions(event.target.value, "");
    }
  });
  root.addEventListener("input", event => {
    if (!event.target.matches?.("[data-dc-grid]")) return;
    const value = Number(event.target.value) || 0;
    const tile = event.target.closest(".ep-dc-tile");
    tile?.classList.toggle("harder", value > 0);
    tile?.classList.toggle("easier", value < 0);
  });
}

/**
 * Conditions actions shared by the GM hub. Returns true when handled (the
 * caller re-renders).
 */
export async function handleConditionsAction(act, button, form, view) {
  const api = game.modules.get(MODULE_ID).api.conditions;
  const get = name => form.querySelector(`[name='${name}']`);
  const keepDraft = () => { if (view.tab === "dc") { view.dcDraft = readDcRows(form); view.dcSpecific = readSpecificRows(form); } };
  switch (act) {
    case "cond-tab":
      keepDraft();
      view.tab = button.dataset.tab;
      return true;
    case "save-now":
      await api.setOverrides({ season: get("override_season").value, weather: get("override_weather").value, time: get("override_time").value });
      ui.notifications.info("Condition pins saved.");
      return true;
    case "save-biomes": {
      const count = Number(get("biome_count").value) || 0;
      const list = [];
      for (let index = 0; index < count; index++) {
        if (get(`biome_remove_${index}`)?.checked) continue;
        list.push({ key: get(`biome_key_${index}`)?.value ?? "", label: get(`biome_label_${index}`)?.value ?? "", color: get(`biome_color_${index}`)?.value ?? "" });
      }
      await api.setBiomes(list);
      for (const scene of game.scenes ?? []) {
        const value = get(`scene_${scene.id}`)?.value ?? "";
        if (value !== sceneBiome(scene) && (value === "" || getBiomes().some(biome => biome.key === value))) await api.setSceneBiome(scene, value);
      }
      ui.notifications.info("Biomes saved.");
      return true;
    }
    case "dc-add":
      keepDraft();
      view.dcSpecific = [...view.dcSpecific, { type: "weather", value: "", profession: Object.keys(PROFESSIONS)[0] ?? "", dc: 2 }];
      return true;
    case "dc-remove": {
      keepDraft();
      const rows = Array.from(form.querySelectorAll(".ep-dc-row"));
      const index = rows.indexOf(button.closest(".ep-dc-row"));
      view.dcSpecific = view.dcSpecific.filter((_row, position) => position !== index);
      return true;
    }
    case "dc-defaults":
      keepDraft();
      view.dcDraft = [...defaultConditionDcRows(), ...view.dcSpecific];
      return true;
    case "save-dc":
      await api.setDcModifiers(readDcRows(form).filter(rule => rule.value));
      view.dcDraft = null;
      view.dcSpecific = null;
      ui.notifications.info("Difficulty saved.");
      return true;
  }
  return false;
}

/** Conditions now live in the GM hub (Eryndor Professions → Conditions). */
export async function openConditionsWindow(tab = null) {
  if (!game.user.isGM) return null;
  const { openHub } = await import("./hub.js");
  return openHub("conditions", tab ? { conditionsTab: tab } : {});
}
