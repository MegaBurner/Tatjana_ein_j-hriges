# Three.js-Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Jahrestags-Website erhält einen 3D-Partikel-Hintergrund und eine echte 3D-Vinyl (React Three Fiber), alle Dependencies auf Latest Major, ein repariertes Tailwind-v4-Setup und eine Design-Politur.

**Architecture:** Ein globaler R3F-Canvas (fixed, z-0) ersetzt den 2D-Partikel-Canvas; die VinylPage bekommt einen zweiten, lazy-geladenen Canvas für die 3D-Platte. Bestehende 2D-Komponenten bleiben als WebGL-Fallback erhalten. Max. 2 WebGL-Kontexte gleichzeitig.

**Tech Stack:** React 19, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), `three`, `@react-three/fiber@^9` (React-19-kompatibel, peer `three >= 0.156`), `@react-three/drei`, Framer Motion.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-threejs-overhaul-design.md`
- `@react-three/fiber` MUSS v9.x sein (v10 ist Pre-Release-Branch, nicht installieren)
- React muss in Range `>=19 <19.3` bleiben (Peer-Anforderung von fiber v9)
- GitHub-Pages-Basis-Pfad: alle Asset-URLs über `import.meta.env.BASE_URL` (bestehendes `resolvePath`-Muster)
- Kein Postprocessing-Bloom (Mobile-Performance); Glow über additive Sprite-Texturen
- Canvas-Settings: `dpr={[1, 2]}`, Antialiasing nur bei `devicePixelRatio <= 1.5` (Spec-Regel)
- Farbpalette: Lavendel `#E6E0F8`, Rosa `#F4A5AE`, Rosa-Tief `#E07186`, Lavendel-Akzent `#C4B5E4`, NEU Gold `#E8C77D`
- Typografie: Playfair Display (Überschriften), Inter (UI)
- Keine Änderungen an Texten, Fotos, Songs, Deployment-Workflow
- `public/Notiz 09.07.2025 02_12_13.pdf` (untracked) NICHT committen
- Verifikation statt Unit-Tests (per Spec): `npm run build` + `npm run lint` + Playwright-Sichtprüfung — das Projekt hat bewusst keine Test-Infrastruktur

## Dateistruktur (neu/geändert)

```
vite.config.ts                        # + tailwindcss-Plugin
src/index.css                         # Tailwind v4 + @theme + Body-Gradient + Headings
tailwind.config.js                    # LÖSCHEN (v4 braucht keine Config)
src/three/hooks/useWebGL.ts           # NEU: WebGL-Detection + reduced-motion
src/three/SceneErrorBoundary.tsx      # NEU: ErrorBoundary für Canvas-Szenen
src/three/BackgroundScene.tsx         # NEU: globaler 3D-Partikel-Hintergrund
src/three/Vinyl3D.tsx                 # NEU: 3D-Schallplatte
src/App.tsx                           # BackgroundScene mit Fallback einbinden
src/components/VinylRecord/VinylRecord.tsx  # 3D-Vinyl mit CSS-Fallback
src/components/VinylRecord/VinylRecord.css  # + .vinyl-canvas-wrapper
src/components/Navigation/PageNavigation.css # Glassmorphism + Gold-Akzent
src/pages/PhotosPage.tsx              # Inline-Font-Styles entfernen
```

---

### Task 1: Dependency-Update auf Latest Major

**Files:**
- Modify: `package.json`, `package-lock.json` (via Tooling)

**Interfaces:**
- Consumes: —
- Produces: aktueller Dependency-Stand; alle Folge-Tasks bauen darauf auf

- [ ] **Step 1: Alle Ranges auf Latest Major heben**

```bash
npx npm-check-updates -u
npm install
```

Erwartete Sprünge (Stand 2026-07-12): Vite 7→8, ESLint 9→10, `@vitejs/plugin-react` 5→6, TypeScript ~5.9→~7.0, lucide-react 0.x→1.x, globals 16→17, `@eslint/js` 9→10.

- [ ] **Step 2: Build und Lint verifizieren**

Run: `npm run build && npm run lint`
Expected: Build grün, Lint ohne Errors (Warnings dokumentieren).

- [ ] **Step 3 (nur bei Fehlern): Einzelne Pakete zurückpinnen**

Fallback-Regel aus dem Spec: Bricht ein Major-Update den Build unlösbar, NUR dieses Paket zurückpinnen und im Commit-Body dokumentieren. Wahrscheinlichster Kandidat TypeScript 7 (Go-Port):

```bash
npm install -D typescript@~5.9.3
npm run build
```

