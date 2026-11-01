import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { requireProtection } from "../src/core/cost-policy";
requireProtection(
  JSON.parse(await readFile("config/billing-protection.json", "utf8")),
  new Date().toISOString(),
);
const response = spawnSync(
  process.platform === "win32" ? "forge.cmd" : "forge",
  ["register", "Kept"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (response.error) throw response.error;
process.exitCode = response.status ?? 1;
