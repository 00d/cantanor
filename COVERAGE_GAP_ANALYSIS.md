# Coverage Gap Analysis - CRITICAL REVIEW

## ⚠️ IMPORTANT: Test Coverage Gap Identified

After careful review, there is a **significant gap** between Python test coverage and TypeScript test coverage.

---

## Current State

### Python Tests (To Be Deleted)
- **Contract tests:** 17 files, ~111 test methods
- **Scenario tests:** 36+ files, ~40 test methods
- **Total:** ~150+ test methods covering unit and integration testing
- **Lines of code:** ~9,805 lines in engine/ and tests/

### TypeScript Tests (Current)
- **Contract tests:** 3 files, 18 test methods
- **Infrastructure tests:** 1 file, 8 test methods
- **Regression tests:** 1 file, 7 test suites (52+ scenarios)
- **Total:** 33 test declarations
- **Lines of code:** ~548 lines of test code

### Source Code
- **TypeScript source files:** 39 files
- **TypeScript test files:** 5 files
- **File coverage:** ~13% (5/39 source files have dedicated tests)

---

## Gap Analysis

### ✅ What IS Covered

**Well Tested:**
1. **Checks & Saves** - `src/rules/checks.test.ts` (5 tests)
   - Degree of success calculations
   - Natural 20/1 handling
   - Save resolution
   - Basic save multipliers

2. **Damage & Conditions** - `src/rules/damage.test.ts` (11 tests)
   - Damage formula parsing
   - Damage rolls (deterministic)
   - Resistance/weakness/immunity
   - Grouped damage types (physical/energy)
   - Damage bypass
   - Condition application/clearing
   - Temp HP consumption

3. **Objectives** - `src/engine/objectives.test.ts` (2 tests)
   - Victory/defeat evaluation
   - Round/team objectives

4. **End-to-End Scenarios** - `src/test-scenarios/regression.test.ts` (52+ scenarios)
   - Phase 3.5: Hazards
   - Phase 4: Objectives, mission events
   - Phase 5: Damage mitigation
   - Phase 6: Forecasts, enemy policy
   - Phase 7: Content packs, interact
   - Phase 8: Pack integration
   - Phase 9: Policy rationale
   - All deterministic, zero command errors

### ❌ What is NOT Explicitly Tested

**Missing Unit Tests for:**

1. **Grid Mechanics** (CRITICAL for tactical gameplay)
   - `test_line_of_effect.py` (10+ tests) - LOE, cover calculations
   - `test_strike_los_cover.py` (8+ tests) - Strike with LOS/cover
   - `test_targeting_areas.py` (12+ tests) - Area shapes, targeting

2. **Effect Lifecycle** (CRITICAL for status effects)
   - `test_effect_lifecycle.py` (15+ tests) - Effect timing, duration, ticks

3. **IO & Validation**
   - `test_command_authoring.py` (6+ tests) - UI command building
   - `test_content_pack_loader.py` (8+ tests) - Content pack validation
   - `test_scenario_validation.py` (10+ tests) - Scenario validation

4. **Advanced Commands**
   - `test_spawn_commands.py` (5+ tests) - Unit spawning
   - `test_hazard_model_commands.py` (8+ tests) - Hazard mechanics
   - `test_forecast_payloads.py` (6+ tests) - Combat forecasting

5. **Edge Cases**
   - `test_affliction_edge_cases.py` (4+ tests) - Persistent damage edge cases
   - `test_damage_mitigation_runtime.py` (8+ tests) - Runtime damage calculation
   - `test_objective_packs.py` (4+ tests) - Objective pack expansion

**Total Missing:** ~13 test files, ~100+ test methods

---

## Risk Assessment

### HIGH RISK Areas

**Line of Effect / Cover** (No unit tests)
- Code exists: `src/grid/loe.ts`
- Used in: Strike commands, targeting
- Risk: Cover bonus miscalculation, LOE blocked when it shouldn't be
- Mitigation: Regression scenarios may exercise this (not confirmed)

**Effect Lifecycle** (No unit tests)
- Code exists: `src/effects/`
- Used in: Status effects, persistent damage, buff duration
- Risk: Effects not expiring correctly, tick timing wrong
- Mitigation: Phase 5 scenarios test some damage effects

**Area Targeting** (No unit tests)
- Code exists: `src/grid/areas.ts`
- Used in: AOE spells, burst effects
- Risk: Wrong tiles hit, area shape incorrect
- Mitigation: Phase 3.5 hazard scenarios use areas

### MEDIUM RISK Areas

**Scenario Validation** (No unit tests)
- Code exists: `src/io/scenarioLoader.ts`
- Risk: Invalid scenarios accepted, cryptic errors
- Mitigation: We validated 52 scenarios successfully

**Content Pack Loading** (No unit tests)
- Code exists: `src/io/contentPackLoader.ts`
- Risk: Content pack errors not caught
- Mitigation: Phase 7-9 scenarios load content packs

**Command Authoring** (No unit tests)
- Code exists: `src/io/commandAuthoring.ts`
- Risk: UI command building broken
- Mitigation: Used in browser UI (manual testing needed)

### LOW RISK Areas

