"""Load and query Phase 2.5 tactical effect model artifacts."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List


DEFAULT_EFFECT_MODEL_PATH = Path("compiled/tactical_effect_models_v1.json")


@lru_cache(maxsize=4)
def load_effect_model(path: str) -> Dict[str, object]:
    model_path = Path(path)
    return json.loads(model_path.read_text(encoding="utf-8"))


def lookup_hazard_source(
    hazard_id: str,
    source_name: str,
    source_type: str = "trigger_action",
    model_path: str | Path = DEFAULT_EFFECT_MODEL_PATH,
) -> Dict[str, object]:
    model = load_effect_model(str(model_path))
    entries = model.get("hazards", {}).get("entries", [])
    for hazard in entries:
        if hazard.get("hazard_id") != hazard_id:
            continue
        for source in hazard.get("sources", []):
            if source.get("source_type") == source_type and source.get("source_name") == source_name:
                return {
                    "hazard_id": hazard_id,
                    "hazard_name": hazard.get("hazard_name"),
                    "source_type": source_type,
                    "source_name": source_name,
                    "effects": source.get("effects", []),
                    "raw_text": source.get("raw_text"),
                }
    raise KeyError(f"hazard source not found: hazard_id={hazard_id} source_type={source_type} source_name={source_name}")
