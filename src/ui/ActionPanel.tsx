/**
 * Action panel — shows available commands for the active unit.
 * Dispatches commands through the Zustand store.
 *
 * Sections:
 *   - Action pips (remaining actions display)
 *   - Target-mode banner (shown while awaiting a map click)
 *   - Core actions: Move, Strike, End Turn
 *   - Abilities: spells / feats / items from the loaded content pack,
 *     filtered by the active unit's `abilities` list if present
 */

import { useBattleStore, selectActiveUnit } from "../store/battleStore";
import { activeUnitId, unitAlive } from "../engine/state";
import type { UnitState, WeaponData } from "../engine/state";
import type { ContentPackEntry, ResolvedEntry } from "../io/contentPackLoader";

type EntryView = ContentPackEntry & { resolvedEntry: ResolvedEntry };

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

/** Pull the area block out of a content-pack payload if it has one. Shape
 *  check is defensive — the loader only validates that payload is an object,
 *  so a malformed area entry would otherwise surface as a cryptic render bug. */
function readAreaShape(
  payload: Record<string, unknown>,
): { shape: "burst"; radiusFeet: number } | null {
  const raw = payload["area"];
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a["shape"] !== "burst") return null;
  const r = Number(a["radius_feet"]);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { shape: "burst", radiusFeet: r };
}

