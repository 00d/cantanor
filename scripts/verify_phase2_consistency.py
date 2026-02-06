#!/usr/bin/env python3
"""Verify Phase 2 artifact quality, completion, and consistency."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter
from pathlib import Path
from typing import Dict, List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phase1",
        type=Path,
        default=Path("compiled/tactical_core_primitives.json"),
        help="Phase 1 artifact path.",
    )
    parser.add_argument(
        "--phase2",
        type=Path,
        default=Path("compiled/tactical_engine_rules_v1.json"),
        help="Phase 2 artifact path.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("compiled/phase2_verification_report.json"),
        help="Verification report output path.",
    )
    return parser.parse_args()


def verify(phase1: Dict[str, object], phase2: Dict[str, object]) -> Dict[str, object]:
    p1_h = phase1.get("hazards", {}).get("entries", [])
    p2_h = phase2.get("hazards", {}).get("entries", [])

    checks: List[Dict[str, object]] = []

    def add(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": passed, "detail": detail})

    # Completion / coverage checks.
    add("count_match", len(p1_h) == len(p2_h), f"phase1={len(p1_h)} phase2={len(p2_h)}")

    k1 = {(h["slug"], h["level"]) for h in p1_h}
    k2 = {(h["id"], h["level"]) for h in p2_h}
    add("all_phase1_hazards_present_in_phase2", k1 <= k2, f"missing={len(k1 - k2)}")
    add("no_extra_phase2_hazards", k2 <= k1, f"extra={len(k2 - k1)}")

    dup1 = sum(v - 1 for v in Counter(k1).values() if v > 1)
    dup2 = sum(v - 1 for v in Counter(k2).values() if v > 1)
    add("no_duplicate_phase1_ids", dup1 == 0, f"duplicates={dup1}")
    add("no_duplicate_phase2_ids", dup2 == 0, f"duplicates={dup2}")

    # Quality checks.
    with_issues = [h["name"] for h in p2_h if h.get("parse_quality", {}).get("issues")]
    add("no_parse_quality_issues", len(with_issues) == 0, f"hazards_with_issues={len(with_issues)}")

    complex_missing = [
        h["name"]
        for h in p2_h
        if h.get("complexity") == "complex" and h.get("routine", {}).get("actions_per_round") is None
    ]
    add(
        "complex_hazards_have_routine_actions",
        len(complex_missing) == 0,
        f"missing={len(complex_missing)}",
    )

    detection_missing = [
        h["name"]
        for h in p2_h
        if h.get("detection", {}).get("stealth_dc") is None
        and h.get("detection", {}).get("stealth_bonus") is None
    ]
    add("all_hazards_have_detection_value", len(detection_missing) == 0, f"missing={len(detection_missing)}")

    disable_missing = [h["name"] for h in p2_h if not h.get("disable", {}).get("options")]
    add("all_hazards_have_disable_options", len(disable_missing) == 0, f"missing={len(disable_missing)}")

    trigger_bad = [
        h["name"]
        for h in p2_h
        if not h.get("trigger_actions")
        or any(t.get("trigger") is None or t.get("effect") is None for t in h.get("trigger_actions", []))
    ]
    add("trigger_actions_structured", len(trigger_bad) == 0, f"bad={len(trigger_bad)}")

    strike_total = 0
    strike_bad = 0
    for h in p2_h:
        for s in h.get("strikes", []):
            strike_total += 1
            if s.get("mode") not in ("melee", "ranged") or s.get("attack_bonus") is None or s.get("damage") is None:
                strike_bad += 1
    add("strikes_parsed_when_present", strike_bad == 0, f"bad={strike_bad} total={strike_total}")

    ac_missing_when_raw = [
        h["name"]
        for h in p2_h
        if h.get("raw", {}).get("ac_and_saves") and h.get("defenses", {}).get("ac") is None
    ]
    add("ac_parsed_when_raw_present", len(ac_missing_when_raw) == 0, f"missing={len(ac_missing_when_raw)}")

    # Baseline checks for encounter loop extracted from chapter 9.
    baseline = phase2.get("engine_baseline", {})
    add(
        "encounter_baseline_values_present",
        baseline.get("round_duration_seconds") == 6
        and baseline.get("actions_per_turn_typical_pc") == 3
        and baseline.get("reactions_per_turn_typical_pc") == 1,
        (
            f"round={baseline.get('round_duration_seconds')} "
            f"actions={baseline.get('actions_per_turn_typical_pc')} "
            f"reactions={baseline.get('reactions_per_turn_typical_pc')}"
        ),
    )

    passed = all(c["passed"] for c in checks)
    return {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "passed": passed,
        "checks": checks,
        "totals": {
            "total_checks": len(checks),
            "passed_checks": sum(1 for c in checks if c["passed"]),
            "failed_checks": sum(1 for c in checks if not c["passed"]),
            "hazards_phase1": len(p1_h),
            "hazards_phase2": len(p2_h),
        },
    }


def main() -> None:
    args = parse_args()
    phase1 = json.loads(args.phase1.read_text(encoding="utf-8"))
    phase2 = json.loads(args.phase2.read_text(encoding="utf-8"))

    report = verify(phase1, phase2)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    print(f"Wrote {args.report}")
    print(f"passed={report['passed']} checks={report['totals']['passed_checks']}/{report['totals']['total_checks']}")
    if not report["passed"]:
        failed = [c for c in report["checks"] if not c["passed"]]
        for item in failed:
            print(f"FAIL {item['name']}: {item['detail']}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
