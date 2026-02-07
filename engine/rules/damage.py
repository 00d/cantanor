"""Damage formula parsing and rolling."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Iterable

from engine.core.rng import DeterministicRNG


_DAMAGE_RE = re.compile(r"^(\d+)d(\d+)([+-]\d+)?$")
_FLAT_RE = re.compile(r"^[+-]?\d+$")

_DAMAGE_TYPE_ALIASES = {
    "lightning": "electricity",
    "pierce": "piercing",
    "slash": "slashing",
    "bludgeon": "bludgeoning",
}
_PHYSICAL_TYPES = {"bludgeoning", "piercing", "slashing"}
_ENERGY_TYPES = {"acid", "cold", "electricity", "fire", "force", "sonic"}


@dataclass
class DamageRoll:
    formula: str
    total: int
    rolls: list[int]
    flat_modifier: int


@dataclass
class DamageAdjustment:
    raw_total: int
    applied_total: int
    damage_type: str | None
    immune: bool
    resistance_total: int
    weakness_total: int


@dataclass
class AppliedDamage:
    incoming_total: int
    absorbed_by_temp_hp: int
    hp_loss: int
    new_hp: int
    new_temp_hp: int


def parse_formula(formula: str) -> tuple[int, int, int]:
    text = formula.strip()
    match = _DAMAGE_RE.match(text)
    if match:
        dice_count = int(match.group(1))
        dice_size = int(match.group(2))
        modifier = int(match.group(3) or 0)
        return dice_count, dice_size, modifier
    if _FLAT_RE.match(text):
        return 0, 1, int(text)
    raise ValueError(f"Unsupported damage formula: {formula}")


def roll_damage(rng: DeterministicRNG, formula: str, multiplier: int = 1) -> DamageRoll:
    dice_count, dice_size, modifier = parse_formula(formula)
    rolls = [rng.randint(1, dice_size).value for _ in range(dice_count)]
    total = (sum(rolls) + modifier) * multiplier
    return DamageRoll(
        formula=formula,
        total=max(0, total),
        rolls=rolls,
        flat_modifier=modifier,
    )


def _normalized_damage_type(raw: str | None) -> str | None:
    normalized = (raw or "").strip().lower()
    if not normalized:
        return None
    return _DAMAGE_TYPE_ALIASES.get(normalized, normalized)


def _damage_type_tags(damage_type: str | None) -> set[str]:
    normalized = _normalized_damage_type(damage_type)
    if normalized is None:
        return set()
    tags = {normalized}
    if normalized in _PHYSICAL_TYPES:
        tags.add("physical")
    if normalized in _ENERGY_TYPES:
        tags.add("energy")
    return tags


def _highest_matching_modifier(modifiers: Dict[str, int], damage_tags: set[str]) -> int:
    best = 0
    for key, value in modifiers.items():
        k = _normalized_damage_type(str(key))
        if k == "all" or (k is not None and k in damage_tags):
            best = max(best, int(value))
    return max(0, best)


def apply_damage_modifiers(
    *,
    raw_total: int,
    damage_type: str | None,
    resistances: Dict[str, int],
    weaknesses: Dict[str, int],
    immunities: Iterable[str],
) -> DamageAdjustment:
    raw = max(0, int(raw_total))
    normalized_type = _normalized_damage_type(damage_type)
    damage_tags = _damage_type_tags(normalized_type)
    immunity_set = {_normalized_damage_type(str(x)) or "" for x in immunities}

    if raw == 0:
        return DamageAdjustment(
            raw_total=0,
            applied_total=0,
            damage_type=normalized_type,
            immune=False,
            resistance_total=0,
            weakness_total=0,
        )

    if "all" in immunity_set or any(tag in immunity_set for tag in damage_tags):
        return DamageAdjustment(
            raw_total=raw,
            applied_total=0,
            damage_type=normalized_type,
            immune=True,
            resistance_total=0,
            weakness_total=0,
        )

    # Use the strongest matching value for each side, rather than stacking.
    resistance_total = _highest_matching_modifier(resistances, damage_tags)
    weakness_total = _highest_matching_modifier(weaknesses, damage_tags)

    applied = max(0, raw - resistance_total + weakness_total)
    return DamageAdjustment(
        raw_total=raw,
        applied_total=applied,
        damage_type=normalized_type,
        immune=False,
        resistance_total=max(0, resistance_total),
        weakness_total=max(0, weakness_total),
    )


def apply_damage_to_pool(*, hp: int, temp_hp: int, damage_total: int) -> AppliedDamage:
    incoming = max(0, int(damage_total))
    current_hp = max(0, int(hp))
    current_temp = max(0, int(temp_hp))
    absorbed = min(current_temp, incoming)
    hp_loss = max(0, incoming - absorbed)
    return AppliedDamage(
        incoming_total=incoming,
        absorbed_by_temp_hp=absorbed,
        hp_loss=hp_loss,
        new_hp=max(0, current_hp - hp_loss),
        new_temp_hp=max(0, current_temp - absorbed),
    )
