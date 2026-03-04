/**
 * Campaign data model — definitions, progress, and party snapshots.
 */

/** A single stage within a campaign (one battle). */
export interface CampaignStage {
  stageId: string;
  name: string;
  description: string;
  scenarioUrl: string;
  briefing?: string;
  debriefing?: string;
}

/** Static campaign definition loaded from JSON. */
export interface CampaignDefinition {
  campaignId: string;
  name: string;
  description: string;
  stages: CampaignStage[];
}

/** Snapshot of a single unit's persistent state between battles. */
export interface PartySnapshot {
  unitId: string;
  hp: number;
  maxHp: number;
  abilitiesRemaining: Record<string, number>;
  persistentConditions: Record<string, number>;
  /** Remaining ammo per weapon index — absent means infinite ammo for all weapons. */
  weaponAmmo?: Record<number, number>;
}

/** Tracks player progress through a campaign. */
export interface CampaignProgress {
  campaignId: string;
  currentStageIndex: number;
  completedStages: string[];
  partyState: PartySnapshot[];
}
