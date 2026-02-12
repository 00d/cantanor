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
npm run test         # Run all tests (Vitest) — 176 tests, 12 files
npm run test:watch   # Watch mode
npm run test:ui      # Interactive Vitest UI
npm run preview      # Preview production build
```

Run a single test file: `npx vitest run src/path/to/file.test.ts`

## Architecture Overview

The app is a split viewport: left 62% is a PixiJS WebGL canvas, right 38% is React UI panels.

```
src/
  engine/       Pure functional state machine (reducer, commands, RNG, turn order)
  effects/      Effect lifecycle handlers (damage, conditions, summons, movement)
  rules/        PF2e mechanics (checks, saves, degrees of success, damage)
  grid/         BFS pathfinding, line-of-sight, area shapes
  io/           Scenario loading, content packs, Tiled map bridge, AI orchestration
  rendering/    PixiJS layers — tilemap, sprites, range overlay, camera
  store/        Zustand battle store (state, dispatch, AI scheduling)
  ui/           React components (ActionPanel, PartyPanel, CombatLogPanel, designer)
```

See `CLAUDE.md` for development guidance and detailed architecture notes.

## Current Status

**Phase 10 complete** — end-to-end playable battles:

- Player controls PC units, AI controls enemies (420ms turn delay)
- Move, Strike, Cast Spell, Use Feat, Use Item actions
- BFS movement highlighting and LOS-gated strike targets
- Victory/defeat detection via scenario objectives
- Battle-end overlay with stats and Play Again
- Content pack abilities (spells, feats, items)
- Tiled `.tmj` map loading with GPU-batched tile rendering
- In-app scenario designer (Inspector, File Browser, map preview)
- Inspect any unit mid-combat to see its stats without interrupting the turn

See `ROADMAP.md` for upcoming phases (rich terrain, character depth, campaign flow, polish).

## Test Scenarios

Pre-built scenarios are served from `public/scenarios/smoke/` (38 files covering engine phases 3–10). The interactive arena (`interactive_arena.json`, 2 PCs vs 2 enemies) is the primary playtest scenario. The Tiled map `public/maps/dungeon_arena_01.tmj` provides a 12×10 rendered arena.

## Content Packs

`public/content_packs/phase10_v1.json` — spells, feats, and items used by the interactive arena.
Source game-design data lives in `corpus/content_packs/`.
