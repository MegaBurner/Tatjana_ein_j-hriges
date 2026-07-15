import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getHeartGeometry } from "../heartGeometry";
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
/**
 * Sanftes Pendeln um den Europa-Anker, sobald das Damping greift. Ohne das
 * stünde der Globus bei zentrierter Section komplett still: sectionProgress
 * ist dort index/(PAGES-1) = 6/8 = 0.75 > EUROPE_LOCK_THRESHOLD, d. h. die
 * Idle-Drehung (unten) läuft nur während des Rein-/Rausscrollens.
 */
const EUROPE_PENDULUM_AMPLITUDE = 0.15;
/** Winkelfrequenz des Pendel-Sinus (rad/s) — Periode ≈ 8 s. */
const EUROPE_PENDULUM_FREQUENCY = 0.8;
/** Dämpfungsrate, mit der Idle-Drehung/Pendel nach einem Drag wieder einblenden. */
const IDLE_RESUME_DAMP = 1.5;
/** Dezenter Idle-Puls aller Pin-Köpfe: ±7 % Scale, über pulsePhase versetzt —
 *  etwas kräftiger als zuvor, damit die Marker sichtbar „leben" und zum
 *  Antippen einladen. */
const PIN_IDLE_PULSE_AMPLITUDE = 0.07;
const PIN_IDLE_PULSE_SPEED = 1.6;

// --- Drag-Rotation (Maus/Touch) -----------------------------------------
/** Ab dieser Sichtbarkeit darf per Maus/Touch am Globus gedreht werden. */
const DRAG_VISIBILITY_THRESHOLD = 0.3;
/** Empfindlichkeit der Drag-Rotation um die Y-Achse (Gieren) pro Pixel. */
const DRAG_YAW_SENSITIVITY = 0.005;
/** Empfindlichkeit der Drag-Kippung um die X-Achse (Nicken) pro Pixel. */
const DRAG_PITCH_SENSITIVITY = 0.003;
/** Maximale Kippung nach oben/unten, damit der Globus nie "kopfsteht". */
const DRAG_PITCH_CLAMP = 0.5;
/** Wie lange nach der letzten Drag-Aktivität Idle-Drehung & Europa-Damping pausieren (ms). */
const DRAG_IDLE_SUPPRESS_MS = 2500;
/** Bewegung in Pixeln, ab der ein Touch-Move als Drag statt als Tap/Scroll gewertet wird. */
const TOUCH_AXIS_DECISION_PX = 6;
/** Dämpfungsrate, mit der die Trägheits-Geschwindigkeit nach Loslassen gegen 0 läuft. */
const DRAG_INERTIA_DAMP = 4;
/** Unterhalb dieser Winkelgeschwindigkeit (rad/s) gilt die Trägheit als abgeklungen. */
const DRAG_VELOCITY_EPSILON = 0.0001;

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
  // Lila — ihre bedeutsamen Orte: sie möchte dorthin, ich will sie begleiten
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

// Nadel & Kopf bewusst kräftig: die Pins sollen klar als Marker und als
// antippbar lesbar sein (Runde: Globus verständlicher). Längere, dickere
// Nadel + größerer Kopf + Glow-Halo (siehe Pin unten).
const NEEDLE_LENGTH = 0.16;
const NEEDLE_RADIUS = 0.011;
const HEAD_RADIUS = 0.032;
/** Radius des additiven Glow-Halos um jeden Pin-Kopf — macht die Marker
 *  auffälliger und signalisiert „hier kann man tippen". */
const HEAD_GLOW_RADIUS = HEAD_RADIUS * 1.75;
/** Nadel-Basis liegt minimal unter dem idealen Radius, damit sie auf der
 *  low-poly-Kugel (32×24 Segmente, Flächen liegen leicht innerhalb der
 *  theoretischen Kugel) sicher ohne Spalt aufsitzt. */
const PIN_EMBED = 0.02;

