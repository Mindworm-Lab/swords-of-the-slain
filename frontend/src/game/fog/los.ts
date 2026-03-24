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
 * Each entry [xx, xy, yx, yy] transforms (row, col) in octant-local space
 * into (dx, dy) in map space: dx = col*xx + row*xy, dy = col*yx + row*yy
 *
 * The 8 octants cover all 360° of the FOV.
 */
const OCTANT_MULTIPLIERS: readonly [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
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
  const radiusSq = radius * radius;

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
    castOctant(map, originX, originY, radiusSq, 1, 1.0, 0.0, mult, markVisible);
  }

  return { visibleSet, visibleTiles };
}

/**
 * Recursively scan one octant of the FOV.
 *
 * In each octant, we scan outward row by row (row = distance from origin).
 * Within each row, we iterate columns from 0 up to row.
 * A "slope" is column / row, ranging from 0.0 (directly along an axis)
 * to 1.0 (at 45° diagonal). We track the start and end slopes of the
 * visible arc and narrow them when walls are encountered.
 *
 * @param map - The game map
 * @param ox - Origin X
 * @param oy - Origin Y
 * @param radiusSq - Squared vision radius
 * @param row - Current row being scanned (distance from origin, starts at 1)
 * @param startSlope - Start slope of visible arc (starts at 1.0)
 * @param endSlope - End slope of visible arc (starts at 0.0)
 * @param mult - Octant transformation [xx, xy, yx, yy]
 * @param markVisible - Callback to mark a tile visible
 */
function castOctant(
  map: GameMap,
  ox: number,
  oy: number,
  radiusSq: number,
  row: number,
  startSlope: number,
  endSlope: number,
  mult: readonly [number, number, number, number],
  markVisible: (x: number, y: number) => void,
): void {
  if (startSlope < endSlope) return;

  const [xx, xy, yx, yy] = mult;
  let nextStartSlope = startSlope;

  for (let i = row; i * i <= radiusSq; i++) {
    let blocked = false;

    for (let j = 0; j <= i; j++) {
      // Slope of this column relative to the row
      const leftSlope = (j - 0.5) / (i + 0.5);
      const rightSlope = (j + 0.5) / (i - 0.5);

      // If tile is past the start of the visible arc, skip
      if (rightSlope > nextStartSlope) continue;
      // If tile is before the end of the visible arc, stop this row
      if (leftSlope < endSlope) break;

      // Transform octant-local (row=i, col=j) to map-space delta
      const dx = j * xx + i * xy;
      const dy = j * yx + i * yy;
      const mapX = ox + dx;
      const mapY = oy + dy;

      // Distance check (Euclidean, squared)
      if (dx * dx + dy * dy <= radiusSq) {
        if (isInBounds(map, mapX, mapY)) {
          markVisible(mapX, mapY);
        }
      }

      // Wall/blocking logic
      const tileBlocks = !isInBounds(map, mapX, mapY) || isWall(map, mapX, mapY);

      if (blocked) {
        if (tileBlocks) {
          // Still in shadow — update the next start slope
          nextStartSlope = rightSlope;
        } else {
          // Emerged from shadow
          blocked = false;
          nextStartSlope = rightSlope;
        }
      } else if (tileBlocks) {
        // Entering shadow — recurse for the remaining open arc
        blocked = true;
        castOctant(
          map,
          ox,
          oy,
          radiusSq,
          i + 1,
          nextStartSlope,
          rightSlope,
          mult,
          markVisible,
        );
        nextStartSlope = rightSlope;
      }
    }

    // If the entire row ended blocked, stop
    if (blocked) return;
  }
}
