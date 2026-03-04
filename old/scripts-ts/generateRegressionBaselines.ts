/**
 * Generate TypeScript-specific regression baselines for all phases.
 *
 * This script generates fresh replay hashes for TypeScript using Mulberry32 RNG.
 * These hashes will differ from Python hashes (which use MT19937) but will be
 * deterministic within TypeScript.
 *
 * Usage: npx tsx scripts-ts/generateRegressionBaselines.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { runScenarioTest } from "../src/test-utils/scenarioTestRunner";

interface PhaseConfig {
  phase: string;
  dir: string;
}

const PHASES: PhaseConfig[] = [
  { phase: "3.5", dir: "scenarios/regression_phase35" },
  { phase: "4", dir: "scenarios/regression_phase4" },
  { phase: "5", dir: "scenarios/regression_phase5" },
  { phase: "6", dir: "scenarios/regression_phase6" },
  { phase: "7", dir: "scenarios/regression_phase7" },
  { phase: "8", dir: "scenarios/regression_phase8" },
  { phase: "9", dir: "scenarios/regression_phase9" },
];

async function generateBaselinesForPhase(config: PhaseConfig): Promise<void> {
  const { phase, dir } = config;

  if (!existsSync(dir)) {
    console.log(`⊗ Phase ${phase}: directory not found: ${dir}`);
    return;
  }

  console.log(`\n=== Phase ${phase} ===`);
  const files = readdirSync(dir)
    .filter((f) => f.match(/^\d{2}_.*\.json$/))
    .sort();

  if (files.length === 0) {
    console.log(`  No scenario files found`);
    return;
  }

  const hashes: Record<string, string> = {};

  for (const file of files) {
    const scenarioPath = join(dir, file);
    try {
      const result = await runScenarioTest(scenarioPath);
      hashes[file] = result.replayHash;
      console.log(`  ✓ ${file}: ${result.replayHash.substring(0, 16)}...`);
    } catch (error) {
      console.error(`  ✗ ${file}: ${error}`);
      hashes[file] = "ERROR";
    }
  }

  // Write TypeScript-specific hashes
  const outputPath = join(dir, "expected_hashes_ts.json");
  writeFileSync(outputPath, JSON.stringify(hashes, null, 2) + "\n");
  console.log(`  → Wrote ${outputPath}`);
}

async function main(): Promise<void> {
  console.log("Generating TypeScript regression baselines...");
  console.log("=".repeat(60));

  for (const phaseConfig of PHASES) {
    await generateBaselinesForPhase(phaseConfig);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✓ Baseline generation complete!");
  console.log("\nNote: These hashes are TypeScript-specific (Mulberry32 RNG).");
  console.log("Python hashes (MT19937) remain in expected_hashes.json for reference.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
