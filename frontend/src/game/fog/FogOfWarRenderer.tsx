/**
 * FogOfWarRenderer — PixiJS fog-of-war renderer with three-state columnar emergence.
 *
 * Three perceptual tile states:
 *   1. UNKNOWN — not rendered, abyss visible.
 *   2. EXPLORED-NOT-VISIBLE — subdued palette, slightly lowered cap (REMEMBERED_YOFFSET),
 *      quiet, spatially legible. Preserves object permanence.
 *   3. VISIBLE — fully risen to authored height (yOffset=0), stable, locally lit.
 *
 * Asymmetric transitions:
 *   - unknown → visible: dramatic cap-rise from the abyss (large RISE_OFFSET_NEW yOffset,
 *     alpha 0→1, ~500ms). The cap translates upward; the shaft hangs below.
 *   - explored → visible: gentle re-lift (small RISE_OFFSET_REVISIT yOffset, alpha stays 1,
 *     palette transitions from remembered→visible, ~250ms). NOT a full birth-from-nothing.
 *   - visible → explored: gentle partial lowering (yOffset 0→SINK_OFFSET, palette shift to
 *     remembered, alpha stays 1, ~350ms). Preserves location memory.
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
 * NoiseFilter is event-driven:
 * - Starts disabled (noise=0).
 * - Activates when frontier animations are running.
 * - Deactivates (tween to 0) when the last frontier animation completes.
 * - Seed tween runs for fixed duration matching animation window, then stops.
 *   NO infinite repeat tweens.
 */

