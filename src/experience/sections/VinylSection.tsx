import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useScroll, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import type { SectionProps } from "../types";

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Winkel-/Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
const PLAY_SPEED = 1.6; // rad/s
const REST_ANGLE = -0.85;
const PLAY_ANGLE = 0;
const ARM_REST_Y = 0.06;
const ARM_PLAY_Y = 0.015;

/** Konzentrische Rillen als Bump-Map, einmalig Canvas-generiert (siehe src/three/Vinyl3D.tsx). */
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
  for (let r = 40; r < size / 2 - 4; r += 3) {
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
  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);
  return (
    <mesh position={[0, 0.019, 0]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[0.42, 48]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

function Disc({
  audioRef,
  coverImage,
  index,
}: {
  audioRef: SectionProps["audioRef"];
  coverImage: string;
  index: number;
}) {
  const scroll = useScroll();
  const spinRef = useRef<THREE.Group>(null);
  const speed = useRef(0);
  const grooves = getGrooveTexture();

  useFrame((_, delta) => {
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
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
  });

  return (
    <group ref={spinRef} position={[0, 0.045, 0]}>
      <mesh>
        <cylinderGeometry args={[1.02, 1.02, 0.035, 64]} />
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
      <Suspense fallback={null}>
        <CoverLabel coverImage={coverImage} />
      </Suspense>
      <mesh position={[0, 0.021, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.04, 24]} />
        <meshBasicMaterial color="#0a0a0a" />
      </mesh>
    </group>
  );
}

function Tonearm({
  audioRef,
  index,
}: {
  audioRef: SectionProps["audioRef"];
  index: number;
}) {
  const scroll = useScroll();
  const armRef = useRef<THREE.Group>(null);
  const angle = useRef(REST_ANGLE);
  const armY = useRef(ARM_REST_Y);

  useFrame((_, delta) => {
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const isPlaying = audioRef.current ? !audioRef.current.paused : false;
    const targetAngle = isPlaying ? PLAY_ANGLE : REST_ANGLE;
    const targetY = isPlaying ? ARM_PLAY_Y : ARM_REST_Y;
    angle.current = THREE.MathUtils.damp(
      angle.current,
      targetAngle,
      2.5,
      delta,
    );
    armY.current = THREE.MathUtils.damp(armY.current, targetY, 2.5, delta);
    if (armRef.current) {
      armRef.current.rotation.y = angle.current;
      armRef.current.position.y = armY.current;
    }
  });

  return (
    <group position={[1.4, 0.03, -0.55]}>
      <mesh>
        <cylinderGeometry args={[0.08, 0.09, 0.05, 20]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.3} metalness={0.6} />
      </mesh>
      <group ref={armRef}>
        <mesh position={[-0.55, 0.025, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.018, 0.018, 1.1, 10]} />
          <meshStandardMaterial
            color="#2f2f2f"
            roughness={0.4}
            metalness={0.5}
          />
        </mesh>
        <mesh position={[-1.13, 0.015, 0]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.16, 0.05, 0.1]} />
          <meshStandardMaterial color="#232323" roughness={0.5} />
        </mesh>
        {/* Rote Nadeleinheit an der Kopfshell-Spitze — sichtbares "Needle Drop"-Detail */}
        <mesh position={[-1.21, 0.005, 0]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.05, 0.03, 0.06]} />
          <meshStandardMaterial color="#c0392b" roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

export const VinylScene = ({ audioRef, currentSong, index }: SectionProps) => {
  const scroll = useScroll();
  const rootRef = useRef<THREE.Group>(null);
  const platterGroupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (root) {
      const vis = sectionVisibility(scroll, index);
      root.visible = vis > 0.01;
    }
    const platterGroup = platterGroupRef.current;
    if (platterGroup) {
      const progress = sectionProgress(scroll, index);
      const t = THREE.MathUtils.clamp(progress / 0.5, 0, 1);
      const targetScale = 0.85 + t * 0.15;
      const targetY = -0.05 + t * 0.08;
      platterGroup.scale.setScalar(
        THREE.MathUtils.damp(platterGroup.scale.x, targetScale, 5, delta),
      );
      platterGroup.position.y = THREE.MathUtils.damp(
        platterGroup.position.y,
        targetY,
        5,
        delta,
      );
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.2, 0]}>
      <group rotation={[0.45, 0, 0]}>
        <RoundedBox
          args={[3.0, 0.32, 2.3]}
          radius={0.06}
          smoothness={4}
          position={[0, -0.16, 0]}
        >
          <meshStandardMaterial
            color="#3b2a20"
            roughness={0.65}
            metalness={0.05}
          />
        </RoundedBox>

        <group ref={platterGroupRef}>
          <mesh>
            <cylinderGeometry args={[1.15, 1.15, 0.05, 64]} />
            <meshStandardMaterial
              color="#c8c8ca"
              roughness={0.3}
              metalness={0.85}
            />
          </mesh>
          <Disc
            audioRef={audioRef}
            coverImage={currentSong.cover}
            index={index}
          />
        </group>

        <Tonearm audioRef={audioRef} index={index} />

        {/* Gold-Geschwindigkeitsregler */}
        <mesh position={[-1.15, 0.03, 0.85]}>
          <cylinderGeometry args={[0.09, 0.09, 0.05, 24]} />
          <meshStandardMaterial
            color="#e8c77d"
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
      </group>
    </group>
  );
};

export const VinylHtml = ({
  audioRef,
  onNextSong,
  onPrevSong,
  currentSong,
  isPlaying,
}: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: "8vh" }}>
    <span className="exp-kicker">Kapitel 2</span>
    <h2 className="exp-title">Unsere Songs</h2>
    <p className="exp-subtitle">{currentSong.title}</p>
    <div style={{ display: "flex", gap: "0.75rem" }}>
      <button
        className="exp-btn"
        onClick={onPrevSong}
        aria-label="Vorheriger Song"
      >
        ‹
      </button>
      <button
        className="exp-btn primary"
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
      >
        {isPlaying ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button
        className="exp-btn"
        onClick={onNextSong}
        aria-label="Nächster Song"
      >
        ›
      </button>
    </div>
  </div>
);
