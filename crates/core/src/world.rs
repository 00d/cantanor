use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::types::*;

/// Terrain types for the world map (strategic scale: 1 tile ≈ 5 miles)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldTerrain {
    Plains,
    Forest,
    Mountains,
    Water,
    Desert,
    Road,
    City,
}

impl WorldTerrain {
    /// Movement cost multiplier for this terrain
    pub fn movement_cost(&self) -> f32 {
        match self {
            WorldTerrain::Road => 0.5,
            WorldTerrain::Plains => 1.0,
            WorldTerrain::City => 1.0,
            WorldTerrain::Forest => 1.5,
            WorldTerrain::Desert => 1.5,
            WorldTerrain::Mountains => 2.5,
            WorldTerrain::Water => f32::INFINITY, // impassable without boat
        }
    }

    /// Whether this terrain is passable on foot
    pub fn is_passable(&self) -> bool {
        !matches!(self, WorldTerrain::Water)
    }
}

/// A location that can be entered from the world map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: LocationId,
    pub name: String,
    pub location_type: LocationType,
    pub world_position: (u32, u32),
    pub tactical_map_id: Option<MapId>,
    pub discovered: bool,
    pub quest_markers: Vec<QuestId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocationType {
    Town,
    Dungeon,
    Landmark,
    EncounterSite,
    QuestLocation,
}

/// The full world map (strategic scale)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldMap {
    pub width: u32,
    pub height: u32,
    pub terrain: Vec<Vec<WorldTerrain>>,
    pub locations: HashMap<LocationId, Location>,
    pub discovered_tiles: HashSet<(u32, u32)>,
}

impl WorldMap {
    /// Create a new world map filled with a default terrain
    pub fn new(width: u32, height: u32) -> Self {
        let terrain = vec![vec![WorldTerrain::Plains; width as usize]; height as usize];
        Self {
            width,
            height,
            terrain,
            locations: HashMap::new(),
            discovered_tiles: HashSet::new(),
        }
    }

    /// Get terrain at a position, returning None if out of bounds
    pub fn get_terrain(&self, x: u32, y: u32) -> Option<WorldTerrain> {
        if x < self.width && y < self.height {
            Some(self.terrain[y as usize][x as usize])
        } else {
            None
        }
    }

    /// Set terrain at a position
    pub fn set_terrain(&mut self, x: u32, y: u32, terrain: WorldTerrain) {
        if x < self.width && y < self.height {
            self.terrain[y as usize][x as usize] = terrain;
        }
    }

    /// Check if a world position is passable
    pub fn is_passable(&self, x: u32, y: u32) -> bool {
        self.get_terrain(x, y)
            .map(|t| t.is_passable())
            .unwrap_or(false)
    }

    /// Find a location at the given world position
    pub fn location_at(&self, x: u32, y: u32) -> Option<&Location> {
        self.locations
            .values()
            .find(|loc| loc.world_position == (x, y))
    }

    /// Add a location to the world map
    pub fn add_location(&mut self, location: Location) {
        self.locations.insert(location.id, location);
    }

    /// Discover tiles around a position (simple radius)
    pub fn discover_around(&mut self, x: u32, y: u32, radius: u32) {
        let r = radius as i64;
        for dy in -r..=r {
            for dx in -r..=r {
                let tx = x as i64 + dx;
                let ty = y as i64 + dy;
                if tx >= 0 && ty >= 0 && (tx as u32) < self.width && (ty as u32) < self.height {
                    self.discovered_tiles.insert((tx as u32, ty as u32));
                }
            }
        }
    }
}
