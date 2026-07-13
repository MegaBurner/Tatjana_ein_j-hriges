import * as THREE from 'three';

const SHADOW_TEXTURE_SIZE = 256;

/** Erzeugt eine weiche, kreisförmige Kontaktschatten-Textur (schwarz -> transparent). */
function makeSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SHADOW_TEXTURE_SIZE;
  canvas.height = SHADOW_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  const center = SHADOW_TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE);
  return new THREE.CanvasTexture(canvas);
}

let softShadowTexture: THREE.CanvasTexture | null = null;

/** Modul-weites Singleton — eine Canvas-Textur, geteilt von allen weichen Kontaktschatten. */
export function getSoftShadowTexture(): THREE.CanvasTexture {
  softShadowTexture ??= makeSoftShadowTexture();
  return softShadowTexture;
}
