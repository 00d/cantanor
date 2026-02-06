"""CLI runner for deterministic smoke scenarios."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

from engine.core.reducer import ReductionError, apply_command
from engine.core.rng import DeterministicRNG
from engine.io.event_log import replay_hash
from engine.io.scenario_loader import battle_state_from_scenario, load_scenario


def _alive_teams(state) -> set[str]:
    return {u.team for u in state.units.values() if u.alive}


def _state_snapshot(state) -> Dict[str, object]:
    return {
        "battle_id": state.battle_id,
        "round": state.round_number,
        "active_unit": state.active_unit_id,
        "units": {
            uid: {
                "team": u.team,
                "hp": u.hp,
                "max_hp": u.max_hp,
                "position": [u.x, u.y],
                "alive": u.alive,
                "conditions": u.conditions,
            }
            for uid, u in sorted(state.units.items())
        },
    }


def run_scenario_file(path: Path) -> Dict[str, object]:
    scenario = load_scenario(path)
    state = battle_state_from_scenario(scenario)
    rng = DeterministicRNG(seed=state.seed)
    events: List[dict] = [
        {
            "event_id": "ev_000000",
            "round": state.round_number,
            "active_unit": state.active_unit_id,
            "type": "turn_start",
            "payload": {"active_unit": state.active_unit_id, "round": state.round_number},
        }
    ]

    executed = 0
    for cmd in scenario["commands"]:
        try:
            state, new_events = apply_command(state=state, command=cmd, rng=rng)
        except ReductionError as exc:
            events.append(
                {
                    "event_id": f"ev_error_{executed:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "command_error",
                    "payload": {"command": cmd, "error": str(exc)},
                }
            )
            break
        events.extend(new_events)
        executed += 1

        alive_teams = _alive_teams(state)
        if len(alive_teams) <= 1:
            events.append(
                {
                    "event_id": f"ev_done_{executed:04d}",
                    "round": state.round_number,
                    "active_unit": state.active_unit_id,
                    "type": "battle_end",
                    "payload": {"winner_team": next(iter(alive_teams), None)},
                }
            )
            break

    result = {
        "battle_id": state.battle_id,
        "seed": state.seed,
        "executed_commands": executed,
        "event_count": len(events),
        "replay_hash": replay_hash(events),
        "final_state": _state_snapshot(state),
        "events": events,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", type=Path, help="Scenario JSON file")
    parser.add_argument("--out", type=Path, default=None, help="Optional output JSON path")
    args = parser.parse_args()

    result = run_scenario_file(args.scenario)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
