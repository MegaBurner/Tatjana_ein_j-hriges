import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import type { SectionProps } from "../types";

// sectionVisibility's bell curve peaks at progress 0 and hard-cuts to
// invisible by local progress ≈0.75, so the kiss + heart burst must land
// well before that so the payoff is actually seen.
const WALK_SPAN = 0.35;
const LEAN_START = 0.35;
const LEAN_SPAN = 0.2;
const KISS_THRESHOLD = 0.5;
const START_X = 1.75;
const MEET_X = 0.68;
const LEAN_ANGLE = 0.28;

const HEART_COUNT = 12;
const HEART_LOOP_DURATION = 2.2;
const HEART_RISE_HEIGHT = 1.1;
const HEART_BASE_Y = 0.75;

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
      {[0.15, -0.15].map((z) => (
        <mesh key={z} position={[facing * 0.25, 0.93, z]}>
          <circleGeometry args={[0.045, 12]} />
          <meshStandardMaterial
            color={color}
            roughness={0.7}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/** Großes, ausdrucksstarkes Auge: weiße Sklera + schwarze Pupille + winziges Glanzlicht. */
function Eye({ facing, z }: { facing: 1 | -1; z: number }) {
  return (
    <group position={[facing * 0.32, 1.03, z]}>
      <mesh>
        <sphereGeometry args={[0.05, 10, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[facing * 0.018, 0, 0]}>
        <sphereGeometry args={[0.032, 8, 8]} />
        <meshStandardMaterial color="#14100f" />
      </mesh>
      <mesh position={[facing * 0.03, 0.015, 0.015]}>
        <sphereGeometry args={[0.011, 6, 6]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

/** Prozedural gebauter Pinguin. `facing` = +1 (blickt nach +X) oder -1 (blickt nach -X). */
function PenguinBody({
  facing,
  colors,
}: {
  facing: 1 | -1;
  colors: PenguinColors;
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

      {/* Kopf — überlappt bewusst mit dem oberen Körper für einen nahtlosen Übergang */}
      <mesh position={[0, 0.98, 0]} scale={[0.38, 0.36, 0.38]}>
        <sphereGeometry args={[0.5, SPHERE_SEGMENTS, SPHERE_RINGS]} />
        <meshStandardMaterial color={colors.body} roughness={0.5} />
      </mesh>
      {/* Gesichtsfleck */}
      <mesh position={[facing * 0.21, 0.99, 0]} scale={[0.23, 0.21, 0.18]}>
        <sphereGeometry args={[0.5, 14, 12]} />
        <meshStandardMaterial color={colors.face} roughness={0.6} />
      </mesh>

      <BlushCheeks facing={facing} color={colors.blush} />
      <Eye facing={facing} z={0.11} />
      <Eye facing={facing} z={-0.11} />

      {/* Schnabel — kleiner & niedlicher als zuvor */}
      <mesh
        position={[facing * 0.36, 0.97, 0]}
        rotation={[0, 0, (facing * -Math.PI) / 2]}
      >
        <coneGeometry args={[0.042, 0.12, 10]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.4} />
      </mesh>

      {colors.hasChestHeart && (
        <mesh
          position={[facing * 0.24, 0.56, 0.27]}
          rotation={[0, 0, Math.PI / 4]}
          scale={0.045}
        >
          <octahedronGeometry args={[1, 0]} />
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
    scale: 0.05 + Math.random() * 0.04,
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
      dummy.position.set(x, y, seed.z);
      dummy.rotation.set(0, t * 0.5 + seed.driftPhase, Math.PI / 4);
      dummy.scale.setScalar(seed.scale * bump * active);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, HEART_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#f4a5ae" roughness={0.4} />
    </instancedMesh>
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
  });

  return (
    <group ref={rootRef} position={[0, -0.75, 0]}>
      <IceFloe />

      {/* Leichter Yaw-Versatz dreht die Gesichter etwas zur Kamera, statt reinem Profil */}
      <group
        ref={waddle1Ref}
        position={[-START_X, -0.7, 0]}
        rotation={[0, -0.32, 0]}
      >
        <group ref={lean1Ref}>
          <PenguinBody facing={1} colors={DARK_PENGUIN} />
        </group>
      </group>

      <group
        ref={waddle2Ref}
        position={[START_X, -0.7, 0]}
        rotation={[0, 0.32, 0]}
      >
        <group ref={lean2Ref}>
          <PenguinBody facing={-1} colors={PINK_PENGUIN} />
        </group>
      </group>

      <KissHearts activeRef={activeRef} reducedMotion={reducedMotion} />
    </group>
  );
};

export const PenguinsHtml = () => (
  <div className="exp-content" style={{ paddingTop: "10vh" }}>
    <span className="exp-kicker">Kapitel 4</span>
    <h2 className="exp-title">Du &amp; ich</h2>
    <p className="exp-subtitle">Zwei Pinguine, ein Kuss — für immer.</p>
  </div>
);
