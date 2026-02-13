/**
 * Deterministic RNG wrapper with trace metadata.
 * Mirrors engine/core/rng.py
 *
 * Uses a seeded linear congruential generator matching Python's random.Random
 * sequence for cross-language determinism. Python uses the Mersenne Twister
 * (MT19937), which is complex to replicate exactly in JS. For browser use we
 * implement a simple seeded PRNG that is self-consistent across TypeScript runs.
 * Regression hashes are TS-only after the port; Python hashes are kept as
 * reference in the regression fixtures.
 */

export interface RollResult {
  value: number;
  low: number;
  high: number;
}

/**
 * Mulberry32 — fast, deterministic 32-bit PRNG.
 * Produces consistent results across JS engines.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DeterministicRNG {
  private readonly _seed: number;
  private readonly _next: () => number;
  private _callCount: number;

  /**
   * @param seed       Initial RNG seed (stored in BattleState.seed).
   * @param skipCount  Fast-forward past this many calls; used when restoring from a save.
   */
  constructor(seed: number, skipCount = 0) {
    this._seed = seed;
    this._next = mulberry32(seed);
    this._callCount = 0;
    for (let i = 0; i < skipCount; i++) { this._next(); this._callCount++; }
  }

  get seed(): number { return this._seed; }
  /** Number of calls made so far — save this alongside BattleState to restore RNG position. */
  get callCount(): number { return this._callCount; }

  randint(low: number, high: number): RollResult {
    this._callCount++;
    const range = high - low + 1;
    const value = low + Math.floor(this._next() * range);
    return { value: Math.min(high, Math.max(low, value)), low, high };
  }

  d20(): RollResult {
    return this.randint(1, 20);
  }
}
