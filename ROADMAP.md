# Cantanor — Development Roadmap

This document tracks the forward-looking feature phases for Cantanor, a browser-based tactical
TRPG built on Pathfinder 2e ORC mechanics.

The engine (Phases 3–9) and its TypeScript browser port are **complete**: 13 command types,
deterministic RNG, content packs, enemy AI, mission events, hazard routines, and 352 passing
tests across 23 test files. The phases below build the gameplay and production layers on top.

**Design decisions that close off directions permanently** (rather than deferring them) live
in [`docs/adr/`](docs/adr/). See [ADR-001](docs/adr/001-no-undo.md) for why this codebase has
no undo system.

---

## Phase 10 — Interactive Battle Loop ✅

**Goal:** End-to-end playable battle. Player controls PCs, enemies auto-act, battles end with
a victory or defeat screen, and abilities from content packs are usable.

**Deliverables:**
- Live AI turn execution: enemy units act automatically with a short delay between steps
- Victory / defeat detection via objective evaluation after every command
- BFS pathfinding — reachable tiles highlighted on the map when Move is active
- LOS-gated strike targeting: only enemies in line-of-sight are highlighted and selectable
- Expanded Action Panel: Cast Spell, Use Feat, Use Item buttons sourced from loaded pack
- Content pack `phase10_v1` with 10 meaningful entries (fireball, heal, battle medicine, etc.)
- `interactive_arena` scenario: 2 PCs vs 2 enemies with objectives and content pack
- Persistent `lastScenarioUrl` for Play Again from the battle-end overlay
- Tiled `.tmj` map loading with GPU-batched tile rendering and grid overlay toggle
- In-app scenario designer: Scenario Inspector, File Browser, Tiled map preview
- Unit inspection: click any unit to see its stats (AC, saves, speed, attack) without breaking turn flow; active-turn unit marked with gold outline
- Auto-follow: `selectedUnitId` advances to the next PC at turn start

---

## Phase 11 — Weapon Traits & Combat UI ✅

**Goal:** PF2e weapon traits evaluated at runtime; responsive layout and turn-order visibility.

**Deliverables:**
- Weapon trait engine: `src/engine/traits.ts` pure helpers shared by reducer, forecast, tooltip, overlay ✅
- **Agile**: MAP becomes −4/−8 instead of −5/−10 ✅
- **Deadly_dN**: On crit, roll 1 extra dN and add to damage (after ×2) ✅
- **Fatal_dN**: On crit, upgrade all weapon dice to dN, add 1 extra dN (after ×2) ✅
- **Propulsive**: Add `weapon.propulsiveMod` to damage ✅
- **Volley_N**: −2 penalty when target is within N tiles ✅
- **Thrown_N**: Melee weapon usable at range N; AI throws when melee is out of reach ✅
- Trait-aware `strikeForecast()` with `StrikeTraitInfo` (deadly/fatal/propulsive) ✅
- `ForecastTooltip` displays agile MAP, volley penalty, thrown range gate ✅
- `rangeOverlay` highlights thrown targets in orange beyond melee reach ✅
- `rollTraitBonusDice()` helper in `rules/damage.ts` ✅
- 26 trait unit tests + 13 trait integration tests ✅

**UI & layout deliverables:**
- Responsive portrait layout: CSS `@media (max-aspect-ratio: 1/1)` switches to vertical 55/45 split ✅
- `ResizeObserver` keeps PixiJS camera synced on layout changes ✅
- Turn order bar (`TurnOrderBar.tsx`): horizontal scrollable strip with team-colour chips, initiative scores, mini HP bars, auto-scroll to active unit ✅
- Active-unit indicator in `PartyPanel` with blue border + arrow ✅
- Reaction prompt CSS (`.reaction-prompt`, `.reaction-prompt-buttons`) ✅
- Shield-raised indicator CSS ✅
- Portrait-responsive turn order bar ✅

---

## Phase 12 — Rich Maps & Visual Terrain ✅

**Goal:** Tiled maps become fully functional game surfaces.

**Deliverables:**
- Tiled `.tmj` loader, GPU tilemap renderer, tileset image resolution ✅
- `mapDataBridge` extracts spawn points, blocked tiles, hazard zones, objectives ✅
- Auto-generated `enemy_policy` from Tiled spawn team properties ✅
- Tiled custom properties pipeline: `moveCost`, `elevation`, `coverGrade` per tile-layer ✅
- BFS movement cost via `dijkstra()` in `movement.ts` respects `moveCost` (difficult terrain) ✅
- LOE/cover grade derived from `coverGrade` tile property via `coverGradeBetweenTiles()` ✅
- Terrain overlay: persistent indicators rendered in `terrainOverlay.ts` + `tileRenderer.ts` ✅
- Camera pan (WASD / drag) and zoom (scroll wheel) via `cameraController.ts` ✅
- 3 new Tiled arenas with matching smoke-test scenarios: ✅
  - `castle_courtyard` — 14×12 walled courtyard with pillar chokepoints, rubble, and cover rocks
  - `forest_clearing` — 12×12 open forest with undergrowth (difficult terrain) and tree cover
  - `dungeon_corridor` — 16×8 narrow corridors with central room, chokepoints, and cover tiles
- Elevation parsed and stored (data-ready for future phases) ✅

---

## Phase 13 — Character Depth & Campaign ✅

**Goal:** Player-facing character systems and linked multi-battle progression.

**Deliverables:**
- Character sheet panel: AC, saves, resistances/immunities, available abilities
- Per-unit ability tracking: feats have limited uses per day; items are consumable
- Ranged resource tracking: ammunition consumption, reload action cost, hands-required validation
- Cover distinction: ranged attacks respect cover grade; melee at adjacent range ignores standard cover
- Campaign flow: ordered scenario list with locked stages and a simple narrative frame
- Persistent party: HP state carries between battles, healing available at camp screens
- Save / load: game state serialised to `localStorage`

