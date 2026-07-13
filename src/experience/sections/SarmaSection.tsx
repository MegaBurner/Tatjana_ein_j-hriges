import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import type { SectionProps } from "../types";

const ROLL_COUNT = 5;
const STEAM_COUNT = 36;
const STEAM_COLUMNS = 3;
const STEAM_LOOP_DURATION = 3.6;
const STEAM_RISE_HEIGHT = 1.3;
const STEAM_BASE_Y = 0.28;
const FLECK_COUNT = 8;
/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;

// Geschmorter Krautwickel-Ton: Basisgrün leicht Richtung gebräuntem Braun gemischt.
const ROLL_BASE_COLOR = mixColor("#9aa465", "#7a5a35", 0.35);
const SEAM_COLOR = "#6f7a44";

interface RollData {
  position: [number, number, number];
  rotationY: number;
  tilt: number;
  color: string;
  seamAngles: [number, number];
}

function mixColor(a: string, b: string, t: number): string {
  const color = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return `#${color.getHexString()}`;
}

/** Leicht variierte Färbung pro Rolle für ein handgemachtes Aussehen. */
function shiftColor(base: string, offset: number): string {
  const color = new THREE.Color(base);
  color.offsetHSL(0, 0, offset);
  return `#${color.getHexString()}`;
}

function makeRolls(count: number): RollData[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
    const radius = 0.3 + Math.random() * 0.22;
    return {
      position: [Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius],
      rotationY: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 0.18,
      color: shiftColor(ROLL_BASE_COLOR, (Math.random() - 0.5) * 0.1),
      seamAngles: [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2],
    };
  });
}

interface SteamSeed {
  x: number;
  z: number;
  phase: number;
  swayAmount: number;
  scale: number;
}

function makeSteamSeeds(count: number, columns: number): SteamSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const column = i % columns;
    const columnX = (column - (columns - 1) / 2) * 0.32;
    return {
      x: columnX + (Math.random() - 0.5) * 0.08,
      z: (Math.random() - 0.5) * 0.15,
      phase: Math.random() * STEAM_LOOP_DURATION,
      swayAmount: 0.08 + Math.random() * 0.06,
      scale: 0.03 + Math.random() * 0.03,
    };
  });
}

interface FleckSeed {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** Streut Flecken nah an den tatsächlichen Rollen-Positionen, statt frei über dem Teller. */
function makeFleckSeeds(rolls: RollData[], count: number): FleckSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const roll = rolls[i % rolls.length];
    const jitterX = (Math.random() - 0.5) * 0.16;
    const jitterZ = (Math.random() - 0.5) * 0.16;
    return {
      x: roll.position[0] + jitterX,
      y: roll.position[1] + 0.11 + Math.random() * 0.04,
      z: roll.position[2] + jitterZ,
      scale: 0.012 + Math.random() * 0.008,
    };
  });
}

