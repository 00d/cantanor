import { describe, it, expect } from "vitest";
import type { WeaponData } from "./state";
import {
  hasTrait,
  traitValue,
  isAgile,
  mapPenalty,
  volleyPenalty,
  deadlyDice,
  fatalDice,
  thrownRange,
} from "./traits";

function weapon(traits?: string[]): WeaponData {
  return {
    name: "test",
    type: "melee",
    attackMod: 5,
    damage: "1d8",
    damageType: "slashing",
    traits,
  };
}

describe("hasTrait", () => {
  it("returns true when trait present", () => {
    expect(hasTrait(weapon(["agile", "deadly_d10"]), "agile")).toBe(true);
  });
  it("returns false when trait absent", () => {
    expect(hasTrait(weapon(["deadly_d10"]), "agile")).toBe(false);
  });
  it("returns false when no traits array", () => {
    expect(hasTrait(weapon(), "agile")).toBe(false);
  });
  it("returns false for empty traits", () => {
    expect(hasTrait(weapon([]), "agile")).toBe(false);
  });
});

describe("traitValue", () => {
  it("extracts deadly_d10 → 10", () => {
    expect(traitValue(weapon(["deadly_d10"]), "deadly_d")).toBe(10);
  });
  it("extracts volley_30 → 30", () => {
    expect(traitValue(weapon(["volley_30"]), "volley_")).toBe(30);
  });
  it("extracts thrown_4 → 4", () => {
    expect(traitValue(weapon(["thrown_4"]), "thrown_")).toBe(4);
  });
  it("returns null when no match", () => {
    expect(traitValue(weapon(["agile"]), "deadly_d")).toBeNull();
  });
  it("returns null when no traits", () => {
    expect(traitValue(weapon(), "deadly_d")).toBeNull();
  });
});

describe("isAgile", () => {
  it("true for agile weapon", () => {
    expect(isAgile(weapon(["agile"]))).toBe(true);
  });
  it("false for non-agile weapon", () => {
    expect(isAgile(weapon(["deadly_d10"]))).toBe(false);
  });
});

describe("mapPenalty", () => {
  it("0 on first attack (non-agile)", () => {
    expect(mapPenalty(0, false)).toBe(0);
  });
  it("-5 on second attack (non-agile)", () => {
    expect(mapPenalty(1, false)).toBe(-5);
  });
  it("-10 on third+ attack (non-agile)", () => {
    expect(mapPenalty(2, false)).toBe(-10);
    expect(mapPenalty(5, false)).toBe(-10);
  });
  it("0 on first attack (agile)", () => {
    expect(mapPenalty(0, true)).toBe(0);
  });
  it("-4 on second attack (agile)", () => {
    expect(mapPenalty(1, true)).toBe(-4);
  });
  it("-8 on third+ attack (agile)", () => {
    expect(mapPenalty(2, true)).toBe(-8);
    expect(mapPenalty(5, true)).toBe(-8);
  });
});

describe("volleyPenalty", () => {
  it("-2 within volley range", () => {
    expect(volleyPenalty(weapon(["volley_30"]), 20)).toBe(-2);
    expect(volleyPenalty(weapon(["volley_30"]), 30)).toBe(-2);
  });
  it("0 beyond volley range", () => {
    expect(volleyPenalty(weapon(["volley_30"]), 31)).toBe(0);
  });
  it("0 when no volley trait", () => {
    expect(volleyPenalty(weapon(["agile"]), 5)).toBe(0);
  });
});

describe("deadlyDice", () => {
  it("returns die size from deadly_d10", () => {
    expect(deadlyDice(weapon(["deadly_d10"]))).toBe(10);
  });
  it("returns null when absent", () => {
    expect(deadlyDice(weapon(["agile"]))).toBeNull();
  });
});

describe("fatalDice", () => {
  it("returns die size from fatal_d12", () => {
    expect(fatalDice(weapon(["fatal_d12"]))).toBe(12);
  });
  it("returns null when absent", () => {
    expect(fatalDice(weapon())).toBeNull();
  });
});

describe("thrownRange", () => {
  it("returns range from thrown_4", () => {
    expect(thrownRange(weapon(["thrown_4"]))).toBe(4);
  });
  it("returns null when absent", () => {
    expect(thrownRange(weapon(["agile"]))).toBeNull();
  });
});
