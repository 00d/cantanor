use serde::Serialize;
use wasm_bindgen::prelude::*;

use pathfinder_core::character::*;
use pathfinder_core::game::*;
use pathfinder_core::tactical::*;
use pathfinder_core::types::*;
use pathfinder_core::world::*;

/// Serialize to JsValue with HashMaps rendered as plain JS objects (not Map)
fn to_js<T: Serialize>(value: &T) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer).unwrap_or(JsValue::NULL)
}

/// The main game engine exposed to JavaScript
#[wasm_bindgen]
pub struct GameEngine {
    state: GameState,
}

#[wasm_bindgen]
impl GameEngine {
    /// Create a new game with a demo world
    #[wasm_bindgen(constructor)]
    pub fn new() -> GameEngine {
        // Set up panic hook for better error messages in browser console
        console_error_panic_hook_set_once();

        let state = create_demo_game();
        GameEngine { state }
    }

    /// Get the current view mode as a string
    #[wasm_bindgen(js_name = "getViewMode")]
    pub fn get_view_mode(&self) -> String {
        match self.state.current_view {
            ViewMode::WorldMap => "world_map".to_string(),
            ViewMode::TacticalExploration => "tactical_exploration".to_string(),
            ViewMode::TacticalCombat => "tactical_combat".to_string(),
            ViewMode::Menu => "menu".to_string(),
        }
    }

    /// Get the full view state as a JS value
    #[wasm_bindgen(js_name = "getViewState")]
    pub fn get_view_state(&self) -> JsValue {
        let view_state = self.state.get_view_state();
        to_js(&view_state)
    }

    /// Get party info as a JS value
    #[wasm_bindgen(js_name = "getPartyInfo")]
    pub fn get_party_info(&self) -> JsValue {
        let info: Vec<_> = self
            .state
            .party
            .members
            .iter()
            .filter_map(|id| self.state.characters.get(id))
            .map(|c| PartyMemberInfo {
                id: c.id,
                name: c.name.clone(),
                class: format!("{:?}", c.class),
                level: c.level,
                current_hp: c.current_hp,
                max_hp: c.max_hp,
            })
            .collect();
        to_js(&info)
    }

    /// Move the party on the world map. Returns a result string.
    #[wasm_bindgen(js_name = "movePartyWorld")]
    pub fn move_party_world(&mut self, dx: i32, dy: i32) -> JsValue {
        match self.state.move_party_world(dx, dy) {
            Ok(result) => to_js(&result),
            Err(e) => {
                let err_msg = format!("{}", e);
                to_js(&err_msg)
            }
        }
    }

    /// Enter a location from the world map
    #[wasm_bindgen(js_name = "enterLocation")]
    pub fn enter_location(&mut self, location_id: u32) -> bool {
        self.state.enter_location(location_id).is_ok()
    }

    /// Move a character on the tactical map
    #[wasm_bindgen(js_name = "moveCharacterTactical")]
    pub fn move_character_tactical(&mut self, char_id: u32, x: u16, y: u16) -> JsValue {
        match self.state.move_character_tactical(char_id, x, y) {
            Ok(result) => to_js(&result),
            Err(e) => {
                let err_msg = format!("{}", e);
                to_js(&err_msg)
            }
        }
    }

    /// Exit tactical map to the world map
    #[wasm_bindgen(js_name = "exitToWorld")]
    pub fn exit_to_world(&mut self, world_x: u32, world_y: u32) -> bool {
        self.state.exit_to_world(world_x, world_y).is_ok()
    }

    /// Get the game time
    #[wasm_bindgen(js_name = "getGameTime")]
    pub fn get_game_time(&self) -> JsValue {
        let time = &self.state.game_time;
        let info = GameTimeInfo {
            day: time.day(),
            hour: time.hour(),
            is_night: time.is_night(),
            total_minutes: time.total_minutes,
        };
        to_js(&info)
    }
}

/// Simplified party member info for the UI
#[derive(serde::Serialize)]
struct PartyMemberInfo {
    id: u32,
    name: String,
    class: String,
    level: u8,
    current_hp: i32,
    max_hp: i32,
}

/// Simplified game time info for the UI
#[derive(serde::Serialize)]
struct GameTimeInfo {
    day: u64,
    hour: u64,
    is_night: bool,
    total_minutes: u64,
}

