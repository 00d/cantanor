import { Application } from 'pixi.js';
import { GameBridge } from './engine/GameBridge';
import { WorldMapView } from './views/WorldMapView';
import { TacticalMapView } from './views/TacticalMapView';
import { UIManager } from './ui/UIManager';
import type { WorldMapState, TacticalState, MoveResult } from './types';

// ─── Bootstrap ──────────────────────────────────────────────────────
const app = new Application();
const bridge = new GameBridge();
const ui = new UIManager();

let worldView: WorldMapView | null = null;
let tacticalView: TacticalMapView | null = null;
let currentView: string = '';

// Tactical state
let selectedCharIndex = 0;
let partyMemberIds: number[] = [];

async function main(): Promise<void> {
  // Initialize PixiJS
  await app.init({
    resizeTo: window,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  });
  document.getElementById('game-container')!.prepend(app.canvas);

  // Initialize WASM game engine
  await bridge.init();

  // Initial render
  refreshView();

  // Input handling
  setupInput();

  // Game loop for smooth camera
  app.ticker.add(() => {
    smoothUpdate();
  });
}

// ─── View Management ────────────────────────────────────────────────
function refreshView(): void {
  const viewMode = bridge.getViewMode();
  const viewState = bridge.getViewState();
  const partyInfo = bridge.getPartyInfo();
  const gameTime = bridge.getGameTime();

  // Update UI
  ui.updatePartyBar(partyInfo);
  ui.updateGameTime(gameTime);
  ui.setControlsHint(viewMode);

  // Store party member IDs for tactical selection
  partyMemberIds = partyInfo.map((m) => m.id);

  if (viewMode !== currentView) {
    switchView(viewMode);
  }

  // Render appropriate view
  if (viewMode === 'world_map' && worldView && 'WorldMap' in (viewState as object)) {
    const state = (viewState as WorldMapState).WorldMap;
    ui.setLocationName('World Map');
    worldView.render(state, app.screen.width, app.screen.height);
  } else if (
    (viewMode === 'tactical_exploration' || viewMode === 'tactical_combat') &&
    tacticalView &&
    'Tactical' in (viewState as object)
  ) {
    const state = (viewState as TacticalState).Tactical;
    ui.setLocationName(state.map_name || 'Tactical Map');
    const selectedId = partyMemberIds[selectedCharIndex] ?? null;
    tacticalView.render(state, app.screen.width, app.screen.height, selectedId);
  }
}

function switchView(newMode: string): void {
  // Clean up old view
  if (worldView) {
    app.stage.removeChild(worldView.container);
    worldView.destroy();
    worldView = null;
  }
  if (tacticalView) {
    app.stage.removeChild(tacticalView.container);
    tacticalView.destroy();
    tacticalView = null;
  }

  // Create new view
  if (newMode === 'world_map') {
    worldView = new WorldMapView();
    app.stage.addChild(worldView.container);
  } else if (newMode === 'tactical_exploration' || newMode === 'tactical_combat') {
    tacticalView = new TacticalMapView();
    app.stage.addChild(tacticalView.container);
    selectedCharIndex = 0;
  }

  currentView = newMode;
}

function smoothUpdate(): void {
  // Smooth camera follow
  if (currentView === 'world_map' && worldView) {
    const state = bridge.getViewState();
    if ('WorldMap' in (state as object)) {
      const ws = (state as WorldMapState).WorldMap;
      worldView.updateCameraSmooth(ws.party_position, app.screen.width, app.screen.height);
    }
  }
}

// ─── Input ──────────────────────────────────────────────────────────
function setupInput(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const viewMode = bridge.getViewMode();

    if (viewMode === 'world_map') {
      handleWorldInput(e);
    } else if (viewMode === 'tactical_exploration') {
      handleTacticalInput(e);
    }
  });
}

