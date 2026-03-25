/**
 * FogOfWarRenderer — PixiJS fog-of-war renderer with per-tile reveal/conceal animations.
 *
 * Architecture:
 *   <pixiContainer> (camera offset applied by parent)
 *     ├── Remembered Layer: explored-but-not-visible tiles, rendered dimmed (~40% opacity)
 *     ├── Visible Layer: currently visible tiles, full brightness
 *     ├── Frontier Layer: tiles entering/exiting visibility, animated with GSAP tweens
 *     └── Player sprite (rendered by parent, on top)
 *
 * Performance strategy:
 * - Stable visible and remembered tiles use batched Graphics (one draw call each).
 * - ONLY frontier tiles (entering/exiting ~20-40) get individual Graphics for animation.
 * - After a frontier tile's animation completes, the tile transfers to a batched layer.
 *
 * Transition modes:
 * - "rise": vertical translation + alpha + scale (default, Rogue Wizards feel)
 * - "fade": pure alpha transition, no position change
 * - "grow": scale from 0.3→1.0 + alpha on reveal, reverse on conceal (pop-in feel)
 *
 * A NoiseFilter is applied to the frontier container, giving the visibility
 * boundary a subtle computational shimmer. The noise seed is continuously
 * animated via GSAP so the edge feels alive rather than mechanically crisp.
 */

import { useRef, useCallback, useEffect } from 'react';
import { Container, Graphics, NoiseFilter } from 'pixi.js';
import { gsap } from 'gsap';
import type { GameMap } from '../tilemap/types.ts';
import { TileType } from '../tilemap/types.ts';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';
import { tileKey } from './los.ts';
import type { FogState } from './useFogOfWar.ts';

// ── Transition mode ─────────────────────────────────────────────────
/** Animation mode for tile transitions. */
export type TransitionMode = 'rise' | 'fade' | 'grow';

// ── Color palette ───────────────────────────────────────────────────

/** Visible tile colors (full brightness). */
const FLOOR_BASE = 0x3a3a4a;
const FLOOR_JITTER = 8;
const WALL_BASE = 0x5a4a3a;
const WALL_JITTER = 6;
const WALL_TOP_HIGHLIGHT = 0x6a5a4a;

/** Remembered tile colors (dimmed, desaturated). */
const REMEMBERED_FLOOR_BASE = 0x252530;
const REMEMBERED_FLOOR_JITTER = 4;
const REMEMBERED_WALL_BASE = 0x3a3228;
const REMEMBERED_WALL_JITTER = 3;
const REMEMBERED_WALL_HIGHLIGHT = 0x44392e;

/** Opacity for remembered tiles. */
const REMEMBERED_ALPHA = 0.45;

// ── Animation constants ─────────────────────────────────────────────

/** Base duration for reveal/conceal animations in seconds. */
const BASE_DURATION = 0.4;
/** Maximum random duration variance in seconds (±). */
const DURATION_VARIANCE = 0.05;
/** Maximum random stagger delay in seconds. */
const MAX_STAGGER = 0.15;
/** Vertical offset (px) for rise/fall animation. */
const RISE_OFFSET = 20;
/** Scale at start of reveal animation (rise mode). */
const REVEAL_START_SCALE = 0.8;
/** Scale at start of reveal animation (grow mode). */
const GROW_START_SCALE = 0.3;
/** Scale at end of conceal animation (grow mode). */
const GROW_END_SCALE = 0.3;

// ── Color utilities ─────────────────────────────────────────────────

/** Deterministic per-tile color jitter. Returns offset in [-amplitude, +amplitude]. */
function tileColorJitter(x: number, y: number, amplitude: number): number {
  let h = (x * 374_761 + y * 668_265) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return ((h & 0xff) / 255 - 0.5) * 2 * amplitude;
}

/** Clamp a value to [0, 255]. */
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Add jitter to an RGB color packed as 0xRRGGBB. */
function jitterColor(base: number, x: number, y: number, amp: number): number {
  const j = tileColorJitter(x, y, amp);
  const r = clamp255(((base >> 16) & 0xff) + j);
  const g = clamp255(((base >> 8) & 0xff) + j);
  const b = clamp255((base & 0xff) + j);
  return (r << 16) | (g << 8) | b;
}

