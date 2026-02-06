"""Objective evaluation for scenario-driven encounters."""

from __future__ import annotations

from typing import Dict, List

from engine.core.state import BattleState


def _objective_met(state: BattleState, objective: Dict[str, object]) -> bool:
    kind = str(objective.get("type", ""))
    if kind == "team_eliminated":
        team = str(objective.get("team", ""))
        return bool(team) and not any(u.alive and u.team == team for u in state.units.values())
    if kind == "unit_reach_tile":
        unit_id = str(objective.get("unit_id", ""))
        unit = state.units.get(unit_id)
        if unit is None or not unit.alive:
            return False
        return unit.x == int(objective.get("x", -99999)) and unit.y == int(objective.get("y", -99999))
    if kind == "flag_set":
        flag = str(objective.get("flag", ""))
        expected = bool(objective.get("value", True))
        return bool(flag) and state.flags.get(flag, False) == expected
    if kind == "round_at_least":
        return state.round_number >= int(objective.get("round", 0))
    if kind == "unit_dead":
        unit = state.units.get(str(objective.get("unit_id", "")))
        return unit is not None and not unit.alive
    if kind == "unit_alive":
        unit = state.units.get(str(objective.get("unit_id", "")))
        return unit is not None and unit.alive
    return False


def evaluate_objectives(state: BattleState, objectives: List[Dict[str, object]]) -> Dict[str, object]:
    statuses: Dict[str, bool] = {}
    victory_ids: List[str] = []
    defeat_ids: List[str] = []

    for idx, objective in enumerate(objectives):
        objective_id = str(objective.get("id") or f"objective_{idx + 1}")
        met = _objective_met(state, objective)
        statuses[objective_id] = met
        result = str(objective.get("result", "victory")).lower()
        if result == "defeat":
            defeat_ids.append(objective_id)
        else:
            victory_ids.append(objective_id)

    victory_met = bool(victory_ids) and all(statuses.get(oid, False) for oid in victory_ids)
    defeat_met = any(statuses.get(oid, False) for oid in defeat_ids)
    return {
        "statuses": statuses,
        "victory_met": victory_met,
        "defeat_met": defeat_met,
        "victory_objectives": victory_ids,
        "defeat_objectives": defeat_ids,
    }


def expand_objective_packs(
    objectives: List[Dict[str, object]],
    objective_packs: List[Dict[str, object]],
) -> List[Dict[str, object]]:
    out: List[Dict[str, object]] = [dict(obj) for obj in objectives]
    for idx, pack in enumerate(objective_packs):
        pack_id = str(pack.get("id") or f"pack_{idx + 1}")
        pack_type = str(pack.get("type") or "")
        if pack_type == "eliminate_team":
            out.append(
                {
                    "id": f"{pack_id}_eliminate_team",
                    "type": "team_eliminated",
                    "team": str(pack.get("team", "")),
                    "result": str(pack.get("result", "victory")),
                }
            )
        elif pack_type == "escape_unit":
            unit_id = str(pack.get("unit_id", ""))
            out.append(
                {
                    "id": f"{pack_id}_escape",
                    "type": "unit_reach_tile",
                    "unit_id": unit_id,
                    "x": int(pack.get("x", 0)),
                    "y": int(pack.get("y", 0)),
                    "result": "victory",
                }
            )
            if bool(pack.get("defeat_on_death", True)):
                out.append(
                    {
                        "id": f"{pack_id}_unit_dead",
                        "type": "unit_dead",
                        "unit_id": unit_id,
                        "result": "defeat",
                    }
                )
        elif pack_type == "holdout":
            out.append(
                {
                    "id": f"{pack_id}_holdout_rounds",
                    "type": "round_at_least",
                    "round": int(pack.get("round", 1)),
                    "result": "victory",
                }
            )
            protect_team = pack.get("protect_team")
            if isinstance(protect_team, str) and protect_team:
                out.append(
                    {
                        "id": f"{pack_id}_protect_team",
                        "type": "team_eliminated",
                        "team": protect_team,
                        "result": "defeat",
                    }
                )
    return out
