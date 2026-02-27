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
import { activeUnitId, unitAlive } from "../engine/state";
import { strikeForecast } from "../engine/forecast";
import { coverAcBonusForUnits } from "../grid/loe";

/** Mirror the reducer's MAP table — no shared export worth adding for three lines. */
function mapPenalty(attacksThisTurn: number): number {
  if (attacksThisTurn <= 0) return 0;
  if (attacksThisTurn === 1) return -5;
  return -10;
}

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

  // Reach gate — don't show a forecast the player can't act on.
  const reach = actor.reach ?? 1;
  const dist = Math.max(Math.abs(actor.x - target.x), Math.abs(actor.y - target.y));
  if (dist > reach) return null;

  const coverBonus = coverAcBonusForUnits(battle, actor, target);
  const mapPen = mapPenalty(actor.attacksThisTurn);
  const effectiveMod = actor.attackMod + mapPen;
  const effectiveAc = target.ac + coverBonus;

  const f = strikeForecast(effectiveMod, effectiveAc, actor.damage);
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
        <span>+{actor.attackMod}</span>
        {mapPen !== 0 && <span className="forecast-mod-map">{mapPen} MAP</span>}
        <span>vs AC {target.ac}</span>
        {coverBonus > 0 && <span className="forecast-mod-cover">+{coverBonus} cover</span>}
      </div>
    </div>
  );
}
