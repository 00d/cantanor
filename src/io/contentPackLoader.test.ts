/**
 * Tests for content pack loading and validation.
 * Ported from tests/contract/test_content_pack_loader.py
 *
 * These tests validate:
 * - Content pack JSON schema validation
 * - Duplicate entry detection
 * - Version validation (semver)
 * - Engine phase compatibility
 */

import { describe, test, expect } from "vitest";
import {
  validateContentPack,
  parseContentPack,
  contentPackSupportsPhase,
  buildContentEntryLookup,
  ContentPackValidationError,
  ContentPackResolutionError,
} from "./contentPackLoader";

function validPack(): Record<string, unknown> {
  return {
    pack_id: "phase7-test-pack",
    version: "1.0.0",
    compatibility: {
      min_engine_phase: 7,
      max_engine_phase: 8,
      feature_tags: ["test"],
    },
    entries: [
      {
        id: "spell.arc_flash",
        kind: "spell",
        payload: { command_type: "cast_spell" },
      },
    ],
  };
}

describe("Content Pack Validation", () => {
  test("validate content pack accepts valid shape", () => {
    expect(() => validateContentPack(validPack())).not.toThrow();
  });

  test("validate content pack rejects duplicate entry ids", () => {
    const pack = validPack();
    (pack["entries"] as Array<unknown>).push({
      id: "spell.arc_flash", // Duplicate
      kind: "spell",
      payload: { command_type: "cast_spell" },
    });

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/duplicate entry id/);
  });

  test("validate content pack rejects invalid semver", () => {
    const pack = validPack();
    pack["version"] = "v1"; // Not semver

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/semver/);
  });

  test("validate content pack rejects bad phase bounds", () => {
    const pack = validPack();
    const compat = pack["compatibility"] as Record<string, unknown>;
    compat["min_engine_phase"] = 9;
    compat["max_engine_phase"] = 7; // min > max

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/cannot exceed/);
  });

  test("validate content pack requires pack_id", () => {
    const pack = validPack();
    delete pack["pack_id"];

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/missing key: pack_id/);
  });

  test("validate content pack requires version", () => {
    const pack = validPack();
    delete pack["version"];

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/missing key: version/);
  });

  test("validate content pack requires compatibility", () => {
    const pack = validPack();
    delete pack["compatibility"];

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/missing key: compatibility/);
  });

  test("validate content pack requires entries", () => {
    const pack = validPack();
    delete pack["entries"];

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/missing key: entries/);
  });

  test("validate content pack rejects empty entries", () => {
    const pack = validPack();
    pack["entries"] = [];

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/non-empty list/);
  });

  test("validate content pack rejects invalid kind", () => {
    const pack = validPack();
    (pack["entries"] as Array<Record<string, unknown>>)[0]["kind"] = "invalid_kind";

    expect(() => validateContentPack(pack)).toThrow(ContentPackValidationError);
    expect(() => validateContentPack(pack)).toThrow(/kind invalid/);
  });
});

describe("Content Pack Parsing", () => {
  test("parse content pack converts snake_case to camelCase", () => {
    const pack = parseContentPack(validPack());

    expect(pack.packId).toBe("phase7-test-pack");
    expect(pack.version).toBe("1.0.0");
    expect(pack.compatibility.minEnginePhase).toBe(7);
    expect(pack.compatibility.maxEnginePhase).toBe(8);
    expect(pack.compatibility.featureTags).toEqual(["test"]);
    expect(pack.entries.length).toBe(1);
    expect(pack.entries[0].id).toBe("spell.arc_flash");
    expect(pack.entries[0].kind).toBe("spell");
  });

  test("parse content pack handles optional fields", () => {
    const packData = validPack();
    (packData["entries"] as Array<Record<string, unknown>>)[0]["source_ref"] = "CRB p.123";
    (packData["entries"] as Array<Record<string, unknown>>)[0]["tags"] = ["fire", "evocation"];

    const pack = parseContentPack(packData);

    expect(pack.entries[0].sourceRef).toBe("CRB p.123");
    expect(pack.entries[0].tags).toEqual(["fire", "evocation"]);
  });
});