// ── Tile drawing helpers ────────────────────────────────────────────

/** Get the tile type at (x, y) from the map. */
function getTileType(map: GameMap, x: number, y: number): TileType | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

/** Draw a single tile into a Graphics object (visible style). */
function drawVisibleTile(g: Graphics, map: GameMap, x: number, y: number): void {
  const tileType = getTileType(map, x, y);
  if (tileType === undefined) return;

  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  if (tileType === TileType.Floor) {
    const color = jitterColor(FLOOR_BASE, x, y, FLOOR_JITTER);
    g.setFillStyle({ color });
    g.rect(px, py, TILE_SIZE, TILE_SIZE);
    g.fill();
  } else {
    // Wall body
    const color = jitterColor(WALL_BASE, x, y, WALL_JITTER);
    g.setFillStyle({ color });
    g.rect(px, py, TILE_SIZE, TILE_SIZE);
    g.fill();
    // Top highlight
    const highlight = jitterColor(WALL_TOP_HIGHLIGHT, x, y, WALL_JITTER);
    g.setFillStyle({ color: highlight });
    g.rect(px, py, TILE_SIZE, 2);
    g.fill();
  }
}

/** Draw a single tile into a Graphics object (remembered/dimmed style). */
function drawRememberedTile(g: Graphics, map: GameMap, x: number, y: number): void {
  const tileType = getTileType(map, x, y);
  if (tileType === undefined) return;

  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  if (tileType === TileType.Floor) {
    const color = jitterColor(REMEMBERED_FLOOR_BASE, x, y, REMEMBERED_FLOOR_JITTER);
    g.setFillStyle({ color });
    g.rect(px, py, TILE_SIZE, TILE_SIZE);
    g.fill();
  } else {
    const color = jitterColor(REMEMBERED_WALL_BASE, x, y, REMEMBERED_WALL_JITTER);
    g.setFillStyle({ color });
    g.rect(px, py, TILE_SIZE, TILE_SIZE);
    g.fill();
    // Subtle highlight
    const highlight = jitterColor(REMEMBERED_WALL_HIGHLIGHT, x, y, REMEMBERED_WALL_JITTER);
    g.setFillStyle({ color: highlight });
    g.rect(px, py, TILE_SIZE, 2);
    g.fill();
  }
}

/**
 * Draw a single tile into an individual Graphics object for animation.
 * The Graphics is positioned at (0,0) — parent container handles tile offset.
 */
function drawTileOnGraphics(g: Graphics, map: GameMap, x: number, y: number, remembered: boolean): void {
  g.clear();
  if (remembered) {
    drawRememberedTileLocal(g, map, x, y);
  } else {
    drawVisibleTileLocal(g, map, x, y);
  }
}

/** Draw a visible tile at local (0,0) origin. */
function drawVisibleTileLocal(g: Graphics, map: GameMap, x: number, y: number): void {
  const tileType = getTileType(map, x, y);
  if (tileType === undefined) return;

  if (tileType === TileType.Floor) {
    const color = jitterColor(FLOOR_BASE, x, y, FLOOR_JITTER);
    g.setFillStyle({ color });
    g.rect(0, 0, TILE_SIZE, TILE_SIZE);
    g.fill();
  } else {
    const color = jitterColor(WALL_BASE, x, y, WALL_JITTER);
    g.setFillStyle({ color });
    g.rect(0, 0, TILE_SIZE, TILE_SIZE);
    g.fill();
    const highlight = jitterColor(WALL_TOP_HIGHLIGHT, x, y, WALL_JITTER);
    g.setFillStyle({ color: highlight });
    g.rect(0, 0, TILE_SIZE, 2);
    g.fill();
  }
}

