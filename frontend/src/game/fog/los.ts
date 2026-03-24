/**
 * Line-of-sight computation using recursive symmetric shadowcasting.
 *
 * Divides the field of view into 8 octants and scans each recursively,
 * tracking shadow angles to determine which tiles are blocked by walls.
 *
 * Based on the algorithm described by Björn Bergström:
 * http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting
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
 * Each entry [xx, xy, yx, yy] transforms the canonical scan direction
 * into one of the 8 octants.
 *
 * In the canonical scan: row increases outward, col sweeps across.
 * dx = col*xx + row*xy
 * dy = col*yx + row*yy
 */
const OCTANT_MULTIPLIERS: readonly [number, number, number, number][] = [
  // Sweep directions covering all 8 octants
  [ 1,  0,  0,  1],
  [ 0,  1,  1,  0],
  [ 0, -1,  1,  0],
  [-1,  0,  0,  1],
  [-1,  0,  0, -1],
  [ 0, -1, -1,  0],
  [ 0,  1, -1,  0],
  [ 1,  0,  0, -1],
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
  for (const mult of OCTANT_MULTIPLIERS) {
    castOctant(map, originX, originY, radius, mult, 1, 0.0, 1.0, markVisible);
  }

  return { visibleSet, visibleTiles };
}

/**
 * Check if a tile blocks line of sight.
 */
function isBlocking(map: GameMap, x: number, y: number): boolean {
  return !isInBounds(map, x, y) || isWall(map, x, y);
}

/**
 * Recursively scan one octant of the FOV.
 *
 * The scan works outward row by row. Within each row, column j goes from
 * 0 up to row. A "slope" here is col/row, ranging from 0.0 (along the
 * primary axis) to 1.0 (the diagonal). startSlope and endSlope define
 * the visible arc within this octant.
 *
 * @param map - The game map
 * @param ox - Origin X
 * @param oy - Origin Y
 * @param radius - Vision radius
 * @param mult - Octant transformation [xx, xy, yx, yy]
 * @param row - Current row being scanned (starts at 1)
 * @param startSlope - Left edge of visible arc (0.0 = along axis)
 * @param endSlope - Right edge of visible arc (1.0 = diagonal)
 * @param markVisible - Callback to mark a tile visible
 */
function castOctant(
  map: GameMap,
  ox: number,
  oy: number,
  radius: number,
  mult: readonly [number, number, number, number],
  row: number,
  startSlope: number,
  endSlope: number,
  markVisible: (x: number, y: number) => void,
): void {
  if (startSlope > endSlope) return;

  const [xx, xy, yx, yy] = mult;
  const radiusSq = radius * radius;
  let nextStart = startSlope;

  for (let i = row; i <= radius; i++) {
    let blocked = false;

    // Determine the column range for this row based on slopes
    const minCol = Math.floor(i * nextStart);
    const maxCol = Math.ceil(i * endSlope);

    for (let j = minCol; j <= maxCol; j++) {
      // Transform to map coordinates
      const dx = j * xx + i * xy;
      const dy = j * yx + i * yy;
      const mapX = ox + dx;
      const mapY = oy + dy;

      // Slopes for this tile's left and right edges
      const leftSlope = (j - 0.5) / (i + 0.5);
      const rightSlope = (j + 0.5) / (i - 0.5);

      // If this tile's right edge is before the start of our arc, skip
      if (rightSlope < nextStart) continue;
      // If this tile's left edge is past the end of our arc, done with row
      if (leftSlope > endSlope) break;

      // Euclidean distance check
      if (dx * dx + dy * dy <= radiusSq) {
        if (isInBounds(map, mapX, mapY)) {
          markVisible(mapX, mapY);
        }
      }

      const tileBlocks = isBlocking(map, mapX, mapY);

      if (blocked) {
        if (tileBlocks) {
          // Still in shadow; update where the next open arc starts
          nextStart = rightSlope;
        } else {
          // Emerging from shadow
          blocked = false;
          nextStart = rightSlope;
        }
      } else if (tileBlocks) {
        // Entering shadow — recurse to continue scanning the open arc
        // that was before this wall
        blocked = true;
        castOctant(
          map, ox, oy, radius, mult,
          i + 1,
          nextStart,
          leftSlope,
          markVisible,
        );
        nextStart = rightSlope;
      }
    }

    if (blocked) return;
  }
}
