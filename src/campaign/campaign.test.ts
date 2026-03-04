/**
 * Tests for campaign module — loader, state, persistence.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { parseCampaignDefinition, CampaignValidationError } from "./campaignLoader";
import { snapshotParty, applyPartySnapshot, healPartyAtCamp, resetAbilitiesForBattle } from "./campaignState";
import { writeCampaignSave, readCampaignSave, clearCampaignSave } from "./campaignPersistence";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import type { CampaignDefinition, CampaignProgress } from "./campaignTypes";

// ---------------------------------------------------------------------------
// Campaign Loader
// ---------------------------------------------------------------------------

describe("parseCampaignDefinition", () => {
  const validCampaign = {
    campaignId: "test_campaign",
    name: "Test Campaign",
    description: "A test campaign",
    stages: [
      {
        stageId: "stage_1",
        name: "Stage 1",
        description: "First stage",
        scenarioUrl: "/scenarios/smoke/interactive_arena.json",
        briefing: "Welcome",
      },
      {
        stageId: "stage_2",
        name: "Stage 2",
        description: "Second stage",
        scenarioUrl: "/scenarios/smoke/hidden_pit_basic.json",
      },
    ],
  };

  test("parses valid campaign definition", () => {
    const def = parseCampaignDefinition(validCampaign);
    expect(def.campaignId).toBe("test_campaign");
    expect(def.name).toBe("Test Campaign");
    expect(def.stages).toHaveLength(2);
    expect(def.stages[0].briefing).toBe("Welcome");
    expect(def.stages[1].briefing).toBeUndefined();
  });

  test("rejects missing campaignId", () => {
    const invalid = { ...validCampaign, campaignId: "" };
    expect(() => parseCampaignDefinition(invalid)).toThrow(CampaignValidationError);
  });

  test("rejects empty stages", () => {
    const invalid = { ...validCampaign, stages: [] };
    expect(() => parseCampaignDefinition(invalid)).toThrow(CampaignValidationError);
  });

  test("rejects duplicate stageId", () => {
    const invalid = {
      ...validCampaign,
      stages: [
        { stageId: "dup", name: "A", description: "a", scenarioUrl: "/a" },
        { stageId: "dup", name: "B", description: "b", scenarioUrl: "/b" },
      ],
    };
    expect(() => parseCampaignDefinition(invalid)).toThrow("duplicate stageId");
  });
});

// ---------------------------------------------------------------------------
// Campaign State
// ---------------------------------------------------------------------------

describe("snapshotParty", () => {
  test("snapshots surviving PC units", () => {
    const battle = createTestBattle({
      units: {
        pc1: createTestUnit({ unitId: "pc1", team: "pc", hp: 15, maxHp: 20 }),
        pc2: createTestUnit({ unitId: "pc2", team: "pc", hp: 0, maxHp: 20 }),
        enemy1: createTestUnit({ unitId: "enemy1", team: "enemy", hp: 10, maxHp: 10 }),
      },
    });
    const snaps = snapshotParty(battle);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].unitId).toBe("pc1");
    expect(snaps[0].hp).toBe(15);
  });

  test("captures persistent conditions only", () => {
    const battle = createTestBattle({
      units: {
        pc1: createTestUnit({
          unitId: "pc1", team: "pc", hp: 10, maxHp: 20,
          conditions: { drained: 2, frightened: 1, doomed: 1 },
        }),
      },
    });
    const snaps = snapshotParty(battle);
    expect(snaps[0].persistentConditions).toEqual({ drained: 2, doomed: 1 });
  });

  test("captures weaponAmmo in snapshot", () => {
    const battle = createTestBattle({
      units: {
        pc1: createTestUnit({
          unitId: "pc1", team: "pc", hp: 20, maxHp: 20,
          weapons: [{ name: "crossbow", type: "ranged" as const, attackMod: 5, damage: "1d8", damageType: "piercing", ammo: 1, reload: 1 }],
          weaponAmmo: { 0: 0 },
        }),
      },
    });
    const snaps = snapshotParty(battle);
    expect(snaps[0].weaponAmmo).toEqual({ 0: 0 });
  });
});

describe("applyPartySnapshot", () => {
  test("merges HP and conditions from snapshot", () => {
    const units = {
      pc1: createTestUnit({ unitId: "pc1", team: "pc", hp: 20, maxHp: 20 }),
    };
    const result = applyPartySnapshot(units, [{
      unitId: "pc1",
      hp: 12,
      maxHp: 20,
      abilitiesRemaining: { "spell.fireball": 0 },
      persistentConditions: { drained: 1 },
    }]);
    expect(result["pc1"].hp).toBe(12);
    expect(result["pc1"].conditions).toEqual({ drained: 1 });
    expect(result["pc1"].abilitiesRemaining).toEqual({ "spell.fireball": 0 });
  });

  test("restores weaponAmmo from snapshot", () => {
    const units = {
      pc1: createTestUnit({
        unitId: "pc1", team: "pc", hp: 20, maxHp: 20,
        weapons: [{ name: "crossbow", type: "ranged" as const, attackMod: 5, damage: "1d8", damageType: "piercing", ammo: 1, reload: 1 }],
        weaponAmmo: { 0: 1 },
      }),
    };
    const result = applyPartySnapshot(units, [{
      unitId: "pc1", hp: 15, maxHp: 20,
      abilitiesRemaining: {}, persistentConditions: {},
      weaponAmmo: { 0: 0 },
    }]);
    expect(result["pc1"].weaponAmmo).toEqual({ 0: 0 });
  });

  test("caps HP at unit maxHp", () => {
    const units = {
      pc1: createTestUnit({ unitId: "pc1", team: "pc", hp: 20, maxHp: 15 }),
    };
    const result = applyPartySnapshot(units, [{
      unitId: "pc1", hp: 20, maxHp: 20,
      abilitiesRemaining: {}, persistentConditions: {},
    }]);
    expect(result["pc1"].hp).toBe(15);
  });
});

describe("healPartyAtCamp", () => {
  test("restores HP and clears conditions", () => {
    const snaps = healPartyAtCamp([{
      unitId: "pc1", hp: 5, maxHp: 20,
      abilitiesRemaining: { "spell.fireball": 0 },
      persistentConditions: { drained: 2 },
    }]);
    expect(snaps[0].hp).toBe(20);
    expect(snaps[0].persistentConditions).toEqual({});
    // abilitiesRemaining preserved (reset happens at battle start)
    expect(snaps[0].abilitiesRemaining).toEqual({ "spell.fireball": 0 });
  });
});

describe("resetAbilitiesForBattle", () => {
  test("resets spells/feats but preserves consumed items", () => {
    const remaining = { "spell.fireball": 0, "feat.power_attack": 1, "item.potion": 0 };
    const defaults = { "spell.fireball": 2, "feat.power_attack": 3, "item.potion": 1 };
    const result = resetAbilitiesForBattle(remaining, defaults);
    expect(result["spell.fireball"]).toBe(2);
    expect(result["feat.power_attack"]).toBe(3);
    expect(result["item.potion"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Campaign Persistence
// ---------------------------------------------------------------------------

describe("Campaign Persistence", () => {
  beforeEach(() => {
    clearCampaignSave();
  });

  test("round-trip save and load", () => {
    const definition: CampaignDefinition = {
      campaignId: "test",
      name: "Test",
      description: "",
      stages: [{
        stageId: "s1",
        name: "Stage 1",
        description: "",
        scenarioUrl: "/test.json",
      }],
    };
    const progress: CampaignProgress = {
      campaignId: "test",
      currentStageIndex: 0,
      completedStages: [],
      partyState: [],
    };

    writeCampaignSave(definition, progress);
    const loaded = readCampaignSave();
    expect(loaded).not.toBeNull();
    expect(loaded!.definition.campaignId).toBe("test");
    expect(loaded!.progress.currentStageIndex).toBe(0);
  });

  test("returns null when no save exists", () => {
    expect(readCampaignSave()).toBeNull();
  });

  test("clearCampaignSave removes save", () => {
    const definition: CampaignDefinition = {
      campaignId: "test",
      name: "Test",
      description: "",
      stages: [{
        stageId: "s1",
        name: "Stage 1",
        description: "",
        scenarioUrl: "/test.json",
      }],
    };
    writeCampaignSave(definition, {
      campaignId: "test",
      currentStageIndex: 0,
      completedStages: [],
      partyState: [],
    });
    clearCampaignSave();
    expect(readCampaignSave()).toBeNull();
  });
});
