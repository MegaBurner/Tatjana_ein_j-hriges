import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
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

// --- Tap-Interaktion: Klick auf eine Peonie → Blütenblätter-Puff -----------
/** Pointer-Bewegung (px), bis zu der ein Klick als Tap gilt — gleiches
 *  Kriterium wie die Tap/Drag-Unterscheidung beim Globus, damit
 *  Scroll-/Drag-Gesten keinen Puff auslösen. */
const TAP_MAX_MOVEMENT_PX = 8;
/** Ab dieser Sichtbarkeit nehmen die Blumen Taps an (kein Klicken "im Vorbeiscrollen"). */
const TAP_VISIBILITY_THRESHOLD = 0.3;
/** Deckel: maximal so viele Puffs gleichzeitig — der älteste fällt raus. */
const PUFF_MAX_ACTIVE = 3;
/** Blütenblätter pro Puff (instanced, gleiche Optik wie FloatingPetals/AmbientLayer). */
const PUFF_PETAL_COUNT = 14;
const PUFF_DURATION_SECONDS = 1.1;
/** Abwärtsbeschleunigung der Puff-Blätter (Szenen-Einheiten/s²). */
const PUFF_GRAVITY = -1.6;
/** Horizontale Startgeschwindigkeit: min + zufälliger Anteil. */
const PUFF_SPEED_MIN = 0.7;
const PUFF_SPEED_VARIANCE = 0.7;
/** Aufwärts-Anteil der Startgeschwindigkeit — der Puff steigt erst, fällt dann. */
const PUFF_UP_MIN = 0.5;
const PUFF_UP_VARIANCE = 0.9;
/** Tiefen-Streuung flacher halten als die horizontale (Blumen stehen frontal). */
const PUFF_DEPTH_FACTOR = 0.4;
/** Leichter Z-Versatz nach vorn, damit der Puff vor den Blütenblättern aufgeht. */
const PUFF_Z_OFFSET = 0.15;
const PUFF_SPIN_SPEED = 3;
const PUFF_COLOR = "#f4a5ae";

// --- Pointer-Sway: Blumen lehnen sich dezent zum Pointer --------------------
/** Lehn-Winkel (rad) pro Szenen-Einheit horizontalem Pointer-Abstand. */
const POINTER_LEAN_FACTOR = 0.045;
/** Obergrenze des Lehn-Winkels (rad) — dezent, nie "umgeknickt". */
const POINTER_LEAN_MAX = 0.11;
/** Dämpfungsrate, mit der die Blumen dem Pointer folgen bzw. zurückfedern. */
const POINTER_LEAN_DAMP = 2.5;
/** Unsichtbare Fläche hinter den Blumen, die onPointerMove über die ganze Section einfängt. */
const POINTER_PLANE_WIDTH = 12;
const POINTER_PLANE_HEIGHT = 7;
const POINTER_PLANE_Z = -1.2;

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

interface PuffPetalSeed {
  velocity: THREE.Vector3;
  spinPhase: number;
  size: number;
}

/** Ein aktiver Blütenblätter-Puff: Ursprung (Blütenkopf) + Start-Zeitpunkt + Partikel-Seeds. */
interface PetalPuff {
  origin: THREE.Vector3;
  startTime: number;
  seeds: readonly PuffPetalSeed[];
}

function makePetalPuff(origin: THREE.Vector3, startTime: number): PetalPuff {
  const seeds = Array.from({ length: PUFF_PETAL_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = PUFF_SPEED_MIN + Math.random() * PUFF_SPEED_VARIANCE;
    return {
      velocity: new THREE.Vector3(
        Math.cos(angle) * speed,
        PUFF_UP_MIN + Math.random() * PUFF_UP_VARIANCE,
        Math.sin(angle) * speed * PUFF_DEPTH_FACTOR,
      ),
      spinPhase: Math.random() * Math.PI * 2,
      size: 0.6 + Math.random() * 0.5,
    };
  });
  return { origin: origin.clone(), startTime, seeds };
}

/**
 * Schreibt die Matrizen aller Puff-Slots (ballistische Bahn: Startimpuls +
 * Gravitation, Ausblenden über Scale). Leere Slots kollabieren auf Scale 0 —
 * dieselbe Blütenblatt-Proportion (0.16/0.06/0.1) wie FloatingPetals/AmbientLayer.
 */
