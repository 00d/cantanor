/**
 * Scenario Inspector - Display and edit scenario details
 */

import { useDesignerStore } from "../../store/designerStore";
import { useBattleStore } from "../../store/battleStore";
import { battleStateFromScenario } from "../../io/scenarioLoader";
import type { TiledProperty } from "../../io/tiledTypes";

export function ScenarioInspector() {
  const scenarioData = useDesignerStore((s) => s.scenarioData);
  const scenarioPath = useDesignerStore((s) => s.scenarioPath);
  const hasUnsavedChanges = useDesignerStore((s) => s.hasUnsavedChanges);
  const updateBattleId = useDesignerStore((s) => s.updateBattleId);
  const updateSeed = useDesignerStore((s) => s.updateSeed);
  const updateMapSize = useDesignerStore((s) => s.updateMapSize);
  const updateEnginePhase = useDesignerStore((s) => s.updateEnginePhase);
  const clearScenario = useDesignerStore((s) => s.clearScenario);
  const setMode = useDesignerStore((s) => s.setMode);
  const getExportData = useDesignerStore((s) => s.getExportData);
  const markSaved = useDesignerStore((s) => s.markSaved);

  const tiledMap = useBattleStore((s) => s.tiledMap);
  const loadBattle = useBattleStore((s) => s.loadBattle);
  const tiledMapPath = useDesignerStore((s) => s.tiledMapPath);

  if (!scenarioData) {
    if (tiledMap) {
      const spawnsLayer = tiledMap.layers.find(
        (l) => l.name.toLowerCase() === "spawns" && l.type === "objectgroup"
      );
      const spawnObjects = spawnsLayer?.objects?.filter((o) => o.type === "spawn") ?? [];
      const hazardsLayer = tiledMap.layers.find(
        (l) => l.name.toLowerCase() === "hazards" && l.type === "objectgroup"
      );
      const hazardObjects = hazardsLayer?.objects?.filter((o) => o.type === "hazard") ?? [];

      const getProps = (props?: TiledProperty[]): Record<string, unknown> => {
        const record: Record<string, unknown> = {};
        for (const p of props ?? []) record[p.name] = p.value;
        return record;
      };

      return (
        <div className="scenario-inspector tiled-inspector">
          <div className="inspector-header">
            <div className="inspector-title">
              <h3>🗺️ Tiled Map Inspector</h3>
            </div>
            <div className="inspector-actions">
              <button className="btn-close" onClick={clearScenario}>✖</button>
            </div>
          </div>

          <div className="inspector-section">
            <div className="section-label">File Path</div>
            <div className="file-path">{tiledMapPath}</div>
          </div>

          <div className="inspector-section">
            <div className="section-label">Map Size</div>
            <div className="property-grid">
              <div className="property-info">{tiledMap.width} × {tiledMap.height} tiles</div>
              <div className="property-info">{tiledMap.tilewidth} × {tiledMap.tileheight} px per tile</div>
            </div>
          </div>

          <div className="inspector-section">
            <div className="section-label">Layers ({tiledMap.layers.length})</div>
            <div className="units-list">
              {tiledMap.layers.map((layer) => {
                const icon = layer.type === "tilelayer" ? "▦" : layer.type === "objectgroup" ? "◈" : "▷";
                const count =
                  layer.type === "tilelayer"
                    ? `${layer.data?.filter((g) => g > 0).length ?? 0} tiles`
                    : layer.type === "objectgroup"
                    ? `${layer.objects?.length ?? 0} objects`
                    : "";
                return (
                  <div key={layer.id} className="unit-item">
                    <span className="command-type">{icon} {layer.name}</span>
                    <span className="unit-team">({layer.type})</span>
                    {count && <span className="unit-hp">{count}</span>}
                    {!layer.visible && <span className="unit-pos">[hidden]</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="inspector-section">
            <div className="section-label">Tilesets ({tiledMap.tilesets.length})</div>
            <div className="units-list">
              {tiledMap.tilesets.map((ts) => (
                <div key={ts.firstgid} className="unit-item">
                  <span className="unit-id">{ts.name}</span>
                  <span className="unit-hp">{ts.tilecount} tiles</span>
                  <span className="unit-team">(GID {ts.firstgid}+)</span>
                </div>
              ))}
            </div>
          </div>

          {spawnObjects.length > 0 && (
            <div className="inspector-section">
              <div className="section-label">Spawn Points ({spawnObjects.length})</div>
              <div className="units-list">
                {spawnObjects.map((obj) => {
                  const props = getProps(obj.properties);
                  const tx = Math.floor(obj.x / tiledMap.tilewidth);
                  const ty = Math.floor(obj.y / tiledMap.tileheight);
                  return (
                    <div key={obj.id} className="unit-item">
                      <span className="unit-id">{obj.name || `spawn_${obj.id}`}</span>
                      <span className="unit-team">({String(props["team"] ?? "?")})</span>
                      <span className="unit-pos">@ [{tx}, {ty}]</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hazardObjects.length > 0 && (
            <div className="inspector-section">
              <div className="section-label">Hazard Zones ({hazardObjects.length})</div>
              <div className="units-list">
                {hazardObjects.map((obj) => {
                  const props = getProps(obj.properties);
                  const tw = Math.ceil(obj.width / tiledMap.tilewidth);
                  const th = Math.ceil(obj.height / tiledMap.tileheight);
                  return (
                    <div key={obj.id} className="unit-item">
                      <span className="unit-id">{obj.name || `hazard_${obj.id}`}</span>
                      <span className="unit-team">({String(props["element"] ?? "?")})</span>
                      <span className="unit-hp">{tw} × {th} tiles</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="inspector-section">
            <div className="section-label">Edit in Tiled</div>
            <div className="property-info">
              Open <code>{tiledMapPath}</code> in Tiled Map Editor to modify this map.
              Changes take effect on next load.
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="scenario-inspector empty">
        <p>No scenario loaded. Select a scenario from the browser.</p>
      </div>
    );
  }

  const handlePreview = () => {
    try {
      const battleState = battleStateFromScenario(scenarioData);
      const enginePhase = scenarioData.engine_phase ?? 7;
      loadBattle(battleState, enginePhase);
      setMode("preview");
    } catch (err) {
      console.error("Failed to preview scenario:", err);
      alert(`Preview failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleExport = () => {
    const data = getExportData();
    if (!data) return;

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.battle_id || "scenario"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    markSaved();
  };

  const units = scenarioData.units || [];
  const commands = scenarioData.commands || [];
  const objectives = scenarioData.objectives || [];
  const blocked = scenarioData.map?.blocked || [];

  // Count units by team
  const teamCounts: Record<string, number> = {};
  for (const unit of units) {
    const team = String(unit["team"] || "unknown");
    teamCounts[team] = (teamCounts[team] || 0) + 1;
  }

  return (
    <div className="scenario-inspector">
      {/* Header */}
      <div className="inspector-header">
        <div className="inspector-title">
          <h3>📋 Scenario Inspector</h3>
          {hasUnsavedChanges && <span className="unsaved-indicator">●</span>}
        </div>
        <div className="inspector-actions">
          <button className="btn-preview" onClick={handlePreview}>
            ▶️ Preview
          </button>
          <button className="btn-export" onClick={handleExport}>
            💾 Export JSON
          </button>
          <button className="btn-close" onClick={clearScenario}>
            ✖
          </button>
        </div>
      </div>

      {/* File info */}
      <div className="inspector-section">
        <div className="section-label">File Path</div>
        <div className="file-path">{scenarioPath}</div>
      </div>

      {/* Basic Properties */}
      <div className="inspector-section">
        <div className="section-label">Basic Properties</div>
        <div className="property-grid">
          <label>
            Battle ID:
            <input
              type="text"
              value={scenarioData.battle_id}
              onChange={(e) => updateBattleId(e.target.value)}
              className="property-input"
            />
          </label>

          <label>
            Seed:
            <input
              type="number"
              value={scenarioData.seed}
              onChange={(e) => updateSeed(parseInt(e.target.value, 10))}
              className="property-input"
            />
          </label>

          <label>
            Engine Phase:
            <input
              type="number"
              value={scenarioData.engine_phase ?? 7}
              onChange={(e) => updateEnginePhase(parseInt(e.target.value, 10))}
              className="property-input"
              min="1"
              max="10"
            />
          </label>
        </div>
      </div>

      {/* Map Properties */}
      <div className="inspector-section">
        <div className="section-label">Map</div>
        <div className="property-grid">
          <label>
            Width:
            <input
              type="number"
              value={scenarioData.map.width}
              onChange={(e) =>
                updateMapSize(
                  parseInt(e.target.value, 10),
                  scenarioData.map.height
                )
              }
              className="property-input"
              min="5"
              max="50"
            />
          </label>

          <label>
            Height:
            <input
              type="number"
              value={scenarioData.map.height}
              onChange={(e) =>
                updateMapSize(
                  scenarioData.map.width,
                  parseInt(e.target.value, 10)
                )
              }
              className="property-input"
              min="5"
              max="50"
            />
          </label>

          <div className="property-info">
            Blocked Tiles: {blocked.length}
          </div>
        </div>
      </div>

      {/* Units */}
      <div className="inspector-section">
        <div className="section-label">Units ({units.length})</div>
        <div className="units-summary">
          {Object.entries(teamCounts).map(([team, count]) => (
            <div key={team} className="team-summary">
              <span className="team-name">{team}:</span>
              <span className="team-count">{count}</span>
            </div>
          ))}
        </div>
        <div className="units-list">
          {units.map((unit, idx) => (
            <div key={idx} className="unit-item">
              <span className="unit-id">{String(unit["id"])}</span>
              <span className="unit-team">({String(unit["team"])})</span>
              <span className="unit-hp">HP: {String(unit["hp"])}</span>
              <span className="unit-pos">
                @ [{String((unit["position"] as number[])?.[0])}, {String((unit["position"] as number[])?.[1])}]
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Commands */}
      <div className="inspector-section">
        <div className="section-label">Commands ({commands.length})</div>
        <div className="commands-list">
          {commands.slice(0, 10).map((cmd, idx) => (
            <div key={idx} className="command-item">
              <span className="command-type">{String(cmd["type"])}</span>
              {cmd["actor"] !== undefined && cmd["actor"] !== null && (
                <span className="command-actor">
                  by {String(cmd["actor"])}
                </span>
              )}
            </div>
          ))}
          {commands.length > 10 && (
            <div className="command-more">
              ... and {commands.length - 10} more
            </div>
          )}
        </div>
      </div>

      {/* Objectives */}
      {objectives.length > 0 && (
        <div className="inspector-section">
          <div className="section-label">Objectives ({objectives.length})</div>
          <div className="objectives-list">
            {objectives.map((obj, idx) => (
              <div key={idx} className="objective-item">
                <span className="objective-id">{String(obj["id"])}</span>
                <span className="objective-type">({String(obj["type"])})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