// --- Pin-Tap: Erinnerungs-Label + Herzchen (Runde 4) -----------------------
// Tap vs. Drag: R3F liefert die Down→Up-Pointer-Distanz als `event.delta`
// (Pixel). Als Schwelle dient bewusst dieselbe Konstante wie bei der
// Achsen-Entscheidung der Drag-Logik, damit sich beide Gesten nie überlappen.
const TAP_MAX_DELTA_PX = TOUCH_AXIS_DECISION_PX;
/** Unsichtbare, größere Treffer-Kugel um den Pin-Kopf — die echten Köpfe
 *  (HEAD_RADIUS) wären auf Touch-Geräten viel zu kleine Ziele. Bewusst kleiner
 *  als der Abstand der engsten Pin-Nachbarn (Belgrad↔Ostrog ≈ 0.057). */
const PIN_HIT_RADIUS = 0.05;
/** Dauer des Scale-Pulses am angetippten Pin. */
const PIN_PULSE_DURATION_S = 0.5;
/** Wie stark der Pin beim Puls kurz aufskaliert. */
const PIN_PULSE_AMPLITUDE = 0.8;
/** Gesamt-Lebensdauer des aufgeploppten Labels (inkl. Ausblenden). */
const LABEL_LIFETIME_S = 2.6;
/** Dauer des Pop-Ins (easeOutBack) des Labels. */
const LABEL_POP_S = 0.3;
/** Dauer des Ausblendens am Ende der Label-Lebensdauer. */
const LABEL_FADE_S = 0.35;
/** Abstand des Label-Zentrums über dem Pin-Fuß (lokales Y = Flächennormale). */
const LABEL_OFFSET_Y = 0.3;
const LABEL_WORLD_WIDTH = 0.55;
// Label-Textur (Canvas, pro Pin gecacht): Ortsname auf Creme-Karte mit Rand
// in Pin-Farbe — gleiche Canvas-Technik wie die Globus-Textur, keine Assets.
const LABEL_TEXTURE_WIDTH = 256;
const LABEL_TEXTURE_HEIGHT = 96;
const LABEL_WORLD_HEIGHT =
  LABEL_WORLD_WIDTH * (LABEL_TEXTURE_HEIGHT / LABEL_TEXTURE_WIDTH);
const LABEL_CORNER_RADIUS = 30;
const LABEL_BORDER_WIDTH = 6;
const LABEL_FONT_PX = 40;
const LABEL_MAX_TEXT_WIDTH = LABEL_TEXTURE_WIDTH - 48;
const LABEL_BACKGROUND = "#fdf6ec";
const LABEL_TEXT_COLOR = "#4c3a44";
/** Herzchen, die beim Tap vom Pin aufsteigen. */
const TAP_HEART_COUNT = 5;
const TAP_HEART_DURATION_S = 1.8;
/** Zeitversatz zwischen den einzelnen Herzchen. */
const TAP_HEART_STAGGER_S = 0.15;
/** Aufstiegshöhe der Herzchen über dem Pin-Kopf. */
const TAP_HEART_RISE = 0.45;
const TAP_HEART_MAX_SCALE = 0.055;
/** Seitliche Grundversätze, damit die Herzchen das Label flankieren. */
const TAP_HEART_SPREAD_X = 0.09;
const TAP_HEART_SWAY = 0.035;
/** Gesamtdauer aller Tap-Effekte — danach wird der Tap-State aufgeräumt. */
const TAP_EFFECT_TOTAL_S = Math.max(
  LABEL_LIFETIME_S,
  TAP_HEART_STAGGER_S * (TAP_HEART_COUNT - 1) + TAP_HEART_DURATION_S,
);

/** Aktiver Pin-Tap: welcher Pin, und wann (performance.now()) er begann. */
interface PinTapState {
  name: string;
  startedAtMs: number;
}

const labelTextureCache = new Map<string, THREE.CanvasTexture>();

