# Designer Tools Implementation Plan

**Goal:** Build visual authoring tools to empower content creators
**Timeline:** 1-2 weeks (prioritized incremental delivery)
**Philosophy:** Ship working tools quickly, iterate based on feedback

---

## 🎯 **Tool Suite Overview**

### **1. Scenario Editor** ⭐ HIGHEST PRIORITY
Visual editor for creating and modifying battle scenarios.

**Features:**
- Map configuration (size, blocked tiles)
- Unit placement (drag-and-drop)
- Command sequence builder
- Objectives and victory conditions
- Mission events and reinforcements
- Export to JSON
- Load existing scenarios

**Value:** Enables creating new battles without touching JSON

**Complexity:** MEDIUM (2-3 days)

---

### **2. Real-Time Preview** ⭐ HIGHEST PRIORITY
See scenario changes instantly without reload.

**Features:**
- Live battle visualization
- Edit-and-watch workflow
- Step through commands
- Inspect state at any point
- Hot reload integration

**Value:** Immediate feedback loop, faster iteration

**Complexity:** LOW-MEDIUM (1-2 days, pairs with Scenario Editor)

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

**Value:** Content creators don't need to learn JSON schema

**Complexity:** MEDIUM (2-3 days)

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

**Value:** Easy AI behavior customization

**Complexity:** LOW-MEDIUM (1-2 days)

---

### **5. Effect Model Builder**
Advanced tool for tactical effect models.

**Features:**
- Visual effect graph builder
- Trigger/action configuration
- Target policy designer
- Model validation
- Export to JSON

**Value:** Complex hazards and effects without code

**Complexity:** HIGH (3-4 days)

---

### **6. Map Editor**
Drag-and-drop grid editor with terrain.

**Features:**
- Visual grid designer
- Blocked tile painter
- Unit placement
- Copy/paste regions
- Templates (corridors, rooms)
- Symmetry tools

**Value:** Fast map creation

**Complexity:** MEDIUM (2-3 days)

---

## 📋 **Recommended Implementation Order**

### **Phase 1: Foundation** (2-3 days)
1. **Scenario Editor (Core)** - Map + Units + Commands
2. **Real-Time Preview** - Live battle visualization
3. **Save/Load** - Export scenarios to JSON

**Deliverable:** Can create simple scenarios visually

---

### **Phase 2: Content Creation** (2-3 days)
4. **Content Pack Authoring UI** - Spell/Feat/Item builder
5. **Entry Browser** - Search and select content entries
6. **Integration** - Use custom content in scenarios

**Deliverable:** Can create custom spells/feats without JSON

---

### **Phase 3: Advanced Features** (3-4 days)
7. **Enemy AI Policy Designer** - Visual policy builder
8. **Mission Events Builder** - Triggers and branching
9. **Effect Model Builder** - Complex hazards
10. **Map Editor** - Advanced terrain tools

**Deliverable:** Full-featured authoring suite

---

## 🏗️ **Technical Architecture**

### **New Components**
```
src/ui/designer/
├── ScenarioEditor.tsx          # Main editor component
├── MapEditor.tsx               # Grid + unit placement
├── CommandBuilder.tsx          # Command sequence UI
├── ContentPackEditor.tsx       # Content entry forms
├── PolicyDesigner.tsx          # AI policy builder
├── PreviewPanel.tsx            # Live battle preview
├── EntryBrowser.tsx            # Search content entries
└── shared/
    ├── DragDropGrid.tsx        # Reusable grid component
    ├── FormBuilder.tsx         # Dynamic form generator
    └── JsonExporter.tsx        # Export utilities
```

### **State Management**
```typescript
// New Zustand store for designer mode
interface DesignerStore {
  // Editor state
  editingScenario: ScenarioData | null;
  editMode: 'map' | 'units' | 'commands' | 'objectives' | 'preview';

  // Preview state
  previewBattle: BattleState | null;
  previewPaused: boolean;
  previewStepIndex: number;

  // Content authoring
  editingContentPack: ContentPack | null;
  editingEntry: ContentPackEntry | null;

  // Actions
  loadScenario: (path: string) => void;
  saveScenario: (path: string) => void;
  updateMap: (width: number, height: number, blocked: [number, number][]) => void;
  addUnit: (unit: UnitState) => void;
  removeUnit: (unitId: string) => void;
  addCommand: (command: RawCommand) => void;
  previewScenario: () => void;
  stepPreview: () => void;
}
```

### **Key Technologies**
- **React DnD** - Drag-and-drop interactions
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **React Query** - Data fetching/caching
- **Immer** - Immutable state updates

---

## 🎨 **UI/UX Design Principles**

### **1. Progressive Disclosure**
- Start simple, reveal complexity as needed
- Sensible defaults for everything
- Advanced options behind "Show More"

