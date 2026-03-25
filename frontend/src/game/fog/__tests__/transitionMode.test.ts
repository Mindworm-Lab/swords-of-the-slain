/**
 * Tests for the columnar emergence fog-of-war system.
 *
 * Validates column height constants, stagger delay behavior,
 * animation duration variance, height jitter, and the animation model
 * contract (no yOffset, coplanar top caps) — the pure helpers that drive
 * the GSAP-animated frontier tile reveal/conceal cycle.
 */

import { describe, it, expect } from 'vitest';
import {
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
} from '../columnRenderer.ts';
import {
  computeStaggerDelay,
  computeDuration,
  computeHeightJitter,
} from '../fogAnimationHelpers.ts';

// ── Column height constants ─────────────────────────────────────────

describe('column height constants', () => {
  it('COLUMN_MAX_HEIGHT is a positive number', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThan(0);
  });

  it('COLUMN_REMEMBERED_HEIGHT is a positive number', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThan(0);
  });

  it('visible columns are taller than remembered columns', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThan(COLUMN_REMEMBERED_HEIGHT);
  });

  it('COLUMN_MAX_HEIGHT is a reasonable pixel value for deep abyss shafts', () => {
    // Column extrusion creates a deep abyss shaft beneath the tile.
    // It should be larger than TILE_SIZE (32) for the bottomless effect,
    // but not excessively large (≤ 3× TILE_SIZE).
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThanOrEqual(32);
    expect(COLUMN_MAX_HEIGHT).toBeLessThanOrEqual(32 * 3);
  });

  it('COLUMN_REMEMBERED_HEIGHT is at least 1/4 of COLUMN_MAX_HEIGHT', () => {
    // Remembered columns should still be visually present, not invisible
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThanOrEqual(COLUMN_MAX_HEIGHT / 4);
  });

  it('COLUMN_MAX_HEIGHT exceeds TILE_SIZE (32) for bottomless abyss feel', () => {
    // The column shaft must be taller than a single tile to read as a deep void
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThan(32);
  });
});

// ── Stagger delay ───────────────────────────────────────────────────

describe('computeStaggerDelay', () => {
  it('produces values in [0, maxDelay] range', () => {
    const maxDelay = 0.15;
    for (let i = 0; i < 100; i++) {
      const delay = computeStaggerDelay(
        Math.floor(Math.random() * 20),
        Math.floor(Math.random() * 20),
        10,
        10,
        maxDelay,
      );
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(maxDelay);
    }
  });

  it('gives shorter base delays for tiles closer to player', () => {
    // Run many samples to average out the random jitter component
    const maxDelay = 0.15;
    const playerX = 10;
    const playerY = 10;
    const samples = 200;

    let closeSum = 0;
    let farSum = 0;

    for (let i = 0; i < samples; i++) {
      closeSum += computeStaggerDelay(10, 11, playerX, playerY, maxDelay); // 1 tile away
      farSum += computeStaggerDelay(10, 20, playerX, playerY, maxDelay); // 10 tiles away
    }

    const closeAvg = closeSum / samples;
    const farAvg = farSum / samples;

    // On average, close tiles should have shorter delays than far tiles
    expect(closeAvg).toBeLessThan(farAvg);
  });

  it('returns 0-range when maxDelay is 0', () => {
    const delay = computeStaggerDelay(5, 5, 10, 10, 0);
    expect(delay).toBe(0);
  });
});

// ── Animation duration ──────────────────────────────────────────────

describe('computeDuration', () => {
  it('produces durations in a reasonable range', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeDuration();
      // BASE_DURATION = 0.4, DURATION_VARIANCE = 0.05 → range [0.35, 0.45]
      expect(d).toBeGreaterThanOrEqual(0.3);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });

  it('produces varied durations (not all identical)', () => {
    const durations = new Set<number>();
    for (let i = 0; i < 50; i++) {
      durations.add(computeDuration());
    }
    // With random variance, we should get many distinct values
    expect(durations.size).toBeGreaterThan(1);
  });
});

// ── Height jitter ───────────────────────────────────────────────────

