import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useScroll, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { sectionProgress, sectionVisibility } from "../useSectionProgress";
import { usePrefersReducedMotion } from "../../three/hooks/useWebGL";
import { getSoftShadowTexture } from "../softShadow";
import { PAGES } from "../constants";
import type { SectionProps } from "../types";

const ROLL_COUNT = 5;
const STEAM_COUNT = 36;
const STEAM_COLUMNS = 3;
const STEAM_LOOP_DURATION = 3.6;
const STEAM_RISE_HEIGHT = 1.3;
const STEAM_BASE_Y = 0.28;
/** Wie schnell die Dampf-Intensität abfällt, wenn die Section vom
 *  Zentrum wegscrollt (1/Progress-Einheit). */
const STEAM_INTENSITY_FALLOFF = 1.6;
const FLECK_COUNT = 8;
/** Unterhalb dieser Sichtbarkeit lohnt sich keine Matrix-Neuberechnung mehr. */
const VISIBILITY_EPSILON = 0.005;

// --- Klick/Tipp-Interaktion: Rolle wackelt + Dampf-Wölkchen ---------------
/** Klick nur werten, wenn sich der Pointer < 8px bewegt hat (Tap vs. Drag/Scroll). */
const TAP_MAX_DELTA_PX = 8;
/** Ab dieser Sichtbarkeit reagieren die Rollen auf Klick/Tipp (analog Globus-Drag). */
const INTERACTION_VISIBILITY_THRESHOLD = 0.3;
/** Gedämpfter Rotations-Puls der angetippten Rolle (Wackeln). */
const WOBBLE_DURATION = 1.0;
/** Winkelgeschwindigkeit des Wackel-Sinus (rad/s) — ca. 3,5 Schwingungen. */
const WOBBLE_ANGULAR_SPEED = 22;
const WOBBLE_AMPLITUDE = 0.4;
/** Dampfstoß: kleine transparente Kugeln steigen auf und blenden per Scale aus. */
const PUFF_RISE_DURATION = 1.1;
const PUFF_RISE_HEIGHT = 0.8;
/** Start-Höhe knapp über der Rollen-Oberkante (Rolle: y=0.1, Radius 0.15). */
const PUFF_BASE_Y = 0.28;
const PUFF_SWAY = 0.08;

interface PuffSeed {
  dx: number;
  dz: number;
  delay: number;
  scale: number;
  swayPhase: number;
}

/** Drei Wölkchen, leicht versetzt und zeitlich gestaffelt — kurzer Dampfstoß. */
const PUFF_SEEDS: PuffSeed[] = [
  { dx: 0, dz: 0, delay: 0, scale: 0.07, swayPhase: 0 },
  { dx: 0.06, dz: 0.04, delay: 0.14, scale: 0.05, swayPhase: 2.1 },
  { dx: -0.06, dz: -0.03, delay: 0.28, scale: 0.06, swayPhase: 4.2 },
];
const PUFF_COUNT = PUFF_SEEDS.length;
const PUFF_TOTAL_DURATION =
  PUFF_RISE_DURATION + Math.max(...PUFF_SEEDS.map((seed) => seed.delay));

// --- Standard-Idle: deutlicher Dauer-Dampf über dem Teller ----------------
/** Deutlich langsamer als die Klick-Wölkchen (vgl. PUFF_RISE_DURATION). */
const IDLE_STEAM_LOOP_DURATION = 4.4;
/** Steigt höher auf als die Klick-Wölkchen, dafür gemächlich. */
const IDLE_STEAM_RISE_HEIGHT = 0.95;
const IDLE_STEAM_SWAY = 0.09;
/** Eigenes Material statt des geteilten Klick-Puff-Materials (Opacity 0.35):
 *  kräftiger deckend, damit der Dampf beim ersten Blick auffällt. */
const IDLE_STEAM_OPACITY = 0.55;

interface IdleSteamSeed {
  x: number;
  z: number;
  /** Zeitversatz innerhalb der Endlosschleife — die Wölkchen steigen gestaffelt auf. */
  phase: number;
  swayPhase: number;
  scale: number;
}