/** Draw a remembered tile at local (0,0) origin. */
function drawRememberedTileLocal(g: Graphics, map: GameMap, x: number, y: number): void {
  const tileType = getTileType(map, x, y);
  if (tileType === undefined) return;

  if (tileType === TileType.Floor) {
    const color = jitterColor(REMEMBERED_FLOOR_BASE, x, y, REMEMBERED_FLOOR_JITTER);
    g.setFillStyle({ color });
    g.rect(0, 0, TILE_SIZE, TILE_SIZE);
    g.fill();
  } else {
    const color = jitterColor(REMEMBERED_WALL_BASE, x, y, REMEMBERED_WALL_JITTER);
    g.setFillStyle({ color });
    g.rect(0, 0, TILE_SIZE, TILE_SIZE);
    g.fill();
    const highlight = jitterColor(REMEMBERED_WALL_HIGHLIGHT, x, y, REMEMBERED_WALL_JITTER);
    g.setFillStyle({ color: highlight });
    g.rect(0, 0, TILE_SIZE, 2);
    g.fill();
  }
}

// ── Props ───────────────────────────────────────────────────────────

/** Props for FogOfWarRenderer. */
export interface FogOfWarRendererProps {
  /** The game map to render. */
  map: GameMap;
  /** Current fog-of-war state from useFogOfWar. */
  fogState: FogState;
  /** Animation transition mode. Default: 'rise'. */
  transitionMode?: TransitionMode;
}

/**
 * Compute stagger delay for a tile based on distance from player.
 * Tiles closer to the player animate sooner, creating a ripple outward.
 */
function computeStaggerDelay(
  tileX: number,
  tileY: number,
  playerX: number,
  playerY: number,
  maxDelay: number,
): number {
  const dx = tileX - playerX;
  const dy = tileY - playerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Normalize distance (vision radius ~10 tiles)
  const normalizedDist = Math.min(dist / 12, 1);
  // Closer tiles get shorter delay + random jitter
  const baseDelay = normalizedDist * maxDelay * 0.7;
  const jitter = Math.random() * maxDelay * 0.3;
  return baseDelay + jitter;
}

/** Compute a slightly randomized animation duration. */
function computeDuration(): number {
  return BASE_DURATION + (Math.random() - 0.5) * 2 * DURATION_VARIANCE;
}

/**
 * FogOfWarRenderer — Renders the map with fog-of-war, including animated
 * per-tile reveal/conceal transitions at the visibility frontier.
 *
 * Uses an imperative approach: a Container ref manages three sub-containers
 * (remembered, visible, frontier) and directly creates/removes PixiJS objects
 * for animated frontier tiles.
 */
