/**
 * Unit tests for tiledLoader.ts
 * All tests use inline JSON fixtures — no filesystem or real HTTP required.
 * fetch is mocked via vi.stubGlobal.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadTiledMap,
  resolveTileGid,
  getProperties,
  getTileProperties,
} from "../tiledLoader";
import type { TiledMap, TiledTileset, TiledProperty } from "../tiledTypes";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeTileset(overrides: Partial<TiledTileset> = {}): TiledTileset {
  return {
    firstgid: 1,
    name: "test_tileset",
    image: "tilesets/test.png",
    imagewidth: 256,
    imageheight: 64,
    tilewidth: 32,
    tileheight: 32,
    tilecount: 8,
    columns: 8,
    margin: 0,
    spacing: 0,
    ...overrides,
  };
}

function makeMap(overrides: Partial<TiledMap> = {}): TiledMap {
  return {
    version: "1.10",
    tiledversion: "1.10.0",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: 4,
    height: 4,
    tilewidth: 32,
    tileheight: 32,
    infinite: false,
    layers: [
      {
        id: 1,
        name: "Ground",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        data: [1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1],
      },
    ],
    tilesets: [makeTileset()],
    ...overrides,
  };
}

/** Creates a mock fetch that returns different JSON based on URL. */
function mockFetch(responses: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const key = Object.keys(responses).find((k) => url.endsWith(k) || url === k);
    if (!key) {
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responses[key]),
    });
  });
}

// ---------------------------------------------------------------------------
// loadTiledMap
// ---------------------------------------------------------------------------

