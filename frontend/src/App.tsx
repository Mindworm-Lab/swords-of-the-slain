import { useMemo } from 'react';
import { Application, extend } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import { TilemapRenderer, generateTestMap, TileType } from './game/tilemap/index.ts';
import { PlayerRenderer, usePlayerMovement } from './game/player/index.ts';
import { useCamera } from './game/camera/index.ts';
import { useViewportSize } from './hooks/useViewportSize.ts';

// Register PixiJS components with @pixi/react
extend({ Container, Graphics });

// Register GSAP PixiPlugin for future animation use
gsap.registerPlugin(PixiPlugin);

/** Dark dungeon background color */
const BG_COLOR = 0x1a1a2e;

/** Map dimensions in tiles */
const MAP_WIDTH = 60;
const MAP_HEIGHT = 50;

/**
 * Find the first walkable (floor) tile in the map.
 * Scans row-major from top-left. Returns tile coordinates.
 */
function findStartPosition(map: { width: number; height: number; tiles: number[] }): { x: number; y: number } {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x] === TileType.Floor) {
        return { x, y };
      }
    }
  }
  // Fallback — shouldn't happen with a valid dungeon map
  return { x: 1, y: 1 };
}

/**
 * Inner game component — needs to be a child of <Application> so hooks
 * can access the PixiJS context, but also needs the map and start position
 * from the parent scope.
 */
function GameWorld({ map, startX, startY }: {
  map: { width: number; height: number; tiles: number[] };
  startX: number;
  startY: number;
}) {
  const { playerX, playerY } = usePlayerMovement(map, startX, startY);
  const { width: vpWidth, height: vpHeight } = useViewportSize();
  const { cameraX, cameraY } = useCamera(playerX, playerY, vpWidth, vpHeight);

  return (
    <pixiContainer x={cameraX} y={cameraY}>
      <TilemapRenderer map={map} />
      <PlayerRenderer tileX={playerX} tileY={playerY} />
    </pixiContainer>
  );
}

/**
 * Root application component.
 * Renders a full-viewport PixiJS stage with a procedurally generated
 * dungeon tilemap, player character, and smooth camera follow.
 */
const App: React.FC = () => {
  // Generate the map once (deterministic seed → stable across re-renders)
  const map = useMemo(() => generateTestMap(MAP_WIDTH, MAP_HEIGHT, 42), []);

  // Find a valid floor tile for the player start position
  const start = useMemo(() => findStartPosition(map), [map]);

  return (
    <Application
      background={BG_COLOR}
      resizeTo={window}
      antialias
    >
      <GameWorld map={map} startX={start.x} startY={start.y} />
    </Application>
  );
};

export default App;
