"""Damage effect handler scaffold."""

from __future__ import annotations

from engine.effects.base import Effect


def handle_damage(effect: Effect) -> dict:
    return {
        "status": "ok",
        "kind": "damage",
        "target": effect.target_unit_id,
        "payload": effect.payload,
    }
