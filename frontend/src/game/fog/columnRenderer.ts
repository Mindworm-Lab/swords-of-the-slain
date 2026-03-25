/**
 * Column tile rendering primitives for the fog-of-war system.
 *
 * Each tile is drawn as a vertical column (top cap + south body face + east edge strip)
 * rather than a flat square. Side faces are **exposure-aware**: they only render when the
 * tile's edge is exposed to void (no visible neighbor in that direction).
 *
 * Interior tiles surrounded by other visible tiles render ONLY the top cap with bevels —
 * producing a perfectly seamless surface with no gaps or false seams.
 *
 * Exposed edge tiles show deep abyss shafts beneath, creating the visual of a floating
 * platform suspended over a cavernous void.
 *
 * All drawing functions are **pure** — they mutate only the Graphics object passed in.
 * Color math helpers are exported for testability.
 *
 * PixiJS v8 Graphics API: setFillStyle → rect/poly → fill (NOT beginFill/drawRect).
 */

import type { Graphics } from 'pixi.js';
import type { GameMap } from '../tilemap/types.ts';
import { TileType } from '../tilemap/types.ts';
import { TILE_SIZE } from '../tilemap/TilemapRenderer.tsx';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum column extrusion height in pixels (fully risen). Deep abyss shaft. */
export const COLUMN_MAX_HEIGHT = 56;

/** Remembered columns are shorter but still clearly present. */
export const COLUMN_REMEMBERED_HEIGHT = 20;

/** Width of the right-edge highlight strip on the column body. */
export const SIDE_STRIP_WIDTH = 3;

/** Number of depth-fade bands on the column body (more = smoother gradient). */
const BODY_BANDS = 10;

/** Height of the contact shadow strip at the base of the column body. */
const CONTACT_SHADOW_HEIGHT = 2;

// ── Visible palette ──────────────────────────────────────────────────────────

const FLOOR_TOP = 0x3a3a4a;
const FLOOR_BODY = 0x2a2a3a;
const WALL_TOP = 0x5a4a3a;
const WALL_BODY = 0x4a3a2a;
const ABYSS_COLOR = 0x0a0a12;

const VISIBLE_JITTER_AMP = 8;
const BEVEL_LIGHT_OFFSET = 20;
const BEVEL_DARK_OFFSET = -15;

// ── Remembered palette ───────────────────────────────────────────────────────

const REM_FLOOR_TOP = 0x252530;
const REM_FLOOR_BODY = 0x1a1a24;
const REM_WALL_TOP = 0x3a3228;
const REM_WALL_BODY = 0x2a2218;

const REMEMBERED_JITTER_AMP = 4;
const REM_BEVEL_LIGHT_OFFSET = 10;
const REM_BEVEL_DARK_OFFSET = -8;

// ── Color math helpers (exported for testing) ────────────────────────────────

/**
 * Deterministic per-tile color jitter.
 * Returns a small signed offset in [-amplitude, +amplitude].
 * Uses the same hash as TilemapRenderer for visual consistency.
 */
export function tileColorJitter(x: number, y: number, amplitude: number): number {
  let h = (x * 374_761 + y * 668_265) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return ((h & 0xff) / 255 - 0.5) * 2 * amplitude;
}

/** Clamp a number to the [0, 255] integer range. */
export function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Apply deterministic jitter to a packed 0xRRGGBB color.
 * The same (x, y) always produces the same result.
 */
export function jitterColor(base: number, x: number, y: number, amp: number): number {
  const j = tileColorJitter(x, y, amp);
  const r = clamp255(((base >> 16) & 0xff) + j);
  const g = clamp255(((base >> 8) & 0xff) + j);
  const b = clamp255((base & 0xff) + j);
  return (r << 16) | (g << 8) | b;
}

/**
 * Linearly interpolate between two packed 0xRRGGBB colors.
 * t=0 → a, t=1 → b, t=0.5 → midpoint.
 */
export function lerpColor(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const rr = clamp255(ar + (br - ar) * clamped);
  const rg = clamp255(ag + (bg - ag) * clamped);
  const rb = clamp255(ab + (bb - ab) * clamped);
  return (rr << 16) | (rg << 8) | rb;
}

/**
 * Adjust brightness of a packed 0xRRGGBB color by adding `offset` to each channel.
 * Positive = lighter, negative = darker. Channels are clamped to [0, 255].
 */
