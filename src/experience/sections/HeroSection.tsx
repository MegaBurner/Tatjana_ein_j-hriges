import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import { usePrefersReducedMotion } from '../../three/hooks/useWebGL';
import type { SectionProps } from '../types';

const FLOWER_COUNT = 16;
const PETAL_COLORS = ['#f4a5ae', '#c4b5e4', '#e8c77d'] as const;

interface FlowerData {
  id: number;
  position: [number, number, number];
  color: string;
  scale: number;
  petals: number;
  swayPhase: number;
  swaySpeed: number;
  delay: number;
}

/** Erzeugt eine lose Bogen-Anordnung von Blumen in der unteren Bildhälfte. */
function makeFlowers(count: number): FlowerData[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = THREE.MathUtils.lerp(-3.3, 3.3, t) + (Math.random() - 0.5) * 0.35;
    const arc = Math.sin(t * Math.PI) * 0.55;
    const y = -1.95 + arc + (Math.random() - 0.5) * 0.3;
    const z = (Math.random() - 0.5) * 0.9;
    return {
      id: i,
      position: [x, y, z],
      color: PETAL_COLORS[i % PETAL_COLORS.length],
      scale: 0.75 + Math.random() * 0.5,
      petals: 5 + Math.round(Math.random()),
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.5 + Math.random() * 0.4,
      delay: t * 0.9 + Math.random() * 0.2,
    };
  });
}

interface SwayIntensity {
  intensity: number;
}

function Flower({
  data,
  swayRef,
  reducedMotion,
}: {
  data: FlowerData;
  swayRef: RefObject<SwayIntensity>;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bloomRef = useRef(0);
  const mountTimeRef = useRef<number | null>(null);
  const petalAngles = useMemo(
    () => Array.from({ length: data.petals }, (_, i) => (i / data.petals) * Math.PI * 2),
    [data.petals]
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    if (mountTimeRef.current === null) mountTimeRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - mountTimeRef.current;
    const bloomTarget = elapsed > data.delay ? 1 : 0;
    bloomRef.current = THREE.MathUtils.damp(bloomRef.current, bloomTarget, 3.2, delta);
    group.scale.setScalar(bloomRef.current * data.scale);

    const swayIntensity = reducedMotion ? 0 : swayRef.current?.intensity ?? 0;
    const swayAmount = reducedMotion ? 0.008 : 0.04 + swayIntensity * 0.14;
    group.rotation.z =
      Math.sin(state.clock.elapsedTime * data.swaySpeed + data.swayPhase) * swayAmount;
  });

  return (
    <group ref={groupRef} position={data.position}>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.014, 0.02, 0.7, 6]} />
        <meshStandardMaterial color="#7fa06f" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.015]}>
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.5} />
      </mesh>
      {petalAngles.map((angle, i) => (
        <mesh
          key={i}
          position={[Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, 0.008]}
          rotation={[0, 0, angle]}
          scale={[1.9, 1, 0.35]}
        >
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshStandardMaterial color={data.color} roughness={0.45} />
        </mesh>
      ))}
    </group>
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

function FloatingPetals({
  color,
  count,
  reducedMotion,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makePetalSeeds(count), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
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
      dummy.rotation.set(0.3, reducedMotion ? seed.phase : seed.phase + t * seed.spin, 0.6);
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
  const swayRef = useRef<SwayIntensity>({ intensity: 0 });
  const flowers = useMemo(() => makeFlowers(FLOWER_COUNT), []);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);
    swayRef.current.intensity = progress;

    const targetScale = 1 + progress * 0.15;
    root.scale.setScalar(THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta));
    root.position.y = THREE.MathUtils.damp(root.position.y, progress * 0.4, 4, delta);
  });

  return (
    <group ref={rootRef}>
      {flowers.map((flower) => (
        <Flower key={flower.id} data={flower} swayRef={swayRef} reducedMotion={reducedMotion} />
      ))}
      <FloatingPetals color="#f4a5ae" count={14} reducedMotion={reducedMotion} />
      <FloatingPetals color="#c4b5e4" count={13} reducedMotion={reducedMotion} />
      <FloatingPetals color="#e8c77d" count={13} reducedMotion={reducedMotion} />
    </group>
  );
};

export const HeroHtml = () => (
  <div className="exp-content" style={{ paddingTop: '18vh' }}>
    <span className="exp-kicker">Für Tatjana</span>
    <h1 className="exp-title">moja ljubavi</h1>
    <p className="exp-subtitle">Für die schönste Seele der Welt — für meinen Schatz.</p>
    <div className="exp-scroll-hint">
      <span>Scroll</span>
      <span>↓</span>
    </div>
  </div>
);
