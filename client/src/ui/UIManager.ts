import type { PartyMemberInfo, GameTimeInfo } from '../types';

/**
 * Manages the HTML overlay UI — top bar, party bar, and controls hint.
 */
export class UIManager {
  private locationEl: HTMLElement;
  private timeEl: HTMLElement;
  private partyBarEl: HTMLElement;
  private controlsEl: HTMLElement;

  constructor() {
    this.locationEl = document.getElementById('location-name')!;
    this.timeEl = document.getElementById('game-time')!;
    this.partyBarEl = document.getElementById('party-bar')!;
    this.controlsEl = document.getElementById('controls-hint')!;
  }

  setLocationName(name: string): void {
    this.locationEl.textContent = name;
  }

  updateGameTime(time: GameTimeInfo): void {
    const period = time.hour >= 12 ? 'PM' : 'AM';
    const displayHour = time.hour === 0 ? 12 : time.hour > 12 ? time.hour - 12 : time.hour;
    const nightIcon = time.is_night ? ' [Night]' : '';
    this.timeEl.textContent = `Day ${time.day} - ${displayHour}:00 ${period}${nightIcon}`;
  }

  updatePartyBar(members: PartyMemberInfo[]): void {
    this.partyBarEl.innerHTML = '';
    for (const member of members) {
      const hpPct = Math.max(0, (member.current_hp / member.max_hp) * 100);
      const div = document.createElement('div');
      div.className = 'party-member';
      div.innerHTML = `
        <div class="name">${member.name}</div>
        <div class="class">Lv${member.level} ${member.class}</div>
        <div class="hp-bar"><div class="hp-bar-fill" style="width:${hpPct}%"></div></div>
        <div class="hp-text">${member.current_hp}/${member.max_hp} HP</div>
      `;
      this.partyBarEl.appendChild(div);
    }
  }

  setControlsHint(viewMode: string): void {
    switch (viewMode) {
      case 'world_map':
        this.controlsEl.innerHTML = 'Arrow keys / WASD to move<br>ENTER to enter location';
        break;
      case 'tactical_exploration':
        this.controlsEl.innerHTML = 'Arrow keys / WASD to move<br>TAB to switch character<br>ESC to exit';
        break;
      case 'tactical_combat':
        this.controlsEl.innerHTML = 'Click to move<br>TAB to switch character<br>SPACE to end turn';
        break;
      default:
        this.controlsEl.innerHTML = '';
    }
  }
}
