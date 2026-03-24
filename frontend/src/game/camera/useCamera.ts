/**
 * useCamera — Smooth camera-follow hook.
 *
 * Computes pixel offsets to center the player in the viewport. Uses a lerp
 * (linear interpolation) on each animation frame so the camera smoothly
 * tracks the player rather than snapping instantly.
 *
 * @param playerX          Player tile X coordinate
 * @param playerY          Player tile Y coordinate
 * @param viewportWidth    Viewport width in pixels
 * @param viewportHeight   Viewport height in pixels
 * @returns                { cameraX, cameraY } pixel offsets to apply to the world container
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';

/** How quickly the camera catches up (0 = frozen, 1 = instant). */
const LERP_SPEED = 0.12;

/** Minimum movement threshold to avoid sub-pixel jitter. */
const SNAP_THRESHOLD = 0.5;

export interface CameraOffset {
  cameraX: number;
  cameraY: number;
}

/**
 * Compute the ideal camera offset that centers the given tile in the viewport.
 */
function targetOffset(
  tileX: number,
  tileY: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  const playerPx = tileX * TILE_SIZE + TILE_SIZE / 2;
  const playerPy = tileY * TILE_SIZE + TILE_SIZE / 2;
  return {
    x: viewportW / 2 - playerPx,
    y: viewportH / 2 - playerPy,
  };
}

export function useCamera(
  playerX: number,
  playerY: number,
  viewportWidth: number,
  viewportHeight: number,
): CameraOffset {
  // Compute the target we want to lerp toward
  const target = targetOffset(playerX, playerY, viewportWidth, viewportHeight);

  // Current camera position (initialized to target so first frame is centered)
  const [camera, setCamera] = useState<CameraOffset>({
    cameraX: target.x,
    cameraY: target.y,
  });

  // Use refs for the animation loop to avoid stale closures
  const currentRef = useRef({ x: target.x, y: target.y });
  const targetRef = useRef({ x: target.x, y: target.y });
  const rafRef = useRef<number>(0);

  // Update target whenever player moves or viewport resizes
  useEffect(() => {
    targetRef.current = target;
  }, [target.x, target.y]);

  const animate = useCallback(() => {
    const cur = currentRef.current;
    const tgt = targetRef.current;

    const dx = tgt.x - cur.x;
    const dy = tgt.y - cur.y;

    // If close enough, snap to target and stop jittering
    if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
      if (cur.x !== tgt.x || cur.y !== tgt.y) {
        cur.x = tgt.x;
        cur.y = tgt.y;
        setCamera({ cameraX: Math.round(cur.x), cameraY: Math.round(cur.y) });
      }
    } else {
      cur.x += dx * LERP_SPEED;
      cur.y += dy * LERP_SPEED;
      setCamera({ cameraX: Math.round(cur.x), cameraY: Math.round(cur.y) });
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [animate]);

  return camera;
}
