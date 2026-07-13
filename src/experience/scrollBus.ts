/**
 * Winziger Modul-Level Pub/Sub für den aktuellen Scroll-Zustand.
 * Erlaubt DOM-Komponenten außerhalb des Canvas (z.B. DotRail), den
 * aktiven Section-Index zu lesen, ohne über React-Context durch den
 * Canvas-Baum zu müssen.
 */
export interface ScrollSnapshot {
  sectionIndex: number;
  el: HTMLElement | null;
}

type Listener = (s: ScrollSnapshot) => void;

const listeners = new Set<Listener>();
let current: ScrollSnapshot = { sectionIndex: 0, el: null };

export function publishScroll(next: ScrollSnapshot): void {
  current = next;
  listeners.forEach((l) => l(next));
}

export function subscribeScroll(l: Listener): () => void {
  l(current);
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
