import init, { GameEngine } from '../../pkg/pathfinder_wasm.js';
import type { ViewState, MoveResult, PartyMemberInfo, GameTimeInfo } from '../types';

/**
 * Bridge between the WASM game engine and the TypeScript rendering layer.
 * All game logic goes through this — the frontend never modifies state directly.
 */
export class GameBridge {
  private engine: GameEngine | null = null;
  private initialized = false;

  async init(): Promise<void> {
    await init();
    this.engine = new GameEngine();
    this.initialized = true;
    console.log('Game engine initialized');
  }

  private ensureReady(): GameEngine {
    if (!this.initialized || !this.engine) {
      throw new Error('GameBridge not initialized. Call init() first.');
    }
    return this.engine;
  }

  getViewMode(): string {
    return this.ensureReady().getViewMode();
  }

  getViewState(): ViewState {
    return this.ensureReady().getViewState() as ViewState;
  }

  getPartyInfo(): PartyMemberInfo[] {
    return this.ensureReady().getPartyInfo() as PartyMemberInfo[];
  }

  getGameTime(): GameTimeInfo {
    return this.ensureReady().getGameTime() as GameTimeInfo;
  }

  movePartyWorld(dx: number, dy: number): MoveResult {
    return this.ensureReady().movePartyWorld(dx, dy) as MoveResult;
  }

  enterLocation(locationId: number): boolean {
    return this.ensureReady().enterLocation(locationId);
  }

  moveCharacterTactical(charId: number, x: number, y: number): MoveResult {
    return this.ensureReady().moveCharacterTactical(charId, x, y) as MoveResult;
  }

  exitToWorld(worldX: number, worldY: number): boolean {
    return this.ensureReady().exitToWorld(worldX, worldY);
  }
}
