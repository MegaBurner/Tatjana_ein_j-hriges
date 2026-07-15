import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useAnimations, useGLTF, useScroll } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import {
  preloadRaymanModels,
  RABBID_FALLEN_MODEL_URL,
  RABBID_MODEL_URL,
  RAYMAN_HERO_MODEL_URL,
  scheduleIdle,
} from "../preloadAssets";
import type { SectionProps } from "../types";

// „Player 2" — Fan-Hommage mit richtigen (CC0-lizenzierten) GLB-Figuren:
// ein Cartoon-Held im Spielhelden-Look plus drei verrückte Hasen, davon
// einer umgekippt auf dem Rücken, der gelegentlich strampelt. Alle drei
// Modelle stammen von Quaternius (Public Domain / CC0) — Details und
// Quell-URLs in CREDITS.md im Repo-Root. Die Interaktions- und Idle-Logik
// (Schweben, Zappeln, Helikopter-Lift, „BWAAAH!") ist aus der früheren
// Primitiven-Fassung übernommen und wirkt auf die Modell-Root-Groups; die
// GLBs bringen zusätzlich eigene Idle-/Run-Clips mit (Skelett-Animation).

// --- Klick/Tipp-Interaktion (Muster wie Penguins/Globe) --------------------
/** Klick nur werten, wenn sich der Pointer < 8px bewegt hat (Tap vs. Drag/Scroll). */
const TAP_MAX_DELTA_PX = 8;
/** Ab dieser Sichtbarkeit reagiert die Szene auf Klick/Tipp. */
const INTERACTION_VISIBILITY_THRESHOLD = 0.3;

// --- Modell-Maße -------------------------------------------------------------
// Ziel-Höhen der Figuren in der Komposition. Die tatsächliche Skala und die
// Bodenlage werden zur Laufzeit per Bounding-Box aus dem geladenen GLB
// berechnet (Auto-Fit in useFigureModel) — dadurch funktionieren auch
// ausgetauschte Modelle in public/models/ ohne Code-Anpassung.
/** Held (hero.glb): Zielhöhe in lokalen Einheiten. */
const HERO_TARGET_HEIGHT = 1.5;
/** Hasen (rabbid.glb / rabbid-fallen.glb): Zielhöhe inkl. Ohren. */
const RABBID_TARGET_HEIGHT = 1.2;

// --- Held: Idle ------------------------------------------------------------
/** Sinus-Schweben des Helden: ±Amplitude über eine Periode von ~3s. */
const HERO_HOVER_AMPLITUDE = 0.05;
const HERO_HOVER_OMEGA = (Math.PI * 2) / 3;

// --- Held: Helikopter-Lift (Klick) — bewusst kräftig -------------------------
const HELI_DURATION_S = 1.6;
/** Das Modell hat keine separaten Haarbüschel als Rotor — stattdessen hebt
 *  der ganze Held mit Dreh-Impuls ab: easeOutCubic bis exakt 2 Umdrehungen,
 *  landet also ohne Sprung wieder in Ausgangsorientierung. */
const HELI_TOTAL_SPIN_RAD = Math.PI * 4;
/** Deutlicher Abhebe-Hub (Sinus-Bogen über die Gesamtdauer). */
const HELI_LIFT = 0.5;
/** Der Blob-Schatten schrumpft beim Abheben leicht mit. */
const HELI_SHADOW_SHRINK = 0.3;

// --- Rabbid: Idle ------------------------------------------------------------
/** Grund-Zappeln (Körper-Ruckeln) — Frequenz kommt versetzt pro Hase. */
const RABBID_JIGGLE_ANGLE = 0.05;
/** Gelegentliche Strampel-Bursts des Umgekippten: langsame Sinus-Hüllkurve
 *  hoch potenziert ⇒ kurze Ausbrüche mit langen Pausen dazwischen. Die
 *  Hüllkurve blendet den eingebetteten Run-Clip ein (Beine strampeln). */
const KICK_ENVELOPE_OMEGA = 0.9;
const KICK_ENVELOPE_POWER = 8;
const KICK_SHAKE_SPEED = 18;
const KICK_BODY_SHAKE = 0.05;
/** Rücklage des Umgekippten (fast flach, Bauch zur Kamera gekippt). */
const FALLEN_TILT_X = -1.25;

