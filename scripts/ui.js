import {
  MODULE_ID, PROFESSIONS, RANK_DIE,
  activeRules, materialRule, rankForXp, rankForActor, selectedProfession, professionFlag, professionKey
} from "./rules.js";
import { openNodeManager } from "./node-ui.js";
import { rulesEditorHtml, bindRulesEditors, parseRules, openConditionsWindow } from "./conditions-ui.js";
import { SKILL_TREE_ID, skillTreeApi, configuredSkillTree } from "./integrations.js";
import { PERK_EFFECTS, readPerk } from "./perks.js";
import { toolDurability } from "./durability.js";
import { getToolLibrary } from "./nodes.js";
import { gpDialog } from "./dialogs.js";

const Dialog = () => gpDialog();
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

function content(html) {
  const element = document.createElement("div");
  // Foundry DialogV2 requires its content element to be a bare div.
  element.innerHTML = `<div class="gathering-professions-ui">${html}</div>`;
  return element;
}

function option(value, label, selected) {
  return `<option value="${escape(value)}" ${value === selected ? "selected" : ""}>${escape(label)}</option>`;
}

function number(value, name, min, max = 100000) {
  return `<input name="${name}" type="number" min="${min}" max="${max}" step="1" value="${escape(value)}" required>`;
}

function optionalNumber(value, name, min, max = 100000) {
  return `<input name="${name}" type="number" min="${min}" max="${max}" step="1" value="${escape(value ?? "")}" placeholder="Tier default">`;
}

// Let the GM drag a Rollable Table from the sidebar onto a UUID field.
function attachTableDrops(root) {
  root?.querySelectorAll?.("[data-table-drop]").forEach(input => {
    input.addEventListener("dragover", event => event.preventDefault());
    input.addEventListener("drop", event => {
      event.preventDefault();
      let data;
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
      if (data?.type === "RollTable" && data.uuid) input.value = data.uuid;
      else ui.notifications.warn("Drop a Rollable Table here.");
    });
  });
}

function tableInput(name, value) {
  return `<input name="${name}" type="text" value="${escape(value ?? "")}" placeholder="Drop a Rollable Table or paste its UUID" data-table-drop>`;
}

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Could not save profession settings.");
}

