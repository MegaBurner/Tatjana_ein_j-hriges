import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { getHeartGeometry } from "../heartGeometry";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import type { SectionProps } from "../types";

type ScrollState = ReturnType<typeof useScroll>;

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
const STAMEN_COUNT = 26;
const ORBIT_PETAL_COUNT = 8;
const SPARKLE_COUNT = 14;

// --- Tap-Interaktion: Klick irgendwo → Herz-Konfetti am Klickpunkt ----------
/** Pointer-Bewegung (px), bis zu der ein Klick als Tap gilt — gleiches
 *  Kriterium wie die Tap/Drag-Unterscheidung beim Globus, damit
 *  Scroll-/Drag-Gesten kein Konfetti auslösen. */
const TAP_MAX_MOVEMENT_PX = 8;
/** Ab dieser Sichtbarkeit nimmt die Szene Taps an (kein Klicken "im Vorbeiscrollen"). */
const TAP_VISIBILITY_THRESHOLD = 0.3;
/** Unsichtbare Fänger-Ebene für Taps überall in der Szene (lokale Einheiten,
 *  die Wurzelgruppe skaliert auf ~0.6–0.85 — deckt so den ganzen Viewport). */
const TAP_PLANE_WIDTH = 18;
const TAP_PLANE_HEIGHT = 12;
/** Liegt vor Blüte/Orbit-Partikeln, damit die Herzen vorne aufpoppen. */
const TAP_PLANE_Z = 1.0;
/** Deckel: maximal so viele Bursts gleichzeitig — der älteste fällt raus. */
const HEART_BURST_MAX_ACTIVE = 3;
/** Herzen pro Burst (instanced, geteilte Geometrie aus heartGeometry.ts). */
const HEART_BURST_COUNT = 18;
const HEART_BURST_DURATION_SECONDS = 1.6;
/** Aufpopp-Dauer (s) zu Burst-Beginn (Scale 0 → voll). */
const HEART_BURST_POP_SECONDS = 0.12;
/** Abwärtsbeschleunigung der Konfetti-Herzen (lokale Einheiten/s²). */
const HEART_BURST_GRAVITY = -2.4;
/** Horizontale Startgeschwindigkeit: min + zufälliger Anteil. */
const HEART_BURST_SPEED_MIN = 0.8;
const HEART_BURST_SPEED_VARIANCE = 0.9;
/** Aufwärts-Anteil der Startgeschwindigkeit — Konfetti-Bogen nach oben. */
const HEART_BURST_UP_MIN = 1.2;
const HEART_BURST_UP_VARIANCE = 1.6;
/** Tiefen-Streuung flacher als die horizontale (Szene steht frontal). */
const HEART_BURST_DEPTH_FACTOR = 0.35;
const HEART_BURST_SCALE_MIN = 0.13;
const HEART_BURST_SCALE_VARIANCE = 0.09;
/** Nur Y-Wobble statt freiem Taumeln — Herz-Silhouette bleibt frontal lesbar
 *  (gleiche Regel wie KissHearts in PenguinsSection). */
const HEART_BURST_WOBBLE_SPEED = 2.2;
const HEART_BURST_WOBBLE_AMPLITUDE = 0.45;
/** Kleine feste Z-Schräglage pro Herz für den Konfetti-Look. */
const HEART_BURST_TILT_MAX = 0.35;
const HEART_BURST_COLORS = ["#e07186", "#e8c77d", "#c4b5e4"] as const;

interface RingConfig {
  count: number;
  fullRadius: number;
  closedRadius: number;
  petalSize: number;
  color: string;
  zOffset: number;
  openStart: number;
  openSpan: number;
}

const RINGS: RingConfig[] = [
  {
    count: 6,
    fullRadius: 0.42,
    closedRadius: 0.06,
    petalSize: 0.3,
    color: "#e07186",
    zOffset: 0.16,
    openStart: 0,
    openSpan: 0.5,
  },
  {
    count: 8,
    fullRadius: 0.68,
    closedRadius: 0.08,
    petalSize: 0.36,
    color: "#f4a5ae",
    zOffset: 0,
    openStart: 0.08,
    openSpan: 0.5,
  },
  {
    count: 10,
    fullRadius: 0.92,
    closedRadius: 0.1,
    petalSize: 0.4,
    color: "#f8c8ce",
    zOffset: -0.16,
    openStart: 0.16,
    openSpan: 0.5,
  },
];

interface PetalConfig extends RingConfig {
  angle: number;
}

