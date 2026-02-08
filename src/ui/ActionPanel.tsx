/**
 * Action panel — shows available commands for the active unit.
 * Dispatches commands through the Zustand store.
 */

import { useBattleStore, selectActiveUnit } from "../store/battleStore";
import { activeUnitId, unitAlive } from "../engine/state";

export function ActionPanel() {
  const battle = useBattleStore((s) => s.battle);
  const dispatchCommand = useBattleStore((s) => s.dispatchCommand);
  const targetMode = useBattleStore((s) => s.targetMode);
  const setTargetMode = useBattleStore((s) => s.setTargetMode);
  const activeUnit = useBattleStore(selectActiveUnit);

  if (!battle || !activeUnit || !unitAlive(activeUnit)) {
    return <div className="action-panel empty">No active unit</div>;
  }

  const actorId = activeUnitId(battle);
  const actionsLeft = activeUnit.actionsRemaining;
  const hasActions = actionsLeft > 0;

  function handleMove() {
    if (!hasActions) return;
    setTargetMode({ type: "move" });
  }

  function handleStrike() {
    if (!hasActions) return;
    setTargetMode({ type: "strike" });
  }

  function handleCancelTarget() {
    setTargetMode(null);
  }

  function handleEndTurn() {
    dispatchCommand({ type: "end_turn", actor: actorId });
    setTargetMode(null);
  }

  return (
    <div className="action-panel">
      <h3>Actions</h3>
      <div className="active-unit-info">
        <span className="actor-name">{actorId}</span>
        <span className="actions-pip">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className={`pip ${i < actionsLeft ? "filled" : "empty"}`} />
          ))}
        </span>
      </div>

      {targetMode && (
        <div className="target-mode-banner">
          <span className="target-mode-text">
            {targetMode.type === "move" && "🎯 Click a tile to move"}
            {targetMode.type === "strike" && "⚔️ Click an enemy to attack"}
          </span>
          <button className="btn-cancel-target" onClick={handleCancelTarget}>
            Cancel
          </button>
        </div>
      )}

      <div className="action-buttons">
        <button
          className="action-btn"
          onClick={handleMove}
          disabled={!hasActions || targetMode !== null}
          title="Move to an adjacent tile (1 action)"
        >
          🚶 Move
        </button>
        <button
          className="action-btn"
          onClick={handleStrike}
          disabled={!hasActions || targetMode !== null}
          title="Strike an enemy (1 action)"
        >
          ⚔️ Strike
        </button>
        <button
          className="action-btn end-turn"
          onClick={handleEndTurn}
          title="End turn (skip remaining actions)"
        >
          End Turn
        </button>
      </div>
      <div className="action-hint">
        {!hasActions && "No actions remaining. End turn to continue."}
        {hasActions && !targetMode && "Choose an action above, then click on the map."}
        {targetMode && "Click on the map or press ESC to cancel."}
      </div>
    </div>
  );
}