**Spawn Commands** (No unit tests)
- Tested indirectly: Phase 4 mission events spawn units
- Regression coverage likely sufficient

**Forecast** (No unit tests)
- Tested indirectly: Phase 6 forecast scenarios
- Regression coverage likely sufficient

---

## What the Regression Tests Actually Cover

The 52+ regression scenarios DO exercise most code paths, including:
- ✓ Hazards (Phase 3.5)
- ✓ Mission events & spawning (Phase 4)
- ✓ Damage mitigation & temp HP (Phase 5)
- ✓ Enemy policy & forecasts (Phase 6)
- ✓ Content packs & interact (Phase 7-9)
- ✓ Command execution
- ✓ Turn order
- ✓ Objectives

**However:** Regression tests are **integration tests**, not **unit tests**.
- They catch "does the scenario work end-to-end?"
- They DON'T catch "does this specific function handle edge case X?"

---

## Comparison to Python

### Python Approach
- Strong unit test coverage (111 contract tests)
- Focused tests for each module
- Edge cases explicitly tested
- Integration tests for scenarios

### TypeScript Approach (Current)
- Light unit test coverage (18 contract tests)
- Heavy reliance on regression tests (52 scenarios)
- Edge cases tested implicitly via scenarios
- **Assumes scenarios exercise all important code paths**

---

## Recommendations

### Option 1: Accept the Risk (FAST - Ready Now)

**Rationale:**
- Regression tests cover 52+ scenarios successfully
- All scenarios are deterministic (zero command errors)
- TypeScript port is 1:1 translation from Python
- Game design workflow is improved
- Can add unit tests incrementally as bugs are found

**Risk:**
- Edge cases in LOE/cover may not be tested
- Effect lifecycle bugs might slip through
- Area targeting edge cases unknown

**Mitigation:**
- Keep Python code in git history (can reference)
- Monitor for bugs in untested areas
- Add unit tests when bugs discovered
- Consider Python as "reference implementation"

**Action:** Delete Python now, document coverage gaps

### Option 2: Add Critical Unit Tests (SAFE - 2-3 Days)

**Rationale:**
- Cover HIGH RISK areas before deletion
- Match Python's unit test coverage for critical paths
- Explicit edge case testing

**Tests to Add:**
1. Grid mechanics (LOE, LOS, cover, areas) - ~30 tests, 4 hours
2. Effect lifecycle (apply, tick, expire) - ~15 tests, 2 hours
3. Area targeting edge cases - ~12 tests, 2 hours

**Total:** ~60 additional tests, ~8 hours of work

**Action:** Port critical tests, then delete Python

### Option 3: Full Parity (THOROUGH - 1-2 Weeks)

**Rationale:**
- Match Python test coverage completely
- 100% confidence in deletion
- Documentation via tests

**Tests to Add:** All 13 missing test files (~100 tests)

**Action:** Port all tests, then delete Python

---

## Recommended Path Forward

### I Recommend: **Option 1 with Documentation**

**Reasoning:**
1. **Regression tests provide strong coverage** - 52 scenarios, all passing
2. **TypeScript is a 1:1 port** - Not a rewrite, just translation
3. **Python tests passed** - We know the reference implementation worked
4. **Can add tests incrementally** - Fix-on-failure is pragmatic
5. **Designer workflow improved** - TypeScript is better for iteration

**Conditions:**
1. ✅ Document coverage gaps (this file)
2. ✅ Keep Python in git history as reference
3. ✅ Monitor HIGH RISK areas (LOE, effects, areas)
4. ⚠️ Plan to add unit tests for HIGH RISK if bugs found

**What We Have:**
- 33 TypeScript tests passing
- 52 regression scenarios validated
- Deterministic execution verified
- Zero command errors in all scenarios
- All phases (3.5-9) working

**What We're Missing:**
- Explicit unit tests for edge cases
- ~60 tests for LOE/effect/area mechanics
- Direct validation of uncommon code paths

**Is this enough?**
**YES**, if we:
- Accept that some edge cases aren't explicitly tested
- Commit to adding tests when bugs are found
- Keep Python code accessible as reference
- Monitor untested areas closely in production

---

## Conclusion

**Current state:** TypeScript port is functional and validated via regression tests, but lacks comprehensive unit test coverage.

**Risk level:** MEDIUM - Regression tests provide strong integration coverage, but edge cases may not be tested.

**Recommended action:**
1. Document this gap (✓ This file)
2. Delete Python code (keep in git history)
3. Add unit tests for HIGH RISK areas if bugs emerge
4. Consider Option 2 (add ~60 critical tests) if time permits

**Safety net:** Python code remains in git history. If serious bugs found, can reference Python tests to add corresponding TypeScript tests.

---

## Sign-Off

I've identified this coverage gap and documented it transparently. The decision to proceed with deletion should weigh:

**Pros:**
- Regression tests provide strong end-to-end validation
- TypeScript workflow is better for designers
- Can add tests incrementally
- Python code stays in git history

**Cons:**
- Missing ~60 critical unit tests
- Some edge cases not explicitly tested
- Risk of subtle bugs in untested paths

**My recommendation:** Proceed with deletion BUT document this gap and commit to adding tests as needed. The regression test coverage is substantial (52 scenarios) and provides good confidence for production use.
