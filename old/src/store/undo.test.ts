/**
 * Undo stack — push, flush, pop, and the load-bearing determinism roundtrip.
 *
 * These tests drive the store directly (getState/setState). The only Zustand
 * gymnastics needed: a beforeEach reset, because the store is a module-level
 * singleton and test cases would otherwise bleed into each other.
 *
 * The reducer path is exercised for real (no mocks). That's deliberate: the
 * undo guarantee is "popping a snapshot restores EXACTLY the state the reducer
 * would have seen", and the only honest way to test that is to let the reducer
 * actually run and then check that a post-undo re-run produces the same bits.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBattleStore } from "./battleStore";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import { DeterministicRNG } from "../engine/rng";
import type { OrchestratorConfig } from "../io/battleOrchestrator";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

/** Orchestrator config with the AI policy off. We don't want _scheduleAiTurn
 *  reaching its rAF poll in a jsdom test environment — with the policy
 *  disabled it short-circuits to an auto-end_turn instead, which is still
 *  synchronous and doesn't touch rAF. For tests that never end_turn this
 *  is moot anyway (active unit stays PC, isAiUnit returns false, early out). */
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

/** Two-unit battle: PC attacker at (0,0), enemy defender at (1,0). Adjacent
 *  so strike doesn't need a move first. attacker goes first (higher init).
 *  team must be "pc" exactly — playerTeams is hardcoded to ["pc"] in
 *  buildOrchestratorConfig, and createTestUnit defaults to "player" which
 *  would make our hero an AI unit. */
function twoUnitBattle() {
  return createTestBattle({
    seed: 42,
    units: {
      hero: createTestUnit({
        unitId: "hero", team: "pc", x: 0, y: 0,
        initiative: 20, attackMod: 100,  // guaranteed hit so the test doesn't
        damage: "1d6",                    // ever see a miss-roundtrip (which
      }),                                 // would be 0-damage = boring check)
      goblin: createTestUnit({
        unitId: "goblin", team: "enemy", x: 1, y: 0,
        initiative: 10, hp: 50, maxHp: 50,  // tanky so one hit can't end the
      }),                                   // battle and fire checkBattleEnd
    },
    turnOrder: ["hero", "goblin"],
    turnIndex: 0,
  });
}

/** loadBattle is the real entry point (constructs RNG, builds config) but it
 *  takes a rawScenario to feed buildOrchestratorConfig. We already have the
 *  config we want; skip the ceremony and setState directly. This is the same
 *  shape loadBattle's set() call produces, minus tiledMap/content which undo
 *  doesn't read. */
function loadTestBattle() {
  const battle = twoUnitBattle();
  useBattleStore.setState({
    battle,
    rng: new DeterministicRNG(battle.seed),
    eventLog: [],
    orchestratorConfig: pcOnlyConfig(),
    contentContext: null,
    battleEnded: false,
    battleOutcome: null,
    isAiTurn: false,
    undoStack: [],
    undoGeneration: 0,
    targetMode: null,
    transient: { animationQueue: [], activeAnimCount: 0 },
  });
}

// Silence expected console noise. ReductionError hits console.warn; the
// bad-damage-formula test throws a plain Error (parseFormula doesn't know
// about ReductionError) which hits console.error. Both are deliberate.
const warnSpy  = vi.spyOn(console, "warn").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  // jsdom localStorage persists across tests in the same file; writeSave()
  // hits it on every successful dispatch. Clear so a later test doesn't
  // accidentally pass because an earlier one left a save behind.
  localStorage.clear();
  warnSpy.mockClear();
  errorSpy.mockClear();
  loadTestBattle();
});

// ---------------------------------------------------------------------------
// The load-bearing test. Everything else is mechanism; this is the promise.
// ---------------------------------------------------------------------------

