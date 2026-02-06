"""Rule artifact loader helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict


def load_rules(path: Path) -> Dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))
