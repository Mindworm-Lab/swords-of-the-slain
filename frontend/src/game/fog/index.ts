/**
 * Fog-of-war module: line-of-sight computation and visibility diffing.
 */

export { computeLOS, tileKey } from './los.ts';
export type { LOSResult } from './los.ts';

export { diffVisibility } from './losUtils.ts';
export type { VisibilityDiff } from './losUtils.ts';
