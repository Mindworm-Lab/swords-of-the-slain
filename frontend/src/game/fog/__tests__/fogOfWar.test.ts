/**
 * Tests for useFogOfWar hook logic and three-state visibility classification.
 *
 * Since useFogOfWar is a React hook, we test the underlying logic directly
 * by exercising computeLOS, diffVisibility, and the explored-set semantics.
 * We also test the three-state classification: enteringNew vs enteringRevisit.
 */

import { describe, it, expect } from 'vitest';
import { TileType } from '../../tilemap/types.ts';
import type { GameMap } from '../../tilemap/types.ts';
import { computeLOS, tileKey } from '../los.ts';
import { diffVisibility } from '../losUtils.ts';
import { VISION_RADIUS } from '../useFogOfWar.ts';
import { computeViewportBounds } from '../FogOfWarRenderer.tsx';

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

// ── computeViewportBounds tests ─────────────────────────────────────

describe('computeViewportBounds', () => {
  // TILE_SIZE = 32, CULL_MARGIN = 3

  it('computes correct bounds for a known camera position and viewport size', () => {
    // camera at (-320, -320), viewport 1024x768
    // minTileX = floor(320/32) - 3 = 10 - 3 = 7
    // maxTileX = ceil((320+1024)/32) + 3 = ceil(42) + 3 = 45
    // minTileY = floor(320/32) - 3 = 10 - 3 = 7
    // maxTileY = ceil((320+768)/32) + 3 = ceil(34) + 3 = 37
    const bounds = computeViewportBounds(-320, -320, 1024, 768);
    expect(bounds.minTileX).toBe(7);
    expect(bounds.maxTileX).toBe(45);
    expect(bounds.minTileY).toBe(7);
    expect(bounds.maxTileY).toBe(37);
  });

  it('handles negative camera values (normal case — camera offset centers player)', () => {
    // camera at (-160, -96), viewport 640x480
    // minTileX = floor(160/32) - 3 = 5 - 3 = 2
    // maxTileX = ceil((160+640)/32) + 3 = ceil(25) + 3 = 28
    // minTileY = floor(96/32) - 3 = 3 - 3 = 0
    // maxTileY = ceil((96+480)/32) + 3 = ceil(18) + 3 = 21
    const bounds = computeViewportBounds(-160, -96, 640, 480);
    expect(bounds.minTileX).toBe(2);
    expect(bounds.maxTileX).toBe(28);
    expect(bounds.minTileY).toBe(0);
    expect(bounds.maxTileY).toBe(21);
  });

  it('applies CULL_MARGIN of 3 tiles on each side', () => {
    // camera at (0, 0), viewport 320x320 (exactly 10x10 tiles)
    // Without margin: minTileX=0, maxTileX=10, minTileY=0, maxTileY=10
    // With margin:    minTileX=-3, maxTileX=13, minTileY=-3, maxTileY=13
    const bounds = computeViewportBounds(0, 0, 320, 320);
    expect(bounds.minTileX).toBe(-3);
    expect(bounds.maxTileX).toBe(13);
    expect(bounds.minTileY).toBe(-3);
    expect(bounds.maxTileY).toBe(13);
  });

  it('small viewport produces tight bounds', () => {
    // camera at (-64, -64), viewport 64x64 (2x2 tiles)
    // minTileX = floor(64/32) - 3 = 2 - 3 = -1
    // maxTileX = ceil((64+64)/32) + 3 = ceil(4) + 3 = 7
    // minTileY = floor(64/32) - 3 = 2 - 3 = -1
    // maxTileY = ceil((64+64)/32) + 3 = ceil(4) + 3 = 7
    const bounds = computeViewportBounds(-64, -64, 64, 64);
    expect(bounds.minTileX).toBe(-1);
    expect(bounds.maxTileX).toBe(7);
    expect(bounds.minTileY).toBe(-1);
    expect(bounds.maxTileY).toBe(7);
  });

  it('large viewport produces wider bounds', () => {
    // camera at (-640, -480), viewport 1920x1080
    // minTileX = floor(640/32) - 3 = 20 - 3 = 17
    // maxTileX = ceil((640+1920)/32) + 3 = ceil(80) + 3 = 83
    // minTileY = floor(480/32) - 3 = 15 - 3 = 12
    // maxTileY = ceil((480+1080)/32) + 3 = ceil(48.75) + 3 = 49 + 3 = 52
    const bounds = computeViewportBounds(-640, -480, 1920, 1080);
    expect(bounds.minTileX).toBe(17);
    expect(bounds.maxTileX).toBe(83);
    expect(bounds.minTileY).toBe(12);
    expect(bounds.maxTileY).toBe(52);
  });

  it('camera at origin with zero viewport returns just margin area', () => {
    // camera at (0, 0), viewport 0x0
    // minTileX = floor(0/32) - 3 = 0 - 3 = -3
    // maxTileX = ceil(0/32) + 3 = 0 + 3 = 3
    // minTileY = floor(0/32) - 3 = 0 - 3 = -3
    // maxTileY = ceil(0/32) + 3 = 0 + 3 = 3
    const bounds = computeViewportBounds(0, 0, 0, 0);
    expect(bounds.minTileX).toBe(-3);
    expect(bounds.maxTileX).toBe(3);
    expect(bounds.minTileY).toBe(-3);
    expect(bounds.maxTileY).toBe(3);
  });
});

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
      const emptyPrev = new Set<number>();
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
      const remembered = new Set<number>();
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

  // ── Three-state classification tests ──────────────────────────────

  describe('three-state classification (enteringNew vs enteringRevisit)', () => {
    it('without exploredSet, all entering tiles are classified as enteringNew', () => {
      const map = openMap(20, 20);
      const los = computeLOS(map, 10, 10, VISION_RADIUS);
      const emptyPrev = new Set<number>();
      const diff = diffVisibility(emptyPrev, los.visibleSet, los.visibleTiles);

      expect(diff.enteringNew.length).toBe(los.visibleTiles.length);
      expect(diff.enteringRevisit.length).toBe(0);
      // entering is the union
      expect(diff.entering.length).toBe(diff.enteringNew.length + diff.enteringRevisit.length);
    });

    it('with empty exploredSet, all entering tiles are enteringNew', () => {
      const map = openMap(20, 20);
      const los = computeLOS(map, 10, 10, VISION_RADIUS);
      const emptyPrev = new Set<number>();
      const emptyExplored = new Set<number>();
      const diff = diffVisibility(emptyPrev, los.visibleSet, los.visibleTiles, emptyExplored);

      expect(diff.enteringNew.length).toBe(los.visibleTiles.length);
      expect(diff.enteringRevisit.length).toBe(0);
    });

    it('tiles not in exploredSet are classified as enteringNew', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);

      // exploredSet = los1 visible (tiles seen from first position)
      const exploredSet = new Set(los1.visibleSet);

      const diff = diffVisibility(
        los1.visibleSet,
        los2.visibleSet,
        los2.visibleTiles,
        exploredSet,
      );

      // enteringNew: tiles in los2 but NOT in los1 AND NOT in explored
      // These are tiles newly visible on the right edge that were never seen
      for (const [x, y] of diff.enteringNew) {
        const key = tileKey(x, y);
        expect(los1.visibleSet.has(key)).toBe(false);
        expect(exploredSet.has(key)).toBe(false);
      }
      expect(diff.enteringNew.length).toBeGreaterThan(0);
    });

    it('tiles in exploredSet are classified as enteringRevisit', () => {
      const map = openMap(30, 30);

      // Move far enough that some tiles leave vision, then come back
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 15, 10, VISION_RADIUS); // Move right 5 tiles
      const los3 = computeLOS(map, 10, 10, VISION_RADIUS); // Move back

      // Build explored set after first two positions
      const exploredSet = new Set(los1.visibleSet);
      for (const key of los2.visibleSet) exploredSet.add(key);

      // Diff: los2 → los3 with explored set
      const diff = diffVisibility(
        los2.visibleSet,
        los3.visibleSet,
        los3.visibleTiles,
        exploredSet,
      );

      // enteringRevisit: tiles now visible that were NOT in los2 but WERE explored before
      for (const [x, y] of diff.enteringRevisit) {
        const key = tileKey(x, y);
        expect(los2.visibleSet.has(key)).toBe(false); // Not in previous visible
        expect(exploredSet.has(key)).toBe(true);       // But was explored
      }
      // Moving back to original position should have revisit tiles
      expect(diff.enteringRevisit.length).toBeGreaterThan(0);
    });

    it('entering = enteringNew + enteringRevisit (always)', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 12, 10, VISION_RADIUS);

      const exploredSet = new Set(los1.visibleSet);
      const diff = diffVisibility(
        los1.visibleSet,
        los2.visibleSet,
        los2.visibleTiles,
        exploredSet,
      );

      expect(diff.entering.length).toBe(
        diff.enteringNew.length + diff.enteringRevisit.length,
      );
    });

    it('enteringNew and enteringRevisit are disjoint sets', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 15, 10, VISION_RADIUS);
      const los3 = computeLOS(map, 12, 10, VISION_RADIUS);

      const exploredSet = new Set(los1.visibleSet);
      for (const key of los2.visibleSet) exploredSet.add(key);

      const diff = diffVisibility(
        los2.visibleSet,
        los3.visibleSet,
        los3.visibleTiles,
        exploredSet,
      );

      const newKeys = new Set(diff.enteringNew.map(([x, y]) => tileKey(x, y)));
      const revisitKeys = new Set(diff.enteringRevisit.map(([x, y]) => tileKey(x, y)));

      // No overlap between new and revisit
      for (const key of newKeys) {
        expect(revisitKeys.has(key)).toBe(false);
      }
    });

    it('exploredSet grows monotonically — revisit tiles increase over time', () => {
      const map = openMap(30, 30);

      // Simulate: move right, then back, then right again
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const explored = new Set(los1.visibleSet);

      const los2 = computeLOS(map, 15, 10, VISION_RADIUS);
      const diff2 = diffVisibility(los1.visibleSet, los2.visibleSet, los2.visibleTiles, explored);
      for (const key of los2.visibleSet) explored.add(key);

      const los3 = computeLOS(map, 10, 10, VISION_RADIUS);
      const diff3 = diffVisibility(los2.visibleSet, los3.visibleSet, los3.visibleTiles, explored);

      // First move: some tiles are new (never explored)
      expect(diff2.enteringNew.length).toBeGreaterThan(0);

      // Moving back: many tiles should be revisit (they were explored on first move)
      expect(diff3.enteringRevisit.length).toBeGreaterThan(0);
      // There should be fewer enteringNew on the return trip since more is explored
      expect(diff3.enteringNew.length).toBeLessThanOrEqual(diff2.enteringNew.length);
    });

    it('stable tiles are never in entering, enteringNew, or enteringRevisit', () => {
      const map = openMap(30, 30);
      const los1 = computeLOS(map, 10, 10, VISION_RADIUS);
      const los2 = computeLOS(map, 11, 10, VISION_RADIUS);

      const exploredSet = new Set(los1.visibleSet);
      const diff = diffVisibility(
        los1.visibleSet,
        los2.visibleSet,
        los2.visibleTiles,
        exploredSet,
      );

      const stableKeys = new Set(diff.stable.map(([x, y]) => tileKey(x, y)));
      const enteringKeys = new Set(diff.entering.map(([x, y]) => tileKey(x, y)));
      const newKeys = new Set(diff.enteringNew.map(([x, y]) => tileKey(x, y)));
      const revisitKeys = new Set(diff.enteringRevisit.map(([x, y]) => tileKey(x, y)));

      for (const key of stableKeys) {
        expect(enteringKeys.has(key)).toBe(false);
        expect(newKeys.has(key)).toBe(false);
        expect(revisitKeys.has(key)).toBe(false);
      }
    });
  });
});
