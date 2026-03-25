/**
 * FogOfWarRenderer — PixiJS fog-of-war renderer with columnar emergence animations.
 *
 * Architecture:
 *   <pixiContainer> (camera offset applied by parent)
 *     ├── Remembered Layer: explored-but-not-visible tiles as short quiet columns
 *     ├── Visible Layer: currently visible tiles as full-height columns
 *     ├── Frontier Layer: tiles entering/exiting visibility, animated with GSAP tweens
 *     └── Player sprite (rendered by parent, on top)
 *
 * Performance strategy:
 * - Stable visible and remembered tiles use batched Graphics (one draw call each).
 * - ONLY frontier tiles (entering/exiting ~20-40) get individual Graphics for animation.
 * - After a frontier tile's animation completes, the tile transfers to a batched layer.
 *
 * Columnar emergence (ONE mode):
 * - Reveal: column rises from below — columnHeight animates from 0 → COLUMN_MAX_HEIGHT,
 *   yOffset animates from COLUMN_MAX_HEIGHT → 0 (the column literally rises into place).
 * - Conceal: column sinks downward — reverse of reveal.
 * - Per-tile desynchronization via computeStaggerDelay (ripple outward from player).
 * - Per-tile seeded height jitter (±2px) for irregular frontier edge.
 *
 * A NoiseFilter is applied to the frontier container, giving the visibility
 * boundary a subtle computational shimmer. The noise seed is continuously
 * animated via GSAP so the edge feels alive rather than mechanically crisp.
 */

import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics, NoiseFilter } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';
import { tileKey } from './los.ts';
import type { FogState } from './useFogOfWar.ts';
import {
  drawVisibleColumn,
  drawRememberedColumn,
  drawVisibleColumnLocal,
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
} from './columnRenderer.ts';
import {
  computeStaggerDelay,
  computeDuration,
  computeHeightJitter,
} from './fogAnimationHelpers.ts';

// ── Animation constants ─────────────────────────────────────────────

/** Maximum random stagger delay in seconds. */
const MAX_STAGGER = 0.15;

// ── Props ───────────────────────────────────────────────────────────

/** Props for FogOfWarRenderer. */
export interface FogOfWarRendererProps {
  /** The game map to render. */
  map: GameMap;
  /** Current fog-of-war state from useFogOfWar. */
  fogState: FogState;
}

/**
 * FogOfWarRenderer — Renders the map with fog-of-war using columnar emergence.
 *
 * Uses an imperative approach: a Container ref manages three sub-containers
 * (remembered, visible, frontier) and directly creates/removes PixiJS objects
 * for animated frontier tiles.
 */
