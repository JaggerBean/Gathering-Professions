# Gathering Professions

Foundry 14 + dnd5e + Gatherer 5.0.3. Enable this module alongside Gatherer. After updating module files while Foundry is running, restart the Foundry server and reopen the world so the new manifest, script, and stylesheet load.

## Renamed package upgrade (0.18.0)

Version 0.18.0 changes the package ID and installation directory from `eryndor-professions` to `gathering-professions`. Existing worlds must enable **Gathering Professions** once after replacing the old module. On the active GM's first load, the module copies legacy world settings and document flags into the new namespace. Existing values already saved under `gathering-professions` win, retries are safe, and legacy data is retained for rollback.

Macros and integrations must use `game.modules.get("gathering-professions")`, `flags.gathering-professions`, and the `gatheringProfessionsGatherComplete` hook. The built-in Gathering Skill Tree updates its internal group ID during the same load. After confirming the migrated world, the unused old package entry may be disabled or removed.

The module applies one profession roll **after Gatherer selects a reward and before it grants the item**. The existing Gatherer interception holds configured rewards until the asynchronous check and yield finish. The result's margin determines quantity and XP. Gatherer still owns node uses, resets, roll tables, and monster harvest interactions. Its use is consumed on every attempt, including failed and partial extractions.

Each configured material check posts a dice card showing the profession, material, rank, profession die, ability modifier, check dice, base DC, rank reduction, final DC, total, margin, extraction category, Base Yield, yield result or maximum, yield bonus, final quantity, and XP. Gatherer's separate “Gathered” card appears whenever an item is awarded, including partial extractions. If you see only a Gatherer card, confirm that the table result is an Item document in the Mining folders or that the Item has an explicit material assignment, then restart Foundry and reopen the world after a module update.

## Material yield and extraction results

Set **Base Yield** on a material to a positive whole-number dice formula, such as `1d4`, `1d2 + 1`, or `1`. The source is `flags.gathering-professions.material.baseYield` on the material Item. Missing or blank values default to `1`.

Margin is `check total − final DC`:

| Margin | Result | Quantity | XP |
| --- | --- | --- | --- |
| −5 or lower | Failed Extraction | 0 | 0 |
| −4 through −1 | Partial Extraction | Exactly 1; no yield roll | 0 |
| 0 through 4 | Successful Extraction | Base Yield roll | Normal material XP |
| 5 through 9 | Excellent Extraction | Base Yield roll + 1 | Normal material XP |
| 10 or higher | Masterful Extraction | Maximum Base Yield + 1 | Normal material XP |

For Stone with Base Yield `1d4`, these results give 0, 1, 1d4, 1d4 + 1, and 5 Stone respectively. For a fixed Base Yield of `1`, they give 0, 1, 1, 2, and 2. The default of `1` describes the base amount; Excellent and Masterful results still add one.

All dice use Foundry V14's asynchronous `Roll.evaluate()`. Masterful yield uses `evaluate({maximize: true, allowInteractive: false})`, as documented in the [Foundry V14 Roll API](https://foundryvtt.com/api/v14/classes/foundry.dice.Roll.html). Invalid or nonpositive/noninteger yield results report an error before granting items or XP.

Configured profession materials use only their Base Yield and extraction category for quantity. Gatherer quantity fields, table multipliers, and legacy `material.yield` flags do not override Base Yield. Existing nodes and tables need no changes; materials without the new field use `1`. Items with no profession assignment retain Gatherer's ordinary quantity behavior.

## Mining defaults

The Items currently in Professions > Mining > Stones, Ores, and Gemstones get default Mining tiers by name. The five base DCs are 10, 14, 18, 23, and 28. A success grants 5, 10, 20, 35, or 60 XP. Rank thresholds are 0, 100, 300, 700, and 1500 total XP. Ranks 1–5 grant d4, d6, d8, d10, d12 and lower the DC by 0, 2, 4, 6, 8. Mining and Logging use Strength; Herbalism and Skinning use Wisdom. In milestone mode, these XP thresholds are guides; the GM controls actual rank advancement.

## In-game editor

As GM, open the **Items** sidebar and click **Profession Materials**. You can also find **Open Materials Editor** in **Game Settings → Configure Settings → Module Settings → Gathering Professions**. The manager lists assigned materials with their Base Yield and lets you search, edit a material, assign another world Item, and open the hub's **Rules** section. You can also open any world Item and choose **Material** in its sheet header. Both entry points use the same editor. Choose a profession and tier, enter Base Yield, and optionally override DC and XP. **Use mining default** keeps the automatic Mining assignment while allowing Base Yield to be saved. **No profession check** excludes an Item.

Click the **hammer (Gathering Profession — Choose / View)** under the left-side **Token Controls** to open the profession menu. It opens a selected owned character token, otherwise your assigned character. If neither is available, it offers an owned-character chooser. The character sheet's **Professions** header entry remains available. The selected profession is displayed prominently at the top of the menu, with a star in its progress row.

Characters start with **no selected profession** and rank 0 in all professions. Players choose one profession once on a character they own; only the GM can change or clear it afterward. A new character starts at rank 1 in the selected profession. Existing XP and saved milestone ranks are retained. The other professions remain untrained, with no profession die or rank reduction, regardless of their banked XP or old saved ranks. The GM can edit XP, change the selection, and edit the selected profession's milestone rank in this menu. After changing the selection, save and reopen to edit the newly selected rank.

