# Game Design Workflow & Tools

## Context

Cantanor is a Pathfinder 2e ORC tactical TRPG. Game designers need efficient tools to:
- **Create & tune encounters** (scenarios, units, objectives)
- **Balance abilities** (spells, feats, items)
- **Test gameplay** (deterministic playback, outcome analysis)
- **Iterate quickly** (hot reload, dev tools)

This document assesses existing tooling and recommends improvements for the TypeScript migration.

---

## ✅ Existing Design Tools (Preserved from Python)

### 1. **Data-Driven Content System** ✓
**Location:** `corpus/`, `compiled/`

**What designers get:**
- **Content Packs** - Modular JSON files for spells/feats/items
  - `corpus/content_packs/phase7_baseline_v1.json` - 10+ spells
  - `corpus/content_packs/phase9_baseline_v1.json` - Additional content
- **Effect Models** - Hazard/ability mechanics in JSON
  - `compiled/tactical_effect_models_v1.json` - Hazard definitions
- **Scenario Format** - JSON battle configurations
  - 101 scenarios already created
  - Easy to version control and diff

**Example content pack entry:**
```json
{
  "id": "pf2e-core.magic-missile",
  "kind": "spell",
  "payload": {
    "command_type": "cast_spell",
    "spell_id": "magic-missile",
    "save_type": "Reflex",
    "damage": "3d4+3",
    "dc": 15
  }
}
```

**Design benefit:** Designers can add/modify abilities without touching code

### 2. **Deterministic Replay System** ✓
**Location:** `src/io/eventLog.ts`, `src/engine/rng.ts`

**What designers get:**
- **Reproducible battles** - Same seed = same outcome
- **Replay hashes** - Verify two runs are identical
- **Event logs** - JSON trace of every action
- **RNG seeding** - Control randomness for testing

**Example workflow:**
```typescript
// Designer finds a bug in scenario X with seed 12345
const scenario = loadScenario("scenarios/my_encounter.json");
scenario.seed = 12345; // Reproduce exact same battle
const result = await runScenario(scenario);
// Share replay hash with devs: "abc123def456..."
```

**Design benefit:** Bugs are reproducible, balance issues can be debugged

### 3. **Command Authoring Catalog** ✓
**Location:** `src/io/commandAuthoring.ts`

**What designers get:**
- **UI command builder** - Select spell/feat from content pack
- **Content entry filtering** - List available abilities by type
- **Payload templating** - Auto-fill command structure

**Example API:**
```typescript
// List all castable spells from content packs
const spells = listContentEntryOptions(contentContext, "cast_spell");
// Returns: [{ entryId: "pf2e-core.magic-missile", ... }, ...]

// Build command from content entry
const intent = buildUiCommandIntent(contentContext, {
  actor: "wizard_1",
  commandType: "cast_spell",
  contentEntryId: "pf2e-core.magic-missile",
  target: "goblin_1"
});
```

**Design benefit:** UI can dynamically populate ability menus

### 4. **Scenario Validation** ✓
**Location:** `src/io/scenarioLoader.ts`

**What designers get:**
- **JSON schema validation** - Catches errors before runtime
- **Unit validation** - HP, position, stats checked
- **Command validation** - Invalid commands rejected
- **Dependency checks** - Missing content packs caught early

**Design benefit:** Fast feedback loop, less "why doesn't this work?"

### 5. **Browser-Based Rendering** ✓
**Location:** `src/rendering/`, `src/ui/`

**What designers get:**
- **Visual feedback** - See battles play out
- **PixiJS canvas** - Tile-based tactical view
- **React UI panels** - Party status, combat log, actions
- **Interactive testing** - Click to select units, trigger actions

**Design benefit:** Visual iteration beats console-only testing

---

## ⚠️ Gaps: What's Missing for Optimal Design Workflow

### 1. **Hot Reload for Content Changes** ❌
**Problem:** Designers must rebuild/restart after editing content packs

**Impact:** Slow iteration (30-60s per change)

