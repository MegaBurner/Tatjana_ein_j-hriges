import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrefersReducedMotion } from './hooks/useWebGL';
import SceneErrorBoundary from './SceneErrorBoundary';
import CanvasBackgroundEffects from '../components/Effects/CanvasBackgroundEffects';

type ParticleShape = 'heart' | 'petal';

const WORLD = { width: 22, height: 13, depth: 6 } as const;

function makeGlowTexture(shape: ParticleShape): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.shadowBlur = 24;

  if (shape === 'heart') {
    ctx.shadowColor = 'rgba(224, 113, 134, 0.9)';
    ctx.fillStyle = '#f4a5ae';
    const s = 26;
    ctx.beginPath();
    ctx.moveTo(0, -s / 2);
    ctx.bezierCurveTo(-s, -s, -s * 2, s / 3, 0, s * 1.5);
    ctx.bezierCurveTo(s * 2, s / 3, s, -s, 0, -s / 2);
    ctx.fill();
  } else {
    ctx.shadowColor = 'rgba(232, 199, 125, 0.9)';
    ctx.fillStyle = '#f3e0b5';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 30, Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Seed {
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  scale: number;
  spin: number;
  phase: number;
}

function makeSeeds(count: number): Seed[] {
  return Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * WORLD.width,
    y: (Math.random() - 0.5) * WORLD.height,
    z: -Math.random() * WORLD.depth,
    speed: 0.25 + Math.random() * 0.6,
    drift: (Math.random() - 0.5) * 0.2,
    scale: 0.25 + Math.random() * 0.45,
    spin: (Math.random() - 0.5) * 0.6,
    phase: Math.random() * Math.PI * 2,
  }));
}

function ParticleField({ shape, count }: { shape: ParticleShape; count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(() => makeGlowTexture(shape), [shape]);
  const seeds = useMemo(() => makeSeeds(count), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const reducedMotion = usePrefersReducedMotion();

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      if (!reducedMotion) {
        seed.y += seed.speed * delta;
        seed.x += seed.drift * delta;
        if (seed.y > WORLD.height / 2 + 1) {
          seed.y = -WORLD.height / 2 - 1;
          seed.x = (Math.random() - 0.5) * WORLD.width;
        }
      }
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.rotation.z = reducedMotion ? seed.phase : seed.phase + t * seed.spin;
      dummy.scale.setScalar(seed.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/** Dezenter Kamera-Parallax auf Pointer-Bewegung (Canvas ist pointer-events: none,
 *  daher window-Listener statt R3F-Pointer). */
function ParallaxRig() {
  const target = useRef({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 1.2,
        y: -(e.clientY / window.innerHeight - 0.5) * 0.8,
      };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame(({ camera }, delta) => {
    if (reducedMotion) return;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, target.current.x, 2, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, target.current.y, 2, delta);
    camera.lookAt(0, 0, -WORLD.depth / 2);
  });

  return null;
}

const BackgroundScene = () => {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    >
      <SceneErrorBoundary fallback={<CanvasBackgroundEffects />}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 10], fov: 50 }}
          gl={{
            antialias: window.devicePixelRatio <= 1.5,
            alpha: true,
            powerPreference: 'low-power',
          }}
          style={{ pointerEvents: 'none' }}
        >
          <ParticleField shape="heart" count={28} />
          <ParticleField shape="petal" count={20} />
          <ParallaxRig />
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
};

export default BackgroundScene;
