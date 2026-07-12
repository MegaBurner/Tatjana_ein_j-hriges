import { useMemo } from 'react';

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    );
  } catch {
    return false;
  }
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
