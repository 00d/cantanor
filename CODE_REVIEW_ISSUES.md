# Code Review: Stale Code, Errors, and Inconsistencies

## Executive Summary

**Build Status:** ❌ **BROKEN** - 66 TypeScript compilation errors
**Test Status:** ✅ PASSING - 131 tests pass with Vitest
**Severity:** 🔴 HIGH - Code works in tests but won't build for production

The codebase has **significant TypeScript configuration issues** preventing production builds, but the runtime code is functional (tests pass). Most issues are related to:
1. Missing Node.js type declarations
2. Snake_case/camelCase inconsistencies in tests
3. Unused variables and imports
4. Missing null checks

---

## 🔴 CRITICAL ISSUES (Build Blockers)

### 1. Missing Node.js Type Definitions
**Impact:** Build fails, 20+ errors
**Files Affected:**
- `vite.config.ts` (9 errors)
- `src/test-scenarios/regression.test.ts` (3 errors)
- `src/io/commandAuthoring.test.ts` (2 errors)
- `src/test-utils/scenarioTestRunner.ts` (2 errors)

**Errors:**
```typescript
// vite.config.ts:3
error TS2307: Cannot find module 'path' or its corresponding type declarations.

// vite.config.ts:9
error TS2304: Cannot find name '__dirname'.

// test files
error TS2307: Cannot find module 'fs' or its corresponding type declarations.
error TS2307: Cannot find module 'fs/promises' or its corresponding type declarations.
```

**Root Cause:** Missing `@types/node` in devDependencies

**Fix:**
```bash
npm install --save-dev @types/node
```

**Why Tests Pass:** Vitest provides Node.js types automatically in test environment, but TypeScript compilation for build doesn't have them.

---

### 2. Snake_case vs camelCase Type Mismatches
**Impact:** Build fails, 9 errors in tests
**File:** `src/effects/lifecycle.test.ts`

**Errors:**
```typescript
// Line 92
scenario.units[1].condition_immunities = ["frightened"];
// ERROR: Property 'condition_immunities' does not exist

// Line 214
scenario.units[1].temp_hp = 5;
// ERROR: Property 'temp_hp' does not exist

// Line 244
scenario.units[1].immunities = ["fire"];
// ERROR: Property 'immunities' does not exist
```

**Root Cause:** Test creates raw scenario objects with snake_case (JSON format), but TypeScript sees them as typed objects expecting camelCase.

**Fix Strategy:**
```typescript
// Option 1: Cast to unknown first
const scenario = createBaseScenario() as unknown as Record<string, any>;
scenario.units[1].condition_immunities = ["frightened"];

// Option 2: Create proper RawUnit type
interface RawUnit {
  id: string;
  team: string;
  hp: number;
  position: number[];
  // ... snake_case fields
  condition_immunities?: string[];
  temp_hp?: number;
  immunities?: string[];
}
```

---

### 3. Unknown Type Assertions in Tests
**Impact:** Build fails, 26 errors
**Files:** `src/effects/lifecycle.test.ts`, `src/rules/damage.test.ts`

**Errors:**
```typescript
// Line 113-114
expect(tick.payload.damage).toBe(6);
// ERROR: Object is of type 'unknown'

// Line 236-237
expect(tick.type).toBe("persistent_damage");
expect(tick.payload.damage).toBe(6);
// ERROR: 'tick' is of type 'unknown'
```

**Root Cause:** Event arrays have type `Record<string, unknown>[]`, accessing properties requires type narrowing.

**Fix:**
```typescript
// Before:
const tick = events.find((e) => e.type === "persistent_damage");
expect(tick.payload.damage).toBe(6); // Error

// After:
const tick = events.find((e) => e.type === "persistent_damage") as Record<string, any>;
expect(tick?.payload?.damage).toBe(6);

// Or better - create Event type:
interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
}
```

---

### 4. Missing CSS Type Declaration
**Impact:** Build fails, 1 error
**File:** `src/main.tsx:9`

