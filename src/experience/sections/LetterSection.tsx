import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import type { SectionProps } from "../types";

type ScrollState = ReturnType<typeof useScroll>;

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
const PAPER_GRAIN_SIZE = 256;

// --- Der echte Brief: eine Seite als entfaltender Tri-Fold-Bogen -----------
// Konzept (Runde 3, §1): Held der Szene ist die echte, handschriftliche
// Briefseite als Textur auf einem dreigeteilten 3D-Papierbogen, der sich mit
// dem Scroll entfaltet — statt eines abstrakten Umschlags mit Blanko-Papier.
const LETTER_TEXTURE_URL = `${import.meta.env.BASE_URL}letter-pages/seite-1.jpg`;
// Seitenverhältnis der Original-JPG (935×1228 px) — Bogenmaße daraus
// abgeleitet, damit die Handschrift nicht gestreckt/gestaucht wirkt.
const LETTER_TEXTURE_ASPECT = 935 / 1228;
const SHEET_WIDTH = 1.5;
const SHEET_HEIGHT = SHEET_WIDTH / LETTER_TEXTURE_ASPECT;
const PANEL_HEIGHT = SHEET_HEIGHT / 3;
// Scroll-Fortschritt 0→0.6 entfaltet den Bogen (Plan §1); Ease-out sorgt
// dafür, dass er schon deutlich vor Erreichen von 0.6 lesbar offen wirkt.
const UNFOLD_SPAN = 0.6;
const FOLD_CLOSED_ANGLE = Math.PI;
// Panels bleiben auch voll entfaltet minimal angewinkelt — echtes Papier
// liegt nie hundertprozentig plan.
const FOLD_OPEN_RESIDUAL = 0.05;
const HINGE_Z_BIAS = 0.014;
const PANEL_FACE_GAP = 0.0025;
const SHEET_CENTER_Y = -0.75;

const HEART_COUNT = 4;
const DUST_COUNT = 10;

// Kleiner, geschlossener Umschlag — nur noch dezente Absender-Requisite
// unten rechts hinter dem Bogen, nicht mehr das Zentrum der Szene. Seitlich
// versetzt, damit er neben dem Bogen hervorschaut statt komplett verdeckt zu sein.
const ENVELOPE_SCALE = 0.55;
const ENVELOPE_WIDTH = 2.2 * ENVELOPE_SCALE;
const ENVELOPE_HEIGHT = 1.5 * ENVELOPE_SCALE;
const ENVELOPE_LOCAL_X = 1.05;
const ENVELOPE_LOCAL_Y = -1.72;
const ENVELOPE_LOCAL_Z = -0.4;
const ENVELOPE_FLAP_HALF_WIDTH = ENVELOPE_WIDTH * 0.5;
const ENVELOPE_FLAP_HEIGHT = ENVELOPE_HEIGHT * 0.55;

/** Sehr kontrastarme Papier-Speckle-Textur auf Cremeton — Canvas-Singleton. */
function makePaperGrainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = PAPER_GRAIN_SIZE;
  canvas.height = PAPER_GRAIN_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.fillStyle = "#fdf6ec";
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

/** Flache, dreieckige Klappen-Form: Basis bei y=0 (Scharnier), Spitze bei y=-h. */
function makeFlapShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-width, 0);
  shape.lineTo(width, 0);
  shape.lineTo(0, -height);
  shape.lineTo(-width, 0);
  return shape;
}

// Modul-weit konstant (nur von Konstanten abgeleitet) — keine Neuberechnung
// pro Render nötig.
const envelopeFlapShape = makeFlapShape(
  ENVELOPE_FLAP_HALF_WIDTH,
  ENVELOPE_FLAP_HEIGHT,
);

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
    radius: 1.0 + Math.random() * 0.5,
    height: (Math.random() - 0.5) * 0.9,
    speed: 0.22 + Math.random() * 0.2,
    scale: 0.055 + Math.random() * 0.04,
    phase: Math.random() * Math.PI * 2,
  }));
}

