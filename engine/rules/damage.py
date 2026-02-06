"""Damage formula parsing and rolling."""

from __future__ import annotations

import re
from dataclasses import dataclass

from engine.core.rng import DeterministicRNG


_DAMAGE_RE = re.compile(r"^(\d+)d(\d+)([+-]\d+)?$")
_FLAT_RE = re.compile(r"^[+-]?\d+$")


@dataclass
class DamageRoll:
    formula: str
    total: int
    rolls: list[int]
    flat_modifier: int


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
