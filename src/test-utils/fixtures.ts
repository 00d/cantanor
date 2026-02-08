/**
 * Test fixtures and factory functions for creating test data.
 * Mirrors Python test utility patterns.
 */

import { BattleState, UnitState, MapState, EffectState } from "../engine/state";
import { DeterministicRNG } from "../engine/rng";

/**
 * Create a test unit with sensible defaults.
 * Override any fields via the overrides parameter.
 */
export function createTestUnit(overrides: Partial<UnitState> = {}): UnitState {
  return {
    unitId: "test_unit",
    team: "player",
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    tempHp: 0,
    tempHpSource: null,
    tempHpOwnerEffectId: null,
    initiative: 10,
    attackMod: 5,
    ac: 15,
    damage: "1d6",
    attackDamageType: "physical",
    attackDamageBypass: [],
    fortitude: 5,
    reflex: 5,
    will: 5,
    actionsRemaining: 3,
    reactionAvailable: true,
    conditions: {},
    conditionImmunities: [],
    resistances: {},
    weaknesses: {},
    immunities: [],
    ...overrides,
  };
}

/**
 * Create a test battle state with sensible defaults.
 * Override any fields via the overrides parameter.
 */
export function createTestBattle(overrides: Partial<BattleState> = {}): BattleState {
  const units = overrides.units ?? {
    test_unit: createTestUnit({ unitId: "test_unit" }),
  };

  const turnOrder = overrides.turnOrder ?? Object.keys(units);

  return {
    battleId: "test_battle",
    seed: 101,
    roundNumber: 1,
    turnIndex: 0,
    turnOrder,
    units,
    battleMap: {
      width: 10,
      height: 10,
      blocked: [],
    },
    effects: {},
    flags: {},
    eventSequence: 0,
    ...overrides,
  };
}

/**
 * Create a test map with sensible defaults.
 */
export function createTestMap(overrides: Partial<MapState> = {}): MapState {
  return {
    width: 10,
    height: 10,
    blocked: [],
    ...overrides,
  };
}

/**
 * Create a test effect with sensible defaults.
 */
export function createTestEffect(overrides: Partial<EffectState> = {}): EffectState {
  return {
    effectId: "test_effect",
    kind: "test_kind",
    sourceUnitId: null,
    targetUnitId: null,
    payload: {},
    durationRounds: null,
    tickTiming: null,
    ...overrides,
  };
}

/**
 * Create a deterministic RNG with a default seed.
 */
export function createTestRNG(seed = 101): DeterministicRNG {
  return new DeterministicRNG(seed);
}

/**
 * Create a pair of opposing units for combat tests.
 * Returns [attacker, defender] units with ids "attacker" and "defender".
 */
export function createCombatPair(): [UnitState, UnitState] {
  const attacker = createTestUnit({
    unitId: "attacker",
    team: "player",
    x: 0,
    y: 0,
    attackMod: 10,
    damage: "2d6",
  });

  const defender = createTestUnit({
    unitId: "defender",
    team: "enemy",
    x: 1,
    y: 0,
    ac: 15,
    hp: 20,
    maxHp: 20,
  });

  return [attacker, defender];
}

/**
 * Create a battle state with a simple two-unit combat setup.
 */
export function createCombatBattle(): BattleState {
  const [attacker, defender] = createCombatPair();
  return createTestBattle({
    units: {
      attacker,
      defender,
    },
    turnOrder: ["attacker", "defender"],
  });
}
