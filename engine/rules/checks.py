"""Core check and attack-roll resolution."""

from __future__ import annotations

from dataclasses import dataclass

from engine.core.rng import DeterministicRNG
from engine.rules.degrees import Degree, degree_of_success


@dataclass
class CheckResult:
    die: int
    modifier: int
    total: int
    dc: int
    degree: Degree


def resolve_check(rng: DeterministicRNG, modifier: int, dc: int) -> CheckResult:
    roll = rng.d20()
    total = roll.value + modifier
    return CheckResult(
        die=roll.value,
        modifier=modifier,
        total=total,
        dc=dc,
        degree=degree_of_success(total=total, dc=dc, die_value=roll.value),
    )