---

## Phase 14 — Feel Parity ✅

**Goal:** Restore the game-feel layer that an earlier branch built but this one did not.
That branch (archived as `old/` during reconciliation) spent its Phase 12
on feel work — sprite tweens, animation-gated AI, path preview, AoE footprint hover,
camera bounds. This branch spent its Phase 12/13 on content depth — traits, reactions,
campaigns. Both were right. Phase 14 makes this branch a strict superset by porting the
feel work onto the deeper engine.

**Scope note:** The earlier branch also had a working undo stack. That is **not** being
ported — reactions make it architecturally intractable. See [ADR-001](docs/adr/001-no-undo.md).
Its supporting infrastructure (loadGeneration fence, RNG reset-on-throw) **is** being
ported because each piece is independently valuable.

**Milestone sequencing:**
```
M0 Safety ──┬──► M1 Tweens ──► M2 Anim-AI ──┐
            │                               ├──► M5 Polish
            ├──► M3 AoE ────────────────────┤
            └──► M4 Path Preview ───────────┘
```

### M0 — Correctness & Safety Fixes ✅

Pure-additive fixes that land before any feature work. Zero behavioural regressions.

- **M0.1 — `loadGeneration` fence** (`battleStore.ts`). Monotonic counter bumped on every
  battle load. Every deferred `setTimeout`/`rAF` in the store captures it at schedule-time,
  checks it at fire-time; gen-mismatch → silent return. Prevents stale AI-turn timers from
  stomping fresh-battle state after Play Again. Three callsites: `_scheduleAiTurn`'s
  `setTimeout(420)` callback, the anti-deadlock `setTimeout(0)` in `dispatchCommand`'s catch,
  and campaign's `startCampaignStage`.

- **M0.2 — RNG reset-on-throw** (`battleStore.ts`). Capture `rng.callCount` at the top of
  `dispatchCommand`. In the catch block, if `rng.callCount` has advanced, reconstruct via
  `new DeterministicRNG(battle.seed, capturedCount)`. Ensures `rng.callCount` always matches
  the committed `battle` even if a handler rolls then throws — protects replay determinism.

- **M0.3 — Reaction-queue reset in `loadBattle`** (`battleStore.ts`). Current `loadBattle()`
  does not clear `pendingReaction` or `reactionQueue`; a stale prompt carries into the fresh
  battle. Add both fields to the `set()` payload in `loadBattle`, `clearBattle`, and
  `startCampaignStage`.

- **M0.4 — CombatLogPanel scroll jitter** (`CombatLogPanel.tsx:114`). During AI turn bursts
  the hardcoded `behavior: "smooth"` fights itself. Same cure as the earlier branch applied
  to its turn ribbon: read `isAiTurn` via `getState()` at effect-fire-time (not via
  subscription) and use `behavior: isAiTurn ? "auto" : "smooth"`.

### M1 — Sprite Tweens ✅

Units lerp to their destination over ~280ms instead of snapping. Feeds
`transient.activeAnimCount` for M2's animation gate.

- **M1.1 — `spriteManager.ts` tween core**. Per-sprite `fromX/Y`, `targetX/Y`, `lerpT` fields.
  `syncUnits()` arms tweens (snaps `from` to current render position to prevent rubber-banding
  on mid-tween retarget). `tickSprites(deltaMS)` advances with quad-ease-out and writes
  `transient.activeAnimCount` **unconditionally every tick** (count of sprites with
  `0 ≤ lerpT < 1`). `snapAllSprites()` forces instant settlement. Adapted for current's
  sprite-sheet `Sprite` objects — tween `sprite.x`/`sprite.y` regardless of backing texture.

- **M1.2 — Sprite-sheet walk-state integration**. `tickSprites` owns the walk↔idle
  transition: walk onset on the first frame it sees `lerpT < 1`, idle on settle. Frame-locked
  with visible motion (syncUnits-driven onset would start one frame early — the Pixi ticker
  can beat the passive React effect). Falls back to sliding-idle if the sheet has no walk state.

- **M1.3 — `transient.activeAnimCount` field** (`battleStore.ts`). Add to `TransientState`,
  initialize to `0` in all constructor sites.

- **M1.4 — App.tsx ticker wiring**. Add `tickSprites(deltaMS)` to the game-loop ticker.
  Call `snapAllSprites()` once after `syncUnits()` when `loadGeneration` changes (fresh-load;
  `lastLoadGenRef` already tracks this — M0 switched it from `battleId` so Play Again is
  correctly treated as fresh).

- **M1.5 — Port `spriteManager.test.ts`**. Tween convergence, `activeAnimCount` bookkeeping
  (two simultaneous movers, drain-to-zero), mid-tween retarget corner-cutting, snap assertions.

### M2 — Animation-Gated AI ✅

Replace `setTimeout(420)` with rAF polling that waits for sprite settlement. Reaction prompts
are handled structurally — the poll never runs while one is open (see M2.3).

- **M2.1 — `_scheduleAiTurn` rAF poll** (`battleStore.ts`). Capture `loadGeneration` at
  schedule-time. rAF loop checks: gen-mismatch → silent return; battle-ended → `isAiTurn:false`
  and return; `animationQueue.length === 0 && activeAnimCount === 0` for `SETTLE_FRAMES=2`
  consecutive frames → fire `act()` after a 120ms cosmetic grace. Hard-cap at
  `MAX_POLL_FRAMES=120` to prevent soft-lock on a stuck tween.

  Why SETTLE_FRAMES=2: on frame 1 after dispatch, the Pixi ticker drains the animation queue
  and writes `activeAnimCount=0`, but `syncUnits` — which arms the tween — lives in a passive
  `useEffect` that doesn't run until after that rAF batch. One frame later the tween is armed
  and the counter reads nonzero. Two frames bridges the gap.

