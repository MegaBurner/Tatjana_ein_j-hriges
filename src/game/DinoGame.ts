/**
 * Chrome-Dino-Style Endless-Runner auf Canvas 2D — Melih läuft, springt über
 * Kakteen, duckt sich unter Vögeln; Tatjana winkt am rechten Rand und feiert
 * Meilensteine mit Herzen. Framework-agnostisch: React hängt nur den Canvas
 * auf und ruft start()/destroy().
 *
 * Fixed-Timestep-Update (1/120 s) + rAF-Rendering; ?freeze=1 rendert genau
 * einen Frame (deterministische Headless-Screenshots, siehe Experience.tsx).
 */

import type { Atlas, AtlasFrame } from "./sprites";
import { drawFrame, frameSeq } from "./sprites";
import { loadHighscore, submitScore } from "./highscore";
import {
  ACCEL,
  BASE_SPEED,
  FAST_FALL_VELOCITY,
  GRAVITY,
  GROUND_Y,
  JUMP_VELOCITY_HOLD,
  JUMP_VELOCITY_TAP,
  MAX_SPEED,
  MILESTONE_STEP,
  PLAYER_HITBOX,
  PLAYER_HITBOX_DUCK,
  PLAYER_SCALE,
  PLAYER_X,
  SCORE_PER_PX,
  VIEW_H,
  VIEW_W,
  hitTest,
  spawnGap,
  spawnObstacle,
  type Obstacle,
  type Rect,
} from "./world";

export type GamePhase = "ready" | "running" | "gameover";

const STEP = 1 / 120;
/** Nach Tab-Wechseln nicht minutenlang "nachsimulieren". */
const MAX_FRAME_DELTA = 0.25;

// Animations-Taktung (s pro Frame)
// Lauf: am Anfang bewusst gemächlich (~4 fps), skaliert invers mit dem Tempo,
// wird also mit steigender Geschwindigkeit spürbar schneller.
const RUN_FRAME_TIME = 0.26;
const DUCK_FRAME_TIME = 0.14;
const IDLE_FRAME_TIME = 0.35;
const BIRD_FRAME_TIME = 0.08;
const WAVE_FRAME_TIME = 0.28;
const HEARTS_FRAME_TIME = 0.24;

// Beide Figuren stehen minimal in den Sand eingelassen (Füße auf Bodenlinie
// statt darüber schwebend).
const FOOT_EMBED = 14;

// Tatjana am rechten Rand: gleiche Bodenebene wie der Spieler, kein
// Hindernis — Kakteen/Vögel ziehen hinter ihr vorbei.
const LADY_X = VIEW_W - 64;
const LADY_SCALE = 0.3;
const LADY_BASELINE = GROUND_Y + FOOT_EMBED;

const GROUND_SCALE = 0.6;
/** Oberer Teil der Bodenkachel (Felsen) wird übersprungen — nur der
 *  Sandstreifen wird gekachelt, sonst sähen die Felsen wie Hindernisse aus. */
const GROUND_SRC_SKIP = 54;

export const COLORS = {
  sky: "#fdf6ec",
  skyGlow: "#fbe8d8",
  sand: "#d8b578",
  sandDark: "#c4a065",
  text: "#6b5d4f",
  accent: "#c2503f",
} as const;

interface Heart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  frame: number;
  scale: number;
}

function pad5(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(5, "0");
}

/** Seed-basierter RNG (mulberry32) — für den deterministischen Sim-Modus,
 *  damit Headless-Screenshots reproduzierbar dieselbe Hindernisfolge zeigen. */
function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Verifikations-Konfiguration aus der URL (nur für Headless-Screenshots):
 *   ?sim=6      — spult 6 s Spiel deterministisch vor, dann Standbild.
 *   ?auto=1     — einfacher Auto-Spieler weicht Hindernissen aus
 *                 (zeigt "laufendes Spiel"); ohne auto crasht er → Game Over.
 *   ?seed=N     — Seed für die Hindernisfolge (Default 12345).
 */
interface SimConfig {
  seconds: number;
  auto: boolean;
  seed: number;
}

function readSimConfig(): SimConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const sim = params.get("sim");
  if (sim === null) return null;
  const seconds = Number(sim);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    seconds: Math.min(seconds, 120),
    auto: params.has("auto"),
    seed: Number(params.get("seed")) || 12345,
  };
}

export class DinoGame {
  private ctx: CanvasRenderingContext2D;
  private atlas: Atlas;