**Upgrading to 0.4.0:** existing characters are not automatically assigned a profession. Choose one before testing trained gathering. No existing XP or saved ranks are deleted. In automatic mode, selecting a profession uses its accumulated XP to determine rank. In milestone mode, its saved rank is used (rank 1 if no manual rank has been saved); banked XP alone never promotes a milestone rank.

## Untrained gathering and extra DC

Untrained attempts roll **d20 + the relevant ability modifier**, with no profession die and no rank reduction. Their target is **material Base DC + tier extra untrained DC + material extra untrained DC**. This uses that material's full DC, not the highest tier's DC. Trained checks ignore both extra penalties.

Edit the tier extras in **Gathering Professions → Rules → Extra untrained DC**. Edit an individual material's extra in **Profession Materials → Edit → Extra untrained DC**. Both default to 0 until you set them. The manager shows the combined untrained DC, and chat shows each addition separately. For example, Base DC 18 + tier extra 4 + material extra 2 gives an untrained DC of 24.

Untrained successes award the same material quantities and XP as trained successes. That XP is marked **banked** in the menu and chat: it does not grant untrained ranks, dice, or DC reduction. Failed/partial extractions still grant no XP. Changing profession later keeps all banked XP and saved ranks; automatic or milestone advancement then controls the selected profession as described above.

## Rank advancement modes

As GM, open **Gathering Professions → Rules → Rank advancement**. Choose **Automatic when XP threshold is reached** (the existing behavior) or **GM awards ranks at milestones**. The choice applies to the world, while ranks are saved separately for each character and profession.

When milestone mode is first enabled, the module saves each existing character's current XP-derived rank in their selected profession. New selections without saved ranks start at Rank 1. Gathering still awards XP, but crossing a threshold does not change a rank, profession die, or rank-based DC reduction. To promote a character, select their token, click the left-side hammer, choose the new rank for their selected profession, and save. Promotion can happen at any XP total. The XP value under “Next-rank XP guide” is informational.

Switching back to automatic mode immediately determines effective ranks from current XP. If milestone mode is enabled again later, it saves those current automatic ranks as the new starting ranks. Only the GM can change the advancement mode or manual ranks.

The trained check is `d20 + ability modifier + profession die` versus `material DC − rank reduction`. Gatherer may also run its own configured check first. To use only profession checks, clear the Gatherer page's ability/tool DC fields.

## Other materials and overrides

Assign herbs, logs, and monster parts through **Profession Materials** or the Item's **Material** header button. All professions use the same extraction rules. Material settings are saved as Item flags. Tier DC, XP rewards, rank XP thresholds, and rank DC reductions remain unchanged and are saved as world settings through the Rules editor.

Gatherer roll table results should point to actual Item documents. Plain text results receive no profession check or XP. A mixed tier table is supported because the check happens after the result is selected.

## Custom professions (0.5.0)

As GM, open **Gathering Professions → Professions** (from Module Settings or the Profession Materials toolbar). Each row sets a profession's name, check ability (any of the six), and rare-find table. Click **Add a profession** to add one. A blank key is built from the name, such as `fishing` for Fishing. Keys cannot change after saving, because character XP is stored under them.

Removing a profession keeps all character XP. Materials assigned to it fall back to Gatherer's normal awards. A character who chose it shows no profession until the GM picks one. Mining, Herbalism, Logging, and Skinning stay the defaults until the list is first saved. Existing Harvesting selections, XP, ranks, materials, nodes, perks, and condition modifiers are read as Skinning. New changes save the Skinning key.

## Skill Tree link (0.5.0)

This uses the Skill Tree module by theripper93. Use the universal tree (below) or build your own shared tree. Give players Observer permission on it. In **Gathering Professions → Skill Tree**, choose the tree, then set **Points per rank-up** and **Points at Rank 1**.

Players can open the linked tree from the **Gathering Skill Tree** button directly beneath **Gathering Profession** in the left token controls. It uses the selected owned character token, then the assigned character; if needed, it lets the player choose among owned characters. The button opens the same character tree view as the character-sheet Skill Tree button.

- A character has earned **Points at Rank 1 + Points per rank-up × (rank − 1)** for the rank of their profession (any profession). They are topped up to that amount in the linked tree, in automatic or milestone mode (0.9.1).
- Points are recorded per tree. Linking a new tree, or raising the points settings, grants the difference. The first sync with a tree counts points the character already holds or has spent there.
- The active GM syncs every character when the world loads and whenever the tree link or points settings change. Saving the hub's **Skill Tree** section also syncs everyone.
- Lowering a rank after the rebalance does not automatically remove points. Re-reaching an earlier rank grants nothing. A GM profession change does not grant a second set of points. The GM can reset one character's universal tree from its skill tree window.

Skill requirements can read these actor attributes:

| Attribute key | Value |
| --- | --- |
| `flags.gathering-professions.professionRank` | Rank 0–5 in the character's selected profession (available to custom trees) |
| `flags.gathering-professions.effectiveRank.mining` | Effective rank 0–5 (0 = untrained) |
| `flags.gathering-professions.selectedProfession` | Selected profession key, such as `mining` |
| `flags.gathering-professions.xp.mining` | Total XP, including banked XP |

Example: a "Deep Vein Sense" skill with requirement `flags.gathering-professions.effectiveRank.mining` greater-or-equals `3`.

## Universal gathering skill tree (0.9.0)

