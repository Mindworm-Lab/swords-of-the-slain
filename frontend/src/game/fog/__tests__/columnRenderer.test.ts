/**
 * Tests for columnRenderer — pure color math helpers, constants,
 * palette contracts, and column drawing functions with neighbor exposure logic.
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
  it('COLUMN_MAX_HEIGHT is at least 48 for deep shaft feel', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThanOrEqual(48);
  });

  it('COLUMN_MAX_HEIGHT is in the deep abyss range (48-96px)', () => {
    // Must be large enough for bottomless-void impression (> TILE_SIZE)
    // but not excessively large (3x TILE_SIZE = 96)
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
    // Defaults: southExposed=false, eastExposed=false → only top cap + bevels
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
    // Both should be exactly 5: cap + 4 bevels
    expect(gVis.rect.mock.calls.length).toBe(gRem.rect.mock.calls.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Neighbor exposure — south-exposed tiles
// ══════════════════════════════════════════════════════════════════════════════

describe('south-exposed tiles', () => {
  it('draws body bands + contact shadow when southExposed=true', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // South body: 10 bands + contact shadow (1) + top cap (1) + 4 bevels = 16
    expect(g.rect.mock.calls.length).toBe(16);
  });

  it('body bands extend downward from oy + TILE_SIZE', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    const tileX = 3;
    const tileY = 2;
    drawVisibleColumn(g as never, map, tileX, tileY, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // First rect call is the first body band at oy + TILE_SIZE
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
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // East strip: 10 bands + top cap (1) + 4 bevels = 15
    expect(g.rect.mock.calls.length).toBe(15);
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
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // South body: 10 bands + east strip: 10 bands + shadow (1) + cap (1) + 4 bevels = 26
    expect(g.rect.mock.calls.length).toBe(26);
  });

  it('remembered fully-exposed also draws all faces', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawRememberedColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Same structure: body bands + strip bands + shadow + cap + bevels
    expect(g.rect.mock.calls.length).toBeGreaterThan(5);
    // Should have body + strip + shadow + cap + bevels
    // 10 body + 10 strip + 1 shadow + 1 cap + 4 bevels = 26
    expect(g.rect.mock.calls.length).toBe(26);
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
    // height=0 means no body/strip/shadow regardless of exposure
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
// Deep shaft band count — BODY_BANDS = 10
// ══════════════════════════════════════════════════════════════════════════════

describe('deep shaft band count', () => {
  it('south body draws exactly 10 depth-fade bands for full height', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // Total = 10 south bands + 1 shadow + 1 cap + 4 bevels = 16
    // So body bands = total - 6 (shadow + cap + 4 bevels) = 10
    const totalRects = g.rect.mock.calls.length;
    const bodyBands = totalRects - 6; // minus shadow(1) + cap(1) + bevels(4)
    expect(bodyBands).toBe(10);
  });

  it('east strip draws exactly 10 depth-fade bands for full height', () => {
    const g = mockGraphics();
    const map = floorMap();
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // Total = 10 east bands + 1 cap + 4 bevels = 15
    // So strip bands = total - 5 (cap + 4 bevels) = 10
    const totalRects = g.rect.mock.calls.length;
    const stripBands = totalRects - 5; // minus cap(1) + bevels(4)
    expect(stripBands).toBe(10);
  });

  it('body bands adapt when height is less than band count', () => {
    const g = mockGraphics();
    const map = floorMap();
    // columnHeight=3 → min(10, 3) = 3 bands
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 3,
      southExposed: true,
      eastExposed: false,
    });
    // 3 south bands + 1 shadow + 1 cap + 4 bevels = 9
    expect(g.rect.mock.calls.length).toBe(9);
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
    // Should have multiple draw calls: body bands + strip bands + shadow + top cap + bevels
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

  it('passes through exposure flags', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumnLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // Should draw south body bands (10) + shadow (1) + cap (1) + bevels (4) = 16
    expect(g.rect.mock.calls.length).toBe(16);
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
    drawRememberedColumnLocal(g as never, map, 5, 5, {
      columnHeight: COLUMN_REMEMBERED_HEIGHT,
      southExposed: false,
      eastExposed: true,
    });
    // East strip only: 10 bands + cap (1) + bevels (4) = 15
    expect(g.rect.mock.calls.length).toBe(15);
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

// ══════════════════════════════════════════════════════════════════════════════
// Top cap pinning — column body extends downward, cap stays at (ox, oy)
// ══════════════════════════════════════════════════════════════════════════════

describe('top cap pinning', () => {
  it('top cap is always at (ox, oy) regardless of column height', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 2, 3, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    // Find the top cap call — it's after body bands (10) + strip bands (10) + shadow (1) = 21
    // Cap is call index 21
    const capRect = g.rect.mock.calls[21] as number[];
    expect(capRect[0]).toBe(2 * 32); // ox = x * TILE_SIZE
    expect(capRect[1]).toBe(3 * 32); // oy = y * TILE_SIZE
    expect(capRect[2]).toBe(32);     // TILE_SIZE width
    expect(capRect[3]).toBe(32);     // TILE_SIZE height
  });

  it('body bands start at oy + TILE_SIZE (below the cap)', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 1, 1, {
      columnHeight: 30,
      southExposed: true,
    });
    // First body band starts at oy + TILE_SIZE
    const firstBodyRect = g.rect.mock.calls[0] as number[];
    expect(firstBodyRect[1]).toBe(1 * 32 + 32); // oy + TILE_SIZE
  });

  it('cap position is the same regardless of column height (no yOffset)', () => {
    // Verify that different column heights produce the same cap position
    const gShort = mockGraphics();
    const gTall = mockGraphics();
    const map = floorMap(10, 10);

    // Short column: height=0 → cap is first rect
    drawVisibleColumn(gShort as never, map, 3, 4, { columnHeight: 0 });
    const shortCap = gShort.rect.mock.calls[0] as number[];

    // Tall column with south+east exposed: cap is after body(10)+strip(10)+shadow(1)=21
    drawVisibleColumn(gTall as never, map, 3, 4, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: true,
    });
    const tallCap = gTall.rect.mock.calls[21] as number[];

    // Cap position must be identical regardless of height
    expect(shortCap[0]).toBe(tallCap[0]); // same x
    expect(shortCap[1]).toBe(tallCap[1]); // same y
    expect(shortCap[2]).toBe(tallCap[2]); // same width
    expect(shortCap[3]).toBe(tallCap[3]); // same height
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Depth fade aggressiveness — body bands should approach abyss color
// ══════════════════════════════════════════════════════════════════════════════

describe('depth fade', () => {
  it('bottom body band color is very close to abyss', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    // Last body band is call index 9 (10 bands, 0-indexed)
    // The t value for the last band = (9 + 0.5) / 10 = 0.95
    // lerpColor(body, abyss, 0.95 * 0.95) = lerpColor(body, abyss, 0.9025)
    // This should be very close to abyss (0x0a0a12)
    const lastBodyCall = g.setFillStyle.mock.calls[9] as unknown[];
    const lastBodyColor = (lastBodyCall[0] as { color: number }).color;
    const [r, g2, b] = channels(lastBodyColor);
    // Should be very dark — close to abyss (10, 10, 18)
    expect(r).toBeLessThan(30);
    expect(g2).toBeLessThan(30);
    expect(b).toBeLessThan(35);
  });

  it('first body band is brighter than last body band', () => {
    const g = mockGraphics();
    const map = floorMap(10, 10);
    drawVisibleColumn(g as never, map, 0, 0, {
      columnHeight: COLUMN_MAX_HEIGHT,
      southExposed: true,
      eastExposed: false,
    });
    const firstBodyCall = g.setFillStyle.mock.calls[0] as unknown[];
    const lastBodyCall = g.setFillStyle.mock.calls[9] as unknown[];
    const firstColor = (firstBodyCall[0] as { color: number }).color;
    const lastColor = (lastBodyCall[0] as { color: number }).color;

    const [fr, fg, fb] = channels(firstColor);
    const [lr, lg, lb] = channels(lastColor);
    const firstBrightness = fr + fg + fb;
    const lastBrightness = lr + lg + lb;

    expect(firstBrightness).toBeGreaterThan(lastBrightness);
  });
});
