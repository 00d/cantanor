import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { WorldMapState, LocationInfo } from '../types';
import { WORLD_TERRAIN_COLORS } from '../types';

const TILE_SIZE = 32;

export class WorldMapView {
  readonly container: Container;

  private terrainLayer: Container;
  private locationLayer: Container;
  private partySprite: Graphics;
  private fogLayer: Container;
  private cameraTarget: { x: number; y: number } = { x: 0, y: 0 };

  private mapWidth = 0;
  private mapHeight = 0;

  constructor() {
    this.container = new Container();

    this.terrainLayer = new Container();
    this.fogLayer = new Container();
    this.locationLayer = new Container();
    this.partySprite = new Graphics();

    this.container.addChild(this.terrainLayer);
    this.container.addChild(this.fogLayer);
    this.container.addChild(this.locationLayer);
    this.container.addChild(this.partySprite);
  }

  /** Full render from state */
  render(state: WorldMapState['WorldMap'], screenWidth: number, screenHeight: number): void {
    const terrain = state.terrain;
    this.mapHeight = terrain.length;
    this.mapWidth = terrain[0]?.length ?? 0;

    this.renderTerrain(terrain);
    this.renderFog(state.discovered);
    this.renderLocations(state.locations);
    this.renderParty(state.party_position, state.party_facing);
    this.updateCamera(state.party_position, screenWidth, screenHeight);
  }

  private renderTerrain(terrain: string[][]): void {
    // Only rebuild if terrain layer is empty (first render)
    if (this.terrainLayer.children.length > 0) return;

    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y].length; x++) {
        const terrainType = terrain[y][x];
        const color = WORLD_TERRAIN_COLORS[terrainType] ?? 0x555555;

        const tile = new Graphics();
        tile.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tile.fill(color);
        // Grid line
        tile.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tile.stroke({ width: 1, color: 0x000000, alpha: 0.15 });

        tile.x = x * TILE_SIZE;
        tile.y = y * TILE_SIZE;
        this.terrainLayer.addChild(tile);
      }
    }
  }

  private renderFog(discovered: Array<[number, number]>): void {
    this.fogLayer.removeChildren();

    // Build a set for fast lookup
    const discoveredSet = new Set<string>();
    // Handle both array format and object format from serde
    if (Array.isArray(discovered)) {
      for (const tile of discovered) {
        if (Array.isArray(tile)) {
          discoveredSet.add(`${tile[0]},${tile[1]}`);
        }
      }
    }

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (!discoveredSet.has(`${x},${y}`)) {
          const fog = new Graphics();
          fog.rect(0, 0, TILE_SIZE, TILE_SIZE);
          fog.fill({ color: 0x000000, alpha: 0.7 });
          fog.x = x * TILE_SIZE;
          fog.y = y * TILE_SIZE;
          this.fogLayer.addChild(fog);
        }
      }
    }
  }

  private renderLocations(locations: LocationInfo[]): void {
    this.locationLayer.removeChildren();

    for (const loc of locations) {
      if (!loc.discovered) continue;
      const [lx, ly] = loc.world_position;

      const icon = new Graphics();
      const cx = lx * TILE_SIZE + TILE_SIZE / 2;
      const cy = ly * TILE_SIZE + TILE_SIZE / 2;

      // Different shapes for different location types
      const locType = typeof loc.location_type === 'string'
        ? loc.location_type
        : Object.keys(loc.location_type)[0];

      switch (locType) {
        case 'Town':
          // House shape
          icon.poly([cx, cy - 10, cx - 8, cy, cx - 6, cy, cx - 6, cy + 8, cx + 6, cy + 8, cx + 6, cy, cx + 8, cy]);
          icon.fill(0xffd700);
          icon.stroke({ width: 1, color: 0x8b6914 });
          break;
        case 'Dungeon':
          // Skull-like circle
          icon.circle(cx, cy, 8);
          icon.fill(0x8b0000);
          icon.stroke({ width: 2, color: 0xff4444 });
          break;
        case 'QuestLocation':
          // Star/diamond
          icon.poly([cx, cy - 10, cx + 6, cy, cx, cy + 10, cx - 6, cy]);
          icon.fill(0x9b59b6);
          icon.stroke({ width: 1, color: 0xe0b0ff });
          break;
        default:
          icon.circle(cx, cy, 6);
          icon.fill(0xcccccc);
          break;
      }

      this.locationLayer.addChild(icon);

      // Location label
      const label = new Text({
        text: loc.name,
        style: new TextStyle({
          fontSize: 10,
          fill: 0xffffff,
          fontFamily: 'monospace',
          stroke: { color: 0x000000, width: 2 },
        }),
      });
      label.anchor.set(0.5, 0);
      label.x = cx;
      label.y = cy + 12;
      this.locationLayer.addChild(label);
    }
  }

  private renderParty(position: [number, number], facing: string): void {
    const [px, py] = position;
    this.partySprite.clear();

    const cx = px * TILE_SIZE + TILE_SIZE / 2;
    const cy = py * TILE_SIZE + TILE_SIZE / 2;

    // Party token: filled circle with direction indicator
    this.partySprite.circle(cx, cy, 10);
    this.partySprite.fill(0x2196f3);
    this.partySprite.stroke({ width: 2, color: 0xffffff });

    // Direction arrow
    const arrowLen = 7;
    let ax = cx, ay = cy;
    switch (facing) {
      case 'North': ay = cy - arrowLen; break;
      case 'South': ay = cy + arrowLen; break;
      case 'East': ax = cx + arrowLen; break;
      case 'West': ax = cx - arrowLen; break;
    }
    this.partySprite.circle(ax, ay, 3);
    this.partySprite.fill(0xffffff);
  }

  private updateCamera(position: [number, number], screenWidth: number, screenHeight: number): void {
    const [px, py] = position;
    // Offset for the top bar and bottom party bar
    const viewHeight = screenHeight - 120;

    this.cameraTarget.x = -(px * TILE_SIZE + TILE_SIZE / 2) + screenWidth / 2;
    this.cameraTarget.y = -(py * TILE_SIZE + TILE_SIZE / 2) + viewHeight / 2 + 40;

    // Clamp so we don't scroll past map edges
    const maxX = 0;
    const maxY = 40; // top bar offset
    const minX = -(this.mapWidth * TILE_SIZE - screenWidth);
    const minY = -(this.mapHeight * TILE_SIZE - viewHeight) + 40;

    this.cameraTarget.x = Math.min(maxX, Math.max(minX, this.cameraTarget.x));
    this.cameraTarget.y = Math.min(maxY, Math.max(minY, this.cameraTarget.y));

    // Smooth lerp
    this.container.x += (this.cameraTarget.x - this.container.x) * 0.2;
    this.container.y += (this.cameraTarget.y - this.container.y) * 0.2;
  }

  /** Call each frame for smooth camera */
  updateCameraSmooth(position: [number, number], screenWidth: number, screenHeight: number): void {
    this.updateCamera(position, screenWidth, screenHeight);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
