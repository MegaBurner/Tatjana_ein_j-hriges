import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import { usePrefersReducedMotion } from "../three/hooks/useWebGL";
import {
  clearScrollTarget,
  markDeepLinkJumpDone,
  peekScrollTarget,
  publishScroll,
  requestScrollTarget,
} from "./scrollBus";
import { PAGES } from "./constants";

/** Anzahl der Snap-Schritte zwischen den 7 Sections (0..6). */
const SNAP_STEPS = PAGES - 1;
/** Kein Snap, solange innerhalb dieses Fensters echte Scroll-Aktivität stattfand (ms). */
const SNAP_INACTIVITY_MS = 320;
/** Ab dieser Distanz zum Ziel gilt es als erreicht (px). */
const SNAP_EPSILON_PX = 1;
/** Glide-Dauer: Basis + distanzabhängiger Anteil, gedeckelt (s). */
const GLIDE_MIN_S = 0.45;
const GLIDE_MAX_S = 1.1;

/** Seiten-Paging (Wheel/Trackpad): Ab dieser akkumulierten |deltaY| (px)
 *  gilt eine Geste als "ein Wisch" und löst genau einen Section-Wechsel aus. */
const WHEEL_PAGE_THRESHOLD_PX = 60;
/** Nach dem Start eines Page-Glides wird das abklingende Momentum-"Tail"
 *  des Trackpads (viele weitere wheel-Events derselben Richtung, die vom
 *  selben physischen Wisch stammen) für Glide-Dauer + dieses Gnadenfenster
 *  verschluckt — sonst würde ein Wisch mehrere Seiten überspringen. */
const WHEEL_MOMENTUM_GRACE_MS = 250;

/** Weiches Ease-in-out — sanftes Anrollen UND sanftes Ankommen, kein Kriechen. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Klemmt einen Section-Index auf den gültigen Bereich [0, SNAP_STEPS]. */
function clampSectionIndex(index: number): number {
  return Math.min(SNAP_STEPS, Math.max(0, index));
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
  prefersReducedMotion: boolean,
): Glide {
  const distanceRatio = Math.abs(to - from) / stepSize;
  const duration = prefersReducedMotion
    ? GLIDE_MIN_S * 0.6
    : Math.min(GLIDE_MAX_S, GLIDE_MIN_S + distanceRatio * 0.45);
  return { from, to, elapsed: 0, duration };
}

