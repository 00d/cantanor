# TypeScript Browser Refactoring Plan
## Python to TypeScript/PixiJS/React Migration for Pathfinder 2e Tactical RPG

**Document Version:** 1.0
**Date:** February 6, 2026
**Status:** Planning Phase

---

## Executive Summary

This document outlines a comprehensive strategy to refactor the existing Python-based Pathfinder 2e tactical RPG engine (~5,100 lines of Python code across 9 implementation phases) into a browser-based game using TypeScript, PixiJS for rendering, and React for UI. The architecture employs a **Split Viewport** approach where the game canvas and UI panels exist as separate, non-overlapping sections of the browser viewport, eliminating the performance bottlenecks of overlay-based architectures.

### Key Architecture Principles

1. **Split Viewport Architecture**: Canvas and UI are side-by-side sections, not overlaid
2. **Deterministic Engine Preservation**: The core tactical simulation remains deterministic
3. **Frequency Segregation**: High-frequency game state updates bypass React reconciliation
4. **ORC License Compliance**: All game rules reference Pathfinder 2e ORC-licensed content
5. **Panel-Based UI Layout**: Separate panels for world view, text log, and party stats (inspired by classic tactical RPGs)

---

## Current Python Codebase Analysis

### Repository Structure

```
engine/
├── core/          # State management, commands, reducer, turn order
├── rules/         # Game rules (checks, saves, damage, conditions)
├── grid/          # Tactical grid (movement, LOS, LOE, areas)
├── effects/       # Effect lifecycle system
├── io/            # Content packs, scenarios, loaders
└── cli/           # Command-line runner

corpus/
├── books/         # Source book metadata
└── content_packs/ # Versioned game content

scenarios/
├── smoke/         # Test scenarios
└── regression_*/  # Deterministic regression tests

extracted/         # Parsed Pathfinder 2e rule text
compiled/          # Generated rule data files
tests/             # Comprehensive test suite
```

### Core Architecture Components

#### 1. State Management (`engine/core/state.py`)
- **BattleState**: Deterministic battle simulation state
  - Units, effects, map, turn order, flags
  - Event sequence counter for deterministic replay
- **UnitState**: Character/enemy state
  - Position, HP, stats, conditions, resistances
- **EffectState**: Timed effects with lifecycle hooks
- **MapState**: Grid dimensions and blocked tiles

#### 2. Command/Reducer Pattern (`engine/core/reducer.py`, `commands.py`)
- Deterministic command execution (Strike, Move, Cast Spell, etc.)
- 15+ command types with validation
- Event log generation for replay/UI
- Reducer pattern ensures pure functional updates

#### 3. Grid Systems (`engine/grid/`)
- **Line of Sight (LOS)**: Vision blocking
- **Line of Effect (LOE)**: Cover calculation (standard/greater)
- **Areas**: Radius, cone, line targeting
- **Movement**: Pathfinding with action costs

#### 4. Rules Engine (`engine/rules/`)
- **Checks**: D20 roll resolution with degrees of success
- **Saves**: Fortitude/Reflex/Will saves
- **Damage**: Typed damage with resistances/weaknesses/immunities
- **Conditions**: Status effects (frightened, stunned, etc.)

#### 5. Effect Lifecycle (`engine/effects/lifecycle.py`)
- Apply hooks (initial application)
- Tick hooks (turn start/end processing)
- Expire hooks (cleanup)
- Affliction staging system

#### 6. Content Management (`engine/io/`)
- **Content Pack Loader**: Versioned content with compatibility checks
- **Scenario Loader**: Battle definitions with objectives
- **Command Authoring**: UI helper for available actions

### Implementation Phases (Python Codebase)

The Python engine was built across 9 phases:
- **Phase 1-2**: Core primitives and rules compilation
- **Phase 3**: Deterministic engine, command reducer, scenarios
- **Phase 3.5**: Afflictions, area effects, LOS/LOE
- **Phase 4**: Objectives, mission events, hazard routines
- **Phase 5**: Damage mitigation, temp HP, condition immunity
- **Phase 6**: Gameplay commands (cast spell, use feat/item), forecasting, AI
- **Phase 7**: Content pack system, interact command
- **Phase 8**: Content-entry templates, pack-driven AI
- **Phase 9**: Command authoring for UI, AI rationale

