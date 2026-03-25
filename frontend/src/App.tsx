import { useMemo, useState } from 'react';
import { Application, extend } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import { PlayerRenderer } from './game/player/index.ts';
import { usePlayerMovement } from './game/player/index.ts';
import { useCamera } from './game/camera/index.ts';
import { useViewportSize } from './hooks/useViewportSize.ts';
import { generateDungeon } from './game/dungeon/index.ts';
import { FogOfWarRenderer, useFogOfWar } from './game/fog/index.ts';
import type { TransitionMode } from './game/fog/index.ts';

// Register PixiJS components with @pixi/react
extend({ Container, Graphics });

// Register GSAP PixiPlugin for animation
gsap.registerPlugin(PixiPlugin);

/** Dark dungeon background color */
const BG_COLOR = 0x1a1a2e;

/** Dungeon dimensions in tiles */
const DUNGEON_WIDTH = 80;
const DUNGEON_HEIGHT = 80;

/**
 * Inner game component — needs to be a child of <Application> so hooks
 * can access the PixiJS context, but also needs the map and start position
 * from the parent scope.
 */
function GameWorld({ dungeon, transitionMode }: {
  dungeon: { map: { width: number; height: number; tiles: number[] }; startX: number; startY: number };
  transitionMode: TransitionMode;
}) {
  const { playerX, playerY } = usePlayerMovement(dungeon.map, dungeon.startX, dungeon.startY);
  const { width: vpWidth, height: vpHeight } = useViewportSize();
  const { cameraX, cameraY } = useCamera(playerX, playerY, vpWidth, vpHeight);
  const fogState = useFogOfWar(dungeon.map, playerX, playerY);

  return (
    <pixiContainer x={cameraX} y={cameraY}>
      <FogOfWarRenderer
        map={dungeon.map}
        fogState={fogState}
        transitionMode={transitionMode}
      />
      <PlayerRenderer tileX={playerX} tileY={playerY} />
    </pixiContainer>
  );
}

/**
 * Root application component.
 * Renders a full-viewport PixiJS stage with a procedurally generated
 * BSP dungeon, fog-of-war with animated reveal/conceal, player character,
 * and smooth camera follow.
 */
const App: React.FC = () => {
  // Generate the dungeon once (deterministic seed → stable across re-renders)
  const dungeon = useMemo(() => generateDungeon(DUNGEON_WIDTH, DUNGEON_HEIGHT, 42), []);

  // Transition mode state — toggleable for testing
  const [transitionMode, setTransitionMode] = useState<TransitionMode>('rise');

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Application
        background={BG_COLOR}
        resizeTo={window}
        antialias
      >
        <GameWorld dungeon={dungeon} transitionMode={transitionMode} />
      </Application>
      {/* Transition mode toggle UI */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: 'rgba(0,0,0,0.7)',
        color: '#ccc',
        padding: '6px 12px',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'monospace',
        zIndex: 10,
        userSelect: 'none',
      }}>
        <span>Fog: </span>
        <button
          onClick={() => setTransitionMode('rise')}
          style={{
            background: transitionMode === 'rise' ? '#5a8' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: 3,
            padding: '2px 8px',
            marginRight: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Rise
        </button>
        <button
          onClick={() => setTransitionMode('fade')}
          style={{
            background: transitionMode === 'fade' ? '#5a8' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: 3,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Fade
        </button>
      </div>
    </div>
  );
};

export default App;
