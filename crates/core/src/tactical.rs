use serde::{Deserialize, Serialize};

use crate::types::*;

/// Terrain types for tactical maps (1 tile = 5 feet)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalTerrain {
    Floor,
    Wall,
    Dirt,
    Stone,
    Water,
    Lava,
    Grass,
    Door,
    StairsUp,
    StairsDown,
}

impl TacticalTerrain {
    pub fn is_passable(&self) -> bool {
        !matches!(self, TacticalTerrain::Wall | TacticalTerrain::Lava)
    }

    pub fn blocks_sight(&self) -> bool {
        matches!(self, TacticalTerrain::Wall | TacticalTerrain::Door)
    }
}

/// Special features on a tile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TileSpecial {
    Trap { perception_dc: u8, damage: String },
    Chest { looted: bool },
    Lever { activated: bool },
    Sign { text: String },
}

/// A single tile on a tactical map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TacticalTile {
    pub terrain: TacticalTerrain,
    pub passable: bool,
    pub cover: CoverType,
    pub special: Option<TileSpecial>,
    pub visible: bool,
    pub explored: bool,
}

impl TacticalTile {
    pub fn new(terrain: TacticalTerrain) -> Self {
        let passable = terrain.is_passable();
        Self {
            terrain,
            passable,
            cover: CoverType::None,
            special: None,
            visible: false,
            explored: false,
        }
    }

    pub fn wall() -> Self {
        Self::new(TacticalTerrain::Wall)
    }

    pub fn floor() -> Self {
        Self::new(TacticalTerrain::Floor)
    }
}

/// Where an exit on a tactical map leads
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExitDestination {
    WorldMap(u32, u32),
    TacticalMap(MapId, u16, u16),
}

/// An exit point on a tactical map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exit {
    pub position: (u16, u16),
    pub destination: ExitDestination,
}

/// A complete tactical map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TacticalMap {
    pub id: MapId,
    pub name: String,
    pub width: u16,
    pub height: u16,
    pub tiles: Vec<Vec<TacticalTile>>,
    pub elevation: Vec<Vec<i8>>,
    pub spawn_points: Vec<(u16, u16)>,
    pub exits: Vec<Exit>,
}

impl TacticalMap {
    /// Create a new tactical map filled with floor tiles
    pub fn new(id: MapId, name: &str, width: u16, height: u16) -> Self {
        let tiles = vec![vec![TacticalTile::floor(); width as usize]; height as usize];
        let elevation = vec![vec![0i8; width as usize]; height as usize];
        Self {
            id,
            name: name.to_string(),
            width,
            height,
            tiles,
            elevation,
            spawn_points: Vec::new(),
            exits: Vec::new(),
        }
    }

    /// Get tile at position, None if out of bounds
    pub fn get_tile(&self, x: u16, y: u16) -> Option<&TacticalTile> {
        if x < self.width && y < self.height {
            Some(&self.tiles[y as usize][x as usize])
        } else {
            None
        }
    }

    /// Set tile at position
    pub fn set_tile(&mut self, x: u16, y: u16, tile: TacticalTile) {
        if x < self.width && y < self.height {
            self.tiles[y as usize][x as usize] = tile;
        }
    }

    /// Check if a position is passable
    pub fn is_passable(&self, x: u16, y: u16) -> bool {
        self.get_tile(x, y).map(|t| t.passable).unwrap_or(false)
    }

    /// Find an exit at the given position
    pub fn exit_at(&self, x: u16, y: u16) -> Option<&Exit> {
        self.exits.iter().find(|e| e.position == (x, y))
    }
}
