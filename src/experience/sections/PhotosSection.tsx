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
import { sectionVisibility } from "../useSectionProgress";
import { getSoftShadowTexture } from "../softShadow";
import { getBookPage, setBookPage, subscribeBookPage } from "../bookStore";
import type { SectionProps } from "../types";

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;
/** Ab dieser Annäherung an Section 1 werden die Buch-Fotos erst geladen (Ziel 6). */
const NEAR_THRESHOLD = 0.05;

// Buchbinderei-Maße: Rücken bei x=0, eine Seite hängt links (x<0), eine
// rechts (x>0) davon — das Buch liegt von Anfang an AUFGESCHLAGEN, kein
// geschlossener Deckel, der erst per Scroll geöffnet werden müsste.
const PAGE_W = 1.15;
const PAGE_H = 1.5;

// Rahmen-Inset, in das jedes Foto per Aspect-Fit eingepasst wird: nie
// größer als die Seite, nie verzerrt, ringsum bleibt cremefarbener Rand
// sichtbar (das "hängt am Buch"-Gefühl).
const PHOTO_INSET_W = PAGE_W - 0.16;
const PHOTO_INSET_H = PAGE_H - 0.2;

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

/** Jede Doppelseite zeigt genau EIN Foto links und EIN Foto rechts — jedes
 *  Foto bekommt so seine eigene Seite, keine gepaarten Vorder-/Rückseiten. */
const SPREAD_COUNT = PHOTO_FILES.length / 2;

function clampSpread(s: number): number {
  return Math.max(0, Math.min(SPREAD_COUNT - 1, s));
}

function markSRGB(textures: THREE.Texture[]) {
  textures.forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
}

interface PhotoFit {
  width: number;
  height: number;
}

/**
 * Aspect-Fit (contain) eines Fotos in den Seiten-Rahmen: liest die reale
 * Pixelgröße aus `texture.image` — nach useTexture/Suspense vorhanden, aber
 * defensiv gegen `undefined` abgesichert — und skaliert beide Achsen mit
 * demselben Faktor, sodass das Foto nie gestreckt und nie größer als der
 * Rahmen wird. Ohne verfügbare Bildmaße fällt es auf Rahmengröße zurück.
 */
function fitPhotoToInset(texture: THREE.Texture): PhotoFit {
  const image = texture.image as
    { width?: number; height?: number } | undefined;
  const texW = image?.width;
  const texH = image?.height;
  if (!texW || !texH) {
    return { width: PHOTO_INSET_W, height: PHOTO_INSET_H };
  }
  const scale = Math.min(PHOTO_INSET_W / texW, PHOTO_INSET_H / texH);
  return { width: texW * scale, height: texH * scale };
}

/**
 * Eine offene Buchseite (links ODER rechts vom Rücken): cremefarbene
 * Seiten-Plane in voller Seitengröße, darauf als Kind die Foto-Plane mit
 * z-Offset +0.002 und Aspect-Fit-Größe — das Foto sitzt sichtbar MIT Rand
 * auf der Seite, nie größer als die Seite, nie verzerrt.
 */
