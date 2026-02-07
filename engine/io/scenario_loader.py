"""Scenario loading and lightweight validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Set

from engine.core.state import BattleState, MapState, UnitState
from engine.core.turn_order import build_turn_order


class ScenarioValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ScenarioValidationError(message)


def _validate_unit_shape(unit: Dict[str, Any], context: str) -> None:
    _require(isinstance(unit, dict), f"{context} must be object")
    for key in ("id", "team", "hp", "position", "initiative", "attack_mod", "ac", "damage"):
        _require(key in unit, f"{context} missing key: {key}")
    _require(isinstance(unit.get("id"), str) and bool(unit["id"]), f"{context}.id must be non-empty string")
    _require(isinstance(unit.get("team"), str) and bool(unit["team"]), f"{context}.team must be non-empty string")
    _require(isinstance(unit.get("hp"), int) and int(unit["hp"]) > 0, f"{context}.hp must be positive int")
    temp_hp = unit.get("temp_hp")
    if temp_hp is not None:
        _require(isinstance(temp_hp, int) and temp_hp >= 0, f"{context}.temp_hp must be non-negative int")
    pos = unit.get("position")
    _require(isinstance(pos, list) and len(pos) == 2, f"{context}.position must be [x, y]")
    _require(isinstance(pos[0], int) and isinstance(pos[1], int), f"{context}.position values must be ints")
    attack_damage_type = unit.get("attack_damage_type")
    if attack_damage_type is not None:
        _require(isinstance(attack_damage_type, str) and bool(attack_damage_type), f"{context}.attack_damage_type must be non-empty string")
    attack_damage_bypass = unit.get("attack_damage_bypass")
    if attack_damage_bypass is not None:
        _require(isinstance(attack_damage_bypass, list), f"{context}.attack_damage_bypass must be list")
        for idx, item in enumerate(attack_damage_bypass):
            _require(
                isinstance(item, str) and bool(item),
                f"{context}.attack_damage_bypass[{idx}] must be non-empty string",
            )
    for field_name in ("resistances", "weaknesses"):
        raw = unit.get(field_name)
        if raw is None:
            continue
        _require(isinstance(raw, dict), f"{context}.{field_name} must be object")
        for k, v in raw.items():
            _require(isinstance(k, str) and bool(k), f"{context}.{field_name} keys must be non-empty strings")
            _require(isinstance(v, int) and v >= 0, f"{context}.{field_name}[{k}] must be non-negative int")
    immunities = unit.get("immunities")
    if immunities is not None:
        _require(isinstance(immunities, list), f"{context}.immunities must be list")
        for idx, item in enumerate(immunities):
            _require(isinstance(item, str) and bool(item), f"{context}.immunities[{idx}] must be non-empty string")
    condition_immunities = unit.get("condition_immunities")
    if condition_immunities is not None:
        _require(isinstance(condition_immunities, list), f"{context}.condition_immunities must be list")
        for idx, item in enumerate(condition_immunities):
            _require(
                isinstance(item, str) and bool(item),
                f"{context}.condition_immunities[{idx}] must be non-empty string",
            )


def _validate_command(
    cmd: Dict[str, Any],
    known_unit_ids: Set[str],
    context: str,
    *,
    actor_required: bool = True,
) -> None:
    _require(isinstance(cmd, dict), f"{context} must be object")
    _require("type" in cmd, f"{context} requires type")
    ctype = str(cmd["type"])
    _require(
        ctype in (
            "move",
            "strike",
            "end_turn",
            "save_damage",
            "area_save_damage",
            "apply_effect",
            "trigger_hazard_source",
            "run_hazard_routine",
            "set_flag",
            "spawn_unit",
            "cast_spell",
            "use_feat",
            "use_item",
        ),
        f"{context} unsupported command type: {ctype}",
    )

    actor = cmd.get("actor")
    if actor_required:
        _require(isinstance(actor, str), f"{context} requires actor")
        _require(actor in known_unit_ids, f"{context} actor not found: {actor}")
    elif actor is not None:
        _require(isinstance(actor, str), f"{context}.actor must be string when present")
        _require(actor in known_unit_ids, f"{context} actor not found: {actor}")

    if "target" in cmd and cmd["target"] is not None:
        _require(cmd["target"] in known_unit_ids, f"{context} target not found: {cmd['target']}")

    if ctype == "move":
        _require("x" in cmd and "y" in cmd, f"{context} move requires x and y")
    elif ctype == "strike":
        _require(isinstance(cmd.get("target"), str), f"{context} strike requires target")
    elif ctype == "save_damage":
        for key in ("target", "dc", "save_type", "damage"):
            _require(key in cmd, f"{context} save_damage missing key: {key}")
        _require(str(cmd.get("save_type")) in ("Fortitude", "Reflex", "Will"), f"{context} save_damage save_type invalid")
        if "damage_type" in cmd:
            _require(isinstance(cmd.get("damage_type"), str) and bool(cmd["damage_type"]), f"{context} save_damage damage_type must be non-empty string")
        if "damage_bypass" in cmd:
            _require(isinstance(cmd["damage_bypass"], list), f"{context} save_damage damage_bypass must be list")
            for idx, item in enumerate(cmd["damage_bypass"]):
                _require(isinstance(item, str) and bool(item), f"{context} save_damage damage_bypass[{idx}] must be non-empty string")
        if "mode" in cmd:
            _require(str(cmd["mode"]) == "basic", f"{context} save_damage mode must be basic")
    elif ctype == "cast_spell":
        for key in ("spell_id", "target", "dc", "save_type", "damage"):
            _require(key in cmd, f"{context} cast_spell missing key: {key}")
        _require(isinstance(cmd.get("spell_id"), str) and bool(cmd["spell_id"]), f"{context} cast_spell spell_id must be non-empty string")
        _require(str(cmd.get("save_type")) in ("Fortitude", "Reflex", "Will"), f"{context} cast_spell save_type invalid")
        if "damage_type" in cmd:
            _require(isinstance(cmd.get("damage_type"), str) and bool(cmd["damage_type"]), f"{context} cast_spell damage_type must be non-empty string")
        if "damage_bypass" in cmd:
            _require(isinstance(cmd["damage_bypass"], list), f"{context} cast_spell damage_bypass must be list")
            for idx, item in enumerate(cmd["damage_bypass"]):
                _require(isinstance(item, str) and bool(item), f"{context} cast_spell damage_bypass[{idx}] must be non-empty string")
        if "mode" in cmd:
            _require(str(cmd["mode"]) == "basic", f"{context} cast_spell mode must be basic")
        if "action_cost" in cmd:
            _require(isinstance(cmd["action_cost"], int) and cmd["action_cost"] > 0, f"{context} cast_spell action_cost must be positive int")
    elif ctype == "area_save_damage":
        for key in ("center_x", "center_y", "radius_feet", "dc", "save_type", "damage"):
            _require(key in cmd, f"{context} area_save_damage missing key: {key}")
        _require(str(cmd.get("save_type")) in ("Fortitude", "Reflex", "Will"), f"{context} area_save_damage save_type invalid")
        if "damage_type" in cmd:
            _require(isinstance(cmd.get("damage_type"), str) and bool(cmd["damage_type"]), f"{context} area_save_damage damage_type must be non-empty string")
        if "damage_bypass" in cmd:
            _require(isinstance(cmd["damage_bypass"], list), f"{context} area_save_damage damage_bypass must be list")
            for idx, item in enumerate(cmd["damage_bypass"]):
                _require(isinstance(item, str) and bool(item), f"{context} area_save_damage damage_bypass[{idx}] must be non-empty string")
        if "mode" in cmd:
            _require(str(cmd["mode"]) == "basic", f"{context} area_save_damage mode must be basic")
    elif ctype == "apply_effect":
        for key in ("target", "effect_kind"):
            _require(key in cmd, f"{context} apply_effect missing key: {key}")
    elif ctype == "use_feat":
        for key in ("feat_id", "target", "effect_kind"):
            _require(key in cmd, f"{context} use_feat missing key: {key}")
        _require(isinstance(cmd.get("feat_id"), str) and bool(cmd["feat_id"]), f"{context} use_feat feat_id must be non-empty string")
        if "payload" in cmd:
            _require(isinstance(cmd["payload"], dict), f"{context} use_feat payload must be object")
        if "duration_rounds" in cmd and cmd["duration_rounds"] is not None:
            _require(isinstance(cmd["duration_rounds"], int) and cmd["duration_rounds"] >= 0, f"{context} use_feat duration_rounds must be non-negative int or null")
        if "tick_timing" in cmd and cmd["tick_timing"] is not None:
            _require(str(cmd["tick_timing"]) in ("turn_start", "turn_end"), f"{context} use_feat tick_timing invalid")
        if "action_cost" in cmd:
            _require(isinstance(cmd["action_cost"], int) and cmd["action_cost"] > 0, f"{context} use_feat action_cost must be positive int")
    elif ctype == "use_item":
        for key in ("item_id", "target", "effect_kind"):
            _require(key in cmd, f"{context} use_item missing key: {key}")
        _require(isinstance(cmd.get("item_id"), str) and bool(cmd["item_id"]), f"{context} use_item item_id must be non-empty string")
        if "payload" in cmd:
            _require(isinstance(cmd["payload"], dict), f"{context} use_item payload must be object")
        if "duration_rounds" in cmd and cmd["duration_rounds"] is not None:
            _require(isinstance(cmd["duration_rounds"], int) and cmd["duration_rounds"] >= 0, f"{context} use_item duration_rounds must be non-negative int or null")
        if "tick_timing" in cmd and cmd["tick_timing"] is not None:
            _require(str(cmd["tick_timing"]) in ("turn_start", "turn_end"), f"{context} use_item tick_timing invalid")
        if "action_cost" in cmd:
            _require(isinstance(cmd["action_cost"], int) and cmd["action_cost"] > 0, f"{context} use_item action_cost must be positive int")
    elif ctype == "trigger_hazard_source":
        for key in ("hazard_id", "source_name"):
            _require(key in cmd, f"{context} trigger_hazard_source missing key: {key}")
    elif ctype == "run_hazard_routine":
        for key in ("hazard_id", "source_name"):
            _require(key in cmd, f"{context} run_hazard_routine missing key: {key}")
        if "target_policy" in cmd:
            _require(
                str(cmd["target_policy"]) in ("as_configured", "explicit", "nearest_enemy", "nearest_enemy_area_center", "all_enemies"),
                f"{context} run_hazard_routine target_policy invalid",
            )
    elif ctype == "set_flag":
        _require("flag" in cmd, f"{context} set_flag missing key: flag")
        if "value" in cmd:
            _require(isinstance(cmd["value"], bool), f"{context} set_flag value must be bool")

    if ctype == "spawn_unit":
        unit = cmd.get("unit")
        _require(isinstance(unit, dict), f"{context} spawn_unit requires unit object")
        _validate_unit_shape(unit, f"{context}.unit")
        unit_id = str(unit["id"])
        _require(unit_id not in known_unit_ids, f"{context} spawn unit id already exists: {unit_id}")
        placement_policy = cmd.get("placement_policy")
        if placement_policy is not None:
            _require(str(placement_policy) in ("exact", "nearest_open"), f"{context} spawn_unit placement_policy invalid")
        if "spend_action" in cmd:
            _require(isinstance(cmd["spend_action"], bool), f"{context} spawn_unit spend_action must be bool")
        known_unit_ids.add(unit_id)


def _validate_command_block(
    commands: Any,
    known_unit_ids: Set[str],
    context: str,
    *,
    actor_required: bool = True,
) -> Set[str]:
    _require(isinstance(commands, list), f"{context} must be list")
    local_known_ids = set(known_unit_ids)
    for cidx, cmd in enumerate(commands):
        _validate_command(
            cmd,
            local_known_ids,
            f"{context}[{cidx}]",
            actor_required=actor_required,
        )
    return local_known_ids


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
        _validate_unit_shape(unit, "unit")
        _require(unit["id"] not in unit_ids, f"duplicate unit id: {unit['id']}")
        unit_ids.add(unit["id"])

    commands = data["commands"]
    _require(isinstance(commands, list), "commands must be list")
    known_ids = set(unit_ids)
    for cmd in commands:
        _validate_command(cmd, known_ids, "command")

    flags = data.get("flags", {})
    _require(isinstance(flags, dict), "flags must be object when present")
    for key, value in flags.items():
        _require(isinstance(key, str), "flag keys must be strings")
        _require(isinstance(value, bool), f"flag {key} must be bool")

    objectives = data.get("objectives", [])
    _require(isinstance(objectives, list), "objectives must be list when present")
    for idx, objective in enumerate(objectives):
        _require(isinstance(objective, dict), f"objective[{idx}] must be object")
        _require("id" in objective and "type" in objective, f"objective[{idx}] requires id and type")
        otype = str(objective["type"])
        if otype in ("unit_reach_tile", "unit_dead", "unit_alive"):
            unit_id = objective.get("unit_id")
            _require(isinstance(unit_id, str) and unit_id in known_ids, f"objective[{idx}] unit_id invalid: {unit_id}")

    objective_packs = data.get("objective_packs", [])
    _require(isinstance(objective_packs, list), "objective_packs must be list when present")
    for idx, pack in enumerate(objective_packs):
        _require(isinstance(pack, dict), f"objective_pack[{idx}] must be object")
        _require("type" in pack, f"objective_pack[{idx}] requires type")
        ptype = str(pack.get("type"))
        if ptype == "escape_unit":
            unit_id = pack.get("unit_id")
            _require(isinstance(unit_id, str) and unit_id in known_ids, f"objective_pack[{idx}] unit_id invalid: {unit_id}")

    enemy_policy = data.get("enemy_policy")
    if enemy_policy is not None:
        _require(isinstance(enemy_policy, dict), "enemy_policy must be object when present")
        if "enabled" in enemy_policy:
            _require(isinstance(enemy_policy["enabled"], bool), "enemy_policy.enabled must be bool")
        if "teams" in enemy_policy:
            teams = enemy_policy["teams"]
            _require(isinstance(teams, list), "enemy_policy.teams must be list")
            for idx, team in enumerate(teams):
                _require(isinstance(team, str) and bool(team), f"enemy_policy.teams[{idx}] must be non-empty string")
        if "action" in enemy_policy:
            _require(str(enemy_policy["action"]) in ("strike_nearest",), "enemy_policy.action invalid")
        if "auto_end_turn" in enemy_policy:
            _require(isinstance(enemy_policy["auto_end_turn"], bool), "enemy_policy.auto_end_turn must be bool")

    mission_events = data.get("mission_events", [])
    _require(isinstance(mission_events, list), "mission_events must be list when present")
    for idx, mission_event in enumerate(mission_events):
        _require(isinstance(mission_event, dict), f"mission_event[{idx}] must be object")
        trigger = mission_event.get("trigger")
        if trigger is not None:
            _require(
                trigger in ("turn_start", "round_start", "unit_dead", "unit_alive", "flag_set"),
                f"mission_event[{idx}] trigger invalid: {trigger}",
            )
        trigger_name = str(trigger or "turn_start")
        if trigger_name in ("unit_dead", "unit_alive"):
            unit_id = mission_event.get("unit_id")
            _require(
                isinstance(unit_id, str) and unit_id in known_ids,
                f"mission_event[{idx}] unit_id invalid for {trigger_name}: {unit_id}",
            )
        if trigger_name == "flag_set":
            flag_name = mission_event.get("flag")
            _require(isinstance(flag_name, str) and bool(flag_name), f"mission_event[{idx}] flag is required for flag_set trigger")
        active_unit = mission_event.get("active_unit")
        if active_unit is not None:
            _require(isinstance(active_unit, str) and active_unit in known_ids, f"mission_event[{idx}] active_unit invalid: {active_unit}")
        branch_ids: list[Set[str]] = []

        commands = mission_event.get("commands")
        if commands is not None:
            branch_ids.append(
                _validate_command_block(
                    commands,
                    known_ids,
                    f"mission_event[{idx}].commands",
                    actor_required=False,
                )
            )

        then_commands = mission_event.get("then_commands")
        else_commands = mission_event.get("else_commands")
        has_branch = then_commands is not None or else_commands is not None
        if has_branch:
            if then_commands is None:
                then_commands = []
            if else_commands is None:
                else_commands = []
            branch_ids.append(
                _validate_command_block(
                    then_commands,
                    known_ids,
                    f"mission_event[{idx}].then_commands",
                    actor_required=False,
                )
            )
            branch_ids.append(
                _validate_command_block(
                    else_commands,
                    known_ids,
                    f"mission_event[{idx}].else_commands",
                    actor_required=False,
                )
            )

        _require(branch_ids, f"mission_event[{idx}] requires commands, then_commands, or else_commands")
        merged_ids = set(known_ids)
        for branch_set in branch_ids:
            merged_ids.update(branch_set)
        known_ids = merged_ids

    reinforcement_waves = data.get("reinforcement_waves", [])
    _require(isinstance(reinforcement_waves, list), "reinforcement_waves must be list when present")
    for idx, wave in enumerate(reinforcement_waves):
        _require(isinstance(wave, dict), f"reinforcement_wave[{idx}] must be object")
        trigger = wave.get("trigger")
        if trigger is not None:
            _require(trigger in ("turn_start", "round_start"), f"reinforcement_wave[{idx}] trigger invalid: {trigger}")
        placement_policy = wave.get("placement_policy")
        if placement_policy is not None:
            _require(
                placement_policy in ("exact", "nearest_open"),
                f"reinforcement_wave[{idx}] placement_policy invalid: {placement_policy}",
            )
        active_unit = wave.get("active_unit")
        if active_unit is not None:
            _require(
                isinstance(active_unit, str) and active_unit in known_ids,
                f"reinforcement_wave[{idx}] active_unit invalid: {active_unit}",
            )
        units = wave.get("units")
        _require(isinstance(units, list) and units, f"reinforcement_wave[{idx}] units must be non-empty list")
        for uidx, unit in enumerate(units):
            _validate_unit_shape(unit, f"reinforcement_wave[{idx}].units[{uidx}]")
            unit_id = str(unit["id"])
            _require(unit_id not in known_ids, f"reinforcement_wave[{idx}] duplicate spawned unit id: {unit_id}")
            known_ids.add(unit_id)

    hazard_routines = data.get("hazard_routines", [])
    _require(isinstance(hazard_routines, list), "hazard_routines must be list when present")
    for idx, routine in enumerate(hazard_routines):
        _require(isinstance(routine, dict), f"hazard_routine[{idx}] must be object")
        for key in ("unit_id", "hazard_id", "source_name"):
            _require(key in routine, f"hazard_routine[{idx}] missing key: {key}")
        _require(routine["unit_id"] in known_ids, f"hazard_routine[{idx}] unit_id not found: {routine['unit_id']}")
        cadence_rounds = routine.get("cadence_rounds")
        if cadence_rounds is not None:
            _require(isinstance(cadence_rounds, int) and cadence_rounds > 0, f"hazard_routine[{idx}] cadence_rounds must be positive int")
        max_triggers = routine.get("max_triggers")
        if max_triggers is not None:
            _require(isinstance(max_triggers, int) and max_triggers > 0, f"hazard_routine[{idx}] max_triggers must be positive int")


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
        temp_hp = int(raw.get("temp_hp", 0))
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
            temp_hp=temp_hp,
            temp_hp_source="initial" if temp_hp > 0 else None,
            temp_hp_owner_effect_id=None,
            attack_damage_type=str(raw.get("attack_damage_type", "physical")).lower(),
            attack_damage_bypass=[str(x).lower() for x in list(raw.get("attack_damage_bypass", []))],
            fortitude=int(raw.get("fortitude", 0)),
            reflex=int(raw.get("reflex", 0)),
            will=int(raw.get("will", 0)),
            condition_immunities=[str(x).lower().replace(" ", "_") for x in list(raw.get("condition_immunities", []))],
            resistances={str(k).lower(): int(v) for k, v in dict(raw.get("resistances", {})).items()},
            weaknesses={str(k).lower(): int(v) for k, v in dict(raw.get("weaknesses", {})).items()},
            immunities=[str(x).lower() for x in list(raw.get("immunities", []))],
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
        flags={str(k): bool(v) for k, v in dict(data.get("flags", {})).items()},
    )
