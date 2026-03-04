/**
 * Tests for scenario validation.
 * Ported from tests/contract/test_scenario_validation.py
 *
 * These tests validate:
 * - Scenario structure validation
 * - Command validation (including spawn forward references)
 * - Mission event validation
 * - Content pack field validation
 * - Engine phase validation
 */

import { describe, test, expect } from "vitest";
import { validateScenario, ScenarioValidationError } from "./scenarioLoader";

function baseScenario(): Record<string, unknown> {
  return {
    battle_id: "scenario_validation_contracts",
    seed: 123,
    map: { width: 6, height: 6, blocked: [] },
    units: [
      {
        id: "hazard_core",
        team: "hazard",
        hp: 30,
        position: [2, 2],
        initiative: 20,
        attack_mod: 0,
        ac: 10,
        damage: "1d1",
      },
      {
        id: "pc",
        team: "pc",
        hp: 30,
        position: [3, 2],
        initiative: 10,
        attack_mod: 7,
        ac: 17,
        damage: "1d8+3",
      },
    ],
    commands: [],
  };
}

describe("Scenario Structure Validation", () => {
  test("accepts valid scenario", () => {
    const scenario = baseScenario();
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  test("rejects missing battle_id", () => {
    const scenario = baseScenario();
    delete scenario["battle_id"];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects missing seed", () => {
    const scenario = baseScenario();
    delete scenario["seed"];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects missing map", () => {
    const scenario = baseScenario();
    delete scenario["map"];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects missing units", () => {
    const scenario = baseScenario();
    delete scenario["units"];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects missing commands", () => {
    const scenario = baseScenario();
    delete scenario["commands"];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects non-positive map width", () => {
    const scenario = baseScenario();
    (scenario["map"] as Record<string, unknown>)["width"] = 0;
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects non-positive map height", () => {
    const scenario = baseScenario();
    (scenario["map"] as Record<string, unknown>)["height"] = -1;
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects empty units list", () => {
    const scenario = baseScenario();
    scenario["units"] = [];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects duplicate unit ids", () => {
    const scenario = baseScenario();
    (scenario["units"] as Array<unknown>).push({
      id: "pc", // Duplicate
      team: "pc",
      hp: 20,
      position: [4, 4],
      initiative: 5,
      attack_mod: 5,
      ac: 15,
      damage: "1d6",
    });
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
    expect(() => validateScenario(scenario)).toThrow(/duplicate unit id/);
  });
});

describe("Command Validation", () => {
  test("spawned actor can be referenced later", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "spawn_unit",
        actor: "hazard_core",
        unit: {
          id: "hazard_add",
          team: "hazard",
          hp: 12,
          position: [1, 1],
          initiative: 8,
          attack_mod: 4,
          ac: 14,
          damage: "1d6+1",
        },
      },
      { type: "end_turn", actor: "hazard_add" }, // Forward reference
    ];
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  test("rejects unknown command type", () => {
    const scenario = baseScenario();
    scenario["commands"] = [{ type: "teleport_party", actor: "hazard_core" }];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects missing variant fields", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "area_save_damage",
        actor: "hazard_core",
        center_x: 2,
        center_y: 2,
        // Missing: radius, dc, save_type, damage, damage_type, mode
      },
    ];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects invalid damage_bypass shape (must be list)", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "save_damage",
        actor: "hazard_core",
        target: "pc",
        dc: 20,
        save_type: "Reflex",
        damage: "10",
        damage_type: "fire",
        damage_bypass: "fire", // Should be list, not string
        mode: "basic",
      },
    ];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
    expect(() => validateScenario(scenario)).toThrow(/bypass.*must be list/i);
  });

  test("accepts phase6 command variants", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "cast_spell",
        actor: "hazard_core",
        spell_id: "spark_bolt",
        target: "pc",
        dc: 19,
        save_type: "Reflex",
        damage: "2d6",
        mode: "basic",
      },
      {
        type: "use_feat",
        actor: "hazard_core",
        feat_id: "adrenaline_rush",
        target: "hazard_core",
        effect_kind: "temp_hp",
        payload: { amount: 4 },
      },
      {
        type: "use_item",
        actor: "hazard_core",
        item_id: "bottled_focus",
        target: "hazard_core",
        effect_kind: "condition",
        payload: { name: "frightened", value: 1 },
        duration_rounds: 1,
        tick_timing: "turn_end",
      },
    ];
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  test("rejects interact without interact_id", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "interact",
        actor: "hazard_core",
        target: "hazard_core",
        // Missing: interact_id
      },
    ];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("accepts content_entry_id cast_spell compact shape", () => {
    const scenario = baseScenario();
    scenario["commands"] = [
      {
        type: "cast_spell",
        actor: "hazard_core",
        content_entry_id: "spell.arc_flash",
        target: "pc",
        dc: 20,
      },
    ];
    expect(() => validateScenario(scenario)).not.toThrow();
  });
});

describe("Mission Event Validation", () => {
  test("rejects unit_dead trigger with unknown unit", () => {
    const scenario = baseScenario();
    scenario["mission_events"] = [
      {
        id: "bad_dead_trigger",
        trigger: "unit_dead",
        unit_id: "missing_unit", // Unknown unit
        commands: [{ type: "set_flag", flag: "x", value: true }],
      },
    ];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  test("rejects flag_set trigger without flag name", () => {
    const scenario = baseScenario();
    scenario["mission_events"] = [
      {
        id: "bad_flag_trigger",
        trigger: "flag_set",
        // Missing: flag, value
        commands: [{ type: "set_flag", flag: "x", value: true }],
      },
    ];
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });
});

describe("Content Pack Field Validation", () => {
  test("accepts content_pack scenario fields", () => {
    const scenario = baseScenario();
    scenario["content_packs"] = ["corpus/content_packs/phase7_baseline_v1.json"];
    scenario["content_pack_id"] = "phase7-baseline-v1";
    scenario["required_content_features"] = ["content_pack_loader"];
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  test("rejects content_pack_id without packs", () => {
    const scenario = baseScenario();
    scenario["content_pack_id"] = "phase7-baseline-v1";
    // Missing: content_packs list
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
    expect(() => validateScenario(scenario)).toThrow(/requires non-empty content_packs/);
  });

  test("rejects empty content_packs list with content_pack_id", () => {
    const scenario = baseScenario();
    scenario["content_packs"] = [];
    scenario["content_pack_id"] = "phase7-baseline-v1";
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });
});

describe("Engine Phase Validation", () => {
  test("accepts positive engine_phase", () => {
    const scenario = baseScenario();
    scenario["engine_phase"] = 7;
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  test("rejects non-positive engine_phase", () => {
    const scenario = baseScenario();
    scenario["engine_phase"] = 0;
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
    expect(() => validateScenario(scenario)).toThrow(/positive int/);
  });

  test("rejects negative engine_phase", () => {
    const scenario = baseScenario();
    scenario["engine_phase"] = -1;
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });
});
