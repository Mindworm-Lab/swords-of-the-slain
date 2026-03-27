/**
 * Minimap — Small HTML canvas overview of the dungeon.
 *
 * Renders a top-down view of the full map at 1px per tile:
 * - Unexplored tiles: dark background (void)
 * - Explored walls: dim dark blue-gray
 * - Explored floors: dim gray
 * - Visible walls: brighter blue-gray
 * - Visible floors: brighter gray
 * - Player position: bright gold dot with glow
 *
 * Uses a raw <canvas> element with 2D context — NOT PixiJS.
 * Draws all pixels via a single ImageData buffer write (putImageData)
 * instead of per-tile fillRect calls, eliminating thousands of
 * fillStyle string assignments and individual draw calls.
 *
 * Redraws only when dependencies change (explored, visible, player pos).
 */

import { useRef, useEffect } from 'react';
import type { GameMap } from '../game/tilemap/types.ts';
import { TileType } from '../game/tilemap/types.ts';
import { tileKey } from '../game/fog/los.ts';

export interface MinimapProps {
  /** The game map data. */
  map: GameMap;
  /** Set of explored tile keys (numeric encoding). */
  exploredSet: Set<number>;
  /** Set of currently visible tile keys (numeric encoding). */
  visibleSet: Set<number>;
  /** Player tile X position. */
  playerX: number;
  /** Player tile Y position. */
  playerY: number;
}

/** Display size of the minimap in CSS pixels. */
const MINIMAP_SIZE = 160;

/* ── Pre-parsed RGB tuples (avoids per-pixel string parsing) ────────── */
const BG_RGB: readonly [number, number, number] = [10, 10, 20]; // '#0a0a14'
const EXPLORED_FLOOR_RGB: readonly [number, number, number] = [51, 51, 74]; // '#33334a'
const EXPLORED_WALL_RGB: readonly [number, number, number] = [34, 34, 58]; // '#22223a'
const VISIBLE_FLOOR_RGB: readonly [number, number, number] = [102, 102, 170]; // '#6666aa'
const VISIBLE_WALL_RGB: readonly [number, number, number] = [68, 68, 112]; // '#444470'
const PLAYER_RGB: readonly [number, number, number] = [240, 192, 64]; // '#f0c040'
/** Player glow: same hue, 40 % opacity — pre-stored for manual alpha blend. */
const PLAYER_GLOW_RGB: readonly [number, number, number] = [240, 192, 64];
const PLAYER_GLOW_ALPHA = 0.4;

export const Minimap: React.FC<MinimapProps> = ({
  map,
  exploredSet,
  visibleSet,
  playerX,
  playerY,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: mapW, height: mapH, tiles } = map;

    // Use the map dimensions as the canvas pixel dimensions for 1:1 tile mapping.
    // The CSS constrains the visual size to MINIMAP_SIZE.
    canvas.width = mapW;
    canvas.height = mapH;

    /* ── Build ImageData buffer ──────────────────────────────────── */
    const imageData = ctx.createImageData(mapW, mapH);
    const data = imageData.data; // Uint8ClampedArray, 4 bytes per pixel (RGBA)

    // 1. Fill entire buffer with background colour.
    for (let i = 0, len = mapW * mapH * 4; i < len; i += 4) {
      data[i] = BG_RGB[0];
      data[i + 1] = BG_RGB[1];
      data[i + 2] = BG_RGB[2];
      data[i + 3] = 255;
    }

    // 2. Draw explored & visible tiles.
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const key = tileKey(x, y);
        const isVisible = visibleSet.has(key);
        const isExplored = exploredSet.has(key);
        if (!isVisible && !isExplored) continue;

        const tileIndex = y * mapW + x;
        const tile = tiles[tileIndex];
        const isWall = tile === TileType.Wall;

        let rgb: readonly [number, number, number];
        if (isVisible) {
          rgb = isWall ? VISIBLE_WALL_RGB : VISIBLE_FLOOR_RGB;
        } else {
          rgb = isWall ? EXPLORED_WALL_RGB : EXPLORED_FLOOR_RGB;
        }

        const idx = tileIndex * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = 255;
      }
    }

    // 3. Player glow — 3×3 area, alpha-blended over existing pixels.
    const glowInv = 1 - PLAYER_GLOW_ALPHA;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = playerX + dx;
        const gy = playerY + dy;
        if (gx < 0 || gy < 0 || gx >= mapW || gy >= mapH) continue;
        const idx = (gy * mapW + gx) * 4;
        data[idx] = Math.round(data[idx]! * glowInv + PLAYER_GLOW_RGB[0] * PLAYER_GLOW_ALPHA);
        data[idx + 1] = Math.round(data[idx + 1]! * glowInv + PLAYER_GLOW_RGB[1] * PLAYER_GLOW_ALPHA);
        data[idx + 2] = Math.round(data[idx + 2]! * glowInv + PLAYER_GLOW_RGB[2] * PLAYER_GLOW_ALPHA);
      }
    }

    // 4. Player centre — solid gold, overwrites glow centre pixel.
    if (playerX >= 0 && playerY >= 0 && playerX < mapW && playerY < mapH) {
      const pidx = (playerY * mapW + playerX) * 4;
      data[pidx] = PLAYER_RGB[0];
      data[pidx + 1] = PLAYER_RGB[1];
      data[pidx + 2] = PLAYER_RGB[2];
      data[pidx + 3] = 255;
    }

    // 5. Single putImageData call writes all pixels at once.
    ctx.putImageData(imageData, 0, 0);
  }, [map, exploredSet, visibleSet, playerX, playerY]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="minimap-canvas"
      style={{
        width: MINIMAP_SIZE,
        height: MINIMAP_SIZE,
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 4,
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
};
