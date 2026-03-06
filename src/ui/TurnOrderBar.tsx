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
import { focusTile } from "../rendering/cameraController";

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
  const setHoverTile = useBattleStore((s) => s.setHoverTile);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active chip into view when the turn changes.
  //
  // Snap (behavior:"auto") during AI chains. With "smooth", each AI end_turn
  // re-fires this effect and starts a new scrollIntoView which INTERRUPTS
  // the previous one mid-flight — the bar chases without settling (jitter).
  // Instant scroll sidesteps that. The final AI→PC handoff smooths because
  // isAiTurn has flipped back to false by the time this effect runs.
  //
  // isAiTurn is read via getState(), NOT via a selector subscription.
  // Adding it to the dep array would re-fire this effect on every flag flip
  // even when turnIndex hasn't moved — wasted scrolls to the same chip.
  // We want to READ the flag at fire-time, not TRIGGER on it.
  useEffect(() => {
    const behavior = useBattleStore.getState().isAiTurn ? "auto" : "smooth";
    activeRef.current?.scrollIntoView({ behavior, block: "nearest", inline: "center" });
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
      <div
        className="turn-order-scroll"
        // Clear the map hover-cursor when the mouse leaves the bar entirely.
        // Per-chip onMouseLeave would flicker as the pointer passes between chips.
        onMouseLeave={() => setHoverTile(null)}
      >
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
              // Hovering a chip sets the canvas hover tile → the map cursor
              // highlights them. With an area spell armed, this also paints
              // the blast diamond centred there — a free "what if I fireball
              // that guy's feet" preview, because setHoverTile is the same
              // action the canvas mousemove uses.
              onMouseEnter={() => setHoverTile([unit.x, unit.y])}
              // Click selects + pans. Gated on alive: panning to a corpse
              // is a dead end. The chip is still hoverable so you can spot
              // where the body fell.
              onClick={
                isDead
                  ? undefined
                  : () => { selectUnit(unitId); focusTile(unit.x, unit.y); }
              }
              disabled={isDead}
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
