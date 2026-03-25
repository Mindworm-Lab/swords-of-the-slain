/**
 * Minimap — Small HTML canvas overview of the dungeon.
 *
 * Renders a top-down view of the full map at ~2px per tile:
 * - Unexplored tiles: transparent (void)
 * - Explored walls: dim dark blue-gray
 * - Explored floors: dim gray
 * - Visible walls: brighter blue-gray
 * - Visible floors: brighter gray
 * - Player position: bright gold dot
 *
 * Uses a raw <canvas> element with 2D context — NOT PixiJS.
 * Redraws only when dependencies change (explored, visible, player pos).
 */

import { useRef, useEffect } from 'react';
import type { GameMap } from '../game/tilemap/types.ts';
import { TileType } from '../game/tilemap/types.ts';

export interface MinimapProps {
  /** The game map data. */
  map: GameMap;
  /** Set of explored tile keys ("x,y" format). */
  exploredSet: Set<string>;
  /** Set of currently visible tile keys ("x,y" format). */
  visibleSet: Set<string>;
  /** Player tile X position. */
  playerX: number;
  /** Player tile Y position. */
  playerY: number;
}

/** Display size of the minimap in CSS pixels. */
const MINIMAP_SIZE = 160;

/** Colors for minimap rendering. */
const COLORS = {
  background: '#0a0a14',
  exploredFloor: '#33334a',
  exploredWall: '#22223a',
  visibleFloor: '#6666aa',
  visibleWall: '#444470',
  player: '#f0c040',
} as const;

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

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, mapW, mapH);

    // Draw tiles
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const key = `${x},${y}`;
        const isVisible = visibleSet.has(key);
        const isExplored = exploredSet.has(key);

        if (!isVisible && !isExplored) continue;

        const tileIndex = y * mapW + x;
        const tile = tiles[tileIndex];
        const isWall = tile === TileType.Wall;

        if (isVisible) {
          ctx.fillStyle = isWall ? COLORS.visibleWall : COLORS.visibleFloor;
        } else {
          ctx.fillStyle = isWall ? COLORS.exploredWall : COLORS.exploredFloor;
        }

        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Draw player as a bright dot (slightly larger for visibility)
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(playerX, playerY, 1, 1);
    // Add a subtle glow around the player dot
    ctx.fillStyle = 'rgba(240, 192, 64, 0.4)';
    ctx.fillRect(playerX - 1, playerY - 1, 3, 3);
    // Re-draw center on top of glow
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(playerX, playerY, 1, 1);
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
