/**
 * Store-level reaction flow tests.
 *
 * These drive the store directly (getState/setState). The reducer path is
 * exercised for real (no mocks) — the cascade guarantee is "resolving one
 * reaction can queue another, and the outer queue survives", which can only
 * be tested honestly by letting the reducer actually run.
 *
 * The store is a module-level singleton; beforeEach resets it so tests don't
 * bleed. Fake timers prevent _scheduleAiTurn's rAF poll + grace setTimeout
 * and the auto-resolve setTimeout(300) from firing mid-test. rAF is
 * explicitly included in toFake because vitest's default fake-timers config
 * leaves it real — under jsdom that's a setTimeout(16) polyfill that would
 * race with synchronous assertions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useBattleStore } from "./battleStore";
import { createTestBattle, createTestUnit } from "../test-utils/fixtures";
import { DeterministicRNG } from "../engine/rng";
import type { OrchestratorConfig } from "../io/battleOrchestrator";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

/** AI policy disabled — _scheduleAiTurn short-circuits. playerTeams=["pc"]
 *  matches buildOrchestratorConfig's hardcoded value; PC units must use
 *  team:"pc" (fixtures default to "player" which would make them AI here). */
function testConfig(): OrchestratorConfig {
  return {
    enemyPolicy: {
      enabled: false, teams: ["enemy"], action: "strike_nearest",
      contentEntryId: null, dc: null, autoEndTurn: true,
    },
    objectives: [],
    playerTeams: ["pc"],
  };
}

/** Bypass loadBattle's rawScenario/contentContext ceremony — setState directly
 *  with the same shape loadBattle's set() produces, minus fields reactions
 *  don't read. */
function loadTestBattle(battle: ReturnType<typeof createTestBattle>) {
  useBattleStore.setState({
    battle,
    rng: new DeterministicRNG(battle.seed),
    eventLog: [],
    orchestratorConfig: testConfig(),
    contentContext: null,
    battleEnded: false,
    battleOutcome: null,
    isAiTurn: false,
    pendingReaction: null,
    reactionQueue: [],
    selectedUnitId: null,
    targetMode: null,
    transient: { animationQueue: [], activeAnimCount: 0 },
  });
}

