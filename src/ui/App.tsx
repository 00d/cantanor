/**
 * Root application layout — split viewport.
 * Canvas (62%) on left, React UI panels (38%) on right.
 * Inspired by Gold Box tactical RPG style.
 */

import { useEffect, useRef } from "react";
import { useBattleStore } from "../store/battleStore";
import { PartyPanel } from "./PartyPanel";
import { CombatLogPanel } from "./CombatLogPanel";
import { ActionPanel } from "./ActionPanel";
import { ScenarioLoader } from "./ScenarioLoader";
import { initPixiApp, getPixiLayers } from "../rendering/pixiApp";
import { renderTileMap, setHoverTile } from "../rendering/tileRenderer";
import { syncUnits } from "../rendering/spriteManager";
import { initCamera, tickCamera, screenToTile } from "../rendering/cameraController";
import { initEffectRenderer } from "../rendering/effectRenderer";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const battle = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const hoveredTilePos = useBattleStore((s) => s.hoveredTilePos);
  const selectUnit = useBattleStore((s) => s.selectUnit);
  const setHoverTileStore = useBattleStore((s) => s.setHoverTile);

  // Initialize PixiJS on mount
  useEffect(() => {
    if (!canvasRef.current) return;

    async function init() {
      if (!canvasRef.current) return;
      const app = await initPixiApp(canvasRef.current);
      const layers = getPixiLayers();
      initCamera(app.stage, app.screen.width, app.screen.height);
      initEffectRenderer(layers.effects);

      // Game loop ticker
      app.ticker.add(() => {
        tickCamera();
      });
    }

    init();
  }, []);

  // Sync battle state to PixiJS when battle changes
  useEffect(() => {
    if (!battle) return;
    try {
      const layers = getPixiLayers();
      renderTileMap(layers.map, battle.battleMap);
      syncUnits(layers.units, battle, selectedUnitId);
    } catch {
      // PixiJS not ready yet
    }
  }, [battle, selectedUnitId]);

  // Sync hover tile
  useEffect(() => {
    setHoverTile(hoveredTilePos);
  }, [hoveredTilePos]);

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const [tx, ty] = screenToTile(e.clientX - rect.left, e.clientY - rect.top);
    if (battle && tx >= 0 && ty >= 0 && tx < battle.battleMap.width && ty < battle.battleMap.height) {
      setHoverTileStore([tx, ty]);
    } else {
      setHoverTileStore(null);
    }
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || !battle) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const [tx, ty] = screenToTile(e.clientX - rect.left, e.clientY - rect.top);

    // Find unit at clicked tile
    const unitAtTile = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
    if (unitAtTile) {
      selectUnit(selectedUnitId === unitAtTile.unitId ? null : unitAtTile.unitId);
    }
  }

  function handleCanvasLeave() {
    setHoverTileStore(null);
  }

  return (
    <div className="app-root">
      {/* Canvas section — 62% width */}
      <div className="canvas-section">
        <canvas
          ref={canvasRef}
          className="battle-canvas"
          onMouseMove={handleCanvasMouseMove}
          onClick={handleCanvasClick}
          onMouseLeave={handleCanvasLeave}
        />
      </div>

      {/* UI panels section — 38% width */}
      <div className="ui-section">
        <ScenarioLoader />
        <PartyPanel />
        <CombatLogPanel />
        <ActionPanel />
      </div>
    </div>
  );
}
