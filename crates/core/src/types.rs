use serde::{Deserialize, Serialize};

/// Unique identifier types
pub type LocationId = u32;
pub type MapId = u32;
pub type CharacterId = u32;
pub type QuestId = u32;

/// Cardinal directions for party facing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    North,
    South,
    East,
    West,
}

/// Current view mode — drives which renderer is active
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ViewMode {
    WorldMap,
    TacticalExploration,
    TacticalCombat,
    Menu,
}

/// Cover types for tactical combat
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoverType {
    None,
    Lesser,
    Standard,
    Greater,
}

/// Game time tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameTime {
    /// Total minutes elapsed since game start
    pub total_minutes: u64,
}

impl GameTime {
    pub fn new() -> Self {
        Self { total_minutes: 0 }
    }

    pub fn hour(&self) -> u64 {
        (self.total_minutes / 60) % 24
    }

    pub fn day(&self) -> u64 {
        self.total_minutes / (60 * 24)
    }

    pub fn advance_minutes(&mut self, minutes: u64) {
        self.total_minutes += minutes;
    }

    pub fn is_night(&self) -> bool {
        let hour = self.hour();
        hour >= 20 || hour < 6
    }
}

impl Default for GameTime {
    fn default() -> Self {
        // Start at 8:00 AM on day 0
        Self {
            total_minutes: 8 * 60,
        }
    }
}
