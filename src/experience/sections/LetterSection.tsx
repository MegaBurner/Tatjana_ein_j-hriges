import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import { usePrefersReducedMotion } from '../../three/hooks/useWebGL';
import { getSoftShadowTexture } from '../softShadow';
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
const PAPER_GRAIN_SIZE = 256;

interface LetterLine {
  y: number;
  width: number;
}

const LETTER_LINES: LetterLine[] = [
  { y: 0.34, width: 0.62 },
  { y: 0.24, width: 0.5 },
  { y: 0.14, width: 0.58 },
  { y: 0.04, width: 0.4 },
  { y: -0.06, width: 0.55 },
  { y: -0.16, width: 0.36 },
  { y: -0.26, width: 0.5 },
];

/** Sehr kontrastarme Papier-Speckle-Textur auf Cremeton — Canvas-Singleton. */
function makePaperGrainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PAPER_GRAIN_SIZE;
  canvas.height = PAPER_GRAIN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.fillStyle = '#fdf6ec';
  ctx.fillRect(0, 0, PAPER_GRAIN_SIZE, PAPER_GRAIN_SIZE);
  const imageData = ctx.getImageData(0, 0, PAPER_GRAIN_SIZE, PAPER_GRAIN_SIZE);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const speckle = (Math.random() - 0.5) * 14;
    data[i] = THREE.MathUtils.clamp(data[i] + speckle, 0, 255);
    data[i + 1] = THREE.MathUtils.clamp(data[i + 1] + speckle, 0, 255);
    data[i + 2] = THREE.MathUtils.clamp(data[i + 2] + speckle, 0, 255);
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

let paperGrainTexture: THREE.CanvasTexture | null = null;
function getPaperGrainTexture(): THREE.CanvasTexture {
  paperGrainTexture ??= makePaperGrainTexture();
  return paperGrainTexture;
}

interface FlapEdgeTrim {
  length: number;
  angle: number;
  midX: number;
  midY: number;
}

/** Zwei dünne Gold-Randlinien entlang der oberen (schrägen) Kanten der Dreiecksklappe. */
function makeFlapEdgeTrims(halfWidth: number, height: number): [FlapEdgeTrim, FlapEdgeTrim] {
  const length = Math.sqrt(halfWidth * halfWidth + height * height);
  const angleLeft = Math.atan2(-height, halfWidth);
  const angleRight = Math.atan2(-height, -halfWidth);
  return [
    { length, angle: angleLeft, midX: -halfWidth / 2, midY: -height / 2 },
    { length, angle: angleRight, midX: halfWidth / 2, midY: -height / 2 },
  ];
}

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
      {LETTER_LINES.map((line, i) => (
        <mesh key={i} position={[0, line.y, 0.012]}>
          <boxGeometry args={[ENVELOPE_WIDTH * line.width, 0.012, 0.001]} />
          <meshStandardMaterial color="#e8c77d" roughness={0.5} transparent opacity={0.65} />
        </mesh>
      ))}
      {/* Kleines Rosa-Herz als Signatur, unten rechts */}
      <mesh
        position={[ENVELOPE_WIDTH * 0.3, -ENVELOPE_HEIGHT * 0.32, 0.014]}
        rotation={[0, 0, Math.PI / 4]}
        scale={0.05}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#e07186" roughness={0.4} />
      </mesh>
    </group>
  );
}

export const LetterScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const flapRef = useRef<THREE.Group>(null);
  const flapHalfWidth = ENVELOPE_WIDTH * 0.5;
  const flapHeight = ENVELOPE_HEIGHT * 0.55;
  const flapShape = useMemo(() => makeFlapShape(flapHalfWidth, flapHeight), [flapHalfWidth, flapHeight]);
  const flapTrims = useMemo(
    () => makeFlapEdgeTrims(flapHalfWidth, flapHeight),
    [flapHalfWidth, flapHeight]
  );
  const grainTexture = getPaperGrainTexture();
  const shadowTexture = getSoftShadowTexture();

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
      {/* Weicher Kontaktschatten unter dem Umschlag */}
      <mesh position={[0, -ENVELOPE_HEIGHT * 0.7, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.4, 1.8]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Umschlagkörper (dunkleres Creme als Innenfütterung) */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.06]} />
        <meshStandardMaterial color="#f0e4d0" roughness={0.75} />
      </mesh>

      <Letter scroll={scroll} index={index} />

      {/* Vorderseite des Umschlags — mit feinem Papierkorn (Map + Bump) */}
      <mesh position={[0, 0, 0.015]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.02]} />
        <meshStandardMaterial
          color="#ffffff"
          map={grainTexture}
          bumpMap={grainTexture}
          bumpScale={0.02}
          roughness={0.65}
        />
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
          <meshStandardMaterial
            color="#ffffff"
            map={grainTexture}
            bumpMap={grainTexture}
            bumpScale={0.02}
            roughness={0.65}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Dünne Gold-Ränder entlang der beiden oberen (schrägen) Klappenkanten */}
        {flapTrims.map((trim, i) => (
          <mesh key={i} position={[trim.midX, trim.midY, 0.004]} rotation={[0, 0, trim.angle]}>
            <boxGeometry args={[trim.length, 0.02, 0.006]} />
            <meshStandardMaterial color="#e8c77d" roughness={0.35} metalness={0.5} />
          </mesh>
        ))}
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
