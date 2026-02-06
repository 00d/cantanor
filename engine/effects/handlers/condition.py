"""Condition effect handler scaffold."""

from __future__ import annotations

from engine.effects.base import Effect


def handle_condition(effect: Effect) -> dict:
    return {
        "status": "ok",
        "kind": "condition",
        "target": effect.target_unit_id,
        "payload": effect.payload,
    }
