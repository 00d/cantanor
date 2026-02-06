// Type aliases
export type LocationId = number;
export type MapId = number;
export type CharacterId = number;
export type QuestId = number;

// Enums as string unions
export type Direction = 'North' | 'South' | 'East' | 'West';

export type ViewMode = 'WorldMap' | 'TacticalExploration' | 'TacticalCombat' | 'Menu';

export type CoverType = 'None' | 'Lesser' | 'Standard' | 'Greater';

// Game time tracking
export class GameTime {
  totalMinutes: number;

  constructor(totalMinutes = 8 * 60) {
    this.totalMinutes = totalMinutes;
  }

  hour(): number {
    return Math.floor(this.totalMinutes / 60) % 24;
  }

  day(): number {
    return Math.floor(this.totalMinutes / (60 * 24));
  }

  advanceMinutes(minutes: number): void {
    this.totalMinutes += minutes;
  }

  isNight(): boolean {
    const h = this.hour();
    return h >= 20 || h < 6;
  }
}