export function FogOfWarRenderer({
  map,
  fogState,
}: FogOfWarRendererProps): React.JSX.Element {
  const containerRef = useRef<Container | null>(null);
  const rememberedGraphicsRef = useRef<Graphics | null>(null);
  const visibleGraphicsRef = useRef<Graphics | null>(null);
  const frontierContainerRef = useRef<Container | null>(null);

  // Track active GSAP tweens so we can kill them on cleanup
  const activeTweensRef = useRef<gsap.core.Tween[]>([]);
  // Track tiles currently animating in the frontier (to avoid duplicates)
  const animatingTilesRef = useRef<Set<string>>(new Set());
  // Track previous fogState to detect changes
  const prevFogRef = useRef<FogState | null>(null);
  // Track the noise filter instance applied to the frontier layer
  const noiseFilterRef = useRef<NoiseFilter | null>(null);
  // Track the noise animation tween
  const noiseTweenRef = useRef<gsap.core.Tween | null>(null);

  // One-time setup: create the layer containers
  const setupLayers = useCallback((parentContainer: Container) => {
    if (rememberedGraphicsRef.current) return; // Already set up

    const rememberedG = new Graphics();
    parentContainer.addChild(rememberedG);
    rememberedGraphicsRef.current = rememberedG;

    const visibleG = new Graphics();
    parentContainer.addChild(visibleG);
    visibleGraphicsRef.current = visibleG;

    const frontierC = new Container();
    parentContainer.addChild(frontierC);
    frontierContainerRef.current = frontierC;

    // Apply a subtle noise filter to the frontier layer for "alive edge" shimmer
    const noiseFilter = new NoiseFilter({
      noise: 0.2,
      seed: Math.random(),
    });
    frontierC.filters = [noiseFilter];
    noiseFilterRef.current = noiseFilter;
  }, []);

  // Draw all remembered (explored but not visible) tiles as a batch of short columns
  const drawRememberedBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue; // Skip currently visible
        if (animatingTilesRef.current.has(key)) continue; // Skip animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        drawRememberedColumn(g, map, x, y, { columnHeight: COLUMN_REMEMBERED_HEIGHT });
      }
    },
    [map],
  );

  /**
   * Draw visible batch: all currently visible tiles that aren't animating,
   * rendered as full-height columns.
   */
  const drawVisibleBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue; // Still animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        drawVisibleColumn(g, map, x, y, { columnHeight: COLUMN_MAX_HEIGHT });
      }
    },
    [map],
  );

  /** Remove a completed tween from the active list. */
  const removeTweenFromActive = (tween: gsap.core.Tween): void => {
    const idx = activeTweensRef.current.indexOf(tween);
    if (idx !== -1) {
      activeTweensRef.current.splice(idx, 1);
    }
  };

  /** Flag to batch redraw requests (avoid multiple redraws in one frame). */
  const redrawRequestedRef = useRef(false);

  /** Request a batched layer redraw on the next frame. */
  const requestRedrawBatched = useCallback((): void => {
    if (redrawRequestedRef.current) return;
    redrawRequestedRef.current = true;
    requestAnimationFrame(() => {
      redrawRequestedRef.current = false;
      const currentFog = prevFogRef.current;
      if (!currentFog) return;
      if (rememberedGraphicsRef.current) {
        drawRememberedBatch(rememberedGraphicsRef.current, currentFog);
      }
      if (visibleGraphicsRef.current) {
        drawVisibleBatch(visibleGraphicsRef.current, currentFog);
      }
    });
  }, [drawRememberedBatch, drawVisibleBatch]);

  /**
   * Animate a tile reveal (entering visibility) — columnar emergence.
   *
   * Creates an individual Graphics for the tile, animates columnHeight from 0
   * to full height while the tile rises from below (yOffset decreases to 0).
   * On complete, removes the Graphics and redraws batched layers.
   */
  const animateReveal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      frontierContainer: Container,
    ) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;
      animatingTilesRef.current.add(key);

      const tileG = new Graphics();

      const targetPx = x * TILE_SIZE;
      const targetPy = y * TILE_SIZE;

      // Per-tile seeded height jitter for irregular frontier edge
      const heightJitter = computeHeightJitter(x, y);
      const targetColumnHeight = COLUMN_MAX_HEIGHT + heightJitter;

      // Initial state: column has zero height, positioned below its target
      const animState = { columnHeight: 0, yOffset: COLUMN_MAX_HEIGHT };

      tileG.x = targetPx;
      tileG.y = targetPy + animState.yOffset;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeDuration();

      const onRevealComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
      };

      const tween = gsap.to(animState, {
        columnHeight: targetColumnHeight,
        yOffset: 0,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => {
          tileG.clear();
          drawVisibleColumnLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
          });
          tileG.y = targetPy + animState.yOffset;
        },
        onComplete: onRevealComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched],
  );

  /**
   * Animate a tile conceal (exiting visibility) — columnar sinking.
   *
   * Creates an individual Graphics in visible style, animates columnHeight
   * from full to 0 while the tile sinks downward. On complete, transfers
   * to the remembered batch layer.
   */
  const animateConceal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      frontierContainer: Container,
    ) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;
      animatingTilesRef.current.add(key);

      const tileG = new Graphics();

      const targetPx = x * TILE_SIZE;
      const targetPy = y * TILE_SIZE;

      // Per-tile seeded height jitter (same as reveal for consistency)
      const heightJitter = computeHeightJitter(x, y);
      const startColumnHeight = COLUMN_MAX_HEIGHT + heightJitter;

      // Initial state: fully risen column at its target position
      const animState = { columnHeight: startColumnHeight, yOffset: 0 };

      // Draw initial state
      drawVisibleColumnLocal(tileG, map, x, y, {
        columnHeight: animState.columnHeight,
      });
      tileG.x = targetPx;
      tileG.y = targetPy;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeDuration();

      const onConcealComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
      };

      const tween = gsap.to(animState, {
        columnHeight: 0,
        yOffset: COLUMN_MAX_HEIGHT,
        duration,
        delay,
        ease: 'power2.in',
        onUpdate: () => {
          tileG.clear();
          drawVisibleColumnLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
          });
          tileG.y = targetPy + animState.yOffset;
        },
        onComplete: onConcealComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched],
  );

  // Main effect: react to fogState changes and drive animations
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    setupLayers(parent);

    const frontierC = frontierContainerRef.current;
    const rememberedG = rememberedGraphicsRef.current;
    const visibleG = visibleGraphicsRef.current;
    if (!frontierC || !rememberedG || !visibleG) return;

    // Store current fog for async callbacks
    prevFogRef.current = fogState;

    // Animate noise seed on the frontier layer for continuous shimmer
    if (noiseFilterRef.current) {
      // Kill any previous noise tween to avoid stacking
      if (noiseTweenRef.current) {
        noiseTweenRef.current.kill();
        noiseTweenRef.current = null;
      }
      const noiseF = noiseFilterRef.current;
      noiseF.seed = Math.random();
      // Continuous subtle seed animation while frontier tiles are transitioning
      noiseTweenRef.current = gsap.to(noiseF, {
        seed: Math.random() + 1,
        duration: 0.8,
        ease: 'none',
        repeat: -1,
        yoyo: true,
      });
    }

    // Draw batched layers
    drawRememberedBatch(rememberedG, fogState);
    drawVisibleBatch(visibleG, fogState);

    // Animate entering tiles (reveal — columns rise from below)
    for (const tile of fogState.entering) {
      animateReveal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
      );
    }

    // Animate exiting tiles (conceal — columns sink downward)
    for (const tile of fogState.exiting) {
      animateConceal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
      );
    }
  }, [
    fogState,
    setupLayers,
    drawRememberedBatch,
    drawVisibleBatch,
    animateReveal,
    animateConceal,
  ]);

  // Cleanup: kill all active tweens on unmount
  useEffect(() => {
    const tweens = activeTweensRef.current;
    const animating = animatingTilesRef.current;
    return () => {
      for (const tween of tweens) {
        tween.kill();
      }
      activeTweensRef.current = [];
      animating.clear();
      if (noiseTweenRef.current) {
        noiseTweenRef.current.kill();
        noiseTweenRef.current = null;
      }
    };
  }, []);

  // Ref callback to capture the Container instance
  const setContainerRef = useCallback((node: Container | null) => {
    containerRef.current = node;
  }, []);

  return <pixiContainer ref={setContainerRef} />;
}
