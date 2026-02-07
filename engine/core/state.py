"""Runtime state model for deterministic tactical simulations."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class UnitState:
    unit_id: str
    team: str
    hp: int
    max_hp: int
    x: int
    y: int
    initiative: int
    attack_mod: int
    ac: int
    damage: str
    temp_hp: int = 0
    temp_hp_source: Optional[str] = None
    temp_hp_owner_effect_id: Optional[str] = None
    attack_damage_type: str = "physical"
    fortitude: int = 0
    reflex: int = 0
    will: int = 0
    actions_remaining: int = 3
    reaction_available: bool = True
    conditions: Dict[str, int] = field(default_factory=dict)
    condition_immunities: List[str] = field(default_factory=list)
    resistances: Dict[str, int] = field(default_factory=dict)
    weaknesses: Dict[str, int] = field(default_factory=dict)
    immunities: List[str] = field(default_factory=list)

    @property
    def alive(self) -> bool:
        return self.hp > 0


@dataclass
class MapState:
    width: int
    height: int
    blocked: List[Tuple[int, int]] = field(default_factory=list)


@dataclass
class EffectState:
    effect_id: str
    kind: str
    source_unit_id: Optional[str]
    target_unit_id: Optional[str]
    payload: Dict[str, object] = field(default_factory=dict)
    duration_rounds: Optional[int] = None
    tick_timing: Optional[str] = None


@dataclass
class BattleState:
    battle_id: str
    seed: int
    round_number: int
    turn_index: int
    turn_order: List[str]
    units: Dict[str, UnitState]
    battle_map: MapState
    effects: Dict[str, EffectState] = field(default_factory=dict)
    flags: Dict[str, bool] = field(default_factory=dict)
    event_sequence: int = 0

    @property
    def active_unit_id(self) -> str:
        return self.turn_order[self.turn_index]

    @property
    def active_unit(self) -> UnitState:
        return self.units[self.active_unit_id]