**Total Codebase**: ~5,100 lines of Python, 183 tracked files, comprehensive test coverage

---

## Browser Architecture Design

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Language** | TypeScript 5.x | Type safety, modern language features |
| **Rendering** | PixiJS 8.x (WebGL) | WebGL-accelerated 2D rendering (WebGL renderer for production) |
| **UI Framework** | React 19.x | Declarative UI with hooks (stable as of Dec 2024, current: 19.2.4) |
| **State Management** | Zustand 4.x | Lightweight state with transient update support |
| **Build Tool** | Vite 5.x | Fast dev server, optimized builds |
| **Testing** | Vitest + Playwright | Unit and E2E testing |
| **Graphics Assets** | Sprite sheets, tile sets | 2D pixel art (Fire Emblem style) |

### Split Viewport Layout (Desktop 1920×1080)

```
┌─────────────────────────────────────────────────────────────┐
│  Header Bar (React) - 1920×60px                             │
│  [Turn: PC Fighter] [Round 3] [Phase: Enemy] [Settings]    │
├──────────────────────────────────┬──────────────────────────┤
│                                  │                          │
│   Game Canvas (PixiJS)           │   Right Panel (React)    │
│   1200×900px (62%)               │   720px (38%)            │
│                                  │                          │
│   ┌────────────────────────────┐ │   ┌──────────────────┐  │
│   │                            │ │   │  Party Panel     │  │
│   │  Tactical Grid (4:3)       │ │   │  720×300px       │  │
│   │                            │ │   └──────────────────┘  │
│   │  - 18×18 tile grid         │ │                          │
│   │  - Unit sprites            │ │   ┌──────────────────┐  │
│   │  - Visual effects          │ │   │  Combat Log      │  │
│   │  - Damage numbers          │ │   │  720×400px       │  │
│   │                            │ │   │  (virtualized)   │  │
│   └────────────────────────────┘ │   └──────────────────┘  │
│                                  │                          │
│   Golden Ratio: 1.618:1          │   ┌──────────────────┐  │
│   Follows F-pattern reading      │   │  Action Panel    │  │
│                                  │   │  720×200px       │  │
│                                  │   └──────────────────┘  │
└──────────────────────────────────┴──────────────────────────┘

Total: 1920px width × 960px height
Canvas: 1200px (62.5%) | UI Panel: 720px (37.5%) ← Golden Ratio!
```

**Key Layout Characteristics:**
- **Golden Ratio Proportions**: 62:38 split (research-validated optimal ratio)
- **No Overlays**: Canvas and React UI are sibling elements in a flex container
- **Responsive Design**: Adapts from 375px mobile to 4K desktops (see OPTIMAL_PANEL_LAYOUTS.md)
- **Independent Scrolling**: Combat log scrolls independently with virtualization
- **Click Segregation**: Clicks in canvas go to game; clicks in panels go to UI
- **Zero Coordinate Sync**: No frame-by-frame position updates needed
- **WCAG 2.2 Compliant**: Touch targets 48×48px minimum, contrast ratios meet AA standards

**See OPTIMAL_PANEL_LAYOUTS.md for complete responsive specifications and breakpoint strategies.**

---

## Module Mapping: Python → TypeScript

### Core Engine

| Python Module | TypeScript Module | Notes |
|---------------|-------------------|-------|
| `engine/core/state.py` | `src/engine/core/State.ts` | Interfaces for BattleState, UnitState, EffectState |
| `engine/core/commands.py` | `src/engine/core/Commands.ts` | Command type definitions |
| `engine/core/reducer.py` | `src/engine/core/Reducer.ts` | Pure reducer functions |
| `engine/core/rng.py` | `src/engine/core/RNG.ts` | Deterministic PRNG (seedable) |
| `engine/core/turn_order.py` | `src/engine/core/TurnOrder.ts` | Initiative ordering |
| `engine/core/ids.py` | `src/engine/core/IDs.ts` | ID generation utilities |
| `engine/core/objectives.py` | `src/engine/core/Objectives.ts` | Victory/defeat conditions |
| `engine/core/forecast.py` | `src/engine/core/Forecast.ts` | Action preview calculations |

### Grid Systems

