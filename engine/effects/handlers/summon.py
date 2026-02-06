"""Summon effect handler scaffold."""

from __future__ import annotations

from engine.effects.base import Effect


def handle_summon(effect: Effect) -> dict:
    return {
        "status": "ok",
        "kind": "summon",
        "source": effect.source_unit_id,
        "payload": effect.payload,
    }
