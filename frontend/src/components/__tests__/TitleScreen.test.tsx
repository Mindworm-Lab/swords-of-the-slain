/**
 * TitleScreen tests — verifies rendering and interaction behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleScreen } from '../TitleScreen.tsx';

describe('TitleScreen', () => {
  it('renders the game title', () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByText('SWORDS OF THE SLAIN')).toBeTruthy();
  });

  it('renders the subtitle', () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByText('A Rogue-Like MMO RPG')).toBeTruthy();
  });

  it('renders the start prompt', () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByTestId('start-prompt')).toBeTruthy();
    expect(screen.getByText('Press any key or click to begin')).toBeTruthy();
  });

  it('calls onStart when clicked', () => {
    const onStart = vi.fn();
    render(<TitleScreen onStart={onStart} />);

    const container = screen.getByRole('button', { name: 'Start game' });
    fireEvent.click(container);

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onStart on keydown', () => {
    const onStart = vi.fn();
    render(<TitleScreen onStart={onStart} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
