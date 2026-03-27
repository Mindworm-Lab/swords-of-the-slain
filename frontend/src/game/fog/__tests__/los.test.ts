import { describe, it, expect } from 'vitest';
import { computeLOS, tileKey, tileKeyX, tileKeyY, TILE_KEY_STRIDE } from '../los.ts';
import { diffVisibility } from '../losUtils.ts';
import { type GameMap, TileType } from '../../../game/tilemap/types.ts';

/** Helper: create a map filled entirely with floor tiles. */
function createOpenMap(width: number, height: number): GameMap {
  return {
    width,
    height,
    tiles: new Array(width * height).fill(TileType.Floor),
  };
}

/** Helper: create a map and set specific tiles to walls. */
function createMapWithWalls(
  width: number,
  height: number,
  walls: [number, number][],
): GameMap {
  const tiles = new Array(width * height).fill(TileType.Floor);
  for (const [wx, wy] of walls) {
    tiles[wy * width + wx] = TileType.Wall;
  }
  return { width, height, tiles };
}

describe('tileKey', () => {
  it('produces numeric encoding y * TILE_KEY_STRIDE + x', () => {
    expect(tileKey(3, 7)).toBe(7 * TILE_KEY_STRIDE + 3);
    expect(tileKey(0, 0)).toBe(0);
    expect(tileKey(100, 200)).toBe(200 * TILE_KEY_STRIDE + 100);
  });

  it('round-trips through tileKeyX and tileKeyY', () => {
    const pairs: [number, number][] = [[0, 0], [3, 7], [100, 200], [9999, 9999]];
    for (const [x, y] of pairs) {
      const key = tileKey(x, y);
      expect(tileKeyX(key)).toBe(x);
      expect(tileKeyY(key)).toBe(y);
    }
  });

  it('TILE_KEY_STRIDE is 10000', () => {
    expect(TILE_KEY_STRIDE).toBe(10000);
  });
});

