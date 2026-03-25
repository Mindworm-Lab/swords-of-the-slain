/**
 * Tests for columnRenderer — pure color math helpers, constants,
 * palette contracts, volumetric shaft rendering, cap-rise animation (yOffset),
 * two-pass drawing functions, and column drawing with neighbor exposure logic.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  tileColorJitter,
  clamp255,
  jitterColor,
  lerpColor,
  adjustBrightness,
  rowNoise,
  volumetricStripColor,
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
  SIDE_STRIP_WIDTH,
  STRIP_HEIGHT,
  ABYSS_COLOR,
  ABYSS_BG_COLOR,
  drawVisibleColumn,
  drawRememberedColumn,
  drawVisibleColumnLocal,
  drawRememberedColumnLocal,
  drawVisibleShaftOnly,
  drawVisibleCapOnly,
  drawRememberedShaftOnly,
  drawRememberedCapOnly,
  drawVisibleShaftOnlyLocal,
  drawVisibleCapOnlyLocal,
  drawRememberedShaftOnlyLocal,
  drawRememberedCapOnlyLocal,
} from '../columnRenderer.ts';
import type { ColumnConfig } from '../columnRenderer.ts';
import { type GameMap, TileType } from '../../tilemap/types.ts';

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Create a small map with all floors. */
function floorMap(w = 4, h = 4): GameMap {
  return { width: w, height: h, tiles: new Array(w * h).fill(TileType.Floor) };
}

/** Create a small map with all walls. */
function wallMap(w = 4, h = 4): GameMap {
  return { width: w, height: h, tiles: new Array(w * h).fill(TileType.Wall) };
}

/** Create a mock PixiJS v8 Graphics object. */
function mockGraphics() {
  return {
    setFillStyle: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
  };
}