// --- Rabbid: „BWAAAH" (Klick) — bewusst kräftig ------------------------------
/** Lebensdauer des gesamten Schrei-Effekts inkl. Label-Fade. */
const BWAAAH_LIFETIME_S = 1.5;
/** Kraftvoller Sprung zu Beginn. */
const BWAAAH_JUMP_HEIGHT = 0.4;
const BWAAAH_JUMP_DURATION_S = 0.55;
/** Starkes Körper-Schütteln während der Schrei-Hüllkurve. */
const BWAAAH_SHAKE_SPEED = 26;
const BWAAAH_SHAKE_ANGLE = 0.12;
/** Pop-in (easeOutBack) und Fade-out des Text-Sprites. */
const BWAAAH_POP_S = 0.22;
const BWAAAH_FADE_S = 0.35;

// --- „BWAAAH!"-Text-Sprite (Canvas-Textur, Comic-Stil — wie Pin-Labels) -----
const BWAAAH_TEXTURE_WIDTH = 512;
const BWAAAH_TEXTURE_HEIGHT = 192;
const BWAAAH_WORLD_WIDTH = 1.5;
const BWAAAH_WORLD_HEIGHT =
  BWAAAH_WORLD_WIDTH * (BWAAAH_TEXTURE_HEIGHT / BWAAAH_TEXTURE_WIDTH);
const BWAAAH_TEXT = "BWAAAH!";
const BWAAAH_FONT_PX = 96;
const BWAAAH_FILL = "#ffd23f";
const BWAAAH_OUTLINE = "#2b1c33";
const BWAAAH_OUTLINE_PX = 20;
/** Leichte Comic-Schräglage des Schriftzugs. */
const BWAAAH_TILT_RAD = -0.06;

let bwaaahTexture: THREE.CanvasTexture | null = null;

