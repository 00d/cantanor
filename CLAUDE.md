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

To regenerate regression hash baselines after an intentional reducer change:
`npx tsx scripts/regenerate-hashes.ts` — self-verifies determinism (runs each scenario
twice) before writing, so it won't silently record a broken scenario.

Additional scripts in `scripts-ts/` (TypeScript-native, use Mulberry32 RNG — hashes differ from Python MT19937 baselines):
- `npx tsx scripts-ts/generateRegressionBaselines.ts` — regenerate TS-internal baselines
- `npx tsx scripts-ts/validateMigration.ts` — verify Python→TypeScript engine parity

## Key Principles

**Determinism is a first-class constraint.** Every battle must replay identically given the same seed and command sequence. This drives the architecture: seeded RNG (`src/engine/rng.ts`), pure reducer, canonical event serialization (`src/io/eventLog.ts`), and regression hash baselines. Any change that shifts RNG consumption order or event-payload shape breaks all baseline hashes — regenerate with `npx tsx scripts/regenerate-hashes.ts`.

**Pure engine / impure store separation.** The engine (`src/engine/`, `src/rules/`, `src/effects/`, `src/grid/`) is pure functions with no side effects. All impure orchestration (animations, AI scheduling, React state, async loading) lives in the store layer (`src/store/battleStore.ts`). Never import store code from engine code.

**Content-driven gameplay.** Abilities, spells, feats, and items are defined in JSON content packs, not hardcoded. The engine evaluates command templates from content packs at dispatch time via `materializeRawCommand`.

## TypeScript

Strict mode is enabled: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. There is no ESLint — TypeScript strict mode is the only static analysis gate. Target is ES2022.

## Architecture

### Data Flow

Player action lifecycle (reading this requires understanding multiple files):

1. **User click** → `App.tsx` event handlers set store UI state (selection, target mode, proposed path)
2. **Commit** → `battleStore.dispatchCommand()` — the single entry point for all game mutations
3. **Materialize** → content-pack command templates merged via `materializeRawCommand`
4. **Reduce** → `applyCommand()` deep-clones state, runs pure reducer, returns `[nextState, events]`
5. **Post-dispatch** → store checks objectives (`checkBattleEnd`), detects reactions (`detectMoveReactions`/`detectDamageReactions`), queues animations
6. **Reactions** → `_processNextReaction` surfaces prompts or (queue empty) schedules next AI turn
7. **Render** → React re-renders from store state; PixiJS sprite tweens run on the ticker

### Split-Viewport Layout
The app (`src/ui/App.tsx`) uses a Gold Box-inspired split viewport:
- **Left 62%**: PixiJS WebGL canvas for game rendering
- **Right 38%**: React UI panels (party list, combat log, actions, scenario loader)

Canvas-area overlays (absolutely positioned inside `.canvas-section`, `pointer-events: none` unless interactive):
- `ForecastTooltip` — strike hit/damage preview, bottom-left, visible during strike target mode
- `MoveConfirmOverlay` — two-phase move confirmation with cost display and Confirm/Cancel buttons, bottom-left, visible when a move path is locked (`proposedPath.locked === true`). Uses `pointer-events: auto` for button interaction. Guarded against `isAiTurn` and `battleEnded`

### Core Engine (Deterministic)
The game engine is a pure functional state machine:
- **`src/engine/state.ts`** — Immutable battle state interfaces (units, effects, map, objectives)
- **`src/engine/commands.ts`** — Typed commands (Move, Strike, SaveDamage, ApplyEffect, etc.)
- **`src/engine/reducer.ts`** — Pure reducer: `(state, command, rng) → [nextState, events]`. `tickHazardZones()` runs after `advanceTurn()` in the `end_turn` handler; guarded to consume zero RNG when `battleMap.hazards` is absent/empty (all pre-R1 regression hashes depend on this)
- **`src/engine/rng.ts`** — Seeded deterministic RNG for replayable battles
- **`src/engine/objectives.ts`** — Victory/defeat condition evaluation
- **`src/engine/forecast.ts`** — Preview battle outcomes before committing an action
- **`src/engine/turnOrder.ts`** — Turn order management
- **`src/engine/scenarioRunner.ts`** — Headless battle orchestrator used for scripted/test runs
- **`src/engine/reactions.ts`** — Pure trigger detection: `detectMoveReactions` (AoO/reactive_strike), `detectDamageReactions` (shield_block). Returns triggers sorted by unitId for determinism; store layer queues them
- **`src/engine/traits.ts`** — Weapon-trait parsing helpers (`traitValue`, `isAgile`, deadly/fatal/volley) shared by reducer, forecast, and tooltip
- **`src/effects/lifecycle.ts`** — Effect application, expiry, condition handling, damage-over-time
- **`src/rules/`** — Pathfinder 2e rules: checks, saves, damage, degrees of success, conditions

### PF2e Rules Coverage

