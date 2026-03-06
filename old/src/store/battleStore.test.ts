/**
 * Store-level invariant tests.
 *
 * These drive the store directly (getState/setState). The reducer path is
 * exercised for real (no mocks) because the guarantees under test — RNG
 * position tracking, stale-timer fencing — only mean anything if the real
 * code path fires them.
 *
 * The store is a module-level singleton, so test cases bleed into each other
 * without a reset. Zustand's `getInitialState()` is the cheap fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useBattleStore } from "./battleStore";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import { DeterministicRNG } from "../engine/rng";
import type { OrchestratorConfig } from "../io/battleOrchestrator";
import type { ContentContext } from "../io/contentPackLoader";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

/** Orchestrator config with the AI policy off. We don't want _scheduleAiTurn
 *  reaching its rAF poll → grace-timer → dispatch chain in tests that use
 *  fake timers — with the policy disabled the act() callback short-circuits
 *  to an auto-end_turn instead. For tests that never end_turn this is moot
 *  anyway (active unit stays PC, isAiUnit returns false, early out). */
function pcOnlyConfig(): OrchestratorConfig {
  return {
    enemyPolicy: {
      enabled: false, teams: ["enemy"], action: "strike_nearest",
      contentEntryId: null, dc: null, autoEndTurn: true,
    },
    objectives: [],
    playerTeams: ["pc"],
  };
}

/** Config where the AI policy IS enabled — used for tests that specifically
 *  exercise _scheduleAiTurn's deferred dispatch. */
function aiEnabledConfig(): OrchestratorConfig {
  return {
    enemyPolicy: {
      enabled: true, teams: ["enemy"], action: "strike_nearest",
      contentEntryId: null, dc: null, autoEndTurn: true,
    },
    objectives: [],
    playerTeams: ["pc"],
  };
}

/** Two-unit battle: PC attacker at (0,0), enemy defender at (1,0). Adjacent
 *  so strike doesn't need a move first. hero goes first (higher init).
 *  team must be "pc" exactly — playerTeams is hardcoded to ["pc"]. */
function twoUnitBattle() {
  return createTestBattle({
    seed: 42,
    units: {
      hero: createTestUnit({
        unitId: "hero", team: "pc", x: 0, y: 0,
        initiative: 20, attackMod: 100,  // guaranteed hit
        damage: "1d6",
      }),
      goblin: createTestUnit({
        unitId: "goblin", team: "enemy", x: 1, y: 0,
        initiative: 10, hp: 50, maxHp: 50,  // tanky — one hit won't end the battle
      }),
    },
    turnOrder: ["hero", "goblin"],
    turnIndex: 0,
  });
}

/** setState directly to skip the loadBattle ceremony (which needs a
 *  rawScenario to feed buildOrchestratorConfig). Same shape as what
 *  loadBattle's set() produces, minus tiledMap/content which these tests
 *  don't read. Explicitly does NOT bump loadGeneration — tests that care
 *  about gen-fencing call loadBattle directly. */
function loadTestBattle(config: OrchestratorConfig = pcOnlyConfig()) {
  const battle = twoUnitBattle();
  useBattleStore.setState({
    battle,
    rng: new DeterministicRNG(battle.seed),
    eventLog: [],
    orchestratorConfig: config,
    contentContext: null,
    battleEnded: false,
    battleOutcome: null,
    isAiTurn: false,
    pendingReaction: null,
    reactionQueue: [],
    targetMode: null,
    transient: { animationQueue: [], activeAnimCount: 0 },
  });
}

/** Minimal rawScenario for driving the real loadBattle action. */
function rawScenario(enabled: boolean) {
  return {
    enemy_policy: { enabled, teams: ["enemy"], action: "strike_nearest", auto_end_turn: true },
    objectives: [],
  };
}

/** Empty ContentContext — loadBattle requires a real object (buildContentEntries
 *  reads .entryLookup immediately). */
const emptyContent: ContentContext = { selectedPackId: null, packs: [], entryLookup: {} };

// Silence expected console noise. ReductionError hits console.warn; the
// bad-damage-formula test throws a plain Error which hits console.error.
const warnSpy  = vi.spyOn(console, "warn").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

// Capture the module-init store shape once so every test starts from it.
// Zustand v5 resets to this when setState is called with `true` as the
// replace arg, but explicit capture is clearer and works across versions.
const initialStoreState = useBattleStore.getState();

