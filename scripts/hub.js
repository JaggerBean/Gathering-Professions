// Eryndor Professions GM hub: one window for every GM setting, in the same
// dark, gold-edged style as the gathering window. Sections: Professions,
// Skill Tree, Tools, Rare Finds, Rules, Conditions. Settings-menu buttons and
// toolbar buttons open it on the matching section.
import { MODULE_ID, PROFESSIONS, ABILITY_LABELS, RANK_DIE, activeRules } from "./rules.js";
import { SKILL_TREE_ID, skillTreeConfig, availableSkillTrees, configuredSkillTree } from "./integrations.js";
import { toolDurability } from "./durability.js";
import { renderConditionsWindow, handleConditionsAction, bindConditionInputs } from "./conditions-ui.js";
import { saveRulesValues } from "./ui.js";

export const HUB_SECTIONS = Object.freeze([
  { id: "professions", label: "Professions", icon: "fa-hammer", blurb: "Gathering professions, their check ability, and a fallback rare table." },
  { id: "tree", label: "Skill Tree", icon: "fa-diagram-project", blurb: "The shared gathering skill tree and how many points each rank grants." },
  { id: "tools", label: "Tools", icon: "fa-screwdriver-wrench", blurb: "Every gather needs one of its profession's accepted tools. Nodes can require their own." },
  { id: "rare", label: "Rare Finds", icon: "fa-gem", blurb: "One rare-find table per profession and material tier." },
  { id: "rules", label: "Rules", icon: "fa-scale-balanced", blurb: "Material DCs and XP, rank thresholds, and extraction rules." },
  { id: "conditions", label: "Conditions", icon: "fa-cloud-sun-rain", blurb: "Pinned season, weather, and time; biomes; and how conditions change DCs." }
]);

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const option = (value, label, selected) => `<option value="${escape(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escape(label)}</option>`;
const number = (name, value, min, max) => `<input type="number" name="${escape(name)}" value="${escape(value)}" min="${min}" max="${max}" step="1">`;

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Could not save.");
}

/** Name, icon, and (for tables) result icons of a linked document; tolerant of missing ones. */
export function linkedDoc(uuid) {
  if (!uuid) return null;
  let document = null;
  try { document = globalThis.fromUuidSync?.(uuid) ?? null; } catch { document = null; }
  if (!document) return { name: "Missing", img: "", missing: true, icons: [] };
  const icons = Array.from(document.results ?? []).map(result => result.img).filter(Boolean).slice(0, 4);
  return { name: document.name, img: document.img ?? "", missing: false, icons, document };
}

function slot({ uuid, empty, drop, clear, title = "" }) {
  const doc = linkedDoc(uuid);
  const body = doc
    ? `${doc.icons.length ? `<span class="ep-slot-icons">${doc.icons.map(img => `<img src="${escape(img)}" alt="">`).join("")}</span>` : ""}
       <span class="ep-slot-name ${doc.missing ? "missing" : ""}">${escape(doc.name)}</span>
       <a class="ep-slot-clear" data-act="${escape(clear.act)}" ${Object.entries(clear.data ?? {}).map(([key, value]) => `data-${key}="${escape(value)}"`).join(" ")} title="Clear"><i class="fas fa-xmark"></i></a>`
    : `<span class="ep-slot-empty"><i class="fas fa-hand-holding"></i> ${escape(empty)}</span>`;
  return `<div class="ep-slot ${doc ? "filled" : ""}" data-drop="${escape(drop.kind)}" ${Object.entries(drop.data ?? {}).map(([key, value]) => `data-${key}="${escape(value)}"`).join(" ")} title="${escape(title)}">${body}</div>`;
}

/* ---------------------------------------------------------------------- */
/* Sections                                                                */
/* ---------------------------------------------------------------------- */

