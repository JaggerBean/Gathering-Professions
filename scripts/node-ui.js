// Node Manager: one window with a grouped node list on the left and the
// selected node's details and tabbed editor on the right. Also map-pin placement.
import { MODULE_ID, PROFESSIONS, ABILITY_LABELS, materialRule } from "./rules.js";
import {
  NODE_DEFAULTS, readNode, linkGroupFor, allNodePages, isGathererPage, skillChoices, skillLabel, nodeUsage, isDepleted,
  pinsFor, tableMaterials, buildNode, updateNode, duplicateNode, deleteNode, resetNodes, setNodeHidden, placePin, placeLinkedNode,
  nodeTools, toolNames, getToolLibrary, addToolToLibrary, removeToolFromLibrary, createRareTable
} from "./nodes.js";
import { getBiomes } from "./conditions.js";
import { rulesEditorHtml, bindRulesEditors, parseRules, rulesSummary, openConditionsWindow } from "./conditions-ui.js";
import { gpDialog } from "./dialogs.js";

const Dialog = () => gpDialog();
export const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const option = (value, label, selected) => `<option value="${escape(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escape(label)}</option>`;
const num = (name, value, min, max, step = 1) => `<input name="${name}" type="number" step="${step}" min="${min}" max="${max}" value="${escape(value)}">`;
const TABS = [["basics", "Basics", "fa-circle-info"], ["materials", "Materials", "fa-gem"], ["rules", "Check & Rules", "fa-dice-d20"], ["visibility", "Visibility", "fa-eye"]];
const FALLBACK_ICON = "icons/svg/book.svg";

function report(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(error.message || "Node action failed.");
}

/* ---------------------------------------------------------------------- */
/* Pure view-model helpers (unit tested)                                   */
/* ---------------------------------------------------------------------- */

/** Material icons and drop chances from a node's table. */
export function nodeMaterials(page) {
  const table = globalThis.fromUuidSync?.(page?.flags?.gatherer?.table ?? "") ?? null;
  const results = Array.from(table?.results ?? []);
  const total = results.reduce((sum, result) => sum + (Number(result.weight) || 0), 0) || 1;
  return results.map(result => ({
    name: result.name ?? result.text ?? "Result", img: result.img || FALLBACK_ICON,
    weight: Number(result.weight) || 0, percent: Math.round(((Number(result.weight) || 0) / total) * 100),
    uuid: result.documentUuid ?? ""
  }));
}

export function nodeBadges(node) {
  if (!node) return [];
  const badges = [];
  if (node.hidden) badges.push({ icon: "fa-eye-slash", text: "Hidden", title: "Hidden from players", kind: "hidden" });
  if (node.hidden && node.senseRank) badges.push({ icon: "fa-wand-magic-sparkles", text: `Sense R${node.senseRank}`, title: `Visible to characters at ${PROFESSIONS[node.profession]?.label ?? "profession"} rank ${node.senseRank}+`, kind: "sense" });
  if (node.checkType !== "default" && node.checkKey) badges.push({ icon: "fa-dice-d20", text: node.checkType === "skill" ? skillLabel(node.checkKey) : ABILITY_LABELS[node.checkKey] ?? node.checkKey, title: "Check override", kind: "check" });
  if (node.minRank) badges.push({ icon: "fa-medal", text: `R${node.minRank}+`, title: `Requires rank ${node.minRank}`, kind: "rank" });
  const tools = toolNames(node);
  if (tools.length) badges.push({ icon: "fa-screwdriver-wrench", text: tools.join(" / "), title: `Requires ${tools.join(" or ")}`, kind: "tool" });
  if (node.dcModifier) badges.push({ icon: "fa-shield-halved", text: `DC ${node.dcModifier > 0 ? "+" : ""}${node.dcModifier}`, title: "DC modifier", kind: "dc" });
  if (node.yieldModifier) badges.push({ icon: "fa-boxes-stacked", text: `Yield ${node.yieldModifier > 0 ? "+" : ""}${node.yieldModifier}`, title: "Yield modifier", kind: "yield" });
  if (node.rareChance || node.rareTable) badges.push({ icon: "fa-gem", text: node.rareChance ? `Rare +${node.rareChance}%` : "Rare table", title: "Rare-find bonus", kind: "rare" });
  return badges;
}

function nodeSceneIds(page) {
  const ids = new Set(pinsFor(page).map(({ scene }) => scene.id));
  const key = page.parent?.getFlag?.(MODULE_ID, "nodeJournal");
  if (key && key !== "none") ids.add(key);
  return ids;
}

/**
 * Filtered nodes grouped by journal, sorted by name.
 * @returns {Array<{id: string, name: string, rows: object[]}>}
 */
export function buildListModel(pages, state = {}) {
  const search = String(state.search ?? "").trim().toLowerCase();
  const groups = new Map();
  for (const page of pages) {
    const node = readNode(page);
    if (state.profession && node?.profession !== state.profession) continue;
    if (state.scene && !nodeSceneIds(page).has(state.scene)) continue;
    if (search && !page.name.toLowerCase().includes(search) && !(page.parent?.name ?? "").toLowerCase().includes(search)) continue;
    const usage = nodeUsage(page);
    const materials = nodeMaterials(page);
    const entry = page.parent;
    const key = entry?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { id: key, name: entry?.name ?? "Unsorted", rows: [] });
    const pins = pinsFor(page);
    groups.get(key).rows.push({
      page, node, uuid: page.uuid, name: page.name,
      icon: node?.icon || materials[0]?.img || FALLBACK_ICON,
      profession: node?.profession ? PROFESSIONS[node.profession]?.label ?? node.profession : "",
      tier: node?.tier ?? null, usage, depleted: isDepleted(page),
      fill: usage.draws ? Math.round(((usage.remaining ?? 0) / usage.draws) * 100) : 100,
      materials, badges: nodeBadges(node), pins: pins.length,
      pinLabel: pins.map(({ scene, note }) => `${scene.name} (${Math.round(note.x)}, ${Math.round(note.y)})`).join(", "),
      linkGroup: linkGroupFor(page) || page.uuid
    });
  }
  const result = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const group of result) {
    const families = new Map();
    for (const row of group.rows) {
      if (!families.has(row.linkGroup)) families.set(row.linkGroup, []);
      families.get(row.linkGroup).push(row);
    }
    group.familyCount = families.size;
    for (const family of families.values()) {
      const leader = family.find(row => row.uuid === row.linkGroup) ?? family[0];
      const ordered = [leader, ...family.filter(row => row !== leader)];
      ordered.forEach((row, index) => {
        row.groupSize = family.length;
        row.isLeader = row === leader;
        row.placementNumber = index + 1;
        row.groupName = leader.name;
      });
    }
    group.rows.sort((a, b) => a.groupName.localeCompare(b.groupName) ||
      a.linkGroup.localeCompare(b.linkGroup) || a.placementNumber - b.placementNumber);
  }
  return result;
}

function badgeHtml(badges, compact = false) {
  return badges.map(badge => `<span class="gp-badge gp-badge-${badge.kind}" title="${escape(badge.title)}"><i class="fas ${badge.icon}"></i>${compact && badge.kind !== "hidden" ? "" : ` ${escape(badge.text)}`}</span>`).join("");
}

