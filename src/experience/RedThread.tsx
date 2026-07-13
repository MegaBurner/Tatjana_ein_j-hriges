import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const TUBE_RADIUS = 0.035;
const TUBULAR_SEGMENTS = 200;
const RADIAL_SEGMENTS = 6;
const THREAD_COLOR = "#e07186";
const CURVE_TENSION = 0.4;

interface ThreadWaypoint {
  x: number;
  /** Anteil 0..1 des gesamten Scroll-Wegs von oben (Hero) nach unten (Finale). */
  yFraction: number;
  z: number;
}

// 15 Wegpunkte, abwechselnd links/rechts an den Hauptobjekten der 7 Sections
// vorbei (nie mittig hindurch) — Hero (Blumen), Fotobuch, Plattenspieler,
// Briefumschlag, Pinguine/Eisscholle, Sarma-Teller, Finale-Blüte.
const WAYPOINTS: ThreadWaypoint[] = [
  { x: 0.6, yFraction: 0, z: -1.0 }, // Start, über der Hero-Section
  { x: 2.1, yFraction: 0.06, z: -1.2 }, // neben den Hero-Blumen (rechts)
  { x: -1.9, yFraction: 0.16, z: -0.8 }, // Übergang zum Fotobuch (links)
  { x: -2.0, yFraction: 0.22, z: -1.1 }, // neben dem Fotobuch
  { x: 2.0, yFraction: 0.31, z: -0.9 }, // Übergang zum Plattenspieler (rechts)
  { x: 2.1, yFraction: 0.37, z: -1.3 }, // neben dem Plattenspieler
  { x: -1.9, yFraction: 0.46, z: -0.7 }, // Übergang zum Brief (links)
  { x: -2.0, yFraction: 0.52, z: -1.0 }, // neben dem Briefumschlag
  { x: 2.2, yFraction: 0.61, z: -1.2 }, // Übergang zu den Pinguinen (rechts)
  { x: 2.15, yFraction: 0.67, z: -1.4 }, // neben der Eisscholle
  { x: -2.1, yFraction: 0.76, z: -0.8 }, // Übergang zu Sarma (links)
  { x: -2.0, yFraction: 0.82, z: -1.1 }, // neben dem Sarma-Teller
  { x: 1.8, yFraction: 0.91, z: -0.9 }, // Übergang zum Finale (rechts)
  { x: 1.7, yFraction: 0.97, z: -1.3 }, // neben der Finale-Blüte
  { x: 0.5, yFraction: 1, z: -1.0 }, // Ende, unter der Finale-Section
];

/**
 * Baut die CatmullRom-Kurve für ein gegebenes viewport.height. Die Section i
 * liegt im Scroll-World-Space bei y = -height * i (siehe Experience.tsx
 * `Scenes`), daher spannt der komplette Faden von y=+1 bis
 * y=-(6 * height) - 1 über alle 7 Sections.
 */
function buildThreadCurve(height: number): THREE.CatmullRomCurve3 {
  const topY = 1;
  const bottomY = -(6 * height) - 1;
  const span = topY - bottomY;
  const points = WAYPOINTS.map(
    (wp) => new THREE.Vector3(wp.x, topY - wp.yFraction * span, wp.z),
  );
  return new THREE.CatmullRomCurve3(points, false, "catmullrom", CURVE_TENSION);
}

/**
 * „Roter Faden" — ein schmales Rosa-Band, das als TubeGeometry entlang einer
 * CatmullRom-Kurve durch alle Sections fließt. Rendert innerhalb von
 * <Scroll> (siehe Experience.tsx), scrollt also mit dem Inhalt mit.
 */
export default function RedThread() {
  const height = useThree((state) => state.viewport.height);
  const curve = useMemo(() => buildThreadCurve(height), [height]);
  const geometry = useMemo(
    () =>
      new THREE.TubeGeometry(
        curve,
        TUBULAR_SEGMENTS,
        TUBE_RADIUS,
        RADIAL_SEGMENTS,
        false,
      ),
    [curve],
  );

  // TubeGeometry wird bei jeder Höhenänderung neu erzeugt (useMemo) — alte
  // GPU-Buffer explizit freigeben, damit sie nicht als Leak liegen bleiben.
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={THREAD_COLOR}
        roughness={0.5}
        emissive={THREAD_COLOR}
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}
