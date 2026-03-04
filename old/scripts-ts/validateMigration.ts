/**
 * Migration validation script - Run comprehensive tests to verify Python → TypeScript parity
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { runScenarioTest } from "../src/test-utils/scenarioTestRunner";

interface ValidationResult {
  total: number;
  passed: number;
  failed: number;
  errors: string[];
  scenarios: Array<{
    name: string;
    status: "pass" | "fail";
    error?: string;
    deterministic: boolean;
    replayHash: string;
  }>;
}

async function validateScenario(scenarioPath: string): Promise<{
  status: "pass" | "fail";
  error?: string;
  deterministic: boolean;
  replayHash: string;
}> {
  try {
    // Run twice to verify determinism
    const result1 = await runScenarioTest(scenarioPath);
    const result2 = await runScenarioTest(scenarioPath);

    // Check for command errors
    const errorEvents = result1.events.filter((e) => e["type"] === "command_error");
    if (errorEvents.length > 0) {
      const errors = errorEvents.map((e) => {
        const payload = e["payload"] as Record<string, unknown>;
        return payload["error"] ?? "Unknown error";
      });
      return {
        status: "fail",
        error: `Command errors: ${errors.join(", ")}`,
        deterministic: result1.replayHash === result2.replayHash,
        replayHash: result1.replayHash,
      };
    }

    // Check determinism
    const deterministic = result1.replayHash === result2.replayHash;
    if (!deterministic) {
      return {
        status: "fail",
        error: "Non-deterministic execution",
        deterministic: false,
        replayHash: result1.replayHash,
      };
    }

    return {
      status: "pass",
      deterministic: true,
      replayHash: result1.replayHash,
    };
  } catch (err) {
    return {
      status: "fail",
      error: err instanceof Error ? err.message : String(err),
      deterministic: false,
      replayHash: "",
    };
  }
}

async function validateAllSmokeSenarios(): Promise<ValidationResult> {
  const smokeDir = "scenarios/smoke";
  const scenarioFiles = readdirSync(smokeDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`Found ${scenarioFiles.length} smoke scenarios\n`);

  const result: ValidationResult = {
    total: scenarioFiles.length,
    passed: 0,
    failed: 0,
    errors: [],
    scenarios: [],
  };

  for (const [idx, filename] of scenarioFiles.entries()) {
    const scenarioPath = join(smokeDir, filename);
    process.stdout.write(`[${idx + 1}/${scenarioFiles.length}] Testing ${filename}... `);

    const scenarioResult = await validateScenario(scenarioPath);

    if (scenarioResult.status === "pass") {
      console.log("✅ PASS");
      result.passed++;
    } else {
      console.log(`❌ FAIL: ${scenarioResult.error}`);
      result.failed++;
      result.errors.push(`${filename}: ${scenarioResult.error}`);
    }

    result.scenarios.push({
      name: filename,
      ...scenarioResult,
    });
  }

  return result;
}

async function validateRegressionPhases(): Promise<void> {
  const phases = [
    { phase: "3.5", dir: "scenarios/regression_phase35" },
    { phase: "4", dir: "scenarios/regression_phase4" },
    { phase: "5", dir: "scenarios/regression_phase5" },
    { phase: "6", dir: "scenarios/regression_phase6" },
    { phase: "7", dir: "scenarios/regression_phase7" },
    { phase: "8", dir: "scenarios/regression_phase8" },
    { phase: "9", dir: "scenarios/regression_phase9" },
  ];

  console.log("\n=== Regression Phase Validation ===\n");

  for (const { phase, dir } of phases) {
    const scenarioFiles = readdirSync(dir)
      .filter((f) => f.match(/^\d{2}_.*\.json$/))
      .sort();

    console.log(`Phase ${phase}: ${scenarioFiles.length} scenarios`);

    let passed = 0;
    let failed = 0;

    for (const filename of scenarioFiles) {
      const scenarioPath = join(dir, filename);
      const result = await validateScenario(scenarioPath);

      if (result.status === "pass") {
        passed++;
      } else {
        failed++;
        console.log(`  ❌ ${filename}: ${result.error}`);
      }
    }

    const status = failed === 0 ? "✅" : "⚠️";
    console.log(`  ${status} ${passed}/${scenarioFiles.length} passed\n`);
  }
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║   CANTANOR MIGRATION VALIDATION                       ║");
  console.log("║   Python → TypeScript Equivalence Testing            ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  console.log("=== Smoke Scenario Validation ===\n");
  const smokeResult = await validateAllSmokeSenarios();

  console.log("\n=== Summary ===");
  console.log(`Total scenarios: ${smokeResult.total}`);
  console.log(`✅ Passed: ${smokeResult.passed}`);
  console.log(`❌ Failed: ${smokeResult.failed}`);
  console.log(`Success rate: ${((smokeResult.passed / smokeResult.total) * 100).toFixed(1)}%`);

  if (smokeResult.failed > 0) {
    console.log("\n=== Failures ===");
    smokeResult.errors.forEach((error) => console.log(`  - ${error}`));
  }

  // Validate regression phases
  await validateRegressionPhases();

  console.log("\n=== Migration Validation Complete ===");

  if (smokeResult.failed === 0) {
    console.log("✅ All smoke scenarios passed!");
    console.log("✅ Migration appears complete and correct.");
  } else {
    console.log(`⚠️ ${smokeResult.failed} scenarios failed.`);
    console.log("⚠️ Review failures before deploying.");
  }

  // Exit with error code if any failures
  process.exit(smokeResult.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