function pullsText(usage) {
  return usage.draws ? `${usage.remaining}/${usage.draws}` : "∞";
}

export function renderList(groups, state) {
  const collapsed = state.collapsed ?? new Set();
  const expandedLinks = state.expandedLinks ?? new Set();
  const checked = state.checked ?? new Set();
  const scenes = Array.from(game.scenes ?? []);
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const toolbar = `<div class="gp-nm-toolbar">
      <div class="gp-nm-toolbar-row">
        <button type="button" class="gp-primary" data-act="new"><i class="fas fa-plus"></i> New Node</button>
        <button type="button" class="gp-icon ${state.bulk ? "active" : ""}" data-act="bulk" title="Select several nodes"><i class="fas fa-list-check"></i></button>
        <button type="button" class="gp-icon" data-act="conditions" title="Conditions &amp; Biomes"><i class="fas fa-cloud-sun-rain"></i></button>
      </div>
      <input type="search" data-filter="search" placeholder="Search nodes or journals" value="${escape(state.search ?? "")}">
      <div class="gp-nm-toolbar-row">
        <select data-filter="scene" title="Scene">${option("", "All scenes", state.scene)}${scenes.map(scene => option(scene.id, scene.name, state.scene)).join("")}</select>
        <select data-filter="profession" title="Profession">${option("", "All professions", state.profession)}${Object.values(PROFESSIONS).map(profession => option(profession.key, profession.label, state.profession)).join("")}</select>
      </div>
    </div>`;
  const body = groups.map(group => {
    const isCollapsed = collapsed.has(group.id);
    const rows = group.rows.map(row => {
      const linked = row.groupSize > 1 && !row.isLeader;
      const open = expandedLinks.has(row.linkGroup);
      return `<li class="gp-nm-row ${row.uuid === state.selected ? "selected" : ""} ${linked ? "gp-nm-linked" : ""} ${linked && !open ? "gp-nm-linked-collapsed" : ""} ${row.depleted ? "depleted" : ""} ${row.node?.hidden ? "is-hidden" : ""}" data-uuid="${escape(row.uuid)}" data-act="select" tabindex="0">
        ${state.bulk ? `<input type="checkbox" data-check="${escape(row.uuid)}" ${checked.has(row.uuid) ? "checked" : ""} aria-label="Select ${escape(row.name)}">` : ""}
        <img class="gp-nm-icon" src="${escape(row.icon)}" alt="">
        <div class="gp-nm-main">
          <div class="gp-nm-name"><span>${linked ? `Placement ${row.placementNumber}` : escape(row.name)}</span><span class="gp-nm-pulls" title="Pulls left">${pullsText(row.usage)}</span></div>
          <div class="gp-nm-bar" title="${row.usage.draws ? `${row.usage.remaining} of ${row.usage.draws} pulls left` : "Unlimited pulls"}"><span style="width:${row.fill}%"></span></div>
          ${linked ? `<div class="gp-nm-meta">${escape(row.pinLabel || row.name)}</div>` : `<div class="gp-nm-meta">
            <span class="gp-nm-prof">${escape(row.profession || "No profession")}${row.tier ? ` · T${row.tier}` : ""}</span>
            <span class="gp-nm-mats">${row.materials.slice(0, 4).map(material => `<img src="${escape(material.img)}" title="${escape(material.name)} — ${material.percent}%" alt="">`).join("")}${row.materials.length > 4 ? `<small>+${row.materials.length - 4}</small>` : ""}</span>
          </div>`}
          ${!linked && row.groupSize > 1 ? `<button type="button" class="gp-nm-link-toggle" data-act="links" data-link-group="${escape(row.linkGroup)}" title="Show or hide placements that share this loot table"><i class="fas fa-caret-${open ? "down" : "right"}"></i> ${row.groupSize} linked placements</button>` : !linked && row.pins > 1 ? `<small class="gp-nm-pin-count">${row.pins} pins · shared pulls</small>` : ""}
          ${!linked && row.badges.length ? `<div class="gp-nm-badges">${badgeHtml(row.badges, true)}</div>` : ""}
        </div>
      </li>`;
    }).join("");
    return `<div class="gp-nm-group ${isCollapsed ? "collapsed" : ""}" data-group="${escape(group.id)}">
        <header data-act="collapse" data-group="${escape(group.id)}"><i class="fas fa-caret-${isCollapsed ? "right" : "down"}"></i><span>${escape(group.name)}</span><small>${group.familyCount} nodes · ${group.rows.length} placements</small></header>
        <ul>${rows}</ul>
      </div>`;
  }).join("");
  const bulkBar = state.bulk ? `<div class="gp-nm-bulk">
      <span>${checked.size} selected</span>
      <button type="button" data-act="bulk-all" title="Select every shown node">All</button>
      <button type="button" data-act="bulk-none" title="Clear selection">None</button>
      <button type="button" data-act="bulk-reset" title="Refill pulls"><i class="fas fa-rotate"></i></button>
      <button type="button" data-act="bulk-reveal" title="Reveal to all players"><i class="fas fa-eye"></i></button>
      <button type="button" data-act="bulk-hide" title="Hide from players"><i class="fas fa-eye-slash"></i></button>
    </div>` : "";
  return `${toolbar}<div class="gp-nm-groups">${body || `<p class="gp-nm-empty">${count ? "" : "No nodes match. Clear the filters or click New Node."}</p>`}</div>${bulkBar}`;
}

/* ---------------------------------------------------------------------- */
/* Detail pane                                                             */
/* ---------------------------------------------------------------------- */

function checkValue(node) {
  return node.checkType === "default" || !node.checkKey ? "default" : `${node.checkType}:${node.checkKey}`;
}

function checkOptions(selected) {
  const abilities = Object.entries(ABILITY_LABELS).map(([key, label]) => option(`ability:${key}`, label, selected)).join("");
  const skills = Object.entries(skillChoices()).map(([key, label]) => option(`skill:${key}`, label, selected)).join("");
  return `${option("default", "Profession default (material's ability)", selected)}<optgroup label="Abilities">${abilities}</optgroup>${skills ? `<optgroup label="Skills (full bonus incl. proficiency)">${skills}</optgroup>` : ""}`;
}

function rankSelect(name, selected, zeroLabel) {
  return `<select name="${name}">${[0, 1, 2, 3, 4, 5].map(rank => option(rank, rank ? `Rank ${rank}+` : zeroLabel, selected)).join("")}</select>`;
}

function field(label, control, hint = "") {
  return `<div class="gp-field"><label>${label}</label><div class="gp-control">${control}</div>${hint ? `<p class="gp-hint">${hint}</p>` : ""}</div>`;
}

function overviewHtml() {
  const pages = allNodePages();
  const families = new Set(pages.map(page => linkGroupFor(page) || page.uuid)).size;
  const depleted = pages.filter(isDepleted).length;
  const hidden = pages.filter(page => readNode(page)?.hidden).length;
  const unplaced = pages.filter(page => !pinsFor(page).length).length;
  return `<div class="gp-nm-placeholder">
      <i class="fas fa-mountain-sun"></i>
      <h2>Gathering Nodes</h2>
      <div class="gp-nm-stats">
        <div><strong>${families}</strong><span>nodes</span></div>
        <div><strong>${pages.length}</strong><span>placements</span></div>
        <div><strong>${depleted}</strong><span>depleted</span></div>
        <div><strong>${hidden}</strong><span>hidden</span></div>
        <div><strong>${unplaced}</strong><span>without pins</span></div>
      </div>
      <p>Select a node on the left, or create one.</p>
      <button type="button" class="gp-primary" data-act="new"><i class="fas fa-plus"></i> New Node</button>
    </div>`;
}