### **2. Immediate Feedback**
- Live preview always visible
- Validation errors inline
- Visual state changes

### **3. Forgiving Interface**
- Undo/redo for all actions
- Autosave drafts
- Validation warnings (not blockers)

### **4. Designer-First Language**
- "Spell" not "cast_spell command type"
- "Victory Condition" not "objective pack"
- Visual icons over text labels

---

## 📊 **Scenario Editor Mockup**

```
┌────────────────────────────────────────────────────────────────┐
│  Cantanor Scenario Editor                    [Save] [Preview]  │
├─────────────┬──────────────────────────────────────────────────┤
│             │                                                    │
│  📝 Details │   Battle ID: ___________________                  │
│  🗺️  Map     │   Seed: ___________                              │
│  👥 Units   │   Engine Phase: [7 ▾]                            │
│  ⚔️  Commands│                                                    │
│  🎯 Objectives                                                  │
│  🤖 AI       │   Map Size: Width [20] Height [20]               │
│             │   Blocked Tiles: [2, 3], [2, 4], [5, 6]...       │
│             │   [+ Add Blocked Tile]                            │
│             │                                                    │
│             │   ┌──────────────────────────────┐                │
│             │   │  Grid Preview (drag to add)  │                │
│             │   │  ░░░░░░░░░░░░░░░░░░░░░░░░░│                │
│             │   │  ░░██░░░░░░░░░░░░░░░░░░░░░│                │
│             │   │  ░░░░░░👤░░░░░👹░░░░░░░░│                │
│             │   │  ░░░░░░░░░░░░░░░░░░░░░░░░│                │
│             │   └──────────────────────────────┘                │
│             │                                                    │
│             │   Units: [+ Add Unit]                             │
│             │   • hero (team: party, HP: 50) @ [6, 3]          │
│             │   • goblin1 (team: enemy, HP: 20) @ [12, 3]      │
│             │                                                    │
└─────────────┴──────────────────────────────────────────────────┘
```

---

## 🚀 **Quick Win: Minimal Viable Editor (Day 1)**

Let's start with a **Scenario Viewer/Editor** that can:

1. **Load existing scenarios** from file browser
2. **Display scenario info** (map, units, commands)
3. **Edit basic properties** (battle ID, seed, map size)
4. **Preview live** in the existing battle canvas
5. **Export JSON** to save changes

**Why start here:**
- Leverages existing UI components
- Immediate value (can view and tweak scenarios)
- Foundation for more complex tools
- Fast to build (4-6 hours)

---

## 🎯 **Success Metrics**

### **Phase 1 Success**
- [ ] Can create simple 2v2 battle in < 5 minutes
- [ ] Can preview battle immediately
- [ ] Can export valid scenario JSON
- [ ] Designer never touches raw JSON

### **Phase 2 Success**
- [ ] Can create custom spell/feat in < 3 minutes
- [ ] Can use custom content in scenarios
- [ ] Can browse all available entries
- [ ] Content pack validates correctly

### **Phase 3 Success**
- [ ] Can configure complex AI policies
- [ ] Can build multi-wave scenarios
- [ ] Can create hazard routines visually
- [ ] Full authoring suite feels cohesive

---

## 💡 **Implementation Strategy**

### **Start Small, Ship Fast**
1. Build Scenario Viewer (day 1)
2. Add editing capabilities (day 2)
3. Add real-time preview (day 3)
4. Iterate based on usage

### **Incremental Delivery**
- Each tool works standalone
- Ship working tools immediately
- Don't wait for perfection
- Gather feedback early

### **Reuse Existing Code**
- Leverage ScenarioLoader
- Use existing PixiJS renderer
- Reuse BattleStore
- Extend existing UI components

---

## ❓ **Questions for You**

Before we start building, what's your preference?

### **Option 1: Build Scenario Editor First** (Recommended)
- Most impactful tool
- Immediate value
- 2-3 days to working editor
- Can iterate from there

### **Option 2: Build Minimal Viable Suite**
- Basic version of multiple tools
- See which gets most use
- Longer initial build
- More flexibility

### **Option 3: Start with Quick Win**
- Scenario Viewer/Inspector first
- 4-6 hours to working tool
- Learn what designers need
- Then build full editor

---

## 🎬 **Ready to Start?**

I recommend **Option 3: Quick Win** → Scenario Viewer/Inspector

**Today (4-6 hours):**
- Build scenario file browser
- Display scenario info (map, units, commands)
- Add live preview integration
- Basic editing (map size, battle ID)
- Export to JSON

**This gives you:**
- Working tool immediately
- Foundation for full editor
- Validates approach
- Quick feedback loop

**Want to start building the Scenario Viewer/Inspector now?**
