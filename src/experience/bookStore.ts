/**
 * Winziger Modul-Level Pub/Sub für die manuelle Seiten-Navigation im
 * Fotobuch (PhotosSection). Erlaubt den DOM-Buttons in `PhotosHtml`, die
 * Zielseite zu setzen, während die R3F-Scene sie in `useFrame` liest —
 * ohne React-Context durch den Canvas-Baum zu müssen (Pattern analog zu
 * scrollBus.ts). Die Listener sind nötig, damit die Buttons ihren
 * disabled-Zustand und die Seitenanzeige neu rendern können.
 */
type Listener = (p: number) => void;

const listeners = new Set<Listener>();
let targetPage = 0;

export function setBookPage(p: number): void {
  targetPage = p;
  listeners.forEach((l) => l(p));
}

export function getBookPage(): number {
  return targetPage;
}

export function subscribeBookPage(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