function makePetalConfigs(): PetalConfig[] {
  const configs: PetalConfig[] = [];
  RINGS.forEach((ring) => {
    for (let i = 0; i < ring.count; i++) {
      const angle = (i / ring.count) * Math.PI * 2 + ring.zOffset * 0.4;
      configs.push({ ...ring, angle });
    }
  });
  return configs;
}

function Petal({
  config,
  scroll,
  index,
}: {
  config: PetalConfig;
  scroll: ScrollState;
  index: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const {
    angle,
    fullRadius,
    closedRadius,
    petalSize,
    color,
    zOffset,
    openStart,
    openSpan,
  } = config;

  useFrame((_, delta) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const progress = sectionProgress(scroll, index);
    const t = THREE.MathUtils.clamp((progress - openStart) / openSpan, 0, 1);
    const radius = THREE.MathUtils.lerp(closedRadius, fullRadius, t);
    const scale = THREE.MathUtils.lerp(0.3, 1, t);
    const fold = THREE.MathUtils.lerp(1.1, 0, t);

    const targetX = Math.cos(angle) * radius;
    const targetY = Math.sin(angle) * radius;
    group.position.x = THREE.MathUtils.damp(
      group.position.x,
      targetX,
      5,
      delta,
    );
    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      targetY,
      5,
      delta,
    );
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, scale, 5, delta));
    mesh.rotation.x = THREE.MathUtils.damp(mesh.rotation.x, fold, 5, delta);
  });

  return (
    <group ref={groupRef} position={[0, 0, zOffset]} rotation={[0, 0, angle]}>
      <mesh ref={meshRef} scale={[1.8, 1, 0.4]}>
        <sphereGeometry args={[petalSize, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.42} />
      </mesh>
    </group>
  );
}

interface StamenSeed {
  x: number;
  y: number;
  z: number;
  scale: number;
}

function makeStamenSeeds(count: number): StamenSeed[] {
  return Array.from({ length: count }, () => {
    const r = Math.random() * 0.14;
    const theta = Math.random() * Math.PI * 2;
    return {
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      z: 0.2 + Math.random() * 0.06,
      scale: 0.035 + Math.random() * 0.02,
    };
  });
}

function Stamen({ scroll, index }: { scroll: ScrollState; index: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeStamenSeeds(STAMEN_COUNT), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const progress = sectionProgress(scroll, index);
    const t = THREE.MathUtils.clamp(progress / 0.35, 0, 1);

    // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.scale.setScalar(seed.scale * t);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, STAMEN_COUNT]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial color="#e8c77d" roughness={0.35} metalness={0.3} />
    </instancedMesh>
  );
}

interface OrbitSeed {
  radius: number;
  speed: number;
  phase: number;
  heightAmp: number;
  heightPhase: number;
  scale: number;
}

function makeOrbitSeeds(
  count: number,
  baseRadius: number,
  radiusVariance: number,
): OrbitSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    radius: baseRadius + Math.random() * radiusVariance,
    speed: 0.22 + Math.random() * 0.14,
    phase: (i / count) * Math.PI * 2,
    heightAmp: 0.25 + Math.random() * 0.3,
    heightPhase: Math.random() * Math.PI * 2,
    scale: 0.05 + Math.random() * 0.04,
  }));
}

function OrbitPetals({
  reducedMotion,
  scroll,
  index,
}: {
  reducedMotion: boolean;
  scroll: ScrollState;
  index: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeOrbitSeeds(ORBIT_PETAL_COUNT, 1.3, 0.35), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const angle = seed.phase + t * seed.speed;
      const height = reducedMotion
        ? 0
        : Math.sin(t * 0.4 + seed.heightPhase) * seed.heightAmp;
      dummy.position.set(
        Math.cos(angle) * seed.radius,
        height,
        Math.sin(angle) * seed.radius * 0.5,
      );
      dummy.rotation.set(0, angle, Math.PI / 3);
      dummy.scale.set(seed.scale * 1.8, seed.scale, seed.scale * 0.4);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, ORBIT_PETAL_COUNT]}
    >
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial
        color="#f4a5ae"
        roughness={0.45}
        transparent
        opacity={0.85}
      />
    </instancedMesh>
  );
}

