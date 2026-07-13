import type { useScroll } from '@react-three/drei';
import { PAGES } from './constants';

type ScrollState = ReturnType<typeof useScroll>;

/**
 * Fortschritt 0..1 innerhalb der Section `index` (über `span` Seiten).
 * Innerhalb von useFrame aufrufen — liest den aktuellen Scroll-Offset.
 */
export function sectionProgress(
  scroll: ScrollState,
  index: number,
  span = 1
): number {
  return scroll.range(index / PAGES, span / PAGES);
}

/**
 * Sichtbarkeit 0..1 der Section `index`: blendet eine halbe Seite vor dem
 * Eintritt ein und eine halbe Seite nach dem Austritt wieder aus.
 * Praktisch, um Szenen außerhalb des Viewports zu deaktivieren.
 */
export function sectionVisibility(scroll: ScrollState, index: number): number {
  const start = Math.max(0, (index - 0.75) / PAGES);
  const end = Math.min(1, (index + 0.75) / PAGES);
  return scroll.curve(start, end - start);
}