One tree serves every gathering profession. In **Gathering Professions → Skill Tree**, click **Check gathering content**; it links the tree, or builds it if missing. It creates 30 skill Items in the folder **Gathering Skill Tree** and a Skill Tree journal with the same name. Points: **2 at Rank 1** and **2 per rank-up**, which is 10 over five ranks. Existing 3/3 settings use this 2/2 rate after the module loads. On the active GM's next world load, characters with more than the new point budget have their universal-tree choices and linked perk Items reset, then receive the new point total. Other trees and their Items stay intact. The module also sets it up by itself (see Gathering content). From a macro: `game.modules.get("gathering-professions").api.skillTree.build()`.

The tree is a hexagon (0.9.1). The six themes are six spokes. The tier 1 skills form the inner ring: they have no prerequisite, so they are the starting choices. Each spoke grows outward to its capstone at the tip. Each skill opens the next skill on its spoke. Cross-theme links between tier 2 and tier 3 work in both directions, including Conservationist and Reader of Seasons. Nodes need enough skill points and one linked skill; none requires a profession rank. Capstones (tier 5) cost 2 points, and taking one locks the other five. The tree has its own point pool and no group label. An existing universal tree updates its links and label automatically when the GM loads the world; a test tree also loses its `(Test)` title suffix. Existing choices stay unless the point rebalance resets that character. Call `api.skillTree.relayout()` to run the tree update again.

When a GM views a character's linked Gathering Skill Tree, **Reset Skills** appears beside the point total. Confirming clears that character's learned skills in this tree, removes their linked perk Items, and refunds the points earned at their current profession rank. It leaves other trees alone. The module saves a recovery copy of the previous skill entries, point total, and removed Items in the character's `flags.gathering-professions.lastSkillResetBackup.<treeId>`. The automatic rebalance saves its copy under `pointRebalanceBackup.<treeId>`.

| Tier | Bounty | Fortune | Technique | Craft | Wayfinding | Fellowship |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Steady Hands: +1 yield | Keen Eye: +3% rare | Proficient Gatherer: +1 check | Toolwise: +1 with a tool | Trail Sense: sense +1 rank | Field Hand: Assist +2 |
| 2 | Light Touch: 15% no pull | Discerning Eye: climb on 19–20 | Second Look: optional reroll of a failure per long rest | Jack of All Trades: half untrained DC | Reader of Seasons: half scarcity | Reliable Partner: Assist +2 more |
| 3 | Bountiful: great success draws 1 extra | Treasure Hunter: +6% rare | Practiced Technique: −2 DC | Masterwork Handling: tools on skill checks | Pathfinder: see drop odds | Conservationist: +15% no pull |
| 4 | Abundance: +2 yield | Rich Find: rare draws twice | Expert Technique: +1d4 check | Weatherproof: ignore condition DC increases | Deep Sense: sense +1 rank | Mentor: Assist +1d4, half untrained |
| 5 | Master Harvester: +1 extra draw, +1 yield | Fortune's Favour: +5% rare, climb rolls twice | Grandmaster's Touch: chosen auto-Masterful per long rest | Master Artisan: tool bonus ×2, no untrained DC | Wayfarer: ignore scarcity, sense every node | Steward of the Wilds: +20% no pull |

- "Great success" means an Excellent or Masterful extraction. Extra draws use the node's table with current conditions, and award the material's base yield. They give no XP and no rare roll.
- **No pull**: after a gather on a node with limited pulls, d100 at or under the chance refunds the pull. The active GM applies the refund. Chances add up to 90%.
- **Second Look** (0.13.0): when a gather fails and a use is left, the player is asked whether to reroll the check. Declining keeps the use for a later failure. A dnd5e long rest refreshes it.
- **Grandmaster's Touch** (0.13.0): once per long rest, tick **Use Grandmaster's Touch** under the Gather button in the gathering window before gathering. That gather is a Masterful extraction with no check roll (maximized yield, Masterful bonus, XP, extra draws). With a rare table configured, it earns a rare find on the material's tier. The character's owner starts the **Fortune die** from the chat card; the active GM resolves it and awards the result. A 20 (19–20 with Discerning Eye) climbs, as after a natural 20. An ally's Assist is not used up by it. A long rest refreshes it.
- **Scarcity relief** moves multipliers below ×1 toward ×1 (Reader of Seasons halves the gap, Wayfarer removes it). ×0 still blocks gathering.
- **Sense** bonuses add to the profession rank when checking a hidden node's sense rank. Wayfarer senses every node with a sense rank above 0. Nodes with sense rank 0 stay GM-only.
- **Assist**: open a node's gathering window with a character who has Field Hand, Reliable Partner, or Mentor, then click **Assist others here**. The next gather at that node by another character, within one in-game hour, gets the bonus. Then the offer is used up. The strongest offer applies, and offers do not stack.

## Tiered rare finds (0.10.0)

Each profession has one rare-find table per material tier. Set them in **Module Settings → Gathering Professions → Rare-Find Tables** (or the **Rare-Find Tables** button in the Profession Materials window). Tick **Build the default rare finds for empty tiers** to create three unique Items per tier for Mining, Herbalism, Logging, and Skinning (60 Items, 20 tables, folders named **Rare Finds**). Each default Item exists only on its table. Rename, re-art, or replace them freely. From a macro: `game.modules.get("gathering-professions").api.rareFinds.build()`.

**Getting a rare find** (only on Successful, Excellent, or Masterful extractions):