function professionsSection(view) {
  const list = view.professions;
  const abilities = selected => Object.entries(ABILITY_LABELS).map(([key, label]) => option(key, label, selected)).join("");
  const cards = list.map((profession, index) => `<article class="ep-hub-card ep-prof-card ${profession.removed ? "removed" : ""}">
      <div class="ep-hub-card-head">
        <input class="ep-hub-title-input" name="p_label_${index}" value="${escape(profession.label)}" placeholder="New profession" aria-label="Name">
        <button type="button" class="ep-hub-icon ${profession.removed ? "active" : ""}" data-act="prof-remove" data-index="${index}" title="${profession.removed ? "Keep" : "Remove (XP is kept)"}"><i class="fas ${profession.removed ? "fa-rotate-left" : "fa-trash"}"></i></button>
      </div>
      <div class="ep-hub-fields">
        <label class="ep-field"><span>Key</span>${profession.isNew ? `<input name="p_key_${index}" value="${escape(profession.key)}" placeholder="auto from name">` : `<code class="ep-hub-key">${escape(profession.key)}</code>`}</label>
        <label class="ep-field"><span>Check ability</span><select name="p_ability_${index}">${abilities(profession.ability)}</select></label>
      </div>
      <div class="ep-field"><span>Any-tier rare table <small>(used where a tier has none)</small></span>
        ${slot({ uuid: profession.rareTable, empty: "Drop a Rollable Table", drop: { kind: "anytier", data: { index } }, clear: { act: "anytier-clear", data: { index } } })}</div>
      ${profession.removed ? '<p class="ep-hub-note ep-hub-warn">Will be removed on save. Characters keep their XP.</p>' : ""}
    </article>`).join("");
  return `<div class="ep-hub-grid ep-hub-grid-2">${cards}
      <button type="button" class="ep-hub-card ep-hub-add" data-act="prof-add"><i class="fas fa-plus"></i> Add a profession</button></div>
    <p class="ep-hub-note">Keys cannot change after saving, because characters store XP under them. Removing a profession keeps every character's XP; its materials fall back to Gatherer's normal awards.</p>
    <footer class="ep-hub-footer"><button type="button" class="ep-hub-primary" data-act="save-professions"><i class="fas fa-floppy-disk"></i> Save professions</button></footer>`;
}

function treeSection() {
  const config = skillTreeConfig();
  const trees = availableSkillTrees();
  const tree = configuredSkillTree();
  const active = Boolean(game.modules.get(SKILL_TREE_ID)?.active);
  const skills = Array.from(tree?.pages ?? []).filter(page => page.getFlag?.(MODULE_ID, "universalSkill")).length;
  return `${active ? "" : '<p class="ep-hub-note ep-hub-warn"><i class="fas fa-triangle-exclamation"></i> The Skill Tree module is not active. Settings save, but no points are granted until it is enabled.</p>'}
    <div class="ep-hub-grid ep-hub-grid-2">
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-diagram-project"></i> Linked tree</div>
        <label class="ep-field"><span>Tree</span><select name="treeUuid">${option("", "No tree linked", config.uuid)}${trees.map(entry => option(entry.uuid, entry.name, config.uuid)).join("")}</select></label>
        <div class="ep-hub-stat">${tree ? `<i class="fas fa-circle-check"></i> ${escape(tree.name)}${skills ? ` · ${skills} gathering skills` : ""}` : '<i class="fas fa-circle-xmark"></i> None'}</div>
        <div class="ep-hub-actions">
          <button type="button" class="ep-hub-ghost" data-act="open-tree" ${tree ? "" : "disabled"}><i class="fas fa-book-open"></i> Open tree</button>
          <button type="button" class="ep-hub-ghost" data-act="check-content" title="Link the gathering tree (or build it) and build missing rare tables, tools, and difficulty values"><i class="fas fa-box-open"></i> Check gathering content</button>
        </div></section>
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-coins"></i> Skill points</div>
        <div class="ep-hub-fields">
          <label class="ep-field"><span>Points at rank 1</span>${number("startingPoints", config.startingPoints, 0, 100)}</label>
          <label class="ep-field"><span>Points per rank-up</span>${number("pointsPerRank", config.pointsPerRank, 0, 100)}</label>
        </div>
        <p class="ep-hub-note">A character has rank-1 points plus points per rank-up for their profession's rank; saving tops everyone up. Points are never removed.</p></section>
    </div>
    <details class="ep-hub-card ep-hub-details"><summary><i class="fas fa-code"></i> Skill Tree requirement keys</summary>
      <p class="ep-hub-note"><code>flags.${MODULE_ID}.professionRank</code> (rank in the selected profession, 0–5), <code>flags.${MODULE_ID}.effectiveRank.&lt;key&gt;</code>, <code>flags.${MODULE_ID}.selectedProfession</code>.</p></details>
    <footer class="ep-hub-footer"><button type="button" class="ep-hub-primary" data-act="save-tree"><i class="fas fa-floppy-disk"></i> Save skill tree settings</button></footer>`;
}

