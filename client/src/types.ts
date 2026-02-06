// Types mirroring the Rust game state, as returned by WASM

export interface WorldMapState {
  WorldMap: {
    party_position: [number, number];
    party_facing: string;
    terrain: string[][];
    discovered: Array<[number, number]>;
    locations: LocationInfo[];
    game_time: GameTimeInfo;
  };
}

export interface TacticalState {
  Tactical: {
    map_name: string;
    map_width: number;
    map_height: number;
    tiles: TacticalTileInfo[][];
    party_positions: CharacterPosition[];
    exits: ExitInfo[];
    in_combat: boolean;
  };
}

export type ViewState = WorldMapState | TacticalState | 'Menu';

export interface LocationInfo {
  id: number;
  name: string;
  location_type: string;
  world_position: [number, number];
  discovered: boolean;
}

export interface TacticalTileInfo {
  terrain: string;
  passable: boolean;
  cover: string;
  special: any | null;
  visible: boolean;
  explored: boolean;
}

export interface GameTimeInfo {
  day: number;
  hour: number;
  is_night: boolean;
  total_minutes: number;
}

export interface PartyMemberInfo {
  id: number;
  name: string;
  class: string;
  level: number;
  current_hp: number;
  max_hp: number;
}

export interface CharacterPosition {
  id: number;
  x: number;
  y: number;
}

export interface ExitInfo {
  position: [number, number];
  destination: any;
}

// Move result from WASM
export type MoveResult =
  | 'Moved'
  | 'Blocked'
  | { ArrivedAtLocation: number }
  | { ReachedExit: ExitInfo };

// Terrain color mapping
export const WORLD_TERRAIN_COLORS: Record<string, number> = {
  Plains: 0x7ec850,
  Forest: 0x2d6a1e,
  Mountains: 0x8b7355,
  Water: 0x3498db,
  Desert: 0xd4a843,
  Road: 0xa08060,
  City: 0xc0c0c0,
};

export const TACTICAL_TERRAIN_COLORS: Record<string, number> = {
  Floor: 0x706050,
  Wall: 0x3a3a3a,
  Dirt: 0x8b7355,
  Stone: 0x808080,
  Water: 0x3498db,
  Lava: 0xe74c3c,
  Grass: 0x5ea03a,
  Door: 0x8b6914,
  StairsUp: 0xc0a0ff,
  StairsDown: 0x6040a0,
};
