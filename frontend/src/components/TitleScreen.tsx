/**
 * TitleScreen — Atmospheric landing page for Swords of the Slain.
 *
 * Full-viewport dark overlay with branded title, subtitle, and a pulsing
 * "press any key" prompt. Fires `onStart` on any keypress or click.
 *
 * This is a pure DOM component — no PixiJS dependency.
 */

import { useEffect, useCallback } from 'react';

export interface TitleScreenProps {
  /** Called when the player presses any key or clicks to begin. */
  onStart: () => void;
}

/** CSS keyframes injected once for the pulse animation. */
const PULSE_KEYFRAMES = `
@keyframes sos-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`;

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStart }) => {
  const handleKeyDown = useCallback(() => onStart(), [onStart]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      onClick={onStart}
      role="button"
      tabIndex={0}
      aria-label="Start game"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a18 70%, #050510 100%)',
        cursor: 'pointer',
        userSelect: 'none',
        fontFamily: 'monospace',
        overflow: 'hidden',
      }}
    >
      {/* Inject pulse animation */}
      <style>{PULSE_KEYFRAMES}</style>

      {/* Decorative sword icon */}
      <div style={{
        fontSize: 64,
        marginBottom: 16,
        filter: 'drop-shadow(0 0 12px rgba(240, 192, 64, 0.5))',
      }}>
        ⚔
      </div>

      {/* Main title */}
      <h1 style={{
        fontSize: 'clamp(32px, 6vw, 72px)',
        fontWeight: 900,
        color: '#f0c040',
        textShadow: '0 0 20px rgba(240, 192, 64, 0.4), 0 2px 8px rgba(0,0,0,0.8)',
        margin: 0,
        letterSpacing: 4,
        textAlign: 'center',
        lineHeight: 1.1,
      }}>
        SWORDS OF THE SLAIN
      </h1>

      {/* Subtitle */}
      <p style={{
        fontSize: 'clamp(12px, 2vw, 20px)',
        color: '#8888aa',
        marginTop: 12,
        letterSpacing: 6,
        textTransform: 'uppercase',
      }}>
        A Rogue-Like MMO RPG
      </p>

      {/* Decorative divider */}
      <div style={{
        width: 120,
        height: 1,
        background: 'linear-gradient(90deg, transparent, #f0c04066, transparent)',
        margin: '32px 0',
      }} />

      {/* Start prompt */}
      <p
        data-testid="start-prompt"
        style={{
          fontSize: 'clamp(11px, 1.4vw, 16px)',
          color: '#ccc',
          animation: 'sos-pulse 2.5s ease-in-out infinite',
          letterSpacing: 2,
        }}
      >
        Press any key or click to begin
      </p>
    </div>
  );
};