function toolTile(tool, profession, index) {
  const doc = linkedDoc(tool.uuid);
  const durability = doc?.document ? toolDurability(doc.document) : null;
  const bonus = Number(doc?.document?.system?.proficient) > 0;
  return `<div class="ep-tool-tile ${doc?.missing ? "missing" : ""}">
      ${tool.img || doc?.img ? `<img src="${escape(tool.img || doc.img)}" alt="">` : '<i class="fas fa-screwdriver-wrench"></i>'}
      <div class="ep-tool-text"><strong>${escape(doc && !doc.missing ? doc.name : tool.name)}</strong>
        <small>${doc?.missing ? "Item missing" : [bonus ? "Proficient: adds proficiency" : "No bonus", durability ? (durability.unbreakable ? "Never wears" : `Durability ${durability.max}`) : ""].filter(Boolean).join(" · ")}</small></div>
      <a class="ep-slot-clear" data-act="tool-remove" data-prof="${escape(profession)}" data-index="${index}" title="Stop accepting this tool"><i class="fas fa-xmark"></i></a>
    </div>`;
}

function toolsSection(view) {
  const cards = Object.values(PROFESSIONS).map(profession => {
    const tools = view.tools[profession.key] ?? [];
    return `<section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-hammer"></i> ${escape(profession.label)}
        <small>${tools.length ? `${tools.length} accepted` : "No tool required"}</small></div>
      <div class="ep-tool-tiles">${tools.map((tool, index) => toolTile(tool, profession.key, index)).join("")}</div>
      ${slot({ uuid: "", empty: "Drop a tool Item to accept it", drop: { kind: "tool", data: { prof: profession.key } }, clear: { act: "" } })}
    </section>`;
  }).join("");
  return `<div class="ep-hub-grid ep-hub-grid-2">${cards}</div>
    <p class="ep-hub-note">The best carried accepted tool is used (a proficient tool adds proficiency), and a natural 1 on the check costs it 1 durability. A node with its own tools (Node Manager → Basics → Tools) requires those instead, e.g. a deep vein that only accepts a Mithril Pick.</p>
    <footer class="ep-hub-footer">
      <button type="button" class="ep-hub-ghost" data-act="build-tools" title="Miner's Pick, Herbalism Sickle, Woodcutter's Axe, Skinning Knife"><i class="fas fa-wand-magic-sparkles"></i> Create basic tools where missing</button>
      <button type="button" class="ep-hub-primary" data-act="save-tools"><i class="fas fa-floppy-disk"></i> Save tools</button></footer>`;
}

function rareSection(view) {
  const rows = Object.values(PROFESSIONS).map(profession => {
    const tables = view.rare[profession.key] ?? ["", "", "", "", ""];
    return `<div class="ep-rare-row"><div class="ep-rare-prof"><i class="fas fa-hammer"></i> ${escape(profession.label)}</div>
      ${tables.map((uuid, tier) => `<div class="ep-rare-tier"><span class="ep-rare-tier-label">Tier ${tier + 1}</span>
        ${slot({ uuid, empty: "Drop a table", drop: { kind: "rare", data: { prof: profession.key, tier } }, clear: { act: "rare-clear", data: { prof: profession.key, tier } } })}</div>`).join("")}
    </div>`;
  }).join("");
  return `<p class="ep-hub-note">A rare find starts on the material's tier. A natural 20 on the check moves it up one tier; the player then rolls the Fortune die at each higher table and climbs again on a 20. Past tier 5 the GM reveals a story discovery. Empty tiers use the profession's any-tier table.</p>
    <div class="ep-rare-grid">${rows}</div>
    <footer class="ep-hub-footer">
      <button type="button" class="ep-hub-ghost" data-act="build-rare" title="Three unique Items per tier for Mining, Herbalism, Logging, and Skinning"><i class="fas fa-wand-magic-sparkles"></i> Build default rare finds for empty tiers</button>
      <button type="button" class="ep-hub-primary" data-act="save-rare"><i class="fas fa-floppy-disk"></i> Save rare tables</button></footer>`;
}

