/**
 * Tests for area targeting mechanics.
 * Ported from tests/contract/test_targeting_areas.py
 *
 * These tests are CRITICAL for tactical combat - they validate:
 * - Burst/radius targeting (AOE spells)
 * - Line targeting (lightning bolt, etc.)
 * - Cone targeting (cone of fire, etc.)
 */

import { describe, test, expect } from "vitest";
import { radiusPoints, linePoints, conePoints } from "./areas";

describe("Radius Points (Burst AOE)", () => {
  test("radius points contains center and adjacent tiles", () => {
    const area = new Set(radiusPoints(2, 2, 1).map(([x, y]) => `${x},${y}`));

    // Center tile
    expect(area.has("2,2")).toBe(true);

    // Adjacent tiles (4-connected)
    expect(area.has("2,1")).toBe(true); // North
    expect(area.has("1,2")).toBe(true); // West
    expect(area.has("3,2")).toBe(true); // East
    expect(area.has("2,3")).toBe(true); // South

    // Diagonal tiles are NOT within radius 1 (manhattan distance)
    expect(area.has("3,3")).toBe(false);
  });

  test("radius 0 contains only center", () => {
    const area = radiusPoints(5, 5, 0);
    expect(area.length).toBe(1);
    expect(area[0]).toEqual([5, 5]);
  });

  test("radius 2 includes diagonals", () => {
    const area = new Set(radiusPoints(0, 0, 2).map(([x, y]) => `${x},${y}`));

    // Center
    expect(area.has("0,0")).toBe(true);

    // Distance 2 diagonal (manhattan distance = 2)
    expect(area.has("1,1")).toBe(true);

    // Distance 3 diagonal not included
    expect(area.has("2,2")).toBe(false);
  });
});

describe("Line Points", () => {
  test("line points returns endpoints", () => {
    const pts = linePoints(0, 0, 3, 0);

    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([3, 0]);
    expect(pts.length).toBe(4);
  });

  test("horizontal line includes all intermediate tiles", () => {
    const pts = linePoints(1, 1, 5, 1);

    expect(pts.length).toBe(5);
    expect(pts).toContainEqual([1, 1]);
    expect(pts).toContainEqual([2, 1]);
    expect(pts).toContainEqual([3, 1]);
    expect(pts).toContainEqual([4, 1]);
    expect(pts).toContainEqual([5, 1]);
  });

  test("vertical line includes all intermediate tiles", () => {
    const pts = linePoints(2, 0, 2, 4);

    expect(pts.length).toBe(5);
    expect(pts).toContainEqual([2, 0]);
    expect(pts).toContainEqual([2, 1]);
    expect(pts).toContainEqual([2, 2]);
    expect(pts).toContainEqual([2, 3]);
    expect(pts).toContainEqual([2, 4]);
  });

  test("diagonal line uses Bresenham algorithm", () => {
    const pts = linePoints(0, 0, 3, 3);

    // Should include endpoints
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([3, 3]);

    // Should be continuous (no gaps)
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Cone Points", () => {
  test("cone points faces toward target", () => {
    const pts = new Set(
      conePoints(5, 5, 8, 5, 3).map(([x, y]) => `${x},${y}`),
    );

    // Origin included
    expect(pts.has("5,5")).toBe(true);

    // Points ahead in cone direction (east)
    expect(pts.has("6,5")).toBe(true);
    expect(pts.has("7,6")).toBe(true);

    // Points behind origin not included
    expect(pts.has("4,5")).toBe(false);

    // Points perpendicular (too far from cone axis) not included
    expect(pts.has("5,7")).toBe(false);
  });

  test("cone with zero-length direction returns origin only", () => {
    const pts = conePoints(3, 3, 3, 3, 5);

    expect(pts.length).toBe(1);
    expect(pts[0]).toEqual([3, 3]);
  });

  test("cone length limits range", () => {
    const pts = conePoints(0, 0, 5, 0, 2);

    // All points within manhattan distance 2
    for (const [x, y] of pts) {
      const dist = Math.hypot(x - 0, y - 0);
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  test("cone has 90-degree spread", () => {
    const pts = new Set(
      conePoints(5, 5, 8, 5, 4).map(([x, y]) => `${x},${y}`),
    );

    // Points within 45 degrees of east axis should be included
    expect(pts.has("6,5")).toBe(true); // Directly ahead
    expect(pts.has("7,6")).toBe(true); // Northeast diagonal (within cone)
    expect(pts.has("7,4")).toBe(true); // Southeast diagonal (within cone)

    // Points outside 45-degree spread should be excluded
    expect(pts.has("5,8")).toBe(false); // North (perpendicular)
    expect(pts.has("5,2")).toBe(false); // South (perpendicular)
  });
});
