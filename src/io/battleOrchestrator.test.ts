/**
 * Tests for materializeRawCommand — specifically the cast_spell →
 * area_save_damage rewrite that fires when a content entry's payload carries
 * an `area` block (Phase 14 M3.2).
 *
 * The single-target merge path (no area) is exercised transitively by the
 * scenarioRunner regression suite. These tests focus on the rewrite branch:
 * does it produce exactly the wire format the reducer's area_save_damage
 * handler reads, and does it stay out of the way for non-area spells?
 */

import { describe, it, expect } from "vitest";
import { materializeRawCommand } from "./battleOrchestrator";
import type { ContentContext, ResolvedEntry } from "./contentPackLoader";
import { ReductionError } from "../engine/reducer";

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

    // These are the exact keys the reducer's area_save_damage handler reads.
    // If any of them are missing or misnamed the reducer won't throw — it
    // will silently read undefined → NaN → hit nobody. So assert each one.
    expect(cmd["type"]).toBe("area_save_damage");
    expect(cmd["actor"]).toBe("hero");
    expect(cmd["center_x"]).toBe(5);
    expect(cmd["center_y"]).toBe(7);
    expect(cmd["radius_feet"]).toBe(20);
    expect(cmd["save_type"]).toBe("Reflex");
    expect(cmd["mode"]).toBe("basic");
    expect(cmd["damage"]).toBe("6d6");
    expect(cmd["damage_type"]).toBe("fire");
    expect(cmd["dc"]).toBe(20);
  });

  it("scrubs fields the area reducer path doesn't read", () => {
    // The area_save_damage handler ignores unknown keys, so leaving these in
    // is technically harmless to execution. They're scrubbed anyway so the
    // event log doesn't carry misleading noise — a Fireball event with a
    // `target` field would read like a single-target cast.
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

  it("throws on an unknown area shape", () => {
    // Forward-compat guard — the schema carries `shape` so line/cone have
    // somewhere to hang, but today only burst is wired. A cone entry should
    // fail loud, not silently fall through to the single-target path.
    const coneSpell: ResolvedEntry = {
      ...fireball,
      payload: { ...fireball.payload, area: { shape: "cone", radius_feet: 15 } },
    };
    expect(() =>
      materializeRawCommand(
        {
          type: "cast_spell",
          actor: "hero",
          center_x: 1,
          center_y: 1,
          content_entry_id: "spell.dragonbreath",
        },
        ctx("spell.dragonbreath", coneSpell),
      ),
    ).toThrow(/only 'burst'/);
  });

  it("leaves non-area spells untouched", () => {
    // Regression guard for every existing single-target entry in the content
    // pack. The rewrite branch is gated on payloadTemplate.area — absent
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
    // Make sure nobody can inject an area block through the dispatch call
    // and turn a single-target spell into an AoE at runtime. The rewrite
    // gate reads payloadTemplate.area — i.e. the content-pack author's
    // declaration — not the merged command.
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