/** Fünf große Wölkchen in EIGENEM Instanz-Mesh mit eigenem, deutlich
 *  sichtbarem Material. Vorher: 3 Mini-Instanzen (Scale 0.032–0.038) im
 *  geteilten Klick-Puff-Mesh — bei Opacity 0.35 praktisch unsichtbar. */
const IDLE_STEAM_SEEDS: IdleSteamSeed[] = [
  { x: -0.34, z: 0.16, phase: 0, swayPhase: 0.9, scale: 0.075 },
  {
    x: 0.3,
    z: -0.12,
    phase: IDLE_STEAM_LOOP_DURATION * 0.2,
    swayPhase: 3.1,
    scale: 0.06,
  },
  {
    x: 0.04,
    z: 0.24,
    phase: IDLE_STEAM_LOOP_DURATION * 0.4,
    swayPhase: 5.2,
    scale: 0.09,
  },
  {
    x: -0.12,
    z: -0.26,
    phase: IDLE_STEAM_LOOP_DURATION * 0.6,
    swayPhase: 1.8,
    scale: 0.07,
  },
  {
    x: 0.42,
    z: 0.2,
    phase: IDLE_STEAM_LOOP_DURATION * 0.8,
    swayPhase: 4.0,
    scale: 0.065,
  },
];
const IDLE_STEAM_COUNT = IDLE_STEAM_SEEDS.length;

// --- Verstecktes Herz-Ei: 3 schnelle Taps auf Rollen/Teller ----------------
// Bewusst nirgends im UI angeteasert. Drei Taps innerhalb des Zeitfensters
// lösen eine gestaffelte Hüpf-Welle aller Rollen aus, plus einen Dampf-Burst,
// dessen Wölkchen sich kurz zu einer Herz-Silhouette formieren.
const EGG_TAP_COUNT = 3;
const EGG_TAP_WINDOW_S = 2.5;
/** Flugzeit eines einzelnen Rollen-Hüpfers. */
const EGG_HOP_DURATION_S = 0.45;
/** Zeitversatz zwischen den Rollen — ergibt die Welle über den Teller. */
const EGG_HOP_STAGGER_S = 0.12;
const EGG_HOP_HEIGHT = 0.22;
// Squash & Stretch: in der Luft wird die liegende Rolle runder/kürzer, bei
// der Landung platter/breiter. Lokal: y = Längsachse, x/z = Querschnitt.
const EGG_AIR_FATTEN = 0.18;
const EGG_AIR_SHORTEN = 0.12;
const EGG_LAND_WIDEN = 0.2;
const EGG_LAND_FLATTEN = 0.16;
const EGG_LAND_DURATION_S = 0.18;
/** reduced-motion-Ersatz: sanftes Aufleuchten der Rollen statt Hüpfen. */
const EGG_GLOW_DURATION_S = 1.4;
const EGG_GLOW_MAX_INTENSITY = 0.55;
const EGG_GLOW_COLOR = "#ffc98a";

/** Dampf-Burst in Herz-Formation (eigenes Instanz-Mesh, ruht bei Scale 0). */
const HEART_STEAM_COUNT = 8;
const HEART_STEAM_OPACITY = 0.6;
const HEART_BURST_DURATION_S = 1.9;
const HEART_BURST_RISE = 0.85;
/** Anteil der Burst-Dauer, in dem die Wölkchen in die Herz-Form auffächern. */
const HEART_FORM_PORTION = 0.35;
const HEART_PUFF_SCALE = 0.075;
/** Größe der Herz-Silhouette (Skalierung der parametrischen Herzkurve). */
const HEART_SHAPE_SCALE = 0.032;

/** Punkte auf der klassischen parametrischen Herzkurve, frontal in der
 *  lokalen XY-Ebene (x horizontal, y = Aufstiegsachse über dem Teller). */
function makeHeartFormationOffsets(count: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const t = ((i + 0.5) / count) * Math.PI * 2;
    return {
      x: 16 * Math.sin(t) ** 3 * HEART_SHAPE_SCALE,
      y:
        (13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t)) *
        HEART_SHAPE_SCALE,
    };
  });
}
const HEART_STEAM_OFFSETS = makeHeartFormationOffsets(HEART_STEAM_COUNT);