function overrideBlock(index, item, node) {
  const uuid = item.uuid;
  const has = Array.isArray(node.materialRules?.[uuid]);
  const own = materialRule(item)?.conditions ?? [];
  return `<details class="gp-mat-rules" ${has ? "open" : ""}>
      <summary><i class="fas fa-cloud-sun-rain"></i> ${has ? `Node override: ${escape(rulesSummary(node.materialRules[uuid]))}` : `Material rules: ${escape(rulesSummary(own))}`}</summary>
      <input type="hidden" name="mru_${index}" value="${escape(uuid)}">
      <label class="gp-check"><input type="checkbox" name="mro_${index}" ${has ? "checked" : ""}> Override the material's condition rules on this node</label>
      ${rulesEditorHtml(has ? node.materialRules[uuid] : own, `mr_${index}`)}
    </details>`;
}

function materialsTab(page, node, isNew) {
  if (!isNew && !node.built) {
    const materials = nodeMaterials(page);
    return `<p class="gp-hint">This node uses a hand-made Rollable Table. Edit its contents in the table.</p>
      <div class="gp-mat-list">${materials.map((material, index) => {
        const item = material.uuid ? fromUuidSync(material.uuid) : null;
        return `<div class="gp-mat-row"><img src="${escape(material.img)}" alt=""><span>${escape(material.name)}</span><span class="gp-share">${material.percent}%</span>${item ? overrideBlock(index, item, node) : ""}</div>`;
      }).join("") || "<p>The table has no results.</p>"}</div>
      <button type="button" data-act="open-table"><i class="fas fa-table-list"></i> Open table</button>`;
  }
  const weights = new Map(isNew ? [] : nodeMaterials(page).map(material => [material.uuid, material.weight]));
  const assigned = Array.from(game.items ?? []).map(item => ({ item, rule: materialRule(item) })).filter(entry => entry.rule)
    .sort((a, b) => (weights.get(b.item.uuid) ?? 0) - (weights.get(a.item.uuid) ?? 0) || a.item.name.localeCompare(b.item.name));
  if (!assigned.length) return `<p class="gp-hint">No profession materials yet. Assign Items in <strong>Profession Materials</strong> first.</p>`;
  const rows = assigned.map(({ item, rule }, index) => `<div class="gp-mat-row" data-profession="${escape(rule.profession)}" data-name="${escape(item.name.toLowerCase())}">
      <img src="${escape(item.img)}" alt=""><span class="gp-mat-name">${escape(item.name)}<small>${escape(PROFESSIONS[rule.profession]?.label ?? rule.profession)} · T${rule.tier} · DC ${rule.dc} · ${escape(rule.baseYield)}</small></span>
      <span class="gp-share" data-share></span>
      ${num(`w_${item.id}`, weights.get(item.uuid) ?? 0, 0, 1000)}
      ${overrideBlock(index, item, node)}
    </div>`).join("");
  return `<div class="gp-mat-tools">
      <input type="search" data-mat-search placeholder="Filter materials">
      <label class="gp-check"><input type="checkbox" data-mat-all> All professions</label>
    </div>
    <p class="gp-hint">Weight sets how often each material is drawn. 0 leaves it out. The share column updates as you type.</p>
    <div class="gp-mat-list">${rows}</div>`;
}

function pinsList(page) {
  const pins = pinsFor(page);
  if (!pins.length) return `<p class="gp-hint">No pins yet.</p>`;
  return `<ul class="gp-pin-list">${pins.map(({ scene, note }, index) => `<li><i class="fas fa-map-pin"></i> ${index + 1}. ${escape(scene.name)} (${Math.round(note.x)}, ${Math.round(note.y)})
      <button type="button" data-act="pin-view" data-scene="${escape(scene.id)}" data-note="${escape(note.id)}" title="Go to pin"><i class="fas fa-crosshairs"></i></button>
      <button type="button" data-act="pin-remove" data-scene="${escape(scene.id)}" data-note="${escape(note.id)}" title="Remove pin"><i class="fas fa-xmark"></i></button></li>`).join("")}</ul>`;
}

/** Material images grouped by profession, for the pin icon picker. */
export function iconGroups() {
  const groups = new Map();
  for (const item of game.items ?? []) {
    const rule = materialRule(item);
    if (!rule || !item.img) continue;
    const key = rule.profession;
    if (!groups.has(key)) groups.set(key, { key, label: PROFESSIONS[key]?.label ?? key, icons: new Map() });
    const icons = groups.get(key).icons;
    if (!icons.has(item.img)) icons.set(item.img, { img: item.img, names: [] });
    icons.get(item.img).names.push(item.name);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
    .map(group => ({ ...group, icons: [...group.icons.values()].sort((a, b) => a.names[0].localeCompare(b.names[0])) }));
}

function iconPicker(node, fallback) {
  const current = node.icon ?? "";
  const groups = iconGroups();
  const currentName = groups.flatMap(group => group.icons).find(icon => icon.img === current)?.names[0];
  const label = current ? currentName ?? "Custom image" : "Default (first material)";
  const grid = groups.map(group => `<details class="gp-icon-group" ${group.key === node.profession || groups.length === 1 ? "open" : ""}>
      <summary>${escape(group.label)} <small>${group.icons.length}</small></summary>
      <div class="gp-icon-grid">${group.icons.map(icon => `<button type="button" class="gp-icon-choice ${icon.img === current ? "active" : ""}" data-act="icon-pick" data-img="${escape(icon.img)}" data-label="${escape(icon.names[0])}" title="${escape(icon.names.join(", "))}"><img src="${escape(icon.img)}" alt=""></button>`).join("")}</div>
    </details>`).join("");
  return `<div class="gp-icon-picker" data-icon-picker>
      <input type="hidden" name="icon" value="${escape(current)}">
      <button type="button" class="gp-icon-current" data-act="icon-toggle">
        <img src="${escape(current || fallback)}" alt="" data-icon-preview><span data-icon-label>${escape(label)}</span><i class="fas fa-caret-down"></i>
      </button>
      <div class="gp-icon-panel">
        <button type="button" class="gp-icon-default ${current ? "" : "active"}" data-act="icon-pick" data-img="" data-label="Default (first material)"><i class="fas fa-rotate-left"></i> Default (first material's image)</button>
        ${grid || '<p class="gp-hint">Assign materials in Profession Materials to get icons here.</p>'}
      </div>
    </div>`;
}

const toolKey = tool => tool.uuid || `name:${String(tool.name).toLowerCase()}`;

export function toolsSection(selected) {
  const library = getToolLibrary();
  const chosenKeys = new Set(selected.map(toolKey));
  const chips = selected.map(tool => `<span class="gp-tool-chip" title="${escape(tool.uuid || "Matched by name only")}">
      ${tool.img ? `<img src="${escape(tool.img)}" alt="">` : '<i class="fas fa-screwdriver-wrench"></i>'}${escape(tool.name)}${tool.uuid ? "" : " <small>(name)</small>"}
      <a data-act="tool-remove" data-key="${escape(toolKey(tool))}" title="Remove from this node"><i class="fas fa-xmark"></i></a></span>`).join("");
  const available = library.filter(tool => !chosenKeys.has(toolKey(tool)));
  return `<input type="hidden" name="tools" value="${escape(JSON.stringify(selected))}">
    <div class="gp-tool-chips">${chips || "<span class='gp-hint'>No node tools: the profession's default tools (Gathering Tools) are required. Add tools here to require specific ones on this node instead.</span>"}</div>
    <div class="gp-tool-add">
      <select data-tool-select>${option("", available.length ? "Add a tool from the library…" : "Library is empty — drop an Item", "")}${available.map(tool => option(tool.uuid, tool.name, "")).join("")}</select>
      <div class="gp-dropzone" data-tool-drop><i class="fas fa-hand-holding"></i> Drop an Item</div>
    </div>
    ${library.length ? `<details class="gp-tool-library"><summary>Tool library (${library.length})</summary><ul>${library.map(tool => `<li>
        ${tool.img ? `<img src="${escape(tool.img)}" alt="">` : ""}<span>${escape(tool.name)}</span>
        <button type="button" class="gp-icon" data-act="tool-forget" data-uuid="${escape(tool.uuid)}" title="Remove from library (nodes keep it)"><i class="fas fa-xmark"></i></button></li>`).join("")}</ul></details>` : ""}`;
}

export function rareTableOptions(selected) {
  const groups = new Map();
  for (const table of game.tables ?? []) {
    const folder = table.folder?.name ?? "No folder";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(table);
  }
  const known = new Set(Array.from(game.tables ?? []).map(table => table.uuid));
  const extra = selected && !known.has(selected) ? option(selected, `Other: ${fromUuidSync(selected)?.name ?? selected}`, selected) : "";
  const grouped = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([folder, tables]) =>
    `<optgroup label="${escape(folder)}">${tables.sort((a, b) => a.name.localeCompare(b.name)).map(table => option(table.uuid, table.name, selected)).join("")}</optgroup>`).join("");
  return `${option("", "Default — material's or profession's table", selected)}${extra}${grouped}`;
}