| Python Module | TypeScript Module | Notes |
|---------------|-------------------|-------|
| `engine/grid/map.py` | `src/engine/grid/Map.ts` | Bounds checking, blocking |
| `engine/grid/movement.py` | `src/engine/grid/Movement.ts` | Pathfinding algorithms |
| `engine/grid/los.py` | `src/engine/grid/LOS.ts` | Line of sight |
| `engine/grid/loe.py` | `src/engine/grid/LOE.ts` | Line of effect + cover |
| `engine/grid/areas.py` | `src/engine/grid/Areas.ts` | Radius/cone/line targeting |

### Rules Engine

| Python Module | TypeScript Module | Notes |
|---------------|-------------------|-------|
| `engine/rules/checks.py` | `src/engine/rules/Checks.ts` | D20 check resolution |
| `engine/rules/saves.py` | `src/engine/rules/Saves.ts` | Saving throws |
| `engine/rules/damage.py` | `src/engine/rules/Damage.ts` | Damage calculation + mitigation |
| `engine/rules/conditions.py` | `src/engine/rules/Conditions.ts` | Status effects |
| `engine/rules/degrees.py` | `src/engine/rules/Degrees.ts` | Success degree constants |

### Effects System

| Python Module | TypeScript Module | Notes |
|---------------|-------------------|-------|
| `engine/effects/lifecycle.py` | `src/engine/effects/Lifecycle.ts` | Apply/tick/expire hooks |
| `engine/effects/registry.py` | `src/engine/effects/Registry.ts` | Effect type registry |
| `engine/effects/handlers/*.py` | `src/engine/effects/handlers/*.ts` | Specific effect handlers |

### Content & IO

| Python Module | TypeScript Module | Notes |
|---------------|-------------------|-------|
| `engine/io/scenario_loader.py` | `src/engine/io/ScenarioLoader.ts` | JSON scenario parsing |
| `engine/io/content_pack_loader.py` | `src/engine/io/ContentPackLoader.ts` | Content pack loading |
| `engine/io/command_authoring.py` | `src/engine/io/CommandAuthoring.ts` | UI action catalog |
| `engine/io/event_log.py` | `src/engine/io/EventLog.ts` | Event formatting |

### NEW: Rendering Layer (PixiJS)

| Module | Purpose |
|--------|---------|
| `src/rendering/PixiApp.ts` | Main PixiJS application setup |
| `src/rendering/TileRenderer.ts` | Grid tile rendering |
| `src/rendering/SpriteManager.ts` | Unit sprite management |
| `src/rendering/EffectRenderer.ts` | Visual effects (damage numbers, particles) |
| `src/rendering/CameraController.ts` | Viewport pan/zoom |
| `src/rendering/InputHandler.ts` | Mouse/touch input for canvas |
| `src/rendering/AssetLoader.ts` | Sprite sheet loading |

### NEW: React UI Layer

| Module | Purpose |
|--------|---------|
| `src/ui/App.tsx` | Root layout with split viewport |
| `src/ui/components/PartyPanel.tsx` | Party member stats |
| `src/ui/components/CombatLog.tsx` | Scrolling text log |
| `src/ui/components/ActionPanel.tsx` | Available actions UI |
| `src/ui/components/TurnOrderDisplay.tsx` | Initiative tracker |
| `src/ui/components/TargetPanel.tsx` | Selected target info |
| `src/ui/hooks/useGameState.ts` | Zustand game state hook |
| `src/ui/hooks/useTransientUpdate.ts` | Direct DOM update hook |

---

## Phased Migration Strategy

### Phase 1: Core TypeScript Engine (2-3 weeks)

**Goal**: Port deterministic engine without any UI/rendering.

**Tasks**:
1. Set up TypeScript project structure with Vite
2. Port core state interfaces (`State.ts`, `Commands.ts`)
3. Port RNG and ID generation utilities
4. Port reducer logic with command handlers
5. Port turn order and objective evaluation
6. Create unit tests mirroring Python test suite
7. Verify deterministic replay with known scenario hashes

**Deliverables**:
- `src/engine/core/` modules complete
- Unit tests passing for basic scenarios
- CLI runner for testing scenarios (Node.js)

**Key Decisions**:
- Use `type` instead of `interface` for command unions (better discriminated unions)
- Use `readonly` for immutable state properties
- Use `Partial<>` for optional command fields