**Error:**
```typescript
import "./styles.css";
// ERROR: Cannot find module './styles.css' or its corresponding type declarations
```

**Fix:** Create `src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
```

This is standard Vite setup that's missing.

---

### 5. Incorrect Vite Config Test Block
**Impact:** Build fails, 1 error
**File:** `vite.config.ts:38`

**Error:**
```typescript
test: {
  globals: true,
  environment: "jsdom",
  include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
},
// ERROR: No overload matches this call
```

**Root Cause:** `test` config should be in `vitest.config.ts` or imported properly.

**Fix:**
```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // ... rest of config
  test: {  // This is now valid
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

Or separate into `vitest.config.ts`.

---

## 🟡 WARNING ISSUES (Non-blocking but Important)

### 6. Unused Imports and Variables
**Impact:** Code bloat, confusion
**Count:** 9 occurrences

**Errors:**
```typescript
// src/engine/reducer.ts:20
error TS6133: 'Command' is declared but its value is never read.

// src/engine/reducer.ts:138
error TS6133: 'enemyUnitIds' is declared but its value is never read.

// src/test-utils/scenarioTestRunner.ts:10
error TS6133: 'replayHash' is declared but its value is never read.

// src/io/contentPackLoader.test.ts:20
error TS6133: 'ContentPack' is declared but its value is never read.

// src/ui/ActionPanel.tsx:6
error TS6133: 'React' is declared but its value is never read.

// src/ui/App.tsx:12
error TS6133: 'getPixiApp' is declared but its value is never read.

// src/ui/CombatLogPanel.tsx:6
error TS6133: 'React' is declared but its value is never read.

// src/ui/PartyPanel.tsx:6
error TS6133: 'React' is declared but its value is never read.
```

**Fixes:**

1. **React imports in UI files** - Not needed with React 19 + new JSX transform:
```typescript
// Remove these:
import React from "react";

// Keep only specific imports:
import { useEffect, useRef } from "react";
```

2. **Unused type imports:**
```typescript
// src/engine/reducer.ts
import { Command, RawCommand } from "./commands";
// Change to:
import type { Command } from "./commands"; // If only used as type
import { RawCommand } from "./commands";
```

3. **Unused variables:**
```typescript
// src/engine/reducer.ts:138
const enemyUnitIds = /* ... */;  // DELETE if truly unused

// src/test-utils/scenarioTestRunner.ts:10
import { replayHash } from "../io/eventLog";  // DELETE if unused
// But line 36 uses it in interface! Keep the import, remove TS error with:
export { replayHash };  // re-export if needed
```

---

### 7. Missing Null Checks (Potential Runtime Errors)
**Impact:** Possible crashes
**File:** `src/rendering/effectRenderer.ts`

**Errors:**
```typescript
// Lines 73-77
pooled.text.position.y = startY - 30 * t;
pooled.text.alpha = 1 - t;
// ERROR: 'pooled' is possibly 'null'
```

**Current Code:**
```typescript
const pooled = acquireFromPool();
if (!pooled) return;
// ... later
pooled.text.position.y = startY - 30 * t;  // TS thinks pooled could be null
```

**Issue:** TypeScript flow analysis doesn't recognize the closure captures `pooled` safely.

**Fix:**
```typescript
const pooled = acquireFromPool();
if (!pooled) return;

const pooledText = pooled.text; // Capture in local variable

function animate(delta: { deltaMS: number }) {
  elapsed += delta.deltaMS;
  const t = Math.min(elapsed / duration, 1);
  pooledText.position.y = startY - 30 * t;  // No error now
  pooledText.alpha = 1 - t;
  if (t >= 1) {
    pooledText.visible = false;
    pooled.inUse = false;
  }
}
```

---

### 8. Unused Variable Before Assignment
**Impact:** Logic error
**File:** `src/ui/App.tsx:48`

**Error:**
```typescript
let animFrameId: number;
// ...
return () => {
  cancelAnimationFrame(animFrameId);  // ERROR: used before assigned
};
```

**Issue:** `animFrameId` is never assigned, so cleanup does nothing.

**Root Cause:** Stale code - was probably used for requestAnimationFrame loop that's now handled by PixiJS ticker.

**Fix:**
```typescript
// Option 1: Remove unused variable
useEffect(() => {
  // ... init code
  return () => {
    // Cleanup if needed (destroy PixiJS app?)
  };
}, []);

