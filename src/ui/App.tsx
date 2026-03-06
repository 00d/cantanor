/**
 * Root application layout — split viewport.
 * Canvas (62%) on left, React UI panels (38%) on right.
 * Inspired by Gold Box tactical RPG style.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { activeUnitId as getActiveUnitId } from "../engine/state";
import { reachableWithPrev, pathTo } from "../grid/movement";
import { PartyPanel } from "./PartyPanel";
import { CombatLogPanel } from "./CombatLogPanel";
import { ActionPanel } from "./ActionPanel";
import { ForecastTooltip } from "./ForecastTooltip";
import { TurnOrderBar } from "./TurnOrderBar";
import { ScenarioLoader } from "./ScenarioLoader";
import { BattleEndOverlay } from "./BattleEndOverlay";
import { CampScreen } from "./CampScreen";
import { ScenarioViewer } from "./designer/ScenarioViewer";
import { initPixiApp, getPixiLayers, getPixiWorld } from "../rendering/pixiApp";
import { renderTileMap, clearTileMap, setHoverTile } from "../rendering/tileRenderer";
import { renderTiledMap, setHoverTileTiled, updateGridOverlay, clearTiledRenderer } from "../rendering/tiledTilemapRenderer";
import { loadTilesetTextures } from "../rendering/tilesetLoader";
import { syncUnits, clearUnits, tickSprites, snapAllSprites } from "../rendering/spriteManager";
import { initCamera, tickCamera, screenToTile, focusTile, resizeCamera, panBy, zoom, setCameraBounds } from "../rendering/cameraController";
import { initEffectRenderer, clearEffectRenderer, processAnimationQueue } from "../rendering/effectRenderer";
import {
  initRangeOverlay,
  showMovementRange,
  showStrikeTargets,
  showAbilityTargets,
  showAllyTargets,
  clearRangeOverlay,
  showPathPreview,
  clearPathPreview,
  showAreaFootprint,
  clearAreaFootprint,
} from "../rendering/rangeOverlay";
import {
  initTerrainOverlay,
  renderTerrainOverlay,
  clearTerrainOverlay,
} from "../rendering/terrainOverlay";

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

  const campaignDefinition = useBattleStore((s) => s.campaignDefinition);
  const campaignProgress   = useBattleStore((s) => s.campaignProgress);
  const showCampScreen     = useBattleStore((s) => s.showCampScreen);
  const healCampaignParty  = useBattleStore((s) => s.healCampaignParty);
  const startCampaignStage = useBattleStore((s) => s.startCampaignStage);
  const clearCampaign      = useBattleStore((s) => s.clearCampaign);

  const selectUnit       = useBattleStore((s) => s.selectUnit);
  const setHoverTileStore = useBattleStore((s) => s.setHoverTile);
  const setTargetMode    = useBattleStore((s) => s.setTargetMode);
  const dispatchCommand  = useBattleStore((s) => s.dispatchCommand);
  const clearBattle      = useBattleStore((s) => s.clearBattle);
  const toggleGrid       = useBattleStore((s) => s.toggleGrid);

  /** URL of the most recently loaded .tmj file — needed to resolve tileset image paths. */
  const tiledMapUrlRef = useRef<string | null>(null);
  /** Whether PixiJS has been initialised. */
  const pixiReadyRef = useRef(false);
  /**
   * Battle load-generation tracker — we only auto-focus the camera when a NEW
   * battle is loaded, not on every state mutation. Without this gate, every
   * strike snaps the camera back to centre. Uses loadGeneration (not battleId)
   * so Play Again of the same scenario is treated as a fresh load — same
   * scenario identity but distinct generation, camera should re-centre.
   */
  const lastLoadGenRef = useRef<number>(-1);

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
      initTerrainOverlay(layers.overlay);
      pixiReadyRef.current = true;

      // Game loop ticker — camera lerp, sprite tweens, animation queue drain.
      // Reads transient state directly (no React subscription) so this
      // fires at 60fps without causing re-renders.
      //
      // Note: on the very first frame after a move dispatch, NEITHER signal
      // is live yet — processAnimationQueue drains the queue to 0 and
      // tickSprites writes activeAnimCount=0 because syncUnits (passive
      // useEffect, below) hasn't armed the tween yet. M2's _scheduleAiTurn
      // handles that with a 2-frame settle debounce; nothing in this
      // callback can paper over it.
      app.ticker.add((ticker) => {
        tickCamera();
        const state = useBattleStore.getState();
        tickSprites(ticker.deltaMS, state.transient);
        if (state.battle) {
          processAnimationQueue(state.transient.animationQueue, state.battle);
        }
      });
    }

    init();
  }, []);

  // ---------------------------------------------------------------------------
  // Sync battle state to PixiJS when battle changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pixiReadyRef.current) return;

    if (!battle) {
      lastLoadGenRef.current = -1;
      try {
        const mapLayer = getPixiLayers().map;
        clearTiledRenderer(mapLayer);
        clearTileMap(mapLayer);
        clearUnits();
        clearRangeOverlay();
        clearTerrainOverlay();
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

        renderTerrainOverlay(battle!.battleMap);
        syncUnits(layers.units, battle!, selectedUnitId, getActiveUnitId(battle!));

        // Only re-centre the camera + snap sprites when a new battle is loaded,
        // not on every state tick. Replays / strikes shouldn't steal the
        // player's pan, and normal moves SHOULD tween.
        const currentGen = useBattleStore.getState().loadGeneration;
        const isNewBattle = currentGen !== lastLoadGenRef.current;
        if (isNewBattle) {
          lastLoadGenRef.current = currentGen;
          // Play Again reuses unit IDs, so sprites survive the reload.
          // syncUnits just armed tweens toward every unit's spawn tile —
          // snap so corpses don't slide home. Must be AFTER syncUnits
          // (targets are set) and in the same effect tick (no frame
          // renders with a backward tween armed).
          snapAllSprites();
          if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            // Skip resize when canvas is hidden (display:none → zero dims)
            if (rect.width > 0 && rect.height > 0) {
              resizeCamera(rect.width, rect.height);
            }
          }
          setCameraBounds(battle!.battleMap.width, battle!.battleMap.height);
          const centerX = (battle!.battleMap.width - 1) / 2;
          const centerY = (battle!.battleMap.height - 1) / 2;
          focusTile(centerX, centerY);
        }
      } catch (err) {
        console.warn("Failed to render battle:", err);
      }
    }

    renderBattle();
  }, [battle, selectedUnitId, tiledMap]);

  // ---------------------------------------------------------------------------
  // Move reachability — memoised so Dijkstra runs once on entering move
  // mode, not once per hover. The same result feeds both the blue tile
  // fills (tiles) and the path preview walk-back (statePrev + bestEntry).
  //
  // Keyed on targetMode?.type rather than targetMode itself because
  // setTargetMode hands back a fresh object every call even when the type
  // hasn't changed; keying on the full object would thrash the memo.
  // ---------------------------------------------------------------------------
  const moveReach = useMemo(() => {
    if (!battle || battleEnded || targetMode?.type !== "move") return null;
    return reachableWithPrev(battle, getActiveUnitId(battle));
  }, [battle, battleEnded, targetMode?.type]);

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
      // moveReach is guaranteed non-null here — the memo's null-gate is the
      // exact inverse of this branch's entry conditions.
      showMovementRange(moveReach!.tiles, battle);
    } else if (targetMode.type === "strike") {
      showStrikeTargets(battle, actorId, targetMode.weaponIndex);
    } else if (targetMode.area) {
      // Area spells don't advertise a fixed target set — any tile is a
      // legal center. Leave the base layer blank; the M5 AoE footprint
      // hover will provide targeting feedback.
      clearRangeOverlay();
    } else if (["spell", "feat", "item"].includes(targetMode.type)) {
      if (targetMode.allyTarget) {
        showAllyTargets(battle, actorId);
      } else {
        showAbilityTargets(battle, actorId);
      }
    }
  }, [targetMode, battle, battleEnded, moveReach]);

  // ---------------------------------------------------------------------------
  // Path preview — on hover during move mode, walk the cached prev map back
  // from the hovered tile and draw the route. pathTo() is O(path length);
  // the expensive search already happened in the memo above.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pixiReadyRef.current) return;

    if (!moveReach || !hoveredTilePos) {
      clearPathPreview();
      return;
    }

    const [hx, hy] = hoveredTilePos;
    // Only preview when hovering inside the blue move range. Hovering a wall
    // or an out-of-range tile should show nothing (not a partial path).
    if (!moveReach.tiles.has(`${hx},${hy}`)) {
      clearPathPreview();
      return;
    }

    const path = pathTo(moveReach, hx, hy);
    if (path) {
      showPathPreview(path);
    } else {
      clearPathPreview();
    }
  }, [hoveredTilePos, moveReach]);

  // ---------------------------------------------------------------------------
  // AoE footprint — on hover during area-target mode, paint the blast diamond
  // centred on the hovered tile. Mirrors reducer's area_save_damage tile set
  // (radiusPoints + LOE filter) so the red tiles are exactly what gets hit.
  //
  // Keyed on targetMode?.area (not targetMode itself) for the same reason as
  // moveReach: setTargetMode returns a fresh object every call, and we only
  // care whether area-mode is active + what the radius is.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pixiReadyRef.current) return;

    if (!battle || !targetMode?.area || !hoveredTilePos) {
      clearAreaFootprint();
      return;
    }

    const [hx, hy] = hoveredTilePos;
    showAreaFootprint(hx, hy, targetMode.area.radiusFeet, battle);
  }, [hoveredTilePos, targetMode?.area, battle]);

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
  // Keyboard shortcuts
  //   Esc         cancel target mode
  //   WASD/arrows pan camera
  //   M / K / E   enter move / strike / end-turn  (S & A are camera pan keys)
  //   G           toggle grid
  //   1-9         trigger nth ability button
  //
  // Dispatches re-read state from the store at keypress time so this effect
  // doesn't need every value in its dependency list (which would otherwise
  // rebind the listener on every re-render).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip all shortcuts when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        if (useBattleStore.getState().targetMode) setTargetMode(null);
        return;
      }

      // Camera pan — WASD / arrows
      const PAN = 48;
      switch (e.key) {
        case "w": case "W": case "ArrowUp":    e.preventDefault(); panBy(0,  PAN); return;
        case "s": case "S": case "ArrowDown":  e.preventDefault(); panBy(0, -PAN); return;
        case "a": case "A": case "ArrowLeft":  e.preventDefault(); panBy( PAN, 0); return;
        case "d": case "D": case "ArrowRight": e.preventDefault(); panBy(-PAN, 0); return;
      }

      // Action shortcuts — guard against AI turns / ended battles / no actions
      const s = useBattleStore.getState();
      if (!s.battle || s.battleEnded || s.isAiTurn) return;
      const actorId = getActiveUnitId(s.battle);
      const actor = s.battle.units[actorId];
      if (!actor) return;
      const isPlayer = s.orchestratorConfig?.playerTeams.includes(actor.team) ?? (actor.team === "pc");
      if (!isPlayer) return;
      const hasActions = actor.actionsRemaining > 0;

      switch (e.key) {
        case "m": case "M":
          if (hasActions) { e.preventDefault(); setTargetMode({ type: "move" }); }
          return;
        case "k": case "K":
          if (hasActions) { e.preventDefault(); setTargetMode({ type: "strike" }); }
          return;
        case "e": case "E":
          e.preventDefault();
          setTargetMode(null);
          dispatchCommand({ type: "end_turn", actor: actorId });
          return;
        case "g": case "G":
          e.preventDefault(); toggleGrid(); return;
      }

      // Number keys 1-9 → click the nth ability button in the ActionPanel.
      // We dispatch a synthetic click so the button's own guard logic
      // (disabled/exhausted/ally-target) is reused rather than duplicated.
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        const buttons = document.querySelectorAll<HTMLButtonElement>(".ability-btn");
        const btn = buttons[idx];
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setTargetMode, dispatchCommand, toggleGrid]);

  // ---------------------------------------------------------------------------
  // Resize observer — keeps PixiJS camera + renderer in sync when the
  // canvas-section changes size (e.g. portrait ↔ landscape media query).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const section = canvas.parentElement;
    if (!section) return;

    const ro = new ResizeObserver(() => {
      if (!pixiReadyRef.current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      resizeCamera(rect.width, rect.height);
    });
    ro.observe(section);
    return () => ro.disconnect();
  }, []);

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
        // Bounds re-set here because the viewport may have resized while
        // hidden — setCameraBounds is cheap and idempotent.
        setCameraBounds(currentBattle.battleMap.width, currentBattle.battleMap.height);
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
        // moveReach is the same memoised Dijkstra that painted the blue
        // tiles — guaranteed non-null here for the same reason as the
        // overlay effect (see memo null-gate). Reuse it instead of searching
        // again to validate.
        if (!moveReach!.tiles.has(`${tx},${ty}`)) {
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
        const strikeCmd: Record<string, unknown> = { type: "strike", actor: actorId, target: targetUnit.unitId };
        if (targetMode.weaponIndex != null) strikeCmd["weapon_index"] = targetMode.weaponIndex;
        dispatchCommand(strikeCmd);
        setTargetMode(null);
        return;
      }

      // ── Area spell ────────────────────────────────────────────────────────
      // Checked before the single-target branch — an area spell with the
      // cursor over a unit should still target the TILE (the player is
      // aiming at the unit's feet, not picking the unit itself). Dispatched
      // as cast_spell so materializeRawCommand's whitelist accepts it; the
      // rewrite to area_save_damage happens inside materialize once it sees
      // the payload's area block.
      if (targetMode.area) {
        const entryId = targetMode.contentEntryId;
        if (!entryId) { setTargetMode(null); return; }
        dispatchCommand({
          type: "cast_spell",
          actor: actorId,
          center_x: tx,
          center_y: ty,
          content_entry_id: entryId,
        });
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
        <ForecastTooltip />
      </div>

      {appMode === "game" && (
        <>
          {/* UI panels section — 38% width */}
          <div className="ui-section">
            <TurnOrderBar />
            {showCampScreen && campaignDefinition && campaignProgress ? (
              <CampScreen
                definition={campaignDefinition}
                progress={campaignProgress}
                onHealAtCamp={healCampaignParty}
                onContinue={() => startCampaignStage()}
                onExitCampaign={() => { clearCampaign(); handleNewScenario(); }}
              />
            ) : (
              <>
                <ScenarioLoader onTiledMapUrl={(url) => { tiledMapUrlRef.current = url; }} />
                <PartyPanel />
                <CombatLogPanel />
                <ActionPanel />
              </>
            )}
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
