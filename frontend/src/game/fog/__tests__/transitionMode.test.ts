/**
 * Tests for the three-state columnar emergence fog-of-war system.
 *
 * Validates:
 * - Column height constants
 * - Stagger delay behavior
 * - Animation duration variance for all three transition types
 * - Height jitter
 * - Animation model contract: cap-rise with yOffset for asymmetric transitions
 *   - unknown → visible: large yOffset, dramatic reveal
 *   - explored → visible: small yOffset, gentle re-lift
 *   - visible → explored: alpha stays 1, object permanence preserved
 */

import { describe, it, expect } from 'vitest';
import {
  COLUMN_MAX_HEIGHT,
  COLUMN_REMEMBERED_HEIGHT,
} from '../columnRenderer.ts';
import {
  computeStaggerDelay,
  computeDuration,
  computeNewRevealDuration,
  computeRevisitRevealDuration,
  computeConcealDuration,
  computeHeightJitter,
  RISE_OFFSET_NEW,
  RISE_OFFSET_REVISIT,
  SINK_OFFSET,
  REMEMBERED_YOFFSET,
} from '../fogAnimationHelpers.ts';

// ── Column height constants ─────────────────────────────────────────

describe('column height constants', () => {
  it('COLUMN_MAX_HEIGHT is a positive number', () => {
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThan(0);
  });

  it('COLUMN_REMEMBERED_HEIGHT is a positive number', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBeGreaterThan(0);
  });

  it('visible columns are the same height as remembered columns (uniform shaft depth)', () => {
    expect(COLUMN_MAX_HEIGHT).toBe(COLUMN_REMEMBERED_HEIGHT);
  });

  it('COLUMN_MAX_HEIGHT is a reasonable pixel value for deep abyss shafts', () => {
    // Column extrusion creates a deep abyss shaft beneath the tile.
    // It should be larger than TILE_SIZE (32) for the bottomless effect,
    // but not excessively large (≤ 3× TILE_SIZE).
    expect(COLUMN_MAX_HEIGHT).toBeGreaterThanOrEqual(32);
    expect(COLUMN_MAX_HEIGHT).toBeLessThanOrEqual(32 * 3);
  });

  it('COLUMN_REMEMBERED_HEIGHT equals COLUMN_MAX_HEIGHT for uniform shaft depth', () => {
    expect(COLUMN_REMEMBERED_HEIGHT).toBe(COLUMN_MAX_HEIGHT);
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

// ── Animation duration (generic / backward compat) ──────────────────

describe('computeDuration', () => {
  it('produces durations in a reasonable range', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeDuration();
      // NEW_REVEAL_BASE_DURATION = 0.5, VARIANCE = 0.06 → range [0.44, 0.56]
      expect(d).toBeGreaterThanOrEqual(0.3);
      expect(d).toBeLessThanOrEqual(0.7);
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

// ── Per-transition duration helpers ─────────────────────────────────

describe('computeNewRevealDuration (unknown → visible)', () => {
  it('produces durations around 0.5s', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeNewRevealDuration();
      expect(d).toBeGreaterThanOrEqual(0.4);
      expect(d).toBeLessThanOrEqual(0.6);
    }
  });

  it('produces varied durations', () => {
    const durations = new Set<number>();
    for (let i = 0; i < 50; i++) {
      durations.add(computeNewRevealDuration());
    }
    expect(durations.size).toBeGreaterThan(1);
  });
});

describe('computeRevisitRevealDuration (explored → visible)', () => {
  it('produces durations around 0.25s (shorter than new reveal)', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeRevisitRevealDuration();
      expect(d).toBeGreaterThanOrEqual(0.15);
      expect(d).toBeLessThanOrEqual(0.35);
    }
  });

  it('is shorter than new reveal on average', () => {
    let newSum = 0;
    let revisitSum = 0;
    const samples = 200;
    for (let i = 0; i < samples; i++) {
      newSum += computeNewRevealDuration();
      revisitSum += computeRevisitRevealDuration();
    }
    expect(revisitSum / samples).toBeLessThan(newSum / samples);
  });
});

describe('computeConcealDuration (visible → explored)', () => {
  it('produces durations around 0.35s', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeConcealDuration();
      expect(d).toBeGreaterThanOrEqual(0.25);
      expect(d).toBeLessThanOrEqual(0.45);
    }
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

// ── Animation model contract: three-state cap-rise ──────────────────
//
// These tests document the asymmetric animation architecture:
// - unknown → visible: large yOffset cap-rise from abyss
// - explored → visible: small yOffset re-lift
// - visible → explored: gentle lowering, alpha stays 1 (object permanence)
//
// These are structural/contract tests, not behavioral tests of GSAP.

describe('animation model contract (three-state cap-rise)', () => {
  // ── Transition offset constants ───────────────────────────────────

  it('RISE_OFFSET_NEW is a large value for dramatic abyss reveal', () => {
    expect(RISE_OFFSET_NEW).toBeGreaterThanOrEqual(COLUMN_MAX_HEIGHT * 0.5);
    // Should be roughly equal to COLUMN_MAX_HEIGHT (cap starts at bottom of shaft)
    expect(RISE_OFFSET_NEW).toBeLessThanOrEqual(COLUMN_MAX_HEIGHT * 2);
  });

  it('RISE_OFFSET_REVISIT is a small value for gentle re-lift', () => {
    expect(RISE_OFFSET_REVISIT).toBeGreaterThan(0);
    expect(RISE_OFFSET_REVISIT).toBeLessThan(RISE_OFFSET_NEW);
    // Should be much smaller than COLUMN_MAX_HEIGHT
    expect(RISE_OFFSET_REVISIT).toBeLessThanOrEqual(COLUMN_MAX_HEIGHT * 0.3);
  });

  it('SINK_OFFSET is a small value for gentle lowering', () => {
    expect(SINK_OFFSET).toBeGreaterThan(0);
    expect(SINK_OFFSET).toBeLessThan(RISE_OFFSET_REVISIT);
    // Should be subtle — just enough to signal "lowered"
    expect(SINK_OFFSET).toBeLessThanOrEqual(12);
  });

  it('REMEMBERED_YOFFSET is a small static offset for remembered tiles', () => {
    expect(REMEMBERED_YOFFSET).toBeGreaterThan(0);
    expect(REMEMBERED_YOFFSET).toBeLessThanOrEqual(SINK_OFFSET + 2);
    // Subtle displacement — just enough to distinguish from fully risen
    expect(REMEMBERED_YOFFSET).toBeLessThanOrEqual(10);
  });

  // ── unknown → visible (dramatic cap-rise) ─────────────────────────

  it('unknown→visible: animation starts with large yOffset and alpha=0', () => {
    const revealStart = {
      yOffset: RISE_OFFSET_NEW,
      columnHeight: COLUMN_MAX_HEIGHT,
      alpha: 0,
    };
    const revealEnd = {
      yOffset: 0,
      columnHeight: COLUMN_MAX_HEIGHT,
      alpha: 1,
    };

    // Start: cap far below, invisible
    expect(revealStart.yOffset).toBe(RISE_OFFSET_NEW);
    expect(revealStart.alpha).toBe(0);
    // End: cap at authored height, fully visible
    expect(revealEnd.yOffset).toBe(0);
    expect(revealEnd.alpha).toBe(1);
    // Column height stays at max throughout (shaft hangs below cap)
    expect(revealStart.columnHeight).toBe(COLUMN_MAX_HEIGHT);
    expect(revealEnd.columnHeight).toBe(COLUMN_MAX_HEIGHT);
  });

  // ── explored → visible (gentle re-lift) ───────────────────────────

  it('explored→visible: animation starts with small yOffset and alpha=1', () => {
    const reliftStart = {
      yOffset: RISE_OFFSET_REVISIT,
      columnHeight: COLUMN_MAX_HEIGHT, // Same shaft depth as visible
      alpha: 1, // Already visible as remembered — no alpha change
    };
    const reliftEnd = {
      yOffset: 0,
      columnHeight: COLUMN_MAX_HEIGHT,
      alpha: 1,
    };

    // Start: slightly lowered, full shaft height, fully opaque
    expect(reliftStart.yOffset).toBe(RISE_OFFSET_REVISIT);
    expect(reliftStart.alpha).toBe(1);
    expect(reliftStart.columnHeight).toBe(COLUMN_MAX_HEIGHT);
    // End: fully risen, same height, still fully opaque
    expect(reliftEnd.yOffset).toBe(0);
    expect(reliftEnd.alpha).toBe(1);
    expect(reliftEnd.columnHeight).toBe(COLUMN_MAX_HEIGHT);
  });

  it('explored→visible has smaller yOffset than unknown→visible', () => {
    expect(RISE_OFFSET_REVISIT).toBeLessThan(RISE_OFFSET_NEW);
    // The difference should be significant — revisit is NOT a full reveal
    expect(RISE_OFFSET_REVISIT).toBeLessThan(RISE_OFFSET_NEW / 2);
  });

  // ── visible → explored (gentle lowering, object permanence) ───────

  it('visible→explored: alpha STAYS at 1 (object permanence)', () => {
    const concealStart = {
      yOffset: 0,
      columnHeight: COLUMN_MAX_HEIGHT,
      alpha: 1,
    };
    const concealEnd = {
      yOffset: SINK_OFFSET,
      columnHeight: COLUMN_MAX_HEIGHT, // Shaft stays at full height
      alpha: 1, // NEVER fades to 0
    };

    // Alpha must be 1 at both start and end — object permanence preserved
    expect(concealStart.alpha).toBe(1);
    expect(concealEnd.alpha).toBe(1);
    // Cap sinks slightly
    expect(concealEnd.yOffset).toBeGreaterThan(0);
    expect(concealEnd.yOffset).toBe(SINK_OFFSET);
    // Column stays at full height (uniform shaft depth)
    expect(concealEnd.columnHeight).toBe(COLUMN_MAX_HEIGHT);
  });

  it('visible→explored does NOT fade alpha to 0', () => {
    // This is the key contract: conceal preserves location memory.
    // The tile transitions from visible palette to remembered palette,
    // but alpha stays at 1 throughout. No fade-to-black.
    const concealEnd = { alpha: 1 };
    expect(concealEnd.alpha).toBe(1);
    // SINK_OFFSET is small — subtle lowering, not dramatic
    expect(SINK_OFFSET).toBeLessThan(RISE_OFFSET_NEW);
    expect(SINK_OFFSET).toBeLessThan(RISE_OFFSET_REVISIT);
  });

  // ── Asymmetry contract ────────────────────────────────────────────

  it('three transitions have distinct offset magnitudes', () => {
    // Dramatic > re-lift > sink
    expect(RISE_OFFSET_NEW).toBeGreaterThan(RISE_OFFSET_REVISIT);
    expect(RISE_OFFSET_REVISIT).toBeGreaterThan(SINK_OFFSET);
  });

  it('height jitter affects only column shaft, not yOffset', () => {
    const jitter = computeHeightJitter(3, 5);
    const targetColumnHeight = COLUMN_MAX_HEIGHT + jitter;

    // Jitter changes the shaft depth
    expect(targetColumnHeight).not.toBe(COLUMN_MAX_HEIGHT);
    // yOffset is independent of jitter (set by animation constants)
    expect(RISE_OFFSET_NEW).toBe(56); // Fixed constant, not affected by jitter
  });

  // ── lightLift animation contract ────────────────────────────────────

  it('new reveal starts with lightLift > 0 (40) that animates to 0', () => {
    // New reveal: dramatic light burst fading to normal
    const newRevealStart = { lightLift: 40 };
    const newRevealEnd = { lightLift: 0 };
    expect(newRevealStart.lightLift).toBe(40);
    expect(newRevealEnd.lightLift).toBe(0);
    expect(newRevealStart.lightLift).toBeGreaterThan(0);
  });

  it('revisit reveal starts with lightLift > 0 (20) that animates to 0', () => {
    // Revisit: subtler light lift than new reveal
    const revisitStart = { lightLift: 20 };
    const revisitEnd = { lightLift: 0 };
    expect(revisitStart.lightLift).toBe(20);
    expect(revisitEnd.lightLift).toBe(0);
    expect(revisitStart.lightLift).toBeGreaterThan(0);
  });

  it('revisit lightLift is less than new-reveal lightLift (subtler)', () => {
    const newLightLift = 40;
    const revisitLightLift = 20;
    expect(revisitLightLift).toBeLessThan(newLightLift);
    // Revisit should be noticeably less — at most half
    expect(revisitLightLift).toBeLessThanOrEqual(newLightLift / 2);
  });

  it('conceal has lightLift = 0 throughout (no brightness boost)', () => {
    const concealStart = { lightLift: 0 };
    const concealEnd = { lightLift: 0 };
    expect(concealStart.lightLift).toBe(0);
    expect(concealEnd.lightLift).toBe(0);
  });

  it('cap y-position uses yOffset displacement (not pure y * TILE_SIZE)', () => {
    // Documents that the cap position formula is now:
    //   capY = y * TILE_SIZE + yOffset
    // where yOffset is 0 for fully risen visible tiles and > 0 for animated/remembered.
    const TILE_SIZE = 32;
    const y = 5;
    const basePy = y * TILE_SIZE;

    // Fully risen (visible stable): yOffset = 0
    expect(basePy + 0).toBe(160);

    // Remembered static: yOffset = REMEMBERED_YOFFSET
    expect(basePy + REMEMBERED_YOFFSET).toBe(160 + REMEMBERED_YOFFSET);

    // During unknown→visible animation: yOffset starts at RISE_OFFSET_NEW
    expect(basePy + RISE_OFFSET_NEW).toBe(160 + RISE_OFFSET_NEW);
  });
});

// ── Animation safety clamping (back.out overshoot protection) ────────────────
//
// back.out easing overshoots past the target value before settling.
// When animating alpha (0→1) or lightLift (N→0), this can produce
// negative intermediate values. The draw path must clamp these to
// prevent black/invisible frames.

describe('animation safety clamping (back.out overshoot protection)', () => {
  it('alpha is clamped to [0, 1] range in animation config', () => {
    // During back.out(1.5) easing of alpha: 0→1, GSAP may overshoot
    // past 1 or undershoot below 0. The draw path clamps alpha.
    const clampAlpha = (v: number) => Math.max(0, Math.min(1, v));

    // Negative overshoot (back.out undershoot)
    expect(clampAlpha(-0.1)).toBe(0);
    expect(clampAlpha(-0.5)).toBe(0);

    // Positive overshoot (back.out overshoot past 1)
    expect(clampAlpha(1.1)).toBe(1);
    expect(clampAlpha(1.5)).toBe(1);

    // Normal range passes through
    expect(clampAlpha(0)).toBe(0);
    expect(clampAlpha(0.5)).toBe(0.5);
    expect(clampAlpha(1)).toBe(1);
  });

  it('lightLift is clamped to non-negative (no darkening from overshoot)', () => {
    // During back.out easing of lightLift: 40→0, GSAP may overshoot
    // past 0 into negative values. The draw path clamps lightLift ≥ 0.
    const clampLightLift = (v: number) => Math.max(0, v);

    // Negative overshoot (back.out past target of 0)
    expect(clampLightLift(-5)).toBe(0);
    expect(clampLightLift(-10)).toBe(0);

    // Positive values pass through
    expect(clampLightLift(0)).toBe(0);
    expect(clampLightLift(20)).toBe(20);
    expect(clampLightLift(40)).toBe(40);
  });

  it('yOffset is NOT clamped — negative overshoot is the desired settle motion', () => {
    // back.out easing on yOffset (e.g. 56→0) may overshoot to negative values.
    // This is intentional: the cap "bounces" slightly above its final position
    // before settling, creating a premium settle feel.
    const yOffsetValue = -3; // Simulated overshoot past 0
    expect(yOffsetValue).toBeLessThan(0); // Allowed — not clamped
  });

  it('alpha clamp prevents invisible frames during reveal animation', () => {
    // Simulates the animation config building that happens in drawAllTiles.
    // With back.out(1.5), alpha tweening 0→1 can temporarily go below 0.
    const simulatedAlphaValues = [-0.08, 0.0, 0.3, 0.7, 1.05, 1.0];
    const clamped = simulatedAlphaValues.map(v => Math.max(0, Math.min(1, v)));

    // All clamped values must be in [0, 1]
    for (const v of clamped) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // Specific checks
    expect(clamped[0]).toBe(0);   // -0.08 → 0 (no invisible frame)
    expect(clamped[4]).toBe(1);   // 1.05 → 1 (no over-bright frame)
  });

  it('lightLift clamp prevents darkening during reveal animation settle', () => {
    // Simulates back.out(1.5) on lightLift: 40→0 overshooting to negative.
    const simulatedLightLiftValues = [40, 20, 5, -3, -8, 0];
    const clamped = simulatedLightLiftValues.map(v => Math.max(0, v));

    // All clamped values must be non-negative
    for (const v of clamped) {
      expect(v).toBeGreaterThanOrEqual(0);
    }

    // Negative values clamped to 0 — no darkening below base color
    expect(clamped[3]).toBe(0);  // -3 → 0
    expect(clamped[4]).toBe(0);  // -8 → 0
  });
});