/** Zeichnet das Erinnerungs-Label einmalig auf ein Canvas — pro Pin gecacht. */
function getPinLabelTexture(name: string, color: string): THREE.CanvasTexture {
  const cached = labelTextureCache.get(name);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_TEXTURE_WIDTH;
  canvas.height = LABEL_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const inset = LABEL_BORDER_WIDTH / 2;
    ctx.beginPath();
    ctx.roundRect(
      inset,
      inset,
      LABEL_TEXTURE_WIDTH - LABEL_BORDER_WIDTH,
      LABEL_TEXTURE_HEIGHT - LABEL_BORDER_WIDTH,
      LABEL_CORNER_RADIUS,
    );
    ctx.fillStyle = LABEL_BACKGROUND;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = LABEL_BORDER_WIDTH;
    ctx.stroke();

    // Lange Namen (z. B. „Bratislava") proportional verkleinern statt clippen.
    ctx.font = `600 ${LABEL_FONT_PX}px 'Inter', sans-serif`;
    const measuredWidth = ctx.measureText(name).width;
    if (measuredWidth > LABEL_MAX_TEXT_WIDTH) {
      const fittedPx = Math.floor(
        (LABEL_FONT_PX * LABEL_MAX_TEXT_WIDTH) / measuredWidth,
      );
      ctx.font = `600 ${fittedPx}px 'Inter', sans-serif`;
    }
    ctx.fillStyle = LABEL_TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, LABEL_TEXTURE_WIDTH / 2, LABEL_TEXTURE_HEIGHT / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  labelTextureCache.set(name, texture);
  return texture;
}

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

interface TapHeartSeed {
  offsetX: number;
  phase: number;
}

function makeTapHeartSeeds(): TapHeartSeed[] {
  return Array.from({ length: TAP_HEART_COUNT }, (_, i) => ({
    offsetX: (i - (TAP_HEART_COUNT - 1) / 2) * TAP_HEART_SPREAD_X,
    phase: Math.random() * Math.PI * 2,
  }));
}

/**
 * Tap-Belohnung eines Pins: das Erinnerungs-Label ploppt als Sprite über dem
 * Pin auf (easeOutBack-Pop, dann Fade-out) und 3 kleine Herzchen steigen vom
 * Pin-Kopf entlang der Flächennormale auf. Wird pro Tap frisch gemountet
 * (key=startedAtMs) und nach TAP_EFFECT_TOTAL_S wieder entfernt.
 */
function PinTapEffects({
  pin,
  startedAtMs,
  reducedMotion,
}: {
  pin: PinDef;
  startedAtMs: number;
  reducedMotion: boolean;
}) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const spriteMaterialRef = useRef<THREE.SpriteMaterial>(null);
  const heartsRef = useRef<THREE.InstancedMesh>(null);
  const labelTexture = getPinLabelTexture(pin.name, pin.color);
  const seeds = useMemo(() => makeTapHeartSeeds(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const worldQuaternion = useMemo(() => new THREE.Quaternion(), []);

  useFrame((state) => {
    const elapsed = (performance.now() - startedAtMs) / 1000;

    const sprite = spriteRef.current;
    const spriteMaterial = spriteMaterialRef.current;
    if (sprite && spriteMaterial) {
      const pop = reducedMotion
        ? 1
        : easeOutBack(Math.min(elapsed / LABEL_POP_S, 1));
      sprite.scale.set(
        Math.max(LABEL_WORLD_WIDTH * pop, 0.0001),
        Math.max(LABEL_WORLD_HEIGHT * pop, 0.0001),
        1,
      );
      spriteMaterial.opacity = THREE.MathUtils.clamp(
        (LABEL_LIFETIME_S - elapsed) / LABEL_FADE_S,
        0,
        1,
      );
    }

    const hearts = heartsRef.current;
    if (!hearts) return;
    // Instanzen billboarden: Globus-/Pin-Rotation herausrechnen, damit die
    // Herz-Silhouette immer frontal zur Kamera lesbar bleibt.
    hearts.getWorldQuaternion(worldQuaternion);
    worldQuaternion.invert().multiply(state.camera.quaternion);
    // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const heartT = THREE.MathUtils.clamp(
        (elapsed - i * TAP_HEART_STAGGER_S) / TAP_HEART_DURATION_S,
        0,
        1,
      );
      // Sinus-Halbwelle: aus dem Nichts wachsen, oben wieder verschwinden.
      const scale = Math.max(
        Math.sin(heartT * Math.PI) * TAP_HEART_MAX_SCALE,
        0.0001,
      );
      dummy.position.set(
        seed.offsetX + Math.sin(elapsed * 3 + seed.phase) * TAP_HEART_SWAY,
        NEEDLE_LENGTH + HEAD_RADIUS + heartT * TAP_HEART_RISE,
        0,
      );
      dummy.quaternion.copy(worldQuaternion);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      hearts.setMatrixAt(i, dummy.matrix);
    }
    hearts.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <sprite
        ref={spriteRef}
        position={[0, LABEL_OFFSET_Y, 0]}
        scale={[0.0001, 0.0001, 1]}
      >
        <spriteMaterial
          ref={spriteMaterialRef}
          map={labelTexture}
          transparent
          depthWrite={false}
        />
      </sprite>
      {!reducedMotion && (
        <instancedMesh
          ref={heartsRef}
          args={[getHeartGeometry(), undefined, TAP_HEART_COUNT]}
          frustumCulled={false}
        >
          <meshStandardMaterial color={pin.color} roughness={0.4} />
        </instancedMesh>
      )}
    </group>
  );
}

