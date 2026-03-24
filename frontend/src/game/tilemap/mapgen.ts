/**
 * Test map generator.
 *
 * Produces a dungeon-style map with outer walls, several rectangular rooms,
 * and corridors connecting them. Deterministic for a given seed (uses a
 * simple linear-congruential PRNG so the map is reproducible).
 */

import { GameMap, TileType } from './types.ts';

/** Simple seedable PRNG (LCG). Returns values in [0, 1). */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) | 0;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Carve a rectangle of floor tiles into the map data. */
function carveRect(tiles: TileType[], width: number, rect: Rect): void {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const idx = (rect.y + dy) * width + (rect.x + dx);
      if (tiles[idx] !== undefined) {
        tiles[idx] = TileType.Floor;
      }
    }
  }
}

/** Carve a 1-tile-wide horizontal corridor between two x positions at row y. */
function carveHCorridor(
  tiles: TileType[],
  width: number,
  x1: number,
  x2: number,
  y: number,
): void {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  for (let x = minX; x <= maxX; x++) {
    const idx = y * width + x;
    if (tiles[idx] !== undefined) {
      tiles[idx] = TileType.Floor;
    }
  }
}

/** Carve a 1-tile-wide vertical corridor between two y positions at column x. */
function carveVCorridor(
  tiles: TileType[],
  width: number,
  x: number,
  y1: number,
  y2: number,
): void {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (let y = minY; y <= maxY; y++) {
    const idx = y * width + x;
    if (tiles[idx] !== undefined) {
      tiles[idx] = TileType.Floor;
    }
  }
}

/** Center of a rectangle (floored to integer). */
function center(r: Rect): { cx: number; cy: number } {
  return {
    cx: Math.floor(r.x + r.w / 2),
    cy: Math.floor(r.y + r.h / 2),
  };
}

/**
 * Generate a test dungeon map.
 *
 * @param width  Map width in tiles (minimum 20, recommended ≥ 50)
 * @param height Map height in tiles (minimum 20, recommended ≥ 50)
 * @param seed   PRNG seed for reproducibility (default 42)
 * @returns A GameMap filled with rooms and corridors
 */
export function generateTestMap(
  width: number,
  height: number,
  seed = 42,
): GameMap {
  const rng = createRng(seed);

  // Start with all walls
  const tiles: TileType[] = new Array<TileType>(width * height).fill(
    TileType.Wall,
  );

  // Generate non-overlapping rooms
  const rooms: Rect[] = [];
  const attempts = 80; // how many placement attempts
  const minRoom = 4;
  const maxRoom = 10;

  for (let i = 0; i < attempts; i++) {
    const w = Math.floor(rng() * (maxRoom - minRoom + 1)) + minRoom;
    const h = Math.floor(rng() * (maxRoom - minRoom + 1)) + minRoom;
    const x = Math.floor(rng() * (width - w - 2)) + 1;
    const y = Math.floor(rng() * (height - h - 2)) + 1;
    const candidate: Rect = { x, y, w, h };

    // Check overlap (with 1-tile padding)
    const overlaps = rooms.some(
      (r) =>
        candidate.x - 1 < r.x + r.w &&
        candidate.x + candidate.w + 1 > r.x &&
        candidate.y - 1 < r.y + r.h &&
        candidate.y + candidate.h + 1 > r.y,
    );
    if (!overlaps) {
      rooms.push(candidate);
    }
  }

  // Carve rooms
  for (const room of rooms) {
    carveRect(tiles, width, room);
  }

  // Connect consecutive rooms with L-shaped corridors
  for (let i = 1; i < rooms.length; i++) {
    const prev = rooms[i - 1];
    const curr = rooms[i];
    if (prev === undefined || curr === undefined) continue;

    const a = center(prev);
    const b = center(curr);

    // Randomly choose horizontal-first or vertical-first
    if (rng() < 0.5) {
      carveHCorridor(tiles, width, a.cx, b.cx, a.cy);
      carveVCorridor(tiles, width, b.cx, a.cy, b.cy);
    } else {
      carveVCorridor(tiles, width, a.cx, a.cy, b.cy);
      carveHCorridor(tiles, width, a.cx, b.cx, b.cy);
    }
  }

  return { width, height, tiles };
}