/** Zeichnet den Schriftzug einmalig auf ein Canvas — Modul-Singleton. */
function getBwaaahTexture(): THREE.CanvasTexture {
  if (bwaaahTexture) return bwaaahTexture;
  const canvas = document.createElement("canvas");
  canvas.width = BWAAAH_TEXTURE_WIDTH;
  canvas.height = BWAAAH_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.translate(BWAAAH_TEXTURE_WIDTH / 2, BWAAAH_TEXTURE_HEIGHT / 2);
    ctx.rotate(BWAAAH_TILT_RAD);
    ctx.font = `900 ${BWAAAH_FONT_PX}px 'Inter', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = BWAAAH_OUTLINE;
    ctx.lineWidth = BWAAAH_OUTLINE_PX;
    ctx.strokeText(BWAAAH_TEXT, 0, 0);
    ctx.fillStyle = BWAAAH_FILL;
    ctx.fillText(BWAAAH_TEXT, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  bwaaahTexture = texture;
  return texture;
}

/** Easing mit Überschwinger für Pop-in-Effekte (wie Penguins/Globe). */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** easeOutCubic für den Dreh-Impuls des Helikopter-Lifts. */
function easeOutCubic(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

/** Von der Scene gepflegte Sichtbarkeits-Flags für alle Sub-Komponenten. */
interface GateRefs {
  /** Section überhaupt sichtbar? (Sub-Loops früh verlassen) */
  visibleRef: RefObject<boolean>;
  /** Sichtbar genug für Klick/Tipp + Pointer-Cursor? */
  interactiveRef: RefObject<boolean>;
}

// ============================================================================
// GLB-Helfer
// ============================================================================

/**
 * Lädt ein GLB und liefert einen unabhängigen Klon (SkeletonUtils.clone —
 * nötig, weil useGLTF eine gecachte Szene liefert und die stehenden Hasen
 * dasselbe Modell zweimal verwenden). Skinned Meshes bekommen
 * `frustumCulled = false`: ihre statischen Geometrie-Bounds stimmen nach
 * Skelett-Animation nicht mehr, three würde sie sonst fälschlich cullen.
 */
function useFigureModel(
  url: string,
  targetHeight: number,
  restTiltX = 0,
): {
  clone: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Skaliert das Modell auf targetHeight (Bounding-Box der Bind-Pose). */
  fitScale: number;
  /** Hebt die Unterkante (nach Skala + restTiltX) exakt auf y=0. */
  groundY: number;
  /** Zentriert das Modell horizontal im Eltern-Frame. */
  centerX: number;
  centerZ: number;
} {
  const { scene, animations } = useGLTF(url);
  return useMemo(() => {
    const cloned = cloneSkeleton(scene);
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.frustumCulled = false;
    });
    // Auto-Fit: Skala und Bodenlage aus der Bounding-Box statt aus fest
    // vermessenen Werten — ausgetauschte GLBs passen sich damit selbst ein.
    const restBox = new THREE.Box3().setFromObject(cloned);
    const restHeight = Math.max(restBox.max.y - restBox.min.y, 1e-6);
    const fitScale = targetHeight / restHeight;
    // Bodenlage/Zentrierung nach Skala und Liege-Rotation messen: eine
    // temporäre Proben-Gruppe wendet beides an, danach wird der Klon
    // wieder ausgehängt (React-<primitive> re-parented ihn ohnehin).
    const probe = new THREE.Group();
    probe.add(cloned);
    probe.scale.setScalar(fitScale);
    probe.rotation.x = restTiltX;
    probe.updateMatrixWorld(true);
    const fittedBox = new THREE.Box3().setFromObject(probe);
    probe.remove(cloned);
    return {
      clone: cloned,
      animations,
      fitScale,
      groundY: -fittedBox.min.y,
      centerX: -(fittedBox.min.x + fittedBox.max.x) / 2,
      centerZ: -(fittedBox.min.z + fittedBox.max.z) / 2,
    };
  }, [scene, animations, targetHeight, restTiltX]);
}

/**
 * Sucht eine Action über den Clip-Kurznamen — die Quaternius-Exporte
 * prefixen unterschiedlich tief ("Idle", "CharacterArmature|Idle",
 * "CharacterArmature|...|Idle").
 */
function findAction(
  actions: Record<string, THREE.AnimationAction | null>,
  clipName: string,
): THREE.AnimationAction | null {
  for (const name of Object.keys(actions)) {
    if (name === clipName || name.endsWith(`|${clipName}`)) {
      return actions[name];
    }
  }
  return null;
}

/**
 * Spielt den eingebetteten Idle-Clip in Endlosschleife, versetzt um `phase`
 * Sekunden (die Hasen zappeln bewusst nicht synchron). Liefert die Action
 * als Ref für den useFrame-Loop: dort wird sie bei unsichtbarer Section und
 * bei reduced motion pausiert — pausiert heißt eingefroren auf einer
 * natürlichen Idle-Pose statt der T-Pose des unanimierten Skeletts.
 */
function useIdleAction(
  actions: Record<string, THREE.AnimationAction | null>,
  phase: number,
): RefObject<THREE.AnimationAction | null> {
  const idleRef = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    const idle = findAction(actions, "Idle");
    idleRef.current = idle;
    if (!idle) return undefined;
    idle.reset().play();
    idle.time = phase % idle.getClip().duration;
    return () => {
      idle.stop();
      idleRef.current = null;
    };
  }, [actions, phase]);
  return idleRef;
}

// ============================================================================
// Held im Spielhelden-Stil
// ============================================================================

function RaymanHero({
  position,
  scale,
  gates,
  reducedMotion,
}: {
  position: [number, number, number];
  scale: number;
  gates: GateRefs;
  reducedMotion: boolean;
}) {
  const shadowTexture = getSoftShadowTexture();
  const { clone, animations, fitScale, groundY, centerX, centerZ } =
    useFigureModel(RAYMAN_HERO_MODEL_URL, HERO_TARGET_HEIGHT);
  const { actions } = useAnimations(animations, clone);
  const idleActionRef = useIdleAction(actions, 0);
  const floatRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  /** Tap-Anfrage aus dem Event-Handler — wird im useFrame-Loop konsumiert. */
  const heliRequestedRef = useRef(false);
  /** Startzeit (clock.elapsedTime) des laufenden Helikopter-Flugs, sonst null. */
  const heliStartRef = useRef<number | null>(null);

  const handleTap = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!gates.interactiveRef.current) return;
    if (event.delta > TAP_MAX_DELTA_PX) return;
    heliRequestedRef.current = true;
  };

  const handlePointerOver = () => {
    if (gates.interactiveRef.current) {
      document.body.style.cursor = "pointer";
    }
  };

  const handlePointerOut = () => {
    document.body.style.cursor = "";
  };

  useFrame((state) => {
    const isVisible = gates.visibleRef.current;
    // Skelett-Idle friert ein, wenn nichts zu sehen ist oder reduced motion
    // aktiv ist — VOR dem Sichtbarkeits-Early-Return, damit der Übergang
    // sichtbar→unsichtbar die Action zuverlässig pausiert.
    const idle = idleActionRef.current;
    if (idle) idle.paused = reducedMotion || !isVisible;
    if (!isVisible) return;
    const float = floatRef.current;
    if (!float) return;
    const t = state.clock.elapsedTime;

    // Tap konsumieren — bei reduced motion bleibt die Figur statisch.
    if (heliRequestedRef.current) {
      heliRequestedRef.current = false;
      if (!reducedMotion) heliStartRef.current = t;
    }
    if (reducedMotion) return;

    // Helikopter-Lift: ganzer Held hebt mit Dreh-Impuls ab (Sinus-Hub,
    // Drehung easeOutCubic bis exakt 2 Umdrehungen — landet nahtlos).
    let lift = 0;
    const heliStart = heliStartRef.current;
    if (heliStart !== null) {
      const elapsed = t - heliStart;
      if (elapsed >= HELI_DURATION_S) {
        heliStartRef.current = null;
        float.rotation.y = 0;
      } else {
        const progress = elapsed / HELI_DURATION_S;
        lift = Math.sin(progress * Math.PI) * HELI_LIFT;
        float.rotation.y = easeOutCubic(progress) * HELI_TOTAL_SPIN_RAD;
      }
    }

    // Idle: sinusförmiges Schweben der Root-Group; das Körper-Wippen kommt
    // aus dem eingebetteten Idle-Clip des Modells.
    float.position.y =
      Math.sin(t * HERO_HOVER_OMEGA) * HERO_HOVER_AMPLITUDE + lift;

    // Schatten schrumpft beim Abheben leicht.
    const shadow = shadowRef.current;
    if (shadow) {
      shadow.scale.setScalar(1 - (lift / HELI_LIFT) * HELI_SHADOW_SHRINK);
    }
  });

  return (
    <group position={position} scale={scale}>
      {/* Weicher Boden-Blob-Schatten — bleibt beim Schweben am Boden */}
      <mesh
        ref={shadowRef}
        position={[0, 0.006, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group
        ref={floatRef}
        onClick={handleTap}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <group scale={fitScale} position={[centerX, groundY, centerZ]}>
          <primitive object={clone} />
        </group>
      </group>
    </group>
  );
}

// ============================================================================
// Rabbid-artiger Hase
// ============================================================================

function Rabbid({
  position,
  rotationY,
  scale,
  fallen = false,
  wobbleFreq,
  phase,
  gates,
  reducedMotion,
}: {
  position: [number, number, number];
  rotationY: number;
  scale: number;
  fallen?: boolean;
  /** Individuelle Zappel-Frequenz — die Hasen ruckeln bewusst versetzt. */
  wobbleFreq: number;
  phase: number;
  gates: GateRefs;
  reducedMotion: boolean;
}) {
  const shadowTexture = getSoftShadowTexture();
  // Der Umgekippte ist ein eigenes Modell (grummeliger Hase mit Möhre) —
  // liegt er erst mal auf dem Rücken, passt der Gesichtsausdruck perfekt.
  const modelUrl = fallen ? RABBID_FALLEN_MODEL_URL : RABBID_MODEL_URL;
  const { clone, animations, fitScale, groundY, centerX, centerZ } =
    useFigureModel(modelUrl, RABBID_TARGET_HEIGHT, fallen ? FALLEN_TILT_X : 0);
  const { actions } = useAnimations(animations, clone);
  const idleActionRef = useIdleAction(actions, phase);
  /** Run-Clip des Umgekippten — Gewicht folgt der Strampel-Hüllkurve. */
  const kickActionRef = useRef<THREE.AnimationAction | null>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const spriteMaterialRef = useRef<THREE.SpriteMaterial>(null);
  /** Tap-Anfrage aus dem Event-Handler — wird im useFrame-Loop konsumiert. */
  const bwaahRequestedRef = useRef(false);
  /** Startzeit (clock.elapsedTime) des laufenden Schreis, sonst null. */
  const bwaahStartRef = useRef<number | null>(null);

  // Auto-Fit: Bodenlage kommt aus der Bounding-Box (beim Umgekippten nach
  // der Rücklage-Rotation gemessen) statt aus fest vermessenen Konstanten.
  const baseBodyY = groundY;

  useEffect(() => {
    if (!fallen) return undefined;
    const kick = findAction(actions, "Run");
    kickActionRef.current = kick;
    if (!kick) return undefined;
    // Läuft dauerhaft mit Gewicht 0 mit; die Hüllkurve blendet ihn für die
    // Strampel-Bursts ein — auf dem Rücken liegend strampeln so die Beine.
    kick.reset().play();
    kick.setEffectiveWeight(0);
    return () => {
      kick.stop();
      kickActionRef.current = null;
    };
  }, [actions, fallen]);

  const handleTap = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!gates.interactiveRef.current) return;
    if (event.delta > TAP_MAX_DELTA_PX) return;
    bwaahRequestedRef.current = true;
  };

  const handlePointerOver = () => {
    if (gates.interactiveRef.current) {
      document.body.style.cursor = "pointer";
    }
  };

  const handlePointerOut = () => {
    document.body.style.cursor = "";
  };

  useFrame((state) => {
    const isVisible = gates.visibleRef.current;
    // Wie beim Helden: Skelett-Clips vor dem Early-Return pausieren.
    const idle = idleActionRef.current;
    const kickAction = kickActionRef.current;
    if (idle) idle.paused = reducedMotion || !isVisible;
    if (kickAction) kickAction.paused = reducedMotion || !isVisible;
    if (!isVisible) return;
    const body = bodyRef.current;
    const sprite = spriteRef.current;
    const spriteMat = spriteMaterialRef.current;
    if (!body || !sprite || !spriteMat) return;
    const t = state.clock.elapsedTime;

    if (bwaahRequestedRef.current) {
      bwaahRequestedRef.current = false;
      bwaahStartRef.current = t;
    }

    // „BWAAAH": Sprung + Schrei-Hüllkurve + Text-Sprite-Timeline.
    let jump = 0;
    let shout = 0;
    let spritePop = 0;
    let spriteOpacity = 0;
    const start = bwaahStartRef.current;
    if (start !== null) {
      const elapsed = t - start;
      if (elapsed >= BWAAAH_LIFETIME_S) {
        bwaahStartRef.current = null;
      } else {
        if (!reducedMotion) {
          jump =
            Math.sin(Math.min(elapsed / BWAAAH_JUMP_DURATION_S, 1) * Math.PI) *
            BWAAAH_JUMP_HEIGHT;
          shout = Math.sin((elapsed / BWAAAH_LIFETIME_S) * Math.PI);
        }
        // Label ploppt immer — bei reduced motion ohne Overshoot.
        spritePop = reducedMotion
          ? 1
          : easeOutBack(Math.min(elapsed / BWAAAH_POP_S, 1));
        spriteOpacity = THREE.MathUtils.clamp(
          (BWAAAH_LIFETIME_S - elapsed) / BWAAAH_FADE_S,
          0,
          1,
        );
      }
    }

    sprite.scale.set(
      Math.max(BWAAAH_WORLD_WIDTH * spritePop, 0.0001),
      Math.max(BWAAAH_WORLD_HEIGHT * spritePop, 0.0001),
      1,
    );
    spriteMat.opacity = spriteOpacity;

    if (reducedMotion) return;

    // Idle: Körper-Ruckeln der Root-Group, pro Hase versetzt; beim Schrei
    // schüttelt sich der ganze Körper kräftig obendrauf.
    let jiggle = Math.sin(t * wobbleFreq + phase) * RABBID_JIGGLE_ANGLE;
    jiggle += Math.sin(t * BWAAAH_SHAKE_SPEED) * BWAAAH_SHAKE_ANGLE * shout;

    // Der Umgekippte strampelt gelegentlich (kurze Bursts, lange Pausen):
    // die Hüllkurve blendet den Run-Clip ein und schüttelt den Körper.
    if (fallen) {
      const kick =
        Math.max(0, Math.sin(t * KICK_ENVELOPE_OMEGA + phase)) **
        KICK_ENVELOPE_POWER;
      if (kickAction) kickAction.setEffectiveWeight(kick);
      if (idle) idle.setEffectiveWeight(1 - kick);
      jiggle += Math.sin(t * KICK_SHAKE_SPEED) * KICK_BODY_SHAKE * kick;
    }

    body.rotation.z = jiggle;
    body.position.y = baseBodyY + jump;
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      {/* Weicher Boden-Blob-Schatten */}
      <mesh
        position={[0, 0.006, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={fallen ? [1.4, 1.15, 1] : 1}
      >
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group
        ref={bodyRef}
        position={[centerX, baseBodyY, centerZ]}
        rotation={fallen ? [FALLEN_TILT_X, 0, 0] : [0, 0, 0]}
        onClick={handleTap}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <group scale={fitScale}>
          <primitive object={clone} />
        </group>
      </group>

      {/* „BWAAAH!"-Sprite — permanent gemountet, inaktiv auf Scale ~0/Opacity 0 */}
      <sprite
        ref={spriteRef}
        position={[0, fallen ? 1.0 : 1.55, 0.3]}
        scale={[0.0001, 0.0001, 1]}
      >
        <spriteMaterial
          ref={spriteMaterialRef}
          map={getBwaaahTexture()}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

// ============================================================================
// Scene + Html
// ============================================================================

export const RaymanScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const visibleRef = useRef(false);
  const interactiveRef = useRef(false);
  const gates: GateRefs = { visibleRef, interactiveRef };
  /** Erst nach dem Idle-Preload mounten — die Sections sind alle ab
   *  Experience-Start gemountet, useGLTF würde sonst sofort beim First
   *  Paint laden (Netz-Konkurrenz zum Hero). */
  const [modelsReady, setModelsReady] = useState(false);

  useEffect(() => {
    // Fenster 1: GLBs in den useGLTF-Cache laden; Fenster 2: Figuren
    // mounten (falls noch nicht fertig geladen, fängt Suspense das ab).
    let cancelMount: (() => void) | null = null;
    const cancelPreload = scheduleIdle(() => {
      preloadRaymanModels();
      cancelMount = scheduleIdle(() => setModelsReady(true));
    });
    return () => {
      cancelPreload();
      cancelMount?.();
    };
  }, []);

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    visibleRef.current = root.visible;
    interactiveRef.current = vis > INTERACTION_VISIBILITY_THRESHOLD;
  });

  return (
    <group ref={rootRef} position={[0, -1.6, 0]}>
      {modelsReady && (
        // Eigene Suspense-Grenze: das Nachladen der GLBs darf nie die
        // umgebende Szene in den globalen Fallback zwingen.
        <Suspense fallback={null}>
          <RaymanHero
            position={[-1.2, 0, 0]}
            scale={1.15}
            gates={gates}
            reducedMotion={reducedMotion}
          />
          <Rabbid
            position={[0.55, 0, -0.1]}
            rotationY={-0.35}
            scale={0.9}
            wobbleFreq={3.1}
            phase={0}
            gates={gates}
            reducedMotion={reducedMotion}
          />
          <Rabbid
            position={[1.75, 0, -0.35]}
            rotationY={0.3}
            scale={0.8}
            wobbleFreq={3.8}
            phase={2.1}
            gates={gates}
            reducedMotion={reducedMotion}
          />
          <Rabbid
            position={[1.15, 0, 0.75]}
            rotationY={0.5}
            scale={0.85}
            fallen
            wobbleFreq={2.6}
            phase={4.2}
            gates={gates}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      )}
    </group>
  );
};

export const RaymanHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 7</span>
    <h2 className="exp-title">Player 2</h2>
    <p className="exp-subtitle">
      Für alle Level, die wir noch zusammen zocken.
    </p>
  </div>
);
