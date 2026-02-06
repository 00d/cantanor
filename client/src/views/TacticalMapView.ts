import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { TacticalViewState, CharacterPosition, TacticalTile, Exit } from '../types';
import { TACTICAL_TERRAIN_COLORS } from '../types';

const TILE_SIZE = 32;

export class TacticalMapView {
  readonly container: Container;

  private terrainLayer: Container;
  private objectLayer: Container;
  private characterLayer: Container;
  private highlightLayer: Container;
  private cameraTarget: { x: number; y: number } = { x: 0, y: 0 };
  private selectedCharId: number | null = null;

  private mapWidth = 0;
  private mapHeight = 0;

  constructor() {
    this.container = new Container();

    this.terrainLayer = new Container();
    this.highlightLayer = new Container();
    this.objectLayer = new Container();
    this.characterLayer = new Container();

    this.container.addChild(this.terrainLayer);
    this.container.addChild(this.highlightLayer);
    this.container.addChild(this.objectLayer);
    this.container.addChild(this.characterLayer);
  }

  render(
    state: TacticalViewState,
    screenWidth: number,
    screenHeight: number,
    selectedCharId: number | null,
  ): void {
    this.mapWidth = state.mapWidth;
    this.mapHeight = state.mapHeight;
    this.selectedCharId = selectedCharId;

    this.renderTerrain(state.tiles);
    this.renderObjects(state.tiles, state.exits);
    this.renderCharacters(state.partyPositions);
    this.renderHighlight(state.partyPositions, selectedCharId);

    const focusPos = state.partyPositions.find((p) => p.id === selectedCharId)
      ?? state.partyPositions[0];
    if (focusPos) {
      this.updateCamera([focusPos.x, focusPos.y], screenWidth, screenHeight);
    }
  }

  private renderTerrain(tiles: TacticalTile[][]): void {
    if (this.terrainLayer.children.length > 0) {
      this.terrainLayer.removeChildren();
    }

    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        const tile = tiles[y][x];
        const color = TACTICAL_TERRAIN_COLORS[tile.terrain] ?? 0x555555;

        const gfx = new Graphics();
        gfx.rect(0, 0, TILE_SIZE, TILE_SIZE);
        gfx.fill(color);
        gfx.rect(0, 0, TILE_SIZE, TILE_SIZE);
        gfx.stroke({ width: 1, color: 0x000000, alpha: 0.3 });

        gfx.x = x * TILE_SIZE;
        gfx.y = y * TILE_SIZE;
        this.terrainLayer.addChild(gfx);
      }
    }
  }

  private renderObjects(tiles: TacticalTile[][], exits: Exit[]): void {
    this.objectLayer.removeChildren();

    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        const tile = tiles[y][x];
        if (!tile.special) continue;

        const cx = x * TILE_SIZE + TILE_SIZE / 2;
        const cy = y * TILE_SIZE + TILE_SIZE / 2;
        const icon = new Graphics();

        if (tile.special.type === 'Chest') {
          icon.roundRect(cx - 6, cy - 4, 12, 8, 2);
          icon.fill(0xdaa520);
          icon.stroke({ width: 1, color: 0x8b6914 });
        } else if (tile.special.type === 'Trap') {
          icon.poly([cx, cy - 6, cx + 6, cy + 4, cx - 6, cy + 4]);
          icon.fill({ color: 0xff0000, alpha: 0.5 });
        }

        this.objectLayer.addChild(icon);
      }
    }

    for (const exit of exits) {
      const [ex, ey] = exit.position;
      const cx = ex * TILE_SIZE + TILE_SIZE / 2;
      const cy = ey * TILE_SIZE + TILE_SIZE / 2;

      const marker = new Graphics();
      marker.poly([cx, cy - 8, cx + 6, cy + 4, cx + 2, cy + 4, cx + 2, cy + 8, cx - 2, cy + 8, cx - 2, cy + 4, cx - 6, cy + 4]);
      marker.fill({ color: 0x00ff88, alpha: 0.7 });

      const label = new Text({
        text: 'EXIT',
        style: new TextStyle({
          fontSize: 8,
          fill: 0x00ff88,
          fontFamily: 'monospace',
        }),
      });
      label.anchor.set(0.5, 0);
      label.x = cx;
      label.y = cy + 10;
      this.objectLayer.addChild(marker);
      this.objectLayer.addChild(label);
    }
  }

  private renderCharacters(positions: CharacterPosition[]): void {
    this.characterLayer.removeChildren();

    const charColors = [0x2196f3, 0xe91e63, 0x4caf50, 0xff9800];

    for (let i = 0; i < positions.length; i++) {
      const { id, x, y } = positions[i];
      const px = x * TILE_SIZE + TILE_SIZE / 2;
      const py = y * TILE_SIZE + TILE_SIZE / 2;

      const sprite = new Graphics();
      const color = charColors[i % charColors.length];

      sprite.circle(px, py, 10);
      sprite.fill(color);
      sprite.stroke({
        width: this.selectedCharId === id ? 3 : 1,
        color: this.selectedCharId === id ? 0xffffff : 0x000000,
      });

      const label = new Text({
        text: `${id}`,
        style: new TextStyle({
          fontSize: 10,
          fill: 0xffffff,
          fontFamily: 'monospace',
          fontWeight: 'bold',
        }),
      });
      label.anchor.set(0.5, 0.5);
      label.x = px;
      label.y = py;
      this.characterLayer.addChild(sprite);
      this.characterLayer.addChild(label);
    }
  }

  private renderHighlight(
    positions: CharacterPosition[],
    selectedCharId: number | null,
  ): void {
    this.highlightLayer.removeChildren();
    if (selectedCharId === null) return;

    const pos = positions.find((p) => p.id === selectedCharId);
    if (!pos) return;

    const highlight = new Graphics();
    highlight.rect(pos.x * TILE_SIZE, pos.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    highlight.stroke({ width: 2, color: 0xffff00, alpha: 0.8 });
    this.highlightLayer.addChild(highlight);
  }

  private updateCamera(position: [number, number], screenWidth: number, screenHeight: number): void {
    const [px, py] = position;
    const viewHeight = screenHeight - 120;

    this.cameraTarget.x = -(px * TILE_SIZE + TILE_SIZE / 2) + screenWidth / 2;
    this.cameraTarget.y = -(py * TILE_SIZE + TILE_SIZE / 2) + viewHeight / 2 + 40;

    const maxX = 0;
    const maxY = 40;
    const minX = -(this.mapWidth * TILE_SIZE - screenWidth);
    const minY = -(this.mapHeight * TILE_SIZE - viewHeight) + 40;

    this.cameraTarget.x = Math.min(maxX, Math.max(minX, this.cameraTarget.x));
    this.cameraTarget.y = Math.min(maxY, Math.max(minY, this.cameraTarget.y));

    this.container.x += (this.cameraTarget.x - this.container.x) * 0.2;
    this.container.y += (this.cameraTarget.y - this.container.y) * 0.2;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