export async function openMaterialEditor(item) {
  if (!game.user.isGM || !item || item.parent || item.pack) return false;
  const override = item.getFlag(MODULE_ID, "material");
  const effective = materialRule(item);
  const assignment = override?.enabled === false ? "none" :
    professionKey(override?.profession) || (effective ? "automatic" : "none");
  const choices = [option("automatic", "Use mining default (if available)", assignment),
    option("none", "No profession check", assignment),
    ...Object.entries(PROFESSIONS).map(([key, value]) => option(key, value.label, assignment))].join("");
  const form = content(`
    <p class="hint">Set the profession for this Item. Gatherer must return this Item as a document result.</p>
    <div class="form-group"><label>Profession</label><select name="assignment">${choices}</select></div>
    <div class="form-group"><label>Tier</label><select name="tier">${[1, 2, 3, 4, 5].map(tier => option(String(tier), `Tier ${tier}`, String(override?.tier ?? effective?.tier ?? 1))).join("")}</select></div>
    <div class="form-group"><label>Base DC</label>${optionalNumber(override?.dc, "dc", 1, 100)}</div>
    <div class="form-group"><label>Extra untrained DC</label>${number(effective?.untrainedDc ?? override?.untrainedDc ?? 0, "untrainedDc", 0)}</div>
    <p class="hint">Untrained DC = full Base DC + the tier's extra untrained DC + this material's extra untrained DC. No rank reduction applies.</p>
    <div class="form-group"><label>XP on success</label>${optionalNumber(override?.xp, "xp", 0)}</div>
    <div class="form-group"><label>Base Yield</label><input name="baseYield" type="text" value="${escape(effective?.baseYield ?? override?.baseYield ?? "1")}" placeholder="1" aria-label="Base Yield"></div>
    <p class="hint">Base Yield is a dice formula, such as 1d4 or 1d2 + 1, producing positive whole quantities. Blank defaults to 1. Blank DC and XP use tier rules.</p>
    <p class="hint">Partial: 1 item, no XP. Success: Base Yield. Excellent: Base Yield + 1. Masterful: maximum Base Yield + 1. Full failures grant nothing.</p>
    <div class="form-group"><label>Rare-find table</label>${tableInput("rareTable", override?.rareTable)}</div>
    <p class="hint">Optional. Blank uses the profession's rare-find table. Masterful results and rare-find perks draw from it.</p>
    <h3>Conditions</h3>
    ${rulesEditorHtml(override?.conditions ?? [], "conditions")}
    <p class="hint">Multiply this material's weight in a node's table when a condition matches, e.g. Night ×3, Winter ×0. Several matching rules multiply together. A node can override these in its Materials tab.</p>
    <button type="button" data-open-rules>Open Tier &amp; Rank Rules</button>
  `);
  const values = await Dialog().input({
    window: { title: `Material — ${item.name}` }, content: form,
    position: { width: 480 }, ok: { label: "Save material" },
    render: (_event, dialog) => {
      dialog.element.querySelector("[data-open-rules]")?.addEventListener("click", () => openRulesHub());
      attachTableDrops(dialog.element);
      bindRulesEditors(dialog.element);
    }
  });
  if (!values) return false;
  try {
    if (values.assignment === "none") {
      await item.setFlag(MODULE_ID, "material", { enabled: false });
    } else {
      const material = { profession: values.assignment, tier: Number(values.tier), baseYield: String(values.baseYield ?? "").trim() || "1", untrainedDc: Number(values.untrainedDc ?? 0), rareTable: String(values.rareTable ?? "").trim(), conditions: parseRules(values.conditions) };
      if (String(values.dc ?? "").trim() !== "") material.dc = Number(values.dc);
      if (String(values.xp ?? "").trim() !== "") material.xp = Number(values.xp);
      if (material.dc !== undefined && (!Number.isInteger(material.dc) || material.dc < 1 || material.dc > 100)) throw new Error("DC must be a whole number from 1 to 100.");
      if (material.xp !== undefined && (!Number.isInteger(material.xp) || material.xp < 0)) throw new Error("XP must be a nonnegative whole number.");
      await game.modules.get(MODULE_ID).api.setMaterial(item, material);
    }
    ui.notifications.info(`Saved profession material: ${item.name}`);
    return true;
  } catch (error) { report(error); return false; }
}

/**
 * Validate and save rule form values (GM hub Rules tab). Throws a
 * readable Error. Field names: advancementMode, masterfulRareFind,
 * excellentRareBonus, toolDurability, gatherAttemptsPerRest, craftingTimed, refineDc0–4, refineXp0–4, refineMinutes0–4, dc0–4, untrainedDc0–4, tierXp0–4,
 * rankXp1–4, reduction0–4.
 */
