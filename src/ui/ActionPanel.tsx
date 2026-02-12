/**
 * Action panel — shows available commands for the active unit.
 * Dispatches commands through the Zustand store.
 *
 * Sections:
 *   - Action pips (remaining actions display)
 *   - Target-mode banner (shown while awaiting a map click)
 *   - Core actions: Move, Strike, End Turn
 *   - Abilities: spells, feats, items from the loaded content pack
 */

import { useBattleStore, selectActiveUnit } from "../store/battleStore";
import { activeUnitId, unitAlive } from "../engine/state";
import type { UnitState } from "../engine/state";

function InspectPanel({ unit }: { unit: UnitState }) {
  const alive = unitAlive(unit);
  return (
    <div className="inspect-panel">
      <div className="inspect-header">
        <span className="inspect-title">Inspecting</span>
        <span className="inspect-unit-id">{unit.unitId}</span>
        <span className={`inspect-team team-${unit.team}`}>{unit.team.toUpperCase()}</span>
      </div>
      <div className="inspect-stats">
        <div className="inspect-stat">
          <span className="stat-label">HP</span>
          <span className="stat-value">
            {unit.hp}/{unit.maxHp}{unit.tempHp > 0 ? ` +${unit.tempHp}` : ""}
          </span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">AC</span>
          <span className="stat-value">{unit.ac}</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Spd</span>
          <span className="stat-value">{unit.speed}</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Atk</span>
          <span className="stat-value">{unit.attackMod >= 0 ? "+" : ""}{unit.attackMod} ({unit.damage})</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Fort</span>
          <span className="stat-value">{unit.fortitude}</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Ref</span>
          <span className="stat-value">{unit.reflex}</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Will</span>
          <span className="stat-value">{unit.will}</span>
        </div>
        <div className="inspect-stat">
          <span className="stat-label">Init</span>
          <span className="stat-value">{unit.initiative}</span>
        </div>
      </div>
      {!alive && <div className="inspect-dead">DEAD</div>}
      {Object.keys(unit.conditions).length > 0 && (
        <div className="inspect-conditions">
          {Object.entries(unit.conditions).map(([cond, val]) => (
            <span key={cond} className="condition-tag">
              {cond}{val > 1 ? ` ${val}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Kind → display config
const KIND_CONFIG: Record<string, { icon: string; label: string; className: string }> = {
  spell: { icon: "✦", label: "Spell", className: "kind-spell" },
  feat:  { icon: "★", label: "Feat",  className: "kind-feat"  },
  item:  { icon: "⬡", label: "Item",  className: "kind-item"  },
};

function abilityTargetsAllies(tags: string[]): boolean {
  return tags.some((t) => ["heal", "support", "medicine", "restore"].includes(t));
}

export function ActionPanel() {
  const battle         = useBattleStore((s) => s.battle);
  const dispatchCommand = useBattleStore((s) => s.dispatchCommand);
  const targetMode     = useBattleStore((s) => s.targetMode);
  const setTargetMode  = useBattleStore((s) => s.setTargetMode);
  const activeUnit     = useBattleStore(selectActiveUnit);
  const contentEntries = useBattleStore((s) => s.contentEntries);
  const isAiTurn       = useBattleStore((s) => s.isAiTurn);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);

  // The unit the player is currently inspecting (may differ from active unit)
  const inspectedUnit =
    battle && selectedUnitId && selectedUnitId !== activeUnitId(battle)
      ? (battle.units[selectedUnitId] ?? null)
      : null;

  if (!battle || !activeUnit || !unitAlive(activeUnit)) {
    return <div className="action-panel empty">No active unit</div>;
  }

  if (isAiTurn) {
    return (
      <div className="action-panel">
        <div className="ai-turn-banner">Enemy is acting…</div>
      </div>
    );
  }

  const actorId    = activeUnitId(battle);
  const actionsLeft = activeUnit.actionsRemaining;
  const hasActions  = actionsLeft > 0;
  const isPlayerUnit = activeUnit.team === "pc";

  if (!isPlayerUnit) {
    return (
      <div className="action-panel">
        <div className="ai-turn-banner">Waiting for AI…</div>
      </div>
    );
  }

  function handleMove() {
    if (!hasActions) return;
    setTargetMode({ type: "move" });
  }

  function handleStrike() {
    if (!hasActions) return;
    setTargetMode({ type: "strike" });
  }

  function handleAbility(entryId: string, kind: string, tags: string[]) {
    if (!hasActions) return;
    const allyTarget = abilityTargetsAllies(tags);
    setTargetMode({
      type: kind as "spell" | "feat" | "item",
      contentEntryId: entryId,
      allyTarget,
    });
  }

  function handleEndTurn() {
    dispatchCommand({ type: "end_turn", actor: actorId });
    setTargetMode(null);
  }

  function handleCancelTarget() {
    setTargetMode(null);
  }

  function targetBannerText() {
    if (!targetMode) return "";
    switch (targetMode.type) {
      case "move":   return "Click a highlighted tile to move";
      case "strike": return "Click an enemy to attack";
      case "spell":
      case "feat":
      case "item":   return targetMode.allyTarget
        ? "Click an ally to use ability"
        : "Click a target to use ability";
      default:       return "Click a target";
    }
  }

  const spells = contentEntries.filter((e) => e.kind === "spell");
  const feats  = contentEntries.filter((e) => e.kind === "feat");
  const items  = contentEntries.filter((e) => e.kind === "item");

  return (
    <div className="action-panel">
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
          <span className="target-mode-text">{targetBannerText()}</span>
          <button className="btn-cancel-target" onClick={handleCancelTarget}>
            Cancel
          </button>
        </div>
      )}

      {/* Core actions */}
      <div className="action-section-label">Actions</div>
      <div className="action-buttons">
        <button
          className="action-btn"
          onClick={handleMove}
          disabled={!hasActions || targetMode !== null}
          title="Move to a reachable tile (1 action)"
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
          disabled={targetMode !== null}
          title="End turn"
        >
          End Turn
        </button>
      </div>

      {/* Abilities from content pack */}
      {(spells.length > 0 || feats.length > 0 || items.length > 0) && (
        <div className="abilities-section">
          <div className="action-section-label">Abilities</div>

          {spells.length > 0 && (
            <div className="ability-group">
              {spells.map((entry) => {
                const cfg = KIND_CONFIG["spell"];
                return (
                  <button
                    key={entry.id}
                    className={`ability-btn ${cfg.className}`}
                    disabled={!hasActions || targetMode !== null}
                    onClick={() => handleAbility(entry.id, entry.kind, entry.tags)}
                    title={`[${cfg.label}] ${entry.tags.join(", ")}`}
                  >
                    <span className="ability-icon">{cfg.icon}</span>
                    <span className="ability-name">{entry.id.split(".").pop()?.replace(/_/g, " ")}</span>
                  </button>
                );
              })}
            </div>
          )}

          {feats.length > 0 && (
            <div className="ability-group">
              {feats.map((entry) => {
                const cfg = KIND_CONFIG["feat"];
                return (
                  <button
                    key={entry.id}
                    className={`ability-btn ${cfg.className}`}
                    disabled={!hasActions || targetMode !== null}
                    onClick={() => handleAbility(entry.id, entry.kind, entry.tags)}
                    title={`[${cfg.label}] ${entry.tags.join(", ")}`}
                  >
                    <span className="ability-icon">{cfg.icon}</span>
                    <span className="ability-name">{entry.id.split(".").pop()?.replace(/_/g, " ")}</span>
                  </button>
                );
              })}
            </div>
          )}

          {items.length > 0 && (
            <div className="ability-group">
              {items.map((entry) => {
                const cfg = KIND_CONFIG["item"];
                return (
                  <button
                    key={entry.id}
                    className={`ability-btn ${cfg.className}`}
                    disabled={!hasActions || targetMode !== null}
                    onClick={() => handleAbility(entry.id, entry.kind, entry.tags)}
                    title={`[${cfg.label}] ${entry.tags.join(", ")}`}
                  >
                    <span className="ability-icon">{cfg.icon}</span>
                    <span className="ability-name">{entry.id.split(".").pop()?.replace(/_/g, " ")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="action-hint">
        {!hasActions && "No actions remaining — end turn to continue."}
        {hasActions && !targetMode && "Select an action, then click the map."}
        {targetMode && "Click on the map or press ESC to cancel."}
      </div>

      {inspectedUnit && <InspectPanel unit={inspectedUnit} />}
    </div>
  );
}