export function rarePreview(uuid) {
  if (!uuid) return '<p class="gp-hint">Rare finds use each material\'s rare table, or its profession\'s.</p>';
  const table = fromUuidSync(uuid);
  if (!table) return '<p class="gp-hint">Table not found.</p>';
  const results = Array.from(table.results ?? []);
  const total = results.reduce((sum, result) => sum + (Number(result.weight) || 0), 0) || 1;
  if (!results.length) return '<p class="gp-hint">This table is empty.</p>';
  return `<div class="gp-rare-list">${results.map(result => `<div class="gp-rare-row"><img src="${escape(result.img || FALLBACK_ICON)}" alt=""><span>${escape(result.name ?? result.text ?? "Result")}</span><span class="gp-share">${Math.round(((Number(result.weight) || 0) / total) * 100)}%</span></div>`).join("")}</div>`;
}

export function renderDetail(page, state) {
  const isNew = state.selected === "new";
  if (!isNew && !page) return overviewHtml();
  const node = (isNew ? null : readNode(page)) ?? { ...NODE_DEFAULTS, hidden: isNew };
  const usage = isNew ? { draws: 5, time: 8, remaining: 5 } : nodeUsage(page);
  const materials = isNew ? [] : nodeMaterials(page);
  const icon = node.icon || materials[0]?.img || FALLBACK_ICON;
  const tab = state.tab ?? "basics";
  const fill = usage.draws ? Math.round(((usage.remaining ?? 0) / usage.draws) * 100) : 100;
  const scenes = Array.from(game.scenes ?? []);

  const header = isNew
    ? `<header class="gp-nm-head"><img src="${FALLBACK_ICON}" alt=""><div><h2>New Node</h2><div class="gp-sub">Fill in the tabs, then Create node.</div></div></header>`
    : `<header class="gp-nm-head">
        <img src="${escape(icon)}" alt="">
        <div class="gp-nm-title"><h2>${escape(page.name)}</h2>
          <div class="gp-sub">${escape(page.parent?.name ?? "")} · ${escape(node.profession ? PROFESSIONS[node.profession]?.label ?? node.profession : "No profession")} · Tier ${node.tier}</div></div>
        <div class="gp-nm-actions">
          <button type="button" data-act="gather-window" title="Open the gathering window (player view)"><i class="fas fa-hand-sparkles"></i></button>
          <button type="button" data-act="open" title="Open the Gatherer page"><i class="fas fa-book-open"></i></button>
          <button type="button" data-act="place" title="Add another pin sharing this node's pulls"><i class="fas fa-map-pin"></i></button>
          <button type="button" data-act="place-linked" title="Place a linked node with its own pulls and reset timer, sharing this loot table"><i class="fas fa-link"></i></button>
          <button type="button" data-act="reset" title="Refill pulls"><i class="fas fa-rotate"></i></button>
          <button type="button" data-act="toggle" title="${node.hidden ? "Reveal to all players" : "Hide from players"}"><i class="fas ${node.hidden ? "fa-eye" : "fa-eye-slash"}"></i></button>
          <button type="button" data-act="duplicate" title="Duplicate as a separate node and loot table"><i class="fas fa-copy"></i></button>
          <button type="button" class="gp-danger" data-act="delete" title="Delete this node and its pins; shared table stays until the last linked node is deleted"><i class="fas fa-trash"></i></button>
        </div>
      </header>
      <div class="gp-nm-summary">
        <div class="gp-nm-bigbar ${isDepleted(page) ? "depleted" : ""}"><span style="width:${fill}%"></span><label>${usage.draws ? `${usage.remaining} / ${usage.draws} pulls left` : "Unlimited pulls"}</label></div>
        <span><i class="fas fa-hourglass-half"></i> ${usage.time ? `Resets ${usage.time} h after first pull` : "No timed reset"}</span>
        <span><i class="fas fa-map-pin"></i> ${pinsFor(page).length} pin(s)</span>
        ${linkGroupFor(page) ? `<span><i class="fas fa-link"></i> Linked loot table · independent pulls</span>` : ""}
        <div class="gp-nm-badges">${badgeHtml(nodeBadges(node))}</div>
      </div>`;

  const basics = `
    ${field("Name", `<input name="name" type="text" value="${escape(page?.name ?? "")}" placeholder="e.g. Iron Vein" required>`)}
    ${isNew ? field("Scene", `<select name="sceneId">${option("", "Unplaced", canvas?.scene?.id ?? "")}${scenes.map(scene => option(scene.id, scene.name, canvas?.scene?.id ?? "")).join("")}</select>`, "Creates or reuses the journal “Nodes — scene name”.") : ""}
    ${field("Description", `<textarea name="flavor" rows="3" placeholder="What players see, e.g. Green-streaked rock juts from the cliff face…">${escape(node.flavor ?? "")}</textarea>`, "Shown to players in the gathering window.")}
    ${field("Profession", `<select name="profession" data-prof-select>${option("", "None", node.profession)}${Object.values(PROFESSIONS).map(profession => option(profession.key, profession.label, node.profession)).join("")}</select>`, "Used for minimum rank, profession sense, filters, and the materials list.")}
    ${field("Biome", `<select name="biome">${option("", "Scene's biome", node.biome ?? "")}${getBiomes().map(biome => option(biome.key, biome.label, node.biome ?? "")).join("")}</select>`, "Used by biome condition rules. Edit the list in Conditions &amp; Biomes.")}
    ${field("Tier", `<select name="tier">${[1, 2, 3, 4, 5].map(tier => option(tier, `Tier ${tier}`, node.tier)).join("")}</select>`, "A label for this node. Each material keeps its own DC.")}
    ${field("Pulls", num("draws", usage.draws ?? 0, 0, 1000), "0 = unlimited.")}
    ${field("Reset after (hours)", num("time", usage.time ?? 0, 0, 100000, 0.5), "In-game hours after the first pull. 0 = never.")}
    ${field("Pin icon", iconPicker(node, materials[0]?.img || FALLBACK_ICON), "Pick a material image. Default uses the first material in the node.")}
    ${isNew ? field("Pin", `<label class="gp-check"><input type="checkbox" name="placePin" ${canvas?.scene ? "checked" : ""}> Place a pin after creating it</label>`) : ""}`;

  const rules = `
    ${field("Check", `<select name="check">${checkOptions(checkValue(node))}</select>`, "A skill adds its full bonus (ability + proficiency or expertise), plus the profession die.")}
    ${field("DC modifier", num("dcModifier", node.dcModifier, -20, 20), "Added to every material's DC on this node.")}
    ${field("Yield modifier", num("yieldModifier", node.yieldModifier, -10, 10), "Added to full successes. A success always gives at least 1.")}
    ${field("Minimum rank", rankSelect("minRank", node.minRank, "None"), "Below this rank in the node's profession, the attempt is refused. No pull is used.")}
    <h3>Required tools</h3>
    <div class="gp-tools">${toolsSection(nodeTools(node))}</div>
    <p class="gp-hint gp-hint-block">Carrying any one listed tool is enough. A character's copy matches by its source Item, or by the same name. When several are carried, the highest proficiency bonus is used. It is not added to a skill check.</p>
    <h3>Rare finds</h3>
    ${field("Rare-find bonus %", num("rareChance", node.rareChance, 0, 100), "Added to the character's perk chance on full successes.")}
    ${field("Rare-find table", `<select name="rareTable" data-rare-select data-table-drop>${rareTableOptions(node.rareTable)}</select><button type="button" class="gp-icon" data-act="rare-create" title="Create a rare-find table"><i class="fas fa-plus"></i></button>`, "Pick a table, drag one from the sidebar onto this box, or create one with +.")}
    <div class="gp-rare-preview" data-rare-preview>${rarePreview(node.rareTable)}</div>`;

  const visibility = `
    ${field("Players", `<label class="gp-check"><input type="checkbox" name="hidden" ${node.hidden ? "checked" : ""}> Hidden until revealed</label>`, "Hidden nodes and their pins are invisible to players.")}
    ${field("Profession sense", rankSelect("senseRank", node.senseRank, "Off"), "While hidden, characters with the node's profession at this rank or higher still see it.")}
    ${isNew ? "" : `<h3>Placements</h3><p class="gp-hint">Another pin shares this node's pulls. A linked placement uses the same loot table but has its own pulls and reset timer. Material edits to the table affect every linked placement.</p>${pinsList(page)}<button type="button" data-act="place"><i class="fas fa-map-pin"></i> Add shared-pool pin</button> <button type="button" data-act="place-linked"><i class="fas fa-link"></i> Add linked placement</button>`}`;

  const panels = { basics, materials: materialsTab(page, node, isNew), rules, visibility };
  const nav = TABS.map(([id, label, iconClass]) => `<a class="gp-tab ${id === tab ? "active" : ""}" data-act="tab" data-tab="${id}"><i class="fas ${iconClass}"></i> ${escape(label)}</a>`).join("");
  const sections = TABS.map(([id]) => `<section class="gp-panel ${id === tab ? "active" : ""}" data-panel="${id}">${panels[id]}</section>`).join("");
  return `${header}
    <nav class="gp-tabs">${nav}</nav>
    <form class="gp-node-form" autocomplete="off">${sections}
      <footer class="gp-form-footer">
        <span class="gp-dirty" ${state.dirty ? "" : "hidden"}><i class="fas fa-circle"></i> Unsaved changes</span>
        ${isNew ? `<button type="button" data-act="cancel">Cancel</button>` : `<button type="button" data-act="revert">Revert</button>`}
        <button type="submit" class="gp-primary"><i class="fas fa-floppy-disk"></i> ${isNew ? "Create node" : "Save changes"}</button>
      </footer>
    </form>`;
}

