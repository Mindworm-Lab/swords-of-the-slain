/**
 * Core tilemap data types and accessor helpers.
 *
 * Tiles are stored in a flat row-major array: index = y * width + x.
 * This makes serialization trivial and cache-friendly for row traversal.
 */

/** Tile classification — extensible later with doors, water, etc. */
export enum TileType {
  Floor = 0,
  Wall = 1,
}

/** A rectangular grid of tiles. */
export interface GameMap {
  /** Grid width in tiles */
  readonly width: number;
  /** Grid height in tiles */
  readonly height: number;
  /** Row-major tile data: index = y * width + x */
  readonly tiles: TileType[];
}

/** Returns true if (x, y) is inside the map bounds. */
export function isInBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Returns the tile at (x, y), or undefined if out of bounds. */
export function getTile(
  map: GameMap,
  x: number,
  y: number,
): TileType | undefined {
  if (!isInBounds(map, x, y)) return undefined;
  return map.tiles[y * map.width + x];
}

/** Returns true if the tile at (x, y) is a wall or out of bounds. */
export function isWall(map: GameMap, x: number, y: number): boolean {
  const tile = getTile(map, x, y);
  return tile === undefined || tile === TileType.Wall;
}