function rulesSection() {
  const rules = activeRules();
  const rows = Array.from({ length: 5 }, (_, index) => `<tr>
      <th>${index + 1}</th>
      <td>${number(`dc${index}`, rules.tierDc[index], 1, 100)}</td>
      <td>${number(`untrainedDc${index}`, rules.tierUntrainedDc[index], 0, 100)}</td>
      <td>${number(`tierXp${index}`, rules.tierXp[index], 0, 100000)}</td>
      <td>${index ? number(`rankXp${index}`, rules.rankXp[index], 1, 1000000) : '<span class="ep-hub-muted">0 XP</span>'}</td>
      <td>${number(`reduction${index}`, rules.rankDcReduction[index], 0, 100)}</td>
      <td><span class="ep-die-badge">d${RANK_DIE[index]}</span></td></tr>`).join("");
  return `<div class="ep-hub-grid ep-hub-grid-2">
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-arrow-up-right-dots"></i> Advancement</div>
        <label class="ep-field"><span>Rank advancement</span><select name="advancementMode">
          ${option("automatic", "Automatic when the XP threshold is reached", rules.milestoneAdvancement ? "milestone" : "automatic")}
          ${option("milestone", "GM awards ranks at milestones", rules.milestoneAdvancement ? "milestone" : "automatic")}</select></label>
        <p class="ep-hub-note">In milestone mode XP keeps accumulating and the GM sets ranks in the Professions menu.</p></section>
      <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-star"></i> Extraction</div>
        <label class="ep-check"><input type="checkbox" name="masterfulRareFind" ${rules.masterfulRareFind ? "checked" : ""}> Masterful extraction always earns a rare find</label>
        <div class="ep-hub-fields">
          <label class="ep-field"><span>Excellent rare-find bonus %</span>${number("excellentRareBonus", rules.excellentRareBonus, 0, 100)}</label>
          <label class="ep-field"><span>Default tool durability</span>${number("toolDurability", rules.toolDurability, 0, 1000)}</label>
          <label class="ep-field"><span>Free gathering attempts per long rest</span>${number("gatherAttemptsPerRest", rules.gatherAttemptsPerRest, 0, 100)}</label>
        </div>
        <p class="ep-hub-note">A natural 20 is always Masterful. Tools without their own maximum use the default durability; 0 = tools never wear. Gathering attempts count across every profession and Gatherer page. Beyond the free limit, each confirmed attempt adds 1 exhaustion. 0 attempts = unlimited. A long rest resets attempts.</p></section>
    </div>
    <section class="ep-hub-card"><div class="ep-hub-card-head"><i class="fas fa-table"></i> Tiers and ranks</div>
      <table class="ep-hub-table"><thead><tr><th>Tier / Rank</th><th>Base DC</th><th>Extra untrained DC</th><th>XP reward</th><th>Rank starts at</th><th>DC reduction</th><th>Die</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="ep-hub-note">Tier columns set each material tier's DC and XP. Rank columns set the XP needed and the DC reduction. Untrained checks add the extra untrained DC and bank XP without ranks.</p></section>
    <footer class="ep-hub-footer"><button type="button" class="ep-hub-primary" data-act="save-rules"><i class="fas fa-floppy-disk"></i> Save rules</button></footer>`;
}

/** Full hub markup for a view state (pure; used by tests and previews). */
export function renderHub(view) {
  const section = HUB_SECTIONS.find(entry => entry.id === view.section) ?? HUB_SECTIONS[0];
  const nav = HUB_SECTIONS.map(entry => `<a class="ep-hub-nav-item ${entry.id === section.id ? "active" : ""}" data-act="section" data-section="${entry.id}">
      <i class="fas ${entry.icon}"></i><span>${escape(entry.label)}</span></a>`).join("");
  const body = {
    professions: () => professionsSection(view), tree: () => treeSection(), tools: () => toolsSection(view),
    rare: () => rareSection(view), rules: () => rulesSection(), conditions: () => renderConditionsWindow(view.conditions)
  }[section.id]();
  return `<div class="ep-hub">
    <nav class="ep-hub-nav"><div class="ep-hub-brand"><i class="fas fa-hammer"></i><span>Eryndor<br>Professions</span></div>${nav}</nav>
    <section class="ep-hub-main">
      <header class="ep-hub-head"><div class="ep-hub-emblem"><i class="fas ${section.icon}"></i></div>
        <div><h1>${escape(section.label)}</h1><p>${escape(section.blurb)}</p></div></header>
      <form class="ep-hub-form" autocomplete="off" data-section="${section.id}">${body}</form>
    </section></div>`;
}

