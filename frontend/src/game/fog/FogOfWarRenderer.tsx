/**
 * FogOfWarRenderer — Renders fog-of-war columns using a SINGLE Graphics object
 * with unified depth-sorted 2-pass rendering (all shafts, then all caps).
 *
 * Architecture:
 * - ONE PixiJS Graphics object for ALL tile states (remembered, visible, animating).
 * - 2-pass draw: Pass 1 draws all shafts back-to-front, Pass 2 draws all caps
 *   back-to-front. This ensures caps always render on top of shafts from deeper
 *   tiles, regardless of tile state — eliminating cross-layer z-order artifacts.
 * - Viewport culling: only tiles within the visible screen area (+ margin) are drawn,
 *   making render cost proportional to viewport size (~400-600 tiles), not total
 *   explored area.
 * - GSAP tweens animate AnimState objects; a single rAF-coalesced requestRedraw()
 *   redraws everything.
 *
 * PixiJS v8 Graphics API: setFillStyle → rect/poly → fill (NOT beginFill/drawRect).
 */

import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';
import { tileKey, tileKeyX, tileKeyY } from './los.ts';
import type { FogState } from './useFogOfWar.ts';
import {
  drawVisibleShaftOnly,
  drawVisibleCapOnly,
  drawRememberedShaftOnly,
  drawRememberedCapOnly,
  COLUMN_MAX_HEIGHT,
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

// ── Types ───────────────────────────────────────────────────────────

interface AnimState {
  x: number;
  y: number;
  yOffset: number;
  columnHeight: number;
  alpha: number;
  paletteProgress: number; // 0 = start palette, 1 = end palette
  type: 'new' | 'revisit' | 'conceal';
  southExposed: boolean;
  eastExposed: boolean;
  lightLift: number;
}

/** Tile descriptor used for depth-sorted drawing. */
interface TileEntry {
  x: number;
  y: number;
  southExposed: boolean;
  eastExposed: boolean;
  anim?: AnimState;
  state: 'remembered' | 'visible' | 'animating';
}

// ── Viewport culling ────────────────────────────────────────────────

/** Margin in tiles beyond the viewport edge to include in culling. */
const CULL_MARGIN = 3;

/** Viewport bounds in tile coordinates. */
export interface ViewportBounds {
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
}

/**
 * Compute the tile bounding box for the visible viewport.
 * Exported as a pure function for testing.
 */
export function computeViewportBounds(
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewportBounds {
  return {
    minTileX: Math.floor(-cameraX / TILE_SIZE) - CULL_MARGIN,
    maxTileX: Math.ceil((-cameraX + viewportWidth) / TILE_SIZE) + CULL_MARGIN,
    minTileY: Math.floor(-cameraY / TILE_SIZE) - CULL_MARGIN,
    maxTileY: Math.ceil((-cameraY + viewportHeight) / TILE_SIZE) + CULL_MARGIN,
  };
}

// ── Depth sort comparator ───────────────────────────────────────────

/** Sort tiles by isometric depth: (x+y) ascending, then y, then x. */
function depthSort(a: TileEntry, b: TileEntry): number {
  return (a.x + a.y) - (b.x + b.y) || a.y - b.y || a.x - b.x;
}

// ── Exposure helpers ────────────────────────────────────────────────

function computeExposure(
  x: number,
  y: number,
  tileSet: Set<number>,
): { southExposed: boolean; eastExposed: boolean } {
  const southKey = tileKey(x, y + 1);
  const eastKey = tileKey(x + 1, y);
  return {
    southExposed: !tileSet.has(southKey),
    eastExposed: !tileSet.has(eastKey),
  };
}

// ── Props ───────────────────────────────────────────────────────────

export interface FogOfWarRendererProps {
  map: GameMap;
  fogState: FogState;
  cameraX: number;
  cameraY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function FogOfWarRenderer({
  map,
  fogState,
  cameraX,
  cameraY,
  viewportWidth,
  viewportHeight,
}: FogOfWarRendererProps): React.JSX.Element {
  const containerRef = useRef<Container | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);

  const activeTweensRef = useRef<gsap.core.Tween[]>([]);
  const animatingTilesRef = useRef<Map<number, AnimState>>(new Map());
  const prevFogRef = useRef<FogState | null>(null);

  const redrawRequestedRef = useRef(false);
  const unionSetRef = useRef<Set<number>>(new Set());

  // Store camera in a ref so drawAll can access current values without stale closures
  const cameraRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  cameraRef.current = { x: cameraX, y: cameraY, w: viewportWidth, h: viewportHeight };

  // ── Graphics setup ──────────────────────────────────────────────

  const setupGraphics = useCallback((parentContainer: Container) => {
    if (graphicsRef.current) return;

    const g = new Graphics();
    parentContainer.addChild(g);
    graphicsRef.current = g;
  }, []);

  // ── Unified draw function ───────────────────────────────────────

  /**
   * Draw ALL tiles (remembered, visible, animating) into a single Graphics object.
   * Uses 2-pass rendering: all shafts back-to-front, then all caps back-to-front.
   * This guarantees correct z-ordering regardless of tile state.
   */
  const drawAll = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();

      // Compute viewport bounds for culling
      const cam = cameraRef.current;
      const bounds = computeViewportBounds(cam.x, cam.y, cam.w, cam.h);
      const { minTileX, maxTileX, minTileY, maxTileY } = bounds;

      // Use cached union set for exposure calculation on remembered tiles
      // (rebuilt only when fogState changes, not on every animation frame)
      const unionSet = unionSetRef.current;

      const tiles: TileEntry[] = [];

      // ── Collect remembered tiles (explored - visible - animating), viewport-culled ──
      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue;
        if (animatingTilesRef.current.has(key)) continue;
        const x = tileKeyX(key);
        const y = tileKeyY(key);
        if (x < minTileX || x > maxTileX || y < minTileY || y > maxTileY) continue;
        const { southExposed, eastExposed } = computeExposure(x, y, unionSet);
        tiles.push({ x, y, southExposed, eastExposed, state: 'remembered' });
      }

      // ── Collect visible tiles (not animating), viewport-culled ──
      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue;
        const x = tileKeyX(key);
        const y = tileKeyY(key);
        if (x < minTileX || x > maxTileX || y < minTileY || y > maxTileY) continue;
        const { southExposed, eastExposed } = computeExposure(x, y, fogSt.visibleSet);
        tiles.push({ x, y, southExposed, eastExposed, state: 'visible' });
      }

      // ── Collect animating tiles, viewport-culled ──
      for (const anim of animatingTilesRef.current.values()) {
        if (anim.x < minTileX || anim.x > maxTileX || anim.y < minTileY || anim.y > maxTileY) continue;
        tiles.push({
          x: anim.x,
          y: anim.y,
          southExposed: anim.southExposed,
          eastExposed: anim.eastExposed,
          anim,
          state: 'animating',
        });
      }

      tiles.sort(depthSort);

      // ── Pass 1: all shafts back-to-front ──
      for (const tile of tiles) {
        if (tile.state === 'remembered') {
          const config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: REMEMBERED_YOFFSET,
          };
          drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
        } else if (tile.state === 'visible') {
          const config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: 0,
          };
          drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
        } else {
          // animating
          const anim = tile.anim!;
          const config = {
            columnHeight: anim.columnHeight,
            alpha: Math.max(0, Math.min(1, anim.alpha)),
            yOffset: anim.yOffset,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            lightLift: Math.max(0, anim.lightLift || 0),
          };

          const useRemembered =
            (anim.type === 'revisit' && anim.paletteProgress < 0.5) ||
            (anim.type === 'conceal' && anim.paletteProgress >= 0.5);

          if (useRemembered) {
            drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
          } else {
            drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
          }
        }
      }

      // ── Pass 2: all caps back-to-front ──
      for (const tile of tiles) {
        if (tile.state === 'remembered') {
          const config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: REMEMBERED_YOFFSET,
          };
          drawRememberedCapOnly(g, map, tile.x, tile.y, config);
        } else if (tile.state === 'visible') {
          const config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: 0,
          };
          drawVisibleCapOnly(g, map, tile.x, tile.y, config);
        } else {
          // animating
          const anim = tile.anim!;
          const config = {
            columnHeight: anim.columnHeight,
            alpha: Math.max(0, Math.min(1, anim.alpha)),
            yOffset: anim.yOffset,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            lightLift: Math.max(0, anim.lightLift || 0),
          };

          const useRemembered =
            (anim.type === 'revisit' && anim.paletteProgress < 0.5) ||
            (anim.type === 'conceal' && anim.paletteProgress >= 0.5);

          if (useRemembered) {
            drawRememberedCapOnly(g, map, tile.x, tile.y, config);
          } else {
            drawVisibleCapOnly(g, map, tile.x, tile.y, config);
          }
        }
      }
    },
    [map],
  );

  // ── Redraw request (rAF coalesced) ──────────────────────────────

  /**
   * Request a full redraw. Uses rAF coalescing so multiple calls per frame
   * (e.g., from multiple GSAP onUpdate callbacks) only produce one draw.
   * This is the ONLY redraw function — used by both fogState changes and
   * GSAP animation updates.
   */
  const requestRedraw = useCallback((): void => {
    if (redrawRequestedRef.current) return;
    redrawRequestedRef.current = true;
    requestAnimationFrame(() => {
      redrawRequestedRef.current = false;
      const currentFog = prevFogRef.current;
      if (!currentFog || !graphicsRef.current) return;
      drawAll(graphicsRef.current, currentFog);
    });
  }, [drawAll]);

  // ── Tween management ────────────────────────────────────────────

  const removeTweenFromActive = (tween: gsap.core.Tween): void => {
    const idx = activeTweensRef.current.indexOf(tween);
    if (idx !== -1) {
      activeTweensRef.current.splice(idx, 1);
    }
  };

  const onFrontierAnimationComplete = useCallback((): void => {
    if (animatingTilesRef.current.size === 0) {
      // All frontier animations complete — nothing else to do.
      // The tile was already removed from animatingTilesRef and the
      // next requestRedraw() will pick it up from the static sets.
    }
  }, []);

  // ── Animation starters ──────────────────────────────────────────

  const animateRevealNew = useCallback(
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<number>) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;

      const targetColumnHeight = COLUMN_MAX_HEIGHT + computeHeightJitter(x, y);
      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      const animState: AnimState = {
        x,
        y,
        yOffset: RISE_OFFSET_NEW,
        columnHeight: targetColumnHeight,
        alpha: 0,
        paletteProgress: 0,
        type: 'new',
        southExposed,
        eastExposed,
        lightLift: 40,
      };

      animatingTilesRef.current.set(key, animState);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeNewRevealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        removeTweenFromActive(tween);
        // Immediate redraw — tile transitions from animating→visible in same frame
        requestRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        lightLift: 0,
        alpha: 1,
        duration,
        delay,
        ease: 'back.out(1.5)',
        onUpdate: requestRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestRedraw, onFrontierAnimationComplete],
  );

  const animateRevealRevisit = useCallback(
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<number>) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;

      const targetColumnHeight = COLUMN_MAX_HEIGHT + computeHeightJitter(x, y);
      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      const animState: AnimState = {
        x,
        y,
        yOffset: RISE_OFFSET_REVISIT,
        columnHeight: targetColumnHeight,
        alpha: 1,
        paletteProgress: 0,
        type: 'revisit',
        southExposed,
        eastExposed,
        lightLift: 20,
      };

      animatingTilesRef.current.set(key, animState);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER * 0.5);
      const duration = computeRevisitRevealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        removeTweenFromActive(tween);
        requestRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        lightLift: 0,
        paletteProgress: 1,
        duration,
        delay,
        ease: 'back.out(1.2)',
        onUpdate: requestRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestRedraw, onFrontierAnimationComplete],
  );

  const animateConceal = useCallback(
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<number>) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;

      const startColumnHeight = COLUMN_MAX_HEIGHT + computeHeightJitter(x, y);
      const { southExposed, eastExposed } = computeExposure(x, y, visibleSet);

      const animState: AnimState = {
        x,
        y,
        yOffset: 0,
        columnHeight: startColumnHeight,
        alpha: 1,
        paletteProgress: 0,
        type: 'conceal',
        southExposed,
        eastExposed,
        lightLift: 0,
      };

      animatingTilesRef.current.set(key, animState);

      const delay = computeStaggerDelay(x, y, playerX, playerY, MAX_STAGGER);
      const duration = computeConcealDuration();

      const onComplete = () => {
        animatingTilesRef.current.delete(key);
        removeTweenFromActive(tween);
        requestRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: SINK_OFFSET,
        paletteProgress: 1,
        alpha: 1,
        duration,
        delay,
        ease: 'power2.in',
        onUpdate: requestRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestRedraw, onFrontierAnimationComplete],
  );

  // ── fogState change effect ──────────────────────────────────────

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    setupGraphics(parent);

    if (!graphicsRef.current) return;

    prevFogRef.current = fogState;

    // Rebuild unionSet when fogState changes (not on every animation frame)
    const union = new Set(fogState.exploredSet);
    for (const key of fogState.visibleSet) {
      union.add(key);
    }
    unionSetRef.current = union;

    // Request unified redraw
    requestRedraw();

    for (const tile of fogState.enteringNew) {
      animateRevealNew(tile[0], tile[1], fogState.playerX, fogState.playerY, fogState.visibleSet);
    }

    for (const tile of fogState.enteringRevisit) {
      animateRevealRevisit(tile[0], tile[1], fogState.playerX, fogState.playerY, fogState.visibleSet);
    }

    for (const tile of fogState.exiting) {
      animateConceal(tile[0], tile[1], fogState.playerX, fogState.playerY, fogState.visibleSet);
    }
  }, [
    fogState,
    setupGraphics,
    requestRedraw,
    animateRevealNew,
    animateRevealRevisit,
    animateConceal,
  ]);

  // ── Redraw on camera/viewport changes ───────────────────────────

  useEffect(() => {
    // When camera moves (panning) or viewport resizes, we need to redraw
    // because the set of culled tiles changes.
    requestRedraw();
  }, [cameraX, cameraY, viewportWidth, viewportHeight, requestRedraw]);

  // ── Cleanup on unmount ──────────────────────────────────────────

  useEffect(() => {
    const tweens = activeTweensRef.current;
    const animating = animatingTilesRef.current;
    return () => {
      for (const tween of tweens) {
        tween.kill();
      }
      activeTweensRef.current = [];
      animating.clear();
    };
  }, []);

  const setContainerRef = useCallback((node: Container | null) => {
    containerRef.current = node;
  }, []);

  return <pixiContainer ref={setContainerRef} />;
}
