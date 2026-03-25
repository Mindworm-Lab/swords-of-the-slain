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
 * - Reveal: top cap stays pinned at y * TILE_SIZE. Shaft grows downward
 *   (columnHeight 0 → max). Alpha fades from 0 → 1. NO yOffset.
 * - Conceal: shaft shrinks upward, alpha fades out. NO yOffset.
 *   On complete, tile snaps to remembered batch.
 * - Per-tile desynchronization via computeStaggerDelay (ripple outward from player).
 * - Per-tile seeded height jitter (±2px) for irregular frontier edge.
 *
 * Exposure-aware side faces:
 * - Each tile's south/east neighbors are checked against the relevant visibility set.
 * - If the neighbor IS in the set, that edge is interior → no side face.
 * - If the neighbor is NOT in the set, that edge is exposed → side face renders.
 * - This produces seamless surfaces for interior tiles and abyss shafts at edges.
 *
 * NoiseFilter is event-driven:
 * - Starts disabled (noise=0).
 * - Activates when frontier animations are running.
 * - Deactivates (tween to 0) when the last frontier animation completes.
 * - No infinite repeat tweens.
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

// ── Exposure helpers ────────────────────────────────────────────────

/**
 * Compute whether a tile's south and east edges are exposed to void.
 *
 * An edge is "exposed" if the neighboring tile in that direction is NOT
 * present in the given tile set. Interior tiles (surrounded by same-set
 * neighbors) get no side faces → seamless surface.
 *
 * @param x - Tile grid X
 * @param y - Tile grid Y
 * @param tileSet - Set of tile keys that count as "present" (visible or explored)
 * @returns Exposure flags for south and east edges
 */
