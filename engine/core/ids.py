"""ID helpers for battle entities and events."""

from __future__ import annotations

import re

_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")


def is_valid_id(value: str) -> bool:
    return bool(_ID_PATTERN.match(value))


def event_id(sequence: int) -> str:
    return f"ev_{sequence:06d}"
