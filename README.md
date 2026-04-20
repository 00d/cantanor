# Cantanor

Browser-based tactical TRPG built on Pathfinder 2e ORC mechanics. Turn-based combat, deterministic engine, Tiled map support.

**Stack:** TypeScript · React 19 · PixiJS 8 (WebGL) · Zustand · Vite · Vitest

## Quick Start

```bash
npm install
npm run dev        # Dev server at localhost:5173
```

## Commands

```bash
npm run dev          # Vite dev server with hot reload
npm run build        # tsc -b && vite build
npm run typecheck    # Type-check without emitting
npm run test         # Run all tests (Vitest) — 352 tests, 23 files
npm run test:watch   # Watch mode
npm run test:ui      # Interactive Vitest UI
npm run preview      # Preview production build
npm run validate:determinism  # 44 smoke scenarios × 2 runs — catches hash drift + command errors
```

Run a single test file: `npx vitest run src/path/to/file.test.ts`

## Architecture Overview

The app is a split viewport: left 62% is a PixiJS WebGL canvas, right 38% is React UI panels.

```
src/
  engine/       Pure functional state machine (reducer, commands, RNG, traits, reactions)
  campaign/     Multi-battle progression, party snapshots, localStorage save/load
  effects/      Effect lifecycle handlers (damage, conditions, summons, movement)
  rules/        PF2e mechanics (checks, saves, degrees of success, damage)
  grid/         8-connected Dijkstra pathfinding, line-of-sight, area shapes
  io/           Scenario loading, content packs, Tiled map bridge, AI orchestration
  rendering/    PixiJS layers — tilemap, sprites, terrain overlay, range overlay, camera
  store/        Zustand battle store (state, dispatch, AI scheduling, reaction queue)
  ui/           React components (ActionPanel, PartyPanel, CharacterSheet, CampScreen)
docs/
  adr/          Architecture Decision Records — permanent design choices
```

See `CLAUDE.md` for development guidance and load-bearing architecture invariants.
See `docs/adr/` for permanent design decisions (e.g. why this codebase has no undo system).

## Current Status

**Phase 15 complete** — two-stage move commit on top of Phase 14 feel parity:

- Hover a reachable tile → white chevron path preview
- First click locks the proposal → green chevrons + `MoveConfirmOverlay` with cost/speed readout
- Second click, Confirm button, or Enter commits; Escape unlocks then exits move mode
- Ghost sprite at the locked destination shows where the unit will land
- AoO threat markers (red rings) on enemies whose reach the path passes through
- `proposedPath` (store) is the single authority for move dispatch — no dual-ownership fallback
- Stale-lock guard auto-clears if the locked destination becomes unreachable

Phase 14 feel layer:

- Sprite tweens: units slide to their destination over ~280ms with quad-ease-out
- Animation-gated AI: enemy turns wait for sprite settlement (rAF poll on `activeAnimCount`), not a fixed delay
- AoE footprint: hover with an area spell armed → blast diamond with LOE-shadowed tiles (what's behind a wall)
- Camera bounds: pan clamps at map edge; small maps centre; zoom-out pulls the target in
- Turn bar: chip hover highlights the unit on the map, click pans the camera there

Phase 13 foundation — full campaign progression on a deep PF2e engine:

- Multi-weapon units (melee/ranged/thrown) with per-weapon-index ammo tracking and reload
- Weapon traits evaluated at runtime: agile, deadly_dN, fatal_dN, volley_N, thrown_N, propulsive
- Shields: Raise Shield action (+2 AC), Shield Block reaction (reduce damage by hardness)
- Reactions: attack_of_opportunity (move provokes from reach), shield_block — with prompt UI
- 8-connected diagonal movement with PF2e alternating-cost Dijkstra and corner-cut prevention
- Tiled `.tmj` maps with `moveCost`/`coverGrade`/`elevation` tile properties; persistent terrain overlay
- 3-stage tutorial campaign with party HP/ammo/conditions carrying between battles
- Camp screen healing between stages; localStorage save/load
- Character sheet panel with AC, saves, resistances, available abilities
- Trait-aware strike forecast: expected damage accounts for deadly/fatal/propulsive on crit
- AI weapon selection: 4-pass strategy (melee → thrown → ranged with ammo check → reload)

See `ROADMAP.md` for Phase 16 (wiring tracked conditions into resolution, off-guard/flanking, Step action).

## Test Scenarios

Pre-built scenarios are served from `public/scenarios/smoke/` (44 files covering engine
phases 3–13). The interactive arena (`interactive_arena.json`) is the primary playtest
scenario. Tiled maps in `public/maps/`: `dungeon_arena_01`, `castle_courtyard`,
`forest_clearing`, `dungeon_corridor`. The tutorial campaign
(`public/campaigns/tutorial_campaign.json`) chains three of these arenas.

## Content Packs

`public/content_packs/phase10_v1.json` — spells, feats, and items used by the interactive arena.
Source game-design data lives in `corpus/content_packs/`.