export function FogOfWarRenderer({
  map,
  fogState,
  transitionMode = 'rise',
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
    rememberedG.alpha = REMEMBERED_ALPHA;
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

  // Draw all remembered (explored but not visible) tiles as a batch
  const drawRememberedBatch = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      for (const key of fogSt.exploredSet) {
        if (fogSt.visibleSet.has(key)) continue; // Skip currently visible
        if (animatingTilesRef.current.has(key)) continue; // Skip animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        drawRememberedTile(g, map, x, y);
      }
    },
    [map],
  );

  /**
   * Animate a tile reveal (entering visibility).
   * Creates an individual Graphics for the tile, animates it with GSAP,
   * then removes it and redraws the batched visible layer.
   */
  const animateReveal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      mode: TransitionMode,
      frontierContainer: Container,
    ) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;
      animatingTilesRef.current.add(key);

      const tileG = new Graphics();
      drawTileOnGraphics(tileG, map, x, y, false);

      const targetPx = x * TILE_SIZE;
      const targetPy = y * TILE_SIZE;

      if (mode === 'rise') {
        tileG.x = targetPx;
        tileG.y = targetPy + RISE_OFFSET;
        tileG.alpha = 0;
        tileG.scale.set(REVEAL_START_SCALE);
      } else if (mode === 'grow') {
        tileG.x = targetPx + TILE_SIZE * (1 - GROW_START_SCALE) / 2;
        tileG.y = targetPy + TILE_SIZE * (1 - GROW_START_SCALE) / 2;
        tileG.alpha = 0;
        tileG.scale.set(GROW_START_SCALE);
        tileG.pivot.set(0, 0);
      } else {
        // fade mode
        tileG.x = targetPx;
        tileG.y = targetPy;
        tileG.alpha = 0;
      }

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

      let tweenProps: gsap.TweenVars;

      if (mode === 'rise') {
        tweenProps = {
          x: targetPx,
          y: targetPy,
          alpha: 1,
          duration,
          delay,
          ease: 'power2.out',
          onComplete: onRevealComplete,
          pixi: { scaleX: 1, scaleY: 1 },
        };
      } else if (mode === 'grow') {
        tweenProps = {
          x: targetPx,
          y: targetPy,
          alpha: 1,
          duration,
          delay,
          ease: 'back.out(1.4)',
          onComplete: onRevealComplete,
          pixi: { scaleX: 1, scaleY: 1 },
        };
      } else {
        // fade
        tweenProps = {
          alpha: 1,
          duration,
          delay,
          ease: 'power2.out',
          onComplete: onRevealComplete,
        };
      }

      const tween = gsap.to(tileG, tweenProps);
      activeTweensRef.current.push(tween);
    },
    [map],
  );

  /**
   * Animate a tile conceal (exiting visibility).
   * Creates an individual Graphics in visible style, animates to hidden,
   * then transfers to remembered layer.
   */
  const animateConceal = useCallback(
    (
      x: number,
      y: number,
      playerX: number,
      playerY: number,
      mode: TransitionMode,
      frontierContainer: Container,
    ) => {
      const key = tileKey(x, y);
      if (animatingTilesRef.current.has(key)) return;
      animatingTilesRef.current.add(key);

      const tileG = new Graphics();
      drawTileOnGraphics(tileG, map, x, y, false);

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      tileG.x = px;
      tileG.y = py;
      tileG.alpha = 1;

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

      let tweenProps: gsap.TweenVars;

      if (mode === 'rise') {
        tweenProps = {
          y: py + RISE_OFFSET,
          alpha: 0,
          duration,
          delay,
          ease: 'power2.in',
          onComplete: onConcealComplete,
        };
      } else if (mode === 'grow') {
        tweenProps = {
          x: px + TILE_SIZE * (1 - GROW_END_SCALE) / 2,
          y: py + TILE_SIZE * (1 - GROW_END_SCALE) / 2,
          alpha: 0,
          duration,
          delay,
          ease: 'power2.in',
          pixi: { scaleX: GROW_END_SCALE, scaleY: GROW_END_SCALE },
          onComplete: onConcealComplete,
        };
      } else {
        // fade
        tweenProps = {
          alpha: 0,
          duration,
          delay,
          ease: 'power2.in',
          onComplete: onConcealComplete,
        };
      }

      const tween = gsap.to(tileG, tweenProps);
      activeTweensRef.current.push(tween);
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
  const requestRedrawBatched = (): void => {
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
        drawVisibleBatchWithEntering(visibleGraphicsRef.current, currentFog);
      }
    });
  };

  /**
   * Draw visible batch including entering tiles that finished animating
   * (they're in visibleSet and stable, or their animation completed).
   */
  const drawVisibleBatchWithEntering = useCallback(
    (g: Graphics, fogSt: FogState) => {
      g.clear();
      for (const key of fogSt.visibleSet) {
        if (animatingTilesRef.current.has(key)) continue; // Still animating
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        drawVisibleTile(g, map, x, y);
      }
    },
    [map],
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
    drawVisibleBatchWithEntering(visibleG, fogState);

    // Animate entering tiles (reveal)
    for (const tile of fogState.entering) {
      animateReveal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        transitionMode,
        frontierC,
      );
    }

    // Animate exiting tiles (conceal)
    for (const tile of fogState.exiting) {
      animateConceal(
        tile[0],
        tile[1],
        fogState.playerX,
        fogState.playerY,
        transitionMode,
        frontierC,
      );
    }
  }, [
    fogState,
    transitionMode,
    setupLayers,
    drawRememberedBatch,
    drawVisibleBatchWithEntering,
    animateReveal,
    animateConceal,
  ]);

  // Cleanup: kill all active tweens on unmount
  useEffect(() => {
    return () => {
      for (const tween of activeTweensRef.current) {
        tween.kill();
      }
      activeTweensRef.current = [];
      animatingTilesRef.current.clear();
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