/** Single ability button — renders with kind-appropriate theme + use counter. */
function AbilityButton({
  entry,
  unit,
  disabled,
  hotkey,
  onActivate,
}: {
  entry: EntryView;
  unit: UnitState;
  disabled: boolean;
  hotkey: number | null;
  onActivate: (entryId: string, kind: string, tags: string[]) => void;
}) {
  const cfg = KIND_CONFIG[entry.kind] ?? { icon: "◆", label: entry.kind, className: "" };
  const remaining = entry.usesPerDay != null
    ? (unit.abilitiesRemaining[entry.id] ?? entry.usesPerDay)
    : null;
  const exhausted = remaining !== null && remaining <= 0;

  return (
    <button
      className={`ability-btn ${cfg.className}`}
      disabled={disabled || exhausted}
      onClick={() => onActivate(entry.id, entry.kind, entry.tags)}
      title={`[${cfg.label}] ${entry.tags.join(", ")}${hotkey ? ` — press ${hotkey}` : ""}`}
    >
      <span className="ability-icon">{cfg.icon}</span>
      <span className="ability-name">{entry.id.split(".").pop()?.replace(/_/g, " ")}</span>
      {remaining !== null && <span className="ability-uses">({remaining}/{entry.usesPerDay})</span>}
      {hotkey && <span className="ability-hotkey">{hotkey}</span>}
    </button>
  );
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
  const orchestratorConfig = useBattleStore((s) => s.orchestratorConfig);
  const pendingReaction = useBattleStore((s) => s.pendingReaction);
  const resolveReaction = useBattleStore((s) => s.resolveReaction);

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
  const playerTeams = orchestratorConfig?.playerTeams ?? ["pc"];
  const isPlayerUnit = playerTeams.includes(activeUnit.team);

  if (!isPlayerUnit && !pendingReaction) {
    return (
      <div className="action-panel">
        <div className="ai-turn-banner">Waiting for AI…</div>
      </div>
    );
  }

  // Show reaction prompt if player has a pending reaction
  if (pendingReaction && battle) {
    const reactor = battle.units[pendingReaction.reactorId];
    if (reactor && orchestratorConfig?.playerTeams.includes(reactor.team)) {
      const reactionLabel = pendingReaction.reactionType === "shield_block"
        ? "Use Shield Block?"
        : "Use Attack of Opportunity?";
      return (
        <div className="action-panel">
          <div className="reaction-prompt">
            <div className="reaction-prompt-label">{reactionLabel}</div>
            <div className="reaction-prompt-detail">
              {reactor.unitId} can react to {pendingReaction.provokerId}
            </div>
            <div className="reaction-prompt-buttons">
              <button className="action-btn" onClick={() => resolveReaction(true)}>
                Use Reaction
              </button>
              <button className="action-btn" onClick={() => resolveReaction(false)}>
                Decline
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  function handleMove() {
    if (!hasActions) return;
    setTargetMode({ type: "move" });
  }

  function handleStrike(weaponIndex?: number) {
    if (!hasActions) return;
    setTargetMode({ type: "strike", weaponIndex });
  }

  function handleAbility(entryId: string, kind: string, tags: string[]) {
    if (!hasActions) return;
    // Look up the full entry so we can sniff the payload for an area shape.
    // contentEntries is the same list the buttons were rendered from, so
    // this find always hits.
    const entry = contentEntries.find((e) => e.id === entryId);
    const area = entry ? readAreaShape(entry.payload) : null;
    setTargetMode({
      type: kind as "spell" | "feat" | "item",
      contentEntryId: entryId,
      // allyTarget is meaningless for area spells (they hit everyone in the
      // blast); leave it undefined so the click handler doesn't try to
      // match a clicked unit's team.
      ...(area ? { area } : { allyTarget: abilityTargetsAllies(tags) }),
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
    if (targetMode.area) {
      return `Click a tile to center the blast (${targetMode.area.radiusFeet}ft ${targetMode.area.shape})`;
    }
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

  // Per-unit filtering: if the active unit declares an `abilities` whitelist,
  // only show those entries. Undefined = everything in the pack is available
  // (legacy scenarios without per-unit lists keep working).
  const allowed = activeUnit.abilities
    ? new Set(activeUnit.abilities)
    : null;
  const visibleEntries = allowed
    ? contentEntries.filter((e) => allowed.has(e.id))
    : contentEntries;

  // Group by kind for display. Hotkeys 1-9 are assigned in visual order so
  // the number the player sees matches the key they press.
  const kindOrder = ["spell", "feat", "item"];
  const grouped: Record<string, EntryView[]> = { spell: [], feat: [], item: [] };
  for (const e of visibleEntries) {
    if (e.kind in grouped) grouped[e.kind].push(e);
  }
  let hotkeyCounter = 0;
  const btnDisabled = !hasActions || targetMode !== null;

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

      {Object.keys(activeUnit.conditions).length > 0 && (
        <div className="active-conditions">
          {Object.entries(activeUnit.conditions).map(([cond, val]) => {
            const effectEntry = Object.values(battle.effects).find(
              (e) =>
                e.targetUnitId === actorId &&
                e.kind === "condition" &&
                String(e.payload["name"] ?? "") === cond,
            );
            const rounds = effectEntry?.durationRounds;
            return (
              <span key={cond} className="condition-tag">
                {cond}{val > 1 ? ` ${val}` : ""}
                {rounds != null && <span className="condition-rounds">{rounds}r</span>}
              </span>
            );
          })}
        </div>
      )}

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
          title="Move to a reachable tile (1 action) — press M"
        >
          🚶 Move
        </button>
        {activeUnit.weapons && activeUnit.weapons.length > 1 ? (
          activeUnit.weapons.map((w: WeaponData, idx: number) => (
            <button
              key={idx}
              className="action-btn"
              onClick={() => handleStrike(idx)}
              disabled={!hasActions || targetMode !== null}
              title={`${w.name} (${w.type}) — 1 action`}
            >
              {w.type === "melee" ? "⚔️" : "🏹"} {w.name}
            </button>
          ))
        ) : (
          <button
            className="action-btn"
            onClick={() => handleStrike()}
            disabled={!hasActions || targetMode !== null}
            title="Strike an enemy (1 action) — press K"
          >
            ⚔️ Strike
          </button>
        )}
        {/* Reload button — shown when a weapon has reload > 0 and ammo is depleted */}
        {activeUnit.weapons && activeUnit.weapons.map((w: WeaponData, idx: number) => {
          if (!w.ammo || !w.reload || w.reload <= 0) return null;
          const currentAmmo = activeUnit.weaponAmmo?.[idx] ?? 0;
          if (currentAmmo > 0) return null;
          return (
            <button
              key={`reload-${idx}`}
              className="action-btn"
              onClick={() => { dispatchCommand({ type: "reload", actor: actorId, weapon_index: idx }); }}
              disabled={!hasActions || targetMode !== null}
              title={`Reload ${w.name} (${w.reload} action)`}
            >
              Reload {w.name}
            </button>
          );
        })}
        {activeUnit.shieldHardness != null && activeUnit.shieldHp != null && activeUnit.shieldHp > 0 && !activeUnit.shieldRaised && !(activeUnit.weapons?.[0]?.hands === 2) && (
          <button
            className="action-btn"
            onClick={() => { dispatchCommand({ type: "raise_shield", actor: actorId }); }}
            disabled={!hasActions || targetMode !== null}
            title="Raise Shield (1 action) — +2 AC until turn start"
          >
            🛡️ Raise Shield
          </button>
        )}
        {activeUnit.shieldRaised && (
          <span className="shield-raised-indicator">🛡️ Shield Raised</span>
        )}
        <button
          className="action-btn end-turn"
          onClick={handleEndTurn}
          disabled={targetMode !== null}
          title="End turn — press E"
        >
          End Turn
        </button>
      </div>

      {/* Abilities from content pack, grouped by kind */}
      {visibleEntries.length > 0 && (
        <div className="abilities-section">
          <div className="action-section-label">Abilities</div>
          {kindOrder.map((kind) => {
            const entries = grouped[kind];
            if (entries.length === 0) return null;
            return (
              <div key={kind} className="ability-group">
                {entries.map((entry) => {
                  hotkeyCounter++;
                  const hotkey = hotkeyCounter <= 9 ? hotkeyCounter : null;
                  return (
                    <AbilityButton
                      key={entry.id}
                      entry={entry}
                      unit={activeUnit}
                      disabled={btnDisabled}
                      hotkey={hotkey}
                      onActivate={handleAbility}
                    />
                  );
                })}
              </div>
            );
          })}
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