/// Create a demo game with a small world map and a dungeon
fn create_demo_game() -> GameState {
    let mut state = GameState::new(30, 20);

    // Paint some terrain on the world map
    // A road going east from start
    for x in 0..15 {
        state.world_map.set_terrain(x, 5, WorldTerrain::Road);
    }
    // Forest areas
    for y in 0..4 {
        for x in 2..8 {
            state.world_map.set_terrain(x, y, WorldTerrain::Forest);
        }
    }
    // Mountains
    for x in 10..15 {
        for y in 0..4 {
            state.world_map.set_terrain(x, y, WorldTerrain::Mountains);
        }
    }
    // Water (lake)
    for x in 18..23 {
        for y in 8..13 {
            state.world_map.set_terrain(x, y, WorldTerrain::Water);
        }
    }
    // Desert region
    for x in 20..28 {
        for y in 0..6 {
            state.world_map.set_terrain(x, y, WorldTerrain::Desert);
        }
    }
    // More roads
    for y in 5..15 {
        state.world_map.set_terrain(14, y, WorldTerrain::Road);
    }
    for x in 14..25 {
        state.world_map.set_terrain(x, 14, WorldTerrain::Road);
    }

    // Add a starting town
    let town = Location {
        id: 1,
        name: "Willowdale".to_string(),
        location_type: LocationType::Town,
        world_position: (2, 5),
        tactical_map_id: Some(100),
        discovered: true,
        quest_markers: vec![],
    };
    state.world_map.add_location(town);
    state.world_map.set_terrain(2, 5, WorldTerrain::City);

    // Add a dungeon
    let dungeon = Location {
        id: 2,
        name: "Goblin Cave".to_string(),
        location_type: LocationType::Dungeon,
        world_position: (14, 3),
        tactical_map_id: Some(200),
        discovered: true,
        quest_markers: vec![],
    };
    state.world_map.add_location(dungeon);

    // Add a quest location
    let quest_loc = Location {
        id: 3,
        name: "Ancient Ruins".to_string(),
        location_type: LocationType::QuestLocation,
        world_position: (24, 14),
        tactical_map_id: Some(300),
        discovered: true,
        quest_markers: vec![],
    };
    state.world_map.add_location(quest_loc);

    // Create the town tactical map
    let mut town_map = TacticalMap::new(100, "Willowdale Town", 20, 15);
    // Add some walls around the edges
    for x in 0..20 {
        town_map.set_tile(x, 0, TacticalTile::wall());
        town_map.set_tile(x, 14, TacticalTile::wall());
    }
    for y in 0..15 {
        town_map.set_tile(0, y, TacticalTile::wall());
        town_map.set_tile(19, y, TacticalTile::wall());
    }
    // Buildings (small wall clusters)
    for x in 3..7 {
        for y in 3..6 {
            town_map.set_tile(x, y, TacticalTile::wall());
        }
    }
    town_map.set_tile(5, 5, TacticalTile::new(TacticalTerrain::Door)); // shop door
    for x in 12..16 {
        for y in 3..6 {
            town_map.set_tile(x, y, TacticalTile::wall());
        }
    }
    town_map.set_tile(14, 5, TacticalTile::new(TacticalTerrain::Door)); // inn door

    // Grass areas
    for x in 1..19 {
        for y in 1..14 {
            if town_map.is_passable(x, y) {
                town_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Grass));
            }
        }
    }
    // Stone paths
    for x in 1..19 {
        town_map.set_tile(x, 7, TacticalTile::new(TacticalTerrain::Stone));
    }
    for y in 1..14 {
        town_map.set_tile(10, y, TacticalTile::new(TacticalTerrain::Stone));
    }

    town_map.spawn_points = vec![(10, 13), (11, 13), (9, 13), (12, 13)];
    town_map.exits.push(Exit {
        position: (10, 14),
        destination: ExitDestination::WorldMap(2, 5),
    });
    state.add_tactical_map(town_map);

    // Create the dungeon tactical map
    let mut dungeon_map = TacticalMap::new(200, "Goblin Cave - Level 1", 25, 20);
    // Fill with walls, then carve rooms
    for y in 0..20 {
        for x in 0..25 {
            dungeon_map.set_tile(x, y, TacticalTile::wall());
        }
    }
    // Entrance corridor
    for y in 16..20 {
        for x in 11..14 {
            dungeon_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Dirt));
        }
    }
    // Main room
    for y in 10..17 {
        for x in 5..20 {
            dungeon_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Stone));
        }
    }
    // Side corridor
    for y in 5..11 {
        for x in 11..14 {
            dungeon_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Dirt));
        }
    }
    // Boss room
    for y in 2..6 {
        for x in 7..18 {
            dungeon_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Stone));
        }
    }
    // Add a chest in boss room
    let mut chest_tile = TacticalTile::new(TacticalTerrain::Stone);
    chest_tile.special = Some(TileSpecial::Chest { looted: false });
    dungeon_map.set_tile(12, 3, chest_tile);

    dungeon_map.spawn_points = vec![(12, 18), (11, 18), (13, 18), (12, 17)];
    dungeon_map.exits.push(Exit {
        position: (12, 19),
        destination: ExitDestination::WorldMap(14, 3),
    });
    state.add_tactical_map(dungeon_map);

    // Create the ruins tactical map
    let mut ruins_map = TacticalMap::new(300, "Ancient Ruins", 18, 18);
    for y in 0..18 {
        for x in 0..18 {
            ruins_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Grass));
        }
    }
    // Ruined walls (partial)
    for x in 3..15 {
        ruins_map.set_tile(x, 3, TacticalTile::wall());
        if x % 3 != 0 {
            ruins_map.set_tile(x, 14, TacticalTile::wall());
        }
    }
    for y in 3..15 {
        if y % 4 != 0 {
            ruins_map.set_tile(3, y, TacticalTile::wall());
        }
        ruins_map.set_tile(14, y, TacticalTile::wall());
    }
    // Inner stone floor
    for y in 4..14 {
        for x in 4..14 {
            ruins_map.set_tile(x, y, TacticalTile::new(TacticalTerrain::Stone));
        }
    }
    ruins_map.spawn_points = vec![(9, 16), (8, 16), (10, 16), (9, 15)];
    ruins_map.exits.push(Exit {
        position: (9, 17),
        destination: ExitDestination::WorldMap(24, 14),
    });
    state.add_tactical_map(ruins_map);

    // Set starting position and discover nearby tiles
    state.party_world_position = Some((2, 5));
    state.world_map.discover_around(2, 5, 3);

    // Create party members
    state.add_character(Character::new(1, "Valeria", Ancestry::Human, Class::Fighter));
    state.add_character(Character::new(2, "Thornwick", Ancestry::Elf, Class::Wizard));
    state.add_character(Character::new(3, "Brak", Ancestry::Dwarf, Class::Cleric));
    state.add_character(Character::new(4, "Pip", Ancestry::Halfling, Class::Rogue));

    state
}

/// Placeholder for panic hook setup
fn console_error_panic_hook_set_once() {
    // Could add console_error_panic_hook crate here for better WASM error messages
}
