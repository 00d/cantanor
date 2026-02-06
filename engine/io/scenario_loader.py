"""Scenario loading and lightweight validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from engine.core.state import BattleState, MapState, UnitState
from engine.core.turn_order import build_turn_order


class ScenarioValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ScenarioValidationError(message)


def validate_scenario(data: Dict[str, Any]) -> None:
    required_top = {"battle_id", "seed", "map", "units", "commands"}
    _require(required_top <= set(data.keys()), f"missing required keys: {required_top - set(data.keys())}")

    map_data = data["map"]
    _require(isinstance(map_data, dict), "map must be an object")
    _require(isinstance(map_data.get("width"), int) and map_data["width"] > 0, "map.width must be positive int")
    _require(isinstance(map_data.get("height"), int) and map_data["height"] > 0, "map.height must be positive int")

    units = data["units"]
    _require(isinstance(units, list) and units, "units must be a non-empty list")
    unit_ids = set()
    for unit in units:
        _require(isinstance(unit, dict), "unit must be object")
        for key in ("id", "team", "hp", "position", "initiative", "attack_mod", "ac", "damage"):
            _require(key in unit, f"unit missing key: {key}")
        _require(unit["id"] not in unit_ids, f"duplicate unit id: {unit['id']}")
        unit_ids.add(unit["id"])

    commands = data["commands"]
    _require(isinstance(commands, list), "commands must be list")
    for cmd in commands:
        _require(isinstance(cmd, dict), "command must be object")
        _require("type" in cmd and "actor" in cmd, "command requires type and actor")
        _require(cmd["actor"] in unit_ids, f"command actor not found: {cmd['actor']}")
        if "target" in cmd and cmd["target"] is not None:
            _require(cmd["target"] in unit_ids, f"command target not found: {cmd['target']}")


def load_scenario(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_scenario(data)
    return data


def battle_state_from_scenario(data: Dict[str, Any]) -> BattleState:
    blocked = [tuple(cell) for cell in data["map"].get("blocked", [])]
    battle_map = MapState(width=data["map"]["width"], height=data["map"]["height"], blocked=blocked)

    units = {}
    for raw in data["units"]:
        x, y = raw["position"]
        units[raw["id"]] = UnitState(
            unit_id=raw["id"],
            team=raw["team"],
            hp=raw["hp"],
            max_hp=raw["hp"],
            x=x,
            y=y,
            initiative=raw["initiative"],
            attack_mod=raw["attack_mod"],
            ac=raw["ac"],
            damage=raw["damage"],
            fortitude=int(raw.get("fortitude", 0)),
            reflex=int(raw.get("reflex", 0)),
            will=int(raw.get("will", 0)),
        )

    turn_order = build_turn_order(units)
    _require(len(turn_order) > 0, "no units available for turn order")

    return BattleState(
        battle_id=data["battle_id"],
        seed=data["seed"],
        round_number=1,
        turn_index=0,
        turn_order=turn_order,
        units=units,
        battle_map=battle_map,
    )
