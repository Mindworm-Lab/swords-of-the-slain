/**
 * PlayerRenderer — Renders the player character as a bright glyph on the tilemap.
 *
 * Draws a gold-colored circle centered on the given tile position.
 * Uses @pixi/react v8 `<pixiGraphics draw={cb}>` pattern.
 */

import { useCallback } from 'react';
import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';

/** Props for PlayerRenderer. */
export interface PlayerRendererProps {
  /** Player tile X coordinate. */
  tileX: number;
  /** Player tile Y coordinate. */
  tileY: number;
}

/** Player color: bright gold for high visibility against dark dungeon tiles. */
const PLAYER_COLOR = 0xf0c040;
/** Outline color: darker amber for definition. */
const PLAYER_OUTLINE = 0xb08020;
/** Player radius relative to tile size. */
const PLAYER_RADIUS = TILE_SIZE * 0.35;

/**
 * Renders the player as a filled circle with an outline, centered in the tile.
 *
 * Position is computed as: tileX * TILE_SIZE + TILE_SIZE/2 (pixel center of tile).
 * The Graphics draw callback receives absolute pixel coords so the component
 * can be placed inside the same world container as the tilemap.
 */
export function PlayerRenderer({ tileX, tileY }: PlayerRendererProps): React.JSX.Element {
  const px = tileX * TILE_SIZE + TILE_SIZE / 2;
  const py = tileY * TILE_SIZE + TILE_SIZE / 2;

  const draw = useCallback(
    (g: Graphics) => {
      g.clear();

      // Outline circle (slightly larger)
      g.setFillStyle({ color: PLAYER_OUTLINE });
      g.circle(px, py, PLAYER_RADIUS + 1.5);
      g.fill();

      // Main player circle
      g.setFillStyle({ color: PLAYER_COLOR });
      g.circle(px, py, PLAYER_RADIUS);
      g.fill();

      // Inner highlight dot for depth cue
      g.setFillStyle({ color: 0xfff0a0 });
      g.circle(px - 2, py - 2, PLAYER_RADIUS * 0.3);
      g.fill();
    },
    [px, py],
  );

  return <pixiGraphics draw={draw} />;
}
