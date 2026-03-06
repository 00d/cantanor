/**
 * Area targeting helpers.
 */

export function radiusPoints(
  cx: number,
  cy: number,
  radius: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= radius) {
        points.push([x, y]);
      }
    }
  }
  return points;
}

export function linePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  // Bresenham line algorithm
  const points: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/**
 * Line-spell footprint: the tiles a fixed-length line hits when aimed from
 * `origin` toward `aim`.
 *
 * The aim point fixes DIRECTION, not length. A 60-foot lightning bolt aimed at
 * a goblin 2 tiles away still travels 12 tiles in that direction. We project
 * the aim vector out to `lengthTiles` (Chebyshev, since Bresenham produces
 * `cheb` tiles for a Chebyshev-distance of `cheb`), walk Bresenham to that
 * projected endpoint, skip the origin, and truncate to `lengthTiles`.
 *
 * Returns `[]` if aim === origin (no direction to aim in).
 */
export function lineAimPoints(
  ox: number,
  oy: number,
  aimX: number,
  aimY: number,
  lengthTiles: number,
): Array<[number, number]> {
  const dx = aimX - ox;
  const dy = aimY - oy;
  if (dx === 0 && dy === 0) return [];

  const cheb = Math.max(Math.abs(dx), Math.abs(dy));
  const scale = lengthTiles / cheb;
  const farX = ox + Math.round(dx * scale);
  const farY = oy + Math.round(dy * scale);

  // Skip index 0 (origin), clamp to lengthTiles (rounding may overshoot).
  return linePoints(ox, oy, farX, farY).slice(1, 1 + lengthTiles);
}

export function conePoints(
  originX: number,
  originY: number,
  facingX: number,
  facingY: number,
  lengthTiles: number,
): Array<[number, number]> {
  /** Return points in a 90-degree cone from origin toward facing point. */
  const length = Math.max(1, lengthTiles);
  const dirX = facingX - originX;
  const dirY = facingY - originY;
  if (dirX === 0 && dirY === 0) return [[originX, originY]];

  const norm = Math.hypot(dirX, dirY);
  const unitX = dirX / norm;
  const unitY = dirY / norm;
  const minDot = Math.cos((45.0 * Math.PI) / 180.0);

  const points: Array<[number, number]> = [];
  for (let x = originX - length; x <= originX + length; x++) {
    for (let y = originY - length; y <= originY + length; y++) {
      const vecX = x - originX;
      const vecY = y - originY;
      const dist = Math.hypot(vecX, vecY);
      if (dist === 0) {
        points.push([x, y]);
        continue;
      }
      if (dist > length) continue;
      const dot = (vecX * unitX + vecY * unitY) / dist;
      if (dot >= minDot) {
        points.push([x, y]);
      }
    }
  }
  return points;
}

export function inArea(
  point: [number, number],
  area: Array<[number, number]>,
): boolean {
  return area.some(([x, y]) => x === point[0] && y === point[1]);
}
