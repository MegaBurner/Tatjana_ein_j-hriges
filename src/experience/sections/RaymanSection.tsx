import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import type { SectionProps } from "../types";

// „Player 2" — Fan-Hommage aus reinen Primitiven (keine fremden Assets):
// ein Rayman-artiger Held, dessen Hände/Füße/Kopf OHNE Arme und Beine frei
// neben dem Körper schweben (das körperlose Schweben ist der Witz der Figur),
// plus drei Rabbid-artige Hasen mit verrücktem Blick. Einer liegt umgekippt
// auf dem Rücken und strampelt gelegentlich.

// --- Klick/Tipp-Interaktion (Muster wie Penguins/Globe) --------------------
/** Klick nur werten, wenn sich der Pointer < 8px bewegt hat (Tap vs. Drag/Scroll). */
const TAP_MAX_DELTA_PX = 8;
/** Ab dieser Sichtbarkeit reagiert die Szene auf Klick/Tipp. */
const INTERACTION_VISIBILITY_THRESHOLD = 0.3;

// --- Held: Idle ------------------------------------------------------------
/** Sinus-Schweben des Helden: ±Amplitude über eine Periode von ~3s. */
const HERO_HOVER_AMPLITUDE = 0.05;
const HERO_HOVER_OMEGA = (Math.PI * 2) / 3;
/** Hände kreisen dezent (kleine Kreise um ihre Ruheposition neben dem Rumpf). */
const HAND_BASE_X = 0.52;
const HAND_BASE_Y = 0.62;
const HAND_ORBIT_RADIUS = 0.06;
const HAND_ORBIT_SPEED = 1.6;
/** Haarbüschel-Wippen im Idle. */
const HAIR_BOB_SPEED = 2.4;
const HAIR_BOB_ANGLE = 0.12;

// --- Held: Helikopter-Haare (Klick) — bewusst kräftig -----------------------
const HELI_DURATION_S = 1.6;
/** Rotor-Drehzahl der Haarbüschel. */
const HELI_SPIN_SPEED = 12;
/** Deutlicher Abhebe-Hub (Sinus-Bogen über die Gesamtdauer). */
const HELI_LIFT = 0.5;
/** Der Blob-Schatten schrumpft beim Abheben leicht mit. */
const HELI_SHADOW_SHRINK = 0.3;

// --- Rabbid: Idle ------------------------------------------------------------
/** Grund-Zappeln (Körper-Ruckeln) — Frequenz kommt versetzt pro Hase. */
const RABBID_JIGGLE_ANGLE = 0.05;
const RABBID_EAR_IDLE_ANGLE = 0.08;
/** Grund-Neigung der Ohren nach außen. */
const RABBID_EAR_TILT = 0.12;
/** Gelegentliche Strampel-Bursts des Umgekippten: langsame Sinus-Hüllkurve
 *  hoch potenziert ⇒ kurze Ausbrüche mit langen Pausen dazwischen. */
const KICK_ENVELOPE_OMEGA = 0.9;
const KICK_ENVELOPE_POWER = 8;
const KICK_FOOT_SPEED = 22;
const KICK_FOOT_ANGLE = 0.6;
const KICK_BODY_SHAKE = 0.05;
/** Liege-Höhe des umgekippten Körpers (Kapsel-Radius über dem Boden). */
const FALLEN_BODY_Y = 0.3;
/** Rücklage des Umgekippten (fast flach, Ohren zur Kamera gekippt). */
const FALLEN_TILT_X = -1.25;

// --- Rabbid: „BWAAAH" (Klick) — bewusst kräftig ------------------------------
/** Lebensdauer des gesamten Schrei-Effekts inkl. Label-Fade. */
const BWAAAH_LIFETIME_S = 1.5;
/** Kraftvoller Sprung zu Beginn. */
const BWAAAH_JUMP_HEIGHT = 0.4;
const BWAAAH_JUMP_DURATION_S = 0.55;
/** Starkes Ohren-Flattern während der Schrei-Hüllkurve. */
const BWAAAH_EAR_FLAP_SPEED = 26;
const BWAAAH_EAR_FLAP_ANGLE = 0.45;
/** Mund reißt auf (Y-Scale-Spitze). */
const BWAAAH_MOUTH_SCALE_Y = 3.4;
const BWAAAH_MOUTH_SCALE_X = 1.5;
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

// --- Farben ------------------------------------------------------------------
const HERO_TORSO = "#7b4fc0";
const HERO_TORSO_PATCH = "#f4efe6";
const HERO_SKIN = "#f7c59f";
const HERO_NOSE = "#eab389";
const HERO_HAIR = "#f6c445";
const HERO_GLOVE = "#f8f6f2";
const HERO_SHOE = "#e8973a";
const HERO_MOUTH = "#7a3327";
const RABBID_FUR = "#f2efe9";
const RABBID_BELLY = "#e8e2d6";
const RABBID_EAR_INNER = "#f0a8b8";
const RABBID_MOUTH = "#4a1f2b";
const PUPIL = "#231733";