/**
 * Rendert nichts Sichtbares. Muss INNERHALB von <ScrollControls> stehen.
 * Einziger Schreiber von el.scrollTop: fährt Seiten-Paging-Ziele (Wheel-
 * Gesten, Keyboard), DotRail-Ziele und den Deep-Link-Sprung zeitbasiert
 * (Ease-in-out) an und meldet den aktiven Section-Index über scrollBus an
 * DOM-Komponenten außerhalb des Canvas. Für Touch bleibt natives Scrollen
 * mit anschließendem Idle-Snap als Fallback bestehen (siehe useFrame unten).
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
   *  fremden Scroll-Events (z.B. echtes Touch-Scrolling). */
  const recentWritesRef = useRef<number[]>([]);
  const lastPublishedIndexRef = useRef(-1);
  const glideRef = useRef<Glide | null>(null);

  // --- Wheel-Gesten-Paging (Trackpad/Maus) ---------------------------------
  /** Akkumulierte deltaY der laufenden, noch nicht committeten Wheel-Geste. */
  const wheelAccumRef = useRef(0);
  /** Section-Index, an der die laufende Wheel-Geste begann (einmalig beim
   *  Gesten-Start festgehalten, siehe Anforderung: nicht mitten im Glide neu lesen). */
  const wheelGestureAnchorRef = useRef<number | null>(null);
  /** Richtung (+1/-1) des zuletzt committeten Page-Glides. */
  const pageGlideDirRef = useRef(0);
  /** Section-Index, den der zuletzt committete Page-Glide ansteuert(e). */
  const pageGlideTargetIndexRef = useRef<number | null>(null);
  /** Bis zu diesem performance.now()-Zeitstempel gilt das Momentum-Tail
   *  eines Page-Glides als aktiv (Glide-Dauer + Gnadenfenster). */
  const pageGlideSuppressUntilRef = useRef(0);

  useEffect(() => {
    const el = scroll.el;
    elRef.current = el;
    lastActivityRef.current = performance.now();

    // Deep-Link: ?section=N springt direkt zur Section (0..6) — für Sharing
    // und für die Headless-Screenshot-Verifikation ohne Browser-Automation.
    let jumpCancel: (() => void) | null = null;
    const sectionParam = new URLSearchParams(window.location.search).get(
      "section",
    );
    if (sectionParam !== null) {
      const idx = clampSectionIndex(Number(sectionParam) || 0);
      // ScrollControls (Eltern-Komponente) richtet Styles/DOM-Anhängen/Größe
      // des Scroll-Elements erst in seinen EIGENEN Mount-Effects ein, die wegen
      // Reacts Bottom-up-Effect-Reihenfolge NACH diesem Kind-Effect laufen —
      // scrollHeight/clientHeight sind hier deshalb noch 0. ScrollControls
      // ignoriert außerdem das allererste "scroll"-Event (`firstRun`-Flag).
      // Daher: auf gültige Maße warten UND mindestens einen weiteren Frame
      // verstreichen lassen, bevor der Sprung ausgeführt wird.
      let frame = 0;
      const jumpToSection = () => {
        frame += 1;
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0 && frame > 1) {
          el.scrollTop = (max / SNAP_STEPS) * idx;
          markDeepLinkJumpDone();
        } else if (frame < 600) {
          // Großzügige Deadline: Layout/Chunks können (v.a. headless oder auf
          // langsamen Geräten) deutlich mehr als 30 Frames brauchen.
          jumpRaf = requestAnimationFrame(jumpToSection);
        }
      };
      let jumpRaf = requestAnimationFrame(jumpToSection);
      jumpCancel = () => cancelAnimationFrame(jumpRaf);
    }

    const interrupt = () => {
      glideRef.current = null;
      clearScrollTarget();
      lastActivityRef.current = performance.now();
      // Echte Fremdaktivität (Touch-Drag, Scrollbar) verwirft auch jeden
      // laufenden Wheel-Paging-Zustand — kein stale Momentum-Fenster danach.
      wheelAccumRef.current = 0;
      wheelGestureAnchorRef.current = null;
      pageGlideDirRef.current = 0;
      pageGlideTargetIndexRef.current = null;
      pageGlideSuppressUntilRef.current = 0;
    };
    const onScroll = () => {
      // Eigene Writes landen (bis auf Rundung) auf einem kürzlich geschriebenen
      // Wert — alles andere ist fremd (z.B. echtes Touch-Scrolling) und bricht
      // einen Glide ab, statt gegen ihn zu kämpfen.
      const own = recentWritesRef.current.some(
        (w) => Math.abs(el.scrollTop - w) <= 1,
      );
      if (own) return;
      interrupt();
    };

    /**
     * Startet (bzw. ersetzt) den aktiven Page-Glide: meldet das Ziel über
     * scrollBus, die bestehende useFrame-Schleife unten übernimmt das
     * eigentliche zeitbasierte Ease-Glide (makeGlide/easeInOutCubic) —
     * exakt dieselbe Maschinerie wie für DotRail-Ziele und Deep-Links.
     */
    const commitPageTurn = (anchorIndex: number, dir: number, now: number) => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const step = max / SNAP_STEPS;
      const targetIndex = clampSectionIndex(anchorIndex + dir);
      const targetTop = targetIndex * step;
      requestScrollTarget(targetTop);
      const glide = makeGlide(
        el.scrollTop,
        targetTop,
        step,
        prefersReducedMotion,
      );
      pageGlideDirRef.current = dir;
      pageGlideTargetIndexRef.current = targetIndex;
      pageGlideSuppressUntilRef.current =
        now + glide.duration * 1000 + WHEEL_MOMENTUM_GRACE_MS;
      wheelAccumRef.current = 0;
      wheelGestureAnchorRef.current = null;
    };

    /**
     * Prüft, ob `dir` in das Momentum-Tail eines laufenden Page-Glides fällt.
     * Gleiche Richtung → verschlucken (kein doppeltes Blättern durchs
     * Trackpad-Momentum). Gegenrichtung → sofort umkehren (neuer Glide
     * zurück). Gibt true zurück, wenn der Aufrufer nichts weiter tun muss.
     */
    const handleSuppressedDirection = (dir: number, now: number): boolean => {
      if (now >= pageGlideSuppressUntilRef.current) return false;
      if (dir === pageGlideDirRef.current) return true;
      const max = el.scrollHeight - el.clientHeight;
      const step = max > 0 ? max / SNAP_STEPS : 1;
      const headingToIndex =
        pageGlideTargetIndexRef.current ??
        clampSectionIndex(
          Math.round(el.scrollTop / step) + pageGlideDirRef.current,
        );
      commitPageTurn(headingToIndex, dir, now);
      return true;
    };

    const onWheel = (e: WheelEvent) => {
      // Pinch-Zoom (Trackpad) und Strg+Scroll senden ebenfalls wheel-Events
      // mit ctrlKey — nicht abfangen, damit Browser-Zoom (Barrierefreiheit)
      // erhalten bleibt.
      if (e.ctrlKey) return;
      // Natives Scrollen per Wheel/Trackpad komplett übernehmen — das
      // Trackpad sendet für einen einzigen Wisch viele wheel-Events mit
      // abklingendem Momentum über ~600ms; wir steuern die Seite selbst an,
      // statt den Browser frei (nur bis zur Hälfte) scrollen zu lassen.
      e.preventDefault();

      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const step = max / SNAP_STEPS;
      const dir = Math.sign(e.deltaY);
      if (dir === 0) return;

      const now = performance.now();
      if (handleSuppressedDirection(dir, now)) return;

      if (wheelAccumRef.current === 0) {
        wheelGestureAnchorRef.current = Math.round(el.scrollTop / step);
      }
      wheelAccumRef.current += e.deltaY;
      if (Math.abs(wheelAccumRef.current) > WHEEL_PAGE_THRESHOLD_PX) {
        const anchor =
          wheelGestureAnchorRef.current ?? Math.round(el.scrollTop / step);
        commitPageTurn(anchor, Math.sign(wheelAccumRef.current), now);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Nur reagieren, wenn kein anderes Element (Input, Button, Modal) den
      // Fokus hält — sonst würden z.B. Space auf einem Button oder Pfeiltasten
      // im Brief-Modal von der Section-Navigation gekapert.
      const active = document.activeElement;
      const isBodyOrScroller =
        active === null || active === document.body || active === elRef.current;
      if (!isBodyOrScroller) return;

      let dir = 0;
      if (
        e.code === "ArrowDown" ||
        e.code === "PageDown" ||
        e.code === "Space"
      ) {
        dir = 1;
      } else if (e.code === "ArrowUp" || e.code === "PageUp") {
        dir = -1;
      }
      if (dir === 0) return;

      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;

      e.preventDefault();
      const now = performance.now();
      if (handleSuppressedDirection(dir, now)) return;

      const step = max / SNAP_STEPS;
      const anchor = Math.round(el.scrollTop / step);
      commitPageTurn(anchor, dir, now);
    };

    const onPointerDown = () => {
      pointerDownRef.current = true;
      interrupt();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      lastActivityRef.current = performance.now();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      jumpCancel?.();
      elRef.current = null;
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // prefersReducedMotion wird von usePrefersReducedMotion() einmalig beim
    // Mount ermittelt (kein MediaQuery-Change-Listener) und ändert sich somit
    // faktisch nie zur Laufzeit — die Aufnahme in die Dependency-Liste löst
    // daher praktisch keinen Re-Run aus, macht die exhaustive-deps-Regel aber
    // korrekt glücklich.
  }, [scroll.el, prefersReducedMotion]);

  useFrame((_, delta) => {
    const el = elRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;

    const step = max / SNAP_STEPS;
    const rawIndex = Math.round((el.scrollTop / max) * SNAP_STEPS);
    const sectionIndex = clampSectionIndex(rawIndex);
    if (sectionIndex !== lastPublishedIndexRef.current) {
      lastPublishedIndexRef.current = sectionIndex;
      publishScroll({ sectionIndex, el });
    }

    let wroteThisFrame = false;

    // Ziel bestimmen: programmatischer Sprung (Wheel-/Keyboard-Paging oder
    // DotRail) hat Vorrang, sonst — nur relevant für echtes Touch-Scrolling,
    // da Wheel jetzt vollständig synthetisch läuft — nach Scroll-Ruhe das
    // nächste Section-Zentrum (Idle-Snap-Fallback).
    const pendingTarget = peekScrollTarget();
    let target: number | null = null;
    if (pendingTarget !== null) {
      target = pendingTarget;
    } else {
      const now = performance.now();
      const isIdle =
        !pointerDownRef.current &&
        now - lastActivityRef.current > SNAP_INACTIVITY_MS;
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
