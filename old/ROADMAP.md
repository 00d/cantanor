# Cantanor — Development Roadmap

This document tracks the forward-looking feature phases for Cantanor, a browser-based tactical
TRPG built on Pathfinder 2e ORC mechanics.

The engine (Phases 3–9) and its TypeScript browser port are **complete**: 13 command types,
deterministic RNG, content packs, enemy AI, mission events, hazard routines, and 275 passing
tests across 17 test files. The phases below build the gameplay and production layers on top.

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

## Phase 14 — Polish & Production

**Goal:** Animation, audio, accessibility, and deployment-readiness.

**Deliverables:**
- Smooth move animation: sprite tweens to destination via PixiJS Ticker
- Attack / spell animations: flash effects and floating damage numbers
- Particle effects for spells (fire burst, lightning arc)
- Sound effects and ambient music via Web Audio API
- Keyboard shortcuts: WASD camera, 1–9 ability slots, Enter / Space confirm
- First-battle tutorial overlay
- Mobile layout (tablet support minimum; phone layout deferred)
- Vite production build + static hosting pipeline
