/**
 * Scenario File Browser - Browse and load scenarios for editing
 */

import { useState } from "react";
import { useDesignerStore, ScenarioData } from "../../store/designerStore";
import { useBattleStore } from "../../store/battleStore";
import { loadScenarioFromUrl } from "../../io/scenarioLoader";

interface ScenarioGroup {
  name: string;
  scenarios: ScenarioFile[];
}

interface ScenarioFile {
  id: string;
  name: string;
  path: string;
  description?: string;
}

// Available scenarios organized by category
const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    name: "Smoke Tests",
    scenarios: [
      {
        id: "hidden_pit",
        name: "Hidden Pit Trap",
        path: "/scenarios/smoke/hidden_pit_basic.json",
        description: "Basic hazard scenario - pit trap",
      },
      {
        id: "fireball",
        name: "Fireball Rune",
        path: "/scenarios/smoke/fireball_rune_basic.json",
        description: "AOE hazard scenario",
      },
      {
        id: "poisoned_dart",
        name: "Poisoned Dart Gallery",
        path: "/scenarios/smoke/poisoned_dart_gallery_basic.json",
        description: "Persistent damage hazard",
      },
      {
        id: "phase6_strike",
        name: "Strike Forecast",
        path: "/scenarios/smoke/phase6_forecast_strike_basic.json",
        description: "Strike mechanics test",
      },
      {
        id: "phase6_duel",
        name: "Enemy Policy Duel",
        path: "/scenarios/smoke/phase6_enemy_policy_duel_basic.json",
        description: "AI policy test",
      },
    ],
  },
  {
    name: "Phase 7 - Content Packs",
    scenarios: [
      {
        id: "phase7_integration",
        name: "Content Pack Integration",
        path: "/scenarios/smoke/phase7_content_pack_integration_basic.json",
        description: "Content pack loading test",
      },
    ],
  },
  {
    name: "Phase 8 - Command Templates",
    scenarios: [
      {
        id: "phase8_spell",
        name: "Spell Entry",
        path: "/scenarios/smoke/phase8_pack_cast_spell_basic.json",
        description: "Content pack spell usage",
      },
      {
        id: "phase8_feat",
        name: "Feat Entry",
        path: "/scenarios/smoke/phase8_pack_use_feat_basic.json",
        description: "Content pack feat usage",
      },
    ],
  },
];

/** Tiled .tmj map files — listed separately from hand-written scenarios. */
interface TiledMapFile {
  id: string;
  name: string;
  path: string;
  description?: string;
}

const TILED_MAP_FILES: TiledMapFile[] = [
  {
    id: "dungeon_arena_01",
    name: "Dungeon Arena 01",
    path: "/maps/dungeon_arena_01.tmj",
    description: "12×10 arena with walls and spawn points",
  },
];

export function ScenarioFileBrowser() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["Smoke Tests"])
  );
  const loadScenario = useDesignerStore((s) => s.loadScenario);
  const setTiledMapPath = useDesignerStore((s) => s.setTiledMapPath);
  const loadBattle = useBattleStore((s) => s.loadBattle);

  const toggleGroup = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const handleLoadScenario = async (scenario: ScenarioFile) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(scenario.path);
      if (!response.ok) {
        throw new Error(`Failed to load: ${response.statusText}`);
      }

      const data = (await response.json()) as ScenarioData;
      loadScenario(scenario.path, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      console.error("Failed to load scenario:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadTiledMap = async (map: TiledMapFile) => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadScenarioFromUrl(map.path);
      loadBattle(result.battle, result.enginePhase, result.tiledMap, result.contentContext, result.rawScenario);
      setTiledMapPath(map.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      console.error("Failed to load Tiled map:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="scenario-file-browser">
      <div className="browser-header">
        <h3>📁 Scenario Browser</h3>
        <p className="browser-subtitle">Select a scenario to view or edit</p>
      </div>

      {error && (
        <div className="browser-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="scenario-groups">
        {SCENARIO_GROUPS.map((group) => {
          const isExpanded = expandedGroups.has(group.name);
          return (
            <div key={group.name} className="scenario-group">
              <button
                className="group-header"
                onClick={() => toggleGroup(group.name)}
              >
                <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
                <span className="group-name">{group.name}</span>
                <span className="group-count">({group.scenarios.length})</span>
              </button>

              {isExpanded && (
                <div className="scenario-list">
                  {group.scenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      className="scenario-item"
                      onClick={() => handleLoadScenario(scenario)}
                      disabled={loading}
                    >
                      <div className="scenario-name">{scenario.name}</div>
                      {scenario.description && (
                        <div className="scenario-description">
                          {scenario.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Tiled Maps section */}
        <div className="scenario-group">
          <button
            className="group-header"
            onClick={() => toggleGroup("Tiled Maps")}
          >
            <span className="expand-icon">{expandedGroups.has("Tiled Maps") ? "▼" : "▶"}</span>
            <span className="group-name">Tiled Maps</span>
            <span className="group-count">({TILED_MAP_FILES.length})</span>
          </button>

          {expandedGroups.has("Tiled Maps") && (
            <div className="scenario-list">
              {TILED_MAP_FILES.map((map) => (
                <button
                  key={map.id}
                  className="scenario-item scenario-item--tiled"
                  onClick={() => handleLoadTiledMap(map)}
                  disabled={loading}
                >
                  <div className="scenario-name">✦ {map.name}</div>
                  {map.description && (
                    <div className="scenario-description">{map.description}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="browser-loading">Loading scenario...</div>
      )}
    </div>
  );
}
