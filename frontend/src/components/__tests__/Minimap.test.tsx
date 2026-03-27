/**
 * Minimap tests — verifies canvas rendering and prop handling.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Minimap } from '../Minimap.tsx';
import { TileType } from '../../game/tilemap/types.ts';
import type { GameMap } from '../../game/tilemap/types.ts';
import { tileKey } from '../../game/fog/los.ts';

/** Creates a simple 4x4 test map with a floor interior and wall border. */
function createTestMap(): GameMap {
  const width = 4;
  const height = 4;
  const tiles: TileType[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      tiles.push(isBorder ? TileType.Wall : TileType.Floor);
    }
  }
  return { width, height, tiles };
}

describe('Minimap', () => {
  it('renders a canvas element', () => {
    const map = createTestMap();
    render(
      <Minimap
        map={map}
        exploredSet={new Set()}
        visibleSet={new Set()}
        playerX={1}
        playerY={1}
        fogGeneration={0}
      />,
    );

    const canvas = screen.getByTestId('minimap-canvas');
    expect(canvas).toBeTruthy();
    expect(canvas.tagName).toBe('CANVAS');
  });

  it('renders with correct CSS sizing', () => {
    const map = createTestMap();
    const explored = new Set([tileKey(1, 1), tileKey(2, 2)]);

    render(
      <Minimap
        map={map}
        exploredSet={explored}
        visibleSet={new Set()}
        playerX={1}
        playerY={1}
        fogGeneration={0}
      />,
    );

    const canvas = screen.getByTestId('minimap-canvas') as HTMLCanvasElement;
    // CSS display size should be set
    expect(canvas.style.width).toBe('160px');
    expect(canvas.style.height).toBe('160px');
  });

  it('applies pixelated image rendering style', () => {
    const map = createTestMap();
    render(
      <Minimap
        map={map}
        exploredSet={new Set()}
        visibleSet={new Set()}
        playerX={1}
        playerY={1}
        fogGeneration={0}
      />,
    );

    const canvas = screen.getByTestId('minimap-canvas') as HTMLCanvasElement;
    expect(canvas.style.imageRendering).toBe('pixelated');
  });

  it('re-renders when player position changes', () => {
    const map = createTestMap();
    const visible = new Set([tileKey(1, 1), tileKey(2, 2)]);

    const { rerender } = render(
      <Minimap
        map={map}
        exploredSet={visible}
        visibleSet={visible}
        playerX={1}
        playerY={1}
        fogGeneration={0}
      />,
    );

    // Re-render with new player position — should not throw
    rerender(
      <Minimap
        map={map}
        exploredSet={visible}
        visibleSet={visible}
        playerX={2}
        playerY={2}
        fogGeneration={1}
      />,
    );

    const canvas = screen.getByTestId('minimap-canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
  });
});
