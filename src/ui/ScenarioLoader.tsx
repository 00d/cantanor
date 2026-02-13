/**
 * Scenario loader panel — loads hand-written JSON scenarios and Tiled .tmj maps.
 *
 * Both formats flow through loadScenarioFromUrl(), which auto-detects the
 * format and returns a BattleState plus an optional TiledMap reference.
 */

import { useState } from "react";
import { useBattleStore, hasSavedGame } from "../store/battleStore";
import { loadScenarioFromUrl } from "../io/scenarioLoader";

// ---------------------------------------------------------------------------
// Known scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { id: "interactive_arena", name: "⚔️ Interactive Arena (2v2)", path: "/scenarios/smoke/interactive_arena.json" },
  { id: "hidden_pit", name: "Hidden Pit Trap", path: "/scenarios/smoke/hidden_pit_basic.json" },
  { id: "fireball", name: "Fireball Rune", path: "/scenarios/smoke/fireball_rune_basic.json" },
  { id: "poisoned_dart", name: "Poisoned Dart Gallery", path: "/scenarios/smoke/poisoned_dart_gallery_basic.json" },
  { id: "phase6_strike", name: "Phase 6 – Strike Forecast", path: "/scenarios/smoke/phase6_forecast_strike_basic.json" },
  { id: "phase6_duel", name: "Phase 6 – Enemy Policy Duel", path: "/scenarios/smoke/phase6_enemy_policy_duel_basic.json" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScenarioLoader({
  /** Called with the loaded .tmj URL so App.tsx can resolve tileset image paths. */
  onTiledMapUrl,
}: {
  onTiledMapUrl?: (url: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadBattle = useBattleStore((s) => s.loadBattle);
  const loadSavedGame = useBattleStore((s) => s.loadSavedGame);
  const clearBattle = useBattleStore((s) => s.clearBattle);
  const toggleGrid = useBattleStore((s) => s.toggleGrid);
  const showGrid = useBattleStore((s) => s.showGrid);
  const tiledMap = useBattleStore((s) => s.tiledMap);
  const battle = useBattleStore((s) => s.battle);
  const saveExists = hasSavedGame();

  async function handleLoad(path: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await loadScenarioFromUrl(path);
      loadBattle(result.battle, result.enginePhase, result.tiledMap, result.contentContext, result.rawScenario, result.tiledMapUrl);
      useBattleStore.setState({ lastScenarioUrl: path });
      onTiledMapUrl?.(result.tiledMapUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    clearBattle();
    onTiledMapUrl?.(null);
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
            {tiledMap && <span className="tiled-badge"> ✦ Tiled</span>}
          </div>
          <div className="loader-actions">
            <button className="btn-clear" onClick={handleClear} disabled={loading}>
              Clear
            </button>
            {tiledMap && (
              <button
                className={`btn-grid ${showGrid ? "active" : ""}`}
                onClick={toggleGrid}
                title="Toggle grid overlay (G)"
              >
                {showGrid ? "Hide Grid" : "Show Grid"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {saveExists && (
            <div className="scenario-section">
              <button
                className="scenario-btn scenario-btn--continue"
                onClick={() => {
                  const ok = loadSavedGame();
                  if (!ok) {
                    setError("Save file could not be read.");
                  } else {
                    onTiledMapUrl?.(useBattleStore.getState().tiledMapUrl);
                  }
                }}
                disabled={loading}
              >
                ↩ Continue Saved Game
              </button>
            </div>
          )}

          <div className="scenario-section">
            <div className="scenario-section-label">Scenarios</div>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                className="scenario-btn"
                onClick={() => handleLoad(s.path)}
                disabled={loading}
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}

      {loading && <div className="loader-spinner">Loading…</div>}
    </div>
  );
}