/** Fresh drafts from saved settings. */
export function initialHubView(section = "professions", options = {}) {
  const professions = Object.values(PROFESSIONS);
  return {
    section,
    professions: professions.map(profession => ({ ...profession, isNew: false, removed: false })),
    tools: Object.fromEntries(professions.map(profession => [profession.key, [...(profession.tools ?? [])]])),
    rare: Object.fromEntries(professions.map(profession => [profession.key, Array.from({ length: 5 }, (_, tier) => profession.rareTables?.[tier] ?? "")])),
    conditions: { tab: options.conditionsTab ?? "now", dcDraft: null, dcSpecific: null }
  };
}

/** Save only fields edited here; take tools and tier tables from current settings. */
export function professionDraftsForSave(view) {
  return view.professions.filter(entry => !entry.removed && (entry.label.trim() || entry.key.trim()))
    .map(({ isNew, removed, ...entry }) => {
      const current = PROFESSIONS[entry.key];
      return { ...entry, tools: current?.tools ?? entry.tools ?? [],
        rareTables: current?.rareTables ?? entry.rareTables ?? [] };
    });
}

/* ---------------------------------------------------------------------- */
/* Application                                                             */
/* ---------------------------------------------------------------------- */

let HubClass = null;
let hub = null;

function capture(view, form) {
  if (!form) return;
  if (form.dataset.section === "professions") {
    view.professions = view.professions.map((profession, index) => ({
      ...profession,
      label: form.querySelector(`[name='p_label_${index}']`)?.value ?? profession.label,
      key: profession.isNew ? form.querySelector(`[name='p_key_${index}']`)?.value ?? profession.key : profession.key,
      ability: form.querySelector(`[name='p_ability_${index}']`)?.value ?? profession.ability
    }));
  }
}

async function dropped(event) {
  let data;
  try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
  return data?.uuid ? { type: data.type, uuid: data.uuid } : null;
}

function defineClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class GatheringHub extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "eryndor-professions-hub",
      classes: ["eryndor-professions-ui", "ep-hub-window"],
      tag: "div",
      window: { title: "Eryndor Professions", icon: "fas fa-hammer", resizable: true },
      position: { width: 1080, height: 760 }
    };

    view = initialHubView();

    async _prepareContext() { return {}; }
    async _renderHTML() { return renderHub(this.view); }
    _replaceHTML(result, content) {
      content.innerHTML = result;
      bindConditionInputs(content.querySelector(".ep-hub-form"));
    }

    get form() { return this.element?.querySelector(".ep-hub-form"); }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("click", event => {
        const button = event.target.closest?.("[data-act]");
        if (!button || button.disabled) return;
        event.preventDefault();
        void this.#act(button).catch(report);
      });
      this.element.addEventListener("dragover", event => { if (event.target.closest?.("[data-drop]")) event.preventDefault(); });
      this.element.addEventListener("drop", event => {
        const target = event.target.closest?.("[data-drop]");
        if (!target) return;
        event.preventDefault();
        void this.#drop(target, event).catch(report);
      });
    }

    _onClose(options) { super._onClose?.(options); hub = null; }

    async #drop(target, event) {
      const data = await dropped(event);
      const kind = target.dataset.drop;
      const wants = kind === "tool" ? "Item" : "RollTable";
      if (data?.type !== wants) return ui.notifications.warn(kind === "tool" ? "Drop an Item here." : "Drop a Rollable Table here.");
      const document = await fromUuid(data.uuid);
      if (!document) return ui.notifications.warn("That document could not be found.");
      capture(this.view, this.form);
      if (kind === "tool") {
        const list = this.view.tools[target.dataset.prof] ??= [];
        if (!list.some(tool => tool.uuid === document.uuid)) list.push({ uuid: document.uuid, name: document.name, img: document.img ?? "" });
      } else if (kind === "rare") this.view.rare[target.dataset.prof][Number(target.dataset.tier)] = document.uuid;
      else if (kind === "anytier") this.view.professions[Number(target.dataset.index)].rareTable = document.uuid;
      return this.render();
    }

    async #act(button) {
      const api = game.modules.get(MODULE_ID).api;
      const view = this.view;
      const form = this.form;
      const act = button.dataset.act;
      if (view.section === "conditions" && await handleConditionsAction(act, button, form, view.conditions)) return this.render();
      const values = () => Object.fromEntries(Array.from(form.querySelectorAll("[name]")).map(input =>
        [input.name, input.type === "checkbox" ? input.checked : input.value]));
      switch (act) {
        case "section":
          capture(view, form);
          view.section = button.dataset.section;
          return this.render();
        case "prof-add":
          capture(view, form);
          view.professions.push({ key: "", label: "", ability: "str", rareTable: "", rareTables: [], tools: [], isNew: true, removed: false });
          return this.render();
        case "prof-remove": {
          capture(view, form);
          const entry = view.professions[Number(button.dataset.index)];
          if (entry.isNew) view.professions.splice(Number(button.dataset.index), 1);
          else entry.removed = !entry.removed;
          return this.render();
        }
        case "anytier-clear":
          capture(view, form);
          view.professions[Number(button.dataset.index)].rareTable = "";
          return this.render();
        case "save-professions": {
          capture(view, form);
          await api.setProfessions(professionDraftsForSave(view));
          ui.notifications.info("Professions saved.");
          this.view = initialHubView("professions");
          return this.render();
        }
        case "open-tree": return configuredSkillTree()?.sheet?.render(true);
        case "check-content": {
          const result = await api.content.ensure({ force: true });
          ui.notifications.info(`Gathering content ready: ${result.tree}${result.rareTables ? `, ${result.rareTables} rare tables built` : ""}${result.tools ? `, ${result.tools} tools created` : ""}${result.conditionDc ? `, ${result.conditionDc} difficulty values set` : ""}.`);
          this.view = initialHubView(view.section);
          return this.render();
        }
        case "save-tree": {
          const data = values();
          const config = await api.setSkillTreeConfig({ uuid: data.treeUuid, pointsPerRank: Number(data.pointsPerRank), startingPoints: Number(data.startingPoints) });
          const granted = config.uuid ? await api.syncAllActors() : 0;
          ui.notifications.info(`Skill tree settings saved.${granted ? ` Granted ${granted} owed point${granted === 1 ? "" : "s"}.` : ""}`);
          return this.render();
        }
        case "tool-remove":
          view.tools[button.dataset.prof].splice(Number(button.dataset.index), 1);
          return this.render();
        case "save-tools":
          await api.setProfessions(Object.values(PROFESSIONS).map(entry => ({ ...entry, tools: view.tools[entry.key] ?? [] })));
          ui.notifications.info("Gathering tools saved.");
          return this.render();
        case "build-tools": {
          const created = await api.tools.buildDefaults();
          ui.notifications.info(created ? `Created ${created} basic tool${created === 1 ? "" : "s"}.` : "Every profession already has tools.");
          this.view = initialHubView("tools");
          return this.render();
        }
        case "rare-clear":
          view.rare[button.dataset.prof][Number(button.dataset.tier)] = "";
          return this.render();
        case "save-rare":
          await api.setProfessions(Object.values(PROFESSIONS).map(entry => ({ ...entry, rareTables: view.rare[entry.key] ?? entry.rareTables })));
          ui.notifications.info("Rare tables saved.");
          return this.render();
        case "build-rare": {
          await api.setProfessions(Object.values(PROFESSIONS).map(entry => ({ ...entry, rareTables: view.rare[entry.key] ?? entry.rareTables })));
          const built = await api.rareFinds.build();
          ui.notifications.info(built.tables ? `Built ${built.tables} rare tables with ${built.items} Items.` : "Every tier already has a table.");
          this.view = initialHubView("rare");
          return this.render();
        }
        case "save-rules":
          await saveRulesValues(values());
          return this.render();
      }
    }
  };
}

/** Open the GM hub on a section ("professions", "tree", "tools", "rare", "rules", "conditions"). */
export async function openHub(section = "professions", options = {}) {
  if (!game.user.isGM) return null;
  HubClass ??= defineClass();
  if (!hub) {
    hub = new HubClass();
    hub.view = initialHubView(section, options);
  } else {
    hub.view.section = section;
    if (options.conditionsTab) hub.view.conditions.tab = options.conditionsTab;
  }
  await hub.render({ force: true });
  hub.bringToFront?.();
  return hub;
}
