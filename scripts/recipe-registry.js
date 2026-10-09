// Recipe providers: one per Recipes-window tab. Gathering Professions
// registers a refining provider per gathering profession; other modules
// (Crafting Professions) register their own with api.recipes.register().
//
// Provider shape (functions may be omitted where noted):
//   key, label, verb, action, icon, order
//   rollLabel                      "Rolls Mining at the recipe's tier"
//   learnOptions                   [[value, label], ...] for the GM learn control
//   learnHint                      tooltip for the GM learn control
//   perCharacter                   true: learning is per character (GM picks one)
//   hiddenHint, emptyText          player-facing texts
//   visible(actor, isGM)           show the tab (optional; default true)
//   recipes({ includeDisabled })   rows: { id, tier, output, quantity, inputs: [[name, qty]], minutes?, disabled?, edited?, custom? }
//   isKnown(row, actor)            the player sees it
//   learnState(row, actor)         current value of the GM learn control
//   setLearned(id, state, actor)   GM
//   check(actor, row)              { target, modifier, die, extraDice? } or null (no chance shown)
//   blocked(actor, row)            reason the actor cannot make it now, or null (optional)
//   minutes(row), defaultMinutes(tier)
//   craft(actor, id, batch)
//   gm: { create(fields), update(id, fields), disable(id, on), reset(id), delete(id), scroll?(id) }
//   itemGroups(search)             editor picker groups (optional)
//   experiment(actor, names)       { learned: row|null, warm: boolean, message } (optional)
const providers = new Map();

export function registerRecipeProvider(provider) {
  if (!provider?.key || typeof provider.recipes !== "function") throw new Error("A recipe provider needs a key and recipes().");
  providers.set(provider.key, { order: 100, learnOptions: [["learned", "Learned"], ["unlearned", "Unlearned"]], ...provider });
  Hooks.callAll("gatheringProfessions.recipeProviders", recipeProviders());
  return providers.get(provider.key);
}

export function unregisterRecipeProvider(key) {
  providers.delete(key);
}

export function recipeProviders() {
  return [...providers.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function providerFor(key) {
  return providers.get(key) ?? null;
}

/** The provider whose recipes include this id (ids start with the provider key). */
export function providerForRecipe(id) {
  return providerFor(String(id).split(":")[0]);
}