- **M2.2 — Stranded-queue soft-lock fix** (`battleStore.ts`, `resolveReaction`). Pre-existing
  bug discovered during the M2.3 analysis: when a nested reaction dispatch threw *and* the
  reaction queue was empty, the old stranded-queue recovery condition
  (`pendingReaction === null && reactionQueue.length > 0`) evaluated false and turn flow
  stalled forever. Fixed by checking `pendingReaction === null && !isAiTurn` instead — on
  dispatch success, one of those two flags is always set (prompt armed, or AI scheduled), so
  both-clear unambiguously means the success tail never ran.

- **M2.3 — Single-gateway turn flow** (`battleStore.ts`). Original plan: poll
  `pendingReaction !== null` per-frame as a "not settled" signal. Traced the flow during
  implementation and found that `pendingReaction` is structurally null whenever
  `_scheduleAiTurn` is entered — all three callers clear it immediately before the call,
  and nothing can set it non-null mid-poll (`isAiTurn:true` blocks player dispatch; the
  300ms auto-resolve timer is identity-fenced against a null `pendingReaction`). So the
  per-frame check would have run ~120×/turn against a condition that can't be true.

  Instead: routed `loadBattle` and `loadSavedGame` through `_processNextReaction()` (which
  with an empty queue just clears `pendingReaction` and calls `_scheduleAiTurn` — identical
  behaviour, one entry path). `_scheduleAiTurn` now has **exactly one caller**, and that
  caller clears `pendingReaction` one line before the call. The invariant is asserted once
  at entry, not defended per-frame. See CLAUDE.md Load-Bearing Invariants.

### M3 — AoE Pipeline Restore ✅

The engine's `area_save_damage` command works; the UI→engine bridge was removed. Restore it.

- **M3.1 — `TargetMode.area` field** (`battleStore.ts`). Added
  `area?: { shape: "burst"; radiusFeet: number }` alongside `weaponIndex?: number`.
  Orthogonal — spells use `area`, strikes use `weaponIndex`.