function writePetalPuffMatrices(
  mesh: THREE.InstancedMesh,
  puffs: readonly PetalPuff[],
  now: number,
  dummy: THREE.Object3D,
): void {
  for (let slot = 0; slot < PUFF_MAX_ACTIVE; slot++) {
    const puff = puffs[slot];
    for (let p = 0; p < PUFF_PETAL_COUNT; p++) {
      const idx = slot * PUFF_PETAL_COUNT + p;
      if (!puff) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0);
      } else {
        const seed = puff.seeds[p];
        const age = now - puff.startTime;
        const lifeT = THREE.MathUtils.clamp(age / PUFF_DURATION_SECONDS, 0, 1);
        dummy.position.set(
          puff.origin.x + seed.velocity.x * age,
          puff.origin.y +
            seed.velocity.y * age +
            0.5 * PUFF_GRAVITY * age * age,
          puff.origin.z + seed.velocity.z * age,
        );
        dummy.rotation.set(0.3, seed.spinPhase + age * PUFF_SPIN_SPEED, 0.6);
        const fadeSize = seed.size * (1 - lifeT);
        dummy.scale.set(fadeSize * 0.16, fadeSize * 0.06, fadeSize * 0.1);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
    }
  }
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

  // --- Tap → Blütenblätter-Puff ------------------------------------------
  const puffMeshRef = useRef<THREE.InstancedMesh>(null);
  const puffsRef = useRef<readonly PetalPuff[]>([]);
  /** true = Puff-Matrizen müssen (noch) geschrieben werden. Startet true,
   *  damit die Identity-Matrizen des frischen InstancedMesh im ersten Frame
   *  auf Scale 0 kollabiert werden. */
  const puffWritePendingRef = useRef(true);
  /** Letzte bekannte clock-Zeit — die Klick-Handler laufen außerhalb von useFrame. */
  const elapsedRef = useRef(0);

  // --- Pointer-Sway ---------------------------------------------------------
  /** Gedämpfter Lehn-Winkel pro Blume (rad), Ziel wird pro Frame neu bestimmt. */
  const pointerLeanRef = useRef(new Float32Array(flowers.length));
  /** Horizontale Pointer-Position in Gruppen-Koordinaten (null = Pointer weg). */
  const pointerXRef = useRef<number | null>(null);
  /** Allokationsfreier Scratch-Vektor für die Welt→Lokal-Umrechnung im Move-Handler. */
  const pointerScratch = useMemo(() => new THREE.Vector3(), []);

  /** Blütenblätter je Blume für das getroffene Mesh — das Gold-Zentrum hat
   *  genau eine Instanz pro Blume, die Ringe petalCount Instanzen. */
  const petalsPerFlowerFor = (object: THREE.Object3D): number => {
    if (object === outerMeshRef.current) return PEONY_LAYERS[0].petalCount;
    if (object === middleMeshRef.current) return PEONY_LAYERS[1].petalCount;
    if (object === innerMeshRef.current) return PEONY_LAYERS[2].petalCount;
    return 1;
  };

  const handleFlowerTap = (event: ThreeEvent<MouseEvent>) => {
    // `event.delta` = Pixel-Distanz zwischen pointerdown und diesem Klick —
    // nur echte Taps werten, keine Scroll-/Drag-Gesten über den Blumen.
    if (event.delta > TAP_MAX_MOVEMENT_PX) return;
    if (sectionVisibility(scroll, index) < TAP_VISIBILITY_THRESHOLD) return;
    if (event.instanceId === undefined) return;
    // Blütenblatt-Ringe überlappen sich: nur der vorderste Treffer soll zählen.
    event.stopPropagation();
    const flowerIndex = Math.floor(
      event.instanceId / petalsPerFlowerFor(event.eventObject),
    );
    const flower = flowers[flowerIndex];
    if (!flower) return;
    const origin = new THREE.Vector3(
      flower.x,
      flower.y,
      flower.z + PUFF_Z_OFFSET,
    );
    const puffs = [
      ...puffsRef.current,
      makePetalPuff(origin, elapsedRef.current),
    ];
    // Deckel: nur die jüngsten PUFF_MAX_ACTIVE Puffs behalten (immutable).
    puffsRef.current = puffs.slice(-PUFF_MAX_ACTIVE);
    puffWritePendingRef.current = true;
  };

  const handleFlowerPointerOver = () => {
    if (sectionVisibility(scroll, index) >= TAP_VISIBILITY_THRESHOLD) {
      document.body.style.cursor = "pointer";
    }
  };
  const handleFlowerPointerOut = () => {
    document.body.style.cursor = "";
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    // Welt- in Gruppen-Koordinaten wandeln (die Wurzelgruppe skaliert/verschiebt);
    // die Fänger-Ebene ist nur in z versetzt, x bleibt daher vergleichbar.
    pointerXRef.current = event.object.worldToLocal(
      pointerScratch.copy(event.point),
    ).x;
  };
  const handlePointerLeave = () => {
    pointerXRef.current = null;
  };

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
    elapsedRef.current = state.clock.elapsedTime;
    const swayIntensity = sectionProgress(scroll, index);
    const bloom = bloomRef.current;
    const sway = swayRef.current;
    const lean = pointerLeanRef.current;
    // Bei reduzierter Bewegung kein kontinuierliches Pointer-Folgen.
    const pointerX = reducedMotion ? null : pointerXRef.current;

    flowers.forEach((flower, fi) => {
      const bloomTarget = mountElapsed > flower.delay ? 1 : 0;
      bloom[fi] = THREE.MathUtils.damp(bloom[fi], bloomTarget, 3.2, delta);
      const swayAmount = reducedMotion ? 0.008 : 0.04 + swayIntensity * 0.14;
      // Dezentes Zum-Pointer-Lehnen: positive swayAngle schwenkt den
      // Stängel-Fuß nach +x, die Blüte kippt optisch nach -x — daher das
      // umgekehrte Vorzeichen (flower.x - pointerX).
      const leanTarget =
        pointerX === null
          ? 0
          : THREE.MathUtils.clamp(
              (flower.x - pointerX) * POINTER_LEAN_FACTOR,
              -POINTER_LEAN_MAX,
              POINTER_LEAN_MAX,
            );
      lean[fi] = THREE.MathUtils.damp(
        lean[fi],
        leanTarget,
        POINTER_LEAN_DAMP,
        delta,
      );
      sway[fi] =
        Math.sin(
          state.clock.elapsedTime * flower.swaySpeed + flower.swayPhase,
        ) *
          swayAmount +
        lean[fi];

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

    // --- Blütenblätter-Puffs (Tap-Reaktion) --------------------------------
    const puffMesh = puffMeshRef.current;
    if (puffMesh) {
      const now = state.clock.elapsedTime;
      if (
        puffsRef.current.some(
          (puff) => now - puff.startTime >= PUFF_DURATION_SECONDS,
        )
      ) {
        puffsRef.current = puffsRef.current.filter(
          (puff) => now - puff.startTime < PUFF_DURATION_SECONDS,
        );
      }
      if (puffsRef.current.length > 0 || puffWritePendingRef.current) {
        writePetalPuffMatrices(puffMesh, puffsRef.current, now, dummy);
        // Nach dem Verklingen aller Puffs genau einmal auf Scale 0 schreiben.
        puffWritePendingRef.current = puffsRef.current.length > 0;
      }
    }
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
        onClick={handleFlowerTap}
        onPointerOver={handleFlowerPointerOver}
        onPointerOut={handleFlowerPointerOut}
      >
        <sphereGeometry args={[CENTER_RADIUS, 10, 10]} />
        <meshStandardMaterial color={CENTER_COLOR} roughness={0.5} />
      </instancedMesh>
      <instancedMesh
        ref={outerMeshRef}
        args={[outerGeometry, undefined, outerAngles.length]}
        onClick={handleFlowerTap}
        onPointerOver={handleFlowerPointerOver}
        onPointerOut={handleFlowerPointerOut}
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
        onClick={handleFlowerTap}
        onPointerOver={handleFlowerPointerOver}
        onPointerOut={handleFlowerPointerOut}
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
        onClick={handleFlowerTap}
        onPointerOver={handleFlowerPointerOver}
        onPointerOut={handleFlowerPointerOut}
      >
        <meshStandardMaterial
          color={PEONY_LAYERS[2].color}
          roughness={0.42}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={puffMeshRef}
        args={[undefined, undefined, PUFF_MAX_ACTIVE * PUFF_PETAL_COUNT]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 6]} />
        <meshStandardMaterial color={PUFF_COLOR} roughness={0.55} />
      </instancedMesh>
      {/* Unsichtbare Fänger-Ebene hinter den Blumen: liefert onPointerMove
          über der ganzen Section für das Zum-Pointer-Lehnen. Material ist
          unsichtbar, Raycasts treffen die Ebene trotzdem. */}
      <mesh
        position={[0, 0, POINTER_PLANE_Z]}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerLeave}
      >
        <planeGeometry args={[POINTER_PLANE_WIDTH, POINTER_PLANE_HEIGHT]} />
        <meshBasicMaterial visible={false} />
      </mesh>
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