describe("loadTiledMap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a minimal embedded-tileset map", async () => {
    const map = makeMap();
    vi.stubGlobal("fetch", mockFetch({ "/maps/test.tmj": map }));

    const result = await loadTiledMap("/maps/test.tmj");

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.tilewidth).toBe(32);
    expect(result.tilesets).toHaveLength(1);
    expect(result.tilesets[0].name).toBe("test_tileset");
  });

  it("fetches and merges an external .tsj tileset", async () => {
    const externalTsj: Omit<TiledTileset, "firstgid"> = {
      name: "external_tileset",
      image: "tilesets/external.png",
      imagewidth: 128,
      imageheight: 32,
      tilewidth: 32,
      tileheight: 32,
      tilecount: 4,
      columns: 4,
      margin: 0,
      spacing: 0,
    };

    const mapWithExternal = makeMap({
      tilesets: [{ firstgid: 1, source: "../tilesets/external.tsj" }],
    });

    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/maps/dungeon.tmj": mapWithExternal,
        "/tilesets/external.tsj": externalTsj,
      }),
    );

    const result = await loadTiledMap("/maps/dungeon.tmj");

    expect(result.tilesets).toHaveLength(1);
    expect(result.tilesets[0].name).toBe("external_tileset");
    expect(result.tilesets[0].firstgid).toBe(1); // firstgid from map ref preserved
    expect(result.tilesets[0].tilecount).toBe(4);
  });

  it("resolves external .tsj path relative to the map URL", async () => {
    const fetchMock = mockFetch({
      "/maps/arena/dungeon.tmj": makeMap({
        tilesets: [{ firstgid: 1, source: "../../tilesets/floor.tsj" }],
      }),
      "/tilesets/floor.tsj": makeTileset({ name: "floor" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadTiledMap("/maps/arena/dungeon.tmj");
    expect(result.tilesets[0].name).toBe("floor");
  });

  it("sorts multiple tilesets by firstgid ascending", async () => {
    const ts1 = makeTileset({ firstgid: 1, name: "first", tilecount: 8 });
    const ts2 = makeTileset({ firstgid: 17, name: "second", tilecount: 8 });
    const mapWithTwo = makeMap({ tilesets: [ts2, ts1] }); // intentionally reversed

    vi.stubGlobal("fetch", mockFetch({ "/maps/two.tmj": mapWithTwo }));

    const result = await loadTiledMap("/maps/two.tmj");

    expect(result.tilesets[0].firstgid).toBe(1);
    expect(result.tilesets[1].firstgid).toBe(17);
  });

  it("throws on a non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" })),
    );

    await expect(loadTiledMap("/maps/missing.tmj")).rejects.toThrow("404");
  });

  it("throws when an external tileset cannot be fetched", async () => {
    const mapWithBroken = makeMap({
      tilesets: [{ firstgid: 1, source: "broken.tsj" }],
    });
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/maps/test.tmj": mapWithBroken }), // broken.tsj not in responses → 404
    );

    await expect(loadTiledMap("/maps/test.tmj")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveTileGid
// ---------------------------------------------------------------------------

describe("resolveTileGid", () => {
  const ts1 = makeTileset({ firstgid: 1, tilecount: 8 });   // GIDs 1–8
  const ts2 = makeTileset({ firstgid: 9, tilecount: 8 });   // GIDs 9–16
  const ts3 = makeTileset({ firstgid: 17, tilecount: 16 }); // GIDs 17–32

  const tilesets = [ts1, ts2, ts3];

  it("returns null for GID 0 (empty cell)", () => {
    expect(resolveTileGid(0, tilesets)).toBeNull();
  });

  it("resolves a GID in the first tileset", () => {
    const result = resolveTileGid(1, tilesets);
    expect(result).not.toBeNull();
    expect(result!.tileset).toBe(ts1);
    expect(result!.localId).toBe(0);
  });

  it("resolves a GID in the second tileset", () => {
    const result = resolveTileGid(12, tilesets);
    expect(result).not.toBeNull();
    expect(result!.tileset).toBe(ts2);
    expect(result!.localId).toBe(3); // 12 - 9
  });

  it("resolves a GID in the third tileset", () => {
    const result = resolveTileGid(20, tilesets);
    expect(result).not.toBeNull();
    expect(result!.tileset).toBe(ts3);
    expect(result!.localId).toBe(3); // 20 - 17
  });

  it("resolves the last GID in a tileset exactly", () => {
    // ts1 contains GIDs 1..8; GID 8 = localId 7
    const result = resolveTileGid(8, tilesets);
    expect(result!.tileset).toBe(ts1);
    expect(result!.localId).toBe(7);
  });

  it("strips the horizontal-flip flag (0x80000000)", () => {
    const rawGid = 1 | 0x80000000;
    const result = resolveTileGid(rawGid, tilesets);
    expect(result).not.toBeNull();
    expect(result!.localId).toBe(0);
  });

  it("strips the vertical-flip flag (0x40000000)", () => {
    const rawGid = 3 | 0x40000000;
    const result = resolveTileGid(rawGid, tilesets);
    expect(result!.localId).toBe(2); // 3 - 1
  });

  it("strips the diagonal-flip flag (0x20000000)", () => {
    const rawGid = 5 | 0x20000000;
    const result = resolveTileGid(rawGid, tilesets);
    expect(result!.localId).toBe(4); // 5 - 1
  });

  it("strips all three flip flags simultaneously", () => {
    const rawGid = 2 | 0x80000000 | 0x40000000 | 0x20000000;
    const result = resolveTileGid(rawGid, tilesets);
    expect(result!.tileset).toBe(ts1);
    expect(result!.localId).toBe(1); // 2 - 1
  });

  it("returns null for a GID beyond all tilesets", () => {
    expect(resolveTileGid(999, tilesets)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getProperties
// ---------------------------------------------------------------------------

describe("getProperties", () => {
  it("returns empty object for undefined input", () => {
    expect(getProperties(undefined)).toEqual({});
  });

  it("returns empty object for empty array", () => {
    expect(getProperties([])).toEqual({});
  });

  it("maps property names to values", () => {
    const props: TiledProperty[] = [
      { name: "blocked", type: "bool", value: true },
      { name: "moveCost", type: "int", value: 2 },
      { name: "terrain", type: "string", value: "water" },
    ];
    expect(getProperties(props)).toEqual({
      blocked: true,
      moveCost: 2,
      terrain: "water",
    });
  });

  it("preserves false boolean values", () => {
    const props: TiledProperty[] = [{ name: "blocked", type: "bool", value: false }];
    expect(getProperties(props)).toEqual({ blocked: false });
  });

  it("preserves zero numeric values", () => {
    const props: TiledProperty[] = [{ name: "elevation", type: "int", value: 0 }];
    expect(getProperties(props)).toEqual({ elevation: 0 });
  });
});

// ---------------------------------------------------------------------------
// getTileProperties
// ---------------------------------------------------------------------------

describe("getTileProperties", () => {
  const tileset = makeTileset({
    tiles: [
      {
        id: 0,
        properties: [{ name: "blocked", type: "bool", value: true }],
      },
      {
        id: 3,
        properties: [
          { name: "terrain", type: "string", value: "water" },
          { name: "moveCost", type: "int", value: 3 },
        ],
      },
    ],
  });

  it("returns properties for a known tile ID", () => {
    expect(getTileProperties(tileset, 0)).toEqual({ blocked: true });
  });

  it("returns properties for a different known tile ID", () => {
    expect(getTileProperties(tileset, 3)).toEqual({ terrain: "water", moveCost: 3 });
  });

  it("returns empty object for a tile with no property entry", () => {
    expect(getTileProperties(tileset, 1)).toEqual({});
  });

  it("returns empty object when tileset has no tiles array", () => {
    const bare = makeTileset();
    delete (bare as TiledTileset & { tiles?: unknown }).tiles;
    expect(getTileProperties(bare, 0)).toEqual({});
  });
});
