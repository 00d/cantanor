"""Runtime registry for effect handlers."""

from __future__ import annotations

from typing import Callable, Dict

from engine.effects.base import Effect

EffectHandler = Callable[[Effect], dict]


class EffectRegistry:
    def __init__(self) -> None:
        self._handlers: Dict[str, EffectHandler] = {}

    def register(self, kind: str, handler: EffectHandler) -> None:
        self._handlers[kind] = handler

    def resolve(self, effect: Effect) -> dict:
        handler = self._handlers.get(effect.kind)
        if handler is None:
            return {"status": "noop", "reason": f"no handler for kind={effect.kind}"}
        return handler(effect)