Bei lucide-react 1.x: Icon-Importe prüfen (`rg "from 'lucide-react'" src/`) — benutzte Icons: Heart, ArrowRight, Play, Pause, RotateCcw, Volume2, VolumeX, SkipBack, SkipForward, ChevronLeft, ChevronRight, X (PDFModal). Falls ein Icon umbenannt wurde, Import anpassen.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: update all dependencies to latest majors"
```

---

### Task 2: Tailwind v4 anbinden + Design-Tokens

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/index.css` (kompletter Ersatz)
- Delete: `tailwind.config.js`
- Modify: `package.json` (`autoprefixer`, `postcss` raus; `@tailwindcss/vite` rein)

**Interfaces:**
- Consumes: Task 1 (aktuelle `tailwindcss`-Version)
- Produces: CSS-Variablen `--accent-gold`, `--font-serif`, `--font-sans` und Klasse `.glass` für Task 6; funktionierende Tailwind-Utilities projektweit

- [ ] **Step 1: Pakete umbauen**

```bash
npm install -D @tailwindcss/vite
npm uninstall autoprefixer postcss
rm tailwind.config.js
```

(Tailwind v4 übernimmt Prefixing/Nesting selbst; Config-Datei wird durch `@theme` in CSS ersetzt.)

- [ ] **Step 2: Vite-Plugin registrieren**

`vite.config.ts` komplett:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/Tatjana_ein_j-hriges/',
})
```

- [ ] **Step 3: `src/index.css` komplett ersetzen**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');
@import "tailwindcss";

@theme {
  --color-bg-primary: #e6e0f8;
  --color-bg-secondary: #f0ebf9;
  --color-accent-rose: #f4a5ae;
  --color-accent-rose-deep: #e07186;
  --color-accent-lavender: #c4b5e4;
  --color-accent-gold: #e8c77d;
  --color-text-primary: #4a4a4a;
  --color-text-secondary: #888888;
  --font-sans: 'Inter', sans-serif;
  --font-serif: 'Playfair Display', serif;
}

:root {
  /* Aliase für bestehende Komponenten-CSS (nicht entfernen) */
  --bg-primary: #e6e0f8;
  --bg-secondary: #f0ebf9;
  --accent-rose: #f4a5ae;
  --accent-rose-deep: #e07186;
  --accent-lavender: #c4b5e4;
  --accent-gold: #e8c77d;
  --text-primary: #4a4a4a;
  --text-secondary: #888888;
  --text-light: #ffffff;
  --shadow-soft: rgba(155, 137, 196, 0.18);
  --shadow-medium: rgba(74, 60, 110, 0.14);
  --space-xs: 0.5rem;
  --space-sm: 1rem;
  --space-md: 2rem;
  --space-lg: 4rem;
  --space-xl: 8rem;
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-full: 50%;
}

body {
  /* Weicher radialer Verlauf statt Streifen — die 3D-Szene übernimmt die Textur */
  background:
    radial-gradient(1200px 800px at 20% 10%, rgba(244, 165, 174, 0.25), transparent 60%),
    radial-gradient(1000px 700px at 80% 90%, rgba(196, 181, 228, 0.35), transparent 60%),
    linear-gradient(180deg, var(--bg-secondary), var(--bg-primary));
  background-attachment: fixed;
  color: var(--text-primary);
  font-family: var(--font-sans);
  margin: 0;
  min-height: 100vh;
}

h1, h2 {
  font-family: var(--font-serif);
}

html {
  scroll-behavior: smooth;
}

/* Glassmorphism-Basis für Karten und Navigation */
.glass {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.65);
}
```

- [ ] **Step 4: Verifizieren, dass Tailwind wirklich generiert wird**

Run: `npm run build && head -c 300 dist/assets/*.css`
Expected: Build grün; CSS-Banner `/*! tailwindcss v4...` am Dateianfang. Zusätzlich `npm run dev` kurz starten und prüfen, dass die Seite den neuen Verlauf zeigt (keine Streifen mehr).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/index.css package.json package-lock.json
git rm tailwind.config.js
git commit -m "fix: wire up Tailwind v4 via Vite plugin, migrate tokens to @theme"
```

---

### Task 3: Three.js-Stack + useWebGL-Hook + ErrorBoundary

**Files:**
- Modify: `package.json`
- Create: `src/three/hooks/useWebGL.ts`
- Create: `src/three/SceneErrorBoundary.tsx`

**Interfaces:**
- Consumes: Task 1
- Produces: `detectWebGL(): boolean`, `useWebGL(): boolean`, `usePrefersReducedMotion(): boolean`, `<SceneErrorBoundary fallback={ReactNode}>` — genutzt von Task 4 und Task 5

- [ ] **Step 1: Pakete installieren**

```bash
npm install three "@react-three/fiber@^9" @react-three/drei
npm install -D @types/three
```

Danach prüfen: `npm ls @react-three/fiber three react` — fiber muss 9.x sein, keine Peer-Warnings.

- [ ] **Step 2: `src/three/hooks/useWebGL.ts` anlegen**

```typescript
import { useMemo } from 'react';

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    );
  } catch {
    return false;
  }
}

