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
 * Exposed edge tiles show deep abyss shafts beneath with continuous volumetric descent:
 * smooth value falloff, cool hue drift, atmospheric softening, hard abyssal occlusion,
 * and subtle material texture — creating the visual of a floating platform suspended
 * over a cavernous void.
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

/**
 * Remembered columns use the SAME shaft depth as visible columns.
 * Visual distinction is communicated through palette (darker/desaturated) and
 * a small yOffset (slight downward displacement) — NOT shaft height.
 * Uniform shaft depth eliminates false z-level illusions where remembered tiles
 * appear to sit on a different plane than visible tiles.
 */
export const COLUMN_REMEMBERED_HEIGHT = COLUMN_MAX_HEIGHT;

/** Width of the right-edge highlight strip on the column body. */
export const SIDE_STRIP_WIDTH = 3;

/**
 * Height of each volumetric strip in pixels.
 * Strips replace the old discrete band system for continuous depth rendering.
 * 3px gives smooth results while keeping draw calls reasonable.
 */
export const STRIP_HEIGHT = 3;

/** Height of the contact shadow strip at the base of the column body. */
const CONTACT_SHADOW_HEIGHT = 2;

// ── Volumetric depth parameters ──────────────────────────────────────────────

/** Maximum blue channel drift at full depth (cool blue-violet shift). */
const HUE_DRIFT_BLUE = 15;

/** Maximum red channel reduction at full depth. */
const HUE_DRIFT_RED = -8;

/** Maximum green channel reduction at full depth. */
const HUE_DRIFT_GREEN = -4;

/** Start of atmospheric softening zone (fraction of shaft depth). */
const ATMO_START = 0.4;

/** End of atmospheric softening zone (fraction of shaft depth). */
const ATMO_END = 0.75;

/** Maximum brightness bump in the atmospheric softening zone. */
const ATMO_BRIGHTNESS = 4;

/** Saturation reduction factor in the atmospheric softening zone (0-1). */
const ATMO_DESAT = 0.15;

/** Depth fraction where hard abyssal occlusion begins. */
const ABYSS_OCCLUSION_START = 0.85;

/** Material texture noise amplitude (±brightness per row). */
const TEXTURE_NOISE_AMP = 3;

// ── Visible palette ──────────────────────────────────────────────────────────

const FLOOR_TOP = 0x3a3a4a;
const FLOOR_BODY = 0x2a2a3a;
const WALL_TOP = 0x5a4a3a;
const WALL_BODY = 0x4a3a2a;

/** Deepest shaft color — used at the bottom of column body faces. */
export const ABYSS_COLOR = 0x0a0a12;

/** True abyss background — darker than shaft abyss, for stage/canvas bg. */
export const ABYSS_BG_COLOR = 0x06060c;

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

/**
 * Deterministic per-row material noise.
 * Returns a small signed offset in [-amp, +amp] based on tile (x, y) and row index.
 * Uses a different hash seed from tileColorJitter to avoid correlation.
 */
export function rowNoise(x: number, y: number, row: number, amp: number): number {
  if (amp === 0) return 0;
  let h = (x * 198_491 + y * 781_559 + row * 456_853) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return ((h & 0xff) / 255 - 0.5) * 2 * amp;
}

/**
 * Compute the volumetric color for a shaft strip at a given depth fraction.
 *
 * Applies five depth cue families in sequence:
 * 1. **Continuous value falloff** — smooth lerp from body color to abyss
 * 2. **Cool hue drift** — shift toward blue-violet as depth increases
 * 3. **Atmospheric softening** — slight desaturation + brightness in mid-lower range
 * 4. **Hard abyssal occlusion** — aggressive darkening in the bottom 15%
 * 5. **Material texture** — per-row deterministic noise for stone/earth feel
 *
 * @param bodyColor Base body color for the tile
 * @param abyssColor Target abyss color
 * @param t Depth fraction (0 = top of shaft, 1 = bottom)
 * @param tileX Tile grid X for deterministic noise
 * @param tileY Tile grid Y for deterministic noise
 * @param stripIndex Strip index for per-row noise variation
 */
