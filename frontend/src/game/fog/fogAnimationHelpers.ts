/**
 * Pure helper functions for fog-of-war columnar emergence animations.
 *
 * Supports three asymmetric transition types:
 * 1. unknown → visible: dramatic cap-rise from the abyss (large yOffset, long duration)
 * 2. explored → visible: gentle re-lift (small yOffset, short duration)
 * 3. visible → explored: gentle lowering (preserve object permanence, alpha stays 1)
 *
 * Extracted from FogOfWarRenderer to satisfy react-refresh/only-export-components:
 * component files should only export components.
 */

import { tileColorJitter } from './columnRenderer.ts';

// ── Animation constants (shared) ────────────────────────────────────

/** Per-tile height jitter amplitude in pixels (±). */
const HEIGHT_JITTER_AMP = 2;

// ── Unknown → Visible (dramatic cap-rise from abyss) ────────────────

/**
 * Starting yOffset for unknown → visible transition.
 * Cap starts far below authored height and rises dramatically.
 * Equals COLUMN_MAX_HEIGHT so the cap starts at the bottom of the shaft.
 */
export const RISE_OFFSET_NEW = 56;

/** Base duration for unknown → visible reveal in seconds. */
const NEW_REVEAL_BASE_DURATION = 0.5;
/** Duration variance for unknown → visible (±). */
const NEW_REVEAL_VARIANCE = 0.06;

// ── Explored → Visible (gentle re-lift) ─────────────────────────────

/**
 * Starting yOffset for explored → visible transition.
 * Small re-lift — the tile was already visible as a remembered column.
 */
export const RISE_OFFSET_REVISIT = 10;

/** Base duration for explored → visible re-lift in seconds. */
const REVISIT_REVEAL_BASE_DURATION = 0.25;
/** Duration variance for explored → visible (±). */
const REVISIT_REVEAL_VARIANCE = 0.03;

// ── Visible → Explored (gentle lowering) ────────────────────────────

/**
 * Ending yOffset for visible → explored transition.
 * Small displacement downward to visually "settle" the tile into remembered state.
 */
export const SINK_OFFSET = 6;

/** Base duration for visible → explored conceal in seconds. */
const CONCEAL_BASE_DURATION = 0.35;
/** Duration variance for visible → explored (±). */
const CONCEAL_VARIANCE = 0.04;

/**
 * Static yOffset applied to remembered (explored-not-visible) tiles in batched rendering.
 * Slightly lowered cap signals "seen before but not currently visible".
 */
export const REMEMBERED_YOFFSET = 4;

// ── Stagger delay ───────────────────────────────────────────────────

/** Maximum random stagger delay in seconds. */
export const MAX_STAGGER = 0.15;

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

// ── Per-transition duration helpers ─────────────────────────────────

/** Compute a slightly randomized duration for unknown → visible reveal. */
export function computeNewRevealDuration(): number {
  return NEW_REVEAL_BASE_DURATION + (Math.random() - 0.5) * 2 * NEW_REVEAL_VARIANCE;
}

/** Compute a slightly randomized duration for explored → visible re-lift. */
export function computeRevisitRevealDuration(): number {
  return REVISIT_REVEAL_BASE_DURATION + (Math.random() - 0.5) * 2 * REVISIT_REVEAL_VARIANCE;
}

/** Compute a slightly randomized duration for visible → explored conceal. */
export function computeConcealDuration(): number {
  return CONCEAL_BASE_DURATION + (Math.random() - 0.5) * 2 * CONCEAL_VARIANCE;
}

/**
 * Compute a slightly randomized animation duration.
 * Generic version — uses the unknown→visible parameters for backward compat.
 */
export function computeDuration(): number {
  return computeNewRevealDuration();
}

// ── Height jitter ───────────────────────────────────────────────────

/**
 * Compute a deterministic per-tile height jitter.
 * Uses the same hash as tileColorJitter for consistency,
 * but with a different amplitude to produce height variation.
 */
export function computeHeightJitter(x: number, y: number): number {
  return tileColorJitter(x, y, HEIGHT_JITTER_AMP);
}
