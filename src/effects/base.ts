/**
 * Effect object contracts.
 * Mirrors engine/effects/base.py
 */

export interface Effect {
  effectId: string;
  kind: string;
  sourceUnitId: string | null;
  targetUnitId: string | null;
  payload: Record<string, unknown>;
  durationRounds: number | null;
}