export async function saveRulesValues(values) {
  if (!game.user.isGM) throw new Error("Only the GM may edit profession rules.");
  const rules = activeRules();
  {
    const next = { tierDc: [], tierUntrainedDc: [], tierXp: [], rankXp: [0], rankDcReduction: [],
      milestoneAdvancement: values.advancementMode === "milestone", masterfulRareFind: values.masterfulRareFind === true,
      excellentRareBonus: Number(values.excellentRareBonus ?? rules.excellentRareBonus),
      toolDurability: Number(values.toolDurability ?? rules.toolDurability),
      gatherAttemptsPerRest: Number(values.gatherAttemptsPerRest ?? rules.gatherAttemptsPerRest),
      craftingTimed: values.craftingTimed === undefined ? rules.craftingTimed : values.craftingTimed === true };
    const tierValues = (key, fallback) => Array.from({ length: 5 }, (_, index) => (values[`${key}${index}`] === undefined ? fallback[index] : Number(values[`${key}${index}`])));
    next.refineDc = tierValues("refineDc", rules.refineDc);
    next.refineXp = tierValues("refineXp", rules.refineXp);
    if (next.refineDc.some(value => !Number.isInteger(value) || value < 1 || value > 100)) throw new Error("Refining DC must be a whole number from 1 to 100 per tier.");
    if (next.refineXp.some(value => !Number.isInteger(value) || value < 0 || value > 100000)) throw new Error("Refining XP must be a whole number of 0 or more per tier.");
    if (!Number.isInteger(next.toolDurability) || next.toolDurability < 0 || next.toolDurability > 1000) throw new Error("Default tool durability must be a whole number from 0 to 1000.");
    if (!Number.isInteger(next.gatherAttemptsPerRest) || next.gatherAttemptsPerRest < 0 || next.gatherAttemptsPerRest > 100) throw new Error("Free gathering attempts must be a whole number from 0 to 100 (0 = unlimited).");
    if (!Number.isInteger(next.excellentRareBonus) || next.excellentRareBonus < 0 || next.excellentRareBonus > 100) throw new Error("The Excellent rare-find bonus must be a whole number from 0 to 100.");
    if (!['automatic', 'milestone'].includes(values.advancementMode)) throw new Error("Choose an advancement mode.");
    next.refineMinutes = Array.from({ length: 5 }, (_, index) => (values[`refineMinutes${index}`] === undefined ? rules.refineMinutes[index] : Number(values[`refineMinutes${index}`])));
    if (next.refineMinutes.some(value => !Number.isInteger(value) || value < 0 || value > 10080)) throw new Error("Refining time must be whole minutes from 0 to 10080 (one week) per tier.");
    for (let index = 0; index < 5; index++) {
      next.tierDc.push(Number(values[`dc${index}`]));
      next.tierUntrainedDc.push(Number(values[`untrainedDc${index}`] ?? 0));
      next.tierXp.push(Number(values[`tierXp${index}`]));
      next.rankDcReduction.push(Number(values[`reduction${index}`]));
      if (index) next.rankXp.push(Number(values[`rankXp${index}`]));
    }
    for (const [key, entries] of Object.entries(next).filter(([, entries]) => Array.isArray(entries))) {
      if (entries.some(value => !Number.isInteger(value) || value < 0)) throw new Error(`${key} must contain nonnegative whole numbers.`);
    }
    if (next.tierDc.some(value => value < 1 || value > 100)) throw new Error("Base DC must be from 1 to 100.");
    if (next.rankXp.some((value, index) => index && value <= next.rankXp[index - 1])) throw new Error("Each rank needs more XP than the previous rank.");
    if (!rules.milestoneAdvancement && next.milestoneAdvancement) {
      for (const actor of game.actors) {
        if (actor.type !== "character") continue;
        const key = selectedProfession(actor);
        if (key) {
          const xp = Math.max(0, Number(professionFlag(actor, "xp", key)) || 0);
          await actor.setFlag(MODULE_ID, `rank.${key}`, rankForXp(xp));
        }
      }
    }
    await game.settings.set(MODULE_ID, "rules", next);
    // Mode changes can move ranks: refresh mirrored ranks and Skill Tree points.
    if (next.milestoneAdvancement !== rules.milestoneAdvancement) await game.modules.get(MODULE_ID).api.syncAllActors?.();
    ui.notifications.info("Profession rules saved.");
    return true;
  }
}

