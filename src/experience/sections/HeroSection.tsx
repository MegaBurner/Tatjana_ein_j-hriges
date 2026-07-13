import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import type { SectionProps } from "../types";

const FLOWER_COUNT = 16;
const FLOWER_X_SPREAD = 3.3;
const STEM_LENGTH = 0.7;
const STEM_COLOR = "#7fa06f";
const CENTER_COLOR = "#e8c77d";
const CENTER_RADIUS = 0.05;
/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;

interface FlowerSeed {
  x: number;
  y: number;
  z: number;
  scale: number;
  swayPhase: number;
  swaySpeed: number;
  delay: number;
  /** Kleine Rotations-Streuung je Blütenblatt-Ring, für ein weniger perfekt-symmetrisches Aussehen. */
  ringJitter: [number, number, number];
}

/** Lose Bogen-Anordnung von Pfingstrosen in der unteren Bildhälfte. */
function makeFlowerSeeds(count: number): FlowerSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x =
      THREE.MathUtils.lerp(-FLOWER_X_SPREAD, FLOWER_X_SPREAD, t) +
      (Math.random() - 0.5) * 0.4;
    const arc = Math.sin(t * Math.PI) * 0.55;
    const y = -1.95 + arc + (Math.random() - 0.5) * 0.3;
    const z = (Math.random() - 0.5) * 0.9;
    return {
      x,
      y,
      z,
      scale: 0.85 + Math.random() * 0.45,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.5 + Math.random() * 0.4,
      delay: t * 0.9 + Math.random() * 0.2,
      ringJitter: [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ],
    };
  });
}

interface PeonyLayer {
  petalCount: number;
  length: number;
  /** Breite an der Ansatzstelle (schmal, wie ein echter Blütenblatt-"Nagel"). */
  baseWidth: number;
  /** Breite an der abgerundeten Spitze — bewusst breit für dichte Überlappung. */
  tipWidth: number;
  /** Konkavität der Blattfläche (Wölbung Richtung Betrachter). */
  curve: number;
  /** Kippwinkel Richtung Kamera — je größer, desto "geschlossener/gewölbter". */
  lift: number;
  color: string;
  /** Tiefen-Versatz zur Stapelung der Ringe (innen näher an der Kamera). */
  hub: number;
}

/**
 * Drei Blütenblatt-Ringe einer Pfingstrose: außen groß & hell, Mitte
 * mittelgroß, innen tief & am stärksten gewölbt (kelchartig) + Goldzentrum.
 * tipWidth ist bewusst nahe an length gewählt, damit sich benachbarte Blätter
 * eines Rings sichtbar überlappen (dichte, gefüllte Blüte statt Stern/Pinwheel
 * mit Lücken). Ziel 1 (Performance-Plan): ALLE Blätter aller 16 Blumen über
 * nur 5 InstancedMeshes (3 Ringe + Stängel + Zentrum), statt 120+ Einzel-Meshes.
 */
const PEONY_LAYERS: readonly PeonyLayer[] = [
  {
    petalCount: 8,
    length: 0.24,
    baseWidth: 0.05,
    tipWidth: 0.22,
    curve: 0.06,
    lift: 0.16,
    color: "#f8c8ce",
    hub: -0.01,
  },
  {
    petalCount: 7,
    length: 0.18,
    baseWidth: 0.045,
    tipWidth: 0.165,
    curve: 0.1,
    lift: 0.42,
    color: "#f4a5ae",
    hub: 0.007,
  },
  {
    petalCount: 6,
    length: 0.12,
    baseWidth: 0.035,
    tipWidth: 0.125,
    curve: 0.19,
    lift: 0.85,
    color: "#e07186",
    hub: 0.024,
  },
];

/**
 * Blütenblatt-Silhouette mit abgerundeter (nicht spitzer) Blattspitze: Basis
 * bei x=0 schmal wie ein Blattnagel, Spitze bei x=length breit und rund —
 * echte Pfingstrosen-Blätter sind rundlich-ruffled, nicht spitz/sternförmig.
 */
