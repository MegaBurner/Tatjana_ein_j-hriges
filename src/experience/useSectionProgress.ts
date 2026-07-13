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
 * Sichtbarkeit 0..1 der Section `index` — zentrumsbasiert: Section `i` ist
 * im Viewport zentriert bei Offset i/(PAGES-1); die Bell-Curve peakt genau
 * dort und fällt zur Mitte der Nachbar-Sections auf 0 ab. Praktisch, um
 * Szenen außerhalb des Viewports zu deaktivieren, ohne dass eine zentrierte
 * Section jemals ausgeblendet wird (insbesondere die letzte bei Offset 1).
 */
export function sectionVisibility(scroll: ScrollState, index: number): number {
  const center = index / (PAGES - 1);
  const halfWidth = 1 / (PAGES - 1);
  return scroll.curve(center - halfWidth, 2 * halfWidth);
}
