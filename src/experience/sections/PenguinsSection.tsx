import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import { getHeartGeometry } from "../heartGeometry";
import type { SectionProps } from "../types";

// sectionVisibility's bell curve peaks at progress 0 and hard-cuts to
// invisible by local progress ≈0.75, so the kiss + heart burst must land
// well before that so the payoff is actually seen.
const WALK_SPAN = 0.3;
const LEAN_START = 0.4;
const LEAN_SPAN = 0.18;
const KISS_THRESHOLD = 0.5;
const START_X = 1.75;
// Kontaktpunkt geometrisch hergeleitet: die verkettete Rotation der
// Schnabelspitze (Lean um Z, danach der feste Yaw ±0.32 um Y — siehe
// waddle1Ref/waddle2Ref unten) liefert für die Kopf-/Schnabel-Maße in
// PenguinBody einen X-Beitrag von ±K bezogen auf die jeweilige
// Wurzelposition. Bei MEET_X = K treffen sich beide Schnabelspitzen exakt
// bei Welt-X 0 (Y/Z desselben Punkts: siehe KISS_CONTACT_* unten).
// Schnabelspitze lokal (0.47, 1.0, 0): R_y(∓0.32)·R_z(∓0.28)·(0.47, 1, 0)
// → (±0.691, 0.831, 0.229); Wurzel-Y ist -0.7 ⇒ Kontakt (0, 0.13, 0.23).
const MEET_X = 0.69;
const LEAN_ANGLE = 0.28;

/** Y-Skalierung der Augen im Kuss-Kontakt — "happy eyes" als Schlitze. */
const EYE_SLIT_SCALE = 0.15;

/** Der EINE große Herz-Pop am Kontaktpunkt der Schnäbel (siehe MEET_X oben). */
const KISS_CONTACT_X = 0;
const KISS_CONTACT_Y = 0.13;
const KISS_CONTACT_Z = 0.23;
const CONTACT_HEART_SCALE = 0.34;

/** Easing mit Overshoot (easeOutBack) für den Scale-in-Pop des großen
 *  Kuss-Herzens: verlässt 0, schießt kurz über 1 hinaus, landet bei 1. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

const HEART_COUNT = 12;
const HEART_LOOP_DURATION = 2.2;
const HEART_RISE_HEIGHT = 1.1;
const HEART_BASE_Y = 0.75;
/** Herz-Loop-Grundintensität, sobald die Section sichtbar/zentriert ist —
 *  Herzen schweben schon während des Watschelns/Stehens deutlich sichtbar
 *  über den Köpfen, nicht erst beim Kuss. */
const HEART_BASE_INTENSITY = 0.6;

interface PenguinColors {
  body: string;
  belly: string;
  face: string;
  blush: string;
  /** Kleines Gold-Herz auf der Brust — nur der rosa Pinguin trägt es. */
  hasChestHeart: boolean;
}

const DARK_PENGUIN: PenguinColors = {
  body: "#222831",
  belly: "#ffffff",
  face: "#ffffff",
  blush: "#f4a5ae",
  hasChestHeart: false,
};
const PINK_PENGUIN: PenguinColors = {
  body: "#f4a5ae",
  belly: "#fff8f9",
  face: "#fff7f8",
  blush: "#e07186",
  hasChestHeart: true,
};

// Kugel-Segmente modest gehalten (≤16 in der Breite) — rundere Silhouette
// ohne die Polygon-Last gegenüber der alten Version zu erhöhen.
const SPHERE_SEGMENTS = 16;
const SPHERE_RINGS = 12;