function Pin({
  pin,
  scroll,
  index,
  reducedMotion,
  pulsePhase,
  tap,
  onTap,
}: {
  pin: PinDef;
  scroll: ScrollState;
  index: number;
  reducedMotion: boolean;
  pulsePhase: number;
  tap: PinTapState | null;
  onTap: (name: string) => void;
}) {
  const scaleGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  /** Der auf DIESEN Pin bezogene aktive Tap (sonst null). */
  const activeTap = tap !== null && tap.name === pin.name ? tap : null;

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
    let pinScale = Math.max(easeOutBack(revealT), 0.0001);
    // Tap-Puls: kurzer Sinus-Halbwellen-Pop multiplikativ auf den Reveal-Scale.
    if (activeTap !== null && !reducedMotion) {
      const tapT = THREE.MathUtils.clamp(
        (performance.now() - activeTap.startedAtMs) /
          1000 /
          PIN_PULSE_DURATION_S,
        0,
        1,
      );
      pinScale *= 1 + Math.sin(tapT * Math.PI) * PIN_PULSE_AMPLITUDE;
    }
    // Dezenter Dauer-Puls (±5 %), pro Pin über pulsePhase versetzt —
    // reduced-motion: statisch.
    if (!reducedMotion) {
      pinScale *=
        1 +
        Math.sin(state.clock.elapsedTime * PIN_IDLE_PULSE_SPEED + pulsePhase) *
          PIN_IDLE_PULSE_AMPLITUDE;
    }
    scaleGroup.scale.setScalar(pinScale);

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

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    // Nur echte Taps (kaum Pointer-Bewegung) — Drag-Gesten drehen weiterhin
    // ausschließlich den Globus (bestehende window-Listener bleiben unberührt).
    if (event.delta > TAP_MAX_DELTA_PX) return;
    event.stopPropagation();
    onTap(pin.name);
  };

  return (
    <group
      position={position}
      quaternion={quaternion}
      onClick={handleClick}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <group ref={scaleGroupRef} scale={0}>
        {/* Unsichtbare, größere Treffer-Kugel um den Kopf — sie skaliert mit
            dem Reveal, ist also vor dem Aufploppen des Pins nicht tappbar.
            three's Raycaster prüft `visible` nicht, unsichtbar reicht. */}
        <mesh position={[0, NEEDLE_LENGTH, 0]} visible={false}>
          <sphereGeometry args={[PIN_HIT_RADIUS, 8, 6]} />
        </mesh>
        <mesh position={[0, NEEDLE_LENGTH / 2, 0]}>
          <cylinderGeometry
            args={[NEEDLE_RADIUS, NEEDLE_RADIUS, NEEDLE_LENGTH, 8]}
          />
          <meshStandardMaterial
            color={pin.color}
            roughness={0.4}
            emissive={pin.color}
            emissiveIntensity={0.25}
          />
        </mesh>
        {/* Weicher additiver Glow-Halo hinter dem Kopf — hebt jeden Pin
            vom hellen Globus ab und lässt ihn als antippbares Ziel lesen. */}
        <mesh position={[0, NEEDLE_LENGTH, 0]}>
          <sphereGeometry args={[HEAD_GLOW_RADIUS, 12, 10]} />
          <meshBasicMaterial
            color={pin.color}
            transparent
            opacity={0.22}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh position={[0, NEEDLE_LENGTH, 0]}>
          <sphereGeometry args={[HEAD_RADIUS, 14, 12]} />
          <meshStandardMaterial
            color={pin.color}
            roughness={0.3}
            emissive={pin.color}
            emissiveIntensity={0.55}
          />
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
      {/* Label + Herzchen außerhalb der Scale-Gruppe, damit der Tap-Puls des
          Pins das Label nicht mitskaliert. key erzwingt pro Tap frische Seeds. */}
      {activeTap !== null && (
        <PinTapEffects
          key={activeTap.startedAtMs}
          pin={pin}
          startedAtMs={activeTap.startedAtMs}
          reducedMotion={reducedMotion}
        />
      )}
    </group>
  );
}

