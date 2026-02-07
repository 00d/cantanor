"""Effect lifecycle hooks for apply/tick/expire phases."""

from __future__ import annotations

from typing import Dict, List, Tuple

from engine.core.rng import DeterministicRNG
from engine.core.state import BattleState, EffectState
from engine.rules.checks import Degree, resolve_check
from engine.rules.conditions import apply_condition, clear_condition, condition_is_immune, normalize_condition_name
from engine.rules.damage import apply_damage_modifiers, apply_damage_to_pool, roll_damage
from engine.rules.saves import SaveProfile, resolve_save

LifecycleEvent = Tuple[str, dict]


def _unit_save_profile(state: BattleState, unit_id: str) -> SaveProfile:
    unit = state.units[unit_id]
    return SaveProfile(fortitude=unit.fortitude, reflex=unit.reflex, will=unit.will)


def _stage_by_number(stages: List[dict], stage_number: int) -> dict | None:
    for stage in stages:
        if int(stage.get("stage", 0)) == stage_number:
            return stage
    return None


def _duration_to_rounds(duration: object, default_rounds: int = 1) -> int:
    if not isinstance(duration, dict):
        return default_rounds
    amount = int(duration.get("amount") or 0)
    unit = str(duration.get("unit") or "")
    if amount <= 0:
        return default_rounds
    if unit == "round":
        return amount
    if unit == "minute":
        return amount * 10
    if unit == "hour":
        return amount * 600
    if unit == "day":
        return amount * 14400
    return default_rounds


