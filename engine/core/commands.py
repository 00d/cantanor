"""Command contracts for scenario playback."""

from __future__ import annotations

from typing import Literal, TypedDict


class BaseCommand(TypedDict):
    type: str
    actor: str


class MoveCommand(BaseCommand):
    type: Literal["move"]
    x: int
    y: int


class StrikeCommand(BaseCommand):
    type: Literal["strike"]
    target: str


class EndTurnCommand(BaseCommand):
    type: Literal["end_turn"]


class SaveDamageCommand(BaseCommand):
    type: Literal["save_damage"]
    target: str
    dc: int
    save_type: Literal["Fortitude", "Reflex", "Will"]
    damage: str
    mode: Literal["basic"]


class AreaSaveDamageCommand(BaseCommand):
    type: Literal["area_save_damage"]
    center_x: int
    center_y: int
    radius_feet: int
    dc: int
    save_type: Literal["Fortitude", "Reflex", "Will"]
    damage: str
    mode: Literal["basic"]
    include_actor: bool


class ApplyEffectCommand(BaseCommand):
    type: Literal["apply_effect"]
    target: str
    effect_kind: str
    payload: dict
    duration_rounds: int | None
    tick_timing: Literal["turn_start", "turn_end"] | None


class TriggerHazardSourceCommand(BaseCommand):
    type: Literal["trigger_hazard_source"]
    hazard_id: str
    source_name: str
    source_type: str
    center_x: int | None
    center_y: int | None
    target: str | None
    model_path: str | None


class RunHazardRoutineCommand(BaseCommand):
    type: Literal["run_hazard_routine"]
    hazard_id: str
    source_name: str
    source_type: str
    target_policy: Literal["as_configured", "explicit", "nearest_enemy", "nearest_enemy_area_center", "all_enemies"]
    center_x: int | None
    center_y: int | None
    target: str | None
    model_path: str | None


class SetFlagCommand(BaseCommand):
    type: Literal["set_flag"]
    flag: str
    value: bool


class SpawnUnitCommand(BaseCommand):
    type: Literal["spawn_unit"]
    unit: dict
    placement_policy: Literal["exact", "nearest_open"]
    spend_action: bool


class CastSpellCommand(BaseCommand):
    type: Literal["cast_spell"]
    spell_id: str
    target: str
    dc: int
    save_type: Literal["Fortitude", "Reflex", "Will"]
    damage: str
    mode: Literal["basic"]
    action_cost: int
    damage_type: str
    damage_bypass: list[str]


class UseFeatCommand(BaseCommand):
    type: Literal["use_feat"]
    feat_id: str
    target: str
    effect_kind: str
    payload: dict
    duration_rounds: int | None
    tick_timing: Literal["turn_start", "turn_end"] | None
    action_cost: int


class UseItemCommand(BaseCommand):
    type: Literal["use_item"]
    item_id: str
    target: str
    effect_kind: str
    payload: dict
    duration_rounds: int | None
    tick_timing: Literal["turn_start", "turn_end"] | None
    action_cost: int


class InteractCommand(BaseCommand):
    type: Literal["interact"]
    interact_id: str
    target: str | None
    effect_kind: str | None
    payload: dict
    duration_rounds: int | None
    tick_timing: Literal["turn_start", "turn_end"] | None
    action_cost: int
    flag: str | None
    value: bool


Command = (
    MoveCommand
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
    | InteractCommand
)