### Phase 2: Grid & Rules Systems (2-3 weeks)

**Goal**: Complete tactical simulation without rendering.

**Tasks**:
1. Port grid algorithms (LOS, LOE, areas, movement)
2. Port rules engine (checks, saves, damage, conditions)
3. Port effect lifecycle system
4. Create comprehensive unit tests
5. Run regression test suite against Python baselines

**Deliverables**:
- `src/engine/grid/` modules complete
- `src/engine/rules/` modules complete
- `src/engine/effects/` modules complete
- Full regression test suite passing

**Key Decisions**:
- Use typed tuples for coordinates: `[x: number, y: number]`
- Use `Set<string>` for blocked tiles/point collections
- Use `Map<string, T>` for keyed collections (units, effects)

### Phase 3: PixiJS Rendering Layer (3-4 weeks)

**Goal**: Visualize battles in a canvas viewport.

**Tasks**:
1. Set up PixiJS application with WebGL renderer
2. Create tile renderer for grid (isometric or orthogonal)
3. Implement sprite manager for units
4. Add camera controls (pan, zoom, focus)
5. Implement input handler for tile selection
6. Add visual effects (damage numbers, hit animations)
7. Create asset loading system for sprite sheets

**Deliverables**:
- `src/rendering/` modules complete
- Canvas displays battles visually
- Click-to-select units/tiles
- Smooth camera transitions

**Key Decisions**:
- Use **orthogonal grid** (not isometric) for Fire Emblem clarity
- 5-foot squares = 64x64px tiles (adjustable)
- Sprite sheets use JSON atlas format (TexturePacker compatible)
- Use PixiJS `BitmapText` for damage numbers (batched rendering)
- Camera uses smooth lerp interpolation (not instant snap)

**Performance Strategy**:
- Batch all sprites with same texture into single draw call
- Use object pooling for damage number objects
- Limit particle effects to 100 concurrent particles
- Use PixiJS culling for off-screen sprites

### Phase 4: React UI Framework (3-4 weeks)

**Goal**: Build split-viewport UI with React panels.

**Tasks**:
1. Create root `App.tsx` with CSS flex layout
2. Implement Zustand store for game state
3. Build PartyPanel with unit stats
4. Build CombatLog with virtualized scrolling
5. Build ActionPanel with command buttons
6. Implement useTransientUpdate hook for HP bars
7. Create TurnOrderDisplay component
8. Wire up click handlers to dispatch commands

**Deliverables**:
- `src/ui/` modules complete
- Split viewport layout functional
- All major UI panels implemented
- State management with Zustand

**Key Decisions**:
- Use **CSS Flexbox** for layout (not Grid)
- Canvas is `600x600px` fixed size (configurable)
- Right panel is `400px` wide (min-width)
- Combat log uses `react-window` for virtualization
- HP bars update via `useRef` + transient updates (no re-renders)
- Use Zustand's `subscribe` for high-frequency updates

**Layout Code Example**:
```tsx
// App.tsx
<div className="app-container" style={{ display: 'flex', height: '100vh' }}>
  <div className="canvas-container" style={{ width: 600, height: 600 }}>
    <canvas ref={canvasRef} />
  </div>
  <div className="ui-panel" style={{ flex: 1, minWidth: 400 }}>
    <PartyPanel />
    <CombatLog />
    <ActionPanel />
  </div>
</div>
```

### Phase 5: Content Pack Integration (2 weeks)

**Goal**: Load content from JSON packs.

**Tasks**:
1. Port content pack loader
2. Create content pack schema validation
3. Implement pack compatibility checks
4. Load spells/feats/items from packs
5. Wire content entries to command authoring
6. Create browser asset loading for pack icons

**Deliverables**:
- `src/engine/io/ContentPackLoader.ts` complete
- Phase 7/9 baseline packs loadable
- Command authoring generates action buttons

**Key Decisions**:
- Content packs loaded via `fetch()` at startup
- Validate against JSON schema (Zod or io-ts)
- Asset URLs in packs resolve relative to pack URL
- Cache packs in IndexedDB for offline play

### Phase 6: Advanced Features (3-4 weeks)

**Goal**: Add forecasting, AI, and polish.

