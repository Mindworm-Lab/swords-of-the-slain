/**
 * usePlayerMovement — Turn-based keyboard movement hook.
 *
 * Listens for WASD and arrow key presses. On each keypress, computes the
 * target tile and moves the player there only if the target is walkable
 * (not a wall, not out of bounds). One tile per keypress — not continuous.
 *
 * @param map    The current GameMap (used for collision checks)
 * @param startX Initial player X tile coordinate
 * @param startY Initial player Y tile coordinate
 * @returns      Current player tile position { playerX, playerY }
 */

import { useState, useEffect, useCallback } from 'react';
import type { GameMap } from '../tilemap/types.ts';
import { isWall } from '../tilemap/types.ts';

/** Direction deltas for each supported key. */
const KEY_DELTAS: Record<string, { dx: number; dy: number }> = {
  // WASD
  w: { dx: 0, dy: -1 },
  a: { dx: -1, dy: 0 },
  s: { dx: 0, dy: 1 },
  d: { dx: 1, dy: 0 },
  // Arrow keys
  ArrowUp: { dx: 0, dy: -1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowRight: { dx: 1, dy: 0 },
};

export interface PlayerPosition {
  playerX: number;
  playerY: number;
}

export function usePlayerMovement(
  map: GameMap,
  startX: number,
  startY: number,
): PlayerPosition {
  const [pos, setPos] = useState({ playerX: startX, playerY: startY });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const delta = KEY_DELTAS[e.key];
      if (!delta) return;

      // Prevent page scroll on arrow keys
      e.preventDefault();

      setPos((prev) => {
        const targetX = prev.playerX + delta.dx;
        const targetY = prev.playerY + delta.dy;

        // Only move if target tile is walkable
        if (isWall(map, targetX, targetY)) {
          return prev;
        }

        return { playerX: targetX, playerY: targetY };
      });
    },
    [map],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return pos;
}
