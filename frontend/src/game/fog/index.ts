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

export { ABYSS_BG_COLOR } from './columnRenderer.ts';

export {
  computeStaggerDelay,
  computeNewRevealDuration,
  computeRevisitRevealDuration,
  computeConcealDuration,
  computeDuration,
  computeHeightJitter,
  RISE_OFFSET_NEW,
  RISE_OFFSET_REVISIT,
  SINK_OFFSET,
  REMEMBERED_YOFFSET,
  MAX_STAGGER,
} from './fogAnimationHelpers.ts';
