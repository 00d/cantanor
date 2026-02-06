#!/usr/bin/env python3
"""Verify Phase 2.5 effect model consistency against Phase 2 rules."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Dict, List


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phase2",
        type=Path,
        default=Path("compiled/tactical_engine_rules_v1.json"),
        help="Phase 2 engine rules path.",
    )
    parser.add_argument(
        "--phase25",
        type=Path,
        default=Path("compiled/tactical_effect_models_v1.json"),
        help="Phase 2.5 effect models path.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("compiled/phase25_verification_report.json"),
        help="Verification report output path.",
    )
    parser.add_argument(
        "--min-coverage",
        type=float,
        default=0.90,
        help="Minimum acceptable source coverage ratio.",
    )
    return parser.parse_args()


def verify(phase2: Dict[str, object], phase25: Dict[str, object], min_coverage: float) -> Dict[str, object]:
    checks: List[Dict[str, object]] = []

    def add(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": passed, "detail": detail})

    h2 = phase2.get("hazards", {}).get("entries", [])
    h25 = phase25.get("hazards", {}).get("entries", [])
    add("hazard_count_match", len(h2) == len(h25), f"phase2={len(h2)} phase25={len(h25)}")

    id2 = {h["id"] for h in h2}
    id25 = {h["hazard_id"] for h in h25}
    add("all_phase2_hazards_present", id2 <= id25, f"missing={len(id2 - id25)}")
    add("no_extra_phase25_hazards", id25 <= id2, f"extra={len(id25 - id2)}")

    # Per-hazard source count must match triggers+strikes count in phase2.
    source_mismatch = []
    by_id_25 = {h["hazard_id"]: h for h in h25}
    for hz in h2:
        expected = len(hz.get("trigger_actions", [])) + len(hz.get("strikes", []))
        actual = len(by_id_25.get(hz["id"], {}).get("sources", []))
        if expected != actual:
            source_mismatch.append((hz["id"], expected, actual))
    add("source_count_match_per_hazard", len(source_mismatch) == 0, f"mismatch={len(source_mismatch)}")

    # Every source should carry structured effects and raw text.
    missing_raw = []
    zero_effect = []
    for hz in h25:
        for src in hz.get("sources", []):
            if not src.get("raw_text"):
                missing_raw.append((hz["hazard_id"], src.get("source_type"), src.get("source_name")))
            if not src.get("effects"):
                zero_effect.append((hz["hazard_id"], src.get("source_type"), src.get("source_name")))
    add("all_sources_have_raw_text", len(missing_raw) == 0, f"missing={len(missing_raw)}")
    add("all_sources_have_effects", len(zero_effect) == 0, f"zero_effect_sources={len(zero_effect)}")

    coverage = phase25.get("coverage_summary", {}).get("coverage_ratio", 0.0)
    add("coverage_threshold_met", coverage >= min_coverage, f"ratio={coverage:.3f} threshold={min_coverage:.3f}")

    # Ensure no unknown effect kind slots.
    missing_kind = []
    for hz in h25:
        for src in hz.get("sources", []):
            for eff in src.get("effects", []):
                if not eff.get("kind"):
                    missing_kind.append((hz["hazard_id"], src.get("source_name")))
    add("all_effects_have_kind", len(missing_kind) == 0, f"missing_kind={len(missing_kind)}")

    passed = all(c["passed"] for c in checks)
    return {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "passed": passed,
        "checks": checks,
        "totals": {
            "total_checks": len(checks),
            "passed_checks": sum(1 for c in checks if c["passed"]),
            "failed_checks": sum(1 for c in checks if not c["passed"]),
            "hazards_phase2": len(h2),
            "hazards_phase25": len(h25),
        },
    }


def main() -> None:
    args = parse_args()
    phase2 = json.loads(args.phase2.read_text(encoding="utf-8"))
    phase25 = json.loads(args.phase25.read_text(encoding="utf-8"))
    report = verify(phase2, phase25, args.min_coverage)

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
