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


Command = (
    MoveCommand
    | StrikeCommand
    | EndTurnCommand
    | SaveDamageCommand
    | AreaSaveDamageCommand
    | ApplyEffectCommand
    | TriggerHazardSourceCommand
)
