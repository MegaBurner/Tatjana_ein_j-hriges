import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useScroll, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { loadAtlas } from "../../game/sprites";
import { AttractScreen } from "../../game/attract";
import { VIEW_H, VIEW_W } from "../../game/world";
import type { SectionProps } from "../types";

/** Unterhalb dieser Sichtbarkeit: keine Animations-/Textur-Updates mehr. */
const VISIBILITY_EPSILON = 0.005;
/** Tap/Drag-Unterscheidung — gleiches Kriterium wie Vinyl/Globus. */
const TAP_MAX_MOVEMENT_PX = 8;
/** Ab dieser Sichtbarkeit nimmt der Laptop Klicks an. */
const TAP_VISIBILITY_THRESHOLD = 0.3;

// --- Laptop-Maße (Weltkoordinaten) ------------------------------------------
const BASE_W = 3.4;
const BASE_D = 2.2;
const BASE_H = 0.14;
const LID_W = 3.4;
const LID_H = 2.1;
const LID_T = 0.1;
/** Spielfläche auf dem Display: Breite + Seitenverhältnis des Game-Canvas
 *  — der Rest des Deckels bleibt dunkle Blende (Letterbox). */
const SCREEN_W = 3.0;
const SCREEN_H = SCREEN_W * (VIEW_H / VIEW_W);

/** Deckel-Winkel (rotation.x der Scharnier-Gruppe): +PI/2 = zugeklappt auf
 *  der Basis, leicht negativ = offen und minimal nach hinten geneigt. */
const LID_CLOSED_ANGLE = 1.35;
const LID_OPEN_ANGLE = -0.1;

const IDLE_BOB_SPEED = 1.2;
const IDLE_BOB_AMPLITUDE = 0.045;
const IDLE_SWAY_SPEED = 0.4;
const IDLE_SWAY_AMPLITUDE = 0.06;
const HOVER_SCALE = 1.04;
/** Kurzer Scale-Punch beim Klick, klingt exponentiell ab. */
const CLICK_PUNCH = 0.1;
const CLICK_PUNCH_DECAY = 6;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Offscreen-Canvas mit dem Attract-Mode des Spiels; wird per CanvasTexture
 *  aufs Display gespiegelt. Läuft ab Mount — Atlas lädt einmal pro Seite
 *  (Modul-Cache in sprites.ts), Overlay-Spiel teilt sich das Bild.
 *  Liefert die Textur doppelt: als State (Material-Erzeugung beim Laden)
 *  und als Ref — nur über das Ref darf der Frame-Loop `needsUpdate` setzen
 *  (react-hooks/immutability verbietet Mutationen an Hook-Rückgaben). */
function useAttractTexture(): {
  texture: THREE.CanvasTexture | null;
  textureRef: RefObject<THREE.CanvasTexture | null>;
} {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    let screen: AttractScreen | null = null;
    let cancelled = false;
    void loadAtlas()
      .then((atlas) => {
        if (cancelled) return;
        screen = new AttractScreen(canvas, atlas);
        screen.start();
        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = canvasTexture;
        setTexture(canvasTexture);
      })
      .catch(() => {
        // Atlas nicht ladbar — Display bleibt dunkel, Section funktioniert
        // weiter (Button im Html-Overlay öffnet das Spiel trotzdem).
      });
    return () => {
      cancelled = true;
      screen?.stop();
    };
  }, []);

  useEffect(() => {
    return () => texture?.dispose();
  }, [texture]);

  return { texture, textureRef };
}

