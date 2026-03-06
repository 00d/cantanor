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

  // Auto-scroll the active unit into view when the turn changes.
  //
  // Keyed on roundNumber as well as turnIndex because advanceTurn can wrap
  // to a LOWER index when the last-in-order unit ends its turn — turnIndex
  // alone isn't monotonic, but (turnIndex, roundNumber) always changes on
  // every end_turn.
  //
  // Snap (behavior:"auto") during AI chains. With "smooth", each AI end_turn
  // re-fires this effect, starting a new scrollIntoView that interrupts the
  // previous one mid-flight — the bar chases without ever settling and reads
  // as jitter. Instant scroll sidesteps that.
  //
  // isAiTurn is read via getState(), NOT a selector subscription. Subscribing
  // would re-fire this effect on every flag flip even when turnIndex hasn't
  // moved — wasted scrolls to the same chip. We want to READ the flag at
  // fire-time, not TRIGGER on it. The read is fresh: dispatchCommand's set()
  // (new turnIndex) and the synchronously-following _scheduleAiTurn →
  // set({isAiTurn:true}) land in the same React 18 auto-batch; by the time
  // this effect runs, isAiTurn is already true for AI-to-AI hops and false
  // for the final AI-to-PC handoff. That last scroll — the one the player
  // actually wants to watch — smooths; everything before it snaps.
  useEffect(() => {
    const behavior = useBattleStore.getState().isAiTurn ? "auto" : "smooth";
    activeRef.current?.scrollIntoView({ behavior, block: "nearest", inline: "center" });
  }, [battle?.turnIndex, battle?.roundNumber]);

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
        // Clear the map hover-cursor when the mouse leaves the strip entirely.
        // Per-chip onMouseLeave would flicker as you pass between chips.
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
              // Hover lights the unit's tile on the map — same action the canvas
              // mousemove uses, so any overlay that keys off hoveredTilePos (path
              // preview, hover cursor) reacts for free. Fires for corpses too:
              // the sprite is still on the map, and "where is this body" is a
              // legitimate question.
              onMouseEnter={() => setHoverTile([unit.x, unit.y])}
              // Click selects + pans camera there. Pan is gated on alive:
              // focusing a corpse is a dead end. Dead chips are still clickable
              // for select/deselect so the player can inspect the body in the
              // PartyPanel without hunting for its tile.
              onClick={() => {
                selectUnit(isSelected ? null : unitId);
                if (!isDead) focusTile(unit.x, unit.y);
              }}
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