const initialState = useBattleStore.getState();

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout", "clearTimeout",
      "setInterval", "clearInterval",
      "requestAnimationFrame", "cancelAnimationFrame",
    ],
  });
  useBattleStore.setState(initialState, true);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reaction cascade", () => {
  it("reaction_strike triggering shield_block does not clobber pendingReaction", () => {
    // PC at (1,0) with shield raised — moves to (2,0), provoking the enemy's
    // AoO. The AoO strike hits (attackMod 100 = guaranteed) and triggers
    // the PC's shield_block. The cascade must surface the shield_block
    // prompt, not clobber it with a null clear.
    const battle = createTestBattle({
      seed: 42,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 1, y: 0, hp: 50, maxHp: 50,
          reactions: ["shield_block"],
          shieldRaised: true, shieldHardness: 5, shieldHp: 20, shieldMaxHp: 20,
        }),
        watcher: createTestUnit({
          unitId: "watcher", team: "enemy", x: 1, y: 1,
          reactions: ["attack_of_opportunity"],
          attackMod: 100, damage: "1d6",  // guaranteed hit, physical damage
        }),
      },
      turnOrder: ["hero", "watcher"],
      turnIndex: 0,
    });
    loadTestBattle(battle);
    const store = useBattleStore.getState();

    // Move provokes AoO.
    store.dispatchCommand({ type: "move", actor: "hero", x: 2, y: 0 });

    const afterMove = useBattleStore.getState();
    expect(afterMove.pendingReaction).not.toBeNull();
    expect(afterMove.pendingReaction!.reactionType).toBe("attack_of_opportunity");
    expect(afterMove.pendingReaction!.reactorId).toBe("watcher");
    expect(afterMove.reactionQueue).toHaveLength(0); // popped into pending

    // Resolve the AoO. Its reaction_strike deals physical damage to hero,
    // whose shield is raised — shield_block should trigger and become the
    // new pendingReaction. Calling directly bypasses the 300ms auto-resolve
    // timer; that timer's identity-check will see pendingReaction has moved
    // on and retire silently.
    afterMove.resolveReaction(true);

    const afterAoO = useBattleStore.getState();
    expect(afterAoO.pendingReaction).not.toBeNull();
    expect(afterAoO.pendingReaction!.reactionType).toBe("shield_block");
    expect(afterAoO.pendingReaction!.reactorId).toBe("hero");
  });

  it("outer reaction queue survives nested dispatch (append, not replace)", () => {
    // PC at (1,1), two enemies adjacent — both have AoO reach. Moving provokes
    // both. Resolving the first must not discard the second.
    const battle = createTestBattle({
      seed: 7,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 1, y: 1, hp: 50, maxHp: 50,
        }),
        aoo_a: createTestUnit({
          unitId: "aoo_a", team: "enemy", x: 0, y: 0,
          reactions: ["attack_of_opportunity"], attackMod: 100,
        }),
        aoo_b: createTestUnit({
          unitId: "aoo_b", team: "enemy", x: 2, y: 0,
          reactions: ["attack_of_opportunity"], attackMod: 100,
        }),
      },
      turnOrder: ["hero", "aoo_a", "aoo_b"],
      turnIndex: 0,
    });
    loadTestBattle(battle);
    const store = useBattleStore.getState();

    // Move to (1,0) — still adjacent to both enemies (Chebyshev 1), so the
    // reaction_strike executed AFTER the move is still in reach. Moving to
    // (1,2) would detect the AoO (hero leaves a threatened square) but the
    // strike would reject with "out of reach" since it runs against the
    // final position.
    store.dispatchCommand({ type: "move", actor: "hero", x: 1, y: 0 });

    // Both AoOs queued; first popped into pendingReaction, second in queue.
    // detectMoveReactions sorts by unitId → aoo_a first.
    const afterMove = useBattleStore.getState();
    expect(afterMove.pendingReaction!.reactorId).toBe("aoo_a");
    expect(afterMove.reactionQueue).toHaveLength(1);
    expect(afterMove.reactionQueue[0].reactorId).toBe("aoo_b");

    // Resolve aoo_a. Hero has no shield → no cascade. The queue should
    // surface aoo_b next, not be replaced with [].
    afterMove.resolveReaction(true);

    const afterFirst = useBattleStore.getState();
    expect(afterFirst.pendingReaction).not.toBeNull();
    expect(afterFirst.pendingReaction!.reactorId).toBe("aoo_b");
    expect(afterFirst.reactionQueue).toHaveLength(0);
  });

  it("declining a reaction advances to the next in queue without dispatching", () => {
    const battle = createTestBattle({
      seed: 7,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 1, y: 1, hp: 50, maxHp: 50,
        }),
        aoo_a: createTestUnit({
          unitId: "aoo_a", team: "enemy", x: 0, y: 0,
          reactions: ["attack_of_opportunity"],
        }),
        aoo_b: createTestUnit({
          unitId: "aoo_b", team: "enemy", x: 2, y: 0,
          reactions: ["attack_of_opportunity"],
        }),
      },
      turnOrder: ["hero", "aoo_a", "aoo_b"],
      turnIndex: 0,
    });
    loadTestBattle(battle);
    const store = useBattleStore.getState();
    const rngBefore = useBattleStore.getState().rng!.callCount;

    store.dispatchCommand({ type: "move", actor: "hero", x: 1, y: 2 });
    const rngAfterMove = useBattleStore.getState().rng!.callCount;

    const afterMove = useBattleStore.getState();
    expect(afterMove.pendingReaction!.reactorId).toBe("aoo_a");

    // Decline aoo_a — no dispatch, no RNG advance past the move.
    afterMove.resolveReaction(false);

    const afterDecline = useBattleStore.getState();
    expect(afterDecline.pendingReaction!.reactorId).toBe("aoo_b");
    expect(afterDecline.rng!.callCount).toBe(rngAfterMove); // no strike rolled

    // Decline aoo_b too — queue drains, pendingReaction clears.
    afterDecline.resolveReaction(false);

    const afterBoth = useBattleStore.getState();
    expect(afterBoth.pendingReaction).toBeNull();
    expect(afterBoth.reactionQueue).toHaveLength(0);
    expect(afterBoth.rng!.callCount).toBe(rngAfterMove);
    // rngBefore captured to make the no-advance assertion meaningful.
    expect(rngAfterMove).toBeGreaterThanOrEqual(rngBefore);
  });

  it("cascading shield_block resolves before next outer AoO (prepend ordering)", () => {
    // PC with shield + two AoO enemies. Move provokes both. First AoO hits,
    // triggers shield_block. Shield_block must be the next pending reaction
    // (prepended), not deferred past aoo_b.
    const battle = createTestBattle({
      seed: 42,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 1, y: 1, hp: 100, maxHp: 100,
          reactions: ["shield_block"],
          shieldRaised: true, shieldHardness: 5, shieldHp: 20, shieldMaxHp: 20,
        }),
        aoo_a: createTestUnit({
          unitId: "aoo_a", team: "enemy", x: 0, y: 0,
          reactions: ["attack_of_opportunity"], attackMod: 100, damage: "1d6",
        }),
        aoo_b: createTestUnit({
          unitId: "aoo_b", team: "enemy", x: 2, y: 0,
          reactions: ["attack_of_opportunity"], attackMod: 100, damage: "1d6",
        }),
      },
      turnOrder: ["hero", "aoo_a", "aoo_b"],
      turnIndex: 0,
    });
    loadTestBattle(battle);
    const store = useBattleStore.getState();

    // (1,0) keeps hero in reach of both after the move — see comment in
    // "outer reaction queue" test above.
    store.dispatchCommand({ type: "move", actor: "hero", x: 1, y: 0 });

    const afterMove = useBattleStore.getState();
    expect(afterMove.pendingReaction!.reactorId).toBe("aoo_a");
    expect(afterMove.reactionQueue.map(r => r.reactorId)).toEqual(["aoo_b"]);

    // Resolve aoo_a — strike hits hero, shield_block triggers.
    // Prepend order: [shield_block, aoo_b] → shield_block pops as pending.
    afterMove.resolveReaction(true);

    const afterFirst = useBattleStore.getState();
    expect(afterFirst.pendingReaction!.reactionType).toBe("shield_block");
    expect(afterFirst.pendingReaction!.reactorId).toBe("hero");
    // aoo_b still queued behind.
    expect(afterFirst.reactionQueue.map(r => r.reactorId)).toEqual(["aoo_b"]);
  });

  it("stale auto-resolve timer retires silently when pendingReaction has moved on", () => {
    // Enemy's AoO → auto-resolve timer scheduled. If resolveReaction is
    // called directly (racing the timer), the timer must NOT resolve the
    // subsequent shield_block prompt.
    const battle = createTestBattle({
      seed: 42,
      units: {
        hero: createTestUnit({
          unitId: "hero", team: "pc", x: 1, y: 0, hp: 50, maxHp: 50,
          reactions: ["shield_block"],
          shieldRaised: true, shieldHardness: 5, shieldHp: 20, shieldMaxHp: 20,
        }),
        watcher: createTestUnit({
          unitId: "watcher", team: "enemy", x: 1, y: 1,
          reactions: ["attack_of_opportunity"], attackMod: 100, damage: "1d6",
        }),
      },
      turnOrder: ["hero", "watcher"],
      turnIndex: 0,
    });
    loadTestBattle(battle);
    const store = useBattleStore.getState();

    store.dispatchCommand({ type: "move", actor: "hero", x: 2, y: 0 });
    // AoO pending → auto-resolve timer scheduled (watcher is enemy/AI).

    // Manually resolve before the timer fires — pendingReaction becomes shield_block.
    useBattleStore.getState().resolveReaction(true);
    expect(useBattleStore.getState().pendingReaction!.reactionType).toBe("shield_block");

    const shieldBlockRef = useBattleStore.getState().pendingReaction;

    // Advance the stale auto-resolve timer. It must see pendingReaction !== the
    // AoO trigger it was scheduled for and retire without touching shield_block.
    vi.advanceTimersByTime(400);

    const afterTimer = useBattleStore.getState();
    expect(afterTimer.pendingReaction).toBe(shieldBlockRef); // same object, untouched
  });
});

