import { CharacterId, Direction, GameTime, LocationId, MapId, ViewMode } from './types';
import { Location, WorldMap, WorldTerrain, movementCost } from './world';
import { Character, Party, addPartyMember, createCharacter, createParty } from './character';
import { Exit, TacticalMap, TacticalTile, createTile, wallTile } from './tactical';

// View state types sent to the frontend
export interface WorldMapViewState {
  type: 'WorldMap';
  partyPosition: [number, number];
  partyFacing: Direction;
  terrain: WorldTerrain[][];
  discovered: Set<string>; // "x,y" keys
  locations: Location[];
  gameTime: GameTime;
}

export interface TacticalViewState {
  type: 'Tactical';
  mapName: string;
  mapWidth: number;
  mapHeight: number;
  tiles: TacticalTile[][];
  partyPositions: CharacterPosition[];
  exits: Exit[];
  inCombat: boolean;
}

export interface MenuViewState {
  type: 'Menu';
}

export type ViewState = WorldMapViewState | TacticalViewState | MenuViewState;

export interface CharacterPosition {
  id: CharacterId;
  x: number;
  y: number;
}

export interface PartyMemberInfo {
  id: number;
  name: string;
  class: string;
  level: number;
  currentHp: number;
  maxHp: number;
}

export interface GameTimeInfo {
  day: number;
  hour: number;
  isNight: boolean;
  totalMinutes: number;
}

// Move result
export type MoveResult =
  | 'Moved'
  | 'Blocked'
  | { type: 'ArrivedAtLocation'; locationId: LocationId }
  | { type: 'ReachedExit'; exit: Exit };

// Game error
export class GameError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Internal game state
interface GameState {
  currentView: ViewMode;
  worldMap: WorldMap;
  partyWorldPosition: [number, number] | null;
  partyFacing: Direction;
  activeTacticalMap: MapId | null;
  tacticalMaps: Map<MapId, TacticalMap>;
  partyTacticalPositions: Map<CharacterId, [number, number]>;
  party: Party;
  characters: Map<CharacterId, Character>;
  gameTime: GameTime;
}

export class GameEngine {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  getViewMode(): string {
    switch (this.state.currentView) {
      case 'WorldMap':
        return 'world_map';
      case 'TacticalExploration':
        return 'tactical_exploration';
      case 'TacticalCombat':
        return 'tactical_combat';
      case 'Menu':
        return 'menu';
    }
  }

  getViewState(): ViewState {
    switch (this.state.currentView) {
      case 'WorldMap': {
        const discoveredLocations: Location[] = [];
        for (const loc of this.state.worldMap.locations.values()) {
          if (loc.discovered) {
            discoveredLocations.push(loc);
          }
        }
        return {
          type: 'WorldMap',
          partyPosition: this.state.partyWorldPosition ?? [0, 0],
          partyFacing: this.state.partyFacing,
          terrain: this.state.worldMap.terrain,
          discovered: this.state.worldMap.discoveredTiles,
          locations: discoveredLocations,
          gameTime: this.state.gameTime,
        };
      }
      case 'TacticalExploration':
      case 'TacticalCombat': {
        const mapId = this.state.activeTacticalMap;
        const map = mapId !== null ? this.state.tacticalMaps.get(mapId) : undefined;
        const positions: CharacterPosition[] = [];
        for (const [id, [x, y]] of this.state.partyTacticalPositions) {
          positions.push({ id, x, y });
        }
        return {
          type: 'Tactical',
          mapName: map?.name ?? '',
          mapWidth: map?.width ?? 0,
          mapHeight: map?.height ?? 0,
          tiles: map?.tiles ?? [],
          partyPositions: positions,
          exits: map?.exits ?? [],
          inCombat: this.state.currentView === 'TacticalCombat',
        };
      }
      case 'Menu':
        return { type: 'Menu' };
    }
  }

  getPartyInfo(): PartyMemberInfo[] {
    return this.state.party.members
      .map((id) => this.state.characters.get(id))
      .filter((c): c is Character => c !== undefined)
      .map((c) => ({
        id: c.id,
        name: c.name,
        class: c.class,
        level: c.level,
        currentHp: c.currentHp,
        maxHp: c.maxHp,
      }));
  }

