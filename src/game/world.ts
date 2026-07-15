/**
 * Spielfeld-Konstanten und pure Spiellogik des Dino-Runners — bewusst ohne
 * DOM-/Canvas-Abhängigkeiten, damit die Logik headless (Node) prüfbar ist.
 * Koordinaten: Spielfeld 960x270, y wächst nach unten, GROUND_Y = Fußlinie.
 */

export const VIEW_W = 960;
export const VIEW_H = 340;
export const GROUND_Y = 300;

// --- Physik (px/s bzw. px/s²) ----------------------------------------------
export const GRAVITY = 2400;
export const JUMP_VELOCITY = -830;
/** Pfeil-runter in der Luft: schneller Sturzflug wie beim Chrome-Dino. */
export const FAST_FALL_VELOCITY = 900;

export const BASE_SPEED = 260;
export const MAX_SPEED = 620;
export const ACCEL = 4;

/** Schwierigkeit 0..1, abgeleitet vom aktuellen Tempo — steuert Lücken,
 *  Vogel-Wahrscheinlichkeit und Kombo-Muster. */
export function difficulty(speed: number): number {
  return Math.min(
    1,
    Math.max(0, (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)),
  );
}

// --- Spieler -----------------------------------------------------------------
export const PLAYER_X = 130;
export const PLAYER_SCALE = 0.34;
/** Hitboxen fix statt aus Frame-Maßen: Run-Frames enthalten Staubwolken. */
export const PLAYER_HITBOX = { w: 36, h: 76 } as const;
export const PLAYER_HITBOX_DUCK = { w: 46, h: 60 } as const;

// --- Score -------------------------------------------------------------------
export const SCORE_PER_PX = 1 / 8;
export const MILESTONE_STEP = 500;

// --- Hindernisse ---------------------------------------------------------------
const BIRD_SCALE = 0.36;
/** Vögel tauchen erst ab dieser Schwierigkeit auf (erst einzeln, später
 *  häufiger und in Kombos mit Kakteen — Progression wie beim Original). */
const BIRD_MIN_DIFFICULTY = 0.35;
const BIRD_PROBABILITY_EARLY = 0.12;
const BIRD_PROBABILITY_LATE = 0.32;
/** Flughöhen (Abstand Vogel-Unterkante zur Fußlinie): niedrig = ducken!,
 *  hoch = einfach durchlaufen. Werte gegen die Hitboxen ausbalanciert:
 *  niedriger Vogel trifft den stehenden Spieler und verfehlt den geduckten. */
const BIRD_LOW_LIFT = 56;
const BIRD_HIGH_LIFT = 108;

const CACTUS_DEFS = [
  { frame: "cactus/small", scale: 0.5 },
  { frame: "cactus/medium", scale: 0.48 },
  { frame: "cactus/large", scale: 0.42 },
  { frame: "cactus/double", scale: 0.44 },
] as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Obstacle {
  kind: "cactus" | "bird";
  /** Kaktus: Atlas-Frame-Name; Vogel: Anim-Prefix (bird/yellow, bird/red). */
  frameName: string;
  /** Horizontaler Mittelpunkt. */
  x: number;
  /** Fußlinie/Unterkante. */
  bottomY: number;
  w: number;
  h: number;
  scale: number;
}

/** Liefert Quell-Maße eines Atlas-Frames — als Callback, damit world.ts
 *  selbst keinen Atlas kennt (pure & headless testbar). */
export type SizeOf = (frameName: string) => { w: number; h: number };

export function spawnObstacle(
  speed: number,
  rng: () => number,
  sizeOf: SizeOf,
): Obstacle {
  const spawnX = VIEW_W + 60;
  const t = difficulty(speed);
  const birdProbability =
    t < BIRD_MIN_DIFFICULTY
      ? 0
      : BIRD_PROBABILITY_EARLY +
        ((t - BIRD_MIN_DIFFICULTY) / (1 - BIRD_MIN_DIFFICULTY)) *
          (BIRD_PROBABILITY_LATE - BIRD_PROBABILITY_EARLY);
  if (rng() < birdProbability) {
    const prefix = rng() < 0.5 ? "bird/yellow" : "bird/red";
    const src = sizeOf(`${prefix}_0`);
    const lift = rng() < 0.5 ? BIRD_LOW_LIFT : BIRD_HIGH_LIFT;
    return {
      kind: "bird",
      frameName: prefix,
      x: spawnX,
      bottomY: GROUND_Y - lift,
      w: src.w * BIRD_SCALE,
      h: src.h * BIRD_SCALE,
      scale: BIRD_SCALE,
    };
  }
  const def = CACTUS_DEFS[Math.min(Math.floor(rng() * CACTUS_DEFS.length), 3)];
  const src = sizeOf(def.frame);
  return {
    kind: "cactus",
    frameName: def.frame,
    x: spawnX,
    bottomY: GROUND_Y + 4,
    w: src.w * def.scale,
    h: src.h * def.scale,
    scale: def.scale,
  };
}

/** Harte Untergrenze (px) zwischen zwei Hindernissen — die "Max-Nähe",
 *  die auch im Endgame nie unterschritten wird. */
const MIN_GAP_PX = 340;
/** Lücken in Sekunden (zeitbasiert bleibt es bei jedem Tempo fair):
 *  Start gemütlich und stark variierend, Endgame eng. */
const GAP_EARLY = { min: 1.3, max: 2.3 } as const;
const GAP_LATE = { min: 0.6, max: 1.05 } as const;
/** Ab dieser Schwierigkeit tauchen gelegentlich enge Kombos auf
 *  (Kaktus→Vogel dicht hintereinander) — spät, wie beim Original. */
const COMBO_MIN_DIFFICULTY = 0.55;
const COMBO_PROBABILITY = 0.22;
const COMBO_GAP_SECONDS = 0.55;

/** Abstand (px Weltstrecke) bis zum nächsten Spawn. Progression:
 *  Anfang = wenige, weit verstreute Kakteen; mit steigendem Tempo rücken
 *  die Lücken zusammen; ab COMBO_MIN_DIFFICULTY kommen vereinzelt dichte
 *  Zweier-Muster. MIN_GAP_PX wird nie unterschritten. */
export function spawnGap(speed: number, rng: () => number): number {
  const t = difficulty(speed);
  if (t >= COMBO_MIN_DIFFICULTY && rng() < COMBO_PROBABILITY) {
    return Math.max(MIN_GAP_PX, speed * COMBO_GAP_SECONDS);
  }
  const minSeconds = GAP_EARLY.min + (GAP_LATE.min - GAP_EARLY.min) * t;
  const maxSeconds = GAP_EARLY.max + (GAP_LATE.max - GAP_EARLY.max) * t;
  const seconds = minSeconds + rng() * (maxSeconds - minSeconds);
  return Math.max(MIN_GAP_PX, speed * seconds);
}

/** Beide Boxen werden aufs Zentrum geschrumpft — verzeihende Kollisionen,
 *  keine Pixel-Pedanterie bei einem Geschenk-Spiel. */
const HITBOX_SHRINK = 0.8;

function shrunk(r: Rect): Rect {
  const w = r.w * HITBOX_SHRINK;
  const h = r.h * HITBOX_SHRINK;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

export function obstacleRect(o: Obstacle): Rect {
  return { x: o.x - o.w / 2, y: o.bottomY - o.h, w: o.w, h: o.h };
}

export function hitTest(player: Rect, obstacle: Obstacle): boolean {
  const a = shrunk(player);
  const b = shrunk(obstacleRect(obstacle));
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