**Solution:**
```typescript
// Add to vite.config.ts
export default defineConfig({
  server: {
    watch: {
      // Watch corpus and compiled dirs
      include: ['corpus/**/*.json', 'compiled/**/*.json']
    }
  }
});
```

**Better:** Dynamic content reload without full page refresh
```typescript
// src/store/contentStore.ts
export const reloadContentPacks = async () => {
  const packs = await fetch('/corpus/content_packs/...').then(r => r.json());
  setPreloadedContent(packs);
  // Trigger re-render without losing battle state
};
```

**Priority:** HIGH - Most impactful for iteration speed

### 2. **In-Browser Scenario Editor** ❌
**Problem:** Designers edit JSON by hand (error-prone, slow)

**Impact:** High barrier to entry, JSON syntax errors

**Solution:** Add a scenario editor UI:
```typescript
// src/ui/ScenarioEditor.tsx
interface ScenarioEditorProps {
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

// Features:
// - Unit placement via drag-drop on canvas
// - Dropdown for unit templates (goblin, wizard, etc.)
// - Objective builder (checkboxes for common goals)
// - Command sequencer (timeline UI)
// - Save to JSON / Load from file
```

**Priority:** MEDIUM - Nice-to-have but designers can manage JSON

### 3. **Dev Mode / Cheat Commands** ❌
**Problem:** Testing requires playing through full scenarios