**Tasks**:
1. Port forecast system for action previews
2. Implement enemy AI policies (strike_nearest, etc.)
3. Add pack-driven AI actions
4. Implement action cost display
5. Add move range/attack range overlays
6. Create targeting reticle for area effects
7. Add sound effects and music

**Deliverables**:
- Forecast tooltips on hover
- Functional enemy AI
- Visual range indicators
- Audio integration

**Key Decisions**:
- Forecast calculations run in web worker (off main thread)
- AI decisions logged with rationale (Phase 9 feature)
- Range overlays rendered in PixiJS (not DOM)
- Audio uses Web Audio API with `Howler.js`

### Phase 7: Polish & Optimization (2-3 weeks)

**Goal**: Production-ready game.

**Tasks**:
1. Implement save/load system (IndexedDB)
2. Add settings menu (volume, graphics quality)
3. Create main menu and scenario selection
4. Add animations and screen transitions
5. Optimize bundle size (code splitting)
6. Implement accessibility features (keyboard nav)
7. Add mobile touch controls
8. Deploy to static hosting (Netlify/Vercel)

**Deliverables**:
- Complete game experience
- Production build < 5MB
- Mobile-responsive
- Deployed playable demo

**Key Decisions**:
- Use `localStorage` for settings, `IndexedDB` for saves
- Code-split content packs (lazy load)
- Compress sprite sheets with tinypng
- Use semantic HTML + ARIA labels for a11y
- Mobile uses virtual joystick (PhaserJS joystick plugin)

---

## State Management Architecture

### Zustand Store Structure

```typescript
// src/store/gameStore.ts
interface GameStore {
  // Core battle state (immutable updates)
  battle: BattleState | null;

  // UI state (high-frequency)
  selectedUnitId: string | null;
  hoveredTilePos: [number, number] | null;
  targetMode: { type: 'strike' | 'spell', range: number } | null;

  // Transient state (direct updates, no re-renders)
  transient: {
    cameraX: number;
    cameraY: number;
    animationQueue: Animation[];
  };

  // Actions
  loadScenario: (scenario: Scenario) => void;
  dispatchCommand: (command: Command) => void;
  selectUnit: (unitId: string | null) => void;
  setHoverTile: (pos: [number, number] | null) => void;
  setTargetMode: (mode: TargetMode | null) => void;
}

const useGameStore = create<GameStore>((set, get) => ({
  battle: null,
  selectedUnitId: null,
  hoveredTilePos: null,
  targetMode: null,
  transient: { cameraX: 0, cameraY: 0, animationQueue: [] },

  loadScenario: (scenario) => {
    const battle = initializeBattle(scenario);
    set({ battle });
  },

  dispatchCommand: (command) => {
    const { battle } = get();
    if (!battle) return;

    const { newState, events } = reduceCommand(battle, command);
    set({ battle: newState });

    // Queue animations based on events
    const animations = eventsToAnimations(events);
    get().transient.animationQueue.push(...animations);
  },

  // ... other actions
}));
```

### Frequency Segregation Pattern

| Data Type | Update Pattern | Storage | Re-render? |
|-----------|---------------|---------|-----------|
| Battle state | Command dispatch | Zustand store | Yes (infrequent) |
| Party HP/stats | After damage events | Zustand store | Yes (infrequent) |
| HP bar widths | Every damage tick | Direct DOM via ref | No |
| Camera position | Every frame | Transient store | No |
| Damage numbers | Effect lifecycle | PixiJS objects | N/A (Canvas) |
| Hover highlights | Mouse move | PixiJS filters | N/A (Canvas) |

**Example: Transient HP Bar Update**

```typescript
// src/ui/hooks/useTransientUpdate.ts
export function useTransientHPBar(unitId: string) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to HP changes without triggering React re-render
    const unsub = useGameStore.subscribe(
      (state) => state.battle?.units[unitId]?.hp,
      (hp) => {
        if (barRef.current && hp !== undefined) {
          const maxHp = useGameStore.getState().battle?.units[unitId]?.max_hp || 1;
          const percent = (hp / maxHp) * 100;
          barRef.current.style.width = `${percent}%`;
        }
      }
    );
    return unsub;
  }, [unitId]);

  return barRef;
}
```

---