export async function openProgressEditor(actor) {
  if (!actor || actor.type !== "character" || (!game.user.isGM && !actor.isOwner)) return false;
  const canEdit = game.user.isGM;
  const selected = selectedProfession(actor);
  const canChoose = canEdit || !selected;
  const rules = activeRules();
  const manual = rules.milestoneAdvancement;
  const rows = Object.entries(PROFESSIONS).map(([key, profession]) => {
    const xp = Math.max(0, Number(professionFlag(actor, "xp", key)) || 0);
    const rank = rankForActor(actor, key, xp);
    const next = rank ? rules.rankXp[rank] ?? "Max" : "—";
    const rankCell = canEdit && manual && rank
      ? `<select name="rank_${key}" aria-label="${profession.label} rank">${[1, 2, 3, 4, 5].map(value => option(String(value), `Rank ${value}`, String(rank))).join("")}</select>`
      : rank || "Untrained (0)";
    return `<tr><th>${profession.label}${rank ? " ★" : ""}</th><td>${rankCell}</td><td>${rank ? `d${RANK_DIE[rank - 1]}` : "—"}</td><td>${canEdit ? number(xp, key, 0) : xp}${rank ? "" : " (banked)"}</td>${canEdit ? `<td>${next}</td>` : ""}</tr>`;
  }).join("");
  const selection = canChoose ? `<div class="form-group"><label>Gathering profession</label><select name="selectedProfession">${option("", canEdit ? "None selected" : "Choose your profession…", selected ?? "")}${Object.entries(PROFESSIONS).map(([key, value]) => option(key, value.label, selected)).join("")}</select></div>` : "";
  const playerHint = selected
    ? "This profession grants your rank and profession die. Ask the GM to change it."
    : "Choose your gathering profession. Ask the GM if you need to change it later.";
  const gmHints = `<p class="hint">Choose one profession. Only it grants a rank, profession die, and DC reduction. Changing the selection keeps all XP and saved ranks. Save, then reopen this menu to edit the new profession’s milestone rank.</p>
    <p class="hint">Other attempts use d20 + ability modifier against full Base DC plus tier and material extras. Successful untrained attempts bank XP without granting a rank or bonuses.</p>
    ${manual ? '<p class="hint">Ranks are awarded by the GM. XP continues to accumulate; the next-rank XP value is a guide.</p>' : ''}`;
  // Companion modules add their own sections (e.g. crafting professions).
  const sections = [];
  Hooks.callAll("gatheringProfessions.menuSections", { actor, canEdit, sections });
  const extra = sections.map(section => `<section class="gp-menu-section">${section.html ?? ""}</section>`).join("");
  const html = content(`<p class="gp-selected-profession"><strong>Gathering profession: ${selected ? escape(PROFESSIONS[selected].label) : "None selected"}</strong></p>
    ${selection}<p class="hint">${canEdit ? gmHints : playerHint}</p>
    <div class="gp-scroll"><table><thead><tr><th>Profession</th><th>Rank</th><th>Die</th><th>Total XP</th>${canEdit ? `<th>${manual ? "Next-rank XP guide" : "Next rank at"}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>${canEdit ? '<button type="button" data-open-rules>Open Tier &amp; Rank Rules</button>' : ""}${extra}`);
  const bindExtras = dialog => Hooks.callAll("gatheringProfessions.menuRender", { actor, canEdit, element: dialog.element, dialog });
  if (!canChoose) {
    await Dialog().prompt({ window: { title: `${actor.name} — Professions` }, content: html, ok: { label: "Close" }, position: { width: 580 }, render: (_event, dialog) => bindExtras(dialog) });
    return false;
  }
  const values = await Dialog().input({
    window: { title: `${actor.name} — Professions` }, content: html,
    position: { width: 680 }, ok: { label: canEdit ? "Save profession & progress" : "Choose profession" },
    render: (_event, dialog) => {
      dialog.element.querySelector("[data-open-rules]")?.addEventListener("click", () => openRulesHub());
      bindExtras(dialog);
    }
  });
  if (!values) return false;
  try {
    const api = game.modules.get(MODULE_ID).api;
    const choice = values.selectedProfession ?? selected ?? "";
    if (choice && !Object.hasOwn(PROFESSIONS, choice)) throw new Error("Choose a valid profession.");
    if (!canEdit) {
      await api.selectProfession(actor, choice);
      ui.notifications.info(`${actor.name} chose ${PROFESSIONS[choice].label}.`);
      return true;
    }
    for (const key of Object.keys(PROFESSIONS)) {
      const xp = Number(values[key]);
      if (!Number.isInteger(xp) || xp < 0) throw new Error(`${PROFESSIONS[key].label} XP must be a nonnegative whole number.`);
      if (manual && key === selected) {
        const rank = Number(values[`rank_${key}`]);
        if (!Number.isInteger(rank) || rank < 1 || rank > 5) throw new Error(`${PROFESSIONS[key].label} rank must be from 1 to 5.`);
      }
    }
    for (const key of Object.keys(PROFESSIONS)) {
      const xp = Number(values[key]);
      if (xp !== Number(professionFlag(actor, "xp", key) || 0)) await api.setXp(actor, key, xp);
      if (manual && key === selected) {
        const rank = Number(values[`rank_${key}`]);
        if (rank !== rankForActor(actor, key, xp)) await api.setRank(actor, key, rank);
      }
    }
    if ((choice || null) !== selected) await api.selectProfession(actor, choice);
    ui.notifications.info(`Saved profession and progress for ${actor.name}.`);
    return true;
  } catch (error) { report(error); return false; }
}

function accessibleCharacter(actor) {
  return actor?.type === "character" && (game.user.isGM || actor.isOwner);
}

function shortcutActor() {
  const selected = (globalThis.canvas?.tokens?.controlled ?? []).map(token => token.actor).filter(accessibleCharacter);
  const unique = [...new Set(selected)];
  if (unique.length === 1) return unique[0];
  if (!unique.length && accessibleCharacter(game.user.character)) return game.user.character;
  return null;
}

async function chooseShortcutCharacter(title, action) {
  let actor = shortcutActor();
  if (!actor) {
    const characters = Array.from(game.actors).filter(accessibleCharacter);
    if (!characters.length) {
      ui.notifications.info("No owned character found. Ask the GM to assign you a character.");
      return false;
    }
    if (characters.length === 1) actor = characters[0];
    else {
      const values = await Dialog().input({
        window: { title: `Choose a character — ${title}` },
        content: content(`<div class="form-group"><label>Character</label><select name="actorId">${characters.map(character => option(character.id, character.name, "")).join("")}</select></div>`),
        ok: { label: action }
      });
      if (!values) return null;
      actor = characters.find(character => character.id === values.actorId);
    }
  }
  return actor ?? null;
}

export async function openProfessionMenu() {
  const actor = await chooseShortcutCharacter("Professions", "Open profession");
  if (!actor) return false;
  return openProgressEditor(actor);
}

export async function openSkillTree() {
  const SkillTreeActor = skillTreeApi()?.apps?.SkillTreeActor;
  if (!SkillTreeActor) {
    ui.notifications.warn("The Skill Tree module is not active.");
    return false;
  }
  const tree = configuredSkillTree();
  if (!tree?.getFlag?.(SKILL_TREE_ID, "isSkillTree")) {
    ui.notifications.warn("No gathering skill tree is linked. Ask the GM to link one.");
    return false;
  }
  if (!tree.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)) {
    ui.notifications.warn("You do not have permission to view the gathering skill tree.");
    return false;
  }
  const actor = await chooseShortcutCharacter("Skill Tree", "Open skill tree");
  if (!actor) return false;
  if (actor.getFlag(SKILL_TREE_ID, "selectedSkillTree") !== tree.uuid) {
    await actor.setFlag(SKILL_TREE_ID, "selectedSkillTree", tree.uuid);
  }
  await new SkillTreeActor(actor).render(true);
  return true;
}

export function registerSceneControls() {
  // Register during init so the tool exists on the first canvas render.
  Hooks.on("getSceneControlButtons", controls => {
    if (!controls.tokens?.tools) return;
    const order = Object.keys(controls.tokens.tools).length;
    controls.tokens.tools["gp-professions"] = {
      name: "gp-professions", title: "Gathering Profession — Choose / View",
      icon: "fas fa-hammer", order,
      button: true, visible: true, onChange: () => { void openProfessionMenu().catch(report); }
    };
    controls.tokens.tools["gp-recipes"] = {
      name: "gp-recipes", title: "Recipes — Refine materials",
      icon: "fas fa-book-open", order: order + 2,
      button: true, visible: true, onChange: () => { void import("./recipes-ui.js").then(module => module.openRecipes()).catch(report); }
    };
    controls.tokens.tools["gp-skill-tree"] = {
      name: "gp-skill-tree", title: "Gathering Skill Tree — Open",
      icon: "fas fa-code-branch", order: order + 1,
      button: true, visible: true, onChange: () => { void openSkillTree().catch(report); }
    };
  });
}

/** Profession materials now live in the GM hub (Materials section). */
function openRulesHub() {
  void import("./hub.js").then(module => module.openHub("rules")).catch(report);
}

export function openMaterialManager(profession = null) {
  if (!game.user.isGM) return;
  void import("./hub.js").then(module => module.openHub("materials", typeof profession === "string" ? { profession } : {})).catch(report);
}

export function registerSettingsMenu() {
  // Foundry's settings UI requires an Application class for a submenu.
  const launcher = open => class extends foundry.applications.api.ApplicationV2 {
    render() {
      void Promise.resolve().then(open).catch(report);
      return Promise.resolve(this);
    }
  };
  const hub = section => launcher(() => import("./hub.js").then(module => module.openHub(section)));
  const menu = (key, name, label, hint, icon, type) => game.settings.registerMenu(MODULE_ID, key, { name, label, hint, icon, type, restricted: true });
  menu("hub", "Profession GM Hub", "Open GM Hub", "Gathering and crafting profession settings in one window, grouped in the sidebar.", "fas fa-hammer", hub("professions"));
  menu("professions", "Professions & Skill Tree", "Professions", "Add or rename professions and set their check ability.", "fas fa-users-gear", hub("professions"));
  menu("tools", "Gathering Tools", "Tools", "Each profession's accepted tools. Every gather needs one; nodes can require their own.", "fas fa-screwdriver-wrench", hub("tools"));
  menu("rareTables", "Rare-Find Tables", "Rare Finds", "One rare-find table per profession and material tier.", "fas fa-gem", hub("rare"));
  menu("conditions", "Conditions & Biomes", "Conditions", "Pin season, weather, or time; edit biomes; set how conditions change DCs.", "fas fa-cloud-sun-rain", hub("conditions"));
  menu("content", "Gathering Content", "Skill Tree & Content", "The linked gathering tree, skill points, and the module's content check.", "fas fa-diagram-project", hub("tree"));
  menu("nodes", "Gathering Nodes", "Open Node Manager", "Build, edit, place, reveal, and reset gathering nodes.", "fas fa-mountain-sun", launcher(() => openNodeManager()));
  menu("materials", "Profession Materials", "Materials", "Each profession's gathering materials and rare finds, by tier.", "fas fa-cubes", hub("materials"));
}

export function registerUIHooks() {
  function addSkillResetButton(app, html) {
    if (!game.user.isGM) return;
    const SkillTreeActor = skillTreeApi()?.apps?.SkillTreeActor;
    if (!SkillTreeActor || !(app instanceof SkillTreeActor) || app.actor?.type !== "character") return;
    const tree = configuredSkillTree();
    if (!tree || app.skillTree?.uuid !== tree.uuid || !Array.from(tree.pages ?? []).some(page => page.getFlag?.(MODULE_ID, "universalSkill"))) return;
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
    const nav = root?.querySelector(".standard-form > nav");
    if (!nav || nav.querySelector(".gp-reset-skills")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gp-reset-skills";
    button.textContent = "Reset Skills";
    button.title = `Reset ${app.actor.name}'s gathering skills and refund their current profession points`;
    button.addEventListener("click", async () => {
      const confirmed = await Dialog().confirm({ window: { title: `Reset ${app.actor.name}'s skills?` },
        content: content(`<p>Clear ${escape(app.actor.name)}'s learned skills in this gathering tree and refund the points earned at their current profession rank?</p><p>Other skill trees stay unchanged.</p>`) });
      if (!confirmed) return;
      button.disabled = true;
      try {
        const result = await game.modules.get(MODULE_ID).api.resetSkills(app.actor, tree);
        ui.notifications.info(`${app.actor.name}'s gathering skills reset. ${result.points} points available.`);
        await app.render(true);
      } catch (error) { report(error); button.disabled = false; }
    });
    nav.appendChild(button);
  }
  Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    if (app.document?.type === "character") controls.push({
      action: "gathering-professions", icon: "fas fa-hammer", label: "Professions",
      onClick: () => openProgressEditor(app.document)
    });
  });
  Hooks.on("getActorSheetHeaderButtons", (app, controls) => {
    if (app.actor?.type === "character") controls.unshift({
      class: "gathering-professions", icon: "fas fa-hammer", label: "Professions",
      onclick: () => openProgressEditor(app.actor)
    });
  });
  Hooks.on("getHeaderControlsItemSheetV2", (app, controls) => {
    const item = app.document;
    if (game.user.isGM && item?.documentName === "Item" && !item.parent && !item.pack) controls.push({
      action: "gathering-material", icon: "fas fa-gem", label: "Material",
      onClick: () => openMaterialEditor(item)
    });
  });
  Hooks.on("getItemSheetHeaderButtons", (app, controls) => {
    const item = app.item;
    if (game.user.isGM && item && !item.parent && !item.pack) controls.unshift({
      class: "gathering-material", icon: "fas fa-gem", label: "Material",
      onclick: () => openMaterialEditor(item)
    });
  });
  // Tool durability: world tools (maximum) and characters' copies (current value).
  const isToolLike = item => item?.type === "tool" || Boolean(item?.getFlag?.(MODULE_ID, "durability"))
    || getToolLibrary().some(tool => tool.uuid === item?.uuid);
  Hooks.on("getHeaderControlsItemSheetV2", (app, controls) => {
    const item = app.document;
    if (game.user.isGM && item?.documentName === "Item" && !item.pack && isToolLike(item)) controls.push({
      action: "gathering-durability", icon: "fas fa-screwdriver-wrench", label: "Tool Durability",
      onClick: () => openDurabilityEditor(item)
    });
  });
  // Perks may sit on world Items (linked by Skill Tree) or on an actor's copy.
  Hooks.on("getHeaderControlsItemSheetV2", (app, controls) => {
    const item = app.document;
    if (game.user.isGM && item?.documentName === "Item" && !item.pack) controls.push({
      action: "gathering-perk", icon: "fas fa-star", label: "Gathering Perk",
      onClick: () => openPerkEditor(item)
    });
  });
  Hooks.on("getItemSheetHeaderButtons", (app, controls) => {
    const item = app.item;
    if (game.user.isGM && item && !item.pack) controls.unshift({
      class: "gathering-perk", icon: "fas fa-star", label: "Gathering Perk",
      onclick: () => openPerkEditor(item)
    });
  });
  function addManagerButton(_app, html) {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const header = root?.querySelector(".directory-header");
    if (!header || header.querySelector(".gp-manager-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gp-manager-button";
    button.innerHTML = '<i class="fas fa-gem"></i> Profession Materials';
    button.addEventListener("click", openMaterialManager);
    header.appendChild(button);
  }
  Hooks.on("renderItemDirectory", addManagerButton);
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app instanceof foundry.applications.sidebar.tabs.ItemDirectory) addManagerButton(app, html);
    addSkillResetButton(app, html);
  });
  const directory = ui.items;
  if (directory) {
    const attach = () => {
      if (directory.rendered) addManagerButton(directory, directory.element);
    };
    attach();
    directory.addEventListener("render", attach);
    directory.addEventListener("activate", attach);
  }
}

