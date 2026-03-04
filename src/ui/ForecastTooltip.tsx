/**
 * Forecast tooltip — hit chance / expected damage preview.
 *
 * Shown while in strike target-mode when the player hovers over a valid enemy
 * tile. Reads the same `strikeForecast()` helper the headless scenario runner
 * uses, so the numbers match the engine exactly — including cover bonuses
 * and the Multiple Attack Penalty.
 *
 * Rendered as an absolutely-positioned React card anchored to the bottom-left
 * of the canvas area (not following the cursor — avoids flicker and keeps the
 * target highlight visible).
 */

import { useBattleStore } from "../store/battleStore";
import { activeUnitId, unitAlive, resolveWeapon } from "../engine/state";
import { strikeForecast } from "../engine/forecast";
import { adjustCoverForMelee, coverAcBonusFromGrade, coverGradeForUnits } from "../grid/loe";
import { isAgile, mapPenalty, volleyPenalty, deadlyDice, fatalDice, thrownRange } from "../engine/traits";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function ForecastTooltip() {
  const battle = useBattleStore((s) => s.battle);
  const targetMode = useBattleStore((s) => s.targetMode);
  const hover = useBattleStore((s) => s.hoveredTilePos);

  // Only render during strike target-mode with a hover target
  if (!battle || targetMode?.type !== "strike" || !hover) return null;

  const actorId = activeUnitId(battle);
  const actor = battle.units[actorId];
  if (!actor) return null;

  const [hx, hy] = hover;
  const target = Object.values(battle.units).find(
    (u) => u.x === hx && u.y === hy && u.team !== actor.team && unitAlive(u),
  );
  if (!target) return null;

  // Resolve weapon for forecast
  let weapon;
  try {
    weapon = resolveWeapon(actor, targetMode.weaponIndex);
  } catch {
    return null;
  }

  const dist = Math.max(Math.abs(actor.x - target.x), Math.abs(actor.y - target.y));

  // Ammo gate — don't show forecast when weapon has no ammo
  if (weapon.ammo != null) {
    const remaining = actor.weaponAmmo?.[targetMode.weaponIndex ?? 0] ?? 0;
    if (remaining <= 0) return null;
  }

  // Range/reach gate — don't show a forecast the player can't act on.
  const reach = weapon.reach ?? 1;
  const thrown = thrownRange(weapon);
  let rangePenalty = 0;
  let volPen = 0;
  if (weapon.type === "melee") {
    // Melee weapon — allow thrown fallback
    if (dist > reach) {
      if (thrown !== null && dist <= thrown) {
        // Thrown: no range increment penalty within thrown range
      } else {
        return null;
      }
    }
  } else {
    const rangeIncrement = weapon.rangeIncrement ?? 6;
    const maxRange = weapon.maxRange ?? rangeIncrement * 6;
    if (dist < 1 || dist > maxRange) return null;
    const incrementsPastFirst = Math.max(0, Math.ceil(dist / rangeIncrement) - 1);
    rangePenalty = incrementsPastFirst * -2;
  }
  volPen = volleyPenalty(weapon, dist);
  rangePenalty += volPen;

  // Determine effective weapon type for cover calculation
  const effectiveType: "melee" | "ranged" = weapon.type === "melee" && dist <= (weapon.reach ?? 1) ? "melee" : "ranged";
  const rawGrade = coverGradeForUnits(battle, actor, target);
  const adjustedGrade = adjustCoverForMelee(rawGrade, effectiveType, dist);
  const coverBonus = coverAcBonusFromGrade(adjustedGrade);
  const shieldBonus = target.shieldRaised ? 2 : 0;
  const weaponAgile = isAgile(weapon);
  const mapPen = mapPenalty(actor.attacksThisTurn, weaponAgile);
  const effectiveMod = weapon.attackMod + mapPen + rangePenalty;
  const effectiveAc = target.ac + coverBonus + shieldBonus;

  const f = strikeForecast(effectiveMod, effectiveAc, weapon.damage, {
    deadlyDie: deadlyDice(weapon),
    fatalDie: fatalDice(weapon),
    propulsiveMod: weapon.propulsiveMod ?? 0,
  });
  const odds = f["degree_odds"] as Record<string, number>;
  const dmg = f["expected_damage_raw"] as Record<string, number>;
  const hitChance = odds["success"] + odds["critical_success"];

  return (
    <div className="forecast-tooltip">
      <div className="forecast-header">
        <span className="forecast-actor">{actorId}</span>
        <span className="forecast-arrow">→</span>
        <span className="forecast-target">{target.unitId}</span>
      </div>
      <div className="forecast-hit">
        <span className="forecast-hit-pct">{pct(hitChance)}</span>
        <span className="forecast-hit-label">to hit</span>
        <span className="forecast-hit-crit">({pct(odds["critical_success"])} crit)</span>
      </div>
      <div className="forecast-dmg">
        ~{dmg["per_attack"].toFixed(1)} dmg/attack
        <span className="forecast-dmg-detail">
          ({dmg["on_success"]}/hit · {dmg["on_critical_success"]}/crit)
        </span>
      </div>
      <div className="forecast-mods">
        <span>+{weapon.attackMod}</span>
        {mapPen !== 0 && <span className="forecast-mod-map">{mapPen} MAP{weaponAgile ? " (agile)" : ""}</span>}
        {(rangePenalty - volPen) !== 0 && <span className="forecast-mod-range">{rangePenalty - volPen} range</span>}
        {volPen !== 0 && <span className="forecast-mod-range">{volPen} volley</span>}
        <span>vs AC {target.ac}</span>
        {coverBonus > 0 && <span className="forecast-mod-cover">+{coverBonus} cover</span>}
        {shieldBonus > 0 && <span className="forecast-mod-cover">+{shieldBonus} shield</span>}
      </div>
    </div>
  );
}
