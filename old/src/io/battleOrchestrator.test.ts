/**
 * Tests for materializeRawCommand — specifically the cast_spell →
 * area_save_damage rewrite that fires when a content entry's payload carries
 * an `area` block.
 *
 * The single-target merge path (no area) is exercised transitively by the
 * scenarioRunner regression suite. These tests focus on the area branch: does
 * the rewrite produce exactly the wire format the reducer's area_save_damage
 * handler reads, and does it stay out of the way for non-area spells?
 */

import { describe, it, expect } from "vitest";
import { materializeRawCommand, getAiCommand, type EnemyPolicy } from "./battleOrchestrator";
import type { ContentContext, ResolvedEntry } from "./contentPackLoader";
import { ReductionError } from "../engine/reducer";
import { createTestUnit, createTestBattle } from "../test-utils/fixtures";

/** Build a one-entry ContentContext — just enough for materializeRawCommand
 *  to look up. The real loader populates packs/selectedPackId but
 *  materialize never reads them. */
function ctx(id: string, entry: ResolvedEntry): ContentContext {
  return {
    selectedPackId: "test",
    packs: [],
    entryLookup: { [id]: entry },
  };
}

describe("materializeRawCommand — area spell rewrite", () => {
  const fireball: ResolvedEntry = {
    packId: "test",
    kind: "spell",
    sourceRef: null,
    tags: ["fire", "area"],
    payload: {
      command_type: "cast_spell",
      spell_id: "fireball",
      area: { shape: "burst", radius_feet: 20 },
      save_type: "Reflex",
      mode: "basic",
      damage: "6d6",
      damage_type: "fire",
      dc: 20,
    },
  };

  it("rewrites cast_spell to area_save_damage and maps radius_feet", () => {
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        center_x: 5,
        center_y: 7,
        content_entry_id: "spell.fireball",
      },
      ctx("spell.fireball", fireball),
    );

    // These are the exact keys the reducer's area_save_damage handler reads
    // (reducer.ts ~1430-1440). If any of them are missing or misnamed the
    // reducer won't throw — it will silently read undefined → Number() → NaN →
    // hit nobody. So assert each one.
    expect(cmd["type"]).toBe("area_save_damage");
    expect(cmd["actor"]).toBe("hero");
    expect(cmd["center_x"]).toBe(5);
    expect(cmd["center_y"]).toBe(7);
    expect(cmd["shape"]).toBe("burst");
    expect(cmd["radius_feet"]).toBe(20);
    expect(cmd["save_type"]).toBe("Reflex");
    expect(cmd["mode"]).toBe("basic");
    expect(cmd["damage"]).toBe("6d6");
    expect(cmd["damage_type"]).toBe("fire");
    expect(cmd["dc"]).toBe(20);
  });

  it("scrubs fields the area reducer path doesn't read", () => {
    // The area_save_damage handler ignores unknown keys, so leaving these in
    // is harmless to execution. They're scrubbed anyway so the event log
    // doesn't carry misleading noise — a Fireball event with a `target` field
    // would read like a single-target cast.
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        center_x: 3,
        center_y: 3,
        // Deliberately include a stray target — a buggy UI might send one
        target: "should_be_deleted",
        content_entry_id: "spell.fireball",
      },
      ctx("spell.fireball", fireball),
    );

    expect(cmd).not.toHaveProperty("area");      // schema metadata, not wire format
    expect(cmd).not.toHaveProperty("spell_id");  // single-target-cast field
    expect(cmd).not.toHaveProperty("target");    // single-target-cast field
  });

  it("throws if center_x/center_y are missing", () => {
    // Catch the bug where someone dispatches an area spell through the
    // single-target click path. Without this guard the rewrite would produce
    // center_x: undefined → Number(undefined) in the reducer → NaN → an
    // area_save_damage event with resolutions: [] and no error. That's the
    // worst kind of failure: it looks like it worked.
    expect(() =>
      materializeRawCommand(
        {
          type: "cast_spell",
          actor: "hero",
          target: "goblin",   // wrong — area spells don't take a target
          content_entry_id: "spell.fireball",
        },
        ctx("spell.fireball", fireball),
      ),
    ).toThrow(ReductionError);
  });

  it("rewrites cone — lifts shape + length_feet to radius_feet", () => {
    const burningHands: ResolvedEntry = {
      ...fireball,
      payload: { ...fireball.payload, area: { shape: "cone", length_feet: 15 } },
    };
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        center_x: 3,
        center_y: 4,
        content_entry_id: "spell.burning_hands",
      },
      ctx("spell.burning_hands", burningHands),
    );
    expect(cmd["type"]).toBe("area_save_damage");
    expect(cmd["shape"]).toBe("cone");
    expect(cmd["radius_feet"]).toBe(15);   // length_feet → radius_feet
    expect(cmd["center_x"]).toBe(3);        // aim point, not centre
    expect(cmd["center_y"]).toBe(4);
    expect(cmd).not.toHaveProperty("area");
    expect(cmd).not.toHaveProperty("spell_id");
  });

  it("rewrites line — lifts shape + length_feet", () => {
    const lightningBolt: ResolvedEntry = {
      ...fireball,
      payload: { ...fireball.payload, area: { shape: "line", length_feet: 60 } },
    };
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        center_x: 8,
        center_y: 2,
        content_entry_id: "spell.lightning_bolt",
      },
      ctx("spell.lightning_bolt", lightningBolt),
    );
    expect(cmd["type"]).toBe("area_save_damage");
    expect(cmd["shape"]).toBe("line");
    expect(cmd["radius_feet"]).toBe(60);
  });

  it("throws on an unknown area shape", () => {
    // Forward-compat guard — a shape we've never heard of should fail loud,
    // not silently fall through to the single-target path.
    const cube: ResolvedEntry = {
      ...fireball,
      payload: { ...fireball.payload, area: { shape: "cube", radius_feet: 15 } },
    };
    expect(() =>
      materializeRawCommand(
        {
          type: "cast_spell",
          actor: "hero",
          center_x: 1,
          center_y: 1,
          content_entry_id: "spell.cube_of_doom",
        },
        ctx("spell.cube_of_doom", cube),
      ),
    ).toThrow(/burst\/cone\/line/);
  });

  it("leaves non-area spells untouched", () => {
    // Regression guard for every existing single-target entry in the content
    // packs. The rewrite branch is gated on payloadTemplate.area — absent
    // means the entire branch is skipped and we fall through to the old
    // merge-and-return.
    const produceFlame: ResolvedEntry = {
      packId: "test",
      kind: "spell",
      sourceRef: null,
      tags: ["fire"],
      payload: {
        command_type: "cast_spell",
        spell_id: "produce_flame",
        save_type: "Reflex",
        mode: "basic",
        damage: "1d4+3",
        damage_type: "fire",
        dc: 16,
      },
    };
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        target: "goblin",
        content_entry_id: "spell.produce_flame",
      },
      ctx("spell.produce_flame", produceFlame),
    );

    expect(cmd["type"]).toBe("cast_spell");        // NOT rewritten
    expect(cmd["target"]).toBe("goblin");          // NOT scrubbed
    expect(cmd["spell_id"]).toBe("produce_flame"); // NOT scrubbed
    expect(cmd).not.toHaveProperty("radius_feet");
  });

  it("reads area from the template, not the caller", () => {
    // Make sure nobody can inject an area block through the dispatch call and
    // turn a single-target spell into an AoE at runtime. The rewrite gate
    // reads payloadTemplate.area — i.e. the content-pack author's
    // declaration — not the merged command. Without this guard a malicious
    // save file (or a UI bug) could give any spell a 999ft radius.
    const produceFlame: ResolvedEntry = {
      packId: "test",
      kind: "spell",
      sourceRef: null,
      tags: ["fire"],
      payload: {
        command_type: "cast_spell",
        spell_id: "produce_flame",
        save_type: "Reflex",
        mode: "basic",
        damage: "1d4+3",
        damage_type: "fire",
        dc: 16,
      },
    };
    const cmd = materializeRawCommand(
      {
        type: "cast_spell",
        actor: "hero",
        target: "goblin",
        // Attacker-controlled area injection — should be ignored
        area: { shape: "burst", radius_feet: 999 },
        content_entry_id: "spell.produce_flame",
      },
      ctx("spell.produce_flame", produceFlame),
    );

    expect(cmd["type"]).toBe("cast_spell");   // rewrite did NOT fire
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getAiCommand — cast_area_entry_best
// ═══════════════════════════════════════════════════════════════════════════

describe("getAiCommand — cast_area_entry_best", () => {
  const areaPolicy = (entryId: string): EnemyPolicy => ({
    enabled: true,
    teams: ["b"],
    action: "cast_area_entry_best",
    contentEntryId: entryId,
    dc: null,
    autoEndTurn: true,
  });

  const burstEntry: ResolvedEntry = {
    packId: "test",
    kind: "spell",
    sourceRef: null,
    tags: ["area"],
    payload: {
      command_type: "cast_spell",
      area: { shape: "burst", radius_feet: 10 },  // 2-tile radius
      save_type: "Reflex",
      damage: "4d6",
      damage_type: "fire",
      dc: 18,
    },
  };

  const coneEntry: ResolvedEntry = {
    ...burstEntry,
    payload: { ...burstEntry.payload, area: { shape: "cone", length_feet: 15 } }, // 3-tile cone
  };

  const lineEntry: ResolvedEntry = {
    ...burstEntry,
    payload: { ...burstEntry.payload, area: { shape: "line", length_feet: 30 } }, // 6-tile line
  };

  it("burst — centres on the enemy cluster, not the nearest enemy", () => {
    // AI at (0,0). Lone enemy nearby at (2,0); cluster of 3 enemies at (8,8),
    // (8,9), (9,8). A 10ft burst centred on any cluster member hits all three.
    // Best score = 3. Centring on the loner scores 1. AI should pick cluster.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const loner = createTestUnit({ unitId: "loner", team: "a", x: 2, y: 0 });
    const c1 = createTestUnit({ unitId: "c1", team: "a", x: 8, y: 8 });
    const c2 = createTestUnit({ unitId: "c2", team: "a", x: 8, y: 9 });
    const c3 = createTestUnit({ unitId: "c3", team: "a", x: 9, y: 8 });
    const battle = createTestBattle({
      units: { ai, loner, c1, c2, c3 },
      turnOrder: ["ai", "loner", "c1", "c2", "c3"],
      turnIndex: 0,
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.fireball"), ctx("spell.fireball", burstEntry));

    expect(cmd["type"]).toBe("cast_spell");
    expect(cmd["content_entry_id"]).toBe("spell.fireball");
    // Aim should be at one of the cluster tiles (all three score the same;
    // c1 wins the unitId tiebreak).
    const [cx, cy] = [cmd["center_x"], cmd["center_y"]];
    expect([[8, 8], [8, 9], [9, 8]]).toContainEqual([cx, cy]);
  });

  it("burst — avoids friendly fire when it can", () => {
    // AI at (0,0), team b. Enemy at (5,5) with AI ally at (5,6) — centring
    // there scores 0 (1 enemy, 1 ally). Second enemy at (10,10), isolated —
    // centring there scores 1. AI picks the isolated one.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const ally = createTestUnit({ unitId: "ally", team: "b", x: 5, y: 6 });
    const e1 = createTestUnit({ unitId: "e1", team: "a", x: 5, y: 5 });
    const e2 = createTestUnit({ unitId: "e2", team: "a", x: 10, y: 10 });
    const battle = createTestBattle({
      units: { ai, ally, e1, e2 },
      turnOrder: ["ai", "ally", "e1", "e2"],
      turnIndex: 0,
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.fireball"), ctx("spell.fireball", burstEntry));

    expect(cmd["type"]).toBe("cast_spell");
    expect(cmd["center_x"]).toBe(10);
    expect(cmd["center_y"]).toBe(10);
  });

  it("cone — aims through the enemy cluster, not behind itself", () => {
    // AI at (5,5). Two enemies east at (7,5), (7,6) — aiming east through
    // either hits both with a 15ft cone. One enemy behind at (3,5) — aiming
    // west hits only that one. AI aims east.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 5, y: 5 });
    const behind = createTestUnit({ unitId: "behind", team: "a", x: 3, y: 5 });
    const e1 = createTestUnit({ unitId: "e1", team: "a", x: 7, y: 5 });
    const e2 = createTestUnit({ unitId: "e2", team: "a", x: 7, y: 6 });
    const battle = createTestBattle({
      units: { ai, behind, e1, e2 },
      turnOrder: ["ai", "behind", "e1", "e2"],
      turnIndex: 0,
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.cone"), ctx("spell.cone", coneEntry));

    expect(cmd["type"]).toBe("cast_spell");
    // Aim should be through one of the eastern enemies (both score 2)
    expect([[7, 5], [7, 6]]).toContainEqual([cmd["center_x"], cmd["center_y"]]);
  });

  it("line — picks the aim that collinearly threads multiple enemies", () => {
    // AI at (0,2). Three enemies collinear on y=2 at x=3,5,7 — aiming through
    // any of them hits all three with a 30ft (6-tile) line. One enemy off-axis
    // at (3,5) — aiming there hits only one. AI picks the collinear aim.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 2 });
    const e1 = createTestUnit({ unitId: "e1", team: "a", x: 3, y: 2 });
    const e2 = createTestUnit({ unitId: "e2", team: "a", x: 5, y: 2 });
    const e3 = createTestUnit({ unitId: "e3", team: "a", x: 6, y: 2 });  // within 6 tiles
    const off = createTestUnit({ unitId: "off", team: "a", x: 3, y: 5 });
    const battle = createTestBattle({
      units: { ai, e1, e2, e3, off },
      turnOrder: ["ai", "e1", "e2", "e3", "off"],
      turnIndex: 0,
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.bolt"), ctx("spell.bolt", lineEntry));

    expect(cmd["type"]).toBe("cast_spell");
    expect(cmd["center_y"]).toBe(2);  // aimed along the row
  });

  it("moves toward nearest enemy when no aim scores positive", () => {
    // Only one enemy, and an ally standing right next to it — any burst that
    // hits the enemy also hits the ally → score 0. AI should approach instead.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const ally = createTestUnit({ unitId: "ally", team: "b", x: 8, y: 8 });
    const enemy = createTestUnit({ unitId: "enemy", team: "a", x: 8, y: 9 });
    const battle = createTestBattle({
      units: { ai, ally, enemy },
      turnOrder: ["ai", "ally", "enemy"],
      turnIndex: 0,
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.fireball"), ctx("spell.fireball", burstEntry));

    expect(cmd["type"]).toBe("move");
  });

  it("falls back to end_turn when no contentContext is supplied", () => {
    // cast_area_entry_best needs to introspect the entry's area shape. No
    // context = can't know the shape = don't guess.
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const enemy = createTestUnit({ unitId: "enemy", team: "a", x: 5, y: 5 });
    const battle = createTestBattle({
      units: { ai, enemy },
      turnOrder: ["ai", "enemy"],
      turnIndex: 0,
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.fireball"));

    // With an enemy present but no spec, it approaches
    expect(["move", "end_turn"]).toContain(cmd["type"]);
  });

  it("falls back when the entry has no area block", () => {
    const singleTarget: ResolvedEntry = {
      ...burstEntry,
      payload: { ...burstEntry.payload, area: undefined },
    };
    delete (singleTarget.payload as Record<string, unknown>)["area"];

    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const enemy = createTestUnit({ unitId: "enemy", team: "a", x: 5, y: 5 });
    const battle = createTestBattle({
      units: { ai, enemy },
      turnOrder: ["ai", "enemy"],
      turnIndex: 0,
    });

    const cmd = getAiCommand(battle, areaPolicy("spell.missile"), ctx("spell.missile", singleTarget));

    expect(["move", "end_turn"]).toContain(cmd["type"]);
  });

  it("is deterministic — same state → same aim", () => {
    const ai = createTestUnit({ unitId: "ai", team: "b", x: 0, y: 0 });
    const e1 = createTestUnit({ unitId: "e1", team: "a", x: 5, y: 5 });
    const e2 = createTestUnit({ unitId: "e2", team: "a", x: 5, y: 6 });
    const mk = () => createTestBattle({
      units: { ai, e1, e2 },
      turnOrder: ["ai", "e1", "e2"],
      turnIndex: 0,
    });

    const a = getAiCommand(mk(), areaPolicy("spell.fireball"), ctx("spell.fireball", burstEntry));
    const b = getAiCommand(mk(), areaPolicy("spell.fireball"), ctx("spell.fireball", burstEntry));

    expect(a).toEqual(b);
  });
});