1. A **natural 20** on the gathering check is always a **Masterful extraction**, whatever the total and DC. With a rare table configured, it earns a rare find for trained and untrained gatherers alike.
2. A **Masterful extraction** always earns a rare find while **Rules → Masterful extraction always earns a rare find** is on.
3. Otherwise, **trained** gatherers roll d100 at or under their rare chance: Fortune skills, plus the node's rare bonus, plus the **Excellent extraction rare-find bonus** (Rules, default +10%) on an Excellent roll. **Untrained** gatherers get rare finds only from 1 or 2.

**Which table:**

- The find starts on the table for the **material's tier**. A node's or material's own rare table replaces this starting table only.
- **Climbing:** a natural 20 on the gathering check moves the find up one tier. At each new table, the character's owner uses the **Roll the Fortune die** button on the chat card (or in the gathering window). The active GM resolves that request and awards the result once. A 20 climbs again and asks for another roll; anything else settles the find and draws it. Nothing is drawn until the button is used. Only the character's owners and the GM can start it. **Discerning Eye** makes these rolls climb on 19–20. **Fortune's Favour** rolls them twice and keeps the better. The check's own natural 20 is always exactly one step, and a tier 5 material's natural 20 needs no roll. Waiting rolls are kept on the character (`flags.gathering-professions.rareClimbs`) and survive a reload. If an item award fails partway through, the find locks for GM review; retrying it cannot award earlier items again.
- **Beyond tier 5:** if a find would climb past tier 5 (a tier 5 material with a natural 20, or a 20 at the tier 5 table), the character still draws from tier 5. The chat card says something more lies hidden, and the GM gets a private whisper to describe a story discovery on the spot.
- A tier with no table uses the profession's **any-tier rare table** (Gathering Professions → Professions). A climbed find whose tier is empty uses the nearest lower tier that has a table.
- **Rich Find** draws one more time from the final table reached.

The chat card shows the trigger, each climb roll, the final tier and table, and the Items found. The gathering window shows the tier, a climb marker, and the story note.

## Gathering perks and rare finds (0.5.0)

Open any Item as GM and click **Gathering Perk** in the sheet header. Choose a profession or **Any profession**, then set any effects. Link that Item to a skill in the tree, so unlocking the skill gives the character the perk. Hover a field for its rule. Numbers from every perk the character owns add together, up to each field's cap. Dice and relief shares use the largest value, and on/off effects apply if any perk has them. The rare chance is capped at 100%.

Leftover perk Items do not count (0.10.1): a universal skill Item applies only while that skill is unlocked in the linked tree. Perks the GM hands out directly always apply.

Effects (0.9.0): check bonus, DC reduction, bonus die, partial counts as success, rerolls per long rest, yield bonus, extra draws on great success, no-pull chance, rare-find chance, roll rare chance twice, extra rare draws, double rare chance, tool bonus, tools on skill checks, double tool bonus, untrained penalty relief, ignore condition DC penalties, scarcity relief, see drop odds, sense bonus, sense every hidden node, assist bonus, assist die, assist untrained relief. Perks saved before 0.9.0 keep working.

- **Yield bonus** adds to Successful, Excellent, and Masterful quantities. Partial (exactly 1) and Failed (0) do not change.
- **Rare-find chance** rolls d100 on any full success. A roll at or under the chance draws once from the rare-find table.
- **Masterful extractions** and natural 20s earn a rare find when a rare table is configured (see Tiered rare finds). On those, no d100 roll is made.
- The tables used are described under **Tiered rare finds** (0.10.0). No table at all means no rare finds.
- Rare tables are read with `RollTable#roll()`, so results are never marked drawn, and players need no edit permission. Item results are added to inventory with quantity 1. Text results appear on the chat card only.
- If a rare table is missing, the normal material is still awarded and an error names the table.

The chat card shows a **Perk Bonus** line with the perk names, a **Skills** box listing the check, Assist, reroll, and extra-draw effects that applied, and a **Rare Find** box with the trigger and results.

## Conditions & biomes (0.8.0)

Season, weather, time of day, and biome change what a node gives and how hard it is.

**Where the values come from**
- **Season:** your Simple Timekeeping calendar's current season. Rules use the season's name, e.g. `winter`.
- **Weather:** Simple Timekeeping's weather badge (Clear, Rain, Snow, Fog, Mana Storm, …).
- **Time of day:** Dawn, Day, Dusk, or Night, from Simple Timekeeping's current dawn and dusk (per-month calendar values, then latitude, then its config), so it matches scene lighting. Dawn and Dusk each last about two hours.
- **Biome:** the node's own Biome (Node Manager → Basics), otherwise its scene's default biome.
- **Pins:** the GM can pin season, weather, or time in **Conditions & Biomes → Current**. Pins replace Simple Timekeeping's values until they are set back to Automatic.

**Weight multipliers.** Open a material's editor (the Material button on the Item sheet, or Profession Materials → Edit) and add condition rules, e.g. Night ×3, Day ×0.5, Winter ×0.
- Every matching rule multiplies the material's table weight. Rules that don't match leave it unchanged.
- ×0 removes the material while that condition holds.
- Weight lost to conditions becomes a chance to find nothing. A node's only material at ×0.5 is found half the time; the pull is still used. Multipliers above ×1 only shift odds between materials on the same node.
- A node can override a material's rules for that node only: Node Manager → Materials tab → the material's condition rules → **Override**.
- When conditions remove every material from a node, gathering is refused with the reason, and no pull is used.
- The real table is never edited: the weights are adjusted only while Gatherer draws.