/** GM: a tool's durability and maximum; also repairs a broken tool. */
export async function openDurabilityEditor(item) {
  if (!game.user.isGM || !item) return false;
  const saved = item.getFlag(MODULE_ID, "durability") ?? {};
  const state = toolDurability(item);
  const values = await Dialog().input({
    window: { title: `Tool Durability — ${item.name}` },
    content: content(`<p class="hint">A natural 1 on a gathering check made with this tool costs 1 durability. At 0 it is broken: it no longer counts as a node's tool until repaired. Now: <strong>${state.unbreakable ? "never wears" : state.broken ? `broken (0/${state.max})` : `${state.value}/${state.max}`}</strong>.</p>
      <div class="form-group"><label>Maximum</label>${optionalNumber(saved.max, "max", 0, 1000).replace('placeholder="Tier default"', `placeholder="Default (${activeRules().toolDurability})"`)}</div>
      <div class="form-group"><label>Current</label>${optionalNumber(saved.value, "value", 0, 1000).replace('placeholder="Tier default"', 'placeholder="Full"')}</div>
      <div class="form-group"><label><input type="checkbox" name="repair"> Repair fully</label></div>
      <p class="hint">Maximum 0 = this tool never wears. Set the maximum on the world Item; each character's copy keeps its own current value.</p>`),
    position: { width: 460 }, ok: { label: "Save" }
  });
  if (!values) return false;
  try {
    const api = game.modules.get(MODULE_ID).api;
    const blank = value => value === "" || value === null || value === undefined ? null : Number(value);
    if (values.repair === true) {
      await api.durability.set(item, { max: blank(values.max), value: null });
    } else await api.durability.set(item, { max: blank(values.max), value: blank(values.value) });
    const next = toolDurability(item);
    ui.notifications.info(`${item.name}: ${next.unbreakable ? "never wears" : `${next.value}/${next.max}`}.`);
    return true;
  } catch (error) { report(error); return false; }
}


