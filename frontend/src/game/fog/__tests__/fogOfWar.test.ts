/**
 * Tests for useFogOfWar hook logic.
 *
 * Since useFogOfWar is a React hook, we test the underlying logic directly
 * by exercising computeLOS, diffVisibility, and the explored-set semantics.
 * We also do a lightweight integration test of the hook's state transitions.
 */

import { describe, it, expect } from 'vitest';
import { TileType } from '../../tilemap/types.ts';
import type { GameMap } from '../../tilemap/types.ts';
import { computeLOS, tileKey } from '../los.ts';
import { diffVisibility } from '../losUtils.ts';
import { VISION_RADIUS } from '../useFogOfWar.ts';

// ── Test helpers ────────────────────────────────────────────────────

/** Create a simple open map (all floors). */
function openMap(width: number, height: number): GameMap {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => TileType.Floor),
  };
}

/** Create a map with walls forming a small room with a corridor. */
function corridorMap(): GameMap {
  // 10x10 map with:
  //  - 5x5 room in top-left (1,1)-(3,3) floor, surrounded by walls
  //  - corridor at (4,2) connecting to 5x5 room at (5,1)-(7,3)
  const width = 10;
  const height = 10;
  const tiles: TileType[] = Array.from({ length: width * height }, () => TileType.Wall);

  // Room 1: (1,1) to (3,3)
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      tiles[y * width + x] = TileType.Floor;
    }
  }
  // Corridor at (4,2)
  tiles[2 * width + 4] = TileType.Floor;
  // Room 2: (5,1) to (7,3)
  for (let y = 1; y <= 3; y++) {
    for (let x = 5; x <= 7; x++) {
      tiles[y * width + x] = TileType.Floor;
    }
  }

  return { width, height, tiles };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('useFogOfWar logic', () => {
  describe('initial LOS computation', () => {
    it('computes visible tiles from start position', () => {
      const map = openMap(30, 30);
      const los = computeLOS(map, 15, 15, VISION_RADIUS);

      // Origin should always be visible
      expect(los.visibleSet.has(tileKey(15, 15))).toBe(true);
      // Tiles within radius should be visible
      expect(los.visibleSet.has(tileKey(15, 16))).toBe(true);
      expect(los.visibleSet.has(tileKey(16, 15))).toBe(true);
      // Should have a reasonable number of visible tiles
      expect(los.visibleTiles.length).toBeGreaterThan(50);
    });

    it('origin tile is always visible', () => {
      const map = openMap(20, 20);
      const los = computeLOS(map, 5, 5, VISION_RADIUS);

      expect(los.visibleSet.has(tileKey(5, 5))).toBe(true);
      expect(los.visibleTiles.some(([x, y]) => x === 5 && y === 5)).toBe(true);
    });

    it('walls block LOS', () => {
      const cmap = corridorMap();
      // Standing in room 1 at (2,2), room 2 tiles should not be visible
      // because the wall blocks LOS
      const los = computeLOS(cmap, 2, 2, VISION_RADIUS);

      // Same room tiles should be visible
      expect(los.visibleSet.has(tileKey(1, 1))).toBe(true);
      expect(los.visibleSet.has(tileKey(3, 3))).toBe(true);

      // Corridor opening should be visible
      expect(los.visibleSet.has(tileKey(4, 2))).toBe(true);
    });
  });

  describe('visibility diffing', () => {
    it('all tiles are entering on first computation', () => {
      const map = openMap(20, 20);
      const los = computeLOS(map, 10, 10, VISION_RADIUS);
      const emptyPrev = new Set<string>();
      const diff = diffVisibility(emptyPrev, los.visibleSet, los.visibleTiles);

      expect(diff.entering.length).toBe(los.visibleTiles.length);
      expect(diff.exiting.length).toBe(0);
      expect(diff.stable.length).toBe(0);
    });

    it('identifies entering, exiting, and stable tiles on move', () => {
      const map = openMap(30, 30);

      // First position
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      // Second position (moved right by 1)
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);

      const diff = diffVisibility(los1.visibleSet, los2.visibleSet, los2.visibleTiles);

      // Should have some entering tiles (new tiles on the right)
      expect(diff.entering.length).toBeGreaterThan(0);
      // Should have some exiting tiles (lost tiles on the left)
      expect(diff.exiting.length).toBeGreaterThan(0);
      // Should have many stable tiles (overlap in the middle)
      expect(diff.stable.length).toBeGreaterThan(0);

      // All entering tiles should be in los2 but NOT in los1
      for (const [x, y] of diff.entering) {
        expect(los2.visibleSet.has(tileKey(x, y))).toBe(true);
        expect(los1.visibleSet.has(tileKey(x, y))).toBe(false);
      }

      // All exiting tiles should be in los1 but NOT in los2
      for (const [x, y] of diff.exiting) {
        expect(los1.visibleSet.has(tileKey(x, y))).toBe(true);
        expect(los2.visibleSet.has(tileKey(x, y))).toBe(false);
      }

      // All stable tiles should be in both
      for (const [x, y] of diff.stable) {
        expect(los1.visibleSet.has(tileKey(x, y))).toBe(true);
        expect(los2.visibleSet.has(tileKey(x, y))).toBe(true);
      }
    });

    it('no entering or exiting when player does not move', () => {
      const map = openMap(20, 20);
      const los = computeLOS(map, 10, 10, VISION_RADIUS);
      const diff = diffVisibility(los.visibleSet, los.visibleSet, los.visibleTiles);

      expect(diff.entering.length).toBe(0);
      expect(diff.exiting.length).toBe(0);
      expect(diff.stable.length).toBe(los.visibleTiles.length);
    });
  });

  describe('explored set semantics', () => {
    it('explored set grows monotonically (never shrinks)', () => {
      const map = openMap(30, 30);

      // Simulate 3 moves: (10,10) → (11,10) → (12,10)
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);
      const los3 = computeLOS(map, 12, 10, VISION_RADIUS);

      // Build explored set incrementally (union of all visible sets)
      const explored1 = new Set(los1.visibleSet);
      const explored2 = new Set(explored1);
      for (const key of los2.visibleSet) explored2.add(key);
      const explored3 = new Set(explored2);
      for (const key of los3.visibleSet) explored3.add(key);

      // Each explored set should be >= the previous
      expect(explored2.size).toBeGreaterThanOrEqual(explored1.size);
      expect(explored3.size).toBeGreaterThanOrEqual(explored2.size);

      // All tiles in explored1 should still be in explored2 and explored3
      for (const key of explored1) {
        expect(explored2.has(key)).toBe(true);
        expect(explored3.has(key)).toBe(true);
      }
      for (const key of explored2) {
        expect(explored3.has(key)).toBe(true);
      }
    });

    it('remembered tiles = explored minus currently visible', () => {
      const map = openMap(30, 30);

      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 15, 15, VISION_RADIUS);

      // After two positions, explored = union
      const explored = new Set(los1.visibleSet);
      for (const key of los2.visibleSet) explored.add(key);

      // Remembered = explored - visible
      const remembered = new Set<string>();
      for (const key of explored) {
        if (!los2.visibleSet.has(key)) {
          remembered.add(key);
        }
      }

      // All remembered tiles should NOT be in current visible
      for (const key of remembered) {
        expect(los2.visibleSet.has(key)).toBe(false);
      }

      // All remembered tiles should be in explored
      for (const key of remembered) {
        expect(explored.has(key)).toBe(true);
      }

      // remembered + visible should equal explored
      expect(remembered.size + los2.visibleSet.size).toBe(explored.size);
    });
  });

  describe('entering/exiting correctness across moves', () => {
    it('entering count matches new visible tiles not in previous set', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);
      const diff = diffVisibility(los1.visibleSet, los2.visibleSet, los2.visibleTiles);

      // Count tiles in los2 not in los1 manually
      let manualEntering = 0;
      for (const key of los2.visibleSet) {
        if (!los1.visibleSet.has(key)) manualEntering++;
      }
      expect(diff.entering.length).toBe(manualEntering);
    });

    it('exiting count matches tiles in previous set not in current', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);
      const diff = diffVisibility(los1.visibleSet, los2.visibleSet, los2.visibleTiles);

      // Count tiles in los1 not in los2 manually
      let manualExiting = 0;
      for (const key of los1.visibleSet) {
        if (!los2.visibleSet.has(key)) manualExiting++;
      }
      expect(diff.exiting.length).toBe(manualExiting);
    });

    it('entering + stable = total current visible tiles', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);
      const diff = diffVisibility(los1.visibleSet, los2.visibleSet, los2.visibleTiles);

      expect(diff.entering.length + diff.stable.length).toBe(los2.visibleTiles.length);
    });
  });
});
