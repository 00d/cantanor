"""Deterministic forecast helpers for browser-facing command previews."""

from __future__ import annotations

from engine.rules.damage import parse_formula
from engine.rules.degrees import degree_of_success
from engine.rules.saves import basic_save_multiplier


def _round6(value: float) -> float:
    return round(float(value), 6)


def degree_odds(*, modifier: int, dc: int) -> dict[str, float]:
    counts = {
        "critical_success": 0,
        "success": 0,
        "failure": 0,
        "critical_failure": 0,
    }
    for die in range(1, 21):
        total = die + int(modifier)
        degree = degree_of_success(total=total, dc=int(dc), die_value=die)
        counts[degree] += 1
    return {k: _round6(v / 20.0) for k, v in counts.items()}


def expected_damage_average(formula: str) -> float:
    dice_count, dice_size, modifier = parse_formula(formula)
    if dice_count <= 0:
        return _round6(max(0.0, float(modifier)))
    avg = (dice_count * ((dice_size + 1) / 2.0)) + modifier
    return _round6(max(0.0, avg))


def strike_forecast(*, attack_modifier: int, dc: int, damage_formula: str) -> dict[str, object]:
    odds = degree_odds(modifier=attack_modifier, dc=dc)
    avg = expected_damage_average(damage_formula)
    expected_per_attack = (
        avg * odds["success"]
        + (avg * 2.0) * odds["critical_success"]
    )
    return {
        "kind": "strike",
        "attack_modifier": int(attack_modifier),
        "dc": int(dc),
        "damage_formula": str(damage_formula),
        "degree_odds": odds,
        "expected_damage_raw": {
            "on_success": avg,
            "on_critical_success": _round6(avg * 2.0),
            "per_attack": _round6(expected_per_attack),
        },
    }


def cast_spell_forecast(
    *,
    save_modifier: int,
    dc: int,
    damage_formula: str,
    mode: str = "basic",
) -> dict[str, object]:
    odds = degree_odds(modifier=save_modifier, dc=dc)
    avg = expected_damage_average(damage_formula)

    if mode != "basic":
        expected_multiplier = 1.0
    else:
        expected_multiplier = (
            basic_save_multiplier("critical_success") * odds["critical_success"]
            + basic_save_multiplier("success") * odds["success"]
            + basic_save_multiplier("failure") * odds["failure"]
            + basic_save_multiplier("critical_failure") * odds["critical_failure"]
        )

    return {
        "kind": "cast_spell",
        "save_modifier": int(save_modifier),
        "dc": int(dc),
        "mode": str(mode),
        "damage_formula": str(damage_formula),
        "degree_odds": odds,
        "expected_multiplier": _round6(expected_multiplier),
        "expected_damage_raw": _round6(avg * expected_multiplier),
    }
