"""Effect object contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class Effect:
    effect_id: str
    kind: str
    source_unit_id: Optional[str]
    target_unit_id: Optional[str]
    payload: Dict[str, object] = field(default_factory=dict)
    duration_rounds: Optional[int] = None
