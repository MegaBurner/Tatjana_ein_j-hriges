import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import type { SectionProps } from "../types";

type ScrollState = ReturnType<typeof useScroll>;

/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;

const GLOBE_RADIUS = 1.35;
const GLOBE_WIDTH_SEGMENTS = 32;
const GLOBE_HEIGHT_SEGMENTS = 24;

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;

/**
 * three.js' SphereGeometry (unrotiert, Standard phi/theta) parametrisiert
 * einen Punkt als x=-r·cos(2πu)·sin(πv), y=r·cos(πv), z=r·sin(2πu)·sin(πv)
 * mit uv=(u, 1-v). Löst man das nach der in der Aufgabe vorgegebenen
 * Formel x=r·cos(lat)·sin(lon), y=r·sin(lat), z=r·cos(lat)·cos(lon) auf,
 * ergibt sich die vom Mesh tatsächlich benötigte UV: u = lon/360 + 0.25
 * (in Grad, mod 1). Zum Zeichnen der Textur wird stattdessen die
 * KONVENTIONELLE Equirect-Projektion genutzt (lon=-180 am linken Rand,
 * lon=0 in der Mitte) — das lässt sich als Landkarte viel leichter von
 * Hand kodieren, ohne dass Kontinente über die Canvas-Naht (z. B. Amerika
 * bei lon=-90) auseinandergerissen werden. Die Differenz zwischen beiden
 * u-Definitionen ist rechnerisch konstant 0.25 (siehe Verifikation unten),
 * weshalb ein simpler `texture.offset.x = 0.25` beide Systeme wieder
 * deckungsgleich macht. Verifiziert per Screenshot: Palermo-Pin sitzt auf
 * Sizilien, nicht im Ozean.
 */
const TEXTURE_OFFSET_X = 0.25;

/** Erdachsen-Neigung als konstante rotation.z auf der Eltern-Gruppe. */
const EARTH_AXIS_TILT = 0.41;
/** Idle-Drehgeschwindigkeit (rad/s), solange Section nicht zentriert ist. */
const IDLE_ROTATION_SPEED = 0.12;
/** Ab diesem Fortschritt dämpft die Drehung zur Europa-Ansicht. */
const EUROPE_LOCK_THRESHOLD = 0.5;
const EUROPE_DAMP_SPEED = 3;
/** Ziel-Längengrad, der bei zentrierter Section zur Kamera zeigt. */
const EUROPE_FOCUS_LON_DEG = 15;
/**
 * Herleitung: Ein Punkt bei (lat,lon) landet nach Rotation der Eltern-Gruppe
 * um rotation.y=θ bei x'=r·cosLat·sin(lon+θ), z'=r·cosLat·cos(lon+θ)
 * (Standard-Rotationsmatrix um Y). "Zur Kamera zeigen" heißt x'=0, z'>0,
 * also lon+θ=0 ⇒ θ=-lon.
 */
const EUROPE_TARGET_ROTATION_Y =
  -THREE.MathUtils.degToRad(EUROPE_FOCUS_LON_DEG);

const OCEAN_TOP = "#b9c6ea";
const OCEAN_BOTTOM = "#d6def5";
const LAND_COLOR = "#f3e9d6";

const RED = "#d15871";
const GOLD = "#dfae5f";
const LILA = "#9b8ac4";

type LonLat = [number, number];