export function useWebGL(): boolean {
  return useMemo(detectWebGL, []);
}

export function usePrefersReducedMotion(): boolean {
  return useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
}
```

- [ ] **Step 3: `src/three/SceneErrorBoundary.tsx` anlegen**

```tsx
import { Component, type ReactNode } from 'react';

interface SceneErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface SceneErrorBoundaryState {
  hasError: boolean;
}

/** Fängt Render-/Loader-Fehler in WebGL-Szenen ab und zeigt den 2D-Fallback. */
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default SceneErrorBoundary;
```

- [ ] **Step 4: Verifizieren + Commit**

Run: `npm run build && npm run lint`
Expected: grün.

```bash
git add package.json package-lock.json src/three/
git commit -m "feat: add three.js stack, WebGL detection and scene error boundary"
```

---

### Task 4: BackgroundScene — globaler 3D-Partikel-Hintergrund

**Files:**
- Create: `src/three/BackgroundScene.tsx`
- Modify: `src/App.tsx` (Zeile 8 Import; Zeile ~103 `<CanvasBackgroundEffects />` ersetzen)

**Interfaces:**
- Consumes: `useWebGL`/`usePrefersReducedMotion`/`SceneErrorBoundary` aus Task 3
- Produces: `<BackgroundScene />` (props-los), von `App.tsx` gerendert. `CanvasBackgroundEffects` bleibt als Fallback im Repo.

- [ ] **Step 1: `src/three/BackgroundScene.tsx` anlegen**

Herz-/Blütenblatt-Sprites (Canvas-generierte Glow-Texturen wie im bisherigen 2D-Effekt), je Form ein InstancedMesh (1 Draw-Call), Aufwärts-Drift mit Tiefenstaffelung, Parallax über `window`-Pointer (Canvas hat `pointer-events: none`).

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrefersReducedMotion } from './hooks/useWebGL';
import SceneErrorBoundary from './SceneErrorBoundary';

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
      <SceneErrorBoundary fallback={null}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 10], fov: 50 }}
          gl={{
            antialias: window.devicePixelRatio <= 1.5,
            alpha: true,
            powerPreference: 'low-power',
          }}
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
```

- [ ] **Step 2: In `App.tsx` einbinden**

Import-Block ergänzen/ändern (nach Zeile 8):

```tsx
import CanvasBackgroundEffects from './components/Effects/CanvasBackgroundEffects';
import BackgroundScene from './three/BackgroundScene';
import { detectWebGL } from './three/hooks/useWebGL';
```

Vor der `App`-Funktion (Modul-Ebene, einmalige Detection):

```tsx
const HAS_WEBGL = detectWebGL();
```

Im JSX den bisherigen Effekt-Aufruf ersetzen:

```tsx
{/* Global Background Effects - 3D wenn möglich, sonst 2D-Canvas */}
{HAS_WEBGL ? <BackgroundScene /> : <CanvasBackgroundEffects />}
```

- [ ] **Step 3: Visuell verifizieren**

Run: `npm run dev` (Hintergrund), dann Browser auf `http://localhost:5173/Tatjana_ein_j-hriges/`.
Expected: Schwebende, leuchtende Herzen/Blütenblätter mit Tiefen-Parallax bei Mausbewegung; keine Console-Errors; UI klickbar (Canvas blockiert keine Events).

- [ ] **Step 4: Build + Commit**

```bash
npm run build && npm run lint
git add src/three/BackgroundScene.tsx src/App.tsx
git commit -m "feat: replace 2D particle canvas with R3F background scene"
```

---

### Task 5: Vinyl3D — echte 3D-Schallplatte

**Files:**
- Create: `src/three/Vinyl3D.tsx`
- Modify: `src/components/VinylRecord/VinylRecord.tsx`
- Modify: `src/components/VinylRecord/VinylRecord.css` (nur Ergänzung)

