/**
 * area_save_damage reducer — shape branch coverage.
 *
 * Burst was exercised by the Phase-15 interactive path; these tests cover the
 * cone/line branches added in C1 and pin the back-compat behaviour for
 * dispatches without a shape field (default → burst).
 */

import { describe, it, expect } from "vitest";
import { applyCommand } from "./reducer";
import { createTestUnit, createTestBattle, createTestRNG } from "../test-utils/fixtures";

/** area_save_damage command skeleton. */
function areaCmd(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "area_save_damage",
    actor: "caster",
    save_type: "Reflex",
    mode: "basic",
    damage: "1d1+9",       // always 10 pre-multiplier
    damage_type: "fire",
    dc: 15,
    ...over,
  };
}

describe("area_save_damage — shape branches", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Burst back-compat
  // ─────────────────────────────────────────────────────────────────────────

  it("defaults to burst when shape is absent (back-compat)", () => {
    // Caster at (0,0), centre (5,5). Enemy at centre, ally 2 tiles out (also
    // in a 20ft=4-tile diamond). Both take damage; event shape is "burst".
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 0, y: 0 });
    const e1 = createTestUnit({ unitId: "e1", team: "b", x: 5, y: 5, hp: 20, reflex: -20 });
    const e2 = createTestUnit({ unitId: "e2", team: "b", x: 6, y: 6, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, e1, e2 },
      turnOrder: ["caster", "e1", "e2"],
    });

    const [next, events] = applyCommand(
      battle,
      areaCmd({ center_x: 5, center_y: 5, radius_feet: 20 /* no shape */ }),
      createTestRNG(),
    );

    // Both enemies hit (e2 is at Manhattan 2 from centre, well within 4-tile radius)
    expect(next.units["e1"].hp).toBeLessThan(20);
    expect(next.units["e2"].hp).toBeLessThan(20);

    const ev = events.find((e) => e["type"] === "area_save_damage")!;
    expect((ev["payload"] as Record<string, unknown>)["shape"]).toBe("burst");
  });

  it("burst measures LoE from the centre, not the caster", () => {
    // Wall between caster and centre — burst still hits because it's the
    // centre→target LoE that matters.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 0, y: 0 });
    const enemy = createTestUnit({ unitId: "enemy", team: "b", x: 5, y: 5, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, enemy },
      turnOrder: ["caster", "enemy"],
      battleMap: { width: 10, height: 10, blocked: [[2, 2]] },
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 5, center_y: 5, radius_feet: 5, shape: "burst" }),
      createTestRNG(),
    );

    expect(next.units["enemy"].hp).toBeLessThan(20);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cone
  // ─────────────────────────────────────────────────────────────────────────

  it("cone hits enemies in the fan, excludes those behind", () => {
    // Caster at (5,5), aims east at (8,5). 15ft cone = 3 tiles.
    // e1 at (7,5) is straight ahead → hit.
    // e2 at (3,5) is behind the caster → NOT hit.
    // e3 at (7,6) is off-axis but within 45° → hit.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 5, y: 5 });
    const e1 = createTestUnit({ unitId: "e1", team: "b", x: 7, y: 5, hp: 20, reflex: -20 });
    const e2 = createTestUnit({ unitId: "e2", team: "b", x: 3, y: 5, hp: 20, reflex: -20 });
    const e3 = createTestUnit({ unitId: "e3", team: "b", x: 7, y: 6, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, e1, e2, e3 },
      turnOrder: ["caster", "e1", "e2", "e3"],
      battleMap: { width: 15, height: 15, blocked: [] },
    });

    const [next, events] = applyCommand(
      battle,
      areaCmd({ center_x: 8, center_y: 5, radius_feet: 15, shape: "cone" }),
      createTestRNG(),
    );

    expect(next.units["e1"].hp).toBeLessThan(20);   // ahead
    expect(next.units["e2"].hp).toBe(20);           // behind — untouched
    expect(next.units["e3"].hp).toBeLessThan(20);   // off-axis within fan

    const ev = events.find((e) => e["type"] === "area_save_damage")!;
    const p = ev["payload"] as Record<string, unknown>;
    expect(p["shape"]).toBe("cone");
    expect((p["targets"] as string[]).sort()).toEqual(["e1", "e3"]);
  });

  it("cone excludes the caster by default", () => {
    // conePoints includes the origin tile, but include_actor default (false)
    // means the caster never appears in targets.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 5, y: 5, hp: 30 });
    const e1 = createTestUnit({ unitId: "e1", team: "b", x: 7, y: 5, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, e1 },
      turnOrder: ["caster", "e1"],
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 8, center_y: 5, radius_feet: 15, shape: "cone" }),
      createTestRNG(),
    );

    expect(next.units["caster"].hp).toBe(30);  // untouched
    expect(next.units["e1"].hp).toBeLessThan(20);
  });

  it("cone respects LoE from the caster — enemy behind a wall is spared", () => {
    // Caster at (5,5), aims east. Wall at (7,5). Enemy at (8,5) — inside the
    // cone geometry but blocked by the wall.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 5, y: 5 });
    const enemy = createTestUnit({ unitId: "enemy", team: "b", x: 8, y: 5, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, enemy },
      turnOrder: ["caster", "enemy"],
      battleMap: { width: 15, height: 15, blocked: [[7, 5]] },
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 10, center_y: 5, radius_feet: 20, shape: "cone" }),
      createTestRNG(),
    );

    expect(next.units["enemy"].hp).toBe(20);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Line
  // ─────────────────────────────────────────────────────────────────────────

  it("line extends to full length even when aim point is close", () => {
    // Caster at (0,2), aims 1 tile east at (1,2). 30ft line = 6 tiles.
    // Enemies at (3,2) and (6,2) — both inside the 6-tile extension.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 0, y: 2 });
    const e1 = createTestUnit({ unitId: "e1", team: "b", x: 3, y: 2, hp: 20, reflex: -20 });
    const e2 = createTestUnit({ unitId: "e2", team: "b", x: 6, y: 2, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, e1, e2 },
      turnOrder: ["caster", "e1", "e2"],
      battleMap: { width: 15, height: 5, blocked: [] },
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 1, center_y: 2, radius_feet: 30, shape: "line" }),
      createTestRNG(),
    );

    expect(next.units["e1"].hp).toBeLessThan(20);
    expect(next.units["e2"].hp).toBeLessThan(20);
  });

  it("line stops at a blocked tile", () => {
    // Caster at (0,2), aims east. Wall at (4,2). Enemy at (3,2) → hit.
    // Enemy at (5,2) is past the wall → NOT hit.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 0, y: 2 });
    const e1 = createTestUnit({ unitId: "e1", team: "b", x: 3, y: 2, hp: 20, reflex: -20 });
    const e2 = createTestUnit({ unitId: "e2", team: "b", x: 5, y: 2, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, e1, e2 },
      turnOrder: ["caster", "e1", "e2"],
      battleMap: { width: 15, height: 5, blocked: [[4, 2]] },
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 8, center_y: 2, radius_feet: 30, shape: "line" }),
      createTestRNG(),
    );

    expect(next.units["e1"].hp).toBeLessThan(20);
    expect(next.units["e2"].hp).toBe(20);         // past the wall
  });

  it("line excludes the caster tile", () => {
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 2, y: 2, hp: 30 });
    const enemy = createTestUnit({ unitId: "enemy", team: "b", x: 5, y: 2, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, enemy },
      turnOrder: ["caster", "enemy"],
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 5, center_y: 2, radius_feet: 30, shape: "line" }),
      createTestRNG(),
    );

    expect(next.units["caster"].hp).toBe(30);
    expect(next.units["enemy"].hp).toBeLessThan(20);
  });

  it("line truncates beyond length — enemy out of range is safe", () => {
    // 10ft line = 2 tiles. Enemy at 3 tiles out → not hit.
    const caster = createTestUnit({ unitId: "caster", team: "a", x: 0, y: 0 });
    const near = createTestUnit({ unitId: "near", team: "b", x: 2, y: 0, hp: 20, reflex: -20 });
    const far = createTestUnit({ unitId: "far", team: "b", x: 3, y: 0, hp: 20, reflex: -20 });
    const battle = createTestBattle({
      units: { caster, near, far },
      turnOrder: ["caster", "near", "far"],
    });

    const [next] = applyCommand(
      battle,
      areaCmd({ center_x: 5, center_y: 0, radius_feet: 10, shape: "line" }),
      createTestRNG(),
    );

    expect(next.units["near"].hp).toBeLessThan(20);
    expect(next.units["far"].hp).toBe(20);
  });
});