## Data Flow Diagram

```
User Input (Canvas Click)
    │
    ↓
InputHandler (PixiJS)
    │
    ↓
GameStore.dispatchCommand(command)
    │
    ↓
Reducer(state, command)
    │
    ├→ New BattleState
    │      │
    │      ↓
    │  Zustand Store Update
    │      │
    │      ├→ React Components Re-render (infrequent)
    │      │      │
    │      │      ↓
    │      │  PartyPanel, CombatLog, ActionPanel
    │      │
    │      └→ PixiJS Re-render Triggered
    │             │
    │             ↓
    │         SpriteManager updates positions/states
    │
    └→ Event Log
           │
           ↓
       EventLog Formatter
           │
           ├→ CombatLog (React, scrolls to bottom)
           │
           └→ AnimationQueue (PixiJS)
                  │
                  ↓
              EffectRenderer plays animations
```

---

## Asset Pipeline

### Sprite Sheets

**Format**: TexturePacker JSON (with frames and metadata)

**Naming Convention**:
- `units/fighter.json` + `units/fighter.png`
- `tiles/grass.json` + `tiles/grass.png`
- `effects/explosion.json` + `effects/explosion.png`

**Resolution**: 64x64px per tile/unit (2x for retina)

**Loading**:
```typescript
// src/rendering/AssetLoader.ts
export async function loadAssets() {
  const loader = PIXI.Assets;

  await loader.load([
    { alias: 'units', src: '/assets/sprites/units.json' },
    { alias: 'tiles', src: '/assets/sprites/tiles.json' },
    { alias: 'effects', src: '/assets/sprites/effects.json' },
  ]);
}
```

### Content Pack Assets

**Structure**:
```json
// phase7_baseline_v1.json
{
  "pack_id": "phase7-baseline-v1",
  "assets": {
    "icons": {
      "spell.arc_flash": "/assets/icons/arc_flash.png",
      "feat.quick_patch": "/assets/icons/quick_patch.png"
    }
  },
  "entries": [ ... ]
}
```

---

## Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Frame Rate | 60 FPS | PixiJS batching, object pooling |
| Initial Load | < 3s | Code splitting, lazy loading |
| Bundle Size | < 5MB | Tree shaking, compression |
| Memory Usage | < 200MB | Asset unloading, culling |
| Layout Shifts | 0 | Fixed canvas size |
| Time to Interactive | < 2s | Critical CSS inline |

### Optimization Checklist

- [ ] Use `react-window` for combat log virtualization
- [ ] Batch all PixiJS sprites by texture
- [ ] Use PixiJS `BitmapText` for damage numbers
- [ ] Pool animation objects (avoid GC pauses)
- [ ] Lazy load content packs on demand
- [ ] Use Web Workers for forecast calculations
- [ ] Compress sprite sheets with pngquant
- [ ] Tree-shake unused Zustand methods
- [ ] Use `memo()` for expensive React components
- [ ] Avoid reading DOM layout properties in render loop

---

## Testing Strategy

### Unit Tests (Vitest)

**Coverage Target**: 80%+ for engine code

```typescript
// src/engine/core/__tests__/Reducer.test.ts
describe('reduceCommand', () => {
  it('should apply strike damage correctly', () => {
    const state = createTestBattle();
    const command: StrikeCommand = {
      type: 'strike',
      actor: 'pc_fighter',
      target: 'kobold_guard',
    };

    const { newState, events } = reduceCommand(state, command);

    expect(newState.units['kobold_guard'].hp).toBeLessThan(state.units['kobold_guard'].hp);
    expect(events).toContainEqual(expect.objectContaining({ type: 'strike_hit' }));
  });
});
```

### Integration Tests (Playwright)

**Scenarios**:
1. Load scenario and render battle
2. Click unit to select
3. Click target tile to move
4. Click enemy to strike
5. Verify combat log updates
6. Verify HP bars update

```typescript
// tests/e2e/basic-combat.spec.ts
test('basic combat flow', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-scenario="hidden_pit_basic"]');

  // Wait for canvas to render
  await page.waitForSelector('canvas');

  // Select player unit
  await page.click('canvas', { position: { x: 100, y: 100 } });

  // Click enemy to attack
  await page.click('canvas', { position: { x: 200, y: 100 } });

  // Verify combat log
  await expect(page.locator('.combat-log')).toContainText('Fighter strikes Kobold');
});
```