  private phase: GamePhase = "ready";
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private elapsed = 0;
  private running = false;
  private frozen: boolean;
  private sim: SimConfig | null;
  /** Zufallsquelle: Math.random im Normalbetrieb, seed-basiert im Sim-Modus. */
  private rng: () => number = Math.random;

  private speed = BASE_SPEED;
  private distance = 0;
  private score = 0;
  private best = 0;
  private isNewBest = false;
  private nextMilestone = MILESTONE_STEP;

  private playerBottom = GROUND_Y;
  private velocityY = 0;
  private isDucking = false;
  /** Variable Sprunghöhe: true zwischen Sprung-Start und Loslassen. Wird der
   *  Sprung früh losgelassen (Tap), kappt jumpRelease die Aufwärtsgeschwindig-
   *  keit auf JUMP_VELOCITY_TAP → niedrigerer Sprung. Halten = voller Sprung. */
  private isJumpHeld = false;

  private obstacles: Obstacle[] = [];
  private untilSpawn = 600;
  private hearts: Heart[] = [];

  /** 'wave' = Dauer-Winken; 'hearts' = Meilenstein-Animation (einmalig). */
  private ladyMode: "wave" | "hearts" = "wave";
  private ladyTime = 0;

  private idleFrames: AtlasFrame[];
  private runFrames: AtlasFrame[];
  private jumpFrames: AtlasFrame[];
  private duckFrames: AtlasFrame[];
  private waveFrames: AtlasFrame[];
  private heartsFrames: AtlasFrame[];
  private heartFx: AtlasFrame[];
  private birdFrames: Record<string, AtlasFrame[]>;

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (event.repeat) return; // Taste gehalten: kein Re-Trigger (Auto-Repeat)
      this.restartOrJump();
    } else if (event.code === "ArrowDown") {
      event.preventDefault();
      this.duckOn();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space" || event.code === "ArrowUp") this.jumpRelease();
    else if (event.code === "ArrowDown") this.duckOff();
  };

  constructor(canvas: HTMLCanvasElement, atlas: Atlas) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D-Context nicht verfügbar");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.atlas = atlas;
    this.frozen =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("freeze");
    this.sim = readSimConfig();
    if (this.sim) this.rng = makeSeededRng(this.sim.seed);

    this.idleFrames = frameSeq(atlas, "player/idle");
    this.runFrames = frameSeq(atlas, "player/run");
    this.jumpFrames = frameSeq(atlas, "player/jump");
    this.duckFrames = frameSeq(atlas, "player/duck");
    this.waveFrames = frameSeq(atlas, "lady/wave");
    this.heartsFrames = frameSeq(atlas, "lady/hearts");
    this.heartFx = frameSeq(atlas, "fx/heart");
    this.birdFrames = {
      "bird/yellow": frameSeq(atlas, "bird/yellow"),
      "bird/red": frameSeq(atlas, "bird/red"),
    };

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    void loadHighscore().then((value) => {
      this.best = value;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.sim) {
      this.runSimulation(this.sim);
      // Nach der Vorspul-Simulation nur noch ein Standbild (freeze) oder
      // ab hier normal weiterlaufen lassen.
      if (this.frozen) {
        this.render();
        return;
      }
    }
    if (this.frozen) {
      this.render();
      return;
    }
    this.lastTime = performance.now();
    const loop = (time: number) => {
      if (!this.running) return;
      const delta = Math.min((time - this.lastTime) / 1000, MAX_FRAME_DELTA);
      this.lastTime = time;
      this.accumulator += delta;
      while (this.accumulator >= STEP) {
        this.update(STEP);
        this.accumulator -= STEP;
      }
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Haupteingabe (Space/Tap): startet, springt oder startet neu. */
  restartOrJump(): void {
    if (this.phase === "ready") {
      this.phase = "running";
      return;
    }
    if (this.phase === "gameover") {
      this.reset();
      return;
    }
    this.jump();
  }

  jump(): void {
    if (this.phase !== "running") return;
    if (this.playerBottom >= GROUND_Y) {
      // Voller Sprung; jumpRelease kappt ihn beim frühen Loslassen (Tap).
      this.velocityY = JUMP_VELOCITY_HOLD;
      this.isJumpHeld = true;
    }
  }

  /** Sprungtaste losgelassen: solange der Spieler noch steigt, wird die
   *  Aufwärtsgeschwindigkeit auf die Tap-Höhe gekappt (kurzer Druck =
   *  niedriger, Halten = voller Sprung). */
  jumpRelease(): void {
    if (!this.isJumpHeld) return;
    this.isJumpHeld = false;
    if (this.velocityY < JUMP_VELOCITY_TAP) {
      this.velocityY = JUMP_VELOCITY_TAP;
    }
  }

  duckOn(): void {
    if (this.phase !== "running") return;
    this.isDucking = true;
    // In der Luft: Sturzflug statt Ducken (wie beim Original).
    if (this.playerBottom < GROUND_Y) {
      this.velocityY = Math.max(this.velocityY, FAST_FALL_VELOCITY);
    }
  }

  duckOff(): void {
    this.isDucking = false;
  }

  private reset(): void {
    this.phase = "running";
    this.speed = BASE_SPEED;
    this.distance = 0;
    this.score = 0;
    this.isNewBest = false;
    this.nextMilestone = MILESTONE_STEP;
    this.playerBottom = GROUND_Y;
    this.velocityY = 0;
    this.isDucking = false;
    this.isJumpHeld = false;
    this.obstacles = [];
    this.untilSpawn = 600;
    this.hearts = [];
    this.ladyMode = "wave";
    this.ladyTime = 0;
  }

  private update(dt: number): void {
    this.elapsed += dt;
    this.ladyTime += dt;
    this.updateHearts(dt);
    if (this.ladyMode === "hearts") {
      const done =
        this.ladyTime >= this.heartsFrames.length * HEARTS_FRAME_TIME;
      if (done) {
        this.ladyMode = "wave";
        this.ladyTime = 0;
      }
    }
    if (this.phase !== "running") return;

    this.speed = Math.min(this.speed + ACCEL * dt, MAX_SPEED);
    this.distance += this.speed * dt;
    this.score = this.distance * SCORE_PER_PX;

    if (this.score >= this.nextMilestone) {
      this.nextMilestone += MILESTONE_STEP;
      this.celebrateMilestone();
    }

    // Spieler-Physik
    this.velocityY += GRAVITY * dt;
    this.playerBottom += this.velocityY * dt;
    if (this.playerBottom >= GROUND_Y) {
      this.playerBottom = GROUND_Y;
      this.velocityY = 0;
      this.isJumpHeld = false;
    }

    // Hindernisse bewegen/spawnen/aufräumen
    this.untilSpawn -= this.speed * dt;
    if (this.untilSpawn <= 0) {
      this.obstacles.push(
        spawnObstacle(this.speed, this.rng, (name) => {
          const frame = this.atlas.frames[name];
          return frame ?? { w: 100, h: 100 };
        }),
      );
      this.untilSpawn = spawnGap(this.speed, this.rng);
    }
    this.obstacles = this.obstacles
      .map((o) => ({ ...o, x: o.x - this.speed * dt }))
      .filter((o) => o.x > -80);

    if (this.obstacles.some((o) => hitTest(this.playerRect(), o))) {
      this.gameOver();
    }
  }

  private playerRect(): Rect {
    const grounded = this.playerBottom >= GROUND_Y;
    const box = this.isDucking && grounded ? PLAYER_HITBOX_DUCK : PLAYER_HITBOX;
    return {
      x: PLAYER_X - box.w / 2,
      y: this.playerBottom - box.h,
      w: box.w,
      h: box.h,
    };
  }

  private celebrateMilestone(): void {
    this.ladyMode = "hearts";
    this.ladyTime = 0;
    this.spawnHearts(5, LADY_X, LADY_BASELINE - 70);
  }

  private gameOver(): void {
    this.phase = "gameover";
    const finalScore = Math.floor(this.score);
    if (finalScore > this.best) {
      // Im Sim-Modus (Headless-Verifikation) den Rekord NICHT persistieren —
      // sonst würde ein Screenshot-Lauf die Repo-highscore.json verändern.
      this.best = this.sim ? finalScore : submitScore(finalScore);
      this.isNewBest = true;
      this.spawnHearts(12, VIEW_W / 2, 60);
    }
  }

  private spawnHearts(count: number, x: number, y: number): void {
    for (let i = 0; i < count; i++) {
      this.hearts.push({
        x: x + (this.rng() - 0.5) * 90,
        y: y + (this.rng() - 0.5) * 30,
        vx: (this.rng() - 0.5) * 30,
        vy: -40 - this.rng() * 50,
        age: 0,
        ttl: 1.4 + this.rng() * 0.8,
        frame: Math.floor(this.rng() * this.heartFx.length),
        scale: 0.5 + this.rng() * 0.5,
      });
    }
  }

  /**
   * Spult das Spiel deterministisch `seconds` Sekunden mit festem Timestep
   * vor (kein rAF) — nur für Headless-Verifikations-Screenshots. Mit
   * `auto` weicht ein einfacher Regel-Spieler den Hindernissen aus (zeigt
   * "laufendes Spiel"); ohne `auto` läuft der Spieler in das erste
   * Hindernis und die Simulation endet im Game-Over-Zustand.
   */
  private runSimulation(config: SimConfig): void {
    this.phase = "running";
    const totalSteps = Math.floor(config.seconds / STEP);
    for (let i = 0; i < totalSteps; i++) {
      if (config.auto) this.autoPlay();
      this.update(STEP);
      if (!config.auto && this.isGameOver()) break;
    }
  }

  private isGameOver(): boolean {
    return this.phase === "gameover";
  }

  /** Regel-Spieler für den Sim-Modus: springt über den nächsten Kaktus /
   *  hohen Vogel, duckt sich unter tiefe Vögel. Bewusst simpel — dient nur
   *  dazu, für Screenshots ein plausibles Laufbild zu erzeugen. */
  private autoPlay(): void {
    const grounded = this.playerBottom >= GROUND_Y;
    const next = this.obstacles
      .filter((o) => o.x + o.w / 2 > PLAYER_X - 10)
      .sort((a, b) => a.x - b.x)[0];
    if (!next) {
      if (this.isDucking) this.duckOff();
      return;
    }
    const distance = next.x - PLAYER_X;
    if (next.kind === "bird") {
      // Kopfhoher Vogel: ducken. Hochfliegender Vogel: einfach durchlaufen
      // (ein Sprung würde hineinlaufen) — kein Springen.
      const duckBird = next.bottomY > GROUND_Y - PLAYER_HITBOX.h;
      if (duckBird && distance < 170 && distance > -40) this.duckOn();
      else this.duckOff();
      return;
    }
    if (this.isDucking) this.duckOff();
    // Kaktus: rechtzeitig springen (Distanz tempoabhängig).
    const jumpTrigger = 60 + this.speed * 0.28;
    if (grounded && distance < jumpTrigger && distance > 0) this.jump();
  }

  private updateHearts(dt: number): void {
    this.hearts = this.hearts
      .map((h) => ({
        ...h,
        age: h.age + dt,
        x: h.x + h.vx * dt,
        y: h.y + h.vy * dt,
      }))
      .filter((h) => h.age < h.ttl);
  }

  // --- Rendering -------------------------------------------------------------

  private render(): void {
    const { ctx } = this;
    this.drawBackground(ctx);
    this.drawGround(ctx);
    this.drawPlayer(ctx);
    this.drawObstacles(ctx);
    // Nach den Hindernissen: sie steht "vorne", Kakteen ziehen hinter ihr vorbei.
    this.drawLady(ctx);
    this.drawHeartParticles(ctx);
    this.drawHud(ctx);
    if (this.phase === "ready") this.drawReadyOverlay(ctx);
    if (this.phase === "gameover") this.drawGameOverOverlay(ctx);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    gradient.addColorStop(0, COLORS.sky);
    gradient.addColorStop(1, COLORS.skyGlow);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const tile = this.atlas.frames["ground/tile"];
    if (!tile) return;
    const srcY = tile.y + GROUND_SRC_SKIP;
    const srcH = tile.h - GROUND_SRC_SKIP;
    const destW = tile.w * GROUND_SCALE;
    const destH = srcH * GROUND_SCALE;
    const top = GROUND_Y - 6;
    ctx.fillStyle = COLORS.sandDark;
    ctx.fillRect(0, top + destH - 2, VIEW_W, VIEW_H - (top + destH) + 2);
    const offset = this.distance % destW;
    for (let x = -offset; x < VIEW_W; x += destW) {
      ctx.drawImage(
        this.atlas.image,
        tile.x,
        srcY,
        tile.w,
        srcH,
        x,
        top,
        destW,
        destH,
      );
    }
  }

  private drawLady(ctx: CanvasRenderingContext2D): void {
    const frames =
      this.ladyMode === "hearts" ? this.heartsFrames : this.waveFrames;
    const frameTime =
      this.ladyMode === "hearts" ? HEARTS_FRAME_TIME : WAVE_FRAME_TIME;
    const index =
      this.ladyMode === "hearts"
        ? Math.min(Math.floor(this.ladyTime / frameTime), frames.length - 1)
        : Math.floor(this.ladyTime / frameTime) % frames.length;
    const frame = frames[index];
    // Geflippt: sie schaut nach links, dem Spieler entgegen.
    if (frame)
      drawFrame(
        ctx,
        this.atlas,
        frame,
        LADY_X,
        LADY_BASELINE,
        LADY_SCALE,
        true,
      );
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const airborne = this.playerBottom < GROUND_Y;
    let frame: AtlasFrame | undefined;
    if (this.phase === "ready") {
      frame =
        this.idleFrames[
          Math.floor(this.elapsed / IDLE_FRAME_TIME) % this.idleFrames.length
        ];
    } else if (airborne) {
      frame = this.velocityY < 0 ? this.jumpFrames[0] : this.jumpFrames[1];
    } else if (this.isDucking) {
      frame =
        this.duckFrames[
          Math.floor(this.elapsed / DUCK_FRAME_TIME) % this.duckFrames.length
        ];
    } else {
      // Lauf-Zyklus tickt mit dem Tempo — wirkt bei MAX_SPEED hektischer.
      const cadence = RUN_FRAME_TIME * (BASE_SPEED / this.speed);
      frame =
        this.runFrames[
          Math.floor(this.elapsed / cadence) % this.runFrames.length
        ];
    }
    if (!frame) return;
    drawFrame(
      ctx,
      this.atlas,
      frame,
      PLAYER_X,
      this.playerBottom + FOOT_EMBED,
      PLAYER_SCALE,
    );
  }

  private drawObstacles(ctx: CanvasRenderingContext2D): void {
    for (const o of this.obstacles) {
      const frame =
        o.kind === "bird"
          ? this.birdFrames[o.frameName]?.[
              Math.floor(this.elapsed / BIRD_FRAME_TIME) %
                (this.birdFrames[o.frameName]?.length || 1)
            ]
          : this.atlas.frames[o.frameName];
      if (!frame) continue;
      // Vögel fliegen nach links (dem Spieler entgegen) → spiegeln.
      drawFrame(
        ctx,
        this.atlas,
        frame,
        o.x,
        o.bottomY,
        o.scale,
        o.kind === "bird",
      );
    }
  }

  private drawHeartParticles(ctx: CanvasRenderingContext2D): void {
    for (const h of this.hearts) {
      const frame = this.heartFx[h.frame];
      if (!frame) continue;
      ctx.globalAlpha = Math.max(0, 1 - h.age / h.ttl);
      drawFrame(ctx, this.atlas, frame, h.x, h.y, h.scale);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const hi = this.best > 0 ? `HI ${pad5(this.best)}  ` : "";
    ctx.fillText(`${hi}${pad5(this.score)}`, VIEW_W - 14, 12);
  }

  private drawReadyOverlay(ctx: CanvasRenderingContext2D): void {
    // Text im oberen Drittel — hält den Himmel frei, ohne Spieler/Boden
    // zu überdecken.
    const cy = VIEW_H * 0.32;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 34px 'Courier New', monospace";
    ctx.fillText("Lauf zu ihr!", VIEW_W / 2, cy);
    ctx.font = "18px 'Courier New', monospace";
    ctx.fillText(
      "Leertaste / Tippen: Springen — Pfeil runter: Ducken",
      VIEW_W / 2,
      cy + 42,
    );
    // Dezentes Blinken, damit klar ist: hier darf gedrückt werden.
    if (this.frozen || Math.floor(this.elapsed * 2) % 2 === 0) {
      ctx.font = "bold 18px 'Courier New', monospace";
      ctx.fillStyle = COLORS.accent;
      ctx.fillText("Drück Leertaste oder tippe zum Start", VIEW_W / 2, cy + 80);
    }
  }

  private drawGameOverOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(60, 45, 35, 0.45)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cy = VIEW_H * 0.4;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff6ea";
    ctx.font = "bold 40px 'Courier New', monospace";
    ctx.fillText("G A M E   O V E R", VIEW_W / 2, cy);
    if (this.isNewBest) {
      ctx.fillStyle = "#ffb3c1";
      ctx.font = "bold 24px 'Courier New', monospace";
      ctx.fillText(`Neuer Rekord: ${pad5(this.score)}!`, VIEW_W / 2, cy + 50);
    }
    ctx.fillStyle = "#fff6ea";
    ctx.font = "18px 'Courier New', monospace";
    ctx.fillText(
      "Leertaste oder Tippen für noch einen Versuch",
      VIEW_W / 2,
      cy + (this.isNewBest ? 92 : 50),
    );
  }
}
