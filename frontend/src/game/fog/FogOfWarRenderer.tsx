import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
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

/** Tile descriptor used for depth-sorted drawing within a single layer. */
interface TileEntry {
  x: number;
  y: number;
  southExposed: boolean;
  eastExposed: boolean;
  anim?: AnimState;
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
}

export function FogOfWarRenderer({
  map,
  fogState,
}: FogOfWarRendererProps): React.JSX.Element {
  const containerRef = useRef<Container | null>(null);

  // 3-layer Graphics refs (back-to-front: remembered, animating, visible)
  const rememberedGRef = useRef<Graphics | null>(null);
  const animatingGRef = useRef<Graphics | null>(null);
  const visibleGRef = useRef<Graphics | null>(null);

  const activeTweensRef = useRef<gsap.core.Tween[]>([]);
  const animatingTilesRef = useRef<Map<number, AnimState>>(new Map());
  const prevFogRef = useRef<FogState | null>(null);

  const animRedrawRequestedRef = useRef(false);
  const staticRedrawRequestedRef = useRef(false);

  // ── Layer setup ─────────────────────────────────────────────────

  const setupLayers = useCallback((parentContainer: Container) => {
    if (rememberedGRef.current) return;

    const rememberedG = new Graphics();
    const animatingG = new Graphics();
    const visibleG = new Graphics();

    // Add in back-to-front order: remembered → animating → visible
    parentContainer.addChild(rememberedG);
    parentContainer.addChild(animatingG);
    parentContainer.addChild(visibleG);

    rememberedGRef.current = rememberedG;
    animatingGRef.current = animatingG;
    visibleGRef.current = visibleG;
  }, []);

  // ── Static layer: remembered (explored-not-visible) ─────────────

  const drawStaticRemembered = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();

      // Build union set for exposure calculation (explored + visible)
      const unionSet = new Set(fogSt.exploredSet);
      for (const key of fogSt.visibleSet) {
        unionSet.add(key);
      }

      const tiles: TileEntry[] = [];

      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue;
        if (animatingTilesRef.current.has(key)) continue;
        const x = tileKeyX(key);
        const y = tileKeyY(key);
        const { southExposed, eastExposed } = computeExposure(x, y, unionSet);
        tiles.push({ x, y, southExposed, eastExposed });
      }

      tiles.sort(depthSort);

      const config = {
        columnHeight: COLUMN_MAX_HEIGHT,
        southExposed: false,
        eastExposed: false,
        yOffset: REMEMBERED_YOFFSET,
      };

      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
        drawRememberedCapOnly(g, map, tile.x, tile.y, config);
      }
    },
    [map],
  );

  // ── Static layer: visible (stable visible tiles) ────────────────

  const drawStaticVisible = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();

      const tiles: TileEntry[] = [];

      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue;
        const x = tileKeyX(key);
        const y = tileKeyY(key);
        const { southExposed, eastExposed } = computeExposure(x, y, fogSt.visibleSet);
        tiles.push({ x, y, southExposed, eastExposed });
      }

      tiles.sort(depthSort);

      const config = {
        columnHeight: COLUMN_MAX_HEIGHT,
        southExposed: false,
        eastExposed: false,
        yOffset: 0,
      };

      for (const tile of tiles) {
        config.southExposed = tile.southExposed;
        config.eastExposed = tile.eastExposed;
        drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
        drawVisibleCapOnly(g, map, tile.x, tile.y, config);
      }
    },
    [map],
  );

  // ── Animation layer: only animating tiles ───────────────────────

  const drawAnimating = useCallback(
    (g: Graphics) => {
      g.clear();

      if (animatingTilesRef.current.size === 0) return;

      const tiles: TileEntry[] = [];
      for (const anim of animatingTilesRef.current.values()) {
        tiles.push({
          x: anim.x,
          y: anim.y,
          southExposed: anim.southExposed,
          eastExposed: anim.eastExposed,
          anim,
        });
      }

      tiles.sort(depthSort);

      for (const tile of tiles) {
        const anim = tile.anim!;
        const config = {
          columnHeight: anim.columnHeight,
          alpha: Math.max(0, Math.min(1, anim.alpha)),
          yOffset: anim.yOffset,
          southExposed: tile.southExposed,
          eastExposed: tile.eastExposed,
          lightLift: Math.max(0, anim.lightLift || 0),
        };

        let useRemembered = false;
        if (anim.type === 'revisit' && anim.paletteProgress < 0.5) {
          useRemembered = true;
        } else if (anim.type === 'conceal' && anim.paletteProgress >= 0.5) {
          useRemembered = true;
        }

        if (useRemembered) {
          drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
          drawRememberedCapOnly(g, map, tile.x, tile.y, config);
        } else {
          drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
          drawVisibleCapOnly(g, map, tile.x, tile.y, config);
        }
      }
    },
    [map],
  );

  // ── Redraw request functions ────────────────────────────────────

  /**
   * Request redraw of ONLY the animating layer.
   * Called by GSAP onUpdate — this is the hot path during animations.
   * Only ~20-40 animating tiles are redrawn per frame, not the entire map.
   */
  const requestAnimRedraw = useCallback((): void => {
    if (animRedrawRequestedRef.current) return;
    animRedrawRequestedRef.current = true;
    requestAnimationFrame(() => {
      animRedrawRequestedRef.current = false;
      if (animatingGRef.current) {
        drawAnimating(animatingGRef.current);
      }
    });
  }, [drawAnimating]);

  /**
   * Request redraw of both static layers AND the animating layer.
   * Called when fogState changes or when an animation completes
   * (tiles move from animating → static).
   */
  const requestStaticRedraw = useCallback((): void => {
    if (staticRedrawRequestedRef.current) return;
    staticRedrawRequestedRef.current = true;
    requestAnimationFrame(() => {
      staticRedrawRequestedRef.current = false;
      const currentFog = prevFogRef.current;
      if (!currentFog) return;
      if (rememberedGRef.current) {
        drawStaticRemembered(rememberedGRef.current, currentFog);
      }
      if (visibleGRef.current) {
        drawStaticVisible(visibleGRef.current, currentFog);
      }
      // Also redraw animating layer since the set of animating tiles changed
      if (animatingGRef.current) {
        drawAnimating(animatingGRef.current);
      }
    });
  }, [drawStaticRemembered, drawStaticVisible, drawAnimating]);

  // ── Tween management ────────────────────────────────────────────

  const removeTweenFromActive = (tween: gsap.core.Tween): void => {
    const idx = activeTweensRef.current.indexOf(tween);
    if (idx !== -1) {
      activeTweensRef.current.splice(idx, 1);
    }
  };

  const onFrontierAnimationComplete = useCallback((): void => {
    if (animatingTilesRef.current.size === 0) {
      // Animation sequence complete
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
        requestStaticRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        lightLift: 0,
        alpha: 1,
        duration,
        delay,
        ease: 'back.out(1.5)',
        onUpdate: requestAnimRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestAnimRedraw, requestStaticRedraw, onFrontierAnimationComplete],
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
        requestStaticRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: 0,
        lightLift: 0,
        paletteProgress: 1,
        duration,
        delay,
        ease: 'back.out(1.2)',
        onUpdate: requestAnimRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestAnimRedraw, requestStaticRedraw, onFrontierAnimationComplete],
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
        requestStaticRedraw();
        onFrontierAnimationComplete();
      };

      const tween = gsap.to(animState, {
        yOffset: SINK_OFFSET,
        paletteProgress: 1,
        alpha: 1,
        duration,
        delay,
        ease: 'power2.in',
        onUpdate: requestAnimRedraw,
        onComplete,
      });
      activeTweensRef.current.push(tween);
    },
    [requestAnimRedraw, requestStaticRedraw, onFrontierAnimationComplete],
  );

  // ── fogState change effect ──────────────────────────────────────

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    setupLayers(parent);

    if (!rememberedGRef.current || !animatingGRef.current || !visibleGRef.current) return;

    prevFogRef.current = fogState;

    // Redraw both static layers + animating layer
    requestStaticRedraw();

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
    setupLayers,
    requestStaticRedraw,
    animateRevealNew,
    animateRevealRevisit,
    animateConceal,
  ]);

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
