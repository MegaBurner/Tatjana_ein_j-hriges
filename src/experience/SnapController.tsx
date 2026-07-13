import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import { usePrefersReducedMotion } from '../three/hooks/useWebGL';
import { clearScrollTarget, peekScrollTarget, publishScroll } from './scrollBus';
import { PAGES } from './constants';

/** Anzahl der Snap-Schritte zwischen den 7 Sections (0..6). */
const SNAP_STEPS = PAGES - 1;
/** Kein Snap, solange innerhalb dieses Fensters echte Scroll-Aktivität stattfand (ms). */
const SNAP_INACTIVITY_MS = 320;
/** Ab dieser Distanz zum Ziel gilt es als erreicht (px). */
const SNAP_EPSILON_PX = 1;
/** Glide-Dauer: Basis + distanzabhängiger Anteil, gedeckelt (s). */
const GLIDE_MIN_S = 0.45;
const GLIDE_MAX_S = 1.1;

/** Weiches Ease-in-out — sanftes Anrollen UND sanftes Ankommen, kein Kriechen. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Glide {
  from: number;
  to: number;
  elapsed: number;
  duration: number;
}

/** Erzeugt einen neuen Glide-Zustand (immutable — nie ein bestehendes Glide-Objekt mutieren). */
function makeGlide(
  from: number,
  to: number,
  stepSize: number,
  prefersReducedMotion: boolean
): Glide {
  const distanceRatio = Math.abs(to - from) / stepSize;
  const duration = prefersReducedMotion
    ? GLIDE_MIN_S * 0.6
    : Math.min(GLIDE_MAX_S, GLIDE_MIN_S + distanceRatio * 0.45);
  return { from, to, elapsed: 0, duration };
}

/**
 * Rendert nichts Sichtbares. Muss INNERHALB von <ScrollControls> stehen.
 * Einziger Schreiber von el.scrollTop: gleitet nach kurzer Scroll-Ruhe
 * zeitbasiert (Ease-in-out) zum nächsten Section-Zentrum bzw. zu einem per
 * DotRail angeforderten Ziel und meldet den aktiven Section-Index über
 * scrollBus an DOM-Komponenten außerhalb des Canvas.
 */
function SnapController() {
  const scroll = useScroll();
  const prefersReducedMotion = usePrefersReducedMotion();

  // scroll.el in eine plain Ref gespiegelt (React-Compiler-Immutability:
  // Hook-Rückgaben nicht direkt mutieren; imperative DOM-Writes laufen über die Ref).
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(0);
  const pointerDownRef = useRef(false);
  /** Zuletzt von UNS geschriebene scrollTop-Werte (kleines Fenster, da
   *  Scroll-Events einen Frame nachhinken können) — diskriminiert eigene von
   *  fremden Scroll-Events (z.B. Chromiums eigener Smooth-Wheel-Animation). */
  const recentWritesRef = useRef<number[]>([]);
  const lastPublishedIndexRef = useRef(-1);
  const glideRef = useRef<Glide | null>(null);

  useEffect(() => {
    const el = scroll.el;
    elRef.current = el;
    lastActivityRef.current = performance.now();

    // Deep-Link: ?section=N springt direkt zur Section (0..6) — für Sharing
    // und für die Headless-Screenshot-Verifikation ohne Browser-Automation.
    const sectionParam = new URLSearchParams(window.location.search).get('section');
    if (sectionParam !== null) {
      const idx = Math.min(SNAP_STEPS, Math.max(0, Number(sectionParam) || 0));
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) {
        el.scrollTop = (max / SNAP_STEPS) * idx;
      }
    }

    const interrupt = () => {
      glideRef.current = null;
      clearScrollTarget();
      lastActivityRef.current = performance.now();
    };
    const onScroll = () => {
      // Eigene Writes landen (bis auf Rundung) auf einem kürzlich geschriebenen
      // Wert — alles andere ist fremd (Nutzer-Scroll ODER die noch laufende
      // Smooth-Wheel-Animation des Browsers) und bricht einen Glide ab,
      // statt gegen ihn zu kämpfen.
      const own = recentWritesRef.current.some((w) => Math.abs(el.scrollTop - w) <= 1);
      if (own) return;
      interrupt();
    };
    const onWheel = interrupt;
    const onPointerDown = () => {
      pointerDownRef.current = true;
      interrupt();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      lastActivityRef.current = performance.now();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);

    return () => {
      elRef.current = null;
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [scroll.el]);

  useFrame((_, delta) => {
    const el = elRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;

    const step = max / SNAP_STEPS;
    const rawIndex = Math.round((el.scrollTop / max) * SNAP_STEPS);
    const sectionIndex = Math.min(SNAP_STEPS, Math.max(0, rawIndex));
    if (sectionIndex !== lastPublishedIndexRef.current) {
      lastPublishedIndexRef.current = sectionIndex;
      publishScroll({ sectionIndex, el });
    }

    let wroteThisFrame = false;

    // Ziel bestimmen: programmatischer Sprung (DotRail) hat Vorrang,
    // sonst nach Scroll-Ruhe das nächste Section-Zentrum.
    const pendingTarget = peekScrollTarget();
    let target: number | null = null;
    if (pendingTarget !== null) {
      target = pendingTarget;
    } else {
      const now = performance.now();
      const isIdle =
        !pointerDownRef.current && now - lastActivityRef.current > SNAP_INACTIVITY_MS;
      if (isIdle) {
        target = Math.round(el.scrollTop / step) * step;
      }
    }

    if (target !== null && Math.abs(target - el.scrollTop) <= SNAP_EPSILON_PX) {
      // Bereits (praktisch) angekommen — exakt setzen, Glide beenden.
      if (el.scrollTop !== target) {
        el.scrollTop = target;
        recentWritesRef.current.push(el.scrollTop);
        wroteThisFrame = true;
      }
      glideRef.current = null;
      if (pendingTarget !== null) clearScrollTarget();
    } else if (target !== null) {
      const previous = glideRef.current;
      // Neuen Glide starten, wenn keiner läuft oder sich das Ziel geändert hat.
      const base =
        previous && previous.to === target
          ? previous
          : makeGlide(el.scrollTop, target, step, prefersReducedMotion);
      const elapsed = Math.min(base.duration, base.elapsed + delta);
      const t = easeInOutCubic(elapsed / base.duration);
      el.scrollTop = base.from + (base.to - base.from) * t;
      recentWritesRef.current.push(el.scrollTop);
      wroteThisFrame = true;
      if (elapsed >= base.duration) {
        el.scrollTop = base.to;
        recentWritesRef.current.push(el.scrollTop);
        glideRef.current = null;
        if (pendingTarget !== null) clearScrollTarget();
      } else {
        glideRef.current = { ...base, elapsed };
      }
    } else {
      glideRef.current = null;
    }

    // Fenster der eigenen Writes klein halten; ohne eigenen Write pro Frame
    // altert das Fenster schnell heraus (Events hinken max. ~1 Frame nach).
    const writes = recentWritesRef.current;
    if (wroteThisFrame) {
      if (writes.length > 6) writes.splice(0, writes.length - 6);
    } else if (writes.length > 0) {
      writes.shift();
    }
  });

  return null;
}

export default SnapController;