/* ---------------------------------------------------------------------- */
/* Application                                                             */
/* ---------------------------------------------------------------------- */

let NodeManagerClass = null;
let manager = null;
let placing = null;

function formValues(form) {
  const FormDataExtended = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  if (FormDataExtended) return new FormDataExtended(form).object;
  const values = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    values[element.name] = element.type === "checkbox" ? element.checked : element.value;
  }
  return values;
}

function collectData(values, page, isNew) {
  const [checkType, checkKey = ""] = String(values.check ?? "default").split(":");
  const data = {
    name: values.name, flavor: values.flavor ?? "", profession: values.profession ?? "", tier: Number(values.tier), icon: values.icon ?? "",
    draws: Number(values.draws ?? 0), time: Number(values.time ?? 0),
    checkType, checkKey, dcModifier: Number(values.dcModifier ?? 0), yieldModifier: Number(values.yieldModifier ?? 0),
    minRank: Number(values.minRank ?? 0), toolName: "", tools: values.tools ?? "[]", rareChance: Number(values.rareChance ?? 0),
    rareTable: values.rareTable ?? "", hidden: values.hidden === true, senseRank: Number(values.senseRank ?? 0),
    biome: values.biome ?? "",
    materialRules: Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("mru_"))
      .map(([key, uuid]) => [uuid, key.slice(4)])
      .filter(([, index]) => values[`mro_${index}`] === true)
      .map(([uuid, index]) => [uuid, parseRules(values[`mr_${index}`])]))
  };
  if (isNew || readNode(page)?.built) {
    data.materials = Object.entries(values).filter(([key]) => key.startsWith("w_"))
      .map(([key, weight]) => ({ uuid: game.items.get(key.slice(2))?.uuid, weight: Number(weight) || 0 }))
      .filter(entry => entry.uuid);
  }
  return data;
}

/**
 * The Node Manager, mounted inside the GM hub's Nodes section. It renders
 * into whatever container the hub gives it (`mount(root)`); `render({parts})`
 * redraws the list and/or detail pane in place.
 */
