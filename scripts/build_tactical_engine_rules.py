#!/usr/bin/env python3
"""Build Phase 2 engine-oriented tactical rules from Phase 1 primitives."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple


RANKS = ("untrained", "trained", "expert", "master", "legendary")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--in",
        dest="input_path",
        type=Path,
        default=Path("compiled/tactical_core_primitives.json"),
        help="Phase 1 JSON input path.",
    )
    parser.add_argument(
        "--out",
        dest="output_path",
        type=Path,
        default=Path("compiled/tactical_engine_rules_v1.json"),
        help="Phase 2 JSON output path.",
    )
    return parser.parse_args()


def normalize_rank(value: str) -> Optional[str]:
    low = value.strip().lower()
    for rank in RANKS:
        if rank in low:
            return rank
    return None


def parse_stealth(raw: str) -> Dict[str, object]:
    out: Dict[str, object] = {
        "raw": raw,
        "detect_magic": "detect magic" in raw.lower(),
        "stealth_dc": None,
        "stealth_bonus": None,
        "alternate_detection_dcs": [],
        "minimum_proficiency": None,
        "notes": None,
    }

    # Primary DC form.
    dc_values = [int(x) for x in re.findall(r"\bDC\s+(\d+)", raw)]
    if dc_values:
        out["stealth_dc"] = dc_values[0]
        if len(dc_values) > 1:
            out["alternate_detection_dcs"] = dc_values[1:]

    # Primary initiative bonus form (complex hazards).
    m_bonus = re.search(r"^\s*([+-]\d+)\b", raw)
    if m_bonus:
        out["stealth_bonus"] = int(m_bonus.group(1))

    m_rank = re.search(r"\(([^)]*)\)", raw)
    if m_rank:
        rank = normalize_rank(m_rank.group(1))
        if rank:
            out["minimum_proficiency"] = rank

    note_chunks = []
    if "or" in raw.lower() and "dc" in raw.lower() and out["alternate_detection_dcs"]:
        note_chunks.append("contains alternate detection DC")
    if "to notice" in raw.lower():
        note_chunks.append("includes conditional notice clause")
    if note_chunks:
        out["notes"] = "; ".join(note_chunks)
    return out


def parse_disable(raw: str) -> Dict[str, object]:
    options: List[Dict[str, object]] = []

    # Skill-based disable checks.
    for m in re.finditer(
        r"\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+DC\s+(\d+)(?:\s+\(([^)]*)\))?",
        raw,
    ):
        skill = m.group(1)
        dc = int(m.group(2))
        rank = normalize_rank(m.group(3) or "")
        options.append(
            {
                "type": "skill_check",
                "skill": skill,
                "dc": dc,
                "minimum_proficiency": rank,
                "raw_fragment": m.group(0),
            }
        )

    # Counteract options.
    for m in re.finditer(
        r"dispel magic\s+\((\d+)(?:st|nd|rd|th)\s+level;\s+counteract DC\s+(\d+)\)",
        raw,
        flags=re.IGNORECASE,
    ):
        options.append(
            {
                "type": "counteract",
                "ability": "dispel magic",
                "counteract_level": int(m.group(1)),
                "counteract_dc": int(m.group(2)),
                "raw_fragment": m.group(0),
            }
        )

    for m in re.finditer(
        r"spell DC\s+(\d+)\s+\((\d+)(?:st|nd|rd|th)\s+level\)\s+to counteract",
        raw,
        flags=re.IGNORECASE,
    ):
        options.append(
            {
                "type": "counteract",
                "ability": "spell check",
                "counteract_level": int(m.group(2)),
                "counteract_dc": int(m.group(1)),
                "raw_fragment": m.group(0),
            }
        )

    return {"raw": raw, "options": options}


def parse_component_defenses(text: str) -> List[Dict[str, object]]:
    components: List[Dict[str, object]] = []
    if not text:
        return components

    # Pattern examples:
    # "Trapdoor Hardness 3, Trapdoor HP 12 (BT 6)"
    # "Joint Hardness 16, Joint HP 64 (BT 32)"
    pattern = re.compile(
        r"([A-Za-z][A-Za-z ]+?)\s+Hardness\s+(\d+),\s*\1\s+HP\s+(\d+)(?:\s+\(BT\s+(\d+)\))?",
        flags=re.IGNORECASE,
    )
    for m in pattern.finditer(text):
        components.append(
            {
                "name": " ".join(m.group(1).split()).lower(),
                "hardness": int(m.group(2)),
                "hp": int(m.group(3)),
                "broken_threshold": int(m.group(4)) if m.group(4) else None,
            }
        )
    return components


def parse_defenses(ac_text: str, hardness_text: Optional[str]) -> Dict[str, object]:
    joined = " ".join(x for x in [ac_text, hardness_text or ""] if x).strip()

    out: Dict[str, object] = {
        "raw": joined or None,
        "ac": None,
        "fortitude": None,
        "reflex": None,
        "will": None,
        "hardness": None,
        "hp": None,
        "broken_threshold": None,
        "immunities": [],
        "resistances": [],
        "weaknesses": [],
        "component_defenses": [],
    }
    if not joined:
        return out

    m_ac = re.match(r"^\s*(\d+)\s*;", joined)
    if m_ac:
        out["ac"] = int(m_ac.group(1))

    m_fort = re.search(r"\bFort\s+([+-]?\d+)", joined)
    m_ref = re.search(r"\bRef\s+([+-]?\d+)", joined)
    m_will = re.search(r"\bWill\s+([+-]?\d+)", joined)
    if m_fort:
        out["fortitude"] = int(m_fort.group(1))
    if m_ref:
        out["reflex"] = int(m_ref.group(1))
    if m_will:
        out["will"] = int(m_will.group(1))

    m_hard = re.search(r"\bHardness\s+(\d+)", joined)
    m_hp = re.search(r"\bHP\s+(\d+)(?:\s+\(BT\s+(\d+)\))?", joined)
    if m_hard:
        out["hardness"] = int(m_hard.group(1))
    if m_hp:
        out["hp"] = int(m_hp.group(1))
        if m_hp.group(2):
            out["broken_threshold"] = int(m_hp.group(2))

    def parse_tag_list(prefix: str) -> List[str]:
        m = re.search(rf"{prefix}\s+([^;]+)", joined, flags=re.IGNORECASE)
        if not m:
            return []
        return [x.strip().lower() for x in m.group(1).split(",") if x.strip()]

    out["immunities"] = parse_tag_list("Immunities")
    out["resistances"] = parse_tag_list("Resistances")
    out["weaknesses"] = parse_tag_list("Weaknesses")
    out["component_defenses"] = parse_component_defenses(joined)
    return out


def parse_triggered_entry(raw: str) -> Dict[str, object]:
    # Example:
    # "Spring [reaction] (attack); Trigger X. Effect Y."
    out: Dict[str, object] = {
        "raw": raw,
        "name": None,
        "action_type": None,
        "traits": [],
        "trigger": None,
        "effect": None,
    }

    m_head = re.match(r"^(.*?)\s+\[(reaction|free-action)\]\s*(.*)$", raw, flags=re.IGNORECASE)
    if not m_head:
        return out

    out["name"] = m_head.group(1).strip()
    out["action_type"] = m_head.group(2).lower().replace("-", "_")

    rest = m_head.group(3).strip()
    # Trait block can be well-formed "(a, b)" or malformed "(a, b; Trigger ..."
    if rest.startswith("("):
        close_idx = rest.find(")")
        trigger_idx = rest.lower().find("; trigger")
        if close_idx != -1 and (trigger_idx == -1 or close_idx < trigger_idx):
            trait_blob = rest[1:close_idx]
            rest = rest[close_idx + 1 :].lstrip(" ;")
        elif trigger_idx != -1:
            trait_blob = rest[1:trigger_idx]
            rest = rest[trigger_idx + 1 :].lstrip()
        else:
            trait_blob = ""
        if trait_blob:
            out["traits"] = [x.strip().lower() for x in trait_blob.split(",") if x.strip()]

    m_body = re.search(r"Trigger\s+(.+?)\s+Effect\s+(.+)$", rest, flags=re.IGNORECASE)
    if m_body:
        out["trigger"] = m_body.group(1).strip()
        out["effect"] = m_body.group(2).strip()
    return out


def parse_strike(raw: str) -> Dict[str, object]:
    out: Dict[str, object] = {
        "raw": raw,
        "mode": None,
        "name": None,
        "attack_bonus": None,
        "attack_traits": [],
        "damage": None,
        "notes": None,
    }

    m = re.match(
        r"^(Melee|Ranged)\s+(.+?)\s+([+-]\d+)(?:\s+\(([^)]*)\))?,\s*Damage\s+(.+)$",
        raw,
        flags=re.IGNORECASE,
    )
    if not m:
        return out

    out["mode"] = m.group(1).lower()
    out["name"] = m.group(2).strip().lower()
    out["attack_bonus"] = int(m.group(3))
    if m.group(4):
        out["attack_traits"] = [x.strip().lower() for x in m.group(4).split(",") if x.strip()]

    damage_blob = m.group(5).strip()
    if ";" in damage_blob:
        damage_main, note = damage_blob.split(";", 1)
        out["damage"] = damage_main.strip()
        out["notes"] = note.strip()
    else:
        out["damage"] = damage_blob
    return out


def parse_routine(raw: Optional[str]) -> Dict[str, object]:
    out = {"raw": raw, "actions_per_round": None, "text": None, "inferred": False}
    if not raw:
        return out

    m = re.match(r"^\((\d+)\s+actions?\)\s*(.+)$", raw, flags=re.IGNORECASE)
    if m:
        out["actions_per_round"] = int(m.group(1))
        out["text"] = m.group(2).strip()
    else:
        out["text"] = raw
    return out


def infer_routine_from_trigger_entries(trigger_entries: List[Dict[str, object]]) -> Optional[int]:
    for entry in trigger_entries:
        blob = " ".join(
            x
            for x in [entry.get("raw"), entry.get("effect"), entry.get("trigger")]
            if isinstance(x, str) and x
        )
        m = re.search(r"can use\s+(\d+)\s+actions each round", blob, flags=re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def parse_quality(hazard: Dict[str, object], normalized: Dict[str, object]) -> Dict[str, object]:
    issues: List[str] = []

    if normalized["detection"]["stealth_dc"] is None and normalized["detection"]["stealth_bonus"] is None:
        issues.append("missing_detection_value")

    if not normalized["disable"]["options"]:
        issues.append("no_structured_disable_option")

    if not normalized["trigger_actions"]:
        issues.append("no_trigger_actions")
    else:
        for i, trig in enumerate(normalized["trigger_actions"]):
            if trig["name"] is None or trig["action_type"] is None:
                issues.append(f"trigger_{i}_header_unparsed")
            if trig["trigger"] is None:
                issues.append(f"trigger_{i}_trigger_text_missing")
            if trig["effect"] is None:
                issues.append(f"trigger_{i}_effect_text_missing")

    if normalized["complexity"] == "complex" and normalized["routine"]["actions_per_round"] is None:
        issues.append("complex_routine_actions_missing")

    if hazard.get("attacks") and not normalized["strikes"]:
        issues.append("strikes_unparsed")

    score_max = 6
    score = score_max - min(score_max, len(issues))
    return {"score": score, "score_max": score_max, "issues": issues}


def normalize_hazard(hazard: Dict[str, object]) -> Dict[str, object]:
    traits = [t.lower() for t in hazard.get("traits", [])]
    complexity = "complex" if "complex" in traits else "simple"

    trigger_actions = [parse_triggered_entry(x) for x in hazard.get("triggered_entries", [])]
    strikes = [parse_strike(x) for x in hazard.get("attacks", [])]
    defense = parse_defenses(hazard.get("ac_and_saves", ""), hazard.get("hardness_hp"))
    routine = parse_routine(hazard.get("routine"))
    if complexity == "complex" and routine["actions_per_round"] is None:
        inferred = infer_routine_from_trigger_entries(trigger_actions)
        if inferred is not None:
            routine["actions_per_round"] = inferred
            routine["text"] = "Inferred from trigger/effect text."
            routine["inferred"] = True

    normalized: Dict[str, object] = {
        "id": hazard["slug"],
        "name": hazard["name"],
        "level": hazard["level"],
        "complexity": complexity,
        "tags": traits,
        "detection": parse_stealth(hazard.get("stealth", "")),
        "disable": parse_disable(hazard.get("disable", "")),
        "defenses": defense,
        "trigger_actions": trigger_actions,
        "routine": routine,
        "strikes": strikes,
        "reset": hazard.get("reset"),
        "raw": {
            "stealth": hazard.get("stealth"),
            "disable": hazard.get("disable"),
            "ac_and_saves": hazard.get("ac_and_saves"),
            "hardness_hp": hazard.get("hardness_hp"),
            "triggered_entries": hazard.get("triggered_entries", []),
            "attacks": hazard.get("attacks", []),
            "routine": hazard.get("routine"),
        },
    }

    normalized["parse_quality"] = parse_quality(hazard, normalized)
    return normalized


def build_phase2(phase1: Dict[str, object]) -> Dict[str, object]:
    hazards_in = phase1.get("hazards", {}).get("entries", [])
    hazards_out = [normalize_hazard(h) for h in hazards_in]

    issue_counts: Dict[str, int] = {}
    for hazard in hazards_out:
        for issue in hazard["parse_quality"]["issues"]:
            issue_counts[issue] = issue_counts.get(issue, 0) + 1

    scores = [h["parse_quality"]["score"] for h in hazards_out]
    score_max = hazards_out[0]["parse_quality"]["score_max"] if hazards_out else 0

    out: Dict[str, object] = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "schema_version": "tactical_engine_rules_v1",
        "phase": "phase_2_normalized",
        "source_artifact": phase1.get("sources", {}),
        "engine_baseline": phase1.get("encounter_mode", {}),
        "checks": {
            "basic_steps": phase1.get("check_flow", {}).get("basic_steps", []),
            "proficiency_bonus_table": phase1.get("check_flow", {}).get("proficiency_bonus_table", {}),
            "simple_dcs": phase1.get("game_master_reference", {}).get("simple_dcs", {}),
        },
        "conditions": {
            "count": phase1.get("conditions", {}).get("count", 0),
            "entries": phase1.get("conditions", {}).get("entries", []),
        },
        "exploration_activities": phase1.get("game_master_reference", {}).get("exploration_activities", []),
        "hazards": {
            "count": len(hazards_out),
            "entries": hazards_out,
            "parse_quality_summary": {
                "average_score": (sum(scores) / len(scores)) if scores else 0,
                "score_max": score_max,
                "issue_counts": issue_counts,
            },
        },
    }
    return out


def main() -> None:
    args = parse_args()
    phase1 = json.loads(args.input_path.read_text(encoding="utf-8"))
    phase2 = build_phase2(phase1)

    args.output_path.parent.mkdir(parents=True, exist_ok=True)
    args.output_path.write_text(
        json.dumps(phase2, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    q = phase2["hazards"]["parse_quality_summary"]
    print(f"Wrote {args.output_path}")
    print(
        "hazards={count} avg_quality={avg:.2f}/{maxs}".format(
            count=phase2["hazards"]["count"],
            avg=q["average_score"],
            maxs=q["score_max"],
        )
    )
    if q["issue_counts"]:
        print("issues:", q["issue_counts"])


if __name__ == "__main__":
    main()