function makePetalGeometry(
  length: number,
  baseWidth: number,
  tipWidth: number,
  curve: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -baseWidth / 2);
  shape.bezierCurveTo(
    length * 0.32,
    -tipWidth * 0.52,
    length * 0.7,
    -tipWidth * 0.5,
    length * 0.92,
    -tipWidth * 0.28,
  );
  shape.quadraticCurveTo(length, -tipWidth * 0.12, length, 0);
  shape.quadraticCurveTo(
    length,
    tipWidth * 0.12,
    length * 0.92,
    tipWidth * 0.28,
  );
  shape.bezierCurveTo(
    length * 0.7,
    tipWidth * 0.5,
    length * 0.32,
    tipWidth * 0.52,
    0,
    baseWidth / 2,
  );
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 8);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const t = THREE.MathUtils.clamp(x / length, 0, 1);
    position.setZ(i, Math.sin(t * Math.PI * 0.5) * curve);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Vorab berechnete Ring-Winkel je Blütenblatt-Instanz (einmalig, keine Neuberechnung im Frame-Loop). */
function makePetalAngles(
  flowers: FlowerSeed[],
  layerIndex: number,
  petalCount: number,
): Float32Array {
  const angles = new Float32Array(flowers.length * petalCount);
  flowers.forEach((flower, fi) => {
    const jitter = flower.ringJitter[layerIndex];
    for (let p = 0; p < petalCount; p++) {
      angles[fi * petalCount + p] = (p / petalCount) * Math.PI * 2 + jitter;
    }
  });
  return angles;
}

