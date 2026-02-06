import { CharacterId } from './types';

export type Ancestry = 'Human' | 'Elf' | 'Dwarf' | 'Gnome' | 'Halfling' | 'Goblin' | 'Orc' | 'Leshy';

export type Class = 'Fighter' | 'Rogue' | 'Wizard' | 'Cleric' | 'Ranger' | 'Bard' | 'Barbarian' | 'Monk';

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function defaultAbilityScores(): AbilityScores {
  return {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };
}

export interface Character {
  id: CharacterId;
  name: string;
  ancestry: Ancestry;
  class: Class;
  level: number;
  abilities: AbilityScores;
  maxHp: number;
  currentHp: number;
  armorClass: number;
  speed: number;
}

export function createCharacter(
  id: CharacterId,
  name: string,
  ancestry: Ancestry,
  charClass: Class,
): Character {
  return {
    id,
    name,
    ancestry,
    class: charClass,
    level: 1,
    abilities: defaultAbilityScores(),
    maxHp: 20,
    currentHp: 20,
    armorClass: 15,
    speed: 25,
  };
}

export interface Party {
  members: CharacterId[];
  formation: Array<[CharacterId, number, number]>;
  rations: number;
  gold: number;
}

export function createParty(): Party {
  return {
    members: [],
    formation: [],
    rations: 10,
    gold: 50,
  };
}

export function addPartyMember(party: Party, id: CharacterId): void {
  if (!party.members.includes(id)) {
    const offset = party.members.length;
    party.members.push(id);
    party.formation.push([id, offset, 0]);
  }
}