// --- Kontinente, handkodiert als vereinfachte [lon, lat]-Polygone ---------
// Europa/Balkan/Russland am sorgfältigsten (3 rote Pins im Mittelmeerraum),
// der Rest der Welt bewusst grob (nur Silhouette, keine Pins dort).
const EUROPE_LANDMASS: LonLat[] = [
  [-9.5, 37.0],
  [-7.5, 43.5],
  [-1.5, 43.4],
  [3.0, 42.3],
  [7.6, 43.8],
  [10.1, 43.9],
  [11.3, 41.8],
  [15.9, 38.2],
  [16.6, 39.9],
  [18.4, 40.4],
  [17.0, 41.3],
  [14.6, 44.2],
  [13.6, 45.6],
  [16.3, 43.6],
  [19.1, 41.8],
  [23.5, 37.9],
  [26.8, 39.8],
  [29.2, 41.1],
  [28.3, 43.6],
  [31.5, 46.3],
  [39.0, 51.0],
  [35.0, 60.0],
  [25.0, 66.0],
  [14.0, 68.5],
  [5.5, 61.0],
  [5.0, 51.5],
  [-2.0, 49.0],
];
const BRITAIN_IRELAND: LonLat[] = [
  [-8.5, 51.5],
  [-5.0, 50.0],
  [-1.5, 50.8],
  [1.5, 52.9],
  [-3.0, 58.6],
  [-6.0, 57.0],
  [-9.0, 54.0],
];
/** Sizilien — eigenes Inselpolygon, damit der Palermo-Pin sicher auf Land sitzt. */
const SICILY: LonLat[] = [
  [12.2, 38.35],
  [15.4, 38.25],
  [15.6, 36.85],
  [12.6, 37.35],
];
/** Santorini als winziges Inselpolygon in der Ägäis. */
const SANTORINI_ISLAND: LonLat[] = [
  [25.3, 36.5],
  [25.6, 36.5],
  [25.6, 36.28],
  [25.3, 36.28],
];
const NORTH_AMERICA: LonLat[] = [
  [-168, 66],
  [-150, 70],
  [-120, 72],
  [-95, 72],
  [-80, 65],
  [-65, 55],
  [-60, 47],
  [-66, 44],
  [-70, 41.5],
  [-75, 35],
  [-81, 31],
  [-97, 26],
  [-105, 22],
  [-117, 32],
  [-124, 40],
  [-130, 50],
  [-140, 58],
  [-155, 60],
];
const SOUTH_AMERICA: LonLat[] = [
  [-79, 9],
  [-77, 1],
  [-70, -18],
  [-71, -30],
  [-73, -45],
  [-68, -55],
  [-65, -52],
  [-58, -38],
  [-48, -25],
  [-35, -8],
  [-50, 0],
  [-60, 8],
  [-72, 10],
];
const AFRICA: LonLat[] = [
  [-17, 21],
  [-10, 30],
  [0, 37],
  [10, 37],
  [20, 32],
  [33, 31],
  [35, 27],
  [43, 12],
  [51, 12],
  [51, 2],
  [40, -15],
  [35, -25],
  [20, -35],
  [15, -22],
  [12, -5],
  [9, 5],
  [-4, 5],
  [-10, 10],
  [-17, 15],
];
const ASIA: LonLat[] = [
  [35, 45],
  [55, 45],
  [70, 50],
  [90, 55],
  [110, 55],
  [130, 50],
  [135, 40],
  [122, 32],
  [105, 22],
  [95, 10],
  [80, 8],
  [68, 25],
  [60, 25],
  [48, 30],
  [40, 35],
];
/** Japan — eigenes Inselpolygon, damit der Tokio-Pin sicher auf Land sitzt. */
const JAPAN: LonLat[] = [
  [130.0, 31.2],
  [129.5, 33.9],
  [133.0, 34.0],
  [135.0, 34.7],
  [138.0, 34.6],
  [140.9, 35.3],
  [140.9, 36.3],
  [141.9, 39.7],
  [141.4, 41.3],
  [140.0, 40.5],
  [137.5, 37.0],
  [135.8, 35.6],
  [132.5, 34.5],
  [130.5, 33.0],
];
const AUSTRALIA: LonLat[] = [
  [113, -22],
  [122, -18],
  [130, -12],
  [137, -12],
  [142, -11],
  [145, -17],
  [153, -28],
  [150, -37],
  [143, -39],
  [137, -35],
  [131, -32],
  [122, -34],
  [114, -30],
];

const CONTINENTS: LonLat[][] = [
  EUROPE_LANDMASS,
  BRITAIN_IRELAND,
  SICILY,
  SANTORINI_ISLAND,
  NORTH_AMERICA,
  SOUTH_AMERICA,
  AFRICA,
  ASIA,
  JAPAN,
  AUSTRALIA,
];

/** Konventionelle Equirect-Projektion: lon=-180 links, lon=0 Mitte, lat=90 oben. */
function lonLatToCanvasXY(lonDeg: number, latDeg: number): [number, number] {
  const x = ((lonDeg + 180) / 360) * TEXTURE_WIDTH;
  const y = ((90 - latDeg) / 180) * TEXTURE_HEIGHT;
  return [x, y];
}

