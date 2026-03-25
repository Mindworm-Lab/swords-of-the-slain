/**
 * Tests for columnRenderer — pure color math helpers, constants,
 * palette contracts, and column drawing functions.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  tileColorJitter,
  clamp255,
  jitterColor,
  lerpColor,
  adjustBrightness,
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
  SIDE_STRIP_WIDTH,
  drawVisibleColumn,
  drawRememberedColumn,
  drawVisibleColumnLocal,
  drawRememberedColumnLocal,
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
    // Not strictly guaranteed by contract but should hold for non-degenerate hash
    const results = new Set<number>();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        results.add(tileColorJitter(x, y, 100));
      }
    }
    // We expect significant variety in 100 samples
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
    // Each channel should be in [0, 255]
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
    // 0 + (254-0)*0.5 = 127
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
// Constants
// ══════════════════════════════════════════════════════════════════════════════

describe('column constants', () => {
  it('COLUMN_MAX_HEIGHT is positive', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThan(0);
  });

  it('COLUMN_REMEMBERED_HEIGHT is positive and smaller than max', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThan(0);
    expect(COLUMN_REMEMBERED_HEIGHT).toBeLessThan(COLUMN_MAX_HEIGHT);
  });

  it('SIDE_STRIP_WIDTH is positive', () => {
    expect(SIDE_STRIP_WIDTH).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Palette contracts
// ══════════════════════════════════════════════════════════════════════════════

describe('palette contracts', () => {
  /** Sum of RGB channels as a rough brightness proxy. */
  function brightness(color: number): number {
    const [r, g, b] = channels(color);
    return r + g + b;
  }

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
// drawVisibleColumn / drawRememberedColumn — integration smoke tests
// ══════════════════════════════════════════════════════════════════════════════

describe('drawVisibleColumn', () => {
  it('does not throw for valid inputs', () => {
    const g = mockGraphics();
    const map = floorMap();
    const config: ColumnConfig = { columnHeight: COLUMN_MAX_HEIGHT };
    expect(() => drawVisibleColumn(g as never, map, 0, 0, config)).not.toThrow();
  });

  it('calls setFillStyle/rect/fill for non-zero column height', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, { columnHeight: 8 });
    // Should have multiple draw calls: body bands + strip bands + shadow + top cap + bevels
    expect(g.setFillStyle.mock.calls.length).toBeGreaterThan(5);
    expect(g.rect.mock.calls.length).toBeGreaterThan(5);
    expect(g.fill.mock.calls.length).toBeGreaterThan(5);
  });

  it('draws fewer shapes when columnHeight is 0 (flat tile)', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 0, 0, { columnHeight: 0 });
    // With height 0: top cap (1) + 4 bevel strips = 5 calls
    expect(g.rect.mock.calls.length).toBe(5);
  });

  it('works with wall tiles', () => {
    const g = mockGraphics();
    const map = wallMap();
    expect(() =>
      drawVisibleColumn(g as never, map, 2, 2, { columnHeight: COLUMN_MAX_HEIGHT }),
    ).not.toThrow();
  });

  it('respects alpha in config', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 0, 0, { columnHeight: 8, alpha: 0.5 });
    // All setFillStyle calls should include alpha: 0.5
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
    const config: ColumnConfig = { columnHeight: 6 };

    drawVisibleColumn(gVis as never, map, 0, 0, config);
    drawRememberedColumn(gRem as never, map, 0, 0, config);

    // The top cap is drawn after body/strip/shadow, find the cap call
    // For height 0 it's the first call; for height > 0 we look at the cap
    // which is the first call after the body section. We'll compare the
    // last setFillStyle calls which are the bevel dark strips.
    const visColors = gVis.setFillStyle.mock.calls.map(
      (c: unknown[]) => (c[0] as { color: number }).color,
    );
    const remColors = gRem.setFillStyle.mock.calls.map(
      (c: unknown[]) => (c[0] as { color: number }).color,
    );

    // Sum of all colors used should be higher for visible
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
    // The top cap rect call should be at (0, 0)
    // With columnHeight 0, first rect call is the top cap
    const firstRect = g.rect.mock.calls[0] as number[] | undefined;
    expect(firstRect).toBeDefined();
    expect(firstRect![0]).toBe(0); // x
    expect(firstRect![1]).toBe(0); // y
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
});

// ══════════════════════════════════════════════════════════════════════════════
// World-coordinate variants position correctly
// ══════════════════════════════════════════════════════════════════════════════

describe('world coordinate positioning', () => {
  it('drawVisibleColumn positions at (x * TILE_SIZE, y * TILE_SIZE)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    // Draw at tile (3, 2) → pixel (96, 64) given TILE_SIZE=32
    drawVisibleColumn(g as never, map, 3, 2, { columnHeight: 0 });
    const firstRect = g.rect.mock.calls[0] as number[] | undefined;
    expect(firstRect).toBeDefined();
    expect(firstRect![0]).toBe(3 * 32); // 96
    expect(firstRect![1]).toBe(2 * 32); // 64
  });
});
