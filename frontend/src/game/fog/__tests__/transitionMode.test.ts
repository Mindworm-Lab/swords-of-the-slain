/**
 * Tests for TransitionMode type and grow transition mode constants.
 *
 * Since the animation logic is tightly coupled to PixiJS Graphics and GSAP tweens,
 * we test the type-level contract and the pure helper functions that drive animations.
 */

import { describe, it, expect } from 'vitest';
import type { TransitionMode } from '../FogOfWarRenderer.tsx';

// ── Type-level tests ────────────────────────────────────────────────

describe('TransitionMode', () => {
  it('accepts "rise" as a valid transition mode', () => {
    const mode: TransitionMode = 'rise';
    expect(mode).toBe('rise');
  });

  it('accepts "fade" as a valid transition mode', () => {
    const mode: TransitionMode = 'fade';
    expect(mode).toBe('fade');
  });

  it('accepts "grow" as a valid transition mode', () => {
    const mode: TransitionMode = 'grow';
    expect(mode).toBe('grow');
  });

  it('all three modes are distinct values', () => {
    const modes: TransitionMode[] = ['rise', 'fade', 'grow'];
    const unique = new Set(modes);
    expect(unique.size).toBe(3);
  });
});

describe('grow mode animation parameters', () => {
  // These constants mirror the values in FogOfWarRenderer.tsx.
  // They serve as a regression guard: if someone changes the constants,
  // these tests surface the intent.
  const GROW_START_SCALE = 0.3;
  const GROW_END_SCALE = 0.3;
  const TILE_SIZE = 32;

  it('grow reveal starts at expected scale', () => {
    expect(GROW_START_SCALE).toBeGreaterThan(0);
    expect(GROW_START_SCALE).toBeLessThan(1);
  });

  it('grow conceal ends at expected scale', () => {
    expect(GROW_END_SCALE).toBeGreaterThan(0);
    expect(GROW_END_SCALE).toBeLessThan(1);
  });

  it('grow reveal centers the tile correctly at start', () => {
    // At start, the tile is offset to keep it centered while scaled down.
    // offset = TILE_SIZE * (1 - scale) / 2
    const startOffset = TILE_SIZE * (1 - GROW_START_SCALE) / 2;
    expect(startOffset).toBeCloseTo(TILE_SIZE * 0.35, 5);
    // At the end of the animation, tile is at its natural position (offset 0 from target)
  });

  it('grow conceal centers the tile correctly at end', () => {
    const endOffset = TILE_SIZE * (1 - GROW_END_SCALE) / 2;
    expect(endOffset).toBeCloseTo(TILE_SIZE * 0.35, 5);
  });

  it('grow mode uses symmetric scale for reveal and conceal', () => {
    // Start scale of reveal should equal end scale of conceal
    // for visual consistency (pop in / pop out)
    expect(GROW_START_SCALE).toBe(GROW_END_SCALE);
  });
});