- **M3.2 — Orchestrator cast_spell→area_save_damage rewrite** (`io/battleOrchestrator.ts`).
  When `materializeRawCommand` sees a `cast_spell` with an `area` block in its content-pack
  payload and `center_x`/`center_y` on the caller side, rewrite `type` to `area_save_damage`,
  lift `radius_feet` from the area block, scrub spell-specific fields. Gate reads
  `payloadTemplate.area` (content-pack author's declaration) not `merged.area` — a
  dispatch can't inject an area block and turn a single-target spell into an AoE.

  **Folded in a pre-existing bug fix:** `eventsToAnimations` lumped `area_save_damage`
  with single-target events and read `payload["target"]` — but the reducer emits no
  `target` field on area events, it emits a `resolutions` array. Float-damage numbers
  silently failed (guard `if (target && dmg)` never passed). Inert until M3 wired the
  dispatch path. Fixed by splitting the branch: fan out one animation per `resolutions`
  entry. Targets that crit-succeeded their save take 0 → no float text, which is correct.

- **M3.3 — ActionPanel area-arming** (`ui/ActionPanel.tsx`). `readAreaShape()` helper
  sniffs content-pack payload for an `area` block. When found, `setTargetMode` gets
  `area` instead of `allyTarget` (the two are mutually exclusive — area spells hit
  everyone in the blast). Target banner updated to show radius + shape.

- **M3.4 — Canvas click dispatches center_x/y** (`ui/App.tsx`). `targetMode.area` branch
  checked before the single-target branch — cursor over a unit still targets the tile
  (aiming at the unit's feet, not picking the unit). Dispatched as `cast_spell` so
  materialize's whitelist accepts it; the rewrite happens inside materialize. Range
  overlay clears instead of painting ally/ability targets; M5.1 AoE footprint hover
  will provide visual feedback.

- **M3.5 — Fireball content entry** (`public/content_packs/phase10_v1.json`).
  `spell.fireball`: 20ft burst, 6d6 fire, Reflex DC 21, 3 uses/day. Added to the
  `interactive_arena.json` mage's abilities list during M5 so M3/M5.1 are visible in the
  primary playtest scenario.

- **M3.6 — `battleOrchestrator.test.ts`**. 6 tests: rewrite + radius mapping, field
  scrubbing, throws-on-missing-center (catches the single-target-path bug where
  `center_x: undefined` → NaN → empty resolutions with no error), throws-on-unknown-shape,
  non-area-spells-untouched regression guard, template-not-caller injection protection.

### M4 — Path Preview (Waypoint Chevrons) ✅

Hover a reachable tile → see the Dijkstra walk-back path. Adapted for 8-connected diagonal
movement with PF2e alternating diagonal cost.

- **M4.1 — `reachableWithPrev()` + `pathTo()`** (`grid/movement.ts`). ✅ The existing `prev`
  map was tile-keyed, which works for 4-connected but **not** for parity-tracked diagonals:
  a naive tile→tile chain can stitch a path whose replayed cost exceeds the unit's speed
  (counterexample: diagonal into moveCost=3 terrain, walk-back replays at cost 7 for a
  dist-5 tile). Fixed with state-keyed `statePrev: Map<"x,y,parity", "x,y,parity">` and
  `bestEntry: Map<"x,y", "x,y,parity">`. `pathTo` starts from `bestEntry[dest]`, walks
  `statePrev`, strips parity. `reachableTiles()` is now a thin `.tiles` wrapper — no
  behaviour change for the reducer/AI.

- **M4.2 — Chevron rendering** (`rendering/rangeOverlay.ts`). ✅ New `_pathGraphics` layer,
  added after `_graphics` so chevrons draw on top of the blue tile fills. Each intermediate
  step gets a chevron pointing toward the next tile; destination gets a stroked ring.
  Direction is normalized (`Math.hypot(dx,dy)`) so diagonal chevrons draw the same size
  as orthogonal instead of √2× larger. `clearPathPreview()` clears only the path layer.

- **M4.3 — App.tsx hover wiring**. ✅ `moveReach = useMemo(reachableWithPrev, ...)` keyed on
  `targetMode?.type` so Dijkstra runs once on entering Move mode, not per-hover. Range
  overlay effect and click-handler both reuse `moveReach.tiles`. New `useEffect` on
  `[hoveredTilePos, moveReach]` calls `pathTo` + `showPathPreview`/`clearPathPreview`.
  Preview only shows when hovering inside the blue range; walls/out-of-range show nothing.

- **M4.4 — `movement.test.ts` path assertions**. ✅ 10 new tests. `isLegalWalk` helper
  (Chebyshev-1 steps, corner-cutting checked) and `replayCost` helper (parity-tracking
  forward replay, mirrors dijkstra exactly). Key tests: parity-correctness-through-
  difficult-terrain (would fail with naive tile-keyed prev) and a sweep asserting **every**
  reachable tile's walk-back replays within budget on a mixed-terrain map.

### M5 — Polish Sweep ✅

- **M5.1 — AoE footprint hover** (`rendering/rangeOverlay.ts` + `App.tsx`). ✅ New
  `_areaGraphics` layer (separate from `_graphics` and `_pathGraphics` so hover redraw
  doesn't wipe anything else). `showAreaFootprint(cx, cy, radiusFeet, state)` mirrors the
  reducer's `area_save_damage` tile set exactly: `radiusPoints` → `hasTileLineOfEffect`
  filter, same `tilesFromFeet` formula (duplicated with a block comment pointing at
  `reducer.ts:187` — if these drift the red tiles won't match what gets hit, and the hash
  suite won't catch it because rendering isn't hashed). LOE-blocked tiles drawn at
  `AREA_SHADOW_ALPHA=0.08` instead of hidden, so a wall in the blast is legible: bright red
  stops at the wall, faint red continues behind it. App.tsx effect keyed on `targetMode?.area`
  (not `targetMode` — setTargetMode returns fresh objects, same thrash concern as `moveReach`).

- **M5.2 — Camera bounds clamp** (`rendering/cameraController.ts`). ✅ `setCameraBounds(tilesW, tilesH)`
  called from App.tsx at both `focusTile` sites (new-battle load + game-mode re-entry).
  `tickCamera` clamps `targetX/Y` (not `currentX/Y`) before lerp — clamping targets means
  dragging way off-map pins the target at the wall and the lerp settles against it; clamping
  currents would read "sticky" (target stuck at -5000, lerp pulls toward it every frame,
  clamp yanks back). Clamp in `tickCamera` not in `panBy`/`focusTile`/`zoom` — one site
  catches all three, re-runs against live `targetZoom` so a zoom-out can't strand `targetX`
  at a now-invalid position. Maps smaller than viewport centre (fires at `MIN_ZOOM=0.3` on
  a 20-tile map ≈ 192px). `_worldW=0` default → unbounded; clamp is a no-op until bounds are
  set, preserving pre-clamp behaviour on any load path that forgets.

- **M5.3 — TurnOrderBar click-to-focus + hover-highlight** (`ui/TurnOrderBar.tsx`). ✅
  `onMouseEnter` → `setHoverTile([unit.x, unit.y])` — same action the canvas mousemove uses,
  so with an area spell armed this also paints the blast diamond centred on the unit (free
  "what if I fireball that guy's feet" preview). `onMouseLeave` on the scroll container (not
  per-chip — that would flicker between chips). `onClick` gated on alive → `selectUnit` +
  `focusTile`; `disabled` set on dead chips so the button state reflects it. Scroll-behaviour
  reads `isAiTurn` via `getState()` at fire-time (not subscribed — adding it to deps would
  re-fire on every flag flip even with turnIndex unchanged). Snap during AI chains; the final
  AI→PC scroll smooths because `isAiTurn` has already flipped back by the time the effect runs.

- **M5.4 — `validateDeterminism.ts`** (`scripts/`). ✅ Runs all 44 smoke scenarios twice each,
  fails on `replayHash` mismatch or any `command_error` event. **Not** a replacement for the
  regression hash suite — doesn't pin to baselines. It's a fast "nothing is obviously broken"
  CI gate that catches nondeterminism even for scenarios with no baseline. Uses the existing
  `runScenarioTest` + `assertNoCommandErrors` from `scenarioTestRunner.ts`. `npm run
  validate:determinism`. 44/44 passing at M5 close.

- **M5.5 — `CLAUDE.md` Load-Bearing Invariants** ✅. Documented during Phase 14 planning.

**Dead code shipped during M5:**
- `MoveAnimation` interface + union arm deleted; `eventsToAnimations` move branch removed.
  effectRenderer drain chain now closed on miss. The queue entries couldn't bridge the
  syncUnits race anyway (drain in 1 frame, `SETTLE_FRAMES=2` is what holds). Zero behaviour
  change; `activeAnimCount` comes from `tickSprites`, not the queue.

**Still tracked — `interactive_arena.json` full overhaul.** Minimum-viable fix **done**
(`spell.fireball` added to the mage's abilities so M3/M5.1 are immediately visible), but the
scenario still doesn't showcase phases 11–14: no multi-weapon units, no shields, no reactions,
single content-pack-id reference despite listing two packs. Needs a dedicated content pass
after Phase 14. Doesn't block Phase 15.

---

## Reconciliation Pass — `old/` Superset Closeout ✅

The Phase 14 preamble claimed "strict superset." Re-diffing `old/` after M5 close found three
features that never crossed over. R1 and R2 landed; R3 remains tracked-not-scheduled; `old/`
deleted. None blocked Phase 15.

### R1 — Spatial hazard zone tick ✅

`extractHazardZones()` had survived the reconciliation with tests, but its output went
nowhere — the Tiled parser was live, both ends of the pipe were gone. Pipeline now closed:

- `HazardZone` interface + `battleMap.hazards?: HazardZone[]` — `src/engine/state.ts:119-144`
- `tickHazardZones()` + call after `advanceTurn()` in `end_turn` — `src/engine/reducer.ts`
- `map.hazards` validation + state mapping + Tiled bridge — `src/io/scenarioLoader.ts`
- 8 tests — `src/engine/hazards.test.ts`

**Hash safety held:** `src/engine/hazards.test.ts:73-90` pins zero RNG consumption when
`battleMap.hazards` is absent/empty. All 44 smoke scenarios and all regression phases
predate this type, so `end_turn` takes the early return and `rng.callCount` is unchanged.
Regression hash suite passed without regeneration.

### R2 — `cast_area_entry_best` AI policy ✅

M3 restored the player-side AoE path; `getAiCommand` had no area-aware policy case to match.
Enemy casters now have one. `pickBestAreaAim()` iterates enemy positions as candidate aim
points, scores each as `enemiesHit − alliesHit`, only casts when **strictly positive** — a
blast hitting one PC and one goblin scores 0 and the AI approaches instead. Ties broken by
raw enemy count then `unitId` for determinism.

- `pickBestAreaAim()`, `areaFootprint()`, `readEntryArea()`, `tilesFromFeet()`, `cast_area_entry_best` case — `src/io/battleOrchestrator.ts`
- `contentContext` passed at call site — `src/store/battleStore.ts:688`

Burst-only: `readEntryArea` returns `null` for non-burst shapes and the policy falls through
to approach. No reducer edit, no hash churn.

### R3 — Cone & line AoE shapes (tracked, not scheduled)

Deliberately deferred during M3 — `materializeRawCommand` comments *"Only burst is wired
today; `shape` is kept in the schema so a later line/cone pass has somewhere to hang its
dispatch."* The reference implementation was deleted with `old/`; these are the surviving
design notes:

- **`lineAimPoints()` geometry** — aim sets direction not length. A 60ft lightning bolt aimed at a 2-tile-away goblin still travels 12 tiles. The aim tile picks the ray; the spell's range fills it.
- **`area_save_damage` shape branch** — cone LoE traces from caster (not centre); line stops at the first wall tile; both shapes exclude the caster's own tile.
- **Three-shape `showAreaFootprint(aim, area, state, actorX, actorY)`** — overlay needs the actor origin for cone/line orientation, which is why M5.1's simplified `(cx, cy, radius)` signature won't extend cleanly.
- **9 tests pinned the semantics** — gone with `old/`; fresh tests needed.

**Why not bundled with R1/R2:** M5.1 deliberately simplified `showAreaFootprint`'s signature
to mirror the burst-only reducer. M3.6's 6 tests guard the `shape !== "burst"` throw.
`TargetMode.area` is typed `{ shape: "burst"; ... }`. Re-widening unwinds three deliberate
M3/M5 choices and changes 2 regression hashes (`phase5_mitigation_bypass` — the event
payload gains a `shape` field). Not hard, but it's a **decision to revisit M3's scope**,
which makes it a phase, not a closeout.

---

## Tiled Sandbox — Direct-`.tmj` Path Closeout ✅

Phase 12 marked the `mapDataBridge` spawn/blocked/hazard/objective extractors as delivered,
but only the `tiled_map` hybrid path (JSON wrapper → `.tmj` for terrain only) was ever
exercised in the browser. Building a feature-showcase map (`Tiled/temple_courtyard.tmj`) as
a first-exerciser for the direct-`.tmj` branch (`scenarioLoader.ts:862`) surfaced two gaps
where documented schema fields were silently dropped on that path. Both fixed.

### G1 — `speed` spawn property discarded ✅

`TILED_AUTHORING.md` documents `speed` as a per-unit spawn property, but `SpawnPointData`
lacked the field entirely — `extractSpawnPoints` never read it, `buildScenarioFromTiledMap`
never output it. Every Tiled-loaded unit fell through to `scenarioLoader.ts`'s hard-coded
default of 5. Four one-line additions to `mapDataBridge.ts` (interface field, read with
`?? 5` default, push, output). Ranger now gets speed 6, guardian gets speed 4.

### G2 — Hazards layer discarded on direct `.tmj` load ✅

`buildScenarioFromTiledMap` hard-coded `hazard_routines: []` and never called
`extractHazardZones` — the hybrid `tiled_map` path at `scenarioLoader.ts:903` did extract
hazards correctly, but the direct-`.tmj` path did not. R1 wired `tickHazardZones` into the
reducer; this fix wires the extractor into the bridge. Added a conditional-spread
`map.hazards` block with the same snake_case transform the hybrid path uses. Hazard-free
maps produce byte-identical output — no hash churn.

### Sandbox artifacts

`Tiled/` is a self-contained reference: `gen_tileset.mjs` (pure-Node PNG encoder, 24 tiles
with semantic glyphs — hatch for moveCost, square for cover, ✕ for blocked, chevron for
elevation), `temple_courtyard.tmj` (16×12, embedded tileset, all six layer types),
`validate.mjs` (57 assertions through `buildScenarioFromTiledMap`). Copied to `public/maps/`
+ `public/tilesets/` with one image-path edit; added as the 9th picker entry — the first to
point at a `.tmj` with no JSON wrapper.

**Manual browser test confirmed:** map renders via `tiledTilemapRenderer`; PCs route around
pillars/statue/walls via Dijkstra (`movement.ts` respects `blocked` from the bridge); enemy
`strike_nearest` policy routes the same way. The `.tmj` alone is a playable scenario —
units, objectives, `enemy_policy`, hazard zone all derived from Tiled layers with zero JSON.

**Hash safety held:** conditional spreads gate both fixes. The four existing `.tmj` maps
have no Hazards layer and no per-unit `speed`, so their bridge output is byte-identical.
123/123 IO tests, 44/44 determinism scenarios, 7/7 regression hashes unchanged.

### Follow-on: per-tileset texture filtering ✅

Rendering the temple map surfaced that `tilesetLoader.ts` never set `scaleMode` on loaded
atlases — whatever PixiJS defaulted to, the author couldn't override it. The auto-ratio
container scale (`TILE_SIZE / tilewidth` at `tiledTilemapRenderer.ts:91`) already handles
arbitrary source resolutions — 32px source → 2×, 64px → 1× — but the *sampling mode* at
each ratio was unopinionated. Pixel art at 2× upscale wants `GL_NEAREST` (crisp doubled
pixels); painted art at 1× wants `GL_LINEAR` (soft gradients). This is an art-asset
decision, not a renderer decision.

Added a tileset-level `filter` custom property (`"pixel"` → nearest, `"smooth"` → linear;
default `"pixel"` — all five current tilesets are 32px pixel art). Read in
`tilesetLoader.ts:tilesetScaleMode()`, set on the atlas `TextureSource` before slicing.
`spriteSheetLoader.ts` hardcodes `nearest` — all unit sprites are pixel art, no schema
growth until a painted sprite ships. Documented in `TILED_AUTHORING.md` under a new
*Tileset-Level Properties* section.

Atlas-bleed audit: all five `.tmj` maps have `margin: 0, spacing: 0`. Not a risk —
`@pixi/tilemap` writes `aFrame` with a half-texel inset (`eps = 0.5`, `Tilemap.js:312`)
and the fragment shader clamps UVs to it (`pixi-tilemap.mjs:58`). Watertight under both
filter modes. No tile extrusion needed.

---

## Phase 15 — Preview & Confirm ✅

**Goal:** Two-stage commit for movement — the gameplay mitigation for
[ADR-001](docs/adr/001-no-undo.md)'s decision to drop undo.

**Why this substitutes for undo:** The player gets full *tactical* information (positioning,
AoO threat, path, cover) before spending an action, rather than taking it back after seeing
dice. `detectMoveReactions()` fires inside `dispatchCommand`, so an armed-but-cancelled move
is invisible to the engine — no snapshot needed, no RNG rewind.

- **`ProposedPath` store field** (`battleStore.ts`). `{ tiles, cost, locked }` — UI-tier
  Zustand state. `locked: false` = hover preview, `locked: true` = confirmed/awaiting commit.
  Cleared at every state-reset site (`loadBattle`, `loadSavedGame`, `clearBattle`,
  `advanceCampaignStage`). `setTargetMode` atomically clears it.

- **`ReachResult.dist` exposed** (`grid/movement.ts`). The Dijkstra pass already computed
  per-tile costs; `reachableWithPrev` was discarding it. Now returned in `ReachResult` so the
  UI can populate `ProposedPath.cost` in O(1).

- **Two-phase click flow** (`App.tsx`). First click on a hovered destination locks the
  proposal; second click on the same tile commits. Click elsewhere or Escape unlocks. Escape
  is two-phase: first press unlocks a locked path (back to hover), second exits move mode.

- **Enter key to confirm** (`App.tsx`). `Enter` confirms a locked path (symmetric with
  Escape to unlock). Guards against `isAiTurn` and `battleEnded`.

- **Single-gateway dispatch** (`App.tsx`). The move click handler and Enter key handler read
  **only** from `proposedPath` (store). The `moveReach` memo stays for the hover effect and
  range overlay but is never consulted for dispatch validation — eliminates the dual-Dijkstra
  ownership bug.

- **Locked-path visual** (`rangeOverlay.ts`). `showPathPreview(path, locked)` switches
  chevrons and destination ring from white (hover) to green (locked). Separate colour
  constants (`LOCKED_PATH_COLOR`, `LOCKED_PATH_STROKE`) for clear visual distinction.

- **`MoveConfirmOverlay`** (`ui/MoveConfirmOverlay.tsx`). Canvas-area overlay (bottom-left,
  z-index 6) showing `cost/speed tiles` in green, with Confirm and Cancel buttons. Guarded
  against `isAiTurn` and `battleEnded` — overlay disappears if either fires while a path is
  locked.

- **Stale-lock guard** (`App.tsx`). Effect clears a locked proposal whenever `moveReach`
  recomputes and the destination is no longer reachable (e.g., AI reaction occupies the tile).

- **Ghost sprite at locked destination** (`spriteManager.ts`, `App.tsx`). `showGhostAtTile`
  places a semi-transparent Container (40% alpha) at the destination tile — sprite sheet
  texture if loaded, team-colour rectangle otherwise. `useEffect` keyed on `proposedPath`
  shows it on lock and clears it on unlock/confirm/cancel. `clearUnits` also calls
  `clearGhost` to prevent orphaned containers on battle load. Purely visual; no engine
  contact.

- **AoO threat markers** (`rangeOverlay.ts`, `App.tsx`). New `_threatGraphics` layer (fourth
  independent Graphics layer, drawn above `_pathGraphics`). `showThreatMarkers` draws a red
  ring around each threatening unit. `useEffect` keyed on `proposedPath` iterates the locked
  path step-by-step: for each tile-to-tile step it shallow-copies state with the mover at
  the TO position, calls `detectMoveReactions(fakeState, actorId, fromX, fromY)`, and
  collects unique reactor IDs — no RNG consumed, no state mutated.

**Deferred (not implemented):** Strike/spell confirm evaluation. `ForecastTooltip` already
provides the tactical preview for strikes; adding a confirm step would add clicks without
proportional value. Spells with limited uses/day remain candidates for a future phase.

---

## Phase 16 — Tactical Depth

**Goal:** Make the condition system mechanically meaningful and add core PF2e positioning
tactics. Without this phase, 13 of the 27 content-pack entries (every condition-inflicting
spell, feat, and item) are cosmetic — the UI shows "Frightened 2" but nothing changes in
the engine. This phase gives those entries teeth and adds the positioning layer (flanking,
off-guard, Step) that defines PF2e tactical combat.

**Scope note:** The engine already tracks conditions as `Record<string, number>` and has
immunity support. The work is wiring tracked conditions into the reducer's check resolution,
action economy, and movement validation — not designing a new system.

**Milestone sequencing:**
```
M1 Condition effects ──► M2 Off-guard + flanking ──► M5 Condition-aware AI
                    └──► M3 Step action ──────────┘
                    └──► M4 Dying/wounded ─────────┘
```

### M1 — Condition Mechanical Effects

Wire tracked conditions into the reducer. Each condition below applies its PF2e penalty
inside the existing resolution code paths. No new command types needed.

- **`frightened N`** — Apply −N status penalty to attack rolls, save DCs, saving throws,
  and skill checks. Decrement by 1 at end of turn (auto-recovery). Hook: attack resolution
  in `reducer.ts` strike handler, save resolution in `rules/saves.ts`, turn-end decrement
  in `effects/lifecycle.ts`.

- **`sickened N`** — Identical penalty profile to frightened (−N to checks/DCs/saves).
  Does NOT auto-decrement — must be removed by a Fortitude save (new `retch` action or
  content-pack feat). Add to condition list in `state.ts`.

- **`clumsy N`** — −N to AC, Reflex saves, and DEX-based attack rolls. Hook: AC calculation
  in strike handler, Reflex save path.

- **`stupefied N`** — −N to spell DCs and spell attack rolls. Hook: `cast_spell` /
  `save_damage` / `area_save_damage` DC resolution.

- **`immobilized`** — Speed becomes 0. Hook: `reachableTiles()` early-returns empty set;
  reducer move handler rejects.

- **`slowed N`** — Lose N actions at turn start. Hook: turn-start in `advanceTurn()` —
  set `actionsRemaining = Math.max(0, 3 - N)`.

- **`stunned N`** — Lose N actions at turn start (same as slowed, but clears after spending).
  Hook: same as slowed, plus clear the condition once actions are consumed.

- **`blinded`** — Target is off-guard to all attackers (requires M2). −4 status penalty to
  Perception-based checks (when skill checks exist). Hook: off-guard application in M2.

- **`concealed`** — Attacker must succeed on a DC 5 flat check before the attack roll.
  Failure = miss (no damage, no MAP increment). Hook: strike handler, before attack roll.

**Test plan:** One test per condition verifying the penalty applies. Regression hash suite
re-run after each; conditions that alter RNG consumption (concealed flat check) will need
baseline regeneration.

### M2 — Off-Guard + Flanking

- **`off_guard` condition** — −2 circumstance penalty to AC. Applied by flanking, blinded,
  grabbed, prone, and various class features. Hook: AC lookup in strike handler checks
  `target.conditions["off_guard"] > 0`.

- **Flanking detection** — `isFlanked(state, targetId): boolean` in `src/grid/`. Two enemies
  on opposite sides (180° ± 1 tile) grant off-guard. Checked per-strike, not cached — the
  tactical landscape changes every move. The reducer applies a transient `off_guard` for the
  strike's AC calculation without mutating the target's persistent conditions.

- **Flanking overlay** — When hovering a strike target, tiles that would complete a flank
  highlighted in the range overlay. Low priority; the AC number in ForecastTooltip already
  reflects the bonus.

### M3 — Step Action

- **New command type `step`** — 1 action, move exactly 1 tile (5 ft), does NOT trigger
  `detectMoveReactions`. Validates: tile is adjacent, not blocked, not occupied. No Dijkstra
  needed — Chebyshev-1 adjacency check.

- **`detectMoveReactions` skip** — `dispatchCommand` checks `cmd.type` — `step` bypasses
  the reaction-detection branch. This is the entire mechanical difference from `move`.

- **ActionPanel button** — "Step" appears alongside "Move" when the active unit has ≥1
  action remaining. Enters a step-specific target mode (`type: "step"`) that highlights
  only the 8 adjacent tiles.

- **AI step-back** — `strike_nearest` policy gains a retreat option: if the unit has taken
  MAP −10 and has 1 action left, step away from the nearest enemy instead of ending turn.
  Keeps AI from standing in AoO range for free.

### M4 — Dying / Wounded / Recovery

Replaces the current "HP ≤ 0 → unconscious → out" model with PF2e's death spiral.

- **`dying N` condition** (1–4). Applied when HP drops to 0. Incremented by 1 each turn
  (turn-start hook in `advanceTurn`). At `dying 4` the unit dies (removed from combat
  permanently, not just unconscious). `wounded` value adds to initial dying value.

- **`wounded N` condition**. Applied when a unit recovers from dying (healed above 0).
  Persists until the unit receives a Treat Wounds or full rest. Next time HP hits 0,
  `dying` starts at `1 + wounded`.

- **Recovery check** — DC 10 flat check at turn start (before dying increments). Success:
  dying decreases by 1; if dying reaches 0, unit stabilizes (unconscious but no longer
  dying). Critical success: unit regains 1 HP and wakes. Failure: dying increases by 1.
  Critical failure: dying increases by 2.

- **Healing interaction** — Any healing on a dying unit sets dying to 0 and applies
  `wounded` (or increments it). Unit regains consciousness if HP > 0.

- **Campaign persistence** — `snapshotParty` already carries `wounded` and `doomed` across
  battles. No new persistence work needed.

### M5 — Condition-Aware AI

The AI currently ignores conditions entirely — it doesn't know it's frightened, doesn't
heal when dying, doesn't avoid friendly AoE that would hit slowed allies.

- **Healing priority** — `use_feat_entry_self` / `use_item_entry_self` policies check
  HP threshold; if below 25%, prefer heal over strike. If an ally is dying and the unit
  has a healing entry with `allyTarget`, prioritize that.

- **Condition avoidance** — `cast_area_entry_best` score function penalizes aim points
  that would hit allies with `immobilized` or `slowed` (they can't escape the zone).

- **Retreat when frightened** — If `frightened ≥ 2` and unit has taken MAP this turn,
  prefer Step away over continuing to attack at penalty.

- **Shield awareness** — AI units with `shield_block` reaction and a shield raise it
  if they have 3 actions and expect to be targeted (adjacent to an enemy, or within
  ranged enemy's increment). Currently AI never raises shields.

### Compatibility & Integration Notes

Deep scan of the codebase against Phase 16 milestones (performed at Phase 15 close).
These notes document the specific injection sites, signature changes, and hash-safety
considerations discovered.

**Single-site injection points (low risk):**
- Strike attack roll: single injection site at `reducer.ts` ~line 853 (`effectiveAttackMod`
  before `resolveCheck`) — condition penalties (frightened, sickened, clumsy) slot in here
- AC calculation: single site at `reducer.ts` ~line 852 (`effectiveAc = target.ac +
  coverBonus + shieldBonus`) — off-guard −2 inserts directly
- Turn-start action budget: `advanceTurn()` sets `actionsRemaining = 3` at `reducer.ts`
  ~line 80 — slowed/stunned reduction hooks here
- Immobilized: `reachableWithPrev()` in `movement.ts` can early-return the empty `ReachResult`
  when `conditions["immobilized"] > 0` — no Dijkstra changes needed
- Step command: follows the existing discriminated union pattern in `commands.ts`; reaction
  gate in `dispatchCommand` only fires for `cmd.type === "move"` — Step is automatically
  excluded from AoO detection without any gate change

**Signature changes needed (moderate risk — must update all call sites):**
- `resolveSave(rng, saveType, profile, dc)` in `rules/saves.ts` needs a `conditions`
  parameter for frightened/sickened/clumsy penalties on saves. **6 call sites** in the
  engine layer (`reducer.ts` save handlers, `effects/lifecycle.ts` recovery checks).
  Recommendation: add `conditions` as an optional last parameter with `{}` default to
  avoid breaking existing calls during incremental development.

**Extraction needed before M4 (dying/wounded):**
- HP-to-zero logic is scattered across **8 sites** in `reducer.ts` (strike damage, save
  damage, area save damage, persistent damage, hazard damage, affliction damage, reaction
  damage, effect damage). Currently each site independently checks `hp <= 0` and sets
  unconscious. M4 must extract this into a `resolveHpZero(state, unitId)` helper that
  applies dying/wounded and routes through the recovery system. Do this extraction as the
  first step of M4 — the refactor is safe before the mechanic exists.

**Campaign persistence:**
- `PERSISTENT_CONDITIONS` set in `campaignState.ts` already includes `"drained"` and
  `"doomed"`. Just needs `"wounded"` added for M4. `snapshotParty`/`applyPartySnapshot`
  will carry it automatically.

**Content pack safety:**
- All 13 condition-applying content-pack entries target enemies, not allies — safe for
  M1 to wire effects without worrying about self-inflicted penalty loops.
- No regression scenarios have pre-set conditions on units — wiring condition effects
  won't change existing scenario hash baselines unless conditions are actually applied
  during a run.

**AI policy adjustments:**
- `getAiCommand`'s `stepToward()` in `movement.ts` does not check conditions — if
  `slowed` reduces speed via `reachableWithPrev`, the AI will compute shorter reach
  automatically (Dijkstra sees fewer tiles). But `stepToward` itself calls
  `reachableTiles(state, unit)` which reads `unit.speed` — M1 must ensure immobilized
  returns empty here. No new AI code needed for basic condition support; M5 adds
  tactical awareness on top.
- `strike_nearest` policy's 4-pass fallback chain naturally degrades gracefully: if
  conditions make attacks miss more often, the AI just whiffs — it doesn't need to
  know about frightened to function. M5 adds intelligence, not correctness.

**Determinism & hash impact:**
- Three conditions introduce **new RNG calls**: concealed (DC 5 flat check before
  attack), blinded (DC 11 flat check variant), dying (DC 10 recovery check at turn
  start). Any scenario where these conditions appear will have different RNG consumption
  → different hash. Since no existing regression scenario applies these conditions,
  existing baselines are safe. **New test scenarios** that exercise conditions will need
  their own baselines.
- Event payload field additions (e.g., `"off_guard": true` on strike events, `"condition_penalty": -2`)
  change `replayHash` via `sortedJson`. Recommendation: add fields only to new event types
  or optional fields on existing ones. Run `validate:determinism` after each milestone;
  regenerate regression baselines once at Phase 16 close (not per-milestone).

**No circular dependency risks:**
- `reducer.ts` already imports from `grid/movement.ts` and `rules/conditions.ts` — new
  penalty functions in `rules/conditions.ts` don't introduce new import edges.
- Flanking geometry helper can live in `grid/movement.ts` alongside existing
  `chebyshevDistance` — used only by the reducer's strike handler.

---

## Phase 17 — Audio & Production

**Goal:** Sound, particles, tutorial, deployment.

**Deliverables:**
- Particle effects for spells (fire burst, lightning arc) via PixiJS ParticleContainer
- Sound effects (hit, miss, spell cast, UI click) and ambient loop via Web Audio API
- First-battle tutorial overlay — walks through Move, Strike, End Turn on `interactive_arena`
- Mobile layout pass (tablet minimum; phone deferred)
- Vite production build + static hosting pipeline (GitHub Pages / Netlify / S3)
- Performance pass: sprite pooling, Graphics batch-draw, rAF budget monitoring