// Option 2: If actually needed for animation loop:
useEffect(() => {
  let animFrameId: number;

  function loop() {
    // animation code
    animFrameId = requestAnimationFrame(loop);
  }
  loop();

  return () => {
    cancelAnimationFrame(animFrameId);
  };
}, []);
```

**Recommendation:** Remove `animFrameId` - PixiJS ticker handles animation.

---

### 9. Type Mismatch in Command Dispatch
**Impact:** Type safety compromised
**Files:**
- `src/engine/scenarioRunner.ts` (4 occurrences)
- `src/store/battleStore.ts:160` (1 occurrence)

**Errors:**
```typescript
// src/store/battleStore.ts:160
const [nextState, newEvents] = applyCommand(battle, command, rng);
// ERROR: Argument of type 'Record<string, unknown>' is not assignable to 'RawCommand'
```

**Issue:** `dispatchCommand` accepts `Record<string, unknown>` but `applyCommand` expects `RawCommand`.

**Current Signature:**
```typescript
// battleStore.ts
dispatchCommand: (command: Record<string, unknown>) => void;

// reducer.ts
export function applyCommand(
  state: BattleState,
  command: RawCommand,  // More specific type
  rng: DeterministicRNG
): [BattleState, Record<string, unknown>[]]
```

**Fix:**
```typescript
// battleStore.ts
import { RawCommand } from "../engine/commands";

export interface BattleStore {
  dispatchCommand: (command: RawCommand) => void;  // Proper type
  // ...
}
```

---

### 10. Index Type Error in Test
**Impact:** Test type safety
**File:** `src/rules/damage.test.ts:164`

**Error:**
```typescript
expect(nextState.units["target"].conditions["frightened"]).toBe(2);
// ERROR: Property 'frightened' does not exist on type '{}'
```

**Issue:** TypeScript infers `conditions: {}` at creation, but it's actually `Record<string, number>`.

**Fix:**
```typescript
// In test setup, explicitly type:
const state: BattleState = {
  // ...
  units: {
    target: {
      // ...
      conditions: {} as Record<string, number>,
    }
  }
};
```

Or better - use the scenario loader which handles this correctly.

---

## 🟢 MINOR ISSUES (Code Quality)

### 11. Inconsistent Naming Convention
**Impact:** Maintenance confusion
**Pattern:** JSON uses `snake_case`, TypeScript uses `camelCase`

**Examples:**
```typescript
// JSON format (RawCommand)
{
  "type": "save_damage",
  "save_type": "Reflex",
  "damage_type": "fire",
  "duration_rounds": 3
}

// TypeScript format (Command)
interface SaveDamageCommand {
  type: "save_damage";
  saveType: "Reflex";
  damageType: "fire";
  durationRounds: 3;
}
```

**Current State:** Correctly handled via `RawCommand` → `Command` conversion in reducer.

**Recommendation:** ✅ Keep as-is - this is intentional for JSON compatibility. But **document it clearly**:

```typescript
// commands.ts - Add comment
/**
 * RawCommand uses snake_case matching JSON schema from Python.
 * Command uses camelCase following TypeScript conventions.
 * Reducer converts between them.
 */
