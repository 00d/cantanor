use crate::game::*;
use crate::tactical::*;
use crate::types::*;

impl GameState {
    /// Transition from world map into a location's tactical map
    pub fn enter_location(&mut self, location_id: LocationId) -> Result<(), GameError> {
        if self.current_view != ViewMode::WorldMap {
            return Err(GameError::WrongView);
        }

        // Find the location
        let location = self
            .world_map
            .locations
            .get(&location_id)
            .ok_or(GameError::InvalidLocation)?;

        // Get the tactical map
        let map_id = location.tactical_map_id.ok_or(GameError::NoMap)?;
        let tactical_map = self.tactical_maps.get(&map_id).ok_or(GameError::NoMap)?;

        // Position party at spawn points
        self.party_tactical_positions.clear();
        for (i, &char_id) in self.party.members.iter().enumerate() {
            if let Some(&(sx, sy)) = tactical_map.spawn_points.get(i) {
                self.party_tactical_positions.insert(char_id, (sx, sy));
            } else if let Some(&(sx, sy)) = tactical_map.spawn_points.first() {
                // Fallback: offset from first spawn point
                self.party_tactical_positions
                    .insert(char_id, (sx + i as u16, sy));
            }
        }

        // Switch view
        self.active_tactical_map = Some(map_id);
        self.party_world_position = None;
        self.current_view = ViewMode::TacticalExploration;

        Ok(())
    }

    /// Transition from tactical map back to the world map
    pub fn exit_to_world(&mut self, world_x: u32, world_y: u32) -> Result<(), GameError> {
        if !matches!(
            self.current_view,
            ViewMode::TacticalExploration | ViewMode::TacticalCombat
        ) {
            return Err(GameError::WrongView);
        }

        // Clear tactical state
        self.party_tactical_positions.clear();
        self.active_tactical_map = None;

        // Restore world position
        self.party_world_position = Some((world_x, world_y));
        self.current_view = ViewMode::WorldMap;

        Ok(())
    }

    /// Transition between tactical maps (e.g., dungeon level 1 → level 2)
    pub fn transition_tactical(
        &mut self,
        next_map_id: MapId,
        spawn_x: u16,
        spawn_y: u16,
    ) -> Result<(), GameError> {
        if !matches!(
            self.current_view,
            ViewMode::TacticalExploration | ViewMode::TacticalCombat
        ) {
            return Err(GameError::WrongView);
        }

        let tactical_map = self
            .tactical_maps
            .get(&next_map_id)
            .ok_or(GameError::NoMap)?;

        // Reposition party
        self.party_tactical_positions.clear();
        for (i, &char_id) in self.party.members.iter().enumerate() {
            let x = spawn_x + i as u16;
            let y = spawn_y;
            if tactical_map.is_passable(x, y) {
                self.party_tactical_positions.insert(char_id, (x, y));
            } else {
                self.party_tactical_positions
                    .insert(char_id, (spawn_x, spawn_y));
            }
        }

        self.active_tactical_map = Some(next_map_id);
        self.current_view = ViewMode::TacticalExploration;

        Ok(())
    }

    /// Handle exit logic — dispatches to correct transition
    pub fn handle_exit(&mut self, exit: &Exit) -> Result<(), GameError> {
        match &exit.destination {
            ExitDestination::WorldMap(wx, wy) => self.exit_to_world(*wx, *wy),
            ExitDestination::TacticalMap(map_id, sx, sy) => {
                self.transition_tactical(*map_id, *sx, *sy)
            }
        }
    }
}
