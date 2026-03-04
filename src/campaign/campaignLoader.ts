/**
 * Campaign definition loader — parses and validates campaign JSON.
 */

import type { CampaignDefinition, CampaignStage } from "./campaignTypes";

export class CampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignValidationError";
  }
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new CampaignValidationError(message);
}

export function parseCampaignDefinition(data: Record<string, unknown>): CampaignDefinition {
  require(typeof data === "object" && data !== null, "campaign must be object");
  require(typeof data["campaignId"] === "string" && Boolean(data["campaignId"]), "campaignId must be non-empty string");
  require(typeof data["name"] === "string" && Boolean(data["name"]), "name must be non-empty string");
  require(typeof data["description"] === "string", "description must be string");

  const stages = data["stages"];
  require(Array.isArray(stages) && (stages as unknown[]).length > 0, "stages must be a non-empty array");

  const parsedStages: CampaignStage[] = (stages as Record<string, unknown>[]).map((s, idx) => {
    require(typeof s === "object" && s !== null, `stages[${idx}] must be object`);
    require(typeof s["stageId"] === "string" && Boolean(s["stageId"]), `stages[${idx}].stageId must be non-empty string`);
    require(typeof s["name"] === "string" && Boolean(s["name"]), `stages[${idx}].name must be non-empty string`);
    require(typeof s["description"] === "string", `stages[${idx}].description must be string`);
    require(typeof s["scenarioUrl"] === "string" && Boolean(s["scenarioUrl"]), `stages[${idx}].scenarioUrl must be non-empty string`);
    return {
      stageId: String(s["stageId"]),
      name: String(s["name"]),
      description: String(s["description"]),
      scenarioUrl: String(s["scenarioUrl"]),
      ...(typeof s["briefing"] === "string" && { briefing: s["briefing"] as string }),
      ...(typeof s["debriefing"] === "string" && { debriefing: s["debriefing"] as string }),
    };
  });

  // Check for duplicate stage ids
  const ids = new Set<string>();
  for (const stage of parsedStages) {
    require(!ids.has(stage.stageId), `duplicate stageId: ${stage.stageId}`);
    ids.add(stage.stageId);
  }

  return {
    campaignId: String(data["campaignId"]),
    name: String(data["name"]),
    description: String(data["description"] ?? ""),
    stages: parsedStages,
  };
}

/**
 * Fetches and parses a campaign definition from a URL.
 */
export async function loadCampaignFromUrl(url: string): Promise<CampaignDefinition> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load campaign: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as Record<string, unknown>;
  return parseCampaignDefinition(data);
}