/** Von der Scene gepflegte Sichtbarkeits-Flags für alle Sub-Komponenten. */
interface GateRefs {
  /** Section überhaupt sichtbar? (Sub-Loops früh verlassen) */
  visibleRef: RefObject<boolean>;
  /** Sichtbar genug für Klick/Tipp + Pointer-Cursor? */
  interactiveRef: RefObject<boolean>;
}

// ============================================================================
// Held im Rayman-Stil
// ============================================================================

function HeroEye({ x }: { x: number }) {
  return (
    <group position={[x, 0.06, 0.16]}>
      <mesh scale={[1, 1.2, 0.6]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[Math.sign(x) * 0.008, 0, 0.028]}>
        <sphereGeometry args={[0.02, 8, 6]} />
        <meshStandardMaterial color={PUPIL} />
      </mesh>
    </group>
  );
}

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
  const floatRef = useRef<THREE.Group>(null);
  const hairRef = useRef<THREE.Group>(null);
  const handLeftRef = useRef<THREE.Group>(null);
  const handRightRef = useRef<THREE.Group>(null);
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
    if (!gates.visibleRef.current) return;
    const float = floatRef.current;
    const hair = hairRef.current;
    const handL = handLeftRef.current;
    const handR = handRightRef.current;
    if (!float || !hair || !handL || !handR) return;
    const t = state.clock.elapsedTime;

    // Tap konsumieren — bei reduced motion bleibt die Figur statisch.
    if (heliRequestedRef.current) {
      heliRequestedRef.current = false;
      if (!reducedMotion) heliStartRef.current = t;
    }
    if (reducedMotion) return;

    // Helikopter-Flug: Haare als Rotor, deutlicher Sinus-Hub übers Ganze.
    let lift = 0;
    let isFlying = false;
    const heliStart = heliStartRef.current;
    if (heliStart !== null) {
      const elapsed = t - heliStart;
      if (elapsed >= HELI_DURATION_S) {
        heliStartRef.current = null;
      } else {
        isFlying = true;
        lift = Math.sin((elapsed / HELI_DURATION_S) * Math.PI) * HELI_LIFT;
        hair.rotation.y = elapsed * HELI_SPIN_SPEED;
        hair.rotation.z = 0;
      }
    }

    // Idle: sinusförmiges Schweben + wippende Haarbüschel.
    float.position.y =
      Math.sin(t * HERO_HOVER_OMEGA) * HERO_HOVER_AMPLITUDE + lift;
    if (!isFlying) {
      hair.rotation.y = 0;
      hair.rotation.z = Math.sin(t * HAIR_BOB_SPEED) * HAIR_BOB_ANGLE;
    }

    // Hände: kleine gegenphasige Kreise um ihre Ruheposition neben dem Rumpf.
    const angle = t * HAND_ORBIT_SPEED;
    handL.position.x = -HAND_BASE_X + Math.cos(angle) * HAND_ORBIT_RADIUS;
    handL.position.y = HAND_BASE_Y + Math.sin(angle) * HAND_ORBIT_RADIUS;
    handR.position.x =
      HAND_BASE_X + Math.cos(angle + Math.PI) * HAND_ORBIT_RADIUS;
    handR.position.y =
      HAND_BASE_Y + Math.sin(angle + Math.PI) * HAND_ORBIT_RADIUS;

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
        {/* Schuhe — schweben OHNE Beine unter dem Rumpf */}
        <mesh
          position={[-0.22, 0.14, 0.1]}
          rotation={[0, 0.3, 0]}
          scale={[0.3, 0.17, 0.44]}
        >
          <sphereGeometry args={[0.5, 14, 10]} />
          <meshStandardMaterial color={HERO_SHOE} roughness={0.5} />
        </mesh>
        <mesh
          position={[0.22, 0.14, 0.1]}
          rotation={[0, -0.3, 0]}
          scale={[0.3, 0.17, 0.44]}
        >
          <sphereGeometry args={[0.5, 14, 10]} />
          <meshStandardMaterial color={HERO_SHOE} roughness={0.5} />
        </mesh>

        {/* Rumpf — lila Ellipsoid mit hellem Bauchfleck */}
        <mesh position={[0, 0.62, 0]} scale={[0.52, 0.6, 0.44]}>
          <sphereGeometry args={[0.5, 16, 12]} />
          <meshStandardMaterial color={HERO_TORSO} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.58, 0.16]} scale={[0.3, 0.4, 0.2]}>
          <sphereGeometry args={[0.5, 14, 10]} />
          <meshStandardMaterial color={HERO_TORSO_PATCH} roughness={0.6} />
        </mesh>

        {/* Handschuh-Kugeln — schweben OHNE Arme neben dem Rumpf */}
        <group ref={handLeftRef} position={[-HAND_BASE_X, HAND_BASE_Y, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.11, 12, 10]} />
            <meshStandardMaterial color={HERO_GLOVE} roughness={0.45} />
          </mesh>
        </group>
        <group ref={handRightRef} position={[HAND_BASE_X, HAND_BASE_Y, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.11, 12, 10]} />
            <meshStandardMaterial color={HERO_GLOVE} roughness={0.45} />
          </mesh>
        </group>

        {/* Kopf — schwebt frei ÜBER dem Rumpf, die Lücke ist Absicht */}
        <group position={[0, 1.22, 0]}>
          <mesh scale={[0.42, 0.4, 0.4]}>
            <sphereGeometry args={[0.5, 16, 12]} />
            <meshStandardMaterial color={HERO_SKIN} roughness={0.55} />
          </mesh>

          <HeroEye x={-0.085} />
          <HeroEye x={0.085} />

          {/* Nase */}
          <mesh position={[0, -0.01, 0.19]}>
            <sphereGeometry args={[0.055, 10, 8]} />
            <meshStandardMaterial color={HERO_NOSE} roughness={0.55} />
          </mesh>

          {/* Großes Grinsen — Torus-Segment, unten am Kopf zentriert */}
          <mesh position={[0, -0.06, 0.165]} rotation={[0, 0, Math.PI * 1.075]}>
            <torusGeometry args={[0.11, 0.024, 8, 20, Math.PI * 0.85]} />
            <meshStandardMaterial color={HERO_MOUTH} roughness={0.5} />
          </mesh>

          {/* Zwei gelbe Haarbüschel — beim Klick der Helikopter-Rotor */}
          <group ref={hairRef} position={[0, 0.17, 0]}>
            <mesh
              position={[-0.11, 0.05, 0]}
              rotation={[0, 0, 0.55]}
              scale={[0.3, 0.1, 0.14]}
            >
              <sphereGeometry args={[0.5, 12, 8]} />
              <meshStandardMaterial color={HERO_HAIR} roughness={0.5} />
            </mesh>
            <mesh
              position={[0.11, 0.05, 0]}
              rotation={[0, 0, -0.55]}
              scale={[0.3, 0.1, 0.14]}
            >
              <sphereGeometry args={[0.5, 12, 8]} />
              <meshStandardMaterial color={HERO_HAIR} roughness={0.5} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

