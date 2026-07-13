import { Suspense, useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { usePrefersReducedMotion } from "./hooks/useWebGL";

interface Vinyl3DProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  coverImage?: string;
}

const PLAY_SPEED = 1.6; // rad/s (~33 1/3 UPM Gefühl, leicht überhöht)

/** Konzentrische Rillen als Bump-Map, einmalig Canvas-generiert. */
function makeGrooveTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#6a6a6a";
  ctx.lineWidth = 1;
  for (let r = 60; r < size / 2 - 4; r += 3) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

let grooveTexture: THREE.CanvasTexture | null = null;
function getGrooveTexture(): THREE.CanvasTexture {
  grooveTexture ??= makeGrooveTexture();
  return grooveTexture;
}

function CoverLabel({ coverImage }: { coverImage: string }) {
  const rawTexture = useLoader(THREE.TextureLoader, coverImage);
  const texture = useMemo(() => {
    const clone = rawTexture.clone();
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    return clone;
  }, [rawTexture]);
  // Dispose the cloned texture on unmount and whenever a new cover swaps it in,
  // so cover swaps don't leak GPU memory (the mesh never unmounts on Next/Previous).
  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);
  return (
    <mesh position={[0, 0.026, 0]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[0.52, 64]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

function Disc({ audioRef, coverImage }: Vinyl3DProps) {
  const spinRef = useRef<THREE.Group>(null);
  const tiltRef = useRef<THREE.Group>(null);
  const speed = useRef(0);
  const pointerTarget = useRef({ x: 0, y: 0 });
  const grooves = getGrooveTexture();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: PointerEvent) => {
      pointerTarget.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 0.25,
        y: (e.clientY / window.innerHeight - 0.5) * 0.18,
      };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reducedMotion]);

  useFrame((_, delta) => {
    const isPlaying = audioRef.current ? !audioRef.current.paused : false;
    speed.current = THREE.MathUtils.damp(
      speed.current,
      isPlaying ? PLAY_SPEED : 0,
      1.8,
      delta,
    );
    if (spinRef.current) {
      spinRef.current.rotation.y += speed.current * delta;
    }
    if (tiltRef.current && !reducedMotion) {
      tiltRef.current.rotation.x = THREE.MathUtils.damp(
        tiltRef.current.rotation.x,
        pointerTarget.current.y,
        3,
        delta,
      );
      tiltRef.current.rotation.z = THREE.MathUtils.damp(
        tiltRef.current.rotation.z,
        -pointerTarget.current.x,
        3,
        delta,
      );
    }
  });

  return (
    <group ref={tiltRef}>
      {/* Platte liegt in XZ-Ebene, Kamera schaut von schräg oben */}
      <group ref={spinRef}>
        <mesh>
          <cylinderGeometry args={[1.4, 1.4, 0.05, 64]} />
          <meshPhysicalMaterial
            color="#141414"
            roughness={0.42}
            metalness={0.15}
            clearcoat={1}
            clearcoatRoughness={0.3}
            bumpMap={grooves}
            bumpScale={0.35}
          />
        </mesh>
        {coverImage ? (
          <Suspense fallback={null}>
            <CoverLabel coverImage={coverImage} />
          </Suspense>
        ) : (
          <mesh position={[0, 0.026, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.52, 64]} />
            <meshBasicMaterial color="#e07186" />
          </mesh>
        )}
        {/* Mittelloch */}
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.05, 24]} />
          <meshBasicMaterial color="#0a0a0a" />
        </mesh>
      </group>
    </group>
  );
}

const Vinyl3D = ({ audioRef, coverImage }: Vinyl3DProps) => {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 3.1, 2.4], fov: 42 }}
      gl={{ antialias: window.devicePixelRatio <= 1.5, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 6, 3]} intensity={1.4} />
      <pointLight position={[-3, 2, -2]} intensity={0.6} color="#f4a5ae" />
      <Disc audioRef={audioRef} coverImage={coverImage} />
    </Canvas>
  );
};

export default Vinyl3D;
