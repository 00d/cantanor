# Content Authoring Guide

Guide for game designers creating scenarios, abilities, and encounters for Cantanor.

---

## Quick Start

### Creating Your First Scenario

1. **Copy a template:**
```bash
cp scenarios/regression_phase4/01_objective_flag.json scenarios/my_encounter.json
```

2. **Edit the scenario:**
```json
{
  "battle_id": "my_encounter_v1",
  "seed": 12345,
  "map": {
    "width": 10,
    "height": 10,
    "blocked": [[2, 3], [2, 4]]  // Wall at (2,3) and (2,4)
  },
  "units": [
    {
      "id": "hero",
      "team": "player",
      "hp": 25,
      "position": [1, 1],
      "initiative": 15,
      "attack_mod": 8,
      "ac": 18,
      "damage": "1d8+4"
    },
    {
      "id": "goblin",
      "team": "enemy",
      "hp": 10,
      "position": [8, 8],
      "initiative": 12,
      "attack_mod": 5,
      "ac": 15,
      "damage": "1d6+2"
    }
  ],
  "commands": [
    { "type": "strike", "actor": "hero", "target": "goblin" },
    { "type": "end_turn", "actor": "hero" }
  ],
  "objectives": [
    {
      "id": "defeat_goblins",
      "type": "team_eliminated",
      "team": "enemy",
      "result": "victory"
    }
  ]
}
```

3. **Test it:**
```bash
npx tsx scripts-ts/runScenario.ts scenarios/my_encounter.json
```

---

## Scenario Format Reference

### Top-Level Structure

```json
{
  "battle_id": "unique_identifier",    // Required
  "seed": 12345,                       // Required - RNG seed
  "engine_phase": 9,                   // Optional - defaults to 7
  "map": { ... },                      // Required
  "units": [ ... ],                    // Required
  "commands": [ ... ],                 // Required (can be empty)
  "flags": { ... },                    // Optional
  "objectives": [ ... ],               // Optional
  "mission_events": [ ... ],           // Optional
  "reinforcement_waves": [ ... ],      // Optional
  "hazard_routines": [ ... ],          // Optional
  "enemy_policy": { ... },             // Optional
  "content_packs": [ ... ]             // Optional
}
```

### Map Configuration

```json
"map": {
  "width": 10,        // Required - map width in tiles
  "height": 10,       // Required - map height in tiles
  "blocked": [        // Optional - impassable tiles
    [2, 3],          // Block tile at x=2, y=3
    [2, 4],
    [5, 5]
  ]
}
```

### Unit Definition

```json
{
  "id": "hero_fighter",              // Required - unique ID
  "team": "player",                  // Required - "player", "enemy", "neutral"
  "hp": 25,                          // Required - current HP
  "position": [1, 1],                // Required - [x, y]
  "initiative": 15,                  // Required - turn order
  "attack_mod": 8,                   // Required - attack bonus
  "ac": 18,                          // Required - armor class
  "damage": "1d8+4",                 // Required - damage formula

  // Optional - saves
  "fortitude": 7,
  "reflex": 5,
  "will": 4,

  // Optional - damage types
  "attack_damage_type": "slashing",
  "attack_damage_bypass": ["physical"],

  // Optional - defensive traits
  "resistances": { "fire": 5 },
  "weaknesses": { "cold": 5 },
  "immunities": ["poison"],
  "condition_immunities": ["frightened"],

  // Optional - temp HP
  "temp_hp": 5
}
```

### Commands

#### Strike
```json
{
  "type": "strike",
  "actor": "hero",
  "target": "goblin"
}
```

#### Move
```json
{
  "type": "move",
  "actor": "hero",
  "x": 5,
  "y": 5
}
```

#### Cast Spell (with content pack)
```json
{
  "type": "cast_spell",
  "actor": "wizard",
  "content_entry_id": "pf2e-core.magic-missile",
  "target": "goblin",
  "dc": 18
}
```

#### Save Damage (direct)
```json
{
  "type": "save_damage",
  "actor": "wizard",
  "target": "goblin",
  "dc": 18,
  "save_type": "Reflex",
  "damage": "2d6",
  "damage_type": "fire"
}
```

#### Area Damage
```json
{
  "type": "area_save_damage",
  "actor": "wizard",
  "center_x": 5,
  "center_y": 5,
  "radius_feet": 20,
  "dc": 18,
  "save_type": "Reflex",
  "damage": "6d6",
  "damage_type": "fire"
}
```

