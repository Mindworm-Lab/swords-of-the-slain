import { useCallback } from 'react';
import { Application, extend } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';

// Register PixiJS components with @pixi/react
extend({ Container, Graphics });

// Register GSAP PixiPlugin for future animation use
gsap.registerPlugin(PixiPlugin);

/** Dark dungeon background color */
const BG_COLOR = 0x1a1a2e;

/** Draw a test rectangle to prove PixiJS rendering works */
const drawTestRect = (g: Graphics): void => {
  g.clear();
  g.setFillStyle({ color: 0x5c4d7d });
  g.rect(-60, -30, 120, 60);
  g.fill();
  g.setStrokeStyle({ width: 2, color: 0x8b7db8 });
  g.rect(-60, -30, 120, 60);
  g.stroke();
};

/** Draw a small accent diamond */
const drawAccentDiamond = (g: Graphics): void => {
  g.clear();
  g.setFillStyle({ color: 0xc8a85c });
  g.moveTo(0, -12);
  g.lineTo(12, 0);
  g.lineTo(0, 12);
  g.lineTo(-12, 0);
  g.closePath();
  g.fill();
};

/**
 * Root application component.
 * Renders a full-viewport PixiJS stage with a test graphic
 * to verify the rendering pipeline works end-to-end.
 */
const App: React.FC = () => {
  const onDrawRect = useCallback((g: Graphics) => drawTestRect(g), []);
  const onDrawDiamond = useCallback((g: Graphics) => drawAccentDiamond(g), []);

  return (
    <Application
      background={BG_COLOR}
      resizeTo={window}
      antialias
    >
      <pixiContainer x={400} y={300}>
        <pixiGraphics draw={onDrawRect} />
        <pixiGraphics draw={onDrawDiamond} y={0} />
      </pixiContainer>
    </Application>
  );
};

export default App;