function OpenPage({
  texture,
  fit,
  side,
}: {
  texture: THREE.Texture;
  fit: PhotoFit;
  side: "left" | "right";
}) {
  const sign = side === "right" ? 1 : -1;
  return (
    <group position={[sign * (PAGE_W / 2), 0, 0.001]}>
      <mesh>
        <planeGeometry args={[PAGE_W, PAGE_H]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[fit.width, fit.height]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

/**
 * Die aktuell aufgeschlagene Doppelseite: liest den Spread-Index reaktiv aus
 * dem bookStore (manuelles Blättern über die Buttons in PhotosHtml) und
 * zeigt links/rechts je ein eigenes Foto. Ein kurzer, gedämpfter
 * Scale-Pop markiert den Seitenwechsel, ohne dass Vorder-/Rückseiten-Flips
 * simuliert werden müssen.
 */
function PhotoPages({ index }: { index: number }) {
  const scroll = useScroll();
  const textures = useTexture(PHOTO_URLS, markSRGB);
  const spread = clampSpread(
    useSyncExternalStore(subscribeBookPage, getBookPage),
  );
  const pagesRef = useRef<THREE.Group>(null);
  const lastSpreadRef = useRef(spread);
  const revealRef = useRef(1);

  const leftTexture = textures[spread * 2];
  const rightTexture = textures[spread * 2 + 1];
  const leftFit = useMemo(() => fitPhotoToInset(leftTexture), [leftTexture]);
  const rightFit = useMemo(() => fitPhotoToInset(rightTexture), [rightTexture]);

  useFrame((_, delta) => {
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    if (lastSpreadRef.current !== spread) {
      lastSpreadRef.current = spread;
      revealRef.current = 0;
    }
    revealRef.current = THREE.MathUtils.damp(revealRef.current, 1, 6, delta);
    const pages = pagesRef.current;
    if (pages) {
      pages.scale.setScalar(0.94 + 0.06 * revealRef.current);
    }
  });

  return (
    <group ref={pagesRef}>
      <OpenPage texture={leftTexture} fit={leftFit} side="left" />
      <OpenPage texture={rightTexture} fit={rightFit} side="right" />
    </group>
  );
}

export const PhotosScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const rootRef = useRef<THREE.Group>(null);
  const shadowTexture = getSoftShadowTexture();
  // Buch-Fotos laden erst bei Annäherung an die Section, nicht beim App-Start
  // (Ziel 6): einmaliger, gegen Mehrfach-Zündung abgesicherter State-Wechsel
  // aus useFrame heraus.
  const [nearBook, setNearBook] = useState(false);
  const nearRef = useRef(false);

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    if (!nearRef.current && vis > NEAR_THRESHOLD) {
      nearRef.current = true;
      setNearBook(true);
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.5, 0]} rotation={[-0.3, 0.1, 0]}>
      {/* Weicher Kontaktschatten unter dem gesamten aufgeschlagenen Buch */}
      <mesh
        position={[0, -(PAGE_H / 2 + 0.18), -0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[3.4, 2.0]} />
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
        <boxGeometry args={[0.05, PAGE_H + 0.1, 0.12]} />
        <meshStandardMaterial
          color="#e8c77d"
          roughness={0.4}
          metalness={0.15}
        />
      </mesh>

      {/* Bindung/Rückwand — spannt symmetrisch über die gesamte offene
          Doppelseite und gibt dem Buch als Ganzes einen sichtbar
          gebundenen Rahmen, statt zweier loser Karten. */}
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[2 * PAGE_W + 0.16, PAGE_H + 0.14, 0.03]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, -0.03]}>
        <boxGeometry args={[2 * PAGE_W + 0.1, PAGE_H + 0.1, 0.02]} />
        <meshStandardMaterial color="#fdf6ec" roughness={0.6} />
      </mesh>

      {/* Papierstapel-Detail je Seite: dünne cremefarbene Box unter jeder
          Buchhälfte, deutet die restlichen (nicht einzeln modellierten)
          Seiten als geschlossenen Papierblock an — gibt dem Buch sichtbare
          Tiefe statt nur flach wirkender Karten. */}
      <mesh position={[PAGE_W / 2, 0, -0.012]}>
        <boxGeometry args={[PAGE_W, PAGE_H, 0.02]} />
        <meshStandardMaterial color="#f3ead2" roughness={0.85} />
      </mesh>
      <mesh position={[-PAGE_W / 2, 0, -0.012]}>
        <boxGeometry args={[PAGE_W, PAGE_H, 0.02]} />
        <meshStandardMaterial color="#f3ead2" roughness={0.85} />
      </mesh>

      {nearBook && (
        <Suspense fallback={null}>
          <PhotoPages index={index} />
        </Suspense>
      )}
    </group>
  );
};

export const PhotosHtml = () => {
  const spread = clampSpread(
    useSyncExternalStore(subscribeBookPage, getBookPage),
  );
  const isFirst = spread <= 0;
  const isLast = spread >= SPREAD_COUNT - 1;

  return (
    <div className="exp-content" style={{ paddingTop: "9vh" }}>
      <span className="exp-kicker">Kapitel 1</span>
      <h2 className="exp-title">Ein schönes Jahr mit der schönsten Person</h2>
      <p className="exp-subtitle">
        Unser Jahr, Seite für Seite.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: isFirst ? 0.4 : 1 }}
          disabled={isFirst}
          onClick={() => setBookPage(clampSpread(spread - 1))}
          aria-label="Zurück blättern"
        >
          ‹ Zurück blättern
        </button>
        <span className="exp-subtitle" style={{ opacity: 0.75 }}>
          Seite {spread + 1} / {SPREAD_COUNT}
        </span>
        <button
          type="button"
          className="exp-btn"
          style={{ opacity: isLast ? 0.4 : 1 }}
          disabled={isLast}
          onClick={() => setBookPage(clampSpread(spread + 1))}
          aria-label="Weiterblättern"
        >
          Weiterblättern ›
        </button>
      </div>
    </div>
  );
};
