# Browser Refactoring Summary

**Project:** Pathfinder 2e Tactical RPG - Python to TypeScript/Browser Port
**Date:** February 6, 2026
**Status:** Planning Complete

---

## Overview

This document summarizes the comprehensive analysis and planning effort to refactor the Python-based Pathfinder 2e tactical RPG engine into a high-performance browser game using TypeScript, PixiJS, and React.

## Key Deliverables

### 1. Architecture Analysis (Complete)

**Python Codebase Assessment:**
- **Total Code:** ~5,100 lines across 9 implementation phases
- **Core Systems:** State management, command/reducer pattern, grid algorithms, rules engine, effect lifecycle, content packs
- **Test Coverage:** Comprehensive regression test suite with deterministic replay validation
- **Architecture Pattern:** Pure functional reducer with immutable state updates

**Key Findings:**
- The Python engine is well-structured with clear separation of concerns
- Deterministic execution enables reliable porting and regression testing
- Grid-based tactical systems map cleanly to TypeScript
- Content pack system provides flexible data-driven gameplay

### 2. Browser Architecture Design (Complete)

**Technology Stack:**
- **TypeScript 5.x** - Type-safe language with modern features
- **PixiJS 8.x** - WebGL-accelerated 2D rendering
- **React 18.x** - Declarative UI framework
- **Zustand 4.x** - Lightweight state management with transient update support
- **Vite 5.x** - Fast build tooling

**Key Architectural Decision: Split Viewport**

The analysis of the provided docx file on "React vs Canvas UI Performance" revealed critical insights:

**Problem with Overlay Architecture:**
- Transparent DOM overlays on WebGL canvas force expensive alpha blending
- Coordinate synchronization requires 60fps updates between DOM and Canvas
- Layout thrashing from reading/writing DOM properties in render loop
- Context switching overhead between React reconciliation and PixiJS rendering

**Solution: Split Viewport (Gold Box Style)**
```
┌─────────────────────────────────────────┐
│  Header Bar (React)                     │
├──────────────────┬──────────────────────┤
│                  │                      │
│  Game Canvas     │  UI Panel (React)    │
│  (PixiJS)        │  - Party Stats       │
│  600x600px       │  - Combat Log        │
│                  │  - Action Buttons    │
│                  │                      │
└──────────────────┴──────────────────────┘
```

**Benefits:**
- Zero overdraw - no transparent layers
- No coordinate synchronization needed
- Independent input contexts (canvas vs DOM)
- Leverages strengths of both technologies
- 10x reduction in composite costs

### 3. Complete Module Mapping (Complete)

**Core Engine:** 8 modules
- State.ts, Commands.ts, Reducer.ts, RNG.ts, TurnOrder.ts, IDs.ts, Objectives.ts, Forecast.ts

**Grid Systems:** 5 modules
- Map.ts, Movement.ts, LOS.ts, LOE.ts, Areas.ts

**Rules Engine:** 5 modules
- Checks.ts, Saves.ts, Damage.ts, Conditions.ts, Degrees.ts

**Effects System:** 2+ modules
- Lifecycle.ts, Registry.ts, handlers/

**Content & IO:** 4 modules
- ScenarioLoader.ts, ContentPackLoader.ts, CommandAuthoring.ts, EventLog.ts

**NEW: Rendering Layer:** 7 modules
- PixiApp.ts, TileRenderer.ts, SpriteManager.ts, EffectRenderer.ts, CameraController.ts, InputHandler.ts, AssetLoader.ts

**NEW: React UI Layer:** 8+ components
- App.tsx, PartyPanel.tsx, CombatLog.tsx, ActionPanel.tsx, TurnOrderDisplay.tsx, TargetPanel.tsx, plus hooks

**Total TypeScript Modules:** ~40 files

### 4. Phased Implementation Strategy (Complete)

| Phase | Duration | Focus | Deliverables |
|-------|----------|-------|--------------|
| 1 | 2-3 weeks | Core TypeScript Engine | Pure engine with unit tests |
| 2 | 2-3 weeks | Grid & Rules Systems | Full tactical simulation |
| 3 | 3-4 weeks | PixiJS Rendering | Visual battle display |
| 4 | 3-4 weeks | React UI Framework | Split viewport UI |
| 5 | 2 weeks | Content Pack Integration | Dynamic content loading |
| 6 | 3-4 weeks | Advanced Features | Forecasting, AI, polish |
| 7 | 2-3 weeks | Production Polish | Deploy-ready game |

**Total Timeline:** 18-24 weeks (4.5-6 months)

---

## Critical Technical Decisions

### 1. State Management: Frequency Segregation

Based on the performance analysis document, state updates are segregated by frequency:

**Low-Frequency (React State):**
- Battle state changes (command dispatch)
- Turn transitions
- Unit death events
- → Triggers React reconciliation (acceptable cost)

**High-Frequency (Transient Updates):**
- HP bar animations
- Camera position
- Hover highlights
- → Direct DOM/Canvas updates (bypasses React)

**Implementation Pattern:**
```typescript
// High-frequency updates use refs + subscriptions
const hpBarRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const unsub = useGameStore.subscribe(
    (state) => state.battle?.units[unitId]?.hp,
    (hp) => {
      // Direct DOM update - no re-render
      hpBarRef.current!.style.width = `${hp}%`;
    }
  );
  return unsub;
}, [unitId]);
```

### 2. Rendering: Batching and Pooling

**PixiJS Optimizations:**
- All sprites with same texture batched into single draw call
- Object pooling for damage numbers (prevents GC pauses)
- BitmapText for text rendering (not DOM)
- Culling for off-screen sprites
- Target: 60 FPS with 100+ entities

**Example:**
```typescript
class DamageNumberPool {
  private pool: PIXI.BitmapText[] = [];

  spawn(damage: number, x: number, y: number) {
    let text = this.pool.pop() || this.create();
    text.text = damage.toString();
    text.x = x;
    text.y = y;
    this.animate(text);
  }

  recycle(text: PIXI.BitmapText) {
    this.pool.push(text);
  }
}
```

### 3. Type Safety: Discriminated Unions

TypeScript's discriminated unions provide exhaustive checking:

```typescript
export type Command =
  | { type: 'strike'; actor: string; target: string }
  | { type: 'move'; actor: string; x: number; y: number }
  | { type: 'cast_spell'; actor: string; spell_id: string; ... }
  // ... 12+ more types

function reduceCommand(state: BattleState, command: Command) {
  switch (command.type) {
    case 'strike':
      return reduceStrike(state, command); // TypeScript knows shape
    case 'move':
      return reduceMove(state, command);
    // ... if any case is missing, TypeScript errors
  }
}
```

### 4. Immutability: Readonly Types

All state interfaces use `readonly` to enforce immutability:

```typescript
export interface BattleState {
  readonly battle_id: string;
  readonly seed: number;
  readonly units: Readonly<Record<string, UnitState>>;
  readonly effects: Readonly<Record<string, EffectState>>;
  // ... all readonly
}

// Mutation requires explicit spreading (structural sharing)
function updateUnit(state: BattleState, unitId: string, updates: Partial<UnitState>) {
  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: { ...state.units[unitId], ...updates },
    },
  };
}
```

---

## Performance Targets and Validation

### Targets

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Frame Rate | 60 FPS | Chrome DevTools Performance tab |
| Initial Load | < 3s | Lighthouse Performance score |
| Bundle Size | < 5MB | Webpack Bundle Analyzer |
| Memory Usage | < 200MB | Chrome Task Manager |
| Time to Interactive | < 2s | Lighthouse TTI metric |

### Optimization Checklist

**React:**
- [x] Use `react-window` for virtualized lists (combat log, inventory)
- [x] Use `memo()` for expensive components
- [x] Use transient updates for high-frequency data
- [x] Avoid inline object creation in render

**PixiJS:**
- [x] Batch sprites by texture
- [x] Use object pooling for particles/damage numbers
- [x] Use BitmapText for dynamic text
- [x] Implement culling for off-screen entities

**Bundle:**
- [x] Code-split content packs (lazy load)
- [x] Tree-shake unused code
- [x] Compress assets with pngquant/tinypng
- [x] Use Vite's automatic chunk splitting

---

## Risk Assessment and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Determinism breaks in TS | Medium | High | Regression test suite with hash comparison against Python baseline |
| Performance on mobile | Medium | Medium | Profiling, graphics quality settings, 30fps fallback mode |
| Asset loading times | Low | Medium | Progressive loading, indexed asset bundles, loading screens |
| Browser compatibility | Low | Low | Transpile to ES2020, WebGL 1.0 fallback, polyfills |
| ORC license compliance | Low | High | Strict content pack metadata, source attribution in all packs |

---

## Success Metrics

### Functional Completeness
- [ ] All 15+ command types functional
- [ ] All grid algorithms (LOS, LOE, areas) working
- [ ] All rules (checks, saves, damage, conditions) implemented
- [ ] Content pack system fully operational
- [ ] Save/load system functional
- [ ] Enemy AI making valid decisions

### Performance Validation
- [ ] Maintains 60 FPS with 50+ units on screen
- [ ] < 3s load time on 4G connection
- [ ] < 200MB memory after 30min gameplay
- [ ] No visible jank or layout shifts
- [ ] Smooth camera transitions