/** Gesamtdauer der Hüpf-Welle (letzte Rolle inkl. Landungs-Squash). */
const EGG_WAVE_TOTAL_S =
  EGG_HOP_STAGGER_S * (ROLL_COUNT - 1) +
  EGG_HOP_DURATION_S +
  EGG_LAND_DURATION_S;
const EGG_EFFECT_TOTAL_S = Math.max(EGG_WAVE_TOTAL_S, HEART_BURST_DURATION_S);

/** Laufender Wackel-Puls einer angetippten Rolle. */
interface RollWobbleState {
  index: number;
  start: number;
}

/** Laufender Dampfstoß über einer angetippten Rolle. */
interface SteamPuffState {
  originX: number;
  originZ: number;
  start: number;
}

// Geschmorter Krautwickel-Ton: Basisgrün leicht Richtung gebräuntem Braun gemischt.
const ROLL_BASE_COLOR = mixColor("#9aa465", "#7a5a35", 0.35);
const SEAM_COLOR = "#6f7a44";

interface RollData {
  position: [number, number, number];
  rotationY: number;
  tilt: number;
  color: string;
  seamAngles: [number, number];
}

function mixColor(a: string, b: string, t: number): string {
  const color = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return `#${color.getHexString()}`;
}

/** Leicht variierte Färbung pro Rolle für ein handgemachtes Aussehen. */
function shiftColor(base: string, offset: number): string {
  const color = new THREE.Color(base);
  color.offsetHSL(0, 0, offset);
  return `#${color.getHexString()}`;
}

function makeRolls(count: number): RollData[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
    const radius = 0.3 + Math.random() * 0.22;
    return {
      position: [Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius],
      rotationY: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 0.18,
      color: shiftColor(ROLL_BASE_COLOR, (Math.random() - 0.5) * 0.1),
      seamAngles: [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2],
    };
  });
}

interface SteamSeed {
  x: number;
  z: number;
  phase: number;
  swayAmount: number;
  scale: number;
}

function makeSteamSeeds(count: number, columns: number): SteamSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const column = i % columns;
    const columnX = (column - (columns - 1) / 2) * 0.32;
    return {
      x: columnX + (Math.random() - 0.5) * 0.08,
      z: (Math.random() - 0.5) * 0.15,
      phase: Math.random() * STEAM_LOOP_DURATION,
      swayAmount: 0.08 + Math.random() * 0.06,
      scale: 0.03 + Math.random() * 0.03,
    };
  });
}

interface FleckSeed {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** Streut Flecken nah an den tatsächlichen Rollen-Positionen, statt frei über dem Teller. */
function makeFleckSeeds(rolls: RollData[], count: number): FleckSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const roll = rolls[i % rolls.length];
    const jitterX = (Math.random() - 0.5) * 0.16;
    const jitterZ = (Math.random() - 0.5) * 0.16;
    return {
      x: roll.position[0] + jitterX,
      y: roll.position[1] + 0.11 + Math.random() * 0.04,
      z: roll.position[2] + jitterZ,
      scale: 0.012 + Math.random() * 0.008,
    };
  });
}

