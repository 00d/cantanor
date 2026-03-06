/**
 * Pure trigger detection functions for the reaction system.
 *
 * These are called by the store layer after each command to check if any
 * reactions should be queued. Triggers are returned sorted by unitId for
 * deterministic ordering.
 *
 * Reaction types:
 *   - attack_of_opportunity: triggers when enemy uses move action in reactor's melee reach
 *   - reactive_strike: same as AoO (future: also on concentrate/manipulate)
 *   - shield_block: triggers when reactor takes physical damage with shield raised
 */

import { BattleState, unitAlive, resolveWeapon } from "./state";
import { hasLineOfSight } from "../grid/los";

export interface ReactionTrigger {
  /** The unit that may react. */
  reactorId: string;
  /** The reaction type. */
  reactionType: string;
  /** The unit that provoked the reaction. */
  provokerId: string;
  /** Extra data for the reaction (e.g. damage amount for shield block). */
  data?: Record<string, unknown>;
}

/**
 * Detect move-provoked reactions (Attack of Opportunity / Reactive Strike).
 * Called after a move command succeeds. `fromX/fromY` is the position the
 * mover was at BEFORE moving (the reactor needs to have had reach to the
 * mover's previous position).
 */
export function detectMoveReactions(
  state: BattleState,
  moverId: string,
  fromX: number,
  fromY: number,
): ReactionTrigger[] {
  const mover = state.units[moverId];
  if (!mover || !unitAlive(mover)) return [];

  const triggers: ReactionTrigger[] = [];

  for (const unit of Object.values(state.units)) {
    if (unit.unitId === moverId) continue;
    if (!unitAlive(unit)) continue;
    if (unit.team === mover.team) continue; // only enemies react
    if (!unit.reactionAvailable) continue;
    if (!unit.reactions || unit.reactions.length === 0) continue;

    // Check for AoO or Reactive Strike
    const hasAoO = unit.reactions.includes("attack_of_opportunity") ||
                   unit.reactions.includes("reactive_strike");
    if (!hasAoO) continue;

    // Reactor must have melee reach to the mover's FROM position
    const weapon = resolveWeapon(unit);
    if (weapon.type !== "melee") continue;
    const reach = weapon.reach ?? 1;
    const dist = Math.max(Math.abs(unit.x - fromX), Math.abs(unit.y - fromY));
    if (dist > reach) continue;

    // Reactor must have LOS to the mover (at current position)
    if (!hasLineOfSight(state, unit, mover)) continue;

    const reactionType = unit.reactions.includes("attack_of_opportunity")
      ? "attack_of_opportunity"
      : "reactive_strike";

    triggers.push({
      reactorId: unit.unitId,
      reactionType,
      provokerId: moverId,
    });
  }

  // Sort by unitId for deterministic ordering
  triggers.sort((a, b) => a.reactorId.localeCompare(b.reactorId));
  return triggers;
}

/**
 * Detect damage-provoked reactions (Shield Block).
 * Called after a strike or damage command deals physical damage to a unit.
 */
export function detectDamageReactions(
  state: BattleState,
  targetId: string,
  damageAmount: number,
  damageType: string,
): ReactionTrigger[] {
  const target = state.units[targetId];
  if (!target || !unitAlive(target)) return [];
  if (damageAmount <= 0) return [];

  const triggers: ReactionTrigger[] = [];

  // Shield Block: target must have shield raised, reaction available, and
  // the reaction type. Only blocks physical damage.
  if (
    target.reactions?.includes("shield_block") &&
    target.reactionAvailable &&
    target.shieldRaised &&
    target.shieldHp != null && target.shieldHp > 0 &&
    isPhysicalDamage(damageType)
  ) {
    triggers.push({
      reactorId: targetId,
      reactionType: "shield_block",
      provokerId: targetId, // self-targeted
      data: { damageAmount, damageType },
    });
  }

  return triggers;
}

function isPhysicalDamage(damageType: string): boolean {
  const physical = ["physical", "slashing", "piercing", "bludgeoning"];
  return physical.includes(damageType.toLowerCase());
}