describe("Content Pack Phase Support", () => {
  test("content pack supports phase within bounds", () => {
    const pack = parseContentPack(validPack());

    expect(contentPackSupportsPhase(pack, 7)).toBe(true);
    expect(contentPackSupportsPhase(pack, 8)).toBe(true);
  });

  test("content pack does not support phase outside bounds", () => {
    const pack = parseContentPack(validPack());

    expect(contentPackSupportsPhase(pack, 6)).toBe(false);
    expect(contentPackSupportsPhase(pack, 9)).toBe(false);
  });

  test("content pack supports phase at boundaries", () => {
    const pack = parseContentPack(validPack());
    pack.compatibility.minEnginePhase = 5;
    pack.compatibility.maxEnginePhase = 10;

    expect(contentPackSupportsPhase(pack, 5)).toBe(true); // Min boundary
    expect(contentPackSupportsPhase(pack, 10)).toBe(true); // Max boundary
    expect(contentPackSupportsPhase(pack, 4)).toBe(false);
    expect(contentPackSupportsPhase(pack, 11)).toBe(false);
  });
});

describe("Content Entry Lookup", () => {
  test("build content entry lookup creates id-to-entry map", () => {
    const pack = parseContentPack(validPack());
    const lookup = buildContentEntryLookup([pack]);

    expect(lookup["spell.arc_flash"]).toBeDefined();
    expect(lookup["spell.arc_flash"].packId).toBe("phase7-test-pack");
    expect(lookup["spell.arc_flash"].kind).toBe("spell");
    expect(lookup["spell.arc_flash"].payload).toEqual({ command_type: "cast_spell" });
  });

  test("build content entry lookup merges multiple packs", () => {
    const pack1 = parseContentPack(validPack());

    const pack2Data = validPack();
    pack2Data["pack_id"] = "phase8-test-pack";
    (pack2Data["entries"] as Array<unknown>)[0] = {
      id: "spell.lightning_bolt",
      kind: "spell",
      payload: { command_type: "cast_spell" },
    };
    const pack2 = parseContentPack(pack2Data);

    const lookup = buildContentEntryLookup([pack1, pack2]);

    expect(lookup["spell.arc_flash"]).toBeDefined();
    expect(lookup["spell.lightning_bolt"]).toBeDefined();
    expect(lookup["spell.arc_flash"].packId).toBe("phase7-test-pack");
    expect(lookup["spell.lightning_bolt"].packId).toBe("phase8-test-pack");
  });

  test("build content entry lookup rejects duplicate entry ids across packs", () => {
    const pack1 = parseContentPack(validPack());
    const pack2 = parseContentPack(validPack());
    pack2.packId = "duplicate-pack";

    expect(() => buildContentEntryLookup([pack1, pack2])).toThrow(ContentPackResolutionError);
    expect(() => buildContentEntryLookup([pack1, pack2])).toThrow(/duplicate entry id/);
  });

  test("build content entry lookup preserves entry metadata", () => {
    const packData = validPack();
    (packData["entries"] as Array<Record<string, unknown>>)[0]["source_ref"] = "CRB p.123";
    (packData["entries"] as Array<Record<string, unknown>>)[0]["tags"] = ["fire", "evocation"];
    const pack = parseContentPack(packData);

    const lookup = buildContentEntryLookup([pack]);

    expect(lookup["spell.arc_flash"].sourceRef).toBe("CRB p.123");
    expect(lookup["spell.arc_flash"].tags).toEqual(["fire", "evocation"]);
  });

  test("build content entry lookup returns sorted keys", () => {
    const packData = validPack();
    packData["entries"] = [
      { id: "spell.zap", kind: "spell", payload: {} },
      { id: "spell.arc_flash", kind: "spell", payload: {} },
      { id: "spell.fireball", kind: "spell", payload: {} },
    ];
    const pack = parseContentPack(packData);

    const lookup = buildContentEntryLookup([pack]);
    const keys = Object.keys(lookup);

    expect(keys).toEqual(["spell.arc_flash", "spell.fireball", "spell.zap"]);
  });
});
