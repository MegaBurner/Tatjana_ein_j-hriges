import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import { usePrefersReducedMotion } from '../../three/hooks/useWebGL';
import type { SectionProps } from '../types';

type ScrollState = ReturnType<typeof useScroll>;

const ENVELOPE_WIDTH = 2.2;
const ENVELOPE_HEIGHT = 1.5;
// sectionVisibility fades the whole scene out again by local progress ≈0.75
// (its bell curve peaks at progress 0 and hits zero at progress 0.75), so the
// reveal must fully complete comfortably before that hard cutoff.
const FLAP_OPEN_SPAN = 0.3;
const LETTER_RISE_START = 0.25;
const LETTER_RISE_SPAN = 0.3;
const HEART_COUNT = 5;

interface HeartSeed {
  angle: number;
  radius: number;
  height: number;
  speed: number;
  scale: number;
  phase: number;
}

function makeHeartSeeds(count: number): HeartSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + Math.random() * 0.6,
    radius: 1.5 + Math.random() * 0.7,
    height: (Math.random() - 0.5) * 1.1,
    speed: 0.25 + Math.random() * 0.25,
    scale: 0.06 + Math.random() * 0.05,
    phase: Math.random() * Math.PI * 2,
  }));
}

function FloatingHearts({ reducedMotion }: { reducedMotion: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeHeartSeeds(HEART_COUNT), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      const a = seed.angle + t * seed.speed;
      dummy.position.set(
        Math.cos(a) * seed.radius,
        seed.height + Math.sin(t * 0.6 + seed.phase) * 0.15,
        0.6 + Math.sin(a) * 0.5
      );
      dummy.rotation.set(0, t * 0.4 + seed.phase, Math.PI / 4);
      dummy.scale.setScalar(seed.scale);
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

/** Flache, dreieckige Klappen-Form: Basis bei y=0 (Scharnier), Spitze bei y=-h. */
function makeFlapShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-width, 0);
  shape.lineTo(width, 0);
  shape.lineTo(0, -height);
  shape.lineTo(-width, 0);
  return shape;
}

function Letter({ scroll, index }: { scroll: ScrollState; index: number }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const progress = sectionProgress(scroll, index);
    const t = THREE.MathUtils.clamp(
      (progress - LETTER_RISE_START) / LETTER_RISE_SPAN,
      0,
      1
    );
    const targetY = -0.3 + t * 0.85;
    const targetZ = 0.05 + t * 0.25;
    const targetTilt = t * -0.28;
    group.position.y = THREE.MathUtils.damp(group.position.y, targetY, 5, delta);
    group.position.z = THREE.MathUtils.damp(group.position.z, targetZ, 5, delta);
    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, targetTilt, 5, delta);
    group.visible = t > 0.001;
  });

  return (
    <group ref={groupRef} position={[0, -0.3, 0.05]}>
      <mesh>
        <boxGeometry args={[ENVELOPE_WIDTH * 0.82, ENVELOPE_HEIGHT * 0.82, 0.02]} />
        <meshStandardMaterial color="#fffdf8" roughness={0.7} />
      </mesh>
      {[0.28, 0.14, 0, -0.14, -0.28].map((y, i) => (
        <mesh key={i} position={[0, y, 0.012]}>
          <boxGeometry args={[ENVELOPE_WIDTH * 0.6 - Math.abs(y) * 0.3, 0.02, 0.001]} />
          <meshStandardMaterial color="#e8c77d" roughness={0.5} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

export const LetterScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const flapRef = useRef<THREE.Group>(null);
  const flapShape = useMemo(
    () => makeFlapShape(ENVELOPE_WIDTH * 0.5, ENVELOPE_HEIGHT * 0.55),
    []
  );

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;

    const progress = sectionProgress(scroll, index);

    const flap = flapRef.current;
    if (flap) {
      const flapT = reducedMotion
        ? 1
        : THREE.MathUtils.clamp(progress / FLAP_OPEN_SPAN, 0, 1);
      const targetAngle = -Math.PI * 0.72 * flapT;
      flap.rotation.x = THREE.MathUtils.damp(flap.rotation.x, targetAngle, 5, delta);
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.1, 0]} rotation={[0.18, -0.22, 0.05]}>
      {/* Umschlagkörper (dunkleres Creme als Innenfütterung) */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.06]} />
        <meshStandardMaterial color="#f0e4d0" roughness={0.75} />
      </mesh>

      <Letter scroll={scroll} index={index} />

      {/* Vorderseite des Umschlags */}
      <mesh position={[0, 0, 0.015]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.02]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.65} />
      </mesh>

      {/* Untere Dreiecksklappen (statisch, angedeutet über verjüngte Boxen) */}
      <mesh position={[-ENVELOPE_WIDTH * 0.25, -ENVELOPE_HEIGHT * 0.18, 0.026]} rotation={[0, 0, 0.62]}>
        <boxGeometry args={[ENVELOPE_WIDTH * 0.62, ENVELOPE_HEIGHT * 0.5, 0.005]} />
        <meshStandardMaterial color="#f7ecdc" roughness={0.6} />
      </mesh>
      <mesh position={[ENVELOPE_WIDTH * 0.25, -ENVELOPE_HEIGHT * 0.18, 0.026]} rotation={[0, 0, -0.62]}>
        <boxGeometry args={[ENVELOPE_WIDTH * 0.62, ENVELOPE_HEIGHT * 0.5, 0.005]} />
        <meshStandardMaterial color="#f7ecdc" roughness={0.6} />
      </mesh>

      {/* Obere Dreiecksklappe — Scharnier an der oberen Kante (lokal y=0) */}
      <group position={[0, ENVELOPE_HEIGHT / 2, 0.03]} ref={flapRef}>
        <mesh>
          <shapeGeometry args={[flapShape]} />
          <meshStandardMaterial color="#fdf6ec" roughness={0.65} side={THREE.DoubleSide} />
        </mesh>
        {/* Wachssiegel, mittig auf der Klappe */}
        <mesh position={[0, -ENVELOPE_HEIGHT * 0.3, 0.01]}>
          <cylinderGeometry args={[0.16, 0.16, 0.05, 24]} />
          <meshStandardMaterial color="#e07186" roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh position={[0, -ENVELOPE_HEIGHT * 0.3, 0.036]}>
          <cylinderGeometry args={[0.09, 0.09, 0.01, 24]} />
          <meshStandardMaterial color="#c85a6b" roughness={0.5} />
        </mesh>
      </group>

      <FloatingHearts reducedMotion={reducedMotion} />
    </group>
  );
};

export const LetterHtml = ({ onOpenLetter }: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: '12vh' }}>
    <span className="exp-kicker">Kapitel 3</span>
    <h2 className="exp-title">Ein Brief für dich</h2>
    <p className="exp-subtitle">Von mir, für dich — schwarz auf weiß.</p>
    <button className="exp-btn primary" onClick={onOpenLetter}>
      Brief lesen
    </button>
  </div>
);
