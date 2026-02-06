import { Application } from 'pixi.js';
import { GameBridge } from './engine/GameBridge';
import { WorldMapView } from './views/WorldMapView';
import { TacticalMapView } from './views/TacticalMapView';
import { UIManager } from './ui/UIManager';
import type { MoveResult, WorldMapViewState, TacticalViewState } from './types';

const app = new Application();
const bridge = new GameBridge();
const ui = new UIManager();

let worldView: WorldMapView | null = null;
let tacticalView: TacticalMapView | null = null;
let currentView = '';

// Tactical state
let selectedCharIndex = 0;
let partyMemberIds: number[] = [];

async function main(): Promise<void> {
  await app.init({
    resizeTo: window,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  });
  document.getElementById('game-container')!.prepend(app.canvas);

  await bridge.init();

  refreshView();
  setupInput();

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

  ui.updatePartyBar(partyInfo);
  ui.updateGameTime(gameTime);
  ui.setControlsHint(viewMode);

  partyMemberIds = partyInfo.map((m) => m.id);

  if (viewMode !== currentView) {
    switchView(viewMode);
  }

  if (viewMode === 'world_map' && worldView && viewState.type === 'WorldMap') {
    ui.setLocationName('World Map');
    worldView.render(viewState, app.screen.width, app.screen.height);
  } else if (
    (viewMode === 'tactical_exploration' || viewMode === 'tactical_combat') &&
    tacticalView &&
    viewState.type === 'Tactical'
  ) {
    ui.setLocationName(viewState.mapName || 'Tactical Map');
    const selectedId = partyMemberIds[selectedCharIndex] ?? null;
    tacticalView.render(viewState, app.screen.width, app.screen.height, selectedId);
  }
}

function switchView(newMode: string): void {
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
  if (currentView === 'world_map' && worldView) {
    const state = bridge.getViewState();
    if (state.type === 'WorldMap') {
      worldView.updateCameraSmooth(state.partyPosition, app.screen.width, app.screen.height);
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

  const state = bridge.getViewState();
  if (state.type !== 'Tactical') return;
  const charPos = state.partyPositions.find((p) => p.id === charId);
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
    if (result.type === 'ArrivedAtLocation') {
      console.log(`Arrived at location ${result.locationId}. Press ENTER to enter.`);
    } else if (result.type === 'ReachedExit') {
      console.log('Reached exit:', result.exit);
      bridge.handleExit(result.exit);
      refreshView();
    }
  }
}

function tryEnterLocation(): void {
  const state = bridge.getViewState();
  if (state.type !== 'WorldMap') return;

  for (const loc of state.locations) {
    const [lx, ly] = loc.worldPosition;
    const [px, py] = state.partyPosition;
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
  if (state.type !== 'Tactical') return;

  for (const exit of state.exits) {
    const [ex, ey] = exit.position;
    for (const pos of state.partyPositions) {
      if (pos.x === ex && pos.y === ey) {
        bridge.handleExit(exit);
        refreshView();
        return;
      }
    }
  }
  console.log('No character is on an exit tile. Move to an EXIT marker first.');
}

main().catch(console.error);
