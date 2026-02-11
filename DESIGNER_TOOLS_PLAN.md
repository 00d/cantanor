# Designer Tools Plan

**Goal:** Build visual authoring tools to empower content creators
**Philosophy:** Ship working tools quickly, iterate based on feedback

---

## Tool Suite Status

### ✅ **1. Scenario Viewer/Inspector** — COMPLETE

Visual browser and inspector for existing scenarios and Tiled maps.

**Built features:**
- Browse available scenarios by category (Smoke Tests, Phase 7, Phase 8, Tiled Maps)
- Load and inspect scenario details (map, units, commands, objectives)
- Edit basic properties (battle ID, seed, map size, engine phase)
- Live preview integration (load into game canvas)
- Export modified scenarios as JSON
- Tiled map inspection (layers, tilesets, spawn points, hazard zones)

See `DESIGNER_TOOLS_USAGE.md` for the quick-start guide.

---

### **2. Real-Time Preview**

See scenario changes instantly without reload.

**Features:**
- Live battle visualization
- Edit-and-watch workflow
- Step through commands
- Inspect state at any point

**Status:** Partially implemented — Preview button loads scenario into game
canvas but requires manually switching to Game mode.

---

### **3. Content Pack Authoring UI**

Visual builder for spells, feats, items.

**Features:**
- Entry creation forms
- Payload builder (damage, effects, duration)
- Tag management
- Compatibility settings
- Entry browser/search
- Export content pack JSON

---

### **4. Enemy AI Policy Designer**

Visual policy configuration and testing.

**Features:**
- Policy builder form
- Action type selector
- Team configuration
- Content entry picker
- Test against scenarios
- Policy rationale inspector

---

### **5. Effect Model Builder**

Advanced tool for tactical effect models.

**Features:**
- Visual effect graph builder
- Trigger/action configuration
- Target policy designer
- Model validation
- Export to JSON

---

### **6. Map Editor**

**Map authoring is handled by [Tiled Map Editor](https://www.mapeditor.org/)**
(an external desktop application), not by an in-browser tool.

The Tiled integration (see `TILED_INTEGRATION_PLAN.md`) provides:
- Full GPU-rendered tile art in the browser
- Spawn points, hazard zones, blocked tiles via Tiled's object layers
- Custom tile properties for game mechanics (blocked, moveCost, terrain, etc.)

An in-browser map editor was originally planned but is superseded by Tiled.
If a lightweight in-browser blocked-tile painter is still desired for legacy
JSON scenarios, it could be added as a complement (not a replacement).

---

## Implementation Order

### Phase 1: Foundation — COMPLETE ✅

1. **Scenario Viewer/Inspector** — Browse, inspect, edit, preview, export
2. **Tiled Map Viewer** — Inspect Tiled maps in the designer (Phase 6 of Tiled integration)

**Delivered:** Can view and tweak scenarios; Tiled maps fully supported

---

### Phase 2: Content Creation

4. **Content Pack Authoring UI** — Spell/Feat/Item builder
5. **Entry Browser** — Search and select content entries
6. **Integration** — Use custom content in scenarios

**Deliverable:** Can create custom spells/feats without JSON

---

### Phase 3: Advanced Features

7. **Enemy AI Policy Designer** — Visual policy builder
8. **Mission Events Builder** — Triggers and branching
9. **Effect Model Builder** — Complex hazards
10. **Command Builder** — Build command sequences with forms

**Deliverable:** Full-featured authoring suite

---

## Technical Architecture

### Built Components

```
src/ui/designer/
├── ScenarioViewer.tsx      # Designer mode root: browser + inspector side-by-side
├── ScenarioFileBrowser.tsx # Collapsible file tree with category groups
└── ScenarioInspector.tsx   # Property editor, unit list, command list; Tiled map view

src/store/
└── designerStore.ts        # Designer Zustand store
```

### Planned Components (Phase 2+)

```
src/ui/designer/
├── CommandBuilder.tsx      # Command sequence UI
├── ContentPackEditor.tsx   # Content entry forms
├── PolicyDesigner.tsx      # AI policy builder
└── shared/
    ├── FormBuilder.tsx     # Dynamic form generator
    └── JsonExporter.tsx    # Export utilities
```

### Designer Store

```typescript
interface DesignerStore {
  // File browser state
  scenarioData: ScenarioData | null;
  scenarioPath: string | null;
  tiledMapPath: string | null;
  hasUnsavedChanges: boolean;
  mode: 'browse' | 'preview';

  // Edit actions
  updateBattleId: (id: string) => void;
  updateSeed: (seed: number) => void;
  updateMapSize: (width: number, height: number) => void;
  updateEnginePhase: (phase: number) => void;

  // Lifecycle actions
  loadScenarioData: (path: string, data: ScenarioData) => void;
  clearScenario: () => void;
  setMode: (mode: 'browse' | 'preview') => void;
  getExportData: () => ScenarioData | null;
  markSaved: () => void;
}
```

---

## Success Metrics

### Phase 1 — COMPLETE ✅
- [x] Can inspect existing scenarios with full detail
- [x] Can preview battle in the game canvas
- [x] Can export modified scenario as JSON
- [x] Tiled maps browsable and inspectable alongside JSON scenarios

### Phase 2
- [ ] Can create custom spell/feat in < 3 minutes
- [ ] Can use custom content in scenarios
- [ ] Can browse all available entries
- [ ] Content pack validates correctly

### Phase 3
- [ ] Can configure complex AI policies
- [ ] Can build multi-wave scenarios
- [ ] Can create hazard routines visually
- [ ] Full authoring suite feels cohesive

---

## Current Limitations

- No visual unit placement or editing (Phase 2)
- No command builder (Phase 2)
- No objectives editor (Phase 2)
- No content pack authoring (Phase 2)
- No AI policy designer (Phase 3)
- Preview requires manually switching to Game mode
- No undo/redo
- No auto-save (manual export only)