const PERK_SECTIONS = Object.freeze([
  ["Checks", ["checkBonus", "dcReduction", "checkDie", "partialAsFull", "rerolls", "masterfulUses"]],
  ["Yield & pulls", ["yieldBonus", "extraDraws", "conserveChance"]],
  ["Rare finds", ["rareChance", "rareAdvantage", "rareDraws", "rareDouble", "climbExpand", "climbAdvantage"]],
  ["Tools & training", ["toolBonus", "toolWithSkill", "toolDouble", "untrainedRelief"]],
  ["Discovery & conditions", ["ignoreConditionDc", "scarcityRelief", "seeOdds", "senseBonus", "senseAll"]],
  ["Assist", ["assistBonus", "assistDie", "assistUntrainedRelief"]]
]);
const FRACTION_CHOICES = Object.freeze([[0, "None"], [0.25, "Quarter"], [0.5, "Half"], [0.75, "Three quarters"], [1, "All"]]);

function perkField(key, value) {
  const effect = PERK_EFFECTS[key];
  const title = `title="${escape(effect.hint)}"`;
  if (effect.kind === "flag") {
    return `<div class="form-group" ${title}><label><input type="checkbox" name="${key}" ${value ? "checked" : ""}> ${escape(effect.label)}</label></div>`;
  }
  let input;
  if (effect.kind === "int") input = number(value ?? 0, key, 0, effect.max);
  else if (effect.kind === "die") input = `<select name="${key}">${[0, ...effect.dice].map(die => option(String(die), die ? `d${die}` : "None", String(value ?? 0))).join("")}</select>`;
  else input = `<select name="${key}">${FRACTION_CHOICES.map(([amount, label]) => option(String(amount), label, String(value ?? 0))).join("")}</select>`;
  return `<div class="form-group" ${title}><label>${escape(effect.label)}</label>${input}</div>`;
}

