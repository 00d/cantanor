"""Deterministic RNG wrapper with trace metadata."""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass
class RollResult:
    value: int
    low: int
    high: int


class DeterministicRNG:
    def __init__(self, seed: int) -> None:
        self._seed = seed
        self._random = random.Random(seed)

    @property
    def seed(self) -> int:
        return self._seed

    def randint(self, low: int, high: int) -> RollResult:
        return RollResult(value=self._random.randint(low, high), low=low, high=high)

    def d20(self) -> RollResult:
        return self.randint(1, 20)
