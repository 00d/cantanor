# Cantanor — Development Roadmap

This document tracks the forward-looking feature phases for Cantanor, a browser-based tactical
TRPG built on Pathfinder 2e ORC mechanics.

The engine (Phases 3–9) and its TypeScript browser port are **complete**: 13 command types,
deterministic RNG, content packs, enemy AI, mission events, hazard routines, and 176 passing
tests across 12 test files. The phases below build the gameplay and production layers on top.

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

**Remaining deliverables:**
- Tiled custom properties: `moveCost`, `elevation`, `coverGrade` per tile-layer
- BFS movement cost uses `moveCost` (difficult terrain = 2 tiles of speed per step)
- LOE/cover grade derived from `coverGrade` tile property
- 2–3 new Tiled arenas: castle courtyard, forest clearing, dungeon corridor
- Camera pan (WASD / drag) and zoom (scroll wheel) via `cameraController`

---

## Phase 12 — Character Depth & Campaign

**Goal:** Player-facing character systems and linked multi-battle progression.

**Deliverables:**
- Character sheet panel: AC, saves, resistances/immunities, available abilities
- Per-unit ability tracking: feats have limited uses per day; items are consumable
- Campaign flow: ordered scenario list with locked stages and a simple narrative frame
- Persistent party: HP state carries between battles, healing available at camp screens
- Save / load: game state serialised to `localStorage`

---

## Phase 13 — Polish & Production

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
