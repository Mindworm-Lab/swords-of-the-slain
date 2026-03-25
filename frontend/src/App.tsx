import { useMemo, useState, useCallback } from 'react';
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
import type { FogState } from './game/fog/index.ts';
import { TitleScreen } from './components/TitleScreen.tsx';
import { HUD } from './components/HUD.tsx';

// Register PixiJS components with @pixi/react
extend({ Container, Graphics });

// Register GSAP PixiPlugin for animation
gsap.registerPlugin(PixiPlugin);

/** Dark dungeon background color */
const BG_COLOR = 0x1a1a2e;

/** Dungeon dimensions in tiles */
const DUNGEON_WIDTH = 80;
const DUNGEON_HEIGHT = 80;

interface GameWorldProps {
  dungeon: {
    map: { width: number; height: number; tiles: number[] };
    startX: number;
    startY: number;
  };
  transitionMode: TransitionMode;
  /** Called whenever fog state or player position changes. */
  onFogUpdate: (fogState: FogState) => void;
}

/**
 * Inner game component — needs to be a child of <Application> so hooks
 * can access the PixiJS context, but also needs the map and start position
 * from the parent scope.
 */
function GameWorld({ dungeon, transitionMode, onFogUpdate }: GameWorldProps) {
  const { playerX, playerY } = usePlayerMovement(dungeon.map, dungeon.startX, dungeon.startY);
  const { width: vpWidth, height: vpHeight } = useViewportSize();
  const { cameraX, cameraY } = useCamera(playerX, playerY, vpWidth, vpHeight);
  const fogState = useFogOfWar(dungeon.map, playerX, playerY);

  // Report fog state changes to parent for HUD.
  // Use a ref-based check to avoid infinite loops — only call when values change.
  const prevFogRef = useMemo(() => ({ current: null as FogState | null }), []);
  if (prevFogRef.current !== fogState) {
    prevFogRef.current = fogState;
    // Schedule outside render to avoid setState-during-render warning
    queueMicrotask(() => onFogUpdate(fogState));
  }

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
 * Renders a title screen, then on start shows the PixiJS game with HUD overlay.
 */
const App: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(false);

  // Generate the dungeon once (deterministic seed → stable across re-renders)
  const dungeon = useMemo(() => generateDungeon(DUNGEON_WIDTH, DUNGEON_HEIGHT, 42), []);

  // Transition mode state — toggleable via HUD
  const [transitionMode, setTransitionMode] = useState<TransitionMode>('rise');

  // Fog state lifted from GameWorld for HUD consumption
  const [fogState, setFogState] = useState<FogState | null>(null);

  const handleFogUpdate = useCallback((state: FogState) => {
    setFogState(state);
  }, []);

  if (!gameStarted) {
    return <TitleScreen onStart={() => setGameStarted(true)} />;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Application
        background={BG_COLOR}
        resizeTo={window}
        antialias
      >
        <GameWorld
          dungeon={dungeon}
          transitionMode={transitionMode}
          onFogUpdate={handleFogUpdate}
        />
      </Application>

      {/* HUD overlay */}
      {fogState && (
        <HUD
          transitionMode={transitionMode}
          onTransitionModeChange={setTransitionMode}
          exploredSet={fogState.exploredSet}
          visibleSet={fogState.visibleSet}
          playerX={fogState.playerX}
          playerY={fogState.playerY}
          map={dungeon.map}
        />
      )}
    </div>
  );
};

export default App;