function Sparkles({
  reducedMotion,
  scroll,
  index,
}: {
  reducedMotion: boolean;
  scroll: ScrollState;
  index: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeOrbitSeeds(SPARKLE_COUNT, 1.0, 0.7), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const angle = seed.phase - t * seed.speed * 1.4;
      const height = reducedMotion
        ? 0
        : Math.sin(t * 0.6 + seed.heightPhase) * seed.heightAmp;
      const twinkle = reducedMotion
        ? 1
        : 0.6 + Math.sin(t * 3 + seed.heightPhase) * 0.4;
      dummy.position.set(
        Math.cos(angle) * seed.radius,
        height,
        Math.sin(angle) * seed.radius * 0.5,
      );
      dummy.rotation.set(t * 0.8, angle, 0);
      dummy.scale.setScalar(seed.scale * twinkle);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, SPARKLE_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#e8c77d" roughness={0.3} metalness={0.6} />
    </instancedMesh>
  );
}

interface HeartSeed {
  velocity: THREE.Vector3;
  size: number;
  wobblePhase: number;
  tilt: number;
}

/** Ein aktiver Herz-Konfetti-Burst: Klickpunkt + Start-Zeitpunkt + Partikel-Seeds. */
interface HeartBurst {
  origin: THREE.Vector3;
  startTime: number;
  seeds: readonly HeartSeed[];
}

/** true, sobald mindestens ein Burst abgelaufen ist — benannte Modul-Funktion
 *  statt Inline-Closure, damit der Frame-Loop allokationsfrei bleibt. */
function hasExpiredHeartBurst(
  bursts: readonly HeartBurst[],
  now: number,
): boolean {
  for (let i = 0; i < bursts.length; i++) {
    if (now - bursts[i].startTime >= HEART_BURST_DURATION_SECONDS) return true;
  }
  return false;
}

function makeHeartBurst(origin: THREE.Vector3, startTime: number): HeartBurst {
  const seeds = Array.from({ length: HEART_BURST_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed =
      HEART_BURST_SPEED_MIN + Math.random() * HEART_BURST_SPEED_VARIANCE;
    return {
      velocity: new THREE.Vector3(
        Math.cos(angle) * speed,
        HEART_BURST_UP_MIN + Math.random() * HEART_BURST_UP_VARIANCE,
        Math.sin(angle) * speed * HEART_BURST_DEPTH_FACTOR,
      ),
      size: HEART_BURST_SCALE_MIN + Math.random() * HEART_BURST_SCALE_VARIANCE,
      wobblePhase: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 2 * HEART_BURST_TILT_MAX,
    };
  });
  return { origin: origin.clone(), startTime, seeds };
}

/**
 * Schreibt die Matrizen aller Burst-Slots (ballistische Bahn: Startimpuls +
 * Gravitation; Aufpoppen über HEART_BURST_POP_SECONDS, Ausblenden über Scale).
 * Leere Slots kollabieren auf Scale 0.
 */