/** Zwei kleine, flache Wangen-Discs — beidseitig sichtbar, keine Ausrichtung nötig. */
function BlushCheeks({ facing, color }: { facing: 1 | -1; color: string }) {
  return (
    <>
      {[0.16, -0.16].map((z) => (
        <mesh key={z} position={[facing * 0.27, 0.95, z]}>
          <circleGeometry args={[0.06, 12]} />
          <meshStandardMaterial
            color={color}
            roughness={0.7}
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * Großes, ausdrucksstarkes Auge: weiße Sklera + schwarze Pupille + Glanzlicht.
 * `activeRef` treibt den Kuss-Kontakt: die Y-Skalierung geht auf
 * EYE_SLIT_SCALE zurück, sodass aus dem runden Auge ein "happy eye"-Schlitz wird.
 */
function Eye({
  facing,
  z,
  activeRef,
}: {
  facing: 1 | -1;
  z: number;
  activeRef: RefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.scale.y = THREE.MathUtils.lerp(1, EYE_SLIT_SCALE, activeRef.current);
  });

  return (
    <group ref={groupRef} position={[facing * 0.34, 1.05, z]}>
      <mesh>
        <sphereGeometry args={[0.062, 10, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[facing * 0.022, 0, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#14100f" />
      </mesh>
      <mesh position={[facing * 0.038, 0.019, 0.019]}>
        <sphereGeometry args={[0.015, 6, 6]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

/** Prozedural gebauter Pinguin. `facing` = +1 (blickt nach +X) oder -1 (blickt nach -X). */
function PenguinBody({
  facing,
  colors,
  activeRef,
}: {
  facing: 1 | -1;
  colors: PenguinColors;
  activeRef: RefObject<number>;
}) {
  const shadowTexture = getSoftShadowTexture();

  return (
    <group>
      {/* Weicher Kontaktschatten unter dem Pinguin */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Füße — wärmeres Orange, oval statt eckig */}
      <mesh position={[facing * 0.13, 0.035, 0.15]} scale={[0.22, 0.07, 0.3]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <meshStandardMaterial color="#f0952b" roughness={0.4} />
      </mesh>
      <mesh position={[facing * 0.13, 0.035, -0.15]} scale={[0.22, 0.07, 0.3]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <meshStandardMaterial color="#f0952b" roughness={0.4} />
      </mesh>

      {/* Körper — birnenförmig aus zwei überlappenden Kugeln (breite Basis,
          schmalere Schultern) statt einer einzigen Kugel */}
      <mesh position={[0, 0.4, 0]} scale={[0.6, 0.58, 0.56]}>
        <sphereGeometry args={[0.5, SPHERE_SEGMENTS, SPHERE_RINGS]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.68, 0]} scale={[0.52, 0.46, 0.48]}>
        <sphereGeometry args={[0.5, SPHERE_SEGMENTS, SPHERE_RINGS]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>

      {/* Schwänzchen */}
      <mesh
        position={[-facing * 0.28, 0.12, 0]}
        rotation={[0, 0, facing * 0.3]}
        scale={[0.14, 0.1, 0.12]}
      >
        <sphereGeometry args={[0.5, 10, 8]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>

      {/* Bauch — großer heller Fleck, reicht bis hoch unters Kinn */}
      <mesh position={[facing * 0.27, 0.62, 0]} scale={[0.34, 0.62, 0.38]}>
        <sphereGeometry args={[0.5, SPHERE_SEGMENTS, SPHERE_RINGS]} />
        <meshStandardMaterial color={colors.belly} roughness={0.6} />
      </mesh>

      {/* Flügel — weicher, rund, entspannt herabhängend */}
      <mesh
        position={[-facing * 0.08, 0.5, 0.4]}
        rotation={[-0.35, 0, 0]}
        scale={[0.15, 0.4, 0.22]}
      >
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>
      <mesh
        position={[-facing * 0.08, 0.5, -0.4]}
        rotation={[0.35, 0, 0]}
        scale={[0.15, 0.4, 0.22]}
      >
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>

      {/* Kopf — deutlich größer (Kindchenschema), überlappt bewusst mit dem
          oberen Körper für einen nahtlosen Übergang */}
      <mesh position={[0, 1.0, 0]} scale={[0.46, 0.44, 0.46]}>
        <sphereGeometry args={[0.5, SPHERE_SEGMENTS, SPHERE_RINGS]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>
      {/* Gesichtsfleck */}
      <mesh position={[facing * 0.25, 1.01, 0]} scale={[0.28, 0.26, 0.22]}>
        <sphereGeometry args={[0.5, 14, 12]} />
        <meshStandardMaterial color={colors.face} roughness={0.6} />
      </mesh>

      <BlushCheeks facing={facing} color={colors.blush} />
      <Eye facing={facing} z={0.13} activeRef={activeRef} />
      <Eye facing={facing} z={-0.13} activeRef={activeRef} />

      {/* Schnabel — deutlich sichtbar: Wurzel bei x=0.4, Spitze bei x=0.47,
          ragt damit klar aus dem Gesichtsfleck heraus (dessen Front endet bei
          x≈0.39 = 0.25 + 0.28·0.5). Die alte Version (r=0.03, l=0.08 bei
          x=0.33) steckte komplett IM Gesichtsfleck-Mesh — "kein Schnabel". */}
      <mesh
        position={[facing * 0.4, 1.0, 0]}
        rotation={[0, 0, (facing * -Math.PI) / 2]}
      >
        <coneGeometry args={[0.05, 0.14, 12]} />
        <meshStandardMaterial color="#e8a23d" roughness={0.4} />
      </mesh>

      {colors.hasChestHeart && (
        <mesh
          position={[facing * 0.24, 0.56, 0.27]}
          scale={0.09}
          geometry={getHeartGeometry()}
        >
          <meshStandardMaterial
            color="#e8c77d"
            roughness={0.35}
            metalness={0.3}
          />
        </mesh>
      )}
    </group>
  );
}

function IceFloe() {
  return (
    <group position={[0, -0.85, 0]}>
      <mesh>
        <cylinderGeometry args={[1.9, 2.0, 0.22, 40]} />
        <meshStandardMaterial color="#eaf4fb" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[1.75, 1.85, 0.1, 40]} />
        <meshStandardMaterial color="#ffffff" roughness={0.35} />
      </mesh>
      {/* Zarter eisiger Randschimmer entlang der oberen Kante */}
      <mesh position={[0, 0.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.8, 0.045, 8, 40]} />
        <meshStandardMaterial
          color="#dceefb"
          roughness={0.3}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
}

interface KissHeartSeed {
  x: number;
  z: number;
  phase: number;
  driftPhase: number;
  scale: number;
}

function makeKissHeartSeeds(count: number): KissHeartSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (Math.random() - 0.5) * 0.9,
    z: (Math.random() - 0.5) * 0.5,
    phase: (i / count) * HEART_LOOP_DURATION,
    driftPhase: Math.random() * Math.PI * 2,
    scale: 0.16 + Math.random() * 0.08,
  }));
}

function KissHearts({
  activeRef,
  reducedMotion,
}: {
  activeRef: RefObject<number>;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeKissHeartSeeds(HEART_COUNT), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const active = activeRef.current;
    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      let y = HEART_BASE_Y;
      let x = seed.x;
      let bump = 1;
      if (!reducedMotion) {
        const loopT =
          ((t + seed.phase) % HEART_LOOP_DURATION) / HEART_LOOP_DURATION;
        y = HEART_BASE_Y + loopT * HEART_RISE_HEIGHT;
        x = seed.x + Math.sin(loopT * Math.PI * 2 + seed.driftPhase) * 0.12;
        bump = Math.sin(loopT * Math.PI);
      }
      // Silhouette bleibt frontal lesbar: kein freies Taumeln, nur ein
      // leichtes Y-Wobble (±0.4·sin) um die aufrechte Grundhaltung.
      const wobbleY = Math.sin(t * 1.1 + seed.driftPhase) * 0.4;
      dummy.position.set(x, y, seed.z);
      dummy.rotation.set(0, wobbleY, 0);
      dummy.scale.setScalar(seed.scale * bump * active);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[getHeartGeometry(), undefined, HEART_COUNT]}
    >
      <meshStandardMaterial color="#e07186" roughness={0.4} />
    </instancedMesh>
  );
}

/**
 * Der EINE große Kuss-Herz-Pop am geometrisch hergeleiteten Kontaktpunkt der
 * Schnabelspitzen (siehe MEET_X/KISS_CONTACT_* oben) — poppt mit Overshoot
 * auf, sobald `activeRef` (Kuss-Kontakt) aktiv wird, und behält danach ein
 * leises Twinkle-Wackeln.
 */
function ContactHeart({ activeRef }: { activeRef: RefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const heartGeometry = useMemo(() => getHeartGeometry(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const amount = Math.max(easeOutBack(activeRef.current), 0);
    mesh.scale.setScalar(CONTACT_HEART_SCALE * amount);
    // Kein freies Taumeln — nur ein leichtes Y-Wobble, damit die
    // Herz-Silhouette der Kamera frontal zugewandt bleibt.
    mesh.rotation.y =
      Math.sin(state.clock.elapsedTime * 1.5) * 0.4 * activeRef.current;
  });

  return (
    <mesh
      ref={meshRef}
      position={[KISS_CONTACT_X, KISS_CONTACT_Y, KISS_CONTACT_Z]}
      geometry={heartGeometry}
    >
      <meshStandardMaterial color="#e07186" roughness={0.3} metalness={0.25} />
    </mesh>
  );
}

export const PenguinsScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const waddle1Ref = useRef<THREE.Group>(null);
  const waddle2Ref = useRef<THREE.Group>(null);
  const lean1Ref = useRef<THREE.Group>(null);
  const lean2Ref = useRef<THREE.Group>(null);
  const activeRef = useRef(0);
  /** Ambiente Herz-Loop-Intensität — anders als `activeRef` (Kuss-Kontakt für
   *  Augen/ContactHeart) bereits >0, sobald die Section sichtbar/zentriert
   *  ist, und steigt mit `progress` bis zum Kuss auf ihr Maximum. */
  const heartIntensityRef = useRef(0);

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);
    const walkT = reducedMotion
      ? 1
      : THREE.MathUtils.clamp(progress / WALK_SPAN, 0, 1);
    const leanT = THREE.MathUtils.clamp(
      (progress - LEAN_START) / LEAN_SPAN,
      0,
      1,
    );
    const t = state.clock.elapsedTime;

    const x1 = THREE.MathUtils.lerp(-START_X, -MEET_X, walkT);
    const x2 = THREE.MathUtils.lerp(START_X, MEET_X, walkT);
    const rockAmplitude = reducedMotion ? 0 : 0.12 * (1 - walkT);

    const waddle1 = waddle1Ref.current;
    if (waddle1) {
      waddle1.position.x = THREE.MathUtils.damp(
        waddle1.position.x,
        x1,
        5,
        delta,
      );
      waddle1.rotation.z = Math.sin(t * 6.5) * rockAmplitude;
    }
    const waddle2 = waddle2Ref.current;
    if (waddle2) {
      waddle2.position.x = THREE.MathUtils.damp(
        waddle2.position.x,
        x2,
        5,
        delta,
      );
      waddle2.rotation.z = Math.sin(t * 6.5 + Math.PI) * rockAmplitude;
    }

    const lean1 = lean1Ref.current;
    if (lean1) {
      lean1.rotation.z = THREE.MathUtils.damp(
        lean1.rotation.z,
        -leanT * LEAN_ANGLE,
        5,
        delta,
      );
    }
    const lean2 = lean2Ref.current;
    if (lean2) {
      lean2.rotation.z = THREE.MathUtils.damp(
        lean2.rotation.z,
        leanT * LEAN_ANGLE,
        5,
        delta,
      );
    }

    activeRef.current = THREE.MathUtils.damp(
      activeRef.current,
      progress > KISS_THRESHOLD ? 1 : 0,
      4,
      delta,
    );

    // Herzen: sobald die Section sichtbar/zentriert ist (vis), steigt die
    // Intensität mit dem Fortschritt bis zum Kuss-Schwellwert auf ihr Maximum.
    const heartProgressFactor = THREE.MathUtils.clamp(
      progress / KISS_THRESHOLD,
      0,
      1,
    );
    const heartTarget =
      vis * THREE.MathUtils.lerp(HEART_BASE_INTENSITY, 1, heartProgressFactor);
    heartIntensityRef.current = THREE.MathUtils.damp(
      heartIntensityRef.current,
      heartTarget,
      3,
      delta,
    );
  });

  return (
    <group ref={rootRef} position={[0, -0.95, 0]}>
      <IceFloe />

      {/* Leichter Yaw-Versatz dreht die Gesichter etwas zur Kamera, statt reinem Profil */}
      <group
        ref={waddle1Ref}
        position={[-START_X, -0.7, 0]}
        rotation={[0, -0.32, 0]}
      >
        <group ref={lean1Ref}>
          <PenguinBody facing={1} colors={DARK_PENGUIN} activeRef={activeRef} />
        </group>
      </group>

      <group
        ref={waddle2Ref}
        position={[START_X, -0.7, 0]}
        rotation={[0, 0.32, 0]}
      >
        <group ref={lean2Ref}>
          <PenguinBody
            facing={-1}
            colors={PINK_PENGUIN}
            activeRef={activeRef}
          />
        </group>
      </group>

      <ContactHeart activeRef={activeRef} />
      <KissHearts activeRef={heartIntensityRef} reducedMotion={reducedMotion} />
    </group>
  );
};

export const PenguinsHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 4</span>
    <h2 className="exp-title">Du &amp; ich</h2>
    <p className="exp-subtitle">Der schwarze bin ich. Der rosa bist du.</p>
  </div>
);