/** Schreibt die Matrizen eines Blütenblatt-Rings (allokationsfrei über den geteilten `dummy`). */
function writePetalLayer(
  mesh: THREE.InstancedMesh,
  layer: PeonyLayer,
  angles: Float32Array,
  flowers: FlowerSeed[],
  bloom: Float32Array,
  sway: Float32Array,
  dummy: THREE.Object3D,
): void {
  flowers.forEach((flower, fi) => {
    const flowerScale = flower.scale * bloom[fi];
    const swayAngle = sway[fi];
    for (let p = 0; p < layer.petalCount; p++) {
      const idx = fi * layer.petalCount + p;
      dummy.position.set(
        flower.x,
        flower.y,
        flower.z + layer.hub * flowerScale,
      );
      dummy.rotation.set(0, layer.lift, angles[idx] + swayAngle);
      dummy.scale.setScalar(flowerScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Rendert ALLE 16 Pfingstrosen (Stängel, Zentren, 3 Blütenblatt-Ringe) über
 * genau 5 InstancedMeshes. Bloom-in-Stagger und Wind-Sway werden pro Blume
 * einmal berechnet (bloom/sway-Arrays) und für Stängel+Zentrum+alle Blätter
 * dieser Blume wiederverwendet — kein Objekt wird pro Frame neu allokiert.
 */
function PeonyField({
  flowers,
  index,
}: {
  flowers: FlowerSeed[];
  index: number;
}) {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const bloomRef = useRef(new Float32Array(flowers.length));
  const swayRef = useRef(new Float32Array(flowers.length));
  const mountTimeRef = useRef<number | null>(null);

  const stemMeshRef = useRef<THREE.InstancedMesh>(null);
  const centerMeshRef = useRef<THREE.InstancedMesh>(null);
  const outerMeshRef = useRef<THREE.InstancedMesh>(null);
  const middleMeshRef = useRef<THREE.InstancedMesh>(null);
  const innerMeshRef = useRef<THREE.InstancedMesh>(null);

  const outerGeometry = useMemo(
    () =>
      makePetalGeometry(
        PEONY_LAYERS[0].length,
        PEONY_LAYERS[0].baseWidth,
        PEONY_LAYERS[0].tipWidth,
        PEONY_LAYERS[0].curve,
      ),
    [],
  );
  const middleGeometry = useMemo(
    () =>
      makePetalGeometry(
        PEONY_LAYERS[1].length,
        PEONY_LAYERS[1].baseWidth,
        PEONY_LAYERS[1].tipWidth,
        PEONY_LAYERS[1].curve,
      ),
    [],
  );
  const innerGeometry = useMemo(
    () =>
      makePetalGeometry(
        PEONY_LAYERS[2].length,
        PEONY_LAYERS[2].baseWidth,
        PEONY_LAYERS[2].tipWidth,
        PEONY_LAYERS[2].curve,
      ),
    [],
  );

  useEffect(() => {
    return () => {
      outerGeometry.dispose();
      middleGeometry.dispose();
      innerGeometry.dispose();
    };
  }, [outerGeometry, middleGeometry, innerGeometry]);

  const outerAngles = useMemo(
    () => makePetalAngles(flowers, 0, PEONY_LAYERS[0].petalCount),
    [flowers],
  );
  const middleAngles = useMemo(
    () => makePetalAngles(flowers, 1, PEONY_LAYERS[1].petalCount),
    [flowers],
  );
  const innerAngles = useMemo(
    () => makePetalAngles(flowers, 2, PEONY_LAYERS[2].petalCount),
    [flowers],
  );

  useFrame((state, delta) => {
    // Weit außerhalb des Viewports: eine einzelne Trig-Berechnung ersetzt die
    // komplette Matrix-Arbeit für alle ~370 Instanzen (Performance-Plan Ziel 2).
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;

    const stemMesh = stemMeshRef.current;
    const centerMesh = centerMeshRef.current;
    const outerMesh = outerMeshRef.current;
    const middleMesh = middleMeshRef.current;
    const innerMesh = innerMeshRef.current;
    if (!stemMesh || !centerMesh || !outerMesh || !middleMesh || !innerMesh)
      return;

    if (mountTimeRef.current === null)
      mountTimeRef.current = state.clock.elapsedTime;
    const mountElapsed = state.clock.elapsedTime - mountTimeRef.current;
    const swayIntensity = sectionProgress(scroll, index);
    const bloom = bloomRef.current;
    const sway = swayRef.current;

    flowers.forEach((flower, fi) => {
      const bloomTarget = mountElapsed > flower.delay ? 1 : 0;
      bloom[fi] = THREE.MathUtils.damp(bloom[fi], bloomTarget, 3.2, delta);
      const swayAmount = reducedMotion ? 0.008 : 0.04 + swayIntensity * 0.14;
      sway[fi] =
        Math.sin(
          state.clock.elapsedTime * flower.swaySpeed + flower.swayPhase,
        ) * swayAmount;

      const flowerScale = flower.scale * bloom[fi];
      const swayAngle = sway[fi];
      const halfStem = STEM_LENGTH * 0.5 * flowerScale;

      // Stängel: hängt lokal unterhalb des Blüten-Ursprungs, schwingt mit der Blüte
      dummy.position.set(
        flower.x + Math.sin(swayAngle) * halfStem,
        flower.y - Math.cos(swayAngle) * halfStem,
        flower.z,
      );
      dummy.rotation.set(0, 0, swayAngle);
      dummy.scale.setScalar(flowerScale);
      dummy.updateMatrix();
      stemMesh.setMatrixAt(fi, dummy.matrix);

      // Gold-Zentrum
      dummy.position.set(flower.x, flower.y, flower.z + 0.015 * flowerScale);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(flowerScale);
      dummy.updateMatrix();
      centerMesh.setMatrixAt(fi, dummy.matrix);
    });

    writePetalLayer(
      outerMesh,
      PEONY_LAYERS[0],
      outerAngles,
      flowers,
      bloom,
      sway,
      dummy,
    );
    writePetalLayer(
      middleMesh,
      PEONY_LAYERS[1],
      middleAngles,
      flowers,
      bloom,
      sway,
      dummy,
    );
    writePetalLayer(
      innerMesh,
      PEONY_LAYERS[2],
      innerAngles,
      flowers,
      bloom,
      sway,
      dummy,
    );

    stemMesh.instanceMatrix.needsUpdate = true;
    centerMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh
        ref={stemMeshRef}
        args={[undefined, undefined, flowers.length]}
      >
        <cylinderGeometry args={[0.014, 0.02, STEM_LENGTH, 6]} />
        <meshStandardMaterial color={STEM_COLOR} roughness={0.75} />
      </instancedMesh>
      <instancedMesh
        ref={centerMeshRef}
        args={[undefined, undefined, flowers.length]}
      >
        <sphereGeometry args={[CENTER_RADIUS, 10, 10]} />
        <meshStandardMaterial color={CENTER_COLOR} roughness={0.5} />
      </instancedMesh>
      <instancedMesh
        ref={outerMeshRef}
        args={[outerGeometry, undefined, outerAngles.length]}
      >
        <meshStandardMaterial
          color={PEONY_LAYERS[0].color}
          roughness={0.48}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={middleMeshRef}
        args={[middleGeometry, undefined, middleAngles.length]}
      >
        <meshStandardMaterial
          color={PEONY_LAYERS[1].color}
          roughness={0.45}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={innerMeshRef}
        args={[innerGeometry, undefined, innerAngles.length]}
      >
        <meshStandardMaterial
          color={PEONY_LAYERS[2].color}
          roughness={0.42}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </>
  );
}

interface PetalSeed {
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  scale: number;
  spin: number;
  phase: number;
}

function makePetalSeeds(count: number): PetalSeed[] {
  return Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 7,
    y: (Math.random() - 0.5) * 5.4,
    z: (Math.random() - 0.5) * 2.2,
    speed: 0.15 + Math.random() * 0.3,
    drift: (Math.random() - 0.5) * 0.12,
    scale: 0.5 + Math.random() * 0.6,
    spin: (Math.random() - 0.5) * 0.7,
    phase: Math.random() * Math.PI * 2,
  }));
}

/** Frei treibende Blütenblätter im Hintergrund — unabhängig von den Pfingstrosen selbst. */
function FloatingPetals({
  color,
  count,
  reducedMotion,
  index,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  index: number;
}) {
  const scroll = useScroll();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makePetalSeeds(count), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      if (!reducedMotion) {
        seed.y += seed.speed * delta;
        seed.x += seed.drift * delta;
        if (seed.y > 2.8) {
          seed.y = -2.8;
          seed.x = (Math.random() - 0.5) * 7;
        }
      }
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.rotation.set(
        0.3,
        reducedMotion ? seed.phase : seed.phase + t * seed.spin,
        0.6,
      );
      dummy.scale.set(seed.scale * 0.16, seed.scale * 0.06, seed.scale * 0.1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color={color} roughness={0.55} />
    </instancedMesh>
  );
}

export const HeroScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const flowers = useMemo(() => makeFlowerSeeds(FLOWER_COUNT), []);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);
    const targetScale = 1 + progress * 0.15;
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta),
    );
    root.position.y = THREE.MathUtils.damp(
      root.position.y,
      progress * 0.4,
      4,
      delta,
    );
  });

  return (
    <group ref={rootRef}>
      <PeonyField flowers={flowers} index={index} />
      <FloatingPetals
        color="#f4a5ae"
        count={14}
        reducedMotion={reducedMotion}
        index={index}
      />
      <FloatingPetals
        color="#c4b5e4"
        count={13}
        reducedMotion={reducedMotion}
        index={index}
      />
      <FloatingPetals
        color="#e8c77d"
        count={13}
        reducedMotion={reducedMotion}
        index={index}
      />
    </group>
  );
};

export const HeroHtml = () => (
  <div className="exp-content" style={{ paddingTop: "16vh" }}>
    <span className="exp-kicker">Für Tatjana</span>
    <h1 className="exp-title">moja ljubavi</h1>
    <p className="exp-subtitle">
      Ein Jahr mit dir. Das hier ist alles für dich.
    </p>
    <div className="exp-scroll-hint">
      <span>Scroll</span>
      <span>↓</span>
    </div>
  </div>
);
