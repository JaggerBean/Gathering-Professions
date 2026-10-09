// Runs each isolated suite in its own Node process (they install different globals).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
for (const suite of ["migration.mjs", "gathering.mjs", "world.mjs", "conditions.mjs", "perks.mjs", "rarefinds.mjs", "review-checks.mjs"]) {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  console.log(output.trim().split("\n").filter(line => line.startsWith("PASS")).join("\n"));
}
