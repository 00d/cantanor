/**
 * Campaign save/load — localStorage with version gating.
 */

import type { CampaignDefinition, CampaignProgress } from "./campaignTypes";

const CAMPAIGN_SAVE_KEY = "cantanor_campaign_save";
const CAMPAIGN_SAVE_VERSION = 1;

interface CampaignSave {
  version: number;
  definition: CampaignDefinition;
  progress: CampaignProgress;
}

export function writeCampaignSave(
  definition: CampaignDefinition,
  progress: CampaignProgress,
): void {
  try {
    const save: CampaignSave = {
      version: CAMPAIGN_SAVE_VERSION,
      definition,
      progress,
    };
    localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("Campaign save failed:", err);
  }
}

export function readCampaignSave(): { definition: CampaignDefinition; progress: CampaignProgress } | null {
  try {
    const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CampaignSave;
    if (parsed.version !== CAMPAIGN_SAVE_VERSION) return null;
    if (!parsed.definition || !parsed.progress) return null;
    return { definition: parsed.definition, progress: parsed.progress };
  } catch {
    return null;
  }
}

export function clearCampaignSave(): void {
  try {
    localStorage.removeItem(CAMPAIGN_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasCampaignSave(): boolean {
  try {
    return localStorage.getItem(CAMPAIGN_SAVE_KEY) !== null;
  } catch {
    return false;
  }
}
