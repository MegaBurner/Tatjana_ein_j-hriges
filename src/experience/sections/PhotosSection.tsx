import {
  Suspense,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { getSoftShadowTexture } from "../softShadow";
import { getBookPage, setBookPage, subscribeBookPage } from "../bookStore";
import type { SectionProps } from "../types";

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
/** Ab dieser Annäherung an Section 1 werden die Buch-Fotos erst geladen (Ziel 6). */
const NEAR_THRESHOLD = 0.05;

const PAGE_WIDTH = 1.2;
const PAGE_HEIGHT = 1.6;
const COVER_OPEN_SPAN = 0.25;

// Web-optimierte Kopien (max. 1600px, ~2,4 MB gesamt statt 12,6 MB Originale)
const PHOTO_FILES = [
  "IMG_4891.jpg",
  "IMG_4909.jpg",
  "IMG_4913.jpg",
  "IMG_5006.jpg",
  "IMG_6280.jpg",
  "IMG_7321.jpg",
  "IMG_7411.jpg",
  "IMG_8099.jpg",
];

const PHOTO_URLS = PHOTO_FILES.map(
  (file) => `${import.meta.env.BASE_URL}memories/web/${file}`,
);

/** 4 Doppelseiten (2 Fotos je Seite) — Grenze für manuelles Blättern. */
const PAGE_COUNT = PHOTO_FILES.length / 2;

function clampPage(p: number): number {
  return Math.max(0, Math.min(PAGE_COUNT, p));
}

function markSRGB(textures: THREE.Texture[]) {
  textures.forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
}

function Page({
  front,
  back,
  pageIndex,
  index,
}: {
  front: THREE.Texture;
  back: THREE.Texture;
  pageIndex: number;
  index: number;
}) {
  const scroll = useScroll();
  const hingeRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const hinge = hingeRef.current;
    if (!hinge) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    // Manuelles Blättern: Seite ist umgeschlagen, sobald ihr Index vor der
    // per Button gesetzten Zielseite liegt (statt scroll-getriebenem Fortschritt).
    const flipped = pageIndex < getBookPage();
    const target = flipped ? -Math.PI : 0;
    hinge.rotation.y = THREE.MathUtils.damp(
      hinge.rotation.y,
      target,
      4.5,
      delta,
    );
    // Z-Anhebung während des Umblätterns — `local` als Fortschritt 0..1
    // aus dem gedämpften Rotationswinkel selbst abgeleitet (keine Scroll-Progress mehr).
    const local = Math.abs(hinge.rotation.y) / Math.PI;
    hinge.position.z =
      0.03 - (pageIndex + 1) * 0.012 + Math.sin(local * Math.PI) * 0.02;
  });

  return (
    <group ref={hingeRef}>
      {/* Weißer Polaroid-Rahmen hinter jedem Foto — deutet Seitenkarton/-tiefe an */}
      <mesh position={[PAGE_WIDTH / 2, 0, 0.0004]}>
        <planeGeometry args={[PAGE_WIDTH * 1.06, PAGE_HEIGHT * 1.06]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>
      <mesh position={[PAGE_WIDTH / 2, 0, 0.001]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={front} />
      </mesh>
      <mesh position={[PAGE_WIDTH / 2, 0, -0.0004]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[PAGE_WIDTH * 1.06, PAGE_HEIGHT * 1.06]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>
      <mesh position={[PAGE_WIDTH / 2, 0, -0.001]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={back} />
      </mesh>
    </group>
  );
}

function PhotoPages({ index }: { index: number }) {
  const textures = useTexture(PHOTO_URLS, markSRGB);
  const pages = useMemo(() => {
    const result: { front: THREE.Texture; back: THREE.Texture }[] = [];
    for (let i = 0; i < textures.length; i += 2) {
      result.push({ front: textures[i], back: textures[i + 1] });
    }
    return result;
  }, [textures]);

  return (
    <>
      {pages.map((page, i) => (
        <Page
          key={i}
          front={page.front}
          back={page.back}
          pageIndex={i}
          index={index}
        />
      ))}
    </>
  );
}

export const PhotosScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const rootRef = useRef<THREE.Group>(null);
  const coverRef = useRef<THREE.Group>(null);
  const shadowTexture = getSoftShadowTexture();
  // Buch-Fotos laden erst bei Annäherung an die Section, nicht beim App-Start
  // (Ziel 6): einmaliger, gegen Mehrfach-Zündung abgesicherter State-Wechsel
  // aus useFrame heraus.
  const [nearBook, setNearBook] = useState(false);
  const nearRef = useRef(false);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (root) {
      const vis = sectionVisibility(scroll, index);
      root.visible = vis > 0.01;
      if (!nearRef.current && vis > NEAR_THRESHOLD) {
        nearRef.current = true;
        setNearBook(true);
      }
    }
    const cover = coverRef.current;
    if (cover) {
      const progress = sectionProgress(scroll, index);
      const coverT = THREE.MathUtils.clamp(progress / COVER_OPEN_SPAN, 0, 1);
      cover.rotation.y = THREE.MathUtils.damp(
        cover.rotation.y,
        -coverT * Math.PI,
        6,
        delta,
      );
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.3, 0]} rotation={[-0.35, 0.12, 0]}>
      {/* Weicher Kontaktschatten unter dem gesamten Buch */}
      <mesh
        position={[PAGE_WIDTH / 2, -(PAGE_HEIGHT / 2 + 0.18), -0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[2.6, 2.0]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Buchrücken */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[0.05, PAGE_HEIGHT + 0.1, 0.12]} />
        <meshStandardMaterial
          color="#e8c77d"
          roughness={0.4}
          metalness={0.15}
        />
      </mesh>

      {/* Rückseitiger Einband (statisch) */}
      <mesh position={[PAGE_WIDTH / 2, 0, -0.048]}>
        <boxGeometry args={[PAGE_WIDTH + 0.1, PAGE_HEIGHT + 0.1, 0.03]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.6} />
      </mesh>
      <mesh position={[PAGE_WIDTH / 2, 0, -0.066]}>
        <boxGeometry args={[PAGE_WIDTH + 0.14, PAGE_HEIGHT + 0.14, 0.02]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.4} metalness={0.2} />
      </mesh>

      {nearBook && (
        <Suspense fallback={null}>
          <PhotoPages index={index} />
        </Suspense>
      )}

      {/* Vorderer Einband (öffnet sich) — Creme-Gold-Creme-Sandwich, damit sowohl
          die geschlossene Außenseite als auch die geöffnete Innenseite cremefarben
          bleiben; das Gold schimmert nur als dünner Rand durch (siehe Fix 3). */}
      <group ref={coverRef}>
        <mesh position={[PAGE_WIDTH / 2, 0, 0.036]}>
          <boxGeometry args={[PAGE_WIDTH + 0.1, PAGE_HEIGHT + 0.1, 0.03]} />
          <meshStandardMaterial color="#fdf6ec" roughness={0.55} />
        </mesh>
        <mesh position={[PAGE_WIDTH / 2, 0, 0.02]}>
          <boxGeometry args={[PAGE_WIDTH + 0.14, PAGE_HEIGHT + 0.14, 0.012]} />
          <meshStandardMaterial
            color="#e8c77d"
            roughness={0.4}
            metalness={0.2}
          />
        </mesh>
        <mesh position={[PAGE_WIDTH / 2, 0, 0.006]}>
          <boxGeometry args={[PAGE_WIDTH + 0.1, PAGE_HEIGHT + 0.1, 0.01]} />
          <meshStandardMaterial color="#fdf6ec" roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
};

export const PhotosHtml = () => {
  const page = useSyncExternalStore(subscribeBookPage, getBookPage);
  const spreadCount = PAGE_COUNT + 1;
  const isFirst = page <= 0;
  const isLast = page >= PAGE_COUNT;

  return (
    <div className="exp-content" style={{ paddingTop: "10vh" }}>
      <span className="exp-kicker">Kapitel 1</span>
      <h2 className="exp-title">Unser Jahr in Bildern</h2>
      <p className="exp-subtitle">
        Ein Fotobuch voller Erinnerungen — blättere durch.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: isFirst ? 0.4 : 1 }}
          disabled={isFirst}
          onClick={() => setBookPage(clampPage(page - 1))}
          aria-label="Zurück blättern"
        >
          ‹ Zurück blättern
        </button>
        <span className="exp-subtitle" style={{ opacity: 0.75 }}>
          Seite {page + 1} / {spreadCount}
        </span>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: isLast ? 0.4 : 1 }}
          disabled={isLast}
          onClick={() => setBookPage(clampPage(page + 1))}
          aria-label="Weiterblättern"
        >
          Weiterblättern ›
        </button>
      </div>
    </div>
  );
};
