/**
 * Tests for the columnar emergence fog-of-war system.
 *
 * Validates column height constants, stagger delay behavior,
 * and animation duration variance — the pure helpers that drive
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

  it('COLUMN_MAX_HEIGHT is a reasonable pixel value (≤ TILE_SIZE)', () => {
    // Column extrusion should be shorter than the tile itself
    expect(COLUMN_MAX_HEIGHT).toBeLessThanOrEqual(32);
  });

  it('COLUMN_REMEMBERED_HEIGHT is at least 1/4 of COLUMN_MAX_HEIGHT', () => {
    // Remembered columns should still be visually present, not invisible
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThanOrEqual(COLUMN_MAX_HEIGHT / 4);
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

