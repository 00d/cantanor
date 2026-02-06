from __future__ import annotations

import unittest

from engine.core.objectives import expand_objective_packs


class TestObjectivePacks(unittest.TestCase):
    def test_expand_eliminate_and_escape_packs(self) -> None:
        objectives = [{"id": "raw", "type": "flag_set", "flag": "x", "value": True, "result": "victory"}]
        packs = [
            {"id": "elim", "type": "eliminate_team", "team": "enemy"},
            {"id": "escape", "type": "escape_unit", "unit_id": "pc", "x": 5, "y": 7, "defeat_on_death": True},
        ]
        out = expand_objective_packs(objectives=objectives, objective_packs=packs)
        ids = {obj["id"] for obj in out}
        self.assertIn("raw", ids)
        self.assertIn("elim_eliminate_team", ids)
        self.assertIn("escape_escape", ids)
        self.assertIn("escape_unit_dead", ids)

    def test_expand_holdout_pack(self) -> None:
        out = expand_objective_packs(
            objectives=[],
            objective_packs=[{"id": "hold", "type": "holdout", "round": 4, "protect_team": "pc"}],
        )
        by_id = {obj["id"]: obj for obj in out}
        self.assertEqual(by_id["hold_holdout_rounds"]["type"], "round_at_least")
        self.assertEqual(by_id["hold_holdout_rounds"]["round"], 4)
        self.assertEqual(by_id["hold_protect_team"]["type"], "team_eliminated")
        self.assertEqual(by_id["hold_protect_team"]["result"], "defeat")


if __name__ == "__main__":
    unittest.main()