function computeExposure(
  x: number,
  y: number,
  tileSet: Set<string>,
): { southExposed: boolean; eastExposed: boolean } {
  const southKey = tileKey(x, y + 1);
  const eastKey = tileKey(x + 1, y);
  return {
    southExposed: !tileSet.has(southKey),
    eastExposed: !tileSet.has(eastKey),
  };
}

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
  // Track the noise seed animation tween (only runs while noise > 0)
  const noiseSeedTweenRef = useRef<gsap.core.Tween | null>(null);
  // Track the noise intensity tween (fade in/out)
  const noiseIntensityTweenRef = useRef<gsap.core.Tween | null>(null);

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

    // NoiseFilter starts DISABLED (noise=0). Activated only during frontier animations.
    const noiseFilter = new NoiseFilter({
      noise: 0,
      seed: Math.random(),
    });
    frontierC.filters = [noiseFilter];
    noiseFilterRef.current = noiseFilter;
  }, []);

  // Draw all remembered (explored but not visible) tiles as a batch of short columns
  const drawRememberedBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      // For remembered tiles, a neighbor is "present" if it's visible OR explored
      // (i.e., a remembered tile's south face is exposed only if the tile below
      // is neither visible nor explored)
      const unionSet = new Set(fogSt.exploredSet);
      for (const key of fogSt.visibleSet) {
        unionSet.add(key);
      }

      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue; // Skip currently visible
        if (animatingTilesRef.current.has(key)) continue; // Skip animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, unionSet);
        drawRememberedColumn(g, map, x, y, {
          columnHeight: COLUMN_REMEMBERED_HEIGHT,
          southExposed,
          eastExposed,
        });
      }
    },
    [map],
  );

  /**
   * Draw visible batch: all currently visible tiles that aren't animating,
   * rendered as full-height columns with exposure-aware side faces.
   */
  const drawVisibleBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue; // Still animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, fogSt.visibleSet);
        drawVisibleColumn(g, map, x, y, {
          columnHeight: COLUMN_MAX_HEIGHT,
          southExposed,
          eastExposed,
        });
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
   * Called when a frontier animation completes. If no more tiles are
   * animating, deactivate the NoiseFilter with a fade-out tween.
   */
  const onFrontierAnimationComplete = useCallback((): void => {
    if (animatingTilesRef.current.size === 0) {
      const noiseF = noiseFilterRef.current;
      if (!noiseF) return;

      // Kill any existing intensity tween
      if (noiseIntensityTweenRef.current) {
        noiseIntensityTweenRef.current.kill();
        noiseIntensityTweenRef.current = null;
      }

      // Fade noise intensity to 0
      noiseIntensityTweenRef.current = gsap.to(noiseF, {
        noise: 0,
        duration: 0.3,
        ease: 'power2.out',
        onComplete: () => {
          noiseIntensityTweenRef.current = null;
          // Kill the seed animation once noise is 0
          if (noiseSeedTweenRef.current) {
            noiseSeedTweenRef.current.kill();
            noiseSeedTweenRef.current = null;
          }
        },
      });
    }
  }, []);

  /**
   * Activate the NoiseFilter when frontier animations begin.
   * Starts the noise intensity tween (0 → 0.15) and a seed animation.
   */
  const activateNoise = useCallback((): void => {
    const noiseF = noiseFilterRef.current;
    if (!noiseF) return;

    // Kill any existing intensity tween (might be fading out)
    if (noiseIntensityTweenRef.current) {
      noiseIntensityTweenRef.current.kill();
      noiseIntensityTweenRef.current = null;
    }

    // Fade noise in
    noiseIntensityTweenRef.current = gsap.to(noiseF, {
      noise: 0.15,
      duration: 0.1,
      ease: 'power2.in',
      onComplete: () => {
        noiseIntensityTweenRef.current = null;
      },
    });

    // Start seed animation if not already running
    if (!noiseSeedTweenRef.current) {
      noiseF.seed = Math.random();
      noiseSeedTweenRef.current = gsap.to(noiseF, {
        seed: Math.random() + 1,
        duration: 0.8,
        ease: 'none',
        repeat: -1,
        yoyo: true,
      });
    }
  }, []);

  /**
   * Animate a tile reveal (entering visibility) — columnar emergence.
   *
   * Top cap stays PINNED at (x * TILE_SIZE, y * TILE_SIZE) — no vertical displacement.
   * The shaft grows downward (columnHeight 0 → max) while alpha fades from 0 → 1.
   * On complete, removes the Graphics and redraws batched layers.
   */
  const animateReveal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      frontierContainer: Container,
      visibleSet: Set<string>,
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

      // Compute exposure against current visible set
      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      // Initial state: zero height, fully transparent — top cap stays pinned
      const animState = { columnHeight: 0, alpha: 0 };

      // Position pinned at world coords — NEVER changes during animation
      tileG.x = targetPx;
      tileG.y = targetPy;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeDuration();

      const onRevealComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        columnHeight: targetColumnHeight,
        alpha: 1,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => {
          tileG.clear();
          drawVisibleColumnLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
            alpha: animState.alpha,
            southExposed,
            eastExposed,
          });
        },
        onComplete: onRevealComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched, onFrontierAnimationComplete],
  );

  /**
   * Animate a tile conceal (exiting visibility) — columnar sinking.
   *
   * Top cap stays PINNED at (x * TILE_SIZE, y * TILE_SIZE) — no vertical displacement.
   * Shaft shrinks upward (columnHeight max → 0), alpha fades from 1 → 0.
   * On complete, tile snaps to the remembered batch layer.
   */
  const animateConceal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      frontierContainer: Container,
      visibleSet: Set<string>,
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

      // Compute exposure against current visible set
      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      // Initial state: fully risen, fully opaque — top cap pinned
      const animState = { columnHeight: startColumnHeight, alpha: 1 };

      // Draw initial state
      drawVisibleColumnLocal(tileG, map, x, y, {
        columnHeight: animState.columnHeight,
        alpha: animState.alpha,
        southExposed,
        eastExposed,
      });
      // Position pinned at world coords — NEVER changes
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
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        columnHeight: 0,
        alpha: 0,
        duration,
        delay,
        ease: 'power2.in',
        onUpdate: () => {
          tileG.clear();
          drawVisibleColumnLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
            alpha: animState.alpha,
            southExposed,
            eastExposed,
          });
        },
        onComplete: onConcealComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched, onFrontierAnimationComplete],
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

    // Draw batched layers
    drawRememberedBatch(rememberedG, fogState);
    drawVisibleBatch(visibleG, fogState);

    // Determine if there are frontier tiles to animate
    const hasFrontierWork = fogState.entering.length > 0 || fogState.exiting.length > 0;

    // Activate noise only when frontier animations are starting
    if (hasFrontierWork) {
      activateNoise();
    }

    // Animate entering tiles (reveal — shaft grows downward, alpha fades in)
    for (const tile of fogState.entering) {
      animateReveal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
        fogState.visibleSet,
      );
    }

    // Animate exiting tiles (conceal — shaft shrinks upward, alpha fades out)
    for (const tile of fogState.exiting) {
      animateConceal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
        fogState.visibleSet,
      );
    }
  }, [
    fogState,
    setupLayers,
    drawRememberedBatch,
    drawVisibleBatch,
    animateReveal,
    animateConceal,
    activateNoise,
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
      if (noiseSeedTweenRef.current) {
        noiseSeedTweenRef.current.kill();
        noiseSeedTweenRef.current = null;
      }
      if (noiseIntensityTweenRef.current) {
        noiseIntensityTweenRef.current.kill();
        noiseIntensityTweenRef.current = null;
      }
    };
  }, []);

  // Ref callback to capture the Container instance
  const setContainerRef = useCallback((node: Container | null) => {
    containerRef.current = node;
  }, []);

  return <pixiContainer ref={setContainerRef} />;
}
