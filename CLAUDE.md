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
npm run validate:determinism  # Run all smoke scenarios twice, fail on hash mismatch or command_error
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
- **`src/effects/lifecycle.ts`** — Effect application, expiry, condition handling, damage-over-time
- **`src/rules/`** — Pathfinder 2e rules: checks, saves, damage, degrees of success, conditions

### Store Layer
`src/store/battleStore.ts` (Zustand) segregates state by update frequency:
- **Core battle state** — immutable snapshots, triggers React re-renders
- **Orchestration state** — `orchestratorConfig`, `contentContext`, `contentEntries`, `battleEnded`, `battleOutcome`, `isAiTurn`
- **Transient state** — animation state, mutated directly (no re-renders)
- **UI state** — selection, hover, target mode

`dispatchCommand` is the single entry point for all game actions: materializes content-entry
commands, calls `applyCommand` (pure reducer), checks battle-end objectives, detects reactions
(`detectMoveReactions`/`detectDamageReactions`), and routes to `_processNextReaction` — which
either surfaces the next reaction prompt or (queue empty) schedules the next AI turn via an
animation-gated rAF poll on `transient.activeAnimCount`. This bridges the gap between the
headless `scenarioRunner.ts` orchestration and
the interactive browser loop.

### Load-Bearing Invariants

Breaking any of these causes silent corruption, not a loud error. When touching
`battleStore.ts`, `reducer.ts`, or `spriteManager.ts`, check these hold.

**`deepClone` is `applyCommand`'s first statement.** The reducer deep-clones the entire
input state before any mutation. The `battle` reference held by the store is never
mutated after the reducer returns. Any code that writes to `store.battle.*` outside the
reducer breaks this — and silently breaks any future event-sourced rewind (see
[ADR-001](docs/adr/001-no-undo.md)).

**RNG position matches committed state** *(Phase 14 M0.2)*. After `dispatchCommand` returns —
success or throw — `rng.callCount` must exactly match the `battle` held by the store.
Enforced by capturing `rng.callCount` at the top of `dispatchCommand` and resetting
(`new DeterministicRNG(seed, capturedCount)`) in the catch block. A handler that
rolls-then-throws would otherwise drift the RNG and desync a replay.

**`loadGeneration` fences all deferred store writes** *(Phase 14 M0.1)*. Every
`setTimeout` / `requestAnimationFrame` inside the store that writes state must capture
`loadGeneration` at schedule-time and check it at fire-time. Gen-mismatch → silent
return — the fresh battle may already have set `isAiTurn:true`; don't stomp it.
`loadGeneration` bumps on every `loadBattle` and `loadSavedGame`; async loaders
(`reloadLastBattle`, `startCampaignStage`) gen-check after their await.

**`activeAnimCount` written unconditionally every tick** *(Phase 14 M1)*. `tickSprites()`
writes `transient.activeAnimCount` on every PixiJS ticker frame, even when the count is
zero. The animation-gated AI poll reads this value; a frame that skips the write leaves
the poll reading a stale nonzero and the AI never fires.

**`_processNextReaction` is the single gateway to `_scheduleAiTurn`** *(Phase 14 M2.3)*.
The animation-gated AI poll runs for up to ~2s and does NOT check `pendingReaction` per
frame — it relies on being unreachable while a prompt is open. `_processNextReaction`'s
queue-empty branch is the only caller of `_scheduleAiTurn`, and it clears `pendingReaction`
one line before the call. `loadBattle` / `loadSavedGame` route through `_processNextReaction`
rather than calling `_scheduleAiTurn` directly. Adding a new direct call site breaks the
invariant; `_scheduleAiTurn` asserts it at entry but the failure mode is a silent early
return, not an error — so if it trips, AI turns just stop happening.

**No undo system.** See [ADR-001](docs/adr/001-no-undo.md). The
infrastructure above (deepClone, RNG reset, loadGeneration) was designed for undo in
an earlier branch and is preserved because each piece is independently valuable.

### Battle Orchestrator (`src/io/battleOrchestrator.ts`)
Parses `enemy_policy` and `objectives` from raw scenario JSON. Provides:
- `buildOrchestratorConfig(rawScenario)` — extracts AI policy and win/loss conditions
- `checkBattleEnd(state, config)` — evaluates objectives each turn
- `getAiCommand(state, policy)` — selects next AI action (strike_nearest)
- `materializeRawCommand(cmd, contentContext)` — merges content-pack payload before `applyCommand`

### Rendering (`src/rendering/`)
- `pixiApp.ts` — PixiJS application setup; layer order: map → overlay → units → effects → ui
- `rangeOverlay.ts` — Three separate Graphics layers: `_graphics` (move/strike/ability tile fills), `_areaGraphics` (AoE blast diamond with LOE-shadowed tiles), `_pathGraphics` (chevron waypoints + destination ring for move preview). Each layer clears independently so hover-redraw doesn't wipe the others
- `cameraController.ts` — Pan/zoom/focus with lerp smoothing. `setCameraBounds(tilesW, tilesH)` clamps `targetX/Y` in `tickCamera` so the viewport never shows void past the map edge; maps smaller than viewport centre
- `spriteManager.ts` — Unit sprite tweens. `syncUnits` arms tweens; `tickSprites` advances with quad-ease-out and writes `transient.activeAnimCount` unconditionally every tick (the AI poll gates on this); `snapAllSprites` forces instant settlement (fresh-load)
- `tiledTilemapRenderer.ts` — Renders Tiled Map Editor `.tmj` maps with GPU-batched tiles
- `tileRenderer.ts` — Renders hand-written (non-Tiled) scenario maps
- `tilesetLoader.ts` — Loads tileset textures from `.tmj` files
- `effectRenderer.ts` — Float-text (damage/heal/miss) overlay. Drains `transient.animationQueue` destructively each tick

### Grid & Pathfinding (`src/grid/`)
8-connected Dijkstra with PF2e alternating diagonal cost (`movement.ts` — state tracked as `(x, y, parity)`). `reachableWithPrev()` returns both the reachable tile set and a parity-aware `statePrev` map for path reconstruction; `pathTo()` walks it back to build a cost-correct route. Line-of-sight (LOS), line-of-effect (LOE), area shapes (cone, burst, line).

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

## Assets & Content

- `public/scenarios/smoke/` — 44 smoke-test scenario JSON files (served by Vite)
- `public/content_packs/` — Content pack JSON files served at runtime
- `public/maps/` — Tiled `.tmj` arena files (e.g. `dungeon_arena_01.tmj`)
- `public/tilesets/` — Tileset images referenced by Tiled maps
- `corpus/content_packs/` — Source game-design content pack data (not served directly)
- `docs/adr/` — Architecture Decision Records for permanent design choices
