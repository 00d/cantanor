/**
 * Sprite manager — creates and updates unit sprites on the battle map.
 * Uses colored rectangle placeholders until sprite sheets are available.
 * Each unit gets a container with a body graphic + label text.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { BattleState, UnitState, unitAlive } from "../engine/state";
import { TILE_SIZE } from "./pixiApp";

const TEAM_COLORS: Record<string, number> = {
  player: 0x4488ff,
  pc: 0x4488ff,      // Player characters
  party: 0x4488ff,   // Party members
  ally: 0x44ff88,    // Allies (green)
  enemy: 0xff4444,   // Enemies (red)
  neutral: 0xffaa22, // Neutral (orange)
};
const DEAD_COLOR = 0x555555;
const ACTIVE_OUTLINE = 0xffd700;   // Gold — whose turn it is
const SELECTED_OUTLINE = 0xffffff; // White — player-inspected unit
const UNIT_PADDING = 6;

interface UnitSprite {
  container: Container;
  body: Graphics;
  label: Text;
  unitId: string;
}

const _sprites = new Map<string, UnitSprite>();
let _parentLayer: Container | null = null;

function teamColor(team: string): number {
  return TEAM_COLORS[team] ?? 0x888888;
}

function createUnitSprite(unit: UnitState): UnitSprite {
  const container = new Container();
  container.label = `unit_${unit.unitId}`;

  const body = new Graphics();
  const label = new Text({
    text: unit.unitId.substring(0, 3).toUpperCase(),
    style: new TextStyle({ fontSize: 12, fill: 0xffffff, fontFamily: "monospace" }),
  });
  label.anchor.set(0.5, 0.5);
  label.position.set(TILE_SIZE / 2, TILE_SIZE / 2 + 2);

  container.addChild(body);
  container.addChild(label);
  return { container, body, label, unitId: unit.unitId };
}

function drawUnitBody(sprite: UnitSprite, unit: UnitState, selected: boolean, active: boolean): void {
  const color = unitAlive(unit) ? teamColor(unit.team) : DEAD_COLOR;
  const p = UNIT_PADDING;
  sprite.body.clear();
  sprite.body
    .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
    .fill(color);
  // Active turn unit gets a gold outline; selected-but-not-active gets white.
  if (active) {
    sprite.body.setStrokeStyle({ width: 3, color: ACTIVE_OUTLINE });
    sprite.body
      .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
      .stroke();
  } else if (selected) {
    sprite.body.setStrokeStyle({ width: 2, color: SELECTED_OUTLINE });
    sprite.body
      .roundRect(p, p, TILE_SIZE - p * 2, TILE_SIZE - p * 2, 6)
      .stroke();
  }
  sprite.label.alpha = unitAlive(unit) ? 1 : 0.4;
}

export function syncUnits(
  parent: Container,
  state: BattleState,
  selectedUnitId: string | null,
  activeUnitId: string | null,
): void {
  _parentLayer = parent;

  // Remove sprites for units no longer in state
  for (const [uid, sprite] of _sprites) {
    if (!(uid in state.units)) {
      parent.removeChild(sprite.container);
      sprite.container.destroy({ children: true });
      _sprites.delete(uid);
    }
  }

  // Add/update sprites for current units
  for (const unit of Object.values(state.units)) {
    let sprite = _sprites.get(unit.unitId);
    if (!sprite) {
      sprite = createUnitSprite(unit);
      parent.addChild(sprite.container);
      _sprites.set(unit.unitId, sprite);
    }

    // Position
    sprite.container.position.set(unit.x * TILE_SIZE, unit.y * TILE_SIZE);

    // Appearance — active (gold) takes visual priority over selected (white)
    const active = unit.unitId === activeUnitId;
    const selected = unit.unitId === selectedUnitId;
    drawUnitBody(sprite, unit, selected, active);

    // Dead units go slightly transparent and behind others
    sprite.container.alpha = unitAlive(unit) ? 1 : 0.5;
    sprite.container.zIndex = unitAlive(unit) ? unit.y * 100 + 1 : 0;
  }

  // Sort by zIndex for proper overlap
  parent.sortChildren();
}

export function clearUnits(): void {
  if (_parentLayer) {
    for (const sprite of _sprites.values()) {
      _parentLayer.removeChild(sprite.container);
      sprite.container.destroy({ children: true });
    }
  }
  _sprites.clear();
}