/** 3-4 Herzen, die sanft um den schwebenden Brief driften. */
function FloatingHearts({
  reducedMotion,
  scroll,
  index,
  centerY,
}: {
  reducedMotion: boolean;
  scroll: ScrollState;
  index: number;
  centerY: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeHeartSeeds(HEART_COUNT), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      const a = seed.angle + t * seed.speed;
      dummy.position.set(
        Math.cos(a) * seed.radius,
        centerY + seed.height + Math.sin(t * 0.6 + seed.phase) * 0.15,
        0.5 + Math.sin(a) * 0.4,
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

interface DustSeed {
  angle: number;
  radius: number;
  height: number;
  speed: number;
  scale: number;
  phase: number;
}

function makeDustSeeds(count: number): DustSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + Math.random() * 0.5,
    radius: 0.55 + Math.random() * 0.85,
    height: (Math.random() - 0.5) * 1.3,
    speed: 0.4 + Math.random() * 0.3,
    scale: 0.014 + Math.random() * 0.016,
    phase: Math.random() * Math.PI * 2,
  }));
}

/** Wenige goldene Staub-Partikel, die um den Brief funkeln. */
function GoldDust({
  reducedMotion,
  scroll,
  index,
  centerY,
}: {
  reducedMotion: boolean;
  scroll: ScrollState;
  index: number;
  centerY: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeDustSeeds(DUST_COUNT), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    seeds.forEach((seed, i) => {
      const angle = seed.phase + t * 0.12;
      const twinkle = reducedMotion
        ? 1
        : 0.65 + Math.sin(t * seed.speed + seed.phase) * 0.35;
      dummy.position.set(
        Math.cos(angle) * seed.radius,
        centerY + seed.height + Math.sin(t * 0.3 + seed.phase) * 0.3,
        0.35 + Math.sin(angle) * 0.35,
      );
      dummy.rotation.set(t * 0.5, angle, 0);
      dummy.scale.setScalar(seed.scale * twinkle);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, DUST_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#e8c77d" roughness={0.3} metalness={0.6} />
    </instancedMesh>
  );
}

/**
 * Lädt die eine Brief-Seite und liefert drei unabhängige Textur-Klone
 * (oben/mitte/unten), je mit eigenem UV-Offset/Repeat auf das jeweilige
 * Bilddrittel — Klonen statt Mutieren der geladenen Basistextur, damit kein
 * gemeinsam genutztes Objekt zwischen den drei Panels verändert wird.
 */
function useLetterPanelTextures(): [
  THREE.Texture,
  THREE.Texture,
  THREE.Texture,
] {
  const rawTexture = useLoader(THREE.TextureLoader, LETTER_TEXTURE_URL);

  const panels = useMemo(() => {
    // Bild-V=1 liegt oben (Standard-flipY) → oberes Drittel des Briefs zuerst.
    const offsets: [number, number, number] = [2 / 3, 1 / 3, 0];
    return offsets.map((offsetY) => {
      const clone = rawTexture.clone();
      clone.colorSpace = THREE.SRGBColorSpace;
      clone.repeat.set(1, 1 / 3);
      clone.offset.set(0, offsetY);
      clone.needsUpdate = true;
      return clone;
    }) as [THREE.Texture, THREE.Texture, THREE.Texture];
  }, [rawTexture]);

  useEffect(() => {
    return () => {
      panels.forEach((texture) => texture.dispose());
    };
  }, [panels]);

  return panels;
}

/** Mittleres Panel — bleibt immer flach und lesbar, unabhängig vom Fold-Fortschritt. */
function MiddlePanel({
  frontTexture,
  backTexture,
}: {
  frontTexture: THREE.Texture;
  backTexture: THREE.Texture;
}) {
  return (
    <group>
      <mesh position={[0, 0, PANEL_FACE_GAP]}>
        <planeGeometry args={[SHEET_WIDTH, PANEL_HEIGHT]} />
        <meshStandardMaterial map={frontTexture} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, -PANEL_FACE_GAP]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[SHEET_WIDTH, PANEL_HEIGHT]} />
        <meshStandardMaterial
          map={backTexture}
          bumpMap={backTexture}
          bumpScale={0.02}
          roughness={0.65}
        />
      </mesh>
    </group>
  );
}

