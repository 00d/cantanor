"""Saving throw resolution."""

from __future__ import annotations

from dataclasses import dataclass

from engine.core.rng import DeterministicRNG
from engine.rules.checks import CheckResult, resolve_check
from engine.rules.degrees import Degree


@dataclass
class SaveProfile:
    fortitude: int = 0
    reflex: int = 0
    will: int = 0


def resolve_save(rng: DeterministicRNG, save_type: str, profile: SaveProfile, dc: int) -> CheckResult:
    lookup = {
        "Fortitude": profile.fortitude,
        "Reflex": profile.reflex,
        "Will": profile.will,
    }
    modifier = lookup.get(save_type, 0)
    return resolve_check(rng=rng, modifier=modifier, dc=dc)


def basic_save_multiplier(degree: Degree) -> float:
    if degree == "critical_success":
        return 0.0
    if degree == "success":
        return 0.5
    if degree == "failure":
        return 1.0
    return 2.0