beforeEach(() => {
  // jsdom localStorage persists across tests; writeSave() hits it on every
  // successful dispatch. Clear so a later test doesn't accidentally pass
  // because an earlier one left a save behind.
  localStorage.clear();
  warnSpy.mockClear();
  errorSpy.mockClear();
  useBattleStore.setState(initialStoreState, true);
});

afterEach(() => {
  // Clean up any fake-timer state a test may have left behind.
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// RNG reset on throw — the determinism seatbelt
// ---------------------------------------------------------------------------

describe("dispatchCommand — RNG reset on throw", () => {
  it("restores rng.callCount if the reducer rolls then throws", () => {
    // This guards against a future handler that rolls a d20, then validates
    // something and throws. Today every handler throws-before-rolls, so
    // there's no production path to trigger this. But we can make one: give
    // the hero a bad damage formula. Strike rolls the attack d20 (rng +1),
    // then rollDamage parses "bad_formula" → throws.
    //
    // Without the reset, rng.callCount would be ≥1 after the throw. The
    // battle is unchanged (set() never ran), but the RNG has drifted.
    // writeSave captures callCount, loadSavedGame reconstructs via
    // skipCount — a drifted RNG means the save no longer matches the state.
    loadTestBattle();
    const s = useBattleStore.getState;

    // Patch the already-loaded battle rather than rebuilding the fixture.
    // Safe because the reducer deepClones as its first statement.
    s().battle!.units.hero.damage = "bad_formula";

    expect(s().rng!.callCount).toBe(0);

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    // The command failed (goblin untouched), AND the RNG is back at 0.
    // Without the catch-block reset, this would be ≥1.
    expect(s().battle!.units.goblin.hp).toBe(50);
    expect(s().rng!.callCount).toBe(0);
  });

  it("is a no-op when the throw happened before any roll", () => {
    // Sanity: the common case. Strike a unit that doesn't exist → reducer
    // throws in assertActorTurn before touching the RNG. callCount was 0,
    // stays 0, reset code doesn't construct a new RNG instance needlessly.
    loadTestBattle();
    const s = useBattleStore.getState;
    const rngBefore = s().rng;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "ghost" });

    expect(s().rng!.callCount).toBe(0);
    // Same instance — the guard (callCount !== before) was false.
    expect(s().rng).toBe(rngBefore);
  });
});

// ---------------------------------------------------------------------------
// loadGeneration fencing — stale setTimeout callbacks must silently retire
// ---------------------------------------------------------------------------

