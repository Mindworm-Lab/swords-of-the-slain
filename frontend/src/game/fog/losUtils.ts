/**
 * Utilities for computing visibility diffs between frames/turns.
 *
 * Used to drive fog-of-war animations: tiles entering vision fade in,
 * tiles leaving vision fade out, stable tiles remain unchanged.
 */

import { tileKey } from './los.ts';

/** Diff between two visibility states. */
export interface VisibilityDiff {
  /** Tiles that just became visible (were not visible last turn) */
  entering: [number, number][];
  /** Tiles that just left vision (were visible last turn, not anymore) */
  exiting: [number, number][];
  /** Tiles that remain visible */
  stable: [number, number][];
}

/**
 * Diff two visibility sets to find entering, exiting, and stable tiles.
 *
 * @param previous - Set of tile keys that were visible last frame
 * @param current - Set of tile keys that are visible this frame
 * @param currentTiles - Array of [x, y] tuples for current visible tiles
 * @returns VisibilityDiff with entering, exiting, and stable tile arrays
 */
export function diffVisibility(
  previous: Set<string>,
  current: Set<string>,
  currentTiles: [number, number][],
): VisibilityDiff {
  const entering: [number, number][] = [];
  const stable: [number, number][] = [];
  const exiting: [number, number][] = [];

  // Classify current tiles as entering or stable
  for (const tile of currentTiles) {
    const key = tileKey(tile[0], tile[1]);
    if (previous.has(key)) {
      stable.push(tile);
    } else {
      entering.push(tile);
    }
  }

  // Find exiting tiles (in previous but not in current)
  for (const key of previous) {
    if (!current.has(key)) {
      const parts = key.split(',');
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      exiting.push([x, y]);
    }
  }

  return { entering, exiting, stable };
}
