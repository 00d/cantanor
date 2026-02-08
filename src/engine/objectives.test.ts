/**
 * Tests for objective evaluation.
 * Ported from tests/contract/test_objectives.py
 */

import { describe, test, expect } from "vitest";
import { evaluateObjectives } from "./objectives";
import { battleStateFromScenario } from "../io/scenarioLoader";

function createScenario() {
  return {
    battle_id: "objectives_contract",
    seed: 5150,
    map: { width: 6, height: 6, blocked: [] },
    units: [
      {
        id: "pc",
        team: "pc",
        hp: 20,
        position: [1, 1],
        initiative: 15,
        attack_mod: 6,
        ac: 16,
        damage: "1d8+3",
      },
      {
        id: "enemy",
        team: "enemy",
        hp: 20,
        position: [3, 3],
        initiative: 10,
        attack_mod: 5,
        ac: 15,
        damage: "1d6+2",
      },
    ],
    commands: [],
    flags: { gate_open: false },
  };
}

describe("Objectives", () => {
  test("victory and defeat objective evaluation", () => {
    const state = battleStateFromScenario(createScenario());

    const objectives = [
      { id: "open_gate", type: "flag_set", flag: "gate_open", value: true, result: "victory" },
      { id: "pc_dead", type: "unit_dead", unit_id: "pc", result: "defeat" },
    ];

    let res = evaluateObjectives(state, objectives);
    expect(res.victoryMet).toBe(false);
    expect(res.defeatMet).toBe(false);

    // Set flag to true
    state.flags["gate_open"] = true;
    res = evaluateObjectives(state, objectives);
    expect(res.victoryMet).toBe(true);
    expect(res.defeatMet).toBe(false);
  });

  test("round and team objectives", () => {
    const state = battleStateFromScenario(createScenario());

    const objectives = [
      { id: "survive_two", type: "round_at_least", round: 2, result: "victory" },
      { id: "enemies_down", type: "team_eliminated", team: "enemy", result: "victory" },
    ];

    let res = evaluateObjectives(state, objectives);
    expect(res.victoryMet).toBe(false);

    // Advance round and kill enemy
    state.roundNumber = 2;
    state.units["enemy"].hp = 0;

    res = evaluateObjectives(state, objectives);
    expect(res.victoryMet).toBe(true);
  });
});