describe("loadGeneration — stale timer fencing", () => {
  it("bumps on every loadBattle, even for the same scenario", () => {
    // The whole point: battle.battleId doesn't change on Play Again because
    // it comes from scenario JSON. loadGeneration does.
    const s = useBattleStore.getState;
    const gen0 = s().loadGeneration;

    s().loadBattle(twoUnitBattle(), 9, null, emptyContent, rawScenario(false));
    const gen1 = s().loadGeneration;
    expect(gen1).toBe(gen0 + 1);

    // Same scenario, same battleId — gen still bumps.
    s().loadBattle(twoUnitBattle(), 9, null, emptyContent, rawScenario(false));
    expect(s().loadGeneration).toBe(gen1 + 1);
    expect(s().battle!.battleId).toBe("test_battle");  // unchanged
  });

  it("discards a stale _scheduleAiTurn poll when a new battle loads", () => {
    // Scenario: PC ends turn → goblin (AI) is up → _scheduleAiTurn fires
    // → set({isAiTurn:true}) → rAF poll starts. Before the poll settles,
    // player hits Play Again. The stale poll must NOT dispatch against the
    // fresh battle.
    //
    // vitest's fake timers (sinonjs under the hood) capture jsdom's
    // requestAnimationFrame, so runAllTimers() drains the rAF chain too.
    vi.useFakeTimers();
    loadTestBattle(aiEnabledConfig());
    const s = useBattleStore.getState;

    // End hero's turn. goblin is AI → _scheduleAiTurn kicks off the rAF poll.
    s().dispatchCommand({ type: "end_turn", actor: "hero" });
    expect(s().isAiTurn).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Play Again — loadBattle bumps gen, resets isAiTurn:false.
    s().loadBattle(twoUnitBattle(), 9, null, emptyContent, rawScenario(false));
    const freshBattle = s().battle;
    expect(s().isAiTurn).toBe(false);
    const genAfterLoad = s().loadGeneration;

    // Drain all pending timers. The stale poll should gen-fence on its
    // first frame and silently return — no act(), no dispatch, no isAiTurn
    // flip. If it DID chain to act(), runAllTimers would drain the 120ms
    // grace setTimeout too and we'd see a mutated fresh battle below.
    vi.runAllTimers();

    // Fresh battle is untouched.
    expect(s().battle).toBe(freshBattle);
    expect(s().loadGeneration).toBe(genAfterLoad);
    expect(s().isAiTurn).toBe(false);
    // hero still has all 3 actions (no stale end_turn / strike landed)
    expect(s().battle!.units.hero.actionsRemaining).toBe(3);
  });

  it("discards a stale reaction auto-accept timer when a new battle loads", () => {
    // Scenario: PC move triggers an AoO from an enemy reactor →
    // _processNextReaction sees AI reactor → setTimeout(300) → resolveReaction.
    // Before 300ms passes, Play Again. The stale timer must NOT call
    // resolveReaction against the fresh battle.
    vi.useFakeTimers();

    // Need a reactor adjacent to hero's move path. Goblin at (1,0) with AoO;
    // hero moves from (0,0) to (0,1), leaving goblin's threat zone → triggers.
    const battle = createTestBattle({
      seed: 42,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 0, y: 0,
          initiative: 20, speed: 5,
        }),
        goblin: createTestUnit({
          unitId: "goblin", team: "enemy", x: 1, y: 0,
          initiative: 10, hp: 50, maxHp: 50,
          reactions: ["attack_of_opportunity"],
        }),
      },
      turnOrder: ["hero", "goblin"],
      turnIndex: 0,
    });
    useBattleStore.setState({
      battle,
      rng: new DeterministicRNG(battle.seed),
      eventLog: [],
      orchestratorConfig: pcOnlyConfig(),
      contentContext: null,
      battleEnded: false,
      battleOutcome: null,
      isAiTurn: false,
      pendingReaction: null,
      reactionQueue: [],
      targetMode: null,
      transient: { animationQueue: [], activeAnimCount: 0 },
    });
    const s = useBattleStore.getState;

    // Move hero away from goblin. Should trigger AoO → queue it → process →
    // goblin is AI → setTimeout(300) armed.
    s().dispatchCommand({ type: "move", actor: "hero", x: 0, y: 1 });
    expect(s().pendingReaction).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Play Again before the 300ms fires.
    s().loadBattle(twoUnitBattle(), 9, null, emptyContent, rawScenario(false));
    expect(s().pendingReaction).toBeNull();  // loadBattle cleared it
    const freshBattle = s().battle;

    // Fire all pending timers. Stale resolveReaction should gen-fence.
    vi.runAllTimers();

    expect(s().battle).toBe(freshBattle);
    expect(s().pendingReaction).toBeNull();
    // No reaction_strike dispatched — hero in fresh battle untouched.
    expect(s().battle!.units.hero.hp).toBe(10);
  });

  it("discards a stale anti-deadlock end_turn when a new battle loads", () => {
    // Scenario: AI's turn → AI command fails → catch block arms a
    // setTimeout(0) end_turn. Before that macrotask runs, Play Again.
    // The stale end_turn must NOT fire against the fresh battle.
    //
    // Trigger: put goblin as the active unit, then dispatch a bad command
    // in its name. isAiUnit(goblin)===true because team "enemy" isn't in
    // playerTeams ["pc"], so the catch-block AI-deadlock path engages.
    vi.useFakeTimers();
    loadTestBattle(aiEnabledConfig());

    // Advance turnIndex to goblin without going through end_turn (which
    // would arm its own rAF poll chain and muddy the test).
    const battle = useBattleStore.getState().battle!;
    useBattleStore.setState({ battle: { ...battle, turnIndex: 1 } });

    const s = useBattleStore.getState;

    // Dispatch a command the reducer will reject. Goblin striking itself
    // is the simplest guaranteed throw. The catch block sees goblin is
    // AI-controlled → arms setTimeout(0) end_turn.
    s().dispatchCommand({ type: "strike", actor: "goblin", target: "goblin" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Play Again before the macrotask runs.
    s().loadBattle(twoUnitBattle(), 9, null, emptyContent, rawScenario(false));
    const freshBattle = s().battle;
    expect(s().battle!.turnIndex).toBe(0);  // fresh battle, hero's turn

    vi.runAllTimers();

    // Fresh battle untouched. If the stale end_turn had fired, it would
    // have tried to end_turn "goblin" against a battle where hero is active,
    // throwing — but even a caught throw would have re-armed the deadlock
    // timer, so getTimerCount would be nonzero.
    expect(s().battle).toBe(freshBattle);
    expect(s().battle!.turnIndex).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
