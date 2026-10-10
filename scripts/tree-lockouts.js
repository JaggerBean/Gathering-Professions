// Locked-out skills in the gathering tree (Skill Tree's "excluded" state): a
// red X over the skill (module.css), and clicking it shows what locks it out —
// the locking skill pulses, a red dashed line joins the two for a few seconds,
// and a notification names it. Covers either/or pairs and capstones alike.
import { GROUP_ID } from "./skilltree.js";

const SKILL_TREE_ID = "skill-tree";
export const HINT_MS = 3000;
const SVG_NS = "http://www.w3.org/2000/svg";

const flagOf = (document, key) => document?.getFlag?.(SKILL_TREE_ID, key) ?? document?.flags?.[SKILL_TREE_ID]?.[key];

/** Whether the actor has fully learned the tree page with this UUID. */
export function pageLearned(actor, page) {
  const learned = flagOf(actor, "skills");
  const entry = Array.isArray(learned) ? learned.find(skill => skill?.uuid === page?.uuid) : null;
  const needed = Math.max(1, Number(flagOf(page, "points")) || 1);
  return (Number(entry?.points) || 0) >= needed;
}

/** Learned skills that lock this page out (it lists them, or they list it). */
export function lockersFor(page, tree, actor) {
  const pages = Array.from(tree?.pages ?? []);
  const own = new Set(flagOf(page, "lockoutSkills") ?? []);
  return pages.filter(other => other !== page && pageLearned(actor, other)
    && (own.has(other.uuid) || (flagOf(other, "lockoutSkills") ?? []).includes(page.uuid)));
}

/** One-line notification text. */
export function lockoutMessage(page, lockers) {
  const names = lockers.map(other => other.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${page.name} is locked out by ${list}.`;
}

const centre = (element, origin) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2 - origin.x, y: rect.y + rect.height / 2 - origin.y };
};

/** Pulse the locking skills and draw a dashed line to each, then clear after HINT_MS. */
export function showLockout(group, clicked, lockerElements) {
  group.querySelector(".gp-lockout-lines")?.remove();
  for (const element of group.querySelectorAll(".gp-lockout-pulse")) element.classList.remove("gp-lockout-pulse");
  // Same frame as Skill Tree's link lines: inside the group's 4px border.
  const box = group.getBoundingClientRect();
  const origin = { x: box.x + 4, y: box.y + 4 };
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("gp-lockout-lines");
  svg.setAttribute("viewBox", `0 0 ${box.width - 8} ${box.height - 8}`);
  const from = centre(clicked, origin);
  for (const element of lockerElements) {
    const to = centre(element, origin);
    const line = document.createElementNS(SVG_NS, "line");
    for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })) line.setAttribute(key, value);
    svg.appendChild(line);
    void element.offsetWidth; // restart the animation on a repeat click
    element.classList.add("gp-lockout-pulse");
  }
  group.appendChild(svg);
  clearTimeout(group.gpLockoutTimer);
  group.gpLockoutTimer = setTimeout(() => {
    svg.remove();
    for (const element of lockerElements) element.classList.remove("gp-lockout-pulse");
  }, HINT_MS);
}

/** Skill Tree actor window render: wire clicks on locked-out gathering skills. */
export function addLockoutHints(app, root) {
  const group = root?.querySelector?.(`.skill-group[data-group-id="${GROUP_ID}"]`);
  const tree = app?.skillTree;
  const actor = app?.actor;
  if (!group || !tree || !actor) return;
  for (const container of group.querySelectorAll(".skill-container.excluded[data-uuid]")) {
    if (container.dataset.gpLockout) continue;
    container.dataset.gpLockout = "1";
    container.addEventListener("click", () => {
      const page = Array.from(tree.pages ?? []).find(entry => entry.uuid === container.dataset.uuid);
      if (!page) return;
      const lockers = lockersFor(page, tree, actor);
      if (!lockers.length) return;
      const elements = lockers.map(other => group.querySelector(`.skill-container[data-uuid="${CSS.escape(other.uuid)}"]`)).filter(Boolean);
      showLockout(group, container, elements);
      ui.notifications.info(lockoutMessage(page, lockers));
    });
  }
}
