import { describe, it, expect } from "vitest";
import { detectMoveReactions, detectDamageReactions } from "./reactions";
import { applyCommand } from "./reducer";
import {
  createTestUnit,
  createTestBattle,
  createAoOUnit,
  createShieldUnit,
  createTestRNG,
} from "../test-utils/fixtures";

describe("detectMoveReactions", () => {
  it("AoO triggers when enemy moves within reactor's reach", () => {
    const mover = createTestUnit({ unitId: "mover", team: "player", x: 1, y: 0, speed: 5 });
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 1, y: 1 });
    const battle = createTestBattle({
      units: { mover, reactor },
      turnOrder: ["mover", "reactor"],
    });
    // Mover was at (1,0), adjacent to reactor at (1,1)
    // Apply move to (2,0)
    const rng = createTestRNG();
    const [nextState] = applyCommand(battle, { type: "move", actor: "mover", x: 2, y: 0 }, rng);
    const triggers = detectMoveReactions(nextState, "mover", 1, 0);
    expect(triggers.length).toBe(1);
    expect(triggers[0].reactorId).toBe("reactor");
    expect(triggers[0].reactionType).toBe("attack_of_opportunity");
    expect(triggers[0].provokerId).toBe("mover");
  });

  it("AoO doesn't trigger when enemy is out of reach", () => {
    const mover = createTestUnit({ unitId: "mover", team: "player", x: 5, y: 0, speed: 5 });
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 0, y: 0 });
    const battle = createTestBattle({
      units: { mover, reactor },
      turnOrder: ["mover", "reactor"],
    });
    const rng = createTestRNG();
    const [nextState] = applyCommand(battle, { type: "move", actor: "mover", x: 6, y: 0 }, rng);
    const triggers = detectMoveReactions(nextState, "mover", 5, 0);
    expect(triggers.length).toBe(0);
  });

  it("AoO doesn't trigger when reaction already used", () => {
    const mover = createTestUnit({ unitId: "mover", team: "player", x: 1, y: 0, speed: 5 });
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 1, y: 1, reactionAvailable: false });
    const battle = createTestBattle({
      units: { mover, reactor },
      turnOrder: ["mover", "reactor"],
    });
    const rng = createTestRNG();
    const [nextState] = applyCommand(battle, { type: "move", actor: "mover", x: 2, y: 0 }, rng);
    const triggers = detectMoveReactions(nextState, "mover", 1, 0);
    expect(triggers.length).toBe(0);
  });

  it("multiple AoO enemies: both trigger, sorted by unitId", () => {
    const mover = createTestUnit({ unitId: "mover", team: "player", x: 1, y: 0, speed: 5 });
    const r1 = createAoOUnit({ unitId: "z_reactor", team: "enemy", x: 1, y: 1 });
    const r2 = createAoOUnit({ unitId: "a_reactor", team: "enemy", x: 0, y: 0 });
    const battle = createTestBattle({
      units: { mover, z_reactor: r1, a_reactor: r2 },
      turnOrder: ["mover", "z_reactor", "a_reactor"],
    });
    const rng = createTestRNG();
    const [nextState] = applyCommand(battle, { type: "move", actor: "mover", x: 2, y: 0 }, rng);
    const triggers = detectMoveReactions(nextState, "mover", 1, 0);
    expect(triggers.length).toBe(2);
    expect(triggers[0].reactorId).toBe("a_reactor"); // sorted alphabetically
    expect(triggers[1].reactorId).toBe("z_reactor");
  });

  it("AoO doesn't trigger on same-team movement", () => {
    const mover = createTestUnit({ unitId: "mover", team: "enemy", x: 1, y: 0, speed: 5 });
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 1, y: 1 });
    const battle = createTestBattle({
      units: { mover, reactor },
      turnOrder: ["mover", "reactor"],
    });
    const rng = createTestRNG();
    const [nextState] = applyCommand(battle, { type: "move", actor: "mover", x: 2, y: 0 }, rng);
    const triggers = detectMoveReactions(nextState, "mover", 1, 0);
    expect(triggers.length).toBe(0);
  });
});

describe("detectDamageReactions (Shield Block)", () => {
  it("Shield Block triggers on physical damage with shield raised", () => {
    const unit = createShieldUnit({ unitId: "shield", shieldRaised: true, hp: 5, maxHp: 20 });
    const battle = createTestBattle({
      units: { shield: unit },
    });
    const triggers = detectDamageReactions(battle, "shield", 10, "physical");
    expect(triggers.length).toBe(1);
    expect(triggers[0].reactionType).toBe("shield_block");
    expect(triggers[0].data?.["damageAmount"]).toBe(10);
  });

  it("Shield Block doesn't trigger on energy damage", () => {
    const unit = createShieldUnit({ unitId: "shield", shieldRaised: true });
    const battle = createTestBattle({ units: { shield: unit } });
    const triggers = detectDamageReactions(battle, "shield", 10, "fire");
    expect(triggers.length).toBe(0);
  });

  it("Shield Block doesn't trigger without raised shield", () => {
    const unit = createShieldUnit({ unitId: "shield", shieldRaised: false });
    const battle = createTestBattle({ units: { shield: unit } });
    const triggers = detectDamageReactions(battle, "shield", 10, "physical");
    expect(triggers.length).toBe(0);
  });
});

