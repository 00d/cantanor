/**
 * Runtime state model for deterministic tactical simulations.
 * Mirrors engine/core/state.py
 */

export interface UnitState {
  unitId: string;
  team: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  initiative: number;
  attackMod: number;
  ac: number;
  damage: string;
  tempHp: number;
  tempHpSource: string | null;
  tempHpOwnerEffectId: string | null;
  attackDamageType: string;
  attackDamageBypass: string[];
  fortitude: number;
  reflex: number;
  will: number;
  actionsRemaining: number;
  reactionAvailable: boolean;
  speed: number;
  conditions: Record<string, number>;
  conditionImmunities: string[];
  resistances: Record<string, number>;
  weaknesses: Record<string, number>;
  immunities: string[];
}

export function unitAlive(unit: UnitState): boolean {
  return unit.hp > 0;
}

export interface MapState {
  width: number;
  height: number;
  blocked: Array<[number, number]>;
}

export interface EffectState {
  effectId: string;
  kind: string;
  sourceUnitId: string | null;
  targetUnitId: string | null;
  payload: Record<string, unknown>;
  durationRounds: number | null;
  tickTiming: "turn_start" | "turn_end" | null;
}

export interface BattleState {
  battleId: string;
  seed: number;
  roundNumber: number;
  turnIndex: number;
  turnOrder: string[];
  units: Record<string, UnitState>;
  battleMap: MapState;
  effects: Record<string, EffectState>;
  flags: Record<string, boolean>;
  eventSequence: number;
}

export function activeUnitId(state: BattleState): string {
  return state.turnOrder[state.turnIndex];
}

export function activeUnit(state: BattleState): UnitState {
  return state.units[activeUnitId(state)];
}
