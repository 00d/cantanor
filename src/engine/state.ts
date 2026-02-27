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
  /** Melee reach in tiles (PF2e default = 1; reach weapons = 2). */
  reach: number;
  /** Attacks made this turn — drives Multiple Attack Penalty. Reset to 0 on turn start. */
  attacksThisTurn: number;
  conditions: Record<string, number>;
  conditionImmunities: string[];
  resistances: Record<string, number>;
  weaknesses: Record<string, number>;
  immunities: string[];
  /** Content-entry ids this unit may use. Undefined = all entries available. */
  abilities?: string[];
  /** Remaining uses for limited-use content entries (keyed by entry id). Absent = unlimited. */
  abilitiesRemaining: Record<string, number>;
}

export function unitAlive(unit: UnitState): boolean {
  return unit.hp > 0;
}

export interface MapState {
  width: number;
  height: number;
  blocked: Array<[number, number]>;
  /** Per-tile movement cost keyed by "x,y"; absent = 1 (normal). Difficult terrain = 2. */
  moveCost?: Record<string, number>;
  /** Per-tile cover grade keyed by "x,y"; absent = 0. 1 = standard, 2 = greater. */
  coverGrade?: Record<string, number>;
  /** Per-tile elevation keyed by "x,y"; absent = 0 (ground level). */
  elevation?: Record<string, number>;
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
