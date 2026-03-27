/**
 * useFogOfWar — Manages fog-of-war visibility state across turns.
 *
 * On each player move, recomputes LOS, diffs against the previous visible set,
 * and maintains the explored set (union of all ever-visible tiles).
 *
 * Supports three-state visibility classification:
 * - unknown: never seen → no rendering
 * - explored-not-visible: seen before but not in current LOS → subdued remembered
 * - visible: currently in LOS → fully risen, stable
 *
 * Returns FogState which drives the FogOfWarRenderer:
 * - visibleSet: currently visible tile keys
 * - exploredSet: all ever-seen tile keys (grows monotonically)
 * - enteringNew: tiles going unknown→visible (dramatic cap-rise)
 * - enteringRevisit: tiles going explored→visible (gentle re-lift)
 * - exiting: tiles going visible→explored (gentle lowering, object permanence preserved)
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
  /** Set of currently visible tile keys (numeric: y * TILE_KEY_STRIDE + x). */
  visibleSet: Set<number>;
  /** Set of all ever-explored tile keys (grows monotonically). */
  exploredSet: Set<number>;
  /**
   * All tiles becoming visible this turn (union of enteringNew + enteringRevisit).
   * @deprecated Use enteringNew / enteringRevisit for asymmetric animation.
   */
  entering: [number, number][];
  /**
   * Tiles entering visibility for the FIRST TIME (unknown → visible).
   * Dramatic cap-rise animation from the abyss.
   */
  enteringNew: [number, number][];
  /**
   * Tiles RE-ENTERING visibility (explored → visible).
   * Gentle re-lift animation, NOT full birth-from-nothing.
   */
  enteringRevisit: [number, number][];
  /** Tiles just leaving vision this turn — animate conceal (visible → explored). */
  exiting: [number, number][];
  /** Tiles that remain visible — no animation needed. */
  stable: [number, number][];
  /** Player position when this state was computed. */
  playerX: number;
  /** Player position when this state was computed. */
  playerY: number;
  /**
   * Monotonically increasing counter that increments on each fog update.
   * Used to signal changes to ref-stable exploredSet without copying it.
   */
  fogGeneration: number;
}

/**
 * Compute the initial fog state for a given position.
 * All initially visible tiles are classified as "enteringNew" for the first reveal animation,
 * since no tiles have been explored yet.
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
    enteringNew: los.visibleTiles, // All are new on first frame (nothing explored yet)
    enteringRevisit: [], // No revisits on first frame
    exiting: [],
    stable: [],
    playerX,
    playerY,
    fogGeneration: 0,
  };
}

/**
 * Hook that manages fog-of-war state, recomputing LOS and diffing visibility
 * on each player move.
 *
 * Tracks three-state classification:
 * - Tiles entering for the first time (unknown→visible) → enteringNew
 * - Tiles re-entering from explored state (explored→visible) → enteringRevisit
 * - Tiles exiting visibility (visible→explored) → exiting (preserves object permanence)
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
  // causing re-render cycles. The Set is ref-stable and grows monotonically;
  // a generation counter signals changes without copying.
  const exploredRef = useRef<Set<number>>(new Set());
  const generationRef = useRef(0);

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
  const prevVisibleRef = useRef<Set<number>>(initialState.visibleSet);

  // Track whether this is the first render
  const isFirstRender = useRef(true);

  const updateFog = useCallback(
    (px: number, py: number) => {
      const los = computeLOS(map, px, py, VISION_RADIUS);

      // Pass exploredRef.current BEFORE adding new tiles, so we can classify
      // entering tiles as new (not in explored) vs revisit (was in explored).
      const diff = diffVisibility(
        prevVisibleRef.current,
        los.visibleSet,
        los.visibleTiles,
        exploredRef.current,
      );

      // Grow the explored set AFTER diffing (never shrinks)
      const explored = exploredRef.current;
      for (const key of los.visibleSet) {
        explored.add(key);
      }

      prevVisibleRef.current = los.visibleSet;

      generationRef.current += 1;

      setFogState({
        visibleSet: los.visibleSet,
        exploredSet: explored, // Ref-stable, grows monotonically
        entering: diff.entering,
        enteringNew: diff.enteringNew,
        enteringRevisit: diff.enteringRevisit,
        exiting: diff.exiting,
        stable: diff.stable,
        playerX: px,
        playerY: py,
        fogGeneration: generationRef.current,
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
