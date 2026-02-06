use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::character::*;
use crate::tactical::*;
use crate::types::*;
use crate::world::*;

/// The complete game state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    // View mode
    pub current_view: ViewMode,

    // World map state
    pub world_map: WorldMap,
    pub party_world_position: Option<(u32, u32)>,
    pub party_facing: Direction,

    // Tactical map state
    pub active_tactical_map: Option<MapId>,
    pub tactical_maps: HashMap<MapId, TacticalMap>,
    pub party_tactical_positions: HashMap<CharacterId, (u16, u16)>,

    // Party and characters
    pub party: Party,
    pub characters: HashMap<CharacterId, Character>,

    // Shared systems
    pub game_time: GameTime,
}

impl GameState {
    /// Create a new game with an empty world
    pub fn new(world_width: u32, world_height: u32) -> Self {
        Self {
            current_view: ViewMode::WorldMap,
            world_map: WorldMap::new(world_width, world_height),
            party_world_position: Some((0, 0)),
            party_facing: Direction::South,
            active_tactical_map: None,
            tactical_maps: HashMap::new(),
            party_tactical_positions: HashMap::new(),
            party: Party::new(),
            characters: HashMap::new(),
            game_time: GameTime::default(),
        }
    }

    /// Add a character to the game and party
    pub fn add_character(&mut self, character: Character) {
        let id = character.id;
        self.characters.insert(id, character);
        self.party.add_member(id);
    }

    /// Register a tactical map
    pub fn add_tactical_map(&mut self, map: TacticalMap) {
        self.tactical_maps.insert(map.id, map);
    }

    /// Try to move party on the world map
    pub fn move_party_world(&mut self, dx: i32, dy: i32) -> Result<MoveResult, GameError> {
        if self.current_view != ViewMode::WorldMap {
            return Err(GameError::WrongView);
        }

        let (px, py) = self.party_world_position.ok_or(GameError::NoPosition)?;
        let nx = (px as i32 + dx).max(0) as u32;
        let ny = (py as i32 + dy).max(0) as u32;

        // Update facing
        if dx > 0 {
            self.party_facing = Direction::East;
        } else if dx < 0 {
            self.party_facing = Direction::West;
        } else if dy > 0 {
            self.party_facing = Direction::South;
        } else if dy < 0 {
            self.party_facing = Direction::North;
        }

        if !self.world_map.is_passable(nx, ny) {
            return Ok(MoveResult::Blocked);
        }

        self.party_world_position = Some((nx, ny));
        self.world_map.discover_around(nx, ny, 2);

        // Advance time based on terrain
        let terrain = self.world_map.get_terrain(nx, ny).unwrap();
        let minutes = (60.0 * terrain.movement_cost()) as u64;
        self.game_time.advance_minutes(minutes);

        // Check if we're on a location
        if let Some(loc) = self.world_map.location_at(nx, ny) {
            return Ok(MoveResult::ArrivedAtLocation(loc.id));
        }

        Ok(MoveResult::Moved)
    }

    /// Move a single character on the tactical map
    pub fn move_character_tactical(
        &mut self,
        char_id: CharacterId,
        x: u16,
        y: u16,
    ) -> Result<MoveResult, GameError> {
        if !matches!(
            self.current_view,
            ViewMode::TacticalExploration | ViewMode::TacticalCombat
        ) {
            return Err(GameError::WrongView);
        }

        let map_id = self.active_tactical_map.ok_or(GameError::NoMap)?;
        let map = self.tactical_maps.get(&map_id).ok_or(GameError::NoMap)?;

        if !map.is_passable(x, y) {
            return Ok(MoveResult::Blocked);
        }

        self.party_tactical_positions.insert(char_id, (x, y));

        // Check if on an exit
        if let Some(exit) = map.exit_at(x, y) {
            return Ok(MoveResult::ReachedExit(exit.clone()));
        }

        Ok(MoveResult::Moved)
    }

    /// Serialize the full game state to JSON
    pub fn to_json(&self) -> Result<String, GameError> {
        serde_json::to_string(self).map_err(|_| GameError::SerializationError)
    }

    /// Get a snapshot of visible state for the frontend
    pub fn get_view_state(&self) -> ViewState {
        match self.current_view {
            ViewMode::WorldMap => ViewState::WorldMap {
                party_position: self.party_world_position.unwrap_or((0, 0)),
                party_facing: self.party_facing,
                terrain: self.world_map.terrain.clone(),
                discovered: self.world_map.discovered_tiles.clone(),
                locations: self
                    .world_map
                    .locations
                    .values()
                    .filter(|l| l.discovered)
                    .cloned()
                    .collect(),
                game_time: self.game_time.clone(),
            },
            ViewMode::TacticalExploration | ViewMode::TacticalCombat => {
                let map = self
                    .active_tactical_map
                    .and_then(|id| self.tactical_maps.get(&id));
                ViewState::Tactical {
                    map_name: map.map(|m| m.name.clone()).unwrap_or_default(),
                    map_width: map.map(|m| m.width).unwrap_or(0),
                    map_height: map.map(|m| m.height).unwrap_or(0),
                    tiles: map.map(|m| m.tiles.clone()).unwrap_or_default(),
                    party_positions: self
                        .party_tactical_positions
                        .iter()
                        .map(|(&id, &(x, y))| CharacterPosition { id, x, y })
                        .collect(),
                    exits: map.map(|m| m.exits.clone()).unwrap_or_default(),
                    in_combat: self.current_view == ViewMode::TacticalCombat,
                }
            }
            ViewMode::Menu => ViewState::Menu,
        }
    }
}

/// Result of a movement attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MoveResult {
    Moved,
    Blocked,
    ArrivedAtLocation(LocationId),
    ReachedExit(Exit),
}

/// View state sent to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewState {
    WorldMap {
        party_position: (u32, u32),
        party_facing: Direction,
        terrain: Vec<Vec<WorldTerrain>>,
        discovered: std::collections::HashSet<(u32, u32)>,
        locations: Vec<Location>,
        game_time: GameTime,
    },
    Tactical {
        map_name: String,
        map_width: u16,
        map_height: u16,
        tiles: Vec<Vec<TacticalTile>>,
        party_positions: Vec<CharacterPosition>,
        exits: Vec<Exit>,
        in_combat: bool,
    },
    Menu,
}

/// A character's position on the tactical map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterPosition {
    pub id: CharacterId,
    pub x: u16,
    pub y: u16,
}

/// Game errors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GameError {
    WrongView,
    NoPosition,
    NoMap,
    InvalidLocation,
    SerializationError,
}

impl std::fmt::Display for GameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GameError::WrongView => write!(f, "Action not available in current view"),
            GameError::NoPosition => write!(f, "Party has no position"),
            GameError::NoMap => write!(f, "No tactical map loaded"),
            GameError::InvalidLocation => write!(f, "Invalid location"),
            GameError::SerializationError => write!(f, "Serialization error"),
        }
    }
}

impl std::error::Error for GameError {}