/** Zustand eines aktiven Pointers während einer Drag-Geste. */
interface DragPointerState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  isTouch: boolean;
  /** Bei Touch: ob Horizontal/Vertikal-Dominanz bereits entschieden wurde. */
  decided: boolean;
  /** Ob diese Geste als Globus-Drag konsumiert wird (vs. z.B. vertikales Scrollen). */
  consuming: boolean;
}

export const GlobeScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<THREE.Group>(null);
  const texture = getGlobeTexture();

  /** Von useFrame gepflegt: darf gerade per Maus/Touch gedreht werden? */
  const visibleEnoughRef = useRef(false);
  /** True, während eine Drag-Geste aktiv konsumiert wird. */
  const dragActiveRef = useRef(false);
  const pointerStateRef = useRef<DragPointerState | null>(null);
  /** Seit dem letzten useFrame-Tick akkumulierte Pointer-Deltas (Pixel). */
  const pendingDeltaRef = useRef({ x: 0, y: 0 });
  /** Gieren-Winkelgeschwindigkeit (rad/s) für die Trägheit nach Loslassen. */
  const velocityRef = useRef(0);
  /** Zeitstempel (performance.now()) der letzten Drag-Aktivität. */
  const lastDragActivityRef = useRef(0);
  /** Weiches Wiederanlaufen der Idle-Bewegung nach einem Drag (0 → 1 gedämpft). */
  const idleBlendRef = useRef(0);

  /** Aktiver Pin-Tap (Label + Herzchen); null, wenn nichts aufgeploppt ist. */
  const [activeTap, setActiveTap] = useState<PinTapState | null>(null);

  const handlePinTap = useCallback((name: string) => {
    // Immutable: pro Tap ein frisches State-Objekt — erneutes Tippen auf
    // denselben Pin startet die Effekte damit sauber neu.
    setActiveTap({ name, startedAtMs: performance.now() });
  }, []);

  useEffect(() => {
    const beginConsuming = () => {
      dragActiveRef.current = true;
      lastDragActivityRef.current = performance.now();
      velocityRef.current = 0;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!visibleEnoughRef.current) return;
      if ((event.target as HTMLElement | null)?.closest("button, a")) return;

      const isTouch = event.pointerType === "touch";
      pointerStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        isTouch,
        // Maus/Pen: sofort konsumieren. Touch: erst nach Achsen-Entscheidung.
        decided: !isTouch,
        consuming: !isTouch,
      };
      if (!isTouch) {
        beginConsuming();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const state = pointerStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      if (state.isTouch && !state.decided) {
        const totalDx = event.clientX - state.startX;
        const totalDy = event.clientY - state.startY;
        if (
          Math.abs(totalDx) < TOUCH_AXIS_DECISION_PX &&
          Math.abs(totalDy) < TOUCH_AXIS_DECISION_PX
        ) {
          state.lastX = event.clientX;
          state.lastY = event.clientY;
          return;
        }
        state.decided = true;
        // Nur horizontal-dominante Touch-Drags konsumieren, damit vertikales
        // Scrollen (Section-Navigation) unangetastet bleibt.
        state.consuming = Math.abs(totalDx) > Math.abs(totalDy);
        if (state.consuming) {
          beginConsuming();
        }
      }

      const deltaX = event.clientX - state.lastX;
      const deltaY = event.clientY - state.lastY;
      state.lastX = event.clientX;
      state.lastY = event.clientY;

      if (!state.consuming) return;

      event.preventDefault();
      pendingDeltaRef.current.x += deltaX;
      pendingDeltaRef.current.y += deltaY;
      lastDragActivityRef.current = performance.now();
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const state = pointerStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (state.consuming) {
        lastDragActivityRef.current = performance.now();
      }
      pointerStateRef.current = null;
      dragActiveRef.current = false;
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, []);

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    visibleEnoughRef.current = vis > DRAG_VISIBILITY_THRESHOLD;

    // Abgelaufene Tap-Effekte einmalig aufräumen — unmountet Label + Herzchen.
    if (
      activeTap !== null &&
      performance.now() - activeTap.startedAtMs > TAP_EFFECT_TOTAL_S * 1000
    ) {
      setActiveTap(null);
    }

    if (vis < VISIBILITY_EPSILON) return;

    const progress = sectionProgress(scroll, index);
    const targetScale = 0.88 + progress * 0.12;
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, 4, delta),
    );

    const rotationGroup = rotationRef.current;
    if (!rotationGroup) return;

    // Akkumulierte Drag-Deltas dieses Frames konsumieren und auf die
    // Globus-Gruppe anwenden (Gieren frei, Nicken begrenzt).
    const pendingDelta = pendingDeltaRef.current;
    if (pendingDelta.x !== 0 || pendingDelta.y !== 0) {
      rotationGroup.rotation.y += pendingDelta.x * DRAG_YAW_SENSITIVITY;
      rotationGroup.rotation.x = THREE.MathUtils.clamp(
        rotationGroup.rotation.x + pendingDelta.y * DRAG_PITCH_SENSITIVITY,
        -DRAG_PITCH_CLAMP,
        DRAG_PITCH_CLAMP,
      );
      velocityRef.current =
        delta > 0 ? (pendingDelta.x * DRAG_YAW_SENSITIVITY) / delta : 0;
      pendingDelta.x = 0;
      pendingDelta.y = 0;
    }

    const dragSuppressed =
      performance.now() - lastDragActivityRef.current < DRAG_IDLE_SUPPRESS_MS;

    if (dragSuppressed) {
      // Während des Drags und für die Grace-Period danach: Idle-Drehung und
      // Europa-Damping pausieren. Nur nach Loslassen (nicht während aktivem
      // Drag) und nur ohne reduced-motion läuft die Trägheit sanft aus.
      idleBlendRef.current = 0;
      if (!dragActiveRef.current && !reducedMotion) {
        if (Math.abs(velocityRef.current) > DRAG_VELOCITY_EPSILON) {
          rotationGroup.rotation.y += velocityRef.current * delta;
          velocityRef.current = THREE.MathUtils.damp(
            velocityRef.current,
            0,
            DRAG_INERTIA_DAMP,
            delta,
          );
        }
      } else if (!dragActiveRef.current) {
        velocityRef.current = 0;
      }
      return;
    }

    // Nach der Drag-Grace-Period blendet die Idle-Bewegung weich wieder ein.
    idleBlendRef.current = THREE.MathUtils.damp(
      idleBlendRef.current,
      1,
      IDLE_RESUME_DAMP,
      delta,
    );

    if (progress > EUROPE_LOCK_THRESHOLD) {
      // Europa bleibt verankert, aber der Globus pendelt sanft darum —
      // ein fest eingefrorener Anker wirkte leblos. Das Damping übernimmt
      // zugleich das weiche Wiedereinschwingen nach einem Drag.
      // reduced-motion: statischer Anker (Pendel-Anteil 0).
      const pendulum = reducedMotion
        ? 0
        : Math.sin(state.clock.elapsedTime * EUROPE_PENDULUM_FREQUENCY) *
          EUROPE_PENDULUM_AMPLITUDE *
          idleBlendRef.current;
      const targetRotationY = EUROPE_TARGET_ROTATION_Y + pendulum;
      // Kürzesten Drehweg zum Ziel wählen, egal wo die Idle-Drehung stand.
      const current = rotationGroup.rotation.y;
      const twoPi = Math.PI * 2;
      const shortestTarget =
        current +
        THREE.MathUtils.euclideanModulo(
          targetRotationY - current + Math.PI,
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
        (rotationGroup.rotation.y +
          delta * IDLE_ROTATION_SPEED * idleBlendRef.current) %
        (Math.PI * 2);
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.55, 0]}>
      <group rotation={[0, 0, EARTH_AXIS_TILT]}>
        <group ref={rotationRef}>
          <mesh
            // R3F raycastet nur Objekte MIT Handlern — ohne diese Stopper
            // würden Taps/Hovers durch den Globus hindurch Pins auf der
            // Rückseite treffen. stopPropagation lässt die Kugel als
            // Okklusions-Fläche wirken; die Drag-Listener (window) bleiben
            // davon unberührt.
            onClick={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
            onPointerOver={(event: ThreeEvent<PointerEvent>) =>
              event.stopPropagation()
            }
          >
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
              tap={activeTap}
              onTap={handlePinTap}
            />
          ))}
        </group>
      </group>
    </group>
  );
};

