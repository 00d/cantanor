import { GameEngine, ViewState, MoveResult, PartyMemberInfo, GameTimeInfo, createDemoGame } from './GameEngine';
import { CharacterId, LocationId } from './types';
import type { Exit } from './tactical';

export class GameBridge {
  private engine: GameEngine | null = null;

  async init(): Promise<void> {
    this.engine = createDemoGame();
  }

  private get game(): GameEngine {
    if (!this.engine) throw new Error('GameBridge not initialized');
    return this.engine;
  }

  getViewMode(): string {
    return this.game.getViewMode();
  }

  getViewState(): ViewState {
    return this.game.getViewState();
  }

  getPartyInfo(): PartyMemberInfo[] {
    return this.game.getPartyInfo();
  }

  getGameTime(): GameTimeInfo {
    return this.game.getGameTime();
  }

  movePartyWorld(dx: number, dy: number): MoveResult {
    return this.game.movePartyWorld(dx, dy);
  }

  enterLocation(locationId: LocationId): boolean {
    return this.game.enterLocation(locationId);
  }

  moveCharacterTactical(charId: CharacterId, x: number, y: number): MoveResult {
    return this.game.moveCharacterTactical(charId, x, y);
  }

  exitToWorld(worldX: number, worldY: number): boolean {
    return this.game.exitToWorld(worldX, worldY);
  }

  handleExit(exit: Exit): boolean {
    return this.game.handleExit(exit);
  }
}
