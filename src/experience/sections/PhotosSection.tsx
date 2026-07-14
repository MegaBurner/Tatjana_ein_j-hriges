import {
  Suspense,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useScroll, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import { getBookPage, setBookPage, subscribeBookPage } from "../bookStore";
import { markSRGB, PHOTO_URLS } from "../preloadAssets";
import type { SectionProps } from "../types";

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
/** Ab dieser Annäherung an Section 1 mountet das Buch erst (Ziel 6) — die
 *  Foto-Texturen selbst hat der IdlePreloader (Hero) bis dahin im Regelfall
 *  schon geladen und auf die GPU hochgeladen. */
const NEAR_THRESHOLD = 0.05;

/**
 * Winziger, dateilokaler Pub/Sub (Pattern analog zu `bookStore.ts`), der nur
 * innerhalb dieser Datei gebraucht wird: `PhotoPages` (3D-Szene) sperrt die
 * Buttons in `PhotosHtml` (DOM-Overlay), solange eine Blätter-Drehung läuft.
 * Beide Komponenten sind React-Geschwister (getrennte `<Scroll>`-Bäume in
 * Experience.tsx), daher kein gemeinsamer State über Props möglich.
 */
type TurnLockListener = (locked: boolean) => void;
const turnLockListeners = new Set<TurnLockListener>();
let isTurnLocked = false;

function setTurnLocked(locked: boolean): void {
  if (isTurnLocked === locked) return;
  isTurnLocked = locked;
  turnLockListeners.forEach((listener) => listener(locked));
}

function getTurnLocked(): boolean {
  return isTurnLocked;
}

function subscribeTurnLocked(listener: TurnLockListener): () => void {
  turnLockListeners.add(listener);
  return () => {
    turnLockListeners.delete(listener);
  };
}

// Buchbinderei-Maße: Rücken bei x=0, eine Seite hängt links (x<0), eine
// rechts (x>0) davon — das Buch liegt von Anfang an AUFGESCHLAGEN, kein
// geschlossener Deckel, der erst per Scroll geöffnet werden müsste.
const PAGE_W = 1.15;
const PAGE_H = 1.5;

// Rahmen-Inset, in das jedes Foto per Aspect-Fit eingepasst wird: nie
// größer als die Seite, nie verzerrt, ringsum bleibt cremefarbener Rand
// sichtbar (das "hängt am Buch"-Gefühl).
const PHOTO_INSET_W = PAGE_W - 0.16;
const PHOTO_INSET_H = PAGE_H - 0.2;

// --- Zoom-Pop-Interaktion: Klick/Tipp aufs aktuell sichtbare Foto ----------
/** Pointer-Bewegung (px), bis zu der ein Klick als Tap gilt — gleiches
 *  Kriterium wie die Tap/Drag-Unterscheidung beim Globus, damit
 *  Scroll-Gesten über dem Buch keinen Pop auslösen. */
const TAP_MAX_MOVEMENT_PX = 8;
/** Ab dieser Sichtbarkeit nimmt das Foto Taps an (kein Klicken "im Vorbeiscrollen"). */
const TAP_VISIBILITY_THRESHOLD = 0.3;
/** Amplitude der gedämpften Pop-Feder: erster Ausschlag wächst auf ~106 %
 *  (0.11 · sin/exp-Peak ≈ +0.06, siehe Kurve in `OpenPage`). */
const POP_AMPLITUDE = 0.22;
/** Kreisfrequenz (rad/s) der Pop-Feder — erster Peak nach ~0,08 s. */
const POP_FREQUENCY = 14;
/** Abklingrate (1/s) der Pop-Feder — federt mit leichtem Unterschwinger zurück. */
const POP_DECAY = 6;
/** Nach dieser Zeit gilt der Pop als ausgeschwungen, Scale wird exakt 1. */
const POP_DURATION_SECONDS = 0.9;

// --- Idle-Animation (Nachtrag Standard-Idle-Animationen): das Buch schwebt/
// atmet dezent, auch ohne Interaktion. Läuft additiv auf der Eltern-Group
// (rootRef) — Blätter-Drehung und Klick-Zoom-Pop der Kinder bleiben unberührt.
/** Basis-Schwebehöhe (y) des Buchs — das Idle-Schweben addiert darauf. */
const BOOK_BASE_Y = -0.5;
/** Amplitude (Szenen-Einheiten) der Idle-Y-Sinus-Bewegung. */
const IDLE_FLOAT_AMPLITUDE = 0.02;
/** Periode (s) eines Schwebe-Zyklus. */
const IDLE_FLOAT_PERIOD_SECONDS = 4;
/** Kreisfrequenz (rad/s) des Schwebens. */
const IDLE_FLOAT_FREQUENCY = (Math.PI * 2) / IDLE_FLOAT_PERIOD_SECONDS;
/** Minimales Idle-Kippen (rad) um die z-Achse (Basis-z-Rotation ist 0). */
const IDLE_TILT_AMPLITUDE = 0.008;
/** Phasenversatz (rad) des Kippens gegenüber der Y-Bewegung. */
const IDLE_TILT_PHASE = Math.PI / 3;

/** Dauer einer Blätter-Drehung in Sekunden — spürbar, aber nicht zäh. */
const TURN_DURATION_SECONDS = 0.85;
/** Maximaler z-Lift der drehenden Seite (Papier-Gefühl), bei Drehmitte. */
const TURN_Z_LIFT = 0.06;
/**
 * Konstanter Mindest-Vorsprung des Drehblatts vor der Tiefe (z) der
 * statischen Seiten — unabhängig vom Rotations-Fortschritt. Ohne ihn liegt
 * das Blatt bei progress≈0 (Drehbeginn) exakt in derselben Tiefe wie die
 * Seite, von der es sich löst: gleiche x-Position (`hingeX` deckt sich mit
 * der `OpenPage`-Position), gleicher Gruppen-z-Offset (0.001) — klassisches
 * Z-Fighting. Die statische Seite zeigt an dieser Stelle laut
 * `staticIndices` schon das NEUE Foto, das Drehblatt-Front noch das ALTE —
 * der Renderer entscheidet dann pro Pixel/Frame zufällig, welches der
 * beiden gewinnt, was genau als das gemeldete Flackern sichtbar wird.
 * `TURN_MIN_LIFT` schiebt das Blatt bei JEDEM Fortschrittswert sicher vor
 * diese Tiefe, sodass es die statische Seite immer vollständig verdeckt.
 */
const TURN_MIN_LIFT = 0.01;
/**
 * Frames, die das fertig gedrehte Blatt nach Erreichen der Endlage
 * (progress=1) noch sichtbar bleibt, bevor `PhotoPages` es unmountet.
 * Hintergrund: `setState`-Aufrufe aus `useFrame` committen in R3F nicht
 * garantiert im selben Frame wie der laufende `gl.render()`-Aufruf (siehe
 * R3F "Performance pitfalls": Zustandsänderungen aus dem Frame-Loop laufen
 * über Reacts normalen, potenziell auf den nächsten Tick verzögerten
 * Scheduler, nicht synchron mit dem WebGL-Draw-Call). Ohne diesen Puffer
 * könnte die statische Seite ihr `material.map` einen Frame zu spät
 * bekommen, während das deckende Blatt schon weg ist → 1 Frame altes Foto
 * sichtbar. Das Blatt zeigt an der Endlage ohnehin schon exakt das gleiche
 * Zielfoto (siehe `turningSheetIndices`), bleibt also unauffällig stehen.
 */
const TURN_END_LINGER_FRAMES = 2;

/** Jede Doppelseite zeigt genau EIN Foto links und EIN Foto rechts — jedes
 *  Foto bekommt so seine eigene Seite, keine gepaarten Vorder-/Rückseiten.
 *  PHOTO_URLS/markSRGB leben in preloadAssets.ts, damit der IdlePreloader
 *  (Hero-Section) exakt denselben useLoader-Cache-Key vorwärmen kann. */
const SPREAD_COUNT = PHOTO_URLS.length / 2;

function clampSpread(s: number): number {
  return Math.max(0, Math.min(SPREAD_COUNT - 1, s));
}

interface PhotoFit {
  width: number;
  height: number;
}

/**
 * Aspect-Fit (contain) eines Fotos in den Seiten-Rahmen: liest die reale
 * Pixelgröße aus `texture.image` — nach useTexture/Suspense vorhanden, aber
 * defensiv gegen `undefined` abgesichert — und skaliert beide Achsen mit
 * demselben Faktor, sodass das Foto nie gestreckt und nie größer als der
 * Rahmen wird. Ohne verfügbare Bildmaße fällt es auf Rahmengröße zurück.
 */
function fitPhotoToInset(texture: THREE.Texture): PhotoFit {
  const image = texture.image as
    { width?: number; height?: number } | undefined;
  const texW = image?.width;
  const texH = image?.height;
  if (!texW || !texH) {
    return { width: PHOTO_INSET_W, height: PHOTO_INSET_H };
  }
  const scale = Math.min(PHOTO_INSET_W / texW, PHOTO_INSET_H / texH);
  return { width: texW * scale, height: texH * scale };
}

/** Eine laufende Blätter-Drehung: `from`/`to` sind Spread-Indizes (0..3),
 *  `direction` +1 = vorwärts (Rücken-Rotation 0 → −PI), −1 = rückwärts
 *  (Rücken-Rotation 0 → +PI). */
interface ActiveTurn {
  direction: 1 | -1;
  from: number;
  to: number;
}

/** Standard-Ease für die Rücken-Rotation: sanfter Start, sanftes Ende. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface StaticSpreadIndices {
  leftIndex: number;
  rightIndex: number;
}

/**
 * Foto-Indizes der beiden liegenden (nicht drehenden) Seiten. Ohne laufende
 * Drehung schlicht die aktuelle Doppelseite. Während einer Drehung bleibt
 * die Seite, von der weg geblättert wird, unverändert sichtbar, während die
 * andere bereits das neue, von der drehenden Seite freigegebene Foto zeigt
 * (siehe `TurningSheet`).
 */
function staticIndices(
  currentSpread: number,
  turn: ActiveTurn | null,
): StaticSpreadIndices {
  if (!turn) {
    return { leftIndex: currentSpread * 2, rightIndex: currentSpread * 2 + 1 };
  }
  if (turn.direction === 1) {
    return { leftIndex: turn.from * 2, rightIndex: turn.to * 2 + 1 };
  }
  return { leftIndex: turn.to * 2, rightIndex: turn.from * 2 + 1 };
}

interface TurningSheetIndices {
  frontIndex: number;
  backIndex: number;
}

/**
 * Foto-Indizes der drehenden Seite: Vorderseite zeigt das Foto, das gerade
 * verlassen wird, Rückseite das Foto, das durch die Drehung neu aufgedeckt
 * wird — exakt spiegelverkehrt für vorwärts/rückwärts.
 */
function turningSheetIndices(turn: ActiveTurn): TurningSheetIndices {
  if (turn.direction === 1) {
    return { frontIndex: turn.from * 2 + 1, backIndex: turn.to * 2 };
  }
  return { frontIndex: turn.from * 2, backIndex: turn.to * 2 + 1 };
}

/**
 * Eine offene Buchseite (links ODER rechts vom Rücken): cremefarbene
 * Seiten-Plane in voller Seitengröße, darauf als Kind die Foto-Plane mit
 * z-Offset +0.002 und Aspect-Fit-Größe — das Foto sitzt sichtbar MIT Rand
 * auf der Seite, nie größer als die Seite, nie verzerrt.
 *
 * Klick/Tipp aufs Foto löst einen kurzen Zoom-Pop aus: die Foto-Plane
 * skaliert entlang einer gedämpften Feder `1 + A·sin(ωt)·e^(−kt)` kurz auf
 * ~106 % und federt (mit leichtem Unterschwinger) zurück auf exakt 1.
 * Gewertet werden nur echte Taps (`event.delta` < TAP_MAX_MOVEMENT_PX,
 * Muster wie beim Globus-Drag) — Scroll-Gesten und Klicks während einer
 * laufenden Blätter-Drehung (`getTurnLocked`) bleiben wirkungslos, damit
 * das manuelle Blättern unangetastet bleibt.
 */
function OpenPage({
  texture,
  fit,
  side,
  index,
}: {
  texture: THREE.Texture;
  fit: PhotoFit;
  side: "left" | "right";
  index: number;
}) {
  const scroll = useScroll();
  const photoRef = useRef<THREE.Mesh>(null);
  /** Verstrichene Pop-Zeit (s); >= POP_DURATION_SECONDS = inaktiv. */
  const popElapsed = useRef(POP_DURATION_SECONDS);

  const handlePhotoTap = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > TAP_MAX_MOVEMENT_PX) return;
    if (getTurnLocked()) return;
    if (sectionVisibility(scroll, index) < TAP_VISIBILITY_THRESHOLD) return;
    popElapsed.current = 0;
  };

  useFrame((_, delta) => {
    const photo = photoRef.current;
    if (!photo) return;
    if (popElapsed.current >= POP_DURATION_SECONDS) return;
    popElapsed.current = Math.min(
      popElapsed.current + delta,
      POP_DURATION_SECONDS,
    );
    if (popElapsed.current >= POP_DURATION_SECONDS) {
      photo.scale.setScalar(1);
      return;
    }
    const t = popElapsed.current;
    const springScale =
      1 +
      POP_AMPLITUDE * Math.sin(t * POP_FREQUENCY) * Math.exp(-t * POP_DECAY);
    photo.scale.setScalar(springScale);
  });

  const sign = side === "right" ? 1 : -1;
  return (
    <group position={[sign * (PAGE_W / 2), 0, 0.001]}>
      <mesh>
        <planeGeometry args={[PAGE_W, PAGE_H]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.75} />
      </mesh>
      <mesh
        ref={photoRef}
        position={[0, 0, 0.002]}
        onClick={handlePhotoTap}
        onPointerOver={() => {
          if (sectionVisibility(scroll, index) >= TAP_VISIBILITY_THRESHOLD) {
            document.body.style.cursor = "pointer";
          }
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[fit.width, fit.height]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

/**
 * Das umblätternde Blatt: eine Gruppe am Buchrücken (x=0, der Dreh-Pivot),
 * die als Kind den eigentlichen Seiteninhalt um `PAGE_W / 2` versetzt trägt
 * — vorwärts startend rechts, rückwärts startend links (`hingeX`). Die
 * cremefarbene Rückseiten-Plane ist beidseitig sichtbar (`DoubleSide`),
 * damit während der Drehung nie eine Lücke entsteht; Vorder- und
 * Rückseiten-Foto liegen als zwei gegensätzlich orientierte Planes davor
 * bzw. dahinter (die Rückseite ist lokal um PI gedreht, damit ihre Normale
 * erst nach der 180°-Drehung der Gruppe zur Kamera zeigt). Rotation und
 * z-Lift werden pro Frame aus `progressRef` (linearer Zeit-Fortschritt
 * 0..1, vom Elternteil `PhotoPages` fortgeschrieben) berechnet — kein
 * Re-Render pro Frame nötig. Der z-Lift bekommt zusätzlich den konstanten
 * Sockel `TURN_MIN_LIFT` (siehe dort), damit das Blatt selbst bei
 * progress=0/1 nie exakt in der Tiefe der statischen Seiten liegt
 * (Z-Fighting-Schutz).
 */
function TurningSheet({
  turn,
  progressRef,
  textures,
}: {
  turn: ActiveTurn;
  progressRef: RefObject<number>;
  textures: THREE.Texture[];
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const progress = progressRef.current;
    const eased = easeInOutCubic(progress);
    group.rotation.y =
      turn.direction === 1 ? -Math.PI * eased : Math.PI * eased;
    group.position.z =
      TURN_MIN_LIFT + Math.sin(progress * Math.PI) * TURN_Z_LIFT;
  });

  const { frontIndex, backIndex } = turningSheetIndices(turn);
  const frontTexture = textures[frontIndex];
  const backTexture = textures[backIndex];
  const frontFit = useMemo(() => fitPhotoToInset(frontTexture), [frontTexture]);
  const backFit = useMemo(() => fitPhotoToInset(backTexture), [backTexture]);
  const hingeX = turn.direction === 1 ? PAGE_W / 2 : -PAGE_W / 2;

  return (
    <group ref={groupRef}>
      <group position={[hingeX, 0, 0.001]}>
        <mesh>
          <planeGeometry args={[PAGE_W, PAGE_H]} />
          <meshStandardMaterial
            color="#fdf6ec"
            roughness={0.75}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[frontFit.width, frontFit.height]} />
          <meshBasicMaterial map={frontTexture} />
        </mesh>
        <mesh position={[0, 0, -0.002]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[backFit.width, backFit.height]} />
          <meshBasicMaterial map={backTexture} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Die aktuell aufgeschlagene Doppelseite: liest den Ziel-Spread reaktiv aus
 * dem bookStore (manuelles Blättern über die Buttons in PhotosHtml) und
 * hält daneben lokal den `currentSpread` (was aktuell tatsächlich flach
 * liegt) sowie den `turn`-State einer eventuell laufenden Drehung. Weicht
 * das bookStore-Ziel vom `currentSpread` ab und läuft noch keine Drehung,
 * startet der Render-Body direkt eine neue (siehe Kommentar dort) —
 * Mehrfach-Klicks während einer laufenden Drehung werden ignoriert
 * (Buttons sind in PhotosHtml über `turnLock` ohnehin deaktiviert).
 * `progressRef` läuft pro Frame linear 0→1 über `TURN_DURATION_SECONDS`;
 * bei Erreichen von 1 wird der Spread sofort übernommen, das `turn`-State
 * (und damit das deckende TurningSheet) aber erst `TURN_END_LINGER_FRAMES`
 * Frames später zurückgesetzt — Puffer gegen den 1-Frame-Commit-Versatz von
 * `setState` aus `useFrame` (siehe Kommentar an `TURN_END_LINGER_FRAMES`).
 */
function PhotoPages({ index }: { index: number }) {
  const scroll = useScroll();
  const textures = useTexture(PHOTO_URLS, markSRGB);
  const storeSpread = clampSpread(
    useSyncExternalStore(subscribeBookPage, getBookPage),
  );

  const [currentSpread, setCurrentSpread] = useState(storeSpread);
  const [turn, setTurn] = useState<ActiveTurn | null>(null);
  const progressRef = useRef(0);
  const turnTrackerRef = useRef<ActiveTurn | null>(null);
  const turnEndFramesRef = useRef(0);

  // Startet eine neue Drehung, sobald das bookStore-Ziel vom aktuell
  // liegenden Spread abweicht — direkt im Render-Body (React-Pattern
  // "Adjusting state when a prop changes", kein Effect nötig): sobald
  // `turn` gesetzt ist, verhindert die Bedingung `!turn` weitere Aufrufe,
  // bis die laufende Drehung im useFrame unten abgeschlossen ist. Läuft
  // bereits eine Drehung, wird ein zwischenzeitlich neues bookStore-Ziel
  // ignoriert, bis diese fertig ist (Buttons sind ohnehin über `turnLock`
  // deaktiviert) — danach greift dieselbe Bedingung erneut und blättert
  // ggf. einen weiteren Schritt weiter.
  if (!turn && storeSpread !== currentSpread) {
    const direction: 1 | -1 = storeSpread > currentSpread ? 1 : -1;
    setTurn({
      direction,
      from: currentSpread,
      to: clampSpread(currentSpread + direction),
    });
    setTurnLocked(true);
  }

  useFrame((_, delta) => {
    // Neue Drehung erkannt (Ref-Vergleich statt Render-Mutation): Timer
    // zurücksetzen, unabhängig von der Sichtbarkeit unten.
    if (turn !== turnTrackerRef.current) {
      turnTrackerRef.current = turn;
      progressRef.current = 0;
      turnEndFramesRef.current = 0;
    }
    if (!turn) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;

    if (progressRef.current < 1) {
      progressRef.current = Math.min(
        progressRef.current + delta / TURN_DURATION_SECONDS,
        1,
      );
      if (progressRef.current >= 1) {
        // Endlage erreicht — TurningSheet zeigt auf der Rückseite bereits
        // exakt das Zielfoto (siehe `turningSheetIndices`). Ziel-Spread
        // jetzt übernehmen, das deckende Blatt aber noch
        // `TURN_END_LINGER_FRAMES` Frames stehen lassen (siehe unten),
        // statt im selben Tick zu unmounten — sonst könnte der
        // `material.map`-Wechsel der statischen Seite (ausgelöst durch
        // dieses `setCurrentSpread`) einen Frame hinter dem Verschwinden
        // des Blatts zurückbleiben (R3F: setState aus useFrame committet
        // nicht garantiert synchron zum laufenden gl.render()-Aufruf) →
        // ohne Puffer wäre für 1 Frame das alte Foto sichtbar.
        setCurrentSpread(turn.to);
      }
      return;
    }

    turnEndFramesRef.current += 1;
    if (turnEndFramesRef.current >= TURN_END_LINGER_FRAMES) {
      setTurn(null);
      setTurnLocked(false);
    }
  });

  const { leftIndex, rightIndex } = staticIndices(currentSpread, turn);
  const leftTexture = textures[leftIndex];
  const rightTexture = textures[rightIndex];
  const leftFit = useMemo(() => fitPhotoToInset(leftTexture), [leftTexture]);
  const rightFit = useMemo(() => fitPhotoToInset(rightTexture), [rightTexture]);

  return (
    <group>
      <OpenPage texture={leftTexture} fit={leftFit} side="left" index={index} />
      <OpenPage
        texture={rightTexture}
        fit={rightFit}
        side="right"
        index={index}
      />
      {turn && (
        <TurningSheet
          turn={turn}
          progressRef={progressRef}
          textures={textures}
        />
      )}
    </group>
  );
}

export const PhotosScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const shadowTexture = getSoftShadowTexture();
  // Buch-Fotos laden erst bei Annäherung an die Section, nicht beim App-Start
  // (Ziel 6): einmaliger, gegen Mehrfach-Zündung abgesicherter State-Wechsel
  // aus useFrame heraus.
  const [nearBook, setNearBook] = useState(false);
  const nearRef = useRef(false);

  useFrame((state) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    if (!nearRef.current && vis > NEAR_THRESHOLD) {
      nearRef.current = true;
      setNearBook(true);
    }
    // Idle-Schweben/-Atmen: nur wenn sichtbar und Motion erlaubt; bei
    // reduced motion bleibt das Buch statisch in der JSX-Basislage.
    if (reducedMotion || !root.visible) return;
    const t = state.clock.elapsedTime;
    root.position.y =
      BOOK_BASE_Y + Math.sin(t * IDLE_FLOAT_FREQUENCY) * IDLE_FLOAT_AMPLITUDE;
    root.rotation.z =
      Math.sin(t * IDLE_FLOAT_FREQUENCY + IDLE_TILT_PHASE) *
      IDLE_TILT_AMPLITUDE;
  });

  return (
    <group
      ref={rootRef}
      position={[0, BOOK_BASE_Y, 0]}
      rotation={[-0.3, 0.1, 0]}
    >
      {/* Weicher Kontaktschatten unter dem gesamten aufgeschlagenen Buch */}
      <mesh
        position={[0, -(PAGE_H / 2 + 0.18), -0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[3.4, 2.0]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Buchrücken */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[0.05, PAGE_H + 0.1, 0.12]} />
        <meshStandardMaterial
          color="#e8c77d"
          roughness={0.4}
          metalness={0.15}
        />
      </mesh>

      {/* Bindung/Rückwand — spannt symmetrisch über die gesamte offene
          Doppelseite und gibt dem Buch als Ganzes einen sichtbar
          gebundenen Rahmen, statt zweier loser Karten. */}
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[2 * PAGE_W + 0.16, PAGE_H + 0.14, 0.03]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, -0.03]}>
        <boxGeometry args={[2 * PAGE_W + 0.1, PAGE_H + 0.1, 0.02]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.6} />
      </mesh>

      {/* Papierstapel-Detail je Seite: dünne cremefarbene Box unter jeder
          Buchhälfte, deutet die restlichen (nicht einzeln modellierten)
          Seiten als geschlossenen Papierblock an — gibt dem Buch sichtbare
          Tiefe statt nur flach wirkender Karten. */}
      <mesh position={[PAGE_W / 2, 0, -0.012]}>
        <boxGeometry args={[PAGE_W, PAGE_H, 0.02]} />
        <meshStandardMaterial color="#f3ead2" roughness={0.85} />
      </mesh>
      <mesh position={[-PAGE_W / 2, 0, -0.012]}>
        <boxGeometry args={[PAGE_W, PAGE_H, 0.02]} />
        <meshStandardMaterial color="#f3ead2" roughness={0.85} />
      </mesh>

      {nearBook && (
        <Suspense fallback={null}>
          <PhotoPages index={index} />
        </Suspense>
      )}
    </group>
  );
};

