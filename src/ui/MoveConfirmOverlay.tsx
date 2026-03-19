/**
 * Move-confirmation overlay — shows when a proposed path is locked.
 *
 * Positioned in the bottom-left of the canvas area (same anchor as
 * ForecastTooltip, but slightly higher so they never overlap — only one
 * can be visible at a time anyway since they gate on different targetModes).
 *
 * Unlike ForecastTooltip this component uses `pointer-events: auto` because
 * the Confirm / Cancel buttons must be clickable.
 */

import { useBattleStore } from "../store/battleStore";
import { activeUnitId } from "../engine/state";

export function MoveConfirmOverlay() {
  const battle = useBattleStore((s) => s.battle);
  const proposedPath = useBattleStore((s) => s.proposedPath);
  const battleEnded = useBattleStore((s) => s.battleEnded);
  const isAiTurn = useBattleStore((s) => s.isAiTurn);
  const dispatchCommand = useBattleStore((s) => s.dispatchCommand);
  const setTargetMode = useBattleStore((s) => s.setTargetMode);
  const setProposedPath = useBattleStore((s) => s.setProposedPath);

  if (!battle || !proposedPath?.locked || battleEnded || isAiTurn) return null;

  const actorId = activeUnitId(battle);
  const actor = battle.units[actorId];
  if (!actor) return null;

  const dest = proposedPath.tiles[proposedPath.tiles.length - 1];
  const speed = actor.speed;
  // Cost is in tile-units (same scale as speed).
  const cost = proposedPath.cost;

  function handleConfirm() {
    dispatchCommand({ type: "move", actor: actorId, x: dest[0], y: dest[1] });
    setTargetMode(null);
  }

  function handleCancel() {
    setProposedPath(null);
  }

  return (
    <div className="move-confirm-overlay">
      <div className="move-confirm-cost">
        <span className="move-confirm-cost-value">{cost}</span>
        <span className="move-confirm-cost-sep">/</span>
        <span className="move-confirm-cost-max">{speed}</span>
        <span className="move-confirm-cost-label">tiles</span>
      </div>
      <div className="move-confirm-buttons">
        <button className="move-confirm-btn confirm" onClick={handleConfirm}>
          Confirm
        </button>
        <button className="move-confirm-btn cancel" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
