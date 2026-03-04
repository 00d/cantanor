/**
 * Party panel — shows HP/conditions for all units, grouped by team.
 */

import { useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { UnitState, EffectState, unitAlive, activeUnitId } from "../engine/state";
import { CharacterSheet } from "./CharacterSheet";

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
  const barColor = pct < 25 ? "#e53935" : pct < 50 ? "#fb8c00" : "#43a047";
  return (
    <div className="hp-bar-track">
      <div className="hp-bar-fill" style={{ width: `${pct}%`, backgroundColor: barColor }} />
    </div>
  );
}

function UnitRow({
  unit,
  selected,
  isActive,
  effects,
  expanded,
  onToggleExpand,
}: {
  unit: UnitState;
  selected: boolean;
  isActive: boolean;
  effects: Record<string, EffectState>;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const selectUnit = useBattleStore((s) => s.selectUnit);
  const alive = unitAlive(unit);

  // Build condition → remaining rounds from active effects so we can show duration badges.
  const condRounds: Record<string, number | null> = {};
  for (const effect of Object.values(effects)) {
    if (effect.targetUnitId !== unit.unitId || effect.kind !== "condition") continue;
    const name = String(effect.payload["name"] ?? "");
    if (!name || name in condRounds) continue;
    condRounds[name] = effect.durationRounds;
  }

  return (
    <>
      <div
        className={`unit-row ${selected ? "selected" : ""} ${alive ? "" : "dead"} ${isActive ? "active-turn" : ""}`}
        onClick={(e) => {
          if (e.detail === 2) {
            // Double-click toggles character sheet
            onToggleExpand();
          } else {
            selectUnit(selected ? null : unit.unitId);
          }
        }}
      >
        <button
          className={`cs-expand-btn ${expanded ? "expanded" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          title="Toggle character sheet"
        >
          {expanded ? "▼" : "▶"}
        </button>
        <div className="unit-id">{unit.unitId}</div>
        <HpBar hp={unit.hp} maxHp={unit.maxHp} />
        <div className="unit-stats">
          <span>{unit.hp}/{unit.maxHp} HP</span>
          {unit.tempHp > 0 && <span className="temp-hp"> (+{unit.tempHp})</span>}
        </div>
        {Object.keys(unit.conditions).length > 0 && (
          <div className="conditions">
            {Object.entries(unit.conditions).map(([cond, val]) => {
              const rounds = condRounds[cond];
              return (
                <span key={cond} className="condition-tag">
                  {cond}{val > 1 ? ` ${val}` : ""}
                  {rounds != null && <span className="condition-rounds">{rounds}r</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {expanded && (
        <CharacterSheet unit={unit} abilitiesRemaining={unit.abilitiesRemaining} />
      )}
    </>
  );
}

export function PartyPanel() {
  const battle = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  if (!battle) {
    return <div className="party-panel empty">No battle loaded</div>;
  }

  const currentActiveId = activeUnitId(battle);

  const unitsByTeam: Record<string, UnitState[]> = {};
  for (const unit of Object.values(battle.units)) {
    if (!unitsByTeam[unit.team]) unitsByTeam[unit.team] = [];
    unitsByTeam[unit.team].push(unit);
  }

  return (
    <div className="party-panel">
      <h3>Units</h3>
      {Object.entries(unitsByTeam).map(([team, units]) => (
        <div key={team} className="team-group">
          <div className="team-label">{team.toUpperCase()}</div>
          {units
            .sort((a, b) => a.unitId.localeCompare(b.unitId))
            .map((unit) => (
              <UnitRow
                key={unit.unitId}
                unit={unit}
                selected={selectedUnitId === unit.unitId}
                isActive={unit.unitId === currentActiveId}
                effects={battle.effects}
                expanded={expandedUnitId === unit.unitId}
                onToggleExpand={() => setExpandedUnitId(expandedUnitId === unit.unitId ? null : unit.unitId)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