**DC modifiers.** In **Conditions & Biomes → Difficulty**, each row adds to the final DC when its condition holds, for every profession or just one, e.g. Blizzard +5 for everyone, Night +2 for Mining. The chat card shows a **Conditions** line, and the gathering window's success chance includes it.

**Biomes.** **Conditions & Biomes → Biomes & Scenes** edits the biome list (starts with Arctic, Coast, Desert, Forest, Grassland, Hill, Mountain, Swamp, Underdark, Urban) and each scene's default biome.

**Gathering window.** A strip under the banner shows the current conditions. Discovered materials show **Abundant now**, **Scarce now**, or **Not found now**. The GM view shows the current drop %, each material's multiplier, and the chance to find nothing.

Open **Conditions & Biomes** from the cloud button in the Node Manager, from Profession Materials, or from Module Settings. Macros can use `game.modules.get("gathering-professions").api.conditions`.

## Gathering window (0.7.0)

Double-clicking a node's map pin opens the **gathering window** instead of the journal page. GMs can also open it with the hand button in the Node Manager.

- **Banner:** the node's icon in a profession-colored emblem, its name, profession, tier, and region, plus the GM-written **Description** (Node Manager → Basics). Below it are the pulls left and the time until the node refills.
- **Possible yields:** materials appear only after the party has gathered them at this node. Until then they show as **???**. Discovery is shared by the whole party and stored on the page. Players record it through the active GM, so a GM must be online. Rare finds are never listed. The GM sees every material with its drop % and DC.
- **Gatherer panel:**
  - The character who will gather: the selected token, otherwise the assigned character. The GM can choose any character.
  - Their profession, rank, and die, and the check (ability or skill, tool bonus, die).
  - ✓/✗ for minimum rank, tools, and the Gatherer page's Requires list.
  - An estimated chance of a full success (Easy, Fair, Hard, or Very hard) across the node's materials.
- **Gather button:** it is disabled, with the reason shown, when a requirement is missing, the node is exhausted, or no GM is connected.
- **Animated result:**
  - The dice settle, and the extraction tier banner appears (colored, glowing on Masterful).
  - Item icons pop in with quantities, rare finds glow, the XP bar fills, and rank-ups are announced.
  - The usual chat cards are still posted.
- **GM footer:** Edit (opens the Node Manager), Refill, Reveal/Hide, and Open the original page.

### Gathering attempts and exhaustion (0.17.0)

Each character starts with **5 free gathering attempts per long rest**, shared across every profession, node, and Gatherer page. A valid Gather click uses one attempt even if the check fails or nothing is found. Blocked requirements, empty-by-conditions nodes, and depleted nodes do not spend one. Bonus draws from perks do not cost extra attempts.

After the free attempts run out, each further Gather click asks for confirmation before raising that character's dnd5e exhaustion by 1. Canceling leaves both the attempt count and exhaustion unchanged. Gathering stops at the system's maximum exhaustion level (normally 6). A long rest restores free attempts; dnd5e handles any exhaustion reduction normally.

The gathering window shows the selected character's remaining free attempts. The same limit also applies when gathering through Gatherer's original journal sheet or other Gatherer entry points. The GM can change the world limit in **Gathering Professions → Rules → Free gathering attempts per long rest**; **0** disables the limit and exhaustion penalty.

The module now uses a socket for party discovery. After updating from 0.6.x, restart the Foundry server once.

## Gathering nodes (0.6.0)

As GM, open the **Node Manager** in any of these places:
- The mountain button in the left **Token** or **Notes** controls.
- The **Nodes** tab of the GM hub (**Gathering Professions**).
- **Module Settings → Gathering Professions → Open Node Manager**.

### Node Manager layout (0.6.1)

The window has two panes:
- **Left: the node list.** Nodes are grouped by journal, and each group can be collapsed. Each row shows the node's icon, pulls left with a bar, profession and tier, up to four material icons (hover for drop %), and status badges. Linked placements appear under one expandable parent row, with each placement's own pulls and map position. Multiple pins on a single node show a shared-pulls count.
  - At the top: **New Node**, search (matches node and journal names), and scene and profession filters.
  - The checklist button turns on bulk mode: select nodes, then use the bar at the bottom to refill, reveal, or hide them.
- **Right: the selected node.**
  - The header holds the action buttons: open page, add a shared-pool pin, add a linked placement, refill, reveal/hide, duplicate independently, and delete.
  - Below it are a pulls bar and the badges.
  - Then four tabs to edit the node in place: **Basics**, **Materials**, **Check & Rules**, and **Visibility**.
  - Unsaved changes are marked; **Revert** undoes them. Switching nodes asks before discarding changes.
  - The list refreshes by itself when nodes, pins, or tables change.

- **Pin icon:** click it to open a picker of material images, grouped by profession in expandable sections. **Default** uses the first material's image.
- **Required tools:** a node can accept several tools; carrying any one is enough.
  - Drop an Item on **Drop an Item** to add it to the node and to the world **tool library**.
  - To add a tool used before, pick it from the library dropdown.
  - Remove a tool from the node with its ✕, or from the library in the **Tool library** list. Nodes that use it keep it.
  - A character's Item matches if it was copied from the stored Item (Foundry's source ID), or if it has the same name. When several matching tools are carried, the one with the highest proficiency bonus is used.
  - Nodes from 0.6.0 with a typed tool name still work.
