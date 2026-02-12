# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cantanor** is a deterministic tactical TRPG browser game implementing Pathfinder 2e ORC rules. Built with TypeScript, React 19, PixiJS 8 (WebGL), and Zustand.

## Commands

```bash
npm run dev          # Start Vite dev server with hot reload
npm run build        # TypeScript compile + Vite production build (tsc -b && vite build)
npm run typecheck    # Type-check without emitting (tsc --noEmit)
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run test:ui      # Run tests with interactive Vitest UI
npm run preview      # Preview production build
```

To run a single test file: `npx vitest run src/path/to/file.test.ts`

## Architecture

### Split-Viewport Layout
The app (`src/ui/App.tsx`) uses a Gold Box-inspired split viewport:
- **Left 62%**: PixiJS WebGL canvas for game rendering
- **Right 38%**: React UI panels (party list, combat log, actions, scenario loader)

### Core Engine (Deterministic)
The game engine is a pure functional state machine:
- **`src/engine/state.ts`** — Immutable battle state interfaces (units, effects, map, objectives)
- **`src/engine/commands.ts`** — Typed commands (Move, Strike, SaveDamage, ApplyEffect, etc.)
- **`src/engine/reducer.ts`** — Pure reducer: `(state, command, rng) → [nextState, events]` (~54KB)
- **`src/engine/rng.ts`** — Seeded deterministic RNG for replayable battles
- **`src/effects/lifecycle.ts`** — Effect application, expiry, and condition handling
- **`src/effects/handlers/`** — Per-effect-type handlers (damage, condition, summon, movement)
- **`src/rules/`** — Pathfinder 2e rules: checks, saves, damage, degrees of success, conditions

### Store Layer
`src/store/battleStore.ts` (Zustand) segregates state by update frequency:
- **Core battle state** — immutable snapshots, triggers React re-renders
- **Orchestration state** — `orchestratorConfig`, `contentContext`, `contentEntries`, `battleEnded`, `battleOutcome`, `isAiTurn`
- **Transient state** — animation state, mutated directly (no re-renders)
- **UI state** — selection, hover, target mode

`dispatchCommand` now materializes content-entry commands, checks battle-end objectives, and schedules AI turns via a 420ms setTimeout chain. This bridges the gap between the headless `scenarioRunner.ts` orchestration and the interactive browser loop.

### Battle Orchestrator (`src/io/battleOrchestrator.ts`)
Parses `enemy_policy` and `objectives` from raw scenario JSON. Provides:
- `buildOrchestratorConfig(rawScenario)` — extracts AI policy and win/loss conditions
- `checkBattleEnd(state, config)` — evaluates objectives each turn
- `getAiCommand(state, policy)` — selects next AI action (strike_nearest)
- `materializeRawCommand(cmd, contentContext)` — merges content-pack payload before `applyCommand`

### Rendering (`src/rendering/`)
- `pixiApp.ts` — PixiJS application setup; layer order: map → overlay → units → effects → ui
- `rangeOverlay.ts` — Blue/red/purple tile highlights for move range and ability targets
- `cameraController.ts` — Viewport/camera controller
- `spriteManager.ts` — Unit sprite management and animation
- `tiledTilemapRenderer.ts` — Renders Tiled Map Editor `.tmj` maps
- `tilesetLoader.ts` — Loads tileset textures from `.tmj` files
- `effectRenderer.ts` — Visual effects overlay

### Grid & Pathfinding (`src/grid/`)
Handles pathfinding (`reachableTiles` BFS respects `unit.speed`), line-of-sight (LOS), line-of-effect (LOE), terrain costs, and area shapes (cone, burst, line).

### I/O Layer (`src/io/`)
- `scenarioLoader.ts` — Parses scenario JSON into battle state; returns `contentContext` and `rawScenario`; auto-detects Tiled vs hand-written format
- `contentPackLoader.ts` — Fetches and validates content packs; builds `entryLookup`
- `battleOrchestrator.ts` — Interactive loop orchestration (AI policy, objectives, battle-end)
- `tiledLoader.ts` — Parses `.tmj` files into `ResolvedTiledMap` (resolves external tilesets, flips flags)
- `mapDataBridge.ts` — Converts `ResolvedTiledMap` into scenario JSON shape; extracts spawn points, blocked tiles, hazard zones, objectives; auto-generates `enemy_policy` for non-PC teams
- `tiledTypes.ts` — TypeScript types for Tiled `.tmj` format

### Content Packs
JSON files in `public/content_packs/` served by Vite. Scenario JSON references them via `"content_packs": ["/content_packs/phase10_v1.json"]`. Each entry has `id`, `kind` (spell/feat/item), `tags`, and `payload` (command template). The `ActionPanel` renders entries grouped by kind with colour-coded buttons.

### Designer Tools (`src/ui/designer/`)
In-app scenario authoring tools: Scenario Inspector, File Browser, Viewer. Toggled via the Game/Designer mode button in `App.tsx`. The canvas is kept in the DOM (`display:none`) during designer mode so the PixiJS WebGL context is preserved across mode switches.

## Path Aliases

Defined in `vite.config.ts` and `vitest.config.ts`:
```
@engine    → src/engine/
@grid      → src/grid/
@rules     → src/rules/
@effects   → src/effects/
@io        → src/io/
@rendering → src/rendering/
@store     → src/store/
@ui        → src/ui/
```

## Test Infrastructure

Tests use Vitest with jsdom. Test files follow `src/**/*.test.ts(x)`. Coverage areas: areas, LOS, damage, conditions, checks, objectives. The same path aliases apply in tests.

## Assets & Content

- `public/scenarios/smoke/` — 38 smoke-test scenario JSON files (served by Vite)
- `public/content_packs/` — Content pack JSON files served at runtime
- `public/maps/` — Tiled `.tmj` arena files (e.g. `dungeon_arena_01.tmj`)
- `public/tilesets/` — Tileset images referenced by Tiled maps
- `corpus/content_packs/` — Source game-design content pack data (not served directly)