#### End Turn
```json
{
  "type": "end_turn",
  "actor": "hero"
}
```

### Objectives

#### Team Eliminated
```json
{
  "id": "defeat_enemies",
  "type": "team_eliminated",
  "team": "enemy",
  "result": "victory"
}
```

#### Unit Reaches Tile
```json
{
  "id": "escape",
  "type": "unit_reach_tile",
  "unit_id": "hero",
  "x": 9,
  "y": 9,
  "result": "victory"
}
```

#### Flag Set
```json
{
  "id": "gate_open",
  "type": "flag_set",
  "flag": "gate_unlocked",
  "value": true,
  "result": "victory"
}
```

#### Survive Rounds
```json
{
  "id": "survive",
  "type": "round_at_least",
  "round": 5,
  "result": "victory"
}
```

#### Unit Status
```json
{
  "id": "hero_dies",
  "type": "unit_dead",
  "unit_id": "hero",
  "result": "defeat"
}
```

### Enemy Policy (AI)

```json
"enemy_policy": {
  "enabled": true,
  "teams": ["enemy"],
  "action": "strike_nearest",       // or "cast_spell_entry_nearest"
  "auto_end_turn": true,
  "include_rationale": false,       // Set true for debugging

  // For spell casting:
  "content_entry_id": "pf2e-core.magic-missile",
  "dc": 18
}
```

**Available actions:**
- `strike_nearest` - Basic melee/ranged attack
- `cast_spell_entry_nearest` - Cast spell at nearest enemy
- `use_feat_entry_self` - Use feat on self
- `use_item_entry_self` - Use item on self
- `interact_entry_self` - Interact action on self

### Reinforcement Waves

```json
"reinforcement_waves": [
  {
    "id": "goblin_reinforcements",
    "trigger": "round_start",      // or "turn_start"
    "round": 3,
    "once": true,
    "placement_policy": "exact",   // or "nearest_open"
    "units": [
      {
        "id": "goblin_2",
        "team": "enemy",
        "hp": 10,
        "position": [9, 9],
        "initiative": 10,
        "attack_mod": 5,
        "ac": 15,
        "damage": "1d6+2"
      }
    ]
  }
]
```

### Mission Events

```json
"mission_events": [
  {
    "id": "trap_trigger",
    "trigger": "unit_reach_tile",
    "unit_id": "hero",
    "x": 5,
    "y": 5,
    "commands": [
      {
        "type": "save_damage",
        "actor": "hero",
        "target": "hero",
        "dc": 15,
        "save_type": "Reflex",
        "damage": "2d6",
        "damage_type": "fire"
      }
    ]
  }
]
```

**Available triggers:**
- `turn_start` - Every turn
- `round_start` - Every round (turn_index = 0)
- `unit_dead` - When specific unit dies
- `unit_alive` - When specific unit is alive
- `flag_set` - When flag matches value

---

## Content Packs

### Creating a Content Pack

1. **Create the JSON file:**
```bash
mkdir -p corpus/content_packs
nano corpus/content_packs/my_spells.json
```

2. **Define the pack:**
```json
{
  "pack_id": "my-spells-v1",
  "version": "1.0.0",
  "compatibility": {
    "min_engine_phase": 7,
    "max_engine_phase": 9,
    "feature_tags": ["spells", "combat"]
  },
  "entries": [
    {
      "id": "my-spells.fireball",
      "kind": "spell",
      "source_ref": "Custom",
      "tags": ["evocation", "fire", "area"],
      "payload": {
        "command_type": "cast_spell",
        "spell_id": "fireball",
        "save_type": "Reflex",
        "damage": "6d6",
        "damage_type": "fire",
        "mode": "basic",
        "action_cost": 2
      }
    }
  ]
}
```

3. **Use in scenario:**
```json
{
  "content_packs": ["../../corpus/content_packs/my_spells.json"],
  "content_pack_id": "my-spells-v1",
  "commands": [
    {
      "type": "cast_spell",
      "actor": "wizard",
      "content_entry_id": "my-spells.fireball",
      "target": "goblin",
      "dc": 18
    }
  ]
}
```

---

## Testing & Debugging

### Run a Scenario

