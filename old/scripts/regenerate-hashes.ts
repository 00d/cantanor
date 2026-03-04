/**
 * Regenerates expected_hashes_ts.json baselines for all regression phases.
 * Run with: npx tsx scripts/regenerate-hashes.ts
 *
 * Only run this after intentional engine changes that alter event payloads.
 * The script verifies determinism (runs each scenario twice) and no-errors
 * before writing a hash, so it won't silently record broken scenarios.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { runScenarioTest, assertNoCommandErrors } from "../src/test-utils/scenarioTestRunner";
import { setPreloadedEffectModel } from "../src/io/effectModelLoader";

// Ensure the effect model is preloaded before any scenario runs —
// scenarioTestRunner.ts preloads it via a fire-and-forget promise that
// can race against the first test when run outside vitest.
const effectModel = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/rules/effect_models.json"), "utf-8"),
);
setPreloadedEffectModel(effectModel);

const PHASES = [
  "scenarios/regression_phase35",
  "scenarios/regression_phase4",
  "scenarios/regression_phase5",
  "scenarios/regression_phase6",
  "scenarios/regression_phase7",
  "scenarios/regression_phase8",
  "scenarios/regression_phase9",
];

async function main() {
  for (const dir of PHASES) {
    const files = readdirSync(dir)
      .filter((f) => /^\d{2}_.*\.json$/.test(f))
      .sort();

    const hashes: Record<string, string> = {};
    for (const f of files) {
      const path = join(dir, f);
      const r1 = await runScenarioTest(path);
      const r2 = await runScenarioTest(path);
      if (r1.replayHash !== r2.replayHash) {
        throw new Error(`Non-deterministic: ${path}`);
      }
      assertNoCommandErrors(r1.events);
      hashes[f] = r1.replayHash;
      console.log(`  ${f}: ${r1.replayHash.slice(0, 12)}…`);
    }

    const outPath = join(dir, "expected_hashes_ts.json");
    const old = JSON.parse(readFileSync(outPath, "utf-8"));
    const changed = Object.keys(hashes).filter((k) => old[k] !== hashes[k]).length;
    writeFileSync(outPath, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`${dir}: ${changed}/${files.length} hashes updated\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