describe('computeLOS', () => {
  it('origin tile is always visible', () => {
    const map = createOpenMap(10, 10);
    const result = computeLOS(map, 5, 5, 0);
    expect(result.visibleSet.has(tileKey(5, 5))).toBe(true);
    expect(result.visibleTiles).toContainEqual([5, 5]);
  });

  it('origin tile is visible even with radius 0', () => {
    const map = createOpenMap(10, 10);
    const result = computeLOS(map, 5, 5, 0);
    // Only the origin should be visible with radius 0
    expect(result.visibleTiles.length).toBe(1);
    expect(result.visibleTiles[0]).toEqual([5, 5]);
  });

  it('open room: all tiles within radius are visible', () => {
    const map = createOpenMap(20, 20);
    const radius = 5;
    const result = computeLOS(map, 10, 10, radius);

    // Every tile within Euclidean distance of the radius should be visible
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const dx = x - 10;
        const dy = y - 10;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          expect(
            result.visibleSet.has(tileKey(x, y)),
            `tile (${x},${y}) at distance ${dist.toFixed(2)} should be visible`,
          ).toBe(true);
        }
      }
    }
  });

  it('radius limit: tiles outside radius are not visible', () => {
    const map = createOpenMap(30, 30);
    const radius = 3;
    const result = computeLOS(map, 15, 15, radius);

    // Tiles well outside the radius should not be visible
    expect(result.visibleSet.has(tileKey(15, 20))).toBe(false); // distance 5
    expect(result.visibleSet.has(tileKey(20, 15))).toBe(false); // distance 5
    expect(result.visibleSet.has(tileKey(0, 0))).toBe(false);   // far corner
  });

  it('walls themselves are visible', () => {
    // A wall directly adjacent to the player should be seen
    const walls: [number, number][] = [[6, 5]]; // wall 1 tile east of player
    const map = createMapWithWalls(10, 10, walls);
    const result = computeLOS(map, 5, 5, 10);

    expect(result.visibleSet.has(tileKey(6, 5))).toBe(true);
  });

  it('wall blocks tiles behind it', () => {
    // Wall at (6,5), player at (5,5). Tiles at (7,5), (8,5) etc. should be blocked.
    const walls: [number, number][] = [[6, 5]];
    const map = createMapWithWalls(15, 15, walls);
    const result = computeLOS(map, 5, 5, 10);

    // Wall is visible
    expect(result.visibleSet.has(tileKey(6, 5))).toBe(true);
    // Tiles directly behind the wall should NOT be visible
    expect(result.visibleSet.has(tileKey(7, 5))).toBe(false);
    expect(result.visibleSet.has(tileKey(8, 5))).toBe(false);
  });

  it('wall blocks a column of tiles behind it', () => {
    // Vertical wall segment: walls at x=6, y=3..7 (5 tiles tall)
    // Player at (3, 5)
    const walls: [number, number][] = [];
    for (let y = 3; y <= 7; y++) {
      walls.push([6, y]);
    }
    const map = createMapWithWalls(15, 15, walls);
    const result = computeLOS(map, 3, 5, 10);

    // All wall tiles should be visible
    for (let y = 3; y <= 7; y++) {
      expect(
        result.visibleSet.has(tileKey(6, y)),
        `wall at (6,${y}) should be visible`,
      ).toBe(true);
    }

    // Tiles directly behind the wall segment should be blocked
    // (center tiles behind the wall — tiles at edges might peek around)
    expect(result.visibleSet.has(tileKey(7, 5))).toBe(false);
    expect(result.visibleSet.has(tileKey(8, 5))).toBe(false);
  });

  it('player at map corner (0,0)', () => {
    const map = createOpenMap(10, 10);
    const result = computeLOS(map, 0, 0, 5);

    // Origin always visible
    expect(result.visibleSet.has(tileKey(0, 0))).toBe(true);

    // Some nearby tiles should be visible
    expect(result.visibleSet.has(tileKey(1, 0))).toBe(true);
    expect(result.visibleSet.has(tileKey(0, 1))).toBe(true);
    expect(result.visibleSet.has(tileKey(1, 1))).toBe(true);

    // No tiles should be out of map bounds (negative coords)
    for (const [x, y] of result.visibleTiles) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
      expect(y).toBeLessThan(10);
    }
  });

  it('player at far corner of map', () => {
    const map = createOpenMap(10, 10);
    const result = computeLOS(map, 9, 9, 5);

    expect(result.visibleSet.has(tileKey(9, 9))).toBe(true);
    expect(result.visibleSet.has(tileKey(8, 9))).toBe(true);
    expect(result.visibleSet.has(tileKey(9, 8))).toBe(true);

    // All visible tiles within bounds
    for (const [x, y] of result.visibleTiles) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
      expect(y).toBeLessThan(10);
    }
  });

  it('no duplicate tiles in result', () => {
    const map = createOpenMap(20, 20);
    const result = computeLOS(map, 10, 10, 8);

    // visibleSet size should match visibleTiles length (no duplicates)
    expect(result.visibleSet.size).toBe(result.visibleTiles.length);
  });

  it('corridor: can see through narrow passage', () => {
    // Build a map where everything is wall except a 1-wide horizontal corridor
    const width = 15;
    const height = 11;
    const tiles = new Array(width * height).fill(TileType.Wall);
    // Clear corridor at y=5
    for (let x = 0; x < width; x++) {
      tiles[5 * width + x] = TileType.Floor;
    }
    const map: GameMap = { width, height, tiles };

    const result = computeLOS(map, 2, 5, 10);

    // Should see along the corridor
    expect(result.visibleSet.has(tileKey(3, 5))).toBe(true);
    expect(result.visibleSet.has(tileKey(7, 5))).toBe(true);

    // Adjacent walls should be visible (walls of the corridor)
    expect(result.visibleSet.has(tileKey(2, 4))).toBe(true);
    expect(result.visibleSet.has(tileKey(2, 6))).toBe(true);
  });

  it('performance: computes LOS on 80x80 map in under 5ms', () => {
    const map = createOpenMap(80, 80);
    const start = performance.now();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      computeLOS(map, 40, 40, 10);
    }

    const elapsed = performance.now() - start;
    const perCall = elapsed / iterations;

    expect(perCall).toBeLessThan(5);
  });

  it('symmetry: if A can see B, the relationship is consistent', () => {
    // In a symmetric shadowcasting algorithm, if A sees B then B should
    // generally see A (in an open map). Test this property.
    const map = createOpenMap(20, 20);
    const radius = 8;

    const fromA = computeLOS(map, 5, 5, radius);
    const fromB = computeLOS(map, 8, 7, radius);

    // A sees B
    const aSeesB = fromA.visibleSet.has(tileKey(8, 7));
    // B sees A
    const bSeesA = fromB.visibleSet.has(tileKey(5, 5));

    expect(aSeesB).toBe(bSeesA);
  });
});