export function adjustBrightness(color: number, offset: number): number {
  const r = clamp255(((color >> 16) & 0xff) + offset);
  const g = clamp255(((color >> 8) & 0xff) + offset);
  const b = clamp255((color & 0xff) + offset);
  return (r << 16) | (g << 8) | b;
}

// ── Configuration interface ──────────────────────────────────────────────────

/** Configuration for column drawing. */
export interface ColumnConfig {
  /** Column extrusion height in pixels (0 = flat, COLUMN_MAX_HEIGHT = fully risen). */
  columnHeight: number;
  /** Opacity of the entire column (0-1). Used during fade portions of animation. */
  alpha?: number;
  /** True if the tile's south edge is exposed to void (no visible neighbor below). */
  southExposed?: boolean;
  /** True if the tile's east edge is exposed to void (no visible neighbor to the right). */
  eastExposed?: boolean;
}

// ── Internal drawing helpers ─────────────────────────────────────────────────

/** Color set resolved for a single tile. */
interface TileColors {
  top: number;
  body: number;
  abyss: number;
  bevelLight: number;
  bevelDark: number;
}

/** Resolve tile colors for visible state. */
function visibleColors(tileType: TileType, x: number, y: number): TileColors {
  const isWall = tileType === TileType.Wall;
  const topBase = isWall ? WALL_TOP : FLOOR_TOP;
  const bodyBase = isWall ? WALL_BODY : FLOOR_BODY;

  const top = jitterColor(topBase, x, y, VISIBLE_JITTER_AMP);
  const body = jitterColor(bodyBase, x, y, VISIBLE_JITTER_AMP);
  return {
    top,
    body,
    abyss: ABYSS_COLOR,
    bevelLight: adjustBrightness(top, BEVEL_LIGHT_OFFSET),
    bevelDark: adjustBrightness(top, BEVEL_DARK_OFFSET),
  };
}

/** Resolve tile colors for remembered state. */
function rememberedColors(tileType: TileType, x: number, y: number): TileColors {
  const isWall = tileType === TileType.Wall;
  const topBase = isWall ? REM_WALL_TOP : REM_FLOOR_TOP;
  const bodyBase = isWall ? REM_WALL_BODY : REM_FLOOR_BODY;

  const top = jitterColor(topBase, x, y, REMEMBERED_JITTER_AMP);
  const body = jitterColor(bodyBase, x, y, REMEMBERED_JITTER_AMP);
  return {
    top,
    body,
    abyss: ABYSS_COLOR,
    bevelLight: adjustBrightness(top, REM_BEVEL_LIGHT_OFFSET),
    bevelDark: adjustBrightness(top, REM_BEVEL_DARK_OFFSET),
  };
}

/**
 * Draw a column at an arbitrary pixel origin (ox, oy).
 *
 * Side faces (south body, east strip) are **exposure-aware**: they only render
 * when the corresponding exposure flag is true. Interior tiles with no exposed
 * edges render ONLY the top cap with bevel highlights — a perfectly seamless surface.
 *
 * Drawing order (back to front):
 *   1. Column body (south face extrusion) — only if southExposed
 *   2. Right-edge strip on body — only if eastExposed
 *   3. Contact shadow at body base — only if southExposed
 *   4. Top cap (the main tile surface) — ALWAYS
 *   5. Bevel highlights on top cap edges — ALWAYS
 */