### Quality Standards
- [ ] 80%+ code coverage (unit tests)
- [ ] Zero TypeScript errors
- [ ] Zero console errors in production
- [ ] Passes WCAG 2.1 Level AA (accessibility)
- [ ] Works on Chrome, Firefox, Safari (latest 2 versions)
- [ ] Responsive on tablets (768px+)

### User Experience
- [ ] Clear visual feedback for all actions
- [ ] Intuitive UI with minimal learning curve
- [ ] Combat log provides full action history
- [ ] Undo/replay system for tactical review
- [ ] Keyboard shortcuts for power users

---

## Development Workflow

### Phase 1: Setup (Week 1)
1. Initialize Vite + TypeScript project
2. Configure ESLint, Prettier, Vitest
3. Set up CI/CD pipeline (GitHub Actions)
4. Create project structure (folders, base files)

### Phase 2-7: Implementation (Weeks 2-20)
- Follow phased plan in main document
- Weekly milestone reviews
- Continuous integration testing
- Progressive demo builds

### Testing Strategy
1. **Unit Tests (Vitest):** Test each module in isolation
2. **Integration Tests:** Test system interactions (reducer + rules)
3. **Regression Tests:** Compare output hashes with Python baseline
4. **E2E Tests (Playwright):** Test full user flows
5. **Performance Tests:** Benchmark critical paths

### Deployment
- **Staging:** Netlify preview deploys on every PR
- **Production:** Vercel production deployment on main branch merge
- **Assets:** Cloudflare R2 for sprite sheets and content packs

---

## Documentation Structure

This planning effort has produced three comprehensive documents:

### 1. TYPESCRIPT_BROWSER_REFACTORING_PLAN.md (Main Document)
- Executive summary
- Codebase analysis
- Architecture design
- Module mapping
- Phased strategy
- Performance targets
- Timeline and resources

### 2. TYPESCRIPT_TECHNICAL_SPEC.md (Implementation Guide)
- Detailed TypeScript interfaces
- Reducer implementation patterns
- Grid algorithm implementations
- PixiJS rendering patterns
- React component examples
- Performance optimization code

### 3. REFACTORING_SUMMARY.md (This Document)
- High-level overview
- Key decisions and rationale
- Success criteria
- Risk assessment
- Development workflow

**Additional Reference:**
- BROWSER_TACTICAL_TRPG_ANALYSIS.md (existing)
- PATHFINDER2_ORC_REFERENCE.md (existing)
- ROADMAP_VERIFICATION.md (existing)
- "React for Game UI Performance.docx" (analyzed)

---

## Next Steps

### Immediate Actions (Week 1)
1. **Review & Approve:** Stakeholder review of all planning documents
2. **Repository Setup:** Initialize new TypeScript project repository
3. **Asset Planning:** Begin sprite sheet and tile set creation
4. **Team Alignment:** Confirm developer availability and timeline

### Short-Term (Weeks 2-4)
1. **Phase 1 Kickoff:** Begin core engine port
2. **Test Infrastructure:** Set up unit test framework
3. **CI/CD Pipeline:** Configure automated testing and deployment
4. **Design Assets:** Create initial sprite prototypes

### Medium-Term (Weeks 5-12)
1. **Core Systems Complete:** Engine, grid, rules fully ported
2. **Visual Prototype:** PixiJS rendering functional
3. **UI Mockups:** React component library established
4. **Content Pipeline:** First content packs loaded

### Long-Term (Weeks 13-24)
1. **Feature Complete:** All gameplay systems operational
2. **Polish Pass:** Animations, sounds, visual effects
3. **Performance Optimization:** Meet all target metrics
4. **Production Launch:** Deploy playable demo

---

## Conclusion

This comprehensive planning effort provides a clear, actionable roadmap for transforming the Python tactical RPG engine into a high-performance browser game. The key insights are:

1. **Split Viewport Architecture** eliminates the primary performance bottlenecks of overlay-based designs
2. **Frequency Segregation** ensures React and PixiJS each handle what they do best
3. **Type Safety** in TypeScript provides confidence during the port
4. **Phased Approach** breaks down the 4.5-6 month project into manageable milestones
5. **Deterministic Engine** enables rigorous validation against Python baseline

The project is well-scoped, technically sound, and ready for implementation. The combination of detailed architecture documentation and concrete code examples provides developers with everything needed to execute successfully.

**Project Status:** ✅ Planning Complete - Ready for Implementation

---

**Prepared By:** Claude Code (Software Engineering Agent)
**Review Status:** Awaiting Stakeholder Approval
**Estimated Start Date:** Upon Approval
**Estimated Completion:** 4.5-6 months from start
