// Transaction guard for the linked universal tree. The optional Skill Tree
// package stays untouched so dependency updates do not erase this fix.
import { MODULE_ID } from "./rules.js";
import { configuredSkillTree } from "./integrations.js";
import { runActorAction } from "./actions.js";

const guarded = new WeakSet();

export function guardSkillPurchases(app) {
  const tree = configuredSkillTree();
  if (!tree || app?.skillTree?.uuid !== tree.uuid || !(app.skills instanceof Map)) return;
  for (const skill of app.skills.values()) {
    if (!skill || guarded.has(skill) || typeof skill.computeCanBeUnlocked !== "function" || typeof skill.modifyPoints !== "function") continue;
    guarded.add(skill);
    skill.modifyPoints = amount => purchaseSkill(skill, amount);
  }
}

export function purchaseSkill(cached, amount) {
  return runActorAction(cached.actor, async () => {
    if (!Number.isInteger(amount) || !amount) return false;
    const actor = cached.actor, tree = cached.skillTree;
    if (tree?.uuid !== configuredSkillTree()?.uuid) throw new Error("The linked gathering skill tree changed. Reopen it.");
    if (!game.user.isGM && amount < 0 && game.settings.get("skill-tree", "playersCantRemovePoints")) return false;
    // Rebuild the dependency's models from current documents inside the lease.
    // Never validate lockouts or prerequisites against another window's cache.
    const models = new Map();
    for (const page of tree.pages) models.set(page.uuid, new cached.constructor(page, actor, models));
    const skill = models.get(cached.skill.uuid);
    if (!skill) throw new Error("That skill no longer exists.");
    await skill.computeCanBeUnlocked();
    if (amount > 0 && !skill.canBeUnlocked) return false;
    const wasUnlocked = skill.isUnlocked;
    const { value, max } = skill.points;
    const next = value + amount;
    const independent = tree.getFlag("skill-tree", "independentSkillPoints");
    const pointKey = independent ? `skillTreeSkillPoints.${tree.id}` : "skillPoints";
    const unspent = Number(actor.getFlag("skill-tree", pointKey)) || 0;
    if (next < 0 || next > max || unspent - amount < 0) return false;
    if (amount < 0 && !(skill.isTiered && next > 0)) {
      const incomplete = skill.skillData.allowIncompleteProgression || 0;
      if (!(incomplete && next >= incomplete) && [...models.values()].some(other =>
        other.skillData.connectedSkills?.includes(skill.skill.uuid) && other.isUnlocked)) return false;
    }
    const purchased = structuredClone(actor.getFlag("skill-tree", "skills") ?? []);
    const updated = purchased.filter(row => row.uuid !== skill.skill.uuid);
    updated.push({ ...(purchased.find(row => row.uuid === skill.skill.uuid) ?? {}), uuid: skill.skill.uuid, points: next });
    // Purchases and remaining points commit together, even if an item or
    // unlock-script operation later fails. Neither stale arrays nor split
    // writes can erase another purchase or charge a skill twice.
    await actor.update({ "flags.skill-tree.skills": updated, [`flags.skill-tree.${pointKey}`]: unspent - amount });
    skill.actorSkills = updated;
    cached.actorSkills = updated;
    if (!wasUnlocked && skill.isUnlocked) skill.playSound();
    await skill.updateItems({ soundPlayed: !wasUnlocked && skill.isUnlocked });
    await skill.executeUnlockScript();
    return true;
  });
}

export function registerSkillPurchaseHooks() {
  Hooks.on("renderSkillTreeActor", guardSkillPurchases);
}