/**
 * Oberes oder unteres Drittel des Bogens — an der gemeinsamen Kante mit dem
 * Mittelpanel angeschlagen. Scroll-Progress 0→UNFOLD_SPAN entfaltet von
 * FOLD_CLOSED_ANGLE (flach über dem Mittelpanel gefaltet) zu
 * FOLD_OPEN_RESIDUAL (fast, aber nie ganz plan). Vorder- und Rückseite sind
 * zwei getrennte, einseitige Planes (statt DoubleSide) — so zeigt sich beim
 * gefalteten Zustand automatisch nur die cremefarbene Rückseite, nie
 * gespiegelte Handschrift.
 */
function FoldPanel({
  pivotY,
  extendSign,
  frontTexture,
  backTexture,
  scroll,
  index,
  reducedMotion,
}: {
  pivotY: number;
  extendSign: 1 | -1;
  frontTexture: THREE.Texture;
  backTexture: THREE.Texture;
  scroll: ScrollState;
  index: number;
  reducedMotion: boolean;
}) {
  const hingeRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const hinge = hingeRef.current;
    if (!hinge) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const progress = sectionProgress(scroll, index);
    const linearT = reducedMotion
      ? 1
      : THREE.MathUtils.clamp(progress / UNFOLD_SPAN, 0, 1);
    const easedT = 1 - Math.pow(1 - linearT, 3);
    const targetAngle = THREE.MathUtils.lerp(
      FOLD_CLOSED_ANGLE,
      FOLD_OPEN_RESIDUAL,
      easedT,
    );
    hinge.rotation.x = THREE.MathUtils.damp(
      hinge.rotation.x,
      targetAngle,
      6,
      delta,
    );
  });

  return (
    <group
      ref={hingeRef}
      position={[0, pivotY, extendSign * HINGE_Z_BIAS]}
      rotation={[FOLD_CLOSED_ANGLE, 0, 0]}
    >
      <mesh position={[0, extendSign * (PANEL_HEIGHT / 2), PANEL_FACE_GAP]}>
        <planeGeometry args={[SHEET_WIDTH, PANEL_HEIGHT]} />
        <meshStandardMaterial map={frontTexture} roughness={0.8} />
      </mesh>
      <mesh
        position={[0, extendSign * (PANEL_HEIGHT / 2), -PANEL_FACE_GAP]}
        rotation={[0, Math.PI, 0]}
      >
        <planeGeometry args={[SHEET_WIDTH, PANEL_HEIGHT]} />
        <meshStandardMaterial
          map={backTexture}
          bumpMap={backTexture}
          bumpScale={0.02}
          roughness={0.65}
        />
      </mesh>
    </group>
  );
}

/** Der gesamte Tri-Fold-Bogen: Mittelpanel (statisch) + zwei Fold-Panels, schwebend. */
function FoldedLetterSheet({
  scroll,
  index,
  reducedMotion,
}: {
  scroll: ScrollState;
  index: number;
  reducedMotion: boolean;
}) {
  const [topTexture, middleTexture, bottomTexture] = useLetterPanelTextures();
  const grainTexture = getPaperGrainTexture();
  const sheetRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    sheet.position.y = SHEET_CENTER_Y + Math.sin(t * 0.5) * 0.045;
    sheet.rotation.z = Math.sin(t * 0.33 + 1.1) * 0.02;
  });

  return (
    <group
      ref={sheetRef}
      position={[0, SHEET_CENTER_Y, 0]}
      rotation={[0.05, -0.05, 0]}
    >
      <MiddlePanel frontTexture={middleTexture} backTexture={grainTexture} />
      <FoldPanel
        pivotY={PANEL_HEIGHT / 2}
        extendSign={1}
        frontTexture={topTexture}
        backTexture={grainTexture}
        scroll={scroll}
        index={index}
        reducedMotion={reducedMotion}
      />
      <FoldPanel
        pivotY={-PANEL_HEIGHT / 2}
        extendSign={-1}
        frontTexture={bottomTexture}
        backTexture={grainTexture}
        scroll={scroll}
        index={index}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}