// ============================================================================
// Rabbid-artiger Hase
// ============================================================================

/** Riesiges ovales Auge mit kleiner, schielend versetzter Pupille. */
function RabbidEye({
  x,
  pupilOffset,
}: {
  x: number;
  pupilOffset: [number, number];
}) {
  return (
    <group position={[x, 0.62, 0.235]}>
      <mesh scale={[1, 1.35, 0.6]}>
        <sphereGeometry args={[0.08, 12, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[pupilOffset[0], pupilOffset[1], 0.055]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color={PUPIL} />
      </mesh>
    </group>
  );
}

/** Ohr aus zwei Kapsel-Segmenten (leicht geknickt = „gebogen") mit rosa
 *  Innenseite. Der Gruppen-Ursprung liegt am Ohransatz — Wackeln/Flattern
 *  rotiert das ganze Ohr um diesen Punkt. */
function RabbidEar({ mirror }: { mirror: 1 | -1 }) {
  return (
    <>
      <mesh position={[0, 0.16, 0]}>
        <capsuleGeometry args={[0.05, 0.28, 4, 10]} />
        <meshStandardMaterial color={RABBID_FUR} roughness={0.55} />
      </mesh>
      <mesh
        position={[mirror * 0.045, 0.42, 0]}
        rotation={[0, 0, mirror * -0.35]}
      >
        <capsuleGeometry args={[0.045, 0.2, 4, 10]} />
        <meshStandardMaterial color={RABBID_FUR} roughness={0.55} />
      </mesh>
      {/* Rosa Innenseite des unteren Segments */}
      <mesh position={[0, 0.18, 0.042]} scale={[0.055, 0.22, 0.02]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color={RABBID_EAR_INNER} roughness={0.6} />
      </mesh>
    </>
  );
}

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
  const bodyRef = useRef<THREE.Group>(null);
  const earLeftRef = useRef<THREE.Group>(null);
  const earRightRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const footLeftRef = useRef<THREE.Mesh>(null);
  const footRightRef = useRef<THREE.Mesh>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const spriteMaterialRef = useRef<THREE.SpriteMaterial>(null);
  /** Tap-Anfrage aus dem Event-Handler — wird im useFrame-Loop konsumiert. */
  const bwaahRequestedRef = useRef(false);
  /** Startzeit (clock.elapsedTime) des laufenden Schreis, sonst null. */
  const bwaahStartRef = useRef<number | null>(null);

  const baseBodyY = fallen ? FALLEN_BODY_Y : 0;

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
    if (!gates.visibleRef.current) return;
    const body = bodyRef.current;
    const earL = earLeftRef.current;
    const earR = earRightRef.current;
    const mouth = mouthRef.current;
    const sprite = spriteRef.current;
    const spriteMat = spriteMaterialRef.current;
    if (!body || !earL || !earR || !mouth || !sprite || !spriteMat) return;
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

    // Mund reißt beim Schrei auf.
    mouth.scale.set(
      1 + shout * (BWAAAH_MOUTH_SCALE_X - 1),
      1 + shout * (BWAAAH_MOUTH_SCALE_Y - 1),
      1,
    );

    if (reducedMotion) return;

    // Idle: Körper-Ruckeln + Ohren-Wackeln, pro Hase versetzt; beim Schrei
    // flattern die Ohren stark obendrauf.
    let jiggle = Math.sin(t * wobbleFreq + phase) * RABBID_JIGGLE_ANGLE;
    const flap =
      shout * Math.sin(t * BWAAAH_EAR_FLAP_SPEED) * BWAAAH_EAR_FLAP_ANGLE;
    earL.rotation.z =
      RABBID_EAR_TILT +
      Math.sin(t * wobbleFreq * 0.8 + phase) * RABBID_EAR_IDLE_ANGLE +
      flap;
    earR.rotation.z =
      -RABBID_EAR_TILT +
      Math.sin(t * wobbleFreq * 0.8 + phase + 1.7) * RABBID_EAR_IDLE_ANGLE -
      flap;

    // Der Umgekippte strampelt gelegentlich (kurze Bursts, lange Pausen).
    if (fallen) {
      const kick =
        Math.max(0, Math.sin(t * KICK_ENVELOPE_OMEGA + phase)) **
        KICK_ENVELOPE_POWER;
      const footL = footLeftRef.current;
      const footR = footRightRef.current;
      if (footL && footR) {
        footL.rotation.x =
          Math.sin(t * KICK_FOOT_SPEED) * KICK_FOOT_ANGLE * kick;
        footR.rotation.x =
          Math.sin(t * KICK_FOOT_SPEED + Math.PI) * KICK_FOOT_ANGLE * kick;
      }
      jiggle += Math.sin(t * 18) * KICK_BODY_SHAKE * kick;
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
        position={[0, baseBodyY, 0]}
        rotation={fallen ? [FALLEN_TILT_X, 0, 0] : [0, 0, 0]}
        onClick={handleTap}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        {/* Kapsel-Körper */}
        <mesh position={[0, 0.45, 0]}>
          <capsuleGeometry args={[0.26, 0.3, 4, 14]} />
          <meshStandardMaterial color={RABBID_FUR} roughness={0.55} />
        </mesh>
        {/* Kleiner runder Bauch */}
        <mesh position={[0, 0.36, 0.16]} scale={[0.17, 0.19, 0.13]}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color={RABBID_BELLY} roughness={0.6} />
        </mesh>

        {/* Füße — kleine Ellipsoide; beim Umgekippten strampeln sie */}
        <mesh
          ref={footLeftRef}
          position={[-0.12, 0.05, 0.16]}
          scale={[0.11, 0.07, 0.18]}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color={RABBID_FUR} roughness={0.55} />
        </mesh>
        <mesh
          ref={footRightRef}
          position={[0.12, 0.05, 0.16]}
          scale={[0.11, 0.07, 0.18]}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color={RABBID_FUR} roughness={0.55} />
        </mesh>

        {/* Riesige ovale Augen — Pupillen schielend versetzt */}
        <RabbidEye x={-0.085} pupilOffset={[0.014, 0.012]} />
        <RabbidEye x={0.085} pupilOffset={[0.016, -0.012]} />

        {/* Mund — reißt beim „BWAAAH" auf */}
        <mesh ref={mouthRef} position={[0, 0.47, 0.255]} scale={[1, 1, 1]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color={RABBID_MOUTH} roughness={0.5} />
        </mesh>
        {/* Zwei große Hasenzähne */}
        <mesh position={[-0.018, 0.42, 0.25]} scale={[0.016, 0.024, 0.01]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#ffffff" roughness={0.35} />
        </mesh>
        <mesh position={[0.018, 0.42, 0.25]} scale={[0.016, 0.024, 0.01]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#ffffff" roughness={0.35} />
        </mesh>

        {/* Zwei lange aufrechte Ohren */}
        <group ref={earLeftRef} position={[-0.09, 0.78, -0.02]}>
          <RabbidEar mirror={-1} />
        </group>
        <group ref={earRightRef} position={[0.09, 0.78, -0.02]}>
          <RabbidEar mirror={1} />
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