**Implemented and mechanically active:** 3-action economy, MAP (agile/non-agile), degrees of
success (crit/success/fail/crit-fail with natural 1/20 shifting), Fortitude/Reflex/Will saves
with basic multiplier, weapon traits (agile/deadly/fatal/volley/thrown/propulsive), cover grades
(standard +2, greater +4, melee-in-reach negation), shield raise/block, resistances/weaknesses/
immunities with damage-type bypass, ammo tracking/reload, PF2e alternating diagonal movement
cost, difficult terrain via per-tile `moveCost`, AoO/reactive strike on movement, affliction
stages (disease/poison with save progression), persistent damage with recovery checks, hazard
zones with per-round saves.

**Not yet mechanically wired:** Most conditions are tracked (`Record<string, number>`) but don't affect resolution. No `off_guard`/flanking, no Step action, simplified death model. See `ROADMAP.md` Phase 16.

### Store Layer
`src/store/battleStore.ts` (Zustand) segregates state by update frequency:
- **Core battle state** — immutable snapshots, triggers React re-renders
- **Orchestration state** — `orchestratorConfig`, `contentContext`, `contentEntries`, `battleEnded`, `battleOutcome`, `isAiTurn`
- **Transient state** — animation state, mutated directly (no re-renders)
- **UI state** — selection, hover, target mode, proposed path (move preview)

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

**`proposedPath` is the single gateway to player move dispatch** *(Phase 15)*.
The click handler in `App.tsx` does NOT fall back to `moveReach` for move commitment.
`proposedPath` (store) is the sole authority on "which move will execute." The hover
effect writes it from `moveReach` (local memo); the click handler and Enter key handler
only read it. Adding a second dispatch path through `moveReach` reintroduces the
dual-ownership bug fixed in Phase 15. The stale-lock guard effect clears a locked
proposal whenever `moveReach` recomputes and the destination is no longer reachable.
When locked, two `useEffect`s in `App.tsx` fire side effects: `showGhostAtTile` places
a semi-transparent preview sprite at the destination, and `showThreatMarkers` draws red
rings on enemies whose reach the path passes through (computed via `detectMoveReactions`
per step with a shallow-copied state — no RNG, no mutation). Both clear when
`proposedPath` becomes null or unlocked.

**No undo system.** See [ADR-001](docs/adr/001-no-undo.md). The
infrastructure above (deepClone, RNG reset, loadGeneration) was designed for undo in
an earlier branch and is preserved because each piece is independently valuable.

### Battle Orchestrator (`src/io/battleOrchestrator.ts`)
Parses `enemy_policy` and `objectives` from raw scenario JSON. Provides:
- `buildOrchestratorConfig(rawScenario)` — extracts AI policy and win/loss conditions
- `checkBattleEnd(state, config)` — evaluates objectives each turn
- `getAiCommand(state, policy, contentContext)` — selects next AI action. Policies: `strike_nearest` (4-pass: melee → thrown → ranged with ammo check → reload), `cast_area_entry_best` (scores aim points as `enemiesHit − alliesHit`, only casts when strictly positive, ties broken by raw enemy count then `unitId`)
- `materializeRawCommand(cmd, contentContext)` — merges content-pack payload before `applyCommand`. When a `cast_spell` command has an `area` block in its content-pack payload and `center_x`/`center_y` on the caller side, rewrites to `area_save_damage`. Gate reads `payloadTemplate.area` (not `merged.area`) so a dispatch can't inject an area block and turn a single-target spell into an AoE

### Rendering (`src/rendering/`)
PixiJS layer order: map → overlay → units → effects → ui (`pixiApp.ts`).

Key cross-cutting concerns:
- **`rangeOverlay.ts`** has four independent Graphics layers (`_graphics`, `_areaGraphics`, `_pathGraphics`, `_threatGraphics`) that clear independently — hover-redraw doesn't wipe path preview, AoE footprint, or AoO threat markers
- **`spriteManager.ts`** owns the animation tick: `tickSprites` writes `transient.activeAnimCount` unconditionally every frame (the AI poll gates on this — see Load-Bearing Invariants)
- **Two tilemap renderers**: `tiledTilemapRenderer.ts` for Tiled `.tmj` maps (GPU-batched), `tileRenderer.ts` for hand-written scenario maps (Graphics rects). Container scales by `TILE_SIZE / tilewidth`
- All unit sprites are pixel art — `spriteSheetLoader.ts` forces `scaleMode: "nearest"`

### Grid & Pathfinding (`src/grid/`)
8-connected Dijkstra with PF2e alternating diagonal cost (`movement.ts` — state tracked as `(x, y, parity)`). `reachableWithPrev()` returns a `ReachResult` containing: the reachable tile set, a per-tile cost map (`dist`), and parity-aware `statePrev`/`bestEntry` maps for path reconstruction. `pathTo()` walks the `statePrev` chain back to build a cost-correct route. The `dist` map is used by the UI to populate `ProposedPath.cost` for the move-confirmation overlay. Line-of-sight (LOS), line-of-effect (LOE), area shapes (cone, burst, line).

