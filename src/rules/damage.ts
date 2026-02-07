/**
 * Damage formula parsing and rolling.
 * Mirrors engine/rules/damage.py
 *
 * Pathfinder 2e ORC damage rules: resistances reduce, weaknesses increase,
 * immunities negate. Temp HP absorbs first.
 */

import { DeterministicRNG } from "../engine/rng";

const DAMAGE_RE = /^(\d+)d(\d+)([+-]\d+)?$/;
const FLAT_RE = /^[+-]?\d+$/;

const DAMAGE_TYPE_ALIASES: Record<string, string> = {
  lightning: "electricity",
  pierce: "piercing",
  slash: "slashing",
  bludgeon: "bludgeoning",
};

const PHYSICAL_TYPES = new Set(["bludgeoning", "piercing", "slashing"]);
const ENERGY_TYPES = new Set(["acid", "cold", "electricity", "fire", "force", "sonic"]);

export interface DamageRoll {
  formula: string;
  total: number;
  rolls: number[];
  flatModifier: number;
}

export interface DamageAdjustment {
  rawTotal: number;
  appliedTotal: number;
  damageType: string | null;
  immune: boolean;
  resistanceTotal: number;
  weaknessTotal: number;
}

export interface AppliedDamage {
  incomingTotal: number;
  absorbedByTempHp: number;
  hpLoss: number;
  newHp: number;
  newTempHp: number;
}

export function parseFormula(formula: string): [number, number, number] {
  const text = formula.trim();
  const match = DAMAGE_RE.exec(text);
  if (match) {
    const diceCount = parseInt(match[1], 10);
    const diceSize = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;
    return [diceCount, diceSize, modifier];
  }
  if (FLAT_RE.test(text)) {
    return [0, 1, parseInt(text, 10)];
  }
  throw new Error(`Unsupported damage formula: ${formula}`);
}

export function rollDamage(
  rng: DeterministicRNG,
  formula: string,
  multiplier = 1,
): DamageRoll {
  const [diceCount, diceSize, modifier] = parseFormula(formula);
  const rolls: number[] = [];
  for (let i = 0; i < diceCount; i++) {
    rolls.push(rng.randint(1, diceSize).value);
  }
  const total = (rolls.reduce((s, r) => s + r, 0) + modifier) * multiplier;
  return {
    formula,
    total: Math.max(0, total),
    rolls,
    flatModifier: modifier,
  };
}

function normalizedDamageType(raw: string | null | undefined): string | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return DAMAGE_TYPE_ALIASES[normalized] ?? normalized;
}

function damageTypeTags(damageType: string | null): Set<string> {
  const normalized = normalizedDamageType(damageType);
  if (normalized === null) return new Set();
  const tags = new Set([normalized]);
  if (PHYSICAL_TYPES.has(normalized)) tags.add("physical");
  if (ENERGY_TYPES.has(normalized)) tags.add("energy");
  return tags;
}

function highestMatchingModifier(
  modifiers: Record<string, number>,
  damageTags: Set<string>,
  bypassTags: Set<string>,
): number {
  let best = 0;
  for (const [key, value] of Object.entries(modifiers)) {
    const k = normalizedDamageType(key);
    if (k === null) continue;
    if (bypassTags.has("all") || bypassTags.has(k)) continue;
    if (k === "all" || damageTags.has(k)) {
      best = Math.max(best, Number(value));
    }
  }
  return Math.max(0, best);
}

export function applyDamageModifiers(opts: {
  rawTotal: number;
  damageType?: string | null;
  resistances: Record<string, number>;
  weaknesses: Record<string, number>;
  immunities: string[];
  bypass?: string[] | null;
}): DamageAdjustment {
  const raw = Math.max(0, Math.floor(opts.rawTotal));
  const normalizedType = normalizedDamageType(opts.damageType);
  const damageTags = damageTypeTags(normalizedType);
  const immunitySet = new Set(
    (opts.immunities || []).map((x) => normalizedDamageType(String(x)) ?? ""),
  );
  const bypassSet = new Set(
    (opts.bypass || []).map((x) => normalizedDamageType(String(x)) ?? ""),
  );

  if (raw === 0) {
    return {
      rawTotal: 0,
      appliedTotal: 0,
      damageType: normalizedType,
      immune: false,
      resistanceTotal: 0,
      weaknessTotal: 0,
    };
  }

  // Check immunity
  if (
    (immunitySet.has("all") && !bypassSet.has("all")) ||
    [...damageTags].some((tag) => immunitySet.has(tag) && !bypassSet.has(tag))
  ) {
    return {
      rawTotal: raw,
      appliedTotal: 0,
      damageType: normalizedType,
      immune: true,
      resistanceTotal: 0,
      weaknessTotal: 0,
    };
  }

  const resistanceTotal = highestMatchingModifier(
    opts.resistances,
    damageTags,
    bypassSet,
  );
  const weaknessTotal = highestMatchingModifier(opts.weaknesses, damageTags, new Set());

  const applied = Math.max(0, raw - resistanceTotal + weaknessTotal);
  return {
    rawTotal: raw,
    appliedTotal: applied,
    damageType: normalizedType,
    immune: false,
    resistanceTotal: Math.max(0, resistanceTotal),
    weaknessTotal: Math.max(0, weaknessTotal),
  };
}

export function applyDamageToPool(opts: {
  hp: number;
  tempHp: number;
  damageTotal: number;
}): AppliedDamage {
  const incoming = Math.max(0, Math.floor(opts.damageTotal));
  const currentHp = Math.max(0, Math.floor(opts.hp));
  const currentTemp = Math.max(0, Math.floor(opts.tempHp));
  const absorbed = Math.min(currentTemp, incoming);
  const hpLoss = Math.max(0, incoming - absorbed);
  return {
    incomingTotal: incoming,
    absorbedByTempHp: absorbed,
    hpLoss,
    newHp: Math.max(0, currentHp - hpLoss),
    newTempHp: Math.max(0, currentTemp - absorbed),
  };
}