def _apply_affliction_stage(
    state: BattleState,
    effect: EffectState,
    rng: DeterministicRNG,
    stage_number: int,
) -> dict:
    target = state.units.get(effect.target_unit_id or "")
    if target is None or not target.alive:
        return {"stage": stage_number, "applied": False, "reason": "target_missing_or_dead"}

    stages = list(effect.payload.get("stages", []))
    stage = _stage_by_number(stages, stage_number)
    if stage is None:
        return {"stage": stage_number, "applied": False, "reason": "stage_not_found", "target_hp": target.hp}

    persistent_conditions = {
        str(name).replace(" ", "_")
        for name in effect.payload.get("persistent_conditions", [])
        if str(name).strip()
    }
    old_applied = {
        str(name): int(value)
        for name, value in dict(effect.payload.get("applied_conditions", {})).items()
        if str(name).strip()
    }

    damage_results = []
    for dmg in stage.get("damage", []):
        formula = str(dmg.get("formula", ""))
        if not formula:
            continue
        roll = roll_damage(rng, formula)
        applied_damage = apply_damage_to_pool(
            hp=target.hp,
            temp_hp=target.temp_hp,
            damage_total=roll.total,
        )
        target.hp = applied_damage.new_hp
        target.temp_hp = applied_damage.new_temp_hp
        if target.temp_hp == 0:
            target.temp_hp_source = None
            target.temp_hp_owner_effect_id = None
        detail = {
            "formula": formula,
            "damage_type": dmg.get("damage_type"),
            "rolls": roll.rolls,
            "flat_modifier": roll.flat_modifier,
            "total": roll.total,
        }
        if applied_damage.absorbed_by_temp_hp > 0:
            detail["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp
        damage_results.append(detail)

    stage_condition_values: Dict[str, int] = {}
    applied_conditions = []
    skipped_conditions = []
    for cond in stage.get("conditions", []):
        name = normalize_condition_name(str(cond.get("condition", "")))
        if not name:
            continue
        value = int(cond.get("value") or 1)
        if condition_is_immune(name, target.condition_immunities):
            skipped_conditions.append({"name": name, "value": value, "reason": "condition_immune"})
            continue
        old_value = old_applied.get(name)
        current = int(target.conditions.get(name, 0))
        if old_value is not None and current == old_value:
            target.conditions[name] = value
        else:
            target.conditions = apply_condition(target.conditions, name, value)
        stage_condition_values[name] = value
        applied_conditions.append({"name": name, "value": value})

    cleared_conditions = []
    for name, old_value in old_applied.items():
        if name in stage_condition_values:
            continue
        if name in persistent_conditions:
            continue
        if int(target.conditions.get(name, 0)) == old_value:
            target.conditions = clear_condition(target.conditions, name)
            cleared_conditions.append(name)

    # Track only this affliction's current contribution.
    tracked_applied: Dict[str, int] = dict(stage_condition_values)
    for name in persistent_conditions:
        if name in old_applied and int(target.conditions.get(name, 0)) == old_applied[name]:
            tracked_applied[name] = old_applied[name]
    effect.payload["applied_conditions"] = tracked_applied
    stage_rounds = _duration_to_rounds(stage.get("duration"), default_rounds=1)
    effect.payload["stage_rounds_remaining"] = stage_rounds

    if target.hp == 0:
        target.conditions = apply_condition(target.conditions, "unconscious", 1)

    return {
        "stage": stage_number,
        "applied": True,
        "damage": damage_results,
        "conditions": applied_conditions,
        "skipped_conditions": skipped_conditions,
        "cleared_conditions": cleared_conditions,
        "stage_rounds": stage_rounds,
        "target_hp": target.hp,
    }


def _affliction_delta(degree: Degree) -> int:
    if degree == "critical_success":
        return -2
    if degree == "success":
        return -1
    if degree == "failure":
        return 1
    return 2


def _on_affliction_tick(state: BattleState, effect: EffectState, rng: DeterministicRNG) -> List[LifecycleEvent]:
    target = state.units.get(effect.target_unit_id or "")
    if target is None or not target.alive:
        return []

    current_stage = int(effect.payload.get("current_stage") or 1)
    stages = list(effect.payload.get("stages", []))
    max_stage = max([int(s.get("stage", 0)) for s in stages] or [current_stage])
    stage_rounds_remaining = int(effect.payload.get("stage_rounds_remaining") or 1)

    if stage_rounds_remaining > 1:
        effect.payload["stage_rounds_remaining"] = stage_rounds_remaining - 1
        return [
            (
                "effect_tick",
                {
                    "effect_id": effect.effect_id,
                    "kind": effect.kind,
                    "target": target.unit_id,
                    "stage_from": current_stage,
                    "stage_to": current_stage,
                    "waiting": True,
                    "remaining_stage_rounds": effect.payload["stage_rounds_remaining"],
                    "target_hp": target.hp,
                },
            )
        ]

    save_cfg = effect.payload.get("save") or {}
    save_detail = None
    next_stage = current_stage
    if save_cfg:
        dc = int(save_cfg.get("dc") or 0)
        save_type = str(save_cfg.get("save_type") or "Fortitude")
        if dc > 0:
            save = resolve_save(
                rng=rng,
                save_type=save_type,
                profile=_unit_save_profile(state, target.unit_id),
                dc=dc,
            )
            next_stage = max(0, min(max_stage, current_stage + _affliction_delta(save.degree)))
            save_detail = {
                "dc": dc,
                "save_type": save_type,
                "die": save.die,
                "modifier": save.modifier,
                "total": save.total,
                "degree": save.degree,
            }

    effect.payload["current_stage"] = next_stage
    if next_stage <= 0:
        effect.duration_rounds = 0
        return [
            (
                "effect_tick",
                {
                    "effect_id": effect.effect_id,
                    "kind": effect.kind,
                    "target": target.unit_id,
                    "stage_from": current_stage,
                    "stage_to": next_stage,
                    "save": save_detail,
                    "cured": True,
                    "target_hp": target.hp,
                },
            )
        ]

    stage_result = _apply_affliction_stage(state, effect, rng, next_stage)
    return [
        (
            "effect_tick",
            {
                "effect_id": effect.effect_id,
                "kind": effect.kind,
                "target": target.unit_id,
                "stage_from": current_stage,
                "stage_to": next_stage,
                "save": save_detail,
                "stage_result": stage_result,
            },
        )
    ]


def on_apply(state: BattleState, effect: EffectState, rng: DeterministicRNG) -> List[LifecycleEvent]:
    events: List[LifecycleEvent] = []
    if effect.target_unit_id is None:
        return events
    target = state.units.get(effect.target_unit_id)
    if target is None or not target.alive:
        return events

    if effect.kind == "condition":
        name = normalize_condition_name(str(effect.payload.get("name", "")))
        value = int(effect.payload.get("value", 1))
        if name:
            applied = not condition_is_immune(name, target.condition_immunities)
            if applied:
                target.conditions = apply_condition(target.conditions, name, value)
            events.append(
                (
                    "effect_apply",
                    {
                        "effect_id": effect.effect_id,
                        "kind": effect.kind,
                        "target": target.unit_id,
                        "condition": name,
                        "value": value,
                        "applied": applied,
                        "reason": None if applied else "condition_immune",
                    },
                )
            )
    elif effect.kind == "temp_hp":
        amount = int(effect.payload.get("amount", 0))
        stack_mode = str(effect.payload.get("stack_mode") or "max")
        cross_source = str(effect.payload.get("cross_source") or "higher_only")
        source_key = str(effect.payload.get("source_key") or "")
        if not source_key:
            if effect.source_unit_id:
                source_key = f"unit:{effect.source_unit_id}"
            else:
                source_key = f"effect:{effect.effect_id}"

        before = int(target.temp_hp)
        before_source = target.temp_hp_source
        before_owner = target.temp_hp_owner_effect_id
        after = before
        after_source = before_source
        after_owner = before_owner
        reason = None
        decision = "ignored"

        if amount <= 0:
            reason = "invalid_amount"
        elif stack_mode not in ("max", "add"):
            reason = "invalid_stack_mode"
        elif cross_source not in ("higher_only", "replace", "ignore"):
            reason = "invalid_cross_source_policy"
        else:
            same_source = before_source == source_key or (before == 0 and before_source is None)
            if same_source:
                decision = "same_source_refresh"
                if stack_mode == "add":
                    after = before + amount
                else:
                    after = max(before, amount)
                after_source = source_key if after > 0 else None
                after_owner = effect.effect_id if after > 0 else None
            elif cross_source == "ignore":
                decision = "cross_source_ignored"
                reason = "cross_source_policy_ignore"
            elif cross_source == "replace":
                decision = "cross_source_replaced"
                after = amount
                after_source = source_key
                after_owner = effect.effect_id
            else:
                if amount > before:
                    decision = "cross_source_replaced"
                    after = amount
                    after_source = source_key
                    after_owner = effect.effect_id
                else:
                    decision = "cross_source_ignored"
                    reason = "lower_or_equal_than_current"

        target.temp_hp = max(0, after)
        target.temp_hp_source = after_source if target.temp_hp > 0 else None
        target.temp_hp_owner_effect_id = after_owner if target.temp_hp > 0 else None

        granted = max(0, target.temp_hp - before)
        applied = (
            target.temp_hp != before
            or target.temp_hp_source != before_source
            or target.temp_hp_owner_effect_id != before_owner
        )
        effect.payload["applied_temp_hp"] = granted
        effect.payload["temp_hp_source_key"] = source_key
        effect.payload["stack_mode"] = stack_mode
        effect.payload["cross_source"] = cross_source
        events.append(
            (
                "effect_apply",
                {
                    "effect_id": effect.effect_id,
                    "kind": effect.kind,
                    "target": target.unit_id,
                    "requested_amount": amount,
                    "stack_mode": stack_mode,
                    "cross_source": cross_source,
                    "source_key": source_key,
                    "temp_hp_before": before,
                    "temp_hp_after": target.temp_hp,
                    "temp_hp_source_before": before_source,
                    "temp_hp_source_after": target.temp_hp_source,
                    "granted": granted,
                    "applied": applied,
                    "decision": decision,
                    "reason": reason,
                },
            )
        )
    elif effect.kind == "affliction":
        # Apply initial stage on exposure.
        stage = int(effect.payload.get("current_stage") or 1)
        effect.payload.setdefault("applied_conditions", {})
        effect.payload.setdefault("persistent_conditions", [])
        stage_result = _apply_affliction_stage(state, effect, rng, stage)
        events.append(
            (
                "effect_apply",
                {
                    "effect_id": effect.effect_id,
                    "kind": effect.kind,
                    "target": target.unit_id,
                    "stage": stage,
                    "stage_result": stage_result,
                },
            )
        )
    else:
        events.append(
            (
                "effect_apply",
                {
                    "effect_id": effect.effect_id,
                    "kind": effect.kind,
                    "target": target.unit_id,
                },
            )
        )
    return events


def _apply_persistent_damage(
    state: BattleState,
    effect: EffectState,
    rng: DeterministicRNG,
) -> List[LifecycleEvent]:
    events: List[LifecycleEvent] = []
    target = state.units.get(effect.target_unit_id or "")
    if target is None or not target.alive:
        return events

    formula = str(effect.payload.get("formula", ""))
    damage_type = str(effect.payload.get("damage_type") or "").lower() or None
    if not formula:
        return events

    roll = roll_damage(rng, formula)
    adjustment = apply_damage_modifiers(
        raw_total=roll.total,
        damage_type=damage_type,
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
    if target.hp == 0:
        target.conditions = apply_condition(target.conditions, "unconscious", 1)

    recovery = None
    if bool(effect.payload.get("recovery_check", True)):
        recovery_dc = int(effect.payload.get("recovery_dc", 15))
        recovery_mod = int(effect.payload.get("recovery_modifier", 0))
        check = resolve_check(rng=rng, modifier=recovery_mod, dc=recovery_dc)
        recovered = check.degree in ("success", "critical_success")
        recovery = {
            "dc": recovery_dc,
            "modifier": recovery_mod,
            "die": check.die,
            "total": check.total,
            "degree": check.degree,
            "recovered": recovered,
        }
        if recovered:
            effect.payload["_expire_now"] = True

    damage_payload = {
        "formula": formula,
        "rolls": roll.rolls,
        "flat_modifier": roll.flat_modifier,
        "raw_total": adjustment.raw_total,
        "total": adjustment.applied_total,
        "damage_type": damage_type or "untyped",
        "immune": adjustment.immune,
        "resistance_total": adjustment.resistance_total,
        "weakness_total": adjustment.weakness_total,
    }
    if applied_damage.absorbed_by_temp_hp > 0:
        damage_payload["temp_hp_absorbed"] = applied_damage.absorbed_by_temp_hp

    events.append(
        (
            "effect_tick",
            {
                "effect_id": effect.effect_id,
                "kind": effect.kind,
                "target": target.unit_id,
                "damage": damage_payload,
                "recovery": recovery,
                "target_hp": target.hp,
            },
        )
    )
    return events


def on_turn_start(state: BattleState, effect: EffectState, rng: DeterministicRNG) -> List[LifecycleEvent]:
    if effect.kind == "persistent_damage":
        return _apply_persistent_damage(state, effect, rng)
    return []


def on_turn_end(state: BattleState, effect: EffectState, rng: DeterministicRNG) -> List[LifecycleEvent]:
    if effect.kind == "persistent_damage":
        return _apply_persistent_damage(state, effect, rng)
    if effect.kind == "affliction":
        return _on_affliction_tick(state, effect, rng)
    return []


def on_expire(state: BattleState, effect: EffectState, rng: DeterministicRNG) -> List[LifecycleEvent]:
    events: List[LifecycleEvent] = []
    if effect.kind == "condition" and effect.target_unit_id:
        target = state.units.get(effect.target_unit_id)
        if target is not None:
            if bool(effect.payload.get("clear_on_expire", True)):
                name = str(effect.payload.get("name", ""))
                if name:
                    target.conditions = clear_condition(target.conditions, name)
                    events.append(
                        (
                            "effect_expire",
                            {
                                "effect_id": effect.effect_id,
                                "kind": effect.kind,
                                "target": target.unit_id,
                                "cleared_condition": name,
                            },
                        )
                    )
                    return events
    if effect.kind == "affliction" and effect.target_unit_id:
        target = state.units.get(effect.target_unit_id)
        if target is not None:
            persistent_conditions = {
                str(name).replace(" ", "_")
                for name in effect.payload.get("persistent_conditions", [])
                if str(name).strip()
            }
            applied_conditions = {
                str(name): int(value)
                for name, value in dict(effect.payload.get("applied_conditions", {})).items()
                if str(name).strip()
            }
            cleared = []
            for name, value in applied_conditions.items():
                if name in persistent_conditions:
                    continue
                if int(target.conditions.get(name, 0)) == value:
                    target.conditions = clear_condition(target.conditions, name)
                    cleared.append(name)
            events.append(
                (
                    "effect_expire",
                    {
                        "effect_id": effect.effect_id,
                        "kind": effect.kind,
                        "target": target.unit_id,
                        "cleared_conditions": sorted(cleared),
                        "persistent_conditions": sorted(persistent_conditions),
                    },
                )
            )
            return events
    if effect.kind == "temp_hp" and effect.target_unit_id:
        target = state.units.get(effect.target_unit_id)
        if target is not None:
            remove_on_expire = bool(effect.payload.get("remove_on_expire", True))
            source_key = str(effect.payload.get("temp_hp_source_key") or "")
            owner_match = target.temp_hp_owner_effect_id == effect.effect_id
            source_match = target.temp_hp_source == source_key
            removed = 0
            if remove_on_expire and owner_match and source_match and int(target.temp_hp) > 0:
                removed = int(target.temp_hp)
                target.temp_hp = 0
                target.temp_hp_source = None
                target.temp_hp_owner_effect_id = None
            events.append(
                (
                    "effect_expire",
                    {
                        "effect_id": effect.effect_id,
                        "kind": effect.kind,
                        "target": target.unit_id,
                        "stack_mode": str(effect.payload.get("stack_mode") or "max"),
                        "cross_source": str(effect.payload.get("cross_source") or "higher_only"),
                        "source_key": source_key,
                        "remove_on_expire": remove_on_expire,
                        "owner_match": owner_match,
                        "source_match": source_match,
                        "removed_temp_hp": removed,
                        "temp_hp_after": int(target.temp_hp),
                    },
                )
            )
            return events

    events.append(
        (
            "effect_expire",
            {
                "effect_id": effect.effect_id,
                "kind": effect.kind,
                "target": effect.target_unit_id,
            },
        )
    )
    return events


def process_timing(state: BattleState, rng: DeterministicRNG, timing: str) -> List[LifecycleEvent]:
    events: List[LifecycleEvent] = []
    active = state.active_unit_id

    to_expire: List[str] = []
    for effect in list(state.effects.values()):
        if effect.target_unit_id != active:
            continue

        if effect.tick_timing == timing:
            if timing == "turn_start":
                events.extend(on_turn_start(state, effect, rng))
            elif timing == "turn_end":
                events.extend(on_turn_end(state, effect, rng))

        if bool(effect.payload.pop("_expire_now", False)):
            to_expire.append(effect.effect_id)
            continue

        if timing == "turn_end" and effect.duration_rounds is not None:
            effect.duration_rounds -= 1
            events.append(
                (
                    "effect_duration",
                    {
                        "effect_id": effect.effect_id,
                        "remaining_rounds": effect.duration_rounds,
                        "target": effect.target_unit_id,
                    },
                )
            )
            if effect.duration_rounds <= 0:
                to_expire.append(effect.effect_id)

    for effect_id in to_expire:
        effect = state.effects.get(effect_id)
        if effect is None:
            continue
        events.extend(on_expire(state, effect, rng))
        state.effects.pop(effect_id, None)

    return events