function fillLandPolygon(
  ctx: CanvasRenderingContext2D,
  points: LonLat[],
): void {
  ctx.beginPath();
  points.forEach(([lon, lat], i) => {
    const [x, y] = lonLatToCanvasXY(lon, lat);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  ctx.fill();
}

function drawGraticule(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = lonLatToCanvasXY(lon, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEXTURE_HEIGHT);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = lonLatToCanvasXY(0, lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEXTURE_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Equirektangulare Weltkarten-Textur, einmalig Canvas-generiert. */
function makeGlobeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const oceanGradient = ctx.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
  oceanGradient.addColorStop(0, OCEAN_TOP);
  oceanGradient.addColorStop(1, OCEAN_BOTTOM);
  ctx.fillStyle = oceanGradient;
  ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  ctx.fillStyle = LAND_COLOR;
  CONTINENTS.forEach((polygon) => fillLandPolygon(ctx, polygon));

  drawGraticule(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.offset.x = TEXTURE_OFFSET_X;
  return texture;
}

let globeTexture: THREE.CanvasTexture | null = null;
/** Modul-weites Singleton — eine Canvas-Textur, geteilt von allen Globus-Instanzen. */
function getGlobeTexture(): THREE.CanvasTexture {
  globeTexture ??= makeGlobeTexture();
  return globeTexture;
}

// --- Pins -------------------------------------------------------------
interface PinDef {
  name: string;
  lat: number;
  lon: number;
  color: string;
  pulse: boolean;
  revealAt: number;
}

const REVEAL_SPAN = 0.12;

const PIN_DEFS: PinDef[] = [
  // Rot — da waren wir schon
  {
    name: "Palermo",
    lat: 38.12,
    lon: 13.36,
    color: RED,
    pulse: true,
    revealAt: 0.03,
  },
  {
    name: "Como",
    lat: 45.81,
    lon: 9.09,
    color: RED,
    pulse: true,
    revealAt: 0.08,
  },
  {
    name: "Bratislava",
    lat: 48.15,
    lon: 17.11,
    color: RED,
    pulse: true,
    revealAt: 0.13,
  },
  // Gold — Traumziele
  {
    name: "Paris",
    lat: 48.86,
    lon: 2.35,
    color: GOLD,
    pulse: false,
    revealAt: 0.18,
  },
  {
    name: "Santorini",
    lat: 36.39,
    lon: 25.46,
    color: GOLD,
    pulse: false,
    revealAt: 0.23,
  },
  {
    name: "New York",
    lat: 40.71,
    lon: -74.01,
    color: GOLD,
    pulse: false,
    revealAt: 0.28,
  },
  {
    name: "Tokio",
    lat: 35.68,
    lon: 139.69,
    color: GOLD,
    pulse: false,
    revealAt: 0.33,
  },
  // Lila — heilige Orte
  {
    name: "Belgrad",
    lat: 44.8,
    lon: 20.47,
    color: LILA,
    pulse: false,
    revealAt: 0.38,
  },
  {
    name: "Ostrog",
    lat: 42.67,
    lon: 19.03,
    color: LILA,
    pulse: false,
    revealAt: 0.43,
  },
  {
    name: "Hilandar",
    lat: 40.33,
    lon: 24.22,
    color: LILA,
    pulse: false,
    revealAt: 0.48,
  },
  {
    name: "Ohrid",
    lat: 41.12,
    lon: 20.8,
    color: LILA,
    pulse: false,
    revealAt: 0.53,
  },
];

const NEEDLE_LENGTH = 0.1;
const NEEDLE_RADIUS = 0.007;
const HEAD_RADIUS = 0.022;
/** Nadel-Basis liegt minimal unter dem idealen Radius, damit sie auf der
 *  low-poly-Kugel (32×24 Segmente, Flächen liegen leicht innerhalb der
 *  theoretischen Kugel) sicher ohne Spalt aufsitzt. */
const PIN_EMBED = 0.02;

/** Easing mit leichtem Überschwinger für den Scale-in-Pop der Pins. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

function latLonToPosition(
  latDeg: number,
  lonDeg: number,
  radius: number,
): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon),
  );
}

function Pin({
  pin,
  scroll,
  index,
  reducedMotion,
  pulsePhase,
}: {
  pin: PinDef;
  scroll: ScrollState;
  index: number;
  reducedMotion: boolean;
  pulsePhase: number;
}) {
  const scaleGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  const { position, quaternion } = useMemo(() => {
    const normal = latLonToPosition(pin.lat, pin.lon, 1);
    const basePosition = normal
      .clone()
      .multiplyScalar(GLOBE_RADIUS - PIN_EMBED);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal,
    );
    return { position: basePosition, quaternion: orientation };
  }, [pin.lat, pin.lon]);

  useFrame((state) => {
    const scaleGroup = scaleGroupRef.current;
    if (!scaleGroup) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;

    const progress = sectionProgress(scroll, index);
    const revealT = THREE.MathUtils.clamp(
      (progress - pin.revealAt) / REVEAL_SPAN,
      0,
      1,
    );
    scaleGroup.scale.setScalar(Math.max(easeOutBack(revealT), 0.0001));

    if (
      pin.pulse &&
      !reducedMotion &&
      ringRef.current &&
      ringMaterialRef.current
    ) {
      const pulseT =
        (Math.sin(state.clock.elapsedTime * 2 + pulsePhase) + 1) / 2;
      ringRef.current.scale.setScalar(1 + pulseT * 0.7);
      ringMaterialRef.current.opacity = 0.4 * (1 - pulseT);
    }
  });

  return (
    <group position={position} quaternion={quaternion}>
      <group ref={scaleGroupRef} scale={0}>
        <mesh position={[0, NEEDLE_LENGTH / 2, 0]}>
          <cylinderGeometry
            args={[NEEDLE_RADIUS, NEEDLE_RADIUS, NEEDLE_LENGTH, 8]}
          />
          <meshStandardMaterial color={pin.color} roughness={0.4} />
        </mesh>
        <mesh position={[0, NEEDLE_LENGTH, 0]}>
          <sphereGeometry args={[HEAD_RADIUS, 12, 10]} />
          <meshStandardMaterial color={pin.color} roughness={0.3} />
        </mesh>
        {pin.pulse && (
          <mesh
            ref={ringRef}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.003, 0]}
          >
            <ringGeometry args={[HEAD_RADIUS * 1.4, HEAD_RADIUS * 1.9, 24]} />
            <meshBasicMaterial
              ref={ringMaterialRef}
              color={pin.color}
              transparent
              opacity={0.25}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

export const GlobeScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<THREE.Group>(null);
  const texture = getGlobeTexture();

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    if (vis < VISIBILITY_EPSILON) return;

    const progress = sectionProgress(scroll, index);
    const targetScale = 0.88 + progress * 0.12;
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta),
    );

    const rotationGroup = rotationRef.current;
    if (!rotationGroup) return;

    if (progress > EUROPE_LOCK_THRESHOLD) {
      // Kürzesten Drehweg zum Ziel wählen, egal wo die Idle-Drehung stand.
      const current = rotationGroup.rotation.y;
      const twoPi = Math.PI * 2;
      const shortestTarget =
        current +
        THREE.MathUtils.euclideanModulo(
          EUROPE_TARGET_ROTATION_Y - current + Math.PI,
          twoPi,
        ) -
        Math.PI;
      rotationGroup.rotation.y = THREE.MathUtils.damp(
        current,
        shortestTarget,
        EUROPE_DAMP_SPEED,
        delta,
      );
    } else if (!reducedMotion) {
      rotationGroup.rotation.y =
        (rotationGroup.rotation.y + delta * IDLE_ROTATION_SPEED) %
        (Math.PI * 2);
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.55, 0]}>
      <group rotation={[0, 0, EARTH_AXIS_TILT]}>
        <group ref={rotationRef}>
          <mesh>
            <sphereGeometry
              args={[GLOBE_RADIUS, GLOBE_WIDTH_SEGMENTS, GLOBE_HEIGHT_SEGMENTS]}
            />
            <meshStandardMaterial
              map={texture}
              roughness={0.82}
              metalness={0.03}
            />
          </mesh>
          {PIN_DEFS.map((pin, i) => (
            <Pin
              key={pin.name}
              pin={pin}
              scroll={scroll}
              index={index}
              reducedMotion={reducedMotion}
              pulsePhase={i * 0.7}
            />
          ))}
        </group>
      </group>
    </group>
  );
};

interface LegendEntry {
  color: string;
  text: string;
}

const LEGEND_ENTRIES: LegendEntry[] = [
  { color: RED, text: "Palermo, Como, Bratislava" },
  { color: GOLD, text: "Paris, Santorini, New York, Tokio" },
  { color: LILA, text: "Belgrad, Ostrog, Hilandar, Ohrid" },
];

function LegendRow({ color, text }: LegendEntry) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: "0.85rem",
        color: "var(--text-primary)",
        opacity: 0.85,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {text}
    </p>
  );
}

export const GlobeHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 6</span>
    <h2 className="exp-title">Unsere Welt</h2>
    <p className="exp-subtitle">
      Rot: da waren wir schon. Der Rest kommt noch.
    </p>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        marginTop: "0.2rem",
      }}
    >
      {LEGEND_ENTRIES.map((entry) => (
        <LegendRow key={entry.text} color={entry.color} text={entry.text} />
      ))}
    </div>
  </div>
);
