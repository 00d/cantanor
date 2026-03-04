/**
 * Command discriminated union types for scenario playback.
 * Mirrors engine/core/commands.py
 */

export interface MoveCommand {
  type: "move";
  actor: string;
  x: number;
  y: number;
}

export interface StrikeCommand {
  type: "strike";
  actor: string;
  target: string;
  emitForecast?: boolean;
}

export interface EndTurnCommand {
  type: "end_turn";
  actor: string;
}

export interface SaveDamageCommand {
  type: "save_damage";
  actor: string;
  target: string;
  dc: number;
  saveType: "Fortitude" | "Reflex" | "Will";
  damage: string;
  mode: "basic";
  damageType?: string;
  damageBypass?: string[];
}

export interface AreaSaveDamageCommand {
  type: "area_save_damage";
  actor: string;
  centerX: number;
  centerY: number;
  radiusFeet: number;
  dc: number;
  saveType: "Fortitude" | "Reflex" | "Will";
  damage: string;
  mode: "basic";
  damageType?: string;
  damageBypass?: string[];
  includeActor?: boolean;
}

export interface ApplyEffectCommand {
  type: "apply_effect";
  actor: string;
  target: string;
  effectKind: string;
  payload: Record<string, unknown>;
  durationRounds?: number | null;
  tickTiming?: "turn_start" | "turn_end" | null;
}

export interface TriggerHazardSourceCommand {
  type: "trigger_hazard_source";
  actor: string;
  hazardId: string;
  sourceName: string;
  sourceType?: string;
  centerX?: number | null;
  centerY?: number | null;
  target?: string | null;
  modelPath?: string | null;
}

export interface RunHazardRoutineCommand {
  type: "run_hazard_routine";
  actor: string;
  hazardId: string;
  sourceName: string;
  sourceType?: string;
  targetPolicy?: "as_configured" | "explicit" | "nearest_enemy" | "nearest_enemy_area_center" | "all_enemies";
  centerX?: number | null;
  centerY?: number | null;
  target?: string | null;
  modelPath?: string | null;
}

export interface SetFlagCommand {
  type: "set_flag";
  actor: string;
  flag: string;
  value?: boolean;
}

export interface SpawnUnitCommand {
  type: "spawn_unit";
  actor: string;
  unit: Record<string, unknown>;
  placementPolicy?: "exact" | "nearest_open";
  spendAction?: boolean;
}

export interface CastSpellCommand {
  type: "cast_spell";
  actor: string;
  spellId: string;
  target: string;
  dc: number;
  saveType: "Fortitude" | "Reflex" | "Will";
  damage: string;
  mode?: "basic";
  actionCost?: number;
  damageType?: string;
  damageBypass?: string[];
  contentEntryId?: string;
}

export interface UseFeatCommand {
  type: "use_feat";
  actor: string;
  featId?: string;
  target: string;
  effectKind?: string;
  payload?: Record<string, unknown>;
  durationRounds?: number | null;
  tickTiming?: "turn_start" | "turn_end" | null;
  actionCost?: number;
  contentEntryId?: string;
}

export interface UseItemCommand {
  type: "use_item";
  actor: string;
  itemId?: string;
  target: string;
  effectKind?: string;
  payload?: Record<string, unknown>;
  durationRounds?: number | null;
  tickTiming?: "turn_start" | "turn_end" | null;
  actionCost?: number;
  contentEntryId?: string;
}

export interface InteractCommand {
  type: "interact";
  actor: string;
  interactId?: string;
  target?: string | null;
  effectKind?: string | null;
  payload?: Record<string, unknown>;
  durationRounds?: number | null;
  tickTiming?: "turn_start" | "turn_end" | null;
  actionCost?: number;
  flag?: string;
  value?: boolean;
  contentEntryId?: string;
}

export type Command =
  | MoveCommand
  | StrikeCommand
  | EndTurnCommand
  | SaveDamageCommand
  | AreaSaveDamageCommand
  | ApplyEffectCommand
  | TriggerHazardSourceCommand
  | RunHazardRoutineCommand
  | SetFlagCommand
  | SpawnUnitCommand
  | CastSpellCommand
  | UseFeatCommand
  | UseItemCommand
  | InteractCommand;

/** Raw command dict shape used in scenario JSON — snake_case keys matching the Python schema */
export interface RawCommand {
  type: string;
  actor?: string;
  x?: number;
  y?: number;
  target?: string;
  dc?: number;
  save_type?: string;
  damage?: string;
  mode?: string;
  damage_type?: string;
  damage_bypass?: string[];
  center_x?: number;
  center_y?: number;
  radius_feet?: number;
  include_actor?: boolean;
  effect_kind?: string;
  payload?: Record<string, unknown>;
  duration_rounds?: number | null;
  tick_timing?: string | null;
  hazard_id?: string;
  source_name?: string;
  source_type?: string;
  model_path?: string | null;
  target_policy?: string;
  flag?: string;
  value?: boolean;
  unit?: Record<string, unknown>;
  placement_policy?: string;
  spend_action?: boolean;
  spell_id?: string;
  feat_id?: string;
  item_id?: string;
  interact_id?: string;
  action_cost?: number;
  content_entry_id?: string;
  uses_per_day?: number;
  emit_forecast?: boolean;
}