export async function openPerkEditor(item) {
  if (!game.user.isGM || !item) return false;
  const perk = readPerk(item);
  const selected = perk ? perk.profession : "none";
  const choices = [option("none", "No gathering perk", selected), option("any", "Any profession", selected),
    ...Object.values(PROFESSIONS).map(profession => option(profession.key, profession.label, selected))].join("");
  const sections = PERK_SECTIONS.map(([label, keys]) => `<fieldset><legend>${escape(label)}</legend>${keys.map(key => perkField(key, perk?.[key])).join("")}</fieldset>`).join("");
  const values = await Dialog().input({
    window: { title: `Gathering Perk — ${item.name}` },
    content: content(`<p class="hint">A character who owns this Item gains the perk. Link the Item to a Skill Tree skill so unlocking the skill grants it. Hover a field for details. Numbers from several perks add up; dice and shares use the largest.</p>
      <div class="form-group"><label>Applies to</label><select name="profession">${choices}</select></div>
      <div class="gp-perk-sections">${sections}</div>`),
    position: { width: 520, height: "auto" }, ok: { label: "Save perk" }
  });
  if (!values) return false;
  try {
    const api = game.modules.get(MODULE_ID).api;
    if (values.profession === "none") await api.setPerk(item, null);
    else {
      const perkValues = { profession: values.profession };
      for (const [key, effect] of Object.entries(PERK_EFFECTS)) perkValues[key] = effect.kind === "flag" ? values[key] === true : Number(values[key] ?? 0);
      await api.setPerk(item, perkValues);
    }
    ui.notifications.info(`Saved gathering perk: ${item.name}`);
    return true;
  } catch (error) { report(error); return false; }
}

