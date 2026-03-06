/**
 * Runtime state model for deterministic tactical simulations.
 */

/** Weapon definition for units with explicit weapon data. */
export interface WeaponData {
  name: string;
  type: "melee" | "ranged";
  attackMod: number;
  damage: string;
  damageType: string;
  damageBypass?: string[];
  /** Melee only — reach in tiles (default 1). */
  reach?: number;
  /** Ranged only — range increment in tiles. */
  rangeIncrement?: number;
  /** Ranged only — max range in tiles (default: 6 × rangeIncrement). */
  maxRange?: number;
  /** Pre-computed propulsive bonus (half-STR mod, floor). */
  propulsiveMod?: number;
  /** Trait names (agile, deadly_d10, fatal_d12, volley_30, thrown_4, etc.). */
  traits?: string[];
  /** Max ammo capacity. Absent = infinite ammo. */
  ammo?: number;
  /** Action cost to reload; 0/absent = auto-nock (e.g. bow). */
  reload?: number;
  /** Number of hands required (1 or 2, default 1). */
  hands?: number;
}

/**
 * Resolves the weapon a unit uses for a strike.
 * If `weapons` array exists, returns the indexed weapon.
 * Otherwise synthesizes a melee weapon from the unit's flat fields.
 */
export function resolveWeapon(unit: UnitState, weaponIndex?: number): WeaponData {
  if (unit.weapons && unit.weapons.length > 0) {
    const idx = weaponIndex ?? 0;
    if (idx < 0 || idx >= unit.weapons.length) {
      throw new Error(`invalid weapon index ${idx} (unit has ${unit.weapons.length} weapons)`);
    }
    return unit.weapons[idx];
  }
  // Synthesize from flat fields for backward compatibility
  return {
    name: "melee strike",
    type: "melee",
    attackMod: unit.attackMod,
    damage: unit.damage,
    damageType: unit.attackDamageType,
    damageBypass: unit.attackDamageBypass.length > 0 ? [...unit.attackDamageBypass] : undefined,
    reach: unit.reach,
  };
}

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
  /** Explicit weapon list. When absent, flat fields (attackMod, damage, etc.) define a single melee weapon. */
  weapons?: WeaponData[];
  /** Path to sprite sheet descriptor JSON. */
  spriteSheet?: string;
  /** Reaction types this unit can use (e.g. ["attack_of_opportunity", "shield_block"]). */
  reactions?: string[];
  /** Shield hardness — damage reduced by Shield Block. */
  shieldHardness?: number;
  /** Current shield HP. */
  shieldHp?: number;
  /** Maximum shield HP. */
  shieldMaxHp?: number;
  /** Whether the shield is currently raised (via Raise Shield action). */
  shieldRaised?: boolean;
  /** Remaining ammo per weapon index. Absent key = infinite ammo. */
  weaponAmmo?: Record<number, number>;
}

export function unitAlive(unit: UnitState): boolean {
  return unit.hp > 0;
}

/**
 * Spatial hazard zone — environmental damage tied to map tiles.
 * Units standing on a hazard tile at the start of their turn roll a
 * basic save against `dc`; flat `damagePerTurn` is applied per the
 * outcome (crit success 0×, success 0.5×, fail 1×, crit fail 2×).
 */
export interface HazardZone {
  id: string;
  /** Damage type (fire, cold, acid, etc.) — respects resistances/immunities. */
  damageType: string;
  /** Flat damage amount (pre-save, pre-resistance). */
  damagePerTurn: number;
  dc: number;
  /** "Fortitude" | "Reflex" | "Will" */
  saveType: string;
  /** Grid cells covered by the zone. */
  tiles: Array<[number, number]>;
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
  /** Spatial hazard zones. Damage ticks at start of a unit's turn if they stand on a covered tile. */
  hazards?: HazardZone[];
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
