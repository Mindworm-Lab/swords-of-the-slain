import { useMemo } from 'react';
import { Application, extend } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import { TilemapRenderer, generateTestMap } from './game/tilemap/index.ts';

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
 * Root application component.
 * Renders a full-viewport PixiJS stage with a procedurally generated
 * dungeon tilemap.
 */
const App: React.FC = () => {
  // Generate the map once (deterministic seed → stable across re-renders)
  const map = useMemo(() => generateTestMap(MAP_WIDTH, MAP_HEIGHT, 42), []);

  return (
    <Application
      background={BG_COLOR}
      resizeTo={window}
      antialias
    >
      <TilemapRenderer map={map} />
    </Application>
  );
};

export default App;
