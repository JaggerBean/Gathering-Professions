// Every Gathering Professions pop-up (material, perk, tool durability, rare
// table, character professions, confirmations) uses Foundry's DialogV2 with
// the module's "gp-dialog" styling, matching the GM hub.

const styled = options => ({ ...options, classes: [...(options?.classes ?? []), "gathering-professions-ui", "gp-dialog"] });

/** DialogV2 with the module styling: gpDialog().input/prompt/confirm/wait(options). */
export function gpDialog() {
  const DialogV2 = foundry.applications.api.DialogV2;
  return {
    input: options => DialogV2.input(styled(options)),
    prompt: options => DialogV2.prompt(styled(options)),
    confirm: options => DialogV2.confirm(styled(options)),
    wait: options => DialogV2.wait(styled(options))
  };
}