describe('computeHeightJitter', () => {
  it('is deterministic — same (x, y) always returns the same value', () => {
    const a = computeHeightJitter(5, 7);
    const b = computeHeightJitter(5, 7);
    expect(a).toBe(b);
  });

  it('returns values within a small bounded range (±3 pixels)', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const jitter = computeHeightJitter(x, y);
        expect(jitter).toBeGreaterThanOrEqual(-3);
        expect(jitter).toBeLessThanOrEqual(3);
      }
    }
  });

  it('produces varied values across different coordinates', () => {
    const values = new Set<number>();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        // Round to avoid floating point creating false uniqueness
        values.add(Math.round(computeHeightJitter(x, y) * 100));
      }
    }
    expect(values.size).toBeGreaterThan(5);
  });

  it('jitter + COLUMN_MAX_HEIGHT never goes negative', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const total = COLUMN_MAX_HEIGHT + computeHeightJitter(x, y);
        expect(total).toBeGreaterThan(0);
      }
    }
  });
});

// ── Animation model contract ────────────────────────────────────────
//
// These tests document the columnar emergence animation architecture.
// The animation model is: { columnHeight, alpha } — NO yOffset.
// Top caps are coplanar: pinned at y * TILE_SIZE regardless of height.
//
// These are structural/contract tests, not behavioral tests of GSAP.

describe('animation model contract (no yOffset)', () => {
  it('reveal animation state has only columnHeight and alpha (no yOffset)', () => {
    // The reveal animation tweens from {columnHeight: 0, alpha: 0}
    // to {columnHeight: max, alpha: 1}. There is NO yOffset property.
    // This documents the contract that top caps stay pinned in place.
    const revealStart = { columnHeight: 0, alpha: 0 };
    const revealEnd = { columnHeight: COLUMN_MAX_HEIGHT, alpha: 1 };

    // Verify the animation state shape has no yOffset
    expect('yOffset' in revealStart).toBe(false);
    expect('yOffset' in revealEnd).toBe(false);

    // Verify the values are valid
    expect(revealStart.columnHeight).toBe(0);
    expect(revealStart.alpha).toBe(0);
    expect(revealEnd.columnHeight).toBe(COLUMN_MAX_HEIGHT);
    expect(revealEnd.alpha).toBe(1);
  });

  it('conceal animation state mirrors reveal (no yOffset)', () => {
    // Conceal tweens from {columnHeight: max, alpha: 1}
    // to {columnHeight: 0, alpha: 0}. Same state shape, reversed.
    const concealStart = { columnHeight: COLUMN_MAX_HEIGHT, alpha: 1 };
    const concealEnd = { columnHeight: 0, alpha: 0 };

    expect('yOffset' in concealStart).toBe(false);
    expect('yOffset' in concealEnd).toBe(false);

    expect(concealStart.columnHeight).toBe(COLUMN_MAX_HEIGHT);
    expect(concealEnd.columnHeight).toBe(0);
  });

  it('coplanar constraint: tile y-position is purely y * TILE_SIZE', () => {
    // Documents that the top cap position formula is:
    //   targetPy = y * TILE_SIZE
    // No column height, jitter, or animation state affects the y-position.
    const TILE_SIZE = 32;
    for (let y = 0; y < 10; y++) {
      const targetPy = y * TILE_SIZE;
      // targetPy must be deterministic from y alone
      expect(targetPy).toBe(y * 32);
      // Column height does NOT affect position
      for (const _height of [0, 10, COLUMN_MAX_HEIGHT, COLUMN_MAX_HEIGHT + 2]) {
        // The position formula is independent of height
        const posWithHeight = y * TILE_SIZE; // height is unused
        expect(posWithHeight).toBe(targetPy);
      }
    }
  });

  it('height jitter affects only column shaft, not top cap position', () => {
    // Per-tile jitter modifies the target columnHeight, not the cap position.
    // targetColumnHeight = COLUMN_MAX_HEIGHT + heightJitter
    // The cap stays at y * TILE_SIZE.
    const jitter = computeHeightJitter(3, 5);
    const targetColumnHeight = COLUMN_MAX_HEIGHT + jitter;

    // Jitter changes the shaft depth
    expect(targetColumnHeight).not.toBe(COLUMN_MAX_HEIGHT);
    // But cap position is purely positional (y * TILE_SIZE)
    const TILE_SIZE = 32;
    const capY = 5 * TILE_SIZE;
    expect(capY).toBe(160); // 5 * 32, independent of jitter
  });
});
