import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '../three/hooks/useWebGL';

// Streufeld-Grenzen: liegt hinter dem Section-Inhalt (z ~0) und füllt so
// jeden Übergang zwischen zwei Sections mit Atmosphäre statt leerem Gradient.
const SPREAD_X = 4.5;
const SPREAD_Y = 2.6;
const Z_FAR = -3.5;
const Z_NEAR = -1.5;
const PARALLAX_FACTOR = 1.2;

const ROSE_COUNT = 15;
const LAVENDER_COUNT = 15;
const GOLD_COUNT = 15;

interface AmbientSeed {
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  scale: number;
  spin: number;
  phase: number;
}

function makeAmbientSeeds(count: number): AmbientSeed[] {
  return Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * SPREAD_X * 2,
    y: (Math.random() - 0.5) * SPREAD_Y * 2,
    z: Z_FAR + Math.random() * (Z_NEAR - Z_FAR),
    speed: 0.08 + Math.random() * 0.14,
    drift: (Math.random() - 0.5) * 0.06,
    scale: 0.5 + Math.random() * 0.6,
    spin: (Math.random() - 0.5) * 0.5,
    phase: Math.random() * Math.PI * 2,
  }));
}

/** Wiederverwendet exakt das Drift+Spin-Muster von HeroSection's FloatingPetals. */
function AmbientInstances({
  color,
  count,
  reducedMotion,
  shape,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  shape: 'petal' | 'sparkle';
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeAmbientSeeds(count), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // Bei prefers-reduced-motion bewegt sich kein Partikel mehr — die
  // Instance-Matrizen sind dann für die Lebensdauer des Meshs konstant.
  // Ohne diesen Flag würde useFrame sie trotzdem jeden Frame neu aufbauen
  // (identisches Ergebnis, aber unnötige CPU-Arbeit bei reduzierter Bewegung).
  const builtRef = useRef(false);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (reducedMotion && builtRef.current) return;

    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      if (!reducedMotion) {
        seed.y += seed.speed * delta;
        seed.x += seed.drift * delta;
        if (seed.y > SPREAD_Y) {
          seed.y = -SPREAD_Y;
          seed.x = (Math.random() - 0.5) * SPREAD_X * 2;
        }
      }
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.rotation.set(0.3, reducedMotion ? seed.phase : seed.phase + t * seed.spin, 0.6);
      if (shape === 'petal') {
        dummy.scale.set(seed.scale * 0.16, seed.scale * 0.06, seed.scale * 0.1);
      } else {
        dummy.scale.setScalar(seed.scale * 0.09);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    builtRef.current = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      {shape === 'petal' ? (
        <sphereGeometry args={[1, 6, 6]} />
      ) : (
        <octahedronGeometry args={[1, 0]} />
      )}
      <meshStandardMaterial color={color} roughness={0.55} transparent opacity={0.5} />
    </instancedMesh>
  );
}

/**
 * Immer sichtbares Partikelfeld, gerendert innerhalb des Canvas aber
 * außerhalb von <Scroll> — es scrollt nicht mit den Sections mit und füllt
 * dadurch jeden Übergang. Liegt hinter dem Section-Inhalt (siehe Z_FAR/Z_NEAR).
 */
const AmbientLayer = () => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.position.y = reducedMotion ? 0 : -scroll.offset * PARALLAX_FACTOR;
  });

  return (
    <group ref={groupRef}>
      <AmbientInstances color="#f4a5ae" count={ROSE_COUNT} reducedMotion={reducedMotion} shape="petal" />
      <AmbientInstances
        color="#c4b5e4"
        count={LAVENDER_COUNT}
        reducedMotion={reducedMotion}
        shape="petal"
      />
      <AmbientInstances color="#e8c77d" count={GOLD_COUNT} reducedMotion={reducedMotion} shape="sparkle" />
    </group>
  );
};

export default AmbientLayer;