**Interfaces:**
- Consumes: `useWebGL`, `usePrefersReducedMotion`, `SceneErrorBoundary` (Task 3)
- Produces: `Vinyl3D` mit Props `{ audioRef: React.RefObject<HTMLAudioElement | null>; coverImage?: string }` — default export, lazy-geladen von `VinylRecord.tsx`

- [ ] **Step 1: `src/three/Vinyl3D.tsx` anlegen**

Platte = Zylinder (Bump-Map mit konzentrischen Rillen, Canvas-generiert), Label = Kreis mit Cover-Textur, Rotation nur bei laufender Musik (`audioRef.current.paused` wird im Frame-Loop gelesen — kein React-State), sanftes Anlaufen/Auslaufen via Damping, Pointer-Tilt.

```tsx
import { Suspense, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrefersReducedMotion } from './hooks/useWebGL';

interface Vinyl3DProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  coverImage?: string;
}

const PLAY_SPEED = 1.6; // rad/s (~33 1/3 UPM Gefühl, leicht überhöht)

/** Konzentrische Rillen als Bump-Map, einmalig Canvas-generiert. */
function makeGrooveTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#6a6a6a';
  ctx.lineWidth = 1;
  for (let r = 60; r < size / 2 - 4; r += 3) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function CoverLabel({ coverImage }: { coverImage: string }) {
  const texture = useLoader(THREE.TextureLoader, coverImage);
  texture.colorSpace = THREE.SRGBColorSpace;
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
  const grooves = useMemo(makeGrooveTexture, []);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: PointerEvent) => {
      pointerTarget.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 0.25,
        y: (e.clientY / window.innerHeight - 0.5) * 0.18,
      };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reducedMotion]);

  useFrame((_, delta) => {
    const isPlaying = audioRef.current ? !audioRef.current.paused : false;
    speed.current = THREE.MathUtils.damp(
      speed.current,
      isPlaying ? PLAY_SPEED : 0,
      1.8,
      delta
    );
    if (spinRef.current) {
      spinRef.current.rotation.y += speed.current * delta;
    }
    if (tiltRef.current && !reducedMotion) {
      tiltRef.current.rotation.x = THREE.MathUtils.damp(
        tiltRef.current.rotation.x, pointerTarget.current.y, 3, delta
      );
      tiltRef.current.rotation.z = THREE.MathUtils.damp(
        tiltRef.current.rotation.z, -pointerTarget.current.x, 3, delta
      );
    }
  });

  return (
    <group ref={tiltRef}>
      {/* Platte liegt in XZ-Ebene, Kamera schaut von schräg oben */}
      <group ref={spinRef}>
        <mesh>
          <cylinderGeometry args={[1.4, 1.4, 0.05, 96]} />
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
          <circleGeometry args={[0.05, 32]} />
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
```

- [ ] **Step 2: `VinylRecord.tsx` umbauen (3D mit CSS-Fallback)**

Imports oben ergänzen:

```tsx
import { useState, useEffect, lazy, Suspense } from 'react';
import { useWebGL } from '../../three/hooks/useWebGL';
import SceneErrorBoundary from '../../three/SceneErrorBoundary';

const Vinyl3D = lazy(() => import('../../three/Vinyl3D'));
```

Das bisherige Disc-Markup (der `<div className={...vinyl-record...}>`-Block, Zeilen 76–100) in eine lokale Komponente extrahieren und im Return ersetzen:

```tsx
interface CssVinylProps {
  isPlaying: boolean;
  coverImage?: string;
}

const CssVinylFallback = ({ isPlaying, coverImage }: CssVinylProps) => (
  <div className={`vinyl-record ${isPlaying ? 'spinning' : ''}`}>
    <div className="vinyl-label">
      {coverImage && (
        <img
          src={coverImage}
          alt="Album Cover"
          className="vinyl-cover-img"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%',
            zIndex: 1
          }}
        />
      )}
      <div className="vinyl-hole" style={{ zIndex: 2, position: 'relative' }} />
    </div>
  </div>
);
```

Im Return von `VinylRecord` (Audio-Controls bleiben unverändert):

```tsx
const hasWebGL = useWebGL();
// ...
{hasWebGL ? (
  <div className="vinyl-canvas-wrapper">
    <SceneErrorBoundary
      fallback={<CssVinylFallback isPlaying={isPlaying} coverImage={coverImage} />}
    >
      <Suspense
        fallback={<CssVinylFallback isPlaying={isPlaying} coverImage={coverImage} />}
      >
        <Vinyl3D audioRef={audioRef} coverImage={coverImage} />
      </Suspense>
    </SceneErrorBoundary>
  </div>
) : (
  <CssVinylFallback isPlaying={isPlaying} coverImage={coverImage} />
)}
```