function defineClass() {
  return class NodeManagerCore {
    element = null;
    host = null;

    view = { selected: null, tab: "basics", search: "", scene: "", profession: "", collapsed: new Set(), expandedLinks: new Set(), bulk: false, checked: new Set(), dirty: false };
    #hooks = [];
    #refreshTimer = null;

    get selectedPage() {
      if (!this.view.selected || this.view.selected === "new") return null;
      const page = fromUuidSync(this.view.selected);
      return isGathererPage(page) ? page : null;
    }

    get rendered() { return Boolean(this.element?.isConnected ?? this.element); }

    /** Attach to a container (the hub re-creates it on each hub render). */
    mount(root) {
      if (this.element === root) return;
      this.unmount();
      this.element = root;
      this._onFirstRender();
    }

    unmount() {
      if (!this.element) return;
      this._onClose();
      this.element = null;
    }

    async render({ parts = ["list", "detail"] } = {}) {
      if (!this.element) return this;
      const result = await this._renderHTML({}, { parts });
      this._replaceHTML(result, this.element);
      return this;
    }

    minimize() { return this.host?.minimize?.(); }
    maximize() { return this.host?.maximize?.(); }

    async _renderHTML(_context, options) {
      const parts = options.parts ?? ["list", "detail"];
      const result = {};
      if (parts.includes("list")) result.list = renderList(buildListModel(allNodePages(), this.view), this.view);
      if (parts.includes("detail")) {
        if (this.view.selected && this.view.selected !== "new" && !this.selectedPage) this.view.selected = null;
        result.detail = renderDetail(this.selectedPage, this.view);
      }
      return result;
    }

    _replaceHTML(result, content) {
      if (!content.querySelector(".gp-nm")) content.innerHTML = '<div class="gp-nm"><aside class="gp-nm-list"></aside><section class="gp-nm-detail"></section></div>';
      if (result.list !== undefined) {
        const list = content.querySelector(".gp-nm-list");
        const scroll = list.querySelector(".gp-nm-groups")?.scrollTop ?? 0;
        const focusSearch = document.activeElement?.matches?.("[data-filter='search']");
        list.innerHTML = result.list;
        const groups = list.querySelector(".gp-nm-groups");
        if (groups) groups.scrollTop = scroll;
        if (focusSearch) {
          const input = list.querySelector("[data-filter='search']");
          input?.focus();
          input?.setSelectionRange?.(input.value.length, input.value.length);
        }
      }
      if (result.detail !== undefined) {
        content.querySelector(".gp-nm-detail").innerHTML = result.detail;
        this.#updateShares();
        this.#filterMaterials();
      }
    }

    _onFirstRender() {
      const root = this.element;
      bindRulesEditors(root, () => this.#markDirty());
      root.addEventListener("click", event => this.#onClick(event));
      root.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target.matches?.(".gp-nm-row")) this.#select(event.target.dataset.uuid);
      });
      root.addEventListener("change", event => this.#onChange(event));
      root.addEventListener("input", event => this.#onInput(event));
      root.addEventListener("submit", event => { event.preventDefault(); void this.#save(); });
      root.addEventListener("dragover", event => {
        const zone = event.target.closest?.("[data-table-drop], [data-item-drop], [data-tool-drop]");
        if (!zone) return;
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      root.addEventListener("dragleave", event => event.target.closest?.("[data-tool-drop]")?.classList.remove("drag-over"));
      root.addEventListener("drop", event => this.#onDrop(event));
      const refresh = () => this.#scheduleRefresh();
      for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "createNote", "updateNote", "deleteNote",
        "updateJournalEntry", "deleteJournalEntry", "createTableResult", "updateTableResult", "deleteTableResult"]) {
        this.#hooks.push([hook, Hooks.on(hook, refresh)]);
      }
    }

    _onClose() {
      for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
      this.#hooks = [];
    }

    #scheduleRefresh() {
      clearTimeout(this.#refreshTimer);
      // Never wipe a form with unsaved edits; refresh only the list then.
      this.#refreshTimer = setTimeout(() => {
        if (this.rendered) void this.render({ parts: this.view.dirty ? ["list"] : ["list", "detail"] });
      }, 150);
    }

    async #confirmDiscard() {
      if (!this.view.dirty) return true;
      return Dialog().confirm({ window: { title: "Discard changes?" }, content: "<p>This node has unsaved changes. Discard them?</p>" });
    }

    async #select(uuid, tab = null) {
      if (uuid === this.view.selected && !tab) return;
      if (!await this.#confirmDiscard()) return;
      this.view.selected = uuid;
      const selectedGroup = uuid && uuid !== "new" ? linkGroupFor(fromUuidSync(uuid)) : "";
      if (selectedGroup) this.view.expandedLinks.add(selectedGroup);
      this.view.dirty = false;
      if (tab) this.view.tab = tab;
      await this.render({ parts: ["list", "detail"] });
    }

    selectNode(uuid, tab) { return this.#select(uuid, tab); }

    #markDirty() {
      if (this.view.dirty) return;
      this.view.dirty = true;
      const marker = this.element.querySelector(".gp-dirty");
      if (marker) marker.hidden = false;
    }

    #updateShares() {
      const rows = Array.from(this.element?.querySelectorAll(".gp-mat-row[data-profession]") ?? []);
      const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.querySelector("input")?.value) || 0), 0);
      for (const row of rows) {
        const weight = Math.max(0, Number(row.querySelector("input")?.value) || 0);
        row.classList.toggle("in-use", weight > 0);
        const share = row.querySelector("[data-share]");
        if (share) share.textContent = weight && total ? `${Math.round((weight / total) * 100)}%` : "";
      }
    }

    #filterMaterials() {
      const root = this.element;
      if (!root) return;
      const profession = root.querySelector("[data-prof-select]")?.value ?? "";
      const all = root.querySelector("[data-mat-all]")?.checked;
      const search = (root.querySelector("[data-mat-search]")?.value ?? "").trim().toLowerCase();
      for (const row of root.querySelectorAll(".gp-mat-row[data-profession]")) {
        const inUse = Number(row.querySelector("input")?.value) > 0;
        const matchesProfession = all || !profession || row.dataset.profession === profession;
        row.hidden = !(inUse || (matchesProfession && (!search || row.dataset.name.includes(search))));
      }
    }

    #getTools() {
      try { return JSON.parse(this.element.querySelector("input[name='tools']")?.value || "[]"); } catch { return []; }
    }

    #setTools(tools) {
      const container = this.element.querySelector(".gp-tools");
      if (container) container.innerHTML = toolsSection(tools);
      this.#markDirty();
    }

    #addTool(entry) {
      const tools = this.#getTools();
      if (!tools.some(tool => toolKey(tool) === toolKey(entry))) tools.push({ uuid: entry.uuid, name: entry.name, img: entry.img ?? "" });
      if (tools.length > 10) return ui.notifications.warn("A node can accept at most 10 tools.");
      this.#setTools(tools);
    }

    #renderRarePreview() {
      const select = this.element.querySelector("[data-rare-select]");
      const preview = this.element.querySelector("[data-rare-preview]");
      if (select && preview) preview.innerHTML = rarePreview(select.value);
    }

    #selectRareTable(uuid) {
      const select = this.element.querySelector("[data-rare-select]");
      if (!select) return;
      if (![...select.options].some(item => item.value === uuid)) {
        const added = document.createElement("option");
        added.value = uuid;
        added.textContent = `Other: ${fromUuidSync(uuid)?.name ?? uuid}`;
        select.append(added);
      }
      select.value = uuid;
      this.#renderRarePreview();
      this.#markDirty();
    }

    async #quickCreateRareTable() {
      const page = this.selectedPage;
      const items = Array.from(game.items ?? []).sort((a, b) => a.name.localeCompare(b.name));
      const rows = items.map(item => `<div class="gp-mat-row" data-name="${escape(item.name.toLowerCase())}" hidden>
          <img src="${escape(item.img)}" alt=""><span class="gp-mat-name">${escape(item.name)}<small>${escape(item.folder?.name ?? "")}</small></span>
          <span></span>${num(`w_${item.id}`, 0, 0, 1000)}</div>`).join("");
      const element = document.createElement("div");
      element.innerHTML = `<div class="gathering-professions-ui gp-nm gp-quick-rare">
          <div class="gp-field"><label>Table name</label><div class="gp-control"><input name="name" type="text" value="${escape(page ? `${page.name} — Rare Finds` : "Rare Finds")}"></div></div>
          <div class="gp-field"><label>Find items</label><div class="gp-control"><input type="search" data-quick-search placeholder="Type at least 2 letters"></div></div>
          <p class="gp-hint gp-hint-block">Give each rare item a weight. Items with a weight stay listed.</p>
          <div class="gp-mat-list gp-quick-list">${rows}</div></div>`;
      const values = await Dialog().input({
        window: { title: "Create Rare-Find Table" }, content: element, position: { width: 560, height: 560 },
        ok: { label: "Create table" },
        render: (_event, dialog) => {
          const root = dialog.element;
          const filter = () => {
            const query = (root.querySelector("[data-quick-search]")?.value ?? "").trim().toLowerCase();
            root.querySelectorAll(".gp-quick-list .gp-mat-row").forEach(row => {
              const used = Number(row.querySelector("input")?.value) > 0;
              row.hidden = !(used || (query.length >= 2 && row.dataset.name.includes(query)));
              row.classList.toggle("in-use", used);
            });
          };
          root.querySelector("[data-quick-search]")?.addEventListener("input", filter);
          root.querySelector(".gp-quick-list")?.addEventListener("input", filter);
        }
      });
      if (!values) return;
      const entries = Object.entries(values).filter(([key]) => key.startsWith("w_"))
        .map(([key, weight]) => ({ uuid: game.items.get(key.slice(2))?.uuid, weight: Number(weight) || 0 })).filter(entry => entry.uuid);
      const table = await createRareTable(values.name, entries);
      const select = this.element.querySelector("[data-rare-select]");
      if (select) select.innerHTML = rareTableOptions(table.uuid);
      this.#selectRareTable(table.uuid);
      ui.notifications.info(`Created rare-find table: ${table.name}`);
    }

    #onInput(event) {
      const target = event.target;
      if (target.matches("[data-filter='search']")) {
        this.view.search = target.value;
        clearTimeout(this.#refreshTimer);
        this.#refreshTimer = setTimeout(() => void this.render({ parts: ["list"] }), 200);
        return;
      }
      if (target.matches("[data-mat-search]")) return this.#filterMaterials();
      if (target.closest(".gp-node-form")) {
        this.#markDirty();
        if (target.name?.startsWith("w_")) this.#updateShares();
      }
    }

    #onChange(event) {
      const target = event.target;
      if (target.matches("[data-filter='scene']")) { this.view.scene = target.value; return void this.render({ parts: ["list"] }); }
      if (target.matches("[data-filter='profession']")) { this.view.profession = target.value; return void this.render({ parts: ["list"] }); }
      if (target.matches("[data-check]")) {
        if (target.checked) this.view.checked.add(target.dataset.check);
        else this.view.checked.delete(target.dataset.check);
        const label = this.element.querySelector(".gp-nm-bulk span");
        if (label) label.textContent = `${this.view.checked.size} selected`;
        return;
      }
      if (target.matches("[data-mat-all], [data-prof-select]")) this.#filterMaterials();
      if (target.matches("[data-tool-select]")) {
        const entry = getToolLibrary().find(tool => tool.uuid === target.value);
        if (entry) this.#addTool(entry);
        return;
      }
      if (target.matches("[data-rare-select]")) this.#renderRarePreview();
      if (target.closest(".gp-node-form")) {
        this.#markDirty();
        if (target.name?.startsWith("w_")) this.#updateShares();
      }
    }

    #onDrop(event) {
      const toolZone = event.target.closest?.("[data-tool-drop]");
      if (toolZone) {
        event.preventDefault();
        toolZone.classList.remove("drag-over");
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
        if (data?.type !== "Item" || !data.uuid) return ui.notifications.warn("Drop an Item here.");
        return void addToolToLibrary(data.uuid).then(entry => this.#addTool(entry)).catch(report);
      }
      const input = event.target.closest?.("[data-table-drop], [data-item-drop]");
      if (!input) return;
      event.preventDefault();
      let data;
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
      if (input.matches("[data-table-drop]")) {
        if (data?.type !== "RollTable" || !data.uuid) return ui.notifications.warn("Drop a Rollable Table here.");
        this.#selectRareTable(data.uuid);
      } else {
        if (data?.type !== "Item" || !data.uuid) return ui.notifications.warn("Drop an Item here.");
        const item = fromUuidSync(data.uuid);
        if (item) input.value = item.name;
      }
      this.#markDirty();
    }

    async #onClick(event) {
      const button = event.target.closest?.("[data-act]");
      if (!button || !this.element.contains(button)) return;
      if (event.target.matches?.("input[type='checkbox']")) return;
      const act = button.dataset.act;
      const page = this.selectedPage;
      try {
        switch (act) {
          case "select": return this.#select(button.dataset.uuid);
          case "new": return this.#select("new", "basics");
          case "cancel": this.view.dirty = false; return this.#select(null);
          case "revert": this.view.dirty = false; return this.render({ parts: ["detail"] });
          case "tab": {
            this.view.tab = button.dataset.tab;
            this.element.querySelectorAll(".gp-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === this.view.tab));
            this.element.querySelectorAll(".gp-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === this.view.tab));
            return;
          }
          case "collapse": {
            const id = button.dataset.group;
            if (this.view.collapsed.has(id)) this.view.collapsed.delete(id); else this.view.collapsed.add(id);
            return this.render({ parts: ["list"] });
          }
          case "links": {
            const id = button.dataset.linkGroup;
            if (this.view.expandedLinks.has(id)) this.view.expandedLinks.delete(id); else this.view.expandedLinks.add(id);
            return this.render({ parts: ["list"] });
          }
          case "conditions": return openConditionsWindow();
          case "bulk": this.view.bulk = !this.view.bulk; this.view.checked.clear(); return this.render({ parts: ["list"] });
          case "bulk-all":
            this.element.querySelectorAll("[data-check]").forEach(box => this.view.checked.add(box.dataset.check));
            return this.render({ parts: ["list"] });
          case "bulk-none": this.view.checked.clear(); return this.render({ parts: ["list"] });
          case "bulk-reset": case "bulk-reveal": case "bulk-hide": {
            const pages = [...this.view.checked].map(uuid => fromUuidSync(uuid)).filter(Boolean);
            if (!pages.length) return ui.notifications.warn("Select at least one node.");
            if (act === "bulk-reset") ui.notifications.info(`Reset ${await resetNodes(pages)} node(s).`);
            else await setNodeHidden(pages, act === "bulk-hide");
            return this.#scheduleRefresh();
          }
          case "icon-toggle":
            return void button.closest("[data-icon-picker]")?.classList.toggle("open");
          case "icon-pick": {
            const picker = button.closest("[data-icon-picker]");
            const img = button.dataset.img ?? "";
            picker.querySelector("input[name='icon']").value = img;
            const fallback = nodeMaterials(this.selectedPage)[0]?.img || FALLBACK_ICON;
            picker.querySelector("[data-icon-preview]").src = img || fallback;
            picker.querySelector("[data-icon-label]").textContent = button.dataset.label ?? "Custom image";
            picker.querySelectorAll(".gp-icon-choice, .gp-icon-default").forEach(choice => choice.classList.toggle("active", choice === button));
            picker.classList.remove("open");
            return this.#markDirty();
          }
          case "tool-remove":
            return this.#setTools(this.#getTools().filter(tool => toolKey(tool) !== button.dataset.key));
          case "tool-forget":
            await removeToolFromLibrary(button.dataset.uuid);
            return void this.#setTools(this.#getTools());
          case "rare-create":
            return this.#quickCreateRareTable();
        }
        if (!page) return;
        switch (act) {
          case "open": return page.parent?.sheet?.render(true, { pageId: page.id });
          case "gather-window": return game.modules.get(MODULE_ID).api.openGatheringWindow(page);
          case "open-table": return (await fromUuid(page.flags?.gatherer?.table))?.sheet?.render(true);
          case "place": return startPinPlacement(page);
          case "place-linked": return startPinPlacement(page, { linked: true });
          case "reset": await resetNodes([page]); return ui.notifications.info(`Refilled ${page.name}.`);
          case "toggle": return setNodeHidden([page], !readNode(page)?.hidden);
          case "duplicate": {
            const copy = await duplicateNode(page);
            this.view.dirty = false;
            return this.#select(copy.uuid);
          }
          case "delete": {
            const confirmed = await Dialog().confirm({ window: { title: `Delete ${page.name}?` },
              content: `<p>Delete <strong>${escape(page.name)}</strong> and its ${pinsFor(page).length} pin(s)? Its builder table is deleted only if no other node uses it. This cannot be undone.</p>` });
            if (!confirmed) return;
            await deleteNode(page);
            this.view.selected = null;
            this.view.dirty = false;
            return this.render({ parts: ["list", "detail"] });
          }
          case "pin-view": {
            const scene = game.scenes.get(button.dataset.scene);
            const note = scene?.notes.get(button.dataset.note);
            if (!scene || !note) return;
            if (canvas.scene?.id !== scene.id) await scene.view();
            return canvas.animatePan({ x: note.x, y: note.y, scale: Math.max(canvas.stage.scale.x, 1) });
          }
          case "pin-remove": {
            const scene = game.scenes.get(button.dataset.scene);
            await scene?.deleteEmbeddedDocuments("Note", [button.dataset.note]);
            return this.#scheduleRefresh();
          }
        }
      } catch (error) { report(error); }
    }

    async #save() {
      const form = this.element.querySelector(".gp-node-form");
      if (!form) return;
      const isNew = this.view.selected === "new";
      const page = this.selectedPage;
      try {
        const values = formValues(form);
        const data = collectData(values, page, isNew);
        if (isNew) {
          const created = await buildNode({ ...data, sceneId: values.sceneId ?? "" });
          this.view.selected = created.uuid;
          this.view.dirty = false;
          ui.notifications.info(`Created node: ${created.name}`);
          await this.render({ parts: ["list", "detail"] });
          if (values.placePin === true && canvas?.scene) startPinPlacement(created);
          return;
        }
        await updateNode(page, data);
        this.view.dirty = false;
        ui.notifications.info(`Saved node: ${page.name}`);
        await this.render({ parts: ["list", "detail"] });
      } catch (error) { report(error); }
    }
  };
}

