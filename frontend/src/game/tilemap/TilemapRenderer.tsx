/**
 * TilemapRenderer — PixiJS-based tilemap rendering component.
 *
 * Renders a GameMap as colored rectangles using minimal draw calls:
 * one Graphics object for all floor tiles, one for all wall tiles.
 * This keeps GPU batch count low even for large (50×50+) grids.
 *
 * Uses @pixi/react v8 extend() pattern with <pixiGraphics draw={cb}>.
 */

import { useCallback } from 'react';
import { Graphics } from 'pixi.js';
import type { GameMap } from './types.ts';
import { TileType } from './types.ts';

/** Tile size in pixels. */
export const TILE_SIZE = 32;

/**
 * Simple hash to produce a deterministic per-tile color variation.
 * Returns a small signed offset in [-amplitude, +amplitude].
 */
function tileColorJitter(x: number, y: number, amplitude: number): number {
  // Simple integer hash
  let h = (x * 374_761 + y * 668_265) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  // Map to [-amplitude, amplitude]
  return ((h & 0xff) / 255 - 0.5) * 2 * amplitude;
}

/** Clamp a value to [0, 255]. */
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Add jitter to an RGB color packed as 0xRRGGBB. */
function jitterColor(base: number, x: number, y: number, amp: number): number {
  const j = tileColorJitter(x, y, amp);
  const r = clamp255(((base >> 16) & 0xff) + j);
  const g = clamp255(((base >> 8) & 0xff) + j);
  const b = clamp255((base & 0xff) + j);
  return (r << 16) | (g << 8) | b;
}

// ── Color palette ──────────────────────────────────────────────────
const FLOOR_BASE = 0x3a3a4a;
const FLOOR_JITTER = 8;

const WALL_BASE = 0x5a4a3a;
const WALL_JITTER = 6;
const WALL_TOP_HIGHLIGHT = 0x6a5a4a;

/** Props for TilemapRenderer. */
export interface TilemapRendererProps {
  /** The map to render. */
  map: GameMap;
  /** Optional pixel offset for camera positioning. */
  offsetX?: number;
  /** Optional pixel offset for camera positioning. */
  offsetY?: number;
}

/**
 * Draw all floor tiles into a single Graphics object.
 * Each tile gets slight color jitter for visual texture.
 */
function drawFloors(g: Graphics, map: GameMap): void {
  g.clear();
  const { width, height, tiles } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y * width + x];
      if (tile !== TileType.Floor) continue;

      const color = jitterColor(FLOOR_BASE, x, y, FLOOR_JITTER);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      g.setFillStyle({ color });
      g.rect(px, py, TILE_SIZE, TILE_SIZE);
      g.fill();
    }
  }
}

/**
 * Draw all wall tiles into a single Graphics object.
 * Walls get a subtle top-edge highlight to suggest depth.
 */
function drawWalls(g: Graphics, map: GameMap): void {
  g.clear();
  const { width, height, tiles } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y * width + x];
      if (tile !== TileType.Wall) continue;

      const color = jitterColor(WALL_BASE, x, y, WALL_JITTER);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // Main wall body
      g.setFillStyle({ color });
      g.rect(px, py, TILE_SIZE, TILE_SIZE);
      g.fill();

      // Top highlight strip (2px) for depth cue
      const highlightColor = jitterColor(WALL_TOP_HIGHLIGHT, x, y, WALL_JITTER);
      g.setFillStyle({ color: highlightColor });
      g.rect(px, py, TILE_SIZE, 2);
      g.fill();
    }
  }
}

/**
 * Renders a GameMap as a PixiJS scene using two batched Graphics objects
 * (one for floors, one for walls) for minimal draw-call overhead.
 */
export function TilemapRenderer({
  map,
  offsetX = 0,
  offsetY = 0,
}: TilemapRendererProps): React.JSX.Element {
  // Memoize draw callbacks so they only rebuild when the map reference changes
  const onDrawFloors = useCallback(
    (g: Graphics) => drawFloors(g, map),
    [map],
  );

  const onDrawWalls = useCallback(
    (g: Graphics) => drawWalls(g, map),
    [map],
  );

  return (
    <pixiContainer x={offsetX} y={offsetY}>
      {/* Floor layer drawn first (below walls) */}
      <pixiGraphics draw={onDrawFloors} />
      {/* Wall layer on top */}
      <pixiGraphics draw={onDrawWalls} />
    </pixiContainer>
  );
}
