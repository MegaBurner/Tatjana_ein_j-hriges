/**
 * Attract-Mode für den Laptop-Screen in der Arcade-Section: animierter
 * Titelbildschirm (Melih-Idle links, winkende Tatjana rechts, Highscore,
 * pulsierendes "Klick mich!"). Kein selbstspielender Demo-Bot — der
 * Bildschirm soll nur zum Anklicken einladen.
 *
 * Läuft auf einem Offscreen-Canvas; die Section spiegelt ihn per
 * THREE.CanvasTexture aufs Display-Mesh. ?freeze=1 rendert einen Frame.
 */

import type { Atlas, AtlasFrame } from "./sprites";
import { drawFrame, frameSeq } from "./sprites";
import { loadHighscore } from "./highscore";
import { COLORS } from "./DinoGame";
import { GROUND_Y, VIEW_H, VIEW_W } from "./world";

const IDLE_FRAME_TIME = 0.4;
const WAVE_FRAME_TIME = 0.3;
const GROUND_SRC_SKIP = 54;

export class AttractScreen {
  private ctx: CanvasRenderingContext2D;
  private atlas: Atlas;
  private idleFrames: AtlasFrame[];
  private waveFrames: AtlasFrame[];
  private rafId = 0;
  private running = false;
  private startTime = 0;
  private best = 0;
  private frozen: boolean;

  constructor(canvas: HTMLCanvasElement, atlas: Atlas) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D-Context nicht verfügbar");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.atlas = atlas;
    this.idleFrames = frameSeq(atlas, "player/idle");
    this.waveFrames = frameSeq(atlas, "lady/wave");
    this.frozen =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("freeze");
    void loadHighscore().then((value) => {
      this.best = value;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    if (this.frozen) {
      this.render(0);
      return;
    }
    const loop = (time: number) => {
      if (!this.running) return;
      this.render((time - this.startTime) / 1000);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private render(t: number): void {
    const { ctx, atlas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    gradient.addColorStop(0, COLORS.sky);
    gradient.addColorStop(1, COLORS.skyGlow);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const tile = atlas.frames["ground/tile"];
    if (tile) {
      const srcY = tile.y + GROUND_SRC_SKIP;
      const srcH = tile.h - GROUND_SRC_SKIP;
      const destW = tile.w * 0.6;
      const destH = srcH * 0.6;
      ctx.fillStyle = COLORS.sandDark;
      ctx.fillRect(0, GROUND_Y - 6 + destH - 2, VIEW_W, 60);
      for (let x = 0; x < VIEW_W; x += destW) {
        ctx.drawImage(
          atlas.image,
          tile.x,
          srcY,
          tile.w,
          srcH,
          x,
          GROUND_Y - 6,
          destW,
          destH,
        );
      }
    }

    // Er (Idle, schaut nach rechts zu ihr) und sie (winkt zurück).
    const idle =
      this.idleFrames[Math.floor(t / IDLE_FRAME_TIME) % this.idleFrames.length];
    if (idle) drawFrame(ctx, atlas, idle, 210, GROUND_Y, 0.34, true);
    const wave =
      this.waveFrames[Math.floor(t / WAVE_FRAME_TIME) % this.waveFrames.length];
    if (wave) drawFrame(ctx, atlas, wave, VIEW_W - 210, GROUND_Y, 0.32);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 36px 'Courier New', monospace";
    ctx.fillText("LAUF ZU IHR!", VIEW_W / 2, 62);
    if (this.best > 0) {
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.fillText(
        `Rekord: ${String(this.best).padStart(5, "0")}`,
        VIEW_W / 2,
        96,
      );
    }

    const pulse = this.frozen ? 1 : 0.6 + 0.4 * Math.sin(t * 4);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COLORS.accent;
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText("Klick mich!", VIEW_W / 2, 150);
    ctx.globalAlpha = 1;
  }
}
