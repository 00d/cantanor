"""Deterministic battle reducer."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Dict, List, Tuple

from engine.core.commands import Command
from engine.core.ids import event_id
from engine.core.rng import DeterministicRNG
from engine.core.state import BattleState, EffectState, UnitState
from engine.core.turn_order import build_turn_order
from engine.core.turn_order import next_turn_index
from engine.effects.lifecycle import on_apply, process_timing
from engine.grid.areas import cone_points, line_points, radius_points
from engine.grid.map import in_bounds, is_blocked, is_occupied
from engine.grid.loe import cover_ac_bonus_for_units, cover_grade_for_units, has_tile_line_of_effect
from engine.grid.los import has_line_of_sight
from engine.grid.movement import can_step_to
from engine.io.effect_model_loader import DEFAULT_EFFECT_MODEL_PATH, lookup_hazard_source
from engine.rules.checks import resolve_check
from engine.rules.conditions import apply_condition, condition_is_immune, normalize_condition_name
from engine.rules.damage import apply_damage_modifiers, apply_damage_to_pool, roll_damage
from engine.rules.saves import SaveProfile, basic_save_multiplier, resolve_save


class ReductionError(ValueError):
    pass


def _append_event(events: List[dict], state: BattleState, event_type: str, payload: dict) -> None:
    state.event_sequence += 1
    events.append(
        {
            "event_id": event_id(state.event_sequence),
            "round": state.round_number,
            "active_unit": state.active_unit_id,
            "type": event_type,
            "payload": payload,
        }
    )


def _assert_actor_turn(state: BattleState, actor_id: str) -> None:
    if state.active_unit_id != actor_id:
        raise ReductionError(f"actor {actor_id} is not active unit {state.active_unit_id}")


def _advance_turn(state: BattleState) -> None:
    size = len(state.turn_order)
    if size == 0:
        return

    start = state.turn_index
    while True:
        nxt = next_turn_index(state.turn_index, size)
        if nxt <= state.turn_index:
            state.round_number += 1
        state.turn_index = nxt
        unit = state.units[state.active_unit_id]
        if unit.alive:
            unit.actions_remaining = 3
            unit.reaction_available = True
            return
        if state.turn_index == start:
            return


def _emit_lifecycle_events(events: List[dict], state: BattleState, lifecycle_events: List[Tuple[str, dict]]) -> None:
    for event_type, payload in lifecycle_events:
        _append_event(events, state, event_type, payload)


def _unit_save_profile(state: BattleState, unit_id: str) -> SaveProfile:
    unit = state.units[unit_id]
    return SaveProfile(
        fortitude=unit.fortitude,
        reflex=unit.reflex,
        will=unit.will,
    )


def _new_effect_id(state: BattleState) -> str:
    return f"eff_{len(state.effects) + 1:04d}"


def _alive_unit_ids(state: BattleState) -> List[str]:
    return [u.unit_id for u in state.units.values() if u.alive]


def _enemy_unit_ids(state: BattleState, actor_id: str) -> List[str]:
    actor = state.units[actor_id]
    return [u.unit_id for u in state.units.values() if u.alive and u.unit_id != actor_id and u.team != actor.team]


def _nearest_enemy_unit_id(state: BattleState, actor_id: str) -> str | None:
    actor = state.units[actor_id]
    enemies = [u for u in state.units.values() if u.alive and u.unit_id != actor_id and u.team != actor.team]
    if not enemies:
        return None
    nearest = sorted(enemies, key=lambda u: (abs(u.x - actor.x) + abs(u.y - actor.y), u.unit_id))[0]
    return nearest.unit_id


def _tiles_from_feet(feet: int) -> int:
    return max(1, (feet + 4) // 5)


def _units_within_radius_feet(
    state: BattleState,
    center_x: int,
    center_y: int,
    radius_feet: int,
    include_actor_id: str | None = None,
) -> List[str]:
    radius_tiles = _tiles_from_feet(radius_feet)
    area = set(radius_points(center_x, center_y, radius_tiles))
    out: List[str] = []
    for unit in state.units.values():
        if not unit.alive:
            continue
        if include_actor_id is not None and unit.unit_id == include_actor_id:
            continue
        if (unit.x, unit.y) in area:
            out.append(unit.unit_id)
    return out


def _nearest_open_tile(state: BattleState, x: int, y: int) -> tuple[int, int] | None:
    tiles = [
        (tx, ty)
        for tx in range(state.battle_map.width)
        for ty in range(state.battle_map.height)
    ]
    for tx, ty in sorted(tiles, key=lambda p: (abs(p[0] - x) + abs(p[1] - y), p[1], p[0])):
        if not in_bounds(state, tx, ty):
            continue
        if is_blocked(state, tx, ty):
            continue
        if is_occupied(state, tx, ty):
            continue
        return tx, ty
    return None


def _units_in_cone_feet(
    state: BattleState,
    actor_id: str,
    facing_x: int,
    facing_y: int,
    size_feet: int,
) -> List[str]:
    actor = state.units[actor_id]
    area = set(
        cone_points(
            origin_x=actor.x,
            origin_y=actor.y,
            facing_x=facing_x,
            facing_y=facing_y,
            length_tiles=_tiles_from_feet(size_feet),
        )
    )
    return [
        u.unit_id
        for u in state.units.values()
        if u.alive and u.unit_id != actor_id and (u.x, u.y) in area
    ]


def _choose_model_targets(
    state: BattleState,
    actor_id: str,
    effects: List[dict],
    explicit_target_id: str | None,
    center_x: int | None,
    center_y: int | None,
) -> List[str]:
    actor = state.units[actor_id]

    if explicit_target_id:
        target = state.units.get(explicit_target_id)
        if target is None or not target.alive:
            return []
        if not has_tile_line_of_effect(state, actor.x, actor.y, target.x, target.y):
            return []
        return [explicit_target_id]

    area_effects = [e for e in effects if e.get("kind") == "area"]
    if area_effects and center_x is not None and center_y is not None:
        area = area_effects[0]
        if area.get("size_miles") is not None:
            return [uid for uid in _alive_unit_ids(state) if uid != actor_id]
        size_feet = int(area.get("size_feet", 5))
        shape = str(area.get("shape", "within_radius"))
        if shape == "line":
            # For line effects, clipping stops at the first blocked tile.
            blocked = set(state.battle_map.blocked)
            pts: List[tuple[int, int]] = []
            for idx, (x, y) in enumerate(line_points(actor.x, actor.y, center_x, center_y)):
                if idx == 0:
                    continue
                if (x, y) in blocked:
                    break
                pts.append((x, y))
            pts_set = set(pts)
            return [u.unit_id for u in state.units.values() if u.alive and u.unit_id != actor_id and (u.x, u.y) in pts_set]
        if shape == "cone":
            candidates = _units_in_cone_feet(
                state=state,
                actor_id=actor_id,
                facing_x=center_x,
                facing_y=center_y,
                size_feet=size_feet,
            )
            return [
                uid
                for uid in candidates
                if has_tile_line_of_effect(state, actor.x, actor.y, state.units[uid].x, state.units[uid].y)
            ]
        if shape in ("within_radius", "burst", "radius", "emanation"):
            candidates = _units_within_radius_feet(
                state=state,
                center_x=center_x,
                center_y=center_y,
                radius_feet=size_feet,
                include_actor_id=actor_id,
            )
            return [
                uid
                for uid in candidates
                if has_tile_line_of_effect(state, center_x, center_y, state.units[uid].x, state.units[uid].y)
            ]
        candidates = _units_within_radius_feet(
            state=state,
            center_x=center_x,
            center_y=center_y,
            radius_feet=size_feet,
            include_actor_id=actor_id,
        )
        return [
            uid
            for uid in candidates
            if has_tile_line_of_effect(state, center_x, center_y, state.units[uid].x, state.units[uid].y)
        ]

    # Default: all alive non-actor units.
    return [
        uid
        for uid in _alive_unit_ids(state)
        if uid != actor_id and has_tile_line_of_effect(state, actor.x, actor.y, state.units[uid].x, state.units[uid].y)
    ]


def _duration_to_rounds(maximum_duration: object) -> int | None:
    if not isinstance(maximum_duration, dict):
        return None
    amount = int(maximum_duration.get("amount") or 0)
    unit = str(maximum_duration.get("unit") or "")
    if amount <= 0:
        return None
    if unit == "round":
        return amount
    if unit == "minute":
        return amount * 10
    if unit == "hour":
        return amount * 600
    if unit == "day":
        return amount * 14400
    return None


def _infer_persistent_affliction_conditions(affliction_event: dict) -> List[str]:
    raw = str(affliction_event.get("raw_fragment") or "")
    out: set[str] = set()
    for m in re.finditer(r"Any\s+([a-zA-Z ]+?)\s+condition\s+[^.;]*\bpersists\b", raw, flags=re.IGNORECASE):
        out.add(m.group(1).strip().lower().replace(" ", "_"))
    return sorted(out)


def _apply_modeled_effects_to_target(
    state: BattleState,
    rng: DeterministicRNG,
    actor_id: str,
    target_id: str,
    effects: List[dict],
    source_label: str | None = None,
) -> Tuple[dict, List[Tuple[str, dict]]]:
    target = state.units[target_id]
    save_event = next((e for e in effects if e.get("kind") == "save_check"), None)
    damage_event = next((e for e in effects if e.get("kind") == "damage" and e.get("formula")), None)
    affliction_event = next((e for e in effects if e.get("kind") == "affliction"), None)
    condition_events = [e for e in effects if e.get("kind") == "apply_condition"]
    death_events = [e for e in effects if e.get("kind") in ("instant_death", "special_lethality")]
    transform_events = [e for e in effects if e.get("kind") == "transform"]
    teleport_events = [e for e in effects if e.get("kind") == "teleport"]

    lifecycle_events: List[Tuple[str, dict]] = []
    save_detail = None
    damage_detail = None
    should_apply_secondary = True

    if affliction_event is not None:
        aff_save_cfg = affliction_event.get("save")
        if not isinstance(aff_save_cfg, dict):
            aff_save_cfg = {}
        dc = int(aff_save_cfg.get("dc") or (save_event.get("dc") if save_event else 0))
        save_type = str(aff_save_cfg.get("save_type") or (save_event.get("save_type") if save_event else "Fortitude"))
        save_degree = "failure"
        if dc > 0:
            save = resolve_save(
                rng=rng,
                save_type=save_type,
                profile=_unit_save_profile(state, target_id),
                dc=dc,
            )
            save_degree = save.degree
            save_detail = {
                "dc": dc,
                "save_type": save_type,
                "mode": "affliction",
                "die": save.die,
                "modifier": save.modifier,
                "total": save.total,
                "degree": save.degree,
            }

        contracted = save_degree in ("failure", "critical_failure")
        affliction_detail = {
            "contracted": contracted,
            "effect_id": None,
            "initial_stage": None,
            "maximum_duration_rounds": None,
        }
        if contracted:
            stage_values = [
                int(stage.get("stage"))
                for stage in affliction_event.get("stages", [])
                if isinstance(stage, dict) and stage.get("stage") is not None
            ]
            max_stage = max(stage_values or [1])
            initial_stage = 1
            if save_degree == "critical_failure":
                initial_stage = min(2, max_stage)

            duration_rounds = _duration_to_rounds(affliction_event.get("maximum_duration"))
            effect = EffectState(
                effect_id=_new_effect_id(state),
                kind="affliction",
                source_unit_id=actor_id,
                target_unit_id=target_id,
                payload={
                    "name": source_label or "modeled_affliction",
                    "save": {"dc": dc, "save_type": save_type} if dc > 0 else deepcopy(aff_save_cfg),
                    "maximum_duration": deepcopy(affliction_event.get("maximum_duration")),
                    "stages": deepcopy(affliction_event.get("stages", [])),
                    "current_stage": initial_stage,
                    "persistent_conditions": _infer_persistent_affliction_conditions(affliction_event),
                },
                duration_rounds=duration_rounds,
                tick_timing="turn_end",
            )
            state.effects[effect.effect_id] = effect
            lifecycle_events.extend(on_apply(state, effect, rng))

            affliction_detail["effect_id"] = effect.effect_id
            affliction_detail["initial_stage"] = initial_stage
            affliction_detail["maximum_duration_rounds"] = duration_rounds

        return (
            {
                "actor": actor_id,
                "target": target_id,
                "save": save_detail,
                "damage": None,
                "applied_conditions": [],
                "special_flags": [],
                "affliction": affliction_detail,
                "target_hp": target.hp,
            },
            lifecycle_events,
        )

    if save_event is not None:
        save = resolve_save(
            rng=rng,
            save_type=str(save_event["save_type"]),
            profile=_unit_save_profile(state, target_id),
            dc=int(save_event["dc"]),
        )
        save_mode = str(save_event.get("mode", "standard"))
        save_detail = {
            "dc": int(save_event["dc"]),
            "save_type": str(save_event["save_type"]),
            "mode": save_mode,
            "die": save.die,
            "modifier": save.modifier,
            "total": save.total,
            "degree": save.degree,
        }
        should_apply_secondary = save.degree in ("failure", "critical_failure")

        if damage_event is not None:
            base_roll = roll_damage(rng, str(damage_event["formula"]))
            multiplier = 1.0
            if save_mode == "basic":
                multiplier = basic_save_multiplier(save.degree)
            elif save_mode == "negates":
                multiplier = 0.0 if save.degree in ("success", "critical_success") else 1.0
            raw_total = int(base_roll.total * multiplier)
            adjustment = apply_damage_modifiers(
                raw_total=raw_total,
                damage_type=str(damage_event.get("damage_type") or "").lower() or None,
                resistances=target.resistances,
                weaknesses=target.weaknesses,
                immunities=target.immunities,
            )
            applied_damage = apply_damage_to_pool(
                hp=target.hp,
                temp_hp=target.temp_hp,
                damage_total=adjustment.applied_total,
            )
            target.hp = applied_damage.new_hp
            target.temp_hp = applied_damage.new_temp_hp
            if target.temp_hp == 0:
                target.temp_hp_source = None
                target.temp_hp_owner_effect_id = None
            damage_detail = {
                "formula": damage_event["formula"],
                "damage_type": damage_event.get("damage_type"),
                "rolled_total": base_roll.total,
                "rolls": base_roll.rolls,
                "flat_modifier": base_roll.flat_modifier,
                "multiplier": multiplier,
                "raw_total": adjustment.raw_total,
                "immune": adjustment.immune,
                "resistance_total": adjustment.resistance_total,
                "weakness_total": adjustment.weakness_total,
                "applied_total": adjustment.applied_total,
            }
            if applied_damage.absorbed_by_temp_hp > 0:
                damage_detail["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp
    elif damage_event is not None:
        base_roll = roll_damage(rng, str(damage_event["formula"]))
        adjustment = apply_damage_modifiers(
            raw_total=base_roll.total,
            damage_type=str(damage_event.get("damage_type") or "").lower() or None,
            resistances=target.resistances,
            weaknesses=target.weaknesses,
            immunities=target.immunities,
        )
        applied_damage = apply_damage_to_pool(
            hp=target.hp,
            temp_hp=target.temp_hp,
            damage_total=adjustment.applied_total,
        )
        target.hp = applied_damage.new_hp
        target.temp_hp = applied_damage.new_temp_hp
        if target.temp_hp == 0:
            target.temp_hp_source = None
            target.temp_hp_owner_effect_id = None
        damage_detail = {
            "formula": damage_event["formula"],
            "damage_type": damage_event.get("damage_type"),
            "rolled_total": base_roll.total,
            "rolls": base_roll.rolls,
            "flat_modifier": base_roll.flat_modifier,
            "multiplier": 1.0,
            "raw_total": adjustment.raw_total,
            "immune": adjustment.immune,
            "resistance_total": adjustment.resistance_total,
            "weakness_total": adjustment.weakness_total,
            "applied_total": adjustment.applied_total,
        }
        if applied_damage.absorbed_by_temp_hp > 0:
            damage_detail["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp

    applied_conditions = []
    skipped_conditions = []
    if should_apply_secondary:
        for cond in condition_events:
            name = normalize_condition_name(str(cond.get("condition", "")))
            value = int(cond.get("value") or 1)
            if name:
                if condition_is_immune(name, target.condition_immunities):
                    skipped_conditions.append({"name": name, "value": value, "reason": "condition_immune"})
                else:
                    target.conditions = apply_condition(target.conditions, name, value)
                    applied_conditions.append({"name": name, "value": value})

    special_flags: List[str] = []
    if death_events and should_apply_secondary:
        # Conservative: apply lethality only on failed save path.
        target.hp = 0
        target.conditions = apply_condition(target.conditions, "unconscious", 1)
        for evt in death_events:
            special_flags.append(str(evt.get("kind")))
    if target.hp == 0:
        target.conditions = apply_condition(target.conditions, "unconscious", 1)

    for evt in transform_events:
        special_flags.append(f"transform:{evt.get('transform_type', 'unknown')}")
    for evt in teleport_events:
        special_flags.append(f"teleport:{evt.get('teleport_type', 'unknown')}")

    return (
        {
            "actor": actor_id,
            "target": target_id,
            "save": save_detail,
            "damage": damage_detail,
            "applied_conditions": applied_conditions,
            "skipped_conditions": skipped_conditions,
            "special_flags": special_flags,
            "affliction": None,
            "target_hp": target.hp,
        },
        lifecycle_events,
    )


def apply_command(state: BattleState, command: Command, rng: DeterministicRNG) -> Tuple[BattleState, List[dict]]:
    next_state = deepcopy(state)
    events: List[dict] = []

    command_type = command["type"]
    actor_id = command["actor"]
    _assert_actor_turn(next_state, actor_id)

    actor = next_state.units[actor_id]
    if not actor.alive:
        raise ReductionError(f"actor {actor_id} is not alive")

    if command_type == "move":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")
        x = int(command["x"])
        y = int(command["y"])
        if not can_step_to(next_state, actor, x, y):
            raise ReductionError(f"illegal move target ({x}, {y})")
        old = (actor.x, actor.y)
        actor.x = x
        actor.y = y
        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "move",
            {
                "actor": actor_id,
                "from": old,
                "to": (x, y),
                "actions_remaining": actor.actions_remaining,
            },
        )
        return next_state, events

    if command_type == "strike":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")
        target_id = command["target"]
        target = next_state.units.get(target_id)
        if target is None:
            raise ReductionError(f"unknown target {target_id}")
        if not target.alive:
            raise ReductionError(f"target {target_id} is not alive")
        if not has_line_of_sight(next_state, actor, target):
            raise ReductionError(f"no line of sight from {actor_id} to {target_id}")

        cover_grade = cover_grade_for_units(next_state, actor, target)
        cover_bonus = cover_ac_bonus_for_units(next_state, actor, target)
        effective_ac = target.ac + cover_bonus
        check = resolve_check(rng=rng, modifier=actor.attack_mod, dc=effective_ac)
        multiplier = 0
        if check.degree == "critical_success":
            multiplier = 2
        elif check.degree == "success":
            multiplier = 1

        damage_total = 0
        damage_detail = None
        if multiplier > 0:
            dmg = roll_damage(rng, actor.damage, multiplier=multiplier)
            adjustment = apply_damage_modifiers(
                raw_total=dmg.total,
                damage_type=actor.attack_damage_type,
                resistances=target.resistances,
                weaknesses=target.weaknesses,
                immunities=target.immunities,
            )
            damage_total = adjustment.applied_total
            damage_detail = {
                "formula": actor.damage,
                "damage_type": actor.attack_damage_type,
                "rolls": dmg.rolls,
                "flat_modifier": dmg.flat_modifier,
                "multiplier": multiplier,
                "raw_total": adjustment.raw_total,
                "immune": adjustment.immune,
                "resistance_total": adjustment.resistance_total,
                "weakness_total": adjustment.weakness_total,
                "total": damage_total,
            }
            applied_damage = apply_damage_to_pool(
                hp=target.hp,
                temp_hp=target.temp_hp,
                damage_total=damage_total,
            )
            target.hp = applied_damage.new_hp
            target.temp_hp = applied_damage.new_temp_hp
            if target.temp_hp == 0:
                target.temp_hp_source = None
                target.temp_hp_owner_effect_id = None
            if applied_damage.absorbed_by_temp_hp > 0:
                damage_detail["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp
            if target.hp == 0:
                target.conditions = apply_condition(target.conditions, "unconscious", 1)

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "strike",
            {
                "actor": actor_id,
                "target": target_id,
                "degree": check.degree,
                "roll": {
                    "die": check.die,
                    "modifier": check.modifier,
                    "total": check.total,
                    "base_dc": target.ac,
                    "cover_grade": cover_grade,
                    "cover_bonus": cover_bonus,
                    "dc": check.dc,
                },
                "damage": damage_detail,
                "target_hp": target.hp,
                "actions_remaining": actor.actions_remaining,
            },
        )
        return next_state, events

    if command_type == "end_turn":
        _append_event(
            events,
            next_state,
            "end_turn",
            {
                "actor": actor_id,
                "actions_remaining": actor.actions_remaining,
            },
        )
        _emit_lifecycle_events(events, next_state, process_timing(next_state, rng, "turn_end"))
        _advance_turn(next_state)
        _append_event(
            events,
            next_state,
            "turn_start",
            {
                "active_unit": next_state.active_unit_id,
                "round": next_state.round_number,
            },
        )
        _emit_lifecycle_events(events, next_state, process_timing(next_state, rng, "turn_start"))
        return next_state, events

    if command_type == "save_damage":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")
        target_id = command["target"]
        target = next_state.units.get(target_id)
        if target is None:
            raise ReductionError(f"unknown target {target_id}")
        if not target.alive:
            raise ReductionError(f"target {target_id} is not alive")

        dc = int(command["dc"])
        save_type = command["save_type"]
        damage_formula = str(command["damage"])
        damage_type = str(command.get("damage_type") or "").lower() or None
        mode = command.get("mode", "basic")
        if mode != "basic":
            raise ReductionError(f"unsupported save_damage mode: {mode}")

        save = resolve_save(
            rng=rng,
            save_type=save_type,
            profile=_unit_save_profile(next_state, target_id),
            dc=dc,
        )
        multiplier = basic_save_multiplier(save.degree)
        damage_roll = roll_damage(rng, damage_formula)
        raw_total = int(damage_roll.total * multiplier)
        adjustment = apply_damage_modifiers(
            raw_total=raw_total,
            damage_type=damage_type,
            resistances=target.resistances,
            weaknesses=target.weaknesses,
            immunities=target.immunities,
        )
        damage_total = adjustment.applied_total
        applied_damage = apply_damage_to_pool(
            hp=target.hp,
            temp_hp=target.temp_hp,
            damage_total=damage_total,
        )
        target.hp = applied_damage.new_hp
        target.temp_hp = applied_damage.new_temp_hp
        if target.temp_hp == 0:
            target.temp_hp_source = None
            target.temp_hp_owner_effect_id = None
        if target.hp == 0:
            target.conditions = apply_condition(target.conditions, "unconscious", 1)

        damage_payload = {
            "formula": damage_formula,
            "damage_type": damage_type,
            "rolled_total": damage_roll.total,
            "rolls": damage_roll.rolls,
            "flat_modifier": damage_roll.flat_modifier,
            "multiplier": multiplier,
            "raw_total": adjustment.raw_total,
            "immune": adjustment.immune,
            "resistance_total": adjustment.resistance_total,
            "weakness_total": adjustment.weakness_total,
            "applied_total": damage_total,
        }
        if applied_damage.absorbed_by_temp_hp > 0:
            damage_payload["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "save_damage",
            {
                "actor": actor_id,
                "target": target_id,
                "save_type": save_type,
                "mode": mode,
                "roll": {
                    "die": save.die,
                    "modifier": save.modifier,
                    "total": save.total,
                    "dc": save.dc,
                    "degree": save.degree,
                },
                "damage": damage_payload,
                "target_hp": target.hp,
                "actions_remaining": actor.actions_remaining,
            },
        )
        return next_state, events

    if command_type == "area_save_damage":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")

        center_x = int(command["center_x"])
        center_y = int(command["center_y"])
        radius_feet = int(command["radius_feet"])
        dc = int(command["dc"])
        save_type = str(command["save_type"])
        damage_formula = str(command["damage"])
        damage_type = str(command.get("damage_type") or "").lower() or None
        mode = command.get("mode", "basic")
        if mode != "basic":
            raise ReductionError(f"unsupported area_save_damage mode: {mode}")

        include_actor = bool(command.get("include_actor", False))
        excluded = None if include_actor else actor_id
        targets = _units_within_radius_feet(
            state=next_state,
            center_x=center_x,
            center_y=center_y,
            radius_feet=radius_feet,
            include_actor_id=excluded,
        )
        targets = [
            uid
            for uid in targets
            if has_tile_line_of_effect(next_state, center_x, center_y, next_state.units[uid].x, next_state.units[uid].y)
        ]

        resolutions = []
        for target_id in targets:
            save = resolve_save(
                rng=rng,
                save_type=save_type,
                profile=_unit_save_profile(next_state, target_id),
                dc=dc,
            )
            multiplier = basic_save_multiplier(save.degree)
            roll = roll_damage(rng, damage_formula)
            raw_total = int(roll.total * multiplier)
            target = next_state.units[target_id]
            adjustment = apply_damage_modifiers(
                raw_total=raw_total,
                damage_type=damage_type,
                resistances=target.resistances,
                weaknesses=target.weaknesses,
                immunities=target.immunities,
            )
            applied = adjustment.applied_total
            applied_damage = apply_damage_to_pool(
                hp=target.hp,
                temp_hp=target.temp_hp,
                damage_total=applied,
            )
            target.hp = applied_damage.new_hp
            target.temp_hp = applied_damage.new_temp_hp
            if target.temp_hp == 0:
                target.temp_hp_source = None
                target.temp_hp_owner_effect_id = None
            if target.hp == 0:
                target.conditions = apply_condition(target.conditions, "unconscious", 1)
            damage_payload = {
                "formula": damage_formula,
                "damage_type": damage_type,
                "rolled_total": roll.total,
                "rolls": roll.rolls,
                "flat_modifier": roll.flat_modifier,
                "multiplier": multiplier,
                "raw_total": adjustment.raw_total,
                "immune": adjustment.immune,
                "resistance_total": adjustment.resistance_total,
                "weakness_total": adjustment.weakness_total,
                "applied_total": applied,
            }
            if applied_damage.absorbed_by_temp_hp > 0:
                damage_payload["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp
            resolutions.append(
                {
                    "target": target_id,
                    "save": {
                        "dc": dc,
                        "save_type": save_type,
                        "mode": mode,
                        "die": save.die,
                        "modifier": save.modifier,
                        "total": save.total,
                        "degree": save.degree,
                    },
                    "damage": damage_payload,
                    "target_hp": target.hp,
                }
            )

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "area_save_damage",
            {
                "actor": actor_id,
                "center": [center_x, center_y],
                "radius_feet": radius_feet,
                "save_type": save_type,
                "dc": dc,
                "mode": mode,
                "damage_formula": damage_formula,
                "targets": targets,
                "resolutions": resolutions,
                "actions_remaining": actor.actions_remaining,
            },
        )
        return next_state, events

    if command_type == "set_flag":
        flag = str(command["flag"])
        value = bool(command.get("value", True))
        next_state.flags[flag] = value
        _append_event(
            events,
            next_state,
            "set_flag",
            {
                "actor": actor_id,
                "flag": flag,
                "value": value,
            },
        )
        return next_state, events

    if command_type == "spawn_unit":
        unit_raw = dict(command.get("unit") or {})
        unit_id = str(unit_raw.get("id") or "")
        if not unit_id:
            raise ReductionError("spawn_unit requires unit.id")
        if unit_id in next_state.units:
            raise ReductionError(f"cannot spawn duplicate unit id: {unit_id}")

        if "position" not in unit_raw or not isinstance(unit_raw["position"], list) or len(unit_raw["position"]) != 2:
            raise ReductionError("spawn_unit unit.position must be [x, y]")

        spawn_x = int(unit_raw["position"][0])
        spawn_y = int(unit_raw["position"][1])
        policy = str(command.get("placement_policy") or "exact")
        if policy == "nearest_open":
            placement = _nearest_open_tile(next_state, spawn_x, spawn_y)
            if placement is None:
                raise ReductionError("spawn_unit found no open tile for nearest_open placement")
            spawn_x, spawn_y = placement
        elif policy == "exact":
            if not in_bounds(next_state, spawn_x, spawn_y):
                raise ReductionError(f"spawn position out of bounds: ({spawn_x}, {spawn_y})")
            if is_blocked(next_state, spawn_x, spawn_y):
                raise ReductionError(f"spawn position blocked: ({spawn_x}, {spawn_y})")
            if is_occupied(next_state, spawn_x, spawn_y):
                raise ReductionError(f"spawn position occupied: ({spawn_x}, {spawn_y})")
        else:
            raise ReductionError(f"unsupported spawn placement policy: {policy}")

        hp = int(unit_raw.get("hp") or 0)
        if hp <= 0:
            raise ReductionError("spawn_unit unit.hp must be > 0")
        temp_hp = int(unit_raw.get("temp_hp", 0))
        if temp_hp < 0:
            raise ReductionError("spawn_unit unit.temp_hp must be >= 0")

        spawned = UnitState(
            unit_id=unit_id,
            team=str(unit_raw.get("team") or ""),
            hp=hp,
            max_hp=int(unit_raw.get("max_hp") or hp),
            x=spawn_x,
            y=spawn_y,
            initiative=int(unit_raw.get("initiative") or 0),
            attack_mod=int(unit_raw.get("attack_mod") or 0),
            ac=int(unit_raw.get("ac") or 10),
            damage=str(unit_raw.get("damage") or "1d1"),
            temp_hp=temp_hp,
            temp_hp_source=f"spawn:{unit_id}" if temp_hp > 0 else None,
            temp_hp_owner_effect_id=None,
            attack_damage_type=str(unit_raw.get("attack_damage_type") or "physical").lower(),
            fortitude=int(unit_raw.get("fortitude") or 0),
            reflex=int(unit_raw.get("reflex") or 0),
            will=int(unit_raw.get("will") or 0),
            actions_remaining=3,
            reaction_available=True,
            conditions={str(k): int(v) for k, v in dict(unit_raw.get("conditions", {})).items()},
            condition_immunities=[str(x).lower().replace(" ", "_") for x in list(unit_raw.get("condition_immunities", []))],
            resistances={str(k).lower(): int(v) for k, v in dict(unit_raw.get("resistances", {})).items()},
            weaknesses={str(k).lower(): int(v) for k, v in dict(unit_raw.get("weaknesses", {})).items()},
            immunities=[str(x).lower() for x in list(unit_raw.get("immunities", []))],
        )
        if not spawned.team:
            raise ReductionError("spawn_unit unit.team is required")

        active_unit_id = next_state.active_unit_id
        next_state.units[unit_id] = spawned
        next_state.turn_order = build_turn_order(next_state.units)
        next_state.turn_index = next_state.turn_order.index(active_unit_id)

        spend_action = bool(command.get("spend_action", False))
        if spend_action:
            if actor.actions_remaining <= 0:
                raise ReductionError("actor has no actions remaining")
            actor.actions_remaining -= 1

        _append_event(
            events,
            next_state,
            "spawn_unit",
            {
                "actor": actor_id,
                "unit_id": unit_id,
                "team": spawned.team,
                "position": [spawned.x, spawned.y],
                "placement_policy": policy,
                "spend_action": spend_action,
                "actions_remaining": actor.actions_remaining,
            },
        )
        return next_state, events

    if command_type == "run_hazard_routine":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")

        hazard_id = str(command["hazard_id"])
        source_name = str(command["source_name"])
        source_type = str(command.get("source_type") or "trigger_action")
        model_path = str(command.get("model_path") or DEFAULT_EFFECT_MODEL_PATH)
        policy = str(command.get("target_policy") or "nearest_enemy")

        center_x = command.get("center_x")
        center_y = command.get("center_y")
        explicit_target = command.get("target")

        if policy == "nearest_enemy":
            explicit_target = _nearest_enemy_unit_id(next_state, actor_id)
        elif policy == "nearest_enemy_area_center":
            nearest_id = _nearest_enemy_unit_id(next_state, actor_id)
            explicit_target = None
            if nearest_id is not None:
                nearest = next_state.units[nearest_id]
                center_x = nearest.x
                center_y = nearest.y
        elif policy == "explicit":
            pass
        elif policy == "all_enemies":
            explicit_target = None
        elif policy == "as_configured":
            pass
        else:
            raise ReductionError(f"unsupported target policy: {policy}")

        try:
            source = lookup_hazard_source(
                hazard_id=hazard_id,
                source_name=source_name,
                source_type=source_type,
                model_path=model_path,
            )
        except KeyError as exc:
            raise ReductionError(str(exc)) from exc

        effects = list(source.get("effects", []))
        target_ids = _choose_model_targets(
            state=next_state,
            actor_id=actor_id,
            effects=effects,
            explicit_target_id=explicit_target,
            center_x=int(center_x) if center_x is not None else None,
            center_y=int(center_y) if center_y is not None else None,
        )
        if policy == "all_enemies":
            actor_team = next_state.units[actor_id].team
            target_ids = [uid for uid in target_ids if next_state.units[uid].team != actor_team]

        per_target = []
        lifecycle_events: List[Tuple[str, dict]] = []
        for target_id in target_ids:
            if target_id not in next_state.units or not next_state.units[target_id].alive:
                continue
            result, target_events = _apply_modeled_effects_to_target(
                state=next_state,
                rng=rng,
                actor_id=actor_id,
                target_id=target_id,
                effects=effects,
                source_label=f"{hazard_id}:{source_name}",
            )
            per_target.append(result)
            lifecycle_events.extend(target_events)

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "run_hazard_routine",
            {
                "actor": actor_id,
                "hazard_id": hazard_id,
                "source_type": source_type,
                "source_name": source_name,
                "target_policy": policy,
                "center": [center_x, center_y] if center_x is not None and center_y is not None else None,
                "explicit_target": explicit_target,
                "target_ids": target_ids,
                "effect_kinds": sorted({str(e.get("kind")) for e in effects if "kind" in e}),
                "results": per_target,
                "actions_remaining": actor.actions_remaining,
            },
        )
        _emit_lifecycle_events(events, next_state, lifecycle_events)
        return next_state, events

    if command_type == "trigger_hazard_source":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")

        hazard_id = str(command["hazard_id"])
        source_name = str(command["source_name"])
        source_type = str(command.get("source_type") or "trigger_action")
        model_path = str(command.get("model_path") or DEFAULT_EFFECT_MODEL_PATH)
        center_x = command.get("center_x")
        center_y = command.get("center_y")
        explicit_target = command.get("target")

        try:
            source = lookup_hazard_source(
                hazard_id=hazard_id,
                source_name=source_name,
                source_type=source_type,
                model_path=model_path,
            )
        except KeyError as exc:
            raise ReductionError(str(exc)) from exc

        effects = list(source.get("effects", []))
        target_ids = _choose_model_targets(
            state=next_state,
            actor_id=actor_id,
            effects=effects,
            explicit_target_id=explicit_target,
            center_x=int(center_x) if center_x is not None else None,
            center_y=int(center_y) if center_y is not None else None,
        )

        per_target = []
        lifecycle_events: List[Tuple[str, dict]] = []
        for target_id in target_ids:
            if target_id not in next_state.units or not next_state.units[target_id].alive:
                continue
            result, target_events = _apply_modeled_effects_to_target(
                state=next_state,
                rng=rng,
                actor_id=actor_id,
                target_id=target_id,
                effects=effects,
                source_label=f"{hazard_id}:{source_name}",
            )
            per_target.append(result)
            lifecycle_events.extend(target_events)

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "trigger_hazard_source",
            {
                "actor": actor_id,
                "hazard_id": hazard_id,
                "source_type": source_type,
                "source_name": source_name,
                "center": [center_x, center_y] if center_x is not None and center_y is not None else None,
                "explicit_target": explicit_target,
                "target_ids": target_ids,
                "effect_kinds": sorted({str(e.get("kind")) for e in effects if "kind" in e}),
                "results": per_target,
                "actions_remaining": actor.actions_remaining,
            },
        )
        _emit_lifecycle_events(events, next_state, lifecycle_events)
        return next_state, events

    if command_type == "apply_effect":
        if actor.actions_remaining <= 0:
            raise ReductionError("actor has no actions remaining")
        target_id = command["target"]
        target = next_state.units.get(target_id)
        if target is None:
            raise ReductionError(f"unknown target {target_id}")
        if not target.alive:
            raise ReductionError(f"target {target_id} is not alive")

        effect = EffectState(
            effect_id=_new_effect_id(next_state),
            kind=str(command["effect_kind"]),
            source_unit_id=actor_id,
            target_unit_id=target_id,
            payload=dict(command.get("payload", {})),
            duration_rounds=command.get("duration_rounds"),
            tick_timing=command.get("tick_timing"),
        )
        next_state.effects[effect.effect_id] = effect

        actor.actions_remaining -= 1
        _append_event(
            events,
            next_state,
            "apply_effect_command",
            {
                "actor": actor_id,
                "target": target_id,
                "effect_id": effect.effect_id,
                "kind": effect.kind,
                "duration_rounds": effect.duration_rounds,
                "tick_timing": effect.tick_timing,
                "actions_remaining": actor.actions_remaining,
            },
        )
        _emit_lifecycle_events(events, next_state, on_apply(next_state, effect, rng))
        return next_state, events

    raise ReductionError(f"unsupported command type: {command_type}")