  getGameTime(): GameTimeInfo {
    const t = this.state.gameTime;
    return {
      day: t.day(),
      hour: t.hour(),
      isNight: t.isNight(),
      totalMinutes: t.totalMinutes,
    };
  }

  movePartyWorld(dx: number, dy: number): MoveResult {
    if (this.state.currentView !== 'WorldMap') {
      throw new GameError('Action not available in current view');
    }
    if (!this.state.partyWorldPosition) {
      throw new GameError('Party has no position');
    }

    const [px, py] = this.state.partyWorldPosition;
    const nx = Math.max(0, px + dx);
    const ny = Math.max(0, py + dy);

    // Update facing
    if (dx > 0) this.state.partyFacing = 'East';
    else if (dx < 0) this.state.partyFacing = 'West';
    else if (dy > 0) this.state.partyFacing = 'South';
    else if (dy < 0) this.state.partyFacing = 'North';

    if (!this.state.worldMap.isPassable(nx, ny)) {
      return 'Blocked';
    }

    this.state.partyWorldPosition = [nx, ny];
    this.state.worldMap.discoverAround(nx, ny, 2);

    // Advance time based on terrain
    const terrain = this.state.worldMap.getTerrain(nx, ny)!;
    const minutes = Math.floor(60 * movementCost(terrain));
    this.state.gameTime.advanceMinutes(minutes);

    // Check if we're on a location
    const loc = this.state.worldMap.locationAt(nx, ny);
    if (loc) {
      return { type: 'ArrivedAtLocation', locationId: loc.id };
    }

    return 'Moved';
  }

  enterLocation(locationId: LocationId): boolean {
    if (this.state.currentView !== 'WorldMap') return false;

    const location = this.state.worldMap.locations.get(locationId);
    if (!location) return false;

    const mapId = location.tacticalMapId;
    if (mapId === null) return false;

    const tacticalMap = this.state.tacticalMaps.get(mapId);
    if (!tacticalMap) return false;

    // Position party at spawn points
    this.state.partyTacticalPositions.clear();
    for (let i = 0; i < this.state.party.members.length; i++) {
      const charId = this.state.party.members[i];
      const spawn = tacticalMap.spawnPoints[i] ?? tacticalMap.spawnPoints[0];
      if (spawn) {
        if (i < tacticalMap.spawnPoints.length) {
          this.state.partyTacticalPositions.set(charId, [spawn[0], spawn[1]]);
        } else {
          this.state.partyTacticalPositions.set(charId, [spawn[0] + i, spawn[1]]);
        }
      }
    }

    this.state.activeTacticalMap = mapId;
    this.state.partyWorldPosition = null;
    this.state.currentView = 'TacticalExploration';
    return true;
  }

  moveCharacterTactical(charId: CharacterId, x: number, y: number): MoveResult {
    if (this.state.currentView !== 'TacticalExploration' && this.state.currentView !== 'TacticalCombat') {
      throw new GameError('Action not available in current view');
    }

    const mapId = this.state.activeTacticalMap;
    if (mapId === null) throw new GameError('No tactical map loaded');

    const map = this.state.tacticalMaps.get(mapId);
    if (!map) throw new GameError('No tactical map loaded');

    if (!map.isPassable(x, y)) {
      return 'Blocked';
    }

    this.state.partyTacticalPositions.set(charId, [x, y]);

    // Check if on an exit
    const exit = map.exitAt(x, y);
    if (exit) {
      return { type: 'ReachedExit', exit };
    }

    return 'Moved';
  }

  exitToWorld(worldX: number, worldY: number): boolean {
    if (this.state.currentView !== 'TacticalExploration' && this.state.currentView !== 'TacticalCombat') {
      return false;
    }

    this.state.partyTacticalPositions.clear();
    this.state.activeTacticalMap = null;
    this.state.partyWorldPosition = [worldX, worldY];
    this.state.currentView = 'WorldMap';
    return true;
  }

  handleExit(exit: Exit): boolean {
    if (exit.destination.type === 'WorldMap') {
      return this.exitToWorld(exit.destination.x, exit.destination.y);
    } else {
      return this.transitionTactical(exit.destination.mapId, exit.destination.x, exit.destination.y);
    }
  }