function drawColumn(
  g: Graphics,
  ox: number,
  oy: number,
  colors: TileColors,
  config: ColumnConfig,
): void {
  const { columnHeight, alpha = 1, southExposed = false, eastExposed = false } = config;
  const h = Math.max(0, Math.round(columnHeight));

  // ── 1. Column body (south face) with depth-fade bands ── only if exposed
  if (h > 0 && southExposed) {
    const bands = Math.min(BODY_BANDS, h); // don't draw more bands than pixels
    const bandH = h / bands;

    for (let i = 0; i < bands; i++) {
      // t goes from 0 (top of body, just below cap) to 1 (bottom, deepest)
      const t = (i + 0.5) / bands;
      const bandColor = lerpColor(colors.body, colors.abyss, t * 0.95);
      const by = oy + TILE_SIZE + i * bandH;

      g.setFillStyle({ color: bandColor, alpha });
      g.rect(ox, by, TILE_SIZE, Math.ceil(bandH));
      g.fill();
    }
  }

  // ── 2. Right-edge strip on body (slightly lighter, second face cue) ── only if exposed
  if (h > 0 && eastExposed) {
    const stripBands = Math.min(BODY_BANDS, h);
    const stripBandH = h / stripBands;
    for (let i = 0; i < stripBands; i++) {
      const t = (i + 0.5) / stripBands;
      const baseBodyColor = lerpColor(colors.body, colors.abyss, t * 0.95);
      const stripColor = adjustBrightness(baseBodyColor, 8);
      const by = oy + TILE_SIZE + i * stripBandH;

      g.setFillStyle({ color: stripColor, alpha });
      g.rect(ox + TILE_SIZE - SIDE_STRIP_WIDTH, by, SIDE_STRIP_WIDTH, Math.ceil(stripBandH));
      g.fill();
    }
  }

  // ── 3. Contact shadow at body base ── only if south face is exposed
  if (h > 0 && southExposed) {
    const shadowH = Math.min(CONTACT_SHADOW_HEIGHT, h);
    const shadowColor = lerpColor(colors.abyss, 0x000000, 0.5);
    g.setFillStyle({ color: shadowColor, alpha });
    g.rect(ox, oy + TILE_SIZE + h - shadowH, TILE_SIZE, shadowH);
    g.fill();
  }

  // ── 4. Top cap ── ALWAYS drawn at (ox, oy), pinned in place
  g.setFillStyle({ color: colors.top, alpha });
  g.rect(ox, oy, TILE_SIZE, TILE_SIZE);
  g.fill();

  // ── 5. Bevel highlights ── ALWAYS drawn
  // Top edge (light, 2px)
  g.setFillStyle({ color: colors.bevelLight, alpha });
  g.rect(ox, oy, TILE_SIZE, 2);
  g.fill();

  // Left edge (light, 2px)
  g.setFillStyle({ color: colors.bevelLight, alpha });
  g.rect(ox, oy, 2, TILE_SIZE);
  g.fill();

  // Bottom edge (dark, 1px)
  g.setFillStyle({ color: colors.bevelDark, alpha });
  g.rect(ox, oy + TILE_SIZE - 1, TILE_SIZE, 1);
  g.fill();

  // Right edge (dark, 1px)
  g.setFillStyle({ color: colors.bevelDark, alpha });
  g.rect(ox + TILE_SIZE - 1, oy, 1, TILE_SIZE);
  g.fill();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Draw a **visible-state** column tile into a Graphics object at **world coordinates**.
 *
 * The tile at grid position (x, y) is drawn at pixel position
 * (x * TILE_SIZE, y * TILE_SIZE). Suitable for batched rendering
 * where many tiles share a single Graphics object.
 *
 * Side faces only render when `southExposed` / `eastExposed` are true in config.
 * Interior tiles with no exposed edges render only the top cap + bevels.
 */
export function drawVisibleColumn(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const idx = y * map.width + x;
  const tileType = map.tiles[idx] ?? TileType.Floor;
  const colors = visibleColors(tileType, x, y);
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  drawColumn(g, px, py, colors, config);
}

/**
 * Draw a **remembered-state** column tile into a Graphics object at **world coordinates**.
 *
 * Uses a desaturated / darkened palette to indicate the tile is no longer
 * in the player's current field of view but has been seen before.
 *
 * Side faces only render when `southExposed` / `eastExposed` are true in config.
 */
export function drawRememberedColumn(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const idx = y * map.width + x;
  const tileType = map.tiles[idx] ?? TileType.Floor;
  const colors = rememberedColors(tileType, x, y);
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  drawColumn(g, px, py, colors, config);
}

/**
 * Draw a **visible-state** column tile at **local (0,0) origin**.
 *
 * For individual tile Graphics objects that are positioned via
 * container.x/y (e.g., frontier animation tiles managed by GSAP).
 *
 * Side faces only render when `southExposed` / `eastExposed` are true in config.
 */
export function drawVisibleColumnLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const idx = y * map.width + x;
  const tileType = map.tiles[idx] ?? TileType.Floor;
  const colors = visibleColors(tileType, x, y);
  drawColumn(g, 0, 0, colors, config);
}

/**
 * Draw a **remembered-state** column tile at **local (0,0) origin**.
 *
 * For individual tile Graphics objects positioned via container transform.
 *
 * Side faces only render when `southExposed` / `eastExposed` are true in config.
 */
export function drawRememberedColumnLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const idx = y * map.width + x;
  const tileType = map.tiles[idx] ?? TileType.Floor;
  const colors = rememberedColors(tileType, x, y);
  drawColumn(g, 0, 0, colors, config);
}