```bash
# With Node/TypeScript
npx tsx scripts-ts/runScenario.ts scenarios/my_encounter.json

# In browser (dev mode)
npm run dev
# Navigate to http://localhost:5173
```

### Verify Determinism

```bash
# Run twice, check hash matches
npx tsx scripts-ts/runScenario.ts scenarios/my_encounter.json > run1.json
npx tsx scripts-ts/runScenario.ts scenarios/my_encounter.json > run2.json
diff run1.json run2.json  # Should be identical
```

### Debug RNG Issues

If you need specific outcomes:
```json
{
  "seed": 12345,  // Try different seeds until you get desired roll
  "units": [{
    "attack_mod": 100  // Or use extreme modifiers to guarantee hits
  }]
}
```

### Generate Regression Baseline

After creating a new scenario, generate its baseline:
```bash
npx tsx scripts-ts/generateRegressionBaselines.ts
```

This updates `scenarios/regression_phase*/expected_hashes_ts.json`.

---

## Damage Formulas

**Dice notation:** `NdX+Y` where N=count, X=die size, Y=flat modifier

Examples:
- `1d20` - Single d20 roll
- `2d6+3` - Two d6 dice plus 3
- `3d8` - Three d8 dice, no modifier
- `10` - Flat 10 damage (no dice)

**Multipliers:**
- Critical hits: 2x dice (not flat modifier)
- Vulnerabilities: Additive after dice roll

---

## Common Patterns

### Simple Duel
```json
{
  "battle_id": "duel",
  "seed": 101,
  "map": { "width": 5, "height": 5, "blocked": [] },
  "units": [
    { "id": "fighter", "team": "player", "hp": 30, "position": [1, 2], ... },
    { "id": "goblin", "team": "enemy", "hp": 15, "position": [3, 2], ... }
  ],
  "commands": [],
  "enemy_policy": { "enabled": true, "action": "strike_nearest" }
}
```

### Timed Escape
```json
{
  "objectives": [
    { "id": "escape", "type": "unit_reach_tile", "unit_id": "hero", "x": 9, "y": 9, "result": "victory" },
    { "id": "timeout", "type": "round_at_least", "round": 6, "result": "defeat" }
  ]
}
```

### Wave Defense
```json
{
  "reinforcement_waves": [
    { "id": "wave1", "round": 2, "units": [...] },
    { "id": "wave2", "round": 4, "units": [...] },
    { "id": "wave3", "round": 6, "units": [...] }
  ],
  "objectives": [
    { "id": "survive", "type": "round_at_least", "round": 8, "result": "victory" }
  ]
}
```

---

## Tips & Best Practices

1. **Start small** - Test 1v1 before complex multi-unit battles
2. **Use high seeds** - Avoid seed=1,2,3 (poor RNG distribution)
3. **Test determinism** - Run twice, verify identical output
4. **Version scenarios** - Use `_v1`, `_v2` suffixes when iterating
5. **Check command errors** - Look for `"type": "command_error"` in event log
6. **Use enemy_policy** - Easier than scripting every AI action
7. **Log rationale** - Set `include_rationale: true` to debug AI decisions

---

## Troubleshooting

### "Unit not found" error
- Check unit IDs match exactly (case-sensitive)
- Verify actor is in `units` array

### "Command type unsupported"
- Check `type` field spelling
- Ensure engine_phase supports that command

### "Content pack not found"
- Check file path is relative to scenario
- Verify `content_pack_id` matches pack's `pack_id`

### RNG gives unexpected results
- Different seed = different rolls
- TypeScript uses Mulberry32 (not Python's MT19937)
- Use extreme modifiers (`attack_mod: 100`) to guarantee outcomes

### Scenario doesn't end
- Check objectives are achievable
- Add `max_steps` field to prevent infinite loops
- Verify enemy_policy is enabled if no scripted commands

---

## Resources

- **Example scenarios:** `scenarios/regression_phase*/`
- **Content packs:** `corpus/content_packs/`
- **Effect models:** `compiled/tactical_effect_models_v1.json`
- **Game design workflow:** `GAME_DESIGN_WORKFLOW.md`
- **Python deletion checklist:** `PYTHON_DELETION_CHECKLIST.md`

---

## Getting Help

1. Check example scenarios for similar patterns
2. Review test files in `src/**/*.test.ts`
3. Read engine source in `src/engine/`
4. Check event log for detailed error messages