/** Zwei dünne Nahtbänder pro Rolle deuten die Kohlblatt-Wicklung an. */
function WrapSeams({ angles }: { angles: [number, number] }) {
  return (
    <>
      {angles.map((angle, i) => (
        <mesh
          key={i}
          position={[Math.sin(angle) * 0.145, 0, Math.cos(angle) * 0.145]}
          rotation={[0, angle, 0]}
        >
          <boxGeometry args={[0.045, 0.5, 0.012]} />
          <meshStandardMaterial color={SEAM_COLOR} roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

function PaprikaFlecks({ rolls, count }: { rolls: RollData[]; count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeFleckSeeds(rolls, count), [rolls, count]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    seeds.forEach((seed, i) => {
      dummy.position.set(seed.x, seed.y, seed.z);
      dummy.scale.setScalar(seed.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [seeds]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#c04a2f" roughness={0.6} />
    </instancedMesh>
  );
}

function SarmaRolls({
  rolls,
  groupRefs,
  materialRefs,
  onRollTap,
  onRollPointerOver,
  onRollPointerOut,
}: {
  rolls: RollData[];
  /** Von der Szene gepflegtes Array — der useFrame-Loop wackelt darüber. */
  groupRefs: RefObject<(THREE.Group | null)[]>;
  /** Rollen-Materialien fürs reduced-motion-Aufleuchten des Herz-Eis. */
  materialRefs: RefObject<(THREE.MeshStandardMaterial | null)[]>;
  onRollTap: (index: number, event: ThreeEvent<MouseEvent>) => void;
  onRollPointerOver: () => void;
  onRollPointerOut: () => void;
}) {
  return (
    <>
      {rolls.map((roll, i) => (
        <group
          key={i}
          ref={(node) => {
            groupRefs.current[i] = node;
          }}
          position={roll.position}
          rotation={[Math.PI / 2, roll.rotationY, roll.tilt]}
          onClick={(event) => onRollTap(i, event)}
          onPointerOver={onRollPointerOver}
          onPointerOut={onRollPointerOut}
        >
          <mesh>
            <capsuleGeometry args={[0.15, 0.4, 6, 12]} />
            <meshStandardMaterial
              ref={(node) => {
                materialRefs.current[i] = node;
              }}
              color={roll.color}
              roughness={0.75}
              emissive={EGG_GLOW_COLOR}
              emissiveIntensity={0}
            />
          </mesh>
          <WrapSeams angles={roll.seamAngles} />
          {/* Zarter Glasur-Schimmer: leicht größere, transparente Hülle */}
          <mesh scale={1.06}>
            <capsuleGeometry args={[0.15, 0.4, 6, 12]} />
            <meshStandardMaterial
              color="#e8a34d"
              roughness={0.25}
              transparent
              opacity={0.15}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      <PaprikaFlecks rolls={rolls} count={FLECK_COUNT} />
      {/* Kleiner Kräutergarnitur-Zweig */}
      <mesh position={[0.05, 0.24, -0.05]} rotation={[0.3, 0.4, 0]}>
        <coneGeometry args={[0.03, 0.14, 6]} />
        <meshStandardMaterial color="#5c7a3f" roughness={0.7} />
      </mesh>
      <mesh position={[0.09, 0.28, -0.02]}>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshStandardMaterial color="#6f8f4a" roughness={0.7} />
      </mesh>
    </>
  );
}

function Steam({
  intensityRef,
  reducedMotion,
  scroll,
  index,
}: {
  intensityRef: RefObject<number>;
  reducedMotion: boolean;
  scroll: ReturnType<typeof useScroll>;
  index: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => makeSteamSeeds(STEAM_COUNT, STEAM_COLUMNS), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sectionVisibility(scroll, index) < VISIBILITY_EPSILON) return;
    const intensity = intensityRef.current;
    const t = state.clock.elapsedTime;

    // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      let y = STEAM_BASE_Y;
      let x = seed.x;
      let bump = 1;
      if (!reducedMotion) {
        const loopT =
          ((t + seed.phase) % STEAM_LOOP_DURATION) / STEAM_LOOP_DURATION;
        y = STEAM_BASE_Y + loopT * STEAM_RISE_HEIGHT;
        x =
          seed.x +
          Math.sin(loopT * Math.PI * 2.4 + seed.phase) * seed.swayAmount;
        bump = Math.sin(loopT * Math.PI);
      }
      dummy.position.set(x, y, seed.z);
      dummy.scale.setScalar(seed.scale * bump * intensity);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, STEAM_COUNT]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        color="#ffffff"
        transparent
        opacity={0.25}
        roughness={0.9}
      />
    </instancedMesh>
  );
}

export const SarmaScene = ({ index }: SectionProps) => {
  const scroll = useScroll();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const plateGroupRef = useRef<THREE.Group>(null);
  const intensityRef = useRef(0);
  const rolls = useMemo(() => makeRolls(ROLL_COUNT), []);
  const shadowTexture = getSoftShadowTexture();

  /** Von useFrame gepflegt: reagieren die Rollen gerade auf Klick/Tipp? */
  const visibleEnoughRef = useRef(false);
  const rollGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const rollMaterialRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  /** Tap-Anfrage (Roll-Index) aus dem Event-Handler — im useFrame-Loop konsumiert. */
  const tapRequestRef = useRef<number | null>(null);
  /** Teller-Tap (zählt nur für die versteckte Kombo) — im useFrame-Loop konsumiert. */
  const plateTapPendingRef = useRef(false);
  /** clock-Zeiten der letzten EGG_TAP_COUNT Taps für die Kombo-Erkennung. */
  const comboTapTimesRef = useRef<number[]>(
    Array.from({ length: EGG_TAP_COUNT }, () => Number.NEGATIVE_INFINITY),
  );
  /** Startzeit (clock) des laufenden Herz-Eis; null = inaktiv. */
  const eggStartRef = useRef<number | null>(null);
  const wobbleRef = useRef<RollWobbleState | null>(null);
  const puffRef = useRef<SteamPuffState | null>(null);
  const puffMeshRef = useRef<THREE.InstancedMesh>(null);
  const idleSteamMeshRef = useRef<THREE.InstancedMesh>(null);
  const heartSteamMeshRef = useRef<THREE.InstancedMesh>(null);
  const puffDummy = useMemo(() => new THREE.Object3D(), []);

  /** sectionProgress ist bei zentrierter Section genau index/(PAGES-1) —
   *  dort soll die Dampf-Intensität ihr Maximum haben. (Vorher fälschlich
   *  fix 0.85: der Ambient-Dampf lief beim Betrachten des Tellers dadurch
   *  nur mit ~50 % Intensität und war kaum zu sehen.) */
  const steamPeakProgress = index / (PAGES - 1);

  // InstancedMeshes starten mit Identitäts-Matrizen (sichtbare Kugeln) —
  // alle Effekt-Instanzen (Klick-Wölkchen, Idle-Dampf, Herz-Burst) deshalb
  // einmalig auf Scale 0 setzen, bis der useFrame-Loop sie animiert.
  useEffect(() => {
    const dummy = new THREE.Object3D();
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    const meshes = [
      puffMeshRef.current,
      idleSteamMeshRef.current,
      heartSteamMeshRef.current,
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, []);

  const handleRollTap = (rollIndex: number, event: ThreeEvent<MouseEvent>) => {
    if (!visibleEnoughRef.current) return;
    if (event.delta > TAP_MAX_DELTA_PX) return;
    // Nur die vorderste getroffene Rolle reagiert.
    event.stopPropagation();
    tapRequestRef.current = rollIndex;
  };

  /** Teller-Taps zählen ebenfalls zur versteckten Kombo, lösen aber weder
   *  Wackeln noch Einzel-Puff aus (und ändern bewusst keinen Cursor). */
  const handlePlateTap = (event: ThreeEvent<MouseEvent>) => {
    if (!visibleEnoughRef.current) return;
    if (event.delta > TAP_MAX_DELTA_PX) return;
    event.stopPropagation();
    plateTapPendingRef.current = true;
  };

  const handleRollPointerOver = () => {
    if (visibleEnoughRef.current) {
      document.body.style.cursor = "pointer";
    }
  };

  const handleRollPointerOut = () => {
    document.body.style.cursor = "";
  };

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const vis = sectionVisibility(scroll, index);
    root.visible = vis > 0.01;
    visibleEnoughRef.current = vis > INTERACTION_VISIBILITY_THRESHOLD;

    const t = state.clock.elapsedTime;
    const progress = sectionProgress(scroll, index);

    // Tap-Anfrage konsumieren: Wackeln + Dampfstoß an der angetippten Rolle.
    const tappedIndex = tapRequestRef.current;
    if (tappedIndex !== null) {
      tapRequestRef.current = null;
      const tappedRoll = rolls[tappedIndex];
      if (!reducedMotion) {
        wobbleRef.current = { index: tappedIndex, start: t };
      }
      puffRef.current = {
        originX: tappedRoll.position[0],
        originZ: tappedRoll.position[2],
        start: t,
      };
    }

    // Versteckte Kombo: Roll- UND Teller-Taps zählen. Drei Taps innerhalb
    // von EGG_TAP_WINDOW_S starten das Herz-Ei (nie, solange eins läuft).
    const hadTap = tappedIndex !== null || plateTapPendingRef.current;
    plateTapPendingRef.current = false;
    if (hadTap && eggStartRef.current === null) {
      const comboTimes = comboTapTimesRef.current;
      for (let i = 0; i < comboTimes.length - 1; i += 1) {
        comboTimes[i] = comboTimes[i + 1];
      }
      comboTimes[comboTimes.length - 1] = t;
      if (t - comboTimes[0] <= EGG_TAP_WINDOW_S) {
        eggStartRef.current = t;
        for (let i = 0; i < comboTimes.length; i += 1) {
          comboTimes[i] = Number.NEGATIVE_INFINITY;
        }
      }
    }

    // Herz-Ei: gestaffelte Hüpf-Welle mit Squash&Stretch + Dampf-Herz
    // (reduced-motion: nur sanftes Aufleuchten). Alle Hüllkurven enden
    // exakt bei ihren Ruhewerten — kein separater Aufräum-Frame nötig.
    const eggStart = eggStartRef.current;
    if (eggStart !== null) {
      const eggElapsed = t - eggStart;
      if (reducedMotion) {
        const glowT = THREE.MathUtils.clamp(
          eggElapsed / EGG_GLOW_DURATION_S,
          0,
          1,
        );
        const glowIntensity =
          Math.sin(glowT * Math.PI) * EGG_GLOW_MAX_INTENSITY;
        for (let i = 0; i < rollMaterialRefs.current.length; i += 1) {
          const material = rollMaterialRefs.current[i];
          if (material) material.emissiveIntensity = glowIntensity;
        }
        if (glowT >= 1) {
          eggStartRef.current = null;
        }
      } else {
        for (let i = 0; i < ROLL_COUNT; i += 1) {
          const rollGroup = rollGroupRefs.current[i];
          if (!rollGroup) continue;
          const localTime = eggElapsed - i * EGG_HOP_STAGGER_S;
          const hopT = THREE.MathUtils.clamp(
            localTime / EGG_HOP_DURATION_S,
            0,
            1,
          );
          const airS = Math.sin(hopT * Math.PI);
          const landT = THREE.MathUtils.clamp(
            (localTime - EGG_HOP_DURATION_S) / EGG_LAND_DURATION_S,
            0,
            1,
          );
          const landS = Math.sin(landT * Math.PI);
          rollGroup.position.y = rolls[i].position[1] + airS * EGG_HOP_HEIGHT;
          const crossScale =
            1 + airS * EGG_AIR_FATTEN - landS * EGG_LAND_FLATTEN;
          rollGroup.scale.set(
            crossScale,
            1 - airS * EGG_AIR_SHORTEN + landS * EGG_LAND_WIDEN,
            crossScale,
          );
        }
        // Dampf-Burst: Wölkchen steigen gemeinsam auf und fächern dabei in
        // die Herz-Silhouette auf (frontal in der lokalen XY-Ebene).
        const heartMesh = heartSteamMeshRef.current;
        if (heartMesh) {
          const burstT = THREE.MathUtils.clamp(
            eggElapsed / HEART_BURST_DURATION_S,
            0,
            1,
          );
          const formT = Math.min(burstT / HEART_FORM_PORTION, 1);
          const heartScale = Math.sin(burstT * Math.PI) * HEART_PUFF_SCALE;
          for (let i = 0; i < HEART_STEAM_COUNT; i += 1) {
            const offset = HEART_STEAM_OFFSETS[i];
            puffDummy.position.set(
              offset.x * formT,
              PUFF_BASE_Y + burstT * HEART_BURST_RISE + offset.y * formT,
              0,
            );
            puffDummy.scale.setScalar(heartScale);
            puffDummy.updateMatrix();
            heartMesh.setMatrixAt(i, puffDummy.matrix);
          }
          heartMesh.instanceMatrix.needsUpdate = true;
        }
        if (eggElapsed >= EGG_EFFECT_TOTAL_S) {
          eggStartRef.current = null;
        }
      }
    }

    // Rotation-Puls der angetippten Rolle: abklingender Sinus um den Basis-Tilt.
    const wobble = wobbleRef.current;
    if (wobble) {
      const wobbleGroup = rollGroupRefs.current[wobble.index];
      const baseTilt = rolls[wobble.index].tilt;
      const elapsed = t - wobble.start;
      if (elapsed >= WOBBLE_DURATION) {
        if (wobbleGroup) wobbleGroup.rotation.z = baseTilt;
        wobbleRef.current = null;
      } else if (wobbleGroup) {
        const decay = 1 - elapsed / WOBBLE_DURATION;
        wobbleGroup.rotation.z =
          baseTilt +
          Math.sin(elapsed * WOBBLE_ANGULAR_SPEED) * WOBBLE_AMPLITUDE * decay;
      }
    }

    // Dampfstoß: Wölkchen steigen gestaffelt auf und blenden per Scale aus
    // (Sinus-Hüllkurve endet bei 0 — kein Aufräum-Frame nötig).
    const puff = puffRef.current;
    const puffMesh = puffMeshRef.current;
    if (puff && puffMesh) {
      const elapsed = t - puff.start;
      // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
      for (let i = 0; i < PUFF_SEEDS.length; i++) {
        const seed = PUFF_SEEDS[i];
        const riseT = THREE.MathUtils.clamp(
          (elapsed - seed.delay) / PUFF_RISE_DURATION,
          0,
          1,
        );
        const riseHeight = reducedMotion ? 0 : PUFF_RISE_HEIGHT;
        const sway = reducedMotion
          ? 0
          : Math.sin(riseT * Math.PI * 2 + seed.swayPhase) * PUFF_SWAY;
        puffDummy.position.set(
          puff.originX + seed.dx + sway,
          PUFF_BASE_Y + riseT * riseHeight,
          puff.originZ + seed.dz,
        );
        puffDummy.scale.setScalar(seed.scale * Math.sin(riseT * Math.PI));
        puffDummy.updateMatrix();
        puffMesh.setMatrixAt(i, puffDummy.matrix);
      }
      puffMesh.instanceMatrix.needsUpdate = true;
      if (elapsed >= PUFF_TOTAL_DURATION) {
        puffRef.current = null;
      }
    }

    // Standard-Idle (läuft immer, ohne Interaktion): deutlicher Dauer-Dampf
    // im EIGENEN Instanz-Mesh — große Wölkchen steigen versetzt in Endlos-
    // schleife gemächlich auf und blenden per Sinus-Hüllkurve aus. Mit `vis`
    // skaliert (weiches Ein-/Ausblenden beim Scrollen);
    // prefers-reduced-motion ⇒ aus (Scale bleibt 0 aus dem useEffect oben).
    const idleSteamMesh = idleSteamMeshRef.current;
    if (idleSteamMesh && !reducedMotion && vis >= VISIBILITY_EPSILON) {
      // Index-Schleife statt forEach: keine pro Frame neu allokierte Closure.
      for (let i = 0; i < IDLE_STEAM_SEEDS.length; i++) {
        const seed = IDLE_STEAM_SEEDS[i];
        const loopT =
          ((t + seed.phase) % IDLE_STEAM_LOOP_DURATION) /
          IDLE_STEAM_LOOP_DURATION;
        const sway =
          Math.sin(loopT * Math.PI * 2 + seed.swayPhase) * IDLE_STEAM_SWAY;
        puffDummy.position.set(
          seed.x + sway,
          PUFF_BASE_Y + loopT * IDLE_STEAM_RISE_HEIGHT,
          seed.z,
        );
        puffDummy.scale.setScalar(seed.scale * Math.sin(loopT * Math.PI) * vis);
        puffDummy.updateMatrix();
        idleSteamMesh.setMatrixAt(i, puffDummy.matrix);
      }
      idleSteamMesh.instanceMatrix.needsUpdate = true;
    }

    const plateGroup = plateGroupRef.current;
    if (plateGroup) {
      const targetScale = 0.85 + progress * 0.15;
      const targetRotY = Math.sin(progress * Math.PI) * 0.15;
      plateGroup.scale.setScalar(
        THREE.MathUtils.damp(plateGroup.scale.x, targetScale, 4, delta),
      );
      plateGroup.rotation.y = THREE.MathUtils.damp(
        plateGroup.rotation.y,
        targetRotY,
        4,
        delta,
      );
    }

    // Dampf-Intensität: Maximum, wenn die Section zentriert im Viewport
    // steht (siehe steamPeakProgress-Herleitung oben).
    const targetIntensity = THREE.MathUtils.clamp(
      1 - Math.abs(progress - steamPeakProgress) * STEAM_INTENSITY_FALLOFF,
      0,
      1,
    );
    intensityRef.current = THREE.MathUtils.damp(
      intensityRef.current,
      targetIntensity,
      4,
      delta,
    );
  });

  return (
    // Deutlich zur Kamera gekippt, damit die Rollen auf dem Teller sichtbar sind
    <group
      ref={rootRef}
      position={[0, -1.0, 0.2]}
      rotation={[0.62, 0, 0]}
      scale={0.82}
    >
      {/* Holztisch */}
      <RoundedBox
        args={[3.8, 0.3, 2.4]}
        radius={0.06}
        smoothness={4}
        position={[0, -0.75, 0]}
      >
        <meshStandardMaterial
          color="#6b4e37"
          roughness={0.75}
          metalness={0.05}
        />
      </RoundedBox>

      {/* Weicher Kontaktschatten zwischen Tisch und Teller */}
      <mesh position={[0, -0.595, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.8, 1.8]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={plateGroupRef} position={[0, -0.45, 0]}>
        {/* Teller: äußerer flacher Rand + innere leicht erhöhte Fläche.
            onClick zählt still zur versteckten Tap-Kombo (Herz-Ei). */}
        <mesh onClick={handlePlateTap}>
          <cylinderGeometry args={[1.3, 1.3, 0.07, 48]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.025, 0]} onClick={handlePlateTap}>
          <cylinderGeometry args={[1.05, 1.05, 0.04, 48]} />
          <meshStandardMaterial color="#f7f5f0" roughness={0.3} />
        </mesh>

        {/* Paprika-Tomaten-Sauce, eingelassen in den Teller */}
        <mesh position={[0, 0.047, 0]} onClick={handlePlateTap}>
          <cylinderGeometry args={[0.75, 0.75, 0.01, 32]} />
          <meshStandardMaterial color="#b3552e" roughness={0.35} />
        </mesh>

        <SarmaRolls
          rolls={rolls}
          groupRefs={rollGroupRefs}
          materialRefs={rollMaterialRefs}
          onRollTap={handleRollTap}
          onRollPointerOver={handleRollPointerOver}
          onRollPointerOut={handleRollPointerOut}
        />

        <Steam
          intensityRef={intensityRef}
          reducedMotion={reducedMotion}
          scroll={scroll}
          index={index}
        />

        {/* Klick-Wölkchen über der angetippten Rolle (feiner, kurzer Stoß) */}
        <instancedMesh
          ref={puffMeshRef}
          args={[undefined, undefined, PUFF_COUNT]}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            opacity={0.35}
            roughness={0.9}
            depthWrite={false}
          />
        </instancedMesh>

        {/* Dauer-Idle-Dampf: eigenes Mesh mit kräftigerem Material, damit
            der Teller sichtbar von sich aus dampft */}
        <instancedMesh
          ref={idleSteamMeshRef}
          args={[undefined, undefined, IDLE_STEAM_COUNT]}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            opacity={IDLE_STEAM_OPACITY}
            roughness={0.9}
            depthWrite={false}
          />
        </instancedMesh>

        {/* Dampf-Herz des versteckten Eis — Instanzen ruhen bei Scale 0 */}
        <instancedMesh
          ref={heartSteamMeshRef}
          args={[undefined, undefined, HEART_STEAM_COUNT]}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            opacity={HEART_STEAM_OPACITY}
            roughness={0.9}
            depthWrite={false}
          />
        </instancedMesh>
      </group>
    </group>
  );
};

export const SarmaHtml = () => (
  <div className="exp-content" style={{ paddingTop: "9vh" }}>
    <span className="exp-kicker">Kapitel 5</span>
    <h2 className="exp-title">Sarma</h2>
    <p className="exp-subtitle">
      Najbolja sarma. Mit dir schmeckt sie am besten.
    </p>
  </div>
);