function handleWorldInput(e: KeyboardEvent): void {
  let dx = 0, dy = 0;
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': dy = -1; break;
    case 'ArrowDown': case 's': case 'S': dy = 1; break;
    case 'ArrowLeft': case 'a': case 'A': dx = -1; break;
    case 'ArrowRight': case 'd': case 'D': dx = 1; break;
    case 'Enter':
      // Try to enter location at current position
      tryEnterLocation();
      return;
    default: return;
  }

  e.preventDefault();
  const result = bridge.movePartyWorld(dx, dy);
  handleMoveResult(result);
  refreshView();
}

function handleTacticalInput(e: KeyboardEvent): void {
  const charId = partyMemberIds[selectedCharIndex];
  if (charId === undefined) return;

  // Get current position of selected character
  const state = bridge.getViewState();
  if (!('Tactical' in (state as object))) return;
  const ts = (state as TacticalState).Tactical;
  const charPos = ts.party_positions.find((p) => p.id === charId);
  if (!charPos) return;

  let nx = charPos.x, ny = charPos.y;

  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': ny -= 1; break;
    case 'ArrowDown': case 's': case 'S': ny += 1; break;
    case 'ArrowLeft': case 'a': case 'A': nx -= 1; break;
    case 'ArrowRight': case 'd': case 'D': nx += 1; break;
    case 'Tab':
      e.preventDefault();
      selectedCharIndex = (selectedCharIndex + 1) % partyMemberIds.length;
      refreshView();
      return;
    case 'Escape':
      // Try to exit — find an exit tile near any character
      tryExitTactical();
      return;
    default: return;
  }

  e.preventDefault();

  if (nx < 0 || ny < 0) return;
  const result = bridge.moveCharacterTactical(charId, nx, ny);
  handleMoveResult(result);
  refreshView();
}

function handleMoveResult(result: MoveResult): void {
  if (typeof result === 'object' && result !== null) {
    if ('ArrivedAtLocation' in result) {
      const locId = result.ArrivedAtLocation;
      console.log(`Arrived at location ${locId}. Press ENTER to enter.`);
    } else if ('ReachedExit' in result) {
      const exit = result.ReachedExit;
      console.log('Reached exit:', exit);
      // Auto-exit when reaching exit tile
      if (exit.destination) {
        if ('WorldMap' in exit.destination) {
          const [wx, wy] = exit.destination.WorldMap;
          bridge.exitToWorld(wx, wy);
          refreshView();
        }
      }
      // Handle array format [wx, wy] from serde
      if (Array.isArray(exit.destination)) {
        // ExitDestination::WorldMap is serialized as {"WorldMap": [x, y]}
      }
    }
  }
}

function tryEnterLocation(): void {
  // The WASM side tracks arrival — we just try entering known location IDs
  // Check the last move result or try each location
  const state = bridge.getViewState();
  if (!('WorldMap' in (state as object))) return;
  const ws = (state as WorldMapState).WorldMap;

  for (const loc of ws.locations) {
    const [lx, ly] = loc.world_position;
    const [px, py] = ws.party_position;
    if (lx === px && ly === py) {
      const success = bridge.enterLocation(loc.id);
      if (success) {
        console.log(`Entering ${loc.name}`);
        refreshView();
        return;
      }
    }
  }
}

function tryExitTactical(): void {
  const state = bridge.getViewState();
  if (!('Tactical' in (state as object))) return;
  const ts = (state as TacticalState).Tactical;

  // Check if any character is on an exit tile
  for (const exit of ts.exits) {
    const [ex, ey] = exit.position;
    for (const pos of ts.party_positions) {
      if (pos.x === ex && pos.y === ey) {
        if (exit.destination && 'WorldMap' in exit.destination) {
          const [wx, wy] = exit.destination.WorldMap;
          bridge.exitToWorld(wx, wy);
          refreshView();
          return;
        }
      }
    }
  }
  console.log('No character is on an exit tile. Move to an EXIT marker first.');
}

// ─── Start ──────────────────────────────────────────────────────────
main().catch(console.error);
