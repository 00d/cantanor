/**
 * Regression test suite for all engine phases.
 * Tests determinism and validates against TypeScript-specific baselines.
 *
 * Note: TypeScript uses Mulberry32 RNG, Python uses MT19937. Hashes differ
 * between languages but are deterministic within each language.
 */

import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { runScenarioTest, assertNoCommandErrors } from "../test-utils/scenarioTestRunner";

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

async function testPhaseRegression(config: PhaseConfig): Promise<void> {
  const { dir } = config;

  const scenarioFiles = readdirSync(dir)
    .filter((f) => f.match(/^\d{2}_.*\.json$/))
    .sort();

  expect(scenarioFiles.length).toBeGreaterThanOrEqual(1);

  // Load expected hashes
  const expectedHashPath = join(dir, "expected_hashes_ts.json");
  const expectedHashContent = readFileSync(expectedHashPath, "utf-8");
  const expectedHashes: Record<string, string> = JSON.parse(expectedHashContent);

  for (const filename of scenarioFiles) {
    const scenarioPath = join(dir, filename);

    // Run twice to verify determinism
    const result1 = await runScenarioTest(scenarioPath);
    const result2 = await runScenarioTest(scenarioPath);

    // Determinism within TypeScript
    expect(result1.replayHash).toBe(result2.replayHash);

    // No command errors
    assertNoCommandErrors(result1.events);

    // Match TypeScript baseline
    const expectedHash = expectedHashes[filename];
    if (expectedHash === "ERROR") {
      throw new Error(`Scenario ${filename} has ERROR baseline - needs regeneration`);
    }

    expect(result1.replayHash).toBe(expectedHash);
  }
}

describe("Phase 3.5 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[0]);
    },
    60000,
  );
});

describe("Phase 4 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[1]);
    },
    60000,
  );
});

describe("Phase 5 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[2]);
    },
    60000,
  );
});

describe("Phase 6 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[3]);
    },
    60000,
  );
});

describe("Phase 7 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[4]);
    },
    60000,
  );
});

describe("Phase 8 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[5]);
    },
    60000,
  );
});

describe("Phase 9 Regression Matrix", () => {
  test(
    "all scenarios deterministic and error-free",
    async () => {
      await testPhaseRegression(PHASES[6]);
    },
    60000,
  );
});
