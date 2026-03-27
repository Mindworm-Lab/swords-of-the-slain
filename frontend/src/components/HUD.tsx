/**
 * HUD — In-game heads-up display overlay.
 *
 * Positioned as a fixed DOM overlay on top of the PixiJS canvas.
 * Contains:
 * - Top-left: game title
 * - Top-right: vision mode toggle buttons
 * - Bottom-left: health bar placeholder
 * - Bottom-right: minimap
 *
 * Pure React/DOM component — no PixiJS dependency.
 */

import type { GameMap } from '../game/tilemap/types.ts';
import { Minimap } from './Minimap.tsx';

export interface HUDProps {
  /** Set of explored tile keys. */
  exploredSet: Set<number>;
  /** Set of currently visible tile keys. */
  visibleSet: Set<number>;
  /** Player tile X position. */
  playerX: number;
  /** Player tile Y position. */
  playerY: number;
  /** The game map data. */
  map: GameMap;
  /** Fog generation counter — triggers Minimap redraws when exploredSet changes. */
  fogGeneration: number;
}

/** Shared panel styling for HUD elements. */
const panelStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.65)',
  borderRadius: 6,
  padding: '8px 12px',
  backdropFilter: 'blur(4px)',
};

export const HUD: React.FC<HUDProps> = ({
  exploredSet,
  visibleSet,
  playerX,
  playerY,
  map,
  fogGeneration,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: 'monospace',
        userSelect: 'none',
      }}
    >
      {/* Top-left: Game title */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          ...panelStyle,
        }}
      >
        <span style={{
          color: '#f0c040',
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 2,
        }}>
          ⚔ SWORDS OF THE SLAIN
        </span>
      </div>

      {/* Bottom-left: Health bar placeholder */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          ...panelStyle,
          width: 200,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}>
          <span style={{ color: '#ccc', fontSize: 12, fontWeight: 600 }}>HP</span>
          <span style={{ color: '#8a8', fontSize: 11 }}>100 / 100</span>
        </div>
        <div style={{
          width: '100%',
          height: 10,
          background: '#222',
          borderRadius: 5,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, #4c4, #5a8)',
            borderRadius: 5,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Bottom-right: Minimap */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          ...panelStyle,
          padding: 6,
        }}
      >
        <Minimap
          map={map}
          exploredSet={exploredSet}
          visibleSet={visibleSet}
          playerX={playerX}
          playerY={playerY}
          fogGeneration={fogGeneration}
        />
      </div>
    </div>
  );
};
