# Designer Tools - Quick Start Guide

**Status:** ✅ Phase 1 Complete - Scenario Viewer/Inspector
**Version:** 0.1.0
**Date:** 2026-02-08

---

## 🎯 **What's Available Now**

### **Scenario Viewer/Inspector (Phase 1)**
- ✅ Browse available scenarios by category
- ✅ Load and inspect scenario details
- ✅ Edit basic properties (battle ID, seed, map size, engine phase)
- ✅ View units, commands, objectives visually
- ✅ Live preview integration (load into game)
- ✅ Export modified scenarios as JSON

**Time to build:** 4 hours
**Status:** Working and ready to use! 🎉

---

## 🚀 **How to Use**

### **1. Start the Development Server**
```bash
npm run dev
```

Open browser to `http://localhost:5173`

### **2. Enter Designer Mode**
Click the **🛠️ Designer** button in the top-left corner.

### **3. Browse Scenarios**
- Left panel shows available scenarios organized by category
- Click the **▶** arrow to expand/collapse groups
- Currently available: **Smoke Tests**, **Phase 7**, **Phase 8**

### **4. Load a Scenario**
Click any scenario name to load it. The right panel will show:
- **File path**
- **Basic properties** (editable)
- **Map dimensions** (editable)
- **Unit list** with teams and HP
- **Command sequence**
- **Objectives** (if any)

### **5. Edit Properties**
Change any of these fields:
- **Battle ID:** Scenario identifier
- **Seed:** RNG seed (change for different outcomes)
- **Engine Phase:** Compatibility version
- **Map Width/Height:** Grid dimensions

**The orange dot (●) indicates unsaved changes.**

### **6. Preview Live**
Click **▶️ Preview** to:
- Load the scenario into the game engine
- Switch back to Game mode to see it rendered
- Play through the scenario

### **7. Export Modified Scenario**
Click **💾 Export JSON** to:
- Download the modified scenario as JSON
- Save locally
- Load back into the game later

**After export, the unsaved indicator (●) disappears.**

---

## 📂 **Available Scenarios**

### **Smoke Tests (5 scenarios)**
- Hidden Pit Trap - Basic hazard
- Fireball Rune - AOE hazard
- Poisoned Dart Gallery - Persistent damage
- Strike Forecast - Strike mechanics test
- Enemy Policy Duel - AI policy test

### **Phase 7 (1 scenario)**
- Content Pack Integration - Content pack loading

### **Phase 8 (2 scenarios)**
- Spell Entry - Content pack spell usage
- Feat Entry - Content pack feat usage

**Total:** 8 scenarios available to inspect and modify

---

## 🎨 **UI Layout**

```
┌─────────────────────────────────────────────────────────────┐
│  [🎮 Game] [🛠️ Designer]                                    │
├──────────────┬──────────────────────────────────────────────┤
│              │  📋 Scenario Inspector              [✖]      │
│  📁 Scenario │  ────────────────────────────────────────    │
│  Browser     │  File: /scenarios/smoke/hidden_pit.json     │
│              │                                              │
│  ▼ Smoke Tests (5)  │  Basic Properties:                        │
│    • Hidden Pit     │  Battle ID: [___________]                 │
│    • Fireball       │  Seed: [101]                              │
│    • Poisoned Dart  │  Engine Phase: [7]                        │
│    • Strike         │                                           │
│    • Enemy Duel     │  Map: 20×20 (15 blocked tiles)            │
│                     │                                           │
│  ▶ Phase 7 (1)      │  Units: 4                                 │
│  ▶ Phase 8 (2)      │    party: 1    enemy: 3                   │
│                     │                                           │
│                     │  Commands: 25                             │
│                     │    • move by hero                         │
│                     │    • strike by goblin1                    │
│                     │    ...                                    │
│                     │                                           │
└──────────────┴──────────────────────────────────────────────┘
```

---

## 🔧 **Keyboard Shortcuts**

Currently:
- **Click:** Select scenario or edit field
- **Mouse wheel:** Scroll panels

**Future:** Will add keyboard shortcuts for common actions

---

## ⚠️ **Current Limitations**

### **Not Yet Implemented:**
- ❌ Visual map editor (drag-and-drop blocked tiles)
- ❌ Unit placement/editing
- ❌ Command builder
- ❌ Objectives editor
- ❌ Mission events editor
- ❌ Content pack authoring
- ❌ AI policy designer

**These are Phase 2-3 features** (see DESIGNER_TOOLS_PLAN.md)

### **Known Issues:**
- ⚠️ Preview doesn't automatically switch to Game mode
- ⚠️ No undo/redo yet
- ⚠️ No auto-save (manual export only)

---

## 💾 **File Management**

### **Loading Scenarios:**
- Scenarios load from `/scenarios/` directory
- Served via Vite dev server
- Changes to scenario files require page refresh

### **Exporting Scenarios:**
- Exports to browser downloads folder
- Filename: `{battle_id}.json`
- Standard JSON format (can be loaded back)

### **Where to Save:**
- Save exported files to `scenarios/custom/` (create directory)
- Add to ScenarioFileBrowser.tsx to make browsable
- Or load manually via Game mode ScenarioLoader

---

## 🐛 **Troubleshooting**

### **"Failed to load scenario"**
- Check browser console for errors
- Verify scenario path is correct
- Ensure Vite dev server is running

### **Preview shows blank screen**
- Switch to **Game mode** after clicking Preview
- Check browser console for errors
- Verify scenario has valid units and map

### **Changes don't save**
- Must click **Export JSON** to save
- Changes only persist in browser memory until export
- Orange dot (●) shows unsaved changes

### **Can't find custom scenarios**
- Custom scenarios must be added to `ScenarioFileBrowser.tsx`
- Or use Game mode ScenarioLoader (supports file upload)

---

## 🔮 **What's Next (Phase 2)**

Coming soon:
1. **Visual Map Editor** - Drag-and-drop blocked tiles
2. **Unit Placement Tool** - Add/move/edit units visually
3. **Command Builder** - Build command sequences with forms
4. **Objectives Editor** - Configure victory/defeat conditions
5. **Real-time Preview** - See changes without leaving designer mode

**ETA:** 2-3 days of development

---

## 🎓 **Tips & Best Practices**

### **Workflow:**
1. Load existing scenario as template
2. Modify properties as needed
3. Preview to test
4. Export when satisfied
5. Use in game or share with others

### **Scenario Design:**
- Start with small maps (10×10 to 15×15)
- Test with odd seeds to find edge cases
- Use descriptive battle IDs
- Export frequently (no auto-save yet)

### **Performance:**
- Large scenarios (30×30+) may be slow to render
- Limit to 20-30 units for best performance
- Preview smaller scenarios first

---

## 📚 **Related Documentation**

- `CONTENT_AUTHORING.md` - How to write scenarios
- `GAME_DESIGN_WORKFLOW.md` - Design process
- `DESIGNER_TOOLS_PLAN.md` - Full roadmap
- `READY_TO_BUILD.md` - Project status

---

## 🎉 **You're Ready!**

The Scenario Viewer/Inspector is fully functional. Try it out:

1. Click **🛠️ Designer**
2. Load **Hidden Pit Trap**
3. Change the seed to `999`
4. Click **▶️ Preview**
5. Switch to **🎮 Game** mode
6. Watch the battle with different RNG!

**Have fun building scenarios!** 🚀

---

*Questions? Check DESIGNER_TOOLS_PLAN.md for the full roadmap.*
