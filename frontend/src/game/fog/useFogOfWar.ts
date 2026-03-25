/**
 * useFogOfWar — Manages fog-of-war visibility state across turns.
 *
 * On each player move, recomputes LOS, diffs against the previous visible set,
 * and maintains the explored set (union of all ever-visible tiles).
 *
 * Returns FogState which drives the FogOfWarRenderer:
 * - visibleSet: currently visible tile keys
 * - exploredSet: all ever-seen tile keys (grows monotonically)
 * - entering: tiles just becoming visible (animate in)
 * - exiting: tiles just leaving vision (animate out)
 * - stable: tiles remaining visible (no animation needed)
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { GameMap } from '../tilemap/types.ts';
import { computeLOS } from './los.ts';
import { diffVisibility } from './losUtils.ts';

/** Vision radius in tiles. */
export const VISION_RADIUS = 10;

/** Complete fog-of-war state for a single frame/turn. */
export interface FogState {
  /** Set of currently visible tile keys ("x,y" format). */
  visibleSet: Set<string>;
  /** Set of all ever-explored tile keys (grows monotonically). */
  exploredSet: Set<string>;
  /** Tiles just becoming visible this turn — animate reveal. */
  entering: [number, number][];
  /** Tiles just leaving vision this turn — animate conceal. */
  exiting: [number, number][];
  /** Tiles that remain visible — no animation needed. */
  stable: [number, number][];
  /** Player position when this state was computed. */
  playerX: number;
  /** Player position when this state was computed. */
  playerY: number;
}

/**
 * Compute the initial fog state for a given position (no entering/exiting on first frame).
 * All initially visible tiles are classified as "entering" for the first reveal animation.
 */
function computeInitialFogState(
  map: GameMap,
  playerX: number,
  playerY: number,
): FogState {
  const los = computeLOS(map, playerX, playerY, VISION_RADIUS);
  const exploredSet = new Set(los.visibleSet);

  return {
    visibleSet: los.visibleSet,
    exploredSet,
    entering: los.visibleTiles, // All tiles "enter" on first computation
    exiting: [],
    stable: [],
    playerX,
    playerY,
  };
}

/**
 * Hook that manages fog-of-war state, recomputing LOS and diffing visibility
 * on each player move.
 *
 * @param map - The current game map
 * @param playerX - Current player tile X
 * @param playerY - Current player tile Y
 * @returns Current FogState for the renderer
 */
export function useFogOfWar(
  map: GameMap,
  playerX: number,
  playerY: number,
): FogState {
  // Store the explored set in a ref so it persists across renders without
  // causing re-render cycles (we copy it into state when it changes).
  const exploredRef = useRef<Set<string>>(new Set());

  // Memoize the initial state computation
  const initialState = useMemo(
    () => {
      const state = computeInitialFogState(map, playerX, playerY);
      exploredRef.current = new Set(state.exploredSet);
      return state;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // Only compute on mount
  );

  const [fogState, setFogState] = useState<FogState>(initialState);
  const prevVisibleRef = useRef<Set<string>>(initialState.visibleSet);

  // Track whether this is the first render
  const isFirstRender = useRef(true);

  const updateFog = useCallback(
    (px: number, py: number) => {
      const los = computeLOS(map, px, py, VISION_RADIUS);
      const diff = diffVisibility(prevVisibleRef.current, los.visibleSet, los.visibleTiles);

      // Grow the explored set (never shrinks)
      const explored = exploredRef.current;
      for (const key of los.visibleSet) {
        explored.add(key);
      }

      prevVisibleRef.current = los.visibleSet;

      setFogState({
        visibleSet: los.visibleSet,
        exploredSet: new Set(explored), // Snapshot for React
        entering: diff.entering,
        exiting: diff.exiting,
        stable: diff.stable,
        playerX: px,
        playerY: py,
      });
    },
    [map],
  );

  // Recompute fog when player moves (skip first render — handled by initial state)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    updateFog(playerX, playerY);
  }, [playerX, playerY, updateFog]);

  return fogState;
}
