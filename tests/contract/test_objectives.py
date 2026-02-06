from __future__ import annotations

import unittest

from engine.core.objectives import evaluate_objectives
from engine.io.scenario_loader import battle_state_from_scenario


def _scenario() -> dict:
    return {
        "battle_id": "objectives_contract",
        "seed": 5150,
        "map": {"width": 6, "height": 6, "blocked": []},
        "units": [
            {
                "id": "pc",
                "team": "pc",
                "hp": 20,
                "position": [1, 1],
                "initiative": 15,
                "attack_mod": 6,
                "ac": 16,
                "damage": "1d8+3",
            },
            {
                "id": "enemy",
                "team": "enemy",
                "hp": 20,
                "position": [3, 3],
                "initiative": 10,
                "attack_mod": 5,
                "ac": 15,
                "damage": "1d6+2",
            },
        ],
        "commands": [],
        "flags": {"gate_open": False},
    }


class TestObjectives(unittest.TestCase):
    def test_victory_and_defeat_objective_evaluation(self) -> None:
        state = battle_state_from_scenario(_scenario())
        objectives = [
            {"id": "open_gate", "type": "flag_set", "flag": "gate_open", "value": True, "result": "victory"},
            {"id": "pc_dead", "type": "unit_dead", "unit_id": "pc", "result": "defeat"},
        ]

        res = evaluate_objectives(state, objectives)
        self.assertFalse(res["victory_met"])
        self.assertFalse(res["defeat_met"])

        state.flags["gate_open"] = True
        res = evaluate_objectives(state, objectives)
        self.assertTrue(res["victory_met"])
        self.assertFalse(res["defeat_met"])

    def test_round_and_team_objectives(self) -> None:
        state = battle_state_from_scenario(_scenario())
        objectives = [
            {"id": "survive_two", "type": "round_at_least", "round": 2, "result": "victory"},
            {"id": "enemies_down", "type": "team_eliminated", "team": "enemy", "result": "victory"},
        ]

        res = evaluate_objectives(state, objectives)
        self.assertFalse(res["victory_met"])
        state.round_number = 2
        state.units["enemy"].hp = 0
        res = evaluate_objectives(state, objectives)
        self.assertTrue(res["victory_met"])


if __name__ == "__main__":
    unittest.main()