### I/O Layer (`src/io/`)
Scenario loading pipeline: `scenarioLoader.ts` auto-detects Tiled vs hand-written format → for Tiled, `tiledLoader.ts` parses `.tmj` into `ResolvedTiledMap` → `mapDataBridge.ts` converts to scenario shape (spawn points, blocked tiles, hazard zones, objectives). `contentPackLoader.ts` fetches and builds `entryLookup` for content-driven abilities.

Key files with non-obvious constraints:
- **`commandAuthoring.ts`** — Browser-facing helpers (`listContentEntryOptions`, `buildPartialCommand`) that translate loaded content entries into dispatchable command skeletons; used by `ActionPanel` to populate the ability buttons
- **`eventLog.ts`** — Canonical JSON serialization (`sortedJson` matches Python's `sort_keys=True`) and `replayHash` computation. Any change to event-payload field names or ordering churns every regression baseline
- **`effectModelLoader.ts`** — `setPreloadedEffectModel()` must be called before `lookupHazardSource()`. `scenarioTestRunner.ts` handles this preload for tests; browser must preload before any hazard dispatch

### Campaign Layer (`src/campaign/`)
Multi-battle progression — no `@campaign` alias, imported via relative path.
- `campaignState.ts` — `snapshotParty` captures surviving-PC HP/ammo/persistent conditions (drained, doomed) at battle end; `applyPartySnapshot` merges into freshly-loaded units at next-stage start
- `campaignPersistence.ts` — localStorage save/load under key `cantanor_campaign_save`, version-gated
- `campaignLoader.ts` — fetches campaign definition JSON (`public/campaigns/`)

The store holds `campaignDefinition` + `campaignProgress`; `startCampaignStage` is an async
loader (gen-checks after await — see `loadGeneration` invariant).

### Content Packs
JSON files in `public/content_packs/` served by Vite. Scenario JSON references them via `"content_packs": ["/content_packs/phase10_v1.json"]`. Each entry has `id`, `kind` (spell/feat/item), `tags`, and `payload` (command template). The `ActionPanel` renders entries grouped by kind with colour-coded buttons.

### Designer Tools (`src/ui/designer/` + `src/store/designerStore.ts`)
In-app scenario authoring tools: Scenario Inspector, File Browser, Viewer. Toggled via the Game/Designer mode button in `App.tsx`. Designer state lives in a separate Zustand store (`designerStore.ts`) — the battle store is not touched. The canvas is kept in the DOM (`display:none`) during designer mode so the PixiJS WebGL context is preserved across mode switches.

## Path Aliases

Defined in `vite.config.ts`, `tsconfig.app.json`, and `vitest.config.ts`. Import with glob suffix:
```
@engine/*    → src/engine/*
@grid/*      → src/grid/*
@rules/*     → src/rules/*
@effects/*   → src/effects/*
@io/*        → src/io/*
@rendering/* → src/rendering/*
@store/*     → src/store/*
@ui/*        → src/ui/*
```

The Vite dev server also watches `corpus/`, `compiled/`, and `scenarios/` for hot reload (non-default — configured in `vite.config.ts`).

## Test Infrastructure

Tests use Vitest with jsdom. Test files follow `src/**/*.test.ts(x)`. Coverage areas: areas, LOS, damage, conditions, checks, objectives. The same path aliases apply in tests.

- **`src/test-utils/`** — Shared fixtures (`fixtures.ts`) and a headless `scenarioTestRunner.ts` for integration-level scenario tests
- **`src/test-scenarios/regression.test.ts`** — End-to-end regression scenarios run headlessly against `scenarioRunner.ts`, pinned to hash baselines in `scenarios/regression_phase*/`. If a reducer change intentionally shifts an event payload or RNG consumption, regenerate baselines via `npx tsx scripts/regenerate-hashes.ts` (self-verifies determinism before writing)
- **`validate:determinism`** — faster CI-gate alternative: runs all 44 smoke scenarios twice each, fails on hash drift or `command_error`. Does NOT pin to baselines (catches nondeterminism, not behaviour drift)

## Assets & Content

- `scenarios/smoke/` — 44 smoke-test scenario JSON files (`interactive_arena.json` is the primary playtest scenario). Served via `public/scenarios → ../scenarios` symlink
- `scenarios/regression_phase*/` — Regression-baseline scenarios (NOT served; read by `regression.test.ts` via node fs)
- `public/content_packs/` — Content pack JSON files served at runtime
- `public/maps/` — Tiled `.tmj` arena files (see `public/maps/TILED_AUTHORING.md` for custom-property schema)
- `public/tilesets/` — Tileset images referenced by Tiled maps
- `public/campaigns/` — Campaign definition JSON (ordered scenario lists with narrative frames)
- `data/` — Generated rules artifacts (`effect_models.json`, `engine_rules.json`, `primitives.json`) and bestiary JSON, produced by `scripts/build_tactical_*.py`
- `corpus/content_packs/` — Source game-design content pack data (not served directly)
- `docs/adr/` — Architecture Decision Records for permanent design choices
- `archive/` — Reconciled earlier-branch code (kept for reference)
