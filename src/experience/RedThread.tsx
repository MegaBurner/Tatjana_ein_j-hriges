import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PAGES } from "./constants";

const TUBE_RADIUS = 0.035;
const TUBULAR_SEGMENTS = 260;
const RADIAL_SEGMENTS = 6;
const THREAD_COLOR = "#e07186";
const CURVE_TENSION = 0.4;

/** Rand über der ersten / unter der letzten Section (Welt-Einheiten). */
const EDGE_MARGIN = 1.2;

/**
 * Obere Titel-Zone jeder Section, relativ zum jeweiligen Section-Zentrum
 * (y = -height * i, siehe Experience.tsx `Scenes`). Innerhalb dieser Zone
 * liegen Kicker/Titel/Subtitle der HTML-Overlays (paddingTop ~9-16vh) — der
 * Faden darf hier NICHT durch die Bildmitte laufen, sonst klebt er hinter
 * dem Text (Lesbarkeits-Beschwerde).
 */
const TITLE_ZONE_TOP_OFFSET = 2.4;
const TITLE_ZONE_BOTTOM_OFFSET = 1.0;
/** x-Position in der Titel-Zone — > 2.2 geforderter Mindestabstand von der Mitte. */
const TITLE_ZONE_X = 2.3;

/**
 * Wegpunkt unterhalb der Titel-Zone, seitlich an den zentral sitzenden
 * Hero-Objekten vorbei (Objekte: x ≈ 0, |x| < 1.8 laut Section-Szenen).
 */
const OBJECT_WAYPOINT_OFFSET = -0.4;
const OBJECT_WAYPOINT_X = 2.0;

const TITLE_Z = -0.85;
const OBJECT_Z = -1.25;
const END_Z = -1.0;

interface ThreadWaypoint {
  x: number;
  y: number;
  z: number;
}

/** Seite (links/rechts) der Section `i` — alterniert, damit der Faden nie zweimal hintereinander auf derselben Seite verharrt. */
function sectionSide(index: number): 1 | -1 {
  return index % 2 === 0 ? 1 : -1;
}

/**
 * Baut die Wegpunkte für alle `PAGES` Sections. Pro Section liegen zwei
 * Punkte in der oberen Titel-Zone (Ein- und Austritt, beide seitlich bei
 * gleichem x — der Faden bleibt dort auf einer Höhe lateral) und ein Punkt
 * daneben auf Höhe des Hero-Objekts. Die Mitte-Querung zur nächsten Section
 * geschieht dazwischen ganz von selbst (CatmullRom-Interpolation) im freien
 * Bereich unterhalb der Titel-Zone bzw. an der Section-Grenze — nie
 * innerhalb einer Titel-Zone.
 */
function buildWaypoints(height: number): ThreadWaypoint[] {
  const waypoints: ThreadWaypoint[] = [];
  const lastIndex = PAGES - 1;

  for (let i = 0; i < PAGES; i++) {
    const center = -height * i;
    const side = sectionSide(i);

    // Titel-Zone: oberer Rand. Bei der ersten Section beginnt der gesamte
    // Faden erst am globalen oberen Rand (EDGE_MARGIN), nicht am Zonen-Rand.
    waypoints.push({
      x: side * TITLE_ZONE_X,
      y: i === 0 ? EDGE_MARGIN : center + TITLE_ZONE_TOP_OFFSET,
      z: TITLE_Z,
    });
    // Titel-Zone: unterer Rand, gleiche x-Position — der Faden bleibt über
    // die gesamte Zonen-Höhe seitlich, statt mittig zu queren.
    waypoints.push({
      x: side * TITLE_ZONE_X,
      y: center + TITLE_ZONE_BOTTOM_OFFSET,
      z: TITLE_Z,
    });
    // Neben dem Hero-Objekt, noch seitlich, aber näher an der Mitte.
    waypoints.push({
      x: side * OBJECT_WAYPOINT_X,
      y: center + OBJECT_WAYPOINT_OFFSET,
      z: OBJECT_Z,
    });

    if (i === lastIndex) {
      // Letzte Section: Faden endet unterhalb der Finale-Szene statt an
      // einer Section-Grenze zu queren.
      waypoints.push({
        x: side * 0.5,
        y: center - EDGE_MARGIN,
        z: END_Z,
      });
    }
    // Andernfalls quert der Faden zwischen diesem Objekt-Punkt und dem
    // Titel-Zonen-Eintritt der nächsten Section die Mitte — das passiert im
    // freien Bereich um die Section-Grenze (y ≈ -(i + 0.5) * height), ohne
    // expliziten Wegpunkt, ganz von selbst durch die Interpolation.
  }

  return waypoints;
}

/**
 * Baut die CatmullRom-Kurve für ein gegebenes viewport.height. Section `i`
 * liegt im Scroll-World-Space bei y = -height * i (siehe Experience.tsx
 * `Scenes`), daher spannt der komplette Faden von y = +EDGE_MARGIN bis
 * y = -(PAGES - 1) * height - EDGE_MARGIN über alle Sections.
 */
function buildThreadCurve(height: number): THREE.CatmullRomCurve3 {
  const points = buildWaypoints(height).map(
    (wp) => new THREE.Vector3(wp.x, wp.y, wp.z),
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
