import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ScrollControls, Scroll, useScroll } from "@react-three/drei";
import { DefaultLoadingManager } from "three";
import { SECTIONS } from "./sections";
import { PAGES } from "./constants";
import SnapController from "./SnapController";
import { isDeepLinkJumpDone } from "./scrollBus";
import AmbientLayer from "./AmbientLayer";
import RedThread from "./RedThread";
import type { ExperienceProps } from "./types";
import "./experience.css";

// ?instant=1: visuelles Scroll-Damping praktisch aus — für Deep-Link-
// Screenshots (Headless-Verifikation), damit die Szene sofort steht.
const INSTANT_MODE = new URLSearchParams(window.location.search).has("instant");
const SCROLL_DAMPING = INSTANT_MODE ? 0.002 : 0.22;

// ?freeze=1: hält den Render-Loop an, sobald die Szene zur Ruhe gekommen ist —
// Headless-Screenshots (SwiftShader rendert auf der CPU) kosten dann fast
// nichts mehr und sind deterministisch statt mitten in einer Animation.
const FREEZE_MODE = new URLSearchParams(window.location.search).has("freeze");
// Deep-Link-Sprung + Damping gelten als abgeschlossen, wenn der Offset so
// viele Frames in Folge stillsteht (SnapController braucht headless bis zu
// ~600 Frames, bis Layout/Chunks bereit sind — daher kein fixer Frame-Cutoff).
const FREEZE_STABLE_FRAMES = 30;
// Notbremse, falls der Offset nie zur Ruhe kommt (Dauer-Animation o. Ä.).
const FREEZE_MAX_FRAMES = 1200;

function FreezeFrame() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const scroll = useScroll();
  const isLoadingRef = useRef(false);
  const stableFramesRef = useRef(0);
  const totalFramesRef = useRef(0);
  const lastOffsetRef = useRef(-1);

  useEffect(() => {
    const manager = DefaultLoadingManager;
    const prevStart = manager.onStart;
    const prevLoad = manager.onLoad;
    manager.onStart = (url, loaded, total) => {
      isLoadingRef.current = true;
      prevStart?.(url, loaded, total);
    };
    manager.onLoad = () => {
      isLoadingRef.current = false;
      prevLoad?.();
    };
    return () => {
      manager.onStart = prevStart;
      manager.onLoad = prevLoad;
    };
  }, []);

  useFrame(() => {
    totalFramesRef.current += 1;
    if (totalFramesRef.current >= FREEZE_MAX_FRAMES) {
      setFrameloop("never");
      return;
    }
    // Vor dem Deep-Link-Sprung steht der Offset auch "stabil" auf 0 —
    // Stabilität zählt erst, wenn die Ziel-Section wirklich angefahren wurde.
    if (!isDeepLinkJumpDone()) {
      stableFramesRef.current = 0;
      return;
    }
    const offset = scroll.offset;
    const isStable = Math.abs(offset - lastOffsetRef.current) < 1e-4;
    lastOffsetRef.current = offset;
    stableFramesRef.current = isStable ? stableFramesRef.current + 1 : 0;
    const isSettled =
      stableFramesRef.current >= FREEZE_STABLE_FRAMES && !isLoadingRef.current;
    if (isSettled) {
      setFrameloop("never");
    }
  });

  return null;
}

function Scenes(props: ExperienceProps) {
  const height = useThree((s) => s.viewport.height);
  return (
    <>
      {SECTIONS.map((section, i) => (
        <group key={section.id} position={[0, -height * i, 0]}>
          <section.Scene {...props} index={i} />
        </group>
      ))}
    </>
  );
}

const Experience = (props: ExperienceProps) => {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{
        antialias: window.devicePixelRatio <= 1.5,
        alpha: true,
        powerPreference: "high-performance",
      }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 6, 4]} intensity={1.3} />
      <pointLight position={[-4, 2, -3]} intensity={0.6} color="#f4a5ae" />
      <Suspense fallback={null}>
        <ScrollControls pages={PAGES} damping={SCROLL_DAMPING}>
          {FREEZE_MODE && <FreezeFrame />}
          <SnapController />
          <AmbientLayer />
          <Scroll>
            <Scenes {...props} />
            <RedThread />
          </Scroll>
          <Scroll html style={{ width: "100%" }}>
            {SECTIONS.map((section, i) => (
              <section key={section.id} className="exp-section">
                <section.Html {...props} index={i} />
              </section>
            ))}
          </Scroll>
        </ScrollControls>
      </Suspense>
    </Canvas>
  );
};

export default Experience;
