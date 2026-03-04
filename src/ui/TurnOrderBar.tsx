/**
 * Turn order bar — shows the full initiative sequence as a horizontal strip.
 *
 * Each unit is a compact chip displaying:
 *   - Team colour indicator (left border)
 *   - Unit ID
 *   - Initiative score
 *   - Mini HP bar
 *   - Active-turn highlight for the current actor
 *   - Dimmed appearance for dead units
 *
 * The bar scrolls horizontally when there are many units.  In portrait mode
 * it sits between the canvas and the panel section.
 */

import { useEffect, useRef } from "react";
import { useBattleStore } from "../store/battleStore";
import { activeUnitId, unitAlive } from "../engine/state";

const TEAM_COLORS: Record<string, string> = {
  pc: "var(--accent-blue)",
  player: "var(--accent-blue)",
  party: "var(--accent-blue)",
  ally: "var(--accent-green)",
  enemy: "var(--accent-red)",
};

function teamColor(team: string): string {
  return TEAM_COLORS[team] ?? "var(--text-secondary)";
}

export function TurnOrderBar() {
  const battle = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const selectUnit = useBattleStore((s) => s.selectUnit);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active unit into view when the turn changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [battle?.turnIndex]);

  if (!battle) return null;

  const currentId = activeUnitId(battle);
  const { turnOrder, turnIndex, units } = battle;

  // Build the display list starting from the current turn index so the
  // active unit always appears first (leftmost), followed by upcoming turns.
  const ordered: string[] = [];
  for (let i = 0; i < turnOrder.length; i++) {
    ordered.push(turnOrder[(turnIndex + i) % turnOrder.length]);
  }

  return (
    <div className="turn-order-bar" role="list" aria-label="Turn order">
      <span className="turn-order-label">Turn</span>
      <div className="turn-order-scroll">
        {ordered.map((unitId, idx) => {
          const unit = units[unitId];
          if (!unit) return null;
          const isActive = unitId === currentId;
          const isDead = !unitAlive(unit);
          const isSelected = unitId === selectedUnitId;
          const hpPct = Math.max(0, Math.min(100, (unit.hp / Math.max(1, unit.maxHp)) * 100));

          return (
            <button
              key={`${unitId}-${idx}`}
              ref={isActive ? activeRef : undefined}
              role="listitem"
              className={
                "turn-chip" +
                (isActive ? " active" : "") +
                (isDead ? " dead" : "") +
                (isSelected ? " selected" : "")
              }
              style={{ "--team-color": teamColor(unit.team) } as React.CSSProperties}
              onClick={() => selectUnit(isSelected ? null : unitId)}
              title={`${unitId} — Init ${unit.initiative} — ${unit.hp}/${unit.maxHp} HP`}
            >
              {isActive && <span className="turn-arrow" aria-label="Current turn" />}
              <span className="chip-id">{unitId}</span>
              <span className="chip-init">{unit.initiative}</span>
              <span className="chip-hp-track">
                <span
                  className="chip-hp-fill"
                  style={{ width: `${hpPct}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
