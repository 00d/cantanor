/**
 * Turn-order ribbon — horizontal initiative strip at the top of the UI column.
 *
 * Answers three questions without the player having to scroll the log:
 *   1. Who acts now?     → active chip, blue glow, auto-scrolled into view
 *   2. Who's next?       → chips to the right of active, in initiative order
 *   3. How far to me?    → team stripe on the left edge of every chip
 *
 * Pure view. All data (turnOrder, turnIndex, roundNumber) already lives in
 * BattleState; the reducer maintains it, this component just reads it.
 *
 * Dead units stay in the ribbon, faded. The reducer's advanceTurn skips over
 * them when stepping turnIndex, but it doesn't splice them out of turnOrder —
 * showing the corpse chip faded is the honest rendering of that: "goblin_2
 * was in the order, died, and now you can see the gap your fireball left."
 */

import { useEffect, useRef } from "react";
import { useBattleStore } from "../store/battleStore";
import { unitAlive } from "../engine/state";
import { focusTile } from "../rendering/cameraController";

/** Normalize a team string to one of five colour classes. Mirrors
 *  spriteManager.ts:TEAM_COLORS exactly — the ribbon stripe should match the
 *  square on the map. Scenario JSON can spell the team any way it likes, so
 *  unknown teams get a grey stripe rather than no stripe. */
function teamColorClass(team: string): string {
  switch (team) {
    case "pc": case "player": case "party": return "team-pc";
    case "ally":                            return "team-ally";
    case "enemy":                           return "team-enemy";
    case "neutral":                         return "team-neutral";
    default:                                return "team-unknown";
  }
}

export function TurnOrderRibbon() {
  const battle         = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const selectUnit     = useBattleStore((s) => s.selectUnit);
  const setHoverTile   = useBattleStore((s) => s.setHoverTile);

  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the acting-now chip in the viewport. Keyed on roundNumber as well
  // as turnIndex because advanceTurn can wrap to a *lower* index when the
  // last-in-order unit ends its turn — turnIndex alone isn't monotonic, but
  // (turnIndex, roundNumber) together always changes on every end_turn.
  //
  // block:"nearest" stops the browser from ALSO scrolling the whole page
  // vertically — scrollIntoView defaults to block:"start" which would drag
  // ancestors around trying to put the chip at the top of the window.
  //
  // Snap (behavior:"auto") during AI chains. With smooth, each AI end_turn
  // re-fires this effect, which starts a new scrollIntoView, which
  // INTERRUPTS the previous one mid-flight — the ribbon chases without
  // ever settling and reads as jitter. Instant scroll sidesteps that.
  //
  // isAiTurn is read via getState(), NOT via a selector subscription.
  // Adding it to the dep array would re-fire this effect on every flag
  // flip even when turnIndex hasn't moved — wasted scrolls to the same
  // chip. We want to READ the flag at fire-time, not TRIGGER on it.
  //
  // Why getState() sees the right value: dispatchCommand's set() (which
  // writes the new turnIndex) and the immediately-following synchronous
  // _scheduleAiTurn → set({isAiTurn:true}) land in the same React 18
  // auto-batch. By the time this effect runs, isAiTurn is already true
  // for AI-to-AI hops and already false for the final AI-to-PC handoff.
  // That last one is the scroll the player actually wants to watch — so
  // it smooths. Everything before it snaps.
  useEffect(() => {
    const behavior = useBattleStore.getState().isAiTurn ? "auto" : "smooth";
    stripRef.current
      ?.querySelector<HTMLElement>(".turn-chip.active")
      ?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
  }, [battle?.turnIndex, battle?.roundNumber]);

  if (!battle) return null;

  return (
    <div
      ref={stripRef}
      className="turn-ribbon"
      // Clear the map hover-cursor when the mouse leaves the ribbon entirely.
      // Per-chip onMouseLeave would flicker as you pass between chips.
      onMouseLeave={() => setHoverTile(null)}
    >
      <div className="turn-ribbon-round" title={`Round ${battle.roundNumber}`}>
        R{battle.roundNumber}
      </div>

      {battle.turnOrder.map((unitId, i) => {
        const unit = battle.units[unitId];
        // turnOrder is rebuilt by spawn_unit (reducer.ts:1230) but every
        // rebuild iterates units{} — there's no path that puts an id in
        // turnOrder without also putting the body in units. Guard anyway:
        // a null here would throw inside the map and take the whole UI
        // column with it.
        if (!unit) return null;

        const alive    = unitAlive(unit);
        const active   = i === battle.turnIndex;
        const selected = selectedUnitId === unitId;

        const cls = [
          "turn-chip",
          teamColorClass(unit.team),
          active   ? "active"   : "",
          selected ? "selected" : "",
          alive    ? ""         : "dead",
        ].filter(Boolean).join(" ");

        return (
          <div
            key={unitId}
            className={cls}
            title={`${unitId} — init ${unit.initiative}${alive ? "" : " (dead)"}`}
            // Hover lights the unit's tile on the map (and, if the player has
            // an area spell armed, paints the blast centred there — a cheap
            // "what if I fireball that guy's feet" preview you get for free
            // because setHoverTile is the same action the canvas mousemove
            // uses). Fires for corpses too — the sprite is still on the map.
            onMouseEnter={() => setHoverTile([unit.x, unit.y])}
            // Click selects + pans. Gated on alive: focusTile()ing to a
            // corpse is a dead end. Inspect corpses in the PartyPanel.
            onClick={
              alive
                ? () => { selectUnit(unitId); focusTile(unit.x, unit.y); }
                : undefined
            }
          >
            <div className="chip-label">{unitId}</div>
            <div className="chip-hp">{unit.hp}/{unit.maxHp}</div>
          </div>
        );
      })}
    </div>
  );
}