export function volumetricStripColor(
  bodyColor: number,
  abyssColor: number,
  t: number,
  tileX: number,
  tileY: number,
  stripIndex: number,
): number {
  // 1. Continuous value falloff — slightly ease-in for more natural recession
  const falloffT = t * t * 0.6 + t * 0.4; // blend between linear and quadratic
  const color = lerpColor(bodyColor, abyssColor, falloffT);

  let r = (color >> 16) & 0xff;
  let g = (color >> 8) & 0xff;
  let b = color & 0xff;

  // 2. Hue drift toward cool blue-violet
  r = clamp255(r + HUE_DRIFT_RED * t);
  g = clamp255(g + HUE_DRIFT_GREEN * t);
  b = clamp255(b + HUE_DRIFT_BLUE * t);

  // 3. Atmospheric softening in the mid-lower range
  if (t >= ATMO_START && t <= ATMO_END) {
    const atmoT = (t - ATMO_START) / (ATMO_END - ATMO_START);
    // Bell-shaped: peak at center of atmospheric band
    const atmoStrength = Math.sin(atmoT * Math.PI);

    // Slight brightness bump (mist/haze)
    const brightBump = ATMO_BRIGHTNESS * atmoStrength;
    r = clamp255(r + brightBump);
    g = clamp255(g + brightBump);
    b = clamp255(b + brightBump);

    // Desaturation: push channels toward their average
    const avg = (r + g + b) / 3;
    const desatAmount = ATMO_DESAT * atmoStrength;
    r = clamp255(r + (avg - r) * desatAmount);
    g = clamp255(g + (avg - g) * desatAmount);
    b = clamp255(b + (avg - b) * desatAmount);
  }

  // 4. Hard abyssal occlusion in the bottom 15%
  if (t >= ABYSS_OCCLUSION_START) {
    const occT = (t - ABYSS_OCCLUSION_START) / (1 - ABYSS_OCCLUSION_START);
    // Aggressive power curve for hard darkening
    const occFactor = occT * occT;
    const nearBlack = 0x020204;
    const nr = (nearBlack >> 16) & 0xff;
    const ng = (nearBlack >> 8) & 0xff;
    const nb = nearBlack & 0xff;
    r = clamp255(r + (nr - r) * occFactor);
    g = clamp255(g + (ng - g) * occFactor);
    b = clamp255(b + (nb - b) * occFactor);
  }

  // 5. Material texture — subtle per-row noise
  const noise = rowNoise(tileX, tileY, stripIndex, TEXTURE_NOISE_AMP);
  r = clamp255(r + noise);
  g = clamp255(g + noise);
  b = clamp255(b + noise);

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
  /**
   * Vertical offset below authored height in pixels.
   * 0 = cap at authored position, positive = cap displaced downward.
   * Used for cap-rise animation: start with large yOffset, animate toward 0.
   * The shaft always hangs below the cap, so the entire column shifts down.
   */
  yOffset?: number;
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

/**
 * Calculate the number of strips needed for a given shaft height.
 * Ensures at least 1 strip for any non-zero height.
 */
function stripCount(h: number): number {
  if (h <= 0) return 0;
  return Math.max(1, Math.ceil(h / STRIP_HEIGHT));
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
 * Draw ONLY the shaft (south body face + east strip + contact shadow) of a column.
 *
 * Used for two-pass rendering: draw all shafts first (back-to-front),
 * then all caps, to prevent occlusion leaks.
 *
 * The shaft uses continuous volumetric strips instead of discrete bands:
 * each strip gets per-pixel-row interpolated color with hue drift,
 * atmospheric softening, abyssal occlusion, and material texture.
 */
export function drawColumnShaftOnly(
  g: Graphics,
  ox: number,
  oy: number,
  colors: TileColors,
  config: ColumnConfig,
  tileX: number,
  tileY: number,
): void {
  const { columnHeight, alpha = 1, southExposed = false, eastExposed = false, yOffset = 0 } = config;
  const h = Math.max(0, Math.round(columnHeight));
  const capY = oy + yOffset;

  // ── South body face with volumetric strips ── only if exposed
  if (h > 0 && southExposed) {
    const strips = stripCount(h);
    const stripH = h / strips;

    for (let i = 0; i < strips; i++) {
      const t = (i + 0.5) / strips;
      const color = volumetricStripColor(colors.body, colors.abyss, t, tileX, tileY, i);
      const by = capY + TILE_SIZE + i * stripH;

      g.setFillStyle({ color, alpha });
      g.rect(ox, by, TILE_SIZE, Math.ceil(stripH));
      g.fill();
    }
  }

  // ── East strip with volumetric strips (slightly brighter, second face) ── only if exposed
  if (h > 0 && eastExposed) {
    const strips = stripCount(h);
    const stripH = h / strips;

    for (let i = 0; i < strips; i++) {
      const t = (i + 0.5) / strips;
      const baseColor = volumetricStripColor(colors.body, colors.abyss, t, tileX, tileY, i + 1000);
      const color = adjustBrightness(baseColor, 8);
      const by = capY + TILE_SIZE + i * stripH;

      g.setFillStyle({ color, alpha });
      g.rect(ox + TILE_SIZE - SIDE_STRIP_WIDTH, by, SIDE_STRIP_WIDTH, Math.ceil(stripH));
      g.fill();
    }
  }

  // ── Contact shadow at body base ── only if south face is exposed
  if (h > 0 && southExposed) {
    const shadowH = Math.min(CONTACT_SHADOW_HEIGHT, h);
    const shadowColor = lerpColor(colors.abyss, 0x000000, 0.5);
    g.setFillStyle({ color: shadowColor, alpha });
    g.rect(ox, capY + TILE_SIZE + h - shadowH, TILE_SIZE, shadowH);
    g.fill();
  }
}

/**
 * Draw ONLY the top cap (main tile surface + bevels) of a column.
 *
 * Used for two-pass rendering: draw all shafts first, then all caps.
 * Cap position is displaced by yOffset for cap-rise animation.
 */
export function drawColumnCapOnly(
  g: Graphics,
  ox: number,
  oy: number,
  colors: TileColors,
  config: ColumnConfig,
): void {
  const { alpha = 1, yOffset = 0 } = config;
  const capY = oy + yOffset;

  // ── Top cap ── drawn at (ox, capY)
  g.setFillStyle({ color: colors.top, alpha });
  g.rect(ox, capY, TILE_SIZE, TILE_SIZE);
  g.fill();

  // ── Bevel highlights ──
  // Top edge (light, 2px)
  g.setFillStyle({ color: colors.bevelLight, alpha });
  g.rect(ox, capY, TILE_SIZE, 2);
  g.fill();

  // Left edge (light, 2px)
  g.setFillStyle({ color: colors.bevelLight, alpha });
  g.rect(ox, capY, 2, TILE_SIZE);
  g.fill();

  // Bottom edge (dark, 1px)
  g.setFillStyle({ color: colors.bevelDark, alpha });
  g.rect(ox, capY + TILE_SIZE - 1, TILE_SIZE, 1);
  g.fill();

  // Right edge (dark, 1px)
  g.setFillStyle({ color: colors.bevelDark, alpha });
  g.rect(ox + TILE_SIZE - 1, capY, 1, TILE_SIZE);
  g.fill();
}

/**
 * Draw a complete column at an arbitrary pixel origin (ox, oy).
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
 *
 * When yOffset > 0, the entire column (cap + shaft) shifts down by that many pixels.
 * This supports cap-rise animation: start with large yOffset, animate toward 0.
 */
function drawColumn(
  g: Graphics,
  ox: number,
  oy: number,
  colors: TileColors,
  config: ColumnConfig,
  tileX: number,
  tileY: number,
): void {
  drawColumnShaftOnly(g, ox, oy, colors, config, tileX, tileY);
  drawColumnCapOnly(g, ox, oy, colors, config);
}

// ── Public API: resolve helpers ──────────────────────────────────────────────

/** Resolve tile type from map for a given grid position. */
function resolveTileType(map: GameMap, x: number, y: number): TileType {
  const idx = y * map.width + x;
  return map.tiles[idx] ?? TileType.Floor;
}

// ── Public API: complete column drawing ──────────────────────────────────────

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
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  drawColumn(g, px, py, colors, config, x, y);
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
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  drawColumn(g, px, py, colors, config, x, y);
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
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  drawColumn(g, 0, 0, colors, config, x, y);
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
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  drawColumn(g, 0, 0, colors, config, x, y);
}

// ── Public API: two-pass drawing (shaft-only and cap-only) ───────────────────

/**
 * Draw ONLY the shaft of a **visible-state** column at **world coordinates**.
 * For two-pass rendering: draw all shafts first, then all caps.
 */
export function drawVisibleShaftOnly(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  drawColumnShaftOnly(g, x * TILE_SIZE, y * TILE_SIZE, colors, config, x, y);
}

/**
 * Draw ONLY the cap of a **visible-state** column at **world coordinates**.
 * For two-pass rendering: draw all shafts first, then all caps.
 */
export function drawVisibleCapOnly(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  drawColumnCapOnly(g, x * TILE_SIZE, y * TILE_SIZE, colors, config);
}

/**
 * Draw ONLY the shaft of a **remembered-state** column at **world coordinates**.
 * For two-pass rendering: draw all shafts first, then all caps.
 */
export function drawRememberedShaftOnly(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  drawColumnShaftOnly(g, x * TILE_SIZE, y * TILE_SIZE, colors, config, x, y);
}

/**
 * Draw ONLY the cap of a **remembered-state** column at **world coordinates**.
 * For two-pass rendering: draw all shafts first, then all caps.
 */
export function drawRememberedCapOnly(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  drawColumnCapOnly(g, x * TILE_SIZE, y * TILE_SIZE, colors, config);
}

/**
 * Draw ONLY the shaft of a **visible-state** column at **local (0,0) origin**.
 * For two-pass rendering with individually-positioned tile objects.
 */
export function drawVisibleShaftOnlyLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  drawColumnShaftOnly(g, 0, 0, colors, config, x, y);
}

/**
 * Draw ONLY the cap of a **visible-state** column at **local (0,0) origin**.
 * For two-pass rendering with individually-positioned tile objects.
 */
export function drawVisibleCapOnlyLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = visibleColors(tileType, x, y);
  drawColumnCapOnly(g, 0, 0, colors, config);
}

/**
 * Draw ONLY the shaft of a **remembered-state** column at **local (0,0) origin**.
 * For two-pass rendering with individually-positioned tile objects.
 */
export function drawRememberedShaftOnlyLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  drawColumnShaftOnly(g, 0, 0, colors, config, x, y);
}

/**
 * Draw ONLY the cap of a **remembered-state** column at **local (0,0) origin**.
 * For two-pass rendering with individually-positioned tile objects.
 */
export function drawRememberedCapOnlyLocal(
  g: Graphics,
  map: GameMap,
  x: number,
  y: number,
  config: ColumnConfig,
): void {
  const tileType = resolveTileType(map, x, y);
  const colors = rememberedColors(tileType, x, y);
  drawColumnCapOnly(g, 0, 0, colors, config);
}
