/**
 * Tests for the BSP dungeon generator.
 *
 * Validates map dimensions, tile correctness, room count, connectivity,
 * determinism, and border integrity.
 */

import { describe, it, expect } from 'vitest';
import { generateDungeon } from '../generator.ts';
import { TileType, getTile } from '../../tilemap/types.ts';

describe('generateDungeon', () => {
  it('generated map has correct dimensions', () => {
    const result = generateDungeon(80, 80, 12345);
    expect(result.map.width).toBe(80);
    expect(result.map.height).toBe(80);
    expect(result.map.tiles.length).toBe(80 * 80);
  });

  it('start position is a floor tile', () => {
    const result = generateDungeon(80, 80, 99);
    const tile = getTile(result.map, result.startX, result.startY);
    expect(tile).toBe(TileType.Floor);
  });

  it('all room centers are floor tiles', () => {
    const result = generateDungeon(80, 80, 42);
    expect(result.roomCenters.length).toBeGreaterThan(0);
    for (const [cx, cy] of result.roomCenters) {
      const tile = getTile(result.map, cx, cy);
      expect(tile).toBe(TileType.Floor);
    }
  });

  it('map has floor tiles (not all walls)', () => {
    const result = generateDungeon(80, 80, 7);
    const floorCount = result.map.tiles.filter((t) => t === TileType.Floor).length;
    expect(floorCount).toBeGreaterThan(0);
  });

  it('generates at least 8 rooms for an 80x80 map', () => {
    const result = generateDungeon(80, 80, 555);
    expect(result.roomCenters.length).toBeGreaterThanOrEqual(8);
  });

  it('outer border is all walls', () => {
    const result = generateDungeon(80, 80, 101);
    const { width, height, tiles } = result.map;

    // Top and bottom rows
    for (let x = 0; x < width; x++) {
      expect(tiles[x]).toBe(TileType.Wall); // top
      expect(tiles[(height - 1) * width + x]).toBe(TileType.Wall); // bottom
    }

    // Left and right columns
    for (let y = 0; y < height; y++) {
      expect(tiles[y * width]).toBe(TileType.Wall); // left
      expect(tiles[y * width + (width - 1)]).toBe(TileType.Wall); // right
    }
  });

  it('seeded generation is deterministic (same seed → same map)', () => {
    const a = generateDungeon(80, 80, 42);
    const b = generateDungeon(80, 80, 42);

    expect(a.map.tiles).toEqual(b.map.tiles);
    expect(a.startX).toBe(b.startX);
    expect(a.startY).toBe(b.startY);
    expect(a.roomCenters).toEqual(b.roomCenters);
  });

  it('different seeds produce different maps', () => {
    const a = generateDungeon(80, 80, 1);
    const b = generateDungeon(80, 80, 2);

    // Maps should differ in at least some tiles
    let diffs = 0;
    for (let i = 0; i < a.map.tiles.length; i++) {
      if (a.map.tiles[i] !== b.map.tiles[i]) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });

  it('connectivity: BFS from start can reach all room centers', () => {
    const result = generateDungeon(80, 80, 77);
    const { width, height, tiles } = result.map;

    // BFS from start position
    const visited = new Uint8Array(width * height);
    const queue: [number, number][] = [[result.startX, result.startY]];
    visited[result.startY * width + result.startX] = 1;

    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      for (const [dx, dy] of directions) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const idx = ny * width + nx;
        if (visited[idx] === 1) continue;
        if (tiles[idx] !== TileType.Floor) continue;
        visited[idx] = 1;
        queue.push([nx, ny]);
      }
    }

    // Every room center should be reachable
    for (const [rx, ry] of result.roomCenters) {
      expect(
        visited[ry * width + rx],
        `Room center (${rx}, ${ry}) should be reachable from start`,
      ).toBe(1);
    }
  });

  it('throws for width < 40', () => {
    expect(() => generateDungeon(20, 80)).toThrow('Width must be >= 40');
  });

  it('throws for height < 40', () => {
    expect(() => generateDungeon(80, 20)).toThrow('Height must be >= 40');
  });

  it('works with large maps (100x100)', () => {
    const result = generateDungeon(100, 100, 333);
    expect(result.map.width).toBe(100);
    expect(result.map.height).toBe(100);
    expect(result.roomCenters.length).toBeGreaterThanOrEqual(8);
  });

  it('unseeded generation produces different maps', () => {
    const a = generateDungeon(80, 80);
    const b = generateDungeon(80, 80);

    // With overwhelming probability, two random maps differ
    let diffs = 0;
    for (let i = 0; i < a.map.tiles.length; i++) {
      if (a.map.tiles[i] !== b.map.tiles[i]) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });
});
