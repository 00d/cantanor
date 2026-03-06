/**
 * Determinism validator — runs every smoke scenario twice and verifies:
 *   1. Identical replayHash on both runs (RNG seeding is correct, reducer
 *      is pure, no wall-clock or Map-iteration-order leaks)
 *   2. No command_error events (every scripted action is legal)
 *
 * Run with: npm run validate:determinism
 *
 * This is NOT a replacement for the regression hash suite — it doesn't pin
 * hashes to baselines. It's a fast "nothing is obviously broken" check
 * suitable for CI gating or a pre-commit hook. The regression suite
 * (regenerate-hashes.ts + regression.test.ts) catches *changes*; this
 * catches *nondeterminism* even for scenarios with no baseline.
 */

import { readdirSync } from "fs";
import { join } from "path";
import { runScenarioTest, assertNoCommandErrors } from "../src/test-utils/scenarioTestRunner";

const SMOKE_DIR = "public/scenarios/smoke";

interface ScenarioOutcome {
  name: string;
  status: "pass" | "fail";
  error?: string;
  hash: string;
}

async function validateOne(path: string): Promise<Omit<ScenarioOutcome, "name">> {
  try {
    // Two runs from cold start. Any source of nondeterminism shows up as
    // a hash mismatch — stray Date.now(), Math.random(), object-key order
    // differences, module-level state that survives across runs.
    const r1 = await runScenarioTest(path);
    const r2 = await runScenarioTest(path);

    if (r1.replayHash !== r2.replayHash) {
      return {
        status: "fail",
        error: `Non-deterministic: ${r1.replayHash.slice(0, 12)} ≠ ${r2.replayHash.slice(0, 12)}`,
        hash: r1.replayHash,
      };
    }

    // assertNoCommandErrors throws with a message listing the errors.
    // Run it AFTER the determinism check so a command error in a
    // deterministic scenario reports as a command error, not as
    // "non-deterministic" (which would be misleading — both runs produce
    // the same error event, so the hashes match).
    assertNoCommandErrors(r1.events);

    return { status: "pass", hash: r1.replayHash };
  } catch (err) {
    return {
      status: "fail",
      error: err instanceof Error ? err.message : String(err),
      hash: "",
    };
  }
}

async function main() {
  const files = readdirSync(SMOKE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`validating ${files.length} smoke scenarios\n`);

  const outcomes: ScenarioOutcome[] = [];
  for (const [i, f] of files.entries()) {
    process.stdout.write(`[${String(i + 1).padStart(2)}/${files.length}] ${f.padEnd(40)} `);
    const r = await validateOne(join(SMOKE_DIR, f));
    outcomes.push({ name: f, ...r });
    if (r.status === "pass") {
      console.log(`ok  ${r.hash.slice(0, 12)}`);
    } else {
      console.log(`FAIL`);
      console.log(`       ${r.error}`);
    }
  }

  const failed = outcomes.filter((o) => o.status === "fail");
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed`);

  if (failed.length > 0) {
    console.log(`\nfailures:`);
    for (const f of failed) console.log(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