export const PhotosHtml = () => {
  const spread = clampSpread(
    useSyncExternalStore(subscribeBookPage, getBookPage),
  );
  // Während einer laufenden Blätter-Drehung (siehe PhotoPages/TurningSheet)
  // sind die Buttons kurz gesperrt — sauberer als eine Klick-Queue, siehe
  // Modul-Kommentar bei `setTurnLocked`.
  const isTurning = useSyncExternalStore(subscribeTurnLocked, getTurnLocked);
  const isFirst = spread <= 0;
  const isLast = spread >= SPREAD_COUNT - 1;
  const backDisabled = isFirst || isTurning;
  const nextDisabled = isLast || isTurning;

  return (
    <div className="exp-content" style={{ paddingTop: "9vh" }}>
      <span className="exp-kicker">Kapitel 1</span>
      <h2 className="exp-title">Ein schönes Jahr mit der schönsten Person</h2>
      <p className="exp-subtitle">Unser Jahr, Seite für Seite.</p>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: backDisabled ? 0.4 : 1 }}
          disabled={backDisabled}
          onClick={() => setBookPage(clampSpread(spread - 1))}
          aria-label="Zurück blättern"
        >
          ‹ Zurück blättern
        </button>
        <span className="exp-subtitle" style={{ opacity: 0.75 }}>
          Seite {spread + 1} / {SPREAD_COUNT}
        </span>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: nextDisabled ? 0.4 : 1 }}
          disabled={nextDisabled}
          onClick={() => setBookPage(clampSpread(spread + 1))}
          aria-label="Weiterblättern"
        >
          Weiterblättern ›
        </button>
      </div>
    </div>
  );
};
