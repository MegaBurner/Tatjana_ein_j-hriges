/**
 * Spielfeld-Konstanten und pure Spiellogik des Dino-Runners — bewusst ohne
 * DOM-/Canvas-Abhängigkeiten, damit die Logik headless (Node) prüfbar ist.
 * Koordinaten: Spielfeld 960x270, y wächst nach unten, GROUND_Y = Fußlinie.
 */

export const VIEW_W = 960;
export const VIEW_H = 270;
export const GROUND_Y = 232;

// --- Physik (px/s bzw. px/s²) ----------------------------------------------
export const GRAVITY = 2400;
export const JUMP_VELOCITY = -830;
/** Pfeil-runter in der Luft: schneller Sturzflug wie beim Chrome-Dino. */
export const FAST_FALL_VELOCITY = 900;

export const BASE_SPEED = 300;
export const MAX_SPEED = 620;
export const ACCEL = 7;

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
/** Vögel tauchen erst auf, wenn das Tempo angezogen hat (wie beim Original). */
const BIRD_MIN_SPEED = 380;
/** Flughöhen (Abstand Vogel-Unterkante zur Fußlinie): niedrig = ducken!,
 *  hoch = einfach durchlaufen. Werte gegen die Hitboxen ausbalanciert:
 *  niedriger Vogel trifft den stehenden (Hitbox-Top 156 px) und verfehlt
 *  den geduckten Spieler (Hitbox-Top 172 px). */
const BIRD_LOW_LIFT = 56;
const BIRD_HIGH_LIFT = 108;
const BIRD_PROBABILITY = 0.3;

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
  if (speed >= BIRD_MIN_SPEED && rng() < BIRD_PROBABILITY) {
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

/** Abstand (px Weltstrecke) bis zum nächsten Spawn: zeitlich ~konstante
 *  Lücken (0.55–1.15 s), damit das Spiel mit dem Tempo schwerer wird,
 *  ohne unschaffbar zu werden. */
export function spawnGap(speed: number, rng: () => number): number {
  const seconds = 0.55 + rng() * 0.6;
  return Math.max(280, speed * seconds);
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
