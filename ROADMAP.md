# Cantanor — Development Roadmap

This document tracks the forward-looking feature phases for Cantanor, a browser-based tactical
TRPG built on Pathfinder 2e ORC mechanics.

The engine (Phases 3–9) and its TypeScript browser port are **complete**: 13 command types,
deterministic RNG, content packs, enemy AI, mission events, hazard routines, and 344 passing
tests across 22 test files. The phases below build the gameplay and production layers on top.

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

## Phase 15 — Preview & Confirm

**Goal:** Two-stage commit for movement — the gameplay mitigation for
[ADR-001](docs/adr/001-no-undo.md)'s decision to drop undo.

Currently clicking a reachable tile immediately dispatches the Move and spends the action.
Two-stage commit inserts an arm/confirm step: click once to arm, click again (or Enter) to
confirm, Esc to cancel at zero cost.

**Deliverables:**
- Ghost sprite at armed destination (reuses `spriteManager`'s tween target as the ghost position)
- **AoO threat markers**: every enemy whose reach the armed path passes through gets a
  warning badge. Computed by running `detectMoveReactions()` against a copy of state with
  the ghost position substituted — no RNG, no mutation.
- Armed state lives in `TargetMode` — extend with `armedDestination?: [number, number]`
- Confirm via Enter or second click on same tile; any other click or Esc dis-arms
- Strike/spell targeting already has a de-facto preview (forecast tooltip on hover) — evaluate
  whether a confirm step adds value or just adds clicks

**Why this substitutes for undo:** The player gets full *tactical* information (positioning,
AoO threat, path, cover) before spending an action, rather than taking it back after seeing
dice. `detectMoveReactions()` fires inside `dispatchCommand`, so an armed-but-cancelled move
is invisible to the engine — no snapshot needed, no RNG rewind.

---

## Phase 16 — Audio & Production

**Goal:** Sound, particles, tutorial, deployment.

**Deliverables:**
- Particle effects for spells (fire burst, lightning arc) via PixiJS ParticleContainer
- Sound effects (hit, miss, spell cast, UI click) and ambient loop via Web Audio API
- First-battle tutorial overlay — walks through Move, Strike, End Turn on `interactive_arena`
- Mobile layout pass (tablet minimum; phone deferred)
- Vite production build + static hosting pipeline (GitHub Pages / Netlify / S3)
- Performance pass: sprite pooling, Graphics batch-draw, rAF budget monitoring