export const ArcadeScene = ({ onOpenGame, index }: SectionProps) => {
  const scroll = useScroll();
  const rootRef = useRef<THREE.Group>(null);
  const floatRef = useRef<THREE.Group>(null);
  const scaleRef = useRef<THREE.Group>(null);
  const lidRef = useRef<THREE.Group>(null);
  const isHovered = useRef(false);
  const clickPunch = useRef(0);
  const { texture, textureRef } = useAttractTexture();

  const screenMaterial = useMemo(() => {
    if (!texture) {
      return new THREE.MeshBasicMaterial({ color: "#101010" });
    }
    return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  }, [texture]);
  useEffect(() => {
    return () => screenMaterial.dispose();
  }, [screenMaterial]);

  const handleTap = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > TAP_MAX_MOVEMENT_PX) return;
    if (sectionVisibility(scroll, index) < TAP_VISIBILITY_THRESHOLD) return;
    event.stopPropagation();
    clickPunch.current = CLICK_PUNCH;
    onOpenGame();
  };

  useFrame((state, delta) => {
    const vis = sectionVisibility(scroll, index);
    const root = rootRef.current;
    if (root) root.visible = vis > 0.01;
    if (vis < VISIBILITY_EPSILON) return;

    // Attract-Canvas → Display (nur solange die Section sichtbar ist)
    const liveTexture = textureRef.current;
    if (liveTexture) liveTexture.needsUpdate = true;

    // Entrance: Deckel klappt beim Reinscrollen auf
    const progress = sectionProgress(scroll, index);
    const openT = easeOutCubic(THREE.MathUtils.clamp(progress / 0.5, 0, 1));
    if (lidRef.current) {
      lidRef.current.rotation.x = THREE.MathUtils.lerp(
        LID_CLOSED_ANGLE,
        LID_OPEN_ANGLE,
        openT,
      );
    }

    // Idle: sanftes Schweben + minimales Drehen
    const t = state.clock.elapsedTime;
    const float = floatRef.current;
    if (float) {
      float.position.y = Math.sin(t * IDLE_BOB_SPEED) * IDLE_BOB_AMPLITUDE;
      float.rotation.y = Math.sin(t * IDLE_SWAY_SPEED) * IDLE_SWAY_AMPLITUDE;
    }

    // Hover-Scale + Klick-Punch
    clickPunch.current = Math.max(
      0,
      clickPunch.current - clickPunch.current * CLICK_PUNCH_DECAY * delta,
    );
    const scaleGroup = scaleRef.current;
    if (scaleGroup) {
      const target = (isHovered.current ? HOVER_SCALE : 1) + clickPunch.current;
      scaleGroup.scale.setScalar(
        THREE.MathUtils.damp(scaleGroup.scale.x, target, 8, delta),
      );
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.95, 0]}>
      <group ref={floatRef}>
        <group
          ref={scaleRef}
          rotation={[0.12, 0, 0]}
          onClick={handleTap}
          onPointerOver={() => {
            if (sectionVisibility(scroll, index) >= TAP_VISIBILITY_THRESHOLD) {
              isHovered.current = true;
              document.body.style.cursor = "pointer";
            }
          }}
          onPointerOut={() => {
            isHovered.current = false;
            document.body.style.cursor = "";
          }}
        >
          {/* Basis mit Tastatur-Andeutung und Touchpad */}
          <RoundedBox
            args={[BASE_W, BASE_H, BASE_D]}
            radius={0.05}
            smoothness={4}
          >
            <meshStandardMaterial
              color="#3a3f47"
              roughness={0.45}
              metalness={0.55}
            />
          </RoundedBox>
          <mesh
            position={[0, BASE_H / 2 + 0.002, -0.25]}
            rotation-x={-Math.PI / 2}
          >
            <planeGeometry args={[BASE_W * 0.82, BASE_D * 0.5]} />
            <meshStandardMaterial color="#23272e" roughness={0.7} />
          </mesh>
          <mesh
            position={[0, BASE_H / 2 + 0.002, 0.68]}
            rotation-x={-Math.PI / 2}
          >
            <planeGeometry args={[0.9, 0.55]} />
            <meshStandardMaterial color="#2c313a" roughness={0.5} />
          </mesh>

          {/* Deckel: Scharnier an der Hinterkante der Basis */}
          <group ref={lidRef} position={[0, BASE_H / 2, -BASE_D / 2]}>
            <RoundedBox
              args={[LID_W, LID_H, LID_T]}
              radius={0.05}
              smoothness={4}
              position={[0, LID_H / 2 - 0.03, 0]}
            >
              <meshStandardMaterial
                color="#3a3f47"
                roughness={0.45}
                metalness={0.55}
              />
            </RoundedBox>
            {/* Display-Blende (Letterbox) + Spielfläche */}
            <mesh position={[0, LID_H / 2 - 0.03, LID_T / 2 + 0.002]}>
              <planeGeometry args={[LID_W * 0.94, LID_H * 0.9]} />
              <meshBasicMaterial color="#101010" />
            </mesh>
            <mesh
              position={[0, LID_H / 2 - 0.03, LID_T / 2 + 0.004]}
              material={screenMaterial}
            >
              <planeGeometry args={[SCREEN_W, SCREEN_H]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
};

export const ArcadeHtml = ({ onOpenGame }: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: "8vh" }}>
    <span className="exp-kicker">Kapitel 8</span>
    <h2 className="exp-title">Ich lauf zu dir</h2>
    <p className="exp-subtitle">
      Mein eigenes Chrome-Dino-Spiel: Ich renn los, spring über Kakteen und duck
      mich unter Vögeln — und am Ziel stehst du und winkst.
    </p>
    <button className="exp-btn primary" onClick={onOpenGame}>
      ▶ Spiel starten
    </button>
  </div>
);
