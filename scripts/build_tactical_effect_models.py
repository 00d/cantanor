#!/usr/bin/env python3
"""Build Phase 2.5 executable effect models from Phase 2 engine rules."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple


SAVE_TYPES = ("Fortitude", "Reflex", "Will")
DAMAGE_TYPES = {
    "acid",
    "bludgeoning",
    "cold",
    "electricity",
    "fire",
    "force",
    "mental",
    "negative",
    "piercing",
    "poison",
    "positive",
    "slashing",
    "sonic",
}
CONDITION_NAMES = [
    "blinded",
    "broken",
    "clumsy",
    "concealed",
    "confused",
    "controlled",
    "dazzled",
    "deafened",
    "doomed",
    "drained",
    "dying",
    "encumbered",
    "enfeebled",
    "fascinated",
    "fatigued",
    "flat-footed",
    "fleeing",
    "friendly",
    "frightened",
    "grabbed",
    "helpful",
    "hidden",
    "hostile",
    "immobilized",
    "indifferent",
    "invisible",
    "observed",
    "paralyzed",
    "persistent damage",
    "petrified",
    "prone",
    "quickened",
    "restrained",
    "sickened",
    "slowed",
    "stunned",
    "stupefied",
    "unconscious",
    "undetected",
    "unfriendly",
    "unnoticed",
    "wounded",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--in",
        dest="input_path",
        type=Path,
        default=Path("compiled/tactical_engine_rules_v1.json"),
        help="Phase 2 engine rules input path.",
    )
    parser.add_argument(
        "--out",
        dest="output_path",
        type=Path,
        default=Path("compiled/tactical_effect_models_v1.json"),
        help="Phase 2.5 effect model output path.",
    )
    return parser.parse_args()


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_duration(text: str) -> Optional[Dict[str, object]]:
    low = text.lower()
    if "unlimited duration" in low:
        return {"raw": "unlimited duration", "amount": None, "unit": "unlimited"}
    m = re.search(r"\bfor\s+(\d+)\s+(round|minute|hour|day)s?\b", text, flags=re.IGNORECASE)
    if m:
        return {"raw": m.group(0), "amount": int(m.group(1)), "unit": m.group(2).lower()}
    m2 = re.search(r"\((\d+)\s+(round|minute|hour|day)s?\)", text, flags=re.IGNORECASE)
    if m2:
        return {"raw": m2.group(0), "amount": int(m2.group(1)), "unit": m2.group(2).lower()}
    return None


def parse_damage_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    # "deals 3d12 electricity damage", "takes 1d8 poison damage"
    patt = re.compile(
        r"\b(?:deals?|takes?)\s+(\d+d\d+(?:\+\d+)?)\s+([a-zA-Z-]+)\s+damage\b",
        flags=re.IGNORECASE,
    )
    for m in patt.finditer(text):
        events.append(
            {
                "kind": "damage",
                "formula": m.group(1),
                "damage_type": m.group(2).lower(),
                "raw_fragment": m.group(0),
            }
        )

    # "typically 10 bludgeoning damage"
    patt_typical = re.compile(r"\btypically\s+(\d+)\s+([a-zA-Z-]+)\s+damage\b", flags=re.IGNORECASE)
    for m in patt_typical.finditer(text):
        events.append(
            {
                "kind": "damage",
                "formula": m.group(1),
                "damage_type": m.group(2).lower(),
                "approximate": True,
                "raw_fragment": m.group(0),
            }
        )

    # Standalone strike-like payloads: "2d10+5 slashing"
    patt_standalone = re.compile(
        r"\b(\d+d\d+(?:\+\d+)?)\s+([a-zA-Z-]+)\b(?!\s*(?:feet|foot|mile|miles|round|rounds|hour|hours|minute|minutes))",
        flags=re.IGNORECASE,
    )
    for m in patt_standalone.finditer(text):
        dtype = m.group(2).lower()
        if dtype not in DAMAGE_TYPES:
            continue
        events.append(
            {
                "kind": "damage",
                "formula": m.group(1),
                "damage_type": dtype,
                "raw_fragment": m.group(0),
            }
        )

    # De-duplicate.
    unique = []
    seen = set()
    for e in events:
        k = (e["kind"], e.get("formula"), e.get("damage_type"), e["raw_fragment"].lower())
        if k in seen:
            continue
        seen.add(k)
        unique.append(e)
    events = unique
    return events


def parse_save_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    # "DC 22 basic Reflex save"
    basic = re.compile(r"\bDC\s+(\d+)\s+basic\s+(Fortitude|Reflex|Will)\s+save\b", flags=re.IGNORECASE)
    for m in basic.finditer(text):
        events.append(
            {
                "kind": "save_check",
                "dc": int(m.group(1)),
                "save_type": m.group(2).capitalize(),
                "mode": "basic",
                "raw_fragment": m.group(0),
            }
        )

    # "DC 38 Fortitude negates"
    negates = re.compile(r"\bDC\s+(\d+)\s+(Fortitude|Reflex|Will)\s+negates\b", flags=re.IGNORECASE)
    for m in negates.finditer(text):
        events.append(
            {
                "kind": "save_check",
                "dc": int(m.group(1)),
                "save_type": m.group(2).capitalize(),
                "mode": "negates",
                "raw_fragment": m.group(0),
            }
        )

    # "must succeed at a DC 24 Will save", "must attempt a DC 29 Will save"
    generic = re.compile(
        r"\b(?:must\s+(?:succeed at|attempt)|can attempt|attempt)\s+a?\s*DC\s+(\d+)\s+(Fortitude|Reflex|Will)\s+save\b",
        flags=re.IGNORECASE,
    )
    for m in generic.finditer(text):
        events.append(
            {
                "kind": "save_check",
                "dc": int(m.group(1)),
                "save_type": m.group(2).capitalize(),
                "mode": "standard",
                "raw_fragment": m.group(0),
            }
        )

    # "DC 34 Reflex to avoid ..."
    bare = re.compile(r"\bDC\s+(\d+)\s+(Fortitude|Reflex|Will)\b", flags=re.IGNORECASE)
    for m in bare.finditer(text):
        frag = m.group(0)
        # Skip duplicates already captured in richer patterns.
        if any(frag.lower() in e["raw_fragment"].lower() for e in events):
            continue
        events.append(
            {
                "kind": "save_check",
                "dc": int(m.group(1)),
                "save_type": m.group(2).capitalize(),
                "mode": "standard",
                "raw_fragment": frag,
            }
        )

    # De-duplicate by fragment.
    unique = []
    seen = set()
    for e in events:
        k = (e["dc"], e["save_type"], e["mode"], e["raw_fragment"].lower())
        if k in seen:
            continue
        seen.add(k)
        unique.append(e)
    return unique


def parse_condition_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    # "becomes frightened 2", "and drained 1"
    patt = re.compile(
        r"\b(?:becomes?|and)\s+(" + "|".join(re.escape(c) for c in CONDITION_NAMES) + r")\s+(\d+)\b",
        flags=re.IGNORECASE,
    )
    for m in patt.finditer(text):
        events.append(
            {
                "kind": "apply_condition",
                "condition": m.group(1).lower(),
                "value": int(m.group(2)),
                "raw_fragment": m.group(0),
            }
        )

    # Binary conditions without explicit value.
    for cond in ("confused", "prone", "immobilized", "unconscious"):
        patt2 = re.compile(rf"\bbe\s+{re.escape(cond)}\b", flags=re.IGNORECASE)
        for m in patt2.finditer(text):
            events.append(
                {
                    "kind": "apply_condition",
                    "condition": cond,
                    "value": None,
                    "raw_fragment": m.group(0),
                }
            )
    return events


def parse_movement_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    m = re.search(r"\bknocked back\s+(\d+)\s+feet\b", text, flags=re.IGNORECASE)
    if m:
        events.append(
            {
                "kind": "forced_movement",
                "movement_type": "knockback",
                "distance_feet": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )
    if re.search(r"\bfalls?\s+in\b", text, flags=re.IGNORECASE):
        events.append(
            {
                "kind": "forced_movement",
                "movement_type": "fall",
                "distance_feet": None,
                "raw_fragment": "falls in",
            }
        )
    return events


def parse_death_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    if re.search(r"\bdies instantly\b", text, flags=re.IGNORECASE):
        events.append({"kind": "instant_death", "raw_fragment": "dies instantly"})
    if re.search(r"\breduced to 0 Hit Points and dies\b", text, flags=re.IGNORECASE):
        events.append({"kind": "instant_death", "raw_fragment": "reduced to 0 Hit Points and dies"})
    if re.search(r"\bdecapitated\b", text, flags=re.IGNORECASE):
        events.append({"kind": "special_lethality", "effect": "decapitation", "raw_fragment": "decapitated"})
    return events


def parse_summon_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    m = re.search(r"\bsummons?\s+(?:a\s+)?specific\s+level\s+(\d+)\s+creature\b", text, flags=re.IGNORECASE)
    if m:
        events.append(
            {
                "kind": "summon",
                "creature_level": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )
    return events


def parse_transform_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    if re.search(r"\brevert to infants\b", text, flags=re.IGNORECASE):
        events.append({"kind": "transform", "transform_type": "age_regression", "raw_fragment": "revert to infants"})
    if re.search(r"\btargeted by baleful polymorph\b", text, flags=re.IGNORECASE):
        events.append({"kind": "transform", "transform_type": "baleful_polymorph", "raw_fragment": "targeted by baleful polymorph"})
    return events


def parse_teleport_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    if re.search(r"\bdrawn into another plane\b", text, flags=re.IGNORECASE):
        events.append({"kind": "teleport", "teleport_type": "planar_shift_forced", "raw_fragment": "drawn into another plane"})
    return events


def parse_attack_trigger_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    if re.search(r"\b(attack|attacking|strike|shoots?|swings down)\b", text, flags=re.IGNORECASE):
        events.append({"kind": "attack_trigger", "raw_fragment": "attack/strike wording"})
    if re.search(r"\brolls initiative\b", text, flags=re.IGNORECASE):
        events.append({"kind": "encounter_start", "raw_fragment": "rolls initiative"})
    return events


def parse_area_events(text: str) -> List[Dict[str, object]]:
    events: List[Dict[str, object]] = []
    for m in re.finditer(r"\b(\d+)-foot(?:-radius)?\s+(cone|line|emanation|burst|radius)\b", text, flags=re.IGNORECASE):
        events.append(
            {
                "kind": "area",
                "shape": m.group(2).lower(),
                "size_feet": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )
    for m in re.finditer(r"\bwithin\s+(\d+)\s+feet\b", text, flags=re.IGNORECASE):
        events.append(
            {
                "kind": "area",
                "shape": "within_radius",
                "size_feet": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )
    for m in re.finditer(r"\b(\d+)-mile\s+radius\b", text, flags=re.IGNORECASE):
        events.append(
            {
                "kind": "area",
                "shape": "radius",
                "size_miles": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )
    return events


def parse_affliction(text: str) -> Optional[Dict[str, object]]:
    if "Stage 1" not in text or "Saving Throw DC" not in text:
        return None

    out: Dict[str, object] = {
        "kind": "affliction",
        "raw_fragment": text,
        "save": None,
        "maximum_duration": None,
        "stages": [],
    }

    m_save = re.search(r"Saving Throw DC\s+(\d+)\s+(Fortitude|Reflex|Will)", text, flags=re.IGNORECASE)
    if m_save:
        out["save"] = {"dc": int(m_save.group(1)), "save_type": m_save.group(2).capitalize()}

    m_max = re.search(r"Maximum Duration\s+(\d+)\s+(round|minute|hour|day)s?", text, flags=re.IGNORECASE)
    if m_max:
        out["maximum_duration"] = {"amount": int(m_max.group(1)), "unit": m_max.group(2).lower()}

    stage_re = re.compile(r"Stage\s+(\d+)\s+(.+?)(?=(?:;\s*Stage\s+\d+)|$)", flags=re.IGNORECASE)
    for m in stage_re.finditer(text):
        body = m.group(2).strip(" ;")
        stage = {
            "stage": int(m.group(1)),
            "raw": body,
            "damage": parse_damage_events(body),
            "conditions": parse_condition_events(body),
            "duration": parse_duration(body),
        }
        out["stages"].append(stage)

    return out


def collect_effects(text: str) -> List[Dict[str, object]]:
    if not text:
        return []
    effects: List[Dict[str, object]] = []
    effects.extend(parse_damage_events(text))
    effects.extend(parse_save_events(text))
    effects.extend(parse_condition_events(text))
    effects.extend(parse_movement_events(text))
    effects.extend(parse_death_events(text))
    effects.extend(parse_summon_events(text))
    effects.extend(parse_transform_events(text))
    effects.extend(parse_teleport_events(text))
    effects.extend(parse_attack_trigger_events(text))
    effects.extend(parse_area_events(text))
    aff = parse_affliction(text)
    if aff:
        effects.append(aff)

    dur = parse_duration(text)
    if dur:
        effects.append({"kind": "duration", **dur})

    return effects


def source_to_effect_entry(
    hazard: Dict[str, object],
    source_type: str,
    source_name: str,
    text: str,
) -> Dict[str, object]:
    normalized_text = compact(text)
    structured = collect_effects(normalized_text)
    return {
        "source_type": source_type,
        "source_name": source_name,
        "raw_text": normalized_text,
        "effects": structured,
        "coverage": {
            "structured_effect_count": len(structured),
            "has_structured_effects": len(structured) > 0,
        },
    }


def build_phase25(phase2: Dict[str, object]) -> Dict[str, object]:
    hazards_in = phase2.get("hazards", {}).get("entries", [])

    hazards_out = []
    total_sources = 0
    covered_sources = 0
    effect_kind_counts: Dict[str, int] = {}

    for hz in hazards_in:
        source_entries: List[Dict[str, object]] = []

        for trig in hz.get("trigger_actions", []):
            total_sources += 1
            item = source_to_effect_entry(
                hazard=hz,
                source_type="trigger_action",
                source_name=trig.get("name") or "trigger_action",
                text=trig.get("effect") or trig.get("raw") or "",
            )
            if item["coverage"]["has_structured_effects"]:
                covered_sources += 1
            for eff in item["effects"]:
                effect_kind_counts[eff["kind"]] = effect_kind_counts.get(eff["kind"], 0) + 1
            source_entries.append(item)

        for strike in hz.get("strikes", []):
            total_sources += 1
            blob = compact((strike.get("damage") or "") + " " + (strike.get("notes") or ""))
            item = source_to_effect_entry(
                hazard=hz,
                source_type="strike",
                source_name=strike.get("name") or "strike",
                text=blob,
            )
            if item["coverage"]["has_structured_effects"]:
                covered_sources += 1
            for eff in item["effects"]:
                effect_kind_counts[eff["kind"]] = effect_kind_counts.get(eff["kind"], 0) + 1
            source_entries.append(item)

        hazards_out.append(
            {
                "hazard_id": hz["id"],
                "hazard_name": hz["name"],
                "level": hz["level"],
                "complexity": hz.get("complexity"),
                "tags": hz.get("tags", []),
                "sources": source_entries,
            }
        )

    coverage_ratio = (covered_sources / total_sources) if total_sources else 0.0
    out = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "schema_version": "tactical_effect_models_v1",
        "phase": "phase_2_5_effect_models",
        "source_artifact": phase2.get("schema_version"),
        "hazards": {
            "count": len(hazards_out),
            "entries": hazards_out,
        },
        "coverage_summary": {
            "total_sources": total_sources,
            "covered_sources": covered_sources,
            "coverage_ratio": coverage_ratio,
            "effect_kind_counts": effect_kind_counts,
        },
    }
    return out


def main() -> None:
    args = parse_args()
    phase2 = json.loads(args.input_path.read_text(encoding="utf-8"))
    phase25 = build_phase25(phase2)

    args.output_path.parent.mkdir(parents=True, exist_ok=True)
    args.output_path.write_text(
        json.dumps(phase25, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    cov = phase25["coverage_summary"]
    print(f"Wrote {args.output_path}")
    print(
        "sources={total} covered={covered} ratio={ratio:.3f}".format(
            total=cov["total_sources"],
            covered=cov["covered_sources"],
            ratio=cov["coverage_ratio"],
        )
    )
    print("effect_kinds:", cov["effect_kind_counts"])


if __name__ == "__main__":
    main()
