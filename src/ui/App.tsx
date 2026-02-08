/**
 * Root application layout — split viewport.
 * Canvas (62%) on left, React UI panels (38%) on right.
 * Inspired by Gold Box tactical RPG style.
 */

import { useEffect, useRef, useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { activeUnitId as getActiveUnitId } from "../engine/state";
import { PartyPanel } from "./PartyPanel";
import { CombatLogPanel } from "./CombatLogPanel";
import { ActionPanel } from "./ActionPanel";
import { ScenarioLoader } from "./ScenarioLoader";
import { ScenarioViewer } from "./designer/ScenarioViewer";
import { initPixiApp, getPixiLayers } from "../rendering/pixiApp";
import { renderTileMap, setHoverTile } from "../rendering/tileRenderer";
import { syncUnits } from "../rendering/spriteManager";
import { initCamera, tickCamera, screenToTile, focusTile, resizeCamera } from "../rendering/cameraController";
import { initEffectRenderer } from "../rendering/effectRenderer";

type AppMode = "game" | "designer";

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("game");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const battle = useBattleStore((s) => s.battle);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const hoveredTilePos = useBattleStore((s) => s.hoveredTilePos);
  const targetMode = useBattleStore((s) => s.targetMode);
  const selectUnit = useBattleStore((s) => s.selectUnit);
  const setHoverTileStore = useBattleStore((s) => s.setHoverTile);
  const setTargetMode = useBattleStore((s) => s.setTargetMode);
  const dispatchCommand = useBattleStore((s) => s.dispatchCommand);

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

      // Center camera on the map when battle first loads
      const centerX = (battle.battleMap.width - 1) / 2;
      const centerY = (battle.battleMap.height - 1) / 2;

      // Update camera viewport size in case window was resized
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        resizeCamera(rect.width, rect.height);
      }

      // Focus camera on map center
      focusTile(centerX, centerY);
    } catch (err) {
      // PixiJS not ready yet or other error
      console.warn("Failed to render battle:", err);
    }
  }, [battle, selectedUnitId]);

  // Sync hover tile
  useEffect(() => {
    setHoverTile(hoveredTilePos);
  }, [hoveredTilePos]);

  // ESC key cancels target mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && targetMode) {
        setTargetMode(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [targetMode, setTargetMode]);

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

    // Check if click is in bounds
    if (tx < 0 || ty < 0 || tx >= battle.battleMap.width || ty >= battle.battleMap.height) {
      return;
    }

    // Handle target mode actions
    if (targetMode) {
      const actorId = getActiveUnitId(battle);
      const activeUnit = battle.units[actorId];

      if (targetMode.type === "move") {
        // Validate move (must be adjacent, not blocked, not occupied)
        const dx = Math.abs(tx - activeUnit.x);
        const dy = Math.abs(ty - activeUnit.y);
        const isAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);

        const blockedSet = new Set(battle.battleMap.blocked.map(([x, y]) => `${x},${y}`));
        const isBlocked = blockedSet.has(`${tx},${ty}`);

        const unitAtTile = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
        const isOccupied = unitAtTile !== undefined;

        if (!isAdjacent) {
          console.warn("Cannot move: tile is not adjacent");
          return;
        }
        if (isBlocked) {
          console.warn("Cannot move: tile is blocked");
          return;
        }
        if (isOccupied) {
          console.warn("Cannot move: tile is occupied");
          return;
        }

        // Dispatch move command
        dispatchCommand({ type: "move", actor: actorId, x: tx, y: ty });
        setTargetMode(null);
        return;
      }

      if (targetMode.type === "strike") {
        // Find unit at tile
        const targetUnit = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
        if (!targetUnit) {
          console.warn("Cannot strike: no unit at tile");
          return;
        }

        // Check if enemy
        if (targetUnit.team === activeUnit.team) {
          console.warn("Cannot strike: unit is on same team");
          return;
        }

        // Dispatch strike command
        dispatchCommand({ type: "strike", actor: actorId, target: targetUnit.unitId });
        setTargetMode(null);
        return;
      }

      // Cancel target mode on any other click
      setTargetMode(null);
      return;
    }

    // Default behavior: select unit at tile
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
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={`mode-btn ${appMode === "game" ? "active" : ""}`}
          onClick={() => setAppMode("game")}
        >
          🎮 Game
        </button>
        <button
          className={`mode-btn ${appMode === "designer" ? "active" : ""}`}
          onClick={() => setAppMode("designer")}
        >
          🛠️ Designer
        </button>
      </div>

      {appMode === "game" ? (
        <>
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
        </>
      ) : (
        /* Designer Mode */
        <div className="designer-section">
          <ScenarioViewer />
        </div>
      )}
    </div>
  );
}
