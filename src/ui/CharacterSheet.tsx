/**
 * Character sheet — inline expansion in PartyPanel showing detailed unit stats.
 */

import type { UnitState, WeaponData } from "../engine/state";

function WeaponRow({ weapon, ammo }: { weapon: WeaponData; ammo?: number }) {
  return (
    <div className="cs-weapon">
      <span className="cs-weapon-name">
        {weapon.type === "melee" ? "⚔️" : "🏹"} {weapon.name}
      </span>
      <span className="cs-weapon-stats">
        +{weapon.attackMod} / {weapon.damage} {weapon.damageType}
      </span>
      {weapon.reach && weapon.reach > 1 && (
        <span className="cs-weapon-detail">reach {weapon.reach}</span>
      )}
      {weapon.rangeIncrement && (
        <span className="cs-weapon-detail">range {weapon.rangeIncrement}</span>
      )}
      {weapon.hands === 2 && <span className="cs-weapon-detail">2H</span>}
      {weapon.ammo != null && (
        <span className="cs-weapon-detail">
          ammo {ammo ?? weapon.ammo}/{weapon.ammo}
          {weapon.reload ? ` (reload ${weapon.reload})` : ""}
        </span>
      )}
      {weapon.traits && weapon.traits.length > 0 && (
        <span className="cs-weapon-traits">{weapon.traits.join(", ")}</span>
      )}
    </div>
  );
}

interface Props {
  unit: UnitState;
  abilitiesRemaining: Record<string, number>;
}

export function CharacterSheet({ unit, abilitiesRemaining }: Props) {
  const conditionEntries = Object.entries(unit.conditions);
  const resistanceEntries = Object.entries(unit.resistances);
  const weaknessEntries = Object.entries(unit.weaknesses);

  return (
    <div className="character-sheet">
      {/* Core stats */}
      <div className="cs-stats-grid">
        <div className="cs-stat"><span className="cs-label">AC</span> {unit.ac}</div>
        <div className="cs-stat"><span className="cs-label">Fort</span> +{unit.fortitude}</div>
        <div className="cs-stat"><span className="cs-label">Ref</span> +{unit.reflex}</div>
        <div className="cs-stat"><span className="cs-label">Will</span> +{unit.will}</div>
        <div className="cs-stat"><span className="cs-label">Spd</span> {unit.speed}</div>
        <div className="cs-stat"><span className="cs-label">Reach</span> {unit.reach}</div>
      </div>

      {/* Weapons */}
      {unit.weapons && unit.weapons.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Weapons</div>
          {unit.weapons.map((w, i) => (
            <WeaponRow key={i} weapon={w} ammo={unit.weaponAmmo?.[i]} />
          ))}
        </div>
      )}

      {/* Abilities */}
      {unit.abilities && unit.abilities.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Abilities</div>
          {unit.abilities.map((id) => {
            const remaining = abilitiesRemaining[id];
            return (
              <div key={id} className="cs-ability">
                <span className="cs-ability-name">{id.split(".").pop()?.replace(/_/g, " ")}</span>
                {remaining != null && <span className="cs-ability-uses">({remaining} uses)</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Resistances */}
      {resistanceEntries.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Resistances</div>
          <div className="cs-tags">
            {resistanceEntries.map(([type, val]) => (
              <span key={type} className="cs-tag resistance">{type} {val}</span>
            ))}
          </div>
        </div>
      )}

      {/* Weaknesses */}
      {weaknessEntries.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Weaknesses</div>
          <div className="cs-tags">
            {weaknessEntries.map(([type, val]) => (
              <span key={type} className="cs-tag weakness">{type} {val}</span>
            ))}
          </div>
        </div>
      )}

      {/* Immunities */}
      {unit.immunities.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Immunities</div>
          <div className="cs-tags">
            {unit.immunities.map((imm) => (
              <span key={imm} className="cs-tag immunity">{imm}</span>
            ))}
          </div>
        </div>
      )}

      {/* Conditions */}
      {conditionEntries.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-label">Conditions</div>
          <div className="cs-tags">
            {conditionEntries.map(([cond, val]) => (
              <span key={cond} className="condition-tag">
                {cond}{val > 1 ? ` ${val}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Shield */}
      {unit.shieldHp != null && (
        <div className="cs-section">
          <div className="cs-section-label">Shield</div>
          <span className="cs-tag">
            HP {unit.shieldHp}/{unit.shieldMaxHp} · Hardness {unit.shieldHardness}
            {unit.shieldRaised ? " (Raised)" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