  private transitionTactical(nextMapId: MapId, spawnX: number, spawnY: number): boolean {
    if (this.state.currentView !== 'TacticalExploration' && this.state.currentView !== 'TacticalCombat') {
      return false;
    }

    const tacticalMap = this.state.tacticalMaps.get(nextMapId);
    if (!tacticalMap) return false;

    this.state.partyTacticalPositions.clear();
    for (let i = 0; i < this.state.party.members.length; i++) {
      const charId = this.state.party.members[i];
      const x = spawnX + i;
      const y = spawnY;
      if (tacticalMap.isPassable(x, y)) {
        this.state.partyTacticalPositions.set(charId, [x, y]);
      } else {
        this.state.partyTacticalPositions.set(charId, [spawnX, spawnY]);
      }
    }

    this.state.activeTacticalMap = nextMapId;
    this.state.currentView = 'TacticalExploration';
    return true;
  }
}

// Create the demo game
export function createDemoGame(): GameEngine {
  const worldMap = new WorldMap(30, 20);

  // Paint terrain - road going east from start
  for (let x = 0; x < 15; x++) {
    worldMap.setTerrain(x, 5, 'Road');
  }
  // Forest areas
  for (let y = 0; y < 4; y++) {
    for (let x = 2; x < 8; x++) {
      worldMap.setTerrain(x, y, 'Forest');
    }
  }
  // Mountains
  for (let x = 10; x < 15; x++) {
    for (let y = 0; y < 4; y++) {
      worldMap.setTerrain(x, y, 'Mountains');
    }
  }
  // Water (lake)
  for (let x = 18; x < 23; x++) {
    for (let y = 8; y < 13; y++) {
      worldMap.setTerrain(x, y, 'Water');
    }
  }
  // Desert region
  for (let x = 20; x < 28; x++) {
    for (let y = 0; y < 6; y++) {
      worldMap.setTerrain(x, y, 'Desert');
    }
  }
  // More roads
  for (let y = 5; y < 15; y++) {
    worldMap.setTerrain(14, y, 'Road');
  }
  for (let x = 14; x < 25; x++) {
    worldMap.setTerrain(x, 14, 'Road');
  }

  // Add starting town
  worldMap.addLocation({
    id: 1,
    name: 'Willowdale',
    locationType: 'Town',
    worldPosition: [2, 5],
    tacticalMapId: 100,
    discovered: true,
    questMarkers: [],
  });
  worldMap.setTerrain(2, 5, 'City');

  // Add dungeon
  worldMap.addLocation({
    id: 2,
    name: 'Goblin Cave',
    locationType: 'Dungeon',
    worldPosition: [14, 3],
    tacticalMapId: 200,
    discovered: true,
    questMarkers: [],
  });

  // Add quest location
  worldMap.addLocation({
    id: 3,
    name: 'Ancient Ruins',
    locationType: 'QuestLocation',
    worldPosition: [24, 14],
    tacticalMapId: 300,
    discovered: true,
    questMarkers: [],
  });

  // Create the town tactical map
  const townMap = new TacticalMap(100, 'Willowdale Town', 20, 15);
  for (let x = 0; x < 20; x++) {
    townMap.setTile(x, 0, wallTile());
    townMap.setTile(x, 14, wallTile());
  }
  for (let y = 0; y < 15; y++) {
    townMap.setTile(0, y, wallTile());
    townMap.setTile(19, y, wallTile());
  }
  // Buildings
  for (let x = 3; x < 7; x++) {
    for (let y = 3; y < 6; y++) {
      townMap.setTile(x, y, wallTile());
    }
  }
  townMap.setTile(5, 5, createTile('Door'));
  for (let x = 12; x < 16; x++) {
    for (let y = 3; y < 6; y++) {
      townMap.setTile(x, y, wallTile());
    }
  }
  townMap.setTile(14, 5, createTile('Door'));

  // Grass areas
  for (let x = 1; x < 19; x++) {
    for (let y = 1; y < 14; y++) {
      if (townMap.isPassable(x, y)) {
        townMap.setTile(x, y, createTile('Grass'));
      }
    }
  }
  // Stone paths
  for (let x = 1; x < 19; x++) {
    townMap.setTile(x, 7, createTile('Stone'));
  }
  for (let y = 1; y < 14; y++) {
    townMap.setTile(10, y, createTile('Stone'));
  }

  townMap.spawnPoints = [[10, 13], [11, 13], [9, 13], [12, 13]];
  townMap.exits.push({
    position: [10, 14],
    destination: { type: 'WorldMap', x: 2, y: 5 },
  });

  // Create the dungeon tactical map
  const dungeonMap = new TacticalMap(200, 'Goblin Cave - Level 1', 25, 20);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 25; x++) {
      dungeonMap.setTile(x, y, wallTile());
    }
  }
  // Entrance corridor
  for (let y = 16; y < 20; y++) {
    for (let x = 11; x < 14; x++) {
      dungeonMap.setTile(x, y, createTile('Dirt'));
    }
  }
  // Main room
  for (let y = 10; y < 17; y++) {
    for (let x = 5; x < 20; x++) {
      dungeonMap.setTile(x, y, createTile('Stone'));
    }
  }
  // Side corridor
  for (let y = 5; y < 11; y++) {
    for (let x = 11; x < 14; x++) {
      dungeonMap.setTile(x, y, createTile('Dirt'));
    }
  }
  // Boss room
  for (let y = 2; y < 6; y++) {
    for (let x = 7; x < 18; x++) {
      dungeonMap.setTile(x, y, createTile('Stone'));
    }
  }
  // Chest in boss room
  const chestTile = createTile('Stone');
  chestTile.special = { type: 'Chest', looted: false };
  dungeonMap.setTile(12, 3, chestTile);

  dungeonMap.spawnPoints = [[12, 18], [11, 18], [13, 18], [12, 17]];
  dungeonMap.exits.push({
    position: [12, 19],
    destination: { type: 'WorldMap', x: 14, y: 3 },
  });

  // Create the ruins tactical map
  const ruinsMap = new TacticalMap(300, 'Ancient Ruins', 18, 18);
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 18; x++) {
      ruinsMap.setTile(x, y, createTile('Grass'));
    }
  }
  // Ruined walls
  for (let x = 3; x < 15; x++) {
    ruinsMap.setTile(x, 3, wallTile());
    if (x % 3 !== 0) {
      ruinsMap.setTile(x, 14, wallTile());
    }
  }
  for (let y = 3; y < 15; y++) {
    if (y % 4 !== 0) {
      ruinsMap.setTile(3, y, wallTile());
    }
    ruinsMap.setTile(14, y, wallTile());
  }
  // Inner stone floor
  for (let y = 4; y < 14; y++) {
    for (let x = 4; x < 14; x++) {
      ruinsMap.setTile(x, y, createTile('Stone'));
    }
  }
  ruinsMap.spawnPoints = [[9, 16], [8, 16], [10, 16], [9, 15]];
  ruinsMap.exits.push({
    position: [9, 17],
    destination: { type: 'WorldMap', x: 24, y: 14 },
  });

  // Build tactical maps collection
  const tacticalMaps = new Map<MapId, TacticalMap>();
  tacticalMaps.set(100, townMap);
  tacticalMaps.set(200, dungeonMap);
  tacticalMaps.set(300, ruinsMap);

  // Create characters
  const characters = new Map<number, Character>();
  const charData: Array<[number, string, 'Human' | 'Elf' | 'Dwarf' | 'Halfling', 'Fighter' | 'Wizard' | 'Cleric' | 'Rogue']> = [
    [1, 'Valeria', 'Human', 'Fighter'],
    [2, 'Thornwick', 'Elf', 'Wizard'],
    [3, 'Brak', 'Dwarf', 'Cleric'],
    [4, 'Pip', 'Halfling', 'Rogue'],
  ];

  const party = createParty();
  for (const [id, name, ancestry, cls] of charData) {
    const char = createCharacter(id, name, ancestry, cls);
    characters.set(id, char);
    addPartyMember(party, id);
  }

  // Set starting position and discover nearby tiles
  worldMap.discoverAround(2, 5, 3);

  const state: GameState = {
    currentView: 'WorldMap',
    worldMap,
    partyWorldPosition: [2, 5],
    partyFacing: 'South',
    activeTacticalMap: null,
    tacticalMaps,
    partyTacticalPositions: new Map(),
    party,
    characters,
    gameTime: new GameTime(),
  };

  return new GameEngine(state);
}
