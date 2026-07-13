import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import { usePrefersReducedMotion } from '../../three/hooks/useWebGL';
import type { SectionProps } from '../types';

const ROLL_COUNT = 5;
const STEAM_COUNT = 21;
const STEAM_COLUMNS = 3;
const STEAM_LOOP_DURATION = 2.6;
const STEAM_RISE_HEIGHT = 1.0;
const STEAM_BASE_Y = 0.18;

interface RollData {
  position: [number, number, number];
  rotationY: number;
  tilt: number;
  color: string;
}

/** Leicht variierte Grünfärbung pro Rolle für ein handgemachtes Aussehen. */
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
      color: shiftColor('#8a9a5b', (Math.random() - 0.5) * 0.1),
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
      scale: 0.05 + Math.random() * 0.04,
    };
  });
}

function SarmaRolls({ rolls }: { rolls: RollData[] }) {
  return (
    <>
      {rolls.map((roll, i) => (
        <mesh
          key={i}
          position={roll.position}
          rotation={[Math.PI / 2, roll.rotationY, roll.tilt]}
        >
          <capsuleGeometry args={[0.15, 0.4, 6, 12]} />
          <meshStandardMaterial color={roll.color} roughness={0.75} />
        </mesh>
      ))}
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
}: {
  intensityRef: RefObject<number>;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeSteamSeeds(STEAM_COUNT, STEAM_COLUMNS), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const intensity = intensityRef.current;
    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      let y = STEAM_BASE_Y;
      let x = seed.x;
      let bump = 1;
      if (!reducedMotion) {
        const loopT = ((t + seed.phase) % STEAM_LOOP_DURATION) / STEAM_LOOP_DURATION;
        y = STEAM_BASE_Y + loopT * STEAM_RISE_HEIGHT;
        x = seed.x + Math.sin(loopT * Math.PI * 2.4 + seed.phase) * seed.swayAmount;
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
      <meshStandardMaterial color="#ffffff" transparent opacity={0.4} roughness={0.9} />
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
        THREE.MathUtils.damp(plateGroup.scale.x, targetScale, 4, delta)
      );
      plateGroup.rotation.y = THREE.MathUtils.damp(plateGroup.rotation.y, targetRotY, 4, delta);
    }

    // Dampf-Intensität erreicht ihr Maximum in der Sektionsmitte.
    const targetIntensity = THREE.MathUtils.clamp(1 - Math.abs(progress - 0.5) * 2, 0, 1);
    intensityRef.current = THREE.MathUtils.damp(intensityRef.current, targetIntensity, 4, delta);
  });

  return (
    <group ref={rootRef} position={[0, -0.05, 0]}>
      {/* Holztisch */}
      <RoundedBox args={[3.8, 0.3, 2.4]} radius={0.06} smoothness={4} position={[0, -0.75, 0]}>
        <meshStandardMaterial color="#6b4e37" roughness={0.75} metalness={0.05} />
      </RoundedBox>

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

        <SarmaRolls rolls={rolls} />

        <Steam intensityRef={intensityRef} reducedMotion={reducedMotion} />
      </group>
    </group>
  );
};

export const SarmaHtml = () => (
  <div className="exp-content" style={{ paddingTop: '10vh' }}>
    <span className="exp-kicker">Kapitel 5</span>
    <h2 className="exp-title">Sarma</h2>
    <p className="exp-subtitle">Liebe geht durch den Magen — najbolja sarma, für uns zwei.</p>
  </div>
);