/** Open (or focus) the Node Manager. Options: select (uuid or "new"), tab. */
/** The Node Manager controller (one per client), created on first use. */
export function nodeManagerCore() {
  NodeManagerClass ??= defineClass();
  manager ??= new NodeManagerClass();
  return manager;
}

/** Open the GM hub on Nodes, optionally selecting a node and tab. */
export async function openNodeManager({ select = null, tab = null } = {}) {
  if (!game.user.isGM) return false;
  nodeManagerCore();
  if (select) {
    manager.view.selected = select;
    const selectedGroup = select !== "new" ? linkGroupFor(fromUuidSync(select)) : "";
    if (selectedGroup) manager.view.expandedLinks.add(selectedGroup);
    manager.view.dirty = false;
    if (tab) manager.view.tab = tab;
  }
  const { openHub } = await import("./hub.js");
  const hub = await openHub("nodes");
  hub?.maximize?.();
  return manager;
}

/** Create a node (no page) or edit one, inside the Node Manager. */
export function openNodeBuilder(page = null) {
  return openNodeManager({ select: page?.uuid ?? "new", tab: "basics" });
}

/* ---------------------------------------------------------------------- */
/* Pin placement                                                           */
/* ---------------------------------------------------------------------- */

/** Next left-click on the canvas drops a pin; right-click cancels. */
export function startPinPlacement(page, { linked = false } = {}) {
  if (!game.user.isGM) return false;
  if (!canvas?.scene || !canvas.stage) {
    ui.notifications.warn("Open a scene first, then place the pin.");
    return false;
  }
  if (placing) canvas.stage.off("pointerdown", placing);
  void manager?.minimize?.();
  ui.notifications.info(`Click the map to place ${linked ? "a linked copy of " : "another pin for "}"${page.name}". Right-click to cancel.`);
  placing = async event => {
    canvas.stage.off("pointerdown", placing);
    placing = null;
    try {
      if (event.button === 2) ui.notifications.info("Pin placement cancelled.");
      else {
        const position = event.getLocalPosition(canvas.stage);
        const placed = linked ? await placeLinkedNode(page, canvas.scene, position.x, position.y) : await placePin(page, canvas.scene, position.x, position.y);
        if (linked && manager) {
          manager.view.selected = placed.uuid;
          manager.view.expandedLinks.add(linkGroupFor(placed));
          void manager.render({ parts: ["list", "detail"] });
        }
        ui.notifications.info(`Placed ${linked ? "linked node" : "pin"}: ${page.name}${readNode(page)?.hidden ? " (hidden from players)" : ""}`);
      }
    } catch (error) { report(error); }
    void manager?.maximize?.();
  };
  canvas.stage.on("pointerdown", placing);
  return true;
}

export function registerNodeUI() {
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    for (const layer of ["tokens", "notes"]) {
      if (!controls[layer]?.tools) continue;
      controls[layer].tools["gp-nodes"] = {
        name: "gp-nodes", title: "Gathering Nodes (Node Manager)", icon: "fas fa-mountain-sun",
        order: Object.keys(controls[layer].tools).length, button: true, visible: true,
        onChange: () => { void openNodeManager().catch(report); }
      };
    }
  });
  // Node Settings button on a Gatherer page opened in its own window.
  Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
    if (!game.user.isGM || !isGathererPage(app.document)) return;
    controls.push({ action: "gathering-node", icon: "fas fa-mountain-sun", label: "Node Settings",
      onClick: () => { void openNodeBuilder(app.document).catch(report); } });
  });
}
