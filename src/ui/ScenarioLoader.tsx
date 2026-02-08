/**
 * Scenario loader panel — allows loading predefined scenarios into the browser.
 */

import { useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { battleStateFromScenario } from "../io/scenarioLoader";

// Predefined smoke scenarios for quick testing
const SMOKE_SCENARIOS = [
  { id: "hidden_pit", name: "Hidden Pit Trap", path: "/scenarios/smoke/hidden_pit_basic.json" },
  { id: "fireball", name: "Fireball Rune", path: "/scenarios/smoke/fireball_rune_basic.json" },
  { id: "poisoned_dart", name: "Poisoned Dart Gallery", path: "/scenarios/smoke/poisoned_dart_gallery_basic.json" },
  { id: "phase6_strike", name: "Phase 6 - Strike Forecast", path: "/scenarios/smoke/phase6_forecast_strike_basic.json" },
  { id: "phase6_duel", name: "Phase 6 - Enemy Policy Duel", path: "/scenarios/smoke/phase6_enemy_policy_duel_basic.json" },
];

export function ScenarioLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadBattle = useBattleStore((s) => s.loadBattle);
  const clearBattle = useBattleStore((s) => s.clearBattle);
  const battle = useBattleStore((s) => s.battle);

  async function loadScenario(path: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load scenario: ${response.statusText}`);
      }
      const scenarioData = await response.json();
      const battleState = battleStateFromScenario(scenarioData);
      const enginePhase = (scenarioData["engine_phase"] as number) ?? 7;
      loadBattle(battleState, enginePhase);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    clearBattle();
    setError(null);
  }

  return (
    <div className="scenario-loader">
      <h3>Load Scenario</h3>
      {error && <div className="loader-error">{error}</div>}
      {battle ? (
        <div className="loader-loaded">
          <div className="loaded-info">
            <strong>Loaded:</strong> {battle.battleId}
          </div>
          <button className="btn-clear" onClick={handleClear} disabled={loading}>
            Clear Battle
          </button>
        </div>
      ) : (
        <div className="scenario-list">
          {SMOKE_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              className="scenario-btn"
              onClick={() => loadScenario(scenario.path)}
              disabled={loading}
            >
              {scenario.name}
            </button>
          ))}
        </div>
      )}
      {loading && <div className="loader-spinner">Loading...</div>}
    </div>
  );
}
