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

/**
 * Programmatischer Scroll-Auftrag: DotRail meldet hierüber ein Ziel
 * (scrollTop in px) an, statt selbst `el.scrollTo({behavior:'smooth'})`
 * aufzurufen. SnapController liest dies in seiner eigenen useFrame-Schleife
 * und fährt das Ziel als einziger Schreiber von `el.scrollTop` an — das
 * verhindert, dass der native Smooth-Scroll des Browsers und die
 * Snap-Easing-Schreibzugriffe gleichzeitig an derselben Property ziehen.
 * Der Auftrag gilt bis SnapController ihn (Ziel erreicht) konsumiert oder
 * echte Nutzeraktivität (Wheel/Pointerdown) ihn abbricht.
 */
let pendingScrollTarget: number | null = null;

export function requestScrollTarget(top: number): void {
  pendingScrollTarget = top;
}

/**
 * Verifikations-Signal für ?freeze=1-Screenshots: true, sobald der
 * ?section=N-Deep-Link-Sprung (SnapController) ausgeführt wurde — bzw.
 * sofort, wenn die URL keinen section-Param hat. FreezeFrame in
 * Experience.tsx hält den Render-Loop erst danach an, denn vor dem Sprung
 * steht der Scroll-Offset auch "stabil" auf 0.
 */
let deepLinkJumpDone = !new URLSearchParams(window.location.search).has(
  "section",
);

export function markDeepLinkJumpDone(): void {
  deepLinkJumpDone = true;
}

export function isDeepLinkJumpDone(): boolean {
  return deepLinkJumpDone;
}

export function peekScrollTarget(): number | null {
  return pendingScrollTarget;
}

export function clearScrollTarget(): void {
  pendingScrollTarget = null;
}