```

---

### 12. No Stale Code Found (Good!)
**Checked for:**
- ✅ Old commented code: None found
- ✅ Unused files: None found
- ✅ Deprecated APIs: None found
- ✅ TODO/FIXME comments: None found

---

## 📊 Issue Summary by Severity

| Severity | Count | Category | Status |
|----------|-------|----------|--------|
| 🔴 CRITICAL | 20 | Missing @types/node | Must fix |
| 🔴 CRITICAL | 9 | snake_case test issues | Must fix |
| 🔴 CRITICAL | 26 | Unknown type assertions | Must fix |
| 🔴 CRITICAL | 1 | Missing CSS types | Must fix |
| 🔴 CRITICAL | 1 | Vite config error | Must fix |
| 🟡 WARNING | 9 | Unused imports/vars | Should fix |
| 🟡 WARNING | 4 | Null check missing | Should fix |
| 🟡 WARNING | 1 | Unused variable | Should fix |
| 🟡 WARNING | 5 | Type mismatch | Should fix |
| 🟡 WARNING | 1 | Index type error | Should fix |
| 🟢 MINOR | - | Naming consistency | Document only |

**Total Issues:** 66 TypeScript errors, 11 code quality issues

---

## 🛠️ Quick Fix Action Plan

### Phase 1: Critical Fixes (30 min)
```bash
# 1. Install missing types
npm install --save-dev @types/node

# 2. Create vite-env.d.ts
cat > src/vite-env.d.ts << 'EOF'
/// <reference types="vite/client" />
EOF

# 3. Fix vite.config.ts imports
# Add: import { defineConfig } from 'vitest/config'
```

### Phase 2: Test Fixes (1-2 hours)
```typescript
// Fix src/effects/lifecycle.test.ts
// Cast scenario objects to any or create RawUnit type

// Fix event type assertions
// Add proper type guards or cast to any in tests
```

### Phase 3: Cleanup (30 min)
```typescript
// Remove unused React imports from UI files
// Remove unused variables
// Add proper null checks in effectRenderer.ts
```

### Phase 4: Type Safety (1 hour)
```typescript
// Fix command type mismatches
// Add proper Event type definitions
// Update battleStore.dispatchCommand signature
```

---

## ✅ Verification Steps

After fixes:
```bash
# 1. Type check should pass
npm run typecheck
# Expected: 0 errors

# 2. Build should succeed
npm run build
# Expected: dist/ created

# 3. Tests should still pass
npx vitest run
# Expected: 131 tests passing

# 4. Dev server should work
npm run dev
# Expected: http://localhost:5173 loads
```

---

## 🎯 Recommendations

### Immediate (Before Production)
1. ✅ Install `@types/node`
2. ✅ Create `vite-env.d.ts`
3. ✅ Fix test type assertions
4. ✅ Remove unused imports

### Short Term (Next Sprint)
1. Create comprehensive Event type system
2. Create RawUnit type for test scenarios
3. Add strict null checks to effectRenderer
4. Document snake_case/camelCase convention

### Long Term (Nice to Have)
1. Enable stricter TypeScript settings
2. Add ESLint for unused code detection
3. Consider switching tests to factory functions for better types
4. Add pre-commit hook to run typecheck

---

## 🏆 Positives (What's Working Well)

Despite the build errors, the codebase has several strengths:

1. ✅ **Tests Pass Reliably** - 131 tests, 100% deterministic
2. ✅ **Clean Architecture** - Clear separation of concerns
3. ✅ **No Legacy Code** - Fresh TypeScript port, no cruft
4. ✅ **Good Type Coverage** - Most code is properly typed
5. ✅ **Consistent Patterns** - Reducer, effects, commands all follow same structure
6. ✅ **No Security Issues** - No eval, no unsafe operations
7. ✅ **Performance Conscious** - Object pooling, frequency segregation in store

The issues are primarily **configuration and test-related**, not fundamental design problems.

---

## 🎓 Lessons Learned

1. **Vitest hides Node.js type issues** - Tests pass but builds fail
2. **snake_case/camelCase boundary** - Need explicit types for JSON fixtures
3. **React 19 changed imports** - No longer need `import React` in TSX files
4. **TypeScript strict mode catches real bugs** - Null checks, unused variables

---

## Final Grade

**Runtime Code Quality:** A- (Functional, tested, well-architected)
**Build Configuration:** D (Won't compile for production)
**Type Safety:** B (Good coverage, some gaps in tests)
**Overall:** B- (Works but needs config fixes to ship)

**Status:** ⚠️ **NOT PRODUCTION READY** until build errors resolved
