"""CLI runner for deterministic smoke scenarios."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

from engine.core.objectives import evaluate_objectives, expand_objective_packs
from engine.core.reducer import ReductionError, apply_command
from engine.core.rng import DeterministicRNG
from engine.io.content_pack_loader import resolve_scenario_content_context
from engine.io.event_log import replay_hash
from engine.io.scenario_loader import battle_state_from_scenario, load_scenario

DEFAULT_ENGINE_PHASE = 7


def _alive_teams(state) -> set[str]:
    return {u.team for u in state.units.values() if u.alive}


def _state_snapshot(state) -> Dict[str, object]:
    return {
        "battle_id": state.battle_id,
        "round": state.round_number,
        "active_unit": state.active_unit_id,
        "units": {
            uid: {
                "team": u.team,
                "hp": u.hp,
                "max_hp": u.max_hp,
                "temp_hp": u.temp_hp,
                "temp_hp_source": u.temp_hp_source,
                "position": [u.x, u.y],
                "alive": u.alive,
                "conditions": u.conditions,
                "attack_damage_type": u.attack_damage_type,
                "resistances": u.resistances,
                "weaknesses": u.weaknesses,
                "immunities": u.immunities,
            }
            for uid, u in sorted(state.units.items())
        },
        "flags": dict(sorted(state.flags.items())),
    }


def _default_command_id_from_entry(entry_id: str) -> str:
    if "." in entry_id:
        return entry_id.split(".", 1)[1]
    return entry_id


def _materialize_content_entry_command(command: dict, content_context: dict) -> dict:
    """Resolve content-entry templates into reducer-ready command payloads."""

    out = dict(command)
    entry_id = out.get("content_entry_id")
    if entry_id is None:
        return out
    entry_id = str(entry_id)
    lookup = dict(content_context.get("entry_lookup", {}))
    entry = lookup.get(entry_id)
    if entry is None:
        raise ReductionError(f"unknown content entry {entry_id}")

    payload_template = dict(entry.get("payload", {}))
    template_type = payload_template.get("command_type")
    command_type = str(out.get("type") or "")
    if template_type is not None and str(template_type) != command_type:
        raise ReductionError(f"content entry {entry_id} command_type mismatch: {template_type} != {command_type}")

    if command_type not in {"cast_spell", "use_feat", "use_item", "interact"}:
        raise ReductionError(f"content_entry_id unsupported for command type: {command_type}")

    payload_template.pop("command_type", None)
    merged = dict(payload_template)
    merged.update(out)

    if command_type == "cast_spell" and not merged.get("spell_id"):
        merged["spell_id"] = _default_command_id_from_entry(entry_id)
    elif command_type == "use_feat" and not merged.get("feat_id"):
        merged["feat_id"] = _default_command_id_from_entry(entry_id)
    elif command_type == "use_item" and not merged.get("item_id"):
        merged["item_id"] = _default_command_id_from_entry(entry_id)
    elif command_type == "interact" and not merged.get("interact_id"):
        merged["interact_id"] = _default_command_id_from_entry(entry_id)

    return merged


def _normalize_hazard_routines(scenario: Dict[str, object]) -> Dict[str, List[dict]]:
    by_unit: Dict[str, List[dict]] = {}
    for idx, raw in enumerate(scenario.get("hazard_routines", [])):
        routine = dict(raw)
        routine.setdefault("id", f"routine_{idx + 1}")
        routine.setdefault("source_type", "trigger_action")
        routine.setdefault("target_policy", "nearest_enemy")
        routine.setdefault("start_round", 1)
        routine.setdefault("once", False)
        routine.setdefault("auto_end_turn", True)
        routine.setdefault("priority", 0)
        routine.setdefault("cadence_rounds", 1)
        unit_id = str(routine.get("unit_id"))
        by_unit.setdefault(unit_id, []).append(routine)
    for unit_id in list(by_unit.keys()):
        by_unit[unit_id] = sorted(
            by_unit[unit_id],
            key=lambda r: (int(r.get("priority", 0)), str(r.get("id", ""))),
        )
    return by_unit


def _routine_eligible(state, routine: dict, once_completed: set[str], use_counts: dict[str, int]) -> bool:
    routine_id = str(routine.get("id"))
    if bool(routine.get("once", False)) and routine_id in once_completed:
        return False

    max_triggers = routine.get("max_triggers")
    if max_triggers is not None and use_counts.get(routine_id, 0) >= int(max_triggers):
        return False

    start_round = int(routine.get("start_round", 1))
    if state.round_number < start_round:
        return False
    end_round = routine.get("end_round")
    if end_round is not None and state.round_number > int(end_round):
        return False
    cadence = max(1, int(routine.get("cadence_rounds", 1)))
    if (state.round_number - start_round) % cadence != 0:
        return False
    enabled_flag = routine.get("enabled_flag")
    if enabled_flag is not None and not state.flags.get(str(enabled_flag), False):
        return False
    disabled_flag = routine.get("disabled_flag")
    if disabled_flag is not None and state.flags.get(str(disabled_flag), False):
        return False
    return True


def _routine_command(actor: str, routine: dict) -> dict:
    command = {
        "type": "run_hazard_routine",
        "actor": actor,
        "hazard_id": str(routine["hazard_id"]),
        "source_name": str(routine["source_name"]),
        "source_type": str(routine.get("source_type") or "trigger_action"),
        "target_policy": str(routine.get("target_policy") or "nearest_enemy"),
    }
    for key in ("center_x", "center_y", "target", "model_path"):
        if key in routine:
            command[key] = routine[key]
    return command


def _normalize_mission_events(scenario: Dict[str, object]) -> List[dict]:
    out: List[dict] = []
    for idx, raw in enumerate(scenario.get("mission_events", [])):
        event = dict(raw)
        event.setdefault("id", f"mission_event_{idx + 1}")
        event.setdefault("trigger", "turn_start")
        event.setdefault("start_round", 1)
        event.setdefault("once", True)
        event.setdefault("commands", [])
        out.append(event)
    for idx, raw in enumerate(scenario.get("reinforcement_waves", [])):
        wave = dict(raw)
        commands: List[dict] = []
        placement_policy = str(wave.get("placement_policy") or "exact")
        spend_action = bool(wave.get("spend_action", False))
        for unit in list(wave.get("units", [])):
            commands.append(
                {
                    "type": "spawn_unit",
                    "placement_policy": placement_policy,
                    "spend_action": spend_action,
                    "unit": dict(unit),
                }
            )
        if "set_flag" in wave:
            commands.append(
                {
                    "type": "set_flag",
                    "flag": str(wave.get("set_flag")),
                    "value": bool(wave.get("set_flag_value", True)),
                }
            )
        event = {
            "id": str(wave.get("id") or f"reinforcement_wave_{idx + 1}"),
            "trigger": str(wave.get("trigger") or "round_start"),
            "once": bool(wave.get("once", True)),
            "commands": commands,
        }
        for key in ("round", "start_round", "end_round", "active_unit", "enabled_flag", "disabled_flag"):
            if key in wave:
                event[key] = wave[key]
        out.append(event)
    return out


def _mission_event_eligible(state, mission_event: dict, once_completed: set[str]) -> bool:
    mission_id = str(mission_event.get("id"))
    if bool(mission_event.get("once", True)) and mission_id in once_completed:
        return False

    trigger = str(mission_event.get("trigger") or "turn_start")
    if trigger == "round_start":
        if state.turn_index != 0:
            return False
    elif trigger == "turn_start":
        pass
    elif trigger == "unit_dead":
        unit_id = str(mission_event.get("unit_id") or "")
        unit = state.units.get(unit_id)
        if unit is None or unit.alive:
            return False
    elif trigger == "unit_alive":
        unit_id = str(mission_event.get("unit_id") or "")
        unit = state.units.get(unit_id)
        if unit is None or not unit.alive:
            return False
    elif trigger == "flag_set":
        flag = str(mission_event.get("flag") or "")
        expected = bool(mission_event.get("value", True))
        if not flag or state.flags.get(flag, False) != expected:
            return False
    else:
        return False

    round_exact = mission_event.get("round")
    if round_exact is not None and state.round_number != int(round_exact):
        return False
    start_round = int(mission_event.get("start_round", 1))
    if state.round_number < start_round:
        return False
    end_round = mission_event.get("end_round")
    if end_round is not None and state.round_number > int(end_round):
        return False

    active_unit = mission_event.get("active_unit")
    if active_unit is not None and str(active_unit) != state.active_unit_id:
        return False

    enabled_flag = mission_event.get("enabled_flag")
    if enabled_flag is not None and not state.flags.get(str(enabled_flag), False):
        return False
    disabled_flag = mission_event.get("disabled_flag")
    if disabled_flag is not None and state.flags.get(str(disabled_flag), False):
        return False
    return True


def _mission_event_commands(state, mission_event: dict) -> Tuple[List[dict], str]:
    has_branch = "then_commands" in mission_event or "else_commands" in mission_event
    if not has_branch:
        return [dict(cmd) for cmd in list(mission_event.get("commands", []))], "default"

    condition_met = True
    if_flag = mission_event.get("if_flag")
    if if_flag is not None:
        expected = bool(mission_event.get("if_flag_value", True))
        condition_met = state.flags.get(str(if_flag), False) == expected

    if condition_met:
        return [dict(cmd) for cmd in list(mission_event.get("then_commands", []))], "then"
    return [dict(cmd) for cmd in list(mission_event.get("else_commands", []))], "else"


def _mission_command(raw_command: dict, active_unit_id: str) -> dict:
    command = dict(raw_command)
    command.setdefault("actor", active_unit_id)
    return command


def _normalize_enemy_policy(scenario: Dict[str, object]) -> dict:
    raw = dict(scenario.get("enemy_policy", {}) or {})
    enabled = bool(raw.get("enabled", False))
    teams_raw = raw.get("teams", ["enemy"])
    teams = [str(x) for x in teams_raw] if isinstance(teams_raw, list) else ["enemy"]
    if not teams:
        teams = ["enemy"]
    return {
        "enabled": enabled,
        "teams": teams,
        "action": str(raw.get("action") or "strike_nearest"),
        "content_entry_id": raw.get("content_entry_id"),
        "dc": raw.get("dc"),
        "auto_end_turn": bool(raw.get("auto_end_turn", True)),
    }


def _nearest_enemy_for_actor(state, actor_id: str) -> str | None:
    actor = state.units[actor_id]
    enemies = [u for u in state.units.values() if u.alive and u.team != actor.team and u.unit_id != actor_id]
    if not enemies:
        return None
    nearest = sorted(enemies, key=lambda u: (abs(u.x - actor.x) + abs(u.y - actor.y), u.unit_id))[0]
    return nearest.unit_id


def _enemy_policy_command(state, policy: dict) -> dict:
    actor_id = state.active_unit_id
    actor = state.units[actor_id]
    if not actor.alive or actor.actions_remaining <= 0:
        return {"type": "end_turn", "actor": actor_id}

    if actor.team not in set(policy.get("teams", [])):
        return {"type": "end_turn", "actor": actor_id}

    action = str(policy.get("action") or "strike_nearest")
    if action == "strike_nearest":
        target_id = _nearest_enemy_for_actor(state, actor_id)
        if target_id:
            return {"type": "strike", "actor": actor_id, "target": target_id}
        return {"type": "end_turn", "actor": actor_id}
    if action == "cast_spell_entry_nearest":
        target_id = _nearest_enemy_for_actor(state, actor_id)
        if target_id:
            return {
                "type": "cast_spell",
                "actor": actor_id,
                "content_entry_id": str(policy.get("content_entry_id") or ""),
                "target": target_id,
                "dc": int(policy.get("dc") or 0),
            }
        return {"type": "end_turn", "actor": actor_id}
    if action == "use_feat_entry_self":
        return {
            "type": "use_feat",
            "actor": actor_id,
            "content_entry_id": str(policy.get("content_entry_id") or ""),
            "target": actor_id,
        }
    if action == "use_item_entry_self":
        return {
            "type": "use_item",
            "actor": actor_id,
            "content_entry_id": str(policy.get("content_entry_id") or ""),
            "target": actor_id,
        }
    if action == "interact_entry_self":
        return {
            "type": "interact",
            "actor": actor_id,
            "content_entry_id": str(policy.get("content_entry_id") or ""),
            "target": actor_id,
        }
    return {"type": "end_turn", "actor": actor_id}


def _check_battle_end(
    events: List[dict],
    state,
    objectives: List[dict],
    objective_statuses: Dict[str, bool],
    step_counter: int,
) -> Tuple[bool, Dict[str, bool]]:
    if objectives:
        objective_state = evaluate_objectives(state, objectives)
        statuses = dict(objective_state["statuses"])
        if statuses != objective_statuses:
            events.append(
                {
                    "event_id": f"ev_obj_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "objective_update",
                    "payload": {
                        "statuses": statuses,
                        "victory_met": bool(objective_state["victory_met"]),
                        "defeat_met": bool(objective_state["defeat_met"]),
                    },
                }
            )
            objective_statuses = statuses
        if bool(objective_state["defeat_met"]) or bool(objective_state["victory_met"]):
            events.append(
                {
                    "event_id": f"ev_done_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "battle_end",
                    "payload": {
                        "reason": "objectives",
                        "outcome": "defeat" if bool(objective_state["defeat_met"]) else "victory",
                        "objective_statuses": objective_statuses,
                    },
                }
            )
            return True, objective_statuses

    alive_teams = _alive_teams(state)
    if len(alive_teams) <= 1:
        events.append(
            {
                "event_id": f"ev_done_{step_counter:04d}",
                "round": state.round_number,
                "active_unit": state.active_unit_id,
                "type": "battle_end",
                "payload": {"winner_team": next(iter(alive_teams), None)},
            }
        )
        return True, objective_statuses

    return False, objective_statuses


def run_scenario_file(path: Path) -> Dict[str, object]:
    scenario = load_scenario(path)
    engine_phase = int(scenario.get("engine_phase", DEFAULT_ENGINE_PHASE))
    content_context = resolve_scenario_content_context(
        scenario,
        scenario_path=path,
        engine_phase=engine_phase,
    )
    state = battle_state_from_scenario(scenario)
    objectives = expand_objective_packs(
        objectives=list(scenario.get("objectives", [])),
        objective_packs=list(scenario.get("objective_packs", [])),
    )
    routines_by_unit = _normalize_hazard_routines(scenario)
    mission_events = _normalize_mission_events(scenario)
    enemy_policy = _normalize_enemy_policy(scenario)
    rng = DeterministicRNG(seed=state.seed)
    events: List[dict] = []
    if list(content_context.get("packs", [])):
        events.append(
            {
                "event_id": "ev_pack_000000",
                "round": state.round_number,
                "active_unit": state.active_unit_id,
                "type": "content_pack_resolved",
                "payload": {
                    "engine_phase": engine_phase,
                    "selected_pack_id": content_context.get("selected_pack_id"),
                    "pack_count": len(list(content_context.get("packs", []))),
                    "entry_count": len(dict(content_context.get("entry_lookup", {}))),
                },
            }
        )

    events.append(
        {
            "event_id": "ev_000000",
            "round": state.round_number,
            "active_unit": state.active_unit_id,
            "type": "turn_start",
            "payload": {"active_unit": state.active_unit_id, "round": state.round_number},
        }
    )

    scripted_executed = 0
    auto_executed = 0
    step_counter = 0
    max_steps = int(scenario.get("max_steps", len(scenario["commands"]) + 1000))
    objective_statuses: Dict[str, bool] = {}
    mission_turn_executed: set[Tuple[int, int, str]] = set()
    mission_once_completed: set[str] = set()
    routine_turn_executed: set[Tuple[int, int, str]] = set()
    routine_once_completed: set[str] = set()
    routine_use_counts: Dict[str, int] = {}
    ended = False
    command_index = 0
    commands = list(scenario["commands"])
    stop_reason = "script_exhausted"

    ended, objective_statuses = _check_battle_end(
        events=events,
        state=state,
        objectives=objectives,
        objective_statuses=objective_statuses,
        step_counter=step_counter,
    )
    if ended:
        stop_reason = "battle_end"

    while step_counter < max_steps and not ended:
        active_unit_id = state.active_unit_id
        ran_mission_event = False
        ran_routine = False

        for mission_event in mission_events:
            mission_id = str(mission_event.get("id"))
            turn_key = (state.round_number, state.turn_index, mission_id)
            if turn_key in mission_turn_executed:
                continue
            if not _mission_event_eligible(state, mission_event, mission_once_completed):
                continue

            event_commands, branch = _mission_event_commands(state, mission_event)
            if not event_commands:
                mission_turn_executed.add(turn_key)
                if bool(mission_event.get("once", True)):
                    mission_once_completed.add(mission_id)
                continue

            events.append(
                {
                    "event_id": f"ev_mission_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "mission_event",
                    "payload": {
                        "id": mission_id,
                        "trigger": str(mission_event.get("trigger") or "turn_start"),
                        "branch": branch,
                        "command_count": len(event_commands),
                    },
                }
            )
            ran_mission_event = True
            mission_turn_executed.add(turn_key)
            if bool(mission_event.get("once", True)):
                mission_once_completed.add(mission_id)

            for raw_command in event_commands:
                mission_command = _mission_command(raw_command, state.active_unit_id)
                try:
                    mission_command = _materialize_content_entry_command(
                        mission_command,
                        content_context,
                    )
                    state, new_events = apply_command(state=state, command=mission_command, rng=rng)
                except ReductionError as exc:
                    events.append(
                        {
                            "event_id": f"ev_error_{step_counter:04d}",
                            "round": state.round_number,
                            "active_unit": state.active_unit_id,
                            "type": "command_error",
                            "payload": {"command": mission_command, "error": str(exc)},
                        }
                    )
                    stop_reason = "command_error"
                    ended = True
                    break
                events.extend(new_events)
                step_counter += 1
                auto_executed += 1

                ended, objective_statuses = _check_battle_end(
                    events=events,
                    state=state,
                    objectives=objectives,
                    objective_statuses=objective_statuses,
                    step_counter=step_counter,
                )
                if ended:
                    stop_reason = "battle_end"
                    break

            if ended:
                break

        if ended:
            break
        if ran_mission_event:
            continue

        for routine in routines_by_unit.get(active_unit_id, []):
            routine_id = str(routine.get("id"))
            turn_key = (state.round_number, state.turn_index, routine_id)
            if turn_key in routine_turn_executed:
                continue
            if not _routine_eligible(state, routine, routine_once_completed, routine_use_counts):
                continue

            routine_cmd = _routine_command(active_unit_id, routine)
            try:
                state, new_events = apply_command(state=state, command=routine_cmd, rng=rng)
            except ReductionError as exc:
                events.append(
                    {
                        "event_id": f"ev_error_{step_counter:04d}",
                        "round": state.round_number,
                        "active_unit": state.active_unit_id,
                        "type": "command_error",
                        "payload": {"command": routine_cmd, "error": str(exc)},
                    }
                )
                stop_reason = "command_error"
                ended = True
                break

            events.extend(new_events)
            step_counter += 1
            auto_executed += 1
            ran_routine = True
            routine_turn_executed.add(turn_key)
            routine_use_counts[routine_id] = routine_use_counts.get(routine_id, 0) + 1
            if bool(routine.get("once", False)):
                routine_once_completed.add(routine_id)

            ended, objective_statuses = _check_battle_end(
                events=events,
                state=state,
                objectives=objectives,
                objective_statuses=objective_statuses,
                step_counter=step_counter,
            )
            if ended:
                stop_reason = "battle_end"
                break

            if bool(routine.get("auto_end_turn", True)) and state.active_unit_id == active_unit_id and state.units[active_unit_id].alive:
                end_turn_cmd = {"type": "end_turn", "actor": active_unit_id}
                try:
                    state, new_events = apply_command(state=state, command=end_turn_cmd, rng=rng)
                except ReductionError as exc:
                    events.append(
                        {
                            "event_id": f"ev_error_{step_counter:04d}",
                            "round": state.round_number,
                            "active_unit": state.active_unit_id,
                            "type": "command_error",
                            "payload": {"command": end_turn_cmd, "error": str(exc)},
                        }
                    )
                    stop_reason = "command_error"
                    ended = True
                    break
                events.extend(new_events)
                step_counter += 1
                auto_executed += 1
                ended, objective_statuses = _check_battle_end(
                    events=events,
                    state=state,
                    objectives=objectives,
                    objective_statuses=objective_statuses,
                    step_counter=step_counter,
                )
                if ended:
                    stop_reason = "battle_end"
                    break

        if ended:
            break
        if ran_routine:
            continue
        if command_index >= len(commands):
            if not bool(enemy_policy.get("enabled", False)):
                break

            policy_actor_id = state.active_unit_id
            policy_cmd_raw = _enemy_policy_command(state, enemy_policy)
            try:
                policy_cmd = _materialize_content_entry_command(policy_cmd_raw, content_context)
            except ReductionError as exc:
                events.append(
                    {
                        "event_id": f"ev_error_{step_counter:04d}",
                        "round": state.round_number,
                        "active_unit": state.active_unit_id,
                        "type": "command_error",
                        "payload": {"command": policy_cmd_raw, "error": str(exc)},
                    }
                )
                stop_reason = "command_error"
                break
            events.append(
                {
                    "event_id": f"ev_policy_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "enemy_policy_decision",
                    "payload": {"command": policy_cmd},
                }
            )

            try:
                state, new_events = apply_command(state=state, command=policy_cmd, rng=rng)
            except ReductionError:
                if policy_cmd.get("type") != "end_turn":
                    fallback = {"type": "end_turn", "actor": state.active_unit_id}
                    try:
                        state, new_events = apply_command(state=state, command=fallback, rng=rng)
                        policy_cmd = fallback
                    except ReductionError as exc:
                        events.append(
                            {
                                "event_id": f"ev_error_{step_counter:04d}",
                                "round": state.round_number,
                                "active_unit": state.active_unit_id,
                                "type": "command_error",
                                "payload": {"command": fallback, "error": str(exc)},
                            }
                        )
                        stop_reason = "command_error"
                        break
                else:
                    events.append(
                        {
                            "event_id": f"ev_error_{step_counter:04d}",
                            "round": state.round_number,
                            "active_unit": state.active_unit_id,
                            "type": "command_error",
                            "payload": {"command": policy_cmd, "error": "enemy_policy_failed"},
                        }
                    )
                    stop_reason = "command_error"
                    break

            events.extend(new_events)
            auto_executed += 1
            step_counter += 1

            ended, objective_statuses = _check_battle_end(
                events=events,
                state=state,
                objectives=objectives,
                objective_statuses=objective_statuses,
                step_counter=step_counter,
            )
            if ended:
                stop_reason = "battle_end"
                continue

            if (
                bool(enemy_policy.get("auto_end_turn", True))
                and policy_cmd.get("type") != "end_turn"
                and state.active_unit_id == policy_actor_id
                and state.units[policy_actor_id].alive
            ):
                end_turn_cmd = {"type": "end_turn", "actor": policy_actor_id}
                try:
                    state, end_events = apply_command(state=state, command=end_turn_cmd, rng=rng)
                except ReductionError as exc:
                    events.append(
                        {
                            "event_id": f"ev_error_{step_counter:04d}",
                            "round": state.round_number,
                            "active_unit": state.active_unit_id,
                            "type": "command_error",
                            "payload": {"command": end_turn_cmd, "error": str(exc)},
                        }
                    )
                    stop_reason = "command_error"
                    break
                events.extend(end_events)
                auto_executed += 1
                step_counter += 1

                ended, objective_statuses = _check_battle_end(
                    events=events,
                    state=state,
                    objectives=objectives,
                    objective_statuses=objective_statuses,
                    step_counter=step_counter,
                )
                if ended:
                    stop_reason = "battle_end"
            continue

        cmd = commands[command_index]
        try:
            command_for_turn = _materialize_content_entry_command(cmd, content_context)
        except ReductionError as exc:
            events.append(
                {
                    "event_id": f"ev_error_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "command_error",
                    "payload": {"command": cmd, "error": str(exc)},
                }
            )
            stop_reason = "command_error"
            break
        if command_for_turn["actor"] != state.active_unit_id:
            events.append(
                {
                    "event_id": f"ev_error_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "command_error",
                    "payload": {
                        "command": command_for_turn,
                        "error": f"actor {command_for_turn['actor']} is not active unit {state.active_unit_id}",
                    },
                }
            )
            stop_reason = "command_error"
            break

        try:
            state, new_events = apply_command(state=state, command=command_for_turn, rng=rng)
        except ReductionError as exc:
            events.append(
                {
                    "event_id": f"ev_error_{step_counter:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "command_error",
                    "payload": {"command": command_for_turn, "error": str(exc)},
                }
            )
            stop_reason = "command_error"
            break
        events.extend(new_events)
        command_index += 1
        scripted_executed += 1
        step_counter += 1

        ended, objective_statuses = _check_battle_end(
            events=events,
            state=state,
            objectives=objectives,
            objective_statuses=objective_statuses,
            step_counter=step_counter,
        )
        if ended:
            stop_reason = "battle_end"

    if not ended and step_counter >= max_steps:
        stop_reason = "max_steps"

    result = {
        "battle_id": state.battle_id,
        "seed": state.seed,
        "engine_phase": engine_phase,
        "executed_commands": scripted_executed,
        "auto_executed_commands": auto_executed,
        "stop_reason": stop_reason,
        "event_count": len(events),
        "replay_hash": replay_hash(events),
        "final_state": _state_snapshot(state),
        "content_pack_context": {
            "selected_pack_id": content_context.get("selected_pack_id"),
            "packs": list(content_context.get("packs", [])),
            "entry_lookup": dict(content_context.get("entry_lookup", {})),
        },
        "events": events,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", type=Path, help="Scenario JSON file")
    parser.add_argument("--out", type=Path, default=None, help="Optional output JSON path")
    args = parser.parse_args()

    result = run_scenario_file(args.scenario)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
