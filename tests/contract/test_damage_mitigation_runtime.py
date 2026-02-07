from __future__ import annotations

import json
import os
import tempfile
import unittest

from engine.core.reducer import apply_command
from engine.core.rng import DeterministicRNG
from engine.io.scenario_loader import battle_state_from_scenario


class TestDamageMitigationRuntime(unittest.TestCase):
    def test_modeled_damage_applies_resistance_weakness_and_immunity(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_modeled",
            "seed": 601,
            "map": {"width": 8, "height": 8, "blocked": []},
            "units": [
                {
                    "id": "hazard_core",
                    "team": "hazard",
                    "hp": 999,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 0,
                    "ac": 10,
                    "damage": "1d1",
                },
                {
                    "id": "pc_modded",
                    "team": "pc",
                    "hp": 30,
                    "position": [2, 1],
                    "initiative": 12,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "resistances": {"fire": 4},
                    "weaknesses": {"fire": 2},
                },
                {
                    "id": "pc_immune",
                    "team": "pc",
                    "hp": 30,
                    "position": [3, 1],
                    "initiative": 10,
                    "attack_mod": 7,
                    "ac": 17,
                    "damage": "1d8+3",
                    "immunities": ["fire"],
                },
            ],
            "commands": [],
        }
        model = {
            "hazards": {
                "entries": [
                    {
                        "hazard_id": "mitigation-demo",
                        "hazard_name": "Mitigation Demo",
                        "sources": [
                            {
                                "source_type": "trigger_action",
                                "source_name": "Burn",
                                "effects": [
                                    {"kind": "damage", "formula": "10", "damage_type": "fire"},
                                ],
                            }
                        ],
                    }
                ]
            }
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(model, tmp)
            model_path = tmp.name

        try:
            state = battle_state_from_scenario(scenario)
            rng = DeterministicRNG(seed=state.seed)
            state, events = apply_command(
                state,
                {
                    "type": "trigger_hazard_source",
                    "actor": "hazard_core",
                    "hazard_id": "mitigation-demo",
                    "source_name": "Burn",
                    "source_type": "trigger_action",
                    "model_path": model_path,
                },
                rng,
            )
        finally:
            os.unlink(model_path)

        results = {entry["target"]: entry for entry in events[0]["payload"]["results"]}
        self.assertEqual(results["pc_modded"]["damage"]["raw_total"], 10)
        self.assertEqual(results["pc_modded"]["damage"]["applied_total"], 8)
        self.assertEqual(results["pc_immune"]["damage"]["raw_total"], 10)
        self.assertEqual(results["pc_immune"]["damage"]["applied_total"], 0)
        self.assertTrue(results["pc_immune"]["damage"]["immune"])
        self.assertEqual(state.units["pc_modded"].hp, 22)
        self.assertEqual(state.units["pc_immune"].hp, 30)

    def test_strike_uses_attack_damage_type_for_mitigation(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_strike",
            "seed": 602,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 100,
                    "ac": 20,
                    "damage": "10",
                    "attack_damage_type": "fire",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 10,
                    "damage": "1d8+2",
                    "resistances": {"fire": 5},
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        damage = events[0]["payload"]["damage"]
        self.assertIsNotNone(damage)
        self.assertEqual(damage["damage_type"], "fire")
        self.assertEqual(damage["total"], max(0, damage["raw_total"] - 5))
        self.assertEqual(state.units["target"].hp, 40 - damage["total"])

    def test_save_damage_uses_damage_type_mitigation(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_save_damage",
            "seed": 603,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 18,
                    "damage": "1d8+2",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 16,
                    "damage": "1d8+2",
                    "weaknesses": {"fire": 3},
                    "reflex": -10,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "save_damage",
                "actor": "caster",
                "target": "target",
                "dc": 30,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "mode": "basic",
            },
            rng,
        )

        damage = events[0]["payload"]["damage"]
        self.assertEqual(damage["weakness_total"], 3)
        self.assertEqual(damage["applied_total"], damage["raw_total"] + 3)
        self.assertEqual(state.units["target"].hp, 40 - damage["applied_total"])

    def test_strike_matches_physical_group_resistance(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_physical_group",
            "seed": 604,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 100,
                    "ac": 20,
                    "damage": "10",
                    "attack_damage_type": "slashing",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 10,
                    "damage": "1d8+2",
                    "resistances": {"physical": 4},
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        damage = events[0]["payload"]["damage"]
        self.assertIsNotNone(damage)
        self.assertEqual(damage["damage_type"], "slashing")
        self.assertEqual(damage["resistance_total"], 4)
        self.assertEqual(damage["total"], max(0, damage["raw_total"] - 4))
        self.assertEqual(state.units["target"].hp, 40 - damage["total"])

    def test_strike_uses_highest_overlapping_resistance(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_highest_resistance",
            "seed": 614,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 100,
                    "ac": 20,
                    "damage": "10",
                    "attack_damage_type": "slashing",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 10,
                    "damage": "1d8+2",
                    "resistances": {"slashing": 2, "physical": 4, "all": 1},
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        damage = events[0]["payload"]["damage"]
        self.assertIsNotNone(damage)
        self.assertEqual(damage["damage_type"], "slashing")
        self.assertEqual(damage["resistance_total"], 4)
        self.assertEqual(damage["total"], max(0, damage["raw_total"] - 4))
        self.assertEqual(state.units["target"].hp, 40 - damage["total"])

    def test_strike_can_bypass_matching_resistance_and_immunity(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_bypass_strike",
            "seed": 615,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 100,
                    "ac": 20,
                    "damage": "10",
                    "attack_damage_type": "fire",
                    "attack_damage_bypass": ["fire"],
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 10,
                    "damage": "1d8+2",
                    "resistances": {"fire": 5},
                    "immunities": ["fire"],
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        damage = events[0]["payload"]["damage"]
        self.assertIsNotNone(damage)
        self.assertEqual(damage["damage_type"], "fire")
        self.assertEqual(damage["bypass"], ["fire"])
        self.assertFalse(damage["immune"])
        self.assertEqual(damage["resistance_total"], 0)
        self.assertEqual(damage["total"], damage["raw_total"])
        self.assertEqual(state.units["target"].hp, 40 - damage["total"])

    def test_save_damage_matches_energy_group_weakness(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_energy_group",
            "seed": 605,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 18,
                    "damage": "1d8+2",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 16,
                    "damage": "1d8+2",
                    "weaknesses": {"energy": 2},
                    "reflex": -10,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "save_damage",
                "actor": "caster",
                "target": "target",
                "dc": 30,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "mode": "basic",
            },
            rng,
        )

        damage = events[0]["payload"]["damage"]
        self.assertEqual(damage["damage_type"], "fire")
        self.assertEqual(damage["weakness_total"], 2)
        self.assertEqual(damage["applied_total"], damage["raw_total"] + 2)
        self.assertEqual(state.units["target"].hp, 40 - damage["applied_total"])

    def test_save_damage_can_bypass_matching_immunity(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_bypass_save_damage",
            "seed": 616,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 18,
                    "damage": "1d8+2",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 16,
                    "damage": "1d8+2",
                    "immunities": ["fire"],
                    "reflex": -10,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "save_damage",
                "actor": "caster",
                "target": "target",
                "dc": 30,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "damage_bypass": ["fire"],
                "mode": "basic",
            },
            rng,
        )

        damage = events[0]["payload"]["damage"]
        self.assertEqual(damage["bypass"], ["fire"])
        self.assertFalse(damage["immune"])
        self.assertGreater(damage["applied_total"], 0)
        self.assertEqual(state.units["target"].hp, 40 - damage["applied_total"])

    def test_area_save_damage_can_bypass_matching_immunity(self) -> None:
        scenario = {
            "battle_id": "damage_mitigation_bypass_area_save_damage",
            "seed": 618,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 18,
                    "damage": "1d8+2",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 16,
                    "damage": "1d8+2",
                    "immunities": ["fire"],
                    "reflex": -10,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "area_save_damage",
                "actor": "caster",
                "center_x": 1,
                "center_y": 1,
                "radius_feet": 10,
                "dc": 30,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "damage_bypass": ["fire"],
                "mode": "basic",
            },
            rng,
        )

        resolution = events[0]["payload"]["resolutions"][0]
        damage = resolution["damage"]
        self.assertEqual(damage["bypass"], ["fire"])
        self.assertFalse(damage["immune"])
        self.assertGreater(damage["applied_total"], 0)
        self.assertEqual(state.units["target"].hp, 40 - damage["applied_total"])

    def test_strike_consumes_temp_hp_before_hp(self) -> None:
        scenario = {
            "battle_id": "damage_temp_hp_strike",
            "seed": 606,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "attacker",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 100,
                    "ac": 20,
                    "damage": "10",
                    "attack_damage_type": "slashing",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "temp_hp": 5,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 6,
                    "ac": 10,
                    "damage": "1d8+2",
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(state, {"type": "strike", "actor": "attacker", "target": "target"}, rng)

        damage = events[0]["payload"]["damage"]
        self.assertEqual(damage["total"], 20)
        self.assertEqual(damage["temp_hp_absorbed"], 5)
        self.assertEqual(state.units["target"].temp_hp, 0)
        self.assertEqual(state.units["target"].hp, 25)

    def test_save_damage_consumes_temp_hp_before_hp(self) -> None:
        scenario = {
            "battle_id": "damage_temp_hp_save",
            "seed": 607,
            "map": {"width": 6, "height": 6, "blocked": []},
            "units": [
                {
                    "id": "caster",
                    "team": "pc",
                    "hp": 25,
                    "position": [1, 1],
                    "initiative": 20,
                    "attack_mod": 6,
                    "ac": 18,
                    "damage": "1d8+2",
                },
                {
                    "id": "target",
                    "team": "enemy",
                    "hp": 40,
                    "temp_hp": 3,
                    "position": [2, 1],
                    "initiative": 10,
                    "attack_mod": 5,
                    "ac": 16,
                    "damage": "1d8+2",
                    "reflex": -100,
                },
            ],
            "commands": [],
        }
        state = battle_state_from_scenario(scenario)
        rng = DeterministicRNG(seed=state.seed)
        state, events = apply_command(
            state,
            {
                "type": "save_damage",
                "actor": "caster",
                "target": "target",
                "dc": 30,
                "save_type": "Reflex",
                "damage": "10",
                "damage_type": "fire",
                "mode": "basic",
            },
            rng,
        )

        damage = events[0]["payload"]["damage"]
        self.assertEqual(damage["applied_total"], 20)
        self.assertEqual(damage["temp_hp_absorbed"], 3)
        self.assertEqual(state.units["target"].temp_hp, 0)
        self.assertEqual(state.units["target"].hp, 23)


if __name__ == "__main__":
    unittest.main()
