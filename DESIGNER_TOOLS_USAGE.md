# Designer Tools - Quick Start Guide

**Status:** ✅ Phase 1 Complete - Scenario Viewer/Inspector + Tiled Map Viewer
**Version:** 0.2.0
**Date:** 2026-02-10

---

## What's Available

### Scenario Viewer/Inspector
- Browse available scenarios and Tiled maps by category
- Load and inspect scenario details
- Edit basic properties (battle ID, seed, map size, engine phase)
- View units, commands, objectives visually
- Live preview integration (load into game)
- Export modified scenarios as JSON

### Tiled Map Viewer
- Browse Tiled maps (`.tmj`) alongside JSON scenarios
- Inspect map dimensions, layers, tilesets
- View extracted spawn points and hazard zones
- "Open in Tiled" workflow for editing

---

## How to Use

### 1. Start the Development Server
```bash
npm run dev
```

Open browser to `http://localhost:5173`

### 2. Enter Designer Mode
Click the **🛠️ Designer** button in the top-left corner.

### 3. Browse Scenarios
The left panel shows scenarios organized by category. Click the **▶** arrow
to expand/collapse groups:

- **Tiled Maps** — maps authored in Tiled Map Editor
- **Smoke Tests** — engine regression tests
- **Phase 7** and **Phase 8** — content pack scenarios

### 4. Load a Scenario or Map
Click any item to load it. The right panel shows details.

**For JSON scenarios:** file path, editable basic properties, unit list,
command sequence, objectives.

**For Tiled maps:** file path, map dimensions + tile size, layer list with
counts, tileset list, extracted spawn points and hazard zones, and an
"Open in Tiled" hint.

### 5. Edit Properties (JSON scenarios only)
Change any of these fields:
- **Battle ID** — Scenario identifier
- **Seed** — RNG seed (change for different outcomes)
- **Engine Phase** — Compatibility version
- **Map Width/Height** — Grid dimensions

The orange dot (●) indicates unsaved changes.

### 6. Preview Live
Click **▶️ Preview** to load the scenario into the game engine, then switch
to **🎮 Game** mode to see it rendered and play through.

### 7. Export Modified Scenario (JSON scenarios only)
Click **💾 Export JSON** to download the modified scenario. After export the
unsaved indicator disappears.

### 8. Edit Tiled Maps
Tiled maps are read-only in the inspector. To modify a map:
1. Note the file path shown in the inspector
2. Open it in Tiled Map Editor
3. Make changes and re-export to `public/maps/`
4. Reload the browser to see the updated map

---

## Available Scenarios

### Tiled Maps (1 map)
- **dungeon_arena_01** — Dungeon arena with real tile art, spawn points, and
  blocked terrain

### Smoke Tests (5 scenarios)
- Hidden Pit Trap — Basic hazard
- Fireball Rune — AOE hazard
- Poisoned Dart Gallery — Persistent damage
- Strike Forecast — Strike mechanics test
- Enemy Policy Duel — AI policy test

### Phase 7 (1 scenario)
- Content Pack Integration — Content pack loading

### Phase 8 (2 scenarios)
- Spell Entry — Content pack spell usage
- Feat Entry — Content pack feat usage

**Total:** 9 scenarios/maps available

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [🎮 Game] [🛠️ Designer]                                    │
├──────────────┬──────────────────────────────────────────────┤
│              │  📋 Scenario Inspector              [✖]      │
│  📁 Scenario │  ────────────────────────────────────────    │
│  Browser     │  File: /maps/dungeon_arena_01.tmj            │
│              │                                              │
│  ▼ Tiled Maps (1)   │  Map: 20×15 tiles (32px per tile)        │
│    • dungeon_arena  │                                           │
│                     │  Layers: 3                                │
│  ▼ Smoke Tests (5)  │    ▦ Ground (tilelayer) — 300 tiles       │
│    • Hidden Pit     │    ▦ Walls (tilelayer) — 42 tiles         │
│    • Fireball       │    ◈ Spawns (objectgroup) — 4 objects     │
│    • Poisoned Dart  │                                           │
│    • Strike         │  Tilesets: 1                              │
│    • Enemy Duel     │    dungeon_basic — 64 tiles (GID 1+)      │
│                     │                                           │
│  ▶ Phase 7 (1)      │  Spawn Points: 4                          │
│  ▶ Phase 8 (2)      │    hero (pc) @ [3, 7]                     │
│                     │    goblin1 (enemy) @ [16, 7]              │
│                     │    ...                                    │
│                     │                                           │
│                     │  Edit in Tiled:                           │
│                     │  Open maps/dungeon_arena_01.tmj           │
└──────────────┴──────────────────────────────────────────────┘
```

---

## Current Limitations

### Not Yet Implemented:
- ❌ Visual unit placement/editing
- ❌ Command builder
- ❌ Objectives editor
- ❌ Mission events editor
- ❌ Content pack authoring
- ❌ AI policy designer

**These are Phase 2-3 features** (see DESIGNER_TOOLS_PLAN.md)

### Known Issues:
- ⚠️ Preview doesn't automatically switch to Game mode
- ⚠️ No undo/redo
- ⚠️ No auto-save (manual export only)

---

## File Management

### Loading Scenarios:
- JSON scenarios load from `/scenarios/` directory
- Tiled maps load from `/maps/` directory
- Served via Vite dev server
- Changes to files require page refresh

### Exporting Scenarios:
- Exports to browser downloads folder
- Filename: `{battle_id}.json`
- Standard JSON format (can be loaded back via Game mode ScenarioLoader)

### Adding New Maps:
- Export `.tmj` to `public/maps/` from Tiled
- Add tileset PNG to `public/tilesets/`
- Update `ScenarioFileBrowser.tsx` to list the new file

---

## Troubleshooting

### "Failed to load scenario"
- Check browser console for errors
- Verify Vite dev server is running
- For Tiled maps: verify tileset PNGs are in `public/tilesets/`

### "Preview shows blank screen"
- Switch to **Game mode** after clicking Preview
- Check browser console for errors

### "Tiled map tiles look wrong (checkered pattern)"
- This was a known rendering bug — now fixed
- Hard-refresh the browser (Cmd+Shift+R / Ctrl+Shift+R)

---

## What's Next (Phase 2)

Coming in the next phase:
1. **Command Builder** — Build command sequences with forms
2. **Unit Placement Tool** — Add/move/edit units visually
3. **Objectives Editor** — Configure victory/defeat conditions
4. **Auto-switch to Game mode** — After clicking Preview
5. **Content Pack Authoring** — Create custom spells/feats without JSON

---

## Tips

### Working with JSON Scenarios:
1. Load an existing scenario as a template
2. Modify properties as needed
3. Preview to test
4. Export when satisfied

### Working with Tiled Maps:
1. Load the map in the inspector to see its current state
2. Switch to Tiled to edit the map art or game data
3. Re-export to `public/maps/`
4. Reload browser to see changes

### Scenario Design:
- Start with small maps (10×10 to 15×15) for JSON scenarios
- Test with different seeds to find edge cases
- Use descriptive battle IDs
- Export frequently (no auto-save yet)

---

## Related Documentation

- `TILED_INTEGRATION_PLAN.md` — Tiled rendering architecture and authoring conventions
- `DESIGNER_TOOLS_PLAN.md` — Full designer tools roadmap
- `CONTENT_AUTHORING.md` — How to write JSON scenarios
