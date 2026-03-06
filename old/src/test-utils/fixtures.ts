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
    reach: 1,
    attacksThisTurn: 0,
    conditions: {},
    conditionImmunities: [],
    resistances: {},
    weaknesses: {},
    immunities: [],
    speed: 5,
    abilitiesRemaining: {},
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

/**
 * Create a ranged unit (has a shortbow with rangeIncrement 6).
 */
export function createRangedUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "archer",
    team: "player",
    weapons: [
      {
        name: "shortbow",
        type: "ranged",
        attackMod: 8,
        damage: "1d6",
        damageType: "piercing",
        rangeIncrement: 6,
      },
    ],
    ...overrides,
  });
}

/**
 * Create a unit with Attack of Opportunity reaction.
 */
export function createAoOUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "aoo_unit",
    team: "enemy",
    reactions: ["attack_of_opportunity"],
    ...overrides,
  });
}

/**
 * Create a unit with a shield (Shield Block reaction + shield stats).
 */
export function createShieldUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "shield_unit",
    team: "player",
    reactions: ["shield_block"],
    shieldHardness: 5,
    shieldHp: 20,
    shieldMaxHp: 20,
    shieldRaised: false,
    ...overrides,
  });
}

/**
 * Create a unit with an agile weapon (rapier).
 */
export function createAgileUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "agile_fighter",
    team: "player",
    weapons: [
      {
        name: "rapier",
        type: "melee",
        attackMod: 10,
        damage: "1d6+4",
        damageType: "piercing",
        reach: 1,
        traits: ["agile"],
      },
    ],
    ...overrides,
  });
}

/**
 * Create a unit with a deadly weapon (pick, deadly_d10).
 */
export function createDeadlyUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "deadly_fighter",
    team: "player",
    weapons: [
      {
        name: "war pick",
        type: "melee",
        attackMod: 10,
        damage: "1d8+4",
        damageType: "piercing",
        reach: 1,
        traits: ["deadly_d10"],
      },
    ],
    ...overrides,
  });
}

/**
 * Create a unit with a thrown melee weapon (javelin, thrown_4).
 */
export function createThrownUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "javelin_fighter",
    team: "player",
    weapons: [
      {
        name: "javelin",
        type: "melee",
        attackMod: 8,
        damage: "1d6+3",
        damageType: "piercing",
        reach: 1,
        traits: ["thrown_4"],
      },
    ],
    ...overrides,
  });
}

/**
 * Create a crossbow unit (ranged, requires reload, 1 ammo capacity).
 */
export function createCrossbowUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "crossbow_unit",
    team: "player",
    weapons: [
      {
        name: "crossbow",
        type: "ranged",
        attackMod: 8,
        damage: "1d8",
        damageType: "piercing",
        rangeIncrement: 6,
        ammo: 1,
        reload: 1,
      },
    ],
    weaponAmmo: { 0: 1 },
    ...overrides,
  });
}

/**
 * Create a unit with both melee and ranged weapons.
 */
export function createMixedUnit(overrides: Partial<UnitState> = {}): UnitState {
  return createTestUnit({
    unitId: "fighter",
    team: "player",
    weapons: [
      {
        name: "longsword",
        type: "melee",
        attackMod: 10,
        damage: "1d8+4",
        damageType: "slashing",
        reach: 1,
      },
      {
        name: "shortbow",
        type: "ranged",
        attackMod: 6,
        damage: "1d6",
        damageType: "piercing",
        rangeIncrement: 6,
      },
    ],
    ...overrides,
  });
}