import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics, NoiseFilter } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';
import { tileKey } from './los.ts';
import type { FogState } from './useFogOfWar.ts';
import {
  drawVisibleShaftOnly,
  drawVisibleCapOnly,
  drawRememberedShaftOnly,
  drawRememberedCapOnly,
  drawVisibleShaftOnlyLocal,
  drawVisibleCapOnlyLocal,
  drawRememberedShaftOnlyLocal,
  drawRememberedCapOnlyLocal,
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
} from './columnRenderer.ts';
import {
  computeStaggerDelay,
  computeNewRevealDuration,
  computeRevisitRevealDuration,
  computeConcealDuration,
  computeHeightJitter,
  RISE_OFFSET_NEW,
  RISE_OFFSET_REVISIT,
  SINK_OFFSET,
  REMEMBERED_YOFFSET,
  MAX_STAGGER,
} from './fogAnimationHelpers.ts';

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

  /**
   * Draw all remembered (explored but not visible) tiles as a batch of short columns.
   * Remembered tiles have a small static yOffset (REMEMBERED_YOFFSET) to appear
   * slightly lowered, signaling "seen before but not currently visible".
   *
   * Two-pass rendering: all shafts first (back-to-front by Y ascending),
   * then all caps (back-to-front by Y ascending). This prevents rear shafts
   * from bleeding through same-plane top caps.
   */
  const drawRememberedBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      // For remembered tiles, a neighbor is "present" if it's visible OR explored
      const unionSet = new Set(fogSt.exploredSet);
      for (const key of fogSt.visibleSet) {
        unionSet.add(key);
      }

      // Collect remembered tile coordinates and sort by Y ascending (back-to-front)
      const tiles: { x: number; y: number; southExposed: boolean; eastExposed: boolean }[] = [];
      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue; // Skip currently visible
        if (animatingTilesRef.current.has(key)) continue; // Skip animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, unionSet);
        tiles.push({ x, y, southExposed, eastExposed });
      }
      tiles.sort((a, b) => a.y - b.y || a.x - b.x);

      const config = {
        columnHeight: COLUMN_REMEMBERED_HEIGHT,
        southExposed: false,
        eastExposed: false,
        yOffset: REMEMBERED_YOFFSET,
      };

      // Pass 1: all shafts (back-to-front)
      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
      }

      // Pass 2: all caps (back-to-front)
      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawRememberedCapOnly(g, map, tile.x, tile.y, config);
      }
    },
    [map],
  );

  /**
   * Draw visible batch: all currently visible tiles that aren't animating,
   * rendered as full-height columns with exposure-aware side faces.
   * Visible tiles have yOffset=0 — fully risen to authored height.
   *
   * Two-pass rendering: all shafts first (back-to-front by Y ascending),
   * then all caps (back-to-front by Y ascending). This prevents rear shafts
   * from bleeding through same-plane top caps.
   */
  const drawVisibleBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();

      // Collect visible tile coordinates and sort by Y ascending (back-to-front)
      const tiles: { x: number; y: number; southExposed: boolean; eastExposed: boolean }[] = [];
      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue; // Still animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, fogSt.visibleSet);
        tiles.push({ x, y, southExposed, eastExposed });
      }
      tiles.sort((a, b) => a.y - b.y || a.x - b.x);

      const config = {
        columnHeight: COLUMN_MAX_HEIGHT,
        southExposed: false,
        eastExposed: false,
        yOffset: 0,
      };

      // Pass 1: all shafts (back-to-front)
      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
      }

      // Pass 2: all caps (back-to-front)
      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawVisibleCapOnly(g, map, tile.x, tile.y, config);
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
   * Starts the noise intensity tween (0 → 0.15) and a FINITE seed animation.
   * The seed tween runs for a fixed duration matching the animation window,
   * then stops — no infinite repeat.
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

    // Start seed animation — FINITE duration, no repeat:-1
    if (noiseSeedTweenRef.current) {
      noiseSeedTweenRef.current.kill();
      noiseSeedTweenRef.current = null;
    }
    noiseF.seed = Math.random();
    noiseSeedTweenRef.current = gsap.to(noiseF, {
      seed: Math.random() + 1,
      duration: 0.8,
      ease: 'none',
      onComplete: () => {
        noiseSeedTweenRef.current = null;
      },
    });
  }, []);

  /**
   * Animate a tile reveal from UNKNOWN state (unknown → visible).
   *
   * Dramatic cap-rise from the abyss:
   * - yOffset starts at RISE_OFFSET_NEW (cap far below authored height)
   * - Animates to yOffset=0 (cap at authored height)
   * - columnHeight = COLUMN_MAX_HEIGHT throughout (shaft hangs below cap)
   * - Alpha fades from 0 → 1
   * - Duration ~500ms with stagger delay
   */
  const animateRevealNew = useCallback(
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

      // Cap-rise: start far below, rise to authored height
      const animState = {
        yOffset: RISE_OFFSET_NEW,
        columnHeight: targetColumnHeight,
        alpha: 0,
      };

      // Position at world coords
      tileG.x = targetPx;
      tileG.y = targetPy;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeNewRevealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        alpha: 1,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => {
          tileG.clear();
          // Two-pass: shaft first, then cap — prevents shaft bleeding through cap
          drawVisibleShaftOnlyLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
            alpha: animState.alpha,
            yOffset: animState.yOffset,
            southExposed,
            eastExposed,
          });
          drawVisibleCapOnlyLocal(tileG, map, x, y, {
            columnHeight: animState.columnHeight,
            alpha: animState.alpha,
            yOffset: animState.yOffset,
            southExposed,
            eastExposed,
          });
        },
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched, onFrontierAnimationComplete],
  );

  /**
   * Animate a tile re-lift from EXPLORED state (explored → visible).
   *
   * Gentle re-lift — NOT a full birth-from-nothing:
   * - yOffset starts at RISE_OFFSET_REVISIT (small displacement)
   * - Animates to yOffset=0 (fully risen)
   * - columnHeight transitions from COLUMN_REMEMBERED_HEIGHT → COLUMN_MAX_HEIGHT
   * - Alpha stays 1 (tile was already visible as remembered)
   * - Duration ~250ms, shorter stagger
   * - During animation, transitions from remembered to visible palette
   */
  const animateRevealRevisit = useCallback(
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

      const heightJitter = computeHeightJitter(x, y);
      const targetColumnHeight = COLUMN_MAX_HEIGHT + heightJitter;

      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      // Start from remembered state — already visible, just slightly lowered
      const animState = {
        yOffset: RISE_OFFSET_REVISIT,
        columnHeight: COLUMN_REMEMBERED_HEIGHT,
        alpha: 1, // Already visible as remembered — no alpha change
        paletteProgress: 0, // 0 = remembered palette, 1 = visible palette
      };

      tileG.x = targetPx;
      tileG.y = targetPy;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER * 0.5);
      const duration = computeRevisitRevealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        columnHeight: targetColumnHeight,
        paletteProgress: 1,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => {
          tileG.clear();
          // Blend from remembered to visible drawing based on paletteProgress
          // Two-pass within each: shaft first, then cap
          if (animState.paletteProgress < 0.5) {
            // First half: draw as remembered (transitioning)
            drawRememberedShaftOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
            drawRememberedCapOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
          } else {
            // Second half: draw as visible
            drawVisibleShaftOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
            drawVisibleCapOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
          }
        },
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [map, requestRedrawBatched, onFrontierAnimationComplete],
  );

  /**
   * Animate a tile conceal (visible → explored).
   *
   * Gentle partial lowering — preserves object permanence:
   * - yOffset starts at 0 (fully risen), animates to SINK_OFFSET (slightly lowered)
   * - columnHeight shrinks from COLUMN_MAX_HEIGHT → COLUMN_REMEMBERED_HEIGHT
   * - Alpha stays 1 — NEVER fades to 0. Object permanence preserved.
   * - Palette transitions from visible → remembered
   * - On complete, tile snaps to remembered batch layer (already lowered)
   * - Duration ~350ms
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

      const heightJitter = computeHeightJitter(x, y);
      const startColumnHeight = COLUMN_MAX_HEIGHT + heightJitter;

      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      // Start fully risen and visible
      const animState = {
        yOffset: 0,
        columnHeight: startColumnHeight,
        alpha: 1,
        paletteProgress: 0, // 0 = visible palette, 1 = remembered palette
      };

      // Draw initial state (two-pass: shaft first, then cap)
      drawVisibleShaftOnlyLocal(tileG, map, x, y, {
        columnHeight: animState.columnHeight,
        alpha: animState.alpha,
        yOffset: 0,
        southExposed,
        eastExposed,
      });
      drawVisibleCapOnlyLocal(tileG, map, x, y, {
        columnHeight: animState.columnHeight,
        alpha: animState.alpha,
        yOffset: 0,
        southExposed,
        eastExposed,
      });

      tileG.x = targetPx;
      tileG.y = targetPy;

      frontierContainer.addChild(tileG);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeConcealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        frontierContainer.removeChild(tileG);
        tileG.destroy();
        removeTweenFromActive(tween);
        requestRedrawBatched();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: SINK_OFFSET,
        columnHeight: COLUMN_REMEMBERED_HEIGHT,
        paletteProgress: 1,
        alpha: 1, // Alpha stays 1 — object permanence
        duration,
        delay,
        ease: 'power2.in',
        onUpdate: () => {
          tileG.clear();
          // Blend from visible to remembered palette
          // Two-pass within each: shaft first, then cap
          if (animState.paletteProgress < 0.5) {
            drawVisibleShaftOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
            drawVisibleCapOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
          } else {
            drawRememberedShaftOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
            drawRememberedCapOnlyLocal(tileG, map, x, y, {
              columnHeight: animState.columnHeight,
              alpha: animState.alpha,
              yOffset: animState.yOffset,
              southExposed,
              eastExposed,
            });
          }
        },
        onComplete,
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
    const hasFrontierWork =
      fogState.enteringNew.length > 0 ||
      fogState.enteringRevisit.length > 0 ||
      fogState.exiting.length > 0;

    // Activate noise only when frontier animations are starting
    if (hasFrontierWork) {
      activateNoise();
    }

    // Animate tiles entering from UNKNOWN state (dramatic cap-rise)
    for (const tile of fogState.enteringNew) {
      animateRevealNew(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
        fogState.visibleSet,
      );
    }

    // Animate tiles re-entering from EXPLORED state (gentle re-lift)
    for (const tile of fogState.enteringRevisit) {
      animateRevealRevisit(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        frontierC,
        fogState.visibleSet,
      );
    }

    // Animate exiting tiles (visible → explored — gentle lowering)
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
    animateRevealNew,
    animateRevealRevisit,
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
