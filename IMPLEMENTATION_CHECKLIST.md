# Implementation Checklist
## TypeScript Browser Refactoring - Detailed Task Breakdown

**Project:** Pathfinder 2e Tactical RPG Browser Port
**Version:** 1.0
**Last Updated:** February 6, 2026

---

## Pre-Implementation Setup

### Repository & Tooling
- [ ] Create new Git repository for TypeScript project
- [ ] Initialize Vite + TypeScript project (`npm create vite@latest`)
- [ ] Configure `tsconfig.json` with strict mode
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "exactOptionalPropertyTypes": true
    }
  }
  ```
- [ ] Set up ESLint with TypeScript rules
- [ ] Configure Prettier for consistent formatting
- [ ] Set up Vitest for unit testing
- [ ] Configure Playwright for E2E testing
- [ ] Create folder structure (see TYPESCRIPT_TECHNICAL_SPEC.md)
- [ ] Set up GitHub Actions CI/CD pipeline
  - [ ] Run tests on every PR
  - [ ] Build validation
  - [ ] Deploy preview to Netlify

### Dependencies Installation
- [ ] Install PixiJS: `npm install pixi.js`
- [ ] Install React: `npm install react react-dom`
- [ ] Install Zustand: `npm install zustand`
- [ ] Install dev dependencies:
  - [ ] `@types/react @types/react-dom`
  - [ ] `vitest @vitest/ui`
  - [ ] `@playwright/test`
  - [ ] `@testing-library/react`

---

## Phase 1: Core TypeScript Engine (Weeks 1-3)

### State Type Definitions (`src/engine/core/State.ts`)
- [ ] Define `Position` type as tuple
- [ ] Create `UnitState` interface (all fields readonly)
- [ ] Create `MapState` interface
- [ ] Create `EffectState` interface
- [ ] Create `BattleState` interface
- [ ] Add computed helper functions:
  - [ ] `getActiveUnitId()`
  - [ ] `getActiveUnit()`
  - [ ] `isUnitAlive()`
- [ ] Write unit tests for helper functions

### Command Type Definitions (`src/engine/core/Commands.ts`)
- [ ] Define `BaseCommand` interface
- [ ] Create command types (15 total):
  - [ ] `MoveCommand`
  - [ ] `StrikeCommand`
  - [ ] `EndTurnCommand`
  - [ ] `SaveDamageCommand`
  - [ ] `AreaSaveDamageCommand`
  - [ ] `ApplyEffectCommand`
  - [ ] `CastSpellCommand`
  - [ ] `UseFeatCommand`
  - [ ] `UseItemCommand`
  - [ ] `InteractCommand`
  - [ ] `SpawnUnitCommand`
  - [ ] `SetFlagCommand`
  - [ ] `TriggerHazardSourceCommand`
  - [ ] `RunHazardRoutineCommand`
- [ ] Create `Command` union type
- [ ] Verify exhaustive checking compiles

### RNG System (`src/engine/core/RNG.ts`)
- [ ] Port `DeterministicRNG` class
- [ ] Implement `d20()`, `d6()`, `d8()`, etc.
- [ ] Implement `seed()` method
- [ ] Write unit tests comparing with Python output

### ID Generation (`src/engine/core/IDs.ts`)
- [ ] Port `event_id()` function
- [ ] Port `effect_id()` function
- [ ] Write unit tests

### Turn Order (`src/engine/core/TurnOrder.ts`)
- [ ] Port `build_turn_order()` function
- [ ] Port `next_turn_index()` function
- [ ] Write unit tests

### Reducer Core (`src/engine/core/Reducer.ts`)
- [ ] Create `ReductionError` class
- [ ] Create `ReductionResult` interface
- [ ] Implement `reduceCommand()` dispatcher
- [ ] Implement state update helpers:
  - [ ] `updateState()`
  - [ ] `updateUnit()`
  - [ ] `appendEvent()`
- [ ] Implement command reducers:
  - [ ] `reduceMoveCommand()`
  - [ ] `reduceStrikeCommand()`
  - [ ] `reduceEndTurnCommand()`
  - [ ] (others deferred to Phase 2)
- [ ] Write unit tests for each reducer

### CLI Test Runner (`src/cli/runScenario.ts`)
- [ ] Create Node.js CLI to load JSON scenarios
- [ ] Implement scenario executor
- [ ] Output events to JSON
- [ ] Calculate final state hash
- [ ] Write tests comparing with Python hashes

**Phase 1 Exit Criteria:**
- [ ] All core types compile without errors
- [ ] Basic command reducers pass unit tests
- [ ] CLI can run `hidden_pit_basic.json` scenario
- [ ] Final state hash matches Python baseline

---

## Phase 2: Grid & Rules Systems (Weeks 4-6)

### Grid Map (`src/engine/grid/Map.ts`)
- [ ] Port `in_bounds()` function
- [ ] Port `is_blocked()` function
- [ ] Port `is_occupied()` function
- [ ] Write unit tests

### Movement (`src/engine/grid/Movement.ts`)
- [ ] Port `can_step_to()` function
- [ ] Port pathfinding algorithm (A* or Dijkstra)
- [ ] Write unit tests

### Line of Sight (`src/engine/grid/LOS.ts`)
- [ ] Port `has_line_of_sight()` function
- [ ] Write unit tests

### Line of Effect (`src/engine/grid/LOE.ts`)
- [ ] Port `has_tile_line_of_effect()` with corner pinch check
- [ ] Port `cover_grade_between_tiles()` function
- [ ] Port `cover_ac_bonus_from_grade()` function
- [ ] Port unit-level wrappers
- [ ] Write comprehensive unit tests

### Area Targeting (`src/engine/grid/Areas.ts`)
- [ ] Port `radius_points()` function
- [ ] Port `cone_points()` function
- [ ] Port `line_points()` function (Bresenham)
- [ ] Write unit tests

### Check Resolution (`src/engine/rules/Checks.ts`)
- [ ] Define `Degree` type
- [ ] Port `resolve_check()` function
- [ ] Write unit tests

### Saving Throws (`src/engine/rules/Saves.ts`)
- [ ] Define `SaveProfile` interface
- [ ] Port `resolve_save()` function
- [ ] Port `basic_save_multiplier()` function
- [ ] Write unit tests

### Damage System (`src/engine/rules/Damage.ts`)
- [ ] Port `roll_damage()` function (dice parser)
- [ ] Port `apply_damage_modifiers()` (resistance/weakness/immunity)
- [ ] Port `apply_damage_to_pool()` (HP + temp HP)
- [ ] Write comprehensive unit tests

### Conditions (`src/engine/rules/Conditions.ts`)
- [ ] Port `normalize_condition_name()` function
- [ ] Port `apply_condition()` function
- [ ] Port `clear_condition()` function
- [ ] Port `condition_is_immune()` function
- [ ] Write unit tests

### Effect Lifecycle (`src/engine/effects/Lifecycle.ts`)
- [ ] Port `on_apply()` hook
- [ ] Port `process_timing()` hook for tick/expire
- [ ] Port affliction staging logic
- [ ] Port temp HP effect logic
- [ ] Write unit tests

**Phase 2 Exit Criteria:**
- [ ] All grid algorithms pass unit tests
- [ ] All rules functions pass unit tests
- [ ] Can run Phase 3-5 regression scenarios
- [ ] All scenario hashes match Python baseline

---

## Phase 3: PixiJS Rendering Layer (Weeks 7-10)

### Asset Loading (`src/rendering/AssetLoader.ts`)
- [ ] Create sprite sheet loader (JSON atlas format)
- [ ] Implement preload queue
- [ ] Add loading progress tracking
- [ ] Write tests

### PixiJS Application (`src/rendering/PixiApp.ts`)
- [ ] Initialize PixiJS application
- [ ] Set up WebGL renderer
- [ ] Create layer containers (tiles, units, effects, UI overlay)
- [ ] Set up ticker loop
- [ ] Wire up render methods

### Tile Renderer (`src/rendering/TileRenderer.ts`)
- [ ] Render grid tiles from MapState
- [ ] Handle blocked tiles (different sprite)
- [ ] Add grid lines (optional)
- [ ] Write tests

### Sprite Manager (`src/rendering/SpriteManager.ts`)
- [ ] Create sprites for units
- [ ] Update sprite positions from UnitState
- [ ] Handle sprite tinting by team
- [ ] Handle sprite removal on death
- [ ] Implement sprite animations (idle, hit, etc.)
- [ ] Write tests

### Effect Renderer (`src/rendering/EffectRenderer.ts`)
- [ ] Create damage number pool
- [ ] Implement damage number animation
- [ ] Add hit particle effects
- [ ] Add area effect indicators (circles, cones)
- [ ] Write tests

### Camera Controller (`src/rendering/CameraController.ts`)
- [ ] Implement pan controls (mouse drag)
- [ ] Implement zoom controls (mouse wheel)
- [ ] Add focus-on-unit method with smooth transition
- [ ] Clamp camera to map bounds
- [ ] Write tests

### Input Handler (`src/rendering/InputHandler.ts`)
- [ ] Handle mouse click on canvas (convert to tile coords)
- [ ] Handle mouse hover (highlight tile)
- [ ] Emit events for UI to consume
- [ ] Handle touch events for mobile
- [ ] Write tests

### Asset Creation
- [ ] Design tile sprites (grass, stone, etc.) - 64x64px
- [ ] Create unit sprites (fighter, kobold, etc.) - 64x64px
- [ ] Create effect sprites (explosion, magic) - variable
- [ ] Generate sprite sheets with TexturePacker
- [ ] Create BitmapFont for damage numbers

**Phase 3 Exit Criteria:**
- [ ] Can render full battle scene in canvas
- [ ] Click on unit selects it
- [ ] Camera smoothly follows active unit
- [ ] Damage numbers appear on hits
- [ ] 60 FPS with 50+ units

---

## Phase 4: React UI Framework (Weeks 11-14)

### Zustand Store Setup (`src/store/gameStore.ts`)
- [ ] Define `GameStore` interface
- [ ] Implement battle state slice
- [ ] Implement UI state slice (selection, hover, target mode)
- [ ] Implement transient state slice
- [ ] Add actions:
  - [ ] `loadScenario()`
  - [ ] `dispatchCommand()`
  - [ ] `selectUnit()`
  - [ ] `setHoverTile()`
  - [ ] `setTargetMode()`
- [ ] Write tests

### Root App Component (`src/ui/App.tsx`)
- [ ] Set up split viewport layout (flex)
- [ ] Initialize PixiJS app in useEffect
- [ ] Wire up battle state changes to PixiJS
- [ ] Create CSS for layout
- [ ] Write integration tests

### Party Panel (`src/ui/components/PartyPanel.tsx`)
- [ ] Create unit card component
- [ ] Display unit name, HP, stats
- [ ] Implement transient HP bar updates
- [ ] Add condition indicators
- [ ] Style with CSS
- [ ] Write tests

### Combat Log (`src/ui/components/CombatLog.tsx`)
- [ ] Set up react-window for virtualization
- [ ] Format events into readable text
- [ ] Auto-scroll to bottom on new events
- [ ] Add event filtering (damage only, etc.)
- [ ] Style with CSS
- [ ] Write tests

### Action Panel (`src/ui/components/ActionPanel.tsx`)
- [ ] Display available actions for active unit
- [ ] Create button components for each command type
- [ ] Wire up buttons to dispatch commands
- [ ] Show action costs (action icons)
- [ ] Disable invalid actions
- [ ] Style with CSS
- [ ] Write tests

### Turn Order Display (`src/ui/components/TurnOrderDisplay.tsx`)
- [ ] Show initiative order
- [ ] Highlight active unit
- [ ] Show round number
- [ ] Style with CSS
- [ ] Write tests

### Transient Update Hook (`src/ui/hooks/useTransientUpdate.ts`)
- [ ] Implement `useTransientHPBar()` hook
- [ ] Add support for other transient updates
- [ ] Write tests

### Global Styles (`src/ui/styles/global.css`)
- [ ] Define CSS variables (colors, spacing)
- [ ] Set up flexbox layout rules
- [ ] Style canvas container (fixed 600x600)
- [ ] Style UI panel (min-width 400px)
- [ ] Add responsive breakpoints
- [ ] Add dark theme support

**Phase 4 Exit Criteria:**
- [ ] Split viewport renders correctly
- [ ] Can click actions to dispatch commands
- [ ] Combat log updates in real-time
- [ ] HP bars animate smoothly (no jank)
- [ ] Mobile-responsive (tablets)

---

## Phase 5: Content Pack Integration (Weeks 15-16)

### Content Pack Loader (`src/engine/io/ContentPackLoader.ts`)
- [ ] Port pack schema validation
- [ ] Implement pack fetching
- [ ] Implement compatibility checks
- [ ] Cache packs in IndexedDB
- [ ] Write tests

### Scenario Loader (`src/engine/io/ScenarioLoader.ts`)
- [ ] Port scenario JSON parsing
- [ ] Validate scenario schema
- [ ] Resolve content pack references
- [ ] Write tests

### Command Authoring (`src/engine/io/CommandAuthoring.ts`)
- [ ] Port command catalog generation
- [ ] Filter available actions by unit
- [ ] Generate intent builders
- [ ] Write tests

### Content Pack Assets
- [ ] Create icons for spells/feats/items
- [ ] Update action panel to show icons
- [ ] Add tooltips with descriptions
- [ ] Write tests

**Phase 5 Exit Criteria:**
- [ ] Can load phase7/phase9 content packs
- [ ] Action panel shows pack-defined spells/feats
- [ ] Icons display correctly
- [ ] Tooltips show descriptions

---

## Phase 6: Advanced Features (Weeks 17-20)

### Forecast System (`src/engine/core/Forecast.ts`)
- [ ] Port strike forecast logic
- [ ] Port spell forecast logic
- [ ] Calculate hit probabilities
- [ ] Calculate expected damage
- [ ] Run forecasts in web worker (off main thread)
- [ ] Write tests

### Enemy AI (`src/engine/ai/`)
- [ ] Port enemy policy system
- [ ] Implement `strike_nearest` policy
- [ ] Implement pack-driven policies
- [ ] Add rationale logging (Phase 9 feature)
- [ ] Write tests

### Forecast UI
- [ ] Add forecast tooltip on hover
- [ ] Show hit chance + expected damage
- [ ] Update on target change
- [ ] Write tests

### Range Overlays
- [ ] Render move range overlay (PixiJS graphics)
- [ ] Render attack range overlay
- [ ] Render spell area indicator
- [ ] Write tests

### Sound System
- [ ] Set up Howler.js for audio
- [ ] Add hit sound effects
- [ ] Add spell cast sound effects
- [ ] Add background music
- [ ] Add volume controls
- [ ] Write tests

### Animation Polish
- [ ] Add unit move animations
- [ ] Add attack swing animations
- [ ] Add spell cast animations
- [ ] Add screen shake on crits
- [ ] Write tests

**Phase 6 Exit Criteria:**
- [ ] Forecast tooltips show accurate data
- [ ] Enemy AI makes valid decisions
- [ ] Range overlays display correctly
- [ ] Sound effects enhance gameplay
- [ ] Animations are smooth and responsive

---

## Phase 7: Production Polish (Weeks 21-24)

### Save/Load System
- [ ] Implement save to IndexedDB
- [ ] Implement load from IndexedDB
- [ ] Add autosave on turn end
- [ ] Add manual save/load UI
- [ ] Write tests

### Settings Menu
- [ ] Add volume sliders
- [ ] Add graphics quality options
- [ ] Add keybinding customization
- [ ] Persist settings to localStorage
- [ ] Write tests

### Main Menu
- [ ] Create main menu screen
- [ ] Add scenario selection UI
- [ ] Add "New Game" / "Continue" buttons
- [ ] Add credits screen
- [ ] Write tests

### Accessibility
- [ ] Add ARIA labels to all interactive elements
- [ ] Implement keyboard navigation
- [ ] Add focus indicators
- [ ] Test with screen reader
- [ ] Run WAVE accessibility audit

### Performance Optimization
- [ ] Profile with Chrome DevTools
- [ ] Identify and fix bottlenecks
- [ ] Optimize bundle size (code splitting)
- [ ] Compress assets (pngquant)
- [ ] Run Lighthouse audit
- [ ] Achieve 60 FPS target

### Mobile Support
- [ ] Add touch controls for canvas
- [ ] Implement virtual joystick
- [ ] Test on iOS Safari
- [ ] Test on Chrome Android
- [ ] Fix responsive layout issues

### Deployment
- [ ] Set up Vercel production deployment
- [ ] Configure CDN for assets (Cloudflare R2)
- [ ] Set up error tracking (Sentry)
- [ ] Set up analytics (Plausible/Fathom)
- [ ] Create deployment documentation

### Testing
- [ ] Run full regression test suite
- [ ] Run E2E test suite
- [ ] Cross-browser testing
- [ ] Performance benchmarking
- [ ] Security audit

**Phase 7 Exit Criteria:**
- [ ] Save/load system works reliably
- [ ] Passes WCAG 2.1 Level AA
- [ ] Lighthouse Performance score > 90
- [ ] Works on mobile (tablets)
- [ ] Deployed to production
- [ ] All tests passing

---

## Post-Launch

### Documentation
- [ ] Write player guide
- [ ] Write developer documentation
- [ ] Create API documentation
- [ ] Write content pack authoring guide

### Community
- [ ] Set up GitHub Discussions
- [ ] Create feedback form
- [ ] Monitor error tracking
- [ ] Plan feature roadmap

### Maintenance
- [ ] Fix reported bugs
- [ ] Optimize based on user feedback
- [ ] Update dependencies
- [ ] Add new content packs

---

## Validation Checklist

### Functional Tests
- [ ] Can load and play all baseline scenarios
- [ ] All command types execute correctly
- [ ] Combat math matches Python engine
- [ ] Content packs load and apply
- [ ] Save/load preserves state
- [ ] AI makes valid decisions

### Performance Tests
- [ ] Maintains 60 FPS with 50+ units
- [ ] Initial load < 3 seconds
- [ ] Memory usage < 200MB
- [ ] Bundle size < 5MB
- [ ] No layout shifts
- [ ] No jank during animations

### Quality Tests
- [ ] Code coverage > 80%
- [ ] Zero TypeScript errors
- [ ] Zero console errors
- [ ] ESLint passes
- [ ] Prettier formatted
- [ ] No accessibility violations

### Compatibility Tests
- [ ] Works on Chrome (latest 2 versions)
- [ ] Works on Firefox (latest 2 versions)
- [ ] Works on Safari (latest 2 versions)
- [ ] Works on Edge (latest 2 versions)
- [ ] Responsive on tablets (768px+)
- [ ] Functional on mobile (360px+)

---

## Risk Tracking

| Risk | Status | Mitigation |
|------|--------|-----------|
| Determinism breaks | 🟡 Monitor | Hash regression tests |
| Performance issues | 🟡 Monitor | Profiling, optimization |
| Asset loading slow | 🟡 Monitor | Progressive loading |
| Browser compatibility | 🟢 Low | Polyfills, transpiling |
| ORC compliance | 🟢 Low | Source attribution |

**Status Legend:**
- 🔴 High risk - needs immediate attention
- 🟡 Medium risk - monitor closely
- 🟢 Low risk - standard mitigation

---

## Completion Tracking

**Overall Progress:** 0/7 phases complete

- [ ] Phase 1: Core Engine (0%)
- [ ] Phase 2: Grid & Rules (0%)
- [ ] Phase 3: PixiJS Rendering (0%)
- [ ] Phase 4: React UI (0%)
- [ ] Phase 5: Content Packs (0%)
- [ ] Phase 6: Advanced Features (0%)
- [ ] Phase 7: Production Polish (0%)

**Estimated Completion Date:** TBD (18-24 weeks from start)

---

**Last Updated:** February 6, 2026
**Next Review:** Upon Phase 1 completion