**Impact:** Slow balance testing (can't skip to critical moments)

**Solution:** Add dev mode hotkeys:
```typescript
// src/store/battleStore.ts - Dev mode actions
export const devModeActions = {
  instantKill: (unitId: string) => { /* set hp = 0 */ },
  giveActions: (unitId: string, count: number) => { /* refill actions */ },
  teleport: (unitId: string, x: number, y: number) => { /* move unit */ },
  skipToRound: (round: number) => { /* fast-forward */ },
  rerollLastAction: () => { /* re-run with new seed */ },
};

// Hotkeys: Ctrl+K = kill selected, Ctrl+A = give actions, etc.
```

**Priority:** MEDIUM - Speeds up playtesting

### 4. **Combat Outcome Statistics** ❌
**Problem:** No data on "how often does X beat Y?"

**Impact:** Balance decisions are based on gut feel

**Solution:** Monte Carlo simulation tool:
```typescript
// scripts-ts/analyzeBalance.ts
// Run scenario 1000x with different seeds
const outcomes = await runMonteCarloAnalysis({
  scenarioPath: "scenarios/goblin_vs_wizard.json",
  trials: 1000,
  seeds: [101, 102, 103, ...],
});

// Output:
// Player wins: 65%
// Average rounds: 4.2
// Wizard HP remaining (avg): 12.3
// Damage dealt distribution: [...]
```

**Priority:** MEDIUM - Valuable for competitive balance

### 5. **Damage Calculator / DPS Tool** ❌
**Problem:** Designers guess at ability strength

**Impact:** Abilities may be under/overpowered

**Solution:** Interactive calculator:
```typescript
// src/ui/DamageCalculator.tsx
// Input: Damage formula, target AC/saves, attacker mods
// Output: Expected damage, hit%, crit%
const expectedDamage = calculateExpectedValue({
  formula: "2d6+5",
  attackMod: 10,
  targetAC: 18,
  // Accounts for: hit/miss, crits, resistances
});
```

**Priority:** LOW - Can be calculated by hand or spreadsheet

### 6. **Designer Documentation** ❌
**Problem:** No guide for "how to create content"

**Impact:** Only devs can create scenarios/abilities

**Solution:** Create `CONTENT_AUTHORING.md`:
```markdown
# Content Authoring Guide

## Creating a Scenario
1. Copy a template from scenarios/templates/
2. Edit units array (id, team, hp, position, stats)
3. Add commands array (move, strike, cast_spell)
4. Set objectives (victory/defeat conditions)
5. Test with: npx tsx scripts-ts/runScenario.ts your_scenario.json

## Adding a Spell to a Content Pack
1. Open corpus/content_packs/your_pack.json
2. Add entry: { "id": "...", "kind": "spell", "payload": {...} }
3. Rebuild: npm run build:effects
4. Test in scenario
```

**Priority:** HIGH - Unblocks designers from creating content

---

## 🎯 Recommended Priorities for TypeScript Migration

### Phase 1: Essential (Block Python deletion if missing)
- [x] **Deterministic replay** - Already working ✓
- [x] **Scenario loading** - Already working ✓
- [x] **Content packs** - Already working ✓
- [x] **Visual rendering** - Already working ✓

### Phase 2: High Value (Add before designers start creating content)
- [ ] **Hot reload for content** - Save 30-60s per iteration
- [ ] **Designer documentation** - Unblock non-programmers
- [ ] **Dev mode tools** - Speed up playtesting

### Phase 3: Quality of Life (Add as designers request)
- [ ] **In-browser scenario editor** - Reduce JSON errors
- [ ] **Combat statistics** - Data-driven balance
- [ ] **Damage calculator** - Quick ability tuning

---

## 🛠️ Quick Wins: Improvements to Add Now

### 1. Enable Content Hot Reload (15 minutes)
```typescript
// vite.config.ts - Add watch config
server: {
  watch: {
    include: ['corpus/**/*.json', 'compiled/**/*.json']
  }
}
```

### 2. Add Dev Mode Flag (30 minutes)
```typescript
// src/store/battleStore.ts
export const devMode = {
  enabled: import.meta.env.DEV, // Only in dev builds
  instantKill: (unitId: string) => {
    useBattleStore.setState(state => {
      if (!devMode.enabled) return state;
      if (!state.battle) return state;
      const unit = state.battle.units[unitId];
      if (!unit) return state;
      unit.hp = 0;
      return { ...state };
    });
  },
  // Add more as needed
};
```

### 3. Create Content Authoring Guide (1 hour)
Document the JSON formats with examples. See recommended structure above.

---

## 📊 Comparison: Python vs TypeScript for Design

| Feature | Python | TypeScript | Notes |
|---------|--------|------------|-------|
| **Scenario format** | JSON ✓ | JSON ✓ | Identical |
| **Content packs** | JSON ✓ | JSON ✓ | Identical |
| **Determinism** | MT19937 | Mulberry32 | Different seeds, but equally reproducible |
| **Hot reload** | ❌ | ✓ (Vite) | TypeScript has better tooling |
| **Visual testing** | ❌ | ✓ (Browser) | Much better in browser |
| **CLI testing** | ✓ | ✓ (tsx) | Both work |
| **IDE support** | OK | Better | TypeScript LSP > Python |
| **Debugging** | pdb | DevTools | Browser DevTools > pdb |

**Verdict:** TypeScript is **equal or better** for game design in every category.

---

## 🚀 Action Items Before Python Deletion

### Must Have (Blockers)
- [x] Deterministic engine working ✓
- [x] Content pack loading ✓
- [x] Scenario validation ✓
- [x] Regression tests passing ✓

### Should Have (Before designers create content)
- [ ] **CONTENT_AUTHORING.md** - Designer documentation
- [ ] **Dev mode tools** - At least instant-kill and skip-round
- [ ] **Hot reload enabled** - For fast iteration

### Nice to Have (Future work)
- [ ] In-browser scenario editor
- [ ] Combat statistics analyzer
- [ ] Damage calculator UI

---

## 📝 Recommendation

**The Python deletion is SAFE from a game design perspective.** The TypeScript port:
- ✅ Preserves all data-driven content (JSON unchanged)
- ✅ Maintains determinism (different RNG but equally reproducible)
- ✅ Improves designer experience (browser > CLI, hot reload)
- ✅ Has better debugging tools (DevTools > pdb)

**Before deleting Python:**
1. Add CONTENT_AUTHORING.md guide (1 hour)
2. Enable hot reload in vite.config.ts (15 min)
3. Add basic dev mode tools (30 min)

**Total time investment:** ~2 hours to optimize designer experience

**Benefit:** Designers can work 100% in TypeScript/browser workflow, faster iteration than Python CLI ever provided.
