import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import { usePrefersReducedMotion } from '../../three/hooks/useWebGL';
import type { SectionProps } from '../types';

type ScrollState = ReturnType<typeof useScroll>;

const STAMEN_COUNT = 26;
const ORBIT_PETAL_COUNT = 8;
const SPARKLE_COUNT = 14;

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
    color: '#e07186',
    zOffset: 0.16,
    openStart: 0,
    openSpan: 0.5,
  },
  {
    count: 8,
    fullRadius: 0.68,
    closedRadius: 0.08,
    petalSize: 0.36,
    color: '#f4a5ae',
    zOffset: 0,
    openStart: 0.08,
    openSpan: 0.5,
  },
  {
    count: 10,
    fullRadius: 0.92,
    closedRadius: 0.1,
    petalSize: 0.4,
    color: '#f8c8ce',
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
  const { angle, fullRadius, closedRadius, petalSize, color, zOffset, openStart, openSpan } =
    config;

  useFrame((_, delta) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) return;
    const progress = sectionProgress(scroll, index);
    const t = THREE.MathUtils.clamp((progress - openStart) / openSpan, 0, 1);
    const radius = THREE.MathUtils.lerp(closedRadius, fullRadius, t);
    const scale = THREE.MathUtils.lerp(0.3, 1, t);
    const fold = THREE.MathUtils.lerp(1.1, 0, t);

    const targetX = Math.cos(angle) * radius;
    const targetY = Math.sin(angle) * radius;
    group.position.x = THREE.MathUtils.damp(group.position.x, targetX, 5, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, targetY, 5, delta);
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
    const progress = sectionProgress(scroll, index);
    const t = THREE.MathUtils.clamp(progress / 0.35, 0, 1);

    seeds.forEach((seed, i) => {
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.scale.setScalar(seed.scale * t);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
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

function makeOrbitSeeds(count: number, baseRadius: number, radiusVariance: number): OrbitSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    radius: baseRadius + Math.random() * radiusVariance,
    speed: 0.22 + Math.random() * 0.14,
    phase: (i / count) * Math.PI * 2,
    heightAmp: 0.25 + Math.random() * 0.3,
    heightPhase: Math.random() * Math.PI * 2,
    scale: 0.05 + Math.random() * 0.04,
  }));
}

function OrbitPetals({ reducedMotion }: { reducedMotion: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeOrbitSeeds(ORBIT_PETAL_COUNT, 1.3, 0.35), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      const angle = seed.phase + t * seed.speed;
      const height = reducedMotion ? 0 : Math.sin(t * 0.4 + seed.heightPhase) * seed.heightAmp;
      dummy.position.set(Math.cos(angle) * seed.radius, height, Math.sin(angle) * seed.radius * 0.5);
      dummy.rotation.set(0, angle, Math.PI / 3);
      dummy.scale.set(seed.scale * 1.8, seed.scale, seed.scale * 0.4);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, ORBIT_PETAL_COUNT]}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#f4a5ae" roughness={0.45} transparent opacity={0.85} />
    </instancedMesh>
  );
}

function Sparkles({ reducedMotion }: { reducedMotion: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeOrbitSeeds(SPARKLE_COUNT, 1.0, 0.7), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      const angle = seed.phase - t * seed.speed * 1.4;
      const height = reducedMotion ? 0 : Math.sin(t * 0.6 + seed.heightPhase) * seed.heightAmp;
      const twinkle = reducedMotion ? 1 : 0.6 + Math.sin(t * 3 + seed.heightPhase) * 0.4;
      dummy.position.set(Math.cos(angle) * seed.radius, height, Math.sin(angle) * seed.radius * 0.5);
      dummy.rotation.set(t * 0.8, angle, 0);
      dummy.scale.setScalar(seed.scale * twinkle);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, SPARKLE_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#e8c77d" roughness={0.3} metalness={0.6} />
    </instancedMesh>
  );
}

export const FinaleScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const petalConfigs = useMemo(() => makePetalConfigs(), []);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);
    const targetScale = 0.62 + progress * 0.22;
    root.scale.setScalar(THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta));
  });

  return (
    <group ref={rootRef} position={[0, -0.95, 0.2]}>
      {petalConfigs.map((config, i) => (
        <Petal key={i} config={config} scroll={scroll} index={index} />
      ))}
      <Stamen scroll={scroll} index={index} />
      <OrbitPetals reducedMotion={reducedMotion} />
      <Sparkles reducedMotion={reducedMotion} />
    </group>
  );
};

export const FinaleHtml = () => (
  <div className="exp-content" style={{ paddingTop: '11vh' }}>
    <span className="exp-kicker">Für immer</span>
    <h2 className="exp-title">
      Volim te <span style={{ color: 'var(--accent-rose-deep)', fontStyle: 'normal' }}>♥</span>
    </h2>
    <p className="exp-subtitle">Auf noch viele weitere Jahre mit dir.</p>
    <p className="exp-subtitle" style={{ opacity: 0.6 }}>
      — M.
    </p>
  </div>
);
