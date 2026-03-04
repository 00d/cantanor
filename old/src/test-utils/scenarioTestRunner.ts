/**
 * Scenario test runner utilities for TypeScript tests.
 * Mirrors Python test patterns from tests/scenarios/
 */

import { runScenario, ScenarioResult } from "../engine/scenarioRunner";
import { battleStateFromScenario, validateScenario } from "../io/scenarioLoader";
import { ContentContext, resolveContentContextSync } from "../io/contentPackLoader";
import { setPreloadedEffectModel } from "../io/effectModelLoader";
import { readFile } from "fs/promises";
import { resolve, isAbsolute } from "path";

// Preload effect model — stored as a promise so runScenarioTest can await it.
// Fire-and-forget caused a race where the first scenario ran before the model
// was loaded, producing a different hash than subsequent runs.
const effectModelPath = resolve(process.cwd(), "data/rules/effect_models.json");
const _effectModelReady: Promise<void> = readFile(effectModelPath, "utf-8")
  .then((data) => setPreloadedEffectModel(JSON.parse(data)))
  .catch(() => { /* model not available — hazard tests will fail loudly */ });

// Re-export ScenarioResult and related utilities for tests
export type { ScenarioResult };

/**
 * Run a scenario from a JSON file path and return results.
 * @param scenarioPath - Absolute or relative path to scenario JSON file
 * @returns Promise resolving to scenario execution results
 */
export async function runScenarioTest(scenarioPath: string): Promise<ScenarioResult> {
  await _effectModelReady;
  const absolutePath = isAbsolute(scenarioPath) ? scenarioPath : resolve(process.cwd(), scenarioPath);

  // Load scenario JSON
  const scenarioJson = await readFile(absolutePath, "utf-8");
  const scenarioData = JSON.parse(scenarioJson) as Record<string, unknown>;

  // Validate scenario
  validateScenario(scenarioData);

  // Build battle state
  const battleState = battleStateFromScenario(scenarioData);

  // Load content packs from scenario (relative to scenario directory)
  const enginePhase = (scenarioData["engine_phase"] as number) ?? 7;
  const scenarioDir = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
  const contentContext = await loadContentPacksForScenario(scenarioData, enginePhase, scenarioDir);

  // Run scenario
  const result = await runScenario(scenarioData, battleState, contentContext, enginePhase);

  // Return result directly
  return result;
}

/**
 * Load content packs specified in scenario JSON.
 * @param scenarioData - Parsed scenario JSON
 * @param enginePhase - Engine phase number
 * @param scenarioDir - Directory containing the scenario file (for resolving relative paths)
 * @returns Content context with loaded packs and entry lookup
 */
async function loadContentPacksForScenario(
  scenarioData: Record<string, unknown>,
  enginePhase: number,
  scenarioDir: string,
): Promise<ContentContext> {
  const contentPackPaths = (scenarioData["content_packs"] as string[]) ?? [];

  if (contentPackPaths.length === 0) {
    return {
      selectedPackId: null,
      packs: [],
      entryLookup: {},
    };
  }

  // Load all content pack JSON files
  const packDataList: Record<string, unknown>[] = [];
  for (const packPath of contentPackPaths) {
    // URL-style paths (starting with /) are served from public/ in the browser.
    // Map them to public/<path> for Node test resolution.
    const absolutePackPath = packPath.startsWith("/")
      ? resolve(process.cwd(), "public", packPath.slice(1))
      : isAbsolute(packPath) ? packPath : resolve(scenarioDir, packPath);
    const packJson = await readFile(absolutePackPath, "utf-8");
    const packData = JSON.parse(packJson) as Record<string, unknown>;
    packDataList.push(packData);
  }

  // Use synchronous resolver with pre-loaded data
  return resolveContentContextSync(scenarioData, enginePhase, packDataList);
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