describe("loadGeneration fence", () => {
  it("stale _scheduleAiTurn poll retires silently after loadBattle bumps gen", () => {
    // Battle where first unit is enemy → _scheduleAiTurn fires on load.
    const firstBattle = createTestBattle({
      seed: 1,
      units: {
        goblin: createTestUnit({ unitId: "goblin", team: "enemy", x: 0, y: 0 }),
        hero:   createTestUnit({ unitId: "hero",   team: "pc",    x: 1, y: 0 }),
      },
      turnOrder: ["goblin", "hero"],
      turnIndex: 0,
    });
    loadTestBattle(firstBattle);
    // Manually bump loadGeneration + schedule AI (loadTestBattle bypasses
    // loadBattle's gen-bump + _processNextReaction tail). Call _scheduleAiTurn
    // directly — we're testing its internal gen-fence, not the gateway.
    useBattleStore.setState((s) => ({ loadGeneration: s.loadGeneration + 1 }));
    useBattleStore.getState()._scheduleAiTurn();

    const genBefore = useBattleStore.getState().loadGeneration;
    expect(useBattleStore.getState().isAiTurn).toBe(true);

    // Simulate Play Again: bump gen (what loadBattle would do). Keep
    // isAiTurn:true — the fresh battle's first unit is ALSO AI, so the
    // fresh _scheduleAiTurn would set it. This is the stomp scenario:
    // the STALE poll must not write isAiTurn:false over this.
    useBattleStore.setState((s) => ({
      loadGeneration: s.loadGeneration + 1,
      isAiTurn: true,
    }));

    const battleRefBefore = useBattleStore.getState().battle;
    const eventLogLenBefore = useBattleStore.getState().eventLog.length;

    // Advance the clock — fires the first pending rAF (pollSettled). It
    // captured genBefore; gen is now genBefore+1. pollSettled's gen-mismatch
    // guard silent-returns WITHOUT scheduling the next rAF, so the poll
    // dies here. 500ms is well past 2×rAF (~32ms) + GRACE_MS (120ms);
    // if the guard were missing we'd reach act() — which with
    // policy.enabled:false would auto-end-turn goblin, mutating eventLog.
    vi.advanceTimersByTime(500);

    const after = useBattleStore.getState();
    expect(after.loadGeneration).toBe(genBefore + 1);
    // The fence's job: the stale poll silently returns. isAiTurn stays
    // true (the fresh gen's flag, un-stomped), battle and eventLog
    // untouched (act() never ran).
    expect(after.isAiTurn).toBe(true);
    expect(after.battle).toBe(battleRefBefore);
    expect(after.eventLog.length).toBe(eventLogLenBefore);
  });
});