describe("undo — determinism roundtrip", () => {
  it("re-running the same action after undo produces identical results", () => {
    const s = useBattleStore.getState;

    // ─── First strike ────────────────────────────────────────────────────
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    const hpAfterFirst   = s().battle!.units.goblin.hp;
    const rngAfterFirst  = s().rng!.callCount;
    const logAfterFirst  = JSON.stringify(s().eventLog);
    // Sanity: the strike actually did something. If this fails the test
    // fixture is wrong, not undo.
    expect(hpAfterFirst).toBeLessThan(50);
    expect(rngAfterFirst).toBeGreaterThan(0);

    // ─── Undo ────────────────────────────────────────────────────────────
    s().undo();

    // We're back to square zero. hp full, rng at 0, log empty. If any of
    // these drifted, the next strike would roll from a different position
    // and the roundtrip would diverge — but the test would still "pass"
    // on the hp check alone if the drift happened to cancel out. So check
    // ALL of them now, independently.
    expect(s().battle!.units.goblin.hp).toBe(50);
    expect(s().rng!.callCount).toBe(0);
    expect(s().eventLog).toEqual([]);
    expect(s().undoStack).toEqual([]);

    // ─── Second strike — same action, same target ────────────────────────
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    // Bit-for-bit identical to the first run. This is the whole point of
    // undo: not "go back" but "go back and try again WITH THE SAME DICE".
    // If the RNG reconstruction is off by even one roll, the damage die
    // comes up different and this fails.
    expect(s().battle!.units.goblin.hp).toBe(hpAfterFirst);
    expect(s().rng!.callCount).toBe(rngAfterFirst);
    expect(JSON.stringify(s().eventLog)).toBe(logAfterFirst);
  });

  it("preserves actionsRemaining across the roundtrip", () => {
    // Regression for the easy-to-miss case where undo restores hp/rng but
    // the actor's action economy drifts. Strike costs 1 action. After
    // strike→undo, the hero should have all 3 actions back, not 2.
    const s = useBattleStore.getState;

    expect(s().battle!.units.hero.actionsRemaining).toBe(3);
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().battle!.units.hero.actionsRemaining).toBe(2);
    s().undo();
    expect(s().battle!.units.hero.actionsRemaining).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Push / flush gating
// ---------------------------------------------------------------------------

describe("undo — push gating", () => {
  it("pushes one snapshot per PC action", () => {
    const s = useBattleStore.getState;

    expect(s().undoStack.length).toBe(0);
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().undoStack.length).toBe(1);
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().undoStack.length).toBe(2);
    // Each push captures the PRE-action state. After 2 strikes, stack[0]
    // should hold the pristine battle (hp 50), stack[1] the post-first-
    // strike battle (hp < 50). Popping twice walks all the way back.
    expect(s().undoStack[0].battle.units.goblin.hp).toBe(50);
    expect(s().undoStack[1].battle.units.goblin.hp).toBeLessThan(50);
  });

  it("does not push when isAiTurn is true", () => {
    // The real-world path to isAiTurn:true is _scheduleAiTurn → set → act →
    // dispatchCommand. We short-circuit that: set it directly, then dispatch.
    // This tests the GATE, not the AI loop.
    //
    // hero is still the active unit (we haven't end_turned) so the reducer
    // won't reject the strike — we're faking "the AI loop dispatched a PC
    // command", which is nonsense in production but exactly isolates the
    // push-gate from everything else.
    const s = useBattleStore.getState;

    useBattleStore.setState({ isAiTurn: true });
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    expect(s().undoStack.length).toBe(0);
    // The dispatch still happened — goblin took damage. We only skipped
    // the push. (If we'd skipped the whole dispatch that'd be a different
    // bug and a different test.)
    expect(s().battle!.units.goblin.hp).toBeLessThan(50);
  });

  it("flushes on end_turn", () => {
    // Null the orchestratorConfig for this test. That disables TWO things
    // at once: checkBattleEnd (gated on config at store:440) so the battle
    // can't end mid-test, and _scheduleAiTurn (gated on config at its entry)
    // so end_turn doesn't hand off to an rAF poll that jsdom would choke on.
    // The flush gate itself doesn't read config — it only reads isAiTurn
    // and cmd.type — so nulling config doesn't change what we're testing.
    useBattleStore.setState({ orchestratorConfig: null });

    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().undoStack.length).toBe(2);

    s().dispatchCommand({ type: "end_turn", actor: "hero" });

    // Turn is committed. The strikes are history now — no undoing across
    // the boundary. This is the "step-back within a turn" granularity.
    expect(s().undoStack.length).toBe(0);
  });

  it("does not push on a rejected command", () => {
    // Strike a target that doesn't exist. The reducer throws, the catch
    // block logs and returns. Nothing was committed, so nothing should be
    // on the stack — otherwise the player would hit Undo, pop a snapshot
    // identical to the current state, and wonder why nothing happened.
    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "ghost" });

    expect(s().undoStack.length).toBe(0);
    expect(s().battle!.units.goblin.hp).toBe(50);  // nothing happened
  });
});

// ---------------------------------------------------------------------------
// Pop mechanics
// ---------------------------------------------------------------------------

