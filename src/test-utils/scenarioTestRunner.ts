/**
 * Scenario test runner utilities for TypeScript tests.
 * Mirrors Python test patterns from tests/scenarios/
 */

import { runScenario, ScenarioResult } from "../engine/scenarioRunner";
import { battleStateFromScenario, validateScenario } from "../io/scenarioLoader";
import { ContentContext } from "../io/contentPackLoader";
import { setPreloadedEffectModel } from "../io/effectModelLoader";
import { readFile } from "fs/promises";
import { resolve, isAbsolute } from "path";

// Preload effect model once at module load time
const effectModelPath = resolve(process.cwd(), "compiled/tactical_effect_models_v1.json");
readFile(effectModelPath, "utf-8")
  .then((data) => {
    const model = JSON.parse(data);
    setPreloadedEffectModel(model);
  })
  .catch(() => {
    // Effect model not available, some tests may fail
  });

// Re-export ScenarioResult and related utilities for tests
export type { ScenarioResult };

/**
 * Run a scenario from a JSON file path and return results.
 * @param scenarioPath - Absolute or relative path to scenario JSON file
 * @returns Promise resolving to scenario execution results
 */
export async function runScenarioTest(scenarioPath: string): Promise<ScenarioResult> {
  // Resolve path
  const absolutePath = isAbsolute(scenarioPath) ? scenarioPath : resolve(process.cwd(), scenarioPath);

  // Load scenario JSON
  const scenarioJson = await readFile(absolutePath, "utf-8");
  const scenarioData = JSON.parse(scenarioJson) as Record<string, unknown>;

  // Validate scenario
  validateScenario(scenarioData);

  // Build battle state
  const battleState = battleStateFromScenario(scenarioData);

  // Create minimal content context (content packs will be loaded by runScenario if needed)
  const contentContext: ContentContext = {
    selectedPackId: null,
    packs: [],
    entryLookup: {},
  };

  // Run scenario
  const enginePhase = (scenarioData["engine_phase"] as number) ?? 7;
  const result = await runScenario(scenarioData, battleState, contentContext, enginePhase);

  // Return result directly
  return result;
}

/**
 * Assert that no command errors occurred during scenario execution.
 * Throws if any command_error events are found.
 * @param events - Array of events from scenario execution
 */
export function assertNoCommandErrors(events: Record<string, unknown>[]): void {
  const errorEvents = events.filter((e) => e["type"] === "command_error");
  if (errorEvents.length > 0) {
    const errorMessages = errorEvents.map((e) => {
      const payload = e["payload"] as Record<string, unknown>;
      return payload["error"] ?? "Unknown error";
    });
    throw new Error(`Command errors found: ${errorMessages.join(", ")}`);
  }
}

/**
 * Filter events by type.
 * @param events - Array of events
 * @param type - Event type to filter by
 * @returns Array of events matching the type
 */
export function getEventsByType(
  events: Record<string, unknown>[],
  type: string,
): Record<string, unknown>[] {
  return events.filter((e) => e["type"] === type);
}
