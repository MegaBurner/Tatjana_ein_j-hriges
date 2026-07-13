import { Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ScrollControls, Scroll } from "@react-three/drei";
import { SECTIONS } from "./sections";
import { PAGES } from "./constants";
import SnapController from "./SnapController";
import AmbientLayer from "./AmbientLayer";
import RedThread from "./RedThread";
import type { ExperienceProps } from "./types";
import "./experience.css";

// ?instant=1: visuelles Scroll-Damping praktisch aus — für Deep-Link-
// Screenshots (Headless-Verifikation), damit die Szene sofort steht.
const INSTANT_MODE = new URLSearchParams(window.location.search).has("instant");
const SCROLL_DAMPING = INSTANT_MODE ? 0.002 : 0.22;

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