- **Rare-find table:**
  - Choose from a dropdown of every Rollable Table, grouped by folder, or drag a table onto it.
  - The table's contents and odds are shown below the dropdown.
  - **+** opens a quick-create window: search Items, give weights, and it makes a table in **Rare Find Tables** and selects it.

### Node Builder

Click **New Node**. Fill in:
- Name, scene, profession, tier label, and pin icon.
- Pulls, and reset hours.
- A weight for each assigned material. Weight 0 leaves it out.

The builder creates a Rollable Table in **Node Tables**, a Gatherer page in the journal **Nodes — <Scene>** (folder **Gathering Nodes**), and, optionally, a pin. The next left-click on the map places the pin; right-click cancels. Editing a builder node rewrites its table from the new weights. Hand-made Gatherer pages can still use every override; only their materials are edited in the table itself. The scene is set only when a node is created, so to move a node, place a new pin and delete the old one.

### Reusing a node on the map (0.16.0)

Select a node and open **Visibility → Placements** (or use the map-pin/link buttons in its header):

- **Add shared-pool pin** places another pin on the same Gatherer page. Both pins use the same pulls, reset timer, discovery, and visibility. The manager keeps one row and labels its pin count. The Placements list shows each pin's scene and coordinates so you can locate or remove it.
- **Add linked placement** places a new Gatherer page on the map. It shares the exact same Rollable Table but has independent pulls, reset timer, discovery, visibility, and other node settings. The manager groups linked placements under one expandable entry. Editing material weights on any linked builder page changes the table for all of them. Deleting one linked page removes only its pins; the builder table remains until no pages use it.

**Duplicate** remains an independent copy with its own table. It is not grouped with linked placements.

### Per-node overrides

Overrides are stored in `flags.gathering-professions.node` on the Gatherer page.

| Setting | Effect |
| --- | --- |
| Check | Profession default, any ability, or any dnd5e skill. A skill uses its full bonus (ability + proficiency or expertise), plus the profession die if trained. |
| DC modifier | Added to every material's final DC on this node (−20 to +20). |
| Yield modifier | Added to Successful, Excellent, and Masterful quantities (−10 to +10). A full success always gives at least 1. Partial and Failed results do not change. |
| Minimum rank | Below this rank in the node's profession, the attempt is refused before Gatherer uses a pull. Untrained characters cannot gather here. |
| Required tool | The character must carry an Item with this exact name (case does not matter); otherwise the attempt is refused with no pull used. If proficient with the tool, proficiency bonus is added. It does not stack with a skill check. |
| Rare-find bonus % | Added to the character's perk chance, capped at 100%. |
| Rare-find table | Overrides the material and profession tables for this node. |

The chat card shows the check used, the tool bonus, the node DC modifier, and the node yield.

### Hidden pins and profession sense

- **Hidden until revealed**: the page is set to None for players, so its pins and page are invisible to them. Gatherer's own sheet still works for the GM.
- **Reveal or hide** with the eye button, or the bulk buttons, in the Node Manager.
- **Profession sense**: while a node is hidden, each player whose owned character has the node's profession at that rank or higher gets Observer on the page and sees the pin. This updates automatically when ranks, profession choices, or character assignments change.
- Pins turn grey when a node runs out of pulls. The active GM resets timed nodes as world time passes, so pins come back without anyone opening the page.

### Manager actions

You can filter by scene, profession, or name. Select nodes to reset, reveal, or hide them in bulk. Each row has buttons to open, edit, place a pin, reveal/hide, reset, duplicate, or delete. Delete also removes the node's pins and its builder table.

From macros, use `game.modules.get("gathering-professions").api.nodes`. It includes `build`, `update`, `duplicate`, `delete`, `reset`, `setHidden`, `placePin`, `placeLinked`, `openManager`, and `openBuilder`.

## Nodes tab and styled pop-ups (0.21.0)

