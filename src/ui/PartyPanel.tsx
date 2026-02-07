/**
 * Party panel — shows HP/conditions for all units, grouped by team.
 * HP bars use direct DOM manipulation via refs (transient updates, no re-renders).
 */

import React, { useEffect, useRef } from "react";
import { useBattleStore } from "../store/battleStore";
import { UnitState, unitAlive } from "../engine/state";

interface HpBarProps {
  unitId: string;
  hp: number;
  maxHp: number;
}

function HpBar({ unitId, hp, maxHp }: HpBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // Subscribe to HP changes without re-renders
  useEffect(() => {
    const unsubscribe = useBattleStore.subscribe(
      (state) => state.battle?.units[unitId]?.hp,
      (newHp) => {
        if (!barRef.current || newHp === undefined) return;
        const max = useBattleStore.getState().battle?.units[unitId]?.maxHp ?? 1;
        const pct = Math.max(0, Math.min(100, (newHp / max) * 100));
        barRef.current.style.width = `${pct}%`;
        if (pct < 25) barRef.current.style.backgroundColor = "#e53935";
        else if (pct < 50) barRef.current.style.backgroundColor = "#fb8c00";
        else barRef.current.style.backgroundColor = "#43a047";
      },
    );
    return unsubscribe;
  }, [unitId]);

  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
  const barColor = pct < 25 ? "#e53935" : pct < 50 ? "#fb8c00" : "#43a047";

  return (
    <div className="hp-bar-track">
      <div
        ref={barRef}
        className="hp-bar-fill"
        style={{ width: `${pct}%`, backgroundColor: barColor }}
      />
    </div>
  );
}

function UnitRow({ unit, selected }: { unit: UnitState; selected: boolean }) {
  const selectUnit = useBattleStore((s) => s.selectUnit);
  const alive = unitAlive(unit);

  return (
    <div
      className={`unit-row ${selected ? "selected" : ""} ${alive ? "" : "dead"}`}
      onClick={() => selectUnit(selected ? null : unit.unitId)}
    >
      <div className="unit-id">{unit.unitId}</div>
      <HpBar unitId={unit.unitId} hp={unit.hp} maxHp={unit.maxHp} />
      <div className="unit-stats">
        <span>{unit.hp}/{unit.maxHp} HP</span>
        {unit.tempHp > 0 && <span className="temp-hp"> (+{unit.tempHp})</span>}
      </div>
      {Object.keys(unit.conditions).length > 0 && (
        <div className="conditions">
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

export function PartyPanel() {
  const battle = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);

  if (!battle) {
    return <div className="party-panel empty">No battle loaded</div>;
  }

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
              <UnitRow key={unit.unitId} unit={unit} selected={selectedUnitId === unit.unitId} />
            ))}
        </div>
      ))}
    </div>
  );
}
