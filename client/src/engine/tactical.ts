import { CoverType, MapId } from './types';

// Tactical terrain types (1 tile = 5 feet)
export type TacticalTerrain =
  | 'Floor'
  | 'Wall'
  | 'Dirt'
  | 'Stone'
  | 'Water'
  | 'Lava'
  | 'Grass'
  | 'Door'
  | 'StairsUp'
  | 'StairsDown';

export function isTacticalPassable(terrain: TacticalTerrain): boolean {
  return terrain !== 'Wall' && terrain !== 'Lava';
}

export function blocksSight(terrain: TacticalTerrain): boolean {
  return terrain === 'Wall' || terrain === 'Door';
}

// Tile specials
export type TileSpecial =
  | { type: 'Trap'; perceptionDc: number; damage: string }
  | { type: 'Chest'; looted: boolean }
  | { type: 'Lever'; activated: boolean }
  | { type: 'Sign'; text: string };

// A single tactical tile
export interface TacticalTile {
  terrain: TacticalTerrain;
  passable: boolean;
  cover: CoverType;
  special: TileSpecial | null;
  visible: boolean;
  explored: boolean;
}

export function createTile(terrain: TacticalTerrain): TacticalTile {
  return {
    terrain,
    passable: isTacticalPassable(terrain),
    cover: 'None',
    special: null,
    visible: false,
    explored: false,
  };
}

export function wallTile(): TacticalTile {
  return createTile('Wall');
}

export function floorTile(): TacticalTile {
  return createTile('Floor');
}

// Exit destinations
export type ExitDestination =
  | { type: 'WorldMap'; x: number; y: number }
  | { type: 'TacticalMap'; mapId: MapId; x: number; y: number };

// An exit point on a tactical map
export interface Exit {
  position: [number, number];
  destination: ExitDestination;
}

// A complete tactical map
export class TacticalMap {
  id: MapId;
  name: string;
  width: number;
  height: number;
  tiles: TacticalTile[][];
  elevation: number[][];
  spawnPoints: Array<[number, number]>;
  exits: Exit[];

  constructor(id: MapId, name: string, width: number, height: number) {
    this.id = id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.elevation = [];
    for (let y = 0; y < height; y++) {
      const row: TacticalTile[] = [];
      const elevRow: number[] = [];
      for (let x = 0; x < width; x++) {
        row.push(floorTile());
        elevRow.push(0);
      }
      this.tiles.push(row);
      this.elevation.push(elevRow);
    }
    this.spawnPoints = [];
    this.exits = [];
  }

  getTile(x: number, y: number): TacticalTile | null {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.tiles[y][x];
    }
    return null;
  }

  setTile(x: number, y: number, tile: TacticalTile): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.tiles[y][x] = tile;
    }
  }

  isPassable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile !== null && tile.passable;
  }

  exitAt(x: number, y: number): Exit | null {
    return this.exits.find((e) => e.position[0] === x && e.position[1] === y) ?? null;
  }
}