describe("undo — pop", () => {
  it("no-ops on an empty stack", () => {
    const s = useBattleStore.getState;
    const genBefore = s().undoGeneration;

    s().undo();

    // Same state, same gen. A no-op that bumps undoGeneration would fire
    // a spurious sprite-snap in App.tsx.
    expect(s().undoGeneration).toBe(genBefore);
    expect(s().battle!.units.goblin.hp).toBe(50);
  });

  it("bumps undoGeneration on a real pop", () => {
    // App.tsx watches this to fire snapAllSprites(). If it doesn't bump,
    // the undone unit slides backward instead of snapping — looks like a
    // move animation, reads wrong.
    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    const genBefore = s().undoGeneration;

    s().undo();

    expect(s().undoGeneration).toBe(genBefore + 1);
  });

  it("clears targetMode on pop", () => {
    // Aim a spell, then undo — the aiming context is now stale (the blue
    // tiles / blast radius were computed against the post-action state).
    // Force the player to re-arm rather than click into a lie.
    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    useBattleStore.setState({ targetMode: { type: "move" } });

    s().undo();

    expect(s().targetMode).toBeNull();
  });

  it("clears battleEnded on pop", () => {
    // Set up a fragile goblin so one strike kills it and checkBattleEnd
    // fires. Then undo the kill. The BattleEndOverlay should go away.
    const battle = twoUnitBattle();
    battle.units.goblin.hp = 1;
    battle.units.goblin.maxHp = 1;
    useBattleStore.setState({
      battle,
      rng: new DeterministicRNG(battle.seed),
      undoStack: [],
    });

    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().battleEnded).toBe(true);
    // The push happened BEFORE checkBattleEnd ran, so there IS a snapshot.
    expect(s().undoStack.length).toBe(1);

    s().undo();

    expect(s().battleEnded).toBe(false);
    expect(s().battleOutcome).toBeNull();
    expect(s().battle!.units.goblin.hp).toBe(1);  // alive again
  });

  it("trims eventLog, doesn't clear it", () => {
    // Two strikes, one undo. The log should hold the FIRST strike's events
    // and drop the second's. Clearing the whole log would be the easy
    // wrong answer (it's what loadSavedGame does, but that's a different
    // situation — loadSavedGame doesn't know what the log used to say).
    const s = useBattleStore.getState;

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    const logLenAfterOne = s().eventLog.length;
    expect(logLenAfterOne).toBeGreaterThan(0);

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });
    expect(s().eventLog.length).toBeGreaterThan(logLenAfterOne);

    s().undo();

    expect(s().eventLog.length).toBe(logLenAfterOne);
  });

  it("pops in LIFO order across multiple undos", () => {
    // move → strike → undo → undo should restore the original position
    // AND the original hp. If the stack were FIFO or the pop indexed wrong
    // (off-by-one at slice(0,-1)), we'd restore the wrong intermediate.
    const s = useBattleStore.getState;

    // Move south one tile — keeps hero adjacent to goblin (Chebyshev
    // distance (0,1)→(1,0) is still 1) so the follow-up strike lands.
    // Wire format is {x, y} not {to_x, to_y}; the reducer would silently
    // read undefined → NaN and throw on the bounds check if we got it
    // wrong, and the test would see stack length 1 instead of 2.
    s().dispatchCommand({ type: "move", actor: "hero", x: 0, y: 1 });
    expect(s().battle!.units.hero.y).toBe(1);  // sanity: the move landed

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    expect(s().undoStack.length).toBe(2);
    expect(s().battle!.units.goblin.hp).toBeLessThan(50);

    // First undo: rewind the strike. Hero still at (0,1), goblin hp restored.
    s().undo();
    expect(s().battle!.units.goblin.hp).toBe(50);
    expect(s().battle!.units.hero.y).toBe(1);  // move NOT undone yet

    // Second undo: rewind the move too. Back to pristine.
    s().undo();
    expect(s().battle!.units.hero.y).toBe(0);
    expect(s().undoStack.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RNG reset on throw — the determinism tightening
// ---------------------------------------------------------------------------

describe("undo — RNG reset on throw", () => {
  it("restores rng.callCount if the reducer rolls then throws", () => {
    // This is guarding against a future handler that rolls a d20, then
    // validates something and throws. Today every handler throws-before-
    // rolls, so there's no production path to trigger this. But we can
    // make one: give the hero a bad damage formula. Strike rolls the
    // attack d20 (rng +1), then rollDamage parses "bad" → throws.
    //
    // Without the reset, rng.callCount would be 1 after the throw. The
    // battle is unchanged (set() never ran), but the RNG has drifted.
    // The NEXT strike would roll from position 1 instead of 0, and a
    // scenario-runner replay would disagree.
    const battle = twoUnitBattle();
    battle.units.hero.damage = "bad_formula";
    useBattleStore.setState({
      battle,
      rng: new DeterministicRNG(battle.seed),
      undoStack: [],
    });

    const s = useBattleStore.getState;
    expect(s().rng!.callCount).toBe(0);

    s().dispatchCommand({ type: "strike", actor: "hero", target: "goblin" });

    // The command failed (goblin untouched), AND the RNG is back at 0.
    // Without the catch-block reset, this would be ≥1.
    expect(s().battle!.units.goblin.hp).toBe(50);
    expect(s().rng!.callCount).toBe(0);
    // And nothing was pushed — same as the "no push on reject" case.
    expect(s().undoStack.length).toBe(0);
  });
});
