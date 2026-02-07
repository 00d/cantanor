from __future__ import annotations

import unittest

from engine.core.reducer import apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


def _spawn_base_scenario() -> dict:
    return {
        "battle_id": "spawn_command_contracts",
        "seed": 90210,
        "map": {"width": 6, "height": 6, "blocked": []},
        "units": [
            {
                "id": "summoner",
                "team": "pc",
                "hp": 20,
                "position": [2, 2],
                "initiative": 20,
                "attack_mod": 7,
                "ac": 16,
                "damage": "1d8+3",
                "fortitude": 6,
                "reflex": 6,
                "will": 6,
            },
            {
                "id": "enemy",
                "team": "enemy",
                "hp": 20,
                "position": [4, 4],
                "initiative": 10,
                "attack_mod": 6,
                "ac": 15,
                "damage": "1d8+2",
                "fortitude": 5,
                "reflex": 5,
                "will": 5,
            },
        ],
        "commands": [],
    }


class TestSpawnCommands(unittest.TestCase):
    def test_spawn_unit_adds_unit_and_keeps_active_actor(self) -> None:
        state = battle_state_from_scenario(_spawn_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, events = apply_command(
            state,
            {
                "type": "spawn_unit",
                "actor": "summoner",
                "placement_policy": "exact",
                "unit": {
                    "id": "ally_1",
                    "team": "pc",
                    "hp": 14,
                    "position": [1, 2],
                    "initiative": 12,
                    "attack_mod": 5,
                    "ac": 15,
                    "damage": "1d6+2",
                    "fortitude": 4,
                    "reflex": 5,
                    "will": 5,
                },
            },
            rng,
        )

        self.assertEqual(events[0]["type"], "spawn_unit")
        self.assertIn("ally_1", state.units)
        self.assertEqual(state.active_unit_id, "summoner")
        self.assertEqual(state.units["summoner"].actions_remaining, 3)
        self.assertIn("ally_1", state.turn_order)

    def test_spawn_unit_nearest_open_uses_closest_available_tile(self) -> None:
        scenario = _spawn_base_scenario()
        scenario["map"]["blocked"] = [[1, 1], [2, 1], [3, 1], [1, 2]]
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)

        state, _events = apply_command(
            state,
            {
                "type": "spawn_unit",
                "actor": "summoner",
                "placement_policy": "nearest_open",
                "unit": {
                    "id": "ally_2",
                    "team": "pc",
                    "hp": 14,
                    "position": [2, 2],
                    "initiative": 11,
                    "attack_mod": 5,
                    "ac": 15,
                    "damage": "1d6+2",
                    "fortitude": 4,
                    "reflex": 5,
                    "will": 5,
                },
            },
            rng,
        )

        self.assertEqual((state.units["ally_2"].x, state.units["ally_2"].y), (3, 2))

    def test_spawn_unit_preserves_condition_immunities(self) -> None:
        state = battle_state_from_scenario(_spawn_base_scenario())
        rng = DeterministicRNG(seed=state.seed)

        state, _events = apply_command(
            state,
            {
                "type": "spawn_unit",
                "actor": "summoner",
                "placement_policy": "exact",
                "unit": {
                    "id": "ally_immune",
                    "team": "pc",
                    "hp": 14,
                    "temp_hp": 2,
                    "position": [1, 2],
                    "initiative": 12,
                    "attack_mod": 5,
                    "ac": 15,
                    "damage": "1d6+2",
                    "fortitude": 4,
                    "reflex": 5,
                    "will": 5,
                    "condition_immunities": ["Frightened", "all_conditions"],
                },
            },
            rng,
        )

        spawned = state.units["ally_immune"]
        self.assertEqual(spawned.condition_immunities, ["frightened", "all_conditions"])
        self.assertEqual(spawned.temp_hp, 2)


if __name__ == "__main__":
    unittest.main()
