# Browser Tactical TRPG Analysis

This document explains how the current repository files can drive a browser-based tactical RPG that looks like classic Fire Emblem (2D tile combat readability) while supporting Final Fantasy Tactics-style unit customization depth.

## Target gameplay interpretation

- Fire Emblem-style presentation means fast tile-map readability, movement/attack overlays, and combat forecast UX.
- FFT-style flexibility means deep build combinatorics across classes, archetypes, feats, spells, and equipment.

## What this repo already provides

| File group | Tactical RPG use | Notes |
|---|---|---|
| `corpus/index.json` | Master content registry for build/import pipeline | Primary book/source inventory with quality metrics |
| `corpus/books/*/book.json` | Per-book metadata for rule source tracking | Useful for provenance and feature gating |
| `corpus/books/*/links/*` | Stable pointers to source PDF, parsed output, and extracted text | Good for reproducible build jobs |
| `extracted/*/metadata.json` | Chapter/section boundaries and page spans | Enables deterministic text chunking |
| `extracted/Core_Rulebook/09_chapter_9_playing_the_game.txt` | Core tactical turn loop model | Contains encounter mode, initiative, rounds, actions/reactions |
| `extracted/Core_Rulebook/10b_appendix_conditions.txt` | Status/condition rules for combat engine | Condition system foundation |
| `extracted/Core_Rulebook/03_chapter_3_classes.txt` | Base class progression and class actions | Starter for player unit archetypes |
| `extracted/Core_Rulebook/04_chapter_4_skills.txt` | Skill checks and tactical/non-tactical checks | Supports ability checks and utility actions |
| `extracted/Core_Rulebook/05_chapter_5_feats.txt` | Build-defining options | Core progression layer |
| `extracted/Core_Rulebook/06_chapter_6_equipment.txt` | Weapons/armor/items | Combat loadout data |
| `extracted/Core_Rulebook/07_chapter_7_spells.txt` | Spell action definitions and effects | Tactical skill catalog |
| `extracted/Advanced_Players_Guide/*.txt` | Expanded class, archetype, feat, spell pools | Major build-depth expansion |
| `extracted/Guns_Amp_Gears/*.txt` | Firearm/inventor/gunslinger systems | Adds ranged archetypes and gear systems |
| `extracted/Dark_Archive/*.txt` | Psychic/Thaumaturge and related content | Additional class subsystem diversity |
| `extracted/Bestiary1/creatures_*.txt`, `extracted/Bestiary2/creatures_*.txt` | Enemy unit statblocks and encounter actors | Best source for hostile unit data |
| `extracted/Abomination_Vaults/*.txt` | Mission/scenario and encounter narrative source | Campaign map/chapter structure input |
| `extracted/Game_Mastery_Guide/*.txt` | Encounter design, subsystems, variants | Rules for tactical scenario systems |
| `extracted/RemasterPlayerCoreCharacterSheet/00_full_content.txt` | UI field modeling for character sheet screens | Practical data-entry/reference scaffold |

## Important constraints found in current data

- `extracted/Bestiary1/creatures.json` and `extracted/Bestiary2/creatures.json` include creature shells, but attack/spell/ability arrays are currently empty; do not treat them as complete runtime combat data.
- Most class/feat/spell content is text blocks, so robust parser/normalizer work is required before runtime use.
- No graphical tile, sprite, animation, or map art assets are in this repository.
- Extracted text contains legacy publication/legal text mixed into content; ingestion should isolate mechanics from notices/front/back matter.

## Recommended browser architecture

### 1) Build-time rule compiler

- Inputs: `corpus/index.json`, `corpus/books/*/book.json`, `extracted/*/metadata.json`, `extracted/*/*.txt`.
- Outputs: versioned normalized packs such as `rules.actions.json`, `rules.conditions.json`, `rules.classes.json`, `rules.feats.json`, `rules.spells.json`, `rules.items.json`, `rules.creatures.json`, and `campaigns.abomination_vaults.json`.

### 2) Tactical simulation core

- Grid/pathfinding module for square-tile movement, terrain cost, line blocking, and occupancy.
- Turn/initiative module for rounds, action economy, and reaction timing windows.
- Effect/condition module for duration, triggers, stacking, and modifier resolution.
- Combat resolver for check/DC resolution, degrees of success, damage, and trait interactions.
- AI decision module using parsed creature actions and tactical goals.

### 3) Presentation layer (FE readability + FFT depth)

- FE-like combat overlays: move range, attack range, threat range, and forecast panels.
- FFT-like build interface: class/archetype planning, feat loadouts, spell loadouts, and progression previews.
- Scenario UI: mission briefing, objectives, turn recap, rewards, and progression transitions.

### 4) Runtime content service

- Serve precompiled content packs through CDN/API.
- Preserve provenance fields from `book.json` and `metadata.json` in compiled records.
- Ship content by source/campaign pack to minimize browser payload size.

## ORC/remaster handling approach for this repo

- Treat this repository as source material and provenance input, not directly as deploy-ready game data.
- Keep source references per record so rule text/mechanics can be traced to specific books and page ranges.
- Separate mechanical data from trademark/legal text during parsing.
- Store remaster-era and pre-remaster-era content with explicit source tags and compatibility flags.

## Practical implementation order

1. Implement parser + normalizer for `Core_Rulebook` combat chapters (`09`, `10b`) and build a minimal tactical engine loop.
2. Add classes/feats/spells/equipment parsing from core + APG for player unit builds.
3. Parse bestiary chapter text into complete enemy combat actions and add encounter AI.
4. Add scenario compiler for `Abomination_Vaults` to produce mission-ready tactical content.
5. Expand with `Game_Mastery_Guide`, `Guns_Amp_Gears`, and `Dark_Archive` subsystems for long-term depth.
