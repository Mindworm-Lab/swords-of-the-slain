/**
 * Utilities for computing visibility diffs between frames/turns.
 *
 * Used to drive fog-of-war animations: tiles entering vision fade in,
 * tiles leaving vision fade out, stable tiles remain unchanged.
 *
 * Supports three-state visibility classification:
 * - enteringNew: tiles going unknown → visible (never seen before, dramatic reveal)
 * - enteringRevisit: tiles going explored → visible (seen before, gentle re-lift)
 * - exiting: tiles going visible → explored (preserve object permanence)
 */

import { tileKey } from './los.ts';

/** Diff between two visibility states. */
export interface VisibilityDiff {
  /**
   * All tiles that just became visible (union of enteringNew + enteringRevisit).
   * Kept for backward compatibility.
   */
  entering: [number, number][];
  /**
   * Tiles entering visibility for the FIRST time (unknown → visible).
   * These get dramatic cap-rise animation from the abyss.
   */
  enteringNew: [number, number][];
  /**
   * Tiles RE-ENTERING visibility (explored → visible).
   * These get a gentle re-lift animation, NOT a full birth-from-nothing.
   */
  enteringRevisit: [number, number][];
  /** Tiles that just left vision (were visible last turn, not anymore) */
  exiting: [number, number][];
  /** Tiles that remain visible */
  stable: [number, number][];
}

/**
 * Diff two visibility sets to find entering, exiting, and stable tiles.
 * Also classifies entering tiles as new (never explored) vs revisit (previously explored).
 *
 * @param previous - Set of tile keys that were visible last frame
 * @param current - Set of tile keys that are visible this frame
 * @param currentTiles - Array of [x, y] tuples for current visible tiles
 * @param exploredSet - Set of tile keys that have EVER been visible (optional, enables classification)
 * @returns VisibilityDiff with entering (+ new/revisit), exiting, and stable tile arrays
 */
export function diffVisibility(
  previous: Set<string>,
  current: Set<string>,
  currentTiles: [number, number][],
  exploredSet?: Set<string>,
): VisibilityDiff {
  const entering: [number, number][] = [];
  const enteringNew: [number, number][] = [];
  const enteringRevisit: [number, number][] = [];
  const stable: [number, number][] = [];
  const exiting: [number, number][] = [];

  // Classify current tiles as entering or stable
  for (const tile of currentTiles) {
    const key = tileKey(tile[0], tile[1]);
    if (previous.has(key)) {
      stable.push(tile);
    } else {
      entering.push(tile);
      // Classify entering tiles if exploredSet is provided
      if (exploredSet) {
        if (exploredSet.has(key)) {
          enteringRevisit.push(tile);
        } else {
          enteringNew.push(tile);
        }
      } else {
        // Without exploredSet, all entering tiles are treated as new
        enteringNew.push(tile);
      }
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

  return { entering, enteringNew, enteringRevisit, exiting, stable };
}
