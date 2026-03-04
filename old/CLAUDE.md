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
- **`src/engine/reducer.ts`** — Pure reducer: `(state, command, rng) → [nextState, events]`
- **`src/engine/rng.ts`** — Seeded deterministic RNG for replayable battles
- **`src/engine/objectives.ts`** — Victory/defeat condition evaluation
- **`src/engine/forecast.ts`** — Preview battle outcomes before committing an action
- **`src/engine/turnOrder.ts`** — Turn order management
- **`src/engine/scenarioRunner.ts`** — Headless battle orchestrator used for scripted/test runs
- **`src/effects/lifecycle.ts`** — Effect application, expiry, and condition handling
- **`src/effects/handlers/`** — Per-effect-type handlers (damage, condition, summon, movement)
- **`src/rules/`** — Pathfinder 2e rules: checks, saves, damage, degrees of success, conditions

### Store Layer
`src/store/battleStore.ts` (Zustand) segregates state by update frequency:
- **Core battle state** — immutable snapshots, triggers React re-renders
- **Orchestration state** — `orchestratorConfig`, `contentContext`, `contentEntries`, `battleEnded`, `battleOutcome`, `isAiTurn`
- **Generation counters** — `loadGeneration` (bumped on every battle load; stale-timer fence), `undoGeneration` (bumped on every undo; sprite-snap signal to App.tsx)
- **Undo stack** — `undoStack: UndoSnapshot[]`, one entry per PC-originated non-`end_turn` dispatch within the current turn
- **Transient state** — `animationQueue`, `activeAnimCount`; mutated directly, no re-renders
- **UI state** — selection, hover, target mode

**`dispatchCommand`** is the single entry point for all game actions:
1. Captures `rng.callCount` before anything rolls (for undo-snapshot + throw-reset)
2. Materializes content-entry commands (merges content-pack payload)
3. Calls `applyCommand` (pure reducer)
4. Runs `checkBattleEnd` against objectives
5. Pushes an undo snapshot (PC-originated, non-`end_turn` only; `end_turn` flushes the stack)
6. Calls `_scheduleAiTurn()` synchronously — React 18 auto-batches its `set()` with step 5's

On throw: resets the RNG to the pre-roll position so `rng.callCount` always matches the committed `battle`.

**`_scheduleAiTurn`** is animation-gated, not delay-gated. It polls `transient.activeAnimCount` on `requestAnimationFrame` and only dispatches the AI command once sprites have settled for 2 consecutive frames (`SETTLE_FRAMES`). Captures `loadGeneration` at schedule-time and checks it on every poll frame; a stale poll from a previous battle silently retires without writing store state.

**`undo()`** pops one snapshot. `battle` is restored by reference (the reducer deep-clones as its first statement, so prev-state is never mutated). RNG is reconstructed via `new DeterministicRNG(seed, skipCount)` — mulberry32 can't seek. `eventLog` is sliced back to the snapshot length, not cleared. Bumps `undoGeneration` so App.tsx can `snapAllSprites()`; the store does not import from rendering.

### Load-Bearing Invariants

Breaking any of these causes silent corruption, not a loud error.

**`deepClone` in the reducer** — `applyCommand` deep-clones the entire state as its first statement. The `battle` reference held by the store is never mutated after the reducer returns. This is what makes undo-by-reference safe (~24 B per snapshot, not a full tree). Any code that mutates `store.battle.*` outside the reducer breaks undo.

**RNG position matches committed state** — After `dispatchCommand` returns, success or throw, `rng.callCount` exactly matches the `battle` held by the store. Enforced by capturing `rngCallCountBefore` at the top of `dispatchCommand` and resetting in the catch block. A handler that rolls-then-throws would otherwise drift the RNG and desync a replay.

**`loadGeneration` fences all deferred store writes** — Every `setTimeout` / `requestAnimationFrame` in the store that writes state must capture `loadGeneration` at schedule-time and check it at fire-time. Gen-mismatch → silent return (the fresh battle may already have set `isAiTurn:true`; don't stomp it). Same-gen abort → may write. `clearBattle` does not bump `loadGeneration`; stale timers from a cleared battle are caught by the `!battle` same-gen abort instead.

**Snap-after-syncUnits** — `snapAllSprites()` must run after `syncUnits()` (so tween targets are correct) and in the same effect tick (so no frame renders with a backward tween). Achieved by checking `undoGeneration !== lastUndoGenRef.current` inside the App.tsx render-effect body, after the `syncUnits` call. `undoGeneration` is separate from `loadGeneration` because the load branch also re-centres the camera, which undo must not do.

### Battle Orchestrator (`src/io/battleOrchestrator.ts`)
Parses `enemy_policy` and `objectives` from raw scenario JSON. Provides:
- `buildOrchestratorConfig(rawScenario)` — extracts AI policy and win/loss conditions
- `checkBattleEnd(state, config)` — evaluates objectives each turn
- `getAiCommand(state, policy)` — selects next AI action (strike_nearest)
- `materializeRawCommand(cmd, contentContext)` — merges content-pack payload before `applyCommand`

### Rendering (`src/rendering/`)
- `pixiApp.ts` — PixiJS application setup; layer order: map → overlay → units → effects → ui
- `rangeOverlay.ts` — Blue/red/purple tile highlights for move range and ability targets
- `cameraController.ts` — Pan/zoom/focus with lerp smoothing. `setCameraBounds(tilesW, tilesH)` clamps `targetX/Y` in `tickCamera` so the viewport never shows void past the map edge; maps smaller than the viewport are centred
- `spriteManager.ts` — Unit sprite tweens. `syncUnits` arms tweens; `tickSprites` advances them and writes `transient.activeAnimCount` unconditionally every tick (the AI poll relies on this); `snapAllSprites` forces all sprites to their targets instantly (fresh-load, undo)
- `tiledTilemapRenderer.ts` — Renders Tiled Map Editor `.tmj` maps with GPU-batched tiles
- `tileRenderer.ts` — Renders hand-written (non-Tiled) scenario maps
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
- `commandAuthoring.ts` — Utilities for authoring and validating commands

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

- **`src/test-utils/`** — Shared fixtures (`fixtures.ts`) and a headless `scenarioTestRunner.ts` for integration-level scenario tests
- **`src/test-scenarios/regression.test.ts`** — End-to-end regression scenarios run headlessly against `scenarioRunner.ts`
- **`src/store/undo.test.ts`** — Drives the store directly (no React, no mocks) to prove the determinism roundtrip: `strike → undo → strike` produces bit-identical results. If this breaks, the RNG reconstruction or the `deepClone` guarantee has drifted

## Assets & Content

- `public/scenarios/smoke/` — 38 smoke-test scenario JSON files (served by Vite)
- `public/content_packs/` — Content pack JSON files served at runtime
- `public/maps/` — Tiled `.tmj` arena files (e.g. `dungeon_arena_01.tmj`)
- `public/tilesets/` — Tileset images referenced by Tiled maps
- `corpus/content_packs/` — Source game-design content pack data (not served directly)