interface LegendEntry {
  color: string;
  /** Was diese Farbe bedeutet — der Kern, der vorher fehlte. */
  meaning: string;
  /** Die konkreten Orte dieser Farbe (aus PIN_DEFS). */
  places: string;
}

// Farbbedeutungen exakt aus PIN_DEFS abgeleitet (Rot = besucht, Gold =
// Traumziele, Lila = ihre bedeutsamen Orte, dahin will ich sie begleiten).
// Reihenfolge = Reihenfolge der Pins.
const LEGEND_ENTRIES: LegendEntry[] = [
  {
    color: RED,
    meaning: "Wo wir schon waren",
    places: "Palermo, Como, Bratislava",
  },
  {
    color: GOLD,
    meaning: "Wohin wir noch wollen",
    places: "Paris, Santorini, New York, Tokio",
  },
  {
    color: LILA,
    meaning: "Deine Orte — da will ich mit dir hin",
    places: "Belgrad, Ostrog, Hilandar, Ohrid",
  },
];

function LegendRow({ color, meaning, places }: LegendEntry) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "0.4rem",
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: "0.85rem",
        color: "var(--text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "11px",
          height: "11px",
          borderRadius: "50%",
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 600 }}>{meaning}</span>
      <span style={{ opacity: 0.6 }}>{places}</span>
    </p>
  );
}

export const GlobeHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 6</span>
    <h2 className="exp-title">Unsere Welt</h2>
    <p className="exp-subtitle">
      Dreh am Globus und tipp die Nadeln an. Die Farbe verrät, was uns ein Ort
      bedeutet:
    </p>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        marginTop: "0.2rem",
      }}
    >
      {LEGEND_ENTRIES.map((entry) => (
        <LegendRow
          key={entry.meaning}
          color={entry.color}
          meaning={entry.meaning}
          places={entry.places}
        />
      ))}
    </div>
  </div>
);
