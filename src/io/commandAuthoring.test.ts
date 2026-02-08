/**
 * Tests for command authoring helpers.
 * Ported from tests/contract/test_command_authoring.py
 *
 * These tests validate:
 * - Content entry listing and filtering
 * - UI command intent building
 * - Command type validation
 * - Target defaulting for different command types
 */

import { describe, test, expect, beforeAll } from "vitest";
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import {
  listContentEntryOptions,
  buildUiCommandIntent,
  buildCommandAuthoringCatalog,
  CommandAuthoringError,
} from "./commandAuthoring";
import { parseContentPack, buildContentEntryLookup, type ContentContext } from "./contentPackLoader";

let phase8Context: ContentContext;

beforeAll(async () => {
  // Load phase7_baseline_v1.json content pack
  const packPath = resolve(dirname(import.meta.url.replace('file://', '')), '../../corpus/content_packs/phase7_baseline_v1.json');
  const packContent = await readFile(packPath, 'utf-8');
  const packData = JSON.parse(packContent);
  const pack = parseContentPack(packData);

  phase8Context = {
    selectedPackId: pack.packId,
    packs: [
      {
        packId: pack.packId,
        version: pack.version,
        entryCount: pack.entries.length,
        compatibility: pack.compatibility,
      },
    ],
    entryLookup: buildContentEntryLookup([pack]),
  };
});

describe("Content Entry Options", () => {
  test("list content entry options filters template entries", () => {
    const options = listContentEntryOptions(phase8Context);
    const optionIds = options.map((o) => o.entryId);

    expect(optionIds).toContain("spell.arc_flash");
    expect(optionIds).toContain("feat.quick_patch");
    expect(optionIds).toContain("item.battle_tonic");
  });

  test("list content entry options returns sorted entries", () => {
    const options = listContentEntryOptions(phase8Context);
    const optionIds = options.map((o) => o.entryId);

    // Should be sorted alphabetically
    for (let i = 1; i < optionIds.length; i++) {
      expect(optionIds[i] >= optionIds[i - 1]).toBe(true);
    }
  });

  test("list content entry options filters by command type", () => {
    const spellOptions = listContentEntryOptions(phase8Context, "cast_spell");
    const spellIds = spellOptions.map((o) => o.entryId);

    expect(spellIds).toContain("spell.arc_flash");
    expect(spellIds.every((id) => id.startsWith("spell."))).toBe(true);
  });

  test("list content entry options includes metadata", () => {
    const options = listContentEntryOptions(phase8Context);
    const arcFlash = options.find((o) => o.entryId === "spell.arc_flash");

    expect(arcFlash).toBeDefined();
    expect(arcFlash!.commandType).toBe("cast_spell");
    expect(arcFlash!.kind).toBe("spell");
    expect(arcFlash!.packId).toBe("phase7-baseline-v1");
  });
});

describe("Build UI Command Intent", () => {
  test("build cast_spell intent", () => {
    const intent = buildUiCommandIntent(phase8Context, {
      actor: "enemy_caster",
      commandType: "cast_spell",
      contentEntryId: "spell.arc_flash",
      target: "pc_target",
      dc: 22,
    });

    expect(intent.sourcePackId).toBe("phase7-baseline-v1");
    expect(intent.command["type"]).toBe("cast_spell");
    expect(intent.command["actor"]).toBe("enemy_caster");
    expect(intent.command["content_entry_id"]).toBe("spell.arc_flash");
    expect(intent.command["target"]).toBe("pc_target");
    expect(intent.command["dc"]).toBe(22);
  });

  test("build use_feat intent defaults target to actor", () => {
    const intent = buildUiCommandIntent(phase8Context, {
      actor: "bard",
      commandType: "use_feat",
      contentEntryId: "feat.quick_patch",
    });

    expect(intent.command["target"]).toBe("bard");
  });

  test("build use_feat intent allows explicit target", () => {
    const intent = buildUiCommandIntent(phase8Context, {
      actor: "bard",
      commandType: "use_feat",
      contentEntryId: "feat.quick_patch",
      target: "wounded_ally",
    });

    expect(intent.command["target"]).toBe("wounded_ally");
  });

  test("build use_item intent defaults target to actor", () => {
    const intent = buildUiCommandIntent(phase8Context, {
      actor: "fighter",
      commandType: "use_item",
      contentEntryId: "item.battle_tonic",
    });

    expect(intent.command["target"]).toBe("fighter");
  });

  test("rejects command type mismatch", () => {
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "feat.quick_patch", // Feat, not spell
        target: "pc",
        dc: 20,
      })
    ).toThrow(CommandAuthoringError);
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "feat.quick_patch",
        target: "pc",
        dc: 20,
      })
    ).toThrow(/mismatch/);
  });

  test("rejects unknown content entry", () => {
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.nonexistent",
        target: "pc",
        dc: 20,
      })
    ).toThrow(CommandAuthoringError);
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.nonexistent",
        target: "pc",
        dc: 20,
      })
    ).toThrow(/unknown content entry/);
  });

  test("cast_spell requires target", () => {
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.arc_flash",
        dc: 20,
      })
    ).toThrow(CommandAuthoringError);
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.arc_flash",
        dc: 20,
      })
    ).toThrow(/requires target/);
  });

  test("cast_spell requires dc", () => {
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.arc_flash",
        target: "pc",
      })
    ).toThrow(CommandAuthoringError);
    expect(() =>
      buildUiCommandIntent(phase8Context, {
        actor: "caster",
        commandType: "cast_spell",
        contentEntryId: "spell.arc_flash",
        target: "pc",
      })
    ).toThrow(/requires positive dc/);
  });
});

describe("Command Authoring Catalog", () => {
  test("build command authoring catalog", () => {
    const catalog = buildCommandAuthoringCatalog(phase8Context);

    expect(catalog.templateCommandTypes).toContain("cast_spell");
    expect(catalog.templateCommandTypes).toContain("use_feat");
    expect(catalog.templateCommandTypes).toContain("use_item");
    expect(catalog.templateCommandTypes).toContain("interact");
    expect(catalog.options.length).toBeGreaterThanOrEqual(3);
  });

  test("catalog options match listContentEntryOptions", () => {
    const catalog = buildCommandAuthoringCatalog(phase8Context);
    const directOptions = listContentEntryOptions(phase8Context);

    expect(catalog.options.length).toBe(directOptions.length);
    expect(catalog.options.map((o) => o.entryId)).toEqual(
      directOptions.map((o) => o.entryId)
    );
  });
});
