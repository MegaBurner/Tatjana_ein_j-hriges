import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import { usePrefersReducedMotion } from '../three/hooks/useWebGL';
import { publishScroll } from './scrollBus';
import { PAGES } from './constants';

/** Anzahl der Snap-Schritte zwischen den 7 Sections (0..6). */
const SNAP_STEPS = PAGES - 1;
/** Kein Snap, solange innerhalb dieses Fensters echte Scroll-Aktivität stattfand (ms). */
const SNAP_INACTIVITY_MS = 400;
/** Ab dieser Distanz zum nächsten Rastpunkt gilt die Section als "eingerastet" (px). */
const SNAP_EPSILON_PX = 2;
/** Easing-Faktor für sanftes Einrasten. */
const EASE_FACTOR = 3.5;
/** Schnellerer Easing-Faktor bei prefers-reduced-motion — kein langes Nachwippen. */
const REDUCED_MOTION_EASE_FACTOR = 8;
/**
 * Mindest-Schrittgröße pro Frame (px), solange noch außerhalb von SNAP_EPSILON_PX.
 * Browser runden scrollTop-Zuweisungen auf ein 0.5px-Raster — ohne diesen
 * Floor kann der Eased-Schritt bei kleinem `diff` unter dieses Raster fallen
 * und die Zuweisung wird zum No-Op, wodurch das Einrasten für immer knapp
 * über SNAP_EPSILON_PX hängen bleibt, statt den finalen Exact-Snap zu erreichen.
 */
const MIN_STEP_PX = 1;

/**
 * Rendert nichts sichtbares. Muss INNERHALB von <ScrollControls> stehen.
 * Sorgt für einen sanften Rastpunkt pro Section, sobald der Nutzer 400ms
 * nicht mehr aktiv gescrollt hat, und meldet den aktiven Section-Index
 * über scrollBus an DOM-Komponenten außerhalb des Canvas (z.B. DotRail).
 */
function SnapController() {
  const scroll = useScroll();
  const prefersReducedMotion = usePrefersReducedMotion();

  // scroll.el wird beim Mount in eine plain Ref gespiegelt: useFrame darf den
  // von useScroll() zurückgegebenen Wert nicht direkt mutieren (React-Compiler
  // Immutability-Regel) — über die Ref umgangen, da wir absichtlich imperativ
  // auf das DOM-Element schreiben.
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(0);
  const pointerDownRef = useRef(false);
  const ignoreScrollRef = useRef(false);
  const lastPublishedIndexRef = useRef(-1);

  useEffect(() => {
    const el = scroll.el;
    elRef.current = el;
    lastActivityRef.current = performance.now();

    const markActivity = () => {
      lastActivityRef.current = performance.now();
    };
    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      markActivity();
    };
    const onPointerDown = () => {
      pointerDownRef.current = true;
      markActivity();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      markActivity();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', markActivity, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);

    return () => {
      elRef.current = null;
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', markActivity);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [scroll.el]);

  useFrame((_, delta) => {
    const el = elRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;

    const rawIndex = Math.round((el.scrollTop / max) * SNAP_STEPS);
    const sectionIndex = Math.min(SNAP_STEPS, Math.max(0, rawIndex));
    if (sectionIndex !== lastPublishedIndexRef.current) {
      lastPublishedIndexRef.current = sectionIndex;
      publishScroll({ sectionIndex, el });
    }

    const now = performance.now();
    const isSettling =
      !pointerDownRef.current && now - lastActivityRef.current > SNAP_INACTIVITY_MS;

    let wroteThisFrame = false;

    if (isSettling) {
      const step = max / SNAP_STEPS;
      const nearest = Math.round(el.scrollTop / step) * step;
      const diff = nearest - el.scrollTop;

      if (Math.abs(diff) > SNAP_EPSILON_PX) {
        const ease = prefersReducedMotion ? REDUCED_MOTION_EASE_FACTOR : EASE_FACTOR;
        const rawStep = diff * Math.min(1, delta * ease);
        // Floor auf MIN_STEP_PX, aber nie über das Ziel hinaus (kein Overshoot).
        const stepMagnitude = Math.min(Math.abs(diff), Math.max(Math.abs(rawStep), MIN_STEP_PX));
        el.scrollTop += Math.sign(diff) * stepMagnitude;
        wroteThisFrame = true;
      } else if (diff !== 0) {
        el.scrollTop = nearest;
        wroteThisFrame = true;
      }
    }

    // Nur solange wir selbst schreiben ignorieren wir 'scroll'-Events — echte
    // Nutzeraktivität dazwischen (z.B. neuer Wheel-Tick) muss weiter durchschlagen.
    ignoreScrollRef.current = wroteThisFrame;
  });

  return null;
}

export default SnapController;
