import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
import { tileKey } from './los.ts';
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

// ── Exposure helpers ────────────────────────────────────────────────

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

export interface FogOfWarRendererProps {
  map: GameMap;
  fogState: FogState;
}

export function FogOfWarRenderer({
  map,
  fogState,
}: FogOfWarRendererProps): React.JSX.Element {
  const containerRef = useRef<Container | null>(null);
  const mainGraphicsRef = useRef<Graphics | null>(null);

  const activeTweensRef = useRef<gsap.core.Tween[]>([]);
  const animatingTilesRef = useRef<Map<string, AnimState>>(new Map());
  const prevFogRef = useRef<FogState | null>(null);
  
  const redrawRequestedRef = useRef(false);

  const setupLayers = useCallback((parentContainer: Container) => {
    if (mainGraphicsRef.current) return;

    const mainG = new Graphics();
    parentContainer.addChild(mainG);
    mainGraphicsRef.current = mainG;
  }, []);

  const drawAllTiles = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();

      const unionSet = new Set(fogSt.exploredSet);
      for (const key of fogSt.visibleSet) {
        unionSet.add(key);
      }

      const tiles: {
        x: number;
        y: number;
        state: 'visible' | 'remembered' | 'animating';
        anim?: AnimState;
        southExposed: boolean;
        eastExposed: boolean;
      }[] = [];

      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue;
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, fogSt.visibleSet);
        tiles.push({ x, y, state: 'visible', southExposed, eastExposed });
      }

      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue;
        if (animatingTilesRef.current.has(key)) continue;
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const { southExposed, eastExposed } = computeExposure(x, y, unionSet);
        tiles.push({ x, y, state: 'remembered', southExposed, eastExposed });
      }

      for (const anim of animatingTilesRef.current.values()) {
        tiles.push({
          x: anim.x,
          y: anim.y,
          state: 'animating',
          anim,
          southExposed: anim.southExposed,
          eastExposed: anim.eastExposed,
        });
      }

      // Sort all tiles together by isometric depth (x + y)
      tiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.y - b.y || a.x - b.x);

      // Single Pass: Shaft then Cap for each tile
      for (const tile of tiles) {
        let config;
        let useRemembered = false;

        if (tile.state === 'visible') {
          config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: 0,
          };
          useRemembered = false;
        } else if (tile.state === 'remembered') {
          config = {
            columnHeight: COLUMN_MAX_HEIGHT,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            yOffset: REMEMBERED_YOFFSET,
          };
          useRemembered = true;
        } else if (tile.state === 'animating' && tile.anim) {
          config = {
            columnHeight: tile.anim.columnHeight,
            alpha: Math.max(0, Math.min(1, tile.anim.alpha)),
            yOffset: tile.anim.yOffset,
            southExposed: tile.southExposed,
            eastExposed: tile.eastExposed,
            lightLift: tile.anim.lightLift || 0,
          };
          if (tile.anim.type === 'revisit' && tile.anim.paletteProgress < 0.5) {
            useRemembered = true;
          } else if (tile.anim.type === 'conceal' && tile.anim.paletteProgress >= 0.5) {
            useRemembered = true;
          }
        }

        if (config) {
          if (useRemembered) {
            drawRememberedShaftOnly(g, map, tile.x, tile.y, config);
            drawRememberedCapOnly(g, map, tile.x, tile.y, config);
          } else {
            drawVisibleShaftOnly(g, map, tile.x, tile.y, config);
            drawVisibleCapOnly(g, map, tile.x, tile.y, config);
          }
        }
      }
    },
    [map],
  );

  const requestRedraw = useCallback((): void => {
    if (redrawRequestedRef.current) return;
    redrawRequestedRef.current = true;
    requestAnimationFrame(() => {
      redrawRequestedRef.current = false;
      const currentFog = prevFogRef.current;
      if (!currentFog) return;
      if (mainGraphicsRef.current) {
        drawAllTiles(mainGraphicsRef.current, currentFog);
      }
    });
  }, [drawAllTiles]);

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



  const animateRevealNew = useCallback(
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<string>) => {
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
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<string>) => {
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
    (x: number, y: number, playerX: number, playerY: number, visibleSet: Set<string>) => {
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

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    setupLayers(parent);

    const mainG = mainGraphicsRef.current;
    if (!mainG) return;

    prevFogRef.current = fogState;

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
    setupLayers,
    requestRedraw,
    animateRevealNew,
    animateRevealRevisit,
    animateConceal,
  ]);

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