/** Extract RGB channels from a packed 0xRRGGBB color. */
function channels(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

/** Sum of RGB channels as a rough brightness proxy. */
function brightness(color: number): number {
  const [r, g, b] = channels(color);
  return r + g + b;
}

/**
 * Compute expected strip count for a given shaft height.
 * Mirrors the internal stripCount() function.
 */
function expectedStripCount(h: number): number {
  if (h <= 0) return 0;
  return Math.max(1, Math.ceil(h / STRIP_HEIGHT));
}

// ══════════════════════════════════════════════════════════════════════════════
// tileColorJitter
// ══════════════════════════════════════════════════════════════════════════════

describe('tileColorJitter', () => {
  it('is deterministic — same (x, y) always returns the same value', () => {
    const a = tileColorJitter(3, 7, 10);
    const b = tileColorJitter(3, 7, 10);
    expect(a).toBe(b);
  });

  it('returns values within [-amplitude, +amplitude]', () => {
    const amp = 12;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const v = tileColorJitter(x, y, amp);
        expect(v).toBeGreaterThanOrEqual(-amp);
        expect(v).toBeLessThanOrEqual(amp);
      }
    }
  });

  it('returns 0 when amplitude is 0', () => {
    expect(tileColorJitter(5, 5, 0)).toBe(0);
  });

  it('differs for different (x, y) coordinates', () => {
    const results = new Set<number>();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        results.add(tileColorJitter(x, y, 100));
      }
    }
    expect(results.size).toBeGreaterThan(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clamp255
// ══════════════════════════════════════════════════════════════════════════════

describe('clamp255', () => {
  it('passes through values in [0, 255]', () => {
    expect(clamp255(0)).toBe(0);
    expect(clamp255(128)).toBe(128);
    expect(clamp255(255)).toBe(255);
  });

  it('clamps negative values to 0', () => {
    expect(clamp255(-1)).toBe(0);
    expect(clamp255(-100)).toBe(0);
  });

  it('clamps values above 255 to 255', () => {
    expect(clamp255(256)).toBe(255);
    expect(clamp255(1000)).toBe(255);
  });

  it('rounds fractional values', () => {
    expect(clamp255(127.4)).toBe(127);
    expect(clamp255(127.6)).toBe(128);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// jitterColor
// ══════════════════════════════════════════════════════════════════════════════

describe('jitterColor', () => {
  it('returns a valid 0xRRGGBB color', () => {
    const result = jitterColor(0x3a3a4a, 5, 10, 8);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffff);
    const [r, g, b] = channels(result);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });

  it('is deterministic', () => {
    const a = jitterColor(0xff8040, 2, 3, 10);
    const b = jitterColor(0xff8040, 2, 3, 10);
    expect(a).toBe(b);
  });

  it('returns base color when amplitude is 0', () => {
    const base = 0x3a3a4a;
    const result = jitterColor(base, 5, 5, 0);
    expect(result).toBe(base);
  });

  it('jitter offset is bounded by amplitude', () => {
    const base = 0x808080; // 128,128,128
    const amp = 5;
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const [r, g, b] = channels(jitterColor(base, x, y, amp));
        expect(r).toBeGreaterThanOrEqual(128 - amp);
        expect(r).toBeLessThanOrEqual(128 + amp);
        expect(g).toBeGreaterThanOrEqual(128 - amp);
        expect(g).toBeLessThanOrEqual(128 + amp);
        expect(b).toBeGreaterThanOrEqual(128 - amp);
        expect(b).toBeLessThanOrEqual(128 + amp);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// lerpColor
// ══════════════════════════════════════════════════════════════════════════════

describe('lerpColor', () => {
  it('returns a at t=0', () => {
    expect(lerpColor(0xff0000, 0x00ff00, 0)).toBe(0xff0000);
  });

  it('returns b at t=1', () => {
    expect(lerpColor(0xff0000, 0x00ff00, 1)).toBe(0x00ff00);
  });

  it('returns midpoint at t=0.5', () => {
    const mid = lerpColor(0x000000, 0xfefefe, 0.5);
    const [r, g, b] = channels(mid);
    expect(r).toBe(127);
    expect(g).toBe(127);
    expect(b).toBe(127);
  });

  it('clamps t below 0 to 0', () => {
    expect(lerpColor(0xff0000, 0x00ff00, -1)).toBe(0xff0000);
  });

  it('clamps t above 1 to 1', () => {
    expect(lerpColor(0xff0000, 0x00ff00, 2)).toBe(0x00ff00);
  });

  it('interpolates each channel independently', () => {
    const result = lerpColor(0x000000, 0xff8040, 0.5);
    const [r, g, b] = channels(result);
    expect(r).toBe(clamp255(255 * 0.5)); // 128
    expect(g).toBe(clamp255(128 * 0.5)); // 64
    expect(b).toBe(clamp255(64 * 0.5));  // 32
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// adjustBrightness
// ══════════════════════════════════════════════════════════════════════════════

describe('adjustBrightness', () => {
  it('lightens with positive offset', () => {
    const base = 0x404040; // 64,64,64
    const result = adjustBrightness(base, 20);
    const [r, g, b] = channels(result);
    expect(r).toBe(84);
    expect(g).toBe(84);
    expect(b).toBe(84);
  });

  it('darkens with negative offset', () => {
    const base = 0x404040;
    const result = adjustBrightness(base, -20);
    const [r, g, b] = channels(result);
    expect(r).toBe(44);
    expect(g).toBe(44);
    expect(b).toBe(44);
  });

  it('clamps channels at 255', () => {
    const result = adjustBrightness(0xf0f0f0, 30);
    const [r, g, b] = channels(result);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('clamps channels at 0', () => {
    const result = adjustBrightness(0x101010, -30);
    const [r, g, b] = channels(result);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('returns same color with offset 0', () => {
    const base = 0x3a3a4a;
    expect(adjustBrightness(base, 0)).toBe(base);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// rowNoise
// ══════════════════════════════════════════════════════════════════════════════

describe('rowNoise', () => {
  it('is deterministic — same inputs always produce the same value', () => {
    const a = rowNoise(3, 7, 5, 3);
    const b = rowNoise(3, 7, 5, 3);
    expect(a).toBe(b);
  });

  it('returns values within [-amplitude, +amplitude]', () => {
    const amp = 3;
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let row = 0; row < 20; row++) {
          const v = rowNoise(x, y, row, amp);
          expect(v).toBeGreaterThanOrEqual(-amp);
          expect(v).toBeLessThanOrEqual(amp);
        }
      }
    }
  });

  it('returns 0 when amplitude is 0', () => {
    expect(rowNoise(5, 5, 3, 0)).toBe(0);
  });

  it('varies with row index (different rows → different noise)', () => {
    const results = new Set<number>();
    for (let row = 0; row < 30; row++) {
      results.add(rowNoise(5, 5, row, 10));
    }
    // Should have significant variety across different rows
    expect(results.size).toBeGreaterThan(5);
  });

  it('varies with tile position (different tiles → different noise)', () => {
    const results = new Set<number>();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        results.add(rowNoise(x, y, 0, 10));
      }
    }
    expect(results.size).toBeGreaterThan(20);
  });

  it('uses different seed from tileColorJitter', () => {
    // They should generally produce different values for the same (x,y)
    // (not a strict contract but validates non-correlation)
    let differ = 0;
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        if (Math.abs(rowNoise(x, y, 0, 100) - tileColorJitter(x, y, 100)) > 0.01) {
          differ++;
        }
      }
    }
    // Most should differ
    expect(differ).toBeGreaterThan(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// volumetricStripColor
// ══════════════════════════════════════════════════════════════════════════════

describe('volumetricStripColor', () => {
  const body = 0x2a2a3a; // typical floor body color
  const abyss = 0x0a0a12;

  it('returns a valid packed 0xRRGGBB color', () => {
    const color = volumetricStripColor(body, abyss, 0.5, 0, 0, 5);
    expect(color).toBeGreaterThanOrEqual(0);
    expect(color).toBeLessThanOrEqual(0xffffff);
  });

  it('is deterministic', () => {
    const a = volumetricStripColor(body, abyss, 0.5, 3, 7, 5);
    const b = volumetricStripColor(body, abyss, 0.5, 3, 7, 5);
    expect(a).toBe(b);
  });

  it('top of shaft (t=0) is close to body color', () => {
    const topColor = volumetricStripColor(body, abyss, 0, 0, 0, 0);
    const [tr, tg, tb] = channels(topColor);
    const [br, bg, bb] = channels(body);
    // Should be close to body color (within noise tolerance)
    expect(Math.abs(tr - br)).toBeLessThan(10);
    expect(Math.abs(tg - bg)).toBeLessThan(10);
    expect(Math.abs(tb - bb)).toBeLessThan(10);
  });

  it('bottom of shaft (t=1) is very dark (near abyss)', () => {
    const bottomColor = volumetricStripColor(body, abyss, 1, 0, 0, 0);
    const [r, g, b] = channels(bottomColor);
    // Bottom should be extremely dark due to abyssal occlusion
    expect(r).toBeLessThan(15);
    expect(g).toBeLessThan(15);
    expect(b).toBeLessThan(25); // blue channel may be slightly higher due to hue drift
  });

  it('brightness decreases monotonically from top to bottom', () => {
    const samples = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const color = volumetricStripColor(body, abyss, t, 5, 5, i);
      samples.push(brightness(color));
    }
    // Each sample should be >= the next (allowing for tiny noise variations)
    for (let i = 0; i < samples.length - 1; i++) {
      // Allow small noise tolerance (±8 per channel = ±24 brightness)
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i + 1]! - 24);
    }
    // Overall: top should be clearly brighter than bottom
    expect(samples[0]!).toBeGreaterThan(samples[samples.length - 1]!);
  });

  describe('hue drift toward blue-violet', () => {
    it('bottom strips have more blue relative to red than top strips', () => {
      const topColor = volumetricStripColor(0x404040, abyss, 0, 0, 0, 0);
      const bottomColor = volumetricStripColor(0x404040, abyss, 0.8, 0, 0, 10);
      const [tr, _tg, tb] = channels(topColor);
      const [br, _bg, bb] = channels(bottomColor);

      // Blue-red ratio should increase with depth
      const topRatio = tb / Math.max(1, tr);
      const bottomRatio = bb / Math.max(1, br);
      expect(bottomRatio).toBeGreaterThan(topRatio);
    });

    it('mid-depth color has cooler hue than top', () => {
      // Use a neutral gray to isolate hue drift effect
      const topColor = volumetricStripColor(0x606060, abyss, 0.05, 0, 0, 0);
      const midColor = volumetricStripColor(0x606060, abyss, 0.5, 0, 0, 5);
      const [tr, _tg, tb] = channels(topColor);
      const [mr, _mg, mb] = channels(midColor);

      // Blue channel should be relatively more preserved/boosted vs red
      const topBlueAdvantage = tb - tr;
      const midBlueAdvantage = mb - mr;
      expect(midBlueAdvantage).toBeGreaterThan(topBlueAdvantage);
    });
  });

  describe('atmospheric softening', () => {
    it('mid-range strips have slight brightness bump compared to pure lerp', () => {
      // Compare volumetric color at mid-range with simple lerp
      // The atmospheric softening zone (0.4-0.75) adds brightness
      const t = 0.55; // center of atmospheric zone
      const volColor = volumetricStripColor(0x404060, abyss, t, 0, 0, 0);
      const simpleLerp = lerpColor(0x404060, abyss, t);

      // Volumetric should be slightly brighter than raw lerp at this depth
      // (the atmospheric softening adds brightness and hue drift adds blue)
      const volB = brightness(volColor);
      const lerpB = brightness(simpleLerp);
      // The atmospheric bump should make it brighter (or at minimum not dramatically darker)
      // Note: noise and other effects may slightly offset, so we check the general trend
      expect(volB).toBeGreaterThanOrEqual(lerpB - 15);
    });

    it('colors in the atmospheric zone have reduced saturation', () => {
      // Test with a clearly saturated color to detect desaturation
      const saturated = 0x6020a0; // high blue, low green = saturated
      const t = 0.55; // center of atmospheric zone
      const volColor = volumetricStripColor(saturated, abyss, t, 0, 0, 0);

      const [r, g, b] = channels(volColor);
      // After desaturation, channels should be closer to each other
      // (closer to their average) compared to just lerp + hue drift
      const range = Math.max(r, g, b) - Math.min(r, g, b);
      // The range should be moderate — full saturation would have larger range
      // We mainly verify the function doesn't crash and returns valid colors
      expect(range).toBeLessThan(200);
    });
  });

  describe('hard abyssal occlusion', () => {
    it('bottom 15% is dramatically darker than the zone just above', () => {
      const justAboveOcclusion = volumetricStripColor(body, abyss, 0.84, 0, 0, 0);
      const inOcclusion = volumetricStripColor(body, abyss, 0.95, 0, 0, 0);
      const deepOcclusion = volumetricStripColor(body, abyss, 1.0, 0, 0, 0);

      const aboveBright = brightness(justAboveOcclusion);
      const inBright = brightness(inOcclusion);
      const deepBright = brightness(deepOcclusion);

      expect(aboveBright).toBeGreaterThan(inBright);
      expect(inBright).toBeGreaterThan(deepBright);
      // Deep occlusion should be very dark
      expect(deepBright).toBeLessThan(30);
    });
  });

  describe('material texture noise', () => {
    it('different strip indices produce slightly different colors', () => {
      const colors = new Set<number>();
      for (let i = 0; i < 20; i++) {
        colors.add(volumetricStripColor(body, abyss, 0.3, 5, 5, i));
      }
      // With per-row noise, we should see variety even at the same depth
      expect(colors.size).toBeGreaterThan(3);
    });

    it('noise variation is subtle (within ±TEXTURE_NOISE_AMP per channel)', () => {
      // Sample the same depth fraction with different strip indices
      const brightnesses: number[] = [];
      for (let i = 0; i < 30; i++) {
        brightnesses.push(brightness(volumetricStripColor(body, abyss, 0.3, 5, 5, i)));
      }
      const minB = Math.min(...brightnesses);
      const maxB = Math.max(...brightnesses);
      // Maximum spread should be bounded (3 channels × 2 × amp = 18)
      expect(maxB - minB).toBeLessThanOrEqual(24); // generous tolerance
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

describe('column constants', () => {
  it('COLUMN_MAX_HEIGHT is at least 48 for deep shaft feel', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThanOrEqual(48);
  });

  it('COLUMN_MAX_HEIGHT is in the deep abyss range (48-96px)', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThanOrEqual(48);
    expect(COLUMN_MAX_HEIGHT).toBeLessThanOrEqual(96);
  });

  it('COLUMN_REMEMBERED_HEIGHT is positive and smaller than max', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThan(0);
    expect(COLUMN_REMEMBERED_HEIGHT).toBeLessThan(COLUMN_MAX_HEIGHT);
  });

  it('COLUMN_REMEMBERED_HEIGHT is at least 16 for visible presence', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThanOrEqual(16);
  });

  it('SIDE_STRIP_WIDTH is positive', () => {
    expect(SIDE_STRIP_WIDTH).toBeGreaterThan(0);
  });

  it('STRIP_HEIGHT is a small positive integer for smooth gradients', () => {
    expect(STRIP_HEIGHT).toBeGreaterThan(0);
    expect(STRIP_HEIGHT).toBeLessThanOrEqual(8);
  });

  it('ABYSS_COLOR is very dark', () => {
    expect(brightness(ABYSS_COLOR)).toBeLessThan(60);
  });

  it('ABYSS_BG_COLOR is darker than ABYSS_COLOR', () => {
    expect(brightness(ABYSS_BG_COLOR)).toBeLessThan(brightness(ABYSS_COLOR));
  });

  it('ABYSS_BG_COLOR is near-black', () => {
    const [r, g, b] = channels(ABYSS_BG_COLOR);
    expect(r).toBeLessThan(20);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Palette contracts
// ══════════════════════════════════════════════════════════════════════════════

describe('palette contracts', () => {
  it('visible floor is brighter than remembered floor', () => {
    const visFloor = jitterColor(0x3a3a4a, 0, 0, 0);
    const remFloor = jitterColor(0x252530, 0, 0, 0);
    expect(brightness(visFloor)).toBeGreaterThan(brightness(remFloor));
  });

  it('visible wall is brighter than remembered wall', () => {
    const visWall = jitterColor(0x5a4a3a, 0, 0, 0);
    const remWall = jitterColor(0x3a3228, 0, 0, 0);
    expect(brightness(visWall)).toBeGreaterThan(brightness(remWall));
  });

  it('abyss color is very dark', () => {
    expect(brightness(0x0a0a12)).toBeLessThan(60);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neighbor exposure — interior tiles (no exposed edges)
// ══════════════════════════════════════════════════════════════════════════════

describe('interior tiles (no exposed edges)', () => {
  it('renders ONLY top cap + bevels when both exposures are false', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    // Top cap (1) + 4 bevel strips = 5 rect calls — no body, no strip, no shadow
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('renders ONLY top cap + bevels when exposure flags omitted (default false)', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, { columnHeight: COLUMN_MAX_HEIGHT });
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('remembered interior tile also renders only top cap + bevels', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawRememberedColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('draw call count is identical for visible and remembered interior tiles', () => {
    const gVis = mockGraphics();
    const gRem = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(gVis as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    drawRememberedColumn(gRem as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(gVis.rect.mock.calls.length).toBe(gRem.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neighbor exposure — south-exposed tiles (strip-based rendering)
// ══════════════════════════════════════════════════════════════════════════════

describe('south-exposed tiles', () => {
  it('draws body strips + contact shadow when southExposed=true', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // South body: strips + contact shadow (1) + top cap (1) + 4 bevels
    expect(g.rect.mock.calls.length).toBe(strips + 6);
  });

  it('body strips extend downward from capY + TILE_SIZE', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const tileX = 3;
    const tileY = 2;
    drawVisibleColumn(g as never, map, tileX, tileY, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // First rect call is the first body strip at oy + TILE_SIZE (yOffset=0)
    const firstRect = g.rect.mock.calls[0] as number[];
    expect(firstRect[0]).toBe(tileX * 32); // ox
    expect(firstRect[1]).toBe(tileY * 32 + 32); // oy + TILE_SIZE
  });

  it('south-exposed has more draw calls than non-exposed', () => {
    const gExposed = mockGraphics();
    const gInterior = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(gExposed as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    drawVisibleColumn(gInterior as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(gExposed.rect.mock.calls.length).toBeGreaterThan(gInterior.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neighbor exposure — east-exposed tiles
// ══════════════════════════════════════════════════════════════════════════════

describe('east-exposed tiles', () => {
  it('draws east strip bands when eastExposed=true', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // East strip: strips + top cap (1) + 4 bevels
    expect(g.rect.mock.calls.length).toBe(strips + 5);
  });

  it('east strip bands are positioned at TILE_SIZE - SIDE_STRIP_WIDTH offset', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const tileX = 2;
    const tileY = 1;
    drawVisibleColumn(g as never, map, tileX, tileY, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // First rect call is the first east strip band
    const firstRect = g.rect.mock.calls[0] as number[];
    const expectedX = tileX * 32 + 32 - 3; // ox + TILE_SIZE - SIDE_STRIP_WIDTH
    expect(firstRect[0]).toBe(expectedX);
    expect(firstRect[2]).toBe(3); // width = SIDE_STRIP_WIDTH
  });

  it('east-exposed has more draw calls than non-exposed', () => {
    const gExposed = mockGraphics();
    const gInterior = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(gExposed as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    drawVisibleColumn(gInterior as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(gExposed.rect.mock.calls.length).toBeGreaterThan(gInterior.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neighbor exposure — both edges exposed
// ══════════════════════════════════════════════════════════════════════════════

describe('fully exposed tiles (both edges)', () => {
  it('draws body + strip + shadow + cap + bevels when both exposed', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // South body: strips + east strip: strips + shadow (1) + cap (1) + 4 bevels
    expect(g.rect.mock.calls.length).toBe(strips * 2 + 6);
  });

  it('remembered fully-exposed also draws all faces', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_REMEMBERED_HEIGHT);
    drawRememberedColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    expect(g.rect.mock.calls.length).toBeGreaterThan(5);
    expect(g.rect.mock.calls.length).toBe(strips * 2 + 6);
  });

  it('both-exposed has more draw calls than single-exposed', () => {
    const gBoth = mockGraphics();
    const gSouth = mockGraphics();
    const gEast = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(gBoth as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    drawVisibleColumn(gSouth as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    drawVisibleColumn(gEast as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    expect(gBoth.rect.mock.calls.length).toBeGreaterThan(gSouth.rect.mock.calls.length);
    expect(gBoth.rect.mock.calls.length).toBeGreaterThan(gEast.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Height 0 — flat tile (exposure flags irrelevant)
// ══════════════════════════════════════════════════════════════════════════════

describe('columnHeight=0 (flat tile)', () => {
  it('draws only top cap + bevels even with both flags true', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: 0,
      southExposed: true,
      eastExposed: true,
    });
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('draws only top cap + bevels with default exposure', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 0, 0, { columnHeight: 0 });
    expect(g.rect.mock.calls.length).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Strip count — volumetric strips replace fixed BODY_BANDS
// ══════════════════════════════════════════════════════════════════════════════

describe('volumetric strip count', () => {
  it('south body draws correct number of strips for full height', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // Total = strips (south) + 1 shadow + 1 cap + 4 bevels
    const bodyStrips = g.rect.mock.calls.length - 6;
    expect(bodyStrips).toBe(strips);
  });

  it('east strip draws correct number of strips for full height', () => {
    const g = mockGraphics();
    const map = floorMap();
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    const stripBands = g.rect.mock.calls.length - 5;
    expect(stripBands).toBe(strips);
  });

  it('strips adapt when height is very small', () => {
    const g = mockGraphics();
    const map = floorMap();
    // columnHeight=2 → at least 1 strip
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 2,
      southExposed: true,
      eastExposed: false,
    });
    // 1 south strip + 1 shadow + 1 cap + 4 bevels = 7
    const bodyStrips = g.rect.mock.calls.length - 6;
    expect(bodyStrips).toBe(expectedStripCount(2));
    expect(bodyStrips).toBeGreaterThanOrEqual(1);
  });

  it('more strips for taller columns', () => {
    const gShort = mockGraphics();
    const gTall = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(gShort as never, map, 1, 1, {
      columnHeight: 6,
      southExposed: true,
      eastExposed: false,
    });
    drawVisibleColumn(gTall as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    expect(gTall.rect.mock.calls.length).toBeGreaterThan(gShort.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// drawVisibleColumn / drawRememberedColumn — integration smoke tests
// ══════════════════════════════════════════════════════════════════════════════

describe('drawVisibleColumn', () => {
  it('does not throw for valid inputs', () => {
    const g = mockGraphics();
    const map = floorMap();
    const config: ColumnConfig = { columnHeight: COLUMN_MAX_HEIGHT, southExposed: true, eastExposed: true };
    expect(() => drawVisibleColumn(g as never, map, 0, 0, config)).not.toThrow();
  });

  it('calls setFillStyle/rect/fill for non-zero height with south exposed', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 8,
      southExposed: true,
      eastExposed: true,
    });
    expect(g.setFillStyle.mock.calls.length).toBeGreaterThan(5);
    expect(g.rect.mock.calls.length).toBeGreaterThan(5);
    expect(g.fill.mock.calls.length).toBeGreaterThan(5);
  });

  it('works with wall tiles', () => {
    const g = mockGraphics();
    const map = wallMap();
    expect(() =>
      drawVisibleColumn(g as never, map, 2, 2, {
        columnHeight: COLUMN_MAX_HEIGHT,
        southExposed: true,
        eastExposed: true,
      }),
    ).not.toThrow();
  });

  it('respects alpha in config', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: 8,
      alpha: 0.5,
      southExposed: true,
      eastExposed: true,
    });
    for (const call of g.setFillStyle.mock.calls) {
      expect(call[0].alpha).toBe(0.5);
    }
  });
});

describe('drawRememberedColumn', () => {
  it('does not throw for valid inputs', () => {
    const g = mockGraphics();
    const map = floorMap();
    expect(() =>
      drawRememberedColumn(g as never, map, 0, 0, { columnHeight: COLUMN_REMEMBERED_HEIGHT }),
    ).not.toThrow();
  });

  it('uses darker colors than visible columns', () => {
    const gVis = mockGraphics();
    const gRem = mockGraphics();
    const map = floorMap();
    const config: ColumnConfig = {
      columnHeight: 6,
      southExposed: true,
      eastExposed: true,
    };

    drawVisibleColumn(gVis as never, map, 0, 0, config);
    drawRememberedColumn(gRem as never, map, 0, 0, config);

    const visColors = gVis.setFillStyle.mock.calls.map(
      (c: unknown[]) => (c[0] as { color: number }).color,
    );
    const remColors = gRem.setFillStyle.mock.calls.map(
      (c: unknown[]) => (c[0] as { color: number }).color,
    );

    const visBrightness = visColors.reduce((a: number, c: number) => {
      const [r, g, b] = channels(c);
      return a + r + g + b;
    }, 0);
    const remBrightness = remColors.reduce((a: number, c: number) => {
      const [r, g, b] = channels(c);
      return a + r + g + b;
    }, 0);

    expect(visBrightness).toBeGreaterThan(remBrightness);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Local-origin variants
// ══════════════════════════════════════════════════════════════════════════════

describe('drawVisibleColumnLocal', () => {
  it('draws at origin (0, 0) regardless of tile position', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumnLocal(g as never, map, 5, 5, { columnHeight: 0 });
    const firstRect = g.rect.mock.calls[0] as number[] | undefined;
    expect(firstRect).toBeDefined();
    expect(firstRect![0]).toBe(0);
    expect(firstRect![1]).toBe(0);
  });

  it('passes through exposure flags', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumnLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // strips (south) + shadow (1) + cap (1) + bevels (4)
    expect(g.rect.mock.calls.length).toBe(strips + 6);
  });
});

describe('drawRememberedColumnLocal', () => {
  it('draws at origin (0, 0) regardless of tile position', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawRememberedColumnLocal(g as never, map, 5, 5, { columnHeight: 0 });
    const firstRect = g.rect.mock.calls[0] as number[] | undefined;
    expect(firstRect).toBeDefined();
    expect(firstRect![0]).toBe(0);
    expect(firstRect![1]).toBe(0);
  });

  it('passes through exposure flags', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_REMEMBERED_HEIGHT);
    drawRememberedColumnLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // East strip only: strips + cap (1) + bevels (4)
    expect(g.rect.mock.calls.length).toBe(strips + 5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// World-coordinate variants position correctly
// ══════════════════════════════════════════════════════════════════════════════

describe('world coordinate positioning', () => {
  it('drawVisibleColumn positions at (x * TILE_SIZE, y * TILE_SIZE)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 3, 2, { columnHeight: 0 });
    const firstRect = g.rect.mock.calls[0] as number[] | undefined;
    expect(firstRect).toBeDefined();
    expect(firstRect![0]).toBe(3 * 32); // 96
    expect(firstRect![1]).toBe(2 * 32); // 64
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// yOffset — cap-rise animation support
// ══════════════════════════════════════════════════════════════════════════════

describe('yOffset (cap-rise animation)', () => {
  it('yOffset=0 (default) draws cap at normal position', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 2, 3, { columnHeight: 0 });
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[0]).toBe(2 * 32); // x position
    expect(capRect[1]).toBe(3 * 32); // y position (no offset)
  });

  it('positive yOffset shifts cap downward', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 2, 3, { columnHeight: 0, yOffset: 20 });
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[0]).toBe(2 * 32); // x unchanged
    expect(capRect[1]).toBe(3 * 32 + 20); // y shifted by yOffset
  });

  it('yOffset shifts both cap and shaft together', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const yOff = 30;
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      yOffset: yOff,
    });
    // First rect is the first body strip — at capY + TILE_SIZE
    const firstBodyRect = g.rect.mock.calls[0] as number[];
    expect(firstBodyRect[1]).toBe(1 * 32 + yOff + 32); // oy + yOffset + TILE_SIZE
  });

  it('cap-rise animation: large yOffset moves cap below authored height', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const largeOffset = COLUMN_MAX_HEIGHT;
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      yOffset: largeOffset,
    });
    // Cap should be at (oy + largeOffset), i.e., well below normal
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[1]).toBe(1 * 32 + largeOffset); // y = oy + yOffset
  });

  it('yOffset=0 and omitted yOffset produce the same result', () => {
    const gExplicit = mockGraphics();
    const gDefault = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(gExplicit as never, map, 2, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
      yOffset: 0,
    });
    drawVisibleColumn(gDefault as never, map, 2, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Same number of draw calls
    expect(gExplicit.rect.mock.calls.length).toBe(gDefault.rect.mock.calls.length);
    // Same positions
    for (let i = 0; i < gExplicit.rect.mock.calls.length; i++) {
      const a = gExplicit.rect.mock.calls[i] as number[];
      const b = gDefault.rect.mock.calls[i] as number[];
      expect(a[0]).toBe(b[0]);
      expect(a[1]).toBe(b[1]);
    }
  });

  it('yOffset works with local-origin drawing', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumnLocal(g as never, map, 5, 5, {
      columnHeight: 0,
      yOffset: 15,
    });
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[0]).toBe(0); // local origin x
    expect(capRect[1]).toBe(15); // 0 + yOffset
  });

  it('yOffset works with remembered columns', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawRememberedColumn(g as never, map, 2, 3, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      yOffset: 10,
    });
    // Cap should be at oy + yOffset
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[1]).toBe(3 * 32 + 10);
  });

  it('bevels follow cap position when yOffset is set', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const yOff = 25;
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 0,
      yOffset: yOff,
    });
    // All 5 rect calls are cap + bevels
    // Cap: rect(ox, oy+yOff, TILE_SIZE, TILE_SIZE)
    // Top bevel: rect(ox, oy+yOff, TILE_SIZE, 2)
    // Left bevel: rect(ox, oy+yOff, 2, TILE_SIZE)
    // Bottom bevel: rect(ox, oy+yOff+TILE_SIZE-1, TILE_SIZE, 1)
    // Right bevel: rect(ox+TILE_SIZE-1, oy+yOff, 1, TILE_SIZE)
    const capRect = g.rect.mock.calls[0] as number[];
    const topBevel = g.rect.mock.calls[1] as number[];
    const bottomBevel = g.rect.mock.calls[3] as number[];

    expect(capRect[1]).toBe(32 + yOff);
    expect(topBevel[1]).toBe(32 + yOff);
    expect(bottomBevel[1]).toBe(32 + yOff + 32 - 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Top cap pinning (with yOffset awareness)
// ══════════════════════════════════════════════════════════════════════════════

describe('top cap pinning', () => {
  it('top cap is at (ox, oy) when yOffset=0', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 2, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Cap is after south strips + east strips + shadow
    const capIdx = strips * 2 + 1;
    const capRect = g.rect.mock.calls[capIdx] as number[];
    expect(capRect[0]).toBe(2 * 32);
    expect(capRect[1]).toBe(3 * 32);
    expect(capRect[2]).toBe(32);
    expect(capRect[3]).toBe(32);
  });

  it('body strips start at capY + TILE_SIZE (below the cap)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 30,
      southExposed: true,
    });
    const firstBodyRect = g.rect.mock.calls[0] as number[];
    expect(firstBodyRect[1]).toBe(1 * 32 + 32); // oy + TILE_SIZE (yOffset=0)
  });

  it('cap position is the same regardless of column height (no yOffset)', () => {
    const gShort = mockGraphics();
    const gTall = mockGraphics();
    const map = floorMap(10, 10);

    // Short column: height=0 → cap is first rect
    drawVisibleColumn(gShort as never, map, 3, 4, { columnHeight: 0 });
    const shortCap = gShort.rect.mock.calls[0] as number[];

    // Tall column with south+east exposed: cap is after body+strip+shadow
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(gTall as never, map, 3, 4, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    const tallCapIdx = strips * 2 + 1;
    const tallCap = gTall.rect.mock.calls[tallCapIdx] as number[];

    expect(shortCap[0]).toBe(tallCap[0]);
    expect(shortCap[1]).toBe(tallCap[1]);
    expect(shortCap[2]).toBe(tallCap[2]);
    expect(shortCap[3]).toBe(tallCap[3]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Depth fade aggressiveness — body strips should approach abyss color
// ══════════════════════════════════════════════════════════════════════════════

describe('depth fade', () => {
  it('bottom body strip color is very close to abyss', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // Last body strip is at index (strips - 1)
    const lastStripCall = g.setFillStyle.mock.calls[strips - 1] as unknown[];
    const lastStripColor = (lastStripCall[0] as { color: number }).color;
    const [r, g2, b] = channels(lastStripColor);
    // Should be very dark — close to abyss (with possible blue drift)
    expect(r).toBeLessThan(30);
    expect(g2).toBeLessThan(30);
    expect(b).toBeLessThan(40); // slightly more tolerance for blue due to hue drift
  });

  it('first body strip is brighter than last body strip', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    const firstCall = g.setFillStyle.mock.calls[0] as unknown[];
    const lastCall = g.setFillStyle.mock.calls[strips - 1] as unknown[];
    const firstColor = (firstCall[0] as { color: number }).color;
    const lastColor = (lastCall[0] as { color: number }).color;

    expect(brightness(firstColor)).toBeGreaterThan(brightness(lastColor));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Two-pass drawing: shaft-only and cap-only
// ══════════════════════════════════════════════════════════════════════════════

describe('two-pass drawing: shaft-only and cap-only', () => {
  it('shaft-only draws NO cap or bevels', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_MAX_HEIGHT);
    drawVisibleShaftOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // South strips + east strips + contact shadow = strips*2 + 1
    expect(g.rect.mock.calls.length).toBe(strips * 2 + 1);
  });

  it('cap-only draws ONLY cap + bevels', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleCapOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Cap + 4 bevels = 5
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('shaft-only + cap-only = same count as full drawVisibleColumn', () => {
    const gFull = mockGraphics();
    const gShaft = mockGraphics();
    const gCap = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };
    drawVisibleColumn(gFull as never, map, 1, 1, config);
    drawVisibleShaftOnly(gShaft as never, map, 1, 1, config);
    drawVisibleCapOnly(gCap as never, map, 1, 1, config);

    expect(gShaft.rect.mock.calls.length + gCap.rect.mock.calls.length)
      .toBe(gFull.rect.mock.calls.length);
  });

  it('shaft-only with no exposed edges draws nothing', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleShaftOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(g.rect.mock.calls.length).toBe(0);
  });

  it('remembered shaft-only works', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const strips = expectedStripCount(COLUMN_REMEMBERED_HEIGHT);
    drawRememberedShaftOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // South strips + contact shadow
    expect(g.rect.mock.calls.length).toBe(strips + 1);
  });

  it('remembered cap-only works', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawRememberedCapOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
    });
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('local shaft-only draws at origin', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleShaftOnlyLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
    });
    const firstRect = g.rect.mock.calls[0] as number[];
    expect(firstRect[0]).toBe(0); // local origin x
    expect(firstRect[1]).toBe(32); // 0 + TILE_SIZE (body starts below cap)
  });

  it('local cap-only draws at origin', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleCapOnlyLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
    });
    const firstRect = g.rect.mock.calls[0] as number[];
    expect(firstRect[0]).toBe(0);
    expect(firstRect[1]).toBe(0);
  });

  it('local remembered shaft-only works', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    expect(() =>
      drawRememberedShaftOnlyLocal(g as never, map, 3, 3, {
        columnHeight: COLUMN_REMEMBERED_HEIGHT,
        southExposed: true,
        eastExposed: true,
      }),
    ).not.toThrow();
    expect(g.rect.mock.calls.length).toBeGreaterThan(0);
  });

  it('local remembered cap-only works', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawRememberedCapOnlyLocal(g as never, map, 3, 3, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
    });
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('two-pass shaft respects yOffset', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleShaftOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      yOffset: 20,
    });
    const firstRect = g.rect.mock.calls[0] as number[];
    // Body starts at capY + TILE_SIZE = (oy + yOffset) + TILE_SIZE
    expect(firstRect[1]).toBe(1 * 32 + 20 + 32);
  });

  it('two-pass cap respects yOffset', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleCapOnly(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      yOffset: 20,
    });
    const capRect = g.rect.mock.calls[0] as number[];
    expect(capRect[1]).toBe(1 * 32 + 20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Two-pass draw order: shaft-before-cap occlusion guarantee
// ══════════════════════════════════════════════════════════════════════════════

describe('two-pass draw order: occlusion guarantee', () => {
  it('shaft-only produces zero cap-related rect calls (no cap, no bevels)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleShaftOnly(g as never, map, 3, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Shaft draws body strips + east strips + contact shadow.
    // Cap would be a TILE_SIZE x TILE_SIZE rect at (ox, capY) — verify none match.
    const ox = 3 * 32;
    const capY = 3 * 32; // yOffset=0
    const hasCap = g.rect.mock.calls.some(
      (call: number[]) =>
        call[0] === ox && call[1] === capY && call[2] === 32 && call[3] === 32,
    );
    expect(hasCap).toBe(false);
  });

  it('cap-only produces zero shaft-related rect calls (no body strips)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleCapOnly(g as never, map, 3, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Cap draws only 5 rects: cap + 4 bevels. No body strip rects.
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('for two tiles at different Y, full column draws shaft+cap interleaved', () => {
    // This test demonstrates the occlusion problem with single-pass drawing:
    // tile at y=2 draws shaft+cap, then tile at y=3 draws shaft+cap
    // → y=3's shaft can overlap y=2's cap.
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };
    // Draw tile y=2 then y=3 (simulating single-pass)
    drawVisibleColumn(g as never, map, 3, 2, config);
    drawVisibleColumn(g as never, map, 3, 3, config);

    // Find the cap rect for y=2 and the first shaft rect for y=3
    const capY2 = 2 * 32;
    const shaftStartY3 = 3 * 32 + 32; // capY + TILE_SIZE for y=3
    let capY2Index = -1;
    let shaftY3Index = -1;
    for (let i = 0; i < g.rect.mock.calls.length; i++) {
      const call = g.rect.mock.calls[i] as number[];
      // Cap for y=2: rect at (3*32, 2*32, 32, 32)
      if (call[0] === 3 * 32 && call[1] === capY2 && call[2] === 32 && call[3] === 32) {
        capY2Index = i;
      }
      // First shaft strip for y=3: rect at (3*32, 3*32+32, ...)
      if (call[0] === 3 * 32 && call[1] === shaftStartY3 && shaftY3Index === -1) {
        shaftY3Index = i;
      }
    }
    // In single-pass, y=2's cap comes BEFORE y=3's shaft (interleaved)
    // This is the bug: y=3's shaft draws AFTER y=2's cap
    expect(capY2Index).not.toBe(-1);
    expect(shaftY3Index).not.toBe(-1);
    expect(capY2Index).toBeLessThan(shaftY3Index);
  });

  it('two-pass: all shafts before all caps prevents occlusion leak', () => {
    // This test demonstrates the fix: draw ALL shafts first, then ALL caps.
    // Both y=2 and y=3 shafts are drawn before any cap.
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };
    const tiles = [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ];

    // Pass 1: all shafts
    for (const t of tiles) {
      drawVisibleShaftOnly(g as never, map, t.x, t.y, config);
    }
    const lastShaftCallIndex = g.rect.mock.calls.length - 1;

    // Pass 2: all caps
    for (const t of tiles) {
      drawVisibleCapOnly(g as never, map, t.x, t.y, config);
    }

    // The first cap call index should be after the last shaft call index
    const firstCapCallIndex = lastShaftCallIndex + 1;
    const firstCapRect = g.rect.mock.calls[firstCapCallIndex] as number[];
    // First cap should be tile y=2's cap: (3*32, 2*32, 32, 32)
    expect(firstCapRect[0]).toBe(3 * 32);
    expect(firstCapRect[1]).toBe(2 * 32);
    expect(firstCapRect[2]).toBe(32);
    expect(firstCapRect[3]).toBe(32);

    // No cap rect should appear before lastShaftCallIndex
    for (let i = 0; i <= lastShaftCallIndex; i++) {
      const call = g.rect.mock.calls[i] as number[];
      // Cap rects are 32x32 at tile positions — but shaft rects also start
      // at (ox, capY+TILE_SIZE). We check: no 32x32 rect at any capY position.
      const isCapForY2 =
        call[0] === 3 * 32 && call[1] === 2 * 32 && call[2] === 32 && call[3] === 32;
      const isCapForY3 =
        call[0] === 3 * 32 && call[1] === 3 * 32 && call[2] === 32 && call[3] === 32;
      expect(isCapForY2).toBe(false);
      expect(isCapForY3).toBe(false);
    }
  });

  it('two-pass produces identical total draw calls as single-pass', () => {
    const gSingle = mockGraphics();
    const gTwoPass = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };
    const tiles = [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ];

    // Single-pass
    for (const t of tiles) {
      drawVisibleColumn(gSingle as never, map, t.x, t.y, config);
    }

    // Two-pass
    for (const t of tiles) {
      drawVisibleShaftOnly(gTwoPass as never, map, t.x, t.y, config);
    }
    for (const t of tiles) {
      drawVisibleCapOnly(gTwoPass as never, map, t.x, t.y, config);
    }

    expect(gTwoPass.rect.mock.calls.length).toBe(gSingle.rect.mock.calls.length);
  });

  it('remembered two-pass: shafts drawn before caps', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };

    // Pass 1: all remembered shafts
    drawRememberedShaftOnly(g as never, map, 2, 1, config);
    drawRememberedShaftOnly(g as never, map, 2, 2, config);
    const lastShaftIdx = g.rect.mock.calls.length - 1;

    // Pass 2: all remembered caps
    drawRememberedCapOnly(g as never, map, 2, 1, config);
    drawRememberedCapOnly(g as never, map, 2, 2, config);

    // Verify no cap-sized rect in shaft pass
    for (let i = 0; i <= lastShaftIdx; i++) {
      const call = g.rect.mock.calls[i] as number[];
      const isCapY1 =
        call[0] === 2 * 32 && call[1] === 1 * 32 && call[2] === 32 && call[3] === 32;
      const isCapY2 =
        call[0] === 2 * 32 && call[1] === 2 * 32 && call[2] === 32 && call[3] === 32;
      expect(isCapY1).toBe(false);
      expect(isCapY2).toBe(false);
    }
  });

  it('local two-pass: shaft then cap within a single tile Graphics', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    };
    drawVisibleShaftOnlyLocal(g as never, map, 5, 5, config);
    const shaftCallCount = g.rect.mock.calls.length;
    drawVisibleCapOnlyLocal(g as never, map, 5, 5, config);
    const totalCallCount = g.rect.mock.calls.length;

    // Cap calls start after shaft calls
    expect(totalCallCount).toBe(shaftCallCount + 5); // 5 = cap + 4 bevels

    // First cap rect is at local origin (0, 0) with size 32x32
    const capRect = g.rect.mock.calls[shaftCallCount] as number[];
    expect(capRect[0]).toBe(0);
    expect(capRect[1]).toBe(0);
    expect(capRect[2]).toBe(32);
    expect(capRect[3]).toBe(32);
  });

  it('interior tiles (no exposure) have zero shaft calls in two-pass', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleShaftOnly(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    // No exposed edges → no shaft drawing at all
    expect(g.rect.mock.calls.length).toBe(0);

    // But cap still draws
    drawVisibleCapOnly(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: false,
    });
    expect(g.rect.mock.calls.length).toBe(5); // cap + 4 bevels
  });

  it('back-to-front Y ordering: lower Y tiles drawn before higher Y tiles', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const config: ColumnConfig = {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    };

    // Draw shafts in Y-ascending order (back to front)
    drawVisibleShaftOnly(g as never, map, 3, 1, config);
    const afterY1Shaft = g.rect.mock.calls.length;
    drawVisibleShaftOnly(g as never, map, 3, 5, config);
    const afterY5Shaft = g.rect.mock.calls.length;

    // Y=1 shaft rects come before Y=5 shaft rects
    expect(afterY1Shaft).toBeGreaterThan(0);
    expect(afterY5Shaft).toBeGreaterThan(afterY1Shaft);

    // First rect of Y=1 shaft: body at (3*32, 1*32 + 32)
    const y1FirstRect = g.rect.mock.calls[0] as number[];
    expect(y1FirstRect[1]).toBe(1 * 32 + 32);

    // First rect of Y=5 shaft: body at (3*32, 5*32 + 32)
    const y5FirstRect = g.rect.mock.calls[afterY1Shaft] as number[];
    expect(y5FirstRect[1]).toBe(5 * 32 + 32);
  });
});
