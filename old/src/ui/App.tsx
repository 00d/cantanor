/**
 * Root application layout — split viewport.
 * Canvas (62%) on left, React UI panels (38%) on right.
 * Inspired by Gold Box tactical RPG style.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useBattleStore } from "../store/battleStore";
import { activeUnitId as getActiveUnitId } from "../engine/state";
import { reachableWithPrev, pathTo } from "../grid/movement";
import { TurnOrderRibbon } from "./TurnOrderRibbon";
import { PartyPanel } from "./PartyPanel";
import { CombatLogPanel } from "./CombatLogPanel";
import { ActionPanel } from "./ActionPanel";
import { ForecastTooltip } from "./ForecastTooltip";
import { ScenarioLoader } from "./ScenarioLoader";
import { BattleEndOverlay } from "./BattleEndOverlay";
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
  const loadGeneration = useBattleStore((s) => s.loadGeneration);
  const undoGeneration = useBattleStore((s) => s.undoGeneration);

  const selectUnit       = useBattleStore((s) => s.selectUnit);
  const setHoverTileStore = useBattleStore((s) => s.setHoverTile);
  const setTargetMode    = useBattleStore((s) => s.setTargetMode);
  const dispatchCommand  = useBattleStore((s) => s.dispatchCommand);
  const clearBattle      = useBattleStore((s) => s.clearBattle);
  const toggleGrid       = useBattleStore((s) => s.toggleGrid);
  const undo             = useBattleStore((s) => s.undo);

  /** URL of the most recently loaded .tmj file — needed to resolve tileset image paths. */
  const tiledMapUrlRef = useRef<string | null>(null);
  /** Whether PixiJS has been initialised. */
  const pixiReadyRef = useRef(false);
  /**
   * Load-generation tracker — we only auto-focus the camera and snap sprites
   * when a fresh battle is loaded, not on every state mutation. Tracking
   * battleId is not sufficient because Play Again reloads the same scenario
   * with the same battleId; the store's monotonic loadGeneration bumps on
   * every loadBattle/loadSavedGame regardless.
   */
  const lastLoadGenRef = useRef(0);
  /**
   * Undo-generation tracker — same snap-after-syncUnits pattern as
   * lastLoadGenRef but a different signal, because the load branch ALSO
   * re-centres the camera and we don't want that on undo. Undoing a move
   * shouldn't yank the viewport to the map midpoint.
   */
  const lastUndoGenRef = useRef(0);

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

      // Game loop ticker — camera lerp + sprite tween + animation queue drain.
      // Reads transient state directly (no React subscription) so this
      // fires at 60fps without causing re-renders.
      //
      // Note: on the very first frame after a move dispatch, NEITHER signal
      // is live yet — processAnimationQueue drains the queue to 0 and
      // tickSprites writes activeAnimCount=0 because syncUnits (passive
      // useEffect, below) hasn't armed the tween yet. _scheduleAiTurn
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
  // Keep camera view dimensions in sync with the canvas element.
  //
  // Pixi's own `resizeTo: canvas.parentElement` (pixiApp.ts) already resizes
  // the WebGL backbuffer — that side is covered. What ISN'T covered is
  // cameraController's private _viewWidth/_viewHeight, which focusTile() and
  // the wheel-zoom pivot both read. Without this, resizing the window (or any
  // future media-query reflow) leaves those numbers stale: focusTile lerps
  // toward the old centre and zoom pivots around the wrong point. Clicks are
  // fine regardless — screenToTile never reads _viewWidth.
  //
  // The two manual resizeCamera() calls in the fresh-load path and the
  // appMode path are intentionally kept. Both are immediately followed by
  // focusTile(), and focusTile() reads _viewWidth synchronously. The observer
  // fires async at end-of-frame; it can't win that race. The manual calls are
  // the sync-calibrate-then-use path, this observer is the keep-it-calibrated
  // path. They overlap harmlessly (resizeCamera is idempotent).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver((entries) => {
      // Single observed element → single entry. contentRect is the content
      // box; the canvas has no padding so that's the drawable area.
      const { width, height } = entries[0].contentRect;
      // display:none (designer mode) reports 0×0. Don't calibrate to zero —
      // the next resize when display flips back will carry the real numbers.
      if (width > 0 && height > 0) {
        resizeCamera(width, height);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
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

        // Only re-centre the camera + snap sprites on a fresh load, not on
        // every state tick. Replays / strikes shouldn't steal the player's pan.
        const isFreshLoad = loadGeneration !== lastLoadGenRef.current;
        if (isFreshLoad) {
          lastLoadGenRef.current = loadGeneration;
          // Play Again reuses unit IDs, so sprites survive the reload.
          // syncUnits just armed tweens toward every unit's spawn tile —
          // snap so corpses don't slide home.
          snapAllSprites();
          if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            // Skip resize when canvas is hidden (display:none → zero dims)
            if (rect.width > 0 && rect.height > 0) {
              resizeCamera(rect.width, rect.height);
            }
          }
          // World extent is known from the battle regardless of canvas
          // visibility — arm the clamp unconditionally so tickCamera is
          // bounded by the time the canvas reappears (designer-mode toggle).
          // Must come before focusTile only by convention (grouping all
          // "calibrate camera to new world" calls together); the clamp
          // actually runs in tickCamera so the order here doesn't matter.
          setCameraBounds(battle!.battleMap.width, battle!.battleMap.height);
          const centerX = (battle!.battleMap.width - 1) / 2;
          const centerY = (battle!.battleMap.height - 1) / 2;
          focusTile(centerX, centerY);
        }

        // Undo snap — syncUnits above just armed tweens toward the pre-undo
        // positions. Without this, the undone unit slides backward as if it
        // walked. Undo is discontinuous; it shouldn't animate. Separate from
        // isFreshLoad so we get the snap without the camera-to-midpoint.
        //
        // Ordering: this has to be AFTER syncUnits (otherwise we'd snap to the
        // post-action targets, then syncUnits would re-arm tweens anyway) and
        // in the same effect tick (so no frame is rendered with the wrong
        // tween in flight). Checking a ref-tracked generation inside this
        // effect gets both for free.
        if (undoGeneration !== lastUndoGenRef.current) {
          lastUndoGenRef.current = undoGeneration;
          snapAllSprites();
        }
      } catch (err) {
        console.warn("Failed to render battle:", err);
      }
    }

    renderBattle();
  }, [battle, selectedUnitId, tiledMap, loadGeneration, undoGeneration]);

  // ---------------------------------------------------------------------------
  // Move reachability — memoised so Dijkstra runs once on entering move
  // mode, not once per hover. `prev` is kept around for pathTo().
  //
  // Keyed on targetMode?.type (not targetMode) because targetMode is a fresh
  // object on every setTargetMode() call even when the type hasn't changed.
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
      // moveReach is guaranteed non-null here — the memo gate at its
      // definition is the exact inverse of this branch's entry conditions.
      showMovementRange(moveReach!.tiles, battle);
    } else if (targetMode.type === "strike") {
      showStrikeTargets(battle, actorId);
    } else if (targetMode.area) {
      // Area spells don't advertise a fixed target set — any tile is a
      // legal center. Leave the base layer blank; the red blast diamond
      // (painted by the hover effect below) IS the targeting feedback.
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

    const path = pathTo(moveReach.prev, hx, hy);
    if (path) {
      showPathPreview(path);
    } else {
      clearPathPreview();
    }
  }, [hoveredTilePos, moveReach]);

  // ---------------------------------------------------------------------------
  // Area footprint — on hover during area-targeting mode, paint the blast
  // radius centred on the cursor. Redrawn every mouse-move; the LOE walk is
  // one Bresenham line per tile in the diamond, negligible at 4-tile radius
  // (41 tiles). Keying on targetMode.area — if the player swaps from a
  // 20ft spell to a 10ft one without moving the mouse, the footprint shrinks.
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
  //   Ctrl/Cmd+Z  undo last action
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

      // Undo — checked BEFORE the battleEnded guard so you can undo the
      // winning blow. ("Did I really want to fireball the last goblin? Let
      // me see what a crit-strike does instead.") The stack is only non-empty
      // during a PC turn (flushed on end_turn, AI dispatches don't push), and
      // popping a snapshot restores a by-definition-not-ended battle state,
      // so this can't put the game in a weird place. undo() itself no-ops on
      // an empty stack, so the only guard that matters here is isAiTurn — and
      // even that's belt-and-suspenders (stack is empty during AI turns).
      // metaKey covers Cmd on Mac; Ctrl works everywhere.
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        const s = useBattleStore.getState();
        if (!s.isAiTurn) {
          e.preventDefault();
          undo();
        }
        return;
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
  }, [setTargetMode, dispatchCommand, toggleGrid, undo]);

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
        // moveReach is the same memoised Dijkstra that painted the blue tiles
        // — guaranteed non-null here (line 450 rules out !battle/battleEnded,
        // this if rules out the type mismatch; together those are the memo's
        // whole null-gate). Reuse it instead of searching again to validate.
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
        dispatchCommand({ type: "strike", actor: actorId, target: targetUnit.unitId });
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

      // ── Spell / Feat / Item (single target) ───────────────────────────────
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
            <ScenarioLoader onTiledMapUrl={(url) => { tiledMapUrlRef.current = url; }} />
            <TurnOrderRibbon />
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
