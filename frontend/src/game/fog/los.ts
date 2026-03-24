/**
 * Line-of-sight computation using recursive symmetric shadowcasting.
 *
 * Divides the field of view into 8 octants and scans each recursively,
 * tracking shadow angles to determine which tiles are blocked by walls.
 *
 * Reference: http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting
 */

import { type GameMap, isInBounds, isWall } from '../../game/tilemap/types.ts';

/** Result of a line-of-sight computation. */
export interface LOSResult {
  /** Set of visible tile keys in "x,y" format for fast lookup */
  visibleSet: Set<string>;
  /** Array of [x, y] tuples of visible tiles */
  visibleTiles: [number, number][];
}

/**
 * Create a string key for a tile coordinate, used for Set membership.
 * @param x - Tile x coordinate
 * @param y - Tile y coordinate
 * @returns String key in "x,y" format
 */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Octant transformation multipliers.
 * Each octant is defined by 4 multipliers (xx, xy, yx, yy) that map
 * the canonical octant scan (row, col) into actual (dx, dy) offsets.
 */
const OCTANT_TRANSFORMS: readonly [number, number, number, number][] = [
  [1, 0, 0, 1],   // octant 0: E-NE
  [0, 1, 1, 0],   // octant 1: NE-N
  [0, -1, 1, 0],  // octant 2: NW-N
  [-1, 0, 0, 1],  // octant 3: W-NW
  [-1, 0, 0, -1], // octant 4: W-SW
  [0, -1, -1, 0], // octant 5: SW-S
  [0, 1, -1, 0],  // octant 6: SE-S
  [1, 0, 0, -1],  // octant 7: E-SE
];

/**
 * Compute visible tiles from a position using symmetric shadowcasting.
 *
 * @param map - The game map
 * @param originX - Observer X position (tile coords)
 * @param originY - Observer Y position (tile coords)
 * @param radius - Vision radius in tiles (default 10)
 * @returns LOSResult with visible tile set and array
 */
export function computeLOS(
  map: GameMap,
  originX: number,
  originY: number,
  radius: number = 10,
): LOSResult {
  const visibleSet = new Set<string>();
  const visibleTiles: [number, number][] = [];

  // Helper to mark a tile as visible (deduplicates via Set)
  function markVisible(x: number, y: number): void {
    const key = tileKey(x, y);
    if (!visibleSet.has(key)) {
      visibleSet.add(key);
      visibleTiles.push([x, y]);
    }
  }

  // Origin is always visible
  markVisible(originX, originY);

  // Scan each octant
  for (const transform of OCTANT_TRANSFORMS) {
    scanOctant(map, originX, originY, radius, 1, 1.0, 0.0, transform, markVisible);
  }

  return { visibleSet, visibleTiles };
}

/**
 * Recursively scan one octant of the FOV.
 *
 * @param map - The game map
 * @param ox - Origin X
 * @param oy - Origin Y
 * @param radius - Vision radius
 * @param row - Current row being scanned (distance from origin)
 * @param startSlope - Start slope of the unblocked arc (1.0 = full open)
 * @param endSlope - End slope of the unblocked arc (0.0 = full open)
 * @param transform - Octant transformation multipliers [xx, xy, yx, yy]
 * @param markVisible - Callback to mark a tile visible
 */
function scanOctant(
  map: GameMap,
  ox: number,
  oy: number,
  radius: number,
  row: number,
  startSlope: number,
  endSlope: number,
  transform: readonly [number, number, number, number],
  markVisible: (x: number, y: number) => void,
): void {
  if (startSlope < endSlope) return;

  const [xx, xy, yx, yy] = transform;
  let currentStart = startSlope;

  for (let currentRow = row; currentRow <= radius; currentRow++) {
    let blocked = false;

    for (let col = -currentRow; col <= 0; col++) {
      // Map (row, col) in canonical octant space to actual (dx, dy)
      const dx = col * xx + currentRow * xy;
      const dy = col * yx + currentRow * yy;
      const mapX = ox + dx;
      const mapY = oy + dy;

      // Slopes for this tile's edges
      const leftSlope = (col - 0.5) / (currentRow + 0.5);
      const rightSlope = (col + 0.5) / (currentRow - 0.5);

      // Skip tiles outside the current visible arc
      if (currentStart < rightSlope) continue;
      if (endSlope > leftSlope) break;

      // Euclidean distance check
      if (dx * dx + dy * dy <= radius * radius) {
        if (isInBounds(map, mapX, mapY)) {
          markVisible(mapX, mapY);
        }
      }

      // Track shadow state
      if (blocked) {
        // Previous tile was a wall
        if (!isInBounds(map, mapX, mapY) || isWall(map, mapX, mapY)) {
          // Still blocked — update start slope
          currentStart = rightSlope;
        } else {
          // Transition from blocked to open
          blocked = false;
          currentStart = rightSlope;
        }
      } else {
        // Previous tile was open
        if (
          (!isInBounds(map, mapX, mapY) || isWall(map, mapX, mapY)) &&
          currentRow < radius
        ) {
          // Transition from open to blocked — recurse for the open arc
          blocked = true;
          scanOctant(
            map,
            ox,
            oy,
            radius,
            currentRow + 1,
            currentStart,
            rightSlope,
            transform,
            markVisible,
          );
          currentStart = rightSlope;
        }
      }
    }

    // If the last tile in the row was blocked, stop scanning further rows
    if (blocked) break;
  }
}