/** Zwei dünne Nahtbänder pro Rolle deuten die Kohlblatt-Wicklung an. */
function WrapSeams({ angles }: { angles: [number, number] }) {
  return (
    <>
      {angles.map((angle, i) => (
        <mesh
          key={i}
          position={[Math.sin(angle) * 0.145, 0, Math.cos(angle) * 0.145]}
          rotation={[0, angle, 0]}
        >
          <boxGeometry args={[0.045, 0.5, 0.012]} />
          <meshStandardMaterial color={SEAM_COLOR} roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

function PaprikaFlecks({ rolls, count }: { rolls: RollData[]; count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeFleckSeeds(rolls, count), [rolls, count]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    seeds.forEach((seed, i) => {
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.scale.setScalar(seed.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [seeds]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#c04a2f" roughness={0.6} />
    </instancedMesh>
  );
}

function SarmaRolls({ rolls }: { rolls: RollData[] }) {
  return (
    <>
      {rolls.map((roll, i) => (
        <group
          key={i}
          position={roll.position}
          rotation={[Math.PI / 2, roll.rotationY, roll.tilt]}
        >
          <mesh>
            <capsuleGeometry args={[0.15, 0.4, 6, 12]} />
            <meshStandardMaterial color={roll.color} roughness={0.75} />
          </mesh>
          <WrapSeams angles={roll.seamAngles} />
          {/* Zarter Glasur-Schimmer: leicht größere, transparente Hülle */}
          <mesh scale={1.06}>
            <capsuleGeometry args={[0.15, 0.4, 6, 12]} />
            <meshStandardMaterial
              color="#e8a34d"
              roughness={0.25}
              transparent
              opacity={0.15}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      <PaprikaFlecks rolls={rolls} count={FLECK_COUNT} />
      {/* Kleiner Kräutergarnitur-Zweig */}
      <mesh position={[0.05, 0.24, -0.05]} rotation={[0.3, 0.4, 0]}>
        <coneGeometry args={[0.03, 0.14, 6]} />
        <meshStandardMaterial color="#5c7a3f" roughness={0.7} />
      </mesh>
      <mesh position={[0.09, 0.28, -0.02]}>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshStandardMaterial color="#6f8f4a" roughness={0.7} />
      </mesh>
    </>
  );
}

function Steam({
  intensityRef,
  reducedMotion,
  scroll,
  index,
}: {
  intensityRef: RefObject<number>;
  reducedMotion: boolean;
  scroll: ReturnType<typeof useScroll>;
  index: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeSteamSeeds(STEAM_COUNT, STEAM_COLUMNS), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const intensity = intensityRef.current;
    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      let y = STEAM_BASE_Y;
      let x = seed.x;
      let bump = 1;
      if (!reducedMotion) {
        const loopT =
          ((t + seed.phase) % STEAM_LOOP_DURATION) / STEAM_LOOP_DURATION;
        y = STEAM_BASE_Y + loopT * STEAM_RISE_HEIGHT;
        x =
          seed.x +
          Math.sin(loopT * Math.PI * 2.4 + seed.phase) * seed.swayAmount;
        bump = Math.sin(loopT * Math.PI);
      }
      dummy.position.set(x, y, seed.z);
      dummy.scale.setScalar(seed.scale * bump * intensity);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, STEAM_COUNT]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        color="#ffffff"
        transparent
        opacity={0.25}
        roughness={0.9}
      />
    </instancedMesh>
  );
}

export const SarmaScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const plateGroupRef = useRef<THREE.Group>(null);
  const intensityRef = useRef(0);
  const rolls = useMemo(() => makeRolls(ROLL_COUNT), []);
  const shadowTexture = getSoftShadowTexture();

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);

    const plateGroup = plateGroupRef.current;
    if (plateGroup) {
      const targetScale = 0.85 + progress * 0.15;
      const targetRotY = Math.sin(progress * Math.PI) * 0.15;
      plateGroup.scale.setScalar(
        THREE.MathUtils.damp(plateGroup.scale.x, targetScale, 4, delta),
      );
      plateGroup.rotation.y = THREE.MathUtils.damp(
        plateGroup.rotation.y,
        targetRotY,
        4,
        delta,
      );
    }

    // Dampf-Intensität: Maximum, wenn die Section zentriert im Viewport steht
    // (progress ≈ 0.83 bei Zentrierung — siehe sectionProgress-Semantik).
    const targetIntensity = THREE.MathUtils.clamp(
      1 - Math.abs(progress - 0.85) * 2.2,
      0,
      1,
    );
    intensityRef.current = THREE.MathUtils.damp(
      intensityRef.current,
      targetIntensity,
      4,
      delta,
    );
  });

  return (
    // Deutlich zur Kamera gekippt, damit die Rollen auf dem Teller sichtbar sind
    <group
      ref={rootRef}
      position={[0, -1.15, 0.2]}
      rotation={[0.62, 0, 0]}
      scale={0.82}
    >
      {/* Holztisch */}
      <RoundedBox
        args={[3.8, 0.3, 2.4]}
        radius={0.06}
        smoothness={4}
        position={[0, -0.75, 0]}
      >
        <meshStandardMaterial
          color="#6b4e37"
          roughness={0.75}
          metalness={0.05}
        />
      </RoundedBox>

      {/* Weicher Kontaktschatten zwischen Tisch und Teller */}
      <mesh position={[0, -0.595, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.8, 1.8]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={plateGroupRef} position={[0, -0.45, 0]}>
        {/* Teller: äußerer flacher Rand + innere leicht erhöhte Fläche */}
        <mesh>
          <cylinderGeometry args={[1.3, 1.3, 0.07, 48]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.025, 0]}>
          <cylinderGeometry args={[1.05, 1.05, 0.04, 48]} />
          <meshStandardMaterial color="#f7f5f0" roughness={0.3} />
        </mesh>

        {/* Paprika-Tomaten-Sauce, eingelassen in den Teller */}
        <mesh position={[0, 0.047, 0]}>
          <cylinderGeometry args={[0.75, 0.75, 0.01, 32]} />
          <meshStandardMaterial color="#b3552e" roughness={0.35} />
        </mesh>

        <SarmaRolls rolls={rolls} />

        <Steam
          intensityRef={intensityRef}
          reducedMotion={reducedMotion}
          scroll={scroll}
          index={index}
        />
      </group>
    </group>
  );
};

export const SarmaHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 5</span>
    <h2 className="exp-title">Sarma</h2>
    <p className="exp-subtitle">
      Najbolja sarma. Mit dir schmeckt sie am besten.
    </p>
  </div>
);
