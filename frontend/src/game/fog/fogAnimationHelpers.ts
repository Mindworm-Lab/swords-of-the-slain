/**
 * Pure helper functions for fog-of-war columnar emergence animations.
 *
 * Extracted from FogOfWarRenderer to satisfy react-refresh/only-export-components:
 * component files should only export components.
 */

import { tileColorJitter } from './columnRenderer.ts';

// ── Animation constants ─────────────────────────────────────────────

/** Base duration for reveal/conceal animations in seconds. */
const BASE_DURATION = 0.4;
/** Maximum random duration variance in seconds (±). */
const DURATION_VARIANCE = 0.05;
/** Per-tile height jitter amplitude in pixels (±). */
const HEIGHT_JITTER_AMP = 2;

// ── Animation helpers ───────────────────────────────────────────────

/**
 * Compute stagger delay for a tile based on distance from player.
 * Tiles closer to the player animate sooner, creating a ripple outward.
 */
export function computeStaggerDelay(
  tileX: number,
  tileY: number,
  playerX: number,
  playerY: number,
  maxDelay: number,
): number {
  const dx = tileX - playerX;
  const dy = tileY - playerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Normalize distance (vision radius ~10 tiles)
  const normalizedDist = Math.min(dist / 12, 1);
  // Closer tiles get shorter delay + random jitter
  const baseDelay = normalizedDist * maxDelay * 0.7;
  const jitter = Math.random() * maxDelay * 0.3;
  return baseDelay + jitter;
}

/** Compute a slightly randomized animation duration. */
export function computeDuration(): number {
  return BASE_DURATION + (Math.random() - 0.5) * 2 * DURATION_VARIANCE;
}

/**
 * Compute a deterministic per-tile height jitter.
 * Uses the same hash as tileColorJitter for consistency,
 * but with a different amplitude to produce height variation.
 */
export function computeHeightJitter(x: number, y: number): number {
  return tileColorJitter(x, y, HEIGHT_JITTER_AMP);
}