describe('diffVisibility', () => {
  it('all entering when previous is empty', () => {
    const previous = new Set<number>();
    const current = new Set([tileKey(1, 1), tileKey(2, 2)]);
    const currentTiles: [number, number][] = [[1, 1], [2, 2]];

    const diff = diffVisibility(previous, current, currentTiles);

    expect(diff.entering).toEqual([[1, 1], [2, 2]]);
    expect(diff.exiting).toEqual([]);
    expect(diff.stable).toEqual([]);
  });

  it('all exiting when current is empty', () => {
    const previous = new Set([tileKey(1, 1), tileKey(2, 2)]);
    const current = new Set<number>();
    const currentTiles: [number, number][] = [];

    const diff = diffVisibility(previous, current, currentTiles);

    expect(diff.entering).toEqual([]);
    expect(diff.stable).toEqual([]);
    expect(diff.exiting).toHaveLength(2);
    // Order of exiting tiles may vary, check membership
    const exitKeys = diff.exiting.map(([x, y]) => tileKey(x, y));
    expect(exitKeys).toContain(tileKey(1, 1));
    expect(exitKeys).toContain(tileKey(2, 2));
  });

  it('all stable when sets are identical', () => {
    const tiles: [number, number][] = [[1, 1], [2, 2], [3, 3]];
    const keys = new Set(tiles.map(([x, y]) => tileKey(x, y)));

    const diff = diffVisibility(keys, keys, tiles);

    expect(diff.stable).toEqual(tiles);
    expect(diff.entering).toEqual([]);
    expect(diff.exiting).toEqual([]);
  });

  it('correctly splits entering, exiting, and stable', () => {
    const previous = new Set([tileKey(1, 1), tileKey(2, 2), tileKey(3, 3)]);
    const current = new Set([tileKey(2, 2), tileKey(3, 3), tileKey(4, 4)]);
    const currentTiles: [number, number][] = [[2, 2], [3, 3], [4, 4]];

    const diff = diffVisibility(previous, current, currentTiles);

    expect(diff.stable).toEqual([[2, 2], [3, 3]]);
    expect(diff.entering).toEqual([[4, 4]]);
    expect(diff.exiting).toEqual([[1, 1]]);
  });

  it('handles large diff correctly', () => {
    const previous = new Set<number>();
    const current = new Set<number>();
    const currentTiles: [number, number][] = [];

    // 100 tiles in previous, 100 different tiles in current
    for (let i = 0; i < 100; i++) {
      previous.add(tileKey(i, 0));
      current.add(tileKey(i, 1));
      currentTiles.push([i, 1]);
    }

    const diff = diffVisibility(previous, current, currentTiles);

    expect(diff.entering).toHaveLength(100);
    expect(diff.exiting).toHaveLength(100);
    expect(diff.stable).toHaveLength(0);
  });
});
