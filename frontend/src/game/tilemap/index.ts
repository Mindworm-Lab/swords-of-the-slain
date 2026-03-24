/**
 * Barrel exports for the tilemap module.
 */

export { TileType, isInBounds, getTile, isWall } from './types.ts';
export type { GameMap } from './types.ts';

export { generateTestMap } from './mapgen.ts';

export { TilemapRenderer, TILE_SIZE } from './TilemapRenderer.tsx';
export type { TilemapRendererProps } from './TilemapRenderer.tsx';