- [ ] **Step 3: `VinylRecord.css` ergänzen (ans Dateiende)**

```css
.vinyl-canvas-wrapper {
  width: 340px;
  height: 340px;
}

@media (max-width: 480px) {
  .vinyl-canvas-wrapper {
    width: 260px;
    height: 260px;
  }
}
```

- [ ] **Step 4: Visuell verifizieren**

Run: `npm run dev`, zur Vinyl-Seite navigieren (Start Journey → Weiter → Weiter).
Expected: 3D-Platte mit Rillen-Glanz und Cover-Label; dreht bei Play sanft an, stoppt bei Pause mit Auslauf; Songwechsel tauscht das Label; leichte Neigung zur Mausposition; Play/Pause/Skip/Volume funktionieren unverändert.

- [ ] **Step 5: Build + Commit**

```bash
npm run build && npm run lint
git add src/three/Vinyl3D.tsx src/components/VinylRecord/
git commit -m "feat: replace CSS vinyl with 3D record (R3F) incl. CSS fallback"
```

---

### Task 6: Design-Politur — Glassmorphism, Gold, Typografie

**Files:**
- Modify: `src/components/Navigation/PageNavigation.css`
- Modify: `src/pages/PhotosPage.tsx` (Inline-Font-Styles raus, Zeilen 105 und 154)

**Interfaces:**
- Consumes: `.glass`-Klasse + `--accent-gold` + `--font-serif` aus Task 2
- Produces: — (rein visuell)

- [ ] **Step 1: `PageNavigation.css` — Buttons auf Glass-Look, Gold-Indikator**

Die Regeln `.nav-btn` und `.indicator-dot.active` ersetzen (Rest der Datei bleibt):

```css
.nav-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1.5rem;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  box-shadow:
    0 4px 20px var(--shadow-soft),
    0 1px 3px var(--shadow-medium);
  transition: all 0.3s ease;
}

.indicator-dot.active {
  background: var(--accent-gold);
  transform: scale(1.3);
  box-shadow: 0 0 10px rgba(232, 199, 125, 0.75);
}
```

(`.nav-btn:hover` behält `background: white` — bewusster Kontrast-Boost beim Hover.)

- [ ] **Step 2: `PhotosPage.tsx` — Inline-Fonts durch Theme ersetzen**

Zeile 105: `style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}` ersetzen durch `style={{ fontStyle: 'italic' }}` (Serif kommt jetzt global über `h2`).
Zeile 154: im Diashow-Hinweis `fontFamily: "'Playfair Display', serif"` aus dem style-Objekt entfernen, `fontStyle: 'italic'` bleibt.

- [ ] **Step 3: Visuell verifizieren + Commit**

Run: `npm run dev` — alle 5 Seiten durchklicken.
Expected: Navigation wirkt gläsern, aktiver Punkt golden, Überschriften durchgehend Playfair Display.

```bash
npm run build && npm run lint
git add src/components/Navigation/PageNavigation.css src/pages/PhotosPage.tsx
git commit -m "style: glassmorphism navigation, gold accents, centralized typography"
```

---

### Task 7: End-to-End-Verifikation (Playwright)

**Files:** keine (nur Fixes, falls Prüfung Fehler findet)

**Interfaces:**
- Consumes: alle vorherigen Tasks
- Produces: verifizierter Stand; Screenshots als Beleg

- [ ] **Step 1: Produktions-Build + Preview starten**

```bash
npm run build
npm run preview &
```

Expected: Preview läuft auf `http://localhost:4173/Tatjana_ein_j-hriges/`.

- [ ] **Step 2: Desktop-Durchlauf (Playwright MCP, 1280×800)**

Alle 5 Seiten durchklicken (Start Journey → Weiter × 3), pro Seite Screenshot; Console-Messages prüfen.
Expected: keine Errors; 3D-Hintergrund überall sichtbar; Vinyl dreht bei Play.

- [ ] **Step 3: Mobile-Durchlauf (390×844)**

Browser-Resize auf 390×844, gleiche Tour, Screenshots.
Expected: Layout intakt, Vinyl-Canvas 260px, flüssige Animation.

- [ ] **Step 4: Letzte Fixes committen (falls nötig), sonst abschließen**

```bash
git status
git log --oneline master...origin/master
```

Push/Deploy erst nach User-Freigabe (Push auf `master` deployt automatisch via GitHub Actions).