function writeHeartBurstMatrices(
  mesh: THREE.InstancedMesh,
  bursts: readonly HeartBurst[],
  now: number,
  dummy: THREE.Object3D,
): void {
  for (let slot = 0; slot < HEART_BURST_MAX_ACTIVE; slot++) {
    const burst = bursts[slot];
    for (let p = 0; p < HEART_BURST_COUNT; p++) {
      const idx = slot * HEART_BURST_COUNT + p;
      if (!burst) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0);
      } else {
        const seed = burst.seeds[p];
        const age = now - burst.startTime;
        const lifeT = THREE.MathUtils.clamp(
          age / HEART_BURST_DURATION_SECONDS,
          0,
          1,
        );
        const pop = Math.min(age / HEART_BURST_POP_SECONDS, 1);
        dummy.position.set(
          burst.origin.x + seed.velocity.x * age,
          burst.origin.y +
            seed.velocity.y * age +
            0.5 * HEART_BURST_GRAVITY * age * age,
          burst.origin.z + seed.velocity.z * age,
        );
        dummy.rotation.set(
          0,
          Math.sin(now * HEART_BURST_WOBBLE_SPEED + seed.wobblePhase) *
            HEART_BURST_WOBBLE_AMPLITUDE,
          seed.tilt,
        );
        dummy.scale.setScalar(seed.size * pop * (1 - lifeT));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export const FinaleScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const petalConfigs = useMemo(() => makePetalConfigs(), []);

  // --- Tap → Herz-Konfetti ---------------------------------------------------
  const burstMeshRef = useRef<THREE.InstancedMesh>(null);
  const burstsRef = useRef<readonly HeartBurst[]>([]);
  /** true = Burst-Matrizen müssen (noch) geschrieben werden. Startet true,
   *  damit die Identity-Matrizen des frischen InstancedMesh im ersten Frame
   *  auf Scale 0 kollabiert werden. */
  const burstWritePendingRef = useRef(true);
  /** Letzte bekannte clock-Zeit — der Klick-Handler läuft außerhalb von useFrame. */
  const elapsedRef = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Instanz-Farben einmalig setzen: Rosé/Gold/Lila im Wechsel (Material bleibt weiß).
  useEffect(() => {
    const mesh = burstMeshRef.current;
    if (!mesh) return;
    const color = new THREE.Color();
    const total = HEART_BURST_MAX_ACTIVE * HEART_BURST_COUNT;
    for (let i = 0; i < total; i++) {
      mesh.setColorAt(
        i,
        color.set(HEART_BURST_COLORS[i % HEART_BURST_COLORS.length]),
      );
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  const handleSceneTap = (event: ThreeEvent<MouseEvent>) => {
    // `event.delta` = Pixel-Distanz zwischen pointerdown und diesem Klick —
    // nur echte Taps werten, keine Scroll-/Drag-Gesten über der Szene.
    if (event.delta > TAP_MAX_MOVEMENT_PX) return;
    if (sectionVisibility(scroll, index) < TAP_VISIBILITY_THRESHOLD) return;
    const root = rootRef.current;
    if (!root) return;
    // Klickpunkt aus Welt- in lokale Gruppen-Koordinaten wandeln — die
    // Wurzelgruppe ist verschoben und skaliert, das Burst-Mesh lebt darin.
    const origin = root.worldToLocal(event.point.clone());
    const bursts = [
      ...burstsRef.current,
      makeHeartBurst(origin, elapsedRef.current),
    ];
    // Deckel: nur die jüngsten HEART_BURST_MAX_ACTIVE Bursts behalten (immutable).
    burstsRef.current = bursts.slice(-HEART_BURST_MAX_ACTIVE);
    burstWritePendingRef.current = true;
  };

  const handlePointerOver = () => {
    if (sectionVisibility(scroll, index) >= TAP_VISIBILITY_THRESHOLD) {
      document.body.style.cursor = "pointer";
    }
  };
  const handlePointerOut = () => {
    document.body.style.cursor = "";
  };

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);
    const targetScale = 0.62 + progress * 0.22;
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta),
    );

    // --- Herz-Konfetti-Bursts (Tap-Reaktion) --------------------------------
    elapsedRef.current = state.clock.elapsedTime;
    const burstMesh = burstMeshRef.current;
    if (burstMesh) {
      const now = state.clock.elapsedTime;
      // hasExpiredHeartBurst statt Inline-`some`-Closure: der Check läuft
      // jeden Frame, das (Closure-allokierende) filter nur im Ablauf-Fall.
      if (hasExpiredHeartBurst(burstsRef.current, now)) {
        burstsRef.current = burstsRef.current.filter(
          (burst) => now - burst.startTime < HEART_BURST_DURATION_SECONDS,
        );
      }
      if (burstsRef.current.length > 0 || burstWritePendingRef.current) {
        writeHeartBurstMatrices(burstMesh, burstsRef.current, now, dummy);
        // Nach dem Verklingen aller Bursts genau einmal auf Scale 0 schreiben.
        burstWritePendingRef.current = burstsRef.current.length > 0;
      }
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.95, 0.2]}>
      {petalConfigs.map((config, i) => (
        <Petal key={i} config={config} scroll={scroll} index={index} />
      ))}
      <Stamen scroll={scroll} index={index} />
      <OrbitPetals
        reducedMotion={reducedMotion}
        scroll={scroll}
        index={index}
      />
      <Sparkles reducedMotion={reducedMotion} scroll={scroll} index={index} />
      {/* Unsichtbare Fänger-Ebene: macht die ganze Szene zur Tap-Fläche.
          Material ist unsichtbar, Raycasts treffen die Ebene trotzdem. */}
      <mesh
        position={[0, 0, TAP_PLANE_Z]}
        onClick={handleSceneTap}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[TAP_PLANE_WIDTH, TAP_PLANE_HEIGHT]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <instancedMesh
        ref={burstMeshRef}
        args={[
          getHeartGeometry(),
          undefined,
          HEART_BURST_MAX_ACTIVE * HEART_BURST_COUNT,
        ]}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.35} metalness={0.15} />
      </instancedMesh>
    </group>
  );
};

export const FinaleHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Für immer</span>
    <h2 className="exp-title">
      Volim te{" "}
      <span style={{ color: "var(--accent-rose-deep)", fontStyle: "normal" }}>
        ♥
      </span>
    </h2>
    <p className="exp-subtitle">
      Das war erst das erste Jahr. Ich will alle weiteren mit dir.
    </p>
    <p className="exp-subtitle" style={{ opacity: 0.6 }}>
      dein Melihcan
    </p>
  </div>
);