### Regression Tests

**Strategy**: Load known scenarios, execute commands, compare final state hashes

```typescript
// tests/regression/phase3.test.ts
describe('Phase 3 Regression', () => {
  it('should match expected hash for hidden_pit_basic', async () => {
    const scenario = await loadScenario('hidden_pit_basic.json');
    const finalState = runScenario(scenario);
    const hash = hashState(finalState);

    expect(hash).toBe('expected_hash_from_python');
  });
});
```

---

## Deployment Strategy

### Build Configuration

**Vite Config**:
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
          pixi: ['pixi.js'],
          engine: [/src\/engine/],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pixi.js'],
  },
});
```

### Hosting

**Recommended**: Netlify or Vercel (static hosting)

**Assets**: Separate CDN for sprite sheets (e.g., Cloudflare R2)

**Content Packs**: Served from `/assets/packs/` with versioned URLs

### Environment Modes

| Mode | Purpose | Features |
|------|---------|----------|
| Development | Local testing | Hot reload, verbose logging |
| Staging | Pre-production | Source maps, analytics |
| Production | Live game | Minified, error tracking |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Determinism breaks in TypeScript | High | Extensive regression tests with hash comparison |
| Performance issues on mobile | Medium | Performance profiling, lower graphics settings |
| Asset loading times | Medium | Progressive loading, loading screens |
| Browser compatibility | Low | Transpile to ES2020, polyfills |
| ORC license compliance | High | Strict content pack metadata, source attribution |

---

## Success Criteria

### Functional Requirements
- [ ] All 9 Python phases ported to TypeScript
- [ ] Deterministic replay matches Python hashes
- [ ] Split viewport renders correctly
- [ ] All command types functional
- [ ] Content packs load and apply
- [ ] Enemy AI makes valid decisions
- [ ] Save/load system works

### Performance Requirements
- [ ] 60 FPS during normal gameplay
- [ ] < 3s initial load time
- [ ] < 200MB memory usage
- [ ] No visible layout shifts
- [ ] Smooth camera transitions

### Quality Requirements
- [ ] 80%+ code coverage
- [ ] Zero TypeScript errors
- [ ] Zero accessibility violations
- [ ] Mobile-responsive
- [ ] Cross-browser tested (Chrome, Firefox, Safari)

---

## Development Timeline

**Total Estimated Time**: 18-24 weeks (4.5-6 months)

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Core Engine | 2-3 weeks | None |
| Phase 2: Grid & Rules | 2-3 weeks | Phase 1 |
| Phase 3: PixiJS Rendering | 3-4 weeks | Phase 2 |
| Phase 4: React UI | 3-4 weeks | Phase 3 |
| Phase 5: Content Packs | 2 weeks | Phase 4 |
| Phase 6: Advanced Features | 3-4 weeks | Phase 5 |
| Phase 7: Polish & Deploy | 2-3 weeks | Phase 6 |

**Team Size**: 1-2 developers (full-time)

**Parallel Work Opportunities**:
- Asset creation can begin immediately
- UI design can proceed alongside Phase 1-2
- Content pack authoring can happen during Phase 3-4

---

## Conclusion

This refactoring plan provides a comprehensive roadmap for transforming the Python-based Pathfinder 2e tactical RPG engine into a performant, maintainable browser game. By leveraging the Split Viewport architecture, we eliminate the primary performance bottlenecks of overlay-based designs while maintaining the deterministic integrity of the core simulation.

The phased approach ensures steady progress with clear deliverables at each stage. The strict separation of concerns between the game engine (pure TypeScript), rendering layer (PixiJS), and UI framework (React) creates a maintainable codebase that can evolve independently in each dimension.

**Next Steps**:
1. Review and approve this plan
2. Set up initial TypeScript project structure
3. Begin Phase 1: Core Engine port
4. Establish CI/CD pipeline
5. Create asset pipeline and initial sprite sheets

**Questions for Stakeholders**:
- Visual style preference (pixel art vs vector)?
- Target platforms (desktop only or mobile)?
- Monetization strategy (affects bundle size decisions)?
- Accessibility requirements (screen reader support level)?
