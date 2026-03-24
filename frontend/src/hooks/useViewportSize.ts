/**
 * useViewportSize — Tracks the browser viewport dimensions.
 *
 * Returns the current window innerWidth and innerHeight, and updates
 * on resize. Debounces slightly to avoid excessive re-renders during
 * continuous resize drags.
 */

import { useState, useEffect } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    let rafId = 0;

    const handleResize = () => {
      // Use rAF to batch resize events within a single frame
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return size;
}
