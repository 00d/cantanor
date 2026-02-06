#!/usr/bin/env python3
"""Build normalized tactical primitives from Core Rulebook chapter extracts.

Phase 1 scope:
- Chapter 9 (playing loop primitives and condition summaries)
- Appendix file named 10b (GM tables, terrain summary, hazard stat blocks)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


LAYOUT_NOISE = {
    "Core Rulebook",
    "GAME MASTERING",
    "PLAYING THE GAME",
    "Introduction",
    "Ancestries &",
    "Backgrounds",
    "Classes",
    "Skills",
    "Feats",
    "Equipment",
    "Spells",
    "The Age of",
    "Lost OMENS",
    "Playing the",
    "Game",
    "Game",
    "mastering",
    "Crafting",
    "& Treasure",
    "Appendix",
    "[[areas diagram 3/4 page]]",
}

RANK_ORDER = ["untrained", "trained", "expert", "master", "legendary"]


def read_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
    # Keep printable characters plus newlines/tabs only.
    cleaned = "".join(ch for ch in raw if ch in ("\n", "\t") or ord(ch) >= 32)
    return cleaned


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip())


def is_layout_noise(line: str) -> bool:
    if not line:
        return True
    if line in LAYOUT_NOISE:
        return True
    if re.fullmatch(r"=+", line):
        return True
    if re.fullmatch(r"PAGE \d+", line):
        return True
    return False


def cleaned_lines(text: str) -> List[str]:
    out: List[str] = []
    for raw in text.splitlines():
        line = clean_line(raw)
        if is_layout_noise(line):
            continue
        out.append(line)
    return out


def extract_modes(ch9_text: str) -> Dict[str, object]:
    rounds_seconds = None
    actions_per_turn = None
    initiative_phrase_present = "roll for initiative" in ch9_text.lower()

    m_rounds = re.search(r"lasting\s+roughly\s+(\d+)\s+seconds", ch9_text, flags=re.IGNORECASE)
    if m_rounds:
        rounds_seconds = int(m_rounds.group(1))

    m_actions = re.search(
        r"typically (\d+) in the case of PCs",
        ch9_text,
        flags=re.IGNORECASE,
    )
    if m_actions:
        actions_per_turn = int(m_actions.group(1))

    return {
        "round_duration_seconds": rounds_seconds,
        "actions_per_turn_typical_pc": actions_per_turn,
        "reactions_per_turn_typical_pc": 1,
        "initiative_starts_encounter": initiative_phrase_present,
        "modes_of_play": ["encounter", "exploration", "downtime"],
    }


def extract_check_steps(ch9_lines: List[str]) -> List[str]:
    start = None
    for i, line in enumerate(ch9_lines):
        if "they all follow these basic steps" in line.lower():
            start = i
            break
    if start is None:
        return []

    window = ch9_lines[start : start + 80]
    steps: Dict[int, str] = {}
    i = 0
    while i < len(window):
        line = window[i]
        match = re.match(r"^([1-4])\.\s+(.+)$", line)
        if not match:
            i += 1
            continue
        number = int(match.group(1))
        text = match.group(2).strip()
        j = i + 1
        while j < len(window):
            nxt = window[j]
            if re.match(r"^[1-4]\.\s+", nxt):
                break
            # Wrapped continuation lines in extracted text are usually lower-case starts.
            if nxt and nxt[0].islower():
                text = f"{text} {nxt}"
                j += 1
                continue
            break
        steps[number] = text
        i = j
    return [steps[i] for i in range(1, 5) if i in steps]


def extract_proficiency_bonus_table(ch9_lines: List[str]) -> Dict[str, str]:
    table: Dict[str, str] = {}
    for i, line in enumerate(ch9_lines):
        if line == "Proficiency Rank" and i + 1 < len(ch9_lines):
            # Find the first row start after this point.
            window = ch9_lines[i : i + 40]
            for j, token in enumerate(window):
                low = token.lower()
                if low in RANK_ORDER and j + 1 < len(window):
                    value = window[j + 1]
                    if re.search(r"\d|level", value, flags=re.IGNORECASE):
                        table[low] = value
            if table:
                break
    return table


def extract_condition_summaries(ch9_lines: List[str]) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    boundary = None
    for i, line in enumerate(ch9_lines):
        if line == "CONDITIONS":
            boundary = i
            break
    if boundary is None:
        boundary = len(ch9_lines)

    # Use the nearby anchor line for the short condition-summary list.
    start = None
    for i in range(boundary - 1, -1, -1):
        if "brief summary of each" in ch9_lines[i].lower():
            start = i + 1
            break
    if start is None:
        return results

    head_pattern = re.compile(r"^([A-Z][A-Za-z' -]+):\s*(.*)$")
    current_name = None
    current_summary_parts: List[str] = []
    parsed: List[Tuple[str, str]] = []

    for line in ch9_lines[start:boundary]:
        if line.isdigit():
            continue
        m = head_pattern.match(line)
        if m:
            if current_name is not None:
                parsed.append((current_name, " ".join(current_summary_parts).strip()))
            current_name = m.group(1).strip()
            current_summary_parts = [m.group(2).strip()] if m.group(2).strip() else []
            continue
        if current_name is not None:
            current_summary_parts.append(line)

    if current_name is not None:
        parsed.append((current_name, " ".join(current_summary_parts).strip()))

    seen = set()
    for name, summary in parsed:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "name": name,
                "slug": re.sub(r"[^a-z0-9]+", "-", key).strip("-"),
                "summary": summary,
            }
        )
    return results


def extract_exploration_activities(ch10b_lines: List[str]) -> List[str]:
    items: List[str] = []
    start = None
    for i, line in enumerate(ch10b_lines):
        if line == "EXPLORATION ACTIVITIES":
            start = i + 1
            break
    if start is None:
        return items

    for line in ch10b_lines[start : start + 50]:
        if line.startswith("•"):
            items.append(line.lstrip("•").strip())
            continue
        if items and not line.startswith("•"):
            break
    return items


def extract_simple_dcs(ch10b_lines: List[str]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    start = None
    for i, line in enumerate(ch10b_lines):
        if "TABLE 10–4: SIMPLE DCS" in line:
            start = i
            break
    if start is None:
        return out

    window = ch10b_lines[start : start + 80]
    rank_map = {
        "Untrained": "untrained",
        "Trained": "trained",
        "Expert": "expert",
        "Master": "master",
        "Legendary": "legendary",
    }
    for i, line in enumerate(window):
        if line in rank_map and i + 1 < len(window):
            nxt = window[i + 1]
            if nxt.isdigit():
                out[rank_map[line]] = int(nxt)
    return out


def parse_hazard_block(name: str, level: int, block_lines: List[str]) -> Dict[str, object]:
    known_field_prefixes = {
        "Stealth ": "stealth",
        "Description ": "description",
        "Disable ": "disable",
        "AC ": "ac_and_saves",
        "Hardness ": "hardness_hp",
        "Routine ": "routine",
        "Reset ": "reset",
    }

    header_traits: List[str] = []
    for line in block_lines:
        if any(line.startswith(prefix) for prefix in known_field_prefixes):
            break
        if re.search(r"\[(reaction|free-action)\]", line, flags=re.IGNORECASE):
            break
        if re.fullmatch(r"[A-Z][A-Z '’\-]+", line):
            trait = clean_line(line).lower()
            header_traits.append(trait)

    parsed: Dict[str, object] = {
        "name": name,
        "slug": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
        "level": level,
        "traits": header_traits,
        "triggered_entries": [],
        "attacks": [],
    }

    current_key = None
    for line in block_lines:
        # Primary named fields.
        matched_field = False
        for prefix, key in known_field_prefixes.items():
            if line.startswith(prefix):
                value = line[len(prefix) :].strip()
                parsed[key] = value
                current_key = key
                matched_field = True
                break
        if matched_field:
            continue

        # Triggered abilities and actions.
        if re.search(r"\[(reaction|free-action)\]", line, flags=re.IGNORECASE):
            parsed["triggered_entries"].append(line)
            current_key = "triggered_entries"
            continue

        if line.startswith("Melee ") or line.startswith("Ranged "):
            parsed["attacks"].append(line)
            current_key = "attacks"
            continue

        # Continuation lines.
        if current_key == "triggered_entries" and parsed["triggered_entries"]:
            if line and not any(line.startswith(p) for p in known_field_prefixes):
                parsed["triggered_entries"][-1] += " " + line
                continue

        if current_key == "attacks" and parsed["attacks"]:
            if line and not any(line.startswith(p) for p in known_field_prefixes):
                if not (line.startswith("Melee ") or line.startswith("Ranged ")):
                    parsed["attacks"][-1] += " " + line
                    continue

        if current_key in ("stealth", "description", "disable", "ac_and_saves", "hardness_hp", "routine", "reset"):
            if line and not any(line.startswith(p) for p in known_field_prefixes):
                if not re.search(r"\[(reaction|free-action)\]", line, flags=re.IGNORECASE):
                    if not line.startswith("Melee ") and not line.startswith("Ranged "):
                        parsed[current_key] = f"{parsed.get(current_key, '')} {line}".strip()
                        continue

    return parsed


def extract_hazards(ch10b_lines: List[str]) -> List[Dict[str, object]]:
    hazard_level_line = re.compile(r"^HAZARD\s+([0-9]{1,2})$")
    non_name_markers = {
        "HAZARD NAME",
        "HAZARD [LEVEL]",
        "SIMPLE HAZARDS",
        "COMPLEX HAZARDS",
        "HAZARDS",
        "MONSTERS AND HAZARDS",
    }

    # Keep non-empty lines while skipping explicit layout lines.
    lines = [line for line in ch10b_lines if line]
    headers: List[Tuple[int, int, str, int]] = []
    for idx, line in enumerate(lines):
        m = hazard_level_line.match(line)
        if m:
            # The line immediately before "HAZARD <level>" is the hazard name.
            prev_idx = idx - 1
            while prev_idx >= 0 and not lines[prev_idx]:
                prev_idx -= 1
            if prev_idx < 0:
                continue
            name = clean_line(lines[prev_idx]).strip()
            if name in non_name_markers:
                continue
            level = int(m.group(1))
            headers.append((prev_idx, idx, name, level))

    hazards: List[Dict[str, object]] = []
    seen = set()
    section_breaks = {
        "HAZARDS BY NAME",
        "Simple Hazards",
        "Complex Hazards",
        "UPGRADED SUMMONING RUNES",
    }
    for i, (name_idx, level_idx, name, level) in enumerate(headers):
        end_idx = headers[i + 1][0] if i + 1 < len(headers) else len(lines)
        block = lines[level_idx + 1 : end_idx]
        for j, line in enumerate(block):
            if line in section_breaks:
                block = block[:j]
                break
        parsed = parse_hazard_block(name=name, level=level, block_lines=block)
        dedupe_key = (parsed["slug"], parsed["level"])
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        hazards.append(parsed)
    return hazards


def build_payload(ch9_path: Path, ch10b_path: Path) -> Dict[str, object]:
    ch9_text = read_text(ch9_path)
    ch10b_text = read_text(ch10b_path)

    ch9_lines = cleaned_lines(ch9_text)
    ch10b_lines = cleaned_lines(ch10b_text)

    conditions = extract_condition_summaries(ch9_lines)
    hazards = extract_hazards(ch10b_lines)

    payload: Dict[str, object] = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "phase": "phase_1_scaffold",
        "sources": {
            "chapter_9": str(ch9_path),
            "appendix_10b": str(ch10b_path),
        },
        "encounter_mode": extract_modes(ch9_text),
        "check_flow": {
            "basic_steps": extract_check_steps(ch9_lines),
            "proficiency_bonus_table": extract_proficiency_bonus_table(ch9_lines),
        },
        "conditions": {
            "source": "chapter_9_condition_summary_list",
            "count": len(conditions),
            "entries": conditions,
        },
        "game_master_reference": {
            "exploration_activities": extract_exploration_activities(ch10b_lines),
            "simple_dcs": extract_simple_dcs(ch10b_lines),
        },
        "hazards": {
            "count": len(hazards),
            "entries": hazards,
        },
    }
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chapter9",
        type=Path,
        default=Path("extracted/Core_Rulebook/09_chapter_9_playing_the_game.txt"),
        help="Path to chapter 9 extracted text.",
    )
    parser.add_argument(
        "--appendix10b",
        type=Path,
        default=Path("extracted/Core_Rulebook/10b_appendix_conditions.txt"),
        help="Path to appendix 10b extracted text.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("compiled/tactical_core_primitives.json"),
        help="Output JSON artifact path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_payload(args.chapter9, args.appendix10b)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    print(f"Wrote {args.out}")
    print(f"conditions={payload['conditions']['count']} hazards={payload['hazards']['count']}")


if __name__ == "__main__":
    main()
