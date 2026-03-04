# Cantanor — Development Roadmap

This document tracks the forward-looking feature phases for Cantanor, a browser-based tactical
TRPG built on Pathfinder 2e ORC mechanics.

The engine (Phases 3–9) and its TypeScript browser port are **complete**: 13 command types,
deterministic RNG, content packs, enemy AI, mission events, hazard routines. **210 passing
tests across 16 files.** The phases below build the gameplay and production layers on top.

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

## Phase 11 — Rich Maps & Visual Terrain

**Goal:** Tiled maps become fully functional game surfaces.

**Already landed (ahead of schedule):**
- Tiled `.tmj` loader, GPU tilemap renderer, tileset image resolution ✅
- `mapDataBridge` extracts spawn points, blocked tiles, hazard zones, objectives ✅
- Auto-generated `enemy_policy` from Tiled spawn team properties ✅

**Landed (Phase 12 reach-back):**
- Camera pan (drag) and zoom (scroll wheel) ✅
- Camera bounds clamp — viewport never shows void past the map edge ✅

**Remaining deliverables:**
- Tiled custom properties: `moveCost`, `elevation`, `coverGrade` per tile-layer
- BFS movement cost uses `moveCost` (difficult terrain = 2 tiles of speed per step)
- LOE/cover grade derived from `coverGrade` tile property
- 2–3 new Tiled arenas: castle courtyard, forest clearing, dungeon corridor

---

## Phase 12 — Make It Feel Like A Game ✅

**Axis pivot.** The original Phase 12 plan (Character Depth & Campaign — preserved below) was
deferred in favour of a feel-and-flow pass. The engine was correct but the game didn't read as
a game: moves teleported, the AI acted before the player could see the previous action land,
there was no undo, and the turn order was opaque.

**M1 — Animation-gated AI**
- Sprite tweens: units lerp to their destination instead of snapping (`spriteManager.ts`)
- `_scheduleAiTurn` polls `transient.activeAnimCount` via rAF instead of a flat delay — the
  AI waits for your move to finish animating before it responds
- `SETTLE_FRAMES=2` bridges the React-passive-effect-vs-Pixi-ticker ordering gap

**M2 — Path preview**
- Hovering a reachable tile during Move mode paints the BFS path the unit will take

**M3 — AoE footprint + Fireball**
- Area-shaped spells (burst/cone/line) with live hover-painted blast footprints
- Fireball in `phase10_v1` content pack as the reference implementation

**M4 — Turn-order ribbon** (`TurnOrderRibbon.tsx`)
- Horizontal initiative strip; auto-scrolls to the active unit
- Click-to-focus-camera, hover-to-highlight-tile; dead units stay faded in the strip

**M5 — Undo stack** (`undo.test.ts`: 13 tests)
- Step-back within the current PC turn; `end_turn` commits and flushes
- Snapshots hold `battle` **by reference** — safe because `applyCommand` deep-clones the entire
  state as its first statement, so prev-state is never mutated (~24 B/snapshot, not a tree)
- RNG reconstructed via `new DeterministicRNG(seed, skipCount)` on pop (mulberry32 can't seek)
- Ctrl/Cmd+Z works even after the winning blow — checked before the `battleEnded` guard
- RNG reset-on-throw in `dispatchCommand`'s catch: `rng.callCount` always matches committed
  `battle`, even if a handler rolls then throws

**M6 — Polish** (partial)
- `loadGeneration` gen-fence discipline: every deferred store write captures gen at
  schedule-time, checks it at fire-time; stale timers silently retire instead of stomping
  the fresh battle's `isAiTurn` / flushing its `undoStack`. Three sites fixed: `act()`,
  `pollSettled()`, anti-deadlock `setTimeout` in the catch block
- Camera bounds clamp: `setCameraBounds(tilesW, tilesH)`; viewport never shows void past the
  map edge; maps smaller than the viewport centre
- Ribbon scroll jitter: `behavior: isAiTurn ? "auto" : "smooth"` read via `getState()` at
  effect-fire-time (not subscription); AI-to-AI hops snap, the final AI-to-PC handoff smooths

**Tracked, not shipped** (surfaced by post-M6 scan):
- `CombatLogPanel.tsx:114` has the same scroll-jitter shape as the ribbon had — keyed on
  `eventLog.length` (changes per-action), hardcoded `behavior:"smooth"`. Same cure applies.
- `undo.test.ts:90-91` — module-level `vi.spyOn(console)` never restored. Safe under
  Vitest's default `isolate:true`; breaks if anyone flips to `isolate:false` for speed.
- `clearBattle` doesn't bump `loadGeneration`. Currently benign (stale timers hit `!battle`
  same-gen abort), but any future timer that fences on gen-only won't be caught.
- Death fade-out, damage-number stagger for multi-target AoE, portrait CSS, Lightning Bolt.

---

## Phase 12 (original plan — deferred) — Character Depth & Campaign

**Goal:** Player-facing character systems and linked multi-battle progression.

**Deliverables:**
- Character sheet panel: AC, saves, resistances/immunities, available abilities
- Per-unit ability tracking: feats have limited uses per day; items are consumable
- Campaign flow: ordered scenario list with locked stages and a simple narrative frame
- Persistent party: HP state carries between battles, healing available at camp screens
- Save / load: game state serialised to `localStorage` ✅ *(landed early in Phase 10)*

---

## Phase 13 — Polish & Production

**Goal:** Animation, audio, accessibility, and deployment-readiness.

**Landed early via Phase 12:**
- Smooth move animation: sprite tweens via PixiJS Ticker ✅
- Attack / spell animations: hit-flash + floating damage numbers ✅ *(stagger for multi-target still open)*
- Keyboard shortcuts: E end-turn, Esc cancel, G grid, Ctrl/Cmd+Z undo ✅ *(WASD camera, ability slots still open)*

**Remaining deliverables:**
- Particle effects for spells (fire burst, lightning arc)
- Sound effects and ambient music via Web Audio API
- WASD camera pan, 1–9 ability slot hotkeys, Enter/Space confirm
- First-battle tutorial overlay
- Mobile layout (tablet support minimum; phone layout deferred)
- Vite production build + static hosting pipeline
