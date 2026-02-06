"""Event log helpers and replay hash generation."""

from __future__ import annotations

import hashlib
import json
from typing import List


def canonical_event_log(events: List[dict]) -> str:
    return json.dumps(events, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def replay_hash(events: List[dict]) -> str:
    payload = canonical_event_log(events).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
