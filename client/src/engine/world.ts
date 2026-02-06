import { LocationId, MapId, QuestId } from './types';

// World terrain types (strategic scale: 1 tile ≈ 5 miles)
export type WorldTerrain = 'Plains' | 'Forest' | 'Mountains' | 'Water' | 'Desert' | 'Road' | 'City';

const movementCosts: Record<WorldTerrain, number> = {
  Road: 0.5,
  Plains: 1.0,
  City: 1.0,
  Forest: 1.5,
  Desert: 1.5,
  Mountains: 2.5,
  Water: Infinity,
};

export function movementCost(terrain: WorldTerrain): number {
  return movementCosts[terrain];
}

export function isTerrainPassable(terrain: WorldTerrain): boolean {
  return terrain !== 'Water';
}

// Location types
export type LocationType = 'Town' | 'Dungeon' | 'Landmark' | 'EncounterSite' | 'QuestLocation';

export interface Location {
  id: LocationId;
  name: string;
  locationType: LocationType;
  worldPosition: [number, number];
  tacticalMapId: MapId | null;
  discovered: boolean;
  questMarkers: QuestId[];
}

// World map (strategic scale)
export class WorldMap {
  width: number;
  height: number;
  terrain: WorldTerrain[][];
  locations: Map<LocationId, Location>;
  discoveredTiles: Set<string>; // "x,y" keys

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.terrain = [];
    for (let y = 0; y < height; y++) {
      this.terrain.push(new Array(width).fill('Plains'));
    }
    this.locations = new Map();
    this.discoveredTiles = new Set();
  }

  getTerrain(x: number, y: number): WorldTerrain | null {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.terrain[y][x];
    }
    return null;
  }

  setTerrain(x: number, y: number, terrain: WorldTerrain): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.terrain[y][x] = terrain;
    }
  }

  isPassable(x: number, y: number): boolean {
    const t = this.getTerrain(x, y);
    return t !== null && isTerrainPassable(t);
  }

  locationAt(x: number, y: number): Location | null {
    for (const loc of this.locations.values()) {
      if (loc.worldPosition[0] === x && loc.worldPosition[1] === y) {
        return loc;
      }
    }
    return null;
  }

  addLocation(location: Location): void {
    this.locations.set(location.id, location);
  }

  discoverAround(x: number, y: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height) {
          this.discoveredTiles.add(`${tx},${ty}`);
        }
      }
    }
  }

  isDiscovered(x: number, y: number): boolean {
    return this.discoveredTiles.has(`${x},${y}`);
  }
}
