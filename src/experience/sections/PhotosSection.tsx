import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { sectionProgress, sectionVisibility } from '../useSectionProgress';
import type { SectionProps } from '../types';

type ScrollState = ReturnType<typeof useScroll>;

const PAGE_WIDTH = 1.2;
const PAGE_HEIGHT = 1.6;
const COVER_OPEN_SPAN = 0.25;

// Web-optimierte Kopien (max. 1600px, ~2,4 MB gesamt statt 12,6 MB Originale)
const PHOTO_FILES = [
  'IMG_4891.jpg',
  'IMG_4909.jpg',
  'IMG_4913.jpg',
  'IMG_5006.jpg',
  'IMG_6280.jpg',
  'IMG_7321.jpg',
  'IMG_7411.jpg',
  'IMG_8099.jpg',
];

const PHOTO_URLS = PHOTO_FILES.map((file) => `${import.meta.env.BASE_URL}memories/web/${file}`);

function markSRGB(textures: THREE.Texture[]) {
  textures.forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
}

function Page({
  front,
  back,
  pageIndex,
  pageCount,
  scroll,
  sectionIndex,
}: {
  front: THREE.Texture;
  back: THREE.Texture;
  pageIndex: number;
  pageCount: number;
  scroll: ScrollState;
  sectionIndex: number;
}) {
  const hingeRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const hinge = hingeRef.current;
    if (!hinge) return;
    const progress = sectionProgress(scroll, sectionIndex);
    const flipSpan = (1 - COVER_OPEN_SPAN) / pageCount;
    const start = COVER_OPEN_SPAN + pageIndex * flipSpan;
    const local = THREE.MathUtils.clamp((progress - start) / flipSpan, 0, 1);
    hinge.rotation.y = THREE.MathUtils.damp(hinge.rotation.y, -local * Math.PI, 6, delta);
    hinge.position.z =
      0.03 - (pageIndex + 1) * 0.012 + Math.sin(local * Math.PI) * 0.02;
  });

  return (
    <group ref={hingeRef}>
      <mesh position={[PAGE_WIDTH / 2, 0, 0.001]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={front} />
      </mesh>
      <mesh position={[PAGE_WIDTH / 2, 0, -0.001]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={back} />
      </mesh>
    </group>
  );
}

function PhotoPages({ scroll, sectionIndex }: { scroll: ScrollState; sectionIndex: number }) {
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
          pageCount={pages.length}
          scroll={scroll}
          sectionIndex={sectionIndex}
        />
      ))}
    </>
  );
}

export const PhotosScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const rootRef = useRef<THREE.Group>(null);
  const coverRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (root) {
      const vis = sectionVisibility(scroll, index);
      root.visible = vis > 0.01;
    }
    const cover = coverRef.current;
    if (cover) {
      const progress = sectionProgress(scroll, index);
      const coverT = THREE.MathUtils.clamp(progress / COVER_OPEN_SPAN, 0, 1);
      cover.rotation.y = THREE.MathUtils.damp(cover.rotation.y, -coverT * Math.PI, 6, delta);
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.3, 0]} rotation={[-0.35, 0.12, 0]}>
      {/* Buchrücken */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[0.05, PAGE_HEIGHT + 0.1, 0.12]} />
        <meshStandardMaterial color="#e8c77d" roughness={0.4} metalness={0.15} />
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

      <Suspense fallback={null}>
        <PhotoPages scroll={scroll} sectionIndex={index} />
      </Suspense>

      {/* Vorderer Einband (öffnet sich) */}
      <group ref={coverRef}>
        <mesh position={[PAGE_WIDTH / 2, 0, 0.036]}>
          <boxGeometry args={[PAGE_WIDTH + 0.1, PAGE_HEIGHT + 0.1, 0.03]} />
          <meshStandardMaterial color="#fdf6ec" roughness={0.55} />
        </mesh>
        <mesh position={[PAGE_WIDTH / 2, 0, 0.017]}>
          <boxGeometry args={[PAGE_WIDTH + 0.14, PAGE_HEIGHT + 0.14, 0.02]} />
          <meshStandardMaterial color="#e8c77d" roughness={0.4} metalness={0.2} />
        </mesh>
      </group>
    </group>
  );
};

export const PhotosHtml = () => (
  <div className="exp-content" style={{ paddingTop: '10vh' }}>
    <span className="exp-kicker">Kapitel 1</span>
    <h2 className="exp-title">Unser Jahr in Bildern</h2>
    <p className="exp-subtitle">Ein Fotobuch voller Erinnerungen — blättere durch.</p>
  </div>
);
