"""Movement effect handler scaffold."""

from __future__ import annotations

from engine.effects.base import Effect


def handle_movement(effect: Effect) -> dict:
    return {
        "status": "ok",
        "kind": "movement",
        "target": effect.target_unit_id,
        "payload": effect.payload,
    }