- The **Node Manager** now lives in the GM hub as the **Nodes** tab. Every way of opening it (mountain button, Module Settings, gathering window Edit, `api.openNodeManager`) opens the hub on that tab. Placing a pin minimizes the hub until you click the map.
- The remaining pop-ups (Material, Gathering Perk, Tool Durability, Create Rare-Find Table, a character's Professions, and confirmations) use the hub's dark-and-gold style.
- The old **Profession Rules** and **Professions & Skill Tree** dialogs are gone. `api.openRulesEditor()` and `api.openProfessionsEditor()` open the hub's Rules and Professions sections. The "Open Tier & Rank Rules" buttons open the hub's Rules section.

## Material presets (0.22.0)

**GM hub → Materials → Apply preset** (shown on a profession's tab when Kris's Compendium of Trade Goods, `kctg-5e`, is active; Skinning also needs Heliana's Harvest Compendium, `helianas-harvest-compendium`) sets up a ready-made material set: missing Items are imported from the compendium (Items already in the world with the same name are reused), assigned at their tier, each tier's rare-find table is replaced with the preset's rare finds, and the profession's other materials are unassigned (Items are kept). From a macro: `api.presets.apply("herbalism")`.

- **Herbalism** (5 per tier; yield 1d3 / 1d2 / 1d2 / 1 / 1). T1 Clover, Dandelion, Chamomile, Wild Mint, Nettle; T2 Horsetail, Coneflower, Laurel, King Bolete, Puffball; T3 Blue Chanterelle, Indigo Milkcap, Stargazer Lily, Pennyroyal, Death Cap; T4 Last Hope Fire, Roseoflava, Green Elf Cup, Neon-Ront, Nerium; T5 Bearberry, Myrrh, Sunberries, Toadstool, Henbane. Rare (3 per tier): Matsutake, Verdigris Waxcap, Golden Berry / Witchhat Mushroom, Forest Lantern, Jack'o'lantern Mushroom / Divine Light, Purple Emperor, Funeral Bell / The Last Veiled Widow, Daer-Kron, Kurnarac / Silphium, Belladonna Fruit, Wolf Bane's Leaves.
- **Mining** (ores and stone; gemstones as rare finds). T1 Stone, Cobblestones, Sandstone, Coal, Copper Ore; T2 Granite, Quartzite, Tin, Lead, Iron Ore; T3 Marble, Alabaster, Silver Ore, Gold Ore, Kyanite; T4 Platinum Ore, Kornerupine, Harunite, Ravenar, Benitoite; T5 Mithral (or a world "Mithril"), Hambergite, Adamantine, Cold Iron, Palladium. Rare: Quartz, Agate, Obsidian / Moonstone, Bloodstone, Citrine / Amethyst, Jade, Amber / Aquamarine, Topaz, Peridot / Blue-White Diamond, Red Topaz, Dragon's Heart.
- **Logging** (logs, then rough planks and lumber; prized woods and tree products as rare finds). T1 Brushwood Bundle, Bamboo, Cedar Log, Pine Log, Hickory Log; T2 Birch Log, Maple Log, Fir Log, Oak Log, Retama; T3 Cedar, Fir, Hickory, Birch, Oak Plank; T4 Teak Plank, Redwood Plank, Pine Plank, Poplar Lumber, Maple Lumber; T5 Palo Verde, Aspen, Walnut, Sandalwood, Mahogany Lumber. Rare: Acorns, Pine Tar, Charcoal / Teak Log, Redwood Log, Sandalwood Oil / Aspen Log, Poplar Log, Vertugal / Ironwood Log, Walnut Log, Maple Sap / Darkwood, Mahogany Log, Sandalwood Log.
- **Skinning** (tiers follow creature toughness; Kris's named animal parts plus Heliana's generic Beast parts, with Heliana Monstrosity parts only at tier 4 and Dragon parts only at tier 5). T1 small game: Chicken Bones, Mole Rat Hide, Fox Hide, Crow Feathers, Beast Hair; T2 livestock and deer: Cowhide, Ram's Horn, Antlers, Beast Pelt, Beast Bone; T3 big predators: Bear Hide, Boar Cranium, Shark Teeth, Beast Tusk, Beast Pouch Of Claws; T4 monsters and giant vermin: Tiger Hide, Chitin, Exoskeleton, Monstrosity Pelt, Monstrosity Bone; T5 dragons: Dragonhide, Dragon Bones, Dragon Scales, Dragon Talons, Dragon Horn. Rare: Corvus Corax, Beast Pouch Of Feathers, Beast Egg / Beast Heart, Beast Phial Of Blood, Beast Pouch Of Teeth / Boar Head, Beast Poison Gland, Beast Talon / Monstrosity Heart, Monstrosity Poison Gland, Monstrosity Eye / Dragon's Skull, Dragon Eye, Dragon Breath Sac.

## Materials browser (0.19.0)

**GM hub → Materials** (also the **Profession Materials** settings button) shows one profession at a time (tabs across the top):

- **Gathering materials** by tier 1–5, as tiles with DC, XP, base yield, a condition-rules badge, and the nodes that drop them. A red outline means no node drops it yet. Click a tile to edit the material; × stops treating the Item as a material (its settings are kept). Drop a world Item on a tier to make it a material of this profession at that tier.
- **Rare finds** by tier, read from that tier's rare-find table (or the any-tier table, marked). Each item shows its weight and chance within the tier. Drop an Item on a tier to add it to that table (the table is created if missing); × removes it; change weights and **Save rare weights**. Click an item or table name to open it.

## GM hub (0.15.0)

Every GM setting is in one window, **Gathering Professions**, styled like the gathering window. Open it from **Module Settings → Gathering Professions** (each button opens its section) or from the Profession Materials toolbar. Sections:

- **Professions:** name, key, check ability, and the any-tier rare table (drop a Rollable Table). Add or remove professions (XP is kept).
- **Skill Tree:** linked tree, points at rank 1 and per rank-up, open the tree, and **Check gathering content** (links or builds the tree, and builds missing rare tables, basic tools, and difficulty values).
- **Tools:** each profession's accepted tools as tiles (name, bonus, durability). Drop a tool Item to accept it; × to stop accepting it.
- **Rare Finds:** a slot per profession and tier showing the table and its Items. Drop a table to replace it; build the defaults for empty tiers.
- **Rules:** advancement, extraction rules, and the tier/rank table.
- **Conditions:** Current pins, Biomes & Scenes, and **Difficulty**: a grid of every season, time of day, weather, and biome with its DC change (0 = none), plus optional profession-specific extras. **Recommended values** fills the grid with the defaults.

**Recommended difficulty** (moderate, penalties only, the same for every profession; seeded once if the world has none): Winter +2; Dawn +1, Dusk +1, Night +2; Overcast, Drizzle, Mist, Windy, Sunshower +1; Rain, Snow, Fog, Celestial Eclipse, Ethereal Drizzle +2; Hail, Ashfall, Blood Rain, Arcane Fog +3; Thunderstorm, Sandstorm, Meteor Shower, Wild Magic Winds +4; Blizzard, Tornado, Hurricane, Mana Storm, Spectral Storm +5; Voidstorm, Frozen Hell +6; Mountain, Swamp +1; Arctic, Desert, Underdark +2. Everything else 0.

## Gathering tools (0.14.0)

**Every gather needs a tool when its profession requires one.** Each profession has a list of accepted tools (**Module Settings → Gathering Professions → Gathering Tools**, or the **Gathering Tools** button in Profession Materials). A character without an accepted tool cannot gather ("You need Miner's Pick to gather here"), and no pull is used. This applies to module nodes and plain Gatherer pages. When a table contains materials from several professions, the character needs an accepted tool for every profession that table can produce.

- **Basic tools:** when the GM loads the world, the module creates one tool Item per profession that has none, in the Items folder **Gathering Tools**, and makes it the default: **Miner's Pick** (Mining), **Herbalism Sickle** (Herbalism), **Woodcutter's Axe** (Logging), **Skinning Knife** (Skinning). Basic tools add no bonus. Give characters a copy (drag it onto them).
- **Better tools:** drop another tool Item into a profession's row to accept it as well. If a character carries several accepted tools, the best one (highest proficiency bonus) is used. A proficient tool adds proficiency to the check.
- **Node-specific tools:** a node's own tool list (Node Manager → Basics → Tools) replaces the profession's list for that node, so a deep vein can accept only a Mithril Pick. Leave it empty to use the profession's tools.
- The tool used is the one that loses durability on a natural 1 (below). A profession with no accepted tools needs none.

## Tool durability (0.12.0)

Tools wear out on bad luck. When a character gathers at a node that needs a tool, every **natural 1** on the gathering check (a Second Look reroll included) costs the tool they use **1 durability**. The chat card and the gathering window show the tool's durability.

- **Maximum:** the world default is **10** (**Gathering Professions → Rules → Default tool durability**). Set a tool's own maximum with **Tool Durability** in its Item sheet header (GM; shown on tool Items, tools in the Node Tool Library, and Items that already have durability). Maximum **0** means the tool never wears.
- **Broken:** at 0 the tool is broken. It no longer meets the node's tool requirement or adds its bonus, and gathering is refused with "… is broken" unless the character carries another accepted tool. It is not deleted.
- **Repair:** GM, **Tool Durability → Repair fully** on the character's copy, or `api.durability.repair(item)`. Each character's copy keeps its own current value (`flags.gathering-professions.durability`).

## Gathering content (0.11.0)

Everything the module needs lives in the module and your world; there is no test kit. When the GM loads the world, the module checks once:

- **Gathering Skill Tree:** when Skill Tree is active, the linked universal tree, or any universal tree in the world, is linked. With none, one is built (journal and 30 skill Items in folders named **Gathering Skill Tree**). When Skill Tree is inactive, the module still sets up other content and waits to create or link the tree until it becomes active.
- **Rare finds:** any-tier rare tables that point at deleted tables are cleared. If no profession has tier tables, the 60 default rare finds and 20 tables are built (folders **Rare Finds**).

**Module Settings → Gathering Professions → Gathering Content** runs the check again. From a macro: `api.content.ensure({ force: true })`.

## Verification

Run `node Data/modules/gathering-professions/tests/gatherer-check.mjs` from the Foundry data workspace. It runs `tests/gathering.mjs`, the sample-world smoke test `tests/world.mjs` (an in-memory sample world built by `tests/fixtures/sampleworld.js`; automated tests only, never loaded in Foundry), `tests/conditions.mjs`, `tests/perks.mjs`, and `tests/rarefinds.mjs` (universal tree: perk validation, totals, check math, rest uses, odds, layout, sensing, Assist). The isolated tests cover every extraction boundary, Stone `1d4`, `1d2`, fixed `1`, compound formulas, missing Base Yield, Rank 1, higher ranks, another profession, existing stacks, rapid clicks, duplicate completion, zero XP on failed/partial extraction, chat fields, automatic and explicit editor saves, switching advancement modes, preserving current ranks, XP crossing a threshold without promotion, GM promotion, and the resulting profession die and DC reduction. The Roll double rejects synchronous evaluation and checks all async/maximize calls. These tests do not touch a world or replace an in-world Foundry smoke test.

Version 0.5.0 adds tests for custom professions and their validation, the profession editor form, Skill Tree points (Rank 1, rank-up, catch-up, milestone promotion, no double grants, no removal, module inactive), rank mirroring, perk yield on full successes only, the d100 rare-find hit and miss, Masterful rare draws with the setting on and off, material table overrides, missing-table errors, and the perk editor.

The tests also cover banked untrained XP, rank 0 despite old progress, stacked tier/material penalties, trained checks ignoring those penalties, player one-time choice, ownership, GM change/reset, progress preservation, and left-side shortcut routing.

For an in-world check after reloading: select a character token, open the left-side hammer menu, and choose Mining. Edit Stone's Base Yield to `1d4`, save, use the existing Stone node, and compare the displayed margin/category/quantity with the table above. Check inventory and Mining XP before and after; repeated successes should increase the existing Stone stack. Set a tier and material extra, then use a character with another profession to verify an untrained roll has no profession die, adds both extras, and banks XP without granting a Mining rank.