/** Kleiner, dauerhaft geschlossener Umschlag mit Wachssiegel — dezente Requisite. */
function EnvelopeProp() {
  const grainTexture = getPaperGrainTexture();

  return (
    <group
      position={[ENVELOPE_LOCAL_X, ENVELOPE_LOCAL_Y, ENVELOPE_LOCAL_Z]}
      // Negative x-Neigung: der Umschlag steht unterhalb der Kamera-Achse,
      // erst so zeigt seine Vorderseite (Klappe + Siegel) zur Kamera.
      rotation={[-0.12, -0.2, -0.08]}
    >
      {/* Innenfütterung (etwas dunkleres Creme) */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.05]} />
        <meshStandardMaterial color="#f0e4d0" roughness={0.75} />
      </mesh>

      {/* Vorderseite mit feinem Papierkorn */}
      <mesh position={[0, 0, 0.012]}>
        <boxGeometry args={[ENVELOPE_WIDTH, ENVELOPE_HEIGHT, 0.016]} />
        <meshStandardMaterial
          color="#ffffff"
          map={grainTexture}
          bumpMap={grainTexture}
          bumpScale={0.02}
          roughness={0.65}
        />
      </mesh>

      {/* Geschlossene Dreiecksklappe — statisch, keine Öffnungsanimation mehr.
          Etwas dunkleres Creme als die Vorderseite, damit das Dreieck lesbar bleibt. */}
      <group position={[0, ENVELOPE_HEIGHT / 2, 0.022]}>
        <mesh>
          <shapeGeometry args={[envelopeFlapShape]} />
          <meshStandardMaterial
            color="#f3e6d0"
            map={grainTexture}
            bumpMap={grainTexture}
            bumpScale={0.02}
            roughness={0.65}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Wachssiegel an der Klappenspitze — Zylinder um x=PI/2 gedreht,
            damit die runde Siegelfläche zur Kamera zeigt (nicht die Kante). */}
        <mesh
          position={[0, -ENVELOPE_HEIGHT * 0.42, 0.02]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.1, 0.1, 0.03, 24]} />
          <meshStandardMaterial
            color="#e07186"
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>
        <mesh
          position={[0, -ENVELOPE_HEIGHT * 0.42, 0.04]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.055, 0.055, 0.008, 24]} />
          <meshStandardMaterial color="#c85a6b" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

export const LetterScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const shadowTexture = getSoftShadowTexture();

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    root.visible = sectionVisibility(scroll, index) > 0.01;
  });

  return (
    <group ref={rootRef} position={[0, -0.1, 0]}>
      {/* Weicher Kontaktschatten unter der gesamten Komposition */}
      <mesh
        position={[0.3, ENVELOPE_LOCAL_Y - ENVELOPE_HEIGHT * 0.65, -0.45]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[3.0, 1.9]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.32}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <EnvelopeProp />

      <Suspense fallback={null}>
        <FoldedLetterSheet
          scroll={scroll}
          index={index}
          reducedMotion={reducedMotion}
        />
      </Suspense>

      <FloatingHearts
        reducedMotion={reducedMotion}
        scroll={scroll}
        index={index}
        centerY={SHEET_CENTER_Y}
      />
      <GoldDust
        reducedMotion={reducedMotion}
        scroll={scroll}
        index={index}
        centerY={SHEET_CENTER_Y}
      />
    </group>
  );
};

export const LetterHtml = ({ onOpenLetter }: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 3</span>
    <h2 className="exp-title">Ein Brief für dich</h2>
    <p className="exp-subtitle">Handgeschrieben. Von mir, für dich.</p>
    <button className="exp-btn primary" onClick={onOpenLetter}>
      Brief lesen
    </button>
  </div>
);
