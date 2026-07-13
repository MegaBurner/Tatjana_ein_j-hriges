import { useMemo } from 'react';

let cachedWebGL: boolean | null = null;

export function detectWebGL(): boolean {
  cachedWebGL ??= (() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(
        canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      );
    } catch {
      return false;
    }
  })();
  return cachedWebGL;
}

export function useWebGL(): boolean {
  return useMemo(() => detectWebGL(), []);
}

export function usePrefersReducedMotion(): boolean {
  return useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
}
