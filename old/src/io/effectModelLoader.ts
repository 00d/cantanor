/**
 * Load and query Phase 2.5 tactical effect model artifacts.
 * Mirrors engine/io/effect_model_loader.py
 *
 * In the browser this fetches JSON via fetch() or uses bundled data.
 * The default path is the compiled effect models artifact.
 */

const DEFAULT_EFFECT_MODEL_PATH = "data/rules/effect_models.json";

// Module-level cache
const modelCache = new Map<string, Record<string, unknown>>();

export async function loadEffectModel(
  path = DEFAULT_EFFECT_MODEL_PATH,
): Promise<Record<string, unknown>> {
  if (modelCache.has(path)) {
    return modelCache.get(path)!;
  }
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load effect model from ${path}: ${response.statusText}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  modelCache.set(path, data);
  return data;
}

// Synchronous variant for use in reducer (requires pre-loading)
let _preloadedModel: Record<string, unknown> | null = null;

export function setPreloadedEffectModel(model: Record<string, unknown>): void {
  _preloadedModel = model;
}

export function lookupHazardSource(
  hazardId: string,
  sourceName: string,
  sourceType = "trigger_action",
  modelPath?: string,
): Record<string, unknown> {
  const model = _preloadedModel;
  if (!model) {
    throw new Error(
      `Effect model not preloaded. Call loadEffectModel() and setPreloadedEffectModel() first. path=${modelPath ?? DEFAULT_EFFECT_MODEL_PATH}`,
    );
  }
  const hazards = model["hazards"] as Record<string, unknown> | undefined;
  const entries =
    (hazards?.["entries"] as Array<Record<string, unknown>>) ?? [];

  for (const hazard of entries) {
    if (hazard["hazard_id"] !== hazardId) continue;
    const sources =
      (hazard["sources"] as Array<Record<string, unknown>>) ?? [];
    for (const source of sources) {
      if (source["source_type"] === sourceType && source["source_name"] === sourceName) {
        return {
          hazard_id: hazardId,
          hazard_name: hazard["hazard_name"],
          source_type: sourceType,
          source_name: sourceName,
          effects: source["effects"] ?? [],
          raw_text: source["raw_text"],
        };
      }
    }
  }
  throw new Error(
    `hazard source not found: hazard_id=${hazardId} source_type=${sourceType} source_name=${sourceName}`,
  );
}
