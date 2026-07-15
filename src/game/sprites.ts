/**
 * Atlas-Loader für das Arcade-Spiel: lädt public/game/atlas.png + atlas.json
 * (generiert von scripts/extract_sprites.py) genau einmal pro Seite —
 * Laptop-Screen (Attract-Mode) und Fullscreen-Overlay teilen sich das Bild.
 */

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  image: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

let atlasPromise: Promise<Atlas> | null = null;

export function loadAtlas(): Promise<Atlas> {
  atlasPromise ??= fetchAtlas();
  return atlasPromise;
}

async function fetchAtlas(): Promise<Atlas> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}game/atlas.json`);
  if (!res.ok) {
    throw new Error(`Atlas-Manifest nicht ladbar (HTTP ${res.status})`);
  }
  const manifest = (await res.json()) as {
    frames: Record<string, AtlasFrame>;
  };
  const image = new Image();
  image.src = `${base}game/atlas.png`;
  await image.decode();
  return { image, frames: manifest.frames };
}

/** Alle Frames `prefix_0..n` in Index-Reihenfolge (für Animations-Loops). */
export function frameSeq(atlas: Atlas, prefix: string): AtlasFrame[] {
  const frames: AtlasFrame[] = [];
  for (let i = 0; ; i++) {
    const frame = atlas.frames[`${prefix}_${i}`];
    if (!frame) break;
    frames.push(frame);
  }
  return frames;
}

/**
 * Zeichnet einen Frame mit Bottom-Center-Anchor: `x` = horizontale Mitte,
 * `bottomY` = Fußlinie. Die Quell-Frames schauen nach links —
 * `flipX = true` spiegelt sie (Spieler läuft im Spiel nach rechts).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  frame: AtlasFrame,
  x: number,
  bottomY: number,
  scale: number,
  flipX = false,
): void {
  const w = frame.w * scale;
  const h = frame.h * scale;
  if (!flipX) {
    ctx.drawImage(
      atlas.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      x - w / 2,
      bottomY - h,
      w,
      h,
    );
    return;
  }
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    atlas.image,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    -w / 2,
    bottomY - h,
    w,
    h,
  );
  ctx.restore();
}
