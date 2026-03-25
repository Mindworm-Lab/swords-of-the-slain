/**
 * Fog-of-war module: line-of-sight computation, visibility diffing,
 * fog state management, and animated rendering.
 */

export { computeLOS, tileKey } from './los.ts';
export type { LOSResult } from './los.ts';

export { diffVisibility } from './losUtils.ts';
export type { VisibilityDiff } from './losUtils.ts';

export { useFogOfWar, VISION_RADIUS } from './useFogOfWar.ts';
export type { FogState } from './useFogOfWar.ts';

export { FogOfWarRenderer } from './FogOfWarRenderer.tsx';
export type { FogOfWarRendererProps } from './FogOfWarRenderer.tsx';