describe("raise_shield reducer", () => {
  it("costs 1 action, sets shieldRaised", () => {
    const unit = createShieldUnit({ unitId: "su", x: 0, y: 0 });
    const battle = createTestBattle({
      units: { su: unit },
      turnOrder: ["su"],
    });
    const rng = createTestRNG();
    const [next, events] = applyCommand(battle, { type: "raise_shield", actor: "su" }, rng);
    expect(next.units["su"].shieldRaised).toBe(true);
    expect(next.units["su"].actionsRemaining).toBe(2);
    expect(events.length).toBe(1);
    expect((events[0] as Record<string, unknown>)["type"]).toBe("raise_shield");
  });

  it("broken shield (0 HP) can't be raised", () => {
    const unit = createShieldUnit({ unitId: "su", x: 0, y: 0, shieldHp: 0 });
    const battle = createTestBattle({
      units: { su: unit },
      turnOrder: ["su"],
    });
    expect(() =>
      applyCommand(battle, { type: "raise_shield", actor: "su" }, createTestRNG()),
    ).toThrow("broken");
  });
});

describe("shield_block reducer", () => {
  it("restores HP by hardness, damages shield", () => {
    const unit = createShieldUnit({
      unitId: "su", x: 0, y: 0,
      hp: 10, maxHp: 20,
      shieldRaised: true,
      shieldHardness: 5,
      shieldHp: 20,
    });
    const enemy = createTestUnit({ unitId: "en", team: "enemy", x: 1, y: 0 });
    const battle = createTestBattle({
      units: { su: unit, en: enemy },
      turnOrder: ["en", "su"],
    });
    const rng = createTestRNG();
    // Shield block with 8 damage → blocks 5 (hardness), shield takes 3 damage
    const [next, events] = applyCommand(battle, { type: "shield_block", actor: "su", damage_amount: 8 }, rng);
    expect(next.units["su"].hp).toBe(15); // 10 + 5 blocked
    expect(next.units["su"].shieldHp).toBe(17); // 20 - 3 shield damage
    expect(next.units["su"].reactionAvailable).toBe(false);
    expect(events.length).toBe(1);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["damage_blocked"]).toBe(5);
    expect(payload["shield_damage"]).toBe(3);
  });

  it("fails without raised shield", () => {
    const unit = createShieldUnit({ unitId: "su", x: 0, y: 0, shieldRaised: false });
    const enemy = createTestUnit({ unitId: "en", team: "enemy", x: 1, y: 0 });
    const battle = createTestBattle({
      units: { su: unit, en: enemy },
      turnOrder: ["en", "su"],
    });
    expect(() =>
      applyCommand(battle, { type: "shield_block", actor: "su", damage_amount: 5 }, createTestRNG()),
    ).toThrow("not raised");
  });
});

describe("reaction_strike reducer", () => {
  it("costs 0 actions, consumes reaction", () => {
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 1, y: 1, attackMod: 10, damage: "1d8" });
    const target = createTestUnit({ unitId: "target", team: "player", x: 1, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { reactor, target },
      turnOrder: ["target", "reactor"], // target's turn — reactor reacts
    });
    const rng = createTestRNG();
    const [next, events] = applyCommand(
      battle,
      { type: "reaction_strike", actor: "reactor", target: "target" },
      rng,
    );
    expect(next.units["reactor"].actionsRemaining).toBe(3); // unchanged
    expect(next.units["reactor"].reactionAvailable).toBe(false);
    expect(next.units["reactor"].attacksThisTurn).toBe(0); // unchanged
    expect(events.length).toBe(1);
    expect((events[0] as Record<string, unknown>)["type"]).toBe("reaction_strike");
  });

  it("has no MAP", () => {
    // Even if the reactor has made attacks this turn, reaction strike has no MAP
    const reactor = createAoOUnit({
      unitId: "reactor", team: "enemy", x: 1, y: 1,
      attackMod: 10, damage: "1d8", attacksThisTurn: 2,
    });
    const target = createTestUnit({ unitId: "target", team: "player", x: 1, y: 0, hp: 20, maxHp: 20 });
    const battle = createTestBattle({
      units: { reactor, target },
      turnOrder: ["target", "reactor"],
    });
    const rng = createTestRNG();
    const [, events] = applyCommand(
      battle,
      { type: "reaction_strike", actor: "reactor", target: "target" },
      rng,
    );
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    const roll = payload["roll"] as Record<string, unknown>;
    // modifier should be 10 (weapon attackMod), no MAP subtracted
    expect(roll["modifier"]).toBe(10);
  });

  it("fails if reaction already consumed", () => {
    const reactor = createAoOUnit({ unitId: "reactor", team: "enemy", x: 1, y: 1, reactionAvailable: false });
    const target = createTestUnit({ unitId: "target", team: "player", x: 1, y: 0 });
    const battle = createTestBattle({
      units: { reactor, target },
      turnOrder: ["target", "reactor"],
    });
    expect(() =>
      applyCommand(battle, { type: "reaction_strike", actor: "reactor", target: "target" }, createTestRNG()),
    ).toThrow("no reaction available");
  });
});

describe("turn reset", () => {
  it("turn end resets shieldRaised", () => {
    const unit = createShieldUnit({ unitId: "su", x: 0, y: 0, shieldRaised: true });
    const enemy = createTestUnit({ unitId: "en", team: "enemy", x: 5, y: 5 });
    const battle = createTestBattle({
      units: { su: unit, en: enemy },
      turnOrder: ["su", "en"],
    });
    const rng = createTestRNG();
    const [next] = applyCommand(battle, { type: "end_turn", actor: "su" }, rng);
    // After turn advance, su's shieldRaised should reset when their next turn comes
    // But for now it resets on advanceTurn to their turn
    // Since we ended su's turn, the next turn is en's. When en ends, su gets a new turn
    const [next2] = applyCommand(next, { type: "end_turn", actor: "en" }, rng);
    expect(next2.units["su"].shieldRaised).toBe(false);
  });
});
