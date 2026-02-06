// Re-export engine types used by views
export type { ViewState, WorldMapViewState, TacticalViewState, CharacterPosition, PartyMemberInfo, GameTimeInfo, MoveResult } from './engine/GameEngine';
export type { WorldTerrain } from './engine/world';
export type { TacticalTerrain, TacticalTile, Exit, ExitDestination, TileSpecial } from './engine/tactical';
export type { Direction, ViewMode, CoverType, LocationId, CharacterId } from './engine/types';
export type { Location, LocationType } from './engine/world';

// Color maps for rendering
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

export const LOCATION_TYPE_COLORS: Record<string, number> = {
  Town: 0xffd700,
  Dungeon: 0xff4444,
  Landmark: 0x44aaff,
  EncounterSite: 0xff8800,
  QuestLocation: 0xaa44ff,
};
