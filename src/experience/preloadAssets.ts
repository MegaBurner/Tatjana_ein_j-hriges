import * as THREE from "three";
import { useLoader } from "@react-three/fiber";

/**
 * Idle-Preloading gegen Nachlade-Ruckler beim ersten Durchscrollen:
 * Runde 2 hat Texturen/Chunks bewusst lazy gemacht (gut für schwache
 * Geräte), auf dem Zielgerät (schnell, gute Verbindung) verursacht das aber
 * Jank mitten im Scroll-Glide. Dieses Modul bündelt die Bausteine, mit denen
 * `IdlePreloader.tsx` (gemountet in der Hero-Section) alle Section-Assets in
 * Scroll-Reihenfolge vorlädt, sobald der Browser nach dem Hero-First-Paint
 * Leerlauf meldet — der First Paint selbst wird dadurch nie verzögert.
 */

// --- Idle-Scheduling --------------------------------------------------------

/** Spätestens nach dieser Zeit läuft ein Idle-Step auch unter Dauerlast. */
const IDLE_TIMEOUT_MS = 2000;
/** Fallback-Abstand für Browser ohne requestIdleCallback (Safari): klein
 *  genug für zügiges Vorladen, groß genug, um keine Frame-Serie zu treffen. */
const FALLBACK_DELAY_MS = 300;

/**
 * Führt `callback` im nächsten Browser-Idle-Fenster aus (`requestIdleCallback`
 * mit `setTimeout`-Fallback) und liefert eine Cancel-Funktion — direkt als
 * Effect-Cleanup verwendbar.
 */
export function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, {
      timeout: IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(id);
}

/**
 * Lädt fertig geladene Texturen gestaffelt — EINE pro Idle-Step — via
 * `gl.initTexture` auf die GPU hoch, statt alle Uploads in einem Frame zu
 * bündeln (8 Buch-Fotos à ~2 MPixel in einem Rutsch wären ein spürbarer
 * Main-Thread-Block). Bereits hochgeladene Texturen sind für three ein
 * No-op. Liefert eine Cancel-Funktion (Effect-Cleanup).
 */
export function uploadTexturesStaggered(
  gl: THREE.WebGLRenderer,
  textures: readonly THREE.Texture[],
  onDone?: () => void,
): () => void {
  let nextIndex = 0;
  let cancelScheduled: (() => void) | null = null;
  let isCancelled = false;

  const uploadNext = () => {
    if (isCancelled) return;
    if (nextIndex >= textures.length) {
      onDone?.();
      return;
    }
    gl.initTexture(textures[nextIndex]);
    nextIndex += 1;
    cancelScheduled = scheduleIdle(uploadNext);
  };

  cancelScheduled = scheduleIdle(uploadNext);
  return () => {
    isCancelled = true;
    cancelScheduled?.();
  };
}

// --- Asset-Listen (Scroll-Reihenfolge) --------------------------------------

// Section 1 (Fotobuch) — web-optimierte Kopien (max. 1600px, ~2,4 MB gesamt
// statt 12,6 MB Originale). Liegt hier statt in PhotosSection, damit
// IdlePreloader und PhotosSection garantiert denselben useLoader-Cache-Key
// ([TextureLoader, ...PHOTO_URLS]) verwenden.
const PHOTO_FILES = [
  "IMG_4891.jpg",
  "IMG_4909.jpg",
  "IMG_4913.jpg",
  "IMG_5006.jpg",
  "IMG_6280.jpg",
  "IMG_7321.jpg",
  "IMG_7411.jpg",
  "IMG_8099.jpg",
];

export const PHOTO_URLS = PHOTO_FILES.map(
  (file) => `${import.meta.env.BASE_URL}memories/web/${file}`,
);

/** JPG-Fotos sind sRGB-kodiert — muss VOR dem ersten GPU-Upload gesetzt
 *  sein, sonst lädt three sie mit linearem Farbraum hoch (ausgewaschene
 *  Farben; ohne `needsUpdate` kein Re-Upload). */
export function markSRGB(textures: THREE.Texture[]): void {
  textures.forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
}

// Section 2 (Vinyl) — Cover der Playlist. MUSS mit `songs` in src/App.tsx
// übereinstimmen (dort ebenfalls kommentiert): das erste Cover lädt ohnehin
// beim Start, das zweite sonst erst beim Songwechsel (Suspense-Nachladen
// mitten im Erlebnis).
const SONG_COVER_FILES = ["song.jpg", "les.jpeg"];

const SONG_COVER_URLS = SONG_COVER_FILES.map(
  (file) => import.meta.env.BASE_URL + file,
);

/** Startet den Netz-Load beider Song-Cover in den useLoader-Cache —
 *  gleicher Ein-URL-Key wie `useLoader(THREE.TextureLoader, coverImage)`
 *  in VinylSection. Die Cover sind klein (500×500), der spätere
 *  GPU-Upload des Klons ist vernachlässigbar. */
export function preloadSongCovers(): void {
  SONG_COVER_URLS.forEach((url) => {
    useLoader.preload(THREE.TextureLoader, url);
  });
}

// Section 3 (Brief): letter-pages/seite-1.jpg lädt bereits beim Experience-
// Mount (LetterSection ist nicht sichtbarkeits-gegated) — hier ist nichts
// vorzuladen. Der GPU-Upload der drei Panel-Klone wird direkt in
// LetterSection via uploadTexturesStaggered vorgezogen.
// Sections 4-7 (Pinguine, Sarma, Globus, Finale): rein prozedurale
// Canvas-/Geometrie-Inhalte, keine externen Assets.

/**
 * Wärmt den lazy LetterModal-Chunk (inkl. framer-motion-Vendor-Chunk,
 * ~130 kB) vor — gleicher Modulpfad wie das React.lazy in src/App.tsx,
 * Vite/Rolldown dedupliziert das auf denselben Chunk. Ohne Warmup lädt der
 * Chunk erst beim ersten Öffnen des Briefs (sichtbare Wartezeit + Jank).
 */
export function warmLetterModalChunk(): void {
  void import("../components/LetterModal/LetterModal");
}
