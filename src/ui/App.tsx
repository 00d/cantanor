/**
 * Root application layout — split viewport.
 * Canvas (62%) on left, React UI panels (38%) on right.
 * Inspired by Gold Box tactical RPG style.
 */

import { useEffect, useRef, useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { activeUnitId as getActiveUnitId } from "../engine/state";
import { reachableTiles } from "../grid/movement";
import { PartyPanel } from "./PartyPanel";
import { CombatLogPanel } from "./CombatLogPanel";
import { ActionPanel } from "./ActionPanel";
import { ScenarioLoader } from "./ScenarioLoader";
import { BattleEndOverlay } from "./BattleEndOverlay";
import { ScenarioViewer } from "./designer/ScenarioViewer";
import { initPixiApp, getPixiLayers, getPixiWorld } from "../rendering/pixiApp";
import { renderTileMap, clearTileMap, setHoverTile } from "../rendering/tileRenderer";
import { renderTiledMap, setHoverTileTiled, updateGridOverlay, clearTiledRenderer } from "../rendering/tiledTilemapRenderer";
import { loadTilesetTextures } from "../rendering/tilesetLoader";
import { syncUnits, clearUnits } from "../rendering/spriteManager";
import { initCamera, tickCamera, screenToTile, focusTile, resizeCamera, panBy, zoom } from "../rendering/cameraController";
import { initEffectRenderer, clearEffectRenderer } from "../rendering/effectRenderer";
import {
  initRangeOverlay,
  showMovementRange,
  showStrikeTargets,
  showAbilityTargets,
  showAllyTargets,
  clearRangeOverlay,
} from "../rendering/rangeOverlay";

type AppMode = "game" | "designer";

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("game");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const battle        = useBattleStore((s) => s.battle);
  const tiledMap      = useBattleStore((s) => s.tiledMap);
  const showGrid      = useBattleStore((s) => s.showGrid);
  const selectedUnitId = useBattleStore((s) => s.selectedUnitId);
  const hoveredTilePos = useBattleStore((s) => s.hoveredTilePos);
  const targetMode    = useBattleStore((s) => s.targetMode);
  const battleEnded   = useBattleStore((s) => s.battleEnded);
  const isAiTurn      = useBattleStore((s) => s.isAiTurn);

  const selectUnit       = useBattleStore((s) => s.selectUnit);
  const setHoverTileStore = useBattleStore((s) => s.setHoverTile);
  const setTargetMode    = useBattleStore((s) => s.setTargetMode);
  const dispatchCommand  = useBattleStore((s) => s.dispatchCommand);
  const clearBattle      = useBattleStore((s) => s.clearBattle);

  /** URL of the most recently loaded .tmj file — needed to resolve tileset image paths. */
  const tiledMapUrlRef = useRef<string | null>(null);
  /** Whether PixiJS has been initialised. */
  const pixiReadyRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Initialize PixiJS on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current) return;

    async function init() {
      if (!canvasRef.current) return;
      const app = await initPixiApp(canvasRef.current);
      const layers = getPixiLayers();
      initCamera(getPixiWorld(), app.screen.width, app.screen.height);
      initEffectRenderer(layers.effects);
      initRangeOverlay(layers.overlay);
      pixiReadyRef.current = true;

      // Game loop ticker
      app.ticker.add(() => { tickCamera(); });
    }

    init();
  }, []);

  // ---------------------------------------------------------------------------
  // Sync battle state to PixiJS when battle changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pixiReadyRef.current) return;

    if (!battle) {
      try {
        const mapLayer = getPixiLayers().map;
        clearTiledRenderer(mapLayer);
        clearTileMap(mapLayer);
        clearUnits();
        clearRangeOverlay();
        clearEffectRenderer();
      } catch { /* PixiJS not yet ready */ }
      return;
    }

    async function renderBattle() {
      try {
        const layers = getPixiLayers();

        if (tiledMap && tiledMapUrlRef.current) {
          const textures = await loadTilesetTextures(tiledMap, tiledMapUrlRef.current);
          renderTiledMap(layers.map, tiledMap, textures, showGrid);
        } else {
          clearTiledRenderer(layers.map);
          renderTileMap(layers.map, battle!.battleMap);
        }

        syncUnits(layers.units, battle!, selectedUnitId, getActiveUnitId(battle!));

        const centerX = (battle!.battleMap.width - 1) / 2;
        const centerY = (battle!.battleMap.height - 1) / 2;
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          // Skip resize when canvas is hidden (display:none → zero dims)
          if (rect.width > 0 && rect.height > 0) {
            resizeCamera(rect.width, rect.height);
          }
        }
        focusTile(centerX, centerY);
      } catch (err) {
        console.warn("Failed to render battle:", err);
      }
    }

    renderBattle();
  }, [battle, selectedUnitId, tiledMap]);

  // ---------------------------------------------------------------------------
  // Range overlay — update whenever targetMode or battle changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pixiReadyRef.current || !battle || battleEnded) {
      clearRangeOverlay();
      return;
    }

    if (!targetMode) {
      clearRangeOverlay();
      return;
    }

    const actorId = getActiveUnitId(battle);

    if (targetMode.type === "move") {
      const tiles = reachableTiles(battle, actorId);
      showMovementRange(tiles, battle);
    } else if (targetMode.type === "strike") {
      showStrikeTargets(battle, actorId);
    } else if (["spell", "feat", "item"].includes(targetMode.type)) {
      if (targetMode.allyTarget) {
        showAllyTargets(battle, actorId);
      } else {
        showAbilityTargets(battle, actorId);
      }
    }
  }, [targetMode, battle, battleEnded]);

  // ---------------------------------------------------------------------------
  // Sync grid overlay when showGrid changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (tiledMap) updateGridOverlay(showGrid);
  }, [showGrid, tiledMap]);

  // ---------------------------------------------------------------------------
  // Sync hover tile
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (tiledMap) {
      setHoverTileTiled(hoveredTilePos);
    } else {
      setHoverTile(hoveredTilePos);
    }
  }, [hoveredTilePos, tiledMap]);

  // ---------------------------------------------------------------------------
  // ESC key cancels target mode; WASD / arrows pan the camera
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && targetMode) {
        setTargetMode(null);
        return;
      }
      // Skip camera pan when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const PAN = 48;
      switch (e.key) {
        case "w": case "W": case "ArrowUp":    e.preventDefault(); panBy(0,  PAN); break;
        case "s": case "S": case "ArrowDown":  e.preventDefault(); panBy(0, -PAN); break;
        case "a": case "A": case "ArrowLeft":  e.preventDefault(); panBy( PAN, 0); break;
        case "d": case "D": case "ArrowRight": e.preventDefault(); panBy(-PAN, 0); break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [targetMode, setTargetMode]);

  // ---------------------------------------------------------------------------
  // Scroll wheel zoom (non-passive so we can preventDefault)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = canvas.getBoundingClientRect();
      zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  // ---------------------------------------------------------------------------
  // Re-sync camera when returning to game mode
  // The canvas is kept in the DOM (display:none) while in designer mode so the
  // PixiJS WebGL context is preserved.  When we un-hide it, we need to restore
  // the correct viewport dimensions and re-focus — getBoundingClientRect()
  // returns zero while the element is hidden.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (appMode !== "game" || !pixiReadyRef.current) return;
    requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      resizeCamera(rect.width, rect.height);
      const currentBattle = useBattleStore.getState().battle;
      if (currentBattle) {
        focusTile(
          (currentBattle.battleMap.width - 1) / 2,
          (currentBattle.battleMap.height - 1) / 2,
        );
      }
    });
  }, [appMode]);

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------
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
    if (!canvasRef.current || !battle || battleEnded || isAiTurn) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const [tx, ty] = screenToTile(e.clientX - rect.left, e.clientY - rect.top);

    if (tx < 0 || ty < 0 || tx >= battle.battleMap.width || ty >= battle.battleMap.height) return;

    if (targetMode) {
      const actorId  = getActiveUnitId(battle);
      const activeUnit = battle.units[actorId];

      // ── Move ──────────────────────────────────────────────────────────────
      if (targetMode.type === "move") {
        const reachable = reachableTiles(battle, actorId);
        if (!reachable.has(`${tx},${ty}`)) {
          // Invalid move tile — inspect any unit standing there instead
          const unitAtTile = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
          if (unitAtTile) selectUnit(unitAtTile.unitId);
          return;
        }
        dispatchCommand({ type: "move", actor: actorId, x: tx, y: ty });
        setTargetMode(null);
        return;
      }

      // ── Strike ────────────────────────────────────────────────────────────
      if (targetMode.type === "strike") {
        const targetUnit = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
        if (!targetUnit) { return; }
        if (targetUnit.team === activeUnit.team) {
          // Clicked an ally — inspect them instead of striking
          selectUnit(targetUnit.unitId);
          return;
        }
        dispatchCommand({ type: "strike", actor: actorId, target: targetUnit.unitId });
        setTargetMode(null);
        return;
      }

      // ── Spell / Feat / Item ───────────────────────────────────────────────
      if (["spell", "feat", "item"].includes(targetMode.type)) {
        const entryId = targetMode.contentEntryId;
        if (!entryId) { setTargetMode(null); return; }

        const unitAtTile = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
        if (!unitAtTile) { return; }

        const isAlly = unitAtTile.team === activeUnit.team;
        const wantsAlly = targetMode.allyTarget ?? false;
        if (isAlly !== wantsAlly) {
          // Wrong target type — inspect them instead
          selectUnit(unitAtTile.unitId);
          return;
        }

        const cmdType = targetMode.type === "spell"
          ? "cast_spell"
          : targetMode.type === "feat"
            ? "use_feat"
            : "use_item";

        dispatchCommand({
          type: cmdType,
          actor: actorId,
          target: unitAtTile.unitId,
          content_entry_id: entryId,
        });
        setTargetMode(null);
        return;
      }

      setTargetMode(null);
      return;
    }

    // Default: select unit at tile
    const unitAtTile = Object.values(battle.units).find((u) => u.x === tx && u.y === ty);
    if (unitAtTile) {
      selectUnit(selectedUnitId === unitAtTile.unitId ? null : unitAtTile.unitId);
    }
  }

  function handleCanvasLeave() {
    setHoverTileStore(null);
  }

  // ---------------------------------------------------------------------------
  // "New Scenario" handler — clears battle so the ScenarioLoader appears again
  // ---------------------------------------------------------------------------
  function handleNewScenario() {
    clearBattle();
    tiledMapUrlRef.current = null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app-root">
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button className={`mode-btn ${appMode === "game" ? "active" : ""}`} onClick={() => setAppMode("game")}>
          🎮 Game
        </button>
        <button className={`mode-btn ${appMode === "designer" ? "active" : ""}`} onClick={() => setAppMode("designer")}>
          🛠️ Designer
        </button>
      </div>

      {/* Canvas — always in DOM so the PixiJS WebGL context is never destroyed.
           Hidden via display:none in designer mode; takes no layout space. */}
      <div className="canvas-section" style={appMode !== "game" ? { display: "none" } : undefined}>
        <canvas
          ref={canvasRef}
          className="battle-canvas"
          onMouseMove={handleCanvasMouseMove}
          onClick={handleCanvasClick}
          onMouseLeave={handleCanvasLeave}
        />
      </div>

      {appMode === "game" && (
        <>
          {/* UI panels section — 38% width */}
          <div className="ui-section">
            <ScenarioLoader onTiledMapUrl={(url) => { tiledMapUrlRef.current = url; }} />
            <PartyPanel />
            <CombatLogPanel />
            <ActionPanel />
          </div>

          {/* Battle-end overlay — renders on top of everything */}
          {battleEnded && <BattleEndOverlay onNewScenario={handleNewScenario} />}
        </>
      )}

      {appMode === "designer" && (
        <div className="designer-section">
          <ScenarioViewer />
        </div>
      )}
    </div>
  );
}
