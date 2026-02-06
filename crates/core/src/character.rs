use serde::{Deserialize, Serialize};

use crate::types::*;

/// PF2e ancestry (ORC-licensed names only)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Ancestry {
    Human,
    Elf,
    Dwarf,
    Gnome,
    Halfling,
    Goblin,
    Orc,
    Leshy,
}

/// PF2e class
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Class {
    Fighter,
    Rogue,
    Wizard,
    Cleric,
    Ranger,
    Bard,
    Barbarian,
    Monk,
}

/// Core ability scores
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityScores {
    pub strength: i8,
    pub dexterity: i8,
    pub constitution: i8,
    pub intelligence: i8,
    pub wisdom: i8,
    pub charisma: i8,
}

impl AbilityScores {
    pub fn modifier(score: i8) -> i8 {
        (score - 10) / 2
    }
}

impl Default for AbilityScores {
    fn default() -> Self {
        Self {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
        }
    }
}

/// A player character
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: CharacterId,
    pub name: String,
    pub ancestry: Ancestry,
    pub class: Class,
    pub level: u8,
    pub abilities: AbilityScores,
    pub max_hp: i32,
    pub current_hp: i32,
    pub armor_class: u8,
    pub speed: u8, // in feet
}

impl Character {
    pub fn new(id: CharacterId, name: &str, ancestry: Ancestry, class: Class) -> Self {
        Self {
            id,
            name: name.to_string(),
            ancestry,
            class,
            level: 1,
            abilities: AbilityScores::default(),
            max_hp: 20,
            current_hp: 20,
            armor_class: 15,
            speed: 25,
        }
    }

    pub fn is_alive(&self) -> bool {
        self.current_hp > 0
    }
}

/// The adventuring party
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Party {
    pub members: Vec<CharacterId>,
    pub formation: Vec<(CharacterId, i8, i8)>, // relative formation offsets
    pub rations: u32,
    pub gold: u32,
}

impl Party {
    pub fn new() -> Self {
        Self {
            members: Vec::new(),
            formation: Vec::new(),
            rations: 10,
            gold: 50,
        }
    }

    pub fn add_member(&mut self, id: CharacterId) {
        if !self.members.contains(&id) {
            let offset = self.members.len() as i8;
            self.members.push(id);
            self.formation.push((id, offset, 0));
        }
    }
}

impl Default for Party {
    fn default() -> Self {
        Self::new()
    }
}
