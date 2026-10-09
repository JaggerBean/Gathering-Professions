// Let dnd5e apply conditions, roll bonuses and advantage/disadvantage. Only the
// profession-specific dice/modifiers are added by this module.
export async function rollProfessionCheck(actor, check, { skill, tool } = {}) {
  const ability = check.abilityKey || (typeof check.ability === "string" ? check.ability : null)
    || actor.system?.skills?.[skill]?.ability || globalThis.CONFIG?.DND5E?.skills?.[skill]?.ability;
  const method = tool ? "rollToolCheck" : skill ? "rollSkill" : "rollAbilityCheck";
  if (ability && typeof actor[method] === "function") {
    const base = tool || skill ? Number(check.modifier) || 0 : Number(actor.system?.abilities?.[ability]?.mod) || 0;
    // The original formula contains d20 + its base modifier + profession and
    // situational terms. The system supplies that base itself.
    const extra = check.formula.replace(/^1d20\s*\+\s*-?\d+(?:\.\d+)?/, "").replace(/^\s*\+\s*/, "").trim();
    const config = { ability, ...(skill ? { skill } : {}), ...(tool ? { tool } : {}),
      rolls: [{ parts: extra ? [extra] : [] }] };
    if (!skill && !tool) {
      const offset = (Number(check.modifier) || 0) - base;
      if (offset) config.rolls[0].parts.push(String(offset));
    }
    const result = await actor[method](config, { configure: false }, { create: false });
    const roll = Array.isArray(result) ? result[0] : result;
    if (!roll) throw new Error("The profession check was cancelled before it rolled.");
    return roll;
  }
  // Non-dnd5e test/document doubles retain the existing formula behavior.
  return new Roll(check.formula).evaluate();
}
