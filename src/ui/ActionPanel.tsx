/**
 * Action panel — shows available commands for the active unit.
 * Dispatches commands through the Zustand store.
 */

import { useBattleStore, selectActiveUnit } from "../store/battleStore";
import { activeUnitId, unitAlive } from "../engine/state";

export function ActionPanel() {
  const battle = useBattleStore((s) => s.battle);
  const dispatchCommand = useBattleStore((s) => s.dispatchCommand);
  const activeUnit = useBattleStore(selectActiveUnit);

  if (!battle || !activeUnit || !unitAlive(activeUnit)) {
    return <div className="action-panel empty">No active unit</div>;
  }

  const actorId = activeUnitId(battle);
  const actionsLeft = activeUnit.actionsRemaining;

  function handleEndTurn() {
    dispatchCommand({ type: "end_turn", actor: actorId });
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
      <div className="action-buttons">
        <button
          className="action-btn end-turn"
          onClick={handleEndTurn}
          title="End turn (skip remaining actions)"
        >
          End Turn
        </button>
      </div>
      <div className="action-hint">
        Click a unit or tile on the canvas to select a target, then choose an action.
      </div>
    </div>
  );
}
